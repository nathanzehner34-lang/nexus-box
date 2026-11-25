// Visuals playlist: the real films play in headless Chrome while the screen is sampled 25 times a second.
// Checks: each video plays once, start to end, in order; the next starts by itself with no black frame and
// no pause; no restarts, no jumping back, never more than two video elements, no effects on the picture;
// repeat on/off; favourites as their own playlist; the one-element fallback; a long run; then the real
// Visuals menu (tabs, starring, removing, saved across a restart, Play All without the mix).
// Run: node visuals-playlist.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const H = require('./nxv-harness.js');

const SAMPLER = `
  NX.pref = k => localStorage.getItem('p_' + k) || '';
  const c=document.createElement('canvas'); c.width=32; c.height=18; const g=c.getContext('2d',{willReadFrequently:true});
  // what the viewer sees: the held frame if it covers the screen, else the top visible video
  const seen=()=>{ const box=document.querySelector('#xp .nv-clip'); if(!box) return -1;
    const h=box.querySelector('canvas'), vs=[...box.querySelectorAll('video')].filter(v=>+getComputedStyle(v).opacity>0.5&&v.readyState>=2)
      .sort((a,b)=>(+b.style.zIndex||1)-(+a.style.zIndex||1));
    let src=null; if(h && +getComputedStyle(h).opacity>0.5) src=h; else if(vs.length) src=vs[0];
    if(!src) return 0; g.drawImage(src,0,0,32,18); const im=g.getImageData(0,0,32,18).data; let m=0; for(let i=0;i<im.length;i+=4)m+=im[i]+im[i+1]+im[i+2]; return m/(im.length/4*3); };
  async function watch(ms, stopWhen){ const t0=Date.now(); const r={n:0,black:0,minLum:999,stallMax:0,backJumps:0,maxVideos:0,effects:0};
    let lastKey='',lastMove=Date.now(),prev=null;
    while(Date.now()-t0<ms){ await wait(40); const d=NXV.debug().theme; if(!d) break; r.n++;
      const l=seen(), opened=d.log.length&&performance.now()-d.log[0].at>450;   // after the opening fade-in from the menu
      if(l>=0&&opened){ if(l<2) r.black++; r.minLum=Math.min(r.minLum,l); }
      const key=d.i+':'+(d.time||0).toFixed(2); if(key!==lastKey){ lastKey=key; lastMove=Date.now(); } else r.stallMax=Math.max(r.stallMax,Date.now()-lastMove);
      if(prev && d.id===prev.id && d.time<prev.time-0.5) r.backJumps++;
      prev={id:d.id,time:d.time}; r.maxVideos=Math.max(r.maxVideos,d.videos);
      document.querySelectorAll('#xp video').forEach(v=>{ if(v.style.transform||getComputedStyle(v).filter!=='none'||getComputedStyle(v).objectFit!=='contain') r.effects++; });
      if(stopWhen&&stopWhen(d)) break; }
    r.minLum=+r.minLum.toFixed(1); return r; }`;

