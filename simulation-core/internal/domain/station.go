package domain

import "fmt"

// StationType represents the type of a station
type StationType string

const (
	StationTypeSource     StationType = "source"     // Simplified: Source only generates works
	StationTypeProcessing StationType = "processing" // Base class: handles one work at a time
	StationTypeDrain      StationType = "drain"      // Simplified: Drain only destroys works
	StationTypeMerge      StationType = "merge"      // Merge: combines multiple works into one
	StationTypeSplit      StationType = "split"       // Split: separates combined work into components
)

// StationState represents the state of a station in the state machine
type StationState string

const (
	StateIdle       StationState = "idle"       // Waiting (no work) - 搬入可=ON, 搬出可=OFF
	StateReceiving  StationState = "receiving"  // Work arriving (transition) - 搬入可=OFF, 搬出可=OFF
	StateProcessing StationState = "processing" // Processing work - 搬入可=OFF, 搬出可=OFF
	StateCompleted  StationState = "completed"  // Processing completed (ready to depart) - 搬入可=OFF, 搬出可=ON
)

// StateTransition represents a state transition rule (for future JSON-based configuration)
type StateTransition struct {
	From       StationState `json:"from"`
	To         StationState `json:"to"`
	Trigger    string       `json:"trigger"`
	Conditions []string     `json:"conditions,omitempty"` // Future: condition expressions
}

// BufferSlot represents a single buffer slot for Merge/Split stations
type BufferSlot struct {
	WorkType string
	Capacity int     // Merge: per-slot capacity, Split: 1 (fixed)
	Works    []*Work // Current works in this slot
}

// Station represents a station in the factory simulation (Processing base class)
type Station struct {
	ID         string
	Name       string
	Type       StationType
	ParentID   *string
	LocationID *int64
	PositionX  *float64
	PositionY  *float64

	// Work management: Only ONE work at a time (interlock mechanism)
	CurrentWork *Work // The work currently at this station (nil if idle)

	// Merge/Split buffer slots
	InputBufferSlots  []BufferSlot // Merge: input buffer slots (one per workType)
	OutputBufferSlots []BufferSlot // Split: output buffer slots (one per workType)

	// State machine
	State StationState

	// Interlock signals (derived from state)
	// 搬入可 (InputReady): true when station can accept a new work
	// 搬出可 (OutputReady): true when station has completed work and ready to send

	// Timestamps (for logging)
	StateChangedAt         *float64 // State change timestamp
	WorkArrivalTime        *float64
	WorkDepartureTime      *float64
	ProcessingStartTime    *float64
	ProcessingCompleteTime *float64

	// Configuration (processing time, arrival time, departure time, etc.)
	Config map[string]interface{}

	// Signal-based interlock
	Signals        map[string]bool  // Current signal values
	InterlockRules *InterlockConfig // Rule definitions (nil = use type default)
}

// NewStation creates a new station
func NewStation(id string, stationType StationType, config map[string]interface{}) *Station {
	return &Station{
		ID:          id,
		Type:        stationType,
		ParentID:    nil,
		CurrentWork: nil, // No work initially
		State:       StateIdle,
		Config:      config,
	}
}

// GetFloatConfig retrieves a float64 configuration value
func (s *Station) GetFloatConfig(key string) float64 {
	if val, ok := s.Config[key]; ok {
		if fval, ok := val.(float64); ok {
			return fval
		}
	}
	return 0.0
}

// GetIntConfig retrieves an integer configuration value
func (s *Station) GetIntConfig(key string) int {
	if val, ok := s.Config[key]; ok {
		if ival, ok := val.(float64); ok {
			return int(ival)
		}
	}
	return 0
}

// GetBoolConfig retrieves a boolean configuration value
func (s *Station) GetBoolConfig(key string) bool {
	if val, ok := s.Config[key]; ok {
		if bval, ok := val.(bool); ok {
			return bval
		}
	}
	return false
}

