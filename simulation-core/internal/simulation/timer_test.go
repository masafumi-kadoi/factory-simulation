package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"testing"
)

// === Phase 2-4: Timer basic tests ===

func TestWorkFull_StayTimeElapsed(t *testing.T) {
	// Source → Processing(stayTime=20, processingTime=5) → Drain
	// Work arrives, stayTime elapses without departure → workFull=ON
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
		"stayTime":       float64(20.0), // Longer than processing time
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
	_, statusLogs, _, _, err := engine.Run("sim-1", "test-sim", 100.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// Work departs at ~5s (processing complete → handshake → depart)
	// stayTime=20 → CheckWorkFull at ~20s. But work already departed, so workFull should NOT be ON
	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkFull && log.Value {
			t.Error("expected workFull to NOT fire (work departed before stayTime)")
		}
	}
}

func TestWorkFull_WorkStays(t *testing.T) {
	// Processing with stayTime=3 but NO downstream → work stays → workFull=ON
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":  float64(1),
		"outputType": "partA",
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(2.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"stayTime":       float64(3.0), // stayTime > processingTime, no downstream to depart
	}

	scenario := &domain.Scenario{
		ID:   "test",
		Name: "Test",
		Stations: []domain.Station{*source, *proc},
		Connections: []domain.Connection{
			{From: "source-1", To: "proc-1"},
		},
	}

	engine := NewEngine(scenario)
	_, statusLogs, _, _, err := engine.Run("sim-1", "test-sim", 10.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// Work arrives at proc-1 at ~0s, stayTime=3 → CheckWorkFull at ~3s
	// No downstream → work stays → workFull=ON
	foundWF := false
	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkFull && log.Value {
			foundWF = true
			break
		}
	}
	if !foundWF {
		t.Error("expected workFull=ON (work stays longer than stayTime, no downstream)")
	}
}

func TestWorkEmpty_NoWorkTimeout(t *testing.T) {
	// Processing with noWorkTimeout=2 and no work → workEmpty=ON
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(5.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"noWorkTimeout":  float64(2.0),
	}

	scenario := &domain.Scenario{
		ID:       "test",
		Name:     "Test",
		Stations: []domain.Station{*proc},
	}

	// No source → no work ever arrives
	// But noWorkTimeout only fires after WorkDeparted, not from initial state
	// So workEmpty should NOT fire here (no work departure event)
	engine := NewEngine(scenario)
	_, statusLogs, _, _, err := engine.Run("sim-1", "test-sim", 10.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkEmpty && log.Value {
			t.Error("expected workEmpty to NOT fire (no work departed event triggers it)")
		}
	}
}

