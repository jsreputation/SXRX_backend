// backend/src/controllers/tebraProviderController.js
const tebraService = require('../services/tebraService');

// Get providers
exports.getProviders = async (req, res) => {
  try {
    const { clientLocation } = req;

    console.log(`👨‍⚕️ [TEBRA PROVIDERS] Getting providers`);

    const result = await tebraService.getProviders();

    res.json({
      success: true,
      message: 'Providers retrieved successfully',
      providers: result.providers || [],
      totalCount: result.totalCount || 0,
      location: clientLocation
    });

  } catch (error) {
    console.error('Tebra get providers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get providers',
      error: error.message,
      location: req.clientLocation
    });
  }
};
