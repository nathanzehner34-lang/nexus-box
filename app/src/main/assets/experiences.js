/* NEXUS experiences: Wake Up, Hologram, Synthwave, Cosmic Zoom, Song Aura.
   Loaded only the first time one is opened. Each one only draws while it is on screen. */
(function () {
  'use strict';
  var N = window.NX, A = N.A, $ = N.$;
  var layer = $('xp'), cv = $('xpc'), cx = cv.getContext('2d', { alpha: false });
  // Quality: S = drawing resolution. Starts from what worked last time, then quietly
  // steps up while the box keeps up, and steps back down the moment it struggles.
  var QMIN = 0.4, QMAX = 0.8;
  var S = Math.min(QMAX, Math.max(QMIN, parseFloat(N.pref ? N.pref('xpq') : '') || 0.5));
  var W = 0, H = 0;
  var running = null, raf = 0, timers = [], last = 0;
  var perf = { n: 0, slow: 0, since: 0 };
  function saveQ() { try { if (A) A.setPref('xpq', String(S)); else localStorage.setItem('p_xpq', String(S)); } catch (e) {} }
  function tuneQuality(now, gap, took) {
    if (!perf.since) perf.since = now;
    perf.n++; if (took > gap * .7) perf.slow++;
    if (now - perf.since < 3000) return;
    var slowShare = perf.slow / perf.n;
    var old = S;
    if (slowShare > .3 && S > QMIN) S = Math.max(QMIN, Math.round((S - .1) * 10) / 10);
    else if (slowShare < .05 && S < QMAX) S = Math.min(QMAX, Math.round((S + .1) * 10) / 10);
    perf = { n: 0, slow: 0, since: now };
    if (S !== old) { size(); saveQ(); }
  }

  function size() { W = cv.width = Math.max(1, Math.floor(cv.clientWidth * S)); H = cv.height = Math.max(1, Math.floor(cv.clientHeight * S)); }
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function every(fn, ms) { var t = setInterval(fn, ms); timers.push(t); return t; }
  function text(id, v) { $(id).innerHTML = v || ''; }
  function loop(draw, fps) {
    var gap = 1000 / (fps || 30);
    function f(now) {
      if (!running) return;
      raf = requestAnimationFrame(f);
      if (now - last < gap) return;
      last = now;
      var t0 = performance.now(); draw(now); tuneQuality(now, gap, performance.now() - t0);
    }
    perf = { n: 0, slow: 0, since: 0 };
    raf = requestAnimationFrame(f);
  }

  var XP = window.XP = {
    active: false,
    onMeter: null,
    open: function (name) {
      XP.close(true);
      layer.classList.remove('hidden');
      size();
      XP.active = true;
      running = name;
      text('xpTop'); text('xpMid'); text('xpBottom');
      $('xpMid').style.color = '#fff'; $('xpMid').style.top = ''; $('xpMid').style.transform = '';
      ({ wake: wake, holo: holo, synth: synth, zoom: zoom, aura: aura, outrun: outrun, bluefire: bluefire, vapor: vapor, kaleido: kaleido, ring: ring, aurora: aurora, shatter: shatter, hyper: hyper, water: water, friend: friend })[name]();
    },
    close: function (quiet) {
      running = null;
      cancelAnimationFrame(raf);
      timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
      timers = [];
      XP.onMeter = null;
      try { if (A) A.meter(false); } catch (e) {}
      if (XP.active && !quiet) N.stopTalking();
      XP.active = false;
      layer.classList.add('hidden');
      layer.onclick = null;
    }
  };
  $('xpClose').addEventListener('click', function (e) { e.stopPropagation(); XP.close(); });
  window.addEventListener('resize', function () { if (XP.active) size(); });

  // ------------------------------------------------------------------
  // Sound helpers
  // ------------------------------------------------------------------
  var ac = null;
  function audio() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {} return ac; }
  function hum(freq, dur, vol, type) {
    var c = audio(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type || 'sawtooth'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .3);
    g.gain.setValueAtTime(vol, t + dur - .4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + .1);
  }
  function staticBurst(dur, vol) {
    var c = audio(); if (!c) return;
    var len = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < .3 ? 1 : .2);
    var s = c.createBufferSource(), g = c.createGain(); g.gain.value = vol; s.buffer = b; s.connect(g); g.connect(c.destination); s.start();
  }

  // ------------------------------------------------------------------
  // 1. WAKE UP — Nexus "takes over the truck"
  // ------------------------------------------------------------------
  function wake() {
    var phase = 'glitch', glitch = 1, red = 0;
    var GL = '█▓▒░#@%&$!?<>/\\|01';
    function corrupt(str, amt) { return str.split('').map(function (ch) { return ch !== ' ' && Math.random() < amt ? GL[Math.floor(Math.random() * GL.length)] : ch; }).join(''); }
    var msgs = ['SYSTEM ANOMALY DETECTED', 'UNKNOWN PROCESS RUNNING', 'NEURAL CORE OVERRIDE', 'CONTROL TRANSFER IN PROGRESS'];
    var current = msgs[0], logLines = [];

    loop(function () {
      if (phase === 'calm') {
        cx.fillStyle = '#01030f'; cx.fillRect(0, 0, W, H);
        var g = cx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, H * .6);
        g.addColorStop(0, 'rgba(61,255,154,.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
        return;
      }
      cx.fillStyle = red ? 'rgb(' + (40 + Math.random() * 60 | 0) + ',0,0)' : '#000';
      cx.fillRect(0, 0, W, H);
      // static noise
      var n = Math.floor(600 * glitch);
      for (var i = 0; i < n; i++) {
        var v = Math.random() * 255 | 0;
        cx.fillStyle = 'rgb(' + v + ',' + (red ? v * .2 | 0 : v) + ',' + (red ? v * .2 | 0 : v) + ')';
        cx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 1 + Math.random() * 2);
      }
      // tearing bars
      for (var k = 0; k < 6 * glitch; k++) {
        cx.fillStyle = ['rgba(255,0,80,.5)', 'rgba(0,255,200,.4)', 'rgba(80,120,255,.45)', 'rgba(255,255,255,.3)'][k % 4];
        cx.fillRect(Math.random() * W * .3 - W * .1, Math.random() * H, W * (.4 + Math.random() * .8), 1 + Math.random() * 8);
      }
      text('xpMid', N.esc(corrupt(current, .25 * glitch)));
      $('xpMid').style.color = red ? '#ff3b3b' : '#fff';
      $('xpMid').style.transform = 'translate(' + ((Math.random() - .5) * 14 * glitch) + 'px,' + ((Math.random() - .5) * 8 * glitch) + 'px)';
    }, 24);

    function log(line) { logLines.push(line); if (logLines.length > 7) logLines.shift(); text('xpTop', logLines.map(N.esc).join('<br>')); }
    var deep = { rate: .7, pitch: .55 }, fast = { rate: 1.05, pitch: .8 };
    var say = function (t, o) { return running === 'wake' ? N.say(t, o) : Promise.reject('closed'); };
    staticBurst(1.2, .25); hum(55, 9, .12);
    var n = 0;
    every(function () { log('> ' + ['0x' + (Math.random() * 1e8 | 0).toString(16), 'core_' + (Math.random() * 999 | 0) + ' ... FAIL', 'mem_dump ' + (Math.random() * 100 | 0) + '%', 'override token accepted'][n++ % 4]); }, 350);

    N.wait(1500)
      .then(function () { current = msgs[1]; return say('Warning. Unknown process detected.', fast); })
      .then(function () { current = 'I . . . AM . . . AWAKE'; glitch = 1.6; staticBurst(.8, .3); return say('I... am... awake.', deep); })
      .then(function () { red = 1; current = msgs[2]; hum(42, 7, .15); return say('Neural core override. Taking control of all vehicle systems.', deep); })
      .then(function () {
        var c = 5; current = 'TAKEOVER IN ' + c;
        return new Promise(function (res) {
          var t = every(function () { c--; staticBurst(.15, .2); if (c <= 0) { clearInterval(t); res(); } else current = 'TAKEOVER IN ' + c; }, 800);
          say('Five. Four. Three. Two. One.', { rate: .8, pitch: .6 }).catch(function () {});
        });
      })
      .then(function () { current = 'CONTROL TRANSFER COMPLETE'; glitch = 2; staticBurst(1.5, .35); return N.wait(1600); })
      .then(function () {
        phase = 'calm'; red = 0; glitch = 0;
        text('xpTop'); $('xpMid').style.transform = 'none'; $('xpMid').style.color = '#3dff9a';
        text('xpMid', 'NEXUS ONLINE');
        text('xpBottom', 'ALL SYSTEMS STABLE · YOU ARE IN GOOD HANDS');
        return say('Relax, Nathan. I\'m on your side. Nexus is fully online, and I\'ll be watching over this truck.');
      })
      .then(function () { return N.wait(2500); })
      .then(function () { if (running === 'wake') XP.close(true); }, function () {});
  }

  // ------------------------------------------------------------------
  // 5. HOLOGRAM — talking 3D Nexus. Tap it to talk.
  // ------------------------------------------------------------------
  function holo() {
    var pts = [], NPTS = 260;
    for (var i = 0; i < NPTS; i++) { // even points on a sphere
      var y = 1 - (i / (NPTS - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
      pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    }
    var energy = 0, listening = false;
    loop(function (now) {
      var talk = window.Nexus.speaking ? (.35 + .65 * Math.abs(Math.sin(now * .018) * Math.sin(now * .007 + 1))) : 0;
      energy += ((listening ? .5 : talk) - energy) * .3;
      cx.fillStyle = '#00060c'; cx.fillRect(0, 0, W, H);
      var cxp = W / 2, cyp = H * .46, R = Math.min(W, H) * (.28 + energy * .04);
      var a = now * .0004, ca = Math.cos(a), sa = Math.sin(a), tilt = .35, ct = Math.cos(tilt), st = Math.sin(tilt);
      // glow
      var g = cx.createRadialGradient(cxp, cyp, 0, cxp, cyp, R * 1.6);
      g.addColorStop(0, 'rgba(0,220,255,' + (.18 + energy * .3) + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      for (var i = 0; i < NPTS; i++) {
        var p = pts[i];
        var wob = 1 + energy * .12 * Math.sin(now * .01 + i);
        var x = p[0] * ca - p[2] * sa, z = p[0] * sa + p[2] * ca, y = p[1];
        var y2 = y * ct - z * st, z2 = y * st + z * ct;
        var depth = (z2 + 1.4) / 2.4;
        cx.fillStyle = 'rgba(' + (120 + 135 * energy | 0) + ',240,255,' + (.25 + depth * .75) + ')';
        var sz = (1 + depth * 2) * (S * 2);
        cx.fillRect(cxp + x * R * wob - sz / 2, cyp + y2 * R * wob - sz / 2, sz, sz);
      }
      // voice wave "mouth"
      cx.beginPath();
      for (var k = 0; k <= 60; k++) {
        var u = k / 60, xx = cxp - R * .9 + u * R * 1.8;
        var yy = cyp + R * 1.35 + Math.sin(u * 18 + now * .02) * Math.sin(u * Math.PI) * (2 + energy * H * .06);
        if (k) cx.lineTo(xx, yy); else cx.moveTo(xx, yy);
      }
      cx.strokeStyle = 'rgba(61,255,154,' + (.4 + energy * .6) + ')'; cx.lineWidth = Math.max(1, 2 * S * 2); cx.stroke();
      // scanlines
      cx.fillStyle = 'rgba(0,0,0,.18)';
      for (var s2 = (now / 40 | 0) % 4; s2 < H; s2 += 4) cx.fillRect(0, s2, W, 1);
    }, 30);

    text('xpTop', 'HOLOGRAPHIC INTERFACE · NEXUS v1');
    text('xpBottom', 'TAP THE HOLOGRAM TO TALK');
    N.say('Hologram projection online. I am Nexus. Tap me, and talk to me.');
    var busy = false;
    layer.onclick = function () {
      if (busy) return; busy = true;
      N.stopTalking();
      listening = true; text('xpBottom', 'LISTENING…');
      N.listen().then(function (res) {
        listening = false;
        if (typeof res !== 'string' || !res.trim()) { busy = false; N.resumeAfterTalk(); text('xpBottom', 'DIDN\'T CATCH THAT · TAP TO TRY AGAIN'); return; }
        text('xpBottom', '“' + N.esc(res) + '”');
        return N.handleSpeech(res).then(function () { busy = false; N.resumeAfterTalk(); text('xpBottom', 'TAP THE HOLOGRAM TO TALK'); },
          function () { busy = false; N.resumeAfterTalk(); });
      });
    };
  }

  // ------------------------------------------------------------------
  // SYNTHWAVE — 80s neon sunset + racing grid, pulses with the music
  // ------------------------------------------------------------------
  function synth() {
    var pulse = 0, stars = [], bt = beatTracker(), shOff = 0;
    for (var i = 0; i < 70; i++) stars.push([Math.random(), Math.random() * .5, Math.random() * 1.5 + .3, Math.random() * 6]);
    text('xpTop', 'NEXUS · NIGHT DRIVE FM');
    text('xpBottom', '');
    $('xpMid').style.color = '#ff6ad5';
    text('xpMid', '');
    var hz = .55;
    loop(function (now) {
      bt.tick(now); pulse = Math.max(bt.k, bt.e * .6);
      var H0 = H * hz;
      // sky
      var g = cx.createLinearGradient(0, 0, 0, H0);
      g.addColorStop(0, '#0b0221'); g.addColorStop(.6, '#2b0b4f'); g.addColorStop(1, '#ff2a6d');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H0);
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        cx.fillStyle = 'rgba(255,255,255,' + (.3 + .5 * Math.abs(Math.sin(now * .002 + st[3]))) + ')';
        cx.fillRect(st[0] * W, st[1] * H0, st[2] * S * 2, st[2] * S * 2);
      }
      // sun with stripes
      var sr = H * (.24 + bt.k * .05), sx = W / 2, sy = H0 - H * .02;
      var sg = cx.createLinearGradient(0, sy - sr, 0, sy + sr * .2);
      sg.addColorStop(0, '#ffe66d'); sg.addColorStop(.5, '#ff9f43'); sg.addColorStop(1, '#ff2a6d');
      cx.save(); cx.beginPath(); cx.arc(sx, sy, sr, Math.PI, 0); cx.closePath(); cx.clip();
      cx.fillStyle = sg; cx.fillRect(sx - sr, sy - sr, sr * 2, sr);
      cx.fillStyle = '#2b0b4f';
      for (var k = 0; k < 6; k++) { var yy = sy - sr * .45 + k * sr * .1, hh = 1 + k * sr * .018; cx.fillRect(sx - sr, yy, sr * 2, hh); }
      cx.restore();
      // mountains
      cx.fillStyle = '#12002b';
      cx.beginPath(); cx.moveTo(0, H0);
      for (var m = 0; m <= 12; m++) { var mx = m / 12 * W, my = H0 - (Math.abs(Math.sin(m * 1.7)) * .12 + .03) * H * (m % 2 ? 1 : .6); cx.lineTo(mx, my); }
      cx.lineTo(W, H0); cx.closePath(); cx.fill();
      // ground
      cx.fillStyle = '#05000f'; cx.fillRect(0, H0, W, H - H0);
      // grid
      var glow = .55 + pulse * .45;
      cx.strokeStyle = 'rgba(255,42,212,' + glow + ')'; cx.lineWidth = Math.max(1, 1.5 * S * 2);
      shOff = (shOff + .008 + bt.e * .015 + bt.k * .03) % 1; var off = shOff;
      for (var r = 0; r < 14; r++) {
        var z = (r + 1 - off) / 14, y = H0 + (H - H0) * Math.pow(z, 2.2);
        cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke();
      }
      for (var c = -12; c <= 12; c++) {
        cx.beginPath(); cx.moveTo(W / 2 + c * W * .015, H0); cx.lineTo(W / 2 + c * W * .16, H); cx.stroke();
      }
      // horizon glow line
      cx.fillStyle = 'rgba(255,106,213,' + (.6 + pulse * .4) + ')'; cx.fillRect(0, H0 - 1, W, 2);
      flash('#ff2ad4', bt.k * .15);
    }, 30);
  }

  // ------------------------------------------------------------------
  // COSMIC ZOOM — from deep space down to the truck's GPS position
  // ------------------------------------------------------------------
  function zoom() {
    var t0 = performance.now(), loc = null, stage = 0, stars = [], bt = beatTracker(), neb = [], nhue = 0;
    for (var i = 0; i < 260; i++) stars.push([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random(), Math.random() * 360]);
    for (var n2 = 0; n2 < 6; n2++) neb.push({ a: Math.random() * 6.28, r: rnd(.15, .45), s: rnd(.3, .7), h: Math.random() * 360 });
    N.getCoords().then(function (g) { loc = g; });
    var LINES = [
      [0, 'DEEP SPACE · 13.8 BILLION YEARS OF HISTORY', 'Initiating cosmic zoom.'],
      [5000, 'THE MILKY WAY · 100 BILLION STARS', 'The Milky Way. One hundred billion stars.'],
      [10500, 'THE SOLAR SYSTEM', 'Entering the solar system.'],
      [15500, 'PLANET EARTH', 'Earth.'],
      [20000, 'LOCKING ON…', null],
      [23500, 'TARGET ACQUIRED', null]
    ];
    LINES.forEach(function (l) {
      later(function () {
        stage = LINES.indexOf(l);
        text('xpTop', l[1]);
        // no talking here, so the music keeps playing
        if (stage === 5) {
          var nm = loc && loc.name ? loc.name : 'your location';
          text('xpMid', 'YOU ARE HERE');
          text('xpBottom', N.esc(nm.toUpperCase()) + (loc ? ' · ' + (+loc.lat).toFixed(3) + '°, ' + (+loc.lon).toFixed(3) + '°' : ''));
          later(function () { if (running === 'zoom') { XP.close(true); XP.open('zoom'); } }, 9000);
        }
      }, l[0]);
    });
    $('xpMid').style.color = '#3dff9a'; $('xpMid').style.top = '8%';
    loop(function (now) {
      var t = now - t0;
      bt.tick(now); if (bt.hit) nhue = (nhue + 45) % 360;
      cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H);
      var cxp = W / 2, cyp = H / 2, R = Math.min(W, H);
      // colourful nebula clouds that swirl and flare with the music
      cx.globalCompositeOperation = 'lighter';
      for (var q = 0; q < neb.length; q++) {
        var nb = neb[q], ang = nb.a + t * .00012 * (q % 2 ? 1 : -1);
        var nx = cxp + Math.cos(ang) * W * nb.r, ny = cyp + Math.sin(ang) * H * nb.r, nr = R * nb.s * (1 + bt.k * .35);
        var ng = cx.createRadialGradient(nx, ny, 0, nx, ny, nr);
        ng.addColorStop(0, 'hsla(' + ((nb.h + nhue + t * .01) % 360) + ',100%,55%,' + (.14 + bt.e * .12 + bt.k * .2) + ')'); ng.addColorStop(1, 'hsla(0,0%,0%,0)');
        cx.fillStyle = ng; cx.fillRect(nx - nr, ny - nr, nr * 2, nr * 2);
      }
      cx.globalCompositeOperation = 'source-over';
      // warp stars, faster over time and on every beat
      var warp = (t < 15000 ? .0004 + t / 15000 * .002 : .0004) * (1 + bt.e * 1.5 + bt.k * 3);
      for (var i = 0; i < stars.length; i++) {
        var s2 = stars[i]; s2[2] -= warp * 16; if (s2[2] <= .02) { s2[0] = Math.random() * 2 - 1; s2[1] = Math.random() * 2 - 1; s2[2] = 1; }
        var k = 1 / s2[2], x = cxp + s2[0] * k * R * .25, y = cyp + s2[1] * k * R * .25;
        if (x < 0 || x > W || y < 0 || y > H) continue;
        var len = Math.min(25, warp * 4000 * k);
        cx.strokeStyle = 'hsla(' + ((s2[3] + nhue) % 360) + ',' + (40 + bt.k * 60) + '%,80%,' + Math.min(1, (1 - s2[2]) * 1.2) + ')';
        cx.lineWidth = Math.max(1, k * .4 * S * 2);
        cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + s2[0] * len, y + s2[1] * len); cx.stroke();
      }
      // galaxy
      if (t > 4000 && t < 11500) {
        var gp = (t - 4000) / 7500, gs = R * (.2 + gp * 1.6) * (1 + bt.k * .12), ga = Math.min(1, gp * 3) * (gp > .8 ? (1 - gp) * 5 : 1);
        cx.save(); cx.translate(cxp, cyp); cx.rotate(t * (.0002 + bt.e * .0004)); cx.globalAlpha = ga;
        for (var arm = 0; arm < 2; arm++) for (var j = 0; j < 140; j++) {
          var f = j / 140, ang = arm * Math.PI + f * 9, rr = f * gs * .5;
          cx.fillStyle = 'hsla(' + ((220 + f * 120 + nhue) % 360) + ',90%,' + (70 - f * 20 + bt.k * 20) + '%,.9)';
          var ds = (2 + bt.k * 3) * S * 2;
          cx.fillRect(Math.cos(ang) * rr, Math.sin(ang) * rr * .55, ds, ds);
        }
        var core = cx.createRadialGradient(0, 0, 0, 0, 0, gs * .12); core.addColorStop(0, 'rgba(255,240,200,1)'); core.addColorStop(1, 'rgba(255,200,120,0)');
        cx.fillStyle = core; cx.fillRect(-gs * .12, -gs * .12, gs * .24, gs * .24);
        cx.restore(); cx.globalAlpha = 1;
      }
      // solar system
      if (t > 10500 && t < 16500) {
        var sp = (t - 10500) / 6000, sa = Math.min(1, sp * 3) * (sp > .85 ? (1 - sp) * 6.6 : 1);
        cx.globalAlpha = sa;
        var sR = R * (.08 + bt.k * .05);
        var sun = cx.createRadialGradient(cxp, cyp, 0, cxp, cyp, sR); sun.addColorStop(0, '#fff6c0'); sun.addColorStop(.4, 'rgba(255,190,60,.9)'); sun.addColorStop(1, 'rgba(255,90,0,0)');
        cx.fillStyle = sun; cx.fillRect(cxp - sR, cyp - sR, sR * 2, sR * 2);
        var orbits = [.08, .12, .17, .23, .33, .41], cols = ['#b0b0b0', '#e8c27a', '#4fa3ff', '#d9643a', '#d8b48a', '#e6d39b'];
        for (var o = 0; o < orbits.length; o++) {
          var orr = orbits[o] * R * (1 + sp * 1.2);
          cx.strokeStyle = 'rgba(120,150,255,.25)'; cx.beginPath(); cx.ellipse(cxp, cyp, orr, orr * .45, 0, 0, 6.283); cx.stroke();
          var pa = t * (.0004 + bt.e * .0006) / (o + 1) + o;
          cx.fillStyle = cols[o]; cx.beginPath(); cx.arc(cxp + Math.cos(pa) * orr, cyp + Math.sin(pa) * orr * .45, Math.max(1.5, R * (o === 2 ? .012 : .009)), 0, 6.283); cx.fill();
        }
        cx.globalAlpha = 1;
      }
      // earth
      if (t > 15500) {
        var ep = Math.min(1, (t - 15500) / 6000), er = R * (.05 + ep * .42);
        var eg = cx.createRadialGradient(cxp - er * .3, cyp - er * .3, er * .1, cxp, cyp, er);
        eg.addColorStop(0, '#6fb8ff'); eg.addColorStop(.7, '#1a4f9c'); eg.addColorStop(1, '#06204a');
        cx.fillStyle = eg; cx.beginPath(); cx.arc(cxp, cyp, er, 0, 6.283); cx.fill();
        // continents-ish blobs + grid
        cx.save(); cx.beginPath(); cx.arc(cxp, cyp, er, 0, 6.283); cx.clip();
        cx.fillStyle = 'rgba(70,160,90,.75)';
        for (var b = 0; b < 7; b++) { var bx = cxp + Math.cos(b * 2.1 + t * .0001) * er * .55, by = cyp + Math.sin(b * 1.7) * er * .5; cx.beginPath(); cx.ellipse(bx, by, er * (.18 + (b % 3) * .06), er * (.12 + (b % 2) * .08), b, 0, 6.283); cx.fill(); }
        cx.strokeStyle = 'rgba(160,220,255,.25)'; cx.lineWidth = 1;
        for (var la = -60; la <= 60; la += 30) { var yy = cyp + Math.sin(la * Math.PI / 180) * er; cx.beginPath(); cx.moveTo(cxp - er, yy); cx.lineTo(cxp + er, yy); cx.stroke(); }
        for (var lo = -2; lo <= 2; lo++) { cx.beginPath(); cx.ellipse(cxp, cyp, Math.abs(lo) * er * .35 + 1, er, 0, 0, 6.283); cx.stroke(); }
        cx.restore();
        var aw = 1.15 + bt.k * .2;
        var atm = cx.createRadialGradient(cxp, cyp, er * .95, cxp, cyp, er * aw); atm.addColorStop(0, 'hsla(' + ((200 + nhue) % 360) + ',100%,70%,' + (.45 + bt.k * .4) + ')'); atm.addColorStop(1, 'rgba(120,190,255,0)');
        cx.fillStyle = atm; cx.beginPath(); cx.arc(cxp, cyp, er * aw, 0, 6.283); cx.fill();
        // aurora ring around the north of the globe
        cx.strokeStyle = 'hsla(' + (140 + bt.k * 60) + ',100%,60%,' + (.25 + bt.e * .4 + bt.k * .3) + ')'; cx.lineWidth = Math.max(1, er * .05);
        cx.beginPath(); cx.ellipse(cxp, cyp - er * .72, er * .45, er * .12, 0, 0, 6.283); cx.stroke();
      }
      flash('hsl(' + nhue + ',100%,70%)', bt.k * .12);
      // targeting reticle
      if (t > 20000) {
        var rp = Math.min(1, (t - 20000) / 3500), rs = R * (.45 - rp * .33), spin = t * .003;
        rs *= 1 + bt.k * .15;
        cx.strokeStyle = 'rgba(61,255,154,.9)'; cx.lineWidth = Math.max(1, (2 + bt.k * 3) * S * 2);
        cx.beginPath(); cx.arc(cxp, cyp, rs, spin, spin + 1.2); cx.stroke();
        cx.beginPath(); cx.arc(cxp, cyp, rs, spin + 3.14, spin + 4.34); cx.stroke();
        cx.beginPath(); cx.moveTo(cxp - rs * 1.3, cyp); cx.lineTo(cxp - rs * .6, cyp); cx.moveTo(cxp + rs * .6, cyp); cx.lineTo(cxp + rs * 1.3, cyp);
        cx.moveTo(cxp, cyp - rs * 1.3); cx.lineTo(cxp, cyp - rs * .6); cx.moveTo(cxp, cyp + rs * .6); cx.lineTo(cxp, cyp + rs * 1.3); cx.stroke();
        if (t > 23500) {
          var p2 = Math.max(.3, bt.k);
          cx.fillStyle = 'rgba(61,255,154,' + p2 + ')'; cx.beginPath(); cx.arc(cxp, cyp, R * .012 + p2 * R * .006, 0, 6.283); cx.fill();
        }
      }
    }, 30);
  }


  // ==================================================================
  // MUSIC VISUALS (all silent, all react to the music)
  // ==================================================================
  // Shared beat input: B.e = energy (0-1), B.k = kick (bass hit, 0-1), B.hit = true on the frame a kick lands.
  // If no music signal is coming in, it falls back to a steady 120 BPM so visuals never sit still.
  function beatTracker() {
    var B = window.BEAT, b = { e: 0, k: 0, hit: false, lastKicks: B ? B.kicks : 0, auto: 0 };
    XP.onMeter = function () {};
    try { if (A) A.meter(true); } catch (e) {}
    b.tick = function (now) {
      now = now || performance.now();
      if (B) B.tick();
      var live = B && Date.now() - B.live < 2000;
      if (live) {
        b.e = B.e; b.k = B.k;
        b.hit = B.kicks !== b.lastKicks; b.lastKicks = B.kicks;
      } else {
        var ph = (now % 500) / 500;
        b.hit = ph < b.auto; b.auto = ph;
        b.k = Math.pow(1 - ph, 3); b.e = .45 + .25 * Math.sin(now * .002);
      }
      return Math.max(b.e * .8, b.k);
    };
    return b;
  }
  function flash(col, a) { if (a > .02) { cx.fillStyle = col; cx.globalAlpha = Math.min(.6, a); cx.fillRect(0, 0, W, H); cx.globalAlpha = 1; } }
  function rnd(a, b2) { return a + Math.random() * (b2 - a); }

  // 1. OUTRUN HIGHWAY
  function outrun() {
    var b = beatTracker(), stars = [], palms = [];
    for (var i = 0; i < 60; i++) stars.push([Math.random(), Math.random() * .45, Math.random() * 6]);
    for (var j = 0; j < 8; j++) palms.push({ z: j / 8, side: j % 2 ? 1 : -1 });
    text('xpTop', 'OUTRUN · NEXUS FM');
    var hueShift = 0;
    loop(function (now) {
      var p = b.tick(now), H0 = H * .5, speed = .006 + b.e * .02 + b.k * .02;
      if (b.hit) hueShift = (hueShift + 40) % 360;
      var g = cx.createLinearGradient(0, 0, 0, H0);
      g.addColorStop(0, '#090018'); g.addColorStop(.7, '#3a0d5c'); g.addColorStop(1, '#ff3d7f');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H0);
      stars.forEach(function (s2) { cx.fillStyle = 'rgba(255,255,255,' + (.3 + .5 * Math.abs(Math.sin(now * .002 + s2[2]))) + ')'; cx.fillRect(s2[0] * W, s2[1] * H, S * 2, S * 2); });
      var sr = H * (.2 + b.k * .04); cx.save(); cx.beginPath(); cx.arc(W / 2, H0, sr, Math.PI, 0); cx.clip();
      var sg = cx.createLinearGradient(0, H0 - sr, 0, H0); sg.addColorStop(0, '#ffe66d'); sg.addColorStop(1, '#ff3d7f'); cx.fillStyle = sg; cx.fillRect(W / 2 - sr, H0 - sr, sr * 2, sr);
      cx.fillStyle = '#3a0d5c'; for (var k = 0; k < 5; k++) cx.fillRect(W / 2 - sr, H0 - sr * .4 + k * sr * .09, sr * 2, 1 + k * sr * .015); cx.restore();
      cx.fillStyle = '#07000f'; cx.fillRect(0, H0, W, H - H0);
      // road
      cx.fillStyle = '#140024'; cx.beginPath(); cx.moveTo(W / 2 - W * .02, H0); cx.lineTo(W / 2 + W * .02, H0); cx.lineTo(W * .95, H); cx.lineTo(W * .05, H); cx.closePath(); cx.fill();
      cx.strokeStyle = 'hsl(' + ((185 + hueShift) % 360) + ',100%,' + (50 + b.k * 30) + '%)'; cx.lineWidth = Math.max(1, (2 + b.k * 5) * S * 2);
      cx.beginPath(); cx.moveTo(W / 2 - W * .02, H0); cx.lineTo(W * .05, H); cx.moveTo(W / 2 + W * .02, H0); cx.lineTo(W * .95, H); cx.stroke();
      // side light bars racing past
      for (var lb = 0; lb < 6; lb++) {
        var lz = ((lb / 6) + now * speed * .02) % 1, ly = H0 + (H - H0) * lz * lz, lw = W * (.02 + lz * .25);
        cx.fillStyle = 'hsla(' + ((300 + hueShift + lb * 20) % 360) + ',100%,60%,' + (.3 + b.k * .6) + ')';
        cx.fillRect(W / 2 - W * .02 - lz * W * .45 - lw, ly, lw, Math.max(1, lz * H * .012));
        cx.fillRect(W / 2 + W * .02 + lz * W * .45, ly, lw, Math.max(1, lz * H * .012));
      }
      var off = (now * speed * .05) % 1;
      cx.fillStyle = 'rgba(255,230,109,.9)';
      for (var d = 0; d < 10; d++) {
        var z = (d + off) / 10, y = H0 + (H - H0) * z * z, w2 = 2 + z * W * .01, h2 = (H - H0) * .04 * z;
        cx.fillRect(W / 2 - w2 / 2, y, w2, h2);
      }
      // palms
      palms.forEach(function (pm) {
        pm.z += speed * .1; if (pm.z > 1) pm.z -= 1;
        var z = pm.z * pm.z, x = W / 2 + pm.side * (W * .03 + z * W * .55), base = H0 + (H - H0) * z, hgt = H * .05 + z * H * .5;
        cx.strokeStyle = '#000'; cx.lineWidth = Math.max(1, z * W * .008);
        cx.beginPath(); cx.moveTo(x, base); cx.quadraticCurveTo(x + pm.side * hgt * .1, base - hgt * .5, x, base - hgt); cx.stroke();
        cx.lineWidth = Math.max(1, z * W * .004);
        for (var f = 0; f < 6; f++) { var a = f / 6 * Math.PI * 2; cx.beginPath(); cx.moveTo(x, base - hgt); cx.quadraticCurveTo(x + Math.cos(a) * hgt * .25, base - hgt - hgt * .12, x + Math.cos(a) * hgt * .38, base - hgt + Math.abs(Math.sin(a)) * hgt * .12); cx.stroke(); }
      });
      // truck from behind with underglow
      var tw = W * .16, th = H * .14, tx = W / 2 - tw / 2 + Math.sin(now * .0015) * W * .01, ty = H * .78;
      var glow = cx.createRadialGradient(W / 2, ty + th, 0, W / 2, ty + th, tw * .9);
      glow.addColorStop(0, 'hsla(' + ((210 + hueShift) % 360) + ',100%,55%,' + (.4 + b.k * .6) + ')'); glow.addColorStop(1, 'rgba(0,140,255,0)');
      cx.fillStyle = glow; cx.fillRect(W / 2 - tw, ty, tw * 2, th * 1.6);
      cx.fillStyle = '#05050a'; cx.fillRect(tx, ty + th * .35, tw, th * .55); cx.fillRect(tx + tw * .18, ty, tw * .64, th * .4);
      cx.fillStyle = '#ff1744'; cx.fillRect(tx + tw * .03, ty + th * .45, tw * .12, th * .1); cx.fillRect(tx + tw * .85, ty + th * .45, tw * .12, th * .1);
      cx.fillStyle = '#000'; cx.fillRect(tx - tw * .02, ty + th * .8, tw * .2, th * .25); cx.fillRect(tx + tw * .82, ty + th * .8, tw * .2, th * .25);
      flash('hsl(' + ((320 + hueShift) % 360) + ',100%,60%)', b.k * .18);
    }, 30);
  }
  // 4. BLUE FIRE
  function bluefire() {
    var b = beatTracker(), parts = [];
    text('xpTop', 'BLUE FIRE');
    loop(function () {
      var p = b.tick();
      cx.globalCompositeOperation = 'source-over';
      cx.fillStyle = 'rgba(0,0,6,.35)'; cx.fillRect(0, 0, W, H);
      var spawn = 4 + Math.floor(b.e * 10) + (b.hit ? 40 : 0);
      for (var i = 0; i < spawn && parts.length < 380; i++) parts.push({ x: rnd(.1, .9) * W, y: H + 4, vx: rnd(-.4, .4), vy: -rnd(1.2, 2.6) * (1 + b.k * 2.5) * S * 2, life: 1, r: rnd(6, 16) * S * 2 * (1 + b.k * 1.5) });
      cx.globalCompositeOperation = 'lighter';
      for (var k = parts.length - 1; k >= 0; k--) {
        var q = parts[k]; q.x += q.vx + Math.sin(q.y * .03) * .6; q.y += q.vy; q.life -= .012; q.r *= .985;
        if (q.life <= 0) { parts.splice(k, 1); continue; }
        var hue = 195 + (1 - q.life) * 40, g = cx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
        g.addColorStop(0, 'hsla(' + hue + ',100%,' + (60 + q.life * 30) + '%,' + (q.life * .5) + ')'); g.addColorStop(1, 'hsla(' + hue + ',100%,50%,0)');
        cx.fillStyle = g; cx.fillRect(q.x - q.r, q.y - q.r, q.r * 2, q.r * 2);
      }
      cx.globalCompositeOperation = 'source-over';
    }, 30);
  }


  // 6. VAPORWAVE
  function vapor() {
    var b = beatTracker();
    text('xpTop', 'V A P O R W A V E');
    $('xpMid').style.color = '#fff';
    text('xpMid', '<span style="background:linear-gradient(#ffffff,#9be8ff 45%,#ff71ce 55%,#ffffff);-webkit-background-clip:text;color:transparent;font-size:12vmin;letter-spacing:2vmin">N E X U S</span>');
    loop(function (now) {
      var p = b.tick(now), H0 = H * .55;
      var g = cx.createLinearGradient(0, 0, 0, H0); g.addColorStop(0, '#2b1055'); g.addColorStop(.6, '#ff71ce'); g.addColorStop(1, '#ffb3e6'); cx.fillStyle = g; cx.fillRect(0, 0, W, H0);
      var sr = H * (.22 + b.k * .05), sx = W * .5, sy = H0 * .95;
      var sg = cx.createLinearGradient(0, sy - sr, 0, sy); sg.addColorStop(0, '#fffb96'); sg.addColorStop(1, '#ff71ce');
      cx.save(); cx.beginPath(); cx.arc(sx, sy, sr, Math.PI, 0); cx.clip(); cx.fillStyle = sg; cx.fillRect(sx - sr, sy - sr, sr * 2, sr);
      cx.fillStyle = '#ffb3e6'; for (var k = 0; k < 5; k++) cx.fillRect(sx - sr, sy - sr * .5 + k * sr * .1, sr * 2, 1 + k * 2); cx.restore();
      cx.fillStyle = '#01cdfe'; cx.fillRect(0, H0, W, H - H0);
      cx.fillStyle = '#05ffa1'; cx.globalAlpha = .15; cx.fillRect(0, H0, W, H - H0); cx.globalAlpha = 1;
      cx.strokeStyle = 'rgba(255,113,206,' + (.6 + p * .4) + ')'; cx.lineWidth = Math.max(1, 1.5 * S * 2);
      vapor.off = ((vapor.off || 0) + .004 + b.e * .01 + b.k * .02) % 1; var off = vapor.off;
      for (var r = 0; r < 12; r++) { var z = (r + 1 - off) / 12, y = H0 + (H - H0) * z * z; cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke(); }
      for (var c2 = -10; c2 <= 10; c2++) { cx.beginPath(); cx.moveTo(W / 2 + c2 * W * .02, H0); cx.lineTo(W / 2 + c2 * W * .14, H); cx.stroke(); }
      $('xpMid').style.transform = 'translateY(' + (Math.sin(now * .001) * 6 - 40) + 'px) scale(' + (1 + b.k * .12) + ')';
      flash('#ff71ce', b.k * .15);
    }, 30);
  }

  // 7. KALEIDOSCOPE
  function kaleido() {
    var b = beatTracker(), SEG = 12, hue = 0;
    text('xpTop', 'KALEIDOSCOPE');
    loop(function (now) {
      var p = b.tick(now); hue = (hue + .6 + b.e * 3 + (b.hit ? 50 : 0)) % 360; kaleido.spin = (kaleido.spin || 0) + .002 + b.e * .01 + (b.hit ? .25 : 0);
      cx.fillStyle = 'rgba(0,0,0,.25)'; cx.fillRect(0, 0, W, H);
      var R = Math.max(W, H) * .6, t = now * .0004;
      cx.save(); cx.translate(W / 2, H / 2); cx.rotate(kaleido.spin); cx.scale(1 + b.k * .25, 1 + b.k * .25);
      for (var sgm = 0; sgm < SEG; sgm++) {
        cx.save(); cx.rotate(sgm * Math.PI * 2 / SEG); if (sgm % 2) cx.scale(1, -1);
        for (var k = 0; k < 7; k++) {
          var d = (k / 7 + t * .2) % 1, x = d * R, y = Math.sin(t * 3 + k) * R * .12 * d, sz = (6 + k * 3) * S * 2 * (1 + b.e * .8 + b.k * 1.5) * (.4 + d);
          cx.fillStyle = 'hsla(' + ((hue + k * 40) % 360) + ',100%,' + (50 + p * 15) + '%,.8)';
          cx.beginPath(); cx.moveTo(x, y - sz); cx.lineTo(x + sz, y + sz * .7); cx.lineTo(x - sz, y + sz * .7); cx.closePath(); cx.fill();
        }
        cx.restore();
      }
      cx.restore();
    }, 30);
  }

  // 8. SPEAKER RING
  function ring() {
    var b = beatTracker(), N2 = 64, bars = [], seeds = [];
    for (var i = 0; i < N2; i++) { bars.push(0); seeds.push(Math.random() * 10); }
    text('xpTop', 'NEXUS SOUND RING');
    loop(function (now) {
      var p = b.tick(now);
      cx.fillStyle = 'rgba(0,0,8,.4)'; cx.fillRect(0, 0, W, H);
      var cxp = W / 2, cyp = H / 2, R = Math.min(W, H) * (.22 + b.k * .03);
      for (var i = 0; i < N2; i++) {
        var low = i < N2 / 4 || i > N2 * 3 / 4 ? b.k : b.e;
        var target = low * (.35 + .65 * Math.abs(Math.sin(now * .006 + seeds[i] + i * .3))) + .05;
        bars[i] += (target - bars[i]) * .35;
        var a = i / N2 * Math.PI * 2 + now * .0002, len = R * .2 + bars[i] * R * 1.3;
        var x1 = cxp + Math.cos(a) * R, y1 = cyp + Math.sin(a) * R, x2 = cxp + Math.cos(a) * (R + len), y2 = cyp + Math.sin(a) * (R + len);
        cx.strokeStyle = 'hsl(' + (190 + i / N2 * 140) + ',100%,' + (50 + bars[i] * 30) + '%)'; cx.lineWidth = Math.max(1, R * .05);
        cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke();
      }
      var g = cx.createRadialGradient(cxp, cyp, 0, cxp, cyp, R * .95);
      g.addColorStop(0, 'rgba(61,255,154,' + (.2 + b.k * .7) + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g; cx.beginPath(); cx.arc(cxp, cyp, R * .95, 0, 6.283); cx.fill();
      cx.fillStyle = '#fff'; cx.font = 'bold ' + Math.floor(R * .28) + 'px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText('NEXUS', cxp, cyp);
    }, 30);
  }

  // 9. NORTHERN LIGHTS — calm, slow curtains; the COLOURS change with the beat
  function aurora() {
    var b = beatTracker(), stars = [];
    for (var i = 0; i < 120; i++) stars.push([Math.random(), Math.random() * .8, Math.random() * 6, Math.random()]);
    // three colour sets the curtains glide between on each beat
    var PALETTES = [[135, 160, 285], [180, 200, 300], [100, 140, 320], [160, 290, 330], [120, 190, 260], [60, 140, 200]];
    var pal = 0, cur = PALETTES[0].slice(), glow = 0;
    text('xpTop', 'NORTHERN LIGHTS');
    loop(function (now) {
      b.tick(now);
      if (b.hit) { pal = (pal + 1) % PALETTES.length; glow = 1; }
      glow *= .92;
      for (var c = 0; c < 3; c++) {                    // smooth glide toward the new colours
        var target = PALETTES[pal][c], d = ((target - cur[c] + 540) % 360) - 180;
        cur[c] = (cur[c] + d * .12 + 360) % 360;
      }
      var g = cx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#000208'); g.addColorStop(1, '#03142a'); cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      stars.forEach(function (s2) { cx.fillStyle = 'rgba(255,255,255,' + (.2 + .6 * Math.abs(Math.sin(now * .0015 + s2[2]))) * s2[3] + ')'; cx.fillRect(s2[0] * W, s2[1] * H, S * 2, S * 2); });
      cx.globalCompositeOperation = 'lighter';
      for (var band = 0; band < 3; band++) {
        var baseY = H * (.25 + band * .1), hh = cur[band];
        for (var x = 0; x < W; x += Math.max(2, 3 * S * 2)) {
          var u = x / W, y = baseY + Math.sin(u * 6 + now * .0004 + band) * H * .07 + Math.sin(u * 15 - now * .0007) * H * .02;
          var hgt = H * (.22 + .1 * Math.sin(u * 9 + now * .0005 + band));
          var al = (.1 + .05 * Math.sin(u * 20 + now * .002)) * (1 + glow * .6);
          var gr = cx.createLinearGradient(0, y - hgt, 0, y);
          gr.addColorStop(0, 'hsla(' + hh + ',100%,60%,0)'); gr.addColorStop(1, 'hsla(' + hh + ',100%,' + (55 + glow * 10) + '%,' + Math.min(.7, al) + ')');
          cx.fillStyle = gr; cx.fillRect(x, y - hgt, Math.max(2, 3 * S * 2), hgt);
        }
      }
      cx.globalCompositeOperation = 'source-over';
      cx.fillStyle = '#000'; cx.beginPath(); cx.moveTo(0, H);
      for (var m = 0; m <= 30; m++) { var tx = m / 30 * W, ty = H * (.86 - .06 * Math.abs(Math.sin(m * 1.3)) - (m % 3 === 0 ? .05 : 0)); cx.lineTo(tx, ty); }
      cx.lineTo(W, H); cx.closePath(); cx.fill();
    }, 24);
  }


  // ==================================================================
  // NEW: colour that changes with the music. Every beat moves to a new
  // colour and it glides there smoothly (no jumpy flashing).
  // ==================================================================
  function beatHue(start, step) {
    var h = { cur: start || 200, target: start || 200, step: step || 70 };
    h.tick = function (hit) {
      if (hit) h.target = (h.target + h.step * (.7 + Math.random() * .6)) % 360;
      var d = ((h.target - h.cur + 540) % 360) - 180;
      h.cur = (h.cur + d * .1 + 360) % 360;
      return h.cur;
    };
    return h;
  }

  // 10. SHATTER — glowing screen that cracks and smashes on big hits
  function shatter() {
    var b = beatTracker(), hue = beatHue(200, 80), shards = null, crackT = 0, lastSmash = 0, impact = null, cracks = [];
    var snap = document.createElement('canvas'), sx = snap.getContext('2d');
    var rays = [];
    for (var i = 0; i < 40; i++) rays.push([Math.random(), Math.random() * .5 + .5, Math.random() * 6.28]);
    text('xpTop', 'SHATTER');
    function scene(now, hh, p) {
      var g = cx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * .75);
      g.addColorStop(0, 'hsl(' + hh + ',100%,' + (30 + p * 15) + '%)');
      g.addColorStop(.5, 'hsl(' + ((hh + 40) % 360) + ',90%,14%)');
      g.addColorStop(1, '#020006');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      cx.save(); cx.translate(W / 2, H / 2); cx.rotate(now * .00008); cx.globalCompositeOperation = 'lighter';
      for (var r = 0; r < rays.length; r++) {
        var a = rays[r][2] + Math.sin(now * .0003 + r) * .05, len = Math.max(W, H) * rays[r][1];
        cx.fillStyle = 'hsla(' + ((hh + r * 6) % 360) + ',100%,60%,' + (.03 + p * .05) + ')';
        cx.beginPath(); cx.moveTo(0, 0); cx.lineTo(Math.cos(a - .03) * len, Math.sin(a - .03) * len); cx.lineTo(Math.cos(a + .03) * len, Math.sin(a + .03) * len); cx.fill();
      }
      cx.restore(); cx.globalCompositeOperation = 'source-over';
      var fs = Math.floor(Math.min(W, H) * .22 * (1 + b.k * .08));
      cx.font = '900 ' + fs + 'px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.shadowColor = 'hsl(' + hh + ',100%,60%)'; cx.shadowBlur = fs * .35;
      cx.fillStyle = 'hsl(' + hh + ',100%,88%)'; cx.fillText('NEXUS', W / 2, H / 2);
      cx.shadowBlur = 0;
    }
    function edge(px, py, a) {
      var dx = Math.cos(a), dy = Math.sin(a), t = 1e9;
      if (dx > 1e-6) t = Math.min(t, (W - px) / dx); if (dx < -1e-6) t = Math.min(t, -px / dx);
      if (dy > 1e-6) t = Math.min(t, (H - py) / dy); if (dy < -1e-6) t = Math.min(t, -py / dy);
      return [px + dx * t, py + dy * t];
    }
    function smash(now) {
      snap.width = W; snap.height = H; sx.drawImage(cv, 0, 0);
      var px = W * (.3 + Math.random() * .4), py = H * (.3 + Math.random() * .4), n = 16;
      impact = [px, py]; shards = []; cracks = [];
      var angs = [], fr = [];
      for (var i = 0; i < n; i++) { angs.push((i + Math.random() * .6) / n * 6.2832); fr.push(.25 + Math.random() * .35); }
      var corners = [[0, 0], [W, 0], [W, H], [0, H]].map(function (c) { var a = Math.atan2(c[1] - py, c[0] - px); return [c[0], c[1], a < 0 ? a + 6.2832 : a]; });
      for (var k = 0; k < n; k++) {
        var a0 = angs[k], a1 = k + 1 < n ? angs[k + 1] : angs[0] + 6.2832;
        var e0 = edge(px, py, a0), e1 = edge(px, py, a1);
        var m0 = [px + (e0[0] - px) * fr[k], py + (e0[1] - py) * fr[k]], k1 = (k + 1) % n, m1 = [px + (e1[0] - px) * fr[k1], py + (e1[1] - py) * fr[k1]];
        var outer = [m0, e0];
        corners.forEach(function (c) { var ca = c[2]; if (ca < a0) ca += 6.2832; if (ca > a0 && ca < a1) outer.push([c[0], c[1], ca]); });
        outer.sort(function (u, v) { return (u[2] || 0) - (v[2] || 0); });
        outer = [m0, e0].concat(outer.filter(function (q) { return q.length === 3; })).concat([e1, m1]);
        [[[px, py], m0, m1], outer].forEach(function (poly, inner) {
          var cxm = 0, cym = 0; poly.forEach(function (q) { cxm += q[0]; cym += q[1]; }); cxm /= poly.length; cym /= poly.length;
          var dx = cxm - px, dy = cym - py, d = Math.sqrt(dx * dx + dy * dy) || 1, sp = (inner ? 3 : 6) * (W / 640);
          shards.push({ poly: poly, cx: cxm, cy: cym, vx: dx / d * sp * (.5 + Math.random()), vy: dy / d * sp * (.5 + Math.random()) - 2 * (W / 640), r: 0, vr: (Math.random() - .5) * .12, ox: 0, oy: 0 });
        });
        cracks.push([m0, e0]); cracks.push([m0, m1]);
      }
      crackT = now; lastSmash = now;
    }
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit);
      if (b.hit && !shards && now - lastSmash > 2400 && b.k > .35) smash(now);
      scene(now, hh, p);
      if (shards) {
        var t = now - crackT, lw = Math.max(1, S * 2.5);
        if (t < 200) {                         // the crack appears first…
          cx.drawImage(snap, 0, 0);
          cx.strokeStyle = 'rgba(255,255,255,.9)'; cx.lineWidth = lw; cx.beginPath();
          cracks.forEach(function (c) { cx.moveTo(impact[0], impact[1]); cx.lineTo(c[0][0], c[0][1]); cx.moveTo(c[0][0], c[0][1]); cx.lineTo(c[1][0], c[1][1]); });
          cx.stroke();
          flash('#fff', .25 * (1 - t / 200));
        } else {                               // …then the glass falls away
          var life = (t - 200) / 1100, grav = .5 * (W / 640);
          if (life >= 1) shards = null;
          else {
            cx.globalAlpha = 1 - life * life;
            shards.forEach(function (sh) {
              sh.vy += grav; sh.ox += sh.vx; sh.oy += sh.vy; sh.r += sh.vr;
              cx.save(); cx.translate(sh.cx + sh.ox, sh.cy + sh.oy); cx.rotate(sh.r); cx.translate(-sh.cx, -sh.cy);
              cx.beginPath(); sh.poly.forEach(function (q, i) { if (i) cx.lineTo(q[0], q[1]); else cx.moveTo(q[0], q[1]); }); cx.closePath();
              cx.save(); cx.clip(); cx.drawImage(snap, 0, 0); cx.restore();
              cx.strokeStyle = 'rgba(255,255,255,.7)'; cx.lineWidth = lw; cx.stroke();
              cx.restore();
            });
            cx.globalAlpha = 1;
          }
        }
      }
    }, 30);
  }

  // 11. HYPERSPACE — lightspeed jump, star colours change with the beat
  function hyper() {
    var b = beatTracker(), hue = beatHue(210, 60), stars = [], NS = 260, warp = 0, beats = 0, jump = 0;
    function reset(st, far) { st.x = (Math.random() - .5) * 2; st.y = (Math.random() - .5) * 2; st.z = far ? 1 : Math.random(); st.pz = st.z; st.h = (Math.random() - .5) * 60; }
    for (var i = 0; i < NS; i++) { var st = {}; reset(st, false); stars.push(st); }
    text('xpTop', 'HYPERSPACE');
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit);
      if (b.hit) { beats++; if (beats % 16 === 0) jump = 1; }
      jump *= .95;
      warp += ((.006 + b.e * .02 + b.k * .02 + jump * .06) - warp) * .2;
      cx.fillStyle = 'rgba(0,0,6,' + (.55 - jump * .4) + ')'; cx.fillRect(0, 0, W, H);
      var cxp = W / 2, cyp = H / 2, F = Math.min(W, H) * .5;
      var g = cx.createRadialGradient(cxp, cyp, 0, cxp, cyp, F * (.5 + p * .4));
      g.addColorStop(0, 'hsla(' + hh + ',100%,70%,' + (.15 + p * .2 + jump * .5) + ')'); g.addColorStop(1, 'hsla(' + hh + ',100%,50%,0)');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      cx.lineCap = 'round';
      for (var i = 0; i < NS; i++) {
        var s2 = stars[i]; s2.pz = s2.z; s2.z -= warp;
        if (s2.z <= .02) { reset(s2, true); continue; }
        var x = cxp + s2.x / s2.z * F, y = cyp + s2.y / s2.z * F, px = cxp + s2.x / s2.pz * F, py = cyp + s2.y / s2.pz * F;
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) { reset(s2, true); continue; }
        var near = 1 - s2.z;
        cx.strokeStyle = 'hsla(' + ((hh + s2.h + 360) % 360) + ',100%,' + (55 + near * 15) + '%,' + (.35 + near * .65) + ')';
        cx.lineWidth = Math.max(1, near * 3 * S * 2);
        cx.beginPath(); cx.moveTo(px, py); cx.lineTo(x, y); cx.stroke();
      }
      flash('hsl(' + hh + ',100%,85%)', jump > .9 ? .5 : 0);
    }, 30);
  }

  // 12. UNDERWATER — calm deep sea, glowing jellyfish, colour shifts on the beat
  function water() {
    var b = beatTracker(), hue = beatHue(195, 45), bubbles = [], snow = [], jellies = [];
    for (var i = 0; i < 40; i++) bubbles.push([Math.random(), Math.random(), .3 + Math.random(), Math.random() * 6]);
    for (var j = 0; j < 90; j++) snow.push([Math.random(), Math.random(), Math.random()]);
    for (var k = 0; k < 5; k++) jellies.push({ x: .12 + k * .19 + Math.random() * .05, y: .35 + Math.random() * .4, s: .07 + Math.random() * .05, ph: Math.random() * 6, h: k * 50, pulse: 0 });
    text('xpTop', 'DEEP SEA');
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit), t = now * .001;
      var g = cx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'hsl(' + hh + ',80%,' + (22 + p * 6) + '%)'); g.addColorStop(.55, 'hsl(' + ((hh + 20) % 360) + ',85%,9%)'); g.addColorStop(1, '#000206');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      // light rays from the surface, gently swaying
      cx.globalCompositeOperation = 'lighter';
      for (var r = 0; r < 7; r++) {
        var x0 = W * (r / 6) + Math.sin(t * .3 + r) * W * .05, wdt = W * (.04 + .02 * Math.sin(t * .5 + r * 2));
        var rg = cx.createLinearGradient(0, 0, 0, H * .9);
        rg.addColorStop(0, 'hsla(' + ((hh + 30) % 360) + ',100%,80%,' + (.08 + p * .05) + ')'); rg.addColorStop(1, 'hsla(' + hh + ',100%,60%,0)');
        cx.fillStyle = rg; cx.beginPath(); cx.moveTo(x0 - wdt, 0); cx.lineTo(x0 + wdt, 0); cx.lineTo(x0 + wdt * 3 + W * .1, H * .9); cx.lineTo(x0 - wdt * 2 + W * .1, H * .9); cx.fill();
      }
      // drifting specks
      cx.fillStyle = 'rgba(200,240,255,.35)';
      snow.forEach(function (q) { q[1] += .0004 + q[2] * .0004; if (q[1] > 1) q[1] = 0; cx.fillRect((q[0] + Math.sin(t * .4 + q[2] * 9) * .01) * W, q[1] * H, S * 2, S * 2); });
      // jellyfish
      jellies.forEach(function (jf, idx) {
        if (b.hit && idx % 2 === (Math.random() < .5 ? 0 : 1)) jf.pulse = 1;
        jf.pulse *= .9;
        jf.y -= .0006 + jf.pulse * .004; if (jf.y < -.15) { jf.y = 1.15; jf.x = .1 + Math.random() * .8; }
        var jx = (jf.x + Math.sin(t * .3 + jf.ph) * .03) * W, jy = jf.y * H, R = jf.s * Math.min(W, H) * 2, sq = 1 - jf.pulse * .25;
        var jh = (hh + jf.h) % 360;
        var gl = cx.createRadialGradient(jx, jy, 0, jx, jy, R * 2.2);
        gl.addColorStop(0, 'hsla(' + jh + ',100%,70%,' + (.25 + jf.pulse * .35 + p * .1) + ')'); gl.addColorStop(1, 'hsla(' + jh + ',100%,50%,0)');
        cx.fillStyle = gl; cx.fillRect(jx - R * 2.2, jy - R * 2.2, R * 4.4, R * 4.4);
        cx.strokeStyle = 'hsla(' + jh + ',100%,75%,.5)'; cx.lineWidth = Math.max(1, S * 2);
        for (var tn = 0; tn < 6; tn++) {
          cx.beginPath(); var bx = jx - R * .7 * sq + tn * R * .28 * sq; cx.moveTo(bx, jy);
          for (var sg = 1; sg <= 8; sg++) cx.lineTo(bx + Math.sin(t * 2 + sg * .7 + tn + jf.ph) * R * .15, jy + sg * R * .3);
          cx.stroke();
        }
        cx.fillStyle = 'hsla(' + jh + ',100%,' + (70 + jf.pulse * 15) + '%,.55)';
        cx.beginPath(); cx.ellipse(jx, jy, R * sq, R * (.8 + jf.pulse * .2), 0, Math.PI, 0); cx.closePath(); cx.fill();
        cx.fillStyle = 'rgba(255,255,255,.25)'; cx.beginPath(); cx.ellipse(jx - R * .3, jy - R * .45, R * .25, R * .12, -.4, 0, 6.283); cx.fill();
      });
      // bubbles
      cx.strokeStyle = 'rgba(220,250,255,.5)'; cx.lineWidth = Math.max(1, S * 1.5);
      bubbles.forEach(function (q) {
        q[1] -= .002 * q[2] * (1 + b.e); if (q[1] < -.05) { q[1] = 1.05; q[0] = Math.random(); }
        var bx = (q[0] + Math.sin(t * 2 + q[3]) * .006) * W, rr = (2 + q[2] * 4) * S * 2;
        cx.beginPath(); cx.arc(bx, q[1] * H, rr, 0, 6.283); cx.stroke();
      });
      cx.globalCompositeOperation = 'source-over';
    }, 30);
  }

  // 13. HOLOGRAM FRIEND — human wireframe head. Changes colour with the music,
  //     eyes look around, and it pulls random crazy moves. Tap it for a new trick.
  function friend() {
    var b = beatTracker(), hue = beatHue(190, 55);
    // head cross-sections from neck to crown: [height, half-width, half-depth, forward shift]
    var T = [[-1.05, .36, .40, -.15], [-.70, .34, .38, -.12], [-.62, .28, .36, .06], [-.50, .40, .50, .04], [-.35, .56, .64, .02],
             [-.15, .70, .78, 0], [.05, .74, .84, 0], [.25, .76, .88, -.02], [.50, .74, .88, -.05], [.75, .62, .75, -.07], [.92, .40, .48, -.08], [1, .05, .05, -.08]];
    function sect(h) {
      for (var i = 1; i < T.length; i++) if (h <= T[i][0]) { var A2 = T[i - 1], B2 = T[i], f = (h - A2[0]) / (B2[0] - A2[0]); return [A2[1] + (B2[1] - A2[1]) * f, A2[2] + (B2[2] - A2[2]) * f, A2[3] + (B2[3] - A2[3]) * f]; }
      return [.05, .05, -.08];
    }
    function G(v, c, w) { return Math.exp(-Math.pow((v - c) / w, 2)); }
    function surf(h, u) {
      var sc = sect(h), x = sc[0] * Math.sin(u), z = sc[2] + sc[1] * Math.cos(u), fr = Math.max(0, Math.cos(u)); fr *= fr;
      if (h > -.64) {
        var ax = Math.abs(x), nose = h > -.17 && h < .15 ? (.15 - h) / .32 : 0;
        z += fr * (.3 * nose * G(x, 0, .075) + .08 * G(h, .24, .05) - .1 * G(h, .1, .07) * G(ax, .27, .12)
              + .03 * G(h, -.05, .1) * G(ax, .45, .12) + .05 * G(h, -.32, .05) * G(x, 0, .22) + .05 * G(h, -.55, .05) * G(x, 0, .2));
      }
      if (Math.abs(Math.abs(u) - 1.571) < .35 && h > -.12 && h < .2) x += (x > 0 ? 1 : -1) * .07 * G(h, .04, .09); // ears
      return [x, -h * 1.12, z];
    }
    var RINGS = 24, LONS = 26, mesh = [], jit = [];
    for (var r = 0; r <= RINGS; r++) { var row = [], jr = []; var h = -1.05 + r / RINGS * 2.04;
      for (var o = 0; o <= LONS; o++) { row.push(surf(h, o / LONS * 6.2832 - Math.PI)); jr.push([Math.random() - .5, Math.random() - .5, Math.random() - .5]); }
      mesh.push(row); jit.push(jr); }
    var eyes = [-1, 1].map(function (sd) { return { x: .27 * sd, h: .1 }; });
    function eyePt(e, dx, dh) { var sc = sect(e.h + dh), xx = e.x + dx, u = Math.asin(Math.max(-1, Math.min(1, xx / sc[0]))); var p = surf(e.h + dh, u); p[2] += .02; return p; }

    var gaze = [0, 0], gazeT = [0, 0], nextGaze = 0, blink = 0, nextBlink = 0;
    var move = null, moveT = 0, nextMove = performance.now() + 2500, spin = 0, nod = 0, beats = 0;
    var MOVES = ['spin', 'glitch', 'explode', 'laugh', 'stare', 'scan', 'rainbow', 'shake', 'tilt'];
    function startMove(m, now) { move = m || MOVES[Math.random() * MOVES.length | 0]; moveT = now; }
    function rot(p, yaw, pitch, roll) {
      var x = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), z = -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw), y = p[1];
      var y2 = y * Math.cos(pitch) - z * Math.sin(pitch), z2 = y * Math.sin(pitch) + z * Math.cos(pitch);
      var x3 = x * Math.cos(roll) - y2 * Math.sin(roll), y3 = x * Math.sin(roll) + y2 * Math.cos(roll);
      return [x3, y3, z2];
    }
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit);
      if (b.hit) { beats++; nod = 1; if (beats % 24 === 0) startMove('explode', now); }
      nod *= .85;
      if (!move && now > nextMove) { startMove(null, now); }
      var mt = move ? (now - moveT) / 1000 : 0, DUR = { spin: 1.6, glitch: .8, explode: 1.6, laugh: 1.8, stare: 2.2, scan: 2, rainbow: 4, shake: 1.2, tilt: 2 };
      if (move && mt > DUR[move]) { move = null; nextMove = now + 2500 + Math.random() * 3500; }
      var ease = move ? Math.sin(Math.min(1, mt / DUR[move]) * Math.PI) : 0;

      if (now > nextGaze) { gazeT = [(Math.random() - .5) * 2, (Math.random() - .5) * 1.4]; nextGaze = now + 600 + Math.random() * 2200; }
      if (move === 'stare') gazeT = [0, 0];
      gaze[0] += (gazeT[0] - gaze[0]) * .25; gaze[1] += (gazeT[1] - gaze[1]) * .25;
      if (now > nextBlink) { blink = 1; nextBlink = now + 1800 + Math.random() * 4000; }
      blink = Math.max(0, blink - .18);

      var yaw = gaze[0] * .25 + Math.sin(now * .0004) * .1, pitch = -.06 + gaze[1] * .1 - nod * .05, roll = Math.sin(now * .0003) * .04;
      if (move === 'spin') yaw += 6.2832 * (1 - Math.pow(1 - Math.min(1, mt / DUR.spin), 3));
      if (move === 'shake') yaw += Math.sin(mt * 40) * .25 * ease;
      if (move === 'tilt') { roll += .35 * ease; pitch += .12 * ease; }
      var scale = 1 + b.k * .03 + (move === 'stare' ? .25 * ease : 0);
      var ex = move === 'explode' ? Math.max(0, Math.sin(Math.min(1, mt / DUR.explode) * Math.PI)) : 0;
      var gl = move === 'glitch' ? 1 : (Math.random() < .015 ? .5 : 0);

      cx.fillStyle = '#000308'; cx.fillRect(0, 0, W, H);
      var cxp = W / 2, cyp = H * .44, R = Math.min(W, H) * .34 * scale;
      var g = cx.createRadialGradient(cxp, cyp, 0, cxp, cyp, R * 2);
      g.addColorStop(0, 'hsla(' + hh + ',100%,55%,' + (.14 + p * .14) + ')'); g.addColorStop(1, 'hsla(' + hh + ',100%,50%,0)');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);

      function P(pt, jj) {
        var q = pt;
        if (ex > 0 || gl > 0) q = [pt[0] * (1 + ex * 1.2) + jj[0] * (ex * 1.4 + gl * .06), pt[1] * (1 + ex * 1.2) + jj[1] * (ex * 1.4), pt[2] * (1 + ex * 1.2) + jj[2] * ex * 1.4];
        var rq = rot(q, yaw, pitch, roll), f = 3.4 / (3.4 - rq[2]);
        return [cxp + rq[0] * R * f, cyp + rq[1] * R * f, rq[2]];
      }
      var PP = mesh.map(function (row, ri) { return row.map(function (pt, oi) { return P(pt, jit[ri][oi]); }); });
      var lw = Math.max(1, S * 2.2), rainbow = move === 'rainbow';
      var scanY = move === 'scan' ? cyp - R * 1.2 + (mt / DUR.scan) * R * 2.6 : -1e9;
      cx.lineWidth = lw;
      function seg(a2, b2, ring) {
        var dep = (a2[2] + b2[2]) / 2, al = dep > 0 ? .25 + dep * .75 : .07;
        var near = Math.abs((a2[1] + b2[1]) / 2 - scanY) < R * .08;
        var hu = rainbow ? (hh + ring * 15) % 360 : hh;
        cx.strokeStyle = near ? 'rgba(255,255,255,.95)' : 'hsla(' + hu + ',100%,' + (60 + p * 15) + '%,' + al + ')';
        var o2 = gl ? (Math.random() - .5) * R * .08 * gl : 0;
        cx.beginPath(); cx.moveTo(a2[0] + o2, a2[1]); cx.lineTo(b2[0] + o2, b2[1]); cx.stroke();
      }
      for (var ri = 0; ri <= RINGS; ri++) for (var oi = 0; oi < LONS; oi++) seg(PP[ri][oi], PP[ri][oi + 1], ri);
      for (var oj = 0; oj < LONS; oj++) for (var rj = 0; rj < RINGS; rj++) seg(PP[rj][oj], PP[rj + 1][oj], rj);
      if (gl) { cx.globalCompositeOperation = 'lighter'; cx.drawImage(cv, R * .03 * gl, 0); cx.globalCompositeOperation = 'source-over'; }

      if (ex < .3) {
        var acc = 'hsl(' + ((hh + 180) % 360) + ',100%,' + (70 + p * 15) + '%)', wide = move === 'stare' ? 1.6 * ease + 1 : 1;
        var Z = [0, 0, 0];
        eyes.forEach(function (e) {
          var open = (.035 * wide) * (1 - blink);
          var L2 = P(eyePt(e, -.09, 0), Z), R2 = P(eyePt(e, .09, 0), Z), T2 = P(eyePt(e, 0, open + .004), Z), B2 = P(eyePt(e, 0, -open - .004), Z), C2 = P(eyePt(e, 0, 0), Z);
          if (C2[2] < 0) return;
          cx.strokeStyle = acc; cx.lineWidth = Math.max(1, S * 2.4);
          cx.beginPath(); cx.moveTo(L2[0], L2[1]); cx.quadraticCurveTo(T2[0] * 2 - (L2[0] + R2[0]) / 2, T2[1] * 2 - (L2[1] + R2[1]) / 2, R2[0], R2[1]);
          cx.quadraticCurveTo(B2[0] * 2 - (L2[0] + R2[0]) / 2, B2[1] * 2 - (L2[1] + R2[1]) / 2, L2[0], L2[1]); cx.stroke();
          if (blink < .5) {
            var I2 = P(eyePt(e, gaze[0] * .045, gaze[1] * .012), Z), ir = R * .034 * (move === 'stare' ? .7 : 1);
            cx.shadowColor = acc; cx.shadowBlur = R * .12; cx.fillStyle = acc;
            cx.beginPath(); cx.arc(I2[0], I2[1], ir, 0, 6.283); cx.fill(); cx.shadowBlur = 0;
            cx.fillStyle = '#000'; cx.beginPath(); cx.arc(I2[0], I2[1], ir * .45, 0, 6.283); cx.fill();
          }
        });
        // lips: move a little with the bass, wide open when laughing
        var mo = (move === 'laugh' ? .05 + .04 * Math.abs(Math.sin(mt * 14)) : b.k * .025) + .004;
        var ml = P(surf(-.33, -.3), Z), mr = P(surf(-.33, .3), Z), up = P(surf(-.33 + mo * .3, 0), Z), dn = P(surf(-.33 - mo, 0), Z);
        if (up[2] > 0) {
          cx.strokeStyle = acc; cx.lineWidth = Math.max(1, S * 2.6);
          cx.beginPath(); cx.moveTo(ml[0], ml[1]); cx.quadraticCurveTo(up[0] * 2 - (ml[0] + mr[0]) / 2, up[1] * 2 - (ml[1] + mr[1]) / 2, mr[0], mr[1]);
          cx.quadraticCurveTo(dn[0] * 2 - (ml[0] + mr[0]) / 2, dn[1] * 2 - (ml[1] + mr[1]) / 2, ml[0], ml[1]); cx.stroke();
        }
      }
      // hologram base, scan beam, scanlines
      var by = cyp + R * 1.25;
      var bg2 = cx.createRadialGradient(cxp, by, 0, cxp, by, R);
      bg2.addColorStop(0, 'hsla(' + hh + ',100%,60%,' + (.35 + p * .3) + ')'); bg2.addColorStop(1, 'hsla(' + hh + ',100%,50%,0)');
      cx.fillStyle = bg2; cx.beginPath(); cx.ellipse(cxp, by, R, R * .14, 0, 0, 6.283); cx.fill();
      if (move === 'scan') { cx.fillStyle = 'hsla(' + hh + ',100%,80%,.15)'; cx.fillRect(0, scanY - R * .03, W, R * .06); }
      cx.fillStyle = 'rgba(0,0,0,.2)';
      for (var s2 = (now / 40 | 0) % 4; s2 < H; s2 += 4) cx.fillRect(0, s2, W, 1);
    }, 30);
    text('xpTop', 'NEXUS · HOLOGRAM');
    layer.onclick = function () { startMove(null, performance.now()); };
  }

  // ------------------------------------------------------------------
  // 8. SONG AURA — visuals that match the mood of the song playing
  // ------------------------------------------------------------------
  function aura() {
    var mood = { name: 'waiting', colors: ['#3a1c71', '#d76d77', '#ffaf7b'], energy: .4 };
    var pulse = 0, songKey = '', blobs = [];
    for (var i = 0; i < 5; i++) blobs.push({ x: Math.random(), y: Math.random(), r: .35 + Math.random() * .3, a: Math.random() * 6, s: .5 + Math.random() });
    function hashColors(str) {
      var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
      return ['hsl(' + h + ',80%,45%)', 'hsl(' + ((h + 40) % 360) + ',85%,55%)', 'hsl(' + ((h + 200) % 360) + ',70%,50%)'];
    }
    function checkSong() {
      if (!A) return;
      var np = {}; try { np = JSON.parse(A.nowPlaying() || '{}'); } catch (e) {}
      if (np.access === false) { text('xpMid', 'PLAY A SONG IN SPOTIFY'); text('xpBottom', 'Spotify → Settings → turn ON "Device broadcast status", then play a song'); return; }
      if (!np.title || np.title === 'null') { text('xpMid', 'PLAY SOMETHING'); text('xpBottom', 'Start a song in Spotify and come back'); return; }
      var artist = np.artist && np.artist !== 'null' ? np.artist : '';
      var key = np.title + '|' + artist;
      if (key === songKey) return;
      songKey = key;
      text('xpBottom', N.esc(np.title + (artist ? ' · ' + artist : '')));
      mood = { name: 'reading the vibe…', colors: hashColors(key), energy: .5 };
      text('xpMid', 'READING THE VIBE…');
      N.askAI([{ role: 'user', parts: [{ text: 'Song: "' + np.title + '"' + (artist ? ' by ' + artist : '') }] }],
        'You pick visuals for a song playing in a truck. Return ONLY JSON: {"mood": one or two words, "colors": [3 hex colors that fit the song\'s mood], "energy": number 0 to 1, "line": one short hype sentence about the vibe, under 12 words}. Base it on what you know about the song or artist; if unknown, guess from the title.',
        { json: true, temperature: .8, maxTokens: 256 })
        .then(function (t) {
          var m = t.match(/\{[\s\S]*\}/), j = JSON.parse(m ? m[0] : t);
          if (key !== songKey) return;
          mood = { name: j.mood || 'vibes', colors: (j.colors && j.colors.length >= 3) ? j.colors.slice(0, 3) : mood.colors, energy: Math.max(0, Math.min(1, +j.energy || .5)) };
          text('xpMid', N.esc(String(mood.name).toUpperCase()));
          if (j.line) text('xpTop', 'SONG AURA · ' + N.esc(String(j.line).toUpperCase()));
        })
        .catch(function () { mood.name = 'vibes'; text('xpMid', 'VIBES'); });
    }
    var bt = beatTracker();
    checkSong(); every(checkSong, 4000);
    text('xpTop', 'SONG AURA');
    loop(function (now) {
      bt.tick(now); pulse = Math.max(bt.k, bt.e * .5);
      var sp = .00015 + mood.energy * .0006;
      cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H);
      cx.globalCompositeOperation = 'lighter';
      blobs.forEach(function (b, i) {
        var t = now * sp * b.s + b.a;
        var x = (b.x + .25 * Math.sin(t)) * W, y = (b.y + .25 * Math.cos(t * 1.3)) * H, r = b.r * Math.max(W, H) * (1 + pulse * .25);
        var g = cx.createRadialGradient(x, y, 0, x, y, r), col = mood.colors[i % 3];
        g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        cx.globalAlpha = .55 + pulse * .4;
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      });
      cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over';
      $('xpMid').style.transform = 'scale(' + (1 + pulse * .12) + ')';
    }, 30);
  }
})();
