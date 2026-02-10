package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
	"math/rand"
	"time"

	"github.com/google/uuid"
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
	WorkID           string
	WorkFriendlyName string
	StationID        string
	Timestamp        float64
	EventType        string
}

// WorkLineageLog represents a log entry for work lineage (traceability)
type WorkLineageLog struct {
	ChildWorkID            string
	ChildWorkFriendlyName  string
	ParentWorkID           string
	ParentWorkFriendlyName string
	OperationType          string
	StationID              string
	Timestamp              float64
}

// Engine is the simulation engine
type Engine struct {
	scenario           *domain.Scenario
	eventQueue         *PriorityQueue
	currentTime        float64
	workCounter        int
	statusLogs         []StationStatusLog
	workEventLogs      []WorkEventLog
	workLineageLogs    []WorkLineageLog
	random             *rand.Rand
	worksInTransit     map[string]*domain.Work // Works in transit between stations
	sourceWorkCounters map[string]int          // Counter for each source station (stationID -> count created)
}

// NewEngine creates a new simulation engine
func NewEngine(scenario *domain.Scenario) *Engine {
	return &Engine{
		scenario:           scenario,
		eventQueue:         NewPriorityQueue(),
		currentTime:        0.0,
		workCounter:        0,
		statusLogs:         make([]StationStatusLog, 0),
		workEventLogs:      make([]WorkEventLog, 0),
		workLineageLogs:    make([]WorkLineageLog, 0),
		random:             rand.New(rand.NewSource(time.Now().UnixNano())),
		worksInTransit:     make(map[string]*domain.Work),
		sourceWorkCounters: make(map[string]int),
	}
}

// Run executes the simulation until the time limit or event exhaustion
func (e *Engine) Run(simulationID, friendlyName string, timeLimit float64) (*domain.Simulation, []StationStatusLog, []WorkEventLog, []WorkLineageLog, error) {
	simulation := domain.NewSimulation(simulationID, friendlyName, e.scenario.ID)

	// Initialize: Schedule FIRST WorkCreated event for each source station
	// Subsequent works will be created after each work departs (one at a time)
	for i := range e.scenario.Stations {
		station := &e.scenario.Stations[i]
		if station.Type == domain.StationTypeSource {
			e.sourceWorkCounters[station.ID] = 0
			// Schedule first work creation at time 0
			e.eventQueue.Push(NewEvent(EventWorkCreated, 0.0, station.ID, nil))
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
			return nil, nil, nil, nil, err
		}
	}

	// If event queue is empty, simulation ends by event exhaustion
	if simulation.Status == domain.SimulationStatusRunning {
		simulation.Complete(e.currentTime, domain.EndReasonEventExhausted)
	}

	return simulation, e.statusLogs, e.workEventLogs, e.workLineageLogs, nil
}

// processEvent processes a single event
func (e *Engine) processEvent(event *Event, simulation *domain.Simulation) error {
	station := e.scenario.GetStation(event.StationID)
	if station == nil {
		return fmt.Errorf("station not found: %s", event.StationID)
	}

	switch event.Type {
	case EventWorkCreated:
		return e.handleWorkCreated(event, station)
	case EventWorkArrived:
		return e.handleWorkArrived(event, station)
	case EventProcessingStarted:
		return e.handleProcessingStarted(event, station)
	case EventProcessingCompleted:
		return e.handleProcessingCompleted(event, station)
	case EventWorkDeparted:
		return e.handleWorkDeparted(event, station)
	case EventWorkDestroyed:
		return e.handleWorkDestroyed(event, station)
	default:
		return fmt.Errorf("unknown event type: %s", event.Type)
	}
}

// handleWorkCreated handles the WorkCreated event
func (e *Engine) handleWorkCreated(event *Event, station *domain.Station) error {
	// Check if we should create more works for this source
	workCount := station.GetIntConfig("workCount")
	if e.sourceWorkCounters[station.ID] >= workCount {
		// Already created all works for this source
		return nil
	}

	// Increment counter
	e.sourceWorkCounters[station.ID]++

	// Generate new work ID and friendly name
	workID, friendlyName := e.generateWorkID()
	work := domain.NewWork(workID, friendlyName)

	// Add to station (Source stations keep work internally)
	station.CurrentWork = work
	station.State = domain.StateCompleted

	// Log work event
	e.logWorkEvent(workID, friendlyName, station.ID, e.currentTime, string(EventWorkCreated))

	// Schedule WorkDeparted event
	departureTime := station.GetFloatConfig("departureTime")
	e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, &workID))

	return nil
}

