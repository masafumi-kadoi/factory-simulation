package simulation

import (
	"testing"

	"factory-simulation/simulation-core/internal/domain"
)

// Helper to create a basic station
func makeStation(id string, typ domain.StationType) domain.Station {
	return domain.Station{
		ID:     id,
		Type:   typ,
		Config: map[string]interface{}{},
	}
}

// Helper to find a station by ID in a slice
func findStation(stations []domain.Station, id string) *domain.Station {
	for i := range stations {
		if stations[i].ID == id {
			return &stations[i]
		}
	}
	return nil
}

// Helper to find connections by From
func findConnectionsFrom(connections []domain.Connection, from string) []domain.Connection {
	var result []domain.Connection
	for _, c := range connections {
		if c.From == from {
			result = append(result, c)
		}
	}
	return result
}

// Helper to find connections by To
func findConnectionsTo(connections []domain.Connection, to string) []domain.Connection {
	var result []domain.Connection
	for _, c := range connections {
		if c.To == to {
			result = append(result, c)
		}
	}
	return result
}

func TestFlattenScenario_NoModulerStations(t *testing.T) {
	// Scenario with no ModulerStations should be unchanged
	scenario := &domain.Scenario{
		ID:   "test-1",
		Name: "Simple",
		Stations: []domain.Station{
			makeStation("source-1", domain.StationTypeSource),
			makeStation("process-1", domain.StationTypeProcessing),
			makeStation("drain-1", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "source-1", To: "process-1", FromPortIndex: -1, ToPortIndex: -1},
			{From: "process-1", To: "drain-1", FromPortIndex: -1, ToPortIndex: -1},
		},
	}

	result := FlattenScenario(scenario)

	if len(result.Stations) != 3 {
		t.Errorf("expected 3 stations, got %d", len(result.Stations))
	}
	if len(result.Connections) != 2 {
		t.Errorf("expected 2 connections, got %d", len(result.Connections))
	}
	if result.ID != "test-1" {
		t.Errorf("expected ID 'test-1', got '%s'", result.ID)
	}
}

func TestFlattenScenario_SingleModulerStation(t *testing.T) {
	// Source -> Moduler(Entry -> Processing -> Exit) -> Drain
	scenario := &domain.Scenario{
		ID:   "test-2",
		Name: "Single Moduler",
		Stations: []domain.Station{
			makeStation("source-1", domain.StationTypeSource),
			{
				ID:         "moduler-1",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 1,
				ExitCount:  1,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						makeStation("entry-0", domain.StationTypeEntry),
						makeStation("process-1", domain.StationTypeProcessing),
						makeStation("exit-0", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "process-1", FromPortIndex: -1, ToPortIndex: -1},
						{From: "process-1", To: "exit-0", FromPortIndex: -1, ToPortIndex: -1},
					},
				},
			},
			makeStation("drain-1", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "source-1", To: "moduler-1", FromPortIndex: -1, ToPortIndex: 0},
			{From: "moduler-1", To: "drain-1", FromPortIndex: 0, ToPortIndex: -1},
		},
	}

	result := FlattenScenario(scenario)

	// Expected stations: source-1, moduler-1 (kept), moduler-1.entry-0, moduler-1.process-1, moduler-1.exit-0, drain-1
	if len(result.Stations) != 6 {
		t.Errorf("expected 6 stations, got %d", len(result.Stations))
		for _, s := range result.Stations {
			t.Logf("  station: %s (%s)", s.ID, s.Type)
		}
	}

	// Check internal stations have prefixed IDs
	if s := findStation(result.Stations, "moduler-1.entry-0"); s == nil {
		t.Error("missing station moduler-1.entry-0")
	} else if s.Type != domain.StationTypeEntry {
		t.Errorf("moduler-1.entry-0 type = %s, want entry", s.Type)
	}

	if s := findStation(result.Stations, "moduler-1.process-1"); s == nil {
		t.Error("missing station moduler-1.process-1")
	}

	if s := findStation(result.Stations, "moduler-1.exit-0"); s == nil {
		t.Error("missing station moduler-1.exit-0")
	}

	// Check ModulerStation itself is kept (without SubScenario)
	if s := findStation(result.Stations, "moduler-1"); s == nil {
		t.Error("missing station moduler-1")
	} else if s.SubScenario != nil {
		t.Error("moduler-1 should have nil SubScenario after flatten")
	}

	// Check external connections are rewritten
	// source-1 -> moduler-1.entry-0 (was source-1 -> moduler-1 toPortIndex=0)
	sourceConns := findConnectionsFrom(result.Connections, "source-1")
	if len(sourceConns) != 1 {
		t.Fatalf("expected 1 connection from source-1, got %d", len(sourceConns))
	}
	if sourceConns[0].To != "moduler-1.entry-0" {
		t.Errorf("source-1 -> %s, want moduler-1.entry-0", sourceConns[0].To)
	}
	if sourceConns[0].ToPortIndex != -1 {
		t.Errorf("ToPortIndex = %d, want -1", sourceConns[0].ToPortIndex)
	}

	// moduler-1.exit-0 -> drain-1 (was moduler-1 -> drain-1 fromPortIndex=0)
	drainConns := findConnectionsTo(result.Connections, "drain-1")
	if len(drainConns) != 1 {
		t.Fatalf("expected 1 connection to drain-1, got %d", len(drainConns))
	}
	if drainConns[0].From != "moduler-1.exit-0" {
		t.Errorf("%s -> drain-1, want moduler-1.exit-0", drainConns[0].From)
	}
	if drainConns[0].FromPortIndex != -1 {
		t.Errorf("FromPortIndex = %d, want -1", drainConns[0].FromPortIndex)
	}

	// Check internal connections are prefixed
	entryConns := findConnectionsFrom(result.Connections, "moduler-1.entry-0")
	if len(entryConns) != 1 {
		t.Fatalf("expected 1 connection from moduler-1.entry-0, got %d", len(entryConns))
	}
	if entryConns[0].To != "moduler-1.process-1" {
		t.Errorf("moduler-1.entry-0 -> %s, want moduler-1.process-1", entryConns[0].To)
	}
}

