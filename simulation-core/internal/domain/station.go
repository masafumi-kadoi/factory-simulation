package domain

// StationType represents the type of a station
type StationType string

const (
	StationTypeSource     StationType = "source"
	StationTypeProcessing StationType = "processing"
	StationTypeDrain      StationType = "drain"
)

// Station represents a station in the factory simulation
type Station struct {
	ID          string
	Type        StationType
	ParentID    *string
	CurrentWork *Work

	// Status flags
	CanReceive          bool
	CanDepart           bool
	ProcessingReady     bool
	ProcessingStarted   bool
	ProcessingCompleted bool

	// Timestamps
	CanReceiveOnTime       *float64
	CanReceiveOffTime      *float64
	CanDepartOnTime        *float64
	CanDepartOffTime       *float64
	ProcessingReadyTime    *float64
	ProcessingStartTime    *float64
	ProcessingCompleteTime *float64
	WorkArrivalTime        *float64
	WorkDepartureTime      *float64

	// Configuration (processing time, arrival time, departure time, etc.)
	Config map[string]interface{}
}

// NewStation creates a new station
func NewStation(id string, stationType StationType, config map[string]interface{}) *Station {
	return &Station{
		ID:          id,
		Type:        stationType,
		ParentID:    nil,
		CurrentWork: nil,
		CanReceive:  true,
		CanDepart:   false,
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
