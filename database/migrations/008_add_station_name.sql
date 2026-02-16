-- Add friendly name to stations
ALTER TABLE scenario_stations ADD COLUMN IF NOT EXISTS name VARCHAR(255) DEFAULT '';
