package database

import (
	"encoding/json"
	"fmt"
	"time"
)

// ExecutionConfig represents an execution configuration record
type ExecutionConfig struct {
	ID                string          `json:"id"`
	ScenarioID        string          `json:"scenarioId"`
	StartTime         time.Time       `json:"startTime"`
	EndConditionType  string          `json:"endConditionType"`
	EndConditionValue string          `json:"endConditionValue"`
	InitialConditions json.RawMessage `json:"initialConditions"`
	Status            string          `json:"status"`
	DataSourceID      *string         `json:"dataSourceId,omitempty"`
	ErrorMessage      *string         `json:"errorMessage,omitempty"`
	CreatedAt         time.Time       `json:"createdAt"`
	UpdatedAt         time.Time       `json:"updatedAt"`
}

// Repository handles database operations for sim-executor
type Repository struct {
	db *DB
}

// NewRepository creates a new repository
func NewRepository(db *DB) *Repository {
	return &Repository{db: db}
}

// GetDB returns the underlying database connection
func (r *Repository) GetDB() *DB {
	return r.db
}

// SaveExecution inserts a new execution config
func (r *Repository) SaveExecution(exec *ExecutionConfig) error {
	query := `
		INSERT INTO execution_configs (id, scenario_id, start_time, end_condition_type, end_condition_value, initial_conditions, status, data_source_id, error_message, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`

	_, err := r.db.GetConnection().Exec(query,
		exec.ID,
		exec.ScenarioID,
		exec.StartTime,
		exec.EndConditionType,
		exec.EndConditionValue,
		exec.InitialConditions,
		exec.Status,
		exec.DataSourceID,
		exec.ErrorMessage,
		exec.CreatedAt,
		exec.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save execution: %w", err)
	}

	return nil
}

// GetExecutionsByScenarioID retrieves executions for a scenario
func (r *Repository) GetExecutionsByScenarioID(scenarioID string) ([]ExecutionConfig, error) {
	query := `
		SELECT id, scenario_id, start_time, end_condition_type, end_condition_value, initial_conditions, status, data_source_id, error_message, created_at, updated_at
		FROM execution_configs
		WHERE scenario_id = $1
		ORDER BY created_at DESC
	`

	rows, err := r.db.GetConnection().Query(query, scenarioID)
	if err != nil {
		return nil, fmt.Errorf("failed to query executions: %w", err)
	}
	defer rows.Close()

	var executions []ExecutionConfig
	for rows.Next() {
		var exec ExecutionConfig
		if err := rows.Scan(
			&exec.ID,
			&exec.ScenarioID,
			&exec.StartTime,
			&exec.EndConditionType,
			&exec.EndConditionValue,
			&exec.InitialConditions,
			&exec.Status,
			&exec.DataSourceID,
			&exec.ErrorMessage,
			&exec.CreatedAt,
			&exec.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan execution: %w", err)
		}
		executions = append(executions, exec)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating executions: %w", err)
	}

	return executions, nil
}

// UpdateExecutionStatus updates the status and optional fields of an execution
func (r *Repository) UpdateExecutionStatus(id string, status string, simulationID *string, errorMessage *string) error {
	query := `
		UPDATE execution_configs
		SET status = $2, data_source_id = $3, error_message = $4, updated_at = $5
		WHERE id = $1
	`

	_, err := r.db.GetConnection().Exec(query, id, status, simulationID, errorMessage, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update execution status: %w", err)
	}

	return nil
}

// DeleteExecution deletes an execution by ID
func (r *Repository) DeleteExecution(id string) error {
	result, err := r.db.GetConnection().Exec(
		"DELETE FROM execution_configs WHERE id = $1", id,
	)
	if err != nil {
		return fmt.Errorf("failed to delete execution: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("execution not found: %s", id)
	}
	return nil
}

// CountExecutionsByScenarioID counts executions for a scenario
func (r *Repository) CountExecutionsByScenarioID(scenarioID string) (int, error) {
	var count int
	err := r.db.GetConnection().QueryRow(
		"SELECT COUNT(*) FROM execution_configs WHERE scenario_id = $1",
		scenarioID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count executions: %w", err)
	}
	return count, nil
}
