// NEXUS STARTUP — the cinematic Design 2 intro and the spoken announcement.
// Opens the real app page in headless Chrome at the box's 1024x600 the way the app starts it (#boot),
// with an Android bridge stub that records when the announcement is asked for. Takes screenshots along
// the timeline, checks the sequence (black, energy, rings, emblem, lettering, home), the voice timing,
// tap-to-skip, that nothing is written under the logo, that everything is cleaned up, and that repeated
// launches each play once while a page reload without #boot plays nothing.
// Run: node startup-intro.test.js [outDir]   (outDir keeps the screenshots)
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), assert = require('assert');
const root = path.resolve(__dirname, '../..'), assets = path.join(root, 'app/src/main/assets');
const OUT = process.argv[2] || '';
const read = f => fs.readFileSync(path.join(assets, f), 'utf8');
const html = read('index.html'), app = read('app.js'), intro = read('intro.js');
const java = fs.readFileSync(path.join(root, 'app/src/main/java/com/nexus/box/MainActivity.java'), 'utf8');

// ---------- static ----------
['intro/back.jpg', 'intro/rings.webp', 'intro/emblem.webp', 'intro/word.webp', 'intro/final.jpg', 'voice/startup.ogg'].forEach(f => assert(fs.existsSync(path.join(assets, f)), f + ' is in the app'));
const bytes = ['intro/back.jpg', 'intro/rings.webp', 'intro/emblem.webp', 'intro/word.webp', 'intro/final.jpg', 'voice/startup.ogg'].reduce((a, f) => a + fs.statSync(path.join(assets, f)).size, 0);
assert(bytes < 1.2e6, 'the intro adds under 1.2 MB to the app (' + (bytes / 1e6).toFixed(2) + ' MB)');
assert(html.indexOf('intro.js') > 0 && html.indexOf('intro.js') < html.indexOf('app.js'), 'intro.js loads before app.js');
assert(/function playIntro\(\) \{\s*if \(window\.NexusIntro\)/.test(app) && app.includes('function playClassicIntro()'), 'the app plays the new intro, keeping the old one only as a fallback');
assert(!/Nexus online|Intelligence engaged|All systems|Welcome back|tagline|slogan/i.test(intro.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'the intro writes no announcement or slogan on screen');
assert(/private static boolean startupIntroShown/.test(java) && /savedInstanceState == null && !startupIntroShown/.test(java), 'the intro plays once per real start of the app');
assert(/AssetFileDescriptor fd = getAssets\(\)\.openFd\("voice\/startup\.ogg"\)/.test(java) && /mp\.setAudioAttributes\(speechAttrs\(\)\)/.test(java) && /hold\(true\)/.test(java), 'the announcement plays as assistant speech with the music ducked');
assert(/public boolean startupVoice\(\)/.test(java) && /public void stopStartupVoice\(\)/.test(java) && /stopStartupVoice\(\);\s*stopMeter\(\);/.test(java), 'the voice bridge exists and is released on exit');
// the recording: about six seconds of speech, phrase starts matching the timeline
const probe = cp.spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(assets, 'voice/startup.ogg')], { encoding: 'utf8' });
if (probe.status === 0) { const d = parseFloat(probe.stdout); assert(d > 5 && d < 8, 'the announcement is 5-8 seconds long (' + d.toFixed(2) + ' s)'); }

