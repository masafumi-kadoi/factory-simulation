package api

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"factory-simulation/realtime-gateway/internal/database"
	"factory-simulation/realtime-gateway/internal/notify"
	"factory-simulation/realtime-gateway/internal/simdb"
	"factory-simulation/realtime-gateway/internal/ws"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Handler struct {
	repo       *database.Repository
	hub        *notify.Hub
	simCoreURL string
	httpClient *http.Client
}

func NewHandler(repo *database.Repository, hub *notify.Hub, simCoreURL string) *Handler {
	return &Handler{
		repo:       repo,
		hub:        hub,
		simCoreURL: simCoreURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
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

	if path == "/ws/live" || path == "/ws" {
		ws.ServeWS(h.hub, w, r)
		return
	}
	if path == "/health" {
		w.Write([]byte("ok"))
		return
	}

	switch {
	case path == "/api/factories" || path == "/api/factories/":
		h.handleFactories(w, r)
	case strings.HasPrefix(path, "/api/factories/"):
		h.handleFactory(w, r, strings.TrimPrefix(path, "/api/factories/"))
	case path == "/api/data-sources" || path == "/api/data-sources/":
		h.handleDataSources(w, r)
	case strings.HasPrefix(path, "/api/data-sources/"):
		h.handleDataSource(w, r, strings.TrimPrefix(path, "/api/data-sources/"))
	case path == "/api/executions" || path == "/api/executions/":
		h.handleExecutions(w, r)
	case strings.HasPrefix(path, "/api/executions/"):
		h.handleExecution(w, r, strings.TrimPrefix(path, "/api/executions/"))
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

	switch {
	case sub == "":
		h.handleFactoryRoot(w, r, id)
	case sub == "stations" || sub == "stations/":
		h.handleFactoryStations(w, r, id)
	case sub == "stations/import-csv":
		if r.Method != http.MethodPost {
			respondError(w, 405, "method not allowed")
			return
		}
		h.handleCSVImport(w, r, id)
	case sub == "validate":
		if r.Method != http.MethodPost {
			respondError(w, 405, "method not allowed")
			return
		}
		h.handleValidate(w, r, id)
	case sub == "connections" || sub == "connections/":
		h.handleFactoryConnections(w, r, id)
	case strings.HasPrefix(sub, "connections/"):
		connectionIDStr := strings.TrimPrefix(sub, "connections/")
		connectionID, err := strconv.Atoi(connectionIDStr)
		if err != nil {
			respondError(w, 400, "invalid connection id")
			return
		}
		if r.Method != http.MethodDelete {
			respondError(w, 405, "method not allowed")
			return
		}
		if err := h.repo.DeleteFactoryConnection(id, connectionID); err != nil {
			respondError(w, 404, err.Error())
			return
		}
		w.WriteHeader(204)
	case strings.HasPrefix(sub, "stations/"):
		stationSub := strings.TrimPrefix(sub, "stations/")
		h.handleFactoryStationSub(w, r, id, stationSub)
	case strings.HasPrefix(sub, "machines/"):
		machineSub := strings.TrimPrefix(sub, "machines/")
		h.handleFactoryMachineSub(w, r, id, machineSub)
	case sub == "executions" || sub == "executions/":
		h.handleFactoryExecutions(w, r, id)
	case strings.HasPrefix(sub, "simdb/"):
		simdbSub := strings.TrimPrefix(sub, "simdb/")
		h.handleFactorySimDB(w, r, id, simdbSub)
	default:
		http.NotFound(w, r)
	}
}

func (h *Handler) handleFactoryRoot(w http.ResponseWriter, r *http.Request, id string) {
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
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
			respondError(w, 400, "name is required")
			return
		}
		if err := h.repo.UpdateFactory(id, body.Name, body.Description); err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 200, map[string]string{"status": "updated"})
	case http.MethodDelete:
		if err := h.repo.DeleteFactory(id); err != nil {
			respondError(w, 404, err.Error())
			return
		}
		w.WriteHeader(204)
	default:
		respondError(w, 405, "method not allowed")
	}
}

