#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sync-config.js — loads config/clients/*.yaml + config/campaigns/*.yaml into
// Postgres. Idempotent: run after any config change.
//
//   DATABASE_URL=postgres://lre:pass@localhost:5432/lre npm run sync:config
//   npm run sync:config -- --client demo-investor     (one client only)
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const only = (() => { const i = process.argv.indexOf('--client'); return i > -1 ? process.argv[i + 1] : null; })();

function loadDir(dir) {
  const full = path.join(ROOT, dir);
  return fs.readdirSync(full)
    .filter((f) => /\.ya?ml$/.test(f) && !f.startsWith('_'))
    .map((f) => ({ file: f, data: yaml.load(fs.readFileSync(path.join(full, f), 'utf8')) }));
}

function validateClient(c, file) {
  const errs = [];
  if (!c.slug) errs.push('slug is required');
  if (!c.name) errs.push('name is required');
  if (!c.crm || !['ghl', 'hubspot', 'none'].includes(c.crm.type)) errs.push('crm.type must be ghl | hubspot | none');
  if (!c.persona || !c.persona.company_name) errs.push('persona.company_name is required');
  if (c.email && c.email.enabled && !c.email.physical_address) errs.push('email.physical_address is required (CAN-SPAM)');
  if (!c.messaging || !(c.messaging.sms_from_numbers || []).length) errs.push('messaging.sms_from_numbers needs at least one number');
  if (errs.length) throw new Error(`${file}: \n  - ${errs.join('\n  - ')}`);
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const compliance = yaml.load(fs.readFileSync(path.join(ROOT, 'config/compliance.yaml'), 'utf8'));
  try {
    await db.query('begin');
    for (const { file, data: c } of loadDir('config/clients')) {
      if (only && c.slug !== only) continue;
      validateClient(c, file);
      const settings = { ...c, state_rules: compliance.state_rules, compliance: { opt_out_notice: compliance.first_message.opt_out_notice } };
      const { rows } = await db.query(
        `insert into clients (slug, name, timezone, crm_type, calendar_provider, settings, active)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (slug) do update set name = excluded.name, timezone = excluded.timezone, crm_type = excluded.crm_type,
           calendar_provider = excluded.calendar_provider, settings = excluded.settings, active = excluded.active
         returning id`,
        [c.slug, c.name, c.timezone || 'America/New_York', c.crm.type,
          c.calendar && c.calendar.enabled !== false ? c.calendar.provider : 'none', settings, c.active !== false],
      );
      const clientId = rows[0].id;
      for (const n of c.messaging.sms_from_numbers) {
        await db.query(
          `insert into client_phone_numbers (phone_e164, client_id) values ($1, $2)
           on conflict (phone_e164) do update set client_id = excluded.client_id`, [n, clientId]);
      }
      console.log(`✓ client ${c.slug} (${clientId})`);
    }
    for (const { file, data: cp } of loadDir('config/campaigns')) {
      if (only && cp.client_slug !== only) continue;
      const { rows } = await db.query('select id from clients where slug = $1', [cp.client_slug]);
      if (!rows.length) throw new Error(`${file}: unknown client_slug ${cp.client_slug}`);
      if (!Array.isArray(cp.steps) || !cp.steps.length) throw new Error(`${file}: steps required`);
      cp.steps.forEach((s, i) => { if (i > 0 && s.day <= cp.steps[i - 1].day) throw new Error(`${file}: step ${s.key} day must increase`); });
      await db.query(
        `insert into campaigns (client_id, slug, name, status, settings, steps) values ($1, $2, $3, $4, $5, $6)
         on conflict (client_id, slug) do update set name = excluded.name, status = excluded.status,
           settings = excluded.settings, steps = excluded.steps`,
        [rows[0].id, cp.slug, cp.name, cp.status || 'paused', cp.settings || {}, JSON.stringify(cp.steps)],
      );
      console.log(`✓ campaign ${cp.slug} → ${cp.client_slug} [${cp.status || 'paused'}]`);
    }
    await db.query('commit');
  } catch (e) {
    await db.query('rollback');
    console.error('✗ sync failed:', e.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