func TestFlattenScenario_MultipleEntryExit(t *testing.T) {
	// ModulerStation with 2 entries and 1 exit
	scenario := &domain.Scenario{
		ID:   "test-3",
		Name: "Multi Entry",
		Stations: []domain.Station{
			makeStation("source-1", domain.StationTypeSource),
			makeStation("source-2", domain.StationTypeSource),
			{
				ID:         "moduler-1",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 2,
				ExitCount:  1,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						makeStation("entry-0", domain.StationTypeEntry),
						makeStation("entry-1", domain.StationTypeEntry),
						makeStation("process-1", domain.StationTypeProcessing),
						makeStation("exit-0", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "process-1"},
						{From: "entry-1", To: "process-1"},
						{From: "process-1", To: "exit-0"},
					},
				},
			},
			makeStation("drain-1", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "source-1", To: "moduler-1", ToPortIndex: 0},
			{From: "source-2", To: "moduler-1", ToPortIndex: 1},
			{From: "moduler-1", To: "drain-1", FromPortIndex: 0},
		},
	}

	result := FlattenScenario(scenario)

	// source-1 -> moduler-1.entry-0
	s1Conns := findConnectionsFrom(result.Connections, "source-1")
	if len(s1Conns) != 1 || s1Conns[0].To != "moduler-1.entry-0" {
		t.Errorf("source-1 should connect to moduler-1.entry-0, got %v", s1Conns)
	}

	// source-2 -> moduler-1.entry-1
	s2Conns := findConnectionsFrom(result.Connections, "source-2")
	if len(s2Conns) != 1 || s2Conns[0].To != "moduler-1.entry-1" {
		t.Errorf("source-2 should connect to moduler-1.entry-1, got %v", s2Conns)
	}

	// moduler-1.exit-0 -> drain-1
	drainConns := findConnectionsTo(result.Connections, "drain-1")
	if len(drainConns) != 1 || drainConns[0].From != "moduler-1.exit-0" {
		t.Errorf("drain-1 should receive from moduler-1.exit-0, got %v", drainConns)
	}
}

