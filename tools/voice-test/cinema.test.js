// Nexus Cinema: the whole library workflow in the real app page, with the box's drive side simulated.
//  1 open Cinema with no drive  2 plug a drive in  3 grant access  4 detection  5 scan of nested folders with
//  progress  6 films and shows appear  7 a new film is found on rescan  8 play straight from the drive (with
//  resume)  9 unplug: films stay listed offline, playing them is refused  10 replug: library restored, no duplicates.
// Plus: title/year/episode parsing, search, sorting, filters, show pages, details, back button, no page errors.
// Set CINEMA_FIXTURE to a JSON file of scanned entries to run the same checks against a real drive's file list.
const assert = require('assert');
const fs = require('fs');
const { session } = require('./party-shots.js');

function synthetic() {
  const e = [], add = (rel, size) => e.push({ rel, name: rel.split('/').pop(), size: size || 1.8e9, mtime: 1.79e12 + e.length * 1000 });
  ['Alien (1979)', 'Aliens (1986)', 'The Matrix (1999)', 'Blade Runner (1982)', 'Shaun of the Dead (2004)', '28 Days Later (2002)',
   'A Quiet Place (2018)', 'Top Gun Maverick (2022)', 'The Thing (1982)', 'Up (2009)'].forEach(f => add('Movies & TV/Movies/' + f + '/' + f + (f.length % 2 ? '.mkv' : '.mp4')));
  add('Movies & TV/Movies/Some.Film.2015.1080p.BluRay.x264-GRP.mkv');
  ['Akira (1988)', 'Princess Mononoke (1997)'].forEach(f => add('Movies & TV/Anime/' + f + '/' + f + '.mkv'));
  for (let s = 1; s <= 2; s++) for (let i = 1; i <= 4; i++) add('Movies & TV/Anime/Black Lagoon/S0' + s + '_Episode ' + i + '; Episode Name ' + s + i + '.mkv', 1.5e8);
  for (let s = 1; s <= 2; s++) for (let i = 1; i <= 3; i++) add('Movies & TV/Anime/Vinland Saga/Season ' + s + '/Vinland Saga - S0' + s + 'E0' + i + ' - Part ' + i + '.mkv', 4e8);
  add('Movies & TV/Anime/Vinland Saga/Season 1/Extras/Vinland Saga - NCED01.mkv', 5e7);
  for (let s = 1; s <= 3; s++) for (let i = 1; i <= 5; i++) add('Movies & TV/Television/Breaking Bad/Season ' + s + '/Breaking Bad - S0' + s + 'E0' + i + ' - Chapter ' + i + '.mkv', 9e8);
  for (let i = 1; i <= 6; i++) add('Movies & TV/Television/Your Friends & Neighbors/Season 1/Your Friends & Neighbors (2025) - S01E0' + i + '.mkv', 9e8);
  return e;
}
const ENTRIES = process.env.CINEMA_FIXTURE ? JSON.parse(fs.readFileSync(process.env.CINEMA_FIXTURE, 'utf8')) : synthetic();

