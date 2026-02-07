package api

import (
	"factory-simulation/simulation-core/internal/simulation"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// InitialConditionStation represents initial conditions for a station
type InitialConditionStation struct {
	CurrentWork *struct {
		ID            string `json:"id"`
		QualityStatus string `json:"qualityStatus"`
	} `json:"currentWork"`
	ElapsedTime float64 `json:"elapsedTime"`
}

// SimulationRequest represents a POST /api/simulations request
type SimulationRequest struct {
	ScenarioID        string                             `json:"scenarioId"`
	SimulationTime    float64                            `json:"simulationTime"`
	InitialConditions map[string]InitialConditionStation `json:"initialConditions"`
}

// SimulationResponse represents a POST /api/simulations response
type SimulationResponse struct {
	SimulationID string  `json:"simulationId"`
	Status       string  `json:"status"`
	EndTime      float64 `json:"endTime"`
	EndReason    string  `json:"endReason"`
}

// SimulationResult represents a GET /api/simulations/:id response
type SimulationResult struct {
	SimulationID string  `json:"simulationId"`
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

// LogsResponse represents a GET /api/simulations/:id/logs response
type LogsResponse struct {
	SimulationID      string                       `json:"simulationId"`
	StationStatusLogs []simulation.StationStatusLog `json:"stationStatusLogs"`
	WorkEvents        []simulation.WorkEventLog     `json:"workEvents"`
}

// HandleRunSimulation handles POST /api/simulations
func (h *Handler) HandleRunSimulation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req SimulationRequest
	if err := parseJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Validate request
	if req.ScenarioID == "" {
		respondError(w, http.StatusBadRequest, "Scenario ID is required")
		return
	}
	if req.SimulationTime <= 0 {
		respondError(w, http.StatusBadRequest, "Simulation time must be positive")
		return
	}

	// Get scenario
	scenario, err := h.GetScenario(req.ScenarioID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	// TODO: Apply initial conditions (for future implementation)

	// Generate unique simulation ID
	simulationID := fmt.Sprintf("sim-%d", time.Now().UnixNano())

	// Run simulation
	engine := simulation.NewEngine(scenario)
	sim, statusLogs, workEventLogs, err := engine.Run(simulationID, req.SimulationTime)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Simulation failed: %v", err))
		return
	}

	// Save to database
	if err := h.repo.SaveSimulationRun(sim); err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to save simulation: %v", err))
		return
	}

	if err := h.repo.SaveStationStatusLogs(sim.ID, statusLogs); err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to save status logs: %v", err))
		return
	}

	if err := h.repo.SaveWorkEvents(sim.ID, workEventLogs); err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to save work events: %v", err))
		return
	}

	// Prepare response
	response := SimulationResponse{
		SimulationID: sim.ID,
		Status:       string(sim.Status),
		EndTime:      *sim.EndTime,
		EndReason:    string(*sim.EndReason),
	}

	respondJSON(w, http.StatusOK, response)
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
