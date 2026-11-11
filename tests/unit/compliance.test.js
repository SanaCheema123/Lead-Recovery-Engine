const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../n8n/code/lib/index.js').loadLibs();

test('keyword opt-outs are detected', () => {
  for (const w of ['STOP', 'stop', 'Stop.', 'UNSUBSCRIBE', 'cancel', 'Quit', 'stop all', 'opt out']) {
    assert.equal(L.detectOptOut(w).optOut, true, w);
  }
});

test('natural-language opt-outs are detected', () => {
  for (const t of [
    'Please remove me from your list',
    "don't text me again",
    'Do not contact me',
    'lose my number',
    'take me off this list',
    'leave me alone',
  ]) {
    assert.equal(L.detectOptOut(t).optOut, true, t);
  }
});

test('normal replies are not opt-outs', () => {
  for (const t of ['Yes still interested', 'Maybe, what would you offer?', "I can't stop thinking about selling", 'Who is this?']) {
    assert.equal(L.detectOptOut(t).optOut, false, t);
  }
});

test('START is an opt-in', () => {
  assert.equal(L.detectOptIn('start'), true);
  assert.equal(L.detectOptIn('start talking'), false);
});

test('wrong number / not owner detection', () => {
  assert.equal(L.detectWrongNumber('wrong number').wrongNumber, true);
  assert.equal(L.detectWrongNumber('I sold the house in 2019').notOwner, true);
  assert.equal(L.detectWrongNumber('yes I own it').notOwner, false);
});

test('hostile messages route to hostile', () => {
  assert.equal(L.classifyInbound('this is a scam, I will call my attorney').route, 'hostile');
  assert.equal(L.classifyInbound('STOP').route, 'opt_out');
  assert.equal(L.classifyInbound('sure what is your offer').route, 'ai');
});

test('quiet hours: blocked at 7am Central, allowed at 11am Central', () => {
  const lead = { property_state: 'TX', phone_e164: '+12145550123', status: 'queued' };
  const client = { timezone: 'America/Chicago', settings: { messaging: { quiet_hours: { start_hour: 9, end_hour: 20 } } } };
  // 2026-11-10 is a Tuesday. 13:00Z = 07:00 CST
  const early = L.checkSendAllowed({ now: '2026-11-10T13:00:00Z', lead, client, channel: 'sms', purpose: 'campaign' });
  assert.equal(early.allowed, false);
  assert.equal(early.reason, 'quiet_hours');
  assert.ok(early.deferred_until);
  assert.equal(new Date(early.deferred_until).toISOString(), '2026-11-10T15:00:00.000Z'); // 9:00 CST
  const ok = L.checkSendAllowed({ now: '2026-11-10T17:00:00Z', lead, client, channel: 'sms', purpose: 'campaign' });
  assert.equal(ok.allowed, true);
});

test('quiet hours use intersection of lead + client time zones', () => {
  // Property in CA (Pacific), client in New York. 16:30Z = 8:30 PT / 11:30 ET -> blocked (too early in PT)
  const lead = { property_state: 'CA', phone_e164: '+14155550123', status: 'queued' };
  const client = { timezone: 'America/New_York', settings: { messaging: { quiet_hours: { start_hour: 9, end_hour: 20 } } } };
  const r = L.checkSendAllowed({ now: '2026-11-10T16:30:00Z', lead, client, channel: 'sms', purpose: 'campaign' });
  assert.equal(r.allowed, false);
});

test('Sunday sends blocked unless allowed', () => {
  const lead = { property_state: 'TX', phone_e164: '+12145550123', status: 'queued' };
  const client = { timezone: 'America/Chicago', settings: { messaging: { quiet_hours: { start_hour: 9, end_hour: 20 } } } };
  const sunday = '2026-11-08T18:00:00Z'; // Sunday noon CST
  assert.equal(L.checkSendAllowed({ now: sunday, lead, client, channel: 'sms', purpose: 'campaign' }).allowed, false);
  client.settings.messaging.quiet_hours.allow_sunday = true;
  assert.equal(L.checkSendAllowed({ now: sunday, lead, client, channel: 'sms', purpose: 'campaign' }).allowed, true);
});

test('Florida per-24h frequency cap applies to campaign SMS', () => {
  const lead = { property_state: 'FL', phone_e164: '+13055550123', status: 'contacted' };
  const client = { timezone: 'America/New_York', settings: { messaging: {} } };
  const r = L.checkSendAllowed({ now: '2026-11-10T16:00:00Z', lead, client, channel: 'sms', purpose: 'campaign', sent_last_24h: 3 });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'state_frequency_limit');
});

test('opted-out leads are never messaged, except one opt-out confirmation', () => {
  const lead = { opted_out: true, status: 'dnc', phone_e164: '+12145550123' };
  const client = { timezone: 'America/Chicago', settings: {} };
  assert.equal(L.checkSendAllowed({ lead, client, channel: 'sms', purpose: 'conversation' }).allowed, false);
  assert.equal(L.checkSendAllowed({ lead, client, channel: 'sms', purpose: 'opt_out_confirmation' }).allowed, true);
  assert.equal(
    L.checkSendAllowed({ lead, client, channel: 'sms', purpose: 'opt_out_confirmation', opt_out_confirmation_already_sent: true }).allowed,
    false,
  );
});

test('phone normalization', () => {
  assert.equal(L.normalizeUSPhone('(214) 555-0123'), '+12145550123');
  assert.equal(L.normalizeUSPhone('1-214-555-0123'), '+12145550123');
  assert.equal(L.normalizeUSPhone('214-555-012'), null);
  assert.equal(L.normalizeUSPhone('011-555-0123'), null);
  assert.equal(L.normalizeUSPhone('911-555-0123'), null);
});
