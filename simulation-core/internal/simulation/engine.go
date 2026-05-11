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
	ModulerID  string // Parent Moduler station ID (empty for top-level stations)
}

// WorkEventLog represents a log entry for work events
type WorkEventLog struct {
	WorkID           string
	WorkFriendlyName string
	StationID        string
	Timestamp        float64
	EventType        string
	WorkType         string // Work type (e.g. "partA", "partB")
	PortIndex      int    // Port slot index (-1 = no port)
	ModulerID      string // Parent Moduler station ID (empty for top-level stations)
	QualityStatus  string // Quality status at event time (OK, NG, etc.)
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
	workPortReservation map[string]int          // workID -> portIndex for works in transit to a Merge port
	simDB              *SimDB                  // SimDB for managing predefined work IDs
	mergeInProgress    map[string]bool         // Tracks merge stations currently processing (stationID -> in progress)
	initialWorks       map[string]InitialWorkCondition // Initial work conditions by station ID
	pendingTimers      map[string]float64     // Timer tracking: key="stationID:timerType" → scheduledTime
	stationModulerMap  map[string]string       // station ID -> parent Moduler station ID (empty for top-level stations)
	switchStates       map[string]*SwitchState // Switch station round-robin/sequence state (stationID -> state)
	switchDivertTarget map[string]string       // Switch divert selected target (stationID -> targetStationID)
}

// SwitchState tracks the current sequence position for a Switch station
type SwitchState struct {
	SeqIndex int
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
		reservedStations:    make(map[string]bool),
		workPortReservation: make(map[string]int),
		simDB:               NewSimDB(workIDsByStation),
		mergeInProgress:    make(map[string]bool),
		initialWorks:       initialWorks,
		pendingTimers:      make(map[string]float64),
		switchStates:       make(map[string]*SwitchState),
		switchDivertTarget: make(map[string]string),
	}
}

// Run executes the simulation until the time limit or event exhaustion
func (e *Engine) Run(simulationID, friendlyName string, timeLimit float64) (*domain.Simulation, []StationStatusLog, []WorkEventLog, []WorkLineageLog, error) {
	simulation := domain.NewSimulation(simulationID, friendlyName, e.scenario.ID)

	// Step 0: Flatten ModulerStations (recursive expansion)
	e.scenario = FlattenScenario(e.scenario)
	e.scenario.BuildStationIndex()
	e.stationModulerMap = e.scenario.StationModulerMap

	// Step 0.5: Normalize factory station types to simulation types
	// "machine" (factory management term) → "processing" (simulation engine term)
	for i := range e.scenario.Stations {
		if e.scenario.Stations[i].Type == "machine" {
			e.scenario.Stations[i].Type = domain.StationTypeProcessing
		}
	}

	// Step 1: Initialize interlock rules, signals, and port slots for all stations
	for i := range e.scenario.Stations {
		station := &e.scenario.Stations[i]
		// Load custom interlock rules from config (saved by editor)
		station.InitializeInterlockRulesFromConfig()
		if station.InterlockRules == nil {
			station.InterlockRules = domain.GetDefaultInterlockConfig(station.Type)
		}
		station.InitializeSignals()
		station.InitializePorts()
	}

	// Step 1.5: Initialize timer defaults (stayTime/noWorkTimeout) for stations without user-specified values
	e.initializeTimerDefaults()

	// Step 2: Evaluate rules to set initial control signals
	for i := range e.scenario.Stations {
		station := &e.scenario.Stations[i]
		if err := e.evaluateAndLogSignals(station); err != nil {
			return nil, nil, nil, nil, fmt.Errorf("initial rule evaluation failed: %w", err)
		}
		// Evaluate port-level rules (Merge input ports, Split output ports)
		for j := 1; j < len(station.InPorts); j++ {
			e.evaluatePortRules(&station.InPorts[j])
		}
		for j := 1; j < len(station.OutPorts); j++ {
			e.evaluatePortRules(&station.OutPorts[j])
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

	var err error
	switch event.Type {
	case EventWorkCreated:
		err = e.handleWorkCreated(event, station)
	case EventWorkArrived:
		err = e.handleWorkArrived(event, station)
	case EventProcessingStarted:
		err = e.handleProcessingStarted(event, station)
	case EventProcessingCompleted:
		err = e.handleProcessingCompleted(event, station)
	case EventWorkDeparted:
		err = e.handleWorkDeparted(event, station)
	case EventWorkDestroyed:
		err = e.handleWorkDestroyed(event, station)
	case EventMergeCompleted:
		err = e.handleMergeCompleted(event, station)
	case EventSplitCompleted:
		err = e.handleSplitCompleted(event, station)
	case EventCheckWorkFull:
		err = e.handleCheckWorkFull(event, station)
	case EventCheckWorkEmpty:
		err = e.handleCheckWorkEmpty(event, station)
	default:
		return fmt.Errorf("unknown event type: %s", event.Type)
	}

	if err != nil {
		return err
	}

	// After processing an internal station's event, re-derive parent Moduler signals
	if e.isInternalStation(station.ID) {
		if err := e.triggerModulerDerivation(station); err != nil {
			return err
		}
	}

	return nil
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
	station.SetWork(work)
	station.State = domain.StateCompleted

	// Update result signals: OWP=ON, workType:<type>=ON
	station.SetSignal(domain.SignalOutputWorkPresent, true)
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

	// Merge station: add to InputPort instead of CurrentWork
	if station.Type == domain.StationTypeMerge {
		portIndex := e.findToPortIndex(*event.WorkID, station.ID)
		// Clear port-level reservation and work-port mapping
		delete(e.reservedStations, e.portReservationKey(station.ID, portIndex))
		delete(e.workPortReservation, *event.WorkID)
		return e.handleMergeWorkArrived(work, station, portIndex)
	}

	// Clear station-level reservation
	delete(e.reservedStations, station.ID)

	// Check interlock: InputReady must be ON
	if !station.IsInputReady() {
		return fmt.Errorf("interlock violation: station %s InputReady=OFF (state=%s), cannot accept work", station.ID, station.State)
	}

	// Entry/Exit stations: transparent pass-through (skip Receiving/Processing)
	if station.Type == domain.StationTypeEntry || station.Type == domain.StationTypeExit {
		return e.handleEntryExitWorkArrived(work, station)
	}

	// Delegate to station logic
	if err := station.AddWork(work); err != nil {
		return err
	}

	// Update result signals: IWP/PWP/OWP=ON, workType:<type>=ON
	station.SetSignal(domain.SignalInputWorkPresent, true)
	station.SetSignal(domain.SignalProcessingWorkPresent, true)
	station.SetSignal(domain.SignalOutputWorkPresent, true)
	setWorkTypeSignal(station.Signals, work.Type)

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkArrived), work.Type, -1)
	e.logStationStatus(station, "ワーク到着")

	// Timer management: cancel workEmpty timer, schedule workFull timer
	e.cancelWorkEmptyTimer(station)
	e.scheduleWorkFullTimer(station)

	// Evaluate interlock rules after signal change
	// processReady trigger (if PR=ON after evaluation) is handled inside evaluateAndLogSignals
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	// For Drain station, schedule immediate destruction
	if station.Type == domain.StationTypeDrain {
		e.eventQueue.Push(NewEvent(EventWorkDestroyed, e.currentTime, station.ID, &work.ID))
		return nil
	}

	return nil
}

