-- Phase 1: データベース再構築
-- 既存テーブル廃止 + 管理テーブル + WDHテーブル + パーティション + NOTIFYトリガー

-- ============================================================
-- Phase 1.1: 既存テーブル廃止
-- ============================================================

DROP TABLE IF EXISTS work_events CASCADE;
DROP TABLE IF EXISTS station_status_logs CASCADE;
DROP TABLE IF EXISTS work_lineage CASCADE;
DROP TABLE IF EXISTS simulation_runs CASCADE;

-- ============================================================
-- Phase 1.2: 管理テーブル作成
-- ============================================================

-- Factory（工場定義）
CREATE TABLE factories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    factory_db_host TEXT,
    factory_db_port INTEGER DEFAULT 5432,
    factory_db_name TEXT,
    factory_db_user TEXT,
    factory_db_password TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Factory内ステーション定義（マスタ）
CREATE TABLE factory_stations (
    id SERIAL PRIMARY KEY,
    factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    station_id TEXT NOT NULL,
    equipment_id TEXT NOT NULL,
    seq_number INTEGER NOT NULL,
    name TEXT,
    station_type TEXT NOT NULL,
    position_x REAL DEFAULT 0,
    position_y REAL DEFAULT 0,
    config JSONB DEFAULT '{}',
    UNIQUE(factory_id, station_id)
);

-- Factory内接続定義（マスタ）
CREATE TABLE factory_connections (
    id SERIAL PRIMARY KEY,
    factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    from_station TEXT NOT NULL,
    to_station TEXT NOT NULL,
    condition TEXT NOT NULL DEFAULT 'default',
    from_port_index INTEGER DEFAULT 0,
    to_port_index INTEGER DEFAULT 0
);

-- scenariosテーブル拡張
ALTER TABLE scenarios ADD COLUMN factory_id UUID REFERENCES factories(id);
ALTER TABLE scenarios ADD COLUMN scenario_type TEXT NOT NULL DEFAULT 'simulation'
    CHECK (scenario_type IN ('simulation', 'factory_realtime'));

-- scenario_stationsテーブル拡張
ALTER TABLE scenario_stations ADD COLUMN override_type TEXT NOT NULL DEFAULT 'add'
    CHECK (override_type IN ('add', 'modify', 'remove'));

-- データソース統合管理（simulation / realtime 両方）
CREATE TABLE data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type TEXT NOT NULL CHECK (source_type IN ('simulation', 'realtime')),
    scenario_id VARCHAR(255) NOT NULL REFERENCES scenarios(id),
    friendly_name TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- execution_configsテーブル変更: simulation_id → data_source_id
ALTER TABLE execution_configs ADD COLUMN data_source_id UUID REFERENCES data_sources(id);
ALTER TABLE execution_configs DROP COLUMN IF EXISTS simulation_id;

-- ============================================================
-- Phase 1.3: WDHテーブル作成
-- ============================================================

-- WDHマスタ: 実行時のレイアウトスナップショット
CREATE TABLE location_master (
    id BIGSERIAL PRIMARY KEY,
    data_source_id UUID NOT NULL REFERENCES data_sources(id),
    name VARCHAR NOT NULL,
    station_type VARCHAR,
    parent_location_id BIGINT,
    pos_x DOUBLE PRECISION,
    pos_y DOUBLE PRECISION,
    pos_z DOUBLE PRECISION,
    max_capacity BIGINT,
    processing_time DOUBLE PRECISION,
    merge_count SMALLINT,
    split_count SMALLINT
);

CREATE TABLE connection_master (
    id BIGSERIAL PRIMARY KEY,
    data_source_id UUID NOT NULL REFERENCES data_sources(id),
    from_location_id BIGINT NOT NULL,
    to_location_id BIGINT NOT NULL,
    from_port_index SMALLINT,
    to_port_index SMALLINT,
    condition VARCHAR
);

CREATE TABLE machine_master (
    id VARCHAR(50) NOT NULL,
    data_source_id UUID NOT NULL REFERENCES data_sources(id),
    name VARCHAR(50) NOT NULL,
    location_id BIGINT,
    cycle_time DOUBLE PRECISION,
    PRIMARY KEY (id, data_source_id)
);

CREATE TABLE item_master (
    id VARCHAR NOT NULL,
    data_source_id UUID NOT NULL REFERENCES data_sources(id),
    item_type VARCHAR NOT NULL,
    PRIMARY KEY (id, data_source_id)
);

-- WDHログ: パーティション対象
CREATE TABLE item_movement (
    event_time TIMESTAMPTZ NOT NULL,
    data_source_id UUID NOT NULL,
    item_id VARCHAR NOT NULL,
    from_location_id BIGINT,
    to_location_id BIGINT,
    movement_type VARCHAR NOT NULL,
    port_index SMALLINT
) PARTITION BY RANGE (event_time);

CREATE TABLE item_lineage (
    event_time TIMESTAMPTZ NOT NULL,
    data_source_id UUID NOT NULL,
    input_item_id VARCHAR,
    output_item_id VARCHAR,
    location_id BIGINT NOT NULL
) PARTITION BY RANGE (event_time);

CREATE TABLE item_status (
    event_time TIMESTAMPTZ NOT NULL,
    data_source_id UUID NOT NULL,
    item_id VARCHAR NOT NULL,
    location_id BIGINT,
    status SMALLINT
) PARTITION BY RANGE (event_time);

