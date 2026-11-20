/* NEXUS experiences: Hologram, Clock, Lyrics, Webcams, Liquid Dreams and the five Visuals
   (Fire Tornado, Blue Fire, Hollow Head, Cyber Eye, Wormhole).
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
  var running = null, raf = 0, timers = [], last = 0, xpDom = [];
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
  var glc = null, gl = null, GLX = 1.25, glBuf = null, glProgs = {};
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
    if (VX_ORDER.indexOf(name) >= 0) { atmosphereProfile = null; atmosphereParticles = []; if (atmosphereCtx) atmosphereCtx.clearRect(0, 0, atmosphereCanvas.width, atmosphereCanvas.height); return; }
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
    ensureGl();
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
  // Creates the shared WebGL canvas and context once (without showing it).
  function ensureGl() {
    if (!glc) {
      glc = document.createElement('canvas');
      glc.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none';
      cv.parentNode.insertBefore(glc, cv.nextSibling);
      try { gl = glc.getContext('webgl', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }) || glc.getContext('experimental-webgl'); } catch (e) { gl = null; }
      if (gl) {
        glBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      }
    }
    return gl;
  }
  function glStop() { if (glc) glc.style.display = 'none'; cv.style.visibility = ''; }
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function every(fn, ms) { var t = setInterval(fn, ms); timers.push(t); return t; }
  function text(id, v) { $(id).innerHTML = v || ''; }
  function loop(draw, fps, minFps) {
    var gap = 1000 / (fps || 30);
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
uniform float gravStr, gravSpin, touchHue, spectral, spectralO, colorPhase, energyL;
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
 pal0=mix(palO0,palN0,wv);pal1=mix(palO1,palN1,wv);pal2=mix(palO2,palN2,wv);pal3=mix(palO3,palN3,wv);SPEC=mix(spectralO,spectral,wv);
 vec3 col=envLD(envA,p,t);
 if(envMix>.001){vec3 other=envLD(envB,p,t);float n=fbmLD(uv*1.6+vec2(7.1,3.3)+t*.02,3.);col=mix(col,other,smoothstep(n-.14,n+.14,envMix*1.3-.15));}
 // a soft band of light rides the colour front
 col+=mix(pal2,vec3(1.),.3)*front*.2;
 // funnel: a dark core with a lensed rim of light around the gravity point
 col*=1.-clamp(gravStr,0.,1.)*.75*exp(-r*r*90.);
 col+=rampLD(.97)*clamp(gravStr,0.,1.)*exp(-pow((r-.06)/.011,2.))*.32;
 col*=1.+energyL*.12;
 // colour finish: vibrance and a filmic curve that keeps neon saturated and lifts dark detail
 float lum=dot(col,vec3(.299,.587,.114));
 col=max(mix(vec3(lum),col,1.32),0.);
 col*=brightness*1.38;
 col=clamp(col*(2.51*col+.03)/(col*(2.43*col+.59)+.14),0.,1.);
 col=pow(col,vec3(.9));
 col*=.66+.34*smoothstep(1.35,.25,length(uv*vec2(.9,1.)));
 col+=(hash(gl_FragCoord.xy+fract(t*7.))-.5)*(1.5/255.);
 gl_FragColor=vec4(clamp(col,0.,1.),1.);
}
`;

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

    var ldGpu = null, ldGpuTried = false, ldGpuActive = false, oldGLX = GLX, firstFrame = false, frames = 0;
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
    function activateDreamShader() {
      if (!ldGpuTried) {
        ldGpuTried = true;
        if (glc) { glc.style.opacity = '0'; glc.style.transition = 'opacity .7s ease'; }
        ldGpu = glStart('liquid-dreams-environments', LIQUID_DREAMS_SHADER); ldGpuActive = !!ldGpu;
        if (glc) { glc.style.opacity = '0'; glc.style.transition = 'opacity .7s ease'; }
      } else if (ldGpu && !ldGpuActive) { ldGpu = glStart('liquid-dreams-environments', LIQUID_DREAMS_SHADER); ldGpuActive = !!ldGpu; }
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
        audio: { bass: sBass, mid: sMid, high: sHigh, energy: sEnergy, beat: beatHit }, react: { bass: lastLevels[0], mid: lastLevels[1], high: lastLevels[2], energy: lastLevels[3] },
        play: { visual: { on: play.visual.on, secs: play.visual.secs, dueIn: visualDueAt ? visualDueAt - performance.now() : null }, color: { on: play.color.on, secs: play.color.secs, dueIn: colorDueAt ? colorDueAt - performance.now() : null } } };
    };
    function draw(now) {
      if (!alive || !XP.active || XP.current !== 'liquiddreams') return;
      var dt = Math.min(80, Math.max(0, now - lastT)); lastT = now;
      var sec = dt / 1000;
      b.tick(now);
      var low = state.lowMotion, live = b.live;
      // Bass drives the large forms, midrange the flow, treble the fine highlights, and the overall
      // beat energy the movement and colour flow. Each band is smoothed so the response is fluid.
      // Bass and overall energy are driven mainly off absolute (not peak-relative) levels, so a
      // genuinely quiet, unvarying passage reads as calm instead of drifting louder over time.
      sBass = ease(sBass, live ? Math.min(1.2, Math.max(b.bass, b.k * .8)) : 0, dt, 110, 600);
      sMid = ease(sMid, live ? Math.min(1.2, b.mid) : 0, dt, 220, 900);
      sHigh = ease(sHigh, live ? Math.min(1.2, b.high) : 0, dt, 70, 380);
      sEnergy = ease(sEnergy, live ? Math.min(1.2, b.level) : 0, dt, 250, 1400);
      // Music reactivity is always on: sensitivity can be tuned but never switched off, in every experience and palette.
      if (live && b.hit) beatHit = Math.min(1, beatHit + .55 + Math.min(1, b.k) * .45);
      beatHit *= Math.exp(-dt / 260);
      var react = Math.max(LD_RANGES.audio[0], state.audio) * (low ? .35 : 1);
      var bassL = Math.min(1, (sBass + beatHit * .35) * react * state.bass * 1.6), midL = Math.min(1, sMid * react * 1.5), highL = Math.min(1, sHigh * react * 1.6), energyL = Math.min(1, (sEnergy + beatHit * .2) * react * 1.3);
      lastLevels = [bassL, midL, highL, energyL];
      speedNow = ease(speedNow, state.speed * (low ? .4 : 1), dt, 600, 600);
      moveNow = ease(moveNow, state.movement * (low ? .45 : 1), dt, 600, 600);
      flow += sec * speedNow * (1 + midL * .5 + energyL * .4);
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
        var mixEased = envMix * envMix * (3 - 2 * envMix), aspect = W / H;
        dream.f('envA', envFrom); dream.f('envB', envTo); dream.f('envMix', envFrom === envTo ? 0 : mixEased);
        dream.f('flowT', flow); dream.f('bassL', bassL); dream.f('midL', midL); dream.f('highL', highL); dream.f('energyL', energyL);
        dream.f('moveAmt', moveNow * .6 * (1 + energyL * .35 + beatHit * .25 * (low ? .4 : 1))); dream.f('detailAmt', detail); dream.f('complexity', complexity);
        dream.f('brightness', state.brightness); dream.f('quality', HIGH_MEMORY_DEVICE ? 1 : 0);
        var old = wave ? wave.from : palette;
        dream.v3('palN0', palette[0]); dream.v3('palN1', palette[1]); dream.v3('palN2', palette[2]); dream.v3('palN3', palette[3]);
        dream.v3('palO0', old[0]); dream.v3('palO1', old[1]); dream.v3('palO2', old[2]); dream.v3('palO3', old[3]);
        dream.f('spectral', spectralNow); dream.f('spectralO', wave ? wave.fromS : spectralNow);
        dream.v4a('colorWave', wave ? [wave.x, wave.y, wave.r, 1] : [0, 0, 0, 0]); dream.f('colorPhase', colorPhase); dream.f('touchHue', touchHueShift);
        dream.v2('gravPos', (grav.x - .5) * aspect, .5 - grav.y); dream.f('gravStr', grav.s); dream.f('gravSpin', grav.spin);
        dream.draw(now, null, 0);
        frames++;
        if (!firstFrame) { firstFrame = true; requestAnimationFrame(function () { if (glc && alive) glc.style.opacity = '1'; }); }
      } else drawFallback(flow, bassL, highL, state.brightness);
      if (frames % 30 === 1) paintBackdrop();
    }
    loop(draw, 30);
  }

  // ==================================================================
  // NEXUS VISUALS · FIVE EXPERIENCES
  // Fire Tornado, Blue Fire, Hollow Head, Cyber Eye and Wormhole share one
  // WebGL context, one smoothed music model and one lifecycle. Shader programs
  // and the head mesh stay cached while switching and are released on exit.
  // ==================================================================
  var VX_ORDER = ['firetornado', 'bluefire', 'hollowhead', 'cybereye', 'wormhole'];
  var VX_NAMES = { firetornado: 'Fire Tornado', bluefire: 'Blue Fire', hollowhead: 'Hollow Head', cybereye: 'Cyber Eye', wormhole: 'Wormhole' };
  var VX_SRC = { firetornado: [
    "uniform float T, rot, bass, mid, high, beat, quality, surge;",
    "float fbm4(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){if(float(i)>=4.+quality)break;v+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return v;}",
    "float ridge(vec2 p){float v=0.,a=.55;for(int i=0;i<4;i++){float n=1.-abs(noise(p)*2.-1.);v+=a*n*n;p=mat2(1.7,1.1,-1.1,1.7)*p+vec2(1.3,7.1);a*=.5;}return v;}",
    "vec3 fire(float t){t=clamp(t,0.,1.6);",
    " vec3 c=mix(vec3(.05,.0,.0),vec3(.55,.04,.01),smoothstep(0.,.25,t));",
    " c=mix(c,vec3(.95,.25,.02),smoothstep(.2,.5,t));c=mix(c,vec3(1.,.55,.08),smoothstep(.45,.75,t));",
    " c=mix(c,vec3(1.,.82,.3),smoothstep(.7,1.,t));return mix(c,vec3(1.,.97,.85),smoothstep(.95,1.4,t));}",
    "float colX(float y,float t){return .035*sin(y*2.6+t*.37)+.025*sin(y*6.1-t*.73)+.012*sin(y*13.-t*1.6)*(.5+mid);}",
    "float colR(float y){float k=smoothstep(-.46,.42,y);return (.035+.36*pow(k,1.7))*(1.+bass*.22+beat*.12+surge*.15);}",
    "float vortex(vec2 p,float t,float layerR,float spin,float twist,float thr,out float zf){",
    " float y=p.y,R=colR(y)*layerR,dx=(p.x-colX(y,t))/R;zf=0.;",
    " if(abs(dx)>1.2)return 0.;",
    " float a=asin(clamp(dx,-1.,1.)),z=sqrt(max(0.,1.-dx*dx));zf=z;",
    " float u=a+rot*spin-y*twist*(1.+mid*.35);",
    " vec2 q=vec2(u*1.6,y*7.-t*(1.1+bass*.7));",
    " vec2 w=vec2(fbm4(q*.7+vec2(0.,t*.1)),fbm4(q*.7+vec2(5.2,t*.13)));",
    " float body=fbm4(q*vec2(1.,.55)+w*1.8);",
    " float licks=ridge(q*vec2(1.4,.8)+w*2.2+vec2(0.,-t*.6));",
    " float bk=fbm4(vec2((a+3.14159-rot*spin*.8+y*twist)*1.6,y*7.-t)+w);",
    " float edge=smoothstep(1.2,.7,abs(dx)+ (body-.5)*.5);",
    " float d=(smoothstep(thr,thr+.3,body)*.75+smoothstep(.55,.95,licks)*.55)*(.35+.65*z)+smoothstep(thr,thr+.35,bk)*.3*(1.-z);",
    " return d*edge;",
    "}",
    "void main(){",
    " vec2 p=(gl_FragCoord.xy-.5*res)/res.y;float t=T;",
    " // heat haze near the column",
    " float heatD=abs(p.x-colX(p.y,t))/max(colR(p.y),.03);",
    " float heat=exp(-max(heatD-1.,0.)*1.6)*smoothstep(.55,-.4,p.y);",
    " vec2 hz=vec2(noise(p*14.+vec2(0.,-t*3.))-.5,noise(p*14.+vec2(7.,-t*2.6))-.5)*.016*heat*(1.+bass);",
    " vec2 pb=p+hz;",
    " // sky: smoky storm clouds lit from below",
    " float cl=fbm4(pb*vec2(2.2,3.)+vec2(t*.03,0.)+fbm4(pb*3.-t*.02)*.6);",
    " vec3 col=mix(vec3(.012,.004,.006),vec3(.09,.02,.012),smoothstep(.5,-.4,pb.y));",
    " col+=fire(.25+cl*.35)*pow(cl,2.)*(.35+.3*exp(-abs(pb.x)*2.))*smoothstep(.6,-.1,pb.y)*.9;",
    " col+=vec3(.6,.15,.02)*exp(-length(pb-vec2(colX(.38,t),.36))*2.8)*.35;",
    " // mountains silhouette lit by fire",
    " float ridgeY=-.3+.13*fbm4(vec2(pb.x*3.,1.))*smoothstep(.0,.6,abs(pb.x))+ .05*noise(vec2(pb.x*14.,3.));",
    " float mnt=smoothstep(ridgeY+.004,ridgeY-.004,pb.y);",
    " vec3 rock=vec3(.025,.012,.01)+fire(.35)*.12*smoothstep(ridgeY-.12,ridgeY,pb.y)*exp(-abs(pb.x)*1.4)*(1.+beat*.4);",
    " col=mix(col,rock,mnt*smoothstep(-.42,-.3,pb.y));",
    " // ground: molten plain",
    " float gy=-.42;",
    " if(pb.y<gy+.02){float g=fbm4(vec2(pb.x*6.,(pb.y-gy)*40.-t*.2));vec3 lava=fire(.35+g*.6)*(1.-smoothstep(gy,gy-.12,pb.y)*.5);",
    "  col=mix(col,lava*(.55+.45*exp(-abs(pb.x)*1.6))*(1.+bass*.5),smoothstep(gy+.02,gy-.01,pb.y));}",
    " // turbulent base fire",
    " float by=pb.y-gy;float bw=exp(-pow(pb.x/(.55+bass*.15),2.));",
    " float bf=fbm4(vec2(pb.x*7.,by*5.-t*2.2)+fbm4(vec2(pb.x*4.,by*3.-t))*1.2);",
    " float tongues=ridge(vec2(pb.x*9.,by*4.-t*2.6)+bf*1.5);",
    " float base=(bf*.9+tongues*.6)*bw-by*4.2-.12;",
    " col+=fire(base*1.25)*smoothstep(0.,.45,base)*(.85+beat*.35);",
    " // outer spiral flames, then the core vortex",
    " float z1,z2;",
    " float outer=vortex(p+hz*.5,t*.8,1.45+mid*.12,.55,7.,.55,z1);",
    " float core=vortex(p,t,1.,1.,11.,.42,z2);",
    " float shade=.55+.45*sin(asin(clamp((p.x-colX(p.y,t))/colR(p.y),-1.,1.))+1.);",
    " col=col*(1.-outer*.5)+fire(outer*.9)*outer*.75*(.5+.5*z1);",
    " col=col*(1.-clamp(core,0.,1.)*.8)+fire(core*(.85+z2*.3)+beat*.12+surge*.15)*core*(.75+.45*shade);",
    " col+=vec3(1.,.85,.55)*pow(z2,8.)*smoothstep(.5,1.,core)*(.15+bass*.45)*smoothstep(.45,-.3,p.y);",
    " // upper canopy: wide rotating fire shelf",
    " vec2 cc=vec2(colX(.36,t),.36);vec2 cd=(p-cc)*vec2(1.,2.8);float cr=length(cd),ca=atan(cd.y,cd.x);",
    " float canR=.62+bass*.12+beat*.06;",
    " if(cr<canR*1.2){",
    "  float sw=ridge(vec2(ca*2.+rot*.35+cr*4.,cr*6.-t*.4)+fbm4(vec2(ca*1.5-rot*.3,cr*3.))*1.4);",
    "  float cm=smoothstep(canR,canR*.3,cr)*smoothstep(.0,.15,cr)*smoothstep(.2,.3,p.y+.05);",
    "  float cf=smoothstep(.45,.9,sw)*cm;",
    "  col=col*(1.-cf*.6)+fire(cf*1.2)*cf*.95;",
    " }",
    " // embers and breakaway sparks swirling round the vortex",
    " for(int L=0;L<3;L++){float fl=float(L);float sc=18.+fl*14.;",
    "  vec2 ep=p;ep.x+=sin(ep.y*4.+t*(.7+fl*.2)+fl)*.06*(1.+mid);",
    "  vec2 g=ep*sc+vec2(rot*(.8+fl*.4)*sc*.05,-t*(1.2+fl*.5+bass)*sc*.06);",
    "  vec2 id=floor(g);float h=hash(id+fl*13.);vec2 f=fract(g)-.5-(vec2(hash(id+3.1),hash(id+7.7))-.5)*.6;",
    "  float life=fract(h*7.+t*.25*(1.+fl*.3));",
    "  float s=step(.86-high*.08,h)*smoothstep(.12,0.,length(f))*smoothstep(1.,.6,life)*(.6+high);",
    "  col+=fire(1.+fl*.1)*s*exp(-pow((p.x-colX(p.y,t))/(colR(p.y)*2.2+.05),2.))*1.3;",
    " }",
    " // tone & vignette",
    " col*=.75+.25*smoothstep(1.2,.2,length(p*vec2(.8,1.)));",
    " col=col*(2.51*col+.03)/(col*(2.43*col+.59)+.14);",
    " gl_FragColor=vec4(pow(clamp(col,0.,1.),vec3(.95)),1.);",
    "}"
  ].join('\n'), bluefire: [
    "uniform float T, bass, mid, high, beat, quality, surge;",
    "uniform vec4 forms[7];   // x, height, sway phase, speed",
    "uniform vec4 arc;        // x1, x2, life(0..1), seed",
    "float fbmB(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){if(float(i)>=4.+quality)break;v+=a*noise(p);p=mat2(1.7,1.1,-1.1,1.7)*p+vec2(2.3,5.9);a*=.5;}return v;}",
    "vec3 plasma(float t,float hueShift){t=clamp(t,0.,1.7);",
    " vec3 c=mix(vec3(.0,.0,.02),vec3(.03,.06,.42),smoothstep(0.,.25,t));",
    " c=mix(c,mix(vec3(.05,.3,1.),vec3(.45,.12,1.),hueShift),smoothstep(.2,.55,t));",
    " c=mix(c,mix(vec3(.15,.75,1.),vec3(.75,.45,1.),hueShift*.6),smoothstep(.5,.85,t));",
    " return mix(c,vec3(.85,.97,1.),smoothstep(.85,1.35,t));}",
    "float formHeight(float x,out float hs){float h=0.;hs=0.;",
    " for(int i=0;i<7;i++){vec4 f=forms[i];float g=exp(-pow((x-f.x)/(.06+f.y*.05),2.));h=max(h,g*f.y);hs+=g*f.z;}",
    " return h;}",
    "float flameAt(vec2 p,float t,out float veins,out float hs){",
    " float y=p.y+.5;",
    " float h=formHeight(p.x+.03*sin(p.y*5.+t*.7)*(1.+mid),hs)*(1.+bass*.35+beat*.2+surge*.25);",
    " vec2 q=vec2(p.x*3.2,y*2.3-t*(1.25+bass*.5));",
    " vec2 w=vec2(fbmB(q+vec2(0.,t*.2)),fbmB(q+vec2(4.3,t*.27)));",
    " q+=w*(1.1+mid*.8);",
    " float n=fbmB(q*vec2(1.,.75));",
    " float flick=noise(vec2(p.x*22.,y*9.-t*7.))*.18*(.5+high);",
    " float d=n*1.25+flick-y/(h*.78+.05)-.08;",
    " // internal plasma veins travel upward",
    " float r1=1.-abs(fbmB(q*1.7+vec2(0.,-t*1.6))*2.-1.);",
    " veins=pow(r1,9.)*smoothstep(.0,.35,d);",
    " return d;",
    "}",
    "void main(){",
    " vec2 p=(gl_FragCoord.xy-.5*res)/res.y;float t=T;",
    " vec3 col=mix(vec3(.0,.004,.02),vec3(.01,.02,.07),smoothstep(-.5,.5,p.y));",
    " // deep space dust and faint stars",
    " float neb=fbmB(p*2.2+vec2(t*.01,0.));col+=vec3(.05,.03,.18)*pow(neb,3.)*1.4;",
    " vec2 sg=p*90.;vec2 sid=floor(sg);float sh=hash(sid);col+=vec3(.6,.75,1.)*step(.993,sh)*smoothstep(.35,.0,length(fract(sg)-.5))*(.4+.6*sin(t*2.+sh*40.)*.5+.5*high);",
    " float veins,hs;",
    " float d=flameAt(p,t,veins,hs);",
    " float hue=.5+.5*sin(p.y*4.-t*1.3+p.x*3.+hs*2.);           // purple/cyan highlights travel through bright areas",
    " float body=smoothstep(.0,.9,d);",
    " vec3 fl=plasma(d*1.05+beat*.1,hue*smoothstep(.2,.9,d)*.8)*body;",
    " // pulses of energy climbing through the flame layers",
    " float pulse=pow(.5+.5*sin((p.y+.5)*14.-t*5.-hs*3.),6.)*smoothstep(.2,.8,d)*(.25+beat*.6+bass*.3);",
    " fl+=vec3(.4,.8,1.)*pulse*.5;",
    " fl+=mix(vec3(.4,.9,1.),vec3(.85,.6,1.),hue)*veins*(.9+high*.8+beat*.4);",
    " // glow halo",
    " col+=vec3(.04,.12,.6)*smoothstep(-.7,.1,d)*.28*(1.+bass*.5);",
    " col=col*(1.-body*.7)+fl;",
    " // dissolving tips -> rising particles",
    " for(int L=0;L<2;L++){float fl2=float(L);float sc=26.+fl2*18.;",
    "  vec2 g=vec2(p.x*sc+sin(p.y*6.+t+fl2)*1.5,(p.y+.5)*sc-t*(2.+fl2+bass*1.5)*sc*.08);",
    "  vec2 id=floor(g);float h=hash(id+fl2*9.);vec2 f=fract(g)-.5;",
    "  float near=smoothstep(-.9,-.1,d)*smoothstep(.6,-.2,d);",
    "  col+=mix(vec3(.4,.85,1.),vec3(.8,.6,1.),hash(id+2.))*step(.8-high*.1,h)*smoothstep(.16,0.,length(f))*near*(.8+high);",
    " }",
    " // fine electrical sparks with treble",
    " vec2 eg=p*vec2(40.,40.)+vec2(0.,-t*8.);vec2 eid=floor(eg);float eh=hash(eid);",
    " vec2 ef=fract(eg)-.5;float spark=step(.97-high*.04,eh)*smoothstep(.06,0.,abs(ef.x+ef.y*.6))*smoothstep(.5,.1,abs(ef.y));",
    " col+=vec3(.7,.9,1.)*spark*smoothstep(-.4,.3,d)*(.4+high*1.5);",
    " // energy arc leaping between neighbouring formations",
    " if(arc.z>0.){",
    "  vec2 a1=vec2(arc.x,-.5+formHeight(arc.x,hs)*.75),a2=vec2(arc.y,-.5+formHeight(arc.y,hs)*.75);",
    "  vec2 ab=a2-a1;float k=clamp(dot(p-a1,ab)/dot(ab,ab),0.,1.);",
    "  vec2 cp=a1+ab*k+vec2(0.,sin(k*3.14159)*.12);",
    "  float jag=(noise(vec2(k*18.,t*14.+arc.w))-.5)*.05+(noise(vec2(k*40.,t*20.))-.5)*.018;",
    "  float dd=abs(p.y-cp.y-jag),inx=step(min(a1.x,a2.x),p.x)*step(p.x,max(a1.x,a2.x));",
    "  float life=sin(arc.z*3.14159);",
    "  col+=vec3(.65,.85,1.)*(exp(-dd*260.)+exp(-dd*35.)*.22)*life*inx*(1.+high);",
    " }",
    " // floor reflection",
    " col+=vec3(.05,.2,.8)*exp(-abs(p.y+.5)*30.)*smoothstep(.0,.6,formHeight(p.x,hs))*(.5+bass);",
    " col*=.8+.2*smoothstep(1.2,.3,length(p));",
    " col=col*(2.51*col+.03)/(col*(2.43*col+.59)+.14);",
    " gl_FragColor=vec4(clamp(col,0.,1.),1.);",
    "}"
  ].join('\n'), cybereye: [
    "uniform float T, bass, mid, high, beat, quality;",
    "uniform float lid, pupil, apert, radial, scan, arcT;",
    "uniform vec2 gaze;",
    "uniform vec4 rings;    // rotation of four iris rings",
    "uniform vec4 segs;     // segment opening per ring band",
    "float fbmE(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return v;}",
    "vec2 rot2(vec2 p,float a){return mat2(cos(a),-sin(a),sin(a),cos(a))*p;}",
    "float circuit(vec2 p,float t){",
    " vec2 g=p*14.;vec2 id=floor(g),f=fract(g);float h=hash(id);",
    " float tr=h<.5?min(abs(f.x-.5),1.):min(abs(f.y-.5),1.);",
    " float line=smoothstep(.06,.0,tr)*step(.35,hash(id+3.));",
    " float node=smoothstep(.13,.07,length(f-.5))*step(.82,h);",
    " float flow=pow(fract((h<.5?f.y:f.x)+t*(.4+h)+h*5.),12.);",
    " return line*(.25+flow*1.2)+node*.8;",
    "}",
    "void main(){",
    " vec2 p=(gl_FragCoord.xy-.5*res)/res.y;float t=T;",
    " vec2 e=p;                      // eye space",
    " float W=.62,Hh=.30;            // almond half-width / half-height",
    " // ---- background: dark technological framework with radiating structures",
    " float pr=length(p*vec2(.62,1.)),pa=atan(p.y,p.x);",
    " vec3 col=vec3(.004,.006,.02)+vec3(.02,.03,.09)*smoothstep(1.1,.2,pr);",
    " float rays=pow(.5+.5*sin(pa*48.+fbmE(vec2(pa*6.,1.))*6.),8.)*smoothstep(.5,.75,pr);",
    " float rays2=pow(noise(vec2(pa*40.,pr*3.-t*.6)),6.)*smoothstep(.45,.9,pr);",
    " col+=mix(vec3(.1,.35,1.),vec3(.7,.2,1.),.5+.5*sin(pa*3.+t*.2))*(rays*.25+rays2*1.4)*(.6+high*.8);",
    " col+=vec3(.15,.55,1.)*circuit(p*1.2+vec2(t*.01,0.),t)*.22*smoothstep(.5,1.,pr)*(.6+high);",
    " // housing plates around the eye",
    " vec2 hp=e/vec2(W*1.28,Hh*1.75);float hr=length(hp);",
    " float plate=smoothstep(1.02,.98,hr)*smoothstep(.72,.76,hr);",
    " float grooves=pow(.5+.5*sin(atan(hp.y,hp.x)*36.),20.);",
    " col=mix(col,vec3(.03,.035,.06)+vec3(.1,.3,.8)*grooves*.25,plate*.9);",
    " col+=vec3(.3,.7,1.)*exp(-abs(hr-1.)*90.)*.6+vec3(.7,.3,1.)*exp(-abs(hr-.74)*120.)*.5;",
    " // ---- eye opening with lids",
    " float nx=e.x/W;float open=max(0.,1.-nx*nx);",
    " float topY=Hh*pow(open,.62)*(1.-lid)+(-.02)*lid*open;",
    " float botY=-Hh*.82*pow(open,.7)*(1.-lid)+(-.02)*lid*open;",
    " float inside=smoothstep(.004,-.004,e.y-topY)*smoothstep(-.004,.004,e.y-botY)*step(abs(nx),1.);",
    " // lids: metallic layered plates with glowing edge lines",
    " float lidEdgeT=exp(-abs(e.y-topY)*160.),lidEdgeB=exp(-abs(e.y-botY)*160.);",
    " float onLid=smoothstep(.75,.73,hr)*(1.-inside);",
    " float lidD=e.y>topY?(e.y-topY)/max(Hh*1.75*sqrt(max(0.,1.-pow(e.x/(W*1.28),2.)))*.74-topY,.01):(botY-e.y)/max(botY+Hh*1.75*sqrt(max(0.,1.-pow(e.x/(W*1.28),2.)))*.74,.01);",
    " float lines=pow(.5+.5*sin(lidD*28.),14.)*(1.-lidD*.6);",
    " vec3 lidCol=vec3(.03,.035,.07)*(1.2-lidD)+vec3(.15,.45,1.)*lines*.3+vec3(.6,.3,1.)*pow(.5+.5*sin(e.x*60.+lidD*8.),30.)*.12;",
    " col=mix(col,lidCol,onLid);",
    " col+=(vec3(.4,.85,1.)*lidEdgeT+vec3(.75,.4,1.)*lidEdgeB)*step(abs(nx),1.)*(.8+high*.6);",
    " if(inside>0.){",
    "  // sclera: dark glassy dome with circuitry veins",
    "  vec2 sp=e/vec2(W,Hh*1.2);float dome=sqrt(max(0.,1.-dot(sp,sp)*.6));",
    "  vec3 scl=mix(vec3(.08,.12,.3),vec3(.32,.42,.7),dome*dome)*dome+vec3(.2,.5,1.)*circuit(e*1.6+gaze*.3,t)*.35*(.5+high);",
    "  float vein=pow(1.-abs(fbmE(e*7.)*2.-1.),14.);scl+=vec3(.6,.3,1.)*vein*.5;",
    "  scl*=.55+.45*smoothstep(.0,.2,min(e.y-botY,topY-e.y)); // shadow under lids",
    "  vec3 ec=scl;",
    "  // ---- iris",
    "  vec2 ic=e-gaze;float r=length(ic),a=atan(ic.y,ic.x);",
    "  float RI=.25,RP=RI*mix(.12,.62,pupil);",
    "  if(r<RI*1.08){",
    "   float u=(r-RP)/(RI-RP);",
    "   vec3 ir=vec3(.01,.02,.08);",
    "   // four independently rotating ring bands",
    "   for(int k=0;k<4;k++){float fk=float(k);",
    "    float r0=.0+fk*.25,r1=r0+.25;float band=smoothstep(r0,r0+.02,u)*smoothstep(r1,r1-.02,u);",
    "    float rr=k==0?rings.x:k==1?rings.y:k==2?rings.z:rings.w;",
    "    float sg=k==0?segs.x:k==1?segs.y:k==2?segs.z:segs.w;",
    "    float aa=a+rr;float nSeg=12.+fk*6.;",
    "    float segF=fract(aa*nSeg/6.28318);",
    "    float gap=smoothstep(.0,.04,segF)*smoothstep(1.,.96-sg*.35,segF);",
    "    float fib=pow(.5+.5*sin(aa*(70.+fk*30.)+fbmE(vec2(aa*4.,u*6.))*4.),3.);",
    "    vec3 bc=mix(vec3(.05,.45,1.),vec3(.15,.95,1.),fk/3.);bc=mix(bc,vec3(.6,.25,1.),.35*sin(aa*2.+t*.5)+.35);",
    "    ir+=bc*band*gap*(.25+fib*.9)*(1.1-fk*.12);",
    "    ir+=vec3(.7,.95,1.)*band*smoothstep(.97,1.,segF)*.4;",
    "   }",
    "   // radial structures expand outward / contract inward",
    "   float spokes=pow(.5+.5*sin(a*24.+rings.y),14.)*smoothstep(radial*.9,radial*.9-.25,u);",
    "   ir+=vec3(.5,.9,1.)*spokes*.8;",
    "   // energy travelling round the iris",
    "   float orbit=exp(-pow(mod(a-t*1.4*(1.+mid)+3.14159,6.28318)-3.14159,2.)*6.)*exp(-pow((u-.85)*10.,2.));",
    "   ir+=vec3(.9,.6,1.)*orbit*1.2;",
    "   ir+=vec3(.3,.8,1.)*exp(-pow((u-1.)*28.,2.))*1.2+vec3(.4,.9,1.)*exp(-pow(u*24.,2.))*.8;",
    "   // pupil: deep lens with inner illuminated components",
    "   float pm=smoothstep(RP+.004,RP-.004,r);",
    "   vec3 pc=vec3(.0,.0,.012)+vec3(.15,.4,1.)*exp(-pow((r-RP*.55)/(RP*.08+.002),2.))*.45+vec3(.8,.4,1.)*exp(-r/(RP*.25+.002))*.15*(1.+bass);",
    "   ir=mix(ir,pc,pm);",
    "   // mechanical aperture blades",
    "   if(apert>.001){",
    "    float nb=8.;float ba=a+rings.z*.5+apert*.9;float sector=6.28318/nb;",
    "    float la=mod(ba,sector)-sector*.5;",
    "    float edge=r*cos(la)-RI*mix(.95,.35,apert)+r*sin(la)*.45;",
    "    float blade=smoothstep(.003,-.003,-edge)*apert;",
    "    float shade=.5+.5*sin(la*3.+1.);vec3 bcol=vec3(.05,.08,.2)*(.6+shade)+vec3(.35,.8,1.)*exp(-abs(edge)*140.)*1.1+vec3(.7,.35,1.)*pow(.5+.5*sin(r*160.),16.)*.18+vec3(.4,.8,1.)*exp(-abs(la)*90.)*.5;",
    "    ir=mix(ir,bcol,blade*smoothstep(RI*1.02,RI*.98,r));",
    "   }",
    "   ec=mix(ec,ir,smoothstep(RI*1.04,RI*.99,r));",
    "   ec+=vec3(.3,.8,1.)*exp(-abs(r-RI*1.05)*140.)*.4;",
    "  }",
    "  // corneal highlight",
    "  ec+=vec3(.85,.95,1.)*exp(-length((e-vec2(-.09,.1)-gaze*.4)*vec2(1.,1.4))*38.)*.55;",
    "  // scanning light sweeps across",
    "  float sx=mix(-W,W,scan);ec+=vec3(.4,.9,1.)*exp(-abs(e.x-sx)*60.)*.35*(.5+high);",
    "  float seg=floor((atan(e.y-gaze.y,e.x-gaze.x)+3.14159)/6.28318*24.);",
    "  ec+=vec3(.3,.7,1.)*step(abs(seg-floor(scan*24.)),.5)*exp(-abs(length(e-gaze)-.27)*60.)*.6;",
    "  col=mix(col,ec,inside);",
    " }",
    " // fine electrical arcs round the iris rim",
    " if(arcT>0.){vec2 ic=e-gaze;float a=atan(ic.y,ic.x),r=length(ic);",
    "  float target=.255+(noise(vec2(a*20.,t*30.))-.5)*.03;float on=smoothstep(.0,.5,sin(a*2.+arcT*6.))*sin(arcT*3.14159);",
    "  col+=vec3(.7,.9,1.)*exp(-abs(r-target)*400.)*on*inside;}",
    " // sparks drifting through the framework",
    " vec2 g=vec2(pa*30.,pr*20.-t*2.);vec2 id=floor(g);float h=hash(id);",
    " col+=vec3(.6,.85,1.)*step(.95-high*.05,h)*smoothstep(.15,0.,length(fract(g)-.5))*smoothstep(.55,.8,pr)*(.5+high);",
    " col*=.85+.15*smoothstep(1.2,.3,length(p));",
    " col=col*(2.51*col+.03)/(col*(2.43*col+.59)+.14);",
    " gl_FragColor=vec4(clamp(col,0.,1.),1.);",
    "}"
  ].join('\n'), wormhole: [
    "uniform float T, zph, spin, bass, mid, high, beat, quality, core, warp;",
    "uniform vec4 rocks[8];  // x, y, radius, rotation",
    "float fbmW(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){if(float(i)>=4.+quality)break;v+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(1.7,9.2);a*=.5;}return v;}",
    "vec3 cosmic(float t){return .5+.5*cos(6.28318*(vec3(.78,.62,.98)*t+vec3(.6,.75,.95)));}",
    "void main(){",
    " vec2 p=(gl_FragCoord.xy-.5*res)/res.y;float t=T;",
    " vec2 c=vec2(.06*sin(t*.07),.04*cos(t*.09));",
    " vec2 d=p-c;",
    " // occasional tunnel distortions",
    " d+=warp*.05*vec2(sin(d.y*9.+t*2.),cos(d.x*8.-t*1.7));",
    " float r=length(d),a=atan(d.y,d.x);",
    " float scale=1.+bass*.18+beat*.1;",
    " float rr=r/scale;",
    " float z=.35/(rr+.015);                  // depth into the tunnel",
    " float lr=log(rr+.001);",
    " // nebula walls in tunnel coordinates, two layers turning at different speeds",
    " float a1=a+lr*1.4*(1.+mid*.3)+spin*.35,a2=a-lr*.9+spin*.2;",
    " vec2 e1=vec2(cos(a1),sin(a1)),e2=vec2(cos(a2),sin(a2));",
    " float n1=fbmW(e1*1.6+vec2(lr*1.3-zph*.45,-lr*.7+zph*.2)+fbmW(e1*2.3+vec2(zph*.3,lr))*1.1);",
    " float n2=fbmW(e2*2.4+vec2(-zph*.3+lr*.5,zph*.15)+n1*1.3);",
    " // spiral arms",
    " float arms=.5+.5*sin(a*3.+lr*5.5*(1.+mid*.25)+spin*1.4+n1*3.);",
    " float arms2=.5+.5*sin(a*5.-lr*3.+spin*.8+n2*4.);",
    " float wall=smoothstep(.02,.5,rr)*(1.-smoothstep(.9,1.4,rr));",
    " vec3 col=vec3(.005,.004,.02);",
    " float dens=pow(n1,1.6)*(.4+arms*1.1)+pow(n2,2.)*arms2*.5;",
    " vec3 neb=mix(vec3(.32,.05,.75),vec3(.05,.35,1.),smoothstep(.3,.75,n2));",
    " neb=mix(neb,vec3(.95,.15,.75),smoothstep(.55,.85,arms*n1*1.5));",
    " neb=mix(neb,vec3(.2,.95,1.),smoothstep(.75,.95,n2*arms2*1.6)*.6);",
    " col+=neb*dens*1.3*(.8+energy*.4)*smoothstep(1.6,.12,rr);",
    " // dust lanes for depth",
    " float a3=a+lr*2.+spin*.5;col*=1.-.6*smoothstep(.55,.8,fbmW(vec2(cos(a3),sin(a3))*2.+vec2(lr*2.5,-zph*.2)))*smoothstep(.05,.35,rr);",
    " // light streams travelling inward",
    " float lanes=a*12./6.28318+lr*1.2+spin*.6;float li=floor(lanes);float lf=fract(lanes);",
    " float lh=hash(vec2(li,2.));",
    " float seg=fract(lr*.9+zph*1.4+lh*7.);",
    " float stream=exp(-pow((lf-.5)*(14.+rr*30.),2.))*smoothstep(0.,.3,seg)*smoothstep(1.,.7,seg)*step(.55,lh);",
    " col+=mix(vec3(.6,.4,1.),vec3(.5,.9,1.),lh)*stream*(.5+high*.8+beat*.5)*smoothstep(.04,.3,rr);",
    " // energy waves travelling toward the centre on bass",
    " float wave=pow(.5+.5*sin(lr*6.+zph*9.),10.)*(bass*.8+beat*.6);",
    " col+=vec3(.7,.4,1.)*wave*.35*smoothstep(.03,.3,rr)*smoothstep(1.2,.3,rr);",
    " // particles accelerating into the destination",
    " vec2 pc=vec2(a*7./6.28318,sqrt(rr)*9.+zph*4.);vec2 pid=floor(pc);float ph=hash(pid);",
    " vec2 pf=fract(pc)-.5-(vec2(hash(pid+1.3),hash(pid+5.1))-.5)*.6;",
    " col+=mix(vec3(1.,.7,1.),vec3(.7,.95,1.),ph)*step(.82-high*.08,ph)*smoothstep(.05,0.,length(pf*vec2(1.,.45)))*(.6+high)*smoothstep(.02,.2,rr);",
    " // bright central destination",
    " float C=.06*(core+bass*.6+beat*.4);",
    " col+=vec3(1.,.95,1.)*exp(-r/(.012+C*.5))*1.6;",
    " col+=mix(vec3(1.,.4,.95),vec3(.6,.6,1.),.5)*exp(-r/(.05+C))*(.8+beat*.6);",
    " col+=vec3(.5,.25,1.)*exp(-r/(.18+C*2.))*.35;",
    " // stars and distant objects beyond the tunnel mouth",
    " vec2 sg=(p+vec2(t*.003,0.))*70.;vec2 sid=floor(sg);float sh=hash(sid);",
    " col+=vec3(.8,.85,1.)*step(.975,sh)*smoothstep(.3,0.,length(fract(sg)-.5))*(.4+.6*fract(sh*91.+t*.3)+high*.8)*smoothstep(.35,.8,rr);",
    " // asteroids and debris",
    " for(int i=0;i<8;i++){vec4 R=rocks[i];if(R.z<=0.)continue;",
    "  vec2 q=p-R.xy;float ang=R.w;q=mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*q;",
    "  float qa=atan(q.y,q.x),bump=fbmW(vec2(qa*2.,R.z*40.+float(i)*3.))*.35+noise(vec2(qa*7.,float(i)))*.12;",
    "  float sd=length(q)-R.z*(.75+bump);",
    "  if(sd<R.z*.25){",
    "   vec2 nrm2=q/max(length(q),.0001);vec3 nrm=normalize(vec3(nrm2*(1.-clamp(-sd/R.z,0.,1.)),.4+clamp(-sd/R.z,0.,1.)));",
    "   vec2 toC=normalize(c-R.xy);float lit=max(0.,dot(nrm.xy,toC))*.9+.08;",
    "   float crater=fbmW(q*30./R.z*.1+float(i));",
    "   vec3 rock=vec3(.06,.05,.075)*(.5+crater)+vec3(.6,.35,1.)*pow(lit,1.5)*.55+vec3(.35,.7,1.)*pow(1.-nrm.z,2.)*.35*lit;",
    "   col=mix(col,rock,smoothstep(.003,-.003,sd));",
    "  }",
    " }",
    " col*=.8+.2*smoothstep(1.3,.3,length(p));",
    " col=col*(2.51*col+.03)/(col*(2.43*col+.59)+.14);",
    " gl_FragColor=vec4(clamp(col,0.,1.),1.);",
    "}"
  ].join('\n'), hollowhead: [
    "uniform float T, bass, mid, high, beat;",
    "void main(){",
    " vec2 p=(gl_FragCoord.xy-.5*res)/res.y;float t=T;",
    " vec3 col=mix(vec3(.01,.008,.03),vec3(.04,.02,.1),smoothstep(.8,-.3,length(p-vec2(0.,.05))));",
    " col+=vec3(.08,.03,.2)*pow(noise(p*3.+t*.02),3.)*1.5;",
    " // orbiting light rings around the head",
    " for(int i=0;i<4;i++){float fi=float(i);",
    "  vec2 q=p-vec2(0.,-.18+fi*.035);float ry=.11+fi*.03,rx=.55+fi*.12+bass*.04;",
    "  float e=length(q/vec2(rx,ry));float ang=atan(q.y/ry,q.x/rx);",
    "  float ring=exp(-abs(e-1.)*(60.+fi*20.));",
    "  float streak=.35+.65*pow(.5+.5*sin(ang*(3.+fi)+t*(.6+fi*.25)*(fi<2.?1.:-1.)),3.);",
    "  float front=q.y<0.?1.:.45;",
    "  col+=mix(vec3(.25,.6,1.),vec3(.8,.3,1.),fi/3.)*ring*streak*front*(.45+mid*.4+beat*.3);",
    " }",
    " vec2 sg=p*80.;vec2 id=floor(sg);float h=hash(id);col+=vec3(.7,.8,1.)*step(.988,h)*smoothstep(.3,0.,length(fract(sg)-.5))*(.4+high);",
    " gl_FragColor=vec4(col,1.);",
    "}"
  ].join('\n') };
  var VX_HEAD_VS = [
    "precision highp float;",
    "attribute vec3 aP; attribute vec3 aN; attribute vec4 aR; attribute float aS; attribute float aF;",
    "uniform mat3 uRot; uniform float uAsp, uT, uExp, uComp, uWave, uWaveP, uFrag, uJaw, uCheek, uBrow, uHigh, uBass, uMid, uPulse, uPoints, uPx;",
    "uniform vec3 uFragDir; uniform vec2 uEye;",
    "varying float vI; varying vec3 vC; varying float vA;",
    "void main(){",
    " vec3 P=aP, n=aN;",
    " // facial independence: jaw hinge, cheeks, forehead, eye sockets",
    " float ja=uJaw*aR.x; vec3 pv=vec3(0.,-.3,-.12); vec3 q=P-pv;",
    " q=vec3(q.x,q.y*cos(ja)-q.z*sin(ja),q.y*sin(ja)+q.z*cos(ja)); P=mix(P,pv+q,step(.001,aR.x));",
    " P+=n*(uCheek*aR.y*.13); P+=n*(uBrow*aR.z*.09)+vec3(0.,uBrow*aR.z*.05,0.); P.xy+=uEye*aR.w*.07;",
    " // travelling waves (forehead, cheeks and jaw move independently)",
    " float w1=sin(P.x*5.5+P.y*1.5-uWaveP*3.)*(.6+.4*sin(P.y*4.+uT*.7));",
    " float w2=sin(P.y*7.-uWaveP*2.3+P.z*2.)*(aR.y+aR.z+aR.x);",
    " P+=n*uWave*(w1*.07+w2*.05);",
    " // expansion: proportions distort as the grid stretches",
    " vec3 grow=vec3(1.+uExp*(1.+.55*sin(P.y*2.6+1.2)),1.+uExp*.65,1.+uExp*(1.+.45*cos(P.y*3.4)));",
    " P*=grow;",
    " // compression: features draw into a dense core",
    " P=mix(P,P*vec3(.42,.58,.5)+vec3(0.,.08,0.),uComp);",
    " // fragmentation: sections break into glowing points that swirl and return",
    " float side=dot(normalize(aP+vec3(0.,.25,0.)),uFragDir);",
    " float det=uFrag*smoothstep(-.1,.6,side+fract(aS*13.7)*.6-.3);",
    " float sa=det*(1.5+aS*3.);",
    " vec3 dir=normalize(vec3(cos(aS*40.),sin(aS*23.)*.6,sin(aS*40.)))*(.4+aS*.9);",
    " P+=n*det*(.25+aS*.6)+dir*det*.55;",
    " P=vec3(P.x*cos(sa)-P.z*sin(sa),P.y+det*sin(uT*1.3+aS*20.)*.12,P.x*sin(sa)+P.z*cos(sa));",
    " vec3 R=uRot*(P+vec3(0.,.25,0.));",
    " vec3 N=uRot*n;",
    " float D=4.2-R.z;",
    " gl_Position=vec4(R.x*2.55/D/uAsp,R.y*2.55/D-.04,0.,1.);",
    " float facing=N.z;",
    " float key=max(dot(N,normalize(vec3(-.55,.45,.7))),0.);",
    " float light=.18+.95*pow(key,1.4)+.45*pow(1.-abs(facing),3.);",
    " light*=facing<0.?.3:1.;",
    " float hueT=aP.y*.35+atan(aP.x,aP.z)*.08+uT*.03;",
    " vec3 c=mix(vec3(.15,.4,1.),vec3(.2,.95,1.),.5+.5*sin(hueT*6.28));",
    " c=mix(c,vec3(.6,.25,1.),smoothstep(.2,.9,.5+.5*sin(hueT*6.28+2.)));",
    " c=mix(c,vec3(1.,.3,.8),smoothstep(.75,1.,.5+.5*sin(aP.y*2.-uT*.25))*.5);",
    " c=mix(c,.5+.5*cos(6.28*(aP.y*.8+uT*.1+vec3(0.,.33,.67))),.12+uHigh*.15);",
    " float pulse=exp(-pow((aP.y-uPulse)/.05,2.))*(.6+uHigh*1.4);",
    " vI=light*(1.+pulse+aF*.9)+uBass*.15;",
    " float eyes=smoothstep(.3,.9,aR.w)*smoothstep(-.2,.3,facing);",
    " vC=c+vec3(.4,.6,1.)*pulse*.6+vec3(.6,.95,1.)*eyes*(1.2+uHigh+uBass);",
    " vA=uPoints>.5?(.25+uHigh*.9+det*2.)*light:(1.-det*1.1);",
    " gl_PointSize=uPx*(1.+uHigh*1.6+det*2.6)/D*4.2;",
    "}"
  ].join('\n'), VX_HEAD_FS = [
    "precision mediump float;",
    "uniform float uPtF;",
    "varying float vI; varying vec3 vC; varying float vA;",
    "void main(){",
    " float a=vA;",
    " if(uPtF>.5){vec2 q=gl_PointCoord-.5;a*=smoothstep(.5,.0,length(q));}",
    " gl_FragColor=vec4(vC*vI,clamp(a,0.,1.));",
    "}"
  ].join('\n');
  var vxProg = {}, vxMesh = null, vxState = null, vxCur = null, vxSnapCv = null, vxBar = null, vxBarTimer = 0, vxScale = 1, vxSlow = 0, vxFast = 0;
  var VX_Q = HIGH_MEMORY_DEVICE ? 1 : 0, VX_GLX_MAX = HIGH_MEMORY_DEVICE ? 1.25 : 1, VX_GLX_MIN = HIGH_MEMORY_DEVICE ? .8 : .55;
  // Hollow Head: procedural 3D head + neck wireframe mesh (rendered with WebGL lines and points).
  function vxBuildHead(cols, rows) {
    function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
    function g2(dx, dy, sx, sy) { return Math.exp(-(dx * dx / sx + dy * dy / sy)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function surf(th, y) {
      var c = Math.cos(th), s = Math.sin(th), rx, rzF, rzB;
      if (y > -0.22) { var k = Math.sqrt(Math.max(0, 1 - Math.pow((y - 0.1) / 0.93, 2))); rx = 0.74 * k; rzF = 0.8 * k; rzB = 0.88 * k; }
      else if (y > -0.8) { var u = (-0.22 - y) / 0.58, k0 = Math.sqrt(1 - Math.pow(0.32 / 0.93, 2)); rx = lerp(0.74 * k0, 0.47, Math.pow(u, 1.25)); rzF = lerp(0.8 * k0, 0.69, u); rzB = lerp(0.88 * k0, 0.42, smooth(0, 1, u)); }
      else { var v = smooth(-0.8, -1.0, y); rx = lerp(0.47, 0.4, v) + Math.max(0, -1.3 - y) * 0.15; rzF = lerp(0.69, 0.37, v) + Math.max(0, -1.3 - y) * 0.12; rzB = lerp(0.42, 0.43, v) + Math.max(0, -1.3 - y) * 0.15; }
      var x = rx * s, z = (c > 0 ? rzF : rzB) * c;
      var fw = smooth(0.1, 0.65, c), ax = Math.abs(x), d = 0;
      // facial geometry on the front of the head
      var noseW = 0.07 + 0.045 * smooth(-0.12, -0.3, y);
      d += fw * Math.exp(-Math.pow(x / noseW, 2)) * lerp(0.045, 0.27, smooth(0.04, -0.28, y)) * smooth(-0.36, -0.28, y) * smooth(0.12, 0.02, y);
      d -= fw * 0.15 * g2(ax - 0.27, y - 0.04, 0.016, 0.009);                 // eye sockets
      d += fw * 0.035 * g2(ax - 0.27, y - 0.035, 0.004, 0.0025);               // eyeballs
      d += fw * 0.05 * Math.exp(-Math.pow((y - 0.15) / 0.05, 2)) * smooth(0.5, 0.05, ax);   // brow ridge
      d += fw * 0.08 * g2(ax - 0.42, y + 0.13, 0.02, 0.012);                   // cheekbones
      d -= fw * 0.03 * g2(ax - 0.58, y - 0.16, 0.01, 0.02);                    // temples
      d += fw * 0.055 * g2(x, y + 0.45, 0.03, 0.0016) + fw * 0.05 * g2(x, y + 0.53, 0.025, 0.0018);   // lips
      d -= fw * 0.05 * g2(x, y + 0.49, 0.03, 0.0004);                          // mouth line
      d += fw * 0.08 * g2(x, y + 0.71, 0.025, 0.008);                          // chin
      var ear = 0.15 * Math.exp(-Math.pow((y + 0.06) / 0.14, 2)) * Math.exp(-Math.pow((c + 0.06) / 0.09, 2)) * smooth(0.85, 0.97, Math.abs(s));
      x += (s > 0 ? 1 : -1) * ear;
      z += d;
      var jaw = smooth(-0.42, -0.58, y) * smooth(-0.98, -0.82, y) * smooth(-0.35, 0.3, c);
      var cheek = fw * g2(ax - 0.38, y + 0.2, 0.03, 0.03);
      var brow = fw * smooth(0.06, 0.3, y) * smooth(0.95, 0.6, y);
      var eye = fw * g2(ax - 0.27, y - 0.04, 0.03, 0.02);
      return [x, y, z, jaw, cheek, brow, eye, Math.min(1, Math.abs(d) * 9 + ear * 5)];
    }
    var yTop = 1.02, yBot = -1.55, verts = [], i, j;
    for (j = 0; j <= rows; j++) {
      var y = yTop - (yTop - yBot) * Math.pow(j / rows, 1.0);
      for (i = 0; i < cols; i++) verts.push(surf(-Math.PI + (i / cols) * Math.PI * 2, y));
    }
    var N = verts.length, data = new Float32Array(N * 12), idx = [];
    function V(i, j) { return verts[j * cols + ((i + cols) % cols)]; }
    for (j = 0; j <= rows; j++) for (i = 0; i < cols; i++) {
      var p = V(i, j), a = V(i + 1, j), b = V(i - 1, j), up = V(i, Math.max(0, j - 1)), dn = V(i, Math.min(rows, j + 1));
      var tx = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], ty = [up[0] - dn[0], up[1] - dn[1], up[2] - dn[2]];
      var n = [tx[1] * ty[2] - tx[2] * ty[1], tx[2] * ty[0] - tx[0] * ty[2], tx[0] * ty[1] - tx[1] * ty[0]], l = Math.hypot(n[0], n[1], n[2]) || 1;
      if (n[0] * p[0] + n[2] * p[2] < 0) l = -l;   // outward
      var o = (j * cols + i) * 12, seed = ((Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1 + 1) % 1;
      data.set([p[0], p[1], p[2], n[0] / l, n[1] / l, n[2] / l, p[3], p[4], p[5], p[6], seed, p[7]], o);
      if (i + 1 <= cols) idx.push(j * cols + i, j * cols + (i + 1) % cols);            // rings
      if (j < rows) idx.push(j * cols + i, (j + 1) * cols + i);                         // meridians
    }
    return { data: data, index: new Uint16Array(idx), count: N };
  }
  function vxCompile(key, vsrc, fsrc) {
    if (vxProg[key]) return vxProg[key];
    function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(o); gl.deleteShader(o); throw new Error(key + ': ' + log); } return o; }
    var vs = sh(gl.VERTEX_SHADER, vsrc), fs = sh(gl.FRAGMENT_SHADER, fsrc), p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var l = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(key + ': ' + l); }
    var loc = {}, prog = { p: p, u: function (n) { if (!(n in loc)) loc[n] = gl.getUniformLocation(p, n); return loc[n]; }, a: {} };
    vxProg[key] = prog; return prog;
  }
  function vxFull(name) { return vxCompile('vx_' + name, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }', GL_HEAD + VX_SRC[name]); }
  function vxSet(prog, u) {
    for (var k in u) { var L = prog.u(k), v = u[k]; if (L === null) continue;
      if (typeof v === 'number') gl.uniform1f(L, v); else if (v.length === 2) gl.uniform2f(L, v[0], v[1]); else if (v.length === 3) gl.uniform3f(L, v[0], v[1], v[2]); else if (v.length === 4) gl.uniform4f(L, v[0], v[1], v[2], v[3]); else gl.uniform4fv(L, v); }
  }
  function vxDrawFull(prog, u, w, h) {
    gl.useProgram(prog.p);
    var pl = gl.getAttribLocation(prog.p, 'p'); gl.bindBuffer(gl.ARRAY_BUFFER, glBuf); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(prog.u('res'), w, h); gl.uniform1f(prog.u('time'), u.T || 0); gl.uniform1f(prog.u('quality'), VX_Q);
    vxSet(prog, u); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function vxHeadMesh() {
    if (vxMesh) return vxMesh;
    var m = vxBuildHead(HIGH_MEMORY_DEVICE ? 96 : 64, HIGH_MEMORY_DEVICE ? 80 : 54);
    var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, m.data, gl.STATIC_DRAW);
    var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.index, gl.STATIC_DRAW);
    vxMesh = { vb: vb, ib: ib, lines: m.index.length, count: m.count }; return vxMesh;
  }
  function vxRotm(yaw, pitch, roll) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    var a = [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];          // yaw * pitch (column-major)
    return new Float32Array([a[0] * cr + a[3] * sr, a[1] * cr + a[4] * sr, a[2] * cr + a[5] * sr, -a[0] * sr + a[3] * cr, -a[1] * sr + a[4] * cr, -a[2] * sr + a[5] * cr, a[6], a[7], a[8]]);
  }
  function vxDrawHead(u, w, h) {
    var hb = vxFull('hollowhead'); vxDrawFull(hb, { T: u.T, bass: u.bass, mid: u.mid, high: u.high, beat: u.beat }, w, h);
    var mp = vxCompile('vx_headmesh', VX_HEAD_VS, VX_HEAD_FS), m = vxHeadMesh();
    gl.useProgram(mp.p); gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
    var L = [['aP', 3, 0], ['aN', 3, 12], ['aR', 4, 24], ['aS', 1, 40], ['aF', 1, 44]], on = [];
    for (var i = 0; i < L.length; i++) { var a = gl.getAttribLocation(mp.p, L[i][0]); if (a < 0) continue; gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, L[i][1], gl.FLOAT, false, 48, L[i][2]); on.push(a); }
    vxSet(mp, { uAsp: w / h, uT: u.T, uExp: u.exp, uComp: u.comp, uWave: u.wave, uWaveP: u.waveP, uFrag: u.frag, uJaw: u.jaw, uCheek: u.cheek, uBrow: u.brow, uHigh: u.high, uBass: u.bass, uMid: u.mid, uPulse: u.pulse, uPx: Math.max(1.5, h / 230), uFragDir: u.fragDir, uEye: u.eye });
    gl.uniformMatrix3fv(mp.u('uRot'), false, vxRotm(u.yaw, u.pitch, u.roll));
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.uniform1f(mp.u('uPoints'), 0); gl.uniform1f(mp.u('uPtF'), 0); gl.drawElements(gl.LINES, m.lines, gl.UNSIGNED_SHORT, 0);
    gl.uniform1f(mp.u('uPoints'), 1); gl.uniform1f(mp.u('uPtF'), 1); gl.drawArrays(gl.POINTS, 0, m.count);
    gl.disable(gl.BLEND); on.forEach(function (a) { gl.disableVertexAttribArray(a); });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }
  function vxRelease() {
    if (!gl) return;
    Object.keys(vxProg).forEach(function (k) { try { gl.deleteProgram(vxProg[k].p); } catch (e) {} });
    vxProg = {};
    if (vxMesh) { try { gl.deleteBuffer(vxMesh.vb); gl.deleteBuffer(vxMesh.ib); } catch (e) {} vxMesh = null; }
    if (glc && !XP.active) { glc.width = 1; glc.height = 1; }
  }

  // ---- shared music model: bass, mid, treble and beat are smoothed separately ----
  function vxAudio() {
    var b = beatTracker({ quiet: true }), A2 = { bass: 0, mid: 0, high: 0, beat: 0, energy: 0, drama: 0, hit: false, strong: false, rise: 0, lastHighs: 0, slow: 0, build: 0, phase: 0, period: 520, lastHitAt: 0, quiet: 1 };
    A2.tick = function (now, dt) {
      b.tick(now); var k = Math.min(1, b.k || 0), s = dt / 1000;
      A2.bass += (k - A2.bass) * (k > A2.bass ? Math.min(1, s * 9) : Math.min(1, s * 2.4));
      A2.mid += (Math.min(1, b.mid || 0) - A2.mid) * Math.min(1, s * 3.2);
      var hi = Math.min(1, b.high || 0); A2.rise = Math.max(0, hi - A2.high); A2.high += (hi - A2.high) * Math.min(1, s * 6);
      A2.energy += (Math.min(1, b.e || 0) - A2.energy) * Math.min(1, s * 2);
      A2.drama += (A2.bass * .6 + A2.energy * .4 - A2.drama) * Math.min(1, s * .5);   // slow: strong passages, not single hits
      A2.hit = !!b.hit; A2.strong = A2.hit && k > .7;
      if (A2.hit) A2.beat = Math.max(A2.beat, .55 + k * .45);
      A2.beat *= Math.exp(-dt / 320);
      A2.live = b.live;
      // build-ups: energy rising above its long-term average; quiet: little energy for a while
      A2.slow += (A2.energy - A2.slow) * Math.min(1, s * .15);
      A2.build += (Math.max(0, Math.min(1, (A2.energy - A2.slow) * 4)) - A2.build) * Math.min(1, s * 1.5);
      A2.quiet += ((A2.energy < .12 ? 1 : 0) - A2.quiet) * Math.min(1, s * .5);
      // beat clock: tempo follows detected hits, phase runs continuously between them
      if (A2.hit) { var iv = now - A2.lastHitAt; if (iv > 280 && iv < 1100) A2.period += (iv - A2.period) * .25; A2.lastHitAt = now; var near = Math.round(A2.phase); A2.phase += (near - A2.phase) * .35; }
      A2.phase += dt / (A2.live ? A2.period : 1300);
      return A2;
    };
    return A2;
  }
  function vxRand(a, b2) { return a + Math.random() * (b2 - a); }
  function vxEase(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  // ---- per-experience motion and choreography (uniform values each frame) ----
  var VX_SCENE = {
    firetornado: function () {
      var st = { T: 7, rot: 0, surge: 0 };
      return function (A, dt, t) {
        var s = dt / 1000;
        st.T += s * (.75 + A.energy * .55 + A.bass * .35);
        st.rot += s * (1.25 + A.bass * 2.4 + A.beat * 1.3 + A.mid * .4);
        if (A.strong) st.surge = Math.min(1.4, st.surge + .9);
        st.surge *= Math.exp(-dt / 600);
        return { T: st.T, rot: st.rot, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, surge: st.surge };
      };
    },
    bluefire: function () {
      var st = { T: 11, surge: 0, arc: [0, 0, 0, 0], arcAt: 2500, forms: [] }, forms = new Float32Array(28);
      for (var i = 0; i < 7; i++) st.forms.push({ base: -.78 + i * .26 + vxRand(-.04, .04), ph: vxRand(0, 6.3), rate: vxRand(.12, .32), hr: vxRand(.15, .45), fast: Math.random() < .35, h: .6 });
      return function (A, dt, t) {
        var s = dt / 1000;
        st.T += s * (.8 + A.energy * .5 + A.bass * .4);
        if (A.strong) st.surge = Math.min(1.4, st.surge + .8);
        st.surge *= Math.exp(-dt / 700);
        st.forms.forEach(function (f, i) {
          var x = f.base + .085 * Math.sin(t * f.rate + f.ph) + .03 * Math.sin(t * f.rate * 2.7 + f.ph * 2) * (1 + A.mid);   // formations merge and separate
          var hT = .48 + .32 * (.5 + .5 * Math.sin(t * f.hr + f.ph)) + A.bass * .22 + (f.fast ? .08 * Math.sin(t * 9 + f.ph) * (.5 + A.high) : 0);
          f.h += (hT - f.h) * Math.min(1, s * (f.fast ? 8 : 2.2));
          forms[i * 4] = x; forms[i * 4 + 1] = f.h; forms[i * 4 + 2] = f.ph; forms[i * 4 + 3] = f.rate;
        });
        st.arcAt -= dt;
        if (st.arc[2] <= 0 && (st.arcAt <= 0 || (A.rise > .25 && A.high > .5))) {
          var k = Math.floor(Math.random() * 6); st.arc = [forms[k * 4], forms[(k + 1) * 4], .001, Math.random() * 50]; st.arcAt = vxRand(1800, 5200) / (1 + A.high);
        }
        if (st.arc[2] > 0) { st.arc[2] += s / .42; if (st.arc[2] >= 1) st.arc[2] = 0; }
        return { T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, surge: st.surge, forms: forms, arc: st.arc };
      };
    },
    hollowhead: function () {
      var seq = [['expand', 7.5], ['wave', 8], ['compress', 6.5], ['face', 8], ['fragment', 9]], st = { T: 5, phase: 0, at: 0, waveP: 0, beatExp: 0, fragEv: 0, fragCool: 0, beatCool: 0, fd: 0, pulse: 1.2 };
      return function (A, dt, t) {
        var s = dt / 1000;
        st.T += s; st.at += s; st.waveP += s * (.8 + A.mid * 1.6);
        if (st.at > seq[st.phase][1]) { st.at = 0; st.phase = (st.phase + 1) % seq.length; }
        var ph = seq[st.phase][0], prog = st.at / seq[st.phase][1], env = Math.sin(Math.PI * vxEase(prog));
        // beat-triggered full-head expansion and recovery; strong bass passages trigger fragmentation
        st.beatCool -= dt; st.fragCool -= dt;
        if (A.strong && st.beatCool <= 0) { st.beatExp = 1; st.beatCool = 3500; }
        st.beatExp *= Math.exp(-dt / 700);
        if (A.drama > .55 && st.fragCool <= 0 && ph !== 'fragment') { st.fragEv = 1; st.fragCool = 14000; }
        st.fragEv = Math.max(0, st.fragEv - s / 4.5);
        var fragEnv = Math.sin(Math.PI * Math.min(1, 1 - st.fragEv)) * (st.fragEv > 0 ? 1 : 0);
        st.fd += s * .25;
        st.pulse -= s * (.55 + A.high * 1.4); if (st.pulse < -1.7) st.pulse = 1.2;
        var face = ph === 'face' ? env : 0;
        return {
          T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat,
          exp: (ph === 'expand' ? env * .55 : 0) + A.bass * .14 + st.beatExp * .2,
          comp: (ph === 'compress' ? env * .72 : 0),
          wave: (ph === 'wave' ? env * 1.1 : .12) * (.55 + A.mid * .9), waveP: st.waveP,
          frag: Math.min(.85, (ph === 'fragment' ? env * .78 : 0) + fragEnv * .6 + A.bass * A.drama * .1),
          fragDir: [Math.cos(st.fd), Math.sin(st.fd * .7) * .4, Math.sin(st.fd)],
          jaw: Math.max(0, .05 * Math.sin(t * 1.7) + face * .38 * Math.pow(Math.sin(t * 2.1), 2) + A.mid * .18),
          cheek: face * .7 * Math.sin(t * 1.35) + A.mid * .3 * Math.sin(t * 2.6),
          brow: face * .7 * Math.sin(t * .95 + 1) + A.bass * .2,
          eye: [face * Math.sin(t * 1.1) * .8, face * Math.cos(t * .8) * .5],
          yaw: .42 * Math.sin(t * .11) + .16 * Math.sin(t * .29 + 1) + A.mid * .05 * Math.sin(t),
          pitch: -.12 + .09 * Math.sin(t * .17 + 2), roll: .06 * Math.sin(t * .13), pulse: st.pulse
        };
      };
    },
    cybereye: function () {
      var st = { T: 3, lid: 0, blinkAt: vxRand(1500, 4000), blink: null, gaze: [0, 0], gv: [0, 0], gazeT: [0, 0], gazeAt: 0, pupil: .4, pv: 0, contract: 0, contractAt: vxRand(7000, 13000),
        rings: [0, 1.3, 2.1, .7], rv: [.32, -.5, .7, -.22], dir: [1, 1, 1, 1], flipAt: [6e3, 9e3, 7e3, 11e3], ap: 0, apState: 0, apAt: vxRand(14000, 22000), apCool: 0, scan: -1, scanAt: 2000, arcT: 0 };
      return function (A, dt, t) {
        var s = dt / 1000, i;
        st.T += s * (.8 + A.energy * .4);
        // blinking: natural, varied timing (quick, normal, slow; sometimes double)
        st.blinkAt -= dt;
        if (!st.blink && st.blinkAt <= 0) { var r = Math.random(); st.blink = { t: 0, d: r < .55 ? .16 : r < .85 ? .28 : .62, again: Math.random() < .15 }; }
        if (st.blink) {
          st.blink.t += s; var bp = st.blink.t / st.blink.d;
          st.lid = bp < .42 ? vxEase(bp / .42) : 1 - vxEase((bp - .42) / .58);
          if (bp >= 1) { st.lid = 0; if (st.blink.again) { st.blink = { t: 0, d: .18, again: false }; } else { st.blink = null; st.blinkAt = vxRand(2200, 6800); } }
        }
        // eye movement: deliberate saccades, sometimes focusing back toward the viewer
        st.gazeAt -= dt;
        if (st.gazeAt <= 0) { st.gazeT = Math.random() < .3 ? [0, 0] : [vxRand(-.075, .075), vxRand(-.03, .03)]; st.gazeAt = vxRand(1400, 4200) / (1 + A.mid); }
        var gt0 = st.gazeT[0] + A.mid * .02 * Math.sin(t * .9), gt1 = st.gazeT[1];
        for (i = 0; i < 2; i++) { var g = i ? gt1 : gt0; st.gv[i] += ((g - st.gaze[i]) * 60 - st.gv[i] * 14) * s; st.gaze[i] += st.gv[i] * s; }
        // pupil: expands with bass, briefly contracts to a point
        st.contractAt -= dt;
        if (st.contractAt <= 0 || (A.rise > .3 && A.high > .6 && st.contract <= 0)) { st.contract = 1; st.contractAt = vxRand(8000, 15000); }
        st.contract = Math.max(0, st.contract - s / .9);
        var pT = .36 - A.energy * .05 + A.bass * .5 + A.beat * .1;
        if (st.contract > 0) pT = .03;
        st.pv += ((pT - st.pupil) * 70 - st.pv * 13) * s; st.pupil = Math.max(.02, Math.min(1, st.pupil + st.pv * s));
        // iris rings: independent speeds, occasional reversals
        for (i = 0; i < 4; i++) {
          st.flipAt[i] -= dt;
          if (st.flipAt[i] <= 0 || (A.strong && Math.random() < .25)) { st.dir[i] *= -1; st.flipAt[i] = vxRand(5000, 12000); }
          var v = st.rv[i] * st.dir[i] * (1 + A.mid * 1.4 + A.bass * .6);
          st.rv2 = st.rv2 || [0, 0, 0, 0]; st.rv2[i] += (v - st.rv2[i]) * Math.min(1, s * 1.6);
          st.rings[i] += st.rv2[i] * s;
        }
        // mechanical aperture events (strong beats or occasionally on its own)
        st.apAt -= dt; st.apCool -= dt;
        if (st.apState === 0 && ((st.apAt <= 0) || (A.strong && A.bass > .75 && st.apCool <= 0))) { st.apState = 1; st.apT = 0; st.apAt = vxRand(16000, 30000); st.apCool = 9000; }
        if (st.apState) { st.apT += s; var a = st.apT; st.ap = a < .7 ? vxEase(a / .7) : a < 2 ? 1 : 1 - vxEase((a - 2) / .9); if (a > 2.9) { st.apState = 0; st.ap = 0; } }
        // scanning sweeps and electrical arcs (treble)
        st.scanAt -= dt;
        if (st.scan < 0 && (st.scanAt <= 0 || A.rise > .28)) { st.scan = 0; }
        if (st.scan >= 0) { st.scan += s / (2.2 - A.high * .9); if (st.scan > 1) { st.scan = -1; st.scanAt = vxRand(2500, 6000); } }
        if (st.arcT <= 0 && A.high > .45 && Math.random() < s * (1 + A.high * 3)) st.arcT = .001;
        if (st.arcT > 0) { st.arcT += s / .45; if (st.arcT >= 1) st.arcT = 0; }
        var seg = [.3 + .3 * Math.sin(t * .5) + A.bass * .35, .3 + .3 * Math.sin(t * .37 + 1) + A.mid * .3, .35 + .3 * Math.sin(t * .61 + 2) + A.bass * .25, .3 + .3 * Math.sin(t * .43 + 3) + A.high * .3];
        return { T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, lid: st.lid, pupil: st.pupil, apert: st.ap,
          radial: Math.min(1, .5 + .3 * Math.sin(t * .33) + A.bass * .35), scan: st.scan < 0 ? -5 : st.scan, arcT: st.arcT,
          gaze: [st.gaze[0], st.gaze[1]], rings: st.rings.slice(), segs: seg };
      };
    },
    wormhole: function () {
      var st = { T: 9, zph: 0, spin: 0, core: .3, warp: 0, warpAt: vxRand(9000, 16000), rocks: [], arr: new Float32Array(32) };
      function spawn(r, init) {
        var fg = r.fg; r.z = fg ? vxRand(.04, .085) : vxRand(.012, .03);
        var side = Math.random() < .5 ? -1 : 1; r.x = init ? vxRand(-.85, .85) : side * 1.05; r.y = vxRand(-.45, .45);
        r.vx = -side * vxRand(.012, .03) * (fg ? 1.4 : .6); r.vy = vxRand(-.01, .01); r.rot = vxRand(0, 6); r.rv = vxRand(-.4, .4);
        if (!fg) { r.vx *= .4; r.fall = true; }
      }
      for (var i = 0; i < 8; i++) { var r = { fg: i < 4 }; spawn(r, true); st.rocks.push(r); }
      return function (A, dt, t) {
        var s = dt / 1000;
        st.T += s * (.8 + A.energy * .4);
        st.zph += s * (.32 + A.energy * .45 + A.bass * .55 + A.beat * .35);
        st.spin += s * (.22 + A.bass * .65 + A.mid * .2);
        var coreT = .3 + .12 * Math.sin(t * .7) + A.drama * 1.1 + A.beat * .35;
        st.core += (coreT - st.core) * Math.min(1, s * 2.5);
        st.warpAt -= dt; if (st.warpAt <= 0) { st.warpT = 0; st.warpAt = vxRand(10000, 20000); }
        if (st.warpT !== undefined) { st.warpT += s / 2.4; st.warp = Math.sin(Math.PI * Math.min(1, st.warpT)); if (st.warpT >= 1) { st.warpT = undefined; st.warp = 0; } }
        st.rocks.forEach(function (r, i) {
          r.x += r.vx * s * (1 + A.energy); r.y += r.vy * s; r.rot += r.rv * s;
          if (r.fall) { var dx = -r.x, dy = -r.y, d = Math.hypot(dx, dy) || 1; r.x += dx / d * s * .01 * (1 + A.bass * 2); r.y += dy / d * s * .01 * (1 + A.bass * 2); r.z *= Math.exp(-s * .05); if (d < .08) spawn(r); }
          if (Math.abs(r.x) > 1.1) spawn(r);
          st.arr[i * 4] = r.x; st.arr[i * 4 + 1] = r.y; st.arr[i * 4 + 2] = r.z; st.arr[i * 4 + 3] = r.rot;
        });
        return { T: st.T, zph: st.zph, spin: st.spin, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, energy: A.energy, core: st.core, warp: st.warp, rocks: st.arr };
      };
    }
  };

  // ---- Eight worlds: Deep Sea Explorer, Robot DJ, Alien Mushroom World, UFO Encounter,
  //      Cosmic Rollercoaster, Living Skull, Alien Dance Party, Neon Highway ----
  var VX_COMMON = [
    "uniform float T, bass, mid, high, beat, quality, build;",
    "float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){if(float(i)>=4.+quality)break;v+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return v;}",
    "float fbm3(vec2 p){float v=0.,a=.5;for(int i=0;i<3;i++){v+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return v;}",
    "mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}",
    "float hash1(float n){return fract(sin(n)*43758.5453);}",
    "float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}",
    "float sdCap(vec3 p,vec3 a,vec3 b,float r){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h)-r;}",
    "float sdEll(vec3 p,vec3 r){float k0=length(p/r),k1=length(p/(r*r));return k0*(k0-1.)/k1;}",
    "float sdBox(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}",
    "float sdRBox(vec3 p,vec3 b,float r){return sdBox(p,b-r)-r;}",
    "float sdTor(vec3 p,vec2 t){vec2 q=vec2(length(p.xz)-t.x,p.y);return length(q)-t.y;}",
    "float sdCyl(vec3 p,float h,float r){vec2 d=abs(vec2(length(p.xz),p.y))-vec2(r,h);return min(max(d.x,d.y),0.)+length(max(d,0.));}",
    "vec3 tonemap(vec3 c){c=max(c,0.);c=c*(2.51*c+.03)/(c*(2.43*c+.59)+.14);return clamp(c,0.,1.);}",
    "float stars(vec2 p,float sc,float th){vec2 g=p*sc,id=floor(g);float h=hash(id);return step(th,h)*smoothstep(.35,0.,length(fract(g)-.5-(vec2(hash(id+1.7),hash(id+3.3))-.5)*.5))*(.5+.5*sin(T*(1.+h*3.)+h*40.));}"
  ].join('\n');
  var VX8 = { deepsea: [
    "uniform float zph, sway, wave, flashes;",
    "uniform vec4 beast;   // x, y, scale, swim phase",
    "uniform float layers;",
    "float jelly(vec2 q,float ph,out float glow){",
    " vec2 b=q;b.y-=.02*sin(ph);float bell=length(b*vec2(1.,1.6))-.08*(1.+.08*sin(ph*2.));bell=max(bell,-b.y-.01);",
    " glow=exp(-max(bell,0.)*40.);",
    " float ten=9.;for(int k=0;k<5;k++){float fk=float(k);float x=-.05+fk*.025;float yy=-b.y;",
    "  float tx=x+.02*sin(yy*25.-ph*3.+fk)*smoothstep(0.,.1,yy);ten=min(ten,abs(b.x-tx)+max(0.,-yy)*9.+max(0.,yy-.25-fk*.03)*9.);}",
    " return min(bell,ten-.003);",
    "}",
    "vec3 sea(vec2 p){",
    " vec3 c=mix(vec3(.0,.015,.04),vec3(.02,.08,.16),smoothstep(-.6,.7,p.y));",
    " // light beams from the far surface",
    " for(int i=0;i<4;i++){float fi=float(i);float x0=-.8+fi*.55+.15*sin(T*.07+fi*2.);float sl=(p.x-x0)+(p.y-.6)*(.25+fi*.05);",
    "  c+=vec3(.15,.45,.6)*exp(-abs(sl)*(10.+fi*4.))*smoothstep(-.6,.6,p.y)*(.22+.08*sin(T*.3+fi));}",
    " return c;",
    "}",
    "void main(){",
    " vec2 p=(gl_FragCoord.xy-.5*res)/res.y;",
    " // pressure wave from the bass",
    " float pr=length(p);p+=p/max(pr,.001)*sin(pr*18.-wave*12.)*.006*wave*smoothstep(.0,.3,pr);",
    " vec3 col=sea(p);",
    " // distant leviathan silhouette passing through the gloom",
    " {vec2 q=(p-beast.xy)/beast.z;float sw=sin(q.x*5.-beast.w)*.04;q.y-=sw;",
    "  float body=length(q*vec2(.55,2.2))-.18;float tail=length((q-vec2(-.42,.02*sin(beast.w*1.3)))*vec2(2.,1.))-.06;float fin=length((q-vec2(.05,-.07))*vec2(2.5,1.4))-.05;",
    "  float b=min(min(body,tail),fin);float fogB=.3+.55*smoothstep(.35,1.3,beast.z);",
    "  col=mix(col,vec3(.0,.02,.04),smoothstep(.01,-.01,b)*fogB);",
    "  col+=vec3(.2,.8,1.)*exp(-length((q-vec2(.3,.02))*vec2(1.,1.))*60.)*.5*fogB+vec3(.3,.9,1.)*smoothstep(.01,0.,abs(b))*.25*fogB*(1.+bass);}",
    " // depth layers streaming toward the viewport",
    " for(int i=0;i<8;i++){float fi=float(i);if(fi>=layers)break;",
    "  float z=fract(fi/layers-zph);float depth=mix(.08,1.,z);float sc=1./depth;",
    "  float id=floor(fi/layers-zph)*layers+fi;float fade=smoothstep(1.,.85,z)*smoothstep(.0,.12,z);",
    "  vec2 q=p*depth*2.2;",
    "  float fog=1.-z*.75;",
    "  // seabed and canyon walls",
    "  float ground=-.75+.18*fbm3(vec2(q.x*1.3,id))+.08*sin(q.x*3.+id);",
    "  float wallL=-1.1-.25*fbm3(vec2(q.y*2.,id+3.)),wallR=1.1+.25*fbm3(vec2(q.y*2.,id+9.));",
    "  float rock=max(max(step(q.y,ground),step(q.x,wallL+q.y*.2)),step(wallR-q.y*.2,q.x));",
    "  float rt=fbm3(q*6.);",
    "  vec3 rc=vec3(.02,.03,.05)+vec3(.05,.15,.2)*rt*.4;",
    "  rc+=mix(vec3(.2,1.,.9),vec3(.9,.3,1.),hash(floor(q*30.)))*step(.97-flashes*.05,hash(floor(q*30.)+floor(T*2.)))*smoothstep(.4,.1,length(fract(q*30.)-.5))*(.4+flashes*1.5);",
    "  // glowing river / vent along the canyon floor",
    "  float riv=abs(q.y-ground+.03+.02*sin(q.x*7.+id));rc+=vec3(.1,.9,1.)*exp(-riv*60.)*.8*step(.5,hash1(id+.3))*(.6+bass*.6);",
    "  col=mix(col,rc*fog+vec3(.0,.03,.06)*(1.-fog),rock*fade);",
    "  // bioluminescent kelp and plants swaying in the current",
    "  for(int k=0;k<3;k++){float fk=float(k);float kx=-.8+fk*.8+(hash1(id*3.+fk)-.5)*.5;float base=-.75+.18*fbm3(vec2(kx*1.3,id))+.08*sin(kx*3.+id);",
    "   float h=.25+.35*hash1(id+fk*7.);float yy=q.y-base;",
    "   float bend=sway*(.08+.1*hash1(fk+id))*yy*yy*4.+.03*sin(T*.9+yy*6.+fk);",
    "   float dx=abs(q.x-kx-bend);float stalk=smoothstep(.012,.0,dx)*step(0.,yy)*step(yy,h);",
    "   vec3 kc=mix(vec3(.2,1.,.6),vec3(.9,.4,1.),hash1(id+fk));",
    "   col+=kc*stalk*fade*fog*.9;",
    "   float tipd=length(vec2(q.x-kx-bend,yy-h));col+=kc*exp(-tipd*35.)*fade*fog*(1.+high*1.5);",
    "   col+=kc*exp(-tipd*8.)*fade*fog*.12;}",
    "  // drifting jellyfish",
    "  vec2 jc=vec2((hash1(id+5.)-.5)*1.6+.1*sin(T*.2+id),-.1+.5*hash1(id+11.)+.05*sin(T*.5+id));float gl;",
    "  float jd=jelly(q-jc,T*2.+id,gl);vec3 jcol=mix(vec3(.5,.8,1.),vec3(1.,.5,.9),hash1(id+2.));",
    "  col+=jcol*(smoothstep(.006,0.,jd)*.45+gl*.3)*fade*fog*(.7+high*.6+bass*.3);",
    " }",
    " // marine snow drifting several ways, and rising bubbles",
    " for(int L=0;L<2;L++){float fl=float(L);vec2 g=p*(18.+fl*14.)+vec2(T*(.3+fl*.2)*(fl>.5?-1.:1.)+sway*2.,-T*.2+zph*(3.+fl*4.));vec2 id=floor(g);float h=hash(id);",
    "  col+=vec3(.6,.8,.9)*step(.88,h)*smoothstep(.12,0.,length(fract(g)-.5))*(.25+fl*.15+high*.3);}",
    " vec2 bg=p*vec2(9.,5.)+vec2(0.,T*1.2)+vec2(0.,zph*2.);vec2 bid=floor(bg);float bh=hash(bid);vec2 bf=fract(bg)-.5;bf.x+=.15*sin(T*3.+bh*20.);",
    " float bub=abs(length(bf)-.13)-.01;col+=vec3(.6,.9,1.)*step(.95,bh)*(smoothstep(.02,0.,bub)*.5+smoothstep(.06,.0,length(bf-vec2(-.05,.05)))*.4);",
    " // viewing window of the exploration vehicle",
    " vec2 w=abs(p)-vec2(.82,.43);float frame=length(max(w,0.))+min(max(w.x,w.y),0.)-.08;",
    " col*=smoothstep(.06,-.02,frame);",
    " col+=vec3(.3,.8,1.)*smoothstep(.006,0.,abs(frame))*.25;",
    " col+=vec3(.4,.9,1.)*step(abs(p.y+.44),.002)*step(abs(p.x),.12)*.5+vec3(.4,.9,1.)*step(abs(p.x),.002)*step(abs(p.y),.03)*.25;",
    " col+=vec3(.3,.7,.9)*(1.-smoothstep(-.1,.0,frame))*.0;",
    " col*=.85+.15*smoothstep(1.,.3,length(p));",
    " gl_FragColor=vec4(tonemap(col*1.15),1.);",
    "}"
  ].join('\n'), robotdj: [
    "uniform vec4 jp[10];   // 0 head(xyz,yaw) 1 neck(xyz,pitch) 2 shL 3 elL 4 wrL 5 shR 6 elR 7 wrR 8 chest(xyz,lean) 9 (curlL,curlR,deckA,deckB)",
    "uniform float lasers, screens, crowd, cam;",
    "float mat;",
    "vec3 ROT_P;",
    "float handSD(vec3 p,vec3 w,vec3 e,float curl){",
    " vec3 dir=normalize(w-e);vec3 side=normalize(cross(dir,vec3(0.,1.,0.)));vec3 up=cross(side,dir);",
    " vec3 q=p-w;vec3 lq=vec3(dot(q,side),dot(q,up),dot(q,dir));",
    " float palm=sdRBox(lq-vec3(0.,0.,.06),vec3(.055,.022,.06),.015);",
    " float f=9.;",
    " for(int i=0;i<4;i++){float fi=float(i);float x=-.04+fi*.027;",
    "  vec3 a=vec3(x,0.,.12),b=a+vec3(0.,-.05*curl-.01,.07-.03*curl),c=b+vec3(0.,-.045*curl,.03-.04*curl);",
    "  f=min(f,min(sdCap(lq,a,b,.011),sdCap(lq,b,c,.01)));}",
    " f=min(f,sdCap(lq,vec3(-.06,0.,.04),vec3(-.09,-.02,.1),.012));",
    " return smin(palm,f,.01);",
    "}",
    "float robot(vec3 p){",
    " mat=0.;",
    " vec3 hd=jp[0].xyz,nk=jp[1].xyz,ch=jp[8].xyz;",
    " // torso: chest shell + segmented abdomen",
    " vec3 tp=p-ch;tp.xy=rot(jp[8].w)*tp.xy;",
    " vec3 tq=tp;tq.x*=1.+max(0.,-tq.y)*.9;",
    " float chest=sdRBox(tq,vec3(.36,.3,.2),.12)/(1.+max(0.,-tp.y)*.9);",
    " chest=smin(chest,sdEll(tp-vec3(0.,.22,0.),vec3(.5,.14,.2)),.08);",
    " chest=smin(chest,sdEll(tp-vec3(0.,.05,.12),vec3(.3,.25,.14)),.06);",
    " float ab=9.;for(int i=0;i<3;i++){float fi=float(i);ab=min(ab,sdCyl(tp-vec3(0.,-.38-fi*.13,0.),.05,.2-fi*.02));}",
    " float d=min(chest,ab);",
    " d=min(d,sdCap(p,nk,hd-vec3(0.,.12,0.),.06));",
    " // head: helmet, visor, headphones",
    " vec3 hp=p-hd;hp.xz=rot(jp[0].w)*hp.xz;hp.yz=rot(jp[1].w)*hp.yz;",
    " float helm=sdEll(hp,vec3(.19,.23,.21));",
    " helm=smin(helm,sdEll(hp-vec3(0.,-.1,.06),vec3(.13,.1,.15)),.05);",
    " float cup=sdCyl(vec3(abs(hp.x)-.2,hp.y,hp.z).yxz,.045,.1);",
    " float band=sdTor(vec3(hp.x,hp.y-.02,hp.z).xzy*vec3(1.,1.,1.),vec2(.215,.022));band=max(band,-hp.y+.0);",
    " float h=min(min(helm,cup),band);",
    " if(h<d){d=h;mat=hp.z>.1&&abs(hp.y-.02)<.05&&helm<cup?3.:(cup<helm?4.:1.);}",
    " // arms",
    " for(int s=0;s<2;s++){vec3 sh=s==0?jp[2].xyz:jp[5].xyz,el=s==0?jp[3].xyz:jp[6].xyz,wr=s==0?jp[4].xyz:jp[7].xyz;float curl=s==0?jp[9].x:jp[9].y;",
    "  float a=min(sdCap(p,sh,el,.07),sdCap(p,el,wr,.058));",
    "  a=min(a,length(p-sh)-.12);a=min(a,length(p-el)-.075);",
    "  float hn=handSD(p,wr,el,curl);",
    "  float aa=min(a,hn);if(aa<d){d=aa;mat=hn<a?2.:1.;}}",
    " return d;",
    "}",
    "float console(vec3 p){",
    " vec3 q=p-vec3(0.,.85,.55);",
    " float c=sdRBox(q,vec3(1.15,.2,.32),.03);",
    " c=max(c,-(q.y-.18+q.z*.15));",
    " return c;",
    "}",
    "float map(vec3 p){float r=robot(p);float c=console(p);if(c<r){mat=5.;return c;}return r;}",
    "vec3 clubEnv(vec3 rd){",
    " vec3 c=vec3(.02,.01,.04)+vec3(.5,.1,.6)*pow(max(rd.y,0.),.5)*.15;",
    " c+=vec3(1.,.2,.8)*pow(.5+.5*sin(rd.x*14.+T),20.)*.4*step(0.,rd.y)+vec3(.2,.8,1.)*pow(.5+.5*sin(rd.x*9.-T*.7+1.),24.)*.35*step(0.,rd.y);",
    " return c;",
    "}",
    "vec3 background(vec2 uv){",
    " vec3 c=vec3(.01,.005,.025);",
    " // LED walls with animated chevrons",
    " for(int i=-1;i<=1;i++){float fi=float(i);vec2 s=uv-vec2(fi*.62,.28);if(abs(s.x)<.22&&abs(s.y)<.12){",
    "  float chev=fract((abs(s.x)*3.+s.y*2.)*2.-T*(.6+screens*2.));float pat=smoothstep(.4,.5,chev)*smoothstep(.9,.8,chev);",
    "  c=mix(c,mix(vec3(.2,.6,1.),vec3(1.,.3,.9),.5+.5*sin(T*.3+fi)),pat*(.35+screens*.5)+.05);}}",
    " // lasers fanning from the stage",
    " for(int k=0;k<6;k++){float fk=float(k);vec2 o=vec2(fk<3.?-.9:.9,.45);float ang=(fk<3.?-.5:.5)+ (mod(fk,3.)-1.)*.22+sin(T*(.5+fk*.13)+fk)*.25*(1.+mid);",
    "  vec2 dir=vec2(sin(ang),-cos(ang));if(fk>=3.)dir.x=-abs(dir.x);else dir.x=abs(dir.x);vec2 q=uv-o;float al=dot(q,dir),ac=abs(dot(q,vec2(-dir.y,dir.x)));",
    "  c+=mix(vec3(1.,.2,.9),vec3(.3,.9,1.),mod(fk,2.))*exp(-ac*(300.-lasers*120.))*step(0.,al)*lasers*(.6+high*.8)*smoothstep(1.6,.2,al);}",
    " // haze",
    " c+=vec3(.35,.15,.5)*fbm3(uv*3.+vec2(T*.05,0.))*.18;",
    " // crowd silhouettes with raised hands",
    " float cy=-.36+.05*noise(vec2(uv.x*9.,1.))+.015*sin(uv.x*40.+T*5.)*crowd;",
    " float hands=0.;for(int k=0;k<9;k++){float fk=float(k);float x=-.9+fk*.23+.05*sin(fk*3.);float up=step(.4,hash1(fk+floor(T*1.5)))*crowd;",
    "  hands=max(hands,smoothstep(.012,.0,abs(uv.x-x-.02*sin(T*3.+fk)))*step(uv.y,cy+.15*up)*step(cy,uv.y));}",
    " float body=step(uv.y,cy)+hands;",
    " c=mix(c,vec3(.0,.0,.01)+vec3(.4,.1,.5)*.05,clamp(body,0.,1.));",
    " return c;",
    "}",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;",
    " vec3 ro=vec3(sin(cam)*.7,1.75+cos(cam*.7)*.06,5.)*1.,ta=vec3(0.,1.5,0.);",
    " vec3 fw=normalize(ta-ro),rt=normalize(cross(fw,vec3(0.,1.,0.))),up=cross(rt,fw);",
    " vec3 rd=normalize(fw*2.2+rt*uv.x+up*uv.y);",
    " vec3 col=background(uv);",
    " // volumetric spot beams",
    " for(int i=0;i<3;i++){float fi=float(i);vec2 o=vec2(-.6+fi*.6,.55);vec2 q=uv-o;float a=atan(q.x,-q.y)-sin(T*.4+fi*2.)*.4;",
    "  col+=vec3(.6,.3,1.)*smoothstep(.12,.0,abs(a))*smoothstep(1.2,.0,length(q))*.12*(1.+beat);}",
    " // raymarch inside the robot/console bounds",
    " vec3 bmin=vec3(-1.35,.5,-.5),bmax=vec3(1.35,2.6,.95);vec3 t0=(bmin-ro)/rd,t1=(bmax-ro)/rd;vec3 tmn=min(t0,t1),tmx=max(t0,t1);",
    " float tn=max(max(tmn.x,tmn.y),tmn.z),tf=min(min(tmx.x,tmx.y),tmx.z);",
    " if(tf>max(tn,0.)){",
    "  float t=max(tn,0.);float hit=0.;",
    "  for(int i=0;i<96;i++){if(float(i)>=60.+quality*36.)break;float d=map(ro+rd*t);if(d<.001){hit=1.;break;}t+=d;if(t>tf)break;}",
    "  if(hit>0.){vec3 p=ro+rd*t;float m=mat;vec2 e=vec2(.0015,-.0015);",
    "   vec3 n=normalize(e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx));",
    "   vec3 L=normalize(vec3(.4,.8,.6));float dif=max(dot(n,L),0.),fr=pow(1.-max(dot(n,-rd),0.),4.);",
    "   vec3 R=reflect(rd,n);vec3 env=clubEnv(R);",
    "   vec3 c;",
    "   if(m<.5||m==1.||m==2.){                                  // chrome & dark metal",
    "    vec3 base=m==2.?vec3(.25,.25,.3):vec3(.35,.36,.42);",
    "    c=base*dif*.35+env*(1.4+fr*2.)+vec3(1.,.3,.9)*fr*.3;",
    "    // circuitry glow traces on the chest plates",
    "    vec3 tp=p-jp[8].xyz;vec2 g=tp.xy*vec2(14.,14.);vec2 id=floor(g),f=fract(g);float hsh=hash(id);",
    "    float tr=(hsh<.5?smoothstep(.08,.0,abs(f.x-.5)):smoothstep(.08,.0,abs(f.y-.5)))*step(.4,hash(id+2.));",
    "    float onChest=step(length(tp/vec3(.5,.45,.3)),1.)*step(.05,tp.z);",
    "    float flow=.5+.5*sin(tp.y*20.-T*4.*(1.+mid)+hsh*6.);",
    "    c+=mix(vec3(1.,.2,.8),vec3(.2,.9,1.),step(0.,tp.x))*tr*onChest*(.6+flow*.8+beat*.6);",
    "   } else if(m==3.){ c=vec3(.2,.9,1.)*(1.5+high*1.5+beat)*(.6+.4*step(.5,fract(p.x*30.)));      // visor eyes",
    "   } else if(m==4.){ vec3 hp=p-jp[0].xyz;c=vec3(.03)+env*.5+vec3(.2,.6,1.)*smoothstep(.03,.0,abs(length(hp.yz)-.06))*1.5*(1.+bass);  // headphone rings",
    "   } else {                                                 // console with decks, faders and screens",
    "    vec3 q=p-vec3(0.,.85,.55);c=vec3(.03,.03,.05)+env*.35;",
    "    if(n.y>.5){vec2 d1=q.xz-vec2(-.6,0.),d2=q.xz-vec2(.6,0.);",
    "     for(int k=0;k<2;k++){vec2 dd=k==0?d1:d2;float ang=atan(dd.y,dd.x)+(k==0?jp[9].z:jp[9].w);float r=length(dd);",
    "      float plat=smoothstep(.2,.19,r);c=mix(c,vec3(.08,.08,.1)+vec3(.2,.6,1.)*step(.98,fract(ang*.159*8.))*.6+vec3(1.,.3,.9)*smoothstep(.01,.0,abs(r-.18))*(1.+beat),plat);}",
    "     float fad=step(abs(q.x),.25);vec2 fg=vec2(fract(q.x*12.),q.z);float sl=smoothstep(.02,.0,abs(fg.x-.5)-.01)*step(abs(q.z),.2)*fad;",
    "     c+=vec3(.3,.9,1.)*sl*.5;",
    "     float led=step(.8,hash(floor(q.xz*vec2(40.,20.))+floor(T*8.)))*step(.6,abs(q.x))*step(abs(q.z),.28)*(.3+high);",
    "     c+=mix(vec3(1.,.2,.8),vec3(.2,1.,.7),hash(floor(q.xz*vec2(40.,20.))))*led*.0+vec3(.6,.9,1.)*led*.4;",
    "     float wave=smoothstep(.01,.0,abs(q.z-.22-.03*sin(q.x*30.-T*8.)*(.3+bass)))*step(abs(q.x),.25);c+=vec3(.2,1.,.8)*wave;",
    "    } else { c+=vec3(1.,.2,.8)*smoothstep(.01,.0,abs(q.y+.1))*(.8+bass)+vec3(.2,.8,1.)*smoothstep(.006,.0,abs(q.y-.05))*.6; }",
    "   }",
    "   col=c;",
    "  }",
    " }",
    " // floor reflection glow",
    " col+=vec3(.5,.15,.6)*exp(-abs(uv.y+.45)*12.)*.08*(1.+bass);",
    " col*=.82+.18*smoothstep(1.2,.3,length(uv));",
    " gl_FragColor=vec4(tonemap(col),1.);",
    "}"
  ].join('\n'), mushroomworld: [
    "uniform float camx, flow, burst, open, spores;",
    "vec3 shroom(vec2 p,vec2 base,float h,float R,float hue,float puls,float sw,float seed,inout float mask,float fog){",
    " vec2 q=p-base;",
    " float bend=sw*q.y*q.y*.6;",
    " vec2 cap=vec2(bend*0.+sw*h*h*.6,h);",
    " float sx=q.x-sw*q.y*q.y*.6;",
    " float sw2=.12*R*(1.+.5*smoothstep(h*.25,0.,q.y));",
    " vec3 c=vec3(0.);float m=0.;",
    " // stem with roots",
    " float stem=step(abs(sx),sw2)*step(-.02,q.y)*step(q.y,h);",
    " if(stem>0.){float u=sx/sw2;c=mix(vec3(.25,.12,.2),vec3(.9,.6,.5),pow(1.-u*u,.6)*.6)*(.4+.6*smoothstep(0.,h,q.y));",
    "  c+=vec3(1.,.5,.6)*smoothstep(h*.6,h,q.y)*.4;m=1.;}",
    " // cap dome with patterned top and glowing gills beneath",
    " float Rr=R*(1.+puls*.12);vec2 cq=vec2(q.x-cap.x,q.y-cap.y);",
    " float dome=length(cq/vec2(Rr,Rr*.55));",
    " if(dome<1.&&cq.y>-.02*R){float z=sqrt(1.-dome*dome);",
    "  float pat=seed<.33?step(.6,noise(cq*28./R+seed*9.)):seed<.66?pow(1.-abs(fbm3(cq*14./R+seed*5.)*2.-1.),6.):.5+.5*sin(length(cq)*90./R-T*.5);",
    "  vec3 cc=.5+.5*cos(6.283*(hue+vec3(0.,.33,.67)));",
    "  c=cc*(.25+.75*z)*(.55+.45*pat)+vec3(1.)*pow(z,8.)*.12;c+=cc*smoothstep(.85,1.,dome)*.4;m=1.;}",
    " float under=step(abs(cq.x),Rr*.97)*step(cq.y,.0)*step(-.22*R*(1.-cq.x*cq.x/(Rr*Rr))-.01*R,cq.y);",
    " if(under>0.&&m<.5){float ang=atan(cq.x,-cq.y-.0);float gills=.5+.5*sin(cq.x/Rr*60.);",
    "  float dep=-cq.y/(.22*R+.001);c=mix(vec3(1.,.4,.35),vec3(1.,.85,.6),gills)*(.5+open*.8+puls*.3)*(1.-dep*.6);m=1.;}",
    " // glow halo around the cap",
    " c+=(.5+.5*cos(6.283*(hue+vec3(0.,.33,.67))))*exp(-max(dome-1.,0.)*6.)*.15*(1.+puls)*(1.-m);",
    " mask=max(mask,m*fog);",
    " return c*fog;",
    "}",
    "void main(){",
    " vec2 p=(gl_FragCoord.xy-.5*res)/res.y;",
    " float hz=.02;",
    " // sky: dark forest canopy, stars and a swirling cosmic vortex",
    " vec3 col=mix(vec3(.03,.0,.06),vec3(.0,.01,.03),p.y+.5);",
    " vec2 vq=p-vec2(.55-camx*.05,.32);float va=atan(vq.y,vq.x),vr=length(vq*vec2(1.,1.6));",
    " col+=vec3(1.,.3,.8)*exp(-vr*6.)*(.5+.5*sin(va*3.-log(vr+.01)*6.+T*.5))*.6;",
    " col+=vec3(.9,.8,1.)*stars(p,70.,.975)*.6*(.6+high);",
    " // far forest silhouettes",
    " float tree=0.;for(int i=0;i<10;i++){float fi=float(i);float x=-1.2+fi*.27-camx*.15;float w=.012+.01*hash1(fi);tree=max(tree,step(abs(p.x-x+.02*sin(p.y*10.+fi)),w));}",
    " col=mix(col,vec3(.02,.0,.03),tree*step(hz-.05,p.y)*.8);",
    " // ground plane with a glowing winding stream",
    " if(p.y<hz){float z=.35/(hz-p.y+.01);float wx=p.x*z+camx*1.5;float sx=.6*sin(z*.35+1.)+.25*sin(z*.9);",
    "  vec3 g=vec3(.03,.01,.04)+vec3(.15,.05,.2)*fbm3(vec2(wx*.8,z*.6))*.5;",
    "  float st=smoothstep(.25,.12,abs(wx-sx));float ripple=fbm3(vec2(wx*3.,z*2.-flow*2.));",
    "  float sparkle=pow(ripple,4.)*3.;g=mix(g,mix(vec3(.9,.2,.15),vec3(1.,.65,.3),ripple)*(.4+.9*ripple+sparkle)*(.8+bass*.4)+vec3(.8,.2,.6)*.1,st);",
    "  g*=exp(-z*.04);col=g;}",
    " // three depths of mushrooms",
    " float mask=0.;vec3 acc=vec3(0.);",
    " for(int L=0;L<3;L++){float fl=float(L);float par=.25+fl*.45;float fog=.45+fl*.28;float sc=.42+fl*.33;",
    "  for(int i=0;i<5;i++){float fi=float(i);float sd=hash1(fi*7.+fl*31.);",
    "   float bx=-1.1+fi*.55+(sd-.5)*.3-camx*par;bx=mod(bx+1.5,3.)-1.5;",
    "   float by=hz-.02-fl*.12-sd*.04;float h=(.12+.16*sd)*sc;float R=(.12+.1*hash1(sd*13.))*sc*(1.5-fl*.2);",
    "   float ph=T*(.4+sd)*1.+fi;float puls=bass*(.6+sd*.6)+burst*.6+.15*sin(ph);",
    "   float sw=(.25*sin(T*.5+fi*1.7)+mid*.5*sin(T*1.3+fi))*.25;",
    "   float m=0.;vec3 c=shroom(p,vec2(bx,by),h,R,sd,puls,sw,hash1(sd*5.),m,fog);",
    "   col=mix(col,c,m);col+=c*(1.-m)*1.;",
    "  }",
    " }",
    " // foreground plants: curled fronds and luminous flowers opening and closing",
    " for(int i=0;i<6;i++){float fi=float(i);vec2 b=vec2(-1.+fi*.4-camx*1.6,-.5);b.x=mod(b.x+1.2,2.4)-1.2;",
    "  vec2 q=p-b;float yy=q.y;float curl=.06*sin(yy*12.+T*(.6+mid)+fi);float fr=smoothstep(.01,.0,abs(q.x-curl-yy*yy*.4*sin(fi)))*step(0.,yy)*step(yy,.22+.08*hash1(fi));",
    "  col=mix(col,vec3(.05,.25,.2)+vec3(.2,1.,.6)*fr*.2,fr*.9);",
    "  vec2 fq=q-vec2(curl+.22*.22*.4*sin(fi),.24+.08*hash1(fi));float fa=atan(fq.y,fq.x),fl2=length(fq);",
    "  float petals=.03*(.4+.6*open)*(1.+.5*sin(fa*6.+fi));col+=mix(vec3(1.,.3,.8),vec3(.3,.9,1.),hash1(fi+2.))*(smoothstep(petals,petals*.6,fl2)*.8+exp(-fl2*30.)*.3*(1.+high));}",
    " // small glowing creatures crawling through the undergrowth",
    " for(int i=0;i<4;i++){float fi=float(i);float x=fract(T*.03*(1.+fi*.3)+fi*.27)*2.6-1.3;vec2 c0=vec2(x,-.38-fi*.025+.01*sin(T*6.+fi));",
    "  for(int k=0;k<5;k++){float fk=float(k);vec2 sp=c0-vec2(fk*.014,.004*sin(T*8.-fk+fi));col+=vec3(.6,1.,.5)*exp(-length(p-sp)*220.)*1.2;}}",
    " // spores drifting and released in clouds",
    " for(int L=0;L<2;L++){float fl=float(L);vec2 g=p*(14.+fl*10.)+vec2(sin(p.y*3.+T*.3)*.8-camx*(2.+fl),-T*(.35+fl*.2));vec2 id=floor(g);float h=hash(id);",
    "  col+=mix(vec3(.9,1.,.5),vec3(1.,.5,1.),hash(id+1.))*step(.9-spores*.08,h)*smoothstep(.15,0.,length(fract(g)-.5))*(.35+spores*1.2);}",
    " // mist",
    " col+=vec3(.3,.1,.4)*fbm3(p*vec2(2.,6.)+vec2(T*.05-camx,0.))*smoothstep(.15,-.2,p.y)*.18;",
    " col*=.85+.15*smoothstep(1.2,.3,length(p));",
    " gl_FragColor=vec4(tonemap(col*1.1),1.);",
    "}"
  ].join('\n'), ufo: [
    "uniform vec3 upos;      // craft position",
    "uniform vec3 uang;      // yaw, tilt x, tilt z",
    "uniform float ringA, ringB, tractor, field, sweep, discharge;",
    "uniform vec4 minis[3];",
    "float mt;",
    "vec3 toLocal(vec3 p){p-=upos;p.xz=rot(uang.x)*p.xz;p.xy=rot(uang.z)*p.xy;p.yz=rot(uang.y)*p.yz;return p;}",
    "float craft(vec3 p){",
    " vec3 q=toLocal(p);mt=0.;",
    " float disc=sdEll(q,vec3(1.6,.2,1.6));",
    " float dome=sdEll(q-vec3(0.,.16,0.),vec3(.55,.36,.55));",
    " float d=smin(disc,dome,.12);",
    " float rim=sdTor(q,vec2(1.52,.075));if(rim<d){d=rim;mt=1.;}",
    " float under=sdTor(q-vec3(0.,-.16,0.),vec2(.85,.07));if(under<d){d=under;mt=2.;}",
    " float core=sdCyl(q-vec3(0.,-.2,0.),.03,.5);if(core<d){d=core;mt=3.;}",
    " return d;",
    "}",
    "vec3 sky(vec2 uv){",
    " vec3 c=mix(vec3(.02,.09,.1),vec3(.0,.01,.03),smoothstep(-.1,.6,uv.y));",
    " float neb=fbm(uv*vec2(2.,3.)+vec2(T*.005,0.));float neb2=fbm(uv*4.+neb*2.+3.);",
    " c+=mix(vec3(.1,.8,.6),vec3(.9,.2,.7),neb2)*pow(neb,2.5)*1.2*smoothstep(-.1,.4,uv.y)*smoothstep(.3,-.3,uv.x-.6+uv.y*.4);",
    " c+=vec3(.8,.9,1.)*stars(uv,80.,.97)*.8*(.6+high*.6);",
    " // big ringed planet and small moon",
    " vec2 pc=uv-vec2(-.72,.33);float pr=length(pc);",
    " if(pr<.2){float z=sqrt(1.-pr*pr/.04);c=mix(c,vec3(.25,.22,.3)*(.25+.75*max(0.,dot(normalize(vec3(pc,z*.2)),normalize(vec3(.6,.3,.5)))))*(.8+.4*fbm3(pc*10.)),smoothstep(.2,.195,pr));}",
    " vec2 rq=rot(-.35)*pc;float ring=abs(length(rq*vec2(1.,3.4))-.29);c+=vec3(.8,.3,.8)*smoothstep(.02,.0,ring)*.35*step(.0,rq.y*-1.+.02*0.+(pr>.2?1.:-1.)*1.);",
    " vec2 mc=uv-vec2(-.42,.06);c=mix(c,vec3(.5,.55,.6)*(.4+.6*fbm3(mc*30.)),smoothstep(.03,.028,length(mc)));",
    " return c;",
    "}",
    "vec3 land(vec2 uv,float hz){",
    " vec3 c=sky(uv);",
    " float m1=hz+.13*fbm(vec2(uv.x*1.6,2.))+.05*noise(vec2(uv.x*6.,1.));",
    " float m2=hz+.06*fbm(vec2(uv.x*3.+5.,4.));",
    " c=mix(c,vec3(.06,.07,.09)+vec3(.1,.4,.35)*.12,smoothstep(.002,-.002,uv.y-m1));",
    " c=mix(c,vec3(.05,.05,.07)*(.6+.4*fbm3(uv*20.)),smoothstep(.002,-.002,uv.y-m2));",
    " // stepped pyramid in the middle distance",
    " vec2 pq=uv-vec2(.08,hz);float step6=floor(clamp(pq.y,0.,.2)/.025);float pw=.2-step6*.023;",
    " float pyr=step(abs(pq.x),pw)*step(0.,pq.y)*step(pq.y,.2);",
    " c=mix(c,vec3(.12,.06,.14)+vec3(.3,.1,.35)*fract(pq.y/.025)*.3+vec3(.1,1.,.8)*step(abs(pq.x),.018)*step(pq.y,.07)*(.6+bass*.6),pyr);",
    " if(uv.y<hz){float z=1./(hz-uv.y+.02);",
    "  vec3 g=vec3(.12,.11,.12)*(.55+.45*fbm(vec2(uv.x*z*.8,z*1.5)));",
    "  g*=.6+.4*smoothstep(.0,.25,hz-uv.y);",
    "  c=mix(c,g,smoothstep(.002,-.002,uv.y-hz));}",
    " return c;",
    "}",
    "float seg2(vec2 p,vec2 a,vec2 b,float r){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h)-r;}",
    "float cactus(vec2 p,float h,float s){",
    " float d=seg2(p,vec2(0.,0.),vec2(0.,h),.028*s);",
    " d=min(d,seg2(p,vec2(0.,h*.42),vec2(-.07*s,h*.42),.018*s));d=min(d,seg2(p,vec2(-.07*s,h*.42),vec2(-.07*s,h*.75),.018*s));",
    " d=min(d,seg2(p,vec2(0.,h*.55),vec2(.065*s,h*.55),.016*s));d=min(d,seg2(p,vec2(.065*s,h*.55),vec2(.065*s,h*.82),.016*s));",
    " return d;",
    "}",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;",
    " float hz=-.12;",
    " vec3 ro=vec3(0.,0.,5.),rd=normalize(vec3(uv,-1.8));",
    " // energy field distorts the air around the craft",
    " vec2 cs=(upos.xy)/(ro.z-upos.z)*1.8;float cr=length((uv-cs)*vec2(1.,2.5));",
    " vec2 duv=uv+(vec2(noise(uv*30.+T*2.),noise(uv*30.-T*2.))-.5)*.012*field*exp(-cr*3.);",
    " vec3 col=land(duv,hz);",
    " // searchlights sweeping the landscape",
    " vec2 under=cs-vec2(0.,.08);",
    " for(int i=0;i<2;i++){float fi=float(i);float gx=sin(sweep*(1.+fi*.3)+fi*2.)*.6;vec2 g=vec2(gx,hz-.12-.05*fi);",
    "  vec2 ab=g-under;float k=clamp(dot(uv-under,ab)/dot(ab,ab),0.,1.);float w=.005+k*.06;float dd=length(uv-under-ab*k);",
    "  col+=vec3(.6,1.,.9)*smoothstep(w,0.,dd)*(.08+.1*k)*(.7+high*.5);",
    "  col+=vec3(.5,1.,.8)*exp(-length((uv-g)*vec2(1.,4.))*14.)*.35*step(uv.y,hz);}",
    " // tractor beam: volumetric cone with motes rising",
    " vec2 bq=uv-under;float bw=.12+(-bq.y)*.35;float inB=smoothstep(bw,bw*.6,abs(bq.x))*step(bq.y,0.)*step(hz-.15,uv.y);",
    " float swirl=fbm3(vec2(bq.x*9./max(bw,.05),bq.y*6.+T*1.5));",
    " col+=vec3(.95,.3,.8)*inB*(.25+.5*swirl)*tractor*(.8+bass*.6);",
    " vec2 mg=vec2(bq.x*140.,bq.y*90.+T*14.);col+=vec3(1.,.7,.95)*inB*step(.95,hash(floor(mg)))*smoothstep(.4,.1,length(fract(mg)-.5))*tractor;",
    " col+=vec3(.95,.35,.8)*exp(-length((uv-vec2(under.x,hz-.13))*vec2(1.,5.))*6.)*tractor*.5;",
    " // foreground cacti and glowing crystals",
    " for(int i=0;i<4;i++){float fi=float(i);vec2 cp=vec2(-.95+fi*.62+.1*sin(fi*7.),-.5);float h=.25+.12*hash1(fi*3.);float s=1.2+hash1(fi)*.6;",
    "  float d=cactus(uv-cp,h,s);col=mix(col,vec3(.02,.06,.05)+vec3(.1,.5,.4)*.12,smoothstep(.003,-.003,d));",
    "  col+=vec3(.2,1.,.8)*smoothstep(.006,0.,abs(d))*.2*(.4+high);}",
    " for(int i=0;i<3;i++){float fi=float(i);vec2 kp=uv-vec2(-.6+fi*.7,-.47);vec2 aq=abs(kp);float tri=max(aq.x*1.4+kp.y*.8-.05,-kp.y-.02);",
    "  float glow=.6+.4*sin(T*2.+fi*2.)+beat*.6;col=mix(col,mix(vec3(.3,.2,1.),vec3(1.,.3,.9),fract(kp.y*20.+fi))*glow*.8,smoothstep(.004,-.004,tri));",
    "  col+=vec3(.7,.4,1.)*exp(-max(tri,0.)*40.)*.2*glow;}",
    " // small craft circling the mothership",
    " for(int i=0;i<3;i++){vec4 m=minis[i];vec2 q=uv-m.xy;float sz=m.z;",
    "  col+=vec3(.6,1.,.9)*smoothstep(sz*1.6,sz,length(q*vec2(1.,3.)))*1.4+vec3(.4,1.,.8)*exp(-length(q*vec2(1.,2.))/sz*.8)*.5;",
    "  vec2 tq=q-vec2(m.w*.08,0.);col+=vec3(.3,.9,.8)*exp(-abs(q.y)/sz*6.)*smoothstep(0.,m.w*.15,q.x*sign(m.w))*step(abs(q.x),.15)*.12;}",
    " // the mothership",
    " float bt=dot(upos-ro,rd);float bd=length(ro+rd*bt-upos);",
    " if(bd<1.75){float t=max(0.,bt-1.8),hit=0.;",
    "  for(int i=0;i<80;i++){if(float(i)>=50.+quality*30.)break;float d=craft(ro+rd*t);if(d<.002){hit=1.;break;}t+=d;if(t>bt+2.)break;}",
    "  if(hit>0.){vec3 p=ro+rd*t;float m=mt;vec2 e=vec2(.002,-.002);",
    "   vec3 n=normalize(e.xyy*craft(p+e.xyy)+e.yyx*craft(p+e.yyx)+e.yxy*craft(p+e.yxy)+e.xxx*craft(p+e.xxx));",
    "   vec3 q=toLocal(p);float ang=atan(q.z,q.x),r=length(q.xz);",
    "   vec3 L=normalize(vec3(-.4,.6,.7));float dif=max(dot(n,L),0.),fr=pow(1.-max(dot(n,-rd),0.),3.);",
    "   vec3 env=sky(vec2(reflect(rd,n).x*.5,max(reflect(rd,n).y,.0)*.6));",
    "   vec3 c=vec3(.09,.1,.12)*(.2+dif*.9)+env*.22*(.3+fr)+vec3(.1,.9,.7)*fr*.12;",
    "   // hull panels and circuit lines",
    "   float panels=smoothstep(.02,.0,abs(fract(ang*12./6.283)-.5)-.47)+smoothstep(.01,0.,abs(fract(r*5.)-.5)-.47);",
    "   c+=vec3(.1,.8,.6)*panels*.35*step(0.,q.y)*(.6+.4*sin(ang*3.+T));",
    "   float glyph=step(.75,hash(floor(vec2(ang*30./6.283,r*14.))))*step(abs(fract(r*14.)-.5),.3)*step(.0,q.y)*step(.65,r);c+=vec3(.2,1.,.8)*glyph*.35*(.6+mid);",
    "   if(m==1.){float la=fract(ang*48./6.283+ringA*2.);float lights=smoothstep(.35,.2,abs(la-.5))*smoothstep(.05,.02,abs(q.y));vec3 lc=mix(vec3(.2,1.,.7),vec3(1.,.4,.9),step(.5,fract(ang*3./6.283+ringA*.25)));",
    "    c=vec3(.05,.06,.07)+env*.2+lc*lights*(1.+high*1.2+discharge*1.5);}",
    "   if(m==2.){float tl=exp(-pow(mod(ang-ringB*1.5,6.283)-3.14,2.)*4.);c=vec3(.06)+vec3(1.,.3,.85)*(.4+tl*2.+bass*.6);}",
    "   if(m==3.){c=vec3(1.,.5,.95)*(1.2+tractor*1.5+bass)*(.7+.3*sin(r*40.-T*6.));}",
    "   float win=step(abs(q.y-.24),.04)*step(.5,fract(ang*10./6.283))*step(r,.56);",
    "   c+=vec3(.6,1.,.9)*win*(.8+high*.6);",
    "   col=c;",
    "  } else {",
    "   col+=vec3(.2,1.,.8)*exp(-bd*bd*1.5)*.05*field;",
    "  }",
    " }",
    " // discharge rings expanding from the rim on strong beats",
    " float er=length((uv-cs)*vec2(1.,3.))-discharge*.0;col+=vec3(.6,1.,.9)*exp(-abs(er-(1.-discharge)*.9-.2)*30.)*discharge*.6;",
    " col*=.85+.15*smoothstep(1.2,.3,length(uv));",
    " gl_FragColor=vec4(tonemap(col),1.);",
    "}"
  ].join('\n'), rollercoaster: [
    "uniform float zc, speed, pulse, flash;",
    "float secAmp(float z){return 1.+.8*sin(z*.004)+.5*sin(z*.0017+2.);}",
    "vec2 path(float z){float a=secAmp(z);return vec2(3.2*a*sin(z*.045)+1.6*sin(z*.11+1.),2.2*a*sin(z*.037+1.3)+1.2*cos(z*.09));}",
    "float bank(float z){vec2 d1=path(z+1.)-path(z-1.);vec2 d2=path(z+2.)-2.*path(z)+path(z-2.);return clamp(-d2.x*1.4,-.9,.9);}",
    "float mt;",
    "float scene(vec3 p){",
    " vec2 c=path(p.z);vec3 q=vec3(p.xy-c,p.z);q.xy=rot(bank(p.z))*q.xy;",
    " vec3 rq=vec3(abs(q.x)-.55,q.y,q.z);",
    " float rails=length(rq.xy)-.04;",
    " float spine=length(q.xy-vec2(0.,-.24))-.07;",
    " float tz=mod(q.z,1.1)-.55;float ties=sdBox(vec3(q.x,q.y+.13,tz),vec3(.6,.03,.05));",
    " ties=min(ties,sdBox(vec3(abs(q.x)-.3,q.y+.18,tz),vec3(.02,.07,.04)));",
    " float d=rails;mt=0.;",
    " if(spine<d){d=spine;mt=1.;} if(ties<d){d=ties;mt=1.;}",
    " // support pylons dropping into the void",
    " float pz=mod(q.z,9.)-4.5;float pyl=sdCap(vec3(q.x,q.y,pz),vec3(0.,-.25,0.),vec3(0.,-9.,0.),.09);if(pyl<d){d=pyl;mt=1.;}",
    " // giant loops the track passes through",
    " float lz=mod(p.z,46.)-23.;float lp=sdTor(vec3(q.x,lz,q.y-.6),vec2(3.1+sin(floor(p.z/46.))*.6,.16));",
    " if(lp<d){d=lp;mt=2.;}",
    " // impossible secondary tracks spiralling around ours",
    " float ha=p.z*.35+T*.0;vec2 hc=vec2(cos(ha),sin(ha))*5.5;float hel=length(q.xy-hc)-.09;",
    " vec2 hc2=vec2(cos(ha*.7+3.),sin(ha*.7+3.))*8.;hel=min(hel,length(q.xy-hc2)-.12);",
    " if(hel<d){d=hel;mt=3.;}",
    " // floating platforms and geometric formations",
    " vec3 fp=vec3(abs(q.x)-7.,q.y-2.+sin(floor(p.z/18.))*3.,mod(p.z,18.)-9.);",
    " fp.xz=rot(T*.2+floor(p.z/18.))*fp.xz;",
    " float plat=sdRBox(fp,vec3(1.,.12,1.),.05);plat=min(plat,sdBox(fp-vec3(0.,.6,0.),vec3(.25,.5,.25)));",
    " if(plat<d){d=plat;mt=4.;}",
    " return d;",
    "}",
    "vec3 space(vec3 rd){",
    " vec2 sp=vec2(atan(rd.x,rd.z),asin(clamp(rd.y,-1.,1.)));",
    " float sec=zc*.003;",
    " vec3 c=vec3(.01,.005,.03);",
    " float n=fbm(sp*1.5+vec2(sec,0.)),n2=fbm(sp*3.+n*2.);",
    " c+=mix(vec3(.5,.1,.8),vec3(.1,.4,1.),n2)*pow(n,2.)*1.3;",
    " c+=mix(vec3(1.,.3,.7),vec3(.2,.9,1.),.5+.5*sin(sec*3.))*pow(n2,4.)*.6;",
    " // distant galaxy",
    " vec2 g=sp-vec2(.4+sin(sec)*.3,.25);float ga=atan(g.y,g.x),gr=length(g*vec2(1.,2.2));",
    " c+=vec3(.9,.6,1.)*exp(-gr*9.)*(.6+.4*sin(ga*2.-log(gr+.01)*5.))*.8;",
    " vec2 sg=sp*vec2(90.,90.);vec2 id=floor(sg);float h=hash(id);",
    " c+=vec3(.9,.9,1.)*step(.975,h)*smoothstep(.3,0.,length(fract(sg)-.5))*(.6+high);",
    " return c;",
    "}",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;",
    " vec3 ro=vec3(path(zc),zc);float bk=bank(zc);",
    " vec2 up2=rot(-bk)*vec2(0.,.5);ro.xy+=up2;",
    " vec3 ta=vec3(path(zc+4.),zc+4.);ta.xy+=rot(-bank(zc+4.))*vec2(0.,.3);",
    " vec3 fw=normalize(ta-ro);vec3 wu=vec3(rot(-bk*.85)*vec2(0.,1.),0.);vec3 rt=normalize(cross(fw,wu));vec3 up=cross(rt,fw);",
    " float fov=1.25-speed*.12;",
    " vec3 rd=normalize(fw*fov+rt*uv.x+up*uv.y);",
    " vec3 col=space(rd);",
    " // star streaks when speeding",
    " col+=vec3(.7,.8,1.)*pow(max(0.,noise(vec2(atan(uv.y,uv.x)*40.,length(uv)*3.-zc*.5))-.6)*2.5,3.)*smoothstep(.15,.7,length(uv))*speed*.6*(.5+high);",
    " float t=.05,hit=0.;",
    " for(int i=0;i<100;i++){if(float(i)>=60.+quality*40.)break;float d=scene(ro+rd*t);if(d<.002*t){hit=1.;break;}t+=d*.8;if(t>70.)break;}",
    " if(hit>0.){vec3 p=ro+rd*t;float m=mt;vec2 e=vec2(.003,-.003);",
    "  vec3 n=normalize(e.xyy*scene(p+e.xyy)+e.yyx*scene(p+e.yyx)+e.yxy*scene(p+e.yxy)+e.xxx*scene(p+e.xxx));",
    "  float fr=pow(1.-max(dot(n,-rd),0.),3.);vec3 env=space(reflect(rd,n));",
    "  vec3 c;",
    "  float sec=floor(p.z/120.);vec3 hueA=mix(vec3(1.,.25,.85),vec3(.3,.8,1.),.5+.5*sin(sec*1.7)),hueB=mix(vec3(.6,.3,1.),vec3(1.,.4,.6),.5+.5*sin(sec*2.3));",
    "  if(m==0.){float flow=pow(fract(p.z*.08-pulse),6.);c=hueA*(1.4+mid*.8)+vec3(1.)*flow*1.5*(.5+beat)+env*.3;}",
    "  else if(m==1.){c=vec3(.12,.1,.16)*(.3+.7*max(n.y,0.))+env*.6*(.4+fr)+hueA*fr*.4;}",
    "  else if(m==2.){c=hueB*(1.2+.6*sin(p.z*.5+T)+flash*1.5)+env*.2;}",
    "  else if(m==3.){c=mix(hueA,hueB,.5)*(.9+.4*sin(p.z*2.-T*4.)*(.5+high));}",
    "  else {c=vec3(.08,.07,.12)*(.4+.6*max(dot(n,normalize(vec3(.3,1.,.2))),0.))+env*.4*fr+hueB*smoothstep(.03,.0,abs(fract(p.z*.5)-.5)-.47)*.6;}",
    "  float fog=exp(-t*.035);col=mix(col,c,fog)+c*0.;col=mix(space(rd)*.9,c,fog);",
    "  col+=hueA*exp(-t*.15)*.0;",
    " }",
    " // light flash travelling along the track on beats (no full-screen strobing)",
    " col*=.85+.15*smoothstep(1.3,.3,length(uv));",
    " gl_FragColor=vec4(tonemap(col),1.);",
    "}"
  ].join('\n'), livingskull: [
    "uniform vec3 hrot;      // yaw, pitch, roll",
    "uniform float jaw, glow, crack, beam, mouthE, frag;",
    "float smax(float a,float b,float k){return -smin(-a,-b,k);}",
    "float teethRow(vec3 p,float y,float zc,float rad,float h){",
    " vec3 q=p-vec3(0.,y,zc);float a=atan(q.x,q.z);float sec=.21;",
    " float ia=clamp(floor(a/sec+.5),-4.,4.);float la=a-ia*sec;",
    " vec2 rq=vec2(length(q.xz)*sin(la),length(q.xz)*cos(la)-rad);",
    " float w=ia==0.||abs(ia)==1.?.042:.036;",
    " return sdRBox(vec3(rq.x,q.y,rq.y),vec3(w,h,.035),.014);",
    "}",
    "float bone(vec3 p,out float mat){",
    " mat=0.;",
    " float cr=sdEll(p-vec3(0.,.3,-.16),vec3(.68,.76,.86));",
    " float face=sdEll(p-vec3(0.,-.16,.3),vec3(.42,.42,.36));",
    " face=smin(face,sdEll(p-vec3(0.,-.38,.36),vec3(.3,.12,.22)),.1);",
    " float d=smin(cr,face,.18);",
    " vec3 sp=vec3(abs(p.x),p.yz);",
    " d=smin(d,sdCap(sp,vec3(.33,-.1,.38),vec3(.58,-.08,.05),.075),.08);       // cheekbones",
    " d=smin(d,sdCap(sp,vec3(.56,-.1,.05),vec3(.44,-.24,-.1),.05),.06);       // zygomatic arch to the jaw joint",
    " d=smin(d,sdCap(p,vec3(-.38,.12,.5),vec3(.38,.12,.5),.07),.1);            // brow ridge",
    " d=smax(d,-sdEll(sp-vec3(.23,.0,.52),vec3(.165,.16,.3)),.03);            // eye sockets",
    " d=smax(d,-sdEll(p-vec3(0.,-.24,.62),vec3(.07,.11,.2)),.02);                // nasal cavity",
    " d=smax(d,-sdEll(sp-vec3(.74,.0,.02),vec3(.08,.2,.26)),.05);               // temporal hollows",
    " d=max(d,-(p.y+.42));                                                    // open below the maxilla",
    " float up=teethRow(p,-.47,.17,.33,.055);",
    " if(up<d){mat=1.;} d=min(d,up);",
    " // mandible hinged at the jaw joint",
    " vec3 jp=p-vec3(0.,-.32,-.12);jp.yz=rot(jaw)*jp.yz;jp+=vec3(0.,-.32,-.12);",
    " vec3 sj=vec3(abs(jp.x),jp.yz);",
    " float ram=sdCap(sj,vec3(.4,-.28,-.1),vec3(.38,-.62,.02),.065);",
    " float body=sdCap(sj,vec3(.37,-.63,.04),vec3(.17,-.72,.36),.065);",
    " float chin=max(sdEll(jp-vec3(0.,-.74,.38),vec3(.2,.11,.1)),jp.y+.6);",
    " float man=smin(smin(ram,body,.08),chin,.1);",
    " float lo=teethRow(jp,-.6,.17,.31,.05);",
    " man=min(man,lo);",
    " if(man<d){mat=lo<man+.001?1.:2.;}",
    " d=min(d,man);",
    " return d;",
    "}",
    "float map(vec3 p,out float mat){",
    " p.xz=rot(hrot.x)*p.xz;p.yz=rot(hrot.y)*p.yz;p.xy=rot(hrot.z)*p.xy;",
    " float d=bone(p,mat);",
    " if(d<.05&&mat<.5)d+=(noise(p.xy*14.)+noise(p.yz*13.)-1.)*.006;  // bone surface texture",
    " return d;",
    "}",
    "vec3 skullSpace(vec3 p){p.xz=rot(hrot.x)*p.xz;p.yz=rot(hrot.y)*p.yz;p.xy=rot(hrot.z)*p.xy;return p;}",
    "vec3 worldFromSkull(vec3 s){s.xy=rot(-hrot.z)*s.xy;s.yz=rot(-hrot.y)*s.yz;s.xz=rot(-hrot.x)*s.xz;return s;}",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;",
    " vec3 ro=vec3(0.,-.1,4.2),rd=normalize(vec3(uv,-2.05));",
    " // background: dark dimension with drifting violet smoke",
    " vec3 col=vec3(.012,.006,.02)+vec3(.12,.03,.2)*fbm(uv*2.+vec2(T*.03,-T*.02))*.6*(1.-length(uv)*.6);",
    " col+=vec3(.6,.2,1.)*stars(uv,70.,.985)*.35;",
    " float t=0.,m=0.;float hit=0.,minD=9.;",
    " // bounding sphere",
    " float bb=dot(ro,rd);float cc=dot(ro,ro)-2.3;float disc=bb*bb-cc;",
    " if(disc>0.){t=max(0.,-bb-sqrt(disc));",
    "  for(int i=0;i<90;i++){if(float(i)>=58.+quality*32.)break;vec3 p=ro+rd*t;float d=map(p,m);minD=min(minD,d);if(d<.0015){hit=1.;break;}t+=d*.85;if(t>6.)break;}}",
    " vec3 sp0=worldFromSkull(vec3(.25,0.,.5)),sp1=worldFromSkull(vec3(-.25,0.,.5)),mo=worldFromSkull(vec3(0.,-.55,.4));",
    " if(hit>0.){",
    "  vec3 p=ro+rd*t;vec2 e=vec2(.002,-.002);float mm;",
    "  vec3 n=normalize(e.xyy*map(p+e.xyy,mm)+e.yyx*map(p+e.yyx,mm)+e.yxy*map(p+e.yxy,mm)+e.xxx*map(p+e.xxx,mm));",
    "  vec3 L=normalize(vec3(-.5,.7,.6)),V=-rd;",
    "  float dif=max(dot(n,L),0.),amb=.5+.5*n.y,rim=pow(1.-max(dot(n,V),0.),3.);",
    "  float ao=clamp(map(p+n*.06,mm)/.06,0.,1.)*.6+.4;ao*=clamp(map(p+n*.18,mm)/.18,0.,1.)*.5+.5;",
    "  vec3 s=skullSpace(p);",
    "  float pores=fbm3(s.xy*18.+s.z*7.)*.5+fbm3(s.yz*9.)*.5;",
    "  vec3 boneC=mix(vec3(.3,.28,.34),vec3(.66,.63,.68),pores*pores*1.3)*(m>.5&&m<1.5?1.15:1.);",
    "  float spec=pow(max(dot(reflect(-L,n),V),0.),18.)*.25;",
    "  col=boneC*(dif*1.05+amb*.1)*ao+vec3(.65,.3,1.)*rim*(.45+glow*.45)*ao+spec;",
    "  // inner glow from the eyes and mouth lighting the bone",
    "  float eg=exp(-min(length(p-sp0),length(p-sp1))*5.)*glow;float mg=exp(-length(p-mo)*5.)*mouthE;",
    "  col+=vec3(.7,.25,1.)*(eg*.9+mg*1.2)*(.5+.5*max(dot(n,normalize(sp0-p)),0.));",
    "  // illuminated cracks spreading over the cranium",
    "  float cn=1.-abs(fbm3(s.xy*3.+vec2(s.z*2.,1.))*2.-1.);float cmask=smoothstep(1.-crack*.25,1.,cn)*step(.1,s.y+.2);",
    "  col=mix(col,vec3(.85,.5,1.)*1.8,pow(cn,30.)*crack*1.5+0.*cmask);",
    "  col*=1.-pow(cn,40.)*.2*(1.-crack);",
    "  // eye-socket interiors glow",
    "  float inS=smoothstep(.17,.09,length(vec2(abs(s.x),s.y)-vec2(.23,0.)))*smoothstep(.64,.48,s.z);float deep=smoothstep(.5,.32,s.z);col=mix(col,col*.04+vec3(.45,.12,.8)*glow*deep*.7,inS);",
    " } else {",
    "  col+=vec3(.55,.2,1.)*exp(-minD*14.)*(.25+glow*.35);                       // aura hugging the silhouette",
    " }",
    " // project eyes / mouth to screen for plasma, smoke and beams",
    " vec2 se0=(sp0.xy-ro.xy)/(ro.z-sp0.z)*2.05,se1=(sp1.xy-ro.xy)/(ro.z-sp1.z)*2.05,sm=(mo.xy-ro.xy)/(ro.z-mo.z)*2.05;",
    " for(int k=0;k<2;k++){vec2 se=k==0?se0:se1;vec2 q=uv-se;",
    "  col+=vec3(.8,.45,1.)*(exp(-length(q)*110.)*2.8+exp(-length(q)*35.)*.18)*glow;",
    "  // plasma beams streaming from the sockets",
    "  vec2 dir=normalize(vec2(-1.,.12+.1*sin(T*.7+float(k))));float along=dot(q,dir),across=dot(q,vec2(-dir.y,dir.x));",
    "  float wob=(noise(vec2(along*14.-T*8.,float(k)*3.))-.5)*.02*(1.+high*2.);",
    "  col+=vec3(.75,.4,1.)*exp(-abs(across+wob)*(160.-beam*60.))*step(0.,along)*exp(-along*1.4)*beam*1.6;",
    "  col+=vec3(.6,.3,1.)*exp(-abs(across)*25.)*step(0.,along)*exp(-along*2.)*beam*.25;",
    "  // smoke curling up from the sockets",
    "  vec2 sq=q*vec2(1.,.6)+vec2(sin(q.y*9.-T*1.5)*.03,0.);float sm2=fbm3(sq*7.+vec2(0.,-T*.8));",
    "  col+=vec3(.45,.2,.7)*sm2*smoothstep(.25,.0,length(q*vec2(1.6,.7)-vec2(0.,.08)))*.5*(.4+glow*.6+high*.4)*step(-.02,q.y);",
    " }",
    " vec2 mq=uv-sm;float pour=fbm3(vec2(mq.x*9.,mq.y*5.+T*2.));",
    " col+=vec3(.7,.3,1.)*pour*smoothstep(.12,.0,abs(mq.x))*smoothstep(.0,-.5,mq.y)*smoothstep(-.7,-.1,mq.y)*mouthE*.9;",
    " col+=vec3(.9,.6,1.)*exp(-length(mq*vec2(1.,1.8))*18.)*mouthE*1.2;",
    " // particles breaking away and drifting back",
    " vec2 g=uv*vec2(26.,26.);g+=vec2(-T*.6*frag,T*.2);vec2 id=floor(g);float hh=hash(id);",
    " col+=vec3(.8,.6,1.)*step(.9-high*.05,hh)*smoothstep(.12,0.,length(fract(g)-.5))*smoothstep(.75,.25,length(uv))*(.3+frag*1.5+high*.6);",
    " col*=.85+.15*smoothstep(1.1,.2,length(uv));",
    " gl_FragColor=vec4(tonemap(col*1.05),1.);",
    "}"
  ].join('\n'), alienparty: [
    "uniform vec4 J[65];",
    "uniform float lasers, spot, floorP, group;",
    "float mt;",
    "float sdOct(vec3 p,float s){p=abs(p);return (p.x+p.y+p.z-s)*.577;}",
    "vec3 headLocal(vec3 p,vec3 h,float yaw,float pitch){vec3 q=p-h;q.xz=rot(yaw)*q.xz;q.yz=rot(pitch*.4)*q.yz;return q;}",
    "float alien(int a,vec3 p,vec4 j0,vec4 j1,vec4 j2,vec4 j3,vec4 j4,vec4 j5,vec4 j6,vec4 j7,vec4 j8,vec4 j9,vec4 j10,vec4 j11,vec4 j12,out float m){",
    " vec3 pel=j0.xyz,ch=j1.xyz,hd=j2.xyz;float yaw=j2.w,pitch=j1.w,byaw=j0.w;",
    " float d=9.;m=float(a);",
    " vec3 shL=j3.xyz,elL=j4.xyz,hdL=j5.xyz,shR=j6.xyz,elR=j7.xyz,hdR=j8.xyz,knL=j9.xyz,ftL=j10.xyz,knR=j11.xyz,ftR=j12.xyz;",
    " vec3 hq=headLocal(p,hd,yaw,pitch);",
    " if(a==0){       // the Grey: slender ribbed body, huge swept-back head, black almond eyes",
    "  float rib=.004*sin(dot(p-ch,vec3(0.,60.,0.)));",
    "  d=sdCap(p,pel,ch,.075)+rib;d=smin(d,sdEll(p-mix(pel,ch,.7),vec3(.15,.2,.1)),.06);",
    "  d=min(d,sdCap(p,ch,hd-vec3(0.,.12,0.),.035));",
    "  float head=sdEll(hq-vec3(0.,.07,-.06),vec3(.17,.21,.23));head=smin(head,sdEll(hq-vec3(0.,-.1,.07),vec3(.08,.08,.07)),.07);",
    "  d=min(d,head);",
    "  float eye=sdEll(vec3(abs(hq.x),hq.y,hq.z)-vec3(.07,-.0,.12),vec3(.055,.03,.04));if(eye<d+.004){m=10.;}d=min(d,eye);",
    "  float lr=.03;d=min(d,min(min(sdCap(p,shL,elL,lr),sdCap(p,elL,hdL,lr*.85)),min(sdCap(p,shR,elR,lr),sdCap(p,elR,hdR,lr*.85))));",
    "  d=min(d,min(length(p-hdL),length(p-hdR))-.04);",
    "  d=min(d,min(min(sdCap(p,pel,knL,.045),sdCap(p,knL,ftL,.035)),min(sdCap(p,pel,knR,.045),sdCap(p,knR,ftR,.035))));",
    "  vec3 sd=normalize(hdR-elR);float stick=sdCap(p,hdR,hdR+sd*.45,.022);if(stick<d){m=11.;}d=min(d,stick);",
    " } else if(a==1){ // the Blob: round body, one huge eye, antennae",
    "  vec3 c=mix(pel,ch,.5);d=sdEll(p-c,vec3(.3,.33,.28));",
    "  vec3 eq=hq-vec3(0.,-.12,.18);float eye=length(eq)-.13;if(eye<d+.003)m=12.;d=min(d,eye);",
    "  for(int k=0;k<2;k++){float sg=k==0?-1.:1.;vec3 tip=hd+vec3(sg*.18,.28+.04*sin(T*6.+sg),0.);float an=sdCap(p,hd+vec3(sg*.08,.0,0.),tip,.016);float bl=length(p-tip)-.045;if(bl<d&&bl<an)m=13.;d=min(d,min(an,bl));}",
    "  d=min(d,min(min(sdCap(p,shL,elL,.06),sdCap(p,elL,hdL,.055)),min(sdCap(p,shR,elR,.06),sdCap(p,elR,hdR,.055))));",
    "  d=min(d,min(min(sdCap(p,pel,knL,.07),sdCap(p,knL,ftL,.065)),min(sdCap(p,pel,knR,.07),sdCap(p,knR,ftR,.065))));",
    " } else if(a==2){ // the Mantis: segmented chitin, narrow head with mandibles, four arms",
    "  d=min(sdCap(p,pel,mix(pel,ch,.45),.06),sdCap(p,mix(pel,ch,.55),ch,.08));d=smin(d,sdEll(p-mix(pel,ch,.8),vec3(.12,.14,.08)),.05);",
    "  d=min(d,sdCap(p,ch,hd-vec3(0.,.1,0.),.03));",
    "  float head=sdEll(hq,vec3(.09,.16,.1));vec3 ax=vec3(abs(hq.x),hq.yz);head=smin(head,sdEll(ax-vec3(.09,.04,.03),vec3(.05,.04,.045)),.02);",
    "  float mand=sdCap(ax,vec3(.03,-.12,.05),vec3(.05,-.2,.09),.012);d=min(d,min(head,mand));",
    "  float eye=length(ax-vec3(.09,.05,.05))-.04;if(eye<d+.003)m=14.;d=min(d,eye);",
    "  for(int k=0;k<2;k++){vec3 o=k==0?vec3(0.):vec3(0.,-.16,.02);vec3 eL=elL+o+vec3(0.,.04*float(k),0.),hL=hdL+o*1.3,eR=elR+o,hR=hdR+o*1.3;",
    "   d=min(d,min(min(sdCap(p,shL+o,eL,.03),sdCap(p,eL,hL,.022)),min(sdCap(p,shR+o,eR,.03),sdCap(p,eR,hR,.022))));}",
    "  d=min(d,min(min(sdCap(p,pel,knL,.04),sdCap(p,knL,ftL,.03)),min(sdCap(p,pel,knR,.04),sdCap(p,knR,ftR,.03))));",
    " } else if(a==3){ // the Squid: bulbous mantle head, face tentacles",
    "  d=sdCap(p,pel,ch,.09);d=smin(d,sdEll(p-mix(pel,ch,.75),vec3(.17,.15,.11)),.08);",
    "  float head=sdEll(hq-vec3(0.,.12,-.04),vec3(.16,.26,.17));d=min(d,head);",
    "  for(int k=0;k<5;k++){float fk=float(k);vec3 o=vec3(-.08+fk*.04,-.05,.1);vec3 e1=o+vec3(.03*sin(T*3.+fk),-.12,.03),e2=e1+vec3(.05*sin(T*2.5+fk*1.3),-.12,.04*cos(T*2.+fk));",
    "   d=smin(d,min(sdCap(hq,o,e1,.02),sdCap(hq,e1,e2,.014)),.02);}",
    "  float eye=length(vec3(abs(hq.x),hq.yz)-vec3(.09,.06,.12))-.035;if(eye<d+.003)m=15.;d=min(d,eye);",
    "  d=min(d,min(min(sdCap(p,shL,elL,.04),sdCap(p,elL,hdL,.035)),min(sdCap(p,shR,elR,.04),sdCap(p,elR,hdR,.035))));",
    "  d=min(d,min(min(sdCap(p,pel,knL,.055),sdCap(p,knL,ftL,.045)),min(sdCap(p,pel,knR,.055),sdCap(p,knR,ftR,.045))));",
    " } else {         // the Crystal: faceted heavy body, octahedral head",
    "  vec3 tq=p-mix(pel,ch,.6);tq.xz=rot(byaw)*tq.xz;d=sdRBox(tq,vec3(.2,.24,.13),.03);",
    "  d=min(d,sdRBox(p-pel,vec3(.15,.08,.1),.02));",
    "  vec3 oq=hq;oq.xz=rot(.785)*oq.xz;float head=sdOct(oq*vec3(1.,.75,1.),.17);d=min(d,head);",
    "  float eye=sdBox(hq-vec3(0.,.0,.12),vec3(.09,.015,.02));if(eye<d+.003)m=16.;d=min(d,eye);",
    "  d=min(d,min(min(sdCap(p,shL,elL,.065),sdCap(p,elL,hdL,.06)),min(sdCap(p,shR,elR,.065),sdCap(p,elR,hdR,.06))));",
    "  d=min(d,min(length(p-hdL),length(p-hdR))-.08);",
    "  d=min(d,min(min(sdCap(p,pel,knL,.075),sdCap(p,knL,ftL,.065)),min(sdCap(p,pel,knR,.075),sdCap(p,knR,ftR,.065))));",
    " }",
    " return d;",
    "}",
    "float act[5];",
    "float map(vec3 p){float d=9.;mt=-1.;",
    " for(int a=0;a<5;a++){if(act[a]<.5)continue;float m;",
    "  float da=alien(a,p,J[a*13],J[a*13+1],J[a*13+2],J[a*13+3],J[a*13+4],J[a*13+5],J[a*13+6],J[a*13+7],J[a*13+8],J[a*13+9],J[a*13+10],J[a*13+11],J[a*13+12],m);if(da<d){d=da;mt=m;}}",
    " return d;}",
    "vec3 club(vec2 uv){",
    " vec3 c=vec3(.02,.005,.04)+vec3(.25,.05,.35)*smoothstep(-.2,.6,uv.y)*.4;",
    " // holographic displays",
    " for(int i=0;i<3;i++){float fi=float(i);vec2 q=uv-vec2(-.7+fi*.7,.33);if(abs(q.x)<.16&&abs(q.y)<.09){",
    "  float hol=step(.5,fract((q.y+T*.1)*40.))*.3+.7;float shape=smoothstep(.06,.05,length(q-vec2(.03*sin(T+fi),0.)))*smoothstep(.03,.04,length(q-vec2(.03*sin(T+fi),0.)));",
    "  c=mix(c,vec3(.2,.8,1.)*hol*(.3+shape*1.5)+vec3(.8,.3,1.)*.05,.8);}}",
    " // lasers and beams",
    " for(int k=0;k<5;k++){float fk=float(k);vec2 o=vec2(-1.+fk*.5,.55);float an=sin(T*(.4+fk*.11)+fk*2.)*.6;vec2 dir=vec2(sin(an),-cos(an));vec2 q=uv-o;float al=dot(q,dir),ac=abs(dot(q,vec2(-dir.y,dir.x)));",
    "  c+=mix(vec3(1.,.2,.9),vec3(.3,.8,1.),mod(fk,2.))*exp(-ac*(250.-lasers*90.))*step(0.,al)*lasers*(.5+high*.8);}",
    " // crowd silhouettes at the back",
    " float cy=.02+.03*noise(vec2(uv.x*14.,2.))+.02*abs(sin(uv.x*9.+T*4.))*(.3+bass);",
    " c=mix(c,vec3(.02,.0,.05),step(uv.y,cy)*step(-.1,uv.y)*.85);",
    " c+=vec3(.6,.3,.8)*fbm3(uv*vec2(3.,4.)+vec2(T*.04,0.))*.22;",
    " return c;",
    "}",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;",
    " vec3 ro=vec3(.4*sin(T*.07),1.55+.08*sin(T*.11),6.1),ta=vec3(0.,.95,-.3);",
    " vec3 fw=normalize(ta-ro),rt=normalize(cross(fw,vec3(0.,1.,0.))),up=cross(rt,fw);",
    " vec3 rd=normalize(fw*1.9+rt*uv.x+up*uv.y);",
    " vec3 col=club(uv);",
    " // glowing dance floor with reflections",
    " float tf=-ro.y/rd.y;",
    " if(rd.y<0.){vec3 fp=ro+rd*tf;vec2 tile=floor(fp.xz*2.);vec2 tf2=fract(fp.xz*2.)-.5;",
    "  float h=hash(tile+floor(floorP));vec3 tc=.5+.5*cos(6.283*(h+vec3(0.,.33,.67)+T*.05));",
    "  float lit=step(.62,h)*(.12+bass*.45)+.03;float edge=smoothstep(.47,.5,max(abs(tf2.x),abs(tf2.y)));",
    "  vec3 fc=vec3(.02,.01,.04)+tc*lit*(1.-edge)*.6+vec3(.5,.2,.8)*edge*.15;",
    "  fc+=club(vec2(uv.x,-uv.y-.3))*.25;fc*=exp(-tf*.05);col=fc;}",
    " // spotlights sweeping over the dancers",
    " for(int i=0;i<3;i++){float fi=float(i);vec2 o=vec2(-.8+fi*.8,.5);vec2 q=uv-o;float a=atan(q.x,-q.y)-sin(T*.5*(1.+fi*.2)+fi)*.5*spot;",
    "  col+=mix(vec3(.9,.3,1.),vec3(.3,.8,1.),fi*.5)*smoothstep(.1,.0,abs(a))*smoothstep(1.3,.0,length(q))*.09*(1.+beat*.5);}",
    " // per-ray culling of the five dancers",
    " float any=0.;for(int a=0;a<5;a++){vec3 c=J[a*13].xyz+vec3(0.,.25,0.);vec3 oc=ro-c;float b=dot(oc,rd),cc=dot(oc,oc)-1.1;act[a]=step(0.,b*b-cc);any+=act[a];}",
    " if(any>0.){float t=2.5,hit=0.;",
    "  for(int i=0;i<100;i++){if(float(i)>=56.+quality*40.)break;float d=map(ro+rd*t);if(d<.0015){hit=1.;break;}t+=d;if(t>9.)break;}",
    "  if(hit>0.){vec3 p=ro+rd*t;float m=mt;vec2 e=vec2(.002,-.002);",
    "   vec3 n=normalize(e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx));",
    "   vec3 L1=normalize(vec3(-.6,.7,.4)),L2=normalize(vec3(.7,.4,.3));float d1=max(dot(n,L1),0.),d2=max(dot(n,L2),0.),fr=pow(1.-max(dot(n,-rd),0.),3.);",
    "   vec3 R=reflect(rd,n);vec3 env=club(R.xy*.6);float sp=pow(max(dot(R,L1),0.),24.);",
    "   vec3 k1=vec3(1.,.25,.85),k2=vec3(.3,.75,1.);",
    "   vec3 base;float gloss=.5;",
    "   if(m<.5){base=vec3(.08,.06,.14);gloss=.9;base+=vec3(.25,.1,.4)*pow(.5+.5*sin(p.y*90.),8.)*.4;if(p.y>J[1].y+.12)base=vec3(.45,.42,.55);}",
    "   else if(m<1.5){base=vec3(.15,.55,.25);gloss=.7;}",
    "   else if(m<2.5){base=vec3(.05,.3,.32);gloss=.8;}",
    "   else if(m<3.5){base=vec3(.4,.15,.5)*(.7+.3*step(.6,noise(p.xy*30.)));gloss=.5;}",
    "   else if(m<4.5){base=vec3(.25,.6,.9)*.4;gloss=1.;}",
    "   vec3 c=base*(d1*k1*.8+d2*k2*.7+.12)+env*gloss*(.2+fr*.8)+vec3(1.)*sp*gloss*.5+mix(k1,k2,.5)*fr*.35;",
    "   if(m>3.5&&m<4.5)c+=vec3(.3,.9,1.)*pow(fract(dot(p,vec3(9.,7.,5.))),12.)*(.5+high);",
    "   if(m==10.||m==12.||m==14.||m==15.){c=vec3(.01)+env*.6+vec3(1.)*sp;if(m==12.){vec3 eq=n;c=mix(vec3(.9),vec3(.05),step(.92,dot(n,-rd)))+vec3(.2,1.,.6)*smoothstep(.97,.99,dot(n,-rd))*.0;}}",
    "   if(m==11.)c=vec3(.4,.95,1.)*(2.+high*1.5);",
    "   if(m==13.)c=vec3(.8,1.,.4)*(1.5+high*2.);",
    "   if(m==16.)c=vec3(.4,1.,1.)*(1.5+bass);",
    "   col=c;",
    "  }",
    " }",
    " // glow stick halo",
    " vec3 hs=J[8].xyz;vec3 rel=hs-ro;vec2 sp2=vec2(dot(rel,rt),dot(rel,up))/dot(rel,fw)*1.9;col+=vec3(.3,.9,1.)*exp(-length(uv-sp2)*14.)*.25;",
    " col*=.85+.15*smoothstep(1.2,.3,length(uv));",
    " gl_FragColor=vec4(tonemap(col*1.05),1.);",
    "}"
  ].join('\n'), neonhighway: [
    "uniform float D, run, runAmp, bob, steer, section;",
    "float curveX(float z){return 2.2*sin(z*.011)+1.1*sin(z*.027+1.3);}",
    "float relX(float z){float c0=curveX(D),c1=(curveX(D+.5)-curveX(D-.5));return curveX(D+z)-c0-c1*z;}",
    "vec3 sky(vec2 p,float head){",
    " vec3 c=mix(vec3(.05,.01,.07),vec3(.01,.0,.03),smoothstep(-.05,.6,p.y));",
    " c+=vec3(.35,.08,.3)*exp(-abs(p.y-.02)*7.)*.35;",
    " c+=vec3(.9,.9,1.)*stars(p+vec2(head*.02,0.),60.,.975)*.8*smoothstep(-.02,.15,p.y)*(.6+high*.8);",
    " // giant moon ahead",
    " vec2 mc=vec2(-head*.06,.17);float mr=.26+bass*.008;vec2 mq=(p-mc)/mr;float md=length(mq);",
    " if(md<1.){float z=sqrt(1.-md*md);float cr=fbm(mq*3.+4.)*.6+fbm(mq*9.)*.4;",
    "  float crat=smoothstep(.55,.62,noise(mq*6.))*.25+smoothstep(.6,.68,noise(mq*14.+2.))*.15;",
    "  vec3 mcol=mix(vec3(.75,.45,.6),vec3(1.,.82,.9),cr)*(.55+.45*z)-crat*.25;",
    "  c=mix(c,mcol*(.9+.1*sin(T*.1)),smoothstep(1.,.985,md));}",
    " c+=vec3(1.,.5,.8)*exp(-max(md-1.,0.)*5.)*.25*(.8+beat*.3);",
    " // haze bands drifting",
    " c+=vec3(.5,.2,.5)*fbm3(vec2(p.x*2.+T*.01+head*.03,p.y*8.))*smoothstep(.25,.0,abs(p.y-.08))*.12;",
    " // mountain ranges and rock formations, two parallax layers",
    " float m1=.035+.09*fbm(vec2((p.x+head*.1)*2.2+section*3.,section))*(1.+.6*sin(section*1.7))+.08*pow(max(0.,noise(vec2((p.x+head*.1)*7.,section*2.))-.55),1.)*1.5;",
    " float m2=.0+.05*fbm(vec2((p.x+head*.18)*4.+D*.002,7.+section));",
    " vec3 rock=vec3(.06,.02,.08)+vec3(.4,.1,.35)*smoothstep(m1-.05,m1,p.y)*.25;",
    " c=mix(c,rock,smoothstep(.002,-.002,p.y-m1));",
    " c=mix(c,vec3(.03,.01,.05)+vec3(.6,.15,.4)*.08,smoothstep(.002,-.002,p.y-m2));",
    " return c;",
    "}",
    "void main(){",
    " vec2 p=(gl_FragCoord.xy-.5*res)/res.y;",
    " p.y+=bob*.006; p.x+=steer*.01;",
    " float hz=0.,camH=.32;float head=(curveX(D+.5)-curveX(D-.5))*12.;",
    " vec3 col=sky(p,head);",
    " if(p.y<hz){",
    "  float z=camH/(hz-p.y+1e-4);float x=p.x*z-relX(z);",
    "  float W=1.25;float fog=exp(-z*.012);",
    "  // wet reflective asphalt reflecting the sky, moon and roadside light",
    "  vec3 refl=sky(vec2(p.x+.006*sin(z*2.+T)*(1.+mid),-p.y*.9),head)*.13*(.6+.4*noise(vec2(x*2.,(z+D)*1.5)));",
    "  float grain=noise(vec2(x*40.,(z+D)*8.))*.06;",
    "  vec3 road=vec3(.03,.02,.045)+grain*.05+refl*(.7+.3*noise(vec2(x*3.,(z+D)*.5)));",
    "  float onRoad=step(abs(x),W);",
    "  vec3 ground=vec3(.04,.015,.05)+vec3(.25,.08,.2)*fbm3(vec2(x*.4,(z+D)*.15))*.25;",
    "  vec3 c=mix(ground,road,onRoad);",
    "  // centre dashes and glowing marker boxes",
    "  float dash=step(fract((z+D)*.18),.45)*smoothstep(.06,.03,abs(x));",
    "  c+=vec3(1.,.85,1.)*dash*.55*onRoad;",
    "  float bz=fract((z+D)*.12);float bx=abs(abs(x)-W*.62);",
    "  float box=smoothstep(.02,.0,abs(max(bx-.12,abs(bz-.25)*7.-.6)))*step(bz,.5);",
    "  c+=mix(vec3(.4,.9,1.),vec3(1.,.3,.9),step(0.,x))*box*.9*(1.+beat*.6);",
    "  // light runs racing along the road edges",
    "  float wave=(exp(-pow((z-run)/7.,2.))+.5*exp(-pow((z-run+12.)/7.,2.)))*runAmp;",
    "  float edge=exp(-abs(abs(x)-W)*60.);",
    "  c+=mix(vec3(1.,.25,.85),vec3(.3,.85,1.),step(0.,x))*(edge*(.6+mid*.6+wave*3.5)+exp(-abs(abs(x)-W)*6.)*wave*.35);",
    "  c*=fog;c+=vec3(.25,.05,.25)*(1.-fog)*.7;",
    "  col=c;",
    " }",
    " // neon light bars running along both sides of the highway",
    " for(int i=0;i<6;i++){float fi=float(i);float side=fi<3.?-1.:1.;float k=mod(fi,3.);",
    "  float xs=side*(1.55+k*.16),ys=.02+k*.045;",
    "  float zz=(camH-ys)/(hz-p.y);",
    "  if(zz>.3&&zz<300.){float ex=(xs+relX(zz))/zz;float d=abs(p.x-ex)*zz;",
    "   float wave=(exp(-pow((zz-run)/8.,2.))+.5*exp(-pow((zz-run+12.)/8.,2.)))*runAmp;",
    "   float seq=.6+.4*sin(zz*.4-T*(3.+mid*4.)+k*2.);",
    "   vec3 lc=side<0.?mix(vec3(1.,.2,.8),vec3(.4,.8,1.),k*.5):mix(vec3(.3,.85,1.),vec3(1.,.3,.9),k*.5);",
    "   col+=lc*exp(-d*55.)*exp(-zz*.01)*(.5+seq*.5+high*.4+wave*2.)*1.1;}",
    " }",
    " // roadside lamp posts passing at believable intervals",
    " for(int k=0;k<14;k++){float fk=float(k);",
    "  for(int s=0;s<2;s++){float side=s==0?-1.:1.;",
    "   float zk=fk*7.-mod(D,7.)+.5+ (side>0.?3.5:0.);if(zk<.6)continue;",
    "   float px=(side*1.95+relX(zk))/zk,base=hz-camH/zk,top=hz+(1.9-camH)/zk;",
    "   float pw=.035/zk;",
    "   float pole=step(abs(p.x-px),pw)*step(base,p.y)*step(p.y,top);",
    "   vec3 pc=vec3(.12,.06,.12)*(.6+.4*smoothstep(base,top,p.y));",
    "   col=mix(col,pc*exp(-zk*.01)+vec3(.2,.05,.15)*(1.-exp(-zk*.01)),pole);",
    "   float ax=px-side*.35/zk;float arm=step(abs(p.y-top),.012/zk)*step(min(px,ax),p.x)*step(p.x,max(px,ax));",
    "   col=mix(col,vec3(.15,.07,.15),arm);",
    "   vec2 lp=vec2(ax,top-.01/zk);float ld=length((p-lp)*vec2(1.,2.2))*zk;",
    "   float wv=(exp(-pow((zk-run)/8.,2.))+.5*exp(-pow((zk-run+12.)/8.,2.)))*runAmp;",
    "   col+=vec3(1.,.35,.9)*(exp(-ld*30.)*1.5+exp(-ld*6.)*.25)*(.7+high*.5+wv*1.5)*exp(-zk*.012);",
    "   // pooled light on the road below",
    "   float gz=zk;float gx=side*1.6+relX(gz);",
    "   if(p.y<hz){float z=camH/(hz-p.y+1e-4);float x=p.x*z-relX(z)+relX(z);vec2 dd=vec2((p.x*z-relX(z))-side*1.6,(z-gz)*.6);col+=vec3(.7,.2,.6)*exp(-dot(dd,dd)*1.5)*.12*(1.+wv);}",
    "  }",
    " }",
    " // our car in the foreground (rear view), with suspension and steering",
    " vec2 cp=p-vec2(steer*.03,-.34+bob*.008);cp.x+=cp.y*steer*.06;",
    " float yb=(cp.y+.13)/.15;                                  // 0 bumper .. 1 deck lid",
    " float halfW=.27-.03*smoothstep(.6,1.,yb)+.01*smoothstep(.1,0.,yb);",
    " float body=smoothstep(.004,-.004,abs(cp.x)-halfW)*step(-.13,cp.y)*step(cp.y,.02);",
    " float roofW=.17-(cp.y-.02)*.55;float roof=smoothstep(.004,-.004,abs(cp.x)-roofW)*step(.02,cp.y)*step(cp.y,.105);",
    " float win=smoothstep(.004,-.004,abs(cp.x)-(roofW-.018))*step(.034,cp.y)*step(cp.y,.094);",
    " float tyre=step(abs(abs(cp.x)-.2),.045)*step(-.165,cp.y)*step(cp.y,-.12);",
    " float shadow=exp(-pow(cp.x/.32,2.)-pow((cp.y+.16)/.015,2.));",
    " col*=1.-shadow*.85;col=mix(col,vec3(.01),tyre);",
    " float curv=1.-pow(abs(cp.x)/halfW,4.);",
    " vec3 paint=vec3(.05,.045,.07)*(.6+.6*curv)+vec3(.9,.5,.85)*smoothstep(.012,0.,abs(cp.y-.018))*.35*curv",
    "   +vec3(.5,.3,.6)*smoothstep(.006,0.,abs(cp.y+.085))*.25+vec3(.35,.2,.4)*pow(curv,6.)*smoothstep(-.13,.02,cp.y)*.18;",
    " paint+=vec3(.9,.6,1.)*smoothstep(.003,0.,abs(abs(cp.x)-halfW+.004))*.3*step(-.13,cp.y);",
    " vec3 glass=vec3(.015,.01,.03)+vec3(.5,.2,.45)*smoothstep(.1,.034,cp.y)*.12+vec3(1.,.6,.9)*smoothstep(.004,0.,abs(cp.x+cp.y*.8-.03))*.15;",
    " col=mix(col,paint,max(body,roof));col=mix(col,glass,win);",
    " float tl=smoothstep(.003,0.,abs(abs(cp.x)-.165)-.075)*smoothstep(.003,0.,abs(cp.y+.04)-.013);",
    " float tail=.8+bass*.9+beat*.4;",
    " col=mix(col,vec3(1.,.15,.5)*tail*(.8+.2*sin(cp.x*200.)),tl);",
    " col+=vec3(1.,.15,.5)*exp(-length(vec2(abs(abs(cp.x)-.165)*.8,(cp.y+.04)*3.))*22.)*.4*tail;",
    " col+=vec3(1.,.25,.6)*exp(-pow(cp.x/.25,2.)-pow((cp.y+.2)/.05,2.))*.16*tail;",
    " col+=vec3(1.,.5,.9)*step(abs(cp.x),.035)*step(abs(cp.y+.075),.006)*.6*body;",
    " col*=.8+.2*smoothstep(1.1,.3,length(p));",
    " gl_FragColor=vec4(tonemap(col*1.15),1.);",
    "}"
  ].join('\n') };
  Object.keys(VX8).forEach(function (k) { VX_SRC[k] = VX_COMMON + '\n' + VX8[k]; });
  ['deepsea', 'robotdj', 'mushroomworld', 'ufo', 'rollercoaster', 'livingskull', 'alienparty', 'neonhighway'].forEach(function (k) { VX_ORDER.push(k); });
  VX_NAMES.deepsea = 'Deep Sea Explorer'; VX_NAMES.robotdj = 'Robot DJ'; VX_NAMES.mushroomworld = 'Alien Mushroom World'; VX_NAMES.ufo = 'UFO Encounter';
  VX_NAMES.rollercoaster = 'Cosmic Rollercoaster'; VX_NAMES.livingskull = 'Living Skull'; VX_NAMES.alienparty = 'Alien Dance Party'; VX_NAMES.neonhighway = 'Neon Highway';
  // Alien Dance Party choreography: five characters, each with its own build and dance style.
  // Joints per alien (13 x vec4): 0 pelvis(w=body yaw) 1 chest(w=head pitch) 2 head(w=head yaw)
  // 3 shL 4 elL 5 hdL 6 shR 7 elR 8 hdR 9 knL 10 ftL 11 knR 12 ftR
  function vxDanceRig() {
    var B = [ // scale, hip height, torso, neck, shoulder half-width, upper arm, forearm, thigh, shin, hip half-width
      { s: 1.15, hip: .92, torso: .55, neck: .2, sw: .19, ua: .36, fa: .34, th: .47, sh: .46, hw: .1 },
      { s: .8, hip: .42, torso: .38, neck: .02, sw: .3, ua: .2, fa: .18, th: .22, sh: .21, hw: .16 },
      { s: 1.05, hip: .86, torso: .6, neck: .16, sw: .17, ua: .38, fa: .4, th: .45, sh: .44, hw: .09 },
      { s: 1, hip: .78, torso: .5, neck: .14, sw: .2, ua: .32, fa: .3, th: .4, sh: .4, hw: .11 },
      { s: 1.1, hip: .78, torso: .5, neck: .1, sw: .27, ua: .3, fa: .3, th: .4, sh: .4, hw: .15 }
    ];
    var ROOT = [[-1.75, -.55], [-.85, .15], [0, -.75], [.9, .1], [1.8, -.5]];
    var J = new Float32Array(5 * 13 * 4);
    var st = { spin: 0, group: 0, groupT: 0, look: [0, 0, 0, 0, 0], lookAt: [0, 0, 0, 0, 0], crossT: 0 };
    function put(a, j, x, y, z, w) { var o = (a * 13 + j) * 4; J[o] = x; J[o + 1] = y; J[o + 2] = z; J[o + 3] = w || 0; }
    function arm(sh, side, yaw, raise, swing, bend, len1, len2, out) {
      // raise: angle from hanging down (0) to straight up (PI); swing: forward(+)/back; side: -1 left, +1 right
      var dx = Math.sin(raise) * side * Math.cos(swing * .6), dy = -Math.cos(raise), dz = Math.sin(swing) * .8 + .15;
      var l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      var c = Math.cos(yaw), s = Math.sin(yaw), rx = dx * c + dz * s, rz = -dx * s + dz * c;
      var el = [sh[0] + rx * len1, sh[1] + dy * len1, sh[2] + rz * len1];
      // forearm bends toward the front/up
      var fx = rx * Math.cos(bend) + 0, fy = dy * Math.cos(bend) + Math.sin(bend), fz = rz * Math.cos(bend) + Math.sin(bend) * .4 * Math.cos(yaw);
      var fl = Math.hypot(fx, fy, fz); out[0] = el; out[1] = [el[0] + fx / fl * len2, el[1] + fy / fl * len2, el[2] + fz / fl * len2];
    }
    function leg(hip, foot, l1, l2, yaw) {
      var dx = foot[0] - hip[0], dy = foot[1] - hip[1], dz = foot[2] - hip[2], d = Math.min(l1 + l2 - .001, Math.hypot(dx, dy, dz));
      var a = (l1 * l1 + d * d - l2 * l2) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a)), L = Math.hypot(dx, dy, dz) || 1;
      var ux = dx / L, uy = dy / L, uz = dz / L, kx = Math.sin(yaw), kz = Math.cos(yaw);   // knee bends forward
      return [hip[0] + ux * a + kx * h, hip[1] + uy * a, hip[2] + uz * a + kz * h];
    }
    return {
      joints: J,
      pose: function (t, phase, A, dt) {
        // phase: continuous beat count (fractional), A: smoothed audio
        var b = phase % 1, e = .35 + A.energy * .65, s = dt / 1000;
        var hop = Math.pow(Math.max(0, Math.sin(Math.PI * b)), 1.5), kick = Math.exp(-b * 6);
        st.groupT -= s; if (st.groupT <= 0 && (A.strong && A.drama > .45 || Math.random() < s / 25)) { st.group = 1; st.groupT = 14; }
        st.group = Math.max(0, st.group - s / 6);
        var G = st.group > 0 ? Math.sin(Math.PI * Math.min(1, (1 - st.group) * 1.2)) : 0;    // coordinated group move envelope
        st.spin += s * (A.mid > .5 || A.build > .3 ? 3.2 : .4);
        for (var i = 0; i < 5; i++) {
          var bd = B[i], r = ROOT[i], sc = bd.s, yaw = -r[0] * .22, lean = 0, twist = 0, bounce = 0, nod = 0, hy = 0;
          var sideStep = 0, stepL = 0, stepR = 0, aL = [.35, .2, .5], aR = [.35, .2, .5];   // raise, swing, bend
          if (i === 0) {        // the Grey: smooth body roll, glow stick waving in arcs
            lean = .12 * Math.sin(phase * Math.PI * .5) * e; twist = .25 * Math.sin(phase * Math.PI * .5);
            bounce = -.04 * hop * e; sideStep = .12 * Math.sin(phase * Math.PI * .5);
            aR = [2.3 + .5 * Math.sin(phase * Math.PI), .3 * Math.cos(phase * Math.PI), .4 + A.mid * .6];
            aL = [.9 + .5 * Math.sin(phase * Math.PI + 1) * e, .4, 1.2]; nod = .15 * Math.sin(phase * Math.PI * 2) * e;
          } else if (i === 1) { // the Blob: bouncy hops on every beat, pumping stubby arms
            bounce = .22 * hop * (.4 + A.bass * .9); var pump = Math.sin(phase * Math.PI * 2);
            aL = [1.6 + .9 * pump * e, .2, .4]; aR = [1.6 - .9 * pump * e, .2, .4]; nod = -.25 * kick * A.bass;
            stepL = stepR = .02;
          } else if (i === 2) { // the Mantis: robotic popping between angular poses each beat
            var k = Math.floor(phase) % 4, poses = [[1.6, .0, 1.5, .4, .4, .2], [.6, .9, 1.4, 2.5, -.3, .1], [2.6, -.2, .2, 1.6, .2, 1.5], [1.2, .8, .9, 1.2, .8, .9]];
            var pz = poses[k], ease = Math.min(1, b * 6), pp = poses[(k + 3) % 4];
            aL = [pp[0] + (pz[0] - pp[0]) * ease, pp[1] + (pz[1] - pp[1]) * ease, pp[2] + (pz[2] - pp[2]) * ease];
            aR = [pp[3] + (pz[3] - pp[3]) * ease, pp[4] + (pz[4] - pp[4]) * ease, pp[5] + (pz[5] - pp[5]) * ease];
            hy = .35 * Math.sign(Math.sin(phase * Math.PI * .5)) * (1 - kick * .5); bounce = -.03 * kick; twist = .15 * Math.sign(Math.sin(phase * Math.PI));
          } else if (i === 3) { // the Squid: hip sway and spins, flowing arms
            yaw += st.spin * (A.build > .3 || A.mid > .55 ? 1 : .15);
            twist = .3 * Math.sin(phase * Math.PI); lean = .1 * Math.sin(phase * Math.PI * .5); sideStep = .18 * Math.sin(phase * Math.PI);
            aL = [1.4 + .8 * Math.sin(t * 1.3), .5 * Math.sin(t), 1.0 + .5 * Math.sin(t * 2)]; aR = [1.4 + .8 * Math.sin(t * 1.3 + 2), .5 * Math.cos(t), 1.0 + .5 * Math.cos(t * 2)];
            bounce = -.03 * hop;
          } else {              // the Crystal: heavy stomps, fist pumps and head-banging
            var stomp = Math.floor(phase) % 2; stepL = stomp ? .0 : .08 * (1 - b); stepR = stomp ? .08 * (1 - b) : 0;
            bounce = -.08 * kick * (.4 + A.bass); nod = .45 * kick * (.4 + A.bass) - .1;
            aR = [2.8 * (.5 + .5 * kick) + .2, .1, .3]; aL = [.6 + .3 * kick, .5, 1.6];
          }
          // coordinated group move: everyone throws arms up in a wave across the line
          if (G > 0) { var g = G * (.5 + .5 * Math.sin(phase * Math.PI - i * .7)); aL = [aL[0] + (2.7 - aL[0]) * g, aL[1] * (1 - g), aL[2] * (1 - g) + .2 * g]; aR = [aR[0] + (2.7 - aR[0]) * g, aR[1] * (1 - g), aR[2] * (1 - g) + .2 * g]; bounce += .1 * g * hop; }
          // treble: small head details; heads turn to look at a neighbour from time to time
          if (Math.random() < s * .25) st.lookAt[i] = Math.random() < .5 ? 0 : (Math.random() < .5 ? -.6 : .6);
          st.look[i] += (st.lookAt[i] - st.look[i]) * Math.min(1, s * 3);
          hy += st.look[i] + .05 * Math.sin(t * 7 + i) * A.high;
          var x0 = r[0] + sideStep * sc, z0 = r[1];
          var py = bd.hip * sc + bounce * sc, pel = [x0, py, z0];
          var cy = Math.cos(yaw + twist), sy = Math.sin(yaw + twist);
          var ch = [pel[0] + Math.sin(lean) * bd.torso * sc * cy, pel[1] + Math.cos(lean) * bd.torso * sc, pel[2] - Math.sin(lean) * bd.torso * sc * sy];
          var hd = [ch[0] + Math.sin(nod * .3) * .05, ch[1] + bd.neck * sc + .12 * sc, ch[2] + Math.sin(nod) * .08 * sc];
          put(i, 0, pel[0], pel[1], pel[2], yaw); put(i, 1, ch[0], ch[1], ch[2], nod); put(i, 2, hd[0], hd[1], hd[2], yaw + twist + hy);
          var out = [];
          for (var sd = 0; sd < 2; sd++) {
            var side = sd ? 1 : -1, a = sd ? aR : aL;
            var shp = [ch[0] + side * bd.sw * sc * cy, ch[1] - .04 * sc, ch[2] - side * bd.sw * sc * sy];
            arm(shp, side, yaw + twist, a[0], a[1], a[2], bd.ua * sc, bd.fa * sc, out);
            put(i, 3 + sd * 3, shp[0], shp[1], shp[2]); put(i, 4 + sd * 3, out[0][0], out[0][1], out[0][2]); put(i, 5 + sd * 3, out[1][0], out[1][1], out[1][2]);
            var cyy = Math.cos(yaw), syy = Math.sin(yaw);
            var hip = [pel[0] + side * bd.hw * sc * cyy, pel[1] - .02, pel[2] - side * bd.hw * sc * syy];
            var lift = (sd ? stepR : stepL) * sc + (i === 1 ? Math.max(0, bounce - .02) : 0);
            var ft = [r[0] + side * (bd.hw + .04) * sc * cyy + sideStep * sc * .5, Math.max(0, lift), r[1] - side * bd.hw * sc * syy];
            var kn = leg(hip, ft, bd.th * sc, bd.sh * sc, yaw);
            put(i, 9 + sd * 2, kn[0], kn[1], kn[2]); put(i, 10 + sd * 2, ft[0], ft[1], ft[2]);
          }
        }
        return J;
      },
      state: st
    };
  }
  function vxSpring(st, key, target, k, damp, s) { var v = key + 'V', vel = st[v] || 0; vel += ((target - st[key]) * k - vel * damp) * Math.min(s, .05); st[v] = vel; st[key] += vel * Math.min(s, .05); return st[key]; }
  // Two-bone arm IK: shoulder S reaches target H; the elbow swings out to the side and down.
  function vxIK(S, H, l1, l2, side) {
    var dx = H[0] - S[0], dy = H[1] - S[1], dz = H[2] - S[2], L = Math.hypot(dx, dy, dz) || 1, d = Math.min(l1 + l2 - .002, L);
    var a = (l1 * l1 + d * d - l2 * l2) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var ux = dx / L, uy = dy / L, uz = dz / L, px = side, py = -.6, pz = -.25, dp = px * ux + py * uy + pz * uz;
    px -= dp * ux; py -= dp * uy; pz -= dp * uz; var pl = Math.hypot(px, py, pz) || 1;
    var el = [S[0] + ux * a + px / pl * h, S[1] + uy * a + py / pl * h, S[2] + uz * a + pz / pl * h];
    return [el, [S[0] + ux * d, S[1] + uy * d, S[2] + uz * d]];
  }
  VX_SCENE.deepsea = function () {
    var st = { T: 3, zph: 0, sway: 0, wave: 0, flashes: 0, bx: -1.4, by: .2, bs: .7, bsT: .7, bph: 0, near: 0 };
    return function (A, dt, t) {
      var s = dt / 1000;
      st.T += s * (.7 + A.energy * .4);
      st.zph += s * (.045 + A.energy * .04 + A.bass * .03);                    // forward travel
      st.sway += ((.25 * Math.sin(t * .4) + A.mid * .8 * Math.sin(t * 1.1)) - st.sway) * Math.min(1, s * 2);
      if (A.hit) st.wave = Math.max(st.wave, .4 + A.bass * .6);                 // bass pressure waves
      st.wave *= Math.exp(-dt / 900);
      st.flashes += (Math.min(1, A.high * 1.2 + A.rise * 2) - st.flashes) * Math.min(1, s * 5);
      // a leviathan crosses in the gloom; strong passages bring it close
      st.near -= s; if (A.drama > .5 && st.near <= 0) { st.bsT = 1.35; st.near = 18; } if (st.near < 10) st.bsT = .55 + .2 * Math.sin(t * .05);
      st.bs += (st.bsT - st.bs) * Math.min(1, s * .25);
      st.bx += s * (.04 + st.bs * .03) * (1 + A.bass * .5); if (st.bx > 1.9) { st.bx = -1.9; st.by = (Math.random() - .3) * .4; }
      st.bph += s * (1.2 + A.bass * 2.5);
      return { T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, build: A.build, zph: st.zph, sway: st.sway, wave: st.wave, flashes: st.flashes,
        beast: [st.bx, st.by + .05 * Math.sin(t * .3), st.bs, st.bph], layers: HIGH_MEMORY_DEVICE ? 7 : 5 };
    };
  };
  VX_SCENE.robotdj = function () {
    var st = { T: 2, nod: 0, turn: 0, lean: 0, deckA: 0, deckB: 1, fx: 0, scratch: 0, raise: 0, raiseT: 0, raiseSide: 1, cool: 4, cam: 0, jp: new Float32Array(40) };
    return function (A, dt, t) {
      var s = dt / 1000, ph = A.phase, b = ph % 1;
      st.T += s;
      // head nods with the beat (bass sets the depth), turns between decks and crowd
      vxSpring(st, 'nod', .1 + .32 * Math.exp(-b * 5) * (.3 + A.bass * .9), 90, 13, s);
      vxSpring(st, 'turn', .35 * Math.sin(t * .23) + (st.raise > .3 ? -.3 * st.raiseSide : 0), 14, 7, s);
      vxSpring(st, 'lean', .06 * Math.sin(ph * Math.PI) * (.5 + A.mid), 30, 9, s);
      // dramatic gesture to the crowd after build-ups or strong beats
      st.cool -= s; if (st.cool <= 0 && (A.strong && (A.build > .25 || A.drama > .5) || Math.random() < s / 20)) { st.raiseT = 2.6; st.cool = 7; st.raiseSide = Math.random() < .5 ? -1 : 1; }
      st.raiseT -= s; vxSpring(st, 'raise', st.raiseT > 0 ? 1 : 0, 18, 8, s);
      st.deckA += s * (3.5 + (st.scratch = .8 * Math.sin(t * 5.5) * (.2 + A.mid))) ; st.deckB += s * 3.5;
      var ch = [0, 1.45 - st.nod * .03, 0], J = st.jp, lean = st.lean;
      function put(i, v, w) { J[i * 4] = v[0]; J[i * 4 + 1] = v[1]; J[i * 4 + 2] = v[2]; J[i * 4 + 3] = w || 0; }
      var shL = [-.42 + lean * .5, 1.72 - lean, 0], shR = [.42 + lean * .5, 1.72 + lean, 0];
      // left hand works the jog wheel (scratching with the midrange); right hand rides faders and knobs
      var tL = [-.6 + .06 * Math.cos(t * 2.2) + .05 * st.scratch, 1.08 + .015 * Math.sin(t * 9) * A.high, .55 + .06 * Math.sin(t * 2.2)];
      var fader = Math.sin(t * 1.3 + Math.sin(t * .37) * 2) * (.15 + A.mid * .1);
      var tR = [.08 + fader + .2 * (.5 + .5 * Math.sin(t * .19)), 1.1 + .02 * Math.exp(-b * 6) * A.bass, .5 + .05 * Math.sin(t * .8)];
      var up = [st.raiseSide * .75, 2.45 + .08 * Math.sin(t * 4), .3], rs = st.raise;
      if (st.raiseSide > 0) tR = [tR[0] + (up[0] - tR[0]) * rs, tR[1] + (up[1] - tR[1]) * rs, tR[2] + (up[2] - tR[2]) * rs];
      else tL = [tL[0] + (-.75 - tL[0]) * rs, tL[1] + (up[1] - tL[1]) * rs, tL[2] + (up[2] - tL[2]) * rs];
      var aL = vxIK(shL, tL, .42, .4, -1), aR = vxIK(shR, tR, .42, .4, 1);
      put(0, [ch[0] + lean * .3, 2.12 - st.nod * .05, .02], st.turn); put(1, [0, 1.85, 0], st.nod); put(2, shL); put(3, aL[0]); put(4, aL[1]);
      put(5, shR); put(6, aR[0]); put(7, aR[1]); put(8, ch, lean);
      J[36] = .7 - (st.raiseSide < 0 ? rs * .5 : 0); J[37] = .55 + .2 * Math.sin(t * 6) * A.high - (st.raiseSide > 0 ? rs * .4 : 0); J[38] = st.deckA; J[39] = st.deckB;
      st.cam += s * .05;
      return { T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, build: A.build, jp: J, lasers: .35 + A.high * .55 + A.beat * .2, screens: .2 + A.mid * .8, crowd: .2 + A.energy * .8 + st.raise * .4, cam: .25 * Math.sin(st.cam) };
    };
  };
  VX_SCENE.mushroomworld = function () {
    var st = { T: 4, camx: 0, flow: 0, burst: 0, open: .3 };
    return function (A, dt, t) {
      var s = dt / 1000;
      st.T += s * (.8 + A.energy * .3);
      st.camx += s * (.025 + A.mid * .02);                                       // slow drift through the forest
      st.flow += s * (.5 + A.mid * 1.2);
      if (A.strong) st.burst = Math.min(1.3, st.burst + .8);                     // coordinated openings and spore clouds
      st.burst *= Math.exp(-dt / 1400);
      st.open += ((.3 + .25 * Math.sin(t * .4) + A.mid * .3 + st.burst * .5) - st.open) * Math.min(1, s * 2);
      return { T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, build: A.build, camx: .35 * Math.sin(st.camx) + st.camx * .2, flow: st.flow, burst: st.burst, open: st.open, spores: Math.min(1.2, A.high * .9 + st.burst * .8) };
    };
  };
  VX_SCENE.ufo = function () {
    var st = { T: 6, z: 0, zT: 0, x: 0, ringA: 0, ringB: 0, sweep: 0, tractor: .3, dis: 0, appr: 25, yaw: 0, minis: new Float32Array(12) };
    return function (A, dt, t) {
      var s = dt / 1000;
      st.T += s;
      st.appr -= s; if (st.appr <= 0 || (A.drama > .6 && st.appr < 15)) { st.zT = st.zT > .5 ? 0 : 1.6; st.appr = 22 + Math.random() * 14; }   // approach, then retreat
      st.z += (st.zT - st.z) * Math.min(1, s * .18);
      var xT = .35 * Math.sin(t * .07) * (1 - st.z * .4), vx = xT - st.x; st.x += vx * Math.min(1, s * .5);
      st.yaw += s * (.15 + A.mid * .4);
      st.ringA += s * (.25 + A.mid * 1.4); st.ringB -= s * (.4 + A.mid * 1.1);
      st.sweep += s * (.35 + A.mid * .4);
      st.tractor += ((.15 + A.bass * .85 + A.beat * .3) * (.5 + .5 * Math.sin(t * .09) > .3 ? 1 : .2) - st.tractor) * Math.min(1, s * 3);
      if (A.strong) st.dis = 1; st.dis = Math.max(0, st.dis - s / 1.2);
      var by = .55 + .03 * Math.sin(t * 1.1) + A.bass * .05 - st.z * .12;
      for (var i = 0; i < 3; i++) { var a = t * (.3 + i * .12) + i * 2.1, rx = .55 + i * .12, sx = st.x * .35 + Math.cos(a) * rx, sy = .3 + .12 * Math.sin(a * 1.3) + i * .05;
        st.minis[i * 4] = sx; st.minis[i * 4 + 1] = sy; st.minis[i * 4 + 2] = .008 + .004 * (Math.sin(a) * .5 + .5) + i * .001; st.minis[i * 4 + 3] = -Math.sin(a) > 0 ? 1 : -1; }
      return { T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, build: A.build, upos: [st.x, by, st.z], uang: [st.yaw, .1 + .05 * Math.sin(t * .5) + vx * .3, -vx * .6 + .04 * Math.sin(t * .7)],
        ringA: st.ringA, ringB: st.ringB, tractor: st.tractor, field: .25 + A.bass * .6 + st.dis * .4, sweep: st.sweep, discharge: st.dis, minis: st.minis };
    };
  };
  VX_SCENE.rollercoaster = function () {
    var st = { T: 2, zc: 10, v: 7, pulse: 0, flash: 0 };
    return function (A, dt, t) {
      var s = dt / 1000;
      st.T += s;
      if (A.strong) st.v += 3 + A.bass * 3;                                       // coordinated acceleration bursts
      var vT = 6 + A.energy * 6 + A.bass * 4 + 2 * Math.sin(t * .11);              // climbs and dives change pace
      st.v += (vT - st.v) * Math.min(1, s * .9);
      st.zc += s * st.v; st.pulse += s * (.6 + A.mid * 1.5);
      if (A.hit) st.flash = Math.max(st.flash, .5 + A.bass * .5); st.flash *= Math.exp(-dt / 500);
      return { T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, build: A.build, zc: st.zc, speed: Math.min(1.2, Math.max(0, (st.v - 5) / 9)), pulse: st.pulse, flash: st.flash };
    };
  };
  VX_SCENE.livingskull = function () {
    var st = { T: 1, jaw: .04, yaw: 0, pitch: 0, roar: 0, roarT: 0, cool: 6, crack: 0, frag: 0 };
    return function (A, dt, t) {
      var s = dt / 1000, b = A.phase % 1;
      st.T += s;
      st.cool -= s; if (st.cool <= 0 && (A.strong && (A.drama > .5 || A.build > .3))) { st.roarT = 1.8; st.cool = 8; }
      st.roarT -= s; st.roar += ((st.roarT > 0 ? 1 : 0) - st.roar) * Math.min(1, s * (st.roarT > 0 ? 5 : 2));
      // jaw: chatters with bass, accents on beats, opens slowly through build-ups, wide on a roar
      var jT = .03 + A.bass * .2 * (.6 + .4 * Math.exp(-b * 5)) + A.build * .25 + st.roar * .4 + .015 * Math.sin(t * 2.3);
      vxSpring(st, 'jaw', Math.min(.55, jT), 120, 15, s);
      vxSpring(st, 'yaw', .4 * Math.sin(t * .13) + .18 * Math.sin(t * .31 + 1) + A.mid * .12 * Math.sin(t * .9), 6, 4, s);
      vxSpring(st, 'pitch', -.04 + .08 * Math.sin(t * .17) - st.roar * .12 + A.bass * .05 * Math.exp(-b * 5), 20, 7, s);
      st.crack += ((A.drama * .7 + st.roar * .6) - st.crack) * Math.min(1, s * .8);
      st.frag += ((A.high * .35 + st.roar * .8) - st.frag) * Math.min(1, s * 2);
      return { T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, build: A.build, hrot: [st.yaw, st.pitch, .05 * Math.sin(t * .11)], jaw: st.jaw,
        glow: .4 + A.energy * .5 + st.roar * .5, crack: st.crack, beam: .2 + A.high * .4 + st.roar * .6, mouthE: Math.min(1.2, st.jaw * 1.4 + st.roar * .6), frag: st.frag };
    };
  };
  VX_SCENE.alienparty = function () {
    var rig = vxDanceRig(), st = { T: 1, floorP: 0 };
    return function (A, dt, t) {
      var s = dt / 1000;
      st.T += s; if (A.hit) st.floorP += 1;
      var J = rig.pose(t, A.phase, A, dt);
      return { T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, build: A.build, J: J, lasers: .3 + A.high * .6, spot: .6 + A.mid * .5, floorP: st.floorP, group: rig.state.group };
    };
  };
  VX_SCENE.neonhighway = function () {
    var st = { T: 2, D: 0, v: 24, run: -50, runAmp: 0, bob: 0, steer: 0 };
    return function (A, dt, t) {
      var s = dt / 1000;
      st.T += s;
      st.v += ((22 + A.energy * 10 + A.bass * 6) - st.v) * Math.min(1, s * .6);
      st.D += s * st.v;
      // light runs race away down the highway on beats; strong sections send brighter runs
      if (A.hit) { st.run = 0; st.runAmp = Math.min(1.4, .45 + A.bass * .5 + (A.drama > .5 ? .5 : 0)); }
      st.run += s * (70 + st.v); st.runAmp *= Math.exp(-dt / 1600);
      vxSpring(st, 'bob', (Math.sin(t * 7.3) * .4 + Math.sin(t * 3.1) * .6) * .5 + A.bass * .8 * Math.exp(-(A.phase % 1) * 6), 60, 9, s);
      vxSpring(st, 'steer', .35 * Math.sin(t * .23) + .15 * Math.sin(t * .71), 8, 5, s);
      return { T: st.T, bass: A.bass, mid: A.mid, high: A.high, beat: A.beat, build: A.build, D: st.D, run: st.run, runAmp: st.runAmp, bob: st.bob, steer: st.steer, section: st.D * .0015 };
    };
  };

  // ---- switcher, crossfade and exit inside the experience ----
  function vxSnapshot() {
    if (!glc || glc.style.display === 'none' || glc.width < 4) return;
    if (!vxSnapCv) { vxSnapCv = document.createElement('canvas'); vxSnapCv.id = 'vxSnap'; vxSnapCv.setAttribute('aria-hidden', 'true'); }
    if (vxSnapCv.parentNode !== layer) layer.appendChild(vxSnapCv);
    vxSnapCv.style.transition = 'none'; vxSnapCv.style.opacity = '1';
    vxSnapCv.width = glc.width; vxSnapCv.height = glc.height;
    try { vxSnapCv.getContext('2d').drawImage(glc, 0, 0); } catch (e) {}
    void vxSnapCv.offsetWidth;
    requestAnimationFrame(function () { requestAnimationFrame(function () { vxSnapCv.style.transition = 'opacity .75s ease'; vxSnapCv.style.opacity = '0'; }); });
  }
  function vxShowBar(ms) {
    if (!vxBar) return;
    vxBar.classList.add('on'); clearTimeout(vxBarTimer);
    vxBarTimer = setTimeout(function () { if (vxBar) vxBar.classList.remove('on'); }, ms || 4000);
  }
  function vxEnsureBar() {
    if (!vxBar) {
      vxBar = document.createElement('nav'); vxBar.id = 'vxBar'; vxBar.setAttribute('aria-label', 'Visuals');
      vxBar.innerHTML = '<div class="vx-list">' + VX_ORDER.map(function (k, i) { return '<button type="button" class="vx-pick" data-vx="' + k + '"><span>' + (i < 9 ? '0' : '') + (i + 1) + '</span>' + VX_NAMES[k] + '</button>'; }).join('') + '</div>' +
        '<button type="button" class="vx-exit" data-vxexit="1" aria-label="Exit Visuals">EXIT</button>';
      vxBar.addEventListener('click', function (e) {
        e.stopPropagation();
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        if (b.getAttribute('data-vxexit')) { if (window.Nexus && Nexus.home) Nexus.home(); else XP.close(); return; }   // EXIT returns to Nexus Home
        var k = b.getAttribute('data-vx'); if (k && k !== XP.current) XP.switchTo(k); else vxShowBar();
      });
    }
    if (vxBar.parentNode !== layer) layer.appendChild(vxBar);
    Array.prototype.forEach.call(vxBar.querySelectorAll('[data-vx]'), function (el) { var on = el.getAttribute('data-vx') === XP.current; el.classList.toggle('active', on); el.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    vxBar.style.display = '';
    var act = vxBar.querySelector('.vx-pick.active'); if (act && act.scrollIntoView) try { act.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (err) {}
  }
  function vxStart(name) {
    if (!glStart('vx_boot', 'void main(){ gl_FragColor = vec4(0.,0.,0.,1.); }')) {
      text('xpMid', 'This screen needs WebGL graphics for Visuals'); return;
    }
    vxCur = name; vxScale = Math.min(VX_GLX_MAX, Math.max(VX_GLX_MIN, vxScale || VX_GLX_MAX)); GLX = vxScale; size();
    layer.classList.add('vx-active');
    var A2 = vxAudio(), scene = VX_SCENE[name](), lastT = 0, t = 0;
    try { if (name === 'hollowhead') { vxHeadMesh(); vxCompile('vx_headmesh', VX_HEAD_VS, VX_HEAD_FS); } vxFull(name); }
    catch (e) { text('xpMid', 'Visual could not start on this graphics chip'); try { console.log(String(e.message || e)); } catch (err) {} return; }
    vxEnsureBar(); vxShowBar(3200);
    layer.onclick = function () { vxShowBar(); };
    XP.vxDebug = function () { return { current: vxCur, frames: vxState ? vxState.frames : 0, glx: GLX, w: glc.width, h: glc.height, programs: Object.keys(vxProg).length, mesh: !!vxMesh, audio: { bass: A2.bass, mid: A2.mid, high: A2.high, beat: A2.beat, drama: A2.drama }, u: vxState && vxState.u }; };
    vxState = { frames: 0, u: null };
    function frame(now) {
      var dt = lastT ? Math.min(66, now - lastT) : 33; lastT = now; t += dt / 1000;
      // adaptive resolution: hold frame pacing on the 2 GB box, keep full detail on the 8 GB box
      if (dt > 48) { vxSlow++; vxFast = 0; } else { vxFast++; vxSlow = Math.max(0, vxSlow - 1); }
      if (vxSlow > 45 && vxScale > VX_GLX_MIN) { vxScale = Math.max(VX_GLX_MIN, vxScale - .1); GLX = vxScale; size(); vxSlow = 0; }
      else if (vxFast > 300 && vxScale < VX_GLX_MAX) { vxScale = Math.min(VX_GLX_MAX, vxScale + .05); GLX = vxScale; size(); vxFast = 0; }
      var u = scene(A2.tick(now, dt), dt, t);
      gl.viewport(0, 0, glc.width, glc.height);
      if (name === 'hollowhead') vxDrawHead(u, glc.width, glc.height);
      else vxDrawFull(vxFull(name), u, glc.width, glc.height);
      vxState.frames++; vxState.u = u;
    }
    frame(performance.now());   // first frame is drawn before the canvas is composited: no black frame on entry
    loop(frame, 30, 30);
  }
  // Diagnostic render used by the automated tests: draws one frame of a visual with chosen
  // values (merged over its live choreography) and returns an 80x45 luminance grid.
  function vxProbe(name, over, steps, audioIn) {
    if (VX_ORDER.indexOf(name) < 0 || !ensureGl()) return null;
    var w = 320, h = 180, ow = glc.width, oh = glc.height, A0 = { bass: 0, mid: 0, high: 0, beat: 0, energy: 0, drama: 0, rise: 0, hit: false, strong: false, build: 0, phase: 2.2, quiet: 1 }, scene = VX_SCENE[name](), u;
    for (var ak in (audioIn || {})) A0[ak] = audioIn[ak];
    for (var i = 0; i < (steps || 3); i++) u = scene(A0, 33, 5 + i * .033);
    for (var k in (over || {})) u[k] = over[k];
    glc.width = w; glc.height = h; gl.viewport(0, 0, w, h);
    if (name === 'hollowhead') vxDrawHead(u, w, h); else vxDrawFull(vxFull(name), u, w, h);
    var px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var grid = [], rgb = [0, 0, 0];
    for (var y = 0; y < 45; y++) for (var x = 0; x < 80; x++) { var o = ((h - 1 - y * 4) * w + x * 4) * 4; grid.push(Math.round(.299 * px[o] + .587 * px[o + 1] + .114 * px[o + 2])); rgb[0] += px[o]; rgb[1] += px[o + 1]; rgb[2] += px[o + 2]; }
    glc.width = ow; glc.height = oh;
    var uo = {}; for (var uk in u) { var uv = u[uk]; uo[uk] = typeof uv === 'number' ? uv : Array.prototype.slice.call(uv); }
    return { grid: grid, rgb: rgb.map(function (v) { return v / 3600; }), u: uo };
  }
  // Still frames of each experience for the Visuals selector (rendered once and cached).
  var vxPreviewCache = null, VX_PREVIEW_VERSION = '13-1';
  function vxPreviews(cb) {
    if (vxPreviewCache) { cb(vxPreviewCache); return; }
    if (!ensureGl()) { cb({}); return; }
    var ow = glc.width, oh = glc.height, w = 320, h = 180, out = {}, cacheKey = 'nexus.vxPreviews.' + VX_PREVIEW_VERSION;
    try { var cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (cached && VX_ORDER.every(function (k) { return cached[k]; })) { vxPreviewCache = cached; cb(cached); return; } } catch (e) {}
    glc.width = w; glc.height = h; gl.viewport(0, 0, w, h);
    VX_ORDER.forEach(function (name) {
      try {
        var A0 = { bass: .35, mid: .4, high: .45, beat: .2, energy: .45, drama: .2, rise: 0, hit: false, strong: false, build: .1, phase: 3.3, quiet: 0 }, scene = VX_SCENE[name](), u;
        for (var i = 0; i < 14; i++) u = scene(A0, 120, 18 + i * .12);
        if (name === 'hollowhead') { u.yaw = -.38; u.pitch = -.14; vxDrawHead(u, w, h); } else vxDrawFull(vxFull(name), u, w, h);
        out[name] = glc.toDataURL('image/jpeg', .84);
      } catch (e) { out[name] = ''; }
    });
    glc.width = ow; glc.height = oh;
    if (!XP.active) vxRelease();
    vxPreviewCache = out;
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('nexus.vxPreviews.') === 0 && k !== cacheKey) localStorage.removeItem(k); }); localStorage.setItem(cacheKey, JSON.stringify(out)); } catch (e) {}
    cb(out);
  }

  // ==================================================================
  // NIGHT DRIVE — a continuous journey along a neon highway through
  // alien worlds. The camera, the road, the controls and the audio are
  // shared; a world supplies only its sky, its horizon haze and the
  // ground either side of the road, so another world is a new ND_WORLDS
  // entry rather than another experience.
  // ==================================================================
  var ND_HEAD = `
uniform float travel, night, react, mids, highs, q;
uniform vec3 cA, cB, cC, cD;
float fbm(vec2 p, float oct){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6);
 for(int i=0;i<5;i++){ if(float(i)>=oct) break; v+=a*noise(p); p=m*p+vec2(3.1,1.7); a*=.5; } return v; }
// The road winds and rolls as smooth functions of distance driven, so its shape keeps
// changing for the whole journey instead of looping back on a short cycle.
float curveAt(float z){ return 16.*sin(z*.0021) + 9.*sin(z*.00085+1.7) + 5.*sin(z*.0047+4.1); }
float hillAt(float z){ return 7.*sin(z*.0013+2.2) + 3.5*sin(z*.0031+.6); }
// Jagged horizon ranges. lay 0 is the near range, lay 1 drifts more slowly for parallax.
float ndRidge(float az, float lay, float tr){
 float k = .35 + lay*.55;
 float x = az*(2.4+lay*2.2) + tr*(.00022+lay*.00055);
 float n = fbm(vec2(x, lay*9.1), 3.);
 float n2 = 1.-abs(fbm(vec2(x*2.3+4., lay*9.1+2.), 3.)*2.-1.);
 float n3 = 1.-abs(fbm(vec2(x*5.1+11., lay*9.1+5.), 2.)*2.-1.);
 float massif = .35 + 1.25*fbm(vec2(x*.26+30., lay*3.3), 2.);
 return (n*.55 + pow(n2,1.6)*.75 + pow(n3,2.)*.3) * k * massif;
}
`;

  // Every world implements these three, and nothing else.
  //   ndSky   — everything above the road: sky, celestial bodies, horizon silhouettes
  //   ndHaze  — the cheap colour the road fades into at the horizon
  //   ndGround— the terrain either side of the asphalt
  var ND_MAIN = `
void main(){
 vec2 uv = (gl_FragCoord.xy - .5*res)/res.y;
 float t = time, tr = travel;
 vec3 ro = vec3(0.);
 vec3 rd = normalize(vec3(uv.x*1.12, uv.y*1.12 + .085, -1.));
 vec3 col = ndSky(rd, t);
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
  vec3 ground = ndGround(xr, wz, fade);
  if(edge < HALF+1.6){
   float grain = noise(vec2(xr*2.4, wz*2.4))*.5 + noise(vec2(xr*9., wz*9.))*.25;
   vec3 road = vec3(.034,.035,.052) + grain*.022;
   // wet sheen: the sky smeared down the asphalt
   float wet = smoothstep(1.05,.1,edge/HALF);
   road += mix(cB, cC, .45) * .042 * wet * (1.-night*.45);
   road += mix(cB, vec3(1.), .25) * .038 * exp(-abs(xr+3.)*.10) * smoothstep(.0,.25,fade) * (1.-night*.3);
   road += mix(cA, cB, .5) * .028 * (.5+.5*sin(wz*.02)) * wet * fade;
   // lines widen gently with distance so far edges stay clean instead of shimmering
   float aa = zd*.0045;
   // dashed lane markings
   float dash = smoothstep(.40, .44, fract(wz*.085)) * smoothstep(1., .96, fract(wz*.085));
   float lane1 = smoothstep(.34+aa,.0,abs(edge-3.7)) * dash;
   float lane2 = smoothstep(.30+aa,.0,abs(edge-7.4)) * dash;
   road += vec3(.85,.88,.98)*(lane1*.55+lane2*.45)*fade;
   // neon shoulders: the colour leans toward the second palette colour with the music, light
   // pulses race along the edges with the beat, and the glow swells with the energy
   float mus = react*clamp(energy, 0., 1.);
   vec3 neon = mix(cA, cC, clamp(mids*react*.85, 0., .7));
   neon = mix(neon, cD, .22*(.5+.5*sin(wz*.003 + t*.15)));
   float run = pow(.5+.5*sin(wz*.055 - t*5.5), 8.) * (.12 + mus*1.3);
   float sL = smoothstep(.62+aa,.0,abs(edge-HALF));
   float core = smoothstep(.22+aa*.5,.0,abs(edge-HALF));
   road += neon*sL*(1.55 + kick*react*1.5 + run*2.2);
   road += mix(neon, vec3(1.), .55)*core*(.7 + kick*react*.8 + run);
   road += mix(neon, cB, .5)*exp(-abs(edge-HALF)*1.1)*.5*(1. + mus*.9 + run*.8);
   road += mix(cB, neon, .4)*exp(-abs(edge-HALF)*.38)*.11*smoothstep(HALF,0.,edge)*(1. + mus*.8);
   road += mix(neon, cD, .5)*exp(-abs(edge-HALF)*.9)*.16*(1.-fade)*(.8+kick*react*.9);
   ground = mix(ground, road, smoothstep(HALF+1.6, HALF+.2, edge));
  }
  ground = mix(ndHaze(rd, t), ground, fade);
  col = mix(col, ground, smoothstep(-.0015,-.02, rd.y));
 }
 col *= 1. + kick*react*.10;
 float lum = dot(col, vec3(.299,.587,.114));
 col = max(mix(vec3(lum), col, 1.14), 0.);
 col = col*(2.51*col+.03)/(col*(2.43*col+.59)+.14);
 col = pow(clamp(col,0.,1.), vec3(.95));
 col *= .80 + .20*smoothstep(1.45,.3, length(uv*vec2(.78,1.)));
 col += (hash(gl_FragCoord.xy + fract(t*11.))-.5)/255.*2.;
 gl_FragColor = vec4(clamp(col,0.,1.), 1.);
}
`;

  // ---- World 1: CELESTIAL RINGS ----
  var ND_CELESTIAL_RINGS = `
const vec3 PC = vec3(-430., 300., -1150.);   // planet centre, held in camera space so it
const float PR = 300.;                       // stays a landmark for the whole journey
vec3 ndStars(vec3 rd, float t){
 vec2 g = vec2(atan(rd.x, -rd.z)*2.2, rd.y*3.4);
 vec3 o = vec3(0.);
 for(int i=0;i<2;i++){ float fi=float(i);
  vec2 sc = g*(26.+fi*41.);
  vec2 id = floor(sc), f = fract(sc)-.5;
  float h = hash(id+fi*17.), h2 = hash(id+fi*17.+3.3);
  f -= (vec2(h,h2)-.5)*.66;
  float tw = .55+.45*sin(t*(.7+h*2.2)+h*40.) + highs*react*.5*step(.5,h2);
  o += mix(vec3(.80,.88,1.), mix(vec3(1.,.84,.96), cD, .3), h2) * step(.930-fi*.016, h) * exp(-dot(f,f)*(74.+fi*62.)) * tw * (1.-fi*.3);
 }
 return o;
}
vec3 ndNebula(vec3 rd, float t){
 vec2 p = vec2(atan(rd.x,-rd.z)*1.25, rd.y*1.9);
 vec2 w = vec2(fbm(p*1.3+vec2(t*.009,0.),3.), fbm(p*1.3+vec2(4.2,-t*.007),3.))-.5;
 float n = fbm(p*1.7+w*1.9+vec2(t*.004,t*.003), 3.+q);
 float m = smoothstep(.30,.84,n);
 // large, slow zones decide whether a stretch of sky runs magenta, violet or turquoise
 float zone = fbm(p*.42+vec2(t*.003,1.7), 2.);
 vec3 c = mix(cC, cB, smoothstep(.30,.72,zone));
 c = mix(c, cD, smoothstep(.56,.86,zone));
 c = mix(c, mix(c, vec3(1.), .6), smoothstep(.68,.97,n)*.4);
 return (c*m*(.42+energy*react*.16) + mix(c,cB,.4)*smoothstep(.18,.7,n)*.08) * (1.-night*.30);
}
// The giant: analytic sphere, banded cloud detail, terminator and a lit limb.
vec4 ndPlanet(vec3 ro, vec3 rd, vec3 L, float t, out float tHit){
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
 float band = smoothstep(.22,.86, .5 + .5*sin(lat*11.0 + bands*5.0 + swirl*1.9));
 float polar = 1.-pow(abs(lat),2.6);
 vec3 deep = mix(vec3(.006,.006,.030), vec3(.030,.016,.082), band);
 vec3 cloud = mix(mix(cB*.42, cC*.55, band*.5), vec3(.52,.34,.95), band*.7);
 vec3 lit = mix(deep, cloud, (.22+band*.52)*polar);
 float lam = max(dot(n, L), 0.), term = pow(lam, .7);
 vec3 col = lit * (.03 + .97*term);
 col += mix(cA, vec3(1.), .25) * pow(smoothstep(.58,.93,swirl),2.5) * (.04+term*.85) * (.6+kick*react*.5) * polar;
 col += mix(cC, vec3(1.,.8,1.), .3) * pow(smoothstep(.55,.92,band*swirl+.12),3.) * term * .45;
 float fres = pow(1.-max(dot(n,-rd),0.), 3.2);
 col += mix(cB, vec3(.88,.93,1.), .45) * fres * (.22 + term*2.1);
 col += cB * pow(1.-max(dot(n,-rd),0.), 7.) * .35;
 return vec4(col, 1.);
}
// Layered rings: banded dust in a tilted plane, lit by the same star and shadowed by the planet.
vec4 ndRings(vec3 ro, vec3 rd, vec3 rn, vec3 L, float t, float tPlanet, out float tRing){
 tRing = 1e9;
 float den = dot(rd, rn);
 if(abs(den) < 1e-4) return vec4(0.);
 float tt = dot(PC - ro, rn)/den;
 if(tt < 0.) return vec4(0.);
 tRing = tt;
 vec3 pos = ro + rd*tt;
 float r = length(pos - PC)/PR;
 if(r < 1.22 || r > 2.72) return vec4(0.);
 float band = fbm(vec2(r*9.5, 3.1), 3.+q);
 float fine = smoothstep(.15,.95, .5+.5*sin(r*34.+band*7.));
 float gap = smoothstep(.10,.46, fbm(vec2(r*4.2, 8.2),2.));
 float dens = gap*(.45+.55*band)*(.42+.58*fine);
 dens *= smoothstep(1.22,1.42,r)*smoothstep(2.72,2.30,r);
 // the planet throws a shadow across the far side of the rings
 float along = dot(PC - pos, L);
 float distAx = length((PC - pos) - L*along);
 float shadow = (along > 0. && distAx < PR) ? smoothstep(PR, PR*.72, distAx) : 0.;
 dens *= 1.-shadow*.88;
 float hu = r*1.15 + band*.3 + t*.003 + mids*react*.18;
 float sweep = .5+.5*cos(hu*6.28318);
 vec3 col = mix(mix(cB, cC, sweep), cA, smoothstep(.55,1., .5+.5*sin(hu*12.566)) * .55);
 col = mix(col, cA, smoothstep(.5,.95,fine)*.3);
 col = mix(col, mix(col, vec3(1.), .75), pow(fine,3.)*.5);
 col += vec3(.75,.85,1.)*pow(smoothstep(.55,1.,dens),2.)*.5;
 // with music, bright ripples travel outward through the rings and the fine bands shimmer
 float ring = 1.25 + fract(t*.32)*1.45, ring2 = 1.25 + fract(t*.32+.5)*1.45;
 float wave = (exp(-pow((r-ring)*7.,2.)) + exp(-pow((r-ring2)*7.,2.))) * react * (.2*energy + .6*kick);
 col += mix(cA, cC, .3) * wave * (.4 + dens);
 col *= 1. + highs*react*.35*fine;
 return vec4(col*(.62+dens*1.05)*(1.+energy*react*.35+mids*react*.45), clamp(dens*1.9 + wave*.25, 0., 1.));
}
vec3 ndHaze(vec3 rd, float t){
 vec3 skyLow = mix(vec3(.040,.060,.150), vec3(.014,.022,.068), night);
 return skyLow + mix(mix(cA, cD, .45), cB, .35)*(.14+energy*react*.06)*(1.-night*.62)
   + mix(cA, cB, .55)*(.05+energy*react*.04)*(1.-night*.35);
}
vec3 ndGround(float xr, float wz, float fade){
 float gn = fbm(vec2(xr*.035, wz*.012), 3.);
 vec3 c = mix(vec3(.010,.009,.024), vec3(.022,.016,.045), gn) * (1.-night*.35);
 float sparkle = step(.88, hash(floor(vec2(xr*.22, wz*.22))))*exp(-fract(wz*.22)*4.);
 return c + mix(cA,cD,.5)*sparkle*.10*fade;
}
vec3 ndSky(vec3 rd, float t){
 vec3 ro = vec3(0.);
 vec3 L = normalize(vec3(-.62, .52, .58));
 vec3 rn = normalize(normalize(vec3(.30, .92, -.16)) + vec3(.045*sin(t*.021), 0., .05*sin(t*.017+1.3)));
 vec3 skyTop = mix(vec3(.014,.012,.062), vec3(.005,.004,.026), night);
 vec3 skyMid = mix(vec3(.030,.026,.105), vec3(.011,.009,.046), night);
 vec3 skyLow = mix(vec3(.040,.060,.150), vec3(.014,.022,.068), night);
 vec3 col = mix(mix(skyLow, skyMid, smoothstep(-.04,.20,rd.y)), skyTop, smoothstep(.12,.62,rd.y));
 col += ndNebula(rd, t);
 col += ndStars(rd, t) * (.5+night*.6);
 float tP, tR; vec4 P = ndPlanet(ro, rd, L, t, tP);
 vec4 Rg = ndRings(ro, rd, rn, L, t, tP, tR);
 bool front = Rg.a > 0. && tR < tP;
 if(Rg.a > 0. && !front) col = mix(col, Rg.rgb, Rg.a);
 if(P.a > 0.) col = mix(col, P.rgb, P.a);
 if(front) col = mix(col, Rg.rgb, Rg.a);
 // broad glow so the formation sits in the sky rather than on it
 col += mix(cB, cC, .4) * exp(-length(rd - normalize(PC))*3.4) * (.07 + energy*react*.05);
 col += mix(mix(cA, cD, .45), cB, .35) * exp(-abs(rd.y)*11.) * (.14+energy*react*.06) * (1.-night*.62);
 // alien ranges, far first
 float az = atan(rd.x, -rd.z), el = rd.y / max(length(rd.xz), 1e-4);
 for(int i=1;i>=0;i--){ float lay=float(i);
  float h = ndRidge(az, lay, travel)*(.085+lay*.06) - .030 + lay*.012;
  if(el < h){
   float depth = 1.-lay*.5;
   vec3 rock = mix(vec3(.008,.007,.022), vec3(.016,.012,.036), lay);
   col = mix(col, rock, .94);
   col += mix(cA, cB, .4)*exp(-max(h-el,0.)*210.)*(.75+energy*react*.4)*depth;
   col += mix(cB, cC, .5)*exp(-max(h-el,0.)*26.)*.07*depth;
  }
 }
 return col;
}
`;

  var ND_WORLDS = [
    { id: 'rings', name: 'CELESTIAL RINGS', frag: ND_CELESTIAL_RINGS }
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

  function nightDrive() {
    var world = ndWorld(N.pref('ndWorld') || 'rings');
    var palette = ndFind(ND_PALETTES, N.pref('ndPalette') || 'ultraviolet');
    var timeOfNight = ndFind(ND_TIMES, N.pref('ndTime') || 'night');
    var speed = ndFind(ND_SPEEDS, N.pref('ndSpeed') || 'cruise');
    var react = N.pref('ndReact') !== '0';
    var oldGLX = GLX;
    GLX = HIGH_MEMORY_DEVICE ? 1.05 : .70;
    var quality = HIGH_MEMORY_DEVICE ? 1 : 0;
    var travel = 0, lastNow = 0, frames = 0, beat = null, g = null, failed = false, surge = 0;

    function beatOn() { if (!beat) beat = beatTracker({ quiet: true }); }
    function beatOff() { beat = null; try { if (A) A.meter(false); } catch (e) {} }
    if (react) beatOn();

    function build() {
      g = glStart('nd-' + world.id, ND_HEAD + world.frag + ND_MAIN);
      failed = !g;
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
      var b = null;
      if (beat) { beat.tick(now); b = beat; }
      // the drive surges with the music's energy and eases back when it calms (never jumps)
      surge += ((react && b ? Math.min(1, b.e) * .4 : 0) - surge) * Math.min(1, dt * 1.5);
      travel += speed[2] * dt * (1 + surge);
      if (travel > 1e7) travel -= 1e7;   // stays in float range on a very long journey
      g.f('travel', travel);
      g.f('night', timeOfNight[2]);
      g.f('react', react ? 1 : 0);
      g.f('mids', b ? b.mid : 0);
      g.f('highs', b ? b.high : 0);
      g.f('q', quality);
      g.v3('cA', palette[2]); g.v3('cB', palette[3]); g.v3('cC', palette[4]); g.v3('cD', palette[5]);
      g.draw(now, b, 0);
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
        travel: travel, frames: frames, gl: !!g, quality: quality, glx: GLX,
        idle: layer.classList.contains('nd-idle'), controls: !!ui.parentNode, beat: !!beat };
    };
  }

  var XP = window.XP = {
    active: false,
    current: null,
    cleanupCurrent: null,
    onMeter: null,
    Packs: { schemaVersion: 1, validate: validateWorldPack, install: installWorldPack, list: listWorldPacks, asset: openWorldPackAsset, remove: removeWorldPack },
    visuals: VX_ORDER.slice(),
    visualNames: VX_NAMES,
    previews: vxPreviews,
    vxProbe: vxProbe,
    // Switch between the five visuals without leaving Visuals: the last frame dissolves over the new one.
    switchTo: function (name) { if (VX_ORDER.indexOf(name) < 0) return; vxSnapshot(); XP.open(name); },
    open: function (name) {
      var known = VX_ORDER.indexOf(name) >= 0 || ({ holo: 1, webcams: 1, clockface: 1, lyrics: 1, liquiddreams: 1, nightdrive: 1 })[name];
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
      if (VX_ORDER.indexOf(name) >= 0) { vxStart(name); return true; }
      ({ holo: holo, webcams: webcams, clockface: clockface, lyrics: lyrics, liquiddreams: liquidDreams, nightdrive: nightDrive })[name]();
      return true;
    },
    close: function (quiet) {
      running = null;
      if (XP.cleanupCurrent) { XP.cleanupCurrent(); XP.cleanupCurrent = null; }
      if (vxCur) {
        vxCur = null; vxState = null; delete XP.vxDebug; layer.classList.remove('vx-active');
        clearTimeout(vxBarTimer); if (vxBar) { vxBar.classList.remove('on'); vxBar.style.display = 'none'; }
        if (gl) { gl.disable(gl.BLEND); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null); }
      }
      glStop();
      if (atmosphereCtx) atmosphereCtx.clearRect(0, 0, atmosphereCanvas.width, atmosphereCanvas.height);
      atmosphereParticles = []; atmosphereProfile = null;
      xpDom.forEach(function (d) { if (d.parentNode) d.parentNode.removeChild(d); }); xpDom = [];
      cancelAnimationFrame(raf);
      timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
      timers = [];
      XP.onMeter = null;
      try { if (A) A.meter(false); } catch (e) {}
      if (XP.active && !quiet) N.stopTalking();
      XP.active = false;
      XP.current = null;
      // Leaving Visuals entirely releases the shader programs, head mesh and render buffer.
      if (!quiet) { vxRelease(); if (vxSnapCv) { vxSnapCv.width = 1; vxSnapCv.height = 1; } }
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
