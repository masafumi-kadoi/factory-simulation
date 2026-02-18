-- Add port_index to work_events for per-port tracking
ALTER TABLE work_events
    ADD COLUMN IF NOT EXISTS port_index INT DEFAULT -1;

-- Add from_port_index and to_port_index to scenario_connections for 1:1 port mapping
ALTER TABLE scenario_connections
    ADD COLUMN IF NOT EXISTS from_port_index INT DEFAULT -1,
    ADD COLUMN IF NOT EXISTS to_port_index INT DEFAULT -1;
