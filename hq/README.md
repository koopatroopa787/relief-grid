# HQ: the n8n workflow (H1)

HQ is where vans hand in SOS notes when they reach base. It is **not** part of the field: no van ever waits for it.
`sim/hq_link.js` queues batches and retries, so you can kill n8n mid-demo and the field doesn't notice.

```
SOS batch in (webhook POST /webhook/sos)
  → Check cache          already answered? (de-duplication across runs, FIXES F7)
  → Anything new? ──no──→ Cached replies only ─────────────────────────────┐
        │yes                                                                │
  → One item per SOS → Fetch SOS audio (from the sim's web server)          │
  → ElevenLabs Scribe: transcribe (any language)                            │
  → Pick transcript (falls back to the SOS's text if there is no audio)     │
  → Claude: translate, triage, reply  (structured JSON: english, needs,     │
        urgency 1-3, people, reply in the household's language)             │
  → Parse triage (fixed fallback reply if Claude fails: "degraded")         │
  → ElevenLabs: spoken reply (MP3)                                          │
  → Build replies (base64 audio, cache, 503 if any SOS failed → sim retries)│
  → Respond to sim  ←───────────────────────────────────────────────────────┘
  → Urgent and Slack set? → Slack: urgent SOS alert
```

Every HTTP node is set to **continue on error**, so one failing service never hangs the webhook:
no audio → use the text; Claude down → fixed reply in the right language; TTS down → text-only reply;
transcription failed → `503`, the sim keeps the batch and retries, and the SOS notes that did work are cached.

## Run it (about 5 minutes)

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
