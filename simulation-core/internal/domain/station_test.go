package domain

import "testing"

// === Phase 1-7: Port unified model data operation tests ===

func TestPort0_GetSetWork(t *testing.T) {
	station := NewStation("s1", StationTypeProcessing, map[string]interface{}{})
	if station.GetWork() != nil {
		t.Error("expected nil work on new station")
	}

	work := NewWork("w1", "work-1")
	station.SetWork(work)
	if got := station.GetWork(); got != work {
		t.Error("expected SetWork/GetWork roundtrip")
	}

	station.SetWork(nil)
	if station.GetWork() != nil {
		t.Error("expected nil after SetWork(nil)")
	}
}

func TestPort0_SignalReadWrite(t *testing.T) {
	station := NewStation("s1", StationTypeProcessing, map[string]interface{}{})
	station.InterlockRules = GetDefaultInterlockConfig(StationTypeProcessing)
	station.InitializeSignals()

	// All signals should start false
	for _, sig := range []string{
		SignalInputWorkPresent, SignalProcessingWorkPresent, SignalOutputWorkPresent,
		SignalRunning, SignalComplete, SignalProcessReady,
		SignalInputReady, SignalOutputReady, SignalWorkFull, SignalWorkEmpty,
	} {
		if station.GetSignal(sig) {
			t.Errorf("expected signal %s=false initially", sig)
		}
	}

	station.SetSignal(SignalInputWorkPresent, true)
	if !station.GetSignal(SignalInputWorkPresent) {
		t.Error("expected inputWorkPresent=true after SetSignal")
	}

	station.SetSignal(SignalInputWorkPresent, false)
	if station.GetSignal(SignalInputWorkPresent) {
		t.Error("expected inputWorkPresent=false after SetSignal(false)")
	}
}

func TestPort1Plus_MergeInputPorts(t *testing.T) {
	station := NewStation("m1", StationTypeMerge, map[string]interface{}{
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(2)},
		},
	})
	station.InterlockRules = GetDefaultInterlockConfig(StationTypeMerge)
	station.InitializeSignals()
	station.InitializePorts()

	if station.InputPortCount() != 2 {
		t.Fatalf("expected 2 input ports, got %d", station.InputPortCount())
	}
	if len(station.InPorts) != 3 {
		t.Fatalf("expected 3 total InPorts (station-level + 2 input), got %d", len(station.InPorts))
	}

	// Port[1] capacity=1, Port[2] capacity=2
	p0 := station.GetInputPort(0)
	p1 := station.GetInputPort(1)
	if p0.Capacity != 1 {
		t.Errorf("expected port 0 capacity=1, got %d", p0.Capacity)
	}
	if p1.Capacity != 2 {
		t.Errorf("expected port 1 capacity=2, got %d", p1.Capacity)
	}

	// Port signals should be initialized
	if p0.Signals == nil {
		t.Fatal("expected port 0 signals initialized")
	}

	// Add work to ports
	w1 := NewWork("w1", "work-1")
	if err := station.AddWorkToPort(w1, 0); err != nil {
		t.Fatalf("AddWorkToPort failed: %v", err)
	}
	if len(p0.Works) != 1 {
		t.Errorf("expected 1 work in port 0, got %d", len(p0.Works))
	}

	// Port 0 is full (capacity=1)
	w2 := NewWork("w2", "work-2")
	if err := station.AddWorkToPort(w2, 0); err == nil {
		t.Error("expected error adding work to full port")
	}

	// Port 1 can hold 2
	w3 := NewWork("w3", "work-3")
	w4 := NewWork("w4", "work-4")
	station.AddWorkToPort(w3, 1)
	station.AddWorkToPort(w4, 1)
	if len(p1.Works) != 2 {
		t.Errorf("expected 2 works in port 1, got %d", len(p1.Works))
	}
}

func TestPort1Plus_SplitOutputPorts(t *testing.T) {
	station := NewStation("sp1", StationTypeSplit, map[string]interface{}{
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	})
	station.InterlockRules = GetDefaultInterlockConfig(StationTypeSplit)
	station.InitializeSignals()
	station.InitializePorts()

	if station.OutputPortCount() != 2 {
		t.Fatalf("expected 2 output ports, got %d", station.OutputPortCount())
	}

	// Place works in output ports directly
	p0 := station.GetOutputPort(0)
	p0.Works = []*Work{NewWork("w1", "work-1")}

	w := station.GetOutputPortWorkByIndex(0)
	if w == nil || w.ID != "w1" {
		t.Error("expected to get work from output port 0")
	}
	if len(p0.Works) != 0 {
		t.Error("expected port 0 empty after getting work")
	}
}

func TestGetPortSignal(t *testing.T) {
	station := NewStation("m1", StationTypeMerge, map[string]interface{}{
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
		},
	})
	station.InterlockRules = GetDefaultInterlockConfig(StationTypeMerge)
	station.InitializeSignals()
	station.InitializePorts()

	// InPorts[1] has per-port signals (IWP, IR)
	station.SetInputPortSignal(0, SignalInputWorkPresent, true)
	if !station.GetInputPortSignal(0, SignalInputWorkPresent) {
		t.Error("expected port signal inputWorkPresent=true")
	}

	// Out-of-range port returns false
	if station.GetInputPortSignal(99, SignalInputReady) {
		t.Error("expected false for out-of-range port")
	}
}

