package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/google/uuid"
)

// StationStatusLog represents a log entry for station status changes
type StationStatusLog struct {
	StationID  string
	Timestamp  float64
	StatusType string
	Value      bool
	// Signal change fields (used when StatusType == "signal_change")
	SignalName string
	OldValue   bool
	RuleID     string
}

// WorkEventLog represents a log entry for work events
type WorkEventLog struct {
	WorkID           string
	WorkFriendlyName string
	StationID        string
	Timestamp        float64
	EventType        string
	WorkType         string // Work type (e.g. "partA", "partB") for buffer slot routing
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
	pendingDepartures  map[string]bool         // Tracks stations with a pending WorkDeparted event (avoid duplicates)
	reservedStations   map[string]bool         // Stations that have a work in transit heading to them (prevents double-send)
	simDB              *SimDB                  // SimDB for managing predefined work IDs
	mergeInProgress    map[string]bool         // Tracks merge stations currently processing (stationID -> in progress)
}

// NewEngine creates a new simulation engine without initial conditions
func NewEngine(scenario *domain.Scenario) *Engine {
	return NewEngineWithInitialConditions(scenario, nil)
}

// NewEngineWithInitialConditions creates a new simulation engine with initial conditions
// workIDsByStation: map of stationID -> list of predefined work IDs
func NewEngineWithInitialConditions(scenario *domain.Scenario, workIDsByStation map[string][]string) *Engine {
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
		pendingDepartures:  make(map[string]bool),
		reservedStations:   make(map[string]bool),
		simDB:              NewSimDB(workIDsByStation),
		mergeInProgress:    make(map[string]bool),
	}
}

// Run executes the simulation until the time limit or event exhaustion
func (e *Engine) Run(simulationID, friendlyName string, timeLimit float64) (*domain.Simulation, []StationStatusLog, []WorkEventLog, []WorkLineageLog, error) {
	simulation := domain.NewSimulation(simulationID, friendlyName, e.scenario.ID)

	// Step 1: Initialize interlock rules, signals, and buffer slots for all stations
	for i := range e.scenario.Stations {
		station := &e.scenario.Stations[i]
		if station.InterlockRules == nil {
			station.InterlockRules = domain.GetDefaultInterlockConfig(station.Type)
		}
		station.InitializeSignals()
		station.InitializeBufferSlots()
	}

	// Step 2: Evaluate rules to set initial control signals
	for i := range e.scenario.Stations {
		station := &e.scenario.Stations[i]
		if err := e.evaluateAndLogSignals(station); err != nil {
			return nil, nil, nil, nil, fmt.Errorf("initial rule evaluation failed: %w", err)
		}
	}

	// Step 3: Schedule FIRST WorkCreated event for each source station
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
	case EventWorkBuffered:
		return e.handleWorkBuffered(event, station)
	case EventMergeCompleted:
		return e.handleMergeCompleted(event, station)
	case EventSplitCompleted:
		return e.handleSplitCompleted(event, station)
	case EventBufferedWorkDeparted:
		return e.handleBufferedWorkDeparted(event, station)
	default:
		return fmt.Errorf("unknown event type: %s", event.Type)
	}
}

// handleWorkCreated handles the WorkCreated event
func (e *Engine) handleWorkCreated(event *Event, station *domain.Station) error {
	// Check if we should create more works for this source
	continuous := station.GetBoolConfig("continuous")
	if !continuous {
		workCount := station.GetIntConfig("workCount")
		if e.sourceWorkCounters[station.ID] >= workCount {
			// Already created all works for this source
			return nil
		}
	}

	// Increment counter
	e.sourceWorkCounters[station.ID]++

	// Try to get work ID from SimDB, otherwise generate UUID
	var workID string
	if e.simDB != nil {
		workID = e.simDB.GetNextWorkID(station.ID)
	}
	if workID == "" {
		// No predefined ID from SimDB, generate UUID
		workID = GenerateWorkID()
	}

	// Generate friendly name using workCounter
	e.workCounter++
	friendlyName := fmt.Sprintf("work-%d", e.workCounter)

	// Create work with type if configured
	workType := station.GetStringConfig("workType")
	var work *domain.Work
	if workType != "" {
		work = domain.NewWorkWithType(workID, friendlyName, workType)
	} else {
		work = domain.NewWork(workID, friendlyName)
	}

	// Add to station (Source stations keep work internally)
	station.CurrentWork = work
	station.State = domain.StateCompleted

	// Update signal: workPresent=ON
	station.SetSignal("workPresent", true)

	// Log work event
	e.logWorkEvent(workID, friendlyName, station.ID, e.currentTime, string(EventWorkCreated), work.Type)

	// Evaluate interlock rules after signal change
	// checkHandshakes (called within) will schedule WorkDeparted if handshake is satisfied
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	return nil
}

