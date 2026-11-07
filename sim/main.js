// sim/main.js
// Owner: Darryll
// Main simulation loop for Relief Grid.
// Manages world state, radio routing, lockstep Web Workers (F4), metrics, and baseline comparison.
// Plain JS ES module, deterministic, no Math.random.

import { stepVan, initVanState } from './van_logic.js';
import { makeCentralDispatcher, stepDispatcherVan } from './dispatcher.js';

/**
 * Deterministic PRNG fallback (xorshift32) if world.js is not yet available.
 */
function makePRNG(seed = 42) {
  let s = (seed >>> 0) || 123456789;
  return function rng() {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Fallback world generator matching PLAN.md contract.
 */
export function makeFallbackWorld(seed = 42, { w = 48, h = 32, households = 120, vans = 6 } = {}) {
  const rng = makePRNG(seed);
  const base = { x: Math.floor(w / 2), y: Math.floor(h / 2) };

  const householdList = [];
  for (let i = 0; i < households; i++) {
    const hx = Math.floor(rng() * w);
    const hy = Math.floor(rng() * h);
    const people = 1 + Math.floor(rng() * 5);
    const lang = rng() > 0.5 ? 'ar' : 'ur';
    const hasSos = rng() < 0.2; // 20% have SOS

    householdList.push({
      id: `H${i}`,
      x: hx,
      y: hy,
      people,
      lang,
      needsAid: true,
      sos: hasSos ? {
        sos_id: `SOS-H${i}-${seed}`,
        lang,
        audio: `samples/sos_h${i}_${lang}.mp3`,
        text: `Household ${i} urgent assistance request.`,
      } : null,
    });
  }

  const vanList = [];
  for (let i = 0; i < vans; i++) {
    vanList.push({
      id: `V${i}`,
      x: base.x,
      y: base.y,
      stock: 15,
    });
  }

  return {
    seed,
    w,
    h,
    rng,
    base,
    households: householdList,
    vans: vanList,
  };
}

/**
 * Fallback radio matching PLAN.md contract.
 */
export function makeFallbackRadio({ range = 8, loss = 0.0, delay = 0, rng = makePRNG(1) } = {}) {
  const queue = [];
  const jammedCells = new Set();

  return {
    range,
    loss,
    delay,
    jam(x, y, r = 3) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (dx * dx + dy * dy <= r * r) {
            jammedCells.add(`${x + dx},${y + dy}`);
          }
        }
      }
    },
    clearJam() {
      jammedCells.clear();
    },
    setLoss(p) {
      this.loss = Math.max(0, Math.min(1, p));
    },
    canLink(a, b) {
      if (!a || !b) return false;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > this.range) return false;

      // Check if line between a and b passes through jammed cells
      const steps = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), 1);
      for (let s = 0; s <= steps; s++) {
        const cx = Math.round(a.x + (dx * s) / steps);
        const cy = Math.round(a.y + (dy * s) / steps);
        if (jammedCells.has(`${cx},${cy}`)) return false;
      }
      return true;
    },
    send(from, to, msg) {
      if (this.loss > 0 && rng() < this.loss) {
        return; // Packet lost
      }
      queue.push({
        from,
        to,
        msg: JSON.parse(JSON.stringify(msg)),
        deliverAtTick: 0, // Will be set on deliver
      });
    },
    deliver(t) {
      const arrived = [];
      const remaining = [];
      for (const item of queue) {
        if (item.deliverAtTick <= t) {
          arrived.push({ from: item.from, to: item.to, msg: item.msg });
        } else {
          remaining.push(item);
        }
      }
      queue.length = 0;
      queue.push(...remaining);
      return arrived;
    },
  };
}

/**
 * Fallback metrics matching PLAN.md contract.
 */
export function makeFallbackMetrics() {
  let doubleServes = 0;
  let stockWasted = 0;
  let lastWorld = null;
  const servedMap = new Map();

  return {
    update(t, world, events = []) {
      lastWorld = world;
      for (const ev of events) {
        if (ev.type === 'serve') {
          if (servedMap.has(ev.householdId)) {
            doubleServes++;
            stockWasted++;
          } else {
            servedMap.set(ev.householdId, t);
          }
        }
      }
    },
    summary() {
      const total = lastWorld?.households?.length || 120;
      return {
        served: servedMap.size,
        doubleServes,
        missed: Math.max(0, total - servedMap.size),
        stockWasted,
        timeToAgree: 0,
      };
    },
  };
}

