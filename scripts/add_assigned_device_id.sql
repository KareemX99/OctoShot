-- Add assigned_device_id to track which device handles each enrollment
ALTER TABLE campaign_enrollments ADD COLUMN IF NOT EXISTS assigned_device_id INTEGER REFERENCES clients(id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_enrollments_device ON campaign_enrollments(assigned_device_id);

-- Comment
COMMENT ON COLUMN campaign_enrollments.assigned_device_id IS 'Which device profile is assigned to send this message';
