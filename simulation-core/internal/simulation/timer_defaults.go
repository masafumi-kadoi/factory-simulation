package simulation

import "factory-simulation/simulation-core/internal/domain"

const (
	defaultStayTimeMargin      = 1.0 // seconds
	defaultNoWorkTimeoutMargin = 1.0 // seconds
)

// initializeTimerDefaults sets default stayTime and noWorkTimeout values for stations
// that don't have user-specified values. Called during scenario initialization.
func (e *Engine) initializeTimerDefaults() {
	for i := range e.scenario.Stations {
		station := &e.scenario.Stations[i]
		e.initStationStayTime(station)
		e.initStationNoWorkTimeout(station)
	}
}

// initStationStayTime sets default stayTime if not user-specified.
// Processing: arrivalTime + processingTime + departureTime + margin
// Other types: type-specific defaults
func (e *Engine) initStationStayTime(station *domain.Station) {
	// Skip if user already specified stayTime
	if _, ok := station.Config["stayTime"]; ok {
		return
	}

	var stayTime float64
	switch station.Type {
	case domain.StationTypeProcessing:
		arrivalTime := station.GetFloatConfig("arrivalTime")
		processingTime := station.GetFloatConfig("processingTime")
		departureTime := station.GetFloatConfig("departureTime")
		margin := getMargin(station, "stayTimeMargin", defaultStayTimeMargin)
		stayTime = arrivalTime + processingTime + departureTime + margin

	case domain.StationTypeMerge:
		processingTime := station.GetFloatConfig("processingTime")
		margin := getMargin(station, "stayTimeMargin", defaultStayTimeMargin)
		stayTime = processingTime + margin

	case domain.StationTypeSplit:
		processingTime := station.GetFloatConfig("processingTime")
		margin := getMargin(station, "stayTimeMargin", defaultStayTimeMargin)
		stayTime = processingTime + margin

	case domain.StationTypeSource, domain.StationTypeDrain,
		domain.StationTypeEntry, domain.StationTypeExit:
		// These station types typically don't need workFull monitoring
		// Set a negative value to disable the timer
		stayTime = -1

	case domain.StationTypeModuler:
		// Moduler stayTime depends on internal stations; skip auto-calculation
		stayTime = -1

	default:
		stayTime = -1
	}

	if station.Config == nil {
		station.Config = make(map[string]interface{})
	}
	station.Config["stayTime"] = stayTime
}

// initStationNoWorkTimeout sets default noWorkTimeout if not user-specified.
// Calculated from upstream station's expected output interval.
func (e *Engine) initStationNoWorkTimeout(station *domain.Station) {
	// Skip if user already specified noWorkTimeout
	if _, ok := station.Config["noWorkTimeout"]; ok {
		return
	}

	var noWorkTimeout float64

	switch station.Type {
	case domain.StationTypeSource, domain.StationTypeEntry:
		// Source/Entry don't need workEmpty monitoring
		noWorkTimeout = -1

	case domain.StationTypeProcessing, domain.StationTypeDrain,
		domain.StationTypeMerge, domain.StationTypeSplit, domain.StationTypeExit:
		// Calculate from upstream output interval
		upstreamInterval := e.estimateUpstreamInterval(station.ID)
		if upstreamInterval > 0 {
			margin := getMargin(station, "noWorkTimeoutMargin", defaultNoWorkTimeoutMargin)
			noWorkTimeout = upstreamInterval + margin
		} else {
			noWorkTimeout = -1 // No upstream found, disable
		}

	case domain.StationTypeModuler:
		noWorkTimeout = -1

	default:
		noWorkTimeout = -1
	}

	if station.Config == nil {
		station.Config = make(map[string]interface{})
	}
	station.Config["noWorkTimeout"] = noWorkTimeout
}

// estimateUpstreamInterval estimates the output interval of the upstream station.
// For Processing upstream: arrivalTime + processingTime + departureTime
// For Source upstream: departureTime (work creation interval)
func (e *Engine) estimateUpstreamInterval(stationID string) float64 {
	for _, conn := range e.scenario.Connections {
		if conn.To != stationID {
			continue
		}
		upstream := e.scenario.GetStation(conn.From)
		if upstream == nil {
			continue
		}

		switch upstream.Type {
		case domain.StationTypeSource:
			return upstream.GetFloatConfig("departureTime")
		case domain.StationTypeProcessing:
			return upstream.GetFloatConfig("arrivalTime") +
				upstream.GetFloatConfig("processingTime") +
				upstream.GetFloatConfig("departureTime")
		default:
			// For other types, use processingTime + departureTime as estimate
			return upstream.GetFloatConfig("processingTime") +
				upstream.GetFloatConfig("departureTime")
		}
	}
	return 0 // No upstream found
}

// getMargin retrieves a margin value from station config, falling back to defaultVal.
func getMargin(station *domain.Station, key string, defaultVal float64) float64 {
	if val, ok := station.Config[key]; ok {
		if fval, ok := val.(float64); ok {
			return fval
		}
	}
	return defaultVal
}
