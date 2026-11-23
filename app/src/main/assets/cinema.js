// NEXUS CINEMA — the movie library for external USB drives.
// The box does the drive work (CinemaLibrary.java: detecting drives, read-only scanning, stills, playback);
// this file turns the scanned file list into a library: films, shows with seasons and episodes, search,
// sorting, filters, continue watching and the drive each film lives on. Nothing here can change a drive.
(function () {
  'use strict';
  var A = window.Android || {};
  var $ = function (id) { return document.getElementById(id); };
  var root = null;
  var S = {
    open: false, drives: [], libs: [], progress: {}, info: {},
    filter: 'all', sort: 'title', query: '', show: null, season: null, detail: null,
    scan: {}, items: [], shows: {}, rendered: 0, list: [], notice: ''
  };
  var PAGE = 36;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function call(name) {
    try { if (typeof A[name] === 'function') return A[name].apply(A, Array.prototype.slice.call(arguments, 1)); } catch (e) {}
    return undefined;
  }
  function json(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } }

  // ------------------------------------------------------------------ names -> titles

  // Drives written by a Mac (or copied through a Mac file share) replace some characters in file names with
  // private-use stand-ins (U+F020 for a space, and so on). Show them as plain characters.
  var SFM = { 0xF020: ' ', 0xF021: '"', 0xF022: '*', 0xF023: '/', 0xF024: '<', 0xF025: '>', 0xF026: '?', 0xF027: '\\', 0xF028: '|', 0xF029: ' ', 0xF02A: '.' };
  function norm(s) { return String(s == null ? '' : s).replace(/[\uF000-\uF0FF]/g, function (c) { return SFM[c.charCodeAt(0)] || ' '; }); }
  var VEXT = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|mts|webm|mpg|mpeg|flv|3gp|vob|divx|ogv)$/i;
  var JUNK = /\b(2160p|1080p|720p|480p|4k|uhd|hdr10?|dv|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|hdtv|dvdrip|x26[45]|h\.?26[45]|hevc|avc|aac\d?(\.\d)?|ac3|eac3|dts(-hd)?|truehd|atmos|10bit|remux|proper|repack|extended|unrated|yify|yts|rarbg|ddp?5\.1|5\.1|7\.1)\b.*$/i;
  function cleanTitle(s) {
    s = String(s).replace(VEXT, '');
    if (!/\s/.test(s)) s = s.replace(/[._]+/g, ' ');
    s = s.replace(/_/g, ' ').replace(JUNK, '').replace(/[\[(]\s*[\])]/g, '');
    return s.replace(/\s{2,}/g, ' ').replace(/[\s\-–.]+$/, '').trim();
  }
  function titleYear(s) {
    var base = String(s).replace(VEXT, ''), m = base.match(/^(.*?)[\s._\-]*[\[(]((?:19|20)\d\d)[\])]/);
    if (!m) m = base.match(/^(.*?)[\s._\-]+((?:19|20)\d\d)(?:[\s._\-]|$)/);
    if (m && m[1].trim()) return { title: cleanTitle(m[1]), year: +m[2] };
    return { title: cleanTitle(base), year: 0 };
  }
  function epInfo(name, parts) {
    var m = name.match(/S(\d{1,2})[ ._-]?E(\d{1,3})/i) || name.match(/S(\d{1,2})[ ._-]*(?:episode|ep)[ ._-]*(\d{1,3})/i) || name.match(/\b(\d{1,2})x(\d{2,3})\b/);
    var season = m ? +m[1] : null, ep = m ? +m[2] : 0;
    if (season == null) for (var i = parts.length - 2; i >= 0; i--) { var sm = parts[i].match(/^(?:season|series|staffel|saison)\s*(\d+)/i); if (sm) { season = +sm[1]; break; } }
    if (!ep) { var em = name.match(/(?:episode|ep|e)[\s._-]*(\d{1,3})\b/i) || name.match(/(?:^|[\s._-])-\s*(\d{1,3})(?:[\s._-]|v\d|$)/); if (em) ep = +em[1]; }
    var label = name.replace(VEXT, '').replace(/^.*?S\d{1,2}[ ._-]?E\d{1,3}\s*[;:.\-–]*\s*/i, '').replace(/^S\d{1,2}[ ._-]*(?:episode|ep)[ ._-]*\d+\s*[;:.\-–]*\s*/i, '');
    label = cleanTitle(label);
    return { season: season, episode: ep, label: label };   // season null = not stated
  }
  var CAT_TV = /^(tv|television|tv shows|tv series|shows|series)$/i, CAT_ANIME = /^anime$/i, CAT_MOVIES = /^(movies?|films?)$/i;
  var EXTRAS = /^(extras?|featurettes?|bonus|behind the scenes|trailers?|deleted scenes|ncop|nced)$/i;

  // Build the library from every drive's file list. Films are grouped by their folder; a folder holding
  // several episodes (or Season folders) becomes a show.
  function build() {
    var items = [], shows = {};
    S.libs.forEach(function (lib) {
      var drive = driveOf(lib.uuid), online = !!(drive && drive.mounted && drive.access !== 'none');
      var label = (drive && drive.label) || lib.label || 'USB drive';
      var entries = lib.entries || [];
      // how many videos sit under each candidate show folder
      var under = {};
      entries.forEach(function (e) {
        var p = e.rel.split('/'), ci = catIndex(p);
        if (p.length - ci > 2) { var k = p.slice(0, ci + 2).join('/'); under[k] = (under[k] || 0) + 1; }
      });
      entries.forEach(function (e) {
        var p = e.rel.split('/'), ci = catIndex(p), cat = ci >= 0 ? catOf(p[ci]) : 'movie';
        var showKey = p.length - ci > 2 ? p.slice(0, ci + 2).join('/') : null;
        var np = p.map(norm), ep = epInfo(norm(e.name), np);
        var isExtra = p.slice(ci + 1, -1).some(function (x) { return EXTRAS.test(x); });
        // films live in their own folder; a folder of episodes (or Season folders) is a show
        var episodic = !!showKey && (cat === 'movie' ? !!(ep.season != null && ep.episode) : (under[showKey] > 1 || ep.season != null));
        var base = { uuid: lib.uuid, rel: e.rel, name: e.name, size: e.size || 0, mtime: e.mtime || 0, poster: e.poster || '', subs: e.subs || [], drive: label, online: online, cat: cat };
        if (episodic) {
          var sid = lib.uuid + '|' + showKey, sname = np[ci + 1];
          var sh = shows[sid] || (shows[sid] = { id: sid, kind: 'show', uuid: lib.uuid, cat: cat === 'movie' ? 'tv' : cat, folder: showKey, drive: label, online: online, episodes: [], extras: [], mtime: 0, size: 0 });
          var ty = titleYear(sname.replace(/\s*[-–:]?\s*\b(complete\s+)?(season|series)s?\s*\d+.*$/i, '')); sh.title = ty.title; sh.year = ty.year;
          base.kind = 'episode'; base.show = sid; base.season = ep.season == null ? 1 : ep.season; base.episode = ep.episode; base.title = ep.label || cleanTitle(norm(e.name));
          (isExtra ? sh.extras : sh.episodes).push(base);
          sh.mtime = Math.max(sh.mtime, base.mtime); sh.size += base.size;
        } else {
          if (isExtra) return;
          var folder = np.length >= 2 ? np[np.length - 2] : '', fy = titleYear(folder), ny = titleYear(norm(e.name));
          var useFolder = fy.year && p.length - ci > 2;
          base.kind = 'movie'; base.title = useFolder ? fy.title : ny.title; base.year = useFolder ? fy.year : ny.year;
          if (!base.title) base.title = cleanTitle(norm(e.name));
          items.push(base);
        }
      });
    });
    Object.keys(shows).forEach(function (k) {
      var sh = shows[k];
      sh.episodes.sort(function (a, b) { return (a.season || 999) - (b.season || 999) || a.episode - b.episode || a.name.localeCompare(b.name); });
      sh.seasons = []; sh.episodes.forEach(function (e) { if (sh.seasons.indexOf(e.season) < 0) sh.seasons.push(e.season); });
      sh.first = sh.episodes[0] || sh.extras[0];
      if (sh.first) items.push(sh);
    });
    S.items = items; S.shows = shows;
  }
  function catIndex(p) {
    for (var i = 0; i < p.length - 1; i++) if (CAT_TV.test(p[i]) || CAT_ANIME.test(p[i]) || CAT_MOVIES.test(p[i])) return i;
    return -1;
  }
  function catOf(n) { return CAT_TV.test(n) ? 'tv' : CAT_ANIME.test(n) ? 'anime' : 'movie'; }
  function driveOf(uuid) { for (var i = 0; i < S.drives.length; i++) if (S.drives[i].uuid === uuid) return S.drives[i]; return null; }

  // ------------------------------------------------------------------ data from the box

  function loadAll() {
    S.drives = json(call('cinemaDrives'), []) || [];
    S.libs = json(call('cinemaLibrary'), []) || [];
    S.progress = json(call('cinemaProgress'), {}) || {};
    build();
  }
  function prog(it) { return S.progress[it.uuid + '|' + it.rel]; }
  function showProgress(sh) {
    var best = null;
    sh.episodes.forEach(function (e) { var p = prog(e); if (p && !p.done && p.pos > 0 && (!best || p.at > best.p.at)) best = { e: e, p: p }; });
    return best;
  }

  // ------------------------------------------------------------------ screen

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'cinema';
    root.className = 'layer hidden';
    root.innerHTML =
      '<div class="cn-bg"></div>' +
      '<header class="cn-top">' +
        '<button class="cn-back" id="cnBack" aria-label="Back">‹</button>' +
        '<div class="cn-brand"><b>NEXUS</b> CINEMA</div>' +
        '<label class="cn-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input id="cnSearch" type="search" placeholder="Search your movies" autocomplete="off"></label>' +
        '<select id="cnSort" aria-label="Sort"><option value="title">A–Z</option><option value="added">Recently added</option><option value="year">Newest</option><option value="oldest">Oldest</option><option value="size">Largest</option></select>' +
        '<button class="cn-rescan" id="cnRescan">↻ RESCAN</button>' +
      '</header>' +
      '<nav class="cn-filters" id="cnFilters"></nav>' +
      '<div class="cn-drives" id="cnDrives"></div>' +
      '<div class="cn-scan hidden" id="cnScan"><div class="cn-scan-bar"><i></i></div><span></span></div>' +
      '<main class="cn-body" id="cnBody"></main>' +
      '<div class="cn-sheet hidden" id="cnSheet"></div>' +
      '<div class="cn-toast" id="cnToast"></div>';
    document.body.appendChild(root);
    $('cnBack').addEventListener('click', back);
    $('cnSearch').addEventListener('input', function () { S.query = this.value; S.show = null; render(); });
    $('cnSort').addEventListener('change', function () { S.sort = this.value; render(); });
    $('cnRescan').addEventListener('click', rescanAll);
    $('cnBody').addEventListener('scroll', function () { var b = $('cnBody'); if (b.scrollTop + b.clientHeight > b.scrollHeight - 600) more(); }, { passive: true });
    $('cnBody').addEventListener('click', onBodyClick);
    $('cnDrives').addEventListener('click', onDriveClick);
    $('cnFilters').addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]'); if (!b) return;
      S.filter = b.getAttribute('data-filter'); S.show = null; render();
    });
    $('cnSheet').addEventListener('click', onSheetClick);
    return root;
  }

  function thumb(it) {
    if (!it) return '';
    return 'https://cinema.nexus/thumb?u=' + encodeURIComponent(it.uuid) + '&r=' + encodeURIComponent(it.rel) + (it.poster ? '&p=' + encodeURIComponent(it.poster) : '');
  }
  function hue(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss : m + ':' + (ss < 10 ? '0' : '') + ss;
  }
  function fmtSize(b) { return b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB'; }
  function fmtRuntime(ms) { var m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }

  function visible() {
    var q = S.query.trim().toLowerCase();
    var list = S.items.filter(function (it) {
      if (S.filter === 'movies' && !(it.kind === 'movie' && it.cat !== 'anime')) return false;
      if (S.filter === 'tv' && !(it.kind === 'show' && it.cat !== 'anime')) return false;
      if (S.filter === 'anime' && it.cat !== 'anime') return false;
      if (S.filter === 'continue' && !(it.kind === 'show' ? showProgress(it) : (prog(it) && !prog(it).done && prog(it).pos > 0))) return false;
      if (!q) return true;
      if ((it.title || '').toLowerCase().indexOf(q) >= 0 || String(it.year || '').indexOf(q) === 0) return true;
      return it.kind === 'show' && it.episodes.some(function (e) { return (e.title || '').toLowerCase().indexOf(q) >= 0; });
    });
    var by = {
      title: function (a, b) { return sortKey(a.title).localeCompare(sortKey(b.title)) || (a.year || 0) - (b.year || 0); },
      added: function (a, b) { return (b.mtime || 0) - (a.mtime || 0); },
      year: function (a, b) { return (b.year || 0) - (a.year || 0) || sortKey(a.title).localeCompare(sortKey(b.title)); },
      oldest: function (a, b) { return (a.year || 9999) - (b.year || 9999) || sortKey(a.title).localeCompare(sortKey(b.title)); },
      size: function (a, b) { return (b.size || 0) - (a.size || 0); }
    };
    if (S.filter === 'continue') list.sort(function (a, b) { return lastAt(b) - lastAt(a); });
    else list.sort(by[S.sort] || by.title);
    return list;
  }
  function lastAt(it) { if (it.kind === 'show') { var p = showProgress(it); return p ? p.p.at : 0; } var q = prog(it); return q ? q.at : 0; }
  function sortKey(t) { return String(t || '').toLowerCase().replace(/^(the|a|an)\s+/, ''); }

  function counts() {
    var c = { all: S.items.length, movies: 0, tv: 0, anime: 0, continue: 0 };
    S.items.forEach(function (it) {
      if (it.kind === 'movie' && it.cat !== 'anime') c.movies++;
      if (it.kind === 'show' && it.cat !== 'anime') c.tv++;
      if (it.cat === 'anime') c.anime++;
      if (it.kind === 'show' ? showProgress(it) : (prog(it) && !prog(it).done && prog(it).pos > 0)) c.continue++;
    });
    return c;
  }

  function renderFilters() {
    var c = counts(), f = [['all', 'All'], ['continue', 'Continue watching'], ['movies', 'Movies'], ['tv', 'TV shows'], ['anime', 'Anime']];
    $('cnFilters').innerHTML = f.filter(function (x) { return x[0] === 'all' || c[x[0]] > 0 || S.filter === x[0]; }).map(function (x) {
      return '<button data-filter="' + x[0] + '" class="' + (S.filter === x[0] ? 'on' : '') + '">' + x[1] + ' <i>' + c[x[0]] + '</i></button>';
    }).join('');
  }

  function renderDrives() {
    var rows = [], seen = {};
    S.drives.forEach(function (d) {
      seen[d.uuid] = 1;
      var sc = S.scan[d.uuid], lib = libOf(d.uuid), status, action = '';
      if (!d.mounted) status = 'Not ready';
      else if (d.access === 'none') { status = 'Needs your OK to read it'; action = '<button data-grant="' + esc(d.uuid) + '" class="cn-primary">CONNECT DRIVE</button>'; }
      else if (sc) status = 'Scanning… ' + sc.videos + ' videos found';
      else status = lib ? (lib.entries || []).length + ' videos · ready' : 'Ready to scan';
      rows.push('<div class="cn-drive ' + (d.mounted ? 'on' : '') + '"><span class="dot"></span><b>' + esc(d.label) + '</b><span>' + esc(status) + '</span>' + action + '</div>');
    });
    S.libs.forEach(function (l) {
      if (seen[l.uuid]) return;
      rows.push('<div class="cn-drive off"><span class="dot"></span><b>' + esc(l.label || 'USB drive') + '</b><span>Not connected · ' + (l.entries || []).length + ' videos remembered</span></div>');
    });
    $('cnDrives').innerHTML = rows.join('');
    $('cnRescan').style.display = S.drives.some(function (d) { return d.mounted && d.access !== 'none'; }) ? '' : 'none';
  }
  function libOf(uuid) { for (var i = 0; i < S.libs.length; i++) if (S.libs[i].uuid === uuid) return S.libs[i]; return null; }

  function card(it) {
    var p = it.kind === 'show' ? (showProgress(it) || {}).p : prog(it), pct = p && !p.done && p.dur ? Math.min(100, p.pos / p.dur * 100) : 0;
    var still = it.kind === 'show' ? it.first : it;
    var sub = it.kind === 'show' ? (it.seasons.length > 1 ? it.seasons.length + ' seasons' : it.episodes.length + ' episodes') : (it.year || '');
    return '<div class="cn-card' + (it.online ? '' : ' offline') + '" data-id="' + esc(it.kind === 'show' ? it.id : it.uuid + '|' + it.rel) + '" style="--h:' + hue(it.title) + '">' +
      '<div class="cn-still"><div class="cn-ph"><span>' + esc(it.title) + '</span></div>' +
      '<img loading="lazy" decoding="async" src="' + thumb(still) + '" onload="this.parentNode.classList.add(\'img\')" onerror="this.remove()" alt="">' +
      (it.kind === 'show' ? '<em class="cn-tag">' + (it.cat === 'anime' ? 'ANIME' : 'SERIES') + '</em>' : '') +
      (it.online ? '' : '<em class="cn-off">OFFLINE</em>') +
      (pct ? '<div class="cn-prog"><i style="width:' + pct.toFixed(1) + '%"></i></div>' : '') +
      (p && p.done ? '<em class="cn-done">✓</em>' : '') +
      '</div><div class="cn-meta"><b>' + esc(it.title) + '</b><span>' + esc(sub) + (multiDrive() ? ' · ' + esc(it.drive) : '') + '</span></div></div>';
  }
  function multiDrive() { return S.libs.length > 1; }

  function render() {
    if (!root) return;
    renderFilters();
    renderDrives();
    var body = $('cnBody');
    if (S.show && S.shows[S.show]) { renderShow(S.shows[S.show]); return; }
    S.list = visible();
    S.rendered = 0;
    var hero = '';
    if (!S.items.length) { body.innerHTML = emptyState(); return; }
    if (S.filter === 'all' && !S.query) {
      var cont = S.items.filter(function (it) { return it.kind === 'show' ? showProgress(it) : (prog(it) && !prog(it).done && prog(it).pos > 0); })
        .sort(function (a, b) { return lastAt(b) - lastAt(a); }).slice(0, 8);
      if (cont.length) hero = '<h3 class="cn-row-title">Continue watching</h3><div class="cn-row">' + cont.map(card).join('') + '</div><h3 class="cn-row-title">Your library</h3>';
    }
    if (!S.list.length) { body.innerHTML = hero + '<div class="cn-empty small">Nothing matches “' + esc(S.query) + '”.</div>'; return; }
    body.innerHTML = hero + '<div class="cn-grid" id="cnGrid"></div>';
    body.scrollTop = 0;
    more();
  }
  function more() {
    var g = $('cnGrid'); if (!g || S.rendered >= S.list.length) return;
    var next = S.list.slice(S.rendered, S.rendered + PAGE);
    S.rendered += next.length;
    g.insertAdjacentHTML('beforeend', next.map(card).join(''));
    var b = $('cnBody'); if (b.scrollHeight <= b.clientHeight + 200 && S.rendered < S.list.length) setTimeout(more, 0);
  }

  function emptyState() {
    var connected = S.drives.filter(function (d) { return d.mounted; });
    var need = connected.filter(function (d) { return d.access === 'none'; });
    if (need.length) return '<div class="cn-empty"><div class="cn-empty-ic">🎬</div><h2>Your movie drive is plugged in</h2><p>Nexus needs your OK once to read “' + esc(need[0].label) + '”. Nothing on the drive will be changed.</p><button class="cn-primary big" data-grant="' + esc(need[0].uuid) + '">CONNECT DRIVE</button></div>';
    if (connected.some(function (d) { return S.scan[d.uuid]; })) return '<div class="cn-empty"><div class="cn-empty-ic spin">◌</div><h2>Building your library…</h2><p>Looking through every folder on your drive.</p></div>';
    if (connected.length) return '<div class="cn-empty"><div class="cn-empty-ic">🎬</div><h2>No movies found yet</h2><p>Tap rescan to look through the drive again.</p><button class="cn-primary big" data-rescan="1">RESCAN DRIVE</button></div>';
    return '<div class="cn-empty"><div class="cn-empty-ic">🔌</div><h2>Plug in your movie drive</h2><p>Connect your USB hard drive to the box. Your movies will appear here automatically.</p></div>';
  }

  function renderShow(sh) {
    var body = $('cnBody');
    if (S.season == null || sh.seasons.indexOf(S.season) < 0) { var cp = showProgress(sh); S.season = cp ? cp.e.season : sh.seasons[0]; }
    var eps = sh.episodes.filter(function (e) { return e.season === S.season; });
    var cp2 = showProgress(sh);
    var html = '<div class="cn-show-head" style="--h:' + hue(sh.title) + '"><div class="cn-show-art"><img src="' + thumb(sh.first) + '" onerror="this.remove()" alt=""></div>' +
      '<div class="cn-show-txt"><h2>' + esc(sh.title) + '</h2><p>' + (sh.year ? sh.year + ' · ' : '') + sh.episodes.length + ' episodes' + (sh.seasons.length > 1 ? ' · ' + sh.seasons.length + ' seasons' : '') + ' · ' + esc(sh.drive) + (sh.online ? '' : ' (not connected)') + '</p>' +
      (sh.online && cp2 ? '<button class="cn-primary" data-play="' + esc(cp2.e.uuid + '|' + cp2.e.rel) + '" data-resume="1">▶ RESUME S' + cp2.e.season + ' E' + (cp2.e.episode || '?') + '</button>' : sh.online && sh.episodes[0] ? '<button class="cn-primary" data-play="' + esc(sh.episodes[0].uuid + '|' + sh.episodes[0].rel) + '">▶ PLAY FIRST EPISODE</button>' : '') +
      '</div></div>';
    if (sh.seasons.length > 1) html += '<div class="cn-seasons">' + sh.seasons.map(function (s) { return '<button data-season="' + s + '" class="' + (s === S.season ? 'on' : '') + '">' + (s ? 'Season ' + s : 'Specials') + '</button>'; }).join('') + '</div>';
    html += '<div class="cn-eps">' + eps.map(epRow).join('') + '</div>';
    if (sh.extras.length) html += '<h3 class="cn-row-title">Extras</h3><div class="cn-eps">' + sh.extras.map(epRow).join('') + '</div>';
    body.innerHTML = html;
  }
  function epRow(e) {
    var p = prog(e), pct = p && !p.done && p.dur ? p.pos / p.dur * 100 : 0;
    return '<div class="cn-ep' + (e.online ? '' : ' offline') + '" data-id="' + esc(e.uuid + '|' + e.rel) + '">' +
      '<div class="cn-ep-still" style="--h:' + hue(e.title) + '"><img loading="lazy" src="' + thumb(e) + '" onerror="this.remove()" alt="">' + (pct ? '<div class="cn-prog"><i style="width:' + pct.toFixed(1) + '%"></i></div>' : '') + '</div>' +
      '<div class="cn-ep-txt"><b>' + (e.episode ? e.episode + '. ' : '') + esc(e.title) + '</b><span>' + fmtSize(e.size) + (p && p.done ? ' · watched' : p && p.pos ? ' · ' + fmtTime(p.pos) + ' watched' : '') + '</span></div>' +
      '<span class="cn-ep-play">▶</span></div>';
  }

  // ------------------------------------------------------------------ details and playing

  function findItem(id) {
    if (S.shows[id]) return S.shows[id];
    for (var i = 0; i < S.items.length; i++) { var it = S.items[i]; if (it.kind === 'movie' && it.uuid + '|' + it.rel === id) return it; }
    for (var k in S.shows) { var eps = S.shows[k].episodes.concat(S.shows[k].extras); for (var j = 0; j < eps.length; j++) if (eps[j].uuid + '|' + eps[j].rel === id) return eps[j]; }
    return null;
  }

  function openDetail(it) {
    S.detail = it.uuid + '|' + it.rel;
    var p = prog(it), inf = S.info[S.detail];
    if (!inf && it.online) call('cinemaInfo', it.uuid, it.rel);
    var resume = p && !p.done && p.pos > 30000;
    var facts = [];
    if (it.year) facts.push(it.year);
    if (inf && inf.duration) facts.push(fmtRuntime(inf.duration));
    if (inf && inf.height) facts.push(inf.height >= 2000 ? '4K' : inf.height >= 1000 ? 'HD 1080p' : inf.height >= 700 ? 'HD 720p' : inf.height + 'p');
    facts.push(fmtSize(it.size));
    if (it.subs && it.subs.length) facts.push('Subtitles');
    var sh = $('cnSheet');
    sh.innerHTML = '<div class="cn-sheet-card" style="--h:' + hue(it.title) + '">' +
      '<div class="cn-sheet-art"><img src="' + thumb(it) + '" onerror="this.remove()" alt=""><div class="cn-sheet-fade"></div></div>' +
      '<div class="cn-sheet-txt"><h2>' + esc(it.kind === 'episode' ? (S.shows[it.show] ? S.shows[it.show].title + ' · ' : '') + 'S' + it.season + ' E' + (it.episode || '?') : it.title) + '</h2>' +
      (it.kind === 'episode' ? '<h4>' + esc(it.title) + '</h4>' : '') +
      '<p class="cn-facts">' + facts.map(esc).join('  ·  ') + '</p>' +
      '<p class="cn-where">On <b>' + esc(it.drive) + '</b> · ' + esc(it.rel) + '</p>' +
      (it.online ? (resume ? '<div class="cn-acts"><button class="cn-primary big" data-act="resume">▶ RESUME FROM ' + fmtTime(p.pos) + '</button><button class="cn-ghost" data-act="start">START OVER</button></div>' :
        '<div class="cn-acts"><button class="cn-primary big" data-act="start">▶ PLAY' + (p && p.done ? ' AGAIN' : '') + '</button></div>') :
        '<div class="cn-offline-msg">Plug in “' + esc(it.drive) + '” to watch this.</div>') +
      '</div><button class="cn-sheet-x" data-act="close">✕</button></div>';
    sh.classList.remove('hidden');
  }
  function closeDetail() { S.detail = null; $('cnSheet').classList.add('hidden'); }

  function play(it, fromStart) {
    var p = prog(it), start = !fromStart && p && !p.done ? p.pos : 0;
    var title = it.kind === 'episode' && S.shows[it.show] ? S.shows[it.show].title + ' · S' + it.season + ' E' + (it.episode || '?') + (it.title ? ' · ' + it.title : '') : it.title + (it.year ? ' (' + it.year + ')' : '');
    var ok = call('cinemaPlay', it.uuid, it.rel, title, start, JSON.stringify(it.subs || []));
    if (ok === false) toast('This drive isn’t connected right now.');
    else { S.playing = it.uuid + '|' + it.rel; closeDetail(); }
    return ok;
  }

  function onBodyClick(e) {
    var g = e.target.closest('[data-grant]'); if (g) { grant(g.getAttribute('data-grant')); return; }
    if (e.target.closest('[data-rescan]')) { rescanAll(); return; }
    var se = e.target.closest('[data-season]'); if (se) { S.season = +se.getAttribute('data-season'); render(); return; }
    var pl = e.target.closest('[data-play]');
    if (pl) { var it0 = findItem(pl.getAttribute('data-play')); if (it0) play(it0, !pl.getAttribute('data-resume')); return; }
    var c = e.target.closest('[data-id]'); if (!c) return;
    var it = findItem(c.getAttribute('data-id')); if (!it) return;
    if (it.kind === 'show') { S.show = it.id; S.season = null; render(); $('cnBody').scrollTop = 0; return; }
    openDetail(it);
  }
  function onSheetClick(e) {
    if (e.target === $('cnSheet')) { closeDetail(); return; }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var a = b.getAttribute('data-act'), it = findItem(S.detail);
    if (a === 'close') closeDetail();
    else if (it && a === 'resume') play(it, false);
    else if (it && a === 'start') play(it, true);
  }
  function onDriveClick(e) { var g = e.target.closest('[data-grant]'); if (g) grant(g.getAttribute('data-grant')); }
  function grant(uuid) { toast('Allow Nexus to read the drive on the next screen.'); call('cinemaGrant', uuid); }
  function rescanAll() {
    var any = false;
    S.drives.forEach(function (d) { if (d.mounted && d.access !== 'none') { any = true; S.scan[d.uuid] = { videos: 0, folders: 0, folder: '' }; call('cinemaScan', d.uuid); } });
    if (any) { showScan(); renderDrives(); } else toast('No drive to scan. Plug in your movie drive.');
  }

  function toast(t) {
    var el = $('cnToast'); if (!el) return;
    el.textContent = t; el.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove('on'); }, 4200);
  }
  function showScan() {
    var el = $('cnScan'); if (!el) return;
    var keys = Object.keys(S.scan);
    if (!keys.length) { el.classList.add('hidden'); return; }
    var sc = S.scan[keys[0]], d = driveOf(keys[0]);
    el.classList.remove('hidden');
    el.querySelector('span').textContent = 'Scanning ' + (d ? d.label : 'drive') + ' · ' + sc.videos + ' videos in ' + sc.folders + ' folders' + (sc.folder ? ' · ' + sc.folder : '');
  }

  // ------------------------------------------------------------------ open / close / back

  function open() {
    ensureRoot();
    loadAll();
    S.open = true; S.show = null; S.filter = S.filter || 'all';
    root.classList.remove('hidden');
    render();
    // a drive that's plugged in and allowed, but not scanned since it was connected, is scanned now
    S.drives.forEach(function (d) {
      if (d.mounted && d.access !== 'none' && !d.scannedThisConnection && !d.scanning && !S.scan[d.uuid]) {
        S.scan[d.uuid] = { videos: 0, folders: 0, folder: '' }; call('cinemaScan', d.uuid);
      }
    });
    showScan(); renderDrives();
  }
  function close() {
    if (!root) return;
    S.open = false; closeDetail(); S.show = null;
    root.classList.add('hidden');
  }
  function back() {
    if (!S.open) return false;
    if (S.detail) { closeDetail(); return true; }
    if (S.show) { S.show = null; render(); return true; }
    close(); return true;
  }

  // ------------------------------------------------------------------ events from the box

  window.NexusCinema = {
    open: open, close: close, back: back,
    isOpen: function () { return S.open; },
    state: function () { return S; },
    _parse: { norm: norm, titleYear: titleYear, epInfo: epInfo, cleanTitle: cleanTitle },
    _drives: function (j) {
      var before = {}; S.drives.forEach(function (d) { before[d.uuid] = d.mounted; });
      S.drives = json(j, S.drives) || [];
      S.drives.forEach(function (d) {
        if (d.scanning && !S.scan[d.uuid]) S.scan[d.uuid] = { videos: 0, folders: 0, folder: '' };
        if (!d.mounted || d.access === 'none') delete S.scan[d.uuid];
        if (d.mounted && !before[d.uuid] && S.open) toast(d.label + ' connected' + (d.access === 'none' ? ' · tap CONNECT DRIVE' : ''));
      });
      Object.keys(before).forEach(function (u) { if (before[u] && !driveOf(u) && S.open) { var l = libOf(u); toast((l ? l.label : 'Drive') + ' disconnected · its movies stay listed as offline'); } });
      Object.keys(S.scan).forEach(function (u) { if (!driveOf(u)) delete S.scan[u]; });
      build();
      if (S.open) { render(); showScan(); if (S.detail) { var it = findItem(S.detail); if (it) openDetail(it); } }
    },
    _progress: function (j) {
      var p = json(j, null); if (!p) return;
      S.scan[p.uuid] = p;
      if (S.open) { showScan(); renderDrives(); }
    },
    _scanned: function (j) {
      var r = json(j, {}) || {};
      delete S.scan[r.uuid];
      S.libs = json(call('cinemaLibrary'), S.libs) || S.libs;
      S.drives = json(call('cinemaDrives'), S.drives) || S.drives;
      build();
      if (S.open) {
        showScan(); render();
        if (r.first) toast('Library ready · ' + r.videos + ' videos');
        else if (r.added || r.removed) toast('Library updated · ' + (r.added ? r.added + ' new' : '') + (r.added && r.removed ? ', ' : '') + (r.removed ? r.removed + ' gone' : ''));
        else toast('Library is up to date · ' + r.videos + ' videos');
      }
    },
    _scanAborted: function (uuid, msg) { delete S.scan[uuid]; if (S.open) { showScan(); render(); toast(msg); } },
    _error: function (msg) { if (S.open) toast(msg); },
    _info: function (j) {
      var o = json(j, null); if (!o) return;
      S.info[o.uuid + '|' + o.rel] = o;
      if (S.detail === o.uuid + '|' + o.rel) { var it = findItem(S.detail); if (it) openDetail(it); }
    },
    // back from the player: positions changed
    _resumed: function () {
      if (!S.open) return;
      S.progress = json(call('cinemaProgress'), S.progress) || S.progress;
      render();
    }
  };
})();
