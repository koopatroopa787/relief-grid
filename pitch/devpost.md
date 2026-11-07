# Devpost text: Relief Grid

Paste each section into the matching Devpost field. Tracks to tick: **Neptune North**, **overall prize**,
**Best use of ElevenLabs**, **Best use of n8n**.

## Video demo link

https://youtu.be/gYtxgIP4elE

## Tagline

Aid vans that keep delivering when the radios go down, with no dispatcher and nobody served twice.

## Inspiration

After Hurricane Maria, about 96% of Puerto Rico's cell sites were out of service. Most relief logistics still assume
someone at a desk can reach every driver. When that link breaks, deliveries stop, or two crews end up at the same door
while the next street waits. We wanted a fleet that keeps working without the network, and that can prove it never
serves the same household twice.

## What it does

Relief Grid is a live simulation of one flooded city, shown twice side by side:

- **Left: Relief Grid.** Six vans and no dispatcher. Each van decides for itself and shares what it knows with any
  van in radio range.
- **Right: the baseline.** The same six vans, run by a central dispatcher on a radio tower.

You break the radio yourself: drag the jam brush over the map, add packet loss, or black out the whole city.
The dispatcher's vans stop and wait for orders. Ours keep serving, and the "served twice" counter stays at zero.

- **Safe or Lifeline.** If a van goes silent, Safe mode keeps its homes reserved for it (never a double serve).
  Lifeline hands them to other vans for faster coverage and counts every double serve, so the trade-off is visible.
- **Voice SOS.** Households leave voice notes in their own language (English, Arabic, Urdu, Polish). Vans carry them
  van to van until one reaches base. HQ transcribes, triages and records a spoken reply, which rides back out on a van.
- **HQ can fail.** Turn HQ off mid-demo: the field doesn't notice, vans keep the notes and retry, and the backlog
  flushes when HQ returns.

Across 50 random cities (`node sim/bench.js`, averages):

| Scenario (300 ticks, 50 seeds) | Relief Grid served | Served twice | Dispatcher served |
|---|:---:|:---:|:---:|
| Radio clear | 120.0 / 120 | 0 | 120.0 / 120 |
| 30% packet loss | 119.9 / 120 | 0 | 120.0 / 120 |
| Base tower jammed | 119.8 / 120 | 0 | 0 / 120 |
| Full radio blackout | 116.8 / 120 | 0 | 0 / 120 |
| Base jammed, Lifeline mode | 119.7 / 120 | 16.6 per run | 0 / 120 |

In Safe mode no home was served twice in any run, even in a full blackout. With a working radio the dispatcher gets
there faster, and we say so: Relief Grid is for when the radio isn't working. Lifeline trades double serves for speed,
and counts every one.

## How we built it

- **No framework, no build step.** Plain JavaScript ES modules, HTML canvas and Web Workers.
- **Every van is its own Web Worker** running the same pure function, `stepVan(state, percept)`. A van only learns
  things through its percept and radio messages; nothing reads global state, so the sim can't cheat.
- **Ownership by rendezvous hashing.** Each van computes `owner(home) = argmax over alive vans of hash(home, van)`.
  Every van gets the same answer without a single message, and a van only serves what it owns.
- **Gossip as a CRDT.** When two vans are in range they merge their sets of served homes (union) and their alive lists,
  and hand a home over to a nearby van that is closer to it and still has stock.
- **A modelled radio** with range, packet loss, delay and a jamming mask. The baseline dispatcher uses the same radio.
- **HQ is an n8n workflow** behind a webhook: check the reply cache, fetch the SOS audio, transcribe with
  **ElevenLabs Scribe**, translate and triage with **Claude** (needs, urgency, people), record the reply with
  **ElevenLabs text-to-speech**, respond to the van, and alert Slack if a note is urgent. Every node fails soft, and
  repeated batches are answered from the cache, so a van that retries never triggers a second call.
- **The console** is a hand-drawn isometric city on canvas: roads, buildings, the flood, vans, radio links and
  jammed zones, with split-flap counters and a live trend of homes served.

## Challenges we ran into

- Making "never serve twice" hold when vans disagree about who is alive. That's why Safe and Lifeline are separate,
  and why Lifeline counts its double serves instead of hiding them.
- Keeping the comparison fair: the dispatcher had to recover properly after a jam lifts, or the baseline would look
  worse than it really is.
- Three people and three AI agents in one repo for six hours. We split file ownership up front and made every
  cross-boundary change a written proposal, so nobody overwrote anyone.

## Accomplishments that we're proud of

- A guarantee you can watch: jam the city and the "served twice" counter stays at zero.
- A judge can break it live, with no script.
- Voice SOS end to end, in the household's language, with HQ allowed to fail.

## What we learned

Rendezvous hashing is a surprisingly good fit for disconnected coordination: agreement with no messages. And being
honest about the trade-off (a dispatcher is faster when comms work) makes the case stronger, not weaker.

## What's next

Real road routing for the vans, a phone app for drivers that speaks the pre-recorded phrases offline, and testing
the ownership rule on real delivery data from a relief organisation.

## Built with

JavaScript, HTML Canvas, Web Workers, n8n, ElevenLabs (Scribe and text-to-speech), Anthropic Claude, Docker, Tailscale.

## AI use disclosure

All code was written during the hackathon. We used AI coding assistants throughout: **Claude Code** (Kanishk and
Akshita) and **Google Antigravity** (Darryll), to plan, write, review and debug code and to help design the interface.
Every change was reviewed by the teammate who owns that file. At runtime, the HQ workflow uses **Claude** to
translate and triage SOS notes and **ElevenLabs** to transcribe them and generate the spoken replies. The sample SOS
voices are generated with ElevenLabs text-to-speech, not recorded from real people.
