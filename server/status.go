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

type statusView struct {
	ready        int64
	expected     int64
	queued       int64
	running      int64
	failed       int64
	gpuCompleted int64
	cpuCompleted int64
	perMinute    float64
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
	for {
		view, err := loadStatusView(ctx, cfg, service)
		if err != nil {
			return err
		}
		line := renderStatusLine(view, 28)
		if terminal && !*once {
			if _, err := fmt.Fprintf(output, "\r\x1b[2K%s", line); err != nil {
				return err
			}
		} else {
			if _, err := fmt.Fprintf(output, "%s %s\n", time.Now().Format(time.RFC3339), line); err != nil {
				return err
			}
		}
		if *once || (view.expected > 0 && view.ready >= view.expected) {
			if terminal && !*once {
				_, _ = fmt.Fprintln(output)
			}
			return nil
		}

		timer := time.NewTimer(*interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			if terminal && !*once {
				_, _ = fmt.Fprintln(output)
			}
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
		ready:    progress.ready,
		expected: expected,
		queued:   progress.queued,
		running:  progress.running,
		failed:   progress.failed,
	}
	for _, backend := range progress.backends {
		if backend.totalDuration > 0 && backend.completed > 0 {
			view.perMinute += float64(backend.completed) / backend.totalDuration.Minutes()
		}
		switch backend.backend {
		case "gpu":
			view.gpuCompleted = backend.completed
		case "cpu":
			view.cpuCompleted = backend.completed
		}
	}
	return view, nil
}

func renderStatusLine(view statusView, width int) string {
	if width < 1 {
		width = 1
	}
	ratio := 0.0
	if view.expected > 0 {
		ratio = float64(view.ready) / float64(view.expected)
	}
	ratio = math.Max(0, math.Min(1, ratio))
	filled := int(math.Round(ratio * float64(width)))
	bar := strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
	eta := "—"
	remaining := view.expected - view.ready
	if remaining <= 0 && view.expected > 0 {
		eta = "完了"
	} else if view.perMinute > 0 && remaining > 0 {
		eta = formatETA(time.Duration(float64(remaining) / view.perMinute * float64(time.Minute)))
	}
	return fmt.Sprintf(
		"[%s] %d/%d %.2f%% | queue %d running %d failed %d | GPU %d CPU %d | %.2f/min ETA %s",
		bar, view.ready, view.expected, ratio*100,
		view.queued, view.running, view.failed,
		view.gpuCompleted, view.cpuCompleted, view.perMinute, eta,
	)
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

func writerIsTerminal(output io.Writer) bool {
	file, ok := output.(*os.File)
	if !ok {
		return false
	}
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}
