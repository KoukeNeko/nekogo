package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	command := "serve"
	commandArgs := args
	if len(args) > 0 {
		command = args[0]
		commandArgs = args[1:]
	}
	cfg, err := loadConfig()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		return 1
	}
	textOverrides, err := loadTextOverrides(cfg.overridesFile)
	if err != nil {
		logger.Error("load TTS text overrides", "error", err)
		return 1
	}
	store, err := newAssetStore(cfg)
	if err != nil {
		logger.Error("initialize audio store", "error", err)
		return 1
	}
	defer store.close()

	var content contentResolver
	if command == "serve" || command == "status" {
		contentStore, contentErr := newContentStore(cfg.contentDatabasePath)
		if contentErr != nil {
			logger.Error("initialize content database", "error", contentErr)
			return 1
		}
		defer contentStore.close()
		content = contentStore
	}

	var backends []synthesisBackend
	var primaryClient synthesisClient
	if command == "serve" {
		httpClient := &http.Client{Timeout: cfg.requestTimeout}
		backends, err = configuredSynthesisBackends(cfg, httpClient)
		if err != nil {
			logger.Error("configure synthesis backends", "error", err)
			return 1
		}
		primaryClient = backends[0].client
	}
	service := newAudioService(cfg, store, content, primaryClient, textOverrides, logger)

	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	switch command {
	case "serve":
		serveContext, cancelServe := context.WithCancel(shutdownContext)
		scheduler := newAudioScheduler(service, backends, logger)
		scheduler.start(serveContext)
		serverErr := runHTTPServer(serveContext, cfg, service, backends, logger)
		cancelServe()
		scheduler.waitForStop()
		if serverErr != nil {
			logger.Error("server stopped unexpectedly", "error", serverErr)
			return 1
		}
	case "prewarm":
		if err := runPrewarm(shutdownContext, commandArgs, cfg, service, textOverrides, logger); err != nil {
			logger.Error("prewarm failed", "error", err)
			return 1
		}
	case "status":
		if err := runStatus(shutdownContext, commandArgs, cfg, service, os.Stdout); err != nil {
			logger.Error("status failed", "error", err)
			return 1
		}
	case "import":
		if err := runImport(shutdownContext, commandArgs, cfg, service, textOverrides, logger); err != nil {
			logger.Error("import failed", "error", err)
			return 1
		}
	default:
		logger.Error("unknown command", "command", command, "valid", "serve|prewarm|status|import")
		return 2
	}
	return 0
}

func configuredSynthesisBackends(cfg config, httpClient *http.Client) ([]synthesisBackend, error) {
	switch cfg.irodoriAPIMode {
	case "gradio":
		configs := cfg.gradioBackendConfigs()
		backends := make([]synthesisBackend, 0, len(configs))
		for _, backend := range configs {
			backends = append(backends, synthesisBackend{
				name:        backend.id,
				displayName: backend.displayName,
				kind:        backend.kind,
				client: &gradioClient{
					baseURL:        backend.baseURL,
					checkpoint:     cfg.irodoriCheckpoint,
					modelDevice:    backend.modelDevice,
					modelPrecision: backend.modelPrecision,
					codecDevice:    backend.codecDevice,
					codecPrecision: backend.codecPrecision,
					numSteps:       cfg.numSteps,
					ffmpegPath:     cfg.ffmpegPath,
					maxAudioSize:   cfg.maxAudioBytes,
					httpClient:     httpClient,
				},
				maxTextRunes: backend.maxTextRunes,
			})
		}
		return backends, nil
	case "openai":
		return []synthesisBackend{{
			name:        "primary",
			displayName: "Primary API",
			kind:        "api",
			client: &irodoriClient{
				baseURL:      cfg.irodoriBaseURL,
				apiKey:       cfg.irodoriAPIKey,
				modelName:    cfg.modelName,
				numSteps:     cfg.numSteps,
				maxAudioSize: cfg.maxAudioBytes,
				httpClient:   httpClient,
			},
			maxTextRunes: 0,
		}}, nil
	default:
		return nil, errors.New("IRODORI_API_MODE must be gradio or openai")
	}
}

func runHTTPServer(shutdownContext context.Context, cfg config, service *audioService, backends []synthesisBackend, logger *slog.Logger) error {
	if cfg.appAPIKey == "" {
		logger.Warn("APP_API_KEY is empty; app-facing authentication is disabled")
	}
	api := &apiServer{
		service:       service,
		appAPIKey:     cfg.appAPIKey,
		defaultVoice:  cfg.defaultVoice,
		defaultFormat: cfg.defaultFormat,
		defaultSpeed:  cfg.defaultSpeed,
		backends:      backends,
		logger:        logger,
		rateLimiter:   newFixedWindowLimiter(cfg.rateLimitPerMinute),
	}
	server := &http.Server{
		Addr:              cfg.addr,
		Handler:           api.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("graceful shutdown failed", "error", err)
		}
	}()

	logger.Info(
		"dictionary TTS API listening",
		"addr", cfg.addr,
		"database", cfg.databasePath,
		"audio_dir", cfg.audioDir,
		"audio_profile", service.profileID(),
	)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
