"""Party Mode test music.

Synthesises five short songs in different genres (each with quiet, building and full sections),
writes them as a WAV file, and measures them the way the box does: Android's Visualizer captures
1024 samples of the playing audio 20 times a second, and MainActivity turns each capture into the
three-band meter (Nexus._meter, every other capture) and the six-band detail feed (Nexus._meter6).
The result, party-songs.json, is what party-music.test.js and party-video.js play into Party Mode.

Usage: python3 make_songs.py <out_dir>
"""
import json, os, sys, wave
import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def env_exp(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def kick(level=1.0, length=.45):
    n = int(length * SR); t = np.arange(n) / SR
    f = 48 + 110 * np.exp(-t / .045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return level * np.sin(ph) * env_exp(n, .16) + level * .25 * rng.standard_normal(n) * env_exp(n, .004)


def sub808(freq, length, level=1.0):
    n = int(length * SR); t = np.arange(n) / SR
    f = freq * (1 + .6 * np.exp(-t / .03))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return level * np.tanh(1.6 * np.sin(ph)) * env_exp(n, length * .55)


def snare(level=1.0):
    n = int(.25 * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = np.convolve(noise, [1, -.6], 'same')
    return level * (.55 * noise * env_exp(n, .06) + .5 * np.sin(2 * np.pi * 190 * t) * env_exp(n, .03))


def hat(level=1.0, open_=False):
    n = int((.25 if open_ else .05) * SR)
    x = rng.standard_normal(n)
    x = x - np.convolve(x, np.ones(4) / 4, 'same')      # crude high-pass
    return level * .5 * x * env_exp(n, .09 if open_ else .012)


def saw(freq, length, level=1.0, detune=.006, voices=3):
    n = int(length * SR); t = np.arange(n) / SR; out = np.zeros(n)
    for v in range(voices):
        f = freq * (1 + detune * (v - (voices - 1) / 2))
        out += 2 * ((t * f + v * .31) % 1) - 1
    return level * out / voices


def lowpass(x, cutoff):
    # one-pole low-pass, cutoff may be an array (sweeps)
    a = np.exp(-2 * np.pi * np.asarray(cutoff) / SR) * np.ones(len(x))
    y = np.zeros(len(x)); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc; y[i] = acc
    return y


def lowpass_fast(x, cutoff):
    from scipy.signal import butter, lfilter
    b, a = butter(2, cutoff / (SR / 2)); return lfilter(b, a, x)


def highpass_fast(x, cutoff):
    from scipy.signal import butter, lfilter
    b, a = butter(2, cutoff / (SR / 2), 'high'); return lfilter(b, a, x)


def place(buf, clip, at):
    i = int(at * SR)
    if i >= len(buf): return
    j = min(len(buf), i + len(clip)); buf[i:j] += clip[:j - i]


def note(n):  # MIDI to Hz
    return 440 * 2 ** ((n - 69) / 12)


CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]   # Am F C G


def pad_layer(length, bars, bar_len, level, bright=900):
    out = np.zeros(int(length * SR))
    for b in range(bars):
        ch = CHORDS[b % 4]
        seg = sum(saw(note(m), bar_len, 1, .008, 3) for m in ch) / 3
        n = len(seg); a = np.minimum(1, np.arange(n) / (.3 * SR)) * np.minimum(1, (n - np.arange(n)) / (.3 * SR))
        place(out, seg * a, b * bar_len)
    return level * lowpass_fast(out, bright)


def song_edm():
    bpm = 128; beat = 60 / bpm; bar = beat * 4; L = bar * 22; x = np.zeros(int(L * SR) + SR)
    # 0-4 bars: intro pad + hats; 4-8: build (snare roll, riser); 8-14: drop; 14-17: breakdown; 17-22: drop 2
    x += pad_layer(len(x) / SR, 22, bar, .25, 700)
    for b in range(22):
        t0 = b * bar
        drop = 8 <= b < 14 or 17 <= b < 22
        for k in range(4):
            tb = t0 + k * beat
            if drop or (b < 4 and k % 2 == 0 and b >= 2): place(x, kick(1 if drop else .5), tb)
            if drop: place(x, hat(.5, True), tb + beat / 2)
            if drop and k % 2 == 1: place(x, snare(.7), tb)
            if b < 4 or 14 <= b < 17: place(x, hat(.25), tb + beat / 2)
        if drop:
            bass_n = CHORDS[b % 4][0] - 24
            for k in range(8):
                seg = saw(note(bass_n), beat / 2 * .9, .35, .01, 2)
                place(x, lowpass_fast(seg, 300) * np.minimum(1, np.arange(len(seg)) / 300), t0 + k * beat / 2 + .02)
            lead = CHORDS[b % 4]
            for k in range(8):
                m = lead[(k * 2 + b) % 3] + 12
                seg = saw(note(m), beat / 2 * .8, .22, .012, 3)
                place(x, lowpass_fast(seg, 3200) * env_exp(len(seg), .25), t0 + k * beat / 2)
        if 4 <= b < 8:   # build: snare roll speeding up, rising noise
            step = beat / (2 if b < 6 else 4 if b < 7 else 8)
            n = int(bar / step)
            for k in range(n): place(x, snare(.25 + .5 * (b - 4 + k / n) / 4), t0 + k * step)
    # riser over bars 4-8
    s, e = int(4 * bar * SR), int(8 * bar * SR)
    noise = rng.standard_normal(e - s) * np.linspace(0, .35, e - s)
    x[s:e] += highpass_fast(noise, 2500)
    return x, 'EDM build and drop · 128 bpm', [(0, 'intro'), (4 * bar, 'build-up'), (8 * bar, 'drop'), (14 * bar, 'breakdown'), (17 * bar, 'drop 2')]


def song_hiphop():
    bpm = 88; beat = 60 / bpm; bar = beat * 4; L = bar * 10; x = np.zeros(int(L * SR) + SR)
    x += pad_layer(len(x) / SR, 10, bar, .12, 1200)
    for b in range(10):
        t0 = b * bar
        full = b >= 2
        for k in range(4):
            tb = t0 + k * beat
            if full and k in (0, 2): place(x, kick(.9), tb)
            if full and k == 2 and b % 2: place(x, kick(.7), tb + beat * .75)
            if full and k % 2 == 1: place(x, snare(.8), tb)
            for s in range(4 if full else 2): place(x, hat(.18), tb + s * beat / (4 if full else 2))
        if full:
            root = CHORDS[b % 4][0] - 24
            place(x, sub808(note(root), beat * 1.8, .7), t0)
            place(x, sub808(note(root), beat * 1.4, .6), t0 + beat * 2.5)
    return x, 'Hip-hop · 88 bpm, heavy 808', [(0, 'intro'), (2 * bar, 'verse')]


def song_rock():
    bpm = 140; beat = 60 / bpm; bar = beat * 4; L = bar * 14; x = np.zeros(int(L * SR) + SR)
    for b in range(14):
        t0 = b * bar
        loud = b >= 4
        ch = CHORDS[b % 4]
        for k in range(8):
            seg = sum(saw(note(m - 12), beat / 2 * .95, 1, .004, 2) for m in (ch[0], ch[0] + 7, ch[0] + 12)) / 3
            seg = np.tanh(seg * (6 if loud else 2)) * (.32 if loud else .14)
            place(x, lowpass_fast(seg, 2600), t0 + k * beat / 2)
        for k in range(4):
            tb = t0 + k * beat
            if loud or k == 0: place(x, kick(.8), tb)
            if loud and k % 2 == 1: place(x, snare(.9), tb)
            for s in range(2): place(x, hat(.3 if loud else .15, s == 1 and loud), tb + s * beat / 2)
    return x, 'Rock · 140 bpm, distorted guitars', [(0, 'quiet verse'), (4 * bar, 'loud chorus')]


def song_ambient():
    bpm = 70; beat = 60 / bpm; bar = beat * 4; L = bar * 8; x = np.zeros(int(L * SR) + SR)
    x += pad_layer(len(x) / SR, 8, bar, .3, 500)
    for b in range(8):   # soft piano-like notes
        ch = CHORDS[b % 4]
        for k in range(6):
            m = ch[k % 3] + 12 + (12 if k >= 3 else 0)
            n = int(beat * 2 * SR); t = np.arange(n) / SR
            tone = (np.sin(2 * np.pi * note(m) * t) + .3 * np.sin(4 * np.pi * note(m) * t)) * env_exp(n, .6) * .16
            place(x, tone, b * bar + k * bar / 6)
    return x, 'Ambient ballad · 70 bpm, no drums', [(0, 'calm')]


def song_dnb():
    bpm = 174; beat = 60 / bpm; bar = beat * 4; L = bar * 18; x = np.zeros(int(L * SR) + SR)
    x += pad_layer(len(x) / SR, 18, bar, .1, 900)
    pattern = [(0, 'k'), (1, 's'), (2.5, 'k'), (3, 's')]
    for b in range(18):
        t0 = b * bar
        for pos, kind in pattern:
            place(x, kick(.9) if kind == 'k' else snare(.85), t0 + pos * beat)
        for s in range(8): place(x, hat(.25), t0 + s * beat / 2)
        root = CHORDS[b % 4][0] - 24
        seg = saw(note(root), bar, .35, .02, 4)
        lfo = 300 + 900 * (.5 + .5 * np.sin(2 * np.pi * np.arange(len(seg)) / SR * 2))
        place(x, lowpass(seg, lfo), t0)
    return x, 'Drum and bass · 174 bpm', [(0, 'full')]


def measure(x):
    """Return the box's meter feeds for this audio: list of captures at 20 per second."""
    N = 1024; step = SR // 20
    edges = [20, 120, 250, 700, 2500, 7000, 16000]
    bin_hz = SR / N
    out = []
    global TILT
    TILT = np.maximum(1.0, (np.arange(N // 2 + 1) * bin_hz / 150.0) ** .62)
    for c in range(N, len(x), step):
        w = x[c - N:c]
        peak = np.max(np.abs(w)) or 1.0
        q = np.clip(np.round(w / peak * 127), -128, 127)          # normalised 8-bit capture
        X = np.fft.rfft(q)
        # byte-scale magnitudes, calibrated so a drop reads like real music on the box (kick ~0.12 in the bass band,
        # mids ~0.03, highs ~0.015); the tilt stands in for the bright top end of a real mastered track
        mag = np.abs(X) / N * 2 / 128.0 * .36 * TILT
        mag = np.minimum(mag, 1.4)
        n = N // 2
        bass = mag[1:7].mean(); mid = mag[7:25].mean(); high = mag[25:n].mean(); allv = mag[1:65].sum() / 64
        six = []
        for j in range(6):
            lo, hi = edges[j], edges[j + 1]
            ks = [k for k in range(1, n) if lo <= k * bin_hz < hi] or [1]
            six.append(float(mag[ks].mean()))
        # loudness scaling: Visualizer normalises the capture, so overall level only shows in the shape of the
        # spectrum; quiet passages still look quiet because their peak is a soft pad rather than a kick
        out.append([round(float(allv), 4), round(float(bass), 4), round(float(mid), 4), round(float(high), 4)] + [round(v, 4) for v in six])
    return out


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out_dir, exist_ok=True)
    songs = [song_edm, song_hiphop, song_rock, song_ambient, song_dnb]
    keys = ['edm', 'hiphop', 'rock', 'ambient', 'dnb']
    data = {'rate': 20, 'note': 'captures at 20 per second: [all, bass, mid, high, sub, bass, lowmid, mid, high, air]', 'songs': {}}
    for key, fn in zip(keys, songs):
        x, title, sections = fn()
        x = x / (np.max(np.abs(x)) or 1) * .9
        feats = measure(x)
        data['songs'][key] = {'title': title, 'seconds': round(len(x) / SR, 2), 'sections': [[round(a, 2), b] for a, b in sections], 'frames': feats}
        with wave.open(os.path.join(out_dir, key + '.wav'), 'wb') as wv:
            wv.setnchannels(1); wv.setsampwidth(2); wv.setframerate(SR)
            wv.writeframes((x * 32767).astype('<i2').tobytes())
        f = np.array(feats)
        print(key, title, 'seconds %.1f' % (len(x) / SR), 'bass mean %.3f max %.3f' % (f[:, 1].mean(), f[:, 1].max()),
              'mid %.3f' % f[:, 2].mean(), 'high %.3f' % f[:, 3].mean(), 'all %.3f' % f[:, 0].mean())
    with open(os.path.join(out_dir, 'party-songs.json'), 'w') as fh:
        json.dump(data, fh, separators=(',', ':'))


if __name__ == '__main__':
    main()
