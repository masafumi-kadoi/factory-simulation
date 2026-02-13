package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"testing"
)

func buildSimpleScenario() *domain.Scenario {
	// Source → Processing → Drain
	stations := []domain.Station{
		*domain.NewStation("source-1", domain.StationTypeSource, map[string]interface{}{
			"workCount":     float64(3),
			"departureTime": float64(5.0),
		}),
		*domain.NewStation("processing-1", domain.StationTypeProcessing, map[string]interface{}{
			"processingTime": float64(2.0),
			"arrivalTime":    float64(1.0),
			"departureTime":  float64(1.0),
		}),
		*domain.NewStation("drain-1", domain.StationTypeDrain, map[string]interface{}{
			"arrivalTime": float64(1.0),
		}),
	}

	connections := []domain.Connection{
		{From: "source-1", To: "processing-1", Condition: domain.RoutingDefault},
		{From: "processing-1", To: "drain-1", Condition: domain.RoutingDefault},
	}

	return domain.NewScenario("test-scenario", "Test", stations, connections)
}

func TestEngine_SignalBasedSimulation(t *testing.T) {
	scenario := buildSimpleScenario()
	engine := NewEngine(scenario)

	sim, statusLogs, workEvents, _, err := engine.Run("test-sim-1", "Test Run", 100.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	if sim.Status != domain.SimulationStatusCompleted {
		t.Errorf("expected completed status, got %s", sim.Status)
	}

	// Should have 3 WorkCreated events
	createdCount := 0
	destroyedCount := 0
	for _, we := range workEvents {
		switch we.EventType {
		case string(EventWorkCreated):
			createdCount++
		case string(EventWorkDestroyed):
			destroyedCount++
		}
	}
	if createdCount != 3 {
		t.Errorf("expected 3 WorkCreated events, got %d", createdCount)
	}
	if destroyedCount != 3 {
		t.Errorf("expected 3 WorkDestroyed events, got %d", destroyedCount)
	}

	// Check for signal_change logs
	signalChanges := 0
	for _, sl := range statusLogs {
		if sl.StatusType == "signal_change" {
			signalChanges++
		}
	}
	if signalChanges == 0 {
		t.Error("expected signal_change logs but found none")
	}
	t.Logf("Total signal changes: %d", signalChanges)
}

func TestEngine_BackwardCompatibility_SourceDrain(t *testing.T) {
	// Source → Drain (simplest scenario)
	stations := []domain.Station{
		*domain.NewStation("source-1", domain.StationTypeSource, map[string]interface{}{
			"workCount":     float64(3),
			"departureTime": float64(1.0),
		}),
		*domain.NewStation("drain-1", domain.StationTypeDrain, map[string]interface{}{
			"arrivalTime": float64(1.0),
		}),
	}
	connections := []domain.Connection{
		{From: "source-1", To: "drain-1", Condition: domain.RoutingDefault},
	}
	scenario := domain.NewScenario("test-basic", "Basic Test", stations, connections)

	engine := NewEngine(scenario)
	sim, _, workEvents, _, err := engine.Run("test-basic-1", "Basic Run", 100.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	if sim.Status != domain.SimulationStatusCompleted {
		t.Errorf("expected completed, got %s", sim.Status)
	}

	createdCount := 0
	destroyedCount := 0
	for _, we := range workEvents {
		switch we.EventType {
		case string(EventWorkCreated):
			createdCount++
		case string(EventWorkDestroyed):
			destroyedCount++
		}
	}
	if createdCount != 3 {
		t.Errorf("expected 3 created, got %d", createdCount)
	}
	if destroyedCount != 3 {
		t.Errorf("expected 3 destroyed, got %d", destroyedCount)
	}
}

func TestEngine_ContinuousMode(t *testing.T) {
	// Source(continuous) → Drain
	stations := []domain.Station{
		*domain.NewStation("source-1", domain.StationTypeSource, map[string]interface{}{
			"continuous":    true,
			"departureTime": float64(1.0),
		}),
		*domain.NewStation("drain-1", domain.StationTypeDrain, map[string]interface{}{
			"arrivalTime": float64(1.0),
		}),
	}
	connections := []domain.Connection{
		{From: "source-1", To: "drain-1", Condition: domain.RoutingDefault},
	}
	scenario := domain.NewScenario("test-continuous", "Continuous Test", stations, connections)

	engine := NewEngine(scenario)
	sim, _, workEvents, _, err := engine.Run("test-continuous-1", "Continuous Run", 10.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	if *sim.EndReason != domain.EndReasonTimeLimit {
		t.Errorf("expected time_limit end reason, got %s", *sim.EndReason)
	}

	createdCount := 0
	for _, we := range workEvents {
		if we.EventType == string(EventWorkCreated) {
			createdCount++
		}
	}
	if createdCount < 5 {
		t.Errorf("expected at least 5 works in 10s with 1s departure, got %d", createdCount)
	}
	t.Logf("Created %d works in continuous mode", createdCount)
}

func TestEngine_InitialSignals(t *testing.T) {
	scenario := buildSimpleScenario()
	engine := NewEngine(scenario)

	// Just init the engine to check signals
	for i := range engine.scenario.Stations {
		station := &engine.scenario.Stations[i]
		if station.InterlockRules == nil {
			station.InterlockRules = domain.GetDefaultInterlockConfig(station.Type)
		}
		station.InitializeSignals()
	}
	for i := range engine.scenario.Stations {
		station := &engine.scenario.Stations[i]
		evaluateRules(station, engine.scenario, 0.0)
	}

	// Check processing-1: should have inputReady=ON
	proc := engine.scenario.GetStation("processing-1")
	if proc == nil {
		t.Fatal("processing-1 not found")
	}
	if !proc.GetSignal("inputReady") {
		t.Error("processing-1 should have inputReady=ON after initial evaluation")
	}
	if proc.GetSignal("outputReady") {
		t.Error("processing-1 should have outputReady=OFF after initial evaluation")
	}

	// Check drain-1: should have inputReady=ON
	drain := engine.scenario.GetStation("drain-1")
	if drain == nil {
		t.Fatal("drain-1 not found")
	}
	if !drain.GetSignal("inputReady") {
		t.Error("drain-1 should have inputReady=ON after initial evaluation")
	}
}
