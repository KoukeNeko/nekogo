package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var errAudioNotFound = errors.New("audio asset not found")
var errSynthesisJobTokenInvalid = errors.New("synthesis job token is no longer current")

type audioIdentity struct {
	entryID        string
	voice          string
	format         string
	speedMilli     int
	voiceVersion   string
	modelRevision  string
	profileVersion string
}

type audioAsset struct {
	identity  audioIdentity
	text      string
	textHash  string
	objectKey string
	etag      string
	sizeBytes int64
	updatedAt time.Time
}

type readyAssetSummary struct {
	count      int64
	totalBytes int64
}

const (
	jobStateQueued = "queued"
	jobStateLeased = "leased"
	jobStateFailed = "failed"
)

type synthesisJob struct {
	identity        audioIdentity
	text            string
	textHash        string
	priority        int64
	textRunes       int
	entryKind       string
	state           string
	generationToken string
	leaseOwner      string
	leaseUntil      time.Time
	attempts        int
	nextAttemptAt   time.Time
	lastBackend     string
	lastError       string
	createdAt       time.Time
	updatedAt       time.Time
}

type enqueueDisposition string

const (
	enqueueReady         enqueueDisposition = "ready"
	enqueueQueued        enqueueDisposition = "queued"
	enqueueAlreadyQueued enqueueDisposition = "already_queued"
)

type enqueueResult struct {
	disposition enqueueDisposition
	token       string
}

type backendProgress struct {
	backend       string
	completed     int64
	failed        int64
	totalDuration time.Duration
	running       int64
	activeEntryID string
	terminalJobs  int64
	lastError     string
}

type synthesisProgress struct {
	ready      int64
	totalBytes int64
	queued     int64
	running    int64
	failed     int64
	backends   []backendProgress
}

type assetStore struct {
	db       *sql.DB
	audioDir string
}