/**
 * Create a simulation instance.
 */
export async function createSimulation(config = {}) {
  const seed = config.seed ?? 42;
  const w = config.w ?? 48;
  const h = config.h ?? 32;
  const householdCount = config.householdCount ?? 120;
  const vanCount = config.vanCount ?? 6;
  const initialMode = config.mode ?? 'safe';
  const useWorkers = config.useWorkers ?? (typeof Worker !== 'undefined');
  const onTick = config.onTick || (() => {});
  const onEvent = config.onEvent || (() => {});

  // Try importing external modules if available, else use fallback mocks
  let makeWorldFn = makeFallbackWorld;
  let makeRadioFn = makeFallbackRadio;
  let makeMetricsFn = makeFallbackMetrics;

  try {
    const worldMod = await import('./world.js');
    if (worldMod?.makeWorld) makeWorldFn = worldMod.makeWorld;
  } catch (_) {}

  try {
    const radioMod = await import('./radio.js');
    if (radioMod?.makeRadio) makeRadioFn = radioMod.makeRadio;
  } catch (_) {}

  try {
    const metricsMod = await import('./metrics.js');
    if (metricsMod?.makeMetrics) makeMetricsFn = metricsMod.makeMetrics;
  } catch (_) {}

  const world = makeWorldFn(seed, { w, h, households: householdCount, vans: vanCount });
  for (const h of world.households) {
    if (h.needsAidInitial === undefined) {
      h.needsAidInitial = (h.needsAid !== false);
    }
  }
  const radio = makeRadioFn({ range: 8, loss: 0.0, delay: 0, rng: world.rng });
  const metrics = makeMetricsFn();

  const vanIds = world.vans.map(v => v.id);
  const workers = [];
  const syncStates = [];

  // Setup workers or synchronous states
  if (useWorkers && typeof Worker !== 'undefined') {
    for (const v of world.vans) {
      const worker = new Worker(new URL('./van_worker.js', import.meta.url), { type: 'module' });
      worker.postMessage({
        type: 'init',
        vanId: v.id,
        allVanIds: vanIds,
        basePos: world.base,
      });
      workers.push(worker);
    }
  } else {
    for (const v of world.vans) {
      syncStates.push(initVanState({
        vanId: v.id,
        allVanIds: vanIds,
        basePos: world.base,
      }));
    }
  }

  let currentTick = 0;
  let currentMode = initialMode;
  let isRunning = false;
  let timerId = null;
  let tickIntervalMs = config.tickIntervalMs || 100;

  /**
   * Execute one lockstep tick (F4).
   */
  async function step() {
    currentTick++;
    const t = currentTick;
    const events = [];

    // 1. Deliver radio messages for tick t
    const delivered = radio.deliver(t);
    const inboxByVan = {};
    for (const v of world.vans) {
      inboxByVan[v.id] = [];
    }
    for (const d of delivered) {
      if (inboxByVan[d.to]) {
        inboxByVan[d.to].push(d);
      }
    }

    // 2. Gather percepts for all vans
    // Households in the world need aid initially; vans only learn a house was served
    // via their own actions or gossip (percept honesty / no global state leak).
    const seenHouseholds = world.households.map(h => ({
      id: h.id,
      x: h.x,
      y: h.y,
      needsAid: h.needsAidInitial ?? h.needsAid ?? true,
      sos: h.sos,
    }));

    const stepPromises = world.vans.map((v, i) => {
      const distToBase = Math.abs(v.x - world.base.x) + Math.abs(v.y - world.base.y);
      const nearBase = (distToBase <= 1);

      const percept = {
        t,
        pos: { x: v.x, y: v.y },
        stock: v.stock,
        seenHouseholds,
        inbox: inboxByVan[v.id] || [],
        nearBase,
        mode: currentMode,
        vanId: v.id,
        allVanIds: vanIds,
        basePos: world.base,
      };

      if (useWorkers && workers[i]) {
        return new Promise((resolve) => {
          const w = workers[i];
          const handler = (e) => {
            if (e.data.type === 'step_done' && e.data.vanId === v.id) {
              w.removeEventListener('message', handler);
              resolve({ vanId: v.id, action: e.data.action, summary: e.data.summary });
            }
          };
          w.addEventListener('message', handler);
          w.postMessage({ type: 'step', percept });
        });
      } else {
        const res = stepVan(syncStates[i], percept);
        syncStates[i] = res.state;
        return Promise.resolve({ vanId: v.id, action: res.action, summary: null });
      }
    });

    // 3. Wait for all vans in lockstep (F4)
    const responses = await Promise.all(stepPromises);

    // 4. Sort responses deterministically by vanId
    responses.sort((a, b) => a.vanId.localeCompare(b.vanId));

    // 5. Apply actions in deterministic order
    for (const resp of responses) {
      const v = world.vans.find(van => van.id === resp.vanId);
      if (!v) continue;
      const action = resp.action;
      if (!action) continue;

      // Restock if near base
      const distToBase = Math.abs(v.x - world.base.x) + Math.abs(v.y - world.base.y);
      if (distToBase <= 1 && v.stock < 15) {
        v.stock = 15;
      }

      // Movement
      if (action.moveTo) {
        v.x = Math.max(0, Math.min(world.w - 1, action.moveTo.x));
        v.y = Math.max(0, Math.min(world.h - 1, action.moveTo.y));
      }

      // Serving:
      // Always allow a van with stock to serve an existing household it targets.
      // If the household was already served by another van, this spends stock and counts
      // as a double-serve (the core trade-off demonstrated in Lifeline mode).
      if (action.serve && v.stock > 0) {
        const h = world.households.find(house => house.id === action.serve);
        if (h) {
          h.needsAid = false;
          v.stock--;
          events.push({
            type: 'serve',
            vanId: v.id,
            householdId: h.id,
            t,
          });
          onEvent({ type: 'serve', vanId: v.id, householdId: h.id, t });
        }
      }

      // SOS Pickup
      if (action.pickupSos && action.pickupSos.length > 0) {
        events.push({
          type: 'pickup_sos',
          vanId: v.id,
          sosIds: action.pickupSos,
          t,
        });
      }

      // HQ Batch delivery at base
      if (action.hqBatch && action.hqBatch.length > 0) {
        events.push({
          type: 'hq_batch',
          vanId: v.id,
          batch: action.hqBatch,
          t,
        });
      }

      // Outbox routing through radio
      if (Array.isArray(action.outbox)) {
        for (const env of action.outbox) {
          const targetVan = world.vans.find(van => van.id === env.to);
          const targetPos = targetVan ? { x: targetVan.x, y: targetVan.y } : world.base;
          if (radio.canLink({ x: v.x, y: v.y }, targetPos)) {
            radio.send(v.id, env.to, env.msg);
          }
        }
      }
    }

    // 6. Update metrics
    metrics.update(t, world, events);

    // 7. Notify listeners
    onTick({
      t,
      world,
      radio,
      metrics,
      events,
      mode: currentMode,
      summary: metrics.summary(),
    });

    return { t, events, summary: metrics.summary() };
  }

  function play() {
    if (isRunning) return;
    isRunning = true;
    function loop() {
      if (!isRunning) return;
      step().then(() => {
        if (isRunning) {
          timerId = setTimeout(loop, tickIntervalMs);
        }
      });
    }
    loop();
  }

  function pause() {
    isRunning = false;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function setMode(mode) {
    if (mode === 'safe' || mode === 'lifeline') {
      currentMode = mode;
    }
  }

  function setSpeed(ms) {
    tickIntervalMs = Math.max(10, ms);
  }

  function terminate() {
    pause();
    for (const w of workers) {
      w.terminate();
    }
    workers.length = 0;
  }

  return {
    world,
    radio,
    metrics,
    getTick: () => currentTick,
    getMode: () => currentMode,
    step,
    play,
    pause,
    setMode,
    setSpeed,
    terminate,
  };
}
