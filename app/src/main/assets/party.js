/* NEXUS PARTY · OBSIDIAN
 * Lightweight canvas renderer and media-session presentation for the production app.
 * The existing app.js owns entry/exit and the Android bridge owns media commands.
 */
(function () {
  'use strict';
  var root = document.getElementById('party');
  var canvas = document.getElementById('partyCanvas');
  if (!root || !canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  var modes = ['pulse', 'vortex', 'chrome', 'chaos', 'ripple'];
  var palettes = {
    blue: [69, 151, 255], cyan: [0, 205, 221], violet: [147, 111, 255],
    silver: [204, 222, 238], amber: [232, 164, 72], obsidian: [121, 150, 181]
  };
  var mode = 'pulse', palette = 'blue', active = false, raf = 0, lastFrame = 0, lastPoll = 0;
  var w = 1, h = 1, scale = 1, energy = .12, bass = .08, source = 'fallback';
  var orbs = [], trails = [], waves = [], stars = [], selected = null, pointer = null;
  var audio = null, soundOn = false, lastSong = '', artUrl = '', albumKey = '', pollTimer = 0, dragVel = { x: 0, y: 0 };
  var rootStyle = root.style;

  function rgb(a) { return 'rgba(' + palettes[palette].join(',') + ',' + a + ')'; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function random(a, b) { return a + Math.random() * (b - a); }
  function setPalette(name) {
    if (!palettes[name]) return;
    palette = name; root.setAttribute('data-palette', name);
    Array.prototype.forEach.call(document.querySelectorAll('.party-swatch'), function (el) {
      el.classList.toggle('active', el.getAttribute('data-palette') === name);
    });
    try { localStorage.setItem('nexus.party.palette', name); } catch (e) {}
  }
  function setMode(name) {
    if (modes.indexOf(name) < 0) return;
    mode = name;
    Array.prototype.forEach.call(document.querySelectorAll('.party-mode'), function (el) {
      el.classList.toggle('active', el.getAttribute('data-mode') === name);
    });
    root.setAttribute('data-mode', name);
    wave(w * .5, h * .47, .55, 1.1);
  }
  function resize() {
    var rect = root.getBoundingClientRect();
    w = Math.max(1, rect.width); h = Math.max(1, rect.height);
    scale = Math.min(window.devicePixelRatio || 1, .78);
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    stars = [];
    for (var i = 0; i < 34; i++) stars.push({ x: Math.random() * w, y: Math.random() * h, r: random(.35, 1.3), p: random(0, 6.28) });
    if (!orbs.length) {
      for (var j = 0; j < 7; j++) {
        var angle = j / 7 * Math.PI * 2;
        orbs.push({ x: w * (.5 + Math.cos(angle) * .22), y: h * (.47 + Math.sin(angle) * .22),
          vx: random(-.35, .35), vy: random(-.3, .3), r: random(13, 25), phase: random(0, 6.28), pull: 0 });
      }
    }
  }
  function wave(x, y, power, count) {
    waves.push({ x: x, y: y, r: 2, life: 1, speed: 2.8 + power * 4, power: power });
    if (waves.length > 7) waves.shift();
    if (count) for (var i = 0; i < Math.min(5, count); i++) {
      var a = i / Math.max(1, count) * Math.PI * 2;
      particles.push({ x: x, y: y, vx: Math.cos(a) * random(1, 4) * power, vy: Math.sin(a) * random(1, 4) * power, life: 1, r: random(1.2, 3), hue: random(-15, 18) });
    }
  }
  var particles = [];
  function burst(x, y, power) {
    wave(x, y, power, 42);
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i], dx = o.x - x, dy = o.y - y, d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      o.vx += dx / d * power * 9; o.vy += dy / d * power * 9;
    }
    root.setAttribute('data-energy', 'high');
    setTimeout(function () { root.removeAttribute('data-energy'); }, 650);
  }
  function sound(freq, duration, volume) {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var osc = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
      osc.type = 'sine'; osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(50, freq * .55), now + duration);
      gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(volume || .025, now + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      osc.connect(gain); gain.connect(audio.destination); osc.start(now); osc.stop(now + duration + .02);
    } catch (e) {}
  }
  function drawOrb(o, t, index) {
    var pulse = mode === 'pulse' ? 1 + Math.sin(t * .004 + o.phase) * (.12 + energy * .16) : 1;
    var r = o.r * pulse * (1 + Math.min(.16, energy * .16));
    ctx.save(); ctx.translate(o.x, o.y);
    if (mode === 'chrome') {
      ctx.scale(1 + Math.sin(t * .0014 + o.phase) * .2, 1 + Math.cos(t * .0011 + o.phase) * .14);
    }
    if (mode === 'vortex') ctx.rotate(t * .00035 + o.phase);
    var g = ctx.createRadialGradient(-r * .38, -r * .5, r * .08, 0, 0, r * 1.3);
    if (mode === 'chrome') {
      g.addColorStop(0, 'rgba(255,255,255,.96)'); g.addColorStop(.14, rgb(.9));
      g.addColorStop(.32, 'rgba(231,245,255,.93)'); g.addColorStop(.48, 'rgba(38,55,76,.96)');
      g.addColorStop(.64, 'rgba(248,252,255,.92)'); g.addColorStop(.82, rgb(.8)); g.addColorStop(1, 'rgba(2,5,10,.05)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,.96)'); g.addColorStop(.12, rgb(.96));
      g.addColorStop(.52, rgb(.34)); g.addColorStop(.82, rgb(.12)); g.addColorStop(1, 'rgba(1,6,14,0)');
    }
    ctx.globalAlpha = .55 + energy * .35;
    ctx.shadowColor = rgb(.85); ctx.shadowBlur = mode === 'chaos' ? 8 + energy * 15 : 14 + energy * 20;
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(238,249,255,' + (.35 + energy * .35) + ')'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(-r * .16, -r * .16, r * .74, -.25, Math.PI * .95); ctx.stroke();
    if (mode === 'chrome') {
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1, r * .12);
      ctx.beginPath(); ctx.ellipse(-r * .22, -r * .55, r * .4, r * .12, -.25, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  function update(dt, t) {
    var f = Math.min(2, dt / 16.7), cx = w * .5, cy = h * .48;
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i];
      if (o === selected && pointer) { o.x = pointer.x; o.y = pointer.y; continue; }
      if (mode === 'vortex') {
        var dx = cx - o.x, dy = cy - o.y, d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        o.vx += (-dy / d * .12 + dx / d * .008) * f; o.vy += (dx / d * .12 + dy / d * .008) * f;
      } else if (mode === 'chaos') {
        o.vx += random(-.09, .09) * f; o.vy += random(-.09, .09) * f;
      } else if (mode === 'ripple') {
        o.vx += Math.sin(t * .002 + o.phase) * .035 * f; o.vy += Math.cos(t * .0017 + o.phase) * .035 * f;
      } else {
        o.vx += Math.sin(t * .001 + o.phase) * .018 * f; o.vy += Math.cos(t * .0013 + o.phase) * .018 * f;
      }
      for (var q = 0; q < waves.length; q++) {
        var wave0 = waves[q], wx = o.x - wave0.x, wy = o.y - wave0.y, dist = Math.sqrt(wx * wx + wy * wy);
        if (Math.abs(dist - wave0.r) < o.r + 6) { o.vx += wx / (dist || 1) * wave0.power * .24; o.vy += wy / (dist || 1) * wave0.power * .24; }
      }
      o.vx *= .992; o.vy *= .992;
      var cap = mode === 'chaos' ? 5.3 : 3.6; o.vx = clamp(o.vx, -cap, cap); o.vy = clamp(o.vy, -cap, cap);
      o.x += o.vx * f; o.y += o.vy * f;
      if (o.x < o.r || o.x > w - o.r) { o.vx *= -.82; o.x = clamp(o.x, o.r, w - o.r); }
      if (o.y < o.r || o.y > h - o.r) { o.vy *= -.82; o.y = clamp(o.y, o.r, h - o.r); }
      for (var j = i + 1; j < orbs.length; j++) {
        var b = orbs[j], dx2 = b.x - o.x, dy2 = b.y - o.y, d2 = Math.max(.1, Math.sqrt(dx2 * dx2 + dy2 * dy2)), min = o.r + b.r;
        if (d2 < min) {
          var nx = dx2 / d2, ny = dy2 / d2, overlap = (min - d2) * .5;
          o.x -= nx * overlap; o.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
          var impulse = (o.vx - b.vx) * nx + (o.vy - b.vy) * ny;
          o.vx -= impulse * nx * .72; o.vy -= impulse * ny * .72; b.vx += impulse * nx * .72; b.vy += impulse * ny * .72;
          if (impulse > 2.6 && Math.abs(o.r - b.r) < 6 && orbs.length > 3) { o.r = Math.min(35, Math.sqrt(o.r * o.r + b.r * b.r) * .82); orbs.splice(j, 1); j--; wave(o.x, o.y, .65, 9); sound(420, .12, .025); } else if (impulse > 1.4) { o.r = Math.min(31, o.r + .12); b.r = Math.min(31, b.r + .12); sound(420, .08, .012); }
        }
      }
    }
    for (var k = waves.length - 1; k >= 0; k--) { waves[k].r += waves[k].speed * f; waves[k].life -= .008 * f; if (waves[k].life <= 0) waves.splice(k, 1); }
    for (var z = particles.length - 1; z >= 0; z--) {
      var p = particles[z]; p.x += p.vx * f; p.y += p.vy * f; p.vx *= .985; p.vy *= .985; p.life -= .018 * f;
      if (p.life <= 0) particles.splice(z, 1);
    }
    for (var n = trails.length - 1; n >= 0; n--) { trails[n].life -= .025 * f; if (trails[n].life <= 0) trails.splice(n, 1); }
  }
  function render(t) {
    if (!active) { raf = 0; return; }
    if (t - lastFrame < 30) { raf = requestAnimationFrame(render); return; }
    var dt = lastFrame ? Math.min(48, t - lastFrame) : 16; lastFrame = t;
    update(dt, t); ctx.clearRect(0, 0, w, h);
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s], a = .14 + (Math.sin(t * .001 + st.p) + 1) * .1;
      ctx.fillStyle = 'rgba(195,222,245,' + a + ')'; ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
    }
    if (mode === 'pulse') {
      for (var ring = 0; ring < 3; ring++) {
        var rr = (t * (.045 + energy * .08) + ring * 145) % (Math.max(w, h) * .72);
        ctx.strokeStyle = rgb((1 - rr / (Math.max(w, h) * .72)) * (.13 + energy * .13)); ctx.lineWidth = 1.4 + energy * 2;
        ctx.beginPath(); ctx.arc(w * .5, h * .48, rr, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (mode === 'vortex') {
      ctx.save(); ctx.translate(w * .5, h * .48); ctx.rotate(t * .00012);
      for (var arm = 0; arm < 3; arm++) {
        ctx.beginPath();
        for (var u = 0; u < 80; u++) { var ang = u * .12 + arm * Math.PI * 2 / 3, radius = 2 + u * 2.6; var x = Math.cos(ang) * radius, y = Math.sin(ang) * radius * .56; if (!u) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.strokeStyle = rgb(.11 + energy * .08); ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
    }
    if (mode === 'ripple') {
      ctx.strokeStyle = rgb(.14);
      for (var grid = 0; grid < 4; grid++) { ctx.beginPath(); ctx.ellipse(w * .5, h * .48, 90 + grid * 58 + Math.sin(t * .001 + grid) * 8, 23 + grid * 18, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
    for (var tr = 0; tr < trails.length; tr++) {
      var path = trails[tr]; if (path.points.length < 2) continue;
      ctx.beginPath(); ctx.moveTo(path.points[0].x, path.points[0].y);
      for (var pt = 1; pt < path.points.length; pt++) ctx.lineTo(path.points[pt].x, path.points[pt].y);
      ctx.strokeStyle = rgb(path.life * .55); ctx.lineWidth = 2 + path.life * 4; ctx.lineCap = 'round'; ctx.shadowColor = rgb(.8); ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0;
    }
    for (var wi = 0; wi < waves.length; wi++) {
      var wa = waves[wi]; ctx.beginPath(); ctx.arc(wa.x, wa.y, wa.r, 0, Math.PI * 2);
      ctx.strokeStyle = rgb(wa.life * (.34 + wa.power * .23)); ctx.lineWidth = 1.4 + wa.life * 2; ctx.shadowColor = rgb(.65); ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
    }
    for (var pi = 0; pi < particles.length; pi++) {
      var part = particles[pi]; ctx.fillStyle = 'rgba(215,240,255,' + part.life + ')'; ctx.beginPath(); ctx.arc(part.x, part.y, part.r * part.life, 0, Math.PI * 2); ctx.fill();
    }
    for (var oi = 0; oi < orbs.length; oi++) drawOrb(orbs[oi], t, oi);
    var centerGlow = ctx.createRadialGradient(w * .5, h * .48, 0, w * .5, h * .48, 170 + energy * 80);
    centerGlow.addColorStop(0, rgb(.055 + energy * .09)); centerGlow.addColorStop(1, rgb(0));
    ctx.fillStyle = centerGlow; ctx.fillRect(0, 0, w, h);
    raf = requestAnimationFrame(render);
  }
  function point(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener('pointerdown', function (e) {
    if (!active) return;
    var p = point(e), nearest = null, best = 1e9;
    for (var i = 0; i < orbs.length; i++) { var d = Math.hypot(orbs[i].x - p.x, orbs[i].y - p.y); if (d < orbs[i].r + 24 && d < best) { nearest = orbs[i]; best = d; } }
    pointer = p; dragVel = { x: 0, y: 0 }; selected = nearest;
    if (!selected && orbs.length < 10) { selected = { x: p.x, y: p.y, vx: 0, vy: 0, r: random(14, 23), phase: random(0, 6.28) }; orbs.push(selected); }
    canvas.setPointerCapture(e.pointerId); trails.push({ points: [p], life: 1 }); wave(p.x, p.y, .6, 5); sound(620, .08, .014);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!pointer || !active) return;
    var p = point(e); dragVel = { x: clamp((p.x - pointer.x) * .65, -8, 8), y: clamp((p.y - pointer.y) * .65, -8, 8) }; pointer = p;
    var path = trails[trails.length - 1]; if (path) { path.points.push(p); if (path.points.length > 24) path.points.shift(); }
  });
  function release(e) {
    if (!pointer) return;
    var p = point(e);
    if (selected) { selected.vx += dragVel.x; selected.vy += dragVel.y; }
    wave(p.x, p.y, .75, 8); selected = null; pointer = null;
  }
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  Array.prototype.forEach.call(document.querySelectorAll('.party-mode'), function (el) {
    el.addEventListener('click', function () { setMode(el.getAttribute('data-mode')); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.party-swatch'), function (el) {
    el.addEventListener('click', function () { setPalette(el.getAttribute('data-palette')); });
  });
  var bassButton = document.getElementById('partyBass');
  bassButton.addEventListener('click', function () { burst(w * .5, h * .49, 1.45); sound(90, .72, .08); setTimeout(function () { wave(w * .5, h * .49, .9, 28); }, 120); });
  var soundButton = document.getElementById('partySound');
  soundButton.addEventListener('click', function () {
    soundOn = !soundOn; soundButton.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    soundButton.querySelector('span').textContent = soundOn ? 'SOUND FX ON' : 'SOUND FX OFF';
    try { localStorage.setItem('nexus.party.sound', soundOn ? '1' : '0'); } catch (e) {}
    if (soundOn) sound(520, .1, .025);
  });
  document.getElementById('partyAccess').addEventListener('click', function () {
    try { if (window.Android && Android.openNotificationAccess) Android.openNotificationAccess(); } catch (e) {}
    var hint = document.getElementById('pHint');
    hint.textContent = 'ENABLE NEXUS UNDER ANDROID NOTIFICATION ACCESS TO READ MEDIA SESSIONS';
  });

  function time(ms) { if (!(ms >= 0)) return '--:--'; var sec = Math.floor(ms / 1000); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
  var artwork = document.getElementById('partyArtwork');
  function updateMedia() {
    if (!active || !window.Android || !Android.partyMediaInfo) return;
    var info = {};
    try { info = JSON.parse(Android.partyMediaInfo() || '{}'); } catch (e) { info = {}; }
    var status = document.getElementById('partyMediaStatus'), hint = document.getElementById('pHint');
    if (info.access === false) {
      status.setAttribute('data-state', 'disconnected'); status.querySelector('span').textContent = 'NOTIFICATION ACCESS REQUIRED';
      document.getElementById('pSong').textContent = 'Media session access is off';
      document.getElementById('partyArtist').textContent = 'Tap MEDIA ACCESS, then enable Nexus in Android settings';
      document.getElementById('partyAlbum').textContent = '';
      document.getElementById('partyDuration').textContent = '--:--'; document.getElementById('partyPosition').textContent = '0:00'; document.getElementById('partyProgressFill').style.width = '0%';
      lastSong = ''; artUrl = ''; artwork.classList.remove('has-art'); artwork.innerHTML = '<span>◈</span>';
      document.getElementById('partyPrev').disabled = true; document.getElementById('partyNext').disabled = true; document.getElementById('partyToggle').disabled = true;
      if (source === 'fallback') hint.textContent = 'VISUAL RHYTHM FALLBACK · ENABLE MEDIA ACCESS FOR TRACK DETAILS';
      return;
    }
    var playing = !!info.playing, title = info.title || 'No media playing', artist = info.artist || '';
    var mediaActive = !!info.app && (info.title || playing);
    status.setAttribute('data-state', mediaActive ? (playing ? 'playing' : 'paused') : 'disconnected');
    var appName = info.app === 'com.spotify.music' ? 'SPOTIFY' : (info.app ? String(info.app).split('.').pop().toUpperCase() : 'MEDIA SESSION');
    status.querySelector('span').textContent = mediaActive ? appName + (playing ? ' · PLAYING' : ' · PAUSED') : 'MEDIA SESSION UNAVAILABLE';
    document.getElementById('pSong').textContent = title;
    document.getElementById('partyArtist').textContent = artist || (mediaActive ? 'Artist information unavailable' : 'Connect Spotify or another media player');
    document.getElementById('partyAlbum').textContent = info.album || '';
    var duration = +info.duration || 0, position = +info.position || 0;
    document.getElementById('partyDuration').textContent = time(duration);
    document.getElementById('partyPosition').textContent = time(Math.min(position, duration || position));
    document.getElementById('partyProgressFill').style.width = duration ? (clamp(position / duration, 0, 1) * 100) + '%' : '0%';
    document.getElementById('partyPrev').disabled = !info.canPrevious;
    document.getElementById('partyNext').disabled = !info.canNext;
    document.getElementById('partyToggle').disabled = !info.canPlayPause;
    document.getElementById('partyToggle').textContent = playing ? 'Ⅱ' : '▶';
    var nextArt = info.artwork || '';
    if (nextArt && nextArt !== artUrl) {
      artUrl = nextArt; artwork.innerHTML = '<img alt="Album artwork">';
      var img = artwork.querySelector('img'); img.onload = function () { artwork.classList.add('has-art'); };
      img.src = nextArt;
    } else if (!nextArt && artUrl) { artUrl = ''; artwork.classList.remove('has-art'); artwork.innerHTML = '<span>◈</span>'; }
    var key = (info.app || '') + '|' + (info.title || '') + '|' + (info.artist || '');
    if (mediaActive && key !== lastSong) {
      if (lastSong) burst(w * .5, h * .48, .72);
      lastSong = key;
      if (playing) { sound(350, .12, .018); }
    }
    if (!mediaActive) lastSong = '';
    if (source === 'fallback') hint.textContent = playing ? 'PLAYBACK-STATE VISUALS · AUDIO FREQUENCY ANALYSIS UNAVAILABLE' : 'TOUCH THE ENERGY FIELD · CONNECT A MEDIA SESSION TO SYNC';
  }
  function poll(t) { if (active && t - lastPoll > 2200) { lastPoll = t; updateMedia(); } }
  var oldMeter = window.Nexus && Nexus._meter;
  if (window.Nexus) {
    Nexus._meter = function (all, low) {
      if (oldMeter) oldMeter(all, low);
      if (!active) return;
      energy = clamp(+all * 8, .05, 1); bass = clamp(+low * 8, .05, 1);
      source = 'frequency'; root.setAttribute('data-energy', energy > .72 ? 'high' : 'low');
      if (bass > .72 && Math.random() > .74) wave(random(w * .3, w * .7), h * .48, bass, 0);
      document.getElementById('pHint').textContent = 'LIVE AUDIO FREQUENCY REACTIVITY · ' + mode.toUpperCase();
    };
    var oldSource = Nexus._meterSource;
    Nexus._meterSource = function (s) {
      source = s === 'music' ? 'frequency' : 'microphone';
      if (oldSource) oldSource(s);
      document.getElementById('pHint').textContent = source === 'frequency' ? 'LIVE AUDIO FREQUENCY REACTIVITY · ' + mode.toUpperCase() : 'MICROPHONE AUDIO REACTIVITY · ' + mode.toUpperCase();
    };
    var oldError = Nexus._meterError;
    Nexus._meterError = function () {
      source = 'fallback';
      if (oldError) oldError.apply(this, arguments);
      document.getElementById('pHint').textContent = 'PLAYBACK-STATE VISUALS · AUDIO FREQUENCY ANALYSIS UNAVAILABLE';
    };
  }
  function start() {
    if (active) return;
    active = true; lastFrame = 0; resize();
    if (!raf) raf = requestAnimationFrame(render);
    if (pollTimer) clearInterval(pollTimer); pollTimer = setInterval(updateMedia, 1800);
    updateMedia();
  }
  function stop() {
    active = false; if (raf) cancelAnimationFrame(raf); raf = 0;
    if (pollTimer) clearInterval(pollTimer); pollTimer = 0;
  }
  function visibility() {
    var hidden = root.classList.contains('hidden');
    if (hidden) stop(); else start();
  }
  new MutationObserver(visibility).observe(root, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', resize);
  try { setPalette(localStorage.getItem('nexus.party.palette') || 'blue'); soundOn = localStorage.getItem('nexus.party.sound') === '1'; }
  catch (e) { setPalette('blue'); }
  soundButton.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  soundButton.querySelector('span').textContent = soundOn ? 'SOUND FX ON' : 'SOUND FX OFF';
  setMode('pulse');
})();
