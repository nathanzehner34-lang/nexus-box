// LIQUID DREAMS — music reactivity with the six-band analysis (the path the box uses since build 78).
// Runs the whole app in real headless Chrome and plays synthetic music through BOTH feeds the box sends
// (Nexus._meter6: six bands ~30/s while an experience asks for detail; Nexus._meter: three bands ~12/s),
// built from kick, snare, hi-hat and pad voices. Measures what Liquid Dreams actually does: the levels it
// sends to the shader, the kicks it locks onto, the tempo factor, and how much the picture itself moves
// on kicks versus between them. The same scenarios also run on the older analysis path for comparison.
// Pass "--report" to print the before / after table.
const path = require('path'), fs = require('fs'), assert = require('assert');
const H = require('./nxv-harness');
const A = H.assets;
const html = fs.readFileSync(path.join(A, 'index.html'), 'utf8');
const xp = fs.readFileSync(path.join(A, 'experiences.js'), 'utf8');
const REPORT = process.argv.includes('--report');

// ---- static: the established design and controls are untouched ----
['data-action="next"', 'data-action="shift"', 'data-play="visual"', 'data-play="color"', 'data-action="touch"'].forEach(s => assert(xp.includes(s), 'control preserved: ' + s));
['deepFlowLD', 'iridescenceLD', 'etherLD', 'chromeLD', 'cosmicLD', 'organicLD'].forEach(fn => assert(xp.includes('vec3 ' + fn + '('), 'style kept: ' + fn));
['electric', 'pink', 'rainbow', 'ultraviolet', 'flowing', 'neon', 'midnight', 'deepteal', 'violet', 'chrome', 'iridescent', 'aurora', 'obsidian', 'arctic'].forEach(k => assert(xp.includes(k + ": { name:"), 'palette kept: ' + k));
assert(!/ripple|lightWake|light wake/i.test(xp.slice(xp.indexOf('function liquidDreams()'), xp.indexOf('// NIGHT DRIVE'))), 'no Ripple / Light Wake effects reintroduced');
assert(xp.includes("if (NM) { try { NM.musicReset(); if (A && A.meterDetail) A.meterDetail(true); }"), 'Liquid Dreams asks for the six-band feed');

