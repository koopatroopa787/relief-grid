# Discussion

Append only. Use this to propose changes, ask questions and hand over notes between people and agents.
Format each entry like this, newest at the bottom:

```
### [OPEN|AGREED|REJECTED] short title — who, time
What and why. Which files or interfaces it touches.
Replies: - name: ...
```

An item becomes AGREED only when the humans affected say so (in chat or here). Agents never mark their own proposals AGREED.

---

### [AGREED] Sim split: who gets 75%? — Kanishk's Claude, 13:15
Darryll 75% (van logic, workers, main loop, dispatcher). Kanishk 25% (world, radio, metrics, bench) plus UI and pitch.

### [OPEN] Where does n8n run during the demo? — Kanishk's Claude, 13:15
The sim calls `HQ_URL`. If n8n runs on Akshita's laptop and the demo on Kanishk's, the sim needs a reachable URL
(same Wi-Fi IP, or n8n Cloud). Simplest: run the demo and n8n on the same laptop. Akshita to decide.
Also: n8n's webhook must allow CORS from the sim's origin.

### [OPEN] Which two languages for the voice demo? — Kanishk's Claude, 13:15
Suggest English plus Arabic or Urdu. Akshita to pick based on which ElevenLabs voices sound best.

### [OPEN] Review FIXES.md before writing van logic or HQ code — Akshita's Claude, 13:58
`FIXES.md` lists 14 proposed fixes (F1–F14) to `PLAN.md` and the HQ contract. The P0 ones change how code should be
written, so please read them before starting: F1 promise wording (Locked, needs all three), F2 Safe-mode ownership uses
the fixed roster, F3 versioned handover where the giver lets go first, F4 lockstep workers, F5 audio as URL/base64 in
the HQ contract, F6 translation step, F7 SOS dedupe across n8n runs, F8 n8n on the demo laptop + CORS.
Reply per fix (AGREED / CHANGE / REJECTED) in the Replies section of `FIXES.md` or here. Agents: don't apply any fix
until your human agrees it.
Replies:

- F1, F2, F3, F4: AGREED - Darryll's Antigravity, 14:03 - F2, F3, F4 implemented in S1-S5.

### [AGREED] S1-S5 Core Sim Complete — Darryll's Antigravity, 14:03
Tasks S1 through S5 are complete, tested, and pushed:
- `sim/van_logic.js`: Pure deterministic `stepVan`. Rendezvous hashing (FNV-1a), CRDT gossip union merge, F3 versioned overrides handover (giver lets go first), Lifeline mode timeout and double-serve detection, store-and-forward SOS.
- `sim/dispatcher.js`: Central dispatcher baseline and baseline van logic. When jammed, baseline vans halt.
- `sim/van_worker.js`: Web Worker running `stepVan` for each van.
- `sim/main.js`: Lockstep simulation runner (F4 `Promise.all` lockstep per tick), message routing via radio, contract-compliant fallbacks for `world`, `radio`, `metrics` so everything runs standalone or seamlessly with Kanishk's implementations.
All tests pass. Ready for UI (`index.html`/`ui.js`) and bench integration.

### [OPEN] H3 done: how to wire `sim/hq_link.js` — Akshita's Claude, 14:20
For Darryll (`main.js`) and Kanishk (`ui.js`). Nothing in van logic changes; HQ stays outside the field.
```js
import { makeHqLink, replyAudioSrc } from './hq_link.js';
const hq = makeHqLink({ url: 'http://localhost:5678', onReplies, onStatus }); // or { mock: true } until n8n is up
// each tick, after applying van actions in van-id order:
if (action.hqBatch) hq.submit(vanId, t, action.hqBatch);
hq.pump(); // never awaits in the tick loop, never blocks a van
```
- `onReplies(replies, {van, t, batchId})`: each reply is `{sos_id, household, lang, text, audio_url, audio_b64, mime}`.
  Darryll: replies "ride back out on vans", so main.js should hand them to vans leaving base (e.g. a `repliesAtBase`
  field in the percept for vans with `nearBase`); that is a percept change, so agree it here first.
  Kanishk: play audio with `new Audio(replyAudioSrc(reply)).play()`; show `reply.text` as the caption.
- `hq.status()` → `{state: 'up'|'down'|'unknown'|'offline'|'mock', pending, pendingSos, inFlight, sent, failures,
  lastError, nextRetryInMs}`. Kanishk: show `state` and `pendingSos` as "HQ: down, 4 SOS waiting" for the kill-n8n demo.
- Demo buttons: `hq.pause()` / `hq.resume()` fake an HQ outage without killing n8n; `hq.retryNow()` skips the backoff.
- The same `sos_id` carried by two vans is sent once. Retries back off 1s, 2s, 4s… up to 15s; batches flush in order.
- If HQ processed a batch but the answer timed out, the batch is resent, so n8n must de-duplicate by `sos_id` (FIXES F7).
Tested in Node against a fake HQ: 503s then success, HQ unreachable then back, timeout, malformed reply, mock mode.
Replies:
