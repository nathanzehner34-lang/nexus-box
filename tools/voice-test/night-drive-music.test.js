// NIGHT DRIVE — music reactivity, sky and quality, checked in rendered pixels and in the running app.
//  A. Pixels (each world's real shader): every band moves its own elements, the elements barely overlap,
//     nothing brightens the whole screen or the open sky, beat pulses travel, shooting stars draw.
//  B. Forest: defined trees, depth (ranks fading into mist), verge plants, a clear highway.
//  C. Cost: per-pixel work on the paths pixels really take (nd-work.js) stays within budget.
//  D. The app: Night Drive is opened from its home tile and driven by synthetic music through the box's
//     own feeds (six bands ~30/s, three bands ~12/s): slow atmospheric, strong bass, electronic and a varied
//     mix, then silence. Kicks must become pulses on the beat, the bands must reach their elements, and
//     everything must settle when the music stops. Worlds are switched while it plays.
// Run: node night-drive-music.test.js [--report]
const fs = require('fs'), path = require('path'), assert = require('assert');
const { parts, render, BASE } = require('./nd-stills.js');
const { measure } = require('./nd-work.js');
const H = require('./nxv-harness');
const REPORT = process.argv.includes('--report');
const P = parts();
const W = 320, Hh = 180;
const lines = [];
const note = s => { lines.push(s); if (REPORT) console.log(s); };

// ---------- static ----------
const exp = fs.readFileSync(path.join(H.assets, 'experiences.js'), 'utf8');
const nd = exp.slice(exp.indexOf('function nightDrive()'), exp.indexOf('function isVisual('));
assert(!/col \*= 1\. \+ kick\*react/.test(P.MAIN), 'no whole-screen brightness pulse on the kick');
assert(nd.includes('NXV.musicTick') || nd.includes('NM.musicTick'), 'Night Drive listens through the shared six-band analyser');
assert(nd.includes('A.meterDetail(true)') && nd.includes('A.meterDetail(false)'), 'Night Drive asks for the detailed feed and releases it');
assert(!/Math\.random\(\)[^;]*kick|setInterval/.test(nd), 'no timer-driven or random fake beats');
['rings', 'cosmic', 'forest'].forEach(w => {
  assert(!/kick\*react\*\.?\d*\s*\)\s*;\s*$/m.test(''), 'placeholder');
  // the open sky must not be scaled by the music as a whole
  assert(!/energy\*react/.test(P[w]), w + ': nothing scales with overall energy (that lit whole areas at once)');
});
assert(/vec3 ndMeteors\(vec2 p\)/.test(P.HEAD) && /mA0/.test(P.HEAD), 'shooting stars are launched by the app, one by one');
assert(P.MAIN.includes('ndMeteors(ndSkyP(rd))*gSkyOpen'), 'shooting stars are drawn over every world\'s open sky');
['rings', 'cosmic', 'forest'].forEach(w => assert(P[w].includes('ndStarField(') || P[w].includes('chStars('), w + ' uses the shared star field'));

