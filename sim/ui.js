// U1 · the console. Draws both boards from sim.snapshot() and drives the controls.
// It only watches the sim: nothing here feeds state back into a van.
// Real sim by default (live_sim.js wraps Darryll's main.js + dispatcher.js). ?mock runs the single-thread stand-in.
const { createSim } = await import(new URLSearchParams(location.search).has('mock') ? './mock_sim.js' : './live_sim.js');

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SEED = 7;
const BRUSH = 2; // jam brush radius, in cells
const still = matchMedia('(prefers-reduced-motion: reduce)');
const BASE_TPS = 6; // ticks per second at 1× speed

// ── Split-flap numerals ─────────────────────────────────────────
function flap(el) {
  const n = +el.dataset.digits;
  el.innerHTML = `<b>${el.dataset.pad || '0'}</b>`.repeat(n);
  const cells = [...el.children];
  let last = '';
  return (value) => {
    const s = String(Math.max(0, value | 0)).padStart(n, el.dataset.pad || '0').slice(-n);
    if (s === last) return;
    cells.forEach((c, i) => {
      if (s[i] === last[i]) return;
      c.textContent = s[i];
      c.classList.remove('turn');
      void c.offsetWidth; // restart the flip
      c.classList.add('turn');
    });
    last = s;
  };
}
const flaps = Object.fromEntries(['flapT', 'oServed', 'oDouble', 'oIdle', 'dServed', 'dDouble', 'dIdle'].map((id) => [id, flap($(id))]));

// ── Map rendering: an isometric relief model, drawn like an ink plan on paper ─────
// Land is terraced by height, the flood is a flat sheet below it, homes and vans are small extruded blocks.
// ponytail: plain painter's order (row by row) is enough for a grid this size; no depth buffer.
let colors;
function readColors() {
  colors = Object.fromEntries(['paper', 'paper-2', 'paper-3', 'ink', 'ink-2', 'ink-3', 'rule', 'rule-2', 'signal', 'signal-lo', 'twice',
    'land', 'road', 'water', 'bldg', 'bldg-top', 'roof', 'slab', 'shade'].map((k) => [k, css('--' + k)]));
}

const STEPS = 4;      // gentle hills: terrace levels above the flood
const HEAD = STEPS + 8; // headroom above the ground for the tallest buildings
const FLOOR = 1.15;   // one storey, in levels
const SLAB = 2.2;     // depth of the model's base, in levels