// handleWorkArrived handles the WorkArrived event
func (e *Engine) handleWorkArrived(event *Event, station *domain.Station) error {
	// Retrieve work from transit and clear reservation
	work, ok := e.worksInTransit[*event.WorkID]
	if !ok {
		return fmt.Errorf("work not found in transit: %s", *event.WorkID)
	}
	delete(e.worksInTransit, *event.WorkID)
	delete(e.reservedStations, station.ID)

	// Merge station: add to InputBuffer instead of CurrentWork
	if station.Type == domain.StationTypeMerge {
		return e.handleMergeWorkArrived(work, station)
	}

	// Check interlock: InputReady must be ON
	if !station.IsInputReady() {
		return fmt.Errorf("interlock violation: station %s InputReady=OFF (state=%s), cannot accept work", station.ID, station.State)
	}

	// Delegate to station logic
	if err := station.AddWork(work); err != nil {
		return err
	}

	// Update signal: workPresent=ON
	station.SetSignal("workPresent", true)

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkArrived), work.Type)
	e.logStationStatus(station, "ワーク到着")

	// Evaluate interlock rules after signal change
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	// For Drain station, schedule immediate destruction
	if station.Type == domain.StationTypeDrain {
		e.eventQueue.Push(NewEvent(EventWorkDestroyed, e.currentTime, station.ID, &work.ID))
		return nil
	}

	// For Processing/Split station, schedule processing start after arrival time
	if station.CanStartProcessing() {
		arrivalTime := station.GetFloatConfig("arrivalTime")
		e.eventQueue.Push(NewEvent(EventProcessingStarted, e.currentTime+arrivalTime, station.ID, nil))
	}

	return nil
}

// handleMergeWorkArrived handles work arrival at a Merge station
func (e *Engine) handleMergeWorkArrived(work *domain.Work, station *domain.Station) error {
	// Add work to InputBuffer
	if err := station.AddWorkToBuffer(work); err != nil {
		return err
	}

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkBuffered), work.Type)
	e.logStationStatus(station, "ワークバッファ追加")

	// Evaluate inputReady based on buffer capacity
	e.updateMergeInputReady(station)

	// Check merge condition
	if station.CheckMergeCondition() && !e.mergeInProgress[station.ID] {
		e.mergeInProgress[station.ID] = true

		// Set mergeReady signal
		station.SetSignal("mergeReady", true)
		station.SetSignal("inputReady", false)

		// Schedule merge completion after processing time
		processingTime := station.GetFloatConfig("processingTime")
		e.eventQueue.Push(NewEvent(EventMergeCompleted, e.currentTime+processingTime, station.ID, nil))

		e.logStationStatus(station, "結合処理開始")
	}

	// Evaluate interlock rules
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	return nil
}

// handleWorkBuffered handles the WorkBuffered event (for logging/tracking)
func (e *Engine) handleWorkBuffered(event *Event, station *domain.Station) error {
	// This event is used for logging. Actual buffer logic is in handleMergeWorkArrived.
	return nil
}

