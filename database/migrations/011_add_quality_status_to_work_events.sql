-- Add quality_status column to work_events table
ALTER TABLE work_events ADD COLUMN IF NOT EXISTS quality_status character varying;
