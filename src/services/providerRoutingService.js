// backend/src/services/providerRoutingService.js
// Minimal provider routing and policy evaluation service.
// Decides provider/practice assignment based on state and product/treatment keywords.

function normalizeState(input) {
  if (!input) return '';
  const s = String(input).trim().toUpperCase();
  // map state names to abbreviations if needed (minimal examples)
  const map = { CALIFORNIA: 'CA', TEXAS: 'TX' };
  return map[s] || s;
}

function extractKeywords(treatment) {
  const txt = typeof treatment === 'string'
    ? treatment
    : JSON.stringify(treatment || {});
  return txt.toLowerCase();
}

// Evaluate questionnaire answers and treatment for red flags and restrictions
function evaluate(questionnaire = {}, treatment = {}, stateInput) {
  const state = normalizeState(stateInput);
  const txt = extractKeywords(treatment);

  const redFlags = [];
  // trivial heuristics (replace with real clinical rules later)
  if (/chest pain|faint|unconscious|suicid|homicid/i.test(JSON.stringify(questionnaire))) {
    redFlags.push('Serious symptom detected');
  }

  const restrictions = [];
  // Example policy: ketamine not available in CA
  if (state === 'CA' && /ketamine/i.test(txt)) {
    restrictions.push('Ketamine not available in CA');
  }

  const requiresConsult = redFlags.length > 0;
  const restricted = restrictions.length > 0;

  return { state, redFlags, restrictions, requiresConsult, restricted };
}

// Select provider and practice based on state
function selectProvider({ stateInput, preferredPracticeId }) {
  const state = normalizeState(stateInput);
  const defaultPracticeId = process.env.TEBRA_PRACTICE_ID || preferredPracticeId || null;

  // Simple mapping: allow overriding per-state via env JSON (e.g., {"CA":"123","TX":"456"})
  let practiceMap = {};
  try {
    practiceMap = JSON.parse(process.env.TEBRA_PRACTICE_MAP_JSON || '{}');
  } catch {}

  const practiceId = practiceMap[state] || defaultPracticeId;

  // Optional provider email map reused by notifications/scheduling
  let providerMap = {};
  try {
    providerMap = JSON.parse(process.env.GOOGLE_PROVIDER_MAP_JSON || process.env.ZOOM_PROVIDER_MAP_JSON || '{}');
  } catch {}

  const providerContact = providerMap[state] || process.env.PROVIDER_ALERT_EMAIL || null;

  return { state, practiceId, providerContact };
}

module.exports = { evaluate, selectProvider };
