// Nexus Cinema navigation and keyboard: the twelve-step walk-through in the real app page, using only
// Cinema's own buttons, with the keyboard watched at every step. "Keyboard" here is what the box would
// show it for: a focused text box, or Cinema asking the box to show it (Android.cinemaKeyboard).
// Set CINEMA_SHOTS=<dir> to save screenshots.
const assert = require('assert');
const fs = require('fs');
const { session } = require('./party-shots.js');

const entries = [];
const add = (rel, size) => entries.push({ rel, name: rel.split('/').pop(), size: size || 1.8e9, mtime: 1.79e12 + entries.length * 1000 });
['Alien (1979)', 'Aliens (1986)', 'The Matrix (1999)', 'Blade Runner (1982)', 'Shaun of the Dead (2004)', '28 Days Later (2002)', 'A Quiet Place (2018)',
 'Top Gun Maverick (2022)', 'The Thing (1982)', 'Up (2009)', 'Heat (1995)', 'Jaws (1975)', 'Arrival (2016)', 'Dune (2021)', 'Sicario (2015)', 'Prisoners (2013)',
 'Inception (2010)', 'Interstellar (2014)', 'Gravity (2013)', 'Coco (2017)', 'Drive (2011)', 'Fargo (1996)', 'Memento (2000)', 'Oldboy (2003)'].forEach(f => add('Movies/' + f + '/' + f + '.mkv'));
for (let s = 1; s <= 2; s++) for (let i = 1; i <= 5; i++) add('TV/Breaking Bad/Season ' + s + '/Breaking Bad - S0' + s + 'E0' + i + ' - Chapter ' + i + '.mkv', 9e8);
for (let i = 1; i <= 6; i++) add('TV/Severance/Season 1/Severance - S01E0' + i + '.mkv', 9e8);

const BOX = `
window.__cin = { plays: [], kb: [], progress: {} };
const D = [{ uuid: 'A1B2-C3D4', label: 'Movie Drive', access: 'files', mounted: true, state: 'mounted', scannedThisConnection: true }];
const L = [{ uuid: 'A1B2-C3D4', label: 'Movie Drive', scannedAt: Date.now(), entries: ${JSON.stringify(entries)} }];
Android.cinemaDrives = () => JSON.stringify(D);
Android.cinemaLibrary = () => JSON.stringify(L);
Android.cinemaProgress = () => JSON.stringify(__cin.progress);
Android.cinemaInfo = (u, r) => setTimeout(() => NexusCinema._info(JSON.stringify({ uuid: u, rel: r, duration: 7260000, width: 1920, height: 1080 })), 30);
Android.cinemaScan = () => {};
Android.cinemaPlay = (u, r, title, start) => { __cin.plays.push({ u, r, title, start }); return true; };
Android.cinemaKeyboard = (show) => __cin.kb.push(show);
window.__focus = [];
document.addEventListener('focusin', e => { if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) __focus.push(e.target.id || e.target.tagName); }, true);`;