func TestFlattenScenario_NestedModulerStation(t *testing.T) {
	// Source -> ModulerOuter(Entry -> ModulerInner(Entry -> Processing -> Exit) -> Exit) -> Drain
	innerModuler := domain.Station{
		ID:         "inner-moduler",
		Type:       domain.StationTypeMachine,
		Config:     map[string]interface{}{},
		EntryCount: 1,
		ExitCount:  1,
		SubScenario: &domain.SubScenario{
			Stations: []domain.Station{
				makeStation("entry-0", domain.StationTypeEntry),
				makeStation("process-1", domain.StationTypeProcessing),
				makeStation("exit-0", domain.StationTypeExit),
			},
			Connections: []domain.Connection{
				{From: "entry-0", To: "process-1"},
				{From: "process-1", To: "exit-0"},
			},
		},
	}

	scenario := &domain.Scenario{
		ID:   "test-nested",
		Name: "Nested",
		Stations: []domain.Station{
			makeStation("source-1", domain.StationTypeSource),
			{
				ID:         "outer-moduler",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 1,
				ExitCount:  1,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						makeStation("entry-0", domain.StationTypeEntry),
						innerModuler,
						makeStation("exit-0", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "inner-moduler", ToPortIndex: 0},
						{From: "inner-moduler", To: "exit-0", FromPortIndex: 0},
					},
				},
			},
			makeStation("drain-1", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "source-1", To: "outer-moduler", ToPortIndex: 0},
			{From: "outer-moduler", To: "drain-1", FromPortIndex: 0},
		},
	}

	result := FlattenScenario(scenario)

	// Expected stations:
	// source-1, outer-moduler, outer-moduler.entry-0,
	// outer-moduler.inner-moduler, outer-moduler.inner-moduler.entry-0,
	// outer-moduler.inner-moduler.process-1, outer-moduler.inner-moduler.exit-0,
	// outer-moduler.exit-0, drain-1
	expectedIDs := []string{
		"source-1",
		"outer-moduler",
		"outer-moduler.entry-0",
		"outer-moduler.inner-moduler",
		"outer-moduler.inner-moduler.entry-0",
		"outer-moduler.inner-moduler.process-1",
		"outer-moduler.inner-moduler.exit-0",
		"outer-moduler.exit-0",
		"drain-1",
	}

	if len(result.Stations) != len(expectedIDs) {
		t.Errorf("expected %d stations, got %d", len(expectedIDs), len(result.Stations))
		for _, s := range result.Stations {
			t.Logf("  station: %s (%s)", s.ID, s.Type)
		}
	}

	for _, id := range expectedIDs {
		if findStation(result.Stations, id) == nil {
			t.Errorf("missing station: %s", id)
		}
	}

	// Check connection chain: source-1 -> outer-moduler.entry-0
	s1Conns := findConnectionsFrom(result.Connections, "source-1")
	if len(s1Conns) != 1 || s1Conns[0].To != "outer-moduler.entry-0" {
		t.Errorf("source-1 should -> outer-moduler.entry-0, got %v", s1Conns)
	}

	// outer-moduler.entry-0 -> outer-moduler.inner-moduler.entry-0
	entryConns := findConnectionsFrom(result.Connections, "outer-moduler.entry-0")
	if len(entryConns) != 1 || entryConns[0].To != "outer-moduler.inner-moduler.entry-0" {
		t.Errorf("outer-moduler.entry-0 should -> outer-moduler.inner-moduler.entry-0, got %v", entryConns)
	}

	// outer-moduler.inner-moduler.exit-0 -> outer-moduler.exit-0
	innerExitConns := findConnectionsFrom(result.Connections, "outer-moduler.inner-moduler.exit-0")
	if len(innerExitConns) != 1 || innerExitConns[0].To != "outer-moduler.exit-0" {
		t.Errorf("inner exit should -> outer-moduler.exit-0, got %v", innerExitConns)
	}

	// outer-moduler.exit-0 -> drain-1
	drainConns := findConnectionsTo(result.Connections, "drain-1")
	if len(drainConns) != 1 || drainConns[0].From != "outer-moduler.exit-0" {
		t.Errorf("drain should receive from outer-moduler.exit-0, got %v", drainConns)
	}
}

