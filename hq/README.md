# HQ: the n8n workflow (H1)

## Quick access (everything the team needs)

| What | Where | Who can use it |
|---|---|---|
| n8n editor | http://100.85.160.126:5678 | Anyone on Kanishk's Tailscale network. Login: ask Akshita (never in the repo) |
| Webhook the sim calls | `POST http://100.85.160.126:5678/webhook/sos` | Anyone on Tailscale |
| Run the sim against real HQ | open the sim with `?hq=http://100.85.160.126:5678` (e.g. `http://localhost:8000/?hq=http://100.85.160.126:5678`) | Anyone on Tailscale |
| Run the sim with fake HQ | open the sim without `?hq=` (mock replies, no audio, no API cost) | Anyone |
| Check HQ is alive | `./hq/test_live.sh` (4 languages, prints triage and whether audio came back; uses API credit) | Anyone on Tailscale |
| Deploy a workflow change | edit `hq/code/*.js` or `hq/build_workflow.mjs`, then `RG_SSH_KEY=~/.ssh/<key> ./hq/deploy.sh` | Needs SSH access to kaakserver (Kanishk adds your public key) |
| API request/response format | [`contracts/sos_batch.example.json`](../contracts/sos_batch.example.json) | |
| API keys | stored in n8n Credentials (`ElevenLabs API key`, `Anthropic API key`) | Only via the n8n editor |

**Getting on Tailscale:** install Tailscale, then Kanishk shares the `kaakserver` machine with you (Tailscale admin →
Machines → kaakserver → Share) or invites you to his tailnet. Test with `curl http://100.85.160.126:5678/healthz`.

**Still to decide (team):** which laptop runs the live demo. n8n downloads SOS recordings from that laptop
(`simBase` in the *Check cache* node), so it must serve `sim/` with `python3 -m http.server 8000 --bind 0.0.0.0`
and be on Tailscale. Send Akshita its Tailscale IP. Text-only SOS notes work without this.

HQ is where vans hand in SOS notes when they reach base. It is **not** part of the field: no van ever waits for it.
`sim/hq_link.js` queues batches and retries, so you can kill n8n mid-demo and the field doesn't notice.

```
SOS batch in (webhook POST /webhook/sos)
  → Check cache          already answered? (de-duplication across runs, FIXES F7)
  → Anything new? ──no──→ Cached replies only ─────────────────────────────┐
        │yes                                                                │
  → One item per SOS → Each SOS: transcribe (loop, one at a time):         │
        Fetch SOS audio (from the sim's web server)                         │
        → ElevenLabs Scribe: transcribe (any language)                      │
  → Pick transcript (falls back to the SOS's text if there is no audio)     │
  → Claude: translate, triage, reply  (structured JSON: english, needs,     │
        urgency 1-3, people, reply in the household's language)             │
  → Parse triage (fixed fallback reply if Claude fails: "degraded")         │
  → Each SOS: speak (loop, one at a time): ElevenLabs: spoken reply (MP3)  │
  → Build replies (base64 audio, cache, 503 if any SOS failed → sim retries)│
  → Respond to sim  ←───────────────────────────────────────────────────────┘
  → Urgent and Slack set? → Slack: urgent SOS alert
```

Every HTTP node is set to **continue on error**, so one failing service never hangs the webhook:
no audio → use the text; Claude down → fixed reply in the right language; TTS down → text-only reply;
transcription failed → `503`, the sim keeps the batch and retries, and the SOS notes that did work are cached.

The ElevenLabs calls run inside *Loop Over Items* nodes, one SOS at a time, because the plan limits concurrent
requests (429 "Try spacing your requests out"). The HTTP node's own batching option is not enough: it only staggers
when requests start, so they still overlap. A reply without audio carries `tts_error` saying why.

## Where it runs today: kaakserver (Kanishk's server, over Tailscale)

