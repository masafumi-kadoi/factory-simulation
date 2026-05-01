package wdhexport

import (
	"factory-simulation/simulation-core/internal/simulation"
	"fmt"
)

func (e *Exporter) exportItemIDInfo(workEvents []simulation.WorkEventLog) (int, error) {
	seen := make(map[string]bool)
	count := 0

	for _, ev := range workEvents {
		if ev.EventType != "WorkCreated" {
			continue
		}
		if seen[ev.WorkID] {
			continue
		}
		seen[ev.WorkID] = true

		itemType := ev.WorkType
		if itemType == "" {
			itemType = "work"
		}

		_, err := e.targetDB.Exec(
			`INSERT INTO "ItemIDInfo" (item_id, item_type) VALUES ($1, $2)`,
			ev.WorkID, itemType,
		)
		if err != nil {
			return count, fmt.Errorf("failed to insert item %s: %w", ev.WorkID, err)
		}
		count++
	}
	return count, nil
}

func (e *Exporter) exportActionInfo(workEvents []simulation.WorkEventLog) (int, error) {
	// Build per-work event sequences for origin/destination lookup
	type actionRecord struct {
		timestamp   float64
		itemID      string
		stationID   string
		eventType   string
	}

	workHistory := make(map[string][]actionRecord)
	for _, ev := range workEvents {
		if ev.EventType == "WorkArrived" || ev.EventType == "WorkDeparted" || ev.EventType == "WorkCreated" || ev.EventType == "WorkDestroyed" || ev.EventType == "WorkPortEntered" {
			workHistory[ev.WorkID] = append(workHistory[ev.WorkID], actionRecord{
				timestamp: ev.Timestamp,
				itemID:    ev.WorkID,
				stationID: ev.StationID,
				eventType: ev.EventType,
			})
		}
	}

	tx, err := e.targetDB.Begin()
	if err != nil {
		return 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(
		`INSERT INTO "ActionInfo" (event_timestamp, item_id, origin_location_id, destination_location_id, action_status) VALUES ($1, $2, $3, $4, $5)`,
	)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	count := 0
	for _, ev := range workEvents {
		if ev.EventType != "WorkArrived" && ev.EventType != "WorkDeparted" {
			continue
		}

		ts := e.simTimeToTimestamp(ev.Timestamp)
		locID := e.locationMap[ev.StationID]

		history := workHistory[ev.WorkID]

		if ev.EventType == "WorkArrived" {
			// Find origin: most recent Departed event for this work (at or before this time, different station)
			var originLocID *int64
			for i := len(history) - 1; i >= 0; i-- {
				h := history[i]
				if h.timestamp <= ev.Timestamp && h.stationID != ev.StationID && h.eventType == "WorkDeparted" {
					if lid, ok := e.locationMap[h.stationID]; ok {
						originLocID = &lid
					}
					break
				}
			}
			_, err = stmt.Exec(ts, ev.WorkID, originLocID, locID, "arrived")
		} else {
			// WorkDeparted: find destination: next Arrived event for this work (at or after this time, different station)
			var destLocID *int64
			for _, h := range history {
				if h.timestamp >= ev.Timestamp && h.stationID != ev.StationID && (h.eventType == "WorkArrived" || h.eventType == "WorkPortEntered" || h.eventType == "WorkDestroyed") {
					if lid, ok := e.locationMap[h.stationID]; ok {
						destLocID = &lid
					}
					break
				}
			}
			_, err = stmt.Exec(ts, ev.WorkID, locID, destLocID, "departed")
		}

		if err != nil {
			return count, fmt.Errorf("failed to insert action: %w", err)
		}
		count++
	}

	if err := tx.Commit(); err != nil {
		return count, fmt.Errorf("failed to commit: %w", err)
	}
	return count, nil
}

func (e *Exporter) exportItemConstructionMapping(lineageLogs []simulation.WorkLineageLog) (int, error) {
	count := 0
	for _, log := range lineageLogs {
		locID, ok := e.locationMap[log.StationID]
		if !ok {
			continue
		}

		ts := e.simTimeToTimestamp(log.Timestamp)

		_, err := e.targetDB.Exec(
			`INSERT INTO "ItemConstructionMapping" (event_timestamp, input_item_id, output_item_id, construction_mapping_location_id) VALUES ($1, $2, $3, $4)`,
			ts, log.ParentWorkID, log.ChildWorkID, locID,
		)
		if err != nil {
			return count, fmt.Errorf("failed to insert mapping: %w", err)
		}
		count++
	}
	return count, nil
}

func (e *Exporter) exportItemStatus(workEvents []simulation.WorkEventLog) (int, error) {
	count := 0
	for _, ev := range workEvents {
		if ev.EventType != "ProcessingCompleted" || ev.QualityStatus == "" || ev.QualityStatus == "未判定" {
			continue
		}

		locID, ok := e.locationMap[ev.StationID]
		if !ok {
			continue
		}

		ts := e.simTimeToTimestamp(ev.Timestamp)

		var itemStatus int
		switch ev.QualityStatus {
		case "OK":
			itemStatus = 1
		case "NG":
			itemStatus = 2
		default:
			itemStatus = 99
		}

		_, err := e.targetDB.Exec(
			`INSERT INTO "ItemStatus" (update_timestamp, item_id, location_id, item_status) VALUES ($1, $2, $3, $4)`,
			ts, ev.WorkID, locID, itemStatus,
		)
		if err != nil {
			return count, fmt.Errorf("failed to insert item status: %w", err)
		}
		count++
	}
	return count, nil
}
