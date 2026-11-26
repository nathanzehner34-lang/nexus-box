// Night Drive: ENCHANTED FOREST — checked in code and in rendered pixels.
// Run: node enchanted-forest.test.js
const fs = require('fs'), path = require('path'), cp = require('child_process'), assert = require('assert');
const exp = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/experiences.js'), 'utf8');
const i = exp.indexOf('var GL_HEAD');
const GL_HEAD = eval('(' + exp.slice(exp.indexOf('=', i) + 1, exp.indexOf(';\n', i)) + ')');
const lit = n => { const k = exp.indexOf('var ' + n + ' = `'); assert(k > 0, n + ' exists'); const a = exp.indexOf('`', k) + 1; return exp.slice(a, exp.indexOf('`;', a)); };
const HEAD = lit('ND_HEAD'), MAIN = lit('ND_MAIN'), FOREST = lit('ND_ENCHANTED_FOREST'), COSMIC = lit('ND_COSMIC_HIGHWAY'), RINGS = lit('ND_CELESTIAL_RINGS');

// ---- code ----
['ndSky', 'ndHaze', 'ndGround', 'ndRoadFx', 'ndOverlay'].forEach(h => assert(FOREST.includes('vec3 ' + h + '('), 'the forest implements ' + h));
assert(FOREST.includes('#define ND_OVERLAY') && MAIN.includes('#ifdef ND_OVERLAY'), 'the forest draws its standing trees and plants through the overlay hook');
assert(!COSMIC.includes('ND_OVERLAY') || COSMIC.includes('Light gates'), 'Cosmic Highway stands nothing up but its light gates');
assert(/\{ id: 'forest', name: 'ENCHANTED FOREST', frag: ND_ENCHANTED_FOREST[,} ]/.test(exp), 'Enchanted Forest is offered in the WORLD row');
assert(!/\b(car|cars|truck|vehicle|cockpit|dashboard|speedometer|building|person|people)\b/i.test(FOREST), 'no vehicles, buildings or people');
// no reversed smoothstep edges anywhere in Night Drive (undefined in GLSL; some GPUs return 0)
function smoothsteps(t) { const out = []; const re = /smoothstep\(/g; let m; while ((m = re.exec(t))) { let i = m.index + 11, d = 1, args = [], cur = ''; for (; i < t.length && d > 0; i++) { const c = t[i]; if (c === '(') d++; if (c === ')') { d--; if (!d) break; } if (c === ',' && d === 1) { args.push(cur); cur = ''; } else cur += c; } args.push(cur); out.push(args); } return out; }
const evalEdge = x => { try { return Function('aa', 'HALF', 'return ' + x.replace(/(\d)\.(?!\d)/g, '$1.0'))(0, 11); } catch (e) { return NaN; } };
for (const [n, t] of [['ND_MAIN', MAIN], ['ND_HEAD', HEAD], ['ND_CELESTIAL_RINGS', RINGS], ['ND_COSMIC_HIGHWAY', COSMIC], ['ND_ENCHANTED_FOREST', FOREST]])
  smoothsteps(t).forEach(([a, b]) => { const A = evalEdge(a), B = evalEdge(b); if (!isNaN(A) && !isNaN(B)) assert(A < B, n + ': reversed smoothstep edges ' + a + ', ' + b); });
assert(MAIN.includes('vec3 mirror = ndHaze(vec3(rd.x, -rd.y, rd.z), t);'), 'all three worlds get the wet-road reflection of their own horizon');
assert(/const float FS = 3\.0;/.test(FOREST), 'the forest is built at Night Drive scale');
(FOREST.match(/smoothstep\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,/g) || []).forEach(m => {
  const [a, b] = m.slice(11).split(',').map(Number);
  assert(a < b, 'no reversed smoothstep edges (undefined on some GPUs): ' + m);
});
['efTree', 'efFarTree', 'efGrass', 'efMushrooms', 'efFern', 'efRock', 'efFlowers', 'kick*react', 'bass*react', 'highs*react', 'mids*react', 'hat*react'].forEach(k => assert(FOREST.includes(k), 'forest uses ' + k));

// ---- pixels ----
const W = 320, H = 180;
const U = { travel: 5200, night: .55, react: 1, mids: .3, highs: .3, q: 0, fadeIn: 1, cA: [.25, .72, 1], cB: [.52, .35, 1], cC: [1, .35, .85], cD: [.25, .95, .82], time: 31, kick: 0, energy: .1, hue: 0 };
const noOverlay = FOREST.replace(/vec3 ndOverlay\(vec3 col, vec3 rd, vec2 uv, float t\)\{/, 'vec3 ndOverlay(vec3 col, vec3 rd, vec2 uv, float t){ return col;');
const build = w => GL_HEAD + HEAD + w + MAIN;
const jobs = {
  base: [build(FOREST), U], bare: [build(noOverlay), U],
  loud: [build(FOREST), Object.assign({}, U, { kick: .9, energy: .9, highs: .9, mids: .9, bass: .9, hat: .9, pulseT: [.3, .8, 1.3, 2], pulseS: [1, 1, 1, 1] })],
  later: [build(FOREST), Object.assign({}, U, { travel: U.travel + 40, time: U.time + .4 })],
  q1: [build(FOREST), Object.assign({}, U, { q: 1 })],
  cosmic: [build(COSMIC), U]
};
// Apparent speed: frames 1/30 s apart at DRIFT (42), CRUISE (96) and FAST (168) for the forest and Celestial Rings
const SPEEDS = { drift: 42, cruise: 96, fast: 168 };
for (const [sn, v] of Object.entries(SPEEDS)) for (const [wn, w] of [['forest', FOREST], ['rings', RINGS]]) for (const t0 of [5200, 9400]) {
  jobs['m_' + wn + '_' + sn + '_' + t0 + '_a'] = [build(w), Object.assign({}, U, { travel: t0 })];
  jobs['m_' + wn + '_' + sn + '_' + t0 + '_b'] = [build(w), Object.assign({}, U, { travel: t0 + v / 30 })];
}
const page = `<pre id=o>WAIT</pre><canvas id=c width=${W} height=${H}></canvas><script>
const gl=c.getContext('webgl',{preserveDrawingBuffer:true,antialias:false,alpha:false});const J=${JSON.stringify(jobs)};const R={};
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
function sh(t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o;}
const px=new Uint8Array(4);
try{for(const[k,[f,u]]of Object.entries(J)){const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);gl.useProgram(p);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
for(const[n,v]of Object.entries(Object.assign({res:[${W},${H}]},u))){const L=gl.getUniformLocation(p,n);if(L===null)continue;if(!Array.isArray(v))gl.uniform1f(L,v);else if(v.length===2)gl.uniform2f(L,...v);else if(v.length===4)gl.uniform4f(L,...v);else gl.uniform3f(L,...v);}
gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
let best=1e9;for(let r=0;r<3;r++){const t0=performance.now();gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);best=Math.min(best,performance.now()-t0);}
const a=new Uint8Array(${W * H * 4});gl.readPixels(0,0,${W},${H},gl.RGBA,gl.UNSIGNED_BYTE,a);R[k]={ms:best,img:Array.from(a)};}}catch(e){R.error=String(e.message||e);}
o.textContent='R='+JSON.stringify(R);</script>`;
const file = path.join(require('os').tmpdir(), 'enchanted-forest-test.html');
fs.writeFileSync(file, page);
const out = cp.spawnSync('google-chrome', ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 600000, maxBuffer: 1 << 30 }).stdout;
const m = out.match(/R=(\{.*\})/);
assert(m, 'the page rendered');
const R = JSON.parse(m[1]);
assert(!R.error, 'the forest compiles: ' + R.error);
// pixel helpers; readPixels rows start at the bottom of the screen
const lum = (img, x, y) => { const o = (y * W + x) * 4; return (img[o] + img[o + 1] + img[o + 2]) / 3; };
function region(img, x0, x1, y0, y1) { let s = 0, s2 = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = lum(img, x, y); s += v; s2 += v * v; n++; } const mean = s / n; return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) }; }
function diff(a, b, x0 = 0, x1 = W, y0 = 0, y1 = H) { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += Math.abs(lum(a, x, y) - lum(b, x, y)); n++; } return s / n; }
const base = R.base.img;
const all = region(base, 0, W, 0, H);
assert(all.mean > 10 && all.mean < 120, 'controlled overall brightness (' + all.mean.toFixed(1) + ')');
// the road: centre of the lower screen must stay what the road itself draws
const roadDiff = diff(base, R.bare.img, W * .38 | 0, W * .62 | 0, 0, H * .30 | 0);
assert(roadDiff < 4, 'the highway stays clear and central: nothing stands on it (' + roadDiff.toFixed(2) + ')');
// the trees: both sides above the road are full of structure the bare world does not have
const left = diff(base, R.bare.img, 0, W * .25 | 0, H * .5 | 0, H), right = diff(base, R.bare.img, W * .75 | 0, W, H * .5 | 0, H);
assert(left > 4 && right > 4, 'moonlit trees stand dark against the night sky on both sides (' + left.toFixed(1) + ', ' + right.toFixed(1) + ')');
assert(region(base, 0, W * .25 | 0, H * .5 | 0, H).std > 10, 'the forest has detail and contrast');
// tree crowns frame the top corners; the night sky stays open over the road
const topSides = region(base, 0, W * .2 | 0, H * .8 | 0, H), topMid = region(base, W * .44 | 0, W * .56 | 0, H * .8 | 0, H);
const topBare = region(R.bare.img, 0, W * .2 | 0, H * .8 | 0, H);
assert(Math.abs(topSides.mean - topBare.mean) > 1.5 || topSides.std > topBare.std + 2, 'tree crowns reach over the top corners');
assert(diff(base, R.bare.img, W * .44 | 0, W * .56 | 0, H * .8 | 0, H) < 3, 'the sky over the road stays open (' + topMid.mean.toFixed(1) + ')');
// colour: the moonlit night stays green-blue, never warm
let rg = 0; for (let o = 0; o < base.length; o += 4) rg += (base[o + 1] - base[o]); assert(rg / (W * H) > 3, 'emerald, cyan and moonlit blue dominate');
// music and movement
const music = diff(base, R.loud.img);
assert(music > .4, 'mushrooms, plants, roots and particles answer the music (' + music.toFixed(2) + ')');
const move = diff(base, R.later.img);
assert(move > 3, 'driving forward moves the forest past the camera (' + move.toFixed(2) + ')');
assert(diff(base, R.q1.img) > .2, 'the higher tier adds a further rank of trees and more particles');
// cost on the box tier compared with the existing heaviest road world
// cost is checked per pixel along the paths pixels really take in night-drive-music.test.js (nd-work.js):
// software WebGL runs every branch, so its timings measure program size rather than what the box executes
assert(R.base.ms < R.cosmic.ms * 3, 'the forest renders in software in reasonable time (' + R.base.ms.toFixed(1) + ' vs ' + R.cosmic.ms.toFixed(1) + ' ms)');
// block matching: how far textured 8x8 patches move between the two frames, in pixels
function flow(A, B, f) { const mags = []; const L = (img, x, y) => lum(img, x, y);
  for (let by = 8; by < H - 16; by += 8) for (let bx = 8; bx < W - 16; bx += 8) { if (!f(bx + 4, by + 4)) continue;
    let m = 0, v = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) m += L(A, bx + x, by + y); m /= 64; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const d = L(A, bx + x, by + y) - m; v += d * d; } if (v / 64 < 25) continue;
    let best = 1e9, bd = 0; for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) { const y0 = by + dy, x0 = bx + dx; if (y0 < 0 || x0 < 0 || y0 + 8 > H || x0 + 8 > W) continue; let sad = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sad += Math.abs(L(A, bx + x, by + y) - L(B, x0 + x, y0 + y)); sad += (Math.abs(dx) + Math.abs(dy)) * 2; if (sad < best) { best = sad; bd = Math.hypot(dx, dy); } }
    mags.push(bd); }
  return mags.length ? mags.reduce((a, b) => a + b, 0) / mags.length : 0; }