// The simulated box: drives, access, a scan that walks folders and reports progress, playback positions.
const BOX = `
window.__cin = { drives: [], libs: {}, progress: {}, plays: [], grants: 0, scans: 0, entries: ${JSON.stringify(ENTRIES)} };
Android.cinemaDrives = () => JSON.stringify(__cin.drives);
Android.cinemaLibrary = () => JSON.stringify(Object.values(__cin.libs));
Android.cinemaProgress = () => JSON.stringify(__cin.progress);
Android.cinemaInfo = (u, r) => setTimeout(() => NexusCinema._info(JSON.stringify({ uuid: u, rel: r, duration: 7260000, width: 1920, height: 1080 })), 30);
Android.cinemaGrant = (u) => { __cin.grants++; setTimeout(() => { const d = __cin.drives.find(x => x.uuid === u); d.access = 'files'; NexusCinema._drives(JSON.stringify(__cin.drives)); Android.cinemaScan(u); }, 50); };
Android.cinemaScan = (u) => {
  __cin.scans++;
  const d = __cin.drives.find(x => x.uuid === u); if (!d || !d.mounted) return; d.scanning = true;
  const all = __cin.entries.slice(); let i = 0;
  const step = () => {
    if (!d.mounted) { d.scanning = false; NexusCinema._scanAborted(u, 'The drive was disconnected during the scan.'); return; }
    i = Math.min(all.length, i + Math.ceil(all.length / 6));
    NexusCinema._progress(JSON.stringify({ uuid: u, folders: i, files: i * 2, videos: i, folder: (all[i - 1] || {}).rel || '' }));
    if (i < all.length) return setTimeout(step, 40);
    const prev = __cin.libs[u], before = new Set(prev ? prev.entries.map(e => e.rel) : []), seen = new Set(), entries = [];
    all.forEach(e => { if (!seen.has(e.rel)) { seen.add(e.rel); entries.push(e); } });
    __cin.libs[u] = { uuid: u, label: d.label, scannedAt: Date.now(), entries };
    d.scanning = false; d.scannedThisConnection = true;
    const added = entries.filter(e => !before.has(e.rel)).length, removed = [...before].filter(r => !seen.has(r)).length;
    NexusCinema._scanned(JSON.stringify({ uuid: u, videos: entries.length, added: prev ? added : entries.length, removed, first: !prev }));
  };
  setTimeout(step, 40);
};
Android.cinemaPlay = (u, r, title, start, subs) => { const d = __cin.drives.find(x => x.uuid === u); if (!d || !d.mounted) return false; __cin.plays.push({ u, r, title, start, subs }); return true; };
window.__imgs = [];
new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.querySelectorAll) n.querySelectorAll('img').forEach(i => __imgs.push(i.getAttribute('src'))); }))).observe(document.body, { childList: true, subtree: true });
window.__plug = (on) => {
  if (on) { let d = __cin.drives.find(x => x.uuid === 'A1B2-C3D4'); if (!d) __cin.drives.push(d = { uuid: 'A1B2-C3D4', label: 'Movie Drive', access: __cin.granted ? 'files' : 'none' }); d.mounted = true; d.state = 'mounted'; d.scannedThisConnection = false; }
  else __cin.drives = [];
  NexusCinema._drives(JSON.stringify(__cin.drives));
};`;

const until = async (ev, sleep, expr, ms) => { for (let t = 0; t < (ms || 6000); t += 100) { if (await ev(expr)) return true; await sleep(100); } return false; };

