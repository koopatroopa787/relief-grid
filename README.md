# Relief Grid

Aid vans that keep delivering after a disaster takes the radios down, with no central dispatcher,
and a guarantee that no household is served twice. Built at GreatUniHack 2026 for the Neptune North challenge.

[![Relief Grid: 2-minute demo video](pitch/video-poster.jpg)](https://youtu.be/gYtxgIP4elE)

**[Watch the 2-minute demo on YouTube](https://youtu.be/gYtxgIP4elE)** · [Google Drive copy](https://drive.google.com/file/d/15dHji0a7RJZlSkJChcY4BRaMA3YlqenP/view?usp=sharing)

## Results

Across 50 random cities, run headless with `node sim/bench.js` (about 10 s), or in the browser at `sim/bench.html`:

| Scenario (300 ticks, 50 seeds) | Relief Grid served | Served twice | Dispatcher served |
|---|:---:|:---:|:---:|
| Radio clear | 120.0 / 120 | 0 | 120.0 / 120 |
| 30% packet loss | 119.9 / 120 | 0 | 120.0 / 120 |
| Base tower jammed | 119.8 / 120 | 0 | 0 / 120 |
| Full radio blackout | 116.8 / 120 | 0 | 0 / 120 |
| Base jammed, Lifeline mode | 119.7 / 120 | 16.6 per run | 0 / 120 |

With a clear radio the dispatcher gets there faster; Relief Grid is for when the radio isn't working.

## Project docs

- The plan, interfaces and demo: [`PLAN.md`](PLAN.md)
- Who is doing what: [`TASKS.md`](TASKS.md)
- Proposals and questions: [`DISCUSSION.md`](DISCUSSION.md)
- Rules for AI agents: [`AGENTS.md`](AGENTS.md)

## Run

```bash
cd sim && python -m http.server 8000
```

Then open http://localhost:8000.

## AI use

All code was written during the hackathon. We used AI coding assistants throughout: Claude Code (Kanishk, Akshita)
and Google Antigravity (Darryll), to plan, write, review and debug code and to help design the interface.
Every change was reviewed by the teammate who owns that file (see [`TASKS.md`](TASKS.md)).
At runtime the HQ workflow uses Claude to translate and triage SOS notes, and ElevenLabs to transcribe them and speak
the replies. Sample SOS voices are generated with ElevenLabs text-to-speech, not recorded from real people.

## Pitch

Pitch video (2:07): https://youtu.be/gYtxgIP4elE (also on [Google Drive](https://drive.google.com/file/d/15dHji0a7RJZlSkJChcY4BRaMA3YlqenP/view?usp=sharing)), made from the real sim by
[`pitch/video/make_video.py`](pitch/video/make_video.py). Demo script, measured numbers and judge Q&A: [`pitch/script.md`](pitch/script.md). Devpost text: [`pitch/devpost.md`](pitch/devpost.md).
