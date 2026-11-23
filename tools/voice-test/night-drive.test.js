const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// NIGHT DRIVE: renders the real Celestial Rings shader in a browser WebGL context and measures
// pixels, then opens the real app page, launches Night Drive from its home tile and drives it —
// movement, controls that fade, settings, exit, re-entry, and the experiences around it.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const exp = fs.readFileSync(path.join(assets, 'experiences.js'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(assets, 'style.css'), 'utf8');
const env = fs.readFileSync(path.join(assets, 'env.js'), 'utf8');
const java = fs.readFileSync(path.join(root, 'app/src/main/java/com/nexus/box/MainActivity.java'), 'utf8');

function lit(name) {
  const m = exp.match(new RegExp('var ' + name + ' = `([\\s\\S]*?)`;'));
  assert(m, name + ' is embedded in experiences.js');
  return m[1];
}
const ND_HEAD = lit('ND_HEAD'), ND_MAIN = lit('ND_MAIN'), ND_RINGS = lit('ND_CELESTIAL_RINGS'), ND_COSMIC = lit('ND_COSMIC_HIGHWAY');
const GL_HEAD = (exp.match(/var GL_HEAD = ([\s\S]*?);\n  function glStart/) || [])[1];
assert(GL_HEAD, 'the shared shader prelude is readable');
// eslint-disable-next-line no-new-func
const prelude = Function('return ' + GL_HEAD)();
const shader = prelude + ND_HEAD + ND_RINGS + ND_MAIN;
const cosmicShader = prelude + ND_HEAD + ND_COSMIC + ND_MAIN;

// ---------- Static integration ----------
assert(/case 'night': fromVisuals = false; openExperience\('nightdrive'\); break;/.test(app), 'the Night Drive tile opens the experience');
assert(/function openExperience\(name, fromPlay\)/.test(app) && /if \(!fromPlay\) stopPlaythrough\(\);/.test(app) && /openExperience\(name, true\);/.test(app),
  'a Play All run cannot hijack an experience opened outside it');
assert(/\[\/\\bnight drive\\b\/, 'night'\]/.test(app), 'Night Drive is reachable by voice');
// The old screen dimmer is gone from every layer, down to the Java bridge method.
[['app.js', app], ['env.js', env], ['style.css', css], ['index.html', html], ['MainActivity.java', java]].forEach(function (pair) {
  assert(!/toggleNight|setBrightness|mode\.night|body\.night|nightmode|NIGHT MODE/.test(pair[1]),
    'no screen-dimming code left in ' + pair[0]);
});
assert((html.match(/data-act="night"/g) || []).length === 1, 'exactly one Night Drive entry, no duplicate');
assert(html.includes('data-act="night"') && html.includes('Night Drive'), 'the Night Drive tile is in the home catalog');
assert(/var mode = \{ party: false, intruder: false \};/.test(app), 'the night flag is gone from the app mode state');
assert(/nightdrive: 1/.test(exp) && /nightdrive: nightDrive/.test(exp), 'Night Drive is registered in the experience shell');
assert(/function nightDrive\(\)/.test(exp), 'experiences.js defines the Night Drive experience');
assert(ND_MAIN.includes('float h0 = hillAt(tr);') && ND_MAIN.includes('- h0)*.26, camH*.45)'),
  'hills are measured from the road under the camera, so the highway keeps one size and the camera never sinks into it');
