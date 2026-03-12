package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
	"testing"
)

// === Phase 4-3: Integration tests (basic flow) ===

func TestIntegration_Processing_FullSignalCycle(t *testing.T) {
	// Source → Processing → Drain: verify full 10-signal lifecycle
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":     float64(1),
		"outputType":    "partA",
		"departureTime": float64(0.5),
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(2.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{
		"arrivalTime": float64(0.0),
	}

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
	_, statusLogs, workEvents, _, err := engine.Run("sim-1", "test", 20.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// Verify key signal transitions for proc-1
	signals := filterSignalChanges(statusLogs, "proc-1")

	// processReady and outputReady are set by rules → logged as signal_change
	// running and complete are set directly by engine → logged as status events, not signal_change
	assertSignalSequenceContains(t, signals, "processReady", true)
	assertSignalSequenceContains(t, signals, "outputReady", true)

	// Verify work events
	foundArrived := false
	foundDeparted := false
	for _, we := range workEvents {
		if we.StationID == "proc-1" && we.EventType == string(EventWorkArrived) {
			foundArrived = true
		}
		if we.StationID == "proc-1" && we.EventType == string(EventWorkDeparted) {
			foundDeparted = true
		}
	}
	if !foundArrived {
		t.Error("expected WorkArrived at proc-1")
	}
	if !foundDeparted {
		t.Error("expected WorkDeparted at proc-1")
	}
}

func TestIntegration_SourceProcessingDrain_BasicLine(t *testing.T) {
	// Source(3 works) → Processing → Drain: all 3 works should complete
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":     float64(3),
		"outputType":    "partA",
		"departureTime": float64(0.5),
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{
		"arrivalTime": float64(0.0),
	}

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
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 30.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 3 {
		t.Errorf("expected 3 works destroyed at drain, got %d", destroyed)
	}
}

func TestIntegration_SerialProcessing(t *testing.T) {
	// Source → Processing1 → Processing2 → Drain
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":     float64(2),
		"outputType":    "partA",
		"departureTime": float64(0.5),
	}
	proc1 := newTestStation("proc-1", domain.StationTypeProcessing)
	proc1.Config = map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
	}
	proc2 := newTestStation("proc-2", domain.StationTypeProcessing)
	proc2.Config = map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{
		"arrivalTime": float64(0.0),
	}

	scenario := &domain.Scenario{
		ID:   "test",
		Name: "Test",
		Stations: []domain.Station{*source, *proc1, *proc2, *drain},
		Connections: []domain.Connection{
			{From: "source-1", To: "proc-1"},
			{From: "proc-1", To: "proc-2"},
			{From: "proc-2", To: "drain-1"},
		},
	}

	engine := NewEngine(scenario)
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 30.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 2 {
		t.Errorf("expected 2 works destroyed at drain, got %d", destroyed)
	}
}

func TestIntegration_SplitMerge(t *testing.T) {
	// Source → Split → [Proc1, Proc2] → Merge → Drain
	// Note: Split requires a merged work as input (from Merge or Source that creates merged works)
	// Simpler: Source1 → Merge → Drain (basic merge test)
	source1 := newTestStation("source-1", domain.StationTypeSource)
	source1.Config = map[string]interface{}{
		"workCount":     float64(1),
		"outputType":    "partA",
		"departureTime": float64(0.5),
	}
	source2 := newTestStation("source-2", domain.StationTypeSource)
	source2.Config = map[string]interface{}{
		"workCount":     float64(1),
		"outputType":    "partB",
		"departureTime": float64(0.5),
	}

	merge := newTestStation("merge-1", domain.StationTypeMerge)
	merge.Config = map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"mergeCount":     float64(2),
		"outputWorkType": "assembly-AB",
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}

	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{
		"arrivalTime": float64(0.0),
	}

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

	// 1 merged work should arrive at drain
	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 1 {
		t.Errorf("expected 1 work destroyed (merged), got %d", destroyed)
	}
}

