package api

import (
	"encoding/json"
	"factory-simulation/simulation-core/internal/database"
	"fmt"
	"net/http"
)

// APIError represents an API error
type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Handler handles HTTP requests
type Handler struct {
	repo *database.Repository
}

// NewHandler creates a new handler
func NewHandler(repo *database.Repository) *Handler {
	return &Handler{
		repo: repo,
	}
}

// respondJSON sends a JSON response
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	b, err := json.Marshal(data)
	if err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(b) //nolint:errcheck
}

// respondError sends an error response
func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, APIError{
		Code:    status,
		Message: message,
	})
}

// parseJSON parses JSON request body
func parseJSON(r *http.Request, v interface{}) error {
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(v); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	return nil
}
