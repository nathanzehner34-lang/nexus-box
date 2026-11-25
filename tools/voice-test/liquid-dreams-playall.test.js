const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// Liquid Dreams: Visual Play All, Colour Play All, permanent music reactivity and removal of the
// Music Reactive colour option. Runs the real experiences.js in a real browser on simulated time.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const xp = fs.readFileSync(path.join(assets, 'experiences.js'), 'utf8');
const ld = xp.slice(xp.indexOf('  function liquidDreams() {'), xp.indexOf('    loop(draw, 30);\n  }\n', xp.indexOf('  function liquidDreams() {')));
assert(!ld.includes('data-color="music"') && !ld.includes("['music']"), 'the Music Reactive colour option is gone');
assert(xp.includes('var LD_VISUAL_PLAY_SECS = [10, 30, 60], LD_COLOR_PLAY_SECS = [10, 20, 30];'), 'Play All intervals are 10s/30s/1min and 10s/20s/30s');
assert(/audio: \[\.3, 2\]/.test(xp) && ld.includes('Math.max(LD_RANGES.audio[0], state.audio)'), 'audio sensitivity can be tuned but never switched off');
assert(!/setInterval\([^)]*runPlayAll|setTimeout\([^)]*runPlayAll/.test(ld) && ld.includes('runPlayAll(now);'), 'Play All runs on the render-loop clock, with no separate timers to leak');
for (const k of ['beatTracker({ quiet: true })', 'b.tick(now)', 'sBass = ease(', 'sMid = ease(', 'sHigh = ease(', 'sEnergy = ease(', "dream.f('bassL', bassL)", "dream.f('midL', midL)", "dream.f('highL', highL)", "dream.f('energyL', energyL)"]) assert(ld.includes(k), 'audio analysis retained: ' + k);

