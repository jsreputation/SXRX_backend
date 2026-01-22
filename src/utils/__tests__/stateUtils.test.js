// Unit tests for stateUtils.js

const {
  normalizeStateCode,
  determineState,
  determineStateSync,
  isValidState,
  regionCodeToState
} = require('../stateUtils');

describe('stateUtils', () => {
  describe('normalizeStateCode', () => {
    it('should normalize full state names to codes', () => {
      expect(normalizeStateCode('California')).toBe('CA');
      expect(normalizeStateCode('Texas')).toBe('TX');
      expect(normalizeStateCode('New York')).toBe('NY');
      expect(normalizeStateCode('Washington')).toBe('WA');
    });

    it('should handle lowercase state names', () => {
      expect(normalizeStateCode('california')).toBe('CA');
      expect(normalizeStateCode('texas')).toBe('TX');
    });

    it('should handle uppercase state codes', () => {
      expect(normalizeStateCode('CA')).toBe('CA');
      expect(normalizeStateCode('TX')).toBe('TX');
      expect(normalizeStateCode('NY')).toBe('NY');
    });

    it('should handle lowercase state codes', () => {
      expect(normalizeStateCode('ca')).toBe('CA');
      expect(normalizeStateCode('tx')).toBe('TX');
    });

    it('should handle partial matches', () => {
      expect(normalizeStateCode('Calif')).toBe('CA');
      expect(normalizeStateCode('New York State')).toBe('NY');
    });

    it('should return null for invalid states', () => {
      expect(normalizeStateCode('InvalidState')).toBeNull();
      expect(normalizeStateCode('XX')).toBe('XX'); // Returns uppercase even if invalid
    });

    it('should handle null and undefined', () => {
      expect(normalizeStateCode(null)).toBeNull();
      expect(normalizeStateCode(undefined)).toBeNull();
    });

    it('should handle non-string inputs', () => {
      expect(normalizeStateCode(123)).toBeNull();
      expect(normalizeStateCode({})).toBeNull();
    });

    it('should trim whitespace', () => {
      expect(normalizeStateCode('  CA  ')).toBe('CA');
      expect(normalizeStateCode('  California  ')).toBe('CA');
    });
  });

  describe('regionCodeToState', () => {
    it('should convert valid region codes to state codes', () => {
      expect(regionCodeToState('CA')).toBe('CA');
      expect(regionCodeToState('TX')).toBe('TX');
      expect(regionCodeToState('NY')).toBe('NY');
    });

    it('should handle lowercase region codes', () => {
      expect(regionCodeToState('ca')).toBe('CA');
      expect(regionCodeToState('tx')).toBe('TX');
    });

    it('should return null for invalid region codes', () => {
      expect(regionCodeToState('XX')).toBeNull();
      expect(regionCodeToState('ZZ')).toBeNull();
    });

    it('should return null for non-2-letter codes', () => {
      expect(regionCodeToState('C')).toBeNull();
      expect(regionCodeToState('CAL')).toBeNull();
      expect(regionCodeToState('California')).toBeNull();
    });

    it('should handle null and empty strings', () => {
      expect(regionCodeToState(null)).toBeNull();
      expect(regionCodeToState('')).toBeNull();
    });
  });

  describe('determineStateSync', () => {
    it('should extract state from payload.state', () => {
      const payload = { state: 'CA' };
      expect(determineStateSync(payload)).toBe('CA');
    });

    it('should extract state from shipping_address.provinceCode', () => {
      const payload = {
        shipping_address: { provinceCode: 'CA' }
      };
      expect(determineStateSync(payload)).toBe('CA');
    });

    it('should extract state from shipping_address.province', () => {
      const payload = {
        shipping_address: { province: 'California' }
      };
      expect(determineStateSync(payload)).toBe('CA');
    });

    it('should extract state from billing_address', () => {
      const payload = {
        billing_address: { provinceCode: 'TX' }
      };
      expect(determineStateSync(payload)).toBe('TX');
    });

    it('should extract state from patientInfo.state', () => {
      const payload = {
        patientInfo: { state: 'NY' }
      };
      expect(determineStateSync(payload)).toBe('NY');
    });

    it('should extract state from order shipping_address', () => {
      const payload = {};
      const options = {
        order: {
          shipping_address: { province_code: 'WA' }
        }
      };
      expect(determineStateSync(payload, options)).toBe('WA');
    });

    it('should prioritize earlier fields', () => {
      const payload = {
        state: 'CA',
        shipping_address: { provinceCode: 'TX' }
      };
      expect(determineStateSync(payload)).toBe('CA');
    });

    it('should return null if no state found', () => {
      const payload = {};
      expect(determineStateSync(payload)).toBeNull();
    });
  });

  describe('determineState', () => {
    it('should work synchronously like determineStateSync', async () => {
      const payload = { state: 'CA' };
      const result = await determineState(payload);
      expect(result).toBe('CA');
    });

    it('should use geolocation fallback when no state in payload', async () => {
      const payload = {};
      const options = {
        clientLocation: {
          regionCode: 'TX',
          region: 'Texas',
          country: 'US',
          isLocal: false
        }
      };
      const result = await determineState(payload, options);
      expect(result).toBe('TX');
    });

    it('should prioritize payload over geolocation', async () => {
      const payload = { state: 'CA' };
      const options = {
        clientLocation: {
          regionCode: 'TX',
          region: 'Texas',
          country: 'US',
          isLocal: false
        }
      };
      const result = await determineState(payload, options);
      expect(result).toBe('CA');
    });

    it('should use req.clientLocation if provided', async () => {
      const payload = {};
      const options = {
        req: {
          clientLocation: {
            regionCode: 'NY',
            region: 'New York',
            country: 'US',
            isLocal: false
          }
        }
      };
      const result = await determineState(payload, options);
      expect(result).toBe('NY');
    });

    it('should not use geolocation for local IPs', async () => {
      const payload = {};
      const options = {
        clientLocation: {
          regionCode: 'CA',
          region: 'California',
          country: 'US',
          isLocal: true
        }
      };
      const result = await determineState(payload, options);
      expect(result).toBeNull();
    });

    it('should fallback to region name if regionCode not available', async () => {
      const payload = {};
      const options = {
        clientLocation: {
          region: 'California',
          country: 'US',
          isLocal: false
        }
      };
      const result = await determineState(payload, options);
      expect(result).toBe('CA');
    });
  });

  describe('isValidState', () => {
    it('should validate valid state codes', () => {
      expect(isValidState('CA')).toBe(true);
      expect(isValidState('TX')).toBe(true);
      expect(isValidState('NY')).toBe(true);
    });

    it('should validate state names', () => {
      expect(isValidState('California')).toBe(true);
      expect(isValidState('Texas')).toBe(true);
    });

    it('should return false for invalid states', () => {
      expect(isValidState('XX')).toBe(false);
      expect(isValidState('InvalidState')).toBe(false);
    });

    it('should validate against allowed states list', () => {
      expect(isValidState('CA', ['CA', 'TX', 'NY'])).toBe(true);
      expect(isValidState('TX', ['CA', 'TX', 'NY'])).toBe(true);
      expect(isValidState('WA', ['CA', 'TX', 'NY'])).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isValidState(null)).toBe(false);
      expect(isValidState(undefined)).toBe(false);
    });
  });
});
