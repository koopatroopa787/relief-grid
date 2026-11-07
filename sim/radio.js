// D2 · the only way anything talks. Range, packet loss, delay and a jamming mask.

export function makeRadio({ w, h, range = 8, loss = 0, delay = 0, rng }) {
  const jammed = new Uint8Array(w * h);
  let queue = [], now = 0, blackout = false;

  const isJammed = (x, y) => blackout || !!jammed[(y | 0) * w + (x | 0)];

  function canLink(a, b, r = range) {
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > r * r) return false;
    // A link fails if either end or any sampled point along it sits in a jammed cell.
    const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (isJammed(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t))) return false;
    }
    return true;
  }

  return {
    jammed,
    isJammed,
    jam(x, y, r) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const cx = x + i, cy = y + j;
        if (cx >= 0 && cy >= 0 && cx < w && cy < h && i * i + j * j <= r * r) jammed[cy * w + cx] = 1;
      }
    },
    unjam(x, y, r) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const cx = x + i, cy = y + j;
        if (cx >= 0 && cy >= 0 && cx < w && cy < h && i * i + j * j <= r * r) jammed[cy * w + cx] = 0;
      }
    },
    clearJam() { jammed.fill(0); blackout = false; },
    setBlackout(on) { blackout = !!on; },
    get blackout() { return blackout; },
    setLoss(p) { loss = Math.min(1, Math.max(0, p)); },
    get loss() { return loss; },
    canLink,
    // from/to are {id, x, y}. Dropped silently on a failed link or by packet loss.
    send(from, to, msg, r) {
      if (!canLink(from, to, r) || rng() < loss) return false;
      queue.push({ at: now + delay, to: to.id, from: from.id, msg });
      return true;
    },
    deliver(t) {
      now = t;
      const due = queue.filter((m) => m.at <= t);
      queue = queue.filter((m) => m.at > t);
      return due;
    },
  };
}