session(async ({ ev, sleep, shot }) => {
  await ev(BOX);
  const S = () => ev('NexusCinema.state()');
  const txt = sel => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);
  const click = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('missing ${sel.replace(/'/g, '')}');e.click();return true;})()`);
  const shotDir = process.env.CINEMA_SHOTS;
  const snap = async n => { if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await shot(shotDir + '/' + n + '.png'); } };

  // the parsing rules
  const P = await ev(`(()=>{const p=NexusCinema._parse;return{
    a:p.titleYear('Alien (1979)'), b:p.titleYear('Some.Film.2015.1080p.BluRay.x264-GRP.mkv'), c:p.titleYear('Without a Paddle; Nature\\'s Calling (2004)'),
    e1:p.epInfo('S01_Episode 4; Die Rückkehr des Adlers.mkv',['Black Lagoon','x']), e2:p.epInfo('Breaking Bad - S02E05 - Chapter 5.mkv',['Season 2','x']),
    e3:p.epInfo('Show - 07.mkv',['Season 3','x'])};})()`);
  assert.deepStrictEqual([P.a.title, P.a.year], ['Alien', 1979], 'Title (Year) folder names');
  assert.deepStrictEqual([P.b.title, P.b.year], ['Some Film', 2015], 'scene-style dotted names lose their quality tags');
  assert.deepStrictEqual([P.c.title, P.c.year], ["Without a Paddle; Nature's Calling", 2004]);
  assert.deepStrictEqual([P.e1.season, P.e1.episode, P.e1.label], [1, 4, 'Die Rückkehr des Adlers'], 'S01_Episode N names');
  assert.deepStrictEqual([P.e2.season, P.e2.episode], [2, 5], 'SxxEyy');
  assert.deepStrictEqual([P.e3.season, P.e3.episode], [3, 7], 'Season folder plus " - 07" numbering');

  // 1. Cinema with no drive
  await ev(`document.querySelector('[data-act=cinema]').click()`); await sleep(400);
  assert(await ev('NexusCinema.isOpen()'), 'Cinema opens from its home button');
  assert(/Plug in your movie drive/.test(await txt('#cnBody')), 'no drive: a clear "plug in your drive" screen');
  await snap('1-no-drive');

  // 2-4. plug in, detection, grant
  await ev('__plug(true)'); await sleep(200);
  assert(/Needs your OK/.test(await txt('#cnDrives')) && await ev(`!!document.querySelector('#cnBody [data-grant]')`), 'the new drive is detected and asks for access');
  await snap('2-needs-access');
  await click('#cnBody [data-grant]');
  await ev('__cin.granted=true');

  // 5. scanning with progress
  assert(await until(ev, sleep, `!document.getElementById('cnScan').classList.contains('hidden')`), 'scan progress shows');
  assert(/Scanning Movie Drive/.test(await txt('#cnScan')), 'progress names the drive');
  await snap('3-scanning');
  assert(await until(ev, sleep, `document.getElementById('cnScan').classList.contains('hidden') && !!document.querySelector('#cnGrid .cn-card')`, 15000), 'scan finishes and the grid appears');
  let st = await S();
  const nMovies = st.items.filter(i => i.kind === 'movie').length, nShows = st.items.filter(i => i.kind === 'show').length;
  if (!process.env.CINEMA_FIXTURE) {
    assert.strictEqual(nMovies, 13, 'films (incl. anime films) found in nested folders: ' + nMovies);
    assert.strictEqual(nShows, 4, 'shows grouped from episode folders: ' + nShows);
    const bl = st.items.find(i => i.title === 'Black Lagoon');
    assert(bl && bl.seasons.length === 2 && bl.episodes.length === 8, 'Black Lagoon: 2 seasons, 8 episodes');
    const vs = st.items.find(i => i.title === 'Vinland Saga');
    assert(vs && vs.extras.length === 1 && vs.episodes.length === 6, 'extras kept apart from episodes');
    assert(st.items.find(i => i.title === 'Your Friends & Neighbors'), 'a show whose folder had no year');
  }
  console.log('  library: ' + nMovies + ' films, ' + nShows + ' shows from ' + ENTRIES.length + ' video files');
  await sleep(300); await snap('4-library');
  assert.strictEqual(await ev(`document.querySelectorAll('#cnGrid .cn-card').length`) > 0, true);
  assert(await ev(`document.querySelectorAll('#cnGrid .cn-card').length <= 72`), 'grid renders in pages (not everything at once)');
  assert(await ev(`__imgs.some(u=>/^https:\\/\\/cinema\\.nexus\\/thumb\\?u=A1B2-C3D4&r=/.test(u||''))`), 'stills are asked from the box');
  assert(await ev(`[...document.querySelectorAll('#cnGrid .cn-ph span')].every(s=>s.textContent.length>0)`), 'every card has a title card until its still arrives');

  // search, sort and filters
  await ev(`(()=>{const s=document.getElementById('cnSearch');s.value='alien';s.dispatchEvent(new Event('input'));})()`); await sleep(150);
  const found = await ev(`[...document.querySelectorAll('#cnGrid .cn-meta b')].map(b=>b.textContent)`);
  if (!process.env.CINEMA_FIXTURE) assert.deepStrictEqual(found.sort(), ['Alien', 'Aliens'], 'search: ' + found);
  else assert(found.length > 0 && (await ev(`NexusCinema.state().list.every(i=>/alien/i.test(i.title)||(i.kind==='show'&&i.episodes.some(e=>/alien/i.test(e.title))))`)), 'search');
  await ev(`(()=>{const s=document.getElementById('cnSearch');s.value='';s.dispatchEvent(new Event('input'));})()`);
  await ev(`(()=>{const s=document.getElementById('cnSort');s.value='year';s.dispatchEvent(new Event('change'));})()`); await sleep(100);
  const years = (await ev(`NexusCinema.state().list.slice(0,8).map(i=>i.year||0)`));
  assert(years.every((y, i) => i === 0 || y <= years[i - 1]), 'newest first: ' + years);
  await ev(`(()=>{const s=document.getElementById('cnSort');s.value='title';s.dispatchEvent(new Event('change'));})()`);
  for (const [f, test] of [['movies', i => i.kind === 'movie' && i.cat !== 'anime'], ['tv', i => i.kind === 'show' && i.cat !== 'anime'], ['anime', i => i.cat === 'anime']]) {
    await click(`#cnFilters [data-filter=${f}]`); await sleep(80);
    const l = (await S()).list;
    assert(l.length > 0 && l.every(test), 'filter ' + f);
  }
  await click('#cnFilters [data-filter=all]');

  // show page
  const showId = await ev(`NexusCinema.state().items.find(i=>i.kind==='show' && i.seasons.length>1).id`);
  const showTitle = await ev(`NexusCinema.state().items.find(i=>i.id===${JSON.stringify(showId)}).title`);
  await ev(`(()=>{const s=document.getElementById('cnSearch');s.value=${JSON.stringify(showTitle)};s.dispatchEvent(new Event('input'));})()`); await sleep(100);
  await ev(`document.querySelector('[data-id="${showId}"]').click()`); await sleep(150);
  assert(await ev(`!!document.querySelector('.cn-show-head') && document.querySelectorAll('.cn-seasons button').length>1`), 'a show opens with its seasons');
  await click('.cn-seasons button:nth-child(2)'); await sleep(80);
  assert(await ev(`document.querySelector('.cn-seasons button:nth-child(2)').classList.contains('on')`), 'season switch');
  await snap('5-show');
  await ev('Nexus.back()'); await sleep(80);
  assert(await ev(`!!document.getElementById('cnGrid') && NexusCinema.isOpen()`), 'back from a show returns to the library');
  await ev(`(()=>{const s=document.getElementById('cnSearch');s.value='';s.dispatchEvent(new Event('input'));})()`); await sleep(80);

  // 8. details and playing straight from the drive, then resume
  const movie = await ev(`[...document.querySelectorAll('#cnGrid .cn-card')].map(c=>c.getAttribute('data-id')).find(id=>NexusCinema.state().items.some(i=>i.kind==='movie'&&i.uuid+'|'+i.rel===id))`);
  await ev(`document.querySelector('#cnGrid [data-id="${movie}"]').click()`); await sleep(200);
  assert(await ev(`!document.getElementById('cnSheet').classList.contains('hidden')`), 'tapping a film opens its details');
  assert(/2 h 1 min/.test(await txt('.cn-facts')) && /HD 1080p/.test(await txt('.cn-facts')), 'runtime and picture size shown: ' + await txt('.cn-facts'));
  await snap('6-details');
  await click('.cn-sheet [data-act=start]');
  let plays = await ev('__cin.plays');
  assert(plays.length === 1 && plays[0].r === movie.split('|')[1] && plays[0].start === 0, 'plays the file straight from the drive');
  await ev(`__cin.progress[${JSON.stringify(movie)}]={pos:3723000,dur:7260000,done:false,at:Date.now()}; Nexus.resumed()`); await sleep(100);
  assert(await ev(`!!document.querySelector('.cn-row .cn-prog')`), 'the film appears under Continue watching with a progress bar');
  await ev(`document.querySelector('#cnGrid [data-id="${movie}"]').click()`); await sleep(100);
  assert(/RESUME FROM 1:02:03/.test(await txt('.cn-sheet')), 'offers to resume where you stopped');
  await click('.cn-sheet [data-act=resume]');
  plays = await ev('__cin.plays');
  assert.strictEqual(plays[1].start, 3723000, 'resumes at the saved position');
  await click('#cnFilters [data-filter=continue]'); await sleep(80);
  assert((await S()).list.length === 1, 'Continue watching filter');
  await click('#cnFilters [data-filter=all]');

  // 9. unplug while browsing
  await ev('__plug(false)'); await sleep(150);
  assert(await ev(`document.querySelectorAll('#cnGrid .cn-card.offline').length>0`), 'films stay listed, marked offline');
  assert(/Not connected/.test(await txt('#cnDrives')), 'the drive shows as not connected');
  await snap('7-offline');
  await ev(`document.querySelector('#cnGrid [data-id="${movie}"]').click()`); await sleep(100);
  assert(/Plug in/.test(await txt('.cn-sheet')) && !(await ev(`!!document.querySelector('.cn-sheet [data-act=start]')`)), 'an offline film says to plug the drive in instead of playing');
  await ev('Nexus.back()');

  // 7 + 10. a new film added on the computer; replug: rescan finds it, no duplicates
  const before = (await S()).items.length;
  await ev(`__cin.entries.push({rel:'Movies & TV/Movies/Brand New Film (2026)/Brand New Film (2026).mkv',name:'Brand New Film (2026).mkv',size:2e9,mtime:Date.now()})`);
  await ev('__plug(true)'); await sleep(100);
  await ev(`NexusCinema.close(); NexusCinema.open()`);   // reopening scans a drive not yet scanned since it was plugged in
  assert(await until(ev, sleep, `NexusCinema.state().items.some(i=>i.title==='Brand New Film')`, 15000), 'the new film is discovered after reconnecting');
  st = await S();
  assert.strictEqual(st.items.length, before + 1, 'exactly one more item, no duplicates');
  const keys = st.items.map(i => i.kind === 'show' ? i.id : i.uuid + '|' + i.rel);
  assert.strictEqual(new Set(keys).size, keys.length, 'no duplicate entries');
  assert(!(await ev(`document.querySelector('#cnGrid .cn-card.offline')`)), 'nothing offline once the drive is back');
  await click('#cnRescan');
  assert(await until(ev, sleep, `/up to date/.test(document.getElementById('cnToast').textContent)`, 15000), 'manual rescan reports no changes');
  assert.strictEqual((await S()).items.length, before + 1, 'manual rescan adds no duplicates');

  // unplug during a scan
  await click('#cnRescan'); await sleep(30); await ev('__plug(false)');
  assert(await until(ev, sleep, `document.getElementById('cnScan').classList.contains('hidden')`, 5000), 'a scan interrupted by unplugging ends cleanly');

  // back button closes Cinema; home closes it too
  await ev('Nexus.back()'); await sleep(50);
  assert(!(await ev('NexusCinema.isOpen()')), 'back closes Cinema');
  await ev(`NexusCinema.open(); Nexus.home()`);
  assert(!(await ev('NexusCinema.isOpen()')), 'home closes Cinema');
  const errors = await ev('__errors');
  assert.strictEqual(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  console.log('Nexus Cinema: no-drive, detect, grant, scan progress, nested folders, films/shows/extras, search, sort, filters, details, play, resume, offline, reconnect, new film, rescan without duplicates, interrupted scan and back/home verified in the real app page.');
}).catch(e => { console.error(e); process.exit(1); });
