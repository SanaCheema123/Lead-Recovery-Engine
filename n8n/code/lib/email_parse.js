// ---------------------------------------------------------------------------
// email_parse.js — inbound email helpers (SendGrid Inbound Parse)
// ---------------------------------------------------------------------------

/** reply+<token>@reply.example.com  ->  token */
function extractReplyToken(toField) {
  const m = String(toField || '').match(/reply\+([a-f0-9]{8,64})@/i);
  return m ? m[1].toLowerCase() : null;
}

function extractAddress(field) {
  const m = String(field || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(field || '')).trim().toLowerCase();
}

/** Remove quoted history & signatures so the AI only sees the new reply. */
function stripQuotedReply(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^On .+wrote:\s*$/i.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From:\s.+/i.test(line.trim()) && out.length) break;
    if (/^Sent from my (iPhone|Android|mobile)/i.test(line.trim())) break;
    if (/^--\s*$/.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractReplyToken, extractAddress, stripQuotedReply };
}
