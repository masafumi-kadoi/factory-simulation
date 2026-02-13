package domain

import "fmt"

// InterlockConfig represents the signal-based interlock configuration for a station
type InterlockConfig struct {
	Signals []SignalDef     `json:"signals"`
	Rules   []InterlockRule `json:"rules"`
}

// SignalDef represents a signal definition
type SignalDef struct {
	Name    string `json:"name"`
	Initial bool   `json:"initial"`
}

// InterlockRule represents a single interlock rule
type InterlockRule struct {
	ID          string          `json:"id,omitempty"`
	Description string          `json:"description,omitempty"`
	Target      string          `json:"target"`
	Value       bool            `json:"value"`
	Conditions  []RuleCondition `json:"conditions,omitempty"`
}

// RuleCondition represents a condition within a rule
type RuleCondition struct {
	Signal    string `json:"signal"`
	Value     bool   `json:"value"`
	StationID string `json:"stationId,omitempty"` // empty = self station
}

// Validate validates the interlock rule
func (r *InterlockRule) Validate() error {
	if r.Target == "" {
		return fmt.Errorf("rule target is required")
	}
	if len(r.Conditions) == 0 {
		return fmt.Errorf("rule must have at least one condition")
	}
	return nil
}

// HasSignal checks if a signal is defined in the config
func (c *InterlockConfig) HasSignal(name string) bool {
	for _, sig := range c.Signals {
		if sig.Name == name {
			return true
		}
	}
	return false
}

// GetDefaultInterlockConfig returns the default interlock configuration for a station type
func GetDefaultInterlockConfig(stationType StationType) *InterlockConfig {
	switch stationType {
	case StationTypeSource:
		return getSourceDefaultConfig()
	case StationTypeProcessing:
		return getProcessingDefaultConfig()
	case StationTypeDrain:
		return getDrainDefaultConfig()
	default:
		return getProcessingDefaultConfig()
	}
}

func getSourceDefaultConfig() *InterlockConfig {
	return &InterlockConfig{
		Signals: []SignalDef{
			{Name: "workPresent", Initial: false},
			{Name: "outputReady", Initial: false},
		},
		Rules: []InterlockRule{
			{
				ID:          "R1",
				Description: "ワーク生成済み → 搬出可ON",
				Target:      "outputReady",
				Value:       true,
				Conditions:  []RuleCondition{{Signal: "workPresent", Value: true}},
			},
			{
				ID:          "R2",
				Description: "ワークなし → 搬出可OFF",
				Target:      "outputReady",
				Value:       false,
				Conditions:  []RuleCondition{{Signal: "workPresent", Value: false}},
			},
		},
	}
}

func getProcessingDefaultConfig() *InterlockConfig {
	return &InterlockConfig{
		Signals: []SignalDef{
			{Name: "workPresent", Initial: false},
			{Name: "processingComplete", Initial: false},
			{Name: "inputReady", Initial: false},
			{Name: "outputReady", Initial: false},
		},
		Rules: []InterlockRule{
			{
				ID:          "R1",
				Description: "空きステーション → 搬入可ON",
				Target:      "inputReady",
				Value:       true,
				Conditions: []RuleCondition{
					{Signal: "processingComplete", Value: false},
					{Signal: "workPresent", Value: false},
				},
			},
			{
				ID:          "R2",
				Description: "ワーク受入済 → 搬入可OFF",
				Target:      "inputReady",
				Value:       false,
				Conditions: []RuleCondition{
					{Signal: "processingComplete", Value: false},
					{Signal: "workPresent", Value: true},
				},
			},
			{
				ID:          "R3",
				Description: "処理完了 → 搬出可ON",
				Target:      "outputReady",
				Value:       true,
				Conditions: []RuleCondition{
					{Signal: "processingComplete", Value: true},
					{Signal: "workPresent", Value: true},
				},
			},
			{
				ID:          "R4",
				Description: "ワーク搬出済 → 搬出可OFF",
				Target:      "outputReady",
				Value:       false,
				Conditions: []RuleCondition{
					{Signal: "processingComplete", Value: true},
					{Signal: "workPresent", Value: false},
				},
			},
			{
				ID:          "R5",
				Description: "搬出完了リセット → 処理完了OFF",
				Target:      "processingComplete",
				Value:       false,
				Conditions: []RuleCondition{
					{Signal: "processingComplete", Value: true},
					{Signal: "workPresent", Value: false},
					{Signal: "outputReady", Value: false},
				},
			},
		},
	}
}

func getDrainDefaultConfig() *InterlockConfig {
	return &InterlockConfig{
		Signals: []SignalDef{
			{Name: "workPresent", Initial: false},
			{Name: "inputReady", Initial: false},
		},
		Rules: []InterlockRule{
			{
				ID:          "R1",
				Description: "空き → 搬入可ON",
				Target:      "inputReady",
				Value:       true,
				Conditions:  []RuleCondition{{Signal: "workPresent", Value: false}},
			},
			{
				ID:          "R2",
				Description: "ワーク有り → 搬入可OFF",
				Target:      "inputReady",
				Value:       false,
				Conditions:  []RuleCondition{{Signal: "workPresent", Value: true}},
			},
		},
	}
}
