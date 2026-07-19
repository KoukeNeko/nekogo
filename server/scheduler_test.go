package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func testQueueService(t *testing.T, content contentResolver) (*audioService, *assetStore) {
	t.Helper()
	root := t.TempDir()
	cfg := config{
		databasePath:           filepath.Join(root, "tts.db"),
		audioDir:               filepath.Join(root, "audio"),
		defaultVoice:           "dictionary-ja-01",
		defaultFormat:          "opus",
		defaultSpeed:           1,
		modelRevision:          "model-v1",
		voiceVersion:           "voice-v1",
		profileVersion:         "profile-v1",
		requestTimeout:         2 * time.Second,
		maxConcurrentSynthesis: 1,
		maxAudioBytes:          1024 * 1024,
	}
	store, err := newAssetStore(cfg)
	if err != nil {
		t.Fatalf("newAssetStore: %v", err)
	}
	t.Cleanup(func() { _ = store.close() })
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return newAudioService(cfg, store, content, nil, nil, logger), store
}

func enqueueTestJob(t *testing.T, service *audioService, entryID, text string, priority int64, force bool) enqueueResult {
	t.Helper()
	result, err := service.enqueueAudio(context.Background(), synthesisRequest{
		entryID: entryID, text: text, voice: "dictionary-ja-01", format: "opus", speed: 1,
	}, priority, force)
	if err != nil {
		t.Fatalf("enqueueAudio(%s): %v", entryID, err)
	}
	return result
}

