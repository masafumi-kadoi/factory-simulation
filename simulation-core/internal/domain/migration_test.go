package domain

import "testing"

func TestNeedsMigration_OldSignals(t *testing.T) {
	config := &InterlockConfig{
		Signals: []SignalDef{
			{Name: "workPresent", Initial: false},
			{Name: "processingComplete", Initial: false},
			{Name: "inputReady", Initial: false},
			{Name: "outputReady", Initial: false},
		},
	}
	if !NeedsMigration(config) {
		t.Error("expected NeedsMigration=true for old signal names")
	}
}

func TestNeedsMigration_NewSignals(t *testing.T) {
	config := &InterlockConfig{
		Signals: tenSignals(),
	}
	if NeedsMigration(config) {
		t.Error("expected NeedsMigration=false for new signal names")
	}
}

func TestNeedsMigration_Nil(t *testing.T) {
	if NeedsMigration(nil) {
		t.Error("expected NeedsMigration=false for nil config")
	}
}

func TestMigrateInterlockRules_SignalRename(t *testing.T) {
	config := &InterlockConfig{
		Signals: []SignalDef{
			{Name: "workPresent", Initial: false},
			{Name: "processingComplete", Initial: false},
			{Name: "inputReady", Initial: false},
			{Name: "outputReady", Initial: false},
		},
		Rules: []InterlockRule{
			{ID: "R1", Target: "inputReady", Value: true, Conditions: []RuleCondition{{Signal: "workPresent", Value: false}}},
			{ID: "R2", Target: "inputReady", Value: false, Conditions: []RuleCondition{{Signal: "workPresent", Value: true}}},
			{ID: "R3", Target: "outputReady", Value: true, Conditions: []RuleCondition{{Signal: "processingComplete", Value: true}, {Signal: "workPresent", Value: true}}},
		},
	}

	migrated := MigrateInterlockRules(config)
	if !migrated {
		t.Fatal("expected migration to be performed")
	}

	// Check signals: should have all 10
	if len(config.Signals) != 10 {
		t.Errorf("expected 10 signals, got %d", len(config.Signals))
	}

	// Check R1 condition migrated
	r1 := config.Rules[0]
	if r1.Conditions[0].Signal != SignalInputWorkPresent {
		t.Errorf("expected R1 condition signal=%s, got %s", SignalInputWorkPresent, r1.Conditions[0].Signal)
	}

	// Check R3 conditions migrated
	r3 := config.Rules[2]
	if r3.Conditions[0].Signal != SignalComplete {
		t.Errorf("expected R3 condition[0] signal=%s, got %s", SignalComplete, r3.Conditions[0].Signal)
	}
	if r3.Conditions[1].Signal != SignalInputWorkPresent {
		t.Errorf("expected R3 condition[1] signal=%s, got %s", SignalInputWorkPresent, r3.Conditions[1].Signal)
	}
}

func TestMigrateInterlockRules_R5Removal(t *testing.T) {
	config := &InterlockConfig{
		Signals: []SignalDef{
			{Name: "workPresent", Initial: false},
			{Name: "processingComplete", Initial: false},
			{Name: "inputReady", Initial: false},
			{Name: "outputReady", Initial: false},
		},
		Rules: []InterlockRule{
			{ID: "R1", Target: "inputReady", Value: true, Conditions: []RuleCondition{{Signal: "workPresent", Value: false}}},
			{ID: "R5", Target: "processingComplete", Value: false, Conditions: []RuleCondition{{Signal: "processingComplete", Value: true}, {Signal: "workPresent", Value: false}}},
		},
	}

	MigrateInterlockRules(config)

	// R5 should be removed
	for _, rule := range config.Rules {
		if rule.Target == "processingComplete" || rule.Target == SignalComplete {
			if !rule.Value {
				t.Errorf("expected R5 (target=processingComplete/complete, value=false) to be removed, but found rule: %+v", rule)
			}
		}
	}
	if len(config.Rules) != 1 {
		t.Errorf("expected 1 rule after R5 removal, got %d", len(config.Rules))
	}
}

func TestMigrateInterlockRules_MergeReady(t *testing.T) {
	config := &InterlockConfig{
		Signals: []SignalDef{
			{Name: "workPresent", Initial: false},
			{Name: "mergeReady", Initial: false},
			{Name: "inputReady", Initial: false},
		},
		Rules: []InterlockRule{
			{ID: "R1", Target: "inputReady", Value: false, Conditions: []RuleCondition{{Signal: "mergeReady", Value: true}}},
		},
	}

	MigrateInterlockRules(config)

	if config.Rules[0].Conditions[0].Signal != SignalProcessReady {
		t.Errorf("expected mergeReady→processReady, got %s", config.Rules[0].Conditions[0].Signal)
	}
}

func TestMigrateInterlockRules_EmptyConfig(t *testing.T) {
	config := &InterlockConfig{
		Signals: []SignalDef{},
		Rules:   []InterlockRule{},
	}

	migrated := MigrateInterlockRules(config)
	if migrated {
		t.Error("expected no migration for empty config (no old signals)")
	}
}

func TestMigrateInterlockRules_MixedOldNew(t *testing.T) {
	// Partially migrated: mix of old and new signal names
	config := &InterlockConfig{
		Signals: []SignalDef{
			{Name: "workPresent", Initial: false},     // old
			{Name: SignalInputReady, Initial: false},   // new
			{Name: SignalOutputReady, Initial: false},  // new
		},
		Rules: []InterlockRule{
			{ID: "R1", Target: SignalInputReady, Value: true, Conditions: []RuleCondition{{Signal: "workPresent", Value: false}}},
		},
	}

	migrated := MigrateInterlockRules(config)
	if !migrated {
		t.Fatal("expected migration for mixed old/new signals")
	}

	// Should have 10 signals (no duplicates)
	if len(config.Signals) != 10 {
		t.Errorf("expected 10 signals, got %d", len(config.Signals))
	}

	// R1 condition should be migrated
	if config.Rules[0].Conditions[0].Signal != SignalInputWorkPresent {
		t.Errorf("expected workPresent→inputWorkPresent, got %s", config.Rules[0].Conditions[0].Signal)
	}
}

func TestMigrateInterlockRules_OnlyDeletedSignals(t *testing.T) {
	// Custom rule that only uses signals targeted for deletion
	config := &InterlockConfig{
		Signals: []SignalDef{
			{Name: "stationStop", Initial: false},
			{Name: "stationProcessing", Initial: false},
		},
		Rules: []InterlockRule{
			{ID: "R1", Target: "stationStop", Value: true, Conditions: []RuleCondition{{Signal: "stationProcessing", Value: true}}},
		},
	}

	migrated := MigrateInterlockRules(config)
	if !migrated {
		t.Fatal("expected migration")
	}

	// stationStop and stationProcessing both map to running
	if config.Rules[0].Target != SignalRunning {
		t.Errorf("expected target=running, got %s", config.Rules[0].Target)
	}
	if config.Rules[0].Conditions[0].Signal != SignalRunning {
		t.Errorf("expected condition signal=running, got %s", config.Rules[0].Conditions[0].Signal)
	}
}

func TestMigrateInterlockRules_AlreadyMigrated(t *testing.T) {
	config := getProcessingDefaultConfig()

	migrated := MigrateInterlockRules(config)
	if migrated {
		t.Error("expected no migration for already-migrated config")
	}
}
