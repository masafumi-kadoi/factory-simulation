package domain

import "fmt"

// StationType represents the type of a station
type StationType string

const (
	StationTypeSource     StationType = "source"
	StationTypeProcessing StationType = "processing"
	StationTypeDrain      StationType = "drain"
	StationTypeMerge      StationType = "merge"
	StationTypeSplit      StationType = "split"
	StationTypeModuler    StationType = "moduler"
	StationTypeEntry      StationType = "entry"
	StationTypeExit       StationType = "exit"
)

// StationState represents the state of a station in the state machine
type StationState string

const (
	StateIdle       StationState = "idle"
	StateReceiving  StationState = "receiving"
	StateProcessing StationState = "processing"
	StateCompleted  StationState = "completed"
)

// StateTransition represents a state transition rule (for future JSON-based configuration)
type StateTransition struct {
	From       StationState `json:"from"`
	To         StationState `json:"to"`
	Trigger    string       `json:"trigger"`
	Conditions []string     `json:"conditions,omitempty"`
}

// Port represents a unified port for all station types.
// Port[0] = station body (main flow), Port[1+] = Merge input / Split output ports.
type Port struct {
	Work           *Work            // Single work (used by Port[0] for main flow)
	Works          []*Work          // Multiple works (used by Port[1+] for Merge/Split)
	Capacity       int              // Max works this port can hold (Port[0] always 1)
	Signals        map[string]bool  // Per-port signal values
	InterlockRules *InterlockConfig // Per-port interlock rules (nil = use default)
}

// Station represents a station in the factory simulation
type Station struct {
	ID         string
	Name       string
	Type       StationType
	ParentID   *string
	LocationID *int64
	PositionX  *float64
	PositionY  *float64

	// Port unified model: Port[0]=body, Port[1+]=Merge input / Split output
	Ports []Port

	// State machine
	State StationState

	// Timestamps (for logging)
	StateChangedAt         *float64
	WorkArrivalTime        *float64
	WorkDepartureTime      *float64
	ProcessingStartTime    *float64
	ProcessingCompleteTime *float64

	// Configuration (processing time, arrival time, departure time, etc.)
	Config map[string]interface{}

	// Signal-based interlock
	Signals        map[string]bool  // Shortcut to Ports[0].Signals
	InterlockRules *InterlockConfig // Rule definitions (nil = use type default)

	// ModulerStation fields
	SubScenario        *SubScenario // Internal stations and connections (moduler type only)
	EntryCount         int          // Number of Entry stations (moduler type only)
	ExitCount          int          // Number of Exit stations (moduler type only)
	InternalStationIDs []string     // Flattened internal station IDs (set by flatten)
}

// NewStation creates a new station
func NewStation(id string, stationType StationType, config map[string]interface{}) *Station {
	return &Station{
		ID:     id,
		Type:   stationType,
		Ports:  []Port{{Capacity: 1}},
		State:  StateIdle,
		Config: config,
	}
}

// GetWork returns the work at Port[0] (station body)
func (s *Station) GetWork() *Work {
	if len(s.Ports) == 0 {
		return nil
	}
	return s.Ports[0].Work
}

// SetWork sets the work at Port[0] (station body)
func (s *Station) SetWork(w *Work) {
	if len(s.Ports) == 0 {
		s.Ports = []Port{{Capacity: 1}}
	}
	s.Ports[0].Work = w
}

// GetInputPort returns the Merge input port at index (maps to Ports[portIndex+1])
func (s *Station) GetInputPort(portIndex int) *Port {
	idx := portIndex + 1
	if idx <= 0 || idx >= len(s.Ports) {
		return nil
	}
	return &s.Ports[idx]
}

// GetOutputPort returns the Split output port at index (maps to Ports[portIndex+1])
func (s *Station) GetOutputPort(portIndex int) *Port {
	idx := portIndex + 1
	if idx <= 0 || idx >= len(s.Ports) {
		return nil
	}
	return &s.Ports[idx]
}

