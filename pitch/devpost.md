# Devpost text: Relief Grid

Paste each section into the matching Devpost field. Tracks to tick: **Neptune North**, **overall prize**,
**Best use of ElevenLabs**, **Best use of n8n**.

## Project name

Relief Grid

## Elevator pitch

When the radio dies, a dispatcher's vans stop. Ours agree who serves each home without talking. Tower jammed, 50 cities: 119.8 of 120 homes served vs 0.

## Video demo link

https://youtu.be/gYtxgIP4elE

## Try it out links

- https://kaakserver.tail042e87.ts.net:10000/ (live demo, runs in the browser)
- https://github.com/koopatroopa787/relief-grid

## Built with

javascript, html5, css, canvas, web-workers, node.js, n8n, elevenlabs, anthropic-claude, docker, tailscale, python, ffmpeg, playwright

## About the project

## Inspiration

After Hurricane Maria in 2017, about 96% of Puerto Rico's cell sites were down. We kept coming back to what that does
to relief logistics. Almost every system assumes someone at a desk can reach every driver. Take that away and the
trucks either stop, or two crews turn up at the same door while the next street waits.

So we asked a simple question: can a fleet keep working with no dispatcher and no network, and still promise it never
serves the same home twice?

## What it does

Relief Grid runs one flooded city twice, side by side. Same six vans, same 120 homes.

- On the left there's no dispatcher. Each van makes its own calls and swaps notes with any van it drives past.
- On the right is the usual setup: one dispatcher on a radio tower, handing out every job.

Then you break the radio yourself. Drag the jam brush over the tower, add packet loss, or black out the whole city.
The dispatcher's vans stop and wait for orders that never come. Ours carry on, and the "served twice" counter stays
at zero.

There's more to poke at:

- **Safe or Lifeline.** A van goes quiet. Is it broken, or just out of range? Safe mode waits, so nothing is ever
  served twice. Lifeline hands its homes to the other vans to cover ground faster, and counts every double serve, so
  the trade-off is right there on screen.
- **Voice SOS.** Families leave voice notes in their own language (English, Arabic, Urdu, Polish). Vans pass them
  along until one gets back to base. HQ transcribes it, works out what they need and how urgent it is, and records a
  spoken reply that rides back out on the next van.
- **HQ can die.** Switch HQ off mid-run. The vans don't notice: they hang on to the notes, keep retrying, and the
  backlog clears when HQ comes back.

We ran it on 50 random cities (`node sim/bench.js`, averages after 300 ticks):

| Scenario | Relief Grid served | Served twice | Dispatcher served |
|---|:---:|:---:|:---:|
| Radio clear | 120.0 / 120 | 0 | 120.0 / 120 |
| 30% packet loss | 119.9 / 120 | 0 | 120.0 / 120 |
| Base tower jammed | 119.8 / 120 | 0 | 0 / 120 |
| Full radio blackout | 116.8 / 120 | 0 | 0 / 120 |
| Base jammed, Lifeline mode | 119.7 / 120 | 16.6 per run | 0 / 120 |

One thing we want to be straight about: with a working radio, the dispatcher gets there faster. Relief Grid is for
when the radio isn't working.

## How we built it

- **No framework, no build step.** Plain JavaScript modules, HTML canvas and Web Workers.
- **Every van is its own Web Worker**, running the same pure function, `stepVan(state, percept)`. A van only knows
  what it can see and what it hears over the radio. Nothing reads global state, so the sim can't quietly cheat.
- **Agreeing without talking.** For every home, each van works out the owner with rendezvous hashing:

  $$\text{owner}(h) = \arg\max_{v \in \text{alive}} \text{hash}(h, v)$$

  Every van gets the same answer on its own, and a van only serves homes it owns. That's where "never twice" comes from.
- **Gossip that only grows.** When two vans are in range they merge their sets of served homes (a set union, so it's a
  CRDT) and their lists of who's alive, and hand a home to a closer van that still has stock.
- **A fair radio.** Range, packet loss, delay and jamming are all modelled. The dispatcher uses the same radio, just
  with a longer tower range, so it's a fair fight.
- **HQ is an n8n workflow** behind a webhook: reply cache, ElevenLabs Scribe to transcribe, Claude to translate and
  triage, ElevenLabs text-to-speech for the reply, and a Slack alert if it's urgent. Every step fails soft, and repeat
  batches are answered from the cache, so a van that retries never triggers a second paid call.
- **The console** is a hand-drawn isometric city on canvas, in the style of a printed ops sheet: roads, buildings, the
  flood, vans, radio links and jammed zones, with split-flap counters and a live chart of homes served.
- **The demo video** is made from the real sim: a script drives the page, records it, and ElevenLabs voices the
  narration.

## Challenges we ran into

- "Never serve twice" is easy right up until two vans disagree about who's alive. That's the whole reason Safe and
  Lifeline exist, and why Lifeline counts its double serves instead of hiding them.
- Keeping the comparison fair. Our first dispatcher didn't recover properly after a jam lifted, which made the baseline
  look worse than it really is. We fixed that before measuring anything.
- For a while our vans were actually slower with a clear radio than a jammed one. They kept handing homes back and
  forth. Darryll tracked it down to handover churn and fixed it.
- Three people and three AI coding agents in one repo for six hours. We split file ownership up front, and any change
  to someone else's file went through a written proposal first. Nobody overwrote anybody, which honestly surprised us.

## Accomplishments that we're proud of

- A guarantee you can actually watch. Jam the whole city and "served twice" stays at zero, and it held in all 200
  Safe-mode runs of our benchmark.
- You don't need us there to see it work. Judges can break the radio themselves, live, with no script.
- Voice SOS works end to end, in the family's own language, and HQ is allowed to fail without the field noticing.
- Six hours, three people, three AI agents, one repo, and not a single overwritten file.

## What we learned

Rendezvous hashing turned out to be a great fit for coordinating without a network: you get agreement for free,
without sending a single message. And admitting where the dispatcher wins made our case stronger, not weaker.

## What's next for Relief Grid

Real road routing for the vans, a driver app that plays pre-recorded phrases offline, and testing the ownership rule
on real delivery data from a relief organisation.

**A note on AI use:** everything was written during the hackathon. We used AI coding assistants the whole way through: Claude Code
(Kanishk and Akshita) and Google Antigravity (Darryll), to plan, write, review and debug code and to help design the
interface. Every change was reviewed by the teammate who owns that file. At runtime, HQ uses Claude to translate and
triage SOS notes, and ElevenLabs to transcribe them and speak the replies. The sample SOS voices and the video
narration are ElevenLabs text-to-speech, not real people.