// handleMergeCompleted handles the MergeCompleted event
func (e *Engine) handleMergeCompleted(event *Event, station *domain.Station) error {
	delete(e.mergeInProgress, station.ID)

	// Execute merge
	mergedWork, consumedWorks, err := station.ExecuteMerge(e.generateWorkID)
	if err != nil {
		return err
	}

	// Record work lineage
	e.recordWorkLineage(mergedWork.ID, mergedWork.FriendlyName, consumedWorks, "merge", station.ID)

	// Update signals
	station.SetSignal("workPresent", true)
	station.SetSignal("processingComplete", true)

	// Log events
	e.logWorkEvent(mergedWork.ID, mergedWork.FriendlyName, station.ID, e.currentTime, string(EventWorkMerged), mergedWork.Type)
	e.logStationStatus(station, "結合処理完了")

	// Evaluate interlock rules after signal change
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
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
	workType := ""
	if station.CurrentWork != nil {
		workType = station.CurrentWork.Type
	}
	e.logWorkEvent(workID, workFriendlyName, station.ID, e.currentTime, string(EventProcessingStarted), workType)
	e.logStationStatus(station, "処理開始")

	// Schedule ProcessingCompleted event
	processingTime := station.GetFloatConfig("processingTime")
	e.eventQueue.Push(NewEvent(EventProcessingCompleted, e.currentTime+processingTime, station.ID, nil))

	return nil
}

// handleProcessingCompleted handles the ProcessingCompleted event
func (e *Engine) handleProcessingCompleted(event *Event, station *domain.Station) error {
	// Split station: split the work into components
	if station.Type == domain.StationTypeSplit {
		return e.handleSplitProcessingCompleted(station)
	}

	// Delegate to station logic
	if err := station.CompleteProcessing(e.generateWorkID); err != nil {
		return err
	}

	// Update signal: processingComplete=ON
	station.SetSignal("processingComplete", true)

	// Log work event (Processing: normal completion)
	if station.CurrentWork != nil {
		e.logWorkEvent(station.CurrentWork.ID, station.CurrentWork.FriendlyName, station.ID, e.currentTime, string(EventProcessingCompleted), station.CurrentWork.Type)
	}

	e.logStationStatus(station, "処理完了")

	// Evaluate interlock rules after signal change
	// checkHandshakes (called within) will schedule WorkDeparted if handshake is satisfied
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	return nil
}

// handleSplitProcessingCompleted handles processing completion for Split stations
func (e *Engine) handleSplitProcessingCompleted(station *domain.Station) error {
	// Mark as processing complete first
	station.State = domain.StateCompleted

	// Execute split
	splitWorks, err := station.ExecuteSplit(e.generateWorkID)
	if err != nil {
		return err
	}

	// Record work lineage for each split work
	for _, splitWork := range splitWorks {
		e.logWorkEvent(splitWork.ID, splitWork.FriendlyName, station.ID, e.currentTime, string(EventWorkSplit), splitWork.Type)
	}

	// Update signals
	station.SetSignal("processingComplete", true)
	if station.CurrentWork != nil {
		station.SetSignal("workPresent", true)
	}

	e.logStationStatus(station, "分割処理完了")

	// Evaluate interlock rules
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	return nil
}

// handleSplitCompleted handles the SplitCompleted event (placeholder for future use)
func (e *Engine) handleSplitCompleted(event *Event, station *domain.Station) error {
	return nil
}

