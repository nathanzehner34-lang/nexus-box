// Visuals: playback is continuous. Each scene runs past its loop point while the screen is sampled:
// the picture never drops to black or blank, the video never stalls, and only one video is loaded.
// Then scenes follow each other straight away (Play favourites) and must never show black between them.
// Run: node visuals-seamless.test.js
const assert = require('assert');
const H = require('./nxv-harness.js');
(async () => {
  const R = await H.run(`
    const c=document.createElement('canvas'); c.width=48; c.height=27; const g=c.getContext('2d');
    // what the viewer sees: the clip layer (video, or the held picture over it)
    const seen=()=>{ const box=document.querySelector('#xp .nv-clip'); if(!box) return -1;
      const v=box.querySelector('video'), h=box.querySelector('canvas');
      let src=null; if(h && +getComputedStyle(h).opacity>0.5) src=h; else if(v && +getComputedStyle(v).opacity>0.5 && v.readyState>=2) src=v;
      if(!src) return 0; g.drawImage(src,0,0,48,27); const im=g.getImageData(0,0,48,27).data; let m=0; for(let i=0;i<im.length;i+=4)m+=im[i]+im[i+1]+im[i+2]; return m/(im.length/4*3); };
    R.scenes={}; R.maxVideos=0;
    for (const k of NXV.order) {
      NXV.stop(true); NXV.start(k); let t0=Date.now();
      while(Date.now()-t0<10000){ await wait(50); const d=NXV.debug().theme; if(d&&d.ready>=2&&d.time>.1) break; }
      const v=document.querySelector('#xp video'); const len=v.duration||0;
      // run through the loop point: from 1.5 s before the end to 2 s after it
      if (len>4) { v.currentTime=Math.max(0,len-1.5); await wait(400); }
      let black=0, n=0, minLum=999, stall=0, lastT=-1, lastMove=Date.now(), loops=0, prevT=0, reloads=0; const src0=v.currentSrc;
      t0=Date.now();
      while(Date.now()-t0<4500){ await wait(40); const l=seen(); n++; if(l>=0){ if(l<3) black++; minLum=Math.min(minLum,l); }
        const vv=document.querySelector('#xp video'); if(!vv) { black++; continue; } if(vv.currentSrc!==src0) reloads++;
        if(vv.currentTime<prevT-0.5) loops++; prevT=vv.currentTime;
        if(vv.currentTime!==lastT){ lastT=vv.currentTime; lastMove=Date.now(); } else stall=Math.max(stall, Date.now()-lastMove);
        R.maxVideos=Math.max(R.maxVideos, document.querySelectorAll('#xp video').length); }
      R.scenes[k]={len, black, n, minLum:+minLum.toFixed(1), stall, loops, reloads, err:NXV.debug().theme.err};
    }
    // scene after scene, as Play favourites does it
    let black2=0, n2=0;
    for (const k of NXV.order.slice(1,6)) { NXV.stop(true); NXV.start(k); const t0=Date.now(); while(Date.now()-t0<1800){ await wait(30); const l=seen(); n2++; if(l>=0&&l<3) black2++; } }
    R.chain={black:black2, n:n2}; NXV.stop(false); R.videosAfter=document.querySelectorAll('#xp video').length;
  `);
  for (const [k, s] of Object.entries(R.scenes)) {
    assert(s.len > 2.5 && !s.err, k + ' has one continuous reel (' + JSON.stringify(s) + ')');
    assert.strictEqual(s.black, 0, k + ' never shows black or a blank frame, including across its loop point (' + JSON.stringify(s) + ')');
    assert(s.loops >= 1, k + ' really went through its loop point (' + JSON.stringify(s) + ')');
    assert.strictEqual(s.reloads, 0, k + ' never reloads mid-scene');
    assert(s.stall < 700, k + ' never freezes (' + s.stall + ' ms without a new frame)');
  }
  assert.strictEqual(R.chain.black, 0, 'one scene flows into the next without black (' + JSON.stringify(R.chain) + ')');
  assert(R.maxVideos <= 1 && R.videosAfter === 0, 'one video at a time, released at the end');
  console.log('Visuals seamless: ' + Object.keys(R.scenes).length + ' scenes loop with no black, no reloads and no freezes; scene changes hold the last picture. ' +
    Object.entries(R.scenes).map(([k, s]) => k.slice(5) + ' ' + s.len.toFixed(1) + 's').join(', '));
})().catch(e => { console.error(e); process.exit(1); });
