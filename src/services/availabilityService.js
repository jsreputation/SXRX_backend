// backend/src/services/availabilityService.js
// Service to manage and adjust appointment availability settings
// Uses PostgreSQL for persistent storage

const { query } = require('../db/pg');
const logger = require('../utils/logger');

class AvailabilityService {
  constructor() {
    this.settings = null; // Will be loaded from database
    this.initialized = false;
  }

  // Default settings (used if database is empty)
  getDefaultSettings() {
    return {
      businessHours: {
        monday: { start: '09:00', end: '17:00', enabled: true },
        tuesday: { start: '09:00', end: '17:00', enabled: true },
        wednesday: { start: '09:00', end: '17:00', enabled: true },
        thursday: { start: '09:00', end: '17:00', enabled: true },
        friday: { start: '09:00', end: '17:00', enabled: true },
        saturday: { start: '09:00', end: '13:00', enabled: false },
        sunday: { start: '09:00', end: '13:00', enabled: false }
      },
      blockedDates: [],
      blockedTimeSlots: [],
      advanceBookingDays: 14,
      slotDuration: 30,
      bufferTime: 0,
      maxSlotsPerDay: null,
      timezone: 'America/Los_Angeles'
    };
  }

  // Load settings from database
  async loadSettings() {
    try {
      const { rows } = await query(
        'SELECT * FROM availability_settings WHERE id = 1 LIMIT 1'
      );

      if (rows.length > 0) {
        const row = rows[0];
        this.settings = {
          businessHours: row.business_hours,
          blockedDates: row.blocked_dates || [],
          blockedTimeSlots: row.blocked_time_slots || [],
          advanceBookingDays: row.advance_booking_days,
          slotDuration: row.slot_duration,
          bufferTime: row.buffer_time,
          maxSlotsPerDay: row.max_slots_per_day,
          timezone: row.timezone
        };
        logger.info('[AVAILABILITY] Settings loaded from database');
      } else {
        // No settings in database, use defaults and save them
        this.settings = this.getDefaultSettings();
        await this.saveSettings();
        logger.info('[AVAILABILITY] No settings found, created default settings');
      }

      this.initialized = true;
      return this.settings;
    } catch (error) {
      logger.error('[AVAILABILITY] Failed to load settings from database:', error);
      // Fallback to in-memory defaults if database fails
      this.settings = this.getDefaultSettings();
      this.initialized = true;
      return this.settings;
    }
  }

  // Save settings to database
  async saveSettings() {
    if (!this.settings) {
      logger.warn('[AVAILABILITY] Cannot save - settings not loaded');
      return;
    }

    try {
      await query(
        `INSERT INTO availability_settings (id, business_hours, blocked_dates, blocked_time_slots, advance_booking_days, slot_duration, buffer_time, max_slots_per_day, timezone, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (id) DO UPDATE SET
           business_hours = EXCLUDED.business_hours,
           blocked_dates = EXCLUDED.blocked_dates,
           blocked_time_slots = EXCLUDED.blocked_time_slots,
           advance_booking_days = EXCLUDED.advance_booking_days,
           slot_duration = EXCLUDED.slot_duration,
           buffer_time = EXCLUDED.buffer_time,
           max_slots_per_day = EXCLUDED.max_slots_per_day,
           timezone = EXCLUDED.timezone,
           updated_at = NOW()`,
        [
          JSON.stringify(this.settings.businessHours),
          JSON.stringify(this.settings.blockedDates),
          JSON.stringify(this.settings.blockedTimeSlots),
          this.settings.advanceBookingDays,
          this.settings.slotDuration,
          this.settings.bufferTime,
          this.settings.maxSlotsPerDay,
          this.settings.timezone
        ]
      );
      logger.debug('[AVAILABILITY] Settings saved to database');
    } catch (error) {
      logger.error('[AVAILABILITY] Failed to save settings to database:', error);
      throw error;
    }
  }

  // Ensure settings are loaded
  async ensureInitialized() {
    if (!this.initialized) {
      await this.loadSettings();
    }
  }

  // Get current availability settings
  async getSettings() {
    await this.ensureInitialized();
    return { ...this.settings };
  }

  // Update availability settings
  async updateSettings(newSettings) {
    await this.ensureInitialized();
    
    this.settings = {
      ...this.settings,
      ...newSettings
    };
    
    await this.saveSettings();
    return this.settings;
  }

