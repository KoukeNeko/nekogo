package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func TestGradioClientGeneratesDownloadsAndTranscodes(t *testing.T) {
	for _, runtime := range []struct {
		name           string
		modelDevice    string
		modelPrecision string
		codecDevice    string
		codecPrecision string
	}{
		{name: "gpu", modelDevice: "cuda", modelPrecision: "fp32", codecDevice: "cuda", codecPrecision: "fp32"},
		{name: "cpu", modelDevice: "cpu", modelPrecision: "fp32", codecDevice: "cpu", codecPrecision: "fp32"},
	} {
		runtime := runtime
		t.Run(runtime.name, func(t *testing.T) {
			t.Parallel()
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				switch request.URL.Path {
				case "/gradio_api/call/_run_generation":
					var payload struct {
						Data []any `json:"data"`
					}
					if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
						t.Errorf("decode Gradio request: %v", err)
						http.Error(response, "bad body", http.StatusBadRequest)
						return
					}
					want := expectedGenerationParameters(runtime.modelDevice, runtime.modelPrecision, runtime.codecDevice, runtime.codecPrecision)
					if !reflect.DeepEqual(payload.Data, want) {
						t.Errorf("Gradio payload = %#v, want %#v", payload.Data, want)
					}
					_, _ = response.Write([]byte(`{"event_id":"event-1"}`))
				case "/gradio_api/call/_run_generation/event-1":
					response.Header().Set("Content-Type", "text/event-stream")
					_, _ = response.Write([]byte("event: complete\ndata: [{\"value\":{\"url\":\"" + server.URL + "/gradio_api/file=audio.wav\"}}]\n\n"))
				case "/gradio_api/file=audio.wav":
					_, _ = response.Write([]byte("wav-audio"))
				default:
					http.NotFound(response, request)
				}
			}))
			defer server.Close()

			client := &gradioClient{
				baseURL:        server.URL,
				checkpoint:     "Aratako/Irodori-TTS-500M-v3",
				modelDevice:    runtime.modelDevice,
				modelPrecision: runtime.modelPrecision,
				codecDevice:    runtime.codecDevice,
				codecPrecision: runtime.codecPrecision,
				numSteps:       60,
				ffmpegPath:     "ffmpeg",
				maxAudioSize:   1024,
				httpClient:     &http.Client{Timeout: 2 * time.Second},
				transcode: func(_ context.Context, wav []byte, format string) ([]byte, error) {
					if string(wav) != "wav-audio" || format != "opus" {
						t.Fatalf("transcode input=%q format=%q", wav, format)
					}
					return []byte("opus-audio"), nil
				},
			}
			audio, err := client.synthesize(context.Background(), synthesisRequest{
				entryID: "vocab:1318610",
				text:    "自分",
				voice:   "dictionary-ja-01",
				format:  "opus",
				speed:   1,
				seed:    1318610,
			})
			if err != nil {
				t.Fatalf("synthesize: %v", err)
			}
			if string(audio) != "opus-audio" {
				t.Fatalf("audio = %q", audio)
			}
		})
	}
}

func expectedGenerationParameters(modelDevice, modelPrecision, codecDevice, codecPrecision string) []any {
	return []any{
		"Aratako/Irodori-TTS-500M-v3",
		modelDevice, modelPrecision,
		codecDevice, codecPrecision,
		"自分",
		nil, nil, "",
		float64(60),
		float64(1),
		"1318610",
		"",
		float64(1),
		"linear",
		float64(-1),
		"independent",
		float64(3),
		float64(5),
		"",
		float64(0.5),
		float64(1),
		true,
		"", "", "", "",
		float64(0.9),
		"", "",
	}
}

func TestOpusTranscodeArgumentsUseCompactSpeechProfile(t *testing.T) {
	t.Parallel()

	got := transcodeArguments("input.wav", "output.opus", "opus")
	want := []string{
		"-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", "input.wav",
		"-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-vbr", "on",
		"-application", "voip", "-compression_level", "10", "-frame_duration", "60",
		"-f", "ogg", "output.opus",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("transcode arguments = %#v, want %#v", got, want)
	}
}
