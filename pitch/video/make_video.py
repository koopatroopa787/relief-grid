"""Relief Grid pitch video, made from the real sim.

  python make_video.py voice  [--ref my_voice.wav]   # Chatterbox voice-over, one WAV per segment
  python make_video.py record [--url URL]            # drives the live page in Chromium, captures frames
  python make_video.py edit   [--no-music]           # frames + voice (+ quiet pad) -> relief-grid-pitch.mp4

Needs the sim served first:  cd sim && python -m http.server 8000
Output goes to ./out (git-ignored). Voice-over is Chatterbox (Resemble AI, open source), run locally on the GPU.
"""
import argparse, asyncio, base64, json, re, subprocess, sys, time
from pathlib import Path

OUT = Path(__file__).parent / 'out'
GAP = 0.55  # silence after each segment, seconds
TEMPO = 1.1  # v3 reads slowly; a touch faster (pitch kept) brings the cut near 2:00

# ── The story. [tags] are ElevenLabs v3 delivery cues, not spoken. `do` lists (seconds into the segment, action); actions are defined in record(). ──
SEGMENTS = [
    dict(id='hook', card='stat', text=(
        '[serious] In 2017, Hurricane Maria took out ninety-six percent of the cell sites in Puerto Rico... and most aid still runs on someone at a desk, radioing every driver.')),
    # Vans start behind the title card, so the map is already moving when it lifts.
    dict(id='title', card='title', do=[(0, 'reset'), (0.2, 'run')], text=(
        "[warmly] So we built Relief Grid: aid vans that keep delivering when the radio's gone, and never knock on the same door twice.")),
    dict(id='intro', chap='[01] One city, run twice',
         do=[(0, 'uncard'), ('22%', 'cam:ours:1.4'), ('58%', 'cam:disp:1.4'), ('86%', 'cam:off')], text=(
        "What you're looking at is one flooded city, run twice, with six vans and a hundred and twenty homes. On the left there's no dispatcher at all; each van makes its own calls, and swaps notes with any van it drives past. On the right is the usual way, one dispatcher on a radio tower, handing out every job.")),
    dict(id='jam', chap='[02] Jam the radio', do=[(0, 'reset'), (0.5, 'jam_base'), (2.1, 'run'), (2.3, 'park')], hold=1.2, text=(
        "[curious] Okay. Let's jam the tower...")),
    dict(id='jam2', do=[(0, 'cam:disp:1.55'), ('33%', 'cam:ours:1.55'), ('78%', 'cam:#oDouble:2.2'), ('97%', 'cam:off')], text=(
        "[amazed] See that? The dispatcher's vans just stop, they can't hear the tower, so they sit there and wait. [warmly] But ours keep going. Every van runs the same hash over each home and the vans it thinks are alive, so they all land on the same owner without sending a single message. You only serve homes you own... which is why served twice is still sitting at zero.")),
    dict(id='lifeline', chap='[03] Safe or Lifeline',
         do=[(0.2, 'cam:#modeLife:1.7'), ('30%', 'lifeline'), ('36%', 'park'), ('62%', 'cam:#oDouble:2.2'), ('97%', 'cam:off')], text=(
        "[thoughtful] Now here's the hard part. A van goes quiet. Is it broken, or just out of range? Safe mode waits, so nothing gets served twice. Lifeline hands its homes to the other vans, so you cover more ground, but now you can double up, and we count every single one, right there. Whoever's running the operation gets to choose.")),
    dict(id='sos', chap='[04] Voice SOS', do=[(0.3, 'open_sos')], text=(
        'Families can leave a voice note too, in whatever language they speak, and it hops from van to van until one gets back to base.')),
    dict(id='hq', card='hq', do=[(0, 'close_sos'), (0, 'chap:')], text=(
        'At HQ, an n-eight-n workflow picks it up. ElevenLabs transcribes it, Claude works out what they need and how urgent it is, and a spoken reply goes back out on the next van.')),
    dict(id='killhq', chap='[05] HQ goes down', do=[(0, 'uncard'), (0.5, 'open_sos'), (1.6, 'hq_off'), ('78%', 'hq_on')], text=(
        "[playful] And if HQ goes down? Honestly, the vans don't even notice. They hang on to the notes and keep trying, and when HQ comes back, the backlog just clears.")),
    dict(id='close', card='end', do=[(0, 'close_sos'), (0, 'chap:')], text=(
        "[warmly] No dispatcher, no network, and no door gets knocked twice. That's Relief Grid. [playful] Go on... try jamming it.")),
]

