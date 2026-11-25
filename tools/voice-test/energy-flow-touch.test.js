const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// Energy Flow touch: renders the real Party shader with the touch layer and measures pixels
// (idle and Orb builds must match the previous release exactly; each gesture must change the field
// where the finger is and nowhere else), then drives real pointer events through the app page.
// Set ENERGY_TOUCH_SHOTS=<dir> to also save stills of each gesture.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const party = fs.readFileSync(path.join(assets, 'party.js'), 'utf8');
const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const grab = src => Function('return ' + (src.match(/var PARTY_SHADER = (\[[\s\S]*?\n {2}\])\.join\('\\n'\);/) || [])[1])().join('\n');
const shader = grab(party);
// The release before touch, for the "nothing changed while idle" comparison.
let previous = null;
try { previous = grab(cp.execSync('git show 49d5584:app/src/main/assets/party.js', { cwd: root, encoding: 'utf8', maxBuffer: 8 << 20 })); } catch (e) {}

// ---------- Static integration ----------
assert(/#ifndef NO_TOUCH[\s\S]*void touchField\(/.test(shader), 'touch layer is its own compile-time block');
assert(!/tapP/.test(shader), 'the old ripple ring is gone');
const orbSrc = shader.slice(shader.indexOf('// ---------- HERO ENERGY ORB'), shader.indexOf('// ---------- ENERGY FLOW: LIVING'));
assert(!/tch|cbs|trA|touchField/.test(orbSrc), 'Orb code never reads touch');
assert(/variant === 'orb' \? '#define NO_FLOW\\n#define NO_TOUCH\\n'/.test(party), 'the Orb build compiles touch out');
assert(/if \(active && experience === 'flow' && glOk/.test(party), 'touch handling is gated to Energy Flow');
['.party-mode', '.party-preset', '.party-experience', '.party-backdrop', 'partyBass', 'partySound'].forEach(sel =>
  assert(party.includes(sel), 'control wiring kept: ' + sel));

const browser = process.env.LIQUID_DREAMS_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser, 'Edge or Chrome is required for the WebGL render check');
const fileUrl = file => 'file:///' + file.replace(/\\/g, '/').replace(/^\//, '');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-touch-'));
const shots = process.env.ENERGY_TOUCH_SHOTS;
const GL_ARGS = ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--allow-file-access-from-files', '--disable-extensions', '--hide-scrollbars'];

async function runLive(name, page, limitMs, size) {
  const htmlPath = path.join(temp, name + '.html');
  fs.writeFileSync(htmlPath, page);
  const profile = path.join(temp, 'live-' + name);
  const proc = cp.spawn(browser, GL_ARGS.concat(['--window-size=' + (size || '640,360'), '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank']), { stdio: 'ignore' });
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
    const start = Date.now(); let text = '', shotN = 0;
    while (Date.now() - start < limitMs) {
      await sleep(300);
      const r = await send('Runtime.evaluate', { expression: '(document.getElementById("__out")||{}).textContent||""', returnByValue: true });
      text = (r.result && r.result.result && r.result.result.value) || '';
      const want = await send('Runtime.evaluate', { expression: 'window.__shot||""', returnByValue: true });
      const label = want.result && want.result.result && want.result.result.value;
      if (label) {
        if (shots) { const img = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shots, 'app-' + (++shotN) + '-' + label + '.png'), Buffer.from(img.result.data, 'base64')); }
        await send('Runtime.evaluate', { expression: 'window.__shot=""' });
      }
      if (/^(RESULT|ERROR)=/.test(text)) break;
    }
    ws.close();
    if (text.startsWith('ERROR=')) throw new Error(name + ': ' + text.slice(6));
    if (!text.startsWith('RESULT=')) throw new Error(name + ' did not finish: ' + text.slice(0, 600));
    return JSON.parse(text.slice(7));
  } finally { proc.kill('SIGKILL'); }
}

