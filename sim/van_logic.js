// sim/van_logic.js
// Owner: Darryll
// Pure function for van decision logic: rendezvous hashing, movement, serving, gossip, SOS, and handover.
// No global state, no Math.random. All deterministic.

export const TIMEOUT = 60; // Ticks of silence before a van is considered timed out in Lifeline mode
export const GOSSIP_INTERVAL = 3; // Broadcast gossip every 3 ticks

/**
 * Deterministic 32-bit FNV-1a hash function.
 * Maps (householdId, vanId) string to an unsigned 32-bit integer.
 */
export function hash(householdId, vanId) {
  let h = 0x811c9dc5;
  for (let i = 0; i < householdId.length; i++) {
    h ^= householdId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= 58; // charCode for ':'
  h = Math.imul(h, 0x01000193);
  for (let i = 0; i < vanId.length; i++) {
    h ^= vanId.charCodeAt(i);
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
 * Effective owner considering CRDT versioned overrides (F3 protocol):
 * If an override exists for the household, the override's owner is effective.
 * Otherwise, rendezvous hash over activeVans decides.
 */
export function getEffectiveOwner(householdId, activeVans, overrides = {}) {
  const ov = overrides[householdId];
  if (ov && ov.owner && (!activeVans || activeVans.includes(ov.owner))) {
    return ov.owner;
  }
  return getOwner(householdId, activeVans);
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
    served: {},               // { [householdId]: { t: number, by: string } | number }
    overrides: {},            // { [householdId]: { owner: string, version: number } } - F3 CRDT overrides
    vanHeartbeats: heartbeats, // { [vanId]: lastTickSeen } - alive list
    peerInfo: {},             // { [vanId]: { pos: {x, y}, stock: number, t: number } }
    carriedSos: [],           // array of { sos_id, household, lang, audio, text }
    submittedSosIds: {},      // { [sos_id]: true } - submitted to HQ
    deliveredReplies: {},     // { [sos_id]: true }
    doubleServes: {},         // { [householdId]: { vanA, vanB, tA, tB } }
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
 * Extract tick number from served entry.
 */
function extractServedTick(entry) {
  if (typeof entry === 'object' && entry !== null) return entry.t;
  return Number(entry) || 0;
}

/**
 * Extract server van ID from served entry.
 */
function extractServedBy(entry) {
  if (typeof entry === 'object' && entry !== null) return entry.by;
  return null;
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
    overrides: { ...s.overrides },
    vanHeartbeats: { ...s.vanHeartbeats },
    peerInfo: { ...s.peerInfo },
    carriedSos: [...s.carriedSos],
    submittedSosIds: { ...s.submittedSosIds },
    deliveredReplies: { ...s.deliveredReplies },
    doubleServes: { ...s.doubleServes },
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

  // 1. Process Inbox: CRDT gossip merge, heartbeats, versioned overrides, and double-serve counting
  const inbox = percept.inbox || [];
  for (const envelope of inbox) {
    const sender = envelope.from;
    const msg = envelope.msg;
    if (!msg) continue;

    // Update heartbeat of sender
    if (sender) {
      const prev = nextState.vanHeartbeats[sender] || 0;
      if (percept.t > prev) {
        nextState.vanHeartbeats[sender] = percept.t;
      }
    }

    // Gossip message: merge served sets, overrides, and heartbeats
    if (msg.type === 'gossip') {
      if (sender && msg.pos) {
        nextState.peerInfo[sender] = {
          pos: { ...msg.pos },
          stock: msg.stock ?? 0,
          t: percept.t,
        };
      }

      // CRDT Union merge of served households + double serve detection
      if (msg.served) {
        for (const [hId, remoteEntry] of Object.entries(msg.served)) {
          const remoteTick = extractServedTick(remoteEntry);
          const remoteBy = extractServedBy(remoteEntry);
          const localEntry = nextState.served[hId];

          if (!localEntry) {
            nextState.served[hId] = remoteEntry;
          } else {
            const localTick = extractServedTick(localEntry);
            const localBy = extractServedBy(localEntry);

            // Double serve detection: both served by different vans
            if (localBy && remoteBy && localBy !== remoteBy) {
              if (!nextState.doubleServes[hId]) {
                nextState.doubleServes[hId] = {
                  vanA: localBy,
                  vanB: remoteBy,
                  tA: localTick,
                  tB: remoteTick,
                };
                nextState.doubleServesCount++;
              }
            }

            // Union merge: keep earliest served entry
            if (remoteTick < localTick) {
              nextState.served[hId] = remoteEntry;
            }
          }
        }
      }

      // Merge CRDT versioned overrides (F3 protocol)
      if (msg.overrides) {
        for (const [hId, remoteOv] of Object.entries(msg.overrides)) {
          const localOv = nextState.overrides[hId];
          if (!localOv ||
              remoteOv.version > localOv.version ||
              (remoteOv.version === localOv.version && remoteOv.owner > localOv.owner)) {
            nextState.overrides[hId] = { ...remoteOv };
          }
        }
      }

      // Merge van heartbeats (alive list)
      if (msg.heartbeats) {
        for (const [vId, tSeen] of Object.entries(msg.heartbeats)) {
          const cur = nextState.vanHeartbeats[vId] || 0;
          if (tSeen > cur) {
            nextState.vanHeartbeats[vId] = tSeen;
          }
        }
      }

      // Store-and-forward SOS gossip (DTN: duplicate carried SOS across vans in range)
      if (Array.isArray(msg.carriedSos)) {
        for (const remoteSos of msg.carriedSos) {
          if (!nextState.submittedSosIds[remoteSos.sos_id] &&
              !nextState.carriedSos.some(s => s.sos_id === remoteSos.sos_id)) {
            nextState.carriedSos.push({ ...remoteSos });
          }
        }
      }
    }
  }

  // 2. Base operations: SOS delivery to HQ
  if (percept.nearBase) {
    if (nextState.carriedSos.length > 0) {
      action.hqBatch = nextState.carriedSos.map(sos => ({ ...sos }));
      for (const sos of nextState.carriedSos) {
        nextState.submittedSosIds[sos.sos_id] = true;
      }
      nextState.carriedSos = [];
    }
  }

  // 3. Determine active vans for rendezvous hashing
  // Safe mode (F2): all known vans in the starting roster remain active. Never double-serve.
  // Lifeline mode (F10): drop vans silent for > TIMEOUT ticks. Count double-serves.
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
  const unservedByOwner = {};

  for (const h of seenHouseholds) {
    // Skip if already served
    if (nextState.served[h.id]) continue;
    // Skip if world reports no aid needed
    if (h.needsAid === false) continue;

    // Check effective owner (considering F3 versioned overrides)
    const owner = getEffectiveOwner(h.id, activeVans, nextState.overrides);
    if (owner) {
      unservedByOwner[owner] = (unservedByOwner[owner] || 0) + 1;
      if (owner === nextState.vanId) {
        ownedUnserved.push(h);
      }
    }
  }

  // Sort candidate households deterministically by distance to this van
  ownedUnserved.sort((a, b) => {
    const da = manhattanDist(percept.pos, a);
    const db = manhattanDist(percept.pos, b);
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  });

  // 5. Handover negotiation (F3: Giver lets go first):
  // When two vans meet or pass in close proximity (<= 6 cells), hand over secondary households
  // if the peer is significantly closer, the giver has surplus work, and peer has stock.
  // Never give away the current primary target, never hand over if workload is already low (<= 2),
  // and cap handover version per household to 1 to prevent endless ping-pong churn.
  if (percept.stock > 0 && ownedUnserved.length >= 3) {
    for (const [peerId, peer] of Object.entries(nextState.peerInfo)) {
      if (peerId === nextState.vanId) continue;
      // Peer must be recent (heard in last 3 ticks) and close (meeting <= 6 cells)
      if (percept.t - peer.t <= 3 && manhattanDist(percept.pos, peer.pos) <= 6) {
        // Unserved households currently owned by peer in our view
        const peerOwnedCount = unservedByOwner[peerId] || 0;

        // Only offload if giver has more work than peer, and peer has stock capacity
        if (ownedUnserved.length > peerOwnedCount && peer.stock > peerOwnedCount) {
          // Never give away our primary destination (ownedUnserved[0])
          for (let i = 1; i < ownedUnserved.length; i++) {
            const h = ownedUnserved[i];
            // Prevent thrashing: do not re-handover a household that was already handed over
            if ((nextState.overrides[h.id]?.version || 0) >= 1) continue;

            const distToMe = manhattanDist(percept.pos, h);
            const distToPeer = manhattanDist(peer.pos, h);

            // Hand over if peer is closer by at least 4 cells
            if (distToPeer + 4 < distToMe) {
              const currentVer = nextState.overrides[h.id]?.version || 0;
              nextState.overrides[h.id] = {
                owner: peerId,
                version: currentVer + 1,
              };

              // Update tallies
              unservedByOwner[peerId] = peerOwnedCount + 1;
              unservedByOwner[nextState.vanId]--;

              // Giver lets go first: remove from our candidate list
              ownedUnserved.splice(i, 1);
              break; // Hand over at most one per peer per tick
            }
          }
        }
      }
    }
  }

  // 6. Check if currently at an owned unserved household to serve
  const currentPos = percept.pos;
  const householdAtCurrentPos = ownedUnserved.find(
    h => h.x === currentPos.x && h.y === currentPos.y
  );

  if (householdAtCurrentPos && percept.stock > 0) {
    // Serve this household!
    action.serve = householdAtCurrentPos.id;
    nextState.served[householdAtCurrentPos.id] = {
      t: percept.t,
      by: nextState.vanId,
    };

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

    action.moveTo = null;
  } else {
    // 7. Navigation / Movement
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

  // 8. Gossip outbox broadcast
  if (percept.t % GOSSIP_INTERVAL === 0) {
    const gossipPayload = {
      type: 'gossip',
      from: nextState.vanId,
      pos: percept.pos,
      stock: percept.stock,
      served: nextState.served,
      overrides: nextState.overrides,
      heartbeats: nextState.vanHeartbeats,
      carriedSos: nextState.carriedSos,
    };
    for (const vId of nextState.allVanIds) {
      if (vId !== nextState.vanId) {
        action.outbox.push({ to: vId, msg: gossipPayload });
      }
    }
  }

  return { state: nextState, action };
}
