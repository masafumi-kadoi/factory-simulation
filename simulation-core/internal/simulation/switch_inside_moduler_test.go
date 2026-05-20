package simulation

import (
	"fmt"
	"testing"

	"factory-simulation/simulation-core/internal/domain"
)

// makeProcStation creates a processing station with the exact timing from the failing scenario
func makeProcStation(id string) domain.Station {
	return *domain.NewStation(id, domain.StationTypeProcessing, map[string]interface{}{
		"processingTime": float64(2), "arrivalTime": float64(1), "departureTime": float64(1),
	})
}

// TestSwitchInsideModuler_ExactScenario reproduces deadlock fd23d979:
// src-1 (workCount=3, depart=5) → mod-1(proc-A) → inner-mod ← mod-2(proc-B, proc-C) ← src-2
// inner-mod: entry-0 → proc-D → proc-E → sw-merge → proc-F → proc-G → exit-0
//            entry-1 → proc-H → sw-merge
func TestSwitchInsideModuler_ExactScenario(t *testing.T) {
	// Outer moduler 1: entry-0 → processing-856080 → exit-0
	mod1 := domain.NewStation("mod1", domain.StationTypeMachine, map[string]interface{}{})
	mod1.EntryCount = 1
	mod1.ExitCount = 1
	mod1.SubScenario = &domain.SubScenario{
		Stations: []domain.Station{
			*domain.NewStation("entry-0", domain.StationTypeEntry, map[string]interface{}{}),
			makeProcStation("proc-856080"),
			*domain.NewStation("exit-0", domain.StationTypeExit, map[string]interface{}{}),
		},
		Connections: []domain.Connection{
			{From: "entry-0", To: "proc-856080", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-856080", To: "exit-0", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		},
	}

	// Outer moduler 2: entry-0 → processing-906533 → processing-907297 → exit-0
	mod2 := domain.NewStation("mod2", domain.StationTypeMachine, map[string]interface{}{})
	mod2.EntryCount = 1
	mod2.ExitCount = 1
	mod2.SubScenario = &domain.SubScenario{
		Stations: []domain.Station{
			*domain.NewStation("entry-0", domain.StationTypeEntry, map[string]interface{}{}),
			makeProcStation("proc-906533"),
			makeProcStation("proc-907297"),
			*domain.NewStation("exit-0", domain.StationTypeExit, map[string]interface{}{}),
		},
		Connections: []domain.Connection{
			{From: "entry-0", To: "proc-906533", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-906533", To: "proc-907297", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-907297", To: "exit-0", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		},
	}

	// Inner moduler: exact structure from failing scenario
	// entry-0 → proc-959858 → proc-960570 → sw-merge → proc-963251 → proc-963885 → exit-0
	// entry-1 → proc-962065 → sw-merge
	innerMod := domain.NewStation("inner-mod", domain.StationTypeMachine, map[string]interface{}{})
	innerMod.EntryCount = 2
	innerMod.ExitCount = 1
	innerMod.SubScenario = &domain.SubScenario{
		Stations: []domain.Station{
			*domain.NewStation("entry-0", domain.StationTypeEntry, map[string]interface{}{}),
			*domain.NewStation("entry-1", domain.StationTypeEntry, map[string]interface{}{}),
			makeProcStation("proc-959858"),
			makeProcStation("proc-960570"),
			makeProcStation("proc-962065"),
			*domain.NewStation("sw-merge", domain.StationTypeSwitch, map[string]interface{}{
				"direction": "merge", "portCount": float64(2), "selectMode": "round-robin",
				"arrivalTime": float64(0.1), "departureTime": float64(0.1),
			}),
			makeProcStation("proc-963251"),
			makeProcStation("proc-963885"),
			*domain.NewStation("exit-0", domain.StationTypeExit, map[string]interface{}{}),
		},
		Connections: []domain.Connection{
			{From: "entry-0", To: "proc-959858", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-959858", To: "proc-960570", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-960570", To: "sw-merge", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "entry-1", To: "proc-962065", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-962065", To: "sw-merge", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "sw-merge", To: "proc-963251", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-963251", To: "proc-963885", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-963885", To: "exit-0", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		},
	}

	stations := []domain.Station{
		*domain.NewStation("src-1", domain.StationTypeSource, map[string]interface{}{
			"workCount": float64(3), "departureTime": float64(5),
		}),
		*domain.NewStation("src-2", domain.StationTypeSource, map[string]interface{}{
			"workCount": float64(3), "departureTime": float64(5),
		}),
		*mod1, *mod2, *innerMod,
		*domain.NewStation("drain-1", domain.StationTypeDrain, map[string]interface{}{
			"arrivalTime": float64(1),
		}),
	}

	connections := []domain.Connection{
		{From: "src-1", To: "mod1", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		{From: "src-2", To: "mod2", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		{From: "mod1", To: "inner-mod", Condition: "default", FromPortIndex: -1, ToPortIndex: 0},
		{From: "mod2", To: "inner-mod", Condition: "default", FromPortIndex: -1, ToPortIndex: 1},
		{From: "inner-mod", To: "drain-1", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
	}

	scenario := domain.NewScenario("test-exact", "ExactScenario", stations, connections)
	engine := NewEngineWithInitialConditions(scenario, nil, nil)
	_, _, workEvents, _, err := engine.Run("sim-exact", "Exact", 300.0)
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
		fmt.Printf("=== Work Events (last 50) ===\n")
		start := len(workEvents) - 50
		if start < 0 {
			start = 0
		}
		for _, ev := range workEvents[start:] {
			fmt.Printf("  t=%.3f station=%s event=%s work=%s\n", ev.Timestamp, ev.StationID, ev.EventType, ev.WorkID)
		}
		t.Errorf("Expected 6 works at drain-1, got %d (deadlock?)", drainArrivals)
	}
}

// TestSwitchInsideModuler: basic case, switch inside moduler with 2 sources directly
func TestSwitchInsideModuler(t *testing.T) {
	innerModuler := domain.NewStation("inner-mod", domain.StationTypeMachine, map[string]interface{}{
		"entryCount": float64(2), "exitCount": float64(1),
	})
	innerModuler.EntryCount = 2
	innerModuler.ExitCount = 1
	innerModuler.SubScenario = &domain.SubScenario{
		Stations: []domain.Station{
			*domain.NewStation("entry-0", domain.StationTypeEntry, map[string]interface{}{}),
			*domain.NewStation("entry-1", domain.StationTypeEntry, map[string]interface{}{}),
			*domain.NewStation("proc-a", domain.StationTypeProcessing, map[string]interface{}{
				"processingTime": float64(2.0), "arrivalTime": float64(0.1), "departureTime": float64(0.1),
			}),
			*domain.NewStation("proc-b", domain.StationTypeProcessing, map[string]interface{}{
				"processingTime": float64(2.0), "arrivalTime": float64(0.1), "departureTime": float64(0.1),
			}),
			*domain.NewStation("sw-merge", domain.StationTypeSwitch, map[string]interface{}{
				"direction": "merge", "portCount": float64(2), "selectMode": "round-robin",
				"arrivalTime": float64(0.1), "departureTime": float64(0.1),
			}),
			*domain.NewStation("proc-c", domain.StationTypeProcessing, map[string]interface{}{
				"processingTime": float64(2.0), "arrivalTime": float64(0.1), "departureTime": float64(0.1),
			}),
			*domain.NewStation("exit-0", domain.StationTypeExit, map[string]interface{}{}),
		},
		Connections: []domain.Connection{
			{From: "entry-0", To: "proc-a", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "entry-1", To: "proc-b", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-a", To: "sw-merge", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-b", To: "sw-merge", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "sw-merge", To: "proc-c", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc-c", To: "exit-0", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		},
	}

	stations := []domain.Station{
		*domain.NewStation("src-1", domain.StationTypeSource, map[string]interface{}{
			"workCount": float64(3), "departureTime": float64(3.0),
		}),
		*domain.NewStation("src-2", domain.StationTypeSource, map[string]interface{}{
			"workCount": float64(3), "departureTime": float64(3.0),
		}),
		*innerModuler,
		*domain.NewStation("drain-1", domain.StationTypeDrain, map[string]interface{}{
			"arrivalTime": float64(0.1),
		}),
	}

	connections := []domain.Connection{
		{From: "src-1", To: "inner-mod", Condition: "default", FromPortIndex: -1, ToPortIndex: 0},
		{From: "src-2", To: "inner-mod", Condition: "default", FromPortIndex: -1, ToPortIndex: 1},
		{From: "inner-mod", To: "drain-1", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
	}

	scenario := domain.NewScenario("test-switch-inside-moduler", "SwitchInsideModuler", stations, connections)
	engine := NewEngineWithInitialConditions(scenario, nil, nil)
	_, _, workEvents, _, err := engine.Run("sim-switch-inside-mod", "SwitchInsideModuler", 200.0)
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
		fmt.Printf("=== Work Events ===\n")
		for _, ev := range workEvents {
			fmt.Printf("  t=%.3f station=%s event=%s work=%s\n", ev.Timestamp, ev.StationID, ev.EventType, ev.WorkID)
		}
		t.Errorf("Expected 6 works at drain-1, got %d (deadlock?)", drainArrivals)
	}
}
