package simulation

import (
	"factory-simulation/simulation-core/internal/domain"
	"fmt"
	"log"
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
	WorkType         string // Work type (e.g. "partA", "partB")
	BufferIndex      int    // Buffer slot index (-1 = no buffer)
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
	initialWorks       map[string]InitialWorkCondition // Initial work conditions by station ID
}

// InitialWorkCondition represents a work already present at a station at simulation start
type InitialWorkCondition struct {
	WorkID        string
	QualityStatus string
	ElapsedTime   float64 // Seconds already elapsed in processing
}

// NewEngine creates a new simulation engine without initial conditions
func NewEngine(scenario *domain.Scenario) *Engine {
	return NewEngineWithInitialConditions(scenario, nil, nil)
}

// NewEngineWithInitialConditions creates a new simulation engine with initial conditions
// workIDsByStation: map of stationID -> list of predefined work IDs
// initialWorks: map of stationID -> initial work condition (work already at station)
func NewEngineWithInitialConditions(scenario *domain.Scenario, workIDsByStation map[string][]string, initialWorks map[string]InitialWorkCondition) *Engine {
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
		initialWorks:       initialWorks,
	}
}

// Run executes the simulation until the time limit or event exhaustion
func (e *Engine) Run(simulationID, friendlyName string, timeLimit float64) (*domain.Simulation, []StationStatusLog, []WorkEventLog, []WorkLineageLog, error) {
	simulation := domain.NewSimulation(simulationID, friendlyName, e.scenario.ID)

	// Step 1: Initialize interlock rules, signals, and buffer slots for all stations
	for i := range e.scenario.Stations {
		station := &e.scenario.Stations[i]
		// Load custom interlock rules from config (saved by editor)
		station.InitializeInterlockRulesFromConfig()
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

	// Step 3: Place initial works at stations (if specified)
	if err := e.placeInitialWorks(); err != nil {
		return nil, nil, nil, nil, fmt.Errorf("initial work placement failed: %w", err)
	}

	// Step 4: Schedule FIRST WorkCreated event for each source station
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

	// Update signal: workPresent=ON, workType:<type>=ON
	station.SetSignal("workPresent", true)
	setWorkTypeSignal(station.Signals, work.Type)

	// Log work event
	e.logWorkEvent(workID, friendlyName, station.ID, e.currentTime, string(EventWorkCreated), work.Type, -1)

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

	// Merge station: add to InputBuffer instead of CurrentWork
	if station.Type == domain.StationTypeMerge {
		bufferIndex := e.findToBufferIndex(*event.WorkID, station.ID)
		// Clear buffer-level reservation
		delete(e.reservedStations, e.bufferReservationKey(station.ID, bufferIndex))
		return e.handleMergeWorkArrived(work, station, bufferIndex)
	}

	// Clear station-level reservation
	delete(e.reservedStations, station.ID)

	// Check interlock: InputReady must be ON
	if !station.IsInputReady() {
		return fmt.Errorf("interlock violation: station %s InputReady=OFF (state=%s), cannot accept work", station.ID, station.State)
	}

	// Delegate to station logic
	if err := station.AddWork(work); err != nil {
		return err
	}

	// Update signal: workPresent=ON, workType:<type>=ON
	station.SetSignal("workPresent", true)
	setWorkTypeSignal(station.Signals, work.Type)

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkArrived), work.Type, -1)
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

