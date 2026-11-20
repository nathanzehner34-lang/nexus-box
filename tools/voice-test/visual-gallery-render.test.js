const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'app/src/main/assets/app.js'), 'utf8');
const xpSource = fs.readFileSync(path.join(root, 'app/src/main/assets/experiences.js'), 'utf8');
const catalog = app.slice(app.indexOf('var VISUALS = ['), app.indexOf('];', app.indexOf('var VISUALS = [')) + 2);
const names = Array.from(catalog.matchAll(/\['([^']+)'/g), match => match[1]);
const selectedNames = process.env.NEXUS_GALLERY_SCENES ? process.env.NEXUS_GALLERY_SCENES.split(',') : names;
const memoryGb = Number(process.env.NEXUS_GALLERY_MEMORY_GB || 2);
assert.deepStrictEqual(names, ['firetornado', 'bluefire', 'hollowhead', 'cybereye', 'wormhole', 'deepsea', 'robotdj', 'mushroomworld', 'ufo', 'rollercoaster', 'livingskull', 'alienparty', 'neonhighway'], 'expected the thirteen-experience Visuals catalog');
const browser = process.env.LIQUID_DREAMS_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser && fs.existsSync(browser), 'Edge or Chrome is required for actual gallery rendering verification');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-gallery-render-'));
const htmlPath = path.join(temp, 'gallery.html');
const html = `<!doctype html><meta charset="utf-8"><style>html,body,#xp{margin:0;width:800px;height:450px;overflow:hidden;background:#01020a}#xp{position:absolute;inset:0}#xpc{position:absolute;inset:0;width:100%;height:100%}#xpTop,#xpMid,#xpBottom{position:absolute;color:white;z-index:2}#xpMid{top:45%;width:100%;text-align:center}</style>
<div id="xp"><canvas id="xpc"></canvas><div id="xpTop"></div><div id="xpMid"></div><div id="xpBottom"></div><button id="xpClose"></button><div id="xpNext"></div></div><pre id="result">WAITING</pre><script>
window.addEventListener('error',e=>{(window.__errors||(window.__errors=[])).push(String(e.message||e.error));});
window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),18);window.cancelAnimationFrame=id=>clearTimeout(id);
Object.defineProperty(navigator,'deviceMemory',{configurable:true,get:()=>${JSON.stringify(memoryGb)}});
window.__draws=0;window.__glDraws=0;const oldGet=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(type,...args){const c=oldGet.call(this,type,...args);if(c&&type==='2d'&&!c.__nexusTrack){c.__nexusTrack=true;for(const n of ['fill','fillRect','stroke','strokeRect','drawImage','fillText','putImageData']){const old=c[n];if(old)c[n]=function(...a){window.__draws++;return old.apply(this,a);};}}if(c&&(type==='webgl'||type==='experimental-webgl')&&!c.__nexusTrack){c.__nexusTrack=true;const old=c.drawArrays;c.drawArrays=function(...a){window.__glDraws++;return old.apply(this,a);};}return c;};
window.BEAT={live:Date.now(),e:.58,k:.72,mid:.46,high:.63,kicks:0,tick(){if(Math.random()<.02)this.kicks++;}};
window.Nexus={speaking:false,_img(){}};window.NX={A:null,$:id=>document.getElementById(id),pref:()=>'',stopTalking(){},weather:()=>null,place:()=>'',getCoords:()=>Promise.resolve({lat:51,lng:-114}),saver:()=>false,saverOff(){},latestPhoto:()=>'',askAI:()=>Promise.resolve(''),http:()=>Promise.resolve(''),pick:a=>a[0],wait:()=>Promise.resolve(),esc:s=>String(s)};
</script><script src="${'file:///' + path.join(root, 'app/src/main/assets/experiences.js').replace(/\\/g,'/')}"></script><script>
(async()=>{const names=${JSON.stringify(selectedNames)},ctx=document.getElementById('xpc').getContext('2d'),results=[];function signature(){let c=document.getElementById('xpc'),data=null,w=c.width,h=c.height;if(c.style.visibility==='hidden'){const glc=Array.from(document.querySelectorAll('#xp canvas')).find(x=>x!==c&&x.style.display!=='none');if(glc){const gl=glc.getContext('webgl')||glc.getContext('experimental-webgl');if(gl){w=glc.width;h=glc.height;data=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);}}}if(!data){try{data=ctx.getImageData(0,0,w,h).data;}catch(e){return {hash:0,mean:0,variance:0};}}let hash=2166136261,mean=0,varc=0,n=0;for(let i=0;i<data.length;i+=Math.max(4,Math.floor(data.length/6000/4)*4)){const r=data[i],g=data[i+1],b=data[i+2];mean+=r+g+b;varc+=(r-g)**2+(g-b)**2;n++;hash=Math.imul(hash^r,16777619);hash=Math.imul(hash^g,16777619);hash=Math.imul(hash^b,16777619);}return {hash:hash>>>0,mean:Math.round(mean/n),variance:Math.round(varc/n),width:w,height:h};}
for(const name of names){const before2d=window.__draws,beforeGl=window.__glDraws;window.BEAT.live=Date.now();XP.open(name);await new Promise(resolve=>setTimeout(resolve,320));const sample=signature();const draws2d=window.__draws-before2d,drawsGl=window.__glDraws-beforeGl,overlay=document.querySelector('#xp canvas[aria-hidden="true"]');let overlayDraws=0;if(overlay){try{const p=overlay.getContext('2d').getImageData(0,0,overlay.width,overlay.height).data;for(let i=3;i<p.length;i+=64)if(p[i]>0)overlayDraws++;}catch(e){}}const worldPass=document.getElementById('xpWorldFinish');results.push({name,...sample,draws2d,drawsGl,overlayDraws,worldPass:!!worldPass&&worldPass.style.display!=='none'});XP.close(true);await new Promise(resolve=>setTimeout(resolve,35));}
let audioReaction=null;if(names.includes('quantumparticles')){XP.open('quantumparticles');window.BEAT.live=0;window.BEAT.e=window.BEAT.k=window.BEAT.mid=window.BEAT.high=0;await new Promise(resolve=>setTimeout(resolve,260));function worldSignature(){const c=document.getElementById('xpWorldFinish'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=2166136261,lit=0;for(let i=0;i<d.length;i+=16){h=Math.imul(h^d[i],16777619);h=Math.imul(h^d[i+1],16777619);h=Math.imul(h^d[i+2],16777619);if(d[i+3]>12)lit++;}return {hash:h>>>0,lit};}const idle=worldSignature();window.BEAT.live=Date.now();window.BEAT.e=.95;window.BEAT.k=.98;window.BEAT.mid=.82;window.BEAT.high=.9;window.BEAT.kicks++;await new Promise(resolve=>setTimeout(resolve,260));const active=worldSignature();audioReaction={idle,active};XP.close(true);}
let packValidation=null;if(window.XP.Packs){const good={id:'test-world',version:'1.0.0',description:'Verified test pack',preview:'preview.webp',variants:[{minMemoryGb:0,assets:[{path:'preview.webp',url:'https://assets.example.test/preview.webp',sha256:'a'.repeat(64),size:32,mime:'image/webp'}]}]};packValidation={valid:XP.Packs.validate(good).length===1,rejectsExecutable:false};try{XP.Packs.validate({...good,variants:[{minMemoryGb:0,assets:[{path:'renderer.js',url:'https://assets.example.test/renderer.js',sha256:'a'.repeat(64),size:32,mime:'application/javascript'}]}]});}catch(e){packValidation.rejectsExecutable=true;}}
document.getElementById('result').textContent='GALLERY_RESULT='+JSON.stringify({results,audioReaction,packValidation,errors:window.__errors||[]});})().catch(e=>document.getElementById('result').textContent='GALLERY_ERROR='+String(e.stack||e));
</script>`;
fs.writeFileSync(htmlPath, html);
try {
 const args=['--headless=new','--no-sandbox','--disable-gpu-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--allow-file-access-from-files','--disable-extensions','--virtual-time-budget=60000','--user-data-dir='+path.join(temp,'profile'),'--dump-dom','file:///'+htmlPath.replace(/\\/g,'/')];
 const run=cp.spawnSync(browser,args,{encoding:'utf8',timeout:300000,maxBuffer:12*1024*1024,windowsHide:true});if(run.error)throw run.error;if(run.status!==0)throw new Error('Browser exited '+run.status+'\n'+run.stderr);
 const match=run.stdout.match(/GALLERY_RESULT=([\s\S]*?)<\/pre>/);if(!match)throw new Error((run.stdout.match(/GALLERY_ERROR=([\s\S]*?)<\/pre>/)||[])[1]||'Gallery browser did not return render results: '+run.stderr);
 const report=JSON.parse(match[1]);if(process.env.NEXUS_GALLERY_DEBUG)console.log(JSON.stringify(report));assert.strictEqual(report.results.length,selectedNames.length,'every selected gallery experience was opened');
 for(const scene of report.results){assert(scene.draws2d+scene.drawsGl>0,scene.name+' executed its renderer');assert(scene.mean>2&&scene.variance>2,scene.name+' produced actual non-flat visible pixels');assert.strictEqual(scene.overlayDraws,0,scene.name+' renders without the old overlay layers');assert(!scene.worldPass,scene.name+' has no retired finishing pass');assert(scene.drawsGl>0,scene.name+' renders on the GPU');assert(scene.width>0&&scene.height>0,scene.name+' has a valid render target');}
 assert.strictEqual(new Set(report.results.map(scene=>scene.hash)).size,report.results.length,'gallery scenes retain distinct rendered identities instead of collapsing to one effect');
 assert.strictEqual(report.errors.length,0,'gallery scenes raised no browser runtime errors: '+report.errors.join('; '));
 if(names.includes('quantumparticles'))assert(report.audioReaction&&report.audioReaction.idle.hash!==report.audioReaction.active.hash&&report.audioReaction.active.lit>0,'the Visuals scene finishing layer changes in response to actual bass, mid, treble, energy and beat inputs');
 assert(report.packValidation&&report.packValidation.valid&&report.packValidation.rejectsExecutable,'offline world manifests validate and executable JavaScript assets are rejected');
 console.log('Actual browser opened and rendered '+report.results.length+' gallery experiences in the '+memoryGb+' GB memory profile; every scene produced non-flat pixels and renderer draw calls.');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
