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
	StationTypeModuler    StationType = "moduler"    // Moduler: contains sub-stations (entry/exit interface)
	StationTypeEntry      StationType = "entry"      // Entry: transparent input gateway for ModulerStation
	StationTypeExit       StationType = "exit"       // Exit: transparent output gateway for ModulerStation
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

// PortSlot represents a single port slot for Merge/Split stations.
// Each port is 1:1 mapped to a connection and has its own interlock signals.
type PortSlot struct {
	Capacity       int              // Max works this port can hold
	Works          []*Work          // Current works in this slot
	Signals        map[string]bool  // Per-port signal values (inputReady, outputReady, etc.)
	InterlockRules *InterlockConfig // Per-port interlock rules (nil = use default)
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

	// Merge/Split port slots (1:1 mapped to connections)
	InputPortSlots  []PortSlot // Merge: input port slots (one per incoming connection)
	OutputPortSlots []PortSlot // Split: output port slots (one per outgoing connection)

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

	// ModulerStation fields
	SubScenario *SubScenario // Internal stations and connections (moduler type only)
	EntryCount  int          // Number of Entry stations (moduler type only)
	ExitCount   int          // Number of Exit stations (moduler type only)
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

	// Auto-correct control signal initial values
	autoCorrectControlSignals(s.Signals, s.InterlockRules)
}

