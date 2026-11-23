/* NEXUS VISUALS — music-reactive 3D themes.
   One small 3D renderer (its own WebGL canvas with a depth buffer), one music analyser
   (six frequency bands, kick / snare / hat detection, tempo and beat clock, build-ups and drops)
   and one theme per experience. Themes are independent: each builds its own meshes and shaders.
   Loaded only when Visuals opens; everything is released again when Visuals closes. */
(function () {
  'use strict';
  var N = window.NX || {}, A = N.A || null;
  var $ = N.$ || function (id) { return document.getElementById(id); };
  var mem = 0;
  try { mem = Number(A && A.deviceMemoryGb ? A.deviceMemoryGb() : 0); } catch (e) {}
  if (!mem) mem = Number(navigator.deviceMemory) || 2;
  var HIGH = mem >= 6;
  // Render scale (of CSS pixels): adapts to frame time. The 2 GB box starts at .6 and never goes above .8.
  var QMIN = .42, QMAX = HIGH ? 1 : .8;
  var Q = Math.min(QMAX, Math.max(QMIN, parseFloat(pref('nvq')) || (HIGH ? .9 : .6)));
  var FPS_GAP = HIGH ? 1000 / 60 : 1000 / 30;
  function pref(k) { try { return N.pref ? N.pref(k) : localStorage.getItem('p_' + k); } catch (e) { return ''; } }
  function setPref(k, v) { try { if (A && A.setPref) A.setPref(k, String(v)); else localStorage.setItem('p_' + k, String(v)); } catch (e) {} }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function mix(a, b, t) { return a + (b - a) * t; }
  function sat(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(a, b, x) { var t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); }

  // ==================================================================
  // MUSIC — six bands from Android (Nexus._meter6), with the older
  // three-band feed (window.BEAT) as a fallback. Values arrive ~20-30
  // times a second; every frame they are eased so motion stays fluid.
  // ==================================================================
  var M = {
    sub: 0, bass: 0, lowmid: 0, mid: 0, high: 0, air: 0,
    kick: 0, snare: 0, hat: 0, kickHit: false, snareHit: false, hatHit: false, kickN: 0, snareN: 0, hatN: 0, strength: 0,
    energy: 0, slow: 0, build: 0, drop: false, dropEnv: 0, quiet: 1, live: false, activity: 0,
    phase: 0, period: 500, bpm: 120, beat: 0, frac: 0, bar: 0
  };
  var raw = [0, 0, 0, 0, 0, 0], rawAt = 0, norm = [0, 0, 0, 0, 0, 0];
  var bandMean = [.02, .02, .02, .02, .02, .02], bandPeak = [.05, .05, .05, .05, .05, .05];
  var pend = { kick: 0, snare: 0, hat: 0 }, lastKickAt = 0, lastSnareAt = 0, lastHatAt = 0, intervals = [], lastDropAt = -1e9;
  var musicOn = true, musicCheck = 0, fallbackKicks = -1;
  // Onsets: a jump in a band's raw level relative to its own recent average (scale-free, so steady loud
  // bass doesn't hide the kicks on top of it), compared against the typical jump size for that band.
  var lvl = { low: .02, mid: .02, hi: .02 }, jump = { low: .05, mid: .05, hi: .05 }, prev = { low: 0, mid: 0, hi: 0 };
  function onset(key, x, now, minGap, last, gain) {
    var d = Math.max(0, x - prev[key]) / (lvl[key] + 1e-3); prev[key] = x;
    var hit = d > jump[key] * 2.2 + .35 && x > lvl[key] * 1.12 && now - last > minGap;
    jump[key] += (d - jump[key]) * .06; lvl[key] += (x - lvl[key]) * .05;
    return hit ? clamp(.5 + d * gain, .5, 1) : 0;
  }
  function onsets(now) {
    var low = raw[0] * .6 + raw[1] * .4, md = raw[2] * .4 + raw[3] * .6, hi = raw[4] * .55 + raw[5] * .45;
    var k = onset('low', low, now, 230, lastKickAt, .35), sn = onset('mid', md, now, 170, lastSnareAt, .4), h = onset('hi', hi, now, 85, lastHatAt, .4);
    if (k) {
      var iv = now - lastKickAt; lastKickAt = now; pend.kick = Math.max(pend.kick, k);
      if (iv > 280 && iv < 1100) { intervals.push(iv); if (intervals.length > 7) intervals.shift(); }
    }
    if (sn) { lastSnareAt = now; pend.snare = Math.max(pend.snare, sn); }
    if (h) { lastHatAt = now; pend.hat = Math.max(pend.hat, h); }
  }
  function feed6(v) {
    var now = performance.now(), total = 0;
    for (var i = 0; i < 6; i++) {
      var x = Math.max(0, +v[i] || 0); raw[i] = x; total += x;
      bandMean[i] += (x - bandMean[i]) * .006;                      // ~5 s running level
      // the loud parts are remembered for about half a minute, so a quiet passage after them reads as quiet
      bandPeak[i] = Math.max(x, bandPeak[i] * .9993, bandMean[i] * 1.6 + 1e-4);
      var base = bandMean[i] * .55;
      norm[i] = sat((x - base) / (bandPeak[i] - base + 1e-4));
    }
    if (total < .002) for (var j = 0; j < 6; j++) norm[j] *= .5;    // near-silence reads as silence
    rawAt = now; onsets(now);
  }
  var nexusObj = window.Nexus || (window.Nexus = {});
  nexusObj._meter6 = function (a, b, c, d, e, f) { feed6([a, b, c, d, e, f]); };
  function fallbackFeed(now) {
    // the older feed (also microphone fallback): bass / mid / high and counted kicks
    var B = window.BEAT; if (!B || now - rawAt < 1500) return false;
    if (B.tick) B.tick();
    var live = Date.now() - (B.live || 0) < 1500;
    if (!live) { for (var i = 0; i < 6; i++) norm[i] *= .9; return true; }
    var bs = sat((B.bass || 0) * .8), md = sat(B.mid * 8 || 0), hi = sat(B.high * 10 || 0);
    norm[0] = bs; norm[1] = bs; norm[2] = md * .8; norm[3] = md; norm[4] = hi; norm[5] = hi * .8;
    if (fallbackKicks >= 0 && B.kicks !== fallbackKicks) {
      var iv = now - lastKickAt; lastKickAt = now; pend.kick = Math.max(pend.kick, clamp(B.k || .7, .55, 1));
      if (iv > 280 && iv < 1100) { intervals.push(iv); if (intervals.length > 7) intervals.shift(); }
    }
    fallbackKicks = B.kicks || 0;
    return true;
  }
  function medianPeriod() {
    if (intervals.length < 3) return 0;
    var s = intervals.slice().sort(function (a, b) { return a - b; });
    return s[s.length >> 1];
  }
  function musicTick(now, dt) {
    var s = dt / 1000;
    var fb = fallbackFeed(now);
    if (A && now > musicCheck) { musicCheck = now + 1000; try { musicOn = !!A.isMusicActive(); } catch (e) { musicOn = true; } }
    var fresh = now - rawAt < 1500 || (fb && Date.now() - ((window.BEAT || {}).live || 0) < 1500);
    M.live = !!(fresh && musicOn);
    if (!M.live) { for (var q = 0; q < 6; q++) norm[q] *= Math.exp(-s * 3); pend.kick = pend.snare = pend.hat = 0; }
    // eased bands: fast attack, slower release
    var keys = ['sub', 'bass', 'lowmid', 'mid', 'high', 'air'], up = [22, 20, 16, 14, 18, 18], dn = [5, 5, 4, 3.5, 6, 6];
    for (var i = 0; i < 6; i++) { var k = keys[i], tgt = norm[i]; M[k] += (tgt - M[k]) * Math.min(1, s * (tgt > M[k] ? up[i] : dn[i])); }
    // hits become envelopes (instant attack, musical decay)
    M.kickHit = pend.kick > 0; M.snareHit = pend.snare > 0; M.hatHit = pend.hat > 0;
    if (M.kickHit) { M.kick = Math.max(M.kick, pend.kick); M.strength = pend.kick; M.kickN++; M.activity += .3; }
    if (M.snareHit) { M.snare = Math.max(M.snare, pend.snare); M.snareN++; M.activity += .2; }
    if (M.hatHit) { M.hat = Math.max(M.hat, pend.hat); M.hatN++; M.activity += .08; }
    M.activity = Math.min(1, M.activity) * Math.exp(-dt / 1400);       // how busy the drums are right now
    pend.kick = pend.snare = pend.hat = 0;
    M.kick *= Math.exp(-dt / 190); M.snare *= Math.exp(-dt / 150); M.hat *= Math.exp(-dt / 85);
    // energy = how loud (against the song's own loud parts) x how busy: a drumless pad stays gentle
    var en = (M.sub * .3 + M.bass * .25 + M.lowmid * .15 + M.mid * .15 + M.high * .1 + M.air * .05) * (.45 + .55 * M.activity);
    M.energy += (en - M.energy) * Math.min(1, s * 2.5);
    M.slow += (M.energy - M.slow) * Math.min(1, s * .12);
    M.build += (sat((M.energy - M.slow) * 3.5 + (M.high - M.bass) * .4) - M.build) * Math.min(1, s * 1.2);
    M.quiet += ((M.energy < .12 ? 1 : 0) - M.quiet) * Math.min(1, s * .6);
    // the drop: a strong kick slamming in well above the recent average
    M.drop = M.kickHit && M.strength > .8 && M.energy > .42 && M.energy > M.slow * 1.55 && now - lastDropAt > 8000;
    if (M.drop) { lastDropAt = now; M.dropEnv = 1; }
    M.dropEnv *= Math.exp(-dt / 1400);
    // beat clock: tempo from kick spacing (doubled / halved into 80-160 BPM), phase pulled onto kicks
    var med = medianPeriod();
    // tempo folded into 80-180 BPM
    if (med) { while (med < 333) med *= 2; while (med > 750) med /= 2; M.period += (med - M.period) * Math.min(1, s * 1.5); }
    M.bpm = 60000 / M.period;
    M.phase += dt / (M.live ? M.period : 1600);
    if (M.kickHit && M.live) { var near = Math.round(M.phase); M.phase += (near - M.phase) * .45; }
    M.beat = Math.floor(M.phase); M.frac = M.phase - M.beat; M.bar = Math.floor(M.phase / 4);
    return M;
  }
  function musicReset() {
    for (var i = 0; i < 6; i++) { norm[i] = 0; }
    ['sub', 'bass', 'lowmid', 'mid', 'high', 'air', 'kick', 'snare', 'hat', 'energy', 'slow', 'build', 'dropEnv', 'activity'].forEach(function (k) { M[k] = 0; });
    M.quiet = 1; intervals = []; rawAt = 0;
  }

  // ==================================================================
  // MATH
  // ==================================================================
  function m4() { var m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  var MT = new Float32Array(16);
  function mul(o, a, b) {
    var r = MT;
    for (var c = 0; c < 4; c++) for (var rr = 0; rr < 4; rr++) {
      r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
    }
    o.set(r); return o;
  }
  // T * Ry * Rx * Rz * S   (yaw, then pitch, then roll)
  function trs(o, tx, ty, tz, rx, ry, rz, sx, sy, sz) {
    var cx = Math.cos(rx), sx_ = Math.sin(rx), cy = Math.cos(ry), sy_ = Math.sin(ry), cz = Math.cos(rz), sz_ = Math.sin(rz);
    // R = Ry * Rx * Rz
    var r00 = cy * cz + sy_ * sx_ * sz_, r01 = -cy * sz_ + sy_ * sx_ * cz, r02 = sy_ * cx;
    var r10 = cx * sz_, r11 = cx * cz, r12 = -sx_;
    var r20 = -sy_ * cz + cy * sx_ * sz_, r21 = sy_ * sz_ + cy * sx_ * cz, r22 = cy * cx;
    sx = sx || 1; sy = sy || 1; sz = sz || 1;
    o[0] = r00 * sx; o[1] = r10 * sx; o[2] = r20 * sx; o[3] = 0;
    o[4] = r01 * sy; o[5] = r11 * sy; o[6] = r21 * sy; o[7] = 0;
    o[8] = r02 * sz; o[9] = r12 * sz; o[10] = r22 * sz; o[11] = 0;
    o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1;
    return o;
  }
  function persp(o, fovy, asp, n, f) {
    var t = 1 / Math.tan(fovy / 2); o.fill(0);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
  }
  function norm3(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function lookAt(o, eye, at, up) {
    var z = norm3(sub3(eye, at)), x = norm3(cross(up, z)), y = cross(z, x);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0; o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]); o[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]); o[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]); o[15] = 1;
    return { right: x, up: y, fwd: [-z[0], -z[1], -z[2]] };
  }
  function hsv(h, s, v) {
    h = ((h % 1) + 1) % 1; var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  }
  // seeded random (stable layouts every visit)
  function rng(seed) { var s = seed >>> 0 || 1; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

  // ==================================================================
  // MESHES — built in code (no image or model files). Each vertex carries
  // position, normal, colour and [bone, glow, pattern]. Patterns:
  // 0 skin · 1 glowing spots · 2 glossy eye · 3 bone · 4 pure glow · 5 energy lines · 6 chrome
  // ==================================================================
  function Mesh() { this.v = []; this.i = []; this.n = 0; }
  Mesh.prototype.vert = function (p, nn, c, bone, em, pat) {
    this.v.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], c[0], c[1], c[2], bone, em || 0, pat || 0); return this.n++;
  };
  function rotXYZ(p, r) {
    if (!r) return p;
    var x = p[0], y = p[1], z = p[2], c, s, t;
    if (r[2]) { c = Math.cos(r[2]); s = Math.sin(r[2]); t = x * c - y * s; y = x * s + y * c; x = t; }
    if (r[0]) { c = Math.cos(r[0]); s = Math.sin(r[0]); t = y * c - z * s; z = y * s + z * c; y = t; }
    if (r[1]) { c = Math.cos(r[1]); s = Math.sin(r[1]); t = x * c + z * s; z = -x * s + z * c; x = t; }
    return [x, y, z];
  }
  // o: centre, r: radii, opt: seg, rows, rot, em, pat, deform(p) -> p
  function ellipsoid(M_, bone, o, r, c, opt) {
    opt = opt || {}; var seg = opt.seg || 18, rows = opt.rows || Math.max(6, seg >> 1), base = M_.n;
    for (var j = 0; j <= rows; j++) {
      var ph = j / rows * Math.PI, sp = Math.sin(ph), cp = Math.cos(ph);
      for (var i = 0; i <= seg; i++) {
        var th = i / seg * Math.PI * 2, u = [sp * Math.cos(th), cp, sp * Math.sin(th)];
        var p = [u[0] * r[0], u[1] * r[1], u[2] * r[2]], nn = [u[0] / r[0], u[1] / r[1], u[2] / r[2]];
        if (opt.deform) { var d = opt.deform(p, u); p = d; }
        p = rotXYZ(p, opt.rot); nn = norm3(rotXYZ(nn, opt.rot));
        M_.vert([p[0] + o[0], p[1] + o[1], p[2] + o[2]], nn, c, bone, opt.em, opt.pat);
      }
    }
    for (j = 0; j < rows; j++) for (i = 0; i < seg; i++) {
      var a = base + j * (seg + 1) + i, b = a + seg + 1;
      M_.i.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // tapered tube from a to b, with rounded ends
  function limb(M_, bone, a, b, r1, r2, c, opt) {
    opt = opt || {}; var seg = opt.seg || 12, rings = opt.rings || 4, base = M_.n;
    var ax = sub3(b, a), L = Math.hypot(ax[0], ax[1], ax[2]) || 1e-4, d = [ax[0] / L, ax[1] / L, ax[2] / L];
    var ref = Math.abs(d[1]) < .9 ? [0, 1, 0] : [1, 0, 0], e1 = norm3(cross(d, ref)), e2 = cross(d, e1), slope = (r1 - r2) / L;
    for (var j = 0; j <= rings; j++) {
      var t = j / rings, r = mix(r1, r2, t), bulge = opt.bulge ? 1 + opt.bulge * Math.sin(t * Math.PI) : 1;
      for (var i = 0; i <= seg; i++) {
        var th = i / seg * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
        var radial = [e1[0] * cs + e2[0] * sn, e1[1] * cs + e2[1] * sn, e1[2] * cs + e2[2] * sn];
        var p = [a[0] + ax[0] * t + radial[0] * r * bulge, a[1] + ax[1] * t + radial[1] * r * bulge, a[2] + ax[2] * t + radial[2] * r * bulge];
        M_.vert(p, norm3([radial[0] + d[0] * slope, radial[1] + d[1] * slope, radial[2] + d[2] * slope]), c, bone, opt.em, opt.pat);
      }
    }
    for (j = 0; j < rings; j++) for (i = 0; i < seg; i++) { var q = base + j * (seg + 1) + i, w = q + seg + 1; M_.i.push(q, w, q + 1, q + 1, w, w + 1); }
    if (opt.caps !== false) {
      ellipsoid(M_, bone, a, [r1, r1, r1], c, { seg: seg, rows: seg >> 1, em: opt.em, pat: opt.pat });
      ellipsoid(M_, bone, b, [r2, r2, r2], c, { seg: seg, rows: seg >> 1, em: opt.em, pat: opt.pat });
    }
  }
  function torus(M_, bone, o, R, r, c, opt) {
    opt = opt || {}; var seg = opt.seg || 28, ts = opt.ts || 8, base = M_.n, arc = opt.arc || Math.PI * 2;
    for (var j = 0; j <= seg; j++) {
      var u = j / seg * arc, cu = Math.cos(u), su = Math.sin(u);
      for (var i = 0; i <= ts; i++) {
        var v = i / ts * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
        var p = rotXYZ([(R + r * cv) * cu, r * sv, (R + r * cv) * su], opt.rot), nn = rotXYZ([cv * cu, sv, cv * su], opt.rot);
        M_.vert([p[0] + o[0], p[1] + o[1], p[2] + o[2]], nn, c, bone, opt.em, opt.pat);
      }
    }
    for (j = 0; j < seg; j++) for (i = 0; i < ts; i++) { var a = base + j * (ts + 1) + i, b = a + ts + 1; M_.i.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  // axis-aligned box with flat faces
  function box(M_, bone, o, sz, c, opt) {
    opt = opt || {}; var hx = sz[0] / 2, hy = sz[1] / 2, hz = sz[2] / 2;
    var F_ = [[[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]], [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
      [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]], [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]], [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]]];
    F_.forEach(function (f) {
      if (opt.skip && opt.skip(f[0])) return;
      var b0 = M_.n;
      f[1].forEach(function (p) { M_.vert([p[0] + o[0], p[1] + o[1], p[2] + o[2]], f[0], c, bone, opt.em, opt.pat); });
      M_.i.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
    });
  }
  // flat quad whose vertex colours carry (u, v, style) for screen patterns
  function screenQuad(M_, bone, p0, p1, p2, p3, nn, style, opt) {
    opt = opt || {}; var b0 = M_.n, uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    [p0, p1, p2, p3].forEach(function (p, i) { M_.vert(p, nn, [uv[i][0], uv[i][1], style], bone, opt.em || 1, opt.pat || 9); });
    M_.i.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2, b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);   // both sides
  }
  function cone(M_, bone, a, b, r, c, opt) { opt = opt || {}; limb(M_, bone, a, b, r, r * .04, c, { seg: opt.seg || 10, rings: 2, caps: false, em: opt.em, pat: opt.pat }); }

  // ==================================================================
  // RENDERER
  // ==================================================================
  var layer = null, glc = null, gl = null, progs = {}, quad = null, live = null, raf = 0, lastFrame = 0;
  var MAXB = 20;
  var VS_MESH = [
    'attribute vec3 aP, aN, aC, aM;',
    'uniform mat4 uVP; uniform mat4 uB[' + MAXB + ']; uniform vec4 uWarp; uniform float uT;',
    'varying vec3 vW, vN, vC, vM, vL;',
    'void main(){',
    '  mat4 B = uB[int(aM.x + .5)];',
    '  vec3 p = aP;',
    '  if (uWarp.x + uWarp.w > 0.) {',
    '    float wv = sin(aP.x * uWarp.y + uT * uWarp.z) * sin(aP.y * uWarp.y * 1.3 - uT * uWarp.z * .7) * cos(aP.z * uWarp.y * .9 + uT);',
    '    float sp = pow(abs(sin(aP.x * 9. + aP.z * 7.) * sin(aP.y * 11. - aP.z * 5.)), 6.);',
    '    p += aN * (uWarp.x * wv + uWarp.w * sp);',
    '  }',
    '  vec4 w = B * vec4(p, 1.);',
    '  vW = w.xyz; vN = mat3(B[0].xyz, B[1].xyz, B[2].xyz) * aN; vC = aC; vM = aM; vL = aP;',
    '  gl_Position = uVP * w;',
    '}'].join('\n');
  var FS_MESH = [
    'precision mediump float;',
    'varying vec3 vW, vN, vC, vM, vL;',
    'uniform vec3 uCam, uKeyDir, uKeyCol, uRimA, uRimB, uSky, uGround, uFogCol, uEye, uTint;',
    'uniform vec4 uM0, uM1, uM2, uM3;',      // sub bass lowmid mid | high air kick snare | hat energy build drop | phase frac hue time
    'uniform float uFog, uGlow, uRefl;',
    'float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }',
    'float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);',
    '  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),',
    '             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }',
    'void main(){',
    '  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;',
    '  vec3 V = normalize(uCam - vW);',
    '  float pat = vM.z, em = vM.y, spec = .3, gloss = 22.;',
    '  vec3 base = vC * uTint, glowC = vC;',
    '  float fr = pow(1. - max(0., dot(N, V)), 2.4);',
    '  if (pat > .5 && pat < 1.5) {',             // glowing spots / freckles
    '    float s = n3(vL * 13.) * .8 + n3(vL * 31.) * .2; float sp = smoothstep(.68, .74, s);',
    '    base = mix(base, base * .55, smoothstep(.5, .66, s)); em += sp * (.9 + uM2.x * 1.6 + uM1.z * .7); glowC = mix(vC, uEye, sp);',
    '  } else if (pat > 1.5 && pat < 2.5) {',      // glossy eye: dark lens with a glowing rim and a hot core
    '    spec = 1.4; gloss = 90.; glowC = uEye; em = em * (fr * 1.6 + .25) * (.7 + uM2.x * .9);',
    '  } else if (pat > 2.5 && pat < 3.5) {',      // bone
    '    float s = n3(vL * 16.) * .6 + n3(vL * 40.) * .4; base *= .78 + .32 * s; spec = .22; gloss = 14.;',
    '  } else if (pat > 3.5 && pat < 4.5) {',      // pure glow
    '    em *= 1. + uM1.z * .9 + uM2.x * .5;',
    '  } else if (pat > 4.5 && pat < 5.5) {',      // energy lines running over the body
    '    float l = fract(vL.y * 3.2 + vL.x * .8 - uM3.w * .9 - uM3.x * .25); float ln = smoothstep(.0, .025, l) * smoothstep(.07, .035, l);',
    '    em += ln * (1.1 + uM1.z * 2.); glowC = vec3(.35, .95, 1.); spec = .7; gloss = 40.;',
    '  } else if (pat > 5.5 && pat < 6.5) {',      // chrome
    '    spec = 1.6; gloss = 60.; base = mix(base, uSky * 1.4, .35 + fr * .5);',
    '  } else if (pat > 7.5 && pat < 8.5) {',      // skyscraper facade: a grid of windows, some lit, some flickering, some flashing on kicks
    '    vec2 wc = abs(N.x) > .5 ? vec2(vL.z, vL.y) : vec2(vL.x, vL.y);',
    '    if (abs(N.y) > .5) { base *= .5; } else {',
    '      vec2 cell = floor(wc / vec2(.3, .4)), f = fract(wc / vec2(.3, .4)); cell = mod(cell, 61.);',
    '      float win = step(.2, f.x) * step(f.x, .8) * step(.25, f.y) * step(f.y, .78);',
    '      float h = h3(vec3(cell, floor(vC.r * 300.)));',
    '      float floorBand = step(.3, fract(cell.y * .137 + vC.r * 3.));',
    '      float lit = step(.6, h) * floorBand + step(.985, h3(vec3(cell, mod(floor(uM3.w * 3.), 50.)))) * uM2.x;',
    '      float flash = step(.93, h) * uM1.z;',
    '      glowC = mix(vec3(1., .72, .4), vec3(.4, .85, 1.), step(.75, fract(h * 7.)));',
    '      glowC = mix(glowC, vec3(1., .3, .8), step(.9, fract(h * 13.)));',
    '      em += win * (min(lit, 1.) * (.35 + .3 * fract(h * 3.)) + flash * 1.3);',
    '      base = mix(base, vec3(.02, .02, .04), win);',
    '    }',
    '  } else if (pat > 8.5) {',                   // billboard screen: live equaliser bars, scanlines, glitch on the snare
    '    vec2 uv = vC.rg; float style = vC.b;',
    '    float bi = floor(uv.x * 12.), b6 = bi < 6. ? bi : 11. - bi;',
    '    float lvl = b6 < .5 ? uM0.x : b6 < 1.5 ? uM0.y : b6 < 2.5 ? uM0.z : b6 < 3.5 ? uM0.w : b6 < 4.5 ? uM1.x : uM1.y;',
    '    float bar = step(uv.y, .08 + lvl * .85) * step(.12, fract(uv.x * 12.)) * step(fract(uv.x * 12.), .88);',
    '    float seg = step(.25, fract(uv.y * 24.));',
    '    vec3 bc = .5 + .5 * cos(6.28318 * (uv.y * .6 + uM3.z + style * .3 + vec3(0., .33, .67)));',
    '    float scan = .75 + .25 * sin(uv.y * 160. + uM3.w * 8.);',
    '    float glitch = step(.7, fract(sin(floor(uv.y * 18.) * 91.7 + floor(uM3.w * 12.)) * 437.)) * uM1.w;',
    '    vec3 scr = bc * bar * seg * 1.6 + bc * .08;',
    '    scr += vec3(1., .2, .7) * glitch * .8;',
    '    float frame = step(.97, max(abs(uv.x - .5), abs(uv.y - .5)) * 2.);',
    '    base = vec3(.01); glowC = scr * scan + vec3(.3, .9, 1.) * frame; em = 1. + uM1.z * .5;',
    '  } else if (pat > 6.5) {',                   // iridescent: thin-film colours sliding with the view and the music
    '    vec3 film = .5 + .5 * cos(6.28318 * (fr * .9 + vL.y * .25 + uM3.z + uM0.w * .15 + vec3(0., .33, .67)));',
    '    base = mix(base * .45, film * .8, .35 + fr * .45); spec = 1.6; gloss = 80.; glowC = film; em += fr * fr * (.6 + uM1.z * .9);',
    '  }',
    '  float ndl = dot(N, uKeyDir);',
    '  float dif = max(0., ndl * .7 + .3);',
    '  vec3 H = normalize(uKeyDir + V);',
    '  float sp = pow(max(0., dot(N, H)), gloss) * spec;',
    '  vec3 amb = mix(uGround, uSky, N.y * .5 + .5);',
    '  vec3 rim = mix(uRimA, uRimB, smoothstep(-.3, .3, N.x)) * fr * (1. + uM1.z * 1.8 + uM2.w * 1.5);',
    '  vec3 col = base * (amb + uKeyCol * dif) + uKeyCol * sp + rim;',
    '  col += glowC * em * uGlow;',
    '  float d = length(uCam - vW);',
    '  col = mix(col, uFogCol, (1. - exp(-d * uFog)) * .9);',
    '  if (uRefl > .5) col *= .42 * exp(-vW.y * 1.1);',      // mirrored pass: a dimmed reflection in the glossy floor
    '  gl_FragColor = vec4(col, 1.);',
    '}'].join('\n');
  var VS_ADD = [
    'attribute vec3 aP; attribute vec4 aC; attribute float aS;',
    'uniform mat4 uVP; uniform float uPx;',
    'varying vec4 vC;',
    'void main(){ vec4 c = uVP * vec4(aP, 1.); gl_Position = c; gl_PointSize = clamp(aS * uPx / max(c.w, .2), 1., 64.); vC = aC; }'].join('\n');
  var FS_ADD = [
    'precision mediump float;',
    'varying vec4 vC; uniform float uPoint;',
    'void main(){ float a = 1.; if (uPoint > .5) { vec2 d = gl_PointCoord - .5; a = max(0., 1. - dot(d, d) * 4.); a *= a; }',
    '  gl_FragColor = vec4(vC.rgb * vC.a * a, 1.); }'].join('\n');
  var FS_BG_HEAD = [
    'precision mediump float;',
    'uniform vec2 uRes; uniform vec3 uCam, uFwd, uRight, uUp; uniform float uTan, uTime;',
    'uniform vec4 uM0, uM1, uM2, uM3;',
    'uniform vec4 uSpot[4]; uniform vec3 uSpotCol[4]; uniform vec4 uX;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }',
    'vec3 pal(float t){ return .5 + .5 * cos(6.28318 * (t + vec3(0., .33, .67))); }',
    'vec3 rayDir(){ vec2 uv = (gl_FragCoord.xy * 2. - uRes) / uRes.y; return normalize(uFwd + (uv.x * uRight + uv.y * uUp) * uTan); }',
    ''].join('\n');

  function ensureGl() {
    layer = layer || $('xp');
    if (!layer) return null;
    if (!glc) {
      glc = document.createElement('canvas'); glc.id = 'nvc';
      glc.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none';
      glc.setAttribute('aria-hidden', 'true');
    }
    var anchor = $('xpc');
    if (glc.parentNode !== layer) { if (anchor && anchor.parentNode === layer) layer.insertBefore(glc, anchor.nextSibling); else layer.appendChild(glc); }
    if (!gl) {
      try { gl = glc.getContext('webgl', { antialias: false, alpha: false, depth: true, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
      if (!gl) return null;
      quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      try { MAXB = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) >= 128 ? 20 : 20; } catch (e) {}
    }
    return gl;
  }
  function compile(key, vs, fs) {
    if (progs[key]) return progs[key];
    function sh(t, src) { var o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(o); try { console.log('NXV shader ' + key + ': ' + log); } catch (e) {} throw new Error('shader ' + key + ': ' + log); } return o; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link ' + key + ': ' + gl.getProgramInfoLog(p));
    p.loc = {}; p.att = {};
    p.u = function (n) { if (!(n in p.loc)) p.loc[n] = gl.getUniformLocation(p, n); return p.loc[n]; };
    p.a = function (n) { if (!(n in p.att)) p.att[n] = gl.getAttribLocation(p, n); return p.att[n]; };
    progs[key] = p; return p;
  }
  function upload(m) {
    var o = { vbo: gl.createBuffer(), ibo: gl.createBuffer(), count: m.i.length, verts: m.n };
    gl.bindBuffer(gl.ARRAY_BUFFER, o.vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.v), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(m.i), gl.STATIC_DRAW);
    return o;
  }
  function freeMesh(o) { if (o && gl) { gl.deleteBuffer(o.vbo); gl.deleteBuffer(o.ibo); } }
  var attribsOn = {};
  function attribs(list) {
    // enable exactly these attribute slots
    var want = {}; list.forEach(function (i) { if (i >= 0) want[i] = 1; });
    for (var k in attribsOn) if (!want[k]) { gl.disableVertexAttribArray(+k); delete attribsOn[k]; }
    for (k in want) if (!attribsOn[k]) { gl.enableVertexAttribArray(+k); attribsOn[k] = 1; }
  }
  function musicUniforms(p, t, hue) {
    gl.uniform4f(p.u('uM0'), M.sub, M.bass, M.lowmid, M.mid);
    gl.uniform4f(p.u('uM1'), M.high, M.air, M.kick, M.snare);
    gl.uniform4f(p.u('uM2'), M.hat, M.energy, M.build, M.dropEnv);
    gl.uniform4f(p.u('uM3'), M.phase, M.frac, hue || 0, t);
  }

  // ---- frame context shared by the draw helpers ----
  var F = { vp: m4(), view: m4(), proj: m4(), cam: [0, 0, 8], basis: null, tan: .5, w: 1, h: 1, t: 0, hue: 0 };
  function setCamera(eye, at, fov, roll) {
    var up = [Math.sin(roll || 0), Math.cos(roll || 0), 0];
    F.basis = lookAt(F.view, eye, at, up); F.cam = eye; F.tan = Math.tan(fov / 2);
    persp(F.proj, fov, F.w / F.h, .1, 80); mul(F.vp, F.proj, F.view);
  }
  function drawBackground(theme, extra) {
    var p = compile('bg_' + theme.id, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }', FS_BG_HEAD + theme.bg);
    gl.useProgram(p); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); var pa = p.a('p'); attribs([pa]); gl.vertexAttribPointer(pa, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(p.u('uRes'), F.w, F.h); gl.uniform3fv(p.u('uCam'), F.cam);
    gl.uniform3fv(p.u('uFwd'), F.basis.fwd); gl.uniform3fv(p.u('uRight'), F.basis.right); gl.uniform3fv(p.u('uUp'), F.basis.up);
    gl.uniform1f(p.u('uTan'), F.tan); gl.uniform1f(p.u('uTime'), F.t);
    musicUniforms(p, F.t, F.hue);
    if (extra) extra(p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function meshProgram() { return compile('mesh', VS_MESH, FS_MESH); }
  function beginMeshes(L) {
    var p = meshProgram(); gl.useProgram(p);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CW);
    gl.uniformMatrix4fv(p.u('uVP'), false, F.vp); gl.uniform3fv(p.u('uCam'), F.cam);
    gl.uniform3fv(p.u('uKeyDir'), norm3(L.key)); gl.uniform3fv(p.u('uKeyCol'), L.keyCol);
    gl.uniform3fv(p.u('uRimA'), L.rimA); gl.uniform3fv(p.u('uRimB'), L.rimB);
    gl.uniform3fv(p.u('uSky'), L.sky); gl.uniform3fv(p.u('uGround'), L.ground); gl.uniform3fv(p.u('uFogCol'), L.fog);
    gl.uniform1f(p.u('uFog'), L.fogD); gl.uniform1f(p.u('uGlow'), L.glow || 1); gl.uniform1f(p.u('uRefl'), 0);
    musicUniforms(p, F.t, F.hue);
    return p;
  }
  // mirrored copy below a floor at y = 0, added softly over the floor (drawn before the real meshes)
  var MIRROR = (function () { var m = m4(); m[5] = -1; return m; })(), VPM = m4();
  // Two passes so only the nearest mirrored surface shows: depth first, then colour added where it matches.
  function drawReflections(p, list) {
    mul(VPM, F.vp, MIRROR); gl.uniformMatrix4fv(p.u('uVP'), false, VPM); gl.uniform1f(p.u('uRefl'), 1); gl.frontFace(gl.CCW);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LESS); gl.colorMask(false, false, false, false);
    list.forEach(function (d) { drawMesh(p, d[0], d[1], d[2], d[3]); });
    gl.colorMask(true, true, true, true); gl.depthMask(false); gl.depthFunc(gl.EQUAL); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    list.forEach(function (d) { drawMesh(p, d[0], d[1], d[2], d[3]); });
    gl.disable(gl.BLEND); gl.depthMask(true); gl.depthFunc(gl.LEQUAL); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(p.u('uVP'), false, F.vp); gl.uniform1f(p.u('uRefl'), 0); gl.frontFace(gl.CW);
  }
  function drawMesh(p, mesh, bones, eye, tint, warp) {
    gl.uniformMatrix4fv(p.u('uB[0]'), false, bones);
    if (warp) gl.uniform4fv(p.u('uWarp'), warp); else gl.uniform4f(p.u('uWarp'), 0, 0, 0, 0);
    gl.uniform1f(p.u('uT'), F.t);
    gl.uniform3fv(p.u('uEye'), eye || [0, 1, 1]); gl.uniform3fv(p.u('uTint'), tint || [1, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    var a = [p.a('aP'), p.a('aN'), p.a('aC'), p.a('aM')]; attribs(a);
    gl.vertexAttribPointer(a[0], 3, gl.FLOAT, false, 48, 0); gl.vertexAttribPointer(a[1], 3, gl.FLOAT, false, 48, 12);
    gl.vertexAttribPointer(a[2], 3, gl.FLOAT, false, 48, 24); gl.vertexAttribPointer(a[3], 3, gl.FLOAT, false, 48, 36);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }
  // additive layer (glow particles, light beams, lines): x y z r g b a size per vertex
  var addBuf = null, addCap = 0;
  function drawAdditive(data, count, mode, point) {
    if (!count) return;
    var p = compile('add', VS_ADD, FS_ADD); gl.useProgram(p);
    gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    if (!addBuf) addBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, addBuf);
    if (data.length > addCap) { addCap = data.length; gl.bufferData(gl.ARRAY_BUFFER, addCap * 4, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * 8));
    var a = [p.a('aP'), p.a('aC'), p.a('aS')]; attribs(a);
    gl.vertexAttribPointer(a[0], 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(a[1], 4, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(a[2], 1, gl.FLOAT, false, 32, 28);
    gl.uniformMatrix4fv(p.u('uVP'), false, F.vp); gl.uniform1f(p.u('uPx'), F.h * .5 / F.tan); gl.uniform1f(p.u('uPoint'), point ? 1 : 0);
    gl.drawArrays(mode, 0, count);
    gl.disable(gl.BLEND); gl.depthMask(true);
  }
  // camera-facing soft light beam from top to bottom (6 vertices = 2 quads, bright centre line)
  function beam(out, o, top, bot, w1, w2, col, a) {
    var axis = norm3(sub3(bot, top)), toCam = norm3(sub3(F.cam, top)), side = norm3(cross(axis, toCam));
    var pts = [
      [top[0] - side[0] * w1, top[1] - side[1] * w1, top[2] - side[2] * w1, 0], [top[0], top[1], top[2], a], [top[0] + side[0] * w1, top[1] + side[1] * w1, top[2] + side[2] * w1, 0],
      [bot[0] - side[0] * w2, bot[1] - side[1] * w2, bot[2] - side[2] * w2, 0], [bot[0], bot[1], bot[2], a * .25], [bot[0] + side[0] * w2, bot[1] + side[1] * w2, bot[2] + side[2] * w2, 0]];
    var tri = [0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4];
    for (var i = 0; i < tri.length; i++) { var q = pts[tri[i]]; out[o++] = q[0]; out[o++] = q[1]; out[o++] = q[2]; out[o++] = col[0]; out[o++] = col[1]; out[o++] = col[2]; out[o++] = q[3]; out[o++] = 1; }
    return o;
  }

  var THEMES = {};

  // ==================================================================
  // CINEMATIC CLIPS — film-quality footage by Beeple (free for any use; credited in the menu),
  // played full screen and driven by the music:
  //   kick   -> zoom punch, white flash, small camera shake
  //   snare  -> horizontal glitch slices and jitter
  //   hi-hat -> scan-line sparkle
  //   drop   -> big flash and zoom
  // Each scene is ONE continuous reel: its camera angles are joined with cross-fades when the app is
  // built, and the reel's last moment fades into its own first frame, so it loops forever with no
  // loading, no black and no replaying of a single short shot. Only one video is ever loaded (the X3
  // runs out of decoders with more) and it never has to load anything mid-scene. When one scene
  // follows another (Play favourites), the last picture is held and faded into the next scene.
  // ==================================================================
  var REELS = {"coins": "clips/coins.mp4", "skulls": "clips/skulls.mp4", "cityfire": "clips/cityfire.mp4", "inferno": "clips/inferno.mp4", "serpent": "clips/serpent.mp4", "idol": "clips/idol.mp4", "frenzy": "clips/frenzy.mp4", "run": "clips/run.mp4", "collapse": "clips/collapse.mp4"};
  var CLIP_NAMES = {"coins": "Coin Avalanche", "skulls": "Skull Mountain", "cityfire": "City on Fire", "inferno": "Inferno", "serpent": "Golden Serpent", "idol": "The Idol", "frenzy": "Idol Frenzy", "run": "The Run", "collapse": "City Collapse"};
  var CLIP_ORDER = ["coins", "skulls", "cityfire", "inferno", "serpent", "idol", "frenzy", "run", "collapse"];
  function makeVideo() {
    var v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('loop', ''); v.setAttribute('playsinline', ''); v.setAttribute('disablepictureinpicture', ''); v.setAttribute('disableremoteplayback', '');
    // Android's WebView shows a grey "play" picture in a video until its first frame is ready.
    // A see-through poster removes it, and the video stays hidden until it is really playing.
    v.poster = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 50%;background:#000;opacity:0';
    return v;
  }
  function sheet(css) { var d = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0;' + css; return d; }
  // the last picture on screen, held over a scene change or the reel's loop point (one small canvas, reused)
  var carry = null, carryAt = 0;
  function grab(v) {
    try {
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      carry = carry || document.createElement('canvas');
      if (carry.width !== 512) { carry.width = 512; carry.height = 300; }
      carry.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0';
      carry.style.transform = v.style.transform;
      carry.getContext('2d').drawImage(v, 0, 0, carry.width, carry.height); carryAt = performance.now();
      return carry;
    } catch (e) { carryAt = 0; return null; }
  }
  function ClipTheme(id, src, name) { this.id = id; this.name = name; this.src = src; this.video = true; }
  ClipTheme.prototype.init = function () {
    var box = this.box = document.createElement('div');
    box.className = 'nv-clip'; box.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;background:#000';
    this.v = makeVideo(); box.appendChild(this.v);
    this.vig = sheet('opacity:1;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)'); box.appendChild(this.vig);
    this.dim = sheet('background:#000'); box.appendChild(this.dim);
    this.scan = sheet('background:repeating-linear-gradient(0deg, rgba(255,40,140,0) 0, rgba(255,40,140,0) 7px, rgba(120,230,255,.45) 7px, rgba(120,230,255,.45) 9px)'); box.appendChild(this.scan);
    this.flash = sheet('background:#fff'); box.appendChild(this.flash);
    // a scene that follows another straight away starts on the previous picture, not on black
    if (carry && performance.now() - carryAt < 1500) {
      carry.style.transition = 'none'; carry.style.opacity = '1'; box.insertBefore(carry, this.vig); this.hold = carry;
    }
    var anchor = $('xpc');
    if (anchor && anchor.parentNode === layer) layer.insertBefore(box, anchor.nextSibling); else layer.appendChild(box);
    this.fx = { zoom: 0, zv: 0, glitch: 0, flash: 0, sx: 0, sy: 0 }; this.css = {}; this.tries = 0; this.err = ''; this.started = false;
    var self = this;
    var release = function () {   // the moving picture is back: fade the held one away
      var h = self.hold; if (!h || h.style.opacity === '0') return;
      setTimeout(function () { if (self.hold === h) { h.style.transition = 'opacity .3s ease-out'; h.style.opacity = '0'; } }, 60);
    };
    this.v.addEventListener('playing', function () { self.err = ''; if (!self.v) return; self.v.style.opacity = '1'; release(); });
    this.v.addEventListener('seeked', function () { if (self.looping) { self.looping = false; release(); } });
    this.v.addEventListener('error', function () {
      var e = self.v && self.v.error; self.err = 'Clip ' + self.src + ' failed (' + (e ? e.code : '?') + ')';
      if (++self.tries < 3) setTimeout(function () { if (self.v) self.load(); }, 600);
    });
    this.load();
  };
  ClipTheme.prototype.load = function () {
    var v = this.v; this.startAt = 0;
    v.src = this.src; try { v.load(); } catch (e) {}
    try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
  };
  ClipTheme.prototype.free = function () {
    var v = this.v;
    if (v) {
      grab(v);   // keep the picture on screen now, so a following scene can fade out of it
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
    }
    if (this.box && this.box.parentNode) this.box.parentNode.removeChild(this.box);
    this.v = null; this.box = null; this.hold = null;
  };
  ClipTheme.prototype.set = function (el, key, val) { if (this.css[key] !== val) { this.css[key] = val; el.style[key.split('.')[1]] = val; } };
  ClipTheme.prototype.frame = function (dt, t) {
    var m = M, s = dt / 1000, fx = this.fx, v = this.v;
    if (!v) return;
    // the loop point: hold the current picture for the instant the reel jumps back to its start
    // (the reel's end already flows into its start; this only covers a WebView that blanks on the jump)
    if (!this.looping && v.duration > 1 && v.currentTime > v.duration - .2) {
      var h = grab(v);
      if (h) { if (h.parentNode !== this.box) this.box.insertBefore(h, this.vig); h.style.transition = 'none'; h.style.opacity = '1'; this.hold = h; this.looping = true; }
    }
    if (this.looping && v.currentTime < .5 && v.currentTime > 0 && !v.seeking) { this.looping = false; var hh = this.hold; if (hh) { hh.style.transition = 'opacity .3s ease-out'; hh.style.opacity = '0'; } }
    if (v.paused && !v.ended && v.readyState >= 2) { try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
    // music -> effects
    if (m.kickHit) { fx.zv += 4 * m.strength; fx.sx = (Math.random() - .5) * 8 * m.strength; fx.sy = (Math.random() - .5) * 6 * m.strength; fx.flash = Math.max(fx.flash, .07 * m.strength); }
    if (m.drop) { fx.zv += 4.5; fx.flash = .55; }
    if (m.snareHit) fx.glitch = Math.max(fx.glitch, m.snare);
    fx.zv += (-fx.zoom * 70 - fx.zv * 10) * s; fx.zoom = Math.max(-.02, Math.min(1.6, fx.zoom + fx.zv * s));
    fx.flash *= Math.exp(-dt / 130); fx.glitch *= Math.exp(-dt / 110);
    fx.sx *= Math.exp(-dt / 70); fx.sy *= Math.exp(-dt / 70);
    var scale = 1.02 + Math.min(fx.zoom, .5) * .24 + m.dropEnv * .03;     // a kick punches in about 4%, a drop about 8%
    var jx = fx.glitch > .2 ? (Math.random() - .5) * 14 * fx.glitch : 0;
    this.set(v, 'v.transform', 'translate3d(' + (fx.sx + jx).toFixed(1) + 'px,' + fx.sy.toFixed(1) + 'px,0) scale(' + scale.toFixed(3) + ')');
    this.set(this.flash, 'f.opacity', (fx.flash + m.kick * .03).toFixed(2));
    this.set(this.scan, 's.opacity', (fx.glitch * .8 + m.hat * .06).toFixed(2));
    this.set(this.dim, 'd.opacity', (m.live ? 0 : .18).toFixed(2));
    // if nothing plays after a few seconds, say why on screen
    if (!this.startAt) this.startAt = t;
    var note = $('xpMid'), playing = v.readyState >= 2 && !v.paused && v.currentTime > 0;
    if (playing) this.started = true;
    // a start that stalls is retried quietly; only a real failure is shown
    if (!playing && t - this.startAt > 8 && !this.err && this.tries < 3) { this.tries++; this.load(); }
    if (note) { var msg = this.started ? '' : (this.err || ''); if (note.textContent !== msg) note.textContent = msg; }
  };
  ClipTheme.prototype.debug = function () {
    var v = this.v || {};
    return { src: this.src, ready: v.readyState, playing: !v.paused, time: v.currentTime, zoom: this.fx.zoom, glitch: this.fx.glitch, flash: this.fx.flash, err: this.err || '',
      transform: v.style ? v.style.transform : '', videos: document.querySelectorAll('#xp video').length };
  };
  CLIP_ORDER.forEach(function (k) { THEMES['clip_' + k] = new ClipTheme('clip_' + k, REELS[k], CLIP_NAMES[k]); });
  // the mix: every angle of every scene, cross-faded into one continuous reel
  THEMES.clip_mix = new ClipTheme('clip_mix', 'clips/mix.mp4', 'Cinematic Mix');

  function mix3(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
  function scale3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

  // ==================================================================
  // LIFECYCLE
  // ==================================================================
  var ORDER = ['clip_mix'].concat(CLIP_ORDER.map(function (k) { return 'clip_' + k; }));
  var cur = null, theme = null, built = {}, frames = 0, tStart = 0, tPrev = 0, perf = { n: 0, sum: 0, since: 0, good: 0 };
  var bar = null, barTimer = 0, snap = null;
  function sizeCanvas() {
    if (!glc || !layer) return;
    // film clips are cheap to draw, so they keep near-full sharpness; the 3D themes use the adaptive scale
    var q = theme && theme.video ? clamp(Q + .3, .72, 1) : Q;
    var w = Math.max(64, Math.round(layer.clientWidth * q)), h = Math.max(36, Math.round(layer.clientHeight * q));
    if (glc.width !== w || glc.height !== h) { glc.width = w; glc.height = h; }
    F.w = glc.width; F.h = glc.height;
  }
  function getTheme(name) {
    if (!built[name]) { built[name] = Object.create(THEMES[name]); built[name].init(); }
    return built[name];
  }
  function render(now) {
    var dt = tPrev ? clamp(now - tPrev, 0, 66) : 33; tPrev = now;
    var t = (now - tStart) / 1000;
    musicTick(now, dt);
    F.t = t;
    if (!theme.video) { gl.viewport(0, 0, F.w, F.h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    theme.frame(dt, t);
    frames++;
  }
  function adapt(now, gap) {
    // hold a smooth frame rate: drop resolution when frames run long, raise it slowly when there is headroom
    if (!perf.since) { perf.since = now; perf.n = 0; perf.sum = 0; return; }
    perf.n++; perf.sum += gap;
    if (now - perf.since < 2000) return;
    var avg = perf.sum / perf.n, target = FPS_GAP * 1.18, old = Q;
    if (avg > target * 1.12 && Q > QMIN) { Q = Math.max(QMIN, Q - .08); perf.good = 0; }
    else if (avg < target && Q < QMAX) { perf.good++; if (perf.good >= 3) { Q = Math.min(QMAX, Q + .04); perf.good = 0; } }
    else perf.good = 0;
    perf.since = now; perf.n = 0; perf.sum = 0;
    if (Q !== old) { setPref('nvq', Q.toFixed(2)); sizeCanvas(); }
  }
  function loop(now) {
    if (!cur) return;
    raf = requestAnimationFrame(loop);
    if (now - lastFrame < FPS_GAP - 3) return;
    var gap = lastFrame ? now - lastFrame : FPS_GAP; lastFrame = now;
    try { render(now); } catch (e) { try { console.log('NXV frame: ' + (e.stack || e)); } catch (er) {} }
    if (theme && !theme.video) adapt(now, gap);       // film scenes are drawn by the video hardware: nothing to scale
  }
  function ensureBar() {
    if (!bar) {
      bar = document.createElement('nav'); bar.id = 'vxBar'; bar.setAttribute('aria-label', 'Visuals');
      bar.addEventListener('click', function (e) {
        e.stopPropagation();
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        if (b.getAttribute('data-vxexit')) { if (window.Nexus && Nexus.home) Nexus.home(); else if (window.XP) XP.close(); return; }
        var k = b.getAttribute('data-vx'); if (k && k !== cur && window.XP) XP.switchTo(k); else showBar();
      });
    }
    bar.innerHTML = '<div class="vx-list">' + ORDER.map(function (k, i) { return '<button type="button" class="vx-pick' + (k === cur ? ' active' : '') + '" data-vx="' + k + '" aria-pressed="' + (k === cur) + '"><span>0' + (i + 1) + '</span>' + THEMES[k].name + '</button>'; }).join('') + '</div>' +
      '<button type="button" class="vx-exit" data-vxexit="1" aria-label="Exit Visuals">EXIT</button>';
    if (bar.parentNode !== layer) layer.appendChild(bar);
    bar.style.display = '';
  }
  function showBar(ms) { if (!bar) return; bar.classList.add('on'); clearTimeout(barTimer); barTimer = setTimeout(function () { if (bar) bar.classList.remove('on'); }, ms || 4000); }
  function start(name) {
    var isClip = !!(THEMES[name] && THEMES[name].video);
    layer = layer || $('xp');
    if (!THEMES[name] || !layer || (!isClip && !ensureGl())) return false;
    try { theme = getTheme(name); if (!isClip) meshProgram(); } catch (e) { try { console.log('NXV start: ' + (e.stack || e)); } catch (er) {} return false; }
    cur = name; frames = 0; tPrev = 0; lastFrame = 0; perf = { n: 0, sum: 0, since: 0, good: 0 };
    if (!tStart) tStart = performance.now();
    if (!isClip) { glc.style.display = 'block'; sizeCanvas(); } else if (glc) glc.style.display = 'none';
    layer.classList.add('vx-active');
    try { if (A) { if (A.meterDetail) A.meterDetail(true); A.meter(true); } } catch (e) {}
    ensureBar(); showBar(3200);
    layer.onclick = function () { showBar(); };
    if (!isClip) render(performance.now());          // first frame before compositing: no black flash on entry
    raf = requestAnimationFrame(loop);
    return true;
  }
  function releaseAll() {
    Object.keys(built).forEach(function (k) { try { built[k].free(); } catch (e) {} }); built = {};
    if (gl) { Object.keys(progs).forEach(function (k) { try { gl.deleteProgram(progs[k]); } catch (e) {} }); if (addBuf) gl.deleteBuffer(addBuf); }
    progs = {}; addBuf = null; addCap = 0; attribsOn = {};
    if (glc) { glc.width = 1; glc.height = 1; }
    if (snap) { snap.width = 1; snap.height = 1; }
    if (carry) { carry.width = 1; carry.height = 1; carryAt = 0; }
    musicReset(); tStart = 0;
  }
  function stop(quiet) {
    // clip scenes always let go of their video, even on a quick switch
    Object.keys(built).forEach(function (k) { if (built[k].video) { try { built[k].free(); } catch (e) {} delete built[k]; } });
    if (!cur && quiet) return;
    cur = null; cancelAnimationFrame(raf); raf = 0;
    try { if (A && A.meterDetail) A.meterDetail(false); } catch (e) {}
    if (glc) glc.style.display = 'none';
    var note = $('xpMid'); if (note && theme && theme.video) note.textContent = '';
    if (layer) layer.classList.remove('vx-active');
    clearTimeout(barTimer); if (bar) { bar.classList.remove('on'); bar.style.display = 'none'; }
    if (!quiet) releaseAll();
  }
  function redraw() { if (cur && theme && (theme.video || gl)) try { render(performance.now()); } catch (e) {} }
  function snapshot() {
    if (!cur || !glc || glc.width < 4 || (theme && theme.video)) return;
    if (!snap) { snap = document.createElement('canvas'); snap.id = 'vxSnap'; snap.setAttribute('aria-hidden', 'true'); snap.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'; }
    if (snap.parentNode !== layer) layer.appendChild(snap);
    snap.style.transition = 'none'; snap.style.opacity = '1';
    snap.width = glc.width; snap.height = glc.height;
    redraw();
    try { snap.getContext('2d').drawImage(glc, 0, 0); } catch (e) {}
    void snap.offsetWidth;
    requestAnimationFrame(function () { requestAnimationFrame(function () { snap.style.transition = 'opacity .75s ease'; snap.style.opacity = '0'; }); });
  }
  // simulated music for previews and tests
  function setMusic(s) {
    musicReset();
    for (var k in s) M[k] = s[k];
    M.beat = Math.floor(M.phase); M.frac = M.phase - M.beat; M.bar = Math.floor(M.phase / 4);
    rawAt = performance.now(); musicOn = true;
  }
  // Renders frames offscreen with chosen music and returns pixels as an 80x45 luminance grid (tests).
  function probe(name, music, opts) {
    opts = opts || {};
    if (!THEMES[name] || !ensureGl()) return null;
    var was = cur, keepW = glc.width, keepH = glc.height, th = getTheme(name), prevTheme = theme;
    theme = th; glc.width = opts.w || 320; glc.height = opts.h || 180; F.w = glc.width; F.h = glc.height;
    var steps = opts.steps || 12, t0 = opts.t || 6, hold = {};
    var freeze = music || {}, savedLive = M.live;
    for (var i = 0; i < steps; i++) {
      setMusic(freeze); M.phase = (freeze.phase || 0) + i * .033 * (freeze.speed || 0);
      M.beat = Math.floor(M.phase); M.frac = M.phase - M.beat;
      M.live = freeze.live !== undefined ? freeze.live : true;
      var keep = { live: M.live }; F.t = t0 + i * .033;
      gl.viewport(0, 0, F.w, F.h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // advance the theme with the music frozen at these values
      th.frame(33, F.t);
      hold = keep;
    }
    var w = F.w, h = F.h, px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var grid = [], rgb = [0, 0, 0];
    for (var y = 0; y < 45; y++) for (var x = 0; x < 80; x++) {
      var o = (((h - 1 - Math.floor(y * h / 45)) * w) + Math.floor(x * w / 80)) * 4;
      grid.push(Math.round(.299 * px[o] + .587 * px[o + 1] + .114 * px[o + 2])); rgb[0] += px[o]; rgb[1] += px[o + 1]; rgb[2] += px[o + 2];
    }
    var out = { grid: grid, rgb: rgb.map(function (v) { return v / 3600; }), debug: th.debug ? th.debug() : null };
    if (opts.image) out.image = glc.toDataURL('image/png');
    glc.width = keepW; glc.height = keepH; F.w = keepW; F.h = keepH; theme = prevTheme; M.live = savedLive;
    if (!was) glc.style.display = 'none';
    return out;
  }
  var previewCache = null, PREVIEW_VERSION = 'nxv-2';
  function previews(cb) {
    if (previewCache) { cb(previewCache); return; }
    var key = 'nexus.nvPreviews.' + PREVIEW_VERSION;
    try { var c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && ORDER.every(function (k) { return c[k]; })) { previewCache = c; cb(c); return; } } catch (e) {}
    var out = {};
    // film scenes use their stills: only a 3D theme would need a WebGL context for a preview
    var needGl = ORDER.some(function (k) { return !THEMES[k].video; });
    if (needGl && !ensureGl()) { cb({}); return; }
    ORDER.forEach(function (k) {
      if (THEMES[k].video) { out[k] = k === 'clip_mix' ? 'clips/collapse.jpg' : 'clips/' + k.slice(5) + '.jpg'; return; }   // film stills
      try {
        var keepW = glc.width, keepH = glc.height, th = getTheme(k), prev = theme;
        theme = th; glc.width = 320; glc.height = 180; F.w = 320; F.h = 180;
        setMusic({ sub: .7, bass: .6, lowmid: .5, mid: .55, high: .5, air: .4, kick: .55, snare: .3, hat: .4, energy: .62, build: .2, phase: 6.15 }); M.live = true;
        try { for (var i = 0; i < 40; i++) { M.phase = 4 + i * .06; M.beat = Math.floor(M.phase); M.frac = M.phase - M.beat; F.t = 12 + i * .06; gl.viewport(0, 0, 320, 180); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); th.frame(60, F.t); } }
        finally {}
        out[k] = glc.toDataURL('image/jpeg', .85);
        glc.width = keepW; glc.height = keepH; F.w = keepW; F.h = keepH; theme = prev;
      } catch (e) { out[k] = out[k] || ''; }
    });
    musicReset();
    if (!cur) releaseAll();
    previewCache = out;
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('nexus.nvPreviews.') === 0 && k !== key) localStorage.removeItem(k); }); localStorage.setItem(key, JSON.stringify(out)); } catch (e) {}
    cb(out);
  }

  window.NXV = {
    order: ORDER, themes: THEMES, start: start, stop: stop, redraw: redraw, snapshot: snapshot, previews: previews, probe: probe,
    music: M, feed: feed6,
    // shared music analysis for other experiences (Liquid Dreams): advance it once per frame
    musicTick: function (now, dt) { return musicTick(now, dt); }, musicReset: musicReset, instance: function (k) { return THEMES[k] && ensureGl() ? getTheme(k) : null; },
    debug: function () { return { current: cur, frames: frames, q: Q, w: glc ? glc.width : 0, h: glc ? glc.height : 0, theme: theme && theme.debug ? theme.debug() : null, music: { kick: M.kick, snare: M.snare, hat: M.hat, energy: M.energy, bpm: M.bpm, live: M.live, phase: M.phase } }; }
  };
})();
