package simdb

import (
	"fmt"
	"time"

	"github.com/lib/pq"
)

// WorkAtLocation represents a work item found at a SimDB location
type WorkAtLocation struct {
	LocationID     int64
	ItemID         string
	ArrivedAt      time.Time
	ElapsedSeconds float64
}

// QualityStatus represents quality status of a work item
type QualityStatus struct {
	ItemID  string
	Status  *string // nil means quality check not performed
}

// Warning represents a warning during initial condition retrieval
type Warning struct {
	StationID  string `json:"stationId"`
	LocationID int64  `json:"locationId"`
	Message    string `json:"message"`
}

// StationInitialCondition represents the initial condition for a single station
type StationInitialCondition struct {
	CurrentWork *struct {
		ID            string  `json:"id"`
		QualityStatus *string `json:"qualityStatus"`
	} `json:"currentWork"`
	ElapsedTime float64 `json:"elapsedTime"`
}

// InitialConditionsResult holds the result of initial conditions retrieval
type InitialConditionsResult struct {
	Conditions map[string]StationInitialCondition `json:"initialConditions"`
	Warnings   []Warning                          `json:"warnings"`
}

// GetCurrentWorks finds works present at each location at the given start time.
// Uses NOT EXISTS pattern: arrived but not departed by start_time.
func (c *Client) GetCurrentWorks(startTime time.Time) ([]WorkAtLocation, error) {
	query := `
		WITH arrived_works AS (
			SELECT
				destination_location_id AS location_id,
				item_id,
				event_timestamp AS arrived_at
			FROM "ActionInfo"
			WHERE event_timestamp <= $1
				AND action_status = 'arrived'
		),
		current_works AS (
			SELECT
				a.location_id,
				a.item_id,
				a.arrived_at,
				EXTRACT(EPOCH FROM ($1::timestamp - a.arrived_at)) AS elapsed_seconds
			FROM arrived_works a
			WHERE NOT EXISTS (
				SELECT 1 FROM "ActionInfo" d
				WHERE d.origin_location_id = a.location_id
					AND d.item_id = a.item_id
					AND d.action_status = 'departed'
					AND d.event_timestamp > a.arrived_at
					AND d.event_timestamp <= $1
			)
		)
		SELECT
			location_id,
			item_id,
			arrived_at,
			elapsed_seconds
		FROM current_works
		ORDER BY location_id, arrived_at DESC
	`

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

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating works: %w", err)
	}

	return works, nil
}

// GetQualityStatuses retrieves quality statuses for given item IDs at start time
func (c *Client) GetQualityStatuses(itemIDs []string, startTime time.Time) (map[string]*string, error) {
	if len(itemIDs) == 0 {
		return make(map[string]*string), nil
	}

	query := `
		SELECT DISTINCT ON (item_id)
			item_id,
			item_status AS quality_status
		FROM "ItemStatus"
		WHERE item_id = ANY($1)
			AND update_timestamp <= $2
		ORDER BY item_id, update_timestamp DESC
	`

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

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating quality statuses: %w", err)
	}

	return statuses, nil
}

// BuildInitialConditions constructs the initial conditions by combining SimDB data
// with the station-to-location mapping from the scenario.
// locationToStation maps location_id -> station_id.
func BuildInitialConditions(works []WorkAtLocation, qualityStatuses map[string]*string, locationToStation map[int64]string) *InitialConditionsResult {
	result := &InitialConditionsResult{
		Conditions: make(map[string]StationInitialCondition),
		Warnings:   []Warning{},
	}

	// Group works by location_id
	worksByLocation := make(map[int64][]WorkAtLocation)
	for _, w := range works {
		worksByLocation[w.LocationID] = append(worksByLocation[w.LocationID], w)
	}

	// Process each location
	for locationID, locationWorks := range worksByLocation {
		stationID, ok := locationToStation[locationID]
		if !ok {
			// No station mapped to this location, skip
			continue
		}

		// Check for multiple works at same location
		if len(locationWorks) > 1 {
			result.Warnings = append(result.Warnings, Warning{
				StationID:  stationID,
				LocationID: locationID,
				Message:    fmt.Sprintf("同一locationに%dワーク検出。最新のワークを使用。", len(locationWorks)),
			})
		}

		// Use the most recent work (already sorted by arrived_at DESC)
		work := locationWorks[0]

		// Get quality status
		var qualityStatus *string
		if qs, ok := qualityStatuses[work.ItemID]; ok {
			qualityStatus = qs
		}

		condition := StationInitialCondition{
			CurrentWork: &struct {
				ID            string  `json:"id"`
				QualityStatus *string `json:"qualityStatus"`
			}{
				ID:            work.ItemID,
				QualityStatus: qualityStatus,
			},
			ElapsedTime: work.ElapsedSeconds,
		}

		result.Conditions[stationID] = condition
	}

	return result
}
