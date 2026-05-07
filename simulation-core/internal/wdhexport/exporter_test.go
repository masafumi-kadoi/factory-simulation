package wdhexport

import (
	"database/sql"
	"factory-simulation/simulation-core/internal/domain"
	"factory-simulation/simulation-core/internal/simulation"
	"fmt"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

func getTestDBConfig() ExportConfig {
	return ExportConfig{
		Host:     getEnvOrDefault("TEST_DB_HOST", "localhost"),
		Port:     getEnvOrDefault("TEST_DB_PORT", "5432"),
		User:     getEnvOrDefault("TEST_DB_USER", "postgres"),
		Password: getEnvOrDefault("TEST_DB_PASSWORD", "postgres"),
		BaseTime: time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC),
	}
}

func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func connectTestDB(t *testing.T, config ExportConfig) *sql.DB {
	t.Helper()
	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=factory_simulation sslmode=disable",
		config.Host, config.Port, config.User, config.Password)
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		t.Skipf("Cannot connect to PostgreSQL: %v", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		t.Skipf("Cannot ping PostgreSQL: %v", err)
	}
	return db
}

func cleanupTestDB(t *testing.T, config ExportConfig, dbName string) {
	t.Helper()
	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=factory_simulation sslmode=disable",
		config.Host, config.Port, config.User, config.Password)
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return
	}
	defer db.Close()
	db.Exec(fmt.Sprintf(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()`, dbName))
	db.Exec(fmt.Sprintf(`DROP DATABASE IF EXISTS "%s"`, dbName))
}

func TestTimestampConversion(t *testing.T) {
	e := NewExporter(ExportConfig{
		BaseTime: time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC),
	})

	tests := []struct {
		name     string
		simTime  float64
		expected time.Time
	}{
		{"zero", 0.0, time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC)},
		{"one second", 1.0, time.Date(2026, 5, 1, 9, 0, 1, 0, time.UTC)},
		{"sixty seconds", 60.0, time.Date(2026, 5, 1, 9, 1, 0, 0, time.UTC)},
		{"fractional", 1.5, time.Date(2026, 5, 1, 9, 0, 1, 500000000, time.UTC)},
		{"large value", 3600.0, time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := e.simTimeToTimestamp(tt.simTime)
			if !got.Equal(tt.expected) {
				t.Errorf("simTimeToTimestamp(%v) = %v, want %v", tt.simTime, got, tt.expected)
			}
		})
	}
}

func TestCreateSchemaAndTables(t *testing.T) {
	config := getTestDBConfig()
	adminDB := connectTestDB(t, config)
	defer adminDB.Close()

	dbName := "wdh_test_schema"
	cleanupTestDB(t, config, dbName)
	defer cleanupTestDB(t, config, dbName)

	_, err := adminDB.Exec(fmt.Sprintf(`CREATE DATABASE "%s"`, dbName))
	if err != nil {
		t.Fatalf("Failed to create test DB: %v", err)
	}

	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		config.Host, config.Port, config.User, config.Password, dbName)
	targetDB, err := sql.Open("postgres", connStr)
	if err != nil {
		t.Fatalf("Failed to connect to target DB: %v", err)
	}
	defer targetDB.Close()

	if err := CreateSchema(targetDB); err != nil {
		t.Fatalf("CreateSchema failed: %v", err)
	}

	expectedTables := []string{
		"location_master", "connection_master", "machine_master",
		"item_master", "item_movement", "item_lineage",
		"item_status", "item_expiry", "machine_signal", "machine_status", "system_error",
	}
	for _, table := range expectedTables {
		var exists bool
		err := targetDB.QueryRow(
			`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
			table,
		).Scan(&exists)
		if err != nil {
			t.Errorf("Error checking table %s: %v", table, err)
		}
		if !exists {
			t.Errorf("Table %s was not created", table)
		}
	}
}

