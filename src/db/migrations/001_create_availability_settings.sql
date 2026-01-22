-- Migration: Create availability_settings table
-- This table stores availability management settings (business hours, blocked dates, etc.)

CREATE TABLE IF NOT EXISTS availability_settings (
  id SERIAL PRIMARY KEY,
  business_hours JSONB NOT NULL DEFAULT '{
    "monday": {"start": "09:00", "end": "17:00", "enabled": true},
    "tuesday": {"start": "09:00", "end": "17:00", "enabled": true},
    "wednesday": {"start": "09:00", "end": "17:00", "enabled": true},
    "thursday": {"start": "09:00", "end": "17:00", "enabled": true},
    "friday": {"start": "09:00", "end": "17:00", "enabled": true},
    "saturday": {"start": "09:00", "end": "13:00", "enabled": false},
    "sunday": {"start": "09:00", "end": "13:00", "enabled": false}
  }'::jsonb,
  blocked_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocked_time_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  advance_booking_days INTEGER NOT NULL DEFAULT 14,
  slot_duration INTEGER NOT NULL DEFAULT 30,
  buffer_time INTEGER NOT NULL DEFAULT 0,
  max_slots_per_day INTEGER,
  timezone VARCHAR(100) NOT NULL DEFAULT 'America/Los_Angeles',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_availability_settings_updated_at ON availability_settings(updated_at);

-- Insert default settings if table is empty
INSERT INTO availability_settings (id)
SELECT 1
WHERE NOT EXISTS (SELECT 1 FROM availability_settings WHERE id = 1);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_availability_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_availability_settings_updated_at
  BEFORE UPDATE ON availability_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_availability_settings_updated_at();
