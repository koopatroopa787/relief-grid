// sim/metrics.js
// Owner: Darryll (handed over for D3)
// Tracks simulation metrics according to PLAN.md contract:
// makeMetrics() -> { update(t, world, events), summary() -> {served, doubleServes, missed, stockWasted, timeToAgree} }

export function makeMetrics() {
  let doubleServes = 0;
  let stockWasted = 0;
  let lastWorld = null;
  let timeToAgree = 0;
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
            if (t > timeToAgree) timeToAgree = t;
          }
        }
      }
    },
    summary() {
      const totalHouseholds = lastWorld?.households?.length || 0;
      const servedCount = servedMap.size;
      return {
        served: servedCount,
        doubleServes,
        missed: Math.max(0, totalHouseholds - servedCount),
        stockWasted,
        timeToAgree,
      };
    },
  };
}
