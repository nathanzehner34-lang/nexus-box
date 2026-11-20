const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// Liquid Dreams: opens the real experience in a real browser WebGL context and plays five synthetic
// music scenarios through the same beat-analysis model production uses (window.BEAT, fed the way
// app.js's feedBeat() turns the Android meter's bands into energy/kick/mid/high), to check the whole
// experience audibly follows the music end to end, across environments and palettes, and that every
// existing control keeps working while it does.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const source = fs.readFileSync(path.join(assets, 'experiences.js'), 'utf8');

// ---------- Static integration ----------
assert(/var b = beatTracker\(\{ quiet: true \}\)/.test(source), 'Liquid Dreams uses the shared beat tracker');
assert(/Music reactivity is always on: sensitivity can be tuned but never switched off/.test(source), 'audio reactivity cannot be switched off');
['sBass', 'sMid', 'sHigh', 'sEnergy', 'beatHit', 'bassL', 'midL', 'highL', 'energyL'].forEach(v =>
  assert(new RegExp('\\b' + v + '\\b').test(source), 'draw loop computes ' + v));
assert(/dream\.f\('bassL', bassL\); dream\.f\('midL', midL\); dream\.f\('highL', highL\); dream\.f\('energyL', energyL\)/.test(source),
  'every frame\'s audio levels are sent to the shader');
['deepFlowLD', 'iridescenceLD', 'etherLD', 'chromeLD', 'cosmicLD', 'organicLD'].forEach(fn =>
  assert(new RegExp('vec3 ' + fn + '\\(').test(source), fn + ' is present'));
['bassL', 'midL', 'highL'].forEach(u => {
  const count = (source.match(new RegExp(u, 'g')) || []).length;
  assert(count > 10, u + ' is referenced broadly, not bolted onto a single environment (' + count + ' uses)');
});
// Existing controls and interactions must still be intact.
['data-action="next"', 'data-action="shift"', 'data-play="visual"', 'data-play="color"', 'data-action="touch"',
  'data-action="save"', 'data-action="lowmotion"', 'data-action="shuffle"', 'data-action="clean"', 'startGravity', 'addPulse', 'ld-slider'
].forEach(s => assert(source.includes(s), 'control preserved: ' + s));
assert(/function liquidDreams\(\)/.test(source), 'liquidDreams() experience function is present');

