// Run: node tools/voice-test/test.js  (simulates the Android recognizer with a fake clock; not part of the APK)
// Minimal fake clock + fake Android bridge to exercise the voice block.
const fs = require('fs');
function makeEnv() {
  let now = 0, tid = 0; const timers = new Map();
  const env = { log: [], prefs: {}, orb: new Set(), captions: [], calls: [], spoken: [] };
  env.setTimeout = (f, ms) => { const id = ++tid; timers.set(id, { at: now + (ms || 0), f }); return id; };
  env.clearTimeout = id => timers.delete(id);
  env.advance = ms => { const end = now + ms; for (;;) { let n = null; for (const [id, t] of timers) if (t.at <= end && (!n || t.at < n[1].at)) n = [id, t]; if (!n) break; timers.delete(n[0]); now = n[1].at; n[1].f(); } now = end; };
  env.now = () => now;
  env.A = {
    listenWith: (m, s, o) => env.calls.push(['listenWith', m, s]), listen: () => env.calls.push(['listen']),
    listenFocus: () => env.calls.push(['listenFocus']), listenDone: () => env.calls.push(['listenDone']),
    finishListening: () => env.calls.push(['finish']), stopListening: () => env.calls.push(['stop']),
    speakingNow: () => false,
  };
  const app = fs.readFileSync(__dirname + '/../../app/src/main/assets/app.js', 'utf8');
  const src = app.slice(app.indexOf('  // VOICE: listening, end-of-speech timing'), app.indexOf("  $('orbWrap').addEventListener('click', orbTap);"));
  const fn = new Function('env', `
    var setTimeout = env.setTimeout, clearTimeout = env.clearTimeout, Date = { now: env.now }, performance = { now: env.now };
    var A = env.A, Nexus = { speaking: false }, booting = false, orbBusy = false, P = { on: false }, awaySince = 0, window = {};
    var aiClock = { start: 0 };
    function pref(k) { return env.prefs[k] || ''; } function setPref(k, v) { env.prefs[k] = v; }
    function caption(t) { env.captions.push(t); } function setOrb(s, on) { if (on) env.orb.add(s); else env.orb.delete(s); }
    function chime() {} var orbEl = { style: {} }; function $() { return orbEl; }
    function holdMusic() { env.calls.push(['hold']); } function releaseMusic() { env.calls.push(['release']); }
    function stopTalking() { env.calls.push(['stopTalking']); }
    function say(t) { env.spoken.push(t); return Promise.resolve(); }
    var egoName = 'nexus', EGOS = { nexus: { intro: 'I am here.' } };
    function egoSaying() { env.savedPickCount = (env.savedPickCount || 0) + 1; return env.savedPhrase || 'Local saved Nexus line.'; }
    function sayLine(t) { env.spoken.push(t); return Promise.resolve(); }
    function clip(t) { return t; }
    function handleSpeech(t) { env.handled = t; if (env.onHandle) env.onHandle(t); return Promise.resolve(); }
    ${src}
    return { Nexus: Nexus, listen: listen, orbTap: orbTap, wakeSchedule: wakeSchedule, W: W, get LS() { return LS; }, setFollow: function(){ followUpOk = true; }, get orbBusy() { return orbBusy; } };`);
  env.api = fn(env);
  return env;
}
module.exports = makeEnv;