# ── Cards: full-screen sheets in the console's own style (they reuse the page's CSS tokens). ──
CARD_CSS = """
#vcard{position:fixed;inset:0;z-index:50;background:var(--paper);display:grid;padding:var(--gutter);
  opacity:0;transition:opacity .5s var(--ease-out)}
#vcard.on{opacity:1}
#vcard .sheet-v{border:1px solid var(--rule);display:grid;grid-template-rows:auto 1fr auto}
#vcard .row{display:flex;justify-content:space-between;padding:18px 24px;border-bottom:1px solid var(--rule)}
#vcard .row:last-child{border-bottom:0;border-top:1px solid var(--rule)}
#vcard .big{font:800 23vw/.78 var(--font-display);font-stretch:62%;letter-spacing:-.01em;color:var(--ink);
  align-self:end;padding:0 3vw 2vw}
#vcard .mid{align-self:center;padding:0 4vw;font:750 6.4vw/.9 var(--font-display);font-stretch:62%;text-transform:uppercase}
#vcard .lede{font:400 1.35rem/1.5 var(--font-data);max-width:46ch;padding:0 4vw 3vw}
#vcard .steps{display:grid;grid-template-columns:repeat(5,1fr);border-top:1px solid var(--rule);align-self:end}
#vcard .steps div{padding:22px 20px 28px;border-left:1px solid var(--rule);min-height:30vh;display:flex;flex-direction:column;justify-content:space-between}
#vcard .steps div:first-child{border-left:0}
#vcard .steps b{font:750 2.6rem/.95 var(--font-display);font-stretch:62%;text-transform:uppercase}
#vcard .steps p{font:400 1rem/1.45 var(--font-data);color:var(--ink-2)}
#vcard .steps div{opacity:0;transform:translateY(14px);animation:vstep .6s var(--ease-out) forwards}
@keyframes vstep{to{opacity:1;transform:none}}
#vcard .hl{color:var(--signal-tx)}
#vchap{position:fixed;z-index:60;left:var(--gutter);bottom:calc(var(--gutter) + 92px);background:var(--paper);
  border:1px solid var(--ink);padding:12px 18px 10px;font:750 2.1rem/1 var(--font-display);font-stretch:62%;
  text-transform:uppercase;color:var(--ink);transform:translateX(-24px);opacity:0;
  transition:opacity .35s var(--ease-out),transform .5s var(--ease-out)}
#vchap.on{opacity:1;transform:none}
#vchap span{display:block;font:500 .78rem/1 var(--font-data);letter-spacing:.08em;color:var(--signal-tx);margin-bottom:6px}
"""
CARDS = {
    'stat': """<div class="sheet-v"><div class="row"><span class="tag">[Context] Hurricane Maria · Puerto Rico · 2017</span><span class="tag">Source: FCC status report, 21 Sep 2017</span></div>
      <div style="display:grid;grid-template-columns:auto 1fr;align-items:end"><div class="big">96%</div>
      <p class="lede">of cell sites out of service. Aid that waits for a dispatcher's call <span class="hl">stops</span> when the radio stops.</p></div>
      <div class="row"><span class="tag">Relief Grid</span><span class="tag">GreatUniHack 2026 · Neptune North</span></div></div>""",
    'title': """<div class="sheet-v"><div class="row"><span class="tag">[Project] GreatUniHack 2026</span><span class="tag">Built in six hours</span></div>
      <div class="big" style="font-size:17vw">Relief Grid</div>
      <div class="row"><span class="tag">Aid vans that keep delivering with no network</span><span class="tag">and never serve the same home twice</span></div></div>""",
    'hq': """<div class="sheet-v"><div class="row"><span class="tag">[HQ] The n8n workflow behind the base</span><span class="tag">Every step fails soft · repeats answered from cache</span></div>
      <div class="mid">A voice note<br>reaches base</div>
      <div class="steps">
        <div style="animation-delay:.1s"><span class="tag">01 · n8n</span><b>Webhook</b><p>A van at base hands in its batch of SOS notes.</p></div>
        <div style="animation-delay:.5s"><span class="tag">02 · ElevenLabs</span><b>Scribe</b><p>Transcribes the note, in any language.</p></div>
        <div style="animation-delay:.9s"><span class="tag">03 · Claude</span><b>Triage</b><p>Translates it, lists needs, scores urgency 1 to 3.</p></div>
        <div style="animation-delay:1.3s"><span class="tag">04 · ElevenLabs</span><b>Spoken reply</b><p>Records the answer in the family's language.</p></div>
        <div style="animation-delay:1.7s"><span class="tag">05 · Field</span><b>Next van out</b><p>The reply rides back to the household.</p></div>
      </div></div>""",
    'end': """<div class="sheet-v"><div class="row"><span class="tag">[End] Relief Grid</span><span class="tag">github.com/koopatroopa787/relief-grid</span></div>
      <div class="mid" style="font-size:7.4vw">No dispatcher.<br>No network.<br><span class="hl">Nobody served twice.</span></div>
      <div class="row"><span class="tag">Kanishk · Akshita · Darryll</span><span class="tag">Go on, try jamming it.</span></div></div>""",
}

