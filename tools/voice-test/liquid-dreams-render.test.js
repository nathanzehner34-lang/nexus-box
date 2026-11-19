const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'app/src/main/assets/experiences.js'), 'utf8');
const shader = (source.match(/var LIQUID_DREAMS_SHADER = `([\s\S]*?)`;/) || [])[1];
const headExpression = (source.match(/var GL_HEAD = ([\s\S]*?)\n  function glStart/) || [])[1];
assert(shader && headExpression, 'actual Liquid Dreams and WebGL header sources are present');
const glHead = Function('return (' + headExpression.trim().replace(/;\s*$/, '') + ')')();
const browser = process.env.LIQUID_DREAMS_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(file => fs.existsSync(file));
assert(browser && fs.existsSync(browser), 'Edge or Chrome is required for the actual WebGL render check');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'liquid-dreams-render-'));
const htmlPath = path.join(temp, 'render.html');
const html = `<!doctype html><meta charset="utf-8"><style>#result{display:none}</style><body><pre id="result">WAITING</pre><canvas id="c" width="96" height="96"></canvas><script>
const output=document.getElementById('result');
try {
 const gl=document.getElementById('c').getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl) throw new Error('WebGL context unavailable');
 const head=${JSON.stringify(glHead)}, fragment=${JSON.stringify(shader)};
 function compile(type,src){const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh));return sh;}
 const vs=compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}');
 const fs=compile(gl.FRAGMENT_SHADER,head+fragment);const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const loc=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
 function uni(name,value){const u=gl.getUniformLocation(program,name);if(u===null)throw new Error('missing shader input '+name);if(Array.isArray(value))gl.uniform2f(u,value[0],value[1]);else gl.uniform1f(u,value);}
 const bytes=new Uint8Array(96*96*4), fingerprints=[], frames=[];
 for(let tier=0;tier<3;tier++)for(let style=0;style<7;style++){
   const res=gl.getUniformLocation(program,'res');gl.uniform2f(res,96,96);
   uni('time',4.13);uni('hue',.27);uni('kick',.41);uni('energy',.52);uni('styleId',style);uni('tier',tier);
   uni('paletteId',style%6);uni('bassBand',.44);uni('midBand',.31);uni('highBand',.63);
   uni('musicSensitivity',1.);uni('motion',1.15);uni('quality',1.);uni('overdrive',0.);uni('beatPulse',.24);
   gl.viewport(0,0,96,96);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
   let hash=2166136261,bright=0,variance=0;
   for(let i=0;i<bytes.length;i+=4){const lum=bytes[i]+bytes[i+1]+bytes[i+2];bright+=lum;variance+=(bytes[i]-bytes[i+1])**2+(bytes[i+1]-bytes[i+2])**2;hash=Math.imul(hash^bytes[i],16777619);hash=Math.imul(hash^bytes[i+1],16777619);hash=Math.imul(hash^bytes[i+2],16777619);}
   fingerprints.push({style,tier,hash:hash>>>0,mean:Math.round(bright/(96*96)),variance:Math.round(variance/(96*96))});
   frames.push({style,tier,pixels:new Uint8Array(bytes)});
 }
 function renderSignature(style,tier,palette,bass,mid,high,music,motion,overdrive,beatPulse=.24,interaction={}){
   const res=gl.getUniformLocation(program,'res');gl.uniform2f(res,96,96);
   for(const [name,value] of Object.entries({time:4.13,hue:.27,kick:.41,energy:.52,styleId:style,tier,paletteId:palette,bassBand:bass,midBand:mid,highBand:high,musicSensitivity:music,motion,quality:1.,overdrive,beatPulse,touchPoint:interaction.touchPoint||[.13,.06],touchDrag:interaction.touchDrag||[0,0],touchForce:interaction.touchForce||0,touchBurst:interaction.touchBurst||0,touchRipple:interaction.touchRipple||0,touchRippleRadius:interaction.touchRippleRadius||0,touchHue:interaction.touchHue||0}))uni(name,value);
   gl.viewport(0,0,96,96);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,96,96,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
   let hash=2166136261;for(let i=0;i<bytes.length;i+=4){hash=Math.imul(hash^bytes[i],16777619);hash=Math.imul(hash^bytes[i+1],16777619);hash=Math.imul(hash^bytes[i+2],16777619);}return hash>>>0;
 }
 const colorFrames=[];for(let palette=0;palette<6;palette++)colorFrames.push(renderSignature(0,1,palette,.44,.31,.63,1.,1.15,0.));
 const audioBase=renderSignature(0,1,0,.12,.12,.12,1.,1.15,0.,0.);
 const audioFrames=[
   renderSignature(0,1,0,1.2,.12,.12,1.,1.15,0.,0.),
   renderSignature(0,1,0,.12,1.2,.12,1.,1.15,0.,0.),
   renderSignature(0,1,0,.12,.12,1.2,1.,1.15,0.,0.),
   renderSignature(0,1,0,1.2,1.2,1.2,0.,1.15,0.,0.),
   renderSignature(0,1,0,.12,.12,.12,1.,.4,0.,0.),
   renderSignature(0,1,0,.12,.12,.12,1.,2.2,0.,0.),
   renderSignature(0,1,0,.12,.12,.12,1.,1.15,1.,0.),
   renderSignature(0,1,0,.12,.12,.12,1.,1.15,0.,1.)
 ];
 const touchBase=renderSignature(0,1,0,.12,.12,.12,1.,1.15,0.,0.);
 const touchFrames=[
   renderSignature(0,1,0,.12,.12,.12,1.,1.15,0.,0.,{touchRipple:.9,touchRippleRadius:.24}),
   renderSignature(0,1,0,.12,.12,.12,1.,1.15,0.,0.,{touchForce:.9,touchDrag:[.4,-.3]}),
   renderSignature(0,1,0,.12,.12,.12,1.,1.15,0.,0.,{touchBurst:.95}),
   renderSignature(0,1,0,.12,.12,.12,1.,1.15,0.,0.,{touchHue:.8})
 ];
 const sheet=document.createElement('canvas');sheet.width=672;sheet.height=288;const ctx=sheet.getContext('2d');
 for(const frame of frames){const image=ctx.createImageData(96,96);for(let y=0;y<96;y++){const from=(95-y)*96*4,to=y*96*4;image.data.set(frame.pixels.subarray(from,from+96*4),to);}ctx.putImageData(image,frame.style*96,(2-frame.tier)*96);}
 document.body.appendChild(sheet);sheet.style.cssText='display:block;width:672px;height:288px;image-rendering:auto';
 output.textContent='ENGINE_RESULT='+JSON.stringify({fingerprints,colorFrames,audioBase,audioFrames,touchBase,touchFrames});
} catch(e) { output.textContent='ENGINE_ERROR='+String(e.stack||e); }
</script></body>`;
fs.writeFileSync(htmlPath, html);
try {
  const args = ['--headless=new','--no-sandbox','--disable-gpu-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--allow-file-access-from-files','--disable-extensions','--user-data-dir=' + path.join(temp,'profile')];
  if(process.env.LIQUID_DREAMS_RENDER_SNAPSHOT)args.push('--screenshot='+process.env.LIQUID_DREAMS_RENDER_SNAPSHOT);
  args.push('--dump-dom','file:///' + htmlPath.replace(/\\/g,'/'));
  const run = cp.spawnSync(browser, args, { encoding:'utf8', timeout:90000, maxBuffer:8*1024*1024, windowsHide:true });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error('Browser exited ' + run.status + '\n' + run.stderr);
  const match = run.stdout.match(/ENGINE_RESULT=([\s\S]*?)<\/pre>/);
  if (!match) throw new Error((run.stdout.match(/ENGINE_ERROR=([\s\S]*?)<\/pre>/)||[])[1] || 'Browser did not return shader render results. ' + run.stderr);
  const report = JSON.parse(match[1]);
  const results=report.fingerprints;
  assert.strictEqual(results.length,21,'all seven shader engines render at all three intensities');
  for(let tier=0;tier<3;tier++){
    const set=new Set(results.filter(x=>x.tier===tier).map(x=>x.hash));
    assert.strictEqual(set.size,7,'every visual engine produces a different rendered frame at tier '+tier);
  }
  for(let style=0;style<7;style++){
    const frames=results.filter(x=>x.style===style);
    assert.strictEqual(new Set(frames.map(x=>x.hash)).size,3,'Mild, Intense and Insane render different frames for engine '+style);
    assert(frames.every(x=>x.mean>3&&x.variance>10),'engine '+style+' produces visible non-flat pixels at all tiers');
  }
  assert.strictEqual(new Set(report.colorFrames).size,6,'all six colour modes produce visibly different shader output');
  assert(report.audioFrames.every(hash=>hash!==report.audioBase),'bass, mids, treble, music sensitivity, movement speed and Overdrive each alter rendered output');
  assert(report.touchFrames.every(hash=>hash!==report.touchBase),'touch ripple, drag distortion, double-tap burst and two-finger colour shift each alter rendered shader pixels');
console.log('WebGL rendered 21 Liquid Dreams frames; all seven shader engines, three intensities, six palettes, five audio inputs, both speed extremes, Overdrive and four touch effects changed measured pixels.');
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
