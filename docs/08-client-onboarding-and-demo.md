# 08 · Client Onboarding & Demo Playbook

## Onboarding a new real-estate client (≈ 1 day of work + A2P wait)
| # | Step | Owner |
|---|---|---|
| 1 | Kick-off: markets, buyer type (wholesale / flip / buy-and-hold), rep name, calendar, lead sources & **consent evidence** | You + client |
| 2 | Client's counsel signs off on contacting the selected leads | Client |
| 3 | Twilio: brand + A2P campaign registration, buy local numbers in their market | You |
| 4 | SendGrid: authenticate sending domain, Inbound Parse subdomain | You |
| 5 | CRM: token, custom fields, tags, pipeline stages, calendar (doc 05) | You |
| 6 | `config/clients/<slug>.yaml` + campaign YAML; adapt templates to their voice | You |
| 7 | `npm run sync:config`; first import runs within the hour; review the imported count and skip reasons | You |
| 8 | Pilot: activate with `daily_new_limit: 50` for 1 week; review every conversation daily | You + client |
| 9 | Ramp to 150–300/day per number; weekly results review | You |

## Demo script (15 minutes, uses the demo client)
**Setup:** demo client synced, demo CSV imported, your phone on `demo-001`, Slack #acquisitions open, GHL demo sub-account open.

1. **The problem (1 min).** Show the CRM full of untouched leads and ask: "How many of these did anyone call in the last 90 days?"
2. **Launch (2 min).** Activate the campaign and run LRE 02 + 10. Your phone buzzes with a natural opener.
3. **Live conversation (5 min).** Reply as a seller: "maybe, it was my mom's house…" Show the empathetic reply, one question at a time. Ask "what would you pay?" and note it won't quote a price and steers to a call. Ask "are you a bot?" and note it answers honestly.
4. **Booking (2 min).** It offers 2 real slots from the calendar. Accept one, and show the calendar event, Slack alert, CRM note with transcript, tags, task and pipeline stage.
5. **Safety (2 min).** Text STOP from a second phone and show the dnc status and that the trigger blocks re-texting. Show quiet hours.
6. **Results (2 min).** Show the daily report and `v_funnel` (reply rate, booking rate), and the `ai_turns` audit ("every decision is explainable").
7. **Close (1 min).** "You own it: your CRM, your numbers, your data, full docs."

Tip: `scripts/simulate-inbound-sms.sh` lets you demo replies from the terminal without a second phone.

## KPIs to report to clients
Leads reactivated · reply rate · qualified rate · appointments booked · cost per appointment · opt-out rate · time-to-first-response (always under a minute).