// GetStringConfig retrieves a string configuration value
func (s *Station) GetStringConfig(key string) string {
	if val, ok := s.Config[key]; ok {
		if sval, ok := val.(string); ok {
			return sval
		}
	}
	return ""
}

// IsInputReady returns true if station can accept a new work (搬入可 signal)
func (s *Station) IsInputReady() bool {
	if s.Signals != nil {
		return s.Signals["inputReady"]
	}
	// Fallback: legacy behavior
	return s.State == StateIdle && s.CurrentWork == nil
}

// IsOutputReady returns true if station has completed work and ready to send (搬出可 signal)
func (s *Station) IsOutputReady() bool {
	if s.Signals != nil {
		return s.Signals["outputReady"]
	}
	// Fallback: legacy behavior
	return s.State == StateCompleted && s.CurrentWork != nil
}

// InitializeSignals sets all signals to their initial values from the interlock config
func (s *Station) InitializeSignals() {
	if s.InterlockRules == nil {
		return
	}
	s.Signals = make(map[string]bool)
	for _, sig := range s.InterlockRules.Signals {
		s.Signals[sig.Name] = sig.Initial
	}
}

// SetSignal sets a signal value
func (s *Station) SetSignal(name string, value bool) {
	if s.Signals != nil {
		s.Signals[name] = value
	}
}

// GetSignal gets a signal value
func (s *Station) GetSignal(name string) bool {
	if s.Signals != nil {
		return s.Signals[name]
	}
	return false
}

// CanAcceptWork checks if the station can accept a new work
// This is the interlock mechanism: only accept when InputReady is ON
func (s *Station) CanAcceptWork() bool {
	if s.Type == StationTypeSource {
		return false // Source does not accept external works
	}
	if s.Type == StationTypeMerge {
		// Merge accepts works into InputBuffer; inputReady is managed per-connection
		return s.IsInputReady()
	}
	return s.IsInputReady()
}

// AddWork adds a work to the station (interlock-controlled)
func (s *Station) AddWork(work *Work) error {
	if !s.CanAcceptWork() {
		return fmt.Errorf("station %s cannot accept work (InputReady=OFF, state=%s)", s.ID, s.State)
	}

	// Accept the work (turn OFF InputReady signal)
	s.CurrentWork = work
	s.State = StateReceiving

	return nil
}

// InitializeBufferSlots initializes buffer slots from the station config.
// Called during simulation startup.
func (s *Station) InitializeBufferSlots() {
	buffers := s.getBuffersConfig()
	if s.Type == StationTypeMerge {
		s.InputBufferSlots = make([]BufferSlot, len(buffers))
		for i, b := range buffers {
			workType, _ := b["workType"].(string)
			capacity := 1
			if c, ok := b["capacity"].(float64); ok && c >= 1 {
				capacity = int(c)
			}
			s.InputBufferSlots[i] = BufferSlot{WorkType: workType, Capacity: capacity}
		}
	} else if s.Type == StationTypeSplit {
		s.OutputBufferSlots = make([]BufferSlot, len(buffers))
		for i, b := range buffers {
			workType, _ := b["workType"].(string)
			s.OutputBufferSlots[i] = BufferSlot{WorkType: workType, Capacity: 1}
		}
	}
}

// getBuffersConfig returns the buffers config as a slice of maps
func (s *Station) getBuffersConfig() []map[string]interface{} {
	if val, ok := s.Config["buffers"]; ok {
		if arr, ok := val.([]interface{}); ok {
			result := make([]map[string]interface{}, 0, len(arr))
			for _, item := range arr {
				if m, ok := item.(map[string]interface{}); ok {
					result = append(result, m)
				}
			}
			return result
		}
	}
	return nil
}