// handleEntryExitWorkArrived handles work arrival at an Entry or Exit station.
// Entry/Exit are transparent (zero processing time): WorkArrived → Completed → WorkDeparted.
// No ProcessingStarted/ProcessingCompleted events are generated.
func (e *Engine) handleEntryExitWorkArrived(work *domain.Work, station *domain.Station) error {
	// Debug: log work metadata at Entry/Exit arrival
	if work.Metadata != nil {
		log.Printf("[%s] station=%s work=%s type=%s metadataKeys=%v",
			station.Type, station.ID, work.ID, work.Type, metadataKeys(work.Metadata))
	}

	// Set work directly (bypass AddWork which sets state to Receiving)
	station.SetWork(work)
	station.State = domain.StateCompleted

	// Update result signals: IWP/OWP=ON, workType:<type>=ON
	station.SetSignal(domain.SignalInputWorkPresent, true)
	station.SetSignal(domain.SignalOutputWorkPresent, true)
	setWorkTypeSignal(station.Signals, work.Type)

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkArrived), work.Type, -1)
	e.logStationStatus(station, "ワーク到着")

	// Evaluate interlock rules (outputReady should turn ON via rules)
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	return nil
}

// handleMergeWorkArrived handles work arrival at a Merge station's input port
func (e *Engine) handleMergeWorkArrived(work *domain.Work, station *domain.Station, portIndex int) error {
	// Add work to the specified input port (Ports[portIndex+1])
	if err := station.AddWorkToPort(work, portIndex); err != nil {
		return err
	}

	// Log work event with port index (unified as WorkArrived)
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkArrived), work.Type, portIndex)
	e.logStationStatus(station, "ワークバッファ追加")

	// Update port-level derived signals
	e.updatePortDerivedSignals(station, portIndex, true)

	// Evaluate station-level interlock rules (deriveStationSignals will compute IWP, IR, allPortsFull, etc.)
	// processReady trigger is handled inside evaluateAndLogSignals
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	return nil
}

// handleMergeCompleted handles the MergeCompleted event
func (e *Engine) handleMergeCompleted(event *Event, station *domain.Station) error {
	delete(e.mergeInProgress, station.ID)

	// Execute merge (consumes all port works, creates merged work at Port[0])
	mergedWork, consumedWorks, err := station.ExecuteMerge(e.generateWorkID)
	if err != nil {
		return err
	}

	// Debug: log merged work metadata
	log.Printf("[Merge] station=%s work=%s type=%s metadataKeys=%v mergedFromCount=%d",
		station.ID, mergedWork.ID, mergedWork.Type, metadataKeys(mergedWork.Metadata), len(consumedWorks))

	// Record work lineage
	e.recordWorkLineage(mergedWork.ID, mergedWork.FriendlyName, consumedWorks, "merge", station.ID)

	// Update port derived signals (ports are now empty)
	for i := 0; i < station.InputPortCount(); i++ {
		e.updatePortDerivedSignals(station, i, true)
	}

	// Update station result signals: RUN=OFF, CPL=ON, OWP=ON, PWP=OFF, IWP=OFF, PR=OFF
	station.SetSignal(domain.SignalRunning, false)
	station.SetSignal(domain.SignalComplete, true)
	station.SetSignal(domain.SignalOutputWorkPresent, true)
	station.SetSignal(domain.SignalProcessingWorkPresent, false)
	station.SetSignal(domain.SignalInputWorkPresent, false)
	station.SetSignal(domain.SignalProcessReady, false)
	setWorkTypeSignal(station.Signals, mergedWork.Type)

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
	// Merge station: handle merge start separately
	if station.Type == domain.StationTypeMerge {
		return e.handleMergeStarted(station)
	}

	// Processing/Split: delegate to station logic
	// If already processing (e.g. duplicate event from timer + rule evaluation at same tick), skip
	if station.State == domain.StateProcessing || station.State == domain.StateCompleted {
		return nil
	}
	if err := station.StartProcessing(); err != nil {
		return err
	}

	// Set result signal: RUN=ON
	station.SetSignal(domain.SignalRunning, true)

	// Log work event
	work := station.GetWork()
	var workID, workFriendlyName, workType string
	if work != nil {
		workID = work.ID
		workFriendlyName = work.FriendlyName
		workType = work.Type
	}
	e.logWorkEvent(workID, workFriendlyName, station.ID, e.currentTime, string(EventProcessingStarted), workType, -1)
	e.logStationStatus(station, "処理開始")

	// Evaluate rules (R4: RUN=ON → PR=OFF)
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	// Schedule ProcessingCompleted event
	processingTime := station.GetFloatConfig("processingTime")
	e.eventQueue.Push(NewEvent(EventProcessingCompleted, e.currentTime+processingTime, station.ID, nil))

	return nil
}

