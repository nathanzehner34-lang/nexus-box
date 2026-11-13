/* NEXUS experiences: Wake Up, Hologram, Sky & Aurora, Song Aura.
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
      $('xpMid').style.color = '#fff';
      ({ wake: wake, holo: holo, sky: sky, aura: aura })[name]();
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
  // 3. SKY & AURORA — the real sky over the truck + NOAA aurora forecast
  // ------------------------------------------------------------------
  // name, RA (hours), Dec (degrees), magnitude
  var STARS = [
    ['Sirius', 6.752, -16.72, -1.46], ['Canopus', 6.399, -52.70, -.74], ['Arcturus', 14.261, 19.18, -.05], ['Vega', 18.616, 38.78, .03],
    ['Capella', 5.278, 46.00, .08], ['Rigel', 5.242, -8.20, .13], ['Procyon', 7.655, 5.22, .34], ['Betelgeuse', 5.919, 7.41, .5],
    ['Altair', 19.846, 8.87, .76], ['Aldebaran', 4.599, 16.51, .86], ['Antares', 16.490, -26.43, .96], ['Spica', 13.420, -11.16, .97],
    ['Pollux', 7.755, 28.03, 1.14], ['Fomalhaut', 22.961, -29.62, 1.16], ['Deneb', 20.690, 45.28, 1.25], ['Regulus', 10.140, 11.97, 1.35],
    ['Castor', 7.577, 31.89, 1.58], ['Bellatrix', 5.419, 6.35, 1.64], ['Elnath', 5.438, 28.61, 1.65], ['Alnilam', 5.604, -1.20, 1.69],
    ['Alnitak', 5.679, -1.94, 1.77], ['Alioth', 12.900, 55.96, 1.77], ['Dubhe', 11.062, 61.75, 1.79], ['Mirfak', 3.405, 49.86, 1.79],
    ['Alkaid', 13.792, 49.31, 1.86], ['Menkalinan', 5.992, 44.95, 1.9], ['Alhena', 6.629, 16.40, 1.92], ['Polaris', 2.530, 89.26, 1.98],
    ['Alpheratz', 0.140, 29.09, 2.06], ['Hamal', 2.120, 23.46, 2.0], ['Mizar', 13.399, 54.93, 2.04], ['Saiph', 5.796, -9.67, 2.06],
    ['Kochab', 14.845, 74.16, 2.08], ['Rasalhague', 17.582, 12.56, 2.08], ['Algol', 3.136, 40.96, 2.1], ['Denebola', 11.818, 14.57, 2.13],
    ['Schedar', 0.675, 56.54, 2.24], ['Eltanin', 17.943, 51.49, 2.24], ['Sadr', 20.370, 40.26, 2.23], ['Mintaka', 5.533, -.30, 2.25],
    ['Caph', 0.153, 59.15, 2.28], ['Merak', 11.031, 56.38, 2.37], ['Markab', 23.079, 15.21, 2.48], ['Scheat', 23.063, 28.08, 2.42],
    ['Phecda', 11.897, 53.69, 2.44], ['Gamma Cas', 0.945, 60.72, 2.47], ['Ruchbah', 1.430, 60.24, 2.68], ['Algenib', 0.220, 15.18, 2.83],
    ['Albireo', 19.512, 27.96, 3.08], ['Megrez', 12.257, 57.03, 3.31], ['Segin', 1.906, 63.67, 3.37], ['Alcyone', 3.791, 24.11, 2.87],
    ['Alphecca', 15.578, 26.71, 2.22]
  ];
  var LINES = [
    ['Big Dipper', ['Dubhe', 'Merak', 'Phecda', 'Megrez', 'Alioth', 'Mizar', 'Alkaid'], ['Megrez', 'Dubhe']],
    ['Orion', ['Betelgeuse', 'Bellatrix', 'Mintaka', 'Alnilam', 'Alnitak', 'Saiph', 'Rigel', 'Mintaka'], ['Betelgeuse', 'Alnitak']],
    ['Cassiopeia', ['Caph', 'Schedar', 'Gamma Cas', 'Ruchbah', 'Segin']],
    ['Summer Triangle', ['Vega', 'Deneb', 'Altair', 'Vega']],
    ['Cygnus', ['Deneb', 'Sadr', 'Albireo']],
    ['Pegasus', ['Markab', 'Scheat', 'Alpheratz', 'Algenib', 'Markab']]
  ];
  var RAD = Math.PI / 180;
  function altAz(raH, decD, lat, lon, date) {
    var d = (date.getTime() / 86400000) + 2440587.5 - 2451545.0;
    var gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    var lst = (gmst + lon / 15 + 48) % 24;
    var H = (lst - raH) * 15 * RAD, dec = decD * RAD, la = lat * RAD;
    var alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
    var az = Math.atan2(-Math.sin(H) * Math.cos(dec), Math.cos(la) * Math.sin(dec) - Math.sin(la) * Math.cos(dec) * Math.cos(H));
    return { alt: alt / RAD, az: (az / RAD + 360) % 360 };
  }
  function sunRaDec(date) {
    var n = (date.getTime() / 86400000) + 2440587.5 - 2451545.0;
    var L = (280.46 + .9856474 * n) % 360, g = ((357.528 + .9856003 * n) % 360) * RAD;
    var lam = (L + 1.915 * Math.sin(g) + .02 * Math.sin(2 * g)) * RAD, eps = (23.439 - .0000004 * n) * RAD;
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / RAD;
    return { ra: ((ra + 360) % 360) / 15, dec: Math.asin(Math.sin(eps) * Math.sin(lam)) / RAD };
  }
  function compass(az) { return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(az / 45) % 8]; }

  function sky() {
    text('xpTop', 'LOCATING YOUR POSITION…');
    var state = { lat: null, lon: null, kp: null, aurora: 0, day: false };
    N.getCoords().then(function (g) {
      if (!g) { text('xpMid', 'NO LOCATION'); text('xpBottom', 'Turn on location, or set a backup city in Settings.'); N.say('I need your location to map the sky. Set a backup city in Settings.'); return; }
      state.lat = +g.lat; state.lon = +g.lon;
      text('xpTop', 'SKY ABOVE ' + N.esc((g.name || '').toUpperCase()) + ' · ' + state.lat.toFixed(2) + '°, ' + state.lon.toFixed(2) + '°');
      var now = new Date(), sun = sunRaDec(now), sp = altAz(sun.ra, sun.dec, state.lat, state.lon, now);
      state.day = sp.alt > -6;
      // brightest visible stars for the voice
      var vis = STARS.map(function (s) { var p = altAz(s[1], s[2], state.lat, state.lon, now); return { n: s[0], m: s[3], alt: p.alt, az: p.az }; })
        .filter(function (s) { return s.alt > 10; }).sort(function (a, b) { return a.m - b.m; });
      return N.http('GET', 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json').then(function (r) {
        var kp = null;
        try {
          var rows = JSON.parse(r.text), nowT = Date.now(), best = 0;
          rows.forEach(function (row) {
            var t = Date.parse((row.time_tag || row[0] || '').replace(' ', 'T') + 'Z'), v = parseFloat(row.kp !== undefined ? row.kp : row[1]);
            if (!isNaN(t) && !isNaN(v) && t > nowT - 3 * 3600000 && t < nowT + 24 * 3600000) best = Math.max(best, v);
          });
          kp = best || null;
        } catch (e) {}
        state.kp = kp;
        var alat = Math.abs(state.lat), need = alat >= 65 ? 1 : alat >= 60 ? 2 : alat >= 55 ? 4 : alat >= 50 ? 5 : 7;
        var chance = kp === null ? 'unknown' : kp >= need + 2 ? 'HIGH' : kp >= need ? 'GOOD' : kp >= need - 1 ? 'LOW' : 'VERY LOW';
        state.aurora = chance === 'HIGH' ? 1 : chance === 'GOOD' ? .7 : chance === 'LOW' ? .3 : 0;
        var w = N.weather(), cloudy = w && /overcast|rain|snow|fog|drizzle|showers|thunder/i.test(w.desc);
        text('xpBottom', 'AURORA CHANCE (NEXT 24H): <b style="color:#3dff9a">' + chance + '</b>' + (kp !== null ? ' · KP ' + kp.toFixed(1) : '') +
          (cloudy ? ' · CLOUDS MAY BLOCK THE VIEW' : '') + (state.day ? ' · DAYTIME: STARS SHOWN ARE HIDDEN BY SUNLIGHT' : ''));
        var lines = ['Here is the sky above you right now.'];
        if (vis[0]) lines.push('The brightest star up there is ' + vis[0].n + ', in the ' + compass(vis[0].az) + '.');
        if (vis[1]) lines.push('You can also find ' + vis[1].n + ' to the ' + compass(vis[1].az) + '.');
        lines.push(chance === 'unknown' ? 'I couldn\'t reach the aurora forecast.' :
          'Aurora chance tonight is ' + chance.toLowerCase() + '.' + (chance === 'HIGH' || chance === 'GOOD' ? (state.day ? ' Watch the sky after dark.' : ' Look up.') : ''));
        if (cloudy) lines.push('Clouds may get in the way though.');
        N.say(lines.join(' '));
      });
    });

    var tw = STARS.map(function () { return Math.random() * 6; });
    loop(function (now) {
      cx.fillStyle = state.day ? '#06142c' : '#01020a'; cx.fillRect(0, 0, W, H);
      if (state.lat === null) return;
      var cxp = W / 2, cyp = H / 2, R = Math.min(W, H) * .47, date = new Date();
      // aurora curtains toward the pole
      if (state.aurora > 0) {
        for (var b = 0; b < 3; b++) {
          cx.beginPath();
          for (var k = 0; k <= 40; k++) {
            var u = k / 40, ang = (-60 + u * 120) * RAD, rr = R * (.55 + .12 * Math.sin(u * 7 + now * .0007 + b));
            var x = cxp + Math.sin(ang) * rr, y = cyp - Math.cos(ang) * rr * (state.lat >= 0 ? 1 : -1);
            if (k) cx.lineTo(x, y); else cx.moveTo(x, y);
          }
          cx.strokeStyle = 'rgba(' + (b === 2 ? '170,80,255' : '60,255,160') + ',' + (state.aurora * (.18 + .1 * Math.sin(now * .001 + b))) + ')';
          cx.lineWidth = R * (.08 + b * .03); cx.stroke();
        }
      }
      // horizon ring and compass
      cx.strokeStyle = 'rgba(120,170,255,.35)'; cx.lineWidth = 1;
      cx.beginPath(); cx.arc(cxp, cyp, R, 0, 6.283); cx.stroke();
      cx.beginPath(); cx.arc(cxp, cyp, R * 2 / 3, 0, 6.283); cx.stroke();
      cx.fillStyle = 'rgba(160,200,255,.8)'; cx.font = Math.max(8, R * .07) + 'px sans-serif'; cx.textAlign = 'center';
      cx.fillText('N', cxp, cyp - R - 3); cx.fillText('S', cxp, cyp + R + R * .08); cx.fillText('E', cxp - R - R * .06, cyp + 3); cx.fillText('W', cxp + R + R * .06, cyp + 3);
      function proj(alt, az) { var r = (90 - alt) / 90 * R; return [cxp - r * Math.sin(az * RAD), cyp - r * Math.cos(az * RAD)]; }
      var pos = {};
      STARS.forEach(function (s, i) {
        var p = altAz(s[1], s[2], state.lat, state.lon, date);
        if (p.alt < 0) return;
        var xy = proj(p.alt, p.az); pos[s[0]] = xy;
        var size = Math.max(1, (3.2 - s[3]) * R * .012), a = .6 + .4 * Math.sin(now * .003 + tw[i]);
        cx.fillStyle = 'rgba(255,255,255,' + a + ')';
        cx.beginPath(); cx.arc(xy[0], xy[1], size, 0, 6.283); cx.fill();
        if (s[3] < 1.3) { cx.fillStyle = 'rgba(160,210,255,.75)'; cx.font = Math.max(7, R * .05) + 'px sans-serif'; cx.fillText(s[0], xy[0], xy[1] - size - 3); }
      });
      cx.strokeStyle = 'rgba(61,255,154,.35)'; cx.lineWidth = 1;
      LINES.forEach(function (c) {
        c.slice(1).forEach(function (chain) {
          cx.beginPath(); var started = false;
          chain.forEach(function (nm) { var p = pos[nm]; if (!p) { started = false; return; } if (started) cx.lineTo(p[0], p[1]); else { cx.moveTo(p[0], p[1]); started = true; } });
          cx.stroke();
        });
      });
      // sun
      var sun = sunRaDec(date), sp = altAz(sun.ra, sun.dec, state.lat, state.lon, date);
      if (sp.alt > 0) { var s2 = proj(sp.alt, sp.az); cx.fillStyle = '#ffd34d'; cx.beginPath(); cx.arc(s2[0], s2[1], R * .05, 0, 6.283); cx.fill(); }
    }, 15);
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
