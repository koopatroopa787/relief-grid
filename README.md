# Relief Grid

Aid vans that keep delivering after a disaster takes the radios down, with no central dispatcher,
and a guarantee that no household is served twice. Built at GreatUniHack 2026 for the Neptune North challenge.

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

Demo script, measured numbers and judge Q&A: [`pitch/script.md`](pitch/script.md). Devpost text: [`pitch/devpost.md`](pitch/devpost.md).