// handleMergeStarted handles the start of merge processing
func (e *Engine) handleMergeStarted(station *domain.Station) error {
	if e.mergeInProgress[station.ID] {
		return nil // Already in progress (duplicate event)
	}
	e.mergeInProgress[station.ID] = true
	station.State = domain.StateProcessing

	// Set result signals: RUN=ON, PWP=ON
	station.SetSignal(domain.SignalRunning, true)
	station.SetSignal(domain.SignalProcessingWorkPresent, true)

	e.logStationStatus(station, "結合処理開始")

	// Evaluate rules (PR→OFF via R2: PR=ON → IR=OFF, and R4-like if exists)
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	// Schedule MergeCompleted
	processingTime := station.GetFloatConfig("processingTime")
	e.eventQueue.Push(NewEvent(EventMergeCompleted, e.currentTime+processingTime, station.ID, nil))

	return nil
}

// handleProcessingCompleted handles the ProcessingCompleted event
func (e *Engine) handleProcessingCompleted(event *Event, station *domain.Station) error {
	// Stale event: work already departed (state changed before this event fired)
	if station.State == domain.StateIdle {
		return nil
	}

	// Split station: split the work into components
	if station.Type == domain.StationTypeSplit {
		return e.handleSplitProcessingCompleted(station)
	}

	// Delegate to station logic
	if err := station.CompleteProcessing(e.generateWorkID); err != nil {
		return err
	}

	// Update result signals: RUN=OFF, CPL=ON
	station.SetSignal(domain.SignalRunning, false)
	station.SetSignal(domain.SignalComplete, true)

	// Log work event (Processing: normal completion)
	work := station.GetWork()
	if work != nil {
		e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventProcessingCompleted), work.Type, -1)
		e.workEventLogs[len(e.workEventLogs)-1].QualityStatus = string(work.QualityStatus)
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

	// Debug: log work metadata before split
	if work := station.GetWork(); work != nil {
		hasMergedFrom := work.Metadata != nil && work.Metadata["mergedFrom"] != nil
		log.Printf("[Split] station=%s work=%s type=%s hasMergedFrom=%v metadataKeys=%v",
			station.ID, work.ID, work.Type, hasMergedFrom, metadataKeys(work.Metadata))
	}

	// Execute split (places works into output ports Ports[1+], clears Port[0].Work)
	splitWorks, err := station.ExecuteSplit(e.generateWorkID)
	if err != nil {
		return err
	}

	// Record work lineage and log events for each split work with port index
	for i, splitWork := range splitWorks {
		e.logWorkEvent(splitWork.ID, splitWork.FriendlyName, station.ID, e.currentTime, string(EventWorkSplit), splitWork.Type, i)
	}

	// Update derived signals for each output port
	for i := 0; i < station.OutputPortCount(); i++ {
		e.updatePortDerivedSignals(station, i, false)
	}

	// Update station result signals: RUN=OFF, CPL=ON, IWP=OFF, PWP=OFF, OWP=ON
	station.SetSignal(domain.SignalRunning, false)
	station.SetSignal(domain.SignalComplete, true)
	station.SetSignal(domain.SignalInputWorkPresent, false)
	station.SetSignal(domain.SignalProcessingWorkPresent, false)
	station.SetSignal(domain.SignalOutputWorkPresent, true)
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
// This event is triggered by checkHandshakes when upstream.outputReady=ON AND downstream.inputReady=ON.
// For Split port departures, event.PortIndex >= 0.
func (e *Engine) handleWorkDeparted(event *Event, station *domain.Station) error {
	// Dispatch port-level departures (Split output ports)
	if event.PortIndex >= 0 {
		return e.handlePortWorkDeparted(event, station)
	}

	// Switch divert: use selected target from switchDivertTarget
	if station.Type == domain.StationTypeSwitch && station.GetDirection() == "divert" {
		return e.handleSwitchDivertWorkDeparted(event, station)
	}

	// Clear pending departure flag
	delete(e.pendingDepartures, station.ID)

	// Re-verify handshake: conditions may have changed since scheduling
	if !station.IsOutputReady() || station.GetWork() == nil {
		return nil // Conditions changed, skip departure
	}

	// Verify downstream inputReady and not already reserved
	nextStation, conn, err := e.getNextStationWithConn(station, station.GetWork())
	if err != nil {
		return err
	}
	if nextStation != nil {
		// For merge downstream: check port-level inputReady
		if nextStation.Type == domain.StationTypeMerge && conn != nil && conn.ToPortIndex >= 0 {
			if !nextStation.IsPortInputReady(conn.ToPortIndex) || e.reservedStations[e.portReservationKey(nextStation.ID, conn.ToPortIndex)] {
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

	// Update result signals: IWP/PWP/OWP=OFF, CPL=OFF, PR=OFF, clear workType
	station.SetSignal(domain.SignalInputWorkPresent, false)
	station.SetSignal(domain.SignalProcessingWorkPresent, false)
	station.SetSignal(domain.SignalOutputWorkPresent, false)
	station.SetSignal(domain.SignalComplete, false)
	station.SetSignal(domain.SignalProcessReady, false)
	clearWorkTypeSignals(station.Signals)

	// Timer management: cancel workFull timer, schedule workEmpty timer
	e.cancelWorkFullTimer(station)
	e.scheduleWorkEmptyTimer(station)

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDeparted), work.Type, -1)
	e.logStationStatus(station, "ワーク出発")

	// Evaluate interlock rules after signal change
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	if nextStation == nil {
		return nil
	}

	// Reserve destination (port-level for merge, station-level otherwise)
	if nextStation.Type == domain.StationTypeMerge && conn != nil && conn.ToPortIndex >= 0 {
		e.reservedStations[e.portReservationKey(nextStation.ID, conn.ToPortIndex)] = true
		e.workPortReservation[work.ID] = conn.ToPortIndex
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

// handlePortWorkDeparted handles the WorkDeparted event for a Split output port (event.PortIndex >= 0)
func (e *Engine) handlePortWorkDeparted(event *Event, station *domain.Station) error {
	portIndex := event.PortIndex
	depKey := e.portDepartureKey(station.ID, portIndex)
	delete(e.pendingDepartures, depKey)

	// Re-verify: port outputReady must still be ON
	if !station.IsPortOutputReady(portIndex) {
		return nil
	}

	// Find the connection from this port
	conn := e.findConnectionFromPort(station.ID, portIndex)
	if conn == nil {
		return nil
	}

	toStation := e.scenario.GetStation(conn.To)
	if toStation == nil {
		return nil
	}

	// Check downstream readiness
	if toStation.Type == domain.StationTypeMerge && conn.ToPortIndex >= 0 {
		if !toStation.IsPortInputReady(conn.ToPortIndex) || e.reservedStations[e.portReservationKey(toStation.ID, conn.ToPortIndex)] {
			return nil
		}
	} else {
		if !toStation.IsInputReady() || e.reservedStations[toStation.ID] {
			return nil
		}
	}

	// Get work from the output port (Ports[portIndex+1])
	work := station.GetOutputPortWorkByIndex(portIndex)
	if work == nil {
		return nil
	}

	// Update port derived signals
	e.updatePortDerivedSignals(station, portIndex, false)

	// Check if all output ports are empty → reset station for next input
	if !station.HasOutputPortWorks() {
		station.SetSignal(domain.SignalComplete, false)
		station.SetSignal(domain.SignalOutputWorkPresent, false)
		// Evaluate station-level rules to re-enable inputReady
		if err := e.evaluateAndLogSignals(station); err != nil {
			return err
		}
	}

	// Log work event
	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDeparted), work.Type, portIndex)
	e.logStationStatus(station, "ワーク出発(バッファ)")

	// Reserve destination
	if toStation.Type == domain.StationTypeMerge && conn.ToPortIndex >= 0 {
		e.reservedStations[e.portReservationKey(toStation.ID, conn.ToPortIndex)] = true
		e.workPortReservation[work.ID] = conn.ToPortIndex
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
	station.SetWork(nil)
	station.State = domain.StateIdle

	// Update result signals: IWP=OFF, clear workType
	station.SetSignal(domain.SignalInputWorkPresent, false)
	clearWorkTypeSignals(station.Signals)

	e.logStationStatus(station, "ワーク破棄")

	// Evaluate interlock rules after signal change
	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	return nil
}

// getNextStation determines the next station based on routing conditions (legacy, non-port)
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

// findToPortIndex finds the ToPortIndex for a work arriving at a merge station.
// Uses workPortReservation for an exact work-to-port lookup recorded at dispatch time.
func (e *Engine) findToPortIndex(workID string, toStationID string) int {
	if portIndex, ok := e.workPortReservation[workID]; ok {
		return portIndex
	}
	// Fallback (should not occur in normal operation): find first reserved port
	for _, conn := range e.scenario.Connections {
		if conn.To == toStationID && conn.ToPortIndex >= 0 {
			resKey := e.portReservationKey(toStationID, conn.ToPortIndex)
			if e.reservedStations[resKey] {
				return conn.ToPortIndex
			}
		}
	}
	return 0
}

// findConnectionFromPort finds the connection from a specific output port of a station
func (e *Engine) findConnectionFromPort(stationID string, portIndex int) *domain.Connection {
	for i, conn := range e.scenario.Connections {
		if conn.From == stationID && conn.FromPortIndex == portIndex {
			return &e.scenario.Connections[i]
		}
	}
	return nil
}

// findConnectionToPort finds the connection to a specific input port of a station
func (e *Engine) findConnectionToPort(stationID string, portIndex int) *domain.Connection {
	for i, conn := range e.scenario.Connections {
		if conn.To == stationID && conn.ToPortIndex == portIndex {
			return &e.scenario.Connections[i]
		}
	}
	return nil
}

// portReservationKey creates a unique key for port-level reservation
func (e *Engine) portReservationKey(stationID string, portIndex int) string {
	return fmt.Sprintf("%s:port:%d", stationID, portIndex)
}

// portDepartureKey creates a unique key for port-level pending departures
func (e *Engine) portDepartureKey(stationID string, portIndex int) string {
	return fmt.Sprintf("%s:portdep:%d", stationID, portIndex)
}

// updatePortDerivedSignals updates derived signals for a port (Ports[portIndex+1]), then evaluates port rules
func (e *Engine) updatePortDerivedSignals(station *domain.Station, portIndex int, isInput bool) {
	var port *domain.Port
	if isInput {
		port = station.GetInputPort(portIndex)
	} else {
		port = station.GetOutputPort(portIndex)
	}
	if port == nil {
		return
	}

	// Update derived signals
	hasWorks := len(port.Works) > 0

	if port.Signals == nil {
		port.Signals = make(map[string]bool)
	}

	if isInput {
		port.Signals[domain.SignalInputWorkPresent] = hasWorks
	} else {
		port.Signals[domain.SignalOutputWorkPresent] = hasWorks
	}

	// Update workType derived signal for port
	if hasWorks {
		setWorkTypeSignal(port.Signals, port.Works[0].Type)
	} else {
		clearWorkTypeSignals(port.Signals)
	}

	// Evaluate per-port interlock rules
	e.evaluatePortRules(port)
}

// deriveStationSignals derives station-level signals from port-level signals for Merge/Split.
// Merge: InPorts[1+] → Station.Signals (IR=ANY, IWP=ANY, allPortsFull=ALL, portNFull)
// Split: OutPorts[1+] → Station.Signals (OR=ANY, OWP=ANY, allPortsEmpty=ALL, portNEmpty, portNHasWork)
func deriveStationSignals(station *domain.Station) {
	if station.Signals == nil {
		return
	}

	switch station.Type {
	case domain.StationTypeMerge:
		deriveMergeStationSignals(station)
	case domain.StationTypeSplit:
		deriveSplitStationSignals(station)
	}
}

func deriveMergeStationSignals(station *domain.Station) {
	portCount := station.InputPortCount()
	if portCount == 0 {
		return
	}

	anyIR := false
	anyIWP := false
	allFull := true

	for i := 0; i < portCount; i++ {
		port := station.GetInputPort(i)
		if port == nil {
			continue
		}
		if port.Signals != nil {
			if port.Signals[domain.SignalInputReady] {
				anyIR = true
			}
			if port.Signals[domain.SignalInputWorkPresent] {
				anyIWP = true
			}
		}

		isFull := len(port.Works) >= port.Capacity
		if !isFull {
			allFull = false
		}

		// portNFull (dynamic: "port1Full", "port2Full", ...)
		station.Signals[fmt.Sprintf("port%dFull", i+1)] = isFull
	}

	station.Signals[domain.SignalInputReady] = anyIR
	station.Signals[domain.SignalInputWorkPresent] = anyIWP
	station.Signals[domain.SignalAllPortsFull] = allFull
}

func deriveSplitStationSignals(station *domain.Station) {
	portCount := station.OutputPortCount()
	if portCount == 0 {
		return
	}

	anyOR := false
	anyOWP := false
	allEmpty := true

	for i := 0; i < portCount; i++ {
		port := station.GetOutputPort(i)
		if port == nil {
			continue
		}

		hasWork := len(port.Works) > 0
		isEmpty := !hasWork

		if port.Signals != nil {
			if port.Signals[domain.SignalOutputReady] {
				anyOR = true
			}
			if port.Signals[domain.SignalOutputWorkPresent] {
				anyOWP = true
			}
		}

		if !isEmpty {
			allEmpty = false
		}

		// portNEmpty / portNHasWork (dynamic)
		station.Signals[fmt.Sprintf("port%dEmpty", i+1)] = isEmpty
		station.Signals[fmt.Sprintf("port%dHasWork", i+1)] = hasWork
	}

	station.Signals[domain.SignalOutputReady] = anyOR
	station.Signals[domain.SignalOutputWorkPresent] = anyOWP
	station.Signals[domain.SignalAllPortsEmpty] = allEmpty
}

// evaluatePortRules evaluates interlock rules for a specific port
func (e *Engine) evaluatePortRules(port *domain.Port) {
	if port == nil || port.InterlockRules == nil || port.Signals == nil {
		return
	}

	// Iterate rules until stable
	changed := true
	iterations := 0
	for changed && iterations < maxRuleIterations {
		changed = false
		iterations++
		for _, rule := range port.InterlockRules.Rules {
			if allPortConditionsMet(rule.Conditions, port.Signals) {
				if port.Signals[rule.Target] != rule.Value {
					port.Signals[rule.Target] = rule.Value
					changed = true
				}
			}
		}
	}
}

// allPortConditionsMet checks if all conditions are met using port-local signals
func allPortConditionsMet(conditions []domain.RuleCondition, signals map[string]bool) bool {
	if len(conditions) == 0 {
		return false
	}
	for _, cond := range conditions {
		// Port rules only reference local signals (stationID is ignored)
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
		// Check Port[0] (station body)
		if w := station.GetWork(); w != nil && w.ID == workID {
			return w
		}
		// Check InPorts[1+] (Merge input ports)
		for j := 1; j < len(station.InPorts); j++ {
			for _, work := range station.InPorts[j].Works {
				if work.ID == workID {
					return work
				}
			}
		}
		// Check OutPorts[1+] (Split output ports)
		for j := 1; j < len(station.OutPorts); j++ {
			for _, work := range station.OutPorts[j].Works {
				if work.ID == workID {
					return work
				}
			}
		}
	}
	return nil
}

// logWorkEvent logs a work event
func (e *Engine) logWorkEvent(workID, workFriendlyName, stationID string, timestamp float64, eventType string, workType string, portIndex int) {
	e.workEventLogs = append(e.workEventLogs, WorkEventLog{
		WorkID:           workID,
		WorkFriendlyName: workFriendlyName,
		StationID:        stationID,
		Timestamp:        timestamp,
		EventType:        eventType,
		WorkType:         workType,
		PortIndex:      portIndex,
		ModulerID:      e.stationModulerMap[stationID],
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
		station.SetWork(work)
		station.State = domain.StateProcessing

		// Update result signals
		station.SetSignal(domain.SignalInputWorkPresent, true)
		station.SetSignal(domain.SignalProcessingWorkPresent, true)
		station.SetSignal(domain.SignalOutputWorkPresent, true)
		station.SetSignal(domain.SignalRunning, true)
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
			station.SetSignal(domain.SignalRunning, false)
			station.SetSignal(domain.SignalComplete, true)
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
		ModulerID:  e.stationModulerMap[station.ID],
	})
}

// logSignalChange logs an explicit signal change (for timer-driven signals not covered by rules).
func (e *Engine) logSignalChange(station *domain.Station, signalName string, oldValue, newValue bool, ruleID string) {
	e.statusLogs = append(e.statusLogs, StationStatusLog{
		StationID:  station.ID,
		Timestamp:  e.currentTime,
		StatusType: "signal_change",
		Value:      newValue,
		SignalName: signalName,
		OldValue:   oldValue,
		RuleID:     ruleID,
		ModulerID:  e.stationModulerMap[station.ID],
	})
}

// evaluateAndLogSignals evaluates interlock rules, logs signal changes, checks handshakes,
// and triggers processing start when processReady=ON
func (e *Engine) evaluateAndLogSignals(station *domain.Station) error {
	// For Merge/Split: derive station-level signals from port-level signals before rule evaluation
	// Capture pre-derivation state to log derived signal changes
	var preDeriveSignals map[string]bool
	if station.Signals != nil && (station.Type == domain.StationTypeMerge || station.Type == domain.StationTypeSplit) {
		preDeriveSignals = make(map[string]bool, len(station.Signals))
		for k, v := range station.Signals {
			preDeriveSignals[k] = v
		}
	}

	deriveStationSignals(station)

	// Log derived signal changes
	if preDeriveSignals != nil {
		for name, newVal := range station.Signals {
			oldVal, existed := preDeriveSignals[name]
			if !existed || oldVal != newVal {
				e.statusLogs = append(e.statusLogs, StationStatusLog{
					StationID:  station.ID,
					Timestamp:  e.currentTime,
					StatusType: "signal_change",
					Value:      newVal,
					SignalName: name,
					OldValue:   oldVal,
					RuleID:     "derived",
					ModulerID:  e.stationModulerMap[station.ID],
				})
			}
		}
	}

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
			ModulerID:  e.stationModulerMap[change.StationID],
		})
	}

	// After signal changes, check if any transfer handshakes are newly satisfied
	if err := e.checkHandshakes(station); err != nil {
		return err
	}

	// Check if processReady=ON → schedule processing start
	e.triggerProcessReady(station)

	return nil
}

