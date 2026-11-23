// Liquid Dreams: how much near-white the music adds. Renders each experience with its default palette
// at several moments, quiet and with loud music (kick, hats, highs, bass, energy all up), and counts
// near-white pixels (every channel above 215). Also reports how much the colours themselves respond.
// Usage: node ld-white.js [experiences.js]   -> JSON on stdout
const fs = require('fs'), path = require('path');
const { render } = require('./nd-stills.js');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '../../app/src/main/assets/experiences.js'), 'utf8');
const i = src.indexOf('var GL_HEAD'); const GL_HEAD = eval('(' + src.slice(src.indexOf('=', i) + 1, src.indexOf(';\n', i)) + ')');
const a = src.indexOf('var LIQUID_DREAMS_SHADER = `') + 'var LIQUID_DREAMS_SHADER = `'.length; const LDS = src.slice(a, src.indexOf('`;', a));
const FNS = ['deepFlowLD', 'iridescenceLD', 'etherLD', 'chromeLD', 'cosmicLD', 'organicLD'];
const env = k => LDS.replace(/vec3 envLD\(float id,vec2 p,float t\)\{[^\n]*\}/, 'vec3 envLD(float id,vec2 p,float t){return ' + FNS[k] + '(p,t);}');
const pal = eval('(' + src.slice(src.indexOf('var LD_PALETTES = ') + 18, src.indexOf('};', src.indexOf('var LD_PALETTES = ')) + 1) + ')');
const envs = [['deepflow', 'deepteal'], ['iridescence', 'iridescent'], ['ether', 'violet'], ['chrome', 'chrome'], ['cosmic', 'obsidian'], ['organic', 'aurora']];
const W = +process.env.LD_W || 256, H = +process.env.LD_H || 150, jobs = {};
const base = { envA: 0, envB: 0, envMix: 0, moveAmt: .6, detailAmt: 1, complexity: .6, brightness: 1, quality: 0, gravPos: [0, 0], gravStr: 0, gravSpin: 0, touchHue: 0, colorWave: [0, 0, 0, 0] };
const QUIET = { bassL: 0, midL: 0, highL: 0, energyL: 0, kickL: 0, hatL: 0 }, LOUD = { bassL: .8, midL: .7, highL: .9, energyL: .8, kickL: 1, hatL: 1 };
envs.forEach(([e, p], k) => {
  const P = pal[p], u = Object.assign({}, base, { palN0: P.c[0], palN1: P.c[1], palN2: P.c[2], palN3: P.c[3], palO0: P.c[0], palO1: P.c[1], palO2: P.c[2], palO3: P.c[3], spectral: P.s, spectralO: P.s });
  for (const t of [7, 23, 41]) for (const cp of [.1, .55]) {
    jobs[e + '_' + t + '_' + cp + '_q'] = [GL_HEAD + env(k), Object.assign({}, u, QUIET, { time: t, flowT: t, colorPhase: cp })];
    jobs[e + '_' + t + '_' + cp + '_l'] = [GL_HEAD + env(k), Object.assign({}, u, LOUD, { time: t, flowT: t, colorPhase: cp })];
  }
});
// time is a GL_HEAD uniform; flowT is the shader's own clock
if (process.env.LD_PNG) for (const k of Object.keys(jobs)) if (!k.includes('_23_0.55_')) delete jobs[k];
const R = render(jobs, W, H, { img: !process.env.LD_PNG, reps: 1, png: !!process.env.LD_PNG });
if (process.env.LD_PNG) { fs.mkdirSync(process.env.LD_PNG, { recursive: true }); for (const k of Object.keys(R)) fs.writeFileSync(path.join(process.env.LD_PNG, k + '.png'), Buffer.from(R[k].png, 'base64')); }
if (process.env.LD_PNG) process.exit(0);
const out = {};
for (const [e] of envs) {
  let wq = 0, wl = 0, n = 0, chroma = 0, lumd = 0;
  for (const key of Object.keys(R)) if (key.startsWith(e + '_') && key.endsWith('_q')) {
    const q = R[key].img, l = R[key.slice(0, -1) + 'l'].img;
    for (let o = 0; o < q.length; o += 4) {
      // near-white or washed-out bright pixels: bright, with little colour left in them
      const white = (im) => { const mx = Math.max(im[o], im[o + 1], im[o + 2]), mn = Math.min(im[o], im[o + 1], im[o + 2]); return mx > 175 && (mx - mn) / mx < .28; };
      if (white(q)) wq++; if (white(l)) wl++; n++;
      const c = im => Math.max(im[o], im[o + 1], im[o + 2]) - Math.min(im[o], im[o + 1], im[o + 2]);
      chroma += c(l) - c(q); lumd += (l[o] + l[o + 1] + l[o + 2] - q[o] - q[o + 1] - q[o + 2]) / 3;
    }
  }
  out[e] = { whiteQuiet: +(100 * wq / n).toFixed(2), whiteLoud: +(100 * wl / n).toFixed(2), musicChroma: +(chroma / n).toFixed(1), musicBright: +(lumd / n).toFixed(1) };
}
console.log(JSON.stringify(out));
