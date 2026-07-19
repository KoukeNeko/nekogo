package main

import (
	"path/filepath"
	"testing"
)

func TestAudioObjectKeyUsesReadableEntryLayout(t *testing.T) {
	t.Parallel()

	tests := []struct {
		entryID string
		format  string
		want    string
	}{
		{entryID: "example:231", format: "m4a", want: "example/231.m4a"},
		{entryID: "vocab:1001720", format: "m4a", want: "vocab/1001720.m4a"},
		{entryID: "vocab:t-ありがとう-ありがとう", format: "m4a", want: "vocab/t-ありがとう-ありがとう.m4a"},
	}
	for _, test := range tests {
		got, err := audioObjectKey(test.entryID, test.format)
		if err != nil || got != test.want {
			t.Fatalf("audioObjectKey(%q, %q) = %q, %v; want %q", test.entryID, test.format, got, err, test.want)
		}
	}
}

func TestAssetPathAcceptsOnlyEntryLayout(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	store := &assetStore{audioDir: root}
	got, err := store.assetPath("example/231.m4a")
	if err != nil || got != filepath.Join(root, "example", "231.m4a") {
		t.Fatalf("assetPath = %q, %v", got, err)
	}

	for _, objectKey := range []string{
		"231.m4a",
		"ab/hash.m4a",
		"example/../231.m4a",
		"kanji/願.m4a",
		"example/not-a-number.m4a",
	} {
		if _, err := store.assetPath(objectKey); err == nil {
			t.Fatalf("assetPath(%q) unexpectedly succeeded", objectKey)
		}
	}
}
