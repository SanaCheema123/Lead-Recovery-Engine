// ---------------------------------------------------------------------------
// compliance.js — opt-out detection, quiet hours, send gating
//
// IMPORTANT: These rules are conservative engineering defaults, NOT legal
// advice. TCPA / state "mini-TCPA" rules change. Have counsel review
// config/compliance.yaml before any live campaign. See docs/06-compliance.md.
// ---------------------------------------------------------------------------

const OPT_OUT_KEYWORDS = [
  'STOP', 'STOPALL', 'STOP ALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT',
  'REVOKE', 'OPTOUT', 'OPT OUT', 'OPT-OUT', 'REMOVE', 'REMOVE ME',
];

const OPT_IN_KEYWORDS = ['START', 'UNSTOP', 'SUBSCRIBE'];

const OPT_OUT_PATTERNS = [
  /\b(remove|delete|take)\s+(me|my\s+(number|name|info|information))\b/i,
  /\b(don'?t|do not|stop|quit|never)\s+(text|txt|texting|message|messaging|contact|contacting|call|calling|email|emailing)\b/i,
  /\blose\s+(my|this)\s+number\b/i,
  /\bunsubscribe\b/i,
  /\b(take|put)\s+me\s+off\b/i,
  /\bleave\s+me\s+alone\b/i,
  /\bdo\s*not\s*contact\b/i,
];

const WRONG_NUMBER_PATTERNS = [
  /\bwrong\s+(number|person|#)\b/i,
  /\bno\s+one\s+(here\s+)?by\s+that\s+name\b/i,
  /\bwho\s+is\s+this\s+for\b/i,
];

const NOT_OWNER_PATTERNS = [
  /\b(don'?t|do not|never)\s+(own|owned)\b/i,
  /\bnot\s+(the|my)\s+(house|home|property)\b/i,
  /\b(already\s+)?sold\s+(it|that|the\s+(house|home|property))\b/i,
  /\bi\s+rent\b/i,
];

const HOSTILE_PATTERNS = [
  /\bf+u+c+k+/i, /\bscam+(mer)?s?\b/i, /\bharass/i, /\blawyer\b/i, /\battorney\b/i,
  /\bsue\b/i, /\breport(ing)?\s+you\b/i, /\bpolice\b/i, /\bcease\s+and\s+desist\b/i,
];

function _clean(text) {
  return String(text || '').trim();
}

function detectOptOut(text) {
  const t = _clean(text);
  const keyword = t.toUpperCase().replace(/[^A-Z\- ]/g, '').replace(/\s+/g, ' ').trim();
  if (OPT_OUT_KEYWORDS.includes(keyword)) return { optOut: true, reason: 'keyword', keyword };
  for (const re of OPT_OUT_PATTERNS) {
    if (re.test(t)) return { optOut: true, reason: 'natural_language', pattern: String(re) };
  }
  return { optOut: false };
}

function detectOptIn(text) {
  const keyword = _clean(text).toUpperCase().replace(/[^A-Z]/g, '');
  return OPT_IN_KEYWORDS.includes(keyword);
}

function detectWrongNumber(text) {
  const t = _clean(text);
  return {
    wrongNumber: WRONG_NUMBER_PATTERNS.some((re) => re.test(t)),
    notOwner: NOT_OWNER_PATTERNS.some((re) => re.test(t)),
  };
}

function detectHostile(text) {
  const t = _clean(text);
  return HOSTILE_PATTERNS.some((re) => re.test(t));
}

/**
 * Classify an inbound message BEFORE it reaches the AI. Deterministic rules
 * always win over the model for opt-outs.
 */
function classifyInbound(text) {
  const opt = detectOptOut(text);
  if (opt.optOut) return { route: 'opt_out', detail: opt };
  if (detectOptIn(text)) return { route: 'opt_in' };
  if (detectHostile(text)) return { route: 'hostile' };
  return { route: 'ai' };
}

// --- Time zones -------------------------------------------------------------

const STATE_TZ = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver', PR: 'America/Puerto_Rico',
};

// Stricter state windows / frequency limits (engineering defaults — verify with counsel).
const DEFAULT_STATE_RULES = {
  FL: { start_hour: 8, end_hour: 20, max_per_24h: 3 },
  OK: { start_hour: 8, end_hour: 20, max_per_24h: 3 },
  MD: { start_hour: 8, end_hour: 20, max_per_24h: 3 },
  WA: { start_hour: 8, end_hour: 20 },
};

function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const p = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0;
  return {
    year: +p.year, month: +p.month, day: +p.day, hour, minute: +p.minute,
    weekday: p.weekday, ymd: `${p.year}-${p.month}-${p.day}`,
  };
}

/** All time zones the recipient might plausibly be in. We must be inside the window in ALL of them. */
function timezonesFor(lead, client) {
  const zones = [];
  if (lead && lead.timezone) zones.push(lead.timezone);
  if (lead && lead.property_state && STATE_TZ[String(lead.property_state).toUpperCase()]) {
    zones.push(STATE_TZ[String(lead.property_state).toUpperCase()]);
  }
  if (client && client.timezone) zones.push(client.timezone);
  if (!zones.length) zones.push('America/New_York');
  return Array.from(new Set(zones));
}

function effectiveWindow(rules, state, stateRules) {
  const r = rules || {};
  const sr = (stateRules || DEFAULT_STATE_RULES)[String(state || '').toUpperCase()] || {};
  return {
    start_hour: Math.max(r.start_hour != null ? r.start_hour : 9, sr.start_hour != null ? sr.start_hour : 0),
    end_hour: Math.min(r.end_hour != null ? r.end_hour : 20, sr.end_hour != null ? sr.end_hour : 24),
    allow_sunday: r.allow_sunday === true,
    holidays: r.holidays || [],
    max_per_24h: sr.max_per_24h != null ? sr.max_per_24h : (r.max_per_24h != null ? r.max_per_24h : null),
  };
}

function isWithinWindow(date, zones, win) {
  return zones.every((tz) => {
    const p = localParts(date, tz);
    if (p.hour < win.start_hour || p.hour >= win.end_hour) return false;
    if (!win.allow_sunday && p.weekday === 'Sun') return false;
    if (win.holidays.includes(p.ymd)) return false;
    return true;
  });
}

function nextAllowedSendTime(date, zones, win) {
  const step = 15 * 60 * 1000;
  let t = new Date(Math.ceil(date.getTime() / step) * step);
  for (let i = 0; i < 96 * 10; i++) {
    if (isWithinWindow(t, zones, win)) return t;
    t = new Date(t.getTime() + step);
  }
  return null;
}

/**
 * Central send gate. Every outbound message goes through this.
 * ctx = { now, lead, client, channel, purpose, sent_last_24h, client_sent_today, is_first_touch }
 */
function checkSendAllowed(ctx) {
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const lead = ctx.lead || {};
  const client = ctx.client || {};
  const settings = client.settings || {};
  const messaging = settings.messaging || {};
  const purpose = ctx.purpose || 'conversation';
  const channel = ctx.channel || 'sms';

  // Opt-out confirmation is the single message allowed after an opt-out.
  if (purpose === 'opt_out_confirmation') {
    return ctx.opt_out_confirmation_already_sent
      ? { allowed: false, reason: 'opt_out_confirmation_already_sent' }
      : { allowed: true, reason: 'opt_out_confirmation' };
  }
  if (lead.opted_out || lead.status === 'dnc') return { allowed: false, reason: 'opted_out' };
  if (['wrong_number', 'bad_number'].includes(lead.status)) return { allowed: false, reason: 'lead_status_' + lead.status };
  if (channel === 'sms' && !lead.phone_e164) return { allowed: false, reason: 'no_phone' };
  if (channel === 'email' && !lead.email) return { allowed: false, reason: 'no_email' };

  const cap = messaging.daily_send_cap;
  if (cap && ctx.client_sent_today >= cap && purpose === 'campaign') {
    const zones = timezonesFor(lead, client);
    const tomorrow = new Date(now.getTime() + 12 * 3600 * 1000);
    const win = effectiveWindow(messaging.quiet_hours, lead.property_state, settings.state_rules);
    return { allowed: false, reason: 'client_daily_cap', deferred_until: nextAllowedSendTime(tomorrow, zones, win) };
  }

  // Email is not subject to TCPA quiet hours, but we still respect the window for campaign mail.
  const zones = timezonesFor(lead, client);
  const win = effectiveWindow(messaging.quiet_hours, lead.property_state, settings.state_rules);

  if (channel === 'sms' && win.max_per_24h != null && purpose === 'campaign' && ctx.sent_last_24h >= win.max_per_24h) {
    return { allowed: false, reason: 'state_frequency_limit', deferred_until: new Date(now.getTime() + 24 * 3600 * 1000) };
  }

  // Replies to a message the lead just sent are still held to quiet hours
  // (conservative). Configure messaging.reply_outside_window=true only on counsel's advice.
  const enforceWindow = !(purpose === 'conversation' && messaging.reply_outside_window === true);
  if (enforceWindow && !isWithinWindow(now, zones, win)) {
    return { allowed: false, reason: 'quiet_hours', deferred_until: nextAllowedSendTime(now, zones, win) };
  }
  return { allowed: true, reason: 'ok', append_opt_out_notice: channel === 'sms' && !!ctx.is_first_touch };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectOptOut, detectOptIn, detectWrongNumber, detectHostile, classifyInbound,
    STATE_TZ, DEFAULT_STATE_RULES, localParts, timezonesFor, effectiveWindow,
    isWithinWindow, nextAllowedSendTime, checkSendAllowed,
  };
}