// handleMergeWorkArrived handles work arrival at a Merge station's input buffer
func (e *Engine) handleMergeWorkArrived(work *domain.Work, station *domain.Station, bufferIndex int) error {
	// Add work to the specified InputBuffer slot
	if err := station.AddWorkToBuffer(work, bufferIndex); err != nil {
		return err
	}

	// Log work event with buffer index
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkBuffered), work.Type, bufferIndex)
	e.logStationStatus(station, "ワークバッファ追加")

	// Update derived signals for this buffer (workPresent, bufferFull)
	e.updateBufferDerivedSignals(station, bufferIndex, true)

	// Check merge condition (all buffers have required works)
	if station.CheckMergeCondition() && !e.mergeInProgress[station.ID] {
		e.mergeInProgress[station.ID] = true

		// Set mergeReady signal on the station
		station.SetSignal("mergeReady", true)

		// Schedule merge completion after processing time
		processingTime := station.GetFloatConfig("processingTime")
		e.eventQueue.Push(NewEvent(EventMergeCompleted, e.currentTime+processingTime, station.ID, nil))

		e.logStationStatus(station, "結合処理開始")
	}

	// Evaluate station-level interlock rules
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

	// Update buffer derived signals (buffers are now empty)
	for i := range station.InputBufferSlots {
		e.updateBufferDerivedSignals(station, i, true)
	}

	// Update station signals
	station.SetSignal("workPresent", true)
	setWorkTypeSignal(station.Signals, mergedWork.Type)
	station.SetSignal("processingComplete", true)

	// Log events
	e.logWorkEvent(mergedWork.ID, mergedWork.FriendlyName, station.ID, e.currentTime, string(EventWorkMerged), mergedWork.Type, -1)
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
	e.logWorkEvent(workID, workFriendlyName, station.ID, e.currentTime, string(EventProcessingStarted), workType, -1)
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
		e.logWorkEvent(station.CurrentWork.ID, station.CurrentWork.FriendlyName, station.ID, e.currentTime, string(EventProcessingCompleted), station.CurrentWork.Type, -1)
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

	// Execute split (places works into OutputBufferSlots by index, clears CurrentWork)
	splitWorks, err := station.ExecuteSplit(e.generateWorkID)
	if err != nil {
		return err
	}

	// Record work lineage and log events for each split work with buffer index
	for i, splitWork := range splitWorks {
		e.logWorkEvent(splitWork.ID, splitWork.FriendlyName, station.ID, e.currentTime, string(EventWorkSplit), splitWork.Type, i)
	}

	// Update derived signals for each output buffer (workPresent, then evaluate outputReady)
	for i := range station.OutputBufferSlots {
		e.updateBufferDerivedSignals(station, i, false)
	}

	// Update station-level signals: processingComplete=ON, workPresent=OFF (body is empty after split)
	station.SetSignal("processingComplete", true)
	station.SetSignal("workPresent", false)
	clearWorkTypeSignals(station.Signals)

	e.logStationStatus(station, "分割処理完了")

	// Evaluate station-level interlock rules
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
	nextStation, conn, err := e.getNextStationWithConn(station, station.CurrentWork)
	if err != nil {
		return err
	}
	if nextStation != nil {
		// For merge downstream: check buffer-level inputReady
		if nextStation.Type == domain.StationTypeMerge && conn != nil && conn.ToBufferIndex >= 0 {
			if !nextStation.IsBufferInputReady(conn.ToBufferIndex) || e.reservedStations[e.bufferReservationKey(nextStation.ID, conn.ToBufferIndex)] {
				return nil
			}
		} else if !nextStation.IsInputReady() || e.reservedStations[nextStation.ID] {
			return nil
		}
	}

	// Delegate to station logic
	work, err := station.GetOutputWork()
	if err != nil {
		return err
	}

	// Update signal: workPresent=OFF, clear workType
	station.SetSignal("workPresent", false)
	clearWorkTypeSignals(station.Signals)

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDeparted), work.Type, -1)
	e.logStationStatus(station, "ワーク出発")

	// Evaluate interlock rules after signal change (cascading: OR=OFF → PC=OFF → IR=ON)
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	if nextStation == nil {
		return nil
	}

	// Reserve destination (buffer-level for merge, station-level otherwise)
	if nextStation.Type == domain.StationTypeMerge && conn != nil && conn.ToBufferIndex >= 0 {
		e.reservedStations[e.bufferReservationKey(nextStation.ID, conn.ToBufferIndex)] = true
	} else {
		e.reservedStations[nextStation.ID] = true
	}

	// Put work in transit
	e.worksInTransit[work.ID] = work

	// Schedule WorkArrived event at next station
	departureTime := station.GetFloatConfig("departureTime")
	arrivalTime := nextStation.GetFloatConfig("arrivalTime")
	transitTime := departureTime + arrivalTime
	e.eventQueue.Push(NewEvent(EventWorkArrived, e.currentTime+transitTime, nextStation.ID, &work.ID))

	// For Source stations: Schedule next work creation
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
// event.WorkID contains a key like "bufferIndex:N" encoded in the work ID field
func (e *Engine) handleBufferedWorkDeparted(event *Event, station *domain.Station) error {
	// Clear pending departure flag
	bufferIndex := e.findBufferedDepartureIndex(event)
	if bufferIndex < 0 {
		return nil
	}
	depKey := e.bufferDepartureKey(station.ID, bufferIndex)
	delete(e.pendingDepartures, depKey)

	// Re-verify: buffer outputReady must still be ON
	if !station.IsBufferOutputReady(bufferIndex) {
		return nil
	}

	// Find the connection from this buffer
	conn := e.findConnectionFromBuffer(station.ID, bufferIndex)
	if conn == nil {
		return nil
	}

	toStation := e.scenario.GetStation(conn.To)
	if toStation == nil {
		return nil
	}

	// Check downstream readiness
	if toStation.Type == domain.StationTypeMerge && conn.ToBufferIndex >= 0 {
		if !toStation.IsBufferInputReady(conn.ToBufferIndex) || e.reservedStations[e.bufferReservationKey(toStation.ID, conn.ToBufferIndex)] {
			return nil
		}
	} else {
		if !toStation.IsInputReady() || e.reservedStations[toStation.ID] {
			return nil
		}
	}

	// Get work from the buffer
	work := station.GetOutputBufferWorkByIndex(bufferIndex)
	if work == nil {
		return nil
	}

	// Update buffer derived signals
	e.updateBufferDerivedSignals(station, bufferIndex, false)

	// Check if all output buffers are empty → reset station for next input
	if !station.HasOutputBufferWorks() {
		station.SetSignal("processingComplete", false)
		// Evaluate station-level rules to re-enable inputReady
		if err := e.evaluateAndLogSignals(station); err != nil {
			return err
		}
	}

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDeparted), work.Type, bufferIndex)
	e.logStationStatus(station, "ワーク出発(バッファ)")

	// Reserve destination
	if toStation.Type == domain.StationTypeMerge && conn.ToBufferIndex >= 0 {
		e.reservedStations[e.bufferReservationKey(toStation.ID, conn.ToBufferIndex)] = true
	} else {
		e.reservedStations[toStation.ID] = true
	}

	// Put work in transit
	e.worksInTransit[work.ID] = work

	// Schedule WorkArrived
	departureTime := station.GetFloatConfig("departureTime")
	arrivalTime := toStation.GetFloatConfig("arrivalTime")
	transitTime := departureTime + arrivalTime
	e.eventQueue.Push(NewEvent(EventWorkArrived, e.currentTime+transitTime, toStation.ID, &work.ID))

	return nil
}

