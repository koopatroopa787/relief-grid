# Tasks

Status: `todo` → `doing` → `done`. Claim a task (set `doing`) and push before starting it.

## Ownership (who may edit what)

| Owner | GitHub | Files |
|---|---|---|
| Darryll | darryll-git | `sim/main.js`, `sim/van_logic.js`, `sim/van_worker.js`, `sim/dispatcher.js` |
| Kanishk | koopatroopa787 | `sim/index.html`, `sim/style.css`, `sim/ui.js`, `sim/world.js`, `sim/radio.js`, `sim/metrics.js`, `sim/bench.html`, `sim/bench.js`, `pitch/`, `README.md` |
| Akshita | romaaurora787 | `hq/`, `contracts/`, `sim/hq_link.js` |
| Everyone | | own rows in `TASKS.md`; append-only in `DISCUSSION.md` |

## Sim core: Darryll (about 75% of the sim)

| ID | Task | Status |
|---|---|---|
| S1 | `van_logic.js`: rendezvous-hash ownership, move to nearest owned household, serve, Safe mode | done |
| S2 | `van_logic.js`: gossip `served` set (union merge) and alive-list, handover when two vans meet | todo |
| S3 | `van_logic.js`: Lifeline mode (timeout drops silent vans), count double serves | todo |
| S4 | `dispatcher.js`: central dispatcher baseline over the same radio | todo |
| S5 | `main.js` + `van_worker.js`: tick loop, one Web Worker per van, route messages through `radio` | todo |

## Sim support and UI: Kanishk (about 25% of the sim, plus the UI)

| ID | Task | Status |
|---|---|---|
| D1 | `world.js`: seeded RNG, flood map, base, households (people, language, some with SOS), vans | todo |
| D2 | `radio.js`: range, packet loss, delay, jamming mask, `send`/`deliver` | todo |
| D3 | `metrics.js`, `bench.js`, `bench.html`: metrics, then run 50 seeds headless (ours vs dispatcher vs loss level), output a chart | todo |
| U1 | `index.html`, `ui.js`, `style.css`: canvas map, jam brush, loss slider, Safe/Lifeline toggle, side-by-side dispatcher view, metrics panel, play SOS and reply audio | todo |

## HQ: Akshita

| ID | Task | Status |
|---|---|---|
| H1 | n8n workflow: webhook → ElevenLabs Scribe (transcribe + translate) → LLM extracts needs → dedupe by `sos_id` and household → Google Sheet log → Slack/Telegram alert if urgent → ElevenLabs voice reply → respond. Export to `hq/workflow.json` | todo |
| H2 | Sample SOS audio in 2 languages and a pre-recorded driver phrase bank (ElevenLabs) in `hq/samples/` | todo |
| H3 | `sim/hq_link.js`: POST batches per `PLAN.md` contract, keep and retry when HQ is down | todo |

## Pitch: Kanishk

| ID | Task | Status |
|---|---|---|
| P1 | 2-minute story, slides if any, 2-minute video, Devpost text with AI-use disclosure | todo |