func TestFlattenScenario_InterlockRuleStationIDRewrite(t *testing.T) {
	// Entry with interlock rule referencing internal station
	scenario := &domain.Scenario{
		ID:   "test-interlock",
		Name: "Interlock Rewrite",
		Stations: []domain.Station{
			makeStation("source-1", domain.StationTypeSource),
			{
				ID:         "moduler-1",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 1,
				ExitCount:  1,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						{
							ID:     "entry-0",
							Type:   domain.StationTypeEntry,
							Config: map[string]interface{}{},
							InterlockRules: &domain.InterlockConfig{
								Signals: []domain.SignalDef{
									{Name: "workPresent", Initial: false},
									{Name: "inputReady", Initial: true},
									{Name: "outputReady", Initial: false},
								},
								Rules: []domain.InterlockRule{
									{
										ID:     "custom-1",
										Target: "inputReady",
										Value:  false,
										Conditions: []domain.RuleCondition{
											{Signal: "workPresent", Value: true, StationID: "process-1"},
										},
									},
									{
										ID:     "custom-2",
										Target: "outputReady",
										Value:  true,
										Conditions: []domain.RuleCondition{
											{Signal: "workPresent", Value: true}, // self reference (empty StationID)
										},
									},
								},
							},
						},
						makeStation("process-1", domain.StationTypeProcessing),
						makeStation("exit-0", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "process-1"},
						{From: "process-1", To: "exit-0"},
					},
				},
			},
			makeStation("drain-1", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "source-1", To: "moduler-1", ToPortIndex: 0},
			{From: "moduler-1", To: "drain-1", FromPortIndex: 0},
		},
	}

	result := FlattenScenario(scenario)

	// Check the entry station's interlock rules have been prefixed
	entry := findStation(result.Stations, "moduler-1.entry-0")
	if entry == nil {
		t.Fatal("missing station moduler-1.entry-0")
	}
	if entry.InterlockRules == nil {
		t.Fatal("moduler-1.entry-0 should have InterlockRules")
	}
	if len(entry.InterlockRules.Rules) != 2 {
		t.Fatalf("expected 2 rules, got %d", len(entry.InterlockRules.Rules))
	}

	// Rule custom-1: StationID "process-1" -> "moduler-1.process-1"
	rule1 := entry.InterlockRules.Rules[0]
	if len(rule1.Conditions) != 1 {
		t.Fatalf("rule1 should have 1 condition, got %d", len(rule1.Conditions))
	}
	if rule1.Conditions[0].StationID != "moduler-1.process-1" {
		t.Errorf("rule1 condition StationID = %q, want 'moduler-1.process-1'", rule1.Conditions[0].StationID)
	}

	// Rule custom-2: empty StationID should remain empty (self-reference)
	rule2 := entry.InterlockRules.Rules[1]
	if len(rule2.Conditions) != 1 {
		t.Fatalf("rule2 should have 1 condition, got %d", len(rule2.Conditions))
	}
	if rule2.Conditions[0].StationID != "" {
		t.Errorf("rule2 condition StationID = %q, want empty (self)", rule2.Conditions[0].StationID)
	}
}

func TestFlattenScenario_ModulerStationSignals(t *testing.T) {
	// ModulerStation itself with custom interlock rules referencing internal stations
	scenario := &domain.Scenario{
		ID:   "test-moduler-signals",
		Name: "Moduler Signals",
		Stations: []domain.Station{
			makeStation("source-1", domain.StationTypeSource),
			{
				ID:     "moduler-1",
				Type:   domain.StationTypeMachine,
				Config: map[string]interface{}{},
				InterlockRules: &domain.InterlockConfig{
					Signals: []domain.SignalDef{
						{Name: "workPresent", Initial: false},
					},
					Rules: []domain.InterlockRule{
						{
							ID:     "R1",
							Target: "workPresent",
							Value:  true,
							Conditions: []domain.RuleCondition{
								{Signal: "workPresent", Value: true, StationID: "process-1"},
							},
						},
					},
				},
				EntryCount: 1,
				ExitCount:  1,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						makeStation("entry-0", domain.StationTypeEntry),
						makeStation("process-1", domain.StationTypeProcessing),
						makeStation("exit-0", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "process-1"},
						{From: "process-1", To: "exit-0"},
					},
				},
			},
			makeStation("drain-1", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "source-1", To: "moduler-1", ToPortIndex: 0},
			{From: "moduler-1", To: "drain-1", FromPortIndex: 0},
		},
	}

	result := FlattenScenario(scenario)

	// ModulerStation itself should be in the result
	moduler := findStation(result.Stations, "moduler-1")
	if moduler == nil {
		t.Fatal("missing station moduler-1")
	}

	// ModulerStation's interlock rules should NOT be prefixed
	// because the moduler station's rules reference internal stations relative to itself,
	// and the prefix for internal stations is "moduler-1.", so "process-1" -> "moduler-1.process-1"
	if moduler.InterlockRules == nil {
		t.Fatal("moduler-1 should have InterlockRules")
	}

	// ModulerStation's own rules reference internal stations by relative ID.
	// After flattening, internal stations are "moduler-1.process-1",
	// so the rules must be prefixed.
	rule := moduler.InterlockRules.Rules[0]
	if rule.Conditions[0].StationID != "moduler-1.process-1" {
		t.Errorf("moduler-1 rule R1 StationID = %q, want 'moduler-1.process-1'", rule.Conditions[0].StationID)
	}
}

