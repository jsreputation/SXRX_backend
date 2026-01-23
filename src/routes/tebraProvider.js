// backend/src/routes/tebraProvider.js
const express = require('express');
const router = express.Router();
const tebraProviderController = require('../controllers/tebraProviderController');
const { auth } = require('../middleware/shopifyTokenAuth');
const { cacheStrategies } = require('../middleware/cacheHeaders');

/**
 * @swagger
 * /api/tebra-provider/get:
 *   post:
 *     summary: Get list of providers
 *     tags: [Providers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               practiceId:
 *                 type: string
 *                 description: Practice ID to filter providers
 *     responses:
 *       200:
 *         description: Providers list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 providers:
 *                   type: array
 *                   items:
 *                     type: object
 *                 totalCount:
 *                   type: number
 *       500:
 *         description: Failed to get providers
 */
// Get providers
router.post('/get', auth, cacheStrategies.long(), tebraProviderController.getProviders);

module.exports = router;