// ---------- A. pixels ----------
const OFF = { kick: 0, energy: 0, mids: 0, highs: 0, bass: 0, hat: 0, snare: 0, burst: 99, drift: 1.3, pulseT: [99, 99, 99, 99], pulseS: [0, 0, 0, 0] };
const scenes = {
  quiet: {}, bass: { bass: 1 }, mids: { mids: 1 }, highs: { highs: 1, hat: 1 },
  pulseNear: { pulseT: [.3, 99, 99, 99], pulseS: [1, 0, 0, 0] }, pulseFar: { pulseT: [.9, 99, 99, 99], pulseS: [1, 0, 0, 0] },
  loud: { kick: 1, energy: 1, mids: 1, highs: 1, bass: 1, hat: 1, snare: 1, burst: .2, pulseT: [.3, .8, 1.3, 1.9], pulseS: [1, 1, 1, 1] },
};
// a shooting star placed in open sky for each world
const METEOR = { rings: { mA0: [.42, .5, -.9, .5], mB0: [.22, .3, 1.6, 0] }, cosmic: { mA0: [.05, .52, -1.2, .5], mB0: [.22, .3, 1.6, 0] }, forest: { mA0: [.02, .5, -1.2, .5], mB0: [.2, .24, 1.6, 0] } };
const jobs = {};
for (const w of ['rings', 'cosmic', 'forest']) {
  for (const [k, u] of Object.entries(scenes)) jobs[w + '_' + k] = [P.build(P[w]), Object.assign({}, BASE, OFF, u)];
  jobs[w + '_meteor'] = [P.build(P[w]), Object.assign({}, BASE, OFF, METEOR[w])];
}
jobs.forest_bare = [P.build(P.forest.replace(/vec3 ndOverlay\(vec3 col, vec3 rd, vec2 uv, float t\)\{/, 'vec3 ndOverlay(vec3 col, vec3 rd, vec2 uv, float t){ return col;')), Object.assign({}, BASE, OFF)];
jobs.forest_later = [P.build(P.forest), Object.assign({}, BASE, OFF, { travel: BASE.travel + 60, time: BASE.time + .6 })];
for (const t of [9000, 15000, 23000]) jobs['forest_at' + t] = [P.build(P.forest), Object.assign({}, BASE, OFF, { travel: t })];
const R = render(jobs, W, Hh, { img: true, reps: 1 });
const lum = (img, i) => .299 * img[i] + .587 * img[i + 1] + .114 * img[i + 2];
function delta(a, b) { const d = new Float32Array(W * Hh); for (let i = 0; i < d.length; i++) d[i] = lum(b, i * 4) - lum(a, i * 4); return d; }
// the horizon sits at about 59% up the frame (rd.y = 0); readPixels rows start at the bottom
const HZ = Math.round(Hh * .43);
for (const w of ['rings', 'cosmic', 'forest']) {
  const q = R[w + '_quiet'].img, g = k => R[w + '_' + k].img;
  const sets = {};
  for (const k of ['bass', 'mids', 'highs', 'pulseNear']) {
    const d = delta(q, g(k)); let n = 0, mx = 0; const s = new Set();
    for (let i = 0; i < d.length; i++) { if (Math.abs(d[i]) > 5) { n++; s.add(i); } mx = Math.max(mx, Math.abs(d[i])); }
    sets[k] = s;
    note(w + ' ' + k + ': ' + (100 * n / d.length).toFixed(1) + '% of pixels change, strongest ' + mx.toFixed(0));
    assert(mx > 20 && n / d.length > .001, w + ': the ' + k + ' reaction is noticeable (' + mx.toFixed(0) + ', ' + (100 * n / d.length).toFixed(2) + '%)');
    assert(n / d.length < .4, w + ': the ' + k + ' reaction stays on its own elements (' + (100 * n / d.length).toFixed(1) + '% of the frame)');
  }
  // independence: the elements answering one band are not the ones answering another
  const keys = Object.keys(sets);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const A = sets[keys[i]], B = sets[keys[j]]; let inter = 0; for (const x of A) if (B.has(x)) inter++;
    const jac = inter / Math.max(1, A.size + B.size - inter);
    note(w + ' overlap ' + keys[i] + '/' + keys[j] + ': ' + jac.toFixed(2));
    assert(jac < .5, w + ': ' + keys[i] + ' and ' + keys[j] + ' move different elements (overlap ' + jac.toFixed(2) + ')');
  }
  // no global flash: with everything at full, most of the screen keeps its brightness
  const d = delta(q, g('loud')); const abs = Array.from(d, Math.abs).sort((a, b) => a - b);
  const median = abs[abs.length >> 1], frac = abs.filter(v => v > 6).length / abs.length;
  // the open sky's background: the median change there ignores the individual stars that twinkle
  // (they should) and catches any brightening of the sky as a whole (it must not)
  const skyD = [];
  for (let y = HZ + 12; y < Hh; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (lum(q, i * 4) < 40) skyD.push(d[i]); }
  skyD.sort((a, b) => a - b);
  const skyMed = skyD[skyD.length >> 1], skyMean = skyD.reduce((a, b) => a + b, 0) / Math.max(1, skyD.length);
  note(w + ' loud vs quiet: median change ' + median.toFixed(1) + ', ' + (100 * frac).toFixed(0) + '% of pixels change; open sky background ' + skyMed.toFixed(2) + ' (mean incl. stars ' + skyMean.toFixed(2) + ')');
  assert(median < 2.5, w + ': no whole-screen flash (median pixel change ' + median.toFixed(1) + ')');
  assert(frac < .5, w + ': most of the screen is untouched by any one moment of music (' + (100 * frac).toFixed(0) + '%)');
  assert(skyD.length > 500 && Math.abs(skyMed) < 1.5 && skyMean < 6, w + ': the open sky never brightens as a whole (' + skyMed.toFixed(2) + ', ' + skyMean.toFixed(2) + ')');
  // beat pulses travel away down the road: later, the light sits nearer the horizon
  const cy = img => { const dd = delta(q, img); let s = 0, n = 0; for (let y = 0; y < HZ; y++) for (let x = W * .2 | 0; x < W * .8; x++) { const v = Math.max(0, dd[y * W + x]); s += v * y; n += v; } return n ? s / n : 0; };
  const y1 = cy(g('pulseNear')), y2 = cy(g('pulseFar'));
  note(w + ' pulse height on screen: ' + y1.toFixed(1) + ' -> ' + y2.toFixed(1));
  assert(y2 > y1 + 2, w + ': a beat pulse travels away down the road (' + y1.toFixed(1) + ' -> ' + y2.toFixed(1) + ')');
  // a shooting star in flight is a streak in the sky
  const md = delta(q, g('meteor')); let mn = 0, mlow = 0; for (let i = 0; i < md.length; i++) if (md[i] > 25) { mn++; if (Math.floor(i / W) < HZ) mlow++; }
  assert(mn > 6 && mlow === 0, w + ': the shooting star draws as a streak in the sky (' + mn + ' px)');
}