// autoCorrectControlSignals fixes control signal initial values:
// If a control signal (inputReady/outputReady) has initial=true but no rule
// can ever set it to true, force initial to false to prevent stuck-on state.
// This handles cases where the user removes the ON rule in the editor but
// the signal's initial value was inherited from the default preset as true.
func autoCorrectControlSignals(signals map[string]bool, rules *InterlockConfig) {
	if signals == nil || rules == nil {
		return
	}
	for _, controlSig := range []string{"inputReady", "outputReady"} {
		if !signals[controlSig] {
			continue // already false, no issue
		}
		hasOnRule := false
		for _, rule := range rules.Rules {
			if rule.Target == controlSig && rule.Value {
				hasOnRule = true
				break
			}
		}
		if !hasOnRule {
			signals[controlSig] = false
		}
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
	if s.Type == StationTypeSource || s.Type == StationTypeModuler {
		return false // Source and Moduler do not accept external works directly
	}
	if s.Type == StationTypeMerge {
		// Merge accepts works into InputPort; inputReady is managed per-connection
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

// InitializeInterlockRulesFromConfig loads custom interlock rules from the station's config map.
// This bridges the gap between the JSON config (where editor saves interlockRules)
// and the Station.InterlockRules field (used by the engine).
func (s *Station) InitializeInterlockRulesFromConfig() {
	if ilRaw, ok := s.Config["interlockRules"]; ok {
		parsed := parseInterlockConfig(ilRaw)
		if parsed != nil {
			s.InterlockRules = parsed
		}
	}
}

// InitializePortSlots initializes port slots from the station config.
// Each port gets its own signals and interlock rules.
// Called during simulation startup.
func (s *Station) InitializePortSlots() {
	ports := s.getPortsConfig()
	if s.Type == StationTypeMerge {
		s.InputPortSlots = make([]PortSlot, len(ports))
		for i, b := range ports {
			capacity := 1
			if c, ok := b["capacity"].(float64); ok && c >= 1 {
				capacity = int(c)
			}
			slot := PortSlot{Capacity: capacity}

			// Load per-port interlock rules or use default
			if ilRaw, ok := b["interlockRules"]; ok {
				slot.InterlockRules = parseInterlockConfig(ilRaw)
			}
			if slot.InterlockRules == nil {
				slot.InterlockRules = GetDefaultMergePortInterlockConfig()
			}

			// Initialize signals from interlock rules
			slot.Signals = make(map[string]bool)
			for _, sig := range slot.InterlockRules.Signals {
				slot.Signals[sig.Name] = sig.Initial
			}
			autoCorrectControlSignals(slot.Signals, slot.InterlockRules)

			s.InputPortSlots[i] = slot
		}
	} else if s.Type == StationTypeSplit {
		s.OutputPortSlots = make([]PortSlot, len(ports))
		for i, b := range ports {
			capacity := 1
			if c, ok := b["capacity"].(float64); ok && c >= 1 {
				capacity = int(c)
			}
			slot := PortSlot{Capacity: capacity}

			// Load per-port interlock rules or use default
			if ilRaw, ok := b["interlockRules"]; ok {
				slot.InterlockRules = parseInterlockConfig(ilRaw)
			}
			if slot.InterlockRules == nil {
				slot.InterlockRules = GetDefaultSplitPortInterlockConfig()
			}

			// Initialize signals from interlock rules
			slot.Signals = make(map[string]bool)
			for _, sig := range slot.InterlockRules.Signals {
				slot.Signals[sig.Name] = sig.Initial
			}
			autoCorrectControlSignals(slot.Signals, slot.InterlockRules)

			s.OutputPortSlots[i] = slot
		}
	}
}

// parseInterlockConfig parses an InterlockConfig from a raw interface{} (JSON-decoded map)
func parseInterlockConfig(raw interface{}) *InterlockConfig {
	m, ok := raw.(map[string]interface{})
	if !ok {
		return nil
	}

	config := &InterlockConfig{}

	// Parse signals
	if sigs, ok := m["signals"].([]interface{}); ok {
		for _, s := range sigs {
			if sm, ok := s.(map[string]interface{}); ok {
				name, _ := sm["name"].(string)
				initial, _ := sm["initial"].(bool)
				config.Signals = append(config.Signals, SignalDef{Name: name, Initial: initial})
			}
		}
	}

	// Parse rules
	if rules, ok := m["rules"].([]interface{}); ok {
		for _, r := range rules {
			if rm, ok := r.(map[string]interface{}); ok {
				rule := InterlockRule{}
				rule.ID, _ = rm["id"].(string)
				rule.Target, _ = rm["target"].(string)
				rule.Value, _ = rm["value"].(bool)
				if conds, ok := rm["conditions"].([]interface{}); ok {
					for _, c := range conds {
						if cm, ok := c.(map[string]interface{}); ok {
							cond := RuleCondition{}
							cond.Signal, _ = cm["signal"].(string)
							cond.Value, _ = cm["value"].(bool)
							cond.StationID, _ = cm["stationId"].(string)
							rule.Conditions = append(rule.Conditions, cond)
						}
					}
				}
				config.Rules = append(config.Rules, rule)
			}
		}
	}

	if len(config.Signals) == 0 && len(config.Rules) == 0 {
		return nil
	}
	return config
}

// getPortsConfig returns the ports config as a slice of maps
func (s *Station) getPortsConfig() []map[string]interface{} {
	if val, ok := s.Config["ports"]; ok {
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

// AddWorkToPort adds a work to the specified InputPortSlot by index
func (s *Station) AddWorkToPort(work *Work, portIndex int) error {
	if s.Type != StationTypeMerge {
		return fmt.Errorf("station %s is not a merge station", s.ID)
	}
	if portIndex < 0 || portIndex >= len(s.InputPortSlots) {
		return fmt.Errorf("port index %d out of range for station %s (has %d ports)", portIndex, s.ID, len(s.InputPortSlots))
	}
	slot := &s.InputPortSlots[portIndex]
	if len(slot.Works) >= slot.Capacity {
		return fmt.Errorf("port %d at station %s is full (capacity=%d)", portIndex, s.ID, slot.Capacity)
	}
	slot.Works = append(slot.Works, work)
	return nil
}

// CheckMergeCondition checks if all input port slots are full
func (s *Station) CheckMergeCondition() bool {
	if s.Type != StationTypeMerge || len(s.InputPortSlots) == 0 {
		return false
	}
	for _, slot := range s.InputPortSlots {
		if len(slot.Works) < slot.Capacity {
			return false
		}
	}
	return true
}

// ExecuteMerge consumes all works from all input port slots and creates a merged work.
// Returns: (mergedWork, consumedWorks, error)
func (s *Station) ExecuteMerge(newWorkIDFunc func() (string, string)) (*Work, []*Work, error) {
	if s.Type != StationTypeMerge {
		return nil, nil, fmt.Errorf("station %s is not a merge station", s.ID)
	}

	outputWorkType := s.GetStringConfig("outputWorkType")

	// Consume all works from all slots
	var consumedWorks []*Work
	for i := range s.InputPortSlots {
		slot := &s.InputPortSlots[i]
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

// ExecuteSplit splits a merged work into component works and places them into OutputPortSlots.
// Works are placed into output ports sequentially by index (1:1 mapping with connections).
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

	// Create split works and place into output port slots by index
	var splitWorks []*Work
	sourceWorkID := s.CurrentWork.ID
	sourceWorkType := s.CurrentWork.Type

	for i, item := range mergedFromList {
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

		// Place into output port slot by index (1:1 mapping)
		if i < len(s.OutputPortSlots) {
			slot := &s.OutputPortSlots[i]
			slot.Works = append(slot.Works, splitWork)
		}
	}

	// Clear current work (split station body is now empty)
	s.CurrentWork = nil
	s.State = StateIdle

	return splitWorks, nil
}

// GetOutputPortWorkByIndex gets the next work from a specific OutputPortSlot
func (s *Station) GetOutputPortWorkByIndex(portIndex int) *Work {
	if portIndex < 0 || portIndex >= len(s.OutputPortSlots) {
		return nil
	}
	slot := &s.OutputPortSlots[portIndex]
	if len(slot.Works) > 0 {
		work := slot.Works[0]
		slot.Works = slot.Works[1:]
		return work
	}
	return nil
}

// HasOutputPortWorks returns true if any OutputPortSlot has remaining works
func (s *Station) HasOutputPortWorks() bool {
	for _, slot := range s.OutputPortSlots {
		if len(slot.Works) > 0 {
			return true
		}
	}
	return false
}

// GetPortSignal gets a signal value from a specific port slot
func (s *Station) GetPortSignal(isInput bool, portIndex int, signalName string) bool {
	var slots []PortSlot
	if isInput {
		slots = s.InputPortSlots
	} else {
		slots = s.OutputPortSlots
	}
	if portIndex < 0 || portIndex >= len(slots) {
		return false
	}
	if slots[portIndex].Signals == nil {
		return false
	}
	return slots[portIndex].Signals[signalName]
}

// SetPortSignal sets a signal value on a specific port slot
func (s *Station) SetPortSignal(isInput bool, portIndex int, signalName string, value bool) {
	var slots []PortSlot
	if isInput {
		slots = s.InputPortSlots
	} else {
		slots = s.OutputPortSlots
	}
	if portIndex < 0 || portIndex >= len(slots) {
		return
	}
	if slots[portIndex].Signals == nil {
		slots[portIndex].Signals = make(map[string]bool)
	}
	slots[portIndex].Signals[signalName] = value
}

// IsPortInputReady checks if a specific input port's inputReady signal is ON
func (s *Station) IsPortInputReady(portIndex int) bool {
	return s.GetPortSignal(true, portIndex, "inputReady")
}

// IsPortOutputReady checks if a specific output port's outputReady signal is ON
func (s *Station) IsPortOutputReady(portIndex int) bool {
	return s.GetPortSignal(false, portIndex, "outputReady")
}

// CanStartProcessing checks if the station can start processing
func (s *Station) CanStartProcessing() bool {
	if s.Type == StationTypeSource || s.Type == StationTypeDrain {
		return false // Source and Drain have no processing
	}
	if s.Type == StationTypeMerge {
		return false // Merge has its own processing flow via EventMergeCompleted
	}
	if s.Type == StationTypeEntry || s.Type == StationTypeExit || s.Type == StationTypeModuler {
		return false // Entry/Exit are transparent, Moduler is a container
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
