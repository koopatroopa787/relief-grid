# Relief Grid: the plan

This is the single source of truth. Every person and every AI agent reads it before doing anything.
The **Locked** section changes only when the whole team agrees in chat; an agent never edits it.
To change anything else, write a proposal in `DISCUSSION.md` first.

## Locked

- **Event:** GreatUniHack 2026, Manchester, 7 Nov 2026. Hacking 12:00–18:00. Submit on Devpost by 17:50.
- **Tracks:** Neptune North (main) + overall prize (opt in) + Best use of ElevenLabs + Best use of n8n.
- **Idea:** after a flood, radios and phones are down. Aid vans deliver rations to households with no central dispatcher.
  Promise: **every household served exactly once, even with no comms.** Households send voice SOS notes;
  vans carry them to base; an n8n workflow at HQ transcribes, triages and sends back a spoken reply.
- **Stack:** plain JavaScript ES modules, HTML canvas, Web Workers. No framework, no build step, no npm packages in `sim/`.
  HQ is n8n (run with `npx n8n`) plus the ElevenLabs API.
- **Built today:** every line is written during the event (the rules ban pre-made work). AI use is disclosed in the README.

## How it works

1. **Ownership by a shared rule.** Each household has exactly one owner van, chosen by rendezvous hashing
   over the vans that van currently believes are alive: `owner(h) = argmax over vans v of hash(h.id, v.id)`.
   Every van computes the same answer without sending a message.
2. **Serve only what you own.** Offline, a van only serves households it owns, so a double serve cannot happen.
3. **Gossip when in range.** Vans within radio range swap their `served` maps (a CRDT: a set of served household ids,
   merged by union) and their list of vans they have heard from recently.
4. **Handover when vans meet.** Two vans in range can hand households to whichever is closer, and pass spare stock.
5. **Safe vs Lifeline (judge toggle).** A van silent for longer than `TIMEOUT` ticks might be dead or just cut off.
   - Safe: keep it in the owner list. Never double-serve; its households wait.
   - Lifeline: drop it from the owner list, so its households move to others. Some double serves can happen; we count them.
6. **Store-and-forward SOS.** Household SOS notes are picked up by a van and carried. When a van is near base it
   POSTs its batch to HQ (n8n). Replies ride back out on vans to the household.
7. **Baseline.** A central dispatcher assigns every delivery over the same radio. When jammed, its vans stop.

Failure model: messages can be dropped or delayed, the network can split, vans can crash. Vans never lie (no Byzantine faults).
During a split we choose availability with a guarantee (Safe mode), or more availability with counted duplicates (Lifeline).

## Interfaces (the contract; build against these, mock the other side until it exists)

All positions are grid cells; time is integer ticks. All randomness comes from `world.rng` (seeded), never `Math.random`.

```js
// sim/world.js  (owner: Kanishk)
makeWorld(seed, {w: 48, h: 32, households: 120, vans: 6}) -> {
  seed, w, h, rng,                       // rng() -> float in [0,1), deterministic
  base: {x, y},
  households: [{id, x, y, people, lang, sos: null | {sos_id, lang, audio, text}}],
  vans: [{id, x, y, stock}]
}

// sim/radio.js  (owner: Kanishk)
makeRadio({range: 8, loss: 0.0, delay: 0, rng}) -> {
  jam(x, y, r), clearJam(),              // jamming brush; jammed cells block any link touching them
  setLoss(p),                            // 0..1 packet loss slider
  canLink(a, b) -> bool,                 // a, b: {x, y}; in range and not jammed
  send(from, to, msg),                   // queues if linked and not dropped
  deliver(t) -> [{to, from, msg}]        // messages arriving at tick t
}

// sim/van_logic.js  (owner: Darryll) pure function, used by the worker and by the bench
stepVan(state, percept) -> {state, action}
  percept = {t, pos, stock, seenHouseholds: [{id, x, y, needsAid, sos}], inbox: [msg], nearBase: bool, mode: 'safe'|'lifeline'}
  action  = {moveTo: {x, y} | null, serve: householdId | null, outbox: [{to, msg}], pickupSos: [sos_id], hqBatch: [sos] | null}

// sim/metrics.js  (owner: Kanishk)
makeMetrics() -> { update(t, world, events), summary() -> {served, doubleServes, missed, stockWasted, timeToAgree} }
```

HQ contract (owner: Akshita), example in `contracts/sos_batch.example.json`:

```
POST {HQ_URL}/webhook/sos   body: {van, t, batch: [{sos_id, household, lang, audio, text}]}
200 -> {replies: [{sos_id, household, lang, text, audio_url}]}
HQ down or error -> the sim keeps the batch and retries later (sim/hq_link.js)
```

## Demo (2 minutes)

1. Jam the radio with the brush. Our vans keep delivering, double serves stay at 0, the dispatcher's vans stop.
2. Flip Safe to Lifeline: faster coverage, a counted number of double serves.
3. Play a household's voice SOS (Arabic or Urdu).
4. A van reaches base, the n8n workflow runs on screen, the spoken reply plays.
5. Kill n8n. The field doesn't care. Bring it back and the backlog flushes.

Pitch opener: "In Hurricane Maria, 96% of cell sites went down. Aid that depends on one dispatcher stops. Ours keeps going,
and nobody gets served twice. Judge, jam it."

## Schedule

| Time | Sim (Darryll 75%, Kanishk 25%) | HQ (Akshita) | Pitch (Kanishk) |
|---|---|---|---|
| 13:15–14:30 | world, radio, van_logic ownership + Safe mode, canvas render | n8n up, webhook, ElevenLabs transcription | |
| 14:30–15:30 | gossip, handover, jam brush, dispatcher baseline, metrics | LLM extract, dedupe, Sheet, alert, voice reply | |
| 15:30–16:15 | Lifeline toggle, bench (50 seeds), hq_link | sample SOS audio, phrase bank, retries | outline |
| 16:15–16:45 | integrate everything, rehearse (poker bot submit window opens 16:00) | | |
| 16:45–17:15 | Neptune North workshop, Theatre A | | |
| 17:15–17:45 | | | 2-min video, Devpost text |
| by 17:50 | submit, repo public, everyone added | | |

Cut if late, in this order: translation, Slack alert, Lifeline toggle. Never cut: jam brush, dispatcher baseline, dedupe.

## Run it

```bash
cd sim && python -m http.server 8000   # then open http://localhost:8000  (workers need http, not file://)
```