// AddWorkToBuffer adds a work to the matching InputBufferSlot by workType
func (s *Station) AddWorkToBuffer(work *Work) error {
	if s.Type != StationTypeMerge {
		return fmt.Errorf("station %s is not a merge station", s.ID)
	}
	for i := range s.InputBufferSlots {
		slot := &s.InputBufferSlots[i]
		if slot.WorkType == work.Type && len(slot.Works) < slot.Capacity {
			slot.Works = append(slot.Works, work)
			return nil
		}
	}
	return fmt.Errorf("no matching buffer slot for workType=%s at station %s", work.Type, s.ID)
}

// CheckMergeCondition checks if all input buffer slots are full
func (s *Station) CheckMergeCondition() bool {
	if s.Type != StationTypeMerge || len(s.InputBufferSlots) == 0 {
		return false
	}
	for _, slot := range s.InputBufferSlots {
		if len(slot.Works) < slot.Capacity {
			return false
		}
	}
	return true
}

// ExecuteMerge consumes all works from all input buffer slots and creates a merged work.
// Returns: (mergedWork, consumedWorks, error)
func (s *Station) ExecuteMerge(newWorkIDFunc func() (string, string)) (*Work, []*Work, error) {
	if s.Type != StationTypeMerge {
		return nil, nil, fmt.Errorf("station %s is not a merge station", s.ID)
	}

	outputWorkType := s.GetStringConfig("outputWorkType")

	// Consume all works from all slots
	var consumedWorks []*Work
	for i := range s.InputBufferSlots {
		slot := &s.InputBufferSlots[i]
		consumedWorks = append(consumedWorks, slot.Works...)
		slot.Works = nil
	}

	if len(consumedWorks) == 0 {
		return nil, nil, fmt.Errorf("merge at station %s: no works to consume", s.ID)
	}

	// Generate new merged work
	workID, friendlyName := newWorkIDFunc()
	mergedWork := NewWorkWithType(workID, friendlyName, outputWorkType)

	// Set mergedFrom metadata
	mergedFromList := make([]interface{}, len(consumedWorks))
	for i, w := range consumedWorks {
		mergedFromList[i] = map[string]interface{}{
			"workId": w.ID,
			"type":   w.Type,
		}
	}
	mergedWork.Metadata = map[string]interface{}{
		"mergedFrom": mergedFromList,
	}

	// Set as current work
	s.CurrentWork = mergedWork
	s.State = StateCompleted

	return mergedWork, consumedWorks, nil
}

// ExecuteSplit splits a merged work into component works and places them into OutputBufferSlots.
// Returns: (splitWorks, error)
func (s *Station) ExecuteSplit(newWorkIDFunc func() (string, string)) ([]*Work, error) {
	if s.Type != StationTypeSplit {
		return nil, fmt.Errorf("station %s is not a split station", s.ID)
	}

	if s.CurrentWork == nil {
		return nil, fmt.Errorf("station %s has no work to split", s.ID)
	}

	// Get mergedFrom metadata
	mergedFrom, ok := s.CurrentWork.Metadata["mergedFrom"]
	if !ok {
		return nil, fmt.Errorf("station %s: work %s has no mergedFrom metadata (not a merged work)", s.ID, s.CurrentWork.ID)
	}

	mergedFromList, ok := mergedFrom.([]interface{})
	if !ok {
		return nil, fmt.Errorf("station %s: invalid mergedFrom format", s.ID)
	}

	// Create split works and place into matching output buffer slots
	var splitWorks []*Work
	sourceWorkID := s.CurrentWork.ID
	sourceWorkType := s.CurrentWork.Type

	for _, item := range mergedFromList {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		origType, _ := itemMap["type"].(string)

		workID, friendlyName := newWorkIDFunc()
		splitWork := NewWorkWithType(workID, friendlyName, origType)
		splitWork.Metadata = map[string]interface{}{
			"splitFrom": map[string]interface{}{
				"workId": sourceWorkID,
				"type":   sourceWorkType,
			},
		}
		splitWorks = append(splitWorks, splitWork)

		// Place into matching output buffer slot
		for i := range s.OutputBufferSlots {
			slot := &s.OutputBufferSlots[i]
			if slot.WorkType == origType && len(slot.Works) < slot.Capacity {
				slot.Works = append(slot.Works, splitWork)
				break
			}
		}
	}

	// Set first available work as CurrentWork for departure
	s.CurrentWork = nil
	for i := range s.OutputBufferSlots {
		slot := &s.OutputBufferSlots[i]
		if len(slot.Works) > 0 {
			s.CurrentWork = slot.Works[0]
			slot.Works = slot.Works[1:]
			break
		}
	}

	if s.CurrentWork != nil {
		s.State = StateCompleted
	} else {
		s.State = StateIdle
	}

	return splitWorks, nil
}