// handleWorkArrived handles the WorkArrived event
func (e *Engine) handleWorkArrived(event *Event, station *domain.Station) error {
	// Retrieve work from transit
	work, ok := e.worksInTransit[*event.WorkID]
	if !ok {
		return fmt.Errorf("work not found in transit: %s", *event.WorkID)
	}
	delete(e.worksInTransit, *event.WorkID)

	// Check interlock: InputReady must be ON
	if !station.IsInputReady() {
		return fmt.Errorf("interlock violation: station %s InputReady=OFF (state=%s), cannot accept work", station.ID, station.State)
	}

	// Delegate to station logic
	if err := station.AddWork(work); err != nil {
		return err
	}

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkArrived))
	e.logStationStatus(station, "ワーク到着")

	// For Drain station, schedule immediate destruction
	if station.Type == domain.StationTypeDrain {
		e.eventQueue.Push(NewEvent(EventWorkDestroyed, e.currentTime, station.ID, &work.ID))
		return nil
	}

	// For Processing station, schedule processing start
	if station.CanStartProcessing() {
		processingTime := station.GetFloatConfig("processingTime")
		e.eventQueue.Push(NewEvent(EventProcessingStarted, e.currentTime+processingTime, station.ID, nil))
	}

	return nil
}

// handleProcessingStarted handles the ProcessingStarted event
func (e *Engine) handleProcessingStarted(event *Event, station *domain.Station) error {
	// Delegate to station logic
	if err := station.StartProcessing(); err != nil {
		return err
	}

	// Log work event
	var workID, workFriendlyName string
	if station.CurrentWork != nil {
		workID = station.CurrentWork.ID
		workFriendlyName = station.CurrentWork.FriendlyName
	}
	e.logWorkEvent(workID, workFriendlyName, station.ID, e.currentTime, string(EventProcessingStarted))
	e.logStationStatus(station, "処理開始")

	// Schedule ProcessingCompleted event
	processingTime := station.GetFloatConfig("processingTime")
	e.eventQueue.Push(NewEvent(EventProcessingCompleted, e.currentTime+processingTime, station.ID, nil))

	return nil
}

// handleProcessingCompleted handles the ProcessingCompleted event
func (e *Engine) handleProcessingCompleted(event *Event, station *domain.Station) error {
	// Delegate to station logic
	if err := station.CompleteProcessing(e.generateWorkID); err != nil {
		return err
	}

	// Log work event (Processing: normal completion)
	if station.CurrentWork != nil {
		e.logWorkEvent(station.CurrentWork.ID, station.CurrentWork.FriendlyName, station.ID, e.currentTime, string(EventProcessingCompleted))
	}

	e.logStationStatus(station, "処理完了")

	// Schedule WorkDeparted event
	departureTime := station.GetFloatConfig("departureTime")
	e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, nil))

	return nil
}

// handleWorkDeparted handles the WorkDeparted event
func (e *Engine) handleWorkDeparted(event *Event, station *domain.Station) error {
	// Check interlock: OutputReady must be ON (except for Source stations)
	if station.Type != domain.StationTypeSource && !station.IsOutputReady() {
		return fmt.Errorf("interlock violation: station %s OutputReady=OFF (state=%s), cannot depart work", station.ID, station.State)
	}

	// Delegate to station logic
	work, err := station.GetOutputWork()
	if err != nil {
		return err
	}

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDeparted))
	e.logStationStatus(station, "ワーク出発")

	// Get next station
	nextStation, err := e.getNextStation(station, work)
	if err != nil {
		return err
	}

	if nextStation == nil {
		// No next station (terminal node)
		return nil
	}

	// Check interlock: Next station must have InputReady ON
	if !nextStation.IsInputReady() {
		// This should not happen with proper timing, but let's error out to detect issues
		return fmt.Errorf("interlock violation: next station %s InputReady=OFF (state=%s), cannot send work", nextStation.ID, nextStation.State)
	}

	// Put work in transit
	e.worksInTransit[work.ID] = work

	// Schedule WorkArrived event at next station
	arrivalTime := nextStation.GetFloatConfig("arrivalTime")
	e.eventQueue.Push(NewEvent(EventWorkArrived, e.currentTime+arrivalTime, nextStation.ID, &work.ID))

	// For Source stations: Schedule next work creation (interlock: one at a time)
	if station.Type == domain.StationTypeSource {
		workCount := station.GetIntConfig("workCount")
		if e.sourceWorkCounters[station.ID] < workCount {
			// Create next work after configured departure time (interlock delay)
			departureTime := station.GetFloatConfig("departureTime")
			e.eventQueue.Push(NewEvent(EventWorkCreated, e.currentTime+departureTime, station.ID, nil))
		}
	}

	return nil
}