func TestFlattenScenario_ConnectionPortIndexNormalization(t *testing.T) {
	// Verify PortIndex is set to -1 after rewrite
	scenario := &domain.Scenario{
		ID: "test-port-norm",
		Stations: []domain.Station{
			makeStation("source-1", domain.StationTypeSource),
			{
				ID:         "moduler-1",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 2,
				ExitCount:  2,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						makeStation("entry-0", domain.StationTypeEntry),
						makeStation("entry-1", domain.StationTypeEntry),
						makeStation("exit-0", domain.StationTypeExit),
						makeStation("exit-1", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "exit-0"},
						{From: "entry-1", To: "exit-1"},
					},
				},
			},
			makeStation("drain-1", domain.StationTypeDrain),
			makeStation("drain-2", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "source-1", To: "moduler-1", FromPortIndex: -1, ToPortIndex: 1},
			{From: "moduler-1", To: "drain-1", FromPortIndex: 0, ToPortIndex: -1},
			{From: "moduler-1", To: "drain-2", FromPortIndex: 1, ToPortIndex: -1},
		},
	}

	result := FlattenScenario(scenario)

	// source-1 -> moduler-1.entry-1 (toPortIndex was 1)
	s1Conns := findConnectionsFrom(result.Connections, "source-1")
	if len(s1Conns) != 1 {
		t.Fatalf("expected 1 connection from source-1, got %d", len(s1Conns))
	}
	if s1Conns[0].To != "moduler-1.entry-1" {
		t.Errorf("source-1 -> %s, want moduler-1.entry-1", s1Conns[0].To)
	}
	if s1Conns[0].ToPortIndex != -1 {
		t.Errorf("ToPortIndex = %d, want -1", s1Conns[0].ToPortIndex)
	}

	// moduler-1.exit-0 -> drain-1 (fromPortIndex was 0)
	d1Conns := findConnectionsTo(result.Connections, "drain-1")
	if len(d1Conns) != 1 {
		t.Fatalf("expected 1 connection to drain-1, got %d", len(d1Conns))
	}
	if d1Conns[0].From != "moduler-1.exit-0" {
		t.Errorf("%s -> drain-1, want moduler-1.exit-0", d1Conns[0].From)
	}
	if d1Conns[0].FromPortIndex != -1 {
		t.Errorf("FromPortIndex = %d, want -1", d1Conns[0].FromPortIndex)
	}

	// moduler-1.exit-1 -> drain-2 (fromPortIndex was 1)
	d2Conns := findConnectionsTo(result.Connections, "drain-2")
	if len(d2Conns) != 1 {
		t.Fatalf("expected 1 connection to drain-2, got %d", len(d2Conns))
	}
	if d2Conns[0].From != "moduler-1.exit-1" {
		t.Errorf("%s -> drain-2, want moduler-1.exit-1", d2Conns[0].From)
	}
}

