ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Set updated_at = created_at for existing rows
UPDATE scenarios SET updated_at = created_at WHERE updated_at IS NULL;
