const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// Live environment engine, legacy removal and design-system checks.
// 1) static checks that Alter Ego and the old wallpaper system are fully gone;
// 2) real WebGL renders of all five worlds (motion, distinct structure, controls, restraint);
// 3) the real Nexus page in a browser (2 GB profile): engine running, selector previews,
//    controls persisting, pausing under Party Mode and visuals, old layouts migrating.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const read = f => fs.readFileSync(path.join(assets, f), 'utf8');
const app = read('app.js'), html = read('index.html'), css = read('style.css'), env = read('env.js'), xp = read('experiences.js');
const java = fs.readFileSync(path.join(root, 'app/src/main/java/com/nexus/box/MainActivity.java'), 'utf8');

// ---- 1. legacy removal ----
const files = fs.readdirSync(assets);
assert(!files.some(f => /^bg_.*\.jpg$/.test(f)), 'no legacy static wallpaper or Alter Ego background images remain');
assert(!files.includes('personas.js') && !files.includes('personas.json'), 'Alter Ego persona scripts and canned phrase data are removed');
assert(!/data-act="ego"|data-act="bgs"|personas\.js|id="photo"/.test(html), 'no Alter Ego or Backgrounds tile, persona script or static photo layer in the page');
for (const gone of ['EGOS', 'EGO_LINES', 'egoLine', 'openEgo', 'setEgo', 'EGO_BGS', 'BGS', 'applyBackground', 'openBackgrounds', 'homeStyle', 'vault', 'egoName', 'skipQuip', 'RIB'])
  assert(!new RegExp('\\b' + gone + '\\b').test(app), gone + ' is removed from the app');
assert(!/speakAs|PERSONA_VOICES|applyPersonaVoice/.test(java), 'the persona-only Android voice integration is removed');
assert(!/egoTitle|sayEgo/.test(xp) && xp.includes("N.sayVoiceLine('holo', true)"), 'experiences use the plain Nexus voice line');
assert(!/egocard|bgcell|style-gold|body\.photo|--ego/.test(css), 'Alter Ego, wallpaper and old button-style CSS is removed');
assert(app.includes("filter(function (k) { return k !== 'ego'; }).map(function (k) { return k === 'bgs' ? 'env' : k; })"), 'saved home layouts drop Alter Ego and turn Backgrounds into Environments');
assert(app.includes("case 'env': openEnvironments(); break;") && html.includes('data-act="env"') && html.includes('<script src="env.js"></script>'), 'Environments is wired to the home screen and the engine is loaded');
assert(!app.includes('data-envsw="audio"') && !app.includes("group('sound', 'Music response'") && env.includes('function music() { return null; }'),
  'the home-screen backgrounds have no music setting and never follow the music');
assert(app.includes('Show a "‹ NEXUS" button over Spotify') && java.includes('private void showExitBubble()') && java.includes('hideExitBubble();') && fs.readFileSync(path.join(root, 'app/src/main/AndroidManifest.xml'), 'utf8').includes('SYSTEM_ALERT_WINDOW'),
  'Spotify gets a floating back-to-Nexus button that Settings can allow and switch off');
// ---- design system ----
for (const token of ['--nx-glass', '--nx-line', '--nx-r', '--fs-title', '--fs-label', '--nx-gap', '--nx-icon', '--nx-fast', '--nx-ease']) assert(css.includes(token + ':'), token + ' design token is defined');
for (const comp of ['.tile:active', '.tile.active::before', '.btn.go', '.btn.off', '.sw.on .sw-track', '.range output', '.chip-btn.selected', '.seg-btn.selected', '.env-card.selected .env-check', ':focus-visible', '#panelBox', '.group summary'])
  assert(css.includes(comp), comp + ' component state is styled');
assert(app.includes('function switchHtml(') && app.includes('role="switch"') && app.includes("return switchHtml('data-toggle=\"' + o[0] + '\"'"), 'settings toggles render as real switches');
assert(app.includes('function rangeHtml(') && app.includes("output[for=\"' + el.id + '\"]"), 'sliders show their live value');
assert((html.match(/<svg viewBox="0 0 24 24">/g) || []).length >= 16, 'home tiles use the consistent line icon set');