func TestWorkEmpty_AfterDeparture(t *testing.T) {
	// Source(1 work) → Processing(noWorkTimeout=3) → Drain
	// After work departs from Processing, noWorkTimeout timer fires → workEmpty=ON
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":  float64(1),
		"outputType": "partA",
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(2.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"noWorkTimeout":  float64(3.0),
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
	_, statusLogs, _, _, err := engine.Run("sim-1", "test-sim", 20.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// Work departs at ~2s. noWorkTimeout=3 → CheckWorkEmpty at ~5s
	// No more work arrives → workEmpty=ON
	foundWE := false
	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkEmpty && log.Value {
			foundWE = true
			break
		}
	}
	if !foundWE {
		t.Error("expected workEmpty=ON after departure and timeout")
	}
}

func TestWorkEmpty_CancelledByArrival(t *testing.T) {
	// Source(2 works) → Processing(noWorkTimeout=5, processingTime=1) → Drain
	// Work 1 departs, schedules workEmpty timer at +5s.
	// Work 2 arrives before timeout → timer cancelled → workEmpty stays OFF
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":     float64(2),
		"outputType":    "partA",
		"departureTime": float64(0.0),
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"noWorkTimeout":  float64(5.0),
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
	_, statusLogs, _, _, err := engine.Run("sim-1", "test-sim", 4.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// Work 1: arrive ~0, depart ~1. workEmpty scheduled at 6.
	// Work 2: arrives shortly after → cancels workEmpty timer.
	// Within timeLimit=4, workEmpty should NOT fire.
	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkEmpty && log.Value {
			t.Error("expected workEmpty to NOT fire (cancelled by work 2 arrival)")
		}
	}
}

// === Timer cancel tests ===

func TestWorkFull_CancelledByDeparture(t *testing.T) {
	// Source(1) → Processing(stayTime=10, processingTime=2) → Drain
	// Work departs at ~2s, workFull timer at 10s should NOT fire
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":  float64(1),
		"outputType": "partA",
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(2.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"stayTime":       float64(10.0),
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
	_, statusLogs, _, _, err := engine.Run("sim-1", "test-sim", 20.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkFull && log.Value {
			t.Error("expected workFull to NOT fire (work departed before stayTime)")
		}
	}
}

// === Timer boundary tests ===

func TestWorkFull_StayTimeZero(t *testing.T) {
	// stayTime=0 → CheckWorkFull fires immediately
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":  float64(1),
		"outputType": "partA",
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(100.0), // Long processing → work stays
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"stayTime":       float64(0.0),
	}

	scenario := &domain.Scenario{
		ID:   "test",
		Name: "Test",
		Stations: []domain.Station{*source, *proc},
		Connections: []domain.Connection{
			{From: "source-1", To: "proc-1"},
		},
	}

	engine := NewEngine(scenario)
	_, statusLogs, _, _, err := engine.Run("sim-1", "test-sim", 5.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	foundWF := false
	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkFull && log.Value {
			foundWF = true
			break
		}
	}
	if !foundWF {
		t.Error("expected workFull=ON with stayTime=0 (immediate)")
	}
}

func TestWorkEmpty_NoWorkTimeoutZero(t *testing.T) {
	// Source(1 work) → Processing(noWorkTimeout=0, processingTime=1) → Drain
	// After work departs, noWorkTimeout=0 → CheckWorkEmpty fires immediately
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":  float64(1),
		"outputType": "partA",
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"noWorkTimeout":  float64(0.0),
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
	_, statusLogs, _, _, err := engine.Run("sim-1", "test-sim", 10.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	foundWE := false
	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkEmpty && log.Value {
			foundWE = true
			break
		}
	}
	if !foundWE {
		t.Error("expected workEmpty=ON with noWorkTimeout=0 (immediate after departure)")
	}
}

func TestMultiWorkTimerCycling(t *testing.T) {
	// Source(3 works) → Processing(stayTime=5, processingTime=1) → Drain
	// Each work: arrive → schedule workFull → depart (cancel workFull) → schedule workEmpty → next arrives (cancel workEmpty)
	// workFull should never fire (work departs within stayTime)
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":  float64(3),
		"outputType": "partA",
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"stayTime":       float64(5.0),
		"noWorkTimeout":  float64(5.0),
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
	_, statusLogs, _, _, err := engine.Run("sim-1", "test-sim", 20.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkFull && log.Value {
			t.Error("expected workFull to never fire (all works depart within stayTime)")
		}
	}

	// After last work departs, workEmpty should eventually fire
	foundWE := false
	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkEmpty && log.Value {
			foundWE = true
			break
		}
	}
	if !foundWE {
		t.Error("expected workEmpty=ON after last work departs and noWorkTimeout elapses")
	}
}

