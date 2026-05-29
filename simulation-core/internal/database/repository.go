package database

import (
	"database/sql"
	"encoding/json"
	"factory-simulation/simulation-core/internal/domain"
	"factory-simulation/simulation-core/internal/simulation"
	"fmt"
	"time"
)

// Repository handles database operations
type Repository struct {
	db *DB
}

// NewRepository creates a new repository
func NewRepository(db *DB) *Repository {
	return &Repository{db: db}
}

// GetDBConn returns the underlying sql.DB for direct use (e.g., WDH export)
func (r *Repository) GetDBConn() *sql.DB {
	return r.db.GetConnection()
}

// SaveSimulationRun saves a simulation run to the database
func (r *Repository) SaveSimulationRun(sim *domain.Simulation) error {
	query := `
		INSERT INTO simulation_runs (id, friendly_name, scenario_id, start_time, end_time, simulation_end_time, end_reason, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`

	now := time.Now()
	var endTime *time.Time
	var simEndTime *float64
	var endReason *string

	if sim.EndTime != nil {
		endTime = &now
		simEndTime = sim.EndTime
		if sim.EndReason != nil {
			reason := string(*sim.EndReason)
			endReason = &reason
		}
	}

	_, err := r.db.GetConnection().Exec(query,
		sim.ID,
		sim.FriendlyName,
		sim.ScenarioID,
		now,
		endTime,
		simEndTime,
		endReason,
		string(sim.Status),
		sim.CreatedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to save simulation run: %w", err)
	}

	return nil
}

