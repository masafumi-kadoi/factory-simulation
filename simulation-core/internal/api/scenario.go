package api

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

func formatTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

// StationRequest represents a station in the request
type StationRequest struct {
	ID         string                 `json:"id"`
	Name       string                 `json:"name,omitempty"`
	Type       string                 `json:"type"`
	ParentID   *string                `json:"parentId"`
	LocationID *int64                 `json:"locationId,omitempty"`
	Config     map[string]interface{} `json:"config"`
	PositionX  *float64               `json:"positionX,omitempty"`
	PositionY  *float64               `json:"positionY,omitempty"`
}

// ConnectionRequest represents a connection in the request
type ConnectionRequest struct {
	From            string `json:"from"`
	To              string `json:"to"`
	Condition       string `json:"condition"`       // default, quality_ok, quality_ng
	FromBufferIndex int    `json:"fromBufferIndex"` // Split output buffer index (-1 = no buffer)
	ToBufferIndex   int    `json:"toBufferIndex"`   // Merge input buffer index (-1 = no buffer)
}

// SimDBConfigRequest represents SimDB connection settings in the request
type SimDBConfigRequest struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password,omitempty"`
}

// ScenarioRequest represents a POST /api/scenarios request
type ScenarioRequest struct {
	Name        string              `json:"name"`
	SimDBConfig *SimDBConfigRequest `json:"simdbConfig,omitempty"`
	Stations    []StationRequest    `json:"stations"`
	Connections []ConnectionRequest `json:"connections"`
}

// ScenarioResponse represents a POST /api/scenarios response
type ScenarioResponse struct {
	ScenarioID string `json:"scenarioId"`
}

// HandleCreateScenario handles POST /api/scenarios
func (h *Handler) HandleCreateScenario(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req ScenarioRequest
	if err := parseJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Validate request
	if req.Name == "" {
		respondError(w, http.StatusBadRequest, "Scenario name is required")
		return
	}
	if len(req.Stations) == 0 {
		respondError(w, http.StatusBadRequest, "At least one station is required")
		return
	}

	// Validate station configurations
	for _, st := range req.Stations {
		if st.Type == "merge" {
			// Validate mergeCount
			mergeCount, ok := st.Config["mergeCount"].(float64)
			if !ok || mergeCount < 1 {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: mergeCount must be >= 1", st.ID))
				return
			}
			// Validate buffers array
			buffers, ok := st.Config["buffers"].([]interface{})
			if !ok || len(buffers) != int(mergeCount) {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: buffers must have exactly mergeCount (%d) entries", st.ID, int(mergeCount)))
				return
			}
			for idx, b := range buffers {
				bm, ok := b.(map[string]interface{})
				if !ok {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: buffer[%d] is invalid", st.ID, idx))
					return
				}
				if cap, ok := bm["capacity"].(float64); ok && cap < 1 {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: buffer[%d].capacity must be >= 1", st.ID, idx))
					return
				}
			}
			// Validate outputWorkType
			if _, ok := st.Config["outputWorkType"].(string); !ok {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: outputWorkType is required", st.ID))
				return
			}
			// Validate processingTime >= 0
			if pt, ok := st.Config["processingTime"].(float64); ok && pt < 0 {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: processingTime must be >= 0", st.ID))
				return
			}
		}

		if st.Type == "split" {
			// Validate splitCount
			splitCount, ok := st.Config["splitCount"].(float64)
			if !ok || splitCount < 1 {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: splitCount must be >= 1", st.ID))
				return
			}
			// Validate buffers array
			buffers, ok := st.Config["buffers"].([]interface{})
			if !ok || len(buffers) != int(splitCount) {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: buffers must have exactly splitCount (%d) entries", st.ID, int(splitCount)))
				return
			}
			for idx, b := range buffers {
				bm, ok := b.(map[string]interface{})
				if !ok {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: buffer[%d] is invalid", st.ID, idx))
					return
				}
				if cap, ok := bm["capacity"].(float64); ok && cap < 1 {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: buffer[%d].capacity must be >= 1", st.ID, idx))
					return
				}
			}
			// Validate processingTime >= 0
			if pt, ok := st.Config["processingTime"].(float64); ok && pt < 0 {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: processingTime must be >= 0", st.ID))
				return
			}
		}

		if st.Type == "inspection" {
			if okProbability, ok := st.Config["okProbability"].(float64); ok {
				if okProbability < 0.0 || okProbability > 1.0 {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Inspection station %s: okProbability must be between 0.0 and 1.0", st.ID))
					return
				}
			} else {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Inspection station %s: okProbability is required", st.ID))
				return
			}
		}
	}

	// Validate discharge stations have at least 2 next stations
	for _, st := range req.Stations {
		if st.Type == "discharge" {
			nextStationCount := 0
			for _, conn := range req.Connections {
				if conn.From == st.ID {
					nextStationCount++
				}
			}
			if nextStationCount < 2 {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Discharge station %s: requires at least 2 next stations (OK route and NG route)", st.ID))
				return
			}
		}
	}

	// Convert request to domain model
	stations := make([]domain.Station, len(req.Stations))
	for i, st := range req.Stations {
		stationType := domain.StationType(st.Type)
		stations[i] = *domain.NewStation(st.ID, stationType, st.Config)
		stations[i].Name = st.Name
		stations[i].ParentID = st.ParentID
		stations[i].LocationID = st.LocationID
		stations[i].PositionX = st.PositionX
		stations[i].PositionY = st.PositionY
	}

	connections := make([]domain.Connection, len(req.Connections))
	for i, conn := range req.Connections {
		// Default condition if not specified
		condition := conn.Condition
		if condition == "" {
			condition = "default"
		}
		connections[i] = domain.Connection{
			From:            conn.From,
			To:              conn.To,
			Condition:       domain.RoutingCondition(condition),
			FromBufferIndex: conn.FromBufferIndex,
			ToBufferIndex:   conn.ToBufferIndex,
		}
	}

	// Generate scenario ID using UUID
	scenarioID := uuid.New().String()

	scenario := domain.NewScenario(scenarioID, req.Name, stations, connections)

	// Set SimDB config if provided
	if req.SimDBConfig != nil {
		scenario.SimDBConfig = &domain.SimDBConfig{
			Host:     req.SimDBConfig.Host,
			Port:     req.SimDBConfig.Port,
			Database: req.SimDBConfig.Database,
			User:     req.SimDBConfig.User,
			Password: req.SimDBConfig.Password,
		}
	}

	// Store scenario in memory (for backward compatibility)
	h.mu.Lock()
	h.scenarios[scenarioID] = scenario
	h.mu.Unlock()

	// Save scenario to database
	if err := h.repo.SaveScenario(scenario); err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to save scenario: %v", err))
		return
	}

	respondJSON(w, http.StatusCreated, ScenarioResponse{
		ScenarioID: scenarioID,
	})
}

