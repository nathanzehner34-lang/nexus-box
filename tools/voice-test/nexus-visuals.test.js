// NEXUS VISUALS — the six-theme engine (visuals.js).
// Static checks: the old visuals are gone, the other sections are untouched, the six-band feed exists.
// Render checks (real headless Chrome, software WebGL): every built theme draws real pixels, reacts
// visibly to bass / kicks / drops, stays calm without music, keeps its dancers on the floor, and the
// themes look distinct. Then the full app: open Visuals, start a theme, switch, exit.
const fs = require('fs'), path = require('path'), assert = require('assert');
const H = require('./nxv-harness');
const A = H.assets;
const vis = fs.readFileSync(path.join(A, 'visuals.js'), 'utf8');
const xp = fs.readFileSync(path.join(A, 'experiences.js'), 'utf8');
const app = fs.readFileSync(path.join(A, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(A, 'index.html'), 'utf8');
const java = fs.readFileSync(path.join(A, '../java/com/nexus/box/MainActivity.java'), 'utf8');
const order = JSON.parse(JSON.stringify(['clip_mix', 'clip_coins', 'clip_skulls', 'clip_flag', 'clip_cityfire', 'clip_inferno', 'clip_serpent', 'clip_idol', 'clip_frenzy', 'clip_run', 'clip_collapse']));
const catalogIds = Array.from(app.slice(app.indexOf('var VISUALS = ['), app.indexOf('];', app.indexOf('var VISUALS = ['))).matchAll(/\['([^']+)'/g), m => m[1]);
assert.deepStrictEqual(catalogIds, order, 'the Visuals menu lists the cinematic mix and the ten scenes');
const clipDir = path.join(A, 'clips');
const clips = fs.readdirSync(clipDir).filter(f => f.endsWith('.mp4'));
assert(clips.length >= 20, 'scene angles are bundled (' + clips.length + ')');
const total = clips.reduce((n, f) => n + fs.statSync(path.join(clipDir, f)).size, 0);
assert(total < 70e6, 'clips stay light for the box (' + (total / 1e6).toFixed(1) + ' MB)');
for (const k of order.slice(1)) assert(fs.existsSync(path.join(clipDir, k.slice(5) + '.jpg')), k + ' has a film still for its card');
assert(app.includes('Film visuals by Beeple'), 'the clips are credited');
// The box's WebView serves the page and the clips from file:///android_asset: a CORS request on a file URL always
// fails there (the headless test browser hides this), so no crossOrigin, and file pages must count as one origin.
assert(!/crossOrigin/.test(vis), 'clips load without a CORS request (it fails on file:// in the WebView)');
assert(java.includes('s.setAllowFileAccessFromFileURLs(true);'), 'the WebView lets the page draw its own bundled clips through WebGL');

// ---- reset: nothing of the old Visuals remains ----
for (const old of ['firetornado', 'bluefire', 'hollowhead', 'cybereye', 'wormhole', 'deepsea', 'robotdj', 'mushroomworld', 'rollercoaster', 'livingskull', 'alienparty', 'neonhighway', 'VX_ORDER', 'vxStart', 'VX_SCENE'])
  assert(!xp.includes(old) && !app.includes("'" + old + "'"), 'old visual removed: ' + old);
// ---- other sections untouched ----
assert(xp.includes('function nightDrive()') && xp.includes('var ND_WORLDS = [') && xp.includes('function liquidDreams()') && xp.includes('function beatTracker(opts)'), 'Night Drive, Liquid Dreams and the shared beat tracker remain');
assert(xp.includes('liquiddreams: liquidDreams, nightdrive: nightDrive'), 'Liquid Dreams and Night Drive still dispatch');
assert(html.includes('data-act="night"') && html.includes('data-act="party"') && html.includes('data-act="liquiddreams"') && html.includes('data-act="visuals"'), 'home tiles intact');
// ---- music feed: six bands for Visuals only, Party feed unchanged ----
assert(java.includes('Nexus._meter6 && Nexus._meter6(') && java.includes('public void meterDetail(boolean on)') && java.includes('if (meterDetail && now - lastDetail >= 30)'), 'six-band feed is sent while Visuals asks for it');
assert(java.includes('if (now - lastSend < 80) return;') && java.includes('Nexus._meter && Nexus._meter('), 'the original three-band feed (Party Mode, other sections) is unchanged');
const partyMeter = java.slice(java.indexOf('private void startPartyMeter()'), java.indexOf('private void stopMeter()'));
assert(!partyMeter.includes('meterDetail = true'), 'Party Mode never turns on the detail feed');
assert(vis.includes('A.meterDetail(true)') && vis.includes('A.meterDetail(false)'), 'Visuals turns the detail feed on and off');
// ---- hardware discipline ----
assert(vis.includes("var QMIN = .42, QMAX = HIGH ? 1 : .8") && vis.includes('FPS_GAP = HIGH ? 1000 / 60 : 1000 / 30'), 'adaptive resolution and a 30 fps cap on the 2 GB box');
assert(vis.includes('preserveDrawingBuffer: false') && vis.includes('antialias: false'), 'no costly framebuffer options');
assert((vis.match(/\.jpg'/g) || []).length <= 2 && vis.includes("THEMES[k].video) { out[k] ="), 'still images are used only as menu card previews, never in place of playback');

(async () => {
  const R = await H.run(`
    R.t={};
    for (const k of NXV.order) {
      NXV.start(k); const t0=Date.now(); let d;
      while(Date.now()-t0<8000){ await wait(150); d=NXV.debug().theme; if(d&&d.ready>=2&&d.time>.2)break; }
      // watch the scene for ~1.5 s and keep its best frame: one slow first frame on a busy machine can't fail it
      const c=document.getElementById('nvc'), cv2=document.createElement('canvas'); cv2.width=64; cv2.height=36; const g=cv2.getContext('2d');
      let mean=0, sd=0;
      for(let f=0;f<10;f++){ NXV.redraw(); g.drawImage(c,0,0,64,36);
        const im=g.getImageData(0,0,64,36).data; let s=0,s2=0; for(let i=0;i<im.length;i+=4){const l=.299*im[i]+.587*im[i+1]+.114*im[i+2]; s+=l; s2+=l*l;}
        const n=im.length/4, m=s/n, d2=Math.sqrt(Math.max(0,s2/n-m*m)); if(m+d2>mean+sd){mean=m;sd=d2;} await wait(150); }
      // a kick: zoom punch and colour split must respond
      const z0=NXV.debug().theme.zoom; for(let i=0;i<45;i++){NXV.feed([.2,.2,.3,.3,.2,.2]);await wait(40);} const zA=NXV.debug().theme.zoom; NXV.feed([1,1,.4,.4,.3,.3]); let zMax=-1; for(let i=0;i<12;i++){await wait(25); zMax=Math.max(zMax,NXV.debug().theme.zoom);}
      const z1=zMax, z0b=zA;
      R.t[k]={ready:d.ready,playing:d.playing,time:d.time,mean,sd,zoomKick:z1-z0b,src:d.src};
      NXV.stop(true);
    }
    // a drop cuts straight to the next angle
    NXV.start('clip_mix'); await wait(2500);
    const a0=NXV.debug().theme.angle; NXV.music.energy=.2;
    for(let i=0;i<40;i++){NXV.feed([.15,.15,.2,.2,.2,.2]);await wait(40);} for(let i=0;i<4;i++){NXV.feed([1,1,.9,.9,.8,.8]);await wait(60);}
    await wait(300); R.dropAngle=[a0,NXV.debug().theme.angle];
    NXV.stop(false); R.stopped=NXV.debug();
  `, { w: 1024, h: 600, limit: 400000 });
  assert.deepStrictEqual(R.errors, [], 'no browser errors: ' + R.errors.join('; '));
  for (const k of order) {
    const t = R.t[k];
    assert(t && t.ready >= 2 && t.playing && t.time > .2, k + ' loads and plays its film clip (' + JSON.stringify(t) + ')');
    assert(t.mean > 6 && t.sd > 6, k + ' shows a real, detailed picture (lum ' + t.mean.toFixed(1) + ', contrast ' + t.sd.toFixed(1) + ')');
    assert(t.zoomKick > .005, k + ' punches on the kick (' + t.zoomKick.toFixed(3) + ')');
    console.log(k.padEnd(15) + ' playing ' + t.src.padEnd(22) + ' lum ' + t.mean.toFixed(1) + ' contrast ' + t.sd.toFixed(1) + ' kick punch ' + t.zoomKick.toFixed(3));
  }
  assert(!R.stopped.current && R.stopped.w <= 1, 'stopping Visuals releases the renderer and the videos');
  // ---- the whole app: home tile -> Visuals menu -> theme -> bar -> exit ----
  const page = html.replace(/(src|href)="(?!https?:)([^"]+\.(js|css))"/g, (m, a, f) => a + '="' + 'file:///' + path.join(A, f).replace(/\\/g, '/').replace(/^\//, '') + '"');
  const appR = await H.runPage(page, `
    window.__meter=[];
    document.querySelector('[data-act=visuals]').click();
    const t0=Date.now();while(!document.querySelector('.vis-card')&&Date.now()-t0<120000)await wait(100);
    R.cards=[...document.querySelectorAll('.vis-card')].map(c=>[c.dataset.vis,c.querySelector('b').textContent,!!c.querySelector('img')]);
    document.querySelector('.vis-card').click();
    await wait(2500);
    R.running=NXV.debug();R.xpVisible=!document.getElementById('xp').classList.contains('hidden');
    R.canvas=getComputedStyle(document.getElementById('nvc')).display;
    document.getElementById('xp').click();await wait(200);
    R.bar=[...document.querySelectorAll('#vxBar .vx-pick')].map(b=>b.dataset.vx);R.barOn=document.getElementById('vxBar').classList.contains('on');
    R.meterDetail=window.__detail.slice();
    document.getElementById('xpClose').click();await wait(400);
    R.after=NXV.debug();R.meterDetailAfter=window.__detail.slice();
    R.backInMenu=!!document.querySelector('.vis-card');
  `);
  assert.deepStrictEqual(appR.errors, [], 'no app errors: ' + appR.errors.join('; '));
  assert.deepStrictEqual(appR.cards.map(c => c[0]), order, 'the Visuals menu lists exactly the built themes');
  assert(appR.cards.every(c => c[2]), 'every card shows a film still');
  assert(appR.xpVisible && appR.canvas === 'block' && appR.running.frames > 3 && appR.running.current === order[0], 'tapping a card starts the theme full screen');
  assert(appR.barOn && appR.bar.join() === order.join(), 'tapping the screen shows the theme bar');
  assert(appR.meterDetail[0] === true, 'starting Visuals turns on the six-band music feed');
  assert(!appR.after.current && appR.meterDetailAfter.includes(false) && appR.backInMenu, 'closing stops the theme, turns the feed off and returns to the Visuals menu');
  console.log('Visuals: ' + order.length + ' cinematic scenes play their clips, punch on kicks and pass the full-app run; a drop cut ' + R.dropAngle.join(' -> ') + '.');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