const browser = process.env.LIQUID_DREAMS_BROWSER || ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(f => fs.existsSync(f));
assert(browser, 'Edge or Chrome is required');
const fileUrl = file => 'file:///' + file.replace(/\\/g, '/').replace(/^\//, '');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-playall-'));
function runPage(name, html) {
  const htmlPath = path.join(temp, name + '.html'); fs.writeFileSync(htmlPath, html);
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--allow-file-access-from-files', '--disable-extensions', '--window-size=320,180', '--virtual-time-budget=2400000', '--user-data-dir=' + path.join(temp, 'p-' + name), '--dump-dom', fileUrl(htmlPath)];
  let run;
  for (let a = 1; a <= 3; a++) { run = cp.spawnSync(browser, args.map(x => x.startsWith('--user-data-dir=') ? x + '-' + a : x), { encoding: 'utf8', timeout: 420000, maxBuffer: 32 * 1024 * 1024 }); if (!(run.error && run.error.code === 'ETIMEDOUT')) break; }
  if (run.error) throw run.error;
  const m = run.stdout.match(/RESULT=([\s\S]*?)<\/pre>/);
  if (!m) throw new Error((run.stdout.match(/ERROR=([\s\S]*?)<\/pre>/) || [])[1] || name + ': no result ' + run.stderr.slice(-400));
  return JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}
const ENVS = ['deepflow', 'iridescence', 'ether', 'chrome', 'cosmic', 'organic', 'world', 'bloom'];
const SHIFT = ['electric', 'pink', 'rainbow', 'ultraviolet', 'flowing', 'neon', 'midnight', 'deepteal', 'violet', 'chrome', 'iridescent', 'aurora', 'obsidian', 'arctic'];
function page(mem) {
  const oldSettings = JSON.stringify({ v: 3, env: 'ether', color: 'music', speed: 1.2, audio: 0, bass: 1 });
  const oldPresets = JSON.stringify([{ name: 'Old mood look', settings: { v: 3, env: 'cosmic', color: 'music', speed: .8 } }, { name: 'Violet night', settings: { v: 3, env: 'organic', color: 'violet' } }]);
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${fileUrl(path.join(assets, 'style.css'))}"><style>html,body{margin:0;width:320px;height:180px;overflow:hidden;background:#000}#xp{position:absolute;inset:0}#xpc{position:absolute;inset:0;width:100%;height:100%}#result{position:absolute;left:-9999px}</style>
<div id="xp" class="hidden"><canvas id="xpc"></canvas><div id="xpTop"></div><div id="xpMid"></div><div id="xpBottom"></div><button id="xpClose"></button></div><pre id="result">WAITING</pre><script>
window.__errors=[];window.addEventListener('error',e=>window.__errors.push(String(e.message||e.error)));
window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),100);window.cancelAnimationFrame=id=>clearTimeout(id);
Object.defineProperty(navigator,'deviceMemory',{configurable:true,get:()=>${mem}});
const store={'p_liquidDreams.settings':${JSON.stringify(oldSettings)},'p_liquidDreams.presets':${JSON.stringify(oldPresets)}};
window.BEAT={live:Date.now(),e:.5,k:.6,mid:.5,high:.5,bass:.5,level:.5,kicks:0,tick(){this.live=Date.now();if(Math.random()<.25)this.kicks++;}};
window.Nexus={speaking:false,_img(){}};window.__media=[];
window.__audio={meterOn:0,meterOff:0,stopTalking:0};window.NX={A:{setPref:(k,v)=>{store['p_'+k]=v;},meter(on){if(on)window.__audio.meterOn++;else window.__audio.meterOff++;},isMusicActive:()=>true,nowPlaying:()=>JSON.stringify({playing:true,title:'Song',artist:'Artist'}),media:c=>__media.push(c),deviceMemoryGb:()=>${mem}},$:id=>document.getElementById(id),pref:k=>store['p_'+k]||'',stopTalking(){window.__audio.stopTalking++;}};
</script><script src="${fileUrl(path.join(assets, 'experiences.js'))}"></script><script>
(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms)),S=()=>JSON.parse(store['p_liquidDreams.settings']),P=()=>JSON.parse(store['p_liquidDreams.playAll']||'null'),D=()=>XP.liquidDebug();
 const R={};let ui;
 async function open(){XP.open('liquiddreams');await wait(400);ui=document.querySelector('.ld-ui');}
 const click=sel=>ui.querySelector(sel).click();
 // record every change of a setting with its time
 async function watch(key,ms){const out=[];let last=S()[key];const t0=performance.now();while(performance.now()-t0<ms){await wait(100);const v=S()[key];if(v!==last){out.push({v,t:performance.now()});last=v;}}return out;}
 const gaps=a=>a.slice(1).map((x,i)=>Math.round((x.t-a[i].t)/100)/10);
 await open();
 // migration and the colour list
 R.migrated=S().color;R.musicButton=!!ui.querySelector('[data-color="music"]');R.colorButtons=ui.querySelectorAll('[data-color]').length;
 R.colorLabels=[...ui.querySelectorAll('[data-color]')].map(b=>b.textContent);
 R.presetNames=JSON.parse(store['p_liquidDreams.presets']).map(p=>p.name);
 click('[data-load="0"]');R.oldLook={env:S().env,color:S().color};click('[data-load="1"]');R.violetLook={env:S().env,color:S().color};
 R.audioFloor=S().audio;
 // ---- permanent music reactivity: every experience, every kind of palette, sensitivity at its minimum
 R.react=[];const audio0=Object.assign({},window.__audio);
 for(const env of ${JSON.stringify(ENVS)}){for(const col of ['signature','obsidian','rainbow']){click('[data-env="'+env+'"]');click('[data-color="'+col+'"]');await wait(1500);const d=D();R.react.push({env,col,bass:d.react.bass,mid:d.react.mid,high:d.react.high,energy:d.react.energy,beat:d.audio.beat});}}
 const sens=ui.querySelector('[data-setting="audio"]');R.sensMin=+sens.min;sens.value=sens.min;sens.dispatchEvent(new Event('change',{bubbles:true}));await wait(1500);R.reactAtMin=D().react;
 window.BEAT.e=.02;window.BEAT.k=0;window.BEAT.mid=0;window.BEAT.high=0;window.BEAT.bass=0;window.BEAT.level=.02;await wait(3000);R.reactQuiet=D().react;window.BEAT.e=.9;window.BEAT.k=.9;window.BEAT.mid=.8;window.BEAT.high=.8;window.BEAT.bass=.9;window.BEAT.level=.9;await wait(2500);R.reactLoud=D().react;
 window.BEAT.e=.5;window.BEAT.k=.6;window.BEAT.mid=.5;window.BEAT.high=.5;window.BEAT.bass=.5;window.BEAT.level=.5;
 click('[data-env="deepflow"]');click('[data-color="neon"]');
 // ---- Visual Play All: each interval, all eight in order, palette untouched
 R.visual={};
 click('[data-play="visual"]');
 for(const secs of [10,30,60]){click('[data-play-secs="visual:'+secs+'"]');const col=S().color;const steps=secs===10?9:3;const ch=await watch('env',secs*1000*steps+500);
  R.visual[secs]={seq:ch.map(c=>c.v),gaps:gaps(ch),colorKept:S().color===col,stored:P().visual.secs,colorSecs:P().color.secs};}
 click('[data-play="visual"]');R.visualOff=(await watch('env',25000)).length;
 // ---- Colour Play All: each interval, every palette in order, experience untouched
 R.color={};click('[data-play="color"]');
 for(const secs of [10,20,30]){click('[data-play-secs="color:'+secs+'"]');const env=S().env;const steps=secs===10?15:3;const ch=await watch('color',secs*1000*steps+500);
  R.color[secs]={seq:ch.map(c=>c.v),gaps:gaps(ch),envKept:S().env===env,stored:P().color.secs,visualSecs:P().visual.secs};}
 // ---- both at once, independently
 click('[data-play="visual"]');click('[data-play-secs="visual:30"]');click('[data-play-secs="color:10"]');
 const t0=performance.now();let envCh=0,colCh=0,le=S().env,lc=S().color;
 while(performance.now()-t0<60500){await wait(100);if(S().env!==le){envCh++;le=S().env;}if(S().color!==lc){colCh++;lc=S().color;}}
 R.both={envCh,colCh,play:P()};
 click('[data-play-secs="color:30"]');R.afterColorChange=P();
 // manual selection still works while Play All runs
 click('[data-env="cosmic"]');click('[data-color="aurora"]');R.manual={env:S().env,color:S().color};
 R.audioDuring={meterOff:window.__audio.meterOff-audio0.meterOff,stopTalking:window.__audio.stopTalking-audio0.stopTalking,media:__media.length};
 // ---- leaving stops everything; reopening restores the saved Play All settings
 const beforeClose=P();XP.close();await wait(200);R.closed={debug:typeof XP.liquidDebug,ui:!!document.querySelector('.ld-ui')};
 const sClosed=store['p_liquidDreams.settings'];await wait(70000);R.changedWhileClosed=store['p_liquidDreams.settings']!==sClosed;
 await open();R.reopen={play:D().play,uiVisual:ui.querySelector('[data-play="visual"]').getAttribute('aria-pressed'),uiColor:ui.querySelector('[data-play="color"]').getAttribute('aria-pressed'),
   visSel:ui.querySelector('[data-play-secs^="visual:"].selected').dataset.playSecs,colSel:ui.querySelector('[data-play-secs^="color:"].selected').dataset.playSecs,saved:beforeClose};
 // reopen and close quickly several times: no duplicate cycling
 for(let i=0;i<4;i++){XP.close();await wait(50);await open();}
 const dup=await watch('color',30500);R.afterReopen=dup.length;
 R.frames=D().frames;R.gpu=D().gpu;
 XP.close();await wait(200);
 R.errors=window.__errors;document.getElementById('result').textContent='RESULT='+JSON.stringify(R);
})().catch(e=>document.getElementById('result').textContent='ERROR='+String(e.stack||e));
</script>`;
}
for (const mem of [2, 8]) {
  const r = runPage('mem' + mem, page(mem)), tag = ' [' + mem + ' GB]';
  assert.deepStrictEqual(r.errors, [], 'no page errors' + tag);
  assert.strictEqual(r.migrated, 'electric', 'saved settings using Music Reactive move to an ordinary palette' + tag);
  assert(!r.musicButton && r.colorButtons === 15 && !r.colorLabels.some(l => /music/i.test(l)) && r.colorLabels.includes('Signature'), 'Music Reactive option removed; Signature and all palettes kept' + tag);
  assert.deepStrictEqual(r.presetNames, ['Old mood look', 'Violet night'], 'saved looks are kept' + tag);
  assert.deepStrictEqual(r.oldLook, { env: 'cosmic', color: 'electric' }, 'a saved look that used Music Reactive still loads' + tag);
  assert.deepStrictEqual(r.violetLook, { env: 'organic', color: 'violet' }, 'ordinary saved looks load unchanged' + tag);
  assert(r.audioFloor >= .3, 'a saved sensitivity of zero is raised so music always reacts' + tag);
  assert.strictEqual(r.react.length, ENVS.length * 3);
  r.react.forEach(x => assert(x.bass > .05 && x.mid > .05 && x.high > .05 && x.energy > .05, 'music drives bass, mid, treble and energy in ' + x.env + ' / ' + x.col + tag + ' ' + JSON.stringify(x)));
  assert(r.react.some(x => x.beat > .05), 'beat detection produces visual impacts' + tag);
  assert(r.sensMin >= .3 && r.reactAtMin.bass > .02 && r.reactAtMin.mid > .02, 'reactivity stays on at the lowest sensitivity' + tag);
  assert(r.reactLoud.energy > r.reactQuiet.energy * 2 && r.reactLoud.bass > r.reactQuiet.bass, 'loud passages react more strongly than quiet ones' + tag);
  for (const secs of [10, 30, 60]) {
    const v = r.visual[secs];
    assert(v.seq.length >= (secs === 10 ? 8 : 2), 'Visual Play All ' + secs + 's advances' + tag + ' ' + JSON.stringify(v));
    v.seq.forEach((e, i) => { if (i) assert.strictEqual(ENVS.indexOf(e), (ENVS.indexOf(v.seq[i - 1]) + 1) % ENVS.length, 'Visual Play All goes in order without skipping' + tag); });
    if (secs === 10) assert.strictEqual(new Set(v.seq).size, 8, 'Visual Play All visits all eight experiences' + tag);
    v.gaps.forEach(g => assert(Math.abs(g - secs) <= 1, 'Visual Play All ' + secs + 's interval holds (' + g + 's)' + tag));
    assert(v.colorKept && v.stored === secs && v.colorSecs === 20, 'Visual Play All keeps the palette and its own interval' + tag);
  }
  assert.strictEqual(r.visualOff, 0, 'Visual Play All stops when switched off' + tag);
  for (const secs of [10, 20, 30]) {
    const c = r.color[secs];
    assert(c.seq.length >= (secs === 10 ? 14 : 2), 'Colour Play All ' + secs + 's advances' + tag + ' ' + JSON.stringify(c));
    c.seq.forEach((e, i) => { if (i) assert.strictEqual(SHIFT.indexOf(e), (SHIFT.indexOf(c.seq[i - 1]) + 1) % SHIFT.length, 'Colour Play All goes in order without skipping' + tag); });
    if (secs === 10) assert.strictEqual(new Set(c.seq).size, 14, 'Colour Play All visits every palette' + tag);
    c.gaps.forEach(g => assert(Math.abs(g - secs) <= 1, 'Colour Play All ' + secs + 's interval holds (' + g + 's)' + tag));
    assert(c.envKept && c.stored === secs && c.visualSecs === 60, 'Colour Play All keeps the experience and its own interval' + tag);
  }
  assert(r.both.envCh >= 1 && r.both.envCh <= 2 && r.both.colCh >= 5 && r.both.colCh <= 6, 'both run together at their own pace' + tag + ' ' + JSON.stringify(r.both));
  assert(r.both.play.visual.on && r.both.play.color.on && r.both.play.visual.secs === 30 && r.both.play.color.secs === 10, 'both stay on with separate intervals' + tag);
  assert(r.afterColorChange.visual.secs === 30 && r.afterColorChange.color.secs === 30, 'changing one interval never alters the other' + tag);
  assert.deepStrictEqual(r.manual, { env: 'cosmic', color: 'aurora' }, 'manual choices still work during Play All' + tag);
  assert.deepStrictEqual(r.audioDuring, { meterOff: 0, stopTalking: 0, media: 0 }, 'cycling never interrupts audio or playback' + tag);
  assert(r.closed.debug === 'undefined' && !r.closed.ui && !r.changedWhileClosed, 'leaving Liquid Dreams stops its cycling and cleans up' + tag);
  assert(r.reopen.play.visual.on && r.reopen.play.color.on && r.reopen.play.visual.secs === 30 && r.reopen.play.color.secs === 30 && r.reopen.uiVisual === 'true' && r.reopen.uiColor === 'true' && r.reopen.visSel === 'visual:30' && r.reopen.colSel === 'color:30', 'Play All settings survive closing and reopening' + tag);
  assert.strictEqual(r.afterReopen, 1, 'repeated reopening never duplicates cycling (one change in 30 s)' + tag);
  assert(r.frames > 20 && r.gpu, 'rendering continues normally' + tag);
}
console.log('Liquid Dreams: Visual Play All (10s/30s/1min) and Colour Play All (10s/20s/30s) cycle in order, independently and together; music reactivity is on in all eight experiences with every palette; Music Reactive option removed with saved settings and looks migrated; settings persist; exit and reopen leave no running timers (2 GB and 8 GB profiles).');
