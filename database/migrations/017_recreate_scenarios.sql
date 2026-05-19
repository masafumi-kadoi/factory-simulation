-- 017: scenarios/scenario_stations/scenario_connections テーブルを再作成
-- Migration 015 で誤って削除されたが、simulation-core が依然として使用しているため再作成する

CREATE TABLE IF NOT EXISTS scenarios (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    factory_id UUID REFERENCES factories(id) ON DELETE SET NULL,
    simdb_host VARCHAR(255),
    simdb_port INTEGER DEFAULT 5432,
    simdb_database VARCHAR(255),
    simdb_user VARCHAR(255),
    simdb_password VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scenario_stations (
    id SERIAL PRIMARY KEY,
    scenario_id VARCHAR(255) NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    station_id VARCHAR(255) NOT NULL,
    station_type VARCHAR(100) NOT NULL,
    parent_id VARCHAR(255),
    config JSONB DEFAULT '{}',
    location_id BIGINT,
    position_x REAL DEFAULT 0,
    position_y REAL DEFAULT 0,
    name VARCHAR(255),
    UNIQUE(scenario_id, station_id)
);

CREATE TABLE IF NOT EXISTS scenario_connections (
    id SERIAL PRIMARY KEY,
    scenario_id VARCHAR(255) NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    from_station VARCHAR(255) NOT NULL,
    to_station VARCHAR(255) NOT NULL,
    condition VARCHAR(255) NOT NULL DEFAULT 'default',
    from_port_index INTEGER DEFAULT -1,
    to_port_index INTEGER DEFAULT -1
);

CREATE INDEX IF NOT EXISTS idx_scenario_stations_scenario ON scenario_stations(scenario_id);
CREATE INDEX IF NOT EXISTS idx_scenario_connections_scenario ON scenario_connections(scenario_id);
