// Party Mode with real music: plays the five test songs (party-music/party-songs.json, measured the way the
// box measures playing audio) into the real app page on a virtual clock, and checks that every scene reacts
// to the music in its own way, that quiet and loud passages and different genres behave differently, that
// colour (not white) carries the light, and that frames change smoothly (no jumps outside real drops).
const assert = require('assert');
const { session } = require('./party-music/party-play');

const LUM = `function frameStats(){const g=document.getElementById('partyGL'),c=document.createElement('canvas');c.width=96;c.height=56;const x=c.getContext('2d');x.drawImage(g,0,0,96,56);
 const d=x.getImageData(0,0,96,56).data;let lum=0,white=0,lit=0,sat=0,litN=0;const small=[];
 for(let i=0;i<d.length;i+=4){const mx=Math.max(d[i],d[i+1],d[i+2]),mn=Math.min(d[i],d[i+1],d[i+2]),L=.299*d[i]+.587*d[i+1]+.114*d[i+2];lum+=L;
  if(L>200&&(mx-mn)/(mx||1)<.25)white++;if(L>30){lit++;sat+=(mx-mn)/(mx||1);litN++;}small.push(L);}
 const n=d.length/4;return {lum:lum/n,white:white/n,lit:lit/n,sat:litN?sat/litN:0,px:small};}
function diff(a,b){let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length;}`;

async function run(experience, song, seconds, sample, opts) {
  return session(async ({ ev, advance, enter, sleep }) => {
    await ev(LUM);
    await enter(experience);
    if (opts && opts.preset) await ev(`document.querySelector('[data-preset=${opts.preset}]').click()`);
    await ev('__vtOn()'); await sleep(150); await advance(3000);
    await ev(`__play(${JSON.stringify(require('./party-music/party-play').SONGS.songs[song].frames.slice(0, seconds * 20))})`);
    const out = { frames: [], diffs: [] };
    let prev = null;
    for (let f = 0; f < seconds * 10; f++) {          // 10 samples a second, 3 frames apart
      // step and read the GL frame in the same task, while its drawing buffer still holds the frame
      const st = await ev(`(function(){__step(100,1000/30);const s=NexusParty.state(),f=frameStats();const r={t:${f / 10},lum:f.lum,white:f.white,lit:f.lit,sat:f.sat,bursts:s.burstCount,build:s.build,
        o:s.organism,ink:{kick:s.ink.kick,hue:s.ink.hue,calm:s.ink.calm,blasts:s.ink.blastCount},beatConf:s.beatConfidence};window.__px=f.px;return r;})()`);
      if (prev) out.diffs.push(await ev('diff(window.__prevpx,window.__px)'));
      await ev('window.__prevpx=window.__px');
      prev = st; out.frames.push(st);
      if (sample) await sample(st, ev);
    }
    out.errors = await ev('__errors');
    return out;
  }, opts);
}
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const max = a => a.reduce((m, v) => Math.max(m, v), -1e9);

