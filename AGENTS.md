# Rules for every AI agent on this repo

Three people work here, each with an agent: Kanishk (Claude Code), Akshita (Claude Code), Darryll (Antigravity).
These rules stop us overwriting each other or drifting from the plan. Follow them exactly.

## Before any work

1. `git pull --rebase`.
2. Read `PLAN.md`, `TASKS.md` and the open items in `DISCUSSION.md`.
3. Ask your human which task ID they want you on, if they didn't say.

## Ownership

- You may edit **only the files your human owns** in the ownership table in `TASKS.md`.
- Need a change in someone else's file, or in an interface in `PLAN.md`? Do not edit it. Add a proposal to
  `DISCUSSION.md` and tell your human. Until it is agreed, build against the current interface and mock the other side.
- Never edit the **Locked** section of `PLAN.md`.
- `TASKS.md` and `DISCUSSION.md` are shared: change only your own rows, and only append to `DISCUSSION.md`.

## Working

- Claim a task before starting it: set its status to `doing` in `TASKS.md`, commit and push right away.
- Commit small and push at least every 30 minutes. Start commit messages with the task ID, e.g. `S2: merge served maps on gossip`.
- Always `git pull --rebase` before pushing. On a conflict in a file you don't own, keep their version and tell your human.
- Work on `main`. No long-lived branches; the ownership table is what keeps us apart.
- When a task is done, set it to `done` in `TASKS.md` and note anything others need in `DISCUSSION.md`.

## Code

- `sim/` is plain JavaScript ES modules: no framework, no build step, no npm packages.
- All randomness goes through `world.rng`. Never call `Math.random` in `sim/`.
- Vans only learn things through their `percept` and messages from `radio`. Nothing reads global state inside van logic.
  This is the honesty of the whole project: the judges will ask.
- Keep functions small and readable. Every line must be explainable by a teammate in Q&A.
- No secrets in the repo. API keys go in n8n credentials or a git-ignored `.env`.
- Everything is written today, from scratch. Do not paste code from earlier projects.

## When unsure

Stop and ask your human. A wrong guess that changes the plan costs more than a question.