// triggerProcessReady checks if processReady=ON and schedules the appropriate processing event.
// For Processing/Split: schedules ProcessingStarted immediately.
// For Merge: schedules ProcessingStarted immediately (which triggers merge start).
func (e *Engine) triggerProcessReady(station *domain.Station) {
	if !station.GetSignal(domain.SignalProcessReady) {
		return
	}
	switch station.Type {
	case domain.StationTypeProcessing, domain.StationTypeSplit:
		if station.State == domain.StateReceiving {
			e.eventQueue.Push(NewEvent(EventProcessingStarted, e.currentTime, station.ID, nil))
		}
	case domain.StationTypeMerge:
		if e.mergeInProgress[station.ID] {
			return
		}
		e.eventQueue.Push(NewEvent(EventProcessingStarted, e.currentTime, station.ID, nil))
	}
}

// getSwitchState returns (or lazily creates) the SwitchState for a Switch station
func (e *Engine) getSwitchState(stationID string) *SwitchState {
	if s, ok := e.switchStates[stationID]; ok {
		return s
	}
	s := &SwitchState{}
	e.switchStates[stationID] = s
	return s
}

// selectSwitchPort picks one index from candidates based on the station's selectMode.
// candidates: slice of 0-based connection indices that are currently ready.
// numPorts: total number of connections (governs round-robin cycling).
// Returns the selected index, or -1 if selection is impossible (priority stall or empty candidates).
func (e *Engine) selectSwitchPort(station *domain.Station, numPorts int, candidates []int) int {
	if len(candidates) == 0 {
		return -1
	}
	mode := station.GetSwitchSelectMode()
	switch mode {
	case "round-robin":
		state := e.getSwitchState(station.ID)
		seq := make([]int, numPorts)
		for i := range seq {
			seq[i] = i
		}
		return e.selectBySequence(state, seq, candidates)
	case "sequence":
		state := e.getSwitchState(station.ID)
		seq := station.GetSwitchSequence()
		if len(seq) == 0 {
			seq = make([]int, numPorts)
			for i := range seq {
				seq[i] = i
			}
		}
		return e.selectBySequence(state, seq, candidates)
	case "priority":
		order := station.GetSwitchPriorityOrder()
		candidateSet := make(map[int]bool, len(candidates))
		for _, c := range candidates {
			candidateSet[c] = true
		}
		for _, portIdx := range order {
			if candidateSet[portIdx] {
				return portIdx
			}
		}
		return -1 // Stall: no candidate matches priority order
	default: // "first-available" and unknown modes
		return candidates[0]
	}
}