const browser = process.env.LIQUID_DREAMS_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser && fs.existsSync(browser), 'Edge or Chrome is required for the actual WebGL render check');
const fileUrl = file => 'file:///' + file.replace(/\\/g, '/').replace(/^\//, '');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'liquid-dreams-music-'));

// Real-time page run over the DevTools protocol (same pattern as energy-flow-music.test.js): software-GL
// frames do not advance headless virtual time, so scenarios play on the wall clock.
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

const bridge = `
window.__audio={meterOff:0,meterOn:0,stopTalking:0};
window.NX={A:{setPref:(k,v)=>{store['p_'+k]=v;},getPref:k=>store['p_'+k]||'',meter(on){if(on)window.__audio.meterOn++;else window.__audio.meterOff++;},
  isMusicActive:()=>true,nowPlaying:()=>JSON.stringify({playing:true,title:'Test Song',artist:'Test Artist'}),deviceMemoryGb:()=>2},
  $:id=>document.getElementById(id),pref:k=>store['p_'+k]||'',stopTalking(){window.__audio.stopTalking++;}};
Object.defineProperty(navigator,'deviceMemory',{configurable:true,get:()=>2});
// The exact beat-analysis model production uses (app.js's feedBeat), driving the same window.BEAT
// that beatTracker() reads, so the simulated music behaves like the real Android meter would.
window.BEAT = { avg: .02, bavg: .02, peak: .05, e: 0, k: 0, mid: 0, high: 0, bass: 0, level: 0, last: 0, kicks: 0, live: 0 };
window.BEAT.tick = function () { this.k *= .86; this.e *= .97; this.mid *= .9; this.high *= .9; this.bass *= .9; this.level *= .95; return Math.max(this.e, this.k); };
function feedBeat(all, bass, mid, high) {
  var B = window.BEAT, now = Date.now();
  B.avg = B.avg * .97 + all * .03; B.bavg = B.bavg * .94 + bass * .06; B.peak = Math.max(B.peak * .995, all);
  if (all > .004) B.live = now;
  var lvl = Math.min(1, Math.max(0, all / (B.peak * .9 + 1e-4)));
  B.e = Math.max(B.e * .8, lvl);
  B.mid = B.mid * .72 + (Number(mid) || 0) * .28; B.high = B.high * .72 + (Number(high) || 0) * .28;
  B.bass = B.bass * .7 + Math.min(1.4, (Number(bass) || 0) * 11) * .3;
  B.level = B.level * .82 + Math.min(1.4, (Number(all) || 0) * 11) * .18;
  if (bass > B.bavg * 1.3 && bass > .008 && now - B.last > 190) { B.last = now; B.kicks++; B.k = Math.min(1, Math.max(.65, (bass / (B.bavg + 1e-4) - 1) * 1.2)); }
}
function play(opts, ms) { return new Promise(res => { const t0 = performance.now();
  const iv = setInterval(() => { const t = (performance.now() - t0) / 1000;
    if (performance.now() - t0 > ms) { clearInterval(iv); res(); return; }
    const beat = opts.bpm ? 60 / opts.bpm : 0;
    const since = beat ? t - Math.floor(t / beat) * beat : 9;
    const kick = beat ? Math.exp(-since / 0.07) * opts.kick : 0;
    const ramp = opts.ramp ? Math.min(1, t / (ms / 1000)) : 0;
    const low = (opts.bed || 0) + kick + (opts.rampLow || 0) * ramp;
    const hat = beat && Math.abs(since - beat / 2) < 0.05 ? opts.hat || 0 : 0;
    const high = (opts.air || 0) + hat + (opts.rampHigh || 0) * ramp;
    const mid = (opts.mid || 0) + kick * .3 + (opts.rampMid || 0) * ramp;
    const all = low * .5 + mid * .3 + high * .2 + (opts.floor || 0);
    feedBeat(all, low, mid, high); }, 25); }); }
`;

const scenario = `
 const D = () => XP.liquidDebug(), L = d => document.getElementById('xp');
 document.getElementById('xpClose').addEventListener('click', () => XP.close());
 XP.open('liquiddreams'); await wait(500);
 const ui = document.querySelector('.ld-ui');
 R.start = { gl: D().gpu, frames: D().frames, firstFrame: D().firstFrame };
 R.f0 = D().frames;
 // 1. Slow atmospheric: a quiet pad, no percussion.
 await play({ bed: .006, mid: .012, air: .004, floor: .004 }, 5000);
 R.atmospheric = D().audio;
 await wait(300);
 // 2. Electronic: a steady 128 BPM four-to-the-floor with hats.
 await play({ bpm: 128, kick: .085, bed: .008, mid: .02, air: .006, hat: .03, floor: .006 }, 7000);
 R.electronic = D().audio; R.electronicKicks = window.BEAT.kicks;
 await wait(300);
 // 3. Heavy bass: loud, sustained low end.
 await play({ bpm: 92, kick: .16, bed: .05, mid: .03, air: .008, floor: .02 }, 6000);
 R.heavyBass = D().audio;
 // switch environment and palette mid-track: reactivity must survive the change.
 ui.querySelector('[data-action="next"]').click(); ui.querySelector('[data-action="shift"]').click();
 await play({ bpm: 92, kick: .16, bed: .05, mid: .03, air: .008, floor: .02 }, 2500);
 R.heavyBassAfterSwitch = D().audio; R.envAfterSwitch = D().env;
 await wait(300);
 // 4. Fast rhythmic: 172 BPM.
 await play({ bpm: 172, kick: .08, bed: .008, mid: .025, air: .01, hat: .025, floor: .006 }, 6000);
 R.fast = D().audio; R.fastKicks = window.BEAT.kicks;
 await wait(400);
 // 5. Dramatic drop: a riser with no kick, then the drop lands.
 await play({ bed: .004, mid: .02, air: .01, floor: .005, ramp: 1, rampLow: .004, rampMid: .05, rampHigh: .075 }, 4000);
 R.beforeDrop = D().audio;
 await play({ bpm: 120, kick: .22, bed: .06, mid: .05, air: .03, floor: .03 }, 2000);
 R.afterDrop = D().audio;
 const drop = document.getElementById('xpDrop'); R.dropFlashOpacity = drop ? Number(drop.style.opacity || 0) : 0;
 await wait(300);
 // Silence: the analysis must settle rather than hold the last loud reading.
 await wait(3500); R.silent = D().audio;
 R.framesAfter = D().frames;
 // Touch interaction still works while/after music has been playing.
 const Rc = L().getBoundingClientRect(), ev = (t, x, y) => L().dispatchEvent(new PointerEvent(t, { clientX: Rc.left + x * Rc.width, clientY: Rc.top + y * Rc.height, pointerId: 11, bubbles: true, cancelable: true }));
 ev('pointerdown', .35, .4); await wait(60); ev('pointerup', .35, .4); await wait(120);
 R.pulseAfterMusic = D().pulses.length;
 ev('pointerdown', .6, .5); await wait(500); R.gravityAfterMusic = D().gravity.strength > .7;
 ev('pointerup', .6, .5);
 // Sliders, Play All and saved settings still function.
 const speed = ui.querySelector('[data-setting="speed"]'); speed.value = '1.6'; speed.dispatchEvent(new Event('change', { bubbles: true }));
 ui.querySelector('[data-play="visual"]').click();
 R.controlsAfterMusic = { speed: JSON.parse(store['p_liquidDreams.settings']).speed, playOn: JSON.parse(store['p_liquidDreams.playAll']).visual.on };
 ui.querySelector('[data-action="exit"]').click(); await wait(200);
 R.closed = !XP.active && !document.querySelector('.ld-ui');
 R.meterOff = window.__audio.meterOff; R.errors = window.__errors;
`;

const appPage = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${fileUrl(path.join(assets, 'style.css'))}"><style>html,body{margin:0;width:960px;height:540px;overflow:hidden;background:#000}#xp{position:absolute;inset:0}#xpc{position:absolute;inset:0;width:100%;height:100%}#result{position:absolute;left:-9999px}</style>
<div id="xp" class="hidden"><canvas id="xpc"></canvas><div id="xpTop"></div><div id="xpMid"></div><div id="xpBottom"></div><button id="xpClose"></button></div><pre id="__out">WAITING</pre><script>
window.__errors=[];window.addEventListener('error',e=>window.__errors.push(String(e.message||e.error)));
window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),18);window.cancelAnimationFrame=id=>clearTimeout(id);
const store={};
${bridge}
window.Nexus={speaking:false,_img(){}};
</script><script src="${fileUrl(path.join(assets, 'experiences.js'))}"></script><script>
(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));const out=document.getElementById('__out');const R={};
try{
${scenario}
out.textContent='RESULT='+JSON.stringify(R);
}catch(e){out.textContent='ERROR='+(e.stack||e);}
})();
</script>`;

(async () => {
  const app = await runLive('liquid-dreams-music', appPage, 150000, '640,360');
  assert.deepStrictEqual(app.errors, [], 'no page errors');
  assert(app.start.gl && app.start.frames > 0, 'Liquid Dreams opens and renders with the GPU path ' + JSON.stringify(app.start));

  // 1. Slow atmospheric.
  assert(app.atmospheric.bass < .2 && app.atmospheric.energy < .25, 'a quiet pad reads as calm (' + JSON.stringify(app.atmospheric) + ')');

  // 2. Electronic.
  assert(app.electronic.bass > app.atmospheric.bass * 2, 'steady four-to-the-floor registers clearly over the quiet pad (' + app.atmospheric.bass.toFixed(2) + ' -> ' + app.electronic.bass.toFixed(2) + ')');
  assert(app.electronicKicks >= 4, 'the beat tracker actually detects kicks in 128 BPM music (' + app.electronicKicks + ')');
  assert(app.electronic.energy > app.atmospheric.energy * 1.5, 'overall energy rises with the beat (' + app.atmospheric.energy.toFixed(2) + ' -> ' + app.electronic.energy.toFixed(2) + ')');

  // 3. Heavy bass.
  assert(app.heavyBass.bass > app.electronic.bass * .9, 'a loud sustained low end registers at least as strongly as the four-to-the-floor track (' + app.heavyBass.bass.toFixed(2) + ')');
  assert(app.envAfterSwitch !== undefined, 'switching environment mid-track does not error');
  assert(app.heavyBassAfterSwitch.bass > .15, 'reactivity survives an environment and palette switch mid-track (' + app.heavyBassAfterSwitch.bass.toFixed(2) + ')');

  // 4. Fast rhythmic.
  assert(app.fastKicks > app.electronicKicks, 'faster music produces more kicks in the same style of passage (' + app.electronicKicks + ' -> ' + app.fastKicks + ')');
  assert(app.fast.high > app.atmospheric.high * 1.5, 'hats and air lift the treble band (' + app.atmospheric.high.toFixed(2) + ' -> ' + app.fast.high.toFixed(2) + ')');

  // 5. Dramatic drop.
  assert(app.afterDrop.bass > app.beforeDrop.bass * 1.4 && app.afterDrop.energy > app.beforeDrop.energy,
    'the drop clearly jumps the audio levels (' + JSON.stringify(app.beforeDrop) + ' -> ' + JSON.stringify(app.afterDrop) + ')');
  assert.strictEqual(app.dropFlashOpacity, 0, 'a beat drop never flashes the screen in Liquid Dreams');

  // Silence.
  assert(app.silent.bass < .15 && app.silent.energy < .2, 'the analysis settles back down in silence rather than holding the last loud reading (' + JSON.stringify(app.silent) + ')');

  // Controls still work during and after music.
  assert.strictEqual(app.pulseAfterMusic, 1, 'Color Pulse still fires after music has been playing');
  assert(app.gravityAfterMusic, 'Gravity Point still builds under a held finger after music has been playing');
  assert.strictEqual(app.controlsAfterMusic.speed, 1.6, 'the speed slider still saves its value');
  assert.strictEqual(app.controlsAfterMusic.playOn, true, 'Visual Play All still toggles on');
  assert(app.framesAfter > app.f0, 'the GPU kept rendering frames throughout every scenario');
  assert(app.closed, 'Liquid Dreams exits cleanly after all of this');
  assert(app.meterOff >= 1, 'exiting releases the audio meter');

  console.log('Liquid Dreams: audio-reactive end to end in the real running experience across atmospheric, electronic, heavy bass, fast rhythmic and drop scenarios, through an environment/palette switch, with Color Pulse, Gravity Point, sliders and Play All all still working.');
})().catch(e => { console.error(e); process.exit(1); });