CAM_JS = """([x, y, k, d]) => { const s = document.querySelector('.sheet'), c = s._cam || {k: 1, tx: 0, ty: 0};
  const ux = (x - c.tx) / c.k, uy = (y - c.ty) / c.k, W = innerWidth, H = innerHeight;
  const tx = Math.min(0, Math.max(W - W * k, W / 2 - ux * k)), ty = Math.min(0, Math.max(H - H * k, H / 2 - uy * k));
  s._cam = {k, tx, ty}; s.style.transformOrigin = '0 0'; s.style.willChange = 'transform';
  s.style.transition = `transform ${d}s cubic-bezier(.65,0,.3,1)`;
  s.style.transform = `translate(${tx}px,${ty}px) scale(${k})`; }"""

CHAP_JS = """t => { let c = document.getElementById('vchap');
  if (!c) { c = document.createElement('div'); c.id = 'vchap'; document.body.append(c); }
  c.classList.remove('on'); if (!t) return;
  const [n, ...rest] = t.split('] '); setTimeout(() => { c.innerHTML = `<span>${n}]</span>${rest.join('] ')}`; c.classList.add('on'); clearTimeout(c._t); c._t = setTimeout(() => c.classList.remove('on'), 3600); }, 380); }"""

# A visible cursor: the page is captured headless, which has no pointer of its own.
CURSOR_JS = """
addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;z-index:99;width:22px;height:22px;margin:-11px 0 0 -11px;border:2px solid #1d3fae;border-radius:50%;pointer-events:none;transition:transform .12s;left:-50px;top:-50px;background:rgba(255,255,255,.35)';
  document.body.append(c);
  addEventListener('pointermove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('pointerdown', () => c.style.transform = 'scale(.7)', true);
  addEventListener('pointerup', () => c.style.transform = '', true);
});
"""


def split_sentences(text):
    return [s.strip() for s in re.split(r'(?<=[.?!])\s+', text) if s.strip()]


KEY_FILE = Path(__file__).resolve().parents[3] / '.elevenlabs_key'  # outside the repo, never committed
VOICES = {'chris': 'iP95p4xoKVk53GoZ742B', 'roger': 'CwhRBWXzGAHq8TQ4Fs17', 'will': 'bIHbv24MWmeRgasZH58o', 'george': 'JBFqnCBsd6RMkjVDRZzb', 'brian': 'nPczCjzI2devNBz1zQrb', 'daniel': 'onwK4e9ZLuTAKqWW03F9'}


