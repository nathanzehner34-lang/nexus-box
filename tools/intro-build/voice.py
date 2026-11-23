import numpy as np, wave, sys
from piper import PiperVoice, SynthesisConfig
v = PiperVoice.load('lt/en-us-libritts-high.onnx', config_path='lt/en-us-libritts-high.onnx.json')
SR = 22050
sp = int(sys.argv[1]); out = sys.argv[2]
lines = ["Nexus online.", "Intelligence engaged.", "All systems operational.", "Welcome back."]
gaps = [.32, .34, .40, 0]
parts = []
for t, g in zip(lines, gaps):
    a = np.concatenate([c.audio_float_array for c in v.synthesize(t, SynthesisConfig(speaker_id=sp, length_scale=1.12, noise_scale=.45, noise_w_scale=.55))])
    # trim silence at both ends
    idx = np.where(np.abs(a) > .02)[0]; a = a[max(0, idx[0]-200): idx[-1]+800]
    parts.append(a); parts.append(np.zeros(int(g*SR), np.float32))
    print(t, round(len(a)/SR, 2))
x = np.concatenate(parts)
x = x/np.max(np.abs(x))*.9
with wave.open(out, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x*32767).astype(np.int16).tobytes())
print('total', round(len(x)/SR, 2))
