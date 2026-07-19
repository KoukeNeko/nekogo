package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
)

type manifestEntry struct {
	EntryID  string  `json:"entry_id"`
	Text     string  `json:"text"`
	File     string  `json:"file,omitempty"`
	Voice    string  `json:"voice,omitempty"`
	Format   string  `json:"format,omitempty"`
	Speed    float64 `json:"speed,omitempty"`
	Priority *int64  `json:"priority,omitempty"`
}

func runPrewarm(ctx context.Context, args []string, cfg config, service *audioService, overrides map[string]string, logger *slog.Logger) error {
	flags := flag.NewFlagSet("prewarm", flag.ContinueOnError)
	manifestPath := flags.String("manifest", "", "JSONL manifest path, or - for stdin")
	force := flags.Bool("force", false, "regenerate assets that are already ready")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *manifestPath == "" {
		return fmt.Errorf("prewarm requires -manifest <path>")
	}

	reader, closeReader, err := openManifest(*manifestPath)
	if err != nil {
		return err
	}
	defer closeReader()

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	lineNumber := 0
	ready := 0
	queued := 0
	alreadyQueued := 0
	failed := 0
	processed := 0
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
			logger.Error("invalid manifest entry", "line", lineNumber, "error", err)
			continue
		}
		entry.EntryID = strings.TrimSpace(entry.EntryID)
		entry.Text = normalizeText(entry.Text)
		entry.Voice = strings.TrimSpace(entry.Voice)
		entry.Format = strings.ToLower(strings.TrimSpace(entry.Format))
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
			logger.Error("invalid manifest entry", "line", lineNumber, "entry_id", entry.EntryID, "error", err)
			continue
		}
		priority := int64(100000 + lineNumber)
		if entry.Priority != nil {
			priority = *entry.Priority
		}
		result, err := service.enqueueAudio(ctx, synthesisRequest{
			entryID: entry.EntryID,
			text:    entry.Text,
			voice:   entry.Voice,
			format:  entry.Format,
			speed:   entry.Speed,
		}, priority, *force)
		if err != nil {
			failed++
			logger.Error("pre-generate audio", "line", lineNumber, "entry_id", entry.EntryID, "error", err)
			continue
		}
		switch result.disposition {
		case enqueueReady:
			ready++
			logger.Info("audio already ready", "entry_id", entry.EntryID)
		case enqueueAlreadyQueued:
			alreadyQueued++
		case enqueueQueued:
			queued++
		}
		processed++
		if processed%100 == 0 {
			logger.Info("prewarm enqueue progress", "processed", processed, "ready", ready,
				"queued", queued, "already_queued", alreadyQueued, "invalid", failed)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read manifest: %w", err)
	}
	logger.Info("prewarm enqueue complete", "processed", processed, "ready", ready,
		"queued", queued, "already_queued", alreadyQueued, "invalid", failed)
	if failed > 0 {
		return fmt.Errorf("prewarm finished with %d failed entries", failed)
	}
	return nil
}

func validateManifestEntry(entry manifestEntry, approvedVoices map[string]struct{}) error {
	kind, id, ok := strings.Cut(entry.EntryID, ":")
	if !ok || !validEntryPart(kind, id) {
		return fmt.Errorf("entry_id must be vocab:<id> or example:<id>")
	}
	if entry.Text == "" || len(entry.Text) > 4000 {
		return fmt.Errorf("text is required and must not exceed 4000 bytes")
	}
	if _, ok := approvedVoices[entry.Voice]; !ok {
		return fmt.Errorf("voice is not approved")
	}
	if entry.Format != "m4a" && entry.Format != "aac" && entry.Format != "opus" {
		return fmt.Errorf("format must be m4a, aac, or opus")
	}
	if entry.Speed < 0.8 || entry.Speed > 1.2 {
		return fmt.Errorf("speed must be between 0.8 and 1.2")
	}
	if entry.Priority != nil && *entry.Priority < 0 {
		return fmt.Errorf("priority cannot be negative")
	}
	return nil
}

func openManifest(path string) (io.Reader, func(), error) {
	if path == "-" {
		return os.Stdin, func() {}, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, func() {}, fmt.Errorf("open manifest: %w", err)
	}
	return file, func() { _ = file.Close() }, nil
}
