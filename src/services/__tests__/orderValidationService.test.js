// Unit tests for orderValidationService.js

jest.mock('../questionnaireCompletionService');
jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn()
}));

const {
  validateOrderBeforeProcessing,
  extractEmailFromOrder,
  getPropValue,
  normalizeBool
} = require('../orderValidationService');
const questionnaireCompletionService = require('../questionnaireCompletionService');

describe('orderValidationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractEmailFromOrder', () => {
    it('should extract email from order.email', async () => {
      const order = { email: 'test@example.com' };
      const result = await extractEmailFromOrder(order);
      expect(result).toBe('test@example.com');
    });

    it('should extract email from order.customer.email', async () => {
      const order = {
        customer: { email: 'customer@example.com' }
      };
      const result = await extractEmailFromOrder(order);
      expect(result).toBe('customer@example.com');
    });

    it('should extract email from billing_address.email', async () => {
      const order = {
        billing_address: { email: 'billing@example.com' }
      };
      const result = await extractEmailFromOrder(order);
      expect(result).toBe('billing@example.com');
    });

    it('should extract email from shipping_address.email', async () => {
      const order = {
        shipping_address: { email: 'shipping@example.com' }
      };
      const result = await extractEmailFromOrder(order);
      expect(result).toBe('shipping@example.com');
    });

    it('should prioritize order.email over other sources', async () => {
      const order = {
        email: 'primary@example.com',
        customer: { email: 'customer@example.com' }
      };
      const result = await extractEmailFromOrder(order);
      expect(result).toBe('primary@example.com');
    });

    it('should return null if no email found', async () => {
      const order = {};
      const result = await extractEmailFromOrder(order);
      expect(result).toBeNull();
    });
  });

  describe('normalizeBool', () => {
    it('should return true for boolean true', () => {
      expect(normalizeBool(true)).toBe(true);
    });

    it('should return false for boolean false', () => {
      expect(normalizeBool(false)).toBe(false);
    });

    it('should return true for string "true"', () => {
      expect(normalizeBool('true')).toBe(true);
      expect(normalizeBool('TRUE')).toBe(true);
      expect(normalizeBool('True')).toBe(true);
    });

    it('should return true for string "1"', () => {
      expect(normalizeBool('1')).toBe(true);
    });

    it('should return true for string "yes"', () => {
      expect(normalizeBool('yes')).toBe(true);
      expect(normalizeBool('YES')).toBe(true);
      expect(normalizeBool('Yes')).toBe(true);
    });

    it('should return true for string "y"', () => {
      expect(normalizeBool('y')).toBe(true);
      expect(normalizeBool('Y')).toBe(true);
    });

    it('should return false for other strings', () => {
      expect(normalizeBool('false')).toBe(false);
      expect(normalizeBool('no')).toBe(false);
      expect(normalizeBool('0')).toBe(false);
      expect(normalizeBool('random')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(normalizeBool(null)).toBe(false);
      expect(normalizeBool(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(normalizeBool('')).toBe(false);
      expect(normalizeBool('   ')).toBe(false);
    });
  });

  describe('getPropValue', () => {
    it('should find property in array format', () => {
      const props = [
        { name: 'Requires Questionnaire', value: 'true' },
        { name: 'Purchase Type', value: 'subscription' }
      ];
      expect(getPropValue(props, 'Requires Questionnaire')).toBe('true');
      expect(getPropValue(props, 'requires_questionnaire')).toBe('true');
    });

    it('should find property case-insensitively', () => {
      const props = [
        { name: 'Requires Questionnaire', value: 'true' }
      ];
      expect(getPropValue(props, 'REQUIRES_QUESTIONNAIRE')).toBe('true');
      expect(getPropValue(props, 'requires questionnaire')).toBe('true');
    });

    it('should find property in object format', () => {
      const props = {
        'requires_questionnaire': 'true',
        'purchase_type': 'subscription'
      };
      expect(getPropValue(props, 'requires_questionnaire')).toBe('true');
      expect(getPropValue(props, 'Requires Questionnaire')).toBe('true');
    });

    it('should try multiple key candidates', () => {
      const props = [
        { name: 'questionnaire_required', value: 'yes' }
      ];
      expect(getPropValue(props, ['requires_questionnaire', 'questionnaire_required'])).toBe('yes');
    });

    it('should return null if property not found', () => {
      const props = [
        { name: 'Other Property', value: 'value' }
      ];
      expect(getPropValue(props, 'not_found')).toBeNull();
    });

    it('should return null for null/undefined props', () => {
      expect(getPropValue(null, 'key')).toBeNull();
      expect(getPropValue(undefined, 'key')).toBeNull();
    });
  });

  describe('validateOrderBeforeProcessing', () => {
    it('should validate order with no line items', async () => {
      const order = {
        line_items: [],
        shipping_address: { province_code: 'CA' }
      };
      const result = await validateOrderBeforeProcessing(order);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate order without questionnaire requirement', async () => {
      const order = {
        email: 'test@example.com',
        line_items: [
          {
            id: 1,
            product_id: 123,
            properties: []
          }
        ],
        shipping_address: { province_code: 'CA' }
      };
      const result = await validateOrderBeforeProcessing(order);
      expect(result.valid).toBe(true);
    });

    it('should require email for questionnaire products', async () => {
      const order = {
        line_items: [
          {
            id: 1,
            product_id: 123,
            properties: [
              { name: 'requires_questionnaire', value: 'true' }
            ]
          }
        ],
        shipping_address: { province_code: 'CA' }
      };
      const result = await validateOrderBeforeProcessing(order);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('missing_email');
    });

    it('should check questionnaire completion', async () => {
      questionnaireCompletionService.getLatestCompletion.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        product_id: 123,
        red_flags_detected: false
      });

      const order = {
        email: 'test@example.com',
        line_items: [
          {
            id: 1,
            product_id: 123,
            properties: [
              { name: 'requires_questionnaire', value: 'true' }
            ]
          }
        ],
        shipping_address: { province_code: 'CA' }
      };
      const result = await validateOrderBeforeProcessing(order);
      expect(result.valid).toBe(true);
      expect(questionnaireCompletionService.getLatestCompletion).toHaveBeenCalledWith({
        email: 'test@example.com',
        productId: 123
      });
    });

    it('should error if questionnaire not completed', async () => {
      questionnaireCompletionService.getLatestCompletion.mockResolvedValue(null);

      const order = {
        email: 'test@example.com',
        line_items: [
          {
            id: 1,
            product_id: 123,
            properties: [
              { name: 'requires_questionnaire', value: 'true' }
            ]
          }
        ],
        shipping_address: { province_code: 'CA' }
      };
      const result = await validateOrderBeforeProcessing(order);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('questionnaire_not_completed');
    });

    it('should warn about red flags', async () => {
      questionnaireCompletionService.getLatestCompletion.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        product_id: 123,
        red_flags_detected: true
      });

      const order = {
        email: 'test@example.com',
        line_items: [
          {
            id: 1,
            product_id: 123,
            properties: [
              { name: 'requires_questionnaire', value: 'true' }
            ]
          }
        ],
        shipping_address: { province_code: 'CA' }
      };
      const result = await validateOrderBeforeProcessing(order);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('red_flags_detected');
    });

    it('should check state restrictions', async () => {
      const order = {
        email: 'test@example.com',
        line_items: [
          {
            id: 1,
            product_id: 123,
            properties: [
              { name: 'restricted_states', value: 'CA,TX' }
            ]
          }
        ],
        shipping_address: { province_code: 'CA' }
      };
      const result = await validateOrderBeforeProcessing(order);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('state_restriction');
    });

    it('should warn if state cannot be determined', async () => {
      const order = {
        email: 'test@example.com',
        line_items: [
          {
            id: 1,
            product_id: 123,
            properties: []
          }
        ]
      };
      const result = await validateOrderBeforeProcessing(order);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('state_not_detected');
      expect(result.state).toBe('CA'); // Default
    });

    it('should handle questionnaire check errors', async () => {
      questionnaireCompletionService.getLatestCompletion.mockRejectedValue(
        new Error('Database error')
      );

      const order = {
        email: 'test@example.com',
        line_items: [
          {
            id: 1,
            product_id: 123,
            properties: [
              { name: 'requires_questionnaire', value: 'true' }
            ]
          }
        ],
        shipping_address: { province_code: 'CA' }
      };
      const result = await validateOrderBeforeProcessing(order);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('questionnaire_check_failed');
    });

    it('should validate multiple line items', async () => {
      questionnaireCompletionService.getLatestCompletion
        .mockResolvedValueOnce({ id: 1, red_flags_detected: false })
        .mockResolvedValueOnce(null);

      const order = {
        email: 'test@example.com',
        line_items: [
          {
            id: 1,
            product_id: 123,
            properties: [
              { name: 'requires_questionnaire', value: 'true' }
            ]
          },
          {
            id: 2,
            product_id: 456,
            properties: [
              { name: 'requires_questionnaire', value: 'true' }
            ]
          }
        ],
        shipping_address: { province_code: 'CA' }
      };
      const result = await validateOrderBeforeProcessing(order);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });
});
