# 02 · Setup Guide (zero → live)

Time: about 2–3 hours of hands-on work, plus **A2P 10DLC approval**, which usually takes days to a few weeks. Start that first.

## 0. Accounts you need
| Service | Why | Notes |
|---|---|---|
| VPS (Hetzner, DigitalOcean, AWS Lightsail…) | Runs the stack | Ubuntu 22/24, 2 vCPU / 4 GB, Docker installed |
| Domain / subdomain | HTTPS webhooks | e.g. `lre.yourcompany.com` → VPS IP (A record) |
| Twilio | SMS | Buy a local number, create a **Messaging Service**, complete **A2P 10DLC brand + campaign registration** |
| SendGrid | Email | Authenticate your sending domain (SPF/DKIM), set up an Inbound Parse subdomain |
| OpenAI | AI | API key with billing enabled |
| GoHighLevel or HubSpot | CRM | Private Integration token (GHL) / Private App token (HubSpot) |
| Slack | Alerts | Two incoming webhooks: `#lre-alerts` (ops), `#acquisitions` (hot leads) |
| healthchecks.io (optional) | Dead-man switch | Free tier is fine |

## 1. Server
```bash
ssh root@your-vps
git clone <your-repo> /opt/lead-recovery-engine && cd /opt/lead-recovery-engine
cp .env.example .env && nano .env        # fill every value; generate secrets with: openssl rand -hex 32
apt install -y nodejs npm gettext-base   # Node ≥ 20 for scripts; gettext for envsubst
npm ci
docker compose up -d
docker compose ps                         # all healthy?
```
On first start Postgres creates the `n8n` database and applies `database/migrations/*.sql` to `lre`.

Open `https://lre.yourcompany.com`, create the n8n owner account, then go to **Settings → n8n API** and create an API key (put it in `.env` as `N8N_API_KEY`).

## 2. Deploy workflows + credentials
```bash
npm run verify            # unit tests + build (+ SQL tests if DATABASE_URL reachable)
npm run deploy:workflows  # imports 7 credentials + 15 workflows, activates them
```
In n8n you should see workflows `LRE 01` to `LRE 15`. Open **LRE 06** and check that the OpenAI node shows "LRE OpenAI".

## 3. Configure the client
```bash
cp config/clients/_template.yaml config/clients/acme.yaml && nano config/clients/acme.yaml
cp config/campaigns/default-reactivation.yaml config/campaigns/acme-reactivation.yaml   # set client_slug: acme
npm run sync:config
```
See `docs/05-crm-integration.md` for creating the CRM custom fields, tags and pipeline IDs the YAML refers to.

## 4. Wire the webhooks
| Where | Setting | Value |
|---|---|---|
| Twilio → Messaging Service → Integration | Incoming messages: *Send a webhook* | `https://lre.yourcompany.com/webhook/lre/sms/inbound` (POST) |
| Twilio → Messaging Service → Opt-Out Management | Advanced Opt-Out | **ON** (Twilio replies to STOP; LRE records it) |
| SendGrid → Settings → Inbound Parse | Host `reply.yourcompany.com` | `https://lre.yourcompany.com/webhook/lre/email/inbound?key=<LRE_INBOUND_EMAIL_KEY>` |
| DNS | MX for `reply.yourcompany.com` | `mx.sendgrid.net` (priority 10) |
| SendGrid → Mail Settings → Event Webhook | Events: delivered, bounce, dropped, spam report, unsubscribe | `https://lre.yourcompany.com/webhook/lre/email/events?key=<LRE_INBOUND_EMAIL_KEY>` |

Status callbacks for SMS are set per message automatically.

## 5. Smoke test (no real leads)
```bash
npm run import:csv -- --client acme --file database/seeds/demo_leads.csv
# edit one demo lead's phone to YOUR mobile:
docker compose exec postgres psql -U lre -d lre -c "update leads set phone_e164='+1YOURNUMBER' where crm_contact_id='demo-001'"
# activate the campaign (status: active in YAML → npm run sync:config), then either wait ≤1h or run LRE 02 + LRE 10 manually in n8n
```
Reply from your phone and walk through the conversation: interest → timeline → reason → it offers 2 real calendar slots → accept → check the booking in the calendar, the Slack alert, and the CRM note, tags and task. Text `STOP` and confirm you get nothing more.

## 6. Go live checklist
- [ ] A2P 10DLC campaign **approved** (sending before approval gets messages filtered or blocked)
- [ ] Counsel reviewed `docs/06-compliance.md` and the lead source / consent situation
- [ ] `quiet_hours`, `holidays`, `daily_send_cap`, `daily_new_limit` set (start at 50–100/day for a new number)
- [ ] Scenario tests pass: `OPENAI_API_KEY=… npm run test:scenarios`
- [ ] Slack alerts arrive (trigger a test error by running LRE 11 manually)
- [ ] Backups scheduled (`crontab -e` → see `scripts/backup.sh`) and copied off-server
- [ ] `HEALTHCHECK_URL` configured
- [ ] Sales team knows how a handoff looks and how to use the "Hand back to AI" link
