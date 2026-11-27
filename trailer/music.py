"""Original 140 BPM trap/EDM track for the BharatCiv trailer, synthesised from scratch.
Writes trailer/out/music.wav and trailer/out/beats.json (exact hit times for the edit)."""
import json, os
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 44100
BPM = 140
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4                 # 16th note
BARS = 28
TAIL = 2.5
N = int((BARS * BAR + TAIL) * SR)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

# sections (bars)
INTRO, BUILD, DROP1, BREAK, DROP2, OUTRO = (0, 4), (4, 8), (8, 16), (16, 18), (18, 26), (26, 28)


def t_of(bar, step=0.0):
    return bar * BAR + step * STEP


def note(n):
    names = {'C': 0, 'Db': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'Gb': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}
    name, octv = n[:-1], int(n[-1])
    return 440 * 2 ** ((names[name] + 12 * (octv + 1) - 69) / 12)


def filt(x, kind, f, order=2):
    if isinstance(f, (list, tuple)):
        sos = butter(order, [f[0] / (SR / 2), f[1] / (SR / 2)], 'band', output='sos')
    else:
        sos = butter(order, f / (SR / 2), kind, output='sos')
    return sosfilt(sos, x, axis=0)


def stereo():
    return np.zeros((N, 2))


def place(buf, sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N:
        return
    if sig.ndim == 1:
        l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
        sig = np.stack([sig * l, sig * r], 1) * 1.4142
    n = min(len(sig), N - i)
    buf[i:i + n] += sig[:n] * gain


def env(n, a, d, s=0.0, sustain_len=0.0):
    """attack / decay(exp) envelope in seconds"""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), np.exp(-(t - a) / max(d, 1e-4)))
    return e


def saw(f, t, phase=0.0):
    return 2 * ((f * t + phase) % 1.0) - 1


def reverb_ir(sec=2.0, seed=1):
    r = np.random.default_rng(seed)
    n = int(sec * SR)
    t = np.arange(n) / SR
    ir = r.standard_normal((n, 2)) * np.exp(-t / (sec / 5))[:, None]
    ir = filt(ir, 'low', 6000)
    ir[:int(0.012 * SR)] = 0
    return ir / np.abs(ir).sum(0) * 6


IR = reverb_ir(2.2)


def reverb(x, wet=0.3):
    y = np.stack([fftconvolve(x[:, k], IR[:, k])[:N] for k in range(2)], 1)
    return x + y * wet


# ------------------------------------------------------------------ instruments
def kick(punch=1.0):
    n = int(0.55 * SR); t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.28)
    click = filt(rng.standard_normal(n), 'high', 2500) * np.exp(-t / 0.004) * 0.6
    return np.tanh((body + click * punch) * 2.2) * 0.9


def b808(freq, length, glide_to=None, drive=3.0):
    n = int(length * SR); t = np.arange(n) / SR
    f = freq * (1 + 1.0 * np.exp(-t / 0.018))
    if glide_to:
        g = np.clip((t - length * 0.55) / (length * 0.3), 0, 1)
        f = f * (1 - g) + glide_to * g
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.exp(-t / 0.9) * np.clip((length - t) / 0.02, 0, 1)
    x = np.sin(ph) * e
    return np.tanh(x * drive) / np.tanh(drive) * 0.85


def clap():
    n = int(0.5 * SR); t = np.arange(n) / SR
    nz = filt(rng.standard_normal(n), 'band', (900, 5200))
    e = np.zeros(n)
    for k, off in enumerate([0, 0.009, 0.018]):
        m = t >= off
        e[m] += np.exp(-(t[m] - off) / (0.006 if k < 2 else 0.11))
    body = np.sin(2 * np.pi * 210 * t) * np.exp(-t / 0.05) * 0.4
    return (nz * e + body) * 0.75


def snare(pitch=1.0):
    n = int(0.25 * SR); t = np.arange(n) / SR
    nz = filt(rng.standard_normal(n), 'band', (1200 * pitch, 8000))
    body = np.sin(2 * np.pi * 190 * pitch * t) * np.exp(-t / 0.04)
    return (nz * np.exp(-t / 0.07) + body * 0.5) * 0.6


