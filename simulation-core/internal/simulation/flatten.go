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

		// Set InternalStationIDs on the Moduler station (last added to flatStations)
		modulerIdx := len(flatStations) - 1
		var internalIDs []string
		for _, ns := range nestedStations {
			internalIDs = append(internalIDs, ns.ID)
		}
		flatStations[modulerIdx].InternalStationIDs = internalIDs

		// Convert inputMonitorStationIds/outputMonitorStationIds to prefixed IDs
		prefixMonitorStationIDs(&flatStations[modulerIdx], modulerPrefix)

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

// prefixMonitorStationIDs converts inputMonitorStationIds/outputMonitorStationIds
// in the Moduler station's config from relative IDs to prefixed IDs.
func prefixMonitorStationIDs(station *domain.Station, prefix string) {
	if station.Config == nil {
		return
	}
	station.Config = copyConfig(station.Config)
	for _, key := range []string{"inputMonitorStationIds", "outputMonitorStationIds"} {
		if raw, ok := station.Config[key]; ok {
			if arr, ok := raw.([]interface{}); ok {
				newArr := make([]interface{}, len(arr))
				for i, item := range arr {
					if id, ok := item.(string); ok {
						newArr[i] = prefix + id
					} else {
						newArr[i] = item
					}
				}
				station.Config[key] = newArr
			}
		}
	}
}

// copyConfig creates a shallow copy of a config map.
func copyConfig(config map[string]interface{}) map[string]interface{} {
	newConfig := make(map[string]interface{}, len(config))
	for k, v := range config {
		newConfig[k] = v
	}
	return newConfig
}

// findStationsByType finds internal stations of a given type within a ModulerStation's SubScenario.
// Returns them in order of appearance.
func findStationsByType(ms *domain.Station, stationType domain.StationType) []string {
	if ms.SubScenario == nil {
		return nil
	}
	var ids []string
	for _, st := range ms.SubScenario.Stations {
		if st.Type == stationType {
			ids = append(ids, st.ID)
		}
	}
	return ids
}

// rewriteConnection rewrites a connection that may reference a ModulerStation.
// - If To is a ModulerStation: rewrite to the N-th Entry station (by type lookup), set ToPortIndex=-1
// - If From is a ModulerStation: rewrite to the N-th Exit station (by type lookup), set FromPortIndex=-1
// - If neither: return as-is
func rewriteConnection(conn domain.Connection, modulerStations map[string]*domain.Station) []domain.Connection {
	newConn := conn

	if ms, ok := modulerStations[conn.To]; ok {
		entryIndex := conn.ToPortIndex
		if entryIndex < 0 {
			entryIndex = 0
		}
		entries := findStationsByType(ms, domain.StationTypeEntry)
		if len(entries) > 0 {
			if entryIndex >= len(entries) {
				entryIndex = 0
			}
			newConn.To = fmt.Sprintf("%s.%s", conn.To, entries[entryIndex])
		} else {
			// Fallback: no SubScenario, use naming convention
			newConn.To = fmt.Sprintf("%s.entry-%d", conn.To, entryIndex)
		}
		newConn.ToPortIndex = -1
	}

	if ms, ok := modulerStations[conn.From]; ok {
		exitIndex := conn.FromPortIndex
		if exitIndex < 0 {
			exitIndex = 0
		}
		exits := findStationsByType(ms, domain.StationTypeExit)
		if len(exits) > 0 {
			if exitIndex >= len(exits) {
				exitIndex = 0
			}
			newConn.From = fmt.Sprintf("%s.%s", conn.From, exits[exitIndex])
		} else {
			// Fallback: no SubScenario, use naming convention
			newConn.From = fmt.Sprintf("%s.exit-%d", conn.From, exitIndex)
		}
		newConn.FromPortIndex = -1
	}

	return []domain.Connection{newConn}
}
