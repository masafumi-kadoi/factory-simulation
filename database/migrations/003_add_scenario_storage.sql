-- Add tables to persist scenario data

-- Table: scenarios
CREATE TABLE scenarios (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: scenario_stations
CREATE TABLE scenario_stations (
    id SERIAL PRIMARY KEY,
    scenario_id VARCHAR(255) NOT NULL,
    station_id VARCHAR(255) NOT NULL,
    station_type VARCHAR(50) NOT NULL,
    parent_id VARCHAR(255),
    config JSONB NOT NULL,
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);

-- Table: scenario_connections
CREATE TABLE scenario_connections (
    id SERIAL PRIMARY KEY,
    scenario_id VARCHAR(255) NOT NULL,
    from_station VARCHAR(255) NOT NULL,
    to_station VARCHAR(255) NOT NULL,
    condition VARCHAR(50) NOT NULL DEFAULT 'default',
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);

-- Indexes for faster queries
CREATE INDEX idx_scenario_stations_scenario ON scenario_stations(scenario_id);
CREATE INDEX idx_scenario_connections_scenario ON scenario_connections(scenario_id);

-- Note: Foreign key constraint from simulation_runs to scenarios is not added
-- to allow existing simulation data without scenarios in the database
