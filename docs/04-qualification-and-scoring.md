# 04 · Qualification & Scoring

The AI **extracts** facts. Code (`n8n/code/lib/scoring.js`) **scores** them. That keeps scoring explainable ("why is this lead hot?") and tunable per client without prompt changes.

## Extracted fields (`qualifications` table)
| Field | Values |
|---|---|
| interested_in_selling | yes · maybe · no |
| timeline | asap · 0_3_months · 3_6_months · 6_12_months · 12_plus_months |
| motivation_level | high · medium · low |
| motivation_reasons | foreclosure, behind_on_payments, probate, inherited, divorce, relocation, tired_landlord, financial_hardship, health, downsizing, code_violations, tax_liens, vacant_property, needs_repairs, retirement, … |
| property_condition | excellent · good · needs_some_repairs · needs_major_repairs |
| occupancy | owner_occupied · tenant_occupied · vacant |
| price_flexibility | flexible · open_to_offer · firm_reasonable · firm_above_market |
| asking_price, is_decision_maker, is_owner, property_type, beds, baths, best_contact_time, notes, summary | |

Facts merge across turns: a non-null new value overwrites, and reasons accumulate.

## Default weights (0–100)
| Factor | Points |
|---|---|
| Timeline | asap 30 · 0–3 mo 28 · 3–6 mo 20 · 6–12 mo 10 · 12+ mo 3 |
| Motivation level | high 25 · medium 15 · low 5 |
| Price flexibility | flexible / open to offer 15 · firm reasonable 8 · firm above market 2 |
| Condition | major repairs 10 · some repairs 8 · good 4 · excellent 2 |
| Occupancy | vacant 6 · tenant 4 · owner 2 |
| Decision maker | yes +8 · **no −15** |
| Distress reasons | +5 each, max +10 |
| Said "yes" to selling | +6 |
| Said "no" | score = 0 |

**Temperature:** hot ≥ 70 · warm ≥ 40 · cold < 40 (thresholds set per client).

**Qualified** = interested (yes/maybe) **and** timeline ≤ 6 months **and** motivation high/medium **and** not a confirmed non-decision-maker. Qualified leads get offered appointments. Hot leads trigger an immediate Slack/email alert (once per 24h).

## Tuning per client
```yaml
qualification:
  hot_threshold: 65
  require_decision_maker: false     # e.g. wholesalers happy to talk to any heir
  weights:
    timeline: { asap: 35, 0_3_months: 30, 3_6_months: 15, 6_12_months: 5, 12_plus_months: 0, unknown: 0 }
```
Run `npm test` after changing the scoring code. Weights in YAML need no code change.

## Reporting
Every turn stores `score_reasons` (e.g. `timeline:+28, motivation:+25, distress:+10`), which shows in the CRM note and lets you explain each score to a client.
