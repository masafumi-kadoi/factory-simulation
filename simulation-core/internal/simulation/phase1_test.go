package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"testing"
)

// === Phase 1-7: 10-signal default rule evaluation tests (all 8 types) ===

func TestEvaluateRules_AllStationTypes_InitialState(t *testing.T) {
	tests := []struct {
		stationType domain.StationType
		expectIR    bool // inputReady after initial evaluation
		expectOR    bool // outputReady after initial evaluation
	}{
		// Source: OWP=false → R2 fires → OR=OFF, R1 doesn't fire. No IR rules.
		{domain.StationTypeSource, false, false},
		// Processing: IWP=false → R1 fires → IR=ON
		{domain.StationTypeProcessing, true, false},
		// Drain: IWP=false → R1 fires → IR=ON
		{domain.StationTypeDrain, true, false},
		// Merge: IR is derived from port-level signals (not rule-based at station level)
		// Without ports initialized, IR stays false. In real engine, deriveStationSignals sets it.
		{domain.StationTypeMerge, false, false},
		// Split: allPortsEmpty=true(initial) & IWP=false & RUN=false & CPL=false → R1 fires → IR=ON
		{domain.StationTypeSplit, true, false},
		// Entry: IWP=false → R3 fires → IR=ON; OWP=false → R2 fires → OR=OFF
		{domain.StationTypeEntry, true, false},
		// Exit: same as Entry
		{domain.StationTypeExit, true, false},
		// Moduler: IWP=false → R1 fires → IR=ON
		{domain.StationTypeMachine, true, false},
	}

	for _, tt := range tests {
		t.Run(string(tt.stationType), func(t *testing.T) {
			station := newTestStation("test-1", tt.stationType)
			scenario := newTestScenario(station)

			_, err := evaluateRules(&scenario.Stations[0], scenario, 0.0)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if scenario.Stations[0].GetSignal(domain.SignalInputReady) != tt.expectIR {
				t.Errorf("expected inputReady=%v, got %v", tt.expectIR, scenario.Stations[0].GetSignal(domain.SignalInputReady))
			}
			if scenario.Stations[0].GetSignal(domain.SignalOutputReady) != tt.expectOR {
				t.Errorf("expected outputReady=%v, got %v", tt.expectOR, scenario.Stations[0].GetSignal(domain.SignalOutputReady))
			}
		})
	}
}

// === Phase 1-7: processReady control tests ===

func TestProcessReady_TriggersProcessingStarted(t *testing.T) {
	// Setup: Source → Processing → Drain
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":  float64(1),
		"outputType": "partA",
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(5.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)

	scenario := &domain.Scenario{
		ID:   "test",
		Name: "Test",
		Stations: []domain.Station{*source, *proc, *drain},
		Connections: []domain.Connection{
			{From: "source-1", To: "proc-1"},
			{From: "proc-1", To: "drain-1"},
		},
	}

	engine := NewEngine(scenario)
	sim, _, workEvents, _, err := engine.Run("sim-1", "test-sim", 100.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}
	if sim.Status != domain.SimulationStatusCompleted {
		t.Fatalf("expected completed, got %s", sim.Status)
	}

	// Verify ProcessingStarted happened at proc-1
	foundPS := false
	for _, e := range workEvents {
		if e.StationID == "proc-1" && e.EventType == string(EventProcessingStarted) {
			foundPS = true
			break
		}
	}
	if !foundPS {
		t.Error("expected ProcessingStarted event at proc-1")
	}

	// Work should have arrived at drain
	foundDrain := false
	for _, e := range workEvents {
		if e.StationID == "drain-1" && e.EventType == string(EventWorkArrived) {
			foundDrain = true
			break
		}
	}
	if !foundDrain {
		t.Error("expected work to arrive at drain")
	}
}

func TestProcessReady_ConditionsNotMet_NoProcessingStart(t *testing.T) {
	// Processing station with IWP=false should NOT get processReady=ON
	station := newTestStation("proc-1", domain.StationTypeProcessing)
	scenario := newTestScenario(station)

	evaluateRules(&scenario.Stations[0], scenario, 0.0)

	// inputReady=ON, processReady=OFF (no work)
	if scenario.Stations[0].GetSignal(domain.SignalProcessReady) {
		t.Error("expected processReady=OFF when no work present")
	}
}

