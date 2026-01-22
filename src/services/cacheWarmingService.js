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
   */
  async warmAvailabilityCache() {
    if (!cacheService.isAvailable()) return;
    
    try {
      logger.info('[CACHE_WARMING] Warming availability cache');
      
      const commonStates = ['CA', 'TX', 'WA', 'NY', 'FL'];
      const providerMapping = require('../config/providerMapping');
      
      for (const state of commonStates) {
        const mapping = providerMapping[state];
        if (mapping && mapping.practiceId) {
          try {
            const fromDate = new Date().toISOString().split('T')[0];
            const toDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            const availability = await tebraService.getAvailability({
              practiceId: mapping.practiceId,
              providerId: mapping.defaultProviderId,
              isAvailable: true,
              fromDate,
              toDate
            });
            
            const cacheKey = cacheService.generateKey('availability', {
              practiceId: mapping.practiceId,
              providerId: mapping.defaultProviderId,
              state,
              fromDate,
              toDate
            });
            
            await cacheService.set(cacheKey, availability, 300); // 5 minutes
            logger.debug('[CACHE_WARMING] Warmed availability cache', { state, practiceId: mapping.practiceId });
          } catch (error) {
            logger.warn('[CACHE_WARMING] Failed to warm availability cache for state', {
              state,
              error: error.message
            });
          }
        }
      }
      
      logger.info('[CACHE_WARMING] Availability cache warming completed');
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