func TestInitializePorts_PortCount(t *testing.T) {
	tests := []struct {
		name             string
		stationType      StationType
		portsConfig      []interface{}
		expectedInPorts  int // Total InPorts count including [0]
		expectedOutPorts int // Total OutPorts count including [0]
	}{
		{
			name:             "Processing has 1 inPort + 1 outPort (station-level only)",
			stationType:      StationTypeProcessing,
			portsConfig:      nil,
			expectedInPorts:  1,
			expectedOutPorts: 1,
		},
		{
			name:        "Merge with 3 input ports",
			stationType: StationTypeMerge,
			portsConfig: []interface{}{
				map[string]interface{}{"capacity": float64(1)},
				map[string]interface{}{"capacity": float64(1)},
				map[string]interface{}{"capacity": float64(1)},
			},
			expectedInPorts:  4, // [0]=station-level + 3 additional
			expectedOutPorts: 1,
		},
		{
			name:        "Split with 2 output ports",
			stationType: StationTypeSplit,
			portsConfig: []interface{}{
				map[string]interface{}{"capacity": float64(1)},
				map[string]interface{}{"capacity": float64(1)},
			},
			expectedInPorts:  1,
			expectedOutPorts: 3, // [0]=station-level + 2 additional
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := map[string]interface{}{}
			if tt.portsConfig != nil {
				config["ports"] = tt.portsConfig
			}
			station := NewStation("test", tt.stationType, config)
			station.InterlockRules = GetDefaultInterlockConfig(tt.stationType)
			station.InitializeSignals()
			station.InitializePorts()

			if len(station.InPorts) != tt.expectedInPorts {
				t.Errorf("expected %d InPorts, got %d", tt.expectedInPorts, len(station.InPorts))
			}
			if len(station.OutPorts) != tt.expectedOutPorts {
				t.Errorf("expected %d OutPorts, got %d", tt.expectedOutPorts, len(station.OutPorts))
			}
		})
	}
}

// === 10-signal default rule evaluation tests for all 8 station types ===

func TestDefaultRules_AllStationTypes(t *testing.T) {
	types := []struct {
		stationType    StationType
		expectedRules  int
		expectedIRInit bool // inputReady after initial evaluation?
		expectedORInit bool // outputReady after initial evaluation?
	}{
		{StationTypeSource, 2, false, false},
		{StationTypeProcessing, 6, false, false},
		{StationTypeDrain, 2, false, false},
		{StationTypeMerge, 4, false, false},
		{StationTypeSplit, 4, false, false},
		{StationTypeEntry, 4, false, false},
		{StationTypeExit, 4, false, false},
		{StationTypeMachine, 4, false, false},
	}

	for _, tt := range types {
		t.Run(string(tt.stationType), func(t *testing.T) {
			config := GetDefaultInterlockConfig(tt.stationType)
			if config == nil {
				t.Fatal("expected non-nil config")
			}
			if len(config.Signals) < 10 {
				t.Errorf("expected at least 10 signals, got %d", len(config.Signals))
			}
			if len(config.Rules) != tt.expectedRules {
				t.Errorf("expected %d rules, got %d", tt.expectedRules, len(config.Rules))
			}

			// All 10 signals should be present
			for _, name := range []string{
				SignalInputWorkPresent, SignalProcessingWorkPresent, SignalOutputWorkPresent,
				SignalRunning, SignalComplete, SignalProcessReady,
				SignalInputReady, SignalOutputReady, SignalWorkFull, SignalWorkEmpty,
			} {
				if !config.HasSignal(name) {
					t.Errorf("missing signal %s", name)
				}
			}

			// Base 10 signals initial=false (derived signals may have different initial values)
			for _, sig := range config.Signals {
				if sig.Initial && sig.Name != SignalAllPortsEmpty && sig.Name != SignalAllPortsFull {
					t.Errorf("expected signal %s initial=false", sig.Name)
				}
			}
		})
	}
}

func TestCheckMergeCondition(t *testing.T) {
	station := NewStation("m1", StationTypeMerge, map[string]interface{}{
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	})
	station.InterlockRules = GetDefaultInterlockConfig(StationTypeMerge)
	station.InitializeSignals()
	station.InitializePorts()

	// Empty ports → not ready
	if station.CheckMergeCondition() {
		t.Error("expected false for empty merge ports")
	}

	// Fill port 0 only → not ready
	station.AddWorkToPort(NewWork("w1", "work-1"), 0)
	if station.CheckMergeCondition() {
		t.Error("expected false for partially filled merge")
	}

	// Fill both → ready
	station.AddWorkToPort(NewWork("w2", "work-2"), 1)
	if !station.CheckMergeCondition() {
		t.Error("expected true when all ports filled")
	}
}

func TestHasOutputPortWorks(t *testing.T) {
	station := NewStation("sp1", StationTypeSplit, map[string]interface{}{
		"ports": []interface{}{
			map[string]interface{}{"capacity": float64(1)},
			map[string]interface{}{"capacity": float64(1)},
		},
	})
	station.InterlockRules = GetDefaultInterlockConfig(StationTypeSplit)
	station.InitializeSignals()
	station.InitializePorts()

	if station.HasOutputPortWorks() {
		t.Error("expected false for empty split ports")
	}

	// Place work in port 1
	station.GetOutputPort(1).Works = []*Work{NewWork("w1", "work-1")}
	if !station.HasOutputPortWorks() {
		t.Error("expected true when port 1 has work")
	}

	// Remove it
	station.GetOutputPort(1).Works = nil
	if station.HasOutputPortWorks() {
		t.Error("expected false after removing work")
	}
}