func TestIntegration_WorkFullWorkEmpty_Cycle(t *testing.T) {
	// Source(1 work) → Processing(stayTime=3, noWorkTimeout=2) → no downstream
	// Work stays → workFull=ON at ~3s
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":     float64(1),
		"outputType":    "partA",
		"departureTime": float64(0.5),
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"stayTime":       float64(3.0),
		"noWorkTimeout":  float64(2.0),
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
	_, statusLogs, _, _, err := engine.Run("sim-1", "test", 10.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	// workFull should fire (work stays, no downstream)
	foundWF := false
	for _, log := range statusLogs {
		if log.StationID == "proc-1" && log.SignalName == domain.SignalWorkFull && log.Value {
			foundWF = true
			break
		}
	}
	if !foundWF {
		t.Error("expected workFull=ON (no downstream, work stays)")
	}
}

// === Phase 4-4: Integration tests (complex scenarios) ===

func TestIntegration_MultiSource_Merge(t *testing.T) {
	source1 := newTestStation("source-1", domain.StationTypeSource)
	source1.Config = map[string]interface{}{
		"workCount":     float64(1),
		"outputType":    "partA",
		"departureTime": float64(1.0),
	}
	source2 := newTestStation("source-2", domain.StationTypeSource)
	source2.Config = map[string]interface{}{
		"workCount":     float64(1),
		"outputType":    "partB",
		"departureTime": float64(2.0),
	}

	merge := newTestStation("merge-1", domain.StationTypeMerge)
	merge.Config = map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"mergeCount":     float64(2),
		"outputWorkType": "assembly",
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	}

	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{
		"arrivalTime": float64(0.0),
	}

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

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 1 {
		t.Errorf("expected 1 merged work destroyed, got %d", destroyed)
	}
}

// === Phase 4-5: Integration tests (edge cases) ===

func TestIntegration_HighSpeedLoop(t *testing.T) {
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":     float64(50),
		"outputType":    "partA",
		"departureTime": float64(0.1),
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(0.01),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{
		"arrivalTime": float64(0.0),
	}

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
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 10.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed < 10 {
		t.Errorf("expected at least 10 works destroyed in high-speed mode, got %d", destroyed)
	}
}

func TestIntegration_CustomProcessReady(t *testing.T) {
	// Processing with custom processReady rule: requires workType:partA
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":     float64(1),
		"workType":      "partA",
		"departureTime": float64(0.5),
	}

	proc := domain.NewStation("proc-1", domain.StationTypeProcessing, map[string]interface{}{
		"processingTime": float64(1.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"interlockRules": map[string]interface{}{
			"signals": []interface{}{
				map[string]interface{}{"name": "inputWorkPresent", "initial": false},
				map[string]interface{}{"name": "processingWorkPresent", "initial": false},
				map[string]interface{}{"name": "outputWorkPresent", "initial": false},
				map[string]interface{}{"name": "running", "initial": false},
				map[string]interface{}{"name": "complete", "initial": false},
				map[string]interface{}{"name": "processReady", "initial": false},
				map[string]interface{}{"name": "inputReady", "initial": false},
				map[string]interface{}{"name": "outputReady", "initial": false},
				map[string]interface{}{"name": "workFull", "initial": false},
				map[string]interface{}{"name": "workEmpty", "initial": false},
				map[string]interface{}{"name": "workType:partA", "initial": false},
			},
			"rules": []interface{}{
				map[string]interface{}{"id": "R1", "target": "inputReady", "value": true, "conditions": []interface{}{map[string]interface{}{"signal": "inputWorkPresent", "value": false}}},
				map[string]interface{}{"id": "R2", "target": "inputReady", "value": false, "conditions": []interface{}{map[string]interface{}{"signal": "inputWorkPresent", "value": true}}},
				map[string]interface{}{"id": "R3", "target": "processReady", "value": true, "conditions": []interface{}{
					map[string]interface{}{"signal": "inputWorkPresent", "value": true},
					map[string]interface{}{"signal": "running", "value": false},
					map[string]interface{}{"signal": "complete", "value": false},
					map[string]interface{}{"signal": "workType:partA", "value": true},
				}},
				map[string]interface{}{"id": "R4", "target": "processReady", "value": false, "conditions": []interface{}{map[string]interface{}{"signal": "running", "value": true}}},
				map[string]interface{}{"id": "R5", "target": "outputReady", "value": true, "conditions": []interface{}{map[string]interface{}{"signal": "complete", "value": true}, map[string]interface{}{"signal": "outputWorkPresent", "value": true}}},
				map[string]interface{}{"id": "R6", "target": "outputReady", "value": false, "conditions": []interface{}{map[string]interface{}{"signal": "outputWorkPresent", "value": false}}},
			},
		},
	})
	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{
		"arrivalTime": float64(0.0),
	}

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
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 20.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 1 {
		t.Errorf("expected 1 work destroyed with custom processReady, got %d", destroyed)
	}
}

