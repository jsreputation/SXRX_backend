-- Migration: Create email verification tokens table
-- This migration adds support for email verification after registration

CREATE TABLE IF NOT EXISTS email_verifications (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  customer_id VARCHAR(255), -- Shopify customer ID (gid://shopify/Customer/...)
  expires_at TIMESTAMP NOT NULL,
  verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);
CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token);
CREATE INDEX IF NOT EXISTS idx_email_verifications_customer_id ON email_verifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires_at ON email_verifications(expires_at);

-- Index for finding unverified tokens
CREATE INDEX IF NOT EXISTS idx_email_verifications_unverified ON email_verifications(email, verified_at) WHERE verified_at IS NULL;

-- Analyze table for query optimization
ANALYZE email_verifications;
