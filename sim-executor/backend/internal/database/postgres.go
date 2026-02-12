package database

import (
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"
)

// DB represents a PostgreSQL database connection
type DB struct {
	conn *sql.DB
}

// NewDB creates a new database connection
func NewDB(host, port, user, password, dbname string) (*DB, error) {
	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, password, dbname)

	conn, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &DB{conn: conn}, nil
}

// Close closes the database connection
func (db *DB) Close() error {
	return db.conn.Close()
}

// GetConnection returns the underlying sql.DB connection
func (db *DB) GetConnection() *sql.DB {
	return db.conn
}
