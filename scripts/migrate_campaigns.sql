-- Campaign System Database Schema
-- Run this migration to create the campaign tables

-- 1. Campaigns Table (Header)
CREATE TABLE IF NOT EXISTS campaigns (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE,
    device_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('single', 'sequential')),
    status VARCHAR(20) DEFAULT 'draft' 
        CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled')),
    
    -- Scheduling
    scheduled_at TIMESTAMPTZ,
    operating_hours_start TIME DEFAULT '09:00',
    operating_hours_end TIME DEFAULT '21:00',
    operating_days INTEGER[] DEFAULT '{0,1,2,3,4,5,6}', -- 0=Sunday, 6=Saturday
    timezone VARCHAR(50) DEFAULT 'Africa/Cairo',
    
    -- Anti-ban settings
    trust_level INTEGER DEFAULT 1,
    min_delay_seconds INTEGER DEFAULT 15,
    max_delay_seconds INTEGER DEFAULT 45,
    daily_limit INTEGER DEFAULT 300,
    
    -- Progress tracking
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    read_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- 2. Campaign Steps (For Sequential Campaigns - max 5 steps)
CREATE TABLE IF NOT EXISTS campaign_steps (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL CHECK (step_order BETWEEN 1 AND 5),
    
    -- Message content
    message_type VARCHAR(20) NOT NULL 
        CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document')),
    content TEXT,
    media_url TEXT,
    filename VARCHAR(255),
    
    -- Delay after previous step (in seconds)
    delay_seconds INTEGER DEFAULT 0,
    
    -- Options
    use_spintax BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(campaign_id, step_order)
);

-- 3. Campaign Enrollments (State Machine per Recipient)
CREATE TABLE IF NOT EXISTS campaign_enrollments (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    
    -- Recipient info
    recipient VARCHAR(50) NOT NULL,
    recipient_name VARCHAR(255),
    attributes JSONB DEFAULT '{}',
    
    -- State tracking
    current_step INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'completed', 'paused', 'failed', 'opted_out')),
    
    -- pg-boss job reference (for cancellation)
    current_job_id VARCHAR(255),
    
    -- Timestamps
    next_execution_at TIMESTAMPTZ,
    last_execution_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Delivery tracking per step: {"1": {"status": "delivered", "ack": 3}, ...}
    step_statuses JSONB DEFAULT '{}',
    
    UNIQUE(campaign_id, recipient)
);

-- 4. Campaign Message Log (Detailed per-message tracking)
CREATE TABLE IF NOT EXISTS campaign_message_log (
    id SERIAL PRIMARY KEY,
    enrollment_id INTEGER REFERENCES campaign_enrollments(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    
    -- Message status
    status VARCHAR(20) DEFAULT 'queued'
        CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed')),
    whatsapp_message_id VARCHAR(255),
    ack_level INTEGER,
    error_message TEXT,
    
    -- Resolved content (after spintax/variables)
    resolved_content TEXT,
    
    -- Timestamps
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_device_status ON campaigns(device_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_enrollments_campaign_status ON campaign_enrollments(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollments_next_exec ON campaign_enrollments(next_execution_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_enrollments_recipient ON campaign_enrollments(recipient);
CREATE INDEX IF NOT EXISTS idx_message_log_enrollment ON campaign_message_log(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_message_log_whatsapp_id ON campaign_message_log(whatsapp_message_id);

-- Update trigger for campaigns.updated_at
CREATE OR REPLACE FUNCTION update_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_campaigns_updated_at ON campaigns;
CREATE TRIGGER trigger_campaigns_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_campaigns_updated_at();

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Campaign tables created successfully!';
END $$;
