// ---------------------------------------------------------------------------
// templating.js — variable substitution + deterministic spintax
//
//   {{first_name|there}}   -> variable with fallback
//   {Hi|Hey|Hello}         -> spintax; choice is deterministic per seed (lead id)
//                             so re-renders and tests are stable.
// ---------------------------------------------------------------------------

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getPath(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function renderTemplate(template, vars, seed) {
  if (!template) return '';
  vars = vars || {};
  // 1) variables
  let out = String(template).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|([^}]*))?\}\}/g, (m, key, fallback) => {
    const v = getPath(vars, key);
    if (v === undefined || v === null || String(v).trim() === '') return fallback !== undefined ? fallback : '';
    return String(v).trim();
  });
  // 2) spintax (single braces containing at least one pipe)
  let i = 0;
  const s = seed === undefined ? 'default' : String(seed);
  out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (m, body) => {
    const opts = body.split('|');
    return opts[hashSeed(s + ':' + i++) % opts.length];
  });
  // 3) whitespace / punctuation cleanup
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.!?])/g, '$1')
    .replace(/\n /g, '\n')
    .trim();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTemplate, hashSeed };
}
