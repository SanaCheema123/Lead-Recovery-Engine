# 12 · Workflow & Endpoint Reference

## Workflows
| # | Name | Trigger | Purpose |
|---|---|---|---|
| 01 | CRM Lead Import | hourly | Pull CRM contacts (cursor-paged), filter (DND, tags, recently active), normalize, bulk upsert |
| 02 | Campaign Launcher | hourly | Enroll eligible leads up to each campaign's daily limit |
| 03 | Outbound Sender | sub-workflow | **Single gate for every message**: compliance, Twilio/SendGrid, logging, bad-number handling |
| 04 | Inbound SMS | webhook | Verify, ack, dedupe, stop cadence, deterministic routing → AI / human / opt-out |
| 05 | Inbound Email | webhook ×2 | Inbound Parse replies + unsubscribe link |
| 06 | AI Conversation Engine | sub-workflow | Debounce, context, slots, OpenAI, processTurn, persist, route |
| 07 | CRM Sync-Back | sub-workflow | Plan CRM writes from lead state and execute via 14 |
| 08 | Appointment Booking | sub-workflow + every 15 min | Book accepted slot, confirm, alert; 24h/1h reminders |
| 09 | Human Handoff | sub-workflow + webhook | Pause AI, Slack + email alert, CRM task; signed "resume AI" link |
| 10 | Cadence Runner | every 10 min | Send due touches (locking), advance/defer/stop; nudges; park to nurture |
| 11 | Error Handler | error trigger | Log + de-duplicated Slack alerts |
| 12 | Health Report & Heartbeat | daily 8 AM + hourly | KPIs report; dead-man ping; anomaly alerts |
| 13 | Delivery Status Webhooks | webhook ×2 | Twilio status, SendGrid events → statuses, suppressions |
| 14 | CRM Adapter | sub-workflow | Generic ops → GoHighLevel / HubSpot API |
| 15 | Calendar Adapter | sub-workflow | Slots/booking → GHL Calendars / Cal.com |

Sub-workflow inputs and outputs are documented in the sticky note at the top of each workflow.

## Public endpoints (`{APP_BASE_URL}/webhook/…`)
| Path | Method | Caller | Auth |
|---|---|---|---|
| `lre/sms/inbound` | POST | Twilio incoming message | X-Twilio-Signature (HMAC-SHA1) |
| `lre/sms/status` | POST | Twilio status callback | X-Twilio-Signature |
| `lre/email/inbound?key=` | POST | SendGrid Inbound Parse | shared key |
| `lre/email/events?key=` | POST | SendGrid Event Webhook | shared key |
| `lre/email/unsubscribe?t=` | GET | Lead clicking unsubscribe | per-lead random token |
| `lre/admin/resume-ai?lead_id=&sig=` | GET | Rep clicking Slack link | HMAC-SHA256 with `LRE_INTERNAL_API_KEY` |

## Database tables
`clients`, `client_phone_numbers`, `leads`, `qualifications`, `messages`, `ai_turns`, `campaigns`, `campaign_enrollments`, `appointments`, `handoffs`, `opt_outs`, `import_state`, `crm_sync_log`, `workflow_errors`, `events`. Views: `v_daily_kpis`, `v_funnel`, `v_attention_needed`.

## Environment variables read by workflows (`$env`)
`APP_BASE_URL`, `OPENAI_MODEL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_VALIDATE_SIGNATURE`, `LRE_INTERNAL_API_KEY`, `LRE_INBOUND_EMAIL_KEY`, `SLACK_WEBHOOK_URL_ALERTS`, `SLACK_WEBHOOK_URL_HANDOFF`, `HEALTHCHECK_URL`.
