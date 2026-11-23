#!/usr/bin/env python3
"""Build one seamless Visuals scene reel from Beeple Manifest Destiny clips.
Each angle is centre-cropped to the X3's 1024x600 screen, angles are joined with 0.4 s cross-fades,
and the reel's end cross-fades into its own start so it loops with no visible seam.
Output: 1024x600, 30 fps, H.264 Main 4.0, keyframe every second, no audio (matches the other reels).
usage: build_reel.py OUT.mp4 CARD.jpg SRC1.mp4 [SRC2.mp4 ...]"""
import os, subprocess, sys
F = 0.4
out, card, srcs = sys.argv[1], sys.argv[2], sys.argv[3:]
def dur(p): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]))
ds = [dur(s) for s in srcs]
args = ['ffmpeg', '-v', 'error', '-y']
for s in srcs: args += ['-i', s]
fl, prev, t = [], '[v0]', ds[0]
for i in range(len(srcs)):
    fl.append(f'[{i}:v]crop=ih*1024/600:ih,scale=1024:600:flags=lanczos,fps=30,format=yuv420p,setsar=1,settb=1/30[v{i}]')
for i in range(1, len(srcs)):
    fl.append(f'{prev}[v{i}]xfade=transition=fade:duration={F}:offset={t - F:.4f}[x{i}]')
    prev, t = f'[x{i}]', t + ds[i] - F
# seamless loop: the end dissolves into the opening frames
fl.append(f'{prev}split[a][b]')
fl.append(f'[a]trim=start={F},setpts=PTS-STARTPTS[body]')
fl.append(f'[b]trim=end={F},setpts=PTS-STARTPTS[head]')
fl.append(f'[body][head]xfade=transition=fade:duration={F}:offset={t - 2 * F:.4f}[out]')
args += ['-filter_complex', ';'.join(fl), '-map', '[out]', '-an', '-c:v', 'libx264', '-profile:v', 'main', '-level', '4.0',
         '-preset', 'slow', '-crf', os.environ.get('CRF', '18'), '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]
subprocess.check_call(args)
subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-ss', '1.2', '-i', out, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', card])
print(out, round(dur(out), 2), 's')
