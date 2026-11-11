#!/usr/bin/env node
// ---------------------------------------------------------------------------
// import-leads-csv.js — load leads from a CSV (for demos, or clients whose
// CRM export is a spreadsheet).
//
//   npm run import:csv -- --client demo-investor --file database/seeds/demo_leads.csv
//
// Columns: crm_contact_id, first_name, last_name, phone, email, property_address,
//          property_city, property_state, property_zip, last_activity
// ---------------------------------------------------------------------------
const fs = require('fs');
const { Client } = require('pg');
const { normalizeUSPhone, normalizeEmail, normalizeState } = require('../n8n/code/lib/phone.js');

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] || '').trim()])));
}

(async () => {
  const slug = arg('--client'); const file = arg('--file');
  if (!slug || !file) { console.error('usage: --client <slug> --file <csv>'); process.exit(1); }
  const records = parseCsv(fs.readFileSync(file, 'utf8'));
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query('select id from clients where slug = $1', [slug]);
  if (!rows.length) { console.error(`unknown client ${slug} — run npm run sync:config first`); process.exit(1); }
  let ok = 0, skipped = 0;
  for (const r of records) {
    const phone = normalizeUSPhone(r.phone); const email = normalizeEmail(r.email);
    if (!phone && !email) { skipped++; continue; }
    await db.query(
      `insert into leads (client_id, crm_contact_id, first_name, last_name, phone_e164, email, property_address,
                          property_city, property_state, property_zip, crm_last_activity_at, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'csv_import')
       on conflict (client_id, crm_contact_id) do update set first_name = excluded.first_name, last_name = excluded.last_name,
         phone_e164 = excluded.phone_e164, email = excluded.email, property_address = excluded.property_address`,
      [rows[0].id, r.crm_contact_id || `csv-${phone || email}`, r.first_name || null, r.last_name || null, phone, email,
        r.property_address || null, r.property_city || null, normalizeState(r.property_state), r.property_zip || null,
        r.last_activity ? new Date(r.last_activity) : null],
    );
    ok++;
  }
  console.log(`✓ imported ${ok} leads, skipped ${skipped} (no valid phone/email)`);
  await db.end();
})();
