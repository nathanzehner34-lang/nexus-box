// Visuals: every film runs across its end (REPEAT on, a one-film playlist) while the screen is sampled:
// the picture never drops to black, never freezes, and the next play starts from the beginning.
// (Whole playlists are covered by visuals-playlist.test.js.)
// Run: node visuals-seamless.test.js
const assert = require('assert');
const H = require('./nxv-harness.js');
(async () => {
  const R = await H.run(`
    NX.pref = k => localStorage.getItem('p_' + k) || ''; localStorage.setItem('p_visLoop','1');
    const c=document.createElement('canvas'); c.width=48; c.height=27; const g=c.getContext('2d',{willReadFrequently:true});
    // what the viewer sees: the held frame if it covers the screen, else the top visible video
    const seen=()=>{ const box=document.querySelector('#xp .nv-clip'); if(!box) return -1;
      const h=box.querySelector('canvas'), vs=[...box.querySelectorAll('video')].filter(v=>+getComputedStyle(v).opacity>0.5&&v.readyState>=2).sort((a,b)=>(+b.style.zIndex||1)-(+a.style.zIndex||1));
      let src=null; if(h && +getComputedStyle(h).opacity>0.5) src=h; else if(vs.length) src=vs[0];
      if(!src) return 0; g.drawImage(src,0,0,48,27); const im=g.getImageData(0,0,48,27).data; let m=0; for(let i=0;i<im.length;i+=4)m+=im[i]+im[i+1]+im[i+2]; return m/(im.length/4*3); };
    R.scenes={};
    // every film on its own with REPEAT on: run across its end, where it hands over to its own start
    for (const k of NXV.order) {
      NXV.stop(true); NXV.start(k,{list:[k],label:'T'}); let t0=Date.now();
      while(Date.now()-t0<10000){ await wait(50); const d=NXV.debug().theme; if(d&&d.ready>=2&&d.time>.1&&d.next&&d.next.ready>=2) break; }
      const cur=()=>[...document.querySelectorAll('#xp video')].find(v=>v.style.opacity==='1'), v=cur(), len=v.duration||0;
      v.currentTime=Math.max(0,len-1.5); await wait(300);
      let black=0, n=0, minLum=999, stall=0, lastKey='', lastMove=Date.now();
      t0=Date.now();
      while(Date.now()-t0<4000){ await wait(40); const l=seen(); n++; if(l>=0){ if(l<3) black++; minLum=Math.min(minLum,l); }
        const d=NXV.debug().theme, key=d.log.length+':'+d.time; if(key!==lastKey){ lastKey=key; lastMove=Date.now(); } else stall=Math.max(stall, Date.now()-lastMove); }
      const d=NXV.debug().theme;
      R.scenes[k]={len, black, n, minLum:+minLum.toFixed(1), stall, plays:d.log.length, restartFrom:d.log.length>1?d.log[1].from:-1, restarts:d.restarts, maxVideos:d.maxVideos, err:d.err};
    }
    NXV.stop(false); R.videosAfter=document.querySelectorAll('#xp video').length;
  `, { w: 1024, h: 600, limit: 400000 });
  for (const [k, s] of Object.entries(R.scenes)) {
    assert(s.len > 2.5 && !s.err, k + ' plays (' + JSON.stringify(s) + ')');
    assert.strictEqual(s.black, 0, k + ' never shows black across its end (' + JSON.stringify(s) + ')');
    assert(s.plays === 2 && s.restartFrom < .3, k + ' played to its end and the repeat started from the beginning (' + JSON.stringify(s) + ')');
    assert.strictEqual(s.restarts, 0, k + ' never jumps back mid-video');
    assert(s.stall < 700, k + ' never freezes (' + s.stall + ' ms without a new frame)');
    assert(s.maxVideos <= 2, k + ' at most two video elements');
  }
  assert(R.videosAfter === 0, 'all videos released at the end');
  console.log('Visuals seamless: ' + Object.keys(R.scenes).length + ' films run across their end into the next play with no black, no freezes and no restarts. ' +
    Object.entries(R.scenes).map(([k, s]) => k.slice(5) + ' ' + s.len.toFixed(1) + 's').join(', '));
})().catch(e => { console.error(e); process.exit(1); });
