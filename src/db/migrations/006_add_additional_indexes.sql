-- Migration: Add additional performance indexes
-- This migration adds indexes for frequently queried fields that may be missing

-- Additional indexes for customer_patient_map table
-- Ensure email lookups are optimized (already exists in migration 003, but ensure it's there)
CREATE INDEX IF NOT EXISTS idx_cpm_email_lookup ON customer_patient_map(email) WHERE email IS NOT NULL;

-- Additional indexes for questionnaire_completions table
-- Optimize queries that filter by email and check completion status
CREATE INDEX IF NOT EXISTS idx_qc_email_completed ON questionnaire_completions(email, completed_at DESC) WHERE completed_at IS NOT NULL;

-- Additional indexes for tebra_documents table (if not already covered in migration 005)
-- Optimize patient document lookups
CREATE INDEX IF NOT EXISTS idx_tebra_documents_patient_label ON tebra_documents(patient_id, label) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tebra_documents_patient_name ON tebra_documents(patient_id, name) WHERE deleted_at IS NULL;

-- Analyze tables to update statistics
ANALYZE customer_patient_map;
ANALYZE questionnaire_completions;
ANALYZE tebra_documents;
