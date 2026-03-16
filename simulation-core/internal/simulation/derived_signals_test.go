package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
	"testing"
)

// === Derived signal unit tests ===

func TestDeriveMergeStationSignals_AllPortsFull(t *testing.T) {
	merge := newTestStation("merge-1", domain.StationTypeMerge)
	merge.Config = map[string]interface{}{
		"mergeCount": float64(2),
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}
	merge.InitializePorts()
	merge.InitializeSignals()

	// Initially all ports empty → allPortsFull=false
	deriveStationSignals(merge)
	if merge.Signals[domain.SignalAllPortsFull] {
		t.Error("expected allPortsFull=false when all ports are empty")
	}

	// Fill port 0 only → allPortsFull=false, port1Full=true, port2Full=false
	p0 := merge.GetInputPort(0)
	p0.Works = []*domain.Work{{ID: "w1", Type: "partA"}}
	p0.Signals[domain.SignalInputWorkPresent] = true
	deriveStationSignals(merge)
	if merge.Signals[domain.SignalAllPortsFull] {
		t.Error("expected allPortsFull=false when only one port is full")
	}
	if !merge.Signals["port1Full"] {
		t.Error("expected port1Full=true")
	}
	if merge.Signals["port2Full"] {
		t.Error("expected port2Full=false")
	}

	// Fill port 1 too → allPortsFull=true
	p1 := merge.GetInputPort(1)
	p1.Works = []*domain.Work{{ID: "w2", Type: "partB"}}
	p1.Signals[domain.SignalInputWorkPresent] = true
	deriveStationSignals(merge)
	if !merge.Signals[domain.SignalAllPortsFull] {
		t.Error("expected allPortsFull=true when all ports are full")
	}
	if !merge.Signals["port2Full"] {
		t.Error("expected port2Full=true")
	}
}

func TestDeriveMergeStationSignals_DerivedIRandIWP(t *testing.T) {
	merge := newTestStation("merge-1", domain.StationTypeMerge)
	merge.Config = map[string]interface{}{
		"mergeCount": float64(2),
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}
	merge.InitializePorts()
	merge.InitializeSignals()

	// Set port 0 IR=true, port 1 IR=false
	p0 := merge.GetInputPort(0)
	p0.Signals[domain.SignalInputReady] = true
	deriveStationSignals(merge)

	// Station-level IR should be anyIR = true
	if !merge.Signals[domain.SignalInputReady] {
		t.Error("expected station-level inputReady=true (any port IR=true)")
	}
	// Station-level IWP should be false (no works)
	if merge.Signals[domain.SignalInputWorkPresent] {
		t.Error("expected station-level inputWorkPresent=false")
	}

	// Set port 1 IWP=true
	p1 := merge.GetInputPort(1)
	p1.Signals[domain.SignalInputWorkPresent] = true
	deriveStationSignals(merge)

	if !merge.Signals[domain.SignalInputWorkPresent] {
		t.Error("expected station-level inputWorkPresent=true (any port IWP=true)")
	}
}

func TestDeriveSplitStationSignals_AllPortsEmpty(t *testing.T) {
	split := newTestStation("split-1", domain.StationTypeSplit)
	split.Config = map[string]interface{}{
		"splitCount": float64(2),
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}
	split.InitializePorts()
	split.InitializeSignals()

	// Initially all ports empty → allPortsEmpty=true
	deriveStationSignals(split)
	if !split.Signals[domain.SignalAllPortsEmpty] {
		t.Error("expected allPortsEmpty=true when all ports are empty")
	}
	if !split.Signals["port1Empty"] {
		t.Error("expected port1Empty=true")
	}
	if split.Signals["port1HasWork"] {
		t.Error("expected port1HasWork=false")
	}

	// Add work to port 0 → allPortsEmpty=false
	p0 := split.GetOutputPort(0)
	p0.Works = []*domain.Work{{ID: "w1", Type: "partA"}}
	p0.Signals[domain.SignalOutputWorkPresent] = true
	deriveStationSignals(split)
	if split.Signals[domain.SignalAllPortsEmpty] {
		t.Error("expected allPortsEmpty=false when one port has work")
	}
	if split.Signals["port1Empty"] {
		t.Error("expected port1Empty=false")
	}
	if !split.Signals["port1HasWork"] {
		t.Error("expected port1HasWork=true")
	}
	if !split.Signals["port2Empty"] {
		t.Error("expected port2Empty=true")
	}
}

