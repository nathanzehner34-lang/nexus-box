// Night Drive work counter: SwiftShader runs every branch of a shader, so its timings measure the whole
// program, not what a real GPU executes. This instruments the shader instead: every hash() call and
// every exp/pow/sin in the world's code is counted per pixel along the path that pixel really takes,
// and the counts are read back as colour. The average is a fair stand-in for the per-pixel cost on a
// tile GPU like the box's PowerVR, whose pixel groups branch together over large coherent regions.
// Usage: node nd-work.js            -> prints average and 95th-percentile work for each world
const fs = require('fs'), path = require('path');
const { parts, render, BASE } = require('./nd-stills.js');
// approximate GPU ALU slots per call, so arithmetic-heavy code counts as well as noise
const COST = { exp: 4, pow: 6, sin: 4, cos: 4, atan: 8, sqrt: 3, smoothstep: 4, length: 3, normalize: 5, mix: 2 };
function instrument(P, world) {
  let head = P.GL_HEAD.replace('float hash(vec2 p){ return', 'float WORK = 0.;\nfloat hash(vec2 p){ WORK += 6.; return')
    .replace('float noise(vec2 p){', 'float noise(vec2 p){ WORK += 14.;');
  let body = P.HEAD + world + P.MAIN;
  body = body.replace(/\b(exp|pow|sin|cos|atan|sqrt|smoothstep|length|normalize|mix)\(/g, (m, f) => '_W' + f + '(');
  const T = ['float', 'vec2', 'vec3'];
  let W = '';
  for (const t of T) {
    for (const f of ['exp', 'sin', 'cos', 'sqrt']) W += `${t} _W${f}(${t} a){ WORK += ${COST[f]}.; return ${f}(a); }\n`;
    W += `${t} _Wpow(${t} a, ${t} b){ WORK += ${COST.pow}.; return pow(a, b); }\n`;
    W += `${t} _Wsmoothstep(${t} a, ${t} b, ${t} x){ WORK += ${COST.smoothstep}.; return smoothstep(a, b, x); }\n`;
    if (t !== 'float') W += `${t} _Wsmoothstep(float a, float b, ${t} x){ WORK += ${COST.smoothstep}.; return smoothstep(a, b, x); }\n`;
    W += `float _Wlength(${t} a){ WORK += ${COST.length}.; return length(a); }\n`;
    W += `${t} _Wnormalize(${t} a){ WORK += ${COST.normalize}.; return normalize(a); }\n`;
    W += `${t} _Wmix(${t} a, ${t} b, ${t} c){ WORK += ${COST.mix}.; return mix(a, b, c); }\n`;
    if (t !== 'float') W += `${t} _Wmix(${t} a, ${t} b, float c){ WORK += ${COST.mix}.; return mix(a, b, c); }\n`;
  }
  W += `float _Watan(float a, float b){ WORK += ${COST.atan}.; return atan(a, b); }\nfloat _Watan(float a){ WORK += ${COST.atan}.; return atan(a); }\n`;
  body = body.replace('gl_FragColor = vec4(clamp(col,0.,1.), 1.);', 'gl_FragColor = vec4(fract(WORK/256.), floor(WORK/256.)/255., 0., 1.);');
  return head + W + body;
}
// mode: undefined = single pass (sky drawn every frame); 'main' = the two-pass main program; 'sky' = the sky pass
function instrumentMode(P, world, mode) {
  if (mode === 'main') return instrument({ GL_HEAD: P.GL_HEAD, HEAD: '#define ND_SKYTEX\n' + P.HEAD, MAIN: P.MAIN }, world);
  if (mode === 'sky') return instrument({ GL_HEAD: P.GL_HEAD, HEAD: P.HEAD, MAIN: P.SKY.replace('gl_FragColor = vec4(c, gSkyOpen);', 'gl_FragColor = vec4(clamp(col,0.,1.), 1.);').replace('vec3 c = sqrt(', 'vec3 col = vec3(0.); vec3 c = sqrt(').replace("if(rd.y < -.022){ gl_FragColor = vec4(0.); return; }", "if(rd.y < -.022){ gl_FragColor = vec4(0.); return; }") }, world);
  return instrument(P, world);
}
function measure(src, worlds, u, W, H, mode) {
  W = W || 512; H = H || 300;
  const P = parts(src), jobs = {};
  for (const w of worlds) jobs[w] = [instrumentMode(P, P[w], mode), Object.assign({}, BASE, u || {})];
  const R = render(jobs, W, H, { img: true, reps: 1 });
  const out = {};
  for (const w of worlds) {
    const img = R[w].img, vals = [];
    for (let i = 0; i < img.length; i += 4) vals.push(img[i] + img[i + 1] * 256);
    vals.sort((a, b) => a - b);
    out[w] = { mean: vals.reduce((a, b) => a + b, 0) / vals.length, p95: vals[Math.floor(vals.length * .95)], max: vals[vals.length - 1] };
  }
  return out;
}
module.exports = { measure, instrument };
if (require.main === module) {
  const worlds = (process.env.ND_WORLDS || 'rings,cosmic,forest').split(',');
  const old = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : null;
  const u = { pulseT: [.3, .9, 1.5, 2.2], pulseS: [1, .8, .9, .7], kick: .6, bass: .6, mids: .5, highs: .5, hat: .5, energy: .5 };
  if (old) { const o = measure(old, worlds, u); for (const w of worlds) console.log('before', w, 'mean', o[w].mean.toFixed(1), 'p95', o[w].p95); }
  const n = measure(null, worlds, u); for (const w of worlds) console.log('now   ', w, 'mean', n[w].mean.toFixed(1), 'p95', n[w].p95);
}
