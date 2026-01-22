// backend/src/services/cacheInvalidationService.js
// Intelligent cache invalidation with tag-based invalidation and dependency tracking

const logger = require('../utils/logger');
const cacheService = require('./cacheService');

// Cache tags for intelligent invalidation
const CACHE_TAGS = {
  APPOINTMENTS: 'appointments',
  PATIENT: 'patient',
  CHART: 'chart',
  PROVIDER: 'provider',
  AVAILABILITY: 'availability',
  USER: 'user'
};

// Cache version for schema changes
const CACHE_VERSION = process.env.CACHE_VERSION || '1.0.0';

/**
 * Tag-based cache invalidation service
 */
class CacheInvalidationService {
  constructor() {
    this.tagIndex = new Map(); // tag -> Set of cache keys
    this.dependencyGraph = new Map(); // key -> Set of dependent keys
  }

  /**
   * Tag a cache key with one or more tags
   * @param {string} key - Cache key
   * @param {string[]} tags - Tags to associate with key
   */
  tagKey(key, tags) {
    if (!cacheService.isAvailable()) return;
    
    tags.forEach(tag => {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag).add(key);
    });
    
    // Store tags with the key in Redis
    if (cacheService.isAvailable()) {
      const tagKey = `sxrx:tags:${key}`;
      cacheService.client.setEx(tagKey, 86400, JSON.stringify(tags)).catch(() => {});
    }
  }

  /**
   * Invalidate all keys with a specific tag
   * @param {string} tag - Tag to invalidate
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidateByTag(tag) {
    if (!cacheService.isAvailable()) return 0;
    
    try {
      // Get keys from in-memory index
      const keys = this.tagIndex.get(tag) || new Set();
      
      // Also get keys from Redis tag index
      const pattern = `sxrx:tags:*`;
      const tagKeys = await cacheService.client.keys(pattern);
      
      for (const tagKey of tagKeys) {
        const key = tagKey.replace('sxrx:tags:', '');
        const storedTags = await cacheService.client.get(tagKey);
        if (storedTags) {
          const tags = JSON.parse(storedTags);
          if (tags.includes(tag)) {
            keys.add(key);
          }
        }
      }
      
      // Delete all tagged keys
      let deleted = 0;
      for (const key of keys) {
        await cacheService.delete(key);
        deleted++;
      }
      
      // Clear tag index
      this.tagIndex.delete(tag);
      
      logger.info('[CACHE_INVALIDATION] Invalidated by tag', { tag, count: deleted });
      return deleted;
    } catch (error) {
      logger.error('[CACHE_INVALIDATION] Failed to invalidate by tag', { tag, error: error.message });
      return 0;
    }
  }

  /**
   * Invalidate keys by multiple tags (OR logic)
   * @param {string[]} tags - Tags to invalidate
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidateByTags(tags) {
    const allKeys = new Set();
    
    for (const tag of tags) {
      const keys = await this.getKeysByTag(tag);
      keys.forEach(key => allKeys.add(key));
    }
    
    let deleted = 0;
    for (const key of allKeys) {
      await cacheService.delete(key);
      deleted++;
    }
    
    logger.info('[CACHE_INVALIDATION] Invalidated by tags', { tags, count: deleted });
    return deleted;
  }

  /**
   * Get all keys for a tag
   * @param {string} tag - Tag name
   * @returns {Promise<Set<string>>} Set of cache keys
   */
  async getKeysByTag(tag) {
    const keys = new Set(this.tagIndex.get(tag) || []);
    
    if (cacheService.isAvailable()) {
      try {
        const pattern = `sxrx:tags:*`;
        const tagKeys = await cacheService.client.keys(pattern);
        
        for (const tagKey of tagKeys) {
          const storedTags = await cacheService.client.get(tagKey);
          if (storedTags) {
            const tags = JSON.parse(storedTags);
            if (tags.includes(tag)) {
              const key = tagKey.replace('sxrx:tags:', '');
              keys.add(key);
            }
          }
        }
      } catch (error) {
        logger.warn('[CACHE_INVALIDATION] Failed to get keys by tag from Redis', { tag, error: error.message });
      }
    }
    
    return keys;
  }

  /**
   * Add dependency relationship
   * @param {string} key - Cache key
   * @param {string} dependentKey - Key that depends on this key
   */
  addDependency(key, dependentKey) {
    if (!this.dependencyGraph.has(key)) {
      this.dependencyGraph.set(key, new Set());
    }
    this.dependencyGraph.get(key).add(dependentKey);
  }

  /**
   * Invalidate key and all dependent keys
   * @param {string} key - Cache key to invalidate
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidateWithDependencies(key) {
    const keysToInvalidate = new Set([key]);
    
    // Add dependent keys
    if (this.dependencyGraph.has(key)) {
      this.dependencyGraph.get(key).forEach(depKey => {
        keysToInvalidate.add(depKey);
      });
    }
    
    let deleted = 0;
    for (const k of keysToInvalidate) {
      await cacheService.delete(k);
      deleted++;
    }
    
    logger.info('[CACHE_INVALIDATION] Invalidated with dependencies', { key, count: deleted });
    return deleted;
  }

  /**
   * Invalidate patient-related caches
   * @param {string} patientId - Patient ID
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidatePatientCaches(patientId) {
    const tags = [CACHE_TAGS.PATIENT, CACHE_TAGS.CHART, CACHE_TAGS.APPOINTMENTS];
    const pattern = `sxrx:*:*patient*${patientId}*`;
    
    let deleted = 0;
    
    // Invalidate by pattern
    try {
      const keys = await cacheService.client.keys(pattern);
      for (const key of keys) {
        await cacheService.delete(key);
        deleted++;
      }
    } catch (error) {
      logger.warn('[CACHE_INVALIDATION] Failed to invalidate by pattern', { pattern, error: error.message });
    }
    
    // Invalidate by tags
    deleted += await this.invalidateByTags(tags);
    
    logger.info('[CACHE_INVALIDATION] Invalidated patient caches', { patientId, count: deleted });
    return deleted;
  }

  /**
   * Invalidate appointment-related caches
   * @param {string} appointmentId - Appointment ID (optional)
   * @returns {Promise<number>} Number of keys invalidated
   */
  async invalidateAppointmentCaches(appointmentId = null) {
    const tags = [CACHE_TAGS.APPOINTMENTS, CACHE_TAGS.CHART];
    
    let deleted = 0;
    
    if (appointmentId) {
      // Invalidate specific appointment
      const pattern = `sxrx:*:*appointment*${appointmentId}*`;
      try {
        const keys = await cacheService.client.keys(pattern);
        for (const key of keys) {
          await cacheService.delete(key);
          deleted++;
        }
      } catch (error) {
        logger.warn('[CACHE_INVALIDATION] Failed to invalidate appointment pattern', { error: error.message });
      }
    }
    
    // Invalidate by tags
    deleted += await this.invalidateByTags(tags);
    
    logger.info('[CACHE_INVALIDATION] Invalidated appointment caches', { appointmentId, count: deleted });
    return deleted;
  }
}

// Singleton instance
const cacheInvalidationService = new CacheInvalidationService();

module.exports = {
  cacheInvalidationService,
  CACHE_TAGS,
  CACHE_VERSION
};
