package simulation

import (
	"fmt"

	"factory-simulation/simulation-core/internal/domain"
)

// FlattenScenario recursively expands all ModulerStations into a flat list of stations and connections.
// The original ModulerStation is kept in the result (for signal evaluation) but its SubScenario
// internal stations are extracted with prefixed IDs (e.g., "moduler-1.entry-0").
// External connections to/from ModulerStations are rewritten to point directly at Entry/Exit stations.
func FlattenScenario(scenario *domain.Scenario) *domain.Scenario {
	flatStations, flatConnections := flattenStationsAndConnections(scenario.Stations, scenario.Connections, "")

	return &domain.Scenario{
		ID:          scenario.ID,
		Name:        scenario.Name,
		SimDBConfig: scenario.SimDBConfig,
		Stations:    flatStations,
		Connections: flatConnections,
		CreatedAt:   scenario.CreatedAt,
		UpdatedAt:   scenario.UpdatedAt,
	}
}

// flattenStationsAndConnections flattens stations and connections at one level,
// recursing into nested ModulerStations.
// prefix is the ID prefix for the current nesting level (empty for root).
func flattenStationsAndConnections(stations []domain.Station, connections []domain.Connection, prefix string) ([]domain.Station, []domain.Connection) {
	var flatStations []domain.Station
	var flatConnections []domain.Connection

	// Collect moduler station IDs for connection rewriting
	modulerStationIDs := make(map[string]*domain.Station)

	for i := range stations {
		st := stations[i]
		if st.Type == domain.StationTypeModuler {
			modulerStationIDs[st.ID] = &stations[i]
		}
	}

	// Process each station
	for i := range stations {
		st := stations[i]
		if st.Type != domain.StationTypeModuler {
			// Non-moduler station: add as-is
			flatStations = append(flatStations, st)
			continue
		}

		// ModulerStation: keep the station itself (for signal evaluation)
		// Clear SubScenario from the flattened copy to avoid confusion
		modulerCopy := st
		modulerCopy.SubScenario = nil
		// Prefix StationIDs in ModulerStation's own interlock rules
		// (these reference internal stations by relative ID)
		modulerPrefix := st.ID + "."
		if modulerCopy.InterlockRules != nil {
			modulerCopy.InterlockRules = prefixInterlockRules(modulerCopy.InterlockRules, modulerPrefix)
		}
		if ilRaw, ok := modulerCopy.Config["interlockRules"]; ok {
			modulerCopy.Config = copyConfig(modulerCopy.Config)
			modulerCopy.Config["interlockRules"] = prefixInterlockRulesRaw(ilRaw, modulerPrefix)
		}
		flatStations = append(flatStations, modulerCopy)

		if st.SubScenario == nil {
			continue
		}

		// Prefix internal station IDs (modulerPrefix already set above)
		internalStations := prefixStations(st.SubScenario.Stations, modulerPrefix)
		internalConnections := prefixConnections(st.SubScenario.Connections, modulerPrefix)

		// Recursively flatten (handles nested ModulerStations)
		nestedStations, nestedConnections := flattenStationsAndConnections(internalStations, internalConnections, modulerPrefix)
		flatStations = append(flatStations, nestedStations...)
		flatConnections = append(flatConnections, nestedConnections...)
	}

	// Rewrite external connections
	for _, conn := range connections {
		rewritten := rewriteConnection(conn, modulerStationIDs)
		flatConnections = append(flatConnections, rewritten...)
	}

	return flatStations, flatConnections
}

// prefixStations creates copies of stations with prefixed IDs and rewrites interlock rule StationIDs.
func prefixStations(stations []domain.Station, prefix string) []domain.Station {
	result := make([]domain.Station, len(stations))
	for i, st := range stations {
		st.ID = prefix + st.ID
		// Rewrite interlock rule StationIDs
		if st.InterlockRules != nil {
			st.InterlockRules = prefixInterlockRules(st.InterlockRules, prefix)
		}
		// Also rewrite config-embedded interlock rules
		if ilRaw, ok := st.Config["interlockRules"]; ok {
			st.Config = copyConfig(st.Config)
			st.Config["interlockRules"] = prefixInterlockRulesRaw(ilRaw, prefix)
		}
		result[i] = st
	}
	return result
}

