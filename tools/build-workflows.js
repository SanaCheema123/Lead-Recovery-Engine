#!/usr/bin/env node
// ===========================================================================
// build-workflows.js — generates importable n8n workflow JSON
//
//   node tools/build-workflows.js        -> writes n8n/workflows/*.json
//
// Why generate instead of hand-editing JSON in the n8n UI?
//   * Business logic lives in n8n/code/lib/*.js and is unit-tested; the build
//     inlines it into Code nodes, so production runs exactly the tested code.
//   * Prompts + schema are inlined from /prompts — one source of truth.
//   * Workflows are diff-able and reviewable in git; IDs are stable so
//     sub-workflow references survive re-imports.
// You CAN still tweak workflows in the n8n UI; export them with
// scripts/export-workflows.sh and port the change back here.
// ===========================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ORDER } = require('../n8n/code/lib/index.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'n8n', 'workflows');
const LIBS = ORDER.map((f) => `// ---- lib/${f}\n` + fs.readFileSync(path.join(ROOT, 'n8n/code/lib', f), 'utf8')).join('\n;\n');
const SYSTEM_PROMPT = fs.readFileSync(path.join(ROOT, 'prompts/conversation_agent.system.md'), 'utf8');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts/schemas/conversation_turn.schema.json'), 'utf8'));

// ------------------------------------------------------------------ IDs ----
const wfId = (num, key) => ('lre' + num + key.replace(/[^A-Za-z]/g, '')).slice(0, 16).padEnd(16, '0');
const ID = {
  import: wfId('01', 'CrmImport'),
  launcher: wfId('02', 'CampaignLauncher'),
  sender: wfId('03', 'OutboundSender'),
  inSms: wfId('04', 'InboundSms'),
  inEmail: wfId('05', 'InboundEmail'),
  ai: wfId('06', 'AiConversation'),
  crmSync: wfId('07', 'CrmSyncBack'),
  booking: wfId('08', 'AppointmentBooking'),
  handoff: wfId('09', 'HumanHandoff'),
  cadence: wfId('10', 'CadenceRunner'),
  error: wfId('11', 'ErrorHandler'),
  health: wfId('12', 'HealthReport'),
  status: wfId('13', 'DeliveryStatus'),
  crmAdapter: wfId('14', 'CrmAdapter'),
  calAdapter: wfId('15', 'CalendarAdapter'),
};

const CRED = {
  pg: { postgres: { id: 'lrePostgres00001', name: 'LRE Postgres' } },
  openai: { openAiApi: { id: 'lreOpenAi0000001', name: 'LRE OpenAI' } },
  twilio: { twilioApi: { id: 'lreTwilio0000001', name: 'LRE Twilio' } },
  sendgrid: { httpHeaderAuth: { id: 'lreSendgrid00001', name: 'LRE SendGrid' } },
  ghl: { httpHeaderAuth: { id: 'lreGhl0000000001', name: 'LRE GoHighLevel' } },
  hubspot: { httpHeaderAuth: { id: 'lreHubspot000001', name: 'LRE HubSpot' } },
  calcom: { httpHeaderAuth: { id: 'lreCalcom0000001', name: 'LRE Cal.com' } },
};