// handleWorkDeparted handles the WorkDeparted event
// This event is triggered by checkHandshakes when upstream.outputReady=ON AND downstream.inputReady=ON
func (e *Engine) handleWorkDeparted(event *Event, station *domain.Station) error {
	// Clear pending departure flag
	delete(e.pendingDepartures, station.ID)

	// Re-verify handshake: conditions may have changed since scheduling
	if !station.IsOutputReady() || station.CurrentWork == nil {
		return nil // Conditions changed, skip departure
	}

	// Verify downstream inputReady and not already reserved
	nextStation, err := e.getNextStation(station, station.CurrentWork)
	if err != nil {
		return err
	}
	if nextStation != nil && (!nextStation.IsInputReady() || e.reservedStations[nextStation.ID]) {
		return nil // Downstream not ready or already reserved, skip departure
	}

	// Delegate to station logic
	work, err := station.GetOutputWork()
	if err != nil {
		return err
	}

	// Update signal: workPresent=OFF
	station.SetSignal("workPresent", false)

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDeparted), work.Type)
	e.logStationStatus(station, "ワーク出発")

	// Evaluate interlock rules after signal change (cascading: OR=OFF → PC=OFF → IR=ON)
	// checkHandshakes (called within) may schedule further departures for upstream stations
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	// For Split stations: check if there are more works in OutputBufferSlots
	if station.Type == domain.StationTypeSplit && station.HasOutputBufferWorks() {
		nextOutputWork := station.GetNextOutputBufferWork()
		if nextOutputWork != nil {
			station.CurrentWork = nextOutputWork
			station.State = domain.StateCompleted
			station.SetSignal("workPresent", true)
			station.SetSignal("processingComplete", true)

			// Re-evaluate to trigger next handshake
			if err := e.evaluateAndLogSignals(station); err != nil {
				return err
			}
		}
	} else if station.Type == domain.StationTypeSplit && !station.HasOutputBufferWorks() {
		// All split works dispatched, re-enable input
		// Signals should cascade via rules: workPresent=OFF → processingComplete=OFF → inputReady=ON
	}

	// Update merge inputReady if downstream is a merge station
	if nextStation != nil && nextStation.Type == domain.StationTypeMerge {
		e.updateMergeInputReady(nextStation)
	}

	if nextStation == nil {
		return nil
	}

	// Put work in transit and reserve the destination station
	e.worksInTransit[work.ID] = work
	e.reservedStations[nextStation.ID] = true

	// Schedule WorkArrived event at next station (departureTime + arrivalTime)
	departureTime := station.GetFloatConfig("departureTime")
	arrivalTime := nextStation.GetFloatConfig("arrivalTime")
	transitTime := departureTime + arrivalTime
	e.eventQueue.Push(NewEvent(EventWorkArrived, e.currentTime+transitTime, nextStation.ID, &work.ID))

	// For Source stations: Schedule next work creation (interlock: one at a time)
	if station.Type == domain.StationTypeSource {
		continuous := station.GetBoolConfig("continuous")
		shouldCreate := continuous
		if !continuous {
			workCount := station.GetIntConfig("workCount")
			shouldCreate = e.sourceWorkCounters[station.ID] < workCount
		}
		if shouldCreate {
			departureTime := station.GetFloatConfig("departureTime")
			e.eventQueue.Push(NewEvent(EventWorkCreated, e.currentTime+departureTime, station.ID, nil))
		}
	}

	return nil
}

// handleBufferedWorkDeparted handles the BufferedWorkDeparted event (for Split OutputBuffer)
func (e *Engine) handleBufferedWorkDeparted(event *Event, station *domain.Station) error {
	// This is handled inline in handleWorkDeparted for Split stations
	return nil
}

// handleWorkDestroyed handles the WorkDestroyed event
func (e *Engine) handleWorkDestroyed(event *Event, station *domain.Station) error {
	work := e.findWorkByID(*event.WorkID)
	if work == nil {
		return fmt.Errorf("work not found: %s", *event.WorkID)
	}

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDestroyed), work.Type)

	// Clear station
	station.CurrentWork = nil
	station.State = domain.StateIdle

	// Update signal: workPresent=OFF
	station.SetSignal("workPresent", false)

	e.logStationStatus(station, "ワーク破棄")

	// Evaluate interlock rules after signal change
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	return nil
}

// getNextStation determines the next station based on routing conditions
func (e *Engine) getNextStation(fromStation *domain.Station, work *domain.Work) (*domain.Station, error) {
	var defaultStation *domain.Station

	for _, conn := range e.scenario.Connections {
		if conn.From != fromStation.ID {
			continue
		}

		condition := string(conn.Condition)

		// Check workType routing: "workType:xxx"
		if strings.HasPrefix(condition, "workType:") {
			expectedType := condition[len("workType:"):]
			if work != nil && work.Type == expectedType {
				return e.scenario.GetStation(conn.To), nil
			}
			continue
		}

		// Default routing
		if conn.Condition == domain.RoutingDefault || conn.Condition == "" {
			defaultStation = e.scenario.GetStation(conn.To)
		}
	}

	// Return default if no workType match found
	return defaultStation, nil
}

