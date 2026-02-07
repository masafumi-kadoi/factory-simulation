package database

import (
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
		INSERT INTO simulation_runs (id, scenario_id, start_time, end_time, simulation_end_time, end_reason, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
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
		sim.ScenarioID,
		now,
		endTime,
		simEndTime,
		endReason,
		string(sim.Status),
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
		INSERT INTO station_status_logs (simulation_run_id, station_id, timestamp, status_type, value)
		VALUES ($1, $2, $3, $4, $5)
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
		INSERT INTO work_events (simulation_run_id, work_id, station_id, timestamp, event_type)
		VALUES ($1, $2, $3, $4, $5)
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
			log.StationID,
			log.Timestamp,
			log.EventType,
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
		SELECT id, scenario_id, simulation_end_time, end_reason, status
		FROM simulation_runs
		WHERE id = $1
	`

	var sim domain.Simulation
	var endTime *float64
	var endReason *string
	var status string

	err := r.db.GetConnection().QueryRow(query, id).Scan(
		&sim.ID,
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
		SELECT station_id, timestamp, status_type, value
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
		if err := rows.Scan(&log.StationID, &log.Timestamp, &log.StatusType, &log.Value); err != nil {
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
		SELECT work_id, station_id, timestamp, event_type
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
		if err := rows.Scan(&log.WorkID, &log.StationID, &log.Timestamp, &log.EventType); err != nil {
			return nil, fmt.Errorf("failed to scan work event: %w", err)
		}
		logs = append(logs, log)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating work events: %w", err)
	}

	return logs, nil
}