def voice_elevenlabs(voice_name='george', model='eleven_v3'):
    """One ElevenLabs request per segment; previous/next text keeps the delivery continuous across cuts."""
    import os, urllib.request, wave, imageio_ffmpeg
    key = os.environ.get('ELEVENLABS_API_KEY') or (KEY_FILE.read_text().strip() if KEY_FILE.exists() else '')
    if not key: sys.exit(f'No ElevenLabs key: set ELEVENLABS_API_KEY or put it in {KEY_FILE}')
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    (OUT / 'voice').mkdir(parents=True, exist_ok=True)
    vid = VOICES.get(voice_name, voice_name)
    durations = {}
    for i, seg in enumerate(SEGMENTS):
        req = {'text': seg['text'], 'model_id': model, 'voice_settings': {'stability': 0.5}}  # v3 'Natural'; [tags] steer delivery
        if model != 'eleven_v3':
            req.update(previous_text=SEGMENTS[i - 1]['text'] if i else None,
                       next_text=SEGMENTS[i + 1]['text'] if i + 1 < len(SEGMENTS) else None,
                       voice_settings={'stability': 0.32, 'similarity_boost': 0.75, 'style': 0.35, 'use_speaker_boost': True})
        body = json.dumps(req).encode()
        req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=mp3_44100_128',
                                     data=body, headers={'xi-api-key': key, 'Content-Type': 'application/json'})
        try:
            mp3 = urllib.request.urlopen(req, timeout=120).read()
        except urllib.error.HTTPError as e:
            sys.exit(f"ElevenLabs {e.code} on '{seg['id']}': {e.read()[:300].decode(errors='replace')}")
        src, dst = OUT / 'voice' / f"{seg['id']}.mp3", OUT / 'voice' / f"{seg['id']}.wav"
        src.write_bytes(mp3)
        subprocess.run([ff, '-y', '-loglevel', 'error', '-i', str(src), '-af', f'atempo={TEMPO}', '-ar', '48000', '-ac', '1', str(dst)], check=True)
        with wave.open(str(dst)) as w: durations[seg['id']] = w.getnframes() / w.getframerate()
        print(f"{seg['id']:9s} {durations[seg['id']]:5.1f}s")
    old = json.loads((OUT / 'durations.json').read_text()) if (OUT / 'durations.json').exists() else {}
    (OUT / 'durations.json').write_text(json.dumps({**old, **durations}, indent=1))
    print(f"total {sum(durations.values()) + GAP * len(SEGMENTS):.1f}s")


def sound():
    """Music bed and the jam hit, both generated with ElevenLabs (no third-party audio)."""
    import os, urllib.request
    key = os.environ.get('ELEVENLABS_API_KEY') or KEY_FILE.read_text().strip()
    def post(path, body, out):
        req = urllib.request.Request(f'https://api.elevenlabs.io{path}', data=json.dumps(body).encode(),
                                     headers={'xi-api-key': key, 'Content-Type': 'application/json'})
        try: (OUT / out).write_bytes(urllib.request.urlopen(req, timeout=300).read()); print('wrote', out)
        except urllib.error.HTTPError as e: print(f"{out}: ElevenLabs {e.code} {e.read()[:300].decode(errors='replace')}")
    post('/v1/sound-generation', {'text': 'Short burst of harsh radio static and a walkie-talkie signal cutting out, then silence',
                                  'duration_seconds': 2.5, 'prompt_influence': 0.5}, 'sfx_jam.mp3')
    post('/v1/music?output_format=mp3_44100_128', {
        'prompt': ('Instrumental underscore for a tech product demo. Calm, focused, hopeful. Soft felt piano and warm analog synth pads, '
                   'light pulsing electronic percussion that builds gently, around 95 bpm. Sits under a voice-over, no melody that competes '
                   'with speech. Gentle swell near the end, clean resolve.'),
        'music_length_ms': 120000, 'force_instrumental': True}, 'music.mp3')


