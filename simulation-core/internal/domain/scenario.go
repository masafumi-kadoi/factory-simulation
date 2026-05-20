package domain

import "time"

// RoutingCondition represents a routing condition for conditional routing
type RoutingCondition string

const (
	RoutingDefault   RoutingCondition = "default"    // Unconditional (default)
	RoutingQualityOK RoutingCondition = "quality_ok" // Quality OK
	RoutingQualityNG RoutingCondition = "quality_ng" // Quality NG
)

// Connection represents a connection between two stations
type Connection struct {
	From            string
	To              string
	Condition       RoutingCondition
	FromPortIndex int // Split output port index (-1 = no buffer)
	ToPortIndex   int // Merge input port index (-1 = no buffer)
}

// SimDBConfig represents connection info for a SimDB (per manufacturing line)
type SimDBConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password,omitempty"`
}

// Scenario represents a simulation scenario
type Scenario struct {
	ID          string
	Name        string
	FactoryID   *string
	SimDBConfig *SimDBConfig
	Stations    []Station
	Connections []Connection
	CreatedAt   *time.Time
	UpdatedAt   *time.Time

	stationIndex      map[string]int    // station ID -> index in Stations slice
	StationMachineMap map[string]string // station ID -> parent Moduler station ID
	connectionsFrom   map[string][]int  // station ID -> indices into Connections slice (outgoing)
	connectionsTo     map[string][]int  // station ID -> indices into Connections slice (incoming)
}

// SubScenario represents the internal stations and connections within a ModulerStation.
// It is a lightweight container that holds only the station graph without scenario metadata.
type SubScenario struct {
	Stations    []Station
	Connections []Connection
}

// NewScenario creates a new scenario
func NewScenario(id, name string, stations []Station, connections []Connection) *Scenario {
	return &Scenario{
		ID:          id,
		Name:        name,
		Stations:    stations,
		Connections: connections,
	}
}

// BuildStationIndex builds the station ID -> index map for O(1) lookups,
// and the connection index maps for efficient neighbor queries.
// Must be called after Stations and Connections are finalized (e.g., after FlattenScenario).
func (s *Scenario) BuildStationIndex() {
	s.stationIndex = make(map[string]int, len(s.Stations))
	for i := range s.Stations {
		s.stationIndex[s.Stations[i].ID] = i
	}

	s.connectionsFrom = make(map[string][]int, len(s.Stations))
	s.connectionsTo = make(map[string][]int, len(s.Stations))
	for i, conn := range s.Connections {
		s.connectionsFrom[conn.From] = append(s.connectionsFrom[conn.From], i)
		s.connectionsTo[conn.To] = append(s.connectionsTo[conn.To], i)
	}
}

// GetConnectionsFrom returns connections originating from the given station.
func (s *Scenario) GetConnectionsFrom(stationID string) []Connection {
	if s.connectionsFrom != nil {
		indices := s.connectionsFrom[stationID]
		result := make([]Connection, len(indices))
		for i, idx := range indices {
			result[i] = s.Connections[idx]
		}
		return result
	}
	var result []Connection
	for _, conn := range s.Connections {
		if conn.From == stationID {
			result = append(result, conn)
		}
	}
	return result
}

// GetConnectionsTo returns connections targeting the given station.
func (s *Scenario) GetConnectionsTo(stationID string) []Connection {
	if s.connectionsTo != nil {
		indices := s.connectionsTo[stationID]
		result := make([]Connection, len(indices))
		for i, idx := range indices {
			result[i] = s.Connections[idx]
		}
		return result
	}
	var result []Connection
	for _, conn := range s.Connections {
		if conn.To == stationID {
			result = append(result, conn)
		}
	}
	return result
}

// GetStation retrieves a station by ID
func (s *Scenario) GetStation(id string) *Station {
	if s.stationIndex != nil {
		if idx, ok := s.stationIndex[id]; ok {
			return &s.Stations[idx]
		}
		return nil
	}
	for i := range s.Stations {
		if s.Stations[i].ID == id {
			return &s.Stations[i]
		}
	}
	return nil
}

// GetNextStations returns the IDs of stations connected from the given station
func (s *Scenario) GetNextStations(stationID string) []string {
	var nextStations []string
	for _, conn := range s.Connections {
		if conn.From == stationID {
			nextStations = append(nextStations, conn.To)
		}
	}
	return nextStations
}
