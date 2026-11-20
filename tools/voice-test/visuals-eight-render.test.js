const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// Visuals collection, eight new worlds: renders the real experiences in the real app page (software WebGL),
// measures pixels for every feature and checks the music-driven motion values, then operates the app.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const xp = fs.readFileSync(path.join(assets, 'experiences.js'), 'utf8');
const ORDER = ['firetornado', 'bluefire', 'hollowhead', 'cybereye', 'wormhole'];

const EIGHT = ['deepsea', 'robotdj', 'mushroomworld', 'ufo', 'rollercoaster', 'livingskull', 'alienparty', 'neonhighway'];
const NAMES = ['Deep Sea Explorer', 'Robot DJ', 'Alien Mushroom World', 'UFO Encounter', 'Cosmic Rollercoaster', 'Living Skull', 'Alien Dance Party', 'Neon Highway'];
const catalog = app.slice(app.indexOf('var VISUALS = ['), app.indexOf('];', app.indexOf('var VISUALS = [')) + 2);
const ids = Array.from(catalog.matchAll(/\['([^']+)'/g), m => m[1]);
assert.deepStrictEqual(ids, ORDER.concat(EIGHT), 'Visuals lists the five earlier experiences followed by the eight new worlds');
for (const n of NAMES) assert(xp.includes("'" + n + "'"), n + ' is named in the engine');
for (const k of EIGHT) assert(xp.includes('VX_SCENE.' + k + ' = function'), k + ' has its own choreography');
assert(xp.includes('A2.build') && xp.includes('A2.phase') && xp.includes('A2.quiet'), 'the shared music model tracks build-ups, quiet passages and a beat clock');
assert(xp.includes('function vxIK(') && xp.includes('function vxDanceRig('), 'robot arm IK and alien dance rig exist');
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
 const P={};const U=(n,o,s,a)=>G(n,o,s,a).u;
 // DEEP SEA EXPLORER
 const ds0=G('deepsea',{zph:.2,sway:0,wave:0,flashes:0,beast:[.2,.15,.6,1]});
 P.ds={lum:mean(ds0),travel:diff(ds0,G('deepsea',{zph:.26,sway:0,wave:0,flashes:0,beast:[.2,.15,.6,1]})),current:diff(ds0,G('deepsea',{zph:.2,sway:1,wave:0,flashes:0,beast:[.2,.15,.6,1]})),
  pressure:diff(ds0,G('deepsea',{zph:.2,sway:0,wave:1,flashes:0,beast:[.2,.15,.6,1]})),glow:diff(ds0,G('deepsea',{zph:.2,sway:0,wave:0,flashes:1,high:1,beast:[.2,.15,.6,1]})),
  beast:diff(ds0,G('deepsea',{zph:.2,sway:0,wave:0,flashes:0,beast:[.2,.15,1.3,1]})),
  bassWave:U('deepsea',{},40,{bass:1,hit:true}).wave,quietWave:U('deepsea',{},40,{}).wave,approach:U('deepsea',{},200,{drama:.8}).beast[2],calm:U('deepsea',{},200,{}).beast[2]};
 // ROBOT DJ
 const r0=G('robotdj',{},30),uq=U('robotdj',{},90,{}),ub=U('robotdj',{},90,{bass:1,mid:1,high:1,energy:.8});
 const raise=U('robotdj',{},175,{strong:true,hit:true,build:.6,drama:.7,bass:1});
 P.rb={lum:mean(r0),arms:diff(r0,G('robotdj',{},140,{mid:1})),lasers:diff(G('robotdj',{lasers:0},30),G('robotdj',{lasers:1,high:1},30)),
  handsMove:Math.hypot(uq.jp[16]-ub.jp[16],uq.jp[17]-ub.jp[17],uq.jp[18]-ub.jp[18])+Math.hypot(uq.jp[28]-ub.jp[28],uq.jp[29]-ub.jp[29]),
  raiseHand:Math.max(raise.jp[17],raise.jp[29]),restHand:Math.max(uq.jp[17],uq.jp[29]),nodLoud:Math.abs(ub.jp[7]),deck:raise.jp[38]};
 // ALIEN MUSHROOM WORLD
 const m0=G('mushroomworld',{camx:0,flow:1,burst:0,open:.3,spores:0,bass:0});
 P.mu={lum:mean(m0),bass:diff(m0,G('mushroomworld',{camx:0,flow:1,burst:0,open:.3,spores:0,bass:1})),flow:diff(m0,G('mushroomworld',{camx:0,flow:3,burst:0,open:.3,spores:0,bass:0}),(x,y)=>y>25),
  burst:diff(m0,G('mushroomworld',{camx:0,flow:1,burst:1,open:1,spores:1,bass:0})),drift:diff(m0,G('mushroomworld',{camx:.3,flow:1,burst:0,open:.3,spores:0,bass:0})),
  beatBurst:U('mushroomworld',{},20,{strong:true,hit:true}).burst};
 // UFO ENCOUNTER
 const ub0={upos:[0,.55,0],uang:[.3,.1,0],ringA:0,ringB:0,tractor:0,field:.2,sweep:0,discharge:0};
 const u0=G('ufo',ub0);
 P.uf={lum:mean(u0),tractor:diff(u0,G('ufo',Object.assign({},ub0,{tractor:1}))),rings:diff(u0,G('ufo',Object.assign({},ub0,{ringA:.37,ringB:.5})),(x,y)=>y<20),
  approachLit:lit(G('ufo',Object.assign({},ub0,{upos:[0,.4,1.6]})),60,(x,y)=>y<24),farLit:lit(u0,60,(x,y)=>y<24),discharge:diff(u0,G('ufo',Object.assign({},ub0,{discharge:.6}))),
  sweep:diff(u0,G('ufo',Object.assign({},ub0,{sweep:1.2}))),bassTractor:U('ufo',{},60,{bass:1,beat:1}).tractor,quietTractor:U('ufo',{},60,{}).tractor};
 // COSMIC ROLLERCOASTER
 const c0=G('rollercoaster',{zc:40,speed:.3});
 P.rc={lum:mean(c0),travel:diff(c0,G('rollercoaster',{zc:41.5,speed:.3})),newSection:diff(c0,G('rollercoaster',{zc:400,speed:.3})),
  fastZ:U('rollercoaster',{},120,{bass:1,energy:1}).zc,slowZ:U('rollercoaster',{},120,{}).zc,lights:diff(c0,G('rollercoaster',{zc:40,speed:.3,pulse:.5,beat:1}))};
 // LIVING SKULL
 const sb={hrot:[.3,0,0],jaw:.03,glow:.5,crack:0,beam:.3,mouthE:0,frag:0};
 const s0=G('livingskull',sb);
 P.sk={lum:mean(s0),jaw:diff(s0,G('livingskull',Object.assign({},sb,{jaw:.45})),(x,y)=>y>22),turn:diff(s0,G('livingskull',Object.assign({},sb,{hrot:[-.3,.1,0]}))),
  energy:diff(s0,G('livingskull',Object.assign({},sb,{glow:1,beam:1,mouthE:1}))),crack:diff(s0,G('livingskull',Object.assign({},sb,{crack:1}))),
  bassJaw:U('livingskull',{},40,{bass:1}).jaw,quietJaw:U('livingskull',{},40,{}).jaw,buildJaw:U('livingskull',{},60,{build:.8}).jaw};
 // ALIEN DANCE PARTY
 const uA=U('alienparty',{},10,{}),uB=U('alienparty',{},40,{bass:1,mid:1,energy:1,phase:3.6});
 const per=[0,1,2,3,4].map(a=>{let s=0;for(let j=0;j<13;j++)for(let c=0;c<3;c++)s+=Math.abs(uA.J[(a*13+j)*4+c]-uB.J[(a*13+j)*4+c]);return s;});
 const dA=G('alienparty',{},10,{}),dB=G('alienparty',{},40,{bass:1,mid:1,energy:1});
 const blob=a=>{let y=0;for(let k=0;k<12;k++){const u=U('alienparty',{},10+k*4,{bass:a,energy:a,hit:k%4===0});y=Math.max(y,u.J[13*4+1]);}return y;};
 P.ad={lum:mean(dA),dance:diff(dA,dB),per:per,blobLoud:blob(1),blobQuiet:blob(0)};
 // NEON HIGHWAY
 const h0=G('neonhighway',{D:50,run:-50,runAmp:0,bob:0,steer:0});
 P.nh={lum:mean(h0),drive:diff(h0,G('neonhighway',{D:53,run:-50,runAmp:0,bob:0,steer:0})),lightRun:diff(h0,G('neonhighway',{D:50,run:20,runAmp:1.2,bob:0,steer:0})),
  suspension:diff(h0,G('neonhighway',{D:50,run:-50,runAmp:0,bob:1,steer:.6})),newFormation:diff(h0,G('neonhighway',{D:50,run:-50,runAmp:0,bob:0,steer:0,section:2})),
  hitRun:U('neonhighway',{},10,{hit:true,bass:1}).runAmp,loudD:U('neonhighway',{},90,{bass:1,energy:1}).D,quietD:U('neonhighway',{},90,{}).D};
 R.P=P;
 const lums={};for(const n of ${JSON.stringify(ORDER.concat(['deepsea','robotdj','mushroomworld','ufo','rollercoaster','livingskull','alienparty','neonhighway']))})lums[n]=G(n,{},20).grid;
 R.distinct=[];const ks=Object.keys(lums);for(let i=0;i<ks.length;i++)for(let j=i+1;j<ks.length;j++)R.distinct.push([ks[i],ks[j],diff({grid:lums[ks[i]]},{grid:lums[ks[j]]})]);
`;
const appScenario = `
 const box=()=>document.getElementById('xp'),st=()=>window.XP&&XP.vxDebug&&XP.vxDebug();
 async function frames(n,limit){const s=(st()||{}).frames||0,t=Date.now();while(((st()||{}).frames||0)<s+n&&Date.now()-t<(limit||30000))await wait(50);return ((st()||{}).frames||0)-s;}
 window.__marker=Math.random();const marker=__marker;
 document.querySelector('[data-act=visuals]').click();
 const t0=Date.now();while(!document.querySelector('.vis-card')&&Date.now()-t0<90000)await wait(100);
 R.cards=[...document.querySelectorAll('.vis-card')].map(c=>[c.dataset.vis,c.querySelector('b').textContent,(c.querySelector('img')||{}).src?c.querySelector('img').src.length:0]);
 __step('probe');${'${probeScenario}'}
 const media0=__media.length;
 document.querySelector('.vis-card[data-vis=deepsea]').click();
 const t1=Date.now();while(!(window.XP&&XP.active)&&Date.now()-t1<20000)await wait(50);
 R.opened={current:XP.current,frames:await frames(2)};
 R.barButtons=document.querySelectorAll('#vxBar .vx-pick').length;
 R.visits=[];
 for(const k of ${JSON.stringify(EIGHT.slice(1))}){box().click();await wait(80);document.querySelector('#vxBar [data-vx='+k+']').click();const f=await frames(2);const s=st();R.visits.push({k,current:XP.current,frames:f,w:s&&s.w});}
 R.switchMedia=__media.length-media0;R.sameDoc=window.__marker===marker;
 box().click();await wait(80);document.querySelector('#vxBar [data-vxexit]').click();await wait(300);
 const gc=[...document.querySelectorAll('#xp canvas')].filter(c=>c.id!=='xpc'&&c.id!=='vxSnap');
 R.exit={active:XP.active,hidden:box().classList.contains('hidden'),glw:gc.map(c=>c.width+'x'+c.height),meterOff:__meter[__meter.length-1]===false};
`;
(async () => {
  const r = await runLive('app', appPage(bridge + 'window.__mem=2;Object.defineProperty(navigator,"deviceMemory",{get:()=>2});', appScenario.replace('${probeScenario}', probeScenario)), 900000, '640,360');
  assert.deepStrictEqual(r.errors, [], 'no page errors');
  assert.deepStrictEqual(r.cards.map(c => c[0]), ORDER.concat(EIGHT), 'selector shows all thirteen visuals');
  assert.deepStrictEqual(r.cards.slice(5).map(c => c[1]), NAMES, 'the eight new worlds use their exact names');
  r.cards.forEach(c => assert(c[2] > 3000, c[0] + ' has a rendered preview'));
  const P = r.P, f2 = n => Number(n).toFixed(2), gt = (a, b, msg) => assert(a > b, msg + ' (' + f2(a) + ' vs ' + f2(b) + ')');
  for (const [k, v] of Object.entries(P)) assert(v.lum > 8, k + ' renders a lit scene (' + f2(v.lum) + ')');
  // Deep Sea Explorer
  gt(P.ds.travel, 1, 'Deep Sea: the viewpoint travels forward through the layers');
  gt(P.ds.current, .3, 'Deep Sea: midrange currents sway the plants');
  gt(P.ds.pressure, .3, 'Deep Sea: bass sends pressure waves through the water');
  gt(P.ds.glow, .2, 'Deep Sea: treble triggers bioluminescent flashes');
  gt(P.ds.beast, .3, 'Deep Sea: the leviathan can come close');
  gt(P.ds.bassWave, P.ds.quietWave + .2, 'Deep Sea: bass hits drive the pressure wave');
  gt(P.ds.approach, P.ds.calm + .2, 'Deep Sea: strong passages bring the creature closer');
  // Robot DJ
  gt(P.rb.arms, .3, 'Robot DJ: arms and hands move on the console');
  gt(P.rb.lasers, .3, 'Robot DJ: treble drives the lasers');
  gt(P.rb.handsMove, .02, 'Robot DJ: music changes the hand work');
  gt(P.rb.raiseHand, 1.9, 'Robot DJ: build-ups and strong beats raise an arm to the crowd');
  gt(P.rb.nodLoud, .02, 'Robot DJ: the head nods with the bass');
  gt(P.rb.deck, .5, 'Robot DJ: the decks spin');
  // Alien Mushroom World
  gt(P.mu.bass, .5, 'Mushroom World: bass expands the mushroom caps');
  gt(P.mu.flow, .2, 'Mushroom World: the stream flows');
  gt(P.mu.burst, .5, 'Mushroom World: beat bursts open the gills and release spores');
  gt(P.mu.drift, 1, 'Mushroom World: the camera drifts through layered depth');
  gt(P.mu.beatBurst, .3, 'Mushroom World: strong beats trigger spore bursts');
  // UFO Encounter
  gt(P.uf.tractor, .5, 'UFO: tractor beam');
  gt(P.uf.rings, .1, 'UFO: rings and lights rotate');
  gt(P.uf.approachLit, P.uf.farLit * 1.2, 'UFO: the craft approaches the viewer');
  gt(P.uf.discharge, .2, 'UFO: energy discharges');
  gt(P.uf.sweep, .3, 'UFO: searchlights sweep the landscape');
  gt(P.uf.bassTractor, P.uf.quietTractor + .2, 'UFO: bass drives the tractor beam');
  // Cosmic Rollercoaster
  gt(P.rc.travel, 2, 'Rollercoaster: first-person travel along the track');
  gt(P.rc.newSection, 5, 'Rollercoaster: the journey moves into new sections');
  gt(P.rc.fastZ, P.rc.slowZ * 1.3, 'Rollercoaster: bass and energy accelerate the ride');
  gt(P.rc.lights, .2, 'Rollercoaster: track energy streams and beat lighting');
  // Living Skull
  gt(P.sk.jaw, .5, 'Living Skull: the jaw opens');
  gt(P.sk.turn, 1, 'Living Skull: the skull turns and tilts');
  gt(P.sk.energy, .5, 'Living Skull: eye and mouth energy');
  gt(P.sk.crack, .1, 'Living Skull: glowing cracks');
  gt(P.sk.bassJaw, P.sk.quietJaw + .08, 'Living Skull: bass drives the jaw');
  gt(P.sk.buildJaw, P.sk.quietJaw + .08, 'Living Skull: build-ups open the mouth wider');
  // Alien Dance Party
  gt(P.ad.dance, 1, 'Alien Dance Party: the dancers move');
  P.ad.per.forEach((v, i) => gt(v, .3, 'Alien Dance Party: alien ' + (i + 1) + ' dances'));
  assert(new Set(P.ad.per.map(v => v.toFixed(1))).size >= 4, 'Alien Dance Party: each alien moves differently');
  gt(P.ad.blobLoud, P.ad.blobQuiet + .03, 'Alien Dance Party: bass makes the Blob bounce higher');
  // Neon Highway
  gt(P.nh.drive, 1, 'Neon Highway: continuous forward drive');
  gt(P.nh.lightRun, .3, 'Neon Highway: light runs race along the road');
  gt(P.nh.suspension, .5, 'Neon Highway: suspension and steering move the view');
  gt(P.nh.newFormation, .3, 'Neon Highway: the desert changes formation');
  gt(P.nh.hitRun, .3, 'Neon Highway: beats launch light runs');
  gt(P.nh.loudD, P.nh.quietD * 1.1, 'Neon Highway: bass and energy speed the drive');
  // every experience is visually distinct from every other
  const close = r.distinct.filter(d => d[2] < 12);
  assert.strictEqual(close.length, 0, 'every visual is distinct: ' + close.map(d => d.join(':')).join(', '));
  // app flow
  assert(r.opened.current === 'deepsea' && r.opened.frames >= 2, 'Deep Sea Explorer launches from the selector');
  assert.strictEqual(r.barButtons, 13, 'the in-visual switcher lists all thirteen visuals');
  r.visits.forEach(v => assert(v.current === v.k && v.frames >= 2 && v.w > 50, v.k + ' opens from the switcher and renders'));
  assert.strictEqual(r.switchMedia, 0, 'switching never touches music playback'); assert(r.sameDoc, 'no reload');
  assert(r.exit.hidden && !r.exit.active && r.exit.meterOff && r.exit.glw.every(s => s === '1x1'), 'EXIT returns Home and releases GPU resources (' + r.exit.glw.join(',') + ')');
  const big = await runLive('app8', appPage(bridge + 'window.__mem=8;Object.defineProperty(navigator,"deviceMemory",{get:()=>8});', `
    const st=()=>window.XP&&XP.vxDebug&&XP.vxDebug();R.tiers=[];
    for(const k of ${JSON.stringify(EIGHT)}){Nexus.openExperience(k);const t=Date.now();while(!(st()&&st().current===k&&st().frames>=2)&&Date.now()-t<40000)await wait(50);const s=st();R.tiers.push({k,frames:s&&s.frames,glx:s&&s.glx});}
    Nexus.home();await wait(200);`), 600000, '640,360');
  assert.deepStrictEqual(big.errors, [], 'no page errors on the 8 GB tier');
  big.tiers.forEach(t => assert(t.frames >= 2 && t.glx >= 1, t.k + ' runs on the 8 GB tier (' + t.glx + ')'));
  console.log('Visuals: eight new worlds rendered and measured (travel, currents, pressure waves, creatures, robot arm IK and gestures, decks, mushrooms, spores, tractor beam, approach, track travel and sections, jaw, cracks, energy, five independent dancers, light runs, suspension); all thirteen are distinct; selector, switcher, EXIT and both memory tiers verified.');
})().catch(e => { console.error(e); process.exit(1); });
