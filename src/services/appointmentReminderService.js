// backend/src/services/appointmentReminderService.js
// Service for sending appointment reminders (24h and 2h before)

const sgMail = require('@sendgrid/mail');
const { query } = require('../db/pg');
const logger = require('../utils/logger');
const tebraService = require('./tebraService');

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/**
 * Get upcoming appointments that need reminders
 * @param {number} hoursBefore - Hours before appointment to send reminder (24 or 2)
 * @returns {Promise<Array>} Array of appointments needing reminders
 */
async function getAppointmentsNeedingReminders(hoursBefore) {
  try {
    // Calculate the target time window (e.g., appointments starting in 24-25 hours)
    const now = new Date();
    const targetStart = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);
    const targetEnd = new Date(now.getTime() + (hoursBefore + 1) * 60 * 60 * 1000);
    
    // Query Tebra for appointments in this window
    // Note: This is a simplified approach - you may need to adjust based on Tebra API
    const appointments = await tebraService.getAppointments({
      fromDate: targetStart.toISOString().split('T')[0],
      toDate: targetEnd.toISOString().split('T')[0],
      status: 'Scheduled'
    });
    
    // Filter appointments that haven't received this reminder yet
    // In a real implementation, you'd track sent reminders in a database
    const appointmentsToRemind = (appointments.appointments || appointments || []).filter(apt => {
      const status = (apt.AppointmentStatus || apt.appointmentStatus || apt.status || '').toString().toLowerCase();
      if (!status || (status !== 'scheduled' && status !== 'confirmed')) {
        return false;
      }

      const aptStart = new Date(apt.StartTime || apt.startTime || apt.start_date);
      const hoursUntil = (aptStart.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      // Check if appointment is within the reminder window
      return hoursUntil >= hoursBefore && hoursUntil < hoursBefore + 1;
    });
    
    return appointmentsToRemind;
  } catch (error) {
    logger.error('[APPOINTMENT REMINDER] Failed to get appointments needing reminders', {
      hoursBefore,
      error: error.message
    });
    return [];
  }
}

/**
 * Send appointment reminder email
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.patientName - Patient name
 * @param {Object} params.appointment - Appointment details
 * @param {number} params.hoursBefore - Hours before appointment
 * @returns {Promise<Object>} Send result
 */
async function sendAppointmentReminder({ to, patientName, appointment, hoursBefore }) {
  if (!process.env.SENDGRID_API_KEY) {
    logger.warn('[APPOINTMENT REMINDER] SendGrid not configured, skipping reminder');
    return { success: false, reason: 'SendGrid not configured' };
  }

  try {
    const startDate = new Date(appointment.StartTime || appointment.startTime || appointment.start_date);
    
    const formattedDate = startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const formattedTime = startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const reminderText = hoursBefore === 24 
      ? 'Your appointment is tomorrow'
      : `Your appointment is in ${hoursBefore} hours`;

    const emailContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #2196F3; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .appointment-details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #2196F3; }
          .detail-row { margin: 10px 0; }
          .label { font-weight: bold; color: #666; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Appointment Reminder</h1>
          </div>
          <div class="content">
            <p>Dear ${patientName || 'Patient'},</p>
            <p><strong>${reminderText}.</strong></p>
            
            <div class="appointment-details">
              <div class="detail-row">
                <span class="label">Date:</span> ${formattedDate}
              </div>
              <div class="detail-row">
                <span class="label">Time:</span> ${formattedTime}
              </div>
              ${appointment.ProviderName || appointment.providerName ? `
              <div class="detail-row">
                <span class="label">Provider:</span> ${appointment.ProviderName || appointment.providerName}
              </div>
              ` : ''}
              ${appointment.MeetingLink || appointment.meetingLink ? `
              <div class="detail-row">
                <span class="label">Meeting Link:</span> <a href="${appointment.MeetingLink || appointment.meetingLink}">${appointment.MeetingLink || appointment.meetingLink}</a>
              </div>
              ` : ''}
            </div>
            
            <p>If you need to reschedule or cancel, please contact us as soon as possible.</p>
          </div>
          <div class="footer">
            <p>This is an automated reminder. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const msg = {
      to,
      from: process.env.SENDGRID_FROM || 'noreply@sxrx.com',
      subject: `Appointment Reminder - ${formattedDate} at ${formattedTime}`,
      html: emailContent
    };

    await sgMail.send(msg);
    
    logger.info('[APPOINTMENT REMINDER] Reminder email sent', {
      to,
      appointmentId: appointment.AppointmentID || appointment.id,
      hoursBefore
    });
    
    return { success: true };
  } catch (error) {
    logger.error('[APPOINTMENT REMINDER] Failed to send reminder email', {
      to,
      appointmentId: appointment.AppointmentID || appointment.id,
      hoursBefore,
      error: error.message
    });
    throw error;
  }
}

/**
 * Process and send reminders for appointments
 * @param {number} hoursBefore - Hours before appointment (24 or 2)
 */
async function processReminders(hoursBefore) {
  try {
    logger.info(`[APPOINTMENT REMINDER] Processing ${hoursBefore}h reminders`);
    
    const appointments = await getAppointmentsNeedingReminders(hoursBefore);
    
    if (appointments.length === 0) {
      logger.info(`[APPOINTMENT REMINDER] No appointments need ${hoursBefore}h reminders`);
      return { processed: 0, sent: 0, failed: 0 };
    }
    
    logger.info(`[APPOINTMENT REMINDER] Found ${appointments.length} appointment(s) needing ${hoursBefore}h reminders`);
    
    let sent = 0;
    let failed = 0;
    
    for (const appointment of appointments) {
      try {
        // Get patient info
        const patientId = appointment.PatientID || appointment.patientId || appointment.Patient?.ID;
        if (!patientId) {
          logger.warn('[APPOINTMENT REMINDER] Appointment missing patient ID', {
            appointmentId: appointment.AppointmentID || appointment.id
          });
          failed++;
          continue;
        }
        
        const patientInfo = await tebraService.getPatient({ patientId });
        if (!patientInfo || !patientInfo.Email) {
          logger.warn('[APPOINTMENT REMINDER] Patient missing email', {
            patientId,
            appointmentId: appointment.AppointmentID || appointment.id
          });
          failed++;
          continue;
        }
        
        const patientName = patientInfo.FirstName && patientInfo.LastName
          ? `${patientInfo.FirstName} ${patientInfo.LastName}`
          : patientInfo.Email;
        
        await sendAppointmentReminder({
          to: patientInfo.Email,
          patientName,
          appointment,
          hoursBefore
        });
        
        sent++;
      } catch (error) {
        logger.error('[APPOINTMENT REMINDER] Failed to process reminder', {
          appointmentId: appointment.AppointmentID || appointment.id,
          error: error.message
        });
        failed++;
      }
    }
    
    logger.info(`[APPOINTMENT REMINDER] Processed ${appointments.length} reminder(s): ${sent} sent, ${failed} failed`);
    
    return {
      processed: appointments.length,
      sent,
      failed
    };
  } catch (error) {
    logger.error('[APPOINTMENT REMINDER] Failed to process reminders', {
      hoursBefore,
      error: error.message
    });
    return { processed: 0, sent: 0, failed: 0 };
  }
}

module.exports = {
  sendAppointmentReminder,
  getAppointmentsNeedingReminders,
  processReminders
};
