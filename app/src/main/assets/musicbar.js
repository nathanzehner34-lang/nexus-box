// NEXUS MUSIC BAR — a small music remote that floats over the full-screen experiences (Liquid Dreams,
// Night Drive, the Visuals scenes and the other experiences). Previous / play-pause / next, plus the song
// when Nexus can see it. It shows when an experience opens and whenever the screen is touched, then fades
// away after a few seconds so it never covers the picture. It only takes touches on its own buttons:
// everything else (Liquid Dreams' touch effects, the experience's own controls) works exactly as before.
// Play uses Nexus's background resume, so Spotify carries on from the last song without opening its screen.
(function () {
  'use strict';
  var A = window.Android || null;
  var xp = document.getElementById('xp');
  if (!xp) return;
  var SHOW_MS = 4000;
  var bar = null, hideT = 0, pollT = 0, open = false, playing = null, lastTitle = '';

  function pref(k) { try { return A && A.getPref ? A.getPref(k) : (localStorage.getItem('p_' + k) || ''); } catch (e) { return ''; } }
  function enabled() { return pref('musicBar') !== '0'; }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var ICON = {
    prev: '<svg viewBox="0 0 24 24"><path d="M6 5v14M19 5.5 9 12l10 6.5z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13L19 12z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13M16 5.5v13"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M18 5v14M5 5.5 15 12 5 18.5z"/></svg>'
  };

  function build() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'nxMusic';
    bar.className = 'nxm-hide';
    bar.innerHTML =
      '<button class="nxm-b" data-m="prev" aria-label="Previous song">' + ICON.prev + '</button>' +
      '<button class="nxm-b nxm-main" data-m="toggle" aria-label="Play or pause">' + ICON.play + '</button>' +
      '<button class="nxm-b" data-m="next" aria-label="Next song">' + ICON.next + '</button>' +
      '<div class="nxm-t"><b></b><span></span></div>';
    bar.addEventListener('pointerdown', function (e) { e.stopPropagation(); show(); }, true);
    bar.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest('[data-m]'); if (!b || !A || !A.media) return;
      var m = b.getAttribute('data-m');
      if (m === 'toggle') { setPlaying(!playing); if (playing && A.musicResume) A.musicResume(); else A.media('pause'); }
      else A.media(m);
      b.classList.add('nxm-hit'); setTimeout(function () { b.classList.remove('nxm-hit'); }, 220);
      show(); setTimeout(poll, 900); setTimeout(poll, 2500);
    });
    xp.appendChild(bar);
    return bar;
  }

  function setPlaying(p) {
    playing = !!p;
    var main = bar && bar.querySelector('.nxm-main');
    if (main) main.innerHTML = playing ? ICON.pause : ICON.play;
    if (bar) bar.classList.toggle('nxm-playing', playing);
  }

  function poll() {
    if (!open || !bar || !A || !A.nowPlaying) return;
    var np = {};
    try { np = JSON.parse(A.nowPlaying() || '{}'); } catch (e) {}
    var active = false; try { active = A.isMusicActive ? !!A.isMusicActive() : !!np.playing; } catch (e) { active = !!np.playing; }
    setPlaying(np.playing != null ? (np.playing || active) : active);
    var title = np.title && np.title !== 'null' ? String(np.title) : '', artist = np.artist && np.artist !== 'null' ? String(np.artist) : '';
    bar.querySelector('.nxm-t b').textContent = title || (playing ? 'Playing' : 'Music');
    bar.querySelector('.nxm-t span').textContent = title ? artist : (playing ? '' : 'Tap ▶ to carry on where you left off');
    if (title && title !== lastTitle) { if (lastTitle) show(); lastTitle = title; }   // a new song: show it briefly
  }

  function show() {
    if (!open || !enabled()) return;
    build(); bar.classList.remove('nxm-hide');
    clearTimeout(hideT);
    hideT = setTimeout(function () { if (bar) bar.classList.add('nxm-hide'); }, SHOW_MS);
  }

  function start() {
    if (open) return;
    open = true;
    if (!enabled()) return;
    build(); poll(); show();
    clearInterval(pollT); pollT = setInterval(poll, 2500);
  }
  function stop() {
    open = false; clearInterval(pollT); clearTimeout(hideT);
    if (bar) bar.classList.add('nxm-hide');
  }

  // any touch on the experience brings the bar back (without taking the touch away from the experience)
  xp.addEventListener('pointerdown', function () { if (open) show(); }, { capture: true, passive: true });
  xp.addEventListener('keydown', function () { if (open) show(); }, true);

  function sync() { if (xp.classList.contains('hidden')) stop(); else start(); }
  new MutationObserver(sync).observe(xp, { attributes: true, attributeFilter: ['class'] });
  sync();

  window.NexusMusicBar = {
    state: function () { return { open: open, shown: !!(bar && !bar.classList.contains('nxm-hide')), playing: playing, enabled: enabled() }; },
    show: show
  };
})();
