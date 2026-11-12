

https://github.com/user-attachments/assets/24f0ea95-c5ac-4984-8a8a-483c3ee28d62

# Lead Recovery Engine


**AI-powered reactivation of dormant seller leads for US real estate investors, wholesalers and flippers.**

Lead Recovery Engine (LRE) pulls old and inactive property-owner leads from the client's CRM, re-opens the conversation by SMS and email, holds a natural two-way AI conversation that identifies seller intent and motivation, scores and qualifies the lead, books qualified sellers onto the sales team's calendar, writes everything back to the CRM, and hands off to a human when needed. Compliance controls are built into the core.

```
CRM (GoHighLevel / HubSpot) ─► Import ─► Reactivation cadence ─► SMS / Email
                                                  │
           Lead replies ─► deterministic safety rules ─► AI conversation (OpenAI, structured)
                                                  │
              qualify & score ─► offer real calendar slots ─► book ─► alert rep ─► CRM updated
                                                  └─► human handoff whenever needed
```

| | |
|---|---|
| **Stack** | n8n (self-hosted, queue mode) · PostgreSQL · OpenAI · Twilio · SendGrid · GoHighLevel / HubSpot · GHL Calendars / Cal.com · Docker + Caddy |
| **Workflows** | 15 importable n8n workflows (generated from tested source) |
| **Tests** | 30 unit · 34 SQL · 11-step lifecycle on a real DB · 11 live-AI conversation scenarios |
| **Ownership** | Everything is self-hosted and in this repo. No platform lock-in. |

## Quick start (Linux server / production)
```bash
cp .env.example .env            # fill in keys (docs/02-setup-guide.md)
npm ci
docker compose up -d            # Postgres + Redis + n8n + worker + HTTPS
npm run verify                  # unit tests + build workflows + SQL checks
npm run deploy:workflows        # import credentials + 15 workflows, activate
npm run sync:config             # load client + campaign YAML
```
Then wire the Twilio/SendGrid webhooks (doc 02 §4) and run the smoke test (doc 02 §5).

---

## Quick start (Windows, local development)

**Requirements:** Node.js 20+ (22+ recommended), Docker Desktop (open, showing "Engine running").

### 1. Install and run the unit tests
```powershell
npm install
npm test                    # expect: pass 30, fail 0
npm run build:workflows     # regenerates n8n\workflows\*.json
```

### 2. Start a local test database
```powershell
docker run -d --name lre-test -e POSTGRES_USER=lre -e POSTGRES_PASSWORD=test -e POSTGRES_DB=lre -p 5433:5432 postgres:16-alpine
Start-Sleep -Seconds 10
Get-Content database\migrations\001_schema.sql | docker exec -i lre-test psql -U lre -d lre
Get-Content database\migrations\002_reporting_views.sql | docker exec -i lre-test psql -U lre -d lre
```

### 3. Load the demo client and leads, run the database tests
```powershell
$env:DATABASE_URL = "postgres://lre:test@localhost:5433/lre"
npm run sync:config
npm run import:csv -- --client demo-investor --file database/seeds/demo_leads.csv
npm run test:sql            # expect: SQL check: 34 passed, 0 failed
npm run test:integration    # expect: pass 12, fail 0
```
> `$env:DATABASE_URL` only lasts for the current PowerShell window. Set it again in a new window.

### 4. Open the workflows in n8n
```powershell
docker run -d --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false -e NODE_FUNCTION_ALLOW_BUILTIN=crypto -e GENERIC_TIMEZONE=America/New_York docker.n8n.io/n8nio/n8n
```
1. Open **http://localhost:5678** and create the owner account.
2. **Workflows → Import from File**: import `n8n\workflows\01_…json` through `15_…json` (skip `_index.json`).
3. **Credentials → Add → Postgres** named `LRE Postgres`: host `host.docker.internal`, port `5433`, database `lre`, user `lre`, password `test`, SSL disabled.
4. Add the other credentials as you get the keys (see `n8n/credentials/README.md`).

