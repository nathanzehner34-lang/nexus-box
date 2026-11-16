const fs=require('fs'); const win={}; new Function('window', fs.readFileSync(__dirname + '/../../app/src/main/assets/sayings.js','utf8'))(win);
const SAY=win.NEXUS_SAYINGS; SAY.qa.forEach(q=>q.rx=new RegExp(q.re));
const norm=t=>t.toLowerCase().replace(/[^a-z0-9' ]+/g,' ').replace(/\s+/g,' ').trim();
const hit=t=>{const n=norm(t);for(const q of SAY.qa) if(q.rx.test(n)) return q.id; return null;};
const should={"How's it going?":'howareyou',"Hello":'greet',"Tell me a joke":'joke',"Can you tell me a joke about trucks":'joke',"Thanks!":'thanks',"I'm tired.":'tired',"Who are you?":'whoareyou',"Talk to me":'talk',"I love you, Nexus":'compliment',"You suck":'insult',"good night":'bye'};
const shouldNot=["how far is it to Calgary","what's the weather tomorrow","hey can you play some AC/DC","help me find a gas station","I'm tired of this song, skip it","thanks for nothing, open spotify","who is the president","tell me about the history of trucks"];
let bad=0; for(const [t,id] of Object.entries(should)){const h=hit(t); if(h!==id){bad++;console.log('MISS',t,h);}}
for(const t of shouldNot){const h=hit(t); if(h){bad++;console.log('FALSE HIT',t,h);}}
console.log(bad?'FAILED '+bad:'small talk matching OK');
