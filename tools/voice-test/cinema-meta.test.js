// Nexus Cinema movie information (TMDB) in the real app page, with the box simulated: a saved-information store
// that lives on across restarts (like the box's database), a fake TMDB that is online or offline, and the drive.
//  1 the library is built offline first and lists what still needs information   2 going online downloads it
//  3 similar titles (Alien / Aliens, The Thing 1982) each get their own information   4 posters, backgrounds,
//  descriptions, genres, runtimes; shows with season and episode names, descriptions and stills
//  5 an uncertain title asks which one it is, and the choice is used   6 restarting the app (and the box) with no
//  internet: everything still shows   7 the drive unplugged: still browsable, play refused   8 replugged: plays
//  9 a new film: only that one is downloaded, no duplicates   10 genre filter and search by genre
// The box side (CinemaMeta.java: TMDB requests, SQLite, artwork files) is checked separately: the matching rules by
// tools/cinema-test/MatchTest.java, the rest needs the real box (see the README notes in the commit).
const assert = require('assert');
const { session } = require('./party-shots.js');

const ENTRIES = (() => {
  const e = [], add = (rel, size) => e.push({ rel, name: rel.split('/').pop(), size: size || 1.8e9, mtime: 1.79e12 + e.length * 1000 });
  ['Alien (1979)', 'Aliens (1986)', 'The Thing (1982)', 'Blade Runner (1982)', 'Up (2009)', 'Crash'].forEach(f => add('Movies/' + f + '/' + f + '.mkv'));
  for (let s = 1; s <= 2; s++) for (let i = 1; i <= 3; i++) add('TV/Breaking Bad/Season ' + s + '/Breaking Bad - S0' + s + 'E0' + i + '.mkv', 9e8);
  return e;
})();

// what TMDB "knows" in this test, by key (the box works out the right match; the page only sends keys)
const CATALOG = {
  'm|alien|1979': { id: 348, title: 'Alien', year: 1979, genres: ['Horror', 'Science Fiction'], runtime: 117, overview: 'The crew of the Nostromo answers a distress call.', rating: 8.2 },
  'm|aliens|1986': { id: 679, title: 'Aliens', year: 1986, genres: ['Action', 'Science Fiction'], runtime: 137, overview: 'Ripley returns to LV-426.' },
  'm|thing|1982': { id: 1091, title: 'The Thing', year: 1982, genres: ['Horror', 'Mystery'], runtime: 109, overview: 'Antarctic researchers meet a shape-shifter.' },
  'm|blade runner|1982': { id: 78, title: 'Blade Runner', year: 1982, genres: ['Science Fiction', 'Drama'], runtime: 117, overview: 'A blade runner hunts replicants.' },
  'm|up|2009': { id: 14160, title: 'Up', year: 2009, genres: ['Animation', 'Family'], runtime: 96, overview: 'A balloon-powered house.' },
  'm|brand new film|2026': { id: 999, title: 'Brand New Film', year: 2026, genres: ['Drama'], runtime: 100, overview: 'Fresh.' },
  't|breaking bad|0': { id: 1396, title: 'Breaking Bad', year: 2008, genres: ['Drama', 'Crime'], overview: 'A chemistry teacher turns to crime.', tv: true }
};
const UNCERTAIN = { 'm|crash|0': [{ id: 1640, title: 'Crash', year: 2004, overview: 'Los Angeles lives collide.' }, { id: 884, title: 'Crash', year: 1996, overview: 'Car-crash fetishists.' }] };

