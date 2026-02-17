package database

import (
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
		INSERT INTO work_events (simulation_run_id, work_id, work_friendly_name, station_id, timestamp, event_type, work_type)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
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
			log.WorkID,
			log.WorkFriendlyName,
			log.StationID,
			log.Timestamp,
			log.EventType,
			log.WorkType,
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
		SELECT id, friendly_name, scenario_id, simulation_end_time, end_reason, status
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
		ORDER BY timestamp ASC
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
		SELECT work_id, work_friendly_name, station_id, timestamp, event_type, COALESCE(work_type, '')
		FROM work_events
		WHERE simulation_run_id = $1
		ORDER BY timestamp ASC
	`

	rows, err := r.db.GetConnection().Query(query, simulationID)
	if err != nil {
		return nil, fmt.Errorf("failed to query work events: %w", err)
	}
	defer rows.Close()

	var logs []simulation.WorkEventLog
	for rows.Next() {
		var log simulation.WorkEventLog
		if err := rows.Scan(&log.WorkID, &log.WorkFriendlyName, &log.StationID, &log.Timestamp, &log.EventType, &log.WorkType); err != nil {
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

// SaveScenario saves a scenario to the database
func (r *Repository) SaveScenario(scenario *domain.Scenario) error {
	tx, err := r.db.GetConnection().Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Insert scenario with SimDB config
	var simdbHost, simdbDatabase, simdbUser, simdbPassword *string
	var simdbPort *int
	if scenario.SimDBConfig != nil {
		simdbHost = &scenario.SimDBConfig.Host
		simdbPort = &scenario.SimDBConfig.Port
		simdbDatabase = &scenario.SimDBConfig.Database
		simdbUser = &scenario.SimDBConfig.User
		simdbPassword = &scenario.SimDBConfig.Password
	}
	_, err = tx.Exec(`
		INSERT INTO scenarios (id, name, simdb_host, simdb_port, simdb_database, simdb_user, simdb_password)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			simdb_host = EXCLUDED.simdb_host,
			simdb_port = EXCLUDED.simdb_port,
			simdb_database = EXCLUDED.simdb_database,
			simdb_user = EXCLUDED.simdb_user,
			simdb_password = EXCLUDED.simdb_password,
			updated_at = CURRENT_TIMESTAMP
	`, scenario.ID, scenario.Name, simdbHost, simdbPort, simdbDatabase, simdbUser, simdbPassword)
	if err != nil {
		return fmt.Errorf("failed to insert scenario: %w", err)
	}

	// Delete existing stations and connections for this scenario
	_, err = tx.Exec("DELETE FROM scenario_stations WHERE scenario_id = $1", scenario.ID)
	if err != nil {
		return fmt.Errorf("failed to delete existing stations: %w", err)
	}

	_, err = tx.Exec("DELETE FROM scenario_connections WHERE scenario_id = $1", scenario.ID)
	if err != nil {
		return fmt.Errorf("failed to delete existing connections: %w", err)
	}

	// Insert stations
	for _, station := range scenario.Stations {
		configJSON, err := json.Marshal(station.Config)
		if err != nil {
			return fmt.Errorf("failed to marshal station config: %w", err)
		}

		_, err = tx.Exec(`
			INSERT INTO scenario_stations (scenario_id, station_id, station_type, parent_id, config, location_id, position_x, position_y, name)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, scenario.ID, station.ID, station.Type, station.ParentID, configJSON, station.LocationID, station.PositionX, station.PositionY, station.Name)
		if err != nil {
			return fmt.Errorf("failed to insert station: %w", err)
		}
	}

	// Insert connections
	for _, conn := range scenario.Connections {
		_, err = tx.Exec(`
			INSERT INTO scenario_connections (scenario_id, from_station, to_station, condition)
			VALUES ($1, $2, $3, $4)
		`, scenario.ID, conn.From, conn.To, conn.Condition)
		if err != nil {
			return fmt.Errorf("failed to insert connection: %w", err)
		}
	}

	return tx.Commit()
}

// DeleteScenario deletes a scenario and its stations/connections from the database
func (r *Repository) DeleteScenario(id string) error {
	tx, err := r.db.GetConnection().Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	_, err = tx.Exec("DELETE FROM scenario_connections WHERE scenario_id = $1", id)
	if err != nil {
		return fmt.Errorf("failed to delete connections: %w", err)
	}

	_, err = tx.Exec("DELETE FROM scenario_stations WHERE scenario_id = $1", id)
	if err != nil {
		return fmt.Errorf("failed to delete stations: %w", err)
	}

	result, err := tx.Exec("DELETE FROM scenarios WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("failed to delete scenario: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("scenario not found: %s", id)
	}

	return tx.Commit()
}