// prefixConnections creates copies of connections with prefixed From/To.
func prefixConnections(connections []domain.Connection, prefix string) []domain.Connection {
	result := make([]domain.Connection, len(connections))
	for i, conn := range connections {
		conn.From = prefix + conn.From
		conn.To = prefix + conn.To
		result[i] = conn
	}
	return result
}

// prefixInterlockRules creates a copy of InterlockConfig with StationIDs prefixed.
func prefixInterlockRules(config *domain.InterlockConfig, prefix string) *domain.InterlockConfig {
	if config == nil {
		return nil
	}
	newConfig := &domain.InterlockConfig{
		Signals: config.Signals,
		Rules:   make([]domain.InterlockRule, len(config.Rules)),
	}
	for i, rule := range config.Rules {
		newRule := rule
		newRule.Conditions = make([]domain.RuleCondition, len(rule.Conditions))
		for j, cond := range rule.Conditions {
			newCond := cond
			if newCond.StationID != "" {
				newCond.StationID = prefix + newCond.StationID
			}
			newRule.Conditions[j] = newCond
		}
		newConfig.Rules[i] = newRule
	}
	return newConfig
}

// prefixInterlockRulesRaw rewrites StationIDs in a raw (map[string]interface{}) interlock config.
func prefixInterlockRulesRaw(raw interface{}, prefix string) interface{} {
	m, ok := raw.(map[string]interface{})
	if !ok {
		return raw
	}
	newM := make(map[string]interface{})
	for k, v := range m {
		newM[k] = v
	}
	if rules, ok := newM["rules"].([]interface{}); ok {
		newRules := make([]interface{}, len(rules))
		for i, r := range rules {
			if rm, ok := r.(map[string]interface{}); ok {
				newRM := make(map[string]interface{})
				for k, v := range rm {
					newRM[k] = v
				}
				if conds, ok := newRM["conditions"].([]interface{}); ok {
					newConds := make([]interface{}, len(conds))
					for j, c := range conds {
						if cm, ok := c.(map[string]interface{}); ok {
							newCM := make(map[string]interface{})
							for k, v := range cm {
								newCM[k] = v
							}
							if sid, ok := newCM["stationId"].(string); ok && sid != "" {
								newCM["stationId"] = prefix + sid
							}
							newConds[j] = newCM
						} else {
							newConds[j] = c
						}
					}
					newRM["conditions"] = newConds
				}
				newRules[i] = newRM
			} else {
				newRules[i] = r
			}
		}
		newM["rules"] = newRules
	}
	return newM
}

// copyConfig creates a shallow copy of a config map.
func copyConfig(config map[string]interface{}) map[string]interface{} {
	newConfig := make(map[string]interface{}, len(config))
	for k, v := range config {
		newConfig[k] = v
	}
	return newConfig
}

// rewriteConnection rewrites a connection that may reference a ModulerStation.
// - If To is a ModulerStation: rewrite to prefix.entry-{toPortIndex}, set ToPortIndex=-1
// - If From is a ModulerStation: rewrite to prefix.exit-{fromPortIndex}, set FromPortIndex=-1
// - If neither: return as-is
func rewriteConnection(conn domain.Connection, modulerStations map[string]*domain.Station) []domain.Connection {
	newConn := conn

	if ms, ok := modulerStations[conn.To]; ok {
		entryIndex := conn.ToPortIndex
		if entryIndex < 0 {
			entryIndex = 0
		}
		if ms.EntryCount > 0 && entryIndex >= ms.EntryCount {
			entryIndex = 0 // fallback
		}
		newConn.To = fmt.Sprintf("%s.entry-%d", conn.To, entryIndex)
		newConn.ToPortIndex = -1
	}

	if ms, ok := modulerStations[conn.From]; ok {
		exitIndex := conn.FromPortIndex
		if exitIndex < 0 {
			exitIndex = 0
		}
		if ms.ExitCount > 0 && exitIndex >= ms.ExitCount {
			exitIndex = 0 // fallback
		}
		newConn.From = fmt.Sprintf("%s.exit-%d", conn.From, exitIndex)
		newConn.FromPortIndex = -1
	}

	return []domain.Connection{newConn}
}
