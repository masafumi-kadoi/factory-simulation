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

		var id int64
		err := e.targetDB.QueryRow(
			`INSERT INTO "LocationMaster" (name, max_capacity) VALUES ($1, $2) RETURNING id`,
			station.ID, maxCapacity,
		).Scan(&id)
		if err != nil {
			return count, fmt.Errorf("failed to insert location %s: %w", station.ID, err)
		}
		e.locationMap[station.ID] = id
		count++
	}
	return count, nil
}

func (e *Exporter) exportProcMaster(scenario *domain.Scenario) (int, error) {
	// Assign proc IDs (1000-based)
	procID := int64(1000)
	for _, station := range scenario.Stations {
		e.procMap[station.ID] = procID
		procID++
	}

	// Build predecessor/successor maps from connections
	preMap := make(map[string]int64)
	postMap := make(map[string]int64)
	for _, conn := range scenario.Connections {
		if _, exists := preMap[conn.To]; !exists {
			if pid, ok := e.procMap[conn.From]; ok {
				preMap[conn.To] = pid
			}
		}
		if _, exists := postMap[conn.From]; !exists {
			if pid, ok := e.procMap[conn.To]; ok {
				postMap[conn.From] = pid
			}
		}
	}

	count := 0
	for _, station := range scenario.Stations {
		pid := e.procMap[station.ID]
		locID := e.locationMap[station.ID]

		var preProcID, postProcID *int64
		if v, ok := preMap[station.ID]; ok {
			preProcID = &v
		}
		if v, ok := postMap[station.ID]; ok {
			postProcID = &v
		}

		_, err := e.targetDB.Exec(
			`INSERT INTO "ProcMaster" (id, no, pre_proc_id, post_proc_id, location_id) VALUES ($1, $2, $3, $4, $5)`,
			pid, station.ID, preProcID, postProcID, locID,
		)
		if err != nil {
			return count, fmt.Errorf("failed to insert proc %s: %w", station.ID, err)
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

		machineName := station.Name
		if machineName == "" {
			machineName = station.ID
		}
		// Truncate to 50 chars for varchar(50)
		if len(machineName) > 50 {
			machineName = machineName[:50]
		}
		machineID := station.ID
		if len(machineID) > 50 {
			machineID = machineID[:50]
		}

		andonlogTable := "sim_" + station.ID

		locID := e.locationMap[station.ID]

		var cycleTime *int64
		if pt, ok := station.Config["processingTime"]; ok {
			if f, ok := pt.(float64); ok {
				ct := int64(f)
				cycleTime = &ct
			}
		}

		_, err := e.targetDB.Exec(
			`INSERT INTO "MachineMaster" (machine_id, machine_name, andonlog_table, location_id, machine_cycle_time) VALUES ($1, $2, $3, $4, $5)`,
			machineID, machineName, andonlogTable, locID, cycleTime,
		)
		if err != nil {
			return count, fmt.Errorf("failed to insert machine %s: %w", station.ID, err)
		}
		count++
	}
	return count, nil
}
