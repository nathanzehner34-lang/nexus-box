# How the startup intro assets were made

- `layers.py` cuts the Design 2 picture into five layers for `assets/intro/` (backdrop with a soft glow
  where the emblem will form, the orbital rings keyed by brightness, the emblem and its circle, the NEXUS
  lettering, and the finished frame). Input: the 1672x941 Design 2 image.
- `voice.py <speaker> <out.wav>` speaks the announcement with Piper's en-us-libritts-high voice
  (speaker 375), one phrase at a time with short pauses. Then:

      ffmpeg -i raw.wav -af "apad=pad_dur=0.7,asetrate=22050*0.95,aresample=44100,atempo=1.0526,highpass=f=55,equalizer=f=110:t=q:w=1:g=3.5,equalizer=f=2800:t=q:w=1.2:g=2.5,lowpass=f=10500,chorus=0.7:0.9:11|17:0.18|0.14:0.25|0.3:1.3|0.9,aecho=0.85:0.55:48|95|170:0.20|0.12|0.07,acompressor=threshold=-18dB:ratio=3:attack=5:release=120,loudnorm=I=-15:TP=-1.5:LRA=7" -c:a libvorbis -q:a 5 startup.ogg

  Phrase starts in the result: 0, 1.54, 3.48 and 5.38 s; intro.js's timeline is set to them.
