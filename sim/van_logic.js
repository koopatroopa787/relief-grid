// sim/van_logic.js
// Owner: Darryll
// Pure function for van decision logic: rendezvous hashing, movement, serving, gossip, and SOS.
// No global state, no Math.random. All deterministic.

export const TIMEOUT = 60; // Ticks of silence before a van is considered timed out in Lifeline mode

/**
 * Deterministic 32-bit FNV-1a hash function.
 * Maps (householdId, vanId) string to an unsigned 32-bit integer.
 */
export function hash(householdId, vanId) {
  const str = `${householdId}:${vanId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Rendezvous (Highest Random Weight) hashing:
 * Returns the van ID from activeVans that maximizes hash(householdId, vanId).
 * In case of ties, breaks tie deterministically by lexicographical order.
 */
export function getOwner(householdId, activeVans) {
  if (!activeVans || activeVans.length === 0) return null;
  let bestVan = null;
  let bestHash = -1;
  for (const vanId of activeVans) {
    const score = hash(householdId, vanId);
    if (score > bestHash || (score === bestHash && (bestVan === null || vanId < bestVan))) {
      bestHash = score;
      bestVan = vanId;
    }
  }
  return bestVan;
}

/**
 * Initialize internal van state.
 */
export function initVanState({ vanId = 'V0', allVanIds = ['V0'], basePos = { x: 0, y: 0 } } = {}) {
  const heartbeats = {};
  for (const id of allVanIds) {
    heartbeats[id] = 0;
  }
  return {
    vanId,
    allVanIds: [...allVanIds],
    basePos: { ...basePos },
    served: {},               // { [householdId]: tickServed }
    vanHeartbeats: heartbeats, // { [vanId]: lastTickSeen }
    carriedSos: [],           // array of { sos_id, household, lang, audio, text }
    submittedSosIds: {},      // { [sos_id]: true }
    deliveredReplies: {},     // { [sos_id]: true }
    doubleServesCount: 0,
  };
}

/**
 * Manhattan distance between two positions.
 */
function manhattanDist(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Step 1 grid cell closer from `from` to `to`.
 */
function stepTowards(from, to) {
  if (from.x === to.x && from.y === to.y) {
    return { x: from.x, y: from.y };
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Move along the axis with the larger delta
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: from.x + Math.sign(dx), y: from.y };
  } else {
    return { x: from.x, y: from.y + Math.sign(dy) };
  }
}

/**
 * Pure step function for a van.
 *
 * @param {Object} state - Internal state of the van
 * @param {Object} percept - Current percept from the simulation world
 *   percept = {
 *     t: number,
 *     pos: { x: number, y: number },
 *     stock: number,
 *     seenHouseholds: Array<{ id: string, x: number, y: number, needsAid: boolean, sos?: Object }>,
 *     inbox: Array<{ from: string, to: string, msg: Object }>,
 *     nearBase: boolean,
 *     mode: 'safe' | 'lifeline'
 *   }
 * @returns {{ state: Object, action: Object }}
 */
export function stepVan(state, percept) {
  // If state is not yet initialized, initialize it with sensible defaults from percept
  let s = state;
  if (!s || !s.vanId) {
    const vanId = percept?.vanId || 'V0';
    const allVanIds = percept?.allVanIds || [vanId];
    const basePos = percept?.basePos || { x: 0, y: 0 };
    s = initVanState({ vanId, allVanIds, basePos });
  }

  // Clone state immutably
  const nextState = {
    ...s,
    served: { ...s.served },
    vanHeartbeats: { ...s.vanHeartbeats },
    carriedSos: [...s.carriedSos],
    submittedSosIds: { ...s.submittedSosIds },
    deliveredReplies: { ...s.deliveredReplies },
  };

  // Self is always alive at current tick
  nextState.vanHeartbeats[nextState.vanId] = percept.t;

  // Action skeleton
  const action = {
    moveTo: null,
    serve: null,
    outbox: [],
    pickupSos: [],
    hqBatch: null,
  };

  // 1. Process Inbox: CRDT gossip merge and heartbeat updates
  const inbox = percept.inbox || [];
  for (const envelope of inbox) {
    const msg = envelope.msg;
    if (!msg) continue;

    // Update heartbeat of sender
    if (envelope.from) {
      const prev = nextState.vanHeartbeats[envelope.from] || 0;
      if (percept.t > prev) {
        nextState.vanHeartbeats[envelope.from] = percept.t;
      }
    }

    // Gossip message: merge served sets and heartbeats
    if (msg.type === 'gossip') {
      if (msg.served) {
        for (const [hId, tServed] of Object.entries(msg.served)) {
          if (!nextState.served[hId]) {
            nextState.served[hId] = tServed;
          }
        }
      }
      if (msg.heartbeats) {
        for (const [vId, tSeen] of Object.entries(msg.heartbeats)) {
          const cur = nextState.vanHeartbeats[vId] || 0;
          if (tSeen > cur) {
            nextState.vanHeartbeats[vId] = tSeen;
          }
        }
      }
    }
  }

  // 2. Base operations: SOS delivery to HQ and stock replenishment
  if (percept.nearBase) {
    // If we carry SOS that hasn't been submitted to HQ yet, submit the batch
    if (nextState.carriedSos.length > 0) {
      action.hqBatch = nextState.carriedSos.map(sos => ({ ...sos }));
      for (const sos of nextState.carriedSos) {
        nextState.submittedSosIds[sos.sos_id] = true;
      }
      nextState.carriedSos = [];
    }
  }

  // 3. Determine active vans for rendezvous hashing
  // Safe mode: all known vans remain active (no double serves guaranteed).
  // Lifeline mode: drop vans silent for > TIMEOUT ticks.
  let activeVans;
  if (percept.mode === 'lifeline') {
    activeVans = nextState.allVanIds.filter(vId => {
      if (vId === nextState.vanId) return true;
      const lastSeen = nextState.vanHeartbeats[vId] ?? 0;
      return (percept.t - lastSeen) <= TIMEOUT;
    });
    if (activeVans.length === 0) {
      activeVans = [nextState.vanId];
    }
  } else {
    // Safe mode
    activeVans = [...nextState.allVanIds];
  }

  // 4. Candidate households
  const seenHouseholds = percept.seenHouseholds || [];
  const ownedUnserved = [];

  for (const h of seenHouseholds) {
    // Skip if already recorded as served
    if (nextState.served[h.id]) continue;
    // Skip if world reports no aid needed
    if (h.needsAid === false) continue;

    // Check ownership via rendezvous hashing
    const owner = getOwner(h.id, activeVans);
    if (owner === nextState.vanId) {
      ownedUnserved.push(h);
    }
  }

  // 5. Check if currently at an owned unserved household to serve
  const currentPos = percept.pos;
  const householdAtCurrentPos = ownedUnserved.find(
    h => h.x === currentPos.x && h.y === currentPos.y
  );

  if (householdAtCurrentPos && percept.stock > 0) {
    // Serve this household!
    action.serve = householdAtCurrentPos.id;
    nextState.served[householdAtCurrentPos.id] = percept.t;

    // Pick up SOS if present
    if (householdAtCurrentPos.sos) {
      const sos = householdAtCurrentPos.sos;
      if (!nextState.submittedSosIds[sos.sos_id] && !nextState.carriedSos.some(s => s.sos_id === sos.sos_id)) {
        action.pickupSos.push(sos.sos_id);
        nextState.carriedSos.push({
          sos_id: sos.sos_id,
          household: householdAtCurrentPos.id,
          lang: sos.lang,
          audio: sos.audio,
          text: sos.text || null,
        });
      }
    }

    // Serving takes this tick's primary action
    action.moveTo = null;
  } else {
    // 6. Navigation / Movement
    if (percept.stock <= 0) {
      // Out of stock: return to base
      if (!percept.nearBase) {
        action.moveTo = stepTowards(currentPos, nextState.basePos);
      } else {
        action.moveTo = null; // At base waiting for reload
      }
    } else if (ownedUnserved.length > 0) {
      // Find nearest owned unserved household
      let bestDist = Infinity;
      let targetHousehold = null;

      for (const h of ownedUnserved) {
        const d = manhattanDist(currentPos, h);
        if (d < bestDist || (d === bestDist && (!targetHousehold || h.id < targetHousehold.id))) {
          bestDist = d;
          targetHousehold = h;
        }
      }

      if (targetHousehold) {
        action.moveTo = stepTowards(currentPos, targetHousehold);
      }
    } else {
      // All owned households are served or none available
      // Return towards base if not already there
      if (!percept.nearBase && (currentPos.x !== nextState.basePos.x || currentPos.y !== nextState.basePos.y)) {
        action.moveTo = stepTowards(currentPos, nextState.basePos);
      } else {
        action.moveTo = null;
      }
    }
  }

  // 7. Periodic or opportunistic broadcast outbox (Gossip)
  // Vans broadcast gossip every 5 ticks or whenever they have messages
  if (percept.t % 5 === 0) {
    const gossipPayload = {
      type: 'gossip',
      from: nextState.vanId,
      served: nextState.served,
      heartbeats: nextState.vanHeartbeats,
    };
    for (const vId of nextState.allVanIds) {
      if (vId !== nextState.vanId) {
        action.outbox.push({ to: vId, msg: gossipPayload });
      }
    }
  }

  return { state: nextState, action };
}
