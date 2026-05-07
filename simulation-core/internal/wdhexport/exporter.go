package wdhexport

import (
	"database/sql"
	"factory-simulation/simulation-core/internal/domain"
	"factory-simulation/simulation-core/internal/simulation"
	"fmt"
	"log"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

type ExportConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	BaseTime time.Time
}

type ExportResult struct {
	DatabaseName string         `json:"databaseName"`
	Host         string         `json:"host"`
	Port         string         `json:"port"`
	User         string         `json:"user"`
	RecordCounts map[string]int `json:"recordCounts"`
}

type ExportInput struct {
	SimulationID      string
	Scenario          *domain.Scenario
	WorkEvents        []simulation.WorkEventLog
	LineageLogs       []simulation.WorkLineageLog
	StationStatusLogs []simulation.StationStatusLog
}

type Exporter struct {
	config      ExportConfig
	adminDB     *sql.DB
	targetDB    *sql.DB
	dbName      string
	locationMap map[string]int64
}

func NewExporter(config ExportConfig) *Exporter {
	return &Exporter{
		config:      config,
		locationMap: make(map[string]int64),
	}
}

func (e *Exporter) Export(input ExportInput) (*ExportResult, error) {
	simIDShort := input.SimulationID
	if len(simIDShort) > 8 {
		simIDShort = simIDShort[:8]
	}
	e.dbName = "wdh_" + strings.ToLower(simIDShort)

	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=factory_simulation sslmode=disable",
		e.config.Host, e.config.Port, e.config.User, e.config.Password)
	var err error
	e.adminDB, err = sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to admin DB: %w", err)
	}
	defer e.adminDB.Close()

	if err := e.createDatabase(); err != nil {
		return nil, err
	}

	targetConnStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		e.config.Host, e.config.Port, e.config.User, e.config.Password, e.dbName)
	e.targetDB, err = sql.Open("postgres", targetConnStr)
	if err != nil {
		e.cleanup()
		return nil, fmt.Errorf("failed to connect to target DB: %w", err)
	}
	defer e.targetDB.Close()

	if err := CreateSchema(e.targetDB); err != nil {
		e.cleanup()
		return nil, fmt.Errorf("failed to create schema: %w", err)
	}

	result := &ExportResult{
		DatabaseName: e.dbName,
		Host:         e.config.Host,
		Port:         e.config.Port,
		User:         e.config.User,
		RecordCounts: make(map[string]int),
	}

	n, err := e.exportLocationMaster(input.Scenario)
	if err != nil {
		e.cleanup()
		return nil, fmt.Errorf("failed to export location_master: %w", err)
	}
	result.RecordCounts["location_master"] = n

	n, err = e.exportConnectionMaster(input.Scenario)
	if err != nil {
		e.cleanup()
		return nil, fmt.Errorf("failed to export connection_master: %w", err)
	}
	result.RecordCounts["connection_master"] = n

	n, err = e.exportMachineMaster(input.Scenario)
	if err != nil {
		e.cleanup()
		return nil, fmt.Errorf("failed to export machine_master: %w", err)
	}
	result.RecordCounts["machine_master"] = n

	n, err = e.exportItemMaster(input.WorkEvents)
	if err != nil {
		e.cleanup()
		return nil, fmt.Errorf("failed to export item_master: %w", err)
	}
	result.RecordCounts["item_master"] = n

	n, err = e.exportItemMovement(input.WorkEvents)
	if err != nil {
		e.cleanup()
		return nil, fmt.Errorf("failed to export item_movement: %w", err)
	}
	result.RecordCounts["item_movement"] = n

	n, err = e.exportItemLineage(input.LineageLogs)
	if err != nil {
		e.cleanup()
		return nil, fmt.Errorf("failed to export item_lineage: %w", err)
	}
	result.RecordCounts["item_lineage"] = n

	n, err = e.exportItemStatus(input.WorkEvents)
	if err != nil {
		e.cleanup()
		return nil, fmt.Errorf("failed to export item_status: %w", err)
	}
	result.RecordCounts["item_status"] = n

	n, err = e.exportMachineSignal(input.StationStatusLogs)
	if err != nil {
		e.cleanup()
		return nil, fmt.Errorf("failed to export machine_signal: %w", err)
	}
	result.RecordCounts["machine_signal"] = n

	log.Printf("[WDH Export] Completed: db=%s records=%v", e.dbName, result.RecordCounts)
	return result, nil
}

func (e *Exporter) createDatabase() error {
	e.adminDB.Exec(fmt.Sprintf(
		`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()`,
		e.dbName))

	_, err := e.adminDB.Exec(fmt.Sprintf(`DROP DATABASE IF EXISTS "%s"`, e.dbName))
	if err != nil {
		return fmt.Errorf("failed to drop existing DB: %w", err)
	}

	_, err = e.adminDB.Exec(fmt.Sprintf(`CREATE DATABASE "%s"`, e.dbName))
	if err != nil {
		return fmt.Errorf("failed to create DB: %w", err)
	}

	log.Printf("[WDH Export] Created database: %s", e.dbName)
	return nil
}

func (e *Exporter) cleanup() {
	if e.targetDB != nil {
		e.targetDB.Close()
		e.targetDB = nil
	}
	if e.adminDB != nil {
		e.adminDB.Exec(fmt.Sprintf(
			`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()`,
			e.dbName))
		e.adminDB.Exec(fmt.Sprintf(`DROP DATABASE IF EXISTS "%s"`, e.dbName))
	}
}

func (e *Exporter) simTimeToTimestamp(simTime float64) time.Time {
	return e.config.BaseTime.Add(time.Duration(simTime * float64(time.Second)))
}
