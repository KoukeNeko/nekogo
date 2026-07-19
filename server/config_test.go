package main

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestLoadConfigUsesLegacyGPUURLFallbackAndCPUSettings(t *testing.T) {
	setValidGradioEnvironment(t)
	t.Setenv("IRODORI_BASE_URL", "http://legacy-gpu.example:7860/")
	t.Setenv("IRODORI_GPU_BASE_URL", "")
	t.Setenv("IRODORI_CPU_ENABLED", "true")
	t.Setenv("IRODORI_CPU_BASE_URL", "http://cpu.example:7862/")
	t.Setenv("IRODORI_GPU2_ENABLED", "true")
	t.Setenv("IRODORI_GPU2_BASE_URL", "https://gpu2.example/")
	t.Setenv("CPU_MAX_TEXT_RUNES", "24")

	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if cfg.irodoriGPUBaseURL != "http://legacy-gpu.example:7860" {
		t.Fatalf("GPU base URL = %q", cfg.irodoriGPUBaseURL)
	}
	if !cfg.irodoriCPUEnabled || cfg.irodoriCPUBaseURL != "http://cpu.example:7862" || cfg.cpuMaxTextRunes != 24 {
		t.Fatalf("unexpected CPU config: enabled=%t url=%q max_runes=%d", cfg.irodoriCPUEnabled, cfg.irodoriCPUBaseURL, cfg.cpuMaxTextRunes)
	}
	if !cfg.irodoriGPU2Enabled || cfg.irodoriGPU2BaseURL != "https://gpu2.example" || cfg.irodoriGPU2Name != "RTX 2070" {
		t.Fatalf("unexpected second GPU config: enabled=%t name=%q url=%q", cfg.irodoriGPU2Enabled, cfg.irodoriGPU2Name, cfg.irodoriGPU2BaseURL)
	}
	if cfg.irodoriGPUModelDevice != "cuda" || cfg.irodoriGPUModelPrecision != "fp32" || cfg.irodoriGPUCodecDevice != "cuda" || cfg.irodoriGPUCodecPrecision != "fp32" {
		t.Fatalf("unexpected GPU runtime config: %#v", cfg)
	}
	if cfg.irodoriCPUModelDevice != "cpu" || cfg.irodoriCPUModelPrecision != "fp32" || cfg.irodoriCPUCodecDevice != "cpu" || cfg.irodoriCPUCodecPrecision != "fp32" {
		t.Fatalf("unexpected CPU runtime config: %#v", cfg)
	}
}

