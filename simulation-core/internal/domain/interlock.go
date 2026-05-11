package domain

import "fmt"

// 10-signal name constants
const (
	SignalInputWorkPresent      = "inputWorkPresent"
	SignalProcessingWorkPresent = "processingWorkPresent"
	SignalOutputWorkPresent     = "outputWorkPresent"
	SignalRunning               = "running"
	SignalComplete              = "complete"
	SignalProcessReady          = "processReady"
	SignalInputReady            = "inputReady"
	SignalOutputReady           = "outputReady"
	SignalWorkFull              = "workFull"
	SignalWorkEmpty             = "workEmpty"
)

// Derived signal name constants (Merge/Split)
const (
	SignalAllPortsFull  = "allPortsFull"  // ALL(InPorts[1+] full) — Merge
	SignalAllPortsEmpty = "allPortsEmpty" // ALL(OutPorts[1+] empty) — Split
)

// Dynamic derived signal name helpers (portNFull, portNEmpty, portNHasWork)
// These are generated at runtime based on port count, e.g. "port1Full", "port2Empty"

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
	StationID string `json:"stationId,omitempty"`
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

// tenSignals returns the standard 10 signals (all initial=false)
func tenSignals() []SignalDef {
	return []SignalDef{
		{Name: SignalInputWorkPresent, Initial: false},
		{Name: SignalProcessingWorkPresent, Initial: false},
		{Name: SignalOutputWorkPresent, Initial: false},
		{Name: SignalRunning, Initial: false},
		{Name: SignalComplete, Initial: false},
		{Name: SignalProcessReady, Initial: false},
		{Name: SignalInputReady, Initial: false},
		{Name: SignalOutputReady, Initial: false},
		{Name: SignalWorkFull, Initial: false},
		{Name: SignalWorkEmpty, Initial: false},
	}
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
	case StationTypeMerge:
		return getMergeDefaultConfig()
	case StationTypeSplit:
		return getSplitDefaultConfig()
	case StationTypeSwitch:
		return getSwitchDefaultConfig()
	case StationTypeEntry:
		return getEntryDefaultConfig()
	case StationTypeExit:
		return getExitDefaultConfig()
	case StationTypeModuler:
		return getModulerDefaultConfig()
	default:
		return getProcessingDefaultConfig()
	}
}

func getSourceDefaultConfig() *InterlockConfig {
	return &InterlockConfig{
		Signals: tenSignals(),
		Rules: []InterlockRule{
			{
				ID: "R1", Description: "ワーク生成済み → 搬出可ON",
				Target: SignalOutputReady, Value: true,
				Conditions: []RuleCondition{{Signal: SignalOutputWorkPresent, Value: true}},
			},
			{
				ID: "R2", Description: "ワークなし → 搬出可OFF",
				Target: SignalOutputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalOutputWorkPresent, Value: false}},
			},
		},
	}
}

func getProcessingDefaultConfig() *InterlockConfig {
	return &InterlockConfig{
		Signals: tenSignals(),
		Rules: []InterlockRule{
			{
				ID: "R1", Description: "空きステーション → 搬入可ON",
				Target: SignalInputReady, Value: true,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: false}},
			},
			{
				ID: "R2", Description: "ワーク受入済 → 搬入可OFF",
				Target: SignalInputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: true}},
			},
			{
				ID: "R3", Description: "ワーク到着 → 加工準備ON",
				Target: SignalProcessReady, Value: true,
				Conditions: []RuleCondition{
					{Signal: SignalInputWorkPresent, Value: true},
					{Signal: SignalRunning, Value: false},
					{Signal: SignalComplete, Value: false},
				},
			},
			{
				ID: "R4", Description: "加工中 → 加工準備OFF",
				Target: SignalProcessReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalRunning, Value: true}},
			},
			{
				ID: "R5", Description: "処理完了 → 搬出可ON",
				Target: SignalOutputReady, Value: true,
				Conditions: []RuleCondition{
					{Signal: SignalComplete, Value: true},
					{Signal: SignalOutputWorkPresent, Value: true},
				},
			},
			{
				ID: "R6", Description: "ワーク搬出済 → 搬出可OFF",
				Target: SignalOutputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalOutputWorkPresent, Value: false}},
			},
		},
	}
}

func getMergeDefaultConfig() *InterlockConfig {
	signals := tenSignals()
	signals = append(signals, SignalDef{Name: SignalAllPortsFull, Initial: false})
	return &InterlockConfig{
		Signals: signals,
		Rules: []InterlockRule{
			{
				ID: "R1", Description: "全ポート満杯 → 加工準備ON",
				Target: SignalProcessReady, Value: true,
				Conditions: []RuleCondition{
					{Signal: SignalAllPortsFull, Value: true},
					{Signal: SignalRunning, Value: false},
					{Signal: SignalComplete, Value: false},
				},
			},
			{
				ID: "R2", Description: "加工中 → 加工準備OFF",
				Target: SignalProcessReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalRunning, Value: true}},
			},
			{
				ID: "R3", Description: "結合処理完了 → 搬出可ON",
				Target: SignalOutputReady, Value: true,
				Conditions: []RuleCondition{
					{Signal: SignalComplete, Value: true},
					{Signal: SignalOutputWorkPresent, Value: true},
				},
			},
			{
				ID: "R4", Description: "ワーク搬出済 → 搬出可OFF",
				Target: SignalOutputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalOutputWorkPresent, Value: false}},
			},
		},
	}
}