func TestFlattenScenario_EmptySubScenario(t *testing.T) {
	// ModulerStation with nil SubScenario (edge case)
	scenario := &domain.Scenario{
		ID: "test-empty",
		Stations: []domain.Station{
			makeStation("source-1", domain.StationTypeSource),
			{
				ID:         "moduler-1",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 1,
				ExitCount:  1,
				// SubScenario is nil
			},
			makeStation("drain-1", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "source-1", To: "moduler-1", ToPortIndex: 0},
			{From: "moduler-1", To: "drain-1", FromPortIndex: 0},
		},
	}

	result := FlattenScenario(scenario)

	// Should have 5 stations: source-1, moduler-1, moduler-1.entry-0, moduler-1.exit-0, drain-1
	if len(result.Stations) != 5 {
		t.Errorf("expected 5 stations, got %d", len(result.Stations))
		for _, s := range result.Stations {
			t.Logf("  station: %s (type=%s)", s.ID, s.Type)
		}
	}

	// Stub entry/exit stations should exist
	if s := findStation(result.Stations, "moduler-1.entry-0"); s == nil {
		t.Error("missing stub station moduler-1.entry-0")
	} else if s.Type != domain.StationTypeEntry {
		t.Errorf("moduler-1.entry-0 type = %s, want entry", s.Type)
	}
	if s := findStation(result.Stations, "moduler-1.exit-0"); s == nil {
		t.Error("missing stub station moduler-1.exit-0")
	} else if s.Type != domain.StationTypeExit {
		t.Errorf("moduler-1.exit-0 type = %s, want exit", s.Type)
	}

	// Connections should be rewritten to entry/exit format
	s1Conns := findConnectionsFrom(result.Connections, "source-1")
	if len(s1Conns) != 1 || s1Conns[0].To != "moduler-1.entry-0" {
		t.Errorf("connection rewrite unexpected: %v", s1Conns)
	}

	// Internal connection entry→exit should exist
	entryConns := findConnectionsFrom(result.Connections, "moduler-1.entry-0")
	if len(entryConns) != 1 || entryConns[0].To != "moduler-1.exit-0" {
		t.Errorf("expected internal connection entry-0→exit-0, got: %v", entryConns)
	}

	// InternalStationIDs should be set
	moduler := findStation(result.Stations, "moduler-1")
	if moduler == nil {
		t.Fatal("missing moduler-1")
	}
	if len(moduler.InternalStationIDs) != 2 {
		t.Errorf("expected 2 InternalStationIDs, got %d: %v", len(moduler.InternalStationIDs), moduler.InternalStationIDs)
	}
}

func TestFlattenScenario_ModulerToModulerDirect(t *testing.T) {
	// Two ModulerStations connected directly: ModulerA.exit -> ModulerB.entry
	scenario := &domain.Scenario{
		ID: "test-direct",
		Stations: []domain.Station{
			makeStation("source-1", domain.StationTypeSource),
			{
				ID:         "moduler-a",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 1,
				ExitCount:  1,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						makeStation("entry-0", domain.StationTypeEntry),
						makeStation("process-1", domain.StationTypeProcessing),
						makeStation("exit-0", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "process-1"},
						{From: "process-1", To: "exit-0"},
					},
				},
			},
			{
				ID:         "moduler-b",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 1,
				ExitCount:  1,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						makeStation("entry-0", domain.StationTypeEntry),
						makeStation("process-2", domain.StationTypeProcessing),
						makeStation("exit-0", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "process-2"},
						{From: "process-2", To: "exit-0"},
					},
				},
			},
			makeStation("drain-1", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "source-1", To: "moduler-a", ToPortIndex: 0},
			{From: "moduler-a", To: "moduler-b", FromPortIndex: 0, ToPortIndex: 0},
			{From: "moduler-b", To: "drain-1", FromPortIndex: 0},
		},
	}

	result := FlattenScenario(scenario)

	// Check moduler-a.exit-0 -> moduler-b.entry-0
	exitAConns := findConnectionsFrom(result.Connections, "moduler-a.exit-0")
	if len(exitAConns) != 1 {
		t.Fatalf("expected 1 connection from moduler-a.exit-0, got %d", len(exitAConns))
	}
	if exitAConns[0].To != "moduler-b.entry-0" {
		t.Errorf("moduler-a.exit-0 -> %s, want moduler-b.entry-0", exitAConns[0].To)
	}
	if exitAConns[0].FromPortIndex != -1 || exitAConns[0].ToPortIndex != -1 {
		t.Errorf("PortIndices should be -1, got from=%d, to=%d", exitAConns[0].FromPortIndex, exitAConns[0].ToPortIndex)
	}
}

func TestFlattenScenario_RoutingConditionPreserved(t *testing.T) {
	// Connection with routing condition should preserve it after rewrite
	scenario := &domain.Scenario{
		ID: "test-routing",
		Stations: []domain.Station{
			{
				ID:         "moduler-1",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 1,
				ExitCount:  1,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						makeStation("entry-0", domain.StationTypeEntry),
						makeStation("exit-0", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "exit-0"},
					},
				},
			},
			makeStation("drain-ok", domain.StationTypeDrain),
			makeStation("drain-ng", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "moduler-1", To: "drain-ok", FromPortIndex: 0, Condition: domain.RoutingQualityOK},
			{From: "moduler-1", To: "drain-ng", FromPortIndex: 0, Condition: domain.RoutingQualityNG},
		},
	}

	result := FlattenScenario(scenario)

	okConns := findConnectionsTo(result.Connections, "drain-ok")
	if len(okConns) != 1 || okConns[0].Condition != domain.RoutingQualityOK {
		t.Errorf("quality_ok routing condition not preserved: %v", okConns)
	}

	ngConns := findConnectionsTo(result.Connections, "drain-ng")
	if len(ngConns) != 1 || ngConns[0].Condition != domain.RoutingQualityNG {
		t.Errorf("quality_ng routing condition not preserved: %v", ngConns)
	}
}

