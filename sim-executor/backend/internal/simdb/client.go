package simdb

import (
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"
)

// SimDBConfig holds connection configuration for a SimDB
type SimDBConfig struct {
	Host     string
	Port     int
	Database string
	User     string
	Password string
}

// Client manages connections to a SimDB
type Client struct {
	conn *sql.DB
}

// Connect creates a new connection to the SimDB
func Connect(config SimDBConfig) (*Client, error) {
	connStr := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		config.Host, config.Port, config.User, config.Password, config.Database)

	conn, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open SimDB connection: %w", err)
	}

	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping SimDB: %w", err)
	}

	return &Client{conn: conn}, nil
}

// Close closes the SimDB connection
func (c *Client) Close() error {
	return c.conn.Close()
}

// LocationMasterEntry represents a location from LocationMaster table
type LocationMasterEntry struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// GetLocationMaster retrieves all entries from LocationMaster
func (c *Client) GetLocationMaster() ([]LocationMasterEntry, error) {
	rows, err := c.conn.Query(`SELECT id, name FROM "LocationMaster" ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("failed to query LocationMaster: %w", err)
	}
	defer rows.Close()

	var locations []LocationMasterEntry
	for rows.Next() {
		var loc LocationMasterEntry
		if err := rows.Scan(&loc.ID, &loc.Name); err != nil {
			return nil, fmt.Errorf("failed to scan LocationMaster: %w", err)
		}
		locations = append(locations, loc)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating LocationMaster: %w", err)
	}

	return locations, nil
}
