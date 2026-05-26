package main

import (
	"context"
	"factory-simulation/realtime-gateway/internal/api"
	"factory-simulation/realtime-gateway/internal/database"
	"factory-simulation/realtime-gateway/internal/notify"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	host := getEnv("DB_HOST", "localhost")
	port := getEnv("DB_PORT", "5432")
	user := getEnv("DB_USER", "postgres")
	pass := getEnv("DB_PASSWORD", "postgres")
	dbname := getEnv("DB_NAME", "factory_simulation")
	simCoreURL := getEnv("SIMULATION_CORE_URL", "http://simulation-core:8080")
	pollerURL  := getEnv("FACTORY_POLLER_URL", "http://factory-poller:8091")
	listenPort := getEnv("PORT", "8090")

	db, err := database.NewDB(host, port, user, pass, dbname)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()
	log.Println("database connected")

	connStr := notify.BuildConnStr(host, port, user, pass, dbname)
	hub := notify.NewHub(connStr)
	if err := hub.Start(); err != nil {
		log.Fatalf("failed to start notify hub: %v", err)
	}
	log.Println("notify hub started")

	repo := database.NewRepository(db)
	if err := repo.ResetPendingExecutions(); err != nil {
		log.Printf("warning: failed to reset pending executions: %v", err)
	}
	h := api.NewHandler(repo, hub, simCoreURL, pollerURL)

	srv := &http.Server{
		Addr:         ":" + listenPort,
		Handler:      h,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 300 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("realtime-gateway listening on :%s", listenPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Println("realtime-gateway stopped")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