// GetNextOutputBufferWork gets the next work from OutputBufferSlots (for Split stations)
func (s *Station) GetNextOutputBufferWork() *Work {
	for i := range s.OutputBufferSlots {
		slot := &s.OutputBufferSlots[i]
		if len(slot.Works) > 0 {
			work := slot.Works[0]
			slot.Works = slot.Works[1:]
			return work
		}
	}
	return nil
}

// HasOutputBufferWorks returns true if any OutputBufferSlot has remaining works
func (s *Station) HasOutputBufferWorks() bool {
	for _, slot := range s.OutputBufferSlots {
		if len(slot.Works) > 0 {
			return true
		}
	}
	return false
}

// HasBufferCapacity returns true if any InputBufferSlot has available capacity
func (s *Station) HasBufferCapacity() bool {
	for _, slot := range s.InputBufferSlots {
		if len(slot.Works) < slot.Capacity {
			return true
		}
	}
	return false
}

// IsBufferSlotFullForWorkType checks if the buffer slot for a given workType is full
func (s *Station) IsBufferSlotFullForWorkType(workType string) bool {
	for _, slot := range s.InputBufferSlots {
		if slot.WorkType == workType {
			return len(slot.Works) >= slot.Capacity
		}
	}
	return true // no matching slot = treat as full
}

// CanStartProcessing checks if the station can start processing
func (s *Station) CanStartProcessing() bool {
	if s.Type == StationTypeSource || s.Type == StationTypeDrain {
		return false // Source and Drain have no processing
	}
	if s.Type == StationTypeMerge {
		return false // Merge has its own processing flow via EventMergeCompleted
	}
	// Processing and Split station can start when work has arrived
	return s.CurrentWork != nil && s.State == StateReceiving
}

// StartProcessing starts processing (transition to Processing state)
func (s *Station) StartProcessing() error {
	if !s.CanStartProcessing() {
		return fmt.Errorf("station %s cannot start processing (no work or wrong state)", s.ID)
	}

	s.State = StateProcessing
	return nil
}

// CompleteProcessing completes processing (transition to Completed state)
// For base Processing station: work passes through as-is
func (s *Station) CompleteProcessing(newWorkIDFunc func() (string, string)) error {
	if s.State != StateProcessing {
		return fmt.Errorf("station %s is not processing (state=%s)", s.ID, s.State)
	}

	if s.CurrentWork == nil {
		return fmt.Errorf("station %s has no work to complete", s.ID)
	}

	// Processing Station: work passes through as-is
	// Turn ON OutputReady signal
	s.State = StateCompleted

	return nil
}

// GetOutputWork retrieves the output work and resets station to idle
// This is called when OutputReady signal is ON (handshake verified)
func (s *Station) GetOutputWork() (*Work, error) {
	if !s.IsOutputReady() {
		return nil, fmt.Errorf("station %s is not ready to output (OutputReady=OFF, state=%s)", s.ID, s.State)
	}

	// Check if there's a work to output
	if s.CurrentWork == nil {
		return nil, fmt.Errorf("station %s has no work to output", s.ID)
	}

	// Get the work and clear station (turn ON InputReady signal)
	work := s.CurrentWork
	s.CurrentWork = nil
	s.State = StateIdle

	return work, nil
}
