package wdhexport

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
)

func (e *Exporter) exportLocationMaster(scenario *domain.Scenario) (int, error) {
	count := 0
	for _, station := range scenario.Stations {
		var maxCapacity int64 = 1
		if bufCap, ok := station.Config["bufferCapacity"]; ok {
			if f, ok := bufCap.(float64); ok {
				maxCapacity = int64(f)
			}
		}

		var processingTime *float64
		if pt, ok := station.Config["processingTime"]; ok {
			if f, ok := pt.(float64); ok {
				processingTime = &f
			}
		}

		var mergeCount *int16
		if station.Type == domain.StationTypeMerge {
			if mc, ok := station.Config["mergeCount"]; ok {
				if f, ok := mc.(float64); ok {
					v := int16(f)
					mergeCount = &v
				}
			}
		}

		var splitCount *int16
		if station.Type == domain.StationTypeSplit {
			if sc, ok := station.Config["splitCount"]; ok {
				if f, ok := sc.(float64); ok {
					v := int16(f)
					splitCount = &v
				}
			}
		}

		var parentLocationID *int64
		if scenario.StationMachineMap != nil {
			if parentID, ok := scenario.StationMachineMap[station.ID]; ok && parentID != "" {
				if pid, ok := e.locationMap[parentID]; ok {
					parentLocationID = &pid
				}
			}
		}

		var id int64
		err := e.targetDB.QueryRow(
			`INSERT INTO location_master (name, station_type, parent_location_id, pos_x, pos_y, pos_z, max_capacity, processing_time, merge_count, split_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
			station.ID, string(station.Type), parentLocationID,
			station.PositionX, station.PositionY, nil,
			maxCapacity, processingTime, mergeCount, splitCount,
		).Scan(&id)
		if err != nil {
			return count, fmt.Errorf("failed to insert location %s: %w", station.ID, err)
		}
		e.locationMap[station.ID] = id
		count++
	}
	return count, nil
}

func (e *Exporter) exportConnectionMaster(scenario *domain.Scenario) (int, error) {
	count := 0
	for _, conn := range scenario.Connections {
		fromLocID, fromOk := e.locationMap[conn.From]
		toLocID, toOk := e.locationMap[conn.To]
		if !fromOk || !toOk {
			continue
		}

		var fromPortIndex *int16
		if conn.FromPortIndex >= 0 {
			v := int16(conn.FromPortIndex)
			fromPortIndex = &v
		}

		var toPortIndex *int16
		if conn.ToPortIndex >= 0 {
			v := int16(conn.ToPortIndex)
			toPortIndex = &v
		}

		var condition *string
		if conn.Condition != "" && conn.Condition != domain.RoutingDefault {
			c := string(conn.Condition)
			condition = &c
		}

		_, err := e.targetDB.Exec(
			`INSERT INTO connection_master (from_location_id, to_location_id, from_port_index, to_port_index, condition) VALUES ($1, $2, $3, $4, $5)`,
			fromLocID, toLocID, fromPortIndex, toPortIndex, condition,
		)
		if err != nil {
			return count, fmt.Errorf("failed to insert connection %s->%s: %w", conn.From, conn.To, err)
		}
		count++
	}
	return count, nil
}

func (e *Exporter) exportMachineMaster(scenario *domain.Scenario) (int, error) {
	count := 0
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

		locID := e.locationMap[station.ID]

		var cycleTime *float64
		if pt, ok := station.Config["processingTime"]; ok {
			if f, ok := pt.(float64); ok {
				cycleTime = &f
			}
		}

		_, err := e.targetDB.Exec(
			`INSERT INTO machine_master (id, name, location_id, cycle_time) VALUES ($1, $2, $3, $4)`,
			machineID, name, locID, cycleTime,
		)
		if err != nil {
			return count, fmt.Errorf("failed to insert machine %s: %w", station.ID, err)
		}
		count++
	}
	return count, nil
}