// handleWorkDestroyed handles the WorkDestroyed event
func (e *Engine) handleWorkDestroyed(event *Event, station *domain.Station) error {
	work := e.findWorkByID(*event.WorkID)
	if work == nil {
		return fmt.Errorf("work not found: %s", *event.WorkID)
	}

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDestroyed), work.Type, -1)

	// Clear station
	station.CurrentWork = nil
	station.State = domain.StateIdle

	// Update signal: workPresent=OFF, clear workType
	station.SetSignal("workPresent", false)
	clearWorkTypeSignals(station.Signals)

	e.logStationStatus(station, "ワーク破棄")

	// Evaluate interlock rules after signal change
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	return nil
}

// getNextStation determines the next station based on routing conditions (legacy, non-buffer)
func (e *Engine) getNextStation(fromStation *domain.Station, work *domain.Work) (*domain.Station, error) {
	station, _, err := e.getNextStationWithConn(fromStation, work)
	return station, err
}

// getNextStationWithConn determines the next station and returns the matching connection
func (e *Engine) getNextStationWithConn(fromStation *domain.Station, work *domain.Work) (*domain.Station, *domain.Connection, error) {
	var defaultStation *domain.Station
	var defaultConn *domain.Connection

	for i, conn := range e.scenario.Connections {
		if conn.From != fromStation.ID {
			continue
		}

		condition := string(conn.Condition)

		// Check workType routing: "workType:xxx"
		if strings.HasPrefix(condition, "workType:") {
			expectedType := condition[len("workType:"):]
			if work != nil && work.Type == expectedType {
				return e.scenario.GetStation(conn.To), &e.scenario.Connections[i], nil
			}
			continue
		}

		// Default routing
		if conn.Condition == domain.RoutingDefault || conn.Condition == "" {
			defaultStation = e.scenario.GetStation(conn.To)
			defaultConn = &e.scenario.Connections[i]
		}
	}

	return defaultStation, defaultConn, nil
}