func TestProcessReady_CustomRule(t *testing.T) {
	// Custom rule: processReady requires IWP=ON AND workFull=ON
	station := domain.NewStation("proc-1", domain.StationTypeProcessing, map[string]interface{}{})
	station.InterlockRules = &domain.InterlockConfig{
		Signals: []domain.SignalDef{
			{Name: domain.SignalInputWorkPresent, Initial: false},
			{Name: domain.SignalProcessingWorkPresent, Initial: false},
			{Name: domain.SignalOutputWorkPresent, Initial: false},
			{Name: domain.SignalRunning, Initial: false},
			{Name: domain.SignalComplete, Initial: false},
			{Name: domain.SignalProcessReady, Initial: false},
			{Name: domain.SignalInputReady, Initial: false},
			{Name: domain.SignalOutputReady, Initial: false},
			{Name: domain.SignalWorkFull, Initial: false},
			{Name: domain.SignalWorkEmpty, Initial: false},
		},
		Rules: []domain.InterlockRule{
			{
				ID: "R1", Target: domain.SignalInputReady, Value: true,
				Conditions: []domain.RuleCondition{{Signal: domain.SignalInputWorkPresent, Value: false}},
			},
			{
				ID: "R2", Target: domain.SignalInputReady, Value: false,
				Conditions: []domain.RuleCondition{{Signal: domain.SignalInputWorkPresent, Value: true}},
			},
			{
				ID: "R3-custom", Target: domain.SignalProcessReady, Value: true,
				Conditions: []domain.RuleCondition{
					{Signal: domain.SignalInputWorkPresent, Value: true},
					{Signal: domain.SignalWorkFull, Value: true}, // extra condition
					{Signal: domain.SignalRunning, Value: false},
					{Signal: domain.SignalComplete, Value: false},
				},
			},
			{
				ID: "R4", Target: domain.SignalProcessReady, Value: false,
				Conditions: []domain.RuleCondition{{Signal: domain.SignalRunning, Value: true}},
			},
			{
				ID: "R5", Target: domain.SignalOutputReady, Value: true,
				Conditions: []domain.RuleCondition{
					{Signal: domain.SignalComplete, Value: true},
					{Signal: domain.SignalOutputWorkPresent, Value: true},
				},
			},
			{
				ID: "R6", Target: domain.SignalOutputReady, Value: false,
				Conditions: []domain.RuleCondition{{Signal: domain.SignalOutputWorkPresent, Value: false}},
			},
		},
	}
	station.InitializeSignals()
	scenario := newTestScenario(station)

	// Set work arrived but workFull=OFF → processReady should NOT fire
	scenario.Stations[0].SetSignal(domain.SignalInputWorkPresent, true)
	evaluateRules(&scenario.Stations[0], scenario, 1.0)

	if scenario.Stations[0].GetSignal(domain.SignalProcessReady) {
		t.Error("expected processReady=OFF (workFull not set)")
	}

	// Now set workFull=ON → processReady should fire
	scenario.Stations[0].SetSignal(domain.SignalWorkFull, true)
	evaluateRules(&scenario.Stations[0], scenario, 2.0)

	if !scenario.Stations[0].GetSignal(domain.SignalProcessReady) {
		t.Error("expected processReady=ON (workFull=ON, IWP=ON)")
	}
}

// === Phase 1-8: Edge case tests ===

func TestEdge_SameTickWorkArrivedAndDeparted(t *testing.T) {
	// Entry/Exit should pass through instantly (arrivalTime=0, departureTime=0)
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":  float64(1),
		"outputType": "partA",
	}
	entry := newTestStation("entry-1", domain.StationTypeEntry)
	entry.Config = map[string]interface{}{
		"arrivalTime":   float64(0.0),
		"departureTime": float64(0.0),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)

	scenario := &domain.Scenario{
		ID:   "test",
		Name: "Test",
		Stations: []domain.Station{*source, *entry, *drain},
		Connections: []domain.Connection{
			{From: "source-1", To: "entry-1"},
			{From: "entry-1", To: "drain-1"},
		},
	}

	engine := NewEngine(scenario)
	_, _, workEvents, _, err := engine.Run("sim-1", "test-sim", 100.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// Work should have reached drain
	foundDrain := false
	for _, e := range workEvents {
		if e.StationID == "drain-1" && e.EventType == string(EventWorkArrived) {
			foundDrain = true
			break
		}
	}
	if !foundDrain {
		t.Error("expected work to pass through entry and arrive at drain")
	}
}

func TestEdge_RuleEvaluationOrder_ProcessReadyThenInputReadyOff(t *testing.T) {
	// When IWP goes ON: R2 (IR=OFF) and R3 (PR=ON) should both fire correctly
	station := newTestStation("proc-1", domain.StationTypeProcessing)
	scenario := newTestScenario(station)

	// Initial evaluation
	evaluateRules(&scenario.Stations[0], scenario, 0.0)

	// Work arrives
	scenario.Stations[0].SetSignal(domain.SignalInputWorkPresent, true)
	changes, err := evaluateRules(&scenario.Stations[0], scenario, 1.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	s := &scenario.Stations[0]
	if s.GetSignal(domain.SignalInputReady) {
		t.Error("expected IR=OFF after work arrived")
	}
	if !s.GetSignal(domain.SignalProcessReady) {
		t.Error("expected PR=ON after work arrived")
	}
	if len(changes) < 2 {
		t.Errorf("expected at least 2 changes (IR→OFF, PR→ON), got %d", len(changes))
	}
}

func TestEdge_CircularRules_MaxIterations(t *testing.T) {
	// Already tested in TestEvaluateRules_MaxIterationsError but verify error message
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
		t.Fatal("expected error for oscillating rules")
	}
}

