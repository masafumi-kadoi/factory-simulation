package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// --- Factory ---

type Factory struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Description     *string    `json:"description,omitempty"`
	FactoryDBHost   *string    `json:"factoryDbHost,omitempty"`
	FactoryDBPort   *int       `json:"factoryDbPort,omitempty"`
	FactoryDBName   *string    `json:"factoryDbName,omitempty"`
	FactoryDBUser   *string    `json:"factoryDbUser,omitempty"`
	FactoryDBPass   *string    `json:"factoryDbPassword,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type FactoryStation struct {
	ID          int             `json:"id"`
	FactoryID   string          `json:"factoryId"`
	StationID   string          `json:"stationId"`
	EquipmentID string          `json:"equipmentId"`
	SeqNumber   int             `json:"seqNumber"`
	Name        *string         `json:"name,omitempty"`
	StationType string          `json:"stationType"`
	PositionX   float64         `json:"positionX"`
	PositionY   float64         `json:"positionY"`
	Config      json.RawMessage `json:"config"`
}

func (r *Repository) ListFactories() ([]Factory, error) {
	rows, err := r.db.Conn().Query(
		`SELECT id, name, description, factory_db_host, factory_db_port, factory_db_name, factory_db_user, factory_db_password, created_at, updated_at
		 FROM factories ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Factory, 0)
	for rows.Next() {
		var f Factory
		if err := rows.Scan(&f.ID, &f.Name, &f.Description, &f.FactoryDBHost, &f.FactoryDBPort,
			&f.FactoryDBName, &f.FactoryDBUser, &f.FactoryDBPass, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, f)
	}
	return result, rows.Err()
}