func TestPendingTimersCleanup(t *testing.T) {
	// Verify that cancelled timers don't accumulate in pendingTimers map
	// Source(2 works) → Processing(stayTime=10, processingTime=1) → Drain
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":  float64(2),
		"outputType": "partA",
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"stayTime":       float64(10.0),
		"noWorkTimeout":  float64(10.0),
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
	_, _, _, _, err := engine.Run("sim-1", "test-sim", 30.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// After simulation completes, pendingTimers should have at most 1 entry
	// (the last workEmpty timer that fired and was deleted)
	if len(engine.pendingTimers) > 1 {
		t.Errorf("expected pendingTimers to be mostly cleaned up, got %d entries: %v",
			len(engine.pendingTimers), engine.pendingTimers)
	}
}

// === stayTime/noWorkTimeout default calculation tests ===

func TestTimerDefaults_ProcessingStation(t *testing.T) {
	proc := domain.NewStation("proc-1", domain.StationTypeProcessing, map[string]interface{}{
		"arrivalTime":    float64(1.0),
		"processingTime": float64(5.0),
		"departureTime":  float64(2.0),
	})

	scenario := &domain.Scenario{
		ID:       "test",
		Name:     "Test",
		Stations: []domain.Station{*proc},
	}

	engine := NewEngine(scenario)
	engine.scenario = scenario
	engine.initializeTimerDefaults()

	st := &engine.scenario.Stations[0]
	stayTime := st.GetFloatConfig("stayTime")
	// Expected: 1.0 + 5.0 + 2.0 + 1.0 (margin) = 9.0
	if stayTime != 9.0 {
		t.Errorf("expected stayTime=9.0, got %f", stayTime)
	}
}

func TestTimerDefaults_UserSpecifiedTakesPriority(t *testing.T) {
	proc := domain.NewStation("proc-1", domain.StationTypeProcessing, map[string]interface{}{
		"arrivalTime":    float64(1.0),
		"processingTime": float64(5.0),
		"departureTime":  float64(2.0),
		"stayTime":       float64(42.0), // User-specified
	})

	scenario := &domain.Scenario{
		ID:       "test",
		Name:     "Test",
		Stations: []domain.Station{*proc},
	}

	engine := NewEngine(scenario)
	engine.scenario = scenario
	engine.initializeTimerDefaults()

	st := &engine.scenario.Stations[0]
	stayTime := st.GetFloatConfig("stayTime")
	if stayTime != 42.0 {
		t.Errorf("expected user-specified stayTime=42.0, got %f", stayTime)
	}
}

func TestTimerDefaults_MarginOverride(t *testing.T) {
	proc := domain.NewStation("proc-1", domain.StationTypeProcessing, map[string]interface{}{
		"arrivalTime":    float64(0.0),
		"processingTime": float64(5.0),
		"departureTime":  float64(0.0),
		"stayTimeMargin": float64(3.0), // Custom margin
	})

	scenario := &domain.Scenario{
		ID:       "test",
		Name:     "Test",
		Stations: []domain.Station{*proc},
	}

	engine := NewEngine(scenario)
	engine.scenario = scenario
	engine.initializeTimerDefaults()

	st := &engine.scenario.Stations[0]
	stayTime := st.GetFloatConfig("stayTime")
	// Expected: 0 + 5.0 + 0 + 3.0 = 8.0
	if stayTime != 8.0 {
		t.Errorf("expected stayTime=8.0 (custom margin), got %f", stayTime)
	}
}

func TestTimerDefaults_NoWorkTimeout_WithUpstream(t *testing.T) {
	source := domain.NewStation("source-1", domain.StationTypeSource, map[string]interface{}{
		"departureTime": float64(3.0),
	})
	proc := domain.NewStation("proc-1", domain.StationTypeProcessing, map[string]interface{}{
		"processingTime": float64(5.0),
	})

	scenario := &domain.Scenario{
		ID:       "test",
		Name:     "Test",
		Stations: []domain.Station{*source, *proc},
		Connections: []domain.Connection{
			{From: "source-1", To: "proc-1"},
		},
	}

	engine := NewEngine(scenario)
	engine.scenario = scenario
	engine.initializeTimerDefaults()

	st := engine.scenario.GetStation("proc-1")
	noWorkTimeout := st.GetFloatConfig("noWorkTimeout")
	// Source upstream: departureTime=3.0 + margin=1.0 = 4.0
	if noWorkTimeout != 4.0 {
		t.Errorf("expected noWorkTimeout=4.0, got %f", noWorkTimeout)
	}
}
