# Tasks

Status: `todo` → `doing` → `done`. Claim a task (set `doing`) and push before starting it.

## Ownership (who may edit what)

| Owner | GitHub | Files |
|---|---|---|
| Darryll | darryll-git | `sim/main.js`, `sim/van_logic.js`, `sim/van_worker.js`, `sim/dispatcher.js` |
| Kanishk | koopatroopa787 | `sim/index.html`, `sim/style.css`, `sim/ui.js`, `sim/mock_sim.js`, `sim/live_sim.js`, `sim/world.js`, `sim/radio.js`, `sim/metrics.js`, `sim/bench.html`, `sim/bench.js`, `pitch/`, `README.md`, `PRODUCT.md` |
| Akshita | romaaurora787 | `hq/` (except `hq/samples/`, see H2), `contracts/`, `sim/hq_link.js` |
| Everyone | | own rows in `TASKS.md`; append-only in `DISCUSSION.md` |

## Sim core: Darryll (about 75% of the sim)

| ID | Task | Status |
|---|---|---|
| S1 | `van_logic.js`: rendezvous-hash ownership, move to nearest owned household, serve, Safe mode | done |
| S2 | `van_logic.js`: gossip `served` set (union merge) and alive-list, handover when two vans meet | done |
| S3 | `van_logic.js`: Lifeline mode (timeout drops silent vans), count double serves | done |
| S4 | `dispatcher.js`: central dispatcher baseline over the same radio | done |
| S5 | `main.js` + `van_worker.js`: tick loop, one Web Worker per van, route messages through `radio` | done |

## Sim support and UI: Kanishk (about 25% of the sim, plus the UI)

| ID | Task | Status |
|---|---|---|
| D1 | `world.js`: seeded RNG, flood map, base, households (people, language, some with SOS), vans | done |
| D2 | `radio.js`: range, packet loss, delay, jamming mask, `send`/`deliver` | done |
| D3 | `metrics.js`, `bench.js`, `bench.html`: metrics, then run 50 seeds headless (ours vs dispatcher vs loss level), output a chart | todo |
| U1 | `index.html`, `ui.js`, `style.css`: canvas map, jam brush, loss slider, Safe/Lifeline toggle, side-by-side dispatcher view, metrics panel, play SOS and reply audio | done |

## HQ: Akshita

| ID | Task | Status |
|---|---|---|
| H1 | n8n workflow: webhook → ElevenLabs Scribe (transcribe + translate) → LLM extracts needs → dedupe by `sos_id` and household → Google Sheet log → Slack/Telegram alert if urgent → ElevenLabs voice reply → respond. Export to `hq/workflow.json` | done (tested with real keys) |
| H2 | **Handed over to Darryll (14:58).** Sample SOS clips + driver phrase bank, recorded with ElevenLabs, in `sim/samples/` (brief in `DISCUSSION.md`, "H2 handover"). Darryll may create and edit `sim/samples/` and `hq/samples/` for this task | done |
| H3 | `sim/hq_link.js`: POST batches per `PLAN.md` contract, keep and retry when HQ is down | done |

## Pitch: Kanishk

| ID | Task | Status |
|---|---|---|
| P1 | 2-minute story, slides if any, 2-minute video, Devpost text with AI-use disclosure | doing (script + Devpost text in `pitch/`; video to record) |
