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
	scenario        *domain.Scenario
	eventQueue      *PriorityQueue
	currentTime     float64
	workCounter     int
	statusLogs      []StationStatusLog
	workEventLogs   []WorkEventLog
	workLineageLogs []WorkLineageLog
	random          *rand.Rand
	worksInTransit  map[string]*domain.Work // Works in transit between stations
}

// NewEngine creates a new simulation engine
func NewEngine(scenario *domain.Scenario) *Engine {
	return &Engine{
		scenario:        scenario,
		eventQueue:      NewPriorityQueue(),
		currentTime:     0.0,
		workCounter:     0,
		statusLogs:      make([]StationStatusLog, 0),
		workEventLogs:   make([]WorkEventLog, 0),
		workLineageLogs: make([]WorkLineageLog, 0),
		random:          rand.New(rand.NewSource(time.Now().UnixNano())),
		worksInTransit:  make(map[string]*domain.Work),
	}
}

// Run executes the simulation until the time limit or event exhaustion
func (e *Engine) Run(simulationID, friendlyName string, timeLimit float64) (*domain.Simulation, []StationStatusLog, []WorkEventLog, []WorkLineageLog, error) {
	simulation := domain.NewSimulation(simulationID, friendlyName, e.scenario.ID)

	// Initialize: Generate WorkCreated events from source stations
	for i := range e.scenario.Stations {
		station := &e.scenario.Stations[i]
		if station.Type == domain.StationTypeSource {
			workCount := station.GetIntConfig("workCount")
			departureTime := station.GetFloatConfig("departureTime")
			for j := 0; j < workCount; j++ {
				// Create works sequentially to avoid simultaneous arrivals at next station
				createTime := float64(j) * departureTime
				e.eventQueue.Push(NewEvent(EventWorkCreated, createTime, station.ID, nil))
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
	// Generate new work ID and friendly name
	workID, friendlyName := e.generateWorkID()
	work := domain.NewWork(workID, friendlyName)

	// Add to station (Source stations keep works internally)
	station.Works = append(station.Works, work)
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

	// For Discharge station, route immediately without processing
	if station.Type == domain.StationTypeDischarge {
		station.State = domain.StateCompleted
		departureTime := station.GetFloatConfig("departureTime")
		e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, nil))
		return nil
	}

	// Check if processing can start
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
	if station.Type == domain.StationTypeMerge {
		workID = "" // Multiple works, no single ID
		workFriendlyName = ""
	} else if len(station.Works) > 0 {
		workID = station.Works[0].ID
		workFriendlyName = station.Works[0].FriendlyName
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
	// Collect parent works for traceability
	parentWorks := make([]*domain.Work, len(station.Works))
	copy(parentWorks, station.Works)

	// Delegate to station logic
	if err := station.CompleteProcessing(e.generateWorkID); err != nil {
		return err
	}

	// Handle Inspection station: update quality status with random
	if station.Type == domain.StationTypeInspection && len(station.Works) > 0 {
		work := station.Works[0]
		okProbability := station.GetFloatConfig("okProbability")
		if e.random.Float64() < okProbability {
			work.QualityStatus = domain.QualityOK
		} else {
			work.QualityStatus = domain.QualityNG
		}
	}

	// Record traceability logs and work events
	switch station.Type {
	case domain.StationTypeMerge:
		// Merge: multiple parent works -> one child work
		childWork := station.Works[0]
		e.recordWorkLineage(childWork.ID, childWork.FriendlyName, parentWorks, "merge", station.ID)
		e.logWorkEvent(childWork.ID, childWork.FriendlyName, station.ID, e.currentTime, string(EventWorkMerged))

	case domain.StationTypeSplit:
		// Split: one parent work -> multiple child works
		for _, childWork := range station.Works {
			e.recordWorkLineage(childWork.ID, childWork.FriendlyName, parentWorks, "split", station.ID)
		}
		// Log event with empty work ID for split (affects multiple works)
		e.logWorkEvent("", "", station.ID, e.currentTime, string(EventWorkSplit))

	case domain.StationTypeInspection:
		// Inspection: quality status updated
		work := station.Works[0]
		e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkInspected))

	default:
		// Processing: normal completion
		if len(station.Works) > 0 {
			work := station.Works[0]
			e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventProcessingCompleted))
		}
	}

	e.logStationStatus(station, "処理完了")

	// Schedule WorkDeparted event
	departureTime := station.GetFloatConfig("departureTime")
	e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, nil))

	return nil
}

// handleWorkDeparted handles the WorkDeparted event
func (e *Engine) handleWorkDeparted(event *Event, station *domain.Station) error {
	// Save OutputIndex before getting work (for Split station routing)
	outputIndex := station.OutputIndex

	// Delegate to station logic
	work, err := station.GetOutputWork()
	if err != nil {
		return err
	}

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDeparted))
	e.logStationStatus(station, "ワーク出発")

	// Get next station with conditional routing
	nextStation, err := e.getNextStation(station, work, outputIndex)
	if err != nil {
		return err
	}

	if nextStation == nil {
		// No next station (terminal node)
		return nil
	}

	// Log routing for Discharge station
	if station.Type == domain.StationTypeDischarge {
		e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkRouted))
	}

	// Put work in transit
	e.worksInTransit[work.ID] = work

	// Schedule WorkArrived event at next station
	arrivalTime := nextStation.GetFloatConfig("arrivalTime")
	e.eventQueue.Push(NewEvent(EventWorkArrived, e.currentTime+arrivalTime, nextStation.ID, &work.ID))

	// For Split stations, check if there are more outputs
	if station.HasMoreOutputs() {
		departureTime := station.GetFloatConfig("departureTime")
		e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, nil))
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
	station.Works = nil
	station.State = domain.StateIdle

	e.logStationStatus(station, "ワーク破棄")

	return nil
}

// getNextStation determines the next station based on routing conditions
func (e *Engine) getNextStation(fromStation *domain.Station, work *domain.Work, outputIndex int) (*domain.Station, error) {
	// Collect all matching connections
	var matchingConns []domain.Connection
	for _, conn := range e.scenario.Connections {
		if conn.From != fromStation.ID {
			continue
		}

		// Check routing condition
		switch conn.Condition {
		case domain.RoutingDefault:
			matchingConns = append(matchingConns, conn)

		case domain.RoutingQualityOK:
			if work.QualityStatus == domain.QualityOK {
				matchingConns = append(matchingConns, conn)
			}

		case domain.RoutingQualityNG:
			if work.QualityStatus == domain.QualityNG {
				matchingConns = append(matchingConns, conn)
			}
		}
	}

	if len(matchingConns) == 0 {
		// No matching route (terminal node)
		return nil, nil
	}

	// For Split stations with multiple connections, use round-robin based on OutputIndex
	if fromStation.Type == domain.StationTypeSplit && len(matchingConns) > 1 {
		// Use saved OutputIndex for round-robin
		idx := outputIndex % len(matchingConns)
		return e.scenario.GetStation(matchingConns[idx].To), nil
	}

	// For other stations, return the first matching connection
	return e.scenario.GetStation(matchingConns[0].To), nil
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
		for _, work := range station.Works {
			if work.ID == workID {
				return work
			}
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
