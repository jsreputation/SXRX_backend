// backend/src/routes/availability.js
// Admin routes for managing appointment availability settings

const express = require('express');
const router = express.Router();
const availabilityService = require('../services/availabilityService');
const tebraService = require('../services/tebraService');
const providerMapping = require('../config/providerMapping');
const { 
  validateAvailabilityState, 
  validateAvailabilitySettings, 
  validateBlockDate, 
  validateBlockTimeSlot,
  sanitizeRequestBody 
} = require('../middleware/validation');
const { verifyAdminApiKey } = require('../middleware/adminAuth');

/**
 * @swagger
 * /api/availability/settings:
 *   get:
 *     summary: Get availability settings
 *     tags: [Availability]
 *     security:
 *       - AdminApiKey: []
 *     responses:
 *       200:
 *         description: Availability settings
 *       401:
 *         description: Unauthorized - Admin API key required
 */
// Get current availability settings (admin only)
router.get('/settings', verifyAdminApiKey, async (req, res) => {
  try {
    const settings = await availabilityService.getSettings();
    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Error getting availability settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get availability settings',
      error: error.message
    });
  }
});

// Update availability settings
router.put('/settings', express.json(), sanitizeRequestBody, validateAvailabilitySettings, (req, res) => {
  try {
    const { businessHours, advanceBookingDays, slotDuration, bufferTime, maxSlotsPerDay, timezone } = req.body;
    
    const updates = {};
    if (businessHours) updates.businessHours = businessHours;
    if (advanceBookingDays !== undefined) updates.advanceBookingDays = advanceBookingDays;
    if (slotDuration !== undefined) updates.slotDuration = slotDuration;
    if (bufferTime !== undefined) updates.bufferTime = bufferTime;
    if (maxSlotsPerDay !== undefined) updates.maxSlotsPerDay = maxSlotsPerDay;
    if (timezone) updates.timezone = timezone;

    const updatedSettings = availabilityService.updateSettings(updates);
    
    res.json({
      success: true,
      settings: updatedSettings,
      message: 'Availability settings updated successfully'
    });
  } catch (error) {
    console.error('Error updating availability settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update availability settings',
      error: error.message
    });
  }
});

// Block a date (admin only)
router.post('/block-date', verifyAdminApiKey, express.json({ limit: '10kb' }), sanitizeRequestBody, validateBlockDate, async (req, res) => {
  try {
    const { date } = req.body;

    const blockedDates = await availabilityService.blockDate(date);
    
    res.json({
      success: true,
      blockedDates,
      message: `Date ${date} blocked successfully`
    });
  } catch (error) {
    console.error('Error blocking date:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to block date',
      error: error.message
    });
  }
});

// Unblock a date (admin only)
router.delete('/block-date', verifyAdminApiKey, express.json(), sanitizeRequestBody, validateBlockDate, (req, res) => {
  try {
    const { date } = req.body;

    const blockedDates = availabilityService.unblockDate(date);
    
    res.json({
      success: true,
      blockedDates,
      message: `Date ${date} unblocked successfully`
    });
  } catch (error) {
    console.error('Error unblocking date:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unblock date',
      error: error.message
    });
  }
});

// Block a time slot (admin only)
router.post('/block-time-slot', verifyAdminApiKey, express.json(), sanitizeRequestBody, validateBlockTimeSlot, (req, res) => {
  try {
    const { date, startTime, endTime } = req.body;

    const blockedSlots = availabilityService.blockTimeSlot(date, startTime, endTime);
    
    res.json({
      success: true,
      blockedTimeSlots: blockedSlots,
      message: `Time slot blocked successfully`
    });
  } catch (error) {
    console.error('Error blocking time slot:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to block time slot',
      error: error.message
    });
  }
});

// Unblock a time slot
router.delete('/block-time-slot', express.json(), (req, res) => {
  try {
    const { date, startTime, endTime } = req.body;
    if (!date || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Date, startTime, and endTime are required'
      });
    }

    const blockedSlots = availabilityService.unblockTimeSlot(date, startTime, endTime);
    
    res.json({
      success: true,
      blockedTimeSlots: blockedSlots,
      message: `Time slot unblocked successfully`
    });
  } catch (error) {
    console.error('Error unblocking time slot:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unblock time slot',
      error: error.message
    });
  }
});

// Get filtered availability for a state (applies business rules)
const { parsePaginationParams, createPaginationMeta, createPaginatedResponse } = require('../utils/pagination');
router.get('/:state', validateAvailabilityState, async (req, res) => {
  try {
    const { state } = req.params;
    const { fromDate, toDate, providerId } = req.query;
    
    const mapping = providerMapping[state.toUpperCase()];
    if (!mapping) {
      return res.status(400).json({ 
        success: false, 
        message: `Unsupported state: ${state}` 
      });
    }

    // Parse pagination params (for availability slots)
    const pagination = parsePaginationParams(req, { defaultLimit: 50, maxLimit: 200 });

    // Check cache for filtered availability
    const cacheService = require('../services/cacheService');
    const cacheKey = {
      state: state.toUpperCase(),
      practiceId: mapping.practiceId,
      providerId: providerId || mapping.defaultProviderId,
      fromDate: fromDate || new Date().toISOString().split('T')[0],
      toDate: toDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
    
    const cachedFiltered = await cacheService.getCachedAvailability(cacheKey);
    if (cachedFiltered) {
      // Apply pagination to cached filtered slots
      const total = cachedFiltered.length;
      const paginatedSlots = cachedFiltered.slice(pagination.offset, pagination.offset + pagination.limit);
      const paginationMeta = createPaginationMeta({ ...pagination, total });

      return res.json(createPaginatedResponse(paginatedSlots, paginationMeta, {
        rawCount: cachedFiltered.rawCount || 0,
        state: state.toUpperCase(),
        practiceId: mapping.practiceId,
        providerId: providerId || mapping.defaultProviderId,
        filtersApplied: true,
        cached: true
      }));
    }

    // Fetch raw availability from Tebra
    const rawAvailability = await tebraService.getAvailability({
      practiceId: mapping.practiceId,
      providerId: providerId || mapping.defaultProviderId,
      isAvailable: true,
      fromDate: fromDate || new Date().toISOString().split('T')[0],
      toDate: toDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });

    // Apply business rules and filters (now async)
    const allFilteredSlots = await availabilityService.filterAvailability(
      rawAvailability.availability || [],
      { state, practiceId: mapping.practiceId, providerId: providerId || mapping.defaultProviderId }
    );

    // Cache filtered availability
    await cacheService.cacheAvailability(cacheKey, allFilteredSlots);

    // Apply pagination to filtered slots
    const total = allFilteredSlots.length;
    const paginatedSlots = allFilteredSlots.slice(pagination.offset, pagination.offset + pagination.limit);
    const paginationMeta = createPaginationMeta({ ...pagination, total });

    res.json(createPaginatedResponse(paginatedSlots, paginationMeta, {
      rawCount: rawAvailability.totalCount || 0,
      state: state.toUpperCase(),
      practiceId: mapping.practiceId,
      providerId: providerId || mapping.defaultProviderId,
      filtersApplied: true
    }));
  } catch (error) {
    console.error('Get filtered availability error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal error', 
      error: error.message 
    });
  }
});

module.exports = router;