function makeBoard(canvas, sideKey) {
  const ctx = canvas.getContext('2d');
  let terrain = null, sizeKey = '', P = null, lvl = null, hatch = null, hover = null, born = 0;
  const tmp = document.createElement('canvas');

  // Grid corner (x, y) at level z -> canvas pixels.
  const iso = (x, y, z) => [P.ox + (x - y) * P.tw / 2, P.oy + (x + y) * P.th / 2 - z * P.zs];

  function resize(world) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const key = `${cw}x${ch}@${dpr}`;
    if (key === sizeKey) return;
    sizeKey = key;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const W = canvas.width, H = canvas.height, n = world.w + world.h, pad = W * 0.05;
    const tw = Math.min((W - 2 * pad) / (n / 2), (H - 2 * pad) / (n / 4 + 0.3 * (HEAD + SLAB)));
    const zs = tw * 0.3;
    const mapW = (n * tw) / 2, mapH = (n * tw) / 4 + zs * (HEAD + SLAB);
    P = { tw, th: tw / 2, zs, dpr, ox: (W - mapW) / 2 + (world.h * tw) / 2, oy: (H - mapH) / 2 + zs * HEAD };
    lvl = new Float32Array(world.w * world.h);
    for (let k = 0; k < lvl.length; k++) lvl[k] = world.water[k] ? 0 : 1 + Math.min(STEPS - 1, Math.floor((world.height[k] - 0.45) / 0.11));
    terrain = drawTerrain(world);
    hatch = jamPattern();
  }

  const poly = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  // Faces are shaded with a wash of ink (positive) or paper white (negative), like a tinted print.
  function shadeFill(g, pts, color, dark) {
    poly(g, pts); g.fillStyle = color; g.fill();
    if (!dark) return;
    g.globalAlpha = dark > 0 ? dark * 0.6 : -dark;
    g.fillStyle = dark > 0 ? colors.ink : colors['paper-3']; g.fill();
    g.globalAlpha = 1;
  }
  // Ring that grows and fades once every `period` ms: a lantern or a live tower, without any glow.
  function ping(x, y, r, color, now, period = 1400) {
    const k = (now % period) / period;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, P.dpr); ctx.globalAlpha = 1 - k;
    ctx.beginPath(); ctx.arc(x, y, r * (1 + k * 2.4), 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawTerrain(world) {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const g = off.getContext('2d');
    const { w, h } = world;
    const L = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -SLAB : lvl[y * w + x]);

    // Soft contact shadow under the whole model.
    g.save();
    g.shadowColor = colors.shade; g.shadowBlur = P.tw * 2.5; g.shadowOffsetY = P.tw;
    poly(g, [iso(0, 0, -SLAB), iso(w, 0, -SLAB), iso(w, h, -SLAB), iso(0, h, -SLAB)]);
    g.fillStyle = colors.slab; g.fill();
    g.restore();

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x, z = lvl[k], wet = world.water[k];
      const base = wet ? colors.water : world.road?.[k] ? colors.road : colors.land;
      // Right face (towards +x) and left face (towards +y), only where the neighbour is lower.
      const zr = L(x + 1, y), zl = L(x, y + 1);
      if (zr < z) shadeFill(g, [iso(x + 1, y, z), iso(x + 1, y + 1, z), iso(x + 1, y + 1, zr), iso(x + 1, y, zr)], base, wet ? 0.5 : 0.42);
      if (zl < z) shadeFill(g, [iso(x, y + 1, z), iso(x + 1, y + 1, z), iso(x + 1, y + 1, zl), iso(x, y + 1, zl)], base, wet ? 0.35 : 0.24);
      // Top: land lightens with height (hypsometric tint), water darkens with depth.
      const lift = wet ? Math.min(0.55, (0.45 - world.height[k]) * 1.5) : world.road?.[k] ? 0 : -(0.02 + z * 0.03);
      shadeFill(g, [iso(x, y, z), iso(x + 1, y, z), iso(x + 1, y + 1, z), iso(x, y + 1, z)], base, lift);
    }

    // Contour ink: a hairline wherever the level changes, like a printed relief map.
    g.lineWidth = Math.max(1, P.dpr * 0.75);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x, z = lvl[k];
      for (const [nx, ny, a, b] of [[x + 1, y, [x + 1, y], [x + 1, y + 1]], [x, y + 1, [x, y + 1], [x + 1, y + 1]]]) {
        if (nx >= w || ny >= h || L(nx, ny) === z) continue;
        const shore = !!world.water[k] !== !!world.water[ny * w + nx];
        g.strokeStyle = colors.ink;
        g.globalAlpha = shore ? 0.6 : 0.16;
        g.beginPath(); g.moveTo(...iso(...a, z)); g.lineTo(...iso(...b, z)); g.stroke();
      }
    }
    // Lane markings down the middle of each street; under the flood they show faintly, submerged.
    if (world.road && P.tw >= 8) {
      g.lineWidth = Math.max(1, P.dpr * 0.8);
      const R = (x, y) => x >= 0 && y >= 0 && x < w && y < h && world.road[y * w + x];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!R(x, y)) continue;
        const k = y * w + x, z = lvl[k], alongX = R(x - 1, y) || R(x + 1, y), alongY = R(x, y - 1) || R(x, y + 1);
        if (alongX === alongY) continue; // junction
        g.strokeStyle = world.water[k] ? colors['paper-3'] : colors.ink;
        g.globalAlpha = world.water[k] ? 0.4 : 0.3;
        g.beginPath();
        if (alongX) { g.moveTo(...iso(x + 0.25, y + 0.5, z)); g.lineTo(...iso(x + 0.75, y + 0.5, z)); }
        else { g.moveTo(...iso(x + 0.5, y + 0.25, z)); g.lineTo(...iso(x + 0.5, y + 0.75, z)); }
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    return off;
  }

  // A building: walls, a roof, and a few inked windows (deterministic, so the city does not flicker).
  function tower(world, p, half, floors, wall, roof, line) {
    const top = block(world, p, half, floors * FLOOR, roof, wall, line);
    if (P.tw < 9) return top;
    const z0 = zAt(world, p.x, p.y), cx = p.x + 0.5, cy = p.y + 0.5, ww = P.tw * 0.1, wh = P.zs * 0.45;
    ctx.fillStyle = colors.ink; ctx.globalAlpha = 0.45;
    for (let f = 0; f < floors; f++) for (const face of [0, 1]) {
      if ((p.x * 7 + p.y * 13 + f * 5 + face * 3) % 7 > 1) continue;
      const [x, y] = face ? iso(cx, cy + half, z0 + (f + 0.5) * FLOOR) : iso(cx + half, cy, z0 + (f + 0.5) * FLOOR);
      ctx.fillRect(x - ww / 2, y - wh / 2, ww, wh);
    }
    ctx.globalAlpha = 1;
    return top;
  }

  const zAt = (world, x, y) => lvl[Math.max(0, Math.min(world.h - 1, y | 0)) * world.w + Math.max(0, Math.min(world.w - 1, x | 0))];
  // Centre of cell (x, y) standing on the terrain, raised by dz levels.
  const at = (world, p, dz = 0) => iso(p.x + 0.5, p.y + 0.5, zAt(world, p.x, p.y) + dz);

  // A small extruded block centred on a cell: sides first, then the top, outlined in ink. Returns the top centre.
  // `dark` scales the ink on the sides: vans use less, so vermilion stays vermilion instead of going maroon.
  function block(world, p, half, height, color, edge, line = 0.35, dark = 1) {
    const z0 = zAt(world, p.x, p.y), z1 = z0 + height, cx = p.x + 0.5, cy = p.y + 0.5;
    const a = [cx - half, cy - half], b = [cx + half, cy - half], c = [cx + half, cy + half], d = [cx - half, cy + half];
    shadeFill(ctx, [iso(...b, z1), iso(...c, z1), iso(...c, z0), iso(...b, z0)], edge || color, 0.45 * dark);
    shadeFill(ctx, [iso(...d, z1), iso(...c, z1), iso(...c, z0), iso(...d, z0)], edge || color, 0.22 * dark);
    shadeFill(ctx, [iso(...a, z1), iso(...b, z1), iso(...c, z1), iso(...d, z1)], color, 0);
    ctx.strokeStyle = colors.ink; ctx.globalAlpha = line; ctx.lineWidth = Math.max(1, P.dpr * 0.7);
    ctx.stroke(); ctx.globalAlpha = 1;
    return iso(cx, cy, z1);
  }

  function jamPattern() {
    const p = document.createElement('canvas');
    const s = Math.round(6 * P.dpr);
    p.width = p.height = s;
    const g = p.getContext('2d');
    g.strokeStyle = colors.signal; g.lineWidth = 1.2 * P.dpr;
    g.beginPath(); g.moveTo(0, s); g.lineTo(s, 0); g.stroke();
    return ctx.createPattern(p, 'repeat');
  }

  function draw(sim, snap, now = performance.now()) {
    const { world, radio } = sim;
    resize(world);
    if (!canvas.width || !canvas.height) return; // not laid out yet; drawImage of a 0-size canvas throws and would kill the frame loop
    const side = snap[sideKey];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(terrain, 0, 0);

    // Van intentions: a dotted line on the ground to the chosen home.
    ctx.lineWidth = Math.max(1, P.dpr); ctx.strokeStyle = colors.signal; ctx.globalAlpha = 0.7;
    ctx.setLineDash([2 * P.dpr, 3 * P.dpr]);
    ctx.beginPath();
    for (const v of side.vans) if (v.target) { ctx.moveTo(...at(world, v, 0.1)); ctx.lineTo(...at(world, v.target, 0.1)); }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;

    // Everything that stands on the model, drawn back to front.
    const things = [];
    const sosHomes = sideKey === 'ours' ? new Set(snap.sos.filter((s) => s.state === 'waiting').map((s) => s.household)) : new Set();
    world.households.forEach((h, i) => things.push({ d: h.x + h.y, kind: 'home', h, st: side.state[i] }));
    for (const b of world.buildings || []) things.push({ d: b.x + b.y, kind: 'bldg', b });
    things.push({ d: world.base.x + world.base.y + 0.25, kind: 'base' });
    things.sort((a, b) => a.d - b.d);

    const tops = new Map();
    for (const t of things) {
      if (t.kind === 'home') {
        // Waiting homes are white roofs with a crisp outline; served ones are inked in.
        const col = t.st === 0 ? colors.roof : t.st === 1 ? colors.ink : colors.twice;
        const [x, y] = tower(world, t.h, 0.4, t.h.floors || 1, colors.bldg, col, t.st === 0 ? 0.9 : 0.5);
        if (sosHomes.has(t.h.id)) {
          // A lantern on a pole: this home has a voice SOS waiting.
          const up = P.zs * 3.2, r = Math.max(2, P.tw * 0.18);
          ctx.strokeStyle = colors.ink; ctx.lineWidth = Math.max(1, P.dpr * 0.9);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - up); ctx.stroke();
          ping(x, y - up, r, colors.signal, now);
          ctx.fillStyle = colors.signal; ctx.beginPath(); ctx.arc(x, y - up, r, 0, 7); ctx.fill();
        }
      } else if (t.kind === 'base') {
        // The depot, with a mast. On the dispatcher board the mast lamp is the tower: inked in while it reaches a van.
        const [x, y] = block(world, world.base, 0.46, 1.6, colors['paper-3'], colors.slab, 0.9);
        const up = P.zs * 9, r = Math.max(2.5, P.tw * 0.22), dispatcher = sideKey === 'dispatcher', live = dispatcher && side.links.length > 0;
        ctx.strokeStyle = colors.ink; ctx.lineWidth = Math.max(1.2, P.dpr);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - up); ctx.stroke();
        if (live) ping(x, y - up, r, colors.ink, now, 1800);
        ctx.fillStyle = dispatcher && !live ? colors['paper-3'] : colors.ink;
        ctx.strokeStyle = dispatcher && !live ? colors['signal-lo'] : colors.ink;
        ctx.beginPath(); ctx.arc(x, y - up, r, 0, 7); ctx.fill(); ctx.stroke();
      } else {
        tower(world, t.b, 0.42, t.b.floors, colors.bldg, colors['bldg-top'], 0.28);
      }
    }

    // Jamming: a vermilion wash and hatching over the city, like a restricted zone on a plan.
    // Laid over the buildings (one path, one fill) so a dense block can't hide it.
    if (radio.blackout || radio.jammed.some(Boolean)) {
      ctx.beginPath();
      for (let k = 0; k < radio.jammed.length; k++) {
        if (!radio.blackout && !radio.jammed[k]) continue;
        const x = k % world.w, y = (k / world.w) | 0, z = lvl[k] + 0.05;
        [iso(x, y, z), iso(x + 1, y, z), iso(x + 1, y + 1, z), iso(x, y + 1, z)].forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
      }
      ctx.fillStyle = colors.signal; ctx.globalAlpha = 0.16; ctx.fill('nonzero');
      ctx.fillStyle = hatch; ctx.globalAlpha = 0.7; ctx.fill('nonzero');
      ctx.globalAlpha = 1;
    }

    // Vans last, so a tall block never hides one during the demo. A stalled van is drawn hollow.
    for (const v of side.vans) {
      const idle = v.idle && v.stock > 0;
      tops.set(v.id, block(world, v, 0.42, 2.4, idle ? colors['paper-3'] : colors.signal, colors.signal, 0.8, 0.35));
    }

    // Radio: arcs through the air between whoever can hear each other; the dashes travel.
    ctx.strokeStyle = sideKey === 'ours' ? colors.ink : colors['ink-3']; ctx.globalAlpha = 0.8;
    ctx.lineWidth = Math.max(1, P.dpr * 1.1); ctx.setLineDash([3 * P.dpr, 3 * P.dpr]);
    ctx.lineDashOffset = -now / 60;
    ctx.beginPath();
    for (const [ax, ay, bx, by] of side.links) {
      const a = at(world, { x: ax, y: ay }, 1.8), b = at(world, { x: bx, y: by }, sideKey === 'ours' ? 1.8 : 7.6);
      const lift = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.28;
      ctx.moveTo(...a); ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - lift, ...b);
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;

    // Brush footprint under the pointer: the exact cells a click will jam (radio.jam uses a radius-2 disc).
    if (hover) {
      const z = zAt(world, hover.x, hover.y) + 0.05, R = BRUSH + 0.5;
      const col = tool === 'jam' ? colors.signal : colors.ink;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * Math.PI * 2, [px, py] = iso(hover.x + 0.5 + R * Math.cos(t), hover.y + 0.5 + R * Math.sin(t), z);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.fillStyle = col; ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = colors['paper-3']; ctx.lineWidth = 4 * P.dpr; ctx.stroke(); // halo keeps it legible over dense blocks
      ctx.strokeStyle = col; ctx.lineWidth = 2 * P.dpr; ctx.setLineDash([5 * P.dpr, 3 * P.dpr]); ctx.stroke(); ctx.setLineDash([]);
    }

    // Van labels last, so nothing covers them.
    ctx.font = `600 ${Math.max(10 * P.dpr, P.tw * 0.75)}px ${css('--font-data')}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = colors.ink;
    ctx.strokeStyle = colors['paper-3']; ctx.lineWidth = 3 * P.dpr; ctx.lineJoin = 'round';
    for (const v of side.vans) { const [x, y] = tops.get(v.id); ctx.strokeText(v.id, x, y - P.zs); ctx.fillText(v.id, x, y - P.zs); }
    pixelate(now);
  }

  // On load and reset the plate resolves from coarse blocks to sharp, in steps, like a print coming up.
  function pixelate(now) {
    if (!born) born = now;
    const k = Math.max(0, (now - born) / 900); // a rAF timestamp can predate `born` set from performance.now()
    if (k >= 1 || still.matches) return;
    const s = [36, 22, 14, 8, 4, 2][Math.floor(k * 6)] * P.dpr;
    tmp.width = Math.ceil(canvas.width / s); tmp.height = Math.ceil(canvas.height / s);
    tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height); ctx.imageSmoothingEnabled = true;
  }

  // Inverse projection: pointer -> grid cell, refined for the terrain height under it.
  function cellAt(e, world) {
    const r = canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * canvas.width, sy = ((e.clientY - r.top) / r.height) * canvas.height;
    let c = { x: 0, y: 0 }, z = 0;
    for (let i = 0; i < 3; i++) {
      const u = (sx - P.ox) / (P.tw / 2), v = (sy - P.oy + z * P.zs) / (P.th / 2);
      c = { x: Math.floor((u + v) / 2), y: Math.floor((v - u) / 2) };
      z = zAt(world, c.x, c.y);
    }
    return c;
  }

  // Grid cell -> page coordinates (centre of the cell on the terrain). Used by the scripted demo recording.
  function cellToClient(world, x, y) {
    const r = canvas.getBoundingClientRect(), [px, py] = at(world, { x, y });
    return [r.left + (px / canvas.width) * r.width, r.top + (py / canvas.height) * r.height];
  }

  return { draw, cellAt, cellToClient, invalidate() { sizeKey = ''; }, setHover(c) { hover = c; }, reveal() { born = 0; } };
}

// ── Trend chart: served over time, both systems, same scale ─────
const history = [];
function drawTrend(total) {
  const c = $('trend'), ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 40 * dpr, r: 48 * dpr, t: 8 * dpr, b: 20 * dpr };
  const span = Math.max(200, history.length);
  const X = (i) => pad.l + (i / span) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - (v / total) * (H - pad.t - pad.b);
  ctx.font = `500 ${11 * dpr}px ${css('--font-data')}`;
  ctx.fillStyle = colors['ink-3']; ctx.strokeStyle = colors['rule-2']; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of [0, total / 2, total]) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(W - pad.r, Y(v)); ctx.stroke();
    ctx.fillText(String(v), pad.l - 8 * dpr, Y(v));
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`tick ${history.length}`, pad.l, H - pad.b + 6 * dpr);
  const line = (key, color, dash) => {
    if (!history.length) return;
    ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr; ctx.setLineDash(dash.map((d) => d * dpr));
    ctx.beginPath();
    history.forEach((h, i) => (i ? ctx.lineTo(X(i), Y(h[key])) : ctx.moveTo(X(i), Y(h[key]))));
    ctx.stroke(); ctx.setLineDash([]);
    const last = history[history.length - 1][key];
    ctx.fillStyle = color; ctx.textBaseline = 'middle';
    ctx.fillText(String(last), X(history.length - 1) + 8 * dpr, Y(last));
  };
  line('d', colors['ink-3'], [5, 4]);
  line('o', colors.ink, []);
  if (history.some((h) => h.x > 0)) line('x', colors.twice, []);
}

// ── State and controls ──────────────────────────────────────────
let sim, running = false, busy = false, speed = 2, tool = 'jam', acc = 0, lastFrame = 0, sosKey = '';
const boards = [makeBoard($('mapOurs'), 'ours'), makeBoard($('mapDisp'), 'dispatcher')];

async function newSim() {
  sim?.terminate?.();
  sim = await createSim({ seed: SEED, mode: currentMode(), loss: +$('loss').value / 100 });
  sim.setHqOnline($('hqSwitch').getAttribute('aria-checked') === 'true');
  sosKey = '';
  history.length = 0;
  $('btnBlackout').setAttribute('aria-pressed', 'false');
  $('btnBlackout').querySelector('span').textContent = 'Blackout';
  $('seedLabel').textContent = `seed ${SEED}`;
  boards.forEach((b) => b.reveal());
  render();
}

const currentMode = () => ($('modeLife').getAttribute('aria-checked') === 'true' ? 'lifeline' : 'safe');

function setRunning(on) {
  running = on;
  const b = $('btnPlay');
  b.setAttribute('aria-pressed', String(on));
  b.querySelector('use').setAttribute('href', on ? '#i-pause' : '#i-play');
  b.querySelector('span').textContent = on ? 'Pause' : 'Run';
}

function setTool(t) {
  tool = t;
  $('toolJam').setAttribute('aria-checked', String(t === 'jam'));
  $('toolErase').setAttribute('aria-checked', String(t === 'erase'));
}

function setMode(m) {
  $('modeSafe').setAttribute('aria-checked', String(m === 'safe'));
  $('modeLife').setAttribute('aria-checked', String(m === 'lifeline'));
  sim.setMode(m);
  render();
}

const SOS_STATE = { waiting: 'Waiting', carried: 'With', at_hq: 'At HQ', replied: 'Replied' };
function renderSos(snap) {
  const hq = sim.hqStatus?.();
  const key = snap.sos.map((s) => s.state + s.van).join() + snap.hqOnline + (hq ? hq.state + hq.pendingSos : '');
  if (key === sosKey) return;
  sosKey = key;
  const list = $('sosList');
  if (!snap.sos.length) { list.innerHTML = '<li class="empty">No SOS notes in this flood.</li>'; return; }
  list.innerHTML = '';
  for (const s of snap.sos) {
    const li = document.createElement('li');
    const audio = s.reply?.audio_b64 ? `data:${s.reply.mime || 'audio/mpeg'};base64,${s.reply.audio_b64}` : s.reply?.audio_url || s.audio;
    const label = s.state === 'carried' ? `With ${s.van}` : s.state === 'at_hq' && (!snap.hqOnline || hq?.state === 'down') ? 'Queued' : SOS_STATE[s.state];
    li.innerHTML = `
      <button class="btn play" ${audio ? '' : 'disabled'} title="${audio ? 'Play voice note' : 'Voice arrives from HQ'}" aria-label="Play voice note from ${s.household}"><svg><use href="#i-voice"/></svg></button>
      <span><span class="who">${s.household} · ${s.lang.toUpperCase()}</span><br><span class="line" lang="${s.lang}" dir="auto"></span></span>
      <span class="state" data-s="${s.state}">${label}</span>`;
    li.querySelector('.line').textContent = s.reply?.text || s.text;
    if (audio) li.querySelector('.play').addEventListener('click', () => new Audio(audio).play().catch(() => {}));
    list.append(li);
  }
}

function render() {
  const snap = sim.snapshot();
  boards.forEach((b) => b.draw(sim, snap));
  flaps.flapT(snap.t);
  flaps.oServed(snap.ours.served); flaps.oDouble(snap.ours.doubles); flaps.oIdle(snap.ours.idle);
  flaps.dServed(snap.dispatcher.served); flaps.dDouble(snap.dispatcher.doubles); flaps.dIdle(snap.dispatcher.idle);
  document.querySelectorAll('.board[data-side="ours"] .dbl').forEach((el) => el.classList.toggle('hot', snap.ours.doubles > 0));
  document.querySelectorAll('.board[data-side="dispatcher"] .dbl').forEach((el) => el.classList.toggle('hot', snap.dispatcher.doubles > 0));

  const { radio } = sim;
  const jammedAny = radio.jammed.some(Boolean);
  const rs = $('radioState');
  rs.dataset.state = radio.blackout ? 'dead' : jammedAny || radio.loss > 0 ? 'jam' : 'ok';
  $('radioText').textContent = radio.blackout ? 'Blackout' : jammedAny || radio.loss > 0 ? 'Degraded' : 'Clear';

  $('oursMode').textContent = snap.mode === 'safe' ? 'Safe mode' : 'Lifeline mode';
  const linked = snap.dispatcher.links.length;
  const ds = $('dispState');
  ds.textContent = linked ? `Tower linked · ${linked}/6` : 'Tower cut off';
  ds.className = linked ? 'state' : 'state bad';
  const gap = snap.ours.served - snap.dispatcher.served;
  $('gap').textContent = gap === 0 ? 'Level' : gap > 0 ? `Relief Grid +${gap}` : `Dispatcher +${-gap}`;
  $('sosCount').textContent = snap.sos.length ? `${snap.sos.filter((x) => x.state === 'replied').length}/${snap.sos.length}` : '0';
  renderSos(snap);
  drawTrend(sim.world.households.length);
}

function frame(now) {
  const dt = Math.min(0.25, (now - lastFrame) / 1000 || 0);
  lastFrame = now;
  if (running && sim) {
    acc = Math.min(acc + dt * BASE_TPS * speed, 4);
    if (!busy && acc >= 1) runTicks(Math.floor(acc));
  }
  // Redraw every frame so the lanterns pulse and radio dashes travel, even when paused.
  if (sim) boards.forEach((b) => b.draw(sim, sim.snapshot(), now));
  requestAnimationFrame(frame);
}

// Ticks are async (one Web Worker per van, lockstep), so run them one after another, never overlapping.
async function runTicks(k) {
  busy = true;
  const s0 = sim;
  for (let i = 0; i < k && s0 === sim; i++) {
    await sim.tick(); acc -= 1;
    const s = sim.snapshot();
    history.push({ o: s.ours.served, d: s.dispatcher.served, x: s.ours.doubles });
  }
  busy = false;
  if (s0 === sim) render();
}

// Brush: drag on either map. Both maps share the same airwaves.
boards.forEach((b, i) => {
  const canvas = i ? $('mapDisp') : $('mapOurs');
  let down = false;
  const paint = (e) => {
    const c = b.cellAt(e, sim.world);
    tool === 'jam' ? sim.radio.jam(c.x, c.y, BRUSH) : sim.radio.unjam(c.x, c.y, BRUSH);
    render();
  };
  const onMap = (c) => c.x >= 0 && c.y >= 0 && c.x < sim.world.w && c.y < sim.world.h;
  canvas.addEventListener('pointerdown', (e) => { down = true; canvas.setPointerCapture(e.pointerId); paint(e); });
  canvas.addEventListener('pointermove', (e) => {
    if (!sim) return;
    const c = b.cellAt(e, sim.world);
    b.setHover(e.pointerType === 'mouse' && onMap(c) ? c : null);
    if (down) paint(e);
  });
  canvas.addEventListener('pointerleave', () => b.setHover(null));
  canvas.addEventListener('pointerup', () => { down = false; });
  canvas.addEventListener('pointercancel', () => { down = false; });
});

$('btnPlay').addEventListener('click', () => setRunning(!running));
$('btnReset').addEventListener('click', () => { setRunning(false); acc = 0; newSim(); });
$('toolJam').addEventListener('click', () => setTool('jam'));
$('toolErase').addEventListener('click', () => setTool('erase'));
$('modeSafe').addEventListener('click', () => setMode('safe'));
$('modeLife').addEventListener('click', () => setMode('lifeline'));
$('btnBlackout').addEventListener('click', () => {
  const on = !sim.radio.blackout;
  sim.radio.setBlackout(on);
  if (!on) sim.radio.clearJam();
  $('btnBlackout').setAttribute('aria-pressed', String(on));
  $('btnBlackout').querySelector('span').textContent = on ? 'Restore radio' : 'Blackout';
  render();
});
$('loss').addEventListener('input', (e) => { sim.radio.setLoss(e.target.value / 100); $('lossOut').textContent = `${e.target.value}%`; render(); });
$('speed').addEventListener('input', (e) => { speed = +e.target.value; $('speedOut').textContent = `${speed}×`; });
$('hqSwitch').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
  e.currentTarget.setAttribute('aria-checked', String(on));
  e.currentTarget.querySelector('span').textContent = on ? 'HQ online' : 'HQ offline';
  sim.setHqOnline(on);
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); setRunning(!running); }
  else if (k === 'j') setTool('jam');
  else if (k === 'e') setTool('erase');
  else if (k === 'b') $('btnBlackout').click();
  else if (k === 'r') $('btnReset').click();
});
new ResizeObserver(() => { boards.forEach((b) => b.invalidate()); sim && render(); }).observe($('mapOurs'));

// ── Backdrop: graph-paper dots that ripple slowly, like water under the sheet, and gather round the pointer ──
function backdrop() {
  const c = $('bg'), g = c.getContext('2d'), still = matchMedia('(prefers-reduced-motion: reduce)');
  const GAP = 16;
  let W = 0, H = 0, dpr = 1, px = -1e4, py = -1e4, tx = px, ty = py, last = 0;
  const fit = () => { dpr = Math.min(2, devicePixelRatio || 1); W = c.width = innerWidth * dpr; H = c.height = innerHeight * dpr; };
  addEventListener('resize', fit); fit();
  addEventListener('pointermove', (e) => { tx = e.clientX * dpr; ty = e.clientY * dpr; }, { passive: true });
  const ink = css('--ink');
  function paint(now) {
    requestAnimationFrame(paint);
    if (now - last < 33) return; // ~30 fps is plenty for a backdrop
    last = now;
    const t = still.matches ? 0 : now / 1000, s = GAP * dpr;
    px += (tx - px) * 0.08; py += (ty - py) * 0.08;
    g.clearRect(0, 0, W, H); g.fillStyle = ink;
    for (let y = s / 2; y < H; y += s) for (let x = s / 2; x < W; x += s) {
      const wave = Math.sin(x * 0.006 / dpr + t * 0.6) * Math.cos(y * 0.008 / dpr - t * 0.45);
      const dx = x - px, dy = y - py, d = Math.hypot(dx, dy) / dpr, near = Math.max(0, 1 - d / 240);
      const push = near * near * 7 * dpr / Math.max(1, d * dpr);
      const r = (0.7 + 0.6 * near) * dpr;
      g.globalAlpha = 0.05 + 0.09 * (wave + 1) / 2 + 0.3 * near * near;
      g.fillRect(x + dx * push - r, y + dy * push - r, r * 2, r * 2);
    }
  }
  requestAnimationFrame(paint);
}

// Wordmark letters rise in one by one (CSS does the motion; this only wraps the letters).
const mark = $('mark');
mark.setAttribute('aria-label', mark.textContent);
mark.innerHTML = [...mark.textContent].map((ch, i) => `<span aria-hidden="true" style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');

