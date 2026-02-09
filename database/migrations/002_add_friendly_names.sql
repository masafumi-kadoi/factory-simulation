-- Add friendly name columns to support user-friendly display names

-- Add friendly_name to simulation_runs table
ALTER TABLE simulation_runs ADD COLUMN friendly_name VARCHAR(255);

-- Add work_friendly_name to work_events table
ALTER TABLE work_events ADD COLUMN work_friendly_name VARCHAR(100);

-- Add friendly name columns to work_lineage table
ALTER TABLE work_lineage ADD COLUMN child_work_friendly_name VARCHAR(100);
ALTER TABLE work_lineage ADD COLUMN parent_work_friendly_name VARCHAR(100);
