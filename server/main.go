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
	if command == "serve" {
		contentStore, contentErr := newContentStore(cfg.contentDatabasePath)
		if contentErr != nil {
			logger.Error("initialize content database", "error", contentErr)
			return 1
		}
		defer contentStore.close()
		content = contentStore
	}

	httpClient := &http.Client{Timeout: cfg.requestTimeout}
	var client synthesisClient
	if cfg.irodoriAPIMode == "gradio" {
		client = &gradioClient{
			baseURL:      cfg.irodoriBaseURL,
			checkpoint:   cfg.irodoriCheckpoint,
			numSteps:     cfg.numSteps,
			ffmpegPath:   cfg.ffmpegPath,
			maxAudioSize: cfg.maxAudioBytes,
			httpClient:   httpClient,
		}
	} else {
		client = &irodoriClient{
			baseURL:      cfg.irodoriBaseURL,
			apiKey:       cfg.irodoriAPIKey,
			modelName:    cfg.modelName,
			numSteps:     cfg.numSteps,
			maxAudioSize: cfg.maxAudioBytes,
			httpClient:   httpClient,
		}
	}
	service := newAudioService(cfg, store, content, client, textOverrides, logger)

	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	switch command {
	case "serve":
		if err := runHTTPServer(shutdownContext, cfg, service, logger); err != nil {
			logger.Error("server stopped unexpectedly", "error", err)
			return 1
		}
	case "prewarm":
		if cfg.irodoriAPIKey == "" {
			logger.Warn("IRODORI_API_KEY is empty; upstream authentication is disabled")
		}
		if err := runPrewarm(shutdownContext, commandArgs, cfg, service, textOverrides, logger); err != nil {
			logger.Error("prewarm failed", "error", err)
			return 1
		}
	case "import":
		if err := runImport(shutdownContext, commandArgs, cfg, service, textOverrides, logger); err != nil {
			logger.Error("import failed", "error", err)
			return 1
		}
	default:
		logger.Error("unknown command", "command", command, "valid", "serve|prewarm|import")
		return 2
	}
	return 0
}

func runHTTPServer(shutdownContext context.Context, cfg config, service *audioService, logger *slog.Logger) error {
	if cfg.appAPIKey == "" {
		logger.Warn("APP_API_KEY is empty; app-facing authentication is disabled")
	}
	api := &apiServer{
		service:       service,
		appAPIKey:     cfg.appAPIKey,
		defaultVoice:  cfg.defaultVoice,
		defaultFormat: cfg.defaultFormat,
		defaultSpeed:  cfg.defaultSpeed,
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
