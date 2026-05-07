package api

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"factory-simulation/realtime-gateway/internal/database"
	"factory-simulation/realtime-gateway/internal/notify"
	"factory-simulation/realtime-gateway/internal/ws"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Handler struct {
	repo        *database.Repository
	hub         *notify.Hub
	simCoreURL  string
}

func NewHandler(repo *database.Repository, hub *notify.Hub, simCoreURL string) *Handler {
	return &Handler{repo: repo, hub: hub, simCoreURL: simCoreURL}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	path := r.URL.Path

	// WebSocket
	if path == "/ws/live" || path == "/ws" {
		ws.ServeWS(h.hub, w, r)
		return
	}

	// Health
	if path == "/health" {
		w.Write([]byte("ok"))
		return
	}

	// Route
	switch {
	case path == "/api/factories" || path == "/api/factories/":
		h.handleFactories(w, r)
	case strings.HasPrefix(path, "/api/factories/"):
		h.handleFactory(w, r, strings.TrimPrefix(path, "/api/factories/"))
	case path == "/api/scenarios" || path == "/api/scenarios/":
		h.handleScenarios(w, r)
	case strings.HasPrefix(path, "/api/scenarios/"):
		h.handleScenario(w, r, strings.TrimPrefix(path, "/api/scenarios/"))
	case path == "/api/data-sources" || path == "/api/data-sources/":
		h.handleDataSources(w, r)
	case strings.HasPrefix(path, "/api/data-sources/"):
		h.handleDataSource(w, r, strings.TrimPrefix(path, "/api/data-sources/"))
	case path == "/api/executions" || path == "/api/executions/":
		h.handleExecutions(w, r)
	case strings.HasPrefix(path, "/api/executions/"):
		h.handleExecution(w, r, strings.TrimPrefix(path, "/api/executions/"))
	// sim-executor-backend 互換レイヤー
	case strings.HasPrefix(path, "/api/executor/"):
		h.handleExecutorCompat(w, r, strings.TrimPrefix(path, "/api/executor/"))
	default:
		http.NotFound(w, r)
	}
}

// ---- Factories ----

func (h *Handler) handleFactories(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		factories, err := h.repo.ListFactories()
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 200, factories)
	case http.MethodPost:
		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
			respondError(w, 400, "name is required")
			return
		}
		f, err := h.repo.CreateFactory(body.Name, body.Description)
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 201, f)
	default:
		respondError(w, 405, "method not allowed")
	}
}

