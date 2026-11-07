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
