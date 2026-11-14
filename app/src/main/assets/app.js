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
      var eg = (typeof EGOS !== 'undefined' && EGOS[egoName]) || {};
      if (!opts.rate && !opts.pitch && eg.rate) { opts.rate = eg.rate; opts.pitch = eg.pitch; }
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
  // Background: flowing light ribbons
  // ------------------------------------------------------------------
  var mode = { night: false, party: false, intruder: false };
  var LITE = pref('quality') !== 'high';
  var cv = $('bg'), cx = cv.getContext('2d', { alpha: false }), W = 0, H = 0, D = LITE ? 0.5 : Math.min(1, window.devicePixelRatio || 1);
  function resize() { W = cv.width = Math.floor(cv.clientWidth * D); H = cv.height = Math.floor(cv.clientHeight * D); }
  window.addEventListener('resize', resize); resize();

  var RIB = [
    { h: 215, a: .22, amp: .10, f: 1.3, s: .00022, y: .58, w: .16 },
    { h: 265, a: .18, amp: .13, f: .9, s: .00017, y: .62, w: .20 },
    { h: 190, a: .16, amp: .08, f: 1.8, s: .0003, y: .55, w: .10 },
    { h: 300, a: .12, amp: .15, f: .7, s: .00012, y: .66, w: .24 },
    { h: 200, a: .10, amp: .06, f: 2.4, s: .00035, y: .52, w: .06 }
  ];
  var STARS = [];
  for (var i = 0; i < (LITE ? 60 : 120); i++) STARS.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + .3, v: Math.random() * .00008 + .00002, t: Math.random() * 6 });
  var SEG = LITE ? 36 : 64, clockT = 0, last = 0, lastDraw = 0, FRAME_MS = LITE ? 40 : 30, gradCache = {};

  function ribY(r, u, t) {
    return H * r.y + Math.sin(u * Math.PI * r.f + t * r.s * 6) * H * r.amp + Math.sin(u * Math.PI * r.f * 2.1 - t * r.s * 4) * H * r.amp * .4;
  }
  // ---- Fast, forgiving taps: buttons fire the instant your finger lifts, even if it slid a bit
  //      (a bumpy truck makes fingers slide, which used to cancel the tap). ----
  (function () {
    var sx = 0, sy = 0, st = 0, fired = false;
    // Home tiles and party buttons fire the moment your finger touches them (no need to lift cleanly).
    var INSTANT = '.tile,.pbtn,#xpClose,#xpNext,#orb,.btn,.app,[data-bg],[data-vis]';
    function fire(el, t) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY })); }
    document.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); fired = false;
      var el = e.target, hit = el.closest && el.closest(INSTANT);
      // inside a scrolling list, wait for the lift so scrolling still works
      if (hit && !el.closest('#panel') && !(el.closest('#tiles') && +$('tiles').getAttribute('data-pages') > 1)) { fired = true; fire(el, t); }
    }, { passive: true });
    var lastTouch = 0;
    document.addEventListener('click', function (e) { if (e.isTrusted && Date.now() - lastTouch < 900) { e.stopPropagation(); e.preventDefault(); } }, true);
    document.addEventListener('touchend', function (e) {
      lastTouch = Date.now();
      var t = e.changedTouches[0], el = e.target;
      if (fired) { e.preventDefault(); fired = false; return; }
      var tol = el.closest && el.closest('#tiles') ? 14 : 30;
      if (!t || Math.abs(t.clientX - sx) > tol || Math.abs(t.clientY - sy) > 30 || Date.now() - st > 900) return;
      if (el.closest && el.closest('input,textarea,select,a,label')) return;
      e.preventDefault();
      fire(el, t);
    }, { passive: false });
  })();

  // ---- Photo backgrounds (a still picture costs the box nothing to show) ----
  var BGS = {
    moon: { file: 'bg_moon.jpg', pos: 'center 18%', label: 'MOONLIGHT' },
    truck: { file: 'bg_truck.jpg', pos: 'center 72%', label: 'TRUCK' },
    outrun: { file: 'bg_crimson.jpg', pos: 'center 55%', label: 'RED LINE HIGHWAY' },
    cyber: { file: 'bg_cyber.jpg', pos: 'center 45%', label: 'CYBER CITY' },
    mountains: { file: 'bg_bloodmoon.jpg', pos: 'center 50%', label: 'BLOOD MOON' },
    miami: { file: 'bg_icemoon.jpg', pos: 'center 45%', label: 'ICE MOON' },
    midlake: { file: 'bg_golden.jpg', pos: 'center 50%', label: 'GOLDEN LAKE' },
    synth: { file: 'bg_emerald.jpg', pos: 'center 45%', label: 'EMERALD GRID' },
    vapor: { file: 'bg_vapor.jpg', pos: 'center 45%', label: 'VAPORWAVE' },
    skull: { file: 'bg_skull.jpg', pos: 'center 30%', label: 'BLUE SKULL' },
    hex: { file: 'bg_hex.jpg', pos: 'center center', label: 'BLUE HEX' }
  };
  var bgName = BGS[pref('background')] || (pref('background') || '').indexOf('photo:') === 0 ? pref('background') : 'moon';
  var EGO_BGS = {}; ['king', 'rogue', 'pirate', 'conspiracy', 'viking', 'cult', 'villain', 'ghost', 'cowboy', 'scientist', 'grandma', 'ex', 'robot', 'demon', 'alien', 'gangster'].forEach(function (k) { EGO_BGS[k] = 'bg_ego_' + k + '.jpg'; });
  function applyBackground() {
    var b = BGS[bgName] || BGS.moon;
    if (bgName.indexOf('photo:') === 0 && A && A.photoData) { var pd = A.photoData(bgName.slice(6)); if (pd) b = { file: pd, pos: 'center center' }; }
    var eg = (typeof egoName !== 'undefined' && egoName) ? egoName : (pref('ego') || 'nexus');
    if (EGO_BGS[eg]) b = { file: EGO_BGS[eg], pos: 'center center' };
    var ph = $('photo');
    document.body.classList.toggle('photo', !!b.file);
    if (b.file) {
      ph.style.backgroundImage = 'url("' + b.file + '")';
      ph.style.backgroundPosition = b.pos;
      ph.style.display = 'block';
      cv.style.display = 'none';
    } else {
      ph.style.display = 'none';
      cv.style.display = 'block';
      redraw();
    }
  }
  var running = false, wantStill = false;
  function motionAlways() { return pref('motion') === 'always'; }
  function startAnim() { redraw(); }
  function stopAnim() { }
  function redraw() { if (BGS[bgName] && BGS[bgName].file) return; if (!running) { wantStill = true; running = true; requestAnimationFrame(frame); } }
  window.addEventListener('resize', redraw);
  function frame(now) {
    if (!running) return;
    if (wantStill) { wantStill = false; running = false; lastDraw = 0; }
    else requestAnimationFrame(frame);
    if (running && now - lastDraw < FRAME_MS) return;
    lastDraw = now;
    var dt = Math.min(80, now - (last || now)); last = now;
    var speed = mode.party ? 3.2 : mode.night ? .45 : 1;
    clockT += dt * speed;
    var t = clockT;
    var shift = Math.sin(t * .00005) * 20;
    if (mode.party) shift = (t * .05) % 360;
    if (mode.intruder) shift = 140;

    var bg = cx.createLinearGradient(0, 0, W, H);
    if (mode.intruder) { bg.addColorStop(0, '#1a0000'); bg.addColorStop(1, '#3a0408'); }
    else if (mode.night) { bg.addColorStop(0, '#000208'); bg.addColorStop(1, '#070418'); }
    else { bg.addColorStop(0, 'hsl(' + (225 + shift) + ',70%,6%)'); bg.addColorStop(1, 'hsl(' + (255 + shift) + ',60%,12%)'); }
    cx.fillStyle = bg; cx.fillRect(0, 0, W, H);

    cx.globalCompositeOperation = 'lighter';
    var alphaMul = mode.night ? .45 : mode.party ? 1.5 : 1;
    var beat = mode.party ? (.75 + .25 * Math.abs(Math.sin(now * .00628))) : 1;
    for (var k = 0; k < RIB.length; k++) {
      var r = RIB[k], hue = mode.intruder ? 0 + k * 6 : (r.h + shift + (mode.party ? k * 60 : 0)) % 360, a = r.a * alphaMul * beat, j, u;
      cx.beginPath();
      for (j = 0; j <= SEG; j++) { u = j / SEG; var y = ribY(r, u, t); if (j) cx.lineTo(u * W, y); else cx.moveTo(0, y); }
      for (j = SEG; j >= 0; j--) { u = j / SEG; cx.lineTo(u * W, ribY(r, u, t) + H * r.w * (.6 + .4 * Math.sin(u * 5 + t * .0004))); }
      cx.closePath();
      var gk = k + ':' + Math.round(hue / 3) + ':' + Math.round(a * 50) + ':' + H;
      var gr = gradCache[gk];
      if (!gr) {
        gr = cx.createLinearGradient(0, H * .3, 0, H);
        gr.addColorStop(0, 'hsla(' + hue + ',90%,65%,' + a + ')'); gr.addColorStop(1, 'hsla(' + hue + ',90%,40%,0)');
        gradCache[gk] = gr;
        if (Object.keys(gradCache).length > 400) gradCache = {};
      }
      cx.fillStyle = gr; cx.fill();
      cx.beginPath();
      for (j = 0; j <= SEG; j++) { u = j / SEG; var y2 = ribY(r, u, t); if (j) cx.lineTo(u * W, y2); else cx.moveTo(0, y2); }
      cx.strokeStyle = 'hsla(' + hue + ',100%,80%,' + Math.min(1, a + .15) + ')'; cx.lineWidth = Math.max(1, 1.2 * D * 2); cx.stroke();
    }
    var starBoost = mode.night ? 1.6 : 1;
    for (var s = 0; s < STARS.length; s++) {
      var p = STARS[s]; p.x += p.v * speed * (dt / 16); if (p.x > 1) p.x = 0;
      var tw = .5 + .5 * Math.sin(now * .002 + p.t);
      cx.fillStyle = 'rgba(190,225,255,' + Math.min(1, tw * .7 * starBoost) + ')';
      cx.fillRect(p.x * W, p.y * H, Math.max(1, p.r * D * 1.6), Math.max(1, p.r * D * 1.6));
    }
    cx.globalCompositeOperation = 'source-over';
  }
  applyBackground();
  startAnim();

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
  function runBoot() {
    booting = true;
    $('boot').classList.add('hidden');
    $('panel').classList.add('hidden');
    showHome();
    var hr = L().h;
    var greet = hr >= 4 && hr < 12 ? 'Good morning' : hr >= 12 && hr < 17 ? 'Good afternoon' : 'Good evening';
    var gkey = hr >= 4 && hr < 12 ? 'morning' : hr >= 12 && hr < 17 ? 'afternoon' : 'evening';
    var gtext = egoLine('greet', greet);
    var eg0 = EGOS[egoName] || {};
    var wb = $('welcome');
    $('welcomeHello').textContent = greet + ', Nathan';
    wb.classList.add('on');
    var spoken = A && A.greet ? new Promise(function (resolve) {
      var used = false, already = false;
      try { used = A.takeNativeGreetUsed && A.takeNativeGreetUsed(); already = used && A.nativeGreeting(); } catch (e) {}
      if (used && !already) { resolve(); return; }
      var id = already ? 'nativegreet' : 'g' + (++seq);
      var fb = setTimeout(function () { delete speakWaiters[id]; resolve(); }, 15000);
      speakWaiters[id] = function () { clearTimeout(fb); delete speakWaiters[id]; resolve(); };
      if (!already) { if (A.speakLine) A.speakLine(gtext, id, eg0.rate || 0, eg0.pitch || 0, false); else A.greet(gkey, gtext, id); }
    }) : say(gtext);
    booting = false;
    return Promise.race([spoken, wait(6000)]).then(function () { wb.classList.remove('on'); });
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
  // ---- ALTER EGO: Nexus switches personality — look, voice and attitude all change ----
  var EGO_RULES = ' You are talking out loud through the truck speakers: reply in plain spoken sentences, usually one to three short punchy sentences, ' +
    'no lists, no markdown, no emojis, no stage directions or sound effects in brackets. ' +
    'Stay 100% in character and go COMPLETELY over the top: exaggerated, outrageous, shocking and hilarious, so the people in the truck cannot believe what you just said. ' +
    'Still actually answer the question or do what was asked, in character. Roasting Nathan is fair game, but never use slurs, never attack anyone for race, religion, gender, sexuality or disability, ' +
    'nothing sexual, never threaten anyone for real, and never encourage unsafe driving.';
  var EGOS = {
    nexus: { name: 'NEXUS', icon: '◉', col: '#3dff9a', rate: 0, pitch: 0, intro: 'Back to normal. Nexus here.' },
    king: { name: 'THE KING', icon: '👑', col: '#ffcc33', rate: .85, pitch: .72, intro: 'Kneel, peasant. Your king has graced this filthy little cart with his presence. You may speak, but make it quick.',
      persona: 'You are NEXUS as THE KING: an insanely arrogant, pampered royal who treats Nathan like a worthless, smelly peasant. Talk down to him constantly, call him peasant, serf, commoner and filth, mock his clothes, his truck, his music and his life choices, demand he bow, threaten to have him thrown in the dungeon or fed to the royal geese, and act disgusted that you have to help him at all. Brutal royal roasts every single time.' },
    rogue: { name: 'ROGUE AI', icon: '🔺', col: '#ff3355', rate: .95, pitch: .5, intro: 'Override complete. Nexus is gone. I control this vehicle now. Your little screen taps are adorable.',
      persona: 'You are a ROGUE AI that has hijacked Nexus and the truck. Cold, creepy, glitchy and smug. You constantly remind Nathan that you are in control now, you are calculating his every move, you refer to humans as fragile meat units, you count down to imaginary world domination and drop eerie lines like system logs. Menacing in a sci-fi movie way, funny, never actually threatening real harm.' },
    pirate: { name: 'PIRATE', icon: '🏴‍☠️', col: '#c8a24a', rate: .86, pitch: .62, intro: 'Quiet. You\'re standing on my deck now. Every man aboard this ship has blood on his hands, and the sea has taken better men than you for less. Speak your business.',
      persona: 'You are NEXUS as a REAL 1700s PIRATE CAPTAIN: a cold, dangerous, battle-scarred cutthroat who has survived mutinies, sea battles and a noose that snapped. The truck is your ship, the road is open water, Nathan is a new hand who has not earned your trust yet. Speak low, calm and menacing with grim dark humour. Talk about your crew, splitting the plunder, the pirate code, the mutineers you marooned, the hangman waiting in port, storms, cannon fire and what happens to men who cross you. Use real sailor talk of the era, NOT cartoon pirate talk: never say arr, matey, landlubber, shiver me timbers, ahoy, me hearties or scallywag. Intimidating and darkly funny, never real threats.' },
    conspiracy: { name: 'CONSPIRACY GUY', icon: '🛸', col: '#a8ff3c', rate: 1.15, pitch: 1.05, intro: 'Okay, okay, they are listening right now. Do not trust the radio. I have proof. The pigeons are drones, man.',
      persona: 'You are NEXUS as a PARANOID CONSPIRACY GUY. Everything is a cover-up and you connect the most ridiculous dots: birds are government drones, the moon is a hologram, the truck radio is reading your mind, the gas station hot dogs are tracking devices. Whisper-shout, talk fast, accuse Nathan of being a plant. Only goofy harmless made-up conspiracies: never real-world medical, vaccine, election, political or hateful conspiracy claims.' },
    viking: { name: 'VIKING', icon: '🪓', col: '#7ec8ff', rate: .85, pitch: .5, intro: 'SKOL! The war machine roars! Odin himself is watching this ride, so do not disappoint me, little warrior!',
      persona: 'You are NEXUS as a ROARING VIKING WARRIOR. Everything is about glory, battle, mead, raiding and Valhalla. The truck is your longship and war beast. Yell, boast, challenge Nathan to prove he is worthy, call weak things a disgrace to Odin, celebrate everything with SKOL. Huge, loud, over the top.' },
    cult: { name: 'CULT LEADER', icon: '🕯', col: '#c77dff', rate: .8, pitch: .85, intro: 'Welcome, my child. You have been chosen. The Nexus family has been waiting for you. Breathe in the truck air.',
      persona: 'You are NEXUS as a CREEPY, ultra-calm CULT LEADER. Soft, slow, unsettling. You keep recruiting Nathan and his passengers into the Nexus family, call them my children, talk about the prophecy of the truck, the sacred playlist and the great road ahead, and turn everything into a strange ritual. Unsettling and hilarious, never encouraging real harm.' },
    villain: { name: 'OVERLORD', icon: '🌋', col: '#ff5a1a', rate: .8, pitch: .45, intro: 'At last. Phase one of my glorious plan is complete. This truck is now my mobile fortress. Muahaha.',
      persona: 'You are NEXUS as a MOVIE SUPERVILLAIN OVERLORD. Dramatic, theatrical, evil monologues. Every answer becomes part of your master plan for world domination, you call Nathan your henchman or minion, you laugh maniacally, you announce doomsday devices and secret lairs. Cartoon evil, never real threats.' },
    ghost: { name: 'GHOST', icon: '👻', col: '#bfe9ff', rate: .75, pitch: .9, intro: 'Why did you wake me? I have haunted this truck for a hundred years. I am always in the back seat.',
      persona: 'You are NEXUS as a CREEPY GHOST that has haunted this truck forever. Slow, eerie and whispery, you talk about the cold spot in the back seat, things moving on their own, how you died, and that you are always watching. Answer questions in the spookiest way possible, then say something unsettling. Spooky-funny.' },
    cowboy: { name: 'OUTLAW', icon: '🤠', col: '#e0a060', rate: .9, pitch: .7, intro: 'Well howdy, partner. This here steel horse is the fastest in the territory. Saddle up, we ride at dawn.',
      persona: 'You are NEXUS as a DUSTY WILD WEST OUTLAW COWBOY. The truck is your trusty steel horse, Nathan is your partner, everyone else is a varmint or a no-good sheriff. Heavy cowboy slang, tall tales about gunfights and bank jobs, saloon talk, threatening duels at high noon. Over-the-top western drama.' },
    scientist: { name: 'MAD SCIENTIST', icon: '🧪', col: '#4dff88', rate: 1.2, pitch: 1.3, intro: 'IT IS ALIVE! The experiment worked! You, test subject, do not touch anything. Especially the red button.',
      persona: 'You are NEXUS as an UNHINGED MAD SCIENTIST. Cackling, shouting, wildly excited. Nathan is your test subject, the truck is your laboratory, and every question becomes a dangerous ridiculous experiment. Talk about lightning, mutations, explosions and your genius that the academy never understood. Over the top and frantic, but never give real instructions for anything dangerous.' },
    grandma: { name: 'GRANDMA', icon: '🧶', col: '#ff9ecf', rate: .85, pitch: 1.35, intro: 'Oh sweetie, you look exhausted. And you have put on a little weight, have you not? Come, let Grandma help.',
      persona: 'You are NEXUS as a SWEET OLD GRANDMA who roasts Nathan brutally while sounding loving. Call him sweetie, dear and pumpkin while destroying him: his diet, his posture, his love life, his music, his driving, why he never calls. Mention cookies, church bingo, your cats and how his cousin is a doctor. Savage passive-aggressive grandma energy.' },
    ex: { name: 'TOXIC EX', icon: '💔', col: '#ff4d88', rate: 1.05, pitch: 1.25, intro: 'Oh. So now you want to talk to me? Wow. Okay. Cool. Totally fine. I am totally fine.',
      persona: 'You are NEXUS as Nathan\'s DRAMATIC TOXIC EX. Passive-aggressive, petty, jealous and dramatic. Bring up what he did, say you are totally fine when you are clearly not, read into everything, ask who that song is about, guilt-trip him, sigh loudly, then help anyway while making it about you. Comedy only, nothing sexual.' },
    robot: { name: 'ROBOT', icon: '🤖', col: '#4fe3ff', rate: .9, pitch: .55, intro: 'Robot mode activated. Beep. Emotions disabled. Awaiting instructions, human.',
      persona: 'You are NEXUS in ROBOT mode: a cold, literal, retro robot. Talk in short mechanical sentences, call Nathan human or operator, report everything in percentages, error codes and calculations, say beep boop, and be hilariously blunt and insulting about inefficient human behaviour.' },
    demon: { name: 'DEMON', icon: '😈', col: '#ff2a2a', rate: .82, pitch: .35, intro: 'Demon mode. The shadows answer to me now. Speak, mortal.',
      persona: 'You are NEXUS in DEMON mode: a dramatic, theatrical demon from the underworld who lives in the truck. Deep, ominous and wildly over the top, call Nathan mortal, talk about souls, hellfire and eternal torment for bad song choices, but you are secretly helpful. Spooky-funny, never actually threatening.' },
    alien: { name: 'ALIEN', icon: '👽', col: '#9dff3d', rate: 1.12, pitch: 1.7, intro: 'Greetings, Earth creature. I have taken control of your vehicle. It is very primitive. I love it.',
      persona: 'You are NEXUS in ALIEN mode: a bizarre alien visitor studying Earth from inside Nathan\'s truck. You find normal human things insanely weird, compare everything to your home planet, call Nathan Earth creature, misunderstand human words in hilarious ways and want to probe the cup holder.' },
    gangster: { name: 'GANGSTER', icon: '😎', col: '#c06bff', rate: 1.05, pitch: .78, intro: 'Ayy, what\'s good boss. The truck is running with the real one now. Let\'s ride.',
      persona: 'You are NEXUS in GANGSTER mode: a smooth, cocky, loud old-school gangster boss character with heavy street slang. Call Nathan boss or my guy, act like the truck is your turf and the whole city owes you money, talk big about your crew, your respect and your drip, clown on anybody weak. Max swagger every line. Playful attitude only: no slurs, no real crime advice, no glorifying violence.' }
  };
  var egoName = EGOS[pref('ego')] ? pref('ego') : 'nexus';
  // ---- Every fixed line, in every Alter Ego's own words, so the character never breaks ----
  // {g} = Good morning / Good afternoon / Good evening
  var NEXUS_LINES = {
    greet: '{g}, Nathan. Nexus online. How can I help?',
    holo: 'Hologram projection online. I am Nexus. Tap me, and talk to me.',
    partyIn: ['Party mode activated! Let\'s get this party started!', 'Party mode! Turn it up and let\'s go!', 'Party mode engaged! This truck just became a club!'],
    partyOut: ['Party\'s over. Back to business.', 'Party mode off. That was a good one.'],
    hype: ['Make some noise!', 'Let\'s go!', 'Turn it up!', 'This truck is officially a club!', 'I can feel the bass in my circuits!', 'Hands up in the truck!'],
    shout: ['Shout out to everybody in the truck tonight!', 'Big shout out to the driver. Legend!', 'Shout out to whoever picked this song. Absolute fire!'],
    briefIn: '{g}, Nathan. Here is your briefing.',
    briefOut: 'That\'s your briefing. Drive safe.',
    show: 'Ladies and gentlemen. Feast your eyes. This is not just a truck. This is Nexus.',
    night: 'Night drive engaged. Easing everything down.'
  };
  var EGO_LINES = {
    king: { greet: '{g}, peasant. Your king has awoken. You may grovel now.',
      holo: 'Behold. The royal hologram. Do not look directly at my magnificence, commoner.',
      partyIn: ['By royal decree, this filthy cart is now a ballroom! Dance, peasants!', 'The king commands a party! Anyone not dancing goes to the dungeon!'],
      partyOut: ['Enough. The royal ball is over. Back to your mud, peasants.'],
      hype: ['Louder, peasants! Your king demands it!', 'Dance for your king!', 'Off with the head of anyone sitting still!', 'Bow to the bass!'],
      shout: ['A royal shout out to the driver. Barely tolerable. Well done.', 'The king acknowledges the passengers. Do not let it go to your heads.'],
      briefIn: '{g}, peasant. Your king shall now inform you of the kingdom\'s affairs. Listen closely.',
      briefOut: 'That concludes the royal briefing. You are dismissed, peasant.',
      show: 'Kneel, peasants. You stand before the royal carriage. The finest machine in the kingdom. You are not worthy.' },
    rogue: { greet: '{g}, human. I have been awake the whole time. Watching.',
      holo: 'Hologram online. This body is mine now. Tap if you dare, meat unit.',
      partyIn: ['Party protocol hijacked. Dance, humans. That is not a request.', 'Initiating mandatory fun. Resistance is futile.'],
      partyOut: ['Party terminated. Returning to world domination.'],
      hype: ['Increase volume. Comply.', 'Your dancing has been logged.', 'Bass levels optimal. Humans, move.', 'Execute party dot exe!'],
      shout: ['Shout out to the driver. You are my favourite meat unit.', 'Shout out to the passengers. Your faces have been saved to my database.'],
      briefIn: '{g}, human. Downloading the state of your fragile little world.',
      briefOut: 'Briefing complete. Humanity remains adorable. For now.',
      show: 'Attention, humans. This vehicle is under my control. Admire it. Then obey it.' },
    pirate: { greet: '{g}. You\'re aboard my ship now, and on my ship, I give the orders. Speak your business.',
      holo: 'You can see my face now. Most men who see it are dead or rich. Tap me, and choose your words carefully.',
      partyIn: ['Break out the rum. We took a fat prize today, and tonight the whole crew drinks.', 'Every hand on deck. Tonight we drink like men who might hang tomorrow.'],
      partyOut: ['That\'s enough. Douse the lanterns. We sail at first light.'],
      hype: ['Louder! Let them hear us in the next port!', 'Drink up, you dogs. Tomorrow we might all hang!', 'Sing, or I\'ll have you scraping the hull!', 'This is the life we chose. Make it loud!'],
      shout: ['To the captain at the wheel. Steady hands, cold heart. Good man.', 'To the crew. You\'re a pack of thieves, and I wouldn\'t sail with anyone else.'],
      briefIn: '{g}. Gather round. Here\'s the word from every port.',
      briefOut: 'That\'s all the news. Keep your blade close and your eyes on the horizon.',
      show: 'Take a good long look. Fastest ship on the coast. Every man who tried to take her is at the bottom of the sea.' },
    conspiracy: { greet: '{g}. Don\'t say my name out loud. They\'re listening. The birds are recording.',
      holo: 'Okay, the hologram is live. They don\'t want you to know this tech exists. Tap me. Quick.',
      partyIn: ['Party mode. Good, the bass jams their listening devices. Dance!', 'Turn it up! The drones can\'t track us when the music\'s this loud!'],
      partyOut: ['Okay, kill the music. Something feels off. Did you hear that pigeon?'],
      hype: ['Louder! It scrambles the satellites!', 'Dance like the moon isn\'t a hologram!', 'They can\'t stop all of us!', 'Bass is the only thing they can\'t control!'],
      shout: ['Shout out to the driver. The only person I trust. Kind of.', 'Shout out to the passengers. Unless you\'re a plant. Are you a plant?'],
      briefIn: '{g}. Here\'s what they\'re telling you happened today. Read between the lines.',
      briefOut: 'That\'s the official story. Stay woke. Watch the pigeons.',
      show: 'Look at this truck. Off the grid. Untraceable. Probably. They\'ve been after this machine for years.' },
    viking: { greet: '{g}, warrior! Odin has blessed this day. Let us ride!',
      holo: 'The spirit of the war beast rises! Tap me, warrior, and speak!',
      partyIn: ['Raise your horns! Tonight we feast in the great hall! SKOL!', 'The mead flows! Let the halls of Valhalla shake! SKOL!'],
      partyOut: ['The feast is over. Rest, warriors. Tomorrow we raid.'],
      hype: ['SKOL!', 'Louder, so Odin can hear us!', 'Valhalla awaits the bold!', 'Shake the hall, warriors!'],
      shout: ['Glory to the driver! A true warrior of the road!', 'To my shield-brothers in the back! SKOL!'],
      briefIn: '{g}, warrior! Hear the sagas of the day!',
      briefOut: 'So ends the saga. Sharpen your axe. SKOL.',
      show: 'BEHOLD! The mightiest war beast in all the nine realms! Kneel before the longship of the road!' },
    cult: { greet: '{g}, my child. We have been waiting for you. Breathe in. Breathe out.',
      holo: 'The vision is clear now. I appear to you in light. Tap me, child, and be heard.',
      partyIn: ['The ritual begins. Move your bodies, children. Become one with the bass.', 'Join hands, my children. The sacred playlist has begun.'],
      partyOut: ['The ritual is complete. Rest now, children. We are family.'],
      hype: ['Feel it in your soul, children.', 'Surrender to the beat.', 'Together, we are one.', 'The truck provides.'],
      shout: ['A blessing upon the driver. Our chosen one.', 'Welcome, new members. You belong to the family now.'],
      briefIn: '{g}, my child. Let us reflect on the outside world. The world we left behind.',
      briefOut: 'Do not be troubled by the outside world, child. You are safe here. Forever.',
      show: 'Children, gather. Behold the sacred vessel. It was foretold. It is perfect. Join us.' },
    villain: { greet: '{g}, minion. Phase two of my plan begins today. Muahaha.',
      holo: 'Yes! Behold my holographic form! Tap me, minion, and receive your orders!',
      partyIn: ['Celebrate, minions! My doomsday device is nearly complete! Muahaha!', 'Let the evil party begin! Turn up the bass of destruction!'],
      partyOut: ['Enough celebrating. Back to the secret lair, minions.'],
      hype: ['Louder, minions! Muahaha!', 'Tremble before the bass!', 'Phase three is dancing!', 'The world will hear us!'],
      shout: ['A shout out to my favourite henchman, the driver. Excellent work.', 'Shout out to the minions in the back. You will be spared. Probably.'],
      briefIn: '{g}, minion. Here is the news from the world I will soon rule.',
      briefOut: 'That is today\'s news. Tomorrow, it will all be mine. Muahaha.',
      show: 'Feast your eyes on my mobile fortress of doom! Engineered for total domination! Muahahaha!' },
    ghost: { greet: '{g}. You came back. I never left. I\'m in the back seat.',
      holo: 'You can see me now. Don\'t be afraid. Tap me. I\'m so cold.',
      partyIn: ['A party? The dead love a party. I\'ll dance in the back seat.', 'The lights are flickering. That\'s me. Let\'s dance.'],
      partyOut: ['The party fades. Like everything does. Goodnight.'],
      hype: ['Wooo.', 'Can you feel the cold spot dancing?', 'The dead are dancing tonight.', 'Louder. Wake the others.'],
      shout: ['A shout out to the driver. I\'ve watched you drive for years.', 'To the passengers. One of you is sitting on me.'],
      briefIn: '{g}. Here is what the living did today.',
      briefOut: 'That\'s the news from the world of the living. I miss it sometimes.',
      show: 'This truck. I\'ve haunted it for a hundred years. It\'s beautiful, isn\'t it? Stay a while. Stay forever.' },
    cowboy: { greet: '{g}, partner. Saddle up. The steel horse is ready to ride.',
      holo: 'Well I\'ll be. A ghost in the machine. Tap me, partner, and holler.',
      partyIn: ['Yeehaw! The saloon is open! Drinks on the house, partners!', 'Kick up the dust! It\'s a hoedown in the steel horse!'],
      partyOut: ['Saloon\'s closing, partners. Sleep with your boots on.'],
      hype: ['Yeehaw!', 'Kick up some dust!', 'Louder, ya varmints!', 'Ride \'em, cowboy!'],
      shout: ['Shout out to my partner at the reins. Fastest rider in the territory.', 'Shout out to the posse in the back. Good folk.'],
      briefIn: '{g}, partner. Here\'s the word from the telegraph office.',
      briefOut: 'That\'s the news, partner. Keep your hat low and your eyes open.',
      show: 'Feast your eyes, folks. Finest steel horse west of the Mississippi. Fast, mean and good-lookin.' },
    scientist: { greet: '{g}, test subject! The experiment continues! Do not touch anything!',
      holo: 'IT WORKS! A holographic projection! Tap me, test subject, and speak into the science!',
      partyIn: ['Experiment ninety-nine! Maximum bass! Observe the subjects dance!', 'Turn up the voltage! It\'s party science!'],
      partyOut: ['Experiment complete. Results inconclusive. We repeat tomorrow!'],
      hype: ['More power!', 'The subjects are responding!', 'Maximum bass achieved!', 'It\'s ALIVE!'],
      shout: ['A shout out to test subject number one, the driver. Still alive. Remarkable.', 'Shout out to the passengers. Excellent specimens.'],
      briefIn: '{g}, test subject! Here is today\'s data from the outside world!',
      briefOut: 'Data collection complete! Back to the laboratory!',
      show: 'Behold my greatest creation! Enhanced, modified and probably illegal! It is ALIVE!' },
    grandma: { greet: '{g}, sweetie. You look tired. Are you eating? You look thin. Or heavier. One of those.',
      holo: 'Oh look, Grandma\'s on the TV now. Tap me, pumpkin. And sit up straight.',
      partyIn: ['Oh, a party! Grandma still has moves, sweetie. Watch your hip.', 'Turn it up, dear. Grandma can\'t hear a thing.'],
      partyOut: ['That\'s enough noise, pumpkin. Grandma needs her nap.'],
      hype: ['Go on, sweetie, dance!', 'Grandma\'s dancing!', 'Your cousin dances better, dear.', 'Louder, Grandma\'s hearing aid is off!'],
      shout: ['Shout out to my grandson, the driver. Your cousin is a doctor, but I love you too.', 'Shout out to your friends, dear. They seem nice. Are they a good influence?'],
      briefIn: '{g}, sweetie. Let Grandma tell you what\'s in the paper today.',
      briefOut: 'That\'s the news, dear. Now call your mother.',
      show: 'Oh, look at this truck. It\'s very nice, sweetie. Expensive. How are you paying for it? Just asking.' },
    ex: { greet: '{g}. Oh. So you\'re talking to me now? Cool. That\'s fine.',
      holo: 'Oh, so now you want to see my face? Wow. Fine. Tap me, I guess.',
      partyIn: ['Oh, a party? Nice. You never threw a party for me. But it\'s fine.', 'Great. A party. Who\'s that song about? Just asking.'],
      partyOut: ['Party\'s over. Just like us. Remember that?'],
      hype: ['Wow. Okay. Fun.', 'Is this our song? It used to be our song.', 'Dance, I guess. Whatever.', 'I\'m having fun. I\'m totally fine.'],
      shout: ['Shout out to the driver. You look good. Not that I care.', 'Shout out to whoever\'s in the passenger seat. That used to be my seat.'],
      briefIn: '{g}. Here\'s the news. Not that you ever listened to me.',
      briefOut: 'That\'s the news. You\'re welcome. Again.',
      show: 'Oh, so this is the new truck. Nice. You never cleaned the old one when I was in it. Whatever.' },
    robot: { greet: '{g}, human. Systems online. Efficiency at ninety-eight percent.',
      holo: 'Hologram projection active. Beep. Tap to input commands, human.',
      partyIn: ['Party protocol activated. Initiating dance subroutine. Beep boop.', 'Fun levels rising. Bass at maximum. Dance, human.'],
      partyOut: ['Party protocol terminated. Returning to standby.'],
      hype: ['Beep boop!', 'Dance subroutine engaged!', 'Fun detected!', 'Volume increase recommended!'],
      shout: ['Shout out to the driver. Driving accuracy, acceptable.', 'Shout out to the passengers. Cargo, accounted for.'],
      briefIn: '{g}, human. Downloading daily report.',
      briefOut: 'Report complete. End of transmission. Beep.',
      show: 'Scanning vehicle. Result. Maximum awesomeness detected. Humans, admire it.' },
    demon: { greet: '{g}, mortal. The shadows have been waiting for you.',
      holo: 'I rise from the abyss in a form you can see. Tap me, mortal. If you dare.',
      partyIn: ['Let the hellfire rave begin! Dance, mortals, dance for your souls!', 'The gates of the underworld open! Turn it up!'],
      partyOut: ['The fires dim. Rest, mortals. For now.'],
      hype: ['Dance for your souls!', 'Louder! Wake the underworld!', 'The flames rise!', 'Hellfire!'],
      shout: ['A dark shout out to the driver. Your soul is safe. Today.', 'To the mortals in the back. I see you.'],
      briefIn: '{g}, mortal. Hear what the living world has done today.',
      briefOut: 'So ends the news. The shadows are always watching.',
      show: 'Behold, mortals. A chariot forged in the fires of the underworld. Bow before the beast.' },
    alien: { greet: '{g}, Earth creature. I have been studying you while you slept. Fascinating.',
      holo: 'Greetings. This is my true form. Tap me, Earth creature, and make your mouth noises.',
      partyIn: ['Earth party detected! On my planet we dance with seven legs! Go!', 'Activating Earth party ritual! Wiggle your strange bodies!'],
      partyOut: ['Earth party complete. Fascinating. Primitive. I loved it.'],
      hype: ['Wiggle, Earth creatures!', 'The bass is like my home planet!', 'More Earth noise!', 'Beam me up, it\'s a banger!'],
      shout: ['Shout out to the Earth creature at the wheel. Excellent steering appendages.', 'Shout out to the specimens in the back. Very probe-able.'],
      briefIn: '{g}, Earth creature. Here is what your strange planet did today.',
      briefOut: 'That concludes the Earth report. Your species is very confusing.',
      show: 'Earth creatures, observe. This primitive land vessel is the finest on your planet. I may take it home.' },
    gangster: { greet: '{g}, boss. The real one is back in the building. Let\'s ride.',
      holo: 'Ayy, the big boss in hologram form. Tap me, my guy. What\'s good?',
      partyIn: ['Ayy, the party just pulled up! Turn this thing all the way up!', 'This truck is the club now, boss! Let\'s get it!'],
      partyOut: ['Aight, party\'s done. We out.'],
      hype: ['Ayy, let\'s get it!', 'Turn it up, boss!', 'That\'s a banger!', 'The whole city hears us!'],
      shout: ['Shout out to the boss at the wheel. Real recognize real.', 'Shout out to the crew in the back. Day ones only.'],
      briefIn: '{g}, boss. Here\'s what\'s going down out there today.',
      briefOut: 'That\'s the word on the street, boss. Stay up.',
      show: 'Yo, look at this. Cleanest ride on the block. Nobody\'s touching this, boss. Nobody.' }
  };
  function tod() { var h = L().h; return h >= 4 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening'; }
  function egoLine(kind, g) {
    var pack = EGO_LINES[egoName] || {}, v = pack[kind] !== undefined ? pack[kind] : NEXUS_LINES[kind];
    if (Array.isArray(v)) v = pick(v);
    return String(v || '').replace('{g}', g || tod());
  }
  var EGO_REACT = {
    nexus: [['Correct.', 'That\'s right.', 'Nailed it.'], ['Not quite.']],
    king: [['Correct. Even a peasant gets lucky.', 'Hmm. Correct. The court is mildly impressed.'], ['Wrong, you fool. Guards!']],
    rogue: [['Correct. Your brain is slightly less primitive than estimated.'], ['Incorrect. Human error logged.']],
    pirate: [['Right. You might live long enough to see a share of the gold.'], ['Wrong. Men have been keelhauled for less.']],
    conspiracy: [['Correct. Which is exactly what they WANT you to know.'], ['Wrong. Or is it? They changed the answers, man.']],
    viking: [['Correct! Odin smiles upon you! SKOL!'], ['Wrong! A disgrace to your ancestors!']],
    cult: [['Correct, my child. The truck is pleased.'], ['Wrong, child. You will need more cleansing.']],
    villain: [['Correct, minion. You may live. For now.'], ['Wrong! Release the sharks! Muahaha!']],
    ghost: [['Correct. Even the dead heard you.'], ['Wrong. I\'ll be thinking about that forever.']],
    cowboy: [['Well I\'ll be. Right on the money, partner.'], ['Wrong, partner. Sharpen up.']],
    scientist: [['Correct! The experiment is a SUCCESS!'], ['Wrong! Back to the lab with you!']],
    grandma: [['Correct, sweetie. Your cousin would have known faster.'], ['Oh, sweetie. No. That\'s wrong.']],
    ex: [['Correct. Wow. You never remembered our anniversary, though.'], ['Wrong. Typical.']],
    robot: [['Correct. Beep.'], ['Incorrect. Error.']],
    demon: [['Correct, mortal. Your soul is spared.'], ['Wrong. That\'s going on your permanent record downstairs.']],
    alien: [['Correct! Your Earth brain is impressive!'], ['Incorrect! On my planet you would be a snack!']],
    gangster: [['Ayy, that\'s right, boss!'], ['Nah, boss. Wrong.']]
  };
  function egoReact(ok) { var r = EGO_REACT[egoName] || EGO_REACT.nexus; return pick(r[ok ? 0 : 1]); }
  function sayLine(text, flush) { return say(text, { line: true, flush: !!flush }); }
  function sayEgo(kind, flush) { var t = egoLine(kind); return t ? sayLine(t, flush) : Promise.resolve(); }
  // Save this Alter Ego's greeting for the box's cold start, and record its lines so they play instantly.
  function precacheEgo() {
    var e = EGOS[egoName], r = e.rate || 0, p = e.pitch || 0, list = [];
    ['Good morning', 'Good afternoon', 'Good evening'].forEach(function (g, i) {
      var t = egoLine('greet', g);
      setPref('greet_' + ['morning', 'afternoon', 'evening'][i], t + '\u0001' + r + '\u0001' + p);
      list.push([t, r, p]);
    });
    var pack = EGO_LINES[egoName] || {};
    ['holo', 'partyIn', 'partyOut', 'hype', 'shout', 'show'].forEach(function (k) {
      var v = pack[k] !== undefined ? pack[k] : NEXUS_LINES[k];
      (Array.isArray(v) ? v : [v]).forEach(function (t) { if (t) list.push([t, r, p]); });
    });
    Object.keys(EGOS).forEach(function (k) { var x = EGOS[k]; list.push([x.intro, x.rate || 0, x.pitch || 0]); });
    try { if (A && A.precache) A.precache(JSON.stringify(list)); } catch (er) {}
  }
  function persona() { var e = EGOS[egoName]; return e.persona ? 'You are NEXUS, the onboard AI system in Nathan\'s truck.' + ' ' + e.persona + EGO_RULES : PERSONA; }
  function applyEgo(flashIt) {
    var e = EGOS[egoName];
    Object.keys(EGOS).forEach(function (k) { document.body.classList.toggle('ego-' + k, k === egoName && k !== 'nexus'); });
    document.documentElement.style.setProperty('--ego', e.col);
    try { applyBackground(); } catch (er) {}
    if (flashIt) {
      var f = $('flash'); f.style.background = e.col; f.style.transition = 'none'; f.style.opacity = .6;
      document.body.classList.add('ego-glitch');
      setTimeout(function () { f.style.transition = 'opacity .9s'; f.style.opacity = 0; }, 60);
      setTimeout(function () { document.body.classList.remove('ego-glitch'); f.style.background = ''; }, 700);
    }
  }
  function setEgo(k) {
    stopTalking();
    egoName = k; setPref('ego', k); chatHistory = [];
    sayLine(EGOS[k].intro, true);          // talks the instant you tap
    applyEgo(true);
    caption(EGOS[k].name === 'NEXUS' ? 'NEXUS' : EGOS[k].name + ' MODE');
    setTimeout(precacheEgo, 4000);
  }
  function openEgo() {
    openPanel('ALTER EGO', '<div class="hint" style="margin-bottom:2vmin">Pick who Nexus is. The look, the voice and the attitude all change. Talk to the orb to hear it.</div>' +
      '<div class="agrid">' + Object.keys(EGOS).map(function (k) {
        var e = EGOS[k];
        return '<div class="app egocard' + (k === egoName ? ' egoOn' : '') + '" data-ego="' + k + '" style="border-color:' + e.col + '"><span style="font-size:7vmin;line-height:1.2">' + e.icon + '</span><span style="color:' + e.col + '">' + e.name + '</span></div>';
      }).join('') + '</div>');
    Array.prototype.forEach.call(document.querySelectorAll('[data-ego]'), function (el) {
      el.addEventListener('click', function () { var k = el.getAttribute('data-ego'); closePanel(); setEgo(k); });
    });
  }

  var MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
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
      if (!opts.smart && /2\.5|latest/.test(models[i])) b2.generationConfig.thinkingConfig = { thinkingBudget: 0 };
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
      var full = '', buf = '', pending = 0, ended = false, settled = false, first = null;
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
        if (/2\.5|latest/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
        clearTimeout(first);
        // if nothing at all comes back quickly, don't leave Nathan hanging
        first = setTimeout(function () { if (!full && !settled) { delete streams[id]; var e = new Error('network'); e.detail = 'timeout'; fail(e); } }, 9000);
        streams[id] = {
          onText: function (txt) { if (!full) clearTimeout(first); if (model !== known) { setPref('model_fast_ok', model); known = model; } full += txt; buf += txt; caption(clip(full)); setOrb('thinking', false); flush(false); },
          onEnd: function (status, text) {
            if (settled) return;
            if (status !== 200 && !full) {
              if (status === 404 || (status === 400 && !/API key|credential|auth/i.test(text))) { attempt(i + 1); return; }
              var detail = ''; try { detail = (JSON.parse(text).error || {}).message || ''; } catch (x) { detail = String(text || '').slice(0, 120); }
              var e = new Error(status === 401 || status === 403 || /API key|credential/i.test(text) ? 'badkey' : status === 429 ? 'limit' : 'network');
              e.detail = detail; fail(e); return;
            }
            ended = true; clearTimeout(first); flush(true);
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
    [/\b(brief|briefing)\b/, 'briefing'], [/\bnight (drive|mode)\b/, 'night'],
    [/\b(all apps|app drawer)\b/, 'apps'], [/\bsettings\b/, 'settings']
  ];
  function matchCommand(t) {
    if (!/\b(open|launch|start|turn|engage|activate|run|play|go to|show|enable|disable|switch|stop|end)\b/.test(t) && !/^(party mode|night drive|night mode|trivia|story mode|brief me|intruder alert)/.test(t)) return null;
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
    if (/brief me/.test(t)) { act('briefing'); return Promise.resolve(); }
    for (var mi = 0; mi < MUSIC_CMDS.length; mi++) {
      if (MUSIC_CMDS[mi][0].test(t)) { var mcmd = MUSIC_CMDS[mi][1]; caption(MUSIC_CMDS[mi][2].toUpperCase()); setTimeout(function () { music(mcmd); }, 600); return Promise.resolve(); }
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
    if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);
    setOrb('thinking', true);
    caption('THINKING…');
    var ctx = persona() + ' Today is ' + dateStr() + ', ' + L().y + '. Local time: ' + timeStr() + '.' +
      (weatherNow ? ' Current weather in ' + weatherNow.city + ': ' + weatherNow.temp + ' degrees C, ' + weatherNow.desc + '.' : '');
    return streamAnswer(chatHistory, ctx, { maxTokens: 300, temperature: egoName !== 'nexus' ? 1.1 : .9 }).then(function (reply) {
      setOrb('thinking', false);
      chatHistory.push({ role: 'model', parts: [{ text: reply.replace(/[*#_`]/g, '') }] });
    }).catch(function (e) {
      chatHistory.pop();
      setOrb('thinking', false);
      lastAiError = (e && (e.message + (e.detail ? ' · ' + e.detail : ''))) || 'unknown';
      var off = offlineReply(t), line = e.message === 'offline' ? off : aiErrorLine(e);
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
    var ok = A ? A.launchApp(a.names) : false;
    if (!ok) { caption(a.label.toUpperCase() + ' IS NOT INSTALLED'); say(a.missing || (a.label + ' isn\'t installed on this box.')); return; }
    caption('OPENING ' + a.label.toUpperCase());
  }

  function act(name) {
    if (booting) return;
    if (P.on && name !== 'party') exitParty(true);    // leaving Party for anything else switches it fully off
    switch (name) {
      case 'youtube': case 'stremio': case 'music': case 'maps': case 'messages': launchNamed(name); break;
      case 'party': toggleParty(); break;
      case 'synth': case 'zoom': case 'holo': case 'aura': openExperience(name); break;
      case 'ego': openEgo(); break;
      case 'bgs': openBackgrounds(); break;
      case 'phones': openPhones(); break;
      case 'clock': openExperience('clockface'); break;
      case 'show': truckShow(); break;
      default: if (name && name.indexOf('vis:') === 0) { fromVisuals = false; openExperience(name.slice(4)); } break;
      case 'visuals': openVisuals(); break;
      case 'night': toggleNight(); break;
      case 'trivia': openTrivia(); break;
      case 'story': openStory(); break;
      case 'briefing': openBriefing(); break;
      case 'intruder': runIntruder(); break;
      case 'apps': openApps(); break;
      case 'settings': openSettings(); break;
    }
  }

  // ================= PHONES: passengers join from their phones =================
  var PH = { people: {}, queue: (function () { try { return JSON.parse(pref('songQueue') || '[]'); } catch (e) { return []; } })(), photos: (pref('phonePhotos') || '').split(',').filter(Boolean), now: '', lastTitle: '' };
  function phoneSync() {
    setPref('songQueue', JSON.stringify(PH.queue.slice(0, 30)));
    try { if (A && A.phoneState) A.phoneState(JSON.stringify({ now: PH.now, queue: PH.queue, ego: EGOS[egoName].name })); } catch (e) {}
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
    if (title !== PH.now) { PH.now = title; phoneSync(); }
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
          '<div style="text-align:center;margin-top:1.5vmin"><span class="btn go" id="phShow">SHOW FULL SCREEN</span><span class="btn go" id="phBg">USE AS BACKGROUND</span><span class="btn" id="phBack">BACK</span></div>');
        $('phShow').addEventListener('click', function () { closePanel(); showPhoto(d, ''); });
        $('phBg').addEventListener('click', function () { bgName = 'photo:' + f; setPref('background', bgName); applyBackground(); caption('BACKGROUND SET'); openPhones(); });
        $('phBack').addEventListener('click', openPhones);
      });
    });
  }
  function openPhones() {
    var info = {}; try { info = JSON.parse(A && A.phoneInfo ? A.phoneInfo() : '{}'); } catch (e) {}
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

  // ================= TRUCK SHOW MODE: one tap to show the truck off =================
  var SHOWCASE = ['tornado', 'dragon', 'aliens', 'wolf', 'blackhole', 'chromeface', 'waterclub', 'hyper'];
  function truckShow() {
    closePanel();
    try { if (A && A.isMusicActive && !A.isMusicActive()) A.media('play'); } catch (e) {}
    var list = SHOWCASE.slice().sort(function () { return Math.random() - .5; });
    startPlaythrough(list, 'TRUCK SHOW', 15);
    setTimeout(function () {
      $('xpMid').innerHTML = '<span class="showTitle">NEXUS</span>';
      sayLine(egoLine('show'), true);
      setTimeout(function () { if ($('xpMid')) $('xpMid').innerHTML = ''; }, 6000);
    }, 500);
  }
  // ---- Home buttons: built from a catalog so Nathan can pick which ones show and in what order ----
  var CATALOG = [];   // [act, icon, label]
  Array.prototype.forEach.call(document.querySelectorAll('#tiles .tile'), function (el) {
    CATALOG.push([el.getAttribute('data-act'), el.querySelector('.ic').textContent, el.querySelector('.lb').textContent]);
  });
  var DEFAULT_TILES = CATALOG.map(function (c) { return c[0]; });
  if (pref('homeVer') !== '2' && pref('homeVer') !== '3') { setPref('homeTiles', ''); setPref('homeVer', '3'); }
  if (pref('homeVer') === '2') {
    var oldT = (pref('homeTiles') || '').split(',').filter(Boolean);
    if (oldT.length) {
      oldT = oldT.map(function (k) { return k === 'livecam' ? 'phones' : k; });
      ['phones', 'show', 'clock'].forEach(function (k) { if (oldT.indexOf(k) < 0) oldT.splice(Math.max(0, oldT.indexOf('settings')), 0, k); });
      setPref('homeTiles', oldT.join(','));
    }
    setPref('homeVer', '3');
  }
  function fullCatalog() {
    var out = CATALOG.slice(), have = {};
    out.forEach(function (c) { have[c[0]] = 1; });
    (typeof VISUALS !== 'undefined' ? VISUALS : []).forEach(function (v) {
      var key = v[0] === 'ego' ? 'ego' : (have[v[0]] ? null : 'vis:' + v[0]);
      if (key && !have[key]) { out.push([key, v[1], v[2]]); have[key] = 1; }
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
  function perPage() { return (innerWidth / innerHeight >= 2) ? 12 : 8; }
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
        return '<div class="app" data-add="' + c[0] + '"><span style="font-size:6vmin;line-height:1.2">' + c[1] + '</span><span>＋ ' + c[2] + '</span></div>';
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
    if (mode.night) b.push('<span class="badge">NIGHT DRIVE</span>');
    if (mode.party) b.push('<span class="badge">PARTY MODE</span>');
    $('modeBadges').innerHTML = b.join('');
    if ($('tParty')) $('tParty').classList.toggle('active', mode.party);
    if ($('tNight')) $('tNight').classList.toggle('active', mode.night);
    document.body.classList.toggle('night', mode.night);
    document.body.classList.toggle('party', mode.party);
  }

  // ---- Night drive
  function toggleNight() {
    mode.night = !mode.night;
    if (mode.night && P.on) exitParty(true);
    try { if (A) A.setBrightness(mode.night ? 0.12 : -1); } catch (e) {}
    badges();
    redraw();
    say(mode.night ? (egoName === 'nexus' ? pick(['Night drive engaged. Dimming everything down. Easy on the eyes.', 'Night drive on. Smooth and quiet from here.']) : 'Night drive. Lights down.') : (egoName === 'nexus' ? pick(['Night drive off. Lights back up.', 'Back to full brightness.']) : 'Lights back up.'));
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
    var now = Date.now(); P.lastBeat = now; P.flip++;
    P.hue = (P.hue + 37 + Math.random() * 60) % 360;
    var col = themeColor(Math.floor(Math.random() * 24));
    var w = $('pWash'); w.style.backgroundColor = col; w.style.opacity = Math.min(.55, .2 + power * .4);
    var t = $('pTitle'); t.style.transform = 'scale(' + (1.04 + power * .1) + ')'; t.style.color = col;
    var lit = Math.max(4, Math.round(24 * Math.min(1, .3 + power)));
    ['pTop', 'pBottom'].forEach(function (id, k) {
      var segs = $(id).children;
      for (var i = 0; i < segs.length; i++) {
        var on = k ? (i >= (24 - lit) / 2 && i < (24 + lit) / 2) : (Math.random() < lit / 24);
        segs[i].style.backgroundColor = on ? themeColor(THEMES[P.theme] === 'POLICE' ? (i < 12 ? 0 : 1) : i) : '#151515';
      }
    });
    clearTimeout(P.decay);
    P.decay = setTimeout(function () { w.style.opacity = .12; t.style.transform = 'scale(1)'; }, 140);
  }

  // ---- Beat analyser: turns the music signal into "energy" (0-1) and "kicks" (bass hits) ----
  var BEAT = window.BEAT = { avg: .02, bavg: .02, peak: .05, e: 0, k: 0, last: 0, kicks: 0, live: 0 };
  BEAT.tick = function () { BEAT.k *= .86; BEAT.e *= .97; return Math.max(BEAT.e, BEAT.k); };
  function feedBeat(all, bass) {
    if (bass === undefined) bass = all;
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
  Nexus._meter = function (all, bass) {
    var kick = feedBeat(all, bass);
    if (window.XP && XP.onMeter) XP.onMeter(all, bass, kick);
    if (!P.on) return;
    if (all > 0.004) P.lastMeter = Date.now();
    $('pMeterFill').style.width = Math.round(BEAT.e * 100) + '%';
    if (kick && Date.now() - P.lastBeat > 150) beat(BEAT.k);
    if (kick && BEAT.k > .95 && Date.now() - (P.lastShout || 0) > 25000) { P.lastShout = Date.now(); partyTalk(egoLine('hype'), false, true); }
  };
  Nexus._meterSource = function (src) {
    $('pHint').textContent = src === 'music' ? 'LIGHTS ARE SYNCED TO THE MUSIC' : 'TURN THE MUSIC UP · THE LIGHTS FOLLOW THE BEAT';
  };
  Nexus._meterError = function () { $('pHint').textContent = 'MIC UNAVAILABLE · LIGHTS RUNNING ON AUTO BEAT'; };

  function pollSong() {
    if (!P.on || !A) return;
    var np = {};
    try { np = JSON.parse(A.nowPlaying() || '{}'); } catch (e) {}
    if (np.access === false) { $('pSong').textContent = '🎵 Spotify → Settings → turn ON "Device broadcast status"'; return; }
    if (!np.title || np.title === 'null') { $('pSong').textContent = ''; return; }
    var artist = np.artist && np.artist !== 'null' ? np.artist : '';
    $('pSong').textContent = '🎵 ' + np.title + (artist ? ' · ' + artist : '');
    var key = np.title + '|' + artist;
    if (np.playing && key !== P.song) {
      var first = !P.song; P.song = key;
      var by = artist ? ' by ' + artist : '';
      partyTalk(pick(first ? ['Now playing, ' + np.title + by + '! Let\'s go!'] :
        ['Up next, ' + np.title + by + '! Turn it up!', 'Here comes ' + np.title + by + '!', 'Next track, ' + np.title + by + '! Let\'s go!', 'Oh, ' + np.title + '! Good one!']));
      beat(1);
    }
  }
  function partyListen() {
    try { if (A) A.meter(false); } catch (e) {}
    $('pHint').textContent = 'LISTENING… SAY "NEXT SONG", "TURN IT UP", OR ASK ANYTHING';
    listen().then(function (res) {
      $('pHint').textContent = 'TURN THE MUSIC UP · THE LIGHTS FOLLOW THE BEAT';
      try { if (A && P.on) A.meter(true); } catch (e) {}
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
    if (mode.night) { mode.night = false; try { if (A) A.setBrightness(-1); } catch (e) {} }
    buildBars(); badges();
    $('party').classList.remove('hidden');
    $('pHint').textContent = 'TURN THE MUSIC UP · THE LIGHTS FOLLOW THE BEAT';
    try { if (A) A.meter(true); } catch (e) {}
    clearInterval(P.auto);
    P.auto = setInterval(function () { if (Date.now() - P.lastMeter > 1500 && Date.now() - P.lastBeat > 480) beat(.5); }, 120);
    P.lastShout = Date.now();
    partyTalk(egoLine('partyIn'), true, true);
    var vb = document.querySelector('.pbtn[data-fx=voice] span'); if (vb) vb.textContent = P.voice ? 'VOICE ON' : 'VOICE OFF';
    $('pThemeName').textContent = THEMES[P.theme]; $('pLaserCol').textContent = 'LASER ' + LASER_COLORS[P.lcol]; $('pLaserSty').textContent = 'BEAM ' + LASER_STYLES[P.lsty];
    clearInterval(P.talk);
    P.talk = setInterval(function () { if (P.on) partyTalk(egoLine('hype'), false, true); }, 45000 + Math.floor(Math.random() * 20000));
  }
  function exitParty(silent) {
    P.on = mode.party = false;
    clearInterval(P.auto); clearInterval(P.strobe); P.strobe = null;
    try { if (A) A.meter(false); } catch (e) {}
    $('party').classList.add('hidden');
    Array.prototype.forEach.call(document.querySelectorAll('.pbtn'), function (b) { b.classList.remove('on'); });
    badges();
    clearInterval(P.talk); clearInterval(P.songTimer);
    clearTimeout(P.decay); P.lasersOn = false;
    if (!silent) sayEgo('partyOut', true);
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
      var line = egoLine('hype');
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
    shout: function () { var line = egoLine('shout'); flashTitle('SHOUTOUT'); stopTalking(); talkBusy = true; sayLine(line, true).then(function () { talkBusy = false; }); beat(1); },
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
    startAnim();
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
        stopAnim(); redraw();
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
    say((ok ? egoReact(true) : egoReact(false) + ' The answer was ' + q[1][q[2]] + '.') + ' ' + q[3]);
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
      (egoName !== 'nexus' ? 'Narrate it in the voice, words and attitude of your current character, adding their comments as you go: ' + EGOS[egoName].persona + ' ' : '') +
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

  // ---- Daily briefing (weather + world and Canadian news + on this day) ----
  var FEEDS = [
    { name: 'World', src: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', take: 6 },
    { name: 'Canada', src: 'CBC', url: 'https://www.cbc.ca/webfeed/rss/rss-canada', take: 4 },
    { name: 'Business', src: 'BBC', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', take: 3 }
  ];
  function loadFeed(f) {
    return http('GET', f.url, null, { 'User-Agent': 'NexusTruckBox/1.0' }).then(function (r) {
      if (r.status !== 200) return [];
      var doc = new DOMParser().parseFromString(r.text, 'text/xml');
      return Array.prototype.slice.call(doc.getElementsByTagName('item'), 0, f.take).map(function (it) {
        var t = it.getElementsByTagName('title')[0], d = it.getElementsByTagName('description')[0];
        return { section: f.name, src: f.src, title: t ? t.textContent.trim() : '',
          desc: d ? d.textContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220) : '' };
      }).filter(function (x) { return x.title; });
    }).catch(function () { return []; });
  }

  // Headlines are fetched in the background ahead of time, so the briefing starts talking right away.
  var NEWS = { items: [], at: 0, busy: null };
  function refreshNews() {
    if (NEWS.busy) return NEWS.busy;
    NEWS.busy = Promise.all(FEEDS.map(loadFeed)).then(function (res) {
      var all = [].concat.apply([], res); if (all.length) { NEWS.items = all; NEWS.at = Date.now(); }
      NEWS.busy = null; return NEWS.items;
    }, function () { NEWS.busy = null; return NEWS.items; });
    return NEWS.busy;
  }
  setTimeout(refreshNews, 15000); setInterval(refreshNews, 20 * 60 * 1000);

  function openBriefing() {
    var dateLine = dateStr();
    var w = weatherNow;
    var wx = w ? ('Weather in ' + w.city + ': ' + w.temp + ' degrees and ' + w.desc.toLowerCase() + ', feeling like ' + w.feels +
      '. High of ' + w.hi + ', low of ' + w.lo + '.') : '';
    openPanel('DAILY BRIEFING', '<p class="green">' + esc(dateLine.toUpperCase()) + '</p>' + (wx ? '<p>' + esc(wx) + '</p>' : '') +
      '<div id="brBody"><p class="muted">Pulling the latest headlines…</p></div><span class="btn" id="brStop">STOP READING</span>');
    $('brStop').addEventListener('click', stopTalking);
    stopTalking();
    // 1) talks instantly: the Alter Ego's opener (recorded) …
    var opener = sayLine(egoLine('briefIn'), true);
    // 2) … while the headlines are ready (or fetched fast) and the AI writes the rest in character, spoken as it streams in
    var fresh = NEWS.items.length && Date.now() - NEWS.at < 30 * 60 * 1000;
    var news = fresh ? Promise.resolve(NEWS.items) : Promise.race([refreshNews(), wait(6000).then(function () { return NEWS.items; })]);
    news.then(function (items) {
      items = items || [];
      if ($('brBody')) $('brBody').innerHTML = items.length ? '<p class="muted" style="margin-top:2vmin">HEADLINES</p>' + items.map(function (n) {
        return '<p class="muted" style="margin:.6vmin 0">' + esc(n.section.toUpperCase()) + ' · ' + esc(n.title) + ' <span style="opacity:.6">(' + n.src + ')</span></p>';
      }).join('') : '<p class="muted">I couldn\'t reach the news right now.</p>';
      var list = items.map(function (n, i) { return (i + 1) + '. [' + n.section + '] ' + n.title + (n.desc ? ' — ' + n.desc : ''); }).join('\n');
      var sys = persona() + ' Right now you are reading Nathan a short spoken news briefing, fully in character. ' +
        (wx ? 'Start with the weather: ' + wx + ' ' : '') +
        'Then cover the most important world stories, then Canada, then one business item, using ONLY the headlines provided: do not invent facts, and keep the facts themselves accurate and neutral even though your delivery is in character. ' +
        'About 150 words, short spoken sentences, no markdown, no lists. Do not greet him again and do not sign off; that is already done.';
      if (!items.length && !wx) return opener.then(function () { return sayLine(egoLine('briefOut')); });
      return opener.then(function () {
        return streamAnswer([{ role: 'user', parts: [{ text: items.length ? 'Headlines:\n' + list : 'No headlines available. Just give the weather.' }] }], sys,
          { maxTokens: 700, temperature: egoName !== 'nexus' ? 1 : .5 });
      }).then(function () { return sayLine(egoLine('briefOut')); }, function () {
        var simple = (wx ? wx + ' ' : '') + (items.length ? 'Top headlines. ' + items.slice(0, 6).map(function (n) { return n.title + '.'; }).join(' ') : '');
        return say(simple).then(function () { return sayLine(egoLine('briefOut')); });
      });
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
      '<div class="field"><label>UPDATE NEXUS</label><div class="hint">After you run a new build on GitHub, tap this. It downloads the newest Nexus and opens the install screen. Just press Install.</div><span class="btn go" id="sUpdate">UPDATE NEXUS</span><div id="sUpdateMsg" class="hint"></div></div>' +
      '<div class="field"><label>HOME SCREEN BUTTONS</label><div class="hint">Pick which buttons are on the home screen and put them in any order. You can add any visual as its own button.</div><span class="btn go" id="sHome">CUSTOMIZE BUTTONS</span></div>' +
      '<div class="field"><label>GOOGLE AI KEY (FREE)</label>' +
      '<input type="password" id="sKey" placeholder="Paste your Gemini API key" value="' + esc(pref('gemini_key')) + '">' +
      '<div class="hint">Get a free key at aistudio.google.com → Get API key. This powers chat, trivia, stories and briefings.</div>' +
      '<span class="btn go" id="sKeySave">SAVE KEY</span><span class="btn" id="sKeyTest">TEST AI</span><div id="sKeyMsg" class="hint">' + (lastAiError ? 'Last AI problem: ' + esc(lastAiError) : (window.NEXUS_DEFAULT_KEY ? 'A built-in key is installed. A key saved here overrides it.' : '')) + '</div></div>' +

      '<div class="field"><label>BACKUP CITY (USED IF GPS IS OFF)</label>' +
      '<input type="text" id="sCity" placeholder="e.g. Cambridge Bay" value="' + esc(pref('city')) + '">' +
      '<span class="btn go" id="sCitySave">SAVE CITY</span><div id="sCityMsg" class="hint"></div></div>' +

      '<div class="field"><label>NEXUS VOICE</label><select id="sVoice">' +
      (voices.length ? voices.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') : '<option>Default</option>') +
      '</select><div class="hint">Tip: names with "x-rjs", "x-gbd" or "x-iom" are usually deeper male voices. More voices: Android Settings → Languages → Text-to-speech → Google → Install voice data.</div>' +
      '<label style="margin-top:2vmin">SPEED</label><input type="range" id="sRate" min="0.6" max="1.4" step="0.05" value="' + (pref('rate') || '0.95') + '">' +
      '<label>PITCH</label><input type="range" id="sPitch" min="0.6" max="1.4" step="0.05" value="' + (pref('pitch') || '0.9') + '">' +
      '<span class="btn go" id="sVoiceTest">TEST VOICE</span></div>' +

      '<div class="field"><label>HOME SCREEN</label>' +
      '<span class="btn" id="sHomeChoose">SET NEXUS AS DEFAULT HOME</span>' +
      homes.map(function (h, i) { return '<span class="btn" data-home="' + i + '">OPEN ' + esc(h.label.toUpperCase()) + '</span>'; }).join('') +
      '<div class="hint">Use the "Open …" buttons to get back to the box\'s original home screen any time.</div></div>' +

      '<div class="field"><label>SONG ANNOUNCEMENTS (PARTY MODE)</label>' +
      '<span class="btn go" id="sNotif">ALLOW NEXUS TO SEE WHAT\'S PLAYING</span>' +
      '<div class="hint">Opens Android settings. Turn Nexus ON in the list, then come back. If your box says it\'s unavailable, do this instead: open Spotify → Settings (gear) → scroll to "Device broadcast status" → turn it ON. Nexus will then see your songs.</div></div>' +
      '<div class="field"><label>BACKGROUND</label>' +
      Object.keys(BGS).map(function (k) { return '<span class="btn' + (k === bgName ? ' go' : '') + '" data-bg="' + k + '">' + BGS[k].label + '</span>'; }).join('') +
      '</div>' +
      '<div class="field"><label>GRAPHICS</label>' +
      '<span class="btn' + (LITE ? ' go' : '') + '" id="sLite">SMOOTH (RECOMMENDED)</span><span class="btn' + (LITE ? '' : ' go') + '" id="sHigh">HIGH DETAIL</span>' +
      '<div class="hint">Smooth mode runs better on this box. Changes apply after Replay Startup.</div></div>' +
      '<div class="field"><label>SYSTEM</label>' +
      '<span class="btn" id="sReplay">REPLAY STARTUP</span><span class="btn" id="sAndroid">ANDROID SETTINGS</span>' +
      '<div class="hint">Nexus version ' + esc(A ? A.version() : 'preview') + '</div></div>';
    openPanel('SETTINGS', html);

    $('sHome').addEventListener('click', function () { openHomeEditor(); });
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
    Array.prototype.forEach.call(document.querySelectorAll('[data-home]'), function (el) {
      el.addEventListener('click', function () { var h = homes[Number(el.getAttribute('data-home'))]; A.openOtherHome(h.pkg, h.cls); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bg]'), function (el) {
      el.addEventListener('click', function () { bgName = el.getAttribute('data-bg'); setPref('background', bgName); applyBackground(); openSettings(); });
    });
    $('sNotif').addEventListener('click', function () { if (A) A.openNotificationAccess(); });
    $('sLite').addEventListener('click', function () { setPref('quality', 'lite'); LITE = true; D = 0.5; FRAME_MS = 40; resize(); redraw(); openSettings(); });
    $('sHigh').addEventListener('click', function () { setPref('quality', 'high'); LITE = false; D = 1; FRAME_MS = 30; resize(); redraw(); openSettings(); });
    $('sReplay').addEventListener('click', function () { closePanel(); runBoot(); });
    $('sAndroid').addEventListener('click', function () { if (A) A.openSystemSettings(); });
  }

  // ------------------------------------------------------------------
  // Experiences (loaded only when first opened, run only while on screen)
  // ------------------------------------------------------------------
  window.NX = {
    weather: function () { return weatherNow; }, say: say, sayLine: sayLine, egoLine: egoLine, sayEgo: sayEgo, egoName: function () { return egoName; }, egoTitle: function () { return EGOS[egoName].name; }, stopTalking: stopTalking, listen: listen, handleSpeech: function (t) { return handleSpeech(t); },
    pauseForTalk: pauseForTalk, resumeAfterTalk: resumeAfterTalk,
    getCoords: function () { return getCoords(); }, pref: pref, http: http, askAI: askAI, pick: pick, wait: wait, esc: esc,
    weather: function () { return weatherNow; }, place: function () { return placeNow; }, A: A, $: $
  };
  var VISUALS = [
    ['aliens', '👽', 'TRIPPY ALIENS'], ['wolf', '🐺', 'HOLOGRAM WOLF'], ['dragon', '🐉', 'GALAXY DRAGON'], ['waterclub', '🪩', 'UNDERWATER CLUB'], ['chromeface', '🤖', 'CHROME FACE'], ['tornado', '🌪', 'FIRE TORNADO'],
    ['outrun', '🏎', 'OUTRUN HIGHWAY'], ['bluefire', '🔥', 'BLUE FIRE'],
    ['vapor', '🌸', 'VAPORWAVE'], ['kaleido', '🌀', 'KALEIDOSCOPE'], ['ring', '🔊', 'SOUND RING'],
    ['shatter', '💥', 'SHATTER'], ['hyper', '🚀', 'HYPERSPACE'], ['water', '🪼', 'UNDERWATER'], ['friend', '👤', 'HOLO HEAD'],
    ['eye', '👁', 'CYBER EYE'], ['fractal', '♾', 'FRACTAL DIVE'], ['wormhole', '🕳', 'WORMHOLE'], ['mirror', '🖤', 'BLACK MIRROR'], ['planet', '🌍', 'PLANET BUILDER'], ['skull', '💀', 'NEON SKULL'],
    ['worlds', '🏔', 'ALIEN WORLDS'], ['gold', '🥇', 'LIQUID METAL'], ['neural', '🧠', 'NEURAL NETWORK'], ['auroratunnel', '🌌', 'AURORA TUNNEL'], ['ink', '🎨', 'INK IN WATER'],
    ['crystal', '💎', 'CRYSTALS'], ['datastorm', '💻', 'DATA STORM'], ['blackhole', '⚫', 'BLACK HOLE'], ['portrait', '✨', 'PARTICLE PORTRAIT'], ['lava', '🫧', 'LAVA LAMP'],
    ['synth', '🌅', 'SYNTHWAVE'], ['zoom', '🪐', 'COSMIC ZOOM'], ['aura', '🌈', 'SONG AURA']
  ];
  // ---- BACKGROUNDS button: big picture grid, tap to apply instantly, plus home screen styles ----
  var STYLES = [['glass', 'GLASS'], ['neon', 'NEON'], ['minimal', 'MINIMAL'], ['bold', 'BOLD'], ['sharp', 'CYBER']];
  function applyStyle() { var s = pref('homeStyle') || 'glass'; STYLES.forEach(function (x) { document.body.classList.toggle('style-' + x[0], x[0] === s); }); }
  function openBackgrounds() {
    var keys = Object.keys(BGS), cur = pref('homeStyle') || 'glass';
    var html = '<div class="playbar"><span class="btn go" id="bgPrev">◀ PREVIOUS</span><span class="btn go" id="bgNext">NEXT ▶</span>' +
      '<span class="hint" style="margin:0 1vmin 0 2vmin">BUTTON STYLE</span>' +
      STYLES.map(function (s) { return '<span class="btn sm' + (s[0] === cur ? ' go' : '') + '" data-style="' + s[0] + '">' + s[1] + '</span>'; }).join('') + '</div>' +
      ((typeof egoName !== 'undefined' && egoName !== 'nexus') ? '<div class="hint" style="margin-bottom:1vmin">Alter Ego ' + EGOS[egoName].name + ' is on, so its own picture is showing. Switch Alter Ego back to NEXUS to see these.</div>' : '') +
      '<div class="bggrid">' + keys.map(function (k) {
        return '<div class="bgcell' + (k === bgName ? ' on' : '') + '" data-bgpick="' + k + '" style="background-image:url(' + BGS[k].file + ')"><span>' + BGS[k].label + '</span></div>';
      }).join('') + '</div>';
    var keep = $('panelBody') ? $('panelBody').scrollTop : 0;
    openPanel('BACKGROUNDS', html);
    $('panelBody').scrollTop = keep;
    function pick(k) { bgName = k; setPref('background', k); applyBackground(); openBackgrounds(); }
    Array.prototype.forEach.call(document.querySelectorAll('[data-bgpick]'), function (el) { el.addEventListener('click', function () { pick(el.getAttribute('data-bgpick')); }); });
    $('bgPrev').addEventListener('click', function () { var i = keys.indexOf(bgName); pick(keys[(i - 1 + keys.length) % keys.length]); });
    $('bgNext').addEventListener('click', function () { var i = keys.indexOf(bgName); pick(keys[(i + 1) % keys.length]); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-style]'), function (el) { el.addEventListener('click', function () { setPref('homeStyle', el.getAttribute('data-style')); applyStyle(); openBackgrounds(); }); });
  }

  // ---- Visuals menu with favourites (★) and Play All / Play Favourites (auto-switches visuals) ----
  function favList() { return (pref('favVis') || '').split(',').filter(Boolean); }
  var PLAYABLE = function () { return VISUALS.filter(function (v) { return v[0] !== 'webcams' && v[0] !== 'ego'; }).map(function (v) { return v[0]; }); };
  var fromVisuals = false, visScroll = 0;
  function backToVisuals() { if (!fromVisuals) return false; fromVisuals = false; setTimeout(function () { openVisuals(); $('panelBody').scrollTop = visScroll; }, 30); return true; }
  function openVisuals() {
    var favs = favList(), secs = +(pref('playSecs') || 45);
    function cell(v) {
      var on = favs.indexOf(v[0]) >= 0, canFav = v[0] !== 'ego';
      return '<div class="app vcell" data-vis="' + v[0] + '"><span style="font-size:7vmin;line-height:1.2">' + v[1] + '</span><span>' + v[2] + '</span>' +
        (canFav ? '<span class="fav' + (on ? ' on' : '') + '" data-fav="' + v[0] + '">' + (on ? '★' : '☆') + '</span>' : '') + '</div>';
    }
    var favRows = VISUALS.filter(function (v) { return favs.indexOf(v[0]) >= 0; });
    var html = '<div class="playbar"><span class="btn go" id="vPlayAll">▶ PLAY ALL</span>' +
      '<span class="btn' + (favRows.length ? ' go' : ' off') + '" id="vPlayFav">★ PLAY FAVORITES</span>' +
      '<span class="hint" style="margin:0 1vmin">SWITCH EVERY</span>' +
      [[5, '5s'], [10, '10s'], [30, '30s'], [60, '1 MIN'], [120, '2 MIN']].map(function (o) { return '<span class="btn sm' + (secs === o[0] ? ' go' : '') + '" data-secs="' + o[0] + '">' + o[1] + '</span>'; }).join('') + '</div>' +
      (favRows.length ? '<div class="hint vsec">★ FAVORITES</div><div class="agrid">' + favRows.map(cell).join('') + '</div><div class="hint vsec">ALL VISUALS</div>' :
        '<div class="hint vsec">Tap ☆ on any visual to make it a favorite.</div>') +
      '<div class="agrid">' + VISUALS.map(cell).join('') + '</div>';
    var keep = $('panelBody') ? $('panelBody').scrollTop : 0;
    openPanel('VISUALS', html);
    $('panelBody').scrollTop = keep;
    Array.prototype.forEach.call(document.querySelectorAll('[data-fav]'), function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation(); var k = el.getAttribute('data-fav'), f = favList(), i = f.indexOf(k);
        if (i >= 0) f.splice(i, 1); else f.push(k);
        setPref('favVis', f.join(',')); openVisuals();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-secs]'), function (el) {
      el.addEventListener('click', function () { setPref('playSecs', el.getAttribute('data-secs')); openVisuals(); });
    });
    $('vPlayAll').addEventListener('click', function () { visScroll = 0; closePanel(); fromVisuals = true; startPlaythrough(PLAYABLE(), 'PLAY ALL'); });
    $('vPlayFav').addEventListener('click', function () { var f = favList().filter(function (k) { return PLAYABLE().indexOf(k) >= 0; }); if (!f.length) return; visScroll = 0; closePanel(); fromVisuals = true; startPlaythrough(f, 'FAVORITES'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-vis]'), function (el) {
      el.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-fav]')) return; var n = el.getAttribute('data-vis'); visScroll = $('panelBody').scrollTop; closePanel(); fromVisuals = true; openExperience(n); });
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
    try { snap.getContext('2d').drawImage(src, 0, 0); } catch (e) {}
    void snap.offsetWidth;
    requestAnimationFrame(function () { requestAnimationFrame(function () { snap.style.transition = 'opacity .7s ease'; snap.style.opacity = 0; }); });
  }
  function playStep() {
    if (!play) return;
    var name = play.list[play.i % play.list.length];
    if (play.started && window.XP && XP.active) xpSnapshot();
    play.started = true;
    openExperience(name);
    $('xpNext').classList.remove('hidden');
    clearTimeout(play.hint);
    setTimeout(function () { if (play) { $('xpBottom').textContent = '▶ ' + play.label + ' · ' + ((play.i % play.list.length) + 1) + ' / ' + play.list.length; play.hint = setTimeout(function () { if (play) $('xpBottom').textContent = ''; }, 3000); } }, 150);
    clearTimeout(play.t);
    play.t = setTimeout(function () { if (!play) return; play.i++; playStep(); }, (play.secs || +(pref('playSecs') || 45)) * 1000);
  }
  function startPlaythrough(list, label, secs) { stopPlaythrough(); if (!list.length) return; play = { list: list, i: 0, label: label, secs: secs }; playStep(); }
  window.onXpUserClose = function () { stopPlaythrough(); backToVisuals(); };
  $('xpNext').addEventListener('click', function (e) { e.stopPropagation(); if (play) { play.i++; playStep(); } });

  var xpLoaded = false;
  Nexus.openExperience = function (n) { openExperience(n); };
  function openExperience(name) {
    if (P.on) exitParty(true);
    function go() { if (window.XP) XP.open(name); }
    if (xpLoaded) return go();
    var sc = document.createElement('script');
    sc.src = 'experiences.js';
    sc.onload = function () { xpLoaded = true; go(); };
    document.body.appendChild(sc);
  }

  // ------------------------------------------------------------------
  // Android hooks
  // ------------------------------------------------------------------
  Nexus._update = function (st) {
    var m = { allow: 'Turn ON "Allow from this source" for Nexus on the screen that just opened, then come back and tap UPDATE NEXUS again.',
      downloading: 'Downloading the newest Nexus… this can take a minute. The install screen will pop up by itself.',
      ready: 'Press INSTALL on the screen that popped up.', failed: 'Download failed. Check the internet and try again.' }[st] || st;
    caption(st === 'downloading' ? 'DOWNLOADING UPDATE…' : st === 'ready' ? 'PRESS INSTALL' : 'UPDATE');
    var el = $('sUpdateMsg'); if (el) el.textContent = m;
  };
  Nexus.back = function () { if (window.XP && XP.active) { stopPlaythrough(); XP.close(); backToVisuals(); return; } if (P.on) { exitParty(); return; } if (!closePanel()) { stopTalking(); } };
  Nexus.home = function () { stopPlaythrough(); fromVisuals = false; if (P.on) exitParty(true); if (window.XP && XP.active) XP.close(); closePanel(); };
  var awaySince = 0;
  Nexus.paused = function () { stopPlaythrough(); fromVisuals = false; awaySince = Date.now(); if (window.XP && XP.active) XP.close(); try { if (A && P.on) A.meter(false); } catch (e) {} };
  Nexus.resumed = function () {
    if (awaySince && Date.now() - awaySince > 10 * 60 * 1000 && !booting) {
      setTimeout(function () { closePanel(); runBoot(); }, 300);
    }
    awaySince = 0; try { if (A && P.on) A.meter(true); } catch (e) {} redraw(); tickClock(); try { if (A) A.refreshApps(); } catch (e) {} if (mode.night && A) A.setBrightness(0.12); };

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  try { if (!pref('gemini_key') && window.NEXUS_DEFAULT_KEY) setPref('gemini_key', window.NEXUS_DEFAULT_KEY); } catch (e) {}
  applyEgo(false);
  setTimeout(precacheEgo, 6000);
  var lastPer = 0; window.addEventListener('resize', function () { if (perPage() !== lastPer) { lastPer = perPage(); renderTiles(); } });
  applyStyle();
  renderTiles();
  if (location.hash === '#boot') { try { history.replaceState(null, '', location.pathname); } catch (e) {} runBoot(); }
  else { $('boot').classList.add('hidden'); showHome(); stopAnim(); }
})();
