const fs=require('fs'); const win={}; new Function('window', fs.readFileSync(__dirname + '/../../app/src/main/assets/sayings.js','utf8'))(win);
const SAY=win.NEXUS_SAYINGS; SAY.qa.forEach(q=>q.rx=new RegExp(q.re));
const norm=t=>t.toLowerCase().replace(/[^a-z0-9' ]+/g,' ').replace(/\s+/g,' ').trim();
const hit=t=>{const n=norm(t);for(const q of SAY.qa) if(q.rx.test(n)) return q.id; return null;};
const should={"How's it going?":'howareyou',"Hello":'greet',"Tell me a joke":'joke',"Can you tell me a joke about trucks":'joke',"Thanks!":'thanks',"I'm tired.":'tired',"Who are you?":'whoareyou',"Talk to me":'talk',"I love you, Nexus":'compliment',"You suck":'insult',"good night":'bye'};
const shouldNot=["how far is it to Calgary","what's the weather tomorrow","hey can you play some AC/DC","help me find a gas station","I'm tired of this song, skip it","thanks for nothing, open spotify","who is the president","tell me about the history of trucks"];
let bad=0; for(const [t,id] of Object.entries(should)){const h=hit(t); if(h!==id){bad++;console.log('MISS',t,h);}}
for(const t of shouldNot){const h=hit(t); if(h){bad++;console.log('FALSE HIT',t,h);}}
// Execute the app's real local matcher and Alter Ego switch phrase selector against the bundled sayings.
const app=fs.readFileSync(__dirname + '/../../app/src/main/assets/app.js','utf8');
const talkStart=app.indexOf('  function smallTalk(t) {'), talkEnd=app.indexOf('  function tod()',talkStart);
const switchStart=app.indexOf('  function egoSwitchPhrase(k) {'), switchEnd=app.indexOf('  function setEgo(k)',switchStart);
if(talkStart<0||talkEnd<0||switchStart<0||switchEnd<0) throw new Error('local response functions not found');
const talkSrc=app.slice(talkStart,talkEnd), switchSrc=app.slice(switchStart,switchEnd);
const egos=['nexus','king','ex','conspiracy','mob_boss','rogue','cult'];
const qa=id=>SAY.qa.find(q=>q.id===id);
for(const ego of egos){
  const recent=[];
  const freshPick=list=>{const options=list.filter(x=>!recent.includes(x));const chosen=(options.length?options:list)[0];recent.push(chosen);if(recent.length>12)recent.shift();return chosen;};
  const local=new Function('SAY','egoName','freshPick','egoSaying','EGOS',
    talkSrc+switchSrc+'return {smallTalk:smallTalk, switchPhrase:egoSwitchPhrase};'
  )(SAY,ego,freshPick,()=>freshPick(SAY.sayings[ego]),{[ego]:{intro:'Fallback intro'}});
  const cases=[
    ["Hey, how's it going?",qa('howareyou')],
    ["What's up?",qa('howareyou')],
    ["How are you doing?",qa('howareyou')],
    ["What are you up to?",qa('doing')],
    ["Are you there?",qa('greet')],
    ["Hey, are you there?",qa('greet')]
  ];
  for(const [question,row] of cases){
    const answer=local.smallTalk(question);
    if(!row||!row.a[ego]||!row.a[ego].includes(answer)) throw new Error(ego+' missed local answer: '+question+' => '+answer);
  }
  const first=local.switchPhrase(ego), second=local.switchPhrase(ego);
  if(!SAY.sayings[ego].includes(first)||!SAY.sayings[ego].includes(second)||first===second||first.length>110||second.length>110)
    throw new Error(ego+' switch phrases were not short, bundled, varied lines');
}
const localRoute=app.indexOf('var talk = smallTalk(t);');
const speechStart=app.indexOf('  function handleSpeech(raw) {'), speechEnd=app.indexOf('\n  // ------------------------------------------------------------------\n  // Tiles / actions',speechStart);
const speech=app.slice(speechStart,speechEnd);
if(localRoute<0||speechStart<0||speechEnd<speechStart||speech.includes('streamAnswer(')||!app.includes('return sayLine(line)'))
  throw new Error('ordinary local dialogue must use native TTS without an API call');
if(!app.includes('sayLine(egoSwitchPhrase(k) || EGOS[k].intro, true)'))
  throw new Error('Alter Ego selection must speak its local phrase through the native TTS wrapper');
console.log(bad?'FAILED '+bad:'small talk + local-first routing OK across all seven Alter Egos');
