package api

import (
	"bytes"
	"encoding/json"
	"factory-simulation/sim-executor/backend/internal/database"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"

	"factory-simulation/sim-executor/backend/internal/simdb"
)

// Handler handles HTTP requests for sim-executor
type Handler struct {
	repo              *database.Repository
	simulationCoreURL string
}

// NewHandler creates a new handler
func NewHandler(repo *database.Repository, simulationCoreURL string) *Handler {
	return &Handler{
		repo:              repo,
		simulationCoreURL: simulationCoreURL,
	}
}

// APIError represents an API error
type APIError struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

// respondJSON sends a JSON response
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// respondError sends an error response
func respondError(w http.ResponseWriter, status int, message string, code string) {
	respondJSON(w, status, APIError{
		Error: message,
		Code:  code,
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

// --- Request/Response types ---

// InitialConditionsRequest represents POST /api/executor/initial-conditions request
type InitialConditionsRequest struct {
	ScenarioID string `json:"scenarioId"`
	StartTime  string `json:"startTime"` // ISO 8601 format
}

// InitialConditionsResponse represents the response with initial conditions
type InitialConditionsResponse struct {
	InitialConditions map[string]simdb.StationInitialCondition `json:"initialConditions"`
	Warnings          []simdb.Warning                          `json:"warnings"`
}

// ExecuteRequest represents POST /api/executor/execute request
type ExecuteRequest struct {
	ScenarioID        string                                   `json:"scenarioId"`
	StartTime         string                                   `json:"startTime"`
	EndCondition      EndCondition                             `json:"endCondition"`
	InitialConditions map[string]simdb.StationInitialCondition `json:"initialConditions"`
}

// EndCondition represents the end condition for a simulation
type EndCondition struct {
	Type  string `json:"type"`  // "duration" or "absolute"
	Value string `json:"value"` // minutes (for duration) or ISO 8601 (for absolute)
}

// ExecuteResponse represents the response after execution
type ExecuteResponse struct {
	ExecutionID  string  `json:"executionId"`
	SimulationID string  `json:"simulationId"`
	Status       string  `json:"status"`
	EndTime      float64 `json:"endTime,omitempty"`
	EndReason    string  `json:"endReason,omitempty"`
}

// ExecutionListResponse represents the execution list response
type ExecutionListResponse struct {
	Executions []database.ExecutionConfig `json:"executions"`
}

// ScenarioWithExecutions extends scenario list with execution count
type ScenarioWithExecutions struct {
	ScenarioID      string      `json:"scenarioId"`
	Name            string      `json:"name"`
	SimDBConfig     interface{} `json:"simdbConfig,omitempty"`
	StationCount    int         `json:"stationCount"`
	ConnectionCount int         `json:"connectionCount"`
	ExecutionCount  int         `json:"executionCount"`
}

// SimDBTestRequest represents POST /api/executor/simdb/test-connection request
type SimDBTestRequest struct {
	ScenarioID string `json:"scenarioId"`
}

// SimDBTestResponse represents the test connection response
type SimDBTestResponse struct {
	Success   bool                       `json:"success"`
	Message   string                     `json:"message"`
	Locations []simdb.LocationMasterEntry `json:"locations,omitempty"`
}

// --- Handlers ---

// HandleInitialConditions handles POST /api/executor/initial-conditions
func (h *Handler) HandleInitialConditions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req InitialConditionsRequest
	if err := parseJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error(), "INVALID_REQUEST")
		return
	}

	if req.ScenarioID == "" || req.StartTime == "" {
		respondError(w, http.StatusBadRequest, "scenarioId and startTime are required", "INVALID_REQUEST")
		return
	}

	// Parse start time
	startTime, err := parseTime(req.StartTime)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid startTime format. Use ISO 8601", "INVALID_REQUEST")
		return
	}

	// Get scenario from simulation-core
	scenarioData, err := h.getScenarioFromCore(req.ScenarioID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get scenario: %v", err), "SCENARIO_ERROR")
		return
	}

	// Get SimDB password from database directly (since API masks it)
	simdbConfig, err := h.getSimDBPassword(req.ScenarioID)
	if err != nil {
		respondError(w, http.StatusBadRequest, fmt.Sprintf("SimDB not configured: %v", err), "NO_SIMDB_CONFIG")
		return
	}

	// Connect to SimDB
	client, err := simdb.Connect(*simdbConfig)
	if err != nil {
		respondError(w, http.StatusBadGateway, fmt.Sprintf("SimDB接続エラー: %v", err), "SIMDB_CONNECTION_ERROR")
		return
	}
	defer client.Close()

	// Get current works at start time
	works, err := client.GetCurrentWorks(startTime)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to query works: %v", err), "SIMDB_QUERY_ERROR")
		return
	}

	// Collect item IDs for quality status lookup
	var itemIDs []string
	for _, w := range works {
		itemIDs = append(itemIDs, w.ItemID)
	}

	// Get quality statuses
	qualityStatuses, err := client.GetQualityStatuses(itemIDs, startTime)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to query quality statuses: %v", err), "SIMDB_QUERY_ERROR")
		return
	}

	// Build location_id -> station_id mapping from scenario
	locationToStation := buildLocationToStationMap(scenarioData)

	// Build initial conditions
	result := simdb.BuildInitialConditions(works, qualityStatuses, locationToStation)

	respondJSON(w, http.StatusOK, InitialConditionsResponse{
		InitialConditions: result.Conditions,
		Warnings:          result.Warnings,
	})
}