func TestDeriveSplitStationSignals_DerivedORandOWP(t *testing.T) {
	split := newTestStation("split-1", domain.StationTypeSplit)
	split.Config = map[string]interface{}{
		"splitCount": float64(2),
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}
	split.InitializePorts()
	split.InitializeSignals()

	// Set port 0 OR=true
	p0 := split.GetOutputPort(0)
	p0.Signals[domain.SignalOutputReady] = true
	deriveStationSignals(split)

	if !split.Signals[domain.SignalOutputReady] {
		t.Error("expected station-level outputReady=true (any port OR=true)")
	}
	if split.Signals[domain.SignalOutputWorkPresent] {
		t.Error("expected station-level outputWorkPresent=false")
	}

	// Set port 1 OWP=true
	p1 := split.GetOutputPort(1)
	p1.Signals[domain.SignalOutputWorkPresent] = true
	deriveStationSignals(split)

	if !split.Signals[domain.SignalOutputWorkPresent] {
		t.Error("expected station-level outputWorkPresent=true (any port OWP=true)")
	}
}

func TestDerivedSignals_UsedByStationRules_Merge(t *testing.T) {
	// Test that allPortsFull derived signal correctly triggers processReady via rules
	merge := newTestStation("merge-1", domain.StationTypeMerge)
	merge.Config = map[string]interface{}{
		"mergeCount": float64(2),
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}
	merge.InitializePorts()
	merge.InitializeSignals()

	scenario := newTestScenario(merge)

	// Initially: allPortsFull=false → processReady should stay false
	deriveStationSignals(merge)
	evaluateRules(merge, scenario, 0)
	if merge.Signals[domain.SignalProcessReady] {
		t.Error("expected processReady=false when ports are not full")
	}

	// Fill all ports
	for i := 0; i < merge.InputPortCount(); i++ {
		p := merge.GetInputPort(i)
		p.Works = []*domain.Work{{ID: fmt.Sprintf("w%d", i), Type: "part"}}
		p.Signals[domain.SignalInputWorkPresent] = true
	}

	// Derive → evaluate → processReady should be ON
	deriveStationSignals(merge)
	if !merge.Signals[domain.SignalAllPortsFull] {
		t.Fatal("expected allPortsFull=true after filling all ports")
	}
	evaluateRules(merge, scenario, 0)
	if !merge.Signals[domain.SignalProcessReady] {
		t.Error("expected processReady=true when allPortsFull=true and running=false and complete=false")
	}
}

func TestDerivedSignals_UsedByStationRules_Split(t *testing.T) {
	// Test that allPortsEmpty derived signal correctly triggers inputReady via rules
	split := newTestStation("split-1", domain.StationTypeSplit)
	split.Config = map[string]interface{}{
		"splitCount": float64(2),
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}
	split.InitializePorts()
	split.InitializeSignals()

	scenario := newTestScenario(split)

	// Initially: allPortsEmpty=true, IWP=false → inputReady should be ON
	deriveStationSignals(split)
	evaluateRules(split, scenario, 0)
	if !split.Signals[domain.SignalInputReady] {
		t.Error("expected inputReady=true when allPortsEmpty=true and no work present")
	}

	// Simulate work arriving at station level (IWP=true) → R2 fires → IR=OFF
	split.Signals[domain.SignalInputWorkPresent] = true
	deriveStationSignals(split)
	evaluateRules(split, scenario, 0)

	if split.Signals[domain.SignalInputReady] {
		t.Error("expected inputReady=false when inputWorkPresent=true (R2 fires)")
	}
}

// === Merge/Split integration tests with default rules ===