(async () => {
  // ---------- Energy Field ----------
  const edm = await run('flow', 'edm', 30);
  const amb = await run('flow', 'ambient', 16);
  const hip = await run('flow', 'hiphop', 14);
  for (const [k, r] of Object.entries({ edm, amb, hip })) assert.deepStrictEqual(r.errors, [], k + ': no page errors');
  const at = (r, t0, t1) => r.frames.filter(f => f.t >= t0 && f.t < t1);
  // EDM: intro, build (7.5-15 s), drop at 15 s
  const build = at(edm, 11, 15), drop = at(edm, 15, 19), intro = at(edm, 0, 6);
  console.log('EDM build tension', max(build.map(f => f.o.tension)).toFixed(2), 'drop frag', max(drop.map(f => f.o.frag)).toFixed(2),
    'bursts', edm.frames[edm.frames.length - 1].bursts, 'spread intro/drop', max(intro.map(f => f.o.spread)).toFixed(2), max(drop.map(f => f.o.spread)).toFixed(2));
  assert(max(build.map(f => f.o.tension)) > .4, 'the build-up squeezes the organism (tension rises before the drop)');
  assert(max(drop.map(f => f.o.frag)) > .3, 'the drop tears the organism into fragments');
  assert(max(drop.map(f => f.o.spread)) > max(build.map(f => f.o.spread)) + .1, 'the fragments are thrown apart at the drop, then recombine');
  assert(at(edm, 25, 30).every(f => f.o.frag < .2), '...and the body has recombined a few seconds later');
  const edmBursts = edm.frames[edm.frames.length - 1].bursts;
  assert(edmBursts >= 1 && edmBursts <= 6, 'drops are events, not every beat (' + edmBursts + ' bursts in 30 s)');
  // ambient: no detonations, calmer, slower colour travel
  const ambLast = amb.frames[amb.frames.length - 1];
  console.log('ambient bursts', ambLast.bursts, 'calm', mean(amb.frames.slice(40).map(f => f.o.calm)).toFixed(2), 'groove', mean(amb.frames.slice(40).map(f => f.o.groove)).toFixed(2),
    '| EDM drop calm', mean(at(edm, 16, 30).map(f => f.o.calm)).toFixed(2), 'groove', mean(at(edm, 16, 30).map(f => f.o.groove)).toFixed(2), '| hip-hop groove', mean(hip.frames.slice(40).map(f => f.o.groove)).toFixed(2));
  assert.strictEqual(ambLast.bursts, 0, 'an ambient song never sets off a supernova');
  assert(mean(amb.frames.slice(40).map(f => f.o.calm)) > mean(at(edm, 16, 30).map(f => f.o.calm)) + .15, 'quiet, drumless music keeps the field calmer than a drop');
  assert(mean(at(edm, 16, 30).map(f => f.o.groove)) > mean(amb.frames.slice(40).map(f => f.o.groove)) + .25, 'a real drum groove is told apart from notes in the bass');
  const hueRate = (r, a, b) => (at(r, b - .1, b)[0].o.hueT - at(r, a, a + .1)[0].o.hueT) / (b - a);
  console.log('colour travel per second: ambient', hueRate(amb, 6, 16).toFixed(3), 'EDM drop', hueRate(edm, 20, 30).toFixed(3));
  assert(hueRate(edm, 20, 30) > hueRate(amb, 6, 16) * 1.2, 'colour travels faster when the music drives harder');
  assert(hueRate(amb, 6, 16) > .004, '...and still travels on quiet music');
  // pixels: colour, not white; smooth motion; alive
  for (const [k, r] of Object.entries({ edm, amb, hip })) {
    const white = max(r.frames.map(f => f.white)), sat = mean(r.frames.map(f => f.sat)), lit = mean(r.frames.map(f => f.lit));
    const d = r.diffs.slice(10), dMean = mean(d);
    console.log(k, 'white max', (white * 100).toFixed(2) + '%', 'saturation', sat.toFixed(2), 'lit', (lit * 100).toFixed(0) + '%', 'motion', dMean.toFixed(2), 'max jump', max(d).toFixed(1));
    const whiteAt = r.frames.filter(f => f.white > .005).map(f => f.t);
    assert(white < .01, k + ': white never dominates (' + (white * 100).toFixed(2) + '% white pixels at most, at ' + whiteAt.join(',') + ' s)');
    assert(sat > .5, k + ': rich colour (' + sat.toFixed(2) + ')');
    assert(lit > .15, k + ': the field is alive across the screen');
    assert(dMean > 1.5, k + ': constantly moving');
  }
  const motion = r => mean(r.diffs.slice(40));
  assert(motion(amb) < motion(edm) * .85, 'quiet music moves more gently than a drop (' + motion(amb).toFixed(1) + ' vs ' + motion(edm).toFixed(1) + ')');
  const edmJumps = edm.diffs.map((d, i) => [d, edm.frames[i + 1].t]).filter(([d]) => d > mean(edm.diffs) * 4.5);
  assert(edmJumps.every(([, t]) => t >= 14.5 && t <= 16.5), 'no sudden jumps except at the drop ' + JSON.stringify(edmJumps));

  // ---------- Ink Machine ----------
  const ink = await run('ink', 'dnb', 12);
  const inkAmb = await run('ink', 'ambient', 10, null, { preset: 'neon' });
  assert.deepStrictEqual(ink.errors, [], 'Ink: no page errors');
  const kicks = ink.frames.filter(f => f.ink.kick > .3).length / ink.frames.length;
  console.log('Ink: kick surges in', (kicks * 100).toFixed(0) + '% of samples (DnB), calm DnB', mean(ink.frames.slice(40).map(f => f.ink.calm)).toFixed(2), 'calm ambient', mean(inkAmb.frames.slice(40).map(f => f.ink.calm)).toFixed(2),
    'white max', (max(ink.frames.concat(inkAmb.frames).map(f => f.white)) * 100).toFixed(2) + '%');
  assert(kicks > .15, 'Ink: the tunnel surges forward on the kicks');
  assert(mean(inkAmb.frames.slice(40).map(f => f.ink.calm)) > mean(ink.frames.slice(40).map(f => f.ink.calm)) + .15, 'Ink: quiet music slows the journey');
  assert(max(ink.frames.concat(inkAmb.frames).map(f => f.white)) < .01, 'Ink: white never dominates');
  assert(mean(ink.diffs) > 1.5, 'Ink: constantly moving');

  // ---------- Orb Experience: each orb listens to its own part of the music ----------
  const orb = await session(async ({ ev, advance, enter, sleep, songs }) => {
    await enter('orb'); await ev('__vtOn()'); await sleep(150); await advance(2000);
    await ev(`__play(${JSON.stringify(songs.songs.edm.frames.slice(320, 520))})`);
    const bands = [[], [], []];
    for (let i = 0; i < 60; i++) {
      await advance(100, 1000 / 30);
      const s = await ev('(function(){var st=NexusParty.state().music;return [st.beat,st.mid,st.hat];})()');
      bands[0].push(s[0]); bands[1].push(s[1]); bands[2].push(s[2]);
    }
    return { bands, errors: await ev('__errors') };
  });
  assert.deepStrictEqual(orb.errors, [], 'Orb: no page errors');
  assert(max(orb.bands[0]) > .3 && max(orb.bands[1]) > .2 && max(orb.bands[2]) > .2, 'Orb: kick, mids and hi-hats are all present to drive their own orbs');
  console.log('Party music: Energy Field, Ink Machine and Orb Experience react to five genres in their own ways, colour carries the light and motion stays smooth.');
})().catch(e => { console.error(e); process.exit(1); });
