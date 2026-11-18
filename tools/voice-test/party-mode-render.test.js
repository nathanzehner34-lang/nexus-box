const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

const root = path.resolve(__dirname, '../..');
const index = fs.readFileSync(path.join(root, 'app/src/main/assets/index.html'), 'utf8');
const partyJs = path.join(root, 'app/src/main/assets/party.js');
const memoryGb = Number(process.env.PARTY_MEMORY_GB || 2);
const start = index.indexOf('<div id="party"');
const markerMatch = index.slice(start).match(/\r?\n<\/div>\r?\n\r?\n<div id="xp"/);
assert(start >= 0 && markerMatch, 'Party Mode markup is present');
const marker = start + markerMatch.index;
const partyMarkup = index.slice(start, marker + markerMatch[0].match(/^\r?\n<\/div>/)[0].length);
const browser = process.env.PARTY_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser && fs.existsSync(browser), 'Chrome or Edge is required for Party Mode render and interaction verification');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-party-render-'));
const htmlPath = path.join(temp, 'party.html');
const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:960px;height:540px;overflow:hidden;background:#030711;font:14px sans-serif}
#party{position:fixed;inset:0;width:960px;height:540px;background:#030711;color:#effdff;overflow:hidden;touch-action:none}
#party.hidden{display:none}#partyCanvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
#pWash,#pfx,.pbar,.party-legacy{display:none!important}.party-shell{position:absolute;inset:0;pointer-events:none}
.party-header{position:absolute;inset:8px 10px auto;z-index:3;display:flex;align-items:center;gap:8px;min-height:42px}
.party-brand,.party-player,.party-status,.party-access,.party-exit{pointer-events:auto}.party-player{display:flex;max-width:360px}
.party-track{min-width:120px}.party-transport,.party-modes,.party-atmospheres,.party-actions{display:flex;gap:6px;pointer-events:auto}
.party-center{position:absolute;top:95px;left:0;right:0;text-align:center;pointer-events:none}.party-mode,.party-preset,.party-action,.party-icon,.party-access,.party-exit{pointer-events:auto}
.party-dock{position:absolute;bottom:12px;display:flex;gap:12px;pointer-events:none}.party-dock button{pointer-events:auto}
</style><body>${partyMarkup}
<pre id="result">WAITING</pre>
<script>
window.__errors=[];window.addEventListener('error',e=>__errors.push(String(e.message||e.error)));
let seed=72381;window.__randoms=[];Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=seed/4294967296;__randoms.push(v);return v;};
window.__drawOps=0;for(const method of ['fill','fillRect','stroke','drawImage','arc','ellipse','quadraticCurveTo']){const old=CanvasRenderingContext2D.prototype[method];CanvasRenderingContext2D.prototype[method]=function(...args){window.__drawOps++;return old.apply(this,args);};}
window.__frames=0;window.__clock=1000;Object.defineProperty(performance,'now',{configurable:true,value:()=>window.__clock});
window.__rafQueue=[];window.__rafId=0;window.requestAnimationFrame=fn=>{const id=++__rafId;__rafQueue.push({id,fn});return id;};
window.cancelAnimationFrame=id=>{__rafQueue=__rafQueue.filter(item=>item.id!==id);};
window.__stepFrames=count=>{for(let i=0;i<count;i++){__clock+=34;const q=__rafQueue.splice(0);for(const item of q){__frames++;item.fn(__clock);}}};
window.Android={deviceMemoryGb:()=>Number(new URLSearchParams(location.search).get('memory')||2),partyMediaInfo:()=>JSON.stringify({access:true,app:'com.spotify.music',title:'Signal Bloom',artist:'Violet Arc',playing:true,canPrevious:true,canNext:true,canPlayPause:true})};
window.Nexus={_meter(){},_meterSource(){},_meterError(){}};
HTMLCanvasElement.prototype.setPointerCapture=function(){};
</script><script src="${'file:///' + partyJs.replace(/\\/g, '/')}"></script><script>
(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),root=document.getElementById('party'),canvas=document.getElementById('partyCanvas');
 root.classList.remove('hidden');await wait(30);
 const ctx=canvas.getContext('2d');function signature(){const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;let h=2166136261,lit=0;for(let i=0;i<d.length;i+=Math.max(4,Math.floor(d.length/8000/4)*4)){h=Math.imul(h^d[i],16777619);h=Math.imul(h^d[i+1],16777619);h=Math.imul(h^d[i+2],16777619);if(d[i]+d[i+1]+d[i+2]>55)lit++;}return{hash:h>>>0,lit};}
 const firstX=20+__randoms[0]*920,firstY=20+__randoms[1]*500;
 const orbPoints=[];for(let i=0;i<22;i++)orbPoints.push({x:20+__randoms[i*7]*920,y:20+__randoms[i*7+1]*500});
 const ev=(type,id,x,y)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,isPrimary:true,pointerType:'touch',clientX:x,clientY:y}));
 const frameWait=async ms=>{__stepFrames(Math.ceil(ms/32));await wait(0);};
 await frameWait(260);const ambient=signature();
 Nexus._meter(.12,.19,.06,.025);await frameWait(250);const music=signature();
 ev('pointerdown',1,firstX,firstY);ev('pointerup',1,firstX,firstY);await frameWait(100);const tapped=signature();
 ev('pointerdown',2,firstX,firstY);ev('pointerup',2,firstX,firstY);ev('pointerdown',3,firstX,firstY);ev('pointerup',3,firstX,firstY);await frameWait(100);const doubled=signature();
 ev('pointerdown',4,firstX,firstY);await frameWait(920);const holding=signature();ev('pointerup',4,firstX,firstY);await frameWait(100);const released=signature();
 ev('pointerdown',5,firstX,firstY);ev('pointermove',5,firstX+62,firstY+34);ev('pointermove',5,firstX+112,firstY+55);ev('pointerup',5,firstX+112,firstY+55);await frameWait(100);const dragged=signature();
 let bg={x:20,y:20,best:-1};for(let y=26;y<520;y+=34)for(let x=26;x<940;x+=34){let nearest=1e9;for(const o of orbPoints)nearest=Math.min(nearest,Math.hypot(o.x-x,o.y-y));if(nearest>bg.best){bg={x,y,best:nearest};}}
 ev('pointerdown',6,bg.x,bg.y);ev('pointermove',6,bg.x+80,bg.y+30);ev('pointermove',6,bg.x+155,bg.y+55);ev('pointerup',6,bg.x+155,bg.y+55);await frameWait(120);const swiped=signature();
 root.classList.add('hidden');await wait(0);__stepFrames(4);const stoppedFrames=__frames;root.classList.remove('hidden');await wait(0);__stepFrames(4);const resumedFrames=__frames;
 const report={ambient,music,tapped,doubled,holding,released,dragged,swiped,frames:__frames,stoppedFrames,resumedFrames,drawOps:__drawOps,errors:__errors,song:document.getElementById('pSong').textContent,artist:document.getElementById('partyArtist').textContent,compactPlayer:!!document.querySelector('.party-player')};
 document.getElementById('result').textContent='PARTY_RESULT='+JSON.stringify(report);root.classList.add('hidden');
})().catch(e=>document.getElementById('result').textContent='PARTY_ERROR='+String(e.stack||e));
</script></body>`;
fs.writeFileSync(htmlPath, html);
try {
  const args = ['--headless=new','--no-sandbox','--disable-gpu-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--allow-file-access-from-files','--disable-extensions','--virtual-time-budget=10000','--user-data-dir='+path.join(temp,'profile'),'--dump-dom','file:///'+htmlPath.replace(/\\/g,'/')+'?memory='+memoryGb];
  const run = cp.spawnSync(browser,args,{encoding:'utf8',timeout:30000,maxBuffer:6*1024*1024,windowsHide:true});
  if(run.error) throw run.error;
  if(run.status!==0) throw new Error('Browser exited '+run.status+'\n'+run.stderr);
  const match=run.stdout.match(/PARTY_RESULT=([\s\S]*?)<\/pre>/);
  if(!match) throw new Error((run.stdout.match(/PARTY_ERROR=([\s\S]*?)<\/pre>/)||[])[1]||'Party browser harness returned no result: '+run.stderr);
  const report=JSON.parse(match[1]);
  if(process.env.PARTY_DEBUG) console.log(JSON.stringify(report));
  assert(report.drawOps>1000,'Party rendered its procedural environment, orbs and energy effects');
  assert(report.frames>=8,'Party animation remained active while visible');
  assert(report.stoppedFrames>=report.frames-4,'Party renderer stops drawing after its screen is hidden');
  assert(report.resumedFrames===report.stoppedFrames+4,'Party renderer restarts when its screen becomes visible again');
  assert(report.ambient.lit>100&&report.ambient.hash!==0,'ambient scene contains visible rendered pixels');
  assert(report.music.hash!==report.ambient.hash,'measured bass, midrange and treble alter the rendered field');
  for(const [before,after,action] of [['music','tapped','single tap'],['tapped','doubled','double tap'],['doubled','holding','press and hold'],['holding','released','hold release'],['released','dragged','orb drag'],['dragged','swiped','background swipe']])
    assert.notStrictEqual(report[before].hash,report[after].hash,action+' changed the rendered energy field');
  assert.strictEqual(report.song,'Signal Bloom','compact now-playing title updates from Android media metadata');
  assert.strictEqual(report.artist,'Violet Arc','compact now-playing artist updates from Android media metadata');
  assert(report.compactPlayer,'now-playing uses the compact Party header');
  assert.deepStrictEqual(report.errors,[],'Party render and gestures raise no browser errors');
  console.log('Party Mode browser rendered its audio-reactive energy field, gesture interactions, compact now-playing and visibility stop/restart in the '+memoryGb+' GB profile.');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
