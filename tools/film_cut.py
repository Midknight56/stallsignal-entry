"""Cut the StallSignal film from the tour recordings (tools/film_tour.mjs).

    python tools/film_cut.py          the film, from a live take
    python tools/film_cut.py --dry    a test cut of a local take (no live model needed)

Reads tools/out/video/tour.webm (the maker's browser), tour-buyer.webm (a separate buyer's browser) and
tour-times.json. Writes tools/out/video/stallsignal-film.mp4 and film-cut.json.

Only real footage. Segments are trimmed, some are shown closer (a crop of the same frame), a few waits are sped up
and say so on screen, and one beat holds a before and an after frame side by side. Captions are burned in. The music
bed is made here from sine tones and noise (original, no samples). A spoken line track sits over it: the takes come
from docs/film-voice (private), each tied to a scene, and the music dips under each line.
"""
import json
import math
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
VIDEO = ROOT / "tools" / "out" / "video"
SOURCES = ["tour.webm", "tour-buyer.webm"]
DRY = "--dry" in sys.argv  # a test cut of a local recording; never the film
OUT = VIDEO / ("stallsignal-film-dry.mp4" if DRY else "stallsignal-film.mp4")
FPS = 30
RATE = 48000
W, H = 1920, 1080
TARGET = (165.0, 175.0)  # about 2:50, always under 3:00
FONT = "C\\:/Windows/Fonts/seguisb.ttf"
# Shown as real money: no caption may name the test setup (the owner's rule, 9 Nov 2026).
SHOWCASE = re.compile(r"sandbox|test card|test money|test order|pretend|example|fake|for this demo", re.I)
VOICE_DIR = VIDEO / "voice"
VOICE_SCRIPT = ROOT / "docs" / "film-voice" / "script.json"

data = json.loads((VIDEO / "tour-times.json").read_text(encoding="utf-8"))
m = data["marks"]  # maker marks, seconds from the maker video's first frame
b = data.get("buyer", {})  # buyer marks, seconds from the buyer video's first frame
box = data.get("boxes", {})  # name -> [x, y, w, h] in video pixels, read in the tour
src = data.get("sources", {})

for key in ("agent",):
    if src.get(key) != "Live AI" and not DRY:
        sys.exit(f"The {key} answer came from '{src.get(key)}', not the live model. Clear the cache and record again.")
for key in ("budget", "stock"):
    if not src.get(key) and not DRY:
        sys.exit(f"The tour did not read '{key}'. Record again.")

# Each item: dict(kind=seg|hold|pair, ...). Captions are (offset, length, text) from the item's own start.
S = []