// ---------- B. the forest ----------
const F = R.forest_quiet.img, bare = R.forest_bare.img;
const region = (img, x0, x1, y0, y1) => { let s = 0, s2 = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = lum(img, (y * W + x) * 4); s += v; s2 += v * v; n++; } const m = s / n; return { mean: m, std: Math.sqrt(Math.max(0, s2 / n - m * m)) }; };
let roadD = 0, rn = 0; for (let y = 0; y < Hh * .3; y++) for (let x = W * .38 | 0; x < W * .62; x++) { roadD += Math.abs(lum(F, (y * W + x) * 4) - lum(bare, (y * W + x) * 4)); rn++; }
assert(roadD / rn < 3, 'the highway stays clear: nothing stands on it (' + (roadD / rn).toFixed(2) + ')');
// defined trees: strong vertical edges (trunks) and many crown edges on both sides
function edges(img, x0, x1, y0, y1) { let e = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0 + 1; x < x1; x++) { const a = lum(img, (y * W + x) * 4), b = lum(img, (y * W + x - 1) * 4); if (Math.abs(a - b) > 8) e++; n++; } return e / n; }
const eL = edges(F, 0, W * .3 | 0, HZ, Hh), eR = edges(F, W * .7 | 0, W, HZ, Hh), eBare = edges(bare, 0, W * .3 | 0, HZ, Hh);
note('forest edge density left ' + eL.toFixed(3) + ' right ' + eR.toFixed(3) + ' (sky alone ' + eBare.toFixed(3) + ')');
assert(eL > eBare * 1.5 && eR > eBare * 1.5 && eL > .04 && eR > .04, 'individual trees with defined outlines stand on both sides');
// trunks: columns of dark bark against the brighter sky and mist behind
let trunkCols = 0; for (let x = 0; x < W; x++) { if (x > W * .35 && x < W * .65) continue; let dark = 0; for (let y = HZ; y < HZ + 25; y++) if (lum(F, (y * W + x) * 4) < lum(bare, (y * W + x) * 4) - 4) dark++; if (dark > 18) trunkCols++; }
assert(trunkCols > 12, 'tree trunks rise from the ground (' + trunkCols + ' columns)');
// open sky with the moon above the road
const skyTop = region(F, W * .4 | 0, W * .6 | 0, Hh * .7 | 0, Hh);
let moon = 0; for (let y = HZ; y < Hh; y++) for (let x = 0; x < W; x++) if (lum(F, (y * W + x) * 4) > 165) moon++;
assert(moon > 15, 'a bright moon hangs over the road (' + moon + ' px)');
// depth: the far forest at the horizon is lighter, softer and lower-contrast than the near trees
const far = region(F, W * .40 | 0, W * .46 | 0, HZ + 1, HZ + 8), near = region(F, 0, W * .12 | 0, HZ + 4, HZ + 40);
note('depth: far ranks mean ' + far.mean.toFixed(1) + ' sd ' + far.std.toFixed(1) + ' / near trees mean ' + near.mean.toFixed(1) + ' sd ' + near.std.toFixed(1));
assert(far.std < near.std, 'nearer trees carry more contrast than the ranks in the mist (' + near.std.toFixed(1) + ' vs ' + far.std.toFixed(1) + ')');
// the verge: ferns, rocks, flowers and mushrooms beside the road change the ground there
let verge = 0; for (let y = HZ - 14; y < HZ - 1; y++) for (const xr of [[0, W * .35], [W * .65, W]]) for (let x = xr[0] | 0; x < xr[1]; x++) if (Math.abs(lum(F, (y * W + x) * 4) - lum(bare, (y * W + x) * 4)) > 6) verge++;
assert(verge > 120, 'plants, rocks and mushrooms line the verges (' + verge + ' px)');
// movement and variety along the journey
let mv = 0; for (let i = 0; i < W * Hh; i++) mv += Math.abs(lum(F, i * 4) - lum(R.forest_later.img, i * 4));
assert(mv / (W * Hh) > 2, 'driving forward moves the forest past (' + (mv / (W * Hh)).toFixed(2) + ')');
const alongs = [9000, 15000, 23000].map(t => R['forest_at' + t].img);
for (let i = 1; i < alongs.length; i++) { let d = 0; for (let j = 0; j < W * Hh; j++) d += Math.abs(lum(alongs[i], j * 4) - lum(alongs[i - 1], j * 4)); assert(d / (W * Hh) > 3, 'the forest keeps changing along the journey'); }
let rg = 0; for (let o = 0; o < F.length; o += 4) rg += F[o + 1] - F[o];
assert(rg / (W * Hh) > 3, 'the forest keeps its emerald and cyan cast');