// updateMergeInputReady updates the inputReady signal for a Merge station based on buffer slot capacity
func (e *Engine) updateMergeInputReady(station *domain.Station) {
	if station.Type != domain.StationTypeMerge {
		return
	}

	// If merge is in progress, keep inputReady OFF
	if e.mergeInProgress[station.ID] {
		station.SetSignal("inputReady", false)
		return
	}

	station.SetSignal("inputReady", station.HasBufferCapacity())
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
		// Check InputBufferSlots
		for _, slot := range station.InputBufferSlots {
			for _, work := range slot.Works {
				if work.ID == workID {
					return work
				}
			}
		}
		// Check OutputBufferSlots
		for _, slot := range station.OutputBufferSlots {
			for _, work := range slot.Works {
				if work.ID == workID {
					return work
				}
			}
		}
	}
	return nil
}

// logWorkEvent logs a work event
func (e *Engine) logWorkEvent(workID, workFriendlyName, stationID string, timestamp float64, eventType string, workType string) {
	e.workEventLogs = append(e.workEventLogs, WorkEventLog{
		WorkID:           workID,
		WorkFriendlyName: workFriendlyName,
		StationID:        stationID,
		Timestamp:        timestamp,
		EventType:        eventType,
		WorkType:         workType,
	})
}

// logStationStatus logs a station status change
func (e *Engine) logStationStatus(station *domain.Station, statusType string) {
	// Log current state as status
	var value bool
	switch statusType {
	case "ワーク到着", "処理開始", "処理完了", "ワーク出発", "ワーク破棄",
		"ワークバッファ追加", "結合処理開始", "結合処理完了", "分割処理完了":
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

// evaluateAndLogSignals evaluates interlock rules, logs signal changes, and checks handshakes
func (e *Engine) evaluateAndLogSignals(station *domain.Station) error {
	changes, err := evaluateRules(station, e.scenario, e.currentTime)
	if err != nil {
		return err
	}

	// Convert signal changes to status logs
	for _, change := range changes {
		e.statusLogs = append(e.statusLogs, StationStatusLog{
			StationID:  change.StationID,
			Timestamp:  change.Timestamp,
			StatusType: "signal_change",
			Value:      change.NewValue,
			SignalName: change.SignalName,
			OldValue:   change.OldValue,
			RuleID:     change.RuleID,
		})
	}

	// After signal changes, check if any transfer handshakes are newly satisfied
	return e.checkHandshakes(station)
}

// checkHandshakes checks if transfer handshakes are satisfied after signal changes.
// A transfer begins when upstream.outputReady=ON AND downstream.inputReady=ON.
// This is called after every signal evaluation to detect newly satisfied conditions.
func (e *Engine) checkHandshakes(station *domain.Station) error {
	// Case 1: This station is upstream — its outputReady may have just turned ON
	if station.IsOutputReady() && station.CurrentWork != nil && !e.pendingDepartures[station.ID] {
		for _, conn := range e.scenario.Connections {
			if conn.From == station.ID {
				toStation := e.scenario.GetStation(conn.To)
				if toStation != nil && toStation.IsInputReady() && !e.reservedStations[toStation.ID] {
					// For Merge downstream: check buffer slot capacity by workType
					if toStation.Type == domain.StationTypeMerge && station.CurrentWork != nil {
						if toStation.IsBufferSlotFullForWorkType(station.CurrentWork.Type) {
							continue
						}
					}
					e.pendingDepartures[station.ID] = true
					e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, station.ID, nil))
					break
				}
			}
		}
	}

	// Case 2: This station is downstream — its inputReady may have just turned ON
	if station.IsInputReady() && !e.reservedStations[station.ID] {
		for _, conn := range e.scenario.Connections {
			if conn.To == station.ID {
				fromStation := e.scenario.GetStation(conn.From)
				if fromStation != nil && fromStation.IsOutputReady() && fromStation.CurrentWork != nil && !e.pendingDepartures[fromStation.ID] {
					// For Merge station: check buffer slot capacity by workType
					if station.Type == domain.StationTypeMerge {
						if station.IsBufferSlotFullForWorkType(fromStation.CurrentWork.Type) {
							continue
						}
					}
					e.pendingDepartures[fromStation.ID] = true
					e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, fromStation.ID, nil))
				}
			}
		}
	}

	return nil
}
