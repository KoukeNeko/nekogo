package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// synthesisBackend is intentionally small so main can construct GPU and CPU
// clients without coupling configuration parsing to the queue implementation.
// A zero maxTextRunes means the backend may claim any job.
type synthesisBackend struct {
	name         string
	client       synthesisClient
	maxTextRunes int
}

type audioScheduler struct {
	service              *audioService
	backends             []synthesisBackend
	logger               *slog.Logger
	leaseDuration        time.Duration
	backendLeaseDuration time.Duration
	pollInterval         time.Duration

	mu       sync.Mutex
	started  bool
	active   map[string]activeGeneration
	wake     chan struct{}
	wait     sync.WaitGroup
	ownerTag string
}

type activeGeneration struct {
	token  string
	cancel context.CancelFunc
}

func newAudioScheduler(service *audioService, backends []synthesisBackend, logger *slog.Logger) *audioScheduler {
	leaseDuration := service.requestTimeout + time.Minute
	if leaseDuration < 2*time.Minute {
		leaseDuration = 2 * time.Minute
	}
	token, err := newGenerationToken()
	if err != nil {
		token = fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return &audioScheduler{
		service:              service,
		backends:             append([]synthesisBackend(nil), backends...),
		logger:               logger,
		leaseDuration:        leaseDuration,
		backendLeaseDuration: 30 * time.Second,
		pollInterval:         500 * time.Millisecond,
		active:               make(map[string]activeGeneration),
		wake:                 make(chan struct{}, 1),
		ownerTag:             token,
	}
}

// start binds the service before workers begin, ensuring App misses never fall
// back to process-local generation once the persistent scheduler is enabled.
func (s *audioScheduler) start(ctx context.Context) {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return
	}
	s.started = true
	s.service.scheduler = s
	for index, backend := range s.backends {
		if backend.client == nil || strings.TrimSpace(backend.name) == "" {
			continue
		}
		s.wait.Add(1)
		go s.worker(ctx, backend, fmt.Sprintf("%s:%s:%d", s.ownerTag, backend.name, index))
	}
	s.mu.Unlock()
}

func (s *audioScheduler) waitForStop() {
	s.wait.Wait()
}

func (s *audioScheduler) notify() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *audioScheduler) worker(ctx context.Context, backend synthesisBackend, owner string) {
	defer s.wait.Done()
	defer func() {
		releaseContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.service.store.releaseSynthesisBackendLease(releaseContext, backend.name, owner); err != nil && s.logger != nil {
			s.logger.Error("release synthesis backend lease", "backend", backend.name, "error", err)
		}
	}()
	for {
		if err := ctx.Err(); err != nil {
			return
		}
		job, found, err := s.service.store.claimSynthesis(
			ctx, backend.name, owner, backend.maxTextRunes, s.leaseDuration, s.backendLeaseDuration,
			s.service.identity("", "", "", 0),
		)
		if err != nil {
			if ctx.Err() == nil && s.logger != nil {
				s.logger.Error("claim synthesis job", "backend", backend.name, "error", err)
			}
			s.waitForWork(ctx)
			continue
		}
		if !found {
			s.waitForWork(ctx)
			continue
		}
		s.process(ctx, backend, job)
		releaseContext, releaseCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := s.service.store.releaseSynthesisBackendLease(releaseContext, backend.name, owner); err != nil && s.logger != nil {
			s.logger.Error("release synthesis backend lease after job", "backend", backend.name, "error", err)
		}
		releaseCancel()
	}
}

func (s *audioScheduler) waitForWork(ctx context.Context) {
	timer := time.NewTimer(s.pollInterval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-s.wake:
	case <-timer.C:
	}
}

func identityKey(identity audioIdentity) string {
	return fmt.Sprintf("%s\x00%s\x00%s\x00%d\x00%s\x00%s\x00%s",
		identity.entryID, identity.voice, identity.format, identity.speedMilli,
		identity.voiceVersion, identity.modelRevision, identity.profileVersion)
}