func TestFlattenScenario_DefaultPortIndexHandling(t *testing.T) {
	// Connection to ModulerStation without explicit PortIndex (defaults to -1)
	scenario := &domain.Scenario{
		ID: "test-default-port",
		Stations: []domain.Station{
			makeStation("source-1", domain.StationTypeSource),
			{
				ID:         "moduler-1",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 1,
				ExitCount:  1,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						makeStation("entry-0", domain.StationTypeEntry),
						makeStation("exit-0", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "exit-0"},
					},
				},
			},
			makeStation("drain-1", domain.StationTypeDrain),
		},
		Connections: []domain.Connection{
			{From: "source-1", To: "moduler-1", ToPortIndex: -1},   // no explicit port
			{From: "moduler-1", To: "drain-1", FromPortIndex: -1}, // no explicit port
		},
	}

	result := FlattenScenario(scenario)

	// Should default to entry-0 / exit-0
	s1Conns := findConnectionsFrom(result.Connections, "source-1")
	if len(s1Conns) != 1 || s1Conns[0].To != "moduler-1.entry-0" {
		t.Errorf("default port should map to entry-0, got %v", s1Conns)
	}

	d1Conns := findConnectionsTo(result.Connections, "drain-1")
	if len(d1Conns) != 1 || d1Conns[0].From != "moduler-1.exit-0" {
		t.Errorf("default port should map to exit-0, got %v", d1Conns)
	}
}

func TestFlattenScenario_ConfigInterlockRulesRawRewrite(t *testing.T) {
	// Test that config-embedded interlock rules (raw JSON) also get StationID rewritten
	scenario := &domain.Scenario{
		ID: "test-raw-rewrite",
		Stations: []domain.Station{
			{
				ID:         "moduler-1",
				Type:       domain.StationTypeMachine,
				Config:     map[string]interface{}{},
				EntryCount: 1,
				ExitCount:  1,
				SubScenario: &domain.SubScenario{
					Stations: []domain.Station{
						{
							ID:   "entry-0",
							Type: domain.StationTypeEntry,
							Config: map[string]interface{}{
								"interlockRules": map[string]interface{}{
									"signals": []interface{}{
										map[string]interface{}{"name": "workPresent", "initial": false},
									},
									"rules": []interface{}{
										map[string]interface{}{
											"id":     "R1",
											"target": "inputReady",
											"value":  false,
											"conditions": []interface{}{
												map[string]interface{}{
													"signal":    "workPresent",
													"value":     true,
													"stationId": "process-1",
												},
											},
										},
									},
								},
							},
						},
						makeStation("process-1", domain.StationTypeProcessing),
						makeStation("exit-0", domain.StationTypeExit),
					},
					Connections: []domain.Connection{
						{From: "entry-0", To: "process-1"},
						{From: "process-1", To: "exit-0"},
					},
				},
			},
		},
		Connections: []domain.Connection{},
	}

	result := FlattenScenario(scenario)

	entry := findStation(result.Stations, "moduler-1.entry-0")
	if entry == nil {
		t.Fatal("missing station moduler-1.entry-0")
	}

	// Check the raw config interlock rules were rewritten
	ilRaw, ok := entry.Config["interlockRules"]
	if !ok {
		t.Fatal("missing interlockRules in config")
	}
	ilMap, ok := ilRaw.(map[string]interface{})
	if !ok {
		t.Fatal("interlockRules is not a map")
	}
	rules, ok := ilMap["rules"].([]interface{})
	if !ok || len(rules) == 0 {
		t.Fatal("no rules in config interlockRules")
	}
	rule := rules[0].(map[string]interface{})
	conds := rule["conditions"].([]interface{})
	cond := conds[0].(map[string]interface{})
	stationID, _ := cond["stationId"].(string)
	if stationID != "moduler-1.process-1" {
		t.Errorf("raw config stationId = %q, want 'moduler-1.process-1'", stationID)
	}
}
