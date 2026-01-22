// backend/src/routes/tebraProvider.js
const express = require('express');
const router = express.Router();
const tebraProviderController = require('../controllers/tebraProviderController');
const { auth } = require('../middleware/shopifyTokenAuth');
const { cacheStrategies } = require('../middleware/cacheHeaders');

// Get providers
router.post('/get', auth, cacheStrategies.long(), tebraProviderController.getProviders);

module.exports = router;
