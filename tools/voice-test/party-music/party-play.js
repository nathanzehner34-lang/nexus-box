// Plays the Party test songs (party-songs.json, made by make_songs.py) into the real app page, the way the
// box delivers music: one Visualizer capture every 50 ms feeds Nexus._meter6, every other one Nexus._meter.
// Runs headless Chrome at the box's 1024x600 on virtual time, so every frame is rendered and captured in
// order however slow the software GPU is. Used by party-music.test.js and party-video.js.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '../../..'), assets = path.join(root, 'app/src/main/assets');
const fileUrl = f => 'file:///' + f.replace(/\\/g, '/').replace(/^\//, '');
const browser = process.env.PARTY_BROWSER || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(f => fs.existsSync(f));
const SONGS = JSON.parse(fs.readFileSync(process.env.PARTY_SONGS || path.join(__dirname, 'party-songs.json'), 'utf8'));
// Virtual clock: after __vtOn() the page's performance.now, timers and animation frames run on a clock that
// only moves when the harness calls __step(ms, frameMs), so each frame is rendered and captured in order.
const CLOCK = `(function(){var R=performance.now.bind(performance),rRAF=window.requestAnimationFrame.bind(window),rCAF=window.cancelAnimationFrame.bind(window),
rST=window.setTimeout.bind(window),rSI=window.setInterval.bind(window),rCT=window.clearTimeout.bind(window),rCI=window.clearInterval.bind(window);
var on=false,vt=0,q=[],raf=[],nid=1e7;
performance.now=function(){return on?vt:R();};
window.requestAnimationFrame=function(cb){if(!on)return rRAF(cb);var id=++nid;raf.push({id:id,cb:cb});return id;};
window.cancelAnimationFrame=function(id){if(id>1e7)raf=raf.filter(function(r){return r.id!==id;});else rCAF(id);};
function add(cb,ms,args,iv){var id=++nid;q.push({id:id,t:vt+Math.max(0,+ms||0),cb:cb,args:args,iv:iv?Math.max(1,+ms||0):0});return id;}
window.setTimeout=function(cb,ms){if(!on||typeof cb!=='function')return rST.apply(null,arguments);return add(cb,ms,[].slice.call(arguments,2),false);};
window.setInterval=function(cb,ms){if(!on||typeof cb!=='function')return rSI.apply(null,arguments);return add(cb,ms,[].slice.call(arguments,2),true);};
window.clearTimeout=function(id){if(id>1e7)q=q.filter(function(x){return x.id!==id;});else rCT(id);};
window.clearInterval=function(id){if(id>1e7)q=q.filter(function(x){return x.id!==id;});else rCI(id);};
window.__vtOn=function(){if(!on){vt=R();on=true;}};
window.__step=function(ms,fm){var end=vt+ms;while(vt<end-1e-6){vt=Math.min(end,vt+fm);if(window.__songTick)__songTick();
 for(var g=0;g<500;g++){var due=null;for(var i=0;i<q.length;i++)if(q[i].t<=vt&&(!due||q[i].t<due.t))due=q[i];if(!due)break;
  if(due.iv)due.t+=due.iv;else q.splice(q.indexOf(due),1);try{due.cb.apply(null,due.args);}catch(e){__errors.push(String(e&&e.message||e));}}
 var list=raf;raf=[];for(var j=0;j<list.length;j++){try{list[j].cb(vt);}catch(e){__errors.push(String(e&&e.message||e));}}}};
})();`;
const BRIDGE = `window.__errors=[];document.write('<style>#partyCanvas,#partyOrbs{transition:none!important}</style>');addEventListener("error",e=>__errors.push(String(e.message)));
window.Android={getPref:k=>localStorage.getItem("p_"+k)||"",setPref:(k,v)=>localStorage.setItem("p_"+k,v),partyMeter:()=>{},meter:()=>{},meterDetail:()=>{},isMusicActive:()=>true,
  nowPlaying:()=>JSON.stringify({title:"Party test",artist:"Nexus"}),partyMediaInfo:()=>JSON.stringify({connected:true,playing:true,app:"com.spotify.music",title:"Party test",artist:"Nexus",canPlayPause:true}),
  media:()=>{},mediaPlayPause:()=>{},volume:()=>{},refreshApps:()=>{},deviceMemoryGb:()=>+(localStorage.getItem("p_testmem")||2),setBrightness:()=>{},startupVoice:()=>true,stopStartupVoice:()=>{}};`;
// The player: __play(frames, startAt) feeds captures by elapsed page time; __play(null) stops (silence).
const PLAYER = `
window.__song={frames:null,t0:0,i:-1};
window.__play=function(frames){__song.frames=frames;__song.t0=performance.now();__song.i=-1;};
window.__songTick=function(){var s=__song;if(!s.frames)return;var i=Math.floor((performance.now()-s.t0)/50);if(i===s.i)return;
 if(i>=s.frames.length){s.frames=null;return;}s.i=i;var f=s.frames[i];
 if(window.Nexus&&Nexus._meter6)Nexus._meter6(f[4],f[5],f[6],f[7],f[8],f[9]);
 if(i%2===0&&window.Nexus&&Nexus._meter){Nexus._meterSource&&!s.src&&(s.src=1,Nexus._meterSource('music'));Nexus._meter(f[0],f[1],f[2],f[3]);}};
setInterval(function(){__songTick();},10);`;

async function session(fn, opts) {
  opts = opts || {};
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'partyplay-'));
  let html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
  html = html.replace('<head>', '<head><base href="' + fileUrl(assets) + '/"><script>' + BRIDGE + CLOCK + (opts.mem ? 'localStorage.setItem("p_testmem","' + opts.mem + '");' : '') + '</script>')
    .replace('</body>', '<script>' + PLAYER + '</script></body>');
  const htmlPath = path.join(temp, 'index.html'); fs.writeFileSync(htmlPath, html);
  const profile = path.join(temp, 'prof');
  const proc = cp.spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--allow-file-access-from-files', '--hide-scrollbars', '--window-size=1024,600', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    let port = 0;
    for (let i = 0; i < 200 && !port; i++) { await sleep(100); try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (e) {} }
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = {}, waiters = [];
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
      else if (m.method) for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].method === m.method) { waiters[i].res(m.params); waiters.splice(i, 1); }
    };
    const send = (method, params) => new Promise(res => { const n = ++id; pending[n] = res; ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    const once = method => new Promise(res => waiters.push({ method, res }));
    const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result && r.result.result ? r.result.result.value : undefined; };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 600, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: fileUrl(htmlPath) });
    for (let i = 0; i < 100; i++) { await sleep(100); if (await ev('document.readyState==="complete"&&!!document.querySelector("[data-act=party]")')) break; }
    await sleep(400);
        // advance(ms): page time moves on by ms, one frame every frameMs (30 frames a second by default)
    const advance = async (ms, frameMs) => { await ev('__vtOn();__step(' + ms + ',' + (frameMs || 1000 / 30) + ')'); };
    const shot = async (file, quality) => {
      const d = (await send('Page.captureScreenshot', quality ? { format: 'jpeg', quality } : { format: 'png' })).result.data;
      if (file) fs.writeFileSync(file, Buffer.from(d, 'base64')); return d;
    };
    const play = key => ev('__play(' + JSON.stringify(SONGS.songs[key].frames) + ')');
    const enter = async experience => {
      await ev(`document.querySelector('[data-act=party]').click()`);
      await sleep(1500);
      if (experience) await ev(`NexusParty.setExperience(${JSON.stringify(experience)})`);
    };
    return await fn({ ev, shot, sleep, send, advance, play, enter, songs: SONGS });
  } finally { proc.kill('SIGKILL'); await sleep(300); try { fs.rmSync(temp, { recursive: true, force: true }); } catch (e) {} }
}
module.exports = { session, SONGS };
