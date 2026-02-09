package api

import (
	"fmt"
	"net/http"
	"strings"
)

// LineageResponse represents a GET /api/simulations/:id/lineage response
type LineageResponse struct {
	ChildWorkID           string  `json:"childWorkId"`
	ChildWorkFriendlyName string  `json:"childWorkFriendlyName"`
	ParentWorkID          string  `json:"parentWorkId"`
	ParentWorkFriendlyName string `json:"parentWorkFriendlyName"`
	OperationType         string  `json:"operationType"`
	StationID             string  `json:"stationId"`
	Timestamp             float64 `json:"timestamp"`
}

// HandleGetLineage handles GET /api/simulations/:id/lineage
func (h *Handler) HandleGetLineage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Extract ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/simulations/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 || parts[0] == "" {
		respondError(w, http.StatusBadRequest, "Simulation ID is required")
		return
	}
	simulationID := parts[0]

	// Get lineage from database
	lineageLogs, err := h.repo.GetWorkLineage(simulationID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get work lineage: %v", err))
		return
	}

	// Convert to response format
	items := make([]LineageResponse, 0, len(lineageLogs))
	for _, log := range lineageLogs {
		item := LineageResponse{
			ChildWorkID:            log.ChildWorkID,
			ChildWorkFriendlyName:  log.ChildWorkFriendlyName,
			ParentWorkID:           log.ParentWorkID,
			ParentWorkFriendlyName: log.ParentWorkFriendlyName,
			OperationType:          log.OperationType,
			StationID:              log.StationID,
			Timestamp:              log.Timestamp,
		}
		items = append(items, item)
	}

	respondJSON(w, http.StatusOK, items)
}
