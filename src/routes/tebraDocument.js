// backend/src/routes/tebraDocument.js
const express = require('express');
const router = express.Router();
const tebraDocumentController = require('../controllers/tebraDocumentController');
const { auth } = require('../middleware/shopifyTokenAuth');

/**
 * @swagger
 * /api/tebra-document/create:
 *   post:
 *     summary: Create a document in Tebra
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - patientId
 *               - name
 *             properties:
 *               patientId:
 *                 type: string
 *               name:
 *                 type: string
 *               fileName:
 *                 type: string
 *               fileContent:
 *                 type: string
 *                 format: base64
 *               documentDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Document created successfully
 *       500:
 *         description: Failed to create document
 */
// Create document
router.post('/create', auth, tebraDocumentController.createDocument);

/**
 * @swagger
 * /api/tebra-document/list:
 *   get:
 *     summary: List documents for a patient
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: patientId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Documents list retrieved successfully
 *       500:
 *         description: Failed to list documents
 */
// List documents for a patient
router.get('/list', auth, tebraDocumentController.listDocuments);

/**
 * @swagger
 * /api/tebra-document/{documentId}/download:
 *   get:
 *     summary: Download a document by ID
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document downloaded successfully
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Document not found
 *       500:
 *         description: Failed to download document
 */
// Download a document by id
router.get('/:documentId/download', auth, tebraDocumentController.downloadDocument);

/**
 * @swagger
 * /api/tebra-document/{documentId}:
 *   delete:
 *     summary: Delete a document
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document deleted successfully
 *       500:
 *         description: Failed to delete document
 */
// Delete document
router.delete('/:documentId', auth, tebraDocumentController.deleteDocument);

module.exports = router;
