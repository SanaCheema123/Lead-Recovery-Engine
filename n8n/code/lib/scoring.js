// ---------------------------------------------------------------------------
// scoring.js — deterministic seller-lead scoring (0–100)
//
// The AI extracts facts; this code scores them. Keeping scoring out of the
// model makes it auditable, tunable per client, and consistent.
// Weights can be overridden per client via settings.qualification.weights.
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS = {
  timeline: { asap: 30, '0_3_months': 28, '3_6_months': 20, '6_12_months': 10, '12_plus_months': 3, unknown: 0 },
  motivation_level: { high: 25, medium: 15, low: 5, unknown: 0 },
  property_condition: { needs_major_repairs: 10, needs_some_repairs: 8, good: 4, excellent: 2, unknown: 0 },
  price_flexibility: { flexible: 15, open_to_offer: 15, firm_reasonable: 8, firm_above_market: 2, unknown: 0 },
  occupancy: { vacant: 6, tenant_occupied: 4, owner_occupied: 2, unknown: 0 },
  decision_maker_true: 8,
  decision_maker_false: -15,
  distress_reason_bonus: 5,
  distress_reason_cap: 10,
};

const DISTRESS_REASONS = [
  'foreclosure', 'behind_on_payments', 'probate', 'inherited', 'divorce', 'relocation',
  'tired_landlord', 'financial_hardship', 'health', 'downsizing', 'code_violations', 'tax_liens', 'vacant_property',
];

function _w(table, key) {
  if (!key) return table.unknown || 0;
  return table[key] != null ? table[key] : table.unknown || 0;
}

function scoreLead(q, opts) {
  q = q || {};
  opts = opts || {};
  const W = Object.assign({}, DEFAULT_WEIGHTS, opts.weights || {});
  const reasons = [];
  let s = 0;

  if (q.interested_in_selling === 'no') {
    return { score: 0, temperature: 'cold', qualified: false, reasons: ['not_interested'] };
  }

  const add = (pts, why) => { if (pts) { s += pts; reasons.push(`${why}:${pts > 0 ? '+' : ''}${pts}`); } };
  add(_w(W.timeline, q.timeline), 'timeline');
  add(_w(W.motivation_level, q.motivation_level), 'motivation');
  add(_w(W.property_condition, q.property_condition), 'condition');
  add(_w(W.price_flexibility, q.price_flexibility), 'price');
  add(_w(W.occupancy, q.occupancy), 'occupancy');
  if (q.is_decision_maker === true) add(W.decision_maker_true, 'decision_maker');
  if (q.is_decision_maker === false) add(W.decision_maker_false, 'not_decision_maker');
  const distress = (q.motivation_reasons || []).filter((r) => DISTRESS_REASONS.includes(r));
  if (distress.length) add(Math.min(distress.length * W.distress_reason_bonus, W.distress_reason_cap), 'distress');
  if (q.interested_in_selling === 'yes') add(6, 'interested');

  s = Math.max(0, Math.min(100, s));
  const hot = opts.hot_threshold != null ? opts.hot_threshold : 70;
  const warm = opts.warm_threshold != null ? opts.warm_threshold : 40;
  const temperature = s >= hot ? 'hot' : s >= warm ? 'warm' : 'cold';

  const qualified =
    q.interested_in_selling !== 'no' &&
    (q.interested_in_selling === 'yes' || q.interested_in_selling === 'maybe') &&
    ['asap', '0_3_months', '3_6_months'].includes(q.timeline) &&
    ['high', 'medium'].includes(q.motivation_level) &&
    (opts.require_decision_maker === false ? true : q.is_decision_maker !== false);

  return { score: s, temperature, qualified, reasons };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreLead, DEFAULT_WEIGHTS, DISTRESS_REASONS };
}
