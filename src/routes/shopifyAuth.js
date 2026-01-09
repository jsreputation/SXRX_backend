// backend/src/routes/shopifyAuth.js
const express = require('express');
const router = express.Router();
const shopifyAuthController = require('../controllers/shopifyAuthController');
const { auth } = require('../middleware/shopifyAuth');

// Authentication routes
router.post('/login', shopifyAuthController.shopifyLogin);
router.post('/logout', auth, shopifyAuthController.shopifyLogout);

// User profile routes
router.get('/me', auth, shopifyAuthController.getCurrentUser);
router.put('/profile', auth, shopifyAuthController.updateUserProfile);
router.put('/change-password', auth, shopifyAuthController.changePassword);

module.exports = router;