def voice(ref=None):
    import torch, torchaudio as ta
    from chatterbox.tts import ChatterboxTTS
    (OUT / 'voice').mkdir(parents=True, exist_ok=True)
    model = ChatterboxTTS.from_pretrained(device='cuda' if torch.cuda.is_available() else 'cpu')
    pause = torch.zeros(1, int(model.sr * 0.22))
    durations = {}
    for seg in SEGMENTS:
        parts = []
        for s in split_sentences(seg['text']):
            wav = model.generate(s, audio_prompt_path=ref, exaggeration=0.42, cfg_weight=0.45, temperature=0.7)
            parts += [wav, pause]
        wav = torch.cat(parts[:-1], dim=1)
        ta.save(str(OUT / 'voice' / f"{seg['id']}.wav"), wav, model.sr)
        durations[seg['id']] = wav.shape[1] / model.sr
        print(f"{seg['id']:9s} {durations[seg['id']]:5.1f}s")
    old = json.loads((OUT / 'durations.json').read_text()) if (OUT / 'durations.json').exists() else {}
    (OUT / 'durations.json').write_text(json.dumps({**old, **durations}, indent=1))
    print(f"total {sum(durations.values()) + GAP * len(SEGMENTS):.1f}s")


async def record(url):
    from playwright.async_api import async_playwright
    durations = json.loads((OUT / 'durations.json').read_text())
    frames = OUT / 'frames'
    frames.mkdir(parents=True, exist_ok=True)
    for f in frames.glob('*.jpg'): f.unlink()
    log = []  # (path, wall timestamp)

    async with async_playwright() as p:
        # Installed Edge: no extra browser download (venue Wi-Fi is ~1 MB/s).
        browser = await p.chromium.launch(channel='msedge', args=['--ignore-gpu-blocklist', '--enable-gpu-rasterization'])
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=2)
        await page.add_init_script(CURSOR_JS)
        await page.goto(url)
        await page.add_style_tag(content=CARD_CSS)
        await page.wait_for_function('window.reliefGrid')
        await page.evaluate("document.fonts.ready")

        async def card(name):
            await page.evaluate("""html => { let c = document.getElementById('vcard');
              if (!c) { c = document.createElement('div'); c.id = 'vcard'; document.body.append(c); }
              c.innerHTML = html; requestAnimationFrame(() => c.classList.add('on')); }""", CARDS[name])

        async def uncard():
            await page.evaluate("""() => { const c = document.getElementById('vcard'); if (!c) return;
              c.classList.remove('on'); setTimeout(() => c.remove(), 600); }""")

        async def to(side, x, y):
            return await page.evaluate(f"window.reliefGrid.toClient('{side}', {x}, {y})")

        async def jam_base():
            b = await page.evaluate('window.reliefGrid.base()')
            x0, y0 = await to('ours', b['x'], b['y'])
            await page.mouse.move(x0 - 160, y0 + 90, steps=1)
            await page.mouse.move(x0, y0, steps=18)
            await page.mouse.down()
            for dx, dy in [(-2, -2), (2, -2), (2, 2), (-2, 2), (0, 0), (-3, 0), (3, 0), (0, -3), (0, 3), (0, 0)]:
                x, y = await to('ours', b['x'] + dx, b['y'] + dy)
                await page.mouse.move(x, y, steps=10)
                await asyncio.sleep(0.05)
            await page.mouse.up()

        async def hover_ours():
            b = await page.evaluate('window.reliefGrid.base()')
            x, y = await to('ours', b['x'] + 18, b['y'] + 6)
            await page.mouse.move(x, y, steps=25)

        async def cam(target, k=1.0, d=1.6):
            if target == 'off': x, y, k = 960, 540, 1.0
            elif target in ('ours', 'disp'):
                b = await page.locator(f'[data-side] canvas#{"mapOurs" if target == "ours" else "mapDisp"}').bounding_box()
                x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
            else:
                b = await page.locator(target).bounding_box()
                x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
            await page.evaluate(CAM_JS, [x, y, float(k), d])

        async def point(sel):
            box = await page.locator(sel).bounding_box()
            await page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, steps=20)

        async def click(sel):
            await point(sel); await asyncio.sleep(0.15); await page.mouse.down(); await asyncio.sleep(0.08); await page.mouse.up()

        actions = {
            'reset': lambda: page.keyboard.press('r'),
            'uncard': uncard,
            'run': lambda: page.evaluate("document.getElementById('btnPlay').click()"),
            'park': lambda: page.mouse.move(960, 1076, steps=20),
            'jam_base': jam_base,
            'hover_ours': hover_ours,
            'lifeline': lambda: click('#modeLife'),
            'point_doubles': lambda: point('#oDouble'),
            'open_sos': lambda: click('button[popovertarget="sosPanel"]'),
            'close_sos': lambda: page.evaluate("document.getElementById('sosPanel').hidePopover()"),
            'hq_off': lambda: click('#hqSwitch'),
            'hq_on': lambda: click('#hqSwitch'),
            'card_hq': lambda: card('hq'),
            'card_end': lambda: card('end'),
        }
        # Speed 1x (6 ticks/s) so the 90 s demo covers the whole story instead of finishing in 25 s.
        await page.evaluate("const s = document.getElementById('speed'); s.value = 1; s.dispatchEvent(new Event('input'))")
        await card('stat')
        await asyncio.sleep(0.8)

        cdp = await page.context.new_cdp_session(page)
        async def ack(sid):
            try: await cdp.send('Page.screencastFrameAck', {'sessionId': sid})
            except Exception: pass  # late ack after the browser closed
        def on_frame(ev):
            path = frames / f"{len(log):06d}.jpg"
            path.write_bytes(base64.b64decode(ev['data']))
            log.append((path.name, ev['metadata']['timestamp']))
            asyncio.ensure_future(ack(ev['sessionId']))
        cdp.on('Page.screencastFrame', on_frame)
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 92, 'maxWidth': 1920, 'maxHeight': 1080})
        while not log: await asyncio.sleep(0.02)
        t0 = log[0][1]

        starts = {}
        for seg in SEGMENTS:
            starts[seg['id']] = time.time() - t0
            if seg.get('card'): await card(seg['card'])
            if seg.get('chap'): await page.evaluate(CHAP_JS, seg['chap'])
            begin = time.time()
            for at, name in seg.get('do', []):
                dur = durations[seg['id']]
                at = float(at[:-1]) / 100 * dur if isinstance(at, str) else at
                await asyncio.sleep(max(0, begin + at - time.time()))
                if name.startswith('cam:'): await cam(*name[4:].rsplit(':', 1)) if name != 'cam:off' else await cam('off')
                elif name.startswith('chap:'): await page.evaluate(CHAP_JS, name[5:])
                else: await actions[name]()
            await asyncio.sleep(max(0, begin + durations[seg['id']] + GAP + seg.get('hold', 0) - time.time()))
            if seg.get('end'): await actions[seg['end']]()
            print(f"{seg['id']:9s} at {starts[seg['id']]:5.1f}s  {await page.evaluate('JSON.stringify(window.reliefGrid.snapshot())')}")
        await asyncio.sleep(1.5)
        await cdp.send('Page.stopScreencast')
        await browser.close()

    (OUT / 'timeline.json').write_text(json.dumps({'starts': starts, 'frames': log}, indent=0))
    span = log[-1][1] - t0
    print(f"{len(log)} frames over {span:.1f}s = {len(log) / span:.1f} fps")


