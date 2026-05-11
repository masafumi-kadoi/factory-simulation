package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"testing"
)

// Tests switch merge → moduler (with sub-scenario)
func TestSwitchMerge_ToModuler(t *testing.T) {
	stations := []domain.Station{
		*domain.NewStation("src-a", domain.StationTypeSource, map[string]interface{}{
			"workCount": float64(3), "departureTime": float64(3.0), "workType": "typeA",
		}),
		*domain.NewStation("src-b", domain.StationTypeSource, map[string]interface{}{
			"workCount": float64(3), "departureTime": float64(3.0), "workType": "typeB",
		}),
		*domain.NewStation("sw-merge", domain.StationTypeSwitch, map[string]interface{}{
			"direction": "merge", "portCount": float64(2), "selectMode": "round-robin",
			"arrivalTime": float64(0.1), "departureTime": float64(0.1),
			"noWorkTimeout": float64(-1), "stayTime": float64(-1),
		}),
	}

	// Moduler with sub-scenario
	modStation := domain.NewStation("mod-1", domain.StationTypeModuler, map[string]interface{}{
		"entryCount": float64(1), "exitCount": float64(1),
	})
	modStation.EntryCount = 1
	modStation.ExitCount = 1
	modStation.SubScenario = &domain.SubScenario{
		Stations: []domain.Station{
			*domain.NewStation("entry-0", domain.StationTypeEntry, map[string]interface{}{}),
			*domain.NewStation("proc-0", domain.StationTypeProcessing, map[string]interface{}{
				"processingTime": float64(1.0), "arrivalTime": float64(0.5), "departureTime": float64(0.5),
			}),
			*domain.NewStation("exit-0", domain.StationTypeExit, map[string]interface{}{}),
		},
		Connections: []domain.Connection{
			{From: "entry-0", To: "proc-0", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-0", To: "exit-0", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		},
	}
	stations = append(stations, *modStation)

	drainStation := domain.NewStation("drain-1", domain.StationTypeDrain, map[string]interface{}{
		"arrivalTime": float64(0.5),
	})
	stations = append(stations, *drainStation)

	connections := []domain.Connection{
		{From: "src-a", To: "sw-merge", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		{From: "src-b", To: "sw-merge", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		{From: "sw-merge", To: "mod-1", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		{From: "mod-1", To: "drain-1", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
	}

	scenario := domain.NewScenario("test-sw-merge-moduler", "SwitchMerge+Moduler", stations, connections)
	engine := NewEngineWithInitialConditions(scenario, nil, nil)
	_, _, workEvents, _, err := engine.Run("sim-sw-merge-mod", "SwitchMerge+Moduler", 300.0)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	drainArrivals := 0
	for _, ev := range workEvents {
		if ev.StationID == "drain-1" && ev.EventType == "WorkArrived" {
			drainArrivals++
		}
	}
	if drainArrivals != 6 {
		t.Errorf("Expected 6 works at drain-1, got %d", drainArrivals)
	}
}

// Tests switch divert → 2 modulers
func TestSwitchDivert_ToModulers(t *testing.T) {
	stations := []domain.Station{
		*domain.NewStation("src-1", domain.StationTypeSource, map[string]interface{}{
			"workCount": float64(4), "departureTime": float64(3.0),
		}),
		*domain.NewStation("sw-d", domain.StationTypeSwitch, map[string]interface{}{
			"direction": "divert", "portCount": float64(2), "selectMode": "round-robin",
			"arrivalTime": float64(0.1), "departureTime": float64(0.1),
			"noWorkTimeout": float64(-1), "stayTime": float64(-1),
		}),
	}

	for i, name := range []string{"mod-a", "mod-b"} {
		_ = i
		modStation := domain.NewStation(name, domain.StationTypeModuler, map[string]interface{}{
			"entryCount": float64(1), "exitCount": float64(1),
		})
		modStation.EntryCount = 1
		modStation.ExitCount = 1
		modStation.SubScenario = &domain.SubScenario{
			Stations: []domain.Station{
				*domain.NewStation("entry-0", domain.StationTypeEntry, map[string]interface{}{}),
				*domain.NewStation("exit-0", domain.StationTypeExit, map[string]interface{}{}),
			},
			Connections: []domain.Connection{
				{From: "entry-0", To: "exit-0", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			},
		}
		stations = append(stations, *modStation)
		drain := domain.NewStation("drain-"+name, domain.StationTypeDrain, map[string]interface{}{
			"arrivalTime": float64(0.5),
		})
		stations = append(stations, *drain)
	}

	connections := []domain.Connection{
		{From: "src-1", To: "sw-d", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		{From: "sw-d", To: "mod-a", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		{From: "sw-d", To: "mod-b", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		{From: "mod-a", To: "drain-mod-a", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		{From: "mod-b", To: "drain-mod-b", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
	}

	scenario := domain.NewScenario("test-sw-divert-modulers", "SwitchDivert+Modulers", stations, connections)
	engine := NewEngineWithInitialConditions(scenario, nil, nil)
	_, _, workEvents, _, err := engine.Run("sim-sw-divert-mods", "SwitchDivert+Modulers", 300.0)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	total := 0
	for _, ev := range workEvents {
		if (ev.StationID == "drain-mod-a" || ev.StationID == "drain-mod-b") && ev.EventType == "WorkArrived" {
			total++
		}
	}
	if total != 4 {
		t.Errorf("Expected 4 works total at drains, got %d", total)
	}
}
