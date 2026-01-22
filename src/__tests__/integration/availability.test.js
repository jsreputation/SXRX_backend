// Integration tests for availability endpoints

const request = require('supertest');
const app = require('../helpers/testApp');

// Mock external services
jest.mock('../../services/tebraService');
jest.mock('../../services/availabilityService');
jest.mock('../../db/pg');

const tebraService = require('../../services/tebraService');
const availabilityService = require('../../services/availabilityService');

describe('GET /webhooks/availability/:state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return available slots for valid state', async () => {
    const mockSlots = [
      {
        startTime: '2024-02-15T10:00:00Z',
        endTime: '2024-02-15T10:30:00Z',
        providerId: 'provider-123'
      },
      {
        startTime: '2024-02-15T11:00:00Z',
        endTime: '2024-02-15T11:30:00Z',
        providerId: 'provider-123'
      }
    ];

    tebraService.getAvailability = jest.fn().mockResolvedValue({
      availability: mockSlots,
      totalCount: 2
    });

    availabilityService.filterAvailability = jest.fn().mockResolvedValue(mockSlots);

    const res = await request(app)
      .get('/webhooks/availability/CA')
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toBeInstanceOf(Array);
    expect(tebraService.getAvailability).toHaveBeenCalled();
    expect(availabilityService.filterAvailability).toHaveBeenCalled();
  });

  it('should return 400 for invalid state', async () => {
    const res = await request(app)
      .get('/webhooks/availability/INVALID')
      .expect(400);

    expect(res.body).toHaveProperty('success', false);
    expect(res.body.message).toContain('Unsupported state');
  });

  it('should support pagination', async () => {
    const mockSlots = Array.from({ length: 100 }, (_, i) => ({
      startTime: new Date(Date.now() + (i + 1) * 60 * 60 * 1000).toISOString(),
      endTime: new Date(Date.now() + (i + 1) * 60 * 60 * 1000 + 30 * 60000).toISOString()
    }));

    tebraService.getAvailability = jest.fn().mockResolvedValue({
      availability: mockSlots,
      totalCount: 100
    });

    availabilityService.filterAvailability = jest.fn().mockResolvedValue(mockSlots);

    const res = await request(app)
      .get('/webhooks/availability/CA?page=2&limit=20')
      .expect(200);

    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.limit).toBe(20);
    expect(res.body.data.length).toBeLessThanOrEqual(20);
  });

  it('should filter by date range', async () => {
    const fromDate = '2024-02-15';
    const toDate = '2024-02-20';

    tebraService.getAvailability = jest.fn().mockResolvedValue({
      availability: [],
      totalCount: 0
    });

    availabilityService.filterAvailability = jest.fn().mockResolvedValue([]);

    await request(app)
      .get(`/webhooks/availability/CA?fromDate=${fromDate}&toDate=${toDate}`)
      .expect(200);

    expect(tebraService.getAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        fromDate,
        toDate
      })
    );
  });

  it('should handle Tebra service errors gracefully', async () => {
    tebraService.getAvailability = jest.fn().mockRejectedValue(new Error('Tebra service unavailable'));

    const res = await request(app)
      .get('/webhooks/availability/CA')
      .expect(500);

    expect(res.body).toHaveProperty('success', false);
  });
});

describe('GET /api/availability/settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without admin API key', async () => {
    const res = await request(app)
      .get('/api/availability/settings')
      .expect(401);

    expect(res.body).toHaveProperty('success', false);
  });

  it('should return settings with valid admin API key', async () => {
    process.env.ADMIN_API_KEY = 'test-admin-key';

    const mockSettings = {
      businessHours: {
        monday: { start: '09:00', end: '17:00', enabled: true }
      },
      blockedDates: [],
      advanceBookingDays: 14
    };

    availabilityService.getSettings = jest.fn().mockResolvedValue(mockSettings);

    const res = await request(app)
      .get('/api/availability/settings')
      .set('X-Admin-API-Key', 'test-admin-key')
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('settings');
  });
});
