// U1 glue · runs Darryll's real sim for the UI, with the same snapshot() shape as mock_sim.js.
// Ours: main.js (one Web Worker per van, lockstep). Baseline: dispatcher.js on its own radio that
// shares every jam, blackout and loss setting, so one brush stroke hits both fleets.
// SOS batches go to HQ through Akshita's hq_link.js (mock HQ unless the page has ?hq=<n8n url>).
// ponytail: the UI-only bookkeeping (links, idle, served counts) lives here, not in Darryll's files.

import { createSimulation } from './main.js';
import { makeCentralDispatcher, stepDispatcherVan } from './dispatcher.js';
import { makeRadio } from './radio.js';
import { makeHqLink } from './hq_link.js';

const TOWER = 60;   // the dispatcher's base tower reaches the whole map until it is jammed
const RESTOCK = 15; // same rule as main.js

export async function createSim({ seed = 7, mode = 'safe', loss = 0, useWorkers = true } = {}) {
  const sim = await createSimulation({ seed, mode, useWorkers });
  const { world } = sim;
  const n = world.households.length;
  const hIndex = new Map(world.households.map((h, i) => [h.id, i]));
  const base = { id: 'base', ...world.base };

  // Second radio for the baseline, so main.js's deliver() never eats the tower's messages.
  const dRadio = makeRadio({ w: world.w, h: world.h, range: 8, loss, rng: world.rng });
  const radios = [sim.radio, dRadio];
  const radio = {
    get jammed() { return sim.radio.jammed; },
    get blackout() { return sim.radio.blackout; },
    get loss() { return sim.radio.loss; },
    isJammed: sim.radio.isJammed,
    canLink: sim.radio.canLink,
    jam: (x, y, r) => radios.forEach((q) => q.jam(x, y, r)),
    unjam: (x, y, r) => radios.forEach((q) => q.unjam(x, y, r)),
    clearJam: () => radios.forEach((q) => q.clearJam()),
    setBlackout: (on) => radios.forEach((q) => q.setBlackout(on)),
    setLoss: (p) => radios.forEach((q) => q.setLoss(p)),
  };
  radio.setLoss(loss);

  // Baseline fleet: own copies of vans and households, same start.
  const dVans = world.vans.map((v) => ({ ...v, idle: true }));
  const dHouses = world.households.map((h) => ({ ...h, needsAid: true }));
  const dState = {};
  const central = makeCentralDispatcher({ base: world.base, vanIds: dVans.map((v) => v.id) });
  const where = (id) => (id === 'base' ? base : dVans.find((v) => v.id === id));
  const tower = { send: (from, to, msg) => dRadio.send(where(from), where(to), msg, TOWER) };

  const side = () => ({ state: new Uint8Array(n), served: 0, doubles: 0, links: [] });
  const ours = side(), disp = side();
  const count = (s, hid) => {
    const i = hIndex.get(hid);
    if (s.state[i] === 0) { s.state[i] = 1; s.served++; } else { s.state[i] = 2; s.doubles++; }
  };

  // SOS ledger for the rail.
  const sos = world.households.filter((h) => h.sos).map((h) => ({ ...h.sos, household: h.id, state: 'waiting', van: null, reply: null }));
  const sosById = new Map(sos.map((s) => [s.sos_id, s]));
  const hqUrl = new URLSearchParams(location.search).get('hq');
  const onReplies = (replies) => replies.forEach((r) => {
    const s = sosById.get(r.sos_id);
    if (s) { s.state = 'replied'; s.reply = r; }
  });
  const hq = makeHqLink(hqUrl ? { url: hqUrl, onReplies } : { mock: true, onReplies });

  let t = 0, last = world.vans.map((v) => ({ x: v.x, y: v.y }));
  const idleOurs = new Set();

  function tickDispatcher() {
    const mail = dRadio.deliver(t);
    central.step(t, tower, mail.filter((m) => m.to === 'base'), dHouses, dVans);
    for (const v of dVans) {
      const nearBase = Math.abs(v.x - base.x) + Math.abs(v.y - base.y) <= 1;
      if (nearBase && v.stock < RESTOCK) v.stock = RESTOCK;
      const res = stepDispatcherVan(dState[v.id], {
        t, pos: { x: v.x, y: v.y }, stock: v.stock, nearBase, vanId: v.id, basePos: world.base,
        inbox: mail.filter((m) => m.to === v.id),
      });
      dState[v.id] = res.state;
      const a = res.action;
      if (a.moveTo) { v.x = a.moveTo.x; v.y = a.moveTo.y; }
      if (a.serve && v.stock > 0) {
        const h = dHouses[hIndex.get(a.serve)];
        if (h.needsAid) { h.needsAid = false; v.stock--; count(disp, h.id); }
      }
      for (const env of a.outbox) tower.send(v.id, env.to, env.msg);
      v.target = res.state.currentAssignment;
      v.idle = !v.target;
    }
    towerLinks();
  }
  const towerLinks = () => { disp.links = dVans.filter((v) => dRadio.canLink(base, v, TOWER)).map((v) => [base.x, base.y, v.x, v.y]); };
  towerLinks();

  function readOurs(events) {
    for (const e of events) {
      if (e.type === 'serve') count(ours, e.householdId);
      else if (e.type === 'pickup_sos') e.sosIds.forEach((id) => { const s = sosById.get(id); if (s && s.state === 'waiting') { s.state = 'carried'; s.van = e.vanId; } });
      else if (e.type === 'hq_batch') {
        const batch = e.batch.map((b) => ({ ...b, household: b.household ?? sosById.get(b.sos_id)?.household }));
        hq.submit(e.vanId, e.t, batch);
        batch.forEach((b) => { const s = sosById.get(b.sos_id); if (s && s.state !== 'replied') s.state = 'at_hq'; });
      }
    }
    const vs = world.vans;
    idleOurs.clear();
    vs.forEach((v, i) => { if (v.x === last[i].x && v.y === last[i].y) idleOurs.add(v.id); });
    last = vs.map((v) => ({ x: v.x, y: v.y }));
    ours.links = [];
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++)
      if (sim.radio.canLink(vs[i], vs[j])) ours.links.push([vs[i].x, vs[i].y, vs[j].x, vs[j].y]);
  }

  const summary = (s, idle) => ({ served: s.served, doubles: s.doubles, waiting: n - s.served, idle });

  return {
    world, radio,
    get t() { return t; },
    async tick() {
      const { events } = await sim.step();
      t = sim.getTick();
      readOurs(events);
      tickDispatcher();
      hq.pump();
    },
    setMode: (m) => sim.setMode(m),
    get mode() { return sim.getMode(); },
    setHqOnline: (on) => (on ? hq.resume() : hq.pause()),
    get hqOnline() { return !hq.status().paused; },
    hqStatus: () => hq.status(),
    terminate: () => sim.terminate(),
    snapshot() {
      return {
        t, mode: sim.getMode(), hqOnline: !hq.status().paused, sos,
        ours: { vans: world.vans.map((v) => ({ ...v, idle: idleOurs.has(v.id) })), links: ours.links, state: ours.state, ...summary(ours, idleOurs.size) },
        dispatcher: { vans: dVans, links: disp.links, state: disp.state, ...summary(disp, dVans.filter((v) => v.idle).length) },
      };
    },
  };
}
