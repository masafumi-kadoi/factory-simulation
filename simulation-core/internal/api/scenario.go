package api

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
	"net/http"

	"github.com/google/uuid"
)

// StationRequest represents a station in the request
type StationRequest struct {
	ID       string                 `json:"id"`
	Type     string                 `json:"type"`
	ParentID *string                `json:"parentId"`
	Config   map[string]interface{} `json:"config"`
}

// ConnectionRequest represents a connection in the request
type ConnectionRequest struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Condition string `json:"condition"` // default, quality_ok, quality_ng
}

// ScenarioRequest represents a POST /api/scenarios request
type ScenarioRequest struct {
	Name        string              `json:"name"`
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
			if requiredWorkCount, ok := st.Config["requiredWorkCount"].(float64); ok {
				if requiredWorkCount <= 0 {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: requiredWorkCount must be positive", st.ID))
					return
				}
			} else {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Merge station %s: requiredWorkCount is required", st.ID))
				return
			}
		}

		if st.Type == "split" {
			if outputWorkCount, ok := st.Config["outputWorkCount"].(float64); ok {
				if outputWorkCount <= 0 {
					respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: outputWorkCount must be positive", st.ID))
					return
				}
			} else {
				respondError(w, http.StatusBadRequest, fmt.Sprintf("Split station %s: outputWorkCount is required", st.ID))
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
		stations[i].ParentID = st.ParentID
	}

	connections := make([]domain.Connection, len(req.Connections))
	for i, conn := range req.Connections {
		// Default condition if not specified
		condition := conn.Condition
		if condition == "" {
			condition = "default"
		}
		connections[i] = domain.Connection{
			From:      conn.From,
			To:        conn.To,
			Condition: domain.RoutingCondition(condition),
		}
	}

	// Generate scenario ID using UUID
	scenarioID := uuid.New().String()

	scenario := domain.NewScenario(scenarioID, req.Name, stations, connections)

	// Store scenario in memory
	h.mu.Lock()
	h.scenarios[scenarioID] = scenario
	h.mu.Unlock()

	respondJSON(w, http.StatusCreated, ScenarioResponse{
		ScenarioID: scenarioID,
	})
}

// GetScenario retrieves a scenario by ID
func (h *Handler) GetScenario(scenarioID string) (*domain.Scenario, error) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	scenario, ok := h.scenarios[scenarioID]
	if !ok {
		return nil, fmt.Errorf("scenario not found: %s", scenarioID)
	}

	return scenario, nil
}

// ScenarioDetailResponse represents a GET /api/scenarios/:id response
type ScenarioDetailResponse struct {
	ScenarioID  string              `json:"scenarioId"`
	Name        string              `json:"name"`
	Stations    []StationRequest    `json:"stations"`
	Connections []ConnectionRequest `json:"connections"`
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
			ID:       st.ID,
			Type:     string(st.Type),
			ParentID: st.ParentID,
			Config:   st.Config,
		}
	}

	connections := make([]ConnectionRequest, len(scenario.Connections))
	for i, conn := range scenario.Connections {
		connections[i] = ConnectionRequest{
			From:      conn.From,
			To:        conn.To,
			Condition: string(conn.Condition),
		}
	}

	respondJSON(w, http.StatusOK, ScenarioDetailResponse{
		ScenarioID:  scenario.ID,
		Name:        scenario.Name,
		Stations:    stations,
		Connections: connections,
	})
}
