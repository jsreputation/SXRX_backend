// backend/src/services/availabilityCalculator.js
// Calculates available appointment slots using GetAppointments (since GetAvailability is not available in Tebra SOAP 2.1)

const logger = require('../utils/logger');
const availabilityService = require('./availabilityService');

class AvailabilityCalculator {
  /**
   * Calculate available appointment slots
   * Uses GetAppointments to find existing appointments, then generates available slots
   * 
   * @param {Object} options - Availability options
   * @param {string} options.practiceId - Practice ID
   * @param {string} options.providerId - Provider ID
   * @param {string} options.fromDate - Start date (YYYY-MM-DD)
   * @param {string} options.toDate - End date (YYYY-MM-DD)
   * @param {number} options.slotDuration - Slot duration in minutes (default: 30)
   * @returns {Promise<Object>} Availability result with slots array
   */
  async calculateAvailability(options = {}) {
    try {
      const tebraService = require('./tebraService');
      const {
        practiceId,
        providerId,
        fromDate,
        toDate,
        slotDuration = 30
      } = options;

      if (!practiceId || !fromDate || !toDate) {
        throw new Error('practiceId, fromDate, and toDate are required');
      }

      // Step 1: Get existing appointments for the date range
      const existingAppointments = await this.getExistingAppointments({
        practiceId,
        providerId,
        fromDate,
        toDate,
        state: options.state,
        tebraService
      });

      // Step 2: Generate potential time slots based on business hours
      const potentialSlots = await this.generateTimeSlots({
        fromDate,
        toDate,
        slotDuration,
        practiceId,
        providerId
      });

      // Step 3: Filter out slots that conflict with existing appointments
      const availableSlots = this.filterConflictingSlots(potentialSlots, existingAppointments);

      // Step 4: Apply business rules (blocked dates, advance booking, etc.)
      const filteredSlots = await availabilityService.filterAvailability(availableSlots, {
        state: options.state,
        practiceId,
        providerId
      });

      return {
        availability: filteredSlots,
        totalCount: filteredSlots.length,
        fromDate,
        toDate,
        practiceId,
        providerId
      };
    } catch (error) {
      logger.error('[AVAILABILITY_CALCULATOR] Failed to calculate availability', {
        error: error.message,
        options
      });
      throw error;
    }
  }

  /**
   * Get existing appointments using GetAppointments
   * Excludes Cancelled/Canceled. Uses startDateTime/endDateTime (full ISO) for conflict checks.
   * Merges in recently-booked overlay (Redis, TTL 2min) to handle Tebra eventual consistency.
   */
  async getExistingAppointments({ practiceId, providerId, fromDate, toDate, state, tebraService }) {
    try {
      const appointments = await tebraService.getAppointments({
        practiceId,
        providerId,
        startDate: fromDate,
        endDate: toDate
      });

      const list = appointments.appointments || [];
      const statusOk = (apt) => {
        const s = (apt.AppointmentStatus || apt.appointmentStatus || '').toString().toLowerCase();
        return s !== 'cancelled' && s !== 'canceled';
      };

      // Prefer full ISO datetimes (startDateTime/endDateTime or StartTime/EndTime); exclude cancelled
      let existingSlots = list.filter(statusOk).map(apt => ({
        startTime: apt.startDateTime || apt.StartTime || apt.startTime,
        endTime: apt.endDateTime || apt.EndTime || apt.endTime,
        startDate: apt.startDate || apt.StartDate,
        providerId: apt.ProviderID || apt.providerId,
        practiceId: apt.PracticeID || apt.practiceId
      }));

      // Merge recently-booked overlay (covers Tebra eventual consistency)
      if (state && providerId != null) {
        try {
          const cacheService = require('./cacheService');
          const overlay = await cacheService.getBookedSlots(state, providerId);
          for (const { start, end } of overlay || []) {
            if (start && end) existingSlots.push({ startTime: start, endTime: end, startDate: (start || '').toString().slice(0, 10), providerId, practiceId });
          }
        } catch (e) {
          logger.debug('[AVAILABILITY_CALCULATOR] getBookedSlots overlay failed', { error: e?.message });
        }
      }

      logger.debug('[AVAILABILITY_CALCULATOR] Found existing appointments', {
        count: existingSlots.length,
        fromDate,
        toDate
      });

      return existingSlots;
    } catch (error) {
      logger.warn('[AVAILABILITY_CALCULATOR] Failed to get existing appointments, assuming none', {
        error: error.message
      });
      return []; // Return empty array if we can't fetch appointments
    }
  }

