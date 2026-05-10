-- WDH スキーマ初期化（simdb-test-driver 用）
-- wdh-schema-definition.md の DDL に NOTIFY トリガーを追加

CREATE TABLE location_master (
    id                 bigserial PRIMARY KEY,
    name               varchar NOT NULL,
    station_type       varchar,
    parent_location_id bigint,
    pos_x              double precision,
    pos_y              double precision,
    pos_z              double precision,
    max_capacity       bigint,
    processing_time    double precision,
    merge_count        smallint,
    split_count        smallint
);

CREATE TABLE connection_master (
    id                bigserial PRIMARY KEY,
    from_location_id  bigint NOT NULL,
    to_location_id    bigint NOT NULL,
    from_port_index   smallint,
    to_port_index     smallint,
    condition         varchar
);

CREATE TABLE machine_master (
    id          varchar(50) PRIMARY KEY,
    name        varchar(50) NOT NULL,
    location_id bigint,
    cycle_time  double precision
);

CREATE TABLE item_master (
    id        varchar PRIMARY KEY,
    item_type varchar NOT NULL
);

CREATE TABLE item_movement (
    event_time       timestamp NOT NULL,
    item_id          varchar NOT NULL,
    from_location_id bigint,
    to_location_id   bigint,
    movement_type    varchar NOT NULL,
    port_index       smallint
);

CREATE TABLE item_lineage (
    event_time     timestamp NOT NULL,
    input_item_id  varchar,
    output_item_id varchar,
    location_id    bigint NOT NULL
);

CREATE TABLE item_status (
    event_time  timestamp NOT NULL,
    item_id     varchar NOT NULL,
    location_id bigint,
    status      smallint
);

CREATE TABLE item_expiry (
    item_id                 varchar NOT NULL,
    enabled_at              timestamp NOT NULL,
    destination_location_id bigint NOT NULL,
    expires_at              timestamp NOT NULL,
    expiry_location_id      bigint NOT NULL
);

CREATE TABLE machine_signal (
    event_time  timestamp NOT NULL,
    machine_id  varchar(50) NOT NULL,
    signal_name varchar NOT NULL,
    value       boolean NOT NULL,
    old_value   boolean,
    rule_id     varchar
);

CREATE TABLE machine_status (
    event_time     timestamp NOT NULL,
    machine_id     varchar(50) NOT NULL,
    register_index smallint NOT NULL,
    bit_index      smallint NOT NULL,
    bit_value      bit(1) NOT NULL
);

CREATE TABLE system_error (
    id          bigserial PRIMARY KEY,
    db_name     varchar NOT NULL,
    table_name  varchar NOT NULL,
    record_no   bigint NOT NULL,
    details     text,
    created_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at timestamp,
    UNIQUE (db_name, table_name, record_no)
);

-- NOTIFY トリガー（Gateway の LISTEN/NOTIFY 連携用）
CREATE OR REPLACE FUNCTION notify_wdh_event() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('wdh_event', row_to_json(NEW)::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER item_movement_notify
    AFTER INSERT ON item_movement
    FOR EACH ROW EXECUTE FUNCTION notify_wdh_event();

CREATE TRIGGER machine_signal_notify
    AFTER INSERT ON machine_signal
    FOR EACH ROW EXECUTE FUNCTION notify_wdh_event();