// ---------- C. cost ----------
const uw = { pulseT: [.3, .9, 1.5, 2.2], pulseS: [1, .8, .9, .7], kick: .6, bass: .6, mids: .5, highs: .5, hat: .5, energy: .5, drift: 1.3 };
const wMain = measure(null, ['rings', 'cosmic', 'forest'], uw, 512, 300, 'main'), wSky = measure(null, ['rings', 'cosmic', 'forest'], uw, 512, 300, 'sky');
// Per frame: the main pass plus half the sky pass (the sky is redrawn every other frame), scaled by each
// world's render scale against the old 0.7. Budget: no more GPU work per frame than Liquid Dreams' heaviest
// experience (Deep Flow, ~1540 per pixel at 0.72), which already runs on the box.
const GLX = {}; exp.replace(/id: '(\w+)', name: '[^']+', frag: \w+, glx: ([\d.]+)/g, (m, id, g) => { GLX[id] = +g; });
for (const w of ['rings', 'cosmic', 'forest']) {
  const frame = (wMain[w].mean + wSky[w].mean / 2) * Math.pow(GLX[w] / .7, 2);
  note(w + ' work per frame: main ' + wMain[w].mean.toFixed(0) + ' + sky ' + wSky[w].mean.toFixed(0) + '/2 at scale ' + GLX[w] + ' = ' + frame.toFixed(0) + ' (budget 1600)');
  assert(GLX[w] && frame < 1600, w + ' stays within the per-frame budget (' + frame.toFixed(0) + ')');
}