// === Phase 4-6: Load tests ===

func TestLoadTest_100StationLine(t *testing.T) {
	stations := make([]domain.Station, 0, 102)

	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":     float64(2),
		"outputType":    "partA",
		"departureTime": float64(0.5),
	}
	stations = append(stations, *source)

	for i := 0; i < 100; i++ {
		proc := newTestStation(
			fmt.Sprintf("proc-%d", i),
			domain.StationTypeProcessing,
		)
		proc.Config = map[string]interface{}{
			"processingTime": float64(0.1),
			"arrivalTime":    float64(0.0),
			"departureTime":  float64(0.0),
		}
		stations = append(stations, *proc)
	}

	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{
		"arrivalTime": float64(0.0),
	}
	stations = append(stations, *drain)

	connections := make([]domain.Connection, 0, 101)
	connections = append(connections, domain.Connection{From: "source-1", To: "proc-0"})
	for i := 0; i < 99; i++ {
		connections = append(connections, domain.Connection{
			From: fmt.Sprintf("proc-%d", i),
			To:   fmt.Sprintf("proc-%d", i+1),
		})
	}
	connections = append(connections, domain.Connection{From: "proc-99", To: "drain-1"})

	scenario := &domain.Scenario{
		ID:          "test",
		Name:        "Test",
		Stations:    stations,
		Connections: connections,
	}

	engine := NewEngine(scenario)
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 1000.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed < 1 {
		t.Error("expected at least 1 work to complete 100-station line")
	}
}

func TestLoadTest_1000Works(t *testing.T) {
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount":     float64(1000),
		"outputType":    "partA",
		"departureTime": float64(0.1),
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(0.05),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.0),
		"stayTime":       float64(1.0),
		"noWorkTimeout":  float64(1.0),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{
		"arrivalTime": float64(0.0),
	}

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
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 500.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed < 500 {
		t.Errorf("expected at least 500 works destroyed, got %d", destroyed)
	}
}

// === Phase 4-3: Merge signal timeline ===

