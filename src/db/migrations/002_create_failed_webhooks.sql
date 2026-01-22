-- Migration: Create failed_webhooks table for retry mechanism
-- This table stores failed webhook attempts for retry processing

CREATE TABLE IF NOT EXISTS failed_webhooks (
  id SERIAL PRIMARY KEY,
  webhook_type VARCHAR(50) NOT NULL, -- 'shopify_order_created', 'shopify_order_paid', 'revenuehunt', etc.
  webhook_url VARCHAR(500) NOT NULL,
  payload JSONB NOT NULL,
  headers JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  error_message TEXT,
  error_stack TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'failed', 'succeeded'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_status ON failed_webhooks(status);
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_next_retry ON failed_webhooks(next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_webhook_type ON failed_webhooks(webhook_type);
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_created_at ON failed_webhooks(created_at);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_failed_webhooks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_failed_webhooks_updated_at
  BEFORE UPDATE ON failed_webhooks
  FOR EACH ROW
  EXECUTE FUNCTION update_failed_webhooks_updated_at();
