// backend/src/routes/tebraDocument.js
const express = require('express');
const router = express.Router();
const tebraDocumentController = require('../controllers/tebraDocumentController');
const { auth } = require('../middleware/shopifyTokenAuth');

// Create document
router.post('/create', auth, tebraDocumentController.createDocument);

// List documents for a patient
router.get('/list', auth, tebraDocumentController.listDocuments);

// Download a document by id
router.get('/:documentId/download', auth, tebraDocumentController.downloadDocument);

// Delete document
router.delete('/:documentId', auth, tebraDocumentController.deleteDocument);

module.exports = router;
