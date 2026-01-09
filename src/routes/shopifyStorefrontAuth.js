// backend/src/routes/shopifyStorefrontAuth.js
const express = require('express');
const router = express.Router();
const shopifyStorefrontAuthController = require('../controllers/shopifyStorefrontAuthController');
const { auth } = require('../middleware/shopifyTokenAuth');
const { createRateLimiter } = require('../middleware/rateLimit');

// Rate limiting: tighten login/register endpoints
const authLimiter = createRateLimiter({ windowMs: 60_000, max: 5 }); // 5 per minute per IP/email

// Authentication routes
router.post('/login', authLimiter, shopifyStorefrontAuthController.login);
router.post('/register', authLimiter, shopifyStorefrontAuthController.register);
router.post('/logout', auth, shopifyStorefrontAuthController.logout);
router.get('/me', auth, shopifyStorefrontAuthController.getCurrentCustomer);

module.exports = router;