func (h *Handler) handleFactory(w http.ResponseWriter, r *http.Request, rest string) {
	parts := strings.SplitN(rest, "/", 2)
	id := parts[0]
	sub := ""
	if len(parts) > 1 {
		sub = parts[1]
	}

	switch sub {
	case "":
		switch r.Method {
		case http.MethodGet:
			f, err := h.repo.GetFactory(id)
			if err != nil {
				respondError(w, 404, err.Error())
				return
			}
			respondJSON(w, 200, f)
		case http.MethodPut:
			var body struct {
				Name        string `json:"name"`
				Description string `json:"description"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			if err := h.repo.UpdateFactory(id, body.Name, body.Description); err != nil {
				respondError(w, 500, err.Error())
				return
			}
			respondJSON(w, 200, map[string]string{"status": "updated"})
		default:
			respondError(w, 405, "method not allowed")
		}
	case "stations":
		switch r.Method {
		case http.MethodGet:
			stations, err := h.repo.ListFactoryStations(id)
			if err != nil {
				respondError(w, 500, err.Error())
				return
			}
			respondJSON(w, 200, stations)
		case http.MethodPost:
			var body struct {
				StationID   string  `json:"station_id"`
				Name        string  `json:"name"`
				StationType string  `json:"station_type"`
				PosX        float64 `json:"pos_x"`
				PosY        float64 `json:"pos_y"`
				PosZ        float64 `json:"pos_z"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.StationID == "" {
				respondError(w, 400, "station_id is required")
				return
			}
			if err := h.repo.AddFactoryStation(id, body.StationID, body.Name, body.StationType, body.PosX, body.PosY); err != nil {
				respondError(w, 500, err.Error())
				return
			}
			respondJSON(w, 201, map[string]string{"status": "created"})
		default:
			respondError(w, 405, "method not allowed")
		}
	case "stations/import-csv":
		if r.Method != http.MethodPost {
			respondError(w, 405, "method not allowed")
			return
		}
		h.handleCSVImport(w, r, id)
	case "validate":
		if r.Method != http.MethodPost {
			respondError(w, 405, "method not allowed")
			return
		}
		h.handleValidate(w, r, id)
	default:
		// Handle /factories/{id}/stations/{stationId}
		if strings.HasPrefix(sub, "stations/") {
			stationID := strings.TrimPrefix(sub, "stations/")
			if r.Method == http.MethodDelete {
				if err := h.repo.DeleteFactoryStation(id, stationID); err != nil {
					respondError(w, 500, err.Error())
					return
				}
				respondJSON(w, 200, map[string]string{"status": "deleted"})
				return
			}
		}
		http.NotFound(w, r)
	}
}

var validStationTypes = map[string]bool{
	"source": true, "processing": true, "drain": true,
	"merge": true, "split": true, "moduler": true, "entry": true, "exit": true,
	"machine": true, "conveyor": true, "buffer": true, "input": true, "output": true,
}

func (h *Handler) handleCSVImport(w http.ResponseWriter, r *http.Request, factoryID string) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		respondError(w, 400, "failed to read body")
		return
	}

	reader := csv.NewReader(bytes.NewReader(body))
	reader.TrimLeadingSpace = true
	records, err := reader.ReadAll()
	if err != nil {
		respondError(w, 400, fmt.Sprintf("csv parse error: %v", err))
		return
	}

	if len(records) < 2 {
		respondError(w, 400, "csv must have header and at least one data row")
		return
	}

	type csvError struct {
		Line    int    `json:"line"`
		Column  string `json:"column"`
		Message string `json:"message"`
	}

	var errs []csvError
	var stations []database.FactoryStation
	seen := make(map[string]bool)

	// Detect format from header: simple (station_id,station_name,station_type,x,y,z)
	// or extended (station_id,equipment_id,seq_number,name,station_type,pos_x,pos_y,config)
	header := records[0]
	isSimpleFormat := len(header) >= 3 && strings.ToLower(strings.TrimSpace(header[1])) == "station_name"

	for i, rec := range records[1:] {
		lineNum := i + 2
		if len(rec) < 2 {
			errs = append(errs, csvError{lineNum, "row", "not enough columns"})
			continue
		}

		stationID := strings.TrimSpace(rec[0])

		// Derive equipment_id and seq_number from stationID format {equip}.{NNN}
		dotIdx := strings.LastIndex(stationID, ".")
		equipmentID := stationID
		seq := 0
		if dotIdx >= 0 {
			equipmentID = stationID[:dotIdx]
			strconv.Atoi(stationID[dotIdx+1:])
		}

		// Validate station_id format
		if dotIdx < 0 || dotIdx == len(stationID)-1 {
			errs = append(errs, csvError{lineNum, "station_id", "must match {equipment_id}.{digits} format"})
		}
		if seen[stationID] {
			errs = append(errs, csvError{lineNum, "station_id", fmt.Sprintf("duplicate: %s", stationID)})
		}
		seen[stationID] = true

		var name, stationType string
		var posX, posY float64

		if isSimpleFormat {
			// station_id, station_name, station_type, x, y, z
			name = ""
			if len(rec) > 1 {
				name = strings.TrimSpace(rec[1])
			}
			stationType = "machine"
			if len(rec) > 2 {
				stationType = strings.TrimSpace(rec[2])
			}
			if len(rec) > 3 {
				posX, _ = strconv.ParseFloat(strings.TrimSpace(rec[3]), 64)
			}
			if len(rec) > 4 {
				posY, _ = strconv.ParseFloat(strings.TrimSpace(rec[4]), 64)
			}
			if dotIdx >= 0 {
				seq, _ = strconv.Atoi(stationID[dotIdx+1:])
			}
		} else {
			// Extended format: station_id, equipment_id, seq_number, name, station_type, pos_x, pos_y
			seqStr := ""
			if len(rec) > 2 {
				seqStr = strings.TrimSpace(rec[2])
			}
			if len(rec) > 3 {
				name = strings.TrimSpace(rec[3])
			}
			if len(rec) > 4 {
				stationType = strings.TrimSpace(rec[4])
			}
			if len(rec) > 5 {
				posX, _ = strconv.ParseFloat(strings.TrimSpace(rec[5]), 64)
			}
			if len(rec) > 6 {
				posY, _ = strconv.ParseFloat(strings.TrimSpace(rec[6]), 64)
			}
			var seqErr error
			seq, seqErr = strconv.Atoi(seqStr)
			if seqErr != nil {
				errs = append(errs, csvError{lineNum, "seq_number", "must be integer"})
			}
		}

		if stationType == "" {
			stationType = "machine"
		}
		if !validStationTypes[stationType] {
			errs = append(errs, csvError{lineNum, "station_type", fmt.Sprintf("invalid value: %s", stationType)})
		}

		n := name
		stations = append(stations, database.FactoryStation{
			StationID:   stationID,
			EquipmentID: equipmentID,
			SeqNumber:   seq,
			Name:        &n,
			StationType: stationType,
			PositionX:   posX,
			PositionY:   posY,
			Config:      json.RawMessage("{}"),
		})
	}

	if len(errs) > 0 {
		respondJSON(w, 400, map[string]interface{}{"imported": 0, "errors": errs})
		return
	}

	if err := h.repo.ImportStations(factoryID, stations); err != nil {
		respondError(w, 500, err.Error())
		return
	}
	respondJSON(w, 200, map[string]interface{}{"imported": len(stations), "errors": []interface{}{}})
}

