// Development-only routes for testing
// These routes should only be available in development mode

const express = require('express');
const router = express.Router();
const customerPatientMapService = require('../services/customerPatientMapService');

// Middleware to ensure this only works in development
const devOnly = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'This endpoint is only available in development mode' });
  }
  next();
};

// Clear customer-patient mapping for testing
router.delete('/clear-mapping/:email', devOnly, async (req, res) => {
  try {
    const { email } = req.params;
    const result = await customerPatientMapService.deleteByShopifyIdOrEmail(null, email);
    res.json({
      success: true,
      message: `Cleared ${result.deleted} mapping(s) for ${email}`,
      deleted: result.deleted
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get mapping info for debugging
router.get('/mapping/:email', devOnly, async (req, res) => {
  try {
    const { email } = req.params;
    const mapping = await customerPatientMapService.getByShopifyIdOrEmail(null, email);
    res.json({
      success: true,
      mapping: mapping || null,
      exists: !!mapping
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

