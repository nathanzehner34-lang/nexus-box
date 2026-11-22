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
const ALL = ['aliens', 'skeletons', 'psychedelic', 'cyberpunk', 'creatures', 'holograms'];
const order = JSON.parse(vis.match(/var ORDER = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
assert(order.length >= 1 && order.every((k, i) => k === ALL[i]), 'built themes follow the agreed order: ' + order);

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
assert(!/\.(png|jpe?g|webp)['"]/.test(vis), 'no static images stand in for animation');

const QUIET = { live: false, phase: 2 };
const GROOVE = { sub: .5, bass: .5, lowmid: .45, mid: .5, high: .4, air: .3, energy: .5, phase: 9.4, speed: 1, kick: .1 };
const KICK = Object.assign({}, GROOVE, { sub: .95, bass: .9, kick: 1, energy: .7, phase: 9.42 });
const DROP = { sub: 1, bass: 1, lowmid: .8, mid: .8, high: .8, air: .7, energy: .9, kick: 1, snare: .8, hat: 1, dropEnv: 1, build: .3, phase: 16.05, speed: 1 };
(async () => {
  const R = await H.run(`
    const diff=(a,b)=>a.grid.reduce((s,v,i)=>s+Math.abs(v-b.grid[i]),0)/a.grid.length;
    const mean=g=>g.grid.reduce((s,v)=>s+v,0)/g.grid.length;
    const sd=g=>{const m=mean(g);return Math.sqrt(g.grid.reduce((s,v)=>s+(v-m)*(v-m),0)/g.grid.length);};
    R.t={};const grids={};
    for (const k of NXV.order) {
      const P=(s,o)=>NXV.probe(k,s,Object.assign({steps:24,t:8},o||{}));
      const q=P(${JSON.stringify(QUIET)}), g=P(${JSON.stringify(GROOVE)}), kk=P(${JSON.stringify(KICK)}), d=P(${JSON.stringify(DROP)});
      const g2=P(Object.assign({}, ${JSON.stringify(GROOVE)}, {phase: 9.9}));
      grids[k]=g;
      R.t[k]={lum:mean(g),sd:sd(g),quietLum:mean(q),kick:diff(g,kk),drop:diff(g,d),beatMove:diff(g,g2),quietVsGroove:diff(q,g),dbg:g.debug};
    }
    R.distinct=[];const ks=Object.keys(grids);for(let i=0;i<ks.length;i++)for(let j=i+1;j<ks.length;j++)R.distinct.push([ks[i],ks[j],diff(grids[ks[i]],grids[ks[j]])]);
    // live loop: start, run real frames with a fed six-band signal, check the beat detector and pacing
    const t0=performance.now();NXV.start(NXV.order[0]);
    let n=0;const feed=setInterval(()=>{n++;const kick=n%12===0;NXV.feed([kick?.9:.2,kick?.8:.2,.3,.35,n%3===0?.5:.2,.2]);},40);
    await wait(6000);clearInterval(feed);
    R.live=NXV.debug();R.liveMs=performance.now()-t0;NXV.stop(false);R.stopped=NXV.debug();
  `, { w: 640, h: 360, limit: 400000 });
  assert.deepStrictEqual(R.errors, [], 'no browser errors: ' + R.errors.join('; '));
  for (const k of order) {
    const t = R.t[k];
    assert(t.lum > 8 && t.sd > 8, k + ' draws a real, detailed picture (lum ' + t.lum.toFixed(1) + ', contrast ' + t.sd.toFixed(1) + ')');
    assert(t.kick > 1.2, k + ' reacts visibly to a kick (' + t.kick.toFixed(2) + ')');
    assert(t.drop > 4, k + ' reacts strongly to a drop (' + t.drop.toFixed(2) + ')');
    assert(t.beatMove > 1, k + ' keeps moving through the beat (' + t.beatMove.toFixed(2) + ')');
    assert(t.quietLum < t.lum + 2, k + ' is calmer without music');
    if (t.dbg && t.dbg.verts) assert(t.dbg.verts < 60000, k + ' geometry fits the 2 GB box (' + t.dbg.verts + ' vertices)');
    if (t.dbg && t.dbg.dancers) for (const d of t.dbg.dancers) assert(d.hips[1] > .2 && d.head[1] > d.hips[1], k + ': ' + d.name + ' stands upright on the floor');
    console.log(k.padEnd(12) + ' lum ' + t.lum.toFixed(1) + ' contrast ' + t.sd.toFixed(1) + ' kick ' + t.kick.toFixed(2) + ' drop ' + t.drop.toFixed(2) + ' beat ' + t.beatMove.toFixed(2) + (t.dbg && t.dbg.verts ? ' verts ' + t.dbg.verts : ''));
  }
  for (const [a, b, d] of R.distinct) assert(d > 6, a + ' and ' + b + ' look distinct (' + d.toFixed(1) + ')');
  assert(R.live.frames > 20, 'the live loop rendered frames (' + R.live.frames + ')');
  assert(R.live.music.live && R.live.music.bpm > 70 && R.live.music.bpm < 170, 'the six-band feed is analysed: live, tempo ' + Math.round(R.live.music.bpm) + ' BPM');
  assert(!R.stopped.current && R.stopped.w <= 1, 'stopping Visuals releases the renderer');
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
  assert(appR.cards.every(c => c[2]), 'every card shows a rendered preview frame');
  assert(appR.xpVisible && appR.canvas === 'block' && appR.running.frames > 3 && appR.running.current === order[0], 'tapping a card starts the theme full screen');
  assert(appR.barOn && appR.bar.join() === order.join(), 'tapping the screen shows the theme bar');
  assert(appR.meterDetail[0] === true, 'starting Visuals turns on the six-band music feed');
  assert(!appR.after.current && appR.meterDetailAfter.includes(false) && appR.backInMenu, 'closing stops the theme, turns the feed off and returns to the Visuals menu');
  console.log('Visuals engine: ' + order.length + ' theme(s) rendered, music-reactive and distinct; live loop ' + R.live.frames + ' frames, tempo ' + Math.round(R.live.music.bpm) + ' BPM.');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
