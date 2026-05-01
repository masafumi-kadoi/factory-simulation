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
		"LocationMaster", "ProcMaster", "MachineMaster",
		"ActionInfo", "ItemIDInfo", "ItemConstructionMapping",
		"ItemStatus", "ExpiryTimeInfo", "MachineStatus", "InvalidInputRecords",
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

	var exists bool
	err = targetDB.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_status')`,
	).Scan(&exists)
	if err != nil {
		t.Errorf("Error checking enum type: %v", err)
	}
	if !exists {
		t.Error("ENUM type action_status was not created")
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

	e := &Exporter{
		config:      config,
		targetDB:    targetDB,
		locationMap: make(map[string]int64),
		procMap:     make(map[string]int64),
	}

	scenario := &domain.Scenario{
		Stations: []domain.Station{
			{ID: "source1", Type: domain.StationTypeSource, Config: map[string]interface{}{}},
			{ID: "proc1", Type: domain.StationTypeProcessing, Config: map[string]interface{}{"bufferCapacity": float64(5)}},
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

	// Verify locationMap
	if _, ok := e.locationMap["source1"]; !ok {
		t.Error("source1 not in locationMap")
	}
	if _, ok := e.locationMap["proc1"]; !ok {
		t.Error("proc1 not in locationMap")
	}
	if _, ok := e.locationMap["drain1"]; !ok {
		t.Error("drain1 not in locationMap")
	}

	// Verify max_capacity
	var maxCap int64
	err = targetDB.QueryRow(`SELECT max_capacity FROM "LocationMaster" WHERE name = $1`, "proc1").Scan(&maxCap)
	if err != nil {
		t.Fatalf("Failed to query proc1: %v", err)
	}
	if maxCap != 5 {
		t.Errorf("Expected max_capacity=5 for proc1, got %d", maxCap)
	}

	var defaultCap int64
	err = targetDB.QueryRow(`SELECT max_capacity FROM "LocationMaster" WHERE name = $1`, "source1").Scan(&defaultCap)
	if err != nil {
		t.Fatalf("Failed to query source1: %v", err)
	}
	if defaultCap != 1 {
		t.Errorf("Expected default max_capacity=1, got %d", defaultCap)
	}
}

func TestExportActionInfo(t *testing.T) {
	config := getTestDBConfig()
	adminDB := connectTestDB(t, config)
	defer adminDB.Close()

	dbName := "wdh_test_action"
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
		procMap:     make(map[string]int64),
	}

	workEvents := []simulation.WorkEventLog{
		{WorkID: "w1", StationID: "source1", Timestamp: 0.0, EventType: "WorkCreated"},
		{WorkID: "w1", StationID: "source1", Timestamp: 0.0, EventType: "WorkArrived"},
		{WorkID: "w1", StationID: "source1", Timestamp: 1.0, EventType: "WorkDeparted"},
		{WorkID: "w1", StationID: "proc1", Timestamp: 1.0, EventType: "WorkArrived"},
		{WorkID: "w1", StationID: "proc1", Timestamp: 3.0, EventType: "WorkDeparted"},
		{WorkID: "w1", StationID: "drain1", Timestamp: 3.0, EventType: "WorkArrived"},
	}

	count, err := e.exportActionInfo(workEvents)
	if err != nil {
		t.Fatalf("exportActionInfo failed: %v", err)
	}

	// 2 arrived + 2 departed for proc/drain arrivals, source arrive/depart = total 6 action events (3 arrived + 2 departed... let me count)
	// WorkArrived events: source1(0.0), proc1(1.0), drain1(3.0) = 3 arrived
	// WorkDeparted events: source1(1.0), proc1(3.0) = 2 departed
	// Total = 5
	if count != 5 {
		t.Errorf("Expected 5 action records, got %d", count)
	}

	// Verify an arrived record has correct origin
	var originLocID *int64
	var destLocID int64
	err = targetDB.QueryRow(
		`SELECT origin_location_id, destination_location_id FROM "ActionInfo" WHERE item_id = $1 AND action_status = 'arrived' AND destination_location_id = $2`,
		"w1", 2,
	).Scan(&originLocID, &destLocID)
	if err != nil {
		t.Fatalf("Failed to query ActionInfo: %v", err)
	}
	if originLocID == nil || *originLocID != 1 {
		t.Errorf("Expected origin_location_id=1 for proc1 arrival, got %v", originLocID)
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

	scenario := &domain.Scenario{
		Stations: []domain.Station{
			{ID: "source1", Type: domain.StationTypeSource, Config: map[string]interface{}{"interArrivalTime": float64(2)}},
			{ID: "proc1", Name: "Processor A", Type: domain.StationTypeProcessing, Config: map[string]interface{}{"processingTime": float64(3)}},
			{ID: "drain1", Type: domain.StationTypeDrain, Config: map[string]interface{}{}},
		},
		Connections: []domain.Connection{
			{From: "source1", To: "proc1"},
			{From: "proc1", To: "drain1"},
		},
	}

	workEvents := []simulation.WorkEventLog{
		{WorkID: "w1", WorkType: "typeA", StationID: "source1", Timestamp: 0.0, EventType: "WorkCreated"},
		{WorkID: "w1", StationID: "source1", Timestamp: 0.0, EventType: "WorkArrived"},
		{WorkID: "w1", StationID: "source1", Timestamp: 0.5, EventType: "WorkDeparted"},
		{WorkID: "w1", StationID: "proc1", Timestamp: 0.5, EventType: "WorkArrived"},
		{WorkID: "w1", StationID: "proc1", Timestamp: 3.5, EventType: "ProcessingCompleted", QualityStatus: "OK"},
		{WorkID: "w1", StationID: "proc1", Timestamp: 3.5, EventType: "WorkDeparted"},
		{WorkID: "w1", StationID: "drain1", Timestamp: 3.5, EventType: "WorkArrived"},
		{WorkID: "w1", StationID: "drain1", Timestamp: 3.5, EventType: "WorkDestroyed"},
	}

	lineageLogs := []simulation.WorkLineageLog{}

	exporter := NewExporter(config)
	result, err := exporter.Export(ExportInput{
		SimulationID: simID,
		Scenario:     scenario,
		WorkEvents:   workEvents,
		LineageLogs:  lineageLogs,
	})
	if err != nil {
		t.Fatalf("Export failed: %v", err)
	}

	if result.DatabaseName != dbName {
		t.Errorf("Expected database name %s, got %s", dbName, result.DatabaseName)
	}

	if result.RecordCounts["LocationMaster"] != 3 {
		t.Errorf("Expected 3 LocationMaster records, got %d", result.RecordCounts["LocationMaster"])
	}
	if result.RecordCounts["ProcMaster"] != 3 {
		t.Errorf("Expected 3 ProcMaster records, got %d", result.RecordCounts["ProcMaster"])
	}
	// MachineMaster: only proc1 (source and drain are excluded)
	if result.RecordCounts["MachineMaster"] != 1 {
		t.Errorf("Expected 1 MachineMaster record, got %d", result.RecordCounts["MachineMaster"])
	}
	if result.RecordCounts["ItemIDInfo"] != 1 {
		t.Errorf("Expected 1 ItemIDInfo record, got %d", result.RecordCounts["ItemIDInfo"])
	}
	// ActionInfo: 3 arrived + 2 departed = 5
	if result.RecordCounts["ActionInfo"] != 5 {
		t.Errorf("Expected 5 ActionInfo records, got %d", result.RecordCounts["ActionInfo"])
	}
	if result.RecordCounts["ItemStatus"] != 1 {
		t.Errorf("Expected 1 ItemStatus record, got %d", result.RecordCounts["ItemStatus"])
	}

	// Verify data in created DB
	targetConnStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		config.Host, config.Port, config.User, config.Password, dbName)
	targetDB, err := sql.Open("postgres", targetConnStr)
	if err != nil {
		t.Fatalf("Failed to connect to exported DB: %v", err)
	}
	defer targetDB.Close()

	// Check ItemIDInfo
	var itemType string
	err = targetDB.QueryRow(`SELECT item_type FROM "ItemIDInfo" WHERE item_id = $1`, "w1").Scan(&itemType)
	if err != nil {
		t.Fatalf("Failed to query ItemIDInfo: %v", err)
	}
	if itemType != "typeA" {
		t.Errorf("Expected item_type=typeA, got %s", itemType)
	}

	// Check MachineMaster
	var machineName string
	var cycleTime int64
	err = targetDB.QueryRow(`SELECT machine_name, machine_cycle_time FROM "MachineMaster" WHERE machine_id = $1`, "proc1").Scan(&machineName, &cycleTime)
	if err != nil {
		t.Fatalf("Failed to query MachineMaster: %v", err)
	}
	if machineName != "Processor A" {
		t.Errorf("Expected machine_name='Processor A', got %s", machineName)
	}
	if cycleTime != 3 {
		t.Errorf("Expected machine_cycle_time=3, got %d", cycleTime)
	}

	// Check ItemStatus: OK → 1
	var itemStatus int
	err = targetDB.QueryRow(`SELECT item_status FROM "ItemStatus" WHERE item_id = $1`, "w1").Scan(&itemStatus)
	if err != nil {
		t.Fatalf("Failed to query ItemStatus: %v", err)
	}
	if itemStatus != 1 {
		t.Errorf("Expected item_status=1 (OK), got %d", itemStatus)
	}
}
