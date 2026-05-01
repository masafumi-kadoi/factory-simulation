package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"strings"
)

// deriveModulerSignals derives a Moduler station's result signals from its internal stations.
// inputWorkPresent: any inputMonitorStation has work
// processingWorkPresent: any non-monitor internal station has work
// outputWorkPresent: any outputMonitorStation has work
// running: any internal station has running=ON
func deriveModulerSignals(moduler *domain.Station, scenario *domain.Scenario) {
	if moduler.Type != domain.StationTypeModuler || len(moduler.InternalStationIDs) == 0 {
		return
	}

	inputMonitorIDs := getStringSliceConfig(moduler, "inputMonitorStationIds")
	outputMonitorIDs := getStringSliceConfig(moduler, "outputMonitorStationIds")

	inputMonitorSet := toSet(inputMonitorIDs)
	outputMonitorSet := toSet(outputMonitorIDs)

	var hasInputWork, hasProcessingWork, hasOutputWork, anyRunning bool

	for _, id := range moduler.InternalStationIDs {
		station := scenario.GetStation(id)
		if station == nil {
			continue
		}

		hasWork := station.GetWork() != nil || station.GetSignal(domain.SignalInputWorkPresent)

		if inputMonitorSet[id] {
			if hasWork {
				hasInputWork = true
			}
		} else if outputMonitorSet[id] {
			if hasWork {
				hasOutputWork = true
			}
		} else {
			if hasWork {
				hasProcessingWork = true
			}
		}

		if station.GetSignal(domain.SignalRunning) {
			anyRunning = true
		}
	}

	moduler.SetSignal(domain.SignalInputWorkPresent, hasInputWork)
	moduler.SetSignal(domain.SignalProcessingWorkPresent, hasProcessingWork)
	moduler.SetSignal(domain.SignalOutputWorkPresent, hasOutputWork)
	moduler.SetSignal(domain.SignalRunning, anyRunning)
}

// triggerModulerDerivation finds the parent Moduler station for a given station
// and re-derives its signals. Called after processing an internal station's events.
func (e *Engine) triggerModulerDerivation(station *domain.Station) error {
	moduler := e.findParentModuler(station.ID)
	if moduler == nil {
		return nil
	}

	deriveModulerSignals(moduler, e.scenario)
	return e.evaluateAndLogSignals(moduler)
}

// findParentModuler finds the Moduler station that contains the given station ID.
func (e *Engine) findParentModuler(stationID string) *domain.Station {
	if e.stationModulerMap != nil {
		if parentID, ok := e.stationModulerMap[stationID]; ok {
			return e.scenario.GetStation(parentID)
		}
		return nil
	}
	// Fallback for cases where stationModulerMap is not built
	for i := range e.scenario.Stations {
		st := &e.scenario.Stations[i]
		if st.Type != domain.StationTypeModuler {
			continue
		}
		for _, internalID := range st.InternalStationIDs {
			if internalID == stationID {
				return st
			}
		}
	}
	return nil
}

// getStringSliceConfig retrieves a []string from station config (stored as []interface{}).
func getStringSliceConfig(station *domain.Station, key string) []string {
	raw, ok := station.Config[key]
	if !ok {
		return nil
	}
	arr, ok := raw.([]interface{})
	if !ok {
		return nil
	}
	result := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			result = append(result, s)
		}
	}
	return result
}

// toSet converts a string slice to a set (map[string]bool).
func toSet(items []string) map[string]bool {
	s := make(map[string]bool, len(items))
	for _, item := range items {
		s[item] = true
	}
	return s
}

// isInternalStation checks if a station ID belongs to any Moduler's internal stations.
// Uses the stationModulerMap for O(1) lookup when available, falls back to dot-check.
func (e *Engine) isInternalStation(stationID string) bool {
	if e.stationModulerMap != nil {
		_, ok := e.stationModulerMap[stationID]
		return ok
	}
	return strings.Contains(stationID, ".")
}
