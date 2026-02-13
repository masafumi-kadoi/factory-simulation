package domain

import "fmt"

// StationType represents the type of a station
type StationType string

const (
	StationTypeSource     StationType = "source"     // Simplified: Source only generates works
	StationTypeProcessing StationType = "processing" // Base class: handles one work at a time
	StationTypeDrain      StationType = "drain"      // Simplified: Drain only destroys works
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
	Type       StationType
	ParentID   *string
	LocationID *int64

	// Work management: Only ONE work at a time (interlock mechanism)
	CurrentWork *Work // The work currently at this station (nil if idle)

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

// IsInputReady returns true if station can accept a new work (搬入可 signal)
func (s *Station) IsInputReady() bool {
	// Input ready only when station is idle (no work present)
	return s.State == StateIdle && s.CurrentWork == nil
}

// IsOutputReady returns true if station has completed work and ready to send (搬出可 signal)
func (s *Station) IsOutputReady() bool {
	// Output ready only when station has completed processing
	return s.State == StateCompleted && s.CurrentWork != nil
}

// CanAcceptWork checks if the station can accept a new work
// This is the interlock mechanism: only accept when InputReady is ON
func (s *Station) CanAcceptWork() bool {
	if s.Type == StationTypeSource {
		return false // Source does not accept external works
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

// CanStartProcessing checks if the station can start processing
func (s *Station) CanStartProcessing() bool {
	if s.Type == StationTypeSource || s.Type == StationTypeDrain {
		return false // Source and Drain have no processing
	}
	// Processing station can start when work has arrived
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
// This is called when OutputReady signal is ON (or for Source stations)
func (s *Station) GetOutputWork() (*Work, error) {
	// Source stations have special behavior
	if s.Type != StationTypeSource && !s.IsOutputReady() {
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
