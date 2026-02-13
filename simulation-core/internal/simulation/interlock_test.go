package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"testing"
)

func newTestStation(id string, stationType domain.StationType) *domain.Station {
	station := domain.NewStation(id, stationType, map[string]interface{}{})
	station.InterlockRules = domain.GetDefaultInterlockConfig(stationType)
	station.InitializeSignals()
	return station
}

func newTestScenario(stations ...*domain.Station) *domain.Scenario {
	var stationSlice []domain.Station
	for _, s := range stations {
		stationSlice = append(stationSlice, *s)
	}
	return &domain.Scenario{
		ID:       "test-scenario",
		Name:     "Test",
		Stations: stationSlice,
	}
}

func TestEvaluateRules_ProcessingInitial(t *testing.T) {
	// Initial state: WP=OFF, PC=OFF → R1 should fire → IR=ON
	station := newTestStation("proc-1", domain.StationTypeProcessing)
	scenario := newTestScenario(station)

	changes, err := evaluateRules(station, scenario, 0.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !station.GetSignal("inputReady") {
		t.Error("expected inputReady=ON after initial evaluation")
	}
	if station.GetSignal("outputReady") {
		t.Error("expected outputReady=OFF after initial evaluation")
	}
	if len(changes) == 0 {
		t.Error("expected at least one signal change")
	}

	// Verify the change log
	found := false
	for _, c := range changes {
		if c.SignalName == "inputReady" && c.NewValue == true {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected inputReady change in log")
	}
}

func TestEvaluateRules_ProcessingWorkArrived(t *testing.T) {
	// Simulate: work arrived → WP=ON, PC=OFF
	station := newTestStation("proc-1", domain.StationTypeProcessing)
	scenario := newTestScenario(station)

	// Initial evaluation
	evaluateRules(station, scenario, 0.0)

	// Work arrives: set WP=ON
	station.SetSignal("workPresent", true)

	changes, err := evaluateRules(station, scenario, 1.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if station.GetSignal("inputReady") {
		t.Error("expected inputReady=OFF after work arrived")
	}
	if station.GetSignal("outputReady") {
		t.Error("expected outputReady=OFF (not yet processed)")
	}

	// Check that inputReady changed from ON to OFF
	found := false
	for _, c := range changes {
		if c.SignalName == "inputReady" && c.OldValue == true && c.NewValue == false {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected inputReady ON→OFF change in log")
	}
}

func TestEvaluateRules_ProcessingComplete(t *testing.T) {
	// Simulate: processing complete → WP=ON, PC=ON
	station := newTestStation("proc-1", domain.StationTypeProcessing)
	scenario := newTestScenario(station)

	station.SetSignal("workPresent", true)
	station.SetSignal("processingComplete", true)

	changes, err := evaluateRules(station, scenario, 2.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if station.GetSignal("inputReady") {
		t.Error("expected inputReady=OFF")
	}
	if !station.GetSignal("outputReady") {
		t.Error("expected outputReady=ON after processing complete")
	}

	found := false
	for _, c := range changes {
		if c.SignalName == "outputReady" && c.NewValue == true {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected outputReady ON change in log")
	}
}

func TestEvaluateRules_ProcessingWorkDeparted(t *testing.T) {
	// Simulate full cycle: work departs → WP=OFF, PC=ON
	// Should trigger: OR=OFF (R4) → PC=OFF (R5) → IR=ON (R1) (cascading)
	station := newTestStation("proc-1", domain.StationTypeProcessing)
	scenario := newTestScenario(station)

	// Start from completed state
	station.SetSignal("workPresent", true)
	station.SetSignal("processingComplete", true)
	station.SetSignal("outputReady", true)

	// Work departs: WP=OFF
	station.SetSignal("workPresent", false)

	changes, err := evaluateRules(station, scenario, 3.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// After cascading: IR=ON, OR=OFF, PC=OFF, WP=OFF
	if !station.GetSignal("inputReady") {
		t.Error("expected inputReady=ON after cascade")
	}
	if station.GetSignal("outputReady") {
		t.Error("expected outputReady=OFF after cascade")
	}
	if station.GetSignal("processingComplete") {
		t.Error("expected processingComplete=OFF after cascade (R5)")
	}

	// Should have at least 3 changes: OR→OFF, PC→OFF, IR→ON
	if len(changes) < 3 {
		t.Errorf("expected at least 3 signal changes in cascade, got %d", len(changes))
	}
}

func TestEvaluateRules_DrainInitial(t *testing.T) {
	station := newTestStation("drain-1", domain.StationTypeDrain)
	scenario := newTestScenario(station)

	_, err := evaluateRules(station, scenario, 0.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !station.GetSignal("inputReady") {
		t.Error("expected inputReady=ON for empty drain")
	}
}

func TestEvaluateRules_SourceInitial(t *testing.T) {
	station := newTestStation("source-1", domain.StationTypeSource)
	scenario := newTestScenario(station)

	_, err := evaluateRules(station, scenario, 0.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if station.GetSignal("outputReady") {
		t.Error("expected outputReady=OFF for empty source")
	}
}

func TestEvaluateRules_CrossStationReference(t *testing.T) {
	// Test cross-station signal reference:
	// proc-1's R3 checks proc-2's inputReady
	proc1 := newTestStation("proc-1", domain.StationTypeProcessing)
	proc2 := newTestStation("proc-2", domain.StationTypeProcessing)
	scenario := newTestScenario(proc1, proc2)

	// Initialize both
	evaluateRules(&scenario.Stations[0], scenario, 0.0)
	evaluateRules(&scenario.Stations[1], scenario, 0.0)

	// Override proc-1's R3 to check proc-2's inputReady
	proc1Station := &scenario.Stations[0]
	proc1Station.InterlockRules.Rules[2] = domain.InterlockRule{
		ID:          "R3",
		Description: "処理完了かつ後工程受入可 → 搬出可ON",
		Target:      "outputReady",
		Value:       true,
		Conditions: []domain.RuleCondition{
			{Signal: "processingComplete", Value: true},
			{Signal: "workPresent", Value: true},
			{Signal: "inputReady", Value: true, StationID: "proc-2"},
		},
	}

	// Set proc-1 to completed state
	proc1Station.SetSignal("workPresent", true)
	proc1Station.SetSignal("processingComplete", true)

	// proc-2 is idle → inputReady=ON → R3 should fire
	changes, err := evaluateRules(proc1Station, scenario, 1.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !proc1Station.GetSignal("outputReady") {
		t.Error("expected outputReady=ON (proc-2.inputReady is ON)")
	}

	// Now set proc-2 to busy (inputReady=OFF)
	proc2Station := &scenario.Stations[1]
	proc2Station.SetSignal("inputReady", false)

	// Reset proc-1's outputReady
	proc1Station.SetSignal("outputReady", false)

	changes, err = evaluateRules(proc1Station, scenario, 2.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if proc1Station.GetSignal("outputReady") {
		t.Error("expected outputReady=OFF (proc-2.inputReady is OFF)")
	}

	_ = changes
}

func TestEvaluateRules_MaxIterationsError(t *testing.T) {
	// Create a rule that oscillates (should hit MAX_ITERATIONS)
	station := domain.NewStation("test-1", domain.StationTypeProcessing, map[string]interface{}{})
	station.InterlockRules = &domain.InterlockConfig{
		Signals: []domain.SignalDef{
			{Name: "a", Initial: false},
			{Name: "b", Initial: false},
		},
		Rules: []domain.InterlockRule{
			{ID: "R1", Target: "a", Value: true, Conditions: []domain.RuleCondition{{Signal: "b", Value: false}}},
			{ID: "R2", Target: "b", Value: true, Conditions: []domain.RuleCondition{{Signal: "a", Value: true}}},
			{ID: "R3", Target: "a", Value: false, Conditions: []domain.RuleCondition{{Signal: "b", Value: true}}},
			{ID: "R4", Target: "b", Value: false, Conditions: []domain.RuleCondition{{Signal: "a", Value: false}}},
		},
	}
	station.InitializeSignals()
	scenario := newTestScenario(station)

	_, err := evaluateRules(&scenario.Stations[0], scenario, 0.0)
	if err == nil {
		t.Error("expected error for non-converging rules")
	}
}

func TestEvaluateRules_EmptyConditions(t *testing.T) {
	// Rule with empty conditions should not fire
	station := domain.NewStation("test-1", domain.StationTypeProcessing, map[string]interface{}{})
	station.InterlockRules = &domain.InterlockConfig{
		Signals: []domain.SignalDef{
			{Name: "inputReady", Initial: false},
		},
		Rules: []domain.InterlockRule{
			{ID: "R1", Target: "inputReady", Value: true, Conditions: nil},
		},
	}
	station.InitializeSignals()
	scenario := newTestScenario(station)

	_, err := evaluateRules(&scenario.Stations[0], scenario, 0.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if station.GetSignal("inputReady") {
		t.Error("expected inputReady=OFF (empty conditions should not fire)")
	}
}

func TestAllConditionsMet_NonexistentStation(t *testing.T) {
	station := newTestStation("proc-1", domain.StationTypeProcessing)
	scenario := newTestScenario(station)

	conditions := []domain.RuleCondition{
		{Signal: "inputReady", Value: true, StationID: "nonexistent"},
	}

	result := allConditionsMet(conditions, &scenario.Stations[0], scenario)
	if result {
		t.Error("expected false for nonexistent station reference")
	}
}
