package simulation

// EventType represents the type of simulation event
type EventType string

const (
	EventWorkCreated         EventType = "WorkCreated"
	EventWorkArrived         EventType = "WorkArrived"
	EventProcessingStarted   EventType = "ProcessingStarted"
	EventProcessingCompleted EventType = "ProcessingCompleted"
	EventWorkDeparted        EventType = "WorkDeparted"
	EventWorkDestroyed       EventType = "WorkDestroyed"
	EventWorkMerged          EventType = "WorkMerged"
	EventWorkSplit           EventType = "WorkSplit"
	EventWorkInspected       EventType = "WorkInspected"
	EventWorkRouted          EventType = "WorkRouted"

	// Merge events
	EventMergeCompleted EventType = "MergeCompleted"

	// Split events
	EventSplitCompleted EventType = "SplitCompleted"

	// Timer events (workFull/workEmpty)
	EventCheckWorkFull  EventType = "CheckWorkFull"
	EventCheckWorkEmpty EventType = "CheckWorkEmpty"
)

// Event represents a simulation event
type Event struct {
	Type      EventType
	Time      float64
	Seq       uint64 // insertion-order tiebreaker for deterministic same-time ordering
	StationID string
	WorkID    *string
	PortIndex int // Port index for port-level events (-1 = no port)
}

// NewEvent creates a new event (PortIndex = -1)
func NewEvent(eventType EventType, time float64, stationID string, workID *string) *Event {
	return &Event{
		Type:      eventType,
		Time:      time,
		StationID: stationID,
		WorkID:    workID,
		PortIndex: -1,
	}
}

// NewPortEvent creates a new event with a port index
func NewPortEvent(eventType EventType, time float64, stationID string, workID *string, portIndex int) *Event {
	return &Event{
		Type:      eventType,
		Time:      time,
		StationID: stationID,
		WorkID:    workID,
		PortIndex: portIndex,
	}
}