// ---------- the running page ----------
const browser = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(f => fs.existsSync(f));
assert(browser, 'Chrome is required');
const fileUrl = f => 'file:///' + f.replace(/\\/g, '/').replace(/^\//, '');
const BRIDGE = `window.__voice=[];window.__errors=[];addEventListener("error",e=>__errors.push(String(e.message)));
window.Android={getPref:k=>localStorage.getItem("p_"+k)||"",setPref:(k,v)=>localStorage.setItem("p_"+k,v),partyMeter:()=>{},meter:()=>{},meterDetail:()=>{},isMusicActive:()=>false,nowPlaying:()=>"{}",
  partyMediaInfo:()=>"{}",media:()=>{},mediaPlayPause:()=>{},volume:()=>{},refreshApps:()=>{},deviceMemoryGb:()=>2,setBrightness:()=>{},
  startupVoice:()=>{__voice.push(["on",performance.now()]);return true;},stopStartupVoice:()=>{__voice.push(["off",performance.now()]);}};`;
const page = html.replace('<head>', '<head><base href="' + fileUrl(assets) + '/"><script>' + BRIDGE + '</script>');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-intro-'));
const htmlPath = path.join(temp, 'index.html'); fs.writeFileSync(htmlPath, page);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const profile = path.join(temp, 'prof');
  const proc = cp.spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--window-size=1024,600', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  try {
    let port = 0;
    for (let i = 0; i < 200 && !port; i++) { await sleep(100); try { port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (e) {} }
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = {};
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
    const send = (method, params) => new Promise(res => { const n = ++id; pending[n] = res; ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 600, deviceScaleFactor: 1, mobile: false });
    const shot = async () => (await send('Page.captureScreenshot', { format: 'png' })).result.data;

    async function launch(hash) {
      // a fresh document each time (a hash-only navigation would not reload the page)
      await send('Page.navigate', { url: 'about:blank' }); await sleep(150);
      await send('Page.navigate', { url: fileUrl(htmlPath) + (hash || '') });
      for (let i = 0; i < 100; i++) { await sleep(50); if (await ev('!!(window.NexusIntro&&document.readyState==="complete")')) break; }
    }
    // ---- 1. a real start: the whole sequence ----
    await launch('#boot');
    // times are measured from the moment the sequence itself starts (after its pictures are decoded)
    for (let i = 0; i < 200; i++) { if (await ev('!!(NexusIntro.last&&NexusIntro.last.started)')) break; await sleep(20); }
    const since = () => ev('performance.now()-NexusIntro.last.started');
    const shots = [], marks = [150, 1500, 2300, 3400, 4900, 6300, 7400, 8900];
    for (const m of marks) {
      while ((await since()) < m) await sleep(15);
      const st = await ev(`(()=>{const i=document.getElementById('intro');const L=window.NexusIntro&&NexusIntro.last;return {intro:!!i,op:i?getComputedStyle(i).opacity:null,text:i?i.textContent.trim():'',t:L&&L.started?performance.now()-L.started:null,layers:i?[...i.querySelectorAll('img')].map(x=>+getComputedStyle(x).opacity):[]}})()`);
      const png = await shot(); shots.push({ at: m, st, png, after: await since() });
      if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'intro-' + String(m).padStart(4, '0') + '.png'), Buffer.from(png, 'base64')); }
    }
    const R1 = await ev(`({voice:__voice,last:NexusIntro.last,errors:__errors,home:!document.getElementById('home').classList.contains('hidden'),intro:!!document.getElementById('intro'),hash:location.hash})`);
    // ---- 2. pictures: measure brightness in the regions that matter, from the screenshots ----
    // the screenshots are decoded in the page itself
    async function regions(b64) {
      return ev(`(async()=>{const im=new Image();im.src='data:image/png;base64,'+${JSON.stringify(b64)};await im.decode();const c=document.createElement('canvas');c.width=1024;c.height=600;const g=c.getContext('2d');g.drawImage(im,0,0);
        const m=(x0,y0,x1,y1)=>{const d=g.getImageData(x0,y0,x1-x0,y1-y0).data;let s=0;for(let i=0;i<d.length;i+=4)s+=.299*d[i]+.587*d[i+1]+.114*d[i+2];return s/(d.length/4)};
        return {all:m(0,0,1024,600),emblem:m(430,120,600,270),ringL:m(190,200,330,260),word:m(240,355,780,435),corner:m(0,0,120,80)}})()`);
    }
    const reg = [];
    for (const s of shots) reg.push(Object.assign({ at: s.at }, await regions(s.png)));
    console.log('timeline (ms -> brightness: whole / emblem / left ring / NEXUS):');
    reg.forEach(r => console.log('  ' + String(r.at).padStart(4) + '  ' + [r.all, r.emblem, r.ringL, r.word].map(v => v.toFixed(0).padStart(4)).join(' ')));
    const at = ms => reg.find(r => r.at === ms);
    assert(!R1.errors.length, 'no page errors: ' + R1.errors.join(' | '));
    // a slow shared build machine can take its first picture well after 150 ms; only judge "black" on a picture taken early
    const firstAt = shots[0].after;
    if (firstAt < 450) assert(at(150).all < 12, 'it begins on a black screen (' + at(150).all.toFixed(1) + ')');
    else console.log('first picture landed at ' + firstAt.toFixed(0) + ' ms on this slow machine; black-start check skipped');
    assert(at(1500).all > at(150).all + 6 && at(1500).emblem < at(3400).emblem * .7, 'blue and violet energy and the space backdrop appear before the emblem');
    assert(at(2300).ringL > at(150).ringL + 30 && at(2300).emblem < at(3400).emblem * .6, 'the orbital rings materialise before the emblem (' + at(150).ringL.toFixed(0) + ' -> ' + at(2300).ringL.toFixed(0) + ')');
    assert(at(3400).emblem > at(1500).emblem + 25, 'the chrome N forms in the centre (' + at(1500).emblem.toFixed(0) + ' -> ' + at(3400).emblem.toFixed(0) + ')');
    assert(at(4900).word > at(3400).word + 15, 'NEXUS lights up beneath the emblem (' + at(3400).word.toFixed(0) + ' -> ' + at(4900).word.toFixed(0) + ')');
    assert(shots.every(s => !s.st.text), 'nothing is written on the intro screen');
    assert(!R1.intro && R1.home, 'it hands over to the home screen and removes itself');
    assert(R1.last && R1.last.layers === 5 && !R1.last.failed && !R1.last.skipped, 'all five picture layers loaded and the sequence ran to the end');
    const total = R1.last.ended - R1.last.started;
    assert(total > 6500 && total < 8600, 'the sequence lasts about eight seconds (' + (total / 1000).toFixed(1) + ' s)');
    const on = R1.voice.filter(v => v[0] === 'on');
    assert(on.length === 1, 'the announcement is spoken once (' + on.length + ')');
    const voiceAt = on[0][1] - R1.last.started;
    assert(voiceAt > 700 && voiceAt < 1300, 'the announcement starts as the rings form (' + Math.round(voiceAt) + ' ms)');
    assert(R1.last.frames > 30, 'the energy animation ran (' + R1.last.frames + ' frames)');
    // ---- 3. tap to skip ----
    await launch('#boot'); await sleep(1800);
    await ev(`document.getElementById('intro').dispatchEvent(new MouseEvent('click',{bubbles:true}))`); await sleep(700);
    const R2 = await ev(`({intro:!!document.getElementById('intro'),voice:__voice,last:NexusIntro.last,home:!document.getElementById('home').classList.contains('hidden')})`);
    assert(!R2.intro && R2.home && R2.last.skipped, 'a tap skips straight to the home screen');
    assert(R2.voice.some(v => v[0] === 'off'), 'skipping also stops the announcement');
    // ---- 4. repeated launches, and a reload that is not a start ----
    const runs = [];
    for (let i = 0; i < 3; i++) { await launch('#boot'); await sleep(9000); runs.push(await ev(`({voice:__voice.filter(v=>v[0]==='on').length,intro:!!document.getElementById('intro'),done:!!(NexusIntro.last&&NexusIntro.last.ended),errors:__errors.length})`)); }
    assert(runs.every(r => r.voice === 1 && !r.intro && r.done && !r.errors), 'three launches in a row each play once and clean up (' + JSON.stringify(runs) + ')');
    await launch(''); await sleep(2500);
    const R4 = await ev(`({voice:__voice.length,intro:!!document.getElementById('intro'),last:!!NexusIntro.last})`);
    assert(!R4.voice && !R4.intro && !R4.last, 'returning to the app without a fresh start shows no intro and says nothing');
    ws.close();
    console.log('Startup intro: black -> energy -> rings -> N -> NEXUS -> home in ' + (total / 1000).toFixed(1) + ' s, voice at ' + Math.round(voiceAt) + ' ms, skip, cleanup and repeated launches verified.');
  } finally { proc.kill('SIGKILL'); await sleep(300); try { fs.rmSync(temp, { recursive: true, force: true }); } catch (e) {} }
})().catch(e => { console.error(e); process.exit(1); });
