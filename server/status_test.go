package main

import (
	"strings"
	"testing"
	"time"
)

func TestRenderStatusLineClampsProgressAndShowsBackends(t *testing.T) {
	line := renderStatusLine(statusView{
		ready: 12, expected: 10, queued: 3, running: 2, failed: 1,
		gpuCompleted: 7, cpuCompleted: 5, perMinute: 6,
	}, 10)
	for _, expected := range []string{
		"[██████████]", "12/10 100.00%", "queue 3 running 2 failed 1",
		"GPU 7 CPU 5", "6.00/min ETA 完了",
	} {
		if !strings.Contains(line, expected) {
			t.Fatalf("status line %q does not contain %q", line, expected)
		}
	}
}

func TestRenderStatusLineHandlesUnknownTotal(t *testing.T) {
	line := renderStatusLine(statusView{}, 4)
	if !strings.Contains(line, "[░░░░] 0/0 0.00%") || !strings.Contains(line, "ETA —") {
		t.Fatalf("unexpected zero-total status: %q", line)
	}
}

func TestFormatETA(t *testing.T) {
	for _, test := range []struct {
		value time.Duration
		want  string
	}{
		{30 * time.Second, "<1m"},
		{90 * time.Minute, "1h30m"},
		{50*time.Hour + 15*time.Minute, "2d2h"},
	} {
		if got := formatETA(test.value); got != test.want {
			t.Fatalf("formatETA(%v) = %q, want %q", test.value, got, test.want)
		}
	}
}