func TestSynthesisQueueIsIdempotentAndClaimsByEligibility(t *testing.T) {
	service, store := testQueueService(t, nil)
	first := enqueueTestJob(t, service, "example:1", "これは長い例文です。", 1, false)
	duplicate := enqueueTestJob(t, service, "example:1", "これは長い例文です。", 0, false)
	if first.disposition != enqueueQueued || duplicate.disposition != enqueueAlreadyQueued || first.token != duplicate.token {
		t.Fatalf("unexpected enqueue results: first=%+v duplicate=%+v", first, duplicate)
	}
	var persisted int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM synthesis_jobs WHERE entry_id = 'example:1'`).Scan(&persisted); err != nil {
		t.Fatalf("query freshly migrated queue: %v", err)
	}
	if persisted != 1 {
		t.Fatalf("persisted duplicate queue rows = %d, want 1", persisted)
	}
	enqueueTestJob(t, service, "vocab:2", "猫", 20, false)

	profile := service.identity("", "", "", 0)
	cpuJob, found, err := store.claimSynthesis(context.Background(), "cpu", "cpu-owner", 4, time.Minute, time.Minute, profile)
	if err != nil || !found {
		t.Fatalf("CPU claim: found=%v err=%v", found, err)
	}
	if cpuJob.identity.entryID != "vocab:2" {
		t.Fatalf("CPU claimed %q, want short vocab", cpuJob.identity.entryID)
	}
	gpuJob, found, err := store.claimSynthesis(context.Background(), "gpu", "gpu-owner", 0, time.Minute, time.Minute, profile)
	if err != nil || !found {
		t.Fatalf("GPU claim: found=%v err=%v", found, err)
	}
	if gpuJob.identity.entryID != "example:1" || gpuJob.priority != 0 {
		t.Fatalf("GPU job = %+v", gpuJob)
	}
	if _, found, err := store.claimSynthesis(context.Background(), "gpu", "other", 0, time.Minute, time.Minute, profile); err != nil || found {
		t.Fatalf("exclusive claim found=%v err=%v", found, err)
	}
}

func TestCPUClaimKeepsInteractivePriorityAheadOfKindPreference(t *testing.T) {
	service, store := testQueueService(t, nil)
	enqueueTestJob(t, service, "vocab:20", "猫", 100, false)
	enqueueTestJob(t, service, "example:21", "お願い。", 10, false)

	job, found, err := store.claimSynthesis(context.Background(), "cpu", "cpu-owner", 20, time.Minute, time.Minute, service.identity("", "", "", 0))
	if err != nil || !found {
		t.Fatalf("CPU claim: found=%v err=%v", found, err)
	}
	if job.identity.entryID != "example:21" {
		t.Fatalf("CPU claimed %q, want interactive example", job.identity.entryID)
	}
}

func TestClaimDoesNotRunJobsFromAnotherSynthesisProfile(t *testing.T) {
	service, store := testQueueService(t, nil)
	enqueueTestJob(t, service, "vocab:22", "旧", 10, false)

	otherProfile := service.identity("", "", "", 0)
	otherProfile.profileVersion = "profile-v2"
	if _, found, err := store.claimSynthesis(context.Background(), "gpu", "old-profile-process", 0, time.Minute, time.Minute, otherProfile); err != nil || found {
		t.Fatalf("other profile claim: found=%v err=%v", found, err)
	}
	if _, found, err := store.claimSynthesis(context.Background(), "gpu", "new-profile-process", 0, time.Minute, time.Minute, service.identity("", "", "", 0)); err != nil || !found {
		t.Fatalf("current profile claim: found=%v err=%v", found, err)
	}
}

func TestBackendLeasePreventsTwoProcessesClaimingSameRuntime(t *testing.T) {
	service, store := testQueueService(t, nil)
	enqueueTestJob(t, service, "vocab:23", "一", 10, false)
	enqueueTestJob(t, service, "vocab:24", "二", 20, false)
	profile := service.identity("", "", "", 0)

	if _, found, err := store.claimSynthesis(context.Background(), "gpu", "process-1", 0, time.Minute, time.Minute, profile); err != nil || !found {
		t.Fatalf("first process claim: found=%v err=%v", found, err)
	}
	if _, found, err := store.claimSynthesis(context.Background(), "gpu", "process-2", 0, time.Minute, time.Minute, profile); err != nil || found {
		t.Fatalf("overlapping process claim: found=%v err=%v", found, err)
	}
}

func TestSynthesisLeaseRecoveryRetryAndTokenInvalidation(t *testing.T) {
	service, store := testQueueService(t, nil)
	original := enqueueTestJob(t, service, "vocab:3", "犬", 10, false)
	profile := service.identity("", "", "", 0)
	_, found, err := store.claimSynthesis(context.Background(), "gpu", "old-owner", 0, 5*time.Millisecond, 5*time.Millisecond, profile)
	if err != nil || !found {
		t.Fatalf("initial claim: found=%v err=%v", found, err)
	}
	time.Sleep(10 * time.Millisecond)
	recovered, found, err := store.claimSynthesis(context.Background(), "cpu", "new-owner", 20, time.Minute, time.Minute, profile)
	if err != nil || !found || recovered.generationToken != original.token {
		t.Fatalf("recovered claim: job=%+v found=%v err=%v", recovered, found, err)
	}
	terminal, err := store.failSynthesis(context.Background(), recovered, "cpu", errors.New("temporary outage"), false, time.Second)
	if err != nil || terminal {
		t.Fatalf("transient fail: terminal=%v err=%v", terminal, err)
	}
	if _, err := store.db.Exec(`UPDATE synthesis_jobs SET next_attempt_at = 0`); err != nil {
		t.Fatalf("make retry ready: %v", err)
	}
	retried, found, err := store.claimSynthesis(context.Background(), "gpu", "retry-owner", 0, time.Minute, time.Minute, profile)
	if err != nil || !found || retried.attempts != 3 {
		t.Fatalf("retry claim: job=%+v found=%v err=%v", retried, found, err)
	}
	forced := enqueueTestJob(t, service, "vocab:3", "犬", 0, true)
	if forced.token == retried.generationToken {
		t.Fatal("force enqueue did not rotate generation token")
	}
	objectKey, _ := audioObjectKey(retried.identity.entryID, retried.identity.format)
	finalPath, _ := store.assetPath(objectKey)
	temporaryPath, err := writeTokenTemporary(finalPath, retried.generationToken, []byte("stale"))
	if err != nil {
		t.Fatalf("write stale result: %v", err)
	}
	defer os.Remove(temporaryPath)
	err = store.completeSynthesis(context.Background(), retried, "gpu", temporaryPath, objectKey, sha256Hex([]byte("stale")), 5, time.Second)
	if !errors.Is(err, errSynthesisJobTokenInvalid) {
		t.Fatalf("stale completion error = %v", err)
	}
	if _, err := os.Stat(finalPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale completion published final file: %v", err)
	}
}

func TestTransientSynthesisFailureAllowsThreeRetries(t *testing.T) {
	service, store := testQueueService(t, nil)
	enqueueTestJob(t, service, "vocab:4", "鳥", 10, false)

	for attempt := 1; attempt <= 4; attempt++ {
		job, found, err := store.claimSynthesis(context.Background(), "gpu", "owner", 0, time.Minute, time.Minute, service.identity("", "", "", 0))
		if err != nil || !found {
			t.Fatalf("claim attempt %d: found=%v err=%v", attempt, found, err)
		}
		terminal, err := store.failSynthesis(context.Background(), job, "gpu", errors.New("temporary outage"), false, time.Second)
		if err != nil {
			t.Fatalf("fail attempt %d: %v", attempt, err)
		}
		if terminal != (attempt == 4) {
			t.Fatalf("attempt %d terminal=%v", attempt, terminal)
		}
		if attempt < 4 {
			if _, err := store.db.Exec(`UPDATE synthesis_jobs SET next_attempt_at = 0`); err != nil {
				t.Fatalf("make retry %d ready: %v", attempt+1, err)
			}
		}
	}
}

type recordingSynthesisClient struct {
	delay     time.Duration
	mu        sync.Mutex
	calls     map[string]int
	active    int
	maxActive int
}

func (c *recordingSynthesisClient) synthesize(ctx context.Context, request synthesisRequest) ([]byte, error) {
	c.mu.Lock()
	c.active++
	if c.active > c.maxActive {
		c.maxActive = c.active
	}
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.active--
		c.mu.Unlock()
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(c.delay):
	}
	c.mu.Lock()
	c.calls[request.entryID]++
	c.mu.Unlock()
	return []byte("audio-" + request.entryID), nil
}

func TestTwoSchedulersStillUseOneRequestPerBackend(t *testing.T) {
	service, store := testQueueService(t, nil)
	for index := 0; index < 4; index++ {
		enqueueTestJob(t, service, fmt.Sprintf("vocab:%d", 30+index), "猫", int64(index), false)
	}
	client := &recordingSynthesisClient{delay: 15 * time.Millisecond, calls: make(map[string]int)}
	first := newAudioScheduler(service, []synthesisBackend{{name: "gpu", client: client}}, service.logger)
	second := newAudioScheduler(service, []synthesisBackend{{name: "gpu", client: client}}, service.logger)
	first.pollInterval = time.Millisecond
	second.pollInterval = time.Millisecond
	first.backendLeaseDuration = 50 * time.Millisecond
	second.backendLeaseDuration = 50 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	first.start(ctx)
	second.start(ctx)
	deadline := time.Now().Add(3 * time.Second)
	for {
		progress, err := store.synthesisProgress(context.Background(), service.identity("", "dictionary-ja-01", "opus", 1))
		if err != nil {
			t.Fatalf("progress: %v", err)
		}
		if progress.ready == 4 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("scheduler timeout: %+v", progress)
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	first.waitForStop()
	second.waitForStop()
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.maxActive != 1 {
		t.Fatalf("maximum active GPU requests = %d, want 1", client.maxActive)
	}
}

func TestReadyAssetRejectsSameSizeSHA256Mismatch(t *testing.T) {
	service, store := testQueueService(t, nil)
	request := synthesisRequest{
		entryID: "vocab:40", text: "猫", voice: "dictionary-ja-01", format: "opus", speed: 1,
	}
	if _, err := service.importAudio(context.Background(), request, []byte("old-audio"), false); err != nil {
		t.Fatalf("import audio: %v", err)
	}
	asset, err := store.lookupReady(context.Background(), service.identity(request.entryID, request.voice, request.format, request.speed))
	if err != nil {
		t.Fatalf("lookup ready: %v", err)
	}
	path, err := store.assetPath(asset.objectKey)
	if err != nil {
		t.Fatalf("asset path: %v", err)
	}
	if err := os.WriteFile(path, []byte("new-audio"), 0o644); err != nil {
		t.Fatalf("replace audio: %v", err)
	}
	if _, err := service.readyAsset(context.Background(), request.entryID, request.voice, request.format, request.speed); !errors.Is(err, errAudioNotFound) {
		t.Fatalf("readyAsset error = %v, want audio not found", err)
	}
}

func TestDualSchedulerCompletesEachJobOnce(t *testing.T) {
	service, store := testQueueService(t, nil)
	for index, text := range []string{"猫", "犬", "これは例文です", "鳥"} {
		kind := "vocab"
		if index == 2 {
			kind = "example"
		}
		enqueueTestJob(t, service, fmt.Sprintf("%s:%d", kind, index+10), text, int64(index), false)
	}
	gpu := &recordingSynthesisClient{delay: 8 * time.Millisecond, calls: make(map[string]int)}
	cpu := &recordingSynthesisClient{delay: 12 * time.Millisecond, calls: make(map[string]int)}
	scheduler := newAudioScheduler(service, []synthesisBackend{
		{name: "gpu", client: gpu},
		{name: "cpu", client: cpu, maxTextRunes: 4},
	}, service.logger)
	scheduler.pollInterval = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	scheduler.start(ctx)
	deadline := time.Now().Add(3 * time.Second)
	for {
		progress, err := store.synthesisProgress(context.Background(), service.identity("", "dictionary-ja-01", "opus", 1))
		if err != nil {
			t.Fatalf("progress: %v", err)
		}
		if progress.ready == 4 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("scheduler timeout: %+v", progress)
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	scheduler.waitForStop()
	totalCalls := make(map[string]int)
	for _, client := range []*recordingSynthesisClient{gpu, cpu} {
		client.mu.Lock()
		for entryID, count := range client.calls {
			totalCalls[entryID] += count
		}
		client.mu.Unlock()
	}
	if len(totalCalls) != 4 {
		t.Fatalf("synthesized entries = %v", totalCalls)
	}
	for entryID, count := range totalCalls {
		if count != 1 {
			t.Fatalf("entry %s synthesized %d times", entryID, count)
		}
	}
}

func TestDictionaryAudioStatusReportsQueueProgress(t *testing.T) {
	runtime := newTestRuntime(t, "http://127.0.0.1:1")
	if _, err := runtime.service.importAudio(context.Background(), synthesisRequest{
		entryID: "example:7", text: "例文です。", voice: runtime.cfg.defaultVoice,
		format: runtime.cfg.defaultFormat, speed: runtime.cfg.defaultSpeed,
	}, []byte("ready-audio"), false); err != nil {
		t.Fatalf("import ready audio: %v", err)
	}
	if _, err := runtime.service.enqueueAudio(context.Background(), synthesisRequest{
		entryID: "example:42", text: "自然な例文です。", voice: runtime.cfg.defaultVoice,
		format: runtime.cfg.defaultFormat, speed: runtime.cfg.defaultSpeed,
	}, 10, false); err != nil {
		t.Fatalf("enqueue status fixture: %v", err)
	}
	response := performAudioRequest(runtime.handler, http.MethodGet, "app-secret", "/api/v1/dictionary-audio/status")
	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d; body=%s", response.Code, response.Body.String())
	}
	var status struct {
		SchemaVersion int     `json:"schema_version"`
		ProfileID     string  `json:"profile_id"`
		Format        string  `json:"format"`
		Expected      int64   `json:"expected_count"`
		Ready         int64   `json:"ready_count"`
		TotalBytes    int64   `json:"total_bytes"`
		Queued        int64   `json:"queued_count"`
		Running       int64   `json:"running_count"`
		Failed        int64   `json:"failed_count"`
		GPUCompleted  int64   `json:"gpu_completed"`
		CPUCompleted  int64   `json:"cpu_completed"`
		Progress      float64 `json:"progress_percent"`
		Workers       []struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			Kind      string `json:"kind"`
			State     string `json:"state"`
			Current   string `json:"current_entry_id"`
			Completed int64  `json:"completed_count"`
		} `json:"workers"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status.SchemaVersion != 1 || status.ProfileID == "" || status.Format != runtime.cfg.defaultFormat {
		t.Fatalf("status metadata = %+v", status)
	}
	if status.Expected != 3 || status.Ready != 1 || status.TotalBytes != int64(len("ready-audio")) || status.Queued != 1 {
		t.Fatalf("status counts = %+v", status)
	}
	if status.Progress <= 0 || len(status.Workers) != 1 || status.Workers[0].ID != "gpu" || status.Workers[0].Name != "RTX 4070 Ti" || status.Workers[0].Kind != "gpu" {
		t.Fatalf("status worker details = %+v", status)
	}
}