func (h *Handler) handleFactoryStations(w http.ResponseWriter, r *http.Request, factoryID string) {
	switch r.Method {
	case http.MethodGet:
		stations, err := h.repo.ListFactoryStations(factoryID)
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 200, stations)
	case http.MethodPost:
		var body struct {
			StationID   string   `json:"stationId"`
			Name        string   `json:"name"`
			StationType string   `json:"stationType"`
			PosX        *float64 `json:"posX"`
			PosY        *float64 `json:"posY"`
			PosZ        *float64 `json:"posZ"`
			ParentID    *string  `json:"parentId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.StationID == "" {
			respondError(w, 400, "stationId is required")
			return
		}
		if !stationIDPattern.MatchString(body.StationID) {
			respondError(w, 400, "stationId must match {equipment_id}.{suffix} format (e.g. assembly.processing)")
			return
		}
		if err := h.repo.AddFactoryStation(factoryID, body.StationID, body.Name, body.StationType, body.PosX, body.PosY, body.PosZ, body.ParentID); err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 201, map[string]string{"status": "created"})
	default:
		respondError(w, 405, "method not allowed")
	}
}

func (h *Handler) handleFactoryStationSub(w http.ResponseWriter, r *http.Request, factoryID, stationSub string) {
	// stationSub is either "{stationId}" or "{stationId}/..."
	// For now handle DELETE and PUT on "{stationId}"
	if strings.Contains(stationSub, "/") {
		http.NotFound(w, r)
		return
	}
	stationID := stationSub
	switch r.Method {
	case http.MethodPut:
		var body struct {
			Name        *string         `json:"name"`
			StationType *string         `json:"stationType"`
			PosX        json.RawMessage `json:"posX"`
			PosY        json.RawMessage `json:"posY"`
			PosZ        *float64        `json:"posZ"`
			ParentID    *string         `json:"parentId"`
			Config      json.RawMessage `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			respondError(w, 400, "invalid JSON")
			return
		}
		updates := make(map[string]interface{})
		if body.Name != nil {
			updates["name"] = *body.Name
		}
		if body.StationType != nil {
			updates["station_type"] = *body.StationType
		}
		if body.PosX != nil {
			if string(body.PosX) == "null" {
				updates["position_x"] = nil
			} else {
				var v float64
				if json.Unmarshal(body.PosX, &v) == nil {
					updates["position_x"] = v
				}
			}
		}
		if body.PosY != nil {
			if string(body.PosY) == "null" {
				updates["position_y"] = nil
			} else {
				var v float64
				if json.Unmarshal(body.PosY, &v) == nil {
					updates["position_y"] = v
				}
			}
		}
		if body.PosZ != nil {
			updates["position_z"] = *body.PosZ
		}
		if body.ParentID != nil {
			updates["parent_id"] = *body.ParentID
		}
		if body.Config != nil {
			updates["config"] = string(body.Config)
		}
		if err := h.repo.UpdateFactoryStation(factoryID, stationID, updates); err != nil {
			respondError(w, 404, err.Error())
			return
		}
		respondJSON(w, 200, map[string]string{"status": "updated"})
	case http.MethodDelete:
		if err := h.repo.DeleteFactoryStation(factoryID, stationID); err != nil {
			respondError(w, 404, err.Error())
			return
		}
		w.WriteHeader(204)
	default:
		respondError(w, 405, "method not allowed")
	}
}

