package simulation

import (
	"fmt"
	"testing"

	"factory-simulation/simulation-core/internal/domain"
)

// makeProcStationFull creates a processing station matching production config
func makeProcStationFull(id string) domain.Station {
	return *domain.NewStation(id, domain.StationTypeProcessing, map[string]interface{}{
		"processingTime": float64(2), "arrivalTime": float64(1), "departureTime": float64(1),
		"noWorkTimeout": float64(-1), "stayTime": float64(-1),
	})
}

// TestSwitchProduction_ExactScenario exactly replicates the production scenario (fd23d979)
// with the exact station IDs, config values, and structure loaded from the API.
//
// Topology (outer level):
//
//	source-1778493773159 (wc=3, dep=5) → moduler-1778493782564 → moduler-1778493784544 (port 0)
//	source-1778493779378 (wc=3, dep=5) → moduler-1778493783351 → moduler-1778493784544 (port 1)
//	moduler-1778493784544 → drain-1778493775993
//
// moduler-1778493782564 sub: entry-0 → proc-856080 → exit-0
// moduler-1778493783351 sub: entry-0 → proc-906533 → proc-907297 → exit-0
// moduler-1778493784544 sub (2-entry, 1-exit):
//
//	entry-0 → proc-959858 → proc-960570 → sw-967306 (merge, portCount=2, round-robin)
//	entry-1 → proc-962065 → sw-967306
//	sw-967306 → proc-963251 → proc-963885 → exit-0
func TestSwitchProduction_ExactScenario(t *testing.T) {
	// moduler-1778493782564: single processing chain
	mod1 := domain.NewStation("moduler-1778493782564", domain.StationTypeModuler, map[string]interface{}{
		"entryCount": float64(1), "exitCount": float64(1),
	})
	mod1.EntryCount = 1
	mod1.ExitCount = 1
	mod1.SubScenario = &domain.SubScenario{
		Stations: []domain.Station{
			*domain.NewStation("entry-0", domain.StationTypeEntry, map[string]interface{}{}),
			*domain.NewStation("exit-0", domain.StationTypeExit, map[string]interface{}{}),
			makeProcStationFull("processing-1778493856080"),
		},
		Connections: []domain.Connection{
			{From: "entry-0", To: "processing-1778493856080", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "processing-1778493856080", To: "exit-0", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		},
	}

	// moduler-1778493783351: two processing stations in chain
	mod2 := domain.NewStation("moduler-1778493783351", domain.StationTypeModuler, map[string]interface{}{
		"entryCount": float64(1), "exitCount": float64(1),
	})
	mod2.EntryCount = 1
	mod2.ExitCount = 1
	mod2.SubScenario = &domain.SubScenario{
		Stations: []domain.Station{
			*domain.NewStation("entry-0", domain.StationTypeEntry, map[string]interface{}{}),
			*domain.NewStation("exit-0", domain.StationTypeExit, map[string]interface{}{}),
			makeProcStationFull("processing-1778493906533"),
			makeProcStationFull("processing-1778493907297"),
		},
		Connections: []domain.Connection{
			{From: "entry-0", To: "processing-1778493906533", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "processing-1778493906533", To: "processing-1778493907297", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "processing-1778493907297", To: "exit-0", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		},
	}

	// moduler-1778493784544: complex inner moduler with switch-merge
	// SubScenario station ORDER matches production (exit-0 before entry-1)
	innerMod := domain.NewStation("moduler-1778493784544", domain.StationTypeModuler, map[string]interface{}{
		"entryCount": float64(2), "exitCount": float64(1),
	})
	innerMod.EntryCount = 2
	innerMod.ExitCount = 1
	innerMod.SubScenario = &domain.SubScenario{
		Stations: []domain.Station{
			*domain.NewStation("entry-0", domain.StationTypeEntry, map[string]interface{}{}),
			*domain.NewStation("exit-0", domain.StationTypeExit, map[string]interface{}{}),
			*domain.NewStation("entry-1", domain.StationTypeEntry, map[string]interface{}{}),
			makeProcStationFull("processing-1778493959858"),
			makeProcStationFull("processing-1778493960570"),
			makeProcStationFull("processing-1778493962065"),
			makeProcStationFull("processing-1778493963251"),
			makeProcStationFull("processing-1778493963885"),
			*domain.NewStation("switch-1778493967306", domain.StationTypeSwitch, map[string]interface{}{
				"direction": "merge", "portCount": float64(2), "selectMode": "round-robin",
				"arrivalTime": float64(0.1), "departureTime": float64(0.1),
				"noWorkTimeout": float64(-1), "stayTime": float64(-1),
			}),
		},
		Connections: []domain.Connection{
			{From: "entry-0", To: "processing-1778493959858", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "processing-1778493959858", To: "processing-1778493960570", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "entry-1", To: "processing-1778493962065", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "processing-1778493962065", To: "switch-1778493967306", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "processing-1778493960570", To: "switch-1778493967306", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "switch-1778493967306", To: "processing-1778493963251", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "processing-1778493963251", To: "processing-1778493963885", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
			{From: "processing-1778493963885", To: "exit-0", Condition: "default", FromPortIndex: -1, ToPortIndex: -1},
		},
	}

	stations := []domain.Station{
		*domain.NewStation("source-1778493773159", domain.StationTypeSource, map[string]interface{}{
			"workCount": float64(3), "departureTime": float64(5),
			"noWorkTimeout": float64(-1), "stayTime": float64(-1),
		}),
		*domain.NewStation("drain-1778493775993", domain.StationTypeDrain, map[string]interface{}{
			"arrivalTime": float64(1),
			"noWorkTimeout": float64(-1), "stayTime": float64(-1),
		}),
		*domain.NewStation("source-1778493779378", domain.StationTypeSource, map[string]interface{}{
			"workCount": float64(3), "departureTime": float64(5),
			"noWorkTimeout": float64(-1), "stayTime": float64(-1),
		}),
		*mod1, *mod2, *innerMod,
	}

	connections := []domain.Connection{
		{From: "source-1778493773159", To: "moduler-1778493782564", Condition: "default", FromPortIndex: -1, ToPortIndex: 0},
		{From: "source-1778493779378", To: "moduler-1778493783351", Condition: "default", FromPortIndex: -1, ToPortIndex: 0},
		{From: "moduler-1778493783351", To: "moduler-1778493784544", Condition: "default", FromPortIndex: 0, ToPortIndex: 1},
		{From: "moduler-1778493782564", To: "moduler-1778493784544", Condition: "default", FromPortIndex: 0, ToPortIndex: 0},
		{From: "moduler-1778493784544", To: "drain-1778493775993", Condition: "default", FromPortIndex: 0, ToPortIndex: -1},
	}

	scenario := domain.NewScenario("fd23d979", "新規シナリオ", stations, connections)
	engine := NewEngineWithInitialConditions(scenario, nil, nil)
	_, _, workEvents, _, err := engine.Run("sim-prod", "ProductionScenario", 300.0)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	drainArrivals := 0
	for _, ev := range workEvents {
		if ev.StationID == "drain-1778493775993" && ev.EventType == "WorkArrived" {
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
			fmt.Printf("  t=%.3f station=%s event=%s work=%s port=%d\n", ev.Timestamp, ev.StationID, ev.EventType, ev.WorkID, ev.PortIndex)
		}
		t.Errorf("Expected 6 works at drain, got %d (deadlock?)", drainArrivals)
	}
}
