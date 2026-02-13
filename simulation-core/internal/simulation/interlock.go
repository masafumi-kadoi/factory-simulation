package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
)

const maxRuleIterations = 10

// SignalChangeLog represents a signal change during rule evaluation
type SignalChangeLog struct {
	StationID  string
	SignalName string
	OldValue   bool
	NewValue   bool
	RuleID     string
	Timestamp  float64
}

// evaluateRules evaluates all rules for a station until stable state
// Returns signal change logs and error if MAX_ITERATIONS reached
func evaluateRules(station *domain.Station, scenario *domain.Scenario, currentTime float64) ([]SignalChangeLog, error) {
	if station.InterlockRules == nil || station.Signals == nil {
		return nil, nil
	}

	var changes []SignalChangeLog
	changed := true
	iterations := 0

	for changed && iterations < maxRuleIterations {
		changed = false
		iterations++

		for _, rule := range station.InterlockRules.Rules {
			if allConditionsMet(rule.Conditions, station, scenario) {
				currentValue := station.Signals[rule.Target]
				if currentValue != rule.Value {
					oldValue := currentValue
					station.Signals[rule.Target] = rule.Value
					changed = true

					changes = append(changes, SignalChangeLog{
						StationID:  station.ID,
						SignalName: rule.Target,
						OldValue:   oldValue,
						NewValue:   rule.Value,
						RuleID:     rule.ID,
						Timestamp:  currentTime,
					})
				}
			}
		}
	}

	if iterations >= maxRuleIterations {
		signalState := ""
		for name, val := range station.Signals {
			signalState += fmt.Sprintf("%s=%v ", name, val)
		}
		return changes, fmt.Errorf("rule evaluation did not converge: station=%s, iterations=%d, signals: %s", station.ID, iterations, signalState)
	}

	return changes, nil
}

// allConditionsMet checks if all conditions of a rule are satisfied
func allConditionsMet(conditions []domain.RuleCondition, station *domain.Station, scenario *domain.Scenario) bool {
	if len(conditions) == 0 {
		return false // Empty conditions = rule is inactive
	}

	for _, cond := range conditions {
		targetStation := station
		if cond.StationID != "" {
			targetStation = scenario.GetStation(cond.StationID)
			if targetStation == nil {
				return false // Referenced station not found
			}
		}
		if targetStation.GetSignal(cond.Signal) != cond.Value {
			return false
		}
	}

	return true
}
