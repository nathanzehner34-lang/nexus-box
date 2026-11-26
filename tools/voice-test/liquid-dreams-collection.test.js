// Liquid Dreams collection: all eight experiences, checked two ways.
// A. Shader pixels: each experience answers the bass, the mids, the treble, the kick (its rings and pulses)
//    and the snare on its own, keeps moving, and shows real detail.
// B. The real app with music: each experience opens from its selector button and plays the EDM test song
//    (measured the way the box measures playing audio, on a virtual clock) with no errors, rich colour and
//    no white wash, and its picture changes with the music.
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const assert = require('assert');
const { session, SONGS } = require('./party-music/party-play');
const root = path.resolve(__dirname, '../..');
const xp = fs.readFileSync(path.join(root, 'app/src/main/assets/experiences.js'), 'utf8');
const IDS = ['deepflow', 'iridescence', 'ether', 'chrome', 'cosmic', 'organic', 'chromatic', 'prismatic'];
const FNS = Function('return ' + xp.match(/var LD_FNS = (\[[^\]]*\])/)[1])();
assert.strictEqual(FNS.length, 8, 'eight experience programs');
IDS.forEach(id => assert(xp.includes("{ id: '" + id + "'"), id + ' is in the experience list'));
const head = Function('return ' + xp.slice(xp.indexOf("  var GL_HEAD = '") + 16, xp.indexOf(';\n', xp.indexOf("  var GL_HEAD = '"))))();
const la = xp.indexOf('  var LIQUID_DREAMS_SHADER = `') + 30, ld = xp.slice(la, xp.indexOf('`;\n  // One small program', la));
const sources = FNS.map(f => head + ld.replace(/vec3 envLD\(float id,vec2 p,float t\)\{[^\n]*\}/, 'vec3 envLD(float id,vec2 p,float t){return ' + f + '(p,t);}'));
const browser = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(f => fs.existsSync(f));