### 5. Test the AI conversations (needs an OpenAI key)
```powershell
$env:OPENAI_API_KEY = "sk-..."
npm run test:scenarios      # 11 conversation cases against the real model
```

### Troubleshooting (Windows)
| Error | Fix |
|---|---|
| `failed to connect to the docker API … dockerDesktopLinuxEngine` | Open Docker Desktop and wait for "Engine running" |
| `ECONNREFUSED … 5433` | Test DB not running: `docker start lre-test` (or re-run step 2) |
| `name "/lre-test" is already in use` | `docker rm -f lre-test`, then re-run step 2 |
| `Cannot find module …\tests\unit` | Node.js too old. Install Node 22+ |
| `.sh` scripts don't run | Use **Git Bash** or **WSL** for `scripts/*.sh` |
| Twilio/SendGrid can't reach webhooks | Your PC needs a public HTTPS URL: use ngrok or Cloudflare Tunnel, set `APP_BASE_URL` to it |

**Stop / start the local stack**
```powershell
docker stop n8n lre-test     # stop
docker start lre-test n8n    # start again (data is kept)
```

---

## Project structure
```
lead-recovery-engine/
├── README.md
├── Makefile                          # make help: up, deploy, test, verify, sync, backup…
├── package.json                      # npm scripts + deps (pg, js-yaml)
├── docker-compose.yml                # postgres, redis, n8n, n8n-worker, caddy
├── .env.example                      # every secret/setting, documented
├── .gitignore
│
├── docs/                             # complete documentation & handover
│   ├── 01-architecture.md            # diagram, design decisions, reliability, scaling
│   ├── 02-setup-guide.md             # zero → live, step by step
│   ├── 03-conversation-design.md     # cadence, AI turn anatomy, actions, escalation
│   ├── 04-qualification-and-scoring.md
│   ├── 05-crm-integration.md         # GHL + HubSpot setup, adding a new CRM
│   ├── 06-compliance.md              # TCPA, A2P 10DLC, CAN-SPAM, what is enforced
│   ├── 07-operations-runbook.md      # alerts → actions, SQL recipes, safe changes
│   ├── 08-client-onboarding-and-demo.md
│   ├── 09-handover-checklist.md      # ownership transfer + acceptance tests
│   ├── 10-cost-model.md
│   ├── 11-testing.md
│   └── 12-workflow-reference.md      # workflows, endpoints, tables, env vars
│
├── n8n/
│   ├── workflows/                    # ← IMPORT THESE (generated; do not hand-edit)
│   │   ├── 01_crm_lead_import.json
│   │   ├── 02_campaign_launcher.json
│   │   ├── 03_outbound_sender.json           # single compliance gate for all sends
│   │   ├── 04_inbound_sms.json
│   │   ├── 05_inbound_email.json
│   │   ├── 06_ai_conversation_engine.json    # the brain
│   │   ├── 07_crm_sync_back.json
│   │   ├── 08_appointment_booking.json       # + 24h / 1h reminders
│   │   ├── 09_human_handoff.json             # + signed "resume AI" link
│   │   ├── 10_cadence_runner.json            # + nudges + nurture
│   │   ├── 11_error_handler.json
│   │   ├── 12_health_report_heartbeat.json
│   │   ├── 13_delivery_status_webhooks.json
│   │   ├── 14_crm_adapter.json               # GoHighLevel | HubSpot
│   │   ├── 15_calendar_adapter.json          # GHL Calendars | Cal.com
│   │   └── _index.json
│   ├── code/lib/                     # business logic, unit-tested, inlined into Code nodes
│   │   ├── compliance.js             # opt-outs, quiet hours, state rules, send gate
│   │   ├── scoring.js                # 0–100 seller score, hot/warm/cold, qualified
│   │   ├── state_machine.js          # lead lifecycle
│   │   ├── guardrails.js             # blocks prices, "I'm human", links, long replies
│   │   ├── prompt_builder.js         # builds the OpenAI request
│   │   ├── turn_processor.js         # model JSON → validated, safe decision
│   │   ├── cadence.js · templating.js · slots.js · phone.js · email_parse.js
│   │   └── index.js
│   └── credentials/
│       ├── credentials.template.json # 7 credentials with fixed IDs, filled from .env
│       └── README.md                 # scopes per service
│
├── prompts/
│   ├── conversation_agent.system.md  # AI persona, qualification order, hard rules
│   ├── schemas/conversation_turn.schema.json   # strict structured-output schema
│   └── README.md
│
├── config/
│   ├── clients/_template.yaml        # everything needed to onboard a client
│   ├── clients/demo-client.yaml      # demo investor for sales demos
│   ├── campaigns/default-reactivation.yaml     # 7-touch, 60-day cadence
│   └── compliance.yaml               # quiet hours, state rules, opt-out wording
│
├── database/
│   ├── init/00_create_databases.sh   # first boot: n8n DB + migrations
│   ├── migrations/001_schema.sql     # tables, suppression + lifecycle triggers
│   ├── migrations/002_reporting_views.sql      # KPIs, funnel, attention-needed
│   └── seeds/demo_leads.csv
│
├── infra/Caddyfile                   # automatic HTTPS reverse proxy
│
├── scripts/
│   ├── deploy-workflows.sh           # build → import credentials + workflows → activate
│   ├── export-workflows.sh           # pull live workflows back out of n8n
│   ├── sync-config.js                # YAML → DB (validated)
│   ├── import-leads-csv.js           # CSV leads for demos / non-API CRMs
│   ├── simulate-inbound-sms.sh       # signed fake Twilio reply for demos/tests
│   └── backup.sh                     # nightly pg_dump of both databases
│
├── tools/
│   ├── build-workflows.js            # generates n8n/workflows from source
│   ├── test-sql.js                   # compiles every workflow query vs real schema
│   └── run-scenarios.js              # live AI conversation QA
│
└── tests/
    ├── unit/                         # 30 tests: compliance, scoring, conversation logic
    ├── integration/lifecycle.test.js # end-to-end on real Postgres using workflow SQL
    └── scenarios/conversations.yaml  # 11 AI behaviour cases
```

