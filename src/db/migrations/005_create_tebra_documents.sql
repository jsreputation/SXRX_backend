-- Migration: Create Tebra documents table
-- This migration adds support for storing document metadata locally
-- Since Tebra SOAP 2.1 doesn't support GetDocuments/GetDocumentContent,
-- we store document metadata in our database when we create documents

CREATE TABLE IF NOT EXISTS tebra_documents (
  id SERIAL PRIMARY KEY,
  tebra_document_id VARCHAR(255) UNIQUE, -- Document ID returned from Tebra CreateDocument
  patient_id VARCHAR(255) NOT NULL,
  practice_id VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  label VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Completed',
  document_date TIMESTAMP,
  document_notes TEXT,
  file_content_base64 TEXT, -- Store base64 content for retrieval
  file_size_bytes INTEGER, -- Size of decoded content
  mime_type VARCHAR(100) DEFAULT 'application/json',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP -- Soft delete support
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_tebra_documents_patient_id ON tebra_documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_tebra_documents_tebra_document_id ON tebra_documents(tebra_document_id);
CREATE INDEX IF NOT EXISTS idx_tebra_documents_practice_id ON tebra_documents(practice_id);
CREATE INDEX IF NOT EXISTS idx_tebra_documents_label ON tebra_documents(label);
CREATE INDEX IF NOT EXISTS idx_tebra_documents_name ON tebra_documents(name);
CREATE INDEX IF NOT EXISTS idx_tebra_documents_document_date ON tebra_documents(document_date);
CREATE INDEX IF NOT EXISTS idx_tebra_documents_created_at ON tebra_documents(created_at);
CREATE INDEX IF NOT EXISTS idx_tebra_documents_not_deleted ON tebra_documents(patient_id, deleted_at) WHERE deleted_at IS NULL;

-- Analyze table for query optimization
ANALYZE tebra_documents;
