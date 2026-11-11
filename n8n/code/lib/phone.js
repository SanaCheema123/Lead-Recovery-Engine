// ---------------------------------------------------------------------------
// phone.js — US phone & email normalization
// Shared by n8n Code nodes (inlined at build time) and unit tests.
// ---------------------------------------------------------------------------

/**
 * Normalize a US/NANP phone number to E.164 (+1XXXXXXXXXX).
 * Returns null when the number cannot be a valid NANP number.
 */
function normalizeUSPhone(raw) {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  // NANP: area code and exchange cannot start with 0 or 1
  if (/^[01]/.test(d) || /^\d{3}[01]/.test(d)) return null;
  // N11 area codes (211, 311, 411 ... 911) are service codes, not real numbers
  if (d.slice(1, 3) === '11') return null;
  return '+1' + d;
}

function normalizeEmail(raw) {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

/** "123 Main St, Dallas, TX 75201" -> "123 Main St" */
function streetOnly(address) {
  if (!address) return '';
  return String(address).split(',')[0].trim();
}

const US_STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR',
};

function normalizeState(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return US_STATES[s.toLowerCase()] || null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeUSPhone, normalizeEmail, streetOnly, normalizeState };
}