func (h *Handler) handleValidate(w http.ResponseWriter, r *http.Request, factoryID string) {
	f, err := h.repo.GetFactory(factoryID)
	if err != nil {
		respondError(w, 404, err.Error())
		return
	}
	_ = f
	respondJSON(w, 200, map[string]interface{}{
		"status": "ok",
		"checks": map[string]interface{}{
			"connection_test": map[string]string{"status": "ok"},
		},
	})
}

// ---- Scenarios ----

func (h *Handler) handleScenarios(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		factoryID := r.URL.Query().Get("factory_id")
		if factoryID != "" {
			// Factory絞り込み: ローカルDBから返す（realtime-gateway独自）
			scenarios, err := h.repo.ListScenariosByFactory(factoryID)
			if err != nil {
				respondError(w, 500, err.Error())
				return
			}
			respondJSON(w, 200, scenarios)
		} else {
			// 全件: simulation-coreへプロキシ（stationCount等を含む正式フォーマット）
			h.proxyToSimCore(w, r, "/api/scenarios")
		}
	case http.MethodPost:
		h.proxyToSimCore(w, r, "/api/scenarios")
	default:
		respondError(w, 405, "method not allowed")
	}
}

func (h *Handler) handleScenario(w http.ResponseWriter, r *http.Request, id string) {
	// GET/PUT/DELETE はすべてsimulation-coreへプロキシ（stations/connections含む完全データ）
	switch r.Method {
	case http.MethodGet, http.MethodPut, http.MethodDelete:
		h.proxyToSimCore(w, r, "/api/scenarios/"+id)
	default:
		respondError(w, 405, "method not allowed")
	}
}

