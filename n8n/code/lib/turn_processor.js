// ---------------------------------------------------------------------------
// turn_processor.js — turns raw model output into safe, auditable decisions
//
// model JSON  ─► merge facts ─► score ─► validate action ─► guardrails ─► decision
// ---------------------------------------------------------------------------

/* global scoreLead, nextStatus, validateReply */

const MERGEABLE = [
  'is_owner', 'interested_in_selling', 'timeline', 'motivation_level', 'property_condition',
  'occupancy', 'price_flexibility', 'asking_price', 'is_decision_maker', 'property_type',
  'bedrooms', 'bathrooms', 'best_contact_time',
];

function mergeQualification(existing, extracted) {
  const out = Object.assign({}, existing || {});
  const ex = extracted || {};
  for (const f of MERGEABLE) {
    const v = ex[f];
    if (v !== null && v !== undefined && v !== '' && v !== 'unknown') out[f] = v;
  }
  const reasons = new Set([...(out.motivation_reasons || []), ...(ex.motivation_reasons || [])]);
  out.motivation_reasons = Array.from(reasons);
  if (ex.notes) out.notes = [out.notes, ex.notes].filter(Boolean).join(' | ').slice(-2000);
  if (ex.conversation_summary) out.summary = ex.conversation_summary;
  return out;
}

function hasAnyFacts(q) {
  return MERGEABLE.some((f) => q[f] !== null && q[f] !== undefined && q[f] !== 'unknown');
}

/**
 * @param turn   parsed model JSON (see prompts/schemas/conversation_turn.schema.json)
 * @param ctx    { lead, qualification, slots, client, channel }
 */
function processTurn(turn, ctx) {
  const settings = (ctx.client && ctx.client.settings) || {};
  const qs = settings.qualification || {};
  const issues = [];
  let action = turn.next_action;
  let handoffReason = turn.handoff_reason || null;

  const qualification = mergeQualification(ctx.qualification, turn.extracted);
  const scoring = scoreLead(qualification, {
    hot_threshold: qs.hot_threshold, warm_threshold: qs.warm_threshold,
    require_decision_maker: qs.require_decision_maker, weights: qs.weights,
  });

  // --- Action validation ----------------------------------------------------
  let selectedSlot = null;
  if (action === 'confirm_appointment') {
    const offered = (ctx.slots || []).map((s) => s.start_iso);
    if (turn.selected_slot_iso && offered.includes(turn.selected_slot_iso)) {
      selectedSlot = turn.selected_slot_iso;
    } else {
      issues.push('confirm_without_valid_slot');
      action = (ctx.slots || []).length ? 'offer_appointment' : 'handoff_to_human';
      if (action === 'handoff_to_human') handoffReason = 'booking_needs_human';
    }
  }
  if (action === 'offer_appointment' && !(ctx.slots || []).length) {
    issues.push('offer_without_slots');
    action = 'handoff_to_human';
    handoffReason = handoffReason || 'qualified_no_slots_available';
  }

  // Hot leads always get a human alert, even if the AI keeps talking.
  const notifyHuman = scoring.temperature === 'hot' || ['handoff_to_human', 'confirm_appointment'].includes(action);

  // Sentiment-based escalation
  if (turn.sentiment === 'angry' && action !== 'opt_out') {
    action = 'handoff_to_human';
    handoffReason = handoffReason || 'negative_sentiment';
  }

  // --- Reply guardrails ------------------------------------------------------
  const allowEmpty = action === 'opt_out';
  const g = validateReply(turn.reply, { channel: ctx.channel, allowEmpty, allowLinks: false });
  issues.push(...g.issues);
  let reply = g.text;
  if (g.fatal) {
    reply = '';
    if (action !== 'opt_out') {
      action = 'handoff_to_human';
      handoffReason = 'guardrail_blocked_reply:' + g.issues.join(',');
    }
  }

  const status = nextStatus(ctx.lead.status, action, scoring, hasAnyFacts(qualification));

  return {
    reply,
    action,
    status,
    intent: turn.intent,
    sentiment: turn.sentiment,
    selected_slot_iso: selectedSlot,
    followup_date: action === 'schedule_followup' ? turn.followup_date : null,
    handoff_reason: action === 'handoff_to_human' ? handoffReason || 'ai_requested' : null,
    notify_human: notifyHuman,
    qualification,
    score: scoring.score,
    temperature: scoring.temperature,
    qualified: scoring.qualified,
    score_reasons: scoring.reasons,
    issues,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { processTurn, mergeQualification };
}