def edit(music=True):
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    tl = json.loads((OUT / 'timeline.json').read_text())
    frames, starts = tl['frames'], tl['starts']
    # Frames arrive only when the page repaints, so each one is held until the next.
    lines = []
    for (name, ts), (_, nxt) in zip(frames, frames[1:] + [(None, frames[-1][1] + 0.04)]):
        lines += [f"file 'frames/{name}'", f"duration {max(0.001, nxt - ts):.4f}"]
    lines.append(f"file 'frames/{frames[-1][0]}'")
    (OUT / 'frames.txt').write_text('\n'.join(lines))
    total = frames[-1][1] - frames[0][1] + 0.04

    inputs, filters, mix = ['-f', 'concat', '-safe', '0', '-i', 'frames.txt'], [], []
    for i, seg in enumerate(SEGMENTS, start=1):
        inputs += ['-i', f"voice/{seg['id']}.wav"]
        ms = int(starts[seg['id']] * 1000) + 250
        filters.append(f"[{i}:a]aresample=48000,adelay={ms}|{ms},apad[v{i}]")
        mix.append(f"[v{i}]")
    n = len(SEGMENTS)
    filters.append(f"{''.join(mix)}amix=inputs={n}:normalize=0:duration=longest,atrim=0:{total:.2f}[voice0]")
    jam_hit = (OUT / 'sfx_jam.mp3').exists() and 'jam' in starts
    if jam_hit:
        inputs += ['-i', 'sfx_jam.mp3']; ms = int(starts['jam'] * 1000) + 900
        filters.append(f"[{n + 1}:a]aresample=48000,volume=0.55,adelay={ms}|{ms},apad[sfx]")
        filters.append("[voice0][sfx]amix=inputs=2:normalize=0:duration=first[voice]")
    else:
        filters.append("[voice0]anull[voice]")
    if music and (OUT / 'music.mp3').exists():
        k = inputs.count('-i')  # index the music input will get
        inputs += ['-i', 'music.mp3']
        filters.append(f"[{k}:a]aresample=48000,atrim=0:{total:.2f},volume=0.32,afade=t=in:d=1.5,afade=t=out:st={total - 4:.2f}:d=4,"
                       "aformat=channel_layouts=stereo[pad]")
        filters.append("[voice]pan=stereo|c0=c0|c1=c0,asplit=2[vs][vs2]")
        filters.append("[pad][vs]sidechaincompress=threshold=0.04:ratio=5:attack=15:release=500[duck]")
        filters.append("[duck][vs2]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5[a]")
    elif music:
        # A quiet A-minor pad under the voice, synthesised here (no third-party music).
        chord = '+'.join(f"{a}*sin(2*PI*{f}*t)" for a, f in [(0.2, 110), (0.13, 164.81), (0.12, 220), (0.08, 261.63), (0.06, 329.63)])
        filters.append(f"aevalsrc='({chord})*(0.75+0.25*sin(2*PI*0.06*t))':s=48000:d={total:.2f},lowpass=f=700,"
                       f"aecho=0.8:0.6:180|360:0.25|0.15,volume=0.22,afade=t=in:d=3,afade=t=out:st={total - 4:.2f}:d=4,"
                       f"pan=stereo|c0=c0|c1=c0[pad]")
        filters.append("[voice]pan=stereo|c0=c0|c1=c0,asplit=2[vs][vs2]")  # one copy keys the ducking, one is heard
        filters.append("[pad][vs]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]")
        filters.append("[duck][vs2]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5[a]")
    else:
        filters.append("[voice]pan=stereo|c0=c0|c1=c0,loudnorm=I=-16:TP=-1.5[a]")
    filters.append(f"[0:v]fps=30,format=yuv420p,fade=t=in:d=0.6,fade=t=out:st={total - 1:.2f}:d=1[v]")
    cmd = [ff, '-y', *inputs, '-filter_complex', ';'.join(filters), '-map', '[v]', '-map', '[a]',
           '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-c:a', 'aac', '-b:a', '192k',
           '-movflags', '+faststart', '-t', f"{total:.2f}", 'relief-grid-pitch.mp4']
    subprocess.run(cmd, cwd=OUT, check=True)
    print(f"wrote {OUT / 'relief-grid-pitch.mp4'} ({total:.1f}s)")


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('step', choices=['voice', 'sound', 'record', 'edit'])
    ap.add_argument('--engine', choices=['elevenlabs', 'chatterbox'], default='elevenlabs')
    ap.add_argument('--voice', default='george', help='ElevenLabs voice: george, chris, roger, will, brian, daniel, or a voice id')
    ap.add_argument('--ref', help='Chatterbox only: reference clip to set the voice (your own voice, with consent)')
    ap.add_argument('--url', default='http://localhost:8000/')
    ap.add_argument('--no-music', action='store_true')
    ap.add_argument('--only', help='comma-separated segment ids, e.g. hook,title,intro,jam for a starter clip')
    a = ap.parse_args()
    if a.only:
        keep = a.only.split(',')
        SEGMENTS[:] = [s for s in SEGMENTS if s['id'] in keep]
    if a.step == 'sound': sound()
    elif a.step == 'voice': voice_elevenlabs(a.voice) if a.engine == 'elevenlabs' else voice(a.ref)
    elif a.step == 'record': asyncio.run(record(a.url))
    else: edit(not a.no_music)
