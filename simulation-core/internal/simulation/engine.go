package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
	"math/rand"
	"time"
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
	scenario      *domain.Scenario
	eventQueue    *PriorityQueue
	currentTime   float64
	workCounter   int
	statusLogs    []StationStatusLog
	workEventLogs []WorkEventLog
	random        *rand.Rand
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
		random:        rand.New(rand.NewSource(time.Now().UnixNano())),
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
	t := e.currentTime
	var work *domain.Work
	var workID string

	// Handle Split Station
	if station.Type == domain.StationTypeSplit && len(station.OutputWorks) > 0 {
		// Get the current output work
		work = station.OutputWorks[station.OutputIndex]
		workID = work.ID

		// Log work event
		e.logWorkEvent(workID, station.ID, e.currentTime, "WorkDeparted")

		// Update station: work departure time
		station.WorkDepartureTime = &t

		// Increment output index
		station.OutputIndex++

		// Check if there are more works to output
		if station.OutputIndex < len(station.OutputWorks) {
			// Schedule next WorkDeparted event
			departureTime := station.GetFloatConfig("departureTime")
			nextWorkID := station.OutputWorks[station.OutputIndex].ID
			e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, &nextWorkID))
		} else {
			// All works have been output, clean up
			station.OutputWorks = nil
			station.OutputIndex = 0

			// Set CanDepart status OFF
			station.CanDepart = false
			station.CanDepartOffTime = &t
			e.logStationStatus(station.ID, e.currentTime, "搬出可OFF", false)

			// Set CanReceive status ON (station is now empty)
			station.CanReceive = true
			station.CanReceiveOnTime = &t
			e.logStationStatus(station.ID, e.currentTime, "搬入可ON", true)
		}

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

	// Regular station handling
	if station.CurrentWork == nil {
		return fmt.Errorf("no work to depart from station %s", station.ID)
	}

	workID = station.CurrentWork.ID

	// Log work event
	e.logWorkEvent(workID, station.ID, e.currentTime, "WorkDeparted")

	// Update station: work departure time
	station.WorkDepartureTime = &t

	// Set CanDepart status OFF
	station.CanDepart = false
	station.CanDepartOffTime = &t
	e.logStationStatus(station.ID, e.currentTime, "搬出可OFF", false)

	// Remove work from current station
	work = station.CurrentWork
	station.CurrentWork = nil

	// Set CanReceive status ON (station is now empty)
	station.CanReceive = true
	station.CanReceiveOnTime = &t
	e.logStationStatus(station.ID, e.currentTime, "搬入可ON", true)

	// For Discharge station, route based on quality status
	if station.Type == domain.StationTypeDischarge {
		nextStations := e.scenario.GetNextStations(station.ID)
		if len(nextStations) < 2 {
			return fmt.Errorf("discharge station %s needs at least 2 next stations", station.ID)
		}

		var nextStationID string
		if work.QualityStatus == domain.QualityOK {
			nextStationID = nextStations[0] // OK -> first next station
		} else {
			nextStationID = nextStations[1] // NG -> second next station
		}

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

	// Schedule WorkArrived event for next station (regular flow)
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
	// For Merge stations, add directly to CurrentWorks (don't use CurrentWork)
	if nextStation.Type == domain.StationTypeMerge {
		nextStation.CurrentWorks = append(nextStation.CurrentWorks, work)
	} else {
		nextStation.CurrentWork = work
	}

	return nil
}

