package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
)

// StationStatusLog represents a log entry for station status changes
type StationStatusLog struct {
	StationID  string
	Timestamp  float64
	StatusType string
	Value      bool
}

// WorkEventLog represents a log entry for work events
type WorkEventLog struct {
	WorkID     string
	StationID  string
	Timestamp  float64
	EventType  string
}

// Engine is the simulation engine
type Engine struct {
	scenario     *domain.Scenario
	eventQueue   *PriorityQueue
	currentTime  float64
	workCounter  int
	statusLogs   []StationStatusLog
	workEventLogs []WorkEventLog
}

// NewEngine creates a new simulation engine
func NewEngine(scenario *domain.Scenario) *Engine {
	return &Engine{
		scenario:      scenario,
		eventQueue:    NewPriorityQueue(),
		currentTime:   0.0,
		workCounter:   0,
		statusLogs:    make([]StationStatusLog, 0),
		workEventLogs: make([]WorkEventLog, 0),
	}
}

// Run executes the simulation until the time limit or event exhaustion
func (e *Engine) Run(simulationID string, timeLimit float64) (*domain.Simulation, []StationStatusLog, []WorkEventLog, error) {
	simulation := domain.NewSimulation(simulationID, e.scenario.ID)

	// Initialize: Generate WorkCreated events from source stations
	for i := range e.scenario.Stations {
		station := &e.scenario.Stations[i]
		if station.Type == domain.StationTypeSource {
			workCount := station.GetIntConfig("workCount")
			for j := 0; j < workCount; j++ {
				e.eventQueue.Push(NewEvent(EventWorkCreated, 0.0, station.ID, nil))
			}
		}
	}

	// Event loop
	for !e.eventQueue.IsEmpty() {
		event := e.eventQueue.Pop()
		e.currentTime = event.Time

		// Check time limit
		if e.currentTime > timeLimit {
			simulation.Complete(timeLimit, domain.EndReasonTimeLimit)
			break
		}

		// Process event
		simulation.Summary.TotalEvents++
		if err := e.processEvent(event, simulation); err != nil {
			simulation.Fail()
			return nil, nil, nil, err
		}
	}

	// If event queue is empty, simulation ends by event exhaustion
	if simulation.Status == domain.SimulationStatusRunning {
		simulation.Complete(e.currentTime, domain.EndReasonEventExhausted)
	}

	return simulation, e.statusLogs, e.workEventLogs, nil
}

// processEvent processes a single event
func (e *Engine) processEvent(event *Event, simulation *domain.Simulation) error {
	station := e.scenario.GetStation(event.StationID)
	if station == nil {
		return fmt.Errorf("station not found: %s", event.StationID)
	}

	switch event.Type {
	case EventWorkCreated:
		return e.handleWorkCreated(station, simulation)
	case EventWorkDeparted:
		return e.handleWorkDeparted(station, event)
	case EventWorkArrived:
		return e.handleWorkArrived(station, event)
	case EventProcessingStarted:
		return e.handleProcessingStarted(station, event)
	case EventProcessingCompleted:
		return e.handleProcessingCompleted(station, event)
	case EventWorkDestroyed:
		return e.handleWorkDestroyed(station, event, simulation)
	default:
		return fmt.Errorf("unknown event type: %s", event.Type)
	}
}

// handleWorkCreated handles WorkCreated event
func (e *Engine) handleWorkCreated(station *domain.Station, simulation *domain.Simulation) error {
	// Generate work
	e.workCounter++
	workID := fmt.Sprintf("work-%03d", e.workCounter)
	work := domain.NewWork(workID)
	station.CurrentWork = work
	simulation.Summary.TotalWorksCreated++

	// Log work event
	e.logWorkEvent(workID, station.ID, e.currentTime, "WorkCreated")

	// Set CanDepart status ON
	station.CanDepart = true
	t := e.currentTime
	station.CanDepartOnTime = &t
	e.logStationStatus(station.ID, e.currentTime, "搬出可ON", true)

	// Schedule WorkDeparted event
	departureTime := station.GetFloatConfig("departureTime")
	e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, &workID))

	return nil
}

// handleWorkDeparted handles WorkDeparted event
func (e *Engine) handleWorkDeparted(station *domain.Station, event *Event) error {
	if station.CurrentWork == nil {
		return fmt.Errorf("no work to depart from station %s", station.ID)
	}

	workID := station.CurrentWork.ID

	// Log work event
	e.logWorkEvent(workID, station.ID, e.currentTime, "WorkDeparted")

	// Update station: work departure time
	t := e.currentTime
	station.WorkDepartureTime = &t

	// Set CanDepart status OFF
	station.CanDepart = false
	station.CanDepartOffTime = &t
	e.logStationStatus(station.ID, e.currentTime, "搬出可OFF", false)

	// Remove work from current station
	work := station.CurrentWork
	station.CurrentWork = nil

	// Set CanReceive status ON (station is now empty)
	station.CanReceive = true
	station.CanReceiveOnTime = &t
	e.logStationStatus(station.ID, e.currentTime, "搬入可ON", true)

	// Schedule WorkArrived event for next station
	nextStations := e.scenario.GetNextStations(station.ID)
	if len(nextStations) == 0 {
		return fmt.Errorf("no next station from %s", station.ID)
	}

	nextStationID := nextStations[0]
	nextStation := e.scenario.GetStation(nextStationID)
	if nextStation == nil {
		return fmt.Errorf("next station not found: %s", nextStationID)
	}

	arrivalTime := nextStation.GetFloatConfig("arrivalTime")
	e.eventQueue.Push(NewEvent(EventWorkArrived, e.currentTime+arrivalTime, nextStationID, &workID))

	// Temporarily store work in next station (will be set properly in WorkArrived)
	nextStation.CurrentWork = work

	return nil
}