func newAssetStore(cfg config) (*assetStore, error) {
	if err := os.MkdirAll(filepath.Dir(cfg.databasePath), 0o755); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}
	if err := os.MkdirAll(cfg.audioDir, 0o755); err != nil {
		return nil, fmt.Errorf("create audio directory: %w", err)
	}

	db, err := sql.Open("sqlite", cfg.databasePath)
	if err != nil {
		return nil, fmt.Errorf("open audio database: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	store := &assetStore{db: db, audioDir: cfg.audioDir}
	if err := store.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *assetStore) migrate(ctx context.Context) error {
	statements := []string{
		`PRAGMA journal_mode = WAL`,
		`PRAGMA busy_timeout = 5000`,
		`CREATE TABLE IF NOT EXISTS audio_assets (
			entry_id TEXT NOT NULL,
			text TEXT NOT NULL,
			text_hash TEXT NOT NULL,
			voice_id TEXT NOT NULL,
			format TEXT NOT NULL,
			speed_milli INTEGER NOT NULL,
			voice_version TEXT NOT NULL,
			model_revision TEXT NOT NULL,
			profile_version TEXT NOT NULL,
			object_key TEXT,
			etag TEXT,
			size_bytes INTEGER,
			status TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
			error_message TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (
				entry_id, voice_id, format, speed_milli,
				voice_version, model_revision, profile_version
			)
		)`,
		`CREATE INDEX IF NOT EXISTS audio_assets_status_idx ON audio_assets(status, updated_at)`,
		`CREATE TABLE IF NOT EXISTS synthesis_jobs (
			entry_id TEXT NOT NULL,
			text TEXT NOT NULL,
			text_hash TEXT NOT NULL,
			voice_id TEXT NOT NULL,
			format TEXT NOT NULL,
			speed_milli INTEGER NOT NULL,
			voice_version TEXT NOT NULL,
			model_revision TEXT NOT NULL,
			profile_version TEXT NOT NULL,
			priority INTEGER NOT NULL,
			text_runes INTEGER NOT NULL,
			entry_kind TEXT NOT NULL CHECK (entry_kind IN ('vocab', 'example')),
			state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'failed')),
			generation_token TEXT NOT NULL,
			lease_owner TEXT,
			lease_until INTEGER,
			attempts INTEGER NOT NULL DEFAULT 0,
			next_attempt_at INTEGER NOT NULL,
			last_backend TEXT,
			last_error TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (
				entry_id, voice_id, format, speed_milli,
				voice_version, model_revision, profile_version
			)
		)`,
		`CREATE INDEX IF NOT EXISTS synthesis_jobs_claim_idx
			ON synthesis_jobs(state, next_attempt_at, priority, created_at, entry_id)`,
		`CREATE INDEX IF NOT EXISTS synthesis_jobs_lease_idx
			ON synthesis_jobs(state, lease_until)`,
		`CREATE TABLE IF NOT EXISTS synthesis_backend_stats (
			backend TEXT PRIMARY KEY,
			completed INTEGER NOT NULL DEFAULT 0,
			failed INTEGER NOT NULL DEFAULT 0,
			total_duration_ms INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS synthesis_backend_leases (
			backend TEXT PRIMARY KEY,
			owner TEXT NOT NULL,
			lease_until INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("migrate audio database: %w", err)
		}
	}
	return nil
}

func newGenerationToken() (string, error) {
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", fmt.Errorf("create synthesis generation token: %w", err)
	}
	return hex.EncodeToString(token[:]), nil
}

func identityArguments(identity audioIdentity) []any {
	return []any{
		identity.entryID, identity.voice, identity.format, identity.speedMilli,
		identity.voiceVersion, identity.modelRevision, identity.profileVersion,
	}
}

// enqueueSynthesis is the single producer entry point. It preserves a valid
// ready object, coalesces duplicate work, and rotates the token whenever the
// requested text changes or force is set.
func (s *assetStore) enqueueSynthesis(ctx context.Context, identity audioIdentity, text, textHash, entryKind string, textRunes int, priority int64, force bool) (enqueueResult, error) {
	token, err := newGenerationToken()
	if err != nil {
		return enqueueResult{}, err
	}
	now := time.Now().UnixMilli()
	args := identityArguments(identity)
	forceValue := 0
	if force {
		forceValue = 1
	}
	args = append(args, text, textHash, entryKind, textRunes, priority, token, now, now, now)
	for range 11 {
		args = append(args, forceValue)
	}
	var result enqueueResult
	err = s.withImmediate(ctx, func(connection *sql.Conn) error {
		if !force {
			ready, readyErr := s.lookupReadyWith(ctx, connection, identity)
			if readyErr == nil && ready.textHash == textHash && s.validateReadyFile(ready) == nil {
				result = enqueueResult{disposition: enqueueReady}
				return nil
			}
			if readyErr != nil && !errors.Is(readyErr, errAudioNotFound) {
				return readyErr
			}
		}

		row := connection.QueryRowContext(ctx, `
			INSERT INTO synthesis_jobs (
				entry_id, voice_id, format, speed_milli, voice_version, model_revision, profile_version,
				text, text_hash, entry_kind, text_runes, priority, state, generation_token,
				attempts, next_attempt_at, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?)
			ON CONFLICT (entry_id, voice_id, format, speed_milli, voice_version, model_revision, profile_version)
			DO UPDATE SET
				priority = MIN(synthesis_jobs.priority, excluded.priority),
				text = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN excluded.text ELSE synthesis_jobs.text END,
				text_hash = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN excluded.text_hash ELSE synthesis_jobs.text_hash END,
				entry_kind = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN excluded.entry_kind ELSE synthesis_jobs.entry_kind END,
				text_runes = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN excluded.text_runes ELSE synthesis_jobs.text_runes END,
				state = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN 'queued' ELSE synthesis_jobs.state END,
				generation_token = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN excluded.generation_token ELSE synthesis_jobs.generation_token END,
				lease_owner = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN NULL ELSE synthesis_jobs.lease_owner END,
				lease_until = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN NULL ELSE synthesis_jobs.lease_until END,
				attempts = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN 0 ELSE synthesis_jobs.attempts END,
				next_attempt_at = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN excluded.next_attempt_at ELSE synthesis_jobs.next_attempt_at END,
				last_error = CASE WHEN synthesis_jobs.text_hash <> excluded.text_hash OR ? = 1 THEN NULL ELSE synthesis_jobs.last_error END,
				updated_at = excluded.updated_at
			RETURNING generation_token`, args...)
		var currentToken string
		if err := row.Scan(&currentToken); err != nil {
			return fmt.Errorf("enqueue synthesis job: %w", err)
		}
		disposition := enqueueAlreadyQueued
		if currentToken == token {
			disposition = enqueueQueued
		}
		result = enqueueResult{disposition: disposition, token: currentToken}
		return nil
	})
	if err != nil {
		return enqueueResult{}, err
	}
	return result, nil
}

func (s *assetStore) close() error {
	return s.db.Close()
}

func (s *assetStore) ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *assetStore) withImmediate(ctx context.Context, operation func(*sql.Conn) error) (err error) {
	connection, err := s.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("reserve synthesis database connection: %w", err)
	}
	defer connection.Close()
	if _, err = connection.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		return fmt.Errorf("begin synthesis transaction: %w", err)
	}
	defer func() {
		if err != nil {
			_, _ = connection.ExecContext(context.Background(), `ROLLBACK`)
		}
	}()
	if err = operation(connection); err != nil {
		return err
	}
	if _, err = connection.ExecContext(ctx, `COMMIT`); err != nil {
		return fmt.Errorf("commit synthesis transaction: %w", err)
	}
	return nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanSynthesisJob(row rowScanner) (synthesisJob, error) {
	var job synthesisJob
	var leaseUntil sql.NullInt64
	var lastBackend, lastError sql.NullString
	var nextAttemptAt, createdAt, updatedAt int64
	err := row.Scan(
		&job.identity.entryID, &job.text, &job.textHash, &job.identity.voice, &job.identity.format,
		&job.identity.speedMilli, &job.identity.voiceVersion, &job.identity.modelRevision,
		&job.identity.profileVersion, &job.priority, &job.textRunes, &job.entryKind, &job.state,
		&job.generationToken, &job.leaseOwner, &leaseUntil, &job.attempts, &nextAttemptAt,
		&lastBackend, &lastError, &createdAt, &updatedAt,
	)
	if err != nil {
		return synthesisJob{}, err
	}
	if leaseUntil.Valid {
		job.leaseUntil = time.UnixMilli(leaseUntil.Int64)
	}
	job.nextAttemptAt = time.UnixMilli(nextAttemptAt)
	job.createdAt = time.UnixMilli(createdAt)
	job.updatedAt = time.UnixMilli(updatedAt)
	job.lastBackend = lastBackend.String
	job.lastError = lastError.String
	return job, nil
}

const synthesisJobColumns = `
	entry_id, text, text_hash, voice_id, format, speed_milli,
	voice_version, model_revision, profile_version, priority, text_runes, entry_kind, state,
	generation_token, COALESCE(lease_owner, ''), lease_until, attempts, next_attempt_at,
	last_backend, last_error, created_at, updated_at`

func (s *assetStore) claimSynthesis(ctx context.Context, backend, owner string, maxTextRunes int, jobLeaseDuration, backendLeaseDuration time.Duration, profile audioIdentity) (synthesisJob, bool, error) {
	var claimed synthesisJob
	var found bool
	now := time.Now()
	err := s.withImmediate(ctx, func(connection *sql.Conn) error {
		if _, err := connection.ExecContext(ctx, `
			UPDATE synthesis_jobs
			SET state = 'queued', lease_owner = NULL, lease_until = NULL, updated_at = ?
			WHERE state = 'leased' AND lease_until <= ?`, now.UnixMilli(), now.UnixMilli()); err != nil {
			return fmt.Errorf("recover expired synthesis leases: %w", err)
		}

		row := connection.QueryRowContext(ctx, `
			SELECT `+synthesisJobColumns+`
			FROM synthesis_jobs
			WHERE state = 'queued' AND next_attempt_at <= ?
			  AND voice_version = ? AND model_revision = ? AND profile_version = ?
			  AND (? = 0 OR text_runes <= ?)
			ORDER BY
			  priority,
			  CASE WHEN last_backend = ? THEN 1 ELSE 0 END,
			  CASE WHEN ? > 0 AND entry_kind = 'vocab' THEN 0 ELSE 1 END,
			  created_at, entry_id
			LIMIT 1`, now.UnixMilli(), profile.voiceVersion, profile.modelRevision, profile.profileVersion,
			maxTextRunes, maxTextRunes, backend, maxTextRunes)
		candidate, err := scanSynthesisJob(row)
		if errors.Is(err, sql.ErrNoRows) {
			if _, releaseErr := connection.ExecContext(ctx, `
				DELETE FROM synthesis_backend_leases WHERE backend = ? AND owner = ?`, backend, owner); releaseErr != nil {
				return fmt.Errorf("release idle synthesis backend lease: %w", releaseErr)
			}
			return nil
		}
		if err != nil {
			return fmt.Errorf("select synthesis job: %w", err)
		}
		result, err := connection.ExecContext(ctx, `
			INSERT INTO synthesis_backend_leases (backend, owner, lease_until, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (backend) DO UPDATE SET
				owner = excluded.owner,
				lease_until = excluded.lease_until,
				updated_at = excluded.updated_at
			WHERE synthesis_backend_leases.owner = excluded.owner
			   OR synthesis_backend_leases.lease_until <= excluded.updated_at`,
			backend, owner, now.Add(backendLeaseDuration).UnixMilli(), now.UnixMilli())
		if err != nil {
			return fmt.Errorf("acquire synthesis backend lease: %w", err)
		}
		if rows, err := result.RowsAffected(); err != nil {
			return fmt.Errorf("read synthesis backend lease result: %w", err)
		} else if rows == 0 {
			return nil
		}
		args := []any{owner, now.Add(jobLeaseDuration).UnixMilli(), backend, now.UnixMilli()}
		args = append(args, identityArguments(candidate.identity)...)
		args = append(args, candidate.generationToken)
		result, err = connection.ExecContext(ctx, `
			UPDATE synthesis_jobs
			SET state = 'leased', lease_owner = ?, lease_until = ?, last_backend = ?,
			    attempts = attempts + 1, updated_at = ?
			WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
			  AND voice_version = ? AND model_revision = ? AND profile_version = ?
			  AND generation_token = ? AND state = 'queued'`, args...)
		if err != nil {
			return fmt.Errorf("lease synthesis job: %w", err)
		}
		if rows, err := result.RowsAffected(); err != nil || rows != 1 {
			if err != nil {
				return fmt.Errorf("read synthesis lease result: %w", err)
			}
			return nil
		}
		candidate.state = jobStateLeased
		candidate.leaseOwner = owner
		candidate.leaseUntil = now.Add(jobLeaseDuration)
		candidate.lastBackend = backend
		candidate.attempts++
		claimed, found = candidate, true
		return nil
	})
	if err != nil {
		return synthesisJob{}, false, err
	}
	return claimed, found, nil
}

func (s *assetStore) renewSynthesisBackendLease(ctx context.Context, backend, owner string, leaseDuration time.Duration) (bool, error) {
	now := time.Now()
	result, err := s.db.ExecContext(ctx, `
		UPDATE synthesis_backend_leases SET lease_until = ?, updated_at = ?
		WHERE backend = ? AND owner = ? AND lease_until > ?`,
		now.Add(leaseDuration).UnixMilli(), now.UnixMilli(), backend, owner, now.UnixMilli())
	if err != nil {
		return false, fmt.Errorf("renew synthesis backend lease: %w", err)
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (s *assetStore) releaseSynthesisBackendLease(ctx context.Context, backend, owner string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM synthesis_backend_leases WHERE backend = ? AND owner = ?`, backend, owner)
	if err != nil {
		return fmt.Errorf("release synthesis backend lease: %w", err)
	}
	return nil
}

func (s *assetStore) renewSynthesisLease(ctx context.Context, job synthesisJob, leaseDuration time.Duration) (bool, error) {
	args := []any{time.Now().Add(leaseDuration).UnixMilli(), time.Now().UnixMilli()}
	args = append(args, identityArguments(job.identity)...)
	args = append(args, job.generationToken, job.leaseOwner)
	result, err := s.db.ExecContext(ctx, `
		UPDATE synthesis_jobs SET lease_until = ?, updated_at = ?
		WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?
		  AND generation_token = ? AND lease_owner = ? AND state = 'leased'`, args...)
	if err != nil {
		return false, fmt.Errorf("renew synthesis lease: %w", err)
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (s *assetStore) releaseSynthesisLease(ctx context.Context, job synthesisJob) (bool, error) {
	args := []any{time.Now().UnixMilli(), time.Now().UnixMilli()}
	args = append(args, identityArguments(job.identity)...)
	args = append(args, job.generationToken, job.leaseOwner)
	result, err := s.db.ExecContext(ctx, `
		UPDATE synthesis_jobs
		SET state = 'queued', lease_owner = NULL, lease_until = NULL, next_attempt_at = ?, updated_at = ?
		WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?
		  AND generation_token = ? AND lease_owner = ? AND state = 'leased'`, args...)
	if err != nil {
		return false, fmt.Errorf("release synthesis lease: %w", err)
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func retryDelay(attempt int) time.Duration {
	switch attempt {
	case 1:
		return 5 * time.Second
	case 2:
		return 30 * time.Second
	default:
		return 5 * time.Minute
	}
}

func (s *assetStore) failSynthesis(ctx context.Context, job synthesisJob, backend string, cause error, permanent bool, duration time.Duration) (bool, error) {
	// The first failure is followed by three retries (5s, 30s, then 5m).
	// The fourth failed attempt becomes terminal.
	terminal := permanent || job.attempts >= 4
	state := jobStateQueued
	nextAttempt := time.Now().Add(retryDelay(job.attempts))
	if terminal {
		state = jobStateFailed
		nextAttempt = time.Now()
	}
	message := cause.Error()
	if len(message) > 4000 {
		message = message[:4000]
	}
	args := []any{state, nextAttempt.UnixMilli(), backend, message, time.Now().UnixMilli()}
	args = append(args, identityArguments(job.identity)...)
	args = append(args, job.generationToken, job.leaseOwner)
	result, err := s.db.ExecContext(ctx, `
		UPDATE synthesis_jobs
		SET state = ?, lease_owner = NULL, lease_until = NULL, next_attempt_at = ?,
		    last_backend = ?, last_error = ?, updated_at = ?
		WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?
		  AND generation_token = ? AND lease_owner = ? AND state = 'leased'`, args...)
	if err != nil {
		return false, fmt.Errorf("record synthesis failure: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read synthesis failure result: %w", err)
	}
	if terminal && rows == 1 {
		_, _ = s.db.ExecContext(ctx, `
			INSERT INTO synthesis_backend_stats (backend, failed, updated_at) VALUES (?, 1, ?)
			ON CONFLICT (backend) DO UPDATE SET failed = failed + 1, updated_at = excluded.updated_at`,
			backend, time.Now().UnixMilli())
	}
	return terminal && rows == 1, nil
}

func (s *assetStore) completeSynthesis(ctx context.Context, job synthesisJob, backend, temporaryPath, objectKey, etag string, sizeBytes int64, duration time.Duration) error {
	return s.withImmediate(ctx, func(connection *sql.Conn) error {
		args := identityArguments(job.identity)
		args = append(args, job.generationToken, job.leaseOwner)
		var exists int
		if err := connection.QueryRowContext(ctx, `
			SELECT 1 FROM synthesis_jobs
			WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
			  AND voice_version = ? AND model_revision = ? AND profile_version = ?
			  AND generation_token = ? AND lease_owner = ? AND state = 'leased'`, args...).Scan(&exists); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errSynthesisJobTokenInvalid
			}
			return fmt.Errorf("verify synthesis token: %w", err)
		}
		finalPath, err := s.assetPath(objectKey)
		if err != nil {
			return err
		}
		if err := os.Rename(temporaryPath, finalPath); err != nil {
			return fmt.Errorf("publish synthesized audio: %w", err)
		}
		now := time.Now().Unix()
		assetArgs := append(identityArguments(job.identity), job.text, job.textHash, objectKey, etag, sizeBytes, now, now)
		if _, err := connection.ExecContext(ctx, `
			INSERT INTO audio_assets (
				entry_id, voice_id, format, speed_milli, voice_version, model_revision, profile_version,
				text, text_hash, object_key, etag, size_bytes, status, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
			ON CONFLICT (entry_id, voice_id, format, speed_milli, voice_version, model_revision, profile_version)
			DO UPDATE SET text = excluded.text, text_hash = excluded.text_hash,
				object_key = excluded.object_key, etag = excluded.etag, size_bytes = excluded.size_bytes,
				status = 'ready', error_message = NULL, updated_at = excluded.updated_at`, assetArgs...); err != nil {
			return fmt.Errorf("index synthesized audio: %w", err)
		}
		if _, err := connection.ExecContext(ctx, `
			DELETE FROM synthesis_jobs
			WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
			  AND voice_version = ? AND model_revision = ? AND profile_version = ?
			  AND generation_token = ? AND lease_owner = ?`, args...); err != nil {
			return fmt.Errorf("delete completed synthesis job: %w", err)
		}
		if _, err := connection.ExecContext(ctx, `
			INSERT INTO synthesis_backend_stats (backend, completed, total_duration_ms, updated_at)
			VALUES (?, 1, ?, ?)
			ON CONFLICT (backend) DO UPDATE SET completed = completed + 1,
				total_duration_ms = total_duration_ms + excluded.total_duration_ms,
				updated_at = excluded.updated_at`, backend, duration.Milliseconds(), time.Now().UnixMilli()); err != nil {
			return fmt.Errorf("update synthesis backend stats: %w", err)
		}
		return nil
	})
}

func (s *assetStore) cancelSynthesis(ctx context.Context, identity audioIdentity) (bool, error) {
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM synthesis_jobs
		WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?`, identityArguments(identity)...)
	if err != nil {
		return false, fmt.Errorf("cancel synthesis job: %w", err)
	}
	rows, err := result.RowsAffected()
	return rows > 0, err
}

func (s *assetStore) synthesisProgress(ctx context.Context, profile audioIdentity) (synthesisProgress, error) {
	var progress synthesisProgress
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return synthesisProgress{}, fmt.Errorf("begin synthesis progress snapshot: %w", err)
	}
	defer tx.Rollback()
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)
		FROM audio_assets
		WHERE voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ? AND status = 'ready'`,
		profile.voice, profile.format, profile.speedMilli, profile.voiceVersion, profile.modelRevision, profile.profileVersion,
	).Scan(&progress.ready, &progress.totalBytes); err != nil {
		return synthesisProgress{}, fmt.Errorf("count ready synthesis assets: %w", err)
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT state, COUNT(*) FROM synthesis_jobs
		WHERE voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?
		GROUP BY state`, profile.voice, profile.format, profile.speedMilli,
		profile.voiceVersion, profile.modelRevision, profile.profileVersion)
	if err != nil {
		return synthesisProgress{}, fmt.Errorf("count synthesis jobs: %w", err)
	}
	for rows.Next() {
		var state string
		var count int64
		if err := rows.Scan(&state, &count); err != nil {
			rows.Close()
			return synthesisProgress{}, fmt.Errorf("scan synthesis job count: %w", err)
		}
		switch state {
		case jobStateQueued:
			progress.queued = count
		case jobStateLeased:
			progress.running = count
		case jobStateFailed:
			progress.failed = count
		}
	}
	if err := rows.Close(); err != nil {
		return synthesisProgress{}, fmt.Errorf("close synthesis counts: %w", err)
	}
	byBackend := make(map[string]*backendProgress)
	backendFor := func(name string) *backendProgress {
		backend := byBackend[name]
		if backend == nil {
			backend = &backendProgress{backend: name}
			byBackend[name] = backend
		}
		return backend
	}
	statRows, err := tx.QueryContext(ctx, `SELECT backend, completed, failed, total_duration_ms FROM synthesis_backend_stats ORDER BY backend`)
	if err != nil {
		return synthesisProgress{}, fmt.Errorf("query synthesis backend stats: %w", err)
	}
	for statRows.Next() {
		var name string
		var completed, failed int64
		var durationMS int64
		if err := statRows.Scan(&name, &completed, &failed, &durationMS); err != nil {
			statRows.Close()
			return synthesisProgress{}, fmt.Errorf("scan synthesis backend stats: %w", err)
		}
		backend := backendFor(name)
		backend.completed = completed
		backend.failed = failed
		backend.totalDuration = time.Duration(durationMS) * time.Millisecond
	}
	if err := statRows.Close(); err != nil {
		return synthesisProgress{}, fmt.Errorf("close synthesis backend stats: %w", err)
	}

	activeRows, err := tx.QueryContext(ctx, `
		SELECT COALESCE(last_backend, ''), entry_id
		FROM synthesis_jobs
		WHERE voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?
		  AND state = 'leased'
		ORDER BY last_backend, entry_id`, profile.voice, profile.format, profile.speedMilli,
		profile.voiceVersion, profile.modelRevision, profile.profileVersion)
	if err != nil {
		return synthesisProgress{}, fmt.Errorf("query active synthesis backends: %w", err)
	}
	for activeRows.Next() {
		var name, entryID string
		if err := activeRows.Scan(&name, &entryID); err != nil {
			activeRows.Close()
			return synthesisProgress{}, fmt.Errorf("scan active synthesis backend: %w", err)
		}
		if name == "" {
			continue
		}
		backend := backendFor(name)
		backend.running++
		if backend.activeEntryID == "" {
			backend.activeEntryID = entryID
		}
	}
	if err := activeRows.Close(); err != nil {
		return synthesisProgress{}, fmt.Errorf("close active synthesis backends: %w", err)
	}

	failedRows, err := tx.QueryContext(ctx, `
		SELECT COALESCE(last_backend, ''), COALESCE(last_error, '')
		FROM synthesis_jobs
		WHERE voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?
		  AND state = 'failed'
		ORDER BY last_backend, updated_at DESC`, profile.voice, profile.format, profile.speedMilli,
		profile.voiceVersion, profile.modelRevision, profile.profileVersion)
	if err != nil {
		return synthesisProgress{}, fmt.Errorf("query failed synthesis backends: %w", err)
	}
	for failedRows.Next() {
		var name, lastError string
		if err := failedRows.Scan(&name, &lastError); err != nil {
			failedRows.Close()
			return synthesisProgress{}, fmt.Errorf("scan failed synthesis backend: %w", err)
		}
		if name == "" {
			continue
		}
		backend := backendFor(name)
		backend.terminalJobs++
		if backend.lastError == "" {
			backend.lastError = lastError
		}
	}
	if err := failedRows.Close(); err != nil {
		return synthesisProgress{}, fmt.Errorf("close failed synthesis backends: %w", err)
	}

	names := make([]string, 0, len(byBackend))
	for name := range byBackend {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		progress.backends = append(progress.backends, *byBackend[name])
	}
	if err := tx.Commit(); err != nil {
		return synthesisProgress{}, fmt.Errorf("commit synthesis progress snapshot: %w", err)
	}
	return progress, nil
}

type readyQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *assetStore) lookupReady(ctx context.Context, identity audioIdentity) (audioAsset, error) {
	return s.lookupReadyWith(ctx, s.db, identity)
}

func (s *assetStore) lookupReadyWith(ctx context.Context, queryer readyQueryer, identity audioIdentity) (audioAsset, error) {
	row := queryer.QueryRowContext(ctx, `
		SELECT text, text_hash, object_key, etag, size_bytes, updated_at
		FROM audio_assets
		WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?
		  AND status = 'ready'`,
		identity.entryID, identity.voice, identity.format, identity.speedMilli,
		identity.voiceVersion, identity.modelRevision, identity.profileVersion,
	)

	var asset audioAsset
	var updatedAt int64
	asset.identity = identity
	if err := row.Scan(&asset.text, &asset.textHash, &asset.objectKey, &asset.etag, &asset.sizeBytes, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return audioAsset{}, errAudioNotFound
		}
		return audioAsset{}, fmt.Errorf("query audio asset: %w", err)
	}
	asset.updatedAt = time.Unix(updatedAt, 0)
	return asset, nil
}

func (s *assetStore) forEachReady(ctx context.Context, profile audioIdentity, visit func(audioAsset) error) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT entry_id, text, text_hash, object_key, etag, size_bytes, updated_at
		FROM audio_assets
		WHERE voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?
		  AND status = 'ready'
		ORDER BY entry_id`,
		profile.voice, profile.format, profile.speedMilli,
		profile.voiceVersion, profile.modelRevision, profile.profileVersion,
	)
	if err != nil {
		return fmt.Errorf("query ready audio assets: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		asset := audioAsset{identity: profile}
		var updatedAt int64
		if err := rows.Scan(
			&asset.identity.entryID, &asset.text, &asset.textHash,
			&asset.objectKey, &asset.etag, &asset.sizeBytes, &updatedAt,
		); err != nil {
			return fmt.Errorf("scan ready audio asset: %w", err)
		}
		asset.updatedAt = time.Unix(updatedAt, 0)
		if err := visit(asset); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate ready audio assets: %w", err)
	}
	return nil
}

func (s *assetStore) summarizeReady(ctx context.Context, profile audioIdentity) (readyAssetSummary, error) {
	var summary readyAssetSummary
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)
		FROM audio_assets
		WHERE voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?
		  AND status = 'ready'`,
		profile.voice, profile.format, profile.speedMilli,
		profile.voiceVersion, profile.modelRevision, profile.profileVersion,
	).Scan(&summary.count, &summary.totalBytes)
	if err != nil {
		return readyAssetSummary{}, fmt.Errorf("summarize ready audio assets: %w", err)
	}
	return summary, nil
}

func (s *assetStore) markGenerating(ctx context.Context, identity audioIdentity, text, textHash string) error {
	now := time.Now().Unix()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO audio_assets (
			entry_id, text, text_hash, voice_id, format, speed_milli,
			voice_version, model_revision, profile_version,
			status, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', ?, ?)
		ON CONFLICT (
			entry_id, voice_id, format, speed_milli,
			voice_version, model_revision, profile_version
		) DO UPDATE SET
			text = excluded.text,
			text_hash = excluded.text_hash,
			object_key = NULL,
			etag = NULL,
			size_bytes = NULL,
			status = 'generating',
			error_message = NULL,
			updated_at = excluded.updated_at`,
		identity.entryID, text, textHash, identity.voice, identity.format, identity.speedMilli,
		identity.voiceVersion, identity.modelRevision, identity.profileVersion, now, now,
	)
	if err != nil {
		return fmt.Errorf("mark audio generating: %w", err)
	}
	return nil
}

func (s *assetStore) markReady(ctx context.Context, identity audioIdentity, objectKey, etag string, sizeBytes int64) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE audio_assets
		SET object_key = ?, etag = ?, size_bytes = ?, status = 'ready',
		    error_message = NULL, updated_at = ?
		WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?`,
		objectKey, etag, sizeBytes, time.Now().Unix(),
		identity.entryID, identity.voice, identity.format, identity.speedMilli,
		identity.voiceVersion, identity.modelRevision, identity.profileVersion,
	)
	if err != nil {
		return fmt.Errorf("mark audio ready: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return fmt.Errorf("mark audio ready: expected one row, updated %d", rows)
	}
	return nil
}

func (s *assetStore) markFailed(ctx context.Context, identity audioIdentity, message string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE audio_assets
		SET status = 'failed', error_message = ?, updated_at = ?
		WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?`,
		message, time.Now().Unix(),
		identity.entryID, identity.voice, identity.format, identity.speedMilli,
		identity.voiceVersion, identity.modelRevision, identity.profileVersion,
	)
	if err != nil {
		return fmt.Errorf("mark audio failed: %w", err)
	}
	return nil
}

