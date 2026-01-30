// backend/src/services/tebraDocumentService.js
// Service for managing Tebra document metadata in local database
// Since Tebra SOAP 2.1 doesn't support GetDocuments/GetDocumentContent,
// we store document metadata locally when we create documents

const { query } = require('../db/pg');

/**
 * Store document metadata in local database
 * @param {Object} params
 * @param {string} params.tebraDocumentId - Document ID returned from Tebra
 * @param {string} params.patientId - Tebra patient ID
 * @param {string} params.practiceId - Practice ID
 * @param {string} params.name - Document name
 * @param {string} params.fileName - File name
 * @param {string} params.label - Document label
 * @param {string} params.status - Document status
 * @param {string} params.documentDate - Document date (ISO string)
 * @param {string} params.documentNotes - Document notes
 * @param {string} params.fileContentBase64 - Base64 encoded file content
 * @param {string} params.mimeType - MIME type
 * @returns {Promise<Object>} Stored document record
 */
async function storeDocument(params) {
  try {
    const {
      tebraDocumentId,
      patientId,
      practiceId,
      name,
      fileName,
      label,
      status = 'Completed',
      documentDate,
      documentNotes,
      fileContentBase64,
      mimeType = 'application/json'
    } = params;

    // Calculate file size
    const fileSizeBytes = fileContentBase64 
      ? Math.floor((fileContentBase64.length * 3) / 4)
      : 0;

    const result = await query(
      `INSERT INTO tebra_documents (
        tebra_document_id, patient_id, practice_id, name, file_name, 
        label, status, document_date, document_notes, 
        file_content_base64, file_size_bytes, mime_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        tebraDocumentId,
        String(patientId),
        practiceId ? String(practiceId) : null,
        name,
        fileName,
        label || null,
        status,
        documentDate ? new Date(documentDate) : new Date(),
        documentNotes || null,
        fileContentBase64 || null,
        fileSizeBytes,
        mimeType
      ]
    );

    return result.rows[0];
  } catch (error) {
    console.error('❌ [DOCUMENT SERVICE] Error storing document:', error.message);
    throw error;
  }
}

/**
 * Get documents for a patient
 * @param {Object} params
 * @param {string} params.patientId - Tebra patient ID
 * @param {string} params.label - Optional label filter
 * @param {string} params.name - Optional name filter
 * @returns {Promise<Array>} Array of document records
 */
async function getDocumentsForPatient({ patientId, label, name }) {
  try {
    let sql = `
      SELECT 
        id,
        tebra_document_id,
        patient_id,
        practice_id,
        name,
        file_name,
        label,
        status,
        document_date,
        document_notes,
        file_size_bytes,
        mime_type,
        created_at,
        updated_at
      FROM tebra_documents
      WHERE patient_id = $1 AND deleted_at IS NULL
    `;
    const params = [String(patientId)];

    if (label) {
      sql += ` AND label = $${params.length + 1}`;
      params.push(label);
    }

    if (name) {
      sql += ` AND name ILIKE $${params.length + 1}`;
      params.push(`%${name}%`);
    }

    sql += ` ORDER BY document_date DESC, created_at DESC`;

    const result = await query(sql, params);
    return result.rows;
  } catch (error) {
    // Don't log connection errors as errors - they're expected if DB is not running
    const isConnectionError = error.message && (
      error.message.includes('ECONNREFUSED') || 
      error.message.includes('connect') ||
      error.code === 'ECONNREFUSED'
    );
    if (!isConnectionError) {
      console.error('❌ [DOCUMENT SERVICE] Error getting documents:', error.message);
    }
    throw error;
  }
}

/**
 * Get document content by Tebra document ID or local ID
 * @param {string} documentId - Tebra document ID or local database ID
 * @returns {Promise<Object|null>} Document record with content
 */
async function getDocumentContent(documentId) {
  try {
    // Try to find by Tebra document ID first, then by local ID
    const result = await query(
      `SELECT 
        id,
        tebra_document_id,
        patient_id,
        practice_id,
        name,
        file_name,
        label,
        status,
        document_date,
        document_notes,
        file_content_base64,
        file_size_bytes,
        mime_type,
        created_at,
        updated_at
      FROM tebra_documents
      WHERE (tebra_document_id = $1 OR id::text = $1) AND deleted_at IS NULL
      LIMIT 1`,
      [String(documentId)]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error('❌ [DOCUMENT SERVICE] Error getting document content:', error.message);
    throw error;
  }
}

/**
 * Delete document (soft delete)
 * @param {string} documentId - Tebra document ID or local database ID
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteDocument(documentId) {
  try {
    const result = await query(
      `UPDATE tebra_documents
       SET deleted_at = NOW()
       WHERE (tebra_document_id = $1 OR id::text = $1) AND deleted_at IS NULL
       RETURNING id`,
      [String(documentId)]
    );

    return result.rows.length > 0;
  } catch (error) {
    console.error('❌ [DOCUMENT SERVICE] Error deleting document:', error.message);
    throw error;
  }
}

/**
 * Initialize the documents table (ensure it exists)
 * Note: Migration should be run via migrate.js, but this ensures table exists
 */
async function initialize() {
  try {
    // Create table if it doesn't exist
    // Suppress connection error logging - let calling code handle it gracefully
    await query(`
      CREATE TABLE IF NOT EXISTS tebra_documents (
        id SERIAL PRIMARY KEY,
        tebra_document_id VARCHAR(255) UNIQUE,
        patient_id VARCHAR(255) NOT NULL,
        practice_id VARCHAR(255),
        name VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        label VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Completed',
        document_date TIMESTAMP,
        document_notes TEXT,
        file_content_base64 TEXT,
        file_size_bytes INTEGER,
        mime_type VARCHAR(100) DEFAULT 'application/json',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      )
    `);
    
    // Create indexes if they don't exist
    await query(`
      CREATE INDEX IF NOT EXISTS idx_tebra_documents_patient_id 
      ON tebra_documents(patient_id)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_tebra_documents_tebra_document_id 
      ON tebra_documents(tebra_document_id)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_tebra_documents_not_deleted 
      ON tebra_documents(patient_id, deleted_at) 
      WHERE deleted_at IS NULL
    `);
  } catch (error) {
    // Table might already exist, that's okay
    if (!error.message.includes('already exists')) {
      // Don't log connection errors as errors - they're expected if DB is not running
      const isConnectionError = error.message && (
        error.message.includes('ECONNREFUSED') || 
        error.message.includes('connect') ||
        error.code === 'ECONNREFUSED'
      );
      if (!isConnectionError) {
        console.error('❌ [DOCUMENT SERVICE] Error initializing table:', error.message);
      }
    }
    // Re-throw so calling code knows initialization failed
    throw error;
  }
}

module.exports = {
  storeDocument,
  getDocumentsForPatient,
  getDocumentContent,
  deleteDocument,
  initialize
};