// handleWorkDestroyed handles the WorkDestroyed event
func (e *Engine) handleWorkDestroyed(event *Event, station *domain.Station) error {
	work := e.findWorkByID(*event.WorkID)
	if work == nil {
		return fmt.Errorf("work not found: %s", *event.WorkID)
	}

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDestroyed))

	// Clear station
	station.CurrentWork = nil
	station.State = domain.StateIdle

	e.logStationStatus(station, "ワーク破棄")

	return nil
}

// getNextStation determines the next station based on routing conditions
func (e *Engine) getNextStation(fromStation *domain.Station, work *domain.Work) (*domain.Station, error) {
	// Find the first matching connection
	for _, conn := range e.scenario.Connections {
		if conn.From != fromStation.ID {
			continue
		}

		// For now, only support default routing (no conditional routing in simplified version)
		if conn.Condition == domain.RoutingDefault || conn.Condition == "" {
			return e.scenario.GetStation(conn.To), nil
		}
	}

	// No matching route (terminal node)
	return nil, nil
}

// recordWorkLineage records work lineage for traceability
func (e *Engine) recordWorkLineage(childWorkID, childWorkFriendlyName string, parentWorks []*domain.Work, operationType string, stationID string) {
	for _, parentWork := range parentWorks {
		e.workLineageLogs = append(e.workLineageLogs, WorkLineageLog{
			ChildWorkID:            childWorkID,
			ChildWorkFriendlyName:  childWorkFriendlyName,
			ParentWorkID:           parentWork.ID,
			ParentWorkFriendlyName: parentWork.FriendlyName,
			OperationType:          operationType,
			StationID:              stationID,
			Timestamp:              e.currentTime,
		})
	}
}

// generateWorkID generates a new work ID (UUID) and friendly name
func (e *Engine) generateWorkID() (string, string) {
	e.workCounter++
	workID := uuid.New().String()
	friendlyName := fmt.Sprintf("work-%d", e.workCounter)
	return workID, friendlyName
}

// findWorkByID finds a work by ID across all stations
func (e *Engine) findWorkByID(workID string) *domain.Work {
	for i := range e.scenario.Stations {
		station := &e.scenario.Stations[i]
		if station.CurrentWork != nil && station.CurrentWork.ID == workID {
			return station.CurrentWork
		}
	}
	return nil
}

// logWorkEvent logs a work event
func (e *Engine) logWorkEvent(workID, workFriendlyName, stationID string, timestamp float64, eventType string) {
	e.workEventLogs = append(e.workEventLogs, WorkEventLog{
		WorkID:           workID,
		WorkFriendlyName: workFriendlyName,
		StationID:        stationID,
		Timestamp:        timestamp,
		EventType:        eventType,
	})
}

// logStationStatus logs a station status change
func (e *Engine) logStationStatus(station *domain.Station, statusType string) {
	// Log current state as status
	var value bool
	switch statusType {
	case "ワーク到着", "処理開始", "処理完了", "ワーク出発", "ワーク破棄":
		value = true
	default:
		value = false
	}

	e.statusLogs = append(e.statusLogs, StationStatusLog{
		StationID:  station.ID,
		Timestamp:  e.currentTime,
		StatusType: statusType,
		Value:      value,
	})
}
