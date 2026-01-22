// Unit tests for locationUtils.js

const {
  getFormattedLocation,
  isSameState,
  getLocationLogPrefix,
  addLocationMetadata,
  validateLocation,
  getLocationResponse
} = require('../locationUtils');

describe('locationUtils', () => {
  describe('getFormattedLocation', () => {
    it('should format location with city, region, and country', () => {
      const location = {
        city: 'San Francisco',
        region: 'CA',
        country: 'US'
      };
      
      expect(getFormattedLocation(location)).toBe('San Francisco, CA, US');
    });

    it('should format location with partial data', () => {
      const location = {
        city: 'San Francisco',
        region: 'CA'
      };
      
      expect(getFormattedLocation(location)).toBe('San Francisco, CA');
    });

    it('should return "Unknown location" for null location', () => {
      expect(getFormattedLocation(null)).toBe('Unknown location');
    });

    it('should return "Unknown location" for location with error', () => {
      const location = {
        error: 'Failed to get location'
      };
      
      expect(getFormattedLocation(location)).toBe('Unknown location');
    });

    it('should return "Unknown location" for local IP', () => {
      const location = {
        isLocal: true
      };
      
      expect(getFormattedLocation(location)).toBe('Unknown location');
    });

    it('should return "Unknown location" for empty location', () => {
      const location = {};
      
      expect(getFormattedLocation(location)).toBe('Unknown location');
    });
  });

  describe('isSameState', () => {
    it('should return true when region matches state', () => {
      const location = {
        region: 'CA'
      };
      
      expect(isSameState(location, 'CA')).toBe(true);
    });

    it('should return false when region does not match', () => {
      const location = {
        region: 'CA'
      };
      
      expect(isSameState(location, 'NY')).toBe(false);
    });

    it('should return false for null location', () => {
      expect(isSameState(null, 'CA')).toBe(false);
    });

    it('should return false for location with error', () => {
      const location = {
        error: 'Failed to get location'
      };
      
      expect(isSameState(location, 'CA')).toBe(false);
    });

    it('should return false for local IP', () => {
      const location = {
        isLocal: true
      };
      
      expect(isSameState(location, 'CA')).toBe(false);
    });
  });

  describe('getLocationLogPrefix', () => {
    it('should format log prefix with action and location', () => {
      const location = {
        city: 'San Francisco',
        region: 'CA',
        country: 'US'
      };
      
      const result = getLocationLogPrefix(location, 'LOGIN');
      expect(result).toBe('[LOGIN] from San Francisco, CA, US');
    });

    it('should handle unknown location', () => {
      const location = null;
      
      const result = getLocationLogPrefix(location, 'LOGIN');
      expect(result).toBe('[LOGIN] from Unknown location');
    });
  });

  describe('addLocationMetadata', () => {
    it('should add location metadata to data object', () => {
      const data = { userId: 123, action: 'test' };
      const location = {
        city: 'San Francisco',
        region: 'CA',
        country: 'US',
        ip: '192.168.1.1'
      };
      
      const result = addLocationMetadata(data, location);
      
      expect(result).toHaveProperty('userId', 123);
      expect(result).toHaveProperty('action', 'test');
      expect(result).toHaveProperty('createdFromLocation', 'San Francisco');
      expect(result).toHaveProperty('locationData');
      expect(result.locationData).toEqual({
        city: 'San Francisco',
        region: 'CA',
        country: 'US',
        ip: '192.168.1.1'
      });
    });

    it('should handle missing location data', () => {
      const data = { userId: 123 };
      const location = {
        city: 'San Francisco'
      };
      
      const result = addLocationMetadata(data, location);
      
      expect(result.createdFromLocation).toBe('San Francisco');
      expect(result.locationData.region).toBeUndefined();
    });

    it('should handle null location', () => {
      const data = { userId: 123 };
      
      const result = addLocationMetadata(data, null);
      
      expect(result.createdFromLocation).toBe('Unknown');
    });
  });

  describe('validateLocation', () => {
    it('should return success for valid location', () => {
      const location = {
        city: 'San Francisco',
        region: 'CA',
        country: 'US'
      };
      
      const result = validateLocation(location);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Location validated successfully');
    });

    it('should return failure for null location', () => {
      const result = validateLocation(null);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Location data not available');
    });

    it('should return failure for location with error', () => {
      const location = {
        error: 'Failed to get location'
      };
      
      const result = validateLocation(location);
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Location error');
    });

    it('should return failure for local IP', () => {
      const location = {
        isLocal: true
      };
      
      const result = validateLocation(location);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Local/private IP detected');
    });
  });

  describe('getLocationResponse', () => {
    it('should create response with location context', () => {
      const data = { result: 'success' };
      const location = {
        city: 'San Francisco',
        region: 'CA',
        country: 'US'
      };
      
      const result = getLocationResponse(data, location, 'Operation completed');
      
      expect(result).toHaveProperty('data', data);
      expect(result).toHaveProperty('location', location);
      expect(result).toHaveProperty('locationFormatted', 'San Francisco, CA, US');
      expect(result).toHaveProperty('message', 'Operation completed');
    });

    it('should generate default message if not provided', () => {
      const data = { result: 'success' };
      const location = {
        city: 'San Francisco',
        region: 'CA'
      };
      
      const result = getLocationResponse(data, location);
      
      expect(result.message).toContain('Operation completed from');
    });

    it('should handle empty message string', () => {
      const data = { result: 'success' };
      const location = {
        city: 'San Francisco'
      };
      
      const result = getLocationResponse(data, location, '');
      
      expect(result.message).toContain('Operation completed from');
    });
  });
});
