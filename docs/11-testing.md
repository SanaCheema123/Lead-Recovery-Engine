# 11 · Testing

| Layer | Command | Needs | What it proves |
|---|---|---|---|
| Unit | `npm test` | nothing | Opt-out detection, quiet hours across time zones/DST/Sundays/state caps, phone normalization, templating, scoring, state machine, guardrails, turn processing, cadence, email parsing (30 tests) |
| Build | `npm run build:workflows` | nothing | All 15 workflows generate; every connection points at an existing node; every Code node parses |
| SQL | `npm run test:sql` | `DATABASE_URL` (migrated) | Every one of the 34 Postgres queries in the workflows compiles against the real schema (tables, columns, types) |
| Lifecycle | `node --test tests/integration/*.test.js` | `DATABASE_URL` + `sync:config` + demo CSV | The real workflow SQL + logic run in sequence on a real DB: enroll → claim (locking) → send → inbound (dedupe, cadence stop) → AI turns → qualified/hot → hot-alert dedupe → booking → reminders once → STOP + **trigger blocks re-texting** → bad number → reporting views. Rolled back afterwards. |
| AI scenarios | `npm run test:scenarios` | `OPENAI_API_KEY` | 11 conversation cases with the production prompt and the real model: empathy, no price quotes, honest AI disclosure, prompt injection, wrong number, follow-up later, booking only offered slots, etc. Use `--runs 5` to check consistency. |
| Live smoke | doc 02 §5 | staging stack | Real Twilio/SendGrid/CRM/calendar round-trip |

`npm run verify` = unit + build + SQL + lifecycle (needs `DATABASE_URL`). Run it before every deploy.

## Local DB for tests
```bash
docker run -d --name lre-test -e POSTGRES_USER=lre -e POSTGRES_PASSWORD=test -e POSTGRES_DB=lre -p 5433:5432 postgres:16-alpine
export DATABASE_URL=postgres://lre:test@localhost:5433/lre
for f in database/migrations/*.sql; do psql "$DATABASE_URL" -f $f; done
npm run sync:config && npm run import:csv -- --client demo-investor --file database/seeds/demo_leads.csv
npm run test:sql && node --test tests/integration/*.test.js
```

## Adding a scenario
Append to `tests/scenarios/conversations.yaml`:
```yaml
- name: tenant_occupied_landlord
  lead_says: "I've got tenants in there, I'm tired of being a landlord"
  expect:
    action_in: [continue_conversation]
    extracted: { occupancy: tenant_occupied }
    motivation_reasons_include: [tired_landlord]
```