// HandleExecute handles POST /api/executor/execute
func (h *Handler) HandleExecute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req ExecuteRequest
	if err := parseJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error(), "INVALID_REQUEST")
		return
	}

	if req.ScenarioID == "" {
		respondError(w, http.StatusBadRequest, "scenarioId is required", "INVALID_REQUEST")
		return
	}

	// Parse start time
	startTime, err := parseTime(req.StartTime)
	if err != nil {
		respondError(w, http.StatusBadRequest, "Invalid startTime format", "INVALID_REQUEST")
		return
	}

	// Calculate simulation time in seconds
	var simulationTime float64
	switch req.EndCondition.Type {
	case "duration":
		var minutes float64
		if _, err := fmt.Sscanf(req.EndCondition.Value, "%f", &minutes); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid duration value", "INVALID_REQUEST")
			return
		}
		simulationTime = minutes * 60
	case "absolute":
		endTime, err := parseTime(req.EndCondition.Value)
		if err != nil {
			respondError(w, http.StatusBadRequest, "Invalid absolute end time", "INVALID_REQUEST")
			return
		}
		simulationTime = endTime.Sub(startTime).Seconds()
		if simulationTime <= 0 {
			respondError(w, http.StatusBadRequest, "End time must be after start time", "INVALID_REQUEST")
			return
		}
	default:
		respondError(w, http.StatusBadRequest, "endCondition.type must be 'duration' or 'absolute'", "INVALID_REQUEST")
		return
	}

	// Marshal initial conditions
	initialConditionsJSON, err := json.Marshal(req.InitialConditions)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to marshal initial conditions", "INTERNAL_ERROR")
		return
	}

	// Create execution record
	executionID := uuid.New().String()
	now := time.Now()
	exec := &database.ExecutionConfig{
		ID:                executionID,
		ScenarioID:        req.ScenarioID,
		StartTime:         startTime,
		EndConditionType:  req.EndCondition.Type,
		EndConditionValue: req.EndCondition.Value,
		InitialConditions: initialConditionsJSON,
		Status:            "running",
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	if err := h.repo.SaveExecution(exec); err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to save execution: %v", err), "DB_ERROR")
		return
	}

	// Build simulation-core request
	simReq := map[string]interface{}{
		"scenarioId":        req.ScenarioID,
		"simulationTime":    simulationTime,
		"initialConditions": req.InitialConditions,
	}

	simReqJSON, err := json.Marshal(simReq)
	if err != nil {
		h.updateExecutionError(executionID, "Failed to build simulation request")
		respondError(w, http.StatusInternalServerError, "Failed to build simulation request", "INTERNAL_ERROR")
		return
	}

	// Call simulation-core API
	resp, err := http.Post(
		h.simulationCoreURL+"/api/simulations",
		"application/json",
		bytes.NewReader(simReqJSON),
	)
	if err != nil {
		h.updateExecutionError(executionID, fmt.Sprintf("Failed to call simulation-core: %v", err))
		respondError(w, http.StatusBadGateway, fmt.Sprintf("Failed to call simulation-core: %v", err), "SIMULATION_ERROR")
		return
	}
	defer resp.Body.Close()

	// Parse simulation response
	var simResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&simResp); err != nil {
		h.updateExecutionError(executionID, "Failed to parse simulation response")
		respondError(w, http.StatusInternalServerError, "Failed to parse simulation response", "SIMULATION_ERROR")
		return
	}

	if resp.StatusCode != http.StatusOK {
		errMsg := "Simulation failed"
		if msg, ok := simResp["message"].(string); ok {
			errMsg = msg
		}
		h.updateExecutionError(executionID, errMsg)
		respondError(w, resp.StatusCode, errMsg, "SIMULATION_ERROR")
		return
	}

	// Update execution with simulation result
	simulationID := ""
	if sid, ok := simResp["simulationId"].(string); ok {
		simulationID = sid
	}
	status := "completed"
	if s, ok := simResp["status"].(string); ok {
		status = s
	}

	if err := h.repo.UpdateExecutionStatus(executionID, status, &simulationID, nil); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update execution status", "DB_ERROR")
		return
	}

	execResp := ExecuteResponse{
		ExecutionID:  executionID,
		SimulationID: simulationID,
		Status:       status,
	}
	if et, ok := simResp["endTime"].(float64); ok {
		execResp.EndTime = et
	}
	if er, ok := simResp["endReason"].(string); ok {
		execResp.EndReason = er
	}

	respondJSON(w, http.StatusOK, execResp)
}

