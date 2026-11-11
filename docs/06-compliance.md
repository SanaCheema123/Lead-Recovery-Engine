# 06 · Compliance (TCPA, A2P 10DLC, CAN-SPAM)

> **Not legal advice.** This explains what the system enforces technically. Texting old real-estate leads is a **high-litigation area** in the US (TCPA statutory damages per message). Each client must confirm with their own counsel that they may contact their leads this way **before** any campaign goes live.

## The biggest risk: consent
Whether you may send automated marketing texts to a dormant lead depends on **how and when that lead gave consent** and what they agreed to (an inbound web form with a TCPA disclosure vs. a cold-skip-traced list are very different). LRE cannot know this, so:
- Import only leads with documented consent (use `include_tags` such as `opted-in-web-form`, or exclude list-sourced contacts with `exclude_tags`).
- Never load purchased, skip-traced or cold lists into an SMS campaign.
- Keep the consent evidence in the CRM. LRE keeps every message for 5 years (`record_keeping`).

## What LRE enforces automatically
| Control | Where |
|---|---|
| Opt-out keywords (STOP, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPT OUT, REMOVE…) handled **before** AI | `compliance.js` → workflow 04 |
| Natural-language opt-outs ("remove me", "don't text me", "lose my number") | same, plus a single confirmation message |
| AI-detected opt-outs | turn processor → suppression |
| Carrier opt-outs (Twilio 21610), email unsubscribes, spam reports, bounces | workflow 13 |
| Suppression enforced by **DB trigger** (cannot be bypassed by code bugs, re-imports or manual edits) | `opt_outs` + `lre_enforce_suppression` |
| CRM DND / excluded tags never imported | workflow 01 |
| Quiet hours in the recipient's local time, checking **property-state TZ AND client TZ** (both must be inside the window) | `checkSendAllowed` |
| Default window 9am–8pm, no Sundays, configurable holidays | client YAML |
| Stricter state rules (FL, OK, MD: 8am–8pm and ≤ 3 campaign messages / 24h; WA 8am–8pm) | `config/compliance.yaml` (review with counsel; state laws change, e.g. newer Texas and other "mini-TCPA" rules) |
| First SMS carries "Reply STOP to opt out." and identifies the sender (agent + company) | sender + templates |
| AI discloses it's an AI assistant when asked and **never claims to be human** | prompt + guardrail (blocks the reply) |
| No price quotes, guarantees, or legal/tax/financial advice | guardrails |
| Email: physical address, one-click List-Unsubscribe, working unsubscribe link, honest subject | sender |
| Daily caps + gradual ramp | `daily_send_cap`, `daily_new_limit` |

## A2P 10DLC (required for business texting on US local numbers)
1. Twilio Console → Messaging → Regulatory Compliance → register the **Brand** (client's legal business, EIN).
2. Register a **Campaign**: use case "Marketing" (or "Mixed"), with sample messages taken from `config/campaigns/*.yaml`, an opt-in description that matches how leads actually consented, and opt-out/help language.
3. Attach the client's numbers to the Messaging Service linked to that campaign.
Unregistered traffic gets filtered or blocked, and real-estate campaigns get extra scrutiny. Describe consent honestly.

## Message content tips that also improve deliverability
- No links in the first messages (LRE strips links from AI replies).
- No ALL CAPS, no "cash offer!!!", no shorteners.
- Vary wording (spintax), keep volume ramped, and keep opt-out rates low. A rising opt-out or failure rate shows in the daily report.

## Data protection
- PII lives in Postgres on your server, plus the CRM, Twilio, SendGrid and OpenAI (API data is not used for training by default under OpenAI's API terms; confirm current terms and consider a DPA).
- The n8n editor sits behind auth. Optionally restrict it by IP in `infra/Caddyfile`.
- Deleting a person on request: `delete from leads where id = …` cascades to messages, turns, qualifications, appointments. Keep the `opt_outs` row (it is the do-not-contact record).
