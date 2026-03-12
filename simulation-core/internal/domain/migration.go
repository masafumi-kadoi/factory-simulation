package domain

// signalMigrationMap maps old signal names to new 10-signal names.
var signalMigrationMap = map[string]string{
	"workPresent":       SignalInputWorkPresent,
	"processingComplete": SignalComplete,
	"mergeReady":        SignalProcessReady,
	"stationStop":       SignalRunning,
	"stationProcessing": SignalRunning,
	"portFull":          SignalInputWorkPresent,
}

// newSignalNames is the set of valid 10-signal names.
var newSignalNames = map[string]bool{
	SignalInputWorkPresent:      true,
	SignalProcessingWorkPresent: true,
	SignalOutputWorkPresent:     true,
	SignalRunning:               true,
	SignalComplete:              true,
	SignalProcessReady:          true,
	SignalInputReady:            true,
	SignalOutputReady:           true,
	SignalWorkFull:              true,
	SignalWorkEmpty:             true,
}

// NeedsMigration checks if an InterlockConfig uses old signal names.
func NeedsMigration(config *InterlockConfig) bool {
	if config == nil {
		return false
	}
	for _, sig := range config.Signals {
		if _, isOld := signalMigrationMap[sig.Name]; isOld {
			return true
		}
	}
	return false
}

// MigrateInterlockRules migrates an InterlockConfig from old signal names to the 10-signal model.
// Returns true if migration was performed.
func MigrateInterlockRules(config *InterlockConfig) bool {
	if config == nil {
		return false
	}
	if !NeedsMigration(config) {
		return false
	}

	// Migrate signals
	migratedSignals := make([]SignalDef, 0, len(config.Signals))
	seen := make(map[string]bool)
	for _, sig := range config.Signals {
		newName := migrateSignalName(sig.Name)
		if !seen[newName] {
			seen[newName] = true
			migratedSignals = append(migratedSignals, SignalDef{Name: newName, Initial: sig.Initial})
		}
	}
	// Ensure all 10 signals are present
	for _, sig := range tenSignals() {
		if !seen[sig.Name] {
			seen[sig.Name] = true
			migratedSignals = append(migratedSignals, sig)
		}
	}
	config.Signals = migratedSignals

	// Migrate rules: update signal names in conditions and targets, remove old R5 rules
	migratedRules := make([]InterlockRule, 0, len(config.Rules))
	for _, rule := range config.Rules {
		// Remove R5-type rules (target=processingComplete, value=false)
		if rule.Target == "processingComplete" && !rule.Value {
			continue
		}

		rule.Target = migrateSignalName(rule.Target)
		for i := range rule.Conditions {
			rule.Conditions[i].Signal = migrateSignalName(rule.Conditions[i].Signal)
		}
		migratedRules = append(migratedRules, rule)
	}
	config.Rules = migratedRules

	return true
}

// MigrateScenario migrates all interlock rules in a scenario.
func MigrateScenario(scenario *Scenario) {
	if scenario == nil {
		return
	}
	for i := range scenario.Stations {
		st := &scenario.Stations[i]
		if st.InterlockRules != nil {
			MigrateInterlockRules(st.InterlockRules)
		}
		// Migrate port interlock rules
		for j := range st.Ports {
			if st.Ports[j].InterlockRules != nil {
				MigrateInterlockRules(st.Ports[j].InterlockRules)
			}
		}
	}
}

func migrateSignalName(name string) string {
	if newName, ok := signalMigrationMap[name]; ok {
		return newName
	}
	return name
}
