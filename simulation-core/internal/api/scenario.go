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
	ID          string                 `json:"id"`
	Name        string                 `json:"name,omitempty"`
	Type        string                 `json:"type"`
	ParentID    *string                `json:"parentId"`
	LocationID  *int64                 `json:"locationId,omitempty"`
	Config      map[string]interface{} `json:"config"`
	PositionX   *float64               `json:"positionX,omitempty"`
	PositionY   *float64               `json:"positionY,omitempty"`
	SubScenario *SubScenarioRequest    `json:"subScenario,omitempty"`
	EntryCount  int                    `json:"entryCount,omitempty"`
	ExitCount   int                    `json:"exitCount,omitempty"`
}

// SubScenarioRequest represents the internal stations and connections of a ModulerStation
type SubScenarioRequest struct {
	Stations    []StationRequest    `json:"stations"`
	Connections []ConnectionRequest `json:"connections"`
}

// ConnectionRequest represents a connection in the request
type ConnectionRequest struct {
	From            string `json:"from"`
	To              string `json:"to"`
	Condition       string `json:"condition"`       // default, quality_ok, quality_ng
	FromPortIndex int    `json:"fromPortIndex"` // Split output port index (-1 = no port)
	ToPortIndex   int    `json:"toPortIndex"`   // Merge input port index (-1 = no port)
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
	FactoryID   *string             `json:"factoryId,omitempty"`
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
			// Validate ports array (support both "inPorts" and legacy "ports")
			ports := getPortsArray(st.Config, "inPorts", "ports")
			if len(ports) != int(mergeCount) {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: inPorts/ports must have exactly mergeCount (%d) entries", st.ID, int(mergeCount)))
				return
			}
			for idx, b := range ports {
				bm, ok := b.(map[string]interface{})
				if !ok {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: port[%d] is invalid", st.ID, idx))
					return
				}
				if cap, ok := bm["capacity"].(float64); ok && cap < 1 {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: port[%d].capacity must be >= 1", st.ID, idx))
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
			// Validate ports array (support both "outPorts" and legacy "ports")
			ports := getPortsArray(st.Config, "outPorts", "ports")
			if len(ports) != int(splitCount) {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: outPorts/ports must have exactly splitCount (%d) entries", st.ID, int(splitCount)))
				return
			}
			for idx, b := range ports {
				bm, ok := b.(map[string]interface{})
				if !ok {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: port[%d] is invalid", st.ID, idx))
					return
				}
				if cap, ok := bm["capacity"].(float64); ok && cap < 1 {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: port[%d].capacity must be >= 1", st.ID, idx))
					return
				}
			}
			// Validate processingTime >= 0
			if pt, ok := st.Config["processingTime"].(float64); ok && pt < 0 {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: processingTime must be >= 0", st.ID))
				return
			}
		}

		if st.Type == "machine" || st.Type == "moduler" /* backward compat */ {
			if st.EntryCount < 1 {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Machine station %s: entryCount must be >= 1", st.ID))
				return
			}
			if st.ExitCount < 1 {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Machine station %s: exitCount must be >= 1", st.ID))
				return
			}
			if st.SubScenario != nil {
				// Count entry/exit stations in SubScenario
				entryCount := 0
				exitCount := 0
				subIDs := make(map[string]bool)
				for _, sub := range st.SubScenario.Stations {
					if subIDs[sub.ID] {
						respondError(w, http.StatusBadRequest, fmt.Sprintf("Machine station %s: duplicate station ID '%s' in subScenario", st.ID, sub.ID))
						return
					}
					subIDs[sub.ID] = true
					if sub.Type == "entry" {
						entryCount++
					}
					if sub.Type == "exit" {
						exitCount++
					}
				}
				if entryCount != st.EntryCount {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Machine station %s: subScenario has %d entry stations but entryCount is %d", st.ID, entryCount, st.EntryCount))
					return
				}
				if exitCount != st.ExitCount {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Machine station %s: subScenario has %d exit stations but exitCount is %d", st.ID, exitCount, st.ExitCount))
					return
				}
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
	stations := convertStationRequests(req.Stations)
	connections := convertConnectionRequests(req.Connections)

	// Generate scenario ID using UUID
	scenarioID := uuid.New().String()

	scenario := domain.NewScenario(scenarioID, req.Name, stations, connections)
	scenario.FactoryID = req.FactoryID

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
	stations := convertStationRequests(req.Stations)
	connections := convertConnectionRequests(req.Connections)

	scenario := domain.NewScenario(scenarioID, req.Name, stations, connections)
	scenario.FactoryID = req.FactoryID

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

	// Migrate before caching so the cached pointer is already in the current format.
	// This prevents concurrent MigrateScenario calls on the same pointer (race condition).
	domain.MigrateScenario(scenario)

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
	if r.Method != http.MethodGet {
		respondError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Get all scenarios from database, filtered by factory_id if provided
	factoryID := r.URL.Query().Get("factory_id")
	scenarios, err := h.repo.ListScenarios(factoryID)
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
	stations := convertStationsToResponse(scenario.Stations)
	connections := convertConnectionsToResponse(scenario.Connections)

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

// convertStationRequests converts API station requests to domain stations (recursive for SubScenario)
func convertStationRequests(reqs []StationRequest) []domain.Station {
	stations := make([]domain.Station, len(reqs))
	for i, st := range reqs {
		rawType := st.Type
		if rawType == "moduler" {
			rawType = "machine" // backward compat
		}
		stationType := domain.StationType(rawType)
		stations[i] = *domain.NewStation(st.ID, stationType, st.Config)
		stations[i].Name = st.Name
		stations[i].ParentID = st.ParentID
		stations[i].LocationID = st.LocationID
		stations[i].PositionX = st.PositionX
		stations[i].PositionY = st.PositionY
		stations[i].EntryCount = st.EntryCount
		stations[i].ExitCount = st.ExitCount

		if st.SubScenario != nil {
			stations[i].SubScenario = &domain.SubScenario{
				Stations:    convertStationRequests(st.SubScenario.Stations),
				Connections: convertConnectionRequests(st.SubScenario.Connections),
			}
		}
	}
	return stations
}

// convertConnectionRequests converts API connection requests to domain connections
func convertConnectionRequests(reqs []ConnectionRequest) []domain.Connection {
	connections := make([]domain.Connection, len(reqs))
	for i, conn := range reqs {
		condition := conn.Condition
		if condition == "" {
			condition = "default"
		}
		connections[i] = domain.Connection{
			From:          conn.From,
			To:            conn.To,
			Condition:     domain.RoutingCondition(condition),
			FromPortIndex: conn.FromPortIndex,
			ToPortIndex:   conn.ToPortIndex,
		}
	}
	return connections
}

// convertStationsToResponse converts domain stations to API response (recursive for SubScenario)
func convertStationsToResponse(stations []domain.Station) []StationRequest {
	result := make([]StationRequest, len(stations))
	for i, st := range stations {
		result[i] = StationRequest{
			ID:         st.ID,
			Name:       st.Name,
			Type:       string(st.Type),
			ParentID:   st.ParentID,
			LocationID: st.LocationID,
			Config:     st.Config,
			PositionX:  st.PositionX,
			PositionY:  st.PositionY,
			EntryCount: st.EntryCount,
			ExitCount:  st.ExitCount,
		}
		if st.SubScenario != nil {
			result[i].SubScenario = &SubScenarioRequest{
				Stations:    convertStationsToResponse(st.SubScenario.Stations),
				Connections: convertConnectionsToResponse(st.SubScenario.Connections),
			}
		}
	}
	return result
}

// getPortsArray retrieves a ports array from config, trying newKey first then fallback to legacyKey.
func getPortsArray(config map[string]interface{}, newKey, legacyKey string) []interface{} {
	for _, key := range []string{newKey, legacyKey} {
		if val, ok := config[key]; ok {
			if arr, ok := val.([]interface{}); ok {
				return arr
			}
		}
	}
	return nil
}

// convertConnectionsToResponse converts domain connections to API response
func convertConnectionsToResponse(connections []domain.Connection) []ConnectionRequest {
	result := make([]ConnectionRequest, len(connections))
	for i, conn := range connections {
		result[i] = ConnectionRequest{
			From:          conn.From,
			To:            conn.To,
			Condition:     string(conn.Condition),
			FromPortIndex: conn.FromPortIndex,
			ToPortIndex:   conn.ToPortIndex,
		}
	}
	return result
}
