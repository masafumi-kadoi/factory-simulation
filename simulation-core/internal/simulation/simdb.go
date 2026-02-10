package simulation

import "github.com/google/uuid"

// SimDB represents a simulation database for managing predefined work IDs
// This is a placeholder for future integration with actual database
type SimDB struct {
	// Map of stationID -> list of predefined work IDs
	workIDsByStation map[string][]string
	// Map of stationID -> current index for fetching next work ID
	workIDIndexes map[string]int
}

// NewSimDB creates a new SimDB instance
func NewSimDB(workIDsByStation map[string][]string) *SimDB {
	if workIDsByStation == nil {
		workIDsByStation = make(map[string][]string)
	}

	return &SimDB{
		workIDsByStation: workIDsByStation,
		workIDIndexes:    make(map[string]int),
	}
}

// GetNextWorkID retrieves the next work ID for a given station from SimDB
// If no predefined ID exists, returns an empty string (caller should generate UUID)
func (db *SimDB) GetNextWorkID(stationID string) string {
	// Check if we have predefined IDs for this station
	ids, exists := db.workIDsByStation[stationID]
	if !exists || len(ids) == 0 {
		// No predefined IDs, return empty string to signal UUID generation
		return ""
	}

	// Get current index
	index, exists := db.workIDIndexes[stationID]
	if !exists {
		index = 0
	}

	// Check if we've exhausted the predefined IDs
	if index >= len(ids) {
		// No more predefined IDs, return empty string
		return ""
	}

	// Get the ID and increment index
	workID := ids[index]
	db.workIDIndexes[stationID] = index + 1

	return workID
}

// GenerateWorkID generates a UUID for a work
func GenerateWorkID() string {
	return uuid.New().String()
}
