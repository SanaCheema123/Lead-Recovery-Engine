# 07 · Operations Runbook

## Daily (5 minutes)
- Read the 8 AM Slack report: contacted, replies, qualified, booked, opt-outs, failures, errors.
- Check `v_attention_needed` (also counted in the report):
```sql
select * from v_attention_needed order by since;
```

## Alerts and what to do
| Alert | Likely cause | Action |
|---|---|---|
| `LRE workflow error` in #lre-alerts | API change, expired token, bad config | Click the execution URL. Fix the credential or config, then re-run if needed. |
| Delivery failure rate > 15% | Carrier filtering, unregistered A2P, bad list | Pause the campaign (`status: paused` → `npm run sync:config`). Check Twilio error codes in `messages.error_code`. |
| `inbound_without_reply` | AI engine or OpenAI failing | Check LRE 06 executions and OpenAI status/billing. Leads stay safe (no sends), and reply once fixed. |
| `unanswered_handoff` (> 2h) | Sales team missed the alert | Ping the rep. Mark resolved: `update handoffs set resolved_at = now() where lead_id = …`. |
| Healthcheck missed | Server or n8n down | `docker compose ps`, `docker compose logs n8n`, `docker compose up -d` |

## Common tasks
```sql
-- Pause everything for a client immediately
update campaigns set status = 'paused' where client_id = (select id from clients where slug = 'acme');

-- Take over one lead manually (AI stops answering)
update leads set ai_paused = true, status = 'handed_off' where phone_e164 = '+1…';

-- Hand a lead back to the AI (or use the "Hand back to AI" link in Slack)
update leads set ai_paused = false, status = 'engaged' where id = '…';

-- Full conversation for a lead
select direction, channel, body, status, created_at from messages where lead_id = '…' order by created_at;

-- Why did the AI do that?
select created_at, action, decision->'score_reasons', decision->'issues', raw_output->>'reply'
from ai_turns where lead_id = '…' order by created_at;

-- Manually suppress a number
insert into opt_outs (client_id, channel, value, source) values ((select id from clients where slug='acme'), 'sms', '+1…', 'manual');
update leads set status = 'dnc' where phone_e164 = '+1…';

-- AI cost estimate, last 30 days (replace prices with current rates per 1M tokens)
select sum(prompt_tokens)/1e6 * 0.40 + sum(completion_tokens)/1e6 * 1.60 as usd from ai_turns where created_at > now() - interval '30 days';
```

## Changing things safely
| Change | How |
|---|---|
| Message templates, cadence, caps, persona, scoring thresholds | Edit YAML → `npm run sync:config` (no redeploy) |
| Prompt | Edit `prompts/…` → `npm run test:scenarios` → `npm run deploy:workflows` |
| Logic (compliance, scoring, guardrails) | Edit `n8n/code/lib` → `npm test` → `npm run deploy:workflows` |
| Workflow structure | Edit `tools/build-workflows.js` → `npm run verify` → deploy |
| Hot-fix in the n8n UI | Allowed in an emergency. Then `scripts/export-workflows.sh` and port the change to source, or the next deploy overwrites it. |

## Upgrades
- n8n: pin `N8N_VERSION` in `.env`. To upgrade, back up, bump the version, `docker compose pull && docker compose up -d`, then run the smoke test.
- DB migrations: add `database/migrations/00X_name.sql` and apply with `docker compose exec -T postgres psql -U lre -d lre < database/migrations/00X_name.sql`.

## Backup and restore
Nightly `scripts/backup.sh` (both DBs, 14-day retention). Copy `backups/` off-server. Restore instructions are at the bottom of the script. **Also back up `.env`** (especially `N8N_ENCRYPTION_KEY`) in a password manager.
