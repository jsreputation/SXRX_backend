// backend/src/services/cacheWarmingService.js
// Cache warming service to pre-populate frequently accessed data

const logger = require('../utils/logger');
const cacheService = require('./cacheService');
const tebraService = require('./tebraService');
const { CACHE_TAGS } = require('./cacheInvalidationService');

/**
 * Warm up cache with frequently accessed data
 */
class CacheWarmingService {
  /**
   * Warm provider cache
   */
  async warmProviderCache() {
    if (!cacheService.isAvailable()) return;
    
    try {
      logger.info('[CACHE_WARMING] Warming provider cache');
      
      // Get all practices
      const practices = await tebraService.getPractices();
      if (practices && practices.length > 0) {
        for (const practice of practices) {
          try {
            const providers = await tebraService.getProviders(practice.id);
            const cacheKey = cacheService.generateKey('provider', { practiceId: practice.id });
            await cacheService.set(cacheKey, providers, 3600); // 1 hour
            logger.debug('[CACHE_WARMING] Warmed provider cache', { practiceId: practice.id });
          } catch (error) {
            logger.warn('[CACHE_WARMING] Failed to warm provider cache for practice', {
              practiceId: practice.id,
              error: error.message
            });
          }
        }
      }
      
      logger.info('[CACHE_WARMING] Provider cache warming completed');
    } catch (error) {
      logger.error('[CACHE_WARMING] Failed to warm provider cache', { error: error.message });
    }
  }

  /**
   * Warm availability cache for common states
   * Note: GetAvailability is not available in Tebra SOAP 2.1 API
   * This method is skipped gracefully - availability is fetched on-demand when needed
   */
  async warmAvailabilityCache() {
    if (!cacheService.isAvailable()) return;
    
    try {
      logger.info('[CACHE_WARMING] Warming availability cache');
      logger.warn('[CACHE_WARMING] GetAvailability is not available in Tebra SOAP 2.1 API - skipping availability cache warming');
      logger.info('[CACHE_WARMING] Availability will be fetched on-demand when requested');
      
      // GetAvailability is not a valid method in Tebra SOAP 2.1 API
      // Availability is fetched on-demand using GetAppointments or other methods
      // when users request appointment slots
      
      logger.info('[CACHE_WARMING] Availability cache warming completed (skipped - method not available)');
    } catch (error) {
      logger.error('[CACHE_WARMING] Failed to warm availability cache', { error: error.message });
    }
  }

  /**
   * Warm all caches
   */
  async warmAll() {
    logger.info('[CACHE_WARMING] Starting cache warming');
    
    await Promise.all([
      this.warmProviderCache(),
      this.warmAvailabilityCache()
    ]);
    
    logger.info('[CACHE_WARMING] Cache warming completed');
  }
}

// Singleton instance
const cacheWarmingService = new CacheWarmingService();

module.exports = cacheWarmingService;
