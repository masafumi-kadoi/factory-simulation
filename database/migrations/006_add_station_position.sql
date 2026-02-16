-- Add position columns for station layout persistence
ALTER TABLE scenario_stations ADD COLUMN IF NOT EXISTS position_x DOUBLE PRECISION;
ALTER TABLE scenario_stations ADD COLUMN IF NOT EXISTS position_y DOUBLE PRECISION;
