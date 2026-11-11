# Prompts

| File | Used by | Purpose |
|---|---|---|
| `conversation_agent.system.md` | Workflow 06 (AI Conversation Engine), `tools/run-scenarios.js` | The agent's personality, goals, qualification order, booking rules, and hard safety rules. |
| `schemas/conversation_turn.schema.json` | Same | OpenAI Structured Outputs schema (strict). Every model turn must match it, so parsing never fails on free text. |

## How prompts reach production
Prompts are **not** pasted into n8n by hand. `npm run build:workflows` inlines the prompt and schema into the Code node of workflow 06. After editing a prompt:

```bash
npm run test:scenarios      # regression-test conversations against the real model
npm run build:workflows     # regenerate n8n/workflows/*.json
npm run deploy:workflows    # import into n8n
```

## Template variables
`{{agent_name}}`, `{{company_name}}`, `{{buyer_description}}`, `{{market_area}}`, `{{rep_name}}` come from the client's `persona` block in `config/clients/<client>.yaml`. `{{current_datetime}}`, `{{channel}}`, `{{max_chars}}`, `{{booking_enabled}}`, `{{appointment_type}}` are computed at runtime. Use `{{var|fallback}}` for optional values.

## Design principles
1. **The model talks; code decides.** The model extracts facts and proposes an action. Scoring, status changes, slot validation, opt-outs and guardrails are deterministic code (`n8n/code/lib`). This makes behaviour auditable and stops a single bad completion from booking a fake appointment or quoting a price.
2. **Deterministic opt-out first.** STOP/remove-me messages never reach the model.
3. **One question per message.** Response rates on reactivation SMS drop sharply with long messages.
4. **Honest about being AI** when asked.
