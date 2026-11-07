// sim/hq_link.js
// Owner: Akshita
// The link between vans arriving at base and HQ (the n8n workflow).
//
// HQ is NOT part of the field. Vans never wait for it: a van hands its SOS batch over at base
// (action.hqBatch) and drives on. This module keeps every batch in a queue and POSTs it to HQ.
// If HQ is down or slow, batches stay queued and are retried with backoff. When HQ comes back,
// the backlog flushes in order. That is the "kill n8n live" demo moment.
//
// Contract (PLAN.md): POST {url}/webhook/sos  body {van, t, batch: [{sos_id, household, lang, audio, text}]}
//                     200 -> {replies: [{sos_id, household, lang, text, audio_url}]}
// Replies may also carry audio_b64 (+ mime) instead of audio_url if FIXES.md F5 is agreed; both are handled.
//
// Usage from main.js:
//   const hq = makeHqLink({ url: 'http://localhost:5678', onReplies: (replies, info) => { ... } });
//   // each tick, for every van action with an hqBatch:
//   if (action.hqBatch) hq.submit(vanId, t, action.hqBatch);
//   hq.pump();                      // cheap; call every tick or on a timer
//   ui shows hq.status()            // {state, pending, inFlight, sent, failures, lastError, nextRetryInMs}
//
// No HQ yet? makeHqLink({ mock: true }) answers locally with text-only replies, so the sim
// can be built and demoed before n8n exists.

const DEFAULTS = {
  url: null,                 // e.g. 'http://localhost:5678' (n8n). null + mock:false = queue only, never sends
  path: '/webhook/sos',
  timeoutMs: 30000,          // transcription + LLM + TTS can take a while
  retryBaseMs: 1000,         // first retry after 1s, then 2s, 4s ... up to retryMaxMs
  retryMaxMs: 15000,
  mock: false,
  mockDelayMs: 600,
  onReplies: () => {},       // (replies, {van, t, batchId}) => void
  onStatus: () => {},        // (status) => void, called whenever the status changes
  fetchImpl: null,           // injectable for tests; defaults to globalThis.fetch
  now: () => Date.now(),     // injectable for tests
};