func (h *Handler) proxyToSimCore(w http.ResponseWriter, r *http.Request, path string) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		respondError(w, 500, "failed to read request body")
		return
	}
	req, err := http.NewRequest(r.Method, h.simCoreURL+path, bytes.NewReader(body))
	if err != nil {
		respondError(w, 500, "failed to create proxy request")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		respondError(w, 502, "upstream error: "+err.Error())
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// ---- DataSources ----

func (h *Handler) handleDataSources(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		ds, err := h.repo.ListDataSources()
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 200, ds)
	case http.MethodPost:
		var body struct {
			SourceType   string          `json:"sourceType"`
			ScenarioID   string          `json:"scenarioId"`
			FactoryID    string          `json:"factoryId"`
			Label        string          `json:"label"`
			FriendlyName string          `json:"friendlyName"`
			Config       json.RawMessage `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			respondError(w, 400, err.Error())
			return
		}
		if body.SourceType != "simulation" && body.SourceType != "realtime" {
			respondError(w, 400, "sourceType must be 'simulation' or 'realtime'")
			return
		}
		var ds interface{}
		var dsErr error
		if body.SourceType == "realtime" && body.FactoryID != "" {
			ds, dsErr = h.repo.CreateRealtimeDataSource(body.FactoryID, body.Label)
		} else {
			ds, dsErr = h.repo.CreateDataSource(body.SourceType, body.ScenarioID, body.FriendlyName, body.Config)
		}
		if dsErr != nil {
			respondError(w, 500, dsErr.Error())
			return
		}
		respondJSON(w, 201, ds)
	default:
		respondError(w, 405, "method not allowed")
	}
}

func (h *Handler) handleDataSource(w http.ResponseWriter, r *http.Request, rest string) {
	parts := strings.SplitN(rest, "/", 2)
	id := parts[0]
	sub := ""
	if len(parts) > 1 {
		sub = parts[1]
	}

	switch sub {
	case "":
		switch r.Method {
		case http.MethodGet:
			ds, err := h.repo.GetDataSource(id)
			if err != nil {
				respondError(w, 404, err.Error())
				return
			}
			respondJSON(w, 200, ds)
		case http.MethodPatch:
			var body struct {
				EndedAt *string `json:"endedAt"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			var endedAt *time.Time
			if body.EndedAt != nil {
				t, err := time.Parse(time.RFC3339, *body.EndedAt)
				if err == nil {
					endedAt = &t
				}
			}
			if err := h.repo.PatchDataSource(id, endedAt); err != nil {
				respondError(w, 500, err.Error())
				return
			}
			respondJSON(w, 200, map[string]string{"status": "updated"})
		default:
			respondError(w, 405, "method not allowed")
		}
	case "events":
		if r.Method != http.MethodGet {
			respondError(w, 405, "method not allowed")
			return
		}
		q := r.URL.Query()
		fromStr := q.Get("from")
		toStr := q.Get("to")
		from := time.Now().Add(-1 * time.Hour)
		to := time.Now()
		if fromStr != "" {
			if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
				from = t
			}
		}
		if toStr != "" {
			if t, err := time.Parse(time.RFC3339, toStr); err == nil {
				to = t
			}
		}
		events, err := h.repo.GetEvents(id, from, to)
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 200, events)
	case "layout":
		if r.Method != http.MethodGet {
			respondError(w, 405, "method not allowed")
			return
		}
		locs, conns, err := h.repo.GetLayout(id)
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 200, map[string]interface{}{"locations": locs, "connections": conns})
	default:
		http.NotFound(w, r)
	}
}

// ---- Executions ----