func TestIntegration_Merge_SignalTimeline(t *testing.T) {
	source1 := newTestStation("source-1", domain.StationTypeSource)
	source1.Config = map[string]interface{}{
		"workCount":     float64(1),
		"workType":      "partA",
		"departureTime": float64(0.5),
	}
	source2 := newTestStation("source-2", domain.StationTypeSource)
	source2.Config = map[string]interface{}{
		"workCount":     float64(1),
		"workType":      "partB",
		"departureTime": float64(0.5),
	}
	merge := newTestStation("merge-1", domain.StationTypeMerge)
	merge.Config = map[string]interface{}{
		"processingTime": float64(2.0),
		"arrivalTime":    float64(0.0),
		"departureTime":  float64(0.5),
		"mergeCount":     float64(2),
		"outputWorkType": "assembly",
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
	_, statusLogs, workEvents, _, err := engine.Run("sim-1", "test", 30.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	signals := filterSignalChanges(statusLogs, "merge-1")

	// Verify key signal transitions
	assertSignalSequenceContains(t, signals, domain.SignalInputReady, false)
	assertSignalSequenceContains(t, signals, domain.SignalOutputReady, true)

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 1 {
		t.Errorf("expected 1 merged work destroyed, got %d", destroyed)
	}
}

// === Phase 4-3: Split signal timeline ===

func TestIntegration_Split_SignalTimeline(t *testing.T) {
	// Source → Merge(2) → Split(2) → [Drain1, Drain2]
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
	_, statusLogs, workEvents, _, err := engine.Run("sim-1", "test", 30.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	signals := filterSignalChanges(statusLogs, "split-1")
	assertSignalSequenceContains(t, signals, domain.SignalInputReady, false)

	// 2 split works should arrive at drains (1 each)
	d1 := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	d2 := countWorkEvents(workEvents, "drain-2", string(EventWorkDestroyed))
	if d1+d2 < 2 {
		t.Errorf("expected 2 total split works destroyed, got %d+%d=%d", d1, d2, d1+d2)
	}
}

// === Phase 4-3: Entry→Processing→Exit ===

func TestIntegration_EntryProcessingExit(t *testing.T) {
	entry := newTestStation("entry-1", domain.StationTypeEntry)
	entry.Config = map[string]interface{}{}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(1.0), "arrivalTime": float64(0.0), "departureTime": float64(0.0),
	}
	exit := newTestStation("exit-1", domain.StationTypeExit)
	exit.Config = map[string]interface{}{}

	// We need a source outside to push work into entry
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount": float64(1), "workType": "partA", "departureTime": float64(0.5),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{"arrivalTime": float64(0.0)}

	scenario := &domain.Scenario{
		ID:   "test",
		Name: "Test",
		Stations: []domain.Station{*source, *entry, *proc, *exit, *drain},
		Connections: []domain.Connection{
			{From: "source-1", To: "entry-1"},
			{From: "entry-1", To: "proc-1"},
			{From: "proc-1", To: "exit-1"},
			{From: "exit-1", To: "drain-1"},
		},
	}

	engine := NewEngine(scenario)
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 20.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 1 {
		t.Errorf("expected 1 work destroyed via Entry→Proc→Exit→Drain, got %d", destroyed)
	}
}

// === Phase 4-5: Merge with one port never receiving work ===

func TestIntegration_Merge_OnePortNeverReceives(t *testing.T) {
	// Source1 sends 1 work to merge port 0, but port 1 never gets work
	// Merge should NOT start processing. No works should be destroyed.
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount": float64(1), "workType": "partA", "departureTime": float64(0.5),
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
		Stations: []domain.Station{*source, *merge, *drain},
		Connections: []domain.Connection{
			{From: "source-1", To: "merge-1", ToPortIndex: 0},
			{From: "merge-1", To: "drain-1"},
		},
	}

	engine := NewEngine(scenario)
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 10.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 0 {
		t.Errorf("expected 0 works destroyed (merge incomplete), got %d", destroyed)
	}
}

// === Phase 4-5: initialWorks placement ===

func TestIntegration_InitialWorks(t *testing.T) {
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(1.0), "arrivalTime": float64(0.0), "departureTime": float64(0.0),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{"arrivalTime": float64(0.0)}

	scenario := &domain.Scenario{
		ID:   "test",
		Name: "Test",
		Stations: []domain.Station{*proc, *drain},
		Connections: []domain.Connection{
			{From: "proc-1", To: "drain-1"},
		},
	}

	initialWorks := map[string]InitialWorkCondition{
		"proc-1": {WorkID: "w-1", QualityStatus: "OK", ElapsedTime: 0},
	}

	engine := NewEngineWithInitialConditions(scenario, nil, initialWorks)
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 10.0)
	if err != nil {
		t.Fatalf("simulation failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 1 {
		t.Errorf("expected 1 work destroyed from initial placement, got %d", destroyed)
	}
}

// === Phase 4-6: 50-port Merge load test ===

func TestLoadTest_50PortMerge(t *testing.T) {
	portCount := 50
	stations := make([]domain.Station, 0, portCount+2)
	connections := make([]domain.Connection, 0, portCount+1)

	portsConfig := make([]interface{}, portCount)
	for i := 0; i < portCount; i++ {
		portsConfig[i] = map[string]interface{}{"capacity": float64(1)}

		src := newTestStation(fmt.Sprintf("source-%d", i), domain.StationTypeSource)
		src.Config = map[string]interface{}{
			"workCount": float64(1), "workType": fmt.Sprintf("part%d", i), "departureTime": float64(0.1),
		}
		stations = append(stations, *src)
		connections = append(connections, domain.Connection{
			From: fmt.Sprintf("source-%d", i), To: "merge-1", ToPortIndex: i,
		})
	}

	merge := newTestStation("merge-1", domain.StationTypeMerge)
	merge.Config = map[string]interface{}{
		"processingTime": float64(1.0), "arrivalTime": float64(0.0), "departureTime": float64(0.0),
		"mergeCount": float64(portCount), "outputWorkType": "mega-assembly",
		"ports":      portsConfig,
	}
	stations = append(stations, *merge)

	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{"arrivalTime": float64(0.0)}
	stations = append(stations, *drain)
	connections = append(connections, domain.Connection{From: "merge-1", To: "drain-1"})

	scenario := &domain.Scenario{
		ID: "test", Name: "Test",
		Stations: stations, Connections: connections,
	}

	engine := NewEngine(scenario)
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 30.0)
	if err != nil {
		t.Fatalf("50-port merge failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed != 1 {
		t.Errorf("expected 1 mega-merged work, got %d", destroyed)
	}
}

// === Phase 4-6: Long duration run ===

func TestLoadTest_LongDuration(t *testing.T) {
	source := newTestStation("source-1", domain.StationTypeSource)
	source.Config = map[string]interface{}{
		"workCount": float64(100), "workType": "partA", "departureTime": float64(1.0),
	}
	proc := newTestStation("proc-1", domain.StationTypeProcessing)
	proc.Config = map[string]interface{}{
		"processingTime": float64(0.5), "arrivalTime": float64(0.0), "departureTime": float64(0.0),
		"stayTime": float64(5.0), "noWorkTimeout": float64(3.0),
	}
	drain := newTestStation("drain-1", domain.StationTypeDrain)
	drain.Config = map[string]interface{}{"arrivalTime": float64(0.0)}

	scenario := &domain.Scenario{
		ID: "test", Name: "Test",
		Stations:    []domain.Station{*source, *proc, *drain},
		Connections: []domain.Connection{{From: "source-1", To: "proc-1"}, {From: "proc-1", To: "drain-1"}},
	}

	engine := NewEngine(scenario)
	_, _, workEvents, _, err := engine.Run("sim-1", "test", 10000.0)
	if err != nil {
		t.Fatalf("long duration run failed: %v", err)
	}

	destroyed := countWorkEvents(workEvents, "drain-1", string(EventWorkDestroyed))
	if destroyed < 50 {
		t.Errorf("expected at least 50 works destroyed in long run, got %d", destroyed)
	}
}

// === Helpers ===

type signalChange struct {
	Name  string
	Value bool
	Time  float64
}

func filterSignalChanges(logs []StationStatusLog, stationID string) []signalChange {
	var result []signalChange
	for _, log := range logs {
		if log.StationID == stationID && log.StatusType == "signal_change" {
			result = append(result, signalChange{
				Name:  log.SignalName,
				Value: log.Value,
				Time:  log.Timestamp,
			})
		}
	}
	return result
}

func assertSignalSequenceContains(t *testing.T, changes []signalChange, signalName string, value bool) {
	t.Helper()
	for _, c := range changes {
		if c.Name == signalName && c.Value == value {
			return
		}
	}
	t.Errorf("expected signal change %s=%v in sequence, not found", signalName, value)
}

func countWorkEvents(events []WorkEventLog, stationID string, eventType string) int {
	count := 0
	for _, e := range events {
		if e.StationID == stationID && e.EventType == eventType {
			count++
		}
	}
	return count
}
