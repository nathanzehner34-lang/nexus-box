const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const base = __dirname + '/../../app/src/main/assets/';
const moduleText = fs.readFileSync(base + 'conversation.js', 'utf8');
const appText = fs.readFileSync(base + 'app.js', 'utf8');
const context = { window: {}, Math: Object.create(Math) };
context.Math.random = () => 0;
vm.runInNewContext(moduleText, context, { filename: 'conversation.js' });
const engine = context.window.NEXUS_LOCAL_CONVERSATION;
assert(engine, 'conversation module is loaded and exported');

const egos = ['nexus', 'king', 'ex', 'conspiracy', 'mob_boss', 'rogue', 'cult'];
assert.deepStrictEqual(Object.keys(engine.dialogue).sort(), egos.slice().sort());
for (const ego of egos) {
  const lines = engine.dialogue[ego];
  for (const category of ['greeting','introduction','casual','status','happening','joke','sarcasm','compliment','agree','disagree','encourage','frustrated','goodbye','followup','observation','repeat','clarify','trip','there','vehicleFollowup','time','empathy']) {
    assert(lines[category] && lines[category].length >= 2, ego + ' has rotating ' + category + ' dialogue');
  }
  const first = engine.respond('hello', ego);
  const second = engine.respond('hey', ego);
  assert.notStrictEqual(first, second, ego + ' rotates repeated greetings');
}
const greetings = egos.map(ego => engine.dialogue[ego].greeting[0]);
assert.strictEqual(new Set(greetings).size, egos.length, 'each personality has a distinct greeting');
assert(engine.respond('Who are you?', 'rogue').includes('Rogue AI'), 'introductions answer locally in character');
const factFirst = engine.respond('What is the capital of Canada?', 'king');
const factRepeat = engine.respond('What is the capital of Canada?', 'king');
assert(factFirst.includes('Ottawa') && factRepeat.includes('Ottawa') && factRepeat !== factFirst, 'repeated factual questions retain the answer with varied phrasing');

const routedSamples = [
  ['What is new?', 'casual'],
  ['Yeah right', 'sarcasm'],
  ['I feel overwhelmed', 'empathy'],
  ["I don't think so", 'disagree'],
  ['Sounds good', 'agree'],
  ['Tell me a joke', 'joke'],
  ['I feel frustrated', 'frustrated'],
  ['Good evening', 'time']
];
for (const ego of egos) {
  for (const [utterance, category] of routedSamples) {
    const answer = engine.respond(utterance, ego);
    assert(answer && (category === 'time' ? answer.toLowerCase().includes('evening') : engine.dialogue[ego][category].some(line => answer.includes(line))), ego + ' routes ' + utterance + ' to distinct ' + category + ' dialogue');
  }
}

const knowledgeCases = [
  ['What is the capital city of Canada?', 'Ottawa'],
  ['Which province is Kelowna in?', 'British Columbia'],
  ['When did the Berlin Wall fall?', '1989'],
  ['What chemical is water made of?', 'H2O'],
  ['What does RAM do?', 'temporary working memory'],
  ['How can I clear temporary app files on Android?', 'Clear cache'],
  ['What are the four engine strokes?', 'intake, compression, power, and exhaust'],
  ['Where can I find my tyre pressure?', 'door placard'],
  ['What temperature should chicken reach inside?', '74°C'],
  ['How many tsp are in a tablespoon?', 'Three teaspoons'],
  ['What is 7 times 8?', '56.'],
  ['Convert 10 km to miles', '6.21 miles']
];
for (const [question, expected] of knowledgeCases) {
  const answer = engine.knowledgeAnswer(question);
  assert(answer && answer.toLowerCase().includes(expected.toLowerCase()), question + ' gets offline answer (got ' + answer + ')');
}
assert.strictEqual(engine.knowledgeAnswer('What was the exact temperature in Kelowna yesterday?'), null, 'unsupported factual questions are not fabricated');
const history = [{role:'user', parts:[{text:"I'm going to Kelowna."}]},{role:'model',parts:[{text:'Have a good trip.'}]}];
assert(engine.contextualReply('What should I do there?', 'king', {history}).includes('Kelowna'), 'there resolves from local conversation history');
const vehicleMemories = [{category:'vehicle', value:'GMC Sierra', text:'My truck is a GMC Sierra.'}];
const engineFollowup = engine.contextualReply('What engine does it have?', 'mob_boss', {memories:vehicleMemories});
assert(engineFollowup && engineFollowup.includes('year'), 'vehicle context asks for the missing year rather than guessing');
assert(engine.dialogue.mob_boss.vehicleFollowup.some(x => x.includes('boss')), 'follow-up uses the selected personality voice');

const handlerStart = appText.indexOf('  function handleSpeech(raw) {');
const handlerEnd = appText.indexOf('\n  // ------------------------------------------------------------------\n  // Tiles / actions', handlerStart);
assert(handlerStart >= 0 && handlerEnd > handlerStart, 'speech handler found');
const handler = appText.slice(handlerStart, handlerEnd);
assert(!handler.includes('streamAnswer('), 'normal speech handler never calls the AI stream');
assert(handler.includes('localMemoryTurn(t, raw)'), 'existing local memory capture/retrieval is retained');
assert(handler.indexOf('localMemoryTurn(t, raw)') < handler.indexOf('contextualReply('), 'memory is checked before conversation context');
assert(handler.includes('engine.respond(t, egoName'), 'local personality dialogue and knowledge engine is called');
const speakStart = appText.indexOf('  function speakLocalConversation(userText, responseText) {');
assert(speakStart >= 0 && appText.slice(speakStart, handlerStart).includes('return sayLine(line)'), 'local answers use the selected Alter Ego native TTS route');
assert(handler.includes('engine.clarify(egoName)'), 'unknown requests get a local clarification');
assert(appText.includes('function saveChatHistory() { setPref(\'chat_history\', JSON.stringify(chatHistory.slice(-12))); }'), 'existing 12-turn persistent conversation history remains in use');

console.log('Nexus 25 local conversation tests passed: 7 distinct egos, rotating dialogue, offline knowledge, continuity, memory-first routing, TTS, and no AI calls in ordinary speech.');