func (r *Repository) CreateFactory(name, description string) (*Factory, error) {
	var f Factory
	err := r.db.Conn().QueryRow(
		`INSERT INTO factories (name, description) VALUES ($1, $2) RETURNING id, name, description, created_at, updated_at`,
		name, nullStr(description),
	).Scan(&f.ID, &f.Name, &f.Description, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &f, nil
}

func (r *Repository) GetFactory(id string) (*Factory, error) {
	var f Factory
	err := r.db.Conn().QueryRow(
		`SELECT id, name, description, factory_db_host, factory_db_port, factory_db_name, factory_db_user, factory_db_password, created_at, updated_at
		 FROM factories WHERE id = $1`, id,
	).Scan(&f.ID, &f.Name, &f.Description, &f.FactoryDBHost, &f.FactoryDBPort,
		&f.FactoryDBName, &f.FactoryDBUser, &f.FactoryDBPass, &f.CreatedAt, &f.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("factory not found: %s", id)
	}
	return &f, err
}

func (r *Repository) UpdateFactory(id, name, description string) error {
	_, err := r.db.Conn().Exec(
		`UPDATE factories SET name=$2, description=$3, updated_at=NOW() WHERE id=$1`,
		id, name, nullStr(description),
	)
	return err
}

func (r *Repository) ListFactoryStations(factoryID string) ([]FactoryStation, error) {
	rows, err := r.db.Conn().Query(
		`SELECT id, factory_id, station_id, equipment_id, seq_number, name, station_type, position_x, position_y, config
		 FROM factory_stations WHERE factory_id = $1 ORDER BY station_id`, factoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]FactoryStation, 0)
	for rows.Next() {
		var s FactoryStation
		if err := rows.Scan(&s.ID, &s.FactoryID, &s.StationID, &s.EquipmentID, &s.SeqNumber,
			&s.Name, &s.StationType, &s.PositionX, &s.PositionY, &s.Config); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func (r *Repository) ImportStations(factoryID string, stations []FactoryStation) error {
	tx, err := r.db.Conn().Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM factory_stations WHERE factory_id = $1`, factoryID); err != nil {
		return err
	}

	stmt, err := tx.Prepare(`INSERT INTO factory_stations
		(factory_id, station_id, equipment_id, seq_number, name, station_type, position_x, position_y, config)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, s := range stations {
		cfg := s.Config
		if cfg == nil {
			cfg = json.RawMessage("{}")
		}
		if _, err := stmt.Exec(factoryID, s.StationID, s.EquipmentID, s.SeqNumber,
			s.Name, s.StationType, s.PositionX, s.PositionY, cfg); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *Repository) AddFactoryStation(factoryID, stationID, name, stationType string, posX, posY float64) error {
	// Extract equipment_id (part before last dot) and seq_number
	equipID := stationID
	seqNum := 0
	if dotIdx := strings.LastIndex(stationID, "."); dotIdx >= 0 {
		equipID = stationID[:dotIdx]
		fmt.Sscanf(stationID[dotIdx+1:], "%d", &seqNum)
	}
	if stationType == "" {
		stationType = "machine"
	}
	_, err := r.db.Conn().Exec(
		`INSERT INTO factory_stations (factory_id, station_id, equipment_id, seq_number, name, station_type, position_x, position_y, config)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}')
		 ON CONFLICT (factory_id, station_id) DO UPDATE SET name=$5, station_type=$6, position_x=$7, position_y=$8`,
		factoryID, stationID, equipID, seqNum, nullStr(name), stationType, posX, posY,
	)
	return err
}

func (r *Repository) DeleteFactoryStation(factoryID, stationID string) error {
	_, err := r.db.Conn().Exec(
		`DELETE FROM factory_stations WHERE factory_id=$1 AND station_id=$2`,
		factoryID, stationID,
	)
	return err
}

// --- Scenarios ---

type Scenario struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	FactoryID    *string    `json:"factoryId,omitempty"`
	ScenarioType string     `json:"scenarioType"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

func (r *Repository) ListScenarios() ([]Scenario, error) {
	rows, err := r.db.Conn().Query(
		`SELECT id, name, factory_id, scenario_type, created_at, updated_at FROM scenarios ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Scenario, 0)
	for rows.Next() {
		var s Scenario
		if err := rows.Scan(&s.ID, &s.Name, &s.FactoryID, &s.ScenarioType, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func (r *Repository) ListScenariosByFactory(factoryID string) ([]Scenario, error) {
	rows, err := r.db.Conn().Query(
		`SELECT id, name, factory_id, scenario_type, created_at, updated_at FROM scenarios WHERE factory_id=$1 ORDER BY updated_at DESC`,
		factoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Scenario, 0)
	for rows.Next() {
		var s Scenario
		if err := rows.Scan(&s.ID, &s.Name, &s.FactoryID, &s.ScenarioType, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func (r *Repository) GetScenario(id string) (*Scenario, error) {
	var s Scenario
	err := r.db.Conn().QueryRow(
		`SELECT id, name, factory_id, scenario_type, created_at, updated_at FROM scenarios WHERE id = $1`, id,
	).Scan(&s.ID, &s.Name, &s.FactoryID, &s.ScenarioType, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("scenario not found: %s", id)
	}
	return &s, err
}

// --- DataSources ---

type DataSource struct {
	ID           string          `json:"id"`
	SourceType   string          `json:"sourceType"`
	ScenarioID   *string         `json:"scenarioId,omitempty"`
	FactoryID    *string         `json:"factoryId,omitempty"`
	Label        *string         `json:"label,omitempty"`
	FriendlyName *string         `json:"friendlyName,omitempty"`
	StartedAt    time.Time       `json:"startedAt"`
	EndedAt      *time.Time      `json:"endedAt,omitempty"`
	Config       json.RawMessage `json:"config"`
	CreatedAt    time.Time       `json:"createdAt"`
}

func (r *Repository) ListDataSources() ([]DataSource, error) {
	rows, err := r.db.Conn().Query(
		`SELECT id, source_type, scenario_id, factory_id, label, friendly_name, started_at, ended_at, config, created_at
		 FROM data_sources ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]DataSource, 0)
	for rows.Next() {
		var d DataSource
		if err := rows.Scan(&d.ID, &d.SourceType, &d.ScenarioID, &d.FactoryID, &d.Label,
			&d.FriendlyName, &d.StartedAt, &d.EndedAt, &d.Config, &d.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, d)
	}
	return result, rows.Err()
}

func (r *Repository) CreateDataSource(sourceType, scenarioID, friendlyName string, cfg json.RawMessage) (*DataSource, error) {
	var d DataSource
	if cfg == nil {
		cfg = json.RawMessage("{}")
	}
	err := r.db.Conn().QueryRow(
		`INSERT INTO data_sources (source_type, scenario_id, friendly_name, config)
		 VALUES ($1,$2,$3,$4) RETURNING id, source_type, scenario_id, factory_id, label, friendly_name, started_at, ended_at, config, created_at`,
		sourceType, nullStr(scenarioID), nullStr(friendlyName), cfg,
	).Scan(&d.ID, &d.SourceType, &d.ScenarioID, &d.FactoryID, &d.Label,
		&d.FriendlyName, &d.StartedAt, &d.EndedAt, &d.Config, &d.CreatedAt)
	return &d, err
}

func (r *Repository) CreateRealtimeDataSource(factoryID, label string) (*DataSource, error) {
	var d DataSource
	err := r.db.Conn().QueryRow(
		`INSERT INTO data_sources (source_type, factory_id, label, config)
		 VALUES ('realtime',$1,$2,'{}') RETURNING id, source_type, scenario_id, factory_id, label, friendly_name, started_at, ended_at, config, created_at`,
		factoryID, nullStr(label),
	).Scan(&d.ID, &d.SourceType, &d.ScenarioID, &d.FactoryID, &d.Label,
		&d.FriendlyName, &d.StartedAt, &d.EndedAt, &d.Config, &d.CreatedAt)
	return &d, err
}

func (r *Repository) GetDataSource(id string) (*DataSource, error) {
	var d DataSource
	err := r.db.Conn().QueryRow(
		`SELECT id, source_type, scenario_id, factory_id, label, friendly_name, started_at, ended_at, config, created_at
		 FROM data_sources WHERE id = $1`, id,
	).Scan(&d.ID, &d.SourceType, &d.ScenarioID, &d.FactoryID, &d.Label,
		&d.FriendlyName, &d.StartedAt, &d.EndedAt, &d.Config, &d.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("data source not found: %s", id)
	}
	return &d, err
}

func (r *Repository) PatchDataSource(id string, endedAt *time.Time) error {
	_, err := r.db.Conn().Exec(`UPDATE data_sources SET ended_at=$2 WHERE id=$1`, id, endedAt)
	return err
}

func (r *Repository) DeleteDataSource(id string) error {
	_, err := r.db.Conn().Exec(`DELETE FROM data_sources WHERE id=$1`, id)
	return err
}

// --- Events ---

type EventRecord struct {
	Table          string     `json:"table"`
	EventTime      time.Time  `json:"event_time"`
	ItemID         *string    `json:"item_id,omitempty"`
	FromLocationID *int64     `json:"from_location_id,omitempty"`
	ToLocationID   *int64     `json:"to_location_id,omitempty"`
	MovementType   *string    `json:"movement_type,omitempty"`
	PortIndex      *int16     `json:"port_index,omitempty"`
	MachineID      *string    `json:"machine_id,omitempty"`
	SignalName     *string    `json:"signal_name,omitempty"`
	Value          *bool      `json:"value,omitempty"`
}

func (r *Repository) GetEvents(dataSourceID string, from, to time.Time) ([]EventRecord, error) {
	movEvents := make([]EventRecord, 0)
	sigEvents := make([]EventRecord, 0)

	movRows, err := r.db.Conn().Query(
		`SELECT event_time, item_id, from_location_id, to_location_id, movement_type, port_index
		 FROM item_movement WHERE data_source_id=$1 AND event_time BETWEEN $2 AND $3 ORDER BY event_time`,
		dataSourceID, from, to)
	if err != nil {
		return nil, err
	}
	defer movRows.Close()
	for movRows.Next() {
		var e EventRecord
		e.Table = "item_movement"
		if err := movRows.Scan(&e.EventTime, &e.ItemID, &e.FromLocationID, &e.ToLocationID, &e.MovementType, &e.PortIndex); err != nil {
			return nil, err
		}
		movEvents = append(movEvents, e)
	}

	sigRows, err := r.db.Conn().Query(
		`SELECT event_time, machine_id, signal_name, value
		 FROM machine_signal WHERE data_source_id=$1 AND event_time BETWEEN $2 AND $3 ORDER BY event_time`,
		dataSourceID, from, to)
	if err != nil {
		return nil, err
	}
	defer sigRows.Close()
	for sigRows.Next() {
		var e EventRecord
		e.Table = "machine_signal"
		if err := sigRows.Scan(&e.EventTime, &e.MachineID, &e.SignalName, &e.Value); err != nil {
			return nil, err
		}
		sigEvents = append(sigEvents, e)
	}

	// Merge two sorted slices into one sorted result
	merged := make([]EventRecord, 0, len(movEvents)+len(sigEvents))
	i, j := 0, 0
	for i < len(movEvents) && j < len(sigEvents) {
		if !movEvents[i].EventTime.After(sigEvents[j].EventTime) {
			merged = append(merged, movEvents[i])
			i++
		} else {
			merged = append(merged, sigEvents[j])
			j++
		}
	}
	merged = append(merged, movEvents[i:]...)
	merged = append(merged, sigEvents[j:]...)

	return merged, nil
}

// --- Layout ---

type LocationRecord struct {
	ID              int64    `json:"id"`
	Name            string   `json:"name"`
	StationType     *string  `json:"stationType,omitempty"`
	ParentLocationID *int64  `json:"parentLocationId,omitempty"`
	PosX            *float64 `json:"posX,omitempty"`
	PosY            *float64 `json:"posY,omitempty"`
	MaxCapacity     *int64   `json:"maxCapacity,omitempty"`
	ProcessingTime  *float64 `json:"processingTime,omitempty"`
}

type ConnectionRecord struct {
	ID            int64   `json:"id"`
	FromLocationID int64  `json:"fromLocationId"`
	ToLocationID   int64  `json:"toLocationId"`
	FromPortIndex  *int16 `json:"fromPortIndex,omitempty"`
	ToPortIndex    *int16 `json:"toPortIndex,omitempty"`
	Condition      *string `json:"condition,omitempty"`
}

func (r *Repository) GetLayout(dataSourceID string) ([]LocationRecord, []ConnectionRecord, error) {
	locRows, err := r.db.Conn().Query(
		`SELECT id, name, station_type, parent_location_id, pos_x, pos_y, max_capacity, processing_time
		 FROM location_master WHERE data_source_id=$1 ORDER BY id`, dataSourceID)
	if err != nil {
		return nil, nil, err
	}
	defer locRows.Close()
	locs := make([]LocationRecord, 0)
	for locRows.Next() {
		var l LocationRecord
		if err := locRows.Scan(&l.ID, &l.Name, &l.StationType, &l.ParentLocationID,
			&l.PosX, &l.PosY, &l.MaxCapacity, &l.ProcessingTime); err != nil {
			return nil, nil, err
		}
		locs = append(locs, l)
	}

	connRows, err := r.db.Conn().Query(
		`SELECT id, from_location_id, to_location_id, from_port_index, to_port_index, condition
		 FROM connection_master WHERE data_source_id=$1 ORDER BY id`, dataSourceID)
	if err != nil {
		return nil, nil, err
	}
	defer connRows.Close()
	conns := make([]ConnectionRecord, 0)
	for connRows.Next() {
		var c ConnectionRecord
		if err := connRows.Scan(&c.ID, &c.FromLocationID, &c.ToLocationID,
			&c.FromPortIndex, &c.ToPortIndex, &c.Condition); err != nil {
			return nil, nil, err
		}
		conns = append(conns, c)
	}
	return locs, conns, nil
}

// --- Execution configs ---

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

func (r *Repository) ListExecutions() ([]ExecutionConfig, error) {
	rows, err := r.db.Conn().Query(
		`SELECT id, scenario_id, start_time, end_condition_type, end_condition_value,
		        initial_conditions, status, data_source_id, error_message, created_at, updated_at
		 FROM execution_configs ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]ExecutionConfig, 0)
	for rows.Next() {
		var e ExecutionConfig
		if err := rows.Scan(&e.ID, &e.ScenarioID, &e.StartTime, &e.EndConditionType, &e.EndConditionValue,
			&e.InitialConditions, &e.Status, &e.DataSourceID, &e.ErrorMessage, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, e)
	}
	return result, rows.Err()
}

func (r *Repository) GetExecution(id string) (*ExecutionConfig, error) {
	var e ExecutionConfig
	err := r.db.Conn().QueryRow(
		`SELECT id, scenario_id, start_time, end_condition_type, end_condition_value,
		        initial_conditions, status, data_source_id, error_message, created_at, updated_at
		 FROM execution_configs WHERE id=$1`, id,
	).Scan(&e.ID, &e.ScenarioID, &e.StartTime, &e.EndConditionType, &e.EndConditionValue,
		&e.InitialConditions, &e.Status, &e.DataSourceID, &e.ErrorMessage, &e.CreatedAt, &e.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("execution not found: %s", id)
	}
	return &e, err
}

func (r *Repository) CreateExecution(e *ExecutionConfig) error {
	_, err := r.db.Conn().Exec(
		`INSERT INTO execution_configs
		 (id, scenario_id, start_time, end_condition_type, end_condition_value, initial_conditions, status, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		e.ID, e.ScenarioID, e.StartTime, e.EndConditionType, e.EndConditionValue,
		e.InitialConditions, e.Status, e.CreatedAt, e.UpdatedAt,
	)
	return err
}

func (r *Repository) UpdateExecutionStatus(id, status string, dataSourceID *string, errMsg *string) error {
	_, err := r.db.Conn().Exec(
		`UPDATE execution_configs SET status=$2, data_source_id=$3, error_message=$4, updated_at=NOW() WHERE id=$1`,
		id, status, dataSourceID, errMsg,
	)
	return err
}

func (r *Repository) DeleteExecution(id string) error {
	result, err := r.db.Conn().Exec(`DELETE FROM execution_configs WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return fmt.Errorf("execution not found: %s", id)
	}
	return nil
}

// Repository wraps the DB
type Repository struct {
	db *DB
}

func NewRepository(db *DB) *Repository {
	return &Repository{db: db}
}

func nullStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