// handleWorkArrived handles WorkArrived event
func (e *Engine) handleWorkArrived(station *domain.Station, event *Event) error {
	if station.CurrentWork == nil {
		return fmt.Errorf("no work arrived at station %s", station.ID)
	}

	workID := station.CurrentWork.ID

	// Log work event
	e.logWorkEvent(workID, station.ID, e.currentTime, "WorkArrived")

	// Update station: work arrival time
	t := e.currentTime
	station.WorkArrivalTime = &t

	// Set CanReceive status OFF
	station.CanReceive = false
	station.CanReceiveOffTime = &t
	e.logStationStatus(station.ID, e.currentTime, "搬入可OFF", false)

	// Check station type
	if station.Type == domain.StationTypeDrain {
		// For drain station, schedule WorkDestroyed immediately
		e.eventQueue.Push(NewEvent(EventWorkDestroyed, e.currentTime, station.ID, &workID))
		return nil
	}

	// For processing station, check processing ready condition
	// Processing ready condition: work has arrived
	station.ProcessingReady = true
	station.ProcessingReadyTime = &t
	e.logStationStatus(station.ID, e.currentTime, "処理条件成立", true)

	// Schedule ProcessingStarted event (immediately after arrival)
	e.eventQueue.Push(NewEvent(EventProcessingStarted, e.currentTime, station.ID, &workID))

	return nil
}

// handleProcessingStarted handles ProcessingStarted event
func (e *Engine) handleProcessingStarted(station *domain.Station, event *Event) error {
	workID := station.CurrentWork.ID

	// Log work event
	e.logWorkEvent(workID, station.ID, e.currentTime, "ProcessingStarted")

	// Set ProcessingStarted status ON
	station.ProcessingStarted = true
	t := e.currentTime
	station.ProcessingStartTime = &t
	e.logStationStatus(station.ID, e.currentTime, "処理開始", true)

	// Schedule ProcessingCompleted event
	processingTime := station.GetFloatConfig("processingTime")
	e.eventQueue.Push(NewEvent(EventProcessingCompleted, e.currentTime+processingTime, station.ID, &workID))

	return nil
}

// handleProcessingCompleted handles ProcessingCompleted event
func (e *Engine) handleProcessingCompleted(station *domain.Station, event *Event) error {
	workID := station.CurrentWork.ID

	// Log work event
	e.logWorkEvent(workID, station.ID, e.currentTime, "ProcessingCompleted")

	// Set ProcessingCompleted status ON
	station.ProcessingCompleted = true
	t := e.currentTime
	station.ProcessingCompleteTime = &t
	e.logStationStatus(station.ID, e.currentTime, "処理完了", true)

	// Set CanDepart status ON (processing completed & next station can receive)
	// For simplicity, assume next station can always receive
	station.CanDepart = true
	station.CanDepartOnTime = &t
	e.logStationStatus(station.ID, e.currentTime, "搬出可ON", true)

	// Schedule WorkDeparted event
	departureTime := station.GetFloatConfig("departureTime")
	e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, &workID))

	return nil
}

// handleWorkDestroyed handles WorkDestroyed event
func (e *Engine) handleWorkDestroyed(station *domain.Station, event *Event, simulation *domain.Simulation) error {
	workID := station.CurrentWork.ID

	// Log work event
	e.logWorkEvent(workID, station.ID, e.currentTime, "WorkDestroyed")

	// Remove work from station
	station.CurrentWork = nil
	simulation.Summary.TotalWorksDestroyed++

	// Set CanReceive status ON (drain station is now empty and can receive again)
	station.CanReceive = true
	t := e.currentTime
	station.CanReceiveOnTime = &t
	e.logStationStatus(station.ID, e.currentTime, "搬入可ON", true)

	return nil
}

// logStationStatus logs a station status change
func (e *Engine) logStationStatus(stationID string, timestamp float64, statusType string, value bool) {
	e.statusLogs = append(e.statusLogs, StationStatusLog{
		StationID:  stationID,
		Timestamp:  timestamp,
		StatusType: statusType,
		Value:      value,
	})
}

// logWorkEvent logs a work event
func (e *Engine) logWorkEvent(workID, stationID string, timestamp float64, eventType string) {
	e.workEventLogs = append(e.workEventLogs, WorkEventLog{
		WorkID:     workID,
		StationID:  stationID,
		Timestamp:  timestamp,
		EventType:  eventType,
	})
}