// ---------- A. Shader pixels ----------
const W = 320, H = 180;
function shaderPage() {
  return `<!doctype html><meta charset="utf-8"><body><pre id="__out">WAITING</pre><canvas id="c" width="${W}" height="${H}"></canvas><script>
const out=document.getElementById('__out');
try{
 const gl=document.getElementById('c').getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 R0={maxFUV:gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)};
 function compile(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x;}
 function build(src){const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,src));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}
 const NEW=${JSON.stringify(shader)}, OLD=${JSON.stringify(previous || '')};
 const progs={flow:build('#define NO_ORB\\n#define FT_N 12\\n'+NEW),flow6:build('#define NO_ORB\\n#define FT_N 6\\n'+NEW),flowNoTouch:build('#define NO_ORB\\n#define NO_TOUCH\\n'+NEW),
   orb:build('#define NO_FLOW\\n#define NO_TOUCH\\n'+NEW)};
 if(OLD){progs.oldFlow=build('#define NO_ORB\\n'+OLD);progs.oldOrb=build('#define NO_FLOW\\n'+OLD);}
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const W=${W},H=${H},px=new Uint8Array(W*H*4);
 const z16=new Array(16).fill(0),off4=[0,0,9,0,0,0,9,0,0,0,9,0,0,0,9,0];
 const wakeOff=n=>{const a=[];for(let i=0;i<n;i++)a.push(9,0,0,0);return a;};
 const base={res:[W,H],orbC:[0,0],T:31.7,zph:12.3,bass:.2,mid:.2,high:.2,energy:.3,beat:.05,orbR:.105,quality:1,
   bgA:0,bgB:0,bgMix:0,flow:1,surge:0,build:0,bphase:.6,burst:0,bAge:9,bPow:0,recoil:0,snare:0,hat:0,
   c1:[.16,.92,1],c2:[.9,.98,1],c3:[.86,.38,.92],f1:[.12,.94,.85],f2:[.18,.48,1],f3:[.62,.29,1],f4:[1,.31,.75],tapP:[0,0,9],
   tOn:0,tch:z16,tcv:z16,cbs:off4,trA:new Array(48).fill(0),trB:wakeOff(12)};
 const shots={};
 function render(name,over,keep){const prog=progs[name];gl.useProgram(prog);const l=gl.getAttribLocation(prog,'p');gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
  const u=Object.assign({},base,over);
  for(const [k,v] of Object.entries(u)){let key=k,L=gl.getUniformLocation(prog,k);if(L===null)continue;
   if(['tch','tcv','cbs','trA','trB'].includes(k)){gl.uniform4fv(L,new Float32Array(name==='flow6'&&(k==='trA'||k==='trB')?v.slice(0,24):v));continue;}
   if(!Array.isArray(v))gl.uniform1f(L,v);else if(v.length===2)gl.uniform2f(L,v[0],v[1]);else gl.uniform3f(L,v[0],v[1],v[2]);}
  gl.viewport(0,0,W,H);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
  if(keep)shots[keep]=document.getElementById('c').toDataURL('image/png');
  return px.slice();}
 // shader units -> pixel: x=(u*H+W/2), y=(v*H+H/2) with y up (readPixels is bottom-up too)
 function region(a,cx,cy,rad,fn){let s=0,n=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const ux=(x-W/2)/H,uy=(y-H/2)/H,d=Math.hypot(ux-cx,uy-cy);if(fn(d,rad)){const i=(y*W+x)*4;s+=fn.val?fn.val(a,i):0;n++;}}return n?s/n:0;}
 const lum=(a,i)=>.299*a[i]+.587*a[i+1]+.114*a[i+2];
 function stat(a,b,cx,cy,rad){let ins=0,insN=0,out=0,outN=0,la=0,lb=0,sat=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,ux=(x-W/2)/H,uy=(y-H/2)/H,d=Math.hypot(ux-cx,uy-cy);
   const df=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;
   if(d<rad){ins+=df;insN++;la+=lum(a,i);lb+=lum(b,i);const mx=Math.max(b[i],b[i+1],b[i+2]),mn=Math.min(b[i],b[i+1],b[i+2]);sat+=mx?(mx-mn)/mx:0;}
   else if(d>rad*2.2){out+=df;outN++;}}
  return {inside:ins/insN,outside:outN?out/outN:0,lumBefore:la/insN,lumAfter:lb/insN,sat:sat/insN};}
 function changedArea(a,b,cx,cy){let n=0,sr=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;const df=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;if(df>6){n++;sr+=Math.hypot((x-W/2)/H-cx,(y-H/2)/H-cy);}}return {frac:n/(W*H),meanR:n?sr/n:0};}
 function maxDiff(a,b){let m=0,s=0;for(let i=0;i<a.length;i+=4){const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));m=Math.max(m,d);s+=d;}return {max:m,mean:s/(a.length/4)};}
 const R=Object.assign({},R0);
 // idle: no touch -> exactly the previous release
 const idle=render('flow',{},'idle');
 if(OLD){R.idleVsOld=maxDiff(idle,render('oldFlow',{}));R.orbVsOld=maxDiff(render('orb',{flow:0,bgA:1,bgB:1}),render('oldOrb',{flow:0,bgA:1,bgB:1}));   // Smoke: unchanged since then (Classic later gained a faint star veil)
  R.idleLoudVsOld=maxDiff(render('flow',{bass:.9,mid:.7,high:.8,energy:.95,beat:.8,bphase:.1,burst:.7,bAge:.5,bPow:1.4}),render('oldFlow',{bass:.9,mid:.7,high:.8,energy:.95,beat:.8,bphase:.1,burst:.7,bAge:.5,bPow:1.4}));}
 R.noTouchVsIdle=maxDiff(idle,render('flowNoTouch',{}));
 // after everything has decayed (tOn 0, stale positions left behind) nothing remains
 R.settled=maxDiff(idle,render('flow',{tOn:0,tch:[.3,.1,0,0,0,0,0,0,0,0,0,0,0,0,0,0],cbs:[.3,.1,9,.2,0,0,9,0,0,0,9,0,0,0,9,0]}));
 // Tap: colour burst at (.35,.08), several ages
 const tx=.35,ty=.08,cb=(a,hu)=>[tx,ty,a,hu===undefined?.55:hu,0,0,9,0,0,0,9,0,0,0,9,0];
 const tapA=render('flow',{tOn:1,cbs:cb(.15)},'tap-0.15s'),tapB=render('flow',{tOn:1,cbs:cb(.7)},'tap-0.7s'),tapC=render('flow',{tOn:1,cbs:cb(1.6)},'tap-1.6s'),tapD=render('flow',{tOn:1,cbs:cb(3.4)});
 const tapTeal=render('flow',{tOn:1,cbs:cb(.7,.05)},'tap-teal-0.7s');R.tapTeal=stat(idle,tapTeal,tx,ty,.28);
 R.tap={early:changedArea(idle,tapA,tx,ty),mid:changedArea(idle,tapB,tx,ty),late:changedArea(idle,tapC,tx,ty),end:maxDiff(idle,tapD),local:stat(idle,tapB,tx,ty,.28)};
 // Hold: attraction point at (-.4,-.05), contact + full attraction
 const hx=-.4,hy=-.05,hold=(a,c)=>[hx,hy,a,c,0,0,0,0,0,0,0,0,0,0,0,0];
 const holdOn=render('flow',{tOn:2,tch:hold(1,1),tcv:[0,0,.2,0].concat(new Array(12).fill(0))},'hold');
 const holdT=render('flow',{T:32.3,tOn:2,tch:hold(1,1),tcv:[0,0,.2,0].concat(new Array(12).fill(0))});
 R.hold=stat(idle,holdOn,hx,hy,.28);R.holdMotion=stat(holdOn,holdT,hx,hy,.28);
 const holdHalf=render('flow',{tOn:.4,tch:hold(.2,.2)});R.holdRelease=stat(idle,holdHalf,hx,hy,.28);
 // Drag: a wake along y=-.15 from x=-.6 to x=.2 moving right
 const trA=[],trB=[];for(let i=0;i<12;i++){if(i<9){const x=-.6+i*.1;trA.push(x,-.15+Math.sin(i*.7)*.04,1.6,0);trB.push((8-i)*.12,.75+i*.01,i<8?1:0,1);}else{trA.push(0,0,0,0);trB.push(9,0,0,0);}}
 const drag=render('flow',{tOn:9,trA:trA,trB:trB,tch:[.2,-.15,.5,1].concat(new Array(12).fill(0)),tcv:[1.6,0,.75,0].concat(new Array(12).fill(0))},'drag');
 const wake=render('flow',{tOn:9,trA:trA,trB:trB});R.drag=stat(idle,wake,-.2,-.15,.12);R.dragFar=stat(idle,wake,-.2,.35,.08);R.dragFinger=stat(idle,drag,-.2,-.15,.12);
 R.drag6=maxDiff(idle,render('flow6',{tOn:9,trA:trA,trB:trB}));
 // Multi-touch: two holds and a tap at once
 const multi=render('flow',{tOn:5,tch:[-.5,.15,1,1,.45,-.2,1,1].concat(new Array(8).fill(0)),tcv:[0,0,.1,0,0,0,.6,0].concat(new Array(8).fill(0)),cbs:[.1,.3,.5,.9,0,0,9,0,0,0,9,0,0,0,9,0]},'multi');
 R.multiA=stat(idle,multi,-.5,.15,.15);R.multiB=stat(idle,multi,.45,-.2,.15);R.multiC=stat(idle,multi,.1,.3,.12);
 // With music: touch still shows on a loud mix, and the music still drives the touched field
 const loud={bass:.9,mid:.75,high:.8,energy:.95,beat:.8,bphase:.1};
 const loudIdle=render('flow',loud),loudHold=render('flow',Object.assign({tOn:2,tch:hold(1,1),tcv:[0,0,.2,0].concat(new Array(12).fill(0))},loud),'hold-loud');
 R.loudHold=stat(loudIdle,loudHold,hx,hy,.22);R.musicUnderTouch=maxDiff(holdOn,loudHold);
 // cost: touch layer on vs off, software GL
 function time(name,over){gl.finish();const t=performance.now();for(let i=0;i<30;i++)render(name,over);return (performance.now()-t)/30;}
 R.msIdle=time('flow',{});R.msBusy=time('flow',{tOn:9,trA:trA,trB:trB,tch:[-.5,.15,1,1,.45,-.2,1,1,.2,.2,.5,1,0,0,0,0],cbs:cb(.7)});R.msOld=OLD?time('oldFlow',{}):0;
 R.shots=shots;
 out.textContent='RESULT='+JSON.stringify(R);
}catch(e){out.textContent='ERROR='+(e.stack||e);}
</script>`;
}

