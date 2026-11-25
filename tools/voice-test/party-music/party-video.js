// Records Party Mode playing the test songs, with the music, as an MP4 for looking at the result.
// Usage: node party-video.js <out.mp4> <wavDir> <experience:song:from-to[:option=value...]> ...
//   e.g. node party-video.js flow.mp4 /tmp/songs flow:edm:0-42 ink:dnb:0-20:preset=neon orb:rock:0-20:backdrop=aurora
// The WAV files come from make_songs.py (same folder).
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { session, SONGS } = require('./party-play');
const [out, wavDir, ...specs] = process.argv.slice(2);
if (!out || !wavDir || !specs.length) { console.error('usage: node party-video.js <out.mp4> <wavDir> <experience:song:from-to> ...'); process.exit(1); }
const FPS = +(process.env.FPS || 30);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'partyvid-'));
(async () => {
  const parts = [];
  for (let n = 0; n < specs.length; n++) {
    const [experience, song, range, ...opts] = specs[n].split(':');
    const [from, to] = range.split('-').map(Number);
    const o = {}; opts.forEach(x => { const [k, v] = x.split('='); o[k] = v; });
    const dir = path.join(work, 'seg' + n); fs.mkdirSync(dir);
    await session(async ({ ev, shot, advance, enter, sleep }) => {
      await enter(experience);
      if (o.preset) await ev(`document.querySelector('[data-preset=${o.preset}]').click()`);
      if (o.backdrop) await ev(`NexusParty.setBackdrop(${JSON.stringify(o.backdrop)})`);
      if (o.mode) await ev(`document.querySelector('[data-mode=${o.mode}]').click()`);
      // switch the page to the virtual clock, let the running frame loop move onto it, hide the controls,
      // then let the experience's transition finish before the music starts
      await ev('__vtOn()'); await sleep(150);
      await ev(`document.getElementById('party').classList.add('party-idle')`); await sleep(900);
      await advance(3000); await sleep(1500);
      const frames = SONGS.songs[song].frames.slice(Math.round(from * 20), Math.round(to * 20));
      await ev('__play(' + JSON.stringify(frames) + ')');
      const total = Math.round((to - from) * FPS);
      for (let f = 0; f < total; f++) {
        await advance(1000 / FPS, 1000 / FPS);
        await shot(path.join(dir, String(f).padStart(5, '0') + '.jpg'), 82);
        if (f % (FPS * 5) === 0) process.stdout.write(experience + ' ' + song + ' ' + (f / FPS).toFixed(0) + 's\n');
      }
      const errors = await ev('__errors'); if (errors.length) console.error('page errors', errors);
    });
    const seg = path.join(work, 'seg' + n + '.mp4');
    cp.execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'), '-ss', String(from), '-t', String(to - from),
      '-i', path.join(wavDir, song + '.wav'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', seg]);
    parts.push(seg);
  }
  const list = path.join(work, 'list.txt'); fs.writeFileSync(list, parts.map(p => "file '" + p + "'").join('\n'));
  cp.execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  fs.rmSync(work, { recursive: true, force: true });
  console.log('wrote', out);
})().catch(e => { console.error(e); process.exit(1); });