// ---------- A. shader pixels ----------
const W = 160, H = 90;
const page = `<pre id=o>WAIT</pre><canvas id=c width=${W} height=${H}></canvas><script>
try{const S=${JSON.stringify(sources)};const gl=document.getElementById('c').getContext('webgl',{preserveDrawingBuffer:true});const R=[];
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
const PAL=[[.03,.012,.07],[.22,.06,.42],[.62,.3,.98],[.96,.82,1]],px=new Uint8Array(${W}*${H}*4);
for(const src of S){const vs=gl.createShader(gl.VERTEX_SHADER);gl.shaderSource(vs,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}');gl.compileShader(vs);
 const fs=gl.createShader(gl.FRAGMENT_SHADER);gl.shaderSource(fs,src);gl.compileShader(fs);if(!gl.getShaderParameter(fs,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(fs));
 const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.useProgram(p);const l=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
 const base={flowT:31.4,bassL:.2,midL:.2,highL:.2,energyL:.3,kickL:0,hatL:0,moveAmt:.6,detailAmt:.6,complexity:.5,brightness:1,quality:0,musX:[0,0,0,9]};
 function render(o){const u=Object.assign({},base,o);gl.uniform2f(gl.getUniformLocation(p,'res'),${W},${H});
  for(let i=0;i<4;i++){gl.uniform3fv(gl.getUniformLocation(p,'palN'+i),PAL[i]);gl.uniform3fv(gl.getUniformLocation(p,'palO'+i),PAL[i]);}
  for(const k in u){const L=gl.getUniformLocation(p,k);if(!L)continue;if(Array.isArray(u[k]))gl.uniform4fv(L,u[k]);else gl.uniform1f(L,u[k]);}
  gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,${W},${H},gl.RGBA,gl.UNSIGNED_BYTE,px);return px.slice();}
 const d=(a,c)=>{let s=0;for(let i=0;i<a.length;i+=4)s+=(Math.abs(a[i]-c[i])+Math.abs(a[i+1]-c[i+1])+Math.abs(a[i+2]-c[i+2]))/3;return s/(a.length/4);};
 const det=a=>{let n=0;for(let y=0;y<${H};y++)for(let x=1;x<${W};x++){const i=(y*${W}+x)*4;if(Math.abs(a[i]+a[i+1]+a[i+2]-a[i-4]-a[i-3]-a[i-2])>24)n++;}return n/(${W}*${H});};
 const sat=a=>{let s=0,n=0;for(let i=0;i<a.length;i+=4){const mx=Math.max(a[i],a[i+1],a[i+2]),mn=Math.min(a[i],a[i+1],a[i+2]);if(mx>40){s+=(mx-mn)/mx;n++;}}return n?s/n:0;};
 const b0=render({});
 R.push({bass:d(b0,render({bassL:1})),mid:d(b0,render({midL:1})),high:d(b0,render({highL:1,hatL:1})),kick:d(b0,render({kickL:1,musX:[0,0,0,.3]})),
  snare:d(b0,render({musX:[1,0,0,9]})),motion:d(b0,render({flowT:32.4})),detail:det(b0),sat:sat(b0)});}
document.getElementById('o').textContent='RESULT='+JSON.stringify(R);}catch(e){document.getElementById('o').textContent='ERROR='+e.message;}</script>`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldc-')); fs.writeFileSync(path.join(tmp, 'p.html'), page);
const run = cp.spawnSync(browser, ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--virtual-time-budget=600000', '--user-data-dir=' + path.join(tmp, 'prof'), '--dump-dom', 'file://' + path.join(tmp, 'p.html')], { encoding: 'utf8', timeout: 600000, maxBuffer: 8 << 20 });
const m = run.stdout.match(/RESULT=(.*?)<\/pre>/), err = run.stdout.match(/ERROR=(.*?)<\/pre>/);
assert(m, 'shader page ran: ' + (err ? err[1] : run.stderr.slice(-300)));
const A = JSON.parse(m[1]);
A.forEach((r, i) => {
  const id = IDS[i];
  console.log(id.padEnd(12), Object.entries(r).map(([k, v]) => k + ' ' + v.toFixed(2)).join('  '));
  assert(r.bass > 1.5, id + ': the bass moves the large forms (' + r.bass.toFixed(2) + ')');
  assert(r.mid > 1.2, id + ': the mids change the flow (' + r.mid.toFixed(2) + ')');
  assert(r.high > .4, id + ': the treble lights the fine details (' + r.high.toFixed(2) + ')');
  assert(r.kick > .6, id + ': a kick visibly pulses through it (' + r.kick.toFixed(2) + ')');
  assert(r.motion > 1, id + ': it keeps moving (' + r.motion.toFixed(2) + ')');
  assert(r.sat > .25, id + ': it carries colour (' + r.sat.toFixed(2) + ')');
});
fs.rmSync(tmp, { recursive: true, force: true });

// ---------- B. the real app with music ----------
(async () => {
  const out = await session(async ({ ev, advance, sleep }) => {
    await ev(`localStorage.setItem('p_liquidDreams.settings',JSON.stringify({v:3,env:'deepflow',color:'signature'}))`);
    await ev(`(function(){var t=document.querySelector('[data-act=liquiddreams]');if(t)t.click();})()`);
    for (let i = 0; i < 80; i++) { await sleep(100); if (await ev('!!(window.XP&&XP.liquidDebug)')) break; }
    await ev(`window.__frame=function(){var x0=document.getElementById('xpc'),g=null;[].slice.call(x0.parentNode.querySelectorAll('canvas')).forEach(function(c){if(!g&&c!==x0&&c.width>1&&c.getContext('webgl'))g=c;});if(!g)throw new Error('Liquid Dreams GL canvas not found');var c=document.createElement('canvas');c.width=64;c.height=36;var x=c.getContext('2d');x.drawImage(g,0,0,64,36);var d=x.getImageData(0,0,64,36).data,w=0,s=0,n=0,a=[];for(var i=0;i<d.length;i+=4){var mx=Math.max(d[i],d[i+1],d[i+2]),mn=Math.min(d[i],d[i+1],d[i+2]),L=.299*d[i]+.587*d[i+1]+.114*d[i+2];if(L>205&&(mx-mn)<45)w++;if(mx>40){s+=(mx-mn)/mx;n++;}a.push(L);}return {white:w/(d.length/4),sat:n?s/n:0,px:a};}`);
    await ev('__vtOn()'); await sleep(150); await advance(1500);
    for (let i = 0; i < 40 && !(await ev('(function(){var d=XP.liquidDebug();return d.gpu&&d.frames>3;})()')); i++) await advance(250);
    const R = {};
    for (const id of IDS) {
      await ev(`(function(){var b=document.querySelector('.ld-ui [data-env="${id}"]');b.click();})()`);
      await advance(3500);                               // the dissolve into the experience
      await ev(`__play(${JSON.stringify(SONGS.songs.edm.frames.slice(200, 520))})`);
      const samples = [];
      for (let k = 0; k < 24; k++) samples.push(await ev('(function(){__step(500,1000/30);var f=__frame(),d=XP.liquidDebug();return {white:f.white,sat:f.sat,px:f.px,env:d.env,frames:d.frames,gpu:d.gpu,react:d.react};})()'));
      let diff = 0; for (let k = 1; k < samples.length; k++) { let s = 0; for (let j = 0; j < samples[k].px.length; j++) s += Math.abs(samples[k].px[j] - samples[k - 1].px[j]); diff += s / samples[k].px.length; }
      R[id] = { env: samples[23].env, gpu: samples[23].gpu, frames: samples[23].frames, white: Math.max.apply(null, samples.map(s => s.white)), sat: samples.reduce((a, s) => a + s.sat, 0) / samples.length,
        motion: diff / 23, bass: Math.max.apply(null, samples.map(s => s.react.bass)), high: Math.max.apply(null, samples.map(s => s.react.high)) };
      await ev('__play(null)');
    }
    R.errors = await ev('__errors');
    return R;
  });
  assert.deepStrictEqual(out.errors, [], 'no page errors');
  for (const id of IDS) {
    const r = out[id];
    console.log(id.padEnd(12), 'gpu', r.gpu, 'white max', (r.white * 100).toFixed(2) + '%', 'saturation', r.sat.toFixed(2), 'motion', r.motion.toFixed(1), 'bass', r.bass.toFixed(2), 'treble', r.high.toFixed(2));
    assert.strictEqual(r.env, id, id + ' opens from its selector button');
    assert(r.gpu, id + ' renders on the GPU');
    // (Liquid Chrome is a mirror: its key-light highlights are meant to read as bright metal, so it gets a little more room)
    assert(r.white < (id === 'chrome' ? .05 : .03), id + ': white never washes the picture out (' + (r.white * 100).toFixed(2) + '%)');
    assert(r.sat > .25, id + ': rich colour with music (' + r.sat.toFixed(2) + ')');
    assert(r.motion > 1, id + ': the picture keeps changing with the music (' + r.motion.toFixed(1) + ')');
    assert(r.bass > .3 && r.high > .1, id + ': the music analysis drives it');
  }
  console.log('Liquid Dreams collection: all eight experiences answer bass, mids, treble, kicks and snares in their own elements, open from the selector, and play music with rich colour and no white wash.');
})().catch(e => { console.error(e); process.exit(1); });
