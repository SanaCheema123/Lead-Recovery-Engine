const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../n8n/code/lib/index.js').loadLibs();

test('motivated, fast-timeline decision maker scores hot and qualified', () => {
  const r = L.scoreLead({
    interested_in_selling: 'yes', timeline: '0_3_months', motivation_level: 'high',
    motivation_reasons: ['inherited', 'vacant_property'], property_condition: 'needs_major_repairs',
    price_flexibility: 'open_to_offer', is_decision_maker: true, occupancy: 'vacant',
  });
  assert.equal(r.temperature, 'hot');
  assert.equal(r.qualified, true);
  assert.ok(r.score >= 70 && r.score <= 100);
});

test('not interested scores zero', () => {
  const r = L.scoreLead({ interested_in_selling: 'no', timeline: 'asap', motivation_level: 'high' });
  assert.equal(r.score, 0);
  assert.equal(r.qualified, false);
});

test('long timeline is not qualified', () => {
  const r = L.scoreLead({ interested_in_selling: 'maybe', timeline: '12_plus_months', motivation_level: 'low' });
  assert.equal(r.qualified, false);
  assert.equal(r.temperature, 'cold');
});

test('non-decision-maker blocks qualification by default', () => {
  const q = { interested_in_selling: 'yes', timeline: 'asap', motivation_level: 'high', is_decision_maker: false };
  assert.equal(L.scoreLead(q).qualified, false);
  assert.equal(L.scoreLead(q, { require_decision_maker: false }).qualified, true);
});

test('state machine: dnc is terminal', () => {
  assert.equal(L.nextStatus('dnc', 'continue_conversation', { qualified: true }, true), 'dnc');
});

test('state machine: progression and no backwards moves', () => {
  assert.equal(L.nextStatus('contacted', 'continue_conversation', { qualified: false }, false), 'engaged');
  assert.equal(L.nextStatus('engaged', 'continue_conversation', { qualified: false }, true), 'qualifying');
  assert.equal(L.nextStatus('qualifying', 'continue_conversation', { qualified: true }, true), 'qualified');
  assert.equal(L.nextStatus('qualified', 'continue_conversation', { qualified: false }, true), 'qualified');
  assert.equal(L.nextStatus('engaged', 'schedule_followup', {}, true), 'nurture');
  assert.equal(L.nextStatus('nurture', 'continue_conversation', { qualified: false }, true), 'qualifying');
  assert.equal(L.nextStatus('engaged', 'opt_out', {}, true), 'dnc');
});

test('AI stops responding on terminal/handoff states', () => {
  assert.equal(L.aiShouldRespond('engaged', false), true);
  assert.equal(L.aiShouldRespond('engaged', true), false);
  assert.equal(L.aiShouldRespond('handed_off', false), false);
  assert.equal(L.aiShouldRespond('appointment_booked', false), false);
});
