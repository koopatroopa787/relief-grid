// sim/van_worker.js
// Owner: Darryll
// Web Worker for an autonomous aid van.
// Pure message-driven interface running stepVan in lockstep with main.js.

import { stepVan, initVanState } from './van_logic.js';

let state = null;

self.onmessage = function (e) {
  const data = e.data;
  if (!data) return;

  if (data.type === 'init') {
    state = initVanState({
      vanId: data.vanId,
      allVanIds: data.allVanIds,
      basePos: data.basePos,
    });
    self.postMessage({ type: 'init_done', vanId: data.vanId });
    return;
  }

  if (data.type === 'step') {
    const percept = data.percept;
    const res = stepVan(state, percept);
    state = res.state;

    self.postMessage({
      type: 'step_done',
      vanId: state.vanId,
      action: res.action,
      summary: {
        servedCount: Object.keys(state.served).length,
        doubleServesCount: state.doubleServesCount,
        carriedSosCount: state.carriedSos.length,
      },
    });
  }
};
