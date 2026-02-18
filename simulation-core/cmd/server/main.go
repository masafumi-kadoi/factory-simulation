package main

import (
	"context"
	"factory-simulation/simulation-core/internal/api"
	"factory-simulation/simulation-core/internal/database"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	// Get database configuration from environment variables
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "postgres")
	dbPassword := getEnv("DB_PASSWORD", "postgres")
	dbName := getEnv("DB_NAME", "factory_simulation")

	// Connect to database
	log.Println("Connecting to database...")
	db, err := database.NewDB(dbHost, dbPort, dbUser, dbPassword, dbName)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	log.Println("Database connection established")

	// Create repository
	repo := database.NewRepository(db)

	// Create HTTP handler
	handler := api.NewHandler(repo)

	// Setup router with CORS middleware
	mux := http.NewServeMux()
	mux.HandleFunc("/api/scenarios/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("Handler 1: Method=%s, Path=%s", r.Method, r.URL.Path)
		// Route based on path
		if r.URL.Path == "/api/scenarios" || r.URL.Path == "/api/scenarios/" {
			if r.Method == http.MethodGet {
				log.Println("Calling HandleListScenarios")
				handler.HandleListScenarios(w, r)
			} else {
				log.Println("Calling HandleCreateScenario")
				handler.HandleCreateScenario(w, r)
			}
		} else if r.Method == http.MethodPut {
			// PUT /api/scenarios/:id - update scenario
			log.Println("Calling HandleUpdateScenario")
			handler.HandleUpdateScenario(w, r)
		} else if r.Method == http.MethodDelete {
			// DELETE /api/scenarios/:id - delete scenario
			log.Println("Calling HandleDeleteScenario")
			handler.HandleDeleteScenario(w, r)
		} else {
			// GET /api/scenarios/:id - get scenario details
			log.Println("Calling HandleGetScenario")
			handler.HandleGetScenario(w, r)
		}
	}))
	mux.HandleFunc("/api/scenarios", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("Handler 2: Method=%s, Path=%s", r.Method, r.URL.Path)
		if r.Method == http.MethodGet {
			// GET /api/scenarios - list all scenarios
			log.Println("Calling HandleListScenarios")
			handler.HandleListScenarios(w, r)
		} else {
			// POST /api/scenarios - create scenario
			log.Println("Calling HandleCreateScenario")
			handler.HandleCreateScenario(w, r)
		}
	}))
	mux.HandleFunc("/api/simulations", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handler.HandleGetSimulations(w, r)
		} else {
			handler.HandleRunSimulation(w, r)
		}
	}))
	mux.HandleFunc("/api/simulations/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		// Route to appropriate handler based on path
		if r.URL.Path == "/api/simulations/" {
			http.Error(w, "Simulation ID required", http.StatusBadRequest)
			return
		}

		// Check if path ends with /logs
		if len(r.URL.Path) > 5 && r.URL.Path[len(r.URL.Path)-5:] == "/logs" {
			handler.HandleGetLogs(w, r)
		} else if len(r.URL.Path) > 8 && r.URL.Path[len(r.URL.Path)-8:] == "/lineage" {
			handler.HandleGetLineage(w, r)
		} else {
			handler.HandleGetSimulation(w, r)
		}
	}))

	// Create HTTP server
	port := getEnv("PORT", "8080")
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 300 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in a goroutine
	go func() {
		log.Printf("Starting server on port %s...", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	log.Println("Server started successfully")

	// Wait for interrupt signal for graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Create a deadline for graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

// getEnv gets an environment variable or returns a default value
func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

// corsMiddleware adds CORS headers for development
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Printf("CORS Middleware: Method=%s, Path=%s", r.Method, r.URL.Path)
		// Allow all origins in development
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}