def fit(rect, aspect):
    """Grow a rectangle around its centre to the given width/height ratio, inside the frame."""
    if not rect:
        return None
    x, y, w, h = rect
    pad = 40
    x, y, w, h = x - pad, y - pad, w + 2 * pad, h + 2 * pad
    if w / h < aspect:
        nw = h * aspect
        x -= (nw - w) / 2
        w = nw
    else:
        nh = w / aspect
        y -= (nh - h) / 2
        h = nh
    if w > W:
        w, h = W, W / aspect
    if h > H:
        w, h = H * aspect, H
    x = min(max(0, x), W - w)
    y = min(max(0, y), H - h)
    return [int(x) // 2 * 2, int(y) // 2 * 2, int(w) // 2 * 2, int(h) // 2 * 2]


def seg(a, z, speed=1.0, caps=(), source=0, crop=None, voice=()):
    S.append(dict(kind="seg", src=source, a=a, b=z, speed=speed, caps=list(caps), voice=list(voice),
                  crop=fit(box.get(crop), W / H) if crop else None))


def hold(a, length, caps=(), source=0, crop=None, voice=()):
    S.append(dict(kind="hold", src=source, a=a, b=length, speed=1.0, caps=list(caps), voice=list(voice),
                  crop=fit(box.get(crop), W / H) if crop else None))


def pair(left, right, length, caps=(), voice=()):
    """Two still frames side by side: left=(source, time, box name), right likewise."""
    S.append(dict(kind="pair", src=0, a=left[1], b=length, speed=1.0, caps=list(caps), voice=list(voice), left=left, right=right))


def need(*keys, marks=m):
    missing = [k for k in keys if k not in marks]
    if missing:
        sys.exit(f"Tour marks missing: {missing}. Record again.")


need("map", "sweep_start", "sweep_end", "decision", "budget_set", "agent_click", "agent_answer", "agent_stock", "agent_done",
     "changes_before", "share", "maker_units", "changes_after", "decision_after", "close_click", "refund_rows", "refunded",
     "proof", "proof_held", "studio", "studio_select", "studio_ask", "studio_chart", "scorecard", "end")
need("open", "choose", "pay_click", "paid", "paid_done", marks=b)

budget = src.get("budget", "$450")
stock = src.get("stock", "")
WORDS = {1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine"}
n_seeded = int(src.get("seeded", 0))
seeded_line = (f"{WORDS.get(n_seeded, n_seeded)} earlier order{'s' if n_seeded != 1 else ''} came first."
               if n_seeded else "This was the first paid order.")
# 0:00 to 0:12. The maker, the decision, the venues.
seg(m["map"], m["sweep_start"], 1.0, [
    (0.3, 4.6, "A small candle maker picks one popup weekend."),
    (5.2, 5.4, "Three popups. One weekend. Which one wins?"),
], voice=[(0.3, "v01")])
# 0:12 to 0:27. Forecast against paid demand, close enough to read.
seg(m["sweep_start"], m["sweep_end"], 1.0, [(0.2, 4.2, "Left: the forecast. Right: paid preorders.")], voice=[(0.2, "v02")])
seg(m["decision"], m["decision"] + 9.0, 1.0, [
    (0.3, 4.4, "Paid demand points to another venue."),
    (4.9, 3.9, "The difference is an estimate, not money saved."),
], crop="decision", voice=[(0.3, "v03")])
# 0:27 to 0:44. Budget $450, ask the agent, source, steps, stock under budget.
seg(m["budget_set"], m["agent_click"], 1.0, [(0.2, 2.6, f"Stock budget {budget}.")], voice=[(0.3, "v04")])
seg(m["agent_click"], m["agent_answer"], 2.5, [(0.2, 2.4, "The agent calls its tools.")], voice=[(0.1, "v05")])
seg(m["agent_answer"], m["agent_stock"], 1.0, [(0.3, 4.4, "The source and each step it took.")], crop="agent",
    voice=[(0.3, "v06")])
seg(m["agent_stock"], m["agent_done"], 1.0, [
    (0.2, 4.4, f"Stock {stock} fits the {budget} budget." if stock else "The stock plan fits the budget."),
], crop="stock", voice=[(0.3, "v07")])
# 0:44 to 1:04. The shared link opens in a separate buyer's browser.
seg(m["changes_before"], m["changes_before"] + 4.0, 1.0, [(0.3, 3.6, "At $900, this campaign only: what flips the pick.")], crop="changes",
    voice=[(0.2, "v08")])
seg(m["share"], m["share"] + 3.5, 1.0, [(0.3, 3.1, "The maker shares a buyer link.")])
seg(b["open"], b["pay_click"], 1.0, [
    (0.3, 4.0, "A separate buyer opens it."),
    (4.6, 4.4, "Refund in full if this venue is not chosen."),
], source=1, voice=[(0.3, "v09")])
seg(b["pay_click"], b["paid"], 2.0, [(0.2, 2.6, "Pay by card. No login.")], source=1)
# 1:04 to 1:17. Paid, amount, order id, capture id. Then the maker sees the units.
seg(b["paid"], b["paid_done"], 1.0, [(0.3, 5.0, "Paid. PayPal order id and capture id.")], source=1, crop="receipt", voice=[(0.1, "v10")])
seg(m["maker_units"], m["maker_units"] + 5.0, 1.0, [(1.5, 3.4, "The maker sees the buyer's units arrive.")],
    voice=[(1.5, "v11")])
# 1:17 to 1:32. The payment crosses the threshold shown before. Earlier orders are labelled.
pair((0, m["changes_before"] + 1.5, "changes"), (0, m["changes_after"] + 1.5, "changes_after"), 7.5, [
    (0.3, 3.4, "Before and after this one payment."),
    (3.9, 3.4, seeded_line),
], voice=[(0.3, "v12")])
seg(m["decision_after"], m["decision_after"] + 6.0, 1.0, [(0.3, 5.4, "Paid demand changed the pick.")], crop="decision_after", voice=[(0.3, "v13")])
# 1:32 to 1:54. Close, each losing payment refunded, liability to zero. Waiting is sped up.
seg(m["close_click"] - 2.0, m["refund_rows"], 1.0, [(0.2, 3.6, "The maker chooses a venue and closes.")],
    voice=[(0.3, "v14")])
# The refund wait is sped up with no caption; both refund captions sit on the finished rows at normal speed, long
# enough to read. The live sandbox cannot hold a refund pending, so the film makes no claim about pending refunds.
seg(m["refund_rows"], m["refunded"], 3.0, [])
seg(m["refunded"], m["refunded"] + 9.0, 1.0, [
    (0.3, 4.2, "Each losing payment gets its own refund."),
    (4.8, 3.8, "Refund ids from PayPal. Nothing owed."),
], crop="refunds", voice=[(0.3, "v15")])
# 1:54 to 2:08. The Proof page: the payment guards run in the browser.
seg(m["proof"], max(m["proof_held"] + 4.5, m["proof"] + 13.6), 1.0, [
    (0.5, 5.4, "Proof runs our payment code in your browser."),
    (6.4, 3.6, "Six guards hold."),
], voice=[(0.5, "v16")])
# 2:08 to 2:27. Studio: linked widgets, then the new chart itself.
seg(m["studio"], m["studio_ask"], 1.0, [(0.6, 4.6, "AG Studio. Pick a venue and the widgets follow.")], voice=[(0.6, "v17")])
seg(m["studio_ask"], m["studio_chart"], 1.0, [(0.2, 3.0, "Ask for a chart in plain words.")], voice=[(0.2, "v18")])
seg(m["studio_chart"], m["studio_chart"] + 7.0, 1.0, [(0.4, 5.6, "The new chart: refunds per venue.")], crop="chart",
    voice=[(0.4, "v19")])
# 2:27 to 2:42. The corrected scorecard.
seg(m["scorecard"], m["scorecard"] + 13.0, 1.0, [
    (0.4, 4.6, "Forecast pick, paid pick, chosen venue."),
    (5.4, 4.0, "Outcome not measured. No savings claimed."),
], crop="scorecard", voice=[(0.4, "v20")])
# 2:42 to 2:50. The name, the line, the address.
seg(m["end"], m["end"] + 4.0, 1.0, [], voice=[(0.3, "v21")])
hold(m["end"] + 4.0, 4.5, [(0.0, 4.5, "stallsignal.midknight-labs.workers.dev. No login.")])


def length(s):
    return s["b"] if s["kind"] in ("hold", "pair") else (s["b"] - s["a"]) / s["speed"]


total = sum(length(s) for s in S)
if total < TARGET[0]:
    S[-1]["b"] += TARGET[0] + 2.0 - total
    total = sum(length(s) for s in S)
if not TARGET[0] <= total <= TARGET[1]:
    sys.exit(f"The cut is {total:.1f} s, outside {TARGET}. Change the holds in film_tour.mjs.")

starts = []
acc = 0.0
for s in S:
    starts.append(acc)
    acc += length(s)


def film_time(source, t):
    for s, st in zip(S, starts):
        if s["kind"] == "seg" and s["src"] == source and s["a"] <= t <= s["b"]:
            return st + (t - s["a"]) / s["speed"]
    return None


cap_dir = VIDEO / "captions"
cap_dir.mkdir(exist_ok=True)
for old in cap_dir.glob("*.txt"):
    old.unlink()
cues = []
for s, st in zip(S, starts):
    for off, ln, text in s["caps"]:
        if re.search(r"\w[-–—]\w|—|–", text) and "midknight-labs" not in text:
            sys.exit(f"Caption has a dash: {text}")
        if SHOWCASE.search(text):
            sys.exit(f"Caption names the test setup: {text}")
        if len(text) > 56:
            sys.exit(f"Caption too long ({len(text)}): {text}")
        a = st + off
        z = min(a + ln, st + length(s))
        cues.append((round(a, 2), round(z, 2), text))
cues.sort()
for (a, z, _), (c, _, text) in zip(cues, cues[1:]):
    if c < z:
        sys.exit(f"Captions overlap at {c:.2f}: {text}")
# A visible notice over every sped up stretch.
fast = [(round(st, 2), round(st + length(s), 2), s["speed"]) for s, st in zip(S, starts) if s["kind"] == "seg" and s["speed"] > 1]


def take(ident):
    """The newest take of a line, with the silence at both ends cut, as mono samples at RATE."""
    takes = sorted(VOICE_DIR.glob(f"{ident}-take*.mp3"), key=lambda f: int(re.search(r"take(\d+)", f.name).group(1)))
    if not takes:
        return None, None
    trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05"
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(takes[-1]), "-af", f"{trim},areverse,{trim},areverse",
         "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0, takes[-1].name


script = {l["id"]: l["text"] for l in json.loads(VOICE_SCRIPT.read_text(encoding="utf-8"))["lines"]} if VOICE_SCRIPT.exists() else {}
spoken = []  # (start, end, id, text, take file, samples)
for s, st in zip(S, starts):
    for off, ident in s.get("voice", []):
        if ident not in script:
            sys.exit(f"Voice line {ident} is not in {VOICE_SCRIPT}")
        if SHOWCASE.search(script[ident]):
            sys.exit(f"Voice line names the test setup: {script[ident]}")
        samples, name = take(ident)
        if samples is None:
            if DRY:
                continue
            sys.exit(f"No take for voice line {ident}. Run docs/film-voice/film_voice.py say {ident}")
        a = st + off
        spoken.append((round(a, 2), round(a + len(samples) / RATE, 2), ident, script[ident], name, samples))
spoken.sort(key=lambda v: v[0])
for (a, z, ident, *_), nxt in zip(spoken, spoken[1:] + [(total, None, "the end")]):
    if z + 0.1 > nxt[0]:
        sys.exit(f"Voice {ident} runs to {z:.2f} s, into {nxt[2]} at {nxt[0]:.2f} s. Move it or shorten it.")

parts = []
labels = []


def view(crop):
    if not crop:
        return ""
    x, y, w, h = crop
    return f",crop={w}:{h}:{x}:{y},scale={W}:{H}:flags=lanczos"


for i, s in enumerate(S):
    inp = f"[{s['src']}:v]"
    if s["kind"] == "hold":
        parts.append(
            f"{inp}trim=start={s['a']:.3f}:end={s['a'] + 0.2:.3f},setpts=PTS-STARTPTS,fps={FPS}{view(s['crop'])},"
            f"tpad=stop_mode=clone:stop_duration={s['b']:.3f},trim=duration={s['b']:.3f},setpts=PTS-STARTPTS,setsar=1[v{i}]"
        )
    elif s["kind"] == "pair":
        halves = []
        for side, (source, t, name) in (("l", s["left"]), ("r", s["right"])):
            c = fit(box.get(name), (W / 2) / H)
            crop = f",crop={c[2]}:{c[3]}:{c[0]}:{c[1]}" if c else ""
            parts.append(
                f"[{source}:v]trim=start={t:.3f}:end={t + 0.2:.3f},setpts=PTS-STARTPTS,fps={FPS}{crop},"
                f"scale={W // 2}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,"
                f"pad={W // 2}:{H}:(ow-iw)/2:(oh-ih)/2:color=0xF6F1E7,"
                f"tpad=stop_mode=clone:stop_duration={s['b']:.3f},trim=duration={s['b']:.3f},setpts=PTS-STARTPTS[p{i}{side}]"
            )
            halves.append(f"[p{i}{side}]")
        parts.append(f"{''.join(halves)}hstack=inputs=2,drawbox=x={W // 2 - 2}:y=0:w=4:h={H}:color=0x13263F:t=fill,setsar=1[v{i}]")
    else:
        parts.append(
            f"{inp}trim=start={s['a']:.3f}:end={s['b']:.3f},setpts=(PTS-STARTPTS)/{s['speed']},fps={FPS}{view(s['crop'])},setsar=1[v{i}]"
        )
    labels.append(f"[v{i}]")
parts.append(f"{''.join(labels)}concat=n={len(S)}:v=1:a=0[cat]")
draw = []
for n, (a, z, text) in enumerate(cues):
    f = cap_dir / f"c{n:02d}.txt"
    f.write_text(text, encoding="utf-8")
    draw.append(
        f"drawtext=fontfile='{FONT}':textfile='captions/c{n:02d}.txt':fontsize=50:fontcolor=white:"
        f"box=1:boxcolor=0x13263F@0.88:boxborderw=26:x=(w-text_w)/2:y=h-text_h-110:"
        f"alpha='if(lt(t,{a}+0.25),(t-{a})/0.25,if(gt(t,{z}-0.25),({z}-t)/0.25,1))':enable='between(t,{a},{z})'"
    )
for k, (a, z, speed) in enumerate(fast):
    f = cap_dir / f"f{k:02d}.txt"
    f.write_text(f"Sped up {speed:g}x", encoding="utf-8")
    draw.append(
        f"drawtext=fontfile='{FONT}':textfile='captions/f{k:02d}.txt':fontsize=34:fontcolor=white:"
        f"box=1:boxcolor=0xE2572B@0.92:boxborderw=14:x=w-text_w-60:y=60:enable='between(t,{a},{z})'"
    )
draw.append(f"fade=t=in:st=0:d=0.6,fade=t=out:st={total - 0.6:.2f}:d=0.6,format=yuv420p")
parts.append("[cat]" + ",".join(draw) + "[v]")
(VIDEO / "film-graph.txt").write_text(";\n".join(parts), encoding="utf-8")

# Music: 100 BPM in A major, soft bells over a pad, felt bass and a light shaker. Made here, no samples.
n = int(total * RATE) + RATE
L = np.zeros(n)
R = np.zeros(n)
rng = np.random.default_rng(19)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def put(sig, at, pan=0.0, gain=1.0):
    i = int(at * RATE)
    j = min(n, i + len(sig))
    if i >= n or j <= i:
        return
    L[i:j] += sig[: j - i] * gain * math.cos((pan + 1) * math.pi / 4)
    R[i:j] += sig[: j - i] * gain * math.sin((pan + 1) * math.pi / 4)


def bell(midi, dur=1.6):
    tt = np.arange(int(dur * RATE)) / RATE
    f = hz(midi)
    s = np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt * 6) + 0.12 * np.sin(2 * np.pi * f * 5.4 * tt) * np.exp(-tt * 10)
    env = np.minimum(1, tt / 0.004) * np.exp(-tt * 3.2)
    return s * env


def pad(chord, dur):
    tt = np.arange(int(dur * RATE)) / RATE
    s = sum(np.sin(2 * np.pi * hz(c) * tt) + 0.5 * np.sin(2 * np.pi * hz(c) * 1.003 * tt) for c in chord)
    env = np.minimum(1, tt / 0.9) * np.minimum(1, (dur - tt) / 0.9)
    return s * env / len(chord)


def bass(midi, dur):
    tt = np.arange(int(dur * RATE)) / RATE
    return (np.sin(2 * np.pi * hz(midi) * tt) + 0.2 * np.sin(4 * np.pi * hz(midi) * tt)) * np.minimum(1, tt / 0.01) * np.exp(-tt * 2.2)


def shaker(dur=0.09):
    tt = np.arange(int(dur * RATE)) / RATE
    noise = rng.standard_normal(len(tt))
    noise = np.diff(noise, prepend=0)
    return noise * np.exp(-tt * 45)


def tick(f=1320.0):
    tt = np.arange(int(0.12 * RATE)) / RATE
    return np.sin(2 * np.pi * f * tt) * np.exp(-tt * 38) + 0.4 * np.sin(2 * np.pi * f * 1.5 * tt) * np.exp(-tt * 55)


BEAT = 60 / 100
BAR = BEAT * 4
CHORDS = [[57, 61, 64], [54, 57, 61], [50, 54, 57], [52, 56, 59]]  # A, F#m, D, E
ARP = [0, 1, 2, 1, 2, 0, 2, 1]
bars = int(total / BAR) + 1
for k_bar in range(bars):
    at = k_bar * BAR
    chord = CHORDS[k_bar % 4]
    put(pad([c + 12 for c in chord], BAR + 0.9), at, 0.0, 0.05)
    if at >= 3.0:
        put(bass(chord[0] - 12, BAR * 0.9), at, 0.0, 0.16)
        put(bass(chord[0] - 12, BAR * 0.45), at + 2 * BEAT, 0.0, 0.10)
    if 3.0 <= at < total - BAR * 2:
        for k, step in enumerate(ARP):
            if (k_bar % 2 == 1 and k in (3, 7)) or (k_bar % 8 >= 6 and k % 2 == 1):
                continue
            put(bell(chord[step] + 24), at + k * BEAT / 2, -0.4 if k % 2 else 0.4, 0.045)
    if 20.0 <= at < total - BAR * 2:
        for k in range(8):
            put(shaker(), at + k * BEAT / 2 + BEAT / 4, 0.25, 0.012 if k % 2 else 0.007)
for source, marks, keys in ((0, m, ("agent_click", "close_click", "studio_select", "studio_ask")), (1, b, ("pay_click",))):
    for key in keys:
        ft = film_time(source, marks.get(key, -1)) if key in marks else None
        if ft is not None:
            put(tick(), ft, 0.1, 0.05)
for source, marks, keys in ((1, b, ("paid",)), (0, m, ("refunded", "proof_held"))):
    for key in keys:
        ft = film_time(source, marks.get(key, -1)) if key in marks else None
        if ft is not None:
            put(bell(81, 1.2) + bell(85, 1.2), ft, 0.0, 0.03)
mix = np.stack([L, R], axis=1)[: int(total * RATE)]
fade_in = np.minimum(1, np.arange(len(mix)) / (RATE * 1.0))
fade_out = np.minimum(1, (len(mix) - np.arange(len(mix))) / (RATE * 2.5))
mix *= (fade_in * fade_out)[:, None]
mix = mix / np.max(np.abs(mix)) * 0.7
# The spoken lines go on top. The music dips to a third under each line, with soft 0.25 s ramps.
voice = np.zeros(len(mix))
duck = np.ones(len(mix))
for a, z, *_rest, samples in spoken:
    i = int(a * RATE)
    j = min(len(voice), i + len(samples))
    voice[i:j] += samples[: j - i]
    duck[max(0, i - int(0.25 * RATE)): min(len(duck), j + int(0.35 * RATE))] = 0.32
if spoken:
    k = int(0.25 * RATE)
    c = np.concatenate([[0.0], np.cumsum(np.pad(duck, (k // 2, k - k // 2), mode="edge"))])
    duck = (c[k:] - c[:-k])[: len(duck)] / k  # a running average: soft ramps in and out
    voice = voice / max(1e-9, np.max(np.abs(voice))) * 0.9
    mix = mix * duck[:, None] + voice[:, None]
    mix = mix / np.max(np.abs(mix)) * 0.9
music = VIDEO / "music.wav"
with wave.open(str(music), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes((mix * 32767).astype("<i2").tobytes())

cmd = ["ffmpeg", "-loglevel", "error", "-y"]
for name in SOURCES:
    cmd += ["-i", name]
cmd += [
    "-i", music.name,
    "-/filter_complex", "film-graph.txt",
    "-filter:a", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-map", "[v]", "-map", f"{len(SOURCES)}:a",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-r", str(FPS),
    "-c:a", "aac", "-b:a", "192k", "-ar", str(RATE), "-t", f"{total:.2f}", "-movflags", "+faststart", OUT.name,
]
subprocess.run(cmd, cwd=VIDEO, check=True)
probe = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(OUT)],
    capture_output=True, text=True, check=True,
)
dur = float(probe.stdout.strip())
(VIDEO / "film-cut.json").write_text(
    json.dumps({"duration": dur, "segments": [{k: v for k, v in s.items() if k != "caps"} for s in S], "captions": cues, "sped_up": fast,
                "voice": [{"start": a, "end": z, "id": i, "text": t, "take": f} for a, z, i, t, f, _ in spoken]}, indent=1) + "\n",
    encoding="utf-8",
)
print(f"film: {OUT}  {dur:.2f} s  {len(cues)} captions  {len(spoken)} voice lines")
if not TARGET[0] <= dur <= TARGET[1]:
    sys.exit(f"Film length {dur:.2f} s is outside {TARGET}.")
