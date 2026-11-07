// Stand-in for Darryll's main.js so the UI can be built and demoed now.
// It follows the same rules as PLAN.md but runs in one thread. Darryll's main.js replaces it
// by exporting createSim() with the same snapshot() shape (see DISCUSSION.md).
// ponytail: single-threaded and crude movement; the real version runs each van in a Web Worker.

import { makeWorld } from './world.js';
import { makeRadio } from './radio.js';

const TIMEOUT = 25;      // ticks of silence before Lifeline treats a van as gone
const TOWER = 60;        // the dispatcher's base tower covers the whole map until jammed
const HQ_DELAY = 30;     // ticks the mock HQ takes to answer an SOS batch

function hash(s) {       // FNV-1a, 32-bit
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193);
  return x >>> 0;
}
const owner = (hid, vans) => vans.reduce((b, v) => (hash(hid + '|' + v) > hash(hid + '|' + b) ? v : b), vans[0]);
const step = (a, b) => ({ x: a.x + Math.sign(b.x - a.x), y: a.y + Math.sign(b.y - a.y) });
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function newSide(world) {
  return {
    vans: world.vans.map((v) => ({ ...v, target: null, served: new Set(), heard: new Map(), carried: [], idle: false })),
    state: new Uint8Array(world.households.length), // 0 waiting, 1 served, 2 served twice or more
    served: 0, doubles: 0, links: [],
  };
}

export function createSim({ seed = 7, mode = 'safe', loss = 0 } = {}) {
  const world = makeWorld(seed);
  const radio = makeRadio({ w: world.w, h: world.h, range: 8, loss, rng: world.rng });
  const ours = newSide(world), disp = newSide(world);
  const hIndex = new Map(world.households.map((h, i) => [h.id, i]));
  const ids = world.vans.map((v) => v.id);
  const sos = world.households.filter((h) => h.sos).map((h) => ({ ...h.sos, household: h.id, state: 'waiting', van: null, replyAt: null, reply: null }));
  const base = { id: 'BASE', ...world.base };
  const assigned = new Set();
  let t = 0, hqOnline = true;
  const listeners = [];

  for (const v of ours.vans) for (const o of ids) v.heard.set(o, 0);

  function serve(side, v, h) {
    const i = hIndex.get(h.id);
    if (side.state[i] === 0) { side.state[i] = 1; side.served++; } else { side.state[i] = 2; side.doubles++; }
    v.stock--;
    v.served.add(h.id);
    if (side === ours) {
      const s = sos.find((s) => s.household === h.id && s.state === 'waiting');
      if (s) { s.state = 'carried'; s.van = v.id; v.carried.push(s); }
    }
  }

  function tickOurs() {
    ours.links = [];
    for (const a of ours.vans) for (const b of ours.vans) {
      if (a.id < b.id && radio.canLink(a, b)) ours.links.push([a.x, a.y, b.x, b.y]);
      if (a !== b) radio.send(a, b, { served: [...a.served] });
    }
    for (const m of radio.deliver(t)) {
      const v = ours.vans.find((x) => x.id === m.to);
      m.msg.served.forEach((id) => v.served.add(id));
      v.heard.set(m.from, t);
    }
    for (const v of ours.vans) {
      const known = mode === 'safe' ? ids : ids.filter((o) => o === v.id || t - v.heard.get(o) <= TIMEOUT);
      const mine = world.households.filter((h) => !v.served.has(h.id) && owner(h.id, known) === v.id);
      v.target = v.stock > 0 && mine.length ? mine.reduce((b, h) => (dist2(v, h) < dist2(v, b) ? h : b)) : null;
      v.idle = !v.target;
      if (v.target) {
        Object.assign(v, step(v, v.target));
        if (v.x === v.target.x && v.y === v.target.y) serve(ours, v, v.target);
      } else if (v.carried.length) Object.assign(v, step(v, base)); // done: head home with SOS notes
      // Store-and-forward: hand carried SOS notes to HQ when the base link works.
      if (v.carried.length && hqOnline && dist2(v, base) <= 4 && radio.canLink(v, base)) {
        const batch = v.carried.splice(0);
        batch.forEach((s) => { s.state = 'at_hq'; s.replyAt = t + HQ_DELAY; });
        listeners.forEach((fn) => fn({ van: v.id, t, batch }));
      }
    }
    for (const s of sos) if (s.state === 'at_hq' && t >= s.replyAt) s.state = 'replied';
  }

  function tickDispatcher() {
    disp.links = [];
    for (const v of disp.vans) {
      const linked = radio.canLink(base, v, TOWER) && world.rng() >= radio.loss;
      if (linked) disp.links.push([base.x, base.y, v.x, v.y]);
      if (!v.target && linked && v.stock > 0) {
        const open = world.households.filter((h) => !assigned.has(h.id));
        if (open.length) { v.target = open.reduce((b, h) => (dist2(v, h) < dist2(v, b) ? h : b)); assigned.add(v.target.id); }
      }
      v.idle = !v.target;
      if (v.target) {
        Object.assign(v, step(v, v.target));
        if (v.x === v.target.x && v.y === v.target.y) { serve(disp, v, v.target); v.target = null; }
      }
    }
  }

  const summary = (side) => ({ served: side.served, doubles: side.doubles, waiting: world.households.length - side.served, idle: side.vans.filter((v) => v.idle).length });

  return {
    world, radio,
    get t() { return t; },
    tick() { t++; tickOurs(); tickDispatcher(); },
    setMode(m) { mode = m; },
    get mode() { return mode; },
    setHqOnline(on) { hqOnline = on; },
    get hqOnline() { return hqOnline; },
    onBatch(fn) { listeners.push(fn); },
    snapshot() {
      return {
        t, mode, hqOnline, sos,
        ours: { vans: ours.vans, links: ours.links, state: ours.state, ...summary(ours) },
        dispatcher: { vans: disp.vans, links: disp.links, state: disp.state, ...summary(disp) },
      };
    },
  };
}
