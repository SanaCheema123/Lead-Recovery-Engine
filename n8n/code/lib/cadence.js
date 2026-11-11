// ---------------------------------------------------------------------------
// cadence.js — multi-touch reactivation cadence
//
// campaign.steps = [{ day: 0, channel: 'sms', template: '...' }, { day: 2, ... }]
// "day" is relative to enrollment. Jitter spreads sends to avoid carrier
// filtering bursts and to look less robotic.
// ---------------------------------------------------------------------------

/* global renderTemplate, streetOnly, hashSeed */

function pickChannel(step, lead) {
  const pref = step.channel || 'sms';
  if (pref === 'sms' && lead.phone_e164) return 'sms';
  if (pref === 'email' && lead.email) return 'email';
  if (step.fallback_channel === 'sms' && lead.phone_e164) return 'sms';
  if (step.fallback_channel === 'email' && lead.email) return 'email';
  return null;
}

function computeNextTouch(steps, currentIndex, enrolledAt, seed, now) {
  const nextIndex = currentIndex + 1;
  if (!steps || nextIndex >= steps.length) return null;
  const base = new Date(enrolledAt).getTime();
  const jitterMin = (hashSeed(String(seed) + ':' + nextIndex) % 90) - 45; // ±45 min
  let due = new Date(base + steps[nextIndex].day * 86400000 + jitterMin * 60000);
  const floor = now ? new Date(new Date(now).getTime() + 6 * 3600000) : null; // never closer than 6h
  if (floor && due < floor) due = floor;
  return { step_index: nextIndex, due_at: due.toISOString() };
}

function buildTemplateVars(lead, client) {
  const persona = ((client && client.settings) || {}).persona || {};
  return {
    first_name: lead.first_name,
    last_name: lead.last_name,
    property_address: lead.property_address,
    property_street: streetOnly(lead.property_address),
    property_city: lead.property_city,
    property_state: lead.property_state,
    agent_name: persona.agent_name,
    company_name: persona.company_name,
    rep_name: persona.rep_name,
    market_area: persona.market_area,
  };
}

function renderTouch(step, lead, client) {
  const vars = buildTemplateVars(lead, client);
  const channel = pickChannel(step, lead);
  if (!channel) return { skip: true, reason: 'no_channel_available' };
  const tpl = channel === 'email' ? (step.email_body || step.template) : (step.sms || step.template);
  return {
    skip: false,
    channel,
    body: renderTemplate(tpl, vars, lead.id + ':' + (step.key || '')),
    subject: channel === 'email' ? renderTemplate(step.email_subject || 'Quick question', vars, lead.id) : null,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pickChannel, computeNextTouch, renderTouch, buildTemplateVars };
}