func TestLoadConfigRejectsInvalidBackendSettings(t *testing.T) {
	tests := []struct {
		name      string
		configure func(*testing.T)
		wantError string
	}{
		{
			name: "invalid GPU URL",
			configure: func(t *testing.T) {
				t.Setenv("IRODORI_GPU_BASE_URL", "localhost:7860")
			},
			wantError: "IRODORI_GPU_BASE_URL",
		},
		{
			name: "unsupported GPU device",
			configure: func(t *testing.T) {
				t.Setenv("IRODORI_GPU_MODEL_DEVICE", "metal")
			},
			wantError: "IRODORI_GPU_MODEL_DEVICE",
		},
		{
			name: "unsupported GPU precision",
			configure: func(t *testing.T) {
				t.Setenv("IRODORI_GPU_CODEC_PRECISION", "fp16")
			},
			wantError: "IRODORI_GPU_CODEC_PRECISION",
		},
		{
			name: "CPU bf16",
			configure: func(t *testing.T) {
				t.Setenv("IRODORI_CPU_ENABLED", "true")
				t.Setenv("IRODORI_CPU_MODEL_PRECISION", "bf16")
			},
			wantError: "IRODORI_CPU_MODEL_PRECISION cannot be bf16",
		},
		{
			name: "invalid second GPU enable flag",
			configure: func(t *testing.T) {
				t.Setenv("IRODORI_GPU2_ENABLED", "sometimes")
			},
			wantError: "IRODORI_GPU2_ENABLED is invalid",
		},
		{
			name: "missing second GPU URL",
			configure: func(t *testing.T) {
				t.Setenv("IRODORI_GPU2_ENABLED", "true")
				t.Setenv("IRODORI_GPU2_BASE_URL", "")
			},
			wantError: "IRODORI_GPU2_BASE_URL",
		},
		{
			name: "invalid CPU enable flag",
			configure: func(t *testing.T) {
				t.Setenv("IRODORI_CPU_ENABLED", "sometimes")
			},
			wantError: "IRODORI_CPU_ENABLED is invalid",
		},
		{
			name: "zero CPU text limit",
			configure: func(t *testing.T) {
				t.Setenv("IRODORI_CPU_ENABLED", "true")
				t.Setenv("CPU_MAX_TEXT_RUNES", "0")
			},
			wantError: "CPU_MAX_TEXT_RUNES must be at least 1",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			setValidGradioEnvironment(t)
			test.configure(t)
			_, err := loadConfig()
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("loadConfig error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func TestLoadConfigOpenAIModeIgnoresDualGradioSettings(t *testing.T) {
	t.Setenv("IRODORI_API_MODE", "openai")
	t.Setenv("IRODORI_BASE_URL", "http://openai.example:8088")
	t.Setenv("IRODORI_CPU_ENABLED", "not-a-boolean")
	t.Setenv("IRODORI_GPU2_ENABLED", "not-a-boolean")
	t.Setenv("IRODORI_GPU_BASE_URL", "not-a-url")
	t.Setenv("IRODORI_CPU_BASE_URL", "not-a-url")
	t.Setenv("IRODORI_GPU_MODEL_DEVICE", "not-a-device")
	t.Setenv("IRODORI_CPU_MODEL_DEVICE", "not-a-device")
	t.Setenv("CPU_MAX_TEXT_RUNES", "-1")

	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if cfg.irodoriAPIMode != "openai" || cfg.irodoriCPUEnabled {
		t.Fatalf("unexpected OpenAI config: mode=%q cpu_enabled=%t", cfg.irodoriAPIMode, cfg.irodoriCPUEnabled)
	}
}

func TestConfiguredSynthesisBackends(t *testing.T) {
	httpClient := &http.Client{Timeout: time.Minute}
	cfg := config{
		irodoriAPIMode:            "gradio",
		irodoriGPUName:            "RTX 4070 Ti",
		irodoriGPUBaseURL:         "http://gpu.example:7860",
		irodoriGPUModelDevice:     "cuda",
		irodoriGPUModelPrecision:  "fp32",
		irodoriGPUCodecDevice:     "cuda",
		irodoriGPUCodecPrecision:  "fp32",
		irodoriGPU2Enabled:        true,
		irodoriGPU2Name:           "RTX 2070",
		irodoriGPU2BaseURL:        "https://gpu2.example",
		irodoriGPU2ModelDevice:    "cuda",
		irodoriGPU2ModelPrecision: "fp32",
		irodoriGPU2CodecDevice:    "cuda",
		irodoriGPU2CodecPrecision: "fp32",
		irodoriCPUEnabled:         true,
		irodoriCPUName:            "i7-12700K",
		irodoriCPUBaseURL:         "http://cpu.example:7862",
		irodoriCPUModelDevice:     "cpu",
		irodoriCPUModelPrecision:  "fp32",
		irodoriCPUCodecDevice:     "cpu",
		irodoriCPUCodecPrecision:  "fp32",
		cpuMaxTextRunes:           20,
		irodoriCheckpoint:         "checkpoint",
		numSteps:                  60,
		ffmpegPath:                "ffmpeg",
		maxAudioBytes:             1024,
	}

	backends, err := configuredSynthesisBackends(cfg, httpClient)
	if err != nil {
		t.Fatalf("configuredSynthesisBackends: %v", err)
	}
	if len(backends) != 3 || backends[0].name != "gpu" || backends[0].displayName != "RTX 4070 Ti" || backends[0].maxTextRunes != 0 || backends[1].name != "cpu" || backends[1].displayName != "i7-12700K" || backends[1].maxTextRunes != 20 || backends[2].name != "gpu2" || backends[2].displayName != "RTX 2070" || backends[2].maxTextRunes != 0 {
		t.Fatalf("unexpected backends: %#v", backends)
	}
	gpu, ok := backends[0].client.(*gradioClient)
	if !ok || gpu.baseURL != cfg.irodoriGPUBaseURL || gpu.modelDevice != "cuda" || gpu.codecDevice != "cuda" || gpu.httpClient != httpClient {
		t.Fatalf("unexpected GPU client: %#v", backends[0].client)
	}
	cpu, ok := backends[1].client.(*gradioClient)
	if !ok || cpu.baseURL != cfg.irodoriCPUBaseURL || cpu.modelDevice != "cpu" || cpu.codecDevice != "cpu" || cpu.httpClient != httpClient {
		t.Fatalf("unexpected CPU client: %#v", backends[1].client)
	}
	gpu2, ok := backends[2].client.(*gradioClient)
	if !ok || gpu2.baseURL != cfg.irodoriGPU2BaseURL || gpu2.modelDevice != "cuda" || gpu2.codecDevice != "cuda" || gpu2.httpClient != httpClient {
		t.Fatalf("unexpected second GPU client: %#v", backends[2].client)
	}
}

func TestConfiguredSynthesisBackendsPreservesOpenAICompatibility(t *testing.T) {
	httpClient := &http.Client{Timeout: time.Minute}
	cfg := config{
		irodoriAPIMode: "openai",
		irodoriBaseURL: "http://openai.example:8088",
		irodoriAPIKey:  "secret",
		modelName:      "irodori-tts",
		numSteps:       60,
		maxAudioBytes:  1024,
	}

	backends, err := configuredSynthesisBackends(cfg, httpClient)
	if err != nil {
		t.Fatalf("configuredSynthesisBackends: %v", err)
	}
	if len(backends) != 1 || backends[0].name != "primary" || backends[0].maxTextRunes != 0 {
		t.Fatalf("unexpected backends: %#v", backends)
	}
	client, ok := backends[0].client.(*irodoriClient)
	if !ok || client.baseURL != cfg.irodoriBaseURL || client.apiKey != cfg.irodoriAPIKey || client.httpClient != httpClient {
		t.Fatalf("unexpected OpenAI client: %#v", backends[0].client)
	}
}

func setValidGradioEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("IRODORI_API_MODE", "gradio")
	t.Setenv("IRODORI_BASE_URL", "http://legacy.example:7860")
	t.Setenv("IRODORI_GPU_BASE_URL", "http://gpu.example:7860")
	t.Setenv("IRODORI_GPU_MODEL_DEVICE", "cuda")
	t.Setenv("IRODORI_GPU_MODEL_PRECISION", "fp32")
	t.Setenv("IRODORI_GPU_CODEC_DEVICE", "cuda")
	t.Setenv("IRODORI_GPU_CODEC_PRECISION", "fp32")
	t.Setenv("IRODORI_CPU_ENABLED", "false")
	t.Setenv("IRODORI_GPU2_ENABLED", "false")
	t.Setenv("IRODORI_CPU_BASE_URL", "http://cpu.example:7862")
	t.Setenv("IRODORI_CPU_MODEL_DEVICE", "cpu")
	t.Setenv("IRODORI_CPU_MODEL_PRECISION", "fp32")
	t.Setenv("IRODORI_CPU_CODEC_DEVICE", "cpu")
	t.Setenv("IRODORI_CPU_CODEC_PRECISION", "fp32")
	t.Setenv("CPU_MAX_TEXT_RUNES", "20")
}
