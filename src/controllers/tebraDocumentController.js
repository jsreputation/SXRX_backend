// backend/src/controllers/tebraDocumentController.js
const tebraService = require('../services/tebraService');

// Create document
exports.createDocument = async (req, res) => {
  try {
    const { documentData } = req.body;
    const { clientLocation } = req;

    console.log(`📄 [TEBRA DOCUMENT] Creating document`, documentData.name);

    const result = await tebraService.createDocument(documentData);

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
    const result = await tebraService.getDocuments({ patientId });
    res.json({ success: true, documents: result?.documents || [], location: clientLocation });
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
