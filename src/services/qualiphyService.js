// backend/src/services/qualiphyService.js
// Qualiphy third-party consultation provider integration.
// Routes consultations to Qualiphy when enabled via USE_QUALIPHY=true

const axios = require('axios');

class QualiphyService {
  constructor() {
    this.apiKey = process.env.QUALIPHY_API_KEY;
    this.apiSecret = process.env.QUALIPHY_API_SECRET;
    this.baseUrl = process.env.QUALIPHY_BASE_URL || 'https://api.qualiphy.com';
    this.enabled = String(process.env.USE_QUALIPHY || 'false').toLowerCase() === 'true';
  }

  /**
   * Check if Qualiphy is enabled and configured
   */
  isEnabled() {
    return this.enabled && this.apiKey && this.apiSecret;
  }

  /**
   * Create a consultation request with Qualiphy
   * @param {Object} params
   * @param {string} params.patientId - Tebra patient ID
   * @param {Object} params.patientInfo - Patient information
   * @param {string} params.reason - Consultation reason/red flags
   * @param {string} [params.preferredTime] - Preferred consultation time (ISO string)
   * @param {string} [params.urgency] - 'normal' or 'urgent'
   * @returns {Promise<{success: boolean, consultationId?: string, scheduledTime?: string, provider?: Object, meetingLink?: string, error?: string}>}
   */
  async createConsultationRequest({ patientId, patientInfo, reason, preferredTime, urgency = 'normal' }) {
    if (!this.isEnabled()) {
      console.warn('[Qualiphy] Service is disabled or not configured');
      return { success: false, error: 'Qualiphy service not enabled' };
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/consultations/request`,
        {
          patient_id: patientId,
          patient_name: `${patientInfo.firstName || ''} ${patientInfo.lastName || ''}`.trim(),
          patient_email: patientInfo.email,
          patient_phone: patientInfo.phone || '',
          reason: reason || 'Questionnaire red flags require consultation',
          preferred_time: preferredTime || null,
          urgency: urgency,
          metadata: {
            tebra_patient_id: patientId,
            source: 'sxrx_questionnaire'
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'X-API-Secret': this.apiSecret
          },
          timeout: 10000 // 10 second timeout
        }
      );

      const data = response.data;

      return {
        success: true,
        consultationId: data.consultation_id || data.id,
        scheduledTime: data.scheduled_time || data.appointment_time,
        provider: data.assigned_provider || data.provider,
        meetingLink: data.meeting_link || data.video_link,
        confirmationNumber: data.confirmation_number || data.confirmation
      };
    } catch (error) {
      console.error('[Qualiphy] Failed to create consultation request:', error?.message || error);
      
      // Handle specific error cases
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.message || error.response.data?.error || 'Unknown error';
        
        if (status === 401 || status === 403) {
          return { success: false, error: 'Invalid Qualiphy API credentials' };
        } else if (status === 400) {
          return { success: false, error: `Invalid request: ${message}` };
        } else if (status >= 500) {
          return { success: false, error: 'Qualiphy service unavailable' };
        }
      }
      
      return { success: false, error: error?.message || 'Failed to create consultation request' };
    }
  }

  /**
   * Get available consultation slots from Qualiphy
   * @param {Object} params
   * @param {string} [params.providerId] - Specific provider ID
   * @param {string} params.fromDate - Start date (YYYY-MM-DD)
   * @param {string} params.toDate - End date (YYYY-MM-DD)
   * @returns {Promise<{success: boolean, slots?: Array, error?: string}>}
   */
  async getAvailableSlots({ providerId, fromDate, toDate }) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Qualiphy service not enabled' };
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/v1/slots/available`,
        {
          params: {
            provider_id: providerId,
            from_date: fromDate,
            to_date: toDate
          },
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'X-API-Secret': this.apiSecret
          },
          timeout: 10000
        }
      );

      return {
        success: true,
        slots: response.data.slots || response.data.availability || []
      };
    } catch (error) {
      console.error('[Qualiphy] Failed to get available slots:', error?.message || error);
      return { success: false, error: error?.message || 'Failed to get available slots' };
    }
  }

  /**
   * Get consultation status
   * @param {string} consultationId - Qualiphy consultation ID
   * @returns {Promise<{success: boolean, status?: string, details?: Object, error?: string}>}
   */
  async getConsultationStatus(consultationId) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Qualiphy service not enabled' };
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/v1/consultations/${consultationId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'X-API-Secret': this.apiSecret
          },
          timeout: 10000
        }
      );

      return {
        success: true,
        status: response.data.status,
        details: response.data
      };
    } catch (error) {
      console.error('[Qualiphy] Failed to get consultation status:', error?.message || error);
      return { success: false, error: error?.message || 'Failed to get consultation status' };
    }
  }

  /**
   * Cancel a consultation
   * @param {string} consultationId - Qualiphy consultation ID
   * @param {string} [reason] - Cancellation reason
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async cancelConsultation(consultationId, reason = 'Patient request') {
    if (!this.isEnabled()) {
      return { success: false, error: 'Qualiphy service not enabled' };
    }

    try {
      await axios.post(
        `${this.baseUrl}/v1/consultations/${consultationId}/cancel`,
        { reason },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'X-API-Secret': this.apiSecret,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return { success: true };
    } catch (error) {
      console.error('[Qualiphy] Failed to cancel consultation:', error?.message || error);
      return { success: false, error: error?.message || 'Failed to cancel consultation' };
    }
  }
}

module.exports = new QualiphyService();

