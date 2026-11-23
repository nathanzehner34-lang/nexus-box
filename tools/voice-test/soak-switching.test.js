// SOAK: switching repeatedly between Nexus experiences must not leak.
// Runs the whole app in headless Chrome with music playing through both meter feeds and cycles
// Liquid Dreams (style + palette changes), two Visuals film scenes, Night Drive, Hologram, Clock and
// Party Mode, 20 times. Afterwards: JS heap, DOM size, <video> and <canvas> counts and the audio
// meter state must be back near where they started; every mode must still open and render.
const path = require('path'), fs = require('fs'), assert = require('assert');
const H = require('./nxv-harness');
const A = H.assets, html = fs.readFileSync(path.join(A, 'index.html'), 'utf8');
const ROUNDS = +(process.env.SOAK_ROUNDS || 20);
(async () => {
  const page = html.replace(/(src|href)="(?!https?:)([^"]+\.(js|css))"/g, (m, a, f) => a + '="' + 'file:///' + path.join(A, f).replace(/\\/g, '/').replace(/^\//, '') + '"');
  const R = await H.runPage(page, `
    window.__meters=[]; const am=Android.meter; Android.meter=on=>{__meters.push(on);};
    let n=0; const music=setInterval(()=>{n++;const k=n%14===0;Nexus._meter6(k?.9:.15,k?.8:.12,.2,.25,n%7===3?.3:.06,.05);if(n%2===0)Nexus._meter(.1,k?.3:.05,.04,.02);},33);
    const snap=()=>({heap:performance.memory?performance.memory.usedJSHeapSize/1e6:0,dom:document.getElementsByTagName('*').length,videos:document.querySelectorAll('video').length,
      canvases:document.querySelectorAll('canvas').length,live:XP.active?XP.current:null});
    const gcWait=async()=>{await wait(400); if(window.gc)window.gc(); await wait(200);};
    const open=async(k,ms)=>{Nexus.openExperience(k); await wait(ms);};
    // warm everything up once
    await open('liquiddreams',1500); XP.close(); await open('clip_coins',1500); XP.close(); await open('nightdrive',1500); XP.close();
    await gcWait(); R.base=snap(); R.rounds=[];
    for(let r=0;r<${ROUNDS};r++){
      await open('liquiddreams',900);
      const ui=document.querySelector('.ld-ui'); if(ui){ui.querySelector('[data-action="next"]').click(); ui.querySelector('[data-action="shift"]').click();}
      await wait(500); const ld=XP.liquidDebug(); XP.close();
      await open('clip_mix',900); const v1=NXV.debug(); XP.switchTo('clip_inferno'); await wait(700); const v2=NXV.debug(); XP.close();
      await open('nightdrive',900); XP.close();
      await open('holo',600); XP.close();
      await open('clockface',600); XP.close();
      document.querySelector('[data-act=party]').click(); await wait(900); if(window.Nexus&&Nexus.home)Nexus.home(); await wait(300);
      if(r%5===4){ await gcWait(); const s=snap(); s.ldFrames=ld.frames; s.clipPlaying=v2.theme&&v2.theme.playing; R.rounds.push(s); }
    }
    clearInterval(music); await gcWait(); R.end=snap(); R.meterOnAtEnd=__meters.length?__meters[__meters.length-1]:null;
    // every mode still opens and draws after all that
    await open('liquiddreams',1500); R.ldAfter=XP.liquidDebug().frames; XP.close();
    await open('clip_run',1500); R.clipAfter=NXV.debug().theme; XP.close();
  `, { limit: 900000, w: 960, h: 540 });
  assert.deepStrictEqual(R.errors, [], 'no errors: ' + R.errors.join('; '));
  console.log('base ', JSON.stringify(R.base)); R.rounds.forEach((s, i) => console.log('r' + ((i + 1) * 5) + '  ', JSON.stringify(s))); console.log('end  ', JSON.stringify(R.end));
  assert(R.end.videos === 0, 'no videos left loaded after switching (' + R.end.videos + ')');
  assert(R.end.canvases <= R.base.canvases + 1, 'canvases do not pile up (' + R.base.canvases + ' -> ' + R.end.canvases + ')');
  assert(R.end.dom <= R.base.dom * 1.15 + 40, 'the page does not keep growing (' + R.base.dom + ' -> ' + R.end.dom + ' elements)');
  if (R.base.heap) assert(R.end.heap < R.base.heap * 1.6 + 8, 'memory settles back (' + R.base.heap.toFixed(1) + ' -> ' + R.end.heap.toFixed(1) + ' MB)');
  assert(R.meterOnAtEnd === false, 'the music meter is off when nothing needs it');
  assert(R.ldAfter > 5 && R.clipAfter && R.clipAfter.playing, 'Liquid Dreams and the film scenes still work after ' + ROUNDS + ' rounds');
  console.log('Soak: ' + ROUNDS + ' rounds of switching, memory ' + (R.base.heap || 0).toFixed(1) + ' -> ' + (R.end.heap || 0).toFixed(1) + ' MB, page ' + R.base.dom + ' -> ' + R.end.dom + ' elements, videos ' + R.end.videos + ', canvases ' + R.base.canvases + ' -> ' + R.end.canvases + '.');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
