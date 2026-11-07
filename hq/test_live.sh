#!/usr/bin/env bash
# Send a 4-language SOS batch to HQ and print what came back. Anyone on Tailscale can run it.
#
#   ./hq/test_live.sh                          # kaakserver
#   ./hq/test_live.sh http://localhost:5678    # another n8n
#
# Uses real API credit (4 Claude calls, 4 ElevenLabs replies). Fresh sos_ids each run, so nothing comes from cache.
set -euo pipefail

HQ="${1:-http://100.85.160.126:5678}"
TS=$(date +%s)
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

curl -s -m 120 -X POST "$HQ/webhook/sos" -H 'Content-Type: application/json' -o "$OUT" \
  -w "HTTP %{http_code} in %{time_total}s\n" -d '{"van":"V1","t":1,"batch":[
{"sos_id":"S-TEST-AR-'"$TS"'","household":"H17","lang":"ar","audio":null,"text":"نحن أربعة في الطابق الأول. والدي يحتاج إلى الأنسولين."},
{"sos_id":"S-TEST-UR-'"$TS"'","household":"H22","lang":"ur","audio":null,"text":"ہم چار لوگ ہیں، اوپر والی منزل پر۔ ابو کو انسولین چاہیے۔"},
{"sos_id":"S-TEST-PL-'"$TS"'","household":"H31","lang":"pl","audio":null,"text":"Jest nas czworo na piętrze. Mój tata potrzebuje insuliny."},
{"sos_id":"S-TEST-EN-'"$TS"'","household":"H40","lang":"en","audio":null,"text":"We are fine, the kids just need some drinking water and nappies."}]}'

python3 - "$OUT" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
for r in d.get("replies", []):
    audio = "audio OK" if r.get("audio_b64") else f"NO AUDIO ({r.get('tts_error')})"
    print(f"{r['household']} {r['lang']} urgency={r.get('urgency')} needs={r.get('needs')} {audio}"
          f"{' DEGRADED' if r.get('degraded') else ''}\n   {r.get('english')}")
if "error" in d:
    print("ERROR:", d["error"], d.get("failed"))
EOF
