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
  var running = null, raf = 0, timers = [], last = 0, xpDom = [];
  var perf = { n: 0, slow: 0, since: 0 };
  function saveQ() { try { if (A) A.setPref('xpq', String(S)); else localStorage.setItem('p_xpq', String(S)); } catch (e) {} }
  function tuneQuality(now, gap, took) {
    if (!perf.since) { perf.since = now; perf.prev = now; }
    var late = perf.prev && now - perf.prev > gap * 1.6;
    perf.prev = now;
    perf.n++; if (took > gap * .7 || late) perf.slow++;
    if (now - perf.since < 3000) return;
    var slowShare = perf.slow / perf.n;
    var old = S;
    if (slowShare > .3 && S > QMIN) S = Math.max(QMIN, Math.round((S - .1) * 10) / 10);
    else if (slowShare < .05 && S < QMAX) S = Math.min(QMAX, Math.round((S + .1) * 10) / 10);
    perf = { n: 0, slow: 0, since: now };
    if (S !== old) { size(); saveQ(); }
  }

  function size() {
    W = cv.width = Math.max(1, Math.floor(layer.clientWidth * S)); H = cv.height = Math.max(1, Math.floor(layer.clientHeight * S));
    if (glc) { glc.width = Math.max(1, Math.floor(layer.clientWidth * S * GLX)); glc.height = Math.max(1, Math.floor(layer.clientHeight * S * GLX)); }
  }

  // ---- Graphics-chip (WebGL) visuals: the sharpest, smoothest look for the least effort ----
  var glc = null, gl = null, GLX = 1.25, glBuf = null, glProgs = {};
  var GL_HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'uniform vec2 res; uniform float time, hue, kick, energy;\n' +
    'vec3 pal(float t){ return .5 + .5 * cos(6.28318 * (t + vec3(0., .33, .67))); }\n' +
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);' +
    ' return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }\n';
  function glStart(name, frag) {
    if (!glc) {
      glc = document.createElement('canvas');
      glc.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none';
      cv.parentNode.insertBefore(glc, cv.nextSibling);
      try { gl = glc.getContext('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' }) || glc.getContext('experimental-webgl'); } catch (e) { gl = null; }
      if (gl) {
        glBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      }
    }
    if (!gl) return null;
    var prog = glProgs[name];
    if (!prog) {
      function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.log(gl.getShaderInfoLog(o)); return null; } return o; }
      var vs = sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'), fs = sh(gl.FRAGMENT_SHADER, GL_HEAD + frag);
      if (!vs || !fs) return null;
      prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      prog.loc = {}; glProgs[name] = prog;
    }
    gl.useProgram(prog);
    var pl = gl.getAttribLocation(prog, 'p'); gl.bindBuffer(gl.ARRAY_BUFFER, glBuf); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
    glc.style.display = 'block'; cv.style.visibility = 'hidden';
    size();
    function U(n) { if (!(n in prog.loc)) prog.loc[n] = gl.getUniformLocation(prog, n); return prog.loc[n]; }
    return {
      f: function (n, v) { gl.uniform1f(U(n), v); },
      v2: function (n, a, b2) { gl.uniform2f(U(n), a, b2); },
      v4a: function (n, arr) { gl.uniform4fv(U(n), arr); },
      v3a: function (n, arr) { gl.uniform3fv(U(n), arr); },
      draw: function (now, b, hueDeg) {
        gl.viewport(0, 0, glc.width, glc.height);
        gl.uniform2f(U('res'), glc.width, glc.height);
        gl.uniform1f(U('time'), now / 1000);
        gl.uniform1f(U('hue'), (hueDeg || 0) / 360);
        gl.uniform1f(U('kick'), b ? b.k : 0); gl.uniform1f(U('energy'), b ? b.e : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
  }
  function glStop() { if (glc) glc.style.display = 'none'; cv.style.visibility = ''; }
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
      ({ holo: holo, synth: synth, zoom: zoom, aura: aura, outrun: outrun, bluefire: bluefire, vapor: vapor, kaleido: kaleido, ring: ring, shatter: shatter, hyper: hyper, water: water, friend: friend, fractal: fractal, wormhole: wormhole, mirror: mirror, eye: eye, planet: planet, skull: skull, webcams: webcams, worlds: worlds, gold: gold, auroratunnel: auroratunnel, ink: ink, crystal: crystal, blackhole: blackhole, lava: lava, neural: neural, datastorm: datastorm, portrait: portrait })[name]();
    },
    close: function (quiet) {
      running = null;
      glStop();
      xpDom.forEach(function (d) { if (d.parentNode) d.parentNode.removeChild(d); }); xpDom = [];
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
  $('xpClose').addEventListener('click', function (e) { e.stopPropagation(); XP.close(); if (window.onXpUserClose) window.onXpUserClose(); });
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
  function bluefire2d() {
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
      vapor.sp = (vapor.sp || 0) + ((b.k * .02 + b.e * .01) - (vapor.sp || 0)) * .05;
      var sr = H * (.22 + vapor.sp + Math.sin(now * .0008) * .006), sx = W * .5, sy = H0 * .95;
      var sg = cx.createLinearGradient(0, sy - sr, 0, sy); sg.addColorStop(0, '#fffb96'); sg.addColorStop(1, '#ff71ce');
      cx.save(); cx.beginPath(); cx.arc(sx, sy, sr, Math.PI, 0); cx.clip(); cx.fillStyle = sg; cx.fillRect(sx - sr, sy - sr, sr * 2, sr);
      cx.fillStyle = '#ffb3e6'; for (var k = 0; k < 5; k++) cx.fillRect(sx - sr, sy - sr * .5 + k * sr * .1, sr * 2, 1 + k * 2); cx.restore();
      cx.fillStyle = '#01cdfe'; cx.fillRect(0, H0, W, H - H0);
      cx.fillStyle = '#05ffa1'; cx.globalAlpha = .15; cx.fillRect(0, H0, W, H - H0); cx.globalAlpha = 1;
      cx.strokeStyle = 'rgba(255,113,206,' + (.6 + p * .4) + ')'; cx.lineWidth = Math.max(1, 1.5 * S * 2);
      vapor.off = ((vapor.off || 0) + .011 + b.e * .006) % 1; var off = vapor.off;
      for (var r = 0; r < 12; r++) { var z = (r + 1 - off) / 12, y = H0 + (H - H0) * z * z; cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke(); }
      for (var c2 = -10; c2 <= 10; c2++) { cx.beginPath(); cx.moveTo(W / 2 + c2 * W * .02, H0); cx.lineTo(W / 2 + c2 * W * .14, H); cx.stroke(); }
      $('xpMid').style.transform = 'translateY(' + (Math.sin(now * .001) * 6 - 40) + 'px) scale(' + (1 + vapor.sp * 1.5) + ')';
    }, 30);
  }

  // 7. KALEIDOSCOPE
  function kaleido2d() {
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

  // Colour that changes with the music: every beat moves to a new colour and glides there smoothly.
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

  // 10. SHATTER — a living scene behind glass. Every bass hit cracks the glass more until it
  //     EXPLODES toward you (3D shards, sparks, shockwave) and reveals the next scene.
  function shatter() {
    var b = beatTracker(), hue = beatHue(200, 60), scene = 0, cracks = [], hits = 0, impact = null, shards = null, sparks = [], smashT = 0, cycleStart = performance.now();
    var snap = document.createElement('canvas'), sx = snap.getContext('2d');
    var stars = []; for (var i = 0; i < 160; i++) stars.push([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()]);
    var gal = []; for (var gi = 0; gi < 700; gi++) { var arm = gi % 4, t = Math.pow(Math.random(), .7); gal.push([arm * Math.PI / 2 + t * 5 + (Math.random() - .5) * .5 * (1 - t * .5), t, .2 + Math.random() * .6, Math.random() * 40]); }
    var SCENES = [
      function tunnel(now, hh, p) {           // neon rings rushing toward you
        cx.fillStyle = '#02000a'; cx.fillRect(0, 0, W, H);
        cx.globalCompositeOperation = 'lighter';
        for (var k = 0; k < 18; k++) {
          var z = ((k / 18) + now * .00025 * (1 + b.e * 2)) % 1, sc = Math.pow(z, 2.2) * Math.max(W, H) * 1.1;
          cx.strokeStyle = 'hsla(' + ((hh + k * 12) % 360) + ',100%,60%,' + (z * .9) + ')'; cx.lineWidth = Math.max(1, z * 6 * S * 2);
          cx.save(); cx.translate(W / 2, H / 2); cx.rotate(z * 1.5 + now * .0003); cx.strokeRect(-sc / 2, -sc / 2 * .62, sc, sc * .62); cx.restore();
        }
        cx.globalCompositeOperation = 'source-over';
      },
      function nebula(now, hh, p) {           // swirling 4-arm galaxy with a bright core
        cx.fillStyle = 'rgba(1,0,8,.4)'; cx.fillRect(0, 0, W, H);
        cx.globalCompositeOperation = 'lighter';
        var rot = now * .00025, M = Math.min(W, H) * .6;
        for (var j = 0; j < gal.length; j++) {
          var g2 = gal[j], ang = g2[0] + rot * (1.4 - g2[1]), rr = g2[1] * M;
          cx.fillStyle = 'hsla(' + ((hh + g2[1] * 140 + g2[3]) % 360) + ',100%,' + (55 + p * 20) + '%,' + g2[2] + ')';
          var sz = (1.2 - g2[1]) * 3.5 * S * 2 + 1; cx.fillRect(W / 2 + Math.cos(ang) * rr * 1.5 - sz / 2, H / 2 + Math.sin(ang) * rr * .75 - sz / 2, sz, sz);
        }
        var c = cx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, H * .3); c.addColorStop(0, 'hsla(' + hh + ',100%,85%,' + (.55 + p * .4) + ')'); c.addColorStop(1, 'rgba(0,0,0,0)');
        cx.fillStyle = c; cx.fillRect(0, 0, W, H);
        cx.globalCompositeOperation = 'source-over';
      },
      function lasers(now, hh, p) {           // sweeping laser fans like a club
        cx.fillStyle = 'rgba(0,0,6,.4)'; cx.fillRect(0, 0, W, H);
        cx.globalCompositeOperation = 'lighter';
        for (var s2 = 0; s2 < 3; s2++) {
          var ox = W * (.2 + s2 * .3), base = Math.sin(now * .0011 * (s2 + 1) + s2) * .7;
          for (var l = 0; l < 9; l++) {
            var ang = -Math.PI / 2 + base + (l - 4) * .13;
            cx.strokeStyle = 'hsla(' + ((hh + s2 * 70) % 360) + ',100%,60%,' + (.35 + p * .5) + ')'; cx.lineWidth = Math.max(1, S * 3);
            cx.beginPath(); cx.moveTo(ox, H); cx.lineTo(ox + Math.cos(ang) * H * 2, H + Math.sin(ang) * H * 2); cx.stroke();
          }
        }
        cx.globalCompositeOperation = 'source-over';
      },
      function warp(now, hh, p) {             // stars streaking past
        cx.fillStyle = 'rgba(0,0,8,.45)'; cx.fillRect(0, 0, W, H);
        cx.globalCompositeOperation = 'lighter';
        stars.forEach(function (st) {
          st[2] -= .008 + b.e * .02 + b.k * .02; if (st[2] <= .02) { st[0] = Math.random() * 2 - 1; st[1] = Math.random() * 2 - 1; st[2] = 1; }
          var x = W / 2 + st[0] / st[2] * W * .3, y = H / 2 + st[1] / st[2] * H * .3, x2 = W / 2 + st[0] / (st[2] + .05) * W * .3, y2 = H / 2 + st[1] / (st[2] + .05) * H * .3;
          cx.strokeStyle = 'hsla(' + ((hh + st[0] * 60 + 360) % 360) + ',100%,70%,' + (1 - st[2]) + ')'; cx.lineWidth = Math.max(1, (1 - st[2]) * 4 * S * 2);
          cx.beginPath(); cx.moveTo(x2, y2); cx.lineTo(x, y); cx.stroke();
        });
        cx.globalCompositeOperation = 'source-over';
      },
      function grid(now, hh, p) {             // neon grid racing under a glowing sun
        var H0 = H * .55; var g = cx.createLinearGradient(0, 0, 0, H0); g.addColorStop(0, '#05001a'); g.addColorStop(1, 'hsl(' + hh + ',80%,30%)');
        cx.fillStyle = g; cx.fillRect(0, 0, W, H0); cx.fillStyle = '#020008'; cx.fillRect(0, H0, W, H - H0);
        var sr = H * .22 * (1 + b.k * .08); var sg = cx.createLinearGradient(0, H0 - sr, 0, H0); sg.addColorStop(0, 'hsl(' + ((hh + 50) % 360) + ',100%,70%)'); sg.addColorStop(1, 'hsl(' + hh + ',100%,55%)');
        cx.fillStyle = sg; cx.beginPath(); cx.arc(W / 2, H0, sr, Math.PI, 0); cx.fill();
        cx.strokeStyle = 'hsla(' + hh + ',100%,65%,.9)'; cx.lineWidth = Math.max(1, S * 2.5);
        var off = (now * .0006 * (1 + b.e * 2)) % 1;
        for (var r = 0; r < 14; r++) { var zz = (r + 1 - off) / 14, y = H0 + (H - H0) * zz * zz; cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke(); }
        for (var c2 = -12; c2 <= 12; c2++) { cx.beginPath(); cx.moveTo(W / 2 + c2 * W * .015, H0); cx.lineTo(W / 2 + c2 * W * .12, H); cx.stroke(); }
      }
    ];
    function newCycle(now) { impact = [W * (.3 + Math.random() * .4), H * (.3 + Math.random() * .4)]; cracks = []; hits = 0; cycleStart = now; }
    function addCracks(n) {
      for (var i = 0; i < n; i++) {
        if (cracks.length < 6 || Math.random() < .4) { var a = Math.random() * 6.283; cracks.push({ pts: [[impact[0], impact[1]]], a: a }); }
        var c = cracks[Math.random() * cracks.length | 0];
        for (var st = 0; st < 3; st++) { var l = c.pts[c.pts.length - 1]; c.a += (Math.random() - .5) * .7; var len = Math.min(W, H) * (.04 + Math.random() * .07); c.pts.push([l[0] + Math.cos(c.a) * len, l[1] + Math.sin(c.a) * len]); }
        if (Math.random() < .3) { var bp = c.pts[Math.random() * c.pts.length | 0]; cracks.push({ pts: [[bp[0], bp[1]]], a: c.a + (Math.random() < .5 ? 1 : -1) * (.6 + Math.random() * .6) }); }
      }
    }
    function edge(px, py, a) {
      var dx = Math.cos(a), dy = Math.sin(a), t = 1e9;
      if (dx > 1e-6) t = Math.min(t, (W - px) / dx); if (dx < -1e-6) t = Math.min(t, -px / dx);
      if (dy > 1e-6) t = Math.min(t, (H - py) / dy); if (dy < -1e-6) t = Math.min(t, -py / dy);
      return [px + dx * t, py + dy * t];
    }
    function smash(now, hh) {
      snap.width = W; snap.height = H; sx.drawImage(cv, 0, 0);
      var px = impact[0], py = impact[1], n = 18, angs = [], fr = [];
      for (var i = 0; i < n; i++) { angs.push((i + Math.random() * .6) / n * 6.2832); fr.push(.2 + Math.random() * .3); }
      var corners = [[0, 0], [W, 0], [W, H], [0, H]].map(function (c) { var a = Math.atan2(c[1] - py, c[0] - px); return [c[0], c[1], a < 0 ? a + 6.2832 : a]; });
      shards = [];
      for (var k = 0; k < n; k++) {
        var a0 = angs[k], a1 = k + 1 < n ? angs[k + 1] : angs[0] + 6.2832, e0 = edge(px, py, a0), e1 = edge(px, py, a1), k1 = (k + 1) % n;
        var m0 = [px + (e0[0] - px) * fr[k], py + (e0[1] - py) * fr[k]], m1 = [px + (e1[0] - px) * fr[k1], py + (e1[1] - py) * fr[k1]];
        var mid0 = [px + (e0[0] - px) * (fr[k] + .35), py + (e0[1] - py) * (fr[k] + .35)], mid1 = [px + (e1[0] - px) * (fr[k1] + .35), py + (e1[1] - py) * (fr[k1] + .35)];
        var cs = corners.filter(function (c) { var ca = c[2]; if (ca < a0) ca += 6.2832; return ca > a0 && ca < a1; }).sort(function (u, v) { var ua = u[2] < a0 ? u[2] + 6.2832 : u[2], va = v[2] < a0 ? v[2] + 6.2832 : v[2]; return ua - va; });
        [[[px, py], m0, m1], [m0, mid0, mid1, m1], [mid0, e0].concat(cs.map(function (c) { return [c[0], c[1]]; })).concat([e1, mid1])].forEach(function (poly, ring) {
          var cxm = 0, cym = 0; poly.forEach(function (q) { cxm += q[0]; cym += q[1]; }); cxm /= poly.length; cym /= poly.length;
          var dx = cxm - px, dy = cym - py, d = Math.sqrt(dx * dx + dy * dy) || 1;
          shards.push({ poly: poly, cx: cxm, cy: cym, dx: dx / d, dy: dy / d, sp: (1.5 - ring * .35) * (.7 + Math.random() * .6), r: 0, vr: (Math.random() - .5) * .25, flip: Math.random() * 6, vf: (Math.random() - .5) * .3 });
        });
      }
      sparks = [];
      for (var s2 = 0; s2 < 260; s2++) { var an = Math.random() * 6.283, v = (.5 + Math.random() * 2.5) * Math.min(W, H) * .02; sparks.push({ x: px, y: py, vx: Math.cos(an) * v, vy: Math.sin(an) * v, life: 1, h: (hh + Math.random() * 80) % 360 }); }
      smashT = now; scene = (scene + 1) % SCENES.length;
    }
    newCycle(performance.now());
    text('xpTop', 'SHATTER');
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit);
      var since = now - smashT, shake = shards && since < 400 ? (1 - since / 400) * Math.min(W, H) * .03 : 0;
      cx.save(); if (shake) cx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
      SCENES[scene](now, hh, p);
      cx.restore();
      if (!shards) {
        if (b.hit && b.k > .2) { hits++; addCracks(1 + (b.k > .6 ? 1 : 0)); }
        if (!b.hit && now - cycleStart > 1500 && Math.random() < .01) addCracks(1);
        if (hits >= 10 || now - cycleStart > 14000) smash(now, hh);
        // draw the cracks on the glass
        cx.globalCompositeOperation = 'lighter';
        [[S * 7, .12], [S * 3, .35], [S * 1.2, 1]].forEach(function (pass, i) {
          cx.strokeStyle = i === 2 ? 'rgba(255,255,255,.95)' : 'hsla(' + ((hh + 180) % 360) + ',100%,70%,' + pass[1] + ')'; cx.lineWidth = Math.max(1, pass[0]);
          cx.beginPath(); cracks.forEach(function (c) { c.pts.forEach(function (q, j) { if (j) cx.lineTo(q[0], q[1]); else cx.moveTo(q[0], q[1]); }); }); cx.stroke();
        });
        if (cracks.length) { var ig = cx.createRadialGradient(impact[0], impact[1], 0, impact[0], impact[1], Math.min(W, H) * .1 * (1 + hits * .1)); ig.addColorStop(0, 'rgba(255,255,255,' + Math.min(.6, hits * .06) + ')'); ig.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = ig; cx.fillRect(0, 0, W, H); }
        cx.globalCompositeOperation = 'source-over';
      } else {
        var t = since / 1000, slow = t < .15 ? .25 : 1;
        // shockwave
        cx.globalCompositeOperation = 'lighter';
        var wr = t * Math.max(W, H) * 1.2;
        cx.strokeStyle = 'hsla(' + hh + ',100%,75%,' + Math.max(0, .8 - t) + ')'; cx.lineWidth = Math.max(2, (1 - t) * Math.min(W, H) * .03);
        cx.beginPath(); cx.arc(impact[0], impact[1], wr, 0, 6.283); cx.stroke();
        cx.globalCompositeOperation = 'source-over';
        var life = Math.min(1, t / 1.4);
        shards.forEach(function (sh) {
          var dist = (Math.pow(t, 1.4) * sh.sp * Math.min(W, H) * 1.1) * slow, sc = 1 + Math.pow(t, 1.6) * 2.4 * sh.sp;
          sh.r += sh.vr * slow; sh.flip += sh.vf * slow;
          cx.save(); cx.globalAlpha = Math.max(0, 1 - life * life);
          cx.translate(sh.cx + sh.dx * dist, sh.cy + sh.dy * dist + t * t * H * .15); cx.rotate(sh.r); cx.scale(sc * Math.max(.15, Math.abs(Math.cos(sh.flip))), sc); cx.translate(-sh.cx, -sh.cy);
          cx.beginPath(); sh.poly.forEach(function (q, j) { if (j) cx.lineTo(q[0], q[1]); else cx.moveTo(q[0], q[1]); }); cx.closePath();
          cx.save(); cx.clip(); cx.drawImage(snap, 0, 0); cx.fillStyle = 'rgba(255,255,255,' + (.08 + .15 * Math.abs(Math.sin(sh.flip))) + ')'; cx.fill(); cx.restore();
          cx.strokeStyle = 'hsla(' + ((hh + 180) % 360) + ',100%,80%,.9)'; cx.lineWidth = Math.max(1, S * 2.5 / sc); cx.stroke();
          cx.restore();
        });
        cx.globalCompositeOperation = 'lighter';
        sparks.forEach(function (sp) { sp.x += sp.vx * slow; sp.y += sp.vy * slow; sp.vy += Math.min(W, H) * .0012; sp.vx *= .97; sp.life -= .025;
          if (sp.life > 0) { cx.strokeStyle = 'hsla(' + sp.h + ',100%,70%,' + sp.life + ')'; cx.lineWidth = Math.max(1, S * 2.5); cx.beginPath(); cx.moveTo(sp.x, sp.y); cx.lineTo(sp.x - sp.vx * 1.5, sp.y - sp.vy * 1.5); cx.stroke(); } });
        cx.globalCompositeOperation = 'source-over';
        if (t < .12) flash('hsl(' + hh + ',100%,85%)', .55 * (1 - t / .12));
        if (t > 1.5) { shards = null; newCycle(now); }
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
    for (var k = 0; k < 4; k++) jellies.push({ x: .12 + k * .24 + Math.random() * .05, y: .3 + Math.random() * .4, s: .06 + Math.random() * .04, ph: Math.random() * 6, h: k * 60, pulse: 0 });
    // more sea life: fish schools, a manta ray, a sea turtle, a whale far away, kelp
    var schools = [0, 1, 2].map(function (i) { var f = []; for (var n = 0; n < 22; n++) f.push([Math.random() * .25, (Math.random() - .5) * .12, Math.random() * 6]); return { x: Math.random(), y: .3 + i * .2, dir: i % 2 ? -1 : 1, sp: .0012 + Math.random() * .001, fish: f, h: i * 90, turn: 0 }; });
    var kelp = []; for (var kk = 0; kk < 14; kk++) kelp.push([kk / 13 + (Math.random() - .5) * .05, .25 + Math.random() * .3, Math.random() * 6, Math.random() < .5]);
    var critters = [{ kind: 'manta', x: -0.15, y: .35, dir: 1, sp: .0011, wait: 0 }, { kind: 'turtle', x: 1.15, y: .62, dir: -1, sp: .0007, wait: 60 }, { kind: 'whale', x: 1.05, y: .22, dir: -1, sp: .00035, wait: 0 }];
    function fishShape(x, y, sz, dir, col, wag) {
      cx.fillStyle = col; cx.beginPath(); cx.ellipse(x, y, sz, sz * .38, 0, 0, 6.283); cx.fill();
      cx.beginPath(); cx.moveTo(x - dir * sz * .8, y); cx.lineTo(x - dir * sz * 1.5, y - sz * .45 + wag); cx.lineTo(x - dir * sz * 1.5, y + sz * .45 + wag); cx.closePath(); cx.fill();
    }
    function critter(c, t, hh) {
      var x = c.x * W, y = (c.y + Math.sin(t * .4 + c.wait) * .02) * H, d = c.dir;
      if (c.kind === 'manta') {
        var s2 = Math.min(W, H) * .2, flap = Math.sin(t * 1.6) * .35;
        cx.save(); cx.translate(x, y); cx.scale(d, 1);
        var mg = cx.createLinearGradient(0, -s2, 0, s2); mg.addColorStop(0, 'hsla(' + hh + ',40%,22%,.95)'); mg.addColorStop(1, 'hsla(' + hh + ',50%,8%,.95)');
        cx.fillStyle = mg; cx.beginPath(); cx.moveTo(s2 * .55, 0);
        cx.quadraticCurveTo(s2 * .1, -s2 * (.3 + flap), -s2 * .25, -s2 * (.95 + flap * .8));
        cx.quadraticCurveTo(-s2 * .2, -s2 * .2, -s2 * .45, 0);
        cx.quadraticCurveTo(-s2 * .2, s2 * .2, -s2 * .25, s2 * (.95 - flap * .8));
        cx.quadraticCurveTo(s2 * .1, s2 * (.3 - flap), s2 * .55, 0); cx.fill();
        cx.strokeStyle = 'hsla(' + ((hh + 160) % 360) + ',100%,70%,.5)'; cx.lineWidth = Math.max(1, S * 2); cx.stroke();
        cx.beginPath(); cx.moveTo(-s2 * .45, 0); cx.quadraticCurveTo(-s2 * .8, s2 * .05 * Math.sin(t * 3), -s2 * 1.1, 0); cx.stroke();
        cx.restore();
      } else if (c.kind === 'turtle') {
        var s3 = Math.min(W, H) * .09, fl = Math.sin(t * 2.2) * .5;
        cx.save(); cx.translate(x, y); cx.scale(d, 1);
        cx.fillStyle = 'hsla(' + ((hh + 90) % 360) + ',45%,30%,.95)';
        [[.35, -.5, -.6 - fl], [.35, .5, .6 + fl], [-.45, -.4, -.3 + fl * .5], [-.45, .4, .3 - fl * .5]].forEach(function (f) { cx.beginPath(); cx.ellipse(f[0] * s3, f[1] * s3, s3 * .5, s3 * .16, f[2], 0, 6.283); cx.fill(); });
        cx.beginPath(); cx.ellipse(s3 * .85, 0, s3 * .25, s3 * .2, 0, 0, 6.283); cx.fill();
        var sg = cx.createRadialGradient(-s3 * .1, -s3 * .2, 0, 0, 0, s3 * .7); sg.addColorStop(0, 'hsl(' + ((hh + 60) % 360) + ',55%,45%)'); sg.addColorStop(1, 'hsl(' + ((hh + 90) % 360) + ',50%,18%)');
        cx.fillStyle = sg; cx.beginPath(); cx.ellipse(0, 0, s3 * .7, s3 * .5, 0, 0, 6.283); cx.fill();
        cx.strokeStyle = 'rgba(0,0,0,.35)'; cx.lineWidth = Math.max(1, S * 1.5);
        for (var hx = -1; hx <= 1; hx++) { cx.beginPath(); cx.arc(hx * s3 * .3, 0, s3 * .16, 0, 6.283); cx.stroke(); }
        cx.restore();
      } else {
        var s4 = Math.min(W, H) * .55;
        cx.save(); cx.translate(x, y); cx.scale(d, 1); cx.globalAlpha = .28;
        cx.fillStyle = 'hsl(' + ((hh + 20) % 360) + ',40%,6%)';
        cx.beginPath(); cx.moveTo(s4 * .6, 0); cx.quadraticCurveTo(s4 * .5, -s4 * .2, 0, -s4 * .17); cx.quadraticCurveTo(-s4 * .5, -s4 * .1, -s4 * .8, -s4 * .02);
        cx.lineTo(-s4 * 1.0, -s4 * (.14 + Math.sin(t * .8) * .05)); cx.lineTo(-s4 * .92, 0); cx.lineTo(-s4 * 1.0, s4 * (.14 - Math.sin(t * .8) * .05)); cx.lineTo(-s4 * .8, s4 * .03);
        cx.quadraticCurveTo(-s4 * .4, s4 * .14, 0, s4 * .15); cx.quadraticCurveTo(s4 * .45, s4 * .15, s4 * .6, 0); cx.fill();
        cx.beginPath(); cx.ellipse(s4 * .05, s4 * .14, s4 * .18, s4 * .04, .5, 0, 6.283); cx.fill();
        cx.restore();
      }
    }
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
      // whale far away, then kelp, fish schools, manta and turtle
      cx.globalCompositeOperation = 'source-over';
      critters.forEach(function (c) {
        if (c.wait > 0) { c.wait--; return; }
        c.x += c.dir * c.sp * (1 + b.e * .5);
        if ((c.dir > 0 && c.x > 1.4) || (c.dir < 0 && c.x < -0.4)) { c.dir *= -1; c.y = c.kind === 'whale' ? .18 + Math.random() * .12 : .3 + Math.random() * .4; c.wait = 300 + Math.random() * 600 | 0; }
        if (c.kind === 'whale') critter(c, t, hh);
      });
      cx.globalCompositeOperation = 'source-over';
      kelp.forEach(function (k2) {
        if (!k2[3]) return;
        var kx = k2[0] * W, kh = k2[1] * H; cx.strokeStyle = 'hsla(' + ((hh + 100) % 360) + ',60%,14%,.9)'; cx.lineWidth = Math.max(2, W * .008);
        cx.beginPath(); cx.moveTo(kx, H); for (var seg = 1; seg <= 8; seg++) cx.lineTo(kx + Math.sin(t * .9 + k2[2] + seg * .5) * seg * W * .004, H - kh * seg / 8); cx.stroke();
      });
      schools.forEach(function (sc) {
        sc.x += sc.dir * sc.sp * (1 + b.e); if (b.hit && Math.random() < .25) sc.turn = 1;
        sc.turn *= .9;
        if (sc.x > 1.35) { sc.dir = -1; } if (sc.x < -0.35) { sc.dir = 1; }
        var fh = (hh + sc.h) % 360;
        sc.fish.forEach(function (f) {
          var fx = (sc.x - sc.dir * f[0]) * W, fy = (sc.y + f[1] + Math.sin(t * 1.3 + f[2]) * .015 + sc.turn * Math.sin(f[2]) * .05) * H;
          var sz = Math.min(W, H) * .028;
          fishShape(fx, fy, sz, sc.dir, 'hsla(' + fh + ',90%,' + (55 + b.k * 25) + '%,.85)', Math.sin(t * 9 + f[2]) * sz * .25);
        });
      });
      critters.forEach(function (c) { if (c.kind !== 'whale' && c.wait <= 0) critter(c, t, hh); });
      kelp.forEach(function (k2) {
        if (k2[3]) return;
        var kx = k2[0] * W, kh = k2[1] * H; cx.strokeStyle = 'hsla(' + ((hh + 110) % 360) + ',70%,22%,.95)'; cx.lineWidth = Math.max(2, W * .01);
        cx.beginPath(); cx.moveTo(kx, H); for (var seg = 1; seg <= 8; seg++) cx.lineTo(kx + Math.sin(t * .9 + k2[2] + seg * .5) * seg * W * .005, H - kh * seg / 8); cx.stroke();
      });
      cx.globalCompositeOperation = 'lighter';
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
      var sand = cx.createLinearGradient(0, H * .9, 0, H); sand.addColorStop(0, 'rgba(0,0,0,0)'); sand.addColorStop(1, 'hsla(' + ((hh + 30) % 360) + ',40%,12%,.9)');
      cx.fillStyle = sand; cx.fillRect(0, H * .9, W, H * .1);
    }, 30);
  }

  // 13. HOLO HEAD — realistic wireframe human head. Changes colour with the music, eyes look around,
  //     and the face constantly stretches, waves, twists, bulges and melts — harder on the beat.
  function friend() {
    var b = beatTracker(), hue = beatHue(190, 55);
    // cross-sections from neck to crown: [height, half-width, half-depth, forward shift]
    var T = [[-1.08, .33, .37, -.16], [-.74, .32, .36, -.13], [-.66, .2, .3, .04], [-.6, .3, .38, .06], [-.5, .42, .5, .05], [-.36, .56, .64, .03],
             [-.18, .66, .74, .01], [-.02, .7, .8, 0], [.1, .72, .84, -.01], [.28, .74, .87, -.03], [.5, .72, .87, -.06], [.72, .6, .76, -.08], [.9, .4, .52, -.09], [1, .06, .06, -.09]];
    function sect(h) {
      for (var i = 1; i < T.length; i++) if (h <= T[i][0]) { var A2 = T[i - 1], B2 = T[i], f = (h - A2[0]) / (B2[0] - A2[0]); f = f * f * (3 - 2 * f); return [A2[1] + (B2[1] - A2[1]) * f, A2[2] + (B2[2] - A2[2]) * f, A2[3] + (B2[3] - A2[3]) * f]; }
      return [.06, .06, -.09];
    }
    function G(v, c, w) { return Math.exp(-Math.pow((v - c) / w, 2)); }
    function surf(h, u) {
      var sc = sect(h), x = sc[0] * Math.sin(u), z = sc[2] + sc[1] * Math.cos(u), fr = Math.max(0, Math.cos(u)); fr = fr * fr;
      if (h > -.66) {
        var ax = Math.abs(x);
        var nose = (h > -.2 && h < .16 ? Math.pow((.16 - h) / .36, 1.3) : 0) * .26 * G(x, 0, .06 + (.16 - h) * .1);
        var nostrils = .06 * G(h, -.19, .04) * G(ax, .09, .05);
        var brow = .09 * G(h, .25, .05) * (1 - .5 * G(x, 0, .08));
        var socket = -.13 * G(h, .1, .075) * G(ax, .26, .1);
        var cheek = .06 * G(h, -.08, .1) * G(ax, .44, .1);
        var hollow = -.04 * G(h, -.28, .08) * G(ax, .42, .08);
        var lipU = .07 * G(h, -.33, .035) * G(x, 0, .2), lipL = .065 * G(h, -.42, .035) * G(x, 0, .17), mouthLine = -.035 * G(h, -.375, .015) * G(x, 0, .2);
        var chin = .08 * G(h, -.56, .05) * G(x, 0, .15);
        z += fr * (nose + nostrils + brow + socket + cheek + hollow + lipU + lipL + mouthLine + chin);
        if (h < -.3 && h > -.62) x *= 1 + .05 * G(h, -.45, .1) * (ax > .3 ? 1 : 0); // jaw angle
      }
      if (Math.abs(Math.abs(u) - 1.571) < .4 && h > -.15 && h < .22) x += (x > 0 ? 1 : -1) * .08 * G(h, .04, .1); // ears
      return [x, -h * 1.15, z];
    }
    var RINGS = 30, LONS = 34, mesh = [], jit = [];
    for (var r = 0; r <= RINGS; r++) { var row = [], jr = [], h = -1.08 + r / RINGS * 2.08;
      for (var o = 0; o <= LONS; o++) { row.push(surf(h, o / LONS * 6.2832 - Math.PI)); jr.push([Math.random() - .5, Math.random() - .5, Math.random() - .5]); }
      mesh.push(row); jit.push(jr); }
    var eyes = [-1, 1].map(function (sd) { return { x: .26 * sd, h: .1 }; });
    function onFace(xx, hh2, dz) { var sc = sect(hh2), u = Math.asin(Math.max(-1, Math.min(1, xx / sc[0]))); var p2 = surf(hh2, u); p2[2] += dz || .015; return p2; }

    var gaze = [0, 0], gazeT = [0, 0], nextGaze = 0, blink = 0, nextBlink = 0;
    var move = null, moveT = 0, nextMove = performance.now() + 2000, nod = 0, beats = 0;
    var MOVES = ['spin', 'glitch', 'explode', 'laugh', 'stare', 'scan', 'rainbow', 'shake', 'tilt', 'melt', 'stretch', 'wave', 'twist', 'bulge'];
    var DUR = { spin: 1.6, glitch: .8, explode: 1.6, laugh: 1.8, stare: 2.2, scan: 2, rainbow: 4, shake: 1.2, tilt: 2, melt: 3, stretch: 2, wave: 2.5, twist: 2.4, bulge: 1.8 };
    var M = { stretch: 0, wave: 0, twist: 0, bulge: 0, melt: 0, pinch: 0, by: 0 };
    function startMove(m, now) { move = m || MOVES[Math.random() * MOVES.length | 0]; moveT = now; M.by = Math.random() * 1.4 - .7; }
    function rot(p, yaw, pitch, roll) {
      var x = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), z = -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw), y = p[1];
      var y2 = y * Math.cos(pitch) - z * Math.sin(pitch), z2 = y * Math.sin(pitch) + z * Math.cos(pitch);
      return [x * Math.cos(roll) - y2 * Math.sin(roll), x * Math.sin(roll) + y2 * Math.cos(roll), z2];
    }
    function morph(p, t) {            // bend the head: stretch, wave, twist, bulge, melt, pinch
      var x = p[0], y = p[1], z = p[2];
      var sy = 1 + M.stretch * .35; y *= sy; x /= Math.sqrt(sy); z /= Math.sqrt(sy);
      x += M.wave * Math.sin(y * 5 + t * 5) * .14;
      var tw = M.twist * y * 1.4, c = Math.cos(tw), s2 = Math.sin(tw); var nx = x * c + z * s2; z = -x * s2 + z * c; x = nx;
      var bg = 1 + M.bulge * .35 * Math.exp(-Math.pow(y - M.by, 2) / .06); x *= bg; z *= bg;
      if (M.melt > 0 && y > -.3) { var dr = Math.pow(y + .3, 2); y += M.melt * dr * (.6 + .4 * Math.sin(x * 9 + t)); x *= 1 + M.melt * dr * .3; }
      x *= 1 - M.pinch * .25 * Math.exp(-y * y / .1);
      return [x, y, z];
    }
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit), t = now / 1000;
      if (b.hit) { beats++; nod = 1; if (beats % 24 === 0) startMove('explode', now); else if (b.k > .6 && Math.random() < .25) startMove(['stretch', 'bulge', 'wave', 'twist'][Math.random() * 4 | 0], now); }
      nod *= .85;
      if (!move && now > nextMove) startMove(null, now);
      var mt = move ? (now - moveT) / 1000 : 0;
      if (move && mt > DUR[move]) { move = null; nextMove = now + 1800 + Math.random() * 2600; }
      var ease = move ? Math.sin(Math.min(1, mt / DUR[move]) * Math.PI) : 0;
      // constant gentle morphing + big morphs from moves and bass
      function to(k, v) { M[k] += (v - M[k]) * .12; }
      to('stretch', .12 * Math.sin(t * .7) + (move === 'stretch' ? .9 * ease * Math.sin(mt * 6) : 0) + b.k * .25);
      to('wave', .15 * Math.sin(t * .5) + (move === 'wave' ? 1 : 0) * ease);
      to('twist', .1 * Math.sin(t * .37) + (move === 'twist' ? 1.1 * ease * Math.sin(mt * 3) : 0));
      to('bulge', .15 * (.5 + .5 * Math.sin(t * .9)) + (move === 'bulge' ? 1.6 * ease : 0) + b.k * .3);
      to('melt', move === 'melt' ? ease * 1.2 : 0);
      to('pinch', .2 * Math.max(0, Math.sin(t * .23)) + (move === 'laugh' ? .3 * ease : 0));
      if (now > nextGaze) { gazeT = [(Math.random() - .5) * 2, (Math.random() - .5) * 1.4]; nextGaze = now + 500 + Math.random() * 2000; }
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
      var gl2 = move === 'glitch' ? 1 : (Math.random() < .015 ? .5 : 0);

      cx.fillStyle = '#000308'; cx.fillRect(0, 0, W, H);
      var cxp = W / 2, cyp = H * .44, R = Math.min(W, H) * .32 * scale;
      var gg = cx.createRadialGradient(cxp, cyp, 0, cxp, cyp, R * 2);
      gg.addColorStop(0, 'hsla(' + hh + ',100%,55%,' + (.14 + p * .14) + ')'); gg.addColorStop(1, 'hsla(' + hh + ',100%,50%,0)');
      cx.fillStyle = gg; cx.fillRect(0, 0, W, H);
      function P(pt, jj) {
        var q = morph(pt, t);
        if (ex > 0 || gl2 > 0) q = [q[0] * (1 + ex * 1.2) + jj[0] * (ex * 1.4 + gl2 * .06), q[1] * (1 + ex * 1.2) + jj[1] * ex * 1.4, q[2] * (1 + ex * 1.2) + jj[2] * ex * 1.4];
        var rq = rot(q, yaw, pitch, roll), f = 3.4 / (3.4 - rq[2]);
        return [cxp + rq[0] * R * f, cyp + rq[1] * R * f, rq[2]];
      }
      var PP = mesh.map(function (row, ri) { return row.map(function (pt, oi) { return P(pt, jit[ri][oi]); }); });
      var rainbow = move === 'rainbow', scanY = move === 'scan' ? cyp - R * 1.3 + (mt / DUR.scan) * R * 2.8 : -1e9;
      // batch the wireframe into a few depth layers (fast: one stroke per layer)
      var BINS = 4, paths = [], i2;
      for (i2 = 0; i2 < BINS; i2++) paths.push([]);
      function seg(a2, b2, ring) { var dep = (a2[2] + b2[2]) / 2, bin = dep <= 0 ? 0 : Math.min(BINS - 1, 1 + (dep * 3 | 0)); paths[bin].push(a2, b2, ring); }
      for (var ri = 0; ri <= RINGS; ri++) for (var oi = 0; oi < LONS; oi++) seg(PP[ri][oi], PP[ri][oi + 1], ri);
      for (var oj = 0; oj < LONS; oj++) for (var rj = 0; rj < RINGS; rj++) seg(PP[rj][oj], PP[rj + 1][oj], rj);
      cx.lineWidth = Math.max(1, S * 2.1);
      var AL = [.06, .35, .65, .95];
      for (var bi = 0; bi < BINS; bi++) {
        var L = paths[bi];
        if (rainbow) {
          for (var k3 = 0; k3 < L.length; k3 += 3) { cx.strokeStyle = 'hsla(' + ((hh + L[k3 + 2] * 12) % 360) + ',100%,62%,' + AL[bi] + ')'; cx.beginPath(); cx.moveTo(L[k3][0], L[k3][1]); cx.lineTo(L[k3 + 1][0], L[k3 + 1][1]); cx.stroke(); }
        } else {
          cx.strokeStyle = 'hsla(' + hh + ',100%,' + (60 + p * 15) + '%,' + AL[bi] + ')';
          var jx = gl2 ? R * .05 * gl2 : 0;
          cx.beginPath();
          for (var k4 = 0; k4 < L.length; k4 += 3) { var o2 = jx ? (Math.random() - .5) * jx : 0; cx.moveTo(L[k4][0] + o2, L[k4][1]); cx.lineTo(L[k4 + 1][0] + o2, L[k4 + 1][1]); }
          cx.stroke();
        }
      }
      if (scanY > -1e8) { cx.fillStyle = 'hsla(' + hh + ',100%,85%,.25)'; cx.fillRect(0, scanY - R * .02, W, R * .04); }
      if (gl2) { cx.globalCompositeOperation = 'lighter'; cx.drawImage(cv, R * .03 * gl2, 0); cx.globalCompositeOperation = 'source-over'; }
      if (ex < .3) {
        var acc = 'hsl(' + ((hh + 180) % 360) + ',100%,' + (70 + p * 15) + '%)', wide = move === 'stare' ? 1.6 * ease + 1 : 1, Z = [0, 0, 0];
        eyes.forEach(function (e) {
          var open = (.034 * wide) * (1 - blink);
          var L2 = P(onFace(e.x - .095, e.h), Z), R2 = P(onFace(e.x + .095, e.h), Z), T2 = P(onFace(e.x, e.h + open + .006), Z), B2 = P(onFace(e.x, e.h - open - .006), Z), C2 = P(onFace(e.x, e.h), Z);
          if (C2[2] < 0) return;
          cx.strokeStyle = acc; cx.lineWidth = Math.max(1, S * 2.4);
          cx.beginPath(); cx.moveTo(L2[0], L2[1]); cx.quadraticCurveTo(T2[0] * 2 - (L2[0] + R2[0]) / 2, T2[1] * 2 - (L2[1] + R2[1]) / 2, R2[0], R2[1]);
          cx.quadraticCurveTo(B2[0] * 2 - (L2[0] + R2[0]) / 2, B2[1] * 2 - (L2[1] + R2[1]) / 2, L2[0], L2[1]); cx.stroke();
          if (blink < .5) {
            var I2 = P(onFace(e.x + gaze[0] * .045, e.h + gaze[1] * .012), Z), ir = R * .036 * (move === 'stare' ? .7 : 1);
            cx.save(); cx.beginPath(); cx.moveTo(L2[0], L2[1]); cx.quadraticCurveTo(T2[0] * 2 - (L2[0] + R2[0]) / 2, T2[1] * 2 - (L2[1] + R2[1]) / 2, R2[0], R2[1]);
            cx.quadraticCurveTo(B2[0] * 2 - (L2[0] + R2[0]) / 2, B2[1] * 2 - (L2[1] + R2[1]) / 2, L2[0], L2[1]); cx.clip();
            var ig = cx.createRadialGradient(I2[0], I2[1], 0, I2[0], I2[1], ir);
            ig.addColorStop(0, '#000'); ig.addColorStop(.4, '#000'); ig.addColorStop(.45, acc); ig.addColorStop(1, 'hsla(' + ((hh + 200) % 360) + ',100%,40%,1)');
            cx.fillStyle = ig; cx.beginPath(); cx.arc(I2[0], I2[1], ir, 0, 6.283); cx.fill();
            cx.fillStyle = 'rgba(255,255,255,.9)'; cx.beginPath(); cx.arc(I2[0] - ir * .3, I2[1] - ir * .3, ir * .18, 0, 6.283); cx.fill();
            cx.restore();
          }
          var BR = P(onFace(e.x, e.h + .1), Z), BL = P(onFace(e.x - .12, e.h + .08), Z), BRR = P(onFace(e.x + .11, e.h + .085), Z);
          cx.strokeStyle = acc; cx.lineWidth = Math.max(1, S * 2.8); cx.beginPath(); cx.moveTo(BL[0], BL[1]); cx.quadraticCurveTo(BR[0], BR[1] - R * .02, BRR[0], BRR[1]); cx.stroke();
        });
        var mo = (move === 'laugh' ? .05 + .04 * Math.abs(Math.sin(mt * 14)) : b.k * .03) + .004;
        var ml = P(onFace(-.17, -.375), Z), mr = P(onFace(.17, -.375), Z), up = P(onFace(0, -.375 + mo * .3 + .012, .06), Z), dn = P(onFace(0, -.375 - mo - .012, .05), Z), mid = P(onFace(0, -.375, .04), Z);
        if (up[2] > 0) {
          cx.strokeStyle = acc; cx.lineWidth = Math.max(1, S * 2.6);
          cx.beginPath(); cx.moveTo(ml[0], ml[1]); cx.quadraticCurveTo(up[0] * 2 - (ml[0] + mr[0]) / 2, up[1] * 2 - (ml[1] + mr[1]) / 2, mr[0], mr[1]);
          cx.quadraticCurveTo(dn[0] * 2 - (ml[0] + mr[0]) / 2, dn[1] * 2 - (ml[1] + mr[1]) / 2, ml[0], ml[1]); cx.stroke();
          cx.beginPath(); cx.moveTo(ml[0], ml[1]); cx.quadraticCurveTo(mid[0], mid[1] + mo * R * .5, mr[0], mr[1]); cx.stroke();
        }
      }
      var by = cyp + R * 1.35;
      var bg2 = cx.createRadialGradient(cxp, by, 0, cxp, by, R);
      bg2.addColorStop(0, 'hsla(' + hh + ',100%,60%,' + (.35 + p * .3) + ')'); bg2.addColorStop(1, 'hsla(' + hh + ',100%,50%,0)');
      cx.fillStyle = bg2; cx.beginPath(); cx.ellipse(cxp, by, R, R * .14, 0, 0, 6.283); cx.fill();
      cx.fillStyle = 'rgba(0,0,0,.2)';
      for (var s2 = (now / 40 | 0) % 4; s2 < H; s2 += 4) cx.fillRect(0, s2, W, 1);
    }, 30);
    text('xpTop', 'NEXUS · HOLO HEAD');
    layer.onclick = function () { startMove(null, performance.now()); };
  }

  // ==================================================================
  // GPU VERSIONS: Blue Fire, Kaleidoscope, Planet Builder (fall back to the old ones without WebGL)
  // ==================================================================
  var FBM = 'float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return v; }\n';

  // 4. BLUE FIRE — wall of living blue flame; surges on the bass, white-hot core, sparks
  function bluefire() {
    var b = beatTracker(), hue = beatHue(200, 25), surge = 0;
    var g = glStart('bluefire', FBM +
      'uniform float surge;\n' +
      'void main(){ vec2 uv = gl_FragCoord.xy / res; vec2 p = (gl_FragCoord.xy - .5 * res) / res.y;\n' +
      ' float t = time;\n' +
      ' vec2 q = vec2(p.x * 2.4, uv.y * 2.2 - t * (1.3 + surge * 1.4));\n' +
      ' float n = fbm(q + vec2(fbm(q * 1.4 + t * .25), fbm(q * 1.1 - t * .2)) * 1.3);\n' +
      ' float flame = n * 1.6 - uv.y * (1.2 - surge * .5) - abs(p.x) * .2 * (1. - uv.y * .5) - .1;\n' +
      ' flame = clamp(flame * 1.9, 0., 1.);\n' +
      ' vec3 base = mix(vec3(.05, .35, 1.), pal(hue), .3);\n' +
      ' vec3 col = vec3(.0, .01, .05) + base * pow(flame, 1.5) * 1.05 + vec3(.7, .88, 1.) * pow(flame, 9.) * (.35 + surge * .5);\n' +
      ' vec2 sc = vec2(p.x * 40., uv.y * 22. - t * 9.); vec2 id = floor(sc); float h = hash(id);\n' +
      ' float spark = step(.985 - surge * .02, h) * smoothstep(.35, .0, length(fract(sc) - .5)) * (1. - uv.y);\n' +
      ' col += mix(base, vec3(1.), .5) * spark * 2.;\n' +
      ' float ring = exp(-abs(length(vec2(p.x, (uv.y + .1) * 1.6)) - surge * 1.3) * 18.) * surge;\n' +
      ' col += base * ring * .8;\n' +
      ' col *= 1. - smoothstep(.75, 1.6, abs(p.x));\n' +
      ' gl_FragColor = vec4(col, 1.); }');
    if (!g) return bluefire2d();
    text('xpTop', 'BLUE FIRE');
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit);
      surge += ((b.k * .9 + b.e * .4) - surge) * (b.k > surge ? .5 : .08);
      g.f('surge', surge); g.draw(now, b, hh);
    }, 30);
  }

  // 7. KALEIDOSCOPE — razor-sharp fractal mandala; spins, zooms and recolours on the beat
  function kaleido() {
    var b = beatTracker(), hue = beatHue(300, 70), spin = 0, zoom = 1, seg = 10;
    var g = glStart('kaleido',
      'uniform float spin, zoom, seg;\n' +
      'void main(){ vec2 p = (gl_FragCoord.xy - .5 * res) / res.y; p *= zoom;\n' +
      ' float r = length(p), a = atan(p.y, p.x) + spin;\n' +
      ' float sa = 6.28318 / seg; a = mod(a, sa); a = abs(a - sa * .5);\n' +
      ' vec2 z = vec2(cos(a), sin(a)) * r * 1.6;\n' +
      ' vec3 col = vec3(0.);\n' +
      ' for (int i = 0; i < 9; i++) { z = abs(z) / dot(z, z) - vec2(.86 + .07 * sin(time * .21), .58 + .08 * cos(time * .17));\n' +
      '  float d = length(z); col += pal(hue + float(i) * .09 + d * .05) * exp(-d * 2.6) * .55; }\n' +
      ' float rings = smoothstep(.012, .0, abs(fract(r * 5. - time * .4) - .5) - .485);\n' +
      ' float spokes = smoothstep(.015, .0, abs(a - sa * .25) * r - .002);\n' +
      ' col += pal(hue + .5) * (rings * .18 + spokes * .2);\n' +
      ' col = pow(col, vec3(1.7)) * (1.5 + kick * .9);\n' +
      ' col *= smoothstep(1.9, .3, r);\n' +
      ' gl_FragColor = vec4(col, 1.); }');
    if (!g) return kaleido2d();
    text('xpTop', 'KALEIDOSCOPE');
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit);
      spin += .004 + b.e * .02 + (b.hit ? .25 : 0);
      zoom += ((1.25 - b.k * .35) - zoom) * .15;
      if (b.hit && Math.random() < .15) seg = [6, 8, 10, 12, 16][Math.random() * 5 | 0];
      g.f('spin', spin); g.f('zoom', zoom); g.f('seg', seg); g.draw(now, b, hh);
    }, 30);
  }

  // 18. PLANET BUILDER — dust swirls into a lit, cloudy world; rings and moons arrive; supernova on a drop
  function planet() {
    var b = beatTracker(), hue = beatHue(Math.random() * 360, 20), t0 = performance.now(), phase = 'form', rot = 0, seed = Math.random() * 50, novaT = 0, ma = [0, 2];
    var g = glStart('planet', FBM +
      'uniform float build, nova, rot, seed, ringOn, moonsOn; uniform vec4 m1, m2;\n' +
      'vec3 lightDir = normalize(vec3(-.6, .45, .65));\n' +
      'vec3 sphereCol(vec3 n, float R){ float c = cos(rot), s = sin(rot); vec3 m = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);\n' +
      ' float u = atan(m.z, m.x), v = asin(clamp(m.y, -1., 1.));\n' +
      ' float bands = sin(v * 14. + fbm(vec2(u * 2., v * 6.) + seed) * 4.);\n' +
      ' float land = fbm(vec2(u * 1.6, v * 3.2) + seed * 1.3);\n' +
      ' vec3 c1 = pal(hue), c2 = pal(hue + .12), c3 = pal(hue + .5) * .6;\n' +
      ' vec3 col = mix(c1, c2, .5 + .5 * bands) * (.55 + .45 * land);\n' +
      ' col = mix(col, c3, smoothstep(.55, .62, land) * .5);\n' +
      ' float cu = u + time * .05; float cl = smoothstep(.5, .75, fbm(vec2(cu * 2.2, v * 5.) + seed + 7.));\n' +
      ' col = mix(col, vec3(1.), cl * .7);\n' +
      ' float diff = max(dot(n, lightDir), 0.); float amb = .06;\n' +
      ' col *= amb + diff * 1.2;\n' +
      ' col += pal(hue + .55) * pow(1. - n.z, 3.) * .9 * (.3 + diff);\n' +
      ' col += vec3(1.) * pow(max(dot(reflect(-lightDir, n), vec3(0., 0., 1.)), 0.), 30.) * .25;\n' +
      ' return col; }\n' +
      'vec3 moon(vec2 p, vec4 m, vec3 col, float R, bool front){ if ((m.w > 0.) != front) return col; float r = R * m.z; float d = length(p - m.xy); if (d > r) return col;\n' +
      ' vec3 n = vec3((p - m.xy) / r, 0.); n.z = sqrt(max(0., 1. - dot(n.xy, n.xy)));\n' +
      ' float cr = fbm(n.xy * 4. + m.z * 30.); return (vec3(.55, .53, .5) * (.6 + .5 * cr)) * (.05 + max(dot(n, lightDir), 0.) * 1.1); }\n' +
      'void main(){ vec2 p = (gl_FragCoord.xy - .5 * res) / res.y;\n' +
      ' vec3 col = vec3(.004, .004, .02);\n' +
      ' col += pal(hue + .6) * pow(fbm(p * 2.5 + seed), 3.) * .35 + pal(hue + .25) * pow(fbm(p * 4. - seed), 4.) * .25;\n' +
      ' vec2 sc = gl_FragCoord.xy / 2.; float st = hash(floor(sc)); col += vec3(1.) * step(.996, st) * (.5 + .5 * sin(time * 3. + st * 60.));\n' +
      ' float R = .27 * smoothstep(0., 1., build) * (1. + kick * .02) * (1. - nova);\n' +
      ' float d = length(p);\n' +
      ' float ca = cos(-.32), sa = sin(-.32); vec2 pr = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);\n' +
      ' float e = length(vec2(pr.x, pr.y / .26)); float ringMask = smoothstep(1.4, 1.43, e / max(R, .001)) * smoothstep(2.25, 2.2, e / max(R, .001)) * ringOn;\n' +
      ' vec3 ringCol = pal(hue + .08 + e * .4) * (.35 + .65 * (.5 + .5 * sin(e / max(R, .001) * 38.))) * (.5 + .5 * smoothstep(1.5, 2.2, e / max(R, .001)));\n' +
      ' float ringShadow = (pr.y > 0. && abs(pr.x) < R) ? .35 : 1.;\n' +
      ' col = moon(p, m1, col, R, false); col = moon(p, m2, col, R, false);\n' +
      ' if (pr.y < 0.) col = mix(col, ringCol, ringMask * .8);\n' +
      ' if (d < R) { vec3 n = vec3(p / R, 0.); n.z = sqrt(max(0., 1. - dot(n.xy, n.xy))); col = sphereCol(n, R); }\n' +
      ' else col += pal(hue + .55) * exp(-(d - R) * 28.) * .6 * step(.001, R);\n' +
      ' if (pr.y >= 0.) col = mix(col, ringCol * ringShadow, ringMask * .85);\n' +
      ' col = moon(p, m1, col, R, true); col = moon(p, m2, col, R, true);\n' +
      ' float a = atan(p.y, p.x);\n' +
      ' float disk = fbm(vec2(a * 3. + log(d + .01) * 6. - time * 1.5, d * 8.)) * exp(-d * 2.5) * smoothstep(.0, .12, d);\n' +
      ' col += pal(hue + d) * pow(disk, 2.) * 2.2 * (1. - smoothstep(.6, 1., build));\n' +
      ' if (nova > 0.) { float sr = nova * 1.7; col += pal(hue + .1) * exp(-abs(d - sr) * 25.) * (1. - nova) * 2.5;\n' +
      '  col += pal(hue + .3) * exp(-abs(d - sr * .7) * 35.) * (1. - nova) * 1.5;\n' +
      '  col += vec3(1., .95, .85) * exp(-d * (4. + nova * 20.)) * (1. - nova) * 3.;\n' +
      '  col += pal(hue + a * .1) * fbm(vec2(a * 6., d * 10. - nova * 8.)) * exp(-abs(d - sr * .85) * 6.) * (1. - nova) * 1.5; }\n' +
      ' gl_FragColor = vec4(col, 1.); }');
    if (!g) return planet2d();
    text('xpTop', 'PLANET BUILDER');
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit), t = (now - t0) / 1000, nova = 0;
      var build = Math.min(1, t / 6), ringOn = Math.min(1, Math.max(0, (t - 7) / 2.5)), moonsOn = t > 11 ? 1 : 0;
      if (phase === 'form' && t > 24 && ((b.hit && b.k > .45) || t > 40)) { phase = 'nova'; novaT = now; }
      if (phase === 'nova') { nova = Math.min(1, (now - novaT) / 3500); if (nova >= 1) { phase = 'form'; t0 = now; seed = Math.random() * 50; hue = beatHue(Math.random() * 360, 20); } }
      rot += .003 + b.e * .004;
      ma[0] += .006 * (1 + b.e); ma[1] += .0035 * (1 + b.e);
      var R = .27 * build, asp = 1;
      function mp(a, dist, size, on) { return [Math.cos(a) * R * dist, Math.sin(a) * R * dist * .3 - .02, on ? size : 0, Math.sin(a)]; }
      var M1 = mp(ma[0], 2.4, .14, moonsOn), M2 = mp(ma[1], 3.1, .09, t > 15);
      g.v4a('m1', M1); g.v4a('m2', M2);
      g.f('build', build); g.f('nova', nova); g.f('rot', rot); g.f('seed', seed); g.f('ringOn', ringOn); g.f('moonsOn', moonsOn);
      if (nova > 0 && nova < .08) flash('#fff', .5);
      g.draw(now, b, hh);
    }, 30);
  }

  // ==================================================================
  // GRAPHICS-CHIP VISUALS (sharp, smooth, music-synced)
  // ==================================================================

  // 14. FRACTAL DIVE — endless dive into the Mandelbrot set; colours shift on the beat
  function fractal() {
    var b = beatTracker(), hue = beatHue(200, 40);
    var g = glStart('fractal',
      'uniform vec2 center; uniform float scale, fade, maxIter;\n' +
      'void main(){ vec2 uv = (gl_FragCoord.xy - .5 * res) / res.y; vec2 c = center + uv * scale; vec2 z = vec2(0.); float n = 0.; float m2 = 0.;\n' +
      ' for (int i = 0; i < 320; i++) { if (float(i) >= maxIter) break; z = vec2(z.x*z.x - z.y*z.y, 2.*z.x*z.y) + c; m2 = dot(z, z); if (m2 > 256.) break; n += 1.; }\n' +
      ' vec3 col = vec3(0.);\n' +
      ' if (n < maxIter) { float sn = n - log2(log2(m2)) + 4.; col = pal(hue + sn * .022 + time * .015); col *= .5 + .5 * sin(sn * .3 - time * 1.5); col *= pow(clamp((sn - 2.) / (maxIter * .3), 0., 1.), 1.1); col = pow(col, vec3(.85)) * 1.25; col *= 1. + kick * .5; }\n' +
      ' else { col = pal(hue + .6) * .05 * (1. + kick); }\n' +
      ' float v = 1. - dot(uv, uv) * .35; gl_FragColor = vec4(col * fade * v, 1.); }');
    if (!g) return kaleido();
    var TARGETS = [[-0.743643887, 0.131825904], [-0.10109636, 0.95628651], [-0.77468061, -0.13741689], [-0.77568377, 0.13646737], [0.36024044, -0.64131306], [0.00164372, -0.82246763], [-1.62917, -0.0203968], [-0.74529, 0.11307]];
    var ti = Math.random() * TARGETS.length | 0, start = performance.now(), DIVE = 26;
    text('xpTop', 'FRACTAL DIVE');
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit);
      var t = (now - start) / 1000;
      if (t > DIVE) { ti = (ti + 1 + (Math.random() * (TARGETS.length - 1) | 0)) % TARGETS.length; start = now; t = 0; }
      var depth = Math.pow(t / DIVE, 1.15), scale = 2.6 * Math.pow(1.2e-4, depth) * (1 - b.k * .025);
      var fade = Math.min(1, t / 1.2, (DIVE - t) / 1.2);
      g.v2('center', TARGETS[ti][0], TARGETS[ti][1]);
      g.f('scale', scale); g.f('fade', Math.max(0, fade)); g.f('maxIter', 90 + 160 * depth);
      g.draw(now, b, hh);
    }, 30);
  }

  // 15. WORMHOLE — twisting tunnel of light; opens into a galaxy on big drops
  function wormhole() {
    var b = beatTracker(), hue = beatHue(260, 60), z = 0, open = 0, beats = 0;
    var g = glStart('wormhole',
      'uniform float travel, open;\n' +
      'void main(){ vec2 p = (gl_FragCoord.xy - .5 * res) / res.y;\n' +
      ' vec2 bend = vec2(sin(time * .31), cos(time * .23)) * .08 * (1. - open); p += bend * length(p) * 1.5;\n' +
      ' float r = length(p), a = atan(p.y, p.x);\n' +
      ' float d = .32 / max(r, .001) + travel;\n' +
      ' float tw = a / 3.14159 + d * .06 + .12 * sin(d * .7 + time);\n' +
      ' float rings = pow(.5 + .5 * sin(d * 12.566), 6.);\n' +
      ' float streaks = pow(.5 + .5 * sin(tw * 3.14159 * 22. + d * 3.), 22.);\n' +
      ' float n = noise(vec2(tw * 18., d * 3.)) * .6 + noise(vec2(tw * 40., d * 9.)) * .4;\n' +
      ' vec3 c1 = pal(hue + d * .04), c2 = pal(hue + .33 + d * .03);\n' +
      ' float panel = smoothstep(.45, .8, n);\n' +
      ' vec3 col = c1 * (.04 + .55 * panel) + c1 * rings * (.5 + .5 * n) * 1.2 + c2 * streaks * 1.3;\n' +
      ' col *= smoothstep(.0, .25, r) * (.8 + kick * .8);\n' +
      ' col += c1 * pow(max(0., 1. - r * 3.), 4.) * (.4 + kick);\n' +
      ' float ga = a + log(r + .001) * 3. - time * .4; float arms = pow(.5 + .5 * sin(ga * 2.), 4.) * exp(-r * 3.);\n' +
      ' vec3 gal = pal(hue + .15 + r) * arms * 1.6 + vec3(1., .95, .85) * exp(-r * 22.) * 1.5 + step(.997, hash(floor(p * 260.))) * .8;\n' +
      ' col = mix(col, gal, open * smoothstep(.75, .0, r));\n' +
      ' gl_FragColor = vec4(col, 1.); }');
    if (!g) return hyper();
    text('xpTop', 'WORMHOLE');
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit);
      if (b.hit) { beats++; if (beats % 32 === 0) open = 1.0001; }
      if (open > 0) open = Math.max(0, open - .004);
      z += (.02 + b.e * .05 + b.k * .06) * (1 - open * .8);
      g.f('travel', z); g.f('open', Math.min(1, open * 1.6));
      g.draw(now, b, hh);
    }, 30);
  }

  // 16. BLACK MIRROR — dark liquid; every bass hit drops a ripple and colour bleeds out like ink
  function mirror() {
    var b = beatTracker(), hue = beatHue(200, 70), slots = [], next = 0, lastDrip = 0;
    for (var i = 0; i < 8; i++) slots.push([0, 0, -99, 0, 0, 0, 0]);
    var g = glStart('mirror',
      'uniform vec4 R[8]; uniform vec3 RC[8];\n' +
      'float hgt(vec2 p){ float s = .015 * sin(p.x * 6. + time * .6) * sin(p.y * 5. - time * .5);\n' +
      ' for (int i = 0; i < 8; i++) { vec4 r = R[i]; float age = time - r.z; if (age < 0. || age > 7.) continue;\n' +
      '  float d = length(p - r.xy), front = age * .32; s += sin((d - front) * 46.) * exp(-abs(d - front) * 7.) * exp(-age * .55) * r.w * .06; }\n' +
      ' return s; }\n' +
      'void main(){ vec2 p = (gl_FragCoord.xy - .5 * res) / res.y; vec2 e = vec2(.003, 0.);\n' +
      ' float hx = hgt(p + e.xy) - hgt(p - e.xy), hy = hgt(p + e.yx) - hgt(p - e.yx);\n' +
      ' vec3 nrm = normalize(vec3(-hx, -hy, e.x * 2.));\n' +
      ' vec3 ink = vec3(0.); vec2 q = p + nrm.xy * .4;\n' +
      ' for (int i = 0; i < 8; i++) { vec4 r = R[i]; float age = time - r.z; if (age < 0. || age > 9.) continue;\n' +
      '  float d = length(q - r.xy); float spread = .04 + age * .09;\n' +
      '  float wisp = .7 + .6 * noise(q * 9. + vec2(age * .3, float(i) * 7.));\n' +
      '  ink += RC[i] * exp(-pow(d / spread, 2.)) * exp(-age * .32) * r.w * wisp; }\n' +
      ' vec3 refl = reflect(vec3(0., 0., -1.), nrm);\n' +
      ' vec3 sky = mix(vec3(.01, .015, .03), pal(hue) * .25, smoothstep(-.2, .9, refl.y));\n' +
      ' float spec = pow(max(dot(refl, normalize(vec3(-.4, .6, .7))), 0.), 60.);\n' +
      ' vec3 col = vec3(.004, .006, .012) + ink * .9 + sky * .5 + spec * (.7 + kick * .6);\n' +
      ' col *= 1. - dot(p, p) * .5; gl_FragColor = vec4(col, 1.); }');
    if (!g) return water();
    var start = performance.now();
    function drop(now, strength, h) {
      var asp = (glc.width / glc.height) || 1.7, c = hsl(h);
      slots[next] = [(Math.random() - .5) * asp * .85, (Math.random() - .5) * .8, (now - start) / 1000, strength, c[0], c[1], c[2]];
      next = (next + 1) % 8;
    }
    function hsl(h) { var f = function (n) { var k = (n + h / 30) % 12; return .5 - .5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; }
    text('xpTop', 'BLACK MIRROR');
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit);
      if (b.hit && b.k > .25) { drop(now, .6 + b.k * .8, hh); lastDrip = now; }
      else if (now - lastDrip > 2500) { drop(now, .5, hh); lastDrip = now; }
      var R = [], C = [];
      slots.forEach(function (s2) { R.push(s2[0], s2[1], s2[2], s2[3]); C.push(s2[4], s2[5], s2[6]); });
      g.v4a('R', R); g.v3a('RC', C);
      g.draw(now - start, b, hh);
    }, 30);
  }

  // 17. CYBER EYE — giant robotic eye; iris spins and changes colour with the music
  function eye() {
    var b = beatTracker(), hue = beatHue(180, 60), gaze = [0, 0], gazeT = [0, 0], nextGaze = 0, blink = 0, nextBlink = 0, spin = 0, dil = 0, lastSong = '';
    var g = glStart('eye',
      'uniform vec2 gaze; uniform float blink, dilate, spin;\n' +
      'void main(){ vec2 p = (gl_FragCoord.xy - .5 * res) / res.y; vec2 q = p * .78;\n' +
      ' vec3 col = vec3(.025, .03, .04) * (.6 + .5 * noise(p * 60.));\n' +
      ' vec2 cg = p * 9.; vec2 id = floor(cg), f = fract(cg) - .5; float h1 = hash(id);\n' +
      ' float ln = h1 > .5 ? abs(f.x) : abs(f.y); float trace = smoothstep(.035, .0, ln) * step(.35, hash(id + 3.));\n' +
      ' float pulse = .5 + .5 * sin(time * 3. - length(p) * 12.);\n' +
      ' col += pal(hue) * trace * (.08 + .3 * energy * pulse);\n' +
      ' float r0 = length(q), a0 = atan(q.y, q.x);\n' +
      ' float seg = step(.45, fract(a0 / 6.2832 * 36. + spin * .2));\n' +
      ' col += pal(hue + .1) * smoothstep(.008, .0, abs(r0 - .56) - .01) * seg * (.5 + kick);\n' +
      ' col += pal(hue + .2) * smoothstep(.006, .0, abs(r0 - .6) - .003) * .5;\n' +
      ' float lid = .43 * (1. - blink) * sqrt(max(0., 1. - pow(q.x / .98, 2.)));\n' +
      ' float inEye = smoothstep(.005, -.005, abs(q.y) - lid);\n' +
      ' col += pal(hue) * exp(-abs(abs(q.y) - lid) * 90.) * step(abs(q.x), .98) * (.7 + kick * .6);\n' +
      ' vec2 e = q - gaze * vec2(.24, .1); float r = length(e), a = atan(e.y, e.x);\n' +
      ' vec3 ec = vec3(.04, .045, .06) * (1.2 - r);\n' +
      ' ec += pal(hue + .5) * pow(noise(vec2(a * 5., r * 9.)), 8.) * .25;\n' +
      ' float IR = .27; float fib = .5 + .5 * sin(a * 90. + noise(vec2(a * 12., r * 30.)) * 5.);\n' +
      ' vec3 iris = pal(hue + r * .9 - spin * .03) * (.3 + .7 * fib) * (.5 + 1.1 * r / IR);\n' +
      ' iris += pal(hue + .4) * exp(-abs(r - IR * .55) * 70.) * .8;\n' +
      ' float seg2 = step(.5, fract(a / 6.2832 * 12. - spin * .5)); iris += vec3(1.) * smoothstep(.004, .0, abs(r - IR * .8) - .004) * seg2 * .5;\n' +
      ' iris *= smoothstep(IR, IR - .02, r) * (1. + kick * .6);\n' +
      ' ec = mix(ec, iris, smoothstep(IR + .005, IR - .005, r));\n' +
      ' ec *= 1. - .6 * exp(-abs(r - IR) * 60.);\n' +
      ' float PR = .07 + dilate * .07; ec = mix(ec, vec3(0.), smoothstep(PR + .006, PR - .006, r));\n' +
      ' ec += pal(hue + .5) * .3 * exp(-abs(r - PR) * 120.);\n' +
      ' ec += vec3(1.) * smoothstep(.03, .0, length(e - vec2(-.08, .08))) * .9 + vec3(1.) * smoothstep(.012, .0, length(e - vec2(.06, -.05))) * .5;\n' +
      ' col = mix(col, ec, inEye);\n' +
      ' col *= .92 + .08 * sin(gl_FragCoord.y * 1.5); col *= 1. - dot(p, p) * .4;\n' +
      ' gl_FragColor = vec4(col, 1.); }');
    if (!g) return ring();
    text('xpTop', 'CYBER EYE');
    every(function () { try { var np = A && JSON.parse(A.nowPlaying() || '{}'); var s2 = np && np.title ? np.title : ''; if (s2 && s2 !== lastSong) { if (lastSong) blink = 1.0001; lastSong = s2; } } catch (e) {} }, 3000);
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit);
      if (now > nextGaze) { gazeT = [(Math.random() - .5) * 2, (Math.random() - .5) * 1.6]; if (Math.random() < .3) gazeT = [0, 0]; nextGaze = now + 500 + Math.random() * 2500; }
      gaze[0] += (gazeT[0] - gaze[0]) * .3; gaze[1] += (gazeT[1] - gaze[1]) * .3;
      if (now > nextBlink) { blink = 1.0001; nextBlink = now + 3000 + Math.random() * 5000; }
      if (blink > 0) blink = Math.max(0, blink - .14);
      spin += .02 + b.e * .08 + (b.hit ? .6 : 0);
      dil += ((b.k * .9 + b.e * .3) - dil) * .3;
      g.v2('gaze', gaze[0], gaze[1]); g.f('blink', Math.min(1, blink > 1 ? 1 : (blink > .5 ? (1 - blink) * 2 : blink * 2))); g.f('dilate', dil); g.f('spin', spin);
      g.draw(now, b, hh);
    }, 30);
  }

  // 18. PLANET BUILDER — dust forms a planet, rings and moons appear, then it goes supernova on a drop
  function planet2d() {
    var b = beatTracker(), hue = beatHue(30, 35), bg = null, bgW = 0, phase = 'form', t0 = performance.now(), dust = [], blast = [], moons = [], novaAt = 0, spinX = 0;
    function makeBg() {
      bg = document.createElement('canvas'); bg.width = W; bg.height = H; bgW = W; var c = bg.getContext('2d');
      c.fillStyle = '#01010a'; c.fillRect(0, 0, W, H);
      for (var i = 0; i < 6; i++) { var x = Math.random() * W, y = Math.random() * H, r = Math.max(W, H) * (.2 + Math.random() * .3), gg = c.createRadialGradient(x, y, 0, x, y, r);
        gg.addColorStop(0, 'hsla(' + (200 + Math.random() * 140 | 0) + ',80%,40%,.12)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gg; c.fillRect(0, 0, W, H); }
      for (var j = 0; j < 400; j++) { c.fillStyle = 'rgba(255,255,255,' + Math.random() * .8 + ')'; var s2 = Math.random() < .05 ? 2 : 1; c.fillRect(Math.random() * W, Math.random() * H, s2 * S * 1.5, s2 * S * 1.5); }
    }
    function reset(now) {
      phase = 'form'; t0 = now; dust = []; blast = []; moons = [];
      for (var i = 0; i < 500; i++) { var a = Math.random() * 6.283, r = .6 + Math.random() * 1.2; dust.push({ a: a, r: r, ta: Math.random() * 6.283, tr: Math.sqrt(Math.random()) * .98, sp: .3 + Math.random() * .7, hue: Math.random() * 60 }); }
    }
    reset(performance.now());
    text('xpTop', 'PLANET BUILDER');
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit), t = (now - t0) / 1000;
      if (!bg || bgW !== W) makeBg();
      var shake = phase === 'nova' && t < .6 ? (1 - t / .6) * W * .02 : 0;
      cx.drawImage(bg, (Math.random() - .5) * shake, (Math.random() - .5) * shake);
      var cxp = W / 2, cyp = H / 2, R = Math.min(W, H) * .26 * (1 + b.k * .02);
      cx.globalCompositeOperation = 'lighter';
      if (phase === 'form' || phase === 'alive') {
        var built = Math.min(1, Math.max(0, (t - 2.5) / 3));
        // dust spiralling in
        if (built < 1) dust.forEach(function (d) {
          var k = Math.min(1, t / (4 + d.sp * 2)); var e2 = 1 - Math.pow(1 - k, 3);
          var a = d.a + (1 - e2) * 4 + t * .5 * d.sp, r = d.r + (d.tr - d.r) * e2;
          var x = cxp + Math.cos(a) * r * R, y = cyp + Math.sin(a) * r * R * (1 - e2 * 0 + .0) * (.35 + .65 * e2);
          cx.fillStyle = 'hsla(' + ((hh + d.hue) % 360) + ',100%,70%,' + (.7 * (1 - built)) + ')';
          cx.fillRect(x, y, S * 3, S * 3);
        });
        cx.globalCompositeOperation = 'source-over';
        if (built > 0) {
          if (phase === 'form' && built >= 1) phase = 'alive';
          spinX += .004 + b.e * .006;
          var ringsOn = Math.min(1, Math.max(0, (t - 7) / 2.5));
          var tilt = .28;
          function ringPass(back) {
            if (!ringsOn) return;
            for (var k2 = 0; k2 < 26; k2++) {
              var rr = R * (1.45 + k2 * .028) * (.6 + .4 * ringsOn);
              cx.strokeStyle = 'hsla(' + ((hh + 20 + k2 * 3) % 360) + ',70%,' + (55 + (k2 % 3) * 8) + '%,' + (ringsOn * (.12 + (k2 % 4 === 0 ? .15 : .05)) * (1 + b.k * .6)) + ')';
              cx.lineWidth = Math.max(1, R * .02);
              cx.beginPath(); cx.ellipse(cxp, cyp, rr, rr * tilt, -.25, back ? Math.PI : 0, back ? 2 * Math.PI : Math.PI); cx.stroke();
            }
          }
          ringPass(true);
          cx.save(); cx.globalAlpha = built;
          cx.beginPath(); cx.arc(cxp, cyp, R, 0, 6.283); cx.save(); cx.clip();
          var base = cx.createLinearGradient(cxp, cyp - R, cxp, cyp + R);
          base.addColorStop(0, 'hsl(' + hh + ',60%,55%)'); base.addColorStop(1, 'hsl(' + ((hh + 40) % 360) + ',60%,35%)');
          cx.fillStyle = base; cx.fillRect(cxp - R, cyp - R, R * 2, R * 2);
          for (var bnd = 0; bnd < 22; bnd++) {
            var y0 = cyp - R + bnd / 22 * R * 2, hb = R * 2 / 22;
            cx.fillStyle = 'hsla(' + ((hh + (bnd % 5) * 14 - 20 + 360) % 360) + ',' + (50 + (bnd % 3) * 15) + '%,' + (35 + (bnd * 37 % 30)) + '%,.55)';
            cx.beginPath(); cx.moveTo(cxp - R, y0);
            for (var xx = 0; xx <= 24; xx++) { var ux = xx / 24; cx.lineTo(cxp - R + ux * R * 2, y0 + Math.sin(ux * 9 + spinX * 8 + bnd * 1.7) * hb * .35); }
            cx.lineTo(cxp + R, y0 + hb * 1.2); cx.lineTo(cxp - R, y0 + hb * 1.2); cx.closePath(); cx.fill();
          }
          var storm = cx.createRadialGradient(cxp + Math.cos(spinX * 3) * R * .4, cyp + R * .25, 0, cxp + Math.cos(spinX * 3) * R * .4, cyp + R * .25, R * .18);
          storm.addColorStop(0, 'hsla(' + ((hh + 180) % 360) + ',80%,70%,.6)'); storm.addColorStop(1, 'rgba(0,0,0,0)'); cx.fillStyle = storm; cx.fillRect(cxp - R, cyp - R, R * 2, R * 2);
          var shade = cx.createRadialGradient(cxp - R * .45, cyp - R * .45, R * .1, cxp - R * .2, cyp - R * .2, R * 1.6);
          shade.addColorStop(0, 'rgba(255,255,255,.18)'); shade.addColorStop(.45, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.92)');
          cx.fillStyle = shade; cx.fillRect(cxp - R, cyp - R, R * 2, R * 2);
          cx.restore();
          var atm = cx.createRadialGradient(cxp, cyp, R * .95, cxp, cyp, R * 1.18);
          atm.addColorStop(0, 'hsla(' + hh + ',100%,70%,' + (.45 + b.k * .4) + ')'); atm.addColorStop(1, 'hsla(' + hh + ',100%,60%,0)');
          cx.fillStyle = atm; cx.beginPath(); cx.arc(cxp, cyp, R * 1.18, 0, 6.283); cx.fill();
          cx.restore();
          ringPass(false);
          if (t > 11 && moons.length < 1) moons.push({ d: 2.3, s: .5, sz: .13, h: 160, a: 0 });
          if (t > 15 && moons.length < 2) moons.push({ d: 3.0, s: .32, sz: .09, h: 280, a: 2 });
          moons.forEach(function (m) {
            m.a += .01 * m.s * (1 + b.e); var mx = cxp + Math.cos(m.a) * R * m.d, my = cyp + Math.sin(m.a) * R * m.d * .3, front = Math.sin(m.a) > 0, mr = R * m.sz * (front ? 1.08 : .92);
            if (!front && Math.hypot(mx - cxp, (my - cyp) / 1) < R) return;
            var mg = cx.createRadialGradient(mx - mr * .4, my - mr * .4, mr * .1, mx, my, mr);
            mg.addColorStop(0, 'hsl(' + ((hh + m.h) % 360) + ',40%,80%)'); mg.addColorStop(1, 'hsl(' + ((hh + m.h) % 360) + ',50%,12%)');
            cx.fillStyle = mg; cx.beginPath(); cx.arc(mx, my, mr, 0, 6.283); cx.fill();
          });
          if (phase === 'alive' && t > 22 && ((b.hit && b.k > .45) || t > 38)) { phase = 'nova'; t0 = now; novaAt = hh;
            for (var i = 0; i < 420; i++) { var a = Math.random() * 6.283, sp = .3 + Math.random() * 2.2; blast.push({ x: cxp, y: cyp, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, h: (hh + Math.random() * 90) % 360 }); } }
        }
      } else if (phase === 'nova') {
        var k = t / 3.2;
        var core = cx.createRadialGradient(cxp, cyp, 0, cxp, cyp, R * (1.4 - k));
        core.addColorStop(0, 'rgba(255,255,255,' + Math.max(0, 1 - k) + ')'); core.addColorStop(1, 'rgba(255,255,255,0)');
        cx.fillStyle = core; cx.fillRect(0, 0, W, H);
        for (var w = 0; w < 4; w++) {
          var wr = (t - w * .18) * Math.max(W, H) * .5; if (wr <= 0) continue;
          cx.strokeStyle = 'hsla(' + ((novaAt + w * 50) % 360) + ',100%,65%,' + Math.max(0, .8 - k) + ')'; cx.lineWidth = Math.max(2, R * .06 * (1 - k));
          cx.beginPath(); cx.ellipse(cxp, cyp, wr, wr * (.55 + w * .1), 0, 0, 6.283); cx.stroke();
        }
        blast.forEach(function (p2) { p2.x += p2.vx * R * .04; p2.y += p2.vy * R * .04; p2.vx *= .985; p2.vy *= .985;
          cx.strokeStyle = 'hsla(' + p2.h + ',100%,70%,' + Math.max(0, 1 - k) + ')'; cx.lineWidth = Math.max(1, S * 2.5);
          cx.beginPath(); cx.moveTo(p2.x, p2.y); cx.lineTo(p2.x - p2.vx * R * .12, p2.y - p2.vy * R * .12); cx.stroke(); });
        if (t < .25) flash('#fff', .7 * (1 - t / .25));
        if (t > 3.4) reset(now);
      }
      cx.globalCompositeOperation = 'source-over';
    }, 30);
  }

  // 19. NEON SKULL — anatomically shaped human skull in neon lines (sharp orbits, cheekbones, real teeth),
  //     jaw moves to the bass, roaring flames pour out of the eye sockets.
  function skull() {
    var b = beatTracker(), hue = beatHue(140, 70), fire = [], jaw = 0, sprites = {};
    function mirror(pts) { var out = pts.slice(); for (var i = pts.length - 1; i >= 0; i--) if (pts[i][0] !== 0) out.push([-pts[i][0], pts[i][1]]); return out; }
    var CRANIUM = mirror([[-.455, .08], [-.47, .02], [-.49, -.1], [-.49, -.24], [-.46, -.39], [-.4, -.52], [-.3, -.61], [-.17, -.665], [0, -.68]]);
    var ZYGO = [[-.455, .08], [-.475, .14], [-.46, .2], [-.4, .245], [-.33, .265], [-.3, .33], [-.27, .4], [-.235, .44]];
    var ORBIT = [[-.4, .0], [-.36, -.075], [-.27, -.1], [-.15, -.085], [-.075, -.04], [-.065, .05], [-.09, .13], [-.17, .17], [-.29, .165], [-.37, .1]];
    var NASAL = [[0, .1], [-.035, .14], [-.065, .215], [-.06, .27], [-.03, .3], [0, .285], [.03, .3], [.06, .27], [.065, .215], [.035, .14]];
    var TEMPORAL = [[-.42, -.3], [-.38, -.15], [-.38, -.03], [-.41, .05]];
    var MAND = [[-.42, .22], [-.415, .35], [-.4, .47], [-.37, .56], [-.3, .62], [-.17, .68], [-.07, .71], [0, .715]];
    MAND = mirror(MAND);
    function line(pts, X, Y, R, close) { cx.moveTo(X + pts[0][0] * R, Y + pts[0][1] * R); for (var i = 1; i < pts.length; i++) cx.lineTo(X + pts[i][0] * R, Y + pts[i][1] * R); if (close) cx.lineTo(X + pts[0][0] * R, Y + pts[0][1] * R); }
    function flip(pts) { return pts.map(function (q) { return [-q[0], q[1]]; }); }
    function sprite(h) {             // pre-rendered flame blob for each colour (fast)
      var k = Math.round(h / 15) * 15 % 360; if (sprites[k]) return sprites[k];
      var c = document.createElement('canvas'); c.width = c.height = 64; var g2 = c.getContext('2d');
      var gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'hsla(' + k + ',100%,88%,.75)'); gr.addColorStop(.3, 'hsla(' + k + ',100%,62%,.5)'); gr.addColorStop(.65, 'hsla(' + ((k + 20) % 360) + ',100%,42%,.18)'); gr.addColorStop(1, 'hsla(' + k + ',100%,30%,0)');
      g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64); sprites[k] = c; return c;
    }
    function strokeGlow(col, R, draw) {
      cx.lineJoin = 'miter'; cx.lineCap = 'round';
      [[R * .05, .09], [R * .022, .3], [R * .009, 1]].forEach(function (pass, i) {
        cx.strokeStyle = i === 2 ? 'hsla(' + col + ',100%,90%,1)' : 'hsla(' + col + ',100%,58%,' + pass[1] + ')'; cx.lineWidth = Math.max(1, pass[0]);
        cx.beginPath(); draw(); cx.stroke();
      });
    }
    function teeth(X, Y, R, top, y0, y1, count) {
      for (var i = 0; i < count; i++) {
        var u = (i + .5) / count - .5, x = X + u * R * .4, w = R * .4 / count * .82, curve = Math.abs(u) * R * .05;
        var tall = (Math.abs(u) < .12 ? 1 : .85);
        var a = Y + (top ? y0 : y0) * R + curve, d = (y1 - y0) * R * tall;
        cx.moveTo(x - w / 2, a); cx.lineTo(x - w / 2, a + (top ? d : -d) * .85); cx.quadraticCurveTo(x, a + (top ? d : -d) * 1.05, x + w / 2, a + (top ? d : -d) * .85); cx.lineTo(x + w / 2, a);
      }
    }
    text('xpTop', 'NEON SKULL');
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit);
      jaw += ((b.k * .1 + b.e * .02) - jaw) * .45;
      cx.fillStyle = 'rgba(0,0,6,.55)'; cx.fillRect(0, 0, W, H);
      var R = H * .6 * (1 + b.k * .035), X = W / 2 + Math.sin(now * .0007) * W * .015, Y = H * .45;
      cx.save(); cx.translate(X, Y); cx.rotate(Math.sin(now * .0009) * .04); cx.translate(-X, -Y);
      // solid dark bone so it reads as a real skull
      var bone = cx.createRadialGradient(X - R * .1, Y - R * .3, R * .05, X, Y, R * .8);
      bone.addColorStop(0, 'hsla(' + hh + ',40%,14%,.95)'); bone.addColorStop(1, 'hsla(' + hh + ',50%,4%,.95)');
      cx.fillStyle = bone; cx.beginPath(); line(CRANIUM.concat([[.455, .08], [.46, .2], [.33, .265], [.235, .44], [-.235, .44], [-.33, .265], [-.46, .2]]), X, Y, R, true); cx.fill();
      cx.beginPath(); line(MAND, X, Y + jaw * R, R, true); cx.fill();
      cx.fillStyle = '#000';
      [ORBIT, flip(ORBIT)].forEach(function (o) { cx.beginPath(); line(o, X, Y, R, true); cx.fill(); });
      cx.beginPath(); line(NASAL, X, Y, R, true); cx.fill();
      cx.globalCompositeOperation = 'lighter';
      // eye fire
      [-1, 1].forEach(function (sd) {
        var ex = X + sd * .22 * R, ey = Y + .04 * R;
        var gl3 = cx.createRadialGradient(ex, ey, 0, ex, ey, R * .14);
        gl3.addColorStop(0, 'hsla(' + ((hh + 180) % 360) + ',100%,75%,' + (.6 + p * .4) + ')'); gl3.addColorStop(1, 'hsla(' + ((hh + 180) % 360) + ',100%,50%,0)');
        cx.fillStyle = gl3; cx.fillRect(ex - R * .16, ey - R * .16, R * .32, R * .32);
        var n = 3 + (b.e * 4 | 0) + (b.hit ? 9 : 0);
        for (var f = 0; f < n; f++) fire.push({ x: ex + (Math.random() - .5) * R * .16, y: ey + (Math.random() - .2) * R * .08, vx: (Math.random() - .5) * R * .004, vy: -(R * (.006 + Math.random() * .01) * (1 + b.k * 1.4)), life: 1, s: R * (.03 + Math.random() * .035), h: (hh + 180 + (Math.random() - .5) * 50 + 360) % 360, ph: Math.random() * 6 });
      });
      fire = fire.filter(function (q) { q.x += q.vx + Math.sin(now * .008 + q.ph) * R * .0025; q.y += q.vy; q.vy *= .985; q.life -= .028; q.s *= .975; return q.life > 0; });
      if (fire.length > 420) fire.splice(0, fire.length - 420);
      fire.forEach(function (q) { cx.globalAlpha = Math.min(1, q.life) * .55; var sz = q.s * (1.3 - q.life * .5); cx.drawImage(sprite(q.life > .7 ? q.h : (q.h + 25) % 360), q.x - sz, q.y - sz * 1.3, sz * 2, sz * 2.6); });
      cx.globalAlpha = 1;
      // skull linework
      strokeGlow(hh, R, function () { line(CRANIUM, X, Y, R, false); line(ZYGO, X, Y, R, false); line(flip(ZYGO), X, Y, R, false); });
      strokeGlow(hh, R, function () { line(ORBIT, X, Y, R, true); line(flip(ORBIT), X, Y, R, true); line(NASAL, X, Y, R, true); });
      strokeGlow((hh + 25) % 360, R, function () {
        line(TEMPORAL, X, Y, R, false); line(flip(TEMPORAL), X, Y, R, false);
        line([[-.36, -.11], [-.2, -.135], [-.07, -.1]], X, Y, R, false); line([[.36, -.11], [.2, -.135], [.07, -.1]], X, Y, R, false);   // brow ridges
        line([[-.3, .2], [-.2, .235], [-.08, .3]], X, Y, R, false); line([[.3, .2], [.2, .235], [.08, .3]], X, Y, R, false);            // cheek lines
        line([[0, -.68], [.03, -.5], [-.02, -.36], [.04, -.24]], X, Y, R, false);                                                     // crack
        line([[0, .285], [0, .34]], X, Y, R, false);
      });
      strokeGlow(hh, R, function () { line([[-.235, .44], [.235, .44]], X, Y, R, false); teeth(X, Y, R, true, .44, .53, 10); });
      var JY = Y + jaw * R;
      strokeGlow((hh + 15) % 360, R, function () {
        line(MAND, X, JY, R, false); line([[-.22, .58], [.22, .58]], X, JY, R, false); teeth(X, JY, R, false, .58, .5, 10);
        line([[-.33, .44], [-.25, .58]], X, JY, R, false); line([[.33, .44], [.25, .58]], X, JY, R, false);
      });
      cx.restore();
      cx.globalCompositeOperation = 'source-over';
      if (b.hit && b.k > .55) flash('hsl(' + hh + ',100%,55%)', .1);
    }, 30);
  }

  // ==================================================================
  // WEBCAM WALL — nine live cameras from around the world, security-room style
  // ==================================================================
  var imgCbs = {}, imgSeq = 0;
  Nexus._img = function (id, data) { var cb = imgCbs[id]; delete imgCbs[id]; if (cb) cb(data); };
  function loadImg(url, cb) {
    var bust = url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / 30000);
    if (A && A.fetchImage) { var id = 'i' + (++imgSeq); imgCbs[id] = cb; A.fetchImage(id, bust, 'https://www.skylinewebcams.com/'); }
    else { var im = new Image(); im.onload = function () { cb(bust); }; im.onerror = function () { cb(''); }; im.src = bust; }
  }
  var CAMS = [
    ['TOKYO · SHIBUYA', 1825, 'japan/kanto/tokyo/tokyo-shibuya-scramble-crossing', 'Asia/Tokyo'],
    ['TOKYO · KABUKICHO', 2999, 'japan/kanto/tokyo/shinjuku-kabukicho', 'Asia/Tokyo'],
    ['LAS VEGAS · FREMONT ST', 5925, 'united-states/nevada/las-vegas/fremont-street', 'America/Los_Angeles'],
    ['LOS ANGELES · VENICE BEACH', 2806, 'united-states/california/los-angeles/venice-beach', 'America/Los_Angeles'],
    ['HOLLYWOOD BLVD', 6233, 'united-states/california/los-angeles/hollywood-boulevard', 'America/Los_Angeles'],
    ['ST. MAARTEN · MAHO BEACH', 4682, 'sint-maarten/saint-martin/simpson-bay/maho-beach', 'America/Lower_Princes'],
    ['FINLAND · NORTHERN LIGHTS', 5226, 'finland/lapland/rovaniemi/northern-lights', 'Europe/Helsinki'],
    ['ICELAND · NORTHERN LIGHTS', 2698, 'iceland/sueurland/blaskogabygge/apavatn-northern-lights', 'Atlantic/Reykjavik'],
    ['HAWAII · KILAUEA VOLCANO', 3842, 'united-states/hawaii/pahoa/kilauea-volcano', 'Pacific/Honolulu'],
    ['MEXICO · POPOCATEPETL VOLCANO', 5827, 'mexico/puebla/san-pedro-benito-juarez/popocatepetl', 'America/Mexico_City'],
    ['KENYA · MASAI MARA', 4905, 'kenya/rift-valley-province/nakuru/masai-mara', 'Africa/Nairobi'],
    ['JAPAN · MOUNT FUJI', 1871, 'japan/yamanashi-prefecture/fujikawaguchiko/mount-fuji', 'Asia/Tokyo'],
    ['TOKYO TOWER', 1855, 'japan/kanto/tokyo/tokyo-tower', 'Asia/Tokyo'],
    ['SEOUL · HONGDAE', 5817, 'south-korea/seoul-capital/seoul/hongdae', 'Asia/Seoul'],
    ['BANGKOK · SUKHUMVIT', 5185, 'thailand/central-thailand/bangkok/sukhumvit', 'Asia/Bangkok'],
    ['DUBLIN · TEMPLE BAR', 4883, 'ireland/leinster/dublin/temple-bar', 'Europe/Dublin'],
    ['LONDON · ABBEY ROAD', 1207, 'united-kingdom/england/london/london-abbey-road', 'Europe/London'],
    ['RIO · COPACABANA', 604, 'brasil/rio-de-janeiro/rio-de-janeiro/copacabana-beach', 'America/Sao_Paulo'],
    ['MIAMI · COLLINS AVE', 5499, 'united-states/florida/miami/collins-avenue', 'America/New_York'],
    ['NEW YORK · MANHATTAN', 545, 'united-states/new-york/new-york/new-york-manhattan', 'America/New_York'],
    ['TEXAS · SPACEX STARSHIP', 2286, 'united-states/texas/south-padre-island/spacex-starship-launch-facility', 'America/Chicago'],
    ['VANCOUVER', 5590, 'canada/british-columbia/vancouver/panorama', 'America/Vancouver'],
    ['CALGARY', 2063, 'canada/alberta/calgary/calgary-skyline', 'America/Edmonton'],
    ['REVELSTOKE · RAILWAY', 2372, 'canada/british-columbia/revelstoke/railfan', 'America/Vancouver'],
    ['TOFINO · LONG BEACH', 2402, 'canada/british-columbia/tofino/long-beach', 'America/Vancouver'],
    ['SYDNEY', 4885, 'australia/new-south-wales/sydney/panorama', 'Australia/Sydney'],
    ['AMSTERDAM · DAM SQUARE', 1794, 'netherlands/north-holland/amsterdam/amsterdam-dam-square', 'Europe/Amsterdam'],
    ['VATICAN · ST. PETER\'S', 1814, 'citta-del-vaticano/citta-del-vaticano/citta-del-vaticano/vaticano-piazza-san-pietro', 'Europe/Rome'],
    ['ISTANBUL · GOLDEN HORN', 5209, 'turkey/marmara/istanbul/golden-horn', 'Europe/Istanbul'],
    ['OSAKA · SHINSAIBASHI', 5964, 'japan/kansai/osaka/shinsaibashi', 'Asia/Tokyo'],
    ['SINGAPORE', 1263, 'republic-of-singapore/singapore/singapore/singapore', 'Asia/Singapore'],
    ['CHICAGO · SKYDECK', 5104, 'united-states/illinois/chicago/skydeck', 'America/Chicago']
  ];
  function camTime(tz) { try { return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }); } catch (e) { return ''; } }
  function webcams() {
    cv.style.visibility = 'hidden';
    var wrap = document.createElement('div'); wrap.id = 'camwall'; layer.appendChild(wrap);
    xpDom.push(wrap);
    var pick = [];
    function shuffle() { var pool = CAMS.slice(); pick = []; while (pick.length < 9) pick.push(pool.splice(Math.random() * pool.length | 0, 1)[0]); }
    function tileHtml(c, i) {
      return '<div class="cam" data-i="' + i + '"><div class="camimg"></div><div class="camlost">SIGNAL LOST</div>' +
        '<div class="camlab"><span class="rec">●</span> CAM ' + ('0' + (i + 1)).slice(-2) + ' · ' + c[0] + '</div><div class="camtime"></div></div>';
    }
    function setImg(el, data) {
      var im = el.querySelector('.camimg'), lost = el.querySelector('.camlost');
      if (data) { im.style.backgroundImage = 'url("' + data + '")'; im.style.opacity = 1; lost.style.display = 'none'; }
      else if (!im.style.backgroundImage) lost.style.display = 'flex';
    }
    function refreshWall() {
      Array.prototype.forEach.call(wrap.querySelectorAll('.cam'), function (el) {
        var c = pick[+el.getAttribute('data-i')];
        loadImg('https://cdn.skylinewebcams.com/live' + c[1] + '.jpg', function (d) { if (el.parentNode) setImg(el, d); });
      });
    }
    function tickTimes() { Array.prototype.forEach.call(wrap.querySelectorAll('.cam'), function (el) { var c = pick[+el.getAttribute('data-i')]; if (c) el.querySelector('.camtime').textContent = camTime(c[3]); }); var big = wrap.querySelector('.bigtime'); if (big && wrap.bigCam) big.textContent = camTime(wrap.bigCam[3]); }
    function showWall() {
      wrap.bigCam = null;
      wrap.innerHTML = '<div class="camgrid">' + pick.map(tileHtml).join('') + '</div>' +
        '<div class="cambar"><span class="cambtn" id="camShuffle">⟳ NEW CAMERAS</span><span class="camnote">TAP A CAMERA TO GO FULL SCREEN</span></div>';
      Array.prototype.forEach.call(wrap.querySelectorAll('.cam'), function (el) { el.onclick = function (e) { e.stopPropagation(); showOne(pick[+el.getAttribute('data-i')]); }; });
      $('camShuffle').onclick = function (e) { e.stopPropagation(); shuffle(); showWall(); };
      refreshWall(); tickTimes();
    }
    function showOne(c) {
      wrap.bigCam = c;
      wrap.innerHTML = '<div class="cambig"><div class="camimg"></div><div class="camlost">CONNECTING…</div>' +
        '<div class="camlab big"><span class="rec">●</span> LIVE · ' + c[0] + ' · <span class="bigtime"></span></div></div>' +
        '<div class="cambar"><span class="cambtn" id="camBack">◀ ALL CAMERAS</span><span class="cambtn go" id="camLive">▶ LIVE VIDEO</span></div>';
      var el = wrap.querySelector('.cambig');
      function load() { loadImg('https://cdn.skylinewebcams.com/live' + c[1] + '.jpg', function (d) { if (el.parentNode) setImg(el, d); }); }
      load(); wrap.bigTimer = load;
      $('camBack').onclick = function (e) { e.stopPropagation(); showWall(); };
      $('camLive').onclick = function (e) { e.stopPropagation(); var ok = A && A.openUrl && A.openUrl('https://www.skylinewebcams.com/en/webcam/' + c[2] + '.html'); if (!ok) { try { A && A.toast('No web browser on the box to play live video'); } catch (er) {} } };
      tickTimes();
    }
    shuffle(); showWall();
    text('xpTop', 'NEXUS SURVEILLANCE NETWORK · LIVE FEEDS');
    every(function () { if (wrap.bigCam) { if (wrap.bigTimer) wrap.bigTimer(); } }, 6000);
    every(function () { if (!wrap.bigCam) refreshWall(); }, 45000);
    every(tickTimes, 15000);
  }


  // ==================================================================
  // HIGH-END PACK: 7 graphics-chip visuals + 3 particle visuals
  // ==================================================================
  var FBM3 = 'float fbm3(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07 + vec2(3.1, 1.7); a *= .5; } return v; }\n';

  // 20. ALIEN WORLDS — fly low over glowing alien mountains with neon contour lines
  function worlds() {
    var b = beatTracker(), hue = beatHue(280, 40), fly = 0;
    var g = glStart('worlds', FBM3 +
      'uniform float fly;\n' +
      'float ht(vec2 p){ float m = fbm3(p * .22); return m * m * 9. + fbm3(p * 1.1 + 4.) * .5; }\n' +
      'void main(){ vec2 uv = (gl_FragCoord.xy - .5 * res) / res.y;\n' +
      ' vec3 ro = vec3(sin(fly * .05) * 3., 4.4, fly); vec3 rd = normalize(vec3(uv.x, uv.y - .28, 1.1));\n' +
      ' float c = cos(sin(fly * .05) * .25), s = sin(sin(fly * .05) * .25); rd.xz = mat2(c, -s, s, c) * rd.xz;\n' +
      ' vec3 sunD = normalize(vec3(0., .18, 1.));\n' +
      ' vec3 sky = mix(pal(hue + .55) * .28, vec3(.01, .0, .03), smoothstep(-.02, .45, rd.y));\n' +
      ' sky += pal(hue) * pow(max(dot(rd, sunD), 0.), 30.) * 1.6 + pal(hue + .1) * pow(max(dot(rd, sunD), 0.), 4.) * .3;\n' +
      ' vec2 sp = rd.xy / max(rd.z, .1) * 120.; sky += vec3(1.) * step(.995, hash(floor(sp))) * smoothstep(.0, .3, rd.y);\n' +
      ' float t = .5; bool hit = false; vec3 p;\n' +
      ' for (int i = 0; i < 60; i++) { p = ro + rd * t; float d = p.y - ht(p.xz); if (d < .004 * t) { hit = true; break; } t += max(d * .65, .03); if (t > 60.) break; }\n' +
      ' if (!hit && rd.y < .02) hit = true;\n' +
      ' vec3 col = sky;\n' +
      ' if (hit) { vec2 e = vec2(.08, 0.); vec3 n = normalize(vec3(ht(p.xz - e.xy) - ht(p.xz + e.xy), 2. * e.x, ht(p.xz - e.yx) - ht(p.xz + e.yx)));\n' +
      '  float dif = max(dot(n, sunD), 0.);\n' +
      '  col = vec3(.02, .01, .04) + pal(hue + .6) * .08 * dif;\n' +
      '  float cl = smoothstep(.06, .0, .5 - abs(fract(p.y * 2.2 - fly * .02) - .5)) + .35 * smoothstep(.03, .0, .5 - abs(fract(p.x * .8) - .5));\n' +
      '  col += pal(hue + p.y * .08) * cl * (1. + kick * 1.4);\n' +
      '  col = mix(pal(hue + .55) * .1, col, exp(-t * .035)); }\n' +
      ' col = pow(col, vec3(.9)); gl_FragColor = vec4(col, 1.); }');
    if (!g) return synth();
    text('xpTop', 'ALIEN WORLDS');
    loop(function (now) { b.tick(now); var hh = hue.tick(b.hit); fly += .08 + b.e * .1 + b.k * .08; g.f('fly', fly); g.draw(now, b, hh); }, 30);
  }

  // 21. LIQUID GOLD — molten metal rippling in slow motion; bass sends waves through it
  function gold() {
    var b = beatTracker(), hue = beatHue(40, 45), waves = [], next = 0, start = performance.now(), mode = 0;
    for (var i = 0; i < 6; i++) waves.push([0, 0, -99, 0]);
    var g = glStart('gold', FBM3 +
      'uniform vec4 Wv[6]; uniform float metal;\n' +
      'float hgt(vec2 p){ float h = fbm3(p * 1.6 + vec2(time * .05, -time * .04) + fbm3(p * 1.2 - time * .03) * 1.4) * .35;\n' +
      ' for (int i = 0; i < 6; i++) { float age = time - Wv[i].z; if (age < 0. || age > 5.) continue; float d = length(p - Wv[i].xy);\n' +
      '  h += sin((d - age * .5) * 26.) * exp(-abs(d - age * .5) * 6.) * exp(-age * .7) * Wv[i].w * .05; } return h; }\n' +
      'vec3 env(vec3 r){ float b1 = pow(.5 + .5 * sin(r.y * 7. + r.x * 2.5), 10.), b2 = pow(.5 + .5 * sin(r.x * 5. - r.y * 3. + 1.), 14.);\n' +
      ' return vec3(.04) + vec3(1.) * (b1 * 1.2 + b2 * .7) + vec3(.25) * smoothstep(-.2, 1., r.y); }\n' +
      'void main(){ vec2 p = (gl_FragCoord.xy - .5 * res) / res.y; vec2 e = vec2(.004, 0.);\n' +
      ' float hx = hgt(p + e.xy) - hgt(p - e.xy), hy = hgt(p + e.yx) - hgt(p - e.yx);\n' +
      ' vec3 n = normalize(vec3(-hx, -hy, e.x * 2.)); vec3 r = reflect(vec3(0., 0., -1.), n);\n' +
      ' vec3 tint = metal < .5 ? vec3(1., .74, .32) : (metal < 1.5 ? vec3(.92, .95, 1.) : pal(hue) * 1.2);\n' +
      ' vec3 col = tint * env(r) * 1.1;\n' +
      ' col += tint * pow(max(dot(r, normalize(vec3(-.3, .5, .8))), 0.), 50.) * 1.5;\n' +
      ' col *= .85 + kick * .25; col *= 1. - dot(p, p) * .35;\n' +
      ' gl_FragColor = vec4(col, 1.); }');
    if (!g) return water();
    text('xpTop', 'LIQUID METAL');
    layer.onclick = function () { mode = (mode + 1) % 3; text('xpTop', ['LIQUID GOLD', 'LIQUID CHROME', 'LIQUID NEON'][mode]); };
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit);
      if (b.hit && b.k > .2) { var asp = glc.width / glc.height; waves[next] = [(Math.random() - .5) * asp * .8, (Math.random() - .5) * .7, (now - start) / 1000, .6 + b.k]; next = (next + 1) % 6; }
      var Wv = []; waves.forEach(function (w) { Wv.push(w[0], w[1], w[2], w[3]); });
      g.v4a('Wv', Wv); g.f('metal', mode); g.draw(now - start, b, hh);
    }, 30);
  }

  // 22. AURORA TUNNEL — drift forward through silky curtains of light
  function auroratunnel() {
    var b = beatTracker(), hue = beatHue(150, 50), z = 0;
    var g = glStart('auroratunnel', FBM3 +
      'uniform float travel;\n' +
      'void main(){ vec2 p = (gl_FragCoord.xy - .5 * res) / res.y; float r = length(p), a = atan(p.y, p.x);\n' +
      ' float d = .45 / max(r, .02) + travel;\n' +
      ' vec3 col = vec3(.0, .005, .02);\n' +
      ' for (int L = 0; L < 3; L++) { float fl = float(L);\n' +
      '  float cur = fbm3(vec2(a * 2.2 + fl * 1.7 + sin(d * .3 + fl) * .6, d * .45 - time * .05));\n' +
      '  float sheet = pow(smoothstep(.22, .72, cur), 1.6) * (.55 + .45 * sin(a * 9. + d * 2. + fl));\n' +
      '  col += pal(hue + fl * .14 + d * .02) * sheet * 1.25; }\n' +
      ' col *= smoothstep(.02, .3, r) * (1. + kick * .5);\n' +
      ' col += pal(hue + .3) * exp(-r * 9.) * .4;\n' +
      ' vec2 sp = vec2(a * 70., d * 14.); col += vec3(.8) * step(.997, hash(floor(sp))) * smoothstep(.15, .5, r) * smoothstep(.45, .2, length(fract(sp) - .5));\n' +
      ' gl_FragColor = vec4(col, 1.); }');
    if (!g) return hyper();
    text('xpTop', 'AURORA TUNNEL');
    loop(function (now) { b.tick(now); var hh = hue.tick(b.hit); z += .012 + b.e * .02; g.f('travel', z); g.draw(now, b, hh); }, 30);
  }

  // 23. INK IN WATER — clouds of coloured ink burst and swirl; every drop lands on a beat
  function ink() {
    var b = beatTracker(), hue = beatHue(330, 80), slots = [], next = 0, start = performance.now(), last = 0;
    for (var i = 0; i < 8; i++) slots.push([0, 0, -99, 0, 0, 0, 0]);
    var g = glStart('ink', FBM3 +
      'uniform vec4 R[8]; uniform vec3 RC[8];\n' +
      'void main(){ vec2 p = (gl_FragCoord.xy - .5 * res) / res.y;\n' +
      ' vec3 col = mix(vec3(.01, .02, .04), vec3(.03, .05, .09), gl_FragCoord.y / res.y);\n' +
      ' vec3 ink = vec3(0.); float dens = 0.;\n' +
      ' for (int i = 0; i < 8; i++) { float age = time - R[i].z; if (age < 0. || age > 14.) continue;\n' +
      '  vec2 q = p - R[i].xy; q.y += age * .03;\n' +
      '  vec2 w = vec2(fbm3(q * 3. + vec2(age * .15, float(i))), fbm3(q * 3. - vec2(float(i), age * .12))) - .5;\n' +
      '  q += w * (.15 + age * .06);\n' +
      '  float spread = .07 + age * .07; float k = exp(-dot(q, q) / (spread * spread)) * exp(-age * .13) * R[i].w * 1.6;\n' +
      '  float fil = .6 + .8 * fbm3(q * 14. + age * .2);\n' +
      '  ink += RC[i] * k * fil; dens += k * fil; }\n' +
      ' col = mix(col, ink / max(dens, .001) * 1.15, clamp(dens * 1.4, 0., 1.) * .95) + ink * .2;\n' +
      ' col *= 1. - dot(p, p) * .3; gl_FragColor = vec4(col, 1.); }');
    if (!g) return mirror();
    function hsl(h) { var f = function (n) { var k = (n + h / 30) % 12; return .5 - .5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; }
    function drop(now, s2, h) { var asp = glc.width / glc.height, c = hsl(h); slots[next] = [(Math.random() - .5) * asp * .75, (Math.random() - .5) * .6 + .1, (now - start) / 1000, s2, c[0], c[1], c[2]]; next = (next + 1) % 8; last = now; }
    text('xpTop', 'INK IN WATER');
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit);
      if (b.hit && b.k > .3 && now - last > 450) drop(now, 1, hh); else if (now - last > 1600) drop(now, .9, hh);
      var Rr = [], C = []; slots.forEach(function (s3) { Rr.push(s3[0], s3[1], s3[2], s3[3]); C.push(s3[4], s3[5], s3[6]); });
      g.v4a('R', Rr); g.v3a('RC', C); g.draw(now - start, b, hh);
    }, 30);
  }

  // 24. CRYSTAL GEOMETRY — rotating diamonds refract rainbow light; they split apart on the drop
  function crystal() {
    var b = beatTracker(), hue = beatHue(200, 60), spin = 0, split = 0;
    var g = glStart('crystal',
      'uniform float spin, split;\n' +
      'mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }\n' +
      'float octa(vec3 p, float s){ p = abs(p); return (p.x + p.y + p.z - s) * .577; }\n' +
      'float sdf(vec3 p){ vec3 q = p; q.xz = rot(spin) * q.xz; q.xy = rot(spin * .7) * q.xy;\n' +
      ' float d = octa(q, .55);\n' +
      ' for (int i = 0; i < 4; i++) { float a = float(i) * 1.5708 + spin * .5; vec3 o = vec3(cos(a), sin(a * 1.3) * .4, sin(a)) * (.95 + split * .9);\n' +
      '  vec3 r = p - o; r.xy = rot(spin * 1.3 + float(i)) * r.xy; d = min(d, octa(r, .22)); }\n' +
      ' return d; }\n' +
      'void main(){ vec2 uv = (gl_FragCoord.xy - .5 * res) / res.y; vec3 ro = vec3(0., 0., -3.2), rd = normalize(vec3(uv, 1.6));\n' +
      ' vec3 col = vec3(.005, .005, .02) + pal(hue + .6) * .06 * (1. - length(uv));\n' +
      ' float t = 0.; bool hit = false;\n' +
      ' for (int i = 0; i < 56; i++) { float d = sdf(ro + rd * t); if (d < .001) { hit = true; break; } t += d; if (t > 8.) break; }\n' +
      ' if (hit) { vec3 p = ro + rd * t; vec2 e = vec2(.002, 0.);\n' +
      '  vec3 n = normalize(vec3(sdf(p + e.xyy) - sdf(p - e.xyy), sdf(p + e.yxy) - sdf(p - e.yxy), sdf(p + e.yyx) - sdf(p - e.yyx)));\n' +
      '  float fr = pow(1. - abs(dot(n, rd)), 2.);\n' +
      '  vec3 rf = refract(rd, n, .7);\n' +
      '  col = pal(hue + rf.x * .6 + rf.y * .4 + dot(n, vec3(.3, .5, .2))) * (.25 + .75 * fr) * 1.3;\n' +
      '  col += vec3(1.) * pow(max(dot(reflect(rd, n), normalize(vec3(.4, .6, -.6))), 0.), 40.) * 1.5;\n' +
      '  col += pal(hue + .5) * kick * .4; }\n' +
      ' col += pal(hue) * .15 / (1. + length(uv) * 6.) * (1. + kick);\n' +
      ' gl_FragColor = vec4(col, 1.); }');
    if (!g) return kaleido();
    text('xpTop', 'CRYSTAL GEOMETRY');
    loop(function (now) {
      b.tick(now); var hh = hue.tick(b.hit);
      spin += .008 + b.e * .02; split += ((b.k > .55 ? 1 : 0) - split) * (b.k > .55 ? .3 : .04);
      g.f('spin', spin); g.f('split', split); g.draw(now, b, hh);
    }, 30);
  }

  // 25. BLACK HOLE — light bends around it, a glowing disk spins, stars get pulled in
  function blackhole() {
    var b = beatTracker(), hue = beatHue(25, 30);
    var g = glStart('blackhole', FBM3 +
      'void main(){ vec2 p = (gl_FragCoord.xy - .5 * res) / res.y; float r = length(p); vec2 dir = p / max(r, .0001);\n' +
      ' float rs = .1 * (1. + kick * .06);\n' +
      ' vec2 q = p - dir * (rs * rs * 2.2) / max(r, rs * .9);\n' +
      ' float ang = atan(q.y, q.x) + time * .02;\n' +
      ' vec3 col = pal(hue + .6) * pow(fbm3(q * 3. + 2.), 3.) * .5 + pal(hue + .2) * pow(fbm3(q * 6. - 1.), 4.) * .3;\n' +
      ' vec2 sq = q * 140.; col += vec3(1.) * step(.993, hash(floor(sq))) * (1. + 2. * smoothstep(.5, .1, r));\n' +
      ' vec2 dk = vec2(p.x, p.y / .22); float dr = length(dk) / rs; float da = atan(dk.y, dk.x);\n' +
      ' float diskMask = smoothstep(1.6, 2., dr) * smoothstep(5.5, 3.2, dr);\n' +
      ' float swirl = fbm3(vec2(da * 3. - time * 1.6 + 6. / dr, dr * 1.6));\n' +
      ' float dop = 1. + .75 * (p.x / max(length(dk), .001)) * sign(1.);\n' +
      ' vec3 disk = mix(pal(hue), vec3(1., .9, .7), smoothstep(3.5, 1.8, dr)) * (.4 + 1.4 * swirl) * dop * (1. + kick * .8);\n' +
      ' float front = step(0., -p.y);\n' +
      ' float arcR = r / rs; float arc = exp(-abs(arcR - 1.55) * 9.) * smoothstep(-.02, .06, p.y) * (.6 + .6 * fbm3(vec2(atan(p.y, p.x) * 4. - time, 1.)));\n' +
      ' vec3 arcCol = mix(pal(hue), vec3(1., .85, .6), .5) * arc * 1.6;\n' +
      ' if (r < rs) col = vec3(0.);\n' +
      ' col += arcCol * step(rs, r);\n' +
      ' col = mix(col, disk, diskMask * (front + (1. - front) * step(rs * 1.05, r)) * .95);\n' +
      ' col += vec3(1., .85, .6) * exp(-abs(r - rs * 1.02) * 160.) * 1.2;\n' +
      ' gl_FragColor = vec4(col, 1.); }');
    if (!g) return zoom();
    text('xpTop', 'BLACK HOLE');
    loop(function (now) { b.tick(now); var hh = hue.tick(b.hit); g.draw(now, b, hh); }, 30);
  }

  // 26. LAVA LAMP 3D — big glossy blobs rise, merge and split
  function lava() {
    var b = beatTracker(), hue = beatHue(10, 35), pulse = 0;
    var g = glStart('lava',
      'uniform float pulse;\n' +
      'float field(vec2 p){ float f = 0.;\n' +
      ' for (int i = 0; i < 8; i++) { float fi = float(i);\n' +
      '  vec2 c = vec2(sin(time * (.13 + fi * .021) + fi * 2.1) * .65, sin(time * (.09 + fi * .017) + fi * 1.3) * .42);\n' +
      '  float rr = .11 + .05 * sin(fi * 1.7) + pulse * .03; f += rr * rr / max(dot(p - c, p - c), .0001); }\n' +
      ' return f; }\n' +
      'void main(){ vec2 p = (gl_FragCoord.xy - .5 * res) / res.y; float f = field(p);\n' +
      ' vec3 col = mix(vec3(.02, .0, .03), pal(hue + .5) * .12, gl_FragCoord.y / res.y);\n' +
      ' if (f > 1.) { vec2 e = vec2(.003, 0.);\n' +
      '  vec3 n = normalize(vec3(field(p - e.xy) - field(p + e.xy), field(p - e.yx) - field(p + e.yx), .25 * f));\n' +
      '  vec3 L = normalize(vec3(-.5, .6, .8));\n' +
      '  vec3 base = pal(hue + p.y * .25);\n' +
      '  col = base * (.25 + .9 * max(dot(n, L), 0.)) + vec3(1.) * pow(max(dot(reflect(-L, n), vec3(0., 0., 1.)), 0.), 40.) * .9;\n' +
      '  col += pal(hue + .1) * pow(1. - n.z, 2.) * .6; }\n' +
      ' else col += pal(hue) * .5 * smoothstep(.55, 1., f);\n' +
      ' col += vec3(1.) * .05 * smoothstep(.9, 1., 1. - abs(p.x + .55)) ;\n' +
      ' gl_FragColor = vec4(col, 1.); }');
    if (!g) return water();
    text('xpTop', 'LAVA LAMP');
    loop(function (now) { b.tick(now); var hh = hue.tick(b.hit); pulse += (b.k - pulse) * .2; g.f('pulse', pulse); g.draw(now, b, hh); }, 30);
  }

  // 27. NEURAL NETWORK — a giant web of light nodes; thoughts fire through it to the music
  function neural() {
    var b = beatTracker(), hue = beatHue(190, 50), nodes = [], edges = [], pulses = [], rotA = 0;
    for (var i = 0; i < 140; i++) { var u = Math.random() * 6.283, v = Math.acos(2 * Math.random() - 1), rr = .6 + Math.random() * .45;
      nodes.push([Math.sin(v) * Math.cos(u) * rr, Math.cos(v) * rr * .8, Math.sin(v) * Math.sin(u) * rr, Math.random()]); }
    nodes.forEach(function (a2, i) { var ds = nodes.map(function (b2, j) { return [Math.hypot(a2[0] - b2[0], a2[1] - b2[1], a2[2] - b2[2]), j]; }).sort(function (x, y) { return x[0] - y[0]; });
      for (var k = 1; k <= 3; k++) if (ds[k][1] > i) edges.push([i, ds[k][1]]); });
    var adj = nodes.map(function () { return []; }); edges.forEach(function (e, k) { adj[e[0]].push([e[1], k]); adj[e[1]].push([e[0], k]); });
    function fireFrom(n, depth) { adj[n].forEach(function (x) { if (Math.random() < .8) pulses.push({ a: n, b: x[0], t: 0, sp: .03 + Math.random() * .03, depth: depth }); }); }
    text('xpTop', 'NEURAL NETWORK');
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit);
      rotA += .002 + b.e * .006;
      if (b.hit) for (var f = 0; f < 3; f++) fireFrom(Math.random() * nodes.length | 0, 4);
      if (Math.random() < .08) fireFrom(Math.random() * nodes.length | 0, 2);
      cx.fillStyle = 'rgba(0,1,8,.45)'; cx.fillRect(0, 0, W, H);
      var cxp = W / 2, cyp = H / 2, R = Math.min(W, H) * .55, c = Math.cos(rotA), s2 = Math.sin(rotA);
      var P = nodes.map(function (n) { var x = n[0] * c + n[2] * s2, z = -n[0] * s2 + n[2] * c, f2 = 2.6 / (2.6 + z); return [cxp + x * R * f2 * 1.3, cyp + n[1] * R * f2, z]; });
      cx.globalCompositeOperation = 'lighter';
      cx.strokeStyle = 'hsla(' + hh + ',80%,55%,.14)'; cx.lineWidth = Math.max(1, S * 1.2); cx.beginPath();
      edges.forEach(function (e) { cx.moveTo(P[e[0]][0], P[e[0]][1]); cx.lineTo(P[e[1]][0], P[e[1]][1]); }); cx.stroke();
      pulses = pulses.filter(function (q) { q.t += q.sp * (1 + b.e); if (q.t >= 1) { if (q.depth > 0 && pulses.length < 400) fireFrom(q.b, q.depth - 1); return false; } return true; });
      pulses.forEach(function (q) { var A2 = P[q.a], B2 = P[q.b], x = A2[0] + (B2[0] - A2[0]) * q.t, y = A2[1] + (B2[1] - A2[1]) * q.t, x0 = A2[0] + (B2[0] - A2[0]) * Math.max(0, q.t - .25), y0 = A2[1] + (B2[1] - A2[1]) * Math.max(0, q.t - .25);
        cx.strokeStyle = 'hsla(' + ((hh + 40) % 360) + ',100%,70%,.9)'; cx.lineWidth = Math.max(1, S * 3); cx.beginPath(); cx.moveTo(x0, y0); cx.lineTo(x, y); cx.stroke(); });
      P.forEach(function (q, i) { var z = (q[2] + 1.2) / 2.4, sz = (1.5 + z * 3) * S * 2 * (1 + p * .5); cx.fillStyle = 'hsla(' + ((hh + nodes[i][3] * 60) % 360) + ',100%,' + (55 + z * 25) + '%,' + (.3 + z * .7) + ')'; cx.fillRect(q[0] - sz / 2, q[1] - sz / 2, sz, sz); });
      cx.globalCompositeOperation = 'source-over';
    }, 30);
  }

  // 28. DATA STORM — streams of glowing code fly past; they lock into NEXUS on the drop
  function datastorm() {
    var b = beatTracker(), hue = beatHue(140, 40), glyphs = [], form = 0, formT = 0, targets = [];
    var CH = 'ｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEFNEXUS$#@%&*';
    for (var i = 0; i < 260; i++) glyphs.push({ x: (Math.random() - .5) * 3, y: (Math.random() - .5) * 2, z: Math.random() * 3 + .2, c: CH[Math.random() * CH.length | 0], tx: 0, ty: 0 });
    (function () { var c = document.createElement('canvas'); c.width = 160; c.height = 40; var g2 = c.getContext('2d'); g2.fillStyle = '#fff'; g2.font = '900 34px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('NEXUS', 80, 21);
      var d = g2.getImageData(0, 0, 160, 40).data; for (var y = 0; y < 40; y += 2) for (var x = 0; x < 160; x += 2) if (d[(y * 160 + x) * 4 + 3] > 128) targets.push([(x - 80) / 80, (y - 20) / 80]); })();
    text('xpTop', 'DATA STORM');
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit);
      if (b.hit && b.k > .6 && form === 0 && now - formT > 6000) { form = 1; formT = now; }
      if (form === 1 && now - formT > 3500) { form = 0; formT = now; }
      cx.fillStyle = 'rgba(0,4,2,.35)'; cx.fillRect(0, 0, W, H);
      var cxp = W / 2, cyp = H / 2, F = Math.min(W, H) * .5;
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      glyphs.forEach(function (g3, i) {
        var sx2, sy2, sz;
        if (form) { var tg = targets[i % targets.length]; g3.tx += (tg[0] * W * .42 + cxp - g3.tx) * .12; g3.ty += (tg[1] * W * .42 + cyp - g3.ty) * .12; sx2 = g3.tx; sy2 = g3.ty; sz = W * .016; }
        else { g3.z -= .02 + b.e * .05 + b.k * .05; if (g3.z < .15) { g3.z = 3.2; g3.x = (Math.random() - .5) * 3; g3.y = (Math.random() - .5) * 2; g3.c = CH[Math.random() * CH.length | 0]; }
          sx2 = cxp + g3.x / g3.z * F; sy2 = cyp + g3.y / g3.z * F; sz = Math.max(4, F * .06 / g3.z); g3.tx = sx2; g3.ty = sy2; }
        if (Math.random() < .03) g3.c = CH[Math.random() * CH.length | 0];
        var near = form ? 1 : Math.min(1, 1.2 / g3.z);
        cx.font = '700 ' + (sz | 0) + 'px monospace';
        cx.fillStyle = 'hsla(' + hh + ',100%,' + (50 + near * 40) + '%,' + (.25 + near * .75) + ')';
        cx.fillText(g3.c, sx2, sy2);
      });
    }, 30);
  }

  // 29. PARTICLE PORTRAIT — thousands of glowing particles form a shape, explode on the drop, reform as the next
  function portrait() {
    var b = beatTracker(), hue = beatHue(200, 50), parts = [], SHAPES = ['NEXUS', '💀', '🐺', '❤️', '👽', '🔥', '🦅', '⚡'], si = 0, lastSwap = performance.now(), boom = 0;
    var N2 = 1400;
    for (var i = 0; i < N2; i++) parts.push({ x: Math.random(), y: Math.random(), vx: 0, vy: 0, tx: .5, ty: .5, o: Math.random() });
    function sample(sh) {
      var c = document.createElement('canvas'), w = 200, h = 110; c.width = w; c.height = h; var g2 = c.getContext('2d');
      g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillStyle = '#fff';
      g2.font = (sh.length > 2 ? '900 58px sans-serif' : '96px sans-serif'); g2.fillText(sh, w / 2, h / 2 + 4);
      var d = g2.getImageData(0, 0, w, h).data, pts = [];
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 120) pts.push([x / w, y / h]);
      if (!pts.length) pts.push([.5, .5]);
      return pts;
    }
    function assign() { var pts = sample(SHAPES[si]); parts.forEach(function (q, k) { var t = pts[(k * 7919) % pts.length]; q.tx = .2 + t[0] * .6; q.ty = .12 + t[1] * .76; }); }
    assign();
    text('xpTop', 'PARTICLE PORTRAIT');
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit);
      if ((b.hit && b.k > .6 && now - lastSwap > 5000) || now - lastSwap > 12000) {
        boom = 1; lastSwap = now;
        parts.forEach(function (q) { var a = Math.random() * 6.283, sp = .01 + Math.random() * .03; q.vx += Math.cos(a) * sp; q.vy += Math.sin(a) * sp; });
        setTimeout(function () { si = (si + 1) % SHAPES.length; assign(); }, 350);
      }
      boom *= .95;
      cx.fillStyle = 'rgba(0,0,8,.32)'; cx.fillRect(0, 0, W, H);
      cx.globalCompositeOperation = 'lighter';
      var sz = Math.max(1.5, S * 3.2);
      parts.forEach(function (q) {
        q.vx += (q.tx - q.x) * .02; q.vy += (q.ty - q.y) * .02; q.vx *= .86; q.vy *= .86;
        q.x += q.vx + Math.sin(now * .002 + q.o * 20) * .0006 * (1 + p * 4); q.y += q.vy + Math.cos(now * .0023 + q.o * 20) * .0006 * (1 + p * 4);
        cx.fillStyle = 'hsla(' + ((hh + q.o * 70) % 360) + ',100%,' + (55 + p * 25) + '%,.85)';
        cx.fillRect(q.x * W - sz / 2, q.y * H - sz / 2, sz, sz);
      });
      cx.globalCompositeOperation = 'source-over';
      if (boom > .9) flash('#fff', .25);
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
