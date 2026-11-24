const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// Energy Flow upgrade: renders the real Party shader's Living Energy Field and Supernova Burst in a
// browser WebGL context and measures pixels, then opens the real app page and plays five synthetic
// music profiles through the audio meter to check the analysis and the visuals actually respond.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const party = fs.readFileSync(path.join(assets, 'party.js'), 'utf8');
const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const shaderSrc = (party.match(/var PARTY_SHADER = (\[[\s\S]*?\n {2}\])\.join\('\\n'\);/) || [])[1];
assert(shaderSrc, 'Party shader is embedded in party.js');
const shader = Function('return ' + shaderSrc)().join('\n');

// ---------- Static integration ----------
['noiseP', 'fbmP', 'flowPal', 'livingField', 'supernova', 'flowScene'].forEach(fn =>
  assert(shader.includes(fn + '('), 'shader defines ' + fn));
assert(!/vec3 ribbon\(/.test(shader), 'the old ribbon streams are gone, replaced by the energy field');
['build', 'bphase', 'burst', 'bAge', 'bPow', 'recoil', 'f1', 'f2', 'f3', 'f4'].forEach(u =>
  assert(new RegExp('uniform[^;]*\\b' + u + '\\b').test(shader), 'shader declares uniform ' + u));
// The field must not read the orb at all, or Energy Flow becomes Orb Mode.
const flowBody = shader.slice(shader.indexOf('vec3 livingField'), shader.indexOf('void main()'));
assert(!/orbR|orbC|heroOrb/.test(flowBody), 'Energy Flow never touches the hero orb');
// Orb Experience code is untouched.
['vec4 heroOrb(', 'vec3 bgClassic(', 'vec3 bgSmoke(', 'vec3 bgAurora(', 'vec3 bgDeep(', 'vec3 bgIrid('].forEach(fn =>
  assert(shader.includes(fn), 'Orb Experience keeps ' + fn));
Object.keys({ orb: 1, voltage: 1, aurora: 1, neon: 1 }).forEach(p =>
  assert(new RegExp(p + ':\\s*\\{[^}]*flow:\\s*\\[').test(party), 'preset ' + p + ' carries an Energy Flow palette'));
assert(/function triggerBurst/.test(party) && /function detectBurst/.test(party) && /function analyseMusic/.test(party),
  'party.js carries the burst event system and music analysis');
assert(/experience === 'flow' && glOk\) triggerBurst/.test(party), 'Bass Cannon fires a Supernova Burst in Energy Flow');
assert(html.includes('class="party-flow-caption"') && html.includes('data-experience="flow"'), 'Energy Flow controls are intact');
['.party-mode', '.party-preset', '.party-experience', '.party-backdrop', 'partyBass', 'partySound'].forEach(sel =>
  assert(party.includes(sel), 'control wiring kept: ' + sel));