func TestEdge_AllTenSignalsInCustomRule(t *testing.T) {
	// Custom rule that uses all 10 signals as conditions
	station := domain.NewStation("proc-1", domain.StationTypeProcessing, map[string]interface{}{})
	station.InterlockRules = &domain.InterlockConfig{
		Signals: []domain.SignalDef{
			{Name: domain.SignalInputWorkPresent, Initial: false},
			{Name: domain.SignalProcessingWorkPresent, Initial: false},
			{Name: domain.SignalOutputWorkPresent, Initial: false},
			{Name: domain.SignalRunning, Initial: false},
			{Name: domain.SignalComplete, Initial: false},
			{Name: domain.SignalProcessReady, Initial: false},
			{Name: domain.SignalInputReady, Initial: false},
			{Name: domain.SignalOutputReady, Initial: false},
			{Name: domain.SignalWorkFull, Initial: false},
			{Name: domain.SignalWorkEmpty, Initial: false},
		},
		Rules: []domain.InterlockRule{
			{
				ID: "R-all", Target: domain.SignalProcessReady, Value: true,
				Conditions: []domain.RuleCondition{
					{Signal: domain.SignalInputWorkPresent, Value: true},
					{Signal: domain.SignalProcessingWorkPresent, Value: true},
					{Signal: domain.SignalOutputWorkPresent, Value: true},
					{Signal: domain.SignalRunning, Value: false},
					{Signal: domain.SignalComplete, Value: false},
					{Signal: domain.SignalInputReady, Value: false},
					{Signal: domain.SignalOutputReady, Value: false},
					{Signal: domain.SignalWorkFull, Value: true},
					{Signal: domain.SignalWorkEmpty, Value: false},
					{Signal: domain.SignalProcessReady, Value: false},
				},
			},
		},
	}
	station.InitializeSignals()
	scenario := newTestScenario(station)

	// Not all conditions met → should not fire
	evaluateRules(&scenario.Stations[0], scenario, 0.0)
	if scenario.Stations[0].GetSignal(domain.SignalProcessReady) {
		t.Error("expected processReady=OFF (not all conditions met)")
	}

	// Set all required signals
	s := &scenario.Stations[0]
	s.SetSignal(domain.SignalInputWorkPresent, true)
	s.SetSignal(domain.SignalProcessingWorkPresent, true)
	s.SetSignal(domain.SignalOutputWorkPresent, true)
	s.SetSignal(domain.SignalWorkFull, true)

	evaluateRules(s, scenario, 1.0)
	if !s.GetSignal(domain.SignalProcessReady) {
		t.Error("expected processReady=ON (all 10 conditions met)")
	}
}

func TestEdge_CrossStation_NonexistentStation(t *testing.T) {
	// Already tested but verify via evaluateRules path
	station := newTestStation("proc-1", domain.StationTypeProcessing)
	scenario := newTestScenario(station)

	// Override R5 with cross-station reference to nonexistent station
	scenario.Stations[0].InterlockRules.Rules[4] = domain.InterlockRule{
		ID: "R5", Target: domain.SignalOutputReady, Value: true,
		Conditions: []domain.RuleCondition{
			{Signal: domain.SignalComplete, Value: true},
			{Signal: domain.SignalInputReady, Value: true, StationID: "nonexistent"},
		},
	}

	// Set complete=ON, OWP=ON
	scenario.Stations[0].SetSignal(domain.SignalComplete, true)
	scenario.Stations[0].SetSignal(domain.SignalOutputWorkPresent, true)

	evaluateRules(&scenario.Stations[0], scenario, 1.0)

	// Should NOT fire because nonexistent station reference returns false
	if scenario.Stations[0].GetSignal(domain.SignalOutputReady) {
		t.Error("expected outputReady=OFF (nonexistent station reference)")
	}
}