- n8n 2.46.6 in Docker, container `relief-grid-n8n`, data in the Docker volume `relief_grid_n8n_data`,
  restarts automatically. Bound to the Tailscale address only, so it is **not** on the public internet.
- Editor: http://100.85.160.126:5678 (first visit: create the owner account).
- Webhook for the sim: `HQ_URL = http://100.85.160.126:5678` → POST `/webhook/sos`. The workflow is published (active).
- CORS is open, so the sim page can call it from any laptop **that is on the Tailscale network**.
- Credentials `ElevenLabs API key` and `Anthropic API key` hold the real keys (pasted in the editor, never in the repo).
- **Audio:** n8n fetches SOS clips from `simBase` in the *Check cache* node, so it must point at the laptop that
  serves the sim, by its Tailscale IP, e.g. `http://100.111.79.4:8000/`, and that laptop must serve on all
  interfaces: `cd sim && python -m http.server 8000 --bind 0.0.0.0`. Text-only SOS notes work without this.
- Tested on the server against fake ElevenLabs/Anthropic APIs: Arabic voice SOS → transcript → triage (urgency 3,
  insulin) → Arabic spoken reply; resend answered from cache with no API calls; transcription down → 503 → retry
  → 200; missing audio → 503; bad body → 200 `{replies: []}`; CORS preflight OK; Slack alert on urgency 3;
  `sim/hq_link.js` round trip OK.
- **Tested with the real APIs (7 Nov, 15:15):** a 4-SOS text batch (ar, ur, pl, en) → 200 in about 11 s, all four
  with correct triage (insulin = urgency 3) and a spoken reply in the household's language, twice in a row.
  A voice batch (Arabic and Polish recordings, no text) → Scribe transcribed both → triage → spoken replies, 200 in 12 s.

## Run it somewhere else (about 5 minutes)

1. Start n8n on the **demo laptop** (same machine as the sim, see FIXES F8):
   ```bash
   npx n8n
   ```
   Open http://localhost:5678 and create the owner account.
2. **Import:** Workflows → Import from file → `hq/workflow.json`.
3. **Credentials** (Credentials → Add → *Header Auth*), then pick them on the HTTP nodes that show a warning:
   - `ElevenLabs API key`: Name `xi-api-key`, Value = your ElevenLabs key. Used by *Scribe* and *spoken reply*.
   - `Anthropic API key`: Name `x-api-key`, Value = your Anthropic key. Used by *Claude*.
   Keys live only in n8n credentials, never in the repo.
4. **Config:** open the *Check cache* node and edit the `CONFIG` block at the top:
   `simBase` (where the sim serves audio, default `http://localhost:8000/`), `voiceId`, `ttsModel`, optional `slackWebhookUrl`.
5. **Activate** the workflow (toggle top right). The sim calls the production URL `http://localhost:5678/webhook/sos`.
   The reply cache only persists for production runs, not for "Test workflow" runs.

## Test it without the sim

A text-only SOS (no audio needed):
```bash
curl -s -X POST http://localhost:5678/webhook/sos -H 'Content-Type: application/json' \
  -d '{"van":"V1","t":1,"batch":[{"sos_id":"S-TEST-1","household":"H1","lang":"en","audio":null,"text":"My father needs insulin, we are three people."}]}'
```
Send the same request twice: the second answer comes from the cache, instantly.

## Editing the workflow

The Code-node scripts live in `hq/code/*.js`. Edit them there, then rebuild and re-import:
```bash
node hq/build_workflow.mjs
```
If you edit inside the n8n UI instead, export the workflow back to `hq/workflow.json` before committing.

## Things to check on the day

- ElevenLabs voice: `voiceId` must exist in your account; `eleven_multilingual_v2` covers Arabic. For Urdu, try `eleven_v3`.
- Claude model: `claude-opus-5-5` at effort `low`. The request opts into server-side refusal fallbacks (`fallbacks: "default"`).
- Google Sheet log (optional): add a Google Sheets "Append row" node after *Build replies* if you want a visible log for the n8n judges.
