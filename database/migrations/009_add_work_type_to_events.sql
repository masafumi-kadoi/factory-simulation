-- Add work_type column to work_events table for buffer slot routing
ALTER TABLE work_events ADD COLUMN IF NOT EXISTS work_type VARCHAR(255) DEFAULT '';