// HandleUpdateScenario handles PUT /api/scenarios/:id
func (h *Handler) HandleUpdateScenario(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Extract scenario ID from path
	scenarioID := r.URL.Path[len("/api/scenarios/"):]
	if scenarioID == "" {
		respondError(w, http.StatusBadRequest, "Scenario ID is required")
		return
	}

	var req ScenarioRequest
	if err := parseJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Validate request
	if req.Name == "" {
		respondError(w, http.StatusBadRequest, "Scenario name is required")
		return
	}
	if len(req.Stations) == 0 {
		respondError(w, http.StatusBadRequest, "At least one station is required")
		return
	}

	// Convert request to domain model
	stations := make([]domain.Station, len(req.Stations))
	for i, st := range req.Stations {
		stationType := domain.StationType(st.Type)
		stations[i] = *domain.NewStation(st.ID, stationType, st.Config)
		stations[i].Name = st.Name
		stations[i].ParentID = st.ParentID
		stations[i].LocationID = st.LocationID
		stations[i].PositionX = st.PositionX
		stations[i].PositionY = st.PositionY
	}

	connections := make([]domain.Connection, len(req.Connections))
	for i, conn := range req.Connections {
		condition := conn.Condition
		if condition == "" {
			condition = "default"
		}
		connections[i] = domain.Connection{
			From:            conn.From,
			To:              conn.To,
			Condition:       domain.RoutingCondition(condition),
			FromBufferIndex: conn.FromBufferIndex,
			ToBufferIndex:   conn.ToBufferIndex,
		}
	}

	scenario := domain.NewScenario(scenarioID, req.Name, stations, connections)

	// Set SimDB config if provided
	if req.SimDBConfig != nil {
		scenario.SimDBConfig = &domain.SimDBConfig{
			Host:     req.SimDBConfig.Host,
			Port:     req.SimDBConfig.Port,
			Database: req.SimDBConfig.Database,
			User:     req.SimDBConfig.User,
			Password: req.SimDBConfig.Password,
		}
	}

	// Update in memory
	h.mu.Lock()
	h.scenarios[scenarioID] = scenario
	h.mu.Unlock()

	// Save to database (ON CONFLICT DO UPDATE handles the overwrite)
	if err := h.repo.SaveScenario(scenario); err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to update scenario: %v", err))
		return
	}

	respondJSON(w, http.StatusOK, ScenarioResponse{
		ScenarioID: scenarioID,
	})
}

// HandleDeleteScenario handles DELETE /api/scenarios/:id
func (h *Handler) HandleDeleteScenario(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	scenarioID := r.URL.Path[len("/api/scenarios/"):]
	if scenarioID == "" {
		respondError(w, http.StatusBadRequest, "Scenario ID is required")
		return
	}

	// Remove from memory cache
	h.mu.Lock()
	delete(h.scenarios, scenarioID)
	h.mu.Unlock()

	// Delete from database
	if err := h.repo.DeleteScenario(scenarioID); err != nil {
		respondError(w, http.StatusNotFound, fmt.Sprintf("Failed to delete scenario: %v", err))
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "Scenario deleted"})
}

