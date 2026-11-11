# 09 · Handover Checklist (ownership transfer)

Goal: your company has **full control**, with no dependency on the original builder.

## Access & ownership
- [ ] Git repository transferred to the company's GitHub/GitLab org (builder removed or read-only)
- [ ] VPS / cloud account owned by the company (builder's SSH key removed: `~/.ssh/authorized_keys`)
- [ ] Domain DNS in the company's registrar account
- [ ] n8n owner account email = company admin; builder's n8n user deleted
- [ ] Twilio, SendGrid, OpenAI, Slack, healthchecks.io accounts owned by the company (billing on company card)
- [ ] CRM private-integration tokens created by a company admin (rotate any token the builder created)
- [ ] `.env` stored in the company password manager; **all secrets rotated** after handover:
      `POSTGRES_PASSWORD`, `LRE_INTERNAL_API_KEY`, `LRE_INBOUND_EMAIL_KEY`, API keys
      (do **not** change `N8N_ENCRYPTION_KEY` unless you re-create the credentials)

## Knowledge transfer (recorded sessions recommended)
- [ ] Architecture walkthrough (doc 01) — 45 min
- [ ] Live deploy from scratch on a staging VPS by a company engineer, following doc 02 alone
- [ ] Onboard a test client end-to-end (doc 08)
- [ ] Runbook drill: break a credential and follow the alert to the fix (doc 07)
- [ ] Prompt/scoring change + scenario tests + deploy (docs 03, 04, 11)

## Deliverables included in this repository
| Deliverable | Location |
|---|---|
| 15 importable n8n workflows | `n8n/workflows/` |
| Workflow source (generator) + shared logic | `tools/build-workflows.js`, `n8n/code/lib/` |
| Database schema, triggers, reporting views | `database/migrations/` |
| AI prompt + strict output schema | `prompts/` |
| Client + campaign + compliance config | `config/` |
| Infrastructure (Docker, Caddy HTTPS) | `docker-compose.yml`, `infra/` |
| Deploy / backup / export / simulate scripts | `scripts/` |
| Tests: unit, SQL, lifecycle, AI scenarios | `tests/`, `tools/` |
| Documentation | `docs/` |

## Acceptance tests (sign-off)
- [ ] `npm run verify` passes on the company's machine
- [ ] `npm run test:scenarios` passes (11/11) with the company's OpenAI key
- [ ] Live smoke test (doc 02 §5): opener → reply → qualification → slot offer → booking → CRM updated → Slack alert
- [ ] STOP → no further messages, CRM DND set
- [ ] Message at 7:30 AM recipient time is deferred to the window
- [ ] Error alert received in Slack; daily report received
- [ ] Backup created and **restore tested** on staging
