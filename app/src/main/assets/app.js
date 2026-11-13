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

  function pref(k) { try { return A ? A.getPref(k) : (localStorage.getItem('p_' + k) || ''); } catch (e) { return ''; } }
  function setPref(k, v) { try { if (A) A.setPref(k, v); else localStorage.setItem('p_' + k, v); } catch (e) {} }

  function say(text) {
    return new Promise(function (resolve) {
      var id = 's' + (++seq);
      var fallback = setTimeout(function () { done(); }, 2500 + text.length * 90);
      function done() { clearTimeout(fallback); delete speakWaiters[id]; setOrb('speaking', false); resolve(); }
      speakWaiters[id] = done;
      setOrb('speaking', true);
      if (A) { A.speak(text, id); }
      else if (window.speechSynthesis) {
        var u = new SpeechSynthesisUtterance(text); u.rate = .95; u.pitch = .9;
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
  var running = false, wantStill = false;
  function motionAlways() { return pref('motion') === 'always'; }
  function startAnim() { redraw(); }
  function stopAnim() { }
  function redraw() { if (!running) { wantStill = true; running = true; requestAnimationFrame(frame); } }
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

  function runBoot() {
    booting = true;
    redraw();
    $('home').classList.add('hidden');
    $('panel').classList.add('hidden');
    var boot = $('boot'); boot.classList.remove('hidden'); boot.style.opacity = 1;
    $('bootList').innerHTML = '';
    $('bootWelcome').classList.remove('on');
    var hr = new Date().getHours();
    var greet = hr >= 4 && hr < 12 ? 'Good morning' : hr >= 12 && hr < 17 ? 'Good afternoon' : 'Good evening';
    $('bootHello').textContent = greet + ', Nathan';
    return wait(500)
      .then(function () { $('bootWelcome').classList.add('on'); return say(greet + ', Nathan. I am Nexus, your personal assistant. How may I assist you?'); })
      .then(function () { return wait(700); })
      .then(function () { boot.style.opacity = 0; return wait(800); })
      .then(function () { boot.classList.add('hidden'); showHome(); booting = false; });
  }

  function showHome() {
    var h = $('home'); h.style.opacity = 0; h.classList.remove('hidden');
    setTimeout(function () { h.style.opacity = 1; }, 30);
  }

  // ------------------------------------------------------------------
  // Clock, network, weather
  // ------------------------------------------------------------------
  function tickClock() {
    var d = new Date(), hh = d.getHours(), mm = d.getMinutes();
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
  var MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  var SMART_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

  function aiKey() { return (pref('gemini_key') || window.NEXUS_DEFAULT_KEY || '').trim(); }

  function askAI(contents, system, opts) {
    opts = opts || {};
    var key = aiKey();
    if (!key) return Promise.reject(new Error('nokey'));
    if (!online()) return Promise.reject(new Error('offline'));
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
      return http('POST', 'https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', body,
        { 'Content-Type': 'application/json', 'x-goog-api-key': key }).then(function (r) {
        var detail = '';
        try { detail = (JSON.parse(r.text).error || {}).message || ''; } catch (x) { detail = String(r.text || '').slice(0, 120); }
        if (r.status === 404) return attempt(i + 1);
        if (r.status === 401 || r.status === 403 || (r.status === 400 && /API key|credential|auth/i.test(r.text))) {
          var be = new Error('badkey'); be.detail = detail; throw be;
        }
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
    return attempt(0);
  }

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
        if (r === null) { var d = new Date(); return 'It\'s ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.'; }
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
  Nexus._partial = function (t) { caption('“' + t + '”'); };
  var heardResolve = null;
  Nexus._heard = function (t) { setOrb('listening', false); $('orb').style.transform = ''; if (heardResolve) { var r = heardResolve; heardResolve = null; r(t); } };
  Nexus._heardError = function (code) {
    setOrb('listening', false); $('orb').style.transform = '';
    if (heardResolve) { var r = heardResolve; heardResolve = null; r({ error: code }); }
  };

  var pausedForTalk = false;
  function pauseForTalk() {
    try { if (A && A.isMusicActive()) { A.media('pause'); pausedForTalk = true; } } catch (e) {}
  }
  function resumeAfterTalk() {
    if (!pausedForTalk) return;
    pausedForTalk = false;
    setTimeout(function () { try { if (A) A.media('play'); } catch (e) {} }, 400);
  }
  function listen() {
    pauseForTalk();
    return new Promise(function (resolve) {
      heardResolve = resolve;
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
    var d = new Date();
    if (/\b(what time|the time|time is it)\b/.test(t)) return 'It\'s ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.';
    if (/\b(what day|today's date|the date|what's the date)\b/.test(t)) return 'It\'s ' + d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + '.';
    if (/\b(where am i|my location|where are we)\b/.test(t)) return placeNow ? 'We\'re in ' + placeNow + '.' : 'I can\'t get a location fix right now.';
    if (/\b(weather|temperature|how cold|how hot)\b/.test(t) && weatherNow) return 'It\'s ' + weatherNow.temp + ' degrees and ' + weatherNow.desc.toLowerCase() + ' in ' + weatherNow.city + '.';
    return null;
  }
  function handleSpeech(raw) {
    var t = raw.toLowerCase().replace(/^(hey |ok |okay )?nexus[, ]*/, '').trim();
    if (/^(stop|cancel|never ?mind|shut up|quiet)$/.test(t)) { stopTalking(); caption('STANDING BY'); return Promise.resolve(); }
    if (/brief me/.test(t)) { act('briefing'); return Promise.resolve(); }
    for (var mi = 0; mi < MUSIC_CMDS.length; mi++) {
      if (MUSIC_CMDS[mi][0].test(t)) { if (MUSIC_CMDS[mi][1] === 'pause') pausedForTalk = false; else if (MUSIC_CMDS[mi][1] === 'next' || MUSIC_CMDS[mi][1] === 'prev') pausedForTalk = false; music(MUSIC_CMDS[mi][1]); caption(MUSIC_CMDS[mi][2].toUpperCase()); return say(MUSIC_CMDS[mi][2]); }
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
    var now = new Date();
    var ctx = PERSONA + ' Current local time: ' + now.toLocaleString() + '.' +
      (weatherNow ? ' Current weather in ' + weatherNow.city + ': ' + weatherNow.temp + ' degrees C, ' + weatherNow.desc + '.' : '');
    return askAI(chatHistory, ctx, { maxTokens: 400 }).then(function (reply) {
      reply = reply.replace(/[*#_`]/g, '');
      chatHistory.push({ role: 'model', parts: [{ text: reply }] });
      return reply;
    }).catch(function (e) {
      chatHistory.pop();
      lastAiError = (e && (e.message + (e.detail ? ' · ' + e.detail : ''))) || 'unknown';
      var off = offlineReply(t);
      return (e.message === 'nokey' || e.message === 'offline') ? off : aiErrorLine(e);
    }).then(function (reply) {
      setOrb('thinking', false);
      caption(reply.toUpperCase().length > 140 ? reply.slice(0, 137) + '…' : reply);
      return say(reply);
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
    say(pick(['Opening ' + a.label + '.', a.label + ', coming up.', 'Launching ' + a.label + '.']));
  }

  function act(name) {
    if (booting) return;
    switch (name) {
      case 'youtube': case 'stremio': case 'music': case 'maps': case 'messages': launchNamed(name); break;
      case 'party': toggleParty(); break;
      case 'night': toggleNight(); break;
      case 'trivia': openTrivia(); break;
      case 'story': openStory(); break;
      case 'briefing': openBriefing(); break;
      case 'intruder': runIntruder(); break;
      case 'apps': openApps(); break;
      case 'settings': openSettings(); break;
    }
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tile'), function (el) {
    el.addEventListener('click', function () { act(el.getAttribute('data-act')); });
  });

  function badges() {
    var b = [];
    if (mode.night) b.push('<span class="badge">NIGHT DRIVE</span>');
    if (mode.party) b.push('<span class="badge">PARTY MODE</span>');
    $('modeBadges').innerHTML = b.join('');
    $('tParty').classList.toggle('active', mode.party);
    $('tNight').classList.toggle('active', mode.night);
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
    say(mode.night ? pick(['Night drive engaged. Dimming everything down. Easy on the eyes.', 'Night drive on. Smooth and quiet from here.']) : pick(['Night drive off. Lights back up.', 'Back to full brightness.']));
  }

  // ---- Party mode (lights follow the music in the cab via the mic) ----
  var P = { on: false, avg: 0.01, lastBeat: 0, lastMeter: 0, hue: 300, auto: null, decay: null, strobe: null, ctx: null };
  var HYPE = ['Make some noise!', 'Let\'s go!', 'Turn it up!', 'Passengers, this one\'s for you.', 'Nexus in the building!', 'Volume to the max. Let\'s ride.', 'Hands up in the truck!',
    'This truck is officially a club!', 'Somebody turn this song up!', 'I can feel the bass in my circuits!', 'Party mode! No sleeping in this truck!',
    'Who picked this song? Great choice!', 'Everybody in the truck, make some noise!', 'Louder! I can\'t hear you!', 'This is the best party on the road!'];
  var SHOUTS = ['Ohhh!', 'Let\'s go!', 'Drop it!', 'Yeah!', 'Party mode!', 'Turn it up!'];
  var PARTY_IN = ['Party mode activated! Let\'s get this party started!', 'Party mode! Turn it up and let\'s go!', 'It\'s party time! Hands up in the truck!',
    'Party mode engaged! This truck just became a club!', 'Attention passengers, party mode is now in effect! Let\'s go!'];
  var PARTY_OUT = ['Party\'s over. Back to business.', 'Party mode off. That was a good one.', 'Shutting down the party. Good times.'];
  var talkBusy = false;
  function partyTalk(line) { if (talkBusy) return; talkBusy = true; say(line).then(function () { talkBusy = false; }); }

  function buildBars() {
    ['pTop', 'pBottom'].forEach(function (id) {
      var el = $(id); if (el.children.length) return;
      var h = ''; for (var i = 0; i < 24; i++) h += '<i></i>'; el.innerHTML = h;
    });
  }
  function audio() { try { P.ctx = P.ctx || new (window.AudioContext || window.webkitAudioContext)(); if (P.ctx.state === 'suspended') P.ctx.resume(); } catch (e) {} return P.ctx; }

  var THEMES = ['RAINBOW', 'POLICE', 'FIRE', 'ICE'];
  P.theme = 0; P.flip = 0;
  function themeColor(i) {
    var t = THEMES[P.theme];
    if (t === 'POLICE') return ((i + P.flip) % 2) ? 'hsl(0,100%,52%)' : 'hsl(220,100%,55%)';
    if (t === 'FIRE') return 'hsl(' + Math.round((P.hue + i * 9) % 50) + ',100%,' + (50 + (i % 3) * 6) + '%)';
    if (t === 'ICE') return 'hsl(' + Math.round(185 + (P.hue + i * 7) % 40) + ',100%,' + (60 + (i % 3) * 10) + '%)';
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

  Nexus._meter = function (rms) {
    if (!P.on) return;
    if (rms > 0.006) P.lastMeter = Date.now();
    $('pMeterFill').style.width = Math.min(100, rms * 900) + '%';
    var spike = rms > P.avg * 1.45 && rms > 0.012 && Date.now() - P.lastBeat > 170;
    P.avg = P.avg * 0.92 + rms * 0.08;
    if (spike) beat(Math.min(1, rms * 8));
    if (rms > P.avg * 2.6 && rms > 0.05 && Date.now() - (P.lastShout || 0) > 25000) { P.lastShout = Date.now(); partyTalk(pick(SHOUTS)); }
  };
  Nexus._meterSource = function (src) {
    $('pHint').textContent = src === 'music' ? 'LIGHTS ARE SYNCED TO THE MUSIC' : 'TURN THE MUSIC UP · THE LIGHTS FOLLOW THE BEAT';
  };
  Nexus._meterError = function () { $('pHint').textContent = 'MIC UNAVAILABLE · LIGHTS RUNNING ON AUTO BEAT'; };

  function pollSong() {
    if (!P.on || !A) return;
    var np = {};
    try { np = JSON.parse(A.nowPlaying() || '{}'); } catch (e) {}
    if (np.access === false) { $('pSong').textContent = '🎵 Allow song announcements in Nexus Settings'; return; }
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
    partyTalk(pick(PARTY_IN));
    clearInterval(P.talk);
    P.talk = setInterval(function () { if (P.on) partyTalk(pick(HYPE)); }, 45000 + Math.floor(Math.random() * 20000));
  }
  function exitParty(silent) {
    P.on = mode.party = false;
    clearInterval(P.auto); clearInterval(P.strobe); P.strobe = null;
    try { if (A) A.meter(false); } catch (e) {}
    $('party').classList.add('hidden');
    Array.prototype.forEach.call(document.querySelectorAll('.pbtn'), function (b) { b.classList.remove('on'); });
    badges();
    clearInterval(P.talk); clearInterval(P.songTimer);
    if (!silent) say(pick(PARTY_OUT));
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
        [466, 587, 698].forEach(function (f) { tone('sawtooth', f, st, d, 0.09); });
      });
      for (var i = 0; i < 6; i++) setTimeout(function () { beat(1); }, i * 160);
    },
    drop: function () {
      tone('sine', 180, 0, 1.6, 0.55, 32); tone('square', 90, 0, 1.6, 0.08, 20); noise(1.5, 0.6, 0.35, 200);
      setTimeout(function () { for (var i = 0; i < 8; i++) setTimeout(function () { beat(1); }, i * 90); }, 1500);
    },
    roll: function () {
      var t = 0, gap = 0.12;
      while (t < 1.8) { noise(t, 0.05, 0.3, 1500); t += gap; gap = Math.max(0.035, gap * 0.9); }
      noise(1.85, 1.2, 0.45, 3000);
      setTimeout(function () { beat(1); }, 1850);
    },
    hype: function () { partyTalk(pick(HYPE)); beat(1); },
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
    theme: function () { P.theme = (P.theme + 1) % THEMES.length; $('pThemeName').textContent = THEMES[P.theme]; beat(1);
      partyTalk(pick({ RAINBOW: ['Rainbow mode.'], POLICE: ['Pull over! Just kidding. Police lights on.'], FIRE: ['Fire mode. Things are heating up!'], ICE: ['Ice mode. Stay frosty.'] }[THEMES[P.theme]])); },
    countdown: function () {
      if (P.counting) return; P.counting = true;
      var el = document.createElement('div'); el.id = 'pCount'; $('party').appendChild(el);
      var steps = ['3', '2', '1'], words = ['Three!', 'Two!', 'One!'];
      var chain = Promise.resolve();
      steps.forEach(function (n, k) {
        chain = chain.then(function () {
          el.textContent = n; beat(.4 + k * .3);
          return Promise.all([say(words[k]), wait(900)]);
        });
      });
      chain.then(function () {
        el.textContent = 'DROP!'; FX.drop(); say('Drop it!');
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
    say((ok ? pick(['Correct.', 'That\'s right.', 'Nailed it.']) : 'Not quite. The answer was ' + q[1][q[2]] + '.') + ' ' + q[3]);
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

  function openBriefing() {
    openPanel('DAILY BRIEFING', '<div class="muted">Compiling your briefing: weather, world news, Canada…</div>');
    say('Compiling your briefing. One moment.');
    var d = new Date();
    var dateLine = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    Promise.all([loadWeather()].concat(FEEDS.map(loadFeed))).then(function (res) {
      var w = res[0], news = [].concat.apply([], res.slice(1));
      var intro = 'Good ' + (d.getHours() < 12 ? 'morning' : d.getHours() < 17 ? 'afternoon' : 'evening') + ', Nathan. Here is your briefing for ' + dateLine + '.';
      var wx = w ? ('Weather in ' + w.city + ': ' + w.temp + ' degrees and ' + w.desc.toLowerCase() + ', feeling like ' + w.feels +
        '. High of ' + w.hi + ', low of ' + w.lo + ', wind around ' + w.wind + ' kilometres an hour.') : 'Weather is unavailable right now.';
      var list = news.map(function (n, i) { return (i + 1) + '. [' + n.section + '] ' + n.title + (n.desc ? ' — ' + n.desc : ''); }).join('\n');
      var sys = PERSONA + ' You are reading a radio-style news briefing. Use ONLY the headlines provided; do not add facts that are not in them. ' +
        'Write it in your own words, neutral and factual, no opinions. About 250 words. Cover the most important world stories first, then Canada, then one business item. ' +
        'Use short spoken sentences and smooth transitions like "In Canada," and "In business news,". Finish with one interesting "on this day in history" fact for ' + dateLine + '. No markdown, no lists.';
      var aiPart = news.length ? askAI([{ role: 'user', parts: [{ text: 'Headlines:\n' + list }] }], sys, { maxTokens: 2048, temperature: 0.4, smart: true })
        .catch(function () { return null; }) : Promise.resolve(null);
      return aiPart.then(function (txt) {
        var spoken = txt ? txt.replace(/[*#_`]/g, '') :
          (news.length ? 'Here are the top headlines. ' + news.slice(0, 8).map(function (n) { return n.section + ': ' + n.title + '.'; }).join(' ') : 'I couldn\'t reach the news right now.');
        var outro = 'That\'s your briefing. All systems are online. Drive safe.';
        var html = '<p class="green">' + esc(dateLine.toUpperCase()) + '</p><p>' + esc(wx) + '</p>' +
          spoken.split(/\n+/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') +
          (news.length ? '<p class="muted" style="margin-top:3vmin">HEADLINES</p>' + news.map(function (n) {
            return '<p class="muted" style="margin:.6vmin 0">' + esc(n.section.toUpperCase()) + ' · ' + esc(n.title) + ' <span style="opacity:.6">(' + n.src + ')</span></p>';
          }).join('') : '') +
          '<span class="btn" id="brStop">STOP READING</span>';
        $('panelBody').innerHTML = html;
        $('brStop').addEventListener('click', stopTalking);
        return say(intro + ' ' + wx + ' ' + spoken + ' ' + outro);
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
      '<div class="hint">Opens Android settings. Turn Nexus ON in the list, then come back. This lets Nexus announce songs and skip tracks in Spotify.</div></div>' +
      '<div class="field"><label>GRAPHICS</label>' +
      '<span class="btn' + (LITE ? ' go' : '') + '" id="sLite">SMOOTH (RECOMMENDED)</span><span class="btn' + (LITE ? '' : ' go') + '" id="sHigh">HIGH DETAIL</span>' +
      '<div class="hint">Smooth mode runs better on this box. Changes apply after Replay Startup.</div></div>' +
      '<div class="field"><label>SYSTEM</label>' +
      '<span class="btn" id="sReplay">REPLAY STARTUP</span><span class="btn" id="sAndroid">ANDROID SETTINGS</span>' +
      '<div class="hint">Nexus version ' + esc(A ? A.version() : 'preview') + '</div></div>';
    openPanel('SETTINGS', html);

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
    $('sNotif').addEventListener('click', function () { if (A) A.openNotificationAccess(); });
    $('sLite').addEventListener('click', function () { setPref('quality', 'lite'); LITE = true; D = 0.5; FRAME_MS = 40; resize(); redraw(); openSettings(); });
    $('sHigh').addEventListener('click', function () { setPref('quality', 'high'); LITE = false; D = 1; FRAME_MS = 30; resize(); redraw(); openSettings(); });
    $('sReplay').addEventListener('click', function () { closePanel(); runBoot(); });
    $('sAndroid').addEventListener('click', function () { if (A) A.openSystemSettings(); });
  }

  // ------------------------------------------------------------------
  // Android hooks
  // ------------------------------------------------------------------
  Nexus.back = function () { if (P.on) { exitParty(); return; } if (!closePanel()) { stopTalking(); } };
  Nexus.home = function () { closePanel(); };
  var awaySince = 0;
  Nexus.paused = function () { awaySince = Date.now(); try { if (A && P.on) A.meter(false); } catch (e) {} };
  Nexus.resumed = function () {
    if (awaySince && Date.now() - awaySince > 10 * 60 * 1000 && !booting) {
      setTimeout(function () { closePanel(); runBoot(); }, 300);
    }
    awaySince = 0; try { if (A && P.on) A.meter(true); } catch (e) {} redraw(); tickClock(); try { if (A) A.refreshApps(); } catch (e) {} if (mode.night && A) A.setBrightness(0.12); };

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  if (location.hash === '#boot') { try { history.replaceState(null, '', location.pathname); } catch (e) {} runBoot(); }
  else { $('boot').classList.add('hidden'); showHome(); stopAnim(); }
})();
