package wdhexport

import (
	"factory-simulation/simulation-core/internal/simulation"
	"fmt"
)

func (e *Exporter) exportItemMaster(workEvents []simulation.WorkEventLog) (int, error) {
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
			`INSERT INTO item_master (id, item_type) VALUES ($1, $2)`,
			ev.WorkID, itemType,
		)
		if err != nil {
			return count, fmt.Errorf("failed to insert item %s: %w", ev.WorkID, err)
		}
		count++
	}
	return count, nil
}

func (e *Exporter) exportItemMovement(workEvents []simulation.WorkEventLog) (int, error) {
	type actionRecord struct {
		timestamp float64
		itemID    string
		stationID string
		eventType string
		portIndex int
	}

	workHistory := make(map[string][]actionRecord)
	for _, ev := range workEvents {
		if ev.EventType == "WorkArrived" || ev.EventType == "WorkDeparted" || ev.EventType == "WorkCreated" || ev.EventType == "WorkDestroyed" {
			workHistory[ev.WorkID] = append(workHistory[ev.WorkID], actionRecord{
				timestamp: ev.Timestamp,
				itemID:    ev.WorkID,
				stationID: ev.StationID,
				eventType: ev.EventType,
				portIndex: ev.PortIndex,
			})
		}
	}

	tx, err := e.targetDB.Begin()
	if err != nil {
		return 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(
		`INSERT INTO item_movement (event_time, item_id, from_location_id, to_location_id, movement_type, port_index) VALUES ($1, $2, $3, $4, $5, $6)`,
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

		var portIndex *int16
		if ev.PortIndex >= 0 {
			v := int16(ev.PortIndex)
			portIndex = &v
		}

		if ev.EventType == "WorkArrived" {
			var fromLocID *int64
			for i := len(history) - 1; i >= 0; i-- {
				h := history[i]
				if h.timestamp <= ev.Timestamp && h.stationID != ev.StationID && h.eventType == "WorkDeparted" {
					if lid, ok := e.locationMap[h.stationID]; ok {
						fromLocID = &lid
					}
					break
				}
			}
			_, err = stmt.Exec(ts, ev.WorkID, fromLocID, locID, "arrived", portIndex)
		} else {
			var toLocID *int64
			for _, h := range history {
				if h.timestamp >= ev.Timestamp && h.stationID != ev.StationID && (h.eventType == "WorkArrived" || h.eventType == "WorkDestroyed") {
					if lid, ok := e.locationMap[h.stationID]; ok {
						toLocID = &lid
					}
					break
				}
			}
			_, err = stmt.Exec(ts, ev.WorkID, locID, toLocID, "departed", portIndex)
		}

		if err != nil {
			return count, fmt.Errorf("failed to insert movement: %w", err)
		}
		count++
	}

	if err := tx.Commit(); err != nil {
		return count, fmt.Errorf("failed to commit: %w", err)
	}
	return count, nil
}

func (e *Exporter) exportItemLineage(lineageLogs []simulation.WorkLineageLog) (int, error) {
	count := 0
	for _, log := range lineageLogs {
		locID, ok := e.locationMap[log.StationID]
		if !ok {
			continue
		}

		ts := e.simTimeToTimestamp(log.Timestamp)

		_, err := e.targetDB.Exec(
			`INSERT INTO item_lineage (event_time, input_item_id, output_item_id, location_id) VALUES ($1, $2, $3, $4)`,
			ts, log.ParentWorkID, log.ChildWorkID, locID,
		)
		if err != nil {
			return count, fmt.Errorf("failed to insert lineage: %w", err)
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

		var status int
		switch ev.QualityStatus {
		case "OK":
			status = 1
		case "NG":
			status = 2
		default:
			status = 99
		}

		_, err := e.targetDB.Exec(
			`INSERT INTO item_status (event_time, item_id, location_id, status) VALUES ($1, $2, $3, $4)`,
			ts, ev.WorkID, locID, status,
		)
		if err != nil {
			return count, fmt.Errorf("failed to insert item status: %w", err)
		}
		count++
	}
	return count, nil
}

func (e *Exporter) exportMachineSignal(statusLogs []simulation.StationStatusLog) (int, error) {
	tx, err := e.targetDB.Begin()
	if err != nil {
		return 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(
		`INSERT INTO machine_signal (event_time, machine_id, signal_name, value, old_value, rule_id) VALUES ($1, $2, $3, $4, $5, $6)`,
	)
	if err != nil {
		return 0, fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	count := 0
	for _, log := range statusLogs {
		if log.StatusType != "signal_change" {
			continue
		}
		if log.SignalName == "" {
			continue
		}

		// Use station ID as machine_id (matches machine_master.id)
		machineID := log.StationID
		if len(machineID) > 50 {
			machineID = machineID[:50]
		}

		ts := e.simTimeToTimestamp(log.Timestamp)

		var ruleID *string
		if log.RuleID != "" {
			ruleID = &log.RuleID
		}

		_, err = stmt.Exec(ts, machineID, log.SignalName, log.Value, log.OldValue, ruleID)
		if err != nil {
			return count, fmt.Errorf("failed to insert signal: %w", err)
		}
		count++
	}

	if err := tx.Commit(); err != nil {
		return count, fmt.Errorf("failed to commit: %w", err)
	}
	return count, nil
}
