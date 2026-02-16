package api

import (
	"log"
	"net/http"
)

// SetupRoutes configures all routes for sim-executor backend
func (h *Handler) SetupRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/executor/initial-conditions", corsMiddleware(h.HandleInitialConditions))
	mux.HandleFunc("/api/executor/execute", corsMiddleware(h.HandleExecute))
	mux.HandleFunc("/api/executor/executions", corsMiddleware(h.HandleGetExecutions))
	mux.HandleFunc("/api/executor/executions/", corsMiddleware(h.HandleDeleteExecution))
	mux.HandleFunc("/api/executor/scenarios", corsMiddleware(h.HandleGetScenarios))
	mux.HandleFunc("/api/executor/simdb/test-connection", corsMiddleware(h.HandleTestConnection))
}

// corsMiddleware adds CORS headers
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Printf("CORS Middleware: Method=%s, Path=%s", r.Method, r.URL.Path)
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}