func (h *Handler) handleFactoryConnections(w http.ResponseWriter, r *http.Request, factoryID string) {
	switch r.Method {
	case http.MethodGet:
		conns, err := h.repo.ListFactoryConnections(factoryID)
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 200, conns)
	case http.MethodPost:
		var body struct {
			FromStation   string `json:"fromStation"`
			ToStation     string `json:"toStation"`
			Condition     string `json:"condition"`
			FromPortIndex *int   `json:"fromPortIndex"`
			ToPortIndex   *int   `json:"toPortIndex"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			respondError(w, 400, "invalid JSON")
			return
		}
		if body.FromStation == "" || body.ToStation == "" {
			respondError(w, 400, "fromStation and toStation are required")
			return
		}
		fromPI, toPI := -1, -1
		if body.FromPortIndex != nil {
			fromPI = *body.FromPortIndex
		}
		if body.ToPortIndex != nil {
			toPI = *body.ToPortIndex
		}
		conn, err := h.repo.AddFactoryConnection(factoryID, body.FromStation, body.ToStation, body.Condition, fromPI, toPI)
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 201, conn)
	default:
		respondError(w, 405, "method not allowed")
	}
}

// handleFactoryMachineSub handles /factories/{fid}/machines/{sid}/logic
func (h *Handler) handleFactoryMachineSub(w http.ResponseWriter, r *http.Request, factoryID, machineSub string) {
	// machineSub = "{stationId}/logic"
	parts := strings.SplitN(machineSub, "/", 2)
	if len(parts) != 2 || parts[1] != "logic" {
		http.NotFound(w, r)
		return
	}
	stationID := parts[0]
	if r.Method != http.MethodPut {
		respondError(w, 405, "method not allowed")
		return
	}

	var body struct {
		Children    []database.FactoryStation    `json:"children"`
		Connections []database.FactoryConnection `json:"connections"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, 400, "invalid JSON: "+err.Error())
		return
	}
	if body.Children == nil {
		body.Children = []database.FactoryStation{}
	}
	if body.Connections == nil {
		body.Connections = []database.FactoryConnection{}
	}

	if err := h.repo.SaveMachineLogic(factoryID, stationID, body.Children, body.Connections); err != nil {
		respondError(w, 500, err.Error())
		return
	}
	respondJSON(w, 200, map[string]string{"status": "saved"})
}

// handleFactoryExecutions handles GET /factories/{fid}/executions
func (h *Handler) handleFactoryExecutions(w http.ResponseWriter, r *http.Request, factoryID string) {
	if r.Method != http.MethodGet {
		respondError(w, 405, "method not allowed")
		return
	}
	if _, err := h.repo.GetFactory(factoryID); err != nil {
		respondError(w, 404, err.Error())
		return
	}
	execs, err := h.repo.ListExecutionsByFactory(factoryID)
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	respondJSON(w, 200, execs)
}

