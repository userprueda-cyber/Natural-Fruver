"""Synthesised royalty-free score: warm ambient pad + soft music-box arpeggio (D minor)."""
import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve, butter, sosfilt

SR = 48000
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

CHORDS = [  # midi notes, 8 s each
    [38, 45, 53, 57, 64],   # Dm9
    [34, 41, 57, 62, 65],   # Bbmaj7
    [43, 50, 53, 58, 62],   # Gm7
    [33, 40, 55, 61, 64],   # A7
]

def pad_note(m, t0, dur, n):
    t = np.arange(int(dur * SR)) / SR
    env = np.minimum(t / 2.5, 1) * np.minimum((dur - t) / 3.0, 1)
    env = np.clip(env, 0, 1) ** 1.5
    f = hz(m); out = 0
    for det, amp in ((-0.06, .5), (0, 1), (0.07, .5)):
        for h, a in ((1, 1), (2, .35), (3, .15), (4, .08)):
            out = out + amp * a * np.sin(2 * np.pi * f * h * (1 + det / 100 * 0) * t + det * 30 * h)
        out = out + 0
    return out * env

def bell(m, dur=2.4):
    t = np.arange(int(dur * SR)) / SR; f = hz(m)
    return (np.sin(2 * np.pi * f * t) + .3 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6) + .15 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 9)) * np.exp(-t * 2.2) * np.minimum(t / .004, 1)

def make(path, total, tl):
    n = int((total + 3) * SR); pad = np.zeros(n); arp = np.zeros(n)
    ci = 0; t = -2.0
    while t < total + 1:
        for m in CHORDS[ci % 4]:
            d = 12.0; s = int(max(t, 0) * SR)
            if t < 0:
                note = pad_note(m, 0, d, n)[int(-t * SR):]
            else: note = pad_note(m, t, d, n)
            e = min(s + len(note), n); pad[s:e] += note[:e - s] * (.16 if m < 50 else .10)
        # music-box arpeggio over the chord
        seq = [CHORDS[ci % 4][k] + 12 * (1 + (k > 2)) for k in (1, 2, 3, 4, 3, 2, 1, 2, 3, 4)]
        for k, m in enumerate(seq):
            tt = t + 2.0 + k * .75
            if 0 <= tt < total + 1:
                b = bell(m); s = int(tt * SR); e = min(s + len(b), n); arp[s:e] += b[:e - s] * .05
        t += 8.0; ci += 1
    x = pad + arp
    # room: 2.6 s synthetic reverb
    rng = np.random.default_rng(7); ir = rng.normal(0, 1, int(2.6 * SR)) * np.exp(-np.arange(int(2.6 * SR)) / SR * 2.4)
    wet = fftconvolve(x, ir / np.sqrt((ir ** 2).sum()) * .35)[:n]
    x = x * .65 + wet * .6
    x = sosfilt(butter(2, 5200, "lp", fs=SR, output="sos"), x)
    x = sosfilt(butter(2, 45, "hp", fs=SR, output="sos"), x)
    # section envelope (Hard sense of shape: swell for cover cards, bed under speech)
    tt = np.arange(n) / SR; env = np.full(n, .55)
    for name, s0, d in tl:
        m = (tt >= s0) & (tt < s0 + d)
        if "title" in name or "end_card" in name: env[m] = 1.0
        elif "cold" in name: env[m] = .65
        elif "interview" in name: env[m] = .5
    lead = (tt < 1.5); env[lead] = 1.0
    cl = [s for s in tl if "closing" in s[0]][0]
    m = (tt >= cl[1]) & (tt < cl[1] + cl[2]); env[m] = np.linspace(.55, 1.0, m.sum())    # music rises on the close
    k = int(.8 * SR); env = np.convolve(env, np.ones(k) / k, "same")
    x = x * env
    x[int((total - 2.0) * SR):] *= np.linspace(1, 0, len(x[int((total - 2.0) * SR):]))
    x = x[:int(total * SR)]
    x = x / np.abs(x).max() * .6
    st = np.stack([x, np.roll(x, 90)], 1)     # tiny inter-channel delay for width
    wavfile.write(path, SR, (st * 32767).astype(np.int16))
