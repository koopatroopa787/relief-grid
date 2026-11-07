// D1 · world generation. Deterministic from a seed: same seed, same flood, same households.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LANGS = ['en', 'ur', 'ar', 'pl'];
const SOS_TEXT = {
  en: 'Four of us on the first floor. My father needs insulin.',
  ur: 'Hum chaar log hain, upar wali manzil par. Abbu ko insulin chahiye.',
  ar: 'نحن أربعة في الطابق الأول. والدي يحتاج إلى الأنسولين.',
  pl: 'Jest nas czworo na piętrze. Mój tata potrzebuje insuliny.',
};

// Smooth height field from a coarse random lattice, with a river channel cut through it.
function heightField(w, h, rng) {
  const gw = 7, gh = 5;
  const lattice = Array.from({ length: (gw + 1) * (gh + 1) }, rng);
  const at = (i, j) => lattice[j * (gw + 1) + i];
  const smooth = (t) => t * t * (3 - 2 * t);
  const riverY = h * (0.35 + rng() * 0.3), amp = h * 0.18, freq = 1.5 + rng(), phase = rng() * 6.28;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / (w - 1)) * gw, fy = (y / (h - 1)) * gh;
      const i = Math.min(gw - 1, Math.floor(fx)), j = Math.min(gh - 1, Math.floor(fy));
      const u = smooth(fx - i), v = smooth(fy - j);
      const n = (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
      const cy = riverY + Math.sin((x / w) * freq * 6.28 + phase) * amp;
      const river = Math.min(1, Math.abs(y - cy) / (h * 0.22));
      out[y * w + x] = n * 0.55 + river * 0.45;
    }
  }
  return out;
}

export function makeWorld(seed, { w = 48, h = 32, households = 120, vans = 6 } = {}) {
  const rng = mulberry32(seed);
  const height = heightField(w, h, rng);
  const water = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) water[k] = height[k] < 0.45 ? 1 : 0;

  // Street grid: avenues every 6 columns, streets every 5 rows, offset per seed. Flooded streets stay roads.
  const ax = Math.floor(rng() * 6), sy = Math.floor(rng() * 5);
  const road = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) road[y * w + x] = x % 6 === ax || y % 5 === sy ? 1 : 0;

  // Base on the highest road cell in the left third, where an aid depot would sit.
  let best = -1;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w / 3; x++) {
    const k = y * w + x;
    if (road[k] && (best < 0 || height[k] > height[best])) best = k;
  }
  const base = { x: best % w, y: Math.floor(best / w) };

  const taken = new Set([best]);
  const hs = [];
  while (hs.length < households) {
    const x = Math.floor(rng() * w), y = Math.floor(rng() * h), k = y * w + x;
    if (taken.has(k) || road[k] || Math.abs(x - base.x) + Math.abs(y - base.y) < 3) continue;
    // Homes cluster on and near the flood edge, where help is needed.
    if (height[k] > 0.62 && rng() < 0.7) continue;
    taken.add(k);
    const id = `H${hs.length + 1}`;
    const lang = LANGS[Math.floor(rng() * LANGS.length)];
    const sos = rng() < 0.1 ? { sos_id: `S-${id}-001`, lang, audio: 'samples/sos_' + lang + '.mp3', text: SOS_TEXT[lang] } : null;
    hs.push({ id, x, y, people: 1 + Math.floor(rng() * 5), lang, sos, flooded: !!water[k], needsAid: true, floors: 1 + Math.floor(rng() * 3) });
  }

  // The rest of the city: blocks that are not homes we track. Drawn only; vans ignore them.
  const buildings = [];
  for (let k = 0; k < w * h; k++) {
    const x = k % w, y = Math.floor(k / w);
    if (road[k] || taken.has(k) || water[k] || Math.abs(x - base.x) + Math.abs(y - base.y) < 2) continue;
    if (rng() < 0.62) buildings.push({ x, y, floors: 1 + Math.floor(rng() * rng() * 6), lit: rng() });
  }

  const stock = Math.ceil(households / vans) + 4;
  const vs = Array.from({ length: vans }, (_, i) => ({ id: `V${i + 1}`, x: base.x, y: base.y, stock }));
  return { seed, w, h, rng, base, households: hs, vans: vs, water, height, road, buildings };
}

// Self-check: same seed gives the same world.
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('world.js')) {
  const a = makeWorld(7), b = makeWorld(7);
  console.assert(JSON.stringify(a.households) === JSON.stringify(b.households), 'world not deterministic');
  console.assert(a.households.length === 120 && a.vans.length === 6, 'wrong counts');
  console.log('world ok', a.base, a.households.filter((h) => h.sos).length, 'sos');
}