// SaveStationStatusLogs saves station status logs to the database
func (r *Repository) SaveStationStatusLogs(simulationID string, logs []simulation.StationStatusLog) error {
	if len(logs) == 0 {
		return nil
	}

	query := `
		INSERT INTO station_status_logs (simulation_run_id, station_id, timestamp, status_type, value, signal_name, old_value, rule_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`

	tx, err := r.db.GetConnection().Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(query)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, log := range logs {
		_, err := stmt.Exec(
			simulationID,
			log.StationID,
			log.Timestamp,
			log.StatusType,
			log.Value,
			log.SignalName,
			log.OldValue,
			log.RuleID,
		)
		if err != nil {
			return fmt.Errorf("failed to insert station status log: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// SaveWorkEvents saves work events to the database
func (r *Repository) SaveWorkEvents(simulationID string, logs []simulation.WorkEventLog) error {
	if len(logs) == 0 {
		return nil
	}

	query := `
		INSERT INTO work_events (simulation_run_id, work_id, work_friendly_name, station_id, timestamp, event_type, work_type, port_index, quality_status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`

	tx, err := r.db.GetConnection().Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(query)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, log := range logs {
		var qualityStatus *string
		if log.QualityStatus != "" {
			qualityStatus = &log.QualityStatus
		}
		_, err := stmt.Exec(
			simulationID,
			log.WorkID,
			log.WorkFriendlyName,
			log.StationID,
			log.Timestamp,
			log.EventType,
			log.WorkType,
			log.PortIndex,
			qualityStatus,
		)
		if err != nil {
			return fmt.Errorf("failed to insert work event: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// GetSimulation retrieves a simulation run from the database
func (r *Repository) GetSimulation(id string) (*domain.Simulation, error) {
	query := `
		SELECT id, friendly_name, scenario_id, simulation_end_time, end_reason, status, created_at
		FROM simulation_runs
		WHERE id = $1
	`

	var sim domain.Simulation
	var endTime *float64
	var endReason *string
	var status string

	err := r.db.GetConnection().QueryRow(query, id).Scan(
		&sim.ID,
		&sim.FriendlyName,
		&sim.ScenarioID,
		&endTime,
		&endReason,
		&status,
		&sim.CreatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to get simulation: %w", err)
	}

	sim.Status = domain.SimulationStatus(status)
	sim.EndTime = endTime

	if endReason != nil {
		reason := domain.EndReason(*endReason)
		sim.EndReason = &reason
	}

	return &sim, nil
}

// GetStationStatusLogs retrieves station status logs from the database
func (r *Repository) GetStationStatusLogs(simulationID string) ([]simulation.StationStatusLog, error) {
	query := `
		SELECT station_id, timestamp, status_type, value, COALESCE(signal_name, ''), COALESCE(old_value, FALSE), COALESCE(rule_id, '')
		FROM station_status_logs
		WHERE simulation_run_id = $1
		ORDER BY timestamp ASC, id ASC
	`

	rows, err := r.db.GetConnection().Query(query, simulationID)
	if err != nil {
		return nil, fmt.Errorf("failed to query station status logs: %w", err)
	}
	defer rows.Close()

	var logs []simulation.StationStatusLog
	for rows.Next() {
		var log simulation.StationStatusLog
		if err := rows.Scan(&log.StationID, &log.Timestamp, &log.StatusType, &log.Value, &log.SignalName, &log.OldValue, &log.RuleID); err != nil {
			return nil, fmt.Errorf("failed to scan station status log: %w", err)
		}
		logs = append(logs, log)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating station status logs: %w", err)
	}

	return logs, nil
}

// GetWorkEvents retrieves work events from the database
func (r *Repository) GetWorkEvents(simulationID string) ([]simulation.WorkEventLog, error) {
	query := `
		SELECT work_id, work_friendly_name, station_id, timestamp, event_type, COALESCE(work_type, ''), COALESCE(port_index, -1), COALESCE(quality_status, '')
		FROM work_events
		WHERE simulation_run_id = $1
		ORDER BY timestamp ASC, id ASC
	`

	rows, err := r.db.GetConnection().Query(query, simulationID)
	if err != nil {
		return nil, fmt.Errorf("failed to query work events: %w", err)
	}
	defer rows.Close()

	var logs []simulation.WorkEventLog
	for rows.Next() {
		var log simulation.WorkEventLog
		if err := rows.Scan(&log.WorkID, &log.WorkFriendlyName, &log.StationID, &log.Timestamp, &log.EventType, &log.WorkType, &log.PortIndex, &log.QualityStatus); err != nil {
			return nil, fmt.Errorf("failed to scan work event: %w", err)
		}
		logs = append(logs, log)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating work events: %w", err)
	}

	return logs, nil
}

// SaveWorkLineageLogs saves work lineage logs to the database
func (r *Repository) SaveWorkLineageLogs(simulationID string, logs []simulation.WorkLineageLog) error {
	if len(logs) == 0 {
		return nil
	}

	query := `
		INSERT INTO work_lineage (simulation_run_id, child_work_id, child_work_friendly_name, parent_work_id, parent_work_friendly_name, operation_type, station_id, timestamp)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`

	tx, err := r.db.GetConnection().Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(query)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, log := range logs {
		_, err := stmt.Exec(
			simulationID,
			log.ChildWorkID,
			log.ChildWorkFriendlyName,
			log.ParentWorkID,
			log.ParentWorkFriendlyName,
			log.OperationType,
			log.StationID,
			log.Timestamp,
		)
		if err != nil {
			return fmt.Errorf("failed to insert work lineage log: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// GetAllSimulations retrieves all simulation runs from the database
func (r *Repository) GetAllSimulations() ([]*domain.Simulation, error) {
	query := `
		SELECT id, friendly_name, scenario_id, simulation_end_time, end_reason, status, created_at
		FROM simulation_runs
		ORDER BY created_at DESC
	`

	rows, err := r.db.GetConnection().Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query simulations: %w", err)
	}
	defer rows.Close()

	var simulations []*domain.Simulation
	for rows.Next() {
		var sim domain.Simulation
		var endTime *float64
		var endReason *string
		var status string

		if err := rows.Scan(&sim.ID, &sim.FriendlyName, &sim.ScenarioID, &endTime, &endReason, &status, &sim.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan simulation: %w", err)
		}

		sim.Status = domain.SimulationStatus(status)
		sim.EndTime = endTime

		if endReason != nil {
			reason := domain.EndReason(*endReason)
			sim.EndReason = &reason
		}

		simulations = append(simulations, &sim)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating simulations: %w", err)
	}

	return simulations, nil
}

// GetWorkLineage retrieves work lineage logs from the database
func (r *Repository) GetWorkLineage(simulationID string) ([]simulation.WorkLineageLog, error) {
	query := `
		SELECT child_work_id, child_work_friendly_name, parent_work_id, parent_work_friendly_name, operation_type, station_id, timestamp
		FROM work_lineage
		WHERE simulation_run_id = $1
		ORDER BY timestamp ASC
	`

	rows, err := r.db.GetConnection().Query(query, simulationID)
	if err != nil {
		return nil, fmt.Errorf("failed to query work lineage: %w", err)
	}
	defer rows.Close()

	var logs []simulation.WorkLineageLog
	for rows.Next() {
		var log simulation.WorkLineageLog
		if err := rows.Scan(&log.ChildWorkID, &log.ChildWorkFriendlyName, &log.ParentWorkID, &log.ParentWorkFriendlyName, &log.OperationType, &log.StationID, &log.Timestamp); err != nil {
			return nil, fmt.Errorf("failed to scan work lineage log: %w", err)
		}
		logs = append(logs, log)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating work lineage: %w", err)
	}

	return logs, nil
}

// GetScenarioFromFactory builds a domain.Scenario directly from factory_stations and factory_connections.
func (r *Repository) GetScenarioFromFactory(factoryID string) (*domain.Scenario, error) {
	var factoryName string
	err := r.db.GetConnection().QueryRow(
		`SELECT name FROM factories WHERE id = $1`, factoryID,
	).Scan(&factoryName)
	if err != nil {
		return nil, fmt.Errorf("factory not found: %s", factoryID)
	}

	// Load ALL stations including machines (we'll decide per-station whether to include them)
	stationRows, err := r.db.GetConnection().Query(`
		SELECT station_id, station_type, parent_id, name, position_x, position_y, config
		FROM factory_stations
		WHERE factory_id = $1
		ORDER BY station_id
	`, factoryID)
	if err != nil {
		return nil, fmt.Errorf("failed to query factory stations: %w", err)
	}
	defer stationRows.Close()

	type rawStation struct {
		id         string
		stype      string
		parentID   *string
		name       *string
		posX, posY *float64
		config     map[string]interface{}
	}
	var rawStations []rawStation
	childrenOf := make(map[string]bool) // machine IDs that have child stations

	for stationRows.Next() {
		var stationID, stationType string
		var parentID *string
		var stationName *string
		var posX, posY *float64
		var configJSON []byte

		if err := stationRows.Scan(&stationID, &stationType, &parentID, &stationName, &posX, &posY, &configJSON); err != nil {
			return nil, fmt.Errorf("failed to scan factory station: %w", err)
		}

		config := make(map[string]interface{})
		if len(configJSON) > 0 {
			if err := json.Unmarshal(configJSON, &config); err != nil {
				return nil, fmt.Errorf("failed to unmarshal station config: %w", err)
			}
		}

		if parentID != nil && *parentID != "" {
			childrenOf[*parentID] = true
		}

		rawStations = append(rawStations, rawStation{
			id: stationID, stype: stationType, parentID: parentID,
			name: stationName, posX: posX, posY: posY, config: config,
		})
	}
	if err := stationRows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate factory stations: %w", err)
	}

	// Extract equipmentLayout from machine configs.
	// The Machine Editor stores internal station configs (processingTime etc.) and
	// internal connections inside machine.config.equipmentLayout — NOT in factory_stations/connections.
	// We read that data here and use it as the authoritative source for internal stations.
	type layoutMember struct {
		stationID, stationType, name string
		config                       map[string]interface{}
	}
	type layoutData struct {
		members     []layoutMember
		connections []struct{ from, to, cond string; fromPort, toPort int }
	}
	machineLayouts := make(map[string]*layoutData)
	for _, rs := range rawStations {
		if rs.stype != "machine" {
			continue
		}
		layout, ok := rs.config["equipmentLayout"].(map[string]interface{})
		if !ok {
			continue
		}
		ld := &layoutData{}
		if members, ok := layout["members"].([]interface{}); ok {
			for _, m := range members {
				mem, ok := m.(map[string]interface{})
				if !ok {
					continue
				}
				sid, _ := mem["stationId"].(string)
				if sid == "" {
					continue
				}
				stype, _ := mem["stationType"].(string)
				memName, _ := mem["name"].(string)
				cfg, _ := mem["config"].(map[string]interface{})
				if cfg == nil {
					cfg = make(map[string]interface{})
				}
				ld.members = append(ld.members, layoutMember{stationID: sid, stationType: stype, name: memName, config: cfg})
			}
		}
		if conns, ok := layout["connections"].([]interface{}); ok {
			for _, c := range conns {
				conn, ok := c.(map[string]interface{})
				if !ok {
					continue
				}
				from, _ := conn["fromStation"].(string)
				to, _ := conn["toStation"].(string)
				if from == "" || to == "" {
					continue
				}
				cond, _ := conn["condition"].(string)
				if cond == "" {
					cond = "default"
				}
				fp, tp := -1, -1
				if v, ok := conn["fromPortIndex"].(float64); ok {
					fp = int(v)
				}
				if v, ok := conn["toPortIndex"].(float64); ok {
					tp = int(v)
				}
				ld.connections = append(ld.connections, struct{ from, to, cond string; fromPort, toPort int }{from, to, cond, fp, tp})
			}
		}
		if len(ld.members) > 0 {
			machineLayouts[rs.id] = ld
		}
	}

	// Build per-station overrides from layout members and add virtual stations
	// (entry/exit stations created by Machine Editor that aren't in factory_stations).
	rawStationSet := make(map[string]bool)
	for _, rs := range rawStations {
		rawStationSet[rs.id] = true
	}
	memberCfgOverride := make(map[string]map[string]interface{})
	memberTypeOverride := make(map[string]string)
	memberNameOverride := make(map[string]string)
	for machineID, ld := range machineLayouts {
		mid := machineID
		for _, mem := range ld.members {
			if len(mem.config) > 0 {
				memberCfgOverride[mem.stationID] = mem.config
			}
			if mem.stationType != "" {
				memberTypeOverride[mem.stationID] = mem.stationType
			}
			if mem.name != "" {
				memberNameOverride[mem.stationID] = mem.name
			}
			if !rawStationSet[mem.stationID] {
				// Virtual station (e.g. entry/exit created in Machine Editor)
				name := mem.name
				rawStations = append(rawStations, rawStation{
					id: mem.stationID, stype: mem.stationType,
					parentID: &mid, name: &name, config: mem.config,
				})
				rawStationSet[mem.stationID] = true
				childrenOf[mid] = true
			}
		}
	}

	stationSet := make(map[string]bool)
	var stations []domain.Station

	for _, rs := range rawStations {
		// Apply layout overrides (config and type are authoritative from equipmentLayout).
		if cfg, ok := memberCfgOverride[rs.id]; ok {
			rs.config = cfg
		}
		if name, ok := memberNameOverride[rs.id]; ok {
			rs.name = &name
		}
		effectiveType := rs.stype
		if t, ok := memberTypeOverride[rs.id]; ok && t != "" {
			effectiveType = t
		}
		if rs.stype == "machine" {
			if childrenOf[rs.id] {
				// Machine with children: skip — children are the simulation nodes
				continue
			}
			// Machine without children: treat as processing node
			effectiveType = "processing"
			if _, ok := rs.config["processingTime"]; !ok {
				rs.config["processingTime"] = float64(60)
			}
			if _, ok := rs.config["arrivalTime"]; !ok {
				rs.config["arrivalTime"] = float64(0)
			}
			if _, ok := rs.config["departureTime"]; !ok {
				rs.config["departureTime"] = float64(0)
			}
		}

		// Set default workCount for source stations with no items configured
		if effectiveType == "source" {
			if wc, ok := rs.config["workCount"]; !ok || wc == float64(0) {
				rs.config["workCount"] = float64(5)
			}
			if _, ok := rs.config["departureTime"]; !ok {
				rs.config["departureTime"] = float64(0)
			}
		}

		var locationID *int64
		if lid, ok := rs.config["locationId"]; ok {
			switch v := lid.(type) {
			case float64:
				id := int64(v)
				locationID = &id
			case int64:
				locationID = &v
			}
		}

		station := domain.NewStation(rs.id, domain.StationType(effectiveType), rs.config)
		if rs.name != nil {
			station.Name = *rs.name
		}
		station.ParentID = rs.parentID
		station.LocationID = locationID
		station.PositionX = rs.posX
		station.PositionY = rs.posY
		stations = append(stations, *station)
		stationSet[rs.id] = true
	}

	// Build sets needed for two-level routing expansion.
	// machineHubs: machine stations that have children (equipment containers).
	// stationParent: child station ID → parent hub station ID.
	machineHubs := make(map[string]bool)
	stationParent := make(map[string]string)
	for _, rs := range rawStations {
		if rs.stype == "machine" && childrenOf[rs.id] {
			machineHubs[rs.id] = true
		}
		if rs.parentID != nil && *rs.parentID != "" {
			stationParent[rs.id] = *rs.parentID
		}
	}

	// Load all raw connections for two-pass expansion.
	type rawConn struct {
		from, to, condition string
		fromPort, toPort    int
	}
	connRows, err := r.db.GetConnection().Query(`
		SELECT from_station, to_station, condition, COALESCE(from_port_index, -1), COALESCE(to_port_index, -1)
		FROM factory_connections
		WHERE factory_id = $1
		ORDER BY id
	`, factoryID)
	if err != nil {
		return nil, fmt.Errorf("failed to query factory connections: %w", err)
	}
	defer connRows.Close()

	var rawConns []rawConn
	for connRows.Next() {
		var rc rawConn
		if err := connRows.Scan(&rc.from, &rc.to, &rc.condition, &rc.fromPort, &rc.toPort); err != nil {
			return nil, fmt.Errorf("failed to scan factory connection: %w", err)
		}
		rawConns = append(rawConns, rc)
	}
	if err := connRows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate factory connections: %w", err)
	}

	// Append internal connections from equipmentLayout to rawConns.
	// These are the authoritative intra-machine connections stored by the Machine Editor.
	for _, ld := range machineLayouts {
		for _, c := range ld.connections {
			rawConns = append(rawConns, rawConn{from: c.from, to: c.to, condition: c.cond, fromPort: c.fromPort, toPort: c.toPort})
		}
	}

	// Entry/Exit resolution: Entry/Exit are logical connection nodes only.
	// Resolve them to the actual processing stations they connect to, then
	// remove entry/exit from the stations list.
	//
	// For each machine hub:
	//   hubInlets[hub] = stations that external connections should target (entry's downstream)
	//   hubOutlets[hub] = stations that external connections should originate from (exit's upstream)

	// Build internal connection graph for resolving entry/exit
	entryExitSet := make(map[string]bool)
	for _, rs := range rawStations {
		t := rs.stype
		if ot, ok := memberTypeOverride[rs.id]; ok && ot != "" {
			t = ot
		}
		if t == "entry" || t == "exit" {
			entryExitSet[rs.id] = true
		}
	}

	// Build adjacency: from → []to for internal connections (to resolve entry→processing, processing→exit)
	adjFrom := make(map[string][]string) // stationID → downstream station IDs
	adjTo := make(map[string][]string)   // stationID → upstream station IDs
	for _, rc := range rawConns {
		adjFrom[rc.from] = append(adjFrom[rc.from], rc.to)
		adjTo[rc.to] = append(adjTo[rc.to], rc.from)
	}

	// For each entry: find its 1:1 downstream non-entry/exit station
	entryResolved := make(map[string]string) // entry ID → resolved processing station ID
	for id := range entryExitSet {
		t := "entry"
		if ot, ok := memberTypeOverride[id]; ok && ot != "" {
			t = ot
		}
		if t != "entry" {
			continue
		}
		for _, next := range adjFrom[id] {
			if !entryExitSet[next] {
				entryResolved[id] = next
				break
			}
		}
	}

	// For each exit: find its 1:1 upstream non-entry/exit station
	exitResolved := make(map[string]string) // exit ID → resolved processing station ID
	for id := range entryExitSet {
		t := "exit"
		if ot, ok := memberTypeOverride[id]; ok && ot != "" {
			t = ot
		}
		if t != "exit" {
			continue
		}
		for _, prev := range adjTo[id] {
			if !entryExitSet[prev] {
				exitResolved[id] = prev
				break
			}
		}
	}

	// Build hub inlet/outlet maps (resolved through entry/exit)
	hubInlets := make(map[string][]string)  // hub ID → resolved station IDs (for incoming connections)
	hubOutlets := make(map[string][]string) // hub ID → resolved station IDs (for outgoing connections)
	for machineID, ld := range machineLayouts {
		for _, mem := range ld.members {
			switch mem.stationType {
			case "entry":
				if resolved, ok := entryResolved[mem.stationID]; ok {
					hubInlets[machineID] = append(hubInlets[machineID], resolved)
				}
			case "exit":
				if resolved, ok := exitResolved[mem.stationID]; ok {
					hubOutlets[machineID] = append(hubOutlets[machineID], resolved)
				}
			}
		}
	}

	// Remove entry/exit from stations list
	var filteredStations []domain.Station
	for _, st := range stations {
		if !entryExitSet[st.ID] {
			filteredStations = append(filteredStations, st)
		}
	}
	stations = filteredStations
	// Rebuild stationSet without entry/exit
	stationSet = make(map[string]bool)
	for _, st := range stations {
		stationSet[st.ID] = true
	}

	// Second pass: expand connections, skipping entry/exit nodes.
	seen := make(map[string]bool)
	var connections []domain.Connection
	addConn := func(from, to, condition string, fromPort, toPort int) {
		if from == to || !stationSet[from] || !stationSet[to] {
			return
		}
		key := fmt.Sprintf("%s->%s(%s)", from, to, condition)
		if !seen[key] {
			seen[key] = true
			connections = append(connections, domain.Connection{
				From:          from,
				To:            to,
				Condition:     domain.RoutingCondition(condition),
				FromPortIndex: fromPort,
				ToPortIndex:   toPort,
			})
		}
	}
	for _, rc := range rawConns {
		if rc.from == rc.to {
			continue
		}
		// Skip connections involving entry/exit directly (they are resolved above)
		if entryExitSet[rc.from] || entryExitSet[rc.to] {
			continue
		}
		fromIsHub := machineHubs[rc.from]
		toIsHub := machineHubs[rc.to]
		// Hub ↔ direct-child connections define topology only; skip.
		if fromIsHub && stationParent[rc.to] == rc.from {
			continue
		}
		if toIsHub && stationParent[rc.from] == rc.to {
			continue
		}
		if !fromIsHub && !toIsHub {
			addConn(rc.from, rc.to, rc.condition, rc.fromPort, rc.toPort)
			continue
		}
		// At least one endpoint is a hub — expand through resolved inlets/outlets.
		var froms []string
		if fromIsHub {
			froms = hubOutlets[rc.from]
		} else if stationSet[rc.from] {
			froms = []string{rc.from}
		}
		var tos []string
		if toIsHub {
			tos = hubInlets[rc.to]
		} else if stationSet[rc.to] {
			tos = []string{rc.to}
		}
		for _, f := range froms {
			for _, t := range tos {
				addConn(f, t, rc.condition, rc.fromPort, rc.toPort)
			}
		}
	}

	// Add intra-machine connections that don't involve entry/exit
	for _, ld := range machineLayouts {
		for _, c := range ld.connections {
			if entryExitSet[c.from] || entryExitSet[c.to] {
				continue
			}
			addConn(c.from, c.to, c.cond, c.fromPort, c.toPort)
		}
	}

	scenario := domain.NewScenario(factoryID, factoryName, stations, connections)
	domain.MigrateScenario(scenario)
	return scenario, nil
}

