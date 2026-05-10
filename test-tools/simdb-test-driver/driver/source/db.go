package source

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type DBSource struct {
	dsn string
}

func NewDBSource(dsn string) *DBSource {
	return &DBSource{dsn: dsn}
}

func (s *DBSource) Name() string { return "db:" + s.dsn }

func (s *DBSource) LoadMaster() (*MasterData, error) {
	conn, err := pgx.Connect(context.Background(), s.dsn)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(context.Background())

	md := &MasterData{Rows: make(map[string][]map[string]string)}
	for _, table := range MasterTables {
		rows, err := queryAllRows(conn, table, "")
		if err != nil {
			return nil, err
		}
		md.Rows[table] = rows
	}
	return md, nil
}

func (s *DBSource) LoadEvents() ([]TimedEvent, error) {
	conn, err := pgx.Connect(context.Background(), s.dsn)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(context.Background())

	var all []TimedEvent
	for _, table := range LogTables {
		rows, err := queryAllRows(conn, table, "ORDER BY event_time ASC")
		if err != nil {
			return nil, err
		}
		events, err := rowsToEvents(table, rows)
		if err != nil {
			return nil, err
		}
		all = append(all, events...)
	}
	sortEvents(all)
	return all, nil
}

// queryAllRows は指定テーブルの全行を map スライスで返す。
// orderClause には "ORDER BY event_time ASC" などを渡す（空文字も可）。
func queryAllRows(conn *pgx.Conn, table, orderClause string) ([]map[string]string, error) {
	query := fmt.Sprintf("SELECT * FROM %s %s", table, orderClause)
	rows, err := conn.Query(context.Background(), query)
	if err != nil {
		return nil, fmt.Errorf("query %s: %w", table, err)
	}
	defer rows.Close()

	fieldDescs := rows.FieldDescriptions()
	var result []map[string]string
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("scan %s: %w", table, err)
		}
		row := make(map[string]string, len(fieldDescs))
		for i, fd := range fieldDescs {
			if vals[i] == nil {
				row[string(fd.Name)] = ""
			} else {
				row[string(fd.Name)] = fmt.Sprintf("%v", vals[i])
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}