const uuid = (seed) => {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const P = (c, r) => [c * 260, r * 200];

// ------------------------------------------------------------ builder ----
class WF {
  constructor(idKey, num, title, description) {
    this.id = ID[idKey];
    this.file = `${num}_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}.json`;
    this.name = `LRE ${num} · ${title}`;
    this.nodes = [];
    this.connections = {};
    this.isErrorWf = idKey === 'error';
    this.sticky(`## ${title}\n${description}`, P(-1, -2), 520, 260);
  }
  add(n) {
    if (this.nodes.some((x) => x.name === n.name)) throw new Error(`${this.name}: duplicate node ${n.name}`);
    n.id = uuid(this.id + n.name);
    this.nodes.push(n);
    return n.name;
  }
  link(from, to, out = 0) {
    const c = (this.connections[from] = this.connections[from] || { main: [] });
    while (c.main.length <= out) c.main.push([]);
    c.main[out].push({ node: to, type: 'main', index: 0 });
  }
  chain(...names) {
    for (let i = 0; i < names.length - 1; i++) this.link(names[i], names[i + 1]);
  }
  sticky(content, position, width = 400, height = 200) {
    const n = { name: `Note ${this.nodes.length + 1}`, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position, parameters: { content, width, height } };
    n.id = uuid(this.id + n.name);
    this.nodes.push(n);
  }
  toJSON() {
    for (const from of Object.keys(this.connections)) {
      if (!this.nodes.find((n) => n.name === from)) throw new Error(`${this.name}: link from missing node ${from}`);
      for (const outs of this.connections[from].main) for (const l of outs) {
        if (!this.nodes.find((n) => n.name === l.node)) throw new Error(`${this.name}: link to missing node ${l.node}`);
      }
    }
    const settings = {
      executionOrder: 'v1', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all',
      saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner', timezone: 'America/New_York',
    };
    if (!this.isErrorWf) settings.errorWorkflow = ID.error;
    return { id: this.id, name: this.name, nodes: this.nodes, connections: this.connections, active: false, settings, pinData: {}, meta: { templateCredsSetupCompleted: false, generatedBy: 'tools/build-workflows.js' } };
  }
}

// --------------------------------------------------------- node types ----
const webhook = (name, p, pathName, { method = 'POST', respond = 'onReceived' } = {}) => ({
  name, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: p, webhookId: uuid('wh:' + pathName + method),
  parameters: { httpMethod: method, path: pathName, responseMode: respond, options: {} },
});
const respond = (name, p, body, contentType = 'text/plain', code = 200) => ({
  name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: p,
  parameters: { respondWith: 'text', responseBody: body, options: { responseCode: code, responseHeaders: { entries: [{ name: 'Content-Type', value: contentType }] } } },
});
const schedule = (name, p, minutes) => ({
  name, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: p,
  parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: minutes }] } },
});
const cron = (name, p, expression) => ({
  name, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: p,
  parameters: { rule: { interval: [{ field: 'cronExpression', expression }] } },
});
const subTrigger = (name, p) => ({ name, type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: p, parameters: { inputSource: 'passthrough' } });
const errorTrigger = (name, p) => ({ name, type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: p, parameters: {} });
const exec = (name, p, target, { wait = true } = {}) => ({
  name, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.1, position: p,
  parameters: { source: 'database', workflowId: { __rl: true, value: ID[target], mode: 'id' }, mode: 'each', options: { waitForSubWorkflow: wait } },
});
const pg = (name, p, query, params, { always = true } = {}) => ({
  name, type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: p, credentials: CRED.pg, alwaysOutputData: always,
  retryOnFail: true, maxTries: 3, waitBetweenTries: 1000,
  parameters: { operation: 'executeQuery', query: query.trim(), options: params && params.length ? { queryReplacement: `={{ [ ${params.join(', ')} ] }}` } : {} },
});
const code = (name, p, js, { libs = false, prompt = false } = {}) => {
  let src = '';
  if (prompt) src += `const SYSTEM_PROMPT_TEMPLATE = ${JSON.stringify(SYSTEM_PROMPT)};\nconst OUTPUT_SCHEMA = ${JSON.stringify(SCHEMA)};\n`;
  if (libs) src += `// ===== Shared LRE libraries (generated from n8n/code/lib — do not edit here) =====\n${LIBS}\n// ===== Node logic =====\n`;
  src += js.trim() + '\n';
  return { name, type: 'n8n-nodes-base.code', typeVersion: 2, position: p, parameters: { mode: 'runOnceForAllItems', jsCode: src } };
};
const ifn = (name, p, expr) => ({
  name, type: 'n8n-nodes-base.if', typeVersion: 2, position: p,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: [{ id: uuid(name), leftValue: `={{ ${expr} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  },
});
const sw = (name, p, expr, keys) => ({
  name, type: 'n8n-nodes-base.switch', typeVersion: 3, position: p,
  parameters: {
    rules: {
      values: keys.map((k) => ({
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [{ leftValue: `={{ ${expr} }}`, rightValue: k, operator: { type: 'string', operation: 'equals' } }],
          combinator: 'and',
        },
        renameOutput: true, outputKey: k,
      })),
    },
    options: { fallbackOutput: 'extra' },
  },
});
const wait = (name, p, amountExpr) => ({
  name, type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: p, webhookId: uuid('wait:' + name),
  parameters: { amount: `={{ ${amountExpr} }}`, unit: 'seconds' },
});
const http = (name, p, o) => {
  const params = { method: o.method || 'POST', url: o.url, options: Object.assign({ timeout: o.timeout || 20000 }, o.options || {}) };
  if (o.predefined) { params.authentication = 'predefinedCredentialType'; params.nodeCredentialType = o.predefined; }
  else if (o.cred) { params.authentication = 'genericCredentialType'; params.genericAuthType = 'httpHeaderAuth'; }
  else params.authentication = 'none';
  if (o.headers) { params.sendHeaders = true; params.headerParameters = { parameters: Object.entries(o.headers).map(([name, value]) => ({ name, value })) }; }
  if (o.form) { params.sendBody = true; params.contentType = 'form-urlencoded'; params.bodyParameters = { parameters: Object.entries(o.form).map(([name, value]) => ({ name, value })) }; }
  if (o.json) { params.sendBody = o.sendBody || true; params.contentType = 'json'; params.specifyBody = 'json'; params.jsonBody = o.json; }
  const n = { name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: p, parameters: params, retryOnFail: o.retry !== false, maxTries: 3, waitBetweenTries: 2000 };
  if (o.predefined === 'twilioApi') n.credentials = CRED.twilio;
  if (o.predefined === 'openAiApi') n.credentials = CRED.openai;
  if (o.cred) n.credentials = CRED[o.cred];
  if (o.onError) n.onError = o.onError;
  return n;
};

const workflows = [];
const OPT_OUT_BY_LEAD_SQL = `
with l as (select id, client_id, phone_e164, email from leads where id = $1::uuid),
o1 as (insert into opt_outs (client_id, channel, value, source) select client_id, 'sms', phone_e164, $2 from l where phone_e164 is not null on conflict do nothing),
o2 as (insert into opt_outs (client_id, channel, value, source) select client_id, 'email', lower(email), $2 from l where email is not null on conflict do nothing),
u as (update leads set opted_out = true, status = 'dnc', ai_paused = true where id = $1::uuid returning id)
select $1 as lead_id, 'opted_out' as crm_event`;

// =========================================================================
// 01 · CRM Lead Import
// =========================================================================
{
  const w = new WF('import', '01', 'CRM Lead Import', 'Hourly: pulls a page of contacts per client from GoHighLevel or HubSpot, filters out excluded/DND/recently-active contacts, normalizes phones/emails/states and bulk-upserts into `leads`. A cursor in `import_state` walks the whole CRM over successive runs.');
  w.add(schedule('Every Hour', P(0, 0), 60));
  w.add(pg('Load Active Clients', P(1, 0), `
select c.id, c.crm_type, c.settings, s.cursor
from clients c left join import_state s on s.client_id = c.id
where c.active and c.crm_type <> 'none'`, null, { always: false }));
  w.add(code('Build CRM Search Requests', P(2, 0), `
return $input.all().map((it) => {
  const c = it.json; const crm = (c.settings || {}).crm || {}; const imp = crm.import || {};
  const fm = crm.field_map || {};
  const size = imp.page_size || 100;
  let request;
  if (c.crm_type === 'ghl') {
    const body = { locationId: crm.location_id, pageLimit: size };
    if (c.cursor) body.searchAfter = JSON.parse(c.cursor);
    request = { url: 'https://services.leadconnectorhq.com/contacts/search', body };
  } else {
    const props = Array.from(new Set(['firstname','lastname','phone','mobilephone','email','address','city','state','zip',
      'hs_lastmodifieddate','notes_last_contacted','lre_exclude','hs_email_optout', ...Object.values(fm)]));
    const body = { limit: size, properties: props, sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }] };
    if (c.cursor) body.after = c.cursor;
    request = { url: 'https://api.hubapi.com/crm/v3/objects/contacts/search', body };
  }
  return { json: { client_id: c.id, crm_type: c.crm_type, settings: c.settings, page_size: size, request } };
});`));
  w.add(sw('By CRM', P(3, 0), '$json.crm_type', ['ghl', 'hubspot']));
  w.add(http('GHL Search Contacts', P(4, -1), { url: '={{ $json.request.url }}', cred: 'ghl', headers: { Version: '2021-07-28' }, json: '={{ JSON.stringify($json.request.body) }}' }));
  w.add(http('HubSpot Search Contacts', P(4, 1), { url: '={{ $json.request.url }}', cred: 'hubspot', json: '={{ JSON.stringify($json.request.body) }}' }));
  const normalizeCommon = `
function shouldSkip(lead, tags, imp, activityAt, dnd) {
  if (dnd) return 'crm_dnd';
  if (!lead.phone_e164 && !lead.email) return 'no_contact_method';
  const ex = (imp.exclude_tags || []).map((t) => String(t).toLowerCase());
  const inc = (imp.include_tags || []).map((t) => String(t).toLowerCase());
  const t = (tags || []).map((x) => String(x).toLowerCase());
  if (t.some((x) => ex.includes(x))) return 'excluded_tag';
  if (inc.length && !t.some((x) => inc.includes(x))) return 'missing_include_tag';
  const stale = imp.stale_days || 60;
  if (activityAt && Date.now() - new Date(activityAt).getTime() < stale * 86400000) return 'recently_active';
  return null;
}`;
  w.add(code('Normalize GHL Contacts', P(5, -1), normalizeCommon + `
return $input.all().map((it, i) => {
  const src = $('Build CRM Search Requests').itemMatching(i).json;
  const crm = (src.settings || {}).crm || {}; const imp = crm.import || {}; const fm = crm.field_map || {};
  const contacts = it.json.contacts || [];
  const get = (c, key, dflt) => {
    const f = fm[key] || dflt;
    if (String(f).startsWith('cf:')) { const cf = (c.customFields || []).find((x) => x.id === f.slice(3)); return cf ? cf.value : null; }
    return c[f];
  };
  const leads = []; const skipped = {};
  for (const c of contacts) {
    const lead = {
      crm_contact_id: c.id,
      first_name: get(c, 'first_name', 'firstName') || null,
      last_name: get(c, 'last_name', 'lastName') || null,
      phone_e164: normalizeUSPhone(get(c, 'phone', 'phone')),
      email: normalizeEmail(get(c, 'email', 'email')),
      property_address: [get(c, 'property_address', 'address1'), get(c, 'property_city', 'city'), get(c, 'property_state', 'state')].filter(Boolean).join(', ') || null,
      property_city: get(c, 'property_city', 'city') || null,
      property_state: normalizeState(get(c, 'property_state', 'state')),
      property_zip: get(c, 'property_zip', 'postalCode') || null,
      crm_last_activity_at: c.lastActivity || c.dateUpdated || c.dateAdded || null,
      source_raw: { tags: c.tags || [], source: c.source || null },
    };
    const why = shouldSkip(lead, c.tags, imp, lead.crm_last_activity_at, c.dnd === true);
    if (why) { skipped[why] = (skipped[why] || 0) + 1; continue; }
    leads.push(lead);
  }
  const last = contacts[contacts.length - 1];
  const next_cursor = contacts.length >= src.page_size && last && last.searchAfter ? JSON.stringify(last.searchAfter) : '';
  return { json: { client_id: src.client_id, leads, next_cursor, fetched: contacts.length, skipped } };
});`, { libs: true }));
  w.add(code('Normalize HubSpot Contacts', P(5, 1), normalizeCommon + `
return $input.all().map((it, i) => {
  const src = $('Build CRM Search Requests').itemMatching(i).json;
  const crm = (src.settings || {}).crm || {}; const imp = crm.import || {}; const fm = crm.field_map || {};
  const results = it.json.results || [];
  const leads = []; const skipped = {};
  for (const r of results) {
    const p = r.properties || {};
    const g = (key, dflt) => p[fm[key] || dflt];
    const lead = {
      crm_contact_id: String(r.id),
      first_name: g('first_name', 'firstname') || null,
      last_name: g('last_name', 'lastname') || null,
      phone_e164: normalizeUSPhone(g('phone', 'mobilephone') || p.phone),
      email: normalizeEmail(g('email', 'email')),
      property_address: [g('property_address', 'address'), g('property_city', 'city'), g('property_state', 'state')].filter(Boolean).join(', ') || null,
      property_city: g('property_city', 'city') || null,
      property_state: normalizeState(g('property_state', 'state')),
      property_zip: g('property_zip', 'zip') || null,
      crm_last_activity_at: p.notes_last_contacted || p.hs_lastmodifieddate || null,
      source_raw: { hubspot_id: r.id },
    };
    const tags = p.lre_exclude === 'true' ? ['lre-exclude'] : [];
    const why = shouldSkip(lead, tags, imp, p.notes_last_contacted || null, false);
    if (why) { skipped[why] = (skipped[why] || 0) + 1; continue; }
    leads.push(lead);
  }
  const next_cursor = (it.json.paging && it.json.paging.next && it.json.paging.next.after) || '';
  return { json: { client_id: src.client_id, leads, next_cursor, fetched: results.length, skipped } };
});`, { libs: true }));
  w.add(pg('Bulk Upsert Leads', P(6, 0), `
with incoming as (
  select * from jsonb_to_recordset($2::jsonb) as x(
    crm_contact_id text, first_name text, last_name text, phone_e164 text, email text, property_address text,
    property_city text, property_state text, property_zip text, crm_last_activity_at timestamptz, source_raw jsonb)
), up as (
  insert into leads (client_id, crm_contact_id, first_name, last_name, phone_e164, email, property_address,
                     property_city, property_state, property_zip, crm_last_activity_at, source_raw)
  select $1::uuid, crm_contact_id, first_name, last_name, phone_e164, email, property_address,
         property_city, property_state, property_zip, crm_last_activity_at, source_raw
  from incoming
  on conflict (client_id, crm_contact_id) do update set
    first_name = excluded.first_name, last_name = excluded.last_name,
    phone_e164 = coalesce(excluded.phone_e164, leads.phone_e164),
    email = coalesce(excluded.email, leads.email),
    property_address = coalesce(excluded.property_address, leads.property_address),
    property_city = coalesce(excluded.property_city, leads.property_city),
    property_state = coalesce(excluded.property_state, leads.property_state),
    property_zip = coalesce(excluded.property_zip, leads.property_zip),
    crm_last_activity_at = excluded.crm_last_activity_at, source_raw = excluded.source_raw
  returning id, (xmax = 0) as inserted
), st as (
  insert into import_state (client_id, cursor, last_run_at, last_count)
  values ($1::uuid, nullif($3, ''), now(), (select count(*) from up))
  on conflict (client_id) do update set cursor = excluded.cursor, last_run_at = now(), last_count = excluded.last_count
)
select $1 as client_id, count(*) filter (where inserted) as inserted, count(*) filter (where not inserted) as updated from up`,
  ['$json.client_id', 'JSON.stringify($json.leads)', '$json.next_cursor']));
  w.chain('Every Hour', 'Load Active Clients', 'Build CRM Search Requests', 'By CRM');
  w.link('By CRM', 'GHL Search Contacts', 0);
  w.link('By CRM', 'HubSpot Search Contacts', 1);
  w.link('GHL Search Contacts', 'Normalize GHL Contacts');
  w.link('HubSpot Search Contacts', 'Normalize HubSpot Contacts');
  w.link('Normalize GHL Contacts', 'Bulk Upsert Leads');
  w.link('Normalize HubSpot Contacts', 'Bulk Upsert Leads');
  workflows.push(w);
}

// =========================================================================
// 02 · Campaign Launcher
// =========================================================================
{
  const w = new WF('launcher', '02', 'Campaign Launcher', 'Hourly: enrolls eligible `new` leads into each active campaign up to its `daily_new_limit` (ramps sending gradually to protect number reputation). First touches are spread randomly over 3 hours; the Cadence Runner (10) does the sending.');
  w.add(schedule('Every Hour', P(0, 0), 60));
  w.add(pg('Enroll Eligible Leads', P(1, 0), `
with c as (
  select cp.id, cp.client_id,
    greatest(0, coalesce((cp.settings->>'daily_new_limit')::int, 50)
      - (select count(*) from campaign_enrollments e where e.campaign_id = cp.id and e.enrolled_at::date = current_date)) as quota,
    coalesce((cp.settings->>'stale_days')::int, (k.settings->'crm'->'import'->>'stale_days')::int, 60) as stale_days
  from campaigns cp join clients k on k.id = cp.client_id
  where cp.status = 'active' and k.active
), elig as (
  select c.id as campaign_id, l.id as lead_id, c.quota,
         row_number() over (partition by c.id order by l.crm_last_activity_at desc nulls last) as rn
  from c join leads l on l.client_id = c.client_id
  where l.status = 'new' and l.opted_out = false
    and (l.phone_e164 is not null or l.email is not null)
    and (l.crm_last_activity_at is null or l.crm_last_activity_at < now() - make_interval(days => c.stale_days))
    and not exists (select 1 from campaign_enrollments e where e.lead_id = l.id and (e.status = 'active' or e.campaign_id = c.id))
), ins as (
  insert into campaign_enrollments (campaign_id, lead_id, step_index, next_touch_at)
  select campaign_id, lead_id, 0, now() + (random() * interval '180 minutes') from elig where rn <= quota
  on conflict do nothing
  returning lead_id, campaign_id
), upd as (
  update leads set status = 'queued' where id in (select lead_id from ins) returning id
)
select campaign_id, count(*) as enrolled from ins group by campaign_id`));
  w.chain('Every Hour', 'Enroll Eligible Leads');
  workflows.push(w);
}

// =========================================================================
// 03 · Outbound Sender (sub-workflow)
// =========================================================================
{
  const w = new WF('sender', '03', 'Outbound Sender', 'Sub-workflow. EVERY outbound SMS/email goes through here. Enforces opt-outs, quiet hours (intersection of lead + client time zones), state frequency caps and daily caps; appends opt-out notice on first SMS; adds CAN-SPAM footer + List-Unsubscribe to email; logs to `messages`; marks bad numbers from Twilio errors.\n\nInput: `{lead_id, channel, body, subject?, purpose, campaign_step?, ai_turn_id?}`\nOutput: input + `{sent, reason, deferred_until}`');
  w.add(subTrigger('Start', P(0, 0)));
  w.add(ifn('Has Body?', P(1, 0), '!!($json.body && String($json.body).trim())'));
  w.add(code('Return Empty', P(2, 2), `return [{ json: { ...$('Start').first().json, sent: false, reason: 'empty_body' } }];`));
  w.add(pg('Load Send Context', P(2, 0), `
select row_to_json(l.*) as lead,
  json_build_object('id', c.id, 'timezone', c.timezone, 'settings', c.settings) as client,
  (select count(*) from messages m where m.lead_id = l.id and m.direction = 'outbound' and m.purpose = 'campaign' and m.created_at > now() - interval '24 hours') as sent_last_24h,
  (select count(*) from messages m where m.client_id = c.id and m.direction = 'outbound' and m.purpose = 'campaign' and m.created_at::date = current_date) as client_sent_today,
  exists (select 1 from messages m where m.lead_id = l.id and m.purpose = 'opt_out_confirmation') as opt_out_confirmation_already_sent,
  not exists (select 1 from messages m where m.lead_id = l.id and m.direction = 'outbound' and m.channel = 'sms') as is_first_sms,
  (select subject from messages m where m.lead_id = l.id and m.channel = 'email' and m.subject is not null order by created_at desc limit 1) as last_subject
from leads l join clients c on c.id = l.client_id
where l.id = $1::uuid`, ['$json.lead_id'], { always: false }));
  w.add(code('Compliance Gate', P(3, 0), `
const start = $('Start').first().json;
const c = $input.first().json;
const lead = c.lead; const client = c.client; const settings = client.settings || {};
const channel = start.channel || (lead.phone_e164 ? 'sms' : 'email');
const purpose = start.purpose || 'conversation';
const gate = checkSendAllowed({
  lead, client, channel, purpose,
  sent_last_24h: Number(c.sent_last_24h), client_sent_today: Number(c.client_sent_today),
  opt_out_confirmation_already_sent: c.opt_out_confirmation_already_sent,
  is_first_touch: channel === 'sms' && c.is_first_sms,
});
let body = String(start.body).trim();
if (gate.allowed && gate.append_opt_out_notice && !/reply stop/i.test(body)) body += ' Reply STOP to opt out.';
const out = { ...start, channel, purpose, body, allowed: gate.allowed, gate, reason: gate.reason, deferred_until: gate.deferred_until || null, client_id: client.id };
if (channel === 'sms') {
  out.to = lead.phone_e164;
  out.status_callback = ($env.APP_BASE_URL || '') + '/webhook/lre/sms/status';
} else {
  const em = settings.email || {};
  const unsub = ($env.APP_BASE_URL || '') + '/webhook/lre/email/unsubscribe?t=' + lead.email_reply_token;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const subject = start.subject || (c.last_subject ? (c.last_subject.startsWith('Re:') ? c.last_subject : 'Re: ' + c.last_subject) : 'Quick question');
  const text = body + '\\n\\n' + (em.from_name || '') + '\\n\\n--\\n' + (em.physical_address || '') + '\\nUnsubscribe: ' + unsub;
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' + esc(body).replace(/\\n/g, '<br>') +
    '<br><br>' + esc(em.from_name || '') + '<br><br><span style="color:#888;font-size:12px">' + esc(em.physical_address || '') +
    '<br><a href="' + unsub + '">Unsubscribe</a></span></div>';
  out.to = lead.email;
  out.subject = subject;
  out.sendgrid_payload = {
    personalizations: [{ to: [{ email: lead.email, name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || undefined }] }],
    from: { email: em.from_address, name: em.from_name },
    reply_to: { email: 'reply+' + lead.email_reply_token + '@' + em.reply_domain },
    subject,
    content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
    headers: { 'List-Unsubscribe': '<' + unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    custom_args: { lre_lead_id: lead.id },
    tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
  };
}
return [{ json: out }];`, { libs: true }));
  w.add(ifn('Allowed?', P(4, 0), '$json.allowed === true'));
  w.add(pg('Record Blocked Send', P(5, 2), `
insert into events (lead_id, type, data) values ($1::uuid, 'send_blocked', $2::jsonb) returning id`,
  ['$json.lead_id', "JSON.stringify({ reason: $json.reason, deferred_until: $json.deferred_until, purpose: $json.purpose })"]));
  w.add(code('Return Blocked', P(6, 2), `const g = $('Compliance Gate').first().json; return [{ json: { ...g, sent: false } }];`));
  w.add(sw('By Channel', P(5, 0), '$json.channel', ['sms', 'email']));
  w.add(http('Twilio Send SMS', P(6, -1), {
    url: '=https://api.twilio.com/2010-04-01/Accounts/{{ $env.TWILIO_ACCOUNT_SID }}/Messages.json',
    predefined: 'twilioApi',
    form: { To: '={{ $json.to }}', MessagingServiceSid: '={{ $env.TWILIO_MESSAGING_SERVICE_SID }}', Body: '={{ $json.body }}', StatusCallback: '={{ $json.status_callback }}' },
    onError: 'continueErrorOutput',
  }));
  w.add(http('SendGrid Send Email', P(6, 1), {
    url: 'https://api.sendgrid.com/v3/mail/send', cred: 'sendgrid',
    json: '={{ JSON.stringify($json.sendgrid_payload) }}',
    options: { response: { response: { fullResponse: true } } },
    onError: 'continueErrorOutput',
  }));
  w.add(code('Map SMS Result', P(7, -1), `const g = $('Compliance Gate').first().json; const r = $input.first().json;
return [{ json: { ...g, provider_message_id: r.sid, provider_status: r.status || 'queued' } }];`));
  w.add(code('Map Email Result', P(7, 1), `const g = $('Compliance Gate').first().json; const r = $input.first().json;
const h = r.headers || {}; return [{ json: { ...g, provider_message_id: 'email:' + (h['x-message-id'] || Date.now()), provider_status: 'sent' } }];`));
  w.add(code('Classify Send Error', P(7, 3), `
const g = $('Compliance Gate').first().json; const e = $input.first().json;
const msg = JSON.stringify(e.error || e);
const m = msg.match(/\\b(2\\d{4}|3\\d{4})\\b/);
const code = m ? m[1] : '';
// 21211 invalid number · 21614 not SMS-capable · 21610 recipient replied STOP (carrier-level opt-out)
const lead_action = code === '21610' ? 'dnc' : (['21211', '21614'].includes(code) ? 'bad_number' : 'none');
return [{ json: { ...g, sent: false, reason: 'provider_error', error_code: code, error: msg.slice(0, 500), lead_action } }];`));
  w.add(pg('Log Send Failure', P(8, 3), `
with m as (
  insert into messages (lead_id, client_id, direction, channel, body, purpose, status, error_code, to_address)
  values ($1::uuid, $2::uuid, 'outbound', $3, $4, $5, 'failed', $6, $7) returning id
), o as (
  insert into opt_outs (client_id, channel, value, source)
  select $2::uuid, 'sms', $7, 'carrier' where $8 = 'dnc' on conflict do nothing
)
update leads set
  status = case when $8 in ('dnc', 'bad_number') then $8 else status end,
  opted_out = case when $8 = 'dnc' then true else opted_out end
where id = $1::uuid
returning id`, ['$json.lead_id', '$json.client_id', '$json.channel', '$json.body', '$json.purpose', '$json.error_code', "$json.to || ''", '$json.lead_action']));
  w.add(code('Return Failed', P(9, 3), `return [{ json: $('Classify Send Error').first().json }];`));
  w.add(pg('Log Outbound Message', P(8, 0), `
with m as (
  insert into messages (lead_id, client_id, direction, channel, body, subject, purpose, provider_message_id, status, to_address, ai_turn_id, campaign_step)
  values ($1::uuid, $2::uuid, 'outbound', $3, $4, nullif($5, ''), $6, nullif($7, ''), $8, $9, nullif($10, '')::uuid, nullif($11, '')::int)
  returning id
)
update leads set
  last_outbound_at = now(),
  status = case when status in ('new', 'queued') then 'contacted' else status end,
  attempt_count = attempt_count + case when $6 = 'campaign' then 1 else 0 end
where id = $1::uuid
returning (select id from m) as message_id`,
  ['$json.lead_id', '$json.client_id', '$json.channel', '$json.body', "$json.subject || ''", '$json.purpose', '$json.provider_message_id',
    '$json.provider_status', '$json.to', "$json.ai_turn_id || ''", "$json.campaign_step == null ? '' : String($json.campaign_step)"]));
  w.add(code('Return Sent', P(9, 0), `
const items = $('Map SMS Result').isExecuted ? $('Map SMS Result').all() : $('Map Email Result').all();
return [{ json: { ...items[0].json, sent: true, message_id: $input.first().json.message_id } }];`));
  w.chain('Start', 'Has Body?');
  w.link('Has Body?', 'Load Send Context', 0);
  w.link('Has Body?', 'Return Empty', 1);
  w.chain('Load Send Context', 'Compliance Gate', 'Allowed?');
  w.link('Allowed?', 'By Channel', 0);
  w.link('Allowed?', 'Record Blocked Send', 1);
  w.link('Record Blocked Send', 'Return Blocked');
  w.link('By Channel', 'Twilio Send SMS', 0);
  w.link('By Channel', 'SendGrid Send Email', 1);
  w.link('Twilio Send SMS', 'Map SMS Result', 0);
  w.link('Twilio Send SMS', 'Classify Send Error', 1);
  w.link('SendGrid Send Email', 'Map Email Result', 0);
  w.link('SendGrid Send Email', 'Classify Send Error', 1);
  w.link('Map SMS Result', 'Log Outbound Message');
  w.link('Map Email Result', 'Log Outbound Message');
  w.chain('Log Outbound Message', 'Return Sent');
  w.chain('Classify Send Error', 'Log Send Failure', 'Return Failed');
  workflows.push(w);
}

// =========================================================================
// 04 · Inbound SMS
// =========================================================================
{
  const w = new WF('inSms', '04', 'Inbound SMS', 'Twilio webhook for replies. Verifies Twilio signature, ACKs instantly, de-duplicates by MessageSid, stops the lead\'s cadence, then routes deterministically BEFORE any AI: opt-out / opt-in / unknown sender / hostile / handed-off (forward to human) / AI.\n\nTwilio → Messaging Service → Incoming: `POST {APP_BASE_URL}/webhook/lre/sms/inbound`');
  w.add(webhook('Twilio Inbound Webhook', P(0, 0), 'lre/sms/inbound', { respond: 'responseNode' }));
  w.add(code('Verify Twilio Signature', P(1, 0), `
const crypto = require('crypto');
const req = $input.first().json;
const params = req.body || {};
if ($env.TWILIO_VALIDATE_SIGNATURE !== 'false') {
  const url = ($env.APP_BASE_URL || '') + '/webhook/lre/sms/inbound';
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', $env.TWILIO_AUTH_TOKEN || '').update(Buffer.from(data, 'utf-8')).digest('base64');
  const got = String((req.headers || {})['x-twilio-signature'] || '');
  if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    throw new Error('Invalid Twilio signature on inbound SMS');
  }
}
let body = String(params.Body || '').trim();
const media = Number(params.NumMedia || 0);
if (media > 0) body = (body + ' [sent ' + media + ' photo' + (media > 1 ? 's' : '') + ']').trim();
return [{ json: { from: normalizeUSPhone(params.From), to: normalizeUSPhone(params.To), body, sid: params.MessageSid } }];`, { libs: true }));
  w.add(respond('Ack Twilio', P(2, 0), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 'text/xml'));
  w.add(pg('Store Inbound & Resolve Lead', P(3, 0), `
with cl as (select client_id from client_phone_numbers where phone_e164 = $2),
ld as (
  select l.* from leads l
  where l.phone_e164 = $1 and l.client_id = (select client_id from cl)
  order by l.last_outbound_at desc nulls last limit 1
),
ins as (
  insert into messages (lead_id, client_id, direction, channel, body, provider_message_id, status, from_address, to_address)
  select (select id from ld), (select client_id from cl), 'inbound', 'sms', $3, $4, 'received', $1, $2
  on conflict (provider_message_id) do nothing
  returning id
),
upd as (update leads set last_inbound_at = now() where id = (select id from ld) and exists (select 1 from ins) returning id),
stp as (
  update campaign_enrollments set status = 'stopped', stopped_reason = 'lead_replied', locked_until = null
  where lead_id = (select id from ld) and status = 'active' and exists (select 1 from ins) returning id
)
select (select id from ins) as message_id, (select id from ld) as lead_id, (select client_id from cl) as client_id,
  (select status from ld) as lead_status, (select ai_paused from ld) as ai_paused, (select opted_out from ld) as opted_out,
  (select (settings->'messaging'->>'reply_debounce_seconds')::int from clients where id = (select client_id from cl)) as debounce_seconds`,
  ['$json.from', '$json.to', '$json.body', '$json.sid']));
  w.add(code('Pre-AI Routing', P(4, 0), `
const r = $input.first().json; const msg = $('Verify Twilio Signature').first().json;
if (!r.message_id) return []; // duplicate webhook delivery
const cls = classifyInbound(msg.body);
let route, handoff_mode = null, handoff_reason = null;
if (cls.route === 'opt_out') route = cls.detail.reason === 'keyword' ? 'opt_out' : 'opt_out_natural';
else if (!r.client_id) route = 'ignore';
else if (!r.lead_id) { route = 'unknown_sender'; handoff_mode = 'unknown_sender'; handoff_reason = 'Reply from a number not in our lead list'; }
else if (cls.route === 'opt_in') route = 'opt_in';
else if (r.opted_out) route = 'ignore';
else if (cls.route === 'hostile') { route = 'human'; handoff_mode = 'hostile'; handoff_reason = 'Hostile or legal-risk language detected'; }
else if (r.ai_paused || ['handed_off', 'appointment_booked'].includes(r.lead_status)) { route = 'human'; handoff_mode = 'forward'; handoff_reason = 'Lead replied while a human owns the conversation'; }
else route = 'ai';
return [{ json: { ...r, route, handoff_mode, handoff_reason, inbound_text: msg.body, from: msg.from,
  channel: 'sms', mode: 'reply', trigger_message_id: r.message_id, debounce_seconds: r.debounce_seconds || 20 } }];`, { libs: true }));
  w.add(sw('Route', P(5, 0), '$json.route', ['opt_out', 'opt_out_natural', 'opt_in', 'unknown_sender', 'human', 'ai']));
  w.add(pg('Apply SMS Opt-Out', P(6, -2), `
with o as (
  insert into opt_outs (client_id, channel, value, source)
  values (nullif($3, '')::uuid, 'sms', $1, $2) on conflict do nothing
), u as (
  update leads set opted_out = true, status = 'dnc', ai_paused = true
  where phone_e164 = $1 and ($3 = '' or client_id = $3::uuid) returning id
)
select coalesce((select id::text from u limit 1), '') as lead_id, 'opted_out' as crm_event`,
  ['$json.from', "$json.route === 'opt_out' ? 'keyword' : 'natural_language'", "$json.client_id || ''"]));
  w.add(code('Prepare Opt-Out Confirmation', P(7, -2), `
const r = $('Pre-AI Routing').first().json; const o = $input.first().json;
// Keyword STOP: Twilio Advanced Opt-Out already replies. Natural language: we send one confirmation.
const body = r.route === 'opt_out_natural' && o.lead_id ? "Understood - you've been removed and won't hear from us again." : '';
return [{ json: { lead_id: o.lead_id, crm_event: 'opted_out', channel: 'sms', body, purpose: 'opt_out_confirmation' } }];`));
  w.add(exec('Send Opt-Out Confirmation', P(8, -2), 'sender'));
  w.add(ifn('Known Lead?', P(9, -2), '!!$json.lead_id'));
  w.add(pg('Remove SMS Suppression', P(6, -1), `
delete from opt_outs where channel = 'sms' and value = $1 and (client_id = $2::uuid or client_id is null) returning id`, ['$json.from', '$json.client_id']));
  w.add(pg('Re-activate Lead', P(7, -1), `
update leads set opted_out = false, status = 'engaged', ai_paused = false where id = $1::uuid
returning id as lead_id, 'opt_in' as crm_event`, ["$('Pre-AI Routing').item.json.lead_id"]));
  w.add(pg('Create Lead For Unknown Sender', P(6, 1), `
with l as (
  insert into leads (client_id, phone_e164, status, ai_paused, source)
  values ($1::uuid, $2, 'handed_off', true, 'inbound_unknown') returning id
), m as (update messages set lead_id = (select id from l) where id = $3::uuid)
select (select id from l) as lead_id`, ['$json.client_id', '$json.from', '$json.message_id']));
  w.add(code('Merge Unknown Sender', P(7, 1), `return [{ json: { ...$('Pre-AI Routing').first().json, lead_id: $input.first().json.lead_id } }];`));
  w.add(exec('Human Handoff', P(8, 1), 'handoff'));
  w.add(exec('AI Conversation Engine', P(6, 3), 'ai', { wait: false }));
  w.add(exec('CRM Sync', P(10, -1), 'crmSync', { wait: false }));
  w.chain('Twilio Inbound Webhook', 'Verify Twilio Signature', 'Ack Twilio', 'Store Inbound & Resolve Lead', 'Pre-AI Routing', 'Route');
  w.link('Route', 'Apply SMS Opt-Out', 0);
  w.link('Route', 'Apply SMS Opt-Out', 1);
  w.link('Route', 'Remove SMS Suppression', 2);
  w.link('Route', 'Create Lead For Unknown Sender', 3);
  w.link('Route', 'Human Handoff', 4);
  w.link('Route', 'AI Conversation Engine', 5);
  w.chain('Apply SMS Opt-Out', 'Prepare Opt-Out Confirmation', 'Send Opt-Out Confirmation', 'Known Lead?');
  w.link('Known Lead?', 'CRM Sync', 0);
  w.chain('Remove SMS Suppression', 'Re-activate Lead', 'CRM Sync');
  w.chain('Create Lead For Unknown Sender', 'Merge Unknown Sender', 'Human Handoff');
  workflows.push(w);
}

// =========================================================================
// 05 · Inbound Email
// =========================================================================
{
  const w = new WF('inEmail', '05', 'Inbound Email', 'SendGrid Inbound Parse webhook (replies to `reply+<token>@<reply_domain>`). Strips quoted history, matches the lead by token, then uses the same deterministic routing as SMS. Also hosts the one-click unsubscribe endpoint.\n\nInbound Parse URL: `{APP_BASE_URL}/webhook/lre/email/inbound?key={LRE_INBOUND_EMAIL_KEY}`');
  w.add(webhook('SendGrid Inbound Parse', P(0, 0), 'lre/email/inbound', { respond: 'responseNode' }));
  w.add(code('Parse Inbound Email', P(1, 0), `
const crypto = require('crypto');
const req = $input.first().json;
if (!$env.LRE_INBOUND_EMAIL_KEY || (req.query || {}).key !== $env.LRE_INBOUND_EMAIL_KEY) throw new Error('Inbound email: bad key');
const b = req.body || {};
const token = extractReplyToken(b.to || '') || '';
const from = extractAddress(b.from || '');
const text = stripQuotedReply(b.text || String(b.html || '').replace(/<[^>]+>/g, ' ')).slice(0, 4000);
const midMatch = String(b.headers || '').match(/^Message-ID:\\s*(.+)$/im);
const pid = 'email:' + (midMatch ? midMatch[1].trim() : crypto.createHash('sha1').update(from + (b.subject || '') + text).digest('hex'));
return [{ json: { token, from, subject: b.subject || '', text, provider_message_id: pid } }];`, { libs: true }));
  w.add(respond('Ack SendGrid', P(2, 0), 'ok'));
  w.add(pg('Store Inbound Email & Resolve Lead', P(3, 0), `
with ld as (
  select l.* from leads l
  where ($1 <> '' and l.email_reply_token = $1) or ($1 = '' and lower(l.email) = $2)
  order by l.last_outbound_at desc nulls last limit 1
), ins as (
  insert into messages (lead_id, client_id, direction, channel, body, subject, provider_message_id, status, from_address)
  select id, client_id, 'inbound', 'email', $3, $4, $5, 'received', $2 from ld
  on conflict (provider_message_id) do nothing returning id
), upd as (update leads set last_inbound_at = now() where id = (select id from ld) and exists (select 1 from ins) returning id),
stp as (
  update campaign_enrollments set status = 'stopped', stopped_reason = 'lead_replied', locked_until = null
  where lead_id = (select id from ld) and status = 'active' and exists (select 1 from ins) returning id
)
select (select id from ins) as message_id, ld.id as lead_id, ld.client_id, ld.status as lead_status, ld.ai_paused, ld.opted_out
from ld`, ['$json.token', '$json.from', '$json.text', '$json.subject', '$json.provider_message_id']));
  w.add(code('Pre-AI Routing', P(4, 0), `
const r = $input.first().json; const msg = $('Parse Inbound Email').first().json;
if (!r.message_id || !r.lead_id) return [];
const cls = classifyInbound(msg.text);
let route = 'ai', handoff_mode = null, handoff_reason = null;
if (cls.route === 'opt_out') route = 'opt_out';
else if (r.opted_out) return [];
else if (cls.route === 'hostile') { route = 'human'; handoff_mode = 'hostile'; handoff_reason = 'Hostile or legal-risk language detected'; }
else if (r.ai_paused || ['handed_off', 'appointment_booked'].includes(r.lead_status)) { route = 'human'; handoff_mode = 'forward'; handoff_reason = 'Lead replied by email while a human owns the conversation'; }
return [{ json: { ...r, route, handoff_mode, handoff_reason, inbound_text: msg.text, channel: 'email', mode: 'reply', trigger_message_id: r.message_id, debounce_seconds: 5 } }];`, { libs: true }));
  w.add(sw('Route', P(5, 0), '$json.route', ['opt_out', 'human', 'ai']));
  w.add(pg('Apply Opt-Out', P(6, -1), OPT_OUT_BY_LEAD_SQL, ['$json.lead_id', "'email_reply'"]));
  w.add(exec('CRM Sync', P(7, -1), 'crmSync', { wait: false }));
  w.add(exec('Human Handoff', P(6, 0), 'handoff'));
  w.add(exec('AI Conversation Engine', P(6, 1), 'ai', { wait: false }));
  // Unsubscribe endpoint
  w.add(webhook('Unsubscribe Link', P(0, 4), 'lre/email/unsubscribe', { method: 'GET', respond: 'responseNode' }));
  w.add(pg('Unsubscribe By Token', P(1, 4), `
with l as (select id, client_id, email from leads where email_reply_token = $1),
o as (insert into opt_outs (client_id, channel, value, source) select client_id, 'email', lower(email), 'email_unsubscribe' from l where email is not null on conflict do nothing),
u as (update leads set opted_out = true, status = 'dnc', ai_paused = true where id = (select id from l) returning id)
select (select id from l) as lead_id, 'opted_out' as crm_event`, ["$json.query.t || ''"]));
  w.add(respond('Unsubscribed Page', P(2, 4), '<html><body style="font-family:Arial;padding:40px"><h2>You have been unsubscribed.</h2><p>You will not receive further messages from us.</p></body></html>', 'text/html'));
  w.add(ifn('Lead Found?', P(3, 4), "!!$('Unsubscribe By Token').item.json.lead_id"));
  w.add(code('Unsub CRM Payload', P(4, 4), `return [{ json: $('Unsubscribe By Token').first().json }];`));
  w.add(exec('CRM Sync (Unsubscribe)', P(5, 4), 'crmSync', { wait: false }));
  w.chain('SendGrid Inbound Parse', 'Parse Inbound Email', 'Ack SendGrid', 'Store Inbound Email & Resolve Lead', 'Pre-AI Routing', 'Route');
  w.link('Route', 'Apply Opt-Out', 0);
  w.link('Route', 'Human Handoff', 1);
  w.link('Route', 'AI Conversation Engine', 2);
  w.chain('Apply Opt-Out', 'CRM Sync');
  w.chain('Unsubscribe Link', 'Unsubscribe By Token', 'Unsubscribed Page', 'Lead Found?');
  w.link('Lead Found?', 'Unsub CRM Payload', 0);
  w.chain('Unsub CRM Payload', 'CRM Sync (Unsubscribe)');
  workflows.push(w);
}

// =========================================================================
// 06 · AI Conversation Engine (sub-workflow) — the brain
// =========================================================================
{
  const w = new WF('ai', '06', 'AI Conversation Engine', 'Sub-workflow. One AI turn for one lead.\n1. Debounce (waits for multi-part texts, exits if a newer message arrived)\n2. Load full context, enforce daily AI-turn cap\n3. Fetch real calendar slots when the lead is warm\n4. OpenAI (Structured Outputs) → `processTurn` (merge facts, score, validate action, guardrails)\n5. Persist turn + qualification + status, then route: reply / book / handoff / opt-out\n\nInput: `{lead_id, mode: reply|nudge, trigger_message_id?, channel}`');
  w.add(subTrigger('Start', P(0, 0)));
  w.add(wait('Debounce', P(1, 0), "$json.mode === 'reply' ? ($json.debounce_seconds || 20) : 1"));
  w.add(pg('Load Conversation Context', P(2, 0), `
select row_to_json(l.*) as lead,
  json_build_object('id', c.id, 'name', c.name, 'timezone', c.timezone, 'crm_type', c.crm_type,
                    'calendar_provider', c.calendar_provider, 'settings', c.settings) as client,
  (select row_to_json(q.*) from qualifications q where q.lead_id = l.id) as qualification,
  coalesce((select json_agg(x order by x.created_at) from (
     select id, direction, channel, body, created_at from messages
     where lead_id = l.id and status is distinct from 'failed' order by created_at desc limit 30) x), '[]') as messages,
  (select id from messages where lead_id = l.id and direction = 'inbound' order by created_at desc limit 1) as latest_inbound_id,
  (select count(*) from ai_turns where lead_id = l.id and created_at > now() - interval '24 hours') as ai_turns_24h,
  (select count(*) from ai_turns where lead_id = l.id) as ai_turn_count
from leads l join clients c on c.id = l.client_id
where l.id = $1::uuid`, ["$('Start').item.json.lead_id"], { always: false }));
  w.add(code('Guard & Prepare', P(3, 0), `
const start = $('Start').first().json;
const c = $input.first().json;
if (!c.lead) return [];
const lead = c.lead, client = c.client, s = client.settings || {}, m = s.messaging || {};
const mode = start.mode || 'reply';
// A newer inbound message arrived during the debounce window: that execution will answer.
if (mode === 'reply' && start.trigger_message_id && c.latest_inbound_id && c.latest_inbound_id !== start.trigger_message_id) return [];
if (!aiShouldRespond(lead.status, lead.ai_paused) && lead.status !== 'nurture') return [];
if (lead.ai_paused) return [];
const q = c.qualification || {};
const prelim = scoreLead(q, s.qualification || {});
const cal = s.calendar || {};
const needs_slots = cal.enabled !== false && client.calendar_provider !== 'none' && mode !== 'nudge' &&
  (prelim.score >= 35 || ['qualifying', 'qualified'].includes(lead.status));
const over_cap = Number(c.ai_turns_24h) >= (m.max_ai_turns_per_lead_per_day || 15);
return [{ json: { ...c, qualification: q, mode, trigger_message_id: start.trigger_message_id || null,
  channel: start.channel || (lead.phone_e164 ? 'sms' : 'email'), needs_slots, over_cap, calendar_op: 'get_slots',
  lead_id: lead.id, handoff_mode: over_cap ? 'handoff' : null, handoff_reason: over_cap ? 'AI turn cap reached for today' : null } }];`, { libs: true }));
  w.add(ifn('Over Daily AI Cap?', P(4, 0), '$json.over_cap === true'));
  w.add(ifn('Needs Slots?', P(5, 0), '$json.needs_slots === true'));
  w.add(exec('Get Calendar Slots', P(6, -1), 'calAdapter'));
  w.add(code('Build AI Request', P(7, 0), `
const c = $input.first().json;
const openai_request = buildChatRequest({
  systemTemplate: SYSTEM_PROMPT_TEMPLATE, schema: OUTPUT_SCHEMA,
  model: $env.OPENAI_MODEL || 'gpt-4.1-mini',
  ctx: { client: c.client, lead: c.lead, qualification: c.qualification, messages: c.messages,
         slots: c.slots || [], mode: c.mode, channel: c.channel, ai_turn_count: Number(c.ai_turn_count) },
});
return [{ json: { ...c, openai_request, started_at: Date.now() } }];`, { libs: true, prompt: true }));
  w.add(http('OpenAI Chat Completion', P(8, 0), {
    url: 'https://api.openai.com/v1/chat/completions', predefined: 'openAiApi',
    json: '={{ JSON.stringify($json.openai_request) }}', timeout: 45000, onError: 'continueErrorOutput',
  }));
  w.add(code('Process Turn', P(9, 0), `
const c = $('Build AI Request').first().json;
const api = $input.first().json;
let decision, raw = null, meta = {};
try {
  const parsed = parseModelOutput(api);
  raw = parsed.turn;
  meta = { model: parsed.model, prompt_tokens: parsed.usage.prompt_tokens, completion_tokens: parsed.usage.completion_tokens, latency_ms: Date.now() - c.started_at };
  decision = processTurn(parsed.turn, { client: c.client, lead: c.lead, qualification: c.qualification, slots: c.slots || [], channel: c.channel });
} catch (e) {
  decision = { action: 'handoff_to_human', handoff_reason: 'ai_parse_error: ' + e.message, reply: '', status: c.lead.status,
    qualification: c.qualification, score: c.lead.score, temperature: c.lead.temperature, issues: ['parse_error'], score_reasons: [], notify_human: true };
}
return [{ json: { lead_id: c.lead.id, client_id: c.client.id, prev_status: c.lead.status, channel: c.channel, mode: c.mode,
  trigger_message_id: c.trigger_message_id, slots: c.slots || [], decision, raw, ai_meta: meta } }];`, { libs: true }));
  w.add(code('AI Failure → Handoff', P(9, 2), `
const c = $('Build AI Request').first().json;
return [{ json: { lead_id: c.lead.id, handoff_mode: 'handoff', handoff_reason: 'OpenAI request failed: ' + JSON.stringify($input.first().json.error || '').slice(0, 300) } }];`));
  w.add(pg('Save AI Turn', P(10, 0), `
with t as (
  insert into ai_turns (lead_id, trigger_message_id, mode, model, prompt_tokens, completion_tokens, latency_ms, raw_output, decision, action, guardrail_issues)
  values ($1::uuid, nullif($6, '')::uuid, $5, $4::jsonb->>'model', ($4::jsonb->>'prompt_tokens')::int, ($4::jsonb->>'completion_tokens')::int,
          ($4::jsonb->>'latency_ms')::int, $3::jsonb, $2::jsonb, $2::jsonb->>'action',
          array(select jsonb_array_elements_text(coalesce($2::jsonb->'issues', '[]'))))
  returning id
), q as (
  insert into qualifications as q0 (lead_id, is_owner, interested_in_selling, timeline, motivation_level, motivation_reasons,
    property_type, property_condition, occupancy, price_flexibility, asking_price, is_decision_maker, bedrooms, bathrooms,
    best_contact_time, notes, summary, score_reasons, updated_at)
  select $1::uuid, (d->>'is_owner')::boolean, d->>'interested_in_selling', d->>'timeline', d->>'motivation_level',
    array(select jsonb_array_elements_text(coalesce(d->'motivation_reasons', '[]'))),
    d->>'property_type', d->>'property_condition', d->>'occupancy', d->>'price_flexibility', (d->>'asking_price')::numeric,
    (d->>'is_decision_maker')::boolean, (d->>'bedrooms')::numeric, (d->>'bathrooms')::numeric, d->>'best_contact_time',
    d->>'notes', d->>'summary', array(select jsonb_array_elements_text(coalesce($2::jsonb->'score_reasons', '[]'))), now()
  from (select $2::jsonb->'qualification' as d) s
  on conflict (lead_id) do update set
    is_owner = excluded.is_owner, interested_in_selling = excluded.interested_in_selling, timeline = excluded.timeline,
    motivation_level = excluded.motivation_level, motivation_reasons = excluded.motivation_reasons,
    property_type = excluded.property_type, property_condition = excluded.property_condition, occupancy = excluded.occupancy,
    price_flexibility = excluded.price_flexibility, asking_price = excluded.asking_price, is_decision_maker = excluded.is_decision_maker,
    bedrooms = excluded.bedrooms, bathrooms = excluded.bathrooms, best_contact_time = excluded.best_contact_time,
    notes = excluded.notes, summary = excluded.summary, score_reasons = excluded.score_reasons, updated_at = now()
  returning lead_id
), l as (
  update leads set
    status = case when $2::jsonb->>'action' in ('confirm_appointment', 'handoff_to_human', 'opt_out') then status else $2::jsonb->>'status' end,
    score = coalesce(($2::jsonb->>'score')::int, score),
    temperature = coalesce($2::jsonb->>'temperature', temperature),
    nurture_until = case when $2::jsonb->>'action' = 'schedule_followup' then coalesce(nullif($2::jsonb->>'followup_date', '')::date, current_date + 90)
                         when $5 = 'nudge' then null else nurture_until end,
    nudge_count = case when $5 = 'nudge' then nudge_count + 1 else 0 end
  where id = $1::uuid
  returning id, status
)
select (select id from t) as ai_turn_id, (select status from l) as lead_status`,
  ['$json.lead_id', 'JSON.stringify($json.decision)', 'JSON.stringify($json.raw)', 'JSON.stringify($json.ai_meta)', '$json.mode', "$json.trigger_message_id || ''"]));
  w.add(code('Merge Turn Result', P(11, 0), `
const t = $('Process Turn').first().json; const d = t.decision;
const route = d.action === 'confirm_appointment' ? 'book' : d.action === 'handoff_to_human' ? 'handoff' : d.action === 'opt_out' ? 'opt_out' : 'reply';
const becameQualified = d.qualified && !['qualified', 'appointment_booked'].includes(t.prev_status);
return [{ json: { ...t, route, ai_turn_id: $input.first().json.ai_turn_id,
  body: d.reply, purpose: t.mode === 'nudge' ? 'nudge' : 'conversation',
  handoff_mode: route === 'handoff' ? 'handoff' : (d.notify_human && d.temperature === 'hot' ? 'hot_alert' : null),
  handoff_reason: d.handoff_reason || (d.temperature === 'hot' ? 'Hot lead (score ' + d.score + ')' : null),
  crm_event: becameQualified ? 'qualified' : 'ai_turn' } }];`));
  w.add(sw('Route Action', P(12, 0), '$json.route', ['reply', 'book', 'handoff', 'opt_out']));
  w.add(exec('Send Reply', P(13, -1), 'sender'));
  w.add(ifn('Hot Lead Alert?', P(14, -1), "$json.handoff_mode === 'hot_alert'"));
  w.add(exec('Notify Team (Hot Lead)', P(15, -2), 'handoff'));
  w.add(exec('CRM Sync', P(16, -1), 'crmSync', { wait: false }));
  w.add(exec('Book Appointment', P(13, 0), 'booking'));
  w.add(exec('Send Handoff Message', P(13, 1), 'sender'));
  w.add(exec('Human Handoff', P(14, 1), 'handoff'));
  w.add(pg('Apply Opt-Out (AI detected)', P(13, 2), OPT_OUT_BY_LEAD_SQL, ['$json.lead_id', "'natural_language'"]));
  w.add(exec('CRM Sync (Opt-Out)', P(14, 2), 'crmSync', { wait: false }));
  w.chain('Start', 'Debounce', 'Load Conversation Context', 'Guard & Prepare', 'Over Daily AI Cap?');
  w.link('Over Daily AI Cap?', 'Human Handoff', 0);
  w.link('Over Daily AI Cap?', 'Needs Slots?', 1);
  w.link('Needs Slots?', 'Get Calendar Slots', 0);
  w.link('Needs Slots?', 'Build AI Request', 1);
  w.chain('Get Calendar Slots', 'Build AI Request', 'OpenAI Chat Completion');
  w.link('OpenAI Chat Completion', 'Process Turn', 0);
  w.link('OpenAI Chat Completion', 'AI Failure → Handoff', 1);
  w.link('AI Failure → Handoff', 'Human Handoff');
  w.chain('Process Turn', 'Save AI Turn', 'Merge Turn Result', 'Route Action');
  w.link('Route Action', 'Send Reply', 0);
  w.link('Route Action', 'Book Appointment', 1);
  w.link('Route Action', 'Send Handoff Message', 2);
  w.link('Route Action', 'Apply Opt-Out (AI detected)', 3);
  w.chain('Send Reply', 'Hot Lead Alert?');
  w.link('Hot Lead Alert?', 'Notify Team (Hot Lead)', 0);
  w.link('Hot Lead Alert?', 'CRM Sync', 1);
  w.link('Notify Team (Hot Lead)', 'CRM Sync');
  w.chain('Send Handoff Message', 'Human Handoff');
  w.chain('Apply Opt-Out (AI detected)', 'CRM Sync (Opt-Out)');
  workflows.push(w);
}

// =========================================================================
// 07 · CRM Sync-Back (sub-workflow)
// =========================================================================
{
  const w = new WF('crmSync', '07', 'CRM Sync-Back', 'Sub-workflow. Plans CRM writes from the lead\'s current state (fields, tags, DND, notes with transcript, follow-up tasks, pipeline stage) and executes them through the CRM Adapter (14). Every call is logged to `crm_sync_log`.\n\nInput: `{lead_id, crm_event?}` — events: ai_turn, qualified, hot_alert, handoff, appointment_booked, opted_out, opt_in, forward');
  w.add(subTrigger('Start', P(0, 0)));
  w.add(ifn('Has Lead?', P(1, 0), '!!$json.lead_id'));
  w.add(pg('Load Lead For CRM', P(2, 0), `
select row_to_json(l.*) as lead,
  json_build_object('crm_type', c.crm_type, 'settings', c.settings) as client,
  (select row_to_json(q.*) from qualifications q where q.lead_id = l.id) as qualification,
  coalesce((select json_agg(x order by x.created_at) from (select direction, body, created_at from messages where lead_id = l.id order by created_at desc limit 12) x), '[]') as messages,
  coalesce((select json_agg(distinct s.request->'payload'->>'stage_id') from crm_sync_log s where s.lead_id = l.id and s.op = 'upsert_opportunity' and s.error is null), '[]') as synced_stages,
  (select starts_at from appointments a where a.lead_id = l.id and a.status = 'booked' order by starts_at desc limit 1) as appointment_at
from leads l join clients c on c.id = l.client_id where l.id = $1::uuid`, ['$json.lead_id'], { always: false }));
  w.add(code('Plan CRM Operations', P(3, 0), `
const c = $input.first().json; const start = $('Start').first().json;
const lead = c.lead, client = c.client, s = client.settings || {}, crm = s.crm || {}, q = c.qualification || {};
if (client.crm_type === 'none' || !lead.crm_contact_id) return [];
const event = start.crm_event || 'ai_turn';
const wf = crm.writeback_fields || {}, tags = crm.tags || {};
const fields = {};
const put = (k, v) => { if (wf[k] && v !== undefined && v !== null && v !== '') fields[wf[k]] = v; };
put('lre_status', lead.status); put('lre_score', lead.score); put('lre_temperature', lead.temperature);
put('lre_timeline', q.timeline); put('lre_condition', q.property_condition); put('lre_summary', q.summary);
put('lre_motivation', [q.motivation_level, ...(q.motivation_reasons || [])].filter(Boolean).join(', '));
const ops = [];
if (Object.keys(fields).length) ops.push({ op: 'update_fields', payload: { fields } });
const st = lead.status, t = [];
if (['engaged', 'qualifying'].includes(st)) t.push(tags.engaged);
if (st === 'qualified') t.push(tags.qualified);
if (lead.temperature === 'hot') t.push(tags.hot);
if (st === 'appointment_booked') t.push(tags.booked);
if (st === 'nurture') t.push(tags.nurture);
if (st === 'dnc') t.push(tags.dnc);
if (st === 'wrong_number') t.push(tags.wrong_number);
if (st === 'handed_off') t.push(tags.handoff);
if (t.filter(Boolean).length) ops.push({ op: 'add_tags', payload: { tags: t.filter(Boolean) } });
if (st === 'dnc') ops.push({ op: 'set_dnd', payload: {} });
const noteEvents = ['qualified', 'hot_alert', 'handoff', 'appointment_booked', 'opted_out', 'forward'];
if (noteEvents.includes(event)) {
  const transcript = (c.messages || []).map((m) => (m.direction === 'inbound' ? 'Lead: ' : 'AI: ') + m.body).join('\\n');
  ops.push({ op: 'add_note', payload: { body: ('[Lead Recovery Engine] ' + event.toUpperCase().replace('_', ' ') +
    '\\nStatus: ' + st + ' | Score: ' + lead.score + ' (' + lead.temperature + ')' +
    (c.appointment_at ? '\\nAppointment: ' + c.appointment_at : '') +
    '\\nSummary: ' + (q.summary || '-') +
    '\\nTimeline: ' + (q.timeline || '-') + ' | Motivation: ' + ((q.motivation_reasons || []).join(', ') || '-') +
    ' | Condition: ' + (q.property_condition || '-') + ' | Occupancy: ' + (q.occupancy || '-') +
    ' | Price: ' + (q.price_flexibility || '-') + (q.asking_price ? ' ($' + q.asking_price + ')' : '') +
    '\\n\\nRecent conversation:\\n' + transcript).slice(0, 4900) } });
}
if (['handoff', 'hot_alert', 'appointment_booked'].includes(event)) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.phone_e164;
  const title = event === 'appointment_booked' ? 'Seller call booked: ' + name : event === 'hot_alert' ? 'HOT seller lead: call ' + name : 'Follow up with ' + name + ' (AI handoff)';
  ops.push({ op: 'create_task', payload: { title, body: (q.summary || '') + ' ' + (lead.property_address || ''),
    due_at: event === 'appointment_booked' && c.appointment_at ? c.appointment_at : new Date(Date.now() + 30 * 60000).toISOString(),
    assigned_to: crm.assign_tasks_to || null } });
}
const pipe = crm.pipeline || {}; const stageId = (pipe.stages || {})[st];
if (pipe.id && stageId && !(c.synced_stages || []).includes(stageId)) {
  ops.push({ op: 'upsert_opportunity', payload: { pipeline_id: pipe.id, stage_id: stageId, status: 'open',
    name: ([lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Seller') + ' - ' + (lead.property_address || 'Property') } });
}
return ops.map((o) => ({ json: { ...o, lead_id: lead.id, crm_type: client.crm_type, crm_contact_id: lead.crm_contact_id, location_id: crm.location_id } }));`));
  w.add(exec('CRM Adapter', P(4, 0), 'crmAdapter'));
  w.add(pg('Log CRM Sync', P(5, 0), `
insert into crm_sync_log (lead_id, op, request, http_status, error) values ($1::uuid, $2, $3::jsonb, nullif($4, '')::int, nullif($5, ''))
returning id`, ['$json.lead_id', '$json.op', "JSON.stringify({ payload: $json.payload, request: $json.request })", "String($json.http_status || '')", "$json.error || ''"]));
  w.chain('Start', 'Has Lead?');
  w.link('Has Lead?', 'Load Lead For CRM', 0);
  w.chain('Load Lead For CRM', 'Plan CRM Operations', 'CRM Adapter', 'Log CRM Sync');
  workflows.push(w);
}

// =========================================================================
// 08 · Appointment Booking (sub-workflow + reminders)
// =========================================================================
{
  const w = new WF('booking', '08', 'Appointment Booking', 'Sub-workflow: books the slot the lead accepted (only slots we actually offered), confirms by SMS/email, pauses AI and alerts the team. If the slot was taken, apologizes and hands off.\nAlso: every 15 min sends 24h and 1h reminders.\n\nInput: `{lead_id, decision.selected_slot_iso, body, channel}`');
  w.add(subTrigger('Start', P(0, 0)));
  w.add(pg('Load Lead & Client', P(1, 0), `
select row_to_json(l.*) as lead,
  json_build_object('id', c.id, 'timezone', c.timezone, 'calendar_provider', c.calendar_provider, 'settings', c.settings) as client
from leads l join clients c on c.id = l.client_id where l.id = $1::uuid`, ['$json.lead_id'], { always: false }));
  w.add(code('Prepare Booking', P(2, 0), `
const s = $('Start').first().json; const c = $input.first().json;
return [{ json: { ...c, lead_id: c.lead.id, calendar_op: 'book', slot_iso: s.decision.selected_slot_iso,
  confirmation_text: s.body || s.decision.reply || '', channel: s.channel, slots: s.slots || [] } }];`));
  w.add(exec('Calendar: Book', P(3, 0), 'calAdapter'));
  w.add(ifn('Booked?', P(4, 0), '!!($json.booking && $json.booking.ok)'));
  w.add(pg('Save Appointment', P(5, -1), `
with a as (
  insert into appointments (lead_id, client_id, provider, provider_event_id, starts_at, ends_at)
  values ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz) returning id
)
update leads set status = 'appointment_booked', ai_paused = true where id = $1::uuid
returning (select id from a) as appointment_id`,
  ['$json.lead_id', '$json.client.id', '$json.booking.provider', "$json.booking.provider_event_id || ''", '$json.slot_iso', '$json.booking.ends_at']));
  w.add(code('Confirmation Message', P(6, -1), `
const b = $('Calendar: Book').first().json;
const rep = ((b.client.settings || {}).persona || {}).rep_name || 'our team';
const label = ((b.slots || []).find((x) => x.start_iso === b.slot_iso) || {}).label || b.slot_iso;
const body = b.confirmation_text || ("You're all set for " + label + '. ' + rep + ' will call you then. Talk soon!');
return [{ json: { lead_id: b.lead_id, channel: b.channel, body, purpose: 'conversation', crm_event: 'appointment_booked',
  handoff_mode: 'booked', handoff_reason: 'Appointment booked for ' + label } }];`));
  w.add(code('Slot Taken Message', P(6, 1), `
const b = $('Calendar: Book').first().json;
const rep = ((b.client.settings || {}).persona || {}).rep_name || 'someone from our team';
return [{ json: { lead_id: b.lead_id, channel: b.channel, purpose: 'conversation', crm_event: 'handoff', handoff_mode: 'handoff',
  handoff_reason: 'Booking failed: ' + JSON.stringify(b.booking || {}).slice(0, 200),
  body: 'Looks like that time just got taken, sorry about that! I\\'ll have ' + rep + ' reach out shortly to find a time that works.' } }];`));
  w.add(exec('Send Message', P(7, 0), 'sender'));
  w.add(exec('Notify Team', P(8, 0), 'handoff'));
  w.chain('Start', 'Load Lead & Client', 'Prepare Booking', 'Calendar: Book', 'Booked?');
  w.link('Booked?', 'Save Appointment', 0);
  w.link('Booked?', 'Slot Taken Message', 1);
  w.chain('Save Appointment', 'Confirmation Message', 'Send Message');
  w.chain('Slot Taken Message', 'Send Message');
  w.chain('Send Message', 'Notify Team');
  // Reminders
  w.add(schedule('Every 15 Minutes', P(0, 4), 15));
  w.add(pg('Claim Due Reminders', P(1, 4), `
with due as (
  select a.id, a.lead_id, a.starts_at,
         case when a.starts_at <= now() + interval '75 minutes' then '1h' else '24h' end as kind
  from appointments a join leads l on l.id = a.lead_id
  where a.status = 'booked' and l.opted_out = false and (
    (a.starts_at between now() + interval '23 hours' and now() + interval '25 hours' and a.reminder_24h_sent_at is null) or
    (a.starts_at between now() + interval '45 minutes' and now() + interval '75 minutes' and a.reminder_1h_sent_at is null))
), mark as (
  update appointments a set
    reminder_24h_sent_at = case when d.kind = '24h' then now() else a.reminder_24h_sent_at end,
    reminder_1h_sent_at  = case when d.kind = '1h'  then now() else a.reminder_1h_sent_at end
  from due d where a.id = d.id returning a.id
)
select d.lead_id, d.kind, d.starts_at, l.first_name, l.phone_e164, l.property_state, l.timezone as lead_timezone,
       k.timezone as client_timezone, k.settings->'persona'->>'rep_name' as rep_name
from due d join leads l on l.id = d.lead_id join clients k on k.id = l.client_id`, null, { always: false }));
  w.add(code('Render Reminder', P(2, 4), `
return $input.all().map((it) => {
  const r = it.json;
  const tz = timezonesFor({ property_state: r.property_state, timezone: r.lead_timezone }, { timezone: r.client_timezone })[0];
  const when = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(r.starts_at));
  const rep = r.rep_name || 'our team';
  const body = r.kind === '24h'
    ? 'Hi ' + (r.first_name || 'there') + ', just a reminder ' + rep + ' will call you ' + when + '. Reply here if you need to reschedule.'
    : 'Hi ' + (r.first_name || 'there') + ', ' + rep + ' will be calling you in about an hour (' + when + ').';
  return { json: { lead_id: r.lead_id, channel: r.phone_e164 ? 'sms' : 'email', body, purpose: 'reminder', subject: 'Reminder: our call ' + when } };
});`, { libs: true }));
  w.add(exec('Send Reminder', P(3, 4), 'sender'));
  w.chain('Every 15 Minutes', 'Claim Due Reminders', 'Render Reminder', 'Send Reminder');
  workflows.push(w);
}

// =========================================================================
// 09 · Human Handoff (sub-workflow + resume endpoint)
// =========================================================================
{
  const w = new WF('handoff', '09', 'Human Handoff', 'Sub-workflow. Pauses the AI for the lead (except hot alerts), records a handoff, and alerts the sales team on Slack + email with score, qualification and the recent transcript. Creates a CRM task/note via CRM Sync.\nModes: handoff · forward · booked · hot_alert · hostile · unknown_sender\n\nAlso: signed "Resume AI" link endpoint so a rep can hand the lead back to the AI.');
  w.add(subTrigger('Start', P(0, 0)));
  w.add(pg('Apply Handoff & Load Summary', P(1, 0), `
with l0 as (select * from leads where id = $1::uuid),
upd as (
  update leads set
    ai_paused = case when $2 = 'hot_alert' then ai_paused else true end,
    status = case when $2 in ('handoff', 'hostile', 'unknown_sender') and status not in ('appointment_booked', 'dnc') then 'handed_off' else status end
  where id = $1::uuid returning id
),
h as (insert into handoffs (lead_id, mode, reason) values ($1::uuid, $2, $3) returning id)
select row_to_json(l0.*) as lead,
  (select row_to_json(q.*) from qualifications q where q.lead_id = l0.id) as qualification,
  json_build_object('name', c.name, 'settings', c.settings) as client,
  coalesce((select json_agg(x order by x.created_at) from (select direction, body, created_at from messages where lead_id = l0.id order by created_at desc limit 8) x), '[]') as messages,
  (select count(*) from handoffs hh where hh.lead_id = l0.id and hh.mode = 'hot_alert' and hh.created_at > now() - interval '24 hours') as prior_hot_alerts_24h,
  (select id from h) as handoff_id
from l0 join clients c on c.id = l0.client_id`,
  ['$json.lead_id', "$json.handoff_mode || 'handoff'", "$json.handoff_reason || ($json.decision && $json.decision.handoff_reason) || ''"], { always: false }));
  w.add(code('Compose Notification', P(2, 0), `
const crypto = require('crypto');
const c = $input.first().json; const start = $('Start').first().json;
const mode = start.handoff_mode || 'handoff';
if (mode === 'hot_alert' && Number(c.prior_hot_alerts_24h) > 0) return [];
const lead = c.lead, q = c.qualification || {}, s = c.client.settings || {}, h = s.handoff || {};
const reason = start.handoff_reason || (start.decision && start.decision.handoff_reason) || mode;
const titles = { handoff: ':raising_hand: Lead needs a human', forward: ':speech_balloon: New reply from a lead you own', booked: ':calendar: Appointment booked',
  hot_alert: ':fire: HOT seller lead', hostile: ':warning: Hostile / legal-risk reply', unknown_sender: ':grey_question: Reply from unknown number' };
const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown';
const transcript = (c.messages || []).map((m) => (m.direction === 'inbound' ? '> *Lead:* ' : '> _AI:_ ') + m.body).join('\\n');
const sig = crypto.createHmac('sha256', $env.LRE_INTERNAL_API_KEY || '').update(lead.id).digest('hex').slice(0, 32);
const resume = ($env.APP_BASE_URL || '') + '/webhook/lre/admin/resume-ai?lead_id=' + lead.id + '&sig=' + sig;
const text = '*' + (titles[mode] || 'Lead alert') + '* - ' + c.client.name +
  '\\n*' + name + '*  ' + (lead.phone_e164 || '') + '  ' + (lead.email || '') +
  '\\n:house: ' + (lead.property_address || '-') +
  '\\nScore *' + lead.score + '* (' + lead.temperature + ') | Status: ' + lead.status +
  '\\nReason: ' + reason +
  '\\nTimeline: ' + (q.timeline || '-') + ' | Motivation: ' + ((q.motivation_reasons || []).join(', ') || '-') + ' | Condition: ' + (q.property_condition || '-') +
  '\\nSummary: ' + (q.summary || '-') + '\\n\\n' + transcript +
  (mode === 'hot_alert' ? '' : '\\n\\n<' + resume + '|Hand back to AI>');
const em = s.email || {};
const emails = (h.notify_emails || []).filter(Boolean);
const email_payload = emails.length ? {
  personalizations: [{ to: emails.map((e) => ({ email: e })) }],
  from: { email: em.from_address, name: 'Lead Recovery Engine' },
  subject: (titles[mode] || 'Lead alert').replace(/:[a-z_]+:\\s*/g, '') + ': ' + name,
  content: [{ type: 'text/plain', value: text.replace(/[*_>]/g, '').replace(/<([^|]+)\\|[^>]+>/g, '$1') }],
} : null;
const crm_event = mode === 'booked' ? 'appointment_booked' : mode === 'unknown_sender' || mode === 'hostile' ? 'handoff' : mode;
return [{ json: { lead_id: lead.id, mode, slack_url: $env[h.slack_webhook_env || 'SLACK_WEBHOOK_URL_HANDOFF'] || '', slack_text: text, email_payload, crm_event } }];`));
  w.add(ifn('Slack Configured?', P(3, 0), '!!$json.slack_url'));
  w.add(http('Post to Slack', P(4, -1), { url: '={{ $json.slack_url }}', json: '={{ JSON.stringify({ text: $json.slack_text }) }}', onError: 'continueRegularOutput' }));
  w.add(code('After Slack', P(5, 0), `return [{ json: $('Compose Notification').first().json }];`));
  w.add(ifn('Email Configured?', P(6, 0), '!!$json.email_payload'));
  w.add(http('Email Team', P(7, -1), { url: 'https://api.sendgrid.com/v3/mail/send', cred: 'sendgrid', json: '={{ JSON.stringify($json.email_payload) }}', onError: 'continueRegularOutput' }));
  w.add(code('Prepare CRM Sync', P(8, 0), `const n = $('Compose Notification').first().json; return [{ json: { lead_id: n.lead_id, crm_event: n.crm_event, handed_off: true } }];`));
  w.add(exec('CRM Sync', P(9, 0), 'crmSync', { wait: false }));
  w.chain('Start', 'Apply Handoff & Load Summary', 'Compose Notification', 'Slack Configured?');
  w.link('Slack Configured?', 'Post to Slack', 0);
  w.link('Slack Configured?', 'After Slack', 1);
  w.chain('Post to Slack', 'After Slack', 'Email Configured?');
  w.link('Email Configured?', 'Email Team', 0);
  w.link('Email Configured?', 'Prepare CRM Sync', 1);
  w.chain('Email Team', 'Prepare CRM Sync', 'CRM Sync');
  // Resume AI
  w.add(webhook('Resume AI Link', P(0, 4), 'lre/admin/resume-ai', { method: 'GET', respond: 'responseNode' }));
  w.add(code('Verify Signature', P(1, 4), `
const crypto = require('crypto');
const q = $input.first().json.query || {};
const expected = crypto.createHmac('sha256', $env.LRE_INTERNAL_API_KEY || '').update(String(q.lead_id || '')).digest('hex').slice(0, 32);
if (!q.lead_id || q.sig !== expected) throw new Error('Invalid resume-ai signature');
return [{ json: { lead_id: q.lead_id } }];`));
  w.add(pg('Resume AI For Lead', P(2, 4), `
with h as (update handoffs set resolved_at = now() where lead_id = $1::uuid and resolved_at is null)
update leads set ai_paused = false, status = case when status = 'handed_off' then 'engaged' else status end
where id = $1::uuid and status not in ('dnc', 'wrong_number', 'bad_number') returning id, status`, ['$json.lead_id']));
  w.add(respond('Resumed Page', P(3, 4), '<html><body style="font-family:Arial;padding:40px"><h2>AI resumed for this lead.</h2><p>The assistant will answer the next message from this lead.</p></body></html>', 'text/html'));
  w.chain('Resume AI Link', 'Verify Signature', 'Resume AI For Lead', 'Resumed Page');
  workflows.push(w);
}

// =========================================================================
// 10 · Cadence Runner
// =========================================================================
{
  const w = new WF('cadence', '10', 'Cadence Runner', 'Every 10 min.\nA) Claims due campaign touches (row locks, safe to run concurrently), renders templates, sends via Outbound Sender, then advances / defers (quiet hours) / stops each enrollment.\nB) Finds stalled conversations (lead stopped replying) and nurture leads whose follow-up date arrived, and asks the AI for a context-aware nudge.\nC) Parks conversations that exhausted their nudges into 30-day nurture.');
  w.add(schedule('Every 10 Minutes', P(0, 0), 10));
  w.add(pg('Claim Due Touches', P(1, -1), `
with due as (
  select e.id from campaign_enrollments e
  join leads l on l.id = e.lead_id
  join campaigns c on c.id = e.campaign_id
  where e.status = 'active' and c.status = 'active' and e.next_touch_at <= now()
    and (e.locked_until is null or e.locked_until < now())
    and l.status in ('queued', 'contacted') and l.opted_out = false and l.ai_paused = false
  order by e.next_touch_at limit 150
  for update of e skip locked
), claimed as (
  update campaign_enrollments e set locked_until = now() + interval '15 minutes' from due where e.id = due.id returning e.*
)
select cl.id as enrollment_id, cl.step_index, cl.enrolled_at, row_to_json(l.*) as lead,
  json_build_object('id', c.id, 'steps', c.steps) as campaign,
  json_build_object('id', k.id, 'timezone', k.timezone, 'settings', k.settings) as client
from claimed cl join leads l on l.id = cl.lead_id join campaigns c on c.id = cl.campaign_id join clients k on k.id = l.client_id`, null, { always: false }));
  w.add(code('Render Touches', P(2, -1), `
return $input.all().map((it) => {
  const j = it.json; const steps = j.campaign.steps || []; const step = steps[j.step_index];
  const next = computeNextTouch(steps, j.step_index, j.enrolled_at, j.lead.id, new Date());
  const base = { enrollment_id: j.enrollment_id, lead_id: j.lead.id, purpose: 'campaign', campaign_step: j.step_index,
    next_step_index: next ? next.step_index : null, next_due_at: next ? next.due_at : null };
  if (!step) return { json: { ...base, body: '' } };
  const t = renderTouch(step, j.lead, j.client);
  return { json: { ...base, channel: t.channel, body: t.skip ? '' : t.body, subject: t.subject } };
});`, { libs: true }));
  w.add(exec('Send Touch', P(3, -1), 'sender'));
  w.add(code('Compute Enrollment Update', P(4, -1), `
return $input.all().map((it) => {
  const j = it.json; let action;
  if (j.sent) action = 'advance';
  else if (j.deferred_until) action = 'defer';
  else if (['empty_body', 'no_phone', 'no_email', 'provider_error'].includes(j.reason)) action = 'advance';
  else action = 'stop';
  return { json: { enrollment_id: j.enrollment_id, action, next_step_index: j.next_step_index == null ? '' : String(j.next_step_index),
    next_due_at: j.next_due_at || '', deferred_until: j.deferred_until ? new Date(j.deferred_until).toISOString() : '', reason: j.reason || '' } };
});`));
  w.add(pg('Update Enrollment', P(5, -1), `
update campaign_enrollments set
  step_index    = case when $2 = 'advance' and $3 <> '' then $3::int else step_index end,
  next_touch_at = case when $2 = 'advance' and $4 <> '' then $4::timestamptz when $2 = 'defer' then $5::timestamptz else next_touch_at end,
  status        = case when $2 = 'stop' then 'stopped' when $2 = 'advance' and $3 = '' then 'completed' else status end,
  stopped_reason = case when $2 = 'stop' then $6 else stopped_reason end,
  locked_until  = null
where id = $1::uuid returning id, status`,
  ['$json.enrollment_id', '$json.action', '$json.next_step_index', '$json.next_due_at', '$json.deferred_until', '$json.reason']));
  w.add(pg('Find Stalled & Due-Nurture Leads', P(1, 1), `
select l.id as lead_id, 'nudge' as mode, case when l.phone_e164 is not null then 'sms' else 'email' end as channel
from leads l join clients c on c.id = l.client_id
where c.active and l.ai_paused = false and l.opted_out = false and (
  (l.status in ('engaged', 'qualifying', 'qualified')
    and l.last_outbound_at > coalesce(l.last_inbound_at, 'epoch')
    and l.last_outbound_at < now() - make_interval(hours => coalesce((c.settings->'messaging'->>'nudge_after_hours')::int, 24))
    and l.nudge_count < coalesce((c.settings->'messaging'->>'max_nudges')::int, 2))
  or (l.status = 'nurture' and l.nurture_until is not null and l.nurture_until <= current_date)
)
order by l.score desc limit 50`, null, { always: false }));
  w.add(exec('AI Nudge', P(2, 1), 'ai', { wait: false }));
  w.add(pg('Park Exhausted Conversations', P(1, 3), `
update leads l set status = 'nurture', nurture_until = current_date + 30, nudge_count = 0
from clients c
where c.id = l.client_id and l.status in ('engaged', 'qualifying')
  and l.nudge_count >= coalesce((c.settings->'messaging'->>'max_nudges')::int, 2)
  and l.last_outbound_at < now() - interval '3 days'
  and l.last_outbound_at > coalesce(l.last_inbound_at, 'epoch')
returning l.id`, null));
  w.link('Every 10 Minutes', 'Claim Due Touches');
  w.link('Every 10 Minutes', 'Find Stalled & Due-Nurture Leads');
  w.link('Every 10 Minutes', 'Park Exhausted Conversations');
  w.chain('Claim Due Touches', 'Render Touches', 'Send Touch', 'Compute Enrollment Update', 'Update Enrollment');
  w.chain('Find Stalled & Due-Nurture Leads', 'AI Nudge');
  workflows.push(w);
}

// =========================================================================
// 11 · Error Handler
// =========================================================================
{
  const w = new WF('error', '11', 'Error Handler', 'Set as the Error Workflow of every LRE workflow (done automatically by the build). Logs every failure to `workflow_errors` and alerts Slack — de-duplicated by error signature so a recurring failure alerts once per 15 minutes, not 500 times.');
  w.add(errorTrigger('On Workflow Error', P(0, 0)));
  w.add(code('Format Error', P(1, 0), `
const e = $input.first().json; const wf = e.workflow || {}; const ex = e.execution || {}; const err = ex.error || {};
const message = String(err.message || 'unknown error').slice(0, 2000);
const signature = (wf.name || '') + '|' + (ex.lastNodeExecuted || '') + '|' + message.replace(/[0-9a-f-]{8,}/gi, '#').replace(/\\d+/g, '#').slice(0, 160);
return [{ json: { workflow_name: wf.name || '', node_name: ex.lastNodeExecuted || '', execution_id: String(ex.id || ''), message, signature, url: ex.url || '', payload: { error: err, mode: ex.mode } } }];`));
  w.add(pg('Log Error', P(2, 0), `
with prior as (select count(*) as n from workflow_errors where signature = $5 and created_at > now() - interval '15 minutes'),
ins as (insert into workflow_errors (workflow_name, node_name, execution_id, message, signature, payload) values ($1, $2, $3, $4, $5, $6::jsonb) returning id)
select (select n from prior) as prior_count`,
  ['$json.workflow_name', '$json.node_name', '$json.execution_id', '$json.message', '$json.signature', 'JSON.stringify($json.payload)']));
  w.add(ifn('First In 15 Min?', P(3, 0), 'Number($json.prior_count) === 0 && !!$env.SLACK_WEBHOOK_URL_ALERTS'));
  w.add(http('Alert Slack', P(4, 0), {
    url: '={{ $env.SLACK_WEBHOOK_URL_ALERTS }}',
    json: "={{ JSON.stringify({ text: ':rotating_light: *LRE workflow error*\\n*' + $('Format Error').item.json.workflow_name + '* → node `' + $('Format Error').item.json.node_name + '`\\n' + $('Format Error').item.json.message.slice(0, 500) + '\\n' + $('Format Error').item.json.url }) }}",
    onError: 'continueRegularOutput',
  }));
  w.chain('On Workflow Error', 'Format Error', 'Log Error', 'First In 15 Min?');
  w.link('First In 15 Min?', 'Alert Slack', 0);
  workflows.push(w);
}

// =========================================================================
// 12 · Daily Health Report & Heartbeat
// =========================================================================
{
  const w = new WF('health', '12', 'Health Report & Heartbeat', 'Daily 8:00 AM: per-client KPIs (contacted, reply rate, qualified, booked, opt-outs, failures, AI tokens) to Slack.\nHourly: pings HEALTHCHECK_URL (dead-man switch — alerts you if n8n itself is down) and alerts on items needing attention.');
  w.add(cron('Daily 8 AM', P(0, 0), '0 8 * * *'));
  w.add(pg('Load KPIs', P(1, 0), `
select k.client_name, k.leads_contacted, k.messages_sent, k.leads_replied, k.newly_qualified, k.appointments_booked,
  k.handoffs, k.opt_outs, k.delivery_failures, k.prompt_tokens, k.completion_tokens,
  f.reply_rate_pct, f.booking_rate_pct, f.hot, f.booked as booked_total,
  (select count(*) from workflow_errors where created_at > now() - interval '24 hours') as errors_24h,
  (select count(*) from v_attention_needed) as attention_items
from v_daily_kpis k join v_funnel f on f.client_id = k.client_id
where k.day = current_date - 1`, null, { always: false }));
  w.add(code('Compose Report', P(2, 0), `
const rows = $input.all().map((i) => i.json);
if (!rows.length) return [];
const lines = rows.map((r) => '*' + r.client_name + '*\\n' +
  '  Contacted ' + r.leads_contacted + ' | Replies ' + r.leads_replied + ' | Newly qualified ' + r.newly_qualified +
  ' | Booked ' + r.appointments_booked + ' | Handoffs ' + r.handoffs + '\\n' +
  '  Opt-outs ' + r.opt_outs + ' | Delivery failures ' + r.delivery_failures + ' | AI tokens ' + (Number(r.prompt_tokens) + Number(r.completion_tokens)) + '\\n' +
  '  All-time: reply rate ' + (r.reply_rate_pct || 0) + '% | booking rate ' + (r.booking_rate_pct || 0) + '% | hot ' + r.hot + ' | booked ' + r.booked_total);
const text = ':bar_chart: *Lead Recovery Engine - yesterday*\\n' + lines.join('\\n\\n') +
  '\\n\\nErrors (24h): ' + rows[0].errors_24h + ' | Items needing attention: ' + rows[0].attention_items;
return [{ json: { text } }];`));
  w.add(http('Post Report', P(3, 0), { url: '={{ $env.SLACK_WEBHOOK_URL_ALERTS }}', json: '={{ JSON.stringify({ text: $json.text }) }}', onError: 'continueRegularOutput' }));
  w.chain('Daily 8 AM', 'Load KPIs', 'Compose Report', 'Post Report');
  w.add(schedule('Every Hour', P(0, 3), 60));
  w.add(pg('Health Check', P(1, 3), `
select (select count(*) from v_attention_needed) as attention,
  (select count(*) from workflow_errors where created_at > now() - interval '1 hour') as errors_1h,
  (select count(*) from messages where direction = 'outbound' and status in ('failed', 'undelivered') and created_at > now() - interval '1 hour') as failed_1h,
  (select count(*) from messages where direction = 'outbound' and created_at > now() - interval '1 hour') as sent_1h`));
  w.add(http('Ping Healthcheck', P(2, 2), { method: 'GET', url: "={{ $env.HEALTHCHECK_URL || 'https://hc-ping.com/not-configured' }}", onError: 'continueRegularOutput', retry: false }));
  w.add(ifn('Anomaly?', P(2, 4), 'Number($json.errors_1h) > 10 || Number($json.attention) > 0 || (Number($json.sent_1h) > 20 && Number($json.failed_1h) / Number($json.sent_1h) > 0.15)'));
  w.add(http('Alert Anomaly', P(3, 4), {
    url: '={{ $env.SLACK_WEBHOOK_URL_ALERTS }}',
    json: "={{ JSON.stringify({ text: ':warning: LRE health: ' + $json.errors_1h + ' errors/1h, ' + $json.failed_1h + '/' + $json.sent_1h + ' failed sends/1h, ' + $json.attention + ' items need attention (see v_attention_needed).' }) }}",
    onError: 'continueRegularOutput',
  }));
  w.link('Every Hour', 'Health Check');
  w.link('Health Check', 'Ping Healthcheck');
  w.link('Health Check', 'Anomaly?');
  w.link('Anomaly?', 'Alert Anomaly', 0);
  workflows.push(w);
}

// =========================================================================
// 13 · Delivery Status Webhooks
// =========================================================================
{
  const w = new WF('status', '13', 'Delivery Status Webhooks', 'Twilio status callbacks + SendGrid Event Webhook. Updates message delivery status; marks invalid/landline numbers `bad_number`, carrier-level STOPs `dnc`; email bounces, spam reports and unsubscribes become suppressions.\n\nTwilio StatusCallback: `{APP_BASE_URL}/webhook/lre/sms/status` (set automatically per message)\nSendGrid Event Webhook: `{APP_BASE_URL}/webhook/lre/email/events?key={LRE_INBOUND_EMAIL_KEY}`');
  w.add(webhook('Twilio Status Callback', P(0, 0), 'lre/sms/status'));
  w.add(code('Parse Twilio Status', P(1, 0), `
const crypto = require('crypto');
const req = $input.first().json; const p = req.body || {};
if ($env.TWILIO_VALIDATE_SIGNATURE !== 'false') {
  const url = ($env.APP_BASE_URL || '') + '/webhook/lre/sms/status';
  const data = url + Object.keys(p).sort().map((k) => k + p[k]).join('');
  const expected = crypto.createHmac('sha1', $env.TWILIO_AUTH_TOKEN || '').update(Buffer.from(data, 'utf-8')).digest('base64');
  if ((req.headers || {})['x-twilio-signature'] !== expected) throw new Error('Invalid Twilio signature on status callback');
}
return [{ json: { sid: p.MessageSid || p.SmsSid, status: p.MessageStatus || p.SmsStatus, error_code: p.ErrorCode ? String(p.ErrorCode) : '' } }];`));
  w.add(pg('Update SMS Status', P(2, 0), `
with m as (update messages set status = $2, error_code = nullif($3, '') where provider_message_id = $1 returning lead_id, client_id, to_address),
o as (
  insert into opt_outs (client_id, channel, value, source)
  select client_id, 'sms', to_address, 'carrier' from m where $3 = '21610' on conflict do nothing
)
update leads set
  status = case when $3 in ('21211', '21614', '30005', '30006') then 'bad_number' when $3 = '21610' then 'dnc' else status end,
  opted_out = case when $3 = '21610' then true else opted_out end
where id = (select lead_id from m) and $3 <> ''
returning id`, ['$json.sid', '$json.status', '$json.error_code']));
  w.chain('Twilio Status Callback', 'Parse Twilio Status', 'Update SMS Status');
  w.add(webhook('SendGrid Event Webhook', P(0, 3), 'lre/email/events'));
  w.add(code('Explode Email Events', P(1, 3), `
const req = $input.first().json;
if (!$env.LRE_INBOUND_EMAIL_KEY || (req.query || {}).key !== $env.LRE_INBOUND_EMAIL_KEY) throw new Error('Email events: bad key');
const events = Array.isArray(req.body) ? req.body : [];
const keep = ['delivered', 'bounce', 'dropped', 'spamreport', 'unsubscribe', 'group_unsubscribe'];
return events.filter((e) => keep.includes(e.event)).map((e) => ({ json: {
  provider_message_id: 'email:' + String(e.sg_message_id || '').split('.')[0], event: e.event,
  email: String(e.email || '').toLowerCase(), lead_id: e.lre_lead_id || '' } }));`));
  w.add(pg('Apply Email Event', P(2, 3), `
with m as (
  update messages set status = case when $2 = 'delivered' then 'delivered' when $2 in ('bounce', 'dropped') then 'failed' else status end
  where provider_message_id = $1 returning lead_id, client_id
), l as (select id, client_id from leads where id = coalesce((select lead_id from m), nullif($4, '')::uuid)),
o as (
  insert into opt_outs (client_id, channel, value, source)
  select client_id, 'email', $3, case when $2 = 'spamreport' then 'spam_report' when $2 in ('bounce', 'dropped') then 'bounce' else 'email_unsubscribe' end
  from l where $2 in ('bounce', 'dropped', 'spamreport', 'unsubscribe', 'group_unsubscribe') on conflict do nothing
)
update leads set opted_out = true, status = 'dnc'
where id = (select id from l) and $2 in ('spamreport', 'unsubscribe', 'group_unsubscribe')
returning id`, ['$json.provider_message_id', '$json.event', '$json.email', '$json.lead_id']));
  w.chain('SendGrid Event Webhook', 'Explode Email Events', 'Apply Email Event');
  workflows.push(w);
}

// =========================================================================
// 14 · CRM Adapter (sub-workflow)
// =========================================================================
{
  const w = new WF('crmAdapter', '14', 'CRM Adapter', 'Sub-workflow. Translates one generic CRM operation into a GoHighLevel (API v2) or HubSpot (CRM v3) API call. Add a new CRM by adding a branch here — nothing else changes.\n\nOps: update_fields · add_tags · set_dnd · add_note · create_task · upsert_opportunity\nInput: `{crm_type, crm_contact_id, location_id, op, payload, lead_id}`');
  w.add(subTrigger('Start', P(0, 0)));
  w.add(sw('By CRM', P(1, 0), '$json.crm_type', ['ghl', 'hubspot']));
  w.add(code('Build GHL Request', P(2, -1), `
const j = $input.first().json; const base = 'https://services.leadconnectorhq.com';
const id = j.crm_contact_id; const p = j.payload || {}; let r;
switch (j.op) {
  case 'update_fields': r = { method: 'PUT', url: base + '/contacts/' + id, body: { customFields: Object.entries(p.fields).map(([k, v]) => ({ id: k, field_value: v })) } }; break;
  case 'add_tags': r = { method: 'POST', url: base + '/contacts/' + id + '/tags', body: { tags: p.tags } }; break;
  case 'set_dnd': r = { method: 'PUT', url: base + '/contacts/' + id, body: { dnd: true } }; break;
  case 'add_note': r = { method: 'POST', url: base + '/contacts/' + id + '/notes', body: { body: p.body } }; break;
  case 'create_task': r = { method: 'POST', url: base + '/contacts/' + id + '/tasks', body: Object.assign({ title: p.title, body: p.body, dueDate: p.due_at, completed: false }, p.assigned_to ? { assignedTo: p.assigned_to } : {}) }; break;
  case 'upsert_opportunity': r = { method: 'POST', url: base + '/opportunities/upsert', body: { locationId: j.location_id, contactId: id, pipelineId: p.pipeline_id, pipelineStageId: p.stage_id, name: p.name, status: p.status } }; break;
  default: throw new Error('Unsupported GHL op: ' + j.op);
}
return [{ json: { ...j, request: r } }];`));
  w.add(code('Build HubSpot Request', P(2, 1), `
const j = $input.first().json; const base = 'https://api.hubapi.com';
const id = j.crm_contact_id; const p = j.payload || {};
const assoc = (typeId) => [{ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }] }];
let r;
switch (j.op) {
  case 'update_fields': r = { method: 'PATCH', url: base + '/crm/v3/objects/contacts/' + id, body: { properties: p.fields } }; break;
  // HubSpot has no tags: we store them in a multi-checkbox contact property "lre_tags".
  case 'add_tags': r = { method: 'PATCH', url: base + '/crm/v3/objects/contacts/' + id, body: { properties: { lre_tags: p.tags.join(';') } } }; break;
  case 'set_dnd': r = { method: 'PATCH', url: base + '/crm/v3/objects/contacts/' + id, body: { properties: { lre_do_not_contact: 'true' } } }; break;
  case 'add_note': r = { method: 'POST', url: base + '/crm/v3/objects/notes', body: { properties: { hs_timestamp: new Date().toISOString(), hs_note_body: p.body.replace(/\\n/g, '<br>') }, associations: assoc(202) } }; break;
  case 'create_task': r = { method: 'POST', url: base + '/crm/v3/objects/tasks', body: { properties: Object.assign({ hs_timestamp: p.due_at, hs_task_subject: p.title, hs_task_body: p.body, hs_task_status: 'NOT_STARTED', hs_task_priority: 'HIGH' }, p.assigned_to ? { hubspot_owner_id: p.assigned_to } : {}), associations: assoc(204) } }; break;
  case 'upsert_opportunity': r = { method: 'POST', url: base + '/crm/v3/objects/deals', body: { properties: { dealname: p.name, pipeline: p.pipeline_id, dealstage: p.stage_id }, associations: assoc(3) } }; break;
  default: throw new Error('Unsupported HubSpot op: ' + j.op);
}
return [{ json: { ...j, request: r } }];`));
  w.add(http('GHL API', P(3, -1), { method: '={{ $json.request.method }}', url: '={{ $json.request.url }}', cred: 'ghl', headers: { Version: '2021-07-28' }, json: '={{ JSON.stringify($json.request.body) }}', onError: 'continueErrorOutput' }));
  w.add(http('HubSpot API', P(3, 1), { method: '={{ $json.request.method }}', url: '={{ $json.request.url }}', cred: 'hubspot', json: '={{ JSON.stringify($json.request.body) }}', onError: 'continueErrorOutput' }));
  for (const [crm, row] of [['GHL', -1], ['HubSpot', 1]]) {
    w.add(code(`${crm} OK`, P(4, row - 0.5), `const j = $('Build ${crm} Request').first().json; return [{ json: { ...j, http_status: 200, error: '' } }];`));
    w.add(code(`${crm} Failed`, P(4, row + 0.5), `const j = $('Build ${crm} Request').first().json; return [{ json: { ...j, http_status: 0, error: JSON.stringify($input.first().json.error || $input.first().json).slice(0, 1000) } }];`));
  }
  w.chain('Start', 'By CRM');
  w.link('By CRM', 'Build GHL Request', 0);
  w.link('By CRM', 'Build HubSpot Request', 1);
  w.chain('Build GHL Request', 'GHL API');
  w.chain('Build HubSpot Request', 'HubSpot API');
  w.link('GHL API', 'GHL OK', 0); w.link('GHL API', 'GHL Failed', 1);
  w.link('HubSpot API', 'HubSpot OK', 0); w.link('HubSpot API', 'HubSpot Failed', 1);
  workflows.push(w);
}

// =========================================================================
// 15 · Calendar Adapter (sub-workflow)
// =========================================================================
{
  const w = new WF('calAdapter', '15', 'Calendar Adapter', 'Sub-workflow. Gets real availability or books an appointment on GoHighLevel Calendars or Cal.com. Slots are thinned to one morning + one afternoon option per day and labelled in the lead\'s time zone.\n\nInput: `{calendar_op: get_slots|book, client, lead, slot_iso?}` → returns input + `slots[]` or `booking{ok,…}`');
  w.add(subTrigger('Start', P(0, 0)));
  w.add(sw('By Provider', P(1, 0), "$json.client.calendar_provider || (($json.client.settings || {}).calendar || {}).provider || 'none'", ['ghl', 'calcom']));
  w.add(code('Build GHL Calendar Request', P(2, -1), `
const j = $input.first().json; const s = j.client.settings || {}; const cal = s.calendar || {}; const crm = s.crm || {};
const tz = timezonesFor(j.lead, j.client)[0]; const base = 'https://services.leadconnectorhq.com';
let r;
if (j.calendar_op === 'get_slots') {
  const start = Date.now() + (cal.min_notice_hours || 2) * 3600000; const end = start + (cal.booking_window_days || 5) * 86400000;
  r = { method: 'GET', url: base + '/calendars/' + cal.calendar_id + '/free-slots?startDate=' + start + '&endDate=' + end + '&timezone=' + encodeURIComponent(tz), body: {} };
} else {
  const endIso = new Date(new Date(j.slot_iso).getTime() + (cal.duration_minutes || 15) * 60000).toISOString();
  r = { method: 'POST', url: base + '/calendars/events/appointments', ends_at: endIso, body: {
    calendarId: cal.calendar_id, locationId: crm.location_id, contactId: j.lead.crm_contact_id, startTime: j.slot_iso, endTime: endIso,
    title: 'Seller call: ' + ([j.lead.first_name, j.lead.last_name].filter(Boolean).join(' ') || 'Lead') + ' - ' + (j.lead.property_address || ''),
    appointmentStatus: 'confirmed', toNotify: true } };
}
return [{ json: { ...j, tz, request: r } }];`, { libs: true }));
  w.add(code('Build Cal.com Request', P(2, 1), `
const j = $input.first().json; const s = j.client.settings || {}; const cal = s.calendar || {}; const em = s.email || {};
const tz = timezonesFor(j.lead, j.client)[0]; const base = 'https://api.cal.com/v2';
let r;
if (j.calendar_op === 'get_slots') {
  const start = new Date(Date.now() + (cal.min_notice_hours || 2) * 3600000); const end = new Date(start.getTime() + (cal.booking_window_days || 5) * 86400000);
  r = { method: 'GET', api_version: '2024-09-04', url: base + '/slots?eventTypeId=' + cal.calendar_id + '&start=' + start.toISOString() + '&end=' + end.toISOString() + '&timeZone=' + encodeURIComponent(tz), body: {} };
} else {
  const endIso = new Date(new Date(j.slot_iso).getTime() + (cal.duration_minutes || 15) * 60000).toISOString();
  r = { method: 'POST', api_version: '2024-08-13', url: base + '/bookings', ends_at: endIso, body: {
    start: j.slot_iso, eventTypeId: Number(cal.calendar_id),
    attendee: { name: [j.lead.first_name, j.lead.last_name].filter(Boolean).join(' ') || 'Property Owner',
      email: j.lead.email || ('lead-' + j.lead.id + '@' + (em.reply_domain || 'example.com')), timeZone: tz, phoneNumber: j.lead.phone_e164 || undefined },
    metadata: { lre_lead_id: j.lead.id } } };
}
return [{ json: { ...j, tz, request: r } }];`, { libs: true }));
  w.add(http('GHL Calendar API', P(3, -1), { method: '={{ $json.request.method }}', url: '={{ $json.request.url }}', cred: 'ghl', headers: { Version: '2021-04-15' }, json: '={{ JSON.stringify($json.request.body) }}', sendBody: "={{ $json.request.method !== 'GET' }}", onError: 'continueErrorOutput' }));
  w.add(http('Cal.com API', P(3, 1), { method: '={{ $json.request.method }}', url: '={{ $json.request.url }}', cred: 'calcom', headers: { 'cal-api-version': '={{ $json.request.api_version }}' }, json: '={{ JSON.stringify($json.request.body) }}', sendBody: "={{ $json.request.method !== 'GET' }}", onError: 'continueErrorOutput' }));
  const normalize = (provider, src) => `
const j = $('${src}').first().json; const raw = $input.first().json;
const max = ((j.client.settings || {}).calendar || {}).slots_to_offer || 4;
if (j.calendar_op === 'get_slots') {
  return [{ json: { ...j, request: undefined, slots: pickSlots(extractSlotStarts(raw, '${provider}'), j.tz, max, Date.now()) } }];
}
const ev = '${provider}' === 'ghl' ? (raw.id || (raw.appointment || {}).id) : ((raw.data || {}).uid || (raw.data || {}).id);
return [{ json: { ...j, request: undefined, booking: { ok: !!ev, provider: '${provider}', provider_event_id: String(ev || ''), ends_at: j.request.ends_at } } }];`;
  w.add(code('Normalize GHL Result', P(4, -1.5), normalize('ghl', 'Build GHL Calendar Request'), { libs: true }));
  w.add(code('Normalize Cal.com Result', P(4, 0.5), normalize('calcom', 'Build Cal.com Request'), { libs: true }));
  w.add(code('Calendar Failed', P(4, 2), `
const j = $('Start').first().json;
return [{ json: { ...j, slots: [], booking: { ok: false, error: JSON.stringify($input.first().json.error || '').slice(0, 500) } } }];`));
  w.add(code('No Calendar', P(2, 3), `return [{ json: { ...$input.first().json, slots: [], booking: { ok: false, error: 'no_calendar_configured' } } }];`));
  w.chain('Start', 'By Provider');
  w.link('By Provider', 'Build GHL Calendar Request', 0);
  w.link('By Provider', 'Build Cal.com Request', 1);
  w.link('By Provider', 'No Calendar', 2);
  w.chain('Build GHL Calendar Request', 'GHL Calendar API');
  w.chain('Build Cal.com Request', 'Cal.com API');
  w.link('GHL Calendar API', 'Normalize GHL Result', 0); w.link('GHL Calendar API', 'Calendar Failed', 1);
  w.link('Cal.com API', 'Normalize Cal.com Result', 0); w.link('Cal.com API', 'Calendar Failed', 1);
  workflows.push(w);
}

// ------------------------------------------------------------- write ----
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT, f));
const index = [];
for (const w of workflows) {
  const json = w.toJSON();
  fs.writeFileSync(path.join(OUT, w.file), JSON.stringify(json, null, 2) + '\n');
  index.push({ id: json.id, name: json.name, file: w.file, nodes: json.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length });
}
fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`Built ${workflows.length} workflows -> ${path.relative(ROOT, OUT)}`);
for (const i of index) console.log(`  ${i.id}  ${i.name}  (${i.nodes} nodes)`);