// findToBufferIndex finds the ToBufferIndex for a work arriving at a merge station.
// It looks up the buffer reservation to determine which buffer the work was destined for.
func (e *Engine) findToBufferIndex(workID string, toStationID string) int {
	// Check which buffer reservation exists for this station
	for _, conn := range e.scenario.Connections {
		if conn.To == toStationID && conn.ToBufferIndex >= 0 {
			resKey := e.bufferReservationKey(toStationID, conn.ToBufferIndex)
			if e.reservedStations[resKey] {
				return conn.ToBufferIndex
			}
		}
	}
	// Fallback: find first connection to this station with a buffer index
	for _, conn := range e.scenario.Connections {
		if conn.To == toStationID && conn.ToBufferIndex >= 0 {
			return conn.ToBufferIndex
		}
	}
	return 0
}

// findConnectionFromBuffer finds the connection from a specific output buffer of a station
func (e *Engine) findConnectionFromBuffer(stationID string, bufferIndex int) *domain.Connection {
	for i, conn := range e.scenario.Connections {
		if conn.From == stationID && conn.FromBufferIndex == bufferIndex {
			return &e.scenario.Connections[i]
		}
	}
	return nil
}

// findConnectionToBuffer finds the connection to a specific input buffer of a station
func (e *Engine) findConnectionToBuffer(stationID string, bufferIndex int) *domain.Connection {
	for i, conn := range e.scenario.Connections {
		if conn.To == stationID && conn.ToBufferIndex == bufferIndex {
			return &e.scenario.Connections[i]
		}
	}
	return nil
}

// bufferReservationKey creates a unique key for buffer-level reservation
func (e *Engine) bufferReservationKey(stationID string, bufferIndex int) string {
	return fmt.Sprintf("%s:buf:%d", stationID, bufferIndex)
}

// bufferDepartureKey creates a unique key for buffer-level pending departures
func (e *Engine) bufferDepartureKey(stationID string, bufferIndex int) string {
	return fmt.Sprintf("%s:bufdep:%d", stationID, bufferIndex)
}

// findBufferedDepartureIndex extracts the buffer index from a BufferedWorkDeparted event
func (e *Engine) findBufferedDepartureIndex(event *Event) int {
	if event.WorkID == nil {
		return -1
	}
	// WorkID is encoded as "buffer:N" for buffered departures
	var idx int
	if _, err := fmt.Sscanf(*event.WorkID, "buffer:%d", &idx); err == nil {
		return idx
	}
	return -1
}

