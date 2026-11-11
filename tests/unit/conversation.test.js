const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../../n8n/code/lib/index.js').loadLibs();

const ROOT = path.join(__dirname, '..', '..');
const systemTemplate = fs.readFileSync(path.join(ROOT, 'prompts/conversation_agent.system.md'), 'utf8');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/schemas/conversation_turn.schema.json'), 'utf8'));

const client = {
  timezone: 'America/Chicago',
  settings: {
    persona: { agent_name: 'Sarah', company_name: 'Demo Home Buyers', market_area: 'DFW', rep_name: 'Mike' },
    calendar: { appointment_type: 'quick phone call' },
    qualification: { hot_threshold: 70, warm_threshold: 40 },
  },
};
const lead = { id: 'lead-1', first_name: 'John', property_address: '123 Oak St, Dallas, TX', property_state: 'TX', status: 'contacted' };

test('templating renders vars, fallbacks and deterministic spintax', () => {
  const t = '{Hi|Hey} {{first_name|there}}, about {{property_street|your property}}?';
  const a = L.renderTemplate(t, { first_name: 'John', property_street: '123 Oak St' }, 'lead-1');
  const b = L.renderTemplate(t, { first_name: 'John', property_street: '123 Oak St' }, 'lead-1');
  assert.equal(a, b);
  assert.match(a, /^(Hi|Hey) John, about 123 Oak St\?$/);
  assert.equal(L.renderTemplate('Hi {{first_name|there}}!', {}, 's'), 'Hi there!');
});

test('system prompt has no unrendered placeholders after rendering', () => {
  const req = L.buildChatRequest({ systemTemplate, schema, model: 'test-model', ctx: { client, lead, messages: [], now: '2026-11-10T17:00:00Z' } });
  assert.doesNotMatch(req.messages[0].content, /\{\{/);
  assert.match(req.messages[0].content, /Sarah/);
  assert.equal(req.response_format.json_schema.strict, true);
});

test('history maps inbound->user, outbound->assistant', () => {
  const req = L.buildChatRequest({
    systemTemplate, schema, model: 'm',
    ctx: { client, lead, messages: [{ direction: 'outbound', body: 'Hi John' }, { direction: 'inbound', body: 'who is this' }] },
  });
  const roles = req.messages.slice(2).map((m) => m.role);
  assert.deepEqual(JSON.parse(JSON.stringify(roles)), ['assistant', 'user']);
});

test('guardrails block price quotes and human impersonation', () => {
  assert.equal(L.validateReply('We can pay $150,000 cash', { channel: 'sms' }).fatal, true);
  assert.equal(L.validateReply("Yes I'm a real person", { channel: 'sms' }).fatal, true);
  assert.equal(L.validateReply('Totally understand. What timeline works for you?', { channel: 'sms' }).ok, true);
  const long = 'Sentence one is here. '.repeat(30);
  const v = L.validateReply(long, { channel: 'sms' });
  assert.ok(v.text.length <= 320);
  assert.ok(v.issues.includes('too_long_truncated'));
});

function turn(overrides) {
  return Object.assign({
    reply: 'Got it. How soon are you hoping to sell?',
    intent: 'interested', sentiment: 'neutral', next_action: 'continue_conversation',
    selected_slot_iso: null, followup_date: null, handoff_reason: null, confidence: 0.9,
    extracted: {
      is_owner: null, interested_in_selling: null, timeline: null, motivation_level: null, motivation_reasons: [],
      property_condition: null, occupancy: null, price_flexibility: null, asking_price: null, is_decision_maker: null,
      property_type: null, bedrooms: null, bathrooms: null, best_contact_time: null, notes: null, conversation_summary: null,
    },
  }, overrides);
}

test('processTurn merges facts and advances status', () => {
  const t = turn({ extracted: Object.assign(turn().extracted, { interested_in_selling: 'yes', motivation_reasons: ['inherited'] }) });
  const r = L.processTurn(t, { client, lead, qualification: {}, slots: [], channel: 'sms' });
  assert.equal(r.qualification.interested_in_selling, 'yes');
  assert.deepEqual(JSON.parse(JSON.stringify(r.qualification.motivation_reasons)), ['inherited']);
  assert.equal(r.status, 'qualifying');
  assert.equal(r.action, 'continue_conversation');
});

test('processTurn rejects booking a slot that was never offered', () => {
  const slots = [{ start_iso: '2026-11-11T15:00:00.000Z', label: 'Wed 9:00 AM' }];
  const r = L.processTurn(turn({ next_action: 'confirm_appointment', selected_slot_iso: '2026-11-12T15:00:00.000Z' }),
    { client, lead, qualification: {}, slots, channel: 'sms' });
  assert.equal(r.action, 'offer_appointment');
  assert.ok(r.issues.includes('confirm_without_valid_slot'));
});

test('processTurn accepts valid booking', () => {
  const slots = [{ start_iso: '2026-11-11T15:00:00.000Z', label: 'Wed 9:00 AM' }];
  const r = L.processTurn(turn({ next_action: 'confirm_appointment', selected_slot_iso: '2026-11-11T15:00:00.000Z', reply: 'Perfect, you are all set.' }),
    { client, lead: Object.assign({}, lead, { status: 'qualified' }), qualification: {}, slots, channel: 'sms' });
  assert.equal(r.action, 'confirm_appointment');
  assert.equal(r.selected_slot_iso, '2026-11-11T15:00:00.000Z');
  assert.equal(r.notify_human, true);
});

test('processTurn escalates to human when guardrails block reply', () => {
  const r = L.processTurn(turn({ reply: 'We guarantee $200k for your house' }), { client, lead, qualification: {}, slots: [], channel: 'sms' });
  assert.equal(r.action, 'handoff_to_human');
  assert.equal(r.reply, '');
  assert.match(r.handoff_reason, /guardrail_blocked_reply/);
});

test('angry sentiment escalates to human', () => {
  const r = L.processTurn(turn({ sentiment: 'angry' }), { client, lead, qualification: {}, slots: [], channel: 'sms' });
  assert.equal(r.action, 'handoff_to_human');
});

test('cadence: next touch computed with jitter and floor', () => {
  const steps = [{ day: 0 }, { day: 2 }, { day: 5 }];
  const n = L.computeNextTouch(steps, 0, '2026-11-10T15:00:00Z', 'lead-1', '2026-11-10T15:00:00Z');
  assert.equal(n.step_index, 1);
  const diffH = (new Date(n.due_at) - new Date('2026-11-10T15:00:00Z')) / 3600000;
  assert.ok(diffH > 47 && diffH < 49, String(diffH));
  assert.equal(L.computeNextTouch(steps, 2, '2026-11-10T15:00:00Z', 'x'), null);
});

test('email parsing strips quoted history', () => {
  const body = 'Yes I might sell next spring.\n\nOn Tue, Nov 10, 2026 Sarah wrote:\n> Hi John';
  assert.equal(L.stripQuotedReply(body), 'Yes I might sell next spring.');
  assert.equal(L.extractReplyToken('Sarah <reply+a1b2c3d4e5f6a7b8c9@reply.example.com>'), 'a1b2c3d4e5f6a7b8c9');
});
