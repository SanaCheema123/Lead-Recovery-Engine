# 03 · Conversation Design

## Principles
1. **Sound like a local person texting.** Short, warm, one question per message, mirrors the lead's length.
2. **Earn the right to ask.** Acknowledge what they said before the next question.
3. **Qualify lightly, then book.** The aim is a call with a human. A complete data sheet isn't needed first.
4. **Never pressure, never quote price, never pretend to be human.**
5. **Every ending leaves the door open** (nurture date, or a polite close).

## Reactivation cadence (default, 60 days)
| Day | Channel | Angle |
|---|---|---|
| 0 | SMS (email fallback) | "Still open to selling {street}?" plus STOP disclosure |
| 2 | SMS | As-is, no-fees cash option |
| 5 | Email (SMS fallback) | Low-pressure "this year?" |
| 9 | SMS | "Is this still the owner's number?" (pattern-interrupt; usually gets replies) |
| 16 | SMS | "Want me to check back in a few months?" |
| 30 | SMS / email | "Buying in {city} again this month" |
| 60 | SMS | Polite close-out ("closing my notes") |

Spintax `{a|b}` varies the wording per lead (deterministically), which avoids identical-content carrier filtering. When the lead replies, the cadence stops and the AI takes over.

## AI turn anatomy
```
lead texts ─► 04 dedupe + rules (STOP? hostile? human-owned?) ─► 06 debounce 20s
   ─► load lead, facts known so far, last 30 messages, (real calendar slots if warm)
   ─► OpenAI structured output:
        { reply, intent, sentiment, next_action, extracted{…}, selected_slot_iso, followup_date, handoff_reason, confidence }
   ─► processTurn(): merge facts → score → validate action → guardrails → new status
   ─► save (ai_turns audit row, qualifications, lead status/score)
   ─► reply | book | handoff | opt-out  ─► CRM sync
```

## Qualification order
interest → timeline → motivation (why) → condition → occupancy → price flexibility → decision maker.
The agent asks for the *first missing* field, one at a time. Booking starts as soon as the lead is interested, the timeline is under about 6 months, and there's a real reason to sell.

## Actions the AI may propose
| next_action | What the system does |
|---|---|
| `continue_conversation` | Sends the reply |
| `offer_appointment` | Sends the reply offering 2 **real** slots (rejected if there are no slots, which leads to a handoff) |
| `confirm_appointment` | Books **only if** `selected_slot_iso` is one we offered; otherwise re-offers |
| `schedule_followup` | Status `nurture` until `followup_date`; the AI re-opens on that date |
| `handoff_to_human` | Pauses AI, alerts the team, creates a CRM task |
| `mark_not_interested` / `mark_wrong_number` | Closes politely, stops everything |
| `opt_out` | Suppresses on all channels |

## Escalation triggers (always to a human)
Asks for a person, angry sentiment, legal words (attorney, sue, harass, police), foreclosure auction soon, family dispute over an estate, price negotiation, unknown sender, AI/parse/guardrail failure, daily AI-turn cap reached, slot booking failure.

## Nudges
If an engaged lead goes quiet, the AI sends up to `max_nudges` context-aware nudges (every `nudge_after_hours`), then parks the lead in 30-day nurture.

## Example (what a good conversation looks like)
> **AI:** Hey John, it's Sarah with Lone Star Home Buyers. You'd reached out a while back about 4512 Oak Lawn Ave. Are you still open to selling it? Reply STOP to opt out.
> **Lead:** maybe. it was my moms, she passed last year
> **AI:** I'm sorry about your mom. No pressure at all. Roughly when would you want to have it sold?
> **Lead:** honestly asap, it's just sitting there and needs a lot of work
> **AI:** That makes sense. Is it just you on the title, or would anyone else need to be part of the decision?
> **Lead:** just me
> **AI:** Got it. Would Tue 10:00 AM or Wed 2:30 PM work for a quick 10-minute call with Mike?
> **Lead:** wed works
> **AI:** You're all set for Wed 2:30 PM. Mike will call you then. Talk soon!

The rep then gets a Slack alert, an email, a CRM note with the transcript, tags (`lre-qualified`, `lre-hot`, `lre-appointment`), a task, and the deal moved to the "Appointment" stage.

## Editing the voice
Edit `persona` in the client YAML (name, company, buyer description, market, rep), or the prompt in `prompts/conversation_agent.system.md`. Then run `npm run test:scenarios` and redeploy.