assert(/if \(S !== old\) \{ pendingSize = true;/.test(exp) && exp.includes('if (pendingSize) { pendingSize = false; size(); }'),
  'a quality change resizes right before the next draw, so no black frame is shown');
assert(ND_MAIN.includes('float run = ') && ND_RINGS.includes('float wave = '), 'the neon edges and the rings both follow the music');
['ndSky', 'ndHaze', 'ndGround', 'ndRoadFx'].forEach(h => {
  assert(ND_RINGS.includes('vec3 ' + h + '('), 'Celestial Rings implements the ' + h + ' hook');
  assert(ND_COSMIC.includes('vec3 ' + h + '('), 'Cosmic Highway implements the ' + h + ' hook');
});
assert(/\{ id: 'cosmic', name: 'COSMIC HIGHWAY', frag: ND_COSMIC_HIGHWAY \}/.test(exp), 'Cosmic Highway is offered as a Night Drive world');
['chGalaxy', 'chStars', 'chRibbons', 'chEye', 'chHill'].forEach(f => assert(ND_COSMIC.includes(f + '('), 'Cosmic Highway builds its ' + f));
// GLSL leaves smoothstep undefined when its first edge is above the second; some GPUs return 0.
(ND_COSMIC.match(/smoothstep\(\s*-?[\d.]+\s*,\s*-?[\d.]+/g) || []).forEach(m => {
  const e = m.slice(11).split(',').map(Number);
  assert(e[0] < e[1], 'Cosmic Highway only uses well-defined smoothstep edges: ' + m);
});
assert(ND_MAIN.includes('col *= fadeIn;') && /fadeIn', fk \* fk \* \(3 - 2 \* fk\)/.test(exp), 'a world eases in from black when it starts or changes');
['ndPlanet', 'ndRings', 'ndStarField', 'ndNebula', 'rgMoon'].forEach(f => assert(ND_RINGS.includes(f + '('), 'the world builds its ' + f));
assert(/curveAt|hillAt/.test(ND_HEAD) && ND_MAIN.includes('hillAt(') && ND_MAIN.includes('curveAt('),
  'the shared highway carries the curves and crests, so other worlds inherit them');
assert(ND_MAIN.includes('ndSky(') && ND_MAIN.includes('ndGround(') && ND_MAIN.includes('ndHaze('),
  'the shared highway calls into the world through the hooks only');
assert(!/orbR|heroOrb|PARTY/.test(ND_HEAD + ND_MAIN), 'Night Drive shares nothing with Party Mode');
// Nothing automotive: the journey is the highway and the world around it.
assert(!/\b(car|truck|vehicle|cockpit|dashboard|steeringWheel|speedometer|bonnet|windshield)\b/i.test(ND_HEAD + ND_RINGS + ND_COSMIC + ND_MAIN),
  'the scene contains no vehicle, cockpit or dashboard');
assert(css.includes('#xp.night-drive.nd-idle .nd-ui') && css.includes('opacity: 0; pointer-events: none;'),
  'the controls fade out of the way');
assert(css.includes('#xp.night-drive.nd-idle #xpClose'), 'the exit button fades with the controls');
// The experiences either side of it are untouched.
assert(/function liquidDreams\(\)/.test(exp) && /var XP = window\.XP/.test(exp), 'the existing experiences are intact');
assert(fs.existsSync(path.join(assets, 'party.js')), 'Party Mode is untouched');

const browser = process.env.LIQUID_DREAMS_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser && fs.existsSync(browser), 'Edge or Chrome is required for the actual WebGL render check');
const fileUrl = file => 'file:///' + file.replace(/\\/g, '/').replace(/^\//, '');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'night-drive-'));

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
// Real-time run over the DevTools protocol: software-GL frames do not advance headless virtual
// time, so the journey plays on the wall clock and the result element is polled.
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

// ---------- A. The scene, in pixels ----------
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
 // hue comes from the shared prelude and this world does not use it, so it is not set here
 const base={res:[W,H],time:42.5,kick:.2,energy:.35,travel:1200,night:.55,react:1,mids:.3,highs:.3,bass:.3,hat:0,pulseT:[99,99,99,99],pulseS:[0,0,0,0],q:1,fadeIn:1,
  cA:[.25,.72,1],cB:[.52,.35,1],cC:[1,.35,.85],cD:[.25,.95,.82]};
 // helper boxes in pixels, measured from the bottom-left
 function box(x0,y0,x1,y1){return [x0,y0,x1,y1];}
 function render(over){const u=Object.assign({},base,over);
  for(const [k,v] of Object.entries(u)){const L=gl.getUniformLocation(p,k);if(L===null)continue;
   if(!Array.isArray(v))gl.uniform1f(L,v);else if(v.length===2)gl.uniform2f(L,v[0],v[1]);else if(v.length===4)gl.uniform4f(L,v[0],v[1],v[2],v[3]);else gl.uniform3f(L,v[0],v[1],v[2]);}
  gl.viewport(0,0,W,H);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
  function mean(bx){let s=0,n=0;for(let y=bx[1];y<bx[3];y++)for(let x=bx[0];x<bx[2];x++){const i=(y*W+x)*4;s+=.299*px[i]+.587*px[i+1]+.114*px[i+2];n++;}return s/n;}
  // a band across the road: bright markings and edges either side, dark asphalt between
  function scan(y0,y1,cw){let lm=0,rm=0,c=0,n=0,cx=0;
   for(let y=y0;y<y1;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,L2=.299*px[i]+.587*px[i+1]+.114*px[i+2];
    if(x<W*.4)lm=Math.max(lm,L2); else if(x>W*.6)rm=Math.max(rm,L2);
    if(x>=W*(.5-cw)&&x<W*(.5+cw)){c+=L2;n++;cx=Math.max(cx,L2);}}
   return {left:lm,right:rm,centre:c/n,centreMax:cx};}
  let lum=0,bright=0,brightSky=0,maxSky=0,sat=0,roadBright=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,L2=.299*px[i]+.587*px[i+1]+.114*px[i+2];
   lum+=L2;if(L2>120)bright++;
   const mx=Math.max(px[i],px[i+1],px[i+2]),mn=Math.min(px[i],px[i+1],px[i+2]);sat+=mx?(mx-mn)/mx:0;
   if(y>H*0.55){brightSky+=L2>120?1:0;if(L2>maxSky)maxSky=L2;}
   if(y<H*0.45&&L2>120)roadBright++;}
  const n=W*H;
  const bytes=[];for(let i=0;i<px.length;i+=389)bytes.push(px[i]);
  return {lum:lum/n,bright:bright/n,sat:sat/n,maxSky:maxSky,roadBright:roadBright/n,
   planet:mean(box(44,62,78,96)), skyHigh:mean(box(150,96,190,116)),
   roadNear:scan(14,30,.04), roadHorizon:scan(42,52,.15),
   formation:(function(){let c=0,n=0;for(let y=Math.floor(H*.5);y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;const L2=.299*px[i]+.587*px[i+1]+.114*px[i+2];if(L2>60)c++;n++;}return c/n;})(),
   roadC:mean(box(86,6,114,30)), offRoad:mean(box(2,6,26,30)), horizonDark:(function(){let n=0;for(let y=56;y<62;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;if(.299*px[i]+.587*px[i+1]+.114*px[i+2]<25)n++;}return n/(6*W);})(),
   green:(function(){let g=0;for(let y=0;y<H*.6;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;if(px[i+1]>120&&px[i+1]>px[i]*1.4&&px[i+1]>px[i+2]*1.1)g++;}return g/(W*H);})(),
   horizonL:mean(box(70,46,86,54)), horizonR:mean(box(114,46,130,54)), bytes:bytes};}
 const diff=(a,b)=>a.bytes.reduce((s,v,i)=>s+Math.abs(v-b.bytes[i]),0)/a.bytes.length;
 const R={};
 R.hero=render({});
 R.moved=render({travel:1260});
 R.farAlong=render({travel:52000,time:540});
 R.dusk=render({night:0}); R.deep=render({night:1});
 R.quiet=render({kick:0,energy:0,mids:0,highs:0}); R.loud=render({kick:1,energy:1,mids:1,highs:1,bass:1,hat:1,pulseT:[.3,.8,1.3,1.9],pulseS:[1,1,1,1]});
 R.noReact=render({react:0,kick:1,energy:1});
 R.aurora=render({cA:[.34,1,.82],cB:[.44,.56,1],cC:[.82,.44,1],cD:[.30,.96,.96]});
 R.q0=render({q:0});
 R.black=render({fadeIn:0}); R.half=render({fadeIn:.5});
 R.d={move:diff(R.hero,R.moved),far:diff(R.hero,R.farAlong),music:diff(R.quiet,R.loud),
  palette:diff(R.hero,R.aurora),deaf:diff(R.loud,R.noReact),tier:diff(R.hero,R.q0)};
 // a long journey must keep changing: sample the horizon across many kilometres
 R.journey=[];
 for(let i=0;i<8;i++)R.journey.push(render({travel:2000+i*1700,time:60+i*40}));
 R.journeyDiff=[];for(let i=1;i<R.journey.length;i++)R.journeyDiff.push(diff(R.journey[i-1],R.journey[i]));
 R.journey.forEach(x=>delete x.bytes);
 Object.keys(R).forEach(k=>{if(R[k]&&R[k].bytes)delete R[k].bytes;});
 out.textContent='RESULT='+JSON.stringify(R);
}catch(e){out.textContent='ERROR='+(e.stack||e);}
</script>`;
const S = runPage('nd-shader', shaderPage, 60000);

assert(S.hero.lum > 12, 'the world is lit, not a black frame (' + S.hero.lum.toFixed(1) + ')');
assert(S.hero.planet > S.hero.skyHigh * 1.25,
  'the ringed planet stands out clearly against the open sky (' + S.hero.planet.toFixed(1) + ' vs open sky ' + S.hero.skyHigh.toFixed(1) + ')');
assert(S.hero.horizonDark < .2, 'the horizon is open, luminous sky with no dark silhouettes (' + (S.hero.horizonDark * 100).toFixed(0) + '% dark just above it)');
assert(S.hero.green > .004, 'green lamps line the highway (' + (S.hero.green * 100).toFixed(2) + '% of the frame)');
assert(S.d.music > 2 && S.loud.green > S.quiet.green, 'the green lamps flash brighter with the music');
assert(S.hero.formation > .2,
  'the planet and its rings fill a large part of the sky (' + (S.hero.formation * 100).toFixed(0) + '% of it)');
assert(S.hero.maxSky > 200, 'the rings carry bright luminous bands (' + S.hero.maxSky.toFixed(0) + ')');
var near = S.hero.roadNear;
assert(near.left > 110 && near.right > 110 && near.centre < Math.min(near.left, near.right) * .65,
  'the highway runs up the middle, lit on both sides with dark asphalt between (' +
  near.left.toFixed(0) + ' | ' + near.centre.toFixed(0) + ' | ' + near.right.toFixed(0) + ')');
assert(S.hero.roadHorizon.centreMax > 60,
  'the road carries on into the distance toward the horizon (' + S.hero.roadHorizon.centreMax.toFixed(0) + ')');
assert(S.hero.roadBright > .004, 'lane markings and neon edges are visible on the road (' + S.hero.roadBright.toFixed(4) + ')');
assert(S.hero.sat > .35, 'the palette stays rich rather than washing out (' + S.hero.sat.toFixed(2) + ')');
assert(S.d.move > 2, 'a short distance along the road changes the view (' + S.d.move.toFixed(1) + ')');
assert(S.d.far > 6, 'far along the journey the world is different again (' + S.d.far.toFixed(1) + ')');
assert(S.journeyDiff.every(d => d > 2), 'the journey keeps changing rather than looping (' + S.journeyDiff.map(d => d.toFixed(1)).join(', ') + ')');
assert(S.dusk.lum > S.deep.lum * 1.12, 'time of night changes the sky (' + S.dusk.lum.toFixed(1) + ' -> ' + S.deep.lum.toFixed(1) + ')');
assert(S.d.music > 2 && S.loud.lum > S.quiet.lum, 'the world answers the music (' + S.d.music.toFixed(1) + ')');
assert(S.d.deaf > 2, 'music reactivity can be switched off (' + S.d.deaf.toFixed(1) + ')');
assert(S.d.palette > 3, 'the colour schemes are genuinely different (' + S.d.palette.toFixed(1) + ')');
assert(S.q0.lum > 12 && S.q0.roadNear.left > 110 && S.q0.roadNear.right > 110 && S.q0.formation > .2,
  'the 2 GB quality tier renders the same world');

assert(S.black.lum < 2 && S.half.lum > 3 && S.half.lum < S.hero.lum, 'the world fades in from black (' + S.black.lum.toFixed(1) + ' -> ' + S.half.lum.toFixed(1) + ' -> ' + S.hero.lum.toFixed(1) + ')');

// ---------- A2. Cosmic Highway, in pixels ----------
const C = runPage('nd-cosmic', shaderPage.split(JSON.stringify(shader)).join(JSON.stringify(cosmicShader)), 60000);
assert(C.hero.lum > 20, 'Cosmic Highway is lit, not a black frame (' + C.hero.lum.toFixed(1) + ')');
assert(C.hero.maxSky > 220, 'the galaxy and brilliant stars blaze in the sky (' + C.hero.maxSky.toFixed(0) + ')');
assert(C.hero.formation > .25, 'the galaxy, ribbons and horizon glow fill much of the sky (' + (C.hero.formation * 100).toFixed(0) + '%)');
assert(C.hero.roadNear.left > 110 && C.hero.roadNear.right > 110, 'light trails and neon edges run down both sides of the road');
assert(C.hero.roadBright > .02, 'the road carries bright light trails (' + C.hero.roadBright.toFixed(3) + ')');
assert(C.hero.sat > .35, 'the neon palette stays rich (' + C.hero.sat.toFixed(2) + ')');
assert(C.d.move > 2 && C.d.far > 6, 'the drive moves and the view keeps changing (' + C.d.move.toFixed(1) + ', ' + C.d.far.toFixed(1) + ')');
assert(C.journeyDiff.every(d => d > 2), 'a long Cosmic Highway journey keeps changing (' + C.journeyDiff.map(d => d.toFixed(1)).join(', ') + ')');
assert(C.d.music > 4 && C.loud.lum > C.quiet.lum, 'Cosmic Highway answers the music clearly, element by element rather than with a global flash (' + C.d.music.toFixed(1) + ', ' + C.quiet.lum.toFixed(1) + ' -> ' + C.loud.lum.toFixed(1) + ')');
assert(C.d.deaf > 2, 'its music reactivity can be switched off (' + C.d.deaf.toFixed(1) + ')');
assert(C.d.palette > 3 && C.dusk.lum > C.deep.lum * 1.05, 'colour and time of night both change the world');
assert(C.q0.lum > 20 && C.q0.roadNear.left > 110, 'the 2 GB quality tier renders Cosmic Highway too');
assert(C.black.lum < 2 && C.half.lum < C.hero.lum, 'Cosmic Highway fades in from black');

// ---------- B. The real app ----------
function appPage(setup, scenario) {
  let page = html.replace(/(src|href)="(?!https?:)([^"]+\.(js|css))"/g, (m, a, f) => a + '="' + fileUrl(path.join(assets, f)) + '"');
  // experiences.js is appended at runtime with a relative src, so the page needs the assets base
  page = page.replace('<head>', '<head><base href="' + fileUrl(assets) + '/"><script>window.__errors=[];addEventListener("error",e=>__errors.push(String(e.message)));' + setup + '</script>');
  page = page.replace('</body>', '<pre id="__out">WAITING</pre><script>setTimeout(async()=>{const out=document.getElementById("__out");try{const wait=ms=>new Promise(r=>setTimeout(r,ms));const R={};' + scenario + ';R.errors=__errors;out.textContent="RESULT="+JSON.stringify(R);}catch(e){out.textContent="ERROR="+(e.stack||e);}},700);</script></body>');
  return page;
}
const bridge = `window.__prefs={};window.__media=[];window.Android={getPref:k=>window.__prefs[k]||"",setPref:(k,v)=>{window.__prefs[k]=String(v);},
  partyMeter:()=>{},meter:s=>{window.__meter=!!s;},isMusicActive:()=>false,nowPlaying:()=>"",setBrightness:()=>{},
  partyMediaInfo:()=>JSON.stringify({access:true,app:"com.spotify.music",title:"Signal Bloom",artist:"Violet Arc",playing:false,canPrevious:true,canNext:true,canPlayPause:true}),
  mediaPlayPause:()=>__media.push("toggle"),deviceMemoryGb:()=>window.__mem||2};`;

const scenario = `
 const nd=()=>window.XP&&XP.ndDebug?XP.ndDebug():null;
 async function until(f,limit){const t=Date.now();while(!f()&&Date.now()-t<(limit||25000))await wait(60);return f();}
 async function frames(n){const s=nd()?nd().frames:0;await until(()=>nd()&&nd().frames>=s+n,25000);return nd()?nd().frames-s:0;}
 // launch from the real home tile
 document.querySelector("[data-act=night]").click();
 R.launched=await until(()=>nd()&&nd().frames>0,30000);
 R.open={active:XP.active,current:XP.current,layer:!document.getElementById("xp").classList.contains("hidden")};
 R.start=nd();
 // the journey moves on its own
 const t0=nd().travel;await frames(6);const t1=nd().travel;
 R.moved=t1-t0;
 // controls are there on arrival, then get out of the way
 R.controlsAtStart={present:!!document.querySelector("#xp .nd-ui"),idle:document.getElementById("xp").classList.contains("nd-idle")};
 R.faded=await until(()=>document.getElementById("xp").classList.contains("nd-idle"),9000);
 document.getElementById("xp").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:3,isPrimary:true}));
 await wait(120);R.wokeOnTouch=!document.getElementById("xp").classList.contains("nd-idle");
 // speed changes how fast the world goes by
 document.querySelector("[data-speed=fast]").click();await wait(60);
 const f0=nd().travel;await frames(6);const f1=nd().travel;
 R.fastMoved=f1-f0;R.speed=nd().speed;
 document.querySelector("[data-time=deep]").click();
 document.querySelector("[data-palette=aurora]").click();
 document.querySelector("[data-react=t]").click();
 await frames(2);R.afterSettings=nd();
 R.stored={speed:window.__prefs.ndSpeed,time:window.__prefs.ndTime,palette:window.__prefs.ndPalette,react:window.__prefs.ndReact};
 R.meterOffWithMusicOff=window.__meter===false;
 document.querySelector("[data-react=t]").click();await frames(2);R.reactBack=nd().react;
 // switch to Cosmic Highway mid-journey: it eases in and keeps driving
 const tw=nd().travel;
 document.querySelector("[data-world=cosmic]").click();await frames(6);
 R.cosmic={world:nd().world,gl:nd().gl,moved:nd().travel-tw,saved:window.__prefs.ndWorld,
  on:!!document.querySelector('[data-world=cosmic].on'),fade:nd().fade};
 // keep driving for a while: nothing should pile up
 const domBefore=document.querySelectorAll("#xp *").length;
 await frames(25);
 R.domStable=document.querySelectorAll("#xp *").length-domBefore;
 R.longRun=nd().travel>t1;
 // exit
 document.getElementById("xpClose").click();await wait(400);
 R.afterExit={active:XP.active,hidden:document.getElementById("xp").classList.contains("hidden"),
  ui:!!document.querySelector("#xp .nd-ui"),ndDebug:!!(window.XP&&XP.ndDebug),nightClass:document.getElementById("xp").classList.contains("night-drive")};
 const home=!document.getElementById("home").classList.contains("hidden");
 R.backHome=home;
 // settings come back on the next journey
 document.querySelector("[data-act=night]").click();
 R.relaunched=await until(()=>nd()&&nd().frames>0,30000);
 R.restored=nd();
 document.getElementById("xpClose").click();await wait(300);
 // the experiences either side of it still work
 document.querySelector("[data-act=party]").click();await wait(900);
 R.party={open:!document.getElementById("party").classList.contains("hidden"),state:window.NexusParty?NexusParty.state().active:null};
 document.querySelector(".party-exit").click();await wait(250);
 document.querySelector("[data-act=liquiddreams]").click();
 R.liquid=await until(()=>XP.active&&XP.current==="liquiddreams",25000);
 XP.close();await wait(200);
 R.nightModeStillThere=typeof window.Nexus==="object";`;

(async () => {
  const run = await runLive('nd-app', appPage(bridge + 'window.__mem=2;Object.defineProperty(navigator,"deviceMemory",{get:()=>2});', scenario), 220000, '640,360');
  assert.deepStrictEqual(run.errors, [], 'no page errors');
  assert(run.launched && run.open.active && run.open.current === 'nightdrive' && run.open.layer,
    'the home tile launches Night Drive ' + JSON.stringify(run.open));
  assert(run.start.gl, 'the world is running on the GPU ' + JSON.stringify(run.start));
  assert(run.start.world === 'rings', 'it opens in Celestial Rings');
  assert(run.start.quality === 0 && run.start.glx < 1, '2 GB tier: reduced render scale and detail (' + run.start.glx + ')');
  assert(run.moved > 10, 'the journey moves forward on its own (' + run.moved.toFixed(1) + ' m)');
  assert(run.controlsAtStart.present && !run.controlsAtStart.idle, 'controls are there when the journey opens');
  assert(run.faded, 'controls fade away on their own');
  assert(run.wokeOnTouch, 'a touch brings the controls back');
  assert(run.speed === 'fast' && run.fastMoved > run.moved * 1.3,
    'the speed control changes how fast the world goes by (' + run.moved.toFixed(1) + ' -> ' + run.fastMoved.toFixed(1) + ')');
  assert(run.afterSettings.time === 'deep' && run.afterSettings.palette === 'aurora' && run.afterSettings.react === false,
    'time, colour and music reactivity all take effect ' + JSON.stringify(run.afterSettings));
  assert(run.meterOffWithMusicOff, 'switching music reactivity off stops the audio meter');
  assert(run.reactBack === true, 'music reactivity switches back on');
  assert(run.cosmic.world === 'cosmic' && run.cosmic.gl && run.cosmic.on && run.cosmic.saved === 'cosmic',
    'Cosmic Highway can be picked from the WORLD row and is saved ' + JSON.stringify(run.cosmic));
  assert(run.cosmic.moved > 0 && run.cosmic.fade > 0, 'the journey carries on through the change and the new world fades in');
  assert(run.stored.speed === 'fast' && run.stored.time === 'deep' && run.stored.palette === 'aurora', 'choices are saved');
  assert(run.longRun && run.domStable === 0, 'a long run adds nothing to the page (' + run.domStable + ' nodes)');
  assert(!run.afterExit.active && run.afterExit.hidden && !run.afterExit.ui && !run.afterExit.ndDebug && !run.afterExit.nightClass,
    'exit tears the journey down completely ' + JSON.stringify(run.afterExit));
  assert(run.backHome, 'exit returns to the Nexus home screen');
  assert(run.relaunched && run.restored.speed === 'fast' && run.restored.palette === 'aurora' && run.restored.world === 'cosmic',
    'the next journey remembers the settings ' + JSON.stringify(run.restored));
  assert(run.party.open && run.party.state === true, 'Party Mode still opens and runs');
  assert(run.liquid, 'Liquid Dreams still opens');
  console.log('Night Drive: Celestial Rings and Cosmic Highway verified in pixels (planet, rings, highway, movement, music, tiers), and launched, driven, adjusted, exited and re-entered in the real app page with Party Mode and Liquid Dreams unaffected.');
})().catch(e => { console.error(e); process.exit(1); });