// ---------- D. the running app with music ----------
const SYN = `
function bandsAt(t, o, vol) {
  const beat = o.bpm ? 60 / o.bpm : 0, since = beat ? t % beat : 9, n = beat ? Math.floor(t / beat) : 0;
  const kick = beat && o.kick ? Math.exp(-since / .06) * o.kick : 0;
  const snare = beat && o.snare && n % 2 === 1 ? Math.exp(-since / .08) * o.snare : 0;
  const hat = beat && o.hat ? Math.exp(-Math.abs(since - beat / 2) / .02) * o.hat : 0;
  const j = () => 1 + (Math.random() - .5) * .12;
  const pad = (o.pad || 0) * (1 + .3 * Math.sin(t * .7));
  const b = [ .02 + pad * .3 + kick, .02 + pad * .4 + kick * .7, .02 + pad + snare * .5, .015 + pad * .7 + snare, .008 + hat * .7 + snare * .3 + pad * .05, .005 + hat ];
  return b.map(v => v * vol * j());
}
window.__kicksAt = [];
function play(o, ms, vol) { vol = vol || 1; return new Promise(res => { const t0 = performance.now(); let lastOld = 0, lastBeat = -1;
  const iv = setInterval(() => { const now = performance.now(), t = (now - t0) / 1000;
    if (now - t0 > ms) { clearInterval(iv); res(); return; }
    if (o.bpm && o.kick) { const n = Math.floor(t / (60 / o.bpm)); if (n !== lastBeat) { lastBeat = n; __kicksAt.push(t0 + n * 60000 / o.bpm); } }
    const b = bandsAt(t, o, vol);
    Nexus._meter6(b[0], b[1], b[2], b[3], b[4], b[5]);
    if (now - lastOld >= 80) { lastOld = now; const all = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5]) / 6; Nexus._meter(all, (b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2); }
  }, 33); }); }
async function drive(o, ms) {
  const S = []; __kicksAt = []; const p = play(o, ms); const t0 = performance.now(); let prevAge = 99, spawns = [];
  while (performance.now() - t0 < ms - 40) {
    const d = XP.ndDebug(); const now = performance.now();
    if (d.pulses[0] < prevAge - .05) spawns.push(now - d.pulses[0] * 1000);
    prevAge = d.pulses[0];
    S.push({ bass: d.music.bass, mid: d.music.mid, high: d.music.high, hat: d.music.hat, kick: d.music.kick, live: d.music.live });
    await wait(25);
  }
  await p;
  const avg = f => S.reduce((a, s) => a + f(s), 0) / Math.max(1, S.length), mx = f => S.reduce((a, s) => Math.max(a, f(s)), 0);
  // how far each pulse began from the nearest kick that was played
  const lag = spawns.map(t => { let best = 1e9; for (const k of __kicksAt) { const d = t - k; if (d > -40 && Math.abs(d) < Math.abs(best)) best = d; } return best; }).filter(x => x < 1e8);
  return { kicksPlayed: __kicksAt.length, pulses: spawns.length, lag: lag, bass: avg(s => s.bass), mid: avg(s => s.mid), high: avg(s => s.high), hatMax: mx(s => s.hat), live: S.filter(s => s.live).length / Math.max(1, S.length) };
}`;
const html = fs.readFileSync(path.join(H.assets, 'index.html'), 'utf8');
const scenario = SYN + `
 const until=async(f,ms)=>{const t0=performance.now();while(performance.now()-t0<ms){try{if(f())return true;}catch(e){}await wait(100);}return false;};
 document.querySelector('[data-act=night]').click();
 R.open=await until(()=>XP.active&&XP.current==='nightdrive'&&XP.ndDebug&&XP.ndDebug().frames>5,30000);
 R.analyser=XP.ndDebug().analyser; R.detail=window.__detail.slice(); R.twoPass=XP.ndDebug().twoPass; R.glx=XP.ndDebug().glx;
 R.silentStart=XP.ndDebug().music;
 const fr0=XP.ndDebug().frames, ft0=performance.now();
 R.electronic=await drive({bpm:128,kick:1,snare:.8,hat:.7,pad:.25},7000);
 R.frameMs=(performance.now()-ft0)/Math.max(1,XP.ndDebug().frames-fr0);
 R.bassHeavy=await drive({bpm:92,kick:1.3,pad:.15},6000);
 R.atmos=await drive({pad:.9},5000);
 R.varied=await drive({bpm:140,kick:.8,snare:.6,hat:1,pad:.5},5000);
 // switch worlds while the music plays
 const worlds=['cosmic','forest','rings']; R.switches=[];
 const pl=play({bpm:124,kick:1,snare:.7,hat:.6,pad:.3},6000);
 for(const w of worlds){document.querySelector('[data-world='+w+']').click();const f0=XP.ndDebug().frames;await wait(1700);R.switches.push({w:w,on:XP.ndDebug().world===w,frames:XP.ndDebug().frames-f0});}
 await pl;
 R.metLog=XP.ndDebug().metLog;
 // silence: everything settles
 await wait(2500);
 R.silence=XP.ndDebug().music; R.pulsesAfter=XP.ndDebug().pulses;
 R.frames=XP.ndDebug().frames;
 document.getElementById('xpClose').click(); await wait(400);
 R.closed=!XP.active; R.detailAfter=window.__detail.slice();`;