// deleteAsset removes one indexed profile and its corresponding audio object.
// Missing rows and already-removed files are treated as a successful no-op.
func (s *assetStore) deleteAsset(ctx context.Context, identity audioIdentity) (bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT object_key
		FROM audio_assets
		WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?`,
		identity.entryID, identity.voice, identity.format, identity.speedMilli,
		identity.voiceVersion, identity.modelRevision, identity.profileVersion,
	)

	var objectKey sql.NullString
	if err := row.Scan(&objectKey); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("query audio asset for deletion: %w", err)
	}

	if objectKey.Valid && objectKey.String != "" {
		objectPath, err := s.assetPath(objectKey.String)
		if err != nil {
			return false, fmt.Errorf("resolve audio object for deletion: %w", err)
		}
		if err := os.Remove(objectPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return false, fmt.Errorf("remove audio object: %w", err)
		}
	}

	result, err := s.db.ExecContext(ctx, `
		DELETE FROM audio_assets
		WHERE entry_id = ? AND voice_id = ? AND format = ? AND speed_milli = ?
		  AND voice_version = ? AND model_revision = ? AND profile_version = ?`,
		identity.entryID, identity.voice, identity.format, identity.speedMilli,
		identity.voiceVersion, identity.modelRevision, identity.profileVersion,
	)
	if err != nil {
		return false, fmt.Errorf("delete audio asset index: %w", err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read deleted audio asset count: %w", err)
	}
	return deleted > 0, nil
}

func (s *assetStore) assetPath(objectKey string) (string, error) {
	normalizedKey := strings.ReplaceAll(objectKey, `\`, "/")
	parts := strings.Split(normalizedKey, "/")
	if len(parts) != 2 || path.Clean(normalizedKey) != normalizedKey {
		return "", fmt.Errorf("invalid audio object key")
	}
	kind, filename := parts[0], parts[1]
	extension := path.Ext(filename)
	id := strings.TrimSuffix(filename, extension)
	format := strings.TrimPrefix(extension, ".")
	if !validEntryPart(kind, id) || (format != "m4a" && format != "aac" && format != "opus") {
		return "", fmt.Errorf("invalid audio object key")
	}
	return filepath.Join(s.audioDir, kind, filename), nil
}

func (s *assetStore) validateReadyFile(asset audioAsset) error {
	objectPath, err := s.assetPath(asset.objectKey)
	if err != nil {
		return err
	}
	file, err := os.Open(objectPath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != asset.sizeBytes {
		return fmt.Errorf("audio object size does not match index")
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("hash audio object: %w", err)
	}
	if hex.EncodeToString(hash.Sum(nil)) != asset.etag {
		return fmt.Errorf("audio object SHA-256 does not match index")
	}
	return nil
}

func audioObjectKey(entryID, format string) (string, error) {
	kind, id, ok := strings.Cut(entryID, ":")
	if !ok || !validEntryPart(kind, id) || (format != "m4a" && format != "aac" && format != "opus") {
		return "", fmt.Errorf("invalid audio object identity")
	}
	return kind + "/" + id + "." + format, nil
}