// updateBufferDerivedSignals updates workPresent and bufferFull signals for a buffer, then evaluates buffer rules
func (e *Engine) updateBufferDerivedSignals(station *domain.Station, bufferIndex int, isInput bool) {
	var slots []domain.BufferSlot
	if isInput {
		slots = station.InputBufferSlots
	} else {
		slots = station.OutputBufferSlots
	}
	if bufferIndex < 0 || bufferIndex >= len(slots) {
		return
	}
	slot := &slots[bufferIndex]

	// Update derived signals
	hasWorks := len(slot.Works) > 0
	isFull := len(slot.Works) >= slot.Capacity

	if slot.Signals == nil {
		slot.Signals = make(map[string]bool)
	}
	slot.Signals["workPresent"] = hasWorks
	if _, exists := slot.Signals["bufferFull"]; exists || isInput {
		slot.Signals["bufferFull"] = isFull
	}

	// Update workType derived signal for buffer
	if hasWorks {
		setWorkTypeSignal(slot.Signals, slot.Works[0].Type)
	} else {
		clearWorkTypeSignals(slot.Signals)
	}

	// Evaluate per-buffer interlock rules
	e.evaluateBufferRules(station, bufferIndex, isInput)

	// Write back (slices are reference types but we took a pointer)
	if isInput {
		station.InputBufferSlots[bufferIndex] = *slot
	} else {
		station.OutputBufferSlots[bufferIndex] = *slot
	}
}

// evaluateBufferRules evaluates interlock rules for a specific buffer slot
func (e *Engine) evaluateBufferRules(station *domain.Station, bufferIndex int, isInput bool) {
	var slot *domain.BufferSlot
	if isInput {
		if bufferIndex < 0 || bufferIndex >= len(station.InputBufferSlots) {
			return
		}
		slot = &station.InputBufferSlots[bufferIndex]
	} else {
		if bufferIndex < 0 || bufferIndex >= len(station.OutputBufferSlots) {
			return
		}
		slot = &station.OutputBufferSlots[bufferIndex]
	}

	if slot.InterlockRules == nil || slot.Signals == nil {
		return
	}

	// Iterate rules until stable
	changed := true
	iterations := 0
	for changed && iterations < maxRuleIterations {
		changed = false
		iterations++
		for _, rule := range slot.InterlockRules.Rules {
			if allBufferConditionsMet(rule.Conditions, slot.Signals) {
				if slot.Signals[rule.Target] != rule.Value {
					slot.Signals[rule.Target] = rule.Value
					changed = true
				}
			}
		}
	}
}

