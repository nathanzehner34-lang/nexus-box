// Night Drive stills and cost: renders each world's real shader in headless Chrome (software WebGL)
// with chosen uniforms, saves PNGs and reports how long one frame takes.
// Usage: node nd-stills.js <outDir> [w] [h]      (renders rings, cosmic, forest, quiet and loud)
// Also used as a module: render(jobs, w, h) -> { name: { ms, png(base64), lum } }
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const exp = () => fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/experiences.js'), 'utf8');
function parts(src) {
  src = src || exp();
  const i = src.indexOf('var GL_HEAD');
  const GL_HEAD = eval('(' + src.slice(src.indexOf('=', i) + 1, src.indexOf(';\n', i)) + ')');
  const lit = n => { const k = src.indexOf('var ' + n + ' = `'); if (k < 0) throw new Error(n + ' missing'); const a = src.indexOf('`', k) + 1; return src.slice(a, src.indexOf('`;', a)); };
  const HEAD = lit('ND_HEAD'), MAIN = lit('ND_MAIN');
  return { GL_HEAD, HEAD, MAIN, rings: lit('ND_CELESTIAL_RINGS'), cosmic: lit('ND_COSMIC_HIGHWAY'), forest: lit('ND_ENCHANTED_FOREST'),
    build(w) { return GL_HEAD + HEAD + w + MAIN; } };
}
const BASE = { travel: 5200, night: .55, react: 1, mids: .3, highs: .3, q: 0, fadeIn: 1, cA: [.25, .72, 1], cB: [.52, .35, 1], cC: [1, .35, .85], cD: [.25, .95, .82], time: 31, kick: 0, energy: .3, hue: 0 };
function render(jobs, W, H, opts) {
  opts = opts || {};
  const page = `<pre id=o>WAIT</pre><canvas id=c width=${W} height=${H}></canvas><script>
const gl=c.getContext('webgl',{preserveDrawingBuffer:true,antialias:false,alpha:false});const J=${JSON.stringify(jobs)};const R={};
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
function sh(t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o;}
const px=new Uint8Array(4),progs={};
try{for(const[k,[f,u]]of Object.entries(J)){let p=progs[f];if(!p){p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));progs[f]=p;}gl.useProgram(p);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
for(const[n,v]of Object.entries(Object.assign({res:[${W},${H}]},u))){const L=gl.getUniformLocation(p,n);if(L===null)continue;if(!Array.isArray(v))gl.uniform1f(L,v);else if(v.length===2)gl.uniform2f(L,...v);else if(v.length===3)gl.uniform3f(L,...v);else gl.uniform4f(L,...v);}
gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
let best=1e9;for(let r=0;r<${opts.reps || 2};r++){const t0=performance.now();gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);best=Math.min(best,performance.now()-t0);}
const a=new Uint8Array(${W * H * 4});gl.readPixels(0,0,${W},${H},gl.RGBA,gl.UNSIGNED_BYTE,a);
R[k]={ms:best,${opts.png ? "png:c.toDataURL('image/png').split(',')[1]," : ''}img:${opts.img ? 'Array.from(a)' : 'null'}};}}catch(e){R.error=String(e.message||e);}
o.textContent='R='+JSON.stringify(R);</script>`;
  const file = path.join(os.tmpdir(), 'nd-stills-' + process.pid + '.html');
  fs.writeFileSync(file, page);
  const browser = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(f => fs.existsSync(f)) || 'google-chrome';
  const out = cp.spawnSync(browser, ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=' + W + ',' + (H + 60), '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 30 }).stdout;
  const m = out.match(/R=(\{.*\})/);
  if (!m) throw new Error('no result: ' + out.slice(0, 400));
  const R = JSON.parse(m[1]);
  if (R.error) throw new Error(R.error);
  return R;
}
module.exports = { parts, render, BASE };
if (require.main === module) {
  const dir = process.argv[2] || 'stills', W = +process.argv[3] || 1024, H = +process.argv[4] || 600;
  fs.mkdirSync(dir, { recursive: true });
  const P = parts(), jobs = {};
  const extra = process.env.ND_U ? JSON.parse(process.env.ND_U) : {};
  for (const w of (process.env.ND_WORLDS || 'rings,cosmic,forest').split(',')) {
    jobs[w + '_quiet'] = [P.build(P[w]), Object.assign({}, BASE, { kick: 0, energy: .05, mids: 0, highs: 0 }, extra)];
    jobs[w + '_loud'] = [P.build(P[w]), Object.assign({}, BASE, { kick: .9, energy: .8, mids: .7, highs: .7, bass: .8, snare: .6, hat: .6, pulseT: [.25, .9, 1.6, 99] }, extra)];
  }
  const R = render(jobs, W, H, { png: true });
  for (const [k, v] of Object.entries(R)) { fs.writeFileSync(path.join(dir, k + '.png'), Buffer.from(v.png, 'base64')); console.log(k, v.ms.toFixed(1) + ' ms'); }
}