func (s *audioScheduler) process(parent context.Context, backend synthesisBackend, job synthesisJob) {
	started := time.Now()
	requestContext, cancel := context.WithTimeout(parent, s.service.requestTimeout)
	key := identityKey(job.identity)
	s.mu.Lock()
	s.active[key] = activeGeneration{token: job.generationToken, cancel: cancel}
	s.mu.Unlock()
	defer func() {
		cancel()
		s.mu.Lock()
		if active, ok := s.active[key]; ok && active.token == job.generationToken {
			delete(s.active, key)
		}
		s.mu.Unlock()
	}()

	leaseDone := make(chan struct{})
	go s.renewLease(requestContext, job, leaseDone, cancel)
	audio, err := backend.client.synthesize(requestContext, synthesisRequest{
		entryID: job.identity.entryID,
		text:    job.text,
		voice:   job.identity.voice,
		format:  job.identity.format,
		speed:   float64(job.identity.speedMilli) / 1000,
		seed:    deterministicSeed(job.identity.entryID, job.identity.voiceVersion, job.identity.profileVersion),
	})
	close(leaseDone)
	if err != nil {
		s.handleFailure(parent, backend.name, job, err, time.Since(started))
		return
	}
	if len(audio) == 0 || int64(len(audio)) > s.service.maxAudioBytes {
		s.handleFailure(parent, backend.name, job,
			fmt.Errorf("synthesized audio must contain 1 to %d bytes", s.service.maxAudioBytes), time.Since(started))
		return
	}
	objectKey, err := audioObjectKey(job.identity.entryID, job.identity.format)
	if err != nil {
		s.handleFailure(parent, backend.name, job, err, time.Since(started))
		return
	}
	finalPath, err := s.service.store.assetPath(objectKey)
	if err != nil {
		s.handleFailure(parent, backend.name, job, err, time.Since(started))
		return
	}
	temporaryPath, err := writeTokenTemporary(finalPath, job.generationToken, audio)
	if err != nil {
		s.handleFailure(parent, backend.name, job, err, time.Since(started))
		return
	}
	defer os.Remove(temporaryPath)
	completionContext, completionCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer completionCancel()
	err = s.service.store.completeSynthesis(
		completionContext, job, backend.name, temporaryPath, objectKey,
		sha256Hex(audio), int64(len(audio)), time.Since(started),
	)
	if errors.Is(err, errSynthesisJobTokenInvalid) {
		if s.logger != nil {
			s.logger.Info("discard stale synthesis result", "backend", backend.name, "entry_id", job.identity.entryID)
		}
		return
	}
	if err != nil {
		s.handleFailure(parent, backend.name, job, err, time.Since(started))
		return
	}
	if s.logger != nil {
		s.logger.Info("audio synthesis complete", "backend", backend.name, "entry_id", job.identity.entryID,
			"attempt", job.attempts, "bytes", len(audio), "duration", time.Since(started))
	}
}

func (s *audioScheduler) renewLease(ctx context.Context, job synthesisJob, done <-chan struct{}, cancelGeneration context.CancelFunc) {
	interval := s.backendLeaseDuration / 2
	if interval <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			return
		case <-ticker.C:
			renewContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			jobRenewed, jobErr := s.service.store.renewSynthesisLease(renewContext, job, s.leaseDuration)
			backendRenewed, backendErr := s.service.store.renewSynthesisBackendLease(
				renewContext, job.lastBackend, job.leaseOwner, s.backendLeaseDuration,
			)
			cancel()
			if jobErr != nil || backendErr != nil || !jobRenewed || !backendRenewed {
				if s.logger != nil {
					s.logger.Error("renew synthesis leases", "backend", job.lastBackend, "entry_id", job.identity.entryID,
						"job_renewed", jobRenewed, "backend_renewed", backendRenewed,
						"job_error", jobErr, "backend_error", backendErr)
				}
				cancelGeneration()
				return
			}
		}
	}
}

func (s *audioScheduler) handleFailure(parent context.Context, backend string, job synthesisJob, synthesisErr error, duration time.Duration) {
	if parent.Err() != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = s.service.store.releaseSynthesisLease(ctx, job)
		cancel()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	terminal, err := s.service.store.failSynthesis(ctx, job, backend, synthesisErr, permanentSynthesisError(synthesisErr), duration)
	cancel()
	if s.logger != nil {
		s.logger.Error("audio synthesis failed", "backend", backend, "entry_id", job.identity.entryID,
			"attempt", job.attempts, "terminal", terminal, "error", synthesisErr, "queue_error", err)
	}
	if !terminal {
		s.notify()
	}
}

func permanentSynthesisError(err error) bool {
	message := strings.ToLower(err.Error())
	permanentMarkers := []string{
		"untrusted audio url", "invalid audio object", "malformed", "validation",
		"bad request", "unauthorized", "forbidden", "not found", "returned 4",
	}
	for _, marker := range permanentMarkers {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func writeTokenTemporary(finalPath, token string, audio []byte) (string, error) {
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return "", fmt.Errorf("create audio object directory: %w", err)
	}
	prefix := ".audio-" + token + "-"
	temporary, err := os.CreateTemp(filepath.Dir(finalPath), prefix)
	if err != nil {
		return "", fmt.Errorf("create token audio file: %w", err)
	}
	temporaryPath := temporary.Name()
	failed := true
	defer func() {
		_ = temporary.Close()
		if failed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o644); err != nil {
		return "", err
	}
	if _, err := temporary.Write(audio); err != nil {
		return "", err
	}
	if err := temporary.Sync(); err != nil {
		return "", err
	}
	if err := temporary.Close(); err != nil {
		return "", err
	}
	failed = false
	return temporaryPath, nil
}

func (s *audioScheduler) cancel(identity audioIdentity) {
	s.mu.Lock()
	active := s.active[identityKey(identity)]
	s.mu.Unlock()
	if active.cancel != nil {
		active.cancel()
	}
}