// Read-only hook for the scripted video (pitch/video/make_video.py): where things are on screen, and the counters.
window.reliefGrid = {
  base: () => ({ ...sim.world.base }),
  toClient: (side, x, y) => boards[side === 'ours' ? 0 : 1].cellToClient(sim.world, x, y),
  snapshot: () => { const s = sim.snapshot(); return { t: s.t, ours: s.ours.served, disp: s.dispatcher.served, doubles: s.ours.doubles }; },
};

readColors();
backdrop();
await newSim();
document.fonts.ready.then(() => render());
requestAnimationFrame(frame);

// ── Intro video: the poster plays the YouTube embed on click (offline it still links to the video). ──
document.querySelector('.frame .poster')?.addEventListener('click', (e) => {
  if (!navigator.onLine) return;
  e.preventDefault();
  const f = document.createElement('iframe');
  f.src = 'https://www.youtube-nocookie.com/embed/gYtxgIP4elE?autoplay=1&rel=0';
  f.title = 'Relief Grid: 2-minute demo';
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  e.currentTarget.replaceWith(f);
});

// ── Intro: sections rise in on scroll; the big figures count up once. ──
{
  document.querySelectorAll('.reveal').forEach((sec) =>
    sec.querySelectorAll('.steps li, .figs > div, .try li, .frame').forEach((el, i) => el.style.setProperty('--n', i)));
  const countUp = (el) => {
    const to = +el.dataset.count, t0 = performance.now(), dur = 1100;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
      el.textContent = (to * e).toFixed(1);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    en.target.classList.add('in');
    if (!still.matches) en.target.querySelectorAll('[data-count]').forEach(countUp);
    io.unobserve(en.target);
  }), { threshold: 0.2 });
  document.querySelectorAll('.reveal').forEach((sec) => io.observe(sec));
}
