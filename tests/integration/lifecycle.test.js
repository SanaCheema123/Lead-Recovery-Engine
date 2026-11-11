// ---------------------------------------------------------------------------
// End-to-end lifecycle test against a real Postgres, using the EXACT SQL and
// JS logic embedded in the generated n8n workflows (no mocks of our own code).
// External APIs (Twilio/OpenAI/CRM) are simulated by feeding their outputs.
//
//   DATABASE_URL=postgres://... node --test tests/integration/*.test.js
// Requires: migrations applied, `npm run sync:config`, demo CSV imported.
// Everything runs in a transaction and is rolled back.
// ---------------------------------------------------------------------------
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const L = require('../../n8n/code/lib/index.js').loadLibs();

const WF_DIR = path.join(__dirname, '..', '..', 'n8n', 'workflows');
const workflows = fs.readdirSync(WF_DIR).filter((f) => /^\d.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(WF_DIR, f))));
function sql(wfPrefix, nodeName) {
  const wf = workflows.find((w) => w.name.startsWith(`LRE ${wfPrefix}`));
  const n = wf.nodes.find((x) => x.name === nodeName);
  if (!n) throw new Error(`node not found: ${wfPrefix} ${nodeName}`);
  return n.parameters.query;
}

const skip = !process.env.DATABASE_URL;