// ---------- B. Real app page ----------
function appPage(setup, scenario) {
  let page = html.replace(/(src|href)="(?!https?:)([^"]+\.(js|css))"/g, (m, a, f) => a + '="' + fileUrl(path.join(assets, f)) + '"');
  page = page.replace('<head>', '<head><script>window.__errors=[];addEventListener("error",e=>__errors.push(String(e.message)));' + setup + '</script>');
  page = page.replace('</body>', '<pre id="__out">WAITING</pre><script>setTimeout(async()=>{const out=document.getElementById("__out");try{const wait=ms=>new Promise(r=>setTimeout(r,ms));const R={};' + scenario + ';R.errors=__errors;out.textContent="RESULT="+JSON.stringify(R);}catch(e){out.textContent="ERROR="+(e.stack||e);}},600);</script></body>');
  return page;
}
const bridge = `window.__media=[];window.Android={getPref:()=>"",setPref:()=>{},partyMeter:()=>{},meter:()=>{},isMusicActive:()=>true,nowPlaying:()=>"",
  partyMediaInfo:()=>JSON.stringify({access:true,app:"com.spotify.music",title:"Signal Bloom",artist:"Violet Arc",playing:true,canPrevious:true,canNext:true,canPlayPause:true}),
  mediaPlayPause:()=>__media.push("toggle"),mediaNext:()=>__media.push("next"),mediaPrevious:()=>__media.push("prev"),mediaPause:()=>__media.push("pause"),deviceMemoryGb:()=>window.__mem||2};`;
