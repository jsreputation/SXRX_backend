// backend/src/routes/tebra.js
const express = require('express');
const router = express.Router();
const tebraController = require('../controllers/tebraController');
const { auth, authorize } = require('../middleware/shopifyTokenAuth');

// Get Tebra patients (admin only)
router.get('/patients', auth, authorize('admin'), tebraController.getTebraPatients);

// Test Tebra connection
router.post('/test-connection', auth, tebraController.testTebraConnection);

module.exports = router;