// selectBySequence advances seqIndex and returns the preferred candidate (with fallback to candidates[0])
func (e *Engine) selectBySequence(state *SwitchState, seq []int, candidates []int) int {
	preferred := seq[state.SeqIndex%len(seq)]
	state.SeqIndex++
	candidateSet := make(map[int]bool, len(candidates))
	for _, c := range candidates {
		candidateSet[c] = true
	}
	if candidateSet[preferred] {
		return preferred
	}
	return candidates[0]
}

// collectSwitchMergeCandidates returns indices of upstream connections where the upstream
// has outputReady=ON with a work present and no pending departure already scheduled.
func (e *Engine) collectSwitchMergeCandidates(station *domain.Station) ([]int, []domain.Connection) {
	conns := e.scenario.GetConnectionsTo(station.ID)
	var candidates []int
	for i, conn := range conns {
		from := e.scenario.GetStation(conn.From)
		if from == nil {
			continue
		}
		if from.IsOutputReady() && from.GetWork() != nil && !e.pendingDepartures[from.ID] {
			candidates = append(candidates, i)
		}
	}
	return candidates, conns
}

// collectSwitchDivertCandidates returns indices of downstream connections where the downstream
// has inputReady=ON and is not reserved.
func (e *Engine) collectSwitchDivertCandidates(station *domain.Station) ([]int, []domain.Connection) {
	conns := e.scenario.GetConnectionsFrom(station.ID)
	var candidates []int
	for i, conn := range conns {
		to := e.scenario.GetStation(conn.To)
		if to == nil {
			continue
		}
		if to.IsInputReady() && !e.reservedStations[to.ID] {
			candidates = append(candidates, i)
		}
	}
	return candidates, conns
}

