package api

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
	"net/http"
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
	From string `json:"from"`
	To   string `json:"to"`
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

	// Convert request to domain model
	stations := make([]domain.Station, len(req.Stations))
	for i, st := range req.Stations {
		stationType := domain.StationType(st.Type)
		stations[i] = *domain.NewStation(st.ID, stationType, st.Config)
		stations[i].ParentID = st.ParentID
	}

	connections := make([]domain.Connection, len(req.Connections))
	for i, conn := range req.Connections {
		connections[i] = domain.Connection{
			From: conn.From,
			To:   conn.To,
		}
	}

	// Generate scenario ID
	scenarioID := fmt.Sprintf("scenario-%d", len(h.scenarios)+1)

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