export function makeHqLink(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const doFetch = cfg.fetchImpl || ((...args) => globalThis.fetch(...args));

  const queue = [];          // [{batchId, van, t, batch}] oldest first
  const seenSosIds = new Set(); // every sos_id ever queued, so the same SOS from two vans is sent once
  let nextBatchId = 1;
  let inFlight = null;       // the batch currently being sent, or null
  let paused = false;
  let failures = 0;          // consecutive failures, drives the backoff
  let nextAttemptAt = 0;
  let sent = 0;              // batches HQ accepted
  let lastError = null;
  let state = cfg.mock ? 'mock' : (cfg.url ? 'unknown' : 'offline'); // 'unknown' | 'up' | 'down' | 'offline' | 'mock'

  function status() {
    return {
      state,
      paused,
      pending: queue.length,
      pendingSos: queue.reduce((n, b) => n + b.batch.length, 0),
      inFlight: inFlight !== null,
      sent,
      failures,
      lastError,
      nextRetryInMs: Math.max(0, nextAttemptAt - cfg.now()),
    };
  }

  function emitStatus() {
    cfg.onStatus(status());
  }

  // Queue a van's batch. Drops SOS notes already queued or sent (two vans can carry the same note).
  // Returns how many new SOS notes were queued.
  function submit(van, t, batch) {
    if (!Array.isArray(batch) || batch.length === 0) return 0;
    const fresh = batch.filter(sos => sos && sos.sos_id && !seenSosIds.has(sos.sos_id));
    if (fresh.length === 0) return 0;
    for (const sos of fresh) seenSosIds.add(sos.sos_id);
    queue.push({ batchId: nextBatchId++, van, t, batch: fresh.map(cleanSos) });
    emitStatus();
    return fresh.length;
  }

  // Try to send the oldest batch, if allowed. Safe to call as often as you like.
  // Returns a promise that resolves when this attempt finishes (useful in tests; main.js can ignore it).
  function pump() {
    if (paused || inFlight || queue.length === 0) return Promise.resolve();
    if (!cfg.mock && !cfg.url) return Promise.resolve();
    if (cfg.now() < nextAttemptAt) return Promise.resolve();

    const item = queue[0];
    inFlight = item;
    emitStatus();
    const attempt = cfg.mock ? mockSend(item) : httpSend(item);

    return attempt.then(
      replies => {
        queue.shift();
        inFlight = null;
        failures = 0;
        nextAttemptAt = 0;
        sent += 1;
        lastError = null;
        state = cfg.mock ? 'mock' : 'up';
        emitStatus();
        try {
          cfg.onReplies(replies, { van: item.van, t: item.t, batchId: item.batchId });
        } catch (err) {
          console.error('hq_link: onReplies handler threw', err); // a UI bug must not lose the queue
        }
      },
      err => {
        inFlight = null;
        failures += 1;
        lastError = String(err && err.message ? err.message : err);
        state = 'down';
        nextAttemptAt = cfg.now() + backoffMs(failures);
        emitStatus();
      },
    );
  }

  async function httpSend(item) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), cfg.timeoutMs) : null;
    try {
      const res = await doFetch(joinUrl(cfg.url, cfg.path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ van: item.van, t: item.t, batch: item.batch }),
        signal: controller ? controller.signal : undefined,
      });
      if (!res.ok) throw new Error(`HQ answered ${res.status}`);
      const body = await res.json();
      return normaliseReplies(body, item);
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error(`HQ timed out after ${cfg.timeoutMs} ms`);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function mockSend(item) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(item.batch.map(sos => ({
          sos_id: sos.sos_id,
          household: sos.household,
          lang: sos.lang,
          text: `[mock HQ] Message received from ${sos.household}. Help is on the way.`,
          audio_url: null,
        })));
      }, cfg.mockDelayMs);
    });
  }

  function backoffMs(n) {
    return Math.min(cfg.retryMaxMs, cfg.retryBaseMs * 2 ** (n - 1));
  }

  // Demo controls.
  function pause() { paused = true; emitStatus(); }
  function resume() { paused = false; nextAttemptAt = 0; emitStatus(); }
  function retryNow() { nextAttemptAt = 0; emitStatus(); return pump(); }
  function setUrl(url) {
    cfg.url = url;
    cfg.mock = false;
    state = url ? 'unknown' : 'offline';
    nextAttemptAt = 0;
    emitStatus();
  }

  return { submit, pump, status, pause, resume, retryNow, setUrl };
}

// Keep only the contract fields, so van-internal fields never leak to HQ.
function cleanSos(sos) {
  return {
    sos_id: sos.sos_id,
    household: sos.household,
    lang: sos.lang ?? null,
    audio: sos.audio ?? null,
    text: sos.text ?? null,
  };
}

// HQ must answer {replies: [...]}. Accept a bare array too, and ignore malformed entries.
function normaliseReplies(body, item) {
  const list = Array.isArray(body) ? body : (body && Array.isArray(body.replies) ? body.replies : null);
  if (!list) throw new Error('HQ reply had no "replies" array');
  const known = new Set(item.batch.map(s => s.sos_id));
  return list
    .filter(r => r && r.sos_id && known.has(r.sos_id))
    .map(r => ({
      sos_id: r.sos_id,
      household: r.household,
      lang: r.lang ?? null,
      text: r.text ?? '',
      audio_url: r.audio_url ?? null,
      audio_b64: r.audio_b64 ?? null,
      mime: r.mime ?? 'audio/mpeg',
    }));
}

function joinUrl(base, path) {
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

// For the UI: a playable src for a reply, or null if it has no audio.
// new Audio(replyAudioSrc(reply)).play()
export function replyAudioSrc(reply) {
  if (!reply) return null;
  if (reply.audio_b64) return `data:${reply.mime || 'audio/mpeg'};base64,${reply.audio_b64}`;
  return reply.audio_url || null;
}
