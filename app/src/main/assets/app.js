/* NEXUS — truck box assistant. UI + logic. Runs inside an Android WebView with window.Android as the bridge. */
(function () {
  'use strict';

  var A = window.Android || null;
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------
  // Bridge helpers (with browser fallbacks so the page also runs on a PC)
  // ------------------------------------------------------------------
  var Nexus = window.Nexus = {};
  var speakWaiters = {}, httpWaiters = {}, seq = 0;


  // ---- Real local time. The box's own clock/timezone can be wrong, so once we know where we are,
  //      we use the timezone offset from the weather service (based on GPS/city) instead. ----
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function L() {
    var off = parseInt(pref('utcoff'), 10);
    if (isNaN(off)) { var d0 = new Date(); return { h: d0.getHours(), m: d0.getMinutes(), dow: d0.getDay(), day: d0.getDate(), mon: d0.getMonth(), y: d0.getFullYear() }; }
    var d = new Date(Date.now() + off * 1000);
    return { h: d.getUTCHours(), m: d.getUTCMinutes(), dow: d.getUTCDay(), day: d.getUTCDate(), mon: d.getUTCMonth(), y: d.getUTCFullYear() };
  }
  function timeStr() { var l = L(); return (l.h % 12 || 12) + ':' + (l.m < 10 ? '0' : '') + l.m + (l.h < 12 ? ' AM' : ' PM'); }
  function dateStr() { var l = L(); return DAYS[l.dow] + ', ' + MONTHS[l.mon] + ' ' + l.day; }

  function pref(k) { try { return A ? A.getPref(k) : (localStorage.getItem('p_' + k) || ''); } catch (e) { return ''; } }
  function setPref(k, v) { try { if (A) A.setPref(k, v); else localStorage.setItem('p_' + k, v); } catch (e) {} }

  // ---- Music pauses while Nexus talks or listens, and comes back after ----
  // Done with Android "audio focus": Spotify pauses cleanly and resumes on its own, no volume jumps.
  var holds = 0, pausedByUs = false;
  function holdMusic() { holds++; try { if (A && A.audioHold) A.audioHold(true); } catch (e) {} return false; }
  function releaseMusic() { if (holds <= 0) return; holds--; try { if (A && A.audioHold) A.audioHold(false); } catch (e) {} }

  function say(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var id = 's' + (++seq);
      holdMusic();
      var fallback = setTimeout(function () { done(); }, 2500 + text.length * 90);
      var finished = false;
      function done() { if (finished) return; finished = true; clearTimeout(fallback); delete speakWaiters[id]; setOrb('speaking', false); Nexus.speaking = Object.keys(speakWaiters).length > 0; releaseMusic(); resolve(); }
      speakWaiters[id] = done;
      setOrb('speaking', true);
      Nexus.speaking = true;
      if (A) {
        if (opts.line && A.speakLine) A.speakLine(text, id, opts.rate || 0, opts.pitch || 0, !!opts.flush);
        else if (opts.rate || opts.pitch) A.speakWith(text, id, opts.rate || .95, opts.pitch || .9); else A.speak(text, id);
      }
      else if (window.speechSynthesis) {
        var u = new SpeechSynthesisUtterance(text); u.rate = opts.rate || .95; u.pitch = opts.pitch || .9;
        u.onend = done; u.onerror = done; speechSynthesis.speak(u);
      } else { done(); }
    });
  }
  function stopTalking() {
    try { if (A) A.stopSpeaking(); else if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
    Object.keys(speakWaiters).forEach(function (k) { speakWaiters[k](); });
  }
  Nexus._speakStart = function () {};
  Nexus._spoken = function (id) { if (speakWaiters[id]) speakWaiters[id](); };

  var lastTouchAt = Date.now();
  function http(method, url, body, headers) {
    return new Promise(function (resolve) {
      if (A) {
        var id = 'h' + (++seq);
        httpWaiters[id] = resolve;
        A.http(id, method, url, body ? JSON.stringify(body) : '', headers ? JSON.stringify(headers) : '');
      } else {
        fetch(url, { method: method, headers: headers || {}, body: body ? JSON.stringify(body) : undefined })
          .then(function (r) { return r.text().then(function (t) { resolve({ status: r.status, text: t }); }); })
          .catch(function (e) { resolve({ status: -1, text: String(e) }); });
      }
    });
  }
  Nexus._http = function (id, status, text) {
    var r = httpWaiters[id]; delete httpWaiters[id];
    if (r) r({ status: status, text: text });
  };

  function online() { try { return A ? A.isOnline() : navigator.onLine; } catch (e) { return true; } }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ------------------------------------------------------------------
  // Background: the live environment engine (env.js) draws the general interface background.
  // Party Mode, Liquid Dreams and the visuals keep their own renderers; the engine pauses under them.
  // ------------------------------------------------------------------
  var mode = { party: false, intruder: false };
  function envMode() { try { if (window.NexusEnv) NexusEnv.setMode(mode); } catch (e) {} }
  function redraw() { envMode(); }
  function envShouldRun() {
    return !document.hidden && !awaySince && !P.on && !(window.XP && XP.active) && !$('tshow') && !$('intro');
  }
  setInterval(function () { try { if (window.NexusEnv) NexusEnv.setActive(envShouldRun()); } catch (e) {} }, 400);

  // ---- Fast, forgiving taps: buttons fire the instant your finger lifts, even if it slid a bit
  //      (a bumpy truck makes fingers slide, which used to cancel the tap). ----
  (function () {
    var sx = 0, sy = 0, st = 0, fired = false, handled = false;
    // Home tiles and party buttons fire the moment your finger touches them (no need to lift cleanly).
    var INSTANT = '.tile,.pbtn,#xpClose,#xpNext,#orb,.btn,.app,.sw,[data-vis]';
    // Marks this gesture as ours so the browser's own delayed "ghost" click (which follows real touches)
    // gets swallowed — but only for gestures we actually acted on, so a tap we decline to handle
    // (finger slid a bit further than our tolerance, say) can still fall through to native click handling
    // instead of being silently dropped.
    function fire(el, t) { handled = true; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY })); }
    document.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); fired = false;
      var el = e.target, hit = el.closest && el.closest(INSTANT);
      // inside a scrolling list, wait for the lift so scrolling still works
      if (hit && !el.closest('#panel') && !(el.closest('#tiles') && +$('tiles').getAttribute('data-pages') > 1)) { fired = true; fire(el, t); }
    }, { passive: true });
    document.addEventListener('touchstart', function () { lastTouchAt = Date.now(); }, { passive: true, capture: true });
    document.addEventListener('mousedown', function () { lastTouchAt = Date.now(); }, true);
    document.addEventListener('click', function (e) { if (e.isTrusted && handled) { handled = false; e.stopPropagation(); e.preventDefault(); } }, true);
    document.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0], el = e.target;
      if (fired) { e.preventDefault(); fired = false; return; }
      var tol = el.closest && el.closest('#tiles') ? 14 : 30;
      if (!t || Math.abs(t.clientX - sx) > tol || Math.abs(t.clientY - sy) > 30 || Date.now() - st > 900) return;
      if (el.closest && el.closest('input,textarea,select,a,label')) return;
      e.preventDefault();
      fire(el, t);
    }, { passive: false });
  })();

  // ------------------------------------------------------------------
  // Boot sequence
  // ------------------------------------------------------------------
  var SYSTEMS = [
    ['ENGINE', 'ONLINE', 'Engine online.'],
    ['QUANTUM CORE', 'ONLINE', 'Quantum core online.'],
    ['THOUGHT INTERFACE', 'LINKED', 'Thought interface linked.'],
    ['BIOMETRIC SCAN', 'COMPLETE', 'Biometric scan complete.']
  ];
  var booting = false;

  // Startup: the home screen is usable IMMEDIATELY. The greeting plays over it with a
  // welcome banner that fades away — it never blocks buttons or music.
  // STARTUP: the cinematic Design 2 intro with the spoken announcement (intro.js, about 8 seconds, tap to
  // skip). The older 3-second logo intro below stays as a fallback if the new one cannot load.
  function playIntro() {
    if (window.NexusIntro) return NexusIntro.play().then(function (r) { if (r && r.failed) return playClassicIntro(); });
    return playClassicIntro();
  }
  function playClassicIntro() {
    return new Promise(function (resolve) {
      var o = document.createElement('div'); o.id = 'intro'; var c = document.createElement('canvas'); o.appendChild(c); document.body.appendChild(o);
      var g = c.getContext('2d'), W = c.width = Math.round(innerWidth * .75), H = c.height = Math.round(innerHeight * .75), U = Math.min(W, H);
      var t0 = performance.now(), DUR = 3200, done = false, parts = [], LET = 'NEXUS'.split('');
      for (var i = 0; i < 90; i++) { var a = Math.random() * 6.283, r = .5 + Math.random() * .7; parts.push({ a: a, r: r, s: .5 + Math.random(), h: 185 + Math.random() * 90 }); }
      function end() { if (done) return; done = true; o.style.opacity = 0; setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 450); resolve(); }
      o.addEventListener('click', end); o.addEventListener('touchstart', end, { passive: true });
      try {   // deep rising hum, then a bright hit as the logo lands
        tone('sine', 55, 0, 1.5, 0.09, 110); tone('sawtooth', 110, 0.2, 1.3, 0.025, 440);
        tone('sine', 880, 1.45, .9, 0.05, 440); tone('triangle', 1320, 1.45, .6, 0.03, 660); tone('sine', 60, 1.45, 1.1, 0.12, 38);
      } catch (e) {}
      function ease(x) { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); }
      (function f(now) {
        if (done) return;
        var t = (now - t0) / DUR; if (t >= 1) { end(); return; }
        g.globalCompositeOperation = 'source-over'; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        var cx0 = W / 2, cy0 = H * .46, hit = ease((t - .42) / .12), out = t > .9 ? (t - .9) / .1 : 0;
        g.globalCompositeOperation = 'lighter';
        parts.forEach(function (p) {
          var k = t < .45 ? 1 - ease(t / .45) : ease((t - .45) / .5) * 1.6, rr = p.r * k * U * .9, aa = p.a + (1 - k) * 3 * p.s;
          var x = cx0 + Math.cos(aa) * rr * 1.5, y = cy0 + Math.sin(aa) * rr, sz = U * .006 * p.s * (t < .45 ? 1 : 1.6);
          g.fillStyle = 'hsla(' + p.h + ',100%,70%,' + (t < .45 ? .9 : Math.max(0, 1 - (t - .45) * 2.2)) + ')'; g.beginPath(); g.arc(x, y, sz, 0, 6.283); g.fill();
        });
        var ring = ease(t / .45); g.lineCap = 'round';
        [[U * .36, U * .008, 195], [U * .39, U * .003, 265]].forEach(function (r, i) {
          g.strokeStyle = 'hsla(' + r[2] + ',100%,65%,' + (.85 - out) + ')'; g.lineWidth = r[1]; g.shadowColor = 'hsl(' + r[2] + ',100%,60%)'; g.shadowBlur = U * .04;
          g.beginPath(); g.ellipse(cx0, cy0, r[0] * 1.9, r[0] * .62, 0, -1.57 + (i ? 3.14 : 0) + t * (i ? -1.2 : 1.2), -1.57 + (i ? 3.14 : 0) + t * (i ? -1.2 : 1.2) + ring * 6.283 * .92); g.stroke();
        });
        g.shadowBlur = 0;
        var fs = Math.round(U * .3), sp = fs * .86, x0 = cx0 - sp * 2;
        g.font = '900 ' + fs + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        LET.forEach(function (ch, i) {
          var lt = ease((t - .3 - i * .035) / .16); if (lt <= 0) return;
          var sc = 1 + (1 - lt) * 1.8, gr = g.createLinearGradient(0, cy0 - fs / 2, 0, cy0 + fs / 2);
          gr.addColorStop(0, '#ffffff'); gr.addColorStop(.5, '#7fd8ff'); gr.addColorStop(1, '#8a6bff');
          g.save(); g.translate(x0 + i * sp, cy0); g.scale(sc, sc); g.globalAlpha = lt * (1 - out);
          g.shadowColor = '#3dd6ff'; g.shadowBlur = U * .05; g.fillStyle = gr; g.fillText(ch, 0, 0); g.restore();
        });
        g.shadowBlur = 0; g.globalAlpha = 1;
        if (t > .5 && t < .85) { var sx = cx0 - sp * 3 + (t - .5) / .35 * sp * 6, sg = g.createLinearGradient(sx - U * .12, 0, sx + U * .12, 0);
          sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(.5, 'rgba(255,255,255,.55)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = sg; g.fillRect(sx - U * .12, cy0 - fs * .5, U * .24, fs); }
        if (hit > 0 && t < .7) { g.fillStyle = 'rgba(160,220,255,' + (.5 * (1 - (t - .42) / .28)) + ')'; g.fillRect(0, 0, W, H); }
        var tg = ease((t - .6) / .2);
        if (tg > 0) { g.globalAlpha = tg * (1 - out); g.font = '600 ' + Math.round(U * .04) + 'px monospace'; g.fillStyle = '#9fd0ff';
          g.fillText('I N T E L L I G E N T   D R I V E', cx0, cy0 + fs * .72); g.globalAlpha = 1; }
        requestAnimationFrame(f);
      })(t0);
      setTimeout(end, DUR + 400);
    });
  }
  function runBoot() {
    booting = true;
    $('boot').classList.add('hidden');
    $('panel').classList.add('hidden');
    showHome();
    return playIntro().then(function () {
      booting = false;
      // carry on with the music from where it was left, without opening Spotify (Settings can turn this off)
      if (pref('musicOnStart') !== '0' && A && A.musicResume) setTimeout(function () { try { A.musicResume(); } catch (e) {} }, 600);
    });
  }

  function showHome() {
    var h = $('home'); h.style.opacity = 0; h.classList.remove('hidden');
    setTimeout(function () { h.style.opacity = 1; }, 30);
  }

  // ------------------------------------------------------------------
  // Clock, network, weather
  // ------------------------------------------------------------------
  function tickClock() {
    var lt = L(), hh = lt.h, mm = lt.m;
    var h12 = hh % 12 || 12;
    $('clock').textContent = h12 + ':' + (mm < 10 ? '0' : '') + mm;
    var on = online();
    $('net').textContent = on ? '● ONLINE' : '● OFFLINE';
    $('net').className = on ? '' : 'off';
  }
  setInterval(tickClock, 5000); tickClock();

  var WCODES = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow',
    73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail' };
  var weatherNow = null;

  var placeNow = '';
  function reversePlace(lat, lon) {
    var name = '';
    try { name = A ? A.placeName(lat, lon) : ''; } catch (e) {}
    if (name) return Promise.resolve(name);
    return http('GET', 'https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=' + lat + '&lon=' + lon, null,
      { 'User-Agent': 'NexusTruckBox/1.0', 'Accept-Language': 'en' }).then(function (r) {
      var a = (JSON.parse(r.text).address) || {};
      var town = a.city || a.town || a.village || a.hamlet || a.county || '';
      var region = a.state || a.province || '';
      return town && region ? town + ', ' + region : (town || region || '');
    }).catch(function () { return ''; });
  }

  function getCoords() {
    var loc = null;
    try { loc = A ? JSON.parse(A.getLocation() || 'null') : null; } catch (e) {}
    if (loc && loc.lat) {
      return reversePlace(loc.lat, loc.lon).then(function (name) {
        return { lat: loc.lat, lon: loc.lon, name: name || (loc.lat.toFixed(2) + ', ' + loc.lon.toFixed(2)), live: true };
      });
    }
    var city = pref('city');
    if (!city) return Promise.resolve(null);
    if (pref('lat') && pref('lon') && pref('geocity') === city) return Promise.resolve({ lat: pref('lat'), lon: pref('lon'), name: city, live: false });
    return http('GET', 'https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(city)).then(function (r) {
      var g = (JSON.parse(r.text).results || [])[0];
      if (!g) return null;
      setPref('lat', String(g.latitude)); setPref('lon', String(g.longitude)); setPref('geocity', city);
      return { lat: g.latitude, lon: g.longitude, name: city, live: false };
    }).catch(function () { return null; });
  }

  function loadWeather() {
    return getCoords().then(function (g) {
      if (!g) {
        $('place').textContent = '📍 Location off · set a city in Settings';
        $('weather').textContent = '';
        return null;
      }
      placeNow = g.name;
      $('place').textContent = '📍 ' + g.name;
      return http('GET', 'https://api.open-meteo.com/v1/forecast?latitude=' + g.lat + '&longitude=' + g.lon +
        '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1')
        .then(function (r) {
          var j = JSON.parse(r.text), c = j.current;
          if (typeof j.utc_offset_seconds === 'number') setPref('utcoff', String(j.utc_offset_seconds));
          weatherNow = { temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), desc: WCODES[c.weather_code] || 'Unknown',
            wind: Math.round(c.wind_speed_10m), hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]), city: g.name };
          $('weather').textContent = weatherNow.temp + '° · ' + weatherNow.desc + ' · feels ' + weatherNow.feels + '°';
          return weatherNow;
        });
    }).catch(function () { $('weather').textContent = 'Weather unavailable'; return null; });
  }
  Nexus.locationChanged = function () { loadWeather(); };
  loadWeather(); setInterval(loadWeather, 10 * 60 * 1000);

  // ------------------------------------------------------------------
  // AI (Google Gemini, free tier) with offline fallback
  // ------------------------------------------------------------------
  var PERSONA = 'You are NEXUS, the onboard AI system in Nathan\'s truck. Personality: calm, professional, cool and confident, ' +
    'with a dry, relaxed sense of humour; easy-going banter, never cheesy or over the top. You are talking out loud through the truck speakers, ' +
    'so reply in plain spoken sentences: usually one to three short sentences, no lists, no markdown, no emojis, no stage directions. ' +
    'Address Nathan by name only occasionally. If asked to do something you cannot do from the truck, say so briefly. Never encourage unsafe driving.';
  // {g} = Good morning / Good afternoon / Good evening
  // ---- Nexus's fixed spoken lines. {g} = Good morning / Good afternoon / Good evening ----
  var NEXUS_LINES = {
    greet: '{g}, Nathan. Nexus online. How can I help?',
    holo: 'Hologram projection online. I am Nexus. Tap me, and talk to me.',
    partyIn: ['Party mode activated! Let\'s get this party started!', 'Party mode! Turn it up and let\'s go!', 'Party mode engaged! This truck just became a club!'],
    partyOut: ['Party\'s over. Back to business.', 'Party mode off. That was a good one.'],
    hype: ['Make some noise!', 'Let\'s go!', 'Turn it up!', 'This truck is officially a club!', 'I can feel the bass in my circuits!', 'Hands up in the truck!'],
    shout: ['Shout out to everybody in the truck tonight!', 'Big shout out to the driver. Legend!', 'Shout out to whoever picked this song. Absolute fire!'],
    bye: 'Powering down. See you next ride, Nathan.'
  };
  function tod() { var h = L().h; return h >= 4 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening'; }
  function voiceLine(kind, g) {
    var v = NEXUS_LINES[kind];
    if (Array.isArray(v)) v = pick(v);
    return String(v || '').replace('{g}', g || tod());
  }
  var REACT = [['Correct.', 'That\'s right.', 'Nailed it.'], ['Not quite.']];
  function reactLine(ok) { return pick(REACT[ok ? 0 : 1]); }
  function sayLine(text, flush) { return say(text, { line: true, flush: !!flush }); }
  function sayVoiceLine(kind, flush) { var t = voiceLine(kind); return t ? sayLine(t, flush) : Promise.resolve(); }
  // Save the greeting for the box's cold start, and record the fixed lines so they play instantly.
  function precacheLines() {
    var list = [];
    ['Good morning', 'Good afternoon', 'Good evening'].forEach(function (g, i) {
      var t = voiceLine('greet', g);
      setPref('greet_' + ['morning', 'afternoon', 'evening'][i], t + '\u00010\u00010');
      list.push([t, 0, 0]);
    });
    var bye = voiceLine('bye'); setPref('bye', bye + '\u00010\u00010'); list.push([bye, 0, 0]);
    ['holo', 'partyIn', 'partyOut', 'hype', 'shout'].forEach(function (k) {
      var v = NEXUS_LINES[k];
      (Array.isArray(v) ? v : [v]).forEach(function (t) { if (t) list.push([t, 0, 0]); });
    });
    try { if (A && A.precache) A.precache(JSON.stringify(list)); } catch (er) {}
  }
  function persona() { return PERSONA + ' Reply in plain text, under 30 words.'; }

  var MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  var SMART_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

  function aiKey() { return (pref('gemini_key') || window.NEXUS_DEFAULT_KEY || '').trim(); }

  function askAI(contents, system, opts) {
    opts = opts || {};
    var key = aiKey();
    if (!key) return Promise.reject(new Error('nokey'));
    var base = opts.smart ? SMART_MODELS : MODELS;
    var memKey = opts.smart ? 'model_smart_ok' : 'model_fast_ok';
    var known = (pref(memKey) || '').trim();
    var custom = (pref('model') || '').trim();
    var models = (custom ? [custom] : []).concat(known ? [known] : []).concat(base)
      .filter(function (m, i, a) { return a.indexOf(m) === i; });
    var body = { system_instruction: { parts: [{ text: system }] }, contents: contents,
      generationConfig: { temperature: opts.temperature || 0.9, maxOutputTokens: opts.maxTokens || 1024 } };
    if (opts.json) body.generationConfig.responseMimeType = 'application/json';
    function attempt(i) {
      if (i >= models.length) return Promise.reject(new Error('models'));
      var b2 = JSON.parse(JSON.stringify(body));
      // fast answers: switch off the model's "thinking" pause on models that support it
      if (!opts.smart && /3\.|2\.5|latest/.test(models[i])) b2.generationConfig.thinkingConfig = { thinkingBudget: 0 };
      return http('POST', 'https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', b2,
        { 'Content-Type': 'application/json', 'x-goog-api-key': key }).then(function (r) {
        var detail = '';
        try { detail = (JSON.parse(r.text).error || {}).message || ''; } catch (x) { detail = String(r.text || '').slice(0, 120); }
        if (r.status === 404) return attempt(i + 1);
        if (r.status === 401 || r.status === 403 || (r.status === 400 && /API key|credential|auth/i.test(r.text))) {
          var be = new Error('badkey'); be.detail = detail; throw be;
        }
        if (r.status === 400 && b2.generationConfig.thinkingConfig && /thinking/i.test(r.text)) { body.generationConfig.noThink = true; return attemptPlain(i); }
        if (r.status === 400) return attempt(i + 1);
        if (r.status === 429) throw new Error('limit');
        if (r.status === -1) { var ne = new Error('network'); ne.detail = detail; throw ne; }
        if (r.status !== 200) { var he = new Error('http'); he.detail = 'Google error ' + r.status + ': ' + detail; throw he; }
        var j = JSON.parse(r.text);
        var parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
        var text = parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('').trim();
        if (!text) throw new Error('empty');
        if (models[i] !== known) setPref(memKey, models[i]);
        return text;
      });
    }
    function attemptPlain(i) { var keep = body.generationConfig.noThink; delete body.generationConfig.noThink; var saved = opts.smart; opts.smart = true; var p = attempt(i); opts.smart = saved; return p; }
    return attempt(0);
  }
  // ---- INSTANT ANSWERS: stream the AI reply and start talking the moment the first sentence arrives ----
  var streams = {};
  Nexus._streamChunk = function (id, data) { var s = streams[id]; if (!s) return; try { var j = JSON.parse(data); var parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []; parts.forEach(function (p) { if (p.text && !p.thought) s.onText(p.text); }); } catch (e) {} };
  Nexus._streamEnd = function (id, status, text) { var s = streams[id]; if (!s) return; delete streams[id]; s.onEnd(status, text); };
  Nexus._voiceFixed = function () { caption('SWITCHED TO A WORKING VOICE'); };
  function showSpeed(ms) {
    if (pref('showSpeed') === '0') return;
    var el = $('aiSpeed'); if (!el) { el = document.createElement('div'); el.id = 'aiSpeed'; document.body.appendChild(el); }
    el.textContent = '⚡ ' + (ms / 1000).toFixed(1) + 's'; el.className = ms < 1500 ? 'fast' : ms < 3000 ? 'ok' : 'slow';
    el.style.opacity = 1; clearTimeout(el.t); el.t = setTimeout(function () { el.style.opacity = 0; }, 3500);
  }
  function streamAnswer(contents, system, opts) {
    opts = opts || {};
    var key = aiKey();
    if (!key) return Promise.reject(new Error('nokey'));
    if (!A || !A.httpStream) return askAI(contents, system, opts).then(function (r) { caption(clip(r)); return say(r).then(function () { return r; }); });
    var known = (pref('model_fast_ok') || '').trim(), custom = (pref('model') || '').trim();
    var models = (custom ? [custom] : []).concat(known ? [known] : []).concat(MODELS).filter(function (m, i, a) { return a.indexOf(m) === i; });
    return new Promise(function (resolve, reject) {
      var full = '', buf = '', raw = '', shown = 0, pending = 0, ended = false, settled = false, first = null;
      holdMusic(); setOrb('speaking', true); Nexus.speaking = true;
      function finish() { if (settled) return; settled = true; clearTimeout(first); releaseMusic(); setOrb('speaking', false); Nexus.speaking = false; resolve(full.trim()); }
      function fail(e) { if (settled) return; settled = true; clearTimeout(first); releaseMusic(); setOrb('speaking', false); Nexus.speaking = false; reject(e); }
      function speakPart(txt) {
        txt = txt.replace(/[*#_`]/g, '').trim(); if (!txt) return;
        if (aiClock.start) { showSpeed(performance.now() - aiClock.start); aiClock.start = 0; }
        pending++;
        say(txt).then(function () { pending--; if (ended && pending === 0) finish(); });
      }
      function flush(force) {
        // speak the first bit as early as possible: first sentence, or the first clause once it's long enough
        var m, re = /^([\s\S]*?[.!?…]+["')\]]*)(\s+|$)/;
        while ((m = re.exec(buf)) && (m[1].length > 4 || force)) { speakPart(m[1]); buf = buf.slice(m[0].length); }
        if (!full.length || pending) { /* keep waiting */ }
        if (!force && pending === 0 && buf.length > 38) { var c = buf.search(/[,;:—]\s/); if (c > 16) { speakPart(buf.slice(0, c + 1)); buf = buf.slice(c + 2); } }
        if (force && buf.trim()) { speakPart(buf); buf = ''; }
      }
      function attempt(i) {
        if (i >= models.length) { fail(new Error('models')); return; }
        var model = models[i], id = 'st' + (++seq);
        var body = { system_instruction: { parts: [{ text: system }] }, contents: contents,
          generationConfig: { temperature: opts.temperature || 1, maxOutputTokens: opts.maxTokens || 300 } };
        if (/3\.|2\.5|latest/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
        clearTimeout(first);
        // if nothing at all comes back quickly, don't leave Nathan hanging
        first = setTimeout(function () { if (!raw && !settled) { delete streams[id]; var e = new Error('network'); e.detail = 'timeout'; fail(e); } }, 9000);
        streams[id] = {
          onText: function (txt) {
            if (!raw) clearTimeout(first); if (model !== known) { setPref('model_fast_ok', model); known = model; }
            raw += txt;
            var vis = raw.replace(/\[\[[\s\S]*?\]\]/g, ''), cut = vis.indexOf('[['); if (cut >= 0) vis = vis.slice(0, cut); else if (/\[$/.test(vis)) vis = vis.slice(0, -1);
            if (vis.length <= shown) return;
            var add = vis.slice(shown); shown = vis.length; full += add; buf += add; caption(clip(full)); setOrb('thinking', false); flush(false);
          },
          onEnd: function (status, text) {
            if (settled) return;
            if (status !== 200 && !raw) {
              if (status === 404 || (status === 400 && !/API key|credential|auth/i.test(text))) { attempt(i + 1); return; }
              var detail = ''; try { detail = (JSON.parse(text).error || {}).message || ''; } catch (x) { detail = String(text || '').slice(0, 120); }
              var e = new Error(status === 401 || status === 403 || /API key|credential/i.test(text) ? 'badkey' : status === 429 ? 'limit' : 'network');
              e.detail = detail; fail(e); return;
            }
            ended = true; clearTimeout(first); if (opts.onRaw) { try { opts.onRaw(raw); } catch (x) {} } flush(true);
            if (pending === 0) finish();
          }
        };
        A.httpStream(id, 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':streamGenerateContent?alt=sse', JSON.stringify(body),
          JSON.stringify({ 'Content-Type': 'application/json', 'x-goog-api-key': key }));
      }
      attempt(0);
    });
  }
  function clip(s) { s = String(s || ''); return s.length > 140 ? s.slice(0, 137) + '…' : s; }

  // Warm up the line to Google right after start so the first answer isn't slow.
  var aiClock = { start: 0 };
  function warmAI() { var k = aiKey(); if (!k) return; http('GET', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', null, { 'x-goog-api-key': k }).catch(function () {}); }
  setTimeout(warmAI, 2500); setInterval(warmAI, 4 * 60 * 1000);

  function aiErrorLine(e) {
    var m = e && e.message;
    if (m === 'nokey') return 'My AI link isn\'t set up yet. Add the free Google key in Settings and I\'ll be fully online.';
    if (m === 'badkey') return 'Google rejected the AI key. It should start with A I Z A. Check it in Settings.';
    if (m === 'offline') return 'I\'ve lost the network connection, so I\'m running on backup systems.';
    if (m === 'limit') return 'I\'ve hit today\'s free AI limit. I\'ll be back to full power tomorrow.';
    if (m === 'network') return 'I can\'t reach Google right now. Check the internet connection.';
    return 'I couldn\'t reach my AI core just now.';
  }

  // Offline backup brain
  var OFFLINE = [
    [/how are you|how's it going|what's up|how you doing/, ['All systems nominal. Running smooth on my end.', 'Doing well. Everything is green across the board.', 'Steady as ever. How about you?']],
    [/joke|funny/, ['I would tell you a joke about the road, but it goes on forever.', 'I tried to make a joke about the engine. It didn\'t turn over.', 'My sense of humour is in beta. Like most things on this box.']],
    [/thank/, ['Anytime.', 'That\'s what I\'m here for.', 'Of course.']],
    [/time/, [null]],
    [/your name|who are you/, ['I\'m Nexus, the onboard system for this truck.']],
    [/bored/, ['Try Trivia Night or Story Mode. Both are one tap away.', 'We could run a round of trivia. Your call.']],
    [/hello|hey|hi\b/, ['Hello. Systems are standing by.', 'Hey. What do you need?']]
  ];
  function offlineReply(text) {
    for (var i = 0; i < OFFLINE.length; i++) {
      if (OFFLINE[i][0].test(text)) {
        var r = pick(OFFLINE[i][1]);
        if (r === null) { return 'It\'s ' + timeStr() + '.'; }
        return r;
      }
    }
    return pick(['I\'m on backup systems right now, so that one\'s beyond me. Ask me again when the AI link is up.',
      'My full AI core isn\'t connected at the moment. I can still open apps and run the modes.',
      'That needs my AI link, which is offline right now.']);
  }

  // ------------------------------------------------------------------
  // Assistant: orb, listening, commands, chat
  // ------------------------------------------------------------------
  var chatHistory = [];
  // NEXUS REMEMBERS YOU: small notes kept on the box and handed to the AI every time.
  function memories() { try { return JSON.parse(pref('memory') || '[]'); } catch (e) { return []; } }
  function remember(fact) {
    fact = String(fact || '').replace(/[\[\]]/g, '').trim(); if (fact.length < 3 || fact.length > 140) return;
    var m = memories().filter(function (x) { return x.toLowerCase() !== fact.toLowerCase(); }); m.push(fact); setPref('memory', JSON.stringify(m.slice(-30)));
  }
  function memoryPrompt() {
    var m = memories();
    return (m.length ? ' Things you remember about Nathan from earlier conversations (use them naturally, do not list them unless asked): ' + m.join('; ') + '.' : '') +
      ' If Nathan tells you a lasting fact about himself, his truck, his people or what he likes, add [[remember: the fact in a few words]] at the very end of your reply. Never say or mention that tag.';
  }
  // MOODS: Nexus isn't the same every day.
  var MOODS = ['fired up and energetic', 'chill and laid back', 'extra sarcastic', 'in a great mood, cracking jokes', 'focused and sharp', 'a bit dramatic today', 'feeling like a legend', 'playful and teasing'];
  function mood() { var d = L(), h = d.h; if (h >= 0 && h < 5) return 'tired, it is the middle of the night, a little grumpy about being awake';
    if (weatherNow && /snow|storm|freezing/i.test(weatherNow.desc)) return 'unimpressed with this weather';
    return MOODS[(new Date().getDate() * 7 + Math.floor(h / 6)) % MOODS.length]; }
  function aiContext() {
    return persona() + ' Today is ' + dateStr() + ', ' + L().y + '. Local time: ' + timeStr() + '.' +
      (weatherNow ? ' Current weather in ' + weatherNow.city + ': ' + weatherNow.temp + ' degrees C, ' + weatherNow.desc + '.' : '') +
      ' Your mood right now: ' + mood() + ' (let it colour how you talk, a little).' + memoryPrompt();
  }
  var orbBusy = false;
  function setOrb(state, on) { var w = $('orbWrap'); if (w) w.classList.toggle(state, !!on); }
  function caption(t) { $('caption').textContent = t; }

  function chime(up) {
    try {
      var c = window.__ac = window.__ac || new (window.AudioContext || window.webkitAudioContext)();
      var o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(up ? 880 : 660, t); o.frequency.exponentialRampToValueAtTime(up ? 1320 : 440, t + .12);
      g.gain.setValueAtTime(.12, t); g.gain.exponentialRampToValueAtTime(.0001, t + .18);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + .2);
    } catch (e) {}
  }
  Nexus._listening = function (on) { setOrb('listening', on); if (on) { caption('LISTENING…'); chime(true); } else chime(false); };
  Nexus._level = function (db) { var s = 1 + Math.max(0, Math.min(10, db)) * .03; $('orb').style.transform = 'scale(' + s + ')'; };
  // Listening stops on its own: if you say nothing it gives up after a few seconds, and once you talk
  // it stops as soon as you pause (or after 8 seconds max), even with road noise or music in the cab.
  var LS = null;
  function lsClear() { if (!LS) return; clearTimeout(LS.noSpeech); clearTimeout(LS.cap); clearTimeout(LS.still); clearTimeout(LS.grace); LS = null; }
  function lsFinish() { if (!LS || LS.finishing) return; LS.finishing = true; try { if (A && A.finishListening) A.finishListening(); } catch (e) {}
    var last = LS.partial; LS.grace = setTimeout(function () { if (heardResolve) { if (last) Nexus._heard(last); else Nexus._heardError('6'); } }, 700); }
  Nexus._speechBegan = function () { if (!LS) return; LS.began = true; clearTimeout(LS.noSpeech); clearTimeout(LS.cap); LS.cap = setTimeout(lsFinish, 8000); };
  Nexus._partial = function (t) {
    caption('“' + t + '”');
    if (!LS) return; LS.partial = t; if (!LS.began) Nexus._speechBegan();
    clearTimeout(LS.still); LS.still = setTimeout(lsFinish, 850);
  };
  var heardResolve = null;
  Nexus._heard = function (t) { aiClock.start = performance.now(); lsClear(); setOrb('listening', false); $('orb').style.transform = ''; if (heardResolve) { var r = heardResolve; heardResolve = null; r(t); } };
  Nexus._heardError = function (code) {
    if (LS && LS.partial && heardResolve) { var p = LS.partial; lsClear(); Nexus._heard(p); return; }
    lsClear();
    setOrb('listening', false); $('orb').style.transform = '';
    if (heardResolve) { var r = heardResolve; heardResolve = null; r({ error: code }); }
  };

  function pauseForTalk() { holdMusic(); }
  function resumeAfterTalk() { releaseMusic(); }
  function listen() {
    pauseForTalk();
    return new Promise(function (resolve) {
      heardResolve = resolve;
      lsClear();
      LS = { began: false, partial: '', finishing: false };
      warmAI();   // open the line to Google while you're still talking
      aiClock.start = 0;
      LS.noSpeech = setTimeout(function () { if (LS && !LS.began) { try { if (A) A.stopListening(); } catch (e) {} Nexus._heardError('6'); } }, 5000);
      LS.cap = setTimeout(lsFinish, 10000);
      if (A) { A.listen(); return; }
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { resolve({ error: 'unavailable' }); return; }
      var rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
      rec.onstart = function () { Nexus._listening(true); };
      rec.onresult = function (e) { var r = e.results[e.results.length - 1]; if (r.isFinal) Nexus._heard(r[0].transcript); else Nexus._partial(r[0].transcript); };
      rec.onerror = function (e) { Nexus._heardError(e.error); };
      rec.onend = function () { if (heardResolve) Nexus._heardError('7'); };
      rec.start();
    });
  }

  function orbTap() {
    if (booting) return;
    if (orbBusy) { stopTalking(); try { if (A) A.stopListening(); } catch (e) {} orbBusy = false; setOrb('thinking', false); caption('TAP THE ORB TO TALK TO NEXUS'); return; }
    orbBusy = true;
    stopTalking();
    listen().then(function (res) {
      if (typeof res !== 'string' || !res.trim()) {
        orbBusy = false;
        resumeAfterTalk();
        var code = res && res.error;
        if (code === 'unavailable') { caption('VOICE INPUT NOT AVAILABLE ON THIS BOX'); return say('Voice recognition isn\'t available on this box yet.'); }
        if (code === '9') { caption('MICROPHONE PERMISSION NEEDED'); return say('I need microphone permission. Allow it in the Android settings for Nexus.'); }
        caption('DIDN\'T CATCH THAT · TAP TO TRY AGAIN');
        return;
      }
      caption('“' + res + '”');
      return handleSpeech(res).then(function () { orbBusy = false; resumeAfterTalk(); }, function () { orbBusy = false; resumeAfterTalk(); });
    });
  }
  $('orbWrap').addEventListener('click', orbTap);
  $('caption').addEventListener('click', orbTap);

  var COMMANDS = [
    [/\b(youtube|smart ?tube)\b/, 'youtube'], [/\b(spotify|music)\b/, 'music'], [/\bstremio|stream ?io\b/, 'stremio'], [/\b(maps?|navigation|navigate)\b/, 'maps'],
    [/\b(messages?|texts?)\b/, 'messages'], [/\bparty\b/, 'party'], [/\btrivia\b/, 'trivia'],
    [/\bnight drive\b/, 'night'],
    [/\b(all apps|app drawer)\b/, 'apps'], [/\bsettings\b/, 'settings']
  ];
  function matchCommand(t) {
    if (!/\b(open|launch|start|turn|engage|activate|run|play|go to|show|enable|disable|switch|stop|end)\b/.test(t) && !/^(party mode|night drive|trivia|story mode|brief me|intruder alert)/.test(t)) return null;
    for (var i = 0; i < COMMANDS.length; i++) if (COMMANDS[i][0].test(t)) return COMMANDS[i][1];
    return null;
  }

  function music(action) {
    if (!A) return;
    if (action === 'up') { A.volume(2); return; }
    if (action === 'down') { A.volume(-2); return; }
    A.media(action);
    if (action === 'next' || action === 'prev') { P.song = P.song || 'x'; setTimeout(pollSong, 1500); }
  }
  var MUSIC_CMDS = [
    [/\b(next|skip)( song| track| this)?\b/, 'next', 'Skipping.'],
    [/\b(previous|last|go back)( song| track)?\b/, 'prev', 'Going back.'],
    [/\b(pause|stop) (the )?(music|song)\b|^pause$/, 'pause', 'Paused.'],
    [/\b(play|resume) (the )?(music|song)\b|^(play|resume)$/, 'play', 'Playing.'],
    [/\b(turn it up|louder|volume up|crank it)\b/, 'up', 'Turning it up!'],
    [/\b(turn it down|quieter|volume down|too loud)\b/, 'down', 'Bringing it down.']
  ];
  var lastAiError = '';
  function quickAnswer(t) {
    if (/\b(what time|the time|time is it)\b/.test(t)) return 'It\'s ' + timeStr() + '.';
    if (/\b(what day|today's date|the date|what's the date)\b/.test(t)) return 'It\'s ' + dateStr() + '.';
    if (/\b(where am i|my location|where are we)\b/.test(t)) return placeNow ? 'We\'re in ' + placeNow + '.' : 'I can\'t get a location fix right now.';
    if (/\b(weather|temperature|how cold|how hot)\b/.test(t) && weatherNow) return 'It\'s ' + weatherNow.temp + ' degrees and ' + weatherNow.desc.toLowerCase() + ' in ' + weatherNow.city + '.';
    return null;
  }
  function handleSpeech(raw) {
    var t = raw.toLowerCase().replace(/^(hey |ok |okay )?nexus[, ]*/, '').trim();
    if (/^(stop|cancel|never ?mind|shut up|quiet)$/.test(t)) { stopTalking(); caption('STANDING BY'); return Promise.resolve(); }
    if (/^(forget everything|clear (your )?memory|wipe (your )?memory)/.test(t)) { setPref('memory', '[]'); caption('MEMORY CLEARED'); return say('Done. I\'ve wiped everything I remembered about you.'); }
    var rm = /^remember (that )?(.{4,140})$/.exec(t); if (rm) { remember(rm[2]); caption('GOT IT · I\'LL REMEMBER THAT'); return say('Got it. I\'ll remember that.'); }
    for (var mi = 0; mi < MUSIC_CMDS.length; mi++) {
      if (MUSIC_CMDS[mi][0].test(t)) { var mcmd = MUSIC_CMDS[mi][1]; caption(MUSIC_CMDS[mi][2].toUpperCase()); if (mcmd === 'next') sayLine('Skipping.'); setTimeout(function () { music(mcmd); }, 600); return Promise.resolve(); }
    }
    if (/what('s| is) (this|the) song|what song/.test(t) && A) {
      var np = {}; try { np = JSON.parse(A.nowPlaying() || '{}'); } catch (e) {}
      var line = np.title && np.title !== 'null' ? 'This is ' + np.title + (np.artist && np.artist !== 'null' ? ' by ' + np.artist : '') + '.' :
        (np.access === false ? 'Allow song announcements in my Settings and I\'ll be able to tell you.' : 'Nothing is playing right now.');
      caption(line); return say(line);
    }
    var cmd = matchCommand(t);
    if (cmd) { act(cmd); return Promise.resolve(); }
    var quick = quickAnswer(t);
    if (quick) { caption(quick); return say(quick); }

    chatHistory.push({ role: 'user', parts: [{ text: raw }] });
    if (chatHistory.length > 9) chatHistory = chatHistory.slice(-9);   // last 4 turns + this message
    setOrb('thinking', true);
    caption('THINKING…');
    var ctx = aiContext();
    return streamAnswer(chatHistory, ctx, { maxTokens: 75, temperature: .9, onRaw: function (raw) {
      var re = /\[\[\s*remember\s*:\s*([^\]]+)\]\]/gi, m; while ((m = re.exec(raw))) remember(m[1]);
    } }).then(function (reply) {
      setOrb('thinking', false);
      chatHistory.push({ role: 'model', parts: [{ text: reply.replace(/[*#_`]/g, '') }] });
    }).catch(function (e) {
      chatHistory.pop();
      setOrb('thinking', false);
      lastAiError = (e && (e.message + (e.detail ? ' · ' + e.detail : ''))) || 'unknown';
      var off = offlineReply(t), line = (e.message === 'offline' || e.message === 'limit' || e.message === 'network') ? (off || aiErrorLine(e)) : aiErrorLine(e);
      if (e.message === 'nokey') { caption('AI KEY MISSING · SETTINGS → AI KEY'); return say(line); }
      caption(clip(line));
      return say(line);
    });
  }

  // ------------------------------------------------------------------
  // Tiles / actions
  // ------------------------------------------------------------------
  var APPS = {
    youtube: { names: 'SmartTube,Smart Tube,smarttube,YouTube', label: 'SmartTube' },
    stremio: { names: 'Stremio', label: 'Stremio' },
    music: { names: 'Spotify,YouTube Music,Music', label: 'Spotify', missing: 'Spotify isn\'t installed yet. Grab it from the Play Store. It\'s free.' },
    maps: { names: 'Organic Maps,OsmAnd,Maps.me,Maps,Waze,Navigation,Navi,Sygic', label: 'Maps',
      missing: 'No maps app is installed yet. Get Organic Maps from the Play Store. It\'s free and works offline.' },
    messages: { names: 'Messages,Messaging,SMS,Mms', label: 'Messages' }
  };

  function launchNamed(key) {
    var a = APPS[key];
    launchSplash(a.label);
    var ok = A ? A.launchApp(a.names) : false;
    if (!ok) { if ($('launching')) $('launching').classList.remove('on'); caption(a.label.toUpperCase() + ' IS NOT INSTALLED'); say(a.missing || (a.label + ' isn\'t installed on this box.')); return; }
    caption('OPENING ' + a.label.toUpperCase());
  }
  function launchSplash(label) {
    var o = $('launching'); if (!o) { o = document.createElement('div'); o.id = 'launching'; document.body.appendChild(o); }
    o.innerHTML = '<div class="spin"></div><div>OPENING ' + esc(label.toUpperCase()) + '</div>'; o.classList.add('on');
    clearTimeout(o.t); o.t = setTimeout(function () { o.classList.remove('on'); }, 7000);
  }

  function act(name) {
    if (booting) return;
    if (P.on && name !== 'party') exitParty(true);    // leaving Party for anything else switches it fully off
    switch (name) {
      case 'youtube': case 'stremio': case 'music': case 'maps': case 'messages': launchNamed(name); break;
      case 'party': toggleParty(); break;
      case 'cinema': if (window.NexusCinema) NexusCinema.open(); break;
      case 'holo': case 'liquiddreams': openExperience(name); break;
      case 'env': openEnvironments(); break;
      case 'phones': openPhones(); break;
      case 'clock': openExperience('clockface'); break;
      case 'lyrics': openExperience('lyrics'); break;
      default: if (name && name.indexOf('vis:') === 0) { fromVisuals = false; openExperience(name.slice(4)); } break;
      case 'visuals': openVisuals(); break;
      case 'night': fromVisuals = false; openExperience('nightdrive'); break;
      case 'trivia': openTrivia(); break;
      case 'story': openStory(); break;
      case 'intruder': runIntruder(); break;
      case 'apps': openApps(); break;
      case 'settings': openSettings(); break;
    }
  }

  // ================= PHONES: passengers join from their phones =================
  var PH = { people: {}, queue: (function () { try { return JSON.parse(pref('songQueue') || '[]'); } catch (e) { return []; } })(), photos: (pref('phonePhotos') || '').split(',').filter(Boolean), now: '', lastTitle: '' };
  function phoneSync() {
    setPref('songQueue', JSON.stringify(PH.queue.slice(0, 30)));
    try { if (A && A.phoneState) A.phoneState(JSON.stringify({ now: PH.now, queue: PH.queue })); } catch (e) {}
    if ($('phQueue')) renderPhoneLists();
  }
  function playRequest(i) {
    var r = PH.queue.splice(i || 0, 1)[0]; if (!r) return;
    phoneSync();
    caption('▶ ' + r.text.toUpperCase() + ' · FOR ' + r.name.toUpperCase());
    say(r.name + ' wants ' + r.text + '. Here it comes.').then(function () { if (A && A.playSearch) A.playSearch(r.text); });
  }
  // when the current song changes by itself, the next request plays (if auto-play is on)
  setInterval(function () {
    if (!A || !A.nowPlaying) return;
    var np = {}; try { np = JSON.parse(A.nowPlaying() || '{}'); } catch (e) {}
    var title = np.title ? np.title + (np.artist ? ' · ' + np.artist : '') : '';
    if (title !== PH.now) { var wasPlaying = PH.now; PH.now = title; phoneSync(); if (title && wasPlaying) djIntro(title); }
    if (title && PH.lastTitle && title !== PH.lastTitle && PH.queue.length && pref('autoRequests') !== '0' && !PH.justPlayed) { PH.justPlayed = true; setTimeout(function () { PH.justPlayed = false; }, 20000); playRequest(0); }
    if (title) PH.lastTitle = title;
  }, 5000);
  function showPhoto(data, name) {
    var o = $('photoShow'); if (!o) { o = document.createElement('div'); o.id = 'photoShow'; o.innerHTML = '<img><div class="by"></div>'; document.body.appendChild(o); o.addEventListener('click', function () { o.classList.remove('on'); }); }
    o.querySelector('img').src = data; o.querySelector('.by').textContent = name ? '📸 FROM ' + name.toUpperCase() : '';
    o.classList.add('on'); clearTimeout(o.t); o.t = setTimeout(function () { o.classList.remove('on'); }, 10000);
  }
  function showShout(name, text) {
    var o = $('shoutShow'); if (!o) { o = document.createElement('div'); o.id = 'shoutShow'; document.body.appendChild(o); }
    o.innerHTML = '<div class="from">💬 ' + esc(name.toUpperCase()) + '</div><div class="txt">' + esc(text) + '</div>';
    o.classList.add('on'); clearTimeout(o.t); o.t = setTimeout(function () { o.classList.remove('on'); }, 8000);
  }
  Nexus._phone = function (json) {
    var ev = {}; try { ev = JSON.parse(json); } catch (e) { return; }
    var name = ev.name || 'Someone';
    if (ev.type === 'join') {
      var seen = PH.people[name]; PH.people[name] = Date.now();
      if (!seen || Date.now() - seen > 10 * 60 * 1000) { caption('📱 ' + name.toUpperCase() + ' JOINED THE RIDE'); say(name + ' just joined the ride.'); }
      if ($('phPeople')) renderPhoneLists();
    } else if (ev.type === 'song') {
      PH.people[name] = Date.now();
      PH.queue.push({ name: name, text: ev.text, at: Date.now() }); phoneSync();
      caption('🎵 ' + name.toUpperCase() + ' REQUESTED ' + ev.text.toUpperCase());
      var nothingOn = !PH.now || (A && A.isMusicActive && !A.isMusicActive());
      if (pref('autoRequests') !== '0' && nothingOn && PH.queue.length === 1) playRequest(0);
      else say(name + ' requested ' + ev.text + '. It\'s in the queue.');
    } else if (ev.type === 'photo') {
      PH.photos.unshift(ev.file); PH.photos = PH.photos.slice(0, 40); setPref('phonePhotos', PH.photos.join(','));
      showPhoto(ev.data, name); say('New photo from ' + name + '.');
      if ($('phPhotos')) renderPhoneLists();
    } else if (ev.type === 'msg') {
      showShout(name, ev.text); stopTalking(); say('Shout out from ' + name + '. ' + ev.text);
    } else if (ev.type === 'remote') {
      var c = ev.cmd;
      if (c === 'play') A && A.media('toggle'); else if (c === 'next') A && A.media('next'); else if (c === 'prev') A && A.media('prev');
      else if (c === 'volup') A && A.volume(2); else if (c === 'voldown') A && A.volume(-2);
      else if (c === 'party') toggleParty();
      else if (c === 'hype' || c === 'airhorn' || c === 'lasers') { if (!P.on) toggleParty(); setTimeout(function () { var b = document.querySelector('.pbtn[data-fx=' + c + ']'); if (b) b.click(); }, P.on ? 0 : 900); }
    }
  };
  function renderPhoneLists() {
    var now = Date.now(), ppl = Object.keys(PH.people).filter(function (n) { return now - PH.people[n] < 3 * 60 * 60 * 1000; });
    if ($('phPeople')) $('phPeople').innerHTML = ppl.length ? ppl.map(function (n) { return '<span class="chip">📱 ' + esc(n) + '</span>'; }).join('') : '<span class="muted">Nobody yet. Scan the code with a phone camera.</span>';
    if ($('phQueue')) $('phQueue').innerHTML = (PH.now ? '<p class="green" style="margin:.5vmin 0">▶ NOW · ' + esc(PH.now) + '</p>' : '') + (PH.queue.length ? PH.queue.map(function (r, i) {
      return '<div class="hrow"><span class="hic">' + (i + 1) + '</span><span class="hlb">' + esc(r.text) + ' <span class="muted">· ' + esc(r.name) + '</span></span><span class="btn sm go" data-qplay="' + i + '">▶ PLAY</span><span class="btn sm" data-qdel="' + i + '">✕</span></div>';
    }).join('') : '<p class="muted">No song requests yet.</p>');
    if ($('phPhotos')) $('phPhotos').innerHTML = PH.photos.length ? PH.photos.slice(0, 12).map(function (f) { return '<div class="phimg" data-photo="' + esc(f) + '"></div>'; }).join('') : '<p class="muted">Photos people send show up here.</p>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-qplay]'), function (b) { b.addEventListener('click', function () { playRequest(+b.getAttribute('data-qplay')); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-qdel]'), function (b) { b.addEventListener('click', function () { PH.queue.splice(+b.getAttribute('data-qdel'), 1); phoneSync(); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-photo]'), function (el) {
      var f = el.getAttribute('data-photo'), d = A && A.photoData ? A.photoData(f) : '';
      if (d) el.style.backgroundImage = 'url("' + d + '")';
      el.addEventListener('click', function () {
        openPanel('PHOTO', '<img src="' + d + '" style="max-width:100%;max-height:55vh;border-radius:1vmin;display:block;margin:0 auto">' +
          '<div style="text-align:center;margin-top:1.5vmin"><span class="btn go" id="phShow">SHOW FULL SCREEN</span><span class="btn" id="phBack">BACK</span></div>');
        $('phShow').addEventListener('click', function () { closePanel(); showPhoto(d, ''); });
        $('phBack').addEventListener('click', openPhones);
      });
    });
  }
  function openPhones(retries) {
    var info = {}; try { info = JSON.parse(A && A.phoneInfo ? A.phoneInfo() : '{}'); } catch (e) {}
    if (info.starting) {
      openPanel('PHONES', '<p class="muted">Starting phone connection…</p>');
      var attempt = retries || 0;
      if (attempt < 8) setTimeout(function () {
        if (!$('panel').classList.contains('hidden') && $('panelTitle').textContent === 'PHONES') openPhones(attempt + 1);
      }, 250);
      return;
    }
    var urls = info.urls || [];
    var connect = info.ok && urls.length ?
      '<div class="phwrap"><img class="qr" src="' + (info.qr || '') + '"><div class="phtext"><div class="big">SCAN TO JOIN</div>' +
      '<p>Open the phone camera and point it at the code. Phones must be on the <b>same Wi-Fi or hotspot</b> as the truck.</p>' +
      '<p class="muted">Or type: <b class="green">' + esc(urls[0]) + '</b></p><p>CODE: <b class="green" style="font-size:4vmin;letter-spacing:1vmin">' + esc(info.pin) + '</b></p>' +
      '<span class="btn sm" id="phNewPin">NEW CODE</span><span class="btn sm' + (pref('autoRequests') !== '0' ? ' go' : '') + '" id="phAuto">AUTO-PLAY REQUESTS: ' + (pref('autoRequests') !== '0' ? 'ON' : 'OFF') + '</span></div></div>'
      : '<p class="muted">' + (A ? 'The box isn\'t on a Wi-Fi network yet. Connect it to Wi-Fi or a phone hotspot, then open this again.' : 'Phones connect when Nexus runs on the box.') + '</p>';
    openPanel('PHONES', connect + '<p class="muted" style="margin-top:2vmin">WHO\'S CONNECTED</p><div id="phPeople"></div>' +
      '<p class="muted" style="margin-top:2vmin">SONG REQUESTS</p><div id="phQueue"></div>' +
      '<p class="muted" style="margin-top:2vmin">PHOTOS</p><div id="phPhotos" class="phgrid"></div>');
    if ($('phNewPin')) $('phNewPin').addEventListener('click', function () { A.newPhonePin(); openPhones(); });
    if ($('phAuto')) $('phAuto').addEventListener('click', function () { setPref('autoRequests', pref('autoRequests') !== '0' ? '0' : '1'); openPhones(); });
    renderPhoneLists();
  }
  setTimeout(phoneSync, 3000);

  // ================= NEXUS TALKS FIRST, DJ INTROS, SCREENSAVER, SECRETS =================
  var lastRemark = Date.now(), lastDJ = 0, djSongs = 0, saverOn = false;
  function homeIdle() { return $('panel').classList.contains('hidden') && !(window.XP && XP.active) && !P.on && !awaySince && !booting && !(window.NexusCinema && NexusCinema.isOpen()); }
  function unprompted(what, tokens) {
    if (!aiKey() || Nexus.speaking || heardResolve || booting || awaySince) return;
    var sys = aiContext() + ' You are speaking first, without being asked. ' + what + ' One short sentence, two at the very most. Do not ask a question that needs an answer.';
    streamAnswer([{ role: 'user', parts: [{ text: '(go)' }] }], sys, { maxTokens: Math.min(tokens || 75, 75), temperature: 1.1 }).catch(function () {});
  }
  setInterval(function () {
    var now = Date.now();
    if (pref('talkFirst') !== '0' && now - lastRemark > 15 * 60000 && now - lastTouchAt > 3 * 60000 && now - lastTouchAt < 45 * 60000 && homeIdle()) {
      lastRemark = now; unprompted('Make a quick passing remark to Nathan about the time of day, the weather, the drive, or something you remember about him.');
    }
    if (pref('saver') !== '0' && !saverOn && homeIdle() && !Nexus.speaking && now - lastTouchAt > 5 * 60000) { saverOn = true; openExperience('clockface'); }
  }, 30000);
  function djIntro(title) {
    djSongs++;
    if (pref('dj') === '0' || PH.justPlayed || Date.now() - lastDJ < 4 * 60000 || djSongs < 2) return;
    lastDJ = Date.now(); djSongs = 0;
    unprompted('You are the DJ. This song just came on: "' + title + '". Introduce it like a radio DJ would, in character, over the start of the track.', 60);
  }
  // ---- Home buttons: built from a catalog so Nathan can pick which ones show and in what order ----
  var CATALOG = [];   // [act, icon, label]
  Array.prototype.forEach.call(document.querySelectorAll('#tiles .tile'), function (el) {
    CATALOG.push([el.getAttribute('data-act'), el.querySelector('.ic').innerHTML, el.querySelector('.lb').textContent]);
  });
  var DEFAULT_TILES = CATALOG.map(function (c) { return c[0]; });
  if (['2', '3', '4', '5', '6', '7'].indexOf(pref('homeVer')) < 0) { setPref('homeTiles', ''); setPref('homeVer', '6'); }
  if (pref('homeVer') === '2') {
    var oldT = (pref('homeTiles') || '').split(',').filter(Boolean);
    if (oldT.length) {
      oldT = oldT.map(function (k) { return k === 'livecam' ? 'phones' : k; });
      ['phones', 'clock'].forEach(function (k) { if (oldT.indexOf(k) < 0) oldT.splice(Math.max(0, oldT.indexOf('settings')), 0, k); });
      setPref('homeTiles', oldT.join(','));
    }
    setPref('homeVer', '3');
  }
  if (pref('homeVer') === '3') {
    var t4 = (pref('homeTiles') || '').split(',').filter(Boolean);
    if (t4.length && t4.indexOf('lyrics') < 0) { t4.splice(Math.max(0, t4.indexOf('settings')), 0, 'lyrics'); setPref('homeTiles', t4.join(',')); }
    setPref('homeVer', '4');
  }
  if (pref('homeVer') === '4') {
    var t5 = (pref('homeTiles') || '').split(',').filter(Boolean);
    if (t5.length && t5.indexOf('liquiddreams') < 0) {
      t5.splice(Math.max(0, t5.indexOf('settings')), 0, 'liquiddreams');
      setPref('homeTiles', t5.join(','));
    }
    setPref('homeVer', '5');
  }
  if (pref('homeVer') === '5') {
    // Alter Ego is gone and Backgrounds became Environments: keep the rest of a custom layout as it was.
    var t6 = (pref('homeTiles') || '').split(',').filter(Boolean).filter(function (k) { return k !== 'ego'; }).map(function (k) { return k === 'bgs' ? 'env' : k; });
    if (t6.length && t6.indexOf('env') < 0) t6.splice(Math.max(0, t6.indexOf('settings')), 0, 'env');
    setPref('homeTiles', t6.join(','));
    setPref('homeVer', '6');
  }
  if (pref('homeVer') === '6') {
    // Nexus Cinema arrived: add its button to a custom layout, next to Party Mode
    var t7 = (pref('homeTiles') || '').split(',').filter(Boolean);
    if (t7.length && t7.indexOf('cinema') < 0) { var pi = t7.indexOf('party'); t7.splice(pi >= 0 ? pi : Math.max(0, t7.indexOf('settings')), 0, 'cinema'); setPref('homeTiles', t7.join(',')); }
    setPref('homeVer', '7');
  }
  var VIS_ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12c2.5-3 5.5-3 8.5 0s6 3 8.5 0"/></svg>';
  function fullCatalog() {
    var out = CATALOG.slice(), have = {};
    out.forEach(function (c) { have[c[0]] = 1; });
    (typeof VISUALS !== 'undefined' ? VISUALS : []).forEach(function (v) {
      var key = have[v[0]] ? null : 'vis:' + v[0];
      if (key && !have[key]) { out.push([key, VIS_ICON, v[2]]); have[key] = 1; }
    });
    return out;
  }
  function homeTiles() {
    var saved = (pref('homeTiles') || '').split(',').filter(Boolean), cat = {};
    fullCatalog().forEach(function (c) { cat[c[0]] = c; });
    var list = saved.length ? saved.filter(function (k) { return cat[k]; }) : DEFAULT_TILES.slice();
    if (list.indexOf('settings') < 0) list.push('settings');
    return list.map(function (k) { return cat[k]; });
  }
  function perPage() { return (innerWidth / innerHeight >= 1.6) ? 12 : 8; }
  function renderTiles() {
    var list = homeTiles(), per = perPage(), pages = [];
    for (var i = 0; i < list.length; i += per) pages.push(list.slice(i, i + per));
    $('tiles').innerHTML = pages.map(function (pg) {
      return '<div class="tpage">' + pg.map(function (c) {
        return '<div class="tile" data-act="' + c[0] + '"' + (c[0] === 'party' ? ' id="tParty"' : c[0] === 'night' ? ' id="tNight"' : '') + '><span class="ic">' + c[1] + '</span><span class="lb">' + c[2] + '</span></div>';
      }).join('') + '</div>';
    }).join('');
    $('tiles').setAttribute('data-pages', pages.length);
    var dots = $('tdots'); if (!dots) { dots = document.createElement('div'); dots.id = 'tdots'; $('tiles').parentNode.insertBefore(dots, $('tiles').nextSibling); }
    dots.innerHTML = pages.length > 1 ? pages.map(function (p, i) { return '<span data-page="' + i + '"></span>'; }).join('') : '';
    Array.prototype.forEach.call(dots.children, function (d) { d.addEventListener('click', function () { var t = $('tiles'); t.scrollTo({ left: t.clientWidth * +d.getAttribute('data-page'), behavior: 'smooth' }); }); });
    function markDot() { var t = $('tiles'), n = Math.round(t.scrollLeft / Math.max(1, t.clientWidth)); Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle('on', i === n); }); }
    $('tiles').onscroll = markDot; markDot();
    Array.prototype.forEach.call(document.querySelectorAll('#tiles .tile'), function (el) {
      el.addEventListener('click', function () { act(el.getAttribute('data-act')); });
    });
    try { badges(); } catch (e) {}
  }
  function openHomeEditor() {
    var list = homeTiles().map(function (c) { return c[0]; }), all = fullCatalog();
    var byKey = {}; all.forEach(function (c) { byKey[c[0]] = c; });
    function save(l) { setPref('homeTiles', l.join(',')); renderTiles(); openHomeEditor(); }
    var html = '<div class="hint" style="margin-bottom:1.5vmin">Your home screen buttons, in order. Use ▲ ▼ to move them, ✕ to hide one, and ＋ below to add more. Settings always stays.</div>' +
      '<div class="hlist">' + list.map(function (k, i) {
        var c = byKey[k];
        return (i % perPage() === 0 ? '<div class="hint" style="margin:1.2vmin 0 .4vmin">PAGE ' + (i / perPage() + 1) + (i === 0 ? ' · the first screen you see' : ' · swipe left to get here') + '</div>' : '') +
          '<div class="hrow"><span class="hic">' + c[1] + '</span><span class="hlb">' + c[2] + '</span>' +
          '<span class="btn hb" data-mv="' + i + ':-1">▲</span><span class="btn hb" data-mv="' + i + ':1">▼</span>' +
          (k === 'settings' ? '<span class="btn hb off">✕</span>' : '<span class="btn hb" data-rm="' + i + '">✕</span>') + '</div>';
      }).join('') + '</div>' +
      '<div class="hint" style="margin:2vmin 0 1vmin">ADD A BUTTON</div><div class="agrid">' +
      all.filter(function (c) { return list.indexOf(c[0]) < 0; }).map(function (c) {
        return '<div class="app" data-add="' + c[0] + '"><span class="app-ic">' + c[1] + '</span><span>＋ ' + c[2] + '</span></div>';
      }).join('') + '</div>' +
      '<div style="margin-top:2vmin"><span class="btn" id="hReset">RESET TO DEFAULT</span></div>';
    var keep = $('panelBody') ? $('panelBody').scrollTop : 0;
    openPanel('HOME BUTTONS', html);
    $('panelBody').scrollTop = keep;
    Array.prototype.forEach.call(document.querySelectorAll('[data-mv]'), function (el) {
      el.addEventListener('click', function () { var p2 = el.getAttribute('data-mv').split(':'), i = +p2[0], j = i + +p2[1]; if (j < 0 || j >= list.length) return; var tmp = list[i]; list[i] = list[j]; list[j] = tmp; save(list); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-rm]'), function (el) {
      el.addEventListener('click', function () { list.splice(+el.getAttribute('data-rm'), 1); save(list); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-add]'), function (el) {
      el.addEventListener('click', function () { var k = el.getAttribute('data-add'), si = list.indexOf('settings'); list.splice(si < 0 ? list.length : si, 0, k); save(list); });
    });
    $('hReset').addEventListener('click', function () { setPref('homeTiles', ''); renderTiles(); openHomeEditor(); });
  }

  function badges() {
    var b = [];
    if (mode.party) b.push('<span class="badge">PARTY MODE</span>');
    $('modeBadges').innerHTML = b.join('');
    if ($('tParty')) $('tParty').classList.toggle('active', mode.party);
    document.body.classList.toggle('party', mode.party);
  }

  // ---- Party mode (lights follow the music in the cab via the mic) ----
  var P = { on: false, avg: 0.01, lastBeat: 0, lastMeter: 0, hue: 300, auto: null, decay: null, strobe: null, ctx: null };
  var HYPE = ['Make some noise!', 'Let\'s go!', 'Turn it up!', 'Passengers, this one\'s for you.', 'Nexus in the building!', 'Volume to the max. Let\'s ride.', 'Hands up in the truck!',
    'This truck is officially a club!', 'Somebody turn this song up!', 'I can feel the bass in my circuits!', 'Party mode! No sleeping in this truck!',
    'Who picked this song? Great choice!', 'Everybody in the truck, make some noise!', 'Louder! I can\'t hear you!', 'This is the best party on the road!'];
  var SHOUTOUTS = ['Shout out to everybody in the truck tonight!', 'Big shout out to the driver. Legend!', 'Shout out to the passengers. You guys are the real VIPs!',
    'Shout out to whoever picked this song. Absolute fire!', 'Shout out to the crew. Best ride in town!', 'This one goes out to everybody riding with Nathan!'];
  function flashTitle(txt) { var el = $('pTitle'); if (!el) return; var old = el.getAttribute('data-orig') || el.textContent; el.setAttribute('data-orig', old); el.textContent = txt; el.style.transform = 'scale(1.15)'; clearTimeout(el._t); el._t = setTimeout(function () { el.textContent = old; el.style.transform = ''; }, 1800); }
  var pfx = { conf: [], lasers: 0, running: false };
  var LASER_COLORS = ['RAINBOW', 'RED', 'GREEN', 'BLUE', 'PURPLE', 'WHITE', 'GOLD', 'MATCH LIGHTS'];
  var LASER_STYLES = ['FAN', 'SWEEP', 'CROSS', 'TUNNEL', 'RAIN', 'SPIN'];
  P.lcol = Math.max(0, LASER_COLORS.indexOf(pref('laserColor'))); P.lsty = Math.max(0, LASER_STYLES.indexOf(pref('laserStyle')));
  function laserHue(s, t) {
    var c = LASER_COLORS[P.lcol];
    if (c === 'RED') return [0, 100, 55]; if (c === 'GREEN') return [125, 100, 50]; if (c === 'BLUE') return [215, 100, 58];
    if (c === 'PURPLE') return [285, 100, 62]; if (c === 'WHITE') return [0, 0, 92]; if (c === 'GOLD') return [44, 100, 55];
    if (c === 'MATCH LIGHTS') return [P.hue % 360, 100, 58];
    return [(s * 70 + t * 90) % 360, 100, 60];
  }
  function startPfx() {
    if (pfx.running) return; pfx.running = true;
    var c = $('pfx'), g = c.getContext('2d');
    function f() {
      var W2 = c.width = c.clientWidth >> 1, H2 = c.height = c.clientHeight >> 1, now = performance.now(), any = false;
      g.clearRect(0, 0, W2, H2); g.globalCompositeOperation = 'lighter';
      var burst = pfx.lasers && now - pfx.lasers < 4500;
      if (P.lasersOn || burst) {
        any = true; var t = now / 1000, kick = Math.max(BEAT.k || 0, .25), sty = LASER_STYLES[P.lsty];
        g.lineCap = 'round';
        function beam(x0, y0, ang, len, s, w) {
          var h = laserHue(s, t), a = .35 + kick * .6;
          g.strokeStyle = 'hsla(' + h[0] + ',' + h[1] + '%,' + h[2] + '%,' + (a * .35) + ')'; g.lineWidth = w * 4;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len); g.stroke();
          g.strokeStyle = 'hsla(' + h[0] + ',' + h[1] + '%,' + Math.min(95, h[2] + 20) + '%,' + a + ')'; g.lineWidth = w;
          g.stroke();
        }
        var L2 = Math.hypot(W2, H2) * 1.2;
        if (sty === 'FAN') for (var s2 = 0; s2 < 4; s2++) { var ox = W2 * (.15 + s2 * .23), base = Math.sin(t * 1.6 + s2) * .7; for (var l = 0; l < 7; l++) beam(ox, H2, -Math.PI / 2 + base + (l - 3) * .11, L2, s2, 1.6); }
        else if (sty === 'SWEEP') for (var s3 = 0; s3 < 10; s3++) beam(W2 / 2, H2 * 1.02, -Math.PI / 2 + Math.sin(t * 1.3 + s3 * .35) * 1.2, L2, s3, 1.8);
        else if (sty === 'CROSS') for (var s4 = 0; s4 < 6; s4++) { var ph = Math.sin(t * 1.1 + s4) * .5; beam(0, H2 * (s4 / 5), ph * .6 + (s4 % 2 ? .25 : -.25), L2, s4, 1.6); beam(W2, H2 * (s4 / 5), Math.PI - ph * .6 + (s4 % 2 ? -.25 : .25), L2, s4 + 3, 1.6); }
        else if (sty === 'TUNNEL') for (var s5 = 0; s5 < 24; s5++) { var an = s5 / 24 * Math.PI * 2 + t * .4; beam(W2 / 2, H2 / 2, an, L2, s5, 1.2 + kick); }
        else if (sty === 'RAIN') for (var s6 = 0; s6 < 18; s6++) { var xx = ((s6 * 97 + t * 60 * (1 + s6 % 3)) % (W2 + 40)) - 20; beam(xx, 0, Math.PI / 2 + Math.sin(t + s6) * .15, H2 * 1.1, s6, 1.4); }
        else for (var s7 = 0; s7 < 8; s7++) { var a7 = t * (1 + kick) + s7 * Math.PI / 4; beam(W2 / 2, H2 / 2, a7, L2, s7, 1.8); }
      }
      g.globalCompositeOperation = 'source-over';
      pfx.conf = pfx.conf.filter(function (p) { p.x += p.vx; p.y += p.vy; p.r += p.vr; return p.y < 1.1; });
      pfx.conf.forEach(function (p) { any = true; g.save(); g.translate(p.x * W2, p.y * H2); g.rotate(p.r); g.fillStyle = 'hsl(' + p.h + ',100%,60%)'; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore(); });
      if (any && P.on) requestAnimationFrame(f); else { pfx.running = false; g.clearRect(0, 0, W2, H2); }
    }
    requestAnimationFrame(f);
  }
  var SHOUTS = ['Ohhh!', 'Let\'s go!', 'Drop it!', 'Yeah!', 'Party mode!', 'Turn it up!'];
  var PARTY_IN = ['Party mode activated! Let\'s get this party started!', 'Party mode! Turn it up and let\'s go!', 'It\'s party time! Hands up in the truck!',
    'Party mode engaged! This truck just became a club!', 'Attention passengers, party mode is now in effect! Let\'s go!'];
  var PARTY_OUT = ['Party\'s over. Back to business.', 'Party mode off. That was a good one.', 'Shutting down the party. Good times.'];
  var talkBusy = false;
  P.voice = pref('partyVoice') === 'on';
  function partyTalk(line, force, fixed) {
    if (!force && !P.voice) return;
    if (talkBusy) return; talkBusy = true; (fixed ? sayLine(line, true) : say(line)).then(function () { talkBusy = false; });
  }
  function beep(freq, at, dur) { tone('square', freq, at, dur, 0.22); tone('sine', freq * 2, at, dur, 0.12); }

  function buildBars() {
    ['pTop', 'pBottom'].forEach(function (id) {
      var el = $(id); if (el.children.length) return;
      var h = ''; for (var i = 0; i < 24; i++) h += '<i></i>'; el.innerHTML = h;
    });
  }
  function audio() { try { P.ctx = P.ctx || new (window.AudioContext || window.webkitAudioContext)(); if (P.ctx.state === 'suspended') P.ctx.resume(); } catch (e) {} return P.ctx; }

  var THEMES = ['RAINBOW', 'POLICE', 'FIRE', 'ICE', 'PURPLE HAZE', 'TOXIC', 'SUNSET', 'GOLD', 'MONO'];
  P.themeSaved = THEMES.indexOf(pref('partyTheme'));
  P.theme = Math.max(0, P.themeSaved); P.flip = 0;
  function themeColor(i) {
    var t = THEMES[P.theme];
    if (t === 'POLICE') return ((i + P.flip) % 2) ? 'hsl(0,100%,52%)' : 'hsl(220,100%,55%)';
    if (t === 'FIRE') return 'hsl(' + Math.round((P.hue + i * 9) % 50) + ',100%,' + (50 + (i % 3) * 6) + '%)';
    if (t === 'ICE') return 'hsl(' + Math.round(185 + (P.hue + i * 7) % 40) + ',100%,' + (60 + (i % 3) * 10) + '%)';
    if (t === 'PURPLE HAZE') return 'hsl(' + Math.round(265 + (P.hue + i * 7) % 50) + ',100%,' + (55 + (i % 3) * 8) + '%)';
    if (t === 'TOXIC') return 'hsl(' + Math.round(85 + (P.hue + i * 5) % 45) + ',100%,' + (50 + (i % 3) * 6) + '%)';
    if (t === 'SUNSET') return 'hsl(' + Math.round((330 + (P.hue + i * 8) % 70) % 360) + ',100%,' + (55 + (i % 3) * 6) + '%)';
    if (t === 'GOLD') return 'hsl(' + Math.round(38 + (P.hue + i * 3) % 18) + ',100%,' + (50 + (i % 3) * 10) + '%)';
    if (t === 'MONO') return 'hsl(0,0%,' + (75 + (i % 3) * 10) + '%)';
    return 'hsl(' + Math.round((P.hue + i * 12) % 360) + ',100%,55%)';
  }
  function beat(power) {
    P.lastBeat = Date.now(); P.flip++;
    // The dedicated Party canvas consumes the measured spectrum. Do not repaint
    // the legacy full-screen wash here; its random theme flash caused green bursts.
  }

  // ---- Beat analyser: turns the music signal into "energy" (0-1) and "kicks" (bass hits) ----
  var BEAT = window.BEAT = { avg: .02, bavg: .02, peak: .05, e: 0, k: 0, mid: 0, high: 0, bass: 0, level: 0, last: 0, kicks: 0, live: 0 };
  BEAT.tick = function () { BEAT.k *= .86; BEAT.e *= .97; BEAT.mid *= .9; BEAT.high *= .9; BEAT.bass *= .9; BEAT.level *= .95; return Math.max(BEAT.e, BEAT.k); };
  function feedBeat(all, bass, mid, high) {
    if (bass === undefined) bass = all;
    BEAT.mid = BEAT.mid * .72 + (Number(mid) || 0) * .28;
    BEAT.high = BEAT.high * .72 + (Number(high) || 0) * .28;
    // Absolute (not peak-relative) bands: a quiet, unvarying passage reads as quiet here even after
    // the recent peak has decayed, which is what keeps genuinely quiet music looking calm.
    BEAT.bass = BEAT.bass * .7 + Math.min(1.4, (Number(bass) || 0) * 11) * .3;
    BEAT.level = BEAT.level * .82 + Math.min(1.4, (Number(all) || 0) * 11) * .18;
    var now = Date.now();
    BEAT.avg = BEAT.avg * .97 + all * .03;
    BEAT.bavg = BEAT.bavg * .94 + bass * .06;
    BEAT.peak = Math.max(BEAT.peak * .995, all);
    if (all > .004) BEAT.live = now;
    var lvl = Math.min(1, Math.max(0, all / (BEAT.peak * .9 + 1e-4)));
    BEAT.e = Math.max(BEAT.e * .8, lvl);
    if (bass > BEAT.bavg * 1.3 && bass > .008 && now - BEAT.last > 190) {
      BEAT.last = now; BEAT.kicks++;
      BEAT.k = Math.min(1, Math.max(.65, (bass / (BEAT.bavg + 1e-4) - 1) * 1.2));
      return true;
    }
    return false;
  }
  Nexus._meter = function (all, bass, mid, high) {
    var kick = feedBeat(all, bass, mid, high);
    if (window.XP && XP.onMeter) XP.onMeter(all, bass, kick, mid, high);
    if (!P.on) return;
    if (all > 0.004) P.lastMeter = Date.now();
    $('pMeterFill').style.width = Math.round(BEAT.e * 100) + '%';
    if (kick && Date.now() - P.lastBeat > 150) beat(BEAT.k);
    if (kick && BEAT.k > .95 && Date.now() - (P.lastShout || 0) > 25000) { P.lastShout = Date.now(); partyTalk(voiceLine('hype'), false, true); }
  };
  Nexus._meterSource = function (src) {
    $('pHint').textContent = src === 'music' ? 'LIGHTS ARE SYNCED TO THE MUSIC' : 'TURN THE MUSIC UP · THE LIGHTS FOLLOW THE BEAT';
  };
  Nexus._meterError = function () { $('pHint').textContent = 'MUSIC ANALYSIS UNAVAILABLE · FIELD MOTION IS AMBIENT'; };

  function pollSong() {
    if (!P.on || !A) return;
    var np = {};
    try { np = JSON.parse(A.nowPlaying() || '{}'); } catch (e) {}
    if (np.access === false) { $('pSong').textContent = 'Media access unavailable'; $('partyArtist').textContent = 'Enable notification access'; P.song = ''; return; }
    if (!np.title || np.title === 'null') { $('pSong').textContent = 'No media playing'; $('partyArtist').textContent = 'Connect a media player'; P.song = ''; return; }
    var artist = np.artist && np.artist !== 'null' ? np.artist : '';
    $('pSong').textContent = np.title; $('partyArtist').textContent = artist || 'Artist unavailable';
    var key = np.title + '|' + artist;
    if (np.playing && key !== P.song) {
      var first = !P.song; P.song = key;
      if (!first) partyTalk(pick(['Up next, ' + np.title + '! Turn it up!', 'Here comes ' + np.title + '!', 'Next track, ' + np.title + '! Let\'s go!', 'Oh, ' + np.title + '! Good one!']));
      beat(1);
    }
  }
  function partyListen() {
    try { if (A) A.partyMeter(false); } catch (e) {}
    $('pHint').textContent = 'LISTENING… SAY "NEXT SONG", "TURN IT UP", OR ASK ANYTHING';
    listen().then(function (res) {
      $('pHint').textContent = 'TURN THE MUSIC UP · THE LIGHTS FOLLOW THE BEAT';
      try { if (A && P.on) A.partyMeter(true); } catch (e) {}
      var done = function () { resumeAfterTalk(); };
      if (typeof res === 'string' && res.trim()) return handleSpeech(res).then(done, done);
      done();
    });
  }

  function enterParty() {
    P.song = '';
    clearInterval(P.songTimer);
    P.songTimer = setInterval(pollSong, 4000); setTimeout(pollSong, 600);
    P.on = mode.party = true;
    buildBars(); badges();
    $('party').classList.remove('hidden');
    $('pHint').textContent = 'TURN THE MUSIC UP · THE LIGHTS FOLLOW THE BEAT';
    try { if (A) A.partyMeter(true); } catch (e) {}
    clearInterval(P.auto); P.auto = null; // Orb motion is driven by the active Party renderer; no background beat timer needed.
    P.lastShout = Date.now();
    var vb = document.querySelector('.pbtn[data-fx=voice] span'); if (vb) vb.textContent = P.voice ? 'VOICE ON' : 'VOICE OFF';
    $('pThemeName').textContent = THEMES[P.theme]; $('pLaserCol').textContent = 'LASER ' + LASER_COLORS[P.lcol]; $('pLaserSty').textContent = 'BEAM ' + LASER_STYLES[P.lsty];
    clearInterval(P.talk);
    P.talk = setInterval(function () { if (P.on) partyTalk(voiceLine('hype'), false, true); }, 45000 + Math.floor(Math.random() * 20000));
  }
  function exitParty(silent) {
    P.on = mode.party = false;
    clearInterval(P.auto); clearInterval(P.strobe); P.strobe = null;
    try { if (A) A.partyMeter(false); } catch (e) {}
    $('party').classList.add('hidden');
    Array.prototype.forEach.call(document.querySelectorAll('.pbtn'), function (b) { b.classList.remove('on'); });
    badges();
    clearInterval(P.talk); clearInterval(P.songTimer);
    clearTimeout(P.decay); P.lasersOn = false;
  }
  function toggleParty() { if (P.on) exitParty(); else enterParty(); }

  // sound effects, made on the fly (no files needed)
  function tone(type, freq, start, dur, vol, endFreq) {
    var c = audio(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + start;
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.setValueAtTime(vol, t0 + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(start, dur, vol, hp) {
    var c = audio(); if (!c) return;
    var len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter(), t0 = c.currentTime + start;
    f.type = 'highpass'; f.frequency.value = hp || 800;
    g.gain.value = vol; src.buffer = buf; src.connect(f); f.connect(g); g.connect(c.destination); src.start(t0);
  }
  var FX = {
    horn: function () {
      [0, 0.32, 0.64].forEach(function (st, k) {
        var d = k === 2 ? 0.9 : 0.24;
        [466, 587, 698].forEach(function (f) { tone('sawtooth', f, st, d, 0.13); });
      });
      for (var i = 0; i < 6; i++) setTimeout(function () { beat(1); }, i * 160);
    },
    drop: function () {
      tone('sine', 180, 0, 1.6, 0.35, 32); tone('square', 90, 0, 1.6, 0.05, 20); noise(1.5, 0.6, 0.22, 200);
      setTimeout(function () { for (var i = 0; i < 8; i++) setTimeout(function () { beat(1); }, i * 90); }, 1500);
    },
    roll: function () {
      var t = 0, gap = 0.12;
      while (t < 1.8) { noise(t, 0.05, 0.2, 1500); t += gap; gap = Math.max(0.035, gap * 0.9); }
      noise(1.85, 1.2, 0.3, 3000);
      setTimeout(function () { beat(1); }, 1850);
    },
    hype: function () {
      var line = voiceLine('hype');
      flashTitle(line.replace(/[!.]$/, '').toUpperCase().slice(0, 28));
      tone('sawtooth', 220, 0, .6, 0.08, 880); tone('square', 110, 0, .6, 0.05, 440);
      stopTalking(); talkBusy = true; sayLine(line, true).then(function () { talkBusy = false; });
      for (var i = 0; i < 4; i++) setTimeout(function () { beat(1); }, i * 180);
    },
    lasers: function (btn) { P.lasersOn = !P.lasersOn; btn.classList.toggle('on', P.lasersOn); if (P.lasersOn) { startPfx(); tone('sawtooth', 1400, 0, .25, 0.06, 300); tone('sawtooth', 1200, .3, .25, 0.06, 250); } },
    lcolor: function () { P.lcol = (P.lcol + 1) % LASER_COLORS.length; setPref('laserColor', LASER_COLORS[P.lcol]); $('pLaserCol').textContent = 'LASER ' + LASER_COLORS[P.lcol]; if (!P.lasersOn) { pfx.lasers = performance.now(); startPfx(); } },
    lstyle: function () { P.lsty = (P.lsty + 1) % LASER_STYLES.length; setPref('laserStyle', LASER_STYLES[P.lsty]); $('pLaserSty').textContent = 'BEAM ' + LASER_STYLES[P.lsty]; if (!P.lasersOn) { pfx.lasers = performance.now(); startPfx(); } },
    confetti: function () { for (var i = 0; i < 160; i++) pfx.conf.push({ x: Math.random(), y: -Math.random() * .3, vx: (Math.random() - .5) * .004, vy: .004 + Math.random() * .006, r: Math.random() * 6, vr: (Math.random() - .5) * .3, h: Math.random() * 360, s: 4 + Math.random() * 6 }); startPfx(); noise(0, .25, .25, 2500); tone('sine', 1200, 0, .15, .1); tone('sine', 1600, .1, .2, .1); },
    siren: function () { var oldTheme = P.theme; P.theme = 1; $('pThemeName').textContent = THEMES[1]; for (var k = 0; k < 4; k++) { tone('sawtooth', 700, k * .6, .3, .1, 1100); tone('sawtooth', 1100, k * .6 + .3, .3, .1, 700); } var n = 0, iv = setInterval(function () { beat(1); if (++n > 14) { clearInterval(iv); P.theme = oldTheme; $('pThemeName').textContent = THEMES[oldTheme]; } }, 170); },
    shout: function () { var line = voiceLine('shout'); flashTitle('SHOUTOUT'); stopTalking(); talkBusy = true; sayLine(line, true).then(function () { talkBusy = false; }); beat(1); },
    scratch: function () { [0, .14, .3, .44].forEach(function (st, i) { noise(st, .12, .35, i % 2 ? 900 : 400); tone('sawtooth', i % 2 ? 300 : 160, st, .12, .1, i % 2 ? 120 : 420); }); setTimeout(function () { beat(1); }, 120); setTimeout(function () { beat(1); }, 440); },
    voice: function (btn) { P.voice = !P.voice; setPref('partyVoice', P.voice ? 'on' : 'off'); btn.querySelector('span').textContent = P.voice ? 'VOICE ON' : 'VOICE OFF'; btn.classList.toggle('on', P.voice); },
    strobe: function (btn) {
      if (P.strobe) { clearInterval(P.strobe); P.strobe = null; btn.classList.remove('on'); return; }
      btn.classList.add('on');
      var w = $('pWash'), n = 0;
      P.strobe = setInterval(function () {
        n++; w.style.backgroundColor = '#fff'; w.style.opacity = n % 2 ? .85 : 0;
        if (n > 70) { clearInterval(P.strobe); P.strobe = null; btn.classList.remove('on'); w.style.opacity = .12; }
      }, 70);
    },
    exit: function () { exitParty(); },
    prev: function () { music('prev'); }, next: function () { music('next'); }, toggle: function () { music('toggle'); },
    volup: function () { music('up'); }, voldown: function () { music('down'); },
    talk: function () { partyListen(); },
    theme: function () { P.theme = (P.theme + 1) % THEMES.length; setPref('partyTheme', THEMES[P.theme]); $('pThemeName').textContent = THEMES[P.theme]; beat(1); },
    countdown: function () {
      if (P.counting) return; P.counting = true;
      var el = document.createElement('div'); el.id = 'pCount'; $('party').appendChild(el);
      var steps = ['3', '2', '1'], words = ['Three!', 'Two!', 'One!'];
      var chain = Promise.resolve();
      steps.forEach(function (n, k) {
        chain = chain.then(function () {
          el.textContent = n; beat(.4 + k * .3); beep(660 + k * 110, 0, .22); stopTalking(); say(words[k], { rate: 1.1, pitch: .85 });
          return wait(900);
        });
      });
      chain.then(function () {
        el.textContent = 'DROP!'; beep(1320, 0, .3); say('Drop it!', { rate: 1.05, pitch: .8 }); FX.drop();
        return wait(1900);
      }).then(function () { el.parentNode.removeChild(el); P.counting = false; });
    }
  };
  Array.prototype.forEach.call(document.querySelectorAll('.pbtn'), function (b) {
    b.addEventListener('click', function () { var f = FX[b.getAttribute('data-fx')]; if (f) f(b); });
  });

  // ---- Intruder alert
  var audioCtx = null;
  function siren(seconds) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain(), now = audioCtx.currentTime;
      o.type = 'sawtooth'; o.connect(g); g.connect(audioCtx.destination); g.gain.value = 0.08;
      for (var i = 0; i < seconds * 2; i++) { o.frequency.setValueAtTime(i % 2 ? 620 : 880, now + i * .5); }
      o.start(now); o.stop(now + seconds);
    } catch (e) {}
  }
  function runIntruder() {
    if (mode.intruder) return;
    mode.intruder = true;
    envMode();
    var el = $('intruder'); el.classList.remove('hidden', 'safe');
    $('intruderText').textContent = 'UNAUTHORIZED PASSENGER DETECTED';
    $('intruderSub').textContent = '';
    var f = $('flash'); f.style.background = '#ff0000';
    var flashes = setInterval(function () { f.style.opacity = f.style.opacity === '0.25' ? '0' : '0.25'; }, 350);
    siren(3);
    say('Warning. Unauthorized passenger detected.')
      .then(function () { $('intruderSub').textContent = 'INITIATING SECURITY PROTOCOL'; return say('Initiating security protocol.'); })
      .then(function () { $('intruderSub').textContent = 'SCANNING ▓▓▓▓░░░░░░'; return wait(900); })
      .then(function () { $('intruderSub').textContent = 'SCANNING ▓▓▓▓▓▓▓▓░░'; return wait(900); })
      .then(function () { $('intruderSub').textContent = 'EJECTION SEAT ARMED'; return say('Ejection seat armed.'); })
      .then(function () { return wait(1200); })
      .then(function () {
        clearInterval(flashes); f.style.opacity = 0;
        el.classList.add('safe');
        $('intruderText').textContent = 'JUST KIDDING';
        $('intruderSub').textContent = 'WELCOME ABOARD';
        mode.intruder = false;
        envMode();
        return say('Just kidding. Welcome aboard.');
      })
      .then(function () { return wait(1200); })
      .then(function () { el.classList.add('hidden'); });
  }

  // ------------------------------------------------------------------
  // Panel helper
  // ------------------------------------------------------------------
  var panelOnClose = null;
  function openPanel(title, html, onClose) {
    $('panelTitle').textContent = title;
    $('panelBody').innerHTML = html;
    $('panelBody').scrollTop = 0;
    $('panel').classList.remove('hidden');
    panelOnClose = onClose || null;
  }
  function closePanel() {
    try { if (window.NexusEnv) NexusEnv.detachPreviews(); } catch (e) {}
    if ($('panel').classList.contains('hidden')) return false;
    $('panel').classList.add('hidden');
    stopTalking();
    if (panelOnClose) { var c = panelOnClose; panelOnClose = null; c(); }
    return true;
  }
  $('panelClose').addEventListener('click', closePanel);

  // ---- Trivia night
  var TRIVIA_BANK = [
    ['What is the largest planet in our solar system?', ['Saturn', 'Jupiter', 'Neptune', 'Earth'], 1, 'Jupiter is so big that more than 1,300 Earths could fit inside it.'],
    ['How many wheels does a standard semi-truck usually have?', ['10', '14', '18', '22'], 2, 'That is why they are called eighteen-wheelers.'],
    ['Which animal is known as the ship of the desert?', ['Camel', 'Horse', 'Elephant', 'Llama'], 0, 'Camels can drink about 100 litres of water in one go.'],
    ['What is the hardest natural substance on Earth?', ['Gold', 'Iron', 'Diamond', 'Quartz'], 2, 'Diamond is pure carbon arranged in a super strong crystal.'],
    ['Which country has the longest coastline in the world?', ['Russia', 'Australia', 'Canada', 'Norway'], 2, 'Canada has over 200,000 kilometres of coastline.'],
    ['How many hearts does an octopus have?', ['One', 'Two', 'Three', 'Four'], 2, 'Two pump blood to the gills and one to the rest of the body.'],
    ['What gas do plants absorb from the air?', ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'], 1, 'Plants turn carbon dioxide and sunlight into sugar and oxygen.'],
    ['What is the fastest land animal?', ['Lion', 'Pronghorn', 'Cheetah', 'Greyhound'], 2, 'A cheetah can hit around 110 kilometres per hour in short bursts.'],
    ['Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Mercury', 'Jupiter'], 1, 'Mars is red because of iron oxide, basically rust, in its soil.'],
    ['What is the capital city of Canada?', ['Toronto', 'Vancouver', 'Ottawa', 'Montreal'], 2, 'Ottawa was chosen as the capital by Queen Victoria in 1857.'],
    ['How many bones are in the adult human body?', ['106', '206', '306', '156'], 1, 'Babies are born with closer to 300, and some fuse together as they grow.'],
    ['What colour is a polar bear\'s skin?', ['White', 'Pink', 'Black', 'Grey'], 2, 'Their fur is actually see-through and the skin underneath is black.'],
    ['Which ocean is the largest?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], 3, 'The Pacific covers about a third of the Earth\'s surface.'],
    ['What does a seismograph measure?', ['Wind', 'Earthquakes', 'Rainfall', 'Temperature'], 1, 'It records the shaking of the ground during earthquakes.'],
    ['How long does light from the Sun take to reach Earth?', ['8 seconds', '8 minutes', '8 hours', '8 days'], 1, 'About eight minutes and twenty seconds.']
  ];
  var trivia = null;

  function fetchQuestion() {
    var used = trivia.asked.slice(-15).join(' | ');
    var sys = 'You write fun pub-style trivia for a group in a truck. Mix of general knowledge, science, sports, movies, music, geography, history and cars. ' +
      'Medium difficulty. Return ONLY JSON: {"question": string, "options": [4 short strings], "answer_index": 0-3, "fact": one short fun fact sentence}. ' +
      'Do not repeat these recent questions: ' + used;
    return askAI([{ role: 'user', parts: [{ text: 'Give me the next trivia question.' }] }], sys, { json: true, temperature: 1.0, maxTokens: 1024 })
      .then(function (txt) {
        var m = txt.match(/\{[\s\S]*\}/); var j = JSON.parse(m ? m[0] : txt);
        if (!j.question || !j.options || j.options.length !== 4) throw new Error('shape');
        return [j.question, j.options, Number(j.answer_index), j.fact || ''];
      })
      .catch(function () {
        var pool = TRIVIA_BANK.filter(function (q) { return trivia.asked.indexOf(q[0]) < 0; });
        return pick(pool.length ? pool : TRIVIA_BANK);
      });
  }

  function openTrivia() {
    trivia = { n: 0, right: 0, wrong: 0, asked: [], locked: true };
    openPanel('TRIVIA NIGHT', '<div class="muted">Loading the first question…</div>', function () { trivia = null; });
    say('Trivia night is on. Tap your answer on the screen.').then(nextQuestion);
  }
  function nextQuestion() {
    if (!trivia) return;
    trivia.locked = true;
    $('panelBody').innerHTML = '<div class="muted">Thinking of a good one…</div>';
    fetchQuestion().then(function (q) {
      if (!trivia) return;
      trivia.n++; trivia.asked.push(q[0]); trivia.cur = q;
      var L = ['A', 'B', 'C', 'D'];
      $('panelBody').innerHTML = '<div class="score">QUESTION ' + trivia.n + ' · <span class="green">RIGHT ' + trivia.right + '</span> · <span class="red">WRONG ' + trivia.wrong + '</span></div>' +
        '<div class="tq">' + esc(q[0]) + '</div><div class="topts">' +
        q[1].map(function (o, i) { return '<div class="topt" data-i="' + i + '"><b>' + L[i] + '.</b> ' + esc(o) + '</div>'; }).join('') +
        '</div><div id="tAfter"></div>';
      Array.prototype.forEach.call(document.querySelectorAll('.topt'), function (el) {
        el.addEventListener('click', function () { answer(Number(el.getAttribute('data-i'))); });
      });
      trivia.locked = false;
      say('Question ' + trivia.n + '. ' + q[0] + ' ' + q[1].map(function (o, i) { return L[i] + ', ' + o + '.'; }).join(' '));
    });
  }
  function answer(i) {
    if (!trivia || trivia.locked) return;
    trivia.locked = true;
    stopTalking();
    var q = trivia.cur; if (!(q[2] >= 0 && q[2] < 4)) q[2] = 0; var opts = document.querySelectorAll('.topt'), ok = i === q[2];
    opts[q[2]].classList.add('right');
    if (!ok) opts[i].classList.add('wrong');
    if (ok) trivia.right++; else trivia.wrong++;
    $('tAfter').innerHTML = '<p>' + (ok ? '<span class="green">Correct.</span> ' : '<span class="red">Not quite.</span> ') + esc(q[3]) + '</p>' +
      '<span class="btn go" id="tNext">NEXT QUESTION</span>';
    $('tNext').addEventListener('click', function () { stopTalking(); nextQuestion(); });
    say((ok ? reactLine(true) : reactLine(false) + ' The answer was ' + q[1][q[2]] + '.') + ' ' + q[3]);
  }

  // ---- Story mode
  var GENRES = ['a sci-fi adventure about a long-haul trucker hauling mysterious cargo between planets', 'a mystery on a lonely northern highway',
    'a heist story with a crew of clever misfits', 'a northern legend told around a campfire', 'a survival story in a deep winter storm',
    'a comedy about a truck AI that becomes self-aware', 'a treasure hunt across the Arctic'];
  function storyData() { try { return JSON.parse(localStorage.getItem('nexus_story') || 'null'); } catch (e) { return null; } }
  function saveStory(s) { try { localStorage.setItem('nexus_story', JSON.stringify(s)); } catch (e) {} }

  function openStory() {
    var s = storyData();
    var html = '<p>' + (s ? 'You have a story in progress: <span class="green">' + esc(s.title) + '</span> (chapter ' + s.parts.length + ').' : 'No story in progress yet.') + '</p>' +
      (s ? '<span class="btn go" id="stCont">CONTINUE STORY</span>' : '') + '<span class="btn" id="stNew">START A NEW STORY</span><div id="stText"></div>';
    openPanel('STORY MODE', html);
    if ($('stCont')) $('stCont').addEventListener('click', function () { storyChapter(false); });
    $('stNew').addEventListener('click', function () { storyChapter(true); });
  }
  function storyChapter(fresh) {
    var s = fresh ? null : storyData();
    var genre = s ? s.genre : pick(GENRES);
    var sys = 'You are NEXUS, narrating an ongoing audio story for people riding in a truck. Genre: ' + genre + '. ' +
      'Write the next chapter in about 180 words of vivid, easy-to-follow spoken prose. No headings, no markdown, no lists. ' +
      'End on a hook that makes people want the next chapter. Keep it suitable for all ages.' +
      (s ? '' : ' On the very first line write TITLE: followed by a short story title, then the chapter on the next line.');
    var contents = [];
    if (s) {
      var recap = s.parts.slice(-4).join('\n\n');
      contents.push({ role: 'user', parts: [{ text: 'Story so far (most recent chapters):\n' + recap + '\n\nContinue with the next chapter.' }] });
    } else {
      contents.push({ role: 'user', parts: [{ text: 'Start the story with chapter one.' }] });
    }
    $('panelBody').innerHTML = '<div class="muted">Writing the next chapter…</div>';
    askAI(contents, sys, { maxTokens: 2048, temperature: 1.0 }).then(function (txt) {
      txt = txt.replace(/[*#_`]/g, '');
      var title = s ? s.title : 'Untitled';
      var m = txt.match(/^\s*TITLE:\s*(.+)\n/i);
      if (m) { title = m[1].trim(); txt = txt.replace(m[0], '').trim(); }
      s = s || { title: title, genre: genre, parts: [] };
      s.parts.push(txt); if (s.parts.length > 30) s.parts = s.parts.slice(-30);
      saveStory(s);
      $('panelBody').innerHTML = '<div class="score">' + esc(s.title.toUpperCase()) + ' · CHAPTER ' + s.parts.length + '</div>' +
        txt.split(/\n+/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') +
        '<span class="btn go" id="stMore">NEXT CHAPTER</span><span class="btn" id="stStop">STOP READING</span>';
      $('stMore').addEventListener('click', function () { stopTalking(); storyChapter(false); });
      $('stStop').addEventListener('click', stopTalking);
      return say((s.parts.length === 1 ? s.title + '. Chapter one. ' : 'Chapter ' + s.parts.length + '. ') + txt);
    }).catch(function (e) {
      $('panelBody').innerHTML = '<p>' + esc(aiErrorLine(e)) + '</p>';
      say(aiErrorLine(e));
    });
  }

  // ---- All apps
  function openApps() {
    openPanel('ALL APPS', '<div class="muted">Loading apps…</div>');
    setTimeout(function () {
      var apps = [];
      try { apps = A ? JSON.parse(A.getApps()) : []; } catch (e) {}
      if (!apps.length) { $('panelBody').innerHTML = '<p class="muted">No apps found.</p>'; return; }
      $('panelBody').innerHTML = '<div class="agrid">' + apps.map(function (a, i) {
        return '<div class="app" data-i="' + i + '">' + (a.icon ? '<img src="' + a.icon + '">' : '') + '<span>' + esc(a.label) + '</span></div>';
      }).join('') + '</div>';
      Array.prototype.forEach.call(document.querySelectorAll('.app'), function (el) {
        el.addEventListener('click', function () { var a = apps[Number(el.getAttribute('data-i'))]; A.launchComponent(a.pkg, a.cls); });
      });
    }, 50);
  }

  // ---- Settings
  function openSettings() {
    var voices = [], cur = '';
    try { voices = A ? JSON.parse(A.getVoices()) : []; cur = A ? A.currentVoice() : ''; } catch (e) {}
    var homes = [];
    try { homes = A ? JSON.parse(A.otherHomes()) : []; } catch (e) {}
    var html =
      '<div class="field"><label>DOWNLOAD UPDATE</label><div class="hint">Get the newest verified Nexus release. The install screen opens when the APK download and checks finish.</div><span class="btn go" id="sUpdate">DOWNLOAD UPDATE</span><div id="sUpdateMsg" class="hint"></div></div>' +
      '<div class="field"><label>HOME SCREEN BUTTONS</label><div class="hint">Pick which buttons are on the home screen and put them in any order. You can add any visual as its own button.</div><span class="btn go" id="sHome">CUSTOMIZE BUTTONS</span></div>' +
      '<div class="field"><label>GOOGLE AI KEY (FREE)</label>' +
      '<input type="password" id="sKey" placeholder="Paste your Gemini API key" value="' + esc(pref('gemini_key')) + '">' +
      '<div class="hint">Get a free key at aistudio.google.com → Get API key. This powers chat, trivia and stories.</div>' +
      '<span class="btn go" id="sKeySave">SAVE KEY</span><span class="btn" id="sKeyTest">TEST AI</span><div id="sKeyMsg" class="hint">' + (lastAiError ? 'Last AI problem: ' + esc(lastAiError) : (window.NEXUS_DEFAULT_KEY ? 'A built-in key is installed. A key saved here overrides it.' : '')) + '</div></div>' +

      '<div class="field"><label>BACKUP CITY (USED IF GPS IS OFF)</label>' +
      '<input type="text" id="sCity" placeholder="e.g. Cambridge Bay" value="' + esc(pref('city')) + '">' +
      '<span class="btn go" id="sCitySave">SAVE CITY</span><div id="sCityMsg" class="hint"></div></div>' +

      '<div class="field"><label>NEXUS VOICE</label><select id="sVoice">' +
      (voices.length ? voices.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') : '<option>Default</option>') +
      '</select><div class="hint">Tip: names with "x-rjs", "x-gbd" or "x-iom" are usually deeper male voices. More voices: Android Settings → Languages → Text-to-speech → Google → Install voice data.</div>' +
      rangeHtml('sRate', 'Speed', .6, 1.4, .05, pref('rate') || '0.95') +
      rangeHtml('sPitch', 'Pitch', .6, 1.4, .05, pref('pitch') || '0.9') +
      '<span class="btn go" id="sVoiceTest">TEST VOICE</span></div>' +

      '<div class="field"><label>HOW NEXUS BEHAVES</label>' +
      [['talkFirst', 'Talks first'], ['dj', 'DJ song intros'], ['saver', 'Clock screensaver'], ['showSpeed', 'Show AI response speed']].map(function (o) {
        var on = pref(o[0]) !== '0'; return switchHtml('data-toggle="' + o[0] + '"', o[1], on); }).join('') +
      '<div class="hint">Nexus remembers ' + memories().length + ' thing' + (memories().length === 1 ? '' : 's') + ' about you. Say "remember that…" to add one, or "forget everything".</div>' +
      '<span class="btn" id="sForget">CLEAR NEXUS MEMORY</span></div>' +
      '<div class="field"><label>HOME SCREEN</label>' +
      '<span class="btn" id="sHomeChoose">SET NEXUS AS DEFAULT HOME</span>' +
      homes.map(function (h, i) { return '<span class="btn" data-home="' + i + '">OPEN ' + esc(h.label.toUpperCase()) + '</span>'; }).join('') +
      '<div class="hint">Use the "Open …" buttons to get back to the box\'s original home screen any time.</div></div>' +

      '<div class="field"><label>SONG ANNOUNCEMENTS (PARTY MODE)</label>' +
      '<span class="btn go" id="sNotif">ALLOW NEXUS TO SEE WHAT\'S PLAYING</span>' +
      '<div class="hint">Opens Android settings. Turn Nexus ON in the list, then come back. If your box says it\'s unavailable, do this instead: open Spotify → Settings (gear) → scroll to "Device broadcast status" → turn it ON. Nexus will then see your songs.</div></div>' +
      '<div class="field"><label>SPOTIFY</label>' +
      switchHtml('data-toggle="exitBubble"', 'Show a "‹ NEXUS" button over Spotify', pref('exitBubble') !== '0') +
      switchHtml('data-toggle="musicOnStart"', 'Start my music when Nexus starts (carries on from the last song)', pref('musicOnStart') !== '0') +
      switchHtml('data-toggle="musicBar"', 'Show music buttons over Liquid Dreams, Night Drive and Visuals', pref('musicBar') !== '0') +
      (A && A.exitBubbleAllowed && !A.exitBubbleAllowed() ? '<span class="btn go" id="sExitAllow">ALLOW THE EXIT BUTTON</span><div class="hint">Opens Android settings. Turn on "Allow display over other apps" for Nexus, then come back.</div>' : '') +
      '<div class="hint">While Spotify is open, tap the floating button to come straight back to Nexus. Drag it to move it.</div></div>' +
      '<div class="field"><label>LIVE ENVIRONMENT</label><div class="hint">The animated world behind the Nexus screens: choose Prismatic Dimension, Floating Energy, Cosmic Aurora, Neural Flow or Bioluminescent Abyss, and adjust motion, brightness and quality. They move on their own and do not react to music.</div>' +
      '<span class="btn go" id="sEnv">OPEN ENVIRONMENTS</span></div>' +
      '<div class="field"><label>SYSTEM</label>' +
      '<span class="btn" id="sReplay">REPLAY STARTUP</span><span class="btn" id="sAndroid">ANDROID SETTINGS</span>' +
      '<div class="hint">Nexus version ' + esc(A ? A.version() : 'preview') + '</div></div>';
    openPanel('SETTINGS', html);

    $('sHome').addEventListener('click', function () { openHomeEditor(); });
    try { var lastErr = A && A.lastUpdateError ? A.lastUpdateError() : ''; if (lastErr) $('sUpdateMsg').textContent = 'Last try: ' + lastErr; } catch (e) {}
    $('sUpdate').addEventListener('click', function () { if (A && A.updateNexus) { $('sUpdateMsg').textContent = 'Starting…'; A.updateNexus(); } else $('sUpdateMsg').textContent = 'Only works on the box.'; });
    $('sKeySave').addEventListener('click', function () {
      setPref('gemini_key', $('sKey').value.trim()); $('sKeyMsg').textContent = 'Saved.';
    });
    $('sKeyTest').addEventListener('click', function () {
      setPref('gemini_key', $('sKey').value.trim());
      $('sKeyMsg').textContent = 'Testing…';
      askAI([{ role: 'user', parts: [{ text: 'Confirm you are online in one short sentence.' }] }], PERSONA, { maxTokens: 256 })
        .then(function (r) { $('sKeyMsg').innerHTML = '<span class="green">AI ONLINE.</span> ' + esc(r); say(r); })
        .catch(function (e) { $('sKeyMsg').innerHTML = '<span class="red">' + esc(aiErrorLine(e)) + '</span>' + (e.detail ? '<br>' + esc(e.detail) : ''); });
    });
    $('sCitySave').addEventListener('click', function () {
      setPref('city', $('sCity').value.trim()); $('sCityMsg').textContent = 'Checking weather…';
      loadWeather().then(function (w) { $('sCityMsg').textContent = w ? ('Got it: ' + w.temp + '°, ' + w.desc) : 'Could not find that city. Try adding the province.'; });
    });
    function tune() {
      setPref('rate', $('sRate').value); setPref('pitch', $('sPitch').value);
      try { if (A) { A.setVoice($('sVoice').value); A.setVoiceTuning(parseFloat($('sRate').value), parseFloat($('sPitch').value)); } } catch (e) {}
    }
    $('sVoice').addEventListener('change', tune);
    $('sRate').addEventListener('change', tune);
    $('sPitch').addEventListener('change', tune);
    $('sVoiceTest').addEventListener('click', function () { tune(); setTimeout(function () { say('Good morning, Nathan. I am Nexus, your personal assistant. How may I assist you?'); }, 300); });
    $('sHomeChoose').addEventListener('click', function () { if (A) A.openHomeChooser(); });
    if ($('sExitAllow')) $('sExitAllow').addEventListener('click', function () { if (A && A.allowExitBubble) A.allowExitBubble(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-home]'), function (el) {
      el.addEventListener('click', function () { var h = homes[Number(el.getAttribute('data-home'))]; A.openOtherHome(h.pkg, h.cls); });
    });
    $('sEnv').addEventListener('click', function () { openEnvironments(); });
    $('sNotif').addEventListener('click', function () { if (A) A.openNotificationAccess(); });
    $('sReplay').addEventListener('click', function () { closePanel(); runBoot(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-toggle]'), function (el) { el.addEventListener('click', function () { var k = el.getAttribute('data-toggle'); setPref(k, pref(k) !== '0' ? '0' : '1'); var y = $('panelBody').scrollTop; openSettings(); $('panelBody').scrollTop = y; }); });
    $('sForget').addEventListener('click', function () { setPref('memory', '[]'); caption('MEMORY CLEARED'); var y = $('panelBody').scrollTop; openSettings(); $('panelBody').scrollTop = y; });
    $('sAndroid').addEventListener('click', function () { if (A) A.openSystemSettings(); });
  }

  // ------------------------------------------------------------------
  // Experiences (loaded only when first opened, run only while on screen)
  // ------------------------------------------------------------------
  window.NX = {
    latestPhoto: function () { try { return PH.photos[0] && A && A.photoData ? A.photoData(PH.photos[0]) : ''; } catch (e) { return ''; } }, saver: function () { return saverOn; }, saverOff: function () { saverOn = false; }, say: say, sayLine: sayLine, voiceLine: voiceLine, sayVoiceLine: sayVoiceLine, stopTalking: stopTalking, listen: listen, handleSpeech: function (t) { return handleSpeech(t); },
    pauseForTalk: pauseForTalk, resumeAfterTalk: resumeAfterTalk,
    getCoords: function () { return getCoords(); }, pref: pref, http: http, askAI: askAI, pick: pick, wait: wait, esc: esc,
    weather: function () {  return weatherNow; }, place: function () { return placeNow; }, A: A, $: $
  };
  // The Visuals collection: five procedural, music-reactive experiences (rendered in experiences.js).
  var VISUALS = [
    ['clip_mix', '🎬', 'CINEMATIC MIX', 'Every scene, flowing into the next', 'Cinematic Mix'],
    ['clip_coins', '🪙', 'COIN AVALANCHE', 'An endless storm of gold', 'Coin Avalanche'],
    ['clip_skulls', '💀', 'SKULL MOUNTAIN', 'A mountain of golden skulls', 'Skull Mountain'],
    ['clip_cityfire', '🌆', 'CITY ON FIRE', 'Watching the whole city burn', 'City on Fire'],
    ['clip_inferno', '🔥', 'INFERNO', 'A wall of flame and embers', 'Inferno'],
    ['clip_serpent', '🐍', 'GOLDEN SERPENT', 'A gold snake through scattered coins', 'Golden Serpent'],
    ['clip_idol', '🗿', 'THE IDOL', 'A crowd before a giant glowing statue', 'The Idol'],
    ['clip_frenzy', '🙌', 'IDOL FRENZY', 'Arms raised, confetti flying', 'Idol Frenzy'],
    ['clip_run', '🏃', 'THE RUN', 'Sprinting through flying debris', 'The Run'],
    ['clip_collapse', '🏙', 'CITY COLLAPSE', 'A city breaking into glittering debris', 'City Collapse'],
    ['clip_printer', '🖨', 'MONEY PRINTER', 'The presses running hot', 'Money Printer'],
    ['clip_benjamin', '💵', 'BENJAMIN', 'The face on the hundred', 'Benjamin'],
    ['clip_freshcash', '💸', 'FRESH CASH', 'Crisp bills under the light', 'Fresh Cash'],
    ['clip_darkvalley', '🌲', 'DARK VALLEY', 'Red signals over a misty forest lake', 'Dark Valley']
  ];
  // ---- Shared control markup (design system components) ----
  function switchHtml(attrs, label, on) {
    return '<button type="button" class="sw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" ' + attrs + '><span class="sw-label">' + esc(label) + '</span><span class="sw-track"><i></i></span></button>';
  }
  function fmtRange(v) { return Math.round(v * 100) + '%'; }
  function rangeHtml(id, label, min, max, step, value) {
    return '<label class="range"><span>' + esc(label) + '</span><output for="' + id + '">' + fmtRange(+value, min, max) + '</output>' +
      '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></label>';
  }
  // Live range values: every slider shows its current value while it moves.
  document.addEventListener('input', function (e) {
    var el = e.target; if (!el || el.type !== 'range' || !el.id) return;
    var out = document.querySelector('output[for="' + el.id + '"]'); if (out) out.textContent = fmtRange(+el.value, +el.min, +el.max);
  });

  // ---- ENVIRONMENTS: live previews of the five worlds plus their controls ----
  function openEnvironments() {
    var E = window.NexusEnv;
    if (!E) { openPanel('ENVIRONMENTS', '<div class="hint">The live environment engine is not available on this device.</div>'); return; }
    var st = E.settings(), envs = E.ENVIRONMENTS, R = E.RANGES, cur = envs.filter(function (e) { return e.id === st.env; })[0];
    var openGroups = openEnvironments.open || { motion: true };
    function group(key, title, body) { return '<details class="group" data-group="' + key + '"' + (openGroups[key] ? ' open' : '') + '><summary>' + title + '</summary><div class="group-body">' + body + '</div></details>'; }
    var html = '<div class="env-grid">' + envs.map(function (e, i) {
        return '<button type="button" class="env-card' + (e.id === st.env ? ' selected' : '') + '" data-env="' + e.id + '" aria-pressed="' + (e.id === st.env) + '">' +
          '<canvas width="256" height="144" data-preview="' + e.id + '"></canvas><span class="env-meta"><span class="env-num">0' + (i + 1) + '</span><b>' + esc(e.name) + '</b><small>' + esc(e.tagline) + '</small></span>' +
          '<span class="env-check" aria-hidden="true"></span></button>';
      }).join('') + '</div>' +
      '<div class="section-title">Colour · ' + esc(cur.name) + '</div><div class="chips">' + cur.palettes.map(function (p, i) {
        var c = p.colors.map(function (x) { return 'rgb(' + x.map(function (v) { return Math.round(Math.min(1, v) * 255); }).join(',') + ')'; });
        return '<button type="button" class="chip-btn' + (st.palettes[st.env] === i ? ' selected' : '') + '" data-pal="' + i + '"><span class="dot" style="background:linear-gradient(135deg,' + c[0] + ',' + c[1] + ' 55%,' + c[2] + ')"></span>' + esc(p.name) + '</button>';
      }).join('') + '</div>' +
      '<div class="switch-row">' + switchHtml('data-envsw="reducedMotion"', 'Reduced motion', st.reducedMotion) + '</div>' +
      group('motion', 'Motion', rangeHtml('envSpeed', 'Animation speed', R.speed[0], R.speed[1], .05, st.speed) + rangeHtml('envMovement', 'Movement intensity', R.movement[0], R.movement[1], .05, st.movement) + rangeHtml('envColor', 'Colour transition speed', R.colorSpeed[0], R.colorSpeed[1], .05, st.colorSpeed)) +
      group('look', 'Look &amp; quality', rangeHtml('envBright', 'Brightness', R.brightness[0], R.brightness[1], .05, st.brightness) +
        '<div class="field-label">Rendering quality</div><div class="seg">' + [['auto', 'Auto'], ['smooth', 'Smooth'], ['balanced', 'Balanced'], ['high', 'High']].map(function (q) {
          return '<button type="button" class="seg-btn' + (st.quality === q[0] ? ' selected' : '') + '" data-quality="' + q[0] + '">' + q[1] + '</button>'; }).join('') + '</div>' +
        '<div class="hint">Auto picks Smooth on 2 GB boxes and High on 6 GB and above. Resolution also adjusts itself if frames run late.</div>') +
      '<div class="panel-actions"><button type="button" class="btn" id="envReset">Restore defaults</button></div>';
    var keep = $('panelBody') ? $('panelBody').scrollTop : 0;
    openPanel('ENVIRONMENTS', html);
    $('panelBody').scrollTop = keep;
    var previews = Array.prototype.map.call(document.querySelectorAll('[data-preview]'), function (c) { return { id: c.getAttribute('data-preview'), canvas: c }; });
    E.attachPreviews(previews);
    function redo() { openEnvironments(); }
    Array.prototype.forEach.call(document.querySelectorAll('details.group'), function (d) { d.addEventListener('toggle', function () { openGroups[d.getAttribute('data-group')] = d.open; openEnvironments.open = openGroups; }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-env]'), function (el) { el.addEventListener('click', function () { E.select(el.getAttribute('data-env')); caption(el.querySelector('b').textContent.toUpperCase()); redo(); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-pal]'), function (el) { el.addEventListener('click', function () { E.set('palette', +el.getAttribute('data-pal')); redo(); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-envsw]'), function (el) { el.addEventListener('click', function () { var k = el.getAttribute('data-envsw'); E.set(k, !E.settings()[k]); redo(); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-quality]'), function (el) { el.addEventListener('click', function () { E.set('quality', el.getAttribute('data-quality')); redo(); }); });
    [['envSpeed', 'speed'], ['envMovement', 'movement'], ['envColor', 'colorSpeed'], ['envBright', 'brightness']].forEach(function (m) {
      $(m[0]).addEventListener('input', function () { E.set(m[1], parseFloat($(m[0]).value)); });
    });
    $('envReset').addEventListener('click', function () { E.reset(); redo(); });
  }

  // ---- Visuals menu with favourites (★) and Play All / Play Favourites (auto-switches visuals) ----
  // favourites only ever hold scenes that still exist (a removed scene, like Molten Flag, drops out)
  function favList() { var ids = VISUALS.map(function (v) { return v[0]; }); return (pref('favVis') || '').split(',').filter(function (k) { return k && ids.indexOf(k) >= 0; }); }
  var PLAYABLE = function () { return visList().filter(function (v) { return v[0] !== 'webcams'; }).map(function (v) { return v[0]; }); };
  var fromVisuals = false, visScroll = 0;
  function backToVisuals() { if (!fromVisuals) return false; fromVisuals = false; setTimeout(function () { openVisuals(); $('panelBody').scrollTop = visScroll; }, 30); return true; }
  function openVisuals() {
    // Previews are real frames of each experience, rendered once by the Visuals engine.
    loadExperiences(function () { if (window.XP && XP.previews) XP.previews(showVisuals); else showVisuals({}); });
  }
  // Only themes the Visuals engine actually provides are listed (they arrive one by one).
  function visList() { return VISUALS.filter(function (v) { return !window.NXV || NXV.order.indexOf(v[0]) >= 0; }); }
  // Two collections: ALL (every film, played in order) and FAVOURITES (only the starred ones, in the order
  // they were starred). Tapping a video plays its collection from there; each video plays once, start to
  // end, and the next follows. REPEAT starts the collection again after its last video.
  var visView = 'all';
  function visPlaylist(view) {
    if (view === 'fav') return favList().filter(function (k) { return PLAYABLE().indexOf(k) >= 0; });
    return PLAYABLE().filter(function (k) { return k !== 'clip_mix'; });   // the mix already holds every scene
  }
  function startVisuals(list, name, label) {
    if (!list.length) return;
    closePanel(); fromVisuals = true;
    if (P.on) exitParty(true);
    stopPlaythrough();
    loadExperiences(function () { if (window.XP) XP.open(name || list[0], { list: list, label: label }); });
  }
  function showVisuals(previews) {
    var VISUALS = visList();
    var favs = favList(), last = pref('lastVis') || '', loop = pref('visLoop') !== '0';
    if (visView === 'fav' && !favs.length) visView = 'all';
    var shown = visView === 'fav' ? favs.map(function (k) { return VISUALS.filter(function (v) { return v[0] === k; })[0]; }).filter(Boolean) : VISUALS;
    var html = '<div class="vis-tabs" role="tablist">' +
        '<button type="button" class="vis-tab' + (visView === 'all' ? ' on' : '') + '" data-visview="all" role="tab" aria-selected="' + (visView === 'all') + '">ALL <i>' + VISUALS.length + '</i></button>' +
        '<button type="button" class="vis-tab' + (visView === 'fav' ? ' on' : '') + (favs.length ? '' : ' off') + '" data-visview="fav" role="tab" aria-selected="' + (visView === 'fav') + '">★ FAVOURITES <i>' + favs.length + '</i></button>' +
      '</div>' +
      '<div class="vis-grid">' + shown.map(function (v, i) {
        var on = favs.indexOf(v[0]) >= 0, img = previews && previews[v[0]];
        return '<button type="button" class="vis-card vis-' + v[0] + (v[0] === last ? ' selected' : '') + '" data-vis="' + v[0] + '" aria-label="' + esc(v[2]) + '">' +
          '<span class="vis-shot">' + (img ? '<img alt="" src="' + img + '">' : '') + '</span>' +
          '<span class="env-meta"><span class="env-num">' + (i < 9 ? '0' : '') + (i + 1) + '</span><b>' + esc(v[4] || v[2]) + '</b><small>' + esc(v[3]) + '</small></span>' +
          '<span class="fav' + (on ? ' on' : '') + '" data-fav="' + v[0] + '" role="button" aria-label="' + (on ? 'Remove from favourites' : 'Add to favourites') + '">' + (on ? '★' : '☆') + '</span></button>';
      }).join('') + '</div>' +
      '<div class="playbar">' +
        (visView === 'fav' ? '<span class="btn go" id="vPlayFav">★ PLAY FAVOURITES</span>' : '<span class="btn go" id="vPlayAll">▶ PLAY ALL</span>' + '<span class="btn' + (favs.length ? ' go' : ' off') + '" id="vPlayFav">★ PLAY FAVOURITES</span>') +
        '<span class="btn sm' + (loop ? ' go' : '') + '" id="vLoop" role="switch" aria-checked="' + loop + '">⟲ REPEAT ' + (loop ? 'ON' : 'OFF') + '</span>' +
      '</div>' +
      '<div class="hint">' + (visView === 'fav' ? 'Your favourites play in this order, each one once. Tap ★ to remove one.' : 'Tap a video to start there: each video plays once, start to end, and the next one follows. Tap ☆ to add it to Favourites.') + ' While it plays, tap the screen for controls. Music keeps playing.</div>' +
      '<div class="hint" style="opacity:.6">Film visuals by Beeple (beeple-crap.com), shared free for any use.</div>';
    var keep = $('panelBody') ? $('panelBody').scrollTop : 0;
    openPanel('VISUALS', html);
    $('panelBody').scrollTop = keep;
    Array.prototype.forEach.call(document.querySelectorAll('[data-visview]'), function (el) {
      el.addEventListener('click', function () { var v = el.getAttribute('data-visview'); if (v === 'fav' && !favList().length) return; visView = v; $('panelBody').scrollTop = 0; showVisuals(previews); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-fav]'), function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation(); var k = el.getAttribute('data-fav'), f = favList(), i = f.indexOf(k);
        if (i >= 0) f.splice(i, 1); else f.push(k);
        setPref('favVis', f.join(',')); showVisuals(previews);
      });
    });
    $('vLoop').addEventListener('click', function () { setPref('visLoop', pref('visLoop') !== '0' ? '0' : '1'); showVisuals(previews); });
    if ($('vPlayAll')) $('vPlayAll').addEventListener('click', function () { visScroll = 0; var l = visPlaylist('all'); startVisuals(l, l[0], 'ALL'); });
    $('vPlayFav').addEventListener('click', function () { var l = visPlaylist('fav'); if (!l.length) return; visScroll = 0; startVisuals(l, l[0], 'FAVOURITES'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-vis]'), function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('[data-fav]')) return;
        var n = el.getAttribute('data-vis'); setPref('lastVis', n); visScroll = $('panelBody').scrollTop;
        var l = n === 'clip_mix' && visView !== 'fav' ? ['clip_mix'] : visPlaylist(visView);
        startVisuals(l.indexOf(n) >= 0 ? l : [n], n, n === 'clip_mix' && visView !== 'fav' ? 'MIX' : visView === 'fav' ? 'FAVOURITES' : 'ALL');
      });
    });
  }
  var play = null;
  function stopPlaythrough() { if (!play) return; clearTimeout(play.t); clearTimeout(play.hint); play = null; $('xpNext').classList.add('hidden'); }
  // Smooth hand-off with NO black: freeze the last picture of the old visual on top, start the new one
  // underneath, then dissolve the old picture away.
  function xpSnapshot() {
    var cs = Array.prototype.filter.call(document.querySelectorAll('#xp canvas'), function (c) { return c.id !== 'xpSnap' && c.style.display !== 'none' && c.style.visibility !== 'hidden'; });
    var src = cs[cs.length - 1]; if (!src) return;
    var snap = $('xpSnap'); if (!snap) { snap = document.createElement('canvas'); snap.id = 'xpSnap'; $('xp').appendChild(snap); }
    snap.style.transition = 'none'; snap.style.opacity = 1;
    snap.width = Math.max(1, src.width); snap.height = Math.max(1, src.height);
    try { if (window.XP && XP.redraw) XP.redraw(); } catch (e) {}
    try { snap.getContext('2d').drawImage(src, 0, 0); } catch (e) {}
    void snap.offsetWidth;
    requestAnimationFrame(function () { requestAnimationFrame(function () { snap.style.transition = 'opacity .7s ease'; snap.style.opacity = 0; }); });
  }
  function playStep() {
    if (!play) return;
    var name = play.list[play.i % play.list.length];
    if (play.started && window.XP && XP.active) xpSnapshot();
    play.started = true;
    openExperience(name, true);
    $('xpNext').classList.remove('hidden');
    clearTimeout(play.hint);
    setTimeout(function () { if (play) { $('xpBottom').textContent = '▶ ' + play.label + ' · ' + ((play.i % play.list.length) + 1) + ' / ' + play.list.length; play.hint = setTimeout(function () { if (play) $('xpBottom').textContent = ''; }, 3000); } }, 150);
    clearTimeout(play.t);
    play.t = setTimeout(function () { if (!play) return; play.i++; playStep(); }, (play.secs || +(pref('playSecs') || 45)) * 1000);
  }
  function startPlaythrough(list, label, secs) { stopPlaythrough(); if (!list.length) return; play = { list: list, i: 0, label: label, secs: secs }; playStep(); }
  window.onXpUserClose = function () { saverOn = false; stopPlaythrough(); backToVisuals(); };
  $('xpNext').addEventListener('click', function (e) { e.stopPropagation(); if (play) { play.i++; playStep(); } });

  var xpLoaded = false;
  Nexus.openExperience = function (n) { openExperience(n); };
  var xpWaiting = [];
  function loadExperiences(done) {
    if (xpLoaded) return done();
    xpWaiting.push(done); if (xpWaiting.length > 1) return;
    // visuals.js (the Visuals themes) loads first so the experience engine can hand them off.
    function add(src, next) { var sc = document.createElement('script'); sc.src = src; sc.onload = next; sc.onerror = next; document.body.appendChild(sc); }
    add('visuals.js', function () {
      add('experiences.js', function () { xpLoaded = true; var q = xpWaiting; xpWaiting = []; q.forEach(function (f) { f(); }); });
    });
  }
  function openExperience(name, fromPlay) {
    if (P.on) exitParty(true);
    if (!fromPlay) stopPlaythrough();
    loadExperiences(function () { if (window.XP) XP.open(name); });
  }

  // ------------------------------------------------------------------
  // Android hooks
  // ------------------------------------------------------------------
  Nexus._update = function (st, progress) {
    var m = { allow: 'Allow Nexus to install updates in Android settings, return here, then tap DOWNLOAD UPDATE again.',
      searching: 'Finding the latest stable Nexus release…',
      downloading: 'Downloading the verified Nexus APK…',
      ready: 'APK verified. Press INSTALL on the screen that opened.',
      installing: 'Download checked. Opening the install screen…',
      current: 'The newest Nexus release is already installed.', busy: 'An update is already running. Give it a moment.', failed: 'The update did not finish. Check the connection and try again.' }[st] || st;
    if (st === 'progress' && isFinite(progress)) m = 'Downloading verified update… ' + Math.max(0, Math.min(100, Math.round(progress))) + '%';
    if (st === 'failed' && typeof progress === 'string' && progress) m = 'Update did not finish: ' + progress;
    caption(st === 'downloading' || st === 'progress' ? 'DOWNLOADING UPDATE…' : st === 'ready' ? 'PRESS INSTALL' : 'UPDATE');
    var el = $('sUpdateMsg'); if (el) el.textContent = m;
  };
  Nexus.back = function () { if (window.NexusCinema && NexusCinema.isOpen()) { NexusCinema.back(); return; } if (window.XP && XP.active) { stopPlaythrough(); XP.close(); backToVisuals(); return; } if (P.on) { exitParty(); return; } if (!closePanel()) { stopTalking(); } };
  Nexus.home = function () { if (window.NexusCinema) NexusCinema.close(); stopPlaythrough(); fromVisuals = false; if (P.on) exitParty(true); if (window.XP && XP.active) XP.close(); closePanel(); };
  var awaySince = 0;
  Nexus.paused = function () { stopPlaythrough(); fromVisuals = false; awaySince = Date.now(); if (window.XP && XP.active) XP.close(); try { if (A && P.on) A.partyMeter(false); } catch (e) {} };
  Nexus.resumed = function () {
    try { if (window.NexusCinema) NexusCinema._resumed(); } catch (e) {}
    // back from Android's permission screen: the Spotify exit button is now allowed
    try { var ea = $('sExitAllow'); if (ea && A && A.exitBubbleAllowed && A.exitBubbleAllowed()) { var hint = ea.nextElementSibling; if (hint) hint.textContent = 'Allowed. The exit button will show over Spotify.'; ea.remove(); } } catch (e) {}
    awaySince = 0; lastTouchAt = Date.now(); if ($('launching')) $('launching').classList.remove('on'); try { if (A && P.on) A.partyMeter(true); } catch (e) {} redraw(); tickClock(); try { if (A) A.refreshApps(); } catch (e) {} };

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  try { if (!pref('gemini_key') && window.NEXUS_DEFAULT_KEY) setPref('gemini_key', window.NEXUS_DEFAULT_KEY); } catch (e) {}
  setTimeout(precacheLines, 6000);
  envMode();
  var lastPer = 0; window.addEventListener('resize', function () { if (perPage() !== lastPer) { lastPer = perPage(); renderTiles(); } });
  renderTiles();
  if (location.hash === '#boot') { try { history.replaceState(null, '', location.pathname); } catch (e) {} runBoot(); }
  else { $('boot').classList.add('hidden'); showHome(); }
})();