// InputPortCount returns the number of Merge input ports (Ports[1+])
func (s *Station) InputPortCount() int {
	if s.Type != StationTypeMerge || len(s.Ports) <= 1 {
		return 0
	}
	return len(s.Ports) - 1
}

// OutputPortCount returns the number of Split output ports (Ports[1+])
func (s *Station) OutputPortCount() int {
	if s.Type != StationTypeSplit || len(s.Ports) <= 1 {
		return 0
	}
	return len(s.Ports) - 1
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

// IsInputReady returns true if station can accept a new work (inputReady signal on Port[0])
func (s *Station) IsInputReady() bool {
	if s.Signals != nil {
		return s.Signals["inputReady"]
	}
	return s.State == StateIdle && s.GetWork() == nil
}

// IsOutputReady returns true if station has completed work and ready to send (outputReady signal on Port[0])
func (s *Station) IsOutputReady() bool {
	if s.Signals != nil {
		return s.Signals["outputReady"]
	}
	return s.State == StateCompleted && s.GetWork() != nil
}

// InitializeSignals sets all signals to their initial values from the interlock config
func (s *Station) InitializeSignals() {
	if s.InterlockRules == nil {
		return
	}
	if len(s.Ports) == 0 {
		s.Ports = []Port{{Capacity: 1}}
	}
	s.Ports[0].Signals = make(map[string]bool)
	for _, sig := range s.InterlockRules.Signals {
		s.Ports[0].Signals[sig.Name] = sig.Initial
	}
	// Station.Signals is a shortcut to Ports[0].Signals
	s.Signals = s.Ports[0].Signals

	autoCorrectControlSignals(s.Signals, s.InterlockRules)
}

// autoCorrectControlSignals fixes control signal initial values
func autoCorrectControlSignals(signals map[string]bool, rules *InterlockConfig) {
	if signals == nil || rules == nil {
		return
	}
	for _, controlSig := range []string{"inputReady", "outputReady"} {
		if !signals[controlSig] {
			continue
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
func (s *Station) CanAcceptWork() bool {
	if s.Type == StationTypeSource || s.Type == StationTypeModuler {
		return false
	}
	return s.IsInputReady()
}

// AddWork adds a work to the station (interlock-controlled)
func (s *Station) AddWork(work *Work) error {
	if !s.CanAcceptWork() {
		return fmt.Errorf("station %s cannot accept work (InputReady=OFF, state=%s)", s.ID, s.State)
	}
	s.SetWork(work)
	s.State = StateReceiving
	return nil
}

// InitializeInterlockRulesFromConfig loads custom interlock rules from the station's config map.
func (s *Station) InitializeInterlockRulesFromConfig() {
	if ilRaw, ok := s.Config["interlockRules"]; ok {
		parsed := parseInterlockConfig(ilRaw)
		if parsed != nil {
			s.InterlockRules = parsed
		}
	}
}

// InitializePorts initializes Port[1+] from the station config.
// Port[0] is the station body (initialized by InitializeSignals).
// Port[1+] are Merge input ports or Split output ports.
func (s *Station) InitializePorts() {
	portsConfig := s.getPortsConfig()
	if len(portsConfig) == 0 {
		return
	}
	if len(s.Ports) == 0 {
		s.Ports = []Port{{Capacity: 1}}
	}

	var getDefaultConfig func() *InterlockConfig
	if s.Type == StationTypeMerge {
		getDefaultConfig = GetDefaultMergePortInterlockConfig
	} else if s.Type == StationTypeSplit {
		getDefaultConfig = GetDefaultSplitPortInterlockConfig
	} else {
		return
	}

	for _, b := range portsConfig {
		capacity := 1
		if c, ok := b["capacity"].(float64); ok && c >= 1 {
			capacity = int(c)
		}
		port := Port{Capacity: capacity}

		if ilRaw, ok := b["interlockRules"]; ok {
			port.InterlockRules = parseInterlockConfig(ilRaw)
		}
		if port.InterlockRules == nil {
			port.InterlockRules = getDefaultConfig()
		}

		port.Signals = make(map[string]bool)
		for _, sig := range port.InterlockRules.Signals {
			port.Signals[sig.Name] = sig.Initial
		}
		autoCorrectControlSignals(port.Signals, port.InterlockRules)

		s.Ports = append(s.Ports, port)
	}
}

// parseInterlockConfig parses an InterlockConfig from a raw interface{} (JSON-decoded map)
func parseInterlockConfig(raw interface{}) *InterlockConfig {
	m, ok := raw.(map[string]interface{})
	if !ok {
		return nil
	}

	config := &InterlockConfig{}

	if sigs, ok := m["signals"].([]interface{}); ok {
		for _, s := range sigs {
			if sm, ok := s.(map[string]interface{}); ok {
				name, _ := sm["name"].(string)
				initial, _ := sm["initial"].(bool)
				config.Signals = append(config.Signals, SignalDef{Name: name, Initial: initial})
			}
		}
	}

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

// AddWorkToPort adds a work to the specified input port (Ports[portIndex+1])
func (s *Station) AddWorkToPort(work *Work, portIndex int) error {
	if s.Type != StationTypeMerge {
		return fmt.Errorf("station %s is not a merge station", s.ID)
	}
	port := s.GetInputPort(portIndex)
	if port == nil {
		return fmt.Errorf("port index %d out of range for station %s (has %d ports)", portIndex, s.ID, s.InputPortCount())
	}
	if len(port.Works) >= port.Capacity {
		return fmt.Errorf("port %d at station %s is full (capacity=%d)", portIndex, s.ID, port.Capacity)
	}
	port.Works = append(port.Works, work)
	return nil
}

// CheckMergeCondition checks if all input ports (Ports[1+]) are full
func (s *Station) CheckMergeCondition() bool {
	portCount := s.InputPortCount()
	if portCount == 0 {
		return false
	}
	for i := 0; i < portCount; i++ {
		port := s.GetInputPort(i)
		if len(port.Works) < port.Capacity {
			return false
		}
	}
	return true
}

// ExecuteMerge consumes all works from all input ports and creates a merged work at Port[0].
func (s *Station) ExecuteMerge(newWorkIDFunc func() (string, string)) (*Work, []*Work, error) {
	if s.Type != StationTypeMerge {
		return nil, nil, fmt.Errorf("station %s is not a merge station", s.ID)
	}

	outputWorkType := s.GetStringConfig("outputWorkType")

	var consumedWorks []*Work
	for i := 0; i < s.InputPortCount(); i++ {
		port := s.GetInputPort(i)
		consumedWorks = append(consumedWorks, port.Works...)
		port.Works = nil
	}

	if len(consumedWorks) == 0 {
		return nil, nil, fmt.Errorf("merge at station %s: no works to consume", s.ID)
	}

	workID, friendlyName := newWorkIDFunc()
	mergedWork := NewWorkWithType(workID, friendlyName, outputWorkType)

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

	s.SetWork(mergedWork)
	s.State = StateCompleted

	return mergedWork, consumedWorks, nil
}

// ExecuteSplit splits a merged work into component works and places them into output ports (Ports[1+]).
func (s *Station) ExecuteSplit(newWorkIDFunc func() (string, string)) ([]*Work, error) {
	if s.Type != StationTypeSplit {
		return nil, fmt.Errorf("station %s is not a split station", s.ID)
	}

	work := s.GetWork()
	if work == nil {
		return nil, fmt.Errorf("station %s has no work to split", s.ID)
	}

	mergedFrom, ok := work.Metadata["mergedFrom"]
	if !ok {
		return nil, fmt.Errorf("station %s: work %s has no mergedFrom metadata (not a merged work)", s.ID, work.ID)
	}

	mergedFromList, ok := mergedFrom.([]interface{})
	if !ok {
		return nil, fmt.Errorf("station %s: invalid mergedFrom format", s.ID)
	}

	var splitWorks []*Work
	sourceWorkID := work.ID
	sourceWorkType := work.Type

	for i, item := range mergedFromList {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		origType, _ := itemMap["type"].(string)

		wID, fName := newWorkIDFunc()
		splitWork := NewWorkWithType(wID, fName, origType)
		splitWork.Metadata = map[string]interface{}{
			"splitFrom": map[string]interface{}{
				"workId": sourceWorkID,
				"type":   sourceWorkType,
			},
		}
		splitWorks = append(splitWorks, splitWork)

		port := s.GetOutputPort(i)
		if port != nil {
			port.Works = append(port.Works, splitWork)
		}
	}

	s.SetWork(nil)
	s.State = StateIdle

	return splitWorks, nil
}

// GetOutputPortWorkByIndex gets the next work from a specific output port (Ports[portIndex+1])
func (s *Station) GetOutputPortWorkByIndex(portIndex int) *Work {
	port := s.GetOutputPort(portIndex)
	if port == nil {
		return nil
	}
	if len(port.Works) > 0 {
		work := port.Works[0]
		port.Works = port.Works[1:]
		return work
	}
	return nil
}

// HasOutputPortWorks returns true if any output port (Ports[1+]) has remaining works
func (s *Station) HasOutputPortWorks() bool {
	for i := 0; i < s.OutputPortCount(); i++ {
		port := s.GetOutputPort(i)
		if len(port.Works) > 0 {
			return true
		}
	}
	return false
}

// GetPortSignal gets a signal value from a specific port (Ports[portIndex+1])
func (s *Station) GetPortSignal(portIndex int, signalName string) bool {
	idx := portIndex + 1
	if idx <= 0 || idx >= len(s.Ports) {
		return false
	}
	if s.Ports[idx].Signals == nil {
		return false
	}
	return s.Ports[idx].Signals[signalName]
}

// SetPortSignal sets a signal value on a specific port (Ports[portIndex+1])
func (s *Station) SetPortSignal(portIndex int, signalName string, value bool) {
	idx := portIndex + 1
	if idx <= 0 || idx >= len(s.Ports) {
		return
	}
	if s.Ports[idx].Signals == nil {
		s.Ports[idx].Signals = make(map[string]bool)
	}
	s.Ports[idx].Signals[signalName] = value
}

// IsPortInputReady checks if a specific input port's inputReady signal is ON
func (s *Station) IsPortInputReady(portIndex int) bool {
	return s.GetPortSignal(portIndex, "inputReady")
}

// IsPortOutputReady checks if a specific output port's outputReady signal is ON
func (s *Station) IsPortOutputReady(portIndex int) bool {
	return s.GetPortSignal(portIndex, "outputReady")
}

// CanStartProcessing checks if the station can start processing
func (s *Station) CanStartProcessing() bool {
	if s.Type == StationTypeSource || s.Type == StationTypeDrain {
		return false
	}
	if s.Type == StationTypeMerge {
		return false
	}
	if s.Type == StationTypeEntry || s.Type == StationTypeExit || s.Type == StationTypeModuler {
		return false
	}
	return s.GetWork() != nil && s.State == StateReceiving
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
func (s *Station) CompleteProcessing(newWorkIDFunc func() (string, string)) error {
	if s.State != StateProcessing {
		return fmt.Errorf("station %s is not processing (state=%s)", s.ID, s.State)
	}
	if s.GetWork() == nil {
		return fmt.Errorf("station %s has no work to complete", s.ID)
	}
	s.State = StateCompleted
	return nil
}

// GetOutputWork retrieves the output work from Port[0] and resets station to idle
func (s *Station) GetOutputWork() (*Work, error) {
	if !s.IsOutputReady() {
		return nil, fmt.Errorf("station %s is not ready to output (OutputReady=OFF, state=%s)", s.ID, s.State)
	}
	work := s.GetWork()
	if work == nil {
		return nil, fmt.Errorf("station %s has no work to output", s.ID)
	}
	s.SetWork(nil)
	s.State = StateIdle
	return work, nil
}