// handleFactorySimDB handles /factories/{fid}/simdb/{sub}
func (h *Handler) handleFactorySimDB(w http.ResponseWriter, r *http.Request, factoryID, sub string) {
	// Get factory to read SimDB connection config
	factory, err := h.repo.GetFactory(factoryID)
	if err != nil {
		respondError(w, 404, err.Error())
		return
	}

	buildConfig := func() (*simdb.Config, error) {
		if factory.FactoryDBHost == nil || factory.FactoryDBName == nil ||
			factory.FactoryDBUser == nil || factory.FactoryDBPass == nil {
			return nil, fmt.Errorf("factory SimDB connection not configured")
		}
		port := 5432
		if factory.FactoryDBPort != nil {
			port = *factory.FactoryDBPort
		}
		return &simdb.Config{
			Host:     *factory.FactoryDBHost,
			Port:     port,
			Database: *factory.FactoryDBName,
			User:     *factory.FactoryDBUser,
			Password: *factory.FactoryDBPass,
		}, nil
	}

	switch sub {
	case "locations":
		if r.Method != http.MethodGet {
			respondError(w, 405, "method not allowed")
			return
		}
		cfg, err := buildConfig()
		if err != nil {
			respondError(w, 400, err.Error())
			return
		}
		client, err := simdb.Connect(*cfg)
		if err != nil {
			respondError(w, 502, "SimDB connection failed: "+err.Error())
			return
		}
		defer client.Close()
		locs, err := client.GetLocationMaster()
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		respondJSON(w, 200, locs)

	case "initial-conditions":
		if r.Method != http.MethodPost {
			respondError(w, 405, "method not allowed")
			return
		}
		cfg, err := buildConfig()
		if err != nil {
			respondError(w, 400, err.Error())
			return
		}
		var body struct {
			StartDatetime string `json:"startDatetime"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.StartDatetime == "" {
			respondError(w, 400, "startDatetime is required")
			return
		}
		startTime, err := time.Parse(time.RFC3339, body.StartDatetime)
		if err != nil {
			if t, err2 := time.Parse("2006-01-02T15:04:05", body.StartDatetime); err2 == nil {
				startTime = t
			} else {
				respondError(w, 400, "startDatetime must be RFC3339 or 2006-01-02T15:04:05")
				return
			}
		}

		// Build locationId → stationId map from factory_stations config
		stations, err := h.repo.ListFactoryStations(factoryID)
		if err != nil {
			respondError(w, 500, "failed to load factory stations: "+err.Error())
			return
		}
		locationToStation := make(map[int64]string)
		for _, s := range stations {
			if locID := s.LocationID(); locID != nil {
				locationToStation[*locID] = s.StationID
			}
		}

		client, err := simdb.Connect(*cfg)
		if err != nil {
			respondError(w, 502, "SimDB connection failed: "+err.Error())
			return
		}
		defer client.Close()

		works, err := client.GetCurrentWorks(startTime)
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		itemIDs := make([]string, 0, len(works))
		for _, w := range works {
			itemIDs = append(itemIDs, w.ItemID)
		}
		qualityStatuses, err := client.GetQualityStatuses(itemIDs, startTime)
		if err != nil {
			respondError(w, 500, err.Error())
			return
		}
		result := simdb.BuildInitialConditions(works, qualityStatuses, locationToStation)
		respondJSON(w, 200, result)

	case "test-connection":
		if r.Method != http.MethodPost {
			respondError(w, 405, "method not allowed")
			return
		}
		// Allow overriding config from request body (for testing before saving)
		var body struct {
			Host     *string `json:"host"`
			Port     *int    `json:"port"`
			Database *string `json:"database"`
			User     *string `json:"user"`
			Password *string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
			respondError(w, 400, "invalid JSON")
			return
		}
		cfg, err := buildConfig()
		if err != nil {
			cfg = &simdb.Config{}
		}
		if body.Host != nil {
			cfg.Host = *body.Host
		}
		if body.Port != nil {
			cfg.Port = *body.Port
		}
		if body.Database != nil {
			cfg.Database = *body.Database
		}
		if body.User != nil {
			cfg.User = *body.User
		}
		if body.Password != nil {
			cfg.Password = *body.Password
		}
		if cfg.Host == "" {
			respondError(w, 400, "SimDB host is not configured")
			return
		}
		client, err := simdb.Connect(*cfg)
		if err != nil {
			respondJSON(w, 200, map[string]interface{}{"ok": false, "error": err.Error()})
			return
		}
		defer client.Close()
		locs, err := client.GetLocationMaster()
		if err != nil {
			respondJSON(w, 200, map[string]interface{}{"ok": false, "error": err.Error()})
			return
		}
		respondJSON(w, 200, map[string]interface{}{"ok": true, "locationCount": len(locs)})

	default:
		http.NotFound(w, r)
	}
}

// stationIDPattern: {equipment_id}.{suffix} — suffix can be any non-empty string
var stationIDPattern = regexp.MustCompile(`^[^.]+\..+$`)

var validStationTypes = map[string]bool{
	"source": true, "processing": true, "drain": true,
	"merge": true, "split": true, "entry": true, "exit": true,
	"machine": true, "conveyor": true, "buffer": true, "input": true, "output": true,
	"switch": true,
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

	// Simple format: station_id, station_name, station_type, x, y, z
	header := records[0]
	isSimpleFormat := len(header) >= 3 && strings.ToLower(strings.TrimSpace(header[1])) == "station_name"

	for i, rec := range records[1:] {
		lineNum := i + 2
		if len(rec) < 1 {
			errs = append(errs, csvError{lineNum, "row", "not enough columns"})
			continue
		}

		stationID := strings.TrimSpace(rec[0])
		dotIdx := strings.LastIndex(stationID, ".")
		equipmentID := stationID
		if dotIdx >= 0 {
			equipmentID = stationID[:dotIdx]
		}
		if dotIdx < 0 || dotIdx == len(stationID)-1 {
			errs = append(errs, csvError{lineNum, "station_id", "must match {equipment_id}.{suffix} format"})
		}
		if seen[stationID] {
			errs = append(errs, csvError{lineNum, "station_id", fmt.Sprintf("duplicate: %s", stationID)})
		}
		seen[stationID] = true

		var name, stationType string
		var posX, posY float64

		if isSimpleFormat {
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
		} else {
			// Extended: station_id, equipment_id, name, station_type, pos_x, pos_y
			if len(rec) > 2 {
				name = strings.TrimSpace(rec[2])
			}
			if len(rec) > 3 {
				stationType = strings.TrimSpace(rec[3])
			}
			if len(rec) > 4 {
				posX, _ = strconv.ParseFloat(strings.TrimSpace(rec[4]), 64)
			}
			if len(rec) > 5 {
				posY, _ = strconv.ParseFloat(strings.TrimSpace(rec[5]), 64)
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
			Name:        &n,
			StationType: stationType,
			PositionX:   &posX,
			PositionY:   &posY,
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
	if _, err := h.repo.GetFactory(factoryID); err != nil {
		respondError(w, 404, err.Error())
		return
	}
	respondJSON(w, 200, map[string]interface{}{
		"status": "ok",
		"checks": map[string]interface{}{
			"connection_test": map[string]string{"status": "ok"},
		},
	})
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
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				respondError(w, 400, "invalid JSON body")
				return
			}
			var endedAt *time.Time
			if body.EndedAt != nil {
				t, err := time.Parse(time.RFC3339, *body.EndedAt)
				if err != nil {
					respondError(w, 400, "invalid endedAt format, expected RFC3339")
					return
				}
				endedAt = &t
			}
			if err := h.repo.PatchDataSource(id, endedAt); err != nil {
				respondError(w, 500, err.Error())
				return
			}
			respondJSON(w, 200, map[string]string{"status": "updated"})
		case http.MethodDelete:
			if err := h.repo.DeleteDataSource(id); err != nil {
				respondError(w, 500, err.Error())
				return
			}
			w.WriteHeader(204)
		default:
			respondError(w, 405, "method not allowed")
		}
	case "events":
		if r.Method != http.MethodGet {
			respondError(w, 405, "method not allowed")
			return
		}
		q := r.URL.Query()
		from := time.Now().Add(-1 * time.Hour)
		to := time.Now()
		parseTS := func(s string) (time.Time, bool) {
			if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
				return t, true
			}
			if t, err := time.Parse(time.RFC3339, s); err == nil {
				return t, true
			}
			return time.Time{}, false
		}
		if s := q.Get("from"); s != "" {
			if t, ok := parseTS(s); ok {
				from = t
			}
		}
		if s := q.Get("to"); s != "" {
			if t, ok := parseTS(s); ok {
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
			FactoryID         string          `json:"factoryId"`
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
		if body.ScenarioID == "" && body.FactoryID == "" {
			respondError(w, 400, "scenarioId or factoryId is required")
			return
		}

		friendlyName := fmt.Sprintf("Simulation_%s", time.Now().Format("2006-01-02T15:04:05"))
		var ds *database.DataSource
		var dsErr error
		if body.FactoryID != "" {
			ds, dsErr = h.repo.CreateRealtimeDataSource(body.FactoryID, friendlyName)
		} else {
			ds, dsErr = h.repo.CreateDataSource("simulation", body.ScenarioID, friendlyName, nil)
		}
		if dsErr != nil {
			respondError(w, 500, fmt.Sprintf("failed to create data source: %v", dsErr))
			return
		}

		now := time.Now()
		ic := body.InitialConditions
		if ic == nil {
			ic = json.RawMessage("{}")
		}
		var scenarioIDPtr, factoryIDPtr *string
		if body.ScenarioID != "" {
			scenarioIDPtr = &body.ScenarioID
		}
		if body.FactoryID != "" {
			factoryIDPtr = &body.FactoryID
		}
		ec := &database.ExecutionConfig{
			ID:                uuid.New().String(),
			ScenarioID:        scenarioIDPtr,
			FactoryID:         factoryIDPtr,
			StartTime:         now,
			SimulationTime:    body.SimulationTime,
			EndConditionType:  body.EndConditionType,
			EndConditionValue: body.EndConditionValue,
			InitialConditions: ic,
			Status:            "pending",
			DataSourceID:      &ds.ID,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		if err := h.repo.CreateExecution(ec); err != nil {
			h.repo.DeleteDataSource(ds.ID)
			respondError(w, 500, err.Error())
			return
		}

		go h.runSimulation(ec.ID, ds.ID, body.ScenarioID, body.FactoryID, body.StartDatetime, body.SimulationTime, ic)

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

func (h *Handler) runSimulation(execID, dataSourceID, scenarioID, factoryID, startDatetime string, simTime float64, initialConditions json.RawMessage) {
	endDataSource := func() {
		now := time.Now()
		h.repo.PatchDataSource(dataSourceID, &now)
	}
	defer func() {
		if rec := recover(); rec != nil {
			errMsg := fmt.Sprintf("panic: %v", rec)
			h.repo.UpdateExecutionStatus(execID, "error", &dataSourceID, &errMsg)
			endDataSource()
			log.Printf("[gateway] runSimulation panic: %v", rec)
		}
	}()
	log.Printf("[gateway] starting simulation: exec=%s ds=%s", execID, dataSourceID)

	payload := map[string]interface{}{
		"dataSourceId":      dataSourceID,
		"simulationTime":    simTime,
		"startDatetime":     startDatetime,
		"initialConditions": initialConditions,
	}
	if factoryID != "" {
		payload["factoryId"] = factoryID
	} else {
		payload["scenarioId"] = scenarioID
	}
	if len(initialConditions) == 0 {
		payload["initialConditions"] = json.RawMessage("{}")
	}

	b, err := json.Marshal(payload)
	if err != nil {
		errMsg := fmt.Sprintf("failed to marshal payload: %v", err)
		h.repo.UpdateExecutionStatus(execID, "error", &dataSourceID, &errMsg)
		endDataSource()
		return
	}
	simClient := &http.Client{Timeout: 10 * time.Minute}
	req, err := http.NewRequest("POST", h.simCoreURL+"/run", bytes.NewReader(b))
	if err != nil {
		errMsg := err.Error()
		h.repo.UpdateExecutionStatus(execID, "error", &dataSourceID, &errMsg)
		endDataSource()
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := simClient.Do(req)
	if err != nil {
		errMsg := err.Error()
		h.repo.UpdateExecutionStatus(execID, "error", &dataSourceID, &errMsg)
		endDataSource()
		log.Printf("[gateway] simulation call failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		errMsg := string(bodyBytes)
		h.repo.UpdateExecutionStatus(execID, "error", &dataSourceID, &errMsg)
		endDataSource()
		log.Printf("[gateway] simulation returned %d: %s", resp.StatusCode, errMsg)
		return
	}

	h.repo.UpdateExecutionStatus(execID, "completed", &dataSourceID, nil)
	endDataSource()
	log.Printf("[gateway] simulation completed: exec=%s ds=%s", execID, dataSourceID)
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
