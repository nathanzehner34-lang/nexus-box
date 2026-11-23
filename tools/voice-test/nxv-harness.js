// Shared harness for the Visuals themes: runs visuals.js in real headless Chrome (software WebGL)
// and returns whatever the scenario puts in R. Used by nexus-visuals.test.js and for still frames.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), assert = require('assert');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const browser = process.env.LIQUID_DREAMS_BROWSER || ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(f => fs.existsSync(f));
const fileUrl = f => 'file:///' + f.replace(/\\/g, '/').replace(/^\//, '');
const BRIDGE = `window.__detail=[];window.Android={getPref:k=>localStorage.getItem("p_"+k)||"",setPref:(k,v)=>localStorage.setItem("p_"+k,v),partyMeter:()=>{},meter:()=>{},meterDetail:on=>__detail.push(on),isMusicActive:()=>true,nowPlaying:()=>"{}",
  partyMediaInfo:()=>"{}",media:()=>{},mediaPlayPause:()=>{},volume:()=>{},refreshApps:()=>{},deviceMemoryGb:()=>2,setBrightness:()=>{}};`;
// whole app page (index.html) with an Android bridge stub
function runPage(html, scenario, opts) {
  let page = html.replace('<head>', '<head><base href="' + fileUrl(assets) + '/"><script>window.__errors=[];addEventListener("error",e=>__errors.push(String(e.message)));' + BRIDGE + '</script>');
  page = page.replace('</body>', '<pre id="__out">WAITING</pre><script>setTimeout(async()=>{const out=document.getElementById("__out");try{const wait=ms=>new Promise(r=>setTimeout(r,ms));const R={};' + scenario + ';R.errors=__errors;out.textContent="RESULT="+JSON.stringify(R);}catch(e){out.textContent="ERROR="+(e.stack||e);}},800);</script></body>');
  return run(null, Object.assign({ page: page, w: 1024, h: 600 }, opts || {}));
}
async function run(scenario, opts) {
  opts = opts || {};
  assert(browser, 'Edge or Chrome is required for the real WebGL render check');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nxv-'));
  const page = opts.page || `<!doctype html><meta charset="utf-8"><base href="${fileUrl(assets)}/"><style>html,body{margin:0;background:#000;overflow:hidden}#xp{position:absolute;inset:0;width:${opts.w || 640}px;height:${opts.h || 360}px}#xpc{position:absolute;inset:0}</style>
<div id="xp"><canvas id="xpc"></canvas></div><pre id="__out">WAITING</pre>
<script>window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));
Object.defineProperty(navigator,'deviceMemory',{configurable:true,get:()=>${opts.mem || 2}});
window.NX={A:null,$:id=>document.getElementById(id),pref:()=>''};window.Nexus={};</script>
<script src="${fileUrl(path.join(assets, 'visuals.js'))}"></script>
<script>setTimeout(async()=>{const out=document.getElementById('__out');try{const wait=ms=>new Promise(r=>setTimeout(r,ms));const R={};${scenario};R.errors=__errors;out.textContent='RESULT='+JSON.stringify(R);}catch(e){out.textContent='ERROR='+(e.stack||e);}},300);</script>`;
  const htmlPath = path.join(temp, 'p.html'); fs.writeFileSync(htmlPath, page);
  const profile = path.join(temp, 'prof');
  const proc = cp.spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--allow-file-access-from-files', '--disable-extensions', '--hide-scrollbars', '--window-size=' + (opts.w || 640) + ',' + (opts.h || 360), '--remote-debugging-port=0', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
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
    while (Date.now() - start < (opts.limit || 240000)) {
      await sleep(400);
      const r = await send('Runtime.evaluate', { expression: 'document.getElementById("__out").textContent', returnByValue: true });
      text = (r.result && r.result.result && r.result.result.value) || '';
      if (/^(RESULT|ERROR)=/.test(text)) break;
    }
    ws.close();
    if (text.startsWith('ERROR=')) throw new Error(text.slice(6));
    if (!text.startsWith('RESULT=')) throw new Error('did not finish: ' + text.slice(0, 400));
    return JSON.parse(text.slice(7));
  } finally { proc.kill('SIGKILL'); await sleep(300); try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch (e) {} }
}
function savePng(dataUrl, file) { fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64')); }
module.exports = { run, runPage, savePng, assets, root };
if (require.main === module) {
  // node nxv-harness.js <theme> <outdir>: writes still frames (quiet, groove, kick, drop)
  const theme = process.argv[2] || 'aliens', dir = process.argv[3] || '/tmp/nxv';
  fs.mkdirSync(dir, { recursive: true });
  const states = {
    quiet: { live: false, phase: 2 },
    groove: { sub: .5, bass: .5, lowmid: .45, mid: .5, high: .4, air: .3, energy: .5, phase: 9.4, speed: 1, kick: .1 },
    kick: { sub: .9, bass: .85, lowmid: .5, mid: .6, high: .5, air: .4, energy: .7, kick: 1, snare: .2, hat: .5, phase: 12.02, speed: 1 },
    drop: { sub: 1, bass: 1, lowmid: .8, mid: .8, high: .8, air: .7, energy: .9, kick: 1, snare: .8, hat: 1, dropEnv: 1, build: .3, phase: 16.05, speed: 1 }
  };
  run(`for (const [k,s] of Object.entries(${JSON.stringify(states)})) { const r = NXV.probe(${JSON.stringify(theme)}, s, { w: 960, h: 540, steps: 30, t: 8, image: true }); R[k] = r.image; R[k+'_dbg'] = r.debug; }`, { w: 960, h: 540 })
    .then(R => { for (const k of Object.keys(states)) savePng(R[k], path.join(dir, theme + '-' + k + '.png')); console.log(JSON.stringify(R.groove_dbg).slice(0, 600)); console.log('errors', R.errors); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
