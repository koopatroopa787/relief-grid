// sim/dispatcher.js
// Owner: Darryll
// Central dispatcher baseline: central coordinator assigns deliveries over radio.
// When radio is jammed or lost, vans halt or fail to receive orders.
// Plain JS ES module, deterministic, no Math.random.

/**
 * Manhattan distance helper.
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
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: from.x + Math.sign(dx), y: from.y };
  } else {
    return { x: from.x, y: from.y + Math.sign(dy) };
  }
}

/**
 * Initialize a central dispatcher instance.
 */
export function makeCentralDispatcher({ base = { x: 0, y: 0 }, vanIds = [] } = {}) {
  const assignments = {};
  for (const vId of vanIds) {
    assignments[vId] = null;
  }

  return {
    base: { ...base },
    vanIds: [...vanIds],
    assignments,             // vanId -> householdId | null
    served: {},              // householdId -> tick
    vanStates: {},           // vanId -> { pos, stock, lastSeen }

    /**
     * Step the central dispatcher logic for tick t.
     * Processes radio messages from vans and dispatches tasks to idle vans.
     *
     * @param {number} t - Current tick
     * @param {Object} radio - The simulation radio instance ({ send, canLink })
     * @param {Array} inbox - Messages addressed to 'base'
     * @param {Array} households - Current household list from world
     * @param {Array} vans - Current van list from world
     */
    step(t, radio, inbox = [], households = [], vans = []) {
      // 1. Process reports from vans
      for (const env of inbox) {
        const msg = env.msg;
        if (!msg) continue;

        if (msg.type === 'served' && msg.householdId) {
          this.served[msg.householdId] = t;
          if (msg.vanId) {
            this.assignments[msg.vanId] = null;
          }
        } else if (msg.type === 'request_assignment' && msg.vanId) {
          this.vanStates[msg.vanId] = {
            pos: msg.pos,
            stock: msg.stock,
            lastSeen: t,
          };
          // If the van asks for work, re-send pending assignment if still valid (order was dropped in transit)
          const assignedId = this.assignments[msg.vanId];
          if (assignedId) {
            const targetH = households.find(h => h.id === assignedId);
            if (targetH && !this.served[assignedId] && targetH.needsAid !== false) {
              if (radio && typeof radio.send === 'function') {
                radio.send('base', msg.vanId, {
                  type: 'assign',
                  household: {
                    id: targetH.id,
                    x: targetH.x,
                    y: targetH.y,
                  },
                });
              }
            } else {
              this.assignments[msg.vanId] = null;
            }
          }
        }
      }

      // Update van positions from world if available
      for (const v of vans) {
        if (!this.vanStates[v.id]) {
          this.vanStates[v.id] = { pos: { x: v.x, y: v.y }, stock: v.stock, lastSeen: t };
        } else {
          this.vanStates[v.id].pos = { x: v.x, y: v.y };
          this.vanStates[v.id].stock = v.stock;
        }
      }

      // 2. Identify unserved, unassigned households
      const assignedHouseholdIds = new Set(Object.values(this.assignments).filter(Boolean));
      const unserved = households.filter(h => !this.served[h.id] && h.needsAid !== false && !assignedHouseholdIds.has(h.id));

      // 3. For each van without an active assignment, assign the closest unserved household
      for (const v of vans) {
        if (this.assignments[v.id]) continue; // Already has an assignment
        if (v.stock <= 0) continue;          // Cannot deliver without stock
        if (unserved.length === 0) break;

        const vanPos = this.vanStates[v.id]?.pos || { x: v.x, y: v.y };

        // Find closest unserved household
        let bestDist = Infinity;
        let bestIdx = -1;
        for (let i = 0; i < unserved.length; i++) {
          const d = manhattanDist(vanPos, unserved[i]);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }

        if (bestIdx >= 0) {
          const targetHousehold = unserved[bestIdx];
          unserved.splice(bestIdx, 1);
          this.assignments[v.id] = targetHousehold.id;

          // Attempt to send assignment over radio
          if (radio && typeof radio.send === 'function') {
            radio.send('base', v.id, {
              type: 'assign',
              household: {
                id: targetHousehold.id,
                x: targetHousehold.x,
                y: targetHousehold.y,
              },
            });
          }
        }
      }
    },
  };
}

/**
 * Pure step function for a van operating under the central dispatcher baseline.
 * If comms with base are down or jammed, the van receives no orders and halts.
 *
 * @param {Object} state - Internal state of the baseline van
 * @param {Object} percept - Percept matching the same interface as stepVan
 * @returns {{ state: Object, action: Object }}
 */
export function stepDispatcherVan(state, percept) {
  let s = state;
  if (!s || !s.vanId) {
    s = {
      vanId: percept?.vanId || 'V0',
      basePos: percept?.basePos || { x: 0, y: 0 },
      currentAssignment: null, // { id, x, y }
      served: {},
    };
  }

  const nextState = {
    ...s,
    served: { ...s.served },
    currentAssignment: s.currentAssignment ? { ...s.currentAssignment } : null,
  };

  const action = {
    moveTo: null,
    serve: null,
    outbox: [],
    pickupSos: [],
    hqBatch: null,
  };

  // 1. Process inbox from dispatcher at base
  const inbox = percept.inbox || [];
  for (const env of inbox) {
    const msg = env.msg;
    if (!msg) continue;
    if (msg.type === 'assign' && msg.household) {
      nextState.currentAssignment = { ...msg.household };
    }
  }

  // 2. Action based on assignment
  if (percept.stock <= 0) {
    // Need reload: move to base
    if (!percept.nearBase) {
      action.moveTo = stepTowards(percept.pos, nextState.basePos);
    } else {
      action.moveTo = null;
    }
    nextState.currentAssignment = null;
  } else if (nextState.currentAssignment) {
    const target = nextState.currentAssignment;
    // Check if arrived at target
    if (percept.pos.x === target.x && percept.pos.y === target.y) {
      action.serve = target.id;
      nextState.served[target.id] = percept.t;
      // Report delivery back to central dispatcher
      action.outbox.push({
        to: 'base',
        msg: {
          type: 'served',
          householdId: target.id,
          vanId: nextState.vanId,
        },
      });
      nextState.currentAssignment = null;
      action.moveTo = null;
    } else {
      // Move towards target
      action.moveTo = stepTowards(percept.pos, target);
    }
  } else {
    // No assignment: van is idle waiting for central dispatcher
    // Periodically send request to base
    if (percept.t % 2 === 0) {
      action.outbox.push({
        to: 'base',
        msg: {
          type: 'request_assignment',
          vanId: nextState.vanId,
          pos: percept.pos,
          stock: percept.stock,
        },
      });
    }
    // HALT: central dispatcher van cannot move without orders
    action.moveTo = null;
  }

  return { state: nextState, action };
}
