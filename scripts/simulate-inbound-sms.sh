#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Simulate a lead texting back — for demos and testing WITHOUT a real phone.
# Requires TWILIO_VALIDATE_SIGNATURE=false on a staging instance, OR signs the
# request properly when TWILIO_AUTH_TOKEN is set (default).
#
#   bash scripts/simulate-inbound-sms.sh +12145550101 "Yes still thinking about selling"
# -----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
FROM="${1:?from phone (E.164)}"; BODY="${2:?message body}"
TO="${3:-$(node -e 'const y=require("js-yaml"),fs=require("fs");console.log(y.load(fs.readFileSync("config/clients/demo-client.yaml","utf8")).messaging.sms_from_numbers[0])')}"
SID="SMsim$(date +%s%N | cut -c1-24)"
URL="${APP_BASE_URL}/webhook/lre/sms/inbound"

SIG=$(node -e '
const c=require("crypto");const [url,token,...kv]=process.argv.slice(1);const p={};
for(let i=0;i<kv.length;i+=2)p[kv[i]]=kv[i+1];
const d=url+Object.keys(p).sort().map(k=>k+p[k]).join("");
console.log(c.createHmac("sha1",token).update(Buffer.from(d,"utf-8")).digest("base64"));
' "$URL" "$TWILIO_AUTH_TOKEN" From "$FROM" To "$TO" Body "$BODY" MessageSid "$SID" NumMedia 0)

curl -sS -X POST "$URL" -H "X-Twilio-Signature: $SIG" \
  --data-urlencode "From=$FROM" --data-urlencode "To=$TO" --data-urlencode "Body=$BODY" \
  --data-urlencode "MessageSid=$SID" --data-urlencode "NumMedia=0"
echo; echo "✓ sent inbound SMS $SID from $FROM → $TO"
