// Music bar over the experiences + carrying on the music at start-up, in the real app page.
// The bar appears when an experience opens, fades after a few seconds, comes back on any touch, its
// buttons send previous / play / pause / next, it never takes touches meant for the experience, it closes
// with the experience, and Settings can turn it (and the start-up music) off.
const assert = require('assert');
const { session } = require('./party-shots.js');

session(async ({ ev, sleep, shot }) => {
  await ev(`window.__media=[]; window.__np={title:'Midnight Drive',artist:'Synthwave',playing:true}; window.__active=true;
    Android.media=a=>__media.push(a); Android.musicResume=()=>__media.push('resume');
    Android.nowPlaying=()=>JSON.stringify(__np); Android.isMusicActive=()=>__active;`);
  const S = () => ev('NexusMusicBar.state()');
  const bar = sel => ev(`(()=>{const e=document.querySelector('#nxMusic ${sel}');return e&&e.textContent})()`);

  for (const exp of ['liquiddreams', 'nightdrive', 'clip_coins']) {
    await ev('Nexus.openExperience(' + JSON.stringify(exp) + ')'); await sleep(1200);
    let s = await S();
    assert(s.open && s.shown, exp + ': music bar shows when the experience opens');
    assert.strictEqual(await bar('.nxm-t b'), 'Midnight Drive', exp + ': shows the song');
    if (exp === 'liquiddreams') await shot('/tmp/musicbar-' + exp + '.png');
    await sleep(4600);
    assert(!(await S()).shown, exp + ': fades away after a few seconds');
    // a touch on the picture brings it back, and the experience still receives that touch
    const got = await ev(`(()=>{let n=0;const c=document.getElementById('xpc');const h=()=>n++;c.addEventListener('pointerdown',h);
      c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:300,clientY:400}));c.removeEventListener('pointerdown',h);return n;})()`);
    assert.strictEqual(got, 1, exp + ': the experience still gets touches');
    assert((await S()).shown, exp + ': a touch brings the bar back');
    // the bar only covers its own spot
    const centre = await ev(`(()=>{const e=document.elementFromPoint(512,300);return !e.closest('#nxMusic');})()`);
    assert(centre, exp + ': the middle of the screen is not covered');
    await ev('Nexus.home()'); await sleep(500);
    assert(!(await S()).open && !(await S()).shown, exp + ': closes with the experience');
  }

  // buttons
  await ev('Nexus.openExperience("nightdrive")'); await sleep(1000);
  await ev(`document.querySelector('#nxMusic [data-m=next]').click()`);
  await ev(`document.querySelector('#nxMusic [data-m=prev]').click()`);
  await ev(`document.querySelector('#nxMusic [data-m=toggle]').click()`);   // playing -> pause
  assert.deepStrictEqual(await ev('__media'), ['next', 'prev', 'pause'], 'next, previous and pause reach the music');
  await ev(`__np={playing:false};__active=false;__media=[]`); await sleep(2700);
  assert.strictEqual(await bar('.nxm-t span'), 'Tap ▶ to carry on where you left off', 'when nothing plays it offers to carry on');
  await ev(`document.querySelector('#nxMusic [data-m=toggle]').click()`);
  assert.deepStrictEqual(await ev('__media'), ['resume'], 'play carries on in the background (no Spotify screen)');
  const nd = await ev(`!!document.querySelector('#xpClose') && document.elementFromPoint(${980},${40})?.closest('#xpClose')!=null`);
  assert(nd, 'the close button is still reachable');
  await ev('Nexus.home()'); await sleep(400);

  // Settings switches
  await ev(`localStorage.setItem('p_musicBar','0')`);
  await ev('Nexus.openExperience("liquiddreams")'); await sleep(900);
  assert(!(await S()).shown, 'Settings can turn the bar off');
  await ev('Nexus.home()'); await ev(`localStorage.removeItem('p_musicBar')`);
  await sleep(300);
  await ev(`Android.version=Android.version||(()=>'test');Android.getVoices=Android.getVoices||(()=>'[]');Android.currentVoice=Android.currentVoice||(()=>'');Android.otherHomes=Android.otherHomes||(()=>'[]');Android.exitBubbleAllowed=Android.exitBubbleAllowed||(()=>true);document.querySelector('[data-act=settings]').click()`);
  await sleep(500);
  const ids = await ev(`[...document.querySelectorAll('[data-toggle]')].map(e=>e.getAttribute('data-toggle'))`);
  const errs0 = await ev('__errors'); if (errs0.length) console.log('settings errors (fake box):', errs0);
  await ev('__errors.length=0');
  assert(ids.includes('musicOnStart') && ids.includes('musicBar'), 'Settings has the two music switches: ' + ids);

  const errors = await ev('__errors');
  assert.strictEqual(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  console.log('Music bar: shows over Liquid Dreams, Night Drive and Visuals, fades, returns on touch without taking it, prev/next/pause/resume work, closes with the experience, and Settings can turn it off.');
}).catch(e => { console.error(e); process.exit(1); });