const scenario = `
 function music(ms){return new Promise(res=>{const t0=performance.now();const iv=setInterval(()=>{const t=(performance.now()-t0)/1000;if(performance.now()-t0>ms){clearInterval(iv);res();return;}
  const since=t-Math.floor(t/.47)*.47,kick=Math.exp(-since/.07)*.12;Nexus._meter(.03+kick*.5,.02+kick,.03,.01);},25);});}
 const c=()=>document.getElementById("partyCanvas");
 function ev(type,id,x,y){const r=c().getBoundingClientRect();c().dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:"touch",isPrimary:id===1,clientX:r.left+x*r.width,clientY:r.top+y*r.height,bubbles:true,cancelable:true}));}
 async function drag(id,x0,y0,x1,y1,ms){ev("pointerdown",id,x0,y0);const n=Math.max(4,Math.round(ms/30));for(let i=1;i<=n;i++){await wait(30);ev("pointermove",id,x0+(x1-x0)*i/n,y0+(y1-y0)*i/n);}}
 const T=()=>NexusParty.state().touch;
 document.querySelector("[data-act=party]").click();await wait(1500);
 R.start=NexusParty.state();R.startTouch=T();
 // idle, no music: let the field settle, then tap
 await wait(1200);window.__shot="idle";await wait(900);
 ev("pointerdown",1,.7,.4);await wait(60);ev("pointerup",1,.7,.4);await wait(250);R.afterTap=T();window.__shot="tap";await wait(900);
 // hold
 ev("pointerdown",1,.3,.55);await wait(1400);R.holding=T();window.__shot="hold";await wait(900);
 ev("pointerup",1,.3,.55);await wait(200);R.justReleased=T();
 // drag
 await drag(1,.15,.75,.85,.3,900);R.dragging=T();window.__shot="drag";await wait(600);ev("pointerup",1,.85,.3);
 // multi-touch: two fingers down together, one drags
 ev("pointerdown",1,.25,.3);ev("pointerdown",2,.75,.7);await wait(500);
 for(let i=1;i<=10;i++){await wait(30);ev("pointermove",2,.75-i*.03,.7-i*.02);}
 R.multi=T();window.__shot="multi";await wait(900);ev("pointerup",1,.25,.3);ev("pointerup",2,.45,.5);
 // everything lets go: the field settles back to idle on its own
 await wait(4500);R.settled=T();
 // with music playing
 const m=music(9000);await wait(1500);
 ev("pointerdown",1,.5,.5);await wait(1200);R.musicHold=T();R.musicState=NexusParty.state().music;window.__shot="hold-music";await wait(900);
 for(let i=1;i<=12;i++){await wait(30);ev("pointermove",1,.5+i*.025,.5-i*.015);}window.__shot="drag-music";await wait(700);ev("pointerup",1,.8,.32);
 ev("pointerdown",3,.2,.2);await wait(50);ev("pointerup",3,.2,.2);
 await m;R.musicTouch=T();R.musicBursts=NexusParty.state().burstCount;
 await wait(4500);R.musicSettled=T();
 // Orb Experience: Energy Flow touch must not engage
 document.querySelector(".party-experience[data-experience=orb]").click();
 const t0=Date.now();while(NexusParty.state().flowMix>0&&Date.now()-t0<20000)await wait(50);await wait(300);
 const g0=JSON.stringify(T().gestures);
 ev("pointerdown",1,.5,.5);await wait(80);ev("pointerup",1,.5,.5);await wait(300);
 R.orbGesturesSame=JSON.stringify(T().gestures)===g0;R.orbState=NexusParty.state();R.orbTouchDown=T().down;
 // back to Energy Flow: touch works again
 document.querySelector(".party-experience[data-experience=flow]").click();await wait(1500);
 ev("pointerdown",1,.5,.5);await wait(60);ev("pointerup",1,.5,.5);await wait(100);R.backToFlow=T();
 R.mediaCalls=__media.length;
 document.querySelector(".party-exit").click();await wait(200);R.exitTouch=T();`;

