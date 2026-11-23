/* NEXUS — cinematic startup.
   The Design 2 emblem comes online over about eight seconds while Nexus announces itself:
     black -> blue and violet energy -> the space backdrop -> the orbital rings ("Nexus online")
     -> the chrome N forms ("Intelligence engaged") -> NEXUS lights up ("All systems operational")
     -> hold ("Welcome back") -> the home screen.
   The picture is built from five layers cut from the design (backdrop, rings, emblem, lettering and
   the finished frame). They are animated with opacity and transform only, which the box's GPU
   composites without redrawing, plus one small canvas for the energy that runs around the rings.
   The voice is a recording played by Android with the music ducked under it (window.Android
   startupVoice); in a plain browser it falls back to an <audio> element.
   NexusIntro.play() returns a promise that resolves when the home screen is showing again.
   A tap skips it. Everything it creates is removed when it ends. */
(function () {
  'use strict';
  var A = window.Android || null;
  var SRC_W = 1672, SRC_H = 941;                       // the design's own pixel space
  var CX = 834, CY = 293, CRX = 303, CRY = 254;        // the circle around the emblem
  var EX = 850, EY = 288, EA = 531, EB = 101, PHI = -10.8 * Math.PI / 180;   // the orbital ring
  var WORD = [300, 548, 1384, 700];                    // the NEXUS lettering
  // timeline (ms), set to the recorded voice: phrases start at 0, 1.54, 3.48 and 5.38 s
  var VOICE_AT = 950, T = { back: [350, 2100], rings: [1000, 2500], comets: 1150, emblem: [2500, 3350], flash: 2950,
    word: [4400, 5300], glint: [4850, 5900], final: [5300, 6000], out: 7150, end: 7900 };

  function ease(x) { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); }

  function load(src) {
    return new Promise(function (res) {
      var im = new Image(); im.decoding = 'async';
      im.onload = function () { if (im.decode) im.decode().then(function () { res(im); }, function () { res(im); }); else res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }

  function voice(on) {
    try {
      if (A && A.startupVoice) { if (on) A.startupVoice(); else if (A.stopStartupVoice) A.stopStartupVoice(); return 'native'; }
    } catch (e) {}
    try {
      if (on) { voice.el = new Audio('voice/startup.ogg'); voice.el.play().catch(function () {}); }
      else if (voice.el) { voice.el.pause(); voice.el = null; }
      return 'web';
    } catch (e) { return 'none'; }
  }

  function play(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var o = document.createElement('div'); o.id = 'intro'; o.className = 'nx-intro';
      var stage = document.createElement('div'); stage.className = 'nx-stage'; o.appendChild(stage);
      document.body.appendChild(o);
      var done = false, raf = 0, timers = [], log = { started: 0, voice: '', layers: 0, frames: 0 };
      NexusIntro.last = log;
      function later(f, ms) { timers.push(setTimeout(f, ms)); }
      function end(skipped) {
        if (done) return; done = true;
        cancelAnimationFrame(raf); timers.forEach(clearTimeout);
        if (skipped) voice(false);
        log.ended = performance.now(); log.skipped = !!skipped;
        o.style.opacity = 0;
        setTimeout(function () {
          // free the decoded pictures right away (the box has 2 GB)
          [].forEach.call(o.querySelectorAll('img'), function (im) { im.removeAttribute('src'); });
          if (o.parentNode) o.parentNode.removeChild(o);
        }, 470);
        resolve(log);
      }
      o.addEventListener('click', function () { end(true); });
      o.addEventListener('touchstart', function () { end(true); }, { passive: true });

      Promise.all(['intro/back.jpg', 'intro/rings.webp', 'intro/emblem.webp', 'intro/word.webp', 'intro/final.jpg'].map(load)).then(function (ims) {
        if (done) return;
        if (ims.some(function (x) { return !x; })) { log.failed = true; end(false); return; }
        log.layers = ims.length;
        var names = ['back', 'rings', 'emblem', 'word', 'final'], el = {};
        ims.forEach(function (im, i) { im.className = 'nx-l nx-' + names[i]; im.style.opacity = 0; stage.appendChild(im); el[names[i]] = im; });
        var cv = document.createElement('canvas'); cv.className = 'nx-fx'; stage.appendChild(cv);
        var g = cv.getContext('2d');
        // the stage covers the screen the way the design would (cropped a little at the sides on 1024x600)
        var vw = innerWidth, vh = innerHeight, s = Math.max(vw / SRC_W, vh / SRC_H), sw = SRC_W * s, sh = SRC_H * s;
        stage.style.width = sw + 'px'; stage.style.height = sh + 'px';
        stage.style.left = (vw - sw) / 2 + 'px'; stage.style.top = (vh - sh) / 2 + 'px';
        var Q = Math.min(1, 680 / sw);                    // the energy canvas runs at about 680 px wide
        cv.width = Math.round(sw * Q); cv.height = Math.round(sh * Q);
        var k = cv.width / SRC_W;
        // a scratch canvas just big enough for the lettering, for the light sweeping across it
        var wc = document.createElement('canvas'), wg = wc.getContext('2d');
        wc.width = Math.round((WORD[2] - WORD[0]) * k); wc.height = Math.round((WORD[3] - WORD[1]) * k);
        var wordMask = document.createElement('canvas'); wordMask.width = wc.width; wordMask.height = wc.height;
        wordMask.getContext('2d').drawImage(el.word, WORD[0] / SRC_W * el.word.naturalWidth, WORD[1] / SRC_H * el.word.naturalHeight,
          (WORD[2] - WORD[0]) / SRC_W * el.word.naturalWidth, (WORD[3] - WORD[1]) / SRC_H * el.word.naturalHeight, 0, 0, wc.width, wc.height);

        function anim(node, frames, from, to, easing) {
          later(function () { try { node.animate(frames, { duration: to - from, easing: easing || 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' }); } catch (e) { node.style.opacity = 1; } }, from);
        }
        anim(el.back, [{ opacity: 0, transform: 'scale(1.06)' }, { opacity: .82, transform: 'scale(1)' }], T.back[0], T.back[1]);
        anim(el.rings, [{ opacity: 0, transform: 'scale(.86) rotate(2.5deg)' }, { opacity: 1, transform: 'scale(1) rotate(0deg)' }], T.rings[0], T.rings[1]);
        anim(el.emblem, [{ opacity: 0, transform: 'scale(1.28)', filter: 'brightness(2.2)' }, { opacity: 1, transform: 'scale(1)', filter: 'brightness(1)' }], T.emblem[0], T.emblem[1]);
        // the lettering lights up from left to right
        anim(el.word, [{ opacity: 0, clipPath: 'inset(0 82% 0 0)' }, { opacity: 1, clipPath: 'inset(0 0% 0 0)' }], T.word[0], T.word[1], 'cubic-bezier(.45,.1,.3,1)');
        anim(el.final, [{ opacity: 0 }, { opacity: 1 }], T.final[0], T.final[1], 'ease-in-out');
        anim(el.back, [{ opacity: .82 }, { opacity: 1 }], T.final[0], T.final[1]);

        later(function () { log.voice = voice(true); log.voiceAt = performance.now() - log.started; }, VOICE_AT);
        later(function () { end(false); }, T.end);
        later(function () { o.classList.add('nx-out'); }, T.out);

        // energy: wisps gathering in the dark, then light running round the orbital ring
        var wisps = [];
        for (var i = 0; i < 70; i++) wisps.push({ a: Math.random() * 6.283, r: .35 + Math.random() * .75, sp: .4 + Math.random() * .8, h: Math.random() < .5 ? 'rgba(80,170,255,' : 'rgba(170,110,255,' });
        var comets = [{ th: 0, w: 1.55, len: .9 }, { th: 2.4, w: 1.25, len: .7 }, { th: 4.3, w: 1.85, len: .55 }];
        function ringPt(th) {
          var x = EA * Math.cos(th), y = EB * Math.sin(th), c = Math.cos(PHI), sn = Math.sin(PHI);
          return [EX + x * c - y * sn, EY + x * sn + y * c, Math.sin(th)];
        }
        function hidden(p, t) {   // the far side of the ring passes behind the emblem once it has formed
          if (t < T.emblem[0] + 300 || p[2] > 0) return false;
          var dx = (p[0] - CX) / CRX, dy = (p[1] - CY) / CRY; return dx * dx + dy * dy < .74;
        }
        log.started = performance.now();
        (function frame(now) {
          if (done) return;
          raf = requestAnimationFrame(frame);
          var t = now - log.started; log.frames++;
          g.clearRect(0, 0, cv.width, cv.height);
          g.globalCompositeOperation = 'lighter';
          if (t < 2000) {
            var gather = ease(t / 1900), fade = t < 400 ? t / 400 : (t > 1250 ? Math.max(0, 1 - (t - 1250) / 700) : 1);
            for (var i = 0; i < wisps.length; i++) {
              var w = wisps[i], rr = w.r * (1 - gather * .82), aa = w.a + t * .0011 * w.sp;
              var x = (CX + Math.cos(aa) * rr * 560) * k, y = (CY + Math.sin(aa) * rr * 230) * k;
              var wr = (1.2 + w.sp * 1.6) * k * 2.2;
              g.fillStyle = w.h + (.16 * fade) + ')'; g.beginPath(); g.arc(x, y, wr * 3.2, 0, 6.283); g.fill();
              g.fillStyle = w.h + (.6 * fade) + ')'; g.beginPath(); g.arc(x, y, wr, 0, 6.283); g.fill();
            }
          }
          if (t > T.comets) {
            var on = Math.min(1, (t - T.comets) / 700) * (t > T.out ? Math.max(0, 1 - (t - T.out) / 500) : 1);
            for (var c = 0; c < comets.length; c++) {
              var cm = comets[c], head = cm.th + (t - T.comets) / 1000 * cm.w;
              for (var j = 0; j < 22; j++) {
                var p = ringPt(head - j * cm.len / 22);
                if (hidden(p, t)) continue;
                var f = 1 - j / 22, r = (j === 0 ? 7 : 4.2 * f + .8) * k * 1.6;
                g.fillStyle = (j < 2 ? 'rgba(230,245,255,' : (c === 1 ? 'rgba(190,120,255,' : 'rgba(90,190,255,')) + (on * f * (j === 0 ? 1 : .55)) + ')';
                g.beginPath(); g.arc(p[0] * k, p[1] * k, r, 0, 6.283); g.fill();
              }
              var hp = ringPt(head);
              if (!hidden(hp, t)) {
                var hg = g.createRadialGradient(hp[0] * k, hp[1] * k, 0, hp[0] * k, hp[1] * k, 34 * k * 1.6);
                hg.addColorStop(0, 'rgba(150,210,255,' + (.45 * on) + ')'); hg.addColorStop(1, 'rgba(150,210,255,0)');
                g.fillStyle = hg; g.fillRect(hp[0] * k - 60 * k, hp[1] * k - 60 * k, 120 * k, 120 * k);
              }
            }
          }
          // the N lands: a burst of light from the core
          var fl = t - T.flash;
          if (fl > -150 && fl < 900) {
            var fa = fl < 0 ? (fl + 150) / 150 : Math.max(0, 1 - fl / 900), R = (180 + Math.max(0, fl) * .55) * k * 1.6;
            var rg = g.createRadialGradient(CX * k, CY * k, 0, CX * k, CY * k, R);
            rg.addColorStop(0, 'rgba(235,245,255,' + (.85 * fa) + ')'); rg.addColorStop(.35, 'rgba(120,170,255,' + (.35 * fa) + ')'); rg.addColorStop(1, 'rgba(120,90,255,0)');
            g.fillStyle = rg; g.fillRect(CX * k - R, CY * k - R, R * 2, R * 2);
          }
          // a sweep of light across the chrome lettering
          var gl = (t - T.glint[0]) / (T.glint[1] - T.glint[0]);
          if (gl > 0 && gl < 1) {
            wg.globalCompositeOperation = 'source-over'; wg.clearRect(0, 0, wc.width, wc.height);
            var gx = (-.2 + gl * 1.4) * wc.width, sg = wg.createLinearGradient(gx - wc.width * .09, 0, gx + wc.width * .09, 0);
            sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(.5, 'rgba(255,255,255,.85)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
            wg.fillStyle = sg; wg.fillRect(0, 0, wc.width, wc.height);
            wg.globalCompositeOperation = 'destination-in'; wg.drawImage(wordMask, 0, 0);
            g.drawImage(wc, WORD[0] * k, WORD[1] * k);
          }
          g.globalCompositeOperation = 'source-over';
        })(log.started);
      });
      // never hold the app if something goes wrong while loading
      later(function () { if (!log.started) { log.failed = true; end(false); } }, 4000);
    });
  }
  var NexusIntro = window.NexusIntro = { play: play, timeline: T, voiceAt: VOICE_AT, last: null };
})();