// a synthetic band mix for one moment of music
const SYN = `
function bandsAt(t, o, vol) {
  const beat = o.bpm ? 60 / o.bpm : 0, since = beat ? t % beat : 9, n = beat ? Math.floor(t / beat) : 0;
  const kick = beat && o.kick ? Math.exp(-since / .06) * o.kick : 0;
  const snare = beat && o.snare && n % 2 === 1 ? Math.exp(-since / .08) * o.snare : 0;
  const hat = beat && o.hat ? Math.exp(-Math.abs(since - beat / 2) / .02) * o.hat : 0;
  const rise = o.rise ? Math.min(1, t / o.rise) : 0;
  const j = () => 1 + (Math.random() - .5) * .12;
  const b = [ .02 + (o.pad || 0) * .3 + kick, .02 + (o.pad || 0) * .4 + kick * .7, .02 + (o.pad || 0) + snare * .5 + rise * .1,
              .015 + (o.pad || 0) * .7 + snare + rise * .15, .008 + hat * .7 + snare * .3 + rise * .2, .005 + hat + rise * .15 ];
  return b.map(v => v * vol * j());
}
function play(o, ms, vol) { vol = vol || 1; return new Promise(res => { const t0 = performance.now(); let lastOld = 0;
  const iv = setInterval(() => { const now = performance.now(), t = (now - t0) / 1000;
    if (now - t0 > ms) { clearInterval(iv); res(); return; }
    const b = bandsAt(t, o, vol);
    Nexus._meter6(b[0], b[1], b[2], b[3], b[4], b[5]);
    if (now - lastOld >= 80) { lastOld = now; const all = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5]) / 6; Nexus._meter(all, (b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2); }
  }, 33); }); }
// samples the picture every ~45 ms: mean brightness and frame-to-frame change
async function watch(o, ms, vol) {
  const cv = [...document.querySelectorAll('#xp canvas')].filter(c => c.id !== 'nvc' && c.width > 64 && getComputedStyle(c).display !== 'none').pop(), sm = document.createElement('canvas'); sm.width = 48; sm.height = 27; const g = sm.getContext('2d');
  let prev = null; const S = []; const k0 = XP.liquidDebug().audio.kicks || 0;
  const p = play(o, ms, vol); const t0 = performance.now();
  while (performance.now() - t0 < ms - 60) {
    if (XP.redraw) XP.redraw(); g.drawImage(cv, 0, 0, 48, 27); const d = g.getImageData(0, 0, 48, 27).data;
    let lum = 0, diff = 0; for (let i = 0; i < d.length; i += 4) { const l = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; lum += l; if (prev) diff += Math.abs(l - prev[i / 4]); }
    const cur = new Float32Array(d.length / 4); for (let i = 0; i < d.length; i += 4) cur[i / 4] = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
    const L = XP.liquidDebug();
    S.push({ t: performance.now() - t0, lum: lum / cur.length, diff: prev ? diff / cur.length : 0, kick: L.audio.kick, react: L.react });
    prev = cur; await wait(45);
  }
  await p;
  const after = XP.liquidDebug();
  const onK = S.filter(s => s.kick > .45), offK = S.filter(s => s.kick < .12);
  const avg = (a, f) => a.length ? a.reduce((x, s) => x + f(s), 0) / a.length : 0;
  return { kicks: (after.audio.kicks || 0) - k0, final: after.react, tempo: after.audio.tempo, sixBand: after.audio.sixBand,
    bass: avg(S, s => s.react.bass), mid: avg(S, s => s.react.mid), high: avg(S, s => s.react.high), energy: avg(S, s => s.react.energy),
    lumOnKick: avg(onK, s => s.lum), lumOffKick: avg(offK, s => s.lum), motion: avg(S, s => s.diff), samples: S.length, onK: onK.length };
}
`;
const SCEN = (oldPath) => `
  ${SYN}
  const gc = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, o) { if (/webgl/.test(k)) o = Object.assign({}, o, { preserveDrawingBuffer: true }); return gc.call(this, k, o); };
  Nexus.openExperience('liquiddreams'); await wait(1800);
  if (${oldPath}) { XP.close(); await wait(300); delete NXV.musicTick; Nexus.openExperience('liquiddreams'); await wait(1500); }
  R.d0 = XP.liquidDebug();
  R.edm = await watch({ bpm: 128, kick: .5, snare: .25, hat: .12, pad: .05 }, 6500, 1);
  R.quiet = await watch({ pad: .05 }, 4500, 1);
  R.edmLow = await watch({ bpm: 128, kick: .5, snare: .25, hat: .12, pad: .05 }, 6500, .25);
  R.fast = await watch({ bpm: 172, kick: .4, snare: .25, hat: .18, pad: .04 }, 8000, 1);
  R.slow = await watch({ bpm: 80, kick: .35, snare: .15, hat: .05, pad: .08 }, 8000, 1);
  R.silence = await watch({}, 3500, 0);
  // controls still work mid-music: next style, colour shift, sliders, Color Pulse, Gravity Point
  const ui = document.querySelector('.ld-ui'), env0 = XP.liquidDebug().env, pal0 = XP.liquidDebug().palette;
  const mus = play({ bpm: 120, kick: .5, snare: .2, hat: .1, pad: .05 }, 4000, 1);
  ui.querySelector('[data-action="next"]').click(); await wait(300); ui.querySelector('[data-action="shift"]').click(); await wait(300);
  const sp = ui.querySelector('[data-setting="audio"]'); sp.value = '1.6'; sp.dispatchEvent(new Event('input', { bubbles: true })); sp.dispatchEvent(new Event('change', { bubbles: true }));
  const xpEl = document.getElementById('xp'), Rc = xpEl.getBoundingClientRect(), ev = (t, x, y) => xpEl.dispatchEvent(new PointerEvent(t, { clientX: Rc.left + x * Rc.width, clientY: Rc.top + y * Rc.height, pointerId: 7, bubbles: true, cancelable: true }));
  ev('pointerdown', .3, .4); await wait(60); ev('pointerup', .3, .4); await wait(150); R.pulse = !!XP.liquidDebug().wave;
  ev('pointerdown', .6, .5); await wait(600); R.gravity = XP.liquidDebug().gravity.strength; ev('pointerup', .6, .5);
  await mus; R.afterControls = XP.liquidDebug(); R.switched = { env: [env0, R.afterControls.env], pal: [pal0, R.afterControls.palette] };
  document.querySelector('.ld-ui [data-action="exit"]').click(); await wait(400);
  R.closed = !XP.active; R.detailLog = window.__detail.slice();
`;
(async () => {
  const page = html.replace(/(src|href)="(?!https?:)([^"]+\.(js|css))"/g, (m, a, f) => a + '="' + 'file:///' + path.join(A, f).replace(/\\/g, '/').replace(/^\//, '') + '"');
  const NEW = await H.runPage(page, SCEN(false), { limit: 300000, w: 960, h: 540 });
  let OLD = null;
  if (REPORT) OLD = await H.runPage(page, SCEN(true), { limit: 300000, w: 960, h: 540 });
  assert.deepStrictEqual(NEW.errors, [], 'no errors: ' + NEW.errors.join('; '));
  const r = NEW;
  if (REPORT) {
    const row = (k, R) => [k, R.kicks, R.bass.toFixed(2), R.mid.toFixed(2), R.high.toFixed(2), R.energy.toFixed(2), (R.lumOnKick - R.lumOffKick).toFixed(1), R.motion.toFixed(2), R.tempo.toFixed(2)].join('\t');
    console.log('scenario\tkicks\tbass\tmid\thigh\tenergy\tkick-pulse\tmotion\ttempo');
    for (const k of ['quiet', 'edm', 'edmLow', 'fast', 'slow', 'silence']) { console.log('OLD ' + row(k, OLD[k])); console.log('NEW ' + row(k, r[k])); }
  }
  assert(r.edm.sixBand, 'Liquid Dreams runs on the six-band analysis');
  assert(r.detailLog.includes(true), 'opening Liquid Dreams asks Android for the six-band feed');
  // beats are detected and locked: ~13 kicks in 6.5 s at 128 BPM
  assert(r.edm.kicks >= 9, 'kicks are detected at 128 BPM (' + r.edm.kicks + ')');
  assert(r.edmLow.kicks >= 9, 'kicks are detected at a quarter of the volume too (' + r.edmLow.kicks + ')');
  assert(r.fast.kicks > r.slow.kicks, 'faster music gives more beats (' + r.slow.kicks + ' -> ' + r.fast.kicks + ')');
  // every band reacts, and the same song reads about the same at any volume
  assert(r.edm.bass > .3 && r.edm.mid > .15 && r.edm.high > .1, 'bass, mids and highs all reach the visuals (' + [r.edm.bass, r.edm.mid, r.edm.high].map(v => v.toFixed(2)) + ')');
  // (Android's Visualizer already normalises its capture against the volume; this checks a song that suddenly plays much quieter still drives the beat)
  assert(r.edmLow.kicks >= 9 && r.edmLow.bass > .4, 'a much quieter song still drives kicks and bass (' + r.edmLow.kicks + ', ' + r.edmLow.bass.toFixed(2) + ')');
  // the picture itself responds: brighter on kicks than between them, more motion with energy
  assert(r.edm.lumOnKick - r.edm.lumOffKick > .8, 'the picture visibly pulses on kicks (' + (r.edm.lumOnKick - r.edm.lumOffKick).toFixed(2) + ')');
  assert(r.edm.motion > r.quiet.motion * 1.2, 'energetic music moves the picture more than a quiet pad (' + r.quiet.motion.toFixed(2) + ' -> ' + r.edm.motion.toFixed(2) + ')');
  assert(r.fast.tempo > r.slow.tempo, 'fast songs flow faster than slow ones (' + r.slow.tempo.toFixed(2) + ' vs ' + r.fast.tempo.toFixed(2) + ')');
  // calm stays calm: no artificial pulse when quiet or silent
  assert(r.quiet.kicks === 0 || r.quiet.kicks <= 1, 'a quiet pad with no drums produces no beats (' + r.quiet.kicks + ')');
  assert(r.silence.final.bass < .08 && r.silence.final.energy < .1, 'silence settles to calm (' + JSON.stringify(r.silence.final) + ')');
  assert(r.quiet.energy < r.edm.energy * .7 && r.quiet.bass < r.edm.bass * .7, 'a quiet breakdown is calmer than the beat around it (' + [r.quiet.energy, r.edm.energy].map(v => v.toFixed(2)) + ')');
  // controls and touch keep working with the music playing
  assert(r.switched.env[0] !== r.switched.env[1] && r.switched.pal[0] !== r.switched.pal[1], 'style and palette buttons work mid-music');
  assert(r.afterControls.audio.sixBand && r.afterControls.react.bass > .2, 'switching style and palette does not interrupt the music analysis');
  assert(r.pulse, 'Color Pulse still spreads on tap with music playing');
  assert(r.gravity > .6, 'Gravity Point still builds under a held finger with music playing (' + r.gravity.toFixed(2) + ')');
  assert(r.closed && r.detailLog.includes(false), 'closing releases the feed');
  console.log('Liquid Dreams reactivity: kicks ' + r.edm.kicks + ' (quarter volume ' + r.edmLow.kicks + '), bass/mid/high ' + [r.edm.bass, r.edm.mid, r.edm.high].map(v => v.toFixed(2)).join('/') +
    ', kick pulse +' + (r.edm.lumOnKick - r.edm.lumOffKick).toFixed(1) + ' brightness, tempo ' + r.slow.tempo.toFixed(2) + '-' + r.fast.tempo.toFixed(2) + ', calm in silence; controls and touch work mid-music.');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
