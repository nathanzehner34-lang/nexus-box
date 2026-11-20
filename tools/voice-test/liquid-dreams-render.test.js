const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// Renders the real Liquid Dreams shader in a real browser WebGL context and measures pixels,
// then opens the real Liquid Dreams experience (2 GB profile) and operates its controls.
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const source = fs.readFileSync(path.join(assets, 'experiences.js'), 'utf8');
const shader = (source.match(/var LIQUID_DREAMS_SHADER = `([\s\S]*?)`;/) || [])[1];
const headExpression = (source.match(/var GL_HEAD = ([\s\S]*?)\n  function glStart/) || [])[1];
const paletteBlock = (source.match(/var LD_PALETTES = (\{[\s\S]*?\n  \});/) || [])[1];
assert(shader && headExpression && paletteBlock, 'actual Liquid Dreams shader, WebGL header and palettes are present');
const glHead = Function('return (' + headExpression.trim().replace(/;\s*$/, '') + ')')();
const palettes = Function('return (' + paletteBlock + ')')();
const browser = process.env.LIQUID_DREAMS_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser && fs.existsSync(browser), 'Edge or Chrome is required for the actual WebGL render check');
const fileUrl = file => 'file:///' + file.replace(/\\/g, '/').replace(/^\//, '');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'liquid-dreams-render-'));
function runPage(name, html, marker, budget) {
  const htmlPath = path.join(temp, name + '.html');
  fs.writeFileSync(htmlPath, html);
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--allow-file-access-from-files', '--disable-extensions', '--user-data-dir=' + path.join(temp, 'profile-' + name)];
  if (budget) args.push('--virtual-time-budget=' + budget);
  args.push('--dump-dom', fileUrl(htmlPath));
  // Headless Chrome occasionally stalls under virtual time; a stalled run is retried with a fresh profile.
  let run;
  for (let attempt = 1; attempt <= 3; attempt++) {
    run = cp.spawnSync(browser, args.map(x => x.startsWith('--user-data-dir=') ? x + '-' + attempt : x), { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (!(run.error && run.error.code === 'ETIMEDOUT')) break;
  }
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error('Browser exited ' + run.status + '\n' + run.stderr);
  const match = run.stdout.match(new RegExp(marker + '=([\\s\\S]*?)</pre>'));
  if (!match) throw new Error((run.stdout.match(/ERROR=([\s\S]*?)<\/pre>/) || [])[1] || name + ' page returned no result. ' + run.stderr.slice(-800));
  return JSON.parse(match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

const shaderPage = `<!doctype html><meta charset="utf-8"><body><pre id="result">WAITING</pre><canvas id="c" width="128" height="72"></canvas><script>
const output=document.getElementById('result');
try {
 const gl=document.getElementById('c').getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl) throw new Error('WebGL context unavailable');
 function compile(type,src){const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh));return sh;}
 const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,${JSON.stringify(glHead)}+${JSON.stringify(shader)}));gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const loc=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
 const PAL=${JSON.stringify(palettes)},bytes=new Uint8Array(128*72*4);
 const base={res:[128,72],envA:0,envB:0,envMix:0,flowT:21.3,bassL:.25,midL:.25,highL:.25,moveAmt:.6,detailAmt:.6,complexity:.5,brightness:1,quality:0,gravPos:[.15,0],gravStr:0,gravSpin:0,touchHue:0,spectral:0,colorPhase:.2,energyL:0,spectralO:0,colorWave:[0,0,0,0],palette:'deepteal'};
 function render(over){const u=Object.assign({},base,over),p=PAL[u.palette].c,o=PAL[u.oldPalette||u.palette].c;delete u.oldPalette;if(!over||!('spectralO' in over))u.spectralO=u.spectral;for(let i=0;i<4;i++){u['palN'+i]=p[i];u['palO'+i]=o[i];}
  for(const [name,value] of Object.entries(u)){if(name==='palette')continue;const l=gl.getUniformLocation(program,name);if(l===null){if(name==='res'||name.startsWith('pal'))throw new Error('missing shader input '+name);continue;}
   if(!Array.isArray(value))gl.uniform1f(l,value);else if(value.length===2)gl.uniform2f(l,value[0],value[1]);else if(value.length===3)gl.uniform3f(l,value[0],value[1],value[2]);else gl.uniform4f(l,value[0],value[1],value[2],value[3]);}
  gl.viewport(0,0,128,72);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,128,72,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
  let hash=2166136261,sum=0,sq=0;const lum=new Float32Array(128*72);
  for(let i=0,j=0;i<bytes.length;i+=4,j++){const l=(bytes[i]*.299+bytes[i+1]*.587+bytes[i+2]*.114);lum[j]=l;sum+=l;sq+=l*l;hash=Math.imul(hash^bytes[i],16777619);hash=Math.imul(hash^bytes[i+1],16777619);hash=Math.imul(hash^bytes[i+2],16777619);}
  const n=128*72,mean=sum/n;return {hash:hash>>>0,mean,std:Math.sqrt(Math.max(0,sq/n-mean*mean)),lum};}
 function corr(a,b){let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i];}ma/=a.length;mb/=b.length;let s=0,sa=0,sb=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;s+=x*y;sa+=x*x;sb+=y*y;}return s/Math.sqrt(sa*sb+1e-9);}
 function diff(a,b){let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);return d/a.length;}
 const envs=[],sameColour=[];for(let e=0;e<6;e++){const f=render({envA:e,envB:e});envs.push({hash:f.hash,mean:f.mean,std:f.std});sameColour.push(f.lum);}
 let maxCorr=-1;for(let a=0;a<6;a++)for(let b=a+1;b<6;b++)maxCorr=Math.max(maxCorr,corr(sameColour[a],sameColour[b]));
 const paletteHashes=Object.keys(PAL).map(k=>render({envA:4,envB:4,palette:k,spectral:PAL[k].s}).hash);
 const controls={};const ref=render({envA:2,envB:2});
 for(const [name,over] of Object.entries({bass:{bassL:.9},mid:{midL:.9},treble:{highL:.9},movement:{moveAmt:1.2},detail:{detailAmt:1.2},complexity:{complexity:1},brightness:{brightness:1.4},speed:{flowT:24.3},twoFinger:{touchHue:.8},spectral:{spectral:.9},energy:{energyL:.9}}))controls[name]=diff(ref.lum,render(Object.assign({envA:2,envB:2},over)).lum);
 const perEnvAudio=[],restraint=[],smooth=[];
 for(let e=0;e<6;e++){const quiet=render({envA:e,envB:e,bassL:0,midL:0,highL:0}),loud=render({envA:e,envB:e,bassL:1,midL:1,highL:1});
  perEnvAudio.push(diff(quiet.lum,loud.lum));restraint.push(Math.abs(loud.mean-quiet.mean)/Math.max(1,quiet.mean));
  const a=render({envA:e,envB:e,flowT:30}),b=render({envA:e,envB:e,flowT:30.05});smooth.push(diff(a.lum,b.lum));}
 // Gravity Point: share of the screen within the field that visibly moves, per experience; drag; recovery
 const gravity=[];for(let e=0;e<6;e++){const a=render({envA:e,envB:e}),g=render({envA:e,envB:e,gravStr:1,gravSpin:1.5}),moved=render({envA:e,envB:e,gravStr:1,gravSpin:1.5,gravPos:[-.45,.1]}),rel=render({envA:e,envB:e,gravStr:0});
  let changed=0,inField=0;for(let y=0;y<72;y++)for(let x=0;x<128;x++){const ux=(x+.5-64)/72,uy=(y+.5-36)/72;if(Math.hypot(ux-.15,uy)<.45){inField++;const i=y*128+x;if(Math.abs(a.lum[i]-g.lum[i])>6)changed++;}}
  gravity.push({share:changed/inField,whole:diff(a.lum,g.lum),dragged:diff(g.lum,moved.lum),recovered:diff(a.lum,rel.lum)});}
 // Colour Wave: inside the spreading front the new palette is fully in place, outside it the old one is untouched
 const pulse=[];for(let e=0;e<6;e++){const oldP=render({envA:e,envB:e,palette:'violet'}),newP=render({envA:e,envB:e,palette:'aurora'}),w=render({envA:e,envB:e,palette:'aurora',oldPalette:'violet',colorWave:[.15,0,.5,1]});
  let inNew=0,inOld=0,outOld=0,ni=0,no=0;
  for(let y=0;y<72;y++)for(let x=0;x<128;x++){const ux=(x+.5-64)/72,uy=(y+.5-36)/72,i=y*128+x,r=Math.hypot(ux-.15,uy);if(r<.25){inNew+=Math.abs(w.lum[i]-newP.lum[i]);inOld+=Math.abs(w.lum[i]-oldP.lum[i]);ni++;}else if(r>.75){outOld+=Math.abs(w.lum[i]-oldP.lum[i]);no++;}}
  pulse.push({inNew:inNew/ni,inOld:inOld/ni,outOld:outOld/no,done:diff(render({envA:e,envB:e,palette:'aurora',oldPalette:'violet',colorWave:[.15,0,3,1]}).lum,newP.lum)});}
 const fromF=render({envA:0,envB:3,envMix:0}),midF=render({envA:0,envB:3,envMix:.5}),toF=render({envA:3,envB:3,envMix:0});
 const transition={startMatchesFrom:diff(fromF.lum,render({envA:0,envB:0}).lum),midVsFrom:diff(midF.lum,fromF.lum),midVsTo:diff(midF.lum,toF.lum)};
 output.textContent='SHADER_RESULT='+JSON.stringify({envs,maxCorr,paletteHashes,controls,perEnvAudio,restraint,smooth,transition,gravity,pulse});
} catch(e) { output.textContent='ERROR='+String(e.stack||e); }
</script></body>`;

const legacySettings = JSON.stringify({ style: 'kaleidoscope', color: 'rush', intensity: 'insane', bass: 1.4, treble: .8, music: 1.2, speed: 1.6, drive: 'immersive' });
const appPage = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${fileUrl(path.join(assets, 'style.css'))}"><style>html,body{margin:0;width:960px;height:540px;overflow:hidden;background:#000}#xp{position:absolute;inset:0}#xpc{position:absolute;inset:0;width:100%;height:100%}#result{position:absolute;left:-9999px}</style>
<div id="xp" class="hidden"><canvas id="xpc"></canvas><div id="xpTop"></div><div id="xpMid"></div><div id="xpBottom"></div><button id="xpClose"></button></div><pre id="result">WAITING</pre><script>
window.__errors=[];window.addEventListener('error',e=>window.__errors.push(String(e.message||e.error)));
window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),18);window.cancelAnimationFrame=id=>clearTimeout(id);
Object.defineProperty(navigator,'deviceMemory',{configurable:true,get:()=>2});
const store={'p_liquidDreams.settings':${JSON.stringify(legacySettings)}};
window.__flash=0;window.BEAT={live:Date.now(),e:.2,k:.1,mid:.2,high:.2,kicks:0,tick(){this.live=Date.now();}};
window.Nexus={speaking:false,_img(){}};
window.__audio={meterOff:0,stopTalking:0};window.NX={A:{setPref:(k,v)=>{store['p_'+k]=v;},meter(on){if(!on)window.__audio.meterOff++;},isMusicActive:()=>true,nowPlaying:()=>JSON.stringify({playing:true,title:'Test Song',artist:'Test Artist'})},$:id=>document.getElementById(id),pref:k=>store['p_'+k]||'',stopTalking(){window.__audio.stopTalking++;}};
</script><script src="${fileUrl(path.join(assets, 'experiences.js'))}"></script><script>
(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms)),saved=()=>JSON.parse(store['p_liquidDreams.settings']);
 document.getElementById('xpClose').addEventListener('click',()=>XP.close());
 XP.open('liquiddreams');await wait(500);
 const ui=document.querySelector('.ld-ui'),migrated=saved();
 const atmosphere=document.querySelector('#xp canvas[aria-hidden="true"]');
 const result={migrated:{env:migrated.env,color:migrated.color,complexity:migrated.complexity,audio:migrated.audio,touch:migrated.touch,v:migrated.v}},D=()=>XP.liquidDebug();
 const d0=D();result.firstFrame={first:d0.firstFrame,opacity:d0.canvasOpacity,backdrop:!!document.getElementById('xp').style.background};
 result.envButtons=ui.querySelectorAll('[data-env]').length;result.colorButtons=ui.querySelectorAll('[data-color]').length;result.sliders=ui.querySelectorAll('input[type=range][data-setting]').length;
 result.gl=[...document.querySelectorAll('#xp canvas')].some(c=>c.id!=='xpc'&&c.style.display==='block');
 // dock: Experience cycles all six and wraps; colour stays
 const audio0=Object.assign({},window.__audio); const startColor=saved().color,startEnv=saved().env,seq=[];
 for(let i=0;i<6;i++){ui.querySelector('[data-action="next"]').click();seq.push(saved().env);}
 result.cycle={seq,start:startEnv,colorsKept:saved().color===startColor};
 // Color Shift cycles palettes; experience stays
 const envBefore=saved().env,shifts=[];for(let i=0;i<3;i++){ui.querySelector('[data-action="shift"]').click();shifts.push(saved().color);}
 result.shift={shifts,envKept:saved().env===envBefore,label:ui.querySelector('[data-palname]').textContent};
 await wait(300);result.audioDuringSwitches={meterOff:window.__audio.meterOff-audio0.meterOff,stopTalking:window.__audio.stopTalking-audio0.stopTalking};
 // touch: tap = Colour Wave, hold = Gravity Point, drag follows, release recovers
 const L=document.getElementById('xp'),R=L.getBoundingClientRect(),ev=(t,x,y)=>L.dispatchEvent(new PointerEvent(t,{clientX:R.left+x*R.width,clientY:R.top+y*R.height,pointerId:7,bubbles:true,cancelable:true}));
 ev('pointerdown',.3,.4);await wait(60);ev('pointerup',.3,.4);await wait(120);result.tap={wave:D().wave,palette:D().palette,gravity:D().gravity.held};await wait(2600);result.tapAfter={wave:D().wave,palette:D().palette,saved:saved().color};
 ev('pointerdown',.6,.5);await wait(700);const held=D().gravity;
 ev('pointermove',.75,.3);await wait(150);const dragged=D().gravity;
 ev('pointerup',.75,.3);let minS=1;for(let i=0;i<40;i++){await wait(60);minS=Math.min(minS,D().gravity.strength);}
 result.gravity={held:held.held,strength:held.strength,x:held.x,dragX:dragged.x,dragY:dragged.y,releasedHeld:D().gravity.held,after:D().gravity.strength,overshoot:minS};
 ui.querySelector('[data-action="controls"]').click();result.controlsOpen=D().panelOpen;
 ui.querySelector('[data-env="chrome"]').click();ui.querySelector('[data-color="aurora"]').click();
 const speed=ui.querySelector('[data-setting="speed"]');speed.value='1.5';speed.dispatchEvent(new Event('change',{bubbles:true}));
 ui.querySelector('[data-action="lowmotion"]').click();
 const after=saved();result.after={env:after.env,color:after.color,speed:after.speed,lowMotion:after.lowMotion};
 result.nowLabel=ui.querySelector('[data-now]').textContent;result.selected=ui.querySelector('[data-env].selected').dataset.env;
 // a loud beat drop must not trigger the full-screen flash in Liquid Dreams
 window.BEAT.e=.95;window.BEAT.k=1;for(let i=0;i<12;i++){window.BEAT.kicks++;await wait(60);}
 const drop=document.getElementById('xpDrop');result.dropFlashOpacity=drop?Number(drop.style.opacity||0):0;
 ui.querySelector('[data-action="save"]');ui.querySelector('[data-name]').value='Evening';ui.querySelector('[data-action="save"]').click();
 result.presets=JSON.parse(store['p_liquidDreams.presets']||'[]').map(p=>p.name);
 ui.querySelector('[data-action="clean"]').click();await wait(50);
 result.cleanHidesPanel=getComputedStyle(ui.querySelector('.ld-panel')).display==='none';
 result.track=ui.querySelector('.ld-track').textContent;
 result.atmosphereDrawn=false;if(atmosphere){const d=atmosphere.getContext('2d').getImageData(0,0,atmosphere.width,atmosphere.height).data;for(let i=3;i<d.length;i+=4)if(d[i]){result.atmosphereDrawn=true;break;}}
 ui.classList.remove('ld-clean');ui.querySelector('[data-action="exit"]').click();await wait(150);result.closed=!XP.active&&!document.querySelector('.ld-ui');
 result.afterExit={debug:typeof XP.liquidDebug,canvasOpacity:[...document.querySelectorAll('#xp canvas')].map(c=>c.style.opacity).join('|'),meterOff:window.__audio.meterOff};
 result.errors=window.__errors;
 document.getElementById('result').textContent='APP_RESULT='+JSON.stringify(result);
})().catch(e=>document.getElementById('result').textContent='ERROR='+String(e.stack||e));
</script>`;

try {
  const r = runPage('shader', shaderPage, 'SHADER_RESULT');
  assert.strictEqual(new Set(r.envs.map(e => e.hash)).size, 6, 'all six environments render different frames');
  r.envs.forEach((e, i) => assert(e.mean > 4 && e.std > 2.5, 'environment ' + i + ' renders visible, non-flat artwork even with the music stopped'));
  assert(r.maxCorr < .85, 'environments differ in structure, not just colour (max luminance correlation ' + r.maxCorr.toFixed(2) + ')');
  assert.strictEqual(new Set(r.paletteHashes).size, 14, 'all fourteen palettes produce visibly different output');
  for (const [name, change] of Object.entries(r.controls)) assert(change > .05, name + ' visibly changes the rendered pixels (' + change.toFixed(3) + ')');
  r.perEnvAudio.forEach((d, i) => assert(d > .05, 'music changes environment ' + i));
  if (process.env.LD_DEBUG) console.log(JSON.stringify({restraint:r.restraint,smooth:r.smooth,controls:r.controls,maxCorr:r.maxCorr,envs:r.envs,audio:r.perEnvAudio}));
  r.restraint.forEach((d, i) => assert(d < .45, 'music never causes an aggressive full-screen brightness change in environment ' + i + ' (' + (d * 100).toFixed(0) + '%)'));
  r.smooth.forEach((d, i) => assert(d < 3, 'environment ' + i + ' moves smoothly frame to frame (' + d.toFixed(2) + ' levels)'));
  assert(r.transition.startMatchesFrom < .5 && r.transition.midVsFrom > 1 && r.transition.midVsTo > 1, 'environment transition starts on the current world and blends through a distinct in-between frame');

  r.gravity.forEach((g, i) => {
    assert(g.share > .5, 'Gravity Point visibly moves most of the liquid within reach of the finger in experience ' + i + ' (' + Math.round(g.share * 100) + '% of the field)');
    assert(g.whole > 8, 'Gravity Point changes the whole picture substantially in experience ' + i + ' (' + g.whole.toFixed(1) + ' levels)');
    assert(g.dragged > 5, 'the field follows the finger in experience ' + i);
    assert(g.recovered < .01, 'the picture fully recovers after release in experience ' + i);
  });
  r.pulse.forEach((p, i) => assert(p.inNew < 2 && p.outOld < 1 && p.inOld > p.inNew + 2 && p.done < 1, 'Colour Wave: new colours inside the front, old colours outside, all new once it has crossed the screen, in experience ' + i + ' ' + JSON.stringify(p)));
  const a = runPage('app', appPage, 'APP_RESULT', 20000);
  assert.deepStrictEqual(a.errors, [], 'Liquid Dreams raised no browser errors');
  assert(a.gl, 'Liquid Dreams draws with the GPU in the 2 GB profile');
  assert.strictEqual(a.envButtons, 6, 'six environment buttons');
  assert.strictEqual(a.colorButtons, 15, 'fourteen palettes plus Signature (the Music Reactive option is gone)');
  assert.strictEqual(a.sliders, 8, 'eight working adjustment sliders');
  assert.deepStrictEqual(a.migrated, { env: 'iridescence', color: 'aurora', complexity: 1.8, audio: 1.2, touch: true, v: 3 }, 'saved settings from the earlier Liquid Dreams migrate');
  assert.deepStrictEqual(a.after, { env: 'chrome', color: 'aurora', speed: 1.5, lowMotion: true }, 'environment, palette, slider and low-motion controls save their changes');
  assert.strictEqual(a.selected, 'chrome', 'selected environment is highlighted');
  assert(a.nowLabel.includes('Liquid Chrome') && a.nowLabel.includes('Aurora'), 'panel header shows the current environment and palette');
  assert.strictEqual(a.dropFlashOpacity, 0, 'a beat drop never flashes the screen in Liquid Dreams');
  assert.deepStrictEqual(a.presets, ['Evening'], 'looks can be saved');
  assert(a.cleanHidesPanel, 'clean screen hides the controls');
  assert.strictEqual(a.track, 'Test Song — Test Artist', 'current track is shown');
  assert(!a.atmosphereDrawn, 'no shared colour-cycling overlay is drawn over Liquid Dreams');
  assert(a.firstFrame.first && a.firstFrame.opacity === '1' && a.firstFrame.backdrop, 'a palette backdrop covers start-up and the first GPU frame fades in (no black frame)');
  assert.deepStrictEqual(a.cycle.seq, ['ether', 'chrome', 'cosmic', 'organic', 'deepflow', 'iridescence'], 'Experience button steps through all six and wraps back to the first');
  assert(a.cycle.colorsKept, 'cycling experiences keeps the selected palette');
  assert.deepStrictEqual(a.shift.shifts, ['obsidian', 'arctic', 'electric'], 'Color Shift steps through the palettes and wraps round');
  assert(a.shift.envKept && a.shift.label === 'Electric Blue & Violet', 'Color Shift leaves the experience alone and names the palette');
  assert.deepStrictEqual(a.audioDuringSwitches, { meterOff: 0, stopTalking: 0 }, 'switching experiences and palettes never touches audio');
  assert(a.tap.wave && !a.tap.gravity && a.tap.wave.x < 0 && Math.abs(a.tap.wave.y - .1) < .01 && a.tap.wave.palette === a.tap.palette, 'a tap starts a Colour Wave at the exact point with a new palette');
  assert(!a.tapAfter.wave && a.tapAfter.palette === a.tap.palette && a.tapAfter.saved === a.tap.palette, 'the wave finishes and the new colour stays (and is saved)');
  if (process.env.LD_DEBUG) console.log(JSON.stringify({tap:a.tap,gravity:a.gravity}));
  assert(a.gravity.held && a.gravity.strength > .85 && Math.abs(a.gravity.x - .6) < .01, 'press and hold builds a full-strength Gravity Point under the finger');
  assert(Math.abs(a.gravity.dragX - .75) < .01 && Math.abs(a.gravity.dragY - .3) < .01, 'the Gravity Point follows the finger');
  assert(!a.gravity.releasedHeld && a.gravity.overshoot < -.05 && Math.abs(a.gravity.after) < .05, 'release springs outward then settles back (' + a.gravity.overshoot.toFixed(2) + ')');
  assert(a.controlsOpen, 'Controls opens the full panel');
  assert(a.closed, 'the dock Exit button closes Liquid Dreams and removes its controls');
  assert(a.afterExit.debug === 'undefined' && !a.afterExit.canvasOpacity.includes('0') && a.afterExit.meterOff >= 1, 'exit releases the renderer, resets the shared canvas and stops the audio meter');
  console.log('WebGL rendered six experiences, fourteen palettes, Gravity Point (field share ' + r.gravity.map(g => Math.round(g.share * 100) + '%').join('/') + '), Color Pulse, music response and liquid transitions; the 2 GB app run cycled experiences and Color Shift independently, handled tap, hold, drag and release, and exited cleanly.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
