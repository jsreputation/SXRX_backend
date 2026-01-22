// backend/src/services/appointmentEmailService.js
// Service for sending appointment confirmation emails with calendar links

const sgMail = require('@sendgrid/mail');
const logger = require('../utils/logger');

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/**
 * Generate Google Calendar link
 * @param {Object} appointment - Appointment details
 * @returns {string} Google Calendar URL
 */
function generateGoogleCalendarLink(appointment) {
  const { startTime, endTime, title, description, location } = appointment;
  
  const start = new Date(startTime).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const end = new Date(endTime).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Appointment',
    dates: `${start}/${end}`,
    details: description || '',
    location: location || ''
  });
  
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generate Outlook Calendar link
 * @param {Object} appointment - Appointment details
 * @returns {string} Outlook Calendar URL
 */
function generateOutlookCalendarLink(appointment) {
  const { startTime, endTime, title, description, location } = appointment;
  
  const start = new Date(startTime).toISOString();
  const end = new Date(endTime).toISOString();
  
  const params = new URLSearchParams({
    subject: title || 'Appointment',
    startdt: start,
    enddt: end,
    body: description || '',
    location: location || ''
  });
  
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/**
 * Generate iCal file content
 * @param {Object} appointment - Appointment details
 * @returns {string} iCal content
 */
function generateICalContent(appointment) {
  const { startTime, endTime, title, description, location } = appointment;
  
  const formatDate = (date) => {
    return new Date(date).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };
  
  const escapeText = (text) => {
    return (text || '').replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n');
  };
  
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SXRX//Appointment//EN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@sxrx.com`,
    `DTSTART:${formatDate(startTime)}`,
    `DTEND:${formatDate(endTime)}`,
    `SUMMARY:${escapeText(title || 'Appointment')}`,
    `DESCRIPTION:${escapeText(description || '')}`,
    `LOCATION:${escapeText(location || '')}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

/**
 * Send appointment confirmation email
 * @param {Object} params
 * @param {string} params.to - Recipient email address
 * @param {string} params.patientName - Patient name
 * @param {Object} params.appointment - Appointment details
 * @param {string} params.appointment.id - Appointment ID
 * @param {string} params.appointment.startTime - Start time (ISO string)
 * @param {string} params.appointment.endTime - End time (ISO string)
 * @param {string} params.appointment.providerName - Provider name
 * @param {string} params.appointment.appointmentType - Appointment type
 * @param {string} params.appointment.meetingLink - Meeting link (if telemedicine)
 * @param {string} params.appointment.notes - Additional notes
 * @returns {Promise<Object>} SendGrid response
 */
async function sendAppointmentConfirmation({ to, patientName, appointment }) {
  if (!process.env.SENDGRID_API_KEY) {
    logger.warn('[APPOINTMENT EMAIL] SendGrid not configured, skipping email');
    return { success: false, reason: 'SendGrid not configured' };
  }

  try {
    const startDate = new Date(appointment.startTime);
    const endDate = new Date(appointment.endTime);
    
    const formattedDate = startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const formattedStartTime = startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    const formattedEndTime = endDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Generate calendar links
    const googleCalendarLink = generateGoogleCalendarLink({
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      title: `${appointment.appointmentType || 'Appointment'} with ${appointment.providerName || 'Provider'}`,
      description: appointment.notes || '',
      location: appointment.meetingLink || ''
    });
    
    const outlookCalendarLink = generateOutlookCalendarLink({
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      title: `${appointment.appointmentType || 'Appointment'} with ${appointment.providerName || 'Provider'}`,
      description: appointment.notes || '',
      location: appointment.meetingLink || ''
    });

    // Generate iCal attachment
    const icalContent = generateICalContent({
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      title: `${appointment.appointmentType || 'Appointment'} with ${appointment.providerName || 'Provider'}`,
      description: appointment.notes || '',
      location: appointment.meetingLink || ''
    });

    const emailContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .appointment-details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #4CAF50; }
          .detail-row { margin: 10px 0; }
          .label { font-weight: bold; color: #666; }
          .calendar-links { margin: 20px 0; }
          .calendar-link { display: inline-block; margin: 5px 10px 5px 0; padding: 10px 15px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Appointment Confirmed</h1>
          </div>
          <div class="content">
            <p>Dear ${patientName || 'Patient'},</p>
            <p>Your appointment has been confirmed. Please find the details below:</p>
            
            <div class="appointment-details">
              <div class="detail-row">
                <span class="label">Date:</span> ${formattedDate}
              </div>
              <div class="detail-row">
                <span class="label">Time:</span> ${formattedStartTime} - ${formattedEndTime}
              </div>
              ${appointment.providerName ? `
              <div class="detail-row">
                <span class="label">Provider:</span> ${appointment.providerName}
              </div>
              ` : ''}
              ${appointment.appointmentType ? `
              <div class="detail-row">
                <span class="label">Type:</span> ${appointment.appointmentType}
              </div>
              ` : ''}
              ${appointment.meetingLink ? `
              <div class="detail-row">
                <span class="label">Meeting Link:</span> <a href="${appointment.meetingLink}">${appointment.meetingLink}</a>
              </div>
              ` : ''}
              ${appointment.notes ? `
              <div class="detail-row">
                <span class="label">Notes:</span> ${appointment.notes}
              </div>
              ` : ''}
            </div>
            
            <div class="calendar-links">
              <p><strong>Add to Calendar:</strong></p>
              <a href="${googleCalendarLink}" class="calendar-link">Add to Google Calendar</a>
              <a href="${outlookCalendarLink}" class="calendar-link">Add to Outlook</a>
            </div>
            
            <p>If you need to reschedule or cancel, please contact us at least 24 hours in advance.</p>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const msg = {
      to,
      from: process.env.SENDGRID_FROM || 'noreply@sxrx.com',
      subject: `Appointment Confirmed - ${formattedDate} at ${formattedStartTime}`,
      html: emailContent,
      attachments: [
        {
          content: Buffer.from(icalContent).toString('base64'),
          filename: 'appointment.ics',
          type: 'text/calendar',
          disposition: 'attachment'
        }
      ]
    };

    await sgMail.send(msg);
    
    logger.info('[APPOINTMENT EMAIL] Confirmation email sent', {
      to,
      appointmentId: appointment.id
    });
    
    return { success: true };
  } catch (error) {
    logger.error('[APPOINTMENT EMAIL] Failed to send confirmation email', {
      to,
      appointmentId: appointment.id,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  sendAppointmentConfirmation,
  generateGoogleCalendarLink,
  generateOutlookCalendarLink,
  generateICalContent
};