func TestIntegration_MergeDefaultRules_AllPortsArrive(t *testing.T) {
	// Two sources feed a merge station, which outputs to a drain
	source1 := newTestStation("source-1", domain.StationTypeSource)
	source1.Config = map[string]interface{}{
		"workCount": float64(1), "workType": "partA", "departureTime": float64(0.5),
	}
	source2 := newTestStation("source-2", domain.StationTypeSource)
	source2.Config = map[string]interface{}{
		"workCount": float64(1), "workType": "partB", "departureTime": float64(0.5),
	}
	merge := newTestStation("merge-1", domain.StationTypeMerge)
	merge.Config = map[string]interface{}{
		"processingTime": float64(1.0), "arrivalTime": float64(0.0), "departureTime": float64(0.0),
		"mergeCount": float64(2), "outputWorkType": "assembly",
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{"arrivalTime": float64(0.0)}

	scenario := &domain.Scenario{
		ID:   "test",
		Name: "Test",
		Stations: []domain.Station{*source1, *source2, *merge, *drain},
		Connections: []domain.Connection{
			{From: "source-1", To: "merge-1", ToPortIndex: 0},
			{From: "source-2", To: "merge-1", ToPortIndex: 1},
			{From: "merge-1", To: "drain-1"},
		},
	}

	engine := NewEngine(scenario)
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 30.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// Verify merged work was created and destroyed at drain
	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 1 {
		t.Errorf("expected 1 merged work destroyed at drain, got %d", destroyed)
	}
}

func TestIntegration_SplitDefaultRules_AllPortsEmpty(t *testing.T) {
	// [Source1, Source2] → Merge(2) → Split(2) → [Drain1, Drain2]
	// Split requires merged work (with mergedFrom metadata)
	source1 := newTestStation("source-1", domain.StationTypeSource)
	source1.Config = map[string]interface{}{
		"workCount": float64(1), "workType": "partA", "departureTime": float64(0.5),
	}
	source2 := newTestStation("source-2", domain.StationTypeSource)
	source2.Config = map[string]interface{}{
		"workCount": float64(1), "workType": "partB", "departureTime": float64(0.5),
	}
	merge := newTestStation("merge-1", domain.StationTypeMerge)
	merge.Config = map[string]interface{}{
		"processingTime": float64(1.0), "arrivalTime": float64(0.0), "departureTime": float64(0.0),
		"mergeCount": float64(2), "outputWorkType": "assembly",
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}
	split := newTestStation("split-1", domain.StationTypeSplit)
	split.Config = map[string]interface{}{
		"processingTime": float64(1.0), "arrivalTime": float64(0.0), "departureTime": float64(0.0),
		"splitCount": float64(2),
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}
	drain1 := newTestStation("drain-1", domain.StationTypeDrain)
	drain1.Config = map[string]interface{}{"arrivalTime": float64(0.0)}
	drain2 := newTestStation("drain-2", domain.StationTypeDrain)
	drain2.Config = map[string]interface{}{"arrivalTime": float64(0.0)}

	scenario := &domain.Scenario{
		ID:   "test",
		Name: "Test",
		Stations: []domain.Station{*source1, *source2, *merge, *split, *drain1, *drain2},
		Connections: []domain.Connection{
			{From: "source-1", To: "merge-1", ToPortIndex: 0},
			{From: "source-2", To: "merge-1", ToPortIndex: 1},
			{From: "merge-1", To: "split-1"},
			{From: "split-1", To: "drain-1", FromPortIndex: 0},
			{From: "split-1", To: "drain-2", FromPortIndex: 1},
		},
	}

	engine := NewEngine(scenario)
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 30.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// Split should produce works at both drains
	destroyed1 := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	destroyed2 := countWorkEvents(workEvents, "drain-2", string(EventWorkDestroyed))
	total := destroyed1 + destroyed2
	if total != 2 {
		t.Errorf("expected 2 split works destroyed at drains, got %d (drain-1=%d, drain-2=%d)", total, destroyed1, destroyed2)
	}
}