const BOX = `
window.__cin = { drives: [], libs: {}, progress: {}, plays: [], entries: ${JSON.stringify(ENTRIES)} };
window.__tmdb = { online: false, requests: [], cat: ${JSON.stringify(CATALOG)}, unc: ${JSON.stringify(UNCERTAIN)} };
// the box's database: kept in localStorage so it survives a page reload, like the SQLite file survives a restart
const DB = () => JSON.parse(localStorage.getItem('fakeMetaDb') || '{}'), SAVE = d => localStorage.setItem('fakeMetaDb', JSON.stringify(d));
const LIBS = () => JSON.parse(localStorage.getItem('fakeLibs') || '{}');
__cin.libs = LIBS();
Android.cinemaDrives = () => JSON.stringify(__cin.drives);
Android.cinemaLibrary = () => JSON.stringify(Object.values(__cin.libs));
Android.cinemaProgress = () => JSON.stringify(__cin.progress);
Android.cinemaInfo = () => {};
Android.cinemaGrant = () => {};
Android.cinemaScan = (u) => {
  const d = __cin.drives.find(x => x.uuid === u); if (!d || !d.mounted) return;
  const prev = __cin.libs[u], before = new Set(prev ? prev.entries.map(e => e.rel) : []);
  __cin.libs[u] = { uuid: u, label: 'Movie Drive', scannedAt: Date.now(), entries: __cin.entries.slice() };
  localStorage.setItem('fakeLibs', JSON.stringify(__cin.libs));
  d.scannedThisConnection = true;
  setTimeout(() => NexusCinema._scanned(JSON.stringify({ uuid: u, videos: __cin.entries.length, added: __cin.entries.filter(e => !before.has(e.rel)).length, removed: 0, first: !prev })), 30);
};
Android.cinemaPlay = (u, r, title, start) => { const d = __cin.drives.find(x => x.uuid === u); if (!d || !d.mounted) return false; __cin.plays.push({ u, r, title, start }); return true; };
Android.cinemaMeta = () => JSON.stringify(DB());
Android.cinemaMetaStatus = () => { const d = DB(), c = {}; Object.values(d).forEach(r => c[r.status] = (c[r.status] || 0) + 1); return JSON.stringify({ configured: true, online: __tmdb.online, counts: c }); };
Android.cinemaMetaWant = (j) => {
  const d = DB(); __tmdb.wants = (__tmdb.wants || 0) + 1;
  JSON.parse(j).forEach(w => { if (!d[w.key]) d[w.key] = { key: w.key, kind: w.kind, status: 'pending', title: w.title, year: w.year, seasons: w.seasons || [] };
    else if (w.seasons) w.seasons.forEach(s => { if (d[w.key].seasons.indexOf(s) < 0) d[w.key].seasons.push(s); }); });
  SAVE(d); __work();
};
Android.cinemaMetaChoose = (key, id) => { const d = DB(); d[key].manual = true; if (+id) { d[key].status = 'pending'; d[key].tmdb = +id; } else { d[key].status = 'none'; } SAVE(d); __work(); setTimeout(() => NexusCinema._meta(JSON.stringify({ [key]: DB()[key] })), 20); };
Android.cinemaMetaSearch = () => {};
Android.cinemaMetaRetry = () => __work();
Android.cinemaMetaKey = () => {};
// the "worker": downloads only titles that still need it, only while online
window.__work = () => {
  if (!__tmdb.online) return;
  const d = DB(), done = {};
  Object.values(d).forEach(r => {
    if (r.status !== 'pending') return;
    __tmdb.requests.push(r.key);
    let c = __tmdb.cat[r.key];
    if (r.tmdb) c = { id: r.tmdb, title: 'Crash', year: r.tmdb === 1640 ? 2004 : 1996, genres: ['Drama'], overview: 'Chosen by hand.' };
    if (!c && __tmdb.unc[r.key]) { r.status = 'uncertain'; r.cands = __tmdb.unc[r.key]; done[r.key] = r; return; }
    if (!c) { r.status = 'none'; done[r.key] = r; return; }
    const pre = (c.tv ? 't' : 'm') + c.id, data = Object.assign({}, c, { poster: pre + '_p.jpg', posterSmall: pre + '_ps.jpg', backdrop: pre + '_b.jpg' });
    if (c.tv) { data.seasons = {}; r.seasons.forEach(s => { const eps = {}; for (let i = 1; i <= 3; i++) eps[i] = { name: 'Episode name ' + s + '-' + i, overview: 'What happens in ' + s + '-' + i + '.', still: pre + '_s' + s + 'e' + i + '.jpg', runtime: 47 }; data.seasons[s] = { name: 'Season ' + s, episodes: eps }; }); }
    r.status = 'ok'; r.data = data; done[r.key] = r;
  });
  SAVE(d);
  if (Object.keys(done).length) setTimeout(() => NexusCinema._meta(JSON.stringify(done)), 30);
};
window.__plug = (on) => {
  if (on) { let d = __cin.drives.find(x => x.uuid === 'A1B2'); if (!d) __cin.drives.push(d = { uuid: 'A1B2', label: 'Movie Drive', access: 'files' }); d.mounted = true; d.state = 'mounted'; d.scannedThisConnection = false; }
  else __cin.drives = [];
  NexusCinema._drives(JSON.stringify(__cin.drives));
};
window.__imgs = new Set();
// the test browser can't reach the box's picture server, so pictures "fail"; keep them in place so the test can see which picture each card asked for
const __rm = Element.prototype.remove; Element.prototype.remove = function () { if (this.tagName === 'IMG' && /cinema\.nexus/.test(this.getAttribute('src') || '')) return; return __rm.call(this); };
new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.querySelectorAll) n.querySelectorAll('img').forEach(i => __imgs.add(i.getAttribute('src'))); }))).observe(document.body, { childList: true, subtree: true });`;

