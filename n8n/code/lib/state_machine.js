// ---------------------------------------------------------------------------
// state_machine.js — lead status lifecycle
//
//   new → queued → contacted → engaged → qualifying → qualified → appointment_booked
//                                   ↘ nurture / not_interested / wrong_number / handed_off
//   any → dnc (terminal, only reversed by an explicit START opt-in)
// ---------------------------------------------------------------------------

const LEAD_STATUSES = [
  'new', 'queued', 'contacted', 'engaged', 'qualifying', 'qualified', 'appointment_booked',
  'handed_off', 'nurture', 'not_interested', 'wrong_number', 'bad_number', 'dnc',
];

const TERMINAL = ['dnc', 'wrong_number', 'bad_number'];
const AI_STOP = ['dnc', 'wrong_number', 'bad_number', 'appointment_booked', 'handed_off', 'not_interested'];

const ACTIONS = [
  'continue_conversation', 'offer_appointment', 'confirm_appointment', 'schedule_followup',
  'handoff_to_human', 'mark_not_interested', 'mark_wrong_number', 'opt_out', 'end_conversation',
];

const RANK = {
  new: 0, queued: 1, contacted: 2, nurture: 3, engaged: 4, qualifying: 5, qualified: 6,
  appointment_booked: 7, handed_off: 7,
};

/**
 * Compute the next status from the current status + AI action + scoring.
 * Never moves a lead "backwards" in the funnel except into nurture/closed states.
 */
function nextStatus(current, action, scoring, hasAnyFacts) {
  if (TERMINAL.includes(current)) return current;
  switch (action) {
    case 'opt_out': return 'dnc';
    case 'mark_wrong_number': return 'wrong_number';
    case 'mark_not_interested': return 'not_interested';
    case 'schedule_followup': return 'nurture';
    case 'handoff_to_human': return current === 'appointment_booked' ? current : 'handed_off';
    case 'confirm_appointment': return 'appointment_booked'; // finalised only after a successful booking
    case 'offer_appointment': return maxStatus(current, 'qualified');
    default: {
      let target = 'engaged';
      if (hasAnyFacts) target = 'qualifying';
      if (scoring && scoring.qualified) target = 'qualified';
      if (current === 'nurture' || current === 'not_interested') return target; // lead re-engaged
      return maxStatus(current, target);
    }
  }
}

function maxStatus(a, b) {
  return (RANK[a] != null ? RANK[a] : 0) >= (RANK[b] != null ? RANK[b] : 0) ? a : b;
}

function aiShouldRespond(status, aiPaused) {
  return !aiPaused && !AI_STOP.includes(status);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LEAD_STATUSES, TERMINAL, AI_STOP, ACTIONS, nextStatus, aiShouldRespond };
}