// GetScenario retrieves a scenario by ID
func (h *Handler) GetScenario(scenarioID string) (*domain.Scenario, error) {
	// Try to get from memory first
	h.mu.RLock()
	scenario, ok := h.scenarios[scenarioID]
	h.mu.RUnlock()

	if ok {
		return scenario, nil
	}

	// If not in memory, try to get from database
	scenario, err := h.repo.GetScenario(scenarioID)
	if err != nil {
		return nil, fmt.Errorf("scenario not found: %s", scenarioID)
	}

	// Cache in memory for future use
	h.mu.Lock()
	h.scenarios[scenarioID] = scenario
	h.mu.Unlock()

	return scenario, nil
}

// ScenarioDetailResponse represents a GET /api/scenarios/:id response
type ScenarioDetailResponse struct {
	ScenarioID  string              `json:"scenarioId"`
	Name        string              `json:"name"`
	SimDBConfig *SimDBConfigRequest `json:"simdbConfig,omitempty"`
	Stations    []StationRequest    `json:"stations"`
	Connections []ConnectionRequest `json:"connections"`
	CreatedAt   *string             `json:"createdAt,omitempty"`
	UpdatedAt   *string             `json:"updatedAt,omitempty"`
}

// ScenarioListItem represents a single scenario in the list
type ScenarioListItem struct {
	ScenarioID      string              `json:"scenarioId"`
	Name            string              `json:"name"`
	SimDBConfig     *SimDBConfigRequest `json:"simdbConfig,omitempty"`
	StationCount    int                 `json:"stationCount"`
	ConnectionCount int                 `json:"connectionCount"`
	CreatedAt       *string             `json:"createdAt,omitempty"`
	UpdatedAt       *string             `json:"updatedAt,omitempty"`
}

// ScenarioListResponse represents a GET /api/scenarios response
type ScenarioListResponse struct {
	Scenarios []ScenarioListItem `json:"scenarios"`
}

// HandleListScenarios handles GET /api/scenarios
func (h *Handler) HandleListScenarios(w http.ResponseWriter, r *http.Request) {
	fmt.Printf("HandleListScenarios called: Method=%s, Path=%s\n", r.Method, r.URL.Path)
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Get all scenarios from database
	scenarios, err := h.repo.ListScenarios()
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to list scenarios: %v", err))
		return
	}

	// Convert to response format
	items := make([]ScenarioListItem, len(scenarios))
	for i, scenario := range scenarios {
		var simdbConfig *SimDBConfigRequest
		if scenario.SimDBConfig != nil {
			simdbConfig = &SimDBConfigRequest{
				Host:     scenario.SimDBConfig.Host,
				Port:     scenario.SimDBConfig.Port,
				Database: scenario.SimDBConfig.Database,
				User:     scenario.SimDBConfig.User,
			}
		}
		items[i] = ScenarioListItem{
			ScenarioID:      scenario.ID,
			Name:            scenario.Name,
			SimDBConfig:     simdbConfig,
			StationCount:    len(scenario.Stations),
			ConnectionCount: len(scenario.Connections),
			CreatedAt:       formatTime(scenario.CreatedAt),
			UpdatedAt:       formatTime(scenario.UpdatedAt),
		}
	}

	respondJSON(w, http.StatusOK, ScenarioListResponse{
		Scenarios: items,
	})
}

// HandleGetScenario handles GET /api/scenarios/:id
func (h *Handler) HandleGetScenario(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Extract scenario ID from path
	// Path format: /api/scenarios/scenario-1
	scenarioID := r.URL.Path[len("/api/scenarios/"):]
	if scenarioID == "" {
		respondError(w, http.StatusBadRequest, "Scenario ID is required")
		return
	}

	scenario, err := h.GetScenario(scenarioID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	// Convert domain model to response
	stations := make([]StationRequest, len(scenario.Stations))
	for i, st := range scenario.Stations {
		stations[i] = StationRequest{
			ID:         st.ID,
			Name:       st.Name,
			Type:       string(st.Type),
			ParentID:   st.ParentID,
			LocationID: st.LocationID,
			Config:     st.Config,
			PositionX:  st.PositionX,
			PositionY:  st.PositionY,
		}
	}

	connections := make([]ConnectionRequest, len(scenario.Connections))
	for i, conn := range scenario.Connections {
		connections[i] = ConnectionRequest{
			From:            conn.From,
			To:              conn.To,
			Condition:       string(conn.Condition),
			FromBufferIndex: conn.FromBufferIndex,
			ToBufferIndex:   conn.ToBufferIndex,
		}
	}

	// Build SimDB config response (password masked)
	var simdbConfig *SimDBConfigRequest
	if scenario.SimDBConfig != nil {
		simdbConfig = &SimDBConfigRequest{
			Host:     scenario.SimDBConfig.Host,
			Port:     scenario.SimDBConfig.Port,
			Database: scenario.SimDBConfig.Database,
			User:     scenario.SimDBConfig.User,
		}
	}

	respondJSON(w, http.StatusOK, ScenarioDetailResponse{
		ScenarioID:  scenario.ID,
		Name:        scenario.Name,
		SimDBConfig: simdbConfig,
		Stations:    stations,
		Connections: connections,
		CreatedAt:   formatTime(scenario.CreatedAt),
		UpdatedAt:   formatTime(scenario.UpdatedAt),
	})
}