session(async ({ ev, sleep, shot }) => {
  await ev(BOX);
  const shotDir = process.env.CINEMA_SHOTS;
  const snap = async n => { if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await sleep(300); await shot(shotDir + '/' + n + '.png'); } };
  const S = () => ev('NexusCinema.state()');
  const tap = async (sel, what) => { const ok = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;
    const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,o={bubbles:true,cancelable:true,clientX:x,clientY:y,pointerType:'touch',isPrimary:true};
    e.dispatchEvent(new PointerEvent('pointerdown',o));e.dispatchEvent(new PointerEvent('pointerup',o));e.click();return true;})()`);
    assert(ok, 'missing ' + (what || sel)); await sleep(120); };
  // the keyboard check: no focused text box, no request to show the keyboard since the last check
  let kbSeen = 0;
  const noKeyboard = async (where) => {
    const k = await ev(`({active:(document.activeElement||{}).tagName, id:(document.activeElement||{}).id, shows:__cin.kb.slice(${kbSeen}).filter(Boolean).length, inputs:document.querySelectorAll('#cinema input').length})`);
    kbSeen = await ev('__cin.kb.length');
    assert(!/^(INPUT|TEXTAREA)$/.test(k.active) && k.shows === 0, 'no keyboard ' + where + ' ' + JSON.stringify(k));
    return k;
  };
  const sheet = () => ev(`!document.getElementById('cnSheet').classList.contains('hidden')`);
  const body = () => ev(`(()=>{const b=document.getElementById('cnBody');return{top:b.scrollTop,show:!!document.querySelector('.cn-show-head'),grid:!!document.getElementById('cnGrid')};})()`);

  // 1. Open Cinema
  await ev(`document.querySelector('[data-act=cinema]').click()`); await sleep(500);
  assert(await ev('NexusCinema.isOpen()'), 'Cinema opens');
  const k1 = await noKeyboard('on opening');
  assert.strictEqual(k1.inputs, 0, 'there is no text box at all until SEARCH is tapped');
  assert(await ev(`['cnBack','cnExit','cnSearchBtn'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>=56&&r.height>=56;})`), 'Back, Exit and Search are big touch targets');
  await snap('01-library');

  // 2. Browse without the keyboard: filters, scrolling, sort, tapping cards
  for (const f of ['movies', 'tv', 'all']) { await tap(`#cnFilters [data-filter=${f}]`); await noKeyboard('after the ' + f + ' filter'); }
  await ev(`(()=>{const b=document.getElementById('cnBody');b.scrollTop=420;b.dispatchEvent(new Event('scroll'));})()`); await sleep(150);
  const scrolled = (await body()).top;
  assert(scrolled > 300, 'the library scrolls');

  // 3. Open a movie
  const movieId = await ev(`[...document.querySelectorAll('#cnGrid .cn-card')].map(c=>c.getAttribute('data-id')).find(id=>id.includes('Movies/'))`);
  await tap(`#cnGrid [data-id="${movieId}"]`, 'a movie card');
  assert(await sheet(), 'tapping a movie opens its details');
  await noKeyboard('on a movie');
  await snap('02-movie');

  // 4. Back with Cinema's own button, to the same place in the library
  await tap('.cn-sheet-back', 'the sheet Back button');
  assert(!(await sheet()), 'Back closes the details');
  assert.strictEqual((await body()).top, scrolled, 'still at the same place in the library');
  await noKeyboard('after closing a movie');

  // 5. Open a TV show
  await tap(`#cnFilters [data-filter=tv]`);
  const showId = await ev(`NexusCinema.state().items.find(i=>i.title==='Breaking Bad').id`);
  await tap(`[data-id="${showId}"]`, 'the Breaking Bad card');
  let b = await body();
  assert(b.show && /Breaking Bad/.test(await ev(`document.getElementById('cnCrumb').textContent`)), 'the show page opens and the header says where you are');
  assert(await ev(`!document.getElementById('cnHome').classList.contains('hidden')`), 'a Home button appears away from the main screen');
  await noKeyboard('on a show');
  await snap('03-show');

  // 6. Select an episode
  await tap('.cn-ep:nth-child(3)', 'an episode');
  assert(await sheet() && /S1 E3/.test(await ev(`document.querySelector('.cn-sheet h2').textContent`)), 'the episode opens');
  assert(await ev(`/NEXT EPISODE/.test(document.querySelector('.cn-sheet').textContent)`), 'the episode offers the next one');
  await noKeyboard('on an episode');
  await snap('04-episode');
  await tap('.cn-sheet [data-act=next]', 'NEXT EPISODE');
  assert(/S1 E4/.test(await ev(`document.querySelector('.cn-sheet h2').textContent`)), 'NEXT EPISODE moves along');

  // 7. Back to the show
  await tap('.cn-sheet-x', 'the sheet close button');
  b = await body();
  assert(!(await sheet()) && b.show, 'closing the episode returns to the show');

  // 8. Back to the main Cinema screen
  await tap('#cnBack', 'header Back');
  b = await body();
  assert(b.grid && !b.show && (await S()).filter === 'tv', 'Back from the show returns to the TV list it came from');
  await tap('#cnBack', 'header Back');
  assert((await S()).filter === 'all' && await ev(`document.getElementById('cnHome').classList.contains('hidden')`), 'one more Back reaches the main Cinema screen');
  await noKeyboard('back on the main screen');
  // and HOME jumps straight there from deep inside
  await tap(`[data-id="${showId}"]`); await tap('.cn-ep:nth-child(2)'); await tap('.cn-sheet-x');
  await tap('#cnHome', 'HOME');
  b = await body();
  assert(b.grid && (await S()).filter === 'all' && (await S()).nav.length === 0 && !(await sheet()), 'HOME goes straight to the main Cinema screen');

  // 9. Search: the keyboard appears
  kbSeen = await ev('__cin.kb.length');
  await tap('#cnSearchBtn', 'SEARCH');
  const k9 = await ev(`({active:document.activeElement.id, shows:__cin.kb.slice(${kbSeen})})`);
  assert(k9.active === 'cnSearch' && k9.shows.includes(true), 'tapping SEARCH focuses the search box and asks for the keyboard ' + JSON.stringify(k9));
  await ev(`(()=>{const s=document.getElementById('cnSearch');s.value='ali';s.dispatchEvent(new Event('input'));})()`); await sleep(150);
  await snap('05-search');
  // tapping a result puts the keyboard away and opens it; Back returns to the results, keyboard still away
  const res = await ev(`[...document.querySelectorAll('#cnGrid .cn-meta b')].map(b=>b.textContent)`);
  assert.deepStrictEqual(res.sort(), ['Alien', 'Aliens'], 'search finds: ' + res);
  kbSeen = await ev('__cin.kb.length');
  await tap('#cnGrid .cn-card', 'a search result');
  assert(await sheet(), 'a result opens');
  const kr = await ev(`({active:document.activeElement.tagName, hide:__cin.kb.slice(${kbSeen}).includes(false)})`);
  assert(kr.active !== 'INPUT' && kr.hide, 'opening a result puts the keyboard away ' + JSON.stringify(kr));
  kbSeen = await ev('__cin.kb.length');
  await tap('.cn-sheet-back');
  assert((await S()).searching && await ev(`document.getElementById('cnSearch').value`) === 'ali', 'Back returns to the search results');
  await noKeyboard('back on the search results');

  // 10. Close search: the keyboard goes and the text box is gone
  await tap('#cnSearch', 'the search box');   // tap the box again: keyboard on purpose
  await ev(`document.getElementById('cnSearch').focus()`);
  kbSeen = await ev('__cin.kb.length');
  await tap('#cnSearchX', 'close search');
  const k10 = await ev(`({inputs:document.querySelectorAll('#cinema input').length, active:document.activeElement.tagName, hide:__cin.kb.slice(${kbSeen}).includes(false), searching:NexusCinema.state().searching})`);
  assert(k10.inputs === 0 && k10.active !== 'INPUT' && k10.hide && !k10.searching, 'closing search removes the box and the keyboard ' + JSON.stringify(k10));
  await noKeyboard('after search');
  // Android back while searching does the same
  await tap('#cnSearchBtn'); await ev('Nexus.back()'); await sleep(100);
  assert(!(await S()).searching && await ev(`document.querySelectorAll('#cinema input').length`) === 0, 'Android back closes search too');
  kbSeen = await ev('__cin.kb.length');

  // 11. Play and come back
  await tap(`#cnGrid [data-id="${movieId}"]`);
  await tap('.cn-sheet [data-act=start]', 'PLAY');
  assert.strictEqual((await ev('__cin.plays')).length, 1, 'playback starts');
  await ev(`__cin.progress[${JSON.stringify(movieId)}]={pos:1800000,dur:7260000,done:false,at:Date.now()}; Nexus.resumed()`); await sleep(200);
  assert(await sheet() && /RESUME FROM 30:00/.test(await ev(`document.querySelector('.cn-sheet').textContent`)), 'coming back from the player lands on the same film, ready to resume');
  await noKeyboard('back from the player');
  await snap('06-back-from-player');
  await tap('.cn-sheet-back');
  assert(await ev(`!!document.querySelector('.cn-row .cn-prog')`), 'it shows under Continue watching');
  // finishing an episode brings up the next one
  await tap(`[data-id="${showId}"]`); await tap('.cn-ep:nth-child(1)'); await tap('.cn-sheet [data-act=start]');
  const ep1 = (await ev('__cin.plays')).slice(-1)[0];
  await ev(`__cin.progress[${JSON.stringify(ep1.u + '|' + ep1.r)}]={pos:0,dur:2800000,done:true,at:Date.now()}; Nexus.resumed()`); await sleep(200);
  assert(/S1 E2/.test(await ev(`document.querySelector('.cn-sheet h2').textContent`)), 'after finishing an episode, the next episode is ready');
  await tap('.cn-sheet-back');
  assert(await ev(`/NEXT · S1 E2/.test(document.querySelector('.cn-show-head').textContent)`), 'the show page offers the next episode');
  assert(await ev(`!!document.querySelector('.cn-ep.watched .cn-done')`), 'watched episodes are marked');
  await snap('07-show-watched');
  await tap('#cnHome');
  assert(await ev(`[...document.querySelectorAll('.cn-row .cn-meta span')].some(s=>/S1 E2 · Up next/.test(s.textContent))`), 'Continue watching shows Up next for the show');
  await snap('08-continue');

  // 12. Again, with only Cinema's buttons, and the Android back count from deep inside
  for (let r = 0; r < 3; r++) {
    await tap(`#cnFilters [data-filter=movies]`); await tap(`#cnGrid .cn-card:nth-child(${r + 2})`); await tap('.cn-sheet-back');
    await tap(`#cnFilters [data-filter=tv]`); await tap(`[data-id="${showId}"]`); await tap('.cn-seasons button:nth-child(2)'); await tap('.cn-ep:nth-child(2)'); await tap('.cn-sheet-x');
    await tap('#cnBack'); await tap('#cnBack');
    assert((await S()).filter === 'all' && !(await body()).show, 'round ' + (r + 1) + ' ends on the main screen');
  }
  await noKeyboard('after repeated navigation');
  // deep: search -> show -> episode. Android back unwinds one step each: episode, show, search, (main), exit.
  await tap('#cnSearchBtn'); await ev(`(()=>{const s=document.getElementById('cnSearch');s.value='breaking';s.dispatchEvent(new Event('input'));})()`);
  await tap(`[data-id="${showId}"]`); await tap('.cn-ep:nth-child(1)');
  const steps = [];
  for (let i = 0; i < 6 && await ev('NexusCinema.isOpen()'); i++) { await ev('Nexus.back()'); await sleep(80); const s = await S(); steps.push(!s.open ? 'closed' : (await sheet()) ? 'sheet' : s.show ? 'show' : s.searching ? 'search' : 'main'); }
  assert.deepStrictEqual(steps, ['show', 'search', 'main', 'closed'], 'one Android back per screen: ' + steps);
  kbSeen = await ev('__cin.kb.length');

  // remembered position, and EXIT
  await ev(`document.querySelector('[data-act=cinema]').click()`); await sleep(300);
  await tap(`#cnFilters [data-filter=movies]`);
  await ev(`(()=>{const b=document.getElementById('cnBody');b.scrollTop=300;})()`);
  const keep = (await body()).top;
  await tap('#cnExit', 'EXIT');
  assert(!(await ev('NexusCinema.isOpen()')), 'EXIT leaves Cinema');
  await ev(`document.querySelector('[data-act=cinema]').click()`); await sleep(300);
  assert((await S()).filter === 'movies' && Math.abs((await body()).top - keep) < 2, 'Cinema reopens where it was left (' + (await body()).top + ' vs ' + keep + ')');
  await noKeyboard('on reopening');
  const focus = await ev('__focus');
  assert(focus.every(id => id === 'cnSearch'), 'only the search box was ever focused: ' + focus);
  const errors = await ev('__errors');
  assert.strictEqual(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  console.log('Cinema navigation: the twelve steps with Cinema\'s own buttons, keyboard only for search, one Back per screen, return from the player, Up next, watched marks and remembered position all verified.');
}).catch(e => { console.error(e); process.exit(1); });