test('full lead lifecycle', { skip }, async (t) => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query('begin');
  try {
    const { rows: [client] } = await db.query("select * from clients where slug = 'demo-investor'");
    assert.ok(client, 'demo client must be synced');
    await db.query("update campaigns set status = 'active' where client_id = $1", [client.id]);

    await t.test('02 launcher enrolls stale leads and queues them', async () => {
      const { rows } = await db.query(sql('02', 'Enroll Eligible Leads'));
      assert.equal(Number(rows[0].enrolled), 6);
      const { rows: q } = await db.query("select count(*) from leads where client_id = $1 and status = 'queued'", [client.id]);
      assert.equal(Number(q[0].count), 6);
    });

    let touches;
    await t.test('10 cadence claims due touches and renders templates', async () => {
      await db.query('update campaign_enrollments set next_touch_at = now() - interval \'1 minute\'');
      ({ rows: touches } = await db.query(sql('10', 'Claim Due Touches')));
      assert.equal(touches.length, 6);
      const john = touches.find((r) => r.lead.first_name === 'John');
      const r = L.renderTouch(john.campaign.steps[0], john.lead, john.client);
      assert.equal(r.channel, 'sms');
      assert.match(r.body, /John/);
      assert.match(r.body, /4512 Oak Lawn Ave/);
      assert.match(r.body, /Lone Star Home Buyers/);
      // claimed rows are locked: a second runner gets nothing
      const { rows: again } = await db.query(sql('10', 'Claim Due Touches'));
      assert.equal(again.length, 0);
    });

    const john = () => touches.find((r) => r.lead.first_name === 'John').lead;

    await t.test('03 sender logs outbound and marks lead contacted', async () => {
      const { rows } = await db.query(sql('03', 'Log Outbound Message'),
        [john().id, client.id, 'sms', 'Hi John ... Reply STOP to opt out.', '', 'campaign', 'SMtest001', 'queued', john().phone_e164, '', '0']);
      assert.ok(rows[0].message_id);
      const { rows: l } = await db.query('select status, attempt_count from leads where id = $1', [john().id]);
      assert.equal(l[0].status, 'contacted');
      assert.equal(l[0].attempt_count, 1);
    });

    let inbound;
    await t.test('04 inbound SMS resolves lead, dedupes, stops cadence', async () => {
      const q = sql('04', 'Store Inbound & Resolve Lead');
      ({ rows: [inbound] } = await db.query(q, [john().phone_e164, '+15555550100', 'Yeah maybe, my mom passed and the house needs work', 'SMin001']));
      assert.equal(inbound.lead_id, john().id);
      assert.ok(inbound.message_id);
      const { rows: [dupe] } = await db.query(q, [john().phone_e164, '+15555550100', 'dup', 'SMin001']);
      assert.equal(dupe.message_id, null, 'duplicate Twilio webhook must be ignored');
      const { rows: e } = await db.query('select status, stopped_reason from campaign_enrollments where lead_id = $1', [john().id]);
      assert.equal(e[0].status, 'stopped');
      assert.equal(e[0].stopped_reason, 'lead_replied');
      assert.equal(L.classifyInbound('Yeah maybe, my mom passed and the house needs work').route, 'ai');
    });

    await t.test('06 AI turn: context → processTurn → save qualification & status', async () => {
      const { rows: [ctx] } = await db.query(sql('06', 'Load Conversation Context'), [john().id]);
      assert.equal(ctx.latest_inbound_id, inbound.message_id);
      assert.equal(ctx.messages.length, 2);
      const fakeModelTurn = {
        reply: "I'm sorry about your mom. No pressure at all — roughly when would you want to have it sold?",
        intent: 'maybe', sentiment: 'neutral', next_action: 'continue_conversation', selected_slot_iso: null,
        followup_date: null, handoff_reason: null, confidence: 0.86,
        extracted: { is_owner: true, interested_in_selling: 'maybe', timeline: null, motivation_level: 'medium',
          motivation_reasons: ['inherited', 'needs_repairs'], property_condition: 'needs_some_repairs', occupancy: null,
          price_flexibility: null, asking_price: null, is_decision_maker: null, property_type: 'single_family', bedrooms: null,
          bathrooms: null, best_contact_time: null, notes: null, conversation_summary: 'Inherited from mother; needs work; open to selling.' },
      };
      const decision = L.processTurn(fakeModelTurn, { client: ctx.client, lead: ctx.lead, qualification: ctx.qualification || {}, slots: [], channel: 'sms' });
      assert.equal(decision.status, 'qualifying');
      const { rows: [saved] } = await db.query(sql('06', 'Save AI Turn'),
        [john().id, JSON.stringify(decision), JSON.stringify(fakeModelTurn), JSON.stringify({ model: 'test', prompt_tokens: 900, completion_tokens: 120, latency_ms: 1500 }), 'reply', inbound.message_id]);
      assert.ok(saved.ai_turn_id);
      assert.equal(saved.lead_status, 'qualifying');
      const { rows: [q] } = await db.query('select motivation_reasons, summary from qualifications where lead_id = $1', [john().id]);
      assert.deepEqual(q.motivation_reasons, ['inherited', 'needs_repairs']);
    });

    await t.test('06 second turn qualifies the lead and offers real slots', async () => {
      const { rows: [ctx] } = await db.query(sql('06', 'Load Conversation Context'), [john().id]);
      const slots = L.pickSlots(['2030-01-08T15:00:00Z', '2030-01-08T15:30:00Z', '2030-01-08T20:00:00Z', '2030-01-09T16:00:00Z'], 'America/Chicago', 4);
      assert.equal(slots.length, 3, 'one AM + one PM per day');
      const turn = {
        reply: 'Makes sense. Would Tue 9:00 AM or Tue 2:00 PM work for a quick call with Mike?', intent: 'interested', sentiment: 'positive',
        next_action: 'offer_appointment', selected_slot_iso: null, followup_date: null, handoff_reason: null, confidence: 0.9,
        extracted: { ...Object.fromEntries(Object.keys(ctx.qualification).map((k) => [k, null])), motivation_reasons: [],
          interested_in_selling: 'yes', timeline: '0_3_months', motivation_level: 'high', is_decision_maker: true, notes: null, conversation_summary: null },
      };
      const d = L.processTurn(turn, { client: ctx.client, lead: ctx.lead, qualification: ctx.qualification, slots, channel: 'sms' });
      assert.equal(d.action, 'offer_appointment');
      assert.equal(d.qualified, true);
      assert.equal(d.status, 'qualified');
      await db.query(sql('06', 'Save AI Turn'), [john().id, JSON.stringify(d), JSON.stringify(turn), '{}', 'reply', '']);
      const { rows: [l] } = await db.query('select status, score, temperature from leads where id = $1', [john().id]);
      assert.equal(l.status, 'qualified');
      assert.ok(l.score >= 70, `score ${l.score}`);
      assert.equal(l.temperature, 'hot');
    });

    await t.test('09 hot alert does not pause AI; handoff does; alert de-dupes', async () => {
      const q = sql('09', 'Apply Handoff & Load Summary');
      const { rows: [a] } = await db.query(q, [john().id, 'hot_alert', 'Hot lead']);
      assert.equal(Number(a.prior_hot_alerts_24h), 0);
      const { rows: [b] } = await db.query(q, [john().id, 'hot_alert', 'Hot lead']);
      assert.equal(Number(b.prior_hot_alerts_24h), 1, 'second hot alert within 24h is suppressed by Compose Notification');
      const { rows: [l] } = await db.query('select ai_paused from leads where id = $1', [john().id]);
      assert.equal(l.ai_paused, false);
    });

    await t.test('08 booking saves appointment, pauses AI, reminders are claimed once', async () => {
      const start = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const end = new Date(Date.now() + 24.25 * 3600 * 1000).toISOString();
      const { rows: [r] } = await db.query(sql('08', 'Save Appointment'), [john().id, client.id, 'ghl', 'evt_123', start, end]);
      assert.ok(r.appointment_id);
      const { rows: [l] } = await db.query('select status, ai_paused from leads where id = $1', [john().id]);
      assert.equal(l.status, 'appointment_booked');
      assert.equal(l.ai_paused, true);
      assert.equal(L.aiShouldRespond(l.status, l.ai_paused), false);
      const { rows: due } = await db.query(sql('08', 'Claim Due Reminders'));
      assert.equal(due.length, 1);
      assert.equal(due[0].kind, '24h');
      const { rows: due2 } = await db.query(sql('08', 'Claim Due Reminders'));
      assert.equal(due2.length, 0, 'reminder must not be sent twice');
    });

    await t.test('04 STOP opts out, stops cadence, and suppression cannot be bypassed', async () => {
      const maria = touches.find((r) => r.lead.first_name === 'Maria').lead;
      const { rows: [o] } = await db.query(sql('04', 'Apply SMS Opt-Out'), [maria.phone_e164, 'keyword', client.id]);
      assert.equal(o.lead_id, maria.id);
      const { rows: [l] } = await db.query('select status, opted_out from leads where id = $1', [maria.id]);
      assert.equal(l.status, 'dnc');
      const { rows: [e] } = await db.query('select status from campaign_enrollments where lead_id = $1', [maria.id]);
      assert.equal(e.status, 'stopped');
      // Any later attempt (bug, human, re-import) to reactivate is blocked by the DB trigger:
      await db.query("update leads set status = 'engaged', opted_out = false where id = $1", [maria.id]);
      const { rows: [l2] } = await db.query('select status, opted_out from leads where id = $1', [maria.id]);
      assert.equal(l2.status, 'dnc');
      assert.equal(l2.opted_out, true);
      // Sender gate refuses too:
      assert.equal(L.checkSendAllowed({ lead: l2, client, channel: 'sms', purpose: 'campaign' }).allowed, false);
    });

    await t.test('13 carrier error 21211 marks bad number', async () => {
      const derrick = touches.find((r) => r.lead.first_name === 'Derrick').lead;
      await db.query(sql('03', 'Log Outbound Message'), [derrick.id, client.id, 'sms', 'hi', '', 'campaign', 'SMbad01', 'queued', derrick.phone_e164, '', '0']);
      await db.query(sql('13', 'Update SMS Status'), ['SMbad01', 'undelivered', '21211']);
      const { rows: [l] } = await db.query('select status from leads where id = $1', [derrick.id]);
      assert.equal(l.status, 'bad_number');
    });

    await t.test('reporting views return data', async () => {
      const { rows: f } = await db.query('select * from v_funnel where client_id = $1', [client.id]);
      assert.equal(Number(f[0].booked), 1);
      assert.equal(Number(f[0].dnc), 1);
      const { rows: k } = await db.query("select * from v_daily_kpis where client_id = $1 and day = current_date", [client.id]);
      assert.equal(Number(k[0].appointments_booked), 1);
      assert.equal(Number(k[0].opt_outs), 1);
    });
  } finally {
    await db.query('rollback');
    await db.end();
  }
});
