-- Migration 013: Make data_sources.scenario_id nullable and add factory_id
-- Needed for realtime monitoring sessions not tied to a specific scenario

-- Drop FK first, then alter column
ALTER TABLE data_sources DROP CONSTRAINT IF EXISTS data_sources_scenario_id_fkey;
ALTER TABLE data_sources ALTER COLUMN scenario_id DROP NOT NULL;

-- Add factory_id for factory-linked realtime sessions
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS factory_id UUID REFERENCES factories(id) ON DELETE SET NULL;

-- Add label column (friendly alias separate from friendly_name)
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS label TEXT;

-- Re-add FK as optional
ALTER TABLE data_sources ADD CONSTRAINT data_sources_scenario_id_fkey
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE SET NULL;
