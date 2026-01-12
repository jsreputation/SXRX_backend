// Google Meet link generation service
// For telemedicine consultations

class GoogleMeetService {
  constructor() {
    this.baseUrl = 'https://meet.google.com';
  }

  /**
   * Generate a Google Meet link for a consultation
   * @param {Object} options - Meeting options
   * @param {string} options.patientName - Patient's name
   * @param {string} options.doctorName - Doctor's name
   * @param {string} options.appointmentId - Appointment ID
   * @param {Date} options.scheduledTime - Scheduled appointment time
   * @returns {Object} Meeting details with link
   */
  generateMeetLink(options = {}) {
    const { patientName, doctorName, appointmentId, scheduledTime } = options;
    
    // Generate a unique meeting code (in production, you might want to use Google Calendar API)
    const meetingCode = this.generateMeetingCode();
    const meetLink = `${this.baseUrl}/${meetingCode}`;
    
    // Create meeting details
    const meetingDetails = {
      meetingId: meetingCode,
      meetLink,
      patientName: patientName || 'Patient',
      doctorName: doctorName || 'Doctor',
      appointmentId: appointmentId || null,
      scheduledTime: scheduledTime || new Date(),
      created_at: new Date(),
      // Additional meeting info
      meetingTitle: `Consultation - ${patientName || 'Patient'} with ${doctorName || 'Doctor'}`,
      duration: 30, // Default 30 minutes
      status: 'scheduled'
    };

    return meetingDetails;
  }

  /**
   * Generate a unique meeting code
   * @returns {string} Meeting code
   */
  generateMeetingCode() {
    // Generate a random string similar to Google Meet codes
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 10; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Add hyphens like real Google Meet codes
    return result.slice(0, 3) + '-' + result.slice(3, 7) + '-' + result.slice(7);
  }

  /**
   * Create a calendar event with Google Meet link
   * @param {Object} options - Event options
   * @returns {Object} Calendar event details
   */
  async createCalendarEvent(options = {}) {
    // This would integrate with Google Calendar API in production
    // For now, return the meeting details
    const meetingDetails = this.generateMeetLink(options);
    
    return {
      eventId: `event_${Date.now()}`,
      meetingDetails,
      calendarLink: `https://calendar.google.com/calendar/event?action=TEMPLATE&text=${encodeURIComponent(meetingDetails.meetingTitle)}&dates=${this.formatDateForCalendar(meetingDetails.scheduledTime)}`,
      status: 'created'
    };
  }

  /**
   * Format date for Google Calendar
   * @param {Date} date - Date to format
   * @returns {string} Formatted date string
   */
  formatDateForCalendar(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  }

  /**
   * Send meeting details via email/SMS
   * @param {Object} meetingDetails - Meeting details
   * @param {string} patientEmail - Patient email
   * @param {string} patientPhone - Patient phone
   * @returns {Object} Notification status
   */
  async sendMeetingNotification(meetingDetails, patientEmail, patientPhone) {
    // This would integrate with email/SMS services
    // For now, return the details that would be sent
    
    const emailContent = {
      to: patientEmail,
      subject: 'Your Telemedicine Consultation',
      body: `
        Hello ${meetingDetails.patientName},
        
        Your telemedicine consultation with ${meetingDetails.doctorName} is scheduled.
        
        Meeting Details:
        - Date: ${meetingDetails.scheduledTime.toLocaleDateString()}
        - Time: ${meetingDetails.scheduledTime.toLocaleTimeString()}
        - Google Meet Link: ${meetingDetails.meetLink}
        
        Please join the meeting 5 minutes before your scheduled time.
        
        Best regards,
        SXRX Team
      `
    };

    const smsContent = {
      to: patientPhone,
      message: `Your telemedicine consultation is scheduled. Join here: ${meetingDetails.meetLink}`
    };

    return {
      email: emailContent,
      sms: smsContent,
      status: 'prepared'
    };
  }
}

module.exports = new GoogleMeetService();
