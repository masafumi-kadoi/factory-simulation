package simdb

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/lib/pq"
	_ "github.com/lib/pq"
)

type Config struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
}

type Client struct {
	conn *sql.DB
}

func Connect(cfg Config) (*Client, error) {
	connStr := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.Database)
	conn, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open SimDB connection: %w", err)
	}
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to ping SimDB: %w", err)
	}
	return &Client{conn: conn}, nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

type LocationEntry struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

func (c *Client) GetLocationMaster() ([]LocationEntry, error) {
	rows, err := c.conn.Query(`SELECT id, name FROM "LocationMaster" ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("failed to query LocationMaster: %w", err)
	}
	defer rows.Close()
	var locs []LocationEntry
	for rows.Next() {
		var l LocationEntry
		if err := rows.Scan(&l.ID, &l.Name); err != nil {
			return nil, fmt.Errorf("failed to scan LocationMaster: %w", err)
		}
		locs = append(locs, l)
	}
	return locs, rows.Err()
}

type WorkAtLocation struct {
	LocationID     int64
	ItemID         string
	ArrivedAt      time.Time
	ElapsedSeconds float64
}

func (c *Client) GetCurrentWorks(startTime time.Time) ([]WorkAtLocation, error) {
	query := `
		WITH arrived_works AS (
			SELECT destination_location_id AS location_id, item_id, event_timestamp AS arrived_at
			FROM "ActionInfo"
			WHERE event_timestamp <= $1 AND action_status = 'arrived'
		),
		current_works AS (
			SELECT a.location_id, a.item_id, a.arrived_at,
				EXTRACT(EPOCH FROM ($1::timestamp - a.arrived_at)) AS elapsed_seconds
			FROM arrived_works a
			WHERE NOT EXISTS (
				SELECT 1 FROM "ActionInfo" d
				WHERE d.origin_location_id = a.location_id AND d.item_id = a.item_id
					AND d.action_status = 'departed'
					AND d.event_timestamp > a.arrived_at AND d.event_timestamp <= $1
			)
		)
		SELECT location_id, item_id, arrived_at, elapsed_seconds FROM current_works
		ORDER BY location_id, arrived_at DESC`

	rows, err := c.conn.Query(query, startTime)
	if err != nil {
		return nil, fmt.Errorf("failed to query current works: %w", err)
	}
	defer rows.Close()
	var works []WorkAtLocation
	for rows.Next() {
		var w WorkAtLocation
		if err := rows.Scan(&w.LocationID, &w.ItemID, &w.ArrivedAt, &w.ElapsedSeconds); err != nil {
			return nil, fmt.Errorf("failed to scan work: %w", err)
		}
		works = append(works, w)
	}
	return works, rows.Err()
}

func (c *Client) GetQualityStatuses(itemIDs []string, startTime time.Time) (map[string]*string, error) {
	if len(itemIDs) == 0 {
		return make(map[string]*string), nil
	}
	query := `
		SELECT DISTINCT ON (item_id) item_id, item_status AS quality_status
		FROM "ItemStatus"
		WHERE item_id = ANY($1) AND update_timestamp <= $2
		ORDER BY item_id, update_timestamp DESC`

	rows, err := c.conn.Query(query, pq.Array(itemIDs), startTime)
	if err != nil {
		return nil, fmt.Errorf("failed to query quality statuses: %w", err)
	}
	defer rows.Close()
	statuses := make(map[string]*string)
	for rows.Next() {
		var itemID string
		var status *string
		if err := rows.Scan(&itemID, &status); err != nil {
			return nil, fmt.Errorf("failed to scan quality status: %w", err)
		}
		statuses[itemID] = status
	}
	return statuses, rows.Err()
}

// --- Initial conditions builder ---

type Warning struct {
	StationID  string `json:"stationId"`
	LocationID int64  `json:"locationId"`
	Message    string `json:"message"`
}

type StationCondition struct {
	CurrentWork *struct {
		ID            string  `json:"id"`
		QualityStatus *string `json:"qualityStatus"`
	} `json:"currentWork"`
	ElapsedTime float64 `json:"elapsedTime"`
}

type InitialConditionsResult struct {
	Conditions map[string]StationCondition `json:"initialConditions"`
	Warnings   []Warning                   `json:"warnings"`
}

func BuildInitialConditions(works []WorkAtLocation, qualityStatuses map[string]*string, locationToStation map[int64]string) *InitialConditionsResult {
	result := &InitialConditionsResult{
		Conditions: make(map[string]StationCondition),
		Warnings:   []Warning{},
	}

	worksByLocation := make(map[int64][]WorkAtLocation)
	for _, w := range works {
		worksByLocation[w.LocationID] = append(worksByLocation[w.LocationID], w)
	}

	for locationID, locationWorks := range worksByLocation {
		stationID, ok := locationToStation[locationID]
		if !ok {
			continue
		}
		if len(locationWorks) > 1 {
			result.Warnings = append(result.Warnings, Warning{
				StationID:  stationID,
				LocationID: locationID,
				Message:    fmt.Sprintf("同一locationに%dワーク検出。最新のワークを使用。", len(locationWorks)),
			})
		}
		work := locationWorks[0]
		var qualityStatus *string
		if qs, ok := qualityStatuses[work.ItemID]; ok {
			qualityStatus = qs
		}
		result.Conditions[stationID] = StationCondition{
			CurrentWork: &struct {
				ID            string  `json:"id"`
				QualityStatus *string `json:"qualityStatus"`
			}{ID: work.ItemID, QualityStatus: qualityStatus},
			ElapsedTime: work.ElapsedSeconds,
		}
	}
	return result
}
