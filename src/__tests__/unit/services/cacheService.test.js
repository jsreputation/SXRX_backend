// Unit tests for cacheService

const CacheService = require('../../../services/cacheService');

// Mock dependencies
jest.mock('redis');
jest.mock('../../../utils/logger');

describe('CacheService', () => {
  let mockRedisClient;
  let cacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock Redis client
    mockRedisClient = {
      get: jest.fn(),
      setEx: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
      isReady: true,
      connect: jest.fn().mockResolvedValue(true),
      quit: jest.fn().mockResolvedValue(true),
      on: jest.fn()
    };

    const redis = require('redis');
    redis.createClient = jest.fn().mockReturnValue(mockRedisClient);
    
    // Reset environment
    delete process.env.REDIS_ENABLED;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_DEFAULT_TTL;
    
    // Create new instance for each test
    cacheService = new (require('../../../services/cacheService').constructor)();
  });

  describe('isAvailable', () => {
    it('should return true when Redis is enabled and ready', () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.isReady = true;

      expect(cacheService.isAvailable()).toBe(true);
    });

    it('should return false when Redis is disabled', () => {
      cacheService.enabled = false;
      cacheService.client = mockRedisClient;

      expect(cacheService.isAvailable()).toBe(false);
    });

    it('should return false when client is not ready', () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.isReady = false;

      expect(cacheService.isAvailable()).toBe(false);
    });
  });

  describe('generateKey', () => {
    it('should generate key with prefix and params', () => {
      const key = cacheService.generateKey('availability', { providerId: '123', startDate: '2024-02-15' });
      
      expect(key).toContain('sxrx:availability:');
      expect(key).toContain('providerId');
      expect(key).toContain('startDate');
    });

    it('should include version in key when provided', () => {
      const key = cacheService.generateKey('tebra', { method: 'getPatient' }, '2');
      
      expect(key).toContain(':v2');
    });

    it('should sort params for consistent keys', () => {
      const key1 = cacheService.generateKey('test', { a: 1, b: 2 });
      const key2 = cacheService.generateKey('test', { b: 2, a: 1 });
      
      expect(key1).toBe(key2);
    });
  });

  describe('get', () => {
    it('should return cached value when available', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      const cachedValue = { data: 'test' };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedValue));

      const result = await cacheService.get('test-key');

      expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
      expect(result).toEqual(cachedValue);
    });

    it('should return null when cache is not available', async () => {
      cacheService.enabled = false;

      const result = await cacheService.get('test-key');

      expect(result).toBeNull();
      expect(mockRedisClient.get).not.toHaveBeenCalled();
    });

    it('should return null on cache miss', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.get.mockResolvedValue(null);

      const result = await cacheService.get('test-key');

      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

      const result = await cacheService.get('test-key');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set value in cache with default TTL', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      cacheService.defaultTTL = 300;
      const value = { data: 'test' };
      mockRedisClient.setEx.mockResolvedValue('OK');

      const result = await cacheService.set('test-key', value);

      expect(mockRedisClient.setEx).toHaveBeenCalledWith('test-key', 300, JSON.stringify(value));
      expect(result).toBe(true);
    });

    it('should set value with custom TTL', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      const value = { data: 'test' };
      mockRedisClient.setEx.mockResolvedValue('OK');

      const result = await cacheService.set('test-key', value, 600);

      expect(mockRedisClient.setEx).toHaveBeenCalledWith('test-key', 600, JSON.stringify(value));
      expect(result).toBe(true);
    });

    it('should return false when cache is not available', async () => {
      cacheService.enabled = false;

      const result = await cacheService.set('test-key', { data: 'test' });

      expect(result).toBe(false);
      expect(mockRedisClient.setEx).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.setEx.mockRejectedValue(new Error('Redis error'));

      const result = await cacheService.set('test-key', { data: 'test' });

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete key from cache', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.del.mockResolvedValue(1);

      const result = await cacheService.delete('test-key');

      expect(mockRedisClient.del).toHaveBeenCalledWith('test-key');
      expect(result).toBe(true);
    });

    it('should return false when cache is not available', async () => {
      cacheService.enabled = false;

      const result = await cacheService.delete('test-key');

      expect(result).toBe(false);
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.del.mockRejectedValue(new Error('Redis error'));

      const result = await cacheService.delete('test-key');

      expect(result).toBe(false);
    });
  });

  describe('deletePattern', () => {
    it('should delete all keys matching pattern', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      const matchingKeys = ['sxrx:availability:key1', 'sxrx:availability:key2'];
      mockRedisClient.keys.mockResolvedValue(matchingKeys);
      mockRedisClient.del.mockResolvedValue(2);

      const result = await cacheService.deletePattern('sxrx:availability:*');

      expect(mockRedisClient.keys).toHaveBeenCalledWith('sxrx:availability:*');
      expect(mockRedisClient.del).toHaveBeenCalledWith(matchingKeys);
      expect(result).toBe(2);
    });

    it('should return 0 when no keys match', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.keys.mockResolvedValue([]);

      const result = await cacheService.deletePattern('sxrx:availability:*');

      expect(result).toBe(0);
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should return 0 when cache is not available', async () => {
      cacheService.enabled = false;

      const result = await cacheService.deletePattern('sxrx:availability:*');

      expect(result).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.keys.mockRejectedValue(new Error('Redis error'));

      const result = await cacheService.deletePattern('sxrx:availability:*');

      expect(result).toBe(0);
    });
  });

  describe('cacheAvailability', () => {
    it('should cache availability data with availability TTL', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      cacheService.availabilityTTL = 60;
      const params = { providerId: '123', startDate: '2024-02-15' };
      const data = { availability: [] };
      mockRedisClient.setEx.mockResolvedValue('OK');

      const result = await cacheService.cacheAvailability(params, data);

      expect(result).toBe(true);
      expect(mockRedisClient.setEx).toHaveBeenCalled();
      const callArgs = mockRedisClient.setEx.mock.calls[0];
      expect(callArgs[1]).toBe(60); // TTL
    });
  });

  describe('getCachedAvailability', () => {
    it('should retrieve cached availability', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      const params = { providerId: '123' };
      const cachedData = { availability: [] };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await cacheService.getCachedAvailability(params);

      expect(result).toEqual(cachedData);
    });
  });

  describe('invalidateAvailability', () => {
    it('should invalidate all availability when no provider specified', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.keys.mockResolvedValue(['key1', 'key2']);
      mockRedisClient.del.mockResolvedValue(2);

      const result = await cacheService.invalidateAvailability('CA');

      expect(mockRedisClient.keys).toHaveBeenCalledWith('sxrx:availability:*');
      expect(result).toBe(2);
    });

    it('should invalidate specific provider availability', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.keys.mockResolvedValue(['key1']);
      mockRedisClient.del.mockResolvedValue(1);

      const result = await cacheService.invalidateAvailability('CA', 'provider-123');

      expect(mockRedisClient.keys).toHaveBeenCalled();
      expect(result).toBe(1);
    });
  });

  describe('cacheTebraResponse', () => {
    it('should cache Tebra response with tebra TTL', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      cacheService.tebraResponseTTL = 300;
      const method = 'getPatient';
      const params = { patientId: '123' };
      const data = { patient: {} };
      mockRedisClient.setEx.mockResolvedValue('OK');

      const result = await cacheService.cacheTebraResponse(method, params, data);

      expect(result).toBe(true);
      const callArgs = mockRedisClient.setEx.mock.calls[0];
      expect(callArgs[1]).toBe(300); // TTL
    });
  });

  describe('getCachedTebraResponse', () => {
    it('should retrieve cached Tebra response', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      const method = 'getPatient';
      const params = { patientId: '123' };
      const cachedData = { patient: {} };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await cacheService.getCachedTebraResponse(method, params);

      expect(result).toEqual(cachedData);
    });
  });

  describe('invalidateTebraCache', () => {
    it('should invalidate all Tebra cache when no method specified', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.keys.mockResolvedValue(['key1', 'key2']);
      mockRedisClient.del.mockResolvedValue(2);

      const result = await cacheService.invalidateTebraCache();

      expect(mockRedisClient.keys).toHaveBeenCalledWith('sxrx:tebra:*');
      expect(result).toBe(2);
    });

    it('should invalidate specific method cache', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.keys.mockResolvedValue(['key1']);
      mockRedisClient.del.mockResolvedValue(1);

      const result = await cacheService.invalidateTebraCache('getPatient');

      expect(mockRedisClient.keys).toHaveBeenCalledWith('sxrx:tebra:getPatient:*');
      expect(result).toBe(1);
    });
  });

  describe('close', () => {
    it('should close Redis connection when ready', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.isReady = true;

      await cacheService.close();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('should not close connection when not ready', async () => {
      cacheService.enabled = true;
      cacheService.client = mockRedisClient;
      mockRedisClient.isReady = false;

      await cacheService.close();

      expect(mockRedisClient.quit).not.toHaveBeenCalled();
    });
  });
});