const until = async (ev, sleep, expr, ms) => { for (let t = 0; t < (ms || 6000); t += 100) { if (await ev(expr)) return true; await sleep(100); } return false; };

session(async ({ ev, sleep, send }) => {
  const boot = async () => { await ev(BOX); };
  await ev(`localStorage.removeItem('fakeMetaDb'); localStorage.removeItem('fakeLibs')`);
  await boot();
  const txt = sel => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);
  const click = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('missing ${sel.replace(/'/g, '')}');e.click();return true;})()`);
  const S = () => ev('NexusCinema.state()');
  const card = id => `#cnGrid .cn-card[data-id="${id}"]`;
  const idOf = title => ev(`(()=>{const i=NexusCinema.state().items.find(i=>i.title===${JSON.stringify(title)});return i.kind==='show'?i.id:i.uuid+'|'+i.rel;})()`);

  // 1. scan with no internet: library built, every title waiting for information
  await ev(`document.querySelector('[data-act=cinema]').click()`); await sleep(300);
  await ev('__plug(true)'); await ev(`NexusCinema.close(); NexusCinema.open()`);   // (the box scans a newly plugged drive itself)
  assert(await until(ev, sleep, `NexusCinema.state().items.length===7`, 8000), 'library built from the drive without internet');
  let db = await ev(`JSON.parse(localStorage.getItem('fakeMetaDb'))`);
  const keys = Object.keys(db).sort();
  assert.deepStrictEqual(keys, ['m|alien|1979', 'm|aliens|1986', 'm|blade runner|1982', 'm|crash|0', 'm|thing|1982', 'm|up|2009', 't|breaking bad|0'].sort(), 'one key per title, similar titles kept apart: ' + keys);
  assert(Object.values(db).every(r => r.status === 'pending'), 'without internet every title waits for its information');
  assert.deepStrictEqual(db['t|breaking bad|0'].seasons, [1, 2], 'the show asks for exactly the seasons on the drive');
  assert(await ev(`!document.querySelector('#cnGrid.posters')`), 'no posters yet: the films show their own stills');

  // 2-4. internet comes back: the waiting titles are completed automatically
  await ev(`__tmdb.online = true; __work()`);
  assert(await until(ev, sleep, `!!document.querySelector('#cnGrid.posters')`, 6000), 'the library becomes a poster wall');
  const alien = await idOf('Alien'), aliens = await idOf('Aliens'), thing = await idOf('The Thing');
  assert(await ev(`__imgs.has('https://cinema.nexus/art?f=m348_ps.jpg') && document.querySelector('${card(alien)}').innerHTML.includes('https://cinema.nexus/art?f=m348_ps.jpg')`), 'Alien shows its own poster');
  assert(await ev(`__imgs.has('https://cinema.nexus/art?f=m679_ps.jpg') && document.querySelector('${card(aliens)}').innerHTML.includes('https://cinema.nexus/art?f=m679_ps.jpg')`), 'Aliens shows its own, different poster');
  assert(await ev(`__imgs.has('https://cinema.nexus/art?f=m1091_ps.jpg') && document.querySelector('${card(thing)}').innerHTML.includes('https://cinema.nexus/art?f=m1091_ps.jpg')`), 'The Thing (1982) gets the 1982 film');
  await ev(`document.querySelector('${card(alien)}').click()`); await sleep(150);
  const sheet = await txt('.cn-sheet');
  assert(/The crew of the Nostromo/.test(sheet) && /Horror · Science Fiction/.test(sheet) && /1 h 57 min/.test(sheet) && /★ 8.2/.test(sheet), 'details: description, genres, runtime, rating: ' + sheet.slice(0, 200));
  assert(await ev(`__imgs.has('https://cinema.nexus/art?f=m348_b.jpg') && __imgs.has('https://cinema.nexus/art?f=m348_p.jpg') && document.querySelector('.cn-sheet').innerHTML.includes('m348_b.jpg')`), 'details show the background and the full poster');
  await ev('Nexus.back()');
  const bb = await idOf('Breaking Bad');
  await ev(`document.querySelector('${card(bb)}').click()`); await sleep(150);
  assert(/A chemistry teacher/.test(await txt('.cn-show-head')) && /Drama · Crime/.test(await txt('.cn-show-head')), 'show page: description and genres');
  assert(await ev(`__imgs.has('https://cinema.nexus/art?f=t1396_b.jpg')`), 'show background');
  assert(/1\. Episode name 1-1/.test(await txt('.cn-eps')) && /What happens in 1-1/.test(await txt('.cn-eps')), 'episode names and descriptions');
  assert(await ev(`__imgs.has('https://cinema.nexus/art?f=t1396_s1e1.jpg')`), 'episode stills');
  await click('.cn-seasons button:nth-child(2)'); await sleep(80);
  assert(/Episode name 2-1/.test(await txt('.cn-eps')), 'season 2 episodes');
  await ev('Nexus.back()'); await sleep(50);

  // 5. an uncertain title: marked, never given someone else's poster, and fixed by choosing
  const crash = await idOf('Crash');
  assert(await ev(`!!document.querySelector('${card(crash)} .cn-q') && !document.querySelector('${card(crash)}').innerHTML.includes('cinema.nexus/art')`), 'an uncertain title is marked and keeps its own still');
  await ev(`document.querySelector('${card(crash)}').click()`); await sleep(100);
  await click('.cn-sheet [data-fix]'); await sleep(80);
  assert(/Crash \(2004\)/.test(await txt('.cn-chooser')) && /Crash \(1996\)/.test(await txt('.cn-chooser')), 'the choices are offered');
  await click('.cn-sheet [data-choose="884"]');
  assert(await until(ev, sleep, `NexusCinema.state().meta['m|crash|0'].status==='ok' && NexusCinema.state().meta['m|crash|0'].data.year===1996`, 4000), 'the chosen film is used');
  await ev('Nexus.back()'); await sleep(50);

  // 10. genres
  await ev(`(()=>{const g=document.getElementById('cnGenre');g.value='Horror';g.dispatchEvent(new Event('change',{bubbles:true}));})()`); await sleep(100);
  let titles = (await S()).list.map(i => i.title).sort();
  assert.deepStrictEqual(titles, ['Alien', 'The Thing'], 'genre filter: ' + titles);
  await ev(`(()=>{const g=document.getElementById('cnGenre');g.value='';g.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await ev(`(()=>{if(!document.getElementById('cnSearch'))document.getElementById('cnSearchBtn').click();const s=document.getElementById('cnSearch');s.value='crime';s.dispatchEvent(new Event('input'));})()`); await sleep(80);
  assert.deepStrictEqual((await S()).list.map(i => i.title), ['Breaking Bad'], 'search by genre');
  await ev(`document.getElementById('cnSearchX').click()`);

  // 6. restart the app with no internet and no drive: everything still shows
  await send('Page.reload'); await sleep(1500);
  await boot(); await ev(`__tmdb.online = false`);
  await ev(`document.querySelector('[data-act=cinema]').click()`); await sleep(300);
  assert(await ev(`NexusCinema.state().items.length===7 && document.querySelectorAll('#cnGrid .cn-card.offline').length===7`), 'after a restart, with the drive unplugged, the whole library is listed (offline)');
  assert(await ev(`__imgs.has('https://cinema.nexus/art?f=m348_ps.jpg') && document.querySelector('${card(alien)}').innerHTML.includes('https://cinema.nexus/art?f=m348_ps.jpg')`), 'posters come back from the box with no internet');
  await ev(`document.querySelector('${card(alien)}').click()`); await sleep(100);
  assert(/Nostromo/.test(await txt('.cn-sheet')) && /Plug in/.test(await txt('.cn-sheet')) && !(await ev(`!!document.querySelector('.cn-sheet [data-act=start]')`)), 'offline details show the saved description and say to plug the drive in');
  await ev('Nexus.back()');
  await ev(`(()=>{if(!document.getElementById('cnSearch'))document.getElementById('cnSearchBtn').click();const s=document.getElementById('cnSearch');s.value='alien';s.dispatchEvent(new Event('input'));})()`); await sleep(80);
  assert.deepStrictEqual((await S()).list.map(i => i.title).sort(), ['Alien', 'Aliens'], 'search works offline');
  await ev(`document.getElementById('cnSearchX').click()`);

  // 8-9. plug the drive back in with a new film added: plays, only the new film is downloaded, no duplicates
  await ev(`__tmdb.online = true; __cin.entries.push({rel:'Movies/Brand New Film (2026)/Brand New Film (2026).mkv',name:'Brand New Film (2026).mkv',size:2e9,mtime:Date.now()})`);
  await ev('__plug(true)'); await ev(`NexusCinema.close(); NexusCinema.open()`);
  assert(await until(ev, sleep, `NexusCinema.state().items.length===8 && (NexusCinema.state().meta['m|brand new film|2026']||{}).status==='ok'`, 8000), 'the new film is found and gets its information');
  const newReq = await ev('__tmdb.requests');   // everything asked of TMDB since the restart
  assert.deepStrictEqual(newReq, ['m|brand new film|2026'], 'only the new film was downloaded: ' + newReq);
  const st = await S(), ids = st.items.map(i => i.kind === 'show' ? i.id : i.uuid + '|' + i.rel);
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicates');
  await ev(`document.querySelector('${card(alien)}').click()`); await sleep(100);
  await click('.cn-sheet [data-act=start]');
  assert((await ev('__cin.plays')).length === 1, 'plays again once the drive is back');

  console.log('Cinema movie information: offline-first library, automatic download when online, similar titles kept apart, posters/backgrounds/descriptions/genres/runtimes, ' +
    'shows with season and episode names and stills, uncertain titles chosen by hand, restart with no internet and no drive, replug, only new titles downloaded, genre filter and search verified.');
}).catch(e => { console.error(e); process.exit(1); });