CREATE TABLE item_expiry (
    data_source_id UUID NOT NULL,
    item_id VARCHAR NOT NULL,
    enabled_at TIMESTAMPTZ NOT NULL,
    destination_location_id BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    expiry_location_id BIGINT NOT NULL
);

CREATE TABLE machine_signal (
    event_time TIMESTAMPTZ NOT NULL,
    data_source_id UUID NOT NULL,
    machine_id VARCHAR(50) NOT NULL,
    signal_name VARCHAR NOT NULL,
    value BOOLEAN NOT NULL,
    old_value BOOLEAN,
    rule_id VARCHAR
) PARTITION BY RANGE (event_time);

CREATE TABLE machine_status (
    event_time TIMESTAMPTZ NOT NULL,
    data_source_id UUID NOT NULL,
    machine_id VARCHAR(50) NOT NULL,
    register_index SMALLINT NOT NULL,
    bit_index SMALLINT NOT NULL,
    bit_value BIT(1) NOT NULL
) PARTITION BY RANGE (event_time);

CREATE TABLE system_error (
    id BIGSERIAL PRIMARY KEY,
    data_source_id UUID NOT NULL REFERENCES data_sources(id),
    db_name VARCHAR NOT NULL,
    table_name VARCHAR NOT NULL,
    record_no BIGINT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at TIMESTAMPTZ,
    UNIQUE (data_source_id, db_name, table_name, record_no)
);

-- ============================================================
-- Phase 1.4: パーティション作成（2026-05, 06, 07, 08）
-- ============================================================

CREATE TABLE item_movement_2026_05 PARTITION OF item_movement
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE item_movement_2026_06 PARTITION OF item_movement
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE item_movement_2026_07 PARTITION OF item_movement
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE item_movement_2026_08 PARTITION OF item_movement
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE item_lineage_2026_05 PARTITION OF item_lineage
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE item_lineage_2026_06 PARTITION OF item_lineage
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE item_lineage_2026_07 PARTITION OF item_lineage
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE item_lineage_2026_08 PARTITION OF item_lineage
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE item_status_2026_05 PARTITION OF item_status
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE item_status_2026_06 PARTITION OF item_status
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE item_status_2026_07 PARTITION OF item_status
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE item_status_2026_08 PARTITION OF item_status
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE machine_signal_2026_05 PARTITION OF machine_signal
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE machine_signal_2026_06 PARTITION OF machine_signal
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE machine_signal_2026_07 PARTITION OF machine_signal
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE machine_signal_2026_08 PARTITION OF machine_signal
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE machine_status_2026_05 PARTITION OF machine_status
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE machine_status_2026_06 PARTITION OF machine_status
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE machine_status_2026_07 PARTITION OF machine_status
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE machine_status_2026_08 PARTITION OF machine_status
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- DEFAULT partitions to catch any date not covered by the range partitions above
CREATE TABLE item_movement_default PARTITION OF item_movement DEFAULT;
CREATE TABLE item_lineage_default PARTITION OF item_lineage DEFAULT;
CREATE TABLE item_status_default PARTITION OF item_status DEFAULT;
CREATE TABLE machine_signal_default PARTITION OF machine_signal DEFAULT;
CREATE TABLE machine_status_default PARTITION OF machine_status DEFAULT;

-- ============================================================
-- Phase 1.4: 複合インデックス設定
-- ============================================================

CREATE INDEX ON item_movement (data_source_id, event_time);
CREATE INDEX ON item_movement (event_time);

CREATE INDEX ON item_lineage (data_source_id, event_time);
CREATE INDEX ON item_lineage (event_time);

CREATE INDEX ON item_status (data_source_id, event_time);
CREATE INDEX ON item_status (event_time);

CREATE INDEX ON machine_signal (data_source_id, event_time);
CREATE INDEX ON machine_signal (event_time);

CREATE INDEX ON machine_status (data_source_id, event_time);
CREATE INDEX ON machine_status (event_time);

CREATE INDEX ON location_master (data_source_id);
CREATE INDEX ON connection_master (data_source_id);
CREATE INDEX ON machine_master (data_source_id);
CREATE INDEX ON item_master (data_source_id);

-- ============================================================
-- Phase 1.4: NOTIFYトリガー設置
-- ============================================================

CREATE OR REPLACE FUNCTION notify_new_event() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'events_' || NEW.data_source_id::text,
        json_build_object(
            'table', TG_TABLE_NAME,
            'event_time', NEW.event_time,
            'item_id', COALESCE(NEW.item_id, ''),
            'from_location_id', NEW.from_location_id,
            'to_location_id', NEW.to_location_id,
            'movement_type', COALESCE(NEW.movement_type, ''),
            'port_index', NEW.port_index
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_signal_event() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'events_' || NEW.data_source_id::text,
        json_build_object(
            'table', TG_TABLE_NAME,
            'event_time', NEW.event_time,
            'machine_id', NEW.machine_id,
            'signal_name', NEW.signal_name,
            'value', NEW.value,
            'old_value', NEW.old_value
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER item_movement_notify
    AFTER INSERT ON item_movement
    FOR EACH ROW EXECUTE FUNCTION notify_new_event();

CREATE TRIGGER machine_signal_notify
    AFTER INSERT ON machine_signal
    FOR EACH ROW EXECUTE FUNCTION notify_signal_event();
