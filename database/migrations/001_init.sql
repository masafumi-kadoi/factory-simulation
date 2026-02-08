-- Initial schema for factory simulation

-- Table: simulation_runs
CREATE TABLE simulation_runs (
    id VARCHAR(255) PRIMARY KEY,
    scenario_id VARCHAR(255) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    simulation_end_time FLOAT,
    end_reason VARCHAR(50),
    status VARCHAR(50) NOT NULL
);

-- Table: station_status_logs
CREATE TABLE station_status_logs (
    id SERIAL PRIMARY KEY,
    simulation_run_id VARCHAR(255) NOT NULL,
    station_id VARCHAR(255) NOT NULL,
    timestamp FLOAT NOT NULL,
    status_type VARCHAR(100) NOT NULL,
    value BOOLEAN NOT NULL,
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE
);

-- Index for faster queries
CREATE INDEX idx_station_status_logs_simulation ON station_status_logs(simulation_run_id);
CREATE INDEX idx_station_status_logs_timestamp ON station_status_logs(timestamp);

-- Table: work_events
CREATE TABLE work_events (
    id SERIAL PRIMARY KEY,
    simulation_run_id VARCHAR(255) NOT NULL,
    work_id VARCHAR(255) NOT NULL,
    station_id VARCHAR(255) NOT NULL,
    timestamp FLOAT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE
);

-- Index for faster queries
CREATE INDEX idx_work_events_simulation ON work_events(simulation_run_id);
CREATE INDEX idx_work_events_timestamp ON work_events(timestamp);

-- Table: work_lineage (traceability)
CREATE TABLE work_lineage (
    id SERIAL PRIMARY KEY,
    simulation_run_id VARCHAR(255) NOT NULL,
    child_work_id VARCHAR(255) NOT NULL,
    parent_work_id VARCHAR(255) NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    station_id VARCHAR(255) NOT NULL,
    timestamp FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE
);

-- Index for faster queries
CREATE INDEX idx_work_lineage_child ON work_lineage(child_work_id);
CREATE INDEX idx_work_lineage_parent ON work_lineage(parent_work_id);
CREATE INDEX idx_work_lineage_simulation ON work_lineage(simulation_run_id);
