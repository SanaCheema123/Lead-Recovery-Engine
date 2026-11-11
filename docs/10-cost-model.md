# 10 · Cost Model

> All vendor prices change. The numbers below are **planning assumptions** to show the method. Check current Twilio, OpenAI, SendGrid and hosting pricing before quoting a client.

## Fixed monthly (per stack)
| Item | Assumption |
|---|---|
| VPS 2–4 vCPU / 4–8 GB | $10–40 |
| n8n self-hosted (Community Edition) | $0 license |
| Twilio local number(s) | ~$1–2 each |
| A2P 10DLC brand/campaign fees | one-time registration + small monthly campaign fee |
| SendGrid | free tier → paid tier as volume grows |
| Backups storage | ~$1–5 |

## Variable, per lead reactivated (formula)
```
SMS cost      = segments_per_msg × messages_per_lead × (Twilio per-segment price + carrier fee)
AI cost       = ai_turns_per_engaged_lead × reply_rate × (input_tokens × in_price + output_tokens × out_price)
Total / lead  = SMS cost + AI cost (+ email ≈ negligible)
Cost / appt   = Total / lead ÷ booking_rate
```

### Worked example (illustrative assumptions only)
| Assumption | Value |
|---|---|
| Cadence SMS per non-responder | 6 messages × 1 segment |
| Reply rate | 15% |
| AI turns per engaged lead | 6 turns |
| Tokens per turn | ~2,500 in / ~200 out (prompt + 20-message history) |
| SMS all-in per segment | assume $0.012 |
| Model price | assume $0.40 / 1M input, $1.60 / 1M output (a small, cheap model) |
| Booking rate (of contacted) | 2% |

- SMS: 6 × $0.012 ≈ **$0.072 / lead**, plus replies to engaged leads ≈ +$0.01
- AI: 0.15 × 6 × (2,500 × 0.40 + 200 × 1.60)/1M ≈ **$0.0012 / lead**
- **≈ $0.08 per lead reactivated → ≈ $4 per booked appointment**

**SMS dominates cost; AI is close to rounding error** with a small model. Levers: fewer, better cadence steps; email for steps where an email exists; 1-segment messages (≤ 160 GSM characters; emojis force UCS-2 at 70 characters/segment).

## Why not Make/Zapier at this volume
A 5,000-lead reactivation is about 30,000 sends + 30,000 status callbacks + inbound + AI turns + CRM writes, which comes to hundreds of thousands of operations per month per client. Per-operation pricing scales linearly with that. Self-hosted n8n doesn't.

## Pricing the service to clients (common models)
- Setup fee (onboarding, A2P, CRM mapping) + monthly platform fee
- Plus pass-through or bundled messaging
- Or performance-based: per booked appointment (track with `v_daily_kpis.appointments_booked`)
