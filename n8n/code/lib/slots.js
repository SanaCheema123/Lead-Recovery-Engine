// ---------------------------------------------------------------------------
// slots.js — normalize calendar availability into a few human-friendly options
//
// Picks at most one morning and one afternoon slot per day so the AI can offer
// real choices ("Tue 10:00 AM or Wed 2:30 PM") instead of 9:00 / 9:15 / 9:30.
// ---------------------------------------------------------------------------

/* global localParts */

function extractSlotStarts(raw, provider) {
  const list = [];
  if (!raw) return list;
  if (provider === 'ghl') {
    for (const v of Object.values(raw)) if (v && Array.isArray(v.slots)) list.push(...v.slots);
  } else if (provider === 'calcom') {
    const d = raw.data || {};
    for (const v of Object.values(d)) if (Array.isArray(v)) for (const s of v) list.push(s.start || s.time);
  }
  return list;
}

function pickSlots(starts, tz, max, now) {
  const minTime = now ? new Date(now).getTime() : 0;
  const dates = starts.map((s) => new Date(s)).filter((d) => !isNaN(d) && d.getTime() > minTime).sort((a, b) => a - b);
  const days = {};
  for (const d of dates) {
    const p = localParts(d, tz);
    const day = (days[p.ymd] = days[p.ymd] || {});
    if (p.hour < 12 && !day.am) day.am = d;
    if (p.hour >= 13 && !day.pm) day.pm = d;
  }
  const chosen = [];
  for (const k of Object.keys(days).sort()) {
    for (const d of [days[k].am, days[k].pm]) if (d && chosen.length < max) chosen.push(d);
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return chosen.map((d) => ({ start_iso: d.toISOString(), label: fmt.format(d) }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractSlotStarts, pickSlots };
}