(async () => {
  const lens = {};
  ['inferno', 'skulls', 'printer', 'freshcash', 'idol', 'run', 'benjamin', 'cityfire', 'frenzy', 'serpent', 'coins', 'darkvalley', 'collapse'].forEach(k => {
    const out = require('child_process').execSync('ffprobe -v error -show_entries format=duration -of csv=p=0 ' + path.join(H.assets, 'clips', k + '.mp4')).toString();
    lens['clip_' + k] = +out;
  });

  // ---------- A. six videos back to back, then repeat ----------
  const six = ['clip_inferno', 'clip_skulls', 'clip_printer', 'clip_freshcash', 'clip_idol', 'clip_run'];
  const A = await H.run(SAMPLER + `
    localStorage.setItem('p_visLoop','1');
    NXV.start('clip_inferno',{list:${JSON.stringify(six)},label:'TEST'});
    R.w=await watch(45000, d=>d.log.length>=8);
    R.d=NXV.debug().theme; R.bar=document.getElementById('vxBar')?document.getElementById('vxBar').textContent:'';
    R.overlays=[...document.querySelectorAll('#xp .nv-clip > div')].length;
    NXV.stop();
    R.after=document.querySelectorAll('#xp video').length;`, { w: 1024, h: 600, limit: 120000 });
  const log = A.d.log;
  console.log('six:', JSON.stringify({ watch: A.w, order: log.map(e => e.id.slice(5)), from: log.map(e => e.from), fades: A.d.fades, holds: A.d.holds, restarts: A.d.restarts }));
  assert.deepStrictEqual(log.slice(0, 6).map(e => e.id), six, 'each video plays once, in playlist order');
  assert(log.every(e => e.from < 0.3), 'every video starts from its beginning: ' + log.map(e => e.from));
  assert.strictEqual(log[6].id, six[0], 'with repeat on, the playlist starts again after its last video');
  for (let k = 0; k < 6; k++) {
    const gap = (log[k + 1].at - log[k].at) / 1000, len = lens[six[k]];
    assert(gap > len - 0.35 && gap < len + 0.6, six[k] + ' played its whole length and the next followed at once (' + gap.toFixed(2) + ' s for a ' + len.toFixed(2) + ' s video)');
  }
  assert.strictEqual(A.w.black, 0, 'never a black frame (min brightness ' + A.w.minLum + ')');
  assert(A.w.stallMax < 700, 'never a pause (' + A.w.stallMax + ' ms longest still)');
  assert.strictEqual(A.w.backJumps, 0, 'never jumps backwards'); assert.strictEqual(A.d.restarts, 0, 'never restarts a video');
  assert(A.w.maxVideos <= 2 && A.d.maxVideos <= 2, 'at most two video elements');
  assert(A.d.fades >= 6 && A.d.holds === 0, 'every change is a dissolve from a ready video');
  assert.strictEqual(A.w.effects, 0, 'no zoom, filter or crop on the picture'); assert.strictEqual(A.overlays, 0, 'no flash, scan-line or vignette layers');
  assert.strictEqual(A.after, 0, 'stopping lets go of every video');
  assert(/TEST · \d \/ 6/.test(A.bar), 'the bar names the playlist position: ' + A.bar);

  // ---------- B. repeat off; next / previous; favourites playlist; one-element fallback ----------
  const B = await H.run(SAMPLER + `
    localStorage.setItem('p_visLoop','0');
    NXV.start('clip_skulls',{list:['clip_freshcash','clip_skulls','clip_printer'],label:'FAVOURITES'});
    R.f=await watch(25000, d=>d.done);
    R.fd=NXV.debug().theme; await wait(2200); R.closedAfterEnd=document.querySelectorAll('#xp video').length;
    NXV.stop();
    // next and previous buttons
    localStorage.setItem('p_visLoop','1');
    NXV.start('clip_coins'); await wait(1500);
    const bar=()=>document.getElementById('vxBar'), btn=c=>bar().querySelector('[data-vxc='+c+']');
    btn('next').click(); await wait(1200); R.afterNext=NXV.debug().theme.id;
    btn('prev').click(); await wait(1200); R.afterPrev=NXV.debug().theme.id;
    R.favAfterTapId=NXV.debug().theme.id; btn('fav').click(); R.favAfterTap=localStorage.getItem('p_favVis'); btn('fav').click(); R.favAfterUntap=localStorage.getItem('p_favVis');
    R.allList=NXV.debug().theme.list; NXV.stop();
    NXV.start('clip_mix'); await wait(800); R.mixList=NXV.debug().theme.list; NXV.stop();
    // the one-element fallback: holds the last frame instead of preloading
    localStorage.setItem('p_nvSingle','1');
    NXV.start('clip_inferno',{list:['clip_inferno','clip_printer','clip_skulls','clip_freshcash'],label:'TEST'});
    R.s=await watch(25000, d=>d.log.length>=4 && d.time>1);
    R.sd=NXV.debug().theme; NXV.stop();`, { w: 1024, h: 600, limit: 120000 });
  console.log('favourites/repeat-off:', JSON.stringify({ watch: B.f, order: B.fd.log.map(e => e.id.slice(5)) }));
  assert.deepStrictEqual(B.fd.log.map(e => e.id), ['clip_skulls', 'clip_printer'], 'a playlist started part-way plays from there, each video once');
  assert(B.fd.done && B.fd.id === 'clip_printer', 'with repeat off it stops after the last video');
  assert.strictEqual(B.f.black, 0, 'no black in the favourites playlist');
  assert.strictEqual(B.closedAfterEnd, 0, 'after the last video it goes back to the menu and lets go of the videos');
  assert.strictEqual(B.afterNext, 'clip_skulls', 'NEXT moves forward one (' + B.afterNext + ')');
  assert.strictEqual(B.afterPrev, 'clip_coins', 'PREVIOUS moves back one (' + B.afterPrev + ')');
  assert(B.favAfterTap === B.favAfterTapId && B.favAfterUntap === '', 'the ★ button adds the playing video to favourites and removes it');
  assert(!B.allList.includes('clip_mix') && B.allList.length === 13, 'Play All is every film once, without the mix that repeats them');
  assert.deepStrictEqual(B.mixList, ['clip_mix'], 'the mix plays on its own');
  console.log('single element:', JSON.stringify({ watch: B.s, order: B.sd.log.map(e => e.id.slice(5)), holds: B.sd.holds }));
  assert.deepStrictEqual(B.sd.log.map(e => e.id), ['clip_inferno', 'clip_printer', 'clip_skulls', 'clip_freshcash'], 'fallback: same order');
  assert(B.sd.single && B.s.maxVideos === 1 && B.sd.holds >= 3, 'fallback uses one video element and holds the last frame');
  assert.strictEqual(B.s.black, 0, 'fallback: no black frame either'); assert.strictEqual(B.sd.restarts, 0, 'fallback: no restarts');

  // ---------- C. a long run: all thirteen films, then round again ----------
  const C = await H.run(SAMPLER + `
    localStorage.setItem('p_visLoop','1');
    NXV.start('clip_coins');
    R.w=await watch(200000, d=>d.log.length>=17);
    R.d=NXV.debug().theme; NXV.stop();`, { w: 1024, h: 600, limit: 300000 });
  const order = C.d.log.map(e => e.id), all = C.d.list;
  console.log('long run:', JSON.stringify({ watch: C.w, plays: order.length, fades: C.d.fades, restarts: C.d.restarts }));
  assert.deepStrictEqual(order.slice(0, 13), all, 'the whole collection plays in order, each once');
  assert.deepStrictEqual(order.slice(13), all.slice(0, order.length - 13), 'then round again in the same order');
  assert.strictEqual(C.w.black, 0, 'no black over ' + order.length + ' videos'); assert(C.w.stallMax < 700, 'no pause (' + C.w.stallMax + ' ms)');
  assert.strictEqual(C.d.restarts + C.w.backJumps, 0, 'no restarts or jumps back'); assert(C.w.maxVideos <= 2, 'never more than two video elements');
  for (let k = 0; k < order.length - 1; k++) { const gap = (C.d.log[k + 1].at - C.d.log[k].at) / 1000; assert(gap > lens[order[k]] - 0.35 && gap < lens[order[k]] + 0.6, order[k] + ' ran its full length (' + gap.toFixed(2) + ')'); }

  // ---------- D. the real Visuals menu ----------
  const html = fs.readFileSync(path.join(H.assets, 'index.html'), 'utf8');
  const shots = process.env.VIS_SHOTS;
  const menu = `
    const open=async()=>{ document.querySelector('[data-act=visuals]').click(); for(let i=0;i<60&&!document.querySelector('[data-vis]');i++) await wait(100); };
    localStorage.removeItem('p_favVis'); await open();
    R.tabs=[...document.querySelectorAll('[data-visview]')].map(b=>b.textContent);
    R.noTimer=!/SWITCH EVERY/.test(document.getElementById('panelBody').textContent);
    // star three, in this order
    for (const k of ['clip_run','clip_coins','clip_idol']) { document.querySelector('[data-fav="'+k+'"]').click(); await wait(60); }
    R.saved=localStorage.getItem('p_favVis');
    document.querySelector('[data-visview=fav]').click(); await wait(80);
    R.favCards=[...document.querySelectorAll('[data-vis]')].map(b=>b.getAttribute('data-vis'));
    ${shots ? "window.__shot='menu-fav';await wait(1500);" : ''}
    document.querySelector('[data-fav="clip_coins"]').click(); await wait(80);
    R.afterRemove=[...document.querySelectorAll('[data-vis]')].map(b=>b.getAttribute('data-vis'));
    // play the favourites
    document.getElementById('vPlayFav').click(); for(let i=0;i<50&&!(window.NXV&&NXV.debug().theme&&NXV.debug().theme.time>0.3);i++) await wait(100);
    R.playing=NXV.debug().theme; ${shots ? "document.getElementById('xp').click();await wait(300);window.__shot='playing-bar';await wait(1500);" : ''}
    Nexus.back(); await wait(400);
    R.backToMenu=!!document.querySelector('[data-vis]') && !XP.active;
    // tapping a card in ALL plays ALL from there
    document.querySelector('[data-visview=all]').click(); await wait(80);
    document.querySelector('[data-vis=clip_printer]').click(); for(let i=0;i<50&&!(NXV.debug().theme&&NXV.debug().theme.time>0.2);i++) await wait(100);
    R.fromCard=NXV.debug().theme; Nexus.back(); await wait(300);`;
  const D = await H.runPage(html, menu, { w: 1024, h: 600, limit: 120000 });
  console.log('menu:', JSON.stringify({ tabs: D.tabs, saved: D.saved, favCards: D.favCards, afterRemove: D.afterRemove, playing: D.playing && D.playing.list, label: D.playing && D.playing.label, fromCard: D.fromCard && [D.fromCard.id, D.fromCard.i, D.fromCard.list.length] }));
  assert.deepStrictEqual(D.errors, [], 'no page errors');
  assert(D.tabs.length === 2 && /ALL/.test(D.tabs[0]) && /FAVOURITES/.test(D.tabs[1]), 'ALL and FAVOURITES tabs');
  assert(D.noTimer, 'no "switch every" timer any more');
  assert.strictEqual(D.saved, 'clip_run,clip_coins,clip_idol', 'favourites are saved in the order they were starred');
  assert.deepStrictEqual(D.favCards, ['clip_run', 'clip_coins', 'clip_idol'], 'the Favourites tab shows only favourites, in order');
  assert.deepStrictEqual(D.afterRemove, ['clip_run', 'clip_idol'], 'removing a favourite takes it out');
  assert.deepStrictEqual(D.playing.list, ['clip_run', 'clip_idol'], 'Play Favourites plays only the favourites');
  assert(D.playing.label === 'FAVOURITES' && D.playing.id === 'clip_run', 'from the first favourite');
  assert(D.backToMenu, 'leaving playback returns to the Visuals menu');
  assert(D.fromCard.id === 'clip_printer' && D.fromCard.list.length === 13 && D.fromCard.list[D.fromCard.i] === 'clip_printer', 'tapping a video plays ALL from that video');

  // (favourites are saved through the box's settings store, the same one every Nexus setting survives restarts in)
  console.log('Visuals playlist: six-video and thirteen-video runs (each once, in order, full length, no black, no pause, no restarts, at most two videos), repeat on/off, next/previous, favourites playlist and menu, one-element fallback, untouched picture — verified.');
})().catch(e => { console.error(e); process.exit(1); });