// HandleGetExecutions handles GET /api/executor/executions
func (h *Handler) HandleGetExecutions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	scenarioID := r.URL.Query().Get("scenarioId")
	if scenarioID == "" {
		respondError(w, http.StatusBadRequest, "scenarioId query parameter is required", "INVALID_REQUEST")
		return
	}

	executions, err := h.repo.GetExecutionsByScenarioID(scenarioID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to get executions: %v", err), "DB_ERROR")
		return
	}

	if executions == nil {
		executions = []database.ExecutionConfig{}
	}

	respondJSON(w, http.StatusOK, ExecutionListResponse{
		Executions: executions,
	})
}

// HandleGetScenarios handles GET /api/executor/scenarios (proxy with execution count)
func (h *Handler) HandleGetScenarios(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	resp, err := http.Get(h.simulationCoreURL + "/api/scenarios")
	if err != nil {
		respondError(w, http.StatusBadGateway, fmt.Sprintf("Failed to get scenarios: %v", err), "PROXY_ERROR")
		return
	}
	defer resp.Body.Close()

	var coreResp struct {
		Scenarios []struct {
			ScenarioID      string      `json:"scenarioId"`
			Name            string      `json:"name"`
			SimDBConfig     interface{} `json:"simdbConfig,omitempty"`
			StationCount    int         `json:"stationCount"`
			ConnectionCount int         `json:"connectionCount"`
		} `json:"scenarios"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&coreResp); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to parse scenarios response", "PROXY_ERROR")
		return
	}

	var scenarios []ScenarioWithExecutions
	for _, s := range coreResp.Scenarios {
		count, _ := h.repo.CountExecutionsByScenarioID(s.ScenarioID)
		scenarios = append(scenarios, ScenarioWithExecutions{
			ScenarioID:      s.ScenarioID,
			Name:            s.Name,
			SimDBConfig:     s.SimDBConfig,
			StationCount:    s.StationCount,
			ConnectionCount: s.ConnectionCount,
			ExecutionCount:  count,
		})
	}

	if scenarios == nil {
		scenarios = []ScenarioWithExecutions{}
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"scenarios": scenarios,
	})
}

// HandleTestConnection handles POST /api/executor/simdb/test-connection
func (h *Handler) HandleTestConnection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed", "")
		return
	}

	var req SimDBTestRequest
	if err := parseJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error(), "INVALID_REQUEST")
		return
	}

	if req.ScenarioID == "" {
		respondError(w, http.StatusBadRequest, "scenarioId is required", "INVALID_REQUEST")
		return
	}

	simdbConfig, err := h.getSimDBPassword(req.ScenarioID)
	if err != nil {
		respondJSON(w, http.StatusOK, SimDBTestResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to get SimDB config: %v", err),
		})
		return
	}

	client, err := simdb.Connect(*simdbConfig)
	if err != nil {
		respondJSON(w, http.StatusOK, SimDBTestResponse{
			Success: false,
			Message: fmt.Sprintf("接続失敗: %v", err),
		})
		return
	}
	defer client.Close()

	locations, err := client.GetLocationMaster()
	if err != nil {
		respondJSON(w, http.StatusOK, SimDBTestResponse{
			Success: true,
			Message: fmt.Sprintf("接続成功。LocationMaster取得失敗: %v", err),
		})
		return
	}

	respondJSON(w, http.StatusOK, SimDBTestResponse{
		Success:   true,
		Message:   fmt.Sprintf("接続成功。Location数: %d", len(locations)),
		Locations: locations,
	})
}

// --- Helper functions ---

// parseTime parses a time string in ISO 8601 format
func parseTime(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02T15:04:05", s)
	if err != nil {
		t, err = time.Parse("2006-01-02T15:04", s)
		if err != nil {
			return time.Time{}, fmt.Errorf("invalid time format: %s", s)
		}
	}
	return t, nil
}

// getScenarioFromCore fetches a scenario from simulation-core API
func (h *Handler) getScenarioFromCore(scenarioID string) (map[string]interface{}, error) {
	resp, err := http.Get(h.simulationCoreURL + "/api/scenarios/" + scenarioID)
	if err != nil {
		return nil, fmt.Errorf("failed to call simulation-core: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("scenario not found (status %d)", resp.StatusCode)
	}

	var data map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to parse scenario response: %w", err)
	}

	return data, nil
}

// getSimDBPassword reads SimDB config with password from the local database
func (h *Handler) getSimDBPassword(scenarioID string) (*simdb.SimDBConfig, error) {
	var host, dbname, user, password *string
	var port *int

	err := h.repo.GetDB().GetConnection().QueryRow(`
		SELECT simdb_host, simdb_port, simdb_database, simdb_user, simdb_password
		FROM scenarios
		WHERE id = $1
	`, scenarioID).Scan(&host, &port, &dbname, &user, &password)
	if err != nil {
		return nil, fmt.Errorf("failed to get SimDB config: %w", err)
	}

	if host == nil || *host == "" {
		return nil, fmt.Errorf("SimDB not configured for scenario %s", scenarioID)
	}

	config := &simdb.SimDBConfig{
		Host: *host,
		Port: 5432,
	}
	if port != nil {
		config.Port = *port
	}
	if dbname != nil {
		config.Database = *dbname
	}
	if user != nil {
		config.User = *user
	}
	if password != nil {
		config.Password = *password
	}

	return config, nil
}

// buildLocationToStationMap builds location_id -> station_id mapping from scenario data
func buildLocationToStationMap(scenarioData map[string]interface{}) map[int64]string {
	mapping := make(map[int64]string)

	stations, ok := scenarioData["stations"].([]interface{})
	if !ok {
		return mapping
	}

	for _, s := range stations {
		station, ok := s.(map[string]interface{})
		if !ok {
			continue
		}

		stationID, _ := station["id"].(string)
		locationID, ok := station["locationId"].(float64)
		if !ok || stationID == "" {
			continue
		}

		mapping[int64(locationID)] = stationID
	}

	return mapping
}

// updateExecutionError updates an execution with error status
func (h *Handler) updateExecutionError(executionID, errMsg string) {
	h.repo.UpdateExecutionStatus(executionID, "error", nil, &errMsg)
}