// ---- 2. real WebGL renders of the five worlds ----
const common = JSON.parse(env.match(/var COMMON = ("(?:[^"\\]|\\.)*");/)[1]);
const envSrc = {}; for (const id of ['AURORA', 'NEON', 'NEBULA', 'INFINITY', 'LIQUID']) {
  const m = env.match(new RegExp("id: '" + id.toLowerCase() + "'[^\\n]*src: (\"(?:[^\"\\\\]|\\\\.)*\")"));
  assert(m, id + ' shader source present'); envSrc[id.toLowerCase()] = JSON.parse(m[1]);
}
const ids = Object.keys(envSrc);
const browser = process.env.LIQUID_DREAMS_BROWSER || ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(f => fs.existsSync(f));
assert(browser, 'Edge or Chrome is required for the render checks');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-env-'));
const url = f => 'file:///' + f.replace(/\\/g, '/').replace(/^\//, '');
function run(name, page, marker, budget, dir) {
  const p = path.join(dir || temp, name + '.html'); fs.writeFileSync(p, page);
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--allow-file-access-from-files', '--disable-extensions', '--window-size=1280,720', '--user-data-dir=' + path.join(temp, 'profile-' + name)];
  if (budget) args.push('--virtual-time-budget=' + budget);
  args.push('--dump-dom', url(p));
  const r = cp.spawnSync(browser, args, { encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (r.error) throw r.error;
  const m = r.stdout.match(new RegExp(marker + '=([\\s\\S]*?)</pre>'));
  if (!m) throw new Error((r.stdout.match(/ERROR=([\s\S]*?)<\/pre>/) || [])[1] || name + ' returned nothing: ' + r.stderr.slice(-600));
  return JSON.parse(m[1]);
}
const grey = [[.06, .06, .08], [.5, .5, .55], [.8, .8, .85]];
const shaderPage = `<!doctype html><body><pre id="out">WAIT</pre><canvas id="c" width="160" height="90"></canvas><script>
try{const gl=document.getElementById('c').getContext('webgl',{preserveDrawingBuffer:true});if(!gl)throw new Error('no WebGL');
const SRC=${JSON.stringify(envSrc)},COMMON=${JSON.stringify(common)},IDS=${JSON.stringify(ids)},GREY=${JSON.stringify(grey)};
function sh(t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o;}
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const P={},px=new Uint8Array(160*90*4);
function prog(id){if(P[id])return P[id];const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,COMMON+SRC[id]));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(id+' link');return P[id]=p;}
function render(id,o){const p=prog(id);gl.useProgram(p);const l=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
 const u=Object.assign({res:[160,90],T:40,bass:0,mid:0,high:0,move:1,bright:1,detail:1,quality:0,c1:GREY[0],c2:GREY[1],c3:GREY[2],tint:[1,1,1]},o);
 for(const[k,v]of Object.entries(u)){const L=gl.getUniformLocation(p,k);if(L===null)continue;if(!Array.isArray(v))gl.uniform1f(L,v);else if(v.length===2)gl.uniform2f(L,v[0],v[1]);else gl.uniform3f(L,v[0],v[1],v[2]);}
 gl.viewport(0,0,160,90);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,160,90,gl.RGBA,gl.UNSIGNED_BYTE,px);
 const lum=new Float32Array(160*90);let s=0,q=0;for(let i=0,j=0;i<px.length;i+=4,j++){const v=px[i]*.299+px[i+1]*.587+px[i+2]*.114;lum[j]=v;s+=v;q+=v*v;}const m=s/lum.length;return{lum,mean:m,std:Math.sqrt(Math.max(0,q/lum.length-m*m))};}
function diff(a,b){let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);return d/a.length;}
function corr(a,b){let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i];}ma/=a.length;mb/=b.length;let s=0,sa=0,sb=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;s+=x*y;sa+=x*x;sb+=y*y;}return s/Math.sqrt(sa*sb+1e-9);}
const out={};const base={};
for(const id of IDS){const a=render(id,{}),near=render(id,{T:40.05}),later=render(id,{T:52}),hq=render(id,{quality:1});base[id]=a.lum;

 out[id]={mean:a.mean,std:a.std,frameStep:diff(a.lum,near.lum),motion:diff(a.lum,later.lum),hq:diff(a.lum,hq.lum),
  bright:diff(a.lum,render(id,{bright:1.4}).lum),move:diff(a.lum,render(id,{move:2}).lum),
  audio:diff(a.lum,render(id,{bass:1,mid:1,high:1}).lum),loudMean:render(id,{bass:1,mid:1,high:1}).mean,
  colour:diff(a.lum,render(id,{c1:[.05,.02,.12],c2:[.2,.8,1],c3:[1,.3,.7]}).lum)};}
let maxCorr=-1;for(let i=0;i<IDS.length;i++)for(let j=i+1;j<IDS.length;j++)maxCorr=Math.max(maxCorr,corr(base[IDS[i]],base[IDS[j]]));
document.getElementById('out').textContent='SHADER='+JSON.stringify({out,maxCorr});}catch(e){document.getElementById('out').textContent='ERROR='+String(e.stack||e);}
</script>`;

// ---- 3. the real app page ----
const appDir = path.join(temp, 'app'); fs.mkdirSync(appDir);
for (const f of fs.readdirSync(assets)) fs.cpSync(path.join(assets, f), path.join(appDir, f), { recursive: true });
function appPage(setup, scenario) {
  let h = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
  h = h.replace('<head>', '<head><script>window.__errors=[];addEventListener("error",e=>__errors.push(String(e.message)));Object.defineProperty(navigator,"deviceMemory",{get:()=>2});localStorage.clear();' + setup + '</script>');
  h = h.replace('</body>', '<pre id="out">WAIT</pre><script>window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),20);window.cancelAnimationFrame=id=>clearTimeout(id);' +
    'setTimeout(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));try{' + scenario + '}catch(e){document.getElementById("out").textContent="ERROR="+String(e.stack||e)+" errors:"+JSON.stringify(window.__errors);}},700);</script></body>');
  return h;
}
const scenario = `
 const r={};await wait(600);const E=NexusEnv,s0=E.status();r.start={active:s0.active,running:s0.running,gl:s0.gl,env:s0.env,quality:s0.quality};
 r.tiles=[...document.querySelectorAll('#tiles .tile')].map(t=>t.dataset.act);
 document.querySelector('[data-act=env]').click();await wait(900);
 r.cards=document.querySelectorAll('.env-card').length;
 r.previews=[...document.querySelectorAll('[data-preview]')].map(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let lit=0;for(let i=0;i<d.length;i+=16)if(d[i]+d[i+1]+d[i+2]>30)lit++;return lit;});
 document.querySelector('[data-env=neon]').click();await wait(80);r.afterSelect=E.status();
 document.querySelector('[data-envsw=reducedMotion]').click();document.querySelector('[data-quality=balanced]').click();document.querySelector('[data-pal="2"]').click();
 const sp=document.getElementById('envSpeed');sp.value='1.6';sp.dispatchEvent(new Event('input',{bubbles:true}));
 r.speedLabel=document.querySelector('output[for=envSpeed]').textContent;
 r.saved=JSON.parse(localStorage.getItem('p_envSettings'));
 r.switchOn=document.querySelector('[data-envsw=reducedMotion]').getAttribute('aria-checked');
 document.getElementById('panelClose').click();await wait(3500);r.programsAfterClose=E.status().programs;
 Nexus.openExperience('clip_coins');await wait(1500);r.underVisual=E.status().running;
 XP.close();await wait(700);r.afterVisual=E.status().running;
 document.querySelector('[data-act=party]').click();await wait(700);r.underParty=E.status().running;
 document.querySelector('[data-act=party]')&&window.Nexus.home();await wait(700);r.afterParty=E.status().running;
 document.querySelector('[data-act=settings]').click();await wait(200);
 r.settingsSwitches=document.querySelectorAll('#panelBody .sw[role=switch]').length;r.settingsEnvButton=!!document.getElementById('sEnv');
 r.noBackgroundField=!/>BACKGROUND</.test(document.getElementById('panelBody').innerHTML);
 r.errors=__errors;document.getElementById('out').textContent='APP='+JSON.stringify(r);`;
const restartScenario = `await wait(500);document.getElementById('out').textContent='RESTART='+JSON.stringify({status:NexusEnv.status(),settings:NexusEnv.settings(),tiles:[...document.querySelectorAll('#tiles .tile')].map(t=>t.dataset.act),errors:__errors});`;

try {
  const R = run('shaders', shaderPage, 'SHADER');
  for (const id of ids) {
    const o = R.out[id];
    assert(o.mean > 6 && o.std > 6, id + ' renders a visible, structured scene with no music (mean ' + o.mean.toFixed(1) + ', contrast ' + o.std.toFixed(1) + ')');
    assert(o.frameStep > .05 && o.frameStep < 4, id + ' moves continuously and smoothly between frames (' + o.frameStep.toFixed(2) + ')');
    assert(o.motion > 4, id + ' main structures evolve over time, not only particles (' + o.motion.toFixed(1) + ')');
    for (const k of ['bright', 'move', 'colour', 'hq']) assert(o[k] > .3, id + ' responds to ' + k + ' (' + o[k].toFixed(2) + ')');
    assert(Math.abs(o.loudMean - o.mean) / o.mean < .3, id + ' music response never causes an aggressive full-screen brightness change');
  }
  assert(R.maxCorr < .75, 'the five worlds differ in composition, not just colour: rendered with one neutral palette, max structural correlation ' + R.maxCorr.toFixed(2));

  const A = run('app', appPage(`localStorage.setItem('p_homeVer','5');localStorage.setItem('p_homeTiles','youtube,ego,bgs,party,settings');`, scenario), 'APP', 30000, appDir);
  assert.deepStrictEqual(A.errors, [], 'the Nexus page raised no errors');
  assert(A.start.active && A.start.gl && A.start.quality === 'smooth', 'the engine runs on the GPU in Smooth quality on a 2 GB box');
  assert.deepStrictEqual(A.tiles, ['youtube', 'env', 'cinema', 'party', 'settings'], 'an old custom layout loses Alter Ego, gains Environments in place of Backgrounds, and gains Cinema beside Party Mode');
  assert.strictEqual(A.cards, 5, 'five environment cards');
  assert(A.previews.every(n => n > 20), 'every card shows a live rendered preview of its world');
  assert(A.afterSelect.env === 'neon' && A.afterSelect.transitioning, 'selecting a world starts a dissolve transition from the current one');
  assert(A.saved.env === 'neon' && A.saved.reducedMotion === true && A.saved.quality === 'balanced' && A.saved.palettes.neon === 2 && A.saved.speed === 1.6, 'world, reduced motion, quality, palette and speed persist');
  assert.strictEqual(A.speedLabel, '160%', 'sliders show their value');
  assert.strictEqual(A.switchOn, 'true', 'switch state is exposed, not colour-only');
  assert(A.programsAfterClose <= 1, 'closing the selector releases the other worlds');
  assert(!A.underVisual && A.afterVisual, 'the environment pauses under a visual and resumes after');
  assert(!A.underParty && A.afterParty, 'the environment pauses under Party Mode and resumes after');
  assert(A.settingsSwitches >= 4 && A.settingsEnvButton && A.noBackgroundField, 'Settings uses switches, links to Environments and has no old background picker');

  const B = run('restart', appPage(`localStorage.setItem('p_envSettings',JSON.stringify({env:'energy',palettes:{energy:1},speed:.5,audio:false,cycle:5}));localStorage.setItem('p_homeVer','6');`, restartScenario), 'RESTART', 15000, appDir);
  assert.deepStrictEqual(B.errors, [], 'no errors after restart');
  assert(B.status.env === 'neon' && B.settings.speed === .5 && B.settings.audio === false && B.settings.cycle === 5, 'settings are restored after restarting the app, and a retired world opens its successor (' + B.status.env + ')');
  assert(!B.tiles.includes('ego') && B.tiles.includes('env'), 'default layout has Environments and no Alter Ego');
  const L = run('legacy', appPage(`localStorage.setItem('p_envSettings',JSON.stringify({env:'cosmic',palettes:{cosmic:2}}));localStorage.setItem('p_homeVer','6');`, restartScenario), 'RESTART', 15000, appDir);
  assert(L.status.env === 'nebula' && L.settings.palettes.nebula === 0 && L.status.running, 'a world saved by an earlier build (Cosmic) opens its successor, Cosmic Nebula');
  console.log('Live environments: legacy Alter Ego and wallpaper system removed; five worlds rendered with distinct structure (max correlation ' + R.maxCorr.toFixed(2) + '), continuous motion and working controls; the Nexus page ran the engine, previews, persistence, pausing and layout migration without errors.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
