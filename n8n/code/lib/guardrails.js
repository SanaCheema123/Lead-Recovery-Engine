// ---------------------------------------------------------------------------
// guardrails.js — validates every AI reply before it can be sent
// ---------------------------------------------------------------------------

const FATAL_PATTERNS = [
  { re: /\$\s?\d[\d,]*(\.\d+)?\s*(k|K|thousand|million)?/, issue: 'quotes_a_price' },
  { re: /\bguarantee(d|s)?\b/i, issue: 'makes_guarantee' },
  { re: /\bi('?m| am)\s+(a\s+)?(real\s+)?(human|person|not\s+(a\s+)?(bot|ai|robot))\b/i, issue: 'claims_to_be_human' },
  { re: /\b(legal|tax|financial)\s+advice\b/i, issue: 'gives_professional_advice' },
  { re: /\b(as an ai language model|i cannot assist)\b/i, issue: 'model_meta_leak' },
  { re: /\{\{|\}\}|\[(first_name|name|address)\]/i, issue: 'unrendered_placeholder' },
];

const SOFT_PATTERNS = [
  { re: /https?:\/\/|www\./i, issue: 'contains_link' },
  { re: /!{2,}/, issue: 'excessive_exclamation' },
];

function stripFormatting(text) {
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function truncateAtSentence(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const idx = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (idx > max * 0.5 ? cut.slice(0, idx + 1) : cut.slice(0, max - 1) + '…').trim();
}

/**
 * @returns {{ok:boolean, text:string, issues:string[], fatal:boolean}}
 */
function validateReply(reply, ctx) {
  ctx = ctx || {};
  const issues = [];
  let text = stripFormatting(reply);
  const max = ctx.channel === 'email' ? 1200 : (ctx.sms_max_chars || 320);

  if (!text) return { ok: ctx.allowEmpty === true, text: '', issues: ['empty_reply'], fatal: ctx.allowEmpty !== true };

  for (const p of FATAL_PATTERNS) if (p.re.test(text)) issues.push(p.issue);
  const fatal = issues.length > 0;
  for (const p of SOFT_PATTERNS) if (p.re.test(text)) issues.push(p.issue);

  if (issues.includes('contains_link') && !ctx.allowLinks) {
    text = text.replace(/https?:\/\/\S+|www\.\S+/gi, '').trim();
  }
  text = text.replace(/!{2,}/g, '!');
  if (text.length > max) {
    issues.push('too_long_truncated');
    text = truncateAtSentence(text, max);
  }
  return { ok: !fatal, text, issues, fatal };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateReply, stripFormatting, truncateAtSentence };
}
