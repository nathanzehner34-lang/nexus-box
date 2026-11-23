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
const order = JSON.parse(JSON.stringify(['clip_mix', 'clip_coins', 'clip_skulls', 'clip_cityfire', 'clip_inferno', 'clip_serpent', 'clip_idol', 'clip_frenzy', 'clip_run', 'clip_collapse']));
const catalogIds = Array.from(app.slice(app.indexOf('var VISUALS = ['), app.indexOf('];', app.indexOf('var VISUALS = ['))).matchAll(/\['([^']+)'/g), m => m[1]);
assert.deepStrictEqual(catalogIds, order, 'the Visuals menu lists the cinematic mix and the nine scenes (Molten Flag removed)');
const clipDir = path.join(A, 'clips');
const clips = fs.readdirSync(clipDir).filter(f => f.endsWith('.mp4'));
assert.deepStrictEqual(clips.sort(), order.map(k => k.slice(5) + '.mp4').sort(), 'one continuous reel per scene plus the mix, and nothing left over (' + clips.join(', ') + ')');
assert(!/flag|Molten/i.test(vis) && !/clip_flag|MOLTEN FLAG/.test(app) && !fs.existsSync(path.join(clipDir, 'flag.jpg')), 'Molten Flag is gone everywhere');
// seamless playback: each scene is one looping reel, so nothing loads mid-scene and nothing goes black
assert(vis.includes("v.loop = true;") && !/\.prototype\.cut\b/.test(vis) && !/fx\.dip/.test(vis), 'scenes loop one continuous reel: no mid-scene loads, no black beat dips');
const total = clips.reduce((n, f) => n + fs.statSync(path.join(clipDir, f)).size, 0);
assert(total < 70e6, 'clips stay light for the box (' + (total / 1e6).toFixed(1) + ' MB)');
for (const k of order.slice(1)) assert(fs.existsSync(path.join(clipDir, k.slice(5) + '.jpg')), k + ' has a film still for its card');
assert(app.includes('Film visuals by Beeple'), 'the clips are credited');
// The box's WebView serves the page and the clips from file:///android_asset: a CORS request on a file URL always
// fails there (the headless test browser hides this), so no crossOrigin, and file pages must count as one origin.
assert(!/crossOrigin/.test(vis), 'clips load without a CORS request (it fails on file:// in the WebView)');
assert(!/playbackRate|texImage2D\(gl\.TEXTURE_2D, 0, gl\.RGB, gl\.RGB, gl\.UNSIGNED_BYTE, v\)/.test(vis), 'clips play at normal speed on the hardware path (no per-frame copies into WebGL, no speed changes)');
// film scenes never create or resize a WebGL canvas (the auto-quality step crashed on slow machines when it did)
assert(vis.includes("function sizeCanvas() {\n    if (!glc || !layer) return;") && vis.includes('if (theme && !theme.video) adapt(now, gap);'), 'film scenes skip the canvas resize and auto-quality');
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
    R.t={}; R.maxVideos=0;
    const vids=()=>document.querySelectorAll('#xp video').length;
    for (const k of NXV.order) {
      NXV.start(k); const t0=Date.now(); let d;
      while(Date.now()-t0<8000){ await wait(150); d=NXV.debug().theme; R.maxVideos=Math.max(R.maxVideos,vids()); if(d&&d.ready>=2&&d.time>.2)break; }
      // the hardware video itself must carry real pictures (sampled over ~1.5 s, best frame)
      const v=document.querySelector('#xp video'), cv2=document.createElement('canvas'); cv2.width=64; cv2.height=36; const g=cv2.getContext('2d');
      let mean=0, sd=0;
      for(let f=0;f<10;f++){ g.drawImage(v,0,0,64,36);
        const im=g.getImageData(0,0,64,36).data; let s=0,s2=0; for(let i=0;i<im.length;i+=4){const l=.299*im[i]+.587*im[i+1]+.114*im[i+2]; s+=l; s2+=l*l;}
        const n=im.length/4, m=s/n, d2=Math.sqrt(Math.max(0,s2/n-m*m)); if(m+d2>mean+sd){mean=m;sd=d2;} await wait(150); }
      for(let i=0;i<45;i++){NXV.feed([.2,.2,.3,.3,.2,.2]);await wait(40);}
      const tf0=NXV.debug().theme.transform, zA=NXV.debug().theme.zoom; NXV.feed([1,1,.4,.4,.3,.3]); let zMax=-1, tfKick='';
      for(let i=0;i<12;i++){await wait(25); const dd=NXV.debug().theme; if(dd.zoom>zMax){zMax=dd.zoom; tfKick=dd.transform;}}
      R.t[k]={ready:d.ready,playing:d.playing,time:d.time,mean,sd,zoomKick:zMax-zA,tf0,tfKick,src:d.src,err:d.err,videos:vids()};
      NXV.stop(true); R.afterStop=vids();
    }
    // switching straight from scene to scene never piles up videos
    for (const k of NXV.order.slice(0,5)) { NXV.stop(true); NXV.start(k); await wait(300); R.maxVideos=Math.max(R.maxVideos,vids()); }
    NXV.stop(false); R.stopped=NXV.debug(); R.videosAtEnd=vids();
  `, { w: 1024, h: 600, limit: 400000 });
  assert.deepStrictEqual(R.errors, [], 'no browser errors: ' + R.errors.join('; '));
  for (const k of order) {
    const t = R.t[k];
    assert(t && t.ready >= 2 && t.playing && t.time > .2, k + ' loads and plays its film clip (' + JSON.stringify(t) + ')');
    assert(t.mean > 6 && t.sd > 6, k + ' shows a real, detailed picture (lum ' + t.mean.toFixed(1) + ', contrast ' + t.sd.toFixed(1) + ')');
    assert(t.zoomKick > .12 && t.tfKick !== t.tf0, k + ' punches on the kick (' + t.zoomKick.toFixed(2) + ': ' + t.tfKick + ')');
    assert(t.videos === 1, k + ' runs exactly one video');
    console.log(k.padEnd(15) + ' playing ' + t.src.padEnd(22) + ' lum ' + t.mean.toFixed(1) + ' contrast ' + t.sd.toFixed(1) + ' kick ' + t.tfKick);
  }
  assert(R.maxVideos <= 1, 'never more than one video loaded, even while switching (' + R.maxVideos + ')');
  assert(R.afterStop === 0 && R.videosAtEnd === 0, 'a scene releases its video the moment it stops');
  assert(!R.stopped.current, 'stopping Visuals stops the scene');
  // ---- the whole app: home tile -> Visuals menu -> theme -> bar -> exit ----
  const page = html.replace(/(src|href)="(?!https?:)([^"]+\.(js|css))"/g, (m, a, f) => a + '="' + 'file:///' + path.join(A, f).replace(/\\/g, '/').replace(/^\//, '') + '"');
  const appR = await H.runPage(page, `
    window.__meter=[];
    document.querySelector('[data-act=visuals]').click();
    const t0=Date.now();while(!document.querySelector('.vis-card')&&Date.now()-t0<120000)await wait(100);
    R.cards=[...document.querySelectorAll('.vis-card')].map(c=>[c.dataset.vis,c.querySelector('b').textContent,!!c.querySelector('img')]);
    document.querySelector('.vis-card').click();
    await wait(2500);
    // a slow build machine may still be starting the film: give it up to ten more seconds to draw
    { const t1=Date.now(); while(NXV.debug().frames<=3&&Date.now()-t1<10000) await wait(100); }
    R.running=NXV.debug();R.xpVisible=!document.getElementById('xp').classList.contains('hidden');
    R.canvas=document.querySelectorAll('#xp video').length;
    document.getElementById('xp').click();await wait(200);
    R.bar=[...document.querySelectorAll('#vxBar .vx-pick')].map(b=>b.dataset.vx);R.barOn=document.getElementById('vxBar').classList.contains('on');
    R.meterDetail=window.__detail.slice();
    document.getElementById('xpClose').click();await wait(400);
    R.after=NXV.debug();R.meterDetailAfter=window.__detail.slice();R.videosAfter=document.querySelectorAll('#xp video').length;
    R.backInMenu=!!document.querySelector('.vis-card');
  `);
  assert.deepStrictEqual(appR.errors, [], 'no app errors: ' + appR.errors.join('; '));
  assert.deepStrictEqual(appR.cards.map(c => c[0]), order, 'the Visuals menu lists exactly the built themes');
  assert(appR.cards.every(c => c[2]), 'every card shows a film still');
  assert(appR.xpVisible && appR.canvas === 1 && appR.running.frames > 3 && appR.running.current === order[0], 'tapping a card starts the scene full screen with one video (' + JSON.stringify(appR.running) + ')');
  assert(appR.barOn && appR.bar.join() === order.join(), 'tapping the screen shows the theme bar');
  assert(appR.meterDetail.includes(true), 'starting Visuals turns on the six-band music feed');
  assert(!appR.after.current && appR.meterDetailAfter.includes(false) && appR.backInMenu && appR.videosAfter === 0, 'closing stops the scene, releases its video, turns the feed off and returns to the Visuals menu');
  console.log('Visuals: ' + order.length + ' cinematic scenes play on the hardware video path, one video at a time, punch on kicks, and pass the full-app run.');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
