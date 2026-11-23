// Party Mode premium upgrade: real app page at the box's 1024x600, synthetic music through the box's feeds.
// Checks the detailed music feed is switched on and off with Party Mode, the redesigned layout keeps the
// centre clear, controls fade when idle and return on touch, snare and hi-hat hits are picked up, every
// control still works, and exit closes Party Mode cleanly with no errors.
const assert = require('assert');
const { session } = require('./party-shots.js');

session(async ({ ev, sleep }) => {
  const S = () => ev('NexusParty.state()');
  await ev(`document.querySelector('[data-act=party]').click()`); await sleep(2500);
  let s = await S();
  assert(s.active, 'Party Mode starts from its home tile');
  const calls = await ev('__calls');
  assert(calls.some(c => c[0] === 'meterDetail' && c[1] === true), 'detailed (6-band) music feed requested on entry');
  assert(!calls.some(c => /mic|record/i.test(c[0])), 'no microphone request');

  // Layout: no control sits over the middle of the screen.
  const centreHits = await ev(`(()=>{const out=[];for(let x=362;x<=662;x+=30)for(let y=180;y<=400;y+=30){const e=document.elementFromPoint(x,y);if(e&&e.closest('#party button'))out.push(e.closest('button').textContent.trim());}return out;})()`);
  assert.strictEqual(centreHits.length, 0, 'centre of the screen is clear of buttons (' + centreHits.join(',') + ')');
  const rails = await ev(`(()=>{const r=s=>{const e=document.querySelector('#party '+s);const b=e.getBoundingClientRect();return{l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height};};return{exp:r('[data-experience=orb]'),bg:r('[data-backdrop=classic]'),mode:r('[data-mode=pulse]')};})()`);
  assert(rails.exp.r < 260, 'experiences on the left rail');
  assert(rails.bg.l > 760, 'backgrounds on the right rail');
  assert(rails.mode.t > 400, 'modes along the bottom');

  // Music: kicks, snares and hats.
  await ev(`__music.on=true;__music.o={bpm:124,kick:1,snare:.9,hat:.8,pad:.3}`); await sleep(5000);
  s = await S();
  assert(s.music.detail, 'six-band detail feed is live');
  assert(s.music.snareHits >= 3, 'snare hits picked up (' + s.music.snareHits + ')');
  assert(s.music.hatHits >= 3, 'hi-hat hits picked up (' + s.music.hatHits + ')');
  assert(s.music.bass > .05 && s.music.energy > .05, 'bass and energy follow the music');

  // Idle fade and wake.
  await sleep(6800);
  assert(await ev(`document.getElementById('party').classList.contains('party-idle')`), 'controls fade after 6 s untouched');
  const faded = await ev(`+getComputedStyle(document.querySelector('#party [data-mode=pulse]').closest('.party-modes')||document.querySelector('#party [data-mode=pulse]')).opacity`);
  await ev(`document.getElementById('party').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:500,clientY:300}))`);
  assert(!(await ev(`document.getElementById('party').classList.contains('party-idle')`)), 'a touch brings the controls back');
  assert(faded < .9, 'idle controls actually faded (' + faded + ')');

  // Every control.
  for (const m of ['wave', 'vortex', 'chaos', 'ripple', 'pulse']) {
    await ev(`document.querySelector('#party [data-mode=${m}]').click()`); await sleep(250);
    assert(await ev(`document.querySelector('#party [data-mode=${m}]').classList.contains('active')`), 'mode ' + m);
  }
  for (const b of ['smoke', 'aurora', 'deep', 'iridescent', 'classic']) {
    await ev(`document.querySelector('#party [data-backdrop=${b}]').click()`); await sleep(300);
    assert.strictEqual((await S()).backdrop, b, 'background ' + b);
  }
  for (const p of ['neon', 'voltage', 'aurora', 'orb']) {
    await ev(`document.querySelector('#party [data-preset=${p}]').click()`); await sleep(200);
    assert.strictEqual(await ev(`document.getElementById('party').getAttribute('data-preset')`), p, 'preset ' + p);
  }
  for (const x of ['flow', 'ink', 'orb']) {
    await ev(`document.querySelector('#party [data-experience=${x}]').click()`); await sleep(1200);
    assert.strictEqual((await S()).experience, x, 'experience ' + x);
  }
  await ev(`document.querySelector('#party [data-experience=flow]').click()`); await sleep(1500);
  const before = (await S()).burstCount;
  await ev(`document.getElementById('partyBass').click()`); await sleep(400);
  assert((await S()).burstCount > before, 'bass cannon fires a burst');
  const snd = await ev(`document.getElementById('partySound').getAttribute('aria-pressed')`);
  await ev(`document.getElementById('partySound').click()`);
  assert.notStrictEqual(await ev(`document.getElementById('partySound').getAttribute('aria-pressed')`), snd, 'sound FX toggles');
  await ev(`document.getElementById('partySound').click()`);
  for (const f of ['prev', 'toggle', 'next']) await ev(`document.querySelector('#party [data-fx=${f}]').click()`);

  // Exit.
  await ev(`__music.on=false;document.querySelector('#party [data-fx=exit]').click()`); await sleep(1200);
  s = await S();
  assert(!s.active, 'exit leaves Party Mode');
  const after = await ev('__calls');
  assert(after.some(c => c[0] === 'meterDetail' && c[1] === false), 'detailed feed switched off on exit');
  const errors = await ev('__errors');
  assert.strictEqual(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  console.log('Party premium: layout rails, idle fade/wake, snare+hat detail, all modes/backgrounds/presets/experiences, bass cannon, sound, transport and exit verified in the real app page.');
}).catch(e => { console.error(e); process.exit(1); });