// GetScenario retrieves a scenario from the database
func (r *Repository) GetScenario(id string) (*domain.Scenario, error) {
	return r.getScenario(id, false)
}

// GetScenarioWithPassword retrieves a scenario including the SimDB password
func (r *Repository) GetScenarioWithPassword(id string) (*domain.Scenario, error) {
	return r.getScenario(id, true)
}

func (r *Repository) getScenario(id string, includePassword bool) (*domain.Scenario, error) {
	// Get scenario basic info with SimDB config
	var name string
	var simdbHost, simdbDatabase, simdbUser, simdbPassword *string
	var simdbPort *int
	var createdAt, updatedAt *time.Time
	err := r.db.GetConnection().QueryRow(`
		SELECT name, simdb_host, simdb_port, simdb_database, simdb_user, simdb_password, created_at, updated_at
		FROM scenarios WHERE id = $1
	`, id).Scan(&name, &simdbHost, &simdbPort, &simdbDatabase, &simdbUser, &simdbPassword, &createdAt, &updatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to get scenario: %w", err)
	}

	// Get stations
	rows, err := r.db.GetConnection().Query(`
		SELECT station_id, station_type, parent_id, config, location_id, position_x, position_y, name
		FROM scenario_stations
		WHERE scenario_id = $1
	`, id)
	if err != nil {
		return nil, fmt.Errorf("failed to query stations: %w", err)
	}
	defer rows.Close()

	var stations []domain.Station
	for rows.Next() {
		var stationID, stationType string
		var parentID *string
		var locationID *int64
		var positionX, positionY *float64
		var stationName *string
		var configJSON []byte

		if err := rows.Scan(&stationID, &stationType, &parentID, &configJSON, &locationID, &positionX, &positionY, &stationName); err != nil {
			return nil, fmt.Errorf("failed to scan station: %w", err)
		}

		var config map[string]interface{}
		if err := json.Unmarshal(configJSON, &config); err != nil {
			return nil, fmt.Errorf("failed to unmarshal config: %w", err)
		}

		station := domain.NewStation(stationID, domain.StationType(stationType), config)
		if stationName != nil {
			station.Name = *stationName
		}
		station.ParentID = parentID
		station.LocationID = locationID
		station.PositionX = positionX
		station.PositionY = positionY
		stations = append(stations, *station)
	}

	// Get connections
	connRows, err := r.db.GetConnection().Query(`
		SELECT from_station, to_station, condition
		FROM scenario_connections
		WHERE scenario_id = $1
	`, id)
	if err != nil {
		return nil, fmt.Errorf("failed to query connections: %w", err)
	}
	defer connRows.Close()

	var connections []domain.Connection
	for connRows.Next() {
		var from, to, condition string
		if err := connRows.Scan(&from, &to, &condition); err != nil {
			return nil, fmt.Errorf("failed to scan connection: %w", err)
		}

		connections = append(connections, domain.Connection{
			From:      from,
			To:        to,
			Condition: domain.RoutingCondition(condition),
		})
	}

	// Build scenario
	scenario := domain.NewScenario(id, name, stations, connections)
	scenario.CreatedAt = createdAt
	scenario.UpdatedAt = updatedAt

	// Build SimDBConfig if available
	if simdbHost != nil && *simdbHost != "" {
		cfg := &domain.SimDBConfig{
			Host:     *simdbHost,
			Database: "",
			User:     "",
		}
		if simdbPort != nil {
			cfg.Port = *simdbPort
		}
		if simdbDatabase != nil {
			cfg.Database = *simdbDatabase
		}
		if simdbUser != nil {
			cfg.User = *simdbUser
		}
		if includePassword && simdbPassword != nil {
			cfg.Password = *simdbPassword
		}
		scenario.SimDBConfig = cfg
	}

	return scenario, nil
}

// ListScenarios retrieves all scenarios from the database
func (r *Repository) ListScenarios() ([]*domain.Scenario, error) {
	// Get all scenario IDs
	rows, err := r.db.GetConnection().Query(`
		SELECT id, name FROM scenarios ORDER BY name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to query scenarios: %w", err)
	}
	defer rows.Close()

	var scenarios []*domain.Scenario
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("failed to scan scenario: %w", err)
		}

		// For each scenario, get full details
		scenario, err := r.GetScenario(id)
		if err != nil {
			return nil, fmt.Errorf("failed to get scenario %s: %w", id, err)
		}

		scenarios = append(scenarios, scenario)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating scenarios: %w", err)
	}

	return scenarios, nil
}
