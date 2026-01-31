// backend/src/services/notificationService.js
// Minimal provider notification via SendGrid (email).

const sgMail = require('@sendgrid/mail');

function init() {
  const key = process.env.SENDGRID_API_KEY;
  if (key) sgMail.setApiKey(key);
}

async function sendProviderAlert({ to, subject, text, html }) {
  init();
  const fallback = process.env.PROVIDER_ALERT_EMAIL;
  const recipient = to || fallback;
  if (!recipient) {
    console.warn('sendProviderAlert: no recipient configured');
    return { success: false, error: 'No recipient' };
  }
  try {
    const from = process.env.SENDGRID_FROM || 'no-reply@sxrx.local';
    await sgMail.send({ to: recipient, from, subject, text: text || (html ? undefined : 'Notification'), html });
    return { success: true };
  } catch (e) {
    console.warn('sendProviderAlert failed:', e?.message || e);
    return { success: false, error: e?.message || String(e) };
  }
}

async function sendEmail({ to, subject, text, html }) {
  init();
  if (!to) {
    console.warn('sendEmail: no recipient provided');
    return { success: false, error: 'No recipient' };
  }
  try {
    const from = process.env.SENDGRID_FROM || 'no-reply@sxrx.local';
    await sgMail.send({ to, from, subject, text: text || (html ? undefined : 'Email'), html });
    return { success: true };
  } catch (e) {
    console.warn('sendEmail failed:', e?.message || e);
    return { success: false, error: e?.message || String(e) };
  }
}

async function sendSMS({ to, message }) {
  if (!to || !message) {
    console.warn('sendSMS: missing recipient or message');
    return { success: false, error: 'Missing recipient or message' };
  }

  // SMS provider is not configured in this project yet.
  console.warn('sendSMS: SMS provider not configured');
  return { success: false, error: 'SMS provider not configured' };
}

module.exports = { sendProviderAlert, sendEmail, sendSMS };
