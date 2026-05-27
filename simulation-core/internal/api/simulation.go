package api

import (
	"factory-simulation/simulation-core/internal/simulation"
	"fmt"
	"net/http"
	"strings"
)

// LogsResponse represents a GET /api/simulations/:id/logs response
type LogsResponse struct {
	SimulationID      string                       `json:"simulationId"`
	StationStatusLogs []simulation.StationStatusLog `json:"stationStatusLogs"`
	WorkEvents        []simulation.WorkEventLog     `json:"workEvents"`
}

// InitialConditionStation represents initial conditions for a station
type InitialConditionStation struct {
	CurrentWork *struct {
		ID            string `json:"id"`
		QualityStatus string `json:"qualityStatus"`
	} `json:"currentWork"`
	ElapsedTime float64  `json:"elapsedTime"`
	WorkIDs     []string `json:"workIds"`
}

// SimulationResponse represents a POST /api/simulations response
type SimulationResponse struct {
	SimulationID string  `json:"simulationId"`
	FriendlyName string  `json:"friendlyName"`
	Status       string  `json:"status"`
	EndTime      float64 `json:"endTime"`
	EndReason    string  `json:"endReason"`
}

// SimulationResult represents a GET /api/simulations/:id response
type SimulationResult struct {
	SimulationID string  `json:"simulationId"`
	FriendlyName string  `json:"friendlyName"`
	ScenarioID   string  `json:"scenarioId"`
	Status       string  `json:"status"`
	StartTime    float64 `json:"startTime"`
	EndTime      float64 `json:"endTime"`
	EndReason    string  `json:"endReason"`
	Summary      struct {
		TotalWorksCreated   int `json:"totalWorksCreated"`
		TotalWorksDestroyed int `json:"totalWorksDestroyed"`
		TotalEvents         int `json:"totalEvents"`
	} `json:"summary"`
}

// HandleGetSimulation handles GET /api/simulations/:id
func (h *Handler) HandleGetSimulation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Extract ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/simulations/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		respondError(w, http.StatusBadRequest, "Simulation ID is required")
		return
	}
	simulationID := parts[0]

	// Get simulation from database
	sim, err := h.repo.GetSimulation(simulationID)
	if err != nil {
		respondError(w, http.StatusNotFound, fmt.Sprintf("Simulation not found: %v", err))
		return
	}

	// Prepare response
	result := SimulationResult{
		SimulationID: sim.ID,
		FriendlyName: sim.FriendlyName,
		ScenarioID:   sim.ScenarioID,
		Status:       string(sim.Status),
		StartTime:    sim.StartTime,
	}

	if sim.EndTime != nil {
		result.EndTime = *sim.EndTime
	}
	if sim.EndReason != nil {
		result.EndReason = string(*sim.EndReason)
	}

	result.Summary.TotalWorksCreated = sim.Summary.TotalWorksCreated
	result.Summary.TotalWorksDestroyed = sim.Summary.TotalWorksDestroyed
	result.Summary.TotalEvents = sim.Summary.TotalEvents

	respondJSON(w, http.StatusOK, result)
}

// HandleGetLogs handles GET /api/simulations/:id/logs
func (h *Handler) HandleGetLogs(w http.ResponseWriter, r *http.Request) {
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

	// Get logs from database
	statusLogs, err := h.repo.GetStationStatusLogs(simulationID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get status logs: %v", err))
		return
	}

	workEvents, err := h.repo.GetWorkEvents(simulationID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get work events: %v", err))
		return
	}

	// Prepare response
	response := LogsResponse{
		SimulationID:      simulationID,
		StationStatusLogs: statusLogs,
		WorkEvents:        workEvents,
	}

	respondJSON(w, http.StatusOK, response)
}

// SimulationListItem represents a simulation in the list response
type SimulationListItem struct {
	SimulationID string  `json:"simulationId"`
	FriendlyName string  `json:"friendlyName"`
	ScenarioID   string  `json:"scenarioId"`
	Status       string  `json:"status"`
	EndTime      float64 `json:"endTime"`
	EndReason    string  `json:"endReason"`
	CreatedAt    string  `json:"createdAt"` // ISO 8601 format
}

// HandleGetSimulations handles GET /api/simulations
func (h *Handler) HandleGetSimulations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	simulations, err := h.repo.GetAllSimulations()
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get simulations: %v", err))
		return
	}

	// Convert to response format
	var items []SimulationListItem
	for _, sim := range simulations {
		item := SimulationListItem{
			SimulationID: sim.ID,
			FriendlyName: sim.FriendlyName,
			ScenarioID:   sim.ScenarioID,
			Status:       string(sim.Status),
			CreatedAt:    sim.CreatedAt.Format("2006-01-02T15:04:05Z07:00"), // ISO 8601
		}

		if sim.EndTime != nil {
			item.EndTime = *sim.EndTime
		}

		if sim.EndReason != nil {
			item.EndReason = string(*sim.EndReason)
		}

		items = append(items, item)
	}

	respondJSON(w, http.StatusOK, items)
}