func getSplitDefaultConfig() *InterlockConfig {
	signals := tenSignals()
	signals = append(signals, SignalDef{Name: SignalAllPortsEmpty, Initial: true})
	return &InterlockConfig{
		Signals: signals,
		Rules: []InterlockRule{
			{
				ID: "R1", Description: "全ポート空 → 搬入可ON",
				Target: SignalInputReady, Value: true,
				Conditions: []RuleCondition{
					{Signal: SignalAllPortsEmpty, Value: true},
					{Signal: SignalInputWorkPresent, Value: false},
					{Signal: SignalRunning, Value: false},
					{Signal: SignalComplete, Value: false},
				},
			},
			{
				ID: "R2", Description: "ワーク受入済 → 搬入可OFF",
				Target: SignalInputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: true}},
			},
			{
				ID: "R3", Description: "ワーク到着 → 加工準備ON",
				Target: SignalProcessReady, Value: true,
				Conditions: []RuleCondition{
					{Signal: SignalInputWorkPresent, Value: true},
					{Signal: SignalRunning, Value: false},
					{Signal: SignalComplete, Value: false},
				},
			},
			{
				ID: "R4", Description: "加工中 → 加工準備OFF",
				Target: SignalProcessReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalRunning, Value: true}},
			},
		},
	}
}

// GetDefaultMergePortInterlockConfig returns the default interlock config for a merge input port
func GetDefaultMergePortInterlockConfig() *InterlockConfig {
	return &InterlockConfig{
		Signals: []SignalDef{
			{Name: SignalInputWorkPresent, Initial: false},
			{Name: SignalInputReady, Initial: false},
		},
		Rules: []InterlockRule{
			{
				ID: "R1", Description: "ワークなし → 搬入可ON",
				Target: SignalInputReady, Value: true,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: false}},
			},
			{
				ID: "R2", Description: "ワークあり → 搬入可OFF",
				Target: SignalInputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: true}},
			},
		},
	}
}

// GetDefaultSplitPortInterlockConfig returns the default interlock config for a split output port
func GetDefaultSplitPortInterlockConfig() *InterlockConfig {
	return &InterlockConfig{
		Signals: []SignalDef{
			{Name: SignalOutputWorkPresent, Initial: false},
			{Name: SignalOutputReady, Initial: false},
		},
		Rules: []InterlockRule{
			{
				ID: "R1", Description: "ワーク有り → 搬出可ON",
				Target: SignalOutputReady, Value: true,
				Conditions: []RuleCondition{{Signal: SignalOutputWorkPresent, Value: true}},
			},
			{
				ID: "R2", Description: "ワークなし → 搬出可OFF",
				Target: SignalOutputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalOutputWorkPresent, Value: false}},
			},
		},
	}
}

func getEntryDefaultConfig() *InterlockConfig {
	return &InterlockConfig{
		Signals: tenSignals(),
		Rules: []InterlockRule{
			{
				ID: "R1", Description: "ワーク到着 → 搬出可ON",
				Target: SignalOutputReady, Value: true,
				Conditions: []RuleCondition{{Signal: SignalOutputWorkPresent, Value: true}},
			},
			{
				ID: "R2", Description: "ワーク出発 → 搬出可OFF",
				Target: SignalOutputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalOutputWorkPresent, Value: false}},
			},
			{
				ID: "R3", Description: "空き → 搬入可ON",
				Target: SignalInputReady, Value: true,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: false}},
			},
			{
				ID: "R4", Description: "ワーク有り → 搬入可OFF",
				Target: SignalInputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: true}},
			},
		},
	}
}

func getExitDefaultConfig() *InterlockConfig {
	return getEntryDefaultConfig()
}

func getSwitchDefaultConfig() *InterlockConfig {
	return getEntryDefaultConfig()
}

func getModulerDefaultConfig() *InterlockConfig {
	return &InterlockConfig{
		Signals: tenSignals(),
		Rules: []InterlockRule{
			{
				ID: "R1", Description: "空き → 搬入可ON",
				Target: SignalInputReady, Value: true,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: false}},
			},
			{
				ID: "R2", Description: "ワーク有り → 搬入可OFF",
				Target: SignalInputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: true}},
			},
			{
				ID: "R3", Description: "処理完了 → 搬出可ON",
				Target: SignalOutputReady, Value: true,
				Conditions: []RuleCondition{
					{Signal: SignalComplete, Value: true},
					{Signal: SignalOutputWorkPresent, Value: true},
				},
			},
			{
				ID: "R4", Description: "搬出完了 → 搬出可OFF",
				Target: SignalOutputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalOutputWorkPresent, Value: false}},
			},
		},
	}
}

func getDrainDefaultConfig() *InterlockConfig {
	return &InterlockConfig{
		Signals: tenSignals(),
		Rules: []InterlockRule{
			{
				ID: "R1", Description: "空き → 搬入可ON",
				Target: SignalInputReady, Value: true,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: false}},
			},
			{
				ID: "R2", Description: "ワーク有り → 搬入可OFF",
				Target: SignalInputReady, Value: false,
				Conditions: []RuleCondition{{Signal: SignalInputWorkPresent, Value: true}},
			},
		},
	}
}