const browser = process.env.LIQUID_DREAMS_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser && fs.existsSync(browser), 'Edge or Chrome is required for the actual WebGL render check');
const fileUrl = file => 'file:///' + file.replace(/\\/g, '/').replace(/^\//, '');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-flow-'));

function runPage(name, page, budget, size) {
  const htmlPath = path.join(temp, name + '.html');
  fs.writeFileSync(htmlPath, page);
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--allow-file-access-from-files', '--disable-extensions', '--hide-scrollbars', '--window-size=' + (size || '640,360'), '--user-data-dir=' + path.join(temp, 'profile-' + name)];
  if (budget) args.push('--virtual-time-budget=' + budget);
  args.push('--dump-dom', fileUrl(htmlPath));
  let run;
  for (let attempt = 1; attempt <= 3; attempt++) {
    run = cp.spawnSync(browser, args.map(x => x.startsWith('--user-data-dir=') ? x + '-' + attempt : x), { encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (!(run.error && run.error.code === 'ETIMEDOUT')) break;
  }
  if (run.error) throw run.error;
  const match = run.stdout.match(/RESULT=([\s\S]*?)<\/pre>/);
  if (!match) throw new Error((run.stdout.match(/ERROR=([\s\S]*?)<\/pre>/) || [])[1] || name + ' page returned no result. ' + run.stderr.slice(-300));
  return JSON.parse(match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}
// Real-time page run over the DevTools protocol: software-GL frames do not advance headless virtual
// time, so music scenarios play on the wall clock and the result element is polled.
async function runLive(name, page, limitMs, size) {
  const htmlPath = path.join(temp, name + '.html');
  fs.writeFileSync(htmlPath, page);
  const profile = path.join(temp, 'live-' + name);
  const proc = cp.spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--allow-file-access-from-files', '--disable-extensions', '--hide-scrollbars', '--window-size=' + (size || '640,360'), '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    let port = 0;
    for (let i = 0; i < 200 && !port; i++) { await sleep(100); try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (e) {} }
    assert(port, 'browser debugging port');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = {};
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
    const send = (method, params) => new Promise(res => { const n = ++id; pending[n] = res; ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    await send('Page.enable'); await send('Page.navigate', { url: fileUrl(htmlPath) });
    const start = Date.now(); let text = '';
    while (Date.now() - start < limitMs) {
      await sleep(500);
      const r = await send('Runtime.evaluate', { expression: '(document.getElementById("__out")||{}).textContent||""', returnByValue: true });
      text = (r.result && r.result.result && r.result.result.value) || '';
      if (/^(RESULT|ERROR)=/.test(text)) break;
    }
    ws.close();
    if (text.startsWith('ERROR=')) throw new Error(name + ': ' + text.slice(6));
    if (!text.startsWith('RESULT=')) throw new Error(name + ' did not finish: ' + text.slice(0, 600));
    return JSON.parse(text.slice(7));
  } finally { proc.kill('SIGKILL'); }
}

// ---------- A. Shader pixels: the field and the burst ----------
const shaderPage = `<!doctype html><meta charset="utf-8"><body><pre id="out">WAITING</pre><canvas id="c" width="200" height="120"></canvas><script>
const out=document.getElementById('out');
try{
 const gl=document.getElementById('c').getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl)throw new Error('WebGL context unavailable');
 function compile(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x;}
 const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,${JSON.stringify(shader)}));gl.linkProgram(p);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const l=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
 const W=200,H=120,px=new Uint8Array(W*H*4);
 const base={res:[W,H],orbC:[0,0],T:31.7,zph:12.3,bass:.25,mid:.25,high:.25,energy:.35,beat:.1,orbR:.105,quality:1,
   bgA:0,bgB:0,bgMix:0,flow:1,surge:0,build:0,bphase:.5,burst:0,bAge:9,bPow:0,recoil:0,
   c1:[.16,.92,1],c2:[.9,.98,1],c3:[.86,.38,.92],f1:[.12,.94,.85],f2:[.18,.48,1],f3:[.62,.29,1],f4:[1,.31,.75]};
 function render(over){const u=Object.assign({},base,over);
  for(const [k,v] of Object.entries(u)){const L=gl.getUniformLocation(p,k);if(L===null)throw new Error('missing uniform '+k);
   if(!Array.isArray(v))gl.uniform1f(L,v);else if(v.length===2)gl.uniform2f(L,v[0],v[1]);else gl.uniform3f(L,v[0],v[1],v[2]);}
  gl.viewport(0,0,W,H);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
  let lum=0,lit=0,inner=0,innerN=0,outer=0,outerN=0,rim=0,rimN=0,rays=0,sat=0;
  const bytes=[];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,L=.299*px[i]+.587*px[i+1]+.114*px[i+2];
   const dx=(x-W/2)/H,dy=(y-H/2)/H,r=Math.sqrt(dx*dx+dy*dy);
   lum+=L;if(L>30)lit++;
   const mx=Math.max(px[i],px[i+1],px[i+2]),mn=Math.min(px[i],px[i+1],px[i+2]);sat+=mx?(mx-mn)/mx:0;
   if(r<.12){inner+=L;innerN++;}
   if(r>.3&&r<.45){outer+=L;outerN++;}
   if(r>.52){rim+=L;rimN++;if(L>140)rays++;}
   if(i%193===0)bytes.push(px[i]);}
  const n=W*H;
  return {lum:lum/n,lit:lit/n,inner:inner/innerN,outer:outer/outerN,rim:rim/rimN,rays:rays/rimN,sat:sat/n,bytes:bytes};}
 const diff=(a,b)=>a.bytes.reduce((s,v,i)=>s+Math.abs(v-b.bytes[i]),0)/a.bytes.length;
 const R={};
 const quiet={bass:.02,mid:.03,high:.02,energy:.04,beat:0,bphase:.98};
 R.quiet=render(quiet);
 R.loud=render({bass:.9,mid:.75,high:.8,energy:.95,beat:.8,bphase:.1});
 R.bassLow=render({bass:0,energy:.3});R.bassHigh=render({bass:1,energy:.3});
 R.midLow=render({mid:0});R.midHigh=render({mid:1});
 R.highLow=render({high:0});R.highHigh=render({high:1});
 R.buildOff=render({build:0});R.buildOn=render({build:1});
 R.beatA=render({bphase:.05,beat:.9});R.beatB=render({bphase:.85,beat:.1});
 R.calm=render({});R.later=render({T:44.6,zph:19.4});R.muchLater=render({T:98.2,zph:52.1});
 R.burstOff=render({burst:0,bAge:9,bPow:0});
 R.burstEarly=render({burst:1,bAge:.1,bPow:1.5});
 R.burstMid=render({burst:.8,bAge:.5,bPow:1.5});
 R.burstLate=render({burst:.3,bAge:1.5,bPow:1.5});
 R.burstSmall=render({burst:.6,bAge:.5,bPow:.6});
 R.q0=render({quality:0});R.q0Loud=render({quality:0,bass:.9,mid:.75,high:.8,energy:.95});
 R.recoil=render({recoil:.8});
 R.orbA=render({flow:1,orbR:.4,orbC:[.3,.1]});
 R.d={music:diff(R.quiet,R.loud),bass:diff(R.bassLow,R.bassHigh),mid:diff(R.midLow,R.midHigh),
  high:diff(R.highLow,R.highHigh),build:diff(R.buildOff,R.buildOn),beat:diff(R.beatA,R.beatB),
  motion:diff(R.calm,R.later),motionFar:diff(R.calm,R.muchLater),burst:diff(R.burstOff,R.burstMid),
  burstAges:diff(R.burstEarly,R.burstLate),recoil:diff(R.calm,R.recoil),orb:diff(R.calm,R.orbA)};
 Object.keys(R).forEach(k=>{if(R[k]&&R[k].bytes)delete R[k].bytes;});
 out.textContent='RESULT='+JSON.stringify(R);
}catch(e){out.textContent='ERROR='+(e.stack||e);}
</script>`;
const S = runPage('flow-shader', shaderPage, 60000);

assert(S.quiet.lum > 4 && S.quiet.lit > .02, 'the field stays alive on quiet music (lum ' + S.quiet.lum.toFixed(1) + ')');
assert(S.loud.lum > S.quiet.lum * 1.8 && S.d.music > 8, 'loud music drives a far bigger, brighter field (' + S.quiet.lum.toFixed(1) + ' -> ' + S.loud.lum.toFixed(1) + ')');
assert(S.bassHigh.outer > S.bassLow.outer * 1.35 && S.d.bass > 6, 'bass expands the field outward (' + S.bassLow.outer.toFixed(1) + ' -> ' + S.bassHigh.outer.toFixed(1) + ')');
assert(S.d.mid > 5, 'midrange twists the filaments (' + S.d.mid.toFixed(1) + ')');
assert(S.d.high > 1.5, 'high frequencies add sparks and fine detail (' + S.d.high.toFixed(1) + ')');
assert(S.d.build > 3 && S.buildOn.lum > S.buildOff.lum, 'a build-up raises the intensity (' + S.d.build.toFixed(1) + ')');
assert(S.d.beat > 2, 'the beat pulse sweeps through the field (' + S.d.beat.toFixed(1) + ')');
assert(S.d.motion > 4 && S.d.motionFar > 4, 'the field never stops moving (' + S.d.motion.toFixed(1) + '/' + S.d.motionFar.toFixed(1) + ')');
assert(S.d.orb < .01, 'Energy Flow is not Orb Mode: orb size and position change nothing');
assert(S.quiet.sat > .3 && S.loud.sat > .3, 'the palette stays rich rather than washing out to white');

assert(S.d.burst > 10, 'the Supernova Burst transforms the frame (' + S.d.burst.toFixed(1) + ')');
assert(S.burstEarly.lum > S.burstOff.lum * 1.6 && S.burstEarly.rim > S.burstOff.rim * 3,
  'the burst detonates, flooding the whole frame with light (' + S.burstOff.lum.toFixed(1) + ' -> ' + S.burstEarly.lum.toFixed(1) + ')');
assert(S.burstMid.rays > S.burstOff.rays * 3 + .01, 'rays and particles reach the far edge of the frame (' + S.burstMid.rays.toFixed(3) + ' vs ' + S.burstOff.rays.toFixed(3) + ')');
assert(S.burstMid.rim > S.burstOff.rim * 1.2, 'the blast lights up the outer frame');
assert(S.burstLate.rays < S.burstMid.rays && S.d.burstAges > 8, 'the burst evolves and settles back rather than holding a pose');
assert(S.burstSmall.rim < S.burstMid.rim && S.burstSmall.rays < S.burstMid.rays,
  'a strong-hit burst is smaller than a full drop burst (' + S.burstSmall.rim.toFixed(1) + ' vs ' + S.burstMid.rim.toFixed(1) + ')');
assert(S.d.recoil > 2, 'the field draws back in after a blast before blooming again');
assert(S.q0.lum > 4 && S.q0.lit > .02 && S.q0Loud.lum > S.q0.lum, 'the 2 GB quality tier renders and still reacts');

// ---------- B. Real app page: five kinds of music ----------
function appPage(setup, scenario) {
  let page = html.replace(/(src|href)="(?!https?:)([^"]+\.(js|css))"/g, (m, a, f) => a + '="' + fileUrl(path.join(assets, f)) + '"');
  page = page.replace('<head>', '<head><script>window.__errors=[];addEventListener("error",e=>__errors.push(String(e.message)));' + setup + '</script>');
  page = page.replace('</body>', '<pre id="__out">WAITING</pre><script>setTimeout(async()=>{const out=document.getElementById("__out");try{const wait=ms=>new Promise(r=>setTimeout(r,ms));const R={};' + scenario + ';R.errors=__errors;out.textContent="RESULT="+JSON.stringify(R);}catch(e){out.textContent="ERROR="+(e.stack||e);}},600);</script></body>');
  return page;
}
const bridge = `window.__media=[];window.Android={getPref:()=>"",setPref:()=>{},partyMeter:()=>{},meter:()=>{},isMusicActive:()=>true,nowPlaying:()=>"",
  partyMediaInfo:()=>JSON.stringify({access:true,app:"com.spotify.music",title:"Signal Bloom",artist:"Violet Arc",playing:true,canPrevious:true,canNext:true,canPlayPause:true}),
  mediaPlayPause:()=>__media.push("toggle"),mediaNext:()=>__media.push("next"),mediaPrevious:()=>__media.push("prev"),mediaPause:()=>__media.push("pause"),deviceMemoryGb:()=>window.__mem||2};`;

// A tiny synthetic band generator: kick envelopes on the beat grid plus a sustained bed, fed to the
// meter at 25 ms like the real Android visualiser does.
const player = `
function play(opts,ms){return new Promise(res=>{const t0=performance.now();
 const iv=setInterval(()=>{const t=(performance.now()-t0)/1000;
  if(performance.now()-t0>ms){clearInterval(iv);res();return;}
  const beat=opts.bpm?60/opts.bpm:0;
  const since=beat?t-Math.floor(t/beat)*beat:9;
  const kick=beat?Math.exp(-since/0.07)*opts.kick:0;
  const ramp=opts.ramp?Math.min(1,t/(ms/1000)):0;
  const low=(opts.bed||0)+kick+(opts.rampLow||0)*ramp;
  const hat=beat&&Math.abs(since-beat/2)<0.05?opts.hat||0:0;
  const high=(opts.air||0)+hat+(opts.rampHigh||0)*ramp;
  const mid=(opts.mid||0)+kick*.3+(opts.rampMid||0)*ramp;
  const all=low*.5+mid*.3+high*.2+(opts.floor||0);
  Nexus._meter(all,low,mid,high);},25);});}`;

const scenario = player + `
 async function frames(n,limit){const s=NexusParty.state().glFrames;const t=Date.now();while(NexusParty.state().glFrames<s+n&&Date.now()-t<(limit||20000))await wait(50);return NexusParty.state().glFrames-s;}
 document.querySelector("[data-act=party]").click();await wait(300);
 R.f0=await frames(3);R.start=NexusParty.state();
 // 1. Slow atmospheric: a quiet pad, no percussion at all.
 await play({bed:.006,mid:.012,air:.004,floor:.004},6000);R.atmospheric=NexusParty.state();
 await wait(400);
 // 2. Electronic: a steady 128 BPM four-to-the-floor with hats.
 const e0=NexusParty.state().burstCount;
 await play({bpm:128,kick:.085,bed:.008,mid:.02,air:.006,hat:.03,floor:.006},9000);
 R.electronic=NexusParty.state();R.electronicBursts=R.electronic.burstCount-e0;
 await wait(400);
 // 3. Heavy bass: a loud, sustained low end.
 const h0=NexusParty.state().burstCount;
 await play({bpm:92,kick:.16,bed:.05,mid:.03,air:.008,floor:.02},7000);
 R.heavyBass=NexusParty.state();R.heavyBassBursts=R.heavyBass.burstCount-h0;
 await wait(400);
 // 4. Fast rhythmic: 172 BPM.
 await play({bpm:172,kick:.08,bed:.008,mid:.025,air:.01,hat:.025,floor:.006},8000);
 R.fast=NexusParty.state();
 await wait(600);
 // 5. Dramatic drop: a riser with no kick, then the drop lands.
 const d0=NexusParty.state().burstCount;
 await play({bed:.004,mid:.02,air:.01,floor:.005,ramp:1,rampLow:.004,rampMid:.05,rampHigh:.075},5000);
 R.beforeDrop=NexusParty.state();
 await play({bpm:120,kick:.22,bed:.06,mid:.05,air:.03,floor:.03},2500);
 R.afterDrop=NexusParty.state();R.dropBursts=R.afterDrop.burstCount-d0;R.dropPower=R.afterDrop.burstPower;
 // Bass Cannon fires a supernova by hand.
 const b0=NexusParty.state().burstCount;document.getElementById("partyBass").click();
 R.cannon=NexusParty.state();R.cannonBursts=R.cannon.burstCount-b0;
 // Silence: the analysis must settle instead of firing on nothing.
 await wait(2500);const s0=NexusParty.state().burstCount;await wait(2500);
 R.silentBursts=NexusParty.state().burstCount-s0;R.silent=NexusParty.state();
 // Orb Experience is untouched by any of this.
 document.querySelector(".party-experience[data-experience=orb]").click();await frames(2);
 R.midSwitch=NexusParty.state();
 const t=Date.now();while(NexusParty.state().flowMix>0&&Date.now()-t<20000)await wait(50);
 await frames(2);
 const c=document.getElementById("partyCanvas"),d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
 let drawn=false;for(let i=3;i<d.length;i+=4)if(d[i]){drawn=true;break;}
 R.orbRestored=drawn;R.orbState=NexusParty.state();R.mediaCalls=__media.length;
 document.querySelector(".party-exit").click();await wait(200);`;

(async () => {
  const app = await runLive('flow-music', appPage(bridge + 'window.__mem=2;Object.defineProperty(navigator,"deviceMemory",{get:()=>2});localStorage.setItem("nexus.party.experience","flow");', scenario), 220000, '640,360');
  assert.deepStrictEqual(app.errors, [], 'no page errors');
  assert(app.f0 >= 3 && app.start.gl && app.start.experience === 'flow',
    'Energy Flow opens with the GL field running ' + JSON.stringify(app.start));

  // 1. Slow atmospheric.
  assert(app.atmospheric.burstCount === 0, 'atmospheric music never detonates a burst (' + app.atmospheric.burstCount + ')');
  assert(app.atmospheric.build < .35, 'a steady pad is not mistaken for a build-up (' + app.atmospheric.build.toFixed(2) + ')');
  assert(app.atmospheric.energyFast < .05, 'the analysis reads the quiet mix as quiet');

  // 2. Electronic.
  assert(app.electronic.beatPeriod > .38 && app.electronic.beatPeriod < .56,
    '128 BPM is tracked as a ~0.47 s beat (' + app.electronic.beatPeriod.toFixed(3) + ')');
  assert(app.electronic.beatConfidence > .5, 'the beat clock locks on (' + app.electronic.beatConfidence.toFixed(2) + ')');
  assert(app.electronicBursts >= 1, 'steady electronic music does produce bursts');
  assert(app.electronicBursts <= 12, 'bursts stay events, not one per beat (' + app.electronicBursts + ' in 9 s)');

  // 3. Heavy bass.
  assert(app.heavyBass.bassFast > app.atmospheric.bassFast * 3, 'heavy bass registers in the analysis');
  assert(app.heavyBassBursts >= 1, 'heavy bass drives explosive events');

  // 4. Fast rhythmic.
  assert(app.fast.beatPeriod > .27 && app.fast.beatPeriod < .44,
    '172 BPM is tracked as a ~0.35 s beat (' + app.fast.beatPeriod.toFixed(3) + ')');
  assert(app.fast.beatPeriod < app.electronic.beatPeriod, 'faster music gives a faster pulse');

  // 5. Dramatic drop.
  assert(app.beforeDrop.build > .5, 'a riser is recognised as a build-up (' + app.beforeDrop.build.toFixed(2) + ')');
  assert(app.dropBursts >= 1 && app.dropPower > 1, 'the drop triggers a full-power Supernova Burst (power ' + app.dropPower.toFixed(2) + ')');
  assert(app.afterDrop.build < app.beforeDrop.build, 'the drop spends the build-up');

  assert(app.cannonBursts === 1 && app.cannon.burstPower > 1.2, 'BASS CANNON fires a supernova on demand');
  assert(app.silentBursts === 0, 'silence fires nothing');
  assert(app.silent.build < .3, 'the build-up decays in silence');

  assert(app.orbRestored && app.orbState.experience === 'orb' && app.orbState.flowMix === 0,
    'switching back restores the Orb Experience exactly as before');
  // Each experience runs a shader build with the other experience compiled out of it.
  assert(app.start.variant === 'flow', 'Energy Flow runs a build with no orb code in it (' + app.start.variant + ')');
  assert(app.orbState.variant === 'orb', 'the Orb Experience runs a build with no Energy Flow in it (' + app.orbState.variant + ')');
  assert(app.midSwitch.variant === 'both', 'only the crossfade itself needs the combined build (' + app.midSwitch.variant + ')');
  assert.strictEqual(app.mediaCalls, 0, 'Energy Flow never touches music playback');

  console.log('Energy Flow: living field + supernova burst verified in pixels, and the analysis answered atmospheric, electronic, heavy bass, fast rhythmic and drop-heavy music in the real app page.');
})().catch(e => { console.error(e); process.exit(1); });
