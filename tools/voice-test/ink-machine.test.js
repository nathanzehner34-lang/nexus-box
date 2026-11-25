const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// INK MACHINE: the third Party Mode experience. Renders the real Ink Machine shader in a browser
// WebGL context and measures pixels (music, explosions, the five gestures, palettes), then opens
// the real app page, switches to Ink Machine, plays music through the meter, performs every gesture
// with pointer events, and checks Orbs and Energy Flow still work around it.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const party = fs.readFileSync(path.join(assets, 'party.js'), 'utf8');
const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(assets, 'style.css'), 'utf8');
const inkSrc = (party.match(/var INK_SHADER = `([\s\S]*?)`;/) || [])[1];
assert(inkSrc, 'the Ink Machine shader is embedded in party.js');
const partySrc = (party.match(/var PARTY_SHADER = (\[[\s\S]*?\n {2}\])\.join\('\\n'\);/) || [])[1];
const partyShader = Function('return ' + partySrc)().join('\n');

// ---------- Static integration ----------
assert(/var experiences = \['orb', 'flow', 'ink'\]/.test(party), 'Ink Machine is the third Party experience');
assert((html.match(/data-experience="ink"/g) || []).length === 1 && html.includes('INK MACHINE'), 'one INK MACHINE button in the existing selector');
assert(html.includes('data-experience="orb"') && html.includes('data-experience="flow"'), 'Orbs and Energy Flow keep their buttons');
assert(css.includes('#party[data-experience="ink"] .party-modes,#party[data-experience="ink"] .party-backdrops { display:none; }'), 'orb-only controls hide in Ink Machine');
assert(!/inkPal|splashAge|blastAge|INK_/.test(partyShader), 'the Orb / Energy Flow shader carries nothing of Ink Machine');
['ELECTRIC OCEAN', 'TOXIC FUSION', 'PRISMATIC', 'INFERNO'].forEach(n => assert(party.includes("name: '" + n + "'"), 'palette ' + n));
assert((html.match(/class="party-preset/g) || []).length === 4, 'no duplicate colour controls: still the four COLOUR buttons');
assert(/detectBurst\(now\); detectInk\(now\);/.test(party), 'Ink Machine listens to the same beat detector as Energy Flow');
assert(/if \(experience === 'ink' && glOk\) triggerInk\(1\.4\);/.test(party), 'Bass Cannon sets off an ink explosion');
assert(!/Math\.random/.test(party.slice(party.indexOf('function detectInk'), party.indexOf('function syncExperienceUi'))),
  'ink events come from the music and the fingers, never from random triggers');
(inkSrc.match(/smoothstep\(\s*-?[\d.]+\s*,\s*-?[\d.]+/g) || []).forEach(m => {
  const e = m.slice(11).split(',').map(Number);
  assert(e[0] < e[1], 'only well-defined smoothstep edges: ' + m);
});

const browser = process.env.LIQUID_DREAMS_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser && fs.existsSync(browser), 'Edge or Chrome is required for the actual WebGL render check');
const fileUrl = file => 'file:///' + file.replace(/\\/g, '/').replace(/^\//, '');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-machine-'));

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

// ---------- A. The liquid, in pixels ----------
const shaderPage = `<!doctype html><meta charset="utf-8"><body><pre id="out">WAITING</pre><canvas id="c" width="240" height="135"></canvas><script>
const out=document.getElementById('out');
try{
 const gl=document.getElementById('c').getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl)throw new Error('WebGL context unavailable');
 function compile(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x;}
 const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,${JSON.stringify(inkSrc)}));gl.linkProgram(p);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const l=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
 const W=240,H=135,px=new Uint8Array(W*H*4);
 const OCEAN={k1:[.04,.16,.95],k2:[0,.85,1],k3:[.48,.12,1],k4:[.2,.5,1],k5:[.75,.92,1],prism:0};
 const INFERNO={k1:[.75,.02,.08],k2:[1,.35,0],k3:[1,.75,.15],k4:[.95,.12,.05],k5:[1,.95,.85],prism:0};
 const base=Object.assign({res:[W,H],T:60,bass:.3,mid:.3,high:.3,energy:.35,beat:.15,blast:0,blastAge:9,build:0,quality:1,swirl:.4,fadeIn:1,
  bursts:[0,0,9,0,0,0,9,0,0,0,9,0],drags:new Array(16).fill(0),twist:[0,0,0,0],splash:[0,0,0,0],splashAge:9,inj:[0,0,0,0,0,0,0,0]},OCEAN);
 const arrays={bursts:1,drags:1,inj:1};
 function render(over){const u=Object.assign({},base,over);
  for(const [k,v] of Object.entries(u)){const L=gl.getUniformLocation(p,k);if(L===null)throw new Error('missing uniform '+k);
   if(!Array.isArray(v))gl.uniform1f(L,v);else if(arrays[k])gl.uniform4fv(L,new Float32Array(v));else if(v.length===2)gl.uniform2f(L,v[0],v[1]);else if(v.length===3)gl.uniform3f(L,v[0],v[1],v[2]);else gl.uniform4f(L,v[0],v[1],v[2],v[3]);}
  gl.viewport(0,0,W,H);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
  let lum=0,lit=0,centre=0,cN=0,edge=0,eN=0,sat=0,satN=0,spec=0,r=0,g=0,bl=0;const bytes=[];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,L=.299*px[i]+.587*px[i+1]+.114*px[i+2];
   lum+=L;if(L>40)lit++;if(Math.max(px[i],px[i+1],px[i+2])>225)spec++;   // highlights: vivid peak light (colour, not white)
   const dx=(x-W/2)/H,dy=(y-H/2)/H,rr=Math.sqrt(dx*dx+dy*dy);
   if(rr<.22){centre+=L;cN++;} if(Math.abs(dx)>.72||Math.abs(dy)>.44){edge+=L;eN++;}
   const mx=Math.max(px[i],px[i+1],px[i+2]),mn=Math.min(px[i],px[i+1],px[i+2]);if(L>40){sat+=mx?(mx-mn)/mx:0;satN++;r+=px[i];g+=px[i+1];bl+=px[i+2];}}
  for(let i=0;i<px.length;i+=97)bytes.push(px[i]);
  // detail: share of pixels with a sharp step to the next pixel (crisp edges and fine structure)
  let det=0;for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=(y*W+x)*4,j=i+4,k=i+W*4;
   const a=.299*px[i]+.587*px[i+1]+.114*px[i+2],b=.299*px[j]+.587*px[j+1]+.114*px[j+2],c=.299*px[k]+.587*px[k+1]+.114*px[k+2];
   if(Math.abs(a-b)>14||Math.abs(a-c)>14)det++;}
  const n=W*H;return {detail:det/n,lum:lum/n,lit:lit/n,centre:centre/cN,edge:edge/eN,sat:sat/Math.max(1,satN),spec:spec/n,rgb:[r,g,bl].map(v=>v/Math.max(1,satN)),bytes};}
 const diff=(a,b)=>a.bytes.reduce((s,v,i)=>s+Math.abs(v-b.bytes[i]),0)/a.bytes.length;
 const R={};
 R.hero=render({});
 R.quiet=render({bass:0,mid:0,high:0,energy:0,beat:0,swirl:.1});
 R.loud=render({bass:.95,mid:.85,high:.85,energy:.9,beat:.8,swirl:1.3});
 R.bassOnly=render({bass:.95});
 R.midTwist=render({swirl:1.5,mid:.9});
 R.highOnly=render({high:.95});
 R.later=render({T:72});R.much=render({T:180});
 R.blastPeak=render({blast:1,blastAge:.35});R.blastLate=render({blast:.15,blastAge:2.2});
 R.burst=render({bursts:[.12,.02,.3,1,0,0,9,0,0,0,9,0]});
 R.twist=render({twist:[-.05,.02,.85,3.5]});
 R.drag=render({drags:[.3,.05,1.8,.3,.45,.08,1.6,.3,.6,.1,1.2,.25,0,0,0,0]});
 R.splash=render({splash:[.05,0,1.8,.6],splashAge:.5});
 R.inject=render({inj:[-.04,0,1.4,.5,0,0,0,0]});
 R.inferno=render(INFERNO);
 R.prism=render({prism:1,k1:[.9,.2,.6],k2:[.2,.8,1],k3:[1,.85,.2],k4:[.5,.3,1],k5:[1,1,1]});
 R.black=render({fadeIn:0});
 R.q0=render({quality:0});
 R.d={music:diff(R.quiet,R.loud),bass:diff(R.hero,R.bassOnly),mid:diff(R.hero,R.midTwist),high:diff(R.hero,R.highOnly),
  motion:diff(R.hero,R.later),far:diff(R.hero,R.much),blast:diff(R.hero,R.blastPeak),settle:diff(R.hero,R.blastLate),
  burst:diff(R.hero,R.burst),twist:diff(R.hero,R.twist),drag:diff(R.hero,R.drag),splash:diff(R.hero,R.splash),inject:diff(R.hero,R.inject),
  palette:diff(R.hero,R.inferno),prism:diff(R.hero,R.prism),tier:diff(R.hero,R.q0)};
 Object.keys(R).forEach(k=>{if(R[k]&&R[k].bytes)delete R[k].bytes;});
 out.textContent='RESULT='+JSON.stringify(R);
}catch(e){out.textContent='ERROR='+(e.stack||e);}
</script>`;
const S = runPage('ink-shader', shaderPage, 90000);
const D = S.d; if (process.env.INK_DEBUG) console.log(JSON.stringify(S));
assert(S.hero.centre > S.hero.edge * 6 && S.hero.edge < 12, 'a glowing tunnel core with deep space around it (' + S.hero.centre.toFixed(1) + ' vs edge ' + S.hero.edge.toFixed(1) + ')');
assert(S.hero.lit > .12 && S.hero.lit < .65, 'the membranes fill the centre, not the whole screen (' + (S.hero.lit * 100).toFixed(0) + '% lit)');
assert(S.hero.detail > .06, 'distinct structures with crisp glowing edges, not a soft blob (' + (S.hero.detail * 100).toFixed(1) + '% sharp-edge pixels)');
assert(S.hero.sat > .45, 'rich, saturated colour (' + S.hero.sat.toFixed(2) + ')');
assert(S.hero.spec > .0005, 'bright glowing rims catch the eye (' + (S.hero.spec * 100).toFixed(2) + '% of pixels)');
assert(D.motion > 2 && D.far > 6, 'the liquid keeps moving and evolving (' + D.motion.toFixed(1) + ', ' + D.far.toFixed(1) + ')');
assert(D.music > 6 && S.loud.lit > S.quiet.lit, 'loud music makes a bigger, livelier formation than quiet music (' + D.music.toFixed(1) + ')');
assert(S.bassOnly.lit > S.hero.lit && D.bass > 2, 'bass swells the membranes (' + (S.hero.lit * 100).toFixed(1) + '% -> ' + (S.bassOnly.lit * 100).toFixed(1) + '%)');
assert(D.mid > 3, 'the mids twist and fold it (' + D.mid.toFixed(1) + ')');
assert(D.high > 1 && S.highOnly.spec > S.hero.spec * 1.5, 'the treble adds ripples and glints (' + (S.hero.spec * 100).toFixed(2) + '% -> ' + (S.highOnly.spec * 100).toFixed(2) + '% highlights)');
assert(S.blastPeak.lit > S.hero.lit * 1.3 && D.blast > 8, 'a drop bursts down the tunnel (' + (S.blastPeak.lit * 100).toFixed(0) + '% lit)');
assert(S.blastLate.lit < S.blastPeak.lit && D.settle < D.blast, 'after the burst the tunnel settles again');
assert(S.blastPeak.lit < .9, 'even the biggest explosion leaves dark space around it');
['burst', 'twist', 'drag', 'splash', 'inject'].forEach(k => assert(D[k] > 1.2, 'the ' + k + ' gesture visibly changes the liquid (' + D[k].toFixed(1) + ')'));
assert(D.palette > 10 && S.inferno.rgb[0] > S.inferno.rgb[2] * 1.5 && S.hero.rgb[2] > S.hero.rgb[0], 'Electric Ocean is blue, Inferno is red-orange');
assert(D.prism > 5, 'Prismatic is its own iridescent palette');
assert(S.black.lum < 1.5, 'it fades in from black');
assert(S.q0.lit > .1 && S.q0.centre > S.q0.edge * 6, 'the 2 GB quality tier renders the same tunnel');

// ---------- B. The real app ----------
function appPage(setup, scenario) {
  let page = html.replace(/(src|href)="(?!https?:)([^"]+\.(js|css))"/g, (m, a, f) => a + '="' + fileUrl(path.join(assets, f)) + '"');
  page = page.replace('<head>', '<head><script>window.__errors=[];addEventListener("error",e=>__errors.push(String(e.message)));' + setup + '</script>');
  page = page.replace('</body>', '<pre id="__out">WAITING</pre><script>setTimeout(async()=>{const out=document.getElementById("__out");try{const wait=ms=>new Promise(r=>setTimeout(r,ms));const R={};' + scenario + ';R.errors=__errors;out.textContent="RESULT="+JSON.stringify(R);}catch(e){out.textContent="ERROR="+(e.stack||e);}},600);</script></body>');
  return page;
}
const bridge = `window.__media=[];window.Android={getPref:()=>"",setPref:()=>{},partyMeter:()=>{},meter:()=>{},isMusicActive:()=>true,nowPlaying:()=>"",
  partyMediaInfo:()=>JSON.stringify({access:true,app:"com.spotify.music",title:"Signal Bloom",artist:"Violet Arc",playing:true,canPrevious:true,canNext:true,canPlayPause:true}),
  mediaPlayPause:()=>__media.push("toggle"),mediaNext:()=>__media.push("next"),mediaPrevious:()=>__media.push("prev"),mediaPause:()=>__media.push("pause"),deviceMemoryGb:()=>window.__mem||2};`;
const player = `
function play(opts,ms){return new Promise(res=>{const t0=performance.now();
 const iv=setInterval(()=>{const t=(performance.now()-t0)/1000;
  if(performance.now()-t0>ms){clearInterval(iv);res();return;}
  const beat=opts.bpm?60/opts.bpm:0;const since=beat?t-Math.floor(t/beat)*beat:9;
  const kick=beat?Math.exp(-since/0.07)*opts.kick:0;const ramp=opts.ramp?Math.min(1,t/(ms/1000)):0;
  const low=(opts.bed||0)+kick+(opts.rampLow||0)*ramp;const hat=beat&&Math.abs(since-beat/2)<0.05?opts.hat||0:0;
  const high=(opts.air||0)+hat+(opts.rampHigh||0)*ramp;const mid=(opts.mid||0)+kick*.3+(opts.rampMid||0)*ramp;
  Nexus._meter(low*.5+mid*.3+high*.2+(opts.floor||0),low,mid,high);},25);});}`;
const scenario = player + `
 const S=()=>NexusParty.state(), I=()=>NexusParty.state().ink, cv=document.getElementById("partyCanvas");
 async function frames(n,limit){const s=S().glFrames;const t=Date.now();while(S().glFrames<s+n&&Date.now()-t<(limit||20000))await wait(40);return S().glFrames-s;}
 async function until(f,limit){const t=Date.now();while(!f()&&Date.now()-t<(limit||20000))await wait(40);return f();}
 function ev(type,x,y,id){const r=cv.getBoundingClientRect();cv.dispatchEvent(new PointerEvent(type,{clientX:r.left+x*r.width,clientY:r.top+y*r.height,pointerId:id||5,isPrimary:true,bubbles:true,cancelable:true}));}
 async function moveTo(x0,y0,x1,y1,ms,steps){for(let i=1;i<=steps;i++){await wait(ms/steps);ev("pointermove",x0+(x1-x0)*i/steps,y0+(y1-y0)*i/steps);}}
 document.querySelector("[data-act=party]").click();await wait(300);await frames(3);
 R.orbFirst=S().experience;
 // switch from Orbs to Ink Machine with the existing selector
 document.querySelector(".party-experience[data-experience=ink]").click();await frames(1);
 R.midFade={mix:I().mix,opacity:document.getElementById("partyGL").style.opacity};
 R.arrived=await until(()=>I().mix>=1&&I().frames>2,20000);
 R.inkState=S();R.pressed=document.querySelector(".party-experience[data-experience=ink]").getAttribute("aria-pressed");
 R.modesHidden=getComputedStyle(document.querySelector(".party-modes")).display==="none"&&getComputedStyle(document.querySelector(".party-backdrops")).display==="none";
 R.caption=getComputedStyle(document.querySelector(".party-ink-caption")).display!=="none";
 R.labels=[...document.querySelectorAll(".party-preset")].map(b=>b.textContent);
 const d2=cv.getContext("2d").getImageData(0,0,cv.width,cv.height).data;let any=false;for(let i=3;i<d2.length;i+=4)if(d2[i]){any=true;break;}R.orbLayerClear=!any;
 // palettes through the existing COLOUR buttons, blending rather than cutting
 document.querySelector(".party-preset[data-preset=neon]").click();await frames(1);R.palMid=I().cols[0];await wait(1800);await frames(2);R.palEnd=I().cols[0];R.palName=I().palette;
 document.querySelector(".party-preset[data-preset=orb]").click();
 // ---- the five gestures ----
 const g0=I().gestures;
 ev("pointerdown",.6,.5);await wait(80);ev("pointerup",.6,.5);await frames(2);R.afterTap=I();
 await wait(500);
 ev("pointerdown",.4,.45);await wait(1300);await frames(2);R.holding=I();
 await moveTo(.4,.45,.42,.47,120,2);R.holdMoved=I();ev("pointerup",.42,.47);await wait(700);await frames(2);R.released=I();
 await wait(400);
 ev("pointerdown",.3,.6);await moveTo(.3,.6,.55,.5,700,14);R.dragging=I();ev("pointerup",.55,.5);await frames(2);R.afterDrag=I();await wait(2500);await frames(2);R.dragLater=I();
 ev("pointerdown",.35,.5);await moveTo(.35,.5,.75,.42,90,4);ev("pointerup",.75,.42);await frames(2);R.afterFlick=I();
 await wait(500);
 ev("pointerdown",.55,.55);await wait(70);ev("pointerup",.55,.55);await wait(120);ev("pointerdown",.55,.55);await wait(1200);await frames(2);R.injecting=I();ev("pointerup",.55,.55);await wait(300);R.injected=I();
 R.gestures=I().gestures;R.g0=g0;
 // ---- music ----
 await wait(1500);
 const b0=I().blastCount;
 await play({bed:.006,mid:.012,air:.004,floor:.004},5000);R.quiet=S();R.quietBlasts=I().blastCount-b0;
 const b1=I().blastCount;
 await play({bpm:128,kick:.085,bed:.008,mid:.02,air:.006,hat:.03,floor:.006},7000);R.groove=S();R.grooveBlasts=I().blastCount-b1;
 await play({bed:.004,mid:.02,air:.01,floor:.005,ramp:1,rampLow:.004,rampMid:.05,rampHigh:.075},4500);R.riser=I();
 const b2=I().blastCount;
 await play({bpm:120,kick:.22,bed:.06,mid:.05,air:.03,floor:.03},2500);R.drop=I();R.dropBlasts=I().blastCount-b2;
 const b3=I().blastCount;document.getElementById("partyBass").click();await frames(2);R.cannon=I().blastCount-b3;
 await wait(2500);const s0=I().blastCount;await wait(2500);R.silentBlasts=I().blastCount-s0;
 // ---- frame pacing at the 2 GB setting ----
 const f0=S().glFrames,t0=performance.now();await wait(3000);R.fps=(S().glFrames-f0)/((performance.now()-t0)/1000);
 // ---- back to Orbs and Energy Flow ----
 document.querySelector(".party-experience[data-experience=orb]").click();
 R.orbBack=await until(()=>I().mix<=0,20000);await frames(3);
 const d3=cv.getContext("2d").getImageData(0,0,cv.width,cv.height).data;let drawn=false;for(let i=3;i<d3.length;i+=4)if(d3[i]){drawn=true;break;}
 R.orbDrawn=drawn;R.orbState=S();R.orbLabels=[...document.querySelectorAll(".party-preset")].map(b=>b.textContent);
 R.glOpacity=document.getElementById("partyGL").style.opacity;
 document.querySelector(".party-experience[data-experience=flow]").click();
 R.flowOk=await until(()=>S().flowMix>=1,20000);R.flowVariant=S().variant;
 document.querySelector(".party-experience[data-experience=ink]").click();await until(()=>I().mix>=1,20000);
 document.querySelector(".party-exit").click();await wait(400);
 document.querySelector("[data-act=party]").click();await wait(300);await frames(3);
 R.reopened=S();R.mediaCalls=__media.length;
 document.querySelector(".party-exit").click();await wait(200);`;

(async () => {
  const app = await runLive('ink-app', appPage(bridge + 'window.__mem=2;Object.defineProperty(navigator,"deviceMemory",{get:()=>2});localStorage.setItem("nexus.party.experience","orb");', scenario), 300000, '640,360');
  assert.deepStrictEqual(app.errors, [], 'no page errors');
  assert.strictEqual(app.orbFirst, 'orb', 'Party opens in Orbs as before');
  assert(app.midFade.mix > 0 && app.midFade.mix < .5, 'the switch to Ink Machine is a fade, not a cut ' + JSON.stringify(app.midFade));
  assert(app.arrived && app.inkState.experience === 'ink' && app.inkState.variant === 'ink' && app.pressed === 'true', 'Ink Machine runs on its own GPU program ' + JSON.stringify(app.inkState.ink));
  assert(app.modesHidden && app.caption, 'orb-only controls step aside and the gesture guide shows');
  assert(app.orbLayerClear, 'no orbs are drawn over the ink');
  assert.deepStrictEqual(app.labels, ['ELECTRIC OCEAN', 'TOXIC FUSION', 'PRISMATIC', 'INFERNO'], 'the COLOUR buttons name the ink palettes');
  assert(app.palName === 'neon' && app.palEnd[0] > .7 && app.palMid[0] < app.palEnd[0], 'Inferno blends in over the old colours ' + JSON.stringify([app.palMid, app.palEnd]));
  // gestures
  assert(app.afterTap.gestures.burst === app.g0.burst + 1 && app.afterTap.burstAge < 1, 'a tap makes an Ink Burst');
  assert(app.holding.twist.on && app.holding.twist.wind > 1 && app.holding.gestures.twist === app.g0.twist + 1, 'holding still winds up a Liquid Twist ' + JSON.stringify(app.holding.twist));
  assert(app.holdMoved.twist.on, 'the twist follows a small finger movement instead of becoming a drag');
  assert(!app.released.twist.on && app.released.twist.wind < app.holdMoved.twist.wind, 'released, the twist unwinds ' + JSON.stringify(app.released.twist));
  assert(app.dragging.gestures.drag === app.g0.drag + 1 && app.dragging.dragLife > .3, 'moving the finger drags the ink');
  assert(app.afterDrag.gestures.splash === app.g0.splash, 'a slow drag is not mistaken for a splash');
  assert(app.dragLater.dragLife < app.afterDrag.dragLife, 'the drag dissolves afterwards');
  assert(app.afterFlick.gestures.splash === app.g0.splash + 1 && app.afterFlick.splashAge < 1, 'a quick flick throws a Splash');
  assert(app.injecting.gestures.inject === app.g0.inject + 1 && app.injecting.injected > .5, 'tap then hold injects colour that spreads while held (' + app.injecting.injected.toFixed(2) + ')');
  assert(app.injected.injected > .3, 'the injected colour lingers after lifting the finger');
  assert(app.gestures.burst === app.g0.burst + 2, 'exactly the two taps made bursts; no gesture fired another by accident ' + JSON.stringify(app.gestures));
  // music
  assert(app.quietBlasts === 0, 'quiet music stays hypnotic: no explosions');
  assert(app.groove.ink.blast < 1 && app.grooveBlasts <= 3, 'a steady groove does not explode on every beat (' + app.grooveBlasts + ' events)');
  assert(app.dropBlasts >= 1, 'the drop sets off a liquid explosion');
  assert(app.cannon === 1, 'Bass Cannon sets off an explosion by hand');
  assert(app.silentBlasts === 0, 'silence never triggers anything');
  assert(app.groove.ink.t > app.quiet.ink.t, 'the liquid moves faster with the groove than in the quiet passage');
  // around it
  assert(app.orbBack && app.orbDrawn && app.orbState.experience === 'orb' && app.orbState.variant === 'orb', 'Orbs come straight back');
  assert.deepStrictEqual(app.orbLabels, ['ORB', 'VOLTAGE', 'AURORA', 'NEON'], 'the COLOUR buttons get their own names back');
  assert(app.glOpacity === '', 'the GPU layer is left fully visible');
  assert(app.flowOk && app.flowVariant === 'flow', 'Energy Flow still runs');
  assert(app.reopened.experience === 'ink' && app.reopened.ink.mix === 1, 'Party Mode reopens in Ink Machine ' + JSON.stringify({e: app.reopened.experience, mix: app.reopened.ink.mix, frames: app.reopened.ink.frames}));
  assert.strictEqual(app.mediaCalls, 0, 'nothing here touches music playback');
  console.log('Ink Machine: neon membrane tunnel verified in pixels (core on deep space, crisp detail, rims, bass/mid/treble, explosions, five gestures, four palettes, tiers); in the real app the selector, palettes, all five gestures, music events and Orbs/Energy Flow around it work. Software-rendered pace here: ' + app.fps.toFixed(1) + ' fps.');
})().catch(e => { console.error(e); process.exit(1); });