// scheduleSwitchMerge selects one ready upstream for a Switch merge station and schedules its WorkDeparted.
func (e *Engine) scheduleSwitchMerge(station *domain.Station) {
	if !station.IsInputReady() || e.reservedStations[station.ID] {
		return
	}
	// If any upstream already has a pending departure toward this switch, don't double-schedule
	for _, conn := range e.scenario.GetConnectionsTo(station.ID) {
		if e.pendingDepartures[conn.From] {
			return
		}
	}
	candidates, conns := e.collectSwitchMergeCandidates(station)
	if len(candidates) == 0 {
		return
	}
	sel := e.selectSwitchPort(station, len(conns), candidates)
	if sel < 0 || sel >= len(conns) {
		return
	}
	from := e.scenario.GetStation(conns[sel].From)
	if from == nil {
		return
	}
	e.pendingDepartures[from.ID] = true
	e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, from.ID, nil))
}

// scheduleSwitchDivert selects one ready downstream for a Switch divert station and schedules its WorkDeparted.
func (e *Engine) scheduleSwitchDivert(station *domain.Station) {
	if !station.IsOutputReady() || station.GetWork() == nil || e.pendingDepartures[station.ID] {
		return
	}
	candidates, conns := e.collectSwitchDivertCandidates(station)
	if len(candidates) == 0 {
		return
	}
	sel := e.selectSwitchPort(station, len(conns), candidates)
	if sel < 0 || sel >= len(conns) {
		return
	}
	to := e.scenario.GetStation(conns[sel].To)
	if to == nil {
		return
	}
	e.switchDivertTarget[station.ID] = to.ID
	e.pendingDepartures[station.ID] = true
	e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, station.ID, nil))
}

