-- Add created_at column to simulation_runs table
ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

-- Update existing records to have created_at = start_time
UPDATE simulation_runs SET created_at = start_time WHERE created_at IS NULL;
