package main

import (
	"bufio"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type config struct {
	addr                      string
	irodoriAPIMode            string
	irodoriBaseURL            string
	irodoriGPUName            string
	irodoriGPUBaseURL         string
	irodoriGPUModelDevice     string
	irodoriGPUModelPrecision  string
	irodoriGPUCodecDevice     string
	irodoriGPUCodecPrecision  string
	irodoriGPU2Enabled        bool
	irodoriGPU2Name           string
	irodoriGPU2BaseURL        string
	irodoriGPU2ModelDevice    string
	irodoriGPU2ModelPrecision string
	irodoriGPU2CodecDevice    string
	irodoriGPU2CodecPrecision string
	irodoriCPUEnabled         bool
	irodoriCPUName            string
	irodoriCPUBaseURL         string
	irodoriCPUModelDevice     string
	irodoriCPUModelPrecision  string
	irodoriCPUCodecDevice     string
	irodoriCPUCodecPrecision  string
	cpuMaxTextRunes           int
	androidEnabled            bool
	androidName               string
	androidBaseURL            string
	androidModelDevice        string
	androidModelPrecision     string
	androidCodecDevice        string
	androidCodecPrecision     string
	androidMaxTextRunes       int
	irodoriAPIKey             string
	irodoriCheckpoint         string
	ffmpegPath                string
	appAPIKey                 string
	databasePath              string
	contentDatabasePath       string
	audioDir                  string
	overridesFile             string
	defaultVoice              string
	defaultFormat             string
	defaultSpeed              float64
	approvedVoices            map[string]struct{}
	modelName                 string
	modelRevision             string
	voiceVersion              string
	profileVersion            string
	numSteps                  int
	maxConcurrentSynthesis    int
	rateLimitPerMinute        int
	requestTimeout            time.Duration
	maxAudioBytes             int64
}

type gradioBackendConfig struct {
	id             string
	displayName    string
	kind           string
	baseURL        string
	modelDevice    string
	modelPrecision string
	codecDevice    string
	codecPrecision string
	maxTextRunes   int
}

func loadConfig() (config, error) {
	requestTimeout, err := envDuration("IRODORI_REQUEST_TIMEOUT", 5*time.Minute)
	if err != nil {
		return config{}, err
	}
	apiMode := strings.ToLower(envString("IRODORI_API_MODE", "gradio"))
	cpuEnabled := false
	gpu2Enabled := false
	androidEnabled := false
	if apiMode == "gradio" {
		cpuEnabled, err = envBool("IRODORI_CPU_ENABLED", false)
		if err != nil {
			return config{}, err
		}
		androidEnabled, err = envBool("IRODORI_ANDROID_ENABLED", false)
		if err != nil {
			return config{}, err
		}
		gpu2Enabled, err = envBool("IRODORI_GPU2_ENABLED", false)
		if err != nil {
			return config{}, err
		}
	}
	legacyBaseURL := strings.TrimRight(envString("IRODORI_BASE_URL", "http://192.168.50.169:7860"), "/")

	cfg := config{
		addr:                      envString("SERVER_ADDR", ":8090"),
		irodoriAPIMode:            apiMode,
		irodoriBaseURL:            legacyBaseURL,
		irodoriGPUName:            envString("IRODORI_GPU_NAME", "RTX 4070 Ti"),
		irodoriGPUBaseURL:         strings.TrimRight(envString("IRODORI_GPU_BASE_URL", legacyBaseURL), "/"),
		irodoriGPUModelDevice:     strings.ToLower(envString("IRODORI_GPU_MODEL_DEVICE", "cuda")),
		irodoriGPUModelPrecision:  strings.ToLower(envString("IRODORI_GPU_MODEL_PRECISION", "fp32")),
		irodoriGPUCodecDevice:     strings.ToLower(envString("IRODORI_GPU_CODEC_DEVICE", "cuda")),
		irodoriGPUCodecPrecision:  strings.ToLower(envString("IRODORI_GPU_CODEC_PRECISION", "fp32")),
		irodoriGPU2Enabled:        gpu2Enabled,
		irodoriGPU2Name:           envString("IRODORI_GPU2_NAME", "RTX 2070"),
		irodoriGPU2BaseURL:        strings.TrimRight(strings.TrimSpace(os.Getenv("IRODORI_GPU2_BASE_URL")), "/"),
		irodoriGPU2ModelDevice:    strings.ToLower(envString("IRODORI_GPU2_MODEL_DEVICE", "cuda")),
		irodoriGPU2ModelPrecision: strings.ToLower(envString("IRODORI_GPU2_MODEL_PRECISION", "fp32")),
		irodoriGPU2CodecDevice:    strings.ToLower(envString("IRODORI_GPU2_CODEC_DEVICE", "cuda")),
		irodoriGPU2CodecPrecision: strings.ToLower(envString("IRODORI_GPU2_CODEC_PRECISION", "fp32")),
		irodoriCPUEnabled:         cpuEnabled,
		irodoriCPUName:            envString("IRODORI_CPU_NAME", "i7-12700K"),
		irodoriCPUBaseURL:         strings.TrimRight(envString("IRODORI_CPU_BASE_URL", "http://192.168.50.169:7862"), "/"),
		irodoriCPUModelDevice:     strings.ToLower(envString("IRODORI_CPU_MODEL_DEVICE", "cpu")),
		irodoriCPUModelPrecision:  strings.ToLower(envString("IRODORI_CPU_MODEL_PRECISION", "fp32")),
		irodoriCPUCodecDevice:     strings.ToLower(envString("IRODORI_CPU_CODEC_DEVICE", "cpu")),
		irodoriCPUCodecPrecision:  strings.ToLower(envString("IRODORI_CPU_CODEC_PRECISION", "fp32")),
		cpuMaxTextRunes:           envInt("CPU_MAX_TEXT_RUNES", 20),
		androidEnabled:            androidEnabled,
		androidName:               envString("IRODORI_ANDROID_NAME", "Nothing Phone (3)"),
		androidBaseURL:            strings.TrimRight(strings.TrimSpace(os.Getenv("IRODORI_ANDROID_BASE_URL")), "/"),
		androidModelDevice:        strings.ToLower(envString("IRODORI_ANDROID_MODEL_DEVICE", "cpu")),
		androidModelPrecision:     strings.ToLower(envString("IRODORI_ANDROID_MODEL_PRECISION", "fp32")),
		androidCodecDevice:        strings.ToLower(envString("IRODORI_ANDROID_CODEC_DEVICE", "cpu")),
		androidCodecPrecision:     strings.ToLower(envString("IRODORI_ANDROID_CODEC_PRECISION", "fp32")),
		androidMaxTextRunes:       envInt("ANDROID_MAX_TEXT_RUNES", 4),
		irodoriAPIKey:             os.Getenv("IRODORI_API_KEY"),
		irodoriCheckpoint:         envString("IRODORI_GRADIO_CHECKPOINT", "Aratako/Irodori-TTS-500M-v3"),
		ffmpegPath:                envString("FFMPEG_PATH", "ffmpeg"),
		appAPIKey:                 os.Getenv("APP_API_KEY"),
		databasePath:              envString("DATABASE_PATH", "./data/tts.db"),
		contentDatabasePath:       envString("CONTENT_DATABASE_PATH", "../assets/db/kioku-content.db"),
		audioDir:                  envString("AUDIO_DIR", "./data/audio"),
		overridesFile:             strings.TrimSpace(os.Getenv("TTS_OVERRIDES_FILE")),
		defaultVoice:              envString("DEFAULT_VOICE", "dictionary-ja-01"),
		defaultFormat:             strings.ToLower(envString("DEFAULT_FORMAT", "opus")),
		defaultSpeed:              envFloat("DEFAULT_SPEED", 1.0),
		approvedVoices:            parseSet(envString("APPROVED_VOICES", "dictionary-ja-01,none")),
		modelName:                 envString("IRODORI_MODEL_NAME", "irodori-tts"),
		modelRevision:             envString("MODEL_REVISION", "Irodori-TTS-500M-v3"),
		voiceVersion:              envString("VOICE_VERSION", "v1"),
		profileVersion:            envString("PROFILE_VERSION", "quality-v3-opus32-no-trim"),
		numSteps:                  envInt("IRODORI_NUM_STEPS", 60),
		maxConcurrentSynthesis:    envInt("MAX_CONCURRENT_SYNTHESIS", 1),
		rateLimitPerMinute:        envInt("RATE_LIMIT_PER_MINUTE", 60),
		requestTimeout:            requestTimeout,
		maxAudioBytes:             int64(envInt("MAX_AUDIO_MIB", 16)) * 1024 * 1024,
	}

	if cfg.irodoriAPIMode != "gradio" && cfg.irodoriAPIMode != "openai" {
		return config{}, fmt.Errorf("IRODORI_API_MODE must be gradio or openai")
	}
	if cfg.irodoriAPIMode == "openai" {
		if err := validateBaseURL("IRODORI_BASE_URL", cfg.irodoriBaseURL); err != nil {
			return config{}, err
		}
	} else {
		if err := validateBaseURL("IRODORI_GPU_BASE_URL", cfg.irodoriGPUBaseURL); err != nil {
			return config{}, err
		}
		if err := validateRuntime("IRODORI_GPU", cfg.irodoriGPUModelDevice, cfg.irodoriGPUModelPrecision, cfg.irodoriGPUCodecDevice, cfg.irodoriGPUCodecPrecision); err != nil {
			return config{}, err
		}
		if cfg.irodoriGPU2Enabled {
			if err := validateBaseURL("IRODORI_GPU2_BASE_URL", cfg.irodoriGPU2BaseURL); err != nil {
				return config{}, err
			}
			if err := validateRuntime("IRODORI_GPU2", cfg.irodoriGPU2ModelDevice, cfg.irodoriGPU2ModelPrecision, cfg.irodoriGPU2CodecDevice, cfg.irodoriGPU2CodecPrecision); err != nil {
				return config{}, err
			}
		}
		if cfg.irodoriCPUEnabled {
			if err := validateBaseURL("IRODORI_CPU_BASE_URL", cfg.irodoriCPUBaseURL); err != nil {
				return config{}, err
			}
			if err := validateRuntime("IRODORI_CPU", cfg.irodoriCPUModelDevice, cfg.irodoriCPUModelPrecision, cfg.irodoriCPUCodecDevice, cfg.irodoriCPUCodecPrecision); err != nil {
				return config{}, err
			}
		}
		if cfg.androidEnabled {
			if err := validateBaseURL("IRODORI_ANDROID_BASE_URL", cfg.androidBaseURL); err != nil {
				return config{}, err
			}
			if err := validateRuntime("IRODORI_ANDROID", cfg.androidModelDevice, cfg.androidModelPrecision, cfg.androidCodecDevice, cfg.androidCodecPrecision); err != nil {
				return config{}, err
			}
		}
	}
	if cfg.irodoriAPIMode == "gradio" && cfg.irodoriCPUEnabled && cfg.cpuMaxTextRunes < 1 {
		return config{}, fmt.Errorf("CPU_MAX_TEXT_RUNES must be at least 1")
	}
	if cfg.irodoriAPIMode == "gradio" && cfg.androidEnabled && cfg.androidMaxTextRunes < 1 {
		return config{}, fmt.Errorf("ANDROID_MAX_TEXT_RUNES must be at least 1")
	}
	if cfg.maxConcurrentSynthesis < 1 {
		return config{}, fmt.Errorf("MAX_CONCURRENT_SYNTHESIS must be at least 1")
	}
	if cfg.rateLimitPerMinute < 0 {
		return config{}, fmt.Errorf("RATE_LIMIT_PER_MINUTE cannot be negative")
	}
	if cfg.numSteps < 1 {
		return config{}, fmt.Errorf("IRODORI_NUM_STEPS must be at least 1")
	}
	if cfg.maxAudioBytes < 1024*1024 {
		return config{}, fmt.Errorf("MAX_AUDIO_MIB must be at least 1")
	}
	if _, ok := cfg.approvedVoices[cfg.defaultVoice]; !ok {
		return config{}, fmt.Errorf("DEFAULT_VOICE must be present in APPROVED_VOICES")
	}
	if cfg.defaultFormat != "m4a" && cfg.defaultFormat != "aac" && cfg.defaultFormat != "opus" {
		return config{}, fmt.Errorf("DEFAULT_FORMAT must be m4a, aac, or opus")
	}
	if cfg.defaultSpeed < 0.8 || cfg.defaultSpeed > 1.2 {
		return config{}, fmt.Errorf("DEFAULT_SPEED must be between 0.8 and 1.2")
	}
	return cfg, nil
}

func (cfg config) gradioBackendConfigs() []gradioBackendConfig {
	backends := []gradioBackendConfig{{
		id:             "gpu",
		displayName:    cfg.irodoriGPUName,
		kind:           "gpu",
		baseURL:        cfg.irodoriGPUBaseURL,
		modelDevice:    cfg.irodoriGPUModelDevice,
		modelPrecision: cfg.irodoriGPUModelPrecision,
		codecDevice:    cfg.irodoriGPUCodecDevice,
		codecPrecision: cfg.irodoriGPUCodecPrecision,
	}}
	if cfg.irodoriCPUEnabled {
		backends = append(backends, gradioBackendConfig{
			id:             "cpu",
			displayName:    cfg.irodoriCPUName,
			kind:           "cpu",
			baseURL:        cfg.irodoriCPUBaseURL,
			modelDevice:    cfg.irodoriCPUModelDevice,
			modelPrecision: cfg.irodoriCPUModelPrecision,
			codecDevice:    cfg.irodoriCPUCodecDevice,
			codecPrecision: cfg.irodoriCPUCodecPrecision,
			maxTextRunes:   cfg.cpuMaxTextRunes,
		})
	}
	if cfg.irodoriGPU2Enabled {
		backends = append(backends, gradioBackendConfig{
			id:             "gpu2",
			displayName:    cfg.irodoriGPU2Name,
			kind:           "gpu",
			baseURL:        cfg.irodoriGPU2BaseURL,
			modelDevice:    cfg.irodoriGPU2ModelDevice,
			modelPrecision: cfg.irodoriGPU2ModelPrecision,
			codecDevice:    cfg.irodoriGPU2CodecDevice,
			codecPrecision: cfg.irodoriGPU2CodecPrecision,
		})
	}
	if cfg.androidEnabled {
		backends = append(backends, gradioBackendConfig{
			id:             "android",
			displayName:    cfg.androidName,
			kind:           "android",
			baseURL:        cfg.androidBaseURL,
			modelDevice:    cfg.androidModelDevice,
			modelPrecision: cfg.androidModelPrecision,
			codecDevice:    cfg.androidCodecDevice,
			codecPrecision: cfg.androidCodecPrecision,
			maxTextRunes:   cfg.androidMaxTextRunes,
		})
	}
	return backends
}

func backendPresentation(id string) (string, string) {
	switch id {
	case "gpu":
		return "RTX 4070 Ti", "gpu"
	case "cpu":
		return "i7-12700K", "cpu"
	case "gpu2":
		return "RTX 2070", "gpu"
	case "android":
		return "Nothing Phone (3)", "android"
	case "primary":
		return "Primary API", "api"
	default:
		return id, "unknown"
	}
}

func loadDotEnv(path string) error {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if !found || !validEnvKey(key) {
			return fmt.Errorf("%s:%d contains an invalid environment assignment", path, lineNumber)
		}
		if len(value) > 0 && (value[0] == '\'' || value[0] == '"') {
			quote := value[0]
			if len(value) < 2 || value[len(value)-1] != quote {
				return fmt.Errorf("%s:%d contains an unterminated quoted value", path, lineNumber)
			}
			if quote == '\'' {
				value = value[1 : len(value)-1]
			} else {
				value, err = strconv.Unquote(value)
				if err != nil {
					return fmt.Errorf("%s:%d contains an invalid quoted value: %w", path, lineNumber, err)
				}
			}
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("set %s from %s:%d: %w", key, path, lineNumber, err)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	return nil
}

func validEnvKey(key string) bool {
	if key == "" {
		return false
	}
	for index := 0; index < len(key); index++ {
		value := key[index]
		if (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z') || value == '_' || (index > 0 && value >= '0' && value <= '9') {
			continue
		}
		return false
	}
	return true
}

func validateBaseURL(name, rawURL string) error {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		if err == nil {
			err = fmt.Errorf("must be an absolute HTTP or HTTPS URL")
		}
		return fmt.Errorf("%s is invalid: %w", name, err)
	}
	return nil
}

func validateRuntime(prefix, modelDevice, modelPrecision, codecDevice, codecPrecision string) error {
	if err := validateDevice(prefix+"_MODEL_DEVICE", modelDevice); err != nil {
		return err
	}
	if err := validatePrecision(prefix+"_MODEL_PRECISION", modelDevice, modelPrecision); err != nil {
		return err
	}
	if err := validateDevice(prefix+"_CODEC_DEVICE", codecDevice); err != nil {
		return err
	}
	return validatePrecision(prefix+"_CODEC_PRECISION", codecDevice, codecPrecision)
}

func validateDevice(name, device string) error {
	switch device {
	case "cpu", "cuda", "mps", "xpu":
		return nil
	default:
		return fmt.Errorf("%s must be cpu, cuda, mps, or xpu", name)
	}
}

func validatePrecision(name, device, precision string) error {
	if precision != "fp32" && precision != "bf16" {
		return fmt.Errorf("%s must be fp32 or bf16", name)
	}
	if precision == "bf16" && device != "cuda" && device != "xpu" {
		return fmt.Errorf("%s cannot be bf16 when its device is %s", name, device)
	}
	return nil
}

func envString(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envFloat(key string, fallback float64) float64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(key string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("%s is invalid: %w", key, err)
	}
	return parsed, nil
}

func envBool(key string, fallback bool) (bool, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s is invalid: %w", key, err)
	}
	return parsed, nil
}

func parseSet(raw string) map[string]struct{} {
	result := make(map[string]struct{})
	for _, value := range strings.Split(raw, ",") {
		if value = strings.TrimSpace(value); value != "" {
			result[value] = struct{}{}
		}
	}
	return result
}
