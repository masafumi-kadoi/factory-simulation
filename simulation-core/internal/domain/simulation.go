package domain

// SimulationStatus represents the status of a simulation
type SimulationStatus string

const (
	SimulationStatusRunning   SimulationStatus = "running"
	SimulationStatusCompleted SimulationStatus = "completed"
	SimulationStatusFailed    SimulationStatus = "failed"
)

// EndReason represents the reason why a simulation ended
type EndReason string

const (
	EndReasonTimeLimit      EndReason = "time_limit"
	EndReasonEventExhausted EndReason = "event_exhausted"
)

// SimulationSummary contains summary statistics about a simulation
type SimulationSummary struct {
	TotalWorksCreated   int
	TotalWorksDestroyed int
	TotalEvents         int
}

// Simulation represents a simulation run
type Simulation struct {
	ID         string
	ScenarioID string
	Status     SimulationStatus
	StartTime  float64
	EndTime    *float64
	EndReason  *EndReason
	Summary    SimulationSummary
}

// NewSimulation creates a new simulation
func NewSimulation(id, scenarioID string) *Simulation {
	return &Simulation{
		ID:         id,
		ScenarioID: scenarioID,
		Status:     SimulationStatusRunning,
		StartTime:  0.0,
		EndTime:    nil,
		EndReason:  nil,
		Summary: SimulationSummary{
			TotalWorksCreated:   0,
			TotalWorksDestroyed: 0,
			TotalEvents:         0,
		},
	}
}

// Complete marks the simulation as completed
func (s *Simulation) Complete(endTime float64, reason EndReason) {
	s.Status = SimulationStatusCompleted
	s.EndTime = &endTime
	s.EndReason = &reason
}

// Fail marks the simulation as failed
func (s *Simulation) Fail() {
	s.Status = SimulationStatusFailed
}
