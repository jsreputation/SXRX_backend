// backend/src/controllers/tebraDocumentController.js
const tebraService = require('../services/tebraService');

// Create document
exports.createDocument = async (req, res) => {
  try {
    const { documentData } = req.body;
    const { clientLocation } = req;

    console.log(`📄 [TEBRA DOCUMENT] Creating document`, documentData.name);

    const result = await tebraService.createDocument(documentData);
    
    // Invalidate chart cache when document is created
    try {
      const cacheService = require('../services/cacheService');
      if (documentData.patientId) {
        // Invalidate specific patient's chart cache
        const chartCacheKey = cacheService.generateKey('chart', { customerId: `patient_${documentData.patientId}` });
        await cacheService.delete(chartCacheKey);
        // Also invalidate all chart caches (in case customerId mapping is used)
        await cacheService.deletePattern('sxrx:chart:*');
        console.log('✅ [DOCUMENT] Invalidated chart cache after document creation');
      }
    } catch (cacheErr) {
      console.warn('⚠️ [DOCUMENT] Failed to invalidate cache:', cacheErr?.message || cacheErr);
    }

    res.json({
      success: true,
      message: 'Document created successfully',
      documentId: result.id,
      location: clientLocation
    });

  } catch (error) {
    console.error('Tebra create document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create document',
      error: error.message,
      location: req.clientLocation
    });
  }
};

// List patient documents
exports.listDocuments = async (req, res) => {
  try {
    const { patientId } = req.query;
    const { clientLocation } = req;
    if (!patientId) {
      return res.status(400).json({ success: false, message: 'patientId is required' });
    }
    
    // Parse pagination parameters
    const { parsePaginationParams, createPaginationMeta, createPaginatedResponse } = require('../utils/pagination');
    const pagination = parsePaginationParams(req, { defaultPage: 1, defaultLimit: 20, maxLimit: 100 });
    
    const result = await tebraService.getDocuments({ patientId });
    const documents = result?.documents || [];
    const total = documents.length;
    
    // Apply pagination
    const startIndex = pagination.offset;
    const endIndex = startIndex + pagination.limit;
    const paginatedDocuments = documents.slice(startIndex, endIndex);
    
    const paginationMeta = createPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total
    });

    const response = createPaginatedResponse(
      paginatedDocuments,
      paginationMeta,
      {
        location: clientLocation
      }
    );
    
    res.json(response);
  } catch (error) {
    console.error('Tebra list documents error:', error);
    res.status(500).json({ success: false, message: 'Failed to list documents', error: error.message, location: req.clientLocation });
  }
};

// Download document
exports.downloadDocument = async (req, res) => {
  try {
    const { documentId } = req.params;
    const { clientLocation } = req;
    if (!documentId) return res.status(400).json({ success: false, message: 'documentId is required' });
    const doc = await tebraService.getDocumentContent(documentId);
    if (!doc || !doc.base64Content) {
      return res.status(404).json({ success: false, message: 'Document content not found' });
    }
    const buf = Buffer.from(doc.base64Content, 'base64');
    const fileName = doc.fileName || `document-${documentId}.pdf`;
    const mimeType = doc.mimeType || 'application/pdf';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buf.length);
    return res.send(buf);
  } catch (error) {
    console.error('Tebra download document error:', error);
    res.status(500).json({ success: false, message: 'Failed to download document', error: error.message, location: req.clientLocation });
  }
};

// Delete document
exports.deleteDocument = async (req, res) => {
  try {
    const { documentId } = req.params;
    const { clientLocation } = req;

    console.log(`🗑️ [TEBRA DOCUMENT] Deleting document ${documentId}`);

    const result = await tebraService.deleteDocument(documentId);
    
    // Invalidate chart cache when document is deleted
    try {
      const cacheService = require('../services/cacheService');
      // Invalidate all chart caches (document deletion affects any patient's chart)
      await cacheService.deletePattern('sxrx:chart:*');
      console.log('✅ [DOCUMENT] Invalidated chart cache after document deletion');
    } catch (cacheErr) {
      console.warn('⚠️ [DOCUMENT] Failed to invalidate cache:', cacheErr?.message || cacheErr);
    }

    res.json({
      success: true,
      message: 'Document deleted successfully',
      location: clientLocation
    });

  } catch (error) {
    console.error('Tebra delete document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message,
      location: req.clientLocation
    });
  }
};