def hat(open_=False):
    n = int((0.25 if open_ else 0.06) * SR); t = np.arange(n) / SR
    nz = filt(rng.standard_normal(n), 'high', 7500, 4)
    return nz * np.exp(-t / (0.09 if open_ else 0.014)) * 0.22


def supersaw(freq, length, voices=7, detune=0.018, cutoff=5000, a=0.005, d=0.25, sus=0.6, rel=0.08):
    n = int((length + rel) * SR); t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for v in range(voices):
        dt = (v - (voices - 1) / 2) / ((voices - 1) / 2) * detune
        s = saw(freq * (1 + dt), t, rng.random())
        pan = (v / (voices - 1)) * 2 - 1
        out[:, 0] += s * np.sqrt(0.5 * (1 - pan)); out[:, 1] += s * np.sqrt(0.5 * (1 + pan))
    out /= voices ** 0.7
    e = np.where(t < a, t / a, sus + (1 - sus) * np.exp(-(t - a) / d))
    e *= np.clip((length + rel - t) / rel, 0, 1)
    out = filt(out, 'low', cutoff) * e[:, None]
    return out


def noise_riser(length, f0=300, f1=9000):
    n = int(length * SR)
    nz = rng.standard_normal((n, 2))
    out = np.zeros_like(nz)
    chunks = 48
    for c in range(chunks):
        a, b = c * n // chunks, (c + 1) * n // chunks
        fc = f0 * (f1 / f0) ** (c / chunks)
        out[a:b] = filt(nz[a:b], 'band', (fc * 0.7, min(fc * 1.6, 20000)))
    tt = np.linspace(0, 1, n)
    tone = np.sin(2 * np.pi * np.cumsum(200 * 8 ** tt) / SR) * 0.15
    return (out * (tt ** 2)[:, None] * 0.6 + tone[:, None] * tt[:, None] ** 2)


def impact():
    n = int(3.0 * SR); t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.9)
    crash = filt(rng.standard_normal(n), 'high', 3000) * np.exp(-t / 0.7) * 0.35
    x = np.tanh((boom * 1.4 + crash) * 1.5)
    return np.stack([x, filt(x, 'low', 15000)], 1) * 0.9


def reverse_cymbal(length):
    n = int(length * SR); t = np.arange(n) / SR
    nz = filt(rng.standard_normal((n, 2)), 'high', 4000)
    return (nz * np.exp(-t / (length / 3))[:, None])[::-1] * 0.4


def whoosh(length=0.5):
    n = int(length * SR)
    x = noise_riser(length, 400, 6000)
    tt = np.linspace(0, 1, n)[:, None]
    return x * np.sin(np.pi * tt) / (tt ** 2 + 0.05) * 0.25


# ------------------------------------------------------------------ arrangement
drums, bass, synth, fx = stereo(), stereo(), stereo(), stereo()
beats = {'kick': [], 'snare': [], 'impact': [], 'roll': [], 'hat_roll': [], 'sections': {}}

CHORDS = [['F3', 'Ab3', 'C4', 'F4'], ['Db3', 'F3', 'Ab3', 'Db4'], ['Ab2', 'C3', 'Eb3', 'Ab3'], ['Eb3', 'G3', 'Bb3', 'Eb4']]
ROOTS = ['F1', 'Db1', 'Ab1', 'Eb1']
HOOK = [[(0, 'C5', 2), (2, 'Ab4', 2), (4, 'F4', 2), (6, 'Ab4', 1), (7, 'C5', 3), (10, 'Eb5', 2), (12, 'Db5', 2), (14, 'C5', 2)],
        [(0, 'Bb4', 2), (2, 'Ab4', 2), (4, 'F4', 3), (7, 'Eb4', 1), (8, 'F4', 4), (12, 'Ab4', 2), (14, 'C5', 2)]]

# intro: pads opening up + pluck arp + heartbeat
for bar in range(*INTRO):
    ch = CHORDS[bar % 4]
    cut = 600 + 2200 * bar / 4
    for nn in ch:
        place(synth, supersaw(note(nn), BAR, voices=5, detune=0.012, cutoff=cut, a=0.6, d=1.5, sus=0.8, rel=0.4), t_of(bar), 0.13)
    for s in range(16):
        nn = ch[[0, 2, 1, 3, 2, 1, 3, 2][s % 8]]
        f = note(nn) * 2
        place(synth, supersaw(f, STEP * 0.9, voices=3, detune=0.006, cutoff=1500 + 400 * bar, a=0.002, d=0.08, sus=0.0, rel=0.05), t_of(bar, s), 0.11, pan=0.4 * np.sin(s))
    if bar >= 2:
        place(drums, kick(0.3), t_of(bar), 0.5)
