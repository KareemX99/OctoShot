-- Fix pg-boss schema for v9.0.3
-- This adds missing columns that pg-boss expects

-- Add maintained_on column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'pgboss' 
        AND table_name = 'job' 
        AND column_name = 'maintained_on'
    ) THEN
        ALTER TABLE pgboss.job ADD COLUMN maintained_on timestamp with time zone;
    END IF;
END $$;

-- Also ensure the version table exists and has correct version
-- pg-boss v9 uses a version table to track schema state
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'pgboss' 
        AND table_name = 'version'
    ) THEN
        CREATE TABLE pgboss.version (
            version text NOT NULL
        );
        INSERT INTO pgboss.version (version) VALUES ('21');
    END IF;
END $$;

-- Create index on maintained_on for better performance
CREATE INDEX IF NOT EXISTS job_maintained_on_idx ON pgboss.job (maintained_on);
