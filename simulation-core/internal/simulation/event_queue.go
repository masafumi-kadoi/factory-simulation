package simulation

import "container/heap"

// EventQueue is a priority queue of events ordered by time
type EventQueue []*Event

// Len returns the length of the queue
func (eq EventQueue) Len() int {
	return len(eq)
}

// Less compares two events by time, then by insertion order for determinism
func (eq EventQueue) Less(i, j int) bool {
	if eq[i].Time != eq[j].Time {
		return eq[i].Time < eq[j].Time
	}
	return eq[i].Seq < eq[j].Seq
}

// Swap swaps two events
func (eq EventQueue) Swap(i, j int) {
	eq[i], eq[j] = eq[j], eq[i]
}

// Push adds an event to the queue
func (eq *EventQueue) Push(x interface{}) {
	*eq = append(*eq, x.(*Event))
}

// Pop removes and returns the event with the smallest time
func (eq *EventQueue) Pop() interface{} {
	old := *eq
	n := len(old)
	event := old[n-1]
	*eq = old[0 : n-1]
	return event
}

// PriorityQueue is a wrapper around EventQueue that provides convenient methods
type PriorityQueue struct {
	queue EventQueue
	seq   uint64
}

// NewPriorityQueue creates a new priority queue
func NewPriorityQueue() *PriorityQueue {
	pq := &PriorityQueue{
		queue: make(EventQueue, 0),
	}
	heap.Init(&pq.queue)
	return pq
}

// Push adds an event to the queue, stamping it with a monotonic sequence number
func (pq *PriorityQueue) Push(event *Event) {
	event.Seq = pq.seq
	pq.seq++
	heap.Push(&pq.queue, event)
}

// Pop removes and returns the event with the smallest time
func (pq *PriorityQueue) Pop() *Event {
	if pq.IsEmpty() {
		return nil
	}
	return heap.Pop(&pq.queue).(*Event)
}

// IsEmpty returns true if the queue is empty
func (pq *PriorityQueue) IsEmpty() bool {
	return pq.queue.Len() == 0
}

// Len returns the number of events in the queue
func (pq *PriorityQueue) Len() int {
	return pq.queue.Len()
}
