// backend/src/routes/stripeWebhook.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/stripeWebhookController');

// Stripe requires raw body for signature verification
router.post('/stripe', express.raw({ type: 'application/json' }), controller.handleStripe);

module.exports = router;
