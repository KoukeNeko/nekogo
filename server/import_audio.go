package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

func runImport(ctx context.Context, args []string, cfg config, service *audioService, overrides map[string]string, logger *slog.Logger) error {
	flags := flag.NewFlagSet("import", flag.ContinueOnError)
	manifestPath := flags.String("manifest", "", "JSONL manifest containing entry_id, text, and file")
	force := flags.Bool("force", false, "replace assets that are already ready")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *manifestPath == "" || *manifestPath == "-" {
		return fmt.Errorf("import requires a file-backed -manifest <path>")
	}

	manifest, err := os.Open(*manifestPath)
	if err != nil {
		return fmt.Errorf("open import manifest: %w", err)
	}
	defer manifest.Close()
	manifestDir := filepath.Dir(*manifestPath)

	scanner := bufio.NewScanner(manifest)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	lineNumber := 0
	imported := 0
	skipped := 0
	failed := 0
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		var entry manifestEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			failed++
			logger.Error("invalid import entry", "line", lineNumber, "error", err)
			continue
		}
		entry.EntryID = strings.TrimSpace(entry.EntryID)
		entry.Text = normalizeText(entry.Text)
		entry.Voice = strings.TrimSpace(entry.Voice)
		entry.Format = strings.ToLower(strings.TrimSpace(entry.Format))
		entry.File = strings.TrimSpace(entry.File)
		if entry.Voice == "" {
			entry.Voice = cfg.defaultVoice
		}
		if entry.Format == "" {
			entry.Format = cfg.defaultFormat
		}
		if entry.Speed == 0 {
			entry.Speed = cfg.defaultSpeed
		}
		if override, ok := overrides[entry.EntryID]; ok {
			entry.Text = override
		}
		if err := validateManifestEntry(entry, cfg.approvedVoices); err != nil {
			failed++
			logger.Error("invalid import entry", "line", lineNumber, "entry_id", entry.EntryID, "error", err)
			continue
		}
		if entry.File == "" {
			failed++
			logger.Error("invalid import entry", "line", lineNumber, "entry_id", entry.EntryID, "error", "file is required")
			continue
		}
		path := entry.File
		if !filepath.IsAbs(path) {
			path = filepath.Join(manifestDir, path)
		}
		audio, err := os.ReadFile(path)
		if err != nil {
			failed++
			logger.Error("read import audio", "line", lineNumber, "entry_id", entry.EntryID, "path", path, "error", err)
			continue
		}
		result, err := service.importAudio(ctx, synthesisRequest{
			entryID: entry.EntryID,
			text:    entry.Text,
			voice:   entry.Voice,
			format:  entry.Format,
			speed:   entry.Speed,
		}, audio, *force)
		if err != nil {
			failed++
			logger.Error("import audio", "line", lineNumber, "entry_id", entry.EntryID, "error", err)
			continue
		}
		if result.skipped {
			skipped++
		} else {
			imported++
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read import manifest: %w", err)
	}
	logger.Info("import complete", "imported", imported, "skipped", skipped, "failed", failed)
	if failed > 0 {
		return fmt.Errorf("import finished with %d failed entries", failed)
	}
	return nil
}
