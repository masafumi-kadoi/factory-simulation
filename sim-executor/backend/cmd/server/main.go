package main

import (
	"context"
	"factory-simulation/sim-executor/backend/internal/api"
	"factory-simulation/sim-executor/backend/internal/database"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	// Database configuration (same DB as simulation-core)
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "postgres")
	dbPassword := getEnv("DB_PASSWORD", "postgres")
	dbName := getEnv("DB_NAME", "factory_simulation")

	// simulation-core URL
	simulationCoreURL := getEnv("SIMULATION_CORE_URL", "http://localhost:8080")

	// Connect to database
	log.Println("Connecting to database...")
	db, err := database.NewDB(dbHost, dbPort, dbUser, dbPassword, dbName)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	log.Println("Database connection established")

	// Create repository and handler
	repo := database.NewRepository(db)
	handler := api.NewHandler(repo, simulationCoreURL)

	// Setup routes
	mux := http.NewServeMux()
	handler.SetupRoutes(mux)

	// Start server
	port := getEnv("PORT", "8084")
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 120 * time.Second, // Longer timeout for simulation execution
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("sim-executor backend starting on port %s...", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	log.Println("Server started successfully")

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
