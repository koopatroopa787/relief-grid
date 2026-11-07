# Relief Grid: 2-minute pitch and video script

One script for both the live demo and the recorded video. About 270 spoken words, so it fits in 2:00 at a calm pace.
**Bold** is what the presenter does on screen. Everything else is spoken.

Before recording: run `cd sim && python -m http.server 8000`, open http://localhost:8000, and press **R** to reset.
Re-check the numbers in `[brackets]` on the day; they come from seed 7 at tick 300 (see "Numbers" below).

## Script

**0:00–0:12 · Hook** (the page loads; the two maps resolve from pixels)

> In Hurricane Maria, about 96% of Puerto Rico's cell sites went down. Aid that waits for a dispatcher's call stops
> when the radio stops. Relief Grid keeps delivering, and no household gets served twice.

**0:12–0:28 · What you're looking at** (point left, then right)

> Same flooded city, same six vans, same 120 homes, twice. On the left, no dispatcher: every van decides for itself
> and shares what it knows when another van is in radio range. On the right, the usual way: one dispatcher on a
> radio tower, assigning every delivery. **Press Space.** Both start serving.

**0:28–0:58 · Jam it** (pick the jam brush, drag over the base tower on either map)

> Now I jam the tower. **Drag over the base.** The dispatcher is cut off: its vans stop and wait for orders.
> Ours keep going. The trick is a shared rule: every van runs the same hash over the household and the vans it
> knows are alive, so they all agree who owns each home without sending a message. A van only serves homes it
> owns, so a double serve can't happen. When vans meet, they merge their lists of served homes.
> **Point at the counters.** `[117]` served on our side, `[0]` for the dispatcher, and zero served twice.

**0:58–1:15 · Safe or Lifeline** (click **Lifeline**)

> If a van goes silent, is it dead or just out of range? Safe mode waits, so we never serve a home twice.
> Lifeline hands its homes to other vans: faster coverage, and every double serve is counted, here `[3]`.
> The person running the operation chooses the trade-off.

**1:15–1:42 · Voice SOS** (open **SOS**, play an Arabic or Urdu note)

> Homes can also leave a voice SOS, in their own language. A van carries it, van to van, until one reaches base.
> At HQ an n8n workflow transcribes it with ElevenLabs Scribe, has Claude triage it for urgency and needs,
> and records a spoken reply with ElevenLabs. **Play the reply.** The reply rides back out on the next van.

**1:42–1:52 · Kill HQ** (switch **HQ offline**, then back on)

> And if HQ goes down? The field doesn't care. Vans keep the notes and retry; when HQ is back, the backlog flushes.

**1:52–2:00 · Close**

> No dispatcher, no network, and nobody served twice. Judge, jam it.

## Numbers (seed 7, tick 300, measured from the real sim on 7 Nov 14:58)

| Scenario | Relief Grid | Dispatcher | Served twice (ours) |
|---|---|---|---|
| Base tower jammed (radius 6), Safe | 117 | 0 | 0 |
| Full blackout, Safe | 118 | 0 | 0 |
| Base jammed, Lifeline | 120 | 0 | 3 |
| 30% packet loss, Safe | 120 | 120 | 0 |
| Radio clear, Safe | 102 (120 by tick 500) | 120 | 0 |

Be ready to say the last row out loud if asked: **with a working radio, a dispatcher is faster.** Relief Grid is what
keeps aid moving when the radio isn't working, and it never trades away the "served once" guarantee to get there.

## Likely judge questions

- **"Isn't the van reading the global map?"** No. Each van runs `van_logic.js` in its own Web Worker and only sees
  its percept (position, stock, nearby homes) and radio messages. Nothing reads global state.
- **"Why can't two vans both serve a home?"** Ownership comes from rendezvous hashing over the alive list. In Safe mode
  a silent van stays in that list, so its homes stay owned by it and nobody else touches them.
- **"What if two vans disagree about who is alive?"** That is the Lifeline case. They can briefly both own a home, which
  is exactly where the counted double serves come from. Safe mode never drops a van, so it can't happen there.
- **"Is the radio realistic?"** Range limit, packet loss, delay and jamming are all modelled in `radio.js`; the
  dispatcher uses the same radio, with a much longer tower range, so the comparison is fair.
- **"What does n8n do that code couldn't?"** It's HQ's glue: webhook, dedupe, transcription, triage, voice reply and
  alerts, each node failing soft, and anyone at HQ can change the flow without a deploy.
- **"Did you build this today?"** Yes, every line during the event. We used AI assistants and say so in the README.

## Recording the video

- Screen: 1440×900 or larger, browser at 100% zoom, no other tabs visible. Record with OBS or the Xbox Game Bar (Win+G).
- Audio: one take of the voice-over is fine; the SOS and reply clips play from the page, so keep system audio on.
- If the live HQ isn't reachable, record the voice section on the mock HQ (the default without `?hq=`) and say
  "HQ here is our n8n workflow"; show the n8n canvas in a cut-away instead.
