/* NEXUS PARTY · ORB FIELD
 * Isolated, event-scoped renderer. The Android bridge and app.js retain ownership
 * of media transport, navigation, and Party Mode entry/exit.
 */
(function () {
  'use strict';
  var root = document.getElementById('party'), canvas = document.getElementById('partyCanvas');
  if (!root || !canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  var modes = ['pulse', 'wave', 'vortex', 'chrome', 'chaos', 'ripple'];
  var presets = {
    voltage: { accent: [0, 213, 215], colors: ['#00f5d4', '#39ff14', '#f8ff00', '#168bff', '#ff27ce', '#59fff4'] },
    aurora: { accent: [0, 205, 221], colors: ['#00fff0', '#42ff76', '#15aaff', '#8f5cff', '#ff45db', '#e6ff35'] },
    neon: { accent: [35, 145, 255], colors: ['#22e9ff', '#47ff31', '#ffef00', '#168bff', '#ff35d0', '#fff7d1'] }
  };
  var mode = 'pulse', preset = 'voltage', active = false, raf = 0, runId = 0, pollTimer = 0, lastFrame = 0;
  var w = 1, h = 1, scale = 1, musicLevel = .12, audioSource = 'fallback';
  var orbs = [], impulses = [], selected = null, pointer = null, dragVelocity = { x: 0, y: 0 };
  var sprites = {}, audio = null, soundOn = false, lastSong = '', artworkUrl = '';
  var modeStarted = 0, lastPoll = 0;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function accent(alpha) { var c = presets[preset].accent; return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')'; }
  function setPreset(name) {
    if (!presets[name]) return;
    preset = name; sprites = {};
    root.setAttribute('data-preset', name);
    Array.prototype.forEach.call(document.querySelectorAll('.party-preset'), function (el) {
      el.classList.toggle('active', el.getAttribute('data-preset') === name);
      el.setAttribute('aria-pressed', el.getAttribute('data-preset') === name ? 'true' : 'false');
    });
    for (var i = 0; i < orbs.length; i++) orbs[i].color = i % presets[preset].colors.length;
    try { localStorage.setItem('nexus.party.preset', name); } catch (e) {}
  }
  function setMode(name) {
    if (modes.indexOf(name) < 0) return;
    if (mode !== name) {
      mode = name; modeStarted = performance.now();
      impulses.length = 0;
      for (var i = 0; i < orbs.length; i++) {
        var o = orbs[i];
        if (name === 'chaos') { o.vx += rand(-1.6, 1.6); o.vy += rand(-1.6, 1.6); }
        else if (name === 'vortex') { o.vx += (w * .5 - o.x) * .002; o.vy += (h * .46 - o.y) * .002; }
        else if (name === 'wave') { o.waveBase = o.y; o.waveX = o.x; }
      }
    }
    Array.prototype.forEach.call(document.querySelectorAll('.party-mode'), function (el) {
      el.classList.toggle('active', el.getAttribute('data-mode') === name);
      el.setAttribute('aria-pressed', el.getAttribute('data-mode') === name ? 'true' : 'false');
    });
    root.setAttribute('data-mode', name);
  }
  function addOrb(x, y, index) {
    return { x: x, y: y, vx: rand(-.45, .45), vy: rand(-.4, .4), r: rand(10, 26),
      phase: rand(0, 6.28), rate: rand(.0017, .0046), color: index % presets[preset].colors.length,
      waveX: x, waveBase: y, nextImpulse: 0 };
  }
  function resize() {
    var rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    w = rect.width; h = rect.height;
    scale = Math.min(window.devicePixelRatio || 1, .82);
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (!orbs.length) {
      for (var i = 0; i < 22; i++) orbs.push(addOrb(rand(20, w - 20), rand(20, h - 20), i));
    } else {
      for (var j = 0; j < orbs.length; j++) {
        orbs[j].x = clamp(orbs[j].x, 12, w - 12); orbs[j].y = clamp(orbs[j].y, 12, h - 12);
      }
    }
  }
  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function makeSprite(colorIndex, chrome) {
    var key = preset + ':' + colorIndex + ':' + (chrome ? 'c' : 'n');
    if (sprites[key]) return sprites[key];
    var side = 160, off = document.createElement('canvas'); off.width = side; off.height = side;
    var g = off.getContext('2d'), col = presets[preset].colors[colorIndex % presets[preset].colors.length], rgb = hexRgb(col);
    var body = g.createRadialGradient(58, 52, 3, 80, 80, 64);
    if (chrome) {
      body.addColorStop(0, '#ffffff'); body.addColorStop(.12, '#f4ffff'); body.addColorStop(.23, col);
      body.addColorStop(.42, '#eaf7ff'); body.addColorStop(.55, '#536c87'); body.addColorStop(.68, '#f9ffff');
      body.addColorStop(.82, col); body.addColorStop(1, 'rgba(2,6,12,0)');
    } else {
      body.addColorStop(0, '#ffffff'); body.addColorStop(.12, 'rgba(255,255,255,.98)');
      body.addColorStop(.25, col); body.addColorStop(.48, 'rgba(' + rgb.join(',') + ',.92)');
      body.addColorStop(.72, 'rgba(' + rgb.join(',') + ',.35)'); body.addColorStop(1, 'rgba(' + rgb.join(',') + ',0)');
    }
    g.fillStyle = body; g.beginPath(); g.arc(80, 80, 64, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.arc(80, 80, 48, 0, Math.PI * 2); g.clip();
    var sheen = g.createRadialGradient(58, 51, 1, 62, 58, 36);
    sheen.addColorStop(0, chrome ? 'rgba(255,255,255,.88)' : 'rgba(255,255,255,.7)');
    sheen.addColorStop(.28, chrome ? 'rgba(255,255,255,.24)' : 'rgba(255,255,255,.12)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen; g.fillRect(20, 20, 120, 120);
    if (chrome) {
      var shine = g.createLinearGradient(38, 0, 122, 0);
      shine.addColorStop(0, 'rgba(255,255,255,0)'); shine.addColorStop(.38, 'rgba(255,255,255,.08)');
      shine.addColorStop(.5, 'rgba(255,255,255,.74)'); shine.addColorStop(.62, 'rgba(255,255,255,.08)');
      shine.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = shine; g.fillRect(30, 28, 100, 104);
    }
    g.restore();
    sprites[key] = off;
    return off;
  }
  function ripple(x, y, power) {
    impulses.push({ x: x, y: y, front: 0, life: 1, power: power });
    if (impulses.length > 5) impulses.shift();
  }
  function sound(freq, duration) {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var osc = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
      osc.type = 'sine'; osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(55, freq * .62), now + duration);
      gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.023, now + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      osc.connect(gain); gain.connect(audio.destination); osc.start(now); osc.stop(now + duration + .025);
    } catch (e) {}
  }
  function bassCannon() {
    ripple(w * .5, h * .48, 1.5);
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i], dx = o.x - w * .5, dy = o.y - h * .48, d = Math.sqrt(dx * dx + dy * dy) || 1;
      o.vx += dx / d * 7; o.vy += dy / d * 7; o.flash = 1;
    }
    sound(95, .48);
  }
  function update(dt, now) {
    var step = Math.min(2, dt / 16.67), cx = w * .5, cy = h * .46, elapsed = now - modeStarted;
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i];
      if (o === selected && pointer) { o.x = pointer.x; o.y = pointer.y; continue; }
      if (mode === 'wave') {
        o.waveX += (.35 + i % 4 * .08) * step;
        if (o.waveX > w + 30) o.waveX = -30;
        o.x = o.waveX;
        var localPhase = o.waveX / w * 6.2 - now * .0016 + o.phase;
        o.y += ((o.waveBase + Math.sin(localPhase) * Math.min(105, h * .17)) - o.y) * .13 * step;
        o.vy *= .92;
      } else if (mode === 'vortex') {
        var dx = cx - o.x, dy = cy - o.y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
        o.vx += (-dy / dist * .17 + dx / dist * .014) * step;
        o.vy += (dx / dist * .17 + dy / dist * .014) * step;
      } else if (mode === 'chaos') {
        if (now > o.nextImpulse) {
          o.vx += rand(-1.4, 1.4); o.vy += rand(-1.2, 1.2); o.nextImpulse = now + rand(240, 690);
        }
      } else {
        o.vx += Math.sin(now * .0008 + o.phase) * .025 * step;
        o.vy += Math.cos(now * .00065 + o.phase) * .024 * step;
      }
      for (var q = 0; q < impulses.length; q++) {
        var pulse = impulses[q], px = o.x - pulse.x, py = o.y - pulse.y, distance = Math.sqrt(px * px + py * py) || 1;
        var band = Math.abs(distance - pulse.front);
        if (band < 52) {
          var force = (1 - band / 52) * pulse.power * .16 * pulse.life;
          o.vx += px / distance * force * step; o.vy += py / distance * force * step;
          o.reaction = Math.max(o.reaction || 0, force * 2.5);
        }
      }
      o.vx *= .994; o.vy *= .994;
      var max = mode === 'chaos' ? 5.7 : 3.7;
      o.vx = clamp(o.vx, -max, max); o.vy = clamp(o.vy, -max, max);
      if (mode !== 'wave') { o.x += o.vx * step; o.y += o.vy * step; }
      var bounce = mode === 'chaos' ? -.9 : -.76;
      if (o.x < o.r || o.x > w - o.r) { o.vx *= bounce; o.x = clamp(o.x, o.r, w - o.r); }
      if (o.y < o.r || o.y > h - o.r) { o.vy *= bounce; o.y = clamp(o.y, o.r, h - o.r); }
      o.reaction = Math.max(0, (o.reaction || 0) * .91);
      o.flash = Math.max(0, (o.flash || 0) * .91);
      if (mode !== 'wave') { o.waveX = o.x; o.waveBase = o.y; }
      for (var j = i + 1; j < orbs.length; j++) {
        var b = orbs[j], dx2 = b.x - o.x, dy2 = b.y - o.y, d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || .1, min = o.r + b.r;
        if (d2 < min) {
          var nx = dx2 / d2, ny = dy2 / d2, overlap = (min - d2) * .5;
          o.x -= nx * overlap; o.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
          var impulse = (o.vx - b.vx) * nx + (o.vy - b.vy) * ny;
          o.vx -= impulse * nx * .64; o.vy -= impulse * ny * .64; b.vx += impulse * nx * .64; b.vy += impulse * ny * .64;
          o.flash = Math.max(o.flash, .55); b.flash = Math.max(b.flash, .55);
        }
      }
    }
    for (var k = impulses.length - 1; k >= 0; k--) {
      impulses[k].front += (4.1 + musicLevel * 2.2) * step; impulses[k].life -= .008 * step;
      if (impulses[k].life <= 0 || impulses[k].front > Math.max(w, h) * 1.2) impulses.splice(k, 1);
    }
  }
  function orbScale(o, now, index) {
    var pulse;
    if (mode === 'pulse') pulse = 1 + Math.sin(now * o.rate + o.phase) * (.26 + musicLevel * .1);
    else if (mode === 'wave') pulse = 1 + Math.sin(o.waveX / w * 5.5 - now * .0016 + o.phase) * .2;
    else if (mode === 'vortex') pulse = 1 + Math.sin(now * .0018 + o.phase + index * .14) * .12;
    else if (mode === 'chrome') pulse = 1 + Math.sin(now * .00125 + o.phase) * .16;
    else if (mode === 'chaos') pulse = 1 + Math.sin(now * o.rate * 1.8 + o.phase) * .23;
    else pulse = 1 + Math.sin(now * .0016 + o.phase) * .12 + (o.reaction || 0) * .2;
    return o.r * pulse * (1 + musicLevel * .09 + (o.flash || 0) * .11);
  }
  function render(now, token) {
    if (!active || token !== runId || document.hidden || root.classList.contains('hidden')) { raf = 0; return; }
    var elapsed = now - lastFrame;
    if (elapsed < 31) { raf = requestAnimationFrame(function (t) { render(t, token); }); return; }
    var dt = lastFrame ? Math.min(48, elapsed) : 16;
    lastFrame = now;
    update(dt, now);
    ctx.clearRect(0, 0, w, h);
    var chrome = mode === 'chrome';
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i], r = orbScale(o, now, i), sprite = makeSprite(o.color, chrome);
      var glow = Math.min(1.5, .76 + musicLevel * .42 + (o.reaction || 0) * .35 + (o.flash || 0) * .3);
      ctx.globalAlpha = glow;
      ctx.drawImage(sprite, o.x - r * 1.52, o.y - r * 1.52, r * 3.04, r * 3.04);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(function (t) { render(t, token); });
  }
  function point(e) { var rect = canvas.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }
  canvas.addEventListener('pointerdown', function (e) {
    if (!active) return;
    var p = point(e), nearest = null, best = 1e9;
    for (var i = 0; i < orbs.length; i++) {
      var dx = orbs[i].x - p.x, dy = orbs[i].y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < orbs[i].r + 18 && d < best) { nearest = orbs[i]; best = d; }
    }
    selected = nearest; pointer = p; dragVelocity = { x: 0, y: 0 };
    if (!selected) ripple(p.x, p.y, .9);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!pointer || !active) return;
    var p = point(e);
    dragVelocity.x = clamp((p.x - pointer.x) * .72, -8, 8);
    dragVelocity.y = clamp((p.y - pointer.y) * .72, -8, 8);
    pointer = p;
  });
  function release(e) {
    if (!pointer) return;
    var p = point(e);
    if (selected) { selected.vx += dragVelocity.x; selected.vy += dragVelocity.y; selected.flash = 1; sound(420, .08); }
    else ripple(p.x, p.y, .8);
    selected = null; pointer = null;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  Array.prototype.forEach.call(document.querySelectorAll('.party-mode'), function (el) {
    el.addEventListener('click', function () { setMode(el.getAttribute('data-mode')); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.party-preset'), function (el) {
    el.addEventListener('click', function () { setPreset(el.getAttribute('data-preset')); });
  });
  document.getElementById('partyBass').addEventListener('click', bassCannon);
  var soundButton = document.getElementById('partySound');
  soundButton.addEventListener('click', function () {
    soundOn = !soundOn; soundButton.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    soundButton.querySelector('span').textContent = soundOn ? 'SOUND FX ON' : 'SOUND FX OFF';
    try { localStorage.setItem('nexus.party.sound', soundOn ? '1' : '0'); } catch (e) {}
    if (soundOn) sound(540, .09);
  });
  document.getElementById('partyAccess').addEventListener('click', function () {
    try { if (window.Android && Android.openNotificationAccess) Android.openNotificationAccess(); } catch (e) {}
    document.getElementById('pHint').textContent = 'ENABLE NEXUS UNDER ANDROID NOTIFICATION ACCESS TO READ MEDIA SESSIONS';
  });
  function setHint(text) { var hint = document.getElementById('pHint'); if (hint) hint.textContent = text; }
  function formatTime(ms) {
    if (!(ms >= 0)) return '--:--';
    var sec = Math.floor(ms / 1000);
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }
  var artwork = document.getElementById('partyArtwork');
  function updateMedia() {
    if (!active || !window.Android || !Android.partyMediaInfo) return;
    var info = {};
    try { info = JSON.parse(Android.partyMediaInfo() || '{}'); } catch (e) {}
    var status = document.getElementById('partyMediaStatus');
    if (info.access === false) {
      status.setAttribute('data-state', 'disconnected');
      status.querySelector('span').textContent = 'NOTIFICATION ACCESS REQUIRED';
      document.getElementById('pSong').textContent = 'Media session access is off';
      document.getElementById('partyArtist').textContent = 'Tap MEDIA ACCESS, then enable Nexus in Android settings';
      document.getElementById('partyAlbum').textContent = '';
      document.getElementById('partyDuration').textContent = '--:--';
      document.getElementById('partyPosition').textContent = '0:00';
      document.getElementById('partyProgressFill').style.width = '0%';
      artwork.classList.remove('has-art'); artwork.innerHTML = '<span>◈</span>'; artworkUrl = '';
      document.getElementById('partyPrev').disabled = true;
      document.getElementById('partyNext').disabled = true;
      document.getElementById('partyToggle').disabled = true;
      lastSong = ''; return;
    }
    var playing = !!info.playing, title = info.title || 'No media playing', artist = info.artist || '';
    var mediaActive = !!info.app && (!!info.title || playing);
    status.setAttribute('data-state', mediaActive ? (playing ? 'playing' : 'paused') : 'disconnected');
    var appName = info.app === 'com.spotify.music' ? 'SPOTIFY' : (info.app ? String(info.app).split('.').pop().toUpperCase() : 'MEDIA SESSION');
    status.querySelector('span').textContent = mediaActive ? appName + (playing ? ' · PLAYING' : ' · PAUSED') : 'MEDIA SESSION UNAVAILABLE';
    document.getElementById('pSong').textContent = title;
    document.getElementById('partyArtist').textContent = artist || (mediaActive ? 'Artist information unavailable' : 'Connect Spotify or another media player');
    document.getElementById('partyAlbum').textContent = info.album || '';
    var duration = +info.duration || 0, position = +info.position || 0;
    document.getElementById('partyDuration').textContent = duration ? formatTime(duration) : '--:--';
    document.getElementById('partyPosition').textContent = formatTime(Math.min(position, duration || position));
    document.getElementById('partyProgressFill').style.width = duration ? (clamp(position / duration, 0, 1) * 100) + '%' : '0%';
    document.getElementById('partyPrev').disabled = !info.canPrevious;
    document.getElementById('partyNext').disabled = !info.canNext;
    document.getElementById('partyToggle').disabled = !info.canPlayPause;
    document.getElementById('partyToggle').textContent = playing ? 'Ⅱ' : '▶';
    var nextArt = info.artwork || '';
    if (nextArt && nextArt !== artworkUrl) {
      artworkUrl = nextArt; artwork.innerHTML = '<img alt="Album artwork">';
      var img = artwork.querySelector('img');
      img.onload = function () { artwork.classList.add('has-art'); };
      img.src = nextArt;
    } else if (!nextArt && artworkUrl) {
      artworkUrl = ''; artwork.classList.remove('has-art'); artwork.innerHTML = '<span>◈</span>';
    }
    var key = (info.app || '') + '|' + (info.title || '') + '|' + (info.artist || '');
    if (mediaActive && key !== lastSong) {
      if (lastSong) ripple(w * .5, h * .46, .85);
      lastSong = key;
    }
    if (!mediaActive) lastSong = '';
    if (audioSource === 'fallback') {
      setHint(playing ? 'PLAYBACK-STATE MOTION · LIVE AUDIO ANALYSIS UNAVAILABLE' : 'TOUCH AN ORB OR DRAG IT THROUGH THE FIELD');
    }
  }
  function mediaTick() { if (active) updateMedia(); }
  var oldMeter = window.Nexus && Nexus._meter;
  if (window.Nexus) {
    Nexus._meter = function (all, low) {
      if (oldMeter) oldMeter(all, low);
      if (!active) return;
      musicLevel = clamp((+all || 0) * 8, .12, 1);
      audioSource = 'frequency';
      if (low > .01 && Math.random() > .72) ripple(rand(w * .28, w * .72), h * .46, clamp(low * 3, .35, 1));
      setHint('LIVE AUDIO FREQUENCY REACTIVITY · ' + mode.toUpperCase());
    };
    var oldSource = Nexus._meterSource;
    Nexus._meterSource = function (source) {
      audioSource = source === 'music' ? 'frequency' : 'microphone';
      if (oldSource) oldSource(source);
      setHint(audioSource === 'frequency' ? 'LIVE AUDIO FREQUENCY REACTIVITY · ' + mode.toUpperCase() :
        'MICROPHONE AUDIO REACTIVITY · ' + mode.toUpperCase());
    };
    var oldError = Nexus._meterError;
    Nexus._meterError = function () {
      audioSource = 'fallback';
      if (oldError) oldError.apply(this, arguments);
      setHint('PLAYBACK-STATE MOTION · LIVE AUDIO ANALYSIS UNAVAILABLE');
    };
  }
  function start() {
    if (active || document.hidden) return;
    active = true; runId++; lastFrame = 0;
    resize();
    var token = runId;
    raf = requestAnimationFrame(function (t) { render(t, token); });
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(mediaTick, 2500);
    updateMedia();
  }
  function stop() {
    active = false; runId++;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (pollTimer) clearInterval(pollTimer); pollTimer = 0;
    selected = null; pointer = null; impulses.length = 0;
    ctx.clearRect(0, 0, w, h);
  }
  function syncVisibility() {
    if (document.hidden || root.classList.contains('hidden')) stop();
    else start();
  }
  new MutationObserver(syncVisibility).observe(root, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', syncVisibility);
  window.addEventListener('resize', resize);
  try {
    setPreset(localStorage.getItem('nexus.party.preset') || 'voltage');
    soundOn = localStorage.getItem('nexus.party.sound') === '1';
  } catch (e) { setPreset('voltage'); }
  soundButton.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  soundButton.querySelector('span').textContent = soundOn ? 'SOUND FX ON' : 'SOUND FX OFF';
  setMode('pulse');
})();
