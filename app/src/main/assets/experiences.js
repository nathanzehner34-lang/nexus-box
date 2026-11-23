/* NEXUS experiences: Hologram, Clock, Lyrics, Webcams, Liquid Dreams and Night Drive.
   The Visuals themes are in visuals.js and are started from here (XP.open).
   Loaded only the first time one is opened. Each one only draws while it is on screen. */
(function () {
  'use strict';
  var N = window.NX, A = N.A, $ = N.$;
  var layer = $('xp'), cv = $('xpc'), cx = cv.getContext('2d', { alpha: false });
  var reportedMemoryGb = 0;
  try { reportedMemoryGb = Number(A && A.deviceMemoryGb ? A.deviceMemoryGb() : 0); } catch (e) {}
  if (!reportedMemoryGb) reportedMemoryGb = Number(navigator.deviceMemory) || 2;
  var HIGH_MEMORY_DEVICE = reportedMemoryGb >= 6;
  // Quality adjusts to frame time, while the RAM tier sets safe resolution and particle ceilings.
  var QMIN = HIGH_MEMORY_DEVICE ? 0.42 : 0.34, QMAX = HIGH_MEMORY_DEVICE ? 0.9 : 0.8;
  var S = Math.min(QMAX, Math.max(QMIN, parseFloat(N.pref ? N.pref('xpq') : '') || (HIGH_MEMORY_DEVICE ? 0.68 : 0.48)));
  var W = 0, H = 0;
  var running = null, raf = 0, timers = [], last = 0, xpDom = [], curDraw = null;
  var perf = { n: 0, slow: 0, since: 0 }, pendingSize = false;
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
    // the resize waits for the next frame's draw: resizing clears the canvas, and doing it
    // between frames left one black frame on screen every time quality changed
    if (S !== old) { pendingSize = true; saveQ(); }
  }

  function size() {
    W = cv.width = Math.max(1, Math.floor(layer.clientWidth * S)); H = cv.height = Math.max(1, Math.floor(layer.clientHeight * S));
    if (glc) { glc.width = Math.max(1, Math.floor(layer.clientWidth * S * GLX)); glc.height = Math.max(1, Math.floor(layer.clientHeight * S * GLX)); }
    if (atmosphereCanvas) { atmosphereCanvas.width = W; atmosphereCanvas.height = H; }
  }


  // Isolated offline asset-pack store for future downloadable worlds. Packs are
  // declarative data and verified media only; they cannot execute downloaded JS.
  // Nothing is fetched until a caller explicitly invokes XP.Packs.install().
  var PACK_DB = 'nexus-visual-worlds-v1';
  function openPackDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('Offline world storage is not available')); return; }
      var req = indexedDB.open(PACK_DB, 1);
      req.onupgradeneeded = function () { var db = req.result; if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'id' }); if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'key' }); };
      req.onsuccess = function () { resolve(req.result); }; req.onerror = function () { reject(req.error || new Error('Could not open offline world storage')); };
    });
  }
  function validateWorldPack(m) {
    if (!m || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(m.id || '') || !/^\d+\.\d+\.\d+$/.test(m.version || '') || (m.engine && m.engine !== 'nexus-scene-v1')) throw new Error('Invalid world pack identity, engine or version');
    if (typeof m.description !== 'string' || !m.description.trim() || m.description.length > 500 || typeof m.preview !== 'string' || !m.preview.trim()) throw new Error('World pack description and preview are required');
    var variants = Array.isArray(m.variants) && m.variants.length ? m.variants : [{ minMemoryGb: 0, assets: m.assets || [] }];
    if (variants.length > 4) throw new Error('World packs may provide up to four hardware variants');
    variants.forEach(function (variant) {
      if (!isFinite(+variant.minMemoryGb) || !Array.isArray(variant.assets) || !variant.assets.length || variant.assets.length > 96) throw new Error('Invalid world pack quality variant');
      variant.assets.forEach(function (a) {
        if (!a || !/^(?!\/)(?!.*\.\.)[a-zA-Z0-9_./-]+$/.test(a.path || '') || !/^https:\/\//i.test(a.url || '') || !/^[a-f0-9]{64}$/i.test(a.sha256 || '') || !isFinite(+a.size) || a.size <= 0 || +a.size > 268435456 || /javascript|text\/html/i.test(a.mime || '') || /\.(?:js|mjs|html?)$/i.test(a.path)) throw new Error('Invalid, executable or unverifiable world asset');
      });
    });
    return variants;
  }
  function txDone(tx) { return new Promise(function (resolve, reject) { tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(tx.error || new Error('World storage transaction failed')); }; }); }
  function packKey(id, version, path) { return id + '@' + version + '/' + path; }
  async function getPackAssetRecord(db, key) { return new Promise(function (resolve, reject) { var req = db.transaction('assets').objectStore('assets').get(key); req.onsuccess = function () { resolve(req.result || null); }; req.onerror = function () { reject(req.error); }; }); }
  async function savePackAsset(db, record) { var tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').put(record); await txDone(tx); }
  async function packBytes(url, onProgress) {
    var response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    if (!response.ok || !response.body || !response.body.getReader) throw new Error('World asset download failed (' + response.status + ')');
    var total = +(response.headers.get('Content-Length') || 0), reader = response.body.getReader(), chunks = [], received = 0;
    while (true) { var part = await reader.read(); if (part.done) break; chunks.push(part.value); received += part.value.length; if (onProgress) onProgress(received, total); }
    var bytes = new Uint8Array(received), offset = 0; chunks.forEach(function (chunk) { bytes.set(chunk, offset); offset += chunk.length; }); return bytes;
  }
  async function sha256Hex(bytes) {
    if (!window.crypto || !crypto.subtle) throw new Error('Secure SHA-256 verification is unavailable on this WebView');
    var digest = await crypto.subtle.digest('SHA-256', bytes), out = '';
    new Uint8Array(digest).forEach(function (b) { out += b.toString(16).padStart(2, '0'); }); return out;
  }
  async function installWorldPack(manifest, onProgress) {
    var variants = validateWorldPack(manifest), memory = reportedMemoryGb || 2, variant = variants.filter(function (v) { return +v.minMemoryGb <= memory; }).sort(function (a, b) { return +a.minMemoryGb - +b.minMemoryGb; }).pop();
    if (!variant) throw new Error('This world has no quality profile for the available device');
    var assets = variant.assets, total = assets.reduce(function (n, a) { return n + (+a.size || 0); }, 0), cap = memory >= 6 ? 536870912 : 268435456;
    if (total > cap) throw new Error('World exceeds the local storage limit for this device');
    if (navigator.storage && navigator.storage.estimate) { var usage = await navigator.storage.estimate(); if (usage.quota && usage.usage + total > usage.quota * .88) throw new Error('Not enough device storage for this world'); }
    var installed = await listWorldPacks(), previous = installed.find(function (p) { return p.id === manifest.id; });
    var db = await openPackDb(), done = 0, completed = 0, record = { id: manifest.id, version: manifest.version, status: 'installing', activeVersion: previous && previous.activeVersion || '', description: manifest.description, preview: manifest.preview, engine: manifest.engine || 'nexus-scene-v1', updated: Date.now(), variantGb: +variant.minMemoryGb };
    var metaTx = db.transaction('packs', 'readwrite'); metaTx.objectStore('packs').put(record); await txDone(metaTx);
    try {
      for (var i = 0; i < assets.length; i++) {
        var asset = assets[i], key = packKey(manifest.id, manifest.version, asset.path), cached = await getPackAssetRecord(db, key);
        if (cached && cached.sha256 === asset.sha256.toLowerCase()) { done += asset.size; completed++; if (onProgress) onProgress({ id: manifest.id, version: manifest.version, completed: completed, count: assets.length, loaded: done, total: total }); continue; }
        var bytes = await packBytes(asset.url, function (loaded, contentLength) { if (onProgress) onProgress({ id: manifest.id, version: manifest.version, path: asset.path, completed: completed, count: assets.length, loaded: done + loaded, total: total || done + contentLength }); });
        if (bytes.length !== +asset.size) throw new Error('Unexpected size for ' + asset.path);
        var digest = await sha256Hex(bytes); if (digest !== asset.sha256.toLowerCase()) throw new Error('Integrity check failed for ' + asset.path);
        await savePackAsset(db, { key: key, id: manifest.id, version: manifest.version, path: asset.path, mime: asset.mime || 'application/octet-stream', sha256: digest, bytes: bytes.buffer });
        done += bytes.length; completed++; if (onProgress) onProgress({ id: manifest.id, version: manifest.version, completed: completed, count: assets.length, loaded: done, total: total });
      }
      record.status = 'ready'; record.activeVersion = manifest.version; var readyTx = db.transaction('packs', 'readwrite'); readyTx.objectStore('packs').put(record); await txDone(readyTx); db.close(); return record;
    } catch (err) {
      record.status = record.activeVersion ? 'ready' : 'partial'; record.error = String(err && err.message || err); var failTx = db.transaction('packs', 'readwrite'); failTx.objectStore('packs').put(record); await txDone(failTx); db.close(); throw err;
    }
  }
  async function listWorldPacks() {
    var db = await openPackDb(); return new Promise(function (resolve, reject) { var req = db.transaction('packs').objectStore('packs').getAll(); req.onsuccess = function () { resolve(req.result || []); db.close(); }; req.onerror = function () { db.close(); reject(req.error); }; });
  }
  async function openWorldPackAsset(id, path) {
    var db = await openPackDb(), packs = await listWorldPacks(), pack = packs.find(function (p) { return p.id === id && p.activeVersion; });
    if (!pack) { db.close(); throw new Error('World is not installed for offline use'); }
    var asset = await getPackAssetRecord(db, packKey(id, pack.activeVersion || pack.version, path)); db.close();
    if (!asset) throw new Error('World asset is missing from local storage'); return URL.createObjectURL(new Blob([asset.bytes], { type: asset.mime }));
  }
  async function removeWorldPack(id) {
    var db = await openPackDb(), all = await new Promise(function (resolve, reject) { var req = db.transaction('assets').objectStore('assets').getAllKeys(); req.onsuccess = function () { resolve(req.result || []); }; req.onerror = function () { reject(req.error); }; });
    var tx = db.transaction(['assets', 'packs'], 'readwrite'); all.forEach(function (key) { if (String(key).indexOf(id + '@') === 0) tx.objectStore('assets').delete(key); }); tx.objectStore('packs').delete(id); await txDone(tx); db.close(); return true;
  }

  // ---- Graphics-chip (WebGL) visuals: the sharpest, smoothest look for the least effort ----
  var glc = null, gl = null, GLX = 1.25, glBuf = null, glProgs = {}, glPending = {};
  var atmosphereCanvas = null, atmosphereCtx = null, atmosphereParticles = [], atmosphereProfile = null, atmosphereLast = 0;
  // Atmosphere layer for the utility experiences (Hologram, Clock, Lyrics, Webcams use the neon family).
  var ATMOSPHERE_PROFILES = {
    space: [[], 212, 0],
    fluid: [[], 184, 1],
    prism: [[], 296, 2],
    organic: [[], 326, 3],
    neon: [[], 258, 4]
  };

  function atmosphereFamily(name) {
    var keys = Object.keys(ATMOSPHERE_PROFILES);
    for (var i = 0; i < keys.length; i++) if (ATMOSPHERE_PROFILES[keys[i]][0].indexOf(name) >= 0) return keys[i];
    return 'neon';
  }
  function ensureAtmosphere() {
    if (!atmosphereCanvas) {
      atmosphereCanvas = document.createElement('canvas');
      atmosphereCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
      atmosphereCanvas.setAttribute('aria-hidden', 'true');
      atmosphereCtx = atmosphereCanvas.getContext('2d', { alpha: true });
    }
    var anchor = glc || cv;
    if (atmosphereCanvas.parentNode !== layer || atmosphereCanvas.previousSibling !== anchor) layer.insertBefore(atmosphereCanvas, anchor.nextSibling);
    atmosphereCanvas.width = W; atmosphereCanvas.height = H;
  }
  function resetAtmosphere(name) {
    // The five Visuals carry their own complete lighting, so no overlay is drawn over them.
    if (isVisual(name)) { atmosphereProfile = null; atmosphereParticles = []; if (atmosphereCtx) atmosphereCtx.clearRect(0, 0, atmosphereCanvas.width, atmosphereCanvas.height); return; }
    if (name === 'liquiddreams' || name === 'nightdrive') { atmosphereProfile = null; atmosphereParticles = []; if (atmosphereCtx) atmosphereCtx.clearRect(0, 0, atmosphereCanvas.width, atmosphereCanvas.height); return; }
    atmosphereProfile = ATMOSPHERE_PROFILES[atmosphereFamily(name)]; atmosphereLast = 0;
    ensureAtmosphere();
    var seed = 271 + String(name).split('').reduce(function (n, c) { return (n * 33 + c.charCodeAt(0)) >>> 0; }, 0), count = HIGH_MEMORY_DEVICE ? 88 : 30;
    function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
    atmosphereParticles = [];
    for (var i = 0; i < count; i++) atmosphereParticles.push({ x: random(), y: random(), z: .18 + random() * .82, phase: random() * 6.283, drift: .25 + random() * .9 });
  }
  function renderAtmosphere(now) {
    if (!atmosphereCtx || !atmosphereProfile || !XP.active) return;
    var dt = atmosphereLast ? Math.min(48, now - atmosphereLast) : 16; atmosphereLast = now;
    var energy = window.BEAT && window.BEAT.live && Date.now() - window.BEAT.live < 1500 ? Math.min(1, window.BEAT.e || 0) : 0;
    var bass = energy ? Math.min(1, window.BEAT.k || 0) : 0, mid = energy ? Math.min(1, window.BEAT.mid || 0) : 0, treble = energy ? Math.min(1, window.BEAT.high || 0) : 0;
    var t = now * .001, hue = (atmosphereProfile[1] + t * (4 + mid * 18) + treble * 38) % 360, ctx = atmosphereCtx;
    ctx.clearRect(0, 0, W, H); ctx.save(); ctx.globalCompositeOperation = 'lighter';
    var strength = HIGH_MEMORY_DEVICE ? .22 : .16, pulse = .08 + bass * .23 + energy * .11;
    if (atmosphereProfile[2] === 0) {
      // Space scenes gain a layered star parallax and soft radial lensing.
      for (var s = 0; s < atmosphereParticles.length; s++) {
        var star = atmosphereParticles[s], sx = ((star.x + t * star.drift * .006 * star.z) % 1) * W;
        var sy = (star.y + Math.sin(t * .18 + star.phase) * .008) * H, radius = (.45 + star.z * 1.6 + treble * 1.2) * S;
        ctx.fillStyle = 'hsla(' + (hue + star.phase * 16) % 360 + ',100%,82%,' + (strength * (.2 + star.z * .5 + energy * .18)) + ')';
        ctx.beginPath(); ctx.arc(sx, sy, radius, 0, 6.283); ctx.fill();
        if (bass > .25 && s % 5 === 0) { ctx.strokeStyle = 'hsla(' + hue + ',100%,75%,' + (bass * .15) + ')'; ctx.lineWidth = S; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - star.drift * bass * 12 * S, sy); ctx.stroke(); }
      }
      var lens = ctx.createRadialGradient(W * (.5 + Math.sin(t * .13) * .13), H * .5, 0, W * .5, H * .5, Math.max(W, H) * .62);
      lens.addColorStop(0, 'hsla(' + hue + ',100%,64%,' + (.035 + energy * .035) + ')'); lens.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = lens; ctx.fillRect(0, 0, W, H);
    } else if (atmosphereProfile[2] === 1) {
      // Fluid scenes gain independent caustic currents at three depths.
      for (var w = 0; w < 5; w++) {
        var phase = t * (.22 + w * .035) * (w % 2 ? -1 : 1) + w * 1.27, base = H * (.16 + w * .16), amp = H * (.035 + energy * .025 + bass * .02);
        var grad = ctx.createLinearGradient(0, base - amp, W, base + amp);
        grad.addColorStop(0, 'hsla(' + (hue + w * 27) % 360 + ',100%,70%,0)'); grad.addColorStop(.48, 'hsla(' + (hue + w * 27) % 360 + ',100%,82%,' + (strength * .3) + ')'); grad.addColorStop(1, 'hsla(' + (hue + w * 27) % 360 + ',100%,70%,0)');
        ctx.beginPath();
        for (var x = 0; x <= 20; x++) { var u = x / 20, y = base + Math.sin(u * 7 + phase) * amp + Math.sin(u * 15 - phase * 1.4) * amp * .28; if (!x) ctx.moveTo(u * W, y); else ctx.lineTo(u * W, y); }
        ctx.strokeStyle = grad; ctx.lineWidth = (1.2 + treble * 2) * S; ctx.stroke();
      }
    } else if (atmosphereProfile[2] === 2) {
      // Optical scenes gain a mirrored spectral corona and beat-driven refraction arcs.
      var cx0 = W * (.5 + Math.sin(t * .19) * .045), cy0 = H * (.5 + Math.cos(t * .17) * .035), radius0 = Math.min(W, H) * (.19 + pulse * .12);
      for (var ray = 0; ray < 12; ray++) {
        var angle = t * (.08 + mid * .12) + ray * 6.283 / 12, reach = radius0 * (1.25 + .22 * Math.sin(t * .7 + ray));
        ctx.strokeStyle = 'hsla(' + (hue + ray * 9) % 360 + ',100%,78%,' + (strength * (.12 + treble * .18)) + ')'; ctx.lineWidth = (1 + treble * 1.4) * S;
        ctx.beginPath(); ctx.moveTo(cx0 + Math.cos(angle) * radius0 * .35, cy0 + Math.sin(angle) * radius0 * .35); ctx.lineTo(cx0 + Math.cos(angle) * reach, cy0 + Math.sin(angle) * reach); ctx.stroke();
      }
      ctx.strokeStyle = 'hsla(' + hue + ',100%,82%,' + (strength * (.12 + bass * .2)) + ')'; ctx.lineWidth = Math.max(S, 1 + bass * 2) * S;
      ctx.beginPath(); ctx.ellipse(cx0, cy0, radius0 * (1 + bass * .28), radius0 * .48, t * .11, 0, 6.283); ctx.stroke();
    } else if (atmosphereProfile[2] === 3) {
      // Organic scenes gain drifting depth spores and living filaments.
      for (var p = 0; p < atmosphereParticles.length; p++) {
        var mote = atmosphereParticles[p], mx = ((mote.x + Math.sin(t * .15 + mote.phase) * .025 + t * .002 * mote.drift) % 1) * W;
        var my = (mote.y + Math.cos(t * .19 + mote.phase) * .018 - dt * .000012 * mote.z + 1) % 1 * H, mr = (.8 + mote.z * 2 + treble * 1.4) * S;
        ctx.fillStyle = 'hsla(' + (hue + mote.phase * 12) % 360 + ',100%,75%,' + (strength * (.18 + mote.z * .36 + energy * .18)) + ')'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.283); ctx.fill();
        if (p % 6 === 0) { ctx.strokeStyle = 'hsla(' + hue + ',100%,68%,' + (strength * .12) + ')'; ctx.lineWidth = S; ctx.beginPath(); ctx.moveTo(mx, my); ctx.quadraticCurveTo(mx + Math.sin(t + p) * W * .025, my - H * .025, mx + Math.cos(t + p) * W * .04, my - H * .06); ctx.stroke(); }
      }
    } else {
      // Neon and architectural scenes gain independent perspective beams and pulse halos.
      for (var beam = 0; beam < 7; beam++) {
        var bx = W * (.12 + beam * .13 + Math.sin(t * .2 + beam) * .025), sway = Math.sin(t * .35 + beam * .8) * W * (.035 + mid * .02);
        var bg = ctx.createLinearGradient(bx, 0, bx + sway, H); bg.addColorStop(0, 'hsla(' + (hue + beam * 24) % 360 + ',100%,68%,0)'); bg.addColorStop(.52, 'hsla(' + (hue + beam * 24) % 360 + ',100%,74%,' + (strength * (.08 + treble * .08)) + ')'); bg.addColorStop(1, 'hsla(' + (hue + beam * 24) % 360 + ',100%,68%,0)');
        ctx.strokeStyle = bg; ctx.lineWidth = (2 + bass * 5) * S; ctx.beginPath(); ctx.moveTo(bx, 0); ctx.bezierCurveTo(bx + sway, H * .32, bx - sway, H * .66, bx + sway * .3, H); ctx.stroke();
      }
    }
    // A restrained chromatic vignette adds depth without flattening the source scene.
    var edge = ctx.createRadialGradient(W * .5, H * .5, Math.min(W, H) * .18, W * .5, H * .5, Math.max(W, H) * .72);
    edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'hsla(' + (hue + 215) % 360 + ',100%,30%,' + (.035 + energy * .025) + ')'); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = edge; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  var GL_HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'uniform vec2 res; uniform float time, hue, kick, energy;\n' +
    'vec3 pal(float t){ return .5 + .5 * cos(6.28318 * (t + vec3(0., .33, .67))); }\n' +
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);' +
    ' return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }\n';
  function glStart(name, frag) {
    var api = glUse(name, frag); if (!api) return null;
    glc.style.display = 'block'; cv.style.visibility = 'hidden';
    size();
    return api;
  }
  function glApi(prog) {
    function U(n) { if (!(n in prog.loc)) prog.loc[n] = gl.getUniformLocation(prog, n); return prog.loc[n]; }
    return {
      f: function (n, v) { gl.uniform1f(U(n), v); },
      v2: function (n, a, b2) { gl.uniform2f(U(n), a, b2); },
      v4a: function (n, arr) { gl.uniform4fv(U(n), arr); },
      v3a: function (n, arr) { gl.uniform3fv(U(n), arr); },
      v3: function (n, c) { gl.uniform3f(U(n), c[0], c[1], c[2]); },
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
  // Starts linking a program without waiting for it (the GPU compiles it in the background).
  function glPrepare(name, frag) {
    if (!ensureGl() || glProgs[name] || glPending[name]) return;
    try {
      var vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER), p = gl.createProgram();
      gl.shaderSource(vs, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'); gl.compileShader(vs);
      gl.shaderSource(fs, GL_HEAD + frag); gl.compileShader(fs);
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      glPending[name] = p;
    } catch (e) {}
  }
  // True when a prepared program can be used without making the screen wait.
  function glReady(name) {
    if (glProgs[name]) return true;
    var p = glPending[name]; if (!p) return false;
    var ext = gl.getExtension('KHR_parallel_shader_compile');
    return !ext || !!gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR);
  }
  function glProgram(name, frag) {
    var prog = glProgs[name];
    if (!prog && glPending[name]) {
      var pp = glPending[name]; delete glPending[name];
      if (gl.getProgramParameter(pp, gl.LINK_STATUS)) { prog = pp; prog.loc = {}; glProgs[name] = prog; }
      else { try { gl.deleteProgram(pp); } catch (e) {} }
    }
    if (!prog) {
      function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.log(gl.getShaderInfoLog(o)); return null; } return o; }
      var vs = sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'), fs = sh(gl.FRAGMENT_SHADER, GL_HEAD + frag);
      if (!vs || !fs) return null;
      prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      prog.loc = {}; glProgs[name] = prog;
    }
    return prog;
  }
  // Switches to a program (compiling it now only if it was never prepared). No resize, no restyle.
  function glUse(name, frag) {
    if (!ensureGl()) return null;
    var prog = glProgram(name, frag); if (!prog) return null;
    gl.useProgram(prog);
    var pl = gl.getAttribLocation(prog, 'p'); gl.bindBuffer(gl.ARRAY_BUFFER, glBuf); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
    return prog.api || (prog.api = glApi(prog));
  }
  // Creates the shared WebGL canvas and context once (without showing it).
  function ensureGl() {
    if (!glc) {
      glc = document.createElement('canvas');
      glc.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none';
      cv.parentNode.insertBefore(glc, cv.nextSibling);
      // preserveDrawingBuffer stays off: on the box's tile-based GPU keeping it on costs a full-screen
      // copy every frame. Snapshots (crossfades) redraw the current frame first, then copy it (glRedraw).
      try { gl = glc.getContext('webgl', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }) || glc.getContext('experimental-webgl'); } catch (e) { gl = null; }
      if (gl) {
        glBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      }
    }
    return gl;
  }
  // Re-renders the current frame into the drawing buffer so it can be copied in this same task.
  function glRedraw() { try { if (running && curDraw && glc && glc.style.display !== 'none') curDraw(last); } catch (e) {} }
  function glStop() { if (glc) glc.style.display = 'none'; cv.style.visibility = ''; }
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function every(fn, ms) { var t = setInterval(fn, ms); timers.push(t); return t; }
  function text(id, v) { $(id).innerHTML = v || ''; }
  function loop(draw, fps, minFps) {
    var gap = 1000 / (fps || 30);
    curDraw = draw;
    function f(now) {
      if (!running) return;
      raf = requestAnimationFrame(f);
      var targetGap = Math.max(gap, 1000 / (minFps || (HIGH_MEMORY_DEVICE ? 30 : 20)));
      if (now - last < targetGap) return;
      last = now;
      if (pendingSize) { pendingSize = false; size(); }
      var t0 = performance.now(); draw(now); renderAtmosphere(now); tuneQuality(now, targetGap, performance.now() - t0);
    }
    perf = { n: 0, slow: 0, since: 0 };
    raf = requestAnimationFrame(f);
  }








  var LIQUID_DREAMS_SHADER = `
uniform float envA, envB, envMix, flowT, bassL, midL, highL, moveAmt, detailAmt, complexity, brightness, quality;
uniform vec3 palN0, palN1, palN2, palN3, palO0, palO1, palO2, palO3;
uniform vec2 gravPos;
uniform float gravStr, gravSpin, touchHue, spectral, spectralO, colorPhase, energyL, kickL, hatL;
uniform vec4 colorWave;
// the palette each pixel uses: the new one inside a spreading colour wave, the previous one outside it
vec3 pal0, pal1, pal2, pal3;
float OCT, SPEC;
vec2 hash2LD(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}
float fbmLD(vec2 p,float oct){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<6;i++){if(float(i)>=oct)break;v+=a*noise(p);p=m*p+vec2(3.1,1.7);a*=.5;}return v;}
vec3 rainbowLD(float x){return clamp(abs(fract(x+vec3(0.,.6667,.3333))*6.-3.)-1.,0.,1.);}
// Palette ramp. Spectral palettes re-hue the ramp while keeping its brightness, so detail survives.
vec3 rampLD(float x){
 // with music the ramp leans toward the palette's brighter colours, rolling with the colour flow
 x=clamp(x+touchHue*.22+.035*sin(colorPhase*6.2832+x*3.)+.09*energyL*(.5+.5*sin(colorPhase*12.566+x*4.)),0.,1.);
 vec3 c=mix(pal0,pal1,smoothstep(0.,.4,x));c=mix(c,pal2,smoothstep(.35,.75,x));c=mix(c,pal3,smoothstep(.72,1.,x));
 float sp=clamp(SPEC,0.,1.);
 if(sp>.002){
  vec3 rb=rainbowLD(x*1.3+colorPhase);
  float L=dot(c,vec3(.299,.587,.114)),Lr=dot(rb,vec3(.299,.587,.114));
  vec3 tinted=rb*(L/max(Lr,.08))*1.08+c*.12;
  c=mix(c,tinted,sp);
 }
 return c;
}
float particlesLD(vec2 p,float t,float scale,float drift){vec2 g=p*scale+vec2(t*drift*.5,t*drift);vec2 id=floor(g),f=fract(g)-.5;vec2 h=hash2LD(id);float on=step(.86-detailAmt*.07,h.x);vec2 o=(h-.5)*.6+.12*vec2(sin(t*.7+h.y*6.),cos(t*.5+h.x*6.));float tw=.55+.45*sin(t*1.3+h.y*30.);return on*smoothstep(.09,.0,length(f-o))*tw;}
// DEEP FLOW: ink dispersing through deep water
vec3 deepFlowLD(vec2 p,float t){
 float sw=.55+moveAmt*.55+bassL*.22;
 vec2 q=p*1.2+vec2(0.,t*.035);
 vec2 a=vec2(fbmLD(q+vec2(0.,t*.06),OCT),fbmLD(q+vec2(5.2,1.3)-vec2(t*.05,0.),OCT));
 vec2 b=vec2(fbmLD(q+sw*1.9*a+vec2(1.7,9.2)+t*.04,OCT),fbmLD(q+sw*1.9*a+vec2(8.3,2.8)-t*.03,OCT));
 vec2 wq=q+(sw*2.1+midL*.12)*b;
 float d=fbmLD(wq,OCT),d2=fbmLD(wq+vec2(.035,.05),OCT);
 vec3 bg=mix(pal0*.4,pal1*.32,smoothstep(-.8,.8,p.y));
 float shaft=pow(max(0.,1.-abs(p.x*.75+p.y*.35-.1+sin(t*.07)*.12)),5.)*smoothstep(-.6,.7,p.y);
 bg+=rampLD(.7)*shaft*.14;
 float ink=smoothstep(.3,.68,d),core=smoothstep(.62,.95,d);
 float lit=clamp((d2-d)*14.,-1.,1.);
 vec3 inkCol=mix(rampLD(.32+b.x*.3),rampLD(.6+a.y*.25),clamp(length(b-a)*1.6,0.,1.));
 vec3 col=mix(bg,inkCol*(.75+.6*max(lit,0.)),ink*.92);
 col=mix(col,pal0*.15,core*.5);
 col+=rampLD(.95)*pow(max(lit,0.),2.)*ink*(1.-core)*(.28+highL*.35*detailAmt);
 col+=rampLD(.85)*pow(clamp(b.y*1.15-.2,0.,1.),4.)*ink*.18;
 float back=fbmLD(p*.55+vec2(t*.015,-t*.01)+a*.4,3.);
 col+=rampLD(.5)*smoothstep(.45,.8,back)*.14*(1.-ink);
 col+=particlesLD(p,t,14.,.06)*rampLD(.95)*(.3+highL*.9)*detailAmt;
 return col;
}
// IRIDESCENCE: translucent liquid glass with thin-film colour
float glassHLD(vec2 p,float t){float h=0.;for(int i=0;i<7;i++){float fi=float(i);if(fi>=4.+complexity*3.)break;vec2 c=vec2(sin(t*(.07+fi*.017)+fi*1.9)*.7,cos(t*(.06+fi*.013)+fi*2.7)*.36);float r=.17+.1*fract(fi*.618)+.04*sin(fi*2.1+t*.09)+bassL*.035*moveAmt;vec2 d=p-c;h+=exp(-dot(d,d)/(r*r));}return h+(.08*moveAmt+midL*.06)*(noise(p*1.7+vec2(t*.05,-t*.04))-.5);}
vec3 glassBgLD(vec2 q,float t){
 vec3 c=pal0*.45+pal1*.22*smoothstep(-.9,.9,q.y);
 c+=rampLD(.55)*pow(.5+.5*sin(q.x*2.2+q.y*3.1+t*.03),8.)*.16;
 c+=rampLD(.75)*pow(.5+.5*sin(q.x*-3.4+q.y*1.3-t*.025+1.),14.)*.12;
 c+=rampLD(.65)*exp(-dot(q-vec2(.5,.22),q-vec2(.5,.22))*2.4)*.26;
 c+=rampLD(.88)*exp(-dot(q+vec2(.55,.18),q+vec2(.55,.18))*3.2)*.2;
 return c;
}
vec3 iridescenceLD(vec2 p,float t){
 float e=.008,h=glassHLD(p,t),hx=glassHLD(p+vec2(e,0.),t),hy=glassHLD(p+vec2(0.,e),t);
 vec2 g=vec2(hx-h,hy-h)/e;
 float mask=smoothstep(.5,.55,h);
 g+=highL*detailAmt*.25*vec2(sin(p.y*38.+t*1.6),cos(p.x*34.-t*1.4))*mask;
 vec3 n=normalize(vec3(-g*.28,1.));
 float fres=pow(1.-n.z,1.2);
 vec3 bg=glassBgLD(p,t);
 vec2 o=n.xy*.32;
 vec3 refr=vec3(glassBgLD(p-o*1.08,t).r,glassBgLD(p-o,t).g,glassBgLD(p-o*.92,t).b)*1.25;
 refr*=mix(vec3(1.),rampLD(.8),.2);
 vec3 film=.5+.5*cos(6.2832*(h*.6+fres*1.6+t*.012+vec3(0.,.33,.67)));
 vec3 rim=mix(rampLD(.9),film*rampLD(.95)*1.5,.28)*pow(fres,1.5)*1.6;
 float spec=pow(max(dot(reflect(-normalize(vec3(-.45,.55,.7)),n),vec3(0.,0.,1.)),0.),30.)*.6;
 float soft=pow(max(dot(reflect(-normalize(vec3(-.4,.6,.7)),n),vec3(0.,0.,1.)),0.),9.)*.14;
 float caust=pow(max(0.,1.-length(n.xy)*2.4),4.)*smoothstep(.65,1.3,h)*.22;
 vec3 glass=refr*.95+rim+rampLD(.95)*caust+(spec+soft)*mix(vec3(1.),pal3,.3)*(.95+highL*.3);
 glass+=rampLD(.98)*(smoothstep(.5,.515,h)-smoothstep(.515,.57,h))*.35;
 float shadow=smoothstep(.25,.6,glassHLD(p+vec2(-.05,.07),t))*(1.-mask);
 return mix(bg*(1.-shadow*.45),glass,mask);
}
// ETHER: floating silk ribbons in soft atmospheric light
vec3 etherLD(vec2 p,float t){
 vec3 col=mix(pal0*.55,pal1*.55,smoothstep(-.9,.9,p.y*.8-p.x*.25));
 col+=rampLD(.7)*smoothstep(.35,.8,fbmLD(p*1.1+vec2(t*.02,0.),3.))*.1;
 col+=rampLD(.9)*exp(-dot(p-vec2(-.55,.42),p-vec2(-.55,.42))*1.6)*.18;
 float n=3.+floor(complexity*2.+.5);
 for(int i=0;i<5;i++){float fi=float(i);if(fi>=n)break;float x=p.x;
  float amp=(.22+.05*fi)*(.55+moveAmt*.45);
  float y=sin(x*(.85+fi*.11)+t*(.16+fi*.017)+fi*1.7)*amp+.09*sin(x*2.3-t*.21+fi*2.)+(fi-(n-1.)*.5)*.16+bassL*.04*sin(x*1.4+fi);
  float w=.055+.035*sin(x*1.3+t*.19+fi*2.4)+.012*fi,d=(p.y-y)/w;
  float body=smoothstep(1.,.35,abs(d)),twist=sin(x*2.6+t*.27+fi*2.1+midL*.8),sheen=pow(.5+.5*cos(d*1.7+twist*2.2),4.);
  col=mix(col,rampLD(.35+fi*.11+sheen*.35)*(.6+sheen*.9),body*(.18+.35*sheen));
  col+=rampLD(.85)*(exp(-abs(p.y-y)*22.)*.035+exp(-abs(p.y-y)*5.)*.025)*(1.+highL*detailAmt);}
 col+=particlesLD(p*.7,t*.6,8.,.03)*rampLD(1.)*.35*detailAmt;
 return col;
}
// LIQUID CHROME: molten mirror surface in a studio light environment
float chromeHLD(vec2 p,float t){vec2 q=p*1.6;q+=.45*(.45+moveAmt*.6)*vec2(sin(q.y*1.1+t*.17),cos(q.x*.95-t*.14));q+=(.22*(.4+complexity)+midL*.15)*vec2(sin(q.y*2.4-t*.11),cos(q.x*2.1+t*.13));float h=.5*sin(q.x*1.4+t*.12)*cos(q.y*1.6-t*.1)+.3*sin((q.x+q.y)*2.1+t*.15)+.2*sin(q.x*2.9-q.y*1.2-t*.11);return h*(1.+bassL*.35);}
vec3 studioLD(vec3 r){
 float y=r.y+.1*r.x;
 vec3 c=mix(pal0*.35,pal1*.5,smoothstep(-1.,-.1,y));
 c=mix(c,mix(pal1,pal3,.55),smoothstep(-.15,.35,y));
 c=mix(c,pal1*.6,smoothstep(.45,1.,y));
 c+=pal3*.9*exp(-pow((y-.05)*28.,2.));
 c+=pal3*1.1*smoothstep(.1,.05,abs(r.x+.4))*smoothstep(.1,.2,y)*smoothstep(.9,.65,y);
 c+=pal2*.28*smoothstep(.3,.04,abs(r.x-.45))*smoothstep(-.7,-.4,y)*smoothstep(.05,-.15,y);
 return c;
}
vec3 chromeLD(vec2 p,float t){
 float e=.008,h=chromeHLD(p,t),hx=chromeHLD(p+vec2(e,0.),t),hy=chromeHLD(p+vec2(0.,e),t);
 vec2 g=vec2(hx-h,hy-h)/e;
 g+=highL*detailAmt*.12*vec2(sin(p.x*34.+p.y*9.+t*1.6),sin(p.y*31.-p.x*7.-t*1.4));
 vec3 n=normalize(vec3(-g*.42,1.)),r=reflect(vec3(0.,0.,-1.),n);
 vec3 c=studioLD(r)*mix(vec3(1.),pal2*1.4,.15);
 c*=.55+.45*smoothstep(-.8,.5,h);
 c+=pal3*pow(max(dot(n,normalize(vec3(-.3,.45,.85))),0.),140.)*.8;
 float frame=smoothstep(1.45,.3,length(p*vec2(.7,1.)));
 return mix(pal0*.15,c,frame);
}
// COSMIC MELT: slow nebula flowing like melting light
vec3 cosmicLD(vec2 p,float t){
 vec2 q=p*1.05;q.y+=t*.018;
 vec2 w=vec2(fbmLD(q*1.2+vec2(t*.02,0.),OCT),fbmLD(q*1.2+vec2(4.7,t*.015),OCT));
 w+=.22*(moveAmt+bassL*.3)*vec2(sin(q.y*1.7+t*.11),0.);
 float n=fbmLD(q*1.6+w*(2.4+midL*.2),OCT),dust=fbmLD(q*3.1-w*1.3+7.,3.),wisp=fbmLD(q*2.4-w*1.8+2.,OCT);
 float neb=pow(smoothstep(.28,.82,n),1.5);
 vec3 col=pal0*.2+rampLD(.25+n*.5)*neb*1.15;
 col+=rampLD(.45+w.y*.3)*pow(smoothstep(.45,.8,wisp),2.)*.45;
 col+=rampLD(.8+w.x*.2)*pow(smoothstep(.55,.88,n),2.)*.9;
 col*=1.-smoothstep(.45,.75,dust)*.65;
 vec2 cp=p-vec2(.18*sin(t*.04),.06*cos(t*.05));
 col+=rampLD(.92)*(exp(-length(cp)*2.6)*(.18+bassL*.06)+exp(-length(cp)*14.)*.18)*(.35+neb);
 col+=particlesLD(p,t*.15,22.,.01)*vec3(.9,.95,1.)*(.6+highL*.8)*detailAmt;
 col+=particlesLD(p*1.7+3.,t*.2,30.,.008)*rampLD(1.)*.4*detailAmt;
 return col;
}
// ORGANIC: translucent living membranes
vec3 cellsLD(vec2 p,float t,out vec2 dv){vec2 i=floor(p),f=fract(p);float f1=8.,f2=8.,id=0.;dv=vec2(0.);for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y)),h=hash2LD(i+g),o=.5+.36*sin(t*(.18+h*.14)+h*6.2832);vec2 r=g+o-f;float d=length(r);if(d<f1){f2=f1;f1=d;id=h.x;dv=r;}else if(d<f2)f2=d;}return vec3(f1,f2,id);}
vec3 organicLD(vec2 p,float t){
 float breath=1.+.035*sin(t*.3)+bassL*.05*moveAmt;
 vec2 warp=(.3+.25*moveAmt)*(1.+midL*.4)*(vec2(fbmLD(p*1.2+t*.04,3.),fbmLD(p*1.2+4.-t*.035,3.))-.47);
 vec2 dv,dv2;
 vec3 c=cellsLD((p+warp)*1.6/breath,t,dv);
 float gap=c.y-c.x,seam=1.-exp(-gap*gap*500.),rimIn=exp(-gap*8.);
 vec3 c2=cellsLD((p+warp*.4)*3.4+vec2(t*.015,0.)+9.,t*.7,dv2);
 vec3 col=mix(pal0*.4,pal1*.2,smoothstep(-.9,.9,p.y));
 col+=rampLD(.35+c2.z*.2)*exp(-(c2.y-c2.x)*7.)*.16*(.4+complexity);
 float memb=.55+.45*fbmLD(p*3.+c.z*9.+t*.03,3.);
 vec3 body=rampLD(.22+c.z*.3)*(.1+.28*smoothstep(.75,0.,c.x))+rampLD(.62+c.z*.22)*rimIn*.9*memb+rampLD(.97)*pow(rimIn,6.)*.45;
 float gloss=exp(-dot(dv-vec2(.17,-.17),dv-vec2(.17,-.17))*22.)*smoothstep(.02,.15,gap);
 body+=mix(rampLD(.9),vec3(1.),.3)*gloss*.22;
 col=mix(col*.8+pal1*.08,body*1.15+col*.35,.88*seam);
 float nuc=exp(-c.x*c.x*80.)*(.55+.45*sin(t*.5+c.z*20.));
 col+=rampLD(.8)*nuc*(.22+highL*.3*detailAmt)*seam;
 col+=particlesLD(p*.9,t*.3,10.,.02)*rampLD(.9)*.25*detailAmt;
 return col;
}
vec3 envLD(float id,vec2 p,float t){if(id<.5)return deepFlowLD(p,t);if(id<1.5)return iridescenceLD(p,t);if(id<2.5)return etherLD(p,t);if(id<3.5)return chromeLD(p,t);if(id<4.5)return cosmicLD(p,t);return organicLD(p,t);}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;
 OCT=clamp(3.+complexity*1.6+quality*.8,3.,6.);
 float t=flowT;vec2 p=uv;
 // GRAVITY POINT: a real space warp. Each pixel samples the liquid from further out and rotated,
 // so the whole surrounding world is pulled, stretched and swirled into a funnel at the finger.
 vec2 g=uv-gravPos;float r=length(g)+1e-4;
 float R=.62+.12*quality,k=exp(-r*r/(R*R)),core=exp(-r*r*55.);
 float ang=gravStr*(2.6*exp(-r*3.2)+.7*k)+gravSpin*exp(-r*2.4)*max(gravStr,0.);
 float cs=cos(ang),sn=sin(ang);
 vec2 gw=mat2(cs,-sn,sn,cs)*g*(1.+gravStr*k*1.7);
 p=gravPos+gw;
 // COLOUR WAVE: a tap picks a new palette, which spreads evenly from the touch point in every
 // direction and replaces the old colours as it passes; the liquid ripples slightly at the front.
 float wv=1.,front=0.;
 if(colorWave.w>.5){vec2 d=uv-colorWave.xy;float dist=length(d)+.02*(noise(uv*6.+colorWave.z*2.)-.5);
  wv=smoothstep(colorWave.z+.02,colorWave.z-.16,dist);front=exp(-pow((dist-colorWave.z)/.05,2.));
  p+=d/max(length(d),.001)*front*.014;}
 // MUSIC: the liquid breathes outward on each kick (strongest mid-screen, uneven like real fluid) and the
 // low end bends the flow; both fade to nothing when the music is quiet.
 {vec2 mc=p;float mr=length(mc);float wob=.75+.5*noise(mc*2.2+t*.15);
  p*=1.-kickL*.065*wob*smoothstep(1.7,.05,mr);
  p+=bassL*.028*vec2(sin(p.y*2.3+t*.8),cos(p.x*1.9-t*.7));}
 pal0=mix(palO0,palN0,wv);pal1=mix(palO1,palN1,wv);pal2=mix(palO2,palN2,wv);pal3=mix(palO3,palN3,wv);SPEC=mix(spectralO,spectral,wv);
 vec3 col=envLD(envA,p,t);
 if(envMix>.001){vec3 other=envLD(envB,p,t);float n=fbmLD(uv*1.6+vec2(7.1,3.3)+t*.02,3.);col=mix(col,other,smoothstep(n-.14,n+.14,envMix*1.3-.15));}
 // a soft band of light rides the colour front
 col+=mix(pal2,vec3(1.),.3)*front*.2;
 // funnel: a dark core with a lensed rim of light around the gravity point
 col*=1.-clamp(gravStr,0.,1.)*.75*exp(-r*r*90.);
 col+=rampLD(.97)*clamp(gravStr,0.,1.)*exp(-pow((r-.06)/.011,2.))*.32;
 col*=1.+energyL*.14+kickL*.2;
 // hi-hats: a fine shimmer in the brighter parts of the liquid
 col+=col*hatL*.16*smoothstep(.55,.95,noise(uv*36.+vec2(t*2.1,-t*1.7)));
 // colour finish: vibrance (deeper with the music's energy) and a filmic curve that keeps neon saturated and lifts dark detail
 float lum=dot(col,vec3(.299,.587,.114));
 col=max(mix(vec3(lum),col,1.32+energyL*.16),0.);
 col*=brightness*1.38;
 col=clamp(col*(2.51*col+.03)/(col*(2.43*col+.59)+.14),0.,1.);
 col=pow(col,vec3(.9));
 col*=.66+.34*smoothstep(1.35,.25,length(uv*vec2(.9,1.)));
 col+=(hash(gl_FragCoord.xy+fract(t*7.))-.5)*(1.5/255.);
 gl_FragColor=vec4(clamp(col,0.,1.),1.);
}
`;
  // One small program per experience: the box's GPU only runs the code of the experience on screen
  // (a single program holding all six ran every experience's code for every pixel, 3 to 15x slower).
  // During a change the new experience is drawn over the old one through the same liquid noise front.
  var LD_FNS = ['deepFlowLD', 'iridescenceLD', 'etherLD', 'chromeLD', 'cosmicLD', 'organicLD'];
  function ldEnvShader(i) {
    return LIQUID_DREAMS_SHADER
      .replace(/vec3 envLD\(float id,vec2 p,float t\)\{[^\n]*\}/, 'vec3 envLD(float id,vec2 p,float t){return ' + LD_FNS[i] + '(p,t);}')
      .replace(' if(envMix>.001){vec3 other=envLD(envB,p,t);float n=fbmLD(uv*1.6+vec2(7.1,3.3)+t*.02,3.);col=mix(col,other,smoothstep(n-.14,n+.14,envMix*1.3-.15));}',
        ' float ldA=1.;if(envMix>.001){float n=fbmLD(uv*1.6+vec2(7.1,3.3)+t*.02,3.);ldA=smoothstep(n-.14,n+.14,envMix*1.3-.15);}')
      .replace('gl_FragColor=vec4(clamp(col,0.,1.),1.);', 'gl_FragColor=vec4(clamp(col,0.,1.),ldA);');
  }

  // LIQUID DREAMS — six composed GPU experiences with rich palettes, independent Experience and
  // Color Shift cycling, Colour Wave (tap) and Gravity Point (press and hold) touch interaction.
  var LD_ENVIRONMENTS = [
    { id: 'deepflow', name: 'Deep Flow', note: 'Ink through deep water', palette: 'deepteal' },
    { id: 'iridescence', name: 'Iridescence', note: 'Liquid glass', palette: 'iridescent' },
    { id: 'ether', name: 'Ether', note: 'Silk in soft light', palette: 'violet' },
    { id: 'chrome', name: 'Liquid Chrome', note: 'Molten mirror', palette: 'chrome' },
    { id: 'cosmic', name: 'Cosmic Melt', note: 'Flowing nebulae', palette: 'obsidian' },
    { id: 'organic', name: 'Organic', note: 'Living membranes', palette: 'aurora' }
  ];
  // Four stops each (deep shadow, body, accent, highlight). s = spectral amount: how strongly the
  // palette re-hues the liquid across the full spectrum while keeping its light and shade.
  var LD_PALETTES = {
    electric: { name: 'Electric Blue & Violet', s: 0, c: [[.01,.01,.09],[.06,.14,.82],[.52,.22,1],[.8,.93,1]] },
    pink: { name: 'Deep Pink & Magenta', s: 0, c: [[.05,0,.04],[.46,.02,.32],[1,.12,.62],[1,.8,.95]] },
    rainbow: { name: 'Full Spectrum Rainbow', s: .9, c: [[.02,.01,.06],[.25,.2,.6],[.7,.5,.9],[1,1,1]] },
    ultraviolet: { name: 'Ultraviolet Psychedelic', s: .45, c: [[.03,0,.09],[.36,0,.74],[.94,.12,1],[.35,1,.9]] },
    flowing: { name: 'Flowing Spectrum', s: .3, c: [[0,.04,.09],[.05,.42,.64],[.96,.3,.62],[1,.9,.5]] },
    neon: { name: 'Neon', s: 0, c: [[0,0,.03],[0,.56,.46],[1,.06,.8],[.66,1,.12]] },
    midnight: { name: 'Midnight Blue', s: 0, c: [[.01,.02,.07],[.04,.14,.4],[.2,.45,1],[.75,.88,1]] },
    deepteal: { name: 'Deep Teal', s: 0, c: [[0,.04,.05],[.01,.24,.28],[.05,.66,.66],[.65,1,.95]] },
    violet: { name: 'Violet Haze', s: 0, c: [[.03,.012,.07],[.22,.06,.42],[.62,.3,.98],[.96,.82,1]] },
    chrome: { name: 'Liquid Chrome', s: 0, c: [[.02,.022,.03],[.18,.2,.24],[.58,.63,.72],[.98,.99,1]] },
    iridescent: { name: 'Iridescent', s: .12, c: [[.03,.02,.08],[.1,.26,.62],[.82,.26,.86],[.55,1,.95]] },
    aurora: { name: 'Aurora', s: 0, c: [[0,.03,.05],[.02,.34,.32],[.2,.95,.55],[.86,.74,1]] },
    obsidian: { name: 'Obsidian & Magenta', s: 0, c: [[.01,.004,.016],[.14,.01,.14],[.86,.06,.5],[1,.7,.9]] },
    arctic: { name: 'Arctic Cyan', s: 0, c: [[.01,.04,.08],[.06,.38,.56],[.36,.88,1],[.92,1,1]] }
  };
  // COLOR SHIFT walks this order; it never changes the experience.
  var LD_SHIFT_ORDER = ['electric','pink','rainbow','ultraviolet','flowing','neon','midnight','deepteal','violet','chrome','iridescent','aurora','obsidian','arctic'];
  var LD_PALETTE_ORDER = LD_SHIFT_ORDER;
  var LD_RANGES = { speed: [.2, 2], movement: [0, 2], audio: [.3, 2], bass: [.3, 2], colorSpeed: [.25, 3], brightness: [.6, 1.5], detail: [0, 2], complexity: [0, 2] };
  // Play All intervals (seconds). Visual Play All cycles the six experiences, Colour Play All the palettes.
  var LD_VISUAL_PLAY_SECS = [10, 30, 60], LD_COLOR_PLAY_SECS = [10, 20, 30];
  var LD_ICONS = {
    exit: '<svg viewBox="0 0 24 24"><path d="M14.5 6.5L9 12l5.5 5.5"/><path d="M9.5 12H20"/><path d="M4 4.5v15"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    controls: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>'
  };

  function liquidDreams() {
    var b = beatTracker({ quiet: true }), lastT = performance.now();
    // Six-band music analysis (shared with Visuals): volume-independent levels, kick / snare / hat
    // detection, tempo, build-ups and drops. Falls back to the beat tracker if it isn't loaded.
    var NM = window.NXV && NXV.musicTick ? NXV : null;
    if (NM) { try { NM.musicReset(); if (A && A.meterDetail) A.meterDetail(true); } catch (e) {} }
    var kickL = 0, hatL = 0, tempoK = 1, kickSeen = 0, hatSeen = 0;
    var envIds = LD_ENVIRONMENTS.map(function (e) { return e.id; });
    var colors = ['signature'].concat(LD_SHIFT_ORDER);
    var defaults = { v: 3, env: 'deepflow', color: 'electric', speed: 1, movement: 1, audio: 1, bass: 1, colorSpeed: 1, brightness: 1, detail: 1, complexity: 1, lowMotion: false, touch: true };
    var legacyEnv = { tunnel: 'cosmic', kaleidoscope: 'iridescence', liquid: 'deepflow', cosmic: 'cosmic', morph: 'organic', prism: 'iridescence', ink: 'deepflow', clouds: 'ether', chrome: 'ether', fluid: 'deepflow', oil: 'deepflow', psychedelic: 'iridescence' };
    var legacyColor = { spectrum: 'electric', electric: 'arctic', rush: 'aurora', rainbow: 'iridescent', ultraviolet: 'violet', storm: 'chrome' };
    function read(key, fallback) { try { var v = N.pref(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
    function write(key, val) { try { if (A && A.setPref) A.setPref(key, JSON.stringify(val)); else localStorage.setItem('p_' + key, JSON.stringify(val)); } catch (e) {} }
    function normalizeState(value) {
      var src = value && typeof value === 'object' ? value : {}, next = Object.assign({}, defaults);
      if (src.v !== 2 && src.v !== 3) {
        // The first Liquid Dreams' settings and saved vibes migrate to the nearest experience and palette.
        if (legacyEnv[src.style]) next.env = legacyEnv[src.style];
        if (legacyColor[src.color]) next.color = legacyColor[src.color];
        if (isFinite(+src.speed)) next.speed = +src.speed;
        if (isFinite(+src.bass)) next.bass = +src.bass;
        if (isFinite(+src.music)) next.audio = +src.music;
        if (isFinite(+src.treble)) next.detail = +src.treble;
        if (src.intensity === 'intense') next.complexity = 1.4; else if (src.intensity === 'insane') next.complexity = 1.8;
      } else Object.keys(defaults).forEach(function (k) { if (k in src && k !== 'v') next[k] = src[k]; });
      // Version 2 kept touch off in its default Driving mode; touch interaction is now on unless switched off.
      if (src.v !== 3) next.touch = true;
      if (envIds.indexOf(next.env) < 0) next.env = defaults.env;
      // The old Music Reactive colour mode is gone: music now animates every palette, and automatic
      // colour changes belong to Colour Play All. Saved settings and looks using it move to the default palette.
      if (next.color === 'music' || colors.indexOf(next.color) < 0) next.color = defaults.color;
      next.lowMotion = next.lowMotion === true;
      next.touch = next.touch !== false;
      Object.keys(LD_RANGES).forEach(function (k) {
        var n = Number(next[k]), r = LD_RANGES[k];
        next[k] = Math.max(r[0], Math.min(r[1], isFinite(n) ? n : defaults[k]));
      });
      next.v = 3;
      return next;
    }
    var state = normalizeState(read('liquidDreams.settings', defaults));
    var presets = read('liquidDreams.presets', []);
    if (!Array.isArray(presets)) presets = [];
    presets = presets.filter(function (p) { return p && typeof p === 'object'; }).map(function (p) { return { name: String(p.name || 'Saved look'), settings: normalizeState(p.settings) }; });
    // Visual Play All and Colour Play All: independent switches and intervals, remembered between visits.
    function normalizePlay(v) {
      var src = v && typeof v === 'object' ? v : {}, vis = src.visual || {}, col = src.color || {};
      return { visual: { on: vis.on === true, secs: LD_VISUAL_PLAY_SECS.indexOf(+vis.secs) >= 0 ? +vis.secs : 30 },
        color: { on: col.on === true, secs: LD_COLOR_PLAY_SECS.indexOf(+col.secs) >= 0 ? +col.secs : 20 } };
    }
    var play = normalizePlay(read('liquidDreams.playAll', null)), visualDueAt = 0, colorDueAt = 0;
    function savePlay() { write('liquidDreams.playAll', play); }
    var clean = false, alive = true, idleTimer = 0, toastTimer = 0;
    function envInfo(id) { for (var i = 0; i < LD_ENVIRONMENTS.length; i++) if (LD_ENVIRONMENTS[i].id === id) return LD_ENVIRONMENTS[i]; return LD_ENVIRONMENTS[0]; }
    function css(c) { return 'rgb(' + c.map(function (v) { return Math.round(Math.min(1, v) * 255); }).join(',') + ')'; }
    function swatch(key) {
      var p = LD_PALETTES[key], c = p.c;
      if (p.s > .5) return 'linear-gradient(135deg,#ff3b6b,#ffb52e 25%,#4dff7a 45%,#2ec8ff 65%,#8a4dff 85%,#ff4de1)';
      return 'linear-gradient(135deg,' + css(c[0]) + ' 0%,' + css(c[1]) + ' 38%,' + css(c[2]) + ' 72%,' + css(c[3]) + ' 100%)';
    }
    function activePaletteKey() { return state.color === 'signature' ? envInfo(state.env).palette : state.color; }
    function slider(key, label) { var r = LD_RANGES[key]; return '<label class="ld-slider"><span>' + label + '</span><output data-out="' + key + '"></output><input type="range" min="' + r[0] + '" max="' + r[1] + '" step=".05" data-setting="' + key + '"></label>'; }
    var ui = document.createElement('div'); ui.className = 'ld-ui';
    ui.innerHTML =
      '<div class="ld-toast" aria-live="polite"></div>' +
      '<nav class="ld-dock" aria-label="Liquid Dreams">' +
      '<button class="ld-exit" type="button" data-action="exit" aria-label="Exit Liquid Dreams">' + LD_ICONS.exit + '<span>Exit</span></button>' +
      '<div class="ld-dock-mid">' +
      '<button class="ld-next" type="button" data-action="next" aria-label="Next visual experience"><span class="ld-k">Experience</span><b data-envname></b>' + LD_ICONS.next + '</button>' +
      '<button class="ld-shift" type="button" data-action="shift" aria-label="Color Shift: next palette"><i class="ld-shift-sw" data-shiftsw></i><span class="ld-k">Color Shift</span><b data-palname></b></button>' +
      '</div>' +
      '<button class="ld-ctl" type="button" data-action="controls" aria-label="Show Liquid Dreams controls">' + LD_ICONS.controls + '<span>Controls</span></button>' +
      '</nav>' +
      '<section class="ld-panel ld-hidden" aria-label="Liquid Dreams controls">' +
      '<header><div><b>Liquid Dreams</b><small data-now></small></div><button class="ld-x" type="button" data-action="close" aria-label="Close controls">×</button></header>' +
      '<div class="ld-title">Experience</div><div class="ld-envs">' + LD_ENVIRONMENTS.map(function (e) {
        return '<button type="button" data-env="' + e.id + '"><span class="ld-sw" style="background:' + swatch(e.palette) + '"></span><b>' + e.name + '</b><small>' + e.note + '</small></button>';
      }).join('') + '</div>' +
      '<div class="ld-title">Colour</div><div class="ld-colors">' +
      LD_SHIFT_ORDER.map(function (k) { return '<button type="button" data-color="' + k + '"><span class="ld-dot" style="background:' + swatch(k) + '"></span>' + LD_PALETTES[k].name + '</button>'; }).join('') +
      '<button type="button" data-color="signature"><span class="ld-dot ld-dot-sig"></span>Signature</button></div>' +
      '<div class="ld-title">Play All</div><div class="ld-play">' +
      '<div class="ld-play-row" data-play-row="visual"><button type="button" class="ld-play-sw" data-play="visual" aria-pressed="false"></button><span class="ld-play-k">Visual Play All<small>All six experiences, in order</small></span><div class="ld-play-secs">' +
      LD_VISUAL_PLAY_SECS.map(function (n) { return '<button type="button" data-play-secs="visual:' + n + '">' + (n < 60 ? n + 's' : '1 min') + '</button>'; }).join('') + '</div></div>' +
      '<div class="ld-play-row" data-play-row="color"><button type="button" class="ld-play-sw" data-play="color" aria-pressed="false"></button><span class="ld-play-k">Colour Play All<small>Every palette, experience stays</small></span><div class="ld-play-secs">' +
      LD_COLOR_PLAY_SECS.map(function (n) { return '<button type="button" data-play-secs="color:' + n + '">' + n + 's</button>'; }).join('') + '</div></div></div>' +
      '<div class="ld-quick"><button type="button" data-action="lowmotion">Low motion</button><button type="button" data-action="shuffle">Shuffle</button><button type="button" data-action="clean">Clean screen</button></div>' +
      '<details class="ld-group" open><summary>Motion</summary>' + slider('speed', 'Animation speed') + slider('movement', 'Movement intensity') + slider('colorSpeed', 'Colour transition speed') + '</details>' +
      '<details class="ld-group"><summary>Sound</summary>' + slider('audio', 'Audio sensitivity') + slider('bass', 'Bass response') + '</details>' +
      '<details class="ld-group"><summary>Look</summary>' + slider('brightness', 'Brightness') + slider('detail', 'Fine detail') + slider('complexity', 'Visual complexity') + '</details>' +
      '<details class="ld-group"><summary>Touch &amp; saved looks</summary>' +
      '<div class="ld-drive"><button type="button" data-action="touch"></button><span>Tap: a new colour spreads from your finger. Press and hold, then drag: Gravity Point. Two fingers: shift hue. Turn off while driving.</span></div>' +
      '<div class="ld-save"><input data-name maxlength="24" placeholder="Name this look"><button type="button" data-action="save">Save</button></div>' +
      '<div class="ld-presets"></div><button type="button" class="ld-reset" data-action="reset">Restore default settings</button></details>' +
      '<button class="ld-return" type="button" data-action="exit">Return to Nexus</button></section><div class="ld-track" aria-live="polite"></div>';
    layer.appendChild(ui); xpDom.push(ui);
    var panel = ui.querySelector('.ld-panel'), presetBox = ui.querySelector('.ld-presets'), trackLabel = ui.querySelector('.ld-track'), nowLabel = ui.querySelector('[data-now]'), toast = ui.querySelector('.ld-toast'), trackTimer = 0;
    function saveState() { write('liquidDreams.settings', state); }
    function presetList() {
      presetBox.innerHTML = '';
      if (!presets.length) { presetBox.innerHTML = '<small class="ld-empty">No saved looks yet</small>'; return; }
      presets.forEach(function (p, i) {
        var row = document.createElement('div'); row.className = 'ld-preset';
        var load = document.createElement('button'); load.type = 'button'; load.dataset.load = String(i); load.textContent = p.name;
        var del = document.createElement('button'); del.type = 'button'; del.dataset.delete = String(i); del.textContent = '×'; del.setAttribute('aria-label', 'Delete ' + p.name);
        row.appendChild(load); row.appendChild(del); presetBox.appendChild(row);
      });
    }
    function colorName() { return state.color === 'signature' ? 'Signature' : LD_PALETTES[state.color].name; }
    function syncUi() {
      ui.querySelectorAll('[data-setting]').forEach(function (el) { el.value = state[el.dataset.setting]; });
      ui.querySelectorAll('[data-out]').forEach(function (el) { el.textContent = Math.round(state[el.dataset.out] * 100) + '%'; });
      ui.querySelectorAll('[data-env]').forEach(function (el) { el.classList.toggle('selected', el.dataset.env === state.env); el.setAttribute('aria-pressed', el.dataset.env === state.env); });
      ui.querySelectorAll('[data-color]').forEach(function (el) { el.classList.toggle('selected', el.dataset.color === state.color); el.setAttribute('aria-pressed', el.dataset.color === state.color); });
      ui.querySelector('[data-action="lowmotion"]').classList.toggle('selected', state.lowMotion);
      var touchBtn = ui.querySelector('[data-action="touch"]');
      touchBtn.textContent = state.touch ? 'Touch effects: On' : 'Touch effects: Off';
      touchBtn.classList.toggle('selected', state.touch);
      nowLabel.textContent = envInfo(state.env).name + ' · ' + colorName();
      ui.querySelector('[data-envname]').textContent = envInfo(state.env).name;
      ui.querySelector('[data-palname]').textContent = colorName();
      ui.querySelector('[data-shiftsw]').style.background = swatch(activePaletteKey());
      ['visual', 'color'].forEach(function (kind) {
        var sw = ui.querySelector('[data-play="' + kind + '"]'), on = play[kind].on;
        sw.textContent = on ? 'On' : 'Off'; sw.classList.toggle('selected', on); sw.setAttribute('aria-pressed', on ? 'true' : 'false');
        ui.querySelectorAll('[data-play-secs^="' + kind + ':"]').forEach(function (el) { var sel = +el.dataset.playSecs.split(':')[1] === play[kind].secs; el.classList.toggle('selected', sel); el.setAttribute('aria-pressed', sel ? 'true' : 'false'); });
      });
      ui.querySelector('.ld-next').classList.toggle('ld-auto', play.visual.on);
      ui.querySelector('.ld-shift').classList.toggle('ld-auto', play.color.on);
    }
    // The dock stays reachable at all times; it settles to a quiet state when untouched.
    function wake() { ui.classList.remove('ld-idle'); clearTimeout(idleTimer); idleTimer = setTimeout(function () { if (alive) ui.classList.add('ld-idle'); }, 5000); }
    function showToast(main, sub) {
      toast.innerHTML = '<b>' + main + '</b>' + (sub ? '<small>' + sub + '</small>' : '');
      toast.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.classList.remove('on'); }, 1800);
    }
    function openPanel() { clean = false; ui.classList.remove('ld-clean'); panel.classList.remove('ld-hidden'); wake(); }
    function closePanel() { panel.classList.add('ld-hidden'); wake(); }
    function conceal() { clean = true; ui.classList.add('ld-clean'); panel.classList.add('ld-hidden'); ui.classList.add('ld-idle'); clearTimeout(idleTimer); }
    // VISUAL EXPERIENCE button: next experience, wrapping round; the chosen palette stays as it is.
    function nextExperience() {
      if (state.color === 'signature') state.color = envInfo(state.env).palette;
      state.env = envIds[(envIds.indexOf(state.env) + 1) % envIds.length];
      syncUi(); saveState(); showToast(envInfo(state.env).name, (envIds.indexOf(state.env) + 1) + ' of ' + envIds.length);
    }
    // COLOR SHIFT button: next palette only; the experience stays as it is.
    function colorShift() {
      var i = LD_SHIFT_ORDER.indexOf(activePaletteKey());
      state.color = LD_SHIFT_ORDER[(i + 1) % LD_SHIFT_ORDER.length];
      syncUi(); saveState(); showToast(LD_PALETTES[state.color].name, 'Color Shift');
    }
    function secsLabel(n) { return n < 60 ? n + ' seconds' : '1 minute'; }
    // Play All runs from the render loop's clock: one schedule per control, nothing left running after exit.
    function runPlayAll(now) {
      if (play.visual.on) { if (!visualDueAt) visualDueAt = now + play.visual.secs * 1000; else if (now >= visualDueAt) { nextExperience(); visualDueAt = now + play.visual.secs * 1000; } } else visualDueAt = 0;
      if (play.color.on) { if (!colorDueAt) colorDueAt = now + play.color.secs * 1000; else if (now >= colorDueAt) { colorShift(); colorDueAt = now + play.color.secs * 1000; } } else colorDueAt = 0;
    }
    function shuffle() {
      var options = envIds.filter(function (id) { return id !== state.env; });
      state.env = options[Math.floor(Math.random() * options.length)];
      state.color = LD_SHIFT_ORDER[Math.floor(Math.random() * LD_SHIFT_ORDER.length)];
      visualDueAt = 0; colorDueAt = 0;
      syncUi(); saveState(); showToast(envInfo(state.env).name, LD_PALETTES[state.color].name);
    }
    function resetTouch() { touchGestures = Object.create(null); touchPointers = 0; touchHueTarget = 0; grav.held = false; }
    function handleClick(e) {
      var t = e.target.closest('button'); if (!t) return;
      wake();
      if (t.dataset.env) { if (state.color === 'signature' && t.dataset.env !== state.env) state.color = envInfo(state.env).palette; state.env = t.dataset.env; visualDueAt = 0; syncUi(); saveState(); return; }
      if (t.dataset.color) { state.color = t.dataset.color; colorDueAt = 0; syncUi(); saveState(); return; }
      if (t.dataset.play) { var pk = t.dataset.play; play[pk].on = !play[pk].on; if (pk === 'visual') visualDueAt = 0; else colorDueAt = 0; savePlay(); syncUi(); showToast(pk === 'visual' ? 'Visual Play All' : 'Colour Play All', play[pk].on ? 'On · every ' + secsLabel(play[pk].secs) : 'Off'); return; }
      if (t.dataset.playSecs) { var parts = t.dataset.playSecs.split(':'); play[parts[0]].secs = +parts[1]; play = normalizePlay(play); if (parts[0] === 'visual') visualDueAt = 0; else colorDueAt = 0; savePlay(); syncUi(); return; }
      if (t.dataset.load !== undefined) { var p = presets[+t.dataset.load]; if (p) { state = normalizeState(p.settings); visualDueAt = 0; colorDueAt = 0; syncUi(); saveState(); } return; }
      if (t.dataset.delete !== undefined) { presets.splice(+t.dataset.delete, 1); write('liquidDreams.presets', presets); presetList(); return; }
      switch (t.dataset.action) {
        case 'next': nextExperience(); visualDueAt = 0; break;
        case 'shift': colorShift(); colorDueAt = 0; break;
        case 'controls': if (panel.classList.contains('ld-hidden')) openPanel(); else closePanel(); break;
        case 'close': closePanel(); break;
        case 'exit': $('xpClose').click(); break;
        case 'shuffle': shuffle(); break;
        case 'clean': conceal(); break;
        case 'lowmotion': state.lowMotion = !state.lowMotion; syncUi(); saveState(); break;
        case 'touch': state.touch = !state.touch; if (!state.touch) resetTouch(); syncUi(); saveState(); break;
        case 'reset': state = normalizeState({ v: 3 }); syncUi(); saveState(); break;
        case 'save':
          var name = (ui.querySelector('[data-name]').value || '').trim();
          if (name) { presets.unshift({ name: name, settings: Object.assign({}, state) }); presets = presets.slice(0, 12); write('liquidDreams.presets', presets); ui.querySelector('[data-name]').value = ''; presetList(); }
          break;
      }
    }
    function handleChange(e) { var el = e.target; if (!el.dataset.setting) return; state[el.dataset.setting] = parseFloat(el.value); state = normalizeState(state); syncUi(); saveState(); }
    function handleInput(e) { var el = e.target; if (!el.dataset.setting || el.type !== 'range') return; state[el.dataset.setting] = parseFloat(el.value); syncUi(); }

    // TOUCH. Tap: a new random palette spreads from the exact point. Press and hold (or drag): Gravity Point follows the
    // finger, and on release springs back with an outward recovery. Two fingers: hue shift.
    var touchHueTarget = 0, touchHueShift = 0, touchPointers = 0, touchGestures = Object.create(null);
    var wave = null, grav = { x: .5, y: .5, held: false, s: 0, v: 0, spin: 0 };
    function pointerPoint(e) { var r = layer.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))), y: Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height))) }; }
    // Colour Wave: the new palette (any of the Liquid Dreams colours except the current one) becomes the
    // setting at once; the shader shows it spreading out from the finger over the previous colours.
    // A tap during a wave is held and starts as soon as that wave has covered the screen.
    function startWave(x, y) {
      if (wave) { wave.queued = { x: x, y: y }; return; }
      var cur = activePaletteKey(), options = LD_SHIFT_ORDER.filter(function (k) { return k !== cur; });
      var key = options[Math.floor(Math.random() * options.length)], target = LD_PALETTES[key], aspect = W / Math.max(1, H);
      var from = palette.map(function (c) { return c.slice(); }), fromS = spectralNow;
      state.color = key; colorDueAt = 0;
      for (var i = 0; i < 4; i++) palette[i] = target.c[i].slice();
      spectralNow = target.s;
      var X = (x - .5) * aspect, Y = .5 - y, far = Math.max(Math.hypot(aspect / 2 + Math.abs(X), .5 + Math.abs(Y)), .3);
      wave = { x: X, y: Y, r: 0, max: far + .2, from: from, fromS: fromS, key: key, queued: null };
      syncUi(); saveState(); showToast('COLOUR', target.name);
    }
    function startGravity(g) { g.grav = true; grav.held = true; grav.x = g.lastX; grav.y = g.lastY; }
    function touchDown(e) {
      if (!alive || ui.contains(e.target)) return;
      wake();
      if (clean) { clean = false; ui.classList.remove('ld-clean'); }
      if (!state.touch) return;
      e.preventDefault();
      var p = pointerPoint(e), id = e.pointerId, g = { x: p.x, y: p.y, lastX: p.x, lastY: p.y, multi: false, grav: false, timer: 0 };
      touchGestures[id] = g; touchPointers++;
      if (touchPointers >= 2) {
        Object.keys(touchGestures).forEach(function (k) { var o = touchGestures[k]; o.multi = true; clearTimeout(o.timer); });
        touchHueTarget = 1; grav.held = false;
      } else g.timer = setTimeout(function () { if (touchGestures[id] === g && !g.multi) startGravity(g); }, 170);
      try { layer.setPointerCapture(id); } catch (_e) {}
    }
    function touchMove(e) {
      var g = touchGestures[e.pointerId]; if (!g || !state.touch) return;
      e.preventDefault(); var p = pointerPoint(e);
      g.lastX = p.x; g.lastY = p.y;
      if (touchPointers > 1 || g.multi) { touchHueTarget = 1; return; }
      if (!g.grav && Math.hypot(p.x - g.x, p.y - g.y) > .02) { clearTimeout(g.timer); startGravity(g); }
      if (g.grav) { grav.x = p.x; grav.y = p.y; }
    }
    function touchEnd(e, cancelled) {
      var g = touchGestures[e.pointerId]; if (!g) return;
      clearTimeout(g.timer); delete touchGestures[e.pointerId]; touchPointers = Math.max(0, touchPointers - 1);
      if (g.multi) { touchHueTarget = touchPointers > 1 ? 1 : 0; return; }
      if (g.grav) { grav.held = false; return; }
      if (!cancelled) startWave(g.x, g.y);
    }
    function touchUp(e) { touchEnd(e, false); }
    function touchCancel(e) { touchEnd(e, true); }
    function pollLiquidTrack() {
      if (!alive || !trackLabel || !A || !A.nowPlaying) return;
      try {
        var np = JSON.parse(A.nowPlaying() || '{}'), title = np.playing && np.title && np.title !== 'null' ? String(np.title).trim() : '', artist = np.artist && np.artist !== 'null' ? String(np.artist).trim() : '';
        trackLabel.textContent = title ? (title + (artist ? ' — ' + artist : '')) : '';
      } catch (e) { trackLabel.textContent = ''; }
    }
    pollLiquidTrack(); trackTimer = setInterval(pollLiquidTrack, 1800); timers.push(trackTimer);
    ui.addEventListener('click', handleClick); ui.addEventListener('change', handleChange); ui.addEventListener('input', handleInput);
    layer.addEventListener('pointerdown', touchDown); layer.addEventListener('pointermove', touchMove); layer.addEventListener('pointerup', touchUp); layer.addEventListener('pointercancel', touchCancel);

    var ldGpu = null, ldGpuTried = false, ldGpuActive = false, oldGLX = GLX, firstFrame = false, frames = 0, ldWait = 0, ldForce = false;
    GLX = HIGH_MEMORY_DEVICE ? 1.1 : .72;
    XP.cleanupCurrent = function () {
      alive = false; ui.removeEventListener('click', handleClick); ui.removeEventListener('change', handleChange); ui.removeEventListener('input', handleInput);
      layer.removeEventListener('pointerdown', touchDown); layer.removeEventListener('pointermove', touchMove); layer.removeEventListener('pointerup', touchUp); layer.removeEventListener('pointercancel', touchCancel);
      Object.keys(touchGestures).forEach(function (k) { clearTimeout(touchGestures[k].timer); });
      resetTouch(); wave = null; touchHueShift = 0;
      clearTimeout(idleTimer); clearTimeout(toastTimer);
      if (trackTimer) clearInterval(trackTimer);
      if (glc) { glc.style.opacity = ''; glc.style.transition = ''; }
      layer.style.background = '';
      if (ldGpuActive) { glStop(); ldGpuActive = false; }
      GLX = oldGLX;
      delete XP.liquidDebug;
    };
    syncUi(); presetList(); saveState(); wake(); text('xpTop'); text('xpMid'); text('xpBottom');
    $('xpClose').style.display = 'none';

    // Live render state. Everything eases: no flashes, no hard cuts, no black frames.
    var envIndex = envIds.indexOf(state.env), envFrom = envIndex, envTo = envIndex, envMix = 0;
    var moodPalette = activePaletteKey(), beatHit = 0;
    var palette = LD_PALETTES[activePaletteKey()].c.map(function (c) { return c.slice(); }), spectralNow = LD_PALETTES[activePaletteKey()].s, colorPhase = Math.random();
    var sBass = 0, sMid = 0, sHigh = 0, sEnergy = 0, flow = 20 + Math.random() * 40, speedNow = state.speed, moveNow = state.movement;
    // A palette-coloured backdrop sits under the GPU canvas so the first frames are never black.
    function paintBackdrop() { layer.style.background = 'radial-gradient(ellipse at 40% 45%,' + css(palette[1].map(function (v) { return v * .6; })) + ' 0%,' + css(palette[0]) + ' 70%)'; }
    paintBackdrop();
    function ease(cur, target, dt, up, down) { return cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? up : down))); }
    function targetPalette() {
      moodPalette = activePaletteKey();
      return LD_PALETTES[moodPalette];
    }
    function ldUse(i) { return glUse('ld-env-' + i, ldEnvShader(i)); }
    function activateDreamShader() {
      if (!ldGpuTried) {
        ldGpuTried = true;
        if (glc) { glc.style.opacity = '0'; glc.style.transition = 'opacity .7s ease'; }
        ldGpu = glStart('ld-env-' + envTo, ldEnvShader(envTo)); ldGpuActive = !!ldGpu;
        if (glc) { glc.style.opacity = '0'; glc.style.transition = 'opacity .7s ease'; }
        // the other experiences compile in the background, one at a time, so later changes never stall
        if (ldGpu) LD_FNS.forEach(function (f, i) { if (i !== envTo) later(function () { if (alive) glPrepare('ld-env-' + i, ldEnvShader(i)); }, 700 + 500 * i); });
      } else if (ldGpu && !ldGpuActive) { ldGpu = glStart('ld-env-' + envTo, ldEnvShader(envTo)); ldGpuActive = !!ldGpu; }
      return ldGpu;
    }
    function drawFallback(t, bassL, highL, bright) {
      // Canvas fallback for devices without WebGL: layered soft forms in the active palette.
      var u = Math.min(W, H), p = palette, env = envTo;
      cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
      var bg = cx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, css(p[1].map(function (v) { return v * .35 * bright; }))); bg.addColorStop(1, css(p[0])); cx.fillStyle = bg; cx.fillRect(0, 0, W, H);
      cx.globalCompositeOperation = 'screen';
      var count = 4 + Math.round(state.complexity);
      for (var i = 0; i < count; i++) {
        var a = t * (.05 + i * .011) + i * 1.9 + env, x = W * (.5 + .34 * Math.sin(a)), y = H * (.5 + .28 * Math.cos(a * 1.3 + i)), r = u * (.22 + .07 * Math.sin(i * 2.3 + t * .1) + bassL * .03 * moveNow);
        var g = cx.createRadialGradient(x - r * .25, y - r * .3, 1, x, y, r);
        var c = p[1 + i % 3].map(function (v) { return v * bright; });
        g.addColorStop(0, 'rgba(' + css(c).slice(4, -1) + ',' + (.32 + highL * .1) + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
        cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r, 0, TAU); cx.fill();
      }
      cx.globalCompositeOperation = 'source-over';
    }
    var TAU = Math.PI * 2, lastLevels = [0, 0, 0, 0];
    XP.liquidDebug = function () {
      return { env: state.env, color: state.color, palette: activePaletteKey(), envFrom: envIds[envFrom], envTo: envIds[envTo], envMix: envMix, spectral: spectralNow,
        gravity: { held: grav.held, strength: grav.s, x: grav.x, y: grav.y, spin: grav.spin }, wave: wave ? { x: wave.x, y: wave.y, r: wave.r, max: wave.max, palette: wave.key, queued: !!wave.queued } : null,
        frames: frames, firstFrame: firstFrame, canvasOpacity: glc ? glc.style.opacity : null, gpu: ldGpuActive, panelOpen: !panel.classList.contains('ld-hidden'),
        audio: { bass: sBass, mid: sMid, high: sHigh, energy: sEnergy, beat: beatHit, kick: kickL, hat: hatL, tempo: tempoK, kicks: kickSeen, hats: hatSeen, sixBand: !!NM }, react: { bass: lastLevels[0], mid: lastLevels[1], high: lastLevels[2], energy: lastLevels[3] },
        play: { visual: { on: play.visual.on, secs: play.visual.secs, dueIn: visualDueAt ? visualDueAt - performance.now() : null }, color: { on: play.color.on, secs: play.color.secs, dueIn: colorDueAt ? colorDueAt - performance.now() : null } } };
    };
    function draw(now) {
      if (!alive || !XP.active || XP.current !== 'liquiddreams') return;
      var dt = Math.min(80, Math.max(0, now - lastT)); lastT = now;
      var sec = dt / 1000;
      var low = state.lowMotion, live, M6 = null;
      if (NM) { M6 = NM.musicTick(now, dt || 16); live = M6.live; } else { b.tick(now); live = b.live; }
      // Bass drives the large forms, midrange the flow, treble the fine highlights, and the overall
      // beat energy the movement and colour flow. Each band is smoothed so the response is fluid.
      // Bass and overall energy are driven mainly off absolute (not peak-relative) levels, so a
      // genuinely quiet, unvarying passage reads as calm instead of drifting louder over time.
      if (M6) {
        // Bands arrive already scaled to the music's own range (0-1), so the same song reacts the same at any volume.
        sBass = ease(sBass, live ? Math.max(M6.sub * .6 + M6.bass * .4, M6.kick * .85) : 0, dt, 70, 520);
        sMid = ease(sMid, live ? M6.lowmid * .4 + M6.mid * .6 : 0, dt, 160, 800);
        sHigh = ease(sHigh, live ? Math.max(M6.high * .6 + M6.air * .4, M6.hat * .7) : 0, dt, 60, 340);
        sEnergy = ease(sEnergy, live ? Math.min(1.2, M6.energy * 1.15) : 0, dt, 250, 1400);
        if (live && M6.kickHit) { beatHit = Math.min(1, beatHit + .55 + M6.strength * .45); kickSeen++; }
        if (live && M6.hatHit) hatSeen++;
        // strong kicks in busy passages step the colours along the palette's own flow (never off-palette)
        if (live && M6.kickHit && M6.strength > .8 && M6.energy > .45) colorPhase += .012 * state.colorSpeed * (low ? .4 : 1);
        if (M6.drop) { beatHit = 1; colorPhase += .05 * state.colorSpeed; }
        kickL = live ? M6.kick : kickL * Math.exp(-dt / 200);
        hatL = live ? M6.hat : hatL * Math.exp(-dt / 120);
        // fast songs flow faster, slow songs flow smoother (gently: 0.8x to 1.25x)
        tempoK = ease(tempoK, live && M6.bpm ? Math.max(.8, Math.min(1.25, Math.sqrt(M6.bpm / 120))) : 1, dt, 1800, 1800);
      } else {
        sBass = ease(sBass, live ? Math.min(1.2, Math.max(b.bass, b.k * .8)) : 0, dt, 110, 600);
        sMid = ease(sMid, live ? Math.min(1.2, b.mid) : 0, dt, 220, 900);
        sHigh = ease(sHigh, live ? Math.min(1.2, b.high) : 0, dt, 70, 380);
        sEnergy = ease(sEnergy, live ? Math.min(1.2, b.level) : 0, dt, 250, 1400);
        if (live && b.hit) beatHit = Math.min(1, beatHit + .55 + Math.min(1, b.k) * .45);
        kickL = beatHit; hatL = 0;
      }
      // Music reactivity is always on: sensitivity can be tuned but never switched off, in every experience and palette.
      beatHit *= Math.exp(-dt / 260);
      var react = Math.max(LD_RANGES.audio[0], state.audio) * (low ? .35 : 1);
      var bassL = Math.min(1, (sBass + beatHit * .35) * react * state.bass * 1.6), midL = Math.min(1, sMid * react * 1.5), highL = Math.min(1, sHigh * react * 1.6), energyL = Math.min(1, (sEnergy + beatHit * .2) * react * 1.3);
      lastLevels = [bassL, midL, highL, energyL];
      speedNow = ease(speedNow, state.speed * (low ? .4 : 1), dt, 600, 600);
      moveNow = ease(moveNow, state.movement * (low ? .45 : 1), dt, 600, 600);
      flow += sec * speedNow * (1 + midL * .5 + energyL * .4) * tempoK;
      // Experience changes dissolve through a liquid noise front; both experiences render during it, so no frame is black.
      var wanted = envIds.indexOf(state.env);
      if (wanted !== envTo) { if (envFrom !== envTo && envMix > .5) envFrom = envTo; envTo = wanted; envMix = 0; }
      if (envFrom !== envTo) { envMix += dt / (low ? 4200 : 2600); if (envMix >= 1) { envFrom = envTo; envMix = 0; } }
      runPlayAll(now);
      var target = targetPalette(), k = 1 - Math.exp(-dt / (2400 / state.colorSpeed * (low ? 1.6 : 1)));
      for (var pi = 0; pi < 4; pi++) for (var ci = 0; ci < 3; ci++) palette[pi][ci] += (target.c[pi][ci] - palette[pi][ci]) * k;
      spectralNow += (target.s - spectralNow) * k;
      colorPhase += sec * (.012 + energyL * .06 + midL * .03) * state.colorSpeed * (low ? .4 : 1);
      touchHueShift = ease(touchHueShift, touchHueTarget, dt, 900, 1400);
      // Gravity Point: a damped spring. Held, it pulls in hard; released, it overshoots outward and settles.
      var gTarget = grav.held ? 1 : 0, K = grav.held ? 42 : 16, D = grav.held ? 10 : 3.6;
      grav.v += ((gTarget - grav.s) * K - grav.v * D) * sec; grav.s += grav.v * sec;
      grav.s = Math.max(-.45, Math.min(1.15, grav.s));
      grav.spin += sec * 1.4 * Math.max(grav.s, 0);
      if (!grav.held && Math.abs(grav.s) < .002 && Math.abs(grav.v) < .004) { grav.s = 0; grav.v = 0; grav.spin = 0; }
      // the wave front travels at an even pace (about 1.5 s across the screen), then the new colours simply stay
      if (wave) { wave.r += sec * (low ? .75 : 1.15); if (wave.r > wave.max) { var q = wave.queued; wave = null; if (q) startWave(q.x, q.y); } }
      var complexity = state.complexity * .5, detail = state.detail * .6;
      if (!HIGH_MEMORY_DEVICE) { complexity = Math.min(.7, complexity); detail = Math.min(.9, detail); }
      var dream = activateDreamShader();
      if (dream) {
        var mixEased = envMix * envMix * (3 - 2 * envMix), aspect = W / H, changing = envFrom !== envTo;
        // wait for the incoming experience's program before starting its dissolve (no stall mid-change)
        if (changing && !glReady('ld-env-' + envTo) && envMix < .02 && !ldForce) { envMix = 0; mixEased = 0; ldWait += dt; if (ldWait > 2500) ldForce = true; }
        var passes = changing && mixEased > 0 ? [envFrom, envTo] : [changing ? envFrom : envTo];
        for (var pass = 0; pass < passes.length; pass++) {
          dream = ldUse(passes[pass]); if (!dream) break;
          if (pass === 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
          dream.f('envA', passes[pass]); dream.f('envB', passes[pass]); dream.f('envMix', pass === 1 ? mixEased : 0);
          dream.f('flowT', flow); dream.f('bassL', bassL); dream.f('midL', midL); dream.f('highL', highL); dream.f('energyL', energyL);
          dream.f('kickL', Math.min(1, kickL * react * state.bass)); dream.f('hatL', Math.min(1, hatL * react));
          dream.f('moveAmt', moveNow * .6 * (1 + energyL * .35 + beatHit * .25 * (low ? .4 : 1))); dream.f('detailAmt', detail); dream.f('complexity', complexity);
          dream.f('brightness', state.brightness); dream.f('quality', HIGH_MEMORY_DEVICE ? 1 : 0);
          var old = wave ? wave.from : palette;
          dream.v3('palN0', palette[0]); dream.v3('palN1', palette[1]); dream.v3('palN2', palette[2]); dream.v3('palN3', palette[3]);
          dream.v3('palO0', old[0]); dream.v3('palO1', old[1]); dream.v3('palO2', old[2]); dream.v3('palO3', old[3]);
          dream.f('spectral', spectralNow); dream.f('spectralO', wave ? wave.fromS : spectralNow);
          dream.v4a('colorWave', wave ? [wave.x, wave.y, wave.r, 1] : [0, 0, 0, 0]); dream.f('colorPhase', colorPhase); dream.f('touchHue', touchHueShift);
          dream.v2('gravPos', (grav.x - .5) * aspect, .5 - grav.y); dream.f('gravStr', grav.s); dream.f('gravSpin', grav.spin);
          dream.draw(now, null, 0);
          if (pass === 1) gl.disable(gl.BLEND);
        }
        if (!changing) { ldWait = 0; ldForce = false; }
        frames++;
        if (!firstFrame) { firstFrame = true; requestAnimationFrame(function () { if (glc && alive) glc.style.opacity = '1'; }); }
      } else drawFallback(flow, bassL, highL, state.brightness);
      if (frames % 30 === 1) paintBackdrop();
    }
    loop(draw, 30);
  }

  // ==================================================================
  // NIGHT DRIVE — a continuous journey along a neon highway through
  // alien worlds. The camera, the road, the controls and the audio are
  // shared; a world supplies only its sky, its horizon haze and the
  // ground either side of the road, so another world is a new ND_WORLDS
  // entry rather than another experience.
  // ==================================================================
  var ND_HEAD = `
uniform float travel, night, react, mids, highs, q, fadeIn;
// music, split so each kind of element answers its own part of the sound:
//   bass  — sustained sub and bass (big elements)      mids  — body of the music (lighting, plants, ribbons)
//   highs — hats and air (stars, small lights, dust)    kick / snare / hat — short envelopes on each hit
//   pulseT / pulseS — seconds since, and strength of, the last four kicks: each one becomes a pulse of
//   light that travels away down the road or outward through the rings
//   burst — seconds since the last snare (particle bursts)   drift — particle travel, faster on the beat
uniform float bass, snare, hat, burst, drift;
uniform vec4 pulseT, pulseS;
uniform vec4 mA0, mB0, mA1, mB1, mA2, mB2;   // up to three shooting stars in flight
uniform vec3 cA, cB, cC, cD;
float fbm(vec2 p, float oct){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6);
 for(int i=0;i<5;i++){ if(float(i)>=oct) break; v+=a*noise(p); p=m*p+vec2(3.1,1.7); a*=.5; } return v; }
// The road winds and rolls as smooth functions of distance driven, so its shape keeps
// changing for the whole journey instead of looping back on a short cycle.
float curveAt(float z){ return 16.*sin(z*.0021) + 9.*sin(z*.00085+1.7) + 5.*sin(z*.0047+4.1); }
float hillAt(float z){ return 7.*sin(z*.0013+2.2) + 3.5*sin(z*.0031+.6); }
// One beat pulse: a band of light leaving the camera when the kick lands and racing away down the road.
float ndPk(float age, float s, float zd, float v){
 if(age > 3.) return 0.;
 float zp = 3. + age*v, w = 4. + zp*.22;
 float x = (zd - zp)/w;
 return s * exp(-x*x) * exp(-age*.9);
}
// the four most recent kicks travelling down the road at once (zd = distance ahead)
float ndPulse(float zd, float v){
 return react*(ndPk(pulseT.x, pulseS.x, zd, v) + ndPk(pulseT.y, pulseS.y, zd, v) + ndPk(pulseT.z, pulseS.z, zd, v) + ndPk(pulseT.w, pulseS.w, zd, v));
}
// The night sky's stars, in three classes: dense faint dust, ordinary field stars and rare bright stars,
// each with its own colour temperature. p is a sky position in radians-like units. Stars twinkle on
// their own clocks; with music, only some field and bright stars catch the hats, each on its own threshold.
vec3 ndStarField(vec2 p, float t, float dens){
 // dust: a dense veil of faint pinpoints
 vec2 g = p*118.;
 vec2 id = floor(g), f = fract(g) - .5;
 float h = hash(id);
 float thr = .62 - dens*.30;
 vec3 o = vec3(0.);
 if(h > thr) o += mix(vec3(.78,.86,1.), vec3(1.,.93,.85), step(.5, fract(h*53.3))) * exp(-dot(f,f)*900.) * (.16 + .34*(h-thr)/(1.-thr)) * (.75 + .25*sin(t*(1.3+h*2.) + h*60.));
 // field and bright stars on one coarser grid: the hash picks the class, the colour temperature and the clock
 g = p*38. + 31.7; id = floor(g); f = fract(g) - .5;
 h = hash(id);
 thr = .80 - dens*.06;
 if(h > thr){
  float h2 = fract(h*91.7), mag = (h - thr)/(1. - thr);
  f -= (vec2(h2, fract(h*37.1)) - .5)*.62;
  float r2 = dot(f, f), tc = fract(h*53.3);
  vec3 c = tc < .5 ? vec3(.76,.85,1.) : (tc < .8 ? vec3(1.,.97,.92) : (tc < .93 ? vec3(1.,.84,.60) : vec3(1.,.64,.46)));
  float tw = .72 + .28*sin(t*(1.1 + h2*3.1) + h*70.);
  float sparkle = (hat*1.3*step(.62, h2) + highs*.45*step(.8, fract(h2*7.)))*react;
  float big = step(.82, mag);
  float k = mix(700., 170., big);
  float spk = (exp(-abs(f.x)*30. - f.y*f.y*2200.) + exp(-abs(f.y)*30. - f.x*f.x*2200.))*big*.3*mag;
  o += c*(exp(-r2*k)*(.5 + 1.9*mag) + exp(-r2*14.)*.05*big + spk)*(tw + sparkle);
 }
 return o;
}
// One shooting star. The app launches them at random moments, each with its own start, direction,
// length, speed and brightness (a = start x, start y, angle, progress 0..1; b = length, distance
// travelled, brightness, warmth), so no two look alike and they never keep time with each other.
vec3 ndMeteor(vec2 p, vec4 a, vec4 b){
 if(a.w <= 0. || a.w >= 1.) return vec3(0.);
 vec2 dir = vec2(cos(a.z), sin(a.z));
 vec2 rel = p - (a.xy + dir*a.w*b.y);
 float al = dot(rel, -dir);
 if(al < -.02 || al > b.x) return vec3(0.);
 float d = dot(rel, vec2(-dir.y, dir.x));
 float w = .0016 + max(al, 0.)*.006;
 float tail = pow(1. - clamp(al/b.x, 0., 1.), 2.2);
 vec3 c = mix(vec3(.82,.92,1.), vec3(1.,.86,.7), b.w);
 return c*(exp(-d*d/(w*w))*tail + exp(-dot(rel,rel)*26000.)*1.6)*sin(a.w*3.14159)*b.z*(1. + highs*react*.35);
}
vec3 ndMeteors(vec2 p){ return ndMeteor(p, mA0, mB0) + ndMeteor(p, mA1, mB1) + ndMeteor(p, mA2, mB2); }
`;

  // Every world implements these three, and nothing else.
  //   ndSky   — everything above the road: sky, celestial bodies, horizon silhouettes
  //   ndHaze  — the cheap colour the road fades into at the horizon
  //   ndGround— the terrain either side of the asphalt
  //   ndRoadFx— light the world adds on top of the asphalt (return the road unchanged for none)
  //   optional: #define ND_OVERLAY and ndOverlay(col, rd, uv, t) for standing objects drawn last
  var ND_MAIN = `
void main(){
 vec2 uv = (gl_FragCoord.xy - .5*res)/res.y;
 float t = time, tr = travel;
 vec3 ro = vec3(0.);
 vec3 rd = normalize(vec3(uv.x*1.12, uv.y*1.12 + .085, -1.));
 // how much of this pixel is ground; the sky is only drawn where some of it can be seen
 float groundMix = 1. - smoothstep(-.02, -.0015, rd.y);
 vec3 col = groundMix < 1. ? ndSky(rd, t) : vec3(0.);
 float camH = 2.35;
 if(rd.y < -.0015){
  // Hills are measured relative to the road under the camera, so the camera always rides the
  // same height above the asphalt: the highway keeps one size and never swallows the view.
  float h0 = hillAt(tr);
  float zf = camH/(-rd.y);
  float tg = max(camH + (hillAt(tr + zf) - h0)*.26, camH*.45)/(-rd.y);
  vec3 g = ro + rd*tg;
  float zd = -g.z, wz = tr + zd, fade = exp(-zd*.0042);
  float xr = g.x - curveAt(wz)*min(1., zd*.0026);
  float edge = abs(xr), HALF = 11.0;
  // the terrain is only drawn where the road does not fully cover it
  float roadMix = 1. - smoothstep(HALF+.2, HALF+1.6, edge);
  vec3 ground = roadMix < 1. ? ndGround(xr, wz, fade) : vec3(0.);
  if(edge < HALF+1.6){
   float grain = noise(vec2(xr*2.4, wz*2.4))*.5 + noise(vec2(xr*9., wz*9.))*.25;
   vec3 road = vec3(.034,.035,.052) + grain*.022;
   // wet sheen: the sky smeared down the asphalt
   float wet = (1.-smoothstep(.1,1.05,edge/HALF));
   road += mix(cB, cC, .45) * .042 * wet * (1.-night*.45);
   road += mix(cB, vec3(1.), .25) * .038 * exp(-abs(xr+3.)*.10) * smoothstep(.0,.25,fade) * (1.-night*.3);
   road += mix(cA, cB, .5) * .028 * (.5+.5*sin(wz*.02)) * wet * fade;
   // lines widen gently with distance so far edges stay clean instead of shimmering
   float aa = zd*.0045;
   // dashed lane markings
   float dash = smoothstep(.40, .44, fract(wz*.085)) * (1.-smoothstep(.96, 1., fract(wz*.085)));
   float lane1 = (1.-smoothstep(.0,.34+aa,abs(edge-3.7))) * dash;
   float lane2 = (1.-smoothstep(.0,.30+aa,abs(edge-7.4))) * dash;
   road += vec3(.85,.88,.98)*(lane1*.55+lane2*.45)*fade;
   // neon shoulders: the colour leans toward the second palette colour with the music, light
   // pulses race along the edges with the beat, and the glow swells with the energy
   // the mids warm the neon's colour and level; each kick sends a band of light racing away
   // down both shoulders (travelling, never the whole edge at once); a faint idle chase runs without music
   float midL = react*clamp(mids, 0., 1.);
   vec3 neon = mix(cA, cC, clamp(midL*.75, 0., .7));
   neon = mix(neon, cD, .22*(.5+.5*sin(wz*.003 + t*.15)));
   float run = pow(.5+.5*sin(wz*.055 - t*2.2), 8.) * .12 + ndPulse(zd, 130.)*1.5;
   float sL = (1.-smoothstep(.0,.62+aa,abs(edge-HALF)));
   float core = (1.-smoothstep(.0,.22+aa*.5,abs(edge-HALF)));
   road += neon*sL*(1.55 + midL*.45 + run*2.2);
   road += mix(neon, vec3(1.), .55)*core*(.7 + midL*.3 + run);
   road += mix(neon, cB, .5)*exp(-abs(edge-HALF)*1.1)*.5*(1. + midL*.6 + run*.8);
   road += mix(cB, neon, .4)*exp(-abs(edge-HALF)*.38)*.11*(1.-smoothstep(0.,HALF,edge))*(1. + midL*.5 + run*.4);
   road += mix(neon, cD, .5)*exp(-abs(edge-HALF)*.9)*.16*(1.-fade)*(.8 + bass*react*.6);
   // wet asphalt: glossy patches mirror the world's own horizon (strongest at a grazing angle,
   // far down the road), the neon shoulders reflect as soft streaks, and the lane paint glows
   float gloss = .55 + .45*smoothstep(.3, .75, noise(vec2(xr*.22, wz*.035)));
   float fres = pow(1. - clamp(-rd.y*5.5, 0., 1.), 3.);
   vec3 mirror = ndHaze(vec3(rd.x, -rd.y, rd.z), t);
   road += mirror * fres * gloss * .30 * (1. - .35*night);
   road += neon * exp(-abs(edge - (HALF - 1.6))*.75) * (.05 + .10*fres) * gloss * (1. + run*.9);
   road += vec3(.85,.88,.98) * (lane1*.55 + lane2*.45) * .25 * fres * gloss;
   road += vec3(.75,.82,1.) * (1.-smoothstep(.0, .9+aa*2., abs(edge-3.7)))*dash * .05 * fade;
   road = ndRoadFx(road, xr, wz, edge, fade);
   ground = mix(ground, road, roadMix);
  }
  ground = mix(ndHaze(rd, t), ground, fade);
  col = mix(col, ground, groundMix);
 }
 #ifdef ND_OVERLAY
 // worlds with things standing up off the ground (trees, plants) draw them over sky and terrain here
 col = ndOverlay(col, rd, uv, t);
 #endif
 float lum = dot(col, vec3(.299,.587,.114));
 col = max(mix(vec3(lum), col, 1.14), 0.);
 col = col*(2.51*col+.03)/(col*(2.43*col+.59)+.14);
 col = pow(clamp(col,0.,1.), vec3(.95));
 col *= .80 + .20*(1.-smoothstep(.3,1.45, length(uv*vec2(.78,1.))));
 // the world rises out of black when it starts or changes, instead of cutting in
 col *= fadeIn;
 col += (hash(gl_FragCoord.xy + fract(t*11.))-.5)/255.*2.;
 gl_FragColor = vec4(clamp(col,0.,1.), 1.);
}
`;

  // ---- World 1: CELESTIAL RINGS ----
  var ND_CELESTIAL_RINGS = `
const vec3 PC = vec3(-430., 300., -1150.);   // planet centre, held in camera space so it
const float PR = 300.;                       // stays a landmark for the whole journey
const vec3 GREEN = vec3(.16, 1., .46);       // the roadside lights' signature colour
const vec3 M1C = vec3(395., 262., -1240.);   // an icy moon to the right of the giant
const float M1R = 30.;
const vec3 M2C = vec3(-95., 128., -880.);    // a small dark moon riding in front of the rings
const float M2R = 11.;
vec2 rgSky(vec3 rd){ return vec2(atan(rd.x, -rd.z), rd.y/max(length(rd.xz), 1e-4)); }
// Deep sky: a broad emission nebula with dark dust lanes, bright knots and fine filaments.
// It drifts very slowly and never pulses: the sky stays a sky, not a light show.
vec3 ndNebula(vec3 rd, float t){
 vec2 p = vec2(atan(rd.x,-rd.z)*1.25, rd.y*1.9);
 vec2 w = vec2(fbm(p*1.3+vec2(t*.006,0.),2.), fbm(p*1.3+vec2(4.2,-t*.005),2.))-.5;
 float n = fbm(p*1.7+w*1.9+vec2(t*.003,t*.002), 3.+q);
 float m = smoothstep(.30,.84,n);
 float zone = fbm(p*.42+vec2(t*.002,1.7), 2.);
 vec3 c = mix(cC, cB, smoothstep(.30,.72,zone));
 c = mix(c, cD, smoothstep(.62,.95,zone)*.6);
 c = mix(c, mix(c, vec3(1.), .6), smoothstep(.68,.97,n)*.4);
 // filaments: thin bright ridges where the warped noise crosses its middle value
 float fil = pow(1. - abs(noise(p*6.5 + w*4.) - .5)*2., 7.) * m;
 // dust: dark lanes cutting through the bright gas
 float dust = smoothstep(.55, .78, noise(p*3.1 - w*2.3 + 11.)) * smoothstep(.2, .6, n);
 vec3 o = c*m*.34 + mix(c,cB,.4)*smoothstep(.18,.7,n)*.07 + mix(c, vec3(1.,.9,1.), .4)*fil*.16;
 return o * (1. - dust*.75) * (1.-night*.30);
}
// How much of the main rings lies at radius r (in planet radii): three rings, two clear gaps.
float ringMask(float r){
 float a = smoothstep(1.18,1.27,r)*(1.-smoothstep(1.60,1.66,r));
 float b = smoothstep(1.70,1.76,r)*(1.-smoothstep(2.28,2.35,r));
 float c = smoothstep(2.42,2.47,r)*(1.-smoothstep(2.70,2.86,r));
 return a*.45 + b + c*.35;
}
// One ring ripple: when a kick lands a bright wave leaves the planet and rolls out through the rings.
float rgRip(float age, float s, float r){
 if(age > 2.6) return 0.;
 float x = (r - (1.18 + age*.85))*10.;
 return s*exp(-x*x)*exp(-age*1.1);
}
float rgRipples(float r){
 return react*(rgRip(pulseT.x, pulseS.x, r) + rgRip(pulseT.y, pulseS.y, r) + rgRip(pulseT.z, pulseS.z, r) + rgRip(pulseT.w, pulseS.w, r));
}
// The giant: analytic sphere, banded clouds, terminator, lit limb and the rings' shadow.
vec4 ndPlanet(vec3 ro, vec3 rd, vec3 L, vec3 rn, float t, out float tHit){
 tHit = 1e9;
 vec3 oc = ro - PC;
 float b = dot(oc, rd), c = dot(oc,oc) - PR*PR, d = b*b - c;
 if(d < 0.) return vec4(0.);
 float tt = -b - sqrt(d);
 if(tt < 0.) return vec4(0.);
 tHit = tt;
 vec3 pos = ro + rd*tt, n = (pos - PC)/PR;
 float lat = n.y;
 vec2 uvp = vec2(atan(n.z, n.x)*1.1 + t*.004, lat*2.6);
 float bands = fbm(vec2(uvp.x*.8, uvp.y*2.4), 3.+q);
 float swirl = fbm(uvp*2.2 + bands*1.4, 3.);
 // fine cloud streaks sheared along the belts give the bands a real texture close up
 float streak = noise(vec2(uvp.x*7. + swirl*3., lat*38. + bands*6.));
 float band = smoothstep(.22,.86, .5 + .5*sin(lat*11.0 + bands*5.0 + swirl*1.9 + (streak-.5)*.8));
 float polar = 1.-pow(abs(lat),2.6);
 vec3 deep = mix(vec3(.006,.006,.030), vec3(.030,.016,.082), band);
 vec3 cloud = mix(mix(cB*.42, cC*.55, band*.5), vec3(.52,.34,.95), band*.7);
 cloud *= .86 + .28*streak;
 vec3 lit = mix(deep, cloud, (.22+band*.52)*polar);
 float lam = max(dot(n, L), 0.), term = pow(lam, .7);
 float dl = dot(L, rn);
 float rs = 0.;
 if(abs(dl) > 1e-3){ float k = dot(PC - pos, rn)/dl; if(k > 0.) rs = ringMask(length(pos + L*k - PC)/PR); }
 term *= 1. - rs*.5;
 // limb darkening: the edge of the disc dims as the light passes through more atmosphere
 float mu = max(dot(n,-rd), 0.);
 vec3 col = lit * (.04 + 1.25*term) * (.55 + .45*sqrt(mu));
 // the bright cloud tops glow up with the bass (the giant breathes with the low end)
 col += mix(cA, vec3(1.), .25) * pow(smoothstep(.58,.93,swirl),2.5) * (.04+term*.85) * (.6 + bass*react*.55) * polar;
 col += mix(cC, vec3(1.,.8,1.), .3) * pow(smoothstep(.55,.92,band*swirl+.12),3.) * term * .45;
 float storm = smoothstep(.78, .95, noise(vec2(uvp.x*3.2, uvp.y*7.)));
 col += mix(cC, vec3(1.,.85,.95), .4) * storm * band * polar * (.05 + term*.35);
 float ndl = dot(n, L);
 col += mix(cC, vec3(1.,.66,.62), .4) * exp(-abs(ndl - .02)*5.5) * polar * band * .10;
 // lightning flickering inside the night side's clouds on the snare (a new place each time)
 float flash = floor(time*2.5);
 float bolt = smoothstep(.72, .95, noise(uvp*vec2(4., 8.) + vec2(hash(vec2(flash, 1.))*40., hash(vec2(flash, 2.))*40.))) * smoothstep(.05, .3, -ndl);
 col += vec3(.62,.68,1.) * bolt * (.3 + swirl) * snare * react * .45;
 float fres = pow(1.-mu, 3.2);
 col += mix(cB, vec3(.88,.93,1.), .45) * fres * (.22 + term*2.1);
 col += cB * pow(1.-mu, 7.) * .35;
 return vec4(col, 1.);
}
// A small moon: cratered, lit by the same star, with a thin bright crescent.
vec4 rgMoon(vec3 rd, vec3 C, float R, vec3 L, vec3 tint, float seed, out float tHit, out float miss){
 tHit = 1e9;
 float b = dot(C, rd);
 miss = sqrt(max(dot(C,C) - b*b, 0.))/R;
 if(miss > 1. || b < 0.) return vec4(0.);
 float tt = b - sqrt(R*R*(1. - miss*miss));
 tHit = tt;
 vec3 n = (rd*tt - C)/R;
 vec2 uv = vec2(atan(n.z, n.x), n.y)*2.4 + seed;
 float mare = fbm(uv*1.3, 3.);
 float crater = smoothstep(.62, .8, noise(uv*5.)) - smoothstep(.8, .9, noise(uv*5.))*.6;
 float alb = .55 + .35*mare + crater*.18;
 float lam = max(dot(n, L), 0.);
 vec3 col = tint*alb*(.015 + 1.15*pow(lam, .8));
 col += tint*pow(1. - max(dot(n,-rd),0.), 4.)*lam*.6;
 return vec4(col, 1. - smoothstep(.985, 1., miss));
}
// The rings: three broad rings full of fine ringlets, sharp bright edges and dark gaps, shaded
// across their width, turning slowly, lit by the same star and shadowed by the planet.
// Music: the bass swells the main B ring's density glow, each kick sends a ripple rolling outward,
// the mids shift the hue of the ripples and the highs make the finest ringlets glitter.
vec4 ndRings(vec3 ro, vec3 rd, vec3 rn, vec3 L, float t, out float tRing, out vec3 glow){
 tRing = 1e9; glow = vec3(0.);
 float den = dot(rd, rn);
 if(abs(den) < 1e-4) return vec4(0.);
 float tt = dot(PC - ro, rn)/den;
 if(tt < 0.) return vec4(0.);
 tRing = tt;
 vec3 pos = ro + rd*tt;
 vec3 rel = pos - PC;
 float r = length(rel)/PR;
 glow = mix(cA, cB, smoothstep(1.4, 2.6, r)) * exp(-pow((r-1.95)/.95, 2.)) * .07;
 if(r < 1.16 || r > 2.9) return vec4(0.);
 vec3 ax = normalize(cross(rn, vec3(0.,0.,1.))), ay = cross(rn, ax);
 float ang = atan(dot(rel, ay), dot(rel, ax));
 float mask = ringMask(r);
 float band = fbm(vec2(r*4.6, 1.3), 2.+q);
 float ringlets = .5+.5*sin(r*92. + band*6.);
 float fineR = .5+.5*sin(r*233. + band*3.);
 // the finest grooves: hundreds of ringlets, softened with distance so they never shimmer
 float hair = .5+.5*sin(r*610. + band*9.);
 float clumps = .82 + .18*sin(ang*5. - t*.05 + r*9.) * sin(ang*2. + t*.03);
 // spokes: faint radial smudges drifting round with the ring, as seen on real gas giants
 float spokes = 1. - .16*smoothstep(.3, 1., sin(ang*7. - t*.04 + sin(ang*3. + r*4.)*1.5))*smoothstep(1.75,1.9,r)*(1.-smoothstep(2.15,2.3,r));
 float zones = .45 + .55*smoothstep(.25, .70, band);
 float dens = mask * zones * (.70 + .15*ringlets + .08*fineR + .07*hair) * clumps * spokes;
 float lines = exp(-pow((r-1.755)*110.,2.)) + exp(-pow((r-2.30)*95.,2.))*.8 + exp(-pow((r-2.455)*150.,2.))*.6
             + exp(-pow((r-1.26)*120.,2.))*.4;
 float along = dot(-rel, L);
 float distAx = length(-rel - L*along);
 float shadow = (along > 0. && distAx < PR) ? 1.-smoothstep(PR*.72, PR, distAx) : 0.;
 float litFace = step(0., dot(rn, L)*dot(rn, -rd));
 float light = mix(.55, 1.15, litFace) * (1. - shadow*.85);
 vec3 col = mix(mix(cB, cA, smoothstep(1.2, 1.85, r)), mix(cC, vec3(1., .78, .62), .25), smoothstep(1.95, 2.8, r));
 col = mix(col, vec3(.95,.95,1.), .18*ringlets*smoothstep(1.7,1.9,r)*(1.-smoothstep(2.2,2.35,r)));
 col = mix(col, cD, .18*(.5+.5*sin(r*6.+t*.07)));
 vec3 o = col * (.45 + dens*1.9) * light;
 o += mix(col, vec3(1.), .55) * lines * (1. - shadow*.7);
 // bass: the dense B ring glows up from inside, strongest in its brightest zones
 float bRing = smoothstep(1.70,1.80,r)*(1.-smoothstep(2.22,2.33,r));
 o += mix(col, vec3(1.), .3) * bass*react * bRing * zones * dens * .55;
 // kicks: ripples of light rolling outward
 float wave = rgRipples(r);
 o += mix(cA, cC, .35 + mids*react*.4) * wave * (.55 + dens*1.2) * mask;
 // highs: the finest ringlets glitter
 o += mix(col, vec3(1.), .6) * highs*react * pow(fineR, 6.) * mask * .45;
 float alpha = clamp(dens*1.35 + lines*.6 + wave*.25*mask, 0., .97);
 return vec4(o, alpha);
}
// Roadside lights: two rows of green lights down both sides. Each kick sends a pulse of light racing
// away down the rows; the mids raise their level; the hats make a scattered few sparkle; the bass
// swells the big outer row. Without music they glow steadily with a slow idle shimmer.
vec3 ndLamp(float ax, float side, float wz, float zd, float t, float fr, float X, float sp, float cz, float pulse){
 float zc = max(zd + (cz*sp - wz), .5);
 float d = length(vec2(ax/zd - X/zc, 2.35/zc - 2.35/zd));
 float rad = (.0032 + .16/zc)*(1. + fr*.35);
 float h = hash(vec2(cz*1.7 + side*13. + fr*31., 4.2));
 float swell = .5+.5*sin(cz*.21 - t*.6 + h*6.28);
 float tw = .82 + .18*sin(t*(1.6+h*3.) + h*40.);
 float b = (.55 + .25*swell + mids*react*.55 + pulse*1.6*(.7+.3*h)
           + hat*react*1.6*step(.78, h) + bass*react*.9*fr) * tw;
 vec3 c = mix(GREEN, mix(GREEN, vec3(.6,1.,.85), .5), h);
 c = mix(c, cA, step(.88, h)*.55);
 c = mix(c, mix(GREEN, cD, .5), fr*.45);
 return c * b * (exp(-d*d/(rad*rad))*3.4 + exp(-d/(rad*1.5))*.8 + exp(-d/(rad*3.2))*.14);
}
vec3 ndLights(float xr, float wz, float zd, float t){
 float ax = abs(xr), side = sign(xr);
 vec3 o = vec3(0.);
 // the beat pulses are smooth along the road, so one look-up serves every lamp around this point
 float pulse = ndPulse(zd, 120.);
 for(int row=0; row<2; row++){
  float fr = float(row);
  float X = mix(12.6, 16.8, fr), sp = mix(6., 10., fr);
  float u = wz/sp, cz = floor(u + .5), cn = cz + (u > cz ? 1. : -1.);
  o += ndLamp(ax, side, wz, zd, t, fr, X, sp, cz, pulse) + ndLamp(ax, side, wz, zd, t, fr, X, sp, cn, pulse);
 }
 return o;
}
vec3 ndRoadFx(vec3 road, float xr, float wz, float edge, float fade){
 // the green lights spill across the wet asphalt near each shoulder, carrying the same pulses
 float zd = -log(max(fade, 1e-4))/.0042;
 float lampNear = pow(.5+.5*cos(6.28318*wz/6.), 4.);
 float spill = exp(-abs(11.-edge)*.42) * (.07 + .05*lampNear + mids*react*.05 + ndPulse(zd, 120.)*.25);
 return road + GREEN * spill * fade + mix(GREEN, cA, .5) * exp(-abs(11.-edge)*.12) * .012 * fade;
}
vec3 horizonTint(){ return mix(mix(cA, cD, .45), cB, .35); }
vec3 ndHaze(vec3 rd, float t){
 vec3 skyLow = mix(vec3(.050,.070,.170), vec3(.016,.024,.072), night);
 return skyLow + horizonTint()*.18*(1.-night*.55) + GREEN*.012;
}
vec3 ndGround(float xr, float wz, float fade){
 float zd = -log(max(fade, 1e-4))/.0042;
 float gn = fbm(vec2(xr*.035, wz*.012), 2.);
 // a plain of dark glassy rock: broken plates with lighter seams, glossy toward the horizon
 float seam = 1. - smoothstep(.0, .06, abs(gn - .5));
 vec3 c = mix(vec3(.012,.012,.030), vec3(.030,.026,.062), gn) * (1.-night*.35);
 c += mix(cB, horizonTint(), .5) * seam * .04 * fade * fade;
 c += horizonTint() * (.05*(1.-fade) + .22*pow(1.-fade, 2.5)) * (1.-night*.4);
 // frost crystals catching the light, sparkling with the highs
 vec2 g = vec2(xr, wz)*vec2(1.3, .55); vec2 gi = floor(g); float gh = hash(gi);
 float crys = step(.86, gh) * exp(-dot(fract(g)-.5, fract(g)-.5)*55.) * fade;
 c += mix(vec3(.75,.9,1.), GREEN, .25) * crys * (.18 + .12*sin(time*(1.+gh*3.) + gh*40.) + highs*react*.5*step(.93, gh));
 return c + ndLights(xr, wz, zd, time);
}
vec3 ndSky(vec3 rd, float t){
 vec3 ro = vec3(0.);
 vec3 L = normalize(vec3(-.62, .52, .58));
 vec3 rn = normalize(normalize(vec3(.30, .92, -.16)) + vec3(.045*sin(t*.021), 0., .05*sin(t*.017+1.3)));
 vec3 skyTop = mix(vec3(.014,.012,.062), vec3(.005,.004,.026), night);
 vec3 skyMid = mix(vec3(.030,.026,.105), vec3(.011,.009,.046), night);
 vec3 skyLow = mix(vec3(.050,.070,.170), vec3(.016,.024,.072), night);
 vec3 col = mix(mix(skyLow, skyMid, smoothstep(-.04,.20,rd.y)), skyTop, smoothstep(.12,.62,rd.y));
 vec2 sp = rgSky(rd);
 float bb = dot(PC, rd), miss = sqrt(max(dot(PC,PC) - bb*bb, 0.))/PR;
 // the nebula and stars are skipped where the planet's disc will cover them anyway
 if(miss > .98){
  col += ndNebula(rd, t);
  // stars thin out toward the horizon, where the air is thickest
  if(sp.y > -.01) col += ndStarField(sp, t, .25) * (.5+night*.6) * smoothstep(-.01, .12, sp.y);
  col += ndMeteors(sp);
 }
 if(miss > 1.) col += mix(cB, cA, .35) * exp(-(miss-1.)*7.) * (.22 + bass*react*.10);
 col += mix(cB, cC, .4) * exp(-max(miss-1.,0.)*1.6) * .05;
 // the two moons; the icy one carries a faint halo that brightens with the bass
 float tM1, mM1, tM2, mM2;
 vec4 m1 = rgMoon(rd, M1C, M1R, L, mix(vec3(.82,.9,1.), cA, .2), 3.1, tM1, mM1);
 col += mix(cA, vec3(.8,.9,1.), .5) * exp(-max(mM1-1., 0.)*6.) * (.05 + bass*react*.09) * step(1., mM1);
 col = mix(col, m1.rgb, m1.a);
 float tP, tR; vec3 rGlow; vec4 P = ndPlanet(ro, rd, L, rn, t, tP);
 vec4 Rg = ndRings(ro, rd, rn, L, t, tR, rGlow);
 if(tR < tP) col += rGlow;
 bool front = Rg.a > 0. && tR < tP;
 if(Rg.a > 0. && !front) col = mix(col, Rg.rgb, Rg.a);
 if(P.a > 0.) col = mix(col, P.rgb, P.a);
 if(front) col = mix(col, Rg.rgb, Rg.a);
 vec4 m2 = rgMoon(rd, M2C, M2R, L, vec3(.62,.56,.72), 8.7, tM2, mM2);
 col = mix(col, m2.rgb, m2.a);
 // an open horizon: a luminous band where sky meets the plain and thin haze strata for distance
 float az = sp.x, el = sp.y;
 float lowSky = exp(-max(el, 0.)*9.);
 col += horizonTint() * (exp(-abs(el)*30.)*.42 + lowSky*.12) * (1.-night*.45);
 col += mix(horizonTint(), vec3(1.), .5) * exp(-abs(el)*140.) * .25;
 if(el < .16){
  float s = fbm(vec2(az*2.6 + t*.006, el*46.), 2.);
  col += mix(cB, cD, .35) * smoothstep(.45,.82,s) * exp(-max(el,0.)*28.) * .14 * (1.-night*.3);
 }
 col += GREEN * exp(-abs(el)*45.) * exp(-az*az*3.) * .05;
 return col;
}
#define ND_OVERLAY
// Ring dust: glittering motes drifting across the view between the camera and the plain. The highs
// make them twinkle and each snare throws them outward in a brief burst.
vec3 ndOverlay(vec3 col, vec3 rd, vec2 uv, float t){
 vec2 P = rd.xy/(-rd.z);
 float bst = burst < 1.2 ? (1. - burst/1.2) : 0.;
 for(int i=0;i<3;i++){ float fi = float(i);
  if(fi > 1. + q) break;
  float ph = fract(travel*.006 + fi/3.);
  float dz = mix(70., 6., ph);
  vec2 g = P*dz*.32*(1. + bst*react*.25*ph) + vec2(fi*7.3 + t*.05, sin(t*.2 + fi)*.4);
  vec2 gi = floor(g), gf = fract(g) - .5;
  float h = hash(gi + fi*13.);
  if(h < .86) continue;
  vec2 o = (vec2(fract(h*13.1), fract(h*29.7)) - .5)*.6;
  float r = length(gf - o);
  float size = .025 + .03*fract(h*5.3);
  float a = smoothstep(0., .2, ph) * (1. - smoothstep(.8, 1., ph));
  if(P.y < 0.) a *= 1. - .8*(1. - smoothstep(3.6, 5.2, abs(P.x)/max(-P.y, 1e-3)));
  float tw = .55 + .45*sin(t*(1.7 + h*3.) + h*50.) + highs*react*.9*step(.93, h) + bst*react*.8;
  col += mix(cA, GREEN, step(.95, h)*.6) * exp(-r*r/(size*size)) * a * tw * .35;
 }
 return col;
}
`;

  // ---- World 2: COSMIC HIGHWAY ----
  // A galaxy arching over the road, neon light ribbons sweeping the horizon on both sides, soft
  // blue hills, and long-exposure light trails streaming along the lanes. Music: bass beats pulse
  // the trails and the horizon, overall loudness lifts the galaxy, mids swell the ribbons and
  // highs make the stars flare.
  var ND_COSMIC_HIGHWAY = `
// The galaxy band runs from high on the right down to the horizon just left of the road.
const vec2 GAL_A = vec2(.62, .78), GAL_B = vec2(-.30, -.02);
const vec2 GAL_CORE = vec2(.02, .33);
vec2 chSky(vec3 rd){ return vec2(atan(rd.x, -rd.z), rd.y / max(length(rd.xz), 1e-4)); }
float chBand(vec2 p, out float along){
 vec2 d = normalize(GAL_A - GAL_B), q = p - GAL_B;
 along = dot(q, d);
 return dot(q, vec2(-d.y, d.x));
}
vec3 chStars(vec2 p, float bandMask, float t){
 // the shared three-class star field, crowded along the galaxy band
 return ndStarField(p, t, bandMask*.9 + .1);
}
vec3 chGalaxy(vec2 p, float t, out float mask){
 float along, d = chBand(p, along);
 float wob = fbm(vec2(along*3.2, 1.7), 2.)-.5;
 float w = .085 + .05*fbm(vec2(along*2.1+4., .3), 2.);
 float body = exp(-pow((d - wob*.05)/w, 2.));
 mask = body;
 vec3 halo = mix(cB, vec3(.25,.45,1.), .5) * exp(-pow(d/(w*3.2),2.)) * .16;
 float coreD = length((p - GAL_CORE)*vec2(1.,1.25));
 // far from the band there is only its soft halo, so skip the cloud detail there
 if(abs(d) > w*3.6 && coreD > .85) return halo;
 // clumpy star clouds and dark dust lanes along the band
 vec2 bp = vec2(along*9., d*26.);
 float cloud = fbm(bp + vec2(t*.01, 0.), 3.+q);
 float lanes = smoothstep(.50,.78, fbm(vec2(along*5.5+9., d*40.+wob*6.), 3.));
 // the galaxy's core swells with the bass: one big element, not the whole band
 float core = exp(-coreD*7.5) + exp(-coreD*20.)*bass*react*.8;
 float lum = body*(.30 + cloud*.85)*(1.-lanes*.62) + core*(.9 + cloud*.6);
 vec3 c = mix(cB*.95, mix(cB, cC, .45), smoothstep(.35,.8,cloud));
 c = mix(c, vec3(.95,.86,1.), smoothstep(.55,1.2,core + cloud*body*.4));
 // fine resolved stars sprinkled through the star clouds
 vec2 sg = p*170.; float sh = hash(floor(sg));
 lum += step(.80, sh)*body*exp(-dot(fract(sg)-.5, fract(sg)-.5)*30.)*(.5 + .5*cloud);
 return c*lum*.78 + halo;
}
// Neon light ribbons sweeping across the sky near the horizon, mostly out to the sides.
vec3 chRibbons(vec2 p, float t){
 vec3 o = vec3(0.);
 for(int i=0;i<7;i++){ float fi=float(i);
  float side = mod(fi,2.)*2.-1.;                      // alternate right / left
  float base = .040 + fi*.021;
  float y = base + .055*sin(p.x*(2.6+fi*.5)*side + fi*1.9 + t*.22 + travel*.0003)
                 + .022*sin(p.x*7.1 - t*.35 + fi*4.);
  y += .012*mids*react*sin(p.x*11. + t*1.7 + fi);
  float dy = abs(p.y - y);
  float out_ = smoothstep(.04,.42, p.x*side + .08);   // sweep in from the edges toward the road
  float seg = .25 + .75*pow(.5 + .5*sin((p.x*.9*side + fi*.37 - t*.035 - travel*.00006)*6.28318), 1.5);
  vec3 c = mod(fi,3.)==0. ? cC : (mod(fi,3.)==1. ? cA : mix(cB, cC, .5));
  // the mids light the ribbons' bright cores; their wide soft glow stays as it is
  float glow = exp(-dy*420.)*1.1*(.55 + mids*react*1.1) + exp(-dy*70.)*.22*(.55 + mids*react*.12) + exp(-dy*16.)*.05*.55;
  o += mix(c, vec3(1.), exp(-dy*900.)*.5) * glow * out_ * seg;
 }
 return o;
}
float chHill(float az, float lay, float tr){
 float x = az*(1.5+lay*1.2) + tr*(.00012+lay*.0003*(1.-lay*.4));
 float h = .018 + .075*pow(fbm(vec2(x, lay*7.3), 3.), 1.6) + .022*sin(x*1.3+lay*2.+1.);
 // the road runs out through a low gap between the hills
 return h*mix(.35, 1., smoothstep(.04,.30, abs(az + .02))) - lay*.008 + step(1.5, lay)*.03;
}
// Coloured dust clouds drifting either side of the galaxy, glowing brighter as the music swells.
vec3 chNebula(vec2 p, float t){
 vec2 q = p*vec2(2.1, 3.2);
 float w0 = fbm(q + vec2(t*.006, 0.), 2.);
 vec2 w = vec2(w0, fract(w0*3.7));
 float n = fbm(q*1.15 + vec2(w0*1.8, w0*1.3) + vec2(t*.003, 0.), 3.);
 float cl = exp(-pow((p.x+.62)/.32, 2.) - pow((p.y-.30)/.26, 2.)) + exp(-pow((p.x-.70)/.28, 2.) - pow((p.y-.20)/.22, 2.))*.85;
 float m = smoothstep(.36, .78, n) * cl;
 vec3 c = mix(cC, cD, smoothstep(.3, .7, w.x));
 c = mix(c, vec3(1.,.9,1.), smoothstep(.72, .95, n)*.35);
 // fine glowing filaments through the bright gas and darker dust at its edges
 float fil = noise(q*5.2 + vec2(w0*3., n*2.) + vec2(t*.004, 0.));
 vec3 o = c * m * (.72 + .56*fil);
 o += mix(c, vec3(1.), .4) * pow(1. - abs(fil - .5)*2., 6.) * m * .6;
 o *= 1. - .35*smoothstep(.36, .5, n)*(1. - smoothstep(.5, .62, n))*cl;
 return o * .7;
}
vec3 horizonGlow(){ return mix(cC, cB, .35); }
// A planetary nebula far off to the right: a glowing shell around a white dwarf, with a pulsar's twin
// jets beside it. The shell swells with the bass; the jets fire on each kick.
vec3 chEye(vec2 p){
 vec2 e = (p - vec2(-.58, .37))*vec2(1., 1.3);
 float r = length(e);
 if(r > .12) return vec3(0.);
 float a = atan(e.y, e.x);
 // a soft, slightly uneven shell: brighter along one rim, a filmy glow inside, a faint outer halo
 float shell = exp(-pow((r - .033 - .0015*sin(a*3. + 1.))*62., 2.))*(.6 + .4*sin(a + .8));
 float inner = exp(-r*r*1100.)*.22, outer = exp(-pow((r - .055)*24., 2.))*.07;
 vec3 c = mix(cD, cC, smoothstep(.02, .05, r))*shell*(.45 + bass*react*.6) + mix(cD, cB, .5)*inner + mix(cC, cB, .5)*outer;
 c += vec3(.9,.95,1.)*exp(-r*r*40000.)*2.;
 vec2 j = p - vec2(-.47, .43);
 vec2 jd = normalize(vec2(.5, 1.));
 float along = dot(j, jd), across = dot(j, vec2(-jd.y, jd.x));
 float jet = exp(-across*across*90000.)*exp(-abs(along)*28.)*(.25 + kick*react*1.4);
 c += mix(cA, vec3(1.), .4)*(jet + exp(-dot(j,j)*30000.)*1.2);
 return c;
}
vec3 ndHaze(vec3 rd, float t){
 vec3 low = mix(vec3(.05,.07,.20), vec3(.02,.03,.10), night);
 return low + mix(cC, cB, .45)*.17*(1.-night*.45);
}
vec3 ndGround(float xr, float wz, float fade){
 float gn = fbm(vec2(xr*.03, wz*.010), 3.);
 // moonlit fields: dark blue-green grass with lighter patches
 float gx = fbm(vec2(xr*.11, wz*.05), 2.);
 vec3 c = mix(vec3(.030,.050,.120), vec3(.060,.090,.200), gn*.7 + gx*.3) * (1.-night*.25);
 // distance haze: the far fields take on the blue of the night sky
 c = mix(c, mix(vec3(.10,.12,.32), cB*.45, .3)*(1.-night*.25), (1.-smoothstep(.3,1.,fade))*.8);
 // the sky glow rolling across the fields
 c += mix(cB, cA, .4) * .035 * smoothstep(.4,.9,gn) * fade;
 // a still lake off to the left catching the galaxy and the horizon glow
 float lake = smoothstep(.52,.6, fbm(vec2(xr*.012+3., wz*.0016), 3.)) * (1.-smoothstep(-40.,-24., xr));
 vec3 water = mix(vec3(.03,.05,.14), mix(cB, cA, .5)*.32, .5+.5*sin(wz*.06 + xr*.2 + time*.6)) ;
 water += mix(cC, cB, .5) * (.08 + bass*react*.07) * (1.-fade);
 c = mix(c, water, lake);
 // distant settlement lights near the horizon
 float lights = step(.93, hash(floor(vec2(xr*.35, wz*.05)))) * (1.-smoothstep(.1,.55, fade));
 c += mix(cA, vec3(1.,.85,.7), hash(floor(vec2(xr*.35, wz*.05))+2.)) * lights * .6;
 // posts along the shoulder carrying small lights
 // posts along the shoulder carrying small lights; each kick runs a pulse of light away along them
 float zd = -log(max(fade, 1e-4))/.0042;
 float post = (1.-smoothstep(.0,.6, abs(abs(xr)-14.5))) * step(.85, fract(wz*.03));
 c += mix(cA, cC, step(0., xr)) * post * fade * (.45 + mids*react*.3 + ndPulse(zd, 130.)*2.2);
 return c;
}
// Long-exposure light trails streaming along the lanes, brightening on every beat.
vec3 ndRoadFx(vec3 road, float xr, float wz, float edge, float fade){
 vec3 add = vec3(0.);
 float zd = -log(max(fade, 1e-4))/.0042;
 float pk = ndPulse(zd, 150.);
 for(int i=0;i<10;i++){ float fi=float(i);
  float h = hash(vec2(fi, 9.3)), h2 = hash(vec2(fi, 4.1));
  float side = fi < 4.5 ? -1. : 1.;
  float x = side*(.6 + h*9.6) + .45*sin(wz*.009 + fi*2.3);
  float wd = .14 + h2*.32;
  float d = abs(xr - x)/wd;
  // long streaks that keep flowing, oncoming on the left and away on the right
  float stream = fract(wz*(.0022 + h2*.0016) - time*(.16 + h*.14)*side*-1. + h*7.);
  float run = smoothstep(.0,.08, stream)*(1.-smoothstep(.35,1., stream));
  vec3 c = mod(fi,3.)==0. ? cC : (mod(fi,3.)==1. ? mix(cC, cB, .5) : mix(cC, vec3(1.,.55,.95), .4));
  if(mod(fi,5.)==4.) c = mix(cB, cA, .45);
  float line = exp(-d*d*2.2)*.75 + exp(-d*.9)*.22;
  // each kick sends packets of light racing away along the trails, a little staggered per trail
  float packet = pk*(.55 + .45*h2);
  add += mix(c, vec3(1.,.93,1.), exp(-d*d*9.)*.55 + packet*.4) * line * (.18 + .82*run + packet*1.4) * (.8 + mids*react*.45*exp(-d*d*1.5));
 }
 // the wet road mirrors the horizon glow and the galaxy above it, shimmering as it nears
 float shimmer = .75 + .25*sin(wz*.35 + xr*.8 + time*1.3);
 add += horizonGlow() * exp(-xr*xr*.012) * pow(1.-fade, 1.5) * .9 * shimmer;
 add += mix(cB, cC, .5) * exp(-pow((xr+2.5)*.09, 2.)) * (1.-fade) * fade * .25 * shimmer;
 add += mix(cC, cB, .5) * exp(-abs(xr)*.18) * .05 * (1.-fade*.6);
 // the mids lift the trails' level as a whole; the beats travel as the packets above
 return road*.85 + add * .78 * (.45 + .55*fade);
}
vec3 ndSky(vec3 rd, float t){
 vec2 p = chSky(rd);
 float top = smoothstep(.02,.65,p.y);
 vec3 skyLow = mix(vec3(.06,.08,.26), vec3(.025,.035,.13), night);
 vec3 skyTop = mix(vec3(.010,.014,.075), vec3(.004,.006,.032), night);
 vec3 col = mix(skyLow, skyTop, pow(top,.7));
 // violet wash where the galaxy meets the horizon
 col += mix(cB, cC, .3) * exp(-pow((p.x+.05)/.6,2.))*exp(-max(p.y,0.)*5.)*.22;
 float gmask;
 col += chNebula(p, t) * (1.-night*.2);
 col += chGalaxy(p, t, gmask) * (1.-night*.15);
 col += chStars(p, gmask, t) * (.55 + night*.45);
 col += ndMeteors(p);
 col += chEye(p);
 // a handful of brilliant stars with long diffraction spikes, placed like a composed shot
 for(int i=0;i<5;i++){ float fi=float(i);
  vec2 sp = i==0 ? vec2(-.50,.48) : (i==1 ? vec2(.32,.56) : (i==2 ? vec2(.44,.27) : (i==3 ? vec2(-.24,.62) : vec2(.66,.47))));
  vec2 f = p - sp;
  if(dot(f,f) > .032) continue;              // its rays fade out well inside this distance
  float sz = i==0 ? 1.3 : (i==1 ? 1. : .75);
  // each brilliant star catches the hats on its own threshold, so they never flare together
  float tw = .8 + .2*sin(t*(1.1+fi*.37) + fi*3.) + react*(hat*step(.3 + fi*.12, highs)*.9 + highs*.25);
  float spk = exp(-abs(f.x)*30./sz - f.y*f.y*9000.) + exp(-abs(f.y)*30./sz - f.x*f.x*9000.);
  spk += (exp(-abs(f.x+f.y)*90./sz - pow(f.x-f.y,2.)*14000.) + exp(-abs(f.x-f.y)*90./sz - pow(f.x+f.y,2.)*14000.))*.35;
  // the music brightens the star itself and its spikes; its wide soft halo stays put
  float core = exp(-dot(f,f)*5200./sz), halo = exp(-dot(f,f)*260./sz)*.18;
  col += mix(vec3(.85,.92,1.), cA, .25) * ((spk*.8 + core*1.4) * tw + halo*1.4*(.8 + .2*sin(t*(1.1+fi*.37) + fi*3.))) * sz;
 }
 if(p.y < .30) col += chRibbons(p, t);
 // the bright glow on the horizon where the road disappears
 col += mix(cC, cB, .35) * exp(-abs(p.y)*16.) * exp(-p.x*p.x*6.) * .42;
 // the bass swells a tight core of that glow, right where the road meets the sky
 col += mix(cC, vec3(1.,.85,1.), .3) * exp(-abs(p.y)*55.) * exp(-p.x*p.x*22.) * bass*react*.5;
 col += mix(cA, cB, .5) * exp(-abs(p.y)*40.) * .18;
 // soft rolling hills, far range first, each lit along its crest; the farthest is pale with distance
 if(p.y < .16) for(int i=2;i>=0;i--){ float lay=float(i);
  float h = chHill(p.x, lay, travel);
  if(p.y < h){
   float sh = smoothstep(.0,.06, h-p.y);
   vec3 hill = mix(vec3(.075,.10,.27), vec3(.030,.042,.12), lay*.0 + max(1.-lay,0.)*.55) * (1.-night*.3);
   hill = mix(hill, mix(skyLow, horizonGlow(), .35), step(1.5, lay)*.55);
   hill = mix(hill, hill*.55, sh);
   hill += mix(cB, cA, .3) * .06 * (1.-sh);
   col = mix(col, hill, .92);
   // moonlit ridges: the crest of each range catches the light; mist pools in the valleys behind it
   col += mix(cA, cB, .5) * exp(-max(h-p.y,0.)*160.) * (.32 + mids*react*.18) * max(1.-lay*.35, .2);
   col += mix(skyLow, horizonGlow(), .5) * exp(-max(p.y - (h - .03), 0.)*60.) * smoothstep(.0, .03, h - p.y) * .05 * lay;
  }
 }
 // a far-off settlement strung along the horizon, its lights twinkling
 if(abs(p.y - .004) < .02 && p.y > chHill(p.x, 0., travel)){
  float cx = floor(p.x*170.), hh = hash(vec2(cx, 3.1));
  float lt = step(.62, hh) * exp(-pow((fract(p.x*170.)-.5)*3.4, 2.)) * exp(-pow((p.y-.005-hh*.007)*520., 2.)) * 1.6;
  col += mix(vec3(1.,.85,.6), cA, step(.9, hh)) * lt * (.55 + .45*sin(t*(1.+hh*3.) + hh*30.)) * (1. + highs*react*.6);
 }
 // just below the horizon the hills give way to the far haze, so the ground meets them softly
 col = mix(col, ndHaze(rd, t), (1.-smoothstep(-.012,.0,p.y)));
 return col;
}
`;

  // ---- World 3: ENCHANTED FOREST ----
  var ND_ENCHANTED_FOREST = `
#define ND_OVERLAY
// ENCHANTED FOREST: a moonlit old forest either side of the highway. Real trees (broadleaf giants and
// tall conifers) with bark, limbs and layered crowns, ranks of further trees fading into mist, ferns,
// rocks, glowing flowers and a scattering of luminous mushrooms along the verges, under an open,
// detailed night sky with a bright moon. Light is selective: the moon does most of the lighting and
// only a few things glow from within.
const float CAMH = 2.35;
// Forest scale: everything is built FS times larger than human scale so it passes at the same calm
// rate as the scenery of the other worlds. The road is untouched.
const float FS = 3.0;
const vec2 MOON = vec2(-.13, .33);           // the moon's place in the sky (azimuth, elevation)
vec3 efEmerald(){ return mix(vec3(.10,.95,.55), cD, .25); }
vec3 efCyan(){ return mix(vec3(.15,.95,1.), cA, .25); }
vec3 efViolet(){ return mix(vec3(.55,.30,1.), cB, .35); }
vec3 efPink(){ return mix(vec3(1.,.35,.80), cC, .3); }
vec3 efMoon(){ return vec3(.62,.74,.95); }
// the moonlight's direction on screen, from what is being lit toward the moon (set per pixel, so
// trees left of the moon are lit on their right and those right of it on their left)
vec2 gL = vec2(0., 1.);
vec2 efL(){ return gL; }
float efRoadX(float zd){ return curveAt(travel+zd)*min(1., zd*.0026); }
float efGroundH(float zd, float h0){ return max(CAMH + (hillAt(travel+zd)-h0)*.26, CAMH*.45); }
vec3 efFog(float t){ return mix(vec3(.035,.075,.115), vec3(.016,.04,.065), night) + efCyan()*.025; }
vec3 ndHaze(vec3 rd, float t){ return efFog(t)*1.25 + efMoon()*.03; }
vec2 efSkyP(vec3 rd){ return vec2(atan(rd.x, -rd.z), rd.y/max(length(rd.xz), 1e-4)); }

// A rank of trees against the sky: individual pointed conifer tops and rounded broadleaf crowns,
// two interleaved rows so the line has depth. Returns how far below the treeline the point is.
float efRank(float x, float base, float hgt, float cells, float seed){
 float best = -1.;
 for(int j=0;j<2;j++){ float fj = float(j);
  float u = x*cells + fj*.5 + seed*3.7;
  float c = floor(u), f = fract(u) - .5;
  float h = hash(vec2(c, seed + fj*9.1)), h2 = fract(h*17.3);
  float top = base + hgt*(.45 + .55*h)*(1. - .25*fj);
  float d = abs(f)*2.;
  // conifers: a spire with ragged branch tiers; broadleaf: a rounded, lumpy dome
  float spire = top - d*hgt*(1.1 + .5*h2) - .05*hgt*abs(sin(d*9. + c));
  float dome = top - d*d*hgt*.75 + .04*hgt*sin(f*13. + c);
  float prof = h2 > .45 ? spire : dome;
  best = max(best, prof);
 }
 return best;
}

vec3 ndSky(vec3 rd, float t){
 vec2 sp = efSkyP(rd);
 float up = clamp(sp.y, 0., 1.2);
 // deep blue night, lighter low down and around the moon
 vec3 col = mix(vec3(.040,.085,.15), vec3(.008,.018,.045), smoothstep(0.,.55,up));
 col = mix(col, col*.6, night*.6);
 vec2 dm = (sp - MOON)*vec2(1., 1.);
 float md = length(dm);
 col += efMoon()*(exp(-md*4.)*.10 + exp(-md*16.)*.10)*(1.-night*.3);
 // a faint band of the galaxy, and the three classes of stars, thinned by the moon's glare
 float bx = sp.x - .18 - up*.35;
 float band = exp(-bx*bx*14.);
 if(band > .02){
  float n = fbm(vec2(sp.x*4., sp.y*3.) + 3., 3.);
  col += mix(vec3(.35,.55,1.), efViolet(), .3) * band * smoothstep(.35,.8,n) * .20 * smoothstep(.05,.3,up);
 }
 if(sp.y > .02) col += ndStarField(sp, t, band*.6) * smoothstep(.02, .14, sp.y) * (1. - exp(-md*5.)*.8) * (.6 + night*.5);
 col += ndMeteors(sp);
 // thin high cloud drifting past the moon, silvered where the moonlight catches it
 if(sp.y > .12){
  float cl = fbm(vec2(sp.x*2.2 + t*.004, sp.y*6.), 3.);
  float cm = smoothstep(.5, .78, cl)*smoothstep(.12, .3, sp.y);
  col = mix(col, col*.55 + efMoon()*.05, cm*.6);
  col += efMoon()*cm*exp(-md*3.)*.12;
 }
 // the moon: a bright disc with darker seas and a sharp edge
 if(md < .06){
  float disc = 1. - smoothstep(.034, .037, md);
  vec2 mu = dm/.036;
  float seas = smoothstep(.45, .7, fbm(mu*2.1 + 4., 3.));
  col = mix(col, vec3(.86,.9,.98)*(1. - .28*seas)*(1. - .2*dot(mu,mu)), disc);
 }
 // the horizon: distant hills, then two ranks of forest, each nearer one darker and sharper;
 // mist lies in the gaps between them. They slide past slowly, the nearer faster.
 if(sp.y < .2){
  float x = sp.x;
  float hills = .035 + .03*fbm(vec2(x*2.4 + travel*.000015, 1.3), 2.);
  vec3 haze = mix(efFog(t)*1.6, efMoon()*.18, .25);
  col = mix(col, haze, (1. - smoothstep(hills - .004, hills + .004, sp.y))*.85);
  float far = efRank(x + travel*.00003, .014, .065, 24., 1.);
  float inFar = 1. - smoothstep(far - .002, far + .002, sp.y);
  col = mix(col, mix(efFog(t)*1.25, haze, .35), inFar*.92);
  col += efMoon()*.05*exp(-max(far - sp.y, 0.)*60.)*inFar*(1. - .5*step(0., x - MOON.x));
  float near = efRank(x + travel*.00007, .0, .10, 13., 2.);
  float inNear = 1. - smoothstep(near - .002, near + .002, sp.y);
  vec3 dark = efFog(t)*.62;
  // moonlight catches the treetops on the moon's side
  dark += efMoon()*.07*exp(-max(near - sp.y, 0.)*90.)*(1. - smoothstep(-.6, .2, x - MOON.x));
  col = mix(col, dark, inNear);
  // mist lying along the foot of the forest
  col += mix(efFog(t), efMoon()*.25, .3)*exp(-abs(sp.y - .004)*45.)*.35;
 }
 col += efCyan()*exp(-abs(sp.y)*30.)*exp(-sp.x*sp.x*4.)*.06;
 return col;
}

vec3 ndGround(float xr, float wz, float fade){
 float side = sign(xr);
 vec2 fw = vec2(xr, wz)/FS;   // forest units
 float n = fbm(fw*vec2(.12, .07), 2.);
 // the forest floor: moss and leaf litter, moonlit in clearings, darker under the trees
 float litter = noise(fw*vec2(1.4, .9));
 vec3 c = mix(vec3(.012,.028,.024), vec3(.040,.074,.056), n);
 c = mix(c, vec3(.055,.048,.036), smoothstep(.55, .8, litter)*.6);
 // pools of moonlight where the trees open up
 c += efMoon()*.05*smoothstep(.45, .8, n)*smoothstep(.3, .7, litter);
 c = mix(c, efFog(time)*1.4, (1.-fade)*.75);
 // roots of the nearest trees spread across the floor; each kick sends light running out along them
 float L = 17., S = 16.;
 float cell = floor((fw.y - hash(vec2(side,3.))*S)/S + .5);
 float tz = cell*S + hash(vec2(cell, side))*5.;
 vec2 d = vec2(fw.x - side*(L + hash(vec2(cell, side+5.))*3.), fw.y - tz);
 float r = length(d);
 if(r < 22.){
  float a = atan(d.y, d.x);
  float twist = noise(vec2(r*.25, cell))*1.6;
  float root = pow(abs(cos(a*3. + twist + cell)), 40.*(1.+r*.04)) * exp(-r*.11) * smoothstep(1.,3.,r);
  c = mix(c, vec3(.012,.012,.010), root*.85);
  float run = 0.;
  run += pulseS.x*exp(-pow((r - pulseT.x*14.)*.5, 2.))*exp(-pulseT.x*1.3);
  run += pulseS.y*exp(-pow((r - pulseT.y*14.)*.5, 2.))*exp(-pulseT.y*1.3);
  c += mix(efCyan(), efEmerald(), .5) * root * run * react * .9 * fade;
 }
 // a few bioluminescent specks in the moss that catch the hats
 vec2 g = fw*vec2(1.6, .9); vec2 gi = floor(g); float gh = hash(gi + side);
 float spk = step(.86, gh) * exp(-dot(fract(g)-.5, fract(g)-.5)*45.);
 c += mix(efCyan(), vec3(.7,1.,1.), .4) * spk * (.25 + .2*sin(time*1.5 + gh*30.) + highs*react*.9*step(.93, gh)) * (.3 + .7*fade);
 return c;
}

vec3 ndRoadFx(vec3 road, float xr, float wz, float edge, float fade){
 // moonlight on the wet road, the shoulders' glitter catching the hats
 vec3 add = efMoon()*.03*(1.-fade*.4);
 vec2 g = vec2(xr*3., wz*1.2); float h = hash(floor(g));
 add += efCyan() * step(.9, h) * exp(-dot(fract(g)-.5, fract(g)-.5)*30.) * exp(-abs(edge-11.6)*1.2) * fade * (.5 + hat*react*1.2);
 return road*.78 + add;
}

// One tree as a camera-facing cut-out at its own depth, in tree units (w.x across from the trunk,
// w.y up from the ground). kind 0: a broadleaf giant, its limbs carrying four or five rounded clumps
// of leaves layered over each other; kind 1: a tall conifer built from drooping tiers.
// Lit by the moon from the upper left; most trees only take moonlight, a few carry glowing lanterns.
vec4 efTree(vec2 P, float side, float zd, float X, float id, float hr, float h0, float lod){
 float gh = efGroundH(zd, h0);
 vec2 w = vec2(P.x*zd - X, P.y*zd + gh)/FS;
 float ppw = zd*1.2/res.y/FS;
 float kind = step(.62, fract(id*.137 + hr*3.1));
 float Ht = 19. + hr*12. + kind*5.;
 if(w.y < -.5 || w.y > Ht + 1. || abs(w.x) > 11.) return vec4(0.);
 // below the crown only the trunk can be here
 if(w.y < Ht*.42 && abs(w.x) > 4.5) return vec4(0.);
 vec2 L2 = efL();
 float out_ = side;                      // away from the road
 float lean = .9*sin(id*1.7);
 float tx = w.x - lean*w.y/Ht - .3*sin(w.y*.21 + id);
 float trunkTop = kind > .5 ? Ht*.96 : Ht*.66;
 float tr = mix(.85 + hr*.5, .28, clamp(w.y/trunkTop, 0., 1.)) + 1.5*exp(-max(w.y, 0.)*1.3);
 float du = tx/tr;
 vec3 col = vec3(0.); float a = 0.;
 // ---- trunk: furrowed bark, a moonlit edge, moss at the foot ----
 float trunk = (1. - smoothstep(1. - ppw/tr, 1. + ppw/tr, abs(du))) * step(w.y, trunkTop);
 if(trunk > 0.){
  // deep vertical furrows, broken here and there by cross-cracks
  float ridge = noise(vec2(du*4.2 + id*7., w.y*.22));
  float fine = lod > .5 ? .5 : noise(vec2(du*11., w.y*.9 + id));
  float furrow = smoothstep(.25, .6, abs(fract(du*2.6 + ridge*1.3) - .5)*2.);
  float bark = .45 + .9*(ridge - .5) + .45*(fine - .5) - .35*furrow*(1. - lod*.5);
  float lam = clamp(du*.8*sign(L2.x) + .25, 0., 1.);
  vec3 bc = mix(vec3(.022,.020,.022), vec3(.085,.09,.11), lam*lam)*bark;
  bc += efMoon()*pow(clamp(du*sign(L2.x), 0., 1.), 5.)*.14;
  float moss = smoothstep(.55, .75, fract(ridge*7.3))*(1. - smoothstep(1., 5., w.y));
  bc = mix(bc, vec3(.03,.075,.04)*(.6 + lam), moss*.8);
  col = bc; a = trunk;
 }
 // ---- limbs from the trunk up into the crown (broadleaf) ----
 vec2 cc0 = vec2(out_*3.2 + lean, Ht*.80), cc1 = vec2(-out_*2.4 + lean, Ht*.74), cc2 = vec2(lean*.8 + out_*.5, Ht*.93);
 vec2 cc3 = vec2(out_*5.6 + lean, Ht*.64), cc4 = vec2(-out_*.8 + lean, Ht*.60);
 if(kind < .5 && w.y > trunkTop*.75 && lod < .5){
  vec2 b0 = vec2(lean*trunkTop/Ht, trunkTop);
  for(int i=0;i<3;i++){
   vec2 e = i==0 ? cc0 : (i==1 ? cc1 : cc3);
   vec2 pa = w - b0, ba = e - b0;
   float hh = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.);
   float th = mix(.45, .12, hh);
   float lm = 1. - smoothstep(th - ppw, th + ppw, length(pa - ba*hh));
   if(lm > a){ col = vec3(.03,.028,.03); a = lm; }
  }
 }
 // ---- the crown ----
 if(w.y < Ht*.42 && a <= 0.) return vec4(0.);
 // leaf texture: clusters of leaves, with a finer flutter close up
 float leafN = noise(w*1.25 + id*3.);
 leafN = leafN*.7 + .3*(.5 + .5*sin(w.x*4.1 + leafN*6.)*sin(w.y*3.7 - leafN*5.));
 // each tree has its own shade of green; the moonlit tops turn silver-blue
 float tint = fract(id*.71);
 vec3 leafDark = mix(vec3(.003,.012,.010), vec3(.006,.010,.016), tint);
 vec3 leafLit = mix(mix(vec3(.07,.17,.10), vec3(.05,.14,.15), tint), efMoon()*.36, .32);
 vec3 L3 = normalize(vec3(L2*.85, .5));
 if(kind < .5){
  for(int i=0;i<5;i++){
   vec2 c = i==0 ? cc3 : (i==1 ? cc1 : (i==2 ? cc4 : (i==3 ? cc0 : cc2)));
   float rr = (3.6 + 1.3*fract(id*(1.3 + float(i)*.71))) * (i==4 ? .9 : 1.);
   if(lod > .5 && (i == 2 || i == 4)) continue;
   vec2 qv = (w - c)/vec2(rr, rr*.78);
   if(dot(qv, qv) > 1.7) continue;
   float d = length(qv) + (leafN - .5)*.42;
   if(d < 1. + ppw/rr){
    float cov = 1. - smoothstep(1. - ppw/rr*1.5, 1. + ppw/rr, d);
    // small holes through the leaves near the edge of the crown
    cov *= 1. - smoothstep(.72, .86, leafN)*smoothstep(.55, .95, d)*.9;
    vec3 nrm = vec3(qv, sqrt(max(1. - dot(qv, qv), 0.)));
    float lam = clamp(dot(nrm, L3), 0., 1.);
    float lit = smoothstep(.25, .95, lam);
    vec3 lc = mix(leafDark, leafLit, lit*lit*(.35 + 1.1*leafN*leafN));
    lc *= .5 + .5*smoothstep(-.9, -.2, qv.y);                   // the underside sits in shadow
    // the edge facing the moon is silvered, leaf by leaf
    lc += efMoon()*.16*smoothstep(.70, 1., d)*smoothstep(.2, .8, dot(normalize(qv + 1e-4), L2))*smoothstep(.35, .7, leafN);
    // a shadow falls on the clumps behind this one, just outside its edge
    col = a > 0. ? mix(col*mix(1., .45 + .55*smoothstep(0., .25, d - 1.), step(1., d)), lc, cov) : lc;
    a = max(a, cov);
   }
  }
 } else {
  // drooping tiers, narrowing toward the spire
  for(int i=0;i<7;i++){ float fi = float(i);
   float y0 = Ht*(.20 + fi*.108), th = Ht*.19;
   // the tips of each tier droop below its centre
   float hw = (Ht - y0)*.27*(1. + .1*sin(id + fi*2.));
   float dx = abs(w.x - lean*w.y/Ht);
   float droop = th*.32*(dx/hw)*(dx/hw);
   float v = (w.y - y0 + droop)/th;
   if(v < 0. || v > 1.) continue;
   float edgeN = .16*sin(w.x*3.4 + fi*3. + id) + (leafN - .5)*.35;
   float width = hw*pow(1. - v, .9)*(1. + edgeN);
   float inside = (1. - smoothstep(width - ppw, width + ppw, dx))*smoothstep(.0, .06 + (leafN - .5)*.08, v);
   if(inside > 0.){
    float s = dx/max(width, .1);
    vec3 nrm = vec3(sign(w.x - lean*w.y/Ht)*s*.8, .55 - v*.2, sqrt(max(1. - s*s*.64, 0.)));
    float lam = clamp(dot(normalize(nrm), L3), 0., 1.);
    float lit = smoothstep(.2, .9, lam);
    vec3 lc = mix(leafDark*.8, leafLit*.8, lit*lit*(.35 + 1.1*leafN*leafN));
    lc *= .45 + .55*smoothstep(.0, .4, v);                      // each tier's underside is dark
    lc += efMoon()*.12*smoothstep(.7, 1., s)*step(0., (w.x - lean*w.y/Ht)*sign(L2.x))*leafN;
    col = a > 0. ? mix(col*(.5 + .5*smoothstep(0., .3, v)), lc, inside) : lc;
    a = max(a, inside);
   }
  }
 }
 if(a <= 0.) return vec4(0.);
 // a few trees carry glowing lanterns of fungus among the leaves; they rise with the mids
 float lantern = step(.78, fract(id*.31 + .17));
 if(lantern > 0. && w.y > Ht*.4){
  vec2 g = w*vec2(.9, .7); vec2 gi = floor(g); float gh = hash(gi + id);
  vec2 go = fract(g) - .5 - (vec2(gh, fract(gh*7.)) - .5)*.5;
  float glow = step(.9, gh)*exp(-dot(go, go)*60.);
  col += mix(efCyan(), efEmerald(), fract(gh*3.))*glow*a*(.35 + mids*react*1.1);
 }
 return vec4(col, a);
}

// A clump of mushrooms at the roadside: one to three of a single variety (round-capped, slender
// conical or wide parasol), with stems, shaded caps, dark gills and a glowing rim. The caps' inner
// light follows the bass and pops on each kick; only some clumps glow strongly.
vec3 efMushrooms(vec3 col, vec2 w, float ppw, float h, float f, vec3 fog){
 float var = fract(h*7.7);
 float glowy = step(.45, fract(h*3.3));
 vec3 mc = h > .8 ? efPink() : (h > .62 ? efViolet() : efCyan());
 float lum = (.18 + .82*glowy)*(.6 + bass*react*1.1 + kick*react*.8);
 for(int i=0;i<3;i++){ float fi = float(i);
  float hi = fract(h*(13.1 + fi*7.3));
  if(i > 0 && hi < .4) continue;
  float sz = (1. + 1.2*fract(h*5.1))*(1. - fi*.25)*1.4;
  vec2 m = w - vec2((fi - .8)*sz*.9*(.6 + hi), 0.);
  float stemH = sz*(var < .33 ? .8 : (var < .66 ? 1.2 : 1.1));
  float sw = sz*(var < .33 ? .09 : .065)*(1. + .4*(1. - clamp(m.y/stemH, 0., 1.)));
  float stem = (1. - smoothstep(sw, sw + ppw, abs(m.x + .05*sz*sin(m.y*2./sz + hi*6.))))*step(0., m.y)*step(m.y, stemH);
  vec2 cq;
  float capR = sz*(var < .33 ? .55 : (var < .66 ? .38 : .8));
  float capH = sz*(var < .33 ? .48 : (var < .66 ? .62 : .22));
  cq = (m - vec2(0., stemH))/vec2(capR, capH);
  // round dome, tall rounded bell (narrowing toward its tip) or a wide flat parasol
  float shape = var < .33 ? length(cq) : (var < .66 ? length(vec2(cq.x*(1. + .35*max(cq.y, 0.)), cq.y)) : length(cq));
  float cap = (1. - smoothstep(1., 1. + ppw/capH, shape))*step(-.18, cq.y);
  float under = step(cq.y, .05)*cap;
  if(stem + cap > 0.){
   float lam = clamp(.55 + cq.y*.5 - cq.x*.35, 0., 1.);
   vec3 capC = mix(mc*.12, mc*.5, lam) + mc*lum*(.25 + .55*(1. - lam));
   // pale spots on the round caps
   if(var < .33){ vec2 sg = cq*3.2 + hi*9.; float sh = hash(floor(sg)); capC += vec3(.7,.8,.85)*step(.72, sh)*exp(-dot(fract(sg)-.5, fract(sg)-.5)*14.)*.25*lam; }
   capC = mix(capC, mc*lum*.9 + vec3(.01), under*.7);       // gills glow softly from underneath
   vec3 stC = mix(vec3(.05,.06,.065), vec3(.14,.16,.18), clamp(.5 - m.x/sw*.4, 0., 1.)) + mc*lum*.15;
   vec3 c = mix(stC, capC, cap);
   col = mix(col, mix(fog, c, f), max(cap, stem));
  }
  float rim = exp(-max(shape - 1., 0.)*3.2)*step(-.3, cq.y)*(1. - cap);
  col += mc*rim*lum*.3*f;
 }
 return col;
}
// A fern: five or six arching fronds with serrated leaflets, rising from one root. A few carry
// glowing tips that follow the mids.
vec3 efFern(vec3 col, vec2 w, float ppw, float h, float f, vec3 fog){
 float sz = 1.4 + 1.3*fract(h*3.9);
 if(w.y < -.1 || w.y > sz*1.3 || abs(w.x) > sz*1.6) return col;
 float cov = 0., tip = 0., shade = 0.;
 vec2 L2 = efL();
 for(int i=0;i<6;i++){ float fi = float(i);
  float ang = (-1.15 + fi*.46 + (fract(h*(3.1 + fi)) - .5)*.3);
  float len = sz*(1.05 - abs(ang)*.25);
  float cs = cos(ang), sn = sin(ang);
  vec2 r = vec2(w.x*cs - w.y*sn, w.x*sn + w.y*cs);    // r.y along the frond, r.x across
  float u = r.y/len;
  if(u < 0. || u > 1.) continue;
  float curve = sign(ang)*u*u*len*.35;
  float wid = len*.16*sin(3.14159*min(u*1.2, 1.))*(.55 + .45*abs(sin(u*len*9.)));
  float d = abs(r.x - curve);
  float c = 1. - smoothstep(wid - ppw, wid + ppw, d);
  float rib = 1. - smoothstep(.0, ppw*1.5 + .02, d);
  if(c > cov){ cov = c; shade = clamp(.5 + sn*L2.x*.8 + u*.3, 0., 1.)*(1. - rib*.5); tip = smoothstep(.8, 1., u); }
 }
 if(cov <= 0.) return col;
 vec3 fc = mix(vec3(.008,.03,.02), vec3(.07,.15,.10), shade);
 float glowTips = step(.6, fract(h*11.3));
 fc += efEmerald()*tip*glowTips*(.15 + mids*react*.9);
 return mix(col, mix(fog, fc, f), cov);
}
// A boulder with a cap of moss, rounded by the moonlight.
vec3 efRock(vec3 col, vec2 w, float ppw, float h, float f, vec3 fog){
 float rw = 1.3 + 1.6*fract(h*5.7), rh = rw*(.5 + .25*fract(h*9.1));
 vec2 q = (w - vec2(0., rh*.35))/vec2(rw, rh);
 if(q.y < -.4) return col;
 float n = noise(w*2.2 + h*20.);
 float d = length(q) + (n - .5)*.18;
 float cov = (1. - smoothstep(1. - ppw/rh, 1. + ppw/rh, d))*step(-.35, q.y);
 if(cov <= 0.) return col;
 vec3 nrm = vec3(q, sqrt(max(1. - dot(q, q), 0.)));
 float lam = clamp(dot(nrm, normalize(vec3(efL()*.8, .6))), 0., 1.);
 vec3 rc = mix(vec3(.018,.02,.026), vec3(.13,.14,.16), lam*lam)*(.7 + .5*n);
 rc = mix(rc, vec3(.03,.08,.04)*(.5 + lam), smoothstep(.15, .55, q.y + (n - .5)*.5)*.85);
 return mix(col, mix(fog, rc, f), cov);
}
// A clump of night flowers: slender stems, each with a softly glowing bell; they open up with the mids.
vec3 efFlowers(vec3 col, vec2 w, float ppw, float h, float f, vec3 fog){
 vec3 fcol = fract(h*4.1) > .5 ? efPink() : mix(efViolet(), efCyan(), .4);
 for(int i=0;i<3;i++){ float fi = float(i);
  float hi = fract(h*(7.3 + fi*5.1));
  float sx = (fi - 1.)*.55 + (hi - .5)*.4, ht = 1.1 + 1.2*hi;
  vec2 m = w - vec2(sx, 0.);
  float bend = .25*sin(time*.6 + hi*6.)*m.y/ht;
  float st = (1. - smoothstep(.035, .035 + ppw, abs(m.x - bend)))*step(0., m.y)*step(m.y, ht);
  col = mix(col, mix(fog, vec3(.02,.06,.035), f), st);
  vec2 bq = m - vec2(bend, ht);
  float bl = length(bq*vec2(1., 1.3));
  float bell = 1. - smoothstep(.16, .16 + ppw, bl);
  float open = .5 + .5*clamp(mids*react*1.6, 0., 1.);
  col = mix(col, mix(fog, fcol*(.35 + open*.6), f), bell);
  col += fcol*exp(-bl*bl*14.)*(.12 + open*.35)*f;
 }
 return col;
}

vec3 ndOverlay(vec3 col, vec3 rd, vec2 uv, float t){
 vec2 P = rd.xy/(-rd.z);
 float fogK = .0055/sqrt(FS), h0 = hillAt(travel);
 vec3 fog = efFog(t);
 float c0 = efRoadX(140.)/140.;
 float side = P.x > c0 ? 1. : -1.;
 gL = normalize(vec2((MOON.x - P.x)*1.6, 1.));
 // ---- trees, farthest rank first so nearer ones cover them ----
 for(int li=2; li>=0; li--){ float lf = float(li);
  if(lf > 1. + q) continue;
  float L = (19. + lf*11. + lf*lf*3.)*FS, S = (14. + lf*3.)*FS;
  float zd = (side*L + efRoadX(L/max(abs(P.x),.02)))/P.x;
  zd = (side*L + efRoadX(zd))/P.x;
  if(zd < 3. || zd > 620.*FS) continue;
  float off = hash(vec2(lf, side))*S;
  float base = floor((travel + zd - off)/S);
  for(int k=1;k>=-1;k--){
   if(k < 0 && lf > 0.) break;
   float cell = base + float(k);
   float hc = hash(vec2(cell, lf+side*7.));
   float tz = cell*S + off + hc*S*.45;
   float tzd = tz - travel;
   if(tzd < 2.5) continue;
   float id = cell*3.1 + lf*17. + side*5.;
   float X = efRoadX(tzd) + side*(L + fract(hc*13.7)*4.*FS);
   vec4 tr = efTree(P, side, tzd, X, id, fract(hc*31.3), h0, lf);
   if(tr.a > 0.){
    // distance fog, and mist that thickens toward the ground
    float hgt = (P.y*tzd + efGroundH(tzd, h0))/FS;
    float f = exp(-tzd*fogK)*(.55 + .45*smoothstep(0., 8., hgt));
    col = mix(col, mix(fog*1.15, tr.rgb, f), tr.a);
   }
  }
  // a veil of mist between this rank and the one in front of it
  col = mix(col, fog*1.3 + efMoon()*.02, .10*(1. - smoothstep(-.15, .05, P.y))*(lf + .5)*.5);
 }
 // ---- the verge: ferns, rocks, night flowers and the occasional clump of mushrooms ----
 // two rows: a farther one of ferns and boulders among the trees, then the one along the shoulder
 if(P.y < .1) for(int vr=0; vr<2; vr++){
  float far = vr == 0 ? 1. : 0.;
  float Lm = mix(15.5, 27., far), Sm = mix(5., 6.5, far)*FS;
  float zd = (side*Lm + efRoadX(Lm/max(abs(P.x),.02)))/P.x;
  zd = (side*Lm + efRoadX(zd))/P.x;
  if(zd > 3. && zd < 260.){
   float base = floor((travel + zd)/Sm);
   for(int k=1;k>=0;k--){
    float cell = base + float(k);
    float h = hash(vec2(cell, side*3. + far*11.));
    float tzd = cell*Sm + fract(h*17.3)*2.*FS - travel;
    if(tzd < 2.5) continue;
    float X = efRoadX(tzd) + side*(Lm + (fract(h*23.1) - .3)*3.);
    vec2 w = vec2(P.x*tzd - X, P.y*tzd + efGroundH(tzd, h0));
    float ppw = tzd*1.2/res.y;
    float f = exp(-tzd*fogK);
    float kind = fract(h*41.7);
    if(far > .5){ w /= 1.35; ppw /= 1.35; kind = .3 + kind*.52; }   // larger ferns and rocks back there
    if(kind < .24) col = efMushrooms(col, w, ppw, h, f, fog);
    else if(kind < .62) col = efFern(col, w, ppw, h, f, fog);
    else if(kind < .82) col = efRock(col, w, ppw, h, f, fog);
    else col = efFlowers(col, w, ppw, h, f, fog);
   }
  }
 }
 // ---- moonlight falling in soft shafts between the trees ----
 if(P.y > -.15 && P.y < .3){
  vec2 dv = P - MOON; float ang = atan(dv.x, -dv.y);
  float beams = smoothstep(.5, .9, noise(vec2(ang*9., t*.03)))*smoothstep(.08, .3, length(dv));
  col += efMoon()*beams*exp(-length(dv)*2.2)*.05*(1. - smoothstep(.0, 1.2, abs(ang)));
 }
 // ---- fireflies: a few soft lights wandering over the verges; the hats make them flare ----
 for(int i=0;i<6;i++){ float fi = float(i);
  if(fi > 3. + q*2.) break;
  float hs = hash(vec2(fi, 5.1));
  vec2 fp = vec2((hs < .5 ? -1. : 1.)*(.35 + .5*fract(hs*7.)), -.03 + .14*fract(hs*13.));
  fp += vec2(sin(time*(.21 + hs*.2) + fi*2.), sin(time*(.33 + hs*.15) + fi)*.6)*.05;
  float fr = length(P - fp);
  float blink = pow(.5 + .5*sin(time*(.7 + hs) + fi*3.), 3.) + hat*react*step(.5, hs);
  col += mix(vec3(.75,1.,.6), efCyan(), hs) * (exp(-fr*fr*9000.)*1.2 + exp(-fr*fr*600.)*.18) * blink;
 }
 // ---- spores drifting toward and past the camera; they speed up on the beat, burst outward
 //      on the snare and twinkle with the highs ----
 float bst = burst < 1. ? 1. - burst : 0.;
 for(int i=0;i<4;i++){ float fi = float(i);
  if(fi > 2. + q) break;
  float ph = fract(drift*.35 + fi/4.);
  float dz = mix(60., 4., ph)*FS;
  vec2 g = P*dz/FS*(1. + bst*react*.3*ph) + vec2(fi*7.3, 0.) + vec2(sin(time*.3+fi)*.3, time*.08);
  vec2 gi = floor(g), gf = fract(g) - .5;
  float h = hash(gi + fi*13.);
  if(h < .88) continue;
  vec2 o = (vec2(fract(h*13.1), fract(h*29.7)) - .5)*.6;
  float r = length(gf - o);
  float size = .018 + .02*h;
  float a = smoothstep(0., .15, ph) * (1. - smoothstep(.85, 1., ph));
  if(P.y < 0.) a *= 1. - .85*(1. - smoothstep(3.6, 5.2, abs(P.x)/max(-P.y, 1e-3)));
  a *= 1. - .7*smoothstep(.05, .3, P.y);             // spores keep low, under the trees
  float tw = .5 + .4*sin(time*(1.5+h*3.) + h*50.) + highs*react*.9*step(.93, h) + bst*react*.6;
  col += mix(efCyan(), h > .95 ? efPink() : efEmerald(), fract(h*7.)) * exp(-r*r/(size*size)) * a * tw * .45;
 }
 return col;
}
`;

  var ND_WORLDS = [
    { id: 'rings', name: 'CELESTIAL RINGS', frag: ND_CELESTIAL_RINGS },
    { id: 'cosmic', name: 'COSMIC HIGHWAY', frag: ND_COSMIC_HIGHWAY },
    { id: 'forest', name: 'ENCHANTED FOREST', frag: ND_ENCHANTED_FOREST }
  ];
  var ND_PALETTES = [
    ['ultraviolet', 'ULTRAVIOLET', [.25, .72, 1], [.52, .35, 1], [1, .35, .85], [.25, .95, .82]],
    ['electric', 'ELECTRIC', [.20, .86, 1], [.28, .46, 1], [.72, .34, 1], [.22, 1, .80]],
    ['nebula', 'NEBULA', [.42, .62, 1], [.70, .32, 1], [1, .30, .66], [.45, .90, 1]],
    ['aurora', 'AURORA', [.34, 1, .82], [.44, .56, 1], [.82, .44, 1], [.30, .96, .96]]
  ];
  var ND_TIMES = [['dusk', 'DUSK', 0], ['night', 'NIGHT', .55], ['deep', 'DEEP NIGHT', 1]];
  var ND_SPEEDS = [['drift', 'DRIFT', 42], ['cruise', 'CRUISE', 96], ['fast', 'FAST', 168]];

  function ndFind(list, id, fallback) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === id) return list[i];
    return fallback || list[0];
  }
  function ndWorld(id) {
    for (var i = 0; i < ND_WORLDS.length; i++) if (ND_WORLDS[i].id === id) return ND_WORLDS[i];
    return ND_WORLDS[0];
  }
  function ndSave(key, val) { try { if (A && A.setPref) A.setPref(key, String(val)); else localStorage.setItem('p_' + key, String(val)); } catch (e) {} }

  var MET_A = ['mA0', 'mA1', 'mA2'], MET_B = ['mB0', 'mB1', 'mB2'];
  function nightDrive() {
    var world = ndWorld(N.pref('ndWorld') || 'rings');
    var palette = ndFind(ND_PALETTES, N.pref('ndPalette') || 'ultraviolet');
    var timeOfNight = ndFind(ND_TIMES, N.pref('ndTime') || 'night');
    var speed = ndFind(ND_SPEEDS, N.pref('ndSpeed') || 'cruise');
    var react = N.pref('ndReact') !== '0';
    var oldGLX = GLX;
    GLX = HIGH_MEMORY_DEVICE ? 1.05 : .70;
    var quality = HIGH_MEMORY_DEVICE ? 1 : 0;
    var travel = 0, lastNow = 0, frames = 0, beat = null, g = null, failed = false, surge = 0, fadeStart = 0;
    // Music comes from the shared analyser in visuals.js (six bands, kick / snare / hat onsets, tempo),
    // falling back to the older three-band feed. Every element listens to its own part of the sound.
    var NM = window.NXV && NXV.musicTick ? NXV : null;
    var mus = { k: 0, e: 0, bass: 0, mid: 0, high: 0, hat: 0, snare: 0, live: false, kicks: 0, snares: 0 };
    var pulseT = [99, 99, 99, 99], pulseS = [0, 0, 0, 0], burstAge = 99, drift = 0, shower = 0, lastPulseAt = 0;
    // Shooting stars are launched here at random moments, each with its own look (see ndMeteor).
    var mets = [null, null, null], metWait = [1.5 + Math.random() * 4, 5 + Math.random() * 6, 9 + Math.random() * 9], metLog = [];

    function beatOn() {
      if (!beat) beat = beatTracker({ quiet: true });
      if (NM) { try { NM.musicReset(); if (A && A.meterDetail) A.meterDetail(true); } catch (e) {} }
    }
    function beatOff() { beat = null; try { if (A) { if (A.meterDetail) A.meterDetail(false); A.meter(false); } } catch (e) {} }
    if (react) beatOn();

    function kickPulse(strength) {
      pulseT.unshift(0); pulseT.pop(); pulseS.unshift(Math.max(.45, Math.min(1, strength))); pulseS.pop();
    }
    // Reads the music for this frame. Values ease rather than jump, and all of them fall to zero
    // within a second or two when the music stops: nothing here moves on a timer of its own.
    // fixed buffers for the per-frame uniforms, so the drive allocates nothing while it runs
    var metA = [new Float32Array(4), new Float32Array(4), new Float32Array(4)], metB = [new Float32Array(4), new Float32Array(4), new Float32Array(4)];
    var pulseTU = new Float32Array(4), pulseSU = new Float32Array(4), lastDt = .016;
    function ease(k) { return Math.min(1, lastDt * k); }
    function listen(now, dt) {
      lastDt = dt;
      if (!react) { mus.k = mus.e = mus.bass = mus.mid = mus.high = mus.hat = mus.snare = 0; mus.live = false; return; }
      var M6 = NM ? NM.musicTick(now, dt * 1000) : null;
      if (M6 && (M6.live || !beat || !beat.live)) {
        mus.live = M6.live;
        mus.k = M6.kick; mus.hat = M6.hat; mus.snare = M6.snare; mus.e = M6.energy;
        var lowB = Math.max(M6.sub, M6.bass) * (.55 + .45 * M6.activity);
        mus.bass += (lowB - mus.bass) * ease(lowB > mus.bass ? 9 : 2.5);
        mus.mid += ((M6.lowmid * .35 + M6.mid * .65) - mus.mid) * ease(5);
        mus.high += ((M6.high * .6 + M6.air * .4) - mus.high) * ease(8);
        if (M6.kickHit && M6.live) kickPulse(M6.strength || .7);
        if (M6.snareHit && M6.live) burstAge = 0;
        if (M6.drop) shower = 1;
        else if (M6.build > .65 && M6.live) shower = Math.max(shower, (M6.build - .65) * 1.2);
      } else if (beat) {
        beat.tick(now);
        mus.live = beat.live;
        mus.k = beat.k; mus.e = beat.e;
        // the older feed's mid and high bands are tiny raw magnitudes: scale them to 0..1
        mus.bass += (Math.min(1, beat.bass * .9) - mus.bass) * ease(6);
        mus.mid += (Math.min(1, beat.mid * 9) - mus.mid) * ease(5);
        mus.high += (Math.min(1, beat.high * 12) - mus.high) * ease(8);
        mus.hat *= Math.exp(-dt * 10); mus.snare *= Math.exp(-dt * 7);
        if (beat.hit) kickPulse(beat.k || .7);
        if (beat.drop) shower = 1;
      }
    }
    function launchMeteor(i) {
      var r = Math.random;
      mets[i] = { x: -.85 + 1.7 * r(), y: .24 + .30 * r(), ang: -.35 - 2.45 * r(), len: .05 + .24 * r(), dist: .22 + .5 * r(),
        br: .5 + 1.3 * r(), warm: r() < .25 ? 1 : 0, dur: .45 + 1.1 * r(), u: 0 };
      metLog.push({ at: lastNow, ang: mets[i].ang, len: mets[i].len, dur: mets[i].dur, br: mets[i].br }); if (metLog.length > 12) metLog.shift();
    }
    function skyTick(dt) {
      for (var i = 0; i < 3; i++) {
        var m = mets[i];
        if (m) { m.u += dt / m.dur; if (m.u >= 1) { mets[i] = null; metWait[i] = (2.5 + Math.random() * 11) / (1 + shower * 5); } }
        else if ((metWait[i] -= dt) <= 0) launchMeteor(i);
      }
      shower *= Math.exp(-dt / 7);
    }
    function sendMeteors() {
      for (var i = 0; i < 3; i++) {
        var m = mets[i];
        var a = metA[i], b2 = metB[i];
        if (m) { a[0] = m.x; a[1] = m.y; a[2] = m.ang; a[3] = m.u; b2[0] = m.len; b2[1] = m.dist; b2[2] = m.br; b2[3] = m.warm; }
        else { a[3] = 0; }
        g.v4a(MET_A[i], a); g.v4a(MET_B[i], b2);
      }
    }

    function build() {
      g = glStart('nd-' + world.id, ND_HEAD + world.frag + ND_MAIN);
      failed = !g; fadeStart = 0;
      if (failed) { text('xpMid', 'NIGHT DRIVE NEEDS WEBGL GRAPHICS'); $('xpMid').style.color = '#9fd0ff'; }
      return !!g;
    }
    build();

    // ---- controls: hidden until touched, gone again a few seconds later ----
    var ui = document.createElement('div');
    ui.className = 'nd-ui';
    function chips(rowId, list, selected) {
      return list.map(function (it) {
        return '<button type="button" data-' + rowId + '="' + it[0] + '"' + (it[0] === selected ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + it[1] + '</button>';
      }).join('');
    }
    function render() {
      ui.innerHTML =
        '<div class="nd-bar">' +
        '<div class="nd-row"><span>WORLD</span>' + ND_WORLDS.map(function (w) {
          return '<button type="button" data-world="' + w.id + '"' + (w.id === world.id ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + w.name + '</button>';
        }).join('') + '</div>' +
        '<div class="nd-row"><span>TIME</span>' + chips('time', ND_TIMES, timeOfNight[0]) + '</div>' +
        '<div class="nd-row"><span>COLOUR</span>' + chips('palette', ND_PALETTES, palette[0]) + '</div>' +
        '<div class="nd-row"><span>SPEED</span>' + chips('speed', ND_SPEEDS, speed[0]) + '</div>' +
        '<div class="nd-row"><span>MUSIC</span><button type="button" data-react="t"' + (react ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + (react ? 'REACTIVE' : 'OFF') + '</button></div>' +
        '</div>';
    }
    render();
    layer.appendChild(ui); xpDom.push(ui);

    var idleTimer = 0, alive = true;
    function wake() {
      layer.classList.remove('nd-idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { if (alive) layer.classList.add('nd-idle'); }, 4200);
    }
    wake();

    ui.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      wake();
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.world && b.dataset.world !== world.id) { world = ndWorld(b.dataset.world); ndSave('ndWorld', world.id); build(); }
      else if (b.dataset.time) { timeOfNight = ndFind(ND_TIMES, b.dataset.time); ndSave('ndTime', timeOfNight[0]); }
      else if (b.dataset.palette) { palette = ndFind(ND_PALETTES, b.dataset.palette); ndSave('ndPalette', palette[0]); }
      else if (b.dataset.speed) { speed = ndFind(ND_SPEEDS, b.dataset.speed); ndSave('ndSpeed', speed[0]); }
      else if (b.dataset.react) { react = !react; ndSave('ndReact', react ? '1' : '0'); if (react) beatOn(); else beatOff(); }
      render();
    });
    layer.addEventListener('pointerdown', wake);

    if (!failed) loop(function (now) {
      var dt = lastNow ? Math.min(.1, (now - lastNow) / 1000) : .016;
      lastNow = now;
      listen(now, dt);
      for (var pi = 0; pi < 4; pi++) pulseT[pi] += dt;
      burstAge += dt;
      // particles drift on their own and hurry along when the kicks land
      drift += dt * (.12 + (react ? mus.k * .55 + mus.e * .1 : 0));
      if (drift > 1e4) drift -= 1e4;
      skyTick(dt);
      // the drive surges with the music's energy and eases back when it calms (never jumps)
      surge += ((react ? Math.min(1, mus.e) * .4 : 0) - surge) * Math.min(1, dt * 1.5);
      travel += speed[2] * dt * (1 + surge);
      if (travel > 1e7) travel -= 1e7;   // stays in float range on a very long journey
      g.f('travel', travel);
      g.f('night', timeOfNight[2]);
      g.f('react', react ? 1 : 0);
      g.f('mids', mus.mid);
      g.f('highs', mus.high);
      g.f('bass', mus.bass);
      g.f('hat', mus.hat);
      g.f('snare', mus.snare);
      g.f('burst', burstAge);
      g.f('drift', drift);
      for (var pj = 0; pj < 4; pj++) { pulseTU[pj] = pulseT[pj]; pulseSU[pj] = pulseS[pj]; }
      g.v4a('pulseT', pulseTU);
      g.v4a('pulseS', pulseSU);
      sendMeteors();
      g.f('q', quality);
      // ease the world in from black over 1.6 s when it starts or another world is picked
      if (!fadeStart) fadeStart = now;
      var fk = Math.min(1, (now - fadeStart) / 1600);
      g.f('fadeIn', fk * fk * (3 - 2 * fk));
      g.v3('cA', palette[2]); g.v3('cB', palette[3]); g.v3('cC', palette[4]); g.v3('cD', palette[5]);
      g.draw(now, mus, 0);
      frames++;
    }, 30);

    XP.cleanupCurrent = function () {
      alive = false;
      clearTimeout(idleTimer);
      layer.removeEventListener('pointerdown', wake);
      layer.classList.remove('nd-idle');
      GLX = oldGLX;
      beat = null;
    };
    XP.ndDebug = function () {
      return { world: world.id, palette: palette[0], time: timeOfNight[0], speed: speed[0], react: react,
        travel: travel, frames: frames, gl: !!g, quality: quality, glx: GLX, fade: fadeStart ? Math.min(1, (lastNow - fadeStart) / 1600) : 0,
        idle: layer.classList.contains('nd-idle'), controls: !!ui.parentNode, beat: !!beat,
        music: { live: mus.live, kick: mus.k, bass: mus.bass, mid: mus.mid, high: mus.high, hat: mus.hat, snare: mus.snare, energy: mus.e },
        pulses: pulseT.slice(), burst: burstAge, drift: drift, shower: shower, meteors: mets.filter(Boolean).length, metLog: metLog.slice(), analyser: !!NM };
    };
  }

  function isVisual(name) { return !!(window.NXV && NXV.order.indexOf(name) >= 0); }
  var XP = window.XP = {
    redraw: glRedraw,
    active: false,
    current: null,
    cleanupCurrent: null,
    onMeter: null,
    Packs: { schemaVersion: 1, validate: validateWorldPack, install: installWorldPack, list: listWorldPacks, asset: openWorldPackAsset, remove: removeWorldPack },
    // The six Visuals themes live in visuals.js (window.NXV), with their own 3D renderer.
    visuals: window.NXV ? NXV.order.slice() : [],
    previews: function (cb) { if (window.NXV) NXV.previews(cb); else cb({}); },
    // Switch between the five visuals without leaving Visuals: the last frame dissolves over the new one.
    switchTo: function (name) { if (!isVisual(name)) return; NXV.snapshot(); XP.open(name); },
    open: function (name) {
      var known = isVisual(name) || ({ holo: 1, webcams: 1, clockface: 1, lyrics: 1, liquiddreams: 1, nightdrive: 1 })[name];
      if (!known) return false;
      XP.close(true);
      layer.classList.remove('hidden');
      layer.classList.toggle('liquid-dreams', name === 'liquiddreams');
      layer.classList.toggle('night-drive', name === 'nightdrive');
      layer.classList.remove('nd-idle');
      $('xpClose').style.display = name === 'liquiddreams' ? 'none' : '';
      size();
      XP.active = true;
      XP.current = name;
      running = name;
      GLX = 1.25;
      resetAtmosphere(name);
      text('xpTop'); text('xpMid'); text('xpBottom');
      $('xpMid').style.color = '#fff'; $('xpMid').style.top = ''; $('xpMid').style.transform = '';
      if (isVisual(name)) { cv.style.visibility = 'hidden'; if (!NXV.start(name)) { cv.style.visibility = ''; text('xpMid', 'This screen needs WebGL graphics for Visuals'); } return true; }
      ({ holo: holo, webcams: webcams, clockface: clockface, lyrics: lyrics, liquiddreams: liquidDreams, nightdrive: nightDrive })[name]();
      return true;
    },
    close: function (quiet) {
      running = null;
      if (XP.cleanupCurrent) { XP.cleanupCurrent(); XP.cleanupCurrent = null; }
      if (window.NXV) NXV.stop(quiet);
      glStop();
      if (atmosphereCtx) atmosphereCtx.clearRect(0, 0, atmosphereCanvas.width, atmosphereCanvas.height);
      atmosphereParticles = []; atmosphereProfile = null;
      xpDom.forEach(function (d) { if (d.parentNode) d.parentNode.removeChild(d); }); xpDom = [];
      cancelAnimationFrame(raf);
      timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
      timers = [];
      XP.onMeter = null;
      try { if (A) { if (A.meterDetail) A.meterDetail(false); A.meter(false); } } catch (e) {}
      if (XP.active && !quiet) N.stopTalking();
      XP.active = false;
      XP.current = null;
      // Leaving Visuals entirely releases the shader programs, head mesh and render buffer.
      layer.classList.remove('liquid-dreams');
      layer.classList.remove('night-drive'); layer.classList.remove('nd-idle');
      delete XP.ndDebug;
      $('xpClose').style.display = '';
      layer.classList.add('hidden');
      layer.onclick = null;
    }
  };
  $('xpClose').addEventListener('click', function (e) { e.stopPropagation(); XP.close(); if (window.onXpUserClose) window.onXpUserClose(); });
  window.addEventListener('resize', function () { if (XP.active) size(); });


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

    text('xpTop', 'HOLOGRAPHIC INTERFACE · NEXUS');
    text('xpBottom', 'TAP THE HOLOGRAM TO TALK');
    if (N.sayVoiceLine) N.sayVoiceLine('holo', true); else N.say('Hologram projection online. I am Nexus. Tap me, and talk to me.');
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




  // ==================================================================
  // MUSIC VISUALS (all silent, all react to the music)
  // ==================================================================
  // Shared beat input: B.e = energy (0-1), B.k = kick (bass hit, 0-1), B.hit = true on the frame a kick lands.
  // If no music signal is coming in, it falls back to a steady 120 BPM so visuals never sit still.
  function beatTracker(opts) {
    var quiet = !!(opts && opts.quiet);
    // Music playing  -> energy + kicks follow the real beat.
    // No music       -> everything eases to calm (no fake beat, no pulsing, no flashes).
    var B = window.BEAT, b = { e: 0, k: 0, mid: 0, high: 0, bass: 0, level: 0, hit: false, live: false, lastKicks: B ? B.kicks : 0, lastHit: 0, musicAt: 0 };
    XP.onMeter = function () {};
    try { if (A) A.meter(true); } catch (e) {}
    var musicOn = !A, nextCheck = 0;
    b.tick = function (now) {
      now = now || performance.now();
      if (B) B.tick();
      if (A && now > nextCheck) { nextCheck = now + 1000; try { musicOn = !!A.isMusicActive(); } catch (e) { musicOn = true; } }
      var live = !!(B && Date.now() - B.live < 1500 && musicOn);
      b.live = live;
      if (live) {
        b.e += ((B.e || 0) - b.e) * .18;
        b.k = B.k || 0;
        b.mid += ((B.mid || 0) - b.mid) * .22; b.high += ((B.high || 0) - b.high) * .24;
        // Absolute bands (not peak-relative like e): a quiet, unvarying passage stays quiet here
        // instead of drifting up once the recent peak has had time to decay away.
        b.bass += ((B.bass || 0) - b.bass) * .3; b.level += ((B.level || 0) - b.level) * .22;
        var fresh = B.kicks !== b.lastKicks; b.lastKicks = B.kicks;
        b.hit = fresh && now - b.lastHit > 230; if (b.hit) b.lastHit = now;
        // THE DROP: the music was quiet/building, then slams in
        b.slow = (b.slow === undefined ? b.e : b.slow + (b.e - b.slow) * .012);
        b.drop = b.hit && b.k > .8 && b.e > .45 && b.e > b.slow * 1.9 && now - (b.lastDrop || 0) > 9000;
        if (b.drop) { b.lastDrop = now; if (!quiet) dropFlash(); }
      } else {
        b.e *= .9; b.k *= .8; b.mid *= .85; b.high *= .85; b.bass *= .85; b.level *= .9; b.hit = false; b.drop = false; if (B) b.lastKicks = B.kicks;
      }
      return Math.max(b.e * .8, b.k);
    };
    return b;
  }

  function dropFlash() {
    var d = $('xpDrop'); if (!d) { d = document.createElement('div'); d.id = 'xpDrop'; layer.appendChild(d); }
    d.style.transition = 'none'; d.style.opacity = .55; d.style.transform = 'scale(1)';
    void d.offsetWidth; d.style.transition = 'opacity .9s ease-out, transform .9s ease-out'; d.style.opacity = 0; d.style.transform = 'scale(1.6)';
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









  // ==================================================================
  // GRAPHICS-CHIP VISUALS (sharp, smooth, music-synced)
  // ==================================================================







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


















  // ---------------- CLOCK FACE: tap to change style ----------------
  function clockface() {
    var STY = ['NEON', 'FLIP', 'LUXURY', 'HOLO RING', 'WORDS'], si = Math.max(0, STY.indexOf(N.pref ? N.pref('clockStyle') : ''));
    var b = beatTracker(), lt = performance.now(), flipPrev = '', flipAt = 0;
    var DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'], MON = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    function save() { try { if (A) A.setPref('clockStyle', STY[si]); else localStorage.setItem('p_clockStyle', STY[si]); } catch (e) {} }
    layer.onclick = function (e) { if (e.target.closest && e.target.closest('#xpClose,#xpNext')) return; if (N.saver && N.saver()) { N.saverOff(); XP.close(); return; } si = (si + 1) % STY.length; save(); text('xpBottom', 'TAP FOR ANOTHER STYLE · ' + STY[si]); };
    text('xpTop', ''); text('xpBottom', N.saver && N.saver() ? 'TAP TO GO BACK' : 'TAP FOR ANOTHER STYLE · ' + STY[si]);
    function wx() { var w = N.weather ? N.weather() : null; return w ? w.temp + '° · ' + String(w.desc || '').toUpperCase() : ''; }
    function words(h, m) {
      var n = ['TWELVE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN'], r = Math.round(m / 5) * 5, hh = h % 12;
      if (r === 60) { r = 0; hh = (hh + 1) % 12; }
      var mins = { 0: '', 5: 'FIVE PAST', 10: 'TEN PAST', 15: 'QUARTER PAST', 20: 'TWENTY PAST', 25: 'TWENTY-FIVE PAST', 30: 'HALF PAST', 35: 'TWENTY-FIVE TO', 40: 'TWENTY TO', 45: 'QUARTER TO', 50: 'TEN TO', 55: 'FIVE TO' }[r];
      if (r > 30) hh = (hh + 1) % 12;
      return ['IT IS', mins, n[hh], r === 0 ? "O'CLOCK" : ''].filter(Boolean);
    }
    loop(function (now) {
      var dt = Math.max(0, Math.min(.08, (now - lt) / 1000)); lt = now;
      b.tick(now);
      var d = new Date(), h = d.getHours(), m = d.getMinutes(), sec = d.getSeconds() + d.getMilliseconds() / 1000;
      var h12 = ((h + 11) % 12) + 1, hm = h12 + ':' + (m < 10 ? '0' : '') + m, ap = h < 12 ? 'AM' : 'PM';
      var date = DAYS[d.getDay()] + ' · ' + MON[d.getMonth()] + ' ' + d.getDate(), U = Math.min(W, H), st = STY[si];
      cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      if (st === 'NEON') {
        cx.fillStyle = '#03030a'; cx.fillRect(0, 0, W, H);
        var hue = (now / 120) % 360;
        cx.font = '800 ' + Math.round(U * .42) + 'px sans-serif';
        for (var g = 3; g >= 0; g--) { cx.globalAlpha = g ? .18 : 1; cx.fillStyle = g ? 'hsl(' + hue + ',100%,60%)' : '#fff'; cx.shadowColor = 'hsl(' + hue + ',100%,60%)'; cx.shadowBlur = g ? 0 : U * .04;
          cx.fillText(hm, W / 2 + (g ? Math.sin(g) * U * .008 * g : 0), H * .44 + (g ? g * U * .004 : 0)); }
        cx.shadowBlur = 0; cx.globalAlpha = 1;
        cx.font = '700 ' + Math.round(U * .06) + 'px monospace'; cx.fillStyle = 'hsl(' + hue + ',100%,75%)';
        cx.fillText(ap + '  ·  :' + (Math.floor(sec) < 10 ? '0' : '') + Math.floor(sec), W / 2, H * .7);
        cx.font = '600 ' + Math.round(U * .045) + 'px monospace'; cx.fillStyle = '#9fb3d9'; cx.fillText(date + (wx() ? '   ·   ' + wx() : ''), W / 2, H * .82);
      } else if (st === 'FLIP') {
        cx.fillStyle = '#0b0b0d'; cx.fillRect(0, 0, W, H);
        var digits = (h12 < 10 ? '0' : '') + h12 + (m < 10 ? '0' : '') + m;
        if (digits !== flipPrev) { flipAt = now; } var fp = Math.min(1, (now - flipAt) / 350);
        var cw = U * .26, ch = U * .4, gap = U * .025, x0 = W / 2 - (cw * 4 + gap * 3 + U * .06) / 2, y0 = H * .44 - ch / 2;
        for (var i = 0; i < 4; i++) {
          var x = x0 + i * (cw + gap) + (i >= 2 ? U * .06 : 0);
          var gr = cx.createLinearGradient(0, y0, 0, y0 + ch); gr.addColorStop(0, '#2a2a30'); gr.addColorStop(.5, '#1c1c21'); gr.addColorStop(.5, '#141418'); gr.addColorStop(1, '#202026');
          cx.fillStyle = gr; cx.beginPath(); if (cx.roundRect) cx.roundRect(x, y0, cw, ch, U * .02); else cx.rect(x, y0, cw, ch); cx.fill();
          cx.font = '700 ' + Math.round(ch * .78) + 'px sans-serif'; cx.fillStyle = '#ececf0';
          var changed = flipPrev && flipPrev[i] !== digits[i];
          cx.save(); if (changed && fp < 1) { cx.translate(0, y0 + ch / 2); cx.scale(1, Math.abs(Math.cos(fp * Math.PI))); cx.translate(0, -(y0 + ch / 2)); }
          cx.fillText(changed && fp < .5 ? flipPrev[i] : digits[i], x + cw / 2, y0 + ch / 2 + ch * .03); cx.restore();
          cx.fillStyle = '#000'; cx.fillRect(x, y0 + ch / 2 - U * .003, cw, U * .006);
        }
        if (fp >= 1) flipPrev = digits;
        cx.font = '600 ' + Math.round(U * .045) + 'px sans-serif'; cx.fillStyle = '#8a8a96'; cx.fillText(ap + '   ·   ' + date + (wx() ? '   ·   ' + wx() : ''), W / 2, H * .82);
      } else if (st === 'LUXURY') {
        var bg = cx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * .7); bg.addColorStop(0, '#1a1c22'); bg.addColorStop(1, '#050507'); cx.fillStyle = bg; cx.fillRect(0, 0, W, H);
        var R = U * .42, cxp = W / 2, cyp = H / 2;
        var bez = cx.createLinearGradient(cxp - R, cyp - R, cxp + R, cyp + R); bez.addColorStop(0, '#f6e7b0'); bez.addColorStop(.5, '#8a6a2a'); bez.addColorStop(1, '#f2d98a');
        cx.fillStyle = bez; cx.beginPath(); cx.arc(cxp, cyp, R * 1.06, 0, 6.283); cx.fill();
        var dial = cx.createRadialGradient(cxp - R * .3, cyp - R * .3, 0, cxp, cyp, R); dial.addColorStop(0, '#1e2a44'); dial.addColorStop(1, '#070b16');
        cx.fillStyle = dial; cx.beginPath(); cx.arc(cxp, cyp, R, 0, 6.283); cx.fill();
        for (var k = 0; k < 60; k++) { var a = k / 60 * 6.283 - Math.PI / 2, big = k % 5 === 0;
          cx.strokeStyle = big ? '#f2d98a' : 'rgba(255,255,255,.45)'; cx.lineWidth = big ? U * .012 : U * .003;
          cx.beginPath(); cx.moveTo(cxp + Math.cos(a) * R * (big ? .78 : .88), cyp + Math.sin(a) * R * (big ? .78 : .88)); cx.lineTo(cxp + Math.cos(a) * R * .94, cyp + Math.sin(a) * R * .94); cx.stroke(); }
        cx.font = '600 ' + Math.round(U * .035) + 'px serif'; cx.fillStyle = '#f2d98a'; cx.fillText('NEXUS', cxp, cyp - R * .38);
        cx.font = '500 ' + Math.round(U * .022) + 'px serif'; cx.fillStyle = 'rgba(242,217,138,.7)'; cx.fillText('AUTOMATIC · ' + d.getDate(), cxp, cyp + R * .42);
        function hand(ang, len, w, col) { cx.save(); cx.translate(cxp, cyp); cx.rotate(ang); cx.fillStyle = col; cx.beginPath(); cx.moveTo(-w / 2, R * .12); cx.lineTo(-w * .3, -len); cx.lineTo(0, -len - w); cx.lineTo(w * .3, -len); cx.lineTo(w / 2, R * .12); cx.closePath(); cx.fill(); cx.restore(); }
        cx.shadowColor = 'rgba(0,0,0,.6)'; cx.shadowBlur = U * .02; cx.shadowOffsetY = U * .008;
        hand(((h % 12) + m / 60) / 12 * 6.283, R * .5, U * .03, '#f2d98a');
        hand((m + sec / 60) / 60 * 6.283, R * .74, U * .022, '#f2d98a');
        hand(sec / 60 * 6.283, R * .84, U * .006, '#e64545');
        cx.shadowBlur = 0; cx.shadowOffsetY = 0;
        cx.fillStyle = '#f2d98a'; cx.beginPath(); cx.arc(cxp, cyp, U * .016, 0, 6.283); cx.fill();
        cx.font = '600 ' + Math.round(U * .035) + 'px sans-serif'; cx.fillStyle = '#9a9aa8'; cx.textAlign = 'left'; cx.fillText(date, W * .04, H * .9); cx.textAlign = 'right'; cx.fillText(wx(), W * .96, H * .9); cx.textAlign = 'center';
      } else if (st === 'HOLO RING') {
        cx.fillStyle = 'rgba(0,4,10,.35)'; cx.fillRect(0, 0, W, H);
        var R2 = U * .4, c2 = '#3dd6ff'; cx.lineCap = 'round';
        [[sec / 60, R2, U * .012, .9], [(m + sec / 60) / 60, R2 * .84, U * .02, .8], [((h % 12) + m / 60) / 12, R2 * .66, U * .028, .7]].forEach(function (r2) {
          cx.globalAlpha = .15; cx.strokeStyle = c2; cx.lineWidth = r2[2]; cx.beginPath(); cx.arc(W / 2, H / 2, r2[1], 0, 6.283); cx.stroke();
          cx.globalAlpha = r2[3]; cx.shadowColor = c2; cx.shadowBlur = U * .03; cx.beginPath(); cx.arc(W / 2, H / 2, r2[1], -Math.PI / 2, -Math.PI / 2 + r2[0] * 6.283); cx.stroke(); cx.shadowBlur = 0; });
        cx.globalAlpha = 1; cx.font = '200 ' + Math.round(U * .16) + 'px sans-serif'; cx.fillStyle = '#e8f8ff'; cx.fillText(hm, W / 2, H / 2 - U * .02);
        cx.font = '600 ' + Math.round(U * .03) + 'px monospace'; cx.fillStyle = c2; cx.fillText(ap + ' · ' + date, W / 2, H / 2 + U * .1); cx.fillText(wx(), W / 2, H / 2 + U * .15);
      } else {
        cx.fillStyle = '#060608'; cx.fillRect(0, 0, W, H);
        var lines = words(h, m), fs = Math.round(U * .12);
        cx.font = '800 ' + fs + 'px sans-serif';
        lines.forEach(function (l, i) { cx.fillStyle = i === 0 ? '#555a66' : '#fff'; cx.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * fs * 1.15 - U * .05); });
        cx.font = '600 ' + Math.round(U * .035) + 'px monospace'; cx.fillStyle = '#7d8aa8'; cx.fillText(hm + ' ' + ap + '  ·  ' + date + (wx() ? '  ·  ' + wx() : ''), W / 2, H * .88);
      }
    }, 20);
  }

  // ---------------- LIVE LYRICS: the words of the song that's playing, in time with the music ----------------
  function lyrics() {
    var b = beatTracker(), hue = beatHue(260, 40), cur = '', lines = null, plain = null, status = 'Play a song and the words show up here',
      basePos = 0, posAt = performance.now(), playing = true, dur = 0, title = '', artist = '', hasPos = false;
    function parse(lrc) { var out = []; String(lrc).split('\n').forEach(function (l) { var m = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(l.trim()); if (m) out.push([(+m[1]) * 60 + parseFloat(m[2]), m[3].trim() || '♪']); }); return out; }
    function use(j, key) {
      if (cur !== key) return true;
      if (j && j.syncedLyrics) { lines = parse(j.syncedLyrics); status = ''; return true; }
      if (j && j.plainLyrics) { plain = j.plainLyrics.split('\n').filter(function (x) { return x.trim(); }); status = ''; return true; }
      if (j && j.instrumental) { status = '♪ INSTRUMENTAL ♪'; return true; }
      return false;
    }
    function check() {
      var np = {}; try { np = JSON.parse(A ? A.nowPlaying() : '{}'); } catch (e) {}
      if (!A) { status = 'Lyrics work on the box when a song is playing'; return; }
      if (np.access === false) { status = 'Turn on Settings → ALLOW NEXUS TO SEE WHAT\'S PLAYING'; return; }
      var t = np.title && np.title !== 'null' ? np.title : '', ar = np.artist && np.artist !== 'null' ? np.artist : '';
      if (typeof np.pos === 'number' && np.pos >= 0) { basePos = np.pos / 1000; posAt = performance.now(); hasPos = true; }
      playing = np.playing !== false; if (np.dur > 0) dur = np.dur / 1000;
      if (!t) { if (!cur) status = 'Play a song and the words show up here'; return; }
      var key = t + '|' + ar; if (key === cur) return;
      cur = key; title = t; artist = ar; lines = null; plain = null; status = 'Finding the words…';
      if (!hasPos) { basePos = 0; posAt = performance.now(); }
      var clean = t.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s+-\s+.*$/, '').trim();
      N.http('GET', 'https://lrclib.net/api/get?artist_name=' + encodeURIComponent(ar) + '&track_name=' + encodeURIComponent(clean)).then(function (r) {
        var j = null; try { j = JSON.parse(r.text); } catch (e) {}
        if (r.status === 200 && use(j, key)) return;
        return N.http('GET', 'https://lrclib.net/api/search?q=' + encodeURIComponent(ar + ' ' + clean)).then(function (r2) {
          var arr = []; try { arr = JSON.parse(r2.text) || []; } catch (e) {}
          var best = null; for (var i = 0; i < arr.length; i++) { if (arr[i].syncedLyrics) { best = arr[i]; break; } if (!best && arr[i].plainLyrics) best = arr[i]; }
          if (!use(best, key) && cur === key) status = r2.status === 200 ? 'No words found for this one' : 'Can\'t reach the lyrics service right now';
        });
      });
    }
    function wrap(txt, maxW) { var words = txt.split(' '), out = [], line = ''; words.forEach(function (w) { var t2 = line ? line + ' ' + w : w; if (cx.measureText(t2).width > maxW && line) { out.push(line); line = w; } else line = t2; }); if (line) out.push(line); return out; }
    check(); every(check, 2000);
    text('xpTop', 'LIVE LYRICS');
    loop(function (now) {
      var p = b.tick(now), hh = hue.tick(b.hit), U = Math.min(W, H), t = now / 1000;
      var g = cx.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'hsl(' + hh + ',70%,' + (7 + p * 5) + '%)'); g.addColorStop(1, 'hsl(' + ((hh + 70) % 360) + ',80%,' + (4 + p * 3) + '%)');
      cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over'; cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      cx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 3; i++) { var bx = W * (.5 + .4 * Math.sin(t * .13 + i * 2.1)), by = H * (.5 + .35 * Math.cos(t * .17 + i * 1.7)), br = U * (.5 + p * .15);
        var rg = cx.createRadialGradient(bx, by, 0, bx, by, br); rg.addColorStop(0, 'hsla(' + ((hh + i * 60) % 360) + ',100%,50%,.16)'); rg.addColorStop(1, 'hsla(0,0%,0%,0)'); cx.fillStyle = rg; cx.fillRect(0, 0, W, H); }
      cx.globalCompositeOperation = 'source-over'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.font = '600 ' + Math.round(U * .035) + 'px monospace'; cx.fillStyle = 'rgba(255,255,255,.55)';
      if (title) cx.fillText((title + (artist ? '  ·  ' + artist : '')).toUpperCase().slice(0, 60), W / 2, H * .1);
      var pos = basePos + (playing ? (now - posAt) / 1000 : 0);
      if (status || (!lines && !plain)) { cx.font = '600 ' + Math.round(U * .06) + 'px sans-serif'; cx.fillStyle = '#cfe0ff'; wrap(status, W * .8).forEach(function (l, k) { cx.fillText(l, W / 2, H / 2 + k * U * .08); }); return; }
      var list, idx, frac = 0;
      if (lines) { list = lines.map(function (l) { return l[1]; }); idx = -1; for (var k = 0; k < lines.length; k++) { if (lines[k][0] <= pos + .25) idx = k; else break; }
        if (idx >= 0) frac = Math.min(1, (pos + .25 - lines[idx][0]) / .35); }
      else { list = plain; var prog = dur > 0 ? pos / dur : pos / 210; idx = Math.max(0, Math.min(list.length - 1, Math.floor(prog * list.length))); frac = 1; }
      var big = Math.round(U * .105), small = Math.round(U * .05), y = H * .5;
      cx.font = '800 ' + big + 'px sans-serif';
      var curLines = idx >= 0 ? wrap(list[idx], W * .86) : ['♪'], bh = curLines.length * big * 1.15;
      cx.shadowColor = 'hsl(' + hh + ',100%,60%)'; cx.shadowBlur = U * .04 * (1 + p); cx.fillStyle = '#fff'; cx.globalAlpha = .35 + .65 * frac;
      curLines.forEach(function (l, k) { cx.fillText(l, W / 2, y - bh / 2 + big * .58 + k * big * 1.15 + (1 - frac) * U * .02); });
      cx.shadowBlur = 0; cx.font = '600 ' + small + 'px sans-serif';
      for (var d = 1; d <= 2; d++) {
        cx.globalAlpha = d === 1 ? .5 : .25;
        if (idx - d >= 0) cx.fillText(wrap(list[idx - d], W * .86)[0], W / 2, y - bh / 2 - d * small * 1.6);
        if (idx + d < list.length) cx.fillText(wrap(list[idx + d], W * .86)[0], W / 2, y + bh / 2 + d * small * 1.6);
      }
      cx.globalAlpha = 1;
      if (!lines && plain) { cx.font = '600 ' + Math.round(U * .028) + 'px monospace'; cx.fillStyle = 'rgba(255,255,255,.4)'; cx.fillText('THESE WORDS AREN\'T TIMED TO THE SONG', W / 2, H * .93); }
    }, 30);
  }
})();
