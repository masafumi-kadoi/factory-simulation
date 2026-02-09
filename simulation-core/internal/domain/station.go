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
	StationTypeInspection StationType = "inspection"
	StationTypeDischarge  StationType = "discharge"
)

// StationState represents the state of a station in the state machine
type StationState string

const (
	StateIdle       StationState = "idle"       // Waiting (no work)
	StateReceiving  StationState = "receiving"  // Receiving work
	StateWaiting    StationState = "waiting"    // Waiting for more works (Merge only)
	StateProcessing StationState = "processing" // Processing
	StateOutputting StationState = "outputting" // Outputting works (Split only)
	StateCompleted  StationState = "completed"  // Processing completed (waiting for departure)
)

// StateTransition represents a state transition rule (for future JSON-based configuration)
type StateTransition struct {
	From       StationState `json:"from"`
	To         StationState `json:"to"`
	Trigger    string       `json:"trigger"`
	Conditions []string     `json:"conditions,omitempty"` // Future: condition expressions
}

// Station represents a station in the factory simulation
type Station struct {
	ID       string
	Type     StationType
	ParentID *string

	// Unified work management
	Works       []*Work // All station types: holds 0, 1, or multiple works
	OutputIndex int     // For Split/Discharge: next work index to output

	// State machine
	State StationState

	// Future: JSON-based state transition definitions (unused for now)
	StateTransitions []StateTransition `json:"stateTransitions,omitempty"`

	// Timestamps (for logging)
	StateChangedAt         *float64 // State change timestamp
	WorkArrivalTime        *float64
	WorkDepartureTime      *float64
	ProcessingStartTime    *float64
	ProcessingCompleteTime *float64

	// Configuration (processing time, arrival time, departure time, etc.)
	Config map[string]interface{}
}

// NewStation creates a new station
func NewStation(id string, stationType StationType, config map[string]interface{}) *Station {
	return &Station{
		ID:       id,
		Type:     stationType,
		ParentID: nil,
		Works:    []*Work{},
		State:    StateIdle,
		Config:   config,
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

// CanAcceptWork checks if the station can accept a new work
func (s *Station) CanAcceptWork() bool {
	switch s.Type {
	case StationTypeSource:
		return false // Source does not accept external works
	case StationTypeMerge:
		// Merge can accept multiple works
		return s.State == StateIdle || s.State == StateWaiting
	default:
		// Other stations accept only one work
		return s.State == StateIdle
	}
}

// AddWork adds a work to the station
func (s *Station) AddWork(work *Work) error {
	if !s.CanAcceptWork() {
		return fmt.Errorf("station %s cannot accept work in state %s", s.ID, s.State)
	}

	s.Works = append(s.Works, work)

	// State transition based on station type
	switch s.Type {
	case StationTypeMerge:
		requiredCount := s.GetIntConfig("requiredWorkCount")
		if len(s.Works) < requiredCount {
			s.State = StateWaiting // Still waiting for more works
		} else {
			s.State = StateReceiving // Required number reached
		}
	default:
		s.State = StateReceiving
	}

	return nil
}

// CanStartProcessing checks if the station can start processing
func (s *Station) CanStartProcessing() bool {
	switch s.Type {
	case StationTypeSource:
		return false // Source has no processing
	case StationTypeDrain:
		return false // Drain has no processing
	case StationTypeDischarge:
		return false // Discharge has no processing (routing only)
	case StationTypeMerge:
		// Merge requires all works to be ready
		requiredCount := s.GetIntConfig("requiredWorkCount")
		return len(s.Works) >= requiredCount && s.State == StateReceiving
	default:
		// Other stations require one work
		return len(s.Works) == 1 && s.State == StateReceiving
	}
}

// StartProcessing starts processing
func (s *Station) StartProcessing() error {
	if !s.CanStartProcessing() {
		return fmt.Errorf("station %s cannot start processing", s.ID)
	}

	s.State = StateProcessing
	return nil
}

// CompleteProcessing completes processing and generates output works
func (s *Station) CompleteProcessing(newWorkIDFunc func() (string, string)) error {
	if s.State != StateProcessing {
		return fmt.Errorf("station %s is not processing", s.ID)
	}

	switch s.Type {
	case StationTypeMerge:
		// Merge multiple works into one
		workID, friendlyName := newWorkIDFunc()
		newWork := NewWork(workID, friendlyName)
		// Inherit quality status from first work (or could be logic-based)
		if len(s.Works) > 0 {
			newWork.QualityStatus = s.Works[0].QualityStatus
		}
		s.Works = []*Work{newWork} // Replace with output work
		s.State = StateCompleted

	case StationTypeSplit:
		// Split one work into multiple
		outputCount := s.GetIntConfig("outputWorkCount")
		inputWork := s.Works[0] // Original work
		s.Works = make([]*Work, outputCount)
		for i := 0; i < outputCount; i++ {
			workID, friendlyName := newWorkIDFunc()
			s.Works[i] = NewWork(workID, friendlyName)
			s.Works[i].QualityStatus = inputWork.QualityStatus // Inherit quality status
		}
		s.OutputIndex = 0
		s.State = StateOutputting

	case StationTypeInspection:
		// Inspect quality (Work remains, QualityStatus is updated in engine.go with random)
		// Note: Quality status update is done in engine.go to access random generator
		s.State = StateCompleted

	default:
		// Processing Station: output as-is
		s.State = StateCompleted
	}

	return nil
}

// GetOutputWork retrieves an output work and updates state
func (s *Station) GetOutputWork() (*Work, error) {
	if s.State == StateCompleted {
		// Single work output (Processing, Merge, Inspection, Discharge)
		if len(s.Works) == 0 {
			return nil, fmt.Errorf("no work to output from station %s", s.ID)
		}
		work := s.Works[0]
		s.Works = s.Works[1:] // Remove output work
		if len(s.Works) == 0 {
			s.State = StateIdle
		}
		return work, nil

	} else if s.State == StateOutputting {
		// Sequential output (Split)
		if s.OutputIndex >= len(s.Works) {
			return nil, fmt.Errorf("no more works to output from station %s", s.ID)
		}
		work := s.Works[s.OutputIndex]
		s.OutputIndex++
		if s.OutputIndex >= len(s.Works) {
			// All outputs completed
			s.Works = nil
			s.OutputIndex = 0
			s.State = StateIdle
		}
		return work, nil
	}

	return nil, fmt.Errorf("station %s is not ready to output (state: %s)", s.ID, s.State)
}

// HasMoreOutputs checks if there are more outputs to send (for Split stations)
func (s *Station) HasMoreOutputs() bool {
	return s.State == StateOutputting && s.OutputIndex < len(s.Works)
}
