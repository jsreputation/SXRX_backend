// backend/src/routes/payments.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { auth } = require('../middleware/shopifyTokenAuth');

// Test route to verify payments router is loaded
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Payments route is working' });
});

// Create Stripe checkout session for payment
router.post('/create-checkout', auth, paymentController.createPaymentLink);

module.exports = router; 