const sides = (x, y) => (x < W * .3 || x > W * .7) && y > H * .25, ground = (x, y) => y < H * .45 && (x < W * .3 || x > W * .7);
const speedReport = [];
for (const sn of Object.keys(SPEEDS)) {
  let fs = 0, fg = 0, rg = 0;
  for (const t0 of [5200, 9400]) { const g = k => R['m_' + k + '_' + sn + '_' + t0 + '_a'].img, h = k => R['m_' + k + '_' + sn + '_' + t0 + '_b'].img;
    fs += flow(g('forest'), h('forest'), sides) / 2; fg += flow(g('forest'), h('forest'), ground) / 2; rg += flow(g('rings'), h('rings'), ground) / 2; }
  speedReport.push(sn + ' forest sides ' + fs.toFixed(1) + ', forest verge ' + fg.toFixed(1) + ', rings verge ' + rg.toFixed(1));
  assert(fg < rg * 1.35 + .5, sn + ': the forest floor beside the road moves at the same rate as Celestial Rings (' + fg.toFixed(2) + ' vs ' + rg.toFixed(2) + ' px/frame)');
  assert(fs < rg * 1.1 + .5, sn + ': the trees no longer stream past faster than the scenery beside the road in Celestial Rings (' + fs.toFixed(2) + ' vs ' + rg.toFixed(2) + ' px/frame)');
}
console.log('Apparent speed (px per frame at 30 fps): ' + speedReport.join(' | '));
console.log('Enchanted Forest: hooks, road clearance, trees, open sky, colour, music, movement, tiers and cost verified (' + R.base.ms.toFixed(1) + ' ms vs Cosmic ' + R.cosmic.ms.toFixed(1) + ' ms)');
