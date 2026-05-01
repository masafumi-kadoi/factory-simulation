package wdhexport

import "database/sql"

const schemaSQL = `
CREATE TYPE action_status AS ENUM ('arrived', 'departed');

CREATE TABLE "LocationMaster" (
    id bigserial PRIMARY KEY,
    name character varying NOT NULL,
    max_capacity bigint
);

CREATE TABLE "ProcMaster" (
    id bigint NOT NULL UNIQUE,
    no character varying,
    pre_proc_id bigint,
    post_proc_id bigint,
    location_id bigint,
    traceabi_table character varying
);

CREATE TABLE "MachineMaster" (
    machine_id character varying(50) NOT NULL UNIQUE,
    machine_name character varying(50) NOT NULL,
    andonlog_table character varying NOT NULL,
    location_id bigint,
    machine_cycle_time bigint
);

CREATE TABLE "ActionInfo" (
    event_timestamp timestamp without time zone NOT NULL,
    item_id character varying NOT NULL,
    origin_location_id bigint,
    destination_location_id bigint,
    action_status action_status NOT NULL
);

CREATE TABLE "ItemIDInfo" (
    item_id character varying NOT NULL UNIQUE,
    item_type character varying NOT NULL
);

CREATE TABLE "ItemConstructionMapping" (
    event_timestamp timestamp without time zone NOT NULL,
    input_item_id character varying,
    output_item_id character varying,
    construction_mapping_location_id bigint NOT NULL
);

CREATE TABLE "ItemStatus" (
    update_timestamp timestamp without time zone NOT NULL,
    item_id character varying NOT NULL,
    location_id bigint,
    item_status smallint
);

CREATE TABLE "ExpiryTimeInfo" (
    item_id character varying NOT NULL,
    expiry_enable_timestamp timestamp without time zone NOT NULL,
    destination_location_id bigint NOT NULL,
    expiry_timestamp timestamp without time zone NOT NULL,
    expiry_destination_id bigint NOT NULL
);

CREATE TABLE "MachineStatus" (
    update_timestamp timestamp without time zone NOT NULL,
    machine_id character varying(50) NOT NULL,
    register_index smallint NOT NULL,
    bit_index smallint NOT NULL,
    bit_status bit(1) NOT NULL
);

CREATE TABLE "InvalidInputRecords" (
    id bigserial PRIMARY KEY,
    db_name character varying NOT NULL,
    table_name character varying NOT NULL,
    record_no bigint NOT NULL,
    details text,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at timestamp without time zone,
    UNIQUE (db_name, table_name, record_no)
);
`

func CreateSchema(db *sql.DB) error {
	_, err := db.Exec(schemaSQL)
	return err
}
