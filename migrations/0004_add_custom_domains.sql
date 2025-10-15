-- Migration: Add custom domain support to apps table
-- Created: 2025-01-15

-- Add custom domain columns to apps table
ALTER TABLE apps ADD COLUMN custom_domain TEXT;
ALTER TABLE apps ADD COLUMN custom_domain_status TEXT DEFAULT 'pending';
ALTER TABLE apps ADD COLUMN custom_domain_verification_errors TEXT;
ALTER TABLE apps ADD COLUMN custom_hostname_id TEXT;
ALTER TABLE apps ADD COLUMN custom_domain_created_at INTEGER;
ALTER TABLE apps ADD COLUMN custom_domain_updated_at INTEGER;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS apps_custom_domain_idx ON apps(custom_domain);
CREATE INDEX IF NOT EXISTS apps_custom_hostname_id_idx ON apps(custom_hostname_id);
CREATE INDEX IF NOT EXISTS apps_custom_domain_status_idx ON apps(custom_domain_status);