// allBufferConditionsMet checks if all conditions are met using buffer-local signals
func allBufferConditionsMet(conditions []domain.RuleCondition, signals map[string]bool) bool {
	if len(conditions) == 0 {
		return false
	}
	for _, cond := range conditions {
		// Buffer rules only reference local signals (stationID is ignored)
		if signals[cond.Signal] != cond.Value {
			return false
		}
	}
	return true
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
func (e *Engine) logWorkEvent(workID, workFriendlyName, stationID string, timestamp float64, eventType string, workType string, bufferIndex int) {
	e.workEventLogs = append(e.workEventLogs, WorkEventLog{
		WorkID:           workID,
		WorkFriendlyName: workFriendlyName,
		StationID:        stationID,
		Timestamp:        timestamp,
		EventType:        eventType,
		WorkType:         workType,
		BufferIndex:      bufferIndex,
	})
}

// placeInitialWorks places initial works at stations and schedules appropriate events
func (e *Engine) placeInitialWorks() error {
	if len(e.initialWorks) == 0 {
		return nil
	}

	for stationID, cond := range e.initialWorks {
		station := e.scenario.GetStation(stationID)
		if station == nil {
			continue // skip unknown stations
		}

		// Only processing/merge/split/drain stations can have initial works
		if station.Type == domain.StationTypeSource {
			continue
		}

		// Create work with the specified ID
		var workID, friendlyName string
		if cond.WorkID != "" {
			workID = cond.WorkID
			friendlyName = cond.WorkID
		} else {
			workID, friendlyName = e.generateWorkID()
		}

		// Determine work type from station config
		workType := station.GetStringConfig("workType")
		var work *domain.Work
		if workType != "" {
			work = domain.NewWorkWithType(workID, friendlyName, workType)
		} else {
			work = domain.NewWork(workID, friendlyName)
		}
		if cond.QualityStatus != "" {
			work.QualityStatus = domain.QualityStatus(cond.QualityStatus)
		}

		// Place work at station
		station.CurrentWork = work
		station.State = domain.StateProcessing

		// Update signals
		station.SetSignal("workPresent", true)
		setWorkTypeSignal(station.Signals, work.Type)

		// Log work event
		e.logWorkEvent(work.ID, work.FriendlyName, station.ID, 0.0, string(EventWorkArrived), work.Type, -1)

		// Calculate remaining processing time
		processingTime := station.GetFloatConfig("processingTime")
		remaining := processingTime - cond.ElapsedTime
		if remaining < 0 {
			remaining = 0
		}

		if remaining == 0 {
			// Already completed
			station.SetSignal("processingComplete", true)
		} else {
			// Schedule ProcessingCompleted at time = remaining
			e.eventQueue.Push(NewEvent(EventProcessingCompleted, remaining, station.ID, nil))
		}

		// Re-evaluate signals after placing work
		if err := e.evaluateAndLogSignals(station); err != nil {
			return err
		}

		log.Printf("Placed initial work %s at station %s (elapsed=%.1f, remaining=%.1f)", work.ID, stationID, cond.ElapsedTime, processingTime-cond.ElapsedTime)
	}

	return nil
}

// setWorkTypeSignal sets the workType:<type> derived signal on a station.
// When a work is present, workType:<type>=true. When work leaves, all workType:* signals are cleared.
func setWorkTypeSignal(signals map[string]bool, workType string) {
	// Clear all existing workType signals
	clearWorkTypeSignals(signals)
	// Set the new one
	if workType != "" {
		signals["workType:"+workType] = true
	}
}

// clearWorkTypeSignals removes all workType:* signals from the map
func clearWorkTypeSignals(signals map[string]bool) {
	for key := range signals {
		if len(key) > 9 && key[:9] == "workType:" {
			delete(signals, key)
		}
	}
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
// For Merge: uses per-buffer inputReady. For Split: uses per-buffer outputReady.
func (e *Engine) checkHandshakes(station *domain.Station) error {
	// Case 1: This station is upstream (non-Split) — its outputReady may have just turned ON
	if station.Type != domain.StationTypeSplit && station.IsOutputReady() && station.CurrentWork != nil && !e.pendingDepartures[station.ID] {
		for _, conn := range e.scenario.Connections {
			if conn.From != station.ID {
				continue
			}
			toStation := e.scenario.GetStation(conn.To)
			if toStation == nil {
				continue
			}

			// Check downstream readiness
			if toStation.Type == domain.StationTypeMerge && conn.ToBufferIndex >= 0 {
				// Merge downstream: check per-buffer inputReady
				resKey := e.bufferReservationKey(toStation.ID, conn.ToBufferIndex)
				if toStation.IsBufferInputReady(conn.ToBufferIndex) && !e.reservedStations[resKey] {
					e.pendingDepartures[station.ID] = true
					e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, station.ID, nil))
					break
				}
			} else {
				// Normal downstream: check station-level inputReady
				if toStation.IsInputReady() && !e.reservedStations[toStation.ID] {
					e.pendingDepartures[station.ID] = true
					e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, station.ID, nil))
					break
				}
			}
		}
	}

	// Case 1b: This station is Split — check each output buffer's outputReady
	if station.Type == domain.StationTypeSplit {
		for bufIdx := range station.OutputBufferSlots {
			if !station.IsBufferOutputReady(bufIdx) {
				continue
			}
			depKey := e.bufferDepartureKey(station.ID, bufIdx)
			if e.pendingDepartures[depKey] {
				continue
			}
			conn := e.findConnectionFromBuffer(station.ID, bufIdx)
			if conn == nil {
				continue
			}
			toStation := e.scenario.GetStation(conn.To)
			if toStation == nil {
				continue
			}

			// Check downstream readiness
			ready := false
			if toStation.Type == domain.StationTypeMerge && conn.ToBufferIndex >= 0 {
				resKey := e.bufferReservationKey(toStation.ID, conn.ToBufferIndex)
				ready = toStation.IsBufferInputReady(conn.ToBufferIndex) && !e.reservedStations[resKey]
			} else {
				ready = toStation.IsInputReady() && !e.reservedStations[toStation.ID]
			}

			if ready {
				e.pendingDepartures[depKey] = true
				bufIdxStr := fmt.Sprintf("buffer:%d", bufIdx)
				e.eventQueue.Push(NewEvent(EventBufferedWorkDeparted, e.currentTime, station.ID, &bufIdxStr))
			}
		}
	}

	// Case 2: This station is downstream (non-Merge) — its inputReady may have just turned ON
	if station.Type != domain.StationTypeMerge && station.IsInputReady() && !e.reservedStations[station.ID] {
		for _, conn := range e.scenario.Connections {
			if conn.To != station.ID {
				continue
			}
			fromStation := e.scenario.GetStation(conn.From)
			if fromStation == nil {
				continue
			}

			// Check upstream readiness
			if fromStation.Type == domain.StationTypeSplit && conn.FromBufferIndex >= 0 {
				// Split upstream: check per-buffer outputReady
				depKey := e.bufferDepartureKey(fromStation.ID, conn.FromBufferIndex)
				if fromStation.IsBufferOutputReady(conn.FromBufferIndex) && !e.pendingDepartures[depKey] {
					e.pendingDepartures[depKey] = true
					bufIdxStr := fmt.Sprintf("buffer:%d", conn.FromBufferIndex)
					e.eventQueue.Push(NewEvent(EventBufferedWorkDeparted, e.currentTime, fromStation.ID, &bufIdxStr))
				}
			} else {
				// Normal upstream: check station-level outputReady
				if fromStation.IsOutputReady() && fromStation.CurrentWork != nil && !e.pendingDepartures[fromStation.ID] {
					e.pendingDepartures[fromStation.ID] = true
					e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, fromStation.ID, nil))
				}
			}
		}
	}

	// Case 2b: This station is Merge — check each input buffer's inputReady
	if station.Type == domain.StationTypeMerge {
		for bufIdx := range station.InputBufferSlots {
			resKey := e.bufferReservationKey(station.ID, bufIdx)
			if !station.IsBufferInputReady(bufIdx) || e.reservedStations[resKey] {
				continue
			}
			conn := e.findConnectionToBuffer(station.ID, bufIdx)
			if conn == nil {
				continue
			}
			fromStation := e.scenario.GetStation(conn.From)
			if fromStation == nil {
				continue
			}

			if fromStation.Type == domain.StationTypeSplit && conn.FromBufferIndex >= 0 {
				depKey := e.bufferDepartureKey(fromStation.ID, conn.FromBufferIndex)
				if fromStation.IsBufferOutputReady(conn.FromBufferIndex) && !e.pendingDepartures[depKey] {
					e.pendingDepartures[depKey] = true
					bufIdxStr := fmt.Sprintf("buffer:%d", conn.FromBufferIndex)
					e.eventQueue.Push(NewEvent(EventBufferedWorkDeparted, e.currentTime, fromStation.ID, &bufIdxStr))
				}
			} else {
				if fromStation.IsOutputReady() && fromStation.CurrentWork != nil && !e.pendingDepartures[fromStation.ID] {
					e.pendingDepartures[fromStation.ID] = true
					e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, fromStation.ID, nil))
				}
			}
		}
	}

	return nil
}