// handleSwitchDivertWorkDeparted handles WorkDeparted for a Switch divert station body.
func (e *Engine) handleSwitchDivertWorkDeparted(event *Event, station *domain.Station) error {
	delete(e.pendingDepartures, station.ID)

	if !station.IsOutputReady() || station.GetWork() == nil {
		return nil
	}

	targetID, ok := e.switchDivertTarget[station.ID]
	if !ok {
		return e.checkHandshakes(station)
	}
	targetStation := e.scenario.GetStation(targetID)
	if targetStation == nil || !targetStation.IsInputReady() || e.reservedStations[targetID] {
		delete(e.switchDivertTarget, station.ID)
		return e.checkHandshakes(station)
	}

	work, err := station.GetOutputWork()
	if err != nil {
		return err
	}

	station.SetSignal(domain.SignalInputWorkPresent, false)
	station.SetSignal(domain.SignalProcessingWorkPresent, false)
	station.SetSignal(domain.SignalOutputWorkPresent, false)
	station.SetSignal(domain.SignalComplete, false)
	station.SetSignal(domain.SignalProcessReady, false)
	clearWorkTypeSignals(station.Signals)

	e.cancelWorkFullTimer(station)
	e.scheduleWorkEmptyTimer(station)

	e.logWorkEvent(work.ID, work.FriendlyName, station.ID, e.currentTime, string(EventWorkDeparted), work.Type, -1)
	e.logStationStatus(station, "ワーク出発(Switch)")

	if err := e.evaluateAndLogSignals(station); err != nil {
		return err
	}

	e.reservedStations[targetID] = true
	delete(e.switchDivertTarget, station.ID)
	e.worksInTransit[work.ID] = work

	departureTime := station.GetFloatConfig("departureTime")
	arrivalTime := targetStation.GetFloatConfig("arrivalTime")
	transitTime := departureTime + arrivalTime
	e.eventQueue.Push(NewEvent(EventWorkArrived, e.currentTime+transitTime, targetID, &work.ID))

	return nil
}

