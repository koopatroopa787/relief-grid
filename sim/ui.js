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

// ── Map rendering ───────────────────────────────────────────────
let colors;
function readColors() {
  colors = Object.fromEntries(['water', 'water-2', 'land', 'land-2', 'amber', 'amber-ink', 'served', 'danger', 'link', 'ink', 'ink-2', 'ink-3', 'night', 'rule'].map((k) => [k, css('--' + k)]));
}

function jamPattern(ctx) {
  const p = document.createElement('canvas');
  p.width = p.height = 8;
  const g = p.getContext('2d');
  g.strokeStyle = colors.danger; g.globalAlpha = 0.75; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.moveTo(-2, 2); g.lineTo(2, -2); g.stroke();
  return ctx.createPattern(p, 'repeat');
}

function makeBoard(canvas, sideKey) {
  const ctx = canvas.getContext('2d');
  let terrain = null, cs = 1, pattern = null, sizeKey = '';

  function resize(world) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const key = `${w}x${h}@${dpr}`;
    if (key === sizeKey) return;
    sizeKey = key;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    cs = canvas.width / world.w;
    terrain = drawTerrain(world);
    pattern = jamPattern(ctx);
  }

  function drawTerrain(world) {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const g = off.getContext('2d');
    for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
      const k = y * world.w + x, ht = world.height[k];
      g.fillStyle = world.water[k] ? (ht < 0.3 ? colors.water : colors['water-2']) : (ht > 0.6 ? colors['land-2'] : colors.land);
      g.fillRect(Math.floor(x * cs), Math.floor(y * cs), Math.ceil(cs), Math.ceil(cs));
    }
    // Flood line: a pale contour where water meets land.
    g.strokeStyle = colors.link; g.globalAlpha = 0.22; g.lineWidth = Math.max(1, cs * 0.08);
    g.beginPath();
    for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
      const k = y * world.w + x;
      if (!world.water[k]) continue;
      if (x + 1 < world.w && !world.water[k + 1]) { g.moveTo((x + 1) * cs, y * cs); g.lineTo((x + 1) * cs, (y + 1) * cs); }
      if (x > 0 && !world.water[k - 1]) { g.moveTo(x * cs, y * cs); g.lineTo(x * cs, (y + 1) * cs); }
      if (y + 1 < world.h && !world.water[k + world.w]) { g.moveTo(x * cs, (y + 1) * cs); g.lineTo((x + 1) * cs, (y + 1) * cs); }
      if (y > 0 && !world.water[k - world.w]) { g.moveTo(x * cs, y * cs); g.lineTo((x + 1) * cs, y * cs); }
    }
    g.stroke();
    // Faint survey grid every 4 cells.
    g.globalAlpha = 0.06; g.strokeStyle = colors.ink; g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= world.w; x += 4) { g.moveTo(x * cs, 0); g.lineTo(x * cs, off.height); }
    for (let y = 0; y <= world.h; y += 4) { g.moveTo(0, y * cs); g.lineTo(off.width, y * cs); }
    g.stroke();
    return off;
  }

  const center = (p) => [(p.x + 0.5) * cs, (p.y + 0.5) * cs];

  function draw(sim, snap) {
    const { world, radio } = sim;
    resize(world);
    const side = snap[sideKey];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(terrain, 0, 0);

    // Jamming
    ctx.fillStyle = pattern;
    if (radio.blackout) {
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      for (let k = 0; k < radio.jammed.length; k++) if (radio.jammed[k]) {
        const x = k % world.w, y = (k / world.w) | 0;
        ctx.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
      }
    }

    // Radio links
    ctx.save();
    ctx.strokeStyle = colors.link; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, cs * 0.09);
    ctx.setLineDash([cs * 0.35, cs * 0.3]);
    ctx.beginPath();
    for (const [ax, ay, bx, by] of side.links) {
      ctx.moveTo((ax + 0.5) * cs, (ay + 0.5) * cs); ctx.lineTo((bx + 0.5) * cs, (by + 0.5) * cs);
    }
    ctx.stroke();
    ctx.restore();

    // Households
    const sq = cs * 0.5;
    const sosHomes = sideKey === 'ours' ? new Set(snap.sos.filter((s) => s.state === 'waiting').map((s) => s.household)) : new Set();
    world.households.forEach((h, i) => {
      const st = side.state[i];
      const [cx, cy] = center(h);
      ctx.fillStyle = st === 0 ? colors['ink-2'] : st === 1 ? colors.served : colors.danger;
      ctx.globalAlpha = st === 0 ? 0.9 : 1;
      ctx.fillRect(cx - sq / 2, cy - sq / 2, sq, sq);
      if (st === 2) {
        ctx.strokeStyle = colors.danger; ctx.lineWidth = Math.max(1, cs * 0.1);
        ctx.strokeRect(cx - sq, cy - sq, sq * 2, sq * 2);
      }
      if (sosHomes.has(h.id)) {
        ctx.strokeStyle = colors.amber; ctx.lineWidth = Math.max(1, cs * 0.1);
        ctx.beginPath(); ctx.arc(cx, cy, sq * 1.15, 0, Math.PI * 2); ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    // Base depot
    const [bx, by] = center(world.base);
    ctx.strokeStyle = colors.ink; ctx.lineWidth = Math.max(1.5, cs * 0.12);
    ctx.beginPath(); ctx.arc(bx, by, cs * 0.8, 0, Math.PI * 2); ctx.moveTo(bx - cs * 0.5, by); ctx.lineTo(bx + cs * 0.5, by); ctx.moveTo(bx, by - cs * 0.5); ctx.lineTo(bx, by + cs * 0.5); ctx.stroke();

    // Vans: a faint line to where each one has decided to go, then the van itself.
    ctx.lineWidth = Math.max(1, cs * 0.08);
    for (const v of side.vans) {
      const [vx, vy] = center(v);
      if (v.target) {
        const [tx, ty] = center(v.target);
        ctx.strokeStyle = colors.amber; ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    const r = cs * 0.62;
    ctx.font = `600 ${Math.max(10, cs * 0.9)}px ${css('--font-data')}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const v of side.vans) {
      const [vx, vy] = center(v);
      ctx.beginPath(); ctx.arc(vx, vy, r, 0, Math.PI * 2);
      if (v.idle && v.stock > 0) {
        ctx.fillStyle = colors.night; ctx.fill();
        ctx.strokeStyle = colors.amber; ctx.lineWidth = Math.max(1.5, cs * 0.14); ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = colors.amber; ctx.fill();
        ctx.strokeStyle = colors.night; ctx.lineWidth = Math.max(1.5, cs * 0.14); ctx.stroke();
      }
      ctx.fillStyle = colors.ink;
      ctx.fillText(v.id, vx, vy - r - cs * 0.15);
    }
  }

  function cellAt(e, world) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - rect.left) / rect.width) * world.w), y: Math.floor(((e.clientY - rect.top) / rect.height) * world.h) };
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
