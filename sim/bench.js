// sim/bench.js
// Owner: Darryll (handed over for D3)
// Headless 50-seed benchmark runner for Relief Grid.
// Compares Relief Grid (Safe mode), Relief Grid (Lifeline mode), and Central Dispatcher
// across varying communication conditions (clear radio, packet loss, jamming, blackout).
// Runnable via Node.js CLI or inside sim/bench.html.

if (typeof globalThis.location === 'undefined') {
  globalThis.location = new URL('http://localhost:8000/index.html');
}

import { createSim } from './live_sim.js';

export const BENCH_SCENARIOS = [
  {
    id: 'clear',
    name: 'Radio Clear',
    mode: 'safe',
    loss: 0,
    setup: (sim) => {},
    notes: 'Normal conditions; dispatcher base tower reaches all vans.',
  },
  {
    id: 'loss30',
    name: '30% Packet Loss',
    mode: 'safe',
    loss: 0.3,
    setup: (sim) => {
      sim.radio.setLoss(0.3);
    },
    notes: 'Degraded comms; dropped gossip & orders.',
  },
  {
    id: 'jam_base',
    name: 'Base Jammed (r=6)',
    mode: 'safe',
    loss: 0,
    setup: (sim) => {
      sim.radio.jam(sim.world.base.x, sim.world.base.y, 6);
    },
    notes: 'Disaster epicenter jammed; central tower silenced.',
  },
  {
    id: 'blackout',
    name: 'Full Radio Blackout',
    mode: 'safe',
    loss: 0,
    setup: (sim) => {
      sim.radio.setBlackout(true);
    },
    notes: '100% radio partition; zero inter-van messages.',
  },
  {
    id: 'lifeline_jam',
    name: 'Lifeline (Base Jammed)',
    mode: 'lifeline',
    loss: 0,
    setup: (sim) => {
      sim.radio.jam(sim.world.base.x, sim.world.base.y, 6);
    },
    notes: 'Lifeline mode drops silent vans to accelerate coverage.',
  },
];

/**
 * Runs a single simulation run for 300 ticks.
 */
export async function runSingleSeed({ seed, mode = 'safe', loss = 0, setup = () => {} }) {
  const sim = await createSim({ seed, mode, loss, useWorkers: false });
  if (setup) setup(sim);

  for (let t = 0; t < 300; t++) {
    await sim.tick();
  }

  const snap = sim.snapshot();
  sim.terminate();

  return {
    seed,
    ours: {
      served: snap.ours.served,
      doubles: snap.ours.doubles,
      waiting: snap.ours.waiting,
    },
    dispatcher: {
      served: snap.dispatcher.served,
      doubles: snap.dispatcher.doubles,
      waiting: snap.dispatcher.waiting,
    },
  };
}

/**
 * Computes summary statistics over an array of runs.
 */
function summarizeRuns(runs) {
  const n = runs.length;
  const oServed = runs.map((r) => r.ours.served);
  const dServed = runs.map((r) => r.dispatcher.served);
  const oDoubles = runs.map((r) => r.ours.doubles);
  const dDoubles = runs.map((r) => r.dispatcher.doubles);

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const min = (arr) => Math.min(...arr);
  const max = (arr) => Math.max(...arr);

  const oServedMean = sum(oServed) / n;
  const dServedMean = sum(dServed) / n;
  const oDoublesTotal = sum(oDoubles);
  const dDoublesTotal = sum(dDoubles);

  return {
    runs,
    count: n,
    ours: {
      servedMean: oServedMean,
      servedMin: min(oServed),
      servedMax: max(oServed),
      totalDoubles: oDoublesTotal,
      doublesMean: oDoublesTotal / n,
    },
    dispatcher: {
      servedMean: dServedMean,
      servedMin: min(dServed),
      servedMax: max(dServed),
      totalDoubles: dDoublesTotal,
      doublesMean: dDoublesTotal / n,
    },
  };
}

/**
 * Runs the full benchmark across specified seeds and scenarios.
 */
export async function runBenchmark({
  startSeed = 1,
  seedCount = 50,
  scenarios = BENCH_SCENARIOS,
  onProgress = () => {},
} = {}) {
  const results = [];
  const totalSteps = scenarios.length * seedCount;
  let completedSteps = 0;

  for (const scenario of scenarios) {
    const scenarioRuns = [];

    for (let i = 0; i < seedCount; i++) {
      const seed = startSeed + i;
      const runRes = await runSingleSeed({
        seed,
        mode: scenario.mode,
        loss: scenario.loss,
        setup: scenario.setup,
      });
      scenarioRuns.push(runRes);

      completedSteps++;
      onProgress({
        scenario: scenario.name,
        seed,
        completedSteps,
        totalSteps,
        percent: Math.round((completedSteps / totalSteps) * 100),
      });
    }

    const summary = summarizeRuns(scenarioRuns);
    results.push({
      scenario,
      ...summary,
    });
  }

  return results;
}

/**
 * Formats benchmark results into a clean Markdown table.
 */
export function formatMarkdownTable(results) {
  const lines = [];
  lines.push('| Scenario | Relief Grid Served | RG Doubles | Dispatcher Served | Comms Condition |');
  lines.push('|---|:---:|:---:|:---:|---|');

  for (const r of results) {
    const oStr = `${r.ours.servedMean.toFixed(1)} / 120 (${r.ours.servedMin}–${r.ours.servedMax})`;
    const dStr = `${r.dispatcher.servedMean.toFixed(1)} / 120 (${r.dispatcher.servedMin}–${r.dispatcher.servedMax})`;
    const oDbl = r.ours.totalDoubles > 0 ? `${r.ours.totalDoubles} total (${r.ours.doublesMean.toFixed(1)}/run)` : '0';

    lines.push(`| **${r.scenario.name}** | **${oStr}** | ${oDbl} | ${dStr} | ${r.scenario.notes} |`);
  }

  return lines.join('\n');
}

// CLI runner if invoked directly in Node
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('bench.js')) {
  const seedCount = parseInt(process.env.BENCH_SEEDS || '50', 10);
  console.log(`Starting Relief Grid headless benchmark (${seedCount} seeds per scenario)...`);

  const t0 = Date.now();
  runBenchmark({
    startSeed: 1,
    seedCount,
    onProgress: ({ scenario, seed, percent }) => {
      if (seed % 10 === 0 || seed === seedCount) {
        process.stdout.write(`\r[${percent}%] ${scenario} (Seed ${seed}/${seedCount})...`);
      }
    },
  })
    .then((results) => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`\n\nBenchmark completed in ${elapsed}s!\n`);
      console.log(formatMarkdownTable(results));
    })
    .catch((err) => {
      console.error('\nBenchmark failed:', err);
      process.exit(1);
    });
}
