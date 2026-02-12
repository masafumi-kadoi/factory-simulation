package domain

// RoutingCondition represents a routing condition for conditional routing
type RoutingCondition string

const (
	RoutingDefault   RoutingCondition = "default"    // Unconditional (default)
	RoutingQualityOK RoutingCondition = "quality_ok" // Quality OK
	RoutingQualityNG RoutingCondition = "quality_ng" // Quality NG
)

// Connection represents a connection between two stations
type Connection struct {
	From      string
	To        string
	Condition RoutingCondition
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
	SimDBConfig *SimDBConfig
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

// GetStation retrieves a station by ID
func (s *Scenario) GetStation(id string) *Station {
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
