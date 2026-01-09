// backend/src/routes/tebraProvider.js
const express = require('express');
const router = express.Router();
const tebraProviderController = require('../controllers/tebraProviderController');
const { auth } = require('../middleware/shopifyTokenAuth');

// Get providers
router.post('/get', auth, tebraProviderController.getProviders);

module.exports = router;
