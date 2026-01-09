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

module.exports = { sendProviderAlert };
