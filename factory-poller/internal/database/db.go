package database

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

type DB struct {
	conn *sql.DB
}

func New(dsn string) (*DB, error) {
	conn, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("ping internal DB: %w", err)
	}
	return &DB{conn: conn}, nil
}

func (d *DB) Close() {
	d.conn.Close()
}

type LocationRow struct {
	ExternalID int64
	Name       string
	StationType string
	PosX        *float64
	PosY        *float64
	MaxCapacity *int
	ProcessingTime *float64
}

type MovementRow struct {
	EventTime      time.Time
	ItemID         string
	FromLocationID *int64
	ToLocationID   *int64
	MovementType   string
}

// ConnectExternal opens a connection to the external factory DB.
func ConnectExternal(host string, port int, dbname, user, password string) (*sql.DB, error) {
	dsn := fmt.Sprintf("host=%s port=%d dbname=%s user=%s password=%s sslmode=disable",
		host, port, dbname, user, password)
	conn, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("ping external DB: %w", err)
	}
	return conn, nil
}

// FetchExternalLocations reads location_master from external DB.
func FetchExternalLocations(ext *sql.DB, dataSourceID string) ([]LocationRow, error) {
	rows, err := ext.Query(`
		SELECT lm.id, lm.name, lm.station_type,
		       lm.pos_x, lm.pos_y, lm.max_capacity, lm.processing_time
		FROM location_master lm
		WHERE lm.data_source_id = $1`, dataSourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []LocationRow
	for rows.Next() {
		var r LocationRow
		if err := rows.Scan(&r.ExternalID, &r.Name, &r.StationType,
			&r.PosX, &r.PosY, &r.MaxCapacity, &r.ProcessingTime); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// RegisterLocations inserts location_master entries for the given data_source_id and returns external→internal ID map.
func (d *DB) RegisterLocations(dataSourceID string, locs []LocationRow) (map[int64]int64, error) {
	m := make(map[int64]int64, len(locs))
	for _, loc := range locs {
		var internalID int64
		err := d.conn.QueryRow(`
			INSERT INTO location_master (data_source_id, name, station_type, pos_x, pos_y, max_capacity, processing_time)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT DO NOTHING
			RETURNING id`,
			dataSourceID, loc.Name, loc.StationType, loc.PosX, loc.PosY, loc.MaxCapacity, loc.ProcessingTime,
		).Scan(&internalID)
		if err == sql.ErrNoRows {
			// already exists, look it up
			err = d.conn.QueryRow(`SELECT id FROM location_master WHERE data_source_id=$1 AND name=$2`,
				dataSourceID, loc.Name).Scan(&internalID)
		}
		if err != nil {
			return nil, fmt.Errorf("register location %s: %w", loc.Name, err)
		}
		m[loc.ExternalID] = internalID
	}
	return m, nil
}

// FetchExternalMovements returns item_movement rows from external DB newer than afterTime.
func FetchExternalMovements(ext *sql.DB, dataSourceID string, afterTime time.Time) ([]MovementRow, error) {
	rows, err := ext.Query(`
		SELECT im.event_time, im.item_id, im.from_location_id, im.to_location_id, im.movement_type
		FROM item_movement im
		WHERE im.data_source_id = $1 AND im.event_time > $2
		ORDER BY im.event_time ASC`, dataSourceID, afterTime)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []MovementRow
	for rows.Next() {
		var r MovementRow
		if err := rows.Scan(&r.EventTime, &r.ItemID, &r.FromLocationID, &r.ToLocationID, &r.MovementType); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// InsertMovements inserts movements into internal DB with location ID remapping.
func (d *DB) InsertMovements(internalDataSourceID string, rows []MovementRow, locMap map[int64]int64) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := d.conn.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`
		INSERT INTO item_movement (event_time, data_source_id, item_id, from_location_id, to_location_id, movement_type)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT DO NOTHING`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()

	for _, r := range rows {
		var fromID, toID interface{}
		if r.FromLocationID != nil {
			if mapped, ok := locMap[*r.FromLocationID]; ok {
				fromID = mapped
			}
		}
		if r.ToLocationID != nil {
			if mapped, ok := locMap[*r.ToLocationID]; ok {
				toID = mapped
			}
		}
		if _, err := stmt.Exec(r.EventTime, internalDataSourceID, r.ItemID, fromID, toID, r.MovementType); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// EnsureItemMaster upserts item records.
func (d *DB) EnsureItemMaster(dataSourceID string, itemIDs []string) error {
	for _, id := range itemIDs {
		_, err := d.conn.Exec(`
			INSERT INTO item_master (id, data_source_id, item_type)
			VALUES ($1, $2, 'unknown') ON CONFLICT DO NOTHING`, id, dataSourceID)
		if err != nil {
			return err
		}
	}
	return nil
}

// GetLatestEventTime returns the most recent event_time for the given internal data_source_id.
func (d *DB) GetLatestEventTime(dataSourceID string) (time.Time, error) {
	var t time.Time
	err := d.conn.QueryRow(
		`SELECT COALESCE(MAX(event_time), '1970-01-01') FROM item_movement WHERE data_source_id = $1`,
		dataSourceID,
	).Scan(&t)
	return t, err
}

// CreateRealtimeDataSource creates a data_source row for realtime polling.
func (d *DB) CreateRealtimeDataSource(factoryID, label string) (string, error) {
	var id string
	err := d.conn.QueryRow(`
		INSERT INTO data_sources (source_type, factory_id, label, config)
		VALUES ('realtime', $1, $2, '{}')
		RETURNING id`, factoryID, label).Scan(&id)
	return id, err
}

// EndDataSource sets ended_at = NOW() for the data source.
func (d *DB) EndDataSource(dataSourceID string) error {
	_, err := d.conn.Exec(
		`UPDATE data_sources SET ended_at = NOW() WHERE id = $1`, dataSourceID)
	return err
}

// GetActiveRealtimeDataSource returns the active (ended_at IS NULL) realtime data_source for a factory.
func (d *DB) GetActiveRealtimeDataSource(factoryID string) (string, error) {
	var id string
	err := d.conn.QueryRow(`
		SELECT id FROM data_sources
		WHERE source_type='realtime' AND factory_id=$1 AND ended_at IS NULL
		ORDER BY started_at DESC LIMIT 1`, factoryID).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return id, err
}
