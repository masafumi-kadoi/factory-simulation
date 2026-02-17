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

	// Merge/Split buffers
	InputBuffer  []*Work // Merge: works waiting to be combined
	OutputBuffer []*Work // Split: works waiting to be dispatched

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

// AddWorkToBuffer adds a work to the InputBuffer (for Merge stations)
func (s *Station) AddWorkToBuffer(work *Work) error {
	if s.Type != StationTypeMerge {
		return fmt.Errorf("station %s is not a merge station", s.ID)
	}
	s.InputBuffer = append(s.InputBuffer, work)
	return nil
}

// CheckMergeCondition checks if merge rules are satisfied by the current InputBuffer
func (s *Station) CheckMergeCondition() bool {
	if s.Type != StationTypeMerge {
		return false
	}

	mergeRules := s.getMergeRules()
	if len(mergeRules) == 0 {
		return false
	}

	// Count works by type in InputBuffer
	typeCounts := make(map[string]int)
	for _, work := range s.InputBuffer {
		typeCounts[work.Type]++
	}

	// Check all rules are satisfied
	for _, rule := range mergeRules {
		workType, _ := rule["workType"].(string)
		count := 1
		if c, ok := rule["count"].(float64); ok {
			count = int(c)
		}
		if typeCounts[workType] < count {
			return false
		}
	}

	return true
}

// ExecuteMerge executes the merge operation, creating a new combined work
// Returns: (mergedWork, consumedWorks, error)
func (s *Station) ExecuteMerge(newWorkIDFunc func() (string, string)) (*Work, []*Work, error) {
	if s.Type != StationTypeMerge {
		return nil, nil, fmt.Errorf("station %s is not a merge station", s.ID)
	}

	mergeRules := s.getMergeRules()
	outputWorkType := s.GetStringConfig("outputWorkType")

	// Collect works to consume based on merge rules
	var consumedWorks []*Work
	remainingBuffer := make([]*Work, len(s.InputBuffer))
	copy(remainingBuffer, s.InputBuffer)

	for _, rule := range mergeRules {
		workType, _ := rule["workType"].(string)
		count := 1
		if c, ok := rule["count"].(float64); ok {
			count = int(c)
		}

		for i := 0; i < count; i++ {
			found := false
			for j, work := range remainingBuffer {
				if work != nil && work.Type == workType {
					consumedWorks = append(consumedWorks, work)
					remainingBuffer[j] = nil
					found = true
					break
				}
			}
			if !found {
				return nil, nil, fmt.Errorf("merge condition not met: missing workType=%s", workType)
			}
		}
	}

	// Update InputBuffer (remove consumed works)
	var newBuffer []*Work
	for _, work := range remainingBuffer {
		if work != nil {
			newBuffer = append(newBuffer, work)
		}
	}
	s.InputBuffer = newBuffer

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

// ExecuteSplit splits a merged work into component works based on mergedFrom metadata
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

	// Create split works
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
	}

	// Store in OutputBuffer
	s.OutputBuffer = splitWorks

	// Set first work as CurrentWork for departure
	if len(s.OutputBuffer) > 0 {
		s.CurrentWork = s.OutputBuffer[0]
		s.OutputBuffer = s.OutputBuffer[1:]
		s.State = StateCompleted
	} else {
		s.CurrentWork = nil
		s.State = StateIdle
	}

	return splitWorks, nil
}

// GetNextOutputWork gets the next work from OutputBuffer (for Split stations)
func (s *Station) GetNextOutputWork() *Work {
	if len(s.OutputBuffer) == 0 {
		return nil
	}
	work := s.OutputBuffer[0]
	s.OutputBuffer = s.OutputBuffer[1:]
	return work
}

// HasOutputBufferWorks returns true if OutputBuffer has remaining works
func (s *Station) HasOutputBufferWorks() bool {
	return len(s.OutputBuffer) > 0
}

// GetMergeBufferCapacityForStation returns the buffer capacity for a specific source station
func (s *Station) GetMergeBufferCapacityForStation(fromStationID string) int {
	mergeInputs := s.getMergeInputs()
	for _, input := range mergeInputs {
		fid, _ := input["fromStationId"].(string)
		if fid == fromStationID {
			if cap, ok := input["bufferCapacity"].(float64); ok {
				return int(cap)
			}
			return 1 // default
		}
	}
	return 1 // default
}

// GetMergeWorkTypeForStation returns the expected work type for a specific source station
func (s *Station) GetMergeWorkTypeForStation(fromStationID string) string {
	mergeInputs := s.getMergeInputs()
	for _, input := range mergeInputs {
		fid, _ := input["fromStationId"].(string)
		if fid == fromStationID {
			wt, _ := input["workType"].(string)
			return wt
		}
	}
	return ""
}

// CountBufferWorksByType counts works of a specific type in InputBuffer
func (s *Station) CountBufferWorksByType(workType string) int {
	count := 0
	for _, work := range s.InputBuffer {
		if work.Type == workType {
			count++
		}
	}
	return count
}

// IsBufferFullForStation checks if the InputBuffer is full for a specific source station
func (s *Station) IsBufferFullForStation(fromStationID string) bool {
	workType := s.GetMergeWorkTypeForStation(fromStationID)
	capacity := s.GetMergeBufferCapacityForStation(fromStationID)
	currentCount := s.CountBufferWorksByType(workType)
	return currentCount >= capacity
}

// getMergeInputs returns the mergeInputs config as a slice of maps
func (s *Station) getMergeInputs() []map[string]interface{} {
	if val, ok := s.Config["mergeInputs"]; ok {
		if inputs, ok := val.([]interface{}); ok {
			result := make([]map[string]interface{}, 0, len(inputs))
			for _, item := range inputs {
				if m, ok := item.(map[string]interface{}); ok {
					result = append(result, m)
				}
			}
			return result
		}
	}
	return nil
}

// getMergeRules returns the mergeRules config as a slice of maps
func (s *Station) getMergeRules() []map[string]interface{} {
	if val, ok := s.Config["mergeRules"]; ok {
		if rules, ok := val.([]interface{}); ok {
			result := make([]map[string]interface{}, 0, len(rules))
			for _, item := range rules {
				if m, ok := item.(map[string]interface{}); ok {
					result = append(result, m)
				}
			}
			return result
		}
	}
	return nil
}

// getSplitRouting returns the splitRouting config as a slice of maps
func (s *Station) getSplitRouting() []map[string]interface{} {
	if val, ok := s.Config["splitRouting"]; ok {
		if routing, ok := val.([]interface{}); ok {
			result := make([]map[string]interface{}, 0, len(routing))
			for _, item := range routing {
				if m, ok := item.(map[string]interface{}); ok {
					result = append(result, m)
				}
			}
			return result
		}
	}
	return nil
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
