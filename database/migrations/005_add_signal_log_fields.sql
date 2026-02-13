-- Add signal change log fields to station_status_logs
ALTER TABLE station_status_logs ADD COLUMN IF NOT EXISTS signal_name VARCHAR(100) DEFAULT '';
ALTER TABLE station_status_logs ADD COLUMN IF NOT EXISTS old_value BOOLEAN DEFAULT FALSE;
ALTER TABLE station_status_logs ADD COLUMN IF NOT EXISTS rule_id VARCHAR(50) DEFAULT '';
