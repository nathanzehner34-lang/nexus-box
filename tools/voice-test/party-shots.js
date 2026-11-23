// Party Mode screenshots: opens the real app page in headless Chrome at the box's 1024x600, enters Party
// Mode from its home tile, picks an experience (and mode / background), plays synthetic music through the
// box's feeds and saves screenshots. Also a module: shots(steps) -> results.
// Usage: node party-shots.js <outDir>
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '../..'), assets = path.join(root, 'app/src/main/assets');
const fileUrl = f => 'file:///' + f.replace(/\\/g, '/').replace(/^\//, '');
const browser = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(f => fs.existsSync(f));
const BRIDGE = `window.__errors=[];addEventListener("error",e=>__errors.push(String(e.message)));window.__calls=[];
window.Android={getPref:k=>localStorage.getItem("p_"+k)||"",setPref:(k,v)=>localStorage.setItem("p_"+k,v),partyMeter:on=>__calls.push(["partyMeter",on]),meter:on=>__calls.push(["meter",on]),meterDetail:on=>__calls.push(["meterDetail",on]),isMusicActive:()=>true,nowPlaying:()=>JSON.stringify({title:"Midnight Drive",artist:"Synthwave"}),
  partyMediaInfo:()=>JSON.stringify({connected:true,playing:true,title:"Midnight Drive",artist:"Synthwave"}),media:()=>{},mediaPlayPause:()=>{},volume:()=>{},refreshApps:()=>{},deviceMemoryGb:()=>2,setBrightness:()=>{},startupVoice:()=>true,stopStartupVoice:()=>{}};`;
const SYN = `
window.__music={on:false,o:{}};
function bandsAt(t,o){const beat=o.bpm?60/o.bpm:0,since=beat?t%beat:9,n=beat?Math.floor(t/beat):0;
 const kick=beat&&o.kick?Math.exp(-since/.06)*o.kick:0, snare=beat&&o.snare&&n%2===1?Math.exp(-since/.08)*o.snare:0, hat=beat&&o.hat?Math.exp(-Math.abs(since-beat/2)/.02)*o.hat:0;
 const pad=(o.pad||0)*(1+.3*Math.sin(t*.7)), j=()=>1+(Math.random()-.5)*.12;
 return [.02+pad*.3+kick,.02+pad*.4+kick*.7,.02+pad+snare*.5,.015+pad*.7+snare,.008+hat*.7+snare*.3+pad*.05,.005+hat].map(v=>v*j());}
(function(){const t0=performance.now();let last=0;setInterval(()=>{if(!__music.on)return;const now=performance.now(),t=(now-t0)/1000,b=bandsAt(t,__music.o);
 if(Nexus._meter6)Nexus._meter6(b[0],b[1],b[2],b[3],b[4],b[5]);
 if(now-last>=80){last=now;const all=(b[0]+b[1]+b[2]+b[3]+b[4]+b[5])/6;Nexus._meter&&Nexus._meter(all,(b[0]+b[1])/2,(b[2]+b[3])/2,(b[4]+b[5])/2);}},33);})();`;
async function session(fn, opts) {
  opts = opts || {};
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'party-'));
  let html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
  html = html.replace('<head>', '<head><base href="' + fileUrl(assets) + '/"><script>' + BRIDGE + '</script>').replace('</body>', '<script>' + SYN + '</script></body>');
  const htmlPath = path.join(temp, 'index.html'); fs.writeFileSync(htmlPath, html);
  const profile = path.join(temp, 'prof');
  const proc = cp.spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--allow-file-access-from-files', '--hide-scrollbars', '--window-size=1024,600', '--remote-debugging-port=0', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    let port = 0;
    for (let i = 0; i < 200 && !port; i++) { await sleep(100); try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (e) {} }
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = {};
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
    const send = (method, params) => new Promise(res => { const n = ++id; pending[n] = res; ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result && r.result.result ? r.result.result.value : undefined; };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 600, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: fileUrl(htmlPath) });
    for (let i = 0; i < 100; i++) { await sleep(100); if (await ev('document.readyState==="complete"&&!!document.querySelector("[data-act=party]")')) break; }
    await sleep(500);
    const shot = async file => { const d = (await send('Page.captureScreenshot', { format: 'png' })).result.data; if (file) fs.writeFileSync(file, Buffer.from(d, 'base64')); return d; };
    return await fn({ ev, shot, sleep, send });
  } finally { proc.kill('SIGKILL'); await sleep(300); try { fs.rmSync(temp, { recursive: true, force: true }); } catch (e) {} }
}
module.exports = { session };
if (require.main === module) {
  const out = process.argv[2] || '/tmp/party'; fs.mkdirSync(out, { recursive: true });
  session(async ({ ev, shot, sleep }) => {
    await ev(`document.querySelector('[data-act=party]').click()`); await sleep(2500);
    await shot(path.join(out, 'orb-ui.png'));
    await ev(`__music.on=true;__music.o={bpm:126,kick:1,snare:.8,hat:.7,pad:.3}`);
    await sleep(3000); await shot(path.join(out, 'orb-music.png'));
    for (const m of ['wave', 'vortex', 'chaos']) { await ev(`document.querySelector('[data-mode=${m}]').click()`); await sleep(1500); await shot(path.join(out, 'orb-' + m + '.png')); }
    for (const b of ['smoke', 'aurora', 'deep', 'iridescent']) { await ev(`document.querySelector('[data-backdrop=${b}]').click()`); await sleep(2600); await shot(path.join(out, 'orb-bg-' + b + '.png')); }
    await ev(`document.querySelector('[data-experience=flow]').click()`); await sleep(3500); await shot(path.join(out, 'flow.png'));
    await ev(`document.getElementById('partyBass').click()`); await sleep(700); await shot(path.join(out, 'flow-burst.png'));
    await ev(`document.querySelector('[data-experience=ink]').click()`); await sleep(3500); await shot(path.join(out, 'ink.png'));
    console.log(JSON.stringify(await ev('({errors:__errors,calls:__calls})')));
  }).catch(e => { console.error(e); process.exit(1); });
}
