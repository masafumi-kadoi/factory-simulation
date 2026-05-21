-- PostgreSQL initialization script

-- Create database (run as postgres user)
-- CREATE DATABASE factory_simulation;

-- Connect to the database
\c factory_simulation;

-- Run migrations
\i /docker-entrypoint-initdb.d/migrations/001_init.sql
\i /docker-entrypoint-initdb.d/migrations/002_add_friendly_names.sql
\i /docker-entrypoint-initdb.d/migrations/003_add_scenario_storage.sql
\i /docker-entrypoint-initdb.d/migrations/004_add_simdb_and_executor.sql
\i /docker-entrypoint-initdb.d/migrations/005_add_signal_log_fields.sql
\i /docker-entrypoint-initdb.d/migrations/006_add_station_position.sql
\i /docker-entrypoint-initdb.d/migrations/007_add_scenario_updated_at.sql
\i /docker-entrypoint-initdb.d/migrations/008_add_station_name.sql
\i /docker-entrypoint-initdb.d/migrations/009_add_work_type_to_events.sql
\i /docker-entrypoint-initdb.d/migrations/010_add_buffer_index.sql
\i /docker-entrypoint-initdb.d/migrations/011_add_quality_status_to_work_events.sql
\i /docker-entrypoint-initdb.d/migrations/012_phase1_reconstruction.sql
\i /docker-entrypoint-initdb.d/migrations/013_datasource_factory_link.sql
\i /docker-entrypoint-initdb.d/migrations/014_recreate_simulation_tables.sql
\i /docker-entrypoint-initdb.d/migrations/015_unified_factory_schema.sql
\i /docker-entrypoint-initdb.d/migrations/016_execution_simulation_time.sql
\i /docker-entrypoint-initdb.d/migrations/017_recreate_scenarios.sql
\i /docker-entrypoint-initdb.d/migrations/018_consolidate_equipment_groups.sql
\i /docker-entrypoint-initdb.d/migrations/019_fix_orphaned_stations.sql
