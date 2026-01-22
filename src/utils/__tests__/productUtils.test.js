// Unit tests for productUtils.js

const {
  requiresQuestionnaire,
  isSubscriptionProduct,
  isRestrictedInState,
  getSubscriptionType,
  parseStateRestrictions
} = require('../productUtils');

describe('productUtils', () => {
  describe('requiresQuestionnaire', () => {
    it('should return true when product has requires-questionnaire tag', () => {
      const product = {
        tags: 'requires-questionnaire, other-tag'
      };
      
      expect(requiresQuestionnaire(product)).toBe(true);
    });

    it('should return true when product has requires-questionnaire metafield', () => {
      const product = {
        metafields: [
          {
            namespace: 'sxrx',
            key: 'requires_questionnaire',
            value: 'true'
          }
        ]
      };
      
      expect(requiresQuestionnaire(product)).toBe(true);
    });

    it('should return false when product has no questionnaire requirement', () => {
      const product = {
        tags: 'other-tag'
      };
      
      expect(requiresQuestionnaire(product)).toBe(false);
    });

    it('should handle case-insensitive tags', () => {
      const product = {
        tags: 'REQUIRES-QUESTIONNAIRE'
      };
      
      expect(requiresQuestionnaire(product)).toBe(true);
    });

    it('should handle products without tags or metafields', () => {
      const product = {};
      
      expect(requiresQuestionnaire(product)).toBe(false);
    });
  });

  describe('isSubscriptionProduct', () => {
    it('should return true for subscription-monthly tag', () => {
      const product = {
        tags: 'subscription-monthly'
      };
      
      expect(isSubscriptionProduct(product)).toBe(true);
    });

    it('should return true for subscription tag', () => {
      const product = {
        tags: 'subscription'
      };
      
      expect(isSubscriptionProduct(product)).toBe(true);
    });

    it('should return true for monthly subscription metafield', () => {
      const product = {
        metafields: [
          {
            namespace: 'sxrx',
            key: 'subscription_type',
            value: 'monthly'
          }
        ]
      };
      
      expect(isSubscriptionProduct(product)).toBe(true);
    });

    it('should return true for quarterly subscription metafield', () => {
      const product = {
        metafields: [
          {
            namespace: 'sxrx',
            key: 'subscription_type',
            value: 'quarterly'
          }
        ]
      };
      
      expect(isSubscriptionProduct(product)).toBe(true);
    });

    it('should return false for non-subscription products', () => {
      const product = {
        tags: 'one-time'
      };
      
      expect(isSubscriptionProduct(product)).toBe(false);
    });
  });

  describe('parseStateRestrictions', () => {
    it('should parse JSON array format', () => {
      const value = '["CA", "NY", "TX"]';
      const result = parseStateRestrictions(value);
      
      expect(result).toEqual(['CA', 'NY', 'TX']);
    });

    it('should parse comma-separated text format', () => {
      const value = 'CA, NY, TX';
      const result = parseStateRestrictions(value);
      
      expect(result).toEqual(['CA', 'NY', 'TX']);
    });

    it('should handle single value', () => {
      const value = 'CA';
      const result = parseStateRestrictions(value);
      
      expect(result).toEqual(['CA']);
    });

    it('should handle already parsed array', () => {
      const value = ['CA', 'NY'];
      const result = parseStateRestrictions(value);
      
      expect(result).toEqual(['CA', 'NY']);
    });

    it('should return empty array for null/undefined', () => {
      expect(parseStateRestrictions(null)).toEqual([]);
      expect(parseStateRestrictions(undefined)).toEqual([]);
    });

    it('should uppercase state codes', () => {
      const value = 'ca, ny, tx';
      const result = parseStateRestrictions(value);
      
      expect(result).toEqual(['CA', 'NY', 'TX']);
    });

    it('should trim whitespace', () => {
      const value = ' CA , NY , TX ';
      const result = parseStateRestrictions(value);
      
      expect(result).toEqual(['CA', 'NY', 'TX']);
    });
  });

  describe('isRestrictedInState', () => {
    it('should return true when state is in restrictions', () => {
      const product = {
        metafields: [
          {
            namespace: 'sxrx',
            key: 'state_restrictions',
            value: '["CA", "NY"]'
          }
        ]
      };
      
      expect(isRestrictedInState(product, 'CA')).toBe(true);
    });

    it('should return false when state is not in restrictions', () => {
      const product = {
        metafields: [
          {
            namespace: 'sxrx',
            key: 'state_restrictions',
            value: '["CA", "NY"]'
          }
        ]
      };
      
      expect(isRestrictedInState(product, 'TX')).toBe(false);
    });

    it('should handle case-insensitive state codes', () => {
      const product = {
        metafields: [
          {
            namespace: 'sxrx',
            key: 'state_restrictions',
            value: '["CA"]'
          }
        ]
      };
      
      expect(isRestrictedInState(product, 'ca')).toBe(true);
    });

    it('should return false for null/undefined state', () => {
      const product = {
        metafields: [
          {
            namespace: 'sxrx',
            key: 'state_restrictions',
            value: '["CA"]'
          }
        ]
      };
      
      expect(isRestrictedInState(product, null)).toBe(false);
      expect(isRestrictedInState(product, undefined)).toBe(false);
    });

    it('should handle products without restrictions', () => {
      const product = {};
      
      expect(isRestrictedInState(product, 'CA')).toBe(false);
    });
  });

  describe('getSubscriptionType', () => {
    it('should return monthly from metafield', () => {
      const product = {
        metafields: [
          {
            namespace: 'sxrx',
            key: 'subscription_type',
            value: 'monthly'
          }
        ]
      };
      
      expect(getSubscriptionType(product)).toBe('monthly');
    });

    it('should return quarterly from metafield', () => {
      const product = {
        metafields: [
          {
            namespace: 'sxrx',
            key: 'subscription_type',
            value: 'quarterly'
          }
        ]
      };
      
      expect(getSubscriptionType(product)).toBe('quarterly');
    });

    it('should return monthly from tag', () => {
      const product = {
        tags: 'subscription-monthly'
      };
      
      expect(getSubscriptionType(product)).toBe('monthly');
    });

    it('should return quarterly from tag', () => {
      const product = {
        tags: 'subscription-quarterly'
      };
      
      expect(getSubscriptionType(product)).toBe('quarterly');
    });

    it('should return null for non-subscription products', () => {
      const product = {
        tags: 'one-time'
      };
      
      expect(getSubscriptionType(product)).toBe(null);
    });

    it('should prioritize metafield over tags', () => {
      const product = {
        tags: 'subscription-monthly',
        metafields: [
          {
            namespace: 'sxrx',
            key: 'subscription_type',
            value: 'quarterly'
          }
        ]
      };
      
      expect(getSubscriptionType(product)).toBe('quarterly');
    });
  });
});