// checkHandshakes checks if transfer handshakes are satisfied after signal changes.
// A transfer begins when upstream.outputReady=ON AND downstream.inputReady=ON.
// For Merge: uses per-port inputReady. For Split: uses per-port outputReady.
// Uses indexed connection lookups for O(degree) instead of O(E) per call.
func (e *Engine) checkHandshakes(station *domain.Station) error {
	// Case 1c: Switch divert — select one downstream and schedule departure
	if station.Type == domain.StationTypeSwitch && station.GetDirection() == "divert" {
		e.scheduleSwitchDivert(station)
	}

	// Case 1: This station is upstream (non-Split, non-SwitchDivert) — its outputReady may have just turned ON
	if station.Type != domain.StationTypeSplit && !(station.Type == domain.StationTypeSwitch && station.GetDirection() == "divert") &&
		station.IsOutputReady() && station.GetWork() != nil && !e.pendingDepartures[station.ID] {
		for _, conn := range e.scenario.GetConnectionsFrom(station.ID) {
			toStation := e.scenario.GetStation(conn.To)
			if toStation == nil {
				continue
			}

			// If downstream is Switch merge, delegate scheduling to Switch
			if toStation.Type == domain.StationTypeSwitch && toStation.GetDirection() == "merge" {
				if toStation.IsInputReady() && !e.reservedStations[toStation.ID] {
					e.scheduleSwitchMerge(toStation)
				}
				break
			}

			// Check downstream readiness
			if toStation.Type == domain.StationTypeMerge && conn.ToPortIndex >= 0 {
				resKey := e.portReservationKey(toStation.ID, conn.ToPortIndex)
				if toStation.IsPortInputReady(conn.ToPortIndex) && !e.reservedStations[resKey] {
					e.pendingDepartures[station.ID] = true
					e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, station.ID, nil))
					break
				}
			} else {
				if toStation.IsInputReady() && !e.reservedStations[toStation.ID] {
					e.pendingDepartures[station.ID] = true
					e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, station.ID, nil))
					break
				}
			}
		}
	}

	// Case 1b: This station is Split — check each output port's outputReady
	if station.Type == domain.StationTypeSplit {
		for bufIdx := 0; bufIdx < station.OutputPortCount(); bufIdx++ {
			if !station.IsPortOutputReady(bufIdx) {
				continue
			}
			depKey := e.portDepartureKey(station.ID, bufIdx)
			if e.pendingDepartures[depKey] {
				continue
			}
			conn := e.findConnectionFromPort(station.ID, bufIdx)
			if conn == nil {
				continue
			}
			toStation := e.scenario.GetStation(conn.To)
			if toStation == nil {
				continue
			}

			ready := false
			if toStation.Type == domain.StationTypeMerge && conn.ToPortIndex >= 0 {
				resKey := e.portReservationKey(toStation.ID, conn.ToPortIndex)
				ready = toStation.IsPortInputReady(conn.ToPortIndex) && !e.reservedStations[resKey]
			} else {
				ready = toStation.IsInputReady() && !e.reservedStations[toStation.ID]
			}

			if ready {
				e.pendingDepartures[depKey] = true
				e.eventQueue.Push(NewPortEvent(EventWorkDeparted, e.currentTime, station.ID, nil, bufIdx))
			}
		}
	}

	// Case 2: This station is downstream (non-Merge) — its inputReady may have just turned ON
	if station.Type != domain.StationTypeMerge && station.IsInputReady() && !e.reservedStations[station.ID] {
		// Case 2c: Switch merge — select one upstream via selectSwitchPort
		if station.Type == domain.StationTypeSwitch && station.GetDirection() == "merge" {
			e.scheduleSwitchMerge(station)
		} else {
			for _, conn := range e.scenario.GetConnectionsTo(station.ID) {
				fromStation := e.scenario.GetStation(conn.From)
				if fromStation == nil {
					continue
				}

				// If upstream is Switch divert, delegate to Switch selection
				if fromStation.Type == domain.StationTypeSwitch && fromStation.GetDirection() == "divert" {
					if fromStation.IsOutputReady() && fromStation.GetWork() != nil && !e.pendingDepartures[fromStation.ID] {
						e.scheduleSwitchDivert(fromStation)
					}
					continue
				}

				if fromStation.Type == domain.StationTypeSplit && conn.FromPortIndex >= 0 {
					depKey := e.portDepartureKey(fromStation.ID, conn.FromPortIndex)
					if fromStation.IsPortOutputReady(conn.FromPortIndex) && !e.pendingDepartures[depKey] {
						e.pendingDepartures[depKey] = true
						e.eventQueue.Push(NewPortEvent(EventWorkDeparted, e.currentTime, fromStation.ID, nil, conn.FromPortIndex))
					}
				} else {
					if fromStation.IsOutputReady() && fromStation.GetWork() != nil && !e.pendingDepartures[fromStation.ID] {
						e.pendingDepartures[fromStation.ID] = true
						e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, fromStation.ID, nil))
					}
				}
			}
		}
	}

	// Case 2b: This station is Merge — check each input port's inputReady
	if station.Type == domain.StationTypeMerge {
		for bufIdx := 0; bufIdx < station.InputPortCount(); bufIdx++ {
			resKey := e.portReservationKey(station.ID, bufIdx)
			if !station.IsPortInputReady(bufIdx) || e.reservedStations[resKey] {
				continue
			}
			conn := e.findConnectionToPort(station.ID, bufIdx)
			if conn == nil {
				continue
			}
			fromStation := e.scenario.GetStation(conn.From)
			if fromStation == nil {
				continue
			}

			if fromStation.Type == domain.StationTypeSplit && conn.FromPortIndex >= 0 {
				depKey := e.portDepartureKey(fromStation.ID, conn.FromPortIndex)
				if fromStation.IsPortOutputReady(conn.FromPortIndex) && !e.pendingDepartures[depKey] {
					e.pendingDepartures[depKey] = true
					e.eventQueue.Push(NewPortEvent(EventWorkDeparted, e.currentTime, fromStation.ID, nil, conn.FromPortIndex))
				}
			} else {
				if fromStation.IsOutputReady() && fromStation.GetWork() != nil && !e.pendingDepartures[fromStation.ID] {
					e.pendingDepartures[fromStation.ID] = true
					e.eventQueue.Push(NewEvent(EventWorkDeparted, e.currentTime, fromStation.ID, nil))
				}
			}
		}
	}

	return nil
}

// metadataKeys returns the keys of a work's metadata map (for debug logging)
func metadataKeys(m map[string]interface{}) []string {
	if m == nil {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
