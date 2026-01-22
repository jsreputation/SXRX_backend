// Unit tests for availabilityService.js

const AvailabilityService = require('../availabilityService');
const { query } = require('../../db/pg');
const logger = require('../../utils/logger');

// Mock dependencies
jest.mock('../../db/pg');
jest.mock('../../utils/logger');

describe('AvailabilityService', () => {
  let service;

  beforeEach(() => {
    service = new AvailabilityService();
    jest.clearAllMocks();
  });

  describe('getDefaultSettings', () => {
    it('should return default settings structure', () => {
      const settings = service.getDefaultSettings();
      
      expect(settings).toHaveProperty('businessHours');
      expect(settings).toHaveProperty('blockedDates');
      expect(settings).toHaveProperty('blockedTimeSlots');
      expect(settings).toHaveProperty('advanceBookingDays', 14);
      expect(settings).toHaveProperty('slotDuration', 30);
      expect(settings).toHaveProperty('timezone', 'America/Los_Angeles');
    });

    it('should have business hours for all days', () => {
      const settings = service.getDefaultSettings();
      
      expect(settings.businessHours).toHaveProperty('monday');
      expect(settings.businessHours).toHaveProperty('tuesday');
      expect(settings.businessHours).toHaveProperty('wednesday');
      expect(settings.businessHours).toHaveProperty('thursday');
      expect(settings.businessHours).toHaveProperty('friday');
      expect(settings.businessHours).toHaveProperty('saturday');
      expect(settings.businessHours).toHaveProperty('sunday');
    });

    it('should have weekdays enabled by default', () => {
      const settings = service.getDefaultSettings();
      
      expect(settings.businessHours.monday.enabled).toBe(true);
      expect(settings.businessHours.friday.enabled).toBe(true);
    });

    it('should have weekends disabled by default', () => {
      const settings = service.getDefaultSettings();
      
      expect(settings.businessHours.saturday.enabled).toBe(false);
      expect(settings.businessHours.sunday.enabled).toBe(false);
    });
  });

  describe('loadSettings', () => {
    it('should load settings from database', async () => {
      const mockSettings = {
        business_hours: { monday: { start: '09:00', end: '17:00', enabled: true } },
        blocked_dates: [],
        blocked_time_slots: [],
        advance_booking_days: 14,
        slot_duration: 30,
        buffer_time: 0,
        max_slots_per_day: null,
        timezone: 'America/Los_Angeles'
      };

      query.mockResolvedValue({
        rows: [mockSettings]
      });

      const result = await service.loadSettings();

      expect(query).toHaveBeenCalledWith(
        'SELECT * FROM availability_settings WHERE id = 1 LIMIT 1'
      );
      expect(result).toHaveProperty('businessHours');
      expect(service.initialized).toBe(true);
    });

    it('should create default settings if database is empty', async () => {
      query.mockResolvedValue({ rows: [] });

      await service.loadSettings();

      expect(query).toHaveBeenCalledTimes(2); // SELECT then INSERT
      expect(service.settings).toBeDefined();
      expect(service.initialized).toBe(true);
    });

    it('should fallback to defaults on database error', async () => {
      query.mockRejectedValue(new Error('Database error'));

      const result = await service.loadSettings();

      expect(result).toBeDefined();
      expect(service.initialized).toBe(true);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('saveSettings', () => {
    beforeEach(async () => {
      service.settings = service.getDefaultSettings();
      service.initialized = true;
    });

    it('should save settings to database', async () => {
      query.mockResolvedValue({ rows: [] });

      await service.saveSettings();

      expect(query).toHaveBeenCalled();
      const callArgs = query.mock.calls[0][0];
      expect(callArgs).toContain('INSERT INTO availability_settings');
      expect(callArgs).toContain('ON CONFLICT');
    });

    it('should throw error if save fails', async () => {
      query.mockRejectedValue(new Error('Save failed'));

      await expect(service.saveSettings()).rejects.toThrow('Save failed');
    });

    it('should not save if settings not loaded', async () => {
      service.settings = null;

      await service.saveSettings();

      expect(query).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('getSettings', () => {
    it('should return current settings', async () => {
      query.mockResolvedValue({ rows: [] });
      await service.loadSettings();

      const settings = await service.getSettings();

      expect(settings).toBeDefined();
      expect(settings).toHaveProperty('businessHours');
    });

    it('should initialize if not already initialized', async () => {
      query.mockResolvedValue({ rows: [] });

      const settings = await service.getSettings();

      expect(service.initialized).toBe(true);
      expect(settings).toBeDefined();
    });

    it('should return a copy of settings', async () => {
      query.mockResolvedValue({ rows: [] });
      await service.loadSettings();

      const settings1 = await service.getSettings();
      const settings2 = await service.getSettings();

      expect(settings1).not.toBe(settings2); // Different objects
      expect(settings1).toEqual(settings2); // Same content
    });
  });

  describe('updateSettings', () => {
    beforeEach(async () => {
      query.mockResolvedValue({ rows: [] });
      await service.loadSettings();
    });

    it('should update settings and save to database', async () => {
      query.mockResolvedValue({ rows: [] });

      const updates = {
        advanceBookingDays: 21,
        slotDuration: 60
      };

      const result = await service.updateSettings(updates);

      expect(result.advanceBookingDays).toBe(21);
      expect(result.slotDuration).toBe(60);
      expect(query).toHaveBeenCalled(); // Should save
    });

    it('should merge updates with existing settings', async () => {
      query.mockResolvedValue({ rows: [] });

      const updates = {
        advanceBookingDays: 21
      };

      const result = await service.updateSettings(updates);

      expect(result.advanceBookingDays).toBe(21);
      expect(result.slotDuration).toBe(30); // Original value preserved
    });
  });

  describe('filterAvailability', () => {
    beforeEach(async () => {
      query.mockResolvedValue({ rows: [] });
      await service.loadSettings();
    });

    it('should return empty array for invalid input', async () => {
      const result = await service.filterAvailability(null);
      expect(result).toEqual([]);

      const result2 = await service.filterAvailability('not-an-array');
      expect(result2).toEqual([]);
    });

    it('should return empty array for empty slots', async () => {
      const result = await service.filterAvailability([]);
      expect(result).toEqual([]);
    });

    it('should filter slots outside business hours', async () => {
      const slots = [
        {
          startTime: '2024-01-15T08:00:00Z', // Before business hours
          endTime: '2024-01-15T08:30:00Z'
        },
        {
          startTime: '2024-01-15T10:00:00Z', // During business hours
          endTime: '2024-01-15T10:30:00Z'
        }
      ];

      const result = await service.filterAvailability(slots, { state: 'CA' });

      // Should filter out slots outside business hours
      expect(result.length).toBeLessThanOrEqual(slots.length);
    });

    it('should filter blocked dates', async () => {
      // Set a blocked date
      await service.updateSettings({
        blockedDates: ['2024-01-15']
      });

      const slots = [
        {
          startTime: '2024-01-15T10:00:00Z', // Blocked date
          endTime: '2024-01-15T10:30:00Z'
        },
        {
          startTime: '2024-01-16T10:00:00Z', // Not blocked
          endTime: '2024-01-16T10:30:00Z'
        }
      ];

      const result = await service.filterAvailability(slots, { state: 'CA' });

      // Should filter out blocked date
      expect(result.length).toBeLessThan(slots.length);
    });

    it('should respect advance booking window', async () => {
      await service.updateSettings({
        advanceBookingDays: 7
      });

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10); // 10 days in future

      const slots = [
        {
          startTime: futureDate.toISOString(),
          endTime: new Date(futureDate.getTime() + 30 * 60000).toISOString()
        }
      ];

      const result = await service.filterAvailability(slots, { state: 'CA' });

      // Should filter out slots beyond advance booking window
      expect(result.length).toBe(0);
    });
  });
});
