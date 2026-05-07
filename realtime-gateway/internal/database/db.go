package database

import (
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"
)

type DB struct {
	conn *sql.DB
}

func NewDB(host, port, user, password, dbname string) (*DB, error) {
	connStr := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, password, dbname,
	)
	conn, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open db: %w", err)
	}
	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping db: %w", err)
	}
	conn.SetMaxOpenConns(25)
	conn.SetMaxIdleConns(10)
	return &DB{conn: conn}, nil
}

func (d *DB) Conn() *sql.DB {
	return d.conn
}

func (d *DB) Close() error {
	return d.conn.Close()
}
