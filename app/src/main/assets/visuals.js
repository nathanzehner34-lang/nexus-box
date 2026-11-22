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
    energy: 0, slow: 0, build: 0, drop: false, dropEnv: 0, quiet: 1, live: false,
    phase: 0, period: 500, bpm: 120, beat: 0, frac: 0, bar: 0
  };
  var raw = [0, 0, 0, 0, 0, 0], rawAt = 0, norm = [0, 0, 0, 0, 0, 0];
  var bandMean = [.02, .02, .02, .02, .02, .02], bandPeak = [.05, .05, .05, .05, .05, .05];
  var flux = { low: 0, lowAvg: .01, mid: 0, midAvg: .01, hi: 0, hiAvg: .01, prevLow: 0, prevMid: 0, prevHi: 0 };
  var pend = { kick: 0, snare: 0, hat: 0 }, lastKickAt = 0, lastSnareAt = 0, lastHatAt = 0, intervals = [], lastDropAt = -1e9;
  var musicOn = true, musicCheck = 0, fallbackKicks = -1;
  function onsets(now) {
    // spectral flux per region against its own running average: real hits, not loudness
    var low = norm[0] * .6 + norm[1] * .4, md = norm[2] * .4 + norm[3] * .6, hi = norm[4] * .55 + norm[5] * .45;
    var fl = Math.max(0, low - flux.prevLow), fm = Math.max(0, md - flux.prevMid), fh = Math.max(0, hi - flux.prevHi);
    flux.prevLow = low; flux.prevMid = md; flux.prevHi = hi;
    if (fl > flux.lowAvg * 1.8 + .07 && low > .3 && now - lastKickAt > 230) {
      var iv = now - lastKickAt; lastKickAt = now;
      pend.kick = Math.max(pend.kick, clamp(.55 + fl * 1.6, .55, 1));
      if (iv > 280 && iv < 1100) { intervals.push(iv); if (intervals.length > 10) intervals.shift(); }
    }
    if (fm > flux.midAvg * 1.9 + .06 && md > .28 && now - lastSnareAt > 170) { lastSnareAt = now; pend.snare = Math.max(pend.snare, clamp(.5 + fm * 1.8, .5, 1)); }
    if (fh > flux.hiAvg * 1.7 + .05 && hi > .22 && now - lastHatAt > 85) { lastHatAt = now; pend.hat = Math.max(pend.hat, clamp(.45 + fh * 2, .45, 1)); }
    flux.lowAvg += (fl - flux.lowAvg) * .08; flux.midAvg += (fm - flux.midAvg) * .08; flux.hiAvg += (fh - flux.hiAvg) * .08;
  }
  function feed6(v) {
    var now = performance.now(), total = 0;
    for (var i = 0; i < 6; i++) {
      var x = Math.max(0, +v[i] || 0); raw[i] = x; total += x;
      bandMean[i] += (x - bandMean[i]) * .015;                      // ~3 s running level
      bandPeak[i] = Math.max(x, bandPeak[i] * .993, bandMean[i] * 1.6 + 1e-4);   // slowly falling peak
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
      if (iv > 280 && iv < 1100) { intervals.push(iv); if (intervals.length > 10) intervals.shift(); }
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
    if (M.kickHit) { M.kick = Math.max(M.kick, pend.kick); M.strength = pend.kick; M.kickN++; }
    if (M.snareHit) { M.snare = Math.max(M.snare, pend.snare); M.snareN++; }
    if (M.hatHit) { M.hat = Math.max(M.hat, pend.hat); M.hatN++; }
    pend.kick = pend.snare = pend.hat = 0;
    M.kick *= Math.exp(-dt / 190); M.snare *= Math.exp(-dt / 150); M.hat *= Math.exp(-dt / 85);
    var en = M.sub * .3 + M.bass * .25 + M.lowmid * .15 + M.mid * .15 + M.high * .1 + M.air * .05;
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
    if (med) { while (med < 375) med *= 2; while (med > 750) med /= 2; M.period += (med - M.period) * Math.min(1, s * 1.5); }
    M.bpm = 60000 / M.period;
    M.phase += dt / (M.live ? M.period : 1600);
    if (M.kickHit && M.live) { var near = Math.round(M.phase); M.phase += (near - M.phase) * .45; }
    M.beat = Math.floor(M.phase); M.frac = M.phase - M.beat; M.bar = Math.floor(M.phase / 4);
    return M;
  }
  function musicReset() {
    for (var i = 0; i < 6; i++) { norm[i] = 0; }
    ['sub', 'bass', 'lowmid', 'mid', 'high', 'air', 'kick', 'snare', 'hat', 'energy', 'slow', 'build', 'dropEnv'].forEach(function (k) { M[k] = 0; });
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
  function cone(M_, bone, a, b, r, c, opt) { opt = opt || {}; limb(M_, bone, a, b, r, r * .04, c, { seg: opt.seg || 10, rings: 2, caps: false, em: opt.em, pat: opt.pat }); }

  // ==================================================================
  // RENDERER
  // ==================================================================
  var layer = null, glc = null, gl = null, progs = {}, quad = null, live = null, raf = 0, lastFrame = 0;
  var MAXB = 20;
  var VS_MESH = [
    'attribute vec3 aP, aN, aC, aM;',
    'uniform mat4 uVP; uniform mat4 uB[' + MAXB + '];',
    'varying vec3 vW, vN, vC, vM, vL;',
    'void main(){',
    '  mat4 B = uB[int(aM.x + .5)];',
    '  vec4 w = B * vec4(aP, 1.);',
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
    '  } else if (pat > 5.5) {',                   // chrome
    '    spec = 1.6; gloss = 60.; base = mix(base, uSky * 1.4, .35 + fr * .5);',
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
  function drawMesh(p, mesh, bones, eye, tint) {
    gl.uniformMatrix4fv(p.u('uB[0]'), false, bones);
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
  function mix3(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
  function scale3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

  // ==================================================================
  // LIFECYCLE
  // ==================================================================
  var ORDER = ['aliens', 'skeletons'];
  var cur = null, theme = null, built = {}, frames = 0, tStart = 0, tPrev = 0, perf = { n: 0, sum: 0, since: 0, good: 0 };
  var bar = null, barTimer = 0, snap = null;
  function sizeCanvas() {
    var w = Math.max(64, Math.round(layer.clientWidth * Q)), h = Math.max(36, Math.round(layer.clientHeight * Q));
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
    gl.viewport(0, 0, F.w, F.h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
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
    if (!THEMES[name] || !ensureGl()) return false;
    try { theme = getTheme(name); meshProgram(); } catch (e) { try { console.log('NXV start: ' + (e.stack || e)); } catch (er) {} return false; }
    cur = name; frames = 0; tPrev = 0; lastFrame = 0; perf = { n: 0, sum: 0, since: 0, good: 0 };
    if (!tStart) tStart = performance.now();
    glc.style.display = 'block'; sizeCanvas();
    layer.classList.add('vx-active');
    try { if (A) { if (A.meterDetail) A.meterDetail(true); A.meter(true); } } catch (e) {}
    ensureBar(); showBar(3200);
    layer.onclick = function () { showBar(); };
    render(performance.now());          // first frame before compositing: no black flash on entry
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
    if (!cur && quiet) return;
    cur = null; cancelAnimationFrame(raf); raf = 0;
    try { if (A && A.meterDetail) A.meterDetail(false); } catch (e) {}
    if (glc) glc.style.display = 'none';
    if (layer) layer.classList.remove('vx-active');
    clearTimeout(barTimer); if (bar) { bar.classList.remove('on'); bar.style.display = 'none'; }
    if (!quiet) releaseAll();
  }
  function redraw() { if (cur && gl && theme) try { render(performance.now()); } catch (e) {} }
  function snapshot() {
    if (!cur || !glc || glc.width < 4) return;
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
  var previewCache = null, PREVIEW_VERSION = 'nxv-1';
  function previews(cb) {
    if (previewCache) { cb(previewCache); return; }
    var key = 'nexus.nvPreviews.' + PREVIEW_VERSION;
    try { var c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && ORDER.every(function (k) { return c[k]; })) { previewCache = c; cb(c); return; } } catch (e) {}
    if (!ensureGl()) { cb({}); return; }
    var out = {};
    ORDER.forEach(function (k) {
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
    debug: function () { return { current: cur, frames: frames, q: Q, w: glc ? glc.width : 0, h: glc ? glc.height : 0, theme: theme && theme.debug ? theme.debug() : null, music: { kick: M.kick, snare: M.snare, hat: M.hat, energy: M.energy, bpm: M.bpm, live: M.live, phase: M.phase } }; }
  };
})();
