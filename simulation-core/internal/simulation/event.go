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
	EventWorkPortEntered   EventType = "WorkPortEntered"   // Work added to Merge InputPort
	EventMergeCompleted EventType = "MergeCompleted"  // Merge processing completed

	// Split events
	EventSplitCompleted        EventType = "SplitCompleted"        // Split processing completed
	EventPortWorkDeparted  EventType = "PortWorkDeparted"  // Work departed from Split OutputPort
)

// Event represents a simulation event
type Event struct {
	Type      EventType
	Time      float64
	StationID string
	WorkID    *string
}

// NewEvent creates a new event
func NewEvent(eventType EventType, time float64, stationID string, workID *string) *Event {
	return &Event{
		Type:      eventType,
		Time:      time,
		StationID: stationID,
		WorkID:    workID,
	}
}
