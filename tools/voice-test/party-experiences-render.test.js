const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// Party Mode upgrade: renders the real Party shader (Orb Experience backgrounds + hero orb, Energy Flow)
// in a real browser WebGL context and measures pixels, then opens the real app page and operates
// the experience selector, background chips, gestures, exit/re-entry, memory tiers and the no-WebGL fallback.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const party = fs.readFileSync(path.join(assets, 'party.js'), 'utf8');
const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(assets, 'style.css'), 'utf8');
const shaderSrc = (party.match(/var PARTY_SHADER = (\[[\s\S]*?\n  \])\.join\('\\n'\);/) || [])[1];
assert(shaderSrc, 'Party shader is embedded in party.js');
const shader = Function('return ' + shaderSrc)().join('\n');

// Static integration checks.
['ORB EXPERIENCE', 'ENERGY FLOW', 'data-experience="orb"', 'data-experience="flow"', 'id="partyGL"',
  'data-backdrop="classic"', 'data-backdrop="smoke"', 'data-backdrop="aurora"', 'data-backdrop="deep"', 'data-backdrop="iridescent"',
  'CELESTIAL SMOKE', 'NEON AURORA', 'DEEP ATMOSPHERE', 'IRIDESCENT'].forEach(s => assert(html.includes(s), 'markup has ' + s));
