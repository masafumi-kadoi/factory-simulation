-- Add SimDB configuration to scenarios, location_id to stations, and execution_configs table

-- Add created_at to simulation_runs if not exists (missing from initial migration)
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Add SimDB connection info to scenarios table
ALTER TABLE scenarios ADD COLUMN simdb_host VARCHAR(255);
ALTER TABLE scenarios ADD COLUMN simdb_port INTEGER DEFAULT 5432;
ALTER TABLE scenarios ADD COLUMN simdb_database VARCHAR(255);
ALTER TABLE scenarios ADD COLUMN simdb_user VARCHAR(255);
ALTER TABLE scenarios ADD COLUMN simdb_password VARCHAR(255);

-- Add location_id to scenario_stations table
ALTER TABLE scenario_stations ADD COLUMN location_id BIGINT;

-- Table: execution_configs (sim-executor execution history)
CREATE TABLE execution_configs (
    id VARCHAR(36) PRIMARY KEY,
    scenario_id VARCHAR(255) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_condition_type VARCHAR(20) NOT NULL,
    end_condition_value VARCHAR(50) NOT NULL,
    initial_conditions JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    simulation_id VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for execution_configs
CREATE INDEX idx_execution_configs_scenario ON execution_configs(scenario_id);
CREATE INDEX idx_execution_configs_status ON execution_configs(status);
CREATE INDEX idx_execution_configs_created ON execution_configs(created_at DESC);
