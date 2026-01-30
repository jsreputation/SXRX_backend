const axios = require('axios');
const moment = require('moment-timezone');

function safeTrim(value) {
  const s = (value ?? '').toString().trim();
  return s.length ? s : null;
}

function parseFullName(fullName) {
  const s = safeTrim(fullName);
  if (!s) return { firstName: null, lastName: null };
  const parts = s.split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function extractCustomerIdFromOrder(body) {
  return (
    body?.customer?.id ||
    body?.customer_id ||
    null
  );
}

function extractContactFromLineItemProperties(lineItems) {
  const out = { firstName: null, lastName: null, email: null, fullName: null, matchedKeys: [] };
  const items = Array.isArray(lineItems) ? lineItems : [];

  for (const item of items) {
    const props = Array.isArray(item?.properties) ? item.properties : [];
    for (const prop of props) {
      const rawKey = prop?.name ?? '';
      const key = rawKey.toString().toLowerCase().trim();
      const val = safeTrim(prop?.value);
      if (!key || !val) continue;

      const recordMatch = (field) => out.matchedKeys.push(`${field}:${rawKey}`);

      if (!out.email && key.includes('email') && val.includes('@')) {
        out.email = val;
        recordMatch('email');
        continue;
      }

      if (!out.firstName && (key === 'first_name' || key === 'firstname' || key.includes('first name') || key.includes('given name'))) {
        out.firstName = val;
        recordMatch('firstName');
        continue;
      }

      if (!out.lastName && (key === 'last_name' || key === 'lastname' || key.includes('last name') || key.includes('family name') || key.includes('surname'))) {
        out.lastName = val;
        recordMatch('lastName');
        continue;
      }

      if (!out.fullName && (key === 'full_name' || key.includes('full name') || key === 'name' || key.endsWith('_name'))) {
        out.fullName = val;
        recordMatch('fullName');
      }
    }
  }

  if ((!out.firstName || !out.lastName) && out.fullName) {
    const parsed = parseFullName(out.fullName);
    out.firstName = out.firstName || parsed.firstName;
    out.lastName = out.lastName || parsed.lastName;
  }

  return out;
}

function normalizePropKey(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildLineItemPropsMap(properties) {
  const props = Array.isArray(properties) ? properties : [];
  const map = {};
  for (const p of props) {
    const rawKey = p?.name ?? p?.key ?? '';
    const rawVal = p?.value ?? p?.val ?? '';
    const k = normalizePropKey(rawKey);
    const v = safeTrim(rawVal);
    if (!k || v === null) continue;
    if (!map[k]) map[k] = { value: v, rawKey: String(rawKey), all: [v] };
    else map[k].all.push(v);
  }
  return map;
}

function parseDurationMinutes(raw) {
  const s = safeTrim(raw);
  if (!s) return null;

  const iso = s.match(/^pt(\d+)m$/i);
  if (iso) return parseInt(iso[1], 10);

  const hhmm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmm) {
    const h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    const sec = hhmm[3] ? parseInt(hhmm[3], 10) : 0;
    return h * 60 + m + Math.round(sec / 60);
  }

  const num = s.match(/(\d+(?:\.\d+)?)/);
  if (num) {
    const n = parseFloat(num[1]);
    if (Number.isFinite(n)) {
      const lower = s.toLowerCase();

      if (lower.includes('hour')) return Math.round(n * 60);
      if (lower.includes('sec')) return Math.max(1, Math.round(n / 60));

      if (n >= 100000) return Math.max(1, Math.round(n / 60000));
      if (n >= 1000) return Math.max(1, Math.round(n / 60));

      return Math.round(n);
    }
  }

  return null;
}

function parseAppointmentDateTime(value, tz) {
  const s = safeTrim(value);
  if (!s) return null;

  if (/^\d{10,13}$/.test(s)) {
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) return null;
    const ms = s.length === 10 ? n * 1000 : n;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const zoneParsed = moment.parseZone(s, moment.ISO_8601, true);
  if (zoneParsed.isValid() && /z|[+\-]\d{2}:?\d{2}$/i.test(s)) {
    return zoneParsed.toDate();
  }

  const m1 = moment(s, moment.ISO_8601, true);
  if (m1.isValid()) return m1.toDate();

  const zone = tz || process.env.DEFAULT_BOOKING_TIMEZONE || process.env.SHOPIFY_TIMEZONE || 'UTC';
  const mtz = moment.tz(s, zone);
  if (mtz.isValid()) return mtz.toDate();

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function extractAppointmentBookingMeta(order, lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const candidates = [];

  for (const item of items) {
    const properties = item?.properties || [];
    const map = buildLineItemPropsMap(properties);
    const keys = Object.keys(map);

    const get = (...names) => {
      for (const n of names) {
        const k = normalizePropKey(n);
        if (map[k]?.value) return map[k].value;
      }
      return null;
    };

    const tz =
      get('timezone', 'time_zone', 'tz') ||
      (order && (order.timezone || order.time_zone)) ||
      null;

    const startRaw =
      get('appointment_start', 'booking_start', 'start_datetime', 'start_date_time', 'appointment_datetime', 'scheduled_datetime') ||
      get('appointment_time', 'booking_time', 'scheduled_time') ||
      null;

    const dateRaw =
      get('appointment_date', 'booking_date', 'date', 'start_date', 'scheduled_date') ||
      null;
    const timeRaw =
      get('start_time', 'time', 'scheduled_time', 'appointment_time', 'booking_time') ||
      null;

    const durationRaw =
      get('duration', 'appointment_duration', 'booking_duration', 'service_duration') ||
      null;

    const durationMin = parseDurationMinutes(durationRaw);

    let startDate = null;
    let startSource = null;
    let usedParts = null;

    if (startRaw) {
      const parsed = parseAppointmentDateTime(startRaw, tz);
      if (parsed) {
        startDate = parsed;
        startSource = 'single_field';
        usedParts = { startKey: map[normalizePropKey('appointment_start')]?.rawKey || 'unknown', startRaw, tz: tz || null };
      }
    }

    if (!startDate && dateRaw && timeRaw) {
      const combined = `${dateRaw} ${timeRaw}`;
      const parsed = parseAppointmentDateTime(combined, tz);
      if (parsed) {
        startDate = parsed;
        startSource = 'date_time_fields';
        usedParts = { dateRaw, timeRaw, tz: tz || null };
      }
    }

    if (!startDate && (dateRaw || timeRaw)) {
      const parsed = parseAppointmentDateTime(startRaw || dateRaw || timeRaw, tz);
      if (parsed) {
        startDate = parsed;
        startSource = 'fallback_single';
        usedParts = { raw: startRaw || dateRaw || timeRaw, tz: tz || null };
      }
    }

    const title = String(item?.title || '').toLowerCase();
    const score =
      (startDate ? 5 : 0) +
      (dateRaw && timeRaw ? 3 : 0) +
      (durationMin ? 1 : 0) +
      (keys.length ? 1 : 0) +
      (title.includes('appointment') || title.includes('booking') || title.includes('consultation') ? 1 : 0);

    candidates.push({
      score,
      itemTitle: item?.title || null,
      startDate,
      startSource,
      usedParts,
      durationMin,
      durationRaw,
      tz: tz || null,
      keysPreview: keys.slice(0, 20),
    });
  }

  candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { best: candidates[0] || null, candidates };
}

function isSubscriptionProduct(product) {
  const tags = (product.tags || '').toLowerCase();
  return tags.includes('subscription-monthly') || tags.includes('subscription');
}

const SHOPIFY_CONFIG = {
  shopDomain: process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  apiVersion: process.env.SHOPIFY_API_VERSION || '2024-01'
};

if (!SHOPIFY_CONFIG.shopDomain) {
  console.warn('⚠️ [SHOPIFY CONFIG] SHOPIFY_STORE or SHOPIFY_STORE_DOMAIN is not set');
}
if (!SHOPIFY_CONFIG.accessToken) {
  console.warn('⚠️ [SHOPIFY CONFIG] SHOPIFY_ACCESS_TOKEN is not set - product tag detection will fail');
} else {
  const tokenPreview = SHOPIFY_CONFIG.accessToken.length > 10
    ? `${SHOPIFY_CONFIG.accessToken.substring(0, 8)}...${SHOPIFY_CONFIG.accessToken.substring(SHOPIFY_CONFIG.accessToken.length - 4)}`
    : 'INVALID';
  console.log(`✅ [SHOPIFY CONFIG] Access token configured: ${tokenPreview} (length: ${SHOPIFY_CONFIG.accessToken.length})`);
  console.log(`✅ [SHOPIFY CONFIG] Shop domain: ${SHOPIFY_CONFIG.shopDomain || 'NOT SET'}`);
}

async function makeShopifyAdminRequest(endpoint, method = 'GET', data = null) {
  try {
    if (!SHOPIFY_CONFIG.shopDomain) {
      throw new Error('SHOPIFY_STORE or SHOPIFY_STORE_DOMAIN is not configured');
    }
    if (!SHOPIFY_CONFIG.accessToken) {
      throw new Error('SHOPIFY_ACCESS_TOKEN is not configured');
    }

    const url = `https://${SHOPIFY_CONFIG.shopDomain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/${endpoint}`;
    const config = {
      method,
      url,
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    const errorDetails = {
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.response?.data?.errors || error.message,
      url: error.config?.url
    };

    if (error.response?.status === 401) {
      console.error('❌ [SHOPIFY API] Authentication failed (401) - Check SHOPIFY_ACCESS_TOKEN in .env file');
      console.error('   Token preview:', SHOPIFY_CONFIG.accessToken ? `${SHOPIFY_CONFIG.accessToken.substring(0, 8)}...${SHOPIFY_CONFIG.accessToken.substring(SHOPIFY_CONFIG.accessToken.length - 4)}` : 'NOT SET');
      console.error('   Shop domain:', SHOPIFY_CONFIG.shopDomain || 'NOT SET');
    } else {
      console.error('❌ [SHOPIFY API] Request failed:', errorDetails);
    }
    throw error;
  }
}

function getNextBillingDate(frequency) {
  const now = new Date();
  const d = new Date(now);
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (frequency === 'yearly' || frequency === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  extractCustomerIdFromOrder,
  safeTrim,
  parseFullName,
  extractContactFromLineItemProperties,
  normalizePropKey,
  buildLineItemPropsMap,
  parseDurationMinutes,
  parseAppointmentDateTime,
  extractAppointmentBookingMeta,
  isSubscriptionProduct,
  SHOPIFY_CONFIG,
  makeShopifyAdminRequest,
  getNextBillingDate
};
