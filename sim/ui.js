// U1 · the console. Draws both boards from sim.snapshot() and drives the controls.
// It only watches the sim: nothing here feeds state back into a van.
// Real sim by default (live_sim.js wraps Darryll's main.js + dispatcher.js). ?mock runs the single-thread stand-in.
const { createSim } = await import(new URLSearchParams(location.search).has('mock') ? './mock_sim.js' : './live_sim.js');

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SEED = 7;
const BASE_TPS = 6; // ticks per second at 1× speed

// ── Split-flap numerals ─────────────────────────────────────────
function flap(el) {
  const n = +el.dataset.digits;
  el.innerHTML = '<b>0</b>'.repeat(n);
  const cells = [...el.children];
  let last = '';
  return (value) => {
    const s = String(Math.max(0, value | 0)).padStart(n, '0').slice(-n);
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

// ── Map rendering: an isometric relief model, drawn in 2D canvas ─────
// Land is terraced by height, the flood is a flat sheet below it, homes and vans are small extruded blocks.
// ponytail: plain painter's order (row by row) is enough for a grid this size; no depth buffer.
let colors;
function readColors() {
  colors = Object.fromEntries(['water', 'water-hi', 'land', 'land-hi', 'amber', 'amber-2', 'amber-lo', 'served', 'danger', 'danger-lo',
    'link', 'ink', 'ink-2', 'ink-3', 'night', 'housing', 'shade', 'rule', 'panel-2'].map((k) => [k, css('--' + k)]));
}

const STEPS = 9;      // terrace levels above the flood
const SLAB = 2.2;     // depth of the model's base, in levels

function makeBoard(canvas, sideKey) {
  const ctx = canvas.getContext('2d');
  let terrain = null, sizeKey = '', P = null, lvl = null, hatch = null, glow = null;

  // Grid corner (x, y) at level z -> canvas pixels.
  const iso = (x, y, z) => [P.ox + (x - y) * P.tw / 2, P.oy + (x + y) * P.th / 2 - z * P.zs];

  function resize(world) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const key = `${cw}x${ch}@${dpr}`;
    if (key === sizeKey) return;
    sizeKey = key;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const W = canvas.width, H = canvas.height, n = world.w + world.h, pad = W * 0.03;
    const tw = Math.min((W - 2 * pad) / (n / 2), (H - 2 * pad) / (n / 4 + 0.3 * (STEPS + SLAB + 3)));
    const zs = tw * 0.3;
    const mapW = (n * tw) / 2, mapH = (n * tw) / 4 + zs * (STEPS + SLAB + 3);
    P = { tw, th: tw / 2, zs, dpr, ox: (W - mapW) / 2 + (world.h * tw) / 2, oy: (H - mapH) / 2 + zs * (STEPS + 3) };
    lvl = new Float32Array(world.w * world.h);
    for (let k = 0; k < lvl.length; k++) lvl[k] = world.water[k] ? 0 : 1 + Math.min(STEPS - 1, Math.floor((world.height[k] - 0.42) / 0.065));
    terrain = drawTerrain(world);
    hatch = jamPattern();
    glow = { amber: glowSprite(colors.amber), served: glowSprite(colors.served) };
  }

  // Light pools are pre-drawn sprites: shadowBlur per frame is far too slow on a canvas this size.
  function glowSprite(color) {
    const r = Math.ceil(P.tw * 1.6), g = document.createElement('canvas');
    g.width = g.height = r * 2;
    const x = g.getContext('2d'), grad = x.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, color); grad.addColorStop(1, 'transparent');
    x.globalAlpha = 0.55; x.fillStyle = grad; x.fillRect(0, 0, r * 2, r * 2);
    return g;
  }
  const lightAt = (sprite, x, y, k = 1) => { const r = (sprite.width / 2) * k; ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2); };

  const poly = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  function shadeFill(g, pts, color, dark) {
    poly(g, pts); g.fillStyle = color; g.fill();
    if (dark > 0) { g.fillStyle = `rgb(0 0 0 / ${dark})`; g.fill(); }
    if (dark < 0) { g.fillStyle = `rgb(255 255 255 / ${-dark})`; g.fill(); }
  }

  function drawTerrain(world) {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const g = off.getContext('2d');
    const { w, h } = world;
    const L = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -SLAB : lvl[y * w + x]);

    // Soft contact shadow under the whole model.
    g.save();
    g.shadowColor = colors.shade; g.shadowBlur = P.tw * 3; g.shadowOffsetY = P.tw * 1.2;
    poly(g, [iso(0, 0, -SLAB), iso(w, 0, -SLAB), iso(w, h, -SLAB), iso(0, h, -SLAB)]);
    g.fillStyle = colors.housing; g.fill();
    g.restore();

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x, z = lvl[k], wet = world.water[k];
      const base = wet ? colors.water : colors.land;
      // Right face (towards +x) and left face (towards +y), only where the neighbour is lower.
      const zr = L(x + 1, y), zl = L(x, y + 1);
      if (zr < z) shadeFill(g, [iso(x + 1, y, z), iso(x + 1, y + 1, z), iso(x + 1, y + 1, zr), iso(x + 1, y, zr)], base, wet ? 0.5 : 0.42);
      if (zl < z) shadeFill(g, [iso(x, y + 1, z), iso(x + 1, y + 1, z), iso(x + 1, y + 1, zl), iso(x, y + 1, zl)], base, wet ? 0.35 : 0.24);
      // Top: land lightens with height (hypsometric tint), water darkens with depth.
      const lift = wet ? Math.min(0.55, (0.42 - world.height[k]) * 1.5) : -(0.03 + z * 0.042);
      shadeFill(g, [iso(x, y, z), iso(x + 1, y, z), iso(x + 1, y + 1, z), iso(x, y + 1, z)], base, lift);
    }

    // Contour ink: a hairline wherever the level changes, like a printed relief map.
    g.lineWidth = Math.max(1, P.dpr * 0.75);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x, z = lvl[k];
      for (const [nx, ny, a, b] of [[x + 1, y, [x + 1, y], [x + 1, y + 1]], [x, y + 1, [x, y + 1], [x + 1, y + 1]]]) {
        if (nx >= w || ny >= h || L(nx, ny) === z) continue;
        const shore = !!world.water[k] !== !!world.water[ny * w + nx];
        g.strokeStyle = shore ? colors['water-hi'] : colors['land-hi'];
        g.globalAlpha = shore ? 0.6 : 0.13;
        g.beginPath(); g.moveTo(...iso(...a, z)); g.lineTo(...iso(...b, z)); g.stroke();
      }
    }
    g.globalAlpha = 1;
    return off;
  }

  const zAt = (world, x, y) => lvl[Math.max(0, Math.min(world.h - 1, y | 0)) * world.w + Math.max(0, Math.min(world.w - 1, x | 0))];
  // Centre of cell (x, y) standing on the terrain, raised by dz levels.
  const at = (world, p, dz = 0) => iso(p.x + 0.5, p.y + 0.5, zAt(world, p.x, p.y) + dz);

  // A small extruded block centred on a cell: sides first, then the lit top. Returns the top centre.
  function block(world, p, half, height, color, edge) {
    const z0 = zAt(world, p.x, p.y), z1 = z0 + height, cx = p.x + 0.5, cy = p.y + 0.5;
    const a = [cx - half, cy - half], b = [cx + half, cy - half], c = [cx + half, cy + half], d = [cx - half, cy + half];
    shadeFill(ctx, [iso(...b, z1), iso(...c, z1), iso(...c, z0), iso(...b, z0)], edge || color, 0.45);
    shadeFill(ctx, [iso(...d, z1), iso(...c, z1), iso(...c, z0), iso(...d, z0)], edge || color, 0.25);
    shadeFill(ctx, [iso(...a, z1), iso(...b, z1), iso(...c, z1), iso(...d, z1)], color, 0);
    return iso(cx, cy, z1);
  }

  function jamPattern() {
    const p = document.createElement('canvas');
    const s = Math.round(6 * P.dpr);
    p.width = p.height = s;
    const g = p.getContext('2d');
    g.strokeStyle = colors.danger; g.lineWidth = 1.2 * P.dpr;
    g.beginPath(); g.moveTo(0, s); g.lineTo(s, 0); g.stroke();
    return ctx.createPattern(p, 'repeat');
  }

  function draw(sim, snap, now = performance.now()) {
    const { world, radio } = sim;
    resize(world);
    const side = snap[sideKey];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(terrain, 0, 0);

    // Jamming: a red wash and hatching laid on the terrain.
    if (radio.blackout || radio.jammed.some(Boolean)) {
      for (const [style, alpha] of [[colors['danger-lo'], 0.45], [hatch, 0.9]]) {
        ctx.fillStyle = style; ctx.globalAlpha = alpha;
        for (let k = 0; k < radio.jammed.length; k++) {
          if (!radio.blackout && !radio.jammed[k]) continue;
          const x = k % world.w, y = (k / world.w) | 0, z = lvl[k] + 0.05;
          poly(ctx, [iso(x, y, z), iso(x + 1, y, z), iso(x + 1, y + 1, z), iso(x, y + 1, z)]);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // Van intentions: a dotted line on the ground to the chosen home.
    ctx.lineWidth = Math.max(1, P.dpr); ctx.strokeStyle = colors.amber; ctx.globalAlpha = 0.5;
    ctx.setLineDash([2 * P.dpr, 3 * P.dpr]);
    ctx.beginPath();
    for (const v of side.vans) if (v.target) { ctx.moveTo(...at(world, v, 0.1)); ctx.lineTo(...at(world, v.target, 0.1)); }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;

    // Everything that stands on the model, drawn back to front.
    const things = [];
    const sosHomes = sideKey === 'ours' ? new Set(snap.sos.filter((s) => s.state === 'waiting').map((s) => s.household)) : new Set();
    world.households.forEach((h, i) => things.push({ d: h.x + h.y, kind: 'home', h, st: side.state[i] }));
    for (const v of side.vans) things.push({ d: v.x + v.y + 0.5, kind: 'van', v });
    things.push({ d: world.base.x + world.base.y + 0.25, kind: 'base' });
    things.sort((a, b) => a.d - b.d);

    const pulse = 0.55 + 0.45 * Math.sin(now / 320);
    const tops = new Map();
    for (const t of things) {
      if (t.kind === 'home') {
        const col = t.st === 0 ? colors['land-hi'] : t.st === 1 ? colors.served : colors.danger;
        const [x, y] = block(world, t.h, 0.24, 1.3, col, t.st === 0 ? colors['ink-3'] : null);
        if (sosHomes.has(t.h.id)) {
          // A lantern on a pole: this home has a voice SOS waiting.
          const up = P.zs * 3.2;
          ctx.strokeStyle = colors.amber; ctx.lineWidth = Math.max(1, P.dpr * 0.9);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - up); ctx.stroke();
          lightAt(glow.amber, x, y - up, 0.55 + 0.3 * pulse);
          ctx.fillStyle = colors['amber-2']; ctx.beginPath(); ctx.arc(x, y - up, Math.max(2, P.tw * 0.18), 0, 7); ctx.fill();
        }
      } else if (t.kind === 'base') {
        // The depot, with a mast. On the dispatcher board the mast lamp is the tower: lit while it reaches a van.
        const [x, y] = block(world, world.base, 0.46, 1.6, colors['panel-2'], colors.rule);
        const up = P.zs * 6, live = sideKey === 'dispatcher' && side.links.length > 0;
        ctx.strokeStyle = colors.ink; ctx.lineWidth = Math.max(1.2, P.dpr);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - up); ctx.stroke();
        if (live) lightAt(glow.served, x, y - up, 0.7 + 0.3 * pulse);
        ctx.fillStyle = live ? colors.served : colors.ink; ctx.beginPath(); ctx.arc(x, y - up, Math.max(2.5, P.tw * 0.22), 0, 7); ctx.fill();
      } else {
        const v = t.v, idle = v.idle && v.stock > 0;
        if (!idle) lightAt(glow.amber, ...at(world, v, 0.4), 0.9);
        tops.set(v.id, block(world, v, 0.36, 1.8, idle ? colors.night : colors.amber, idle ? colors.amber : colors['amber-lo']));
      }
    }

    // Radio: arcs through the air between whoever can hear each other; the dashes travel.
    ctx.strokeStyle = sideKey === 'ours' ? colors.link : colors['ink-2']; ctx.globalAlpha = 0.75;
    ctx.lineWidth = Math.max(1, P.dpr * 1.1); ctx.setLineDash([3 * P.dpr, 3 * P.dpr]);
    ctx.lineDashOffset = -now / 60;
    ctx.beginPath();
    for (const [ax, ay, bx, by] of side.links) {
      const a = at(world, { x: ax, y: ay }, 1.8), b = at(world, { x: bx, y: by }, sideKey === 'ours' ? 1.8 : 7.6);
      const lift = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.28;
      ctx.moveTo(...a); ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - lift, ...b);
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;

    // Van labels last, so nothing covers them.
    ctx.font = `600 ${Math.max(10 * P.dpr, P.tw * 0.75)}px ${css('--font-data')}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = colors.ink;
    for (const v of side.vans) { const [x, y] = tops.get(v.id); ctx.fillText(v.id, x, y - P.zs); }
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

  return { draw, cellAt, invalidate() { sizeKey = ''; } };
}

// ── Trend chart: served over time, both systems, same scale ─────
const history = [];
function drawTrend(total) {
  const c = $('trend'), ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 44 * dpr, r: 56 * dpr, t: 14 * dpr, b: 24 * dpr };
  const span = Math.max(200, history.length);
  const X = (i) => pad.l + (i / span) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - (v / total) * (H - pad.t - pad.b);
  ctx.font = `500 ${11 * dpr}px ${css('--font-data')}`;
  ctx.fillStyle = colors['ink-3']; ctx.strokeStyle = colors.rule; ctx.lineWidth = 1;
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
  line('o', colors.amber, []);
  if (history.some((h) => h.x > 0)) line('x', colors.danger, []);
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
  $('btnBlackout').querySelector('span').textContent = 'Total blackout';
  $('seedLabel').textContent = `seed ${SEED}`;
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
  $('radioText').textContent = radio.blackout ? 'Total blackout' : jammedAny || radio.loss > 0 ? 'Radio degraded' : 'Radio clear';

  $('oursMode').textContent = snap.mode === 'safe' ? 'Safe mode' : 'Lifeline mode';
  const linked = snap.dispatcher.links.length;
  const ds = $('dispState');
  ds.textContent = linked ? `Tower linked · ${linked}/6` : 'Tower cut off';
  ds.className = 'chip ' + (linked ? 'quiet' : 'bad');
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
    tool === 'jam' ? sim.radio.jam(c.x, c.y, 2) : sim.radio.unjam(c.x, c.y, 2);
    render();
  };
  canvas.addEventListener('pointerdown', (e) => { down = true; canvas.setPointerCapture(e.pointerId); paint(e); });
  canvas.addEventListener('pointermove', (e) => down && paint(e));
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
  $('btnBlackout').querySelector('span').textContent = on ? 'Restore radio' : 'Total blackout';
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

readColors();
await newSim();
document.fonts.ready.then(() => render());
requestAnimationFrame(frame);