(async () => {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const S = await runLive('touch-shader', shaderPage(), 240000, '700,400');
  if (shots) for (const [k, v] of Object.entries(S.shots)) fs.writeFileSync(path.join(shots, 'shader-' + k + '.png'), Buffer.from(v.split(',')[1], 'base64'));
  delete S.shots;
  console.log(JSON.stringify(S, null, 1));
  if (previous) {
    assert(S.idleVsOld.max <= 1, 'with no touch Energy Flow is pixel-identical to the previous release (max ' + S.idleVsOld.max + ')');
    assert(S.idleLoudVsOld.max <= 1, 'music reactivity and the supernova are unchanged with no touch (max ' + S.idleLoudVsOld.max + ')');
    assert(S.orbVsOld.max === 0, 'the Orb Experience build is pixel-identical to the previous release (max ' + S.orbVsOld.max + ')');
  }
  assert(S.noTouchVsIdle.max <= 1, 'the no-touch fallback build matches the idle field');
  assert(S.settled.max <= 1, 'once touch decays the field is exactly back to idle');
  // tap
  assert(S.tap.early.frac > .003 && S.tap.mid.frac > S.tap.early.frac && S.tap.late.meanR > S.tap.early.meanR,
    'the colour burst spreads outward over time ' + JSON.stringify(S.tap));
  assert(S.tap.local.inside > 6 && S.tap.local.outside < 2.5, 'the burst is local to the tap (' + S.tap.local.inside.toFixed(1) + ' in / ' + S.tap.local.outside.toFixed(2) + ' out)');
  assert(S.tap.local.sat > .35, 'burst colour stays rich, not white (' + S.tap.local.sat.toFixed(2) + ')');
  assert(S.tapTeal.inside > 6, 'every burst colour shows against the field');
  assert(S.tap.end.mean < .5, 'the burst fades away by itself');
  // hold
  assert(S.hold.inside > 8 && S.hold.outside < S.hold.inside * .5 && S.hold.lumAfter > S.hold.lumBefore, 'holding gathers and lights the energy at the finger ' + JSON.stringify(S.hold));
  assert(S.holdMotion.inside > 3, 'the gathered energy keeps flowing while held');
  assert(S.holdRelease.inside < S.hold.inside * .6, 'releasing lets the field relax');
  // drag
  assert(S.drag.inside > 8 && S.dragFar.inside < S.drag.inside * .3, 'dragging bends the field along the stroke only ' + JSON.stringify([S.drag, S.dragFar]));
  assert(S.drag.sat > .35, 'the wake keeps rich colour');
  assert(S.drag6.mean > .3, 'the reduced 6-point wake build still works');
  // multi
  assert(S.multiA.inside > 6 && S.multiB.inside > 6 && S.multiC.inside > 4, 'several fingers each shape their own area');
  // music
  assert(S.loudHold.inside > 6, 'touch still shows on top of loud music');
  assert(S.musicUnderTouch.mean > 4, 'music keeps driving the field while it is being touched');
  console.log('cost per frame (software GL, relative): idle ' + S.msIdle.toFixed(1) + ' ms, old ' + S.msOld.toFixed(1) + ' ms, 3 fingers + wake + burst ' + S.msBusy.toFixed(1) + ' ms');
  assert(S.msIdle < S.msOld * 1.15 + 1, 'idle costs no more than before');
  assert(S.msBusy < (S.msIdle + S.msOld) / 2 * 1.7 + 1, 'three fingers + wake + burst add modest cost');

  const A = await runLive('touch-app', appPage(bridge + 'window.__mem=2;Object.defineProperty(navigator,"deviceMemory",{get:()=>2});localStorage.setItem("nexus.party.experience","flow");', scenario), 120000, '960,540');
  console.log(JSON.stringify(A, null, 1));
  assert.deepStrictEqual(A.errors, [], 'no page errors');
  assert(A.start.experience === 'flow' && A.start.gl && A.start.variant === 'flow', 'Energy Flow opens on its GL build');
  assert(A.startTouch.n === 12, 'full touch layer on this GPU');
  assert(A.afterTap.gestures.tap === 1 && A.afterTap.bursts >= 1, 'a tap fires a colour burst');
  assert(A.holding.down === 1 && A.holding.attract > .6 && A.holding.gestures.hold === 1, 'holding builds attraction (' + A.holding.attract.toFixed(2) + ')');
  assert(A.justReleased.down === 0 && A.justReleased.attract > .2, 'release lets go gradually rather than snapping back');
  assert(A.dragging.gestures.drag === 1 && A.dragging.wake >= 4, 'dragging lays a wake (' + A.dragging.wake + ' points)');
  assert(A.multi.down === 2 && A.multi.gestures.multi >= 1, 'two fingers are tracked at once');
  assert(A.settled.on === 0 && A.settled.down === 0, 'after letting go everything settles back to the idle field');
  assert(A.musicState.energy > .1 && A.musicHold.attract > .5, 'touch works while music plays');
  assert(A.musicSettled.on === 0, 'with music, touch also settles once released');
  assert(A.orbGesturesSame && A.orbTouchDown === 0 && A.orbState.variant === 'orb', 'the Orb Experience ignores Energy Flow touch');
  assert(A.backToFlow.gestures.tap > A.musicTouch.gestures.tap, 'touch works again after switching back');
  assert(A.exitTouch.on === 0 && A.exitTouch.down === 0, 'leaving Party clears touch');
  assert.strictEqual(A.mediaCalls, 0, 'touch never touches music playback');
  console.log('Energy Flow touch: tap bursts, hold attraction, drag wake and multi-touch verified in pixels and in the real app; idle and Orb builds unchanged.');
})().catch(e => { console.error(e); process.exit(1); });
