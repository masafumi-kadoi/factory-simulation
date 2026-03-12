package simulation

import "factory-simulation/simulation-core/internal/domain"

// Timer key format: "stationID:workFull" or "stationID:workEmpty"
func workFullTimerKey(stationID string) string {
	return stationID + ":workFull"
}

func workEmptyTimerKey(stationID string) string {
	return stationID + ":workEmpty"
}

// scheduleWorkFullTimer schedules a CheckWorkFull event after stayTime seconds.
// Called when a work arrives at a station.
func (e *Engine) scheduleWorkFullTimer(station *domain.Station) {
	stayTime := station.GetFloatConfig("stayTime")
	if stayTime < 0 {
		return
	}

	key := workFullTimerKey(station.ID)
	scheduledTime := e.currentTime + stayTime
	e.pendingTimers[key] = scheduledTime
	e.eventQueue.Push(NewEvent(EventCheckWorkFull, scheduledTime, station.ID, nil))
}

// cancelWorkFullTimer cancels a pending workFull timer and resets workFull=OFF.
// Called when a work departs from a station.
func (e *Engine) cancelWorkFullTimer(station *domain.Station) {
	key := workFullTimerKey(station.ID)
	delete(e.pendingTimers, key)
	station.SetSignal(domain.SignalWorkFull, false)
}

// scheduleWorkEmptyTimer schedules a CheckWorkEmpty event after noWorkTimeout seconds.
// Called when a work departs from a station (station becomes empty).
func (e *Engine) scheduleWorkEmptyTimer(station *domain.Station) {
	noWorkTimeout := station.GetFloatConfig("noWorkTimeout")
	if noWorkTimeout < 0 {
		return
	}

	key := workEmptyTimerKey(station.ID)
	scheduledTime := e.currentTime + noWorkTimeout
	e.pendingTimers[key] = scheduledTime
	e.eventQueue.Push(NewEvent(EventCheckWorkEmpty, scheduledTime, station.ID, nil))
}

// cancelWorkEmptyTimer cancels a pending workEmpty timer and resets workEmpty=OFF.
// Called when a work arrives at a station.
func (e *Engine) cancelWorkEmptyTimer(station *domain.Station) {
	key := workEmptyTimerKey(station.ID)
	delete(e.pendingTimers, key)
	station.SetSignal(domain.SignalWorkEmpty, false)
}

// handleCheckWorkFull handles the CheckWorkFull timer event.
// If the timer is still valid (not cancelled) and work is still present, set workFull=ON.
func (e *Engine) handleCheckWorkFull(event *Event, station *domain.Station) error {
	key := workFullTimerKey(station.ID)
	scheduledTime, exists := e.pendingTimers[key]
	if !exists || scheduledTime != event.Time {
		return nil // Timer was cancelled or superseded
	}
	delete(e.pendingTimers, key)

	// Verify work is still present
	if station.GetWork() != nil || station.GetSignal(domain.SignalInputWorkPresent) {
		station.SetSignal(domain.SignalWorkFull, true)
		e.logSignalChange(station, domain.SignalWorkFull, false, true, "timer:workFull")
		if err := e.evaluateAndLogSignals(station); err != nil {
			return err
		}
	}

	return nil
}

// handleCheckWorkEmpty handles the CheckWorkEmpty timer event.
// If the timer is still valid (not cancelled) and no work is present, set workEmpty=ON.
func (e *Engine) handleCheckWorkEmpty(event *Event, station *domain.Station) error {
	key := workEmptyTimerKey(station.ID)
	scheduledTime, exists := e.pendingTimers[key]
	if !exists || scheduledTime != event.Time {
		return nil // Timer was cancelled or superseded
	}
	delete(e.pendingTimers, key)

	// Verify station is still empty
	if station.GetWork() == nil && !station.GetSignal(domain.SignalInputWorkPresent) {
		station.SetSignal(domain.SignalWorkEmpty, true)
		e.logSignalChange(station, domain.SignalWorkEmpty, false, true, "timer:workEmpty")
		if err := e.evaluateAndLogSignals(station); err != nil {
			return err
		}
	}

	return nil
}