func TestExportLocationMaster(t *testing.T) {
	config := getTestDBConfig()
	adminDB := connectTestDB(t, config)
	defer adminDB.Close()

	dbName := "wdh_test_loc"
	cleanupTestDB(t, config, dbName)
	defer cleanupTestDB(t, config, dbName)

	_, err := adminDB.Exec(fmt.Sprintf(`CREATE DATABASE "%s"`, dbName))
	if err != nil {
		t.Fatalf("Failed to create test DB: %v", err)
	}

	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		config.Host, config.Port, config.User, config.Password, dbName)
	targetDB, err := sql.Open("postgres", connStr)
	if err != nil {
		t.Fatalf("Failed to connect to target DB: %v", err)
	}
	defer targetDB.Close()

	if err := CreateSchema(targetDB); err != nil {
		t.Fatalf("CreateSchema failed: %v", err)
	}

	posX := 100.0
	posY := 200.0

	e := &Exporter{
		config:      config,
		targetDB:    targetDB,
		locationMap: make(map[string]int64),
	}

	scenario := &domain.Scenario{
		Stations: []domain.Station{
			{ID: "source1", Type: domain.StationTypeSource, PositionX: &posX, PositionY: &posY, Config: map[string]interface{}{}},
			{ID: "proc1", Type: domain.StationTypeProcessing, Config: map[string]interface{}{"bufferCapacity": float64(5), "processingTime": float64(3.0)}},
			{ID: "drain1", Type: domain.StationTypeDrain, Config: map[string]interface{}{}},
		},
	}

	count, err := e.exportLocationMaster(scenario)
	if err != nil {
		t.Fatalf("exportLocationMaster failed: %v", err)
	}
	if count != 3 {
		t.Errorf("Expected 3 locations, got %d", count)
	}

	if _, ok := e.locationMap["source1"]; !ok {
		t.Error("source1 not in locationMap")
	}

	// Verify pos_x, pos_y, station_type
	var gotPosX, gotPosY float64
	var stationType string
	err = targetDB.QueryRow(`SELECT pos_x, pos_y, station_type FROM location_master WHERE name = $1`, "source1").Scan(&gotPosX, &gotPosY, &stationType)
	if err != nil {
		t.Fatalf("Failed to query source1: %v", err)
	}
	if gotPosX != 100.0 || gotPosY != 200.0 {
		t.Errorf("Expected pos (100, 200), got (%v, %v)", gotPosX, gotPosY)
	}
	if stationType != "source" {
		t.Errorf("Expected station_type=source, got %s", stationType)
	}

	// Verify max_capacity and processing_time
	var maxCap int64
	var procTime float64
	err = targetDB.QueryRow(`SELECT max_capacity, processing_time FROM location_master WHERE name = $1`, "proc1").Scan(&maxCap, &procTime)
	if err != nil {
		t.Fatalf("Failed to query proc1: %v", err)
	}
	if maxCap != 5 {
		t.Errorf("Expected max_capacity=5, got %d", maxCap)
	}
	if procTime != 3.0 {
		t.Errorf("Expected processing_time=3.0, got %v", procTime)
	}
}

func TestExportItemMovement(t *testing.T) {
	config := getTestDBConfig()
	adminDB := connectTestDB(t, config)
	defer adminDB.Close()

	dbName := "wdh_test_move"
	cleanupTestDB(t, config, dbName)
	defer cleanupTestDB(t, config, dbName)

	_, err := adminDB.Exec(fmt.Sprintf(`CREATE DATABASE "%s"`, dbName))
	if err != nil {
		t.Fatalf("Failed to create test DB: %v", err)
	}

	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		config.Host, config.Port, config.User, config.Password, dbName)
	targetDB, err := sql.Open("postgres", connStr)
	if err != nil {
		t.Fatalf("Failed to connect to target DB: %v", err)
	}
	defer targetDB.Close()

	if err := CreateSchema(targetDB); err != nil {
		t.Fatalf("CreateSchema failed: %v", err)
	}

	e := &Exporter{
		config:      config,
		targetDB:    targetDB,
		locationMap: map[string]int64{"source1": 1, "proc1": 2, "drain1": 3},
	}

	workEvents := []simulation.WorkEventLog{
		{WorkID: "w1", StationID: "source1", Timestamp: 0.0, EventType: "WorkCreated", PortIndex: -1},
		{WorkID: "w1", StationID: "source1", Timestamp: 0.0, EventType: "WorkArrived", PortIndex: -1},
		{WorkID: "w1", StationID: "source1", Timestamp: 1.0, EventType: "WorkDeparted", PortIndex: -1},
		{WorkID: "w1", StationID: "proc1", Timestamp: 1.0, EventType: "WorkArrived", PortIndex: -1},
		{WorkID: "w1", StationID: "proc1", Timestamp: 3.0, EventType: "WorkDeparted", PortIndex: -1},
		{WorkID: "w1", StationID: "drain1", Timestamp: 3.0, EventType: "WorkArrived", PortIndex: -1},
	}

	count, err := e.exportItemMovement(workEvents)
	if err != nil {
		t.Fatalf("exportItemMovement failed: %v", err)
	}
	if count != 5 {
		t.Errorf("Expected 5 movement records, got %d", count)
	}

	// Verify arrived at proc1 has from_location_id = source1 (1)
	var fromLocID *int64
	var toLocID int64
	err = targetDB.QueryRow(
		`SELECT from_location_id, to_location_id FROM item_movement WHERE item_id = $1 AND movement_type = 'arrived' AND to_location_id = $2`,
		"w1", 2,
	).Scan(&fromLocID, &toLocID)
	if err != nil {
		t.Fatalf("Failed to query item_movement: %v", err)
	}
	if fromLocID == nil || *fromLocID != 1 {
		t.Errorf("Expected from_location_id=1, got %v", fromLocID)
	}
}

