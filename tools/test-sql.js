#!/usr/bin/env node
// ---------------------------------------------------------------------------
// test-sql.js — validates EVERY Postgres query embedded in the n8n workflows
// against a real database (schema + views must be migrated).
//
// Each query is PREPAREd (full parse + semantic analysis: tables, columns,
// types, functions) inside a transaction that is rolled back.
//
//   DATABASE_URL=postgres://... npm run test:sql
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const dir = path.join(__dirname, '..', 'n8n', 'workflows');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let pass = 0, fail = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^\d.*\.json$/.test(x)).sort()) {
    const wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.postgres')) {
      const q = n.parameters.query;
      const nParams = (n.parameters.options.queryReplacement || '').split(',').length;
      const maxRef = Math.max(0, ...[...q.matchAll(/\$(\d+)/g)].map((m) => +m[1]));
      const name = `s${pass + fail}`;
      try {
        if (n.parameters.options.queryReplacement && maxRef > nParams) {
          throw new Error(`query references $${maxRef} but only ~${nParams} params supplied`);
        }
        await db.query('begin');
        // Untyped params default to text, matching how n8n sends them.
        const types = Array.from({ length: maxRef }, () => 'text').join(',');
        await db.query(`prepare ${name}${maxRef ? `(${types})` : ''} as ${q}`);
        await db.query('rollback');
        pass++;
      } catch (e) {
        await db.query('rollback').catch(() => {});
        fail++;
        console.log(`✗ ${wf.name} › ${n.name}\n    ${e.message}`);
      }
    }
  }
  console.log(`\nSQL check: ${pass} passed, ${fail} failed`);
  await db.end();
  process.exitCode = fail ? 1 : 0;
})();
