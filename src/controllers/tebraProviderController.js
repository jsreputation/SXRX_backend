// backend/src/controllers/tebraProviderController.js
const tebraService = require('../services/tebraService');

// Get providers
exports.getProviders = async (req, res) => {
  try {
    const { clientLocation } = req;
    const { practiceId } = req.body || {};

    console.log(`👨‍⚕️ [TEBRA PROVIDERS] Getting providers`);

    // Check cache for providers list
    const cacheService = require('../services/cacheService');
    const cacheKey = cacheService.generateKey('providers', { practiceId: practiceId || 'all' });
    const cachedProviders = await cacheService.get(cacheKey);
    if (cachedProviders) {
      console.log(`✅ [PROVIDERS] Returning cached providers list`);
      return res.json(cachedProviders);
    }

    const result = await tebraService.getProviders({ practiceId });

    const response = {
      success: true,
      message: 'Providers retrieved successfully',
      providers: result.providers || [],
      totalCount: result.totalCount || 0,
      location: clientLocation
    };
    
    // Cache providers list for 10 minutes (600 seconds) - providers don't change often
    await cacheService.set(cacheKey, response, 600);
    
    res.json(response);

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
