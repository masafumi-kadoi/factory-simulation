package domain

import "testing"

func TestGetDefaultInterlockConfig_Source(t *testing.T) {
	config := GetDefaultInterlockConfig(StationTypeSource)

	if config == nil {
		t.Fatal("expected non-nil config for source")
	}
	if len(config.Signals) != 2 {
		t.Errorf("expected 2 signals for source, got %d", len(config.Signals))
	}
	if len(config.Rules) != 2 {
		t.Errorf("expected 2 rules for source, got %d", len(config.Rules))
	}
	if !config.HasSignal("workPresent") {
		t.Error("expected workPresent signal")
	}
	if !config.HasSignal("outputReady") {
		t.Error("expected outputReady signal")
	}
}

func TestGetDefaultInterlockConfig_Processing(t *testing.T) {
	config := GetDefaultInterlockConfig(StationTypeProcessing)

	if config == nil {
		t.Fatal("expected non-nil config for processing")
	}
	if len(config.Signals) != 4 {
		t.Errorf("expected 4 signals for processing, got %d", len(config.Signals))
	}
	if len(config.Rules) != 5 {
		t.Errorf("expected 5 rules for processing, got %d", len(config.Rules))
	}

	expectedSignals := []string{"workPresent", "processingComplete", "inputReady", "outputReady"}
	for _, name := range expectedSignals {
		if !config.HasSignal(name) {
			t.Errorf("expected signal %s", name)
		}
	}
}

func TestGetDefaultInterlockConfig_Drain(t *testing.T) {
	config := GetDefaultInterlockConfig(StationTypeDrain)

	if config == nil {
		t.Fatal("expected non-nil config for drain")
	}
	if len(config.Signals) != 2 {
		t.Errorf("expected 2 signals for drain, got %d", len(config.Signals))
	}
	if len(config.Rules) != 2 {
		t.Errorf("expected 2 rules for drain, got %d", len(config.Rules))
	}
	if !config.HasSignal("workPresent") {
		t.Error("expected workPresent signal")
	}
	if !config.HasSignal("inputReady") {
		t.Error("expected inputReady signal")
	}
}

func TestInterlockRule_Validate(t *testing.T) {
	tests := []struct {
		name    string
		rule    InterlockRule
		wantErr bool
	}{
		{
			name: "valid rule",
			rule: InterlockRule{
				Target:     "inputReady",
				Value:      true,
				Conditions: []RuleCondition{{Signal: "workPresent", Value: false}},
			},
			wantErr: false,
		},
		{
			name: "empty target",
			rule: InterlockRule{
				Target:     "",
				Value:      true,
				Conditions: []RuleCondition{{Signal: "workPresent", Value: false}},
			},
			wantErr: true,
		},
		{
			name: "no conditions",
			rule: InterlockRule{
				Target:     "inputReady",
				Value:      true,
				Conditions: nil,
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.rule.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestInterlockConfig_HasSignal(t *testing.T) {
	config := &InterlockConfig{
		Signals: []SignalDef{
			{Name: "workPresent", Initial: false},
			{Name: "inputReady", Initial: false},
		},
	}

	if !config.HasSignal("workPresent") {
		t.Error("expected HasSignal to return true for workPresent")
	}
	if config.HasSignal("outputReady") {
		t.Error("expected HasSignal to return false for outputReady")
	}
}
