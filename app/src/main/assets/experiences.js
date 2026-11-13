/* NEXUS experiences: Wake Up, Hologram, Synthwave, Cosmic Zoom, Song Aura.
   Loaded only the first time one is opened. Each one only draws while it is on screen. */
(function () {
  'use strict';
  var N = window.NX, A = N.A, $ = N.$;
  var layer = $('xp'), cv = $('xpc'), cx = cv.getContext('2d', { alpha: false });
  var W = 0, H = 0, S = 0.5; // draw at half resolution for speed
  var running = null, raf = 0, timers = [], last = 0;

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
      last = now; draw(now);
    }
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
      ({ wake: wake, holo: holo, synth: synth, zoom: zoom, aura: aura })[name]();
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
    var pulse = 0, stars = [];
    for (var i = 0; i < 70; i++) stars.push([Math.random(), Math.random() * .5, Math.random() * 1.5 + .3, Math.random() * 6]);
    XP.onMeter = function (rms) { pulse = Math.max(pulse, Math.min(1, rms * 6)); };
    try { if (A) A.meter(true); } catch (e) {}
    text('xpTop', 'NEXUS · NIGHT DRIVE FM');
    text('xpBottom', '');
    $('xpMid').style.color = '#ff6ad5';
    text('xpMid', '');
    var hz = .55;
    loop(function (now) {
      pulse *= .9;
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
      var sr = H * (.24 + pulse * .02), sx = W / 2, sy = H0 - H * .02;
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
      var speed = .0006 + pulse * .0012, off = (now * speed) % 1;
      for (var r = 0; r < 14; r++) {
        var z = (r + 1 - off) / 14, y = H0 + (H - H0) * Math.pow(z, 2.2);
        cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke();
      }
      for (var c = -12; c <= 12; c++) {
        cx.beginPath(); cx.moveTo(W / 2 + c * W * .015, H0); cx.lineTo(W / 2 + c * W * .16, H); cx.stroke();
      }
      // horizon glow line
      cx.fillStyle = 'rgba(255,106,213,' + (.6 + pulse * .4) + ')'; cx.fillRect(0, H0 - 1, W, 2);
      $('xpMid').style.transform = 'scale(' + (1 + pulse * .08) + ')';
    }, 30);
    N.say('Night drive mode. Turn up the music.');
  }

  // ------------------------------------------------------------------
  // COSMIC ZOOM — from deep space down to the truck's GPS position
  // ------------------------------------------------------------------
  function zoom() {
    var t0 = performance.now(), loc = null, stage = 0, stars = [];
    for (var i = 0; i < 260; i++) stars.push([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()]);
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
        if (l[2]) N.say(l[2]);
        if (stage === 5) {
          var nm = loc && loc.name ? loc.name : 'your location';
          text('xpMid', 'YOU ARE HERE');
          text('xpBottom', N.esc(nm.toUpperCase()) + (loc ? ' · ' + (+loc.lat).toFixed(3) + '°, ' + (+loc.lon).toFixed(3) + '°' : ''));
          N.say('Target acquired. You are here' + (loc && loc.name ? ', in ' + loc.name : '') + '.');
          later(function () { if (running === 'zoom') XP.close(true); }, 7000);
        }
      }, l[0]);
    });
    $('xpMid').style.color = '#3dff9a'; $('xpMid').style.top = '8%';
    loop(function (now) {
      var t = now - t0;
      cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H);
      var cxp = W / 2, cyp = H / 2, R = Math.min(W, H);
      // warp stars, faster over time
      var warp = t < 15000 ? .0004 + t / 15000 * .002 : .0003;
      for (var i = 0; i < stars.length; i++) {
        var s2 = stars[i]; s2[2] -= warp * 16; if (s2[2] <= .02) { s2[0] = Math.random() * 2 - 1; s2[1] = Math.random() * 2 - 1; s2[2] = 1; }
        var k = 1 / s2[2], x = cxp + s2[0] * k * R * .25, y = cyp + s2[1] * k * R * .25;
        if (x < 0 || x > W || y < 0 || y > H) continue;
        var len = Math.min(25, warp * 4000 * k);
        cx.strokeStyle = 'rgba(200,220,255,' + Math.min(1, (1 - s2[2]) * 1.2) + ')';
        cx.lineWidth = Math.max(1, k * .4 * S * 2);
        cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + s2[0] * len, y + s2[1] * len); cx.stroke();
      }
      // galaxy
      if (t > 4000 && t < 11500) {
        var gp = (t - 4000) / 7500, gs = R * (.2 + gp * 1.6), ga = Math.min(1, gp * 3) * (gp > .8 ? (1 - gp) * 5 : 1);
        cx.save(); cx.translate(cxp, cyp); cx.rotate(t * .0002); cx.globalAlpha = ga;
        for (var arm = 0; arm < 2; arm++) for (var j = 0; j < 140; j++) {
          var f = j / 140, ang = arm * Math.PI + f * 9, rr = f * gs * .5;
          cx.fillStyle = 'hsla(' + (220 + f * 80) + ',80%,' + (80 - f * 30) + '%,.8)';
          cx.fillRect(Math.cos(ang) * rr, Math.sin(ang) * rr * .55, 2 * S * 2, 2 * S * 2);
        }
        var core = cx.createRadialGradient(0, 0, 0, 0, 0, gs * .12); core.addColorStop(0, 'rgba(255,240,200,1)'); core.addColorStop(1, 'rgba(255,200,120,0)');
        cx.fillStyle = core; cx.fillRect(-gs * .12, -gs * .12, gs * .24, gs * .24);
        cx.restore(); cx.globalAlpha = 1;
      }
      // solar system
      if (t > 10500 && t < 16500) {
        var sp = (t - 10500) / 6000, sa = Math.min(1, sp * 3) * (sp > .85 ? (1 - sp) * 6.6 : 1);
        cx.globalAlpha = sa;
        var sun = cx.createRadialGradient(cxp, cyp, 0, cxp, cyp, R * .08); sun.addColorStop(0, '#fff6c0'); sun.addColorStop(1, 'rgba(255,170,0,0)');
        cx.fillStyle = sun; cx.fillRect(cxp - R * .08, cyp - R * .08, R * .16, R * .16);
        var orbits = [.08, .12, .17, .23, .33, .41], cols = ['#b0b0b0', '#e8c27a', '#4fa3ff', '#d9643a', '#d8b48a', '#e6d39b'];
        for (var o = 0; o < orbits.length; o++) {
          var orr = orbits[o] * R * (1 + sp * 1.2);
          cx.strokeStyle = 'rgba(120,150,255,.25)'; cx.beginPath(); cx.ellipse(cxp, cyp, orr, orr * .45, 0, 0, 6.283); cx.stroke();
          var pa = t * .0004 / (o + 1) + o;
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
        var atm = cx.createRadialGradient(cxp, cyp, er * .95, cxp, cyp, er * 1.15); atm.addColorStop(0, 'rgba(120,190,255,.5)'); atm.addColorStop(1, 'rgba(120,190,255,0)');
        cx.fillStyle = atm; cx.beginPath(); cx.arc(cxp, cyp, er * 1.15, 0, 6.283); cx.fill();
      }
      // targeting reticle
      if (t > 20000) {
        var rp = Math.min(1, (t - 20000) / 3500), rs = R * (.45 - rp * .33), spin = t * .003;
        cx.strokeStyle = 'rgba(61,255,154,.9)'; cx.lineWidth = Math.max(1, 2 * S * 2);
        cx.beginPath(); cx.arc(cxp, cyp, rs, spin, spin + 1.2); cx.stroke();
        cx.beginPath(); cx.arc(cxp, cyp, rs, spin + 3.14, spin + 4.34); cx.stroke();
        cx.beginPath(); cx.moveTo(cxp - rs * 1.3, cyp); cx.lineTo(cxp - rs * .6, cyp); cx.moveTo(cxp + rs * .6, cyp); cx.lineTo(cxp + rs * 1.3, cyp);
        cx.moveTo(cxp, cyp - rs * 1.3); cx.lineTo(cxp, cyp - rs * .6); cx.moveTo(cxp, cyp + rs * .6); cx.lineTo(cxp, cyp + rs * 1.3); cx.stroke();
        if (t > 23500) {
          var p2 = .5 + .5 * Math.sin(t * .01);
          cx.fillStyle = 'rgba(61,255,154,' + p2 + ')'; cx.beginPath(); cx.arc(cxp, cyp, R * .012 + p2 * R * .006, 0, 6.283); cx.fill();
        }
      }
    }, 30);
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
      if (np.access === false) { text('xpMid', 'ALLOW SONG ACCESS'); text('xpBottom', 'Nexus Settings → "Allow Nexus to see what\'s playing"'); return; }
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
          if (j.line) N.say(j.line);
        })
        .catch(function () { mood.name = 'vibes'; text('xpMid', 'VIBES'); });
    }
    XP.onMeter = function (rms) { pulse = Math.max(pulse, Math.min(1, rms * 6)); };
    try { if (A) A.meter(true); } catch (e) {}
    checkSong(); every(checkSong, 4000);
    text('xpTop', 'SONG AURA');
    loop(function (now) {
      pulse *= .88;
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