place(fx, reverse_cymbal(BAR), t_of(INTRO[1]) - BAR, 0.8)
beats['sections']['intro'] = t_of(0)

# build: four-on-floor -> snare roll accelerating, riser, saw chords
beats['sections']['build'] = t_of(BUILD[0])
place(fx, impact(), t_of(BUILD[0]), 0.45); beats['impact'].append(t_of(BUILD[0]))
for bar in range(*BUILD):
    ch = CHORDS[bar % 4]
    for nn in ch:
        for s in (0, 3, 6, 10, 12):
            place(synth, supersaw(note(nn), STEP * 1.6, cutoff=2500 + 1500 * (bar - 4), a=0.003, d=0.12, sus=0.2), t_of(bar, s), 0.12)
    for b in range(4):
        if not (bar == 7 and b == 3):
            place(drums, kick(), t_of(bar, b * 4), 0.85); beats['kick'].append(t_of(bar, b * 4))
for bar in range(BUILD[0] + 2, BUILD[1]):
    div = 2 if bar == 6 else 4
    for s in range(0, 16, 4 // div if div <= 4 else 1):
        place(drums, snare(1 + 0.2 * (bar - 6) + s / 64), t_of(bar, s), 0.35 + 0.25 * (s / 16 + bar - 6) / 2)
        beats['roll'].append(t_of(bar, s))
# 32nd roll in the last beat before the gap
for s in np.arange(8, 12, 0.5):
    place(drums, snare(1.6), t_of(7, s), 0.6); beats['roll'].append(t_of(7, s))
place(fx, noise_riser(2 * BAR - BEAT), t_of(6), 0.9)

# drops
def drop(b0, b1, intense):
    place(fx, impact(), t_of(b0), 0.9); beats['impact'].append(t_of(b0))
    for bar in range(b0, b1):
        k = bar % 4
        # kick + 808 pattern (16th steps)
        kick_steps = [0, 10] if bar % 2 == 0 else [0, 7, 10]
        for s in kick_steps:
            place(drums, kick(), t_of(bar, s), 0.95); beats['kick'].append(t_of(bar, s))
        b_pat = [(0, 7, None), (7, 3, None), (10, 4, 'glide'), (14, 2, None)] if bar % 2 == 0 else [(0, 6, None), (7, 3, None), (10, 6, None)]
        for s, ln, g in b_pat:
            f = note(ROOTS[k])
            glide = note(ROOTS[(k + 1) % 4]) if g else None
            place(bass, b808(f, ln * STEP, glide), t_of(bar, s), 0.9)
        # clap on beat 3 (half-time feel)
        place(drums, clap(), t_of(bar, 8), 0.8); beats['snare'].append(t_of(bar, 8))
        # hats: 8ths, with triplet / 32nd rolls
        roll_bar = bar % 2 == 1
        for s in range(0, 16, 2):
            if roll_bar and s >= 12:
                continue
            place(drums, hat(), t_of(bar, s), 0.8 if s % 4 == 0 else 0.55, pan=0.25)
        if roll_bar:
            n_roll = 6 if bar % 4 == 1 else 8
            for j in range(n_roll):
                place(drums, hat(), t_of(bar, 12 + j * 4 / n_roll), 0.4 + 0.4 * j / n_roll, pan=-0.3 + 0.6 * j / n_roll)
            beats['hat_roll'].append(t_of(bar, 12))
        if bar % 4 == 3:
            place(drums, hat(True), t_of(bar, 6), 0.5, pan=-0.2)
        # chords (stab rhythm) + hook
        for nn in CHORDS[k]:
            for s in (0, 3, 6, 8, 11, 14):
                place(synth, supersaw(note(nn), STEP * 1.4, cutoff=4500, a=0.002, d=0.1, sus=0.15), t_of(bar, s), 0.09)
        for s, nn, ln in HOOK[bar % 2]:
            place(synth, supersaw(note(nn), ln * STEP * 0.95, voices=7, detune=0.022, cutoff=7000, a=0.003, d=0.2, sus=0.5), t_of(bar, s), 0.23)
            if intense:
                place(synth, supersaw(note(nn) * 2, ln * STEP * 0.95, voices=5, detune=0.02, cutoff=9000, a=0.003, d=0.15, sus=0.3), t_of(bar, s), 0.08)


beats['sections']['drop1'] = t_of(DROP1[0])
drop(*DROP1, False)

# break: drums out, filtered pad, rise into drop 2
beats['sections']['break'] = t_of(BREAK[0])
for bar in range(*BREAK):
    for nn in CHORDS[bar % 4]:
        place(synth, supersaw(note(nn), BAR, voices=7, cutoff=1400, a=0.05, d=1.2, sus=0.7, rel=0.3), t_of(bar), 0.2)
    place(bass, b808(note(ROOTS[bar % 4]), BAR * 0.9), t_of(bar), 0.6)
for s in np.arange(8, 16, 1):
    place(drums, snare(1 + s / 16), t_of(17, s), 0.3 + s / 30); beats['roll'].append(t_of(17, s))
place(fx, noise_riser(BAR), t_of(17), 0.8)

beats['sections']['drop2'] = t_of(DROP2[0])
drop(*DROP2, True)

# outro: final impact, logo sting
beats['sections']['outro'] = t_of(OUTRO[0])
place(fx, impact(), t_of(OUTRO[0]), 1.0); beats['impact'].append(t_of(OUTRO[0]))
for nn in CHORDS[0]:
    place(synth, supersaw(note(nn), 2 * BAR, voices=7, cutoff=3000, a=0.01, d=1.5, sus=0.4, rel=1.5), t_of(OUTRO[0]), 0.2)
place(bass, b808(note('F1'), 2 * BAR, drive=4), t_of(OUTRO[0]), 0.9)
place(drums, kick(), t_of(OUTRO[0]), 1.0)
place(fx, reverse_cymbal(BEAT * 2), t_of(OUTRO[0] + 1, 8) - BEAT * 2, 0.6)
place(fx, impact(), t_of(OUTRO[0] + 1, 8), 0.6); beats['impact'].append(t_of(OUTRO[0] + 1, 8))
place(drums, kick(), t_of(OUTRO[0] + 1, 8), 0.9)

# whooshes for edit transitions (between sections)
for b in (DROP1[0] - 0.25, BREAK[0], DROP2[0] - 0.25, OUTRO[0]):
    place(fx, whoosh(0.45), t_of(b) - 0.3, 0.5)

# ------------------------------------------------------------------ mix
# sidechain: duck synths + fx tails on every kick
duck = np.ones(N)
dl = int(0.22 * SR)
curve = 1 - 0.65 * np.exp(-np.arange(dl) / (0.06 * SR))
for kt in beats['kick']:
    i = int(kt * SR)
    duck[i:i + dl] = np.minimum(duck[i:i + dl], curve[:max(0, min(dl, N - i))])
synth = reverb(synth, 0.35) * duck[:, None]
drums = reverb(drums, 0.12)
bass = filt(bass, 'low', 900) * (0.6 + 0.4 * duck[:, None])
fx = reverb(fx, 0.25)
mix = drums * 0.8 + bass * 0.5 + synth * 2.6 + fx * 0.7
mix = filt(mix, 'high', 25)
mix /= np.abs(mix).max()
mix = np.tanh(mix * 1.5) / np.tanh(1.5)            # glue / soft clip
mix /= np.abs(mix).max() / 0.95
fade = int(1.5 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
wavfile.write(os.path.join(OUT, 'music.wav'), SR, (mix * 32767).astype(np.int16))
beats.update({'bpm': BPM, 'beat': BEAT, 'bar': BAR, 'bars': BARS, 'duration': N / SR})
for k in ('kick', 'snare', 'roll', 'hat_roll', 'impact'):
    beats[k] = sorted(round(v, 4) for v in beats[k])
json.dump(beats, open(os.path.join(OUT, 'beats.json'), 'w'), indent=1)
print('music.wav', round(N / SR, 2), 's;', len(beats['kick']), 'kicks;', len(beats['impact']), 'impacts')