## npm scripts
| Command | What it does |
|---|---|
| `npm test` | 30 unit tests (no network, no DB) |
| `npm run build:workflows` | Generate `n8n/workflows/*.json` from source |
| `npm run test:sql` | Compile all 34 workflow SQL queries against the DB |
| `npm run test:integration` | End-to-end lead lifecycle on the DB (rolled back) |
| `npm run test:scenarios` | 11 AI conversation tests (needs `OPENAI_API_KEY`) |
| `npm run verify` | Unit + build + SQL + integration |
| `npm run sync:config` | Load `config/*.yaml` into the DB |
| `npm run import:csv -- --client <slug> --file <csv>` | Import leads from CSV |
| `npm run deploy:workflows` | Import credentials + workflows into n8n (server, bash) |

## How it decides (the important part)
The model **talks**; code **decides**. Each AI turn returns strict JSON (reply, extracted facts, proposed action). Unit-tested code then scores the lead, checks the action (it can only book slots that were actually offered), applies guardrails (no prices, never claims to be human, no links, length limits), and escalates to a human on anything uncertain. Opt-outs are handled by rules before the AI and enforced again by a database trigger.

## Where to start reading
1. `docs/01-architecture.md` (10 min)
2. `n8n/workflows/06_ai_conversation_engine.json` in the n8n editor
3. `n8n/code/lib/turn_processor.js` and `compliance.js`
4. `docs/09-handover-checklist.md`

> ⚖️ Texting leads is regulated (TCPA, state laws, carrier A2P rules). Read `docs/06-compliance.md` and get counsel sign-off before any live campaign.