assert(html.indexOf('id="partyGL"') < html.indexOf('id="partyCanvas"'), 'GL scene sits behind the interactive orb canvas');
assert(css.includes('#party[data-experience="flow"] .party-modes,#party[data-experience="flow"] .party-backdrops { display:none; }'), 'orb-only controls hide in Energy Flow');
assert(party.includes("localStorage.setItem('nexus.party.experience'") && party.includes("localStorage.setItem('nexus.party.backdrop'"), 'choices persist');
assert(party.includes('glDestroy();') && party.includes('gl.deleteProgram('), 'GL resources are released on stop');
assert(!/location\.reload|window\.location\s*=/.test(party), 'Party never reloads the app');
assert(!/partyToggle'\)\.click|Android\.media(Play|Pause|Toggle)|Android\.mediaControl/.test(party), 'Party visuals never drive media transport');

const browser = process.env.LIQUID_DREAMS_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser && fs.existsSync(browser), 'Edge or Chrome is required for the actual WebGL render check');
const fileUrl = file => 'file:///' + file.replace(/\\/g, '/').replace(/^\//, '');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'party-experiences-'));
// Real-time page run over the DevTools protocol: expensive software-GL frames do not advance headless
// virtual time, so app scenarios run on the wall clock and the result element is polled.
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
function runPage(name, page, budget, size) {
  const htmlPath = path.join(temp, name + '.html');
  fs.writeFileSync(htmlPath, page);
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--allow-file-access-from-files', '--disable-extensions', '--hide-scrollbars', '--window-size=' + (size || '640,360'), '--user-data-dir=' + path.join(temp, 'profile-' + name)];
  if (budget) args.push('--virtual-time-budget=' + budget);
  args.push('--dump-dom', fileUrl(htmlPath));
  let run;
  for (let attempt = 1; attempt <= 3; attempt++) {
    run = cp.spawnSync(browser, args.map(x => x.startsWith('--user-data-dir=') ? x + '-' + attempt : x), { encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (!(run.error && run.error.code === 'ETIMEDOUT')) break;
  }
  if (run.error) throw run.error;
  const match = run.stdout.match(/RESULT=([\s\S]*?)<\/pre>/);
  if (!match) throw new Error((run.stdout.match(/ERROR=([\s\S]*?)<\/pre>/) || [])[1] || (run.stdout.match(/STEP=([\s\S]*?)<\/pre>/) || [])[0] || name + ' page returned no result. ' + run.stderr.slice(-300));
  return JSON.parse(match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

// ---------- A. Shader pixels ----------
const shaderPage = `<!doctype html><meta charset="utf-8"><body><pre id="out">WAITING</pre><canvas id="c" width="160" height="90"></canvas><script>
const out=document.getElementById('out');
try{
 const gl=document.getElementById('c').getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl)throw new Error('WebGL context unavailable');
 function compile(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x;}
 const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,${JSON.stringify(shader)}));gl.linkProgram(p);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const l=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
 const W=160,H=90,px=new Uint8Array(W*H*4);
 const base={res:[W,H],orbC:[0,0],T:31.7,zph:12.3,bass:.2,mid:.2,high:.2,energy:.3,beat:0,orbR:.105,quality:0,bgA:0,bgB:0,bgMix:0,flow:0,surge:0,c1:[.16,.92,1],c2:[.9,.98,1],c3:[.86,.38,.92],tapP:[0,0,9],
   build:0,bphase:.5,burst:0,bAge:9,bPow:0,recoil:0,f1:[.12,.94,.85],f2:[.18,.48,1],f3:[.62,.29,1],f4:[1,.31,.75]};
 function render(over){const u=Object.assign({},base,over);for(const [k,v] of Object.entries(u)){const L=gl.getUniformLocation(p,k);if(L===null){if(k!=='surge')throw new Error('missing uniform '+k);continue;}
  if(!Array.isArray(v))gl.uniform1f(L,v);else if(v.length===2)gl.uniform2f(L,v[0],v[1]);else gl.uniform3f(L,v[0],v[1],v[2]);}
  gl.viewport(0,0,W,H);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
  let r=0,g=0,bl=0,lum=0,black=0,lit=0;const cells=new Array(48).fill(0);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,L=.299*px[i]+.587*px[i+1]+.114*px[i+2];r+=px[i];g+=px[i+1];bl+=px[i+2];lum+=L;if(L<4)black++;if(L>30)lit++;cells[Math.floor(y/H*6)*8+Math.floor(x/W*8)]+=L;}
  const n=W*H;let centre=0;for(let y=40;y<50;y++)for(let x=75;x<85;x++){const i=(y*W+x)*4;centre+=.299*px[i]+.587*px[i+1]+.114*px[i+2];}
  return {mean:[r/n,g/n,bl/n],lum:lum/n,black:black/n,lit:lit/n,centre:centre/100,cells:cells.map(c=>c/(n/48)),bytes:Array.from(px.filter((_,i)=>i%97===0))};}
 const diff=(a,b)=>a.bytes.reduce((s,v,i)=>s+Math.abs(v-b.bytes[i]),0)/a.bytes.length;
 const R={},bgs=['classic','smoke','aurora','deep','iridescent'];
 bgs.forEach((n,i)=>{R[n]=render({bgA:i,bgB:i});R[n+'_later']=render({bgA:i,bgB:i,T:44.2});R[n+'_q1']=render({bgA:i,bgB:i,quality:1});});
 R.pairs={};for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)R.pairs[bgs[i]+'/'+bgs[j]]=diff(R[bgs[i]],R[bgs[j]]);
 R.motion={};bgs.forEach(n=>R.motion[n]=diff(R[n],R[n+'_later']));
 R.crossfade=[.15,.5,.85].map(m=>render({bgA:1,bgB:2,bgMix:m}));
 R.orbQuiet=render({bass:0,beat:0,energy:0,high:0});R.orbLoud=render({bass:1,beat:1,energy:1,high:1});
 R.flow=render({flow:1});R.flowBigOrb=render({flow:1,orbR:.4,orbC:[.3,.1]});
 R.flowQuiet=render({flow:1,bass:0,mid:0,high:0,energy:0,beat:0});R.flowLoud=render({flow:1,bass:1,mid:1,high:1,energy:1,beat:1});
 R.flowLater=render({flow:1,T:33.1,zph:13.6});R.flowTap=render({flow:1,tapP:[.2,.1,.35]});R.flowSurge=render({flow:1,surge:1.4});
 R.flowQ1=render({flow:1,quality:1});
 R.transition=[.1,.3,.5,.7,.9].map(f=>render({flow:f,bgA:3,bgB:3}));
 R.orbVsFlow=diff(R.classic,R.flow);R.flowOrbIndependent=diff(R.flow,R.flowBigOrb);R.flowMusic=diff(R.flowQuiet,R.flowLoud);R.flowMotion=diff(R.flow,R.flowLater);R.flowTapDiff=diff(R.flow,R.flowTap);R.flowSurgeDiff=diff(R.flow,R.flowSurge);R.orbMusic=diff(R.orbQuiet,R.orbLoud);
 bgs.concat(['crossfade','orbQuiet','orbLoud','flowBigOrb','flowLater','flowTap','flowSurge']).forEach(k=>{if(R[k]&&R[k].bytes)delete R[k].bytes;});
 bgs.forEach(n=>{delete R[n+'_later'].bytes;delete R[n+'_q1'].bytes;});
 ['flow','flowQuiet','flowLoud','flowQ1'].forEach(k=>delete R[k].bytes);R.crossfade.forEach(x=>delete x.bytes);R.transition.forEach(x=>delete x.bytes);
 out.textContent='RESULT='+JSON.stringify(R);
}catch(e){out.textContent='ERROR='+(e.stack||e);}
</script>`;
const S = runPage('shader', shaderPage, 30000);
const bgs = ['classic', 'smoke', 'aurora', 'deep', 'iridescent'];
bgs.forEach(n => {
  assert(S[n].lum > 14 && S[n].black < .25, n + ' background is lit, not a black frame (lum ' + S[n].lum.toFixed(1) + ', black ' + S[n].black.toFixed(2) + ')');
  assert(S[n].centre > 120, n + ' shows the bright hero energy orb at centre (' + S[n].centre.toFixed(0) + ')');
  // Classic keeps the original look: its moving orbit rings, threads and dust are drawn by the 2D layer, so only the orb moves in GL.
  assert(S.motion[n] > (n === 'classic' ? .4 : 1.5), n + ' moves continuously (' + S.motion[n].toFixed(2) + ')');
  assert(S[n + '_q1'].lum > 14, n + ' renders at the 8 GB quality tier');
  const cells = S[n].cells, spread = Math.max.apply(null, cells) - Math.min.apply(null, cells);
  assert(spread > 40, n + ' has depth and contrast across the frame (' + spread.toFixed(0) + ')');
});
Object.entries(S.pairs).forEach(([k, v]) => assert(v > 6, 'backgrounds are meaningfully different: ' + k + ' ' + v.toFixed(1)));
S.crossfade.forEach((f, i) => assert(f.lum > 14 && f.black < .25, 'background crossfade step ' + i + ' has no black frame'));
assert(S.orbLoud.lum > S.orbQuiet.lum + 1 && S.orbMusic > 2, 'hero orb reacts to bass, beat and highs');
assert(S.flow.lum > 10 && S.flow.lit > .08, 'Energy Flow is lit with the living energy field');
assert(S.flowQ1.lum > 10, 'Energy Flow renders at the 8 GB quality tier');
assert(S.orbVsFlow > 10, 'Energy Flow is a different scene from the Orb Experience');
assert(S.flowOrbIndependent < .01, 'Energy Flow contains no orb (orb size/position have no effect)');
assert(S.flowLoud.lit > S.flowQuiet.lit * 1.3, 'the field expands with the music (' + S.flowQuiet.lit.toFixed(2) + ' -> ' + S.flowLoud.lit.toFixed(2) + ')');

assert(S.flowLoud.lum > S.flowQuiet.lum + 2 && S.flowMusic > 4, 'Energy Flow is calmer when quiet and more dramatic when loud');
assert(S.flowMotion > 3, 'Energy Flow moves continuously');
assert(S.flowTapDiff > .3 && S.flowSurgeDiff > .3, 'Energy Flow responds to touch and Bass Cannon surge');
S.transition.forEach((f, i) => assert(f.lum > 8 && f.black < .6, 'experience transition step ' + i + ' has no black frame'));

// ---------- B. Real app page ----------
const htmlPath = path.join(assets, 'index.html');
function appPage(setup, scenario) {
  let page = html.replace(/(src|href)="(?!https?:)([^"]+\.(js|css))"/g, (m, a, f) => a + '="' + fileUrl(path.join(assets, f)) + '"');
  page = page.replace('<head>', '<head><script>window.__errors=[];addEventListener("error",e=>__errors.push(String(e.message)));' + setup + '</script>');
  page = page.replace('</body>', '<pre id="__out">WAITING</pre><script>setTimeout(async()=>{const out=document.getElementById("__out");window.__step=(k)=>{out.textContent="STEP="+k+" "+JSON.stringify(window.NexusParty&&NexusParty.state())+JSON.stringify(window.__errors);};try{const wait=ms=>new Promise(r=>setTimeout(r,ms));const R={};' + scenario + ';R.errors=__errors;out.textContent="RESULT="+JSON.stringify(R);}catch(e){out.textContent="ERROR="+(e.stack||e);}},600);</script></body>');
  return page;
}
const bridge = `window.__media=[];window.Android={getPref:()=>"",setPref:()=>{},partyMeter:()=>{},meter:()=>{},isMusicActive:()=>true,nowPlaying:()=>"",
  partyMediaInfo:()=>JSON.stringify({access:true,app:"com.spotify.music",title:"Signal Bloom",artist:"Violet Arc",playing:true,canPrevious:true,canNext:true,canPlayPause:true}),
  mediaPlayPause:()=>__media.push("toggle"),mediaNext:()=>__media.push("next"),mediaPrevious:()=>__media.push("prev"),mediaPause:()=>__media.push("pause"),deviceMemoryGb:()=>window.__mem||2};`;
const waitFrames = `async function frames(n,limit){const s=NexusParty.state().glFrames;const t=Date.now();while(NexusParty.state().glFrames<s+n&&Date.now()-t<(limit||20000))await wait(50);return NexusParty.state().glFrames-s;}
async function until(f,limit){const t=Date.now();while(!f()&&Date.now()-t<(limit||20000))await wait(50);return f();}
function canvasEmpty(){const c=document.getElementById("partyCanvas"),d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=4)if(d[i])return false;return true;}`;
const scenario = waitFrames + `
 window.__marker=Math.random();const marker=window.__marker;
 localStorage.removeItem("nexus.party.experience");localStorage.removeItem("nexus.party.backdrop");
 document.querySelector("[data-act=party]").click();await wait(200);
 const party=document.getElementById("party");R.open=!party.classList.contains("hidden");
 __step('R.f0=await f');R.f0=await frames(3);R.s0=NexusParty.state();
 R.selector={exp:[...document.querySelectorAll(".party-experience")].map(b=>[b.dataset.experience,b.getAttribute("aria-pressed"),getComputedStyle(b).display!=="none"]),
  backdropsVisible:getComputedStyle(document.querySelector(".party-backdrops")).display!=="none",modesVisible:getComputedStyle(document.querySelector(".party-modes")).display!=="none"};
 __step('R.backdrops=');R.backdrops={};for(const b of ["smoke","aurora","deep","iridescent","classic"]){document.querySelector(".party-backdrop[data-backdrop="+b+"]").click();await frames(1);const st=NexusParty.state();R.backdrops[b]={state:st.backdrop,mid:st.bgMix,pressed:document.querySelector(".party-backdrop[data-backdrop="+b+"]").getAttribute("aria-pressed"),stored:localStorage.getItem("nexus.party.backdrop")};await until(()=>NexusParty.state().bgMix===0,15000);}
 document.querySelector(".party-backdrop[data-backdrop=aurora]").click();await until(()=>NexusParty.state().bgMix===0,15000);await until(()=>NexusParty.state().classicWeight<.1,15000);__step('R.ringsFaded');R.ringsFaded=NexusParty.state().classicWeight;
 const mediaBefore=__media.length;
 __step('document.que');document.querySelector(".party-experience[data-experience=flow]").click();await frames(1);R.flowStart=NexusParty.state();
 R.flowUi={backdropsVisible:getComputedStyle(document.querySelector(".party-backdrops")).display!=="none",modesVisible:getComputedStyle(document.querySelector(".party-modes")).display!=="none",caption:getComputedStyle(document.querySelector(".party-flow-caption")).display!=="none",stored:localStorage.getItem("nexus.party.experience")};
 __step('R.flowDone=');R.flowDone=await until(()=>NexusParty.state().flowMix===1,30000);await frames(2);R.canvasClearInFlow=canvasEmpty();
 const ph0=NexusParty.state().flowPhase;await frames(4);R.quietRate=NexusParty.state().flowPhase-ph0;
 __step('const loud=');const loud=setInterval(()=>Nexus._meter(.11,.12,.08,.05),40);await frames(2);const ph1=NexusParty.state().flowPhase;await frames(4);R.loudRate=NexusParty.state().flowPhase-ph1;clearInterval(loud);
 const c=document.getElementById("partyCanvas"),r=c.getBoundingClientRect();
 c.dispatchEvent(new PointerEvent("pointerdown",{pointerId:7,isPrimary:true,clientX:r.left+r.width*.3,clientY:r.top+r.height*.6,bubbles:true}));
 c.dispatchEvent(new PointerEvent("pointerup",{pointerId:7,isPrimary:true,clientX:r.left+r.width*.3,clientY:r.top+r.height*.6,bubbles:true}));
 __step('R.tapSurge=');R.tapSurge=NexusParty.state().surge;await frames(2);
 const sBefore=NexusParty.state().surge;document.getElementById("partyBass").click();R.bassSurge=NexusParty.state().surge-sBefore;
 document.querySelector(".party-experience[data-experience=orb]").click();await frames(1);R.backToOrb=NexusParty.state();
 __step('R.orbReturne');R.orbReturned=await until(()=>NexusParty.state().flowMix===0,30000);await frames(2);R.canvasDrawnInOrb=!canvasEmpty();
 R.mediaCalls=__media.length-mediaBefore;R.sameDocument=window.__marker===marker;
 __step('document.que');document.querySelector(".party-exit").click();await wait(300);const ex=NexusParty.state();R.exit={hidden:party.classList.contains("hidden"),active:ex.active,gl:ex.gl,frames:ex.glFrames};
 await wait(600);R.exitFramesAfter=NexusParty.state().glFrames;
 document.querySelector("[data-act=party]").click();__step('R.reentry=');R.reentry=await frames(3);R.reentryState=NexusParty.state();
 document.querySelector(".party-exit").click();await wait(200);`;
(async () => {
const app2 = await runLive('app-2gb', appPage(bridge + 'window.__mem=2;Object.defineProperty(navigator,"deviceMemory",{get:()=>2});', scenario), 240000, '640,360');
assert.deepStrictEqual(app2.errors, [], 'no page errors');
assert(app2.open && app2.f0 >= 3 && app2.s0.gl, 'Party opens with the GL scene running');
assert.strictEqual(app2.s0.experience, 'orb'); assert.strictEqual(app2.s0.backdrop, 'classic');
assert(Math.abs(app2.s0.glScale - .42) < .001 && app2.s0.quality === 0, 'X3 (2 GB) tier: GL scale .42, quality 0');
assert.deepStrictEqual(app2.selector.exp, [['orb', 'true', true], ['flow', 'false', true], ['ink', 'false', true]], 'experience selector shows a clear selected state');
assert(app2.selector.backdropsVisible && app2.selector.modesVisible, 'background chips and modes are shown in the Orb Experience');
for (const b of ['smoke', 'aurora', 'deep', 'iridescent', 'classic']) {
  const r = app2.backdrops[b];
  assert(r.state === b && r.pressed === 'true' && r.stored === b, b + ' background selects, highlights and persists ' + JSON.stringify(r));
}
assert(app2.ringsFaded < .1, 'classic rings fade away on other backgrounds (' + app2.ringsFaded + ')');
assert(app2.flowStart.experience === 'flow' && app2.flowStart.flowMix > 0 && app2.flowStart.flowMix < 1, 'Energy Flow blends in smoothly');
assert(!app2.flowUi.backdropsVisible && !app2.flowUi.modesVisible && app2.flowUi.caption && app2.flowUi.stored === 'flow', 'orb-only controls hide in Energy Flow');
assert(app2.flowDone && app2.canvasClearInFlow, 'Energy Flow shows no orb field');
assert(app2.loudRate > app2.quietRate * 1.15, 'music speeds the Energy Flow streams (' + app2.quietRate.toFixed(3) + ' -> ' + app2.loudRate.toFixed(3) + ')');
assert(app2.tapSurge > .4, 'tap surges the flow'); assert(app2.bassSurge > .5, 'Bass Cannon surges the flow');
assert(app2.orbReturned && app2.canvasDrawnInOrb, 'returning to the Orb Experience restores the orb field');
assert.strictEqual(app2.mediaCalls, 0, 'switching experiences never touches music playback');
assert(app2.sameDocument, 'no app reload');
assert(app2.exit.hidden && !app2.exit.active && !app2.exit.gl, 'EXIT hides Party and releases the GL scene');
assert.strictEqual(app2.exitFramesAfter, app2.exit.frames, 'no frames render after exit');
assert(app2.reentry >= 3 && app2.reentryState.gl && app2.reentryState.experience === 'orb', 'Party re-enters cleanly');

const app8 = await runLive('app-8gb', appPage(bridge + 'window.__mem=8;Object.defineProperty(navigator,"deviceMemory",{get:()=>8});localStorage.setItem("nexus.party.experience","flow");localStorage.setItem("nexus.party.backdrop","smoke");',
  waitFrames + `document.querySelector("[data-act=party]").click();R.f=await frames(3);R.s=NexusParty.state();document.querySelector(".party-exit").click();await wait(200);`), 90000, '640,360');
assert.deepStrictEqual(app8.errors, []);
assert(app8.f >= 3 && Math.abs(app8.s.glScale - .78) < .001 && app8.s.quality === 1, '8 GB tier: GL scale .78, quality 1');
assert(app8.s.experience === 'flow' && app8.s.backdrop === 'smoke' && app8.s.flowMix === 1, 'saved experience and background are restored without a transition flash');

const noGl = await runLive('app-nogl', appPage(bridge + 'window.__mem=2;const __gc=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,o){return /webgl/.test(t)?null:__gc.call(this,t,o);};localStorage.setItem("nexus.party.experience","flow");',
  waitFrames + `document.querySelector("[data-act=party]").click();await wait(1500);R.s=NexusParty.state();R.flowDisabled=document.querySelector(".party-experience[data-experience=flow]").disabled;R.smokeDisabled=document.querySelector(".party-backdrop[data-backdrop=smoke]").disabled;
  document.querySelector(".party-experience[data-experience=flow]").click();await wait(200);R.after=NexusParty.state().experience;R.drawn=!canvasEmpty();document.querySelector(".party-exit").click();await wait(200);`), 60000, '640,360');
assert.deepStrictEqual(noGl.errors, []);
assert(noGl.s.glFailed && noGl.s.experience === 'orb' && noGl.after === 'orb' && noGl.drawn, 'without WebGL Party falls back to the classic orb field');
assert(noGl.flowDisabled && noGl.smokeDisabled, 'unavailable choices are disabled, not fake');

console.log('Party experiences: 5 Orb backgrounds and Energy Flow rendered (shader pixels), selector/transitions/gestures/exit/re-entry/tiers/fallback verified in the real app page.');
})().catch(e => { console.error(e); process.exit(1); });
