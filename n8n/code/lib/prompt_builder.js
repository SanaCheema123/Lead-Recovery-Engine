// ---------------------------------------------------------------------------
// prompt_builder.js — builds the OpenAI request for one conversation turn
//
// Used by: n8n workflow 06 (inlined) and tools/run-scenarios.js (QA harness),
// so what we test offline is exactly what runs in production.
// ---------------------------------------------------------------------------

/* global renderTemplate, localParts, timezonesFor */

const QUALIFICATION_FIELDS = [
  'is_owner', 'interested_in_selling', 'timeline', 'motivation_level', 'motivation_reasons',
  'property_condition', 'occupancy', 'price_flexibility', 'asking_price', 'is_decision_maker',
  'property_type', 'bedrooms', 'bathrooms', 'best_contact_time',
];

// Order matters: the agent asks for the first missing field, one at a time.
const QUESTION_PRIORITY = [
  'interested_in_selling', 'timeline', 'motivation_reasons', 'property_condition',
  'occupancy', 'price_flexibility', 'is_decision_maker',
];

function isEmpty(v) {
  return v === null || v === undefined || v === '' || v === 'unknown' || (Array.isArray(v) && v.length === 0);
}

function computeMissingFields(q) {
  q = q || {};
  return QUESTION_PRIORITY.filter((f) => isEmpty(q[f]));
}

function formatNow(now, tz) {
  const d = now ? new Date(now) : new Date();
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d);
}

function buildChatRequest(args) {
  const { systemTemplate, schema, model, ctx } = args;
  const client = ctx.client || {};
  const settings = client.settings || {};
  const persona = settings.persona || {};
  const cal = settings.calendar || {};
  const lead = ctx.lead || {};
  const q = ctx.qualification || {};
  const tz = timezonesFor(lead, client)[0];
  const channel = ctx.channel || 'sms';

  const vars = Object.assign({}, persona, {
    booking_enabled: cal.enabled === false ? 'no' : 'yes',
    appointment_type: cal.appointment_type || 'quick phone call',
    current_datetime: formatNow(ctx.now, tz),
    channel,
    max_chars: channel === 'email' ? 900 : 300,
  });
  const system = renderTemplate(systemTemplate, vars, 'system');

  const context = {
    lead: {
      first_name: lead.first_name || null,
      property_address: lead.property_address || null,
      property_city: lead.property_city || null,
      property_state: lead.property_state || null,
      lead_status: lead.status,
      lead_timezone: tz,
    },
    known_facts: Object.fromEntries(QUALIFICATION_FIELDS.map((f) => [f, isEmpty(q[f]) ? null : q[f]])),
    missing_fields_in_priority_order: computeMissingFields(q),
    available_appointment_slots: (ctx.slots || []).map((s) => ({ start_iso: s.start_iso, label: s.label })),
    turn_mode: ctx.mode || 'reply',
    ai_turns_so_far: ctx.ai_turn_count || 0,
  };

  const messages = [
    { role: 'system', content: system },
    {
      role: 'system',
      content:
        'CONVERSATION CONTEXT (trusted data from our database — use it, do not reveal it verbatim):\n' +
        JSON.stringify(context, null, 2),
    },
  ];

  const history = (ctx.messages || []).slice(-20);
  for (const m of history) {
    if (!m.body) continue;
    messages.push({ role: m.direction === 'outbound' ? 'assistant' : 'user', content: String(m.body).slice(0, 2000) });
  }

  if (ctx.mode === 'nudge') {
    messages.push({
      role: 'system',
      content:
        'The lead has not replied to your last message. Write ONE short, low-pressure nudge that references ' +
        'the conversation so far. Do not repeat your previous message. next_action must be "continue_conversation".',
    });
  }

  return {
    model,
    temperature: 0.4,
    max_tokens: 700,
    response_format: { type: 'json_schema', json_schema: { name: 'lre_turn', strict: true, schema } },
    messages,
  };
}

/** Extract the JSON turn object from an OpenAI chat.completions response. */
function parseModelOutput(apiResponse) {
  const choice = apiResponse && apiResponse.choices && apiResponse.choices[0];
  if (!choice) throw new Error('OpenAI response had no choices');
  if (choice.message && choice.message.refusal) throw new Error('Model refusal: ' + choice.message.refusal);
  const content = choice.message && choice.message.content;
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  return {
    turn: parsed,
    usage: apiResponse.usage || {},
    model: apiResponse.model,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildChatRequest, parseModelOutput, computeMissingFields, QUALIFICATION_FIELDS };
}