  // Filter Tebra availability based on business rules
  async filterAvailability(tebraSlots, options = {}) {
    await this.ensureInitialized();
    const {
      state,
      practiceId,
      providerId
    } = options;

    if (!tebraSlots || !Array.isArray(tebraSlots)) {
      return [];
    }

    const now = new Date();
    const filteredSlots = [];

    for (const slot of tebraSlots) {
      const slotStart = new Date(slot.startTime || slot.StartTime || slot.startDate);
      
      // Skip if slot is in the past
      if (slotStart.getTime() < now.getTime()) {
        continue;
      }

      // Check advance booking window
      const daysFromNow = Math.floor((slotStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysFromNow > this.settings.advanceBookingDays) {
        continue;
      }

      // Check if date is blocked
      const slotDateStr = slotStart.toISOString().split('T')[0];
      if (this.settings.blockedDates.includes(slotDateStr)) {
        continue;
      }

      // Check business hours
      // Get weekday name and convert to lowercase (monday, tuesday, etc.)
      const dayOfWeek = slotStart.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const daySettings = this.settings.businessHours[dayOfWeek];
      
      if (!daySettings || !daySettings.enabled) {
        continue;
      }

      const slotTime = slotStart.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit' 
      }).slice(0, 5); // HH:MM format

      if (slotTime < daySettings.start || slotTime >= daySettings.end) {
        continue;
      }

      // Check if specific time slot is blocked
      const isBlocked = this.settings.blockedTimeSlots.some(blocked => {
        if (blocked.date !== slotDateStr) return false;
        const blockedStart = blocked.startTime;
        const blockedEnd = blocked.endTime;
        return slotTime >= blockedStart && slotTime < blockedEnd;
      });

      if (isBlocked) {
        continue;
      }

      // All checks passed - include this slot
      filteredSlots.push(slot);
    }

    // Apply max slots per day limit if set
    if (this.settings.maxSlotsPerDay) {
      const slotsByDate = {};
      filteredSlots.forEach(slot => {
        const slotStart = new Date(slot.startTime || slot.StartTime || slot.startDate);
        const dateStr = slotStart.toISOString().split('T')[0];
        if (!slotsByDate[dateStr]) {
          slotsByDate[dateStr] = [];
        }
        slotsByDate[dateStr].push(slot);
      });

      const limitedSlots = [];
      Object.keys(slotsByDate).forEach(dateStr => {
        const daySlots = slotsByDate[dateStr].sort((a, b) => {
          const timeA = new Date(a.startTime || a.StartTime || a.startDate).getTime();
          const timeB = new Date(b.startTime || b.StartTime || b.startDate).getTime();
          return timeA - timeB;
        });
        limitedSlots.push(...daySlots.slice(0, this.settings.maxSlotsPerDay));
      });

      return limitedSlots.sort((a, b) => {
        const timeA = new Date(a.startTime || a.StartTime || a.startDate).getTime();
        const timeB = new Date(b.startTime || b.StartTime || b.startDate).getTime();
        return timeA - timeB;
      });
    }

    return filteredSlots.sort((a, b) => {
      const timeA = new Date(a.startTime || a.StartTime || a.startDate).getTime();
      const timeB = new Date(b.startTime || b.StartTime || b.startDate).getTime();
      return timeA - timeB;
    });
  }

  // Block a specific date
  async blockDate(date) {
    await this.ensureInitialized();
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    if (!this.settings.blockedDates.includes(dateStr)) {
      this.settings.blockedDates.push(dateStr);
      await this.saveSettings();
    }
    return this.settings.blockedDates;
  }

  // Unblock a date
  async unblockDate(date) {
    await this.ensureInitialized();
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    this.settings.blockedDates = this.settings.blockedDates.filter(d => d !== dateStr);
    await this.saveSettings();
    return this.settings.blockedDates;
  }

  // Block a specific time slot
  async blockTimeSlot(date, startTime, endTime) {
    await this.ensureInitialized();
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    const blocked = {
      date: dateStr,
      startTime: startTime,
      endTime: endTime
    };
    
    // Check if already blocked
    const exists = this.settings.blockedTimeSlots.some(
      b => b.date === dateStr && b.startTime === startTime && b.endTime === endTime
    );
    
    if (!exists) {
      this.settings.blockedTimeSlots.push(blocked);
      await this.saveSettings();
    }
    
    return this.settings.blockedTimeSlots;
  }

  // Unblock a time slot
  async unblockTimeSlot(date, startTime, endTime) {
    await this.ensureInitialized();
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    this.settings.blockedTimeSlots = this.settings.blockedTimeSlots.filter(
      b => !(b.date === dateStr && b.startTime === startTime && b.endTime === endTime)
    );
    await this.saveSettings();
    return this.settings.blockedTimeSlots;
  }

  // Update business hours for a day
  async updateBusinessHours(day, start, end, enabled = true) {
    await this.ensureInitialized();
    if (this.settings.businessHours[day]) {
      this.settings.businessHours[day] = { start, end, enabled };
      await this.saveSettings();
    }
    return this.settings.businessHours;
  }
}

// Export singleton instance
module.exports = new AvailabilityService();
