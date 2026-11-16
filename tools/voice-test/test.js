const makeEnv = require('./harness'); const assert = require('assert');
const tick = () => new Promise(r => setImmediate(r));
async function t1() { // pause inside sentence must not cut off; recognizer stops early -> continuation joins text
  const e = makeEnv(); let out; e.api.listen().then(r => out = r);
  assert.deepStrictEqual(e.calls.at(-1), ['listenWith', 'cmd', 2000]);
  e.api.Nexus._listening(true); e.api.Nexus._partial('turn on the'); e.advance(700);
  e.api.Nexus._heard('turn on the');           // Android stopped after ~0.7 s of silence
  assert.deepStrictEqual(e.calls.at(-1), ['listenWith', 'cmd', 2000], 'restarted');
  e.advance(1000); e.api.Nexus._partial('night drive'); // user resumes 1.7 s after last words
  e.advance(1900); assert.strictEqual(out, undefined, 'still waiting within 2 s pause');
  e.advance(200); assert.deepStrictEqual(e.calls.at(-1), ['finish']); e.advance(900); await tick();
  assert.strictEqual(out, 'turn on the night drive'); assert(e.calls.some(c => c[0] === 'listenDone'));
  console.log('ok 1 pause/continuation', out);
}
async function t2() { // every partial resets timer; setting 3 s
  const e = makeEnv(); e.prefs.silence_s = '3'; let out; e.api.listen().then(r => out = r);
  for (let i = 0; i < 5; i++) { e.api.Nexus._partial('word'.repeat(i + 1)); e.advance(2500); }
  assert.strictEqual(out, undefined); e.advance(600); e.advance(900); await tick(); assert.ok(out); console.log('ok 2 3s setting, partials reset');
}
async function t3() { // invalid setting falls back to 2 s; nothing said -> error 6 after 5 s
  const e = makeEnv(); e.prefs.silence_s = '9'; let out; e.api.listen().then(r => out = r);
  assert.strictEqual(e.calls.at(-1)[2], 2000); e.advance(5000); await tick(); assert.deepStrictEqual(out, { error: '6' }); console.log('ok 3 fallback + no speech');
}
async function t4() { // wake: partial "hey nexus what time is it" -> promoted, command delivered without the phrase
  const e = makeEnv(); e.prefs.wake = '1'; e.advance(5000); e.api.wakeSchedule(0); e.advance(1);
  assert.deepStrictEqual(e.calls.at(-1), ['listenWith', 'wake', 900]); assert(e.orb.has('wake'));
  e.api.Nexus._wakePartial('play some music'); assert(e.api.W.on, 'ignored non-wake speech');
  e.api.Nexus._wakePartial('hey Nexus what time');
  assert(e.calls.some(c => c[0] === 'listenFocus')); assert(e.orb.has('listening'));
  e.api.Nexus._partial('hey Nexus what time is it'); e.advance(2000); e.advance(900); await tick(); await tick();
  assert.strictEqual(e.handled, 'what time is it'); console.log('ok 4 wake + command', e.handled);
}
async function t5() { // wake final "hey nexus" alone, then command after a pause
  const e = makeEnv(); e.prefs.wake = '1'; e.advance(5000); e.api.wakeSchedule(0); e.advance(1600);
  e.api.Nexus._wakeResult('hey nexus');
  assert.deepStrictEqual(e.calls.at(-1), ['listenWith', 'cmd', 2000], 'keeps listening for the command');
  e.advance(1500); e.api.Nexus._partial('tell me a joke'); e.advance(2000); e.advance(900); await tick(); await tick();
  assert.strictEqual(e.handled, 'tell me a joke'); console.log('ok 5 wake then command');
}
async function t6() { // wake failure backoff, permission disables
  const e = makeEnv(); e.prefs.wake = '1'; e.advance(5000); e.api.wakeSchedule(0); e.advance(1);
  e.api.Nexus._wakeError('5'); const n = e.calls.length; e.advance(1999); assert.strictEqual(e.calls.length, n, 'backs off');
  e.advance(1); assert.deepStrictEqual(e.calls.at(-1)[1], 'wake');
  e.api.Nexus._wakeError('9'); assert.strictEqual(e.prefs.wake, '0'); e.advance(60000);
  assert.strictEqual(e.calls.filter(c => c[1] === 'wake').length, 2, 'stopped after permission error'); console.log('ok 6 backoff/permission');
}
async function t7() { // wake not armed while Nexus speaking; nothing echoes
  const e = makeEnv(); e.prefs.wake = '1'; e.advance(5000); e.api.Nexus.speaking = true; e.api.wakeSchedule(0); e.advance(10000);
  assert(!e.calls.some(c => c[1] === 'wake')); e.api.Nexus.speaking = false; e.advance(2100); assert(e.calls.some(c => c[1] === 'wake'));
  console.log('ok 7 no wake while speaking');
}
async function t8() { // follow-up window: quiet mic (no music pause), 25 s, then closes
  const e = makeEnv(); e.onHandle = () => e.api.setFollow(); e.api.orbTap();
  e.api.Nexus._partial('how far is the moon'); e.advance(2000); e.advance(900); await tick(); await tick(); await tick();
  e.advance(700); assert.deepStrictEqual(e.calls.at(-1), ['listenWith', 'quiet', 2000]); assert(e.orb.has('followup'));
  const holdsBefore = e.calls.filter(c => c[0] === 'hold').length;
  e.api.Nexus._heardError('6'); e.advance(5000); // recognizer gave up after 5 s -> restarted quietly
  assert.deepStrictEqual(e.calls.at(-1), ['listenWith', 'quiet', 2000]);
  e.advance(21000); await tick(); assert(!e.orb.has('listening'), 'closed after 25 s');
  assert.strictEqual(e.calls.filter(c => c[0] === 'hold').length, holdsBefore, 'music not held in follow-up');
  assert(!e.calls.some((c, i) => c[0] === 'listenFocus')); console.log('ok 8 follow-up window');
}
async function t9() { // tap while speaking interrupts and listens
  const e = makeEnv(); e.api.Nexus.speaking = true; e.api.orbTap();
  assert(e.calls.some(c => c[0] === 'stopTalking')); assert.deepStrictEqual(e.calls.at(-1), ['listenWith', 'cmd', 2000]); console.log('ok 9 tap interrupts');
}
async function t10() { // loop guard: recognizer erroring instantly in follow-up can't spin forever
  const e = makeEnv(); let out; const p = e.api.listen().then(r => out = r);
  for (let i = 0; i < 40; i++) { e.api.Nexus._heardError('7'); e.advance(50); }
  await tick(); assert.ok(out && out.error); assert(e.calls.filter(c => c[0] === 'listenWith').length <= 14); console.log('ok 10 loop guard');
}
(async () => { for (const t of [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10]) await t(); console.log('ALL PASSED'); })().catch(e => { console.error('FAIL', e); process.exit(1); });