(async () => {
  const A = await H.runPage(html, scenario, { w: 640, h: 360, limit: 240000 });
  assert(!A.errors || !A.errors.length, 'no page errors: ' + (A.errors || []).join(' | '));
  assert(A.open, 'Night Drive opens from its home tile');
  assert(A.analyser && A.detail.includes(true), 'it switches the six-band feed on');
  assert(A.twoPass, 'the sky is drawn in its own pass and cached (two-pass rendering is active)');
  note('render scale in the app: ' + A.glx);
  const show = (n, r) => note(n + ': ' + r.kicksPlayed + ' kicks played -> ' + r.pulses + ' pulses, lag ' + (r.lag.length ? Math.round(r.lag.reduce((a, b) => a + b, 0) / r.lag.length) + ' ms avg / ' + Math.round(Math.max(...r.lag.map(Math.abs))) + ' max' : 'n/a') + '; bass ' + r.bass.toFixed(2) + ' mid ' + r.mid.toFixed(2) + ' high ' + r.high.toFixed(2) + ' hat max ' + r.hatMax.toFixed(2) + ' live ' + (100 * r.live).toFixed(0) + '%');
  for (const k of ['electronic', 'bassHeavy', 'atmos', 'varied']) show(k, A[k]);
  const e = A.electronic;
  assert(e.pulses >= e.kicksPlayed * .6, 'electronic: kicks become travelling pulses (' + e.pulses + ' of ' + e.kicksPlayed + ')');
  // a pulse can only start on the next drawn frame, so the allowance follows the frame time (33 ms on the box;
  // software rendering on a build machine is far slower)
  const lagAvg = e.lag.reduce((a, b) => a + b, 0) / Math.max(1, e.lag.length);
  note('frame time in this run: ' + A.frameMs.toFixed(0) + ' ms');
  assert(e.lag.length && lagAvg < Math.max(80, A.frameMs * 1.5), 'electronic: pulses land on the beat (avg lag ' + Math.round(lagAvg) + ' ms at ' + A.frameMs.toFixed(0) + ' ms per frame)');
  assert(e.mid > .1 && e.high > .1 && e.hatMax > .4 && e.bass > .15, 'electronic: bass, mids, highs and hats all reach their elements');
  const bh = A.bassHeavy;
  assert(bh.bass > .25 && bh.bass > bh.mid * 2 && bh.bass > bh.high * 3 && bh.pulses >= bh.kicksPlayed * .6, 'strong bass: the low end drives the big elements, not the small ones');
  assert(A.atmos.pulses <= 2 && A.atmos.mid > .15, 'slow atmospheric music: no beat pulses, the mids still light the scene');
  assert(A.varied.pulses >= A.varied.kicksPlayed * .5 && A.varied.hatMax > .4, 'varied music: kicks and hats both answered');
  assert(A.switches.every(s => s.on && s.frames > 3), 'worlds switch while music plays and keep drawing (' + JSON.stringify(A.switches) + ')');
  const sil = A.silence;
  assert(sil.bass < .05 && sil.mid < .05 && sil.high < .05 && sil.kick < .02 && !sil.live, 'silence: every reaction settles to rest (no fake movement)');
  assert(A.pulsesAfter.every(t => t > 2), 'silence: no new pulses without music');
  assert(A.metLog.length >= 2, 'shooting stars keep appearing (' + A.metLog.length + ' in the run)');
  const angs = A.metLog.map(m => m.ang), lens = A.metLog.map(m => m.len);
  assert(Math.max(...angs) - Math.min(...angs) > .3 && Math.max(...lens) - Math.min(...lens) > .03, 'shooting stars differ in direction and length');
  const gaps = A.metLog.slice(1).map((m, i) => m.at - A.metLog[i].at);
  if (gaps.length > 1) assert(Math.max(...gaps) - Math.min(...gaps) > 300, 'shooting stars are not on a fixed rhythm');
  assert(A.closed && A.detailAfter[A.detailAfter.length - 1] === false, 'closing Night Drive releases the detailed feed');
  console.log('Night Drive music & quality: per-band elements, no global flash, travelling beat pulses, shooting stars, forest structure, cost and the live app with four kinds of music verified.');
  if (!REPORT) lines.forEach(l => console.log('  ' + l));
})().catch(e => { console.error(e); process.exit(1); });