  /**
   * Generate potential time slots based on business hours
   */
  async generateTimeSlots({ fromDate, toDate, slotDuration, practiceId, providerId }) {
    await availabilityService.ensureInitialized();
    const settings = availabilityService.settings;

    const slots = [];
    const start = new Date(fromDate + 'T00:00:00');
    const end = new Date(toDate + 'T23:59:59');
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      // Get weekday name and convert to lowercase (monday, tuesday, etc.)
      const dayOfWeek = current.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const daySettings = settings.businessHours[dayOfWeek];

      if (daySettings && daySettings.enabled) {
        const [startHour, startMinute] = daySettings.start.split(':').map(Number);
        const [endHour, endMinute] = daySettings.end.split(':').map(Number);

        const dayStart = new Date(current);
        dayStart.setHours(startHour, startMinute, 0, 0);

        const dayEnd = new Date(current);
        dayEnd.setHours(endHour, endMinute, 0, 0);

        let slotTime = new Date(dayStart);

        while (slotTime < dayEnd) {
          const slotEnd = new Date(slotTime.getTime() + slotDuration * 60 * 1000);

          if (slotEnd <= dayEnd) {
            slots.push({
              startTime: slotTime.toISOString(),
              endTime: slotEnd.toISOString(),
              startDate: dateStr,
              providerId,
              practiceId,
              duration: slotDuration
            });
          }

          slotTime = new Date(slotTime.getTime() + slotDuration * 60 * 1000);
        }
      }

      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
    }

    logger.debug('[AVAILABILITY_CALCULATOR] Generated potential slots', {
      count: slots.length,
      fromDate,
      toDate
    });

    return slots;
  }

  /**
   * Filter out slots that conflict with existing appointments
   * Uses full ISO start/end; if apt.endTime is missing, assumes 30min after apt.startTime.
   */
  filterConflictingSlots(potentialSlots, existingAppointments) {
    const availableSlots = [];

    for (const slot of potentialSlots) {
      const slotStart = new Date(slot.startTime);
      const slotEnd = new Date(slot.endTime);
      if (isNaN(slotStart.getTime()) || isNaN(slotEnd.getTime())) continue;

      const hasConflict = existingAppointments.some(apt => {
        const rawStart = apt.startTime || apt.startDate;
        if (!rawStart) return false;
        const aptStart = new Date(rawStart);
        if (isNaN(aptStart.getTime())) return false;
        // Prefer full end; if missing, assume 30min so we don't under-exclude
        const rawEnd = apt.endTime || apt.endDateTime || apt.EndTime;
        const aptEnd = (rawEnd && !isNaN(new Date(rawEnd).getTime()))
          ? new Date(rawEnd)
          : new Date(aptStart.getTime() + 30 * 60 * 1000);

        return slotStart < aptEnd && slotEnd > aptStart;
      });

      if (!hasConflict) {
        availableSlots.push(slot);
      }
    }

    logger.debug('[AVAILABILITY_CALCULATOR] Filtered conflicting slots', {
      potential: potentialSlots.length,
      available: availableSlots.length,
      conflicts: potentialSlots.length - availableSlots.length
    });

    return availableSlots;
  }
}

module.exports = new AvailabilityCalculator();