// handleWorkArrived handles WorkArrived event
func (e *Engine) handleWorkArrived(station *domain.Station, event *Event) error {
	// For Merge station, CurrentWork may be nil if this is not the first arrival
	// So we check the event.WorkID instead
	var workID string
	if event.WorkID != nil {
		workID = *event.WorkID
	} else if station.CurrentWork != nil {
		workID = station.CurrentWork.ID
	} else {
		return fmt.Errorf("no work ID in event and no current work at station %s", station.ID)
	}

	// Log work event
	e.logWorkEvent(workID, station.ID, e.currentTime, "WorkArrived")

	// Update station: work arrival time
	t := e.currentTime
	station.WorkArrivalTime = &t

	// Check station type
	if station.Type == domain.StationTypeDrain {
		// Set CanReceive status OFF
		station.CanReceive = false
		station.CanReceiveOffTime = &t
		e.logStationStatus(station.ID, e.currentTime, "搬入可OFF", false)

		// For drain station, schedule WorkDestroyed immediately
		e.eventQueue.Push(NewEvent(EventWorkDestroyed, e.currentTime, station.ID, &workID))
		return nil
	}

	if station.Type == domain.StationTypeMerge {
		// For merge station, works are already in CurrentWorks (added in handleWorkDeparted)
		// Just check if we have enough works now
		requiredWorkCount := station.GetIntConfig("requiredWorkCount")
		// Only schedule ProcessingStarted when we JUST reached the required count
		if len(station.CurrentWorks) == requiredWorkCount {
			// Set CanReceive status OFF (no more works needed)
			station.CanReceive = false
			station.CanReceiveOffTime = &t
			e.logStationStatus(station.ID, e.currentTime, "搬入可OFF", false)

			// Processing ready condition: required number of works arrived
			station.ProcessingReady = true
			station.ProcessingReadyTime = &t
			e.logStationStatus(station.ID, e.currentTime, "処理条件成立", true)

			// Schedule ProcessingStarted event (only once)
			e.eventQueue.Push(NewEvent(EventProcessingStarted, e.currentTime, station.ID, nil))
		} else if len(station.CurrentWorks) < requiredWorkCount {
			// Still waiting for more works, keep CanReceive ON
			// Don't set CanReceive OFF here
		}
		// If len(CurrentWorks) > requiredWorkCount, ignore extra works
		return nil
	}

	if station.Type == domain.StationTypeDischarge {
		if station.CurrentWork == nil {
			return fmt.Errorf("no work at discharge station %s", station.ID)
		}
		// For discharge station, check quality status and route
		// Set CanReceive status OFF
		station.CanReceive = false
		station.CanReceiveOffTime = &t
		e.logStationStatus(station.ID, e.currentTime, "搬入可OFF", false)

		// Log routing event
		e.logWorkEvent(workID, station.ID, e.currentTime, "WorkRouted")

		// Set CanDepart status ON immediately (no processing needed)
		station.CanDepart = true
		station.CanDepartOnTime = &t
		e.logStationStatus(station.ID, e.currentTime, "搬出可ON", true)

		// Schedule WorkDeparted event
		departureTime := station.GetFloatConfig("departureTime")
		e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, &workID))
		return nil
	}

	// For regular processing/inspection stations
	if station.CurrentWork == nil {
		return fmt.Errorf("no work arrived at station %s", station.ID)
	}

	// Set CanReceive status OFF for regular processing/inspection stations
	station.CanReceive = false
	station.CanReceiveOffTime = &t
	e.logStationStatus(station.ID, e.currentTime, "搬入可OFF", false)

	// For processing/inspection station, check processing ready condition
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
	// For Merge station, CurrentWork is nil (works are in CurrentWorks array)
	var workID string
	if station.Type == domain.StationTypeMerge {
		// Log processing started for merge station
		workID = "" // No single work ID for merge processing
	} else {
		if station.CurrentWork == nil {
			return fmt.Errorf("no work at station %s for processing", station.ID)
		}
		workID = station.CurrentWork.ID
	}

	// Log work event (skip for merge station)
	if workID != "" {
		e.logWorkEvent(workID, station.ID, e.currentTime, "ProcessingStarted")
	}

	// Set ProcessingStarted status ON
	station.ProcessingStarted = true
	t := e.currentTime
	station.ProcessingStartTime = &t
	e.logStationStatus(station.ID, e.currentTime, "処理開始", true)

	// Schedule ProcessingCompleted event
	processingTime := station.GetFloatConfig("processingTime")
	if workID != "" {
		e.eventQueue.Push(NewEvent(EventProcessingCompleted, e.currentTime+processingTime, station.ID, &workID))
	} else {
		e.eventQueue.Push(NewEvent(EventProcessingCompleted, e.currentTime+processingTime, station.ID, nil))
	}

	return nil
}