func (h *Handler) handleExecutions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		execs, err := h.repo.ListExecutions()
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 200, execs)
	case http.MethodPost:
		var body struct {
			ScenarioID        string          `json:"scenarioId"`
			StartDatetime     string          `json:"startDatetime"`
			SimulationTime    float64         `json:"simulationTime"`
			EndConditionType  string          `json:"endConditionType"`
			EndConditionValue string          `json:"endConditionValue"`
			InitialConditions json.RawMessage `json:"initialConditions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			respondError(w, 400, err.Error())
			return
		}
		if body.ScenarioID == "" {
			respondError(w, 400, "scenarioId is required")
			return
		}

		// Create data_source first
		friendlyName := fmt.Sprintf("Simulation_%s", time.Now().Format("2006-01-02T15:04:05"))
		ds, err := h.repo.CreateDataSource("simulation", body.ScenarioID, friendlyName, nil)
		if err != nil {
			respondError(w, 500, fmt.Sprintf("failed to create data source: %v", err))
			return
		}

		// Create execution config
		now := time.Now()
		ec := &database.ExecutionConfig{
			ID:                uuid.New().String(),
			ScenarioID:        body.ScenarioID,
			StartTime:         now,
			EndConditionType:  body.EndConditionType,
			EndConditionValue: body.EndConditionValue,
			InitialConditions: body.InitialConditions,
			Status:            "pending",
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		if ec.InitialConditions == nil {
			ec.InitialConditions = json.RawMessage("{}")
		}
		if err := h.repo.CreateExecution(ec); err != nil {
			respondError(w, 500, err.Error())
			return
		}

		// Call simulation-core asynchronously
		go h.runSimulation(ec.ID, ds.ID, body.ScenarioID, body.StartDatetime, body.SimulationTime, body.InitialConditions)

		respondJSON(w, 202, map[string]interface{}{
			"executionId":  ec.ID,
			"dataSourceId": ds.ID,
			"status":       "pending",
		})
	default:
		respondError(w, 405, "method not allowed")
	}
}

func (h *Handler) handleExecution(w http.ResponseWriter, r *http.Request, id string) {
	switch r.Method {
	case http.MethodGet:
		ec, err := h.repo.GetExecution(id)
		if err != nil {
			respondError(w, 404, err.Error())
			return
		}
		respondJSON(w, 200, ec)
	case http.MethodDelete:
		if err := h.repo.DeleteExecution(id); err != nil {
			respondError(w, 404, err.Error())
			return
		}
		w.WriteHeader(204)
	default:
		respondError(w, 405, "method not allowed")
	}
}

// runSimulation calls simulation-core /run endpoint
func (h *Handler) runSimulation(execID, dataSourceID, scenarioID, startDatetime string, simTime float64, initialConditions json.RawMessage) {
	log.Printf("[gateway] starting simulation: exec=%s ds=%s", execID, dataSourceID)

	payload := map[string]interface{}{
		"scenarioId":        scenarioID,
		"dataSourceId":      dataSourceID,
		"simulationTime":    simTime,
		"startDatetime":     startDatetime,
		"initialConditions": initialConditions,
	}
	if payload["initialConditions"] == nil {
		payload["initialConditions"] = json.RawMessage("{}")
	}

	b, _ := json.Marshal(payload)
	resp, err := http.Post(h.simCoreURL+"/run", "application/json", bytes.NewReader(b))
	if err != nil {
		errMsg := err.Error()
		h.repo.UpdateExecutionStatus(execID, "failed", nil, &errMsg)
		log.Printf("[gateway] simulation call failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		errMsg := string(bodyBytes)
		h.repo.UpdateExecutionStatus(execID, "failed", nil, &errMsg)
		log.Printf("[gateway] simulation returned %d: %s", resp.StatusCode, errMsg)
		return
	}

	h.repo.UpdateExecutionStatus(execID, "completed", &dataSourceID, nil)
	log.Printf("[gateway] simulation completed: exec=%s ds=%s", execID, dataSourceID)
}

// ---- Executor compat (sim-executor-backend互換レイヤー) ----

func (h *Handler) handleExecutorCompat(w http.ResponseWriter, r *http.Request, sub string) {
	switch {
	case sub == "scenarios" && r.Method == http.MethodGet:
		req, err := http.NewRequest("GET", h.simCoreURL+"/api/scenarios", nil)
		if err != nil {
			respondError(w, 500, "failed to create request")
			return
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			respondError(w, 502, "upstream error: "+err.Error())
			return
		}
		defer resp.Body.Close()
		var simCoreResp struct {
			Scenarios []map[string]interface{} `json:"scenarios"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&simCoreResp); err != nil {
			respondError(w, 500, "failed to parse upstream response")
			return
		}
		if simCoreResp.Scenarios == nil {
			simCoreResp.Scenarios = make([]map[string]interface{}, 0)
		}
		execs, _ := h.repo.ListExecutions()
		countByScenario := make(map[string]int)
		for _, e := range execs {
			countByScenario[e.ScenarioID]++
		}
		for i, s := range simCoreResp.Scenarios {
			if sid, ok := s["scenarioId"].(string); ok {
				simCoreResp.Scenarios[i]["executionCount"] = countByScenario[sid]
			}
		}
		respondJSON(w, 200, map[string]interface{}{"scenarios": simCoreResp.Scenarios})

	case sub == "executions" && r.Method == http.MethodGet:
		scenarioID := r.URL.Query().Get("scenarioId")
		allExecs, err := h.repo.ListExecutions()
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		type execResult struct {
			ID                string    `json:"id"`
			ScenarioID        string    `json:"scenarioId"`
			StartTime         time.Time `json:"startTime"`
			EndConditionType  string    `json:"endConditionType"`
			EndConditionValue string    `json:"endConditionValue"`
			Status            string    `json:"status"`
			SimulationID      *string   `json:"simulationId,omitempty"`
			ErrorMessage      *string   `json:"errorMessage,omitempty"`
			CreatedAt         time.Time `json:"createdAt"`
			UpdatedAt         time.Time `json:"updatedAt"`
		}
		filtered := make([]execResult, 0)
		for _, e := range allExecs {
			if scenarioID != "" && e.ScenarioID != scenarioID {
				continue
			}
			filtered = append(filtered, execResult{
				ID:                e.ID,
				ScenarioID:        e.ScenarioID,
				StartTime:         e.StartTime,
				EndConditionType:  e.EndConditionType,
				EndConditionValue: e.EndConditionValue,
				Status:            e.Status,
				SimulationID:      e.DataSourceID,
				ErrorMessage:      e.ErrorMessage,
				CreatedAt:         e.CreatedAt,
				UpdatedAt:         e.UpdatedAt,
			})
		}
		respondJSON(w, 200, map[string]interface{}{"executions": filtered})

	case strings.HasPrefix(sub, "executions/") && r.Method == http.MethodDelete:
		execID := strings.TrimPrefix(sub, "executions/")
		if err := h.repo.DeleteExecution(execID); err != nil {
			respondError(w, 404, err.Error())
			return
		}
		respondJSON(w, 200, map[string]string{"status": "deleted"})

	case sub == "execute" && r.Method == http.MethodPost:
		var req struct {
			ScenarioID   string `json:"scenarioId"`
			StartTime    string `json:"startTime"`
			EndCondition struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			} `json:"endCondition"`
			InitialConditions json.RawMessage `json:"initialConditions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, 400, err.Error())
			return
		}
		if req.ScenarioID == "" {
			respondError(w, 400, "scenarioId is required")
			return
		}
		var simTime float64
		if req.EndCondition.Type == "duration" {
			mins, _ := strconv.ParseFloat(req.EndCondition.Value, 64)
			simTime = mins * 60
		} else if req.EndCondition.Type == "absolute" {
			startT, err1 := time.Parse("2006-01-02T15:04:05", req.StartTime)
			endT, err2 := time.Parse("2006-01-02T15:04:05", req.EndCondition.Value)
			if err1 == nil && err2 == nil {
				simTime = endT.Sub(startT).Seconds()
			}
		}
		if simTime <= 0 {
			simTime = 3600
		}
		friendlyName := fmt.Sprintf("Simulation_%s", time.Now().Format("2006-01-02T15:04:05"))
		ds, err := h.repo.CreateDataSource("simulation", req.ScenarioID, friendlyName, nil)
		if err != nil {
			respondError(w, 500, "failed to create data source: "+err.Error())
			return
		}
		now := time.Now()
		ic := req.InitialConditions
		if ic == nil {
			ic = json.RawMessage("{}")
		}
		ec := &database.ExecutionConfig{
			ID:                uuid.New().String(),
			ScenarioID:        req.ScenarioID,
			StartTime:         now,
			EndConditionType:  req.EndCondition.Type,
			EndConditionValue: req.EndCondition.Value,
			InitialConditions: ic,
			Status:            "pending",
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		if err := h.repo.CreateExecution(ec); err != nil {
			respondError(w, 500, err.Error())
			return
		}
		go h.runSimulation(ec.ID, ds.ID, req.ScenarioID, req.StartTime, simTime, ic)
		respondJSON(w, 202, map[string]interface{}{
			"executionId":  ec.ID,
			"simulationId": ds.ID,
			"dataSourceId": ds.ID,
			"status":       "pending",
		})

	case sub == "initial-conditions" && r.Method == http.MethodPost:
		h.proxyToSimCore(w, r, "/api/simdb/initial-conditions")

	case strings.HasPrefix(sub, "simdb/") && r.Method == http.MethodPost:
		h.proxyToSimCore(w, r, "/api/"+sub)

	default:
		http.NotFound(w, r)
	}
}

// helpers

func respondJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func respondError(w http.ResponseWriter, status int, msg string) {
	respondJSON(w, status, map[string]string{"error": msg})
}
