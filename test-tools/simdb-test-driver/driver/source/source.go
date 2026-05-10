package source

import (
	"encoding/csv"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
)

// マスタテーブル名一覧（起動時に一括 INSERT）
var MasterTables = []string{
	"location_master",
	"connection_master",
	"machine_master",
	"item_master",
}

// ログテーブル名一覧（event_time 基準で順次 INSERT）
var LogTables = []string{
	"item_movement",
	"machine_signal",
	"item_status",
	"item_lineage",
	"item_expiry",
	"machine_status",
}

type MasterData struct {
	Rows map[string][]map[string]string // テーブル名 → 行スライス
}

type TimedEvent struct {
	EventTime time.Time
	Table     string
	Row       map[string]string
}

type DataSource interface {
	LoadMaster() (*MasterData, error)
	LoadEvents() ([]TimedEvent, error)
	Name() string
}

// parseCSV はCSVリーダーから全行をパースして返す。
// 1行目をヘッダーとして扱い、各行を map[colName]value に変換する。
func parseCSV(r io.Reader) ([]map[string]string, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true

	headers, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}
	for i, h := range headers {
		headers[i] = strings.TrimSpace(h)
	}

	var rows []map[string]string
	for {
		record, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read record: %w", err)
		}
		row := make(map[string]string, len(headers))
		for i, h := range headers {
			if i < len(record) {
				row[h] = record[i]
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// parseEventTime はCSV行の event_time カラムをパースする。
// PostgreSQL の timestamp 形式（"2006-01-02 15:04:05.999999"）と RFC3339 に対応。
func parseEventTime(row map[string]string) (time.Time, error) {
	v, ok := row["event_time"]
	if !ok || v == "" {
		return time.Time{}, fmt.Errorf("event_time column missing or empty")
	}
	formats := []string{
		"2006-01-02 15:04:05.999999",
		"2006-01-02 15:04:05",
		time.RFC3339Nano,
		time.RFC3339,
	}
	for _, f := range formats {
		if t, err := time.Parse(f, v); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("cannot parse event_time %q", v)
}

// rowsToEvents はログテーブルの行スライスを TimedEvent スライスに変換する。
func rowsToEvents(table string, rows []map[string]string) ([]TimedEvent, error) {
	events := make([]TimedEvent, 0, len(rows))
	for _, row := range rows {
		t, err := parseEventTime(row)
		if err != nil {
			return nil, fmt.Errorf("table %s: %w", table, err)
		}
		events = append(events, TimedEvent{EventTime: t, Table: table, Row: row})
	}
	return events, nil
}

// sortEvents は TimedEvent スライスを EventTime 昇順でソートする。
func sortEvents(events []TimedEvent) {
	sort.Slice(events, func(i, j int) bool {
		return events[i].EventTime.Before(events[j].EventTime)
	})
}
