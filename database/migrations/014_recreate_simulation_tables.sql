-- Recreate simulation result tables dropped by migration 012.
-- Migration 012 removed these tables in favour of WDH tables for Live mode,
-- but the /api/simulations endpoint (Simulation mode) still uses them.
-- Columns reflect current repository.go INSERT/SELECT statements (includes
-- columns added by migrations 005, 008, 009, 010, 011 before 012 dropped them).

CREATE TABLE IF NOT EXISTS simulation_runs (
    id VARCHAR(255) PRIMARY KEY,
    friendly_name VARCHAR(255) DEFAULT '',
    scenario_id VARCHAR(255) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    simulation_end_time FLOAT,
    end_reason VARCHAR(50),
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS station_status_logs (
    id SERIAL PRIMARY KEY,
    simulation_run_id VARCHAR(255) NOT NULL,
    station_id VARCHAR(255) NOT NULL,
    timestamp FLOAT NOT NULL,
    status_type VARCHAR(100) NOT NULL,
    value BOOLEAN NOT NULL,
    signal_name VARCHAR(100) DEFAULT '',
    old_value BOOLEAN DEFAULT FALSE,
    rule_id VARCHAR(50) DEFAULT '',
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_station_status_logs_simulation ON station_status_logs(simulation_run_id);
CREATE INDEX IF NOT EXISTS idx_station_status_logs_timestamp ON station_status_logs(timestamp);

CREATE TABLE IF NOT EXISTS work_events (
    id SERIAL PRIMARY KEY,
    simulation_run_id VARCHAR(255) NOT NULL,
    work_id VARCHAR(255) NOT NULL,
    work_friendly_name VARCHAR(255) DEFAULT '',
    station_id VARCHAR(255) NOT NULL,
    timestamp FLOAT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    work_type VARCHAR(255) DEFAULT '',
    port_index INT DEFAULT -1,
    quality_status VARCHAR(255),
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_events_simulation ON work_events(simulation_run_id);
CREATE INDEX IF NOT EXISTS idx_work_events_timestamp ON work_events(timestamp);

CREATE TABLE IF NOT EXISTS work_lineage (
    id SERIAL PRIMARY KEY,
    simulation_run_id VARCHAR(255) NOT NULL,
    child_work_id VARCHAR(255) NOT NULL,
    child_work_friendly_name VARCHAR(255) DEFAULT '',
    parent_work_id VARCHAR(255) NOT NULL,
    parent_work_friendly_name VARCHAR(255) DEFAULT '',
    operation_type VARCHAR(50) NOT NULL,
    station_id VARCHAR(255) NOT NULL,
    timestamp FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_lineage_child ON work_lineage(child_work_id);
CREATE INDEX IF NOT EXISTS idx_work_lineage_parent ON work_lineage(parent_work_id);
CREATE INDEX IF NOT EXISTS idx_work_lineage_simulation ON work_lineage(simulation_run_id);
