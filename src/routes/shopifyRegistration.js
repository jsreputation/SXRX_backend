// backend/src/routes/shopifyRegistration.js
const express = require('express');
const router = express.Router();
const shopifyRegistrationController = require('../controllers/shopifyRegistrationController');
const { auth } = require('../middleware/shopifyAuth');

// Shopify user registration endpoint
router.post('/register', shopifyRegistrationController.shopifyRegister);

// Get Shopify customer data (requires authentication)
router.get('/customer/:email', auth, shopifyRegistrationController.getShopifyCustomer);

// Health check for Shopify integration
router.get('/health', shopifyRegistrationController.shopifyHealthCheck);

module.exports = router;
