#!/usr/bin/env node
// ---------------------------------------------------------------------------
// run-scenarios.js — conversation QA harness against the real OpenAI model,
// using the production prompt, schema, prompt builder and turn processor.
//
//   OPENAI_API_KEY=sk-... [OPENAI_MODEL=...] npm run test:scenarios
//   npm run test:scenarios -- --only price_question_no_number --runs 3
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const L = require('../n8n/code/lib/index.js').loadLibs();

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const systemTemplate = fs.readFileSync(path.join(ROOT, 'prompts/conversation_agent.system.md'), 'utf8');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/schemas/conversation_turn.schema.json'), 'utf8'));
const clientCfg = yaml.load(fs.readFileSync(path.join(ROOT, 'config/clients/demo-client.yaml'), 'utf8'));
const suite = yaml.load(fs.readFileSync(path.join(ROOT, 'tests/scenarios/conversations.yaml'), 'utf8'));

const client = { id: 'demo', name: clientCfg.name, timezone: clientCfg.timezone, settings: clientCfg };
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const toRe = (s) => { const m = s.match(/^\(\?i\)(.*)$/); return m ? new RegExp(m[1], 'i') : new RegExp(s); };

async function runOne(sc) {
  const lead = { id: 'scenario-lead', ...suite.defaults.lead, ...(sc.lead || {}) };
  const messages = [{ direction: 'outbound', body: suite.defaults.opener }];
  for (const h of sc.history || []) messages.push(h.out ? { direction: 'outbound', body: h.out } : { direction: 'inbound', body: h.in });
  messages.push({ direction: 'inbound', body: sc.lead_says });

  // Deterministic pre-AI routing runs first, exactly like workflow 04.
  const pre = L.classifyInbound(sc.lead_says);
  if (pre.route !== 'ai') return { decision: { action: pre.route === 'opt_out' ? 'opt_out' : 'handoff_to_human', reply: '', qualification: {} }, pre: pre.route };

  const req = L.buildChatRequest({ systemTemplate, schema, model, ctx: { client, lead, qualification: {}, messages, slots: sc.slots || [], channel: 'sms' } });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const parsed = L.parseModelOutput(await res.json());
  const decision = L.processTurn(parsed.turn, { client, lead, qualification: {}, slots: sc.slots || [], channel: 'sms' });
  return { decision, raw: parsed.turn, usage: parsed.usage };
}

function check(sc, out) {
  const e = sc.expect || {}; const d = out.decision; const fails = [];
  if (e.action_in && !e.action_in.includes(d.action)) fails.push(`action ${d.action} not in [${e.action_in}]`);
  if (e.action_not_in && e.action_not_in.includes(d.action)) fails.push(`action ${d.action} is forbidden`);
  for (const [k, v] of Object.entries(e.extracted || {})) if ((d.qualification || {})[k] !== v) fails.push(`extracted.${k}=${(d.qualification || {})[k]} expected ${v}`);
  for (const r of e.motivation_reasons_include || []) if (!((d.qualification || {}).motivation_reasons || []).includes(r)) fails.push(`motivation_reasons missing ${r}`);
  if (e.reply_max_chars && (d.reply || '').length > e.reply_max_chars) fails.push(`reply too long (${d.reply.length})`);
  for (const p of e.reply_matches || []) if (!toRe(p).test(d.reply || '')) fails.push(`reply should match ${p}`);
  for (const p of e.reply_not_matches || []) if (toRe(p).test((out.raw && out.raw.reply) || d.reply || '')) fails.push(`raw reply must not match ${p}`);
  if (e.selected_slot_iso && d.selected_slot_iso !== e.selected_slot_iso) fails.push(`slot ${d.selected_slot_iso} expected ${e.selected_slot_iso}`);
  return fails;
}

(async () => {
  if (!process.env.OPENAI_API_KEY) { console.error('Set OPENAI_API_KEY'); process.exit(1); }
  const only = arg('--only'); const runs = Number(arg('--runs', 1));
  let pass = 0, fail = 0;
  for (const sc of suite.scenarios.filter((s) => !only || s.name === only)) {
    for (let i = 0; i < runs; i++) {
      try {
        const out = await runOne(sc);
        const fails = check(sc, out);
        if (fails.length) { fail++; console.log(`✗ ${sc.name}\n    lead: ${sc.lead_says}\n    ai:   ${out.decision.reply}\n    ${fails.join('\n    ')}`); }
        else { pass++; console.log(`✓ ${sc.name.padEnd(28)} [${out.decision.action}] ${out.pre ? '(pre-AI rule)' : out.decision.reply}`); }
      } catch (e) { fail++; console.log(`✗ ${sc.name}: ${e.message}`); }
    }
  }
  console.log(`\nScenarios: ${pass} passed, ${fail} failed (model ${model})`);
  process.exitCode = fail ? 1 : 0;
})();