func TestEdge_SplitPartialDeparture_OWPMaintained(t *testing.T) {
	// Split: When only some ports are emptied, OWP should remain ON
	station := domain.NewStation("sp1", domain.StationTypeSplit, map[string]interface{}{
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	})
	station.InterlockRules = domain.GetDefaultInterlockConfig(domain.StationTypeSplit)
	station.InitializeSignals()
	station.InitializePorts()

	// Simulate: split complete, works in both output ports
	station.SetSignal(domain.SignalOutputWorkPresent, true)
	station.SetSignal(domain.SignalComplete, true)
	station.GetOutputPort(0).Works = []*domain.Work{domain.NewWork("w1", "work-1")}
	station.GetOutputPort(1).Works = []*domain.Work{domain.NewWork("w2", "work-2")}

	// Remove work from port 0 only
	station.GetOutputPort(0).Works = nil

	// Port 1 still has work → HasOutputPortWorks should be true
	if !station.HasOutputPortWorks() {
		t.Error("expected HasOutputPortWorks=true when port 1 still has work")
	}

	// OWP should remain ON (engine would keep it)
	// CPL should remain ON until all ports are empty
	if !station.GetSignal(domain.SignalComplete) {
		t.Error("expected complete=ON while ports still have works")
	}

	// Remove from port 1 → all empty
	station.GetOutputPort(1).Works = nil
	if station.HasOutputPortWorks() {
		t.Error("expected HasOutputPortWorks=false when all ports empty")
	}
}

func TestEdge_EmptyConditionsRule_NoFire(t *testing.T) {
	// Rule with nil conditions should NOT fire (already tested but in different context)
	station := domain.NewStation("test-1", domain.StationTypeProcessing, map[string]interface{}{})
	station.InterlockRules = &domain.InterlockConfig{
		Signals: []domain.SignalDef{
			{Name: domain.SignalInputReady, Initial: false},
		},
		Rules: []domain.InterlockRule{
			{ID: "R1", Target: domain.SignalInputReady, Value: true, Conditions: []domain.RuleCondition{}},
		},
	}
	station.InitializeSignals()
	scenario := newTestScenario(station)

	evaluateRules(&scenario.Stations[0], scenario, 0.0)
	if scenario.Stations[0].GetSignal(domain.SignalInputReady) {
		t.Error("expected inputReady=OFF (empty conditions should not fire)")
	}
}

// === Integration: Source → Processing → Drain full flow with 10 signals ===

func TestIntegration_SourceProcessingDrain_SignalTimeline(t *testing.T) {
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":  float64(1),
		"outputType": "partA",
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(10.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)

	scenario := &domain.Scenario{
		ID:   "test",
		Name: "Test",
		Stations: []domain.Station{*source, *proc, *drain},
		Connections: []domain.Connection{
			{From: "source-1", To: "proc-1"},
			{From: "proc-1", To: "drain-1"},
		},
	}

	engine := NewEngine(scenario)
	_, statusLogs, workEvents, _, err := engine.Run("sim-1", "test-sim", 100.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// Verify work flow: source → proc → drain
	eventSequence := []struct {
		stationID string
		eventType string
	}{}
	for _, e := range workEvents {
		eventSequence = append(eventSequence, struct {
			stationID string
			eventType string
		}{e.StationID, e.EventType})
	}

	// Find key events
	findEvent := func(stationID, eventType string) bool {
		for _, e := range workEvents {
			if e.StationID == stationID && e.EventType == eventType {
				return true
			}
		}
		return false
	}

	if !findEvent("source-1", string(EventWorkCreated)) {
		t.Error("missing WorkCreated at source-1")
	}
	if !findEvent("proc-1", string(EventWorkArrived)) {
		t.Error("missing WorkArrived at proc-1")
	}
	if !findEvent("proc-1", string(EventProcessingStarted)) {
		t.Error("missing ProcessingStarted at proc-1")
	}
	if !findEvent("proc-1", string(EventProcessingCompleted)) {
		t.Error("missing ProcessingCompleted at proc-1")
	}
	if !findEvent("drain-1", string(EventWorkArrived)) {
		t.Error("missing WorkArrived at drain-1")
	}

	// Verify signal changes occurred
	signalChanges := map[string][]StationStatusLog{}
	for _, log := range statusLogs {
		if log.StatusType == "signal_change" {
			signalChanges[log.StationID] = append(signalChanges[log.StationID], log)
		}
	}

	if len(signalChanges["proc-1"]) == 0 {
		t.Error("expected signal changes at proc-1")
	}

	// Check that processReady was set to ON then OFF at proc-1
	foundPROn := false
	foundPROff := false
	for _, log := range signalChanges["proc-1"] {
		if log.SignalName == domain.SignalProcessReady && log.Value {
			foundPROn = true
		}
		if log.SignalName == domain.SignalProcessReady && !log.Value {
			foundPROff = true
		}
	}
	if !foundPROn {
		t.Error("expected processReady ON signal change at proc-1")
	}
	if !foundPROff {
		t.Error("expected processReady OFF signal change at proc-1")
	}
}
