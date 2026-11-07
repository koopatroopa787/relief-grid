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

# ── The story. `do` lists (seconds into the segment, action); actions are defined in record(). ──
SEGMENTS = [
    dict(id='hook', card='stat', text=(
        "In 2017, Hurricane Maria knocked out ninety-six percent of Puerto Rico's cell sites. "
        "Aid that waits for a dispatcher's call stops, when the radio stops.")),
    dict(id='title', card='title', text=(
        "This is Relief Grid. Aid vans that keep delivering with no network, and never serve the same home twice.")),
    dict(id='intro', do=[(0, 'reset'), (0.3, 'uncard')], text=(
        "Same flooded city. Same six vans. Same hundred and twenty homes, shown twice. "
        "On the left, there is no dispatcher. Every van decides for itself, and shares what it knows when another van is in range. "
        "On the right, the usual way: one dispatcher on a radio tower, assigning every delivery."), end='run'),
    dict(id='jam', do=[(0.2, 'jam_base'), (9.5, 'hover_ours')], text=(
        "Now, let's jam the tower. "
        "The dispatcher is cut off. Its vans stop, waiting for orders that never arrive. Ours keep going. "
        "Every van runs the same hash over each home and the vans it knows are alive, so they all agree who owns it, "
        "without sending a single message. A van only serves the homes it owns. So no home is ever served twice.")),
    dict(id='lifeline', do=[(0.4, 'lifeline'), (6.5, 'point_doubles')], text=(
        "If a van goes silent, is it broken, or just out of range? Safe mode waits, so a home is never served twice. "
        "Lifeline hands its homes to the others. Faster coverage, and every double serve is counted, right here. "
        "The operator picks the trade-off.")),
    dict(id='sos', do=[(0.3, 'open_sos')], text=(
        "Families can also leave a voice message, in their own language. "
        "Vans carry it from van to van, until one reaches base.")),
    dict(id='hq', do=[(0, 'card_hq')], text=(
        "There, an n-eight-n workflow transcribes it with ElevenLabs Scribe, has Claude triage what they need and how urgent it is, "
        "and records a spoken reply with ElevenLabs, which rides back out on the next van.")),
    dict(id='killhq', do=[(0, 'uncard'), (1.2, 'hq_off'), (6.2, 'hq_on')], text=(
        "And if HQ goes down? The field doesn't notice. Vans keep the messages, and retry. "
        "When HQ is back, the backlog clears.")),
    dict(id='close', do=[(0.2, 'close_sos'), (0.4, 'card_end')], text=(
        "No dispatcher. No network. Nobody served twice. Relief Grid. Judge, jam it.")),
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
"""
CARDS = {
    'stat': """<div class="sheet-v"><div class="row"><span class="tag">[01] Hurricane Maria · Puerto Rico · 2017</span><span class="tag">Source: FCC status report, 21 Sep 2017</span></div>
      <div style="display:grid;grid-template-columns:auto 1fr;align-items:end"><div class="big">96%</div>
      <p class="lede">of cell sites out of service. Aid that waits for a dispatcher's call <span class="hl">stops</span> when the radio stops.</p></div>
      <div class="row"><span class="tag">Relief Grid</span><span class="tag">GreatUniHack 2026 · Neptune North</span></div></div>""",
    'title': """<div class="sheet-v"><div class="row"><span class="tag">[02] The project</span><span class="tag">Built in six hours</span></div>
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
      <div class="row"><span class="tag">Kanishk · Akshita · Darryll</span><span class="tag">Judge, jam it.</span></div></div>""",
}

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
    (OUT / 'durations.json').write_text(json.dumps(durations, indent=1))
    print(f"total {sum(durations.values()) + GAP * len(SEGMENTS):.1f}s")


async def record(url):
    from playwright.async_api import async_playwright
    durations = json.loads((OUT / 'durations.json').read_text())
    frames = OUT / 'frames'
    frames.mkdir(parents=True, exist_ok=True)
    for f in frames.glob('*.jpg'): f.unlink()
    log = []  # (path, wall timestamp)

    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--ignore-gpu-blocklist', '--enable-gpu-rasterization'])
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
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

        async def point(sel):
            box = await page.locator(sel).bounding_box()
            await page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, steps=20)

        async def click(sel):
            await point(sel); await asyncio.sleep(0.15); await page.mouse.down(); await asyncio.sleep(0.08); await page.mouse.up()

        actions = {
            'reset': lambda: page.keyboard.press('r'),
            'uncard': uncard,
            'run': lambda: click('#btnPlay'),
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
        def on_frame(ev):
            path = frames / f"{len(log):06d}.jpg"
            path.write_bytes(base64.b64decode(ev['data']))
            log.append((path.name, ev['metadata']['timestamp']))
            asyncio.ensure_future(cdp.send('Page.screencastFrameAck', {'sessionId': ev['sessionId']}))
        cdp.on('Page.screencastFrame', on_frame)
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 92, 'maxWidth': 1920, 'maxHeight': 1080})
        while not log: await asyncio.sleep(0.02)
        t0 = log[0][1]

        starts = {}
        for seg in SEGMENTS:
            starts[seg['id']] = time.time() - t0
            if seg.get('card'): await card(seg['card'])
            begin = time.time()
            for at, name in seg.get('do', []):
                await asyncio.sleep(max(0, begin + at - time.time()))
                await actions[name]()
            await asyncio.sleep(max(0, begin + durations[seg['id']] + GAP - time.time()))
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
    filters.append(f"{''.join(mix)}amix=inputs={n}:normalize=0:duration=longest,atrim=0:{total:.2f}[voice]")
    if music:
        # A quiet A-minor pad under the voice, synthesised here (no third-party music).
        chord = '+'.join(f"{a}*sin(2*PI*{f}*t)" for a, f in [(0.2, 110), (0.13, 164.81), (0.12, 220), (0.08, 261.63), (0.06, 329.63)])
        filters.append(f"aevalsrc='({chord})*(0.75+0.25*sin(2*PI*0.06*t))':s=48000:d={total:.2f},lowpass=f=700,"
                       f"aecho=0.8:0.6:180|360:0.25|0.15,volume=0.22,afade=t=in:d=3,afade=t=out:st={total - 4:.2f}:d=4,"
                       f"pan=stereo|c0=c0|c1=c0[pad]")
        filters.append("[voice]pan=stereo|c0=c0|c1=c0[vs]")
        filters.append("[pad][vs]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]")
        filters.append("[duck][vs]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5[a]")
    else:
        filters.append("[voice]pan=stereo|c0=c0|c1=c0,loudnorm=I=-16:TP=-1.5[a]")
    filters.append(f"[0:v]fps=30,format=yuv420p,fade=t=in:d=0.6,fade=t=out:st={total - 1:.2f}:d=1[v]")
    cmd = [ff, '-y', *inputs, '-filter_complex', ';'.join(filters), '-map', '[v]', '-map', '[a]',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-c:a', 'aac', '-b:a', '192k',
           '-movflags', '+faststart', '-t', f"{total:.2f}", 'relief-grid-pitch.mp4']
    subprocess.run(cmd, cwd=OUT, check=True)
    print(f"wrote {OUT / 'relief-grid-pitch.mp4'} ({total:.1f}s)")


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('step', choices=['voice', 'record', 'edit'])
    ap.add_argument('--ref', help='optional reference clip to set the voice (your own voice, with consent)')
    ap.add_argument('--url', default='http://localhost:8000/')
    ap.add_argument('--no-music', action='store_true')
    a = ap.parse_args()
    if a.step == 'voice': voice(a.ref)
    elif a.step == 'record': asyncio.run(record(a.url))
    else: edit(not a.no_music)