func TestExportMachineSignal(t *testing.T) {
	config := getTestDBConfig()
	adminDB := connectTestDB(t, config)
	defer adminDB.Close()

	dbName := "wdh_test_signal"
	cleanupTestDB(t, config, dbName)
	defer cleanupTestDB(t, config, dbName)

	_, err := adminDB.Exec(fmt.Sprintf(`CREATE DATABASE "%s"`, dbName))
	if err != nil {
		t.Fatalf("Failed to create test DB: %v", err)
	}

	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		config.Host, config.Port, config.User, config.Password, dbName)
	targetDB, err := sql.Open("postgres", connStr)
	if err != nil {
		t.Fatalf("Failed to connect to target DB: %v", err)
	}
	defer targetDB.Close()

	if err := CreateSchema(targetDB); err != nil {
		t.Fatalf("CreateSchema failed: %v", err)
	}

	e := &Exporter{
		config:      config,
		targetDB:    targetDB,
		locationMap: map[string]int64{"proc1": 1},
	}

	statusLogs := []simulation.StationStatusLog{
		{StationID: "proc1", Timestamp: 0.0, StatusType: "signal_change", SignalName: "inputReady", Value: true, OldValue: false, RuleID: "rule1"},
		{StationID: "proc1", Timestamp: 1.0, StatusType: "signal_change", SignalName: "outputReady", Value: true, OldValue: false, RuleID: "rule2"},
		{StationID: "proc1", Timestamp: 2.0, StatusType: "signal_change", SignalName: "inputReady", Value: false, OldValue: true, RuleID: "rule1"},
		{StationID: "proc1", Timestamp: 0.5, StatusType: "処理完了", SignalName: "", Value: true},
	}

	count, err := e.exportMachineSignal(statusLogs)
	if err != nil {
		t.Fatalf("exportMachineSignal failed: %v", err)
	}
	if count != 3 {
		t.Errorf("Expected 3 signal records (non-signal_change filtered), got %d", count)
	}

	// Verify data
	var signalName string
	var value, oldValue bool
	var ruleID string
	err = targetDB.QueryRow(
		`SELECT signal_name, value, old_value, rule_id FROM machine_signal WHERE machine_id = $1 ORDER BY event_time LIMIT 1`,
		"proc1",
	).Scan(&signalName, &value, &oldValue, &ruleID)
	if err != nil {
		t.Fatalf("Failed to query machine_signal: %v", err)
	}
	if signalName != "inputReady" {
		t.Errorf("Expected signal_name=inputReady, got %s", signalName)
	}
	if !value {
		t.Error("Expected value=true")
	}
	if oldValue {
		t.Error("Expected old_value=false")
	}
}

