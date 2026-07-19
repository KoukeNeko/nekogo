package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"strings"
	"time"
)

type workerStatusView struct {
	id              string
	displayName     string
	kind            string
	completed       int64
	failed          int64
	terminalJobs    int64
	running         int64
	activeEntryID   string
	lastError       string
	averageDuration time.Duration
	perMinute       float64
}

type statusView struct {
	ready      int64
	expected   int64
	queued     int64
	running    int64
	failed     int64
	totalBytes int64
	perMinute  float64
	workers    []workerStatusView
	updatedAt  time.Time
}

func runStatus(ctx context.Context, args []string, cfg config, service *audioService, output io.Writer) error {
	flags := flag.NewFlagSet("status", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	once := flags.Bool("once", false, "print one status snapshot and exit")
	interval := flags.Duration("interval", 2*time.Second, "refresh interval")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *interval < 250*time.Millisecond {
		return fmt.Errorf("status interval must be at least 250ms")
	}

	terminal := writerIsTerminal(output)
	previousLines := 0
	for {
		view, err := loadStatusView(ctx, cfg, service)
		if err != nil {
			return err
		}
		if terminal && !*once {
			previousLines, err = writeStatusDashboard(output, renderStatusDashboard(view, 42), previousLines)
		} else {
			_, err = fmt.Fprintf(output, "%s %s\n", view.updatedAt.Format(time.RFC3339), renderStatusLine(view, 28))
		}
		if err != nil {
			return err
		}
		if *once || (view.expected > 0 && view.ready >= view.expected) {
			return nil
		}

		timer := time.NewTimer(*interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

func loadStatusView(ctx context.Context, cfg config, service *audioService) (statusView, error) {
	progress, expected, err := service.synthesisProgress(ctx, cfg.defaultVoice, cfg.defaultFormat, cfg.defaultSpeed)
	if err != nil {
		return statusView{}, err
	}
	view := statusView{
		ready:      progress.ready,
		expected:   expected,
		queued:     progress.queued,
		running:    progress.running,
		failed:     progress.failed,
		totalBytes: progress.totalBytes,
		updatedAt:  time.Now(),
	}
	progressByID := make(map[string]backendProgress, len(progress.backends))
	for _, backend := range progress.backends {
		progressByID[backend.backend] = backend
	}
	seen := make(map[string]struct{})
	appendWorker := func(id, displayName, kind string) {
		backend := progressByID[id]
		worker := workerStatusView{
			id:            id,
			displayName:   displayName,
			kind:          kind,
			completed:     backend.completed,
			failed:        backend.failed,
			terminalJobs:  backend.terminalJobs,
			running:       backend.running,
			activeEntryID: backend.activeEntryID,
			lastError:     backend.lastError,
		}
		if backend.completed > 0 && backend.totalDuration > 0 {
			worker.averageDuration = backend.totalDuration / time.Duration(backend.completed)
			worker.perMinute = float64(backend.completed) / backend.totalDuration.Minutes()
			view.perMinute += worker.perMinute
		}
		view.workers = append(view.workers, worker)
		seen[id] = struct{}{}
	}
	if cfg.irodoriAPIMode == "gradio" {
		for _, backend := range cfg.gradioBackendConfigs() {
			appendWorker(backend.id, backend.displayName, backend.kind)
		}
	} else {
		appendWorker("primary", "Primary API", "api")
	}
	for _, backend := range progress.backends {
		if _, ok := seen[backend.backend]; !ok {
			displayName, kind := backendPresentation(backend.backend)
			appendWorker(backend.backend, displayName, kind)
		}
	}
	return view, nil
}

func renderStatusLine(view statusView, width int) string {
	ratio := progressRatio(view)
	workerParts := make([]string, 0, len(view.workers))
	for _, worker := range view.workers {
		workerParts = append(workerParts, fmt.Sprintf("%s %d %.2f/min", worker.displayName, worker.completed, worker.perMinute))
	}
	return fmt.Sprintf(
		"[%s] %d/%d %.2f%% | queue %d running %d failed %d | %s | %.2f/min ETA %s",
		renderProgressBar(ratio, width), view.ready, view.expected, ratio*100,
		view.queued, view.running, view.failed,
		strings.Join(workerParts, " · "), view.perMinute, statusETA(view),
	)
}

func renderStatusDashboard(view statusView, width int) string {
	ratio := progressRatio(view)
	remaining := view.expected - view.ready
	if remaining < 0 {
		remaining = 0
	}
	lines := []string{
		"Dictionary Audio Generation",
		fmt.Sprintf("Overall  [%s] %6.2f%%", renderProgressBar(ratio, width), ratio*100),
		fmt.Sprintf("         %d / %d ready · %d remaining · %s", view.ready, view.expected, remaining, formatByteCount(view.totalBytes)),
		fmt.Sprintf("Queue    %d queued · %d running · %d failed", view.queued, view.running, view.failed),
		fmt.Sprintf("Speed    %.2f/min aggregate · ETA %s", view.perMinute, statusETA(view)),
		"",
		"Workers",
	}
	for _, worker := range view.workers {
		state := "IDLE"
		activity := "waiting for work"
		if worker.running > 0 {
			state = "RUN"
			activity = worker.activeEntryID
		}
		lines = append(lines,
			fmt.Sprintf("%-13s %-4s %-11s %s", worker.displayName, state, strings.ToUpper(worker.kind), activity),
			fmt.Sprintf("  completed %d · %.2f/min · avg %s · failures %d total · %d unresolved",
				worker.completed, worker.perMinute, formatAverageDuration(worker.averageDuration), worker.failed, worker.terminalJobs),
		)
		if worker.lastError != "" {
			lines = append(lines, "  last error: "+truncateStatusText(worker.lastError, 100))
		}
	}
	lines = append(lines, "", "Ctrl-C stops this monitor only · updated "+view.updatedAt.Format("15:04:05"))
	return strings.Join(lines, "\n")
}

func writeStatusDashboard(output io.Writer, dashboard string, previousLines int) (int, error) {
	lines := strings.Split(dashboard, "\n")
	if previousLines > 0 {
		if _, err := fmt.Fprintf(output, "\x1b[%dA", previousLines); err != nil {
			return previousLines, err
		}
	}
	lineCount := len(lines)
	if previousLines > lineCount {
		lineCount = previousLines
	}
	for index := 0; index < lineCount; index++ {
		line := ""
		if index < len(lines) {
			line = lines[index]
		}
		if _, err := fmt.Fprintf(output, "\r\x1b[2K%s\n", line); err != nil {
			return previousLines, err
		}
	}
	return lineCount, nil
}

func progressRatio(view statusView) float64 {
	ratio := 0.0
	if view.expected > 0 {
		ratio = float64(view.ready) / float64(view.expected)
	}
	return math.Max(0, math.Min(1, ratio))
}

func renderProgressBar(ratio float64, width int) string {
	if width < 1 {
		width = 1
	}
	ratio = math.Max(0, math.Min(1, ratio))
	filled := int(math.Round(ratio * float64(width)))
	return strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
}

func statusETA(view statusView) string {
	remaining := view.expected - view.ready
	if remaining <= 0 && view.expected > 0 {
		return "完了"
	}
	if view.perMinute > 0 && remaining > 0 {
		return formatETA(time.Duration(float64(remaining) / view.perMinute * float64(time.Minute)))
	}
	return "—"
}

func formatETA(value time.Duration) string {
	if value < time.Minute {
		return "<1m"
	}
	value = value.Round(time.Minute)
	days := value / (24 * time.Hour)
	value -= days * 24 * time.Hour
	hours := value / time.Hour
	value -= hours * time.Hour
	minutes := value / time.Minute
	if days > 0 {
		return fmt.Sprintf("%dd%dh", days, hours)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh%dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}

func formatAverageDuration(value time.Duration) string {
	if value <= 0 {
		return "—"
	}
	if value < time.Minute {
		return fmt.Sprintf("%.1fs", value.Seconds())
	}
	return fmt.Sprintf("%.1fm", value.Minutes())
}

func formatByteCount(value int64) string {
	if value < 1024 {
		return fmt.Sprintf("%d B", value)
	}
	units := []string{"KiB", "MiB", "GiB", "TiB"}
	size := float64(value)
	unit := "B"
	for _, candidate := range units {
		size /= 1024
		unit = candidate
		if size < 1024 {
			break
		}
	}
	return fmt.Sprintf("%.1f %s", size, unit)
}

func truncateStatusText(value string, limit int) string {
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit-1]) + "…"
}

func writerIsTerminal(output io.Writer) bool {
	file, ok := output.(*os.File)
	if !ok {
		return false
	}
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}