// handleProcessingCompleted handles ProcessingCompleted event
func (e *Engine) handleProcessingCompleted(station *domain.Station, event *Event) error {
	t := e.currentTime

	// Handle Merge Station
	if station.Type == domain.StationTypeMerge {
		// Generate new merged work ID
		e.workCounter++
		mergedWorkID := fmt.Sprintf("work-%03d", e.workCounter)
		mergedWork := domain.NewWork(mergedWorkID)

		// Set parent work IDs for traceability
		mergedWork.ParentWorkIDs = make([]string, len(station.CurrentWorks))
		for i, work := range station.CurrentWorks {
			mergedWork.ParentWorkIDs[i] = work.ID
		}

		// Clear CurrentWorks and set merged work
		station.CurrentWorks = nil
		station.CurrentWork = mergedWork

		// Log merged event
		e.logWorkEvent(mergedWorkID, station.ID, e.currentTime, "WorkMerged")

		// Set ProcessingCompleted status ON
		station.ProcessingCompleted = true
		station.ProcessingCompleteTime = &t
		e.logStationStatus(station.ID, e.currentTime, "処理完了", true)

		// Set CanDepart status ON
		station.CanDepart = true
		station.CanDepartOnTime = &t
		e.logStationStatus(station.ID, e.currentTime, "搬出可ON", true)

		// Schedule WorkDeparted event
		departureTime := station.GetFloatConfig("departureTime")
		e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, &mergedWorkID))

		return nil
	}

	// Handle Split Station
	if station.Type == domain.StationTypeSplit {
		originWorkID := station.CurrentWork.ID
		outputWorkCount := station.GetIntConfig("outputWorkCount")

		// Generate split works
		station.OutputWorks = make([]*domain.Work, outputWorkCount)
		for i := 0; i < outputWorkCount; i++ {
			e.workCounter++
			splitWorkID := fmt.Sprintf("work-%03d", e.workCounter)
			splitWork := domain.NewWork(splitWorkID)
			splitWork.OriginWorkID = originWorkID
			station.OutputWorks[i] = splitWork
		}

		// Clear current work
		station.CurrentWork = nil

		// Log split event
		e.logWorkEvent(originWorkID, station.ID, e.currentTime, "WorkSplit")

		// Set ProcessingCompleted status ON
		station.ProcessingCompleted = true
		station.ProcessingCompleteTime = &t
		e.logStationStatus(station.ID, e.currentTime, "処理完了", true)

		// Set CanDepart status ON
		station.CanDepart = true
		station.CanDepartOnTime = &t
		e.logStationStatus(station.ID, e.currentTime, "搬出可ON", true)

		// Schedule first WorkDeparted event
		departureTime := station.GetFloatConfig("departureTime")
		firstWorkID := station.OutputWorks[0].ID
		e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, &firstWorkID))

		return nil
	}

	// Handle Inspection Station
	if station.Type == domain.StationTypeInspection {
		workID := station.CurrentWork.ID

		// Determine OK/NG based on okProbability
		okProbability := station.GetFloatConfig("okProbability")
		randomValue := e.random.Float64()
		if randomValue < okProbability {
			station.CurrentWork.QualityStatus = domain.QualityOK
		} else {
			station.CurrentWork.QualityStatus = domain.QualityNG
		}

		// Log inspection event
		e.logWorkEvent(workID, station.ID, e.currentTime, "WorkInspected")

		// Set ProcessingCompleted status ON
		station.ProcessingCompleted = true
		station.ProcessingCompleteTime = &t
		e.logStationStatus(station.ID, e.currentTime, "処理完了", true)

		// Set CanDepart status ON
		station.CanDepart = true
		station.CanDepartOnTime = &t
		e.logStationStatus(station.ID, e.currentTime, "搬出可ON", true)

		// Schedule WorkDeparted event
		departureTime := station.GetFloatConfig("departureTime")
		e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime+departureTime, station.ID, &workID))

		return nil
	}

	// Regular Processing Station
	workID := station.CurrentWork.ID

	// Log work event
	e.logWorkEvent(workID, station.ID, e.currentTime, "ProcessingCompleted")

	// Set ProcessingCompleted status ON
	station.ProcessingCompleted = true
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
