const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// Visuals collection: Fire Tornado, Blue Fire, Hollow Head, Cyber Eye and Wormhole.
// Opens the real app page in a real browser (software WebGL), measures rendered pixels of every
// experience feature, then operates the selector, in-visual switcher, EXIT, pause and cleanup.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const xp = fs.readFileSync(path.join(assets, 'experiences.js'), 'utf8');
const ORDER = ['firetornado', 'bluefire', 'hollowhead', 'cybereye', 'wormhole'];

// ---- static checks: catalog, removal of the old collection, preserved infrastructure
const catalog = app.slice(app.indexOf('var VISUALS = ['), app.indexOf('];', app.indexOf('var VISUALS = [')) + 2);
assert.deepStrictEqual(Array.from(catalog.matchAll(/\['([^']+)'/g), m => m[1]), ORDER, 'Visuals lists exactly the five new experiences in order');
for (const name of ['FIRE TORNADO', 'BLUE FIRE', 'HOLLOW HEAD', 'CYBER EYE', 'WORMHOLE']) assert(catalog.includes("'" + name + "'"), name + ' is in the catalog');
for (const old of ['aliens', 'dragon', 'waterclub', 'outrun', 'vapor', 'kaleido', 'shatter', 'hyper', 'friend', 'fractal', 'mirror', 'planet', 'skull', 'worlds', 'gold', 'neural', 'auroratunnel', 'ink', 'datastorm', 'blackhole', 'portrait', 'lava', 'synth', 'zoom', 'aura', 'skeletondance', 'neonfluid', 'macrocrystalgrowth', 'deepsea', 'prismrefraction', 'quantumparticles']) {
  assert(!new RegExp("\\['" + old + "'").test(catalog), old + ' is removed from the catalog');
  assert(!new RegExp('(?:^|[{ ,])' + old + ': ').test(xp.slice(xp.indexOf('var XP = window.XP'), xp.indexOf('close: function'))), old + ' no longer dispatches');
}
for (const fn of ['function skeletonDance', 'function neonFluid', 'function outrun', 'function tornado()', 'function wormhole()', 'function eye()', 'function friend()', 'function bluefire()', 'VISUAL_WORLD_PROFILES', 'drawVisualWorldFinish']) assert(!xp.includes(fn), fn + ' (old visual code) is removed');
for (const keep of ['function liquidDreams()', 'function holo()', 'function clockface()', 'function lyrics()', 'function webcams()', 'function beatTracker(', 'function glStart(', 'function ensureGl(', 'function loop(', 'function tuneQuality(', 'Packs: { schemaVersion: 1', 'function renderAtmosphere(']) assert(xp.includes(keep), keep + ' (shared infrastructure) is preserved');
assert(!app.includes("case 'synth'") && app.includes("case 'holo': case 'liquiddreams': openExperience(name);"), 'retired visuals are no longer routed; Hologram and Liquid Dreams still are');

const browser = process.env.LIQUID_DREAMS_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser && fs.existsSync(browser), 'Edge or Chrome is required for the actual WebGL render check');
const fileUrl = file => 'file:///' + file.replace(/\\/g, '/').replace(/^\//, '');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'visuals-five-'));

// Real-time page run over the DevTools protocol (software-GL frames do not advance headless virtual time).
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
function appPage(setup, scenario) {
  let page = html.replace(/(src|href)="(?!https?:)([^"]+\.(js|css))"/g, (m, a, f) => a + '="' + fileUrl(path.join(assets, f)) + '"');
  page = page.replace('<head>', '<head><base href="' + fileUrl(assets) + '/"><script>window.__errors=[];addEventListener("error",e=>__errors.push(String(e.message)));' + setup + '</script>');
  page = page.replace('</body>', '<pre id="__out">WAITING</pre><script>setTimeout(async()=>{const out=document.getElementById("__out");window.__step=k=>{out.textContent="STEP="+k;};try{const wait=ms=>new Promise(r=>setTimeout(r,ms));const R={};' + scenario + ';R.errors=__errors;out.textContent="RESULT="+JSON.stringify(R);}catch(e){out.textContent="ERROR="+(e.stack||e);}},600);</script></body>');
  return page;
}
const bridge = `window.__media=[];window.__meter=[];window.Android={getPref:k=>localStorage.getItem("p_"+k)||"",setPref:(k,v)=>localStorage.setItem("p_"+k,v),partyMeter:()=>{},meter:on=>__meter.push(on),isMusicActive:()=>true,nowPlaying:()=>"{}",
  partyMediaInfo:()=>"{}",media:c=>__media.push(c),mediaPlayPause:()=>__media.push("toggle"),volume:()=>{},refreshApps:()=>{},deviceMemoryGb:()=>window.__mem||2,setBrightness:()=>{}};`;

const helpers = `
 const G=(n,o,s,a)=>XP.vxProbe(n,o,s,a);
 const mean=g=>g.grid.reduce((x,y)=>x+y,0)/g.grid.length;
 const diff=(a,b,f)=>{let s=0,n=0;a.grid.forEach((v,i)=>{const x=i%80,y=Math.floor(i/80);if(!f||f(x,y)){s+=Math.abs(v-b.grid[i]);n++;}});return s/Math.max(1,n);};
 const lit=(g,t,f)=>g.grid.filter((v,i)=>v>t&&(!f||f(i%80,Math.floor(i/80)))).length;
 const bbox=(g,t)=>{let x0=99,x1=-1,y0=99,y1=-1;g.grid.forEach((v,i)=>{if(v>t){const x=i%80,y=Math.floor(i/80);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}});return {w:x1-x0+1,h:y1-y0+1,area:(x1-x0+1)*(y1-y0+1)};};
 const rowWidth=(g,y,t)=>{let a=-1,b=-1;for(let x=0;x<80;x++)if(g.grid[y*80+x]>t){if(a<0)a=x;b=x;}return a<0?0:b-a+1;};
`;
const probeScenario = helpers + `
 const P={};
 // FIRE TORNADO
 const ftA=G('firetornado',{T:10,rot:3}),ftRot=G('firetornado',{T:10,rot:3.7}),ftT=G('firetornado',{T:10.6,rot:3});
 const ftQuiet=G('firetornado',{T:10,rot:3,bass:0,beat:0,high:0,surge:0}),ftLoud=G('firetornado',{T:10,rot:3,bass:1,beat:1,high:1,surge:1});
 const ftHigh=G('firetornado',{T:10,rot:3,high:1});
 P.ft={lum:mean(ftA),rotation:diff(ftA,ftRot,(x,y)=>y<30),flames:diff(ftA,ftT),widthQuiet:rowWidth(ftQuiet,16,70),widthLoud:rowWidth(ftLoud,16,70),lumQuiet:mean(ftQuiet),lumLoud:mean(ftLoud),
  embers:diff(ftA,ftHigh),hazeNear:diff(ftA,ftT,(x,y)=>y>=29&&y<=33&&x>=34&&x<=46),hazeFar:diff(ftA,ftT,(x,y)=>y>=29&&y<=33&&(x<6||x>73)),warm:ftA.rgb[0]>ftA.rgb[2]*1.8};
 // BLUE FIRE
 const forms=new Float32Array([-.62,.75,.2,1,-.38,.8,1.1,1,-.12,.9,2.3,1,.1,.85,3.1,1,.32,.95,4.2,1,.55,.7,5,1,.78,.6,.6,1]),forms2=forms.slice();forms2[8]=-.02;forms2[12]=.02;
 const bfA=G('bluefire',{T:10,forms:forms,arc:[0,0,0,0]}),bfT=G('bluefire',{T:10.5,forms:forms,arc:[0,0,0,0]}),bfMerge=G('bluefire',{T:10,forms:forms2,arc:[0,0,0,0]});
 const bfArc=G('bluefire',{T:10,forms:forms,arc:[-.12,.1,.5,3]}),bfHigh=G('bluefire',{T:10,forms:forms,arc:[0,0,0,0],high:1});
 const bfQuiet=G('bluefire',{T:10,forms:forms,arc:[0,0,0,0],bass:0,beat:0,surge:0}),bfLoud=G('bluefire',{T:10,forms:forms,arc:[0,0,0,0],bass:1,beat:1,surge:1});
 P.bf={lum:mean(bfA),flames:diff(bfA,bfT),merge:diff(bfA,bfMerge),arc:diff(bfA,bfArc),sparks:diff(bfA,bfHigh),topQuiet:lit(bfQuiet,60,(x,y)=>y<18),topLoud:lit(bfLoud,60,(x,y)=>y<18),blue:bfA.rgb[2]>bfA.rgb[0]*1.5,vsTornado:diff(bfA,ftA)};
 // HOLLOW HEAD
 const hh0=G('hollowhead',{yaw:-.35,pitch:-.1,roll:0,exp:0,comp:0,wave:0,frag:0,jaw:0,cheek:0,brow:0,eye:[0,0]});
 const base={yaw:-.35,pitch:-.1,roll:0,exp:0,comp:0,wave:0,frag:0,jaw:0,cheek:0,brow:0,eye:[0,0]};
 const hhYaw=G('hollowhead',Object.assign({},base,{yaw:.5})),hhExp=G('hollowhead',Object.assign({},base,{exp:.55})),hhComp=G('hollowhead',Object.assign({},base,{comp:.72}));
 const hhWave=G('hollowhead',Object.assign({},base,{wave:1.1,waveP:2})),hhJaw=G('hollowhead',Object.assign({},base,{jaw:.4})),hhFace=G('hollowhead',Object.assign({},base,{cheek:.7,brow:.7,eye:[.8,.5]}));
 const hhFrag=G('hollowhead',Object.assign({},base,{frag:.8,fragDir:[1,.2,0]})),hhBack=G('hollowhead',Object.assign({},base,{frag:0}));
 const hhHigh=G('hollowhead',Object.assign({},base,{high:1,pulse:.2}));
 const P0w=rowWidth(hh0,12,70);
 const top=g=>{for(let y=0;y<45;y++)for(let x=20;x<60;x++)if(g.grid[y*80+x]>70)return y;return 45;};
 P.hh={lum:mean(hh0),rotate:diff(hh0,hhYaw),wRest:rowWidth(hh0,12,70),wExp:rowWidth(hhExp,12,70),wComp:rowWidth(hhComp,12,70),topRest:top(hh0),topExp:top(hhExp),topComp:top(hhComp),wave:diff(hh0,hhWave),jaw:diff(hh0,hhJaw,(x,y)=>y>18&&y<34),face:diff(hh0,hhFace),
  fragOutside:lit(hhFrag,70,(x,y)=>y<16&&(x<40-P0w/2-1||x>40+P0w/2+1))-lit(hh0,70,(x,y)=>y<16&&(x<40-P0w/2-1||x>40+P0w/2+1)),rebuilt:diff(hh0,hhBack),pulse:mean(hhHigh)-mean(hh0)};
 // CYBER EYE
 const eb={lid:0,pupil:.4,apert:0,radial:.6,scan:-5,arcT:0,gaze:[0,0],rings:[0,1,2,3],segs:[.3,.3,.3,.3]};
 const ce0=G('cybereye',eb),ceLid=G('cybereye',Object.assign({},eb,{lid:1})),ceHalf=G('cybereye',Object.assign({},eb,{lid:.5}));
 const ceSmall=G('cybereye',Object.assign({},eb,{pupil:.03})),ceBig=G('cybereye',Object.assign({},eb,{pupil:.95}));
 const ceRad=G('cybereye',Object.assign({},eb,{radial:1})),ceR1=G('cybereye',Object.assign({},eb,{rings:[.4,1,2,3]})),ceR4=G('cybereye',Object.assign({},eb,{rings:[0,1,2,3.4]}));
 const ceAp=G('cybereye',Object.assign({},eb,{apert:1})),ceScan=G('cybereye',Object.assign({},eb,{scan:.3})),ceGaze=G('cybereye',Object.assign({},eb,{gaze:[.07,.03]}));
 const dark=(g)=>lit({grid:g.grid.map(v=>255-v)},235,(x,y)=>Math.hypot(x-40,(y-22.5))<8);
 const ceBass=G('cybereye',{},40,{bass:1,energy:.5}),ceQuiet=G('cybereye',{},40,{});
 const ring=(r0,r1)=>(x,y)=>{const d=Math.hypot(x-40,y-22.5);return d>=r0&&d<r1;};
 P.ce={lum:mean(ce0),blink:diff(ce0,ceLid,(x,y)=>Math.abs(y-22.5)<6&&Math.abs(x-40)<20),half:diff(ce0,ceHalf,(x,y)=>Math.abs(y-22.5)<6&&Math.abs(x-40)<20),pupilSmall:dark(ceSmall),pupilBig:dark(ceBig),
  radial:diff(ce0,ceRad),ring1Inner:diff(ce0,ceR1,ring(2,5)),ring1Outer:diff(ce0,ceR1,ring(8,11)),ring4Inner:diff(ce0,ceR4,ring(2,5)),ring4Outer:diff(ce0,ceR4,ring(8,11)),
  aperture:diff(ce0,ceAp,ring(0,11)),scan:diff(ce0,ceScan),gaze:diff(ce0,ceGaze),bassPupil:dark(ceBass),quietPupil:dark(ceQuiet)};
 // WORMHOLE
 const rocks=new Float32Array([-.7,.3,.07,1,.62,-.28,.06,2,.8,.35,.035,3,-.5,-.38,.045,4,.3,.42,.02,5,-.25,.4,.015,6,0,0,0,0,0,0,0,0]);
 const wb={T:10,zph:3,spin:1,core:.3,warp:0,bass:.2,beat:0,rocks:rocks};
 const wh0=G('wormhole',wb),whSpin=G('wormhole',Object.assign({},wb,{spin:1.5})),whZ=G('wormhole',Object.assign({},wb,{zph:3.4})),whT=G('wormhole',Object.assign({},wb,{T:12}));
 const whQuiet=G('wormhole',Object.assign({},wb,{bass:0,core:.2})),whLoud=G('wormhole',Object.assign({},wb,{bass:1,beat:1,core:1.4})),whWarp=G('wormhole',Object.assign({},wb,{warp:1}));
 const whNoRocks=G('wormhole',Object.assign({},wb,{rocks:new Float32Array(32)}));
 P.wh={lum:mean(wh0),spin:diff(wh0,whSpin),depth:diff(wh0,whZ),nebula:diff(wh0,whT),coreQuiet:lit(whQuiet,200,(x,y)=>Math.hypot(x-40,y-22.5)<15),coreLoud:lit(whLoud,200,(x,y)=>Math.hypot(x-40,y-22.5)<15),
  warp:diff(wh0,whWarp),rocks:diff(wh0,whNoRocks),centreBright:mean({grid:wh0.grid.filter((v,i)=>Math.hypot(i%80-40,Math.floor(i/80)-22.5)<4)})>mean(wh0)*2,vsEye:diff(wh0,ce0)};
 R.P=P;
`;
const appScenario = `
 const box=()=>document.getElementById('xp'),st=()=>window.XP&&XP.vxDebug&&XP.vxDebug();
 async function frames(n,limit){const s=(st()||{}).frames||0,t=Date.now();while(((st()||{}).frames||0)<s+n&&Date.now()-t<(limit||20000))await wait(50);return ((st()||{}).frames||0)-s;}
 window.__marker=Math.random();const marker=__marker;
 document.querySelector('[data-act=visuals]').click();
 const t0=Date.now();while(!document.querySelector('.vis-card')&&Date.now()-t0<30000)await wait(100);
 R.cards=[...document.querySelectorAll('.vis-card')].map(c=>[c.dataset.vis,c.querySelector('b').textContent,(c.querySelector('img')||{}).src?c.querySelector('img').src.length:0]);
 __step('probe');${probeScenario}
 R.previewDistinct=new Set([...document.querySelectorAll('.vis-shot img')].map(i=>i.src.slice(200,4000))).size;
 const media0=__media.length;
 document.querySelector('.vis-card[data-vis=firetornado]').click();
 const t1=Date.now();while(!(window.XP&&XP.active)&&Date.now()-t1<20000)await wait(50);
 R.opened={active:XP.active,current:XP.current,frames:await frames(3),panelClosed:document.getElementById('panel').classList.contains('hidden')};
 R.barOnEntry=document.getElementById('vxBar').classList.contains('on');
 R.visits=[];
 for(const k of ${JSON.stringify(ORDER.slice(1))}){
  box().click();await wait(100);const bar=document.getElementById('vxBar');const vis=bar.classList.contains('on');
  bar.querySelector('[data-vx='+k+']').click();const f=await frames(3);const s=st();
  R.visits.push({k,barShown:vis,current:XP.current,frames:f,pressed:bar.querySelector('[data-vx='+k+']').getAttribute('aria-pressed'),snap:!!document.getElementById('vxSnap'),w:s.w,h:s.h,programs:s.programs,mesh:s.mesh});
 }
 R.switchMedia=__media.length-media0;R.sameDoc=window.__marker===marker;R.meterOn=__meter.filter(x=>x).length;
 // exit returns Home and releases GPU resources
 box().click();await wait(100);document.querySelector('#vxBar [data-vxexit]').click();await wait(300);
 const gc=[...document.querySelectorAll('#xp canvas')].filter(c=>c.id!=='xpc'&&c.id!=='vxSnap');
 R.exit={active:XP.active,hidden:box().classList.contains('hidden'),panel:!document.getElementById('panel').classList.contains('hidden'),debug:typeof XP.vxDebug,glw:gc.map(c=>c.width+'x'+c.height),meterOff:__meter[__meter.length-1]===false};
 const fr=(st()||{}).frames;await wait(500);R.exitStill=!st();
 // pause/resume: Android pausing the app closes the visual; re-entry works
 Nexus.openExperience('wormhole');R.reopen=await frames(3);Nexus.paused();await wait(200);R.paused={active:XP.active};Nexus.resumed();
 Nexus.openExperience('hollowhead');R.afterResume=await frames(3);R.afterResumeState=st();
 // ✕ close goes back to the Visuals menu like before
 document.getElementById('xpClose').click();await wait(300);R.closeX={active:XP.active};
 R.unknown=XP.open('aliens');R.unknownActive=XP.active;
`;
(async () => {
  const r = await runLive('app', appPage(bridge + 'window.__mem=2;Object.defineProperty(navigator,"deviceMemory",{get:()=>2});', appScenario), 420000, '640,360');
  assert.deepStrictEqual(r.errors, [], 'no page errors');
  assert.deepStrictEqual(r.cards.map(c => c[0]), ORDER, 'selector shows the five visuals in order');
  assert.deepStrictEqual(r.cards.map(c => c[1]), ['Fire Tornado', 'Blue Fire', 'Hollow Head', 'Cyber Eye', 'Wormhole'], 'selector uses the exact names');
  r.cards.forEach(c => assert(c[2] > 4000, c[0] + ' has a rendered preview'));
  assert.strictEqual(r.previewDistinct, 5, 'each preview is distinct');
  const P = r.P, f2 = n => Number(n).toFixed(2);
  // Fire Tornado
  assert(P.ft.lum > 25 && P.ft.warm, 'Fire Tornado renders lit, warm fire');
  assert(P.ft.rotation > 3, 'Fire Tornado: vortex rotates (' + f2(P.ft.rotation) + ')');
  assert(P.ft.flames > 3, 'Fire Tornado: flames climb and evolve (' + f2(P.ft.flames) + ')');
  assert(P.ft.widthLoud > P.ft.widthQuiet, 'Fire Tornado: bass expands the vortex (' + P.ft.widthQuiet + ' -> ' + P.ft.widthLoud + ')');
  assert(P.ft.lumLoud > P.ft.lumQuiet + 2, 'Fire Tornado: loud passages surge');
  assert(P.ft.embers > .3, 'Fire Tornado: treble raises embers and sparks (' + f2(P.ft.embers) + ')');
  assert(P.ft.hazeNear > P.ft.hazeFar, 'Fire Tornado: heat distortion warps the scene near the vortex (' + f2(P.ft.hazeNear) + ' vs ' + f2(P.ft.hazeFar) + ')');
  // Blue Fire
  assert(P.bf.lum > 12 && P.bf.blue, 'Blue Fire renders luminous blue plasma');
  assert(P.bf.flames > 3, 'Blue Fire: flames rise and move (' + f2(P.bf.flames) + ')');
  assert(P.bf.merge > 1, 'Blue Fire: formations merge and separate (' + f2(P.bf.merge) + ')');
  assert(P.bf.arc > .2, 'Blue Fire: energy arcs leap between formations (' + f2(P.bf.arc) + ')');
  assert(P.bf.sparks > .2, 'Blue Fire: treble adds electrical sparks (' + f2(P.bf.sparks) + ')');
  assert(P.bf.topLoud > P.bf.topQuiet, 'Blue Fire: bass makes flames rise higher (' + P.bf.topQuiet + ' -> ' + P.bf.topLoud + ')');
  assert(P.bf.vsTornado > 20, 'Blue Fire is a different scene from Fire Tornado (' + f2(P.bf.vsTornado) + ')');
  // Hollow Head
  assert(P.hh.lum > 8, 'Hollow Head renders');
  assert(P.hh.rotate > 2, 'Hollow Head: 3D rotation reveals geometry (' + f2(P.hh.rotate) + ')');
  assert(P.hh.wExp > P.hh.wRest * 1.2 && P.hh.topExp < P.hh.topRest, 'Hollow Head: expansion grows the head (' + JSON.stringify([P.hh.wRest, P.hh.wExp, P.hh.topRest, P.hh.topExp]) + ')');
  assert(P.hh.wComp < P.hh.wRest * .8 && P.hh.topComp > P.hh.topRest, 'Hollow Head: compression draws it inward (' + JSON.stringify([P.hh.wRest, P.hh.wComp, P.hh.topRest, P.hh.topComp]) + ')');
  assert(P.hh.wave > 1, 'Hollow Head: waves deform the grid (' + f2(P.hh.wave) + ')');
  assert(P.hh.jaw > .5, 'Hollow Head: jaw moves independently (' + f2(P.hh.jaw) + ')');
  assert(P.hh.face > .5, 'Hollow Head: cheeks, forehead and eye sockets move (' + f2(P.hh.face) + ')');
  assert(P.hh.fragOutside > 20, 'Hollow Head: fragmentation scatters glowing points (' + P.hh.fragOutside + ')');
  assert(P.hh.rebuilt < .01, 'Hollow Head: fragments reconstruct the original grid');
  assert(P.hh.pulse > .5, 'Hollow Head: treble lights grid pulses (' + f2(P.hh.pulse) + ')');
  // Cyber Eye
  assert(P.ce.lum > 15, 'Cyber Eye renders');
  assert(P.ce.blink > 15 && P.ce.half > 4, 'Cyber Eye: eyelids close and reopen (' + f2(P.ce.half) + ', ' + f2(P.ce.blink) + ')');
  assert(P.ce.pupilBig > P.ce.pupilSmall + 30, 'Cyber Eye: pupil expands and contracts (' + P.ce.pupilSmall + ' -> ' + P.ce.pupilBig + ')');
  assert(P.ce.radial > .3, 'Cyber Eye: radial iris structures expand (' + f2(P.ce.radial) + ')');
  assert(P.ce.ring1Inner > P.ce.ring1Outer && P.ce.ring4Outer > P.ce.ring4Inner && P.ce.ring1Inner > .5 && P.ce.ring4Outer > .5, 'Cyber Eye: iris rings rotate independently');
  assert(P.ce.aperture > 5, 'Cyber Eye: mechanical aperture forms (' + f2(P.ce.aperture) + ')');
  assert(P.ce.scan > .2, 'Cyber Eye: scanning light sweeps (' + f2(P.ce.scan) + ')');
  assert(P.ce.gaze > 1, 'Cyber Eye: the eye looks around (' + f2(P.ce.gaze) + ')');
  assert(P.ce.bassPupil > P.ce.quietPupil + 20, 'Cyber Eye: bass widens the pupil (' + P.ce.quietPupil + ' -> ' + P.ce.bassPupil + ')');
  // Wormhole
  assert(P.wh.lum > 30 && P.wh.centreBright, 'Wormhole renders with a bright central destination');
  assert(P.wh.spin > 3, 'Wormhole: tunnel rotates (' + f2(P.wh.spin) + ')');
  assert(P.wh.depth > 2, 'Wormhole: forward travel through depth (' + f2(P.wh.depth) + ')');
  assert(P.wh.nebula > 2, 'Wormhole: nebula flows (' + f2(P.wh.nebula) + ')');
  assert(P.wh.coreLoud > P.wh.coreQuiet * 1.5, 'Wormhole: bass expands the destination (' + P.wh.coreQuiet + ' -> ' + P.wh.coreLoud + ')');
  assert(P.wh.warp > 1, 'Wormhole: tunnel distortions (' + f2(P.wh.warp) + ')');
  assert(P.wh.rocks > .3, 'Wormhole: asteroids and debris are drawn');
  assert(P.wh.vsEye > 20, 'Wormhole is distinct');
  // Application
  assert(r.opened.active && r.opened.current === 'firetornado' && r.opened.frames >= 3 && r.opened.panelClosed, 'a visual launches from the selector ' + JSON.stringify(r.opened));
  assert(r.barOnEntry, 'the switcher shows briefly on entry');
  assert.strictEqual(r.visits.length, 4);
  r.visits.forEach(v => {
    assert(v.barShown && v.current === v.k && v.frames >= 3 && v.pressed === 'true' && v.snap, v.k + ': switching works with a crossfade and a clear selection');
    assert(v.w > 50 && v.h > 30, v.k + ': renders at a real resolution');
  });
  assert(r.visits.find(v => v.k === 'hollowhead').mesh, 'Hollow Head built its 3D mesh');
  assert.strictEqual(r.switchMedia, 0, 'switching never touches music playback');
  assert(r.sameDoc, 'switching never reloads the app');
  assert(r.exit.hidden && !r.exit.active && !r.exit.panel && r.exit.debug === 'undefined' && r.exit.meterOff, 'EXIT returns to Home and stops the visual and its music meter');
  assert(r.exit.glw.every(s => s === '1x1'), 'EXIT releases the render buffers (' + r.exit.glw.join(',') + ')');
  assert(r.exitStill, 'no rendering after exit');
  assert(r.reopen >= 3 && !r.paused.active, 'pausing the app closes the visual');
  assert(r.afterResume >= 3 && r.afterResumeState.current === 'hollowhead', 'visuals restart after resume');
  assert(!r.closeX.active, 'the ✕ button still closes the visual');
  assert(r.unknown === false && !r.unknownActive, 'a retired visual name cannot open a blank screen');
  const big = await runLive('app8', appPage(bridge + 'window.__mem=8;Object.defineProperty(navigator,"deviceMemory",{get:()=>8});', `
    const st=()=>window.XP&&XP.vxDebug&&XP.vxDebug();R.tiers=[];
    for(const k of ${JSON.stringify(ORDER)}){Nexus.openExperience(k);const t=Date.now();while(!(st()&&st().frames>=3)&&Date.now()-t<30000)await wait(50);const s=st();R.tiers.push({k,frames:s&&s.frames,glx:s&&s.glx});}
    Nexus.home();await wait(200);`), 300000, '640,360');
  assert.deepStrictEqual(big.errors, [], 'no page errors on the 8 GB tier');
  big.tiers.forEach(t => assert(t.frames >= 3 && t.glx >= 1, t.k + ' runs at the 8 GB tier resolution (' + t.glx + ')'));
  console.log('Visuals: five experiences rendered and measured (rotation, flames, expansion, embers, heat haze, plasma, arcs, 3D head transformations, blinking, pupil, iris rings, aperture, scanning, tunnel depth, music response); selector, switching, EXIT, pause/resume and cleanup verified in the real app page.');
})().catch(e => { console.error(e); process.exit(1); });
