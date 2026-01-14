-- Add device_ids column for multi-profile round-robin campaigns
-- Run this migration to enable multi-profile support

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS device_ids INTEGER[] DEFAULT '{}';

-- Update existing campaigns to include their device_id in device_ids
UPDATE campaigns SET device_ids = ARRAY[device_id] WHERE device_ids = '{}' AND device_id IS NOT NULL;

COMMENT ON COLUMN campaigns.device_ids IS 'Array of device IDs for round-robin sending';
