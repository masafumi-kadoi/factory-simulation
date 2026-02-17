-- Add buffer_index to work_events for per-buffer tracking
ALTER TABLE work_events
    ADD COLUMN IF NOT EXISTS buffer_index INT DEFAULT -1;

-- Add from_buffer_index and to_buffer_index to scenario_connections for 1:1 buffer mapping
ALTER TABLE scenario_connections
    ADD COLUMN IF NOT EXISTS from_buffer_index INT DEFAULT -1,
    ADD COLUMN IF NOT EXISTS to_buffer_index INT DEFAULT -1;
