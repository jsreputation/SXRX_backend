// backend/src/services/cacheService.js
// Redis caching service for Tebra responses and availability data

const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.client = null;
    this.enabled = process.env.REDIS_ENABLED !== 'false'; // Default to enabled if Redis is configured
    this.defaultTTL = parseInt(process.env.REDIS_DEFAULT_TTL) || 300; // 5 minutes default
    this.availabilityTTL = parseInt(process.env.REDIS_AVAILABILITY_TTL) || 60; // 1 minute for availability (frequently changing)
    this.tebraResponseTTL = parseInt(process.env.REDIS_TEBRA_TTL) || 300; // 5 minutes for Tebra responses
    
    // Initialize Redis client if enabled
    if (this.enabled) {
      try {
        const redis = require('redis');
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        
        this.client = redis.createClient({
          url: redisUrl,
          socket: {
            reconnectStrategy: (retries) => {
              if (retries > 10) {
                logger.warn('[CACHE] Redis reconnection failed after 10 attempts, disabling cache');
                this.enabled = false;
                return new Error('Redis connection failed');
              }
              return Math.min(retries * 100, 3000);
            }
          }
        });

        this.client.on('error', (err) => {
          logger.error('[CACHE] Redis error', { error: err.message });
          // Don't disable cache on single errors, let reconnection handle it
        });

        this.client.on('connect', () => {
          logger.info('[CACHE] Redis connected');
        });

        this.client.on('ready', () => {
          logger.info('[CACHE] Redis ready');
        });

        // Connect asynchronously (don't block startup)
        this.client.connect().catch((err) => {
          logger.warn('[CACHE] Redis connection failed, caching disabled', { error: err.message });
          this.enabled = false;
        });
      } catch (error) {
        logger.warn('[CACHE] Redis not available, caching disabled', { error: error.message });
        this.enabled = false;
      }
    } else {
      logger.info('[CACHE] Redis caching disabled via REDIS_ENABLED=false');
    }
  }

  /**
   * Check if cache is available
   * @returns {boolean}
   */
  isAvailable() {
    return this.enabled && this.client && this.client.isReady;
  }

  /**
   * Generate cache key with version
   * @param {string} prefix - Key prefix (e.g., 'availability', 'tebra')
   * @param {Object} params - Parameters to include in key
   * @param {string} version - Cache version (optional)
   * @returns {string}
   */
  generateKey(prefix, params, version = null) {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}:${JSON.stringify(params[key])}`)
      .join('|');
    const versionSuffix = version ? `:v${version}` : '';
    return `sxrx:${prefix}:${sortedParams}${versionSuffix}`;
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<Object|null>}
   */
  async get(key) {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      if (value) {
        const parsed = JSON.parse(value);
        logger.debug('[CACHE] Cache hit', { key });
        return parsed;
      }
      logger.debug('[CACHE] Cache miss', { key });
      return null;
    } catch (error) {
      logger.warn('[CACHE] Get error', { error: error.message, key });
      return null;
    }
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {Object} value - Value to cache
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<boolean>}
   */
  async set(key, value, ttl = null) {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      const expiry = ttl || this.defaultTTL;
      await this.client.setEx(key, expiry, serialized);
      logger.debug('[CACHE] Cache set', { key, ttl: expiry });
      return true;
    } catch (error) {
      logger.warn('[CACHE] Set error', { error: error.message, key });
      return false;
    }
  }

  /**
   * Delete value from cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>}
   */
  async delete(key) {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await this.client.del(key);
      logger.debug('[CACHE] Cache deleted', { key });
      return true;
    } catch (error) {
      logger.warn('[CACHE] Delete error', { error: error.message, key });
      return false;
    }
  }

  /**
   * Delete all keys matching a pattern
   * @param {string} pattern - Pattern to match (e.g., 'sxrx:availability:*')
   * @returns {Promise<number>} Number of keys deleted
   */
  async deletePattern(pattern) {
    if (!this.isAvailable()) {
      return 0;
    }

    try {
      let deleted = 0;
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        deleted = keys.length;
      }
      logger.debug('[CACHE] Pattern deleted', { pattern, count: deleted });
      return deleted;
    } catch (error) {
      logger.warn('[CACHE] Delete pattern error', { error: error.message, pattern });
      return 0;
    }
  }

  /**
   * Cache Tebra availability response
   * @param {Object} params - Request parameters
   * @param {Object} data - Response data to cache
   * @returns {Promise<boolean>}
   */
  async cacheAvailability(params, data) {
    const key = this.generateKey('availability', params);
    return await this.set(key, data, this.availabilityTTL);
  }

  /**
   * Get cached Tebra availability response
   * @param {Object} params - Request parameters
   * @returns {Promise<Object|null>}
   */
  async getCachedAvailability(params) {
    const key = this.generateKey('availability', params);
    return await this.get(key);
  }

  /**
   * Invalidate availability cache for a state/provider
   * @param {string} state - State code
   * @param {string} providerId - Provider ID (optional)
   * @returns {Promise<number>} Number of keys deleted
   */
  async invalidateAvailability(state, providerId = null) {
    if (providerId) {
      // Invalidate specific provider
      const pattern = `sxrx:availability:*providerId*:${JSON.stringify(providerId)}*`;
      return await this.deletePattern(pattern);
    } else {
      // Invalidate all availability for state
      const pattern = `sxrx:availability:*`;
      return await this.deletePattern(pattern);
    }
  }

  /**
   * Cache Tebra API response
   * @param {string} method - Tebra method name (e.g., 'getAvailability', 'getPatient')
   * @param {Object} params - Request parameters
   * @param {Object} data - Response data to cache
   * @returns {Promise<boolean>}
   */
  async cacheTebraResponse(method, params, data) {
    const key = this.generateKey(`tebra:${method}`, params);
    return await this.set(key, data, this.tebraResponseTTL);
  }

  /**
   * Get cached Tebra API response
   * @param {string} method - Tebra method name
   * @param {Object} params - Request parameters
   * @returns {Promise<Object|null>}
   */
  async getCachedTebraResponse(method, params) {
    const key = this.generateKey(`tebra:${method}`, params);
    return await this.get(key);
  }

  /**
   * Invalidate Tebra cache for a method
   * @param {string} method - Tebra method name (optional, if not provided invalidates all)
   * @returns {Promise<number>} Number of keys deleted
   */
  async invalidateTebraCache(method = null) {
    if (method) {
      const pattern = `sxrx:tebra:${method}:*`;
      return await this.deletePattern(pattern);
    } else {
      const pattern = `sxrx:tebra:*`;
      return await this.deletePattern(pattern);
    }
  }

  /**
   * Close Redis connection
   * @returns {Promise<void>}
   */
  async close() {
    if (this.client && this.client.isReady) {
      await this.client.quit();
      logger.info('[CACHE] Redis connection closed');
    }
  }
}

// Export singleton instance
module.exports = new CacheService();
