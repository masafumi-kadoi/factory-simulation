package wdhexport

import (
	"database/sql"
	"factory-simulation/simulation-core/internal/domain"
	"factory-simulation/simulation-core/internal/simulation"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

// DirectWriter writes simulation results directly to the main factory_simulation DB
// with a given data_source_id (new WDH unified schema).
type DirectWriter struct {
	db           *sql.DB
	dataSourceID string
	locationMap  map[string]int64
	baseTime     time.Time
}

func NewDirectWriter(db *sql.DB, dataSourceID string, baseTime time.Time) *DirectWriter {
	return &DirectWriter{
		db:           db,
		dataSourceID: dataSourceID,
		locationMap:  make(map[string]int64),
		baseTime:     baseTime,
	}
}

func (w *DirectWriter) simTimeToTimestamp(simTime float64) time.Time {
	return w.baseTime.Add(time.Duration(simTime * float64(time.Second)))
}

type WriteInput struct {
	Scenario          *domain.Scenario
	WorkEvents        []simulation.WorkEventLog
	LineageLogs       []simulation.WorkLineageLog
	StationStatusLogs []simulation.StationStatusLog
}

// Write persists all simulation results in a single transaction so partial
// failures never leave the DB in a corrupt state.
func (w *DirectWriter) Write(input WriteInput) error {
	tx, err := w.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	if err := w.writeLocationMaster(tx, input.Scenario); err != nil {
		return fmt.Errorf("location_master: %w", err)
	}
	if err := w.writeConnectionMaster(tx, input.Scenario); err != nil {
		return fmt.Errorf("connection_master: %w", err)
	}
	if err := w.writeMachineMaster(tx, input.Scenario); err != nil {
		return fmt.Errorf("machine_master: %w", err)
	}
	if err := w.writeItemMaster(tx, input.WorkEvents); err != nil {
		return fmt.Errorf("item_master: %w", err)
	}
	if err := w.writeItemMovement(tx, input.WorkEvents); err != nil {
		return fmt.Errorf("item_movement: %w", err)
	}
	if err := w.writeItemLineage(tx, input.LineageLogs); err != nil {
		return fmt.Errorf("item_lineage: %w", err)
	}
	if err := w.writeItemStatus(tx, input.WorkEvents); err != nil {
		return fmt.Errorf("item_status: %w", err)
	}
	if err := w.writeMachineSignal(tx, input.StationStatusLogs); err != nil {
		return fmt.Errorf("machine_signal: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	log.Printf("[DirectWriter] completed for data_source_id=%s", w.dataSourceID)
	return nil
}

func (w *DirectWriter) writeLocationMaster(tx *sql.Tx, scenario *domain.Scenario) error {
	for _, station := range scenario.Stations {
		var maxCapacity int64 = 1
		if v, ok := station.Config["bufferCapacity"]; ok {
			if f, ok := v.(float64); ok {
				maxCapacity = int64(f)
			}
		}
		var processingTime *float64
		if v, ok := station.Config["processingTime"]; ok {
			if f, ok := v.(float64); ok {
				processingTime = &f
			}
		}
		var mergeCount *int16
		if station.Type == domain.StationTypeMerge {
			if v, ok := station.Config["mergeCount"]; ok {
				if f, ok := v.(float64); ok {
					mc := int16(f)
					mergeCount = &mc
				}
			}
		}
		var splitCount *int16
		if station.Type == domain.StationTypeSplit {
			if v, ok := station.Config["splitCount"]; ok {
				if f, ok := v.(float64); ok {
					sc := int16(f)
					splitCount = &sc
				}
			}
		}
		var parentLocationID *int64
		if scenario.StationModulerMap != nil {
			if parentID, ok := scenario.StationModulerMap[station.ID]; ok && parentID != "" {
				if pid, ok := w.locationMap[parentID]; ok {
					parentLocationID = &pid
				}
			}
		}
		var id int64
		err := tx.QueryRow(
			`INSERT INTO location_master (data_source_id, name, station_type, parent_location_id, pos_x, pos_y, pos_z, max_capacity, processing_time, merge_count, split_count)
			 VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10) RETURNING id`,
			w.dataSourceID, station.ID, string(station.Type), parentLocationID,
			station.PositionX, station.PositionY,
			maxCapacity, processingTime, mergeCount, splitCount,
		).Scan(&id)
		if err != nil {
			return fmt.Errorf("insert location %s: %w", station.ID, err)
		}
		w.locationMap[station.ID] = id
	}
	return nil
}

func (w *DirectWriter) writeConnectionMaster(tx *sql.Tx, scenario *domain.Scenario) error {
	for _, conn := range scenario.Connections {
		fromLocID, fromOk := w.locationMap[conn.From]
		toLocID, toOk := w.locationMap[conn.To]
		if !fromOk || !toOk {
			continue
		}
		var fromPort, toPort *int16
		if conn.FromPortIndex >= 0 {
			v := int16(conn.FromPortIndex)
			fromPort = &v
		}
		if conn.ToPortIndex >= 0 {
			v := int16(conn.ToPortIndex)
			toPort = &v
		}
		var cond *string
		if conn.Condition != "" && conn.Condition != domain.RoutingDefault {
			c := string(conn.Condition)
			cond = &c
		}
		_, err := tx.Exec(
			`INSERT INTO connection_master (data_source_id, from_location_id, to_location_id, from_port_index, to_port_index, condition)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			w.dataSourceID, fromLocID, toLocID, fromPort, toPort, cond,
		)
		if err != nil {
			return fmt.Errorf("insert connection %s->%s: %w", conn.From, conn.To, err)
		}
	}
	return nil
}

func (w *DirectWriter) writeMachineMaster(tx *sql.Tx, scenario *domain.Scenario) error {
	for _, station := range scenario.Stations {
		if station.Type == domain.StationTypeSource || station.Type == domain.StationTypeDrain {
			continue
		}
		name := station.Name
		if name == "" {
			name = station.ID
		}
		if len(name) > 50 {
			name = name[:50]
		}
		machineID := station.ID
		if len(machineID) > 50 {
			machineID = machineID[:50]
		}
		locID := w.locationMap[station.ID]
		var cycleTime *float64
		if v, ok := station.Config["processingTime"]; ok {
			if f, ok := v.(float64); ok {
				cycleTime = &f
			}
		}
		_, err := tx.Exec(
			`INSERT INTO machine_master (id, data_source_id, name, location_id, cycle_time) VALUES ($1,$2,$3,$4,$5)`,
			machineID, w.dataSourceID, name, locID, cycleTime,
		)
		if err != nil {
			return fmt.Errorf("insert machine %s: %w", station.ID, err)
		}
	}
	return nil
}

func (w *DirectWriter) writeItemMaster(tx *sql.Tx, events []simulation.WorkEventLog) error {
	seen := make(map[string]bool)
	for _, ev := range events {
		if ev.EventType != "WorkCreated" || seen[ev.WorkID] {
			continue
		}
		seen[ev.WorkID] = true
		itemType := ev.WorkType
		if itemType == "" {
			itemType = "work"
		}
		_, err := tx.Exec(
			`INSERT INTO item_master (id, data_source_id, item_type) VALUES ($1,$2,$3)`,
			ev.WorkID, w.dataSourceID, itemType,
		)
		if err != nil {
			return fmt.Errorf("insert item_master %s: %w", ev.WorkID, err)
		}
	}
	return nil
}

func (w *DirectWriter) writeItemMovement(tx *sql.Tx, events []simulation.WorkEventLog) error {
	type hist struct {
		ts        float64
		stationID string
		eventType string
		portIndex int
	}
	workHistory := make(map[string][]hist)
	for _, ev := range events {
		switch ev.EventType {
		case "WorkArrived", "WorkDeparted", "WorkCreated", "WorkDestroyed":
			workHistory[ev.WorkID] = append(workHistory[ev.WorkID], hist{ev.Timestamp, ev.StationID, ev.EventType, ev.PortIndex})
		}
	}

	stmt, err := tx.Prepare(
		`INSERT INTO item_movement (event_time, data_source_id, item_id, from_location_id, to_location_id, movement_type, port_index)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, ev := range events {
		if ev.EventType != "WorkArrived" && ev.EventType != "WorkDeparted" {
			continue
		}
		ts := w.simTimeToTimestamp(ev.Timestamp)
		locID := w.locationMap[ev.StationID]
		history := workHistory[ev.WorkID]
		var portIndex *int16
		if ev.PortIndex >= 0 {
			v := int16(ev.PortIndex)
			portIndex = &v
		}
		var execErr error
		if ev.EventType == "WorkArrived" {
			var fromLocID *int64
			for i := len(history) - 1; i >= 0; i-- {
				h := history[i]
				if h.ts <= ev.Timestamp && h.stationID != ev.StationID && h.eventType == "WorkDeparted" {
					if lid, ok := w.locationMap[h.stationID]; ok {
						fromLocID = &lid
					}
					break
				}
			}
			_, execErr = stmt.Exec(ts, w.dataSourceID, ev.WorkID, fromLocID, locID, "arrived", portIndex)
		} else {
			var toLocID *int64
			for _, h := range history {
				if h.ts >= ev.Timestamp && h.stationID != ev.StationID && (h.eventType == "WorkArrived" || h.eventType == "WorkDestroyed") {
					if lid, ok := w.locationMap[h.stationID]; ok {
						toLocID = &lid
					}
					break
				}
			}
			_, execErr = stmt.Exec(ts, w.dataSourceID, ev.WorkID, locID, toLocID, "departed", portIndex)
		}
		if execErr != nil {
			return fmt.Errorf("insert item_movement: %w", execErr)
		}
	}
	return nil
}

func (w *DirectWriter) writeItemLineage(tx *sql.Tx, logs []simulation.WorkLineageLog) error {
	for _, l := range logs {
		locID, ok := w.locationMap[l.StationID]
		if !ok {
			continue
		}
		ts := w.simTimeToTimestamp(l.Timestamp)
		_, err := tx.Exec(
			`INSERT INTO item_lineage (event_time, data_source_id, input_item_id, output_item_id, location_id)
			 VALUES ($1,$2,$3,$4,$5)`,
			ts, w.dataSourceID, l.ParentWorkID, l.ChildWorkID, locID,
		)
		if err != nil {
			return fmt.Errorf("insert item_lineage: %w", err)
		}
	}
	return nil
}

func (w *DirectWriter) writeItemStatus(tx *sql.Tx, events []simulation.WorkEventLog) error {
	for _, ev := range events {
		if ev.EventType != "ProcessingCompleted" || ev.QualityStatus == "" || ev.QualityStatus == "未判定" {
			continue
		}
		locID, ok := w.locationMap[ev.StationID]
		if !ok {
			continue
		}
		ts := w.simTimeToTimestamp(ev.Timestamp)
		var status int
		switch ev.QualityStatus {
		case "OK":
			status = 1
		case "NG":
			status = 2
		default:
			status = 99
		}
		_, err := tx.Exec(
			`INSERT INTO item_status (event_time, data_source_id, item_id, location_id, status)
			 VALUES ($1,$2,$3,$4,$5)`,
			ts, w.dataSourceID, ev.WorkID, locID, status,
		)
		if err != nil {
			return fmt.Errorf("insert item_status: %w", err)
		}
	}
	return nil
}

func (w *DirectWriter) writeMachineSignal(tx *sql.Tx, logs []simulation.StationStatusLog) error {
	stmt, err := tx.Prepare(
		`INSERT INTO machine_signal (event_time, data_source_id, machine_id, signal_name, value, old_value, rule_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, l := range logs {
		if l.StatusType != "signal_change" || l.SignalName == "" {
			continue
		}
		machineID := l.StationID
		if len(machineID) > 50 {
			machineID = machineID[:50]
		}
		ts := w.simTimeToTimestamp(l.Timestamp)
		var ruleID *string
		if l.RuleID != "" {
			ruleID = &l.RuleID
		}
		if _, err := stmt.Exec(ts, w.dataSourceID, machineID, l.SignalName, l.Value, l.OldValue, ruleID); err != nil {
			return fmt.Errorf("insert machine_signal: %w", err)
		}
	}
	return nil
}