func TestFullExport(t *testing.T) {
	config := getTestDBConfig()
	adminDB := connectTestDB(t, config)
	defer adminDB.Close()

	simID := "test0001-full-export"
	dbName := "wdh_test0001"
	cleanupTestDB(t, config, dbName)
	defer cleanupTestDB(t, config, dbName)

	posX1, posY1 := 0.0, 0.0
	posX2, posY2 := 100.0, 0.0
	posX3, posY3 := 200.0, 0.0

	scenario := &domain.Scenario{
		Stations: []domain.Station{
			{ID: "source1", Type: domain.StationTypeSource, PositionX: &posX1, PositionY: &posY1, Config: map[string]interface{}{"interArrivalTime": float64(2)}},
			{ID: "proc1", Name: "Processor A", Type: domain.StationTypeProcessing, PositionX: &posX2, PositionY: &posY2, Config: map[string]interface{}{"processingTime": float64(3)}},
			{ID: "drain1", Type: domain.StationTypeDrain, PositionX: &posX3, PositionY: &posY3, Config: map[string]interface{}{}},
		},
		Connections: []domain.Connection{
			{From: "source1", To: "proc1", Condition: domain.RoutingDefault, FromPortIndex: -1, ToPortIndex: -1},
			{From: "proc1", To: "drain1", Condition: domain.RoutingDefault, FromPortIndex: -1, ToPortIndex: -1},
		},
	}

	workEvents := []simulation.WorkEventLog{
		{WorkID: "w1", WorkType: "typeA", StationID: "source1", Timestamp: 0.0, EventType: "WorkCreated", PortIndex: -1},
		{WorkID: "w1", StationID: "source1", Timestamp: 0.0, EventType: "WorkArrived", PortIndex: -1},
		{WorkID: "w1", StationID: "source1", Timestamp: 0.5, EventType: "WorkDeparted", PortIndex: -1},
		{WorkID: "w1", StationID: "proc1", Timestamp: 0.5, EventType: "WorkArrived", PortIndex: -1},
		{WorkID: "w1", StationID: "proc1", Timestamp: 3.5, EventType: "ProcessingCompleted", QualityStatus: "OK", PortIndex: -1},
		{WorkID: "w1", StationID: "proc1", Timestamp: 3.5, EventType: "WorkDeparted", PortIndex: -1},
		{WorkID: "w1", StationID: "drain1", Timestamp: 3.5, EventType: "WorkArrived", PortIndex: -1},
		{WorkID: "w1", StationID: "drain1", Timestamp: 3.5, EventType: "WorkDestroyed", PortIndex: -1},
	}

	statusLogs := []simulation.StationStatusLog{
		{StationID: "proc1", Timestamp: 0.0, StatusType: "signal_change", SignalName: "inputReady", Value: true, OldValue: false, RuleID: "default"},
		{StationID: "proc1", Timestamp: 0.5, StatusType: "signal_change", SignalName: "inputReady", Value: false, OldValue: true, RuleID: "default"},
	}

	lineageLogs := []simulation.WorkLineageLog{}

	exporter := NewExporter(config)
	result, err := exporter.Export(ExportInput{
		SimulationID:      simID,
		Scenario:          scenario,
		WorkEvents:        workEvents,
		LineageLogs:       lineageLogs,
		StationStatusLogs: statusLogs,
	})
	if err != nil {
		t.Fatalf("Export failed: %v", err)
	}

	if result.DatabaseName != dbName {
		t.Errorf("Expected database name %s, got %s", dbName, result.DatabaseName)
	}

	if result.RecordCounts["location_master"] != 3 {
		t.Errorf("Expected 3 location_master records, got %d", result.RecordCounts["location_master"])
	}
	if result.RecordCounts["connection_master"] != 2 {
		t.Errorf("Expected 2 connection_master records, got %d", result.RecordCounts["connection_master"])
	}
	if result.RecordCounts["machine_master"] != 1 {
		t.Errorf("Expected 1 machine_master record, got %d", result.RecordCounts["machine_master"])
	}
	if result.RecordCounts["item_master"] != 1 {
		t.Errorf("Expected 1 item_master record, got %d", result.RecordCounts["item_master"])
	}
	if result.RecordCounts["item_movement"] != 5 {
		t.Errorf("Expected 5 item_movement records, got %d", result.RecordCounts["item_movement"])
	}
	if result.RecordCounts["item_status"] != 1 {
		t.Errorf("Expected 1 item_status record, got %d", result.RecordCounts["item_status"])
	}
	if result.RecordCounts["machine_signal"] != 2 {
		t.Errorf("Expected 2 machine_signal records, got %d", result.RecordCounts["machine_signal"])
	}

	// Verify data in created DB
	targetConnStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		config.Host, config.Port, config.User, config.Password, dbName)
	targetDB, err := sql.Open("postgres", targetConnStr)
	if err != nil {
		t.Fatalf("Failed to connect to exported DB: %v", err)
	}
	defer targetDB.Close()

	// Check item_master
	var itemType string
	err = targetDB.QueryRow(`SELECT item_type FROM item_master WHERE id = $1`, "w1").Scan(&itemType)
	if err != nil {
		t.Fatalf("Failed to query item_master: %v", err)
	}
	if itemType != "typeA" {
		t.Errorf("Expected item_type=typeA, got %s", itemType)
	}

	// Check machine_master
	var machineName string
	var cycleTime float64
	err = targetDB.QueryRow(`SELECT name, cycle_time FROM machine_master WHERE id = $1`, "proc1").Scan(&machineName, &cycleTime)
	if err != nil {
		t.Fatalf("Failed to query machine_master: %v", err)
	}
	if machineName != "Processor A" {
		t.Errorf("Expected name='Processor A', got %s", machineName)
	}
	if cycleTime != 3 {
		t.Errorf("Expected cycle_time=3, got %v", cycleTime)
	}

	// Check connection_master
	var connCount int
	err = targetDB.QueryRow(`SELECT count(*) FROM connection_master`).Scan(&connCount)
	if err != nil {
		t.Fatalf("Failed to query connection_master: %v", err)
	}
	if connCount != 2 {
		t.Errorf("Expected 2 connections, got %d", connCount)
	}

	// Check location_master has position
	var px, py float64
	err = targetDB.QueryRow(`SELECT pos_x, pos_y FROM location_master WHERE name = $1`, "proc1").Scan(&px, &py)
	if err != nil {
		t.Fatalf("Failed to query location pos: %v", err)
	}
	if px != 100.0 || py != 0.0 {
		t.Errorf("Expected pos (100, 0), got (%v, %v)", px, py)
	}
}
