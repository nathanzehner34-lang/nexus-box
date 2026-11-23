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

  // ==================================================================
  // CHARACTER RIG — a 20-bone skeleton shared by the dancing themes.
  // Bones: 0 hips · 1 spine · 2 chest · 3 neck · 4 head · 5-7 left arm · 8-10 right arm
  //        11-13 left leg · 14-16 right leg · 17-19 extras (antennae, eye stalks, jaw)
  // Limbs hang straight down at rest (-y); characters face +z.
  // ==================================================================
  function rig(P) {
    var B = [];
    function bone(parent, x, y, z) { B.push({ parent: parent, off: [x, y, z] }); return B.length - 1; }
    bone(-1, 0, P.hip, 0);                           // 0 hips
    bone(0, 0, P.spine, 0);                          // 1
    bone(1, 0, P.chest, 0);                          // 2
    bone(2, 0, P.neck, 0);                           // 3
    bone(3, 0, P.head, 0);                           // 4
    bone(2, P.sw, P.sh, 0); bone(5, 0, -P.upper, 0); bone(6, 0, -P.fore, 0);       // 5 6 7  left (+x)
    bone(2, -P.sw, P.sh, 0); bone(8, 0, -P.upper, 0); bone(9, 0, -P.fore, 0);      // 8 9 10 right
    bone(0, P.hw, -P.hd, 0); bone(11, 0, -P.thigh, 0); bone(12, 0, -P.shin, 0);    // 11 12 13
    bone(0, -P.hw, -P.hd, 0); bone(14, 0, -P.thigh, 0); bone(15, 0, -P.shin, 0);   // 14 15 16
    (P.extras || []).forEach(function (e) { bone(e[0], e[1], e[2], e[3]); });
    while (B.length < MAXB) bone(0, 0, 0, 0);
    return B;
  }
  function Dancer(def) {
    this.def = def; this.bones = rig(def.rig);
    this.rot = []; this.vel = []; this.tgt = [];
    for (var i = 0; i < MAXB; i++) { this.rot.push([0, 0, 0]); this.vel.push([0, 0, 0]); this.tgt.push([0, 0, 0]); }
    this.world = []; for (i = 0; i < MAXB; i++) this.world.push(m4());
    this.mats = new Float32Array(MAXB * 16); this.tmp = m4();
    this.pos = [0, 0, 0]; this.yaw = 0; this.sq = 0; this.lift = 0; this.st = {};
    this.root = { x: 0, y: 0, z: 0, yaw: 0, lean: 0, roll: 0 };
    this.rootV = { x: 0, y: 0, z: 0, yaw: 0, lean: 0, roll: 0 };
  }
  // springs give fluid follow-through; stiffness k (higher = snappier)
  Dancer.prototype.settle = function (dt, k) {
    var s = Math.min(dt, 50) / 1000, d = 2 * Math.sqrt(k) * .82;
    for (var i = 0; i < MAXB; i++) for (var c = 0; c < 3; c++) {
      var v = this.vel[i][c]; v += ((this.tgt[i][c] - this.rot[i][c]) * k - v * d) * s; this.vel[i][c] = v; this.rot[i][c] += v * s;
    }
  };
  Dancer.prototype.settleRoot = function (dt, k, want) {
    var s = Math.min(dt, 50) / 1000, d = 2 * Math.sqrt(k) * .85;
    for (var key in want) { var v = this.rootV[key]; v += ((want[key] - this.root[key]) * k - v * d) * s; this.rootV[key] = v; this.root[key] += v * s; }
  };
  Dancer.prototype.pose = function () {
    var r = this.root, sq = this.sq, sy = 1 - sq * .16, sxz = 1 + sq * .08;
    var base = trs(this.tmp, this.pos[0] + r.x, this.pos[1] + r.y, this.pos[2] + r.z, r.lean, this.yaw + r.yaw, r.roll, sxz, sy, sxz);
    var local = this.loc || (this.loc = m4());
    for (var i = 0; i < MAXB; i++) {
      var b = this.bones[i], rr = this.rot[i];
      trs(local, b.off[0], b.off[1], b.off[2], rr[0], rr[1], rr[2]);
      mul(this.world[i], b.parent < 0 ? base : this.world[b.parent], local);
      this.mats.set(this.world[i], i * 16);
    }
  };
  Dancer.prototype.jointPos = function (i) { var w = this.world[i]; return [w[12], w[13], w[14]]; };
  // arm: forward (raise in front), out (raise to the side), twist, elbow bend; side +1 left / -1 right
  function arm(T, b0, side, fwd, out, twist, elbow, wrist) {
    T[b0][0] = -fwd; T[b0][1] = twist * side; T[b0][2] = out * side;
    T[b0 + 1][0] = -elbow; T[b0 + 1][1] = 0; T[b0 + 1][2] = 0;
    T[b0 + 2][0] = wrist || 0; T[b0 + 2][1] = 0; T[b0 + 2][2] = 0;
  }
  // leg: knee lift (0-1) and crouch (0-1); out spreads the leg sideways
  function leg(T, b0, side, lift, crouch, out, kick) {
    T[b0][0] = -(crouch * .85 + lift * 1.25) - (kick || 0); T[b0][1] = 0; T[b0][2] = (out || 0) * side;
    T[b0 + 1][0] = crouch * 1.55 + lift * 1.75 - (kick || 0) * .9; T[b0 + 1][1] = 0; T[b0 + 1][2] = 0;
    T[b0 + 2][0] = -crouch * .7 - lift * .4; T[b0 + 2][1] = 0; T[b0 + 2][2] = 0;
  }
  function zero(T) { for (var i = 0; i < T.length; i++) { T[i][0] = 0; T[i][1] = 0; T[i][2] = 0; } }

  // ==================================================================
  // THEME 1 — DANCING ALIENS
  // Four alien performers on an LED dance floor under a ringed planet.
  // Each has its own body, colours and dance style:
  //   ZORB (classic grey)      — robot popping, snaps to every beat, head ticks on hi-hats
  //   GLIM (one-eyed blob)     — bounces on the beat, squashes on every kick
  //   TENTACULA (octopod)      — liquid waves through all eight limbs, follows the mids
  //   KRELL (tall crested)     — disco points and spins, the drop-move specialist
  // ==================================================================
  var ALIEN_BG = [
    'vec3 sky(vec3 rd){',
    '  float y = rd.y;',
    '  vec3 c = mix(vec3(.05, .02, .12), vec3(.01, .0, .04), smoothstep(0., .6, y));',
    '  c += vec3(.25, .05, .35) * exp(-abs(y) * 9.) * (.6 + uM1.z * .5);',            // horizon glow pumps with the kick
    '  float az = atan(rd.x, -rd.z);',
    '  vec2 st = vec2(az * 40., y * 40.); vec2 ci = floor(st); float hs = hash(ci);',
    '  float star = step(.985, hs) * smoothstep(.5, .0, length(fract(st) - .5)) * (.6 + .4 * sin(uTime * 3. + hs * 50.)) * smoothstep(0., .15, y);',
    '  c += vec3(.8, .9, 1.) * star * (1. + uM2.x * 1.5);',
    // ringed planet
    '  vec3 pd = normalize(vec3(.55, .32, -1.));',
    '  float pa = acos(clamp(dot(rd, pd), -1., 1.));',
    '  float pr = .2;',
    '  if (pa < pr) {',
    '    vec3 q = normalize(rd - pd * dot(rd, pd)); float lat = dot(rd - pd, vec3(0., 1., 0.)) / pr;',
    '    float bands = sin(lat * 18. + noise(vec2(lat * 6., uTime * .05)) * 3.);',
    '    vec3 pc = mix(vec3(.9, .45, .25), vec3(.55, .25, .7), bands * .5 + .5);',
    '    float lit = smoothstep(pr, pr * .2, pa) * (.55 + .45 * dot(normalize(rd - pd + vec3(.0, .0, .0)), vec3(-.6, .4, .2)));',
    '    c = mix(c, pc * (.35 + lit), smoothstep(pr, pr * .96, pa));',
    '  }',
    '  vec3 rp = rd - pd; float rr = length(vec2(rp.x * 1., rp.y * 3.4 - rp.x * .9));',
    '  float ring = smoothstep(.012, .0, abs(rr - .33)) + smoothstep(.02, .0, abs(rr - .29)) * .6;',
    '  float behind = step(pr, pa) + step(0., rp.y * 3.4 - rp.x * .9);',
    '  c += vec3(.9, .7, 1.) * ring * .55 * min(1., behind) * (.7 + uM0.w * .6);',
    // aurora curtains: follow the mids and highs
    '  float au = sin(az * 3. + uTime * .3 + sin(az * 7. - uTime * .5)) * .5 + .5;',
    '  float band = smoothstep(.05, .2, y) * smoothstep(.55, .25, y + au * .1);',
    '  c += mix(vec3(.1, .9, .6), vec3(.6, .2, 1.), au) * band * au * (.12 + uM0.w * .5 + uM1.x * .3);',
    // alien ridge silhouette
    '  float ridge = .035 + noise(vec2(az * 3., 1.)) * .07 + noise(vec2(az * 11., 2.)) * .025;',
    '  c = mix(c, vec3(.02, .0, .05) + vec3(.2, .05, .3) * smoothstep(ridge, ridge - .03, y) * .2, smoothstep(ridge + .004, ridge - .002, y));',
    '  return c;',
    '}',
    'void main(){',
    '  vec3 rd = rayDir(); vec3 c;',
    '  if (rd.y < -.002) {',
    '    float t = -uCam.y / rd.y; vec3 p = uCam + rd * t;',
    '    vec2 g = p.xz / .9; vec2 id = floor(g), f = fract(g) - .5;',
    '    float lineD = .5 - max(abs(f.x), abs(f.y));',
    '    float dc = length(id + .5);',
    '    float ring = smoothstep(1.2, .0, abs(fract(dc * .18 - uM3.x * .25) - .5) * 9.);',          // rings travel outward with the beat
    '    float shock = smoothstep(1., .0, abs(dc * .9 - uX.x * 9.)) * (1. - uX.x);',                 // kick shockwave
    '    float flick = step(.9, hash(id + floor(uTime * 7.))) * uM2.x;',                              // hi-hat sparkle tiles
    '    float under = 0.;',
    '    for (int i = 0; i < 4; i++) under += exp(-pow(length(id + .5 - uSpot[i].xy / .9), 2.) * .9) * (.25 + uSpot[i].z);',
    '    float lvl = ring * (.12 + uM2.y * .45) + shock * 1.1 + flick * .8 + under * .35;',
    '    vec3 tc = pal(uM3.z + dc * .05 + hash(id) * .08);',
    '    c = vec3(.012, .008, .025) + tc * lvl * smoothstep(.0, .06, lineD) * .55;',               // dark glossy tiles that light in patterns
    '    c += tc * smoothstep(.035, .0, lineD) * (.18 + uM1.z * .55 + uM2.y * .2);',                 // neon grout lines pump with the kick
    '    c += sky(reflect(rd, vec3(0., 1., 0.))) * .32;',                                            // glossy floor reflection of the sky
    '    for (int i = 0; i < 4; i++) {',
    '      float d = length(p.xz - uSpot[i].xy);',
    '      c *= mix(.3, 1., smoothstep(.0, .6, d));',                                                  // contact shadow
    '      c += uSpotCol[i] * exp(-d * d * 1.4) * (.08 + uSpot[i].z * .55);',                         // coloured glow pool
    '    }',
    '    float fade = exp(-t * .06);',
    '    c = mix(sky(vec3(rd.x, .001, rd.z)), c, fade);',
    '  } else c = sky(rd);',
    '  vec2 uv = gl_FragCoord.xy / uRes - .5; c *= 1. - dot(uv, uv) * .7;',
    '  c += vec3(1., .85, 1.) * uM2.w * .25 * (1. - length(uv));',                         // drop flash
    '  gl_FragColor = vec4(c, 1.);',
    '}'].join('\n');

  // ---- the four aliens: rigs and bodies ----
  var ALIENS = [
    { name: 'Zorb', style: 'robot', col: [.42, .78, .52], eye: [.2, 1, .9], glow: [.2, 1, .55], x: -2.5, z: -.15,
      rig: { hip: .95, spine: .16, chest: .22, neck: .2, head: .1, sw: .2, sh: .17, upper: .3, fore: .28, hw: .1, hd: .05, thigh: .43, shin: .43,
        extras: [[4, .1, .5, 0], [4, -.1, .5, 0]] },
      build: function (m, c) {
        var skin = c, dark = [.02, .03, .05];
        ellipsoid(m, 0, [0, 0, 0], [.14, .1, .1], skin);
        torus(m, 0, [0, .02, 0], .14, .022, [1, .25, .8], { em: 1.4, pat: 4, ts: 6, seg: 24 });
        ellipsoid(m, 1, [0, .1, 0], [.13, .17, .1], skin);
        ellipsoid(m, 2, [0, .08, 0], [.17, .15, .12], skin, { pat: 1 });
        ellipsoid(m, 2, [0, .08, .11], [.05, .05, .02], [1, .3, .85], { em: 1.6, pat: 4 });
        limb(m, 3, [0, -.02, 0], [0, .14, 0], .045, .04, skin);
        ellipsoid(m, 4, [0, .26, 0], [.3, .33, .29], skin, { seg: 26, rows: 16, pat: 1, deform: function (p) { var k = .5 + .5 * smooth(-.33, .12, p[1]); return [p[0] * k, p[1], p[2] * (k * .9 + .1)]; } });
        [1, -1].forEach(function (s) {
          ellipsoid(m, 4, [.125 * s, .27, .22], [.105, .055, .05], dark, { rot: [0, -.35 * s, .45 * s], em: 1, pat: 2, seg: 18 });
        });
        ellipsoid(m, 4, [0, .07, .22], [.035, .008, .01], dark);
        [17, 18].forEach(function (b) { limb(m, b, [0, 0, 0], [0, .24, 0], .014, .009, skin, { seg: 6, rings: 2 }); ellipsoid(m, b, [0, .26, 0], [.04, .04, .04], [.3, 1, .6], { em: 2, pat: 4 }); });
        [5, 8].forEach(function (b) { ellipsoid(m, b, [0, 0, 0], [.06, .06, .06], skin); limb(m, b, [0, 0, 0], [0, -.3, 0], .045, .036, skin); });
        [6, 9].forEach(function (b) { limb(m, b, [0, 0, 0], [0, -.28, 0], .036, .028, skin); });
        [7, 10].forEach(function (b) { ellipsoid(m, b, [0, -.04, 0], [.04, .05, .025], skin); for (var f = -1; f <= 1; f++) limb(m, b, [f * .022, -.07, 0], [f * .035, -.15, .01], .011, .008, skin, { seg: 6, rings: 1 }); });
        [11, 14].forEach(function (b) { limb(m, b, [0, 0, 0], [0, -.43, 0], .062, .045, skin); });
        [12, 15].forEach(function (b) { limb(m, b, [0, 0, 0], [0, -.43, 0], .045, .036, skin); });
        [13, 16].forEach(function (b) { ellipsoid(m, b, [0, -.02, .06], [.055, .03, .11], skin); });
      } },
    { name: 'Glim', style: 'bounce', col: [1, .38, .62], eye: [.3, .9, 1], glow: [1, .3, .7], x: -.85, z: .45,
      rig: { hip: .52, spine: .12, chest: .3, neck: .24, head: .08, sw: .44, sh: .02, upper: .17, fore: .15, hw: .2, hd: .04, thigh: .22, shin: .22,
        extras: [[2, .2, .42, 0], [2, -.2, .42, 0]] },
      build: function (m, c) {
        var white = [.95, .95, 1], dark = [.02, .02, .05];
        ellipsoid(m, 1, [0, .3, 0], [.52, .5, .47], c, { seg: 30, rows: 18, pat: 1, deform: function (p) { var k = 1 + .08 * smooth(.2, -.4, p[1]); return [p[0] * k, p[1], p[2] * k]; } });
        ellipsoid(m, 2, [0, .08, .36], [.22, .22, .14], white, { seg: 24 });
        ellipsoid(m, 2, [0, .08, .47], [.12, .12, .05], dark, { em: 1.2, pat: 2, seg: 20 });
        ellipsoid(m, 2, [.04, .12, .515], [.025, .025, .01], white, { em: 1.5, pat: 4 });
        torus(m, 2, [0, -.2, .43], .14, .025, dark, { arc: Math.PI, rot: [Math.PI / 2 + .3, 0, Math.PI], seg: 16, ts: 6 });
        [17, 18].forEach(function (b, i) { cone(m, b, [0, 0, 0], [(i ? -1 : 1) * .06, .2, 0], .055, c); ellipsoid(m, b, [(i ? -1 : 1) * .06, .21, 0], [.035, .035, .035], [.4, .95, 1], { em: 2, pat: 4 }); });
        [5, 8].forEach(function (b) { limb(m, b, [0, 0, 0], [0, -.17, 0], .055, .045, c); });
        [6, 9].forEach(function (b) { limb(m, b, [0, 0, 0], [0, -.15, 0], .045, .04, c); });
        [7, 10].forEach(function (b) { ellipsoid(m, b, [0, -.05, 0], [.06, .06, .06], c); });
        [11, 14].forEach(function (b) { limb(m, b, [0, 0, 0], [0, -.22, 0], .08, .07, c); });
        [12, 15].forEach(function (b) { limb(m, b, [0, 0, 0], [0, -.22, 0], .07, .06, c); });
        [13, 16].forEach(function (b) { ellipsoid(m, b, [0, -.02, .05], [.1, .06, .14], [.95, .28, .55]); });
      } },
    { name: 'Tentacula', style: 'noodle', col: [.55, .3, .95], eye: [1, .9, .3], glow: [.65, .3, 1], x: .85, z: .45,
      rig: { hip: .85, spine: .2, chest: .22, neck: .14, head: .12, sw: .18, sh: .12, upper: .3, fore: .28, hw: .12, hd: .02, thigh: .3, shin: .3,
        extras: [[4, 0, .4, .08], [4, .14, .34, .05], [4, -.14, .34, .05]] },
      build: function (m, c) {
        var white = [.98, .95, .85], dark = [.02, .01, .04], belly = [.85, .55, 1];
        ellipsoid(m, 0, [0, .02, 0], [.2, .14, .17], c, { pat: 1 });
        ellipsoid(m, 1, [0, .12, 0], [.19, .2, .16], c, { pat: 1 });
        ellipsoid(m, 1, [0, .1, .1], [.13, .16, .08], belly);
        ellipsoid(m, 2, [0, .06, 0], [.17, .14, .14], c, { pat: 1 });
        ellipsoid(m, 4, [0, .2, 0], [.27, .3, .25], c, { seg: 24, rows: 14, pat: 1, deform: function (p) { var k = 1 - .25 * smooth(.0, .3, p[1]); return [p[0] * k, p[1] + .04 * Math.sin(p[0] * 9) * smooth(.1, .3, p[1]), p[2] * k]; } });
        torus(m, 4, [0, .02, .2], .07, .018, dark, { arc: Math.PI, rot: [Math.PI / 2 + .2, 0, Math.PI], seg: 12, ts: 5 });
        [17, 18, 19].forEach(function (b) { limb(m, b, [0, 0, 0], [0, .17, 0], .025, .018, c, { seg: 8, rings: 2 }); ellipsoid(m, b, [0, .2, 0], [.06, .06, .06], white, { seg: 16 }); ellipsoid(m, b, [0, .2, .045], [.03, .03, .02], dark, { em: 1.4, pat: 2 }); });
        // tentacle limbs: tapering chains with glowing suckers
        [[5, .06], [6, .045], [7, .032], [8, .06], [9, .045], [10, .032]].forEach(function (s) { limb(m, s[0], [0, 0, 0], [0, -.3, 0], s[1], s[1] * .76, c, { pat: 1, seg: 10 }); });
        [[11, .085], [12, .062], [13, .042], [14, .085], [15, .062], [16, .042]].forEach(function (s) { limb(m, s[0], [0, 0, 0], [0, -.31, 0], s[1], s[1] * .74, c, { pat: 1, seg: 10 }); });
        [13, 16].forEach(function (b) { ellipsoid(m, b, [0, -.32, .02], [.035, .025, .05], belly); });
      } },
    { name: 'Krell', style: 'disco', col: [.18, .38, 1], eye: [1, .85, .2], glow: [.25, .85, 1], x: 2.5, z: -.15,
      rig: { hip: 1.15, spine: .22, chest: .3, neck: .22, head: .1, sw: .25, sh: .2, upper: .4, fore: .38, hw: .12, hd: .05, thigh: .53, shin: .54,
        extras: [[4, 0, .38, -.05]] },
      build: function (m, c) {
        var dark = [.02, .02, .06], pad = [.9, .45, .15];
        ellipsoid(m, 0, [0, 0, 0], [.15, .12, .11], c, { pat: 5 });
        ellipsoid(m, 1, [0, .12, 0], [.13, .2, .1], c, { pat: 5 });
        ellipsoid(m, 2, [0, .12, 0], [.22, .19, .13], c, { pat: 5 });
        cone(m, 2, [0, .2, .125], [0, .02, .14], .07, [.3, .95, 1], { em: 1.8, pat: 4 });
        [1, -1].forEach(function (s) { ellipsoid(m, 2, [.24 * s, .22, 0], [.11, .07, .1], pad, { em: .5, pat: 6 }); });
        limb(m, 3, [0, -.02, 0], [0, .14, 0], .05, .045, c);
        ellipsoid(m, 4, [0, .16, -.02], [.15, .21, .19], c, { seg: 24, rows: 14, rot: [-.35, 0, 0], pat: 5 });
        for (var k = 0; k < 5; k++) ellipsoid(m, 4, [0, .3 - k * .02, -.06 - k * .07], [.015, .09 - k * .012, .06], [.3, .9, 1], { em: 1.4, pat: 4, seg: 10 });
        [[0, .25], [-.07, .19], [.07, .19]].forEach(function (e) { ellipsoid(m, 4, [e[0], e[1], .15], [.03, .02, .02], dark, { em: 1.6, pat: 2, seg: 12 }); });
        ellipsoid(m, 4, [0, .06, .16], [.05, .012, .02], dark);
        [5, 8].forEach(function (b) { ellipsoid(m, b, [0, 0, 0], [.065, .065, .065], c); limb(m, b, [0, 0, 0], [0, -.4, 0], .05, .04, c, { pat: 5 }); });
        [6, 9].forEach(function (b) { limb(m, b, [0, 0, 0], [0, -.38, 0], .04, .032, c, { pat: 5 }); torus(m, b, [0, -.3, 0], .045, .012, [.3, .9, 1], { em: 1.6, pat: 4, seg: 14, ts: 5 }); });
        [7, 10].forEach(function (b) { ellipsoid(m, b, [0, -.05, 0], [.035, .06, .025], c); for (var f = -1; f <= 1; f++) limb(m, b, [f * .02, -.09, 0], [f * .03, -.19, .01], .01, .007, c, { seg: 6, rings: 1 }); });
        [11, 14].forEach(function (b) { limb(m, b, [0, 0, 0], [0, -.53, 0], .07, .05, c, { pat: 5 }); });
        [12, 15].forEach(function (b) { limb(m, b, [0, 0, 0], [0, -.54, 0], .05, .04, c, { pat: 5 }); });
        [13, 16].forEach(function (b) { ellipsoid(m, b, [0, -.02, .07], [.055, .035, .13], dark, { pat: 6 }); });
      } }
  ];

  // dance styles: write target rotations into d.tgt and return the wanted root motion
  var ROBOT_POSES = [
    [[0, .1, 0, 1.6], [0, .1, 0, 1.6]], [[1.55, 0, 0, 0], [0, .15, 0, .2]], [[0, 1.55, 0, 0], [0, 1.55, 0, 0]], [[0, 1.5, 0, -1.4], [0, 1.5, 0, 1.4]],
    [[2.8, .2, 0, 0], [0, .1, 0, .1]], [[0, .1, 0, .1], [2.8, .2, 0, 0]], [[1.55, 0, 1.5, 1.55], [1.55, 0, -1.5, 1.55]], [[0, 1.55, 0, 1.55], [0, .2, 0, 2.2]]
  ];
  function danceRobot(d, m, t, amp) {
    var T = d.tgt, st = d.st, b = m.beat + (m.frac > .92 ? 1 : 0);
    if (st.lastBeat !== b) { st.lastBeat = b; st.pose = (b * 5 + (m.bar % 3)) % ROBOT_POSES.length; st.step = (st.step || 1) * -1; }
    var P = ROBOT_POSES[st.pose], a = .35 + .65 * amp;
    zero(T);
    arm(T, 5, 1, P[0][0] * a, P[0][1] * a + .08, P[0][2], P[0][3] * a, 0);
    arm(T, 8, -1, P[1][0] * a, P[1][1] * a + .08, P[1][2], P[1][3] * a, 0);
    if (st.hat !== m.hatN) { st.hat = m.hatN; st.tick = ((st.tick || 0) + 1) % 4; }
    T[4][1] = [.0, .35, 0, -.35][st.tick || 0] * a; T[4][0] = -m.kick * .25;
    T[2][1] = st.step * .18 * a; T[1][2] = st.step * .05 * a;
    var crouch = m.kick * .45 * a + .08;
    leg(T, 11, 1, st.step > 0 ? .25 * a * (1 - m.frac) : 0, crouch, .05); leg(T, 14, -1, st.step < 0 ? .25 * a * (1 - m.frac) : 0, crouch, .05);
    T[17][2] = Math.sin(t * 9) * .2 * m.high + .15; T[18][2] = -Math.sin(t * 9 + 1) * .2 * m.high - .15;
    T[17][0] = -m.hat * .5; T[18][0] = -m.hat * .5;
    return { x: st.step * .12 * a, y: -crouch * .17, z: 0, yaw: st.step * .12 * a, lean: 0, roll: 0, k: 300 };
  }
  function danceBounce(d, m, t, amp) {
    var T = d.tgt, st = d.st, f = m.frac, a = .3 + .7 * amp;
    zero(T);
    var jump = Math.sin(Math.PI * f) * .32 * a * (m.live ? 1 : .2);
    var flap = Math.sin(m.phase * Math.PI * 2) * a;
    arm(T, 5, 1, .2, .7 + flap * .9, 0, .3 + m.snare * .8, 0);
    arm(T, 8, -1, .2, .7 + flap * .9, 0, .3 + m.snare * .8, 0);
    var tuck = Math.sin(Math.PI * f) * a;
    leg(T, 11, 1, tuck * .55, m.kick * .5, .15); leg(T, 14, -1, tuck * .55, m.kick * .5, .15);
    T[2][0] = -m.kick * .2; T[1][2] = Math.sin(m.phase * Math.PI) * .18 * a;
    T[17][2] = .2 + m.high * .4 * Math.sin(t * 14); T[18][2] = -.2 - m.high * .4 * Math.sin(t * 14 + 2);
    if (st.drop !== m.kickN && m.dropEnv > .95) { st.drop = m.kickN; st.spin = (st.spin || 0) + Math.PI * 2; }
    return { x: Math.sin(m.phase * Math.PI) * .22 * a, y: jump - m.kick * .06, z: 0, yaw: st.spin || 0, lean: 0, roll: Math.sin(m.phase * Math.PI) * .12 * a, k: 140 };
  }
  function danceNoodle(d, m, t, amp) {
    var T = d.tgt, a = .3 + .7 * amp, w = m.phase * Math.PI, flow = .45 + m.mid * .9;
    zero(T);
    for (var s = 0; s < 2; s++) {
      var side = s ? -1 : 1, b0 = s ? 8 : 5, l0 = s ? 14 : 11, off = s * 1.4;
      T[b0][2] = side * (.6 + Math.sin(w + off) * .5 * a); T[b0][0] = -Math.sin(w * .5 + off) * .6 * a;
      T[b0 + 1][2] = side * Math.sin(w + 1 + off) * .8 * a * flow; T[b0 + 1][0] = -Math.cos(w + off) * .4 * a;
      T[b0 + 2][2] = side * Math.sin(w + 2 + off) * 1.1 * a * flow;
      T[l0][2] = side * (.25 + Math.sin(w + off + 2) * .25 * a); T[l0][0] = Math.sin(w * .5 + off) * .25 * a - m.kick * .3;
      T[l0 + 1][2] = side * Math.sin(w + 3 + off) * .5 * a * flow; T[l0 + 1][0] = .3 + m.kick * .5;
      T[l0 + 2][2] = side * Math.sin(w + 4 + off) * .8 * a * flow; T[l0 + 2][0] = .4;
    }
    T[1][2] = Math.sin(w) * .2 * a; T[2][2] = Math.sin(w - .8) * .22 * a; T[4][2] = Math.sin(w - 1.6) * .25 * a; T[4][0] = -m.kick * .2;
    for (var e = 17; e < 20; e++) { T[e][2] = Math.sin(t * 2.4 + e) * (.15 + m.high * .5); T[e][0] = Math.cos(t * 2 + e * 2) * (.12 + m.hat * .4); }
    return { x: Math.sin(w * .5) * .15 * a, y: -m.kick * .1 - .03, z: 0, yaw: Math.sin(w * .25) * .5 * a, lean: 0, roll: Math.sin(w) * .06 * a, k: 70 };
  }
  function danceDisco(d, m, t, amp) {
    var T = d.tgt, st = d.st, a = .3 + .7 * amp, up = (m.beat & 1) === 0;
    zero(T);
    if (st.variant !== (m.bar >> 3) % 2) st.variant = (m.bar >> 3) % 2;
    if (st.variant === 0) {        // the classic point: up-and-across, down-and-across
      arm(T, 8, -1, up ? 2.6 * a : .5 * a, up ? .5 : -.3, 0, up ? 0 : .2, 0);
      arm(T, 5, 1, .35, .55, 0, 1.6, 0);
    } else {                        // running-man arms pumping in time
      var pump = Math.sin(m.phase * Math.PI);
      arm(T, 5, 1, .9 + pump * .7 * a, .2, 0, 1.5, 0); arm(T, 8, -1, .9 - pump * .7 * a, .2, 0, 1.5, 0);
    }
    var sway = Math.sin(m.phase * Math.PI);
    leg(T, 11, 1, sway > 0 ? sway * .3 * a : 0, .15 + m.kick * .35, .08); leg(T, 14, -1, sway < 0 ? -sway * .3 * a : 0, .15 + m.kick * .35, .08);
    T[1][2] = sway * .14 * a; T[2][2] = -sway * .1 * a; T[4][0] = -m.kick * .3 + .05; T[4][2] = -sway * .15 * a;
    T[17][0] = -m.hat * .3;
    if (m.dropEnv > .95 && st.drop !== m.kickN) { st.drop = m.kickN; st.spin = (st.spin || 0) + Math.PI * 2; }
    if (m.snareHit && st.v === undefined) st.v = 0;
    return { x: sway * .2 * a, y: -(.15 + m.kick * .35) * .2, z: 0, yaw: (st.spin || 0) + sway * .2 * a, lean: 0, roll: sway * .05 * a, k: 120 };
  }
  var STYLES = { robot: danceRobot, bounce: danceBounce, noodle: danceNoodle, disco: danceDisco };

  function makeSparkles(n, seed, box) {
    var R = rng(seed), P = [];
    for (var i = 0; i < n; i++) P.push({ x: mix(box[0], box[1], R()), y: mix(box[2], box[3], R()), z: mix(box[4], box[5], R()), vx: 0, vy: .1 + R() * .25, vz: 0, h: R(), s: .5 + R(), ph: R() * 6.28 });
    return P;
  }

  var THEMES = {};
  THEMES.aliens = {
    id: 'aliens', name: 'Dancing Aliens', bg: ALIEN_BG,
    init: function () {
      var self = this;
      this.dancers = ALIENS.map(function (def) {
        var d = new Dancer(def), m = new Mesh(); def.build(m, def.col);
        d.mesh = upload(m); d.pos = [def.x, 0, def.z];
        d.yaw = Math.atan2(-def.x * .35, 6);
        return d;
      });
      this.verts = this.dancers.reduce(function (n, d) { return n + d.mesh.verts; }, 0);
      this.spark = makeSparkles(HIGH ? 220 : 130, 77, [-6, 6, .3, 4.5, -4, 2.5]);
      this.addData = new Float32Array((this.spark.length + 4 * 12 + 8) * 8);
      this.wave = 1; this.hue = .55;
      return self;
    },
    free: function () { this.dancers.forEach(function (d) { freeMesh(d.mesh); }); },
    frame: function (dt, t) {
      var m = M, amp = m.live ? sat(.2 + m.energy * 1.25 + m.build * .2) : .12;
      this.hue += dt / 1000 * (.01 + m.energy * .03) + (m.drop ? .25 : 0);
      F.hue = this.hue;
      if (m.kickHit) this.wave = 0; this.wave = Math.min(1, this.wave + dt / 900);
      // camera: slow orbit, leans in on build-ups, punches on the drop, tiny kick shake
      var ang = Math.sin(t * .06) * .5 + Math.sin(t * .023) * .22, rad = 5.9 - m.build * .6 - m.dropEnv * .9;
      var shake = m.kick * .03;
      var eye = [Math.sin(ang) * rad + Math.sin(t * 31) * shake, 1.45 + Math.sin(t * .11) * .3 + m.dropEnv * .25, Math.cos(ang) * rad + .6];
      setCamera(eye, [0, 1.08 + m.kick * .03, .2], .82 - m.dropEnv * .07, Math.sin(t * .17) * .02);
      // dancers
      this.dancers.forEach(function (d) {
        var want = STYLES[d.def.style](d, m, t, amp);
        d.settle(dt, want.k); d.settleRoot(dt, 90, { x: want.x, y: want.y, z: 0, yaw: want.yaw, lean: want.lean, roll: want.roll });
        d.sq += (m.kick * (d.def.style === 'bounce' ? 1.3 : .7) - d.sq) * Math.min(1, dt / 40);
        d.pose();
      });
      var self = this;
      drawBackground(this, function (p) {
        var spots = [], cols = [];
        self.dancers.forEach(function (d) { var h = d.jointPos(0); spots.push(h[0], h[2], m.kick * .6 + m.energy * .4, 0); cols.push(d.def.glow[0], d.def.glow[1], d.def.glow[2]); });
        gl.uniform4fv(p.u('uSpot[0]'), spots); gl.uniform3fv(p.u('uSpotCol[0]'), cols);
        gl.uniform4f(p.u('uX'), self.wave, 0, 0, 0);
      });
      var rimA = hsv(this.hue, .8, .9 + m.kick * .4), rimB = hsv(this.hue + .45, .8, .9 + m.snare * .4);
      var p = beginMeshes({ key: [.45, .85, .75], keyCol: [1.05, .98, 1.08], rimA: rimA, rimB: rimB, sky: [.22, .16, .4], ground: [.12, .05, .16], fog: [.06, .02, .1], fogD: .035, glow: 1 + m.energy * .4 });
      drawReflections(p, this.dancers.map(function (d) { return [d.mesh, d.mats, d.def.eye]; }));
      this.dancers.forEach(function (d) { drawMesh(p, d.mesh, d.mats, d.def.eye, [1, 1, 1]); });
      // light beams from above + sparkles
      var o = 0, A_ = this.addData;
      for (var i = 0; i < 4; i++) {
        var bx = -3 + i * 2, tx = bx * .6 + Math.sin(t * .6 + i * 1.7 + m.phase * .25) * 1.6, tz = .4 + Math.sin(t * .45 + i * 2.3) * 1.3;
        var c = hsv(this.hue + i * .17, .7, 1), it = (.12 + m.kick * .3 + m.snare * .2 + m.dropEnv * .5) * (m.live ? 1 : .5);
        o = beam(A_, o, [bx, 6.5, -2.5], [tx, 0, tz], .06, .7, c, it);
      }
      var beamVerts = o / 8;
      var spd = dt / 1000;
      for (i = 0; i < this.spark.length; i++) {
        var s = this.spark[i];
        if (m.drop) { var dx = s.x, dz = s.z - .3, l = Math.hypot(dx, s.y - 1, dz) || 1; s.vx += dx / l * 3; s.vz += dz / l * 3; s.vy += 1.5; }
        s.vx *= .97; s.vz *= .97; s.vy += (.18 + m.bass * .3 - s.vy) * .02;
        s.x += s.vx * spd + Math.sin(t * .5 + s.ph) * .1 * spd; s.y += s.vy * spd; s.z += s.vz * spd;
        if (s.y > 4.8 || Math.abs(s.x) > 7 || s.z > 3 || s.z < -5) { s.y = .2; s.x = (Math.random() - .5) * 12; s.z = Math.random() * 6 - 4; s.vx = s.vz = 0; }
        var col = hsv(this.hue + s.h * .4, .6, 1), tw = .35 + .65 * Math.max(0, Math.sin(t * 4 + s.ph * 3)) + m.hat * .8;
        A_[o++] = s.x; A_[o++] = s.y; A_[o++] = s.z; A_[o++] = col[0]; A_[o++] = col[1]; A_[o++] = col[2]; A_[o++] = tw * .7; A_[o++] = .05 * s.s * (1 + m.bass * .6);
      }
      drawAdditive(A_, beamVerts, gl.TRIANGLES, false);
      drawAdditive(A_.subarray(beamVerts * 8), this.spark.length, gl.POINTS, true);
    },
    debug: function () {
      return { verts: this.verts, dancers: this.dancers.map(function (d) { return { name: d.def.name, head: d.jointPos(4), handL: d.jointPos(7), handR: d.jointPos(10), hips: d.jointPos(0), sq: d.sq }; }) };
    }
  };

  // ==================================================================
  // THEME 2 — DANCING SKELETONS
  // A five-skeleton crew dancing in perfect sync in a moonlit graveyard. Real anatomy (skull with a
  // hinged jaw, ribcage, spine, pelvis, paired forearm and shin bones), ember eyes, a top-hatted
  // lead in the middle. The routine changes every four bars; drops launch a jump-spin and a head pop.
  // ==================================================================
  var SKELETON_BG = [
    'vec3 sky(vec3 rd){',
    '  float y = rd.y, az = atan(rd.x, -rd.z);',
    '  vec3 c = mix(vec3(.05, .07, .09), vec3(.0, .01, .03), smoothstep(-.02, .5, y));',
    '  vec3 md = normalize(vec3(-.25, .3, -1.)); float ma = acos(clamp(dot(rd, md), -1., 1.));',
    '  float moon = smoothstep(.135, .125, ma);',
    '  float crater = noise((rd.xy - md.xy) * 60.) * .5 + noise((rd.xy - md.xy) * 150.) * .25;',
    '  c += vec3(.85, 1., .82) * moon * (.75 + crater * .3) * (.9 + uM0.x * .25);',
    '  c += vec3(.25, .5, .35) * exp(-ma * 7.) * (.35 + uM0.x * .5 + uM1.z * .3);',              // halo breathes with the bass
    '  float cl = noise(vec2(az * 3. + uTime * .02, y * 9.)) * .6 + noise(vec2(az * 9. - uTime * .03, y * 25.)) * .4;',
    '  c = mix(c, vec3(.06, .08, .1) + vec3(.3, .45, .35) * exp(-ma * 4.) * .4, smoothstep(.55, .8, cl) * smoothstep(.05, .2, y) * .8);',
    '  vec2 st = vec2(az * 50., y * 50.); float hs = hash(floor(st));',
    '  c += vec3(.7, .9, 1.) * step(.99, hs) * smoothstep(.45, .0, length(fract(st) - .5)) * smoothstep(.1, .3, y) * (1. - moon);',
    '  c += vec3(.75, .8, 1.) * uX.y * smoothstep(.0, .3, y) * (.6 + .4 * noise(vec2(az * 20., uTime * 30.)));',   // drop lightning
    // graveyard silhouette: hill, tombstones, crosses, bare trees
    '  float hill = .03 + noise(vec2(az * 2., 4.)) * .05;',
    '  float cell = floor(az * 14.), fx = fract(az * 14.) - .5, hh = hash(vec2(cell, 3.));',
    '  float stone = step(.35, hh) * step(abs(fx), .18) * step(y, hill + .025 + hh * .03 - max(0., abs(fx) - .1) * .4 * step(.6, hh));',
    '  float crossV = step(.85, hh) * step(abs(fx), .03) * step(y, hill + .08), crossH = step(.85, hh) * step(abs(fx), .1) * step(abs(y - hill - .055), .012);',
    '  float tcell = floor(az * 4.), tx = fract(az * 4.) - .5, th = hash(vec2(tcell, 9.));',
    '  float trunk = step(.55, th) * step(abs(tx + sin(y * 30.) * .01), .012 * (1. - (y - hill) * 3.)) * step(y, hill + .22);',
    '  float branch = step(.55, th) * step(hill + .08, y) * step(y, hill + .24) * step(abs(abs(tx) - (y - hill - .08) * .9), .006);',
    '  float sil = max(max(step(y, hill), stone), max(max(crossV, crossH), max(trunk, branch)));',
    '  c = mix(c, vec3(.01, .015, .02), sil);',
    '  c += vec3(.25, .4, .3) * exp(-max(0., y - hill) * 30.) * .25 * (1. - sil);',               // ground mist on the horizon
    '  return c;',
    '}',
    'void main(){',
    '  vec3 rd = rayDir(); vec3 c;',
    '  if (rd.y < -.002) {',
    '    float t = -uCam.y / rd.y; vec3 p = uCam + rd * t;',
    '    vec2 q = p.xz * 2.2; vec2 id = floor(q + .5 * floor(mod(q.y, 2.)) * vec2(1., 0.)); vec2 f = fract(q + .5 * floor(mod(q.y, 2.)) * vec2(1., 0.)) - .5;',
    '    float edge = smoothstep(.5, .4, max(abs(f.x), abs(f.y)));',
    '    float tone = .05 + hash(id) * .04 + noise(p.xz * 3.) * .03;',
    '    c = vec3(tone * .9, tone, tone * 1.05) * edge;',
    '    float r = length(p.xz - vec2(0., .1));',                                           // rune circle under the crew
    '    float ring = smoothstep(.04, .0, abs(r - 3.6)) + smoothstep(.03, .0, abs(r - 3.3));',
    '    float ang = atan(p.z - .1, p.x);',
    '    float runes = step(3.33, r) * step(r, 3.57) * step(.55, hash(vec2(floor(ang * 12.), 1.))) * step(abs(fract(ang * 12. / 6.28318 * 6.28318 / 6.28318 * 12.) - .5), .3);',
    '    vec3 rc = mix(vec3(.2, 1., .55), vec3(.6, .3, 1.), .5 + .5 * sin(uM3.z * 6.28));',
    '    c += rc * (ring * (.35 + uM1.z * 1.6) + runes * (.2 + uM1.z * 1.1)) * (1. + uM2.w);',
    '    float pulse = smoothstep(.6, .0, abs(r - uX.x * 7.)) * (1. - uX.x);',             // kick ripple across the stones
    '    c += rc * pulse * .5;',
    '    for (int i = 0; i < 4; i++) { float d = length(p.xz - uSpot[i].xy); c *= mix(.35, 1., smoothstep(.0, .5, d)); c += uSpotCol[i] * exp(-d * d * 2.) * uSpot[i].z * .4; }',
    '    float mist = (.25 + uM0.w * .35) * (.6 + .4 * noise(p.xz * .6 + vec2(uTime * .15, 0.)));',
    '    c = mix(c, vec3(.16, .24, .2), mist * (1. - exp(-t * .09)) + mist * .25);',
    '    c = mix(sky(vec3(rd.x, .001, rd.z)), c, exp(-t * .045));',
    '  } else c = sky(rd);',
    '  vec2 uv = gl_FragCoord.xy / uRes - .5; c *= 1. - dot(uv, uv) * .9;',
    '  gl_FragColor = vec4(c, 1.);',
    '}'].join('\n');

  var BONE = [.93, .89, .8];
  function buildSkeleton(m, opts) {
    var bone = BONE, dark = [.01, .01, .015], P = { pat: 3, em: .1 };
    function o(extra) { var r = { pat: 3, em: .1 }; for (var k in extra) r[k] = extra[k]; return r; }
    // pelvis: two iliac wings and the sacrum
    [1, -1].forEach(function (sd) { ellipsoid(m, 0, [.075 * sd, .03, -.015], [.065, .055, .03], bone, o({ rot: [0, .55 * sd, .3 * sd] })); });
    ellipsoid(m, 0, [0, -.03, -.03], [.05, .07, .04], bone, P);
    torus(m, 0, [0, -.05, .02], .06, .016, bone, o({ seg: 14, ts: 5, arc: Math.PI, rot: [Math.PI / 2, 0, 0] }));
    // spine: vertebrae up the lower back and neck
    for (var v = 0; v < 5; v++) ellipsoid(m, 1, [0, .02 + v * .045, -.03], [.03, .018, .028], bone, o({ seg: 10, rows: 5 }));
    for (v = 0; v < 4; v++) ellipsoid(m, 3, [0, .0 + v * .045, -.01], [.022, .016, .022], bone, o({ seg: 10, rows: 5 }));
    // ribcage: sternum, five pairs of ribs, clavicles
    ellipsoid(m, 2, [0, .08, .12], [.025, .1, .015], bone, P);
    for (var r = 0; r < 5; r++) {
      var y = .17 - r * .045, R = .12 + Math.sin((r + 1) / 6 * Math.PI) * .03;
      torus(m, 2, [0, y, .01], R, .011, bone, o({ seg: 14, ts: 4, arc: Math.PI * .92, rot: [-.25, Math.PI / 2 + .25, 0] }));
      torus(m, 2, [0, y, .01], R, .011, bone, o({ seg: 14, ts: 4, arc: Math.PI * .92, rot: [-.25, -Math.PI / 2 - .25, Math.PI] }));
    }
    for (v = 0; v < 6; v++) ellipsoid(m, 2, [0, .0 + v * .04, -.09], [.028, .018, .025], bone, o({ seg: 10, rows: 5 }));
    [1, -1].forEach(function (sd) { limb(m, 2, [.02 * sd, .2, .07], [.16 * sd, .21, -.01], .012, .01, bone, o({ seg: 6, rings: 2 })); });
    // skull: cranium, cheekbones, sockets with ember eyes, nasal hole, upper teeth; the jaw is its own bone (17)
    ellipsoid(m, 4, [0, .17, -.01], [.12, .13, .145], bone, o({ seg: 22, rows: 14, deform: function (p) { var k = 1 - .18 * smooth(.0, -.13, p[1]) * smooth(-.05, .14, p[2]); return [p[0] * k, p[1], p[2]]; } }));
    ellipsoid(m, 4, [0, .1, .06], [.095, .07, .08], bone, P);
    [1, -1].forEach(function (sd) {
      ellipsoid(m, 4, [.045 * sd, .14, .118], [.035, .033, .025], dark, { seg: 14 });
      ellipsoid(m, 4, [.045 * sd, .14, .125], [.013, .013, .01], [1, .45, .1], { em: 2.2, pat: 4, seg: 10 });
      ellipsoid(m, 4, [.075 * sd, .1, .09], [.03, .02, .03], bone, P);
    });
    ellipsoid(m, 4, [0, .098, .135], [.013, .02, .01], dark, { seg: 10 });
    for (var tt = -3; tt <= 3; tt++) ellipsoid(m, 4, [tt * .012, .062, .128 - Math.abs(tt) * .004], [.0065, .012, .007], [.98, .96, .9], { seg: 6, rows: 4, pat: 3 });
    torus(m, 17, [0, -.035, .03], .065, .013, bone, o({ seg: 16, ts: 5, arc: Math.PI, rot: [0, Math.PI, 0] }));
    ellipsoid(m, 17, [0, -.04, .085], [.04, .02, .025], bone, P);
    for (tt = -3; tt <= 3; tt++) ellipsoid(m, 17, [tt * .012, -.018, .095 - Math.abs(tt) * .004], [.006, .011, .006], [.98, .96, .9], { seg: 6, rows: 4, pat: 3 });
    // arms: humerus, radius + ulna, hand with five fingers
    [5, 8].forEach(function (b) { ellipsoid(m, b, [0, 0, 0], [.035, .035, .035], bone, P); limb(m, b, [0, -.02, 0], [0, -.27, 0], .018, .015, bone, o({ seg: 8, rings: 3, bulge: -.25 })); ellipsoid(m, b, [0, -.28, 0], [.026, .02, .022], bone, P); });
    [6, 9].forEach(function (b) { limb(m, b, [.012, -.01, 0], [.01, -.24, 0], .011, .009, bone, o({ seg: 6, rings: 2 })); limb(m, b, [-.012, -.01, 0], [-.008, -.24, .005], .01, .012, bone, o({ seg: 6, rings: 2 })); });
    [7, 10].forEach(function (b) {
      ellipsoid(m, b, [0, -.03, 0], [.03, .035, .012], bone, P);
      for (var f = 0; f < 5; f++) { var fx = (f - 2) * .013, th = f === 0 ? .04 : 0; limb(m, b, [fx, -.06, 0], [fx * 1.3 + th, -.11 - (f === 2 ? .015 : 0), .01], .005, .004, bone, o({ seg: 5, rings: 1, caps: false })); }
    });
    // legs: femur, tibia + fibula, kneecap, foot
    [11, 14].forEach(function (b) { ellipsoid(m, b, [0, 0, 0], [.035, .035, .035], bone, P); limb(m, b, [0, -.02, 0], [0, -.4, 0], .024, .02, bone, o({ seg: 8, rings: 3, bulge: -.25 })); ellipsoid(m, b, [0, -.41, .02], [.025, .025, .02], bone, P); });
    [12, 15].forEach(function (b) { limb(m, b, [0, -.01, .005], [0, -.39, 0], .018, .014, bone, o({ seg: 7, rings: 2 })); limb(m, b, [.022, -.02, -.005], [.02, -.38, -.005], .008, .008, bone, o({ seg: 5, rings: 2 })); });
    [13, 16].forEach(function (b) { ellipsoid(m, b, [0, -.015, .0], [.03, .022, .035], bone, P); for (var tq = -2; tq <= 2; tq++) limb(m, b, [tq * .012, -.025, .03], [tq * .014, -.03, .1], .006, .005, bone, o({ seg: 5, rings: 1, caps: false })); });
    if (opts && opts.hat) {
      var black = [.04, .03, .05], band = [.7, .1, .25];
      limb(m, 4, [0, .27, -.01], [0, .42, -.01], .085, .09, black, { seg: 18, rings: 2, caps: false, pat: 6 });
      ellipsoid(m, 4, [0, .42, -.01], [.09, .008, .09], black, { seg: 18, pat: 6 });
      ellipsoid(m, 4, [0, .265, -.01], [.17, .012, .17], black, { seg: 22, pat: 6 });
      limb(m, 4, [0, .285, -.01], [0, .31, -.01], .088, .088, band, { seg: 18, rings: 1, caps: false, em: .6, pat: 4 });
      ellipsoid(m, 3, [0, .02, .06], [.06, .02, .02], band, { em: .5, pat: 4, rot: [0, 0, 0] });
      [1, -1].forEach(function (sd) { cone(m, 3, [.0, .02, .06], [.06 * sd, .02, .06], .03, band, { em: .5, pat: 4 }); });
    }
  }
  var SKEL_RIG = { hip: 1.0, spine: .2, chest: .22, neck: .18, head: .05, sw: .17, sh: .2, upper: .29, fore: .25, hw: .09, hd: .04, thigh: .42, shin: .4,
    extras: [[4, 0, .07, .03]] };
  // the crew routine: shared choreography so the five move as one; style changes every four bars
  function skeletonRoutine(d, m, t, amp, slot) {
    var T = d.tgt, st = d.st, a = .3 + .7 * amp, routine = (m.bar >> 2) % 4;
    var lag = routine === 3 ? slot * .22 : 0;            // the wave: a ripple along the line
    var ph = m.phase - lag, f = ph - Math.floor(ph), side = (Math.floor(ph) & 1) ? -1 : 1, sw = Math.sin(ph * Math.PI);
    zero(T);
    var want = { x: 0, y: 0, z: 0, yaw: 0, lean: 0, roll: 0, k: 150 };
    if (routine === 0) {               // monster claws: arms forward and clawing, shoulder shimmy, side steps
      arm(T, 5, 1, 1.25 + Math.sin(ph * Math.PI * 2) * .15, .25, .3, .9 + m.snare * .4, -.8);
      arm(T, 8, -1, 1.25 + Math.sin(ph * Math.PI * 2 + 1) * .15, .25, .3, .9 + m.snare * .4, -.8);
      T[2][1] = Math.sin(ph * Math.PI * 4) * .14 * a; T[2][0] = .15;
      leg(T, 11, 1, side > 0 ? (1 - f) * .3 * a : 0, .2 + m.kick * .3, .1); leg(T, 14, -1, side < 0 ? (1 - f) * .3 * a : 0, .2 + m.kick * .3, .1);
      want.x = sw * .28 * a; want.y = -.04 - m.kick * .06; want.lean = .1;
    } else if (routine === 1) {        // charleston: knees in and out, arms swinging opposite
      var kk = Math.sin(ph * Math.PI * 2);
      arm(T, 5, 1, kk * .9 * a, .35, 0, .4, 0); arm(T, 8, -1, -kk * .9 * a, .35, 0, .4, 0);
      T[11][1] = kk * .6 * a; T[14][1] = kk * .6 * a; leg(T, 11, 1, Math.max(0, kk) * .4 * a, .25 + m.kick * .25, .05); leg(T, 14, -1, Math.max(0, -kk) * .4 * a, .25 + m.kick * .25, .05);
      T[11][1] = kk * .6 * a; T[14][1] = kk * .6 * a;
      want.y = -.06 - m.kick * .05; want.roll = kk * .05 * a;
    } else if (routine === 2) {        // raise the roof on the snare, head pops on the kick
      var push = Math.max(m.snare, Math.abs(Math.sin(ph * Math.PI)) * .6) * a;
      arm(T, 5, 1, .4, 2.4 - push * .7, 0, 1.6 - push * 1.4, 0); arm(T, 8, -1, .4, 2.4 - push * .7, 0, 1.6 - push * 1.4, 0);
      leg(T, 11, 1, 0, .3 + m.kick * .4, .18); leg(T, 14, -1, 0, .3 + m.kick * .4, .18);
      T[4][0] = -m.kick * .35; T[1][1] = sw * .25 * a;
      want.y = -.07 - m.kick * .09; want.yaw = sw * .2 * a;
    } else {                            // the wave: a deep dip and an arm sweep passing down the line
      var dip = Math.pow(Math.max(0, Math.sin(ph * Math.PI / 2)), 2);
      arm(T, 5, 1, dip * 2.4 * a, .3, 0, .2, 0); arm(T, 8, -1, dip * 2.4 * a, .3, 0, .2, 0);
      leg(T, 11, 1, 0, .1 + (1 - dip) * .45 * a, .12); leg(T, 14, -1, 0, .1 + (1 - dip) * .45 * a, .12);
      T[1][0] = (1 - dip) * .3 * a; want.y = -(1 - dip) * .16 * a - m.kick * .04;
    }
    // jaw: chatters on hats and snares, opens with the mids
    T[17][0] = Math.min(.55, m.mid * .25 + m.snare * .35 + m.hat * .2 + (m.live ? 0 : .02));
    T[4][2] += Math.sin(t * 1.7 + slot) * .04; T[4][1] += Math.sin(ph * Math.PI) * .12 * a;
    if (m.dropEnv > .95 && st.drop !== m.kickN) { st.drop = m.kickN; st.spin = (st.spin || 0) + Math.PI * 2; st.pop = 1; }
    st.pop = (st.pop || 0) * Math.exp(-.05 * 33 / 16);
    want.yaw += st.spin || 0; want.y += Math.max(0, m.dropEnv - .6) * .9;
    return want;
  }
  THEMES.skeletons = {
    id: 'skeletons', name: 'Dancing Skeletons', bg: SKELETON_BG,
    init: function () {
      var plain = new Mesh(); buildSkeleton(plain, {}); var lead = new Mesh(); buildSkeleton(lead, { hat: true });
      this.plain = upload(plain); this.lead = upload(lead);
      var spots = [[-3, -.4], [-1.5, .15], [0, .5], [1.5, .15], [3, -.4]], eyes = [[1, .5, .1], [.3, 1, .5], [1, .3, .1], [.5, .6, 1], [1, .45, .1]];
      this.crew = spots.map(function (p, i) {
        var d = new Dancer({ rig: SKEL_RIG, name: 'Skeleton ' + (i + 1) }); d.pos = [p[0], 0, p[1]]; d.yaw = Math.atan2(-p[0] * .3, 6); d.eye = eyes[i]; d.slot = i; d.mesh = i === 2 ? null : 'plain'; return d;
      });
      this.verts = this.plain.verts * 4 + this.lead.verts;
      this.wisps = makeSparkles(HIGH ? 120 : 70, 31, [-6, 6, .1, 2.2, -4, 2]);
      this.addData = new Float32Array((this.wisps.length + 5 * 12) * 8);
      this.wave = 1; this.flash = 0; this.hue = .38;
    },
    free: function () { freeMesh(this.plain); freeMesh(this.lead); },
    frame: function (dt, t) {
      var m = M, self = this, amp = m.live ? sat(.2 + m.energy * 1.25 + m.build * .2) : .1;
      this.hue += dt / 1000 * (.006 + m.energy * .015) + (m.drop ? .2 : 0); F.hue = this.hue;
      if (m.kickHit) this.wave = 0; this.wave = Math.min(1, this.wave + dt / 1100);
      if (m.drop) this.flash = 1; this.flash *= Math.exp(-dt / 160);
      var ang = Math.sin(t * .05) * .32 + Math.sin(t * .019) * .18, rad = 5.3 - m.build * .6 - m.dropEnv * .8;
      var eye = [Math.sin(ang) * rad + Math.sin(t * 29) * m.kick * .025, 1.2 + Math.sin(t * .09) * .22 + m.dropEnv * .3, Math.cos(ang) * rad + .4];
      setCamera(eye, [0, 1.0 + m.kick * .025, .1], .8 - m.dropEnv * .06, Math.sin(t * .13) * .015);
      this.crew.forEach(function (d) {
        var want = skeletonRoutine(d, m, t, amp, d.slot);
        d.settle(dt, want.k); d.settleRoot(dt, 95, { x: want.x, y: want.y, z: 0, yaw: want.yaw, lean: want.lean, roll: want.roll });
        d.sq += (m.kick * .45 - d.sq) * Math.min(1, dt / 40);
        d.bones[4].off[1] = SKEL_RIG.head + (d.st.pop || 0) * .3 * Math.sin(Math.min(1, d.st.pop || 0) * Math.PI);   // the drop head pop
        d.pose();
      });
      drawBackground(this, function (p) {
        var spots = [], cols = [];
        [0, 1, 3, 4].forEach(function (i) { var h = self.crew[i].jointPos(0); spots.push(h[0], h[2], .3 + m.kick * .6, 0); var c = hsv(self.hue + i * .1, .7, 1); cols.push(c[0], c[1], c[2]); });
        gl.uniform4fv(p.u('uSpot[0]'), spots); gl.uniform3fv(p.u('uSpotCol[0]'), cols);
        gl.uniform4f(p.u('uX'), self.wave, self.flash, 0, 0);
      });
      var rimA = mix3([.35, 1, .6], hsv(this.hue, .8, 1), .4), rimB = hsv(this.hue + .5, .7, 1);
      var p = beginMeshes({ key: [-.35, .75, -.6], keyCol: [.75 + this.flash, .9 + this.flash, .85 + this.flash], rimA: scale3(rimA, .9 + m.kick * .5), rimB: scale3(rimB, .7 + m.snare * .6),
        sky: [.32, .38, .46], ground: [.1, .12, .11], fog: [.12, .18, .15], fogD: .04, glow: 1 + m.energy * .5 });
      this.crew.forEach(function (d) { drawMesh(p, d.mesh ? self.plain : self.lead, d.mats, d.eye, [1, 1, 1]); });
      var o = 0, A_ = this.addData;
      for (var i = 0; i < 5; i++) {
        var hx = this.crew[i].jointPos(4), c = hsv(this.hue + i * .12, .55, 1), it = (.08 + m.kick * .25 + m.snare * .15 + this.flash * .6 + m.dropEnv * .3) * (m.live ? 1 : .4);
        o = beam(A_, o, [hx[0] * .7, 7, -1.5], [hx[0], 0, hx[2] + .1], .05, .55, c, it);
      }
      var bv = o / 8, spd = dt / 1000;
      for (i = 0; i < this.wisps.length; i++) {
        var s = this.wisps[i];
        s.x += Math.sin(t * .4 + s.ph) * .25 * spd; s.z += Math.cos(t * .3 + s.ph) * .2 * spd; s.y = .3 + Math.abs(Math.sin(t * .25 + s.ph * 2)) * 1.8 * s.s;
        var col = hsv(.36 + s.h * .12 + this.hue * .2, .6, 1), tw = .3 + .7 * Math.max(0, Math.sin(t * 2.5 + s.ph * 4)) + m.hat * .7;
        A_[o++] = s.x; A_[o++] = s.y; A_[o++] = s.z; A_[o++] = col[0]; A_[o++] = col[1]; A_[o++] = col[2]; A_[o++] = tw * .55; A_[o++] = .06 * s.s * (1 + m.bass * .5);
      }
      drawAdditive(A_, bv, gl.TRIANGLES, false);
      drawAdditive(A_.subarray(bv * 8), this.wisps.length, gl.POINTS, true);
    },
    debug: function () { return { verts: this.verts, dancers: this.crew.map(function (d) { return { name: d.def.name, head: d.jointPos(4), hips: d.jointPos(0), handL: d.jointPos(7), jaw: d.rot[17][0] }; }) }; }
  };
  // ==================================================================
  // THEME 3 — PSYCHEDELIC DIMENSIONS
  // Four impossible worlds, one after another, joined by rippling dimensional tears:
  //   0 Kaleido Temple   — folded fractal mandala flying forward
  //   1 Liquid Tunnel    — log-polar fractal tunnel of flowing colour
  //   2 Inverted Lattice — a hex lattice turned inside out around the centre
  //   3 Endless Cubes    — impossible isometric cubes sliding forever
  // A floating crystal with gyroscope rings and orbiting light orbs sits in the middle.
  // Bass: zoom punch and bulge · mids: warp and spin · highs: shimmer · kicks: pulses · drops: dimension jump
  // ==================================================================
  var PSY_BG = [
    'mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }',
    'vec3 dKaleido(vec2 uv, float z){',
    '  float r = length(uv), a = atan(uv.y, uv.x), n = 8.;',
    '  a = mod(a + z * .04, 6.28318 / n); a = abs(a - 3.14159 / n);',
    '  vec2 p = vec2(cos(a), sin(a)) * r * (1.6 + uM1.z * .25);',
    '  float glow = 0., acc = 0.;',
    '  for (int i = 0; i < 5; i++) {',
    '    p = abs(p) - vec2(.55 + .12 * sin(z * .21 + float(i)), .34 + uM0.w * .08);',
    '    p *= rot(.55 + z * .03 + uM0.w * .15);',
    '    p *= 1.32;',
    '    float d = abs(p.y) * exp(-float(i) * .25);',
    '    glow += exp(-d * (6. + uM1.x * 6.)) * (.35 + .1 * float(i));',
    '    acc += length(p) * .1;',
    '  }',
    '  vec3 c = pal(acc * .45 + r * .6 + z * .02 + uM3.z) * glow * .5;',
    '  c += pal(acc * .8 + .5 + uM3.z) * (.06 + .1 * sin(acc * 9. + z)) * smoothstep(1.6, .2, r);',
    '  c += pal(uM3.z + .3) * exp(-r * 3.) * .3;',
    '  return c;',
    '}',
    'vec3 dTunnel(vec2 uv, float z){',
    '  float r = length(uv) + 1e-3, a = atan(uv.y, uv.x);',
    '  vec2 lp = vec2(log(r) * 1.4 - z * .55, a / 6.28318 * 6.);',
    '  lp += vec2(sin(a * 3. + lp.x * 2.1 + z * .3) + .5 * sin(a * 5. - lp.x * 3.3), cos(a * 2. - lp.x * 1.7 + z * .2)) * (.18 + uM0.w * .3);',
    '  float rings = sin(lp.x * 6.28318 * 1.5) * sin(lp.y * 6.28318);',
    '  float band = smoothstep(.0, .08, abs(rings)) * .7 + .3;',
    '  float lines = exp(-abs(rings) * (14. + uM1.x * 20.));',
    '  vec3 c = pal(lp.x * .15 + cos(a) * .12 + uM3.z) * band * .35 + pal(lp.x * .3 + .4 + uM3.z) * lines * .8;',
    '  c *= smoothstep(.0, .25, r);',
    '  c += vec3(1., .9, 1.) * exp(-r * 9.) * (.25 + uM1.z * .6);',
    '  return c;',
    '}',
    'vec3 dLattice(vec2 uv, float z){',
    '  vec2 q = uv / max(dot(uv, uv), .02);',                                        // inversion: the outside world wrapped into the centre
    '  q *= rot(z * .05); q += vec2(mod(z * .35, 17.320508), mod(z * .12, 17.320508));',
    '  q += .25 * vec2(sin(q.y * 1.3 + z * .4), cos(q.x * 1.1 - z * .3)) * uM0.w;',
    '  vec2 h = vec2(1., 1.7320508);',
    '  vec2 a = mod(q, h) - h * .5, b = mod(q - h * .5, h) - h * .5;',
    '  vec2 g = dot(a, a) < dot(b, b) ? a : b;',
    '  vec2 id = q - g;',
    '  float hexd = max(abs(g.x) * .866 + abs(g.y) * .5, abs(g.y));',
    '  float edge = exp(-abs(hexd - .45) * (25. + uM1.x * 30.));',
    '  float cellv = hash(mod(floor(id * 10. + .5), 97.));',
    '  vec3 c = pal(cellv * .5 + z * .03 + uM3.z) * (.08 + .25 * step(.6, cellv) * (.5 + uM2.x)) + pal(cellv + .3 + uM3.z) * edge * .9;',
    '  c *= smoothstep(.0, .3, length(uv));',
    '  return c;',
    '}',
    'vec3 dCubes(vec2 uv, float z){',
    '  vec2 p = uv * (3.2 + uM1.z * .4) * rot(.08 * sin(z * .07)); p.y += mod(z * .45, 17.320508); p.x += mod(z * .15, 10.);',
    '  vec2 h = vec2(1., 1.7320508);',
    '  vec2 a = mod(p, h) - h * .5, b = mod(p - h * .5, h) - h * .5;',
    '  vec2 g = dot(a, a) < dot(b, b) ? a : b; vec2 id = p - g;',
    '  vec2 cid = mod(floor(id * 2. + .5), 89.);',
    '  float ang = atan(g.y, g.x); float face = floor(mod(ang / 2.0944 + .5 + step(.5, hash(cid)) * 1.5, 3.));',
    '  float shade = face < .5 ? .95 : face < 1.5 ? .55 : .25;',
    '  float hexd = max(abs(g.x) * .866 + abs(g.y) * .5, abs(g.y));',
    '  float seam = exp(-abs(hexd - .5) * 40.) + exp(-min(abs(sin(ang * 1.5)), 1.) * 30.) * step(hexd, .5) * .6;',
    '  vec3 col = pal(hash(cid) * .3 + z * .015 + uM3.z + face * .08);',
    '  vec3 c = col * shade * (.35 + uM2.y * .4) + pal(uM3.z + .5) * seam * (.3 + uM1.x * .7);',
    '  c *= .55 + .45 * smoothstep(1.4, .2, length(uv));',
    '  return c;',
    '}',
    'vec3 dim(float k, vec2 uv, float z){',
    '  if (k < .5) return dKaleido(uv, z);',
    '  if (k < 1.5) return dTunnel(uv, z);',
    '  if (k < 2.5) return dLattice(uv, z);',
    '  return dCubes(uv, z);',
    '}',
    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy * 2. - uRes) / uRes.y;',
    '  float r = length(uv);',
    '  uv *= 1. - uM1.z * .07 - uM0.x * .04;',                                   // the kick punches the whole world inward
    '  uv *= 1. + .12 * uM0.x * exp(-r * 2.);',                                  // sub-bass bulge in the middle
    '  uv *= rot(uM3.x * .02 + sin(uTime * .1) * .05);',
    '  float z = uX.w;',
    '  vec3 c = dim(uX.y, uv, z);',
    '  if (uX.x > 0. && uX.x < 1.) {',                                             // the dimensional tear: a rippling radial wipe
    '    float edge = uX.x * 2.4 - r + .12 * sin(atan(uv.y, uv.x) * 7. + uTime * 3.) * (1. - uX.x);',
    '    float m = smoothstep(-.05, .05, edge);',
    '    vec3 c2 = dim(uX.z, uv * (1.3 - uX.x * .3), z);',
    '    c = mix(c, c2, m) + pal(uM3.z + .2) * exp(-abs(edge) * 25.) * 1.2;',
    '  }',
    '  c += vec3(1.) * step(.995, hash(floor(gl_FragCoord.xy / 3.) + floor(uTime * 20.))) * uM1.x * .6;',   // treble glitter
    '  c *= (.62 + .38 * smoothstep(.0, .45, uM2.y)) * (1. + uM1.z * .35 + uM2.w * .6);',   // quiet music dims the worlds, energy lights them
    '  vec2 vg = gl_FragCoord.xy / uRes - .5; c *= 1. - dot(vg, vg) * .8;',
    '  gl_FragColor = vec4(c, 1.);',
    '}'].join('\n');
  THEMES.psychedelic = {
    id: 'psychedelic', name: 'Psychedelic Dimensions', bg: PSY_BG,
    init: function () {
      var m = new Mesh(), phi = (1 + Math.sqrt(5)) / 2;
      ellipsoid(m, 0, [0, 0, 0], [.42, .42, .42], [.6, .5, .9], { seg: 24, rows: 14, pat: 7 });
      var ico = [[0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi], [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0], [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1]];
      ico.forEach(function (v) { var d = norm3(v); cone(m, 0, [d[0] * .3, d[1] * .3, d[2] * .3], [d[0] * 1.05, d[1] * 1.05, d[2] * 1.05], .13, [.7, .6, 1], { seg: 8, pat: 7 }); });
      [[1, .95, .03], [2, 1.12, .028], [3, 1.3, .024]].forEach(function (r) { torus(m, r[0], [0, 0, 0], r[1], r[2], [1, 1, 1], { seg: 48, ts: 6, em: 1.4, pat: 4 }); torus(m, r[0], [0, 0, 0], r[1], r[2] * 2.2, [.5, .5, .6], { seg: 48, ts: 6, pat: 7 }); });
      for (var i = 4; i < 12; i++) { ellipsoid(m, i, [0, 0, 0], [.07, .07, .07], [1, 1, 1], { seg: 12, em: 2, pat: 4 }); ellipsoid(m, i, [0, 0, 0], [.11, .11, .11], [.5, .5, .5], { seg: 12, pat: 7 }); }
      this.mesh = upload(m); this.verts = m.n;
      this.bones = new Float32Array(MAXB * 16); for (i = 0; i < MAXB; i++) this.bones.set(m4(), i * 16);
      this.tmp = m4(); this.rings = [0, 0, 0]; this.spin = 0; this.z = 0; this.dimA = 0; this.dimB = 1; this.trans = 0; this.lastSwitchBar = 0; this.hue = .8;
      this.dust = makeSparkles(HIGH ? 160 : 90, 5, [-4, 4, -2.5, 2.5, -3, 2]);
      this.addData = new Float32Array(this.dust.length * 8);
      this.pulse = 0;
    },
    free: function () { freeMesh(this.mesh); },
    frame: function (dt, t) {
      var m = M, s = dt / 1000, self = this;
      this.hue += s * (.015 + m.mid * .05) + (m.kickHit ? .01 : 0); F.hue = this.hue;
      this.z += s * (.6 + m.energy * 1.6 + m.kick * 2.2 + m.dropEnv * 3);       // travel speed follows the music
      // the next dimension every 8 bars (or straight away on a drop)
      var due = m.live && m.bar - this.lastSwitchBar >= 8;
      if (this.trans === 0 && (due || m.drop || (!m.live && t - (this.idleAt || 0) > 40))) { this.trans = .0001; this.dimB = (this.dimA + 1) % 4; this.lastSwitchBar = m.bar; this.idleAt = t; }
      if (this.trans > 0) { this.trans += s / (m.drop ? .9 : 2.2); if (this.trans >= 1) { this.trans = 0; this.dimA = this.dimB; } }
      var ang = Math.sin(t * .1) * .3;
      setCamera([Math.sin(ang) * 6, Math.sin(t * .13) * .5, Math.cos(ang) * 6], [0, 0, 0], .75 - m.kick * .03, Math.sin(t * .07) * .05);
      drawBackground(this, function (p) { gl.uniform4f(p.u('uX'), self.trans, self.dimA, self.dimB, self.z); });
      // crystal + gyroscope + orbiting orbs
      this.spin += s * (.25 + m.mid * .8 + m.dropEnv * 3);
      var sc = .85 + m.kick * .28 + m.sub * .1 + m.dropEnv * .2;
      trs(this.tmp, 0, Math.sin(t * .6) * .12, 0, this.spin * .7, this.spin, this.spin * .4, sc, sc, sc); this.bones.set(this.tmp, 0);
      var axes = [[1, 0, 0], [0, 0, 1], [.7, .7, 0]];
      for (var i = 0; i < 3; i++) {
        this.rings[i] += s * (.5 + i * .3) * (1 + m.mid * 1.5 + m.snare * 2) * (i % 2 ? -1 : 1);
        var rs = 1 + m.kick * .12 * (i + 1) * .5 + m.dropEnv * .3;
        trs(this.tmp, 0, Math.sin(t * .6) * .12, 0, this.rings[i] * axes[i][0] + i * .7, this.rings[i] * axes[i][1] + this.spin * .3, this.rings[i] * axes[i][2], rs, rs, rs);
        this.bones.set(this.tmp, (i + 1) * 16);
      }
      for (i = 0; i < 8; i++) {
        var a = t * (.4 + m.energy * .6) + i * Math.PI / 4, R = 1.9 + Math.sin(t * .7 + i) * .25 + m.kick * .35, os = 1 + m.hat * .8;
        trs(this.tmp, Math.cos(a) * R, Math.sin(a * 1.3 + i) * .6, Math.sin(a) * R, 0, 0, 0, os, os, os); this.bones.set(this.tmp, (4 + i) * 16);
      }
      var c1 = hsv(this.hue, .7, 1), c2 = hsv(this.hue + .5, .7, 1);
      var p = beginMeshes({ key: [.3, .8, .9], keyCol: [.9, .9, 1], rimA: scale3(c1, 1 + m.kick), rimB: scale3(c2, 1 + m.snare), sky: hsv(this.hue + .2, .5, .7), ground: hsv(this.hue + .6, .6, .25), fog: [0, 0, 0], fogD: 0, glow: 1 + m.energy });
      drawMesh(p, this.mesh, this.bones, hsv(this.hue + .3, .8, 1), hsv(this.hue + .1, .3, 1));
      var o = 0, A_ = this.addData;
      for (i = 0; i < this.dust.length; i++) {
        var d = this.dust[i], dz = s * (1.5 + m.energy * 4 + m.kick * 6);
        d.z += dz; if (d.z > 4) { d.z = -6; d.x = (Math.random() - .5) * 8; d.y = (Math.random() - .5) * 5; }
        var col = hsv(this.hue + d.h * .5, .6, 1);
        A_[o++] = d.x; A_[o++] = d.y; A_[o++] = d.z; A_[o++] = col[0]; A_[o++] = col[1]; A_[o++] = col[2]; A_[o++] = .5 + m.hat * .6; A_[o++] = .05 * d.s;
      }
      drawAdditive(A_, this.dust.length, gl.POINTS, true);
    },
    debug: function () { return { verts: this.verts, dim: this.dimA, trans: this.trans }; }
  };

  // ==================================================================
  // THEME 4 — NEON CYBERPUNK WORLDS
  // Flying down a rain-soaked neon street between endless skyscrapers: thousands of lit windows,
  // neon edge strips, giant billboard screens showing the live music, flying traffic and rain.
  // The city streams forever (six recycled blocks). Bass: neon pulses and window flashes · energy:
  // flight speed · snare: screen glitches · hats: rain sparkle · build-up: the camera climbs · drop: a dive.
  // ==================================================================
  var CYBER_BG = [
    'vec3 sky(vec3 rd){',
    '  float y = rd.y, az = atan(rd.x, -rd.z);',
    '  vec3 c = mix(vec3(.55, .12, .45), vec3(.05, .02, .12), smoothstep(-.05, .45, y));',
    '  c += vec3(1., .35, .6) * exp(-abs(y - .02) * 12.) * (.35 + uM0.x * .3);',
    '  vec3 sd = normalize(vec3(0., .12, -1.)); float sa = acos(clamp(dot(rd, sd), -1., 1.));',
    '  float sun = smoothstep(.16, .15, sa) * (.6 + .4 * step(.5, fract((rd.y - sd.y) * 40. + uTime * .3)) * step(rd.y, sd.y + .05) + step(sd.y + .05, rd.y));',
    '  c += vec3(1., .45, .35) * sun * .9 + vec3(1., .3, .5) * exp(-sa * 5.) * .35;',
    // distant skyline with blinking lights
    '  float bx = floor(az * 60.), bh = .03 + hash(vec2(bx, 2.)) * .12 + step(.9, hash(vec2(bx, 5.))) * .1;',
    '  float bld = step(y, bh);',
    '  vec2 wl = vec2(az * 600., y * 300.); float lights = step(.8, hash(floor(wl))) * step(abs(fract(wl.x) - .5), .3) * step(abs(fract(wl.y) - .5), .3);',
    '  c = mix(c, vec3(.04, .02, .07) + vec3(1., .6, .9) * lights * .5 * step(.02, y), bld);',
    // flying traffic streams across the sky
    '  for (int i = 0; i < 3; i++) { float fi = float(i); float ly = .16 + fi * .07 + sin(az * 2. + fi) * .02; float lane = exp(-abs(y - ly) * 400.);',
    '    float dash = step(.6, fract(az * (20. + fi * 7.) + uTime * (.2 + fi * .1) * (mod(fi, 2.) * 2. - 1.)));',
    '    c += mix(vec3(1., .2, .3), vec3(.6, .9, 1.), mod(fi, 2.)) * lane * dash * .9; }',
    '  return c;',
    '}',
    'void main(){',
    '  vec3 rd = rayDir(); vec3 c;',
    '  if (rd.y < -.002) {',
    '    float t = -uCam.y / rd.y; vec3 p = uCam + rd * t; p.z += uX.x;',          // street coordinates travel with the camera
    '    float side = abs(p.x);',
    '    vec3 refl = sky(reflect(rd, vec3(0., 1., 0.)));',
    '    float wet = .55 + .45 * noise(p.xz * vec2(.6, .15));',
    '    c = vec3(.015, .012, .025) + refl * .25 * wet;',
    // neon reflections smeared along the wet road under each building row
    '    for (int i = 0; i < 6; i++) { float fi = float(i); float xs = (fi < 3. ? -1. : 1.) * (5.5 + mod(fi, 3.) * 1.1);',
    '      float zz = p.z * .08 + fi * 1.7; float on = step(.35, noise(vec2(zz, fi)));',
    '      c += pal(fi * .17 + uM3.z) * exp(-abs(p.x - xs) * 2.2) * on * wet * (.18 + uM0.y * .4 + uM1.z * .35); }',
    '    float lane = step(abs(p.x), .07) * step(.5, fract(p.z * .25));',
    '    float edge = exp(-abs(side - 4.6) * 18.);',
    '    c += vec3(1., .9, .7) * lane * .35 + pal(uM3.z + .5) * edge * (.4 + uM1.z * .9);',
    '    c *= smoothstep(5., 4.65, side) * .8 + .2;',                                // sidewalks are darker
    '    c = mix(c, vec3(.3, .08, .3), 1. - exp(-t * .045));',
    '  } else c = sky(rd);',
    '  vec2 uv = gl_FragCoord.xy / uRes - .5; c *= 1. - dot(uv, uv) * .6;',
    '  gl_FragColor = vec4(c, 1.);',
    '}'].join('\n');
  var CY_SEG = 16, CY_N = 6;
  THEMES.cyberpunk = {
    id: 'cyberpunk', name: 'Neon Cyberpunk Worlds', bg: CYBER_BG,
    init: function () {
      var m = new Mesh(), R = rng(2077), self = this;
      for (var sg = 0; sg < CY_N; sg++) {
        for (var side = -1; side <= 1; side += 2) {
          var z = 0, k = 0;
          while (z < CY_SEG - .5) {
            var w = 2.2 + R() * 2.4, dpt = Math.min(CY_SEG - z, 2.6 + R() * 2.6), h = 5 + R() * 16 + (R() < .15 ? 12 : 0);
            var x = side * (5.4 + w / 2 + R() * .3), zc = -(z + dpt / 2), seed = R();
            var col = [seed, .05 + R() * .08, R()];
            box(m, sg, [x, h / 2, zc], [w, h, dpt * .94], [.06 + seed * .04, .055, .1 + seed * .05], { pat: 8, skip: function (n) { return n[1] < -.5; } });
            var nc = hsv(R(), .8, 1), edgeX = x - side * w / 2;
            box(m, sg, [edgeX, h / 2, zc + dpt * .47], [.08, h, .08], nc, { em: 1.3, pat: 4 });
            if (R() < .6) box(m, sg, [edgeX, h * (.25 + R() * .6), zc], [.06, .08, dpt * .9], hsv(R(), .8, 1), { em: 1.3, pat: 4 });
            if (R() < .5) { box(m, sg, [x, h + .4, zc], [w * .5, .8, dpt * .4], [.08, .07, .1], { pat: 0 }); limb(m, sg, [x, h + .8, zc], [x, h + 2.5 + R() * 2, zc], .04, .02, [.3, .3, .35], { seg: 5, rings: 1, caps: false }); ellipsoid(m, sg, [x, h + 2.6, zc], [.08, .08, .08], [1, .2, .2], { em: 3, pat: 4, seg: 6 }); }
            if (k % 2 === 1 && h > 8) {   // billboard screen on the street face
              var bw = Math.min(dpt * .85, 3.2), bh2 = bw * .6, by = h * .55, fx = edgeX - side * .05;
              var p0 = [fx, by - bh2 / 2, zc + side * bw / 2], p1 = [fx, by - bh2 / 2, zc - side * bw / 2], p2 = [fx, by + bh2 / 2, zc - side * bw / 2], p3 = [fx, by + bh2 / 2, zc + side * bw / 2];
              screenQuad(m, sg, p0, p1, p2, p3, [-side, 0, 0], R());
            }
            // far row: taller towers behind
            if (R() < .7) { var fh = 14 + R() * 26, fw = 3 + R() * 3; box(m, sg, [side * (12 + R() * 5), fh / 2, zc - R()], [fw, fh, 3 + R() * 2], [.05, .04, .08], { pat: 8, skip: function (n) { return n[1] < -.5; } });
              box(m, sg, [side * (12 + R() * 5) - side * fw / 2, fh * .7, zc], [.1, fh * .5, .1], hsv(R(), .8, 1), { em: 2, pat: 4 }); }
            z += dpt; k++;
          }
        }
        // overhead neon gate every block
        var gc = hsv(sg / CY_N, .8, 1);
        box(m, sg, [0, 10 + (sg % 2) * 2.5, -CY_SEG / 2], [10.8, .12, .12], gc, { em: 2.4, pat: 4 });
      }
      this.mesh = upload(m); this.verts = m.n;
      this.bones = new Float32Array(MAXB * 16); for (var i = 0; i < MAXB; i++) this.bones.set(m4(), i * 16);
      this.travel = 0; this.tmp = m4(); this.hue = .85; this.alt = 0;
      this.rain = []; for (i = 0; i < (HIGH ? 260 : 150); i++) this.rain.push({ x: (R() - .5) * 16, y: R() * 14, z: -R() * 30, s: .6 + R() * .6 });
      this.cars = []; for (i = 0; i < 14; i++) this.cars.push({ lane: i % 4, z: -R() * 90, v: (i % 2 ? 1 : -1) * (6 + R() * 6), y: 6 + (i % 4) * 2.2 + R() });
      this.addData = new Float32Array((this.rain.length * 2 + this.cars.length * 4) * 8);
    },
    free: function () { freeMesh(this.mesh); },
    frame: function (dt, t) {
      var m = M, s = dt / 1000, self = this;
      this.hue += s * (.008 + m.energy * .02) + (m.drop ? .3 : 0); F.hue = this.hue;
      this.travel += s * (4 + m.energy * 10 + m.kick * 6 + m.dropEnv * 14);
      this.alt += ((m.build * 4 - m.dropEnv * 1.6) - this.alt) * Math.min(1, s * 1.2);
      var camX = Math.sin(t * .17) * 1.1, camY = 3.2 + Math.sin(t * .23) * .5 + this.alt + m.kick * .12;
      var eye = [camX, camY, 0];
      setCamera(eye, [camX * .4 + Math.sin(t * .11) * .8, camY - .9 - this.alt * .35, -12], .95 + m.dropEnv * .12, Math.sin(t * .19) * .05 + camX * -.02);
      drawBackground(this, function (p) { gl.uniform4f(p.u('uX'), self.travel, 0, 0, 0); });
      // stream the six blocks: each block's bone puts it ahead of the camera, wrapping forever
      var total = CY_SEG * CY_N;
      for (var i = 0; i < CY_N; i++) {
        var zz = -(((i * CY_SEG - this.travel) % total + total) % total) + CY_SEG * .8;
        trs(this.tmp, 0, 0, zz, 0, 0, 0); this.bones.set(this.tmp, i * 16);
      }
      var p = beginMeshes({ key: [.2, .6, .8], keyCol: [.35, .3, .5], rimA: scale3(hsv(this.hue, .8, 1), .12 + m.kick * .12), rimB: scale3(hsv(this.hue + .5, .8, 1), .1 + m.snare * .1),
        sky: [.25, .12, .3], ground: [.06, .03, .08], fog: [.3, .08, .3], fogD: .028, glow: .75 + m.bass * .45 + m.kick * .5 + m.dropEnv * .4 });
      drawMesh(p, this.mesh, this.bones, [1, 1, 1], [1, 1, 1]);
      // rain streaks (lines) and flying cars (light points)
      var o = 0, A_ = this.addData, fall = s * (14 + m.energy * 6);
      for (i = 0; i < this.rain.length; i++) {
        var r = this.rain[i]; r.y -= fall * r.s; r.z += s * (4 + m.energy * 10) * .5;
        if (r.y < 0 || r.z > 2) { r.y = 8 + Math.random() * 8; r.z = -Math.random() * 30; r.x = camX + (Math.random() - .5) * 16; }
        var a = .25 + m.hat * .6, rc = [.6, .8, 1];
        A_[o++] = r.x; A_[o++] = r.y; A_[o++] = r.z; A_[o++] = rc[0]; A_[o++] = rc[1]; A_[o++] = rc[2]; A_[o++] = a; A_[o++] = 1;
        A_[o++] = r.x; A_[o++] = r.y + .5 * r.s; A_[o++] = r.z - .15; A_[o++] = rc[0]; A_[o++] = rc[1]; A_[o++] = rc[2]; A_[o++] = 0; A_[o++] = 1;
      }
      var rainVerts = o / 8;
      for (i = 0; i < this.cars.length; i++) {
        var c = this.cars[i]; c.z += (c.v + (4 + m.energy * 10)) * s;
        if (c.z > 6) c.z -= 100; if (c.z < -96) c.z += 100;
        var cx = (c.lane - 1.5) * 1.6, head = c.v > 0 ? [1, .3, .35] : [.8, .95, 1];
        for (var e = -1; e <= 1; e += 2) { A_[o++] = cx + e * .22; A_[o++] = c.y; A_[o++] = c.z; A_[o++] = head[0]; A_[o++] = head[1]; A_[o++] = head[2]; A_[o++] = .9; A_[o++] = .35; }
        A_[o++] = cx; A_[o++] = c.y - .12; A_[o++] = c.z; var uc = hsv(this.hue + i * .07, .8, 1); A_[o++] = uc[0]; A_[o++] = uc[1]; A_[o++] = uc[2]; A_[o++] = .6 + m.kick * .4; A_[o++] = .7;
        A_[o++] = cx; A_[o++] = c.y; A_[o++] = c.z; A_[o++] = .3; A_[o++] = .3; A_[o++] = .4; A_[o++] = .3; A_[o++] = .9;
      }
      drawAdditive(A_, rainVerts, gl.LINES, false);
      drawAdditive(A_.subarray(rainVerts * 8), this.cars.length * 4, gl.POINTS, true);
    },
    debug: function () { return { verts: this.verts, travel: this.travel }; }
  };

  // ==================================================================
  // THEME 5 — TRIPPY 3D CREATURES
  // Three surreal beings drifting through a dreamlike cosmic sea:
  //   BLOOM MOTH    — four iridescent wings with glowing eyespots, a wingbeat on every beat, harder on bass
  //   ORB SERPENT   — a living spectrum: its segments swell with the frequency bands, head = bass, tail = treble
  //   VEIL JELLY    — a vast pulsing bell that contracts on every kick, eight streaming tentacles
  // Every eight bars their bodies transform: rippling flesh, then sprouting spikes, then calm again.
  // ==================================================================
  var CREATURE_BG = [
    'void main(){',
    '  vec3 rd = rayDir();',
    '  float y = rd.y, az = atan(rd.x, -rd.z);',
    '  vec2 q = vec2(az * 1.6, y * 2.2);',
    '  vec2 q2 = mat2(.8, -.6, .6, .8) * q;',
    '  float n = noise(q * 1.7 + vec2(uTime * .02, 0.)) * .55 + noise(q2 * 3.6 - vec2(0., uTime * .03)) * .3 + noise(q * 6.3 + 3.1) * .15;',
    '  vec3 a = pal(uM3.z + .55), b = pal(uM3.z + .85);',
    '  vec3 c = mix(vec3(.02, .03, .08), vec3(.08, .03, .12), smoothstep(-.6, .6, y));',
    '  c += mix(a, b, n) * smoothstep(.25, .85, n) * (.32 + uM0.w * .35);',
    '  c += mix(b, a, noise(q * 3. + 7.)) * pow(n, 3.) * .25;',
    '  c += b * exp(-abs(y + .1) * 3.) * .08;',
    '  float rays = pow(max(0., noise(vec2(az * 9. + uTime * .05, 1.))), 3.) * smoothstep(-.1, .7, y);',    // light shafts from above
    '  c += a * rays * (.15 + uM1.z * .25);',
    // drifting giant silhouettes far away
    '  for (int i = 0; i < 3; i++) { float fi = float(i); vec2 cpos = vec2(sin(uTime * .02 + fi * 2.1) * 1.6, .1 + fi * .12);',
    '    vec2 d = (vec2(az, y) - cpos) * vec2(1., 2.4); float body = smoothstep(.12, .08, length(d * vec2(.6, 1.)));',
    '    c = mix(c, c * .55, body * .6); c += b * exp(-length(d) * 12.) * .05; }',
    '  vec2 st = vec2(az * 70., y * 70.); float hs = hash(floor(st));',
    '  c += vec3(.8, .9, 1.) * step(.992, hs) * smoothstep(.4, .0, length(fract(st) - .5)) * (1. + uM2.x * 1.5);',
    '  vec2 uv = gl_FragCoord.xy / uRes - .5; c *= 1. - dot(uv, uv) * .7;',
    '  c += pal(uM3.z) * uM2.w * .15;',
    '  gl_FragColor = vec4(c, 1.);',
    '}'].join('\n');
  function boneMats(n) { var b = new Float32Array(MAXB * 16); for (var i = 0; i < MAXB; i++) b.set(m4(), i * 16); return b; }
  var CR_TMP = m4(), CR_TMP2 = m4();
  THEMES.creatures = {
    id: 'creatures', name: 'Trippy 3D Creatures', bg: CREATURE_BG,
    init: function () {
      // --- Bloom Moth ---
      var mo = new Mesh(), fur = [.75, .55, .35], wingC = [.6, .4, .9];
      ellipsoid(mo, 0, [0, -.5, 0], [.17, .48, .17], [.55, .35, .25], { seg: 16, rows: 14, pat: 5 });
      ellipsoid(mo, 1, [0, 0, 0], [.24, .22, .21], fur, { seg: 18, pat: 1 });
      ellipsoid(mo, 2, [0, 0, .02], [.15, .13, .14], fur, { seg: 16, pat: 1 });
      [1, -1].forEach(function (sd) {
        ellipsoid(mo, 2, [.1 * sd, .02, .1], [.07, .08, .06], [.02, .02, .03], { em: 1.2, pat: 2, seg: 14 });
        var ab = sd > 0 ? 7 : 8;
        limb(mo, ab, [0, 0, 0], [0, .55, .1], .012, .008, fur, { seg: 5, rings: 3, caps: false });
        for (var f = 1; f < 8; f++) { var yy = f * .07; cone(mo, ab, [0, yy, yy * .18], [sd * .09 * (1 - f / 9), yy + .04, yy * .18 + .02], .012, fur, { seg: 4 }); }
        var up = sd > 0 ? 3 : 5, lo = sd > 0 ? 4 : 6;
        ellipsoid(mo, up, [.95 * sd, .32, 0], [.95, .55, .018], wingC, { seg: 26, rows: 12, pat: 7, em: .25, rot: [0, 0, .32 * sd] });
        ellipsoid(mo, up, [1.15 * sd, .45, .03], [.22, .22, .01], [.02, .02, .05], { seg: 16, rot: [0, 0, .32 * sd] });
        ellipsoid(mo, up, [1.15 * sd, .45, .04], [.12, .12, .01], [1, .8, .3], { seg: 14, em: 1.8, pat: 4, rot: [0, 0, .32 * sd] });
        ellipsoid(mo, up, [1.15 * sd, .45, -.03], [.12, .12, .01], [1, .8, .3], { seg: 14, em: 1.8, pat: 4, rot: [0, 0, .32 * sd] });
        ellipsoid(mo, lo, [.6 * sd, -.38, 0], [.6, .45, .016], wingC, { seg: 22, rows: 10, pat: 7, em: .25, rot: [0, 0, -.5 * sd] });
        ellipsoid(mo, lo, [.78 * sd, -.55, .03], [.1, .1, .01], [.3, 1, .9], { seg: 12, em: 1.8, pat: 4 });
        ellipsoid(mo, lo, [.78 * sd, -.55, -.03], [.1, .1, .01], [.3, 1, .9], { seg: 12, em: 1.8, pat: 4 });
      });
      this.moth = upload(mo); this.mothB = boneMats();
      // --- Orb Serpent: 18 segments, each its own bone ---
      var se = new Mesh(), NS = 18;
      for (var i = 0; i < NS; i++) {
        var r = .3 * (1 - i / (NS + 4)), sc = hsv(i / NS * .7, .6, 1);
        ellipsoid(se, i, [0, 0, 0], [r, r, r * 1.15], [.5, .5, .6], { seg: 18, rows: 10, pat: 7 });
        torus(se, i, [0, 0, 0], r * 1.02, r * .07, sc, { seg: 24, ts: 5, em: .85, pat: 4, rot: [Math.PI / 2, 0, 0] });
        cone(se, i, [0, r * .8, 0], [0, r * 1.7, -r * .5], r * .25, sc, { em: .8, pat: 4, seg: 6 });
        if (i === 0) {
          [1, -1].forEach(function (sd) { ellipsoid(se, 0, [r * .55 * sd, r * .35, r * .75], [r * .28, r * .28, r * .2], [.02, .02, .03], { em: 1.4, pat: 2, seg: 12 });
            cone(se, 0, [r * .6 * sd, r * .5, r * .2], [r * 1.5 * sd, r * 1.6, -r * .6], r * .18, [.9, .9, 1], { pat: 7, seg: 6 });
            cone(se, 0, [r * .3 * sd, -r * .5, r * .8], [r * .5 * sd, -r * .9, r * 1.5], r * .1, [1, 1, 1], { pat: 3, seg: 5 }); });
        }
      }
      this.serp = upload(se); this.serpB = boneMats(); this.trail = [];
      // --- Veil Jelly: bell + 8 tentacles of two segments ---
      var je = new Mesh();
      ellipsoid(je, 0, [0, 0, 0], [.8, .6, .8], [.5, .6, .9], { seg: 30, rows: 16, pat: 7, em: .2, deform: function (p) { var y = p[1] < -.12 ? -.12 + (p[1] + .12) * .15 : p[1]; var ripple = 1 + .05 * Math.sin(Math.atan2(p[2], p[0]) * 16) * smooth(.1, -.12, p[1]); return [p[0] * ripple, y, p[2] * ripple]; } });
      ellipsoid(je, 0, [0, .05, 0], [.35, .28, .35], [1, .55, .9], { seg: 18, em: 1.6, pat: 4 });
      torus(je, 0, [0, -.12, 0], .78, .04, [.4, 1, .9], { seg: 40, ts: 6, em: 1.8, pat: 4 });
      for (var tnt = 0; tnt < 8; tnt++) {
        limb(je, 1 + tnt * 2, [0, 0, 0], [0, -.85, 0], .055, .04, [.6, .5, 1], { seg: 8, rings: 4, pat: 1 });
        limb(je, 2 + tnt * 2, [0, 0, 0], [0, -.9, 0], .04, .012, [.6, .5, 1], { seg: 8, rings: 4, pat: 1 });
      }
      for (var arm_ = 0; arm_ < 4; arm_++) { var aa = arm_ * Math.PI / 2 + .4; limb(je, 0, [Math.cos(aa) * .15, -.1, Math.sin(aa) * .15], [Math.cos(aa) * .25, -1.3, Math.sin(aa) * .25], .07, .02, [1, .6, .9], { seg: 8, rings: 5, em: .6, pat: 1, bulge: .4 }); }
      this.jelly = upload(je); this.jellyB = boneMats();
      this.verts = mo.n + se.n + je.n;
      this.spores = makeSparkles(HIGH ? 200 : 120, 13, [-6, 6, -3, 4, -5, 3]);
      this.addData = new Float32Array(this.spores.length * 8);
      this.flap = 0; this.pulse = 0; this.hue = .6; this.sPath = 0;
    },
    free: function () { freeMesh(this.moth); freeMesh(this.serp); freeMesh(this.jelly); },
    frame: function (dt, t) {
      var m = M, s = dt / 1000, self = this, amp = m.live ? sat(.25 + m.energy * 1.2) : .15;
      this.hue += s * (.01 + m.energy * .025) + (m.drop ? .2 : 0); F.hue = this.hue;
      var ang = t * .05 + Math.sin(t * .03) * .6, rad = 7.2 - m.build * .8 - m.dropEnv;
      setCamera([Math.sin(ang) * rad, 1.1 + Math.sin(t * .07) * .6, Math.cos(ang) * rad], [0, .75, 0], .85, Math.sin(t * .1) * .04);
      drawBackground(this, null);
      // transformation cycle: calm -> rippling flesh -> spikes, every eight bars (a drop jumps to spikes)
      var phaseT = m.live ? (m.bar >> 3) % 3 : 0, morph = this.morph || (this.morph = [0, 0]);
      morph[0] += ((phaseT === 1 ? 1 : .15) - morph[0]) * Math.min(1, s * .8);
      morph[1] += ((phaseT === 2 || m.dropEnv > .5 ? 1 : 0) - morph[1]) * Math.min(1, s * .8);
      var warpA = [.05 * morph[0] * (1 + m.mid * 2) + m.kick * .02, 5, 2 + m.energy * 3, .1 * morph[1] * (.4 + m.bass * .9)];
      // --- moth: wing beat locked to the beat clock, deeper on bass ---
      var flapA = (.25 + amp * .55 + m.kick * .35), flap = Math.sin(m.phase * Math.PI * 2) * flapA, mb = this.mothB;
      var mx = -2.2 + Math.sin(t * .21) * .6, my = .95 + Math.sin(t * .37) * .35 + Math.sin(m.phase * Math.PI * 2 + 1) * .08 * amp, mz = .4 + Math.cos(t * .17) * .6;
      var mYaw = Math.sin(t * .13) * .5 + .4;
      var root = trs(CR_TMP, mx, my, mz, .15 + Math.sin(t * .3) * .1, mYaw, Math.sin(t * .2) * .1);
      var rootC = new Float32Array(root);
      mb.set(mul(CR_TMP2, rootC, trs(m4(), 0, 0, 0, Math.sin(m.phase * Math.PI * 2) * .08, 0, 0)), 0);
      mb.set(rootC, 16);
      mb.set(mul(CR_TMP2, rootC, trs(m4(), 0, .3, 0, -m.kick * .2, 0, 0)), 32);
      [[3, 1, .14, .08], [4, 1, .12, -.08], [5, -1, -.14, .08], [6, -1, -.12, -.08]].forEach(function (w, k) {
        var lag = k % 2 ? .25 : 0, fl = Math.sin((m.phase - lag) * Math.PI * 2) * flapA;
        mb.set(mul(CR_TMP2, rootC, trs(m4(), w[2], w[3], 0, 0, -w[1] * (.35 + fl), w[1] * fl * .25)), w[0] * 16);
      });
      [[7, 1], [8, -1]].forEach(function (a) { mb.set(mul(CR_TMP2, rootC, trs(m4(), a[1] * .05, .38, .05, -.3 - m.hat * .3, 0, -a[1] * (.3 + Math.sin(t * 6) * m.high * .2))), a[0] * 16); });
      // --- serpent: the head swims a looping path, segments follow its trail; each swells with its band ---
      this.sPath += s * (.45 + m.energy * .9 + m.kick * .6);
      var sp = this.sPath, head = [Math.sin(sp * .9) * 2.6, .45 + Math.sin(sp * 1.7) * .9, Math.sin(sp * .9 * 2) * 1.2 - .2];
      this.trail.unshift(head); if (this.trail.length > 400) this.trail.pop();
      var bandsArr = [m.sub, m.bass, m.lowmid, m.mid, m.high, m.air], sb = this.serpB, dist = 0, ti = 0;
      for (var i = 0; i < 18; i++) {
        var want = i * .3; while (ti < this.trail.length - 2 && dist < want) { var a1 = this.trail[ti], a2 = this.trail[ti + 1]; dist += Math.hypot(a1[0] - a2[0], a1[1] - a2[1], a1[2] - a2[2]); ti++; }
        var pp = this.trail[Math.min(ti, this.trail.length - 1)], nx = this.trail[Math.min(ti + 3, this.trail.length - 1)];
        var dx = pp[0] - nx[0], dy = pp[1] - nx[1], dz = pp[2] - nx[2];
        var yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, Math.hypot(dx, dz) + 1e-4);
        var band = bandsArr[Math.min(5, Math.floor(i / 3))], swell = 1 + band * .55 * (m.live ? 1 : 0) + (i === 0 ? m.kick * .25 : 0);
        sb.set(trs(CR_TMP, pp[0], pp[1], pp[2], pitch, yaw, Math.sin(t * 2 + i * .5) * .3, swell, swell, swell), i * 16);
      }
      // --- jelly: bell contracts on each kick, tentacles stream behind ---
      this.pulse = Math.max(this.pulse * Math.exp(-dt / 260), m.kick);
      var jb = this.jellyB, jx = 2 + Math.sin(t * .15) * .5, jy = 1.75 + Math.sin(t * .25) * .3 + this.pulse * .15, jz = -1.2;
      var cs = 1 - this.pulse * .22, ws = 1 + this.pulse * .18;
      var jr = new Float32Array(trs(CR_TMP, jx, jy, jz, Math.sin(t * .3) * .12, t * .1, Math.cos(t * .27) * .1, ws, cs, ws));
      jb.set(jr, 0);
      var jrN = new Float32Array(trs(CR_TMP, jx, jy, jz, Math.sin(t * .3) * .12, t * .1, Math.cos(t * .27) * .1));
      for (var k = 0; k < 8; k++) {
        var ta = k / 8 * Math.PI * 2, wave = Math.sin(t * 1.8 + k + m.phase * .5) * (.35 + m.mid * .5), flare = this.pulse * .6;
        var seg1 = mul(m4(), jrN, trs(CR_TMP2, Math.cos(ta) * .62, -.12, Math.sin(ta) * .62, Math.sin(ta) * (wave + flare) * .6, 0, -Math.cos(ta) * (wave + flare) * .6));
        jb.set(seg1, (1 + k * 2) * 16);
        jb.set(mul(m4(), seg1, trs(CR_TMP2, 0, -.85, 0, Math.sin(ta) * Math.sin(t * 1.8 + k - 1) * (.6 + m.mid * .6), Math.sin(t + k) * .3, -Math.cos(ta) * Math.sin(t * 1.8 + k - 1) * (.6 + m.mid * .6))), (2 + k * 2) * 16);
      }
      var c1 = hsv(this.hue, .7, 1), c2 = hsv(this.hue + .4, .7, 1);
      var p = beginMeshes({ key: [.3, .9, .5], keyCol: [.8, .8, .95], rimA: scale3(c1, .8 + m.kick * .8), rimB: scale3(c2, .7 + m.snare * .6), sky: hsv(this.hue + .55, .45, .55), ground: hsv(this.hue + .85, .5, .2), fog: [.04, .03, .09], fogD: .03, glow: 1 + m.energy * .7 });
      drawMesh(p, this.moth, mb, hsv(this.hue + .1, .6, 1), [1, 1, 1], warpA);
      drawMesh(p, this.serp, sb, hsv(this.hue + .5, .8, 1), [1, 1, 1], warpA);
      drawMesh(p, this.jelly, jb, hsv(this.hue + .3, .7, 1), [1, 1, 1], warpA);
      var o = 0, A_ = this.addData;
      for (i = 0; i < this.spores.length; i++) {
        var q = this.spores[i]; q.y += s * (.12 + m.bass * .3) * q.s; q.x += Math.sin(t * .3 + q.ph) * .1 * s;
        if (m.drop) { q.vx = (q.x) * .8; q.vz = q.z * .8; } q.vx = (q.vx || 0) * .96; q.vz = (q.vz || 0) * .96; q.x += q.vx * s; q.z += q.vz * s;
        if (q.y > 4) { q.y = -3; q.x = (Math.random() - .5) * 12; q.z = Math.random() * 8 - 5; }
        var col = hsv(this.hue + q.h * .5, .5, 1);
        A_[o++] = q.x; A_[o++] = q.y; A_[o++] = q.z; A_[o++] = col[0]; A_[o++] = col[1]; A_[o++] = col[2]; A_[o++] = .35 + .5 * Math.max(0, Math.sin(t * 2 + q.ph * 5)) + m.hat * .5; A_[o++] = .05 * q.s;
      }
      drawAdditive(A_, this.spores.length, gl.POINTS, true);
    },
    debug: function () { return { verts: this.verts, morph: this.morph }; }
  };

  // ==================================================================
  // THEME 6 — FUTURISTIC HOLOGRAMS
  // A holographic projector in a dark lab. Above it a wireframe entity built from 400 light
  // segments morphs every eight bars: geodesic sphere -> torus knot -> lattice cube -> DNA helix.
  // Bass pushes spikes out of it, kicks pulse it, snares glitch it (jitter + colour split), hi-hats
  // sparkle the particle vortex. A circular spectrum analyser rings the projector; wireframe solids orbit.
  // ==================================================================
  var HOLO_BG = [
    'void main(){',
    '  vec3 rd = rayDir(); vec3 c;',
    '  float az = atan(rd.x, -rd.z);',
    '  vec3 wall = vec3(.01, .02, .04) + vec3(.0, .15, .25) * exp(-abs(rd.y) * 6.) * .25;',
    '  float pil = pow(max(0., sin(az * 6. + .5)), 40.) * smoothstep(-.1, .5, rd.y);',             // light pillars around the room
    '  wall += vec3(.1, .5, .8) * pil * (.15 + uM1.z * .3);',
    '  vec2 gw = vec2(az * 12., rd.y * 12.); vec2 fw = abs(fract(gw) - .5);',
    '  wall += vec3(.05, .25, .4) * smoothstep(.47, .5, max(fw.x, fw.y)) * .25 * smoothstep(.6, .0, rd.y);',
    '  if (rd.y < -.002) {',
    '    float t = -uCam.y / rd.y; vec3 p = uCam + rd * t;',
    '    vec2 q = p.xz * 1.6; vec2 h = vec2(1., 1.7320508);',
    '    vec2 a = mod(q, h) - h * .5, b = mod(q - h * .5, h) - h * .5; vec2 g = dot(a, a) < dot(b, b) ? a : b;',
    '    float hexd = max(dot(abs(g), vec2(.5, .866)), abs(g.x));',
    '    float r = length(p.xz);',
    '    float pulse = smoothstep(.5, .0, abs(r - uX.x * 9.)) * (1. - uX.x);',
    '    float line = smoothstep(.04, .0, abs(hexd - .5)) * (.08 + .5 * exp(-r * .4) * (.4 + uM2.y) + pulse * 1.5);',
    '    c = vec3(.006, .012, .02) + vec3(.2, .8, 1.) * line;',
    '    c += vec3(.2, .7, 1.) * exp(-r * r * .25) * (.12 + uM1.z * .3);',                  // projector light pool
    '    c = mix(wall, c, exp(-t * .08));',
    '  } else c = wall;',
    '  vec2 uv = gl_FragCoord.xy / uRes - .5; c *= 1. - dot(uv, uv) * .8;',
    '  c *= .92 + .08 * sin(gl_FragCoord.y * 1.5 + uTime * 20.);',                            // faint scan texture over the whole view
    '  gl_FragColor = vec4(c, 1.);',
    '}'].join('\n');
  var HSEG = 400;
  function holoShapes() {
    var S = [];
    function pts(fn, n) { var a = []; for (var i = 0; i <= n; i++) a.push(fn(i / n)); return a; }
    function polyline(list, out, count) { for (var i = 0; i < count && i < list.length - 1; i++) out.push(list[i], list[i + 1]); }
    // 0 geodesic-style sphere: 10 latitude rings and 10 meridians of 20 segments
    var sph = [];
    for (var la = 1; la <= 10; la++) { var ph = la / 11 * Math.PI; polyline(pts(function (u) { var th = u * Math.PI * 2; return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; }, 20), sph, 20); }
    for (var me = 0; me < 10; me++) { var th0 = me / 10 * Math.PI * 2; polyline(pts(function (u) { var p2 = u * Math.PI; return [Math.sin(p2) * Math.cos(th0), Math.cos(p2), Math.sin(p2) * Math.sin(th0)]; }, 20), sph, 20); }
    S.push(sph);
    // 1 torus knot (2,3), two strands
    var kn = [];
    [0, .16].forEach(function (off) { polyline(pts(function (u) { var t = u * Math.PI * 2, r = .75 + .38 * Math.cos(3 * t); return [r * Math.cos(2 * t) * (1 + off * .5), .55 * Math.sin(3 * t) + off * .3, r * Math.sin(2 * t) * (1 + off * .5)]; }, 200), kn, 200); });
    S.push(kn);
    // 2 lattice cube: 4x4x4 grid lines (48 lines) split into segments
    var cu = [], n = 4, per = Math.floor(HSEG / 48);
    for (var ax = 0; ax < 3; ax++) for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var a0 = i / (n - 1) * 1.4 - .7, b0 = j / (n - 1) * 1.4 - .7;
      polyline(pts(function (u) { var v = u * 1.4 - .7; return ax === 0 ? [v, a0, b0] : ax === 1 ? [a0, v, b0] : [a0, b0, v]; }, per), cu, per);
    }
    S.push(cu);
    // 3 DNA double helix with rungs
    var dna = [];
    [0, Math.PI].forEach(function (off) { polyline(pts(function (u) { var t = u * Math.PI * 6; return [.45 * Math.cos(t + off), u * 2.2 - 1.1, .45 * Math.sin(t + off)]; }, 150), dna, 150); });
    for (var r = 0; r < 100; r++) { var u = r / 100, t = u * Math.PI * 6, y = u * 2.2 - 1.1; dna.push([.45 * Math.cos(t), y, .45 * Math.sin(t)], [.45 * Math.cos(t + Math.PI), y, .45 * Math.sin(t + Math.PI)]); }
    S.push(dna);
    // every shape padded or trimmed to the same 400 segments so they can morph point for point
    return S.map(function (sh) { while (sh.length < HSEG * 2) sh.push(sh[sh.length % 40], sh[(sh.length + 1) % 40]); return sh.slice(0, HSEG * 2); });
  }
  function wireSolid(kind) {
    var V = kind === 0 ? [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] : kind === 1 ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] : [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    var E = kind === 0 ? [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] : kind === 1 ? [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [2, 5], [3, 4], [3, 5]] : [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    return { V: V, E: E };
  }
  THEMES.holograms = {
    id: 'holograms', name: 'Futuristic Holograms', bg: HOLO_BG,
    init: function () {
      var m = new Mesh(), chrome = [.35, .4, .5];
      limb(m, 0, [0, 0, 0], [0, .35, 0], 1.2, 1.05, chrome, { seg: 48, rings: 2, caps: false, pat: 6 });
      ellipsoid(m, 0, [0, .35, 0], [1.05, .02, 1.05], [.1, .12, .16], { seg: 48, rows: 4, pat: 6 });
      ellipsoid(m, 0, [0, .37, 0], [.5, .03, .5], [.3, .9, 1], { seg: 32, rows: 4, em: 1.6, pat: 4 });
      [[1.2, .02], [1.06, .34], [.8, .37]].forEach(function (r, i) { torus(m, 1 + i, [0, r[1], 0], r[0], .025, [.3, .9, 1], { seg: 64, ts: 5, em: 1.8, pat: 4 }); });
      for (var k = 0; k < 6; k++) { var a = k / 6 * Math.PI * 2; box(m, 0, [Math.cos(a) * 1.14, .18, Math.sin(a) * 1.14], [.12, .2, .12], [.05, .06, .08], { pat: 6 }); box(m, 0, [Math.cos(a) * 1.2, .18, Math.sin(a) * 1.2], [.04, .12, .04], [1, .3, .6], { em: 2, pat: 4 }); }
      this.base = upload(m); this.verts = m.n;
      this.bones = boneMats(); this.shapes = holoShapes(); this.cur = 0; this.next = 1; this.mt = 0; this.lastBar = 0;
      this.solids = [wireSolid(0), wireSolid(1), wireSolid(2)];
      this.parts = []; var R = rng(9);
      for (var i = 0; i < (HIGH ? 320 : 200); i++) this.parts.push({ a: R() * 6.28, r: .2 + R() * 1, y: R() * 3.2, v: .3 + R() * .6, s: .5 + R(), h: R() });
      var lines = HSEG * 2 * 2 + 64 * 2 + 3 * 12 * 2 + 40;
      this.lineData = new Float32Array(lines * 8); this.pointData = new Float32Array((this.parts.length + HSEG + 8) * 8); this.beamData = new Float32Array(24 * 8);
      this.rot = 0; this.glitch = 0; this.wave = 1; this.hue = .52; this.spec = new Float32Array(64);
    },
    free: function () { freeMesh(this.base); },
    frame: function (dt, t) {
      var m = M, s = dt / 1000, self = this;
      this.hue += s * (.004 + m.energy * .01) + (m.drop ? .15 : 0); F.hue = this.hue;
      if (m.kickHit) this.wave = 0; this.wave = Math.min(1, this.wave + dt / 1000);
      // morph to the next shape every eight bars (or on a drop)
      if (this.mt === 0 && ((m.live && m.bar - this.lastBar >= 8) || m.drop || (!m.live && t - (this.idle || 0) > 30))) { this.mt = .0001; this.next = (this.cur + 1) % 4; this.lastBar = m.bar; this.idle = t; }
      if (this.mt > 0) { this.mt += s / 1.6; if (this.mt >= 1) { this.mt = 0; this.cur = this.next; } }
      this.glitch = Math.max(this.glitch * Math.exp(-dt / 120), m.snare);
      var ang = t * .08 + Math.sin(t * .05) * .5, rad = 5.6 - m.build * .6 - m.dropEnv * .8;
      setCamera([Math.sin(ang) * rad, 2.1 + Math.sin(t * .09) * .4, Math.cos(ang) * rad], [0, 1.45, 0], .8, 0);
      drawBackground(this, function (p) { gl.uniform4f(p.u('uX'), self.wave, 0, 0, 0); });
      // projector platform (solid): ring bones spin with the music
      this.rot += s * (.4 + m.mid * 1.2);
      this.bones.set(m4(), 0);
      for (var i = 0; i < 3; i++) { var rs = 1 + m.kick * .06 * (i + 1); trs(CR_TMP, 0, 0, 0, 0, this.rot * (i % 2 ? -1 : 1) * (1 + i * .4), 0, rs, 1, rs); this.bones.set(CR_TMP, (i + 1) * 16); }
      var p = beginMeshes({ key: [.3, .9, .4], keyCol: [.5, .6, .75], rimA: scale3([.2, .8, 1], .6 + m.kick * .7), rimB: scale3([1, .3, .7], .4 + m.snare * .5), sky: [.1, .3, .45], ground: [.02, .04, .06], fog: [.01, .02, .04], fogD: .03, glow: 1 + m.energy * .6 });
      drawMesh(p, this.base, this.bones, [.3, .9, 1], [1, 1, 1]);
      // ---- hologram lines ----
      var L = this.lineData, o = 0, A_ = this.shapes[this.cur], B_ = this.shapes[this.next], mt = this.mt ? vxEase(this.mt) : 0;
      var groove = m.live ? sat(.3 + m.energy) : .1, beatEase = m.frac < .5 ? vxEase(m.frac * 2) : 1;
      var spin = t * .12 + (m.beat + beatEase) * .39 * groove + m.dropEnv * 2;                       // turns a step on every beat
      var cy = 1.65 + Math.sin(t * .8) * .05 + Math.sin(m.phase * Math.PI * 2) * .07 * groove;
      var sc = .95 + m.kick * .18 + m.dropEnv * .25 + Math.cos(m.phase * Math.PI * 2) * .05 * groove;
      var cS = Math.cos(spin), sS = Math.sin(spin), jitter = this.glitch * .12, base = hsv(this.hue, .65, 1), alt = hsv(this.hue + .45, .7, 1);
      var spike = m.bass * .35 + m.sub * .2;
      var mid = this.pointData, po = 0;
      for (i = 0; i < HSEG * 2; i++) {
        var a = A_[i], b = B_[i], x = a[0] + (b[0] - a[0]) * mt, y = a[1] + (b[1] - a[1]) * mt, z = a[2] + (b[2] - a[2]) * mt;
        if (mt > 0) { var tw = Math.sin(mt * Math.PI) * .35; x += Math.sin(i * 1.7 + t * 3) * tw; y += Math.cos(i * 2.3) * tw; }   // the morph scatters then reforms
        var push = 1 + spike * Math.pow(Math.abs(Math.sin(x * 7 + t) * Math.sin(y * 9 - t * 1.3) * Math.sin(z * 8 + t * .7)), 2) * 2.2;
        x *= push * sc; y *= push * sc; z *= push * sc;
        var rx = x * cS + z * sS, rz = -x * sS + z * cS, wy = y + cy;
        var gl_ = Math.floor((wy * 14 + t * 6)) % 7 === 0 ? 1 : 0;
        rx += (gl_ ? jitter : 0) * (Math.sin(t * 60 + wy * 30) > 0 ? 1 : -1);
        var scan = .6 + .4 * Math.sin(wy * 40 - t * 9), al = (.85 + m.kick * .4 + m.hat * .25) * scan;
        L[o++] = rx; L[o++] = wy; L[o++] = rz; L[o++] = base[0]; L[o++] = base[1]; L[o++] = base[2]; L[o++] = al; L[o++] = 1;
        if (i % 2 === 0 && po < HSEG * 8) { mid[po++] = rx; mid[po++] = wy; mid[po++] = rz; mid[po++] = base[0]; mid[po++] = base[1]; mid[po++] = base[2]; mid[po++] = .3 + m.hat * .4 + m.kick * .3; mid[po++] = .075; }
      }
      var holoVerts = o / 8;
      // colour split ghost on the snare
      if (this.glitch > .15) {
        for (i = 0; i < holoVerts; i++) { var src = i * 8; L[o++] = L[src] + .05 * this.glitch; L[o++] = L[src + 1]; L[o++] = L[src + 2]; L[o++] = 1; L[o++] = .15; L[o++] = .4; L[o++] = L[src + 6] * this.glitch * .6; L[o++] = 1; }
      }
      // circular spectrum analyser around the projector: 64 bars, bass at the front sweeping to treble
      var bands = [m.sub, m.bass, m.lowmid, m.mid, m.high, m.air];
      for (i = 0; i < 64; i++) {
        var u = Math.abs((i / 64) * 2 - 1) * 5, bi = Math.floor(u), bf = u - bi, lv = bands[Math.min(5, bi)] * (1 - bf) + bands[Math.min(5, bi + 1)] * bf;
        this.spec[i] += (lv - this.spec[i]) * Math.min(1, s * 18);
        var aa = i / 64 * Math.PI * 2, r0 = 1.35, r1 = 1.4 + this.spec[i] * 1.1 + m.kick * .15, col = hsv(this.hue + i / 64 * .3, .7, 1);
        L[o++] = Math.cos(aa) * r0; L[o++] = .04; L[o++] = Math.sin(aa) * r0; L[o++] = col[0]; L[o++] = col[1]; L[o++] = col[2]; L[o++] = .9; L[o++] = 1;
        L[o++] = Math.cos(aa) * r1; L[o++] = .04 + this.spec[i] * .2; L[o++] = Math.sin(aa) * r1; L[o++] = col[0]; L[o++] = col[1]; L[o++] = col[2]; L[o++] = .2; L[o++] = 1;
      }
      // three wireframe solids orbiting at different heights
      for (var k = 0; k < 3; k++) {
        var so = this.solids[k], oa = t * (.35 + k * .12) + k * 2.1, orad = 2.3 + Math.sin(t * .4 + k) * .2, ox = Math.cos(oa) * orad, oz = Math.sin(oa) * orad, oy = 1.2 + k * .5 + Math.sin(t + k) * .15;
        var ss = .22 * (1 + m.kick * .3 + (k === 1 ? m.snare * .3 : 0)), r1c = Math.cos(t * (1 + k)), r1s = Math.sin(t * (1 + k)), cc = k === 1 ? alt : base;
        for (var e = 0; e < so.E.length; e++) for (var w = 0; w < 2; w++) {
          var v = so.V[so.E[e][w]], vx = v[0] * r1c - v[2] * r1s, vz = v[0] * r1s + v[2] * r1c, vy = v[1] * Math.cos(t * .7) - vz * Math.sin(t * .7);
          vz = v[1] * Math.sin(t * .7) + vz * Math.cos(t * .7);
          L[o++] = ox + vx * ss; L[o++] = oy + vy * ss; L[o++] = oz + vz * ss; L[o++] = cc[0]; L[o++] = cc[1]; L[o++] = cc[2]; L[o++] = .8; L[o++] = 1;
        }
      }
      // projection beam
      var bd = this.beamData, bo = beam(bd, 0, [0, .38, 0], [0, 3.2, 0], .45, 1.2, base, .1 + m.kick * .12 + m.dropEnv * .2);
      drawAdditive(bd, bo / 8, gl.TRIANGLES, false);
      drawAdditive(L, o / 8, gl.LINES, false);
      // particle vortex rising through the beam (+ glow beads on the hologram)
      for (i = 0; i < this.parts.length; i++) {
        var q = this.parts[i]; q.y += s * q.v * (1 + m.energy * 1.5 + m.dropEnv * 3); q.a += s * (.8 + m.mid * 1.5) / (q.r + .3);
        var rr = q.r * (1 + (m.drop ? 1.5 : 0) + m.kick * .25);
        if (q.y > 3.4) { q.y = .4; q.r = .2 + Math.random(); }
        var pc = hsv(this.hue + q.h * .2, .5, 1);
        mid[po++] = Math.cos(q.a) * rr; mid[po++] = q.y; mid[po++] = Math.sin(q.a) * rr; mid[po++] = pc[0]; mid[po++] = pc[1]; mid[po++] = pc[2]; mid[po++] = .3 + m.hat * .7 * (q.h > .5 ? 1 : .3); mid[po++] = .035 * q.s;
      }
      drawAdditive(mid, po / 8, gl.POINTS, true);
    },
    debug: function () { return { verts: this.verts, shape: this.cur, morph: this.mt }; }
  };
  function vxEase(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  // ==================================================================
  // CINEMATIC CLIPS — film-quality loops by Beeple (free for any use; credited in the menu),
  // played full screen and driven by the music:
  //   kick   -> zoom punch, exposure pulse, colour-split shock, small camera shake
  //   snare  -> horizontal glitch slices
  //   hi-hat -> film-grain sparkle
  //   energy -> playback speed (slow motion when quiet, faster when it builds), contrast and glow
  //   bars   -> beat-synced cuts between the scene's camera angles (every beat during a build-up)
  //   drop   -> white flash, instant cut and a big zoom
  // Two video elements alternate so a cut is instant: the next angle is always already loaded.
  // ==================================================================
  var CLIPS = {"coins": ["clips/coins_0.mp4", "clips/coins_1.mp4", "clips/coins_2.mp4", "clips/coins_3.mp4", "clips/coins_4.mp4"], "skulls": ["clips/skulls_0.mp4", "clips/skulls_1.mp4"], "flag": ["clips/flag_0.mp4", "clips/flag_1.mp4"], "cityfire": ["clips/cityfire_0.mp4", "clips/cityfire_1.mp4", "clips/cityfire_2.mp4"], "inferno": ["clips/inferno_0.mp4", "clips/inferno_1.mp4"], "serpent": ["clips/serpent_0.mp4", "clips/serpent_1.mp4", "clips/serpent_2.mp4", "clips/serpent_3.mp4"], "idol": ["clips/idol_0.mp4", "clips/idol_1.mp4"], "frenzy": ["clips/frenzy_0.mp4", "clips/frenzy_1.mp4", "clips/frenzy_2.mp4", "clips/frenzy_3.mp4"], "run": ["clips/run_0.mp4", "clips/run_1.mp4", "clips/run_2.mp4"], "collapse": ["clips/collapse_0.mp4", "clips/collapse_1.mp4", "clips/collapse_2.mp4", "clips/collapse_3.mp4", "clips/collapse_4.mp4"]};
  var CLIP_NAMES = {"coins": "Coin Avalanche", "skulls": "Skull Mountain", "flag": "Molten Flag", "cityfire": "City on Fire", "inferno": "Inferno", "serpent": "Golden Serpent", "idol": "The Idol", "frenzy": "Idol Frenzy", "run": "The Run", "collapse": "City Collapse"};
  var CLIP_ORDER = ["coins", "skulls", "flag", "cityfire", "inferno", "serpent", "idol", "frenzy", "run", "collapse"];
  // The clip plays in a plain <video> element, so Android's hardware decoder draws it straight to the screen
  // (smooth even on the X3). The music effects are light layers on top: a CSS zoom / shake on the video,
  // and three overlay sheets (flash, dip, glitch lines). Only ONE video is ever loaded, and it is
  // released the moment the scene stops: the X3 can only decode a couple of videos at once.
  function makeVideo() {
    var v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('disablepictureinpicture', ''); v.setAttribute('disableremoteplayback', '');
    v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 50%;background:#000';
    return v;
  }
  function sheet(css) { var d = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0;' + css; return d; }
  function ClipTheme(id, list, name) { this.id = id; this.name = name; this.list = list; this.video = true; }
  ClipTheme.prototype.init = function () {
    var box = this.box = document.createElement('div');
    box.className = 'nv-clip'; box.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;background:#000';
    this.v = makeVideo(); box.appendChild(this.v);
    this.vig = sheet('opacity:1;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%)'); box.appendChild(this.vig);
    this.dim = sheet('background:#000'); box.appendChild(this.dim);
    this.scan = sheet('background:repeating-linear-gradient(0deg, rgba(255,40,140,0) 0, rgba(255,40,140,0) 7px, rgba(120,230,255,.45) 7px, rgba(120,230,255,.45) 9px)'); box.appendChild(this.scan);
    this.flash = sheet('background:#fff'); box.appendChild(this.flash);
    var anchor = $('xpc');
    if (anchor && anchor.parentNode === layer) layer.insertBefore(box, anchor.nextSibling); else layer.appendChild(box);
    this.idx = 0; this.fx = { zoom: 0, zv: 0, glitch: 0, flash: 0, dip: 0, sx: 0, sy: 0 }; this.lastCutBar = -1; this.css = {}; this.fails = 0;
    var self = this;
    this.v.addEventListener('playing', function () { self.err = ''; self.fails = 0; });
    this.v.addEventListener('error', function () {
      var e = self.v.error; self.err = 'Clip ' + self.list[self.idx] + ' failed (' + (e ? e.code : '?') + ')';
      if (++self.fails < self.list.length) setTimeout(function () { if (self.v) self.cut(); }, 400);       // skip a bad angle
    });
    this.load(this.list[0]);
  };
  ClipTheme.prototype.load = function (src) {
    var v = this.v; this.startAt = 0;
    v.src = src; try { v.load(); } catch (e) {}
    try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
  };
  ClipTheme.prototype.cut = function () {
    if (this.list.length < 2) return;
    this.idx = (this.idx + 1) % this.list.length;
    this.fx.dip = 1;                       // a quick dip on the beat hides the moment the new angle starts
    this.load(this.list[this.idx]);
  };
  ClipTheme.prototype.free = function () {
    var v = this.v;
    if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} }
    if (this.box && this.box.parentNode) this.box.parentNode.removeChild(this.box);
    this.v = null; this.box = null;
  };
  ClipTheme.prototype.set = function (el, key, val) { if (this.css[key] !== val) { this.css[key] = val; el.style[key.split('.')[1]] = val; } };
  ClipTheme.prototype.frame = function (dt, t) {
    var m = M, s = dt / 1000, fx = this.fx, v = this.v;
    if (!v) return;
    // cuts on the beat: every 4 bars (2 when it's busy), straight away on a drop; slow fades when there's no music
    if (this.list.length > 1) {
      if (m.live) {
        var every = m.energy > .45 ? 2 : 4;
        if (m.drop || (m.kickHit && m.bar !== this.lastCutBar && m.bar % every === 0 && m.frac < .3 && m.bar > 0)) { this.lastCutBar = m.bar; this.cut(); }
      } else if (t - (this.idleCut || 0) > 12) { this.idleCut = t; this.cut(); }
    }
    if (v.paused && v.readyState >= 2) { try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
    // music -> effects
    if (m.kickHit) { fx.zv += 4 * m.strength; fx.sx = (Math.random() - .5) * 8 * m.strength; fx.sy = (Math.random() - .5) * 6 * m.strength; fx.flash = Math.max(fx.flash, .07 * m.strength); }
    if (m.drop) { fx.zv += 4.5; fx.flash = .55; }
    if (m.snareHit) fx.glitch = Math.max(fx.glitch, m.snare);
    fx.zv += (-fx.zoom * 70 - fx.zv * 10) * s; fx.zoom = Math.max(-.02, Math.min(1.6, fx.zoom + fx.zv * s));
    fx.flash *= Math.exp(-dt / 130); fx.glitch *= Math.exp(-dt / 110); fx.dip *= Math.exp(-dt / 90);
    fx.sx *= Math.exp(-dt / 70); fx.sy *= Math.exp(-dt / 70);
    var scale = 1.02 + Math.min(fx.zoom, .5) * .24 + m.dropEnv * .03;     // a kick punches in about 4%, a drop about 8%
    var jx = fx.glitch > .2 ? (Math.random() - .5) * 14 * fx.glitch : 0;
    this.set(v, 'v.transform', 'translate3d(' + (fx.sx + jx).toFixed(1) + 'px,' + fx.sy.toFixed(1) + 'px,0) scale(' + scale.toFixed(3) + ')');
    this.set(this.flash, 'f.opacity', (fx.flash + m.kick * .03).toFixed(2));
    this.set(this.scan, 's.opacity', (fx.glitch * .8 + m.hat * .06).toFixed(2));
    this.set(this.dim, 'd.opacity', Math.min(.85, fx.dip * .85 + (m.live ? 0 : .18)).toFixed(2));
    // if nothing plays after a few seconds, say why on screen
    if (!this.startAt) this.startAt = t;
    var note = $('xpMid'), playing = v.readyState >= 2 && !v.paused && v.currentTime > 0;
    if (playing) this.started = true;
    if (note) { var msg = !playing && t - this.startAt > 4 ? (this.err || 'Clip is still loading… (state ' + v.readyState + ')') : (this.started ? '' : this.err || ''); if (note.textContent !== msg) note.textContent = msg; }
  };
  ClipTheme.prototype.debug = function () {
    var v = this.v || {};
    return { angle: this.idx, src: this.list[this.idx], ready: v.readyState, playing: !v.paused, time: v.currentTime, zoom: this.fx.zoom, glitch: this.fx.glitch, flash: this.fx.flash, err: this.err || '',
      transform: v.style ? v.style.transform : '', videos: document.querySelectorAll('#xp video').length };
  };
  CLIP_ORDER.forEach(function (k) { THEMES['clip_' + k] = new ClipTheme('clip_' + k, CLIPS[k], CLIP_NAMES[k]); });
  // the mix: every scene, every angle, cut on the beat
  (function () { var all = []; var n = 0, more = true; while (more) { more = false; CLIP_ORDER.forEach(function (k) { if (CLIPS[k][n]) { all.push(CLIPS[k][n]); more = true; } }); n++; }
    THEMES.clip_mix = new ClipTheme('clip_mix', all, 'Cinematic Mix'); })();

  function mix3(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
  function scale3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

  // ==================================================================
  // LIFECYCLE
  // ==================================================================
  var ORDER = ['clip_mix'].concat(CLIP_ORDER.map(function (k) { return 'clip_' + k; }));
  var cur = null, theme = null, built = {}, frames = 0, tStart = 0, tPrev = 0, perf = { n: 0, sum: 0, since: 0, good: 0 };
  var bar = null, barTimer = 0, snap = null;
  function sizeCanvas() {
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
    adapt(now, gap);
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
    if (!ensureGl()) { cb({}); return; }
    var out = {};
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
