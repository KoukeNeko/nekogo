package main

import (
	"strings"
	"testing"
	"time"
)

func TestRenderStatusLineClampsProgressAndShowsBackends(t *testing.T) {
	line := renderStatusLine(statusView{
		ready: 12, expected: 10, queued: 3, running: 2, failed: 1,
		perMinute: 6,
		workers: []workerStatusView{
			{displayName: "RTX 4070 Ti", completed: 7, perMinute: 4},
			{displayName: "i7-12700K", completed: 5, perMinute: 2},
		},
	}, 10)
	for _, expected := range []string{
		"[██████████]", "12/10 100.00%", "queue 3 running 2 failed 1",
		"RTX 4070 Ti 7 4.00/min", "i7-12700K 5 2.00/min", "6.00/min ETA 完了",
	} {
		if !strings.Contains(line, expected) {
			t.Fatalf("status line %q does not contain %q", line, expected)
		}
	}
}

func TestRenderStatusDashboardShowsDetailedWorkerActivity(t *testing.T) {
	dashboard := renderStatusDashboard(statusView{
		ready: 25, expected: 100, queued: 73, running: 2, totalBytes: 5 * 1024 * 1024,
		perMinute: 3,
		workers: []workerStatusView{
			{displayName: "RTX 4070 Ti", kind: "gpu", running: 1, activeEntryID: "example:42", completed: 20, perMinute: 2, averageDuration: 30 * time.Second},
			{displayName: "RTX 2070", kind: "gpu", running: 1, activeEntryID: "vocab:7", completed: 5, perMinute: 1, averageDuration: time.Minute, failed: 1, terminalJobs: 1, lastError: "temporary upstream error"},
			{displayName: "Nothing Phone (3)", kind: "android", running: 1, activeEntryID: "vocab:9", completed: 1, perMinute: 0.5, averageDuration: 2 * time.Minute},
		},
		updatedAt: time.Date(2026, 7, 20, 1, 2, 3, 0, time.Local),
	}, 12)
	for _, expected := range []string{
		"Overall  [███░░░░░░░░░]  25.00%",
		"25 / 100 ready · 75 remaining · 5.0 MiB",
		"RTX 4070 Ti        RUN  GPU         example:42",
		"RTX 2070           RUN  GPU         vocab:7",
		"Nothing Phone (3)  RUN  ANDROID     vocab:9",
		"completed 5 · 1.00/min · avg 1.0m · failures 1 total · 1 unresolved",
		"last error: temporary upstream error",
		"updated 01:02:03",
	} {
		if !strings.Contains(dashboard, expected) {
			t.Fatalf("dashboard does not contain %q:\n%s", expected, dashboard)
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
