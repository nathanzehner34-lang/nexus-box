const fs = require('fs');
const assert = require('assert');
const app = fs.readFileSync(__dirname + '/../../app/src/main/assets/app.js', 'utf8');
const android = fs.readFileSync(__dirname + '/../../app/src/main/java/com/nexus/box/MainActivity.java', 'utf8');
const start = app.indexOf('  function loadChatHistory()');
const end = app.indexOf('  var PREFACE_LINES = {', start);
assert(start >= 0 && end > start, 'existing memory block is present');
const memoryCode = app.slice(start, end);
function makeMemoryApi(prefs) {
  const factory = new Function('pref', 'setPref', memoryCode + `
    return {
      memories: memories, remember: remember, capturePersonalFact: capturePersonalFact,
      correctMemory: correctMemory, forgetMemory: forgetMemory, recallMemory: recallMemory,
      localMemoryTurn: localMemoryTurn, saveChatHistory: saveChatHistory,
      getChatHistory: function(){ return chatHistory; },
      setChatHistory: function(value){ chatHistory = value; }
    };
  `);
  return factory(k => prefs[k] || '', (k, v) => { prefs[k] = v; });
}
const prefs = {};
let memory = makeMemoryApi(prefs);
const saved = memory.capturePersonalFact('My truck is a GMC Sierra.');
assert(saved && saved.category === 'vehicle' && saved.subject === 'truck' && saved.value === 'GMC Sierra');
assert.strictEqual(memory.memories().length, 1);
memory.capturePersonalFact('I drive a GMC Sierra.');
assert.strictEqual(memory.memories().length, 1, 'equivalent wording must not duplicate the primary vehicle');

// Recreate the memory API over the same SharedPreferences-like store to simulate app restart.
memory = makeMemoryApi(prefs);
assert.strictEqual(memory.memories().length, 1, 'saved fact survives reinitialization');
const wordings = [
  'What truck do I drive?',
  'Which vehicle do I own?',
  'Do you remember my truck?',
  'What kind of GMC do I have?',
  'Hey, what truck do I drive?',
  'What kind do I have?',
  'What model is it?'
];
for (const question of wordings) {
  const turn = memory.localMemoryTurn(question, question);
  assert.deepStrictEqual(turn, { kind: 'recalled', text: 'You drive a GMC Sierra.' }, question);
}

// The same preference store is independent of active Alter Ego and is local-only.
for (const ego of ['nexus','king','ex','conspiracy','mob_boss','rogue','cult']) {
  assert.strictEqual(memory.recallMemory('What truck do I drive?').text, 'You drive a GMC Sierra.', ego);
}
const correction = memory.correctMemory('truck', 'My truck is a Chevy Silverado.');
assert.strictEqual(correction, true);
assert.strictEqual(memory.memories().length, 1, 'correction updates the existing subject');
assert.strictEqual(memory.recallMemory('What truck do I drive?').text, 'You drive a Chevy Silverado.');
assert.strictEqual(memory.correctMemory('truck', 'GMC Sierra'), true, 'short correction retains its existing subject');
assert.strictEqual(memory.recallMemory('What kind of GMC do I have?').text, 'You drive a GMC Sierra.');
assert.strictEqual(memory.forgetMemory('truck'), true);
assert.strictEqual(memory.memories().length, 0);
assert.strictEqual(memory.recallMemory('What truck do I drive?'), null);

// Durable fact patterns are captured; temporary plans and casual remarks are not.
assert.strictEqual(memory.capturePersonalFact("I'm going to Kelowna tomorrow."), null);
assert.strictEqual(memory.capturePersonalFact('I like this song.'), null);
assert(memory.capturePersonalFact('I live in Kelowna.'));
assert.strictEqual(memory.localMemoryTurn('Where do I live?', 'Where do I live?').text, 'You live in Kelowna.');

// Existing 12-turn history remains saved and loadable from the same local preference store.
const history = Array.from({length: 14}, (_, i) => ({role: i % 2 ? 'model' : 'user', parts:[{text:'turn '+i}]}));
memory.setChatHistory(history);
memory.saveChatHistory();
memory = makeMemoryApi(prefs);
assert.strictEqual(memory.getChatHistory().length, 12);
assert.strictEqual(memory.getChatHistory()[0].parts[0].text, 'turn 2');
for (let i = 0; i < 45; i++) memory.remember('Saved fact number ' + i);
assert.strictEqual(memory.memories().length, 40, 'existing 40-fact capacity is preserved');

// Verify the production handler takes local save/recall through native TTS before the API route.
const localRoute = app.indexOf('var localMemory = localMemoryTurn(t, raw);');
const apiRoute = app.indexOf('streamAnswer(chatHistory, ctx');
assert(localRoute >= 0 && apiRoute > localRoute);
assert(app.slice(localRoute, apiRoute).includes('return sayLine(localMemory.text)'));
assert(android.includes('public void speakPersonaLine('), 'sayLine uses the Android TTS bridge');
const localStart = memoryCode.indexOf('function localMemoryTurn(');
assert(localStart >= 0 && !/askAI|streamAnswer|http\(/.test(memoryCode.slice(localStart)), 'local memory turn makes no network/API call');
assert(android.includes('prefs.getString("p_" + key') && android.includes('prefs.edit().putString("p_" + key'), 'memory preferences use Android SharedPreferences');
console.log('memory functional tests passed: local capture, recall variants, corrections, forget, restart, shared egos, and history');
