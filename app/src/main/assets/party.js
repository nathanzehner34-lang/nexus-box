/* NEXUS PARTY · NEON ENERGY FIELD
 * Isolated, event-scoped renderer. The Android bridge and app.js retain ownership
 * of media transport, navigation, and Party Mode entry/exit.
 */
(function () {
  'use strict';
  var root = document.getElementById('party'), canvas = document.getElementById('partyCanvas');
  if (!root || !canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  var modes = ['pulse', 'wave', 'vortex', 'chaos', 'ripple'];
  // flow: the four Energy Flow gradient stops — turquoise, electric blue, ultraviolet, hot pink.
  var presets = {
    orb: { accent: [39, 190, 255], colors: ['#28eaff', '#388bff', '#a568ff', '#ff53c8', '#ffe34f', '#e7fbff'], flow: ['#1ff0d8', '#2f7bff', '#9d4bff', '#ff4fc0'] },
    voltage: { accent: [35, 122, 255], colors: ['#12dcff', '#3978ff', '#e6f5ff', '#ff55d3', '#ffd64e', '#837aff'], flow: ['#14e6ff', '#2a6bff', '#7a5cff', '#ff55d3'] },
    aurora: { accent: [94, 99, 255], colors: ['#83e7ff', '#8398ff', '#b481ff', '#ff8bda', '#fff0a0', '#62d7ee'], flow: ['#6ef0e2', '#7f9bff', '#b481ff', '#ff8bda'] },
    neon: { accent: [235, 71, 221], colors: ['#10e8ff', '#168cff', '#a43cff', '#fa3fba', '#ffe33f', '#d6fbff'], flow: ['#10e8ff', '#1a7cff', '#a43cff', '#fa3fba'] }
  };
  var mode = 'pulse', preset = 'orb', active = false, raf = 0, runId = 0, pollTimer = 0, lastFrame = 0;
  var highMemory = false, frameInterval = 32;
  var w = 1, h = 1, scale = 1, musicLevel = .08, bassLevel = 0, midLevel = 0, highLevel = 0, audioSource = 'fallback';
  var inputEnergy = 0, inputBass = 0, inputMid = 0, inputHigh = 0, beatPulse = 0, bassEnvelope = .008, lastBassKick = 0, lastAudioSample = 0;
  var orbs = [], connectionCounts = new Uint8Array(22), impulses = [], waves = [], particles = [], trails = [], selected = null, pointer = null, gesture = null, dragVelocity = { x: 0, y: 0 };
  var sprites = {}, presetRgb = [], lineDash = [3, 8], audio = null, soundOn = false, lastSong = '', lastTap = null, particleCursor = 0, trailCursor = 0;
  var modeStarted = 0;
  // snare and hi-hat events (from the six-band feed): envelopes for the GL scenes, counters for tests
  var snareEnv = 0, hatEnv = 0, snareHits = 0, hatHits = 0, detailAt = 0, detailMid = 0, detailHigh = 0, hookDetail = function () {};
  // The snare: a sharp flash of colour in a few orbs and a spray of particles from them.
  function onSnare(power) {
    snareEnv = Math.max(snareEnv, power); snareHits++;
    if (experience !== 'orb') return;
    for (var n = 0; n < 3; n++) {
      var o = orbs[(snareHits * 7 + n * 5) % orbs.length];
      o.spark = Math.max(o.spark || 0, .8 * power); o.flash = Math.max(o.flash || 0, .5);
      burst(o.x, o.y, o.color, .7 + power * .5, highMemory ? 10 : 6);
    }
  }
  // Hi-hats: fine glints scattered through the field.
  function onHat(power) {
    hatEnv = Math.max(hatEnv, power); hatHits++;
    if (experience !== 'orb') return;
    for (var n = 0; n < (highMemory ? 4 : 2); n++) {
      var p = particles[particleCursor++ % particles.length];
      p.x = rand(0, w); p.y = rand(0, h); p.vx = rand(-.3, .3); p.vy = rand(-.3, .3); p.life = .7; p.size = rand(.6, 1.4); p.color = 5; p.burst = true;
    }
  }
  // Experiences: the upgraded Orb Experience (hero energy orb + selectable backgrounds) and Energy Flow (no orb).
  var experiences = ['orb', 'flow', 'ink'], experience = 'orb';
  var backdrops = ['classic', 'smoke', 'aurora', 'deep', 'iridescent'], backdrop = 'classic';
  var glCanvas = document.getElementById('partyGL'), gl = null, glProg = null, glBuf = null, glU = {}, glOk = false, glFailed = false;
  // One compiled program per experience. A GPU still pays for the branch it does not take, so the
  // Orb Experience gets a build with no Energy Flow in it and vice versa; the combined build is only
  // used while the two are crossfading.
  var glProgs = {}, glUs = {}, glVariant = '';
  var GL_UNIFORMS = ['res', 'orbC', 'T', 'zph', 'bass', 'mid', 'high', 'energy', 'beat', 'orbR', 'quality',
    'bgA', 'bgB', 'bgMix', 'flow', 'surge', 'c1', 'c2', 'c3', 'tOn', 'tch', 'tcv', 'cbs', 'trA', 'trB',
    'build', 'bphase', 'burst', 'bAge', 'bPow', 'recoil', 'f1', 'f2', 'f3', 'f4', 'snare', 'hat'];
  var glScale = .42, glScaleMax = .42, glQuality = 0, glSlowFrames = 0, glFastFrames = 0, glFrames = 0;
  var sceneT = 0, flowPhase = 0, flowMix = 0, flowTarget = 0, bgFrom = 0, bgTo = 0, bgMix = 0, classicWeight = 1, surge = 0, flowCanvasCleared = false;
  // ---- Energy Flow touch: up to four fingers, each a hold/drag point; taps seed colour bursts; drags leave a wake ----
  // touchN is how many wake points the shader takes: 12, 6 on a GPU with few uniform slots, 0 = touch compiled out.
  var touchN = 12, flowTouches = [], flowBursts = [], flowBurstNext = 0, flowWake = [], flowStroke = 0, flowWakeSeq = 0, flowHueSeed = .1;
  var flowGestures = { tap: 0, hold: 0, drag: 0, multi: 0 }, flowTouchOn = 0;
  for (var ti = 0; ti < 4; ti++) {
    flowTouches.push({ id: -1, down: false, x: 0, y: 0, sx: 0, sy: 0, lx: 0, ly: 0, lt: 0, wx: 0, wy: 0, vx: 0, vy: 0, t0: 0, attract: 0, contact: 0, hue: 0, dragging: false, stroke: 0, held: false });
    flowBursts.push({ x: 0, y: 0, age: 9, hue: 0 });
  }
  var touchBuf = { tch: new Float32Array(16), tcv: new Float32Array(16), cbs: new Float32Array(16), trA: new Float32Array(48), trB: new Float32Array(48) };
  // Music analysis for Energy Flow: fast/slow envelopes per band feed build-up and drop detection,
  // and a beat clock keeps the field pulsing in time even when a kick is missed.
  var bassFast = 0, bassSlow = .01, bassPeak = .02, energyFast = .08, energySlow = .08, highFast = 0, highSlow = 0;
  var buildUp = 0, beatPhase = 1, beatPeriod = .5, beatConfidence = 0, lastBeatAt = 0, lastQuietAt = 0;
  var burstPower = 0, burstAge = 9, burstEnv = 0, lastBurstAt = 0, lastDropAt = 0, burstCount = 0, fieldRecoil = 0;
  var flowRgb = [], musicHue = 0, colorDrive = 0;
  // ---- Ink Machine: a tunnel of living neon membranes; its own shader program, gesture state and music events ----
  // Kept apart from the Orb/Energy Flow program so neither of those changes in any way.
  var INK_UNIFORMS = ['res', 'T', 'bass', 'mid', 'high', 'energy', 'beat', 'blast', 'blastAge', 'build', 'quality', 'prism', 'swirl', 'fadeIn',
    'k1', 'k2', 'k3', 'k4', 'k5', 'bursts', 'drags', 'twist', 'splash', 'splashAge', 'inj'];
  // The four COLOUR buttons pick these palettes while Ink Machine is showing.
  var INK_PALETTES = {
    orb: { name: 'ELECTRIC OCEAN', prism: 0, cols: [[.04, .16, .95], [0, .85, 1], [.48, .12, 1], [.2, .5, 1], [.75, .92, 1]] },
    voltage: { name: 'TOXIC FUSION', prism: 0, cols: [[.45, 1, .05], [.85, 1, .15], [1, .85, .05], [1, .42, 0], [1, 1, .8]] },
    aurora: { name: 'PRISMATIC', prism: 1, cols: [[.9, .2, .6], [.2, .8, 1], [1, .85, .2], [.5, .3, 1], [1, 1, 1]] },
    neon: { name: 'INFERNO', prism: 0, cols: [[.75, .02, .08], [1, .35, 0], [1, .75, .15], [.95, .12, .05], [1, .95, .85]] }
  };
  var inkMix = 0, inkTarget = 0, inkFailed = false, inkT = 0, inkSwirl = 0, inkPrism = 0, inkCols = null, inkFrames = 0, glOpacity = '';
  var blastPow = 0, blastAge = 9, blastEnv = 0, lastInkBlast = 0, lastInkMajor = 0, inkBlastCount = 0;
  var inkG = null, inkLastTap = null, inkInjPos = .5, inkGestures = { burst: 0, twist: 0, drag: 0, splash: 0, inject: 0 };
  var inkBursts = [], inkDrags = [], inkInj = [], inkBurstNext = 0, inkDragNext = 0, inkInjNext = 0;
  for (var ii = 0; ii < 4; ii++) { if (ii < 3) inkBursts.push({ x: 0, y: 0, age: 9, pow: 0 }); inkDrags.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0 }); if (ii < 2) inkInj.push({ x: 0, y: 0, amt: 0, pos: .5, grow: false }); }
  var inkTwist = { x: 0, y: 0, str: 0, wind: 0, on: false }, inkSplash = { x: 0, y: 0, dx: 0, dy: 0, age: 9 };
  var inkBuf = { bursts: new Float32Array(12), drags: new Float32Array(16), inj: new Float32Array(8) };
  var PARTY_SHADER = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform vec2 res, orbC;",
    "uniform float T, zph, bass, mid, high, energy, beat, orbR, quality, bgA, bgB, bgMix, flow, surge;",
    "uniform float build, bphase, burst, bAge, bPow, recoil, snare, hat;",
    "uniform vec3 c1, c2, c3;",
    "uniform vec3 f1, f2, f3, f4;",
    "float hash1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}",
    "vec2 hash2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}",
    "float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash1(i),hash1(i+vec2(1.,0.)),f.x),mix(hash1(i+vec2(0.,1.)),hash1(i+vec2(1.,1.)),f.x),f.y);}",
    "float fbm(vec2 p,float oct){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<6;i++){if(float(i)>=oct)break;v+=a*noise(p);p=m*p+vec2(3.1,1.7);a*=.5;}return v;}",
    "vec3 spectrum(float x){return clamp(abs(fract(x+vec3(0.,.6667,.3333))*6.-3.)-1.,0.,1.);}",
    "float OCT;",
    "vec3 stars(vec2 p,float sc,float t){vec2 g=p*sc;vec2 id=floor(g);vec2 h=hash2(id);float s=step(.9,h.x)*exp(-length(fract(g)-.5-(h-.5)*.7)*(16.+h.y*22.));return mix(vec3(.75,.85,1.),vec3(1.,.8,.95),h.y)*s*(.55+.45*sin(t*(1.+h.y*2.)+h.x*50.)+high*.4);}",
    "// ---------- ORB EXPERIENCE BACKGROUNDS ----------",
    "vec3 bgClassic(vec2 p,float t){vec3 c=mix(vec3(.012,.027,.067),vec3(.063,.027,.086),smoothstep(-1.,1.,p.x+p.y*.5));c+=stars(p+vec2(t*.002,0.),48.,t)*.22+stars(p*.8+7.,85.,t)*.12;return c+c1*(.09+energy*.03)*exp(-length(p-orbC)*1.7);}",
    "vec3 bgSmoke(vec2 p,float t){",
    " vec2 q=p*1.35+vec2(t*.008,0.);",
    " vec2 w=vec2(fbm(q+vec2(t*.02,0.),4.),fbm(q+vec2(3.1,t*.016),4.));",
    " vec2 wq=q*1.25+w*1.7+vec2(-t*.012,t*.009);",
    " float n1=fbm(wq,OCT),n1b=fbm(wq+vec2(.03,.04),OCT),n2=fbm(q*2.2-w*1.3+vec2(t*.015,4.),4.);",
    " vec3 c=vec3(.006,.004,.02)+c1*.05;",
    " c+=mix(c1,c3,smoothstep(.25,.85,w.x))*pow(smoothstep(.32,.85,n1),1.4)*.95;",
    " c+=c2*pow(smoothstep(.48,.9,n2),2.)*.7;",
    " c+=mix(c2,vec3(1.),.45)*clamp((n1b-n1)*9.,0.,1.)*smoothstep(.45,.75,n1)*.8;",
    " c*=1.-.55*smoothstep(.55,.82,fbm(q*3.1+w*1.4,3.));",
    " c+=stars(p,70.,t)*.7+stars(p*.6+3.,38.,t);",
    " c+=mix(c3,vec3(1.),.5)*exp(-length(p-vec2(.62,.28))*14.)*.6;",
    " return c;",
    "}",
    "vec3 bgAurora(vec2 p,float t){",
    " vec3 c=mix(vec3(.004,.006,.03),vec3(.01,.02,.06),smoothstep(-.6,.6,p.y));",
    " c+=stars(p,60.,t)*.5;",
    " for(int i=0;i<4;i++){float fi=float(i);if(fi>=3.+quality)break;",
    "  vec2 r=p;float ang=-.5+fi*.38;r=mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*r;",
    "  float base=-.15+fi*.14+.18*sin(r.x*(1.4+fi*.3)+t*(.09+fi*.03)+fi*2.)+.08*fbm(vec2(r.x*1.6+t*.05,fi),4.)+bass*.04*sin(r.x*3.+fi);",
    "  float dy=r.y-base;",
    "  float rays=.45+.55*noise(vec2((r.x+.04*sin(r.y*8.+t*.3))*(30.+fi*9.),t*.25+fi));",
    "  float curtain=smoothstep(-.02,.006,dy)*(exp(-max(dy,0.)*(7.-fi))*.85+exp(-max(dy,0.)*2.2)*.25)*rays;",
    "  vec3 cc=mix(fi<1.5?mix(c1,c2,.35):c3,mix(c1,c3,.6),smoothstep(0.,.3,dy));",
    "  c+=cc*curtain*(.5-fi*.08)*(.85+mid*.4);",
    "  c+=cc*exp(-abs(dy)*16.)*.14;",
    " }",
    " return c;",
    "}",
    "vec3 bgDeep(vec2 p,float t){",
    " vec3 c=vec3(.003,.004,.012);",
    " for(int i=0;i<3;i++){float fi=float(i);float sc=1.+fi*.9;",
    "  vec2 q=p*sc+vec2(t*(.01+fi*.008),fi*3.);",
    "  float n=fbm(q+fbm(q*1.4+t*.01,3.)*.8,4.);",
    "  float den=smoothstep(.42,.82,n)*(.75-fi*.18);",
    "  vec3 cc=mix(c1*.55,c2*.35,fi*.45);",
    "  c=mix(c,cc,den*.55);",
    "  c+=mix(c2,c3,fi*.4)*pow(den,3.)*.25;",
    " }",
    " c+=mix(c2,vec3(1.),.4)*pow(max(0.,1.-abs((p.x+.4)*1.6-p.y*.8)),8.)*smoothstep(-.6,.6,p.y)*.05;",
    " for(int L=0;L<3;L++){float fl=float(L);float sc=8.+fl*7.;",
    "  vec2 g=p*sc+vec2(t*(.05+fl*.04),-t*(.02+fl*.015));vec2 id=floor(g);vec2 h=hash2(id+fl*7.);",
    "  vec2 f=fract(g)-.5-(h-.5)*.6;float sz=.22-fl*.06;",
    "  float b=step(.84,h.x)*smoothstep(sz,sz*.25,length(f))*(.5+.5*sin(t*(.6+h.y)+h.x*20.));",
    "  c+=mix(c2,c3,h.y)*b*(.5-fl*.1)*(1.+high*.8);}",
    " return c;",
    "}",
    "vec3 bgIrid(vec2 p,float t){",
    " vec2 q=p*1.1;",
    " vec2 w=vec2(fbm(q+vec2(t*.03,0.),4.),fbm(q+vec2(5.,t*.025),4.));",
    " float h=fbm(q*1.2+w*2.+vec2(t*.01,-t*.012),OCT);",
    " float ph=h*5.+w.x*2.+t*.05;",
    " vec3 film=c1*(.5+.5*cos(ph))+c3*(.5+.5*cos(ph+2.1))+c2*(.5+.5*cos(ph+4.2))*.8;",
    " float folds=smoothstep(.3,.75,h);",
    " float hb=fbm(q*1.2+w*2.+vec2(t*.01,-t*.012)+vec2(.02,.0),OCT);",
    " float edge=clamp((hb-h)*30.,-1.,1.);",
    " vec3 c=vec3(.01,.008,.025)+film*(.05+.42*folds*folds);",
    " c+=mix(film,vec3(1.),.55)*pow(.5+.5*sin(h*26.+t*.2),8.)*folds*.3;",
    " c+=film*max(edge,0.)*folds*.35;",
    " vec2 g=p*11.+vec2(t*.02,-t*.035);vec2 id=floor(g);vec2 hh=hash2(id+4.);vec2 f=fract(g)-.5-(hh-.5)*.6;",
    " c+=mix(vec3(1.),film,.4)*step(.86,hh.x)*exp(-dot(f,f)*160.)*(.18+.1*sin(t*.7+hh.y*30.))*(1.+high*.6);",
    " return c*(.9+mid*.2);",
    "}",
    "vec3 background(float id,vec2 p,float t){if(id<.5)return bgClassic(p,t);if(id<1.5)return bgSmoke(p,t);if(id<2.5)return bgAurora(p,t);if(id<3.5)return bgDeep(p,t);return bgIrid(p,t);}",
    "// ---------- HERO ENERGY ORB ----------",
    "// Two thin orbital rings tilted around the orb. For a pixel: its distance to the ring band, which half",
    "// (behind or in front of the orb) it belongs to, and its angle along the ring.",
    "vec3 orbRing(vec2 d,float R,float tilt,float rot,float rad,float t){",
    " float cr=cos(rot),sr=sin(rot);vec2 q=vec2(d.x*cr-d.y*sr,d.x*sr+d.y*cr);",
    " vec2 e=vec2(q.x,q.y/tilt);float r=length(e);",
    " float band=(r-rad*R)/(R*.022);",
    " float front=step(0.,q.y*sign(tilt))*2.-1.;",
    " return vec3(band,front,atan(e.y,e.x));",
    "}",
    "vec3 ringLight(vec3 rg,float t,float k){",
    " float core=exp(-rg.x*rg.x),wide=exp(-rg.x*rg.x*.08)*.25;",
    " // fine structure along the ring, light running round it, glints on the hats",
    " float lanes=.65+.35*sin(rg.z*40.+k*3.);",
    " float run=pow(.5+.5*sin(rg.z*2.-t*(1.2+k*.4)+k*2.),6.)*(.5+beat*1.2);",
    " float gl=step(.93,hash1(vec2(floor(rg.z*60.+t*3.),k)))*hat*2.;",
    " return mix(mix(c1,c3,k),vec3(1.),.25)*(core*lanes*(.35+run+gl)+wide*(.3+bass*.5));",
    "}",
    "vec4 heroOrb(vec2 p,float t){",
    " vec2 d=p-orbC;float r=length(d),R=orbR*(1.+bass*.09+beat*.05);",
    " float ang=atan(d.y,d.x),ou=max(r-R,0.);",
    " vec3 glowC=mix(mix(c1,c3,.45),c2,snare*.35);",
    " vec3 col=glowC*(exp(-ou/(R*.22))*.5+exp(-ou/(R*1.2))*.2)*(.65+energy*.5+beat*.35);",
    " // the rings behind the orb",
    " vec3 ra=orbRing(d,R,.28,.35+t*.02,1.55+bass*.05,t),rb=orbRing(d,R,-.2,-.5-t*.015,1.9,t);",
    " if(ra.y<0.)col+=ringLight(ra,t,0.)*.7;",
    " if(rb.y<0.)col+=ringLight(rb,t,1.)*.6;",
    " if(ou<R*2.2)for(int k=0;k<2;k++){float fk=float(k);",
    "  float tn=fbm(vec2(ang*(2.2+fk*1.5)+t*.15+fk*5.,ou/R*2.2-t*(1.1+fk*.4)),3.);",
    "  float ridge=pow(1.-abs(tn*2.-1.),30.);",
    "  float mask=smoothstep(.6,.85,noise(vec2(ang*1.6-t*.18+fk*9.,t*.45+fk*3.)))*(.5+beat*1.3+high*.6);",
    "  col+=mix(c2,vec3(.9,.85,1.),.3)*ridge*mask*exp(-ou/(R*(.3+fk*.12)))*smoothstep(R*.92,R,r)*1.4;}",
    " float a=0.;",
    " if(r<R*1.01){",
    "  vec2 q=d/R;float z=sqrt(max(0.,1.-dot(q,q)));vec3 n=vec3(q,z);",
    "  // looking into the glass: plasma at two depths, the deeper one smaller and slower (parallax)",
    "  vec2 s=q*(1.9/(.45+z))+vec2(t*.09,-t*.05);",
    "  vec2 s2=q*(1.2/(.3+z))+vec2(-t*.05,t*.03);",
    "  float plasma=fbm(s*1.3+vec2(t*.07,0.),OCT);",
    "  float deepP=fbm(s2*1.6+7.,3.);",
    "  float fil=fbm(s*1.9-vec2(t*.15,t*.1),4.);",
    "  float fil2=fbm(s*3.3+vec2(t*.08,t*.19)+3.,4.);",
    "  float veins=pow(1.-abs(fil*2.-1.),18.)+pow(1.-abs(fil2*2.-1.),26.)*.55;",
    "  vec3 deep=mix(c3*.08,c1*.14,plasma)+mix(c1,c3,deepP)*smoothstep(.45,.8,deepP)*.18*(1.-z*.4);",
    "  vec3 inner=deep+mix(c1,c3,.55)*smoothstep(.45,.85,plasma)*.45;",
    "  float core=exp(-dot(q,q)*3.)*(.25+bass*.55+energy*.2);",
    "  vec3 body=inner*(.55+.45*z)+mix(c3,c2,.5)*core*.5;",
    "  // the snare floods the veins with the accent colour",
    "  vec3 veinC=mix(mix(c2,mix(c3,vec3(1.),.3),smoothstep(.4,.7,fil2)),c3*1.3,snare*.7);",
    "  body+=veinC*veins*(.9+beat*1.1+high*.6+snare*.8)*(.55+.45*z);",
    "  // the glass shell: fresnel rim, a reflection of the room's colours, a sharp highlight",
    "  float fres=pow(1.-z,2.6);",
    "  vec3 rn=reflect(vec3(0.,0.,-1.),n);",
    "  vec3 env=mix(c3*.6,c1*.9,smoothstep(-.6,.8,rn.y))*(.6+.4*smoothstep(-.2,.9,rn.x));",
    "  body+=env*fres*.9+mix(c2,c3,.35+.25*sin(ang*2.+t*.3))*fres*.7;",
    "  body+=vec3(.95,.97,1.)*pow(max(dot(n,normalize(vec3(-.45,.55,.7))),0.),60.)*.6;",
    "  body+=vec3(.95,.97,1.)*pow(max(dot(n,normalize(vec3(-.45,.55,.7))),0.),9.)*.06;",
    "  body+=c3*pow(max(dot(n,normalize(vec3(.55,-.6,.55))),0.),5.)*.16;",
    "  // hi-hats: tiny glints across the surface",
    "  vec2 gq=q*14.+floor(t*8.);float gh=hash1(floor(gq));",
    "  body+=vec3(1.)*step(.96,gh)*exp(-dot(fract(gq)-.5,fract(gq)-.5)*18.)*hat*.8*z;",
    "  a=smoothstep(1.,.97,length(q));",
    "  col=mix(col,body,a);",
    " }",
    " // the rings in front of the orb",
    " if(ra.y>=0.)col+=ringLight(ra,t,0.);",
    " if(rb.y>=0.)col+=ringLight(rb,t,1.)*.85;",
    " return vec4(col,a);",
    "}",
    "// ---------- ENERGY FLOW: LIVING ENERGY FIELD ----------",
    "// Angle-periodic value noise: x wraps every P cells, so filaments drawn in log-polar space",
    "// close seamlessly around the field instead of tearing along the atan() seam.",
    "float noiseP(vec2 p,float P){",
    " vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);",
    " float x0=mod(i.x,P),x1=mod(i.x+1.,P);",
    " return mix(mix(hash1(vec2(x0,i.y)),hash1(vec2(x1,i.y)),f.x),mix(hash1(vec2(x0,i.y+1.)),hash1(vec2(x1,i.y+1.)),f.x),f.y);",
    "}",
    "float fbmP(vec2 p,float P,float oct){float v=0.,a=.5;for(int i=0;i<6;i++){if(float(i)>=oct)break;v+=a*noiseP(p,P);p*=2.;P*=2.;p.y+=17.3;a*=.5;}return v;}",
    "// Ultraviolet, electric blue, turquoise and hot pink, as one wrapping gradient.",
    "vec3 flowPal(float x){",
    " x=fract(x)*4.;float i=floor(x),f=x-i;f=f*f*(3.-2.*f);",
    " vec3 a=i<.5?f1:i<1.5?f2:i<2.5?f3:f4;",
    " vec3 b=i<.5?f2:i<1.5?f3:i<2.5?f4:f1;",
    " return mix(a,b,f);",
    "}",
    "vec3 livingField(vec2 p,float t,float R){",
    " float rr=length(p),a=atan(p.y,p.x),lr=log(rr+.045);",
    " float au=a/6.28319,inner=smoothstep(.0,.085,rr);",
    " // One slow warp field runs through every layer, so the plumes read as a single living body.",
    " vec2 wq=vec2(fbm(p*1.05+vec2(t*.05,-t*.02),3.),fbm(p*1.05+vec2(5.2,3.1)+vec2(-t*.04,t*.027),3.))-.5;",
    " vec3 col=mix(f3,f2,wq.y+.5)*smoothstep(.12,.45,wq.x+.5)*.03*smoothstep(1.5,.15,rr);",
    " for(int i=0;i<3;i++){float fi=float(i);if(fi>=2.+quality)break;",
    "  float dir=mod(fi,2.)<.5?1.:-1.;",
    "  float NA=9.+fi*6.;",
    "  // Filaments stream outward and shear with radius: midrange drives how hard they twist.",
    "  float lz=lr*(2.4+fi*.6)-t*(.1+fi*.05)-zph*(.022+fi*.008);",
    "  float tw=lr*dir*(.22+mid*1.9+surge*.45)+t*(.05+fi*.02)*dir;",
    "  vec2 lp=vec2(au*NA+tw*NA*.16+wq.x*1.5,lz+wq.y*1.25);",
    "  float n=fbmP(lp,NA,OCT);",
    "  float fil=pow(1.-abs(n*2.-1.),4.5+fi*1.8+high*5.);",
    "  // The outer edge follows the noise contour, so the fringe is lacy instead of a circle.",
    "  float edge=R*(1.+1.35*(n-.48)+.75*wq.x)*(1.-fi*.08);",
    "  float body=smoothstep(edge*1.1,edge*.1,rr);",
    "  float tail=exp(-max(rr-edge,0.)/max(R*.5,.03));",
    "  float dens=(body*(.035+fil*1.7)+tail*fil*.5)*inner;",
    "  float hue=(n-.5)*.8+rr*1.05+t*.005+fi*.14+mid*.1+build*.08;",
    "  vec3 lc=flowPal(hue);",
    "  if(i==0){",
    "   // One offset sample side-lights the ridges, which is what gives the plumes real relief.",
    "   float nb=fbmP(lp+vec2(.05,.05),NA,OCT);",
    "   float lit=clamp((nb-n)*22.,-1.,1.);",
    "   lc=mix(lc,vec3(1.),max(lit,0.)*.32);",
    "   col+=mix(lc,vec3(1.),.3)*max(-lit,0.)*(body+tail)*fil*.4;",
    "  }",
    "  col+=lc*dens*(1.2-fi*.28)*(.6+energy*.5)/(1.+energy*.45);",
    " }",
    " return col;",
    "}",
    "// ---------- SUPERNOVA BURST ----------",
    "vec3 supernova(vec2 p,float ag,float pw){",
    " float r=length(p),a=atan(p.y,p.x)+3.14159;",
    " vec3 o=vec3(0.);",
    " float fade=exp(-ag*1.25);",
    " o+=mix(f2,vec3(1.),.7)*exp(-pow((r-ag*1.8)/(.045+ag*.12),2.))*pw*fade*.85;",
    " o+=vec3(1.)*exp(-r*r*(150.+ag*900.))*pw*exp(-ag*7.)*1.3;",
    " // Rays: most short, a few reaching right across the field, so the burst never looks drawn.",
    " float N=48.,ab=a/6.28319*N,id=floor(ab),f=fract(ab)-.5;",
    " vec2 h=hash2(vec2(id,9.3));",
    " f+=(h.y-.5)*.55;",
    " float len=(.16+h.x*h.x*2.)*pw*(1.-exp(-ag*2.3))*1.3;",
    " float taper=smoothstep(len,len*.03,r)*smoothstep(.0,.05,r);",
    " float core=exp(-f*f*(320.+h.y*600.)),halo=exp(-f*f*(30.+h.x*55.));",
    " float st=step(.55,h.x)*taper*(.3+h.y*1.2);",
    " o+=flowPal(h.y*.9+.08)*halo*st*pw*fade*.55;",
    " o+=mix(flowPal(h.y*.9+.08),vec3(1.),.45)*core*st*pw*fade*1.05;",
    " // Thousands of luminous particles thrown outward, decelerating as the blast spends itself.",
    " float travel=(1.-exp(-ag*1.45))/1.45;",
    " for(int i=0;i<3;i++){float fi=float(i);",
    "  float Np=420.+fi*360.;",
    "  float pb=a/6.28319*Np,pid=floor(pb),pf=fract(pb)-.5;",
    "  vec2 ph=hash2(vec2(pid,fi*17.+2.7));",
    "  float v=(1.5+ph.x*3.6)*(.6+pw*.6);",
    "  float rp=.05+ph.y*.09+v*travel;",
    "  float dr=r-rp,da=pf*6.28319/Np*r;",
    "  float g=exp(-dr*dr*1500.-da*da*12000.);",
    "  o+=mix(flowPal(ph.x*.9+fi*.2),vec3(1.),.5)*g*pw*fade*2.2;",
    " }",
    " return o;",
    "}",
    "// ---------- ENERGY FLOW: TOUCH ----------",
    "// Fingers bend the field's own sampling space and recolour its own light, so every gesture is",
    "// made of the field itself rather than drawn over it. Compiled out of the Orb Experience build.",
    "#ifndef NO_TOUCH",
    "#ifndef FT_N",
    "#define FT_N 12",
    "#endif",
    "uniform float tOn;",
    "uniform vec4 tch[4], tcv[4], cbs[4], trA[FT_N], trB[FT_N];",
    "vec2 rot2(vec2 v,float a){float c=cos(a),s=sin(a);return vec2(c*v.x-s*v.y,s*v.x+c*v.y);}",
    "// tch: x,y,attract,contact  tcv: vx,vy,hue,_  cbs: x,y,age,hue  trA: x,y,vx,vy  trB: age,hue,link,power",
    "void touchField(vec2 p,float t,out vec2 disp,out vec3 tint,out float tw,out float lift,out vec3 glow){",
    " disp=vec2(0.);tint=vec3(0.);tw=0.;lift=0.;glow=vec3(0.);",
    " float pulse=1.+beat*.35+energy*.25;",
    " // Touch and hold: the surrounding energy is drawn in, wound gently round the fingertip, and",
    " // luminous motes stream inward along it.",
    " for(int i=0;i<4;i++){vec4 c=tch[i];if(c.z+c.w<.002)continue;",
    "  vec2 d=p-c.xy;float r2=dot(d,d);if(r2>2.6)continue;vec4 v=tcv[i];",
    "  float fall=exp(-r2*7.5);",
    "  // near: gather and wind in; far: the whole field leans and reaches toward the finger",
    "  float k=c.z*((.42+bass*.22)*fall+.34*exp(-r2*1.9))*(1.+.1*sin(t*2.3+float(i)));",
    "  disp+=c.xy+rot2(d,c.z*fall*fall*.85)*(1.+k)-p;",
    "  vec3 hc=flowPal(v.z);",
    "  tint+=hc*fall*c.z*.55;tw+=fall*c.z*.55;",
    "  lift+=fall*(.18*c.w+.55*c.z);",
    "  glow+=mix(hc,vec3(1.),.2)*exp(-r2*130.)*(c.w*.13+c.z*.2)*pulse;",
    "  if(c.z>.02&&r2<.16){",
    "   float r=sqrt(r2),ang=atan(d.y,d.x)/6.28319*34.;float id=floor(ang),af=fract(ang)-.5;",
    "   vec2 h=hash2(vec2(id,float(i)*7.1+3.3));",
    "   float rp=fract(h.x-t*(.22+h.y*.3+energy*.2))*.34;",
    "   float mr=(r-rp-.018)/.03;float mote=exp(-mr*mr-af*af*r*r*3800.)*smoothstep(.03,.11,rp)*smoothstep(.34,.2,rp)*step(.55,h.y);",
    "   glow+=mix(flowPal(v.z+h.y*.25),vec3(1.),.25)*mote*c.z*.3*pulse;",
    "  }",
    " }",
    " // Drag: the field is carried along each stroke and left as a soft wake that diffuses and fades.",
    " for(int i=0;i<FT_N-1;i++){vec4 b=trB[i];if(b.z<.5)continue;",
    "  vec4 A=trA[i],B=trA[i+1],b2=trB[i+1];",
    "  vec2 ab=B.xy-A.xy;float h=clamp(dot(p-A.xy,ab)/max(dot(ab,ab),1e-6),0.,1.);",
    "  vec2 dd=p-A.xy-ab*h;",
    "  float ag=mix(b.x,b2.x,h),wid=.05+ag*.075;",
    "  float f=exp(-dot(dd,dd)/(wid*wid))*exp(-ag*1.35)*smoothstep(3.2,2.3,ag)*mix(b.w,b2.w,h);",
    "  if(f<.003)continue;",
    "  vec2 vel=mix(A.zw,B.zw,h);",
    "  float wisp=noise(vec2((float(i)+h)*1.7-t*.9,dot(dd,dd)*400.+t*.3));",
    "  disp-=vel*f*.075;",
    "  disp+=vec2(-vel.y,vel.x)*(wisp-.5)*f*.06;",
    "  float hu=mix(b.y,b2.y,h)+h*.12+wisp*.18;",
    "  tint+=flowPal(hu)*f*.9;tw+=f*.9;",
    "  lift+=f*(.45+wisp*.35);",
    "  glow+=mix(flowPal(hu+.08),vec3(1.),.3)*f*f*smoothstep(.35,.8,wisp)*.16*pulse;",
    " }",
    " // Tap: a burst of colour soaks outward through the field with an uneven, living edge.",
    " for(int i=0;i<4;i++){vec4 c=cbs[i];if(c.z>3.5)continue;",
    "  vec2 d=p-c.xy;float r=length(d),ag=c.z;if(r>.62)continue;",
    "  float front=(1.-exp(-ag*2.1))*.42;",
    "  float ang=atan(d.y,d.x);",
    "  float wob=noise(vec2(cos(ang),sin(ang))*1.8+c.w*37.+ag*.35)*.65+noise(d*6.+c.w*19.)*.45;",
    "  float edge=max(front*(.62+wob*.6),.001);",
    "  float fade=exp(-ag*.8)*smoothstep(3.5,2.4,ag);",
    "  float w=smoothstep(edge,edge*.35,r)*fade;",
    "  float le=(r-edge)/(.04+ag*.06);float lead=exp(-le*le)*fade*smoothstep(.0,.12,ag);",
    "  vec3 bc=flowPal(c.w+r*1.1+wob*.3);bc=mix(bc,flowPal(c.w+.5),.25*smoothstep(.0,.15,r));",
    "  tint+=bc*(w+lead*.7)*1.5;tw+=(w+lead*.7)*1.5;",
    "  lift+=lead*.8+w*.35;",
    "  disp+=d/max(r,.001)*lead*.028;",
    "  glow+=mix(flowPal(c.w),vec3(1.),.4)*exp(-r*r*(240.+ag*500.))*exp(-ag*3.5)*.45*pulse;",
    " }",
    "}",
    "#endif",
    "vec3 flowScene(vec2 p,float t){",
    "#ifndef NO_TOUCH",
    " vec2 tDisp=vec2(0.);vec3 tTint=vec3(0.),tGlow=vec3(0.);float tW=0.,tLift=0.;",
    " if(tOn>.001){touchField(p,t,tDisp,tTint,tW,tLift,tGlow);p+=tDisp;}",
    "#endif",
    " p-=vec2(.09*sin(t*.045),.05*cos(t*.06));",
    " // The blast wave pushes the whole formation outward, then it settles back.",
    " float shock=bPow*exp(-pow((length(p)-bAge*1.75)/(.16+bAge*.4),2.))*step(bAge,3.);",
    " p*=max(.3,1.-shock*.36);",
    " // The blast throws the field open, then it draws back in and blooms again as the shock dies.",
    " float R=max(.08,.22+bass*.26+energy*.1+build*.12+beat*.05+surge*.05-recoil*.14);",
    " float rr=length(p),a=atan(p.y,p.x);",
    " vec3 col=vec3(.003,.002,.011);",
    " // far behind: fine dust drifting slowly outward in two depths, so the field floats in space",
    " for(int L=0;L<2;L++){float fl=float(L);float sc=34.+fl*30.;",
    "  vec2 dq=p*sc*(1.+fract(t*(.012+fl*.01))*.0)+vec2(t*(.08+fl*.05),-t*.03);vec2 did=floor(dq);vec2 dh=hash2(did+fl*9.);",
    "  vec2 df=fract(dq)-.5-(dh-.5)*.7;float dd=step(.86,dh.x)*exp(-dot(df,df)*(40.+fl*30.));",
    "  col+=flowPal(dh.y)*dd*(.12+high*.25+hat*.3)*(1.-fl*.35);}",
    " col+=livingField(p,t,R)*(1.-burst*.72);",
    " float coreP=.3+bass*.5+beat*.4+burst*.55;",
    " col+=mix(f1,vec3(1.),.22)*exp(-rr*rr*(66.-bass*24.))*coreP*.8;",
    " col+=mix(f4,f3,.45)*exp(-rr*(6.-bass*1.8))*(.05+energy*.1+build*.1);",
    " // One expanding pulse per detected beat, broken up by angle so it never reads as a drawn circle.",
    " float ringN=.55+.45*noiseP(vec2(a/6.28319*7.,t*.3),7.);",
    " float ring=exp(-pow((rr-bphase*(.8+bass*.4)*ringN)/(.1+bass*.07),2.))*(1.-bphase)*(.35+bass*.8+beat*.5);",
    " col*=1.+ring*.75;",
    " col+=flowPal(.15+bphase*.3)*ring*.1;",
    " // High frequencies: fine sparks riding the lit plasma.",
    " vec2 sg=vec2(a/6.28319*120.,log(rr+.045)*7.5-t*1.1);",
    " vec2 sid=floor(sg),sh=hash2(sid);",
    " vec2 sf=fract(sg)-.5-(sh-.5)*.7,sd=sf*vec2(2.55,1.);",
    " float spk=step(.985-high*.13,sh.x)*exp(-dot(sd,sd)*30.)*(.2+sh.y*.9);",
    " col+=mix(flowPal(sh.y*.6+.05),vec3(1.),.3)*spk*(.06+high*1.2+hat*.9)*smoothstep(.02,.25,dot(col,vec3(.3,.5,.2)));",
    " // the snare: a sharp flare of colour through the field's ridges",
    " col+=flowPal(.62+t*.01)*snare*.35*smoothstep(.05,.4,dot(col,vec3(.3,.5,.2)));",
    "#ifndef NO_TOUCH",
    " if(tOn>.001){",
    "  // touch colour soaks into the energy that is already there, then lights it",
    "  float L=dot(col,vec3(.3,.5,.2));",
    "  vec3 tc=tTint/max(tW,.001);float k=clamp(tW,0.,1.)*.82;",
    "  col=mix(col,tc*L*1.75,k*smoothstep(.0,.06,L))+tc*k*.03;",
    "  col*=1.+tLift*(1.+beat*.35+energy*.25);",
    "  col+=tGlow;",
    " }",
    "#endif",
    " // keep the colour when the field is loud: a soft knee instead of burning to white",
    " col=col/(1.+dot(col,vec3(.3,.45,.25))*.55);",
    " if(burst>.001)col+=supernova(p,bAge,bPow);",
    " return col;",
    "}",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;",
    " OCT=4.+quality;",
    " float t=T;",
    " vec3 col=vec3(0.);",
    "#ifndef NO_ORB",
    " if(flow<.999){",
    "  vec3 bg=background(bgA,uv,t);",
    "  if(bgMix>.001)bg=mix(bg,background(bgB,uv,t),bgMix);",
    "  vec4 o=heroOrb(uv,t);",
    "  col=bg*(1.-o.a*.92)+o.rgb;",
    " }",
    "#endif",
    "#ifndef NO_FLOW",
    " if(flow>.001){",
    "  vec3 f=flowScene(uv,t);",
    "  float n=fbm(uv*1.8+t*.05,3.);",
    "  col=flow>=.999?f:mix(col,f,smoothstep(n-.15,n+.15,flow*1.3-.15));",
    " }",
    "#endif",
    " float lum=dot(col,vec3(.299,.587,.114));col=max(mix(vec3(lum),col,1.2),0.);",
    " col=col*(2.51*col+.03)/(col*(2.43*col+.59)+.14);",
    " col=pow(clamp(col,0.,1.),vec3(.92));",
    " col*=.72+.28*smoothstep(1.3,.25,length(uv*vec2(.85,1.)));",
    " col+=(hash1(gl_FragCoord.xy+fract(t*11.))-.5)/255.*2.;",
    " gl_FragColor=vec4(clamp(col,0.,1.),1.);",
    "}"
  ].join('\n');
  var INK_SHADER = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
// INK MACHINE: a journey through a tunnel of living neon membranes. Six translucent flower-like
// structures, each with its own symmetry, spin and ribbed skin, fly out of a glowing core toward
// the viewer and pass by; sparks stream past; beats send rings of light down the tunnel.
uniform vec2 res;
uniform float T, bass, mid, high, energy, beat, blast, blastAge, build, quality, prism, swirl, fadeIn;
uniform vec3 k1, k2, k3, k4, k5;
uniform vec4 bursts[3];   // x, y, age (s), power
uniform vec4 drags[4];    // x, y, velocity x, velocity y (already scaled by remaining life)
uniform vec4 twist;       // x, y, strength, wind (radians)
uniform vec4 splash;      // x, y, direction x * power, direction y * power
uniform float splashAge;
uniform vec4 inj[2];      // x, y, amount, palette position
float hash1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash1(i),hash1(i+vec2(1.,0.)),f.x),mix(hash1(i+vec2(0.,1.)),hash1(i+vec2(1.,1.)),f.x),f.y);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
// Four palette colours blended in bands (the fifth is the highlight tint); Prismatic adds film colour.
vec3 inkPal(float x){
 x=fract(x)*4.;
 float i=floor(x), f=smoothstep(.2,.8,fract(x));
 vec3 a=i<1.?k1:(i<2.?k2:(i<3.?k3:k4));
 vec3 b=i<1.?k2:(i<2.?k3:(i<3.?k4:k1));
 vec3 c=mix(a,b,f);
 if(prism>.5){vec3 r=.5+.5*cos(6.28318*(x*.25+vec3(0.,.33,.67)));c=mix(c,r*r*1.3+.04,.7);}
 return c;
}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;
 float t=T;
 vec2 p=uv;
 // ---------- touch: each gesture bends the view of the tunnel ----------
 float hueKick=0., touchGlow=0.;
 for(int i=0;i<3;i++){vec4 b=bursts[i];if(b.w<=0.)continue;
  vec2 d=p-b.xy;float r=length(d)+1e-4;
  float env=b.w*exp(-b.z*1.6);
  // a ring wave spreads from the finger, bending everything it passes through
  float front=b.z*.75, wave=exp(-pow((r-front)*34.,2.));
  p+=d/r*wave*env*.035;
  touchGlow+=wave*env;
  hueKick+=env*exp(-r*r*12.);
 }
 if(twist.z>.001){vec2 d=p-twist.xy;float f=exp(-dot(d,d)/(.02+.06*twist.z));p=twist.xy+rot(twist.w*f)*d;hueKick+=twist.z*f*.3;}
 for(int i=0;i<4;i++){vec4 g=drags[i];float sp=length(g.zw);if(sp<.001)continue;
  vec2 d=p-g.xy;vec2 dir=g.zw/sp;float a=dot(d,dir),q=dot(d,vec2(-dir.y,dir.x));
  float f=exp(-(a*a*8.+q*q*40.));
  p-=g.zw*f*.09;touchGlow+=min(sp,2.)*f*.08;
 }
 if(splashAge<3.&&length(splash.zw)>.001){vec2 d=p-splash.xy;float env=exp(-splashAge*1.4)*(1.-exp(-splashAge*16.));
  p-=splash.zw*exp(-dot(d,d)*4.)*env*.15;touchGlow+=env*exp(-dot(d,d)*30.)*.4;}
 // ---------- the camera sways gently; the mids add a slow roll ----------
 p-=vec2(.035*sin(t*.11),.022*cos(t*.083));
 p=rot(.06*sin(t*.07)+swirl*.12)*p;
 float r0=length(p);
 // ---------- deep background: space, a far nebula and the glowing core of the tunnel ----------
 vec3 col=mix(vec3(.004,.002,.014),vec3(.018,.008,.045),exp(-r0*1.4));
 vec2 nd=p/(r0+1e-4);
 float neb=noise(nd*1.7+vec2(t*.02,0.)+r0*1.5)*.6+(quality>.5?noise(nd*3.4-vec2(0.,t*.03)+r0*3.)*.4:.2);
 col+=mix(k3,k1,neb)*smoothstep(.45,.9,neb)*.10*smoothstep(.15,.9,r0)*(.7+energy*.6);
float core=exp(-r0*9.)*(.55+beat*.6+blast*.5)+exp(-r0*3.2)*.18;
 col+=mix(k5,vec3(1.),.4)*core*(.8+energy*.5);
 // rings of light racing down the tunnel on the beat and on drops
 float ringR=fract(t*.35)*1.6;
 col+=mix(k1,k2,.5)*exp(-pow((r0-ringR)*10.,2.))*beat*.35;
 if(blastAge<2.5)col+=mix(k2,vec3(1.),.4)*(exp(-pow((r0-blastAge*1.1)*18.,2.))*1.1+exp(-pow((r0-blastAge*1.1)*6.,2.))*.035)*blast;
 // colour injections: weigh them once here rather than once per membrane
 float iw0=inj[0].z>.001?exp(-dot(uv-inj[0].xy,uv-inj[0].xy)/(.02+inj[0].z*.08))*min(1.,inj[0].z*1.5):0.;
 float iw1=inj[1].z>.001?exp(-dot(uv-inj[1].xy,uv-inj[1].xy)/(.02+inj[1].z*.08))*min(1.,inj[1].z*1.5):0.;
 float iPos=iw0>=iw1?inj[0].w:inj[1].w, iW=max(iw0,iw1);
 bool treble=high>.03;
 // ---------- the membranes, far to near ----------
 float travel=t*(.085+build*.03);
 float NL=quality>.5?6.:5.;                       // the 2 GB box flies five membranes, larger boxes six
 for(int i=0;i<6;i++){float fi=float(i);
  if(fi>=NL)break;
  float z=1.-fract(travel+fi/NL);                 // 1 = far, 0 = passing the viewer
  float dist=.12+z*2.7;
  float vis=(1.-smoothstep(.78,1.,z))*smoothstep(.10,.34,z);   // fade in far away, out before it fills the view
  if(vis<.04)continue;
  float id=floor(travel+fi/NL)*NL+fi;            // each new membrane gets its own design
  float hid=hash1(vec2(id,1.7)), hid2=hash1(vec2(id,8.3));
  vec2 lp=p*dist/.46;
  lp=rot(hid*6.28+t*(.06+hid2*.08)*(hid>.5?1.:-1.)+swirl*.5*(1.-z))*lp;
  // each membrane tilts as it turns, so it reads as a shape in space rather than a flat sticker
  float tilt=.72+.28*cos(t*(.15+hid2*.1)+hid*6.28);
  lp.y/=tilt;
  float r=length(lp)+1e-4, a=atan(lp.y,lp.x);
  float k=floor(4.+hid*5.);                      // 4 to 8 petals
  float breath=1.+bass*.28+beat*.10+blast*.45;
  float petal=.60+.20*sin(k*a+t*.35+hid*6.)+.07*sin(2.*k*a-t*.6)+.05*noise(lp/r*2.5+vec2(t*.1,id));
  petal*=breath;
  float edge=r-petal;
  float inside=1.-smoothstep(-.015,.02,edge);
  // ribbed, flowing skin: contour lines of a field that the mids twist and the music ripples
  float flow=r*(2.6+hid2*1.6)+.30*sin(k*a+r*5.-t*.7+mid*2.5)+.12*sin(3.*k*a-t*.4)-t*.25;
  float rib=pow(1.-abs(fract(flow)-.5)*2.,5.+(1.-quality)*2.);
  float veins=pow(max(0.,sin(k*a*.5+hid*9.+sin(r*6.-t*.5)*.6)),18.)*smoothstep(.15,.5,r);
  float rim=exp(-abs(edge)*(26.+z*20.))+exp(-abs(edge)*(6.+(1.-z)*10.))*.24*z;
  // colour: each membrane takes its own place on the palette and shifts as it travels
  // inner skin and rim sit on different parts of the palette, so every membrane is two-toned
  vec3 cIn=inkPal(hid*.97+z*.22+t*.012);
  vec3 cRim=inkPal(hid*.97+.5+t*.012);
  cIn=mix(cIn,cRim,clamp(hueKick*.5,0.,.7));
  if(iW>.002){cIn=mix(cIn,inkPal(hid*.9+iPos+.5),iW);cRim=mix(cRim,inkPal(iPos+.75),iW);}
  vec3 cRib=mix(cIn,cRim,.55);
  float sparkle=treble?high*pow(noise(lp*14.+t*3.),6.)*6.:0.;
  vec3 lc=cIn*inside*(.08+veins*.55)+cRib*inside*rib*.55*(.6+mid*.7)
         +mix(cRim,vec3(1.),.12+high*.2)*rim*(.85+high*.5+sparkle)
         +cIn*exp(-r*4.)*inside*.22;
  float depth=mix(1.15,.35,z);                   // near membranes are brighter, far ones sink into haze
  lc*=.72+.38*max(0.,cos(a-2.2+hid))+(1.-tilt)*.3*sin(a);   // lit from one side, darker on the far side
  // translucent: what lies behind shows through the skin, dimmed a little
  col=col*(1.-inside*vis*.32)+lc*vis*depth*(1.+energy*.35+beat*.2);
 }
 // ---------- sparks streaming outward past the viewer; the treble makes them glitter ----------
 float pa=atan(p.y,p.x)/6.28318+.5;
 for(int s=0;s<2;s++){float fs=float(s);
  float cells=34.+fs*22.;
  float a=pa;
  float ci=floor(a*cells);
  float h=hash1(vec2(ci,fs*7.+3.)), h2=hash1(vec2(ci,fs*7.+9.));
  float ph=fract(t*(.18+h*.22)*(1.+bass*.8+blast*1.5)+h2);
  float rr=ph*ph*1.5;
  float ca=(ci+.5)/cells*6.28318-3.14159;
  vec2 sp=vec2(cos(ca),sin(ca))*rr;
  vec2 d=p-sp;vec2 dir=vec2(cos(ca),sin(ca));
  float along=dot(d,dir), side=dot(d,vec2(-dir.y,dir.x));
  float len=.03+ph*.13*(1.+bass*.8);
  float sk=exp(-side*side*60000.)*smoothstep(-len,0.,along)*(1.-smoothstep(0.,.004,along))*(1.-step(.5,abs(fract(a*cells)-.5)*2.));
  col+=mix(inkPal(h*2.),vec3(1.),.4)*sk*step(.45,h2)*smoothstep(.0,.2,ph)*(.6+high*1.2+energy*.4);
 }
 col+=inkPal(hueKick*.4+t*.02)*touchGlow*.35;
 col*=fadeIn;
 float lum=dot(col,vec3(.299,.587,.114));col=max(mix(vec3(lum),col,1.15),0.);
 col=col*(2.51*col+.03)/(col*(2.43*col+.59)+.14);
 col=pow(clamp(col,0.,1.),vec3(.92));
 col*=.8+.2*(1.-smoothstep(.4,1.4,length(uv*vec2(.85,1.))));
 col+=(hash1(gl_FragCoord.xy+fract(t*11.))-.5)/255.*2.;
 gl_FragColor=vec4(clamp(col,0.,1.),1.);
}
`;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function accent(alpha) { var c = presets[preset].accent; return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')'; }
  function setPreset(name) {
    if (!presets[name]) return;
    preset = name; sprites = {}; presetRgb = presets[name].colors.map(hexRgb); flowRgb = presets[name].flow.map(hexRgb);
    root.setAttribute('data-preset', name);
    Array.prototype.forEach.call(document.querySelectorAll('.party-preset'), function (el) {
      el.classList.toggle('active', el.getAttribute('data-preset') === name);
      el.setAttribute('aria-pressed', el.getAttribute('data-preset') === name ? 'true' : 'false');
    });
    for (var i = 0; i < orbs.length; i++) orbs[i].color = i % presets[preset].colors.length;
    try { localStorage.setItem('nexus.party.preset', name); } catch (e) {}
  }
  function setMode(name) {
    if (modes.indexOf(name) < 0) return;
    if (mode !== name) {
      mode = name; modeStarted = performance.now();
      impulses.length = 0;
      for (var i = 0; i < orbs.length; i++) {
        var o = orbs[i];
        if (name === 'chaos') { o.vx += rand(-1.6, 1.6); o.vy += rand(-1.6, 1.6); }
        else if (name === 'vortex') { o.vx += (w * .5 - o.x) * .002; o.vy += (h * .46 - o.y) * .002; }
        else if (name === 'wave') { o.waveBase = o.y; o.waveX = o.x; }
      }
    }
    Array.prototype.forEach.call(document.querySelectorAll('.party-mode'), function (el) {
      el.classList.toggle('active', el.getAttribute('data-mode') === name);
      el.setAttribute('aria-pressed', el.getAttribute('data-mode') === name ? 'true' : 'false');
    });
    root.setAttribute('data-mode', name);
  }
  function glCompile(type, src) {
    var sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(sh); gl.deleteShader(sh); throw new Error(log || 'shader'); }
    return sh;
  }
  // A build key is a variant, optionally followed by '@' and the one or two backgrounds it needs
  // ('orb@2', 'orb@0,3'). Each build only contains the backgrounds on screen, instead of all five.
  var BG_FNS = ['bgClassic', 'bgSmoke', 'bgAurora', 'bgDeep', 'bgIrid'];
  var BG_LINE = 'vec3 background(float id,vec2 p,float t){if(id<.5)return bgClassic(p,t);if(id<1.5)return bgSmoke(p,t);if(id<2.5)return bgAurora(p,t);if(id<3.5)return bgDeep(p,t);return bgIrid(p,t);}';
  function partySource(key) {
    var parts = key.split('@'), variant = parts[0], src = PARTY_SHADER;
    if (parts[1] !== undefined) {
      var ids = parts[1].split(',').map(Number), a = ids[0], b = ids.length > 1 ? ids[1] : a;
      src = src.replace(BG_LINE, 'vec3 background(float id,vec2 p,float t){' + (a === b ? '' : 'if(abs(id-' + a + '.)<.5)return ' + BG_FNS[a] + '(p,t);') + 'return ' + BG_FNS[b] + '(p,t);}');
    }
    var touch = touchN > 0 ? '#define FT_N ' + touchN + '\n' : '#define NO_TOUCH\n';
    return (variant === 'orb' ? '#define NO_FLOW\n#define NO_TOUCH\n' : (variant === 'flow' ? '#define NO_ORB\n' : '') + touch) + src;
  }
  function bgKey(variant) {
    if (variant === 'flow' || variant === 'ink') return variant;
    return variant + '@' + (bgFrom === bgTo ? bgTo : Math.min(bgFrom, bgTo) + ',' + Math.max(bgFrom, bgTo));
  }
  function glBuild(variant) {
    if (!gl || glProgs[variant] !== undefined) return glProgs[variant] || null;
    try {
      var vs = glCompile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'), fs = glCompile(gl.FRAGMENT_SHADER, variant === 'ink' ? INK_SHADER : partySource(variant));
      var prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
      var u = {};
      (variant === 'ink' ? INK_UNIFORMS : GL_UNIFORMS).forEach(function (n) { u[n] = gl.getUniformLocation(prog, n); });
      glProgs[variant] = prog; glUs[variant] = u;
    } catch (e) {
      glProgs[variant] = null;
      try { console.warn('Party GL ' + variant + ' build: ' + e.message); } catch (err) {}
      // A GPU that cannot fit the touch layer still gets the full Energy Flow, with less or no touch.
      if (variant !== 'ink' && variant.indexOf('orb') !== 0 && touchN > 0) {
        touchN = touchN > 6 ? 6 : 0;
        for (var k in glProgs) if (k !== 'ink' && k.indexOf('orb') !== 0) { if (glProgs[k]) gl.deleteProgram(glProgs[k]); delete glProgs[k]; }
        return glBuild(variant);
      }
    }
    return glProgs[variant];
  }
  function glUse(variant) {
    var key = bgKey(variant), prog = glBuild(key);
    if (!prog && key !== variant) { key = variant; prog = glBuild(key); }
    if (!prog && variant === 'ink') return false;
    if (!prog && variant !== 'both') { variant = key = 'both'; prog = glBuild(key); }
    if (!prog) return false;
    if (prog !== glProg) {
      glProg = prog; glU = glUs[key]; glVariant = variant;
      gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
      var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    return true;
  }
  // Compile the other builds shortly after Party opens, so switching experience never stalls a frame.
  function glWarm() {
    var order = [bgKey('orb'), 'flow', bgKey('both'), 'ink'], i = 0;
    (function next() {
      if (!glOk || !gl || !active) return;
      while (i < order.length && glProgs[order[i]] !== undefined) i++;
      if (i >= order.length) return;
      glBuild(order[i++]);
      setTimeout(next, 280);
    })();
  }
  function glInit() {
    if (glOk || glFailed || !glCanvas) return glOk;
    try {
      gl = glCanvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: highMemory ? 'high-performance' : 'default' }) ||
        glCanvas.getContext('experimental-webgl', { alpha: false, antialias: false, depth: false });
      if (!gl) throw new Error('no webgl');
      var fuv = 0; try { fuv = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 0; } catch (err) {}
      touchN = fuv >= 128 ? 12 : fuv >= 72 ? 6 : 0;
      glBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      if (!glUse(experience === 'flow' ? 'flow' : 'orb')) throw new Error('shader');
      if (experience === 'ink' && !glBuild('ink')) inkUnavailable();
      glOk = true; glFrames = 0; root.setAttribute('data-gl', 'on');
      setTimeout(glWarm, 900);
    } catch (e) {
      glFailed = true; glOk = false; glDestroy(); root.setAttribute('data-gl', 'off');
      if (experience === 'flow' || experience === 'ink') { experience = 'orb'; flowTarget = 0; flowMix = 0; inkTarget = inkMix = 0; }
      if (backdrop !== 'classic') { backdrop = 'classic'; bgFrom = bgTo = 0; bgMix = 0; }
      try { console.warn('Party GL unavailable: ' + e.message); } catch (err) {}
    }
    syncExperienceUi();
    return glOk;
  }
  function glDestroy() {
    if (gl) {
      try {
        for (var k in glProgs) if (glProgs[k]) gl.deleteProgram(glProgs[k]);
        if (glBuf) gl.deleteBuffer(glBuf);
      } catch (e) {}
    }
    gl = null; glProg = null; glBuf = null; glU = {}; glProgs = {}; glUs = {}; glVariant = ''; glOk = false;
    if (glCanvas && !glFailed) { glCanvas.width = 1; glCanvas.height = 1; }
  }
  function glResize() {
    if (!glCanvas) return;
    var gw = Math.max(2, Math.round(w * glScale)), gh = Math.max(2, Math.round(h * glScale));
    if (glCanvas.width !== gw || glCanvas.height !== gh) { glCanvas.width = gw; glCanvas.height = gh; }
  }
  function tint(rgb, k) { return [rgb[0] / 255 * k, rgb[1] / 255 * k, rgb[2] / 255 * k]; }
  // ---- Energy Flow: music analysis and the Supernova Burst event ----
  // A burst is a real event rather than a per-beat animation: a modest one on a strong bass hit,
  // a spectacular one when a build-up resolves, when the mix erupts out of a breakdown, or when
  // the kick clears its own recent peak. The rate limits are what keep the big ones feeling earned.
  function triggerBurst(power) {
    burstPower = Math.min(1.7, power); burstAge = 0; burstEnv = 0; burstCount++;
    lastBurstAt = performance.now();
    fieldRecoil = Math.min(.9, fieldRecoil + power * .4);
    surge = Math.min(1.6, surge + power * .3);
  }
  function detectBurst(now) {
    if (experience !== 'flow' || !glOk) return;
    var punch = bassFast - bassSlow;
    if (!(punch > Math.max(.02, bassSlow * 1.05) && bassFast > .032 && musicLevel > .12)) return;
    if (now - lastBurstAt < 820) return;
    var erupts = now - lastQuietAt < 900 && punch > .045;
    var clears = bassFast > bassPeak * .97 && punch > Math.max(.045, bassSlow * 2.1);
    var major = buildUp > .55 || erupts || clears;
    if (major && now - lastDropAt > 2600) {
      triggerBurst(1.05 + Math.min(.6, punch * 5 + buildUp * .5)); lastDropAt = now; buildUp *= .2;
    } else if (!major) {
      triggerBurst(.45 + Math.min(.35, punch * 4));
    }
  }
  function analyseMusic(s, now) {
    if (energyFast < .06) lastQuietAt = now;
    // Build-up: the short window pulling away from the long one, with rising highs (risers, rolls).
    var rise = (energyFast - energySlow) / Math.max(.045, energySlow);
    var hiRise = (highFast - highSlow) / Math.max(.03, highSlow);
    var climbing = clamp(rise * .7 + hiRise * .5, 0, 1.4);
    if (climbing > .3 && musicLevel > .12) buildUp = Math.min(1, buildUp + s * climbing * .75);
    else buildUp = Math.max(0, buildUp - s * .5);
    // Beat clock: free-runs on the learned period so pulses stay in time through a missed kick.
    if (beatPeriod > .05) beatPhase = Math.min(1, beatPhase + s / beatPeriod);
    if (beatConfidence > .45 && beatPhase >= 1 && now - lastBeatAt > beatPeriod * 1100) { beatPhase = 0; lastBeatAt = now; }
    burstAge = Math.min(9, burstAge + s);
    burstEnv = burstPower > 0 ? clamp(Math.min(1, burstAge * 22) * Math.exp(-burstAge * 1.3) * burstPower, 0, 1) : 0;
    if (burstPower > 0 && burstEnv < .002 && burstAge > .4) burstPower = 0;
    fieldRecoil = Math.max(0, fieldRecoil - s * fieldRecoil * 2.4 - s * .08);
  }
  // ---- Energy Flow touch ----
  // Envelopes ease in and out so the field gathers, follows and then settles back on its own;
  // once everything has decayed the shader skips the touch layer and the idle scene is unchanged.
  function flowTouchStep(s, now, eNorm, beatN) {
    var on = 0, i, t;
    for (i = 0; i < 4; i++) {
      t = flowTouches[i];
      var held = t.down ? (now - t.t0) / 1000 : 0;
      var target = t.down && held > .16 ? (t.dragging ? .5 : 1) : 0;
      if (t.down && !t.held && !t.dragging && held > .45) { t.held = true; flowGestures.hold++; }
      // rising eases in; letting go eases out but always finishes (about 2.5 s), so the idle field returns exactly
      if (target > t.attract) t.attract += (target - t.attract) * Math.min(1, s * 1.25);
      else t.attract = Math.max(target, t.attract - s * (t.attract * .9 + .08));
      if (t.down) t.contact += (1 - t.contact) * Math.min(1, s * 9);
      else t.contact = Math.max(0, t.contact - s * (t.contact * 1.3 + .1));
      var decay = Math.exp(-s * (t.down ? 5 : 3));
      t.vx *= decay; t.vy *= decay;
      // with music the touch colour drifts through the palette, faster when the mix is driving
      t.hue = (t.hue + s * (.012 + eNorm * .09 + beatN * .04)) % 1;
      on += t.attract + t.contact;
    }
    for (i = 0; i < 4; i++) { var b = flowBursts[i]; if (b.age < 9) { b.age += s; if (b.age > 3.5) b.age = 9; else on += 1; } }
    for (i = flowWake.length - 1; i >= 0; i--) { flowWake[i].age += s; if (flowWake[i].age > 3.2) flowWake.splice(i, 1); }
    flowTouchOn = on + flowWake.length;
  }
  function flowTouchUpload() {
    var B = touchBuf, i, k, t;
    for (i = 0; i < 4; i++) {
      t = flowTouches[i]; k = i * 4;
      B.tch[k] = (t.x - w * .5) / h; B.tch[k + 1] = -(t.y - h * .5) / h; B.tch[k + 2] = t.attract; B.tch[k + 3] = t.contact;
      B.tcv[k] = t.vx / h; B.tcv[k + 1] = -t.vy / h; B.tcv[k + 2] = t.hue; B.tcv[k + 3] = 0;
      var b = flowBursts[i];
      B.cbs[k] = (b.x - w * .5) / h; B.cbs[k + 1] = -(b.y - h * .5) / h; B.cbs[k + 2] = b.age; B.cbs[k + 3] = b.hue;
    }
    // The wake: stored points plus a live head at each dragging finger, newest kept, grouped per stroke
    // oldest-first so the shader can join neighbours into smooth segments.
    var pts = flowWake.slice();
    for (i = 0; i < 4; i++) { t = flowTouches[i]; if (t.down && t.dragging) pts.push({ x: t.x, y: t.y, vx: t.vx, vy: t.vy, age: 0, hue: t.hue, pow: 1, stroke: t.stroke, seq: 1e9 }); }
    pts.sort(function (a, b) { return a.age - b.age; });
    if (pts.length > touchN) pts.length = touchN;
    pts.sort(function (a, b) { return a.stroke - b.stroke || a.seq - b.seq; });
    for (i = 0; i < touchN; i++) {
      var p = pts[i], q = pts[i + 1]; k = i * 4;
      if (p) {
        var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy) / h, cap = sp > 2.6 ? 2.6 / sp : 1;
        B.trA[k] = (p.x - w * .5) / h; B.trA[k + 1] = -(p.y - h * .5) / h; B.trA[k + 2] = p.vx / h * cap; B.trA[k + 3] = -p.vy / h * cap;
        B.trB[k] = p.age; B.trB[k + 1] = p.hue; B.trB[k + 2] = q && q.stroke === p.stroke ? 1 : 0; B.trB[k + 3] = p.pow;
      } else { B.trA[k] = B.trA[k + 1] = B.trA[k + 2] = B.trA[k + 3] = 0; B.trB[k] = 9; B.trB[k + 1] = B.trB[k + 2] = B.trB[k + 3] = 0; }
    }
    gl.uniform1f(glU.tOn, flowTouchOn);
    gl.uniform4fv(glU.tch, B.tch); gl.uniform4fv(glU.tcv, B.tcv); gl.uniform4fv(glU.cbs, B.cbs);
    gl.uniform4fv(glU.trA, B.trA.subarray(0, touchN * 4)); gl.uniform4fv(glU.trB, B.trB.subarray(0, touchN * 4));
  }
  function flowColourBurst(x, y, hue) {
    var b = flowBursts[flowBurstNext]; flowBurstNext = (flowBurstNext + 1) % 4;
    b.x = x; b.y = y; b.age = 0; b.hue = hue;
  }
  function flowTouchFor(id) { for (var i = 0; i < 4; i++) if (flowTouches[i].down && flowTouches[i].id === id) return flowTouches[i]; return null; }
  function flowDown(e) {
    var slot = null, i, downs = 0;
    for (i = 0; i < 4; i++) {
      var c = flowTouches[i]; if (c.down) { downs++; continue; }
      if (!slot || c.attract + c.contact < slot.attract + slot.contact) slot = c;
    }
    if (!slot) return;
    var p = point(e), now = performance.now();
    flowHueSeed = (flowHueSeed + .382) % 1;
    slot.id = e.pointerId; slot.down = true; slot.dragging = false; slot.held = false;
    slot.x = slot.sx = slot.lx = slot.wx = p.x; slot.y = slot.sy = slot.ly = slot.wy = p.y; slot.lt = now; slot.t0 = now;
    slot.vx = slot.vy = 0; slot.hue = (flowHueSeed + musicHue * .08) % 1; slot.stroke = ++flowStroke;
    flowColourBurst(p.x, p.y, slot.hue);
    // the whole field answers a touch a little, less for each extra finger already down
    surge = Math.min(1.6, surge + .45 / (1 + downs * .6));
    if (downs) flowGestures.multi++;
    if (!downs) sound(260, .16);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function flowMove(e) {
    var t = flowTouchFor(e.pointerId); if (!t) return;
    var p = point(e), now = performance.now(), dt = Math.max(8, now - t.lt);
    var ivx = (p.x - t.lx) / dt * 1000, ivy = (p.y - t.ly) / dt * 1000;
    t.vx += (ivx - t.vx) * .45; t.vy += (ivy - t.vy) * .45;
    t.x = p.x; t.y = p.y; t.lx = p.x; t.ly = p.y; t.lt = now;
    if (!t.dragging && Math.hypot(p.x - t.sx, p.y - t.sy) > Math.max(12, h * .02)) {
      t.dragging = true; flowGestures.drag++;
      flowWake.push({ x: t.sx, y: t.sy, vx: t.vx, vy: t.vy, age: 0, hue: t.hue, pow: .8, stroke: t.stroke, seq: flowWakeSeq++ });
      t.wx = t.sx; t.wy = t.sy;
    }
    if (t.dragging && Math.hypot(p.x - t.wx, p.y - t.wy) > h * .05) {
      flowWake.push({ x: p.x, y: p.y, vx: t.vx, vy: t.vy, age: 0, hue: t.hue, pow: 1, stroke: t.stroke, seq: flowWakeSeq++ });
      t.wx = p.x; t.wy = p.y;
      if (flowWake.length > 24) flowWake.shift();
    }
  }
  function flowUp(e) {
    var t = flowTouchFor(e.pointerId); if (!t) return;
    if (!t.dragging && !t.held) flowGestures.tap++;
    if (t.dragging) flowWake.push({ x: t.x, y: t.y, vx: t.vx, vy: t.vy, age: 0, hue: t.hue, pow: 1, stroke: t.stroke, seq: flowWakeSeq++ });
    t.down = false; t.id = -1; t.dragging = false;
  }
  function flowTouchReset(hard) {
    for (var i = 0; i < 4; i++) { var t = flowTouches[i]; t.down = false; t.id = -1; t.dragging = false; if (hard) { t.attract = t.contact = 0; t.vx = t.vy = 0; flowBursts[i].age = 9; } }
    if (hard) { flowWake.length = 0; flowTouchOn = 0; }
  }
  function glDraw(now, dt) {
    if (!glOk || !gl) return false;
    if (gl.isContextLost && gl.isContextLost()) { glDestroy(); glFailed = false; return false; }
    var s = dt / 1000, eNorm = clamp((musicLevel - .08) / 1.1, 0, 1), bN = clamp(bassLevel / 1.2, 0, 1), mN = clamp(midLevel / 1.1, 0, 1), hN = clamp(highLevel / 1.1, 0, 1), beatN = clamp(beatPulse / 1.2, 0, 1);
    var calm = .55 + eNorm * .75;
    analyseMusic(s, now);
    sceneT = (sceneT + s * calm) % 3600;
    flowPhase = (flowPhase + s * (.3 + eNorm * .65 + beatN * .5 + surge * 1.2)) % 1000;
    flowMix += (flowTarget - flowMix) * Math.min(1, s * 1.6); if (Math.abs(flowTarget - flowMix) < .002) flowMix = flowTarget;
    if (bgTo !== bgFrom) { bgMix = Math.min(1, bgMix + s / 1.3); if (bgMix >= 1) { bgFrom = bgTo; bgMix = 0; } }
    surge = Math.max(0, surge - s * .9);
    flowTouchStep(s, now, eNorm, beatN);
    glResize();
    inkStep(s, now, eNorm, mN);
    if (inkMix >= .5) return inkDraw(dt, s, eNorm, bN, mN, hN, beatN);
    var pal = presetRgb, U = Math.min(w, h), t = now * .001, cx = w * .5 + Math.sin(t * .13) * w * .035, cy = h * .51 + Math.cos(t * .11) * h * .025;
    if (!glUse(flowMix <= .001 ? 'orb' : flowMix >= .999 ? 'flow' : 'both')) return false;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.uniform2f(glU.res, glCanvas.width, glCanvas.height);
    gl.uniform2f(glU.orbC, (cx - w * .5) / h, -(cy - h * .5) / h);
    gl.uniform1f(glU.orbR, U / h * (.105 + eNorm * .012));
    gl.uniform1f(glU.T, sceneT); gl.uniform1f(glU.zph, flowPhase);
    gl.uniform1f(glU.bass, bN); gl.uniform1f(glU.mid, mN); gl.uniform1f(glU.high, hN); gl.uniform1f(glU.energy, eNorm); gl.uniform1f(glU.beat, beatN);
    gl.uniform1f(glU.quality, glQuality);
    gl.uniform1f(glU.bgA, bgFrom); gl.uniform1f(glU.bgB, bgTo); gl.uniform1f(glU.bgMix, bgMix * bgMix * (3 - 2 * bgMix));
    gl.uniform1f(glU.flow, flowMix * flowMix * (3 - 2 * flowMix)); gl.uniform1f(glU.surge, surge);
    gl.uniform1f(glU.build, buildUp); gl.uniform1f(glU.bphase, beatPhase);
    gl.uniform1f(glU.burst, burstEnv); gl.uniform1f(glU.bAge, burstAge); gl.uniform1f(glU.bPow, burstPower);
    gl.uniform1f(glU.recoil, fieldRecoil);
    gl.uniform1f(glU.snare, Math.min(1, snareEnv)); gl.uniform1f(glU.hat, Math.min(1, hatEnv));
    var c1 = tint(pal[0] || [40, 234, 255], 1), c2 = tint(pal[5] || [231, 251, 255], .95), c3 = tint(pal[2] || [165, 104, 255], 1);
    var flowAccent = tint(pal[3] || [255, 83, 200], 1);
    var c3m = [c3[0] * .55 + flowAccent[0] * .45, c3[1] * .55 + flowAccent[1] * .45, c3[2] * .55 + flowAccent[2] * .45];
    // With music the palette's colours flow into one another, faster on the beat; silence holds them still.
    musicHue = (musicHue + s * (eNorm * .45 + beatN * .35)) % 6.2832;
    colorDrive += ((eNorm > .02 ? Math.min(1, eNorm * 1.4 + beatN * .3) : 0) - colorDrive) * Math.min(1, s * 1.2);
    var k1 = colorDrive * .55 * (.5 + .5 * Math.sin(musicHue)), k3 = colorDrive * .5 * (.5 + .5 * Math.sin(musicHue + 2.1));
    var a1 = [c1[0] + (c3m[0] - c1[0]) * k1, c1[1] + (c3m[1] - c1[1]) * k1, c1[2] + (c3m[2] - c1[2]) * k1];
    var a3 = [c3m[0] + (c1[0] - c3m[0]) * k3, c3m[1] + (c1[1] - c3m[1]) * k3, c3m[2] + (c1[2] - c3m[2]) * k3];
    gl.uniform3f(glU.c1, a1[0], a1[1], a1[2]); gl.uniform3f(glU.c2, c2[0], c2[1], c2[2]);
    gl.uniform3f(glU.c3, a3[0], a3[1], a3[2]);
    if (glU.tOn) flowTouchUpload();
    for (var fi = 0; fi < 4; fi++) {
      var fc = tint(flowRgb[fi] || presets[preset].accent, 1);
      gl.uniform3f(glU['f' + (fi + 1)], fc[0], fc[1], fc[2]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    glFrames++;
    // Adaptive resolution: lower the GL render scale when frames run long, recover when there is headroom.
    if (dt > frameInterval * 1.6) { glSlowFrames++; glFastFrames = 0; } else { glFastFrames++; glSlowFrames = Math.max(0, glSlowFrames - 1); }
    if (glSlowFrames > 40 && glScale > .26) { glScale = Math.max(.26, glScale * .85); glSlowFrames = 0; }
    else if (glFastFrames > 240 && glScale < glScaleMax) { glScale = Math.min(glScaleMax, glScale * 1.08); glFastFrames = 0; }
    return true;
  }
  // ---- Ink Machine ----
  function inkUnavailable() {
    inkFailed = true; inkTarget = inkMix = 0;
    if (experience === 'ink') { experience = 'orb'; flowTarget = flowMix = 0; }
    setGlOpacity(1); syncExperienceUi();
  }
  function setGlOpacity(v) {
    var o = v >= .999 ? '' : String(Math.max(0, v).toFixed(3));
    if (o !== glOpacity && glCanvas) { glOpacity = o; glCanvas.style.opacity = o; }
  }
  // Shader space: centred, one unit = the screen height, y up.
  function inkX(px) { return (px - w * .5) / h; }
  function inkY(py) { return -(py - h * .5) / h; }
  function triggerInk(power) {
    blastPow = Math.min(1.6, power); blastAge = 0; blastEnv = 0; inkBlastCount++; lastInkBlast = performance.now();
  }
  // The liquid's own events. Ordinary beats only pulse it (the beat uniform); a hard bass punch
  // throws a modest splash now and then, and a drop, an eruption out of a quiet passage or a
  // build-up resolving sets off a full explosion. The cooldowns keep the hypnotic stretches intact.
  function detectInk(now) {
    if (experience !== 'ink' || inkMix < .5) return;
    var punch = bassFast - bassSlow;
    if (!(punch > Math.max(.022, bassSlow * 1.1) && bassFast > .034 && musicLevel > .14)) return;
    var erupts = now - lastQuietAt < 900 && punch > .045;
    var clears = bassFast > bassPeak * .97 && punch > Math.max(.045, bassSlow * 2.1);
    if ((buildUp > .55 || erupts || clears) && now - lastInkMajor > 3200) {
      triggerInk(1 + Math.min(.6, punch * 5 + buildUp * .5)); lastInkMajor = now; buildUp *= .25;
    } else if (punch > Math.max(.04, bassSlow * 1.6) && now - lastInkBlast > 1900) {
      triggerInk(.35 + Math.min(.3, punch * 3));
    }
  }
  function inkStep(s, now, eNorm, mN) {
    if (experience !== 'ink' && inkMix <= 0) { setGlOpacity(1); return; }
    var was = inkMix;
    // ease toward the target and stop there (no overshoot, so a settled scene never flickers)
    if (inkTarget > inkMix) inkMix = Math.min(inkTarget, inkMix + s / 1.1);
    else if (inkTarget < inkMix) inkMix = Math.max(inkTarget, inkMix - s / 1.1);
    if (was < .5 && inkMix >= .5) inkFrames = 0;
    setGlOpacity(inkMix < .5 ? 1 - inkMix * 2 : 1);
    // quiet music drifts; building and loud music speed the liquid up
    inkT = (inkT + s * (.22 + eNorm * .85 + mN * .35 + buildUp * .35 + blastEnv * .6)) % 1000;
    var swirlTarget = Math.sin(inkT * .21) * (.35 + mN * 1.5);
    inkSwirl += (swirlTarget - inkSwirl) * Math.min(1, s * 1.5);
    blastAge = Math.min(9, blastAge + s);
    blastEnv = blastPow > 0 ? clamp(Math.min(1, blastAge * 12) * Math.exp(-blastAge * 1.25) * blastPow, 0, 1.6) : 0;
    if (blastPow > 0 && blastAge > 3.5) blastPow = 0;
    // gestures
    if (inkG && inkG.mode === 'pending' && now - inkG.t0 > 420) {
      inkG.mode = 'twist'; inkGestures.twist++;
      inkTwist.on = true; inkTwist.x = inkX(inkG.x); inkTwist.y = inkY(inkG.y);
    }
    if (inkTwist.on) {
      inkTwist.str = Math.min(1, inkTwist.str + s * .8);
      inkTwist.wind = Math.min(9, inkTwist.wind + s * (1.6 + inkTwist.str * 2.2 + mN * 1.2));
    } else {
      inkTwist.str *= Math.exp(-s * 1.1); inkTwist.wind *= Math.exp(-s * 1.6);
      if (inkTwist.str < .002) inkTwist.str = inkTwist.wind = 0;
    }
    for (var i = 0; i < 3; i++) { var b = inkBursts[i]; b.age = Math.min(9, b.age + s); if (b.age > 3.5) b.pow = 0; }
    for (i = 0; i < 4; i++) { var d = inkDrags[i]; d.life *= Math.exp(-s * 1.3); if (d.life < .02) d.life = 0; }
    inkSplash.age = Math.min(9, inkSplash.age + s);
    for (i = 0; i < 2; i++) {
      var j = inkInj[i];
      if (j.grow) j.amt = Math.min(1.6, j.amt + s * .6);
      else { j.amt *= Math.exp(-s * .2); if (j.amt < .01) j.amt = 0; }
    }
    // palette changes blend over about a second rather than cutting
    var pal = INK_PALETTES[preset] || INK_PALETTES.orb;
    if (!inkCols) inkCols = pal.cols.map(function (c) { return c.slice(); });
    var k = Math.min(1, s * 3);
    for (i = 0; i < 5; i++) for (var c = 0; c < 3; c++) inkCols[i][c] += (pal.cols[i][c] - inkCols[i][c]) * k;
    inkPrism += (pal.prism - inkPrism) * k;
  }
  function inkDraw(dt, s, eNorm, bN, mN, hN, beatN) {
    if (!glUse('ink')) { inkUnavailable(); return false; }
    var u = glU, fade = clamp(inkMix * 2 - 1, 0, 1);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.uniform2f(u.res, glCanvas.width, glCanvas.height);
    gl.uniform1f(u.T, inkT); gl.uniform1f(u.bass, bN); gl.uniform1f(u.mid, mN); gl.uniform1f(u.high, hN);
    gl.uniform1f(u.energy, eNorm); gl.uniform1f(u.beat, beatN);
    gl.uniform1f(u.blast, Math.min(1.2, blastEnv)); gl.uniform1f(u.blastAge, blastAge); gl.uniform1f(u.build, buildUp);
    gl.uniform1f(u.quality, glQuality); gl.uniform1f(u.prism, inkPrism > .5 ? 1 : 0); gl.uniform1f(u.swirl, inkSwirl);
    gl.uniform1f(u.fadeIn, fade * fade * (3 - 2 * fade));
    for (var i = 0; i < 5; i++) gl.uniform3f(u['k' + (i + 1)], inkCols[i][0], inkCols[i][1], inkCols[i][2]);
    var B = inkBuf.bursts, D = inkBuf.drags, J = inkBuf.inj;
    for (i = 0; i < 3; i++) { var b = inkBursts[i]; B[i * 4] = b.x; B[i * 4 + 1] = b.y; B[i * 4 + 2] = b.age; B[i * 4 + 3] = b.pow; }
    for (i = 0; i < 4; i++) { var d = inkDrags[i]; D[i * 4] = d.x; D[i * 4 + 1] = d.y; D[i * 4 + 2] = d.vx * d.life; D[i * 4 + 3] = d.vy * d.life; }
    for (i = 0; i < 2; i++) { var j = inkInj[i]; J[i * 4] = j.x; J[i * 4 + 1] = j.y; J[i * 4 + 2] = j.amt; J[i * 4 + 3] = j.pos; }
    gl.uniform4fv(u.bursts, B); gl.uniform4fv(u.drags, D); gl.uniform4fv(u.inj, J);
    gl.uniform4f(u.twist, inkTwist.x, inkTwist.y, inkTwist.str, inkTwist.wind);
    gl.uniform4f(u.splash, inkSplash.x, inkSplash.y, inkSplash.dx, inkSplash.dy); gl.uniform1f(u.splashAge, inkSplash.age);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    glFrames++; inkFrames++;
    if (dt > frameInterval * 1.6) { glSlowFrames++; glFastFrames = 0; } else { glFastFrames++; glSlowFrames = Math.max(0, glSlowFrames - 1); }
    if (glSlowFrames > 40 && glScale > .26) { glScale = Math.max(.26, glScale * .85); glSlowFrames = 0; }
    else if (glFastFrames > 240 && glScale < glScaleMax) { glScale = Math.min(glScaleMax, glScale * 1.08); glFastFrames = 0; }
    return true;
  }
  // Gestures. A quick tap bursts; holding still twists; moving drags; a fast flick on release
  // splashes; a tap followed straight away by a press-and-hold injects colour.
  function inkDown(e) {
    var p = point(e), now = performance.now();
    inkG = { id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y, lastX: p.x, lastY: p.y, lastT: now, t0: now, vx: 0, vy: 0, mode: 'pending', path: 0, lastDrop: 0 };
    if (inkLastTap && now - inkLastTap.t < 380 && Math.hypot(p.x - inkLastTap.x, p.y - inkLastTap.y) < 70) {
      inkG.mode = 'inject'; inkGestures.inject++; inkLastTap = null;
      var j = inkInj[inkInjNext]; inkInjNext = (inkInjNext + 1) % 2;
      inkInjPos = (inkInjPos + .37) % 1;
      j.x = inkX(p.x); j.y = inkY(p.y); j.amt = .05; j.pos = .35 + inkInjPos * .3; j.grow = true; inkG.inj = j;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }
  function inkMove(e) {
    var g = inkG, p = point(e), now = performance.now(), dts = Math.max(8, now - g.lastT) / 1000;
    var ivx = (p.x - g.lastX) / h / dts, ivy = -(p.y - g.lastY) / h / dts;
    g.vx = g.vx * .55 + ivx * .45; g.vy = g.vy * .55 + ivy * .45;
    g.path += Math.hypot(p.x - g.lastX, p.y - g.lastY);
    g.x = p.x; g.y = p.y; g.lastX = p.x; g.lastY = p.y; g.lastT = now;
    var dist = Math.hypot(p.x - g.sx, p.y - g.sy);
    if (g.mode === 'pending' && dist > 14) { g.mode = 'drag'; inkGestures.drag++; }
    if (g.mode === 'twist') { inkTwist.x += (inkX(p.x) - inkTwist.x) * .5; inkTwist.y += (inkY(p.y) - inkTwist.y) * .5; }
    else if (g.mode === 'inject') { g.inj.x = inkX(p.x); g.inj.y = inkY(p.y); }
    else if (g.mode === 'drag' && g.path - g.lastDrop > 14) {
      g.lastDrop = g.path;
      var d = inkDrags[inkDragNext]; inkDragNext = (inkDragNext + 1) % 4;
      var sp = Math.hypot(g.vx, g.vy), k = sp > 3 ? 3 / sp : 1;
      d.x = inkX(p.x); d.y = inkY(p.y); d.vx = g.vx * k; d.vy = g.vy * k; d.life = 1;
    }
    e.preventDefault();
  }
  function inkUp(e, cancelled) {
    var g = inkG, now = performance.now(), held = now - g.t0;
    inkG = null;
    if (g.mode === 'pending' && !cancelled) {
      var b = inkBursts[inkBurstNext]; inkBurstNext = (inkBurstNext + 1) % 3;
      b.x = inkX(g.x); b.y = inkY(g.y); b.age = 0; b.pow = held < 300 ? 1 : .8; inkGestures.burst++;
      inkLastTap = { t: now, x: g.x, y: g.y }; sound(300, .12);
    } else if (g.mode === 'drag' && !cancelled) {
      var sp = Math.hypot(g.vx, g.vy);
      if (sp > 2.2 && held < 650) {
        var pw = clamp(sp / 2.2, 1, 2.5);
        inkSplash.x = inkX(g.x); inkSplash.y = inkY(g.y); inkSplash.dx = g.vx / sp * pw; inkSplash.dy = g.vy / sp * pw; inkSplash.age = 0;
        inkGestures.splash++; sound(180, .18);
      }
    } else if (g.mode === 'twist') inkTwist.on = false;
    else if (g.mode === 'inject') g.inj.grow = false;
  }
  function syncExperienceUi() {
    root.setAttribute('data-experience', experience);
    root.setAttribute('data-backdrop', backdrop);
    Array.prototype.forEach.call(document.querySelectorAll('.party-experience'), function (el) {
      var on = el.getAttribute('data-experience') === experience;
      el.classList.toggle('active', on); el.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (el.getAttribute('data-experience') === 'flow') { el.disabled = glFailed; el.title = glFailed ? 'Energy Flow needs WebGL graphics' : ''; }
      if (el.getAttribute('data-experience') === 'ink') { el.disabled = glFailed || inkFailed; el.title = glFailed || inkFailed ? 'Ink Machine needs WebGL graphics' : ''; }
    });
    // In Ink Machine the same four COLOUR buttons choose its four liquid palettes.
    Array.prototype.forEach.call(document.querySelectorAll('.party-preset'), function (el) {
      if (!el.getAttribute('data-label')) el.setAttribute('data-label', el.textContent);
      var ink = INK_PALETTES[el.getAttribute('data-preset')];
      el.textContent = experience === 'ink' && ink ? ink.name : el.getAttribute('data-label');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.party-backdrop'), function (el) {
      var on = el.getAttribute('data-backdrop') === backdrop;
      el.classList.toggle('active', on); el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.disabled = glFailed && el.getAttribute('data-backdrop') !== 'classic';
    });
  }
  function setExperience(name) {
    if (experiences.indexOf(name) < 0 || (name === 'flow' && glFailed) || (name === 'ink' && (glFailed || inkFailed))) return;
    if (name !== 'flow') flowTouchReset(false);
    experience = name; flowCanvasCleared = false;
    if (name === 'ink') {
      inkTarget = 1;
      if (!active) inkMix = 1;
    } else {
      flowTarget = name === 'flow' ? 1 : 0;
      // the old scene comes back from under the ink, already on the experience picked
      if (inkMix > 0) flowMix = flowTarget;
      inkTarget = 0; if (!active) inkMix = 0;
      inkG = null; inkTwist.on = false;
    }
    syncExperienceUi();
    try { localStorage.setItem('nexus.party.experience', name); } catch (e) {}
  }
  function setBackdrop(name) {
    var idx = backdrops.indexOf(name);
    if (idx < 0 || (glFailed && name !== 'classic')) return;
    backdrop = name;
    if (idx !== bgTo) { if (bgMix > 0 && bgMix < 1) bgFrom = bgTo; bgTo = idx; bgMix = 0; if (!active) bgFrom = idx; }
    if (glOk && gl && active && experience !== 'ink') { glBuild(bgKey(flowMix >= .999 ? 'flow' : flowMix <= .001 ? 'orb' : 'both')); setTimeout(function () { if (glOk && gl && active) { var f = bgFrom; bgFrom = bgTo; glBuild(bgKey('orb')); bgFrom = f; } }, 2200); }
    syncExperienceUi();
    try { localStorage.setItem('nexus.party.backdrop', name); } catch (e) {}
  }
  function addOrb(x, y, index) {
    // z: depth in the field (0 far, 1 near). Far orbs are smaller, dimmer and drawn first.
    var z = index % 3 === 0 ? rand(0, .35) : rand(.35, 1);
    return { x: x, y: y, vx: rand(-.45, .45), vy: rand(-.4, .4), r: rand(10, 24) * (.62 + z * .55), z: z,
      phase: rand(0, 6.28), rate: rand(.0017, .0046), color: index % presets[preset].colors.length,
      waveX: x, waveBase: y, nextImpulse: 0 };
  }
  function resize() {
    var rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    w = rect.width; h = rect.height;
    var memoryGb = 0;
    try { memoryGb = window.Android && Android.deviceMemoryGb ? +Android.deviceMemoryGb() : +(navigator.deviceMemory || 0); } catch (e) {}
    highMemory = memoryGb >= 6; frameInterval = highMemory ? 16 : 32;
    scale = Math.min(window.devicePixelRatio || 1, highMemory ? 1.25 : .76);
    glScaleMax = highMemory ? .78 : .5; glQuality = highMemory ? 1 : 0;
    if (glScale > glScaleMax || !glFrames) glScale = glScaleMax;
    glResize();
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (!orbs.length) {
      for (var i = 0; i < 22; i++) orbs.push(addOrb(rand(20, w - 20), rand(20, h - 20), i));
      for (var p = 0; p < (highMemory ? 96 : 44); p++) {
        var dust = { x: rand(0, w), y: rand(0, h), vx: rand(-.08, .08), vy: rand(-.07, .07), life: rand(.35, 1), size: rand(.45, 1.5), color: p % 6 };
        particles.push(dust);
      }
      for (var t = 0; t < (highMemory ? 96 : 42); t++) trails.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, color: 0, size: 1 });
    } else {
      for (var j = 0; j < orbs.length; j++) {
        orbs[j].x = clamp(orbs[j].x, 12, w - 12); orbs[j].y = clamp(orbs[j].y, 12, h - 12);
      }
    }
  }
  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function paletteRgb(index) { return presetRgb[index % presetRgb.length] || presets[preset].accent; }
  function mixRgb(a, b, k) { return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)]; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  // Each orb is a sphere of luminous glass: a soft halo of its own light, a body that glows from deep
  // inside and darkens toward its edge, a thin bright fresnel rim, a small sharp highlight with a softer
  // sheen around it, and a faint coloured reflection on the far side. Drawn once per colour and reused.
  function makeSprite(colorIndex) {
    var key = preset + ':' + colorIndex;
    if (sprites[key]) return sprites[key];
    var side = 192, c = 96, R = 52, off = document.createElement('canvas'); off.width = side; off.height = side;
    var g = off.getContext('2d'), rgb = hexRgb(presets[preset].colors[colorIndex % presets[preset].colors.length]);
    // a near-white orb becomes pearl: its depth and rim take the palette's accent instead of grey
    if (Math.min(rgb[0], rgb[1], rgb[2]) > 200) rgb = mixRgb(rgb, presets[preset].accent, .35);
    var light = mixRgb(rgb, [255, 255, 255], .55), deep = mixRgb(rgb, [0, 0, 8], .62), white = [255, 255, 255];
    var halo = g.createRadialGradient(c, c, R * .7, c, c, c);
    halo.addColorStop(0, rgba(light, .45)); halo.addColorStop(.3, rgba(rgb, .16)); halo.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = halo; g.fillRect(0, 0, side, side);
    // body: light scattering inside the glass, brightest a little below centre
    var body = g.createRadialGradient(c + 4, c + 9, 2, c, c, R);
    body.addColorStop(0, rgba(mixRgb(light, white, .35), 1)); body.addColorStop(.28, rgba(light, .98));
    body.addColorStop(.62, rgba(rgb, .95)); body.addColorStop(.86, rgba(mixRgb(rgb, deep, .5), .95)); body.addColorStop(1, rgba(rgb, .85));
    g.fillStyle = body; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.clip();
    // fresnel: the edge of the glass catches the light all the way round
    var rim = g.createRadialGradient(c, c, R * .78, c, c, R);
    rim.addColorStop(0, rgba(light, 0)); rim.addColorStop(.82, rgba(light, .28)); rim.addColorStop(.96, rgba(mixRgb(light, white, .5), .75)); rim.addColorStop(1, rgba(light, .2));
    g.fillStyle = rim; g.fillRect(c - R, c - R, R * 2, R * 2);
    // a faint coloured reflection along the lower right
    var refl = g.createRadialGradient(c + R * .5, c + R * .55, 2, c + R * .5, c + R * .55, R * .55);
    refl.addColorStop(0, rgba(mixRgb(rgb, white, .3), .35)); refl.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = refl; g.fillRect(c - R, c - R, R * 2, R * 2);
    // the sheen and the sharp highlight of a light above and to the left
    g.globalCompositeOperation = 'lighter';
    var sheen = g.createRadialGradient(c - R * .3, c - R * .38, 1, c - R * .3, c - R * .38, R * .62);
    sheen.addColorStop(0, rgba(white, .45)); sheen.addColorStop(1, rgba(white, 0));
    g.fillStyle = sheen; g.fillRect(c - R, c - R, R * 2, R * 2);
    g.translate(c - R * .36, c - R * .44); g.rotate(-.6); g.scale(1, .55);
    var spec = g.createRadialGradient(0, 0, 0, 0, 0, R * .2);
    spec.addColorStop(0, rgba(white, .95)); spec.addColorStop(.5, rgba(white, .5)); spec.addColorStop(1, rgba(white, 0));
    g.fillStyle = spec; g.beginPath(); g.arc(0, 0, R * .2, 0, Math.PI * 2); g.fill();
    g.restore();
    sprites[key] = off;
    return off;
  }
  // a soft additive core that flares inside an orb on the beat
  function coreSprite(colorIndex) {
    var key = 'core:' + preset + ':' + colorIndex;
    if (sprites[key]) return sprites[key];
    var side = 96, off = document.createElement('canvas'); off.width = side; off.height = side;
    var g = off.getContext('2d'), rgb = hexRgb(presets[preset].colors[colorIndex % presets[preset].colors.length]);
    var gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    gr.addColorStop(0, rgba(mixRgb(rgb, [255, 255, 255], .6), .9)); gr.addColorStop(.25, rgba(rgb, .55)); gr.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = gr; g.fillRect(0, 0, side, side);
    sprites[key] = off;
    return off;
  }
  function ripple(x, y, power) {
    if (impulses.length >= 8) impulses.shift();
    impulses.push({ x: x, y: y, front: 0, life: 1, power: power });
  }
  function energyWave(x1, y1, x2, y2, power) {
    if (waves.length >= 8) waves.shift();
    waves.push({ x1: x1, y1: y1, x2: x2, y2: y2, front: 0, life: 1, power: power });
  }
  function burst(x, y, color, power, count) {
    for (var i = 0; i < count; i++) {
      var p = particles[particleCursor++ % particles.length], angle = Math.random() * Math.PI * 2, speed = rand(1.1, 4.5) * power;
      p.x = x; p.y = y; p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed;
      p.life = rand(.48, 1); p.size = rand(.8, 2.6) * power; p.color = color; p.burst = true;
    }
  }
  function addTrail(x, y, color, speed) {
    var t = trails[trailCursor++ % trails.length];
    t.x = x; t.y = y; t.vx = speed ? -speed.x * .08 : 0; t.vy = speed ? -speed.y * .08 : 0;
    t.life = 1; t.color = color; t.size = rand(2, 5);
  }
  function sound(freq, duration) {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var osc = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
      osc.type = 'sine'; osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(55, freq * .62), now + duration);
      gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.023, now + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      osc.connect(gain); gain.connect(audio.destination); osc.start(now); osc.stop(now + duration + .025);
    } catch (e) {}
  }
  function bassCannon() {
    // In Energy Flow the cannon is the manual Supernova Burst.
    if (experience === 'flow' && glOk) triggerBurst(1.4);
    if (experience === 'ink' && glOk) triggerInk(1.4);
    ripple(w * .5, h * .48, 1.5);
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i], dx = o.x - w * .5, dy = o.y - h * .48, d = Math.sqrt(dx * dx + dy * dy) || 1;
      o.vx += dx / d * 7; o.vy += dy / d * 7; o.flash = 1;
    }
    surge = Math.min(1.6, surge + 1); sound(95, .48);
  }
  function update(dt, now) {
    var step = Math.min(2, dt / 16.67), cx = w * .5, cy = h * .46, elapsed = now - modeStarted;
    var decay = Math.exp(-dt / 280);
    musicLevel += (inputEnergy - musicLevel) * (inputEnergy > musicLevel ? .32 : .12);
    bassLevel += (inputBass - bassLevel) * (inputBass > bassLevel ? .42 : .16);
    midLevel += (inputMid - midLevel) * (inputMid > midLevel ? .3 : .12);
    highLevel += (inputHigh - highLevel) * (inputHigh > highLevel ? .48 : .17);
    beatPulse *= decay;
    snareEnv *= Math.exp(-dt / 150); hatEnv *= Math.exp(-dt / 90);
    // with the six-band feed, the mids and highs come from it (finer than the three-band meter)
    if (now - detailAt < 600) { inputMid = Math.max(inputMid * .5, detailMid); inputHigh = Math.max(inputHigh * .5, detailHigh); }
    hookDetail();
    if (now - lastAudioSample > 900) { inputEnergy = .08; inputBass = inputMid = inputHigh = 0; }
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i];
      if (o === selected && gesture && pointer) {
        o.x += (pointer.x - o.x) * .42; o.y += (pointer.y - o.y) * .42;
        if (!gesture.moved && now - gesture.started > 360) o.charge = Math.min(1, (now - gesture.started - 360) / 950);
      } else if (mode === 'wave') {
        o.waveX += (.35 + i % 4 * .08) * step;
        if (o.waveX > w + 30) o.waveX = -30;
        o.x = o.waveX;
        var localPhase = o.waveX / w * 6.2 - now * .0016 + o.phase;
        o.y += ((o.waveBase + Math.sin(localPhase) * Math.min(105, h * (.17 + musicLevel * .035))) - o.y) * .13 * step;
        o.vy *= .92;
      } else if (mode === 'vortex') {
        var dx = cx - o.x, dy = cy - o.y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
        o.vx += (-dy / dist * (.14 + musicLevel * .08) + dx / dist * .014) * step;
        o.vy += (dx / dist * (.14 + musicLevel * .08) + dy / dist * .014) * step;
      } else if (mode === 'chaos') {
        if (now > o.nextImpulse) {
          o.vx += rand(-1.4, 1.4); o.vy += rand(-1.2, 1.2); o.nextImpulse = now + rand(240, 690);
        }
      } else {
        o.vx += Math.sin(now * .0008 + o.phase) * .025 * step;
        o.vy += Math.cos(now * .00065 + o.phase) * .024 * step;
      }
      if (o === selected && gesture && pointer) {
        o.reaction = Math.max(o.reaction || 0, (o.charge || 0) * .8);
      }
      for (var q = 0; q < impulses.length; q++) {
        var pulse = impulses[q], px = o.x - pulse.x, py = o.y - pulse.y, distance = Math.sqrt(px * px + py * py) || 1;
        var band = Math.abs(distance - pulse.front);
        if (band < 52) {
          var force = (1 - band / 52) * pulse.power * .16 * pulse.life;
          o.vx += px / distance * force * step; o.vy += py / distance * force * step;
          o.reaction = Math.max(o.reaction || 0, force * 2.5);
        }
      }
      o.vx *= .994; o.vy *= .994;
      var max = mode === 'chaos' ? 5.7 : 3.7;
      o.vx = clamp(o.vx, -max, max); o.vy = clamp(o.vy, -max, max);
      if (mode !== 'wave' && !(o === selected && gesture && pointer)) { o.x += o.vx * step; o.y += o.vy * step; }
      var bounce = mode === 'chaos' ? -.9 : -.76;
      if (o.x < o.r || o.x > w - o.r) { o.vx *= bounce; o.x = clamp(o.x, o.r, w - o.r); }
      if (o.y < o.r || o.y > h - o.r) { o.vy *= bounce; o.y = clamp(o.y, o.r, h - o.r); }
      o.reaction = Math.max(0, (o.reaction || 0) * .91);
      o.flash = Math.max(0, (o.flash || 0) * .91);
      if (!(o === selected && gesture && pointer && !gesture.moved)) o.charge = Math.max(0, (o.charge || 0) - .025 * step);
      o.ringPulse = Math.max(0, (o.ringPulse || 0) * .91);
      if (mode !== 'wave') { o.waveX = o.x; o.waveBase = o.y; }
      for (var j = i + 1; j < orbs.length; j++) {
        var b = orbs[j], dx2 = b.x - o.x, dy2 = b.y - o.y, d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || .1, min = o.r + b.r;
        if (d2 < min) {
          var nx = dx2 / d2, ny = dy2 / d2, overlap = (min - d2) * .5;
          o.x -= nx * overlap; o.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
          var impulse = (o.vx - b.vx) * nx + (o.vy - b.vy) * ny;
          o.vx -= impulse * nx * .64; o.vy -= impulse * ny * .64; b.vx += impulse * nx * .64; b.vy += impulse * ny * .64;
          o.flash = Math.max(o.flash, .55); b.flash = Math.max(b.flash, .55);
          if (mode === 'ripple' && impulse > .4 && now - (o.lastRipple || 0) > 360) {
            o.lastRipple = now; ripple((o.x + b.x) * .5, (o.y + b.y) * .5, .58);
          }
        }
      }
    }
    for (var k = impulses.length - 1; k >= 0; k--) {
      impulses[k].front += (4.1 + musicLevel * 2.2) * step; impulses[k].life -= .008 * step;
      if (impulses[k].life <= 0 || impulses[k].front > Math.max(w, h) * 1.2) impulses.splice(k, 1);
    }
    for (var q = waves.length - 1; q >= 0; q--) {
      waves[q].front += (7 + musicLevel * 7 + beatPulse * 3) * step; waves[q].life -= .014 * step;
      if (waves[q].life <= 0 || waves[q].front > Math.max(w, h)) waves.splice(q, 1);
    }
    for (var pi = 0; pi < particles.length; pi++) {
      var pt = particles[pi];
      if (pt.burst) {
        pt.x += pt.vx * step; pt.y += pt.vy * step; pt.vx *= .965; pt.vy *= .965; pt.life -= .028 * step;
        if (pt.life <= 0) pt.burst = false;
      } else {
        pt.x += pt.vx * step * (1 + midLevel * 2); pt.y += pt.vy * step * (1 + midLevel * 2);
        if (pt.x < -2) pt.x = w + 2; if (pt.x > w + 2) pt.x = -2;
        if (pt.y < -2) pt.y = h + 2; if (pt.y > h + 2) pt.y = -2;
        pt.life = .42 + .32 * (.5 + .5 * Math.sin(now * .001 + pi * 1.71)) + highLevel * .18;
      }
    }
    for (var ti = 0; ti < trails.length; ti++) if (trails[ti].life > 0) {
      var tr = trails[ti]; tr.x += tr.vx * step; tr.y += tr.vy * step; tr.life -= .035 * step;
    }
  }
  function orbScale(o, now, index) {
    var pulse;
    var bass = bassLevel * .32 + beatPulse * .28;
    if (mode === 'pulse') pulse = 1 + Math.sin(now * o.rate + o.phase) * (.18 + musicLevel * .08);
    else if (mode === 'wave') pulse = 1 + Math.sin(o.waveX / w * 5.5 - now * .0016 + o.phase) * .16;
    else if (mode === 'vortex') pulse = 1 + Math.sin(now * .0018 + o.phase + index * .14) * .1;
    else if (mode === 'chaos') pulse = 1 + Math.sin(now * o.rate * 1.8 + o.phase) * .18;
    else pulse = 1 + Math.sin(now * .0016 + o.phase) * .1 + (o.reaction || 0) * .18;
    return o.r * pulse * (1 + bass + musicLevel * .1 + (o.flash || 0) * .18 + (o.charge || 0) * .34);
  }
  function drawAtmosphere(now) {
    var t = now * .001, energy = clamp(musicLevel, .08, 1.3), U = Math.min(w, h), cx = w * .5 + Math.sin(t * .13) * w * .035, cy = h * .51 + Math.cos(t * .11) * h * .025;
    var bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#030711'); bg.addColorStop(.48, '#080918'); bg.addColorStop(1, '#100716');
    ctx.globalCompositeOperation = 'source-over';
    if (glOk) ctx.clearRect(0, 0, w, h); else { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    var accentRgb = presets[preset].accent, glow = ctx.createRadialGradient(cx, cy, U * .025, cx, cy, U * (.63 + bassLevel * .14));
    glow.addColorStop(0, 'rgba(' + accentRgb.join(',') + ',' + (.065 + energy * .025 + beatPulse * .035) + ')');
    glow.addColorStop(.48, 'rgba(' + accentRgb.join(',') + ',' + (.025 + midLevel * .025) + ')'); glow.addColorStop(1, 'rgba(' + accentRgb.join(',') + ',0)');
    if (!glOk) { ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h); }
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = classicWeight;
    var ringCount = highMemory ? 9 : 6, segments = highMemory ? 88 : 56;
    for (var r = 0; r < ringCount; r++) {
      var radius = U * (.14 + r * (highMemory ? .072 : .09)) + bassLevel * U * (.012 + r * .001) + beatPulse * U * .035;
      var rot = t * (.08 + r * .013) * (r % 2 ? -1 : 1), flatten = .38 + (r % 3) * .065, rgb = paletteRgb(r + 1);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(1, flatten); ctx.beginPath();
      for (var s = 0; s <= segments; s++) {
        var ang = s / segments * Math.PI * 2, wave = 1 + Math.sin(ang * (3 + r % 4) + t * (.55 + r * .09)) * (.012 + midLevel * .014) + Math.cos(ang * 7 - t + r) * .006;
        var rr = radius * wave, px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
        if (!s) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.strokeStyle = 'rgba(' + rgb.join(',') + ',' + (.04 + energy * .02 + beatPulse * .04) + ')'; ctx.lineWidth = 5 + bassLevel * 3; ctx.stroke();
      ctx.strokeStyle = 'rgba(' + rgb.join(',') + ',' + (.09 + energy * .06 + beatPulse * .12) + ')'; ctx.lineWidth = .6 + highLevel * .4; ctx.stroke();
      var marker = t * (.22 + r * .018) + r * 1.73, mx = Math.cos(marker) * radius, my = Math.sin(marker) * radius;
      ctx.beginPath(); ctx.arc(mx, my, 1.4 + highLevel * 1.8 + beatPulse * 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(238,249,255,' + (.48 + highLevel * .35) + ')'; ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    var threads = highMemory ? 4 : 3;
    for (var th = 0; th < threads; th++) {
      var phase = t * (.32 + th * .09) + th * 2.1, baseY = h * (.28 + th * .19), steps = highMemory ? 32 : 20;
      ctx.beginPath();
      for (var x = 0; x <= steps; x++) {
        var xx = x / steps * w, yy = baseY + Math.sin(x * .29 + phase) * h * (.018 + midLevel * .045) + Math.sin(x * .11 - phase * 1.3) * h * (.016 + bassLevel * .025);
        if (!x) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      var col = paletteRgb(th + 2);
      ctx.strokeStyle = 'rgba(' + col.join(',') + ',' + (.035 + midLevel * .07 + musicLevel * .02) + ')'; ctx.lineWidth = 1 + midLevel * 1.4; ctx.stroke();
    }
    for (var p = 0; p < particles.length; p++) {
      var dust = particles[p], color = paletteRgb(dust.color), alpha = dust.burst ? dust.life * .9 : (.18 + highLevel * .42) * dust.life;
      if (alpha <= .01) continue;
      ctx.beginPath(); ctx.arc(dust.x, dust.y, dust.size * (dust.burst ? .7 + dust.life : 1), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + color.join(',') + ',' + alpha + ')'; ctx.fill();
    }
    for (var e = 0; e < impulses.length; e++) {
      var pulse = impulses[e], rgbPulse = presets[preset].accent, radiusPulse = pulse.front;
      ctx.beginPath(); ctx.arc(pulse.x, pulse.y, radiusPulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(' + rgbPulse.join(',') + ',' + (.1 + pulse.life * .42 * pulse.power) + ')'; ctx.lineWidth = 1 + pulse.life * pulse.power * 2.8; ctx.stroke();
      ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(0, radiusPulse - 3), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(235,248,255,' + pulse.life * .18 + ')'; ctx.lineWidth = .7; ctx.stroke();
    }
    for (var q = 0; q < waves.length; q++) {
      var wave = waves[q], fx = clamp(wave.front / 72, 0, 1), wx = wave.x1 + (wave.x2 - wave.x1) * fx, wy = wave.y1 + (wave.y2 - wave.y1) * fx, wc = presets[preset].accent;
      ctx.beginPath(); ctx.moveTo(wave.x1, wave.y1); ctx.lineTo(wave.x2, wave.y2); ctx.strokeStyle = 'rgba(' + wc.join(',') + ',' + wave.life * .18 + ')'; ctx.lineWidth = 2 + wave.power * 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(wx, wy, 3 + wave.life * 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(235,250,255,' + wave.life * .62 + ')'; ctx.fill();
    }
    ctx.restore(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  function drawConnections(now) {
    var maxDist = Math.min(w, h) * .31, maxPerOrb = highMemory ? 3 : 2;
    for (var i = 0; i < orbs.length; i++) connectionCounts[i] = 0;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (var a = 0; a < orbs.length; a++) for (var b = a + 1; b < orbs.length; b++) {
      if (connectionCounts[a] >= maxPerOrb || connectionCounts[b] >= maxPerOrb) continue;
      var oa = orbs[a], ob = orbs[b], dx = ob.x - oa.x, dy = ob.y - oa.y, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist || dist < 1) continue;
      connectionCounts[a]++; connectionCounts[b]++;
      var strength = (1 - dist / maxDist) * (.18 + musicLevel * .18 + bassLevel * .35 + beatPulse * .18), bend = Math.sin(now * .0014 + a * 1.7 + b) * Math.min(34, dist * .12), nx = -dy / dist, ny = dx / dist;
      // a filament of energy between the two orbs, coloured from one to the other, fading with distance
      var ca0 = paletteRgb(oa.color), cb0 = paletteRgb(ob.color), fg = ctx.createLinearGradient(oa.x, oa.y, ob.x, ob.y);
      var depthK = .55 + .45 * Math.min(oa.z, ob.z);
      fg.addColorStop(0, rgba(ca0, strength * .55 * depthK)); fg.addColorStop(.5, rgba(mixRgb(ca0, cb0, .5), strength * .2 * depthK)); fg.addColorStop(1, rgba(cb0, strength * .55 * depthK));
      ctx.beginPath(); ctx.moveTo(oa.x, oa.y); ctx.quadraticCurveTo((oa.x + ob.x) * .5 + nx * bend, (oa.y + ob.y) * .5 + ny * bend, ob.x, ob.y);
      ctx.strokeStyle = fg; ctx.lineWidth = 2.6 + bassLevel * 2.4; ctx.globalAlpha = .45; ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = .7 + highLevel * .5; ctx.stroke();
      var travel = (now * (.00028 + musicLevel * .00018) + a * .17 + b * .09) % 1, inv = 1 - travel;
      var lx = inv * inv * oa.x + 2 * inv * travel * ((oa.x + ob.x) * .5 + nx * bend) + travel * travel * ob.x;
      var ly = inv * inv * oa.y + 2 * inv * travel * ((oa.y + ob.y) * .5 + ny * bend) + travel * travel * ob.y;
      var ca = paletteRgb(oa.color), cb = paletteRgb(ob.color), cr = Math.round(ca[0] * inv + cb[0] * travel), cg = Math.round(ca[1] * inv + cb[1] * travel), cbv = Math.round(ca[2] * inv + cb[2] * travel);
      var sr = 2.2 + bassLevel * 2 + beatPulse * 1.5, sg = ctx.createRadialGradient(lx, ly, 0, lx, ly, sr * 2.4);
      sg.addColorStop(0, 'rgba(255,255,255,' + Math.min(1, strength * 1.4) + ')'); sg.addColorStop(.3, 'rgba(' + cr + ',' + cg + ',' + cbv + ',' + strength + ')'); sg.addColorStop(1, 'rgba(' + cr + ',' + cg + ',' + cbv + ',0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(lx, ly, sr * 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  var orbOrder = [];
  function drawOrbs(now) {
    if (orbOrder.length !== orbs.length) { orbOrder = orbs.slice(); }
    orbOrder.sort(function (a, b) { return a.z - b.z; });
    ctx.save();
    for (var k = 0; k < orbOrder.length; k++) {
      var o = orbOrder[k], i = orbs.indexOf(o), r = orbScale(o, now, i), sprite = makeSprite(o.color), rgb = paletteRgb(o.color);
      // far orbs sit back in the haze; near ones are full strength
      var depth = .55 + .45 * o.z;
      var glow = clamp(.82 + musicLevel * .1 + bassLevel * .12 + (o.reaction || 0) * .25 + (o.flash || 0) * .3 + (o.charge || 0) * .2, .6, 1.3);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, glow * depth);
      ctx.drawImage(sprite, o.x - r * 1.85, o.y - r * 1.85, r * 3.7, r * 3.7);
      // the energy inside flares on the kick, on its own snare flash and when touched
      var flare = beatPulse * .45 * (.5 + o.z * .5) + (o.flash || 0) * .7 + (o.spark || 0) + (o.charge || 0) * .5;
      if (flare > .03) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, flare) * depth;
        var cr = r * (1.1 + flare * .5);
        ctx.drawImage(coreSprite(o.color), o.x - cr, o.y - cr, cr * 2, cr * 2);
      }
      if (o.charge > .02) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1;
        var rr = r * (2.1 + o.charge * 1.6), ring = ctx.createRadialGradient(o.x, o.y, rr * .82, o.x, o.y, rr);
        ring.addColorStop(0, rgba(rgb, 0)); ring.addColorStop(.85, rgba(rgb, o.charge * .32)); ring.addColorStop(1, rgba(rgb, 0));
        ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(o.x, o.y, rr, 0, Math.PI * 2); ctx.fill();
      }
      o.spark = Math.max(0, (o.spark || 0) * .86);
    }
    ctx.restore(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function drawTrails() {
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (var i = 0; i < trails.length; i++) {
      var trail = trails[i]; if (trail.life <= .01) continue;
      var rgb = paletteRgb(trail.color);
      ctx.beginPath(); ctx.arc(trail.x, trail.y, trail.size * trail.life, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + rgb.join(',') + ',' + trail.life * .4 + ')'; ctx.fill();
    }
    ctx.restore();
  }
  function render(now, token) {
    if (!active || token !== runId || document.hidden || root.classList.contains('hidden')) { raf = 0; return; }
    var elapsed = now - lastFrame;
    if (elapsed < frameInterval) { raf = requestAnimationFrame(function (t) { render(t, token); }); return; }
    var dt = lastFrame ? Math.min(48, elapsed) : 16;
    lastFrame = now;
    update(dt, now);
    if (!glOk && !glFailed) glInit();
    glDraw(now, dt);
    var classicTarget = !glOk || (backdrop === 'classic' && experience === 'orb') ? 1 : 0;
    classicWeight += (classicTarget - classicWeight) * (1 - Math.exp(-dt / 420));
    if (glOk && ((experience === 'flow' && flowMix >= 1) || inkMix >= .5)) {
      // Energy Flow and Ink Machine have no orb field; the 2D layer stays clear while the GL scene runs.
      if (!flowCanvasCleared) { ctx.clearRect(0, 0, w, h); flowCanvasCleared = true; }
    } else {
      flowCanvasCleared = false;
      canvas.style.opacity = glOk ? String((1 - flowMix) * (inkMix > 0 ? 1 - inkMix * 2 : 1)) : '1';
      drawAtmosphere(now);
      drawConnections(now); drawTrails(); drawOrbs(now);
    }
    raf = requestAnimationFrame(function (t) { render(t, token); });
  }
  function point(e) { var rect = canvas.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }
  function tapOrb(o, x, y, now) {
    var doubled = lastTap && lastTap.orb === o && now - lastTap.time < 340 && Math.hypot(x - lastTap.x, y - lastTap.y) < 34;
    o.flash = 1; o.reaction = 1; o.ringPulse = 1;
    ripple(x, y, doubled ? 2.15 : .92); burst(x, y, o.color, doubled ? 2.2 : 1.2, doubled ? (highMemory ? 42 : 22) : (highMemory ? 20 : 12));
    if (doubled) {
      var reach = Math.min(w, h) * .34;
      for (var i = 0; i < orbs.length; i++) if (orbs[i] !== o) {
        var near = orbs[i], dx = near.x - x, dy = near.y - y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < reach) { var force = (1 - dist / reach) * 2.5; near.vx += dx / dist * force; near.vy += dy / dist * force; near.flash = 1; near.reaction = .9; }
      }
      lastTap = null; sound(150, .24);
    } else { lastTap = { orb: o, time: now, x: x, y: y }; sound(420, .08); }
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (active && experience === 'flow' && glOk && !gesture && !inkG) { flowDown(e); e.preventDefault(); return; }
    if (!active || gesture || e.isPrimary === false) return;
    if (experience === 'ink' && glOk) { if (!inkG) inkDown(e); else e.preventDefault(); return; }
    var p = point(e), nearest = null, best = 1e9;
    for (var i = 0; i < orbs.length; i++) {
      var dx = orbs[i].x - p.x, dy = orbs[i].y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < orbs[i].r + 24 && d < best) { nearest = orbs[i]; best = d; }
    }
    selected = nearest; dragVelocity.x = dragVelocity.y = 0;
    gesture = { id: e.pointerId, orb: nearest, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, offsetX: nearest ? nearest.x - p.x : 0, offsetY: nearest ? nearest.y - p.y : 0, started: performance.now(), moved: false, lastWaveX: p.x, lastWaveY: p.y };
    pointer = nearest ? { x: nearest.x, y: nearest.y } : p;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (flowTouchFor(e.pointerId)) { if (active) flowMove(e); e.preventDefault(); return; }
    if (inkG) { if (inkG.id === e.pointerId && active) inkMove(e); return; }
    if (!gesture || gesture.id !== e.pointerId || !active) return;
    var p = point(e), total = Math.hypot(p.x - gesture.startX, p.y - gesture.startY);
    if (total > 9) { gesture.moved = true; if (gesture.orb) gesture.orb.charge = 0; }
    dragVelocity.x = clamp((p.x - gesture.lastX) * .72, -10, 10); dragVelocity.y = clamp((p.y - gesture.lastY) * .72, -10, 10);
    if (gesture.orb) {
      pointer.x = p.x + gesture.offsetX; pointer.y = p.y + gesture.offsetY;
      if (Math.hypot(p.x - gesture.lastX, p.y - gesture.lastY) > 5) addTrail(gesture.orb.x, gesture.orb.y, gesture.orb.color, dragVelocity);
    } else if (gesture.moved && Math.hypot(p.x - gesture.lastWaveX, p.y - gesture.lastWaveY) > 18) {
      energyWave(gesture.lastWaveX, gesture.lastWaveY, p.x, p.y, .9 + musicLevel * .4);
      ripple(p.x, p.y, .24 + midLevel * .3); gesture.lastWaveX = p.x; gesture.lastWaveY = p.y;
    }
    gesture.lastX = p.x; gesture.lastY = p.y; e.preventDefault();
  });
  function release(e, cancelled) {
    if (e && flowTouchFor(e.pointerId)) { flowUp(e); return; }
    if (inkG) { if (!e || inkG.id === e.pointerId) inkUp(e, cancelled); return; }
    if (!gesture || (e && gesture.id !== e.pointerId)) return;
    var g = gesture, p = e ? point(e) : { x: g.lastX, y: g.lastY }, held = performance.now() - g.started;
    if (g.orb) {
      var o = g.orb;
      if (g.moved) {
        o.vx += dragVelocity.x * .35; o.vy += dragVelocity.y * .35; o.flash = .9;
        o.waveX = o.x; o.waveBase = o.y;
        if (o.charge > .12) { ripple(o.x, o.y, .8 + o.charge); burst(o.x, o.y, o.color, .9 + o.charge, highMemory ? 20 : 10); }
      } else if (!cancelled && held >= 360) {
        ripple(o.x, o.y, .8 + (o.charge || 0) * 1.5); burst(o.x, o.y, o.color, 1 + (o.charge || 0), highMemory ? 32 : 18); o.flash = 1;
      } else if (!cancelled) tapOrb(o, o.x, o.y, performance.now());
    } else if (g.moved) {
      energyWave(g.lastWaveX, g.lastWaveY, p.x, p.y, 1.1);
    } else if (!cancelled) ripple(p.x, p.y, .48);
    selected = null; pointer = null; gesture = null;
  }
  canvas.addEventListener('pointerup', function (e) { release(e, false); });
  canvas.addEventListener('pointercancel', function (e) { release(e, true); });

  Array.prototype.forEach.call(document.querySelectorAll('.party-mode'), function (el) {
    el.addEventListener('click', function () { setMode(el.getAttribute('data-mode')); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.party-preset'), function (el) {
    el.addEventListener('click', function () { setPreset(el.getAttribute('data-preset')); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.party-experience'), function (el) {
    el.addEventListener('click', function () { setExperience(el.getAttribute('data-experience')); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.party-backdrop'), function (el) {
    el.addEventListener('click', function () { setBackdrop(el.getAttribute('data-backdrop')); });
  });
  document.getElementById('partyBass').addEventListener('click', bassCannon);
  var soundButton = document.getElementById('partySound');
  soundButton.addEventListener('click', function () {
    soundOn = !soundOn; soundButton.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    soundButton.querySelector('span').textContent = soundOn ? 'SOUND FX ON' : 'SOUND FX OFF';
    try { localStorage.setItem('nexus.party.sound', soundOn ? '1' : '0'); } catch (e) {}
    if (soundOn) sound(540, .09);
  });
  document.getElementById('partyAccess').addEventListener('click', function () {
    try { if (window.Android && Android.openNotificationAccess) Android.openNotificationAccess(); } catch (e) {}
    document.getElementById('pHint').textContent = 'ENABLE NEXUS UNDER ANDROID NOTIFICATION ACCESS TO READ MEDIA SESSIONS';
  });
  function setHint(text) { var hint = document.getElementById('pHint'); if (hint) hint.textContent = text; }
  function updateMedia() {
    if (!active || !window.Android || !Android.partyMediaInfo) return;
    var info = {};
    try { info = JSON.parse(Android.partyMediaInfo() || '{}'); } catch (e) {}
    var status = document.getElementById('partyMediaStatus');
    if (info.access === false) {
      status.setAttribute('data-state', 'disconnected');
      status.querySelector('span').textContent = 'NOTIFICATION ACCESS REQUIRED';
      document.getElementById('pSong').textContent = 'Media access unavailable';
      document.getElementById('partyArtist').textContent = 'Enable notification access';
      document.getElementById('partyPrev').disabled = true;
      document.getElementById('partyNext').disabled = true;
      document.getElementById('partyToggle').disabled = true;
      lastSong = ''; return;
    }
    var playing = !!info.playing, artist = info.artist && info.artist !== 'null' ? info.artist : '';
    var mediaActive = !!info.app && (!!info.title || playing);
    status.setAttribute('data-state', mediaActive ? (playing ? 'playing' : 'paused') : 'disconnected');
    var appName = info.app === 'com.spotify.music' ? 'SPOTIFY' : (info.app ? String(info.app).split('.').pop().toUpperCase() : 'MEDIA SESSION');
    status.querySelector('span').textContent = mediaActive ? appName + (playing ? ' · PLAYING' : ' · PAUSED') : 'MEDIA SESSION UNAVAILABLE';
    document.getElementById('pSong').textContent = mediaActive ? (info.title || 'Untitled track') : 'No media playing';
    document.getElementById('partyArtist').textContent = artist || (mediaActive ? 'Artist unavailable' : 'Connect a media player');
    document.getElementById('partyPrev').disabled = !info.canPrevious;
    document.getElementById('partyNext').disabled = !info.canNext;
    document.getElementById('partyToggle').disabled = !info.canPlayPause;
    document.getElementById('partyToggle').textContent = playing ? 'Ⅱ' : '▶';
    var key = (info.app || '') + '|' + (info.title || '') + '|' + (info.artist || '');
    if (mediaActive && key !== lastSong) {
      if (lastSong) ripple(w * .5, h * .46, .85);
      lastSong = key;
    }
    if (!mediaActive) lastSong = '';
    if (audioSource === 'fallback') {
      setHint(playing ? 'MUSIC ANALYSIS UNAVAILABLE · FIELD MOTION IS AMBIENT' : 'TOUCH ORBS OR SWIPE THE ENERGY FIELD');
    }
  }
  function mediaTick() { if (active) updateMedia(); }
  var oldMeter = window.Nexus && Nexus._meter;
  if (window.Nexus) {
    Nexus._meter = function (all, low, mid, high) {
      if (oldMeter) oldMeter(all, low, mid, high);
      if (!active) return;
      var bass = +low || 0, now = performance.now();
      inputEnergy = clamp((+all || 0) * 11, .08, 1.25); inputBass = clamp(bass * 11, 0, 1.5);
      inputMid = clamp((+mid || 0) * 15, 0, 1.35); inputHigh = clamp((+high || 0) * 24, 0, 1.35);
      // Per-band fast and slow envelopes, timed off the real sample gap so the analysis holds
      // whatever rate the Android meter delivers.
      var gapS = clamp((now - lastAudioSample) / 1000, .012, .25);
      if (!lastAudioSample) gapS = .04;
      lastAudioSample = now;
      var all0 = +all || 0, high0 = +high || 0;
      bassFast += (bass - bassFast) * Math.min(1, gapS / .055);
      bassSlow += (bass - bassSlow) * Math.min(1, gapS / .9);
      bassPeak = Math.max(bassPeak * (1 - gapS / 6), bassFast);
      energyFast += (all0 - energyFast) * Math.min(1, gapS / .3);
      energySlow += (all0 - energySlow) * Math.min(1, gapS / 4.5);
      highFast += (high0 - highFast) * Math.min(1, gapS / .35);
      highSlow += (high0 - highSlow) * Math.min(1, gapS / 4.5);
      if (bass > Math.max(.018, bassEnvelope * 1.3) && bass > .024 && now - lastBassKick > 165) {
        beatPulse = Math.min(1.5, beatPulse + clamp((bass - bassEnvelope) * 28 + .32, .35, 1.05)); lastBassKick = now;
        // Learn the groove, tolerating a missed kick or a detected subdivision.
        var gap = (now - lastBeatAt) / 1000;
        if (gap > .22 && gap < 1.6) {
          var ratio = gap / beatPeriod;
          if (ratio > 1.6 && ratio < 2.4) gap *= .5; else if (ratio > .42 && ratio < .62) gap *= 2;
          if (Math.abs(gap - beatPeriod) < beatPeriod * .35) { beatPeriod += (gap - beatPeriod) * .3; beatConfidence = Math.min(1, beatConfidence + .25); }
          else { beatConfidence = Math.max(0, beatConfidence - .2); if (beatConfidence < .2) beatPeriod = clamp(gap, .3, 1.2); }
        }
        lastBeatAt = now; beatPhase = 0;
        detectBurst(now); detectInk(now);
        if (mode === 'ripple') ripple(w * .5, h * .5, .7 + beatPulse * .55);
        if (mode === 'chaos') for (var bi = 0; bi < orbs.length; bi++) { orbs[bi].vx += (orbs[bi].x - w * .5) * .00055 * beatPulse; orbs[bi].vy += (orbs[bi].y - h * .5) * .00055 * beatPulse; }
      }
      bassEnvelope = bassEnvelope * .9 + bass * .1;
    };
    // ---- six-band detail (Nexus._meter6, ~30 a second while Party asks for it): the snare and the
    // hi-hats as their own events, each found as a jump in its band against that band's own recent level.
    var d6 = { lvl: [.02, .02], jump: [.05, .05], prev: [0, 0], last: [0, 0] };
    var feedDetail = function (v) {
      if (!active) return;
      var now = performance.now();
      detailAt = now;
      var bands = [(+v[2] || 0) * .4 + (+v[3] || 0) * .6, (+v[4] || 0) * .55 + (+v[5] || 0) * .45], gaps = [170, 85];
      for (var k = 0; k < 2; k++) {
        var x = bands[k], d = Math.max(0, x - d6.prev[k]) / (d6.lvl[k] + 1e-3); d6.prev[k] = x;
        var hit = d > d6.jump[k] * 2.2 + .35 && x > d6.lvl[k] * 1.12 && now - d6.last[k] > gaps[k];
        d6.jump[k] += (d - d6.jump[k]) * .06; d6.lvl[k] += (x - d6.lvl[k]) * .05;
        if (hit) { d6.last[k] = now; if (k === 0) onSnare(clamp(.5 + d * .4, .5, 1)); else onHat(clamp(.5 + d * .4, .5, 1)); }
      }
      detailMid = clamp(((+v[2] || 0) + (+v[3] || 0)) * 9, 0, 1.3); detailHigh = clamp(((+v[4] || 0) + (+v[5] || 0)) * 14, 0, 1.3);
    };
    // keeps Party on the six-band feed even if another part of Nexus installs its own handler later
    hookDetail = function () {
      var cur = Nexus._meter6;
      if (cur && cur.__party) return;
      var prev = cur, f = function (a, b, c, d, e, g) { if (prev) prev(a, b, c, d, e, g); feedDetail([a, b, c, d, e, g]); };
      f.__party = true; Nexus._meter6 = f;
    };
    hookDetail();
    var oldSource = Nexus._meterSource;
    Nexus._meterSource = function (source) {
      audioSource = source === 'music' ? 'frequency' : source === 'mic' ? 'microphone' : 'fallback';
      if (oldSource) oldSource(source);
      setHint(audioSource === 'frequency' ? 'PLAYBACK SYNC ACTIVE · ' + mode.toUpperCase() :
        audioSource === 'microphone' ? 'MIC INPUT ACTIVE' : 'MUSIC ANALYSIS UNAVAILABLE · TOUCH THE FIELD');
    };
    var oldError = Nexus._meterError;
    Nexus._meterError = function () {
      audioSource = 'fallback';
      if (oldError) oldError.apply(this, arguments);
      setHint('MUSIC ANALYSIS UNAVAILABLE · FIELD MOTION IS AMBIENT');
    };
  }
  function start() {
    if (active || document.hidden) return;
    active = true; runId++; lastFrame = 0;
    resize();
    bgFrom = bgTo; bgMix = 0; flowMix = flowTarget; flowTouchReset(true);
    inkMix = inkTarget; inkG = null; inkTwist.on = false; inkTwist.str = inkTwist.wind = 0; blastPow = 0; blastAge = 9; inkCols = null; glOpacity = 'x';
    buildUp = 0; beatPhase = 1; beatConfidence = 0; burstPower = 0; burstEnv = 0; burstAge = 9; fieldRecoil = 0;
    bassFast = 0; bassSlow = .01; bassPeak = .02; energyFast = energySlow = .08; highFast = highSlow = 0;
    lastAudioSample = 0; lastBeatAt = lastBurstAt = lastDropAt = lastQuietAt = performance.now();
    try { if (window.Android && Android.meterDetail) Android.meterDetail(true); } catch (e) {}
    snareEnv = hatEnv = 0;
    classicWeight = backdrop === 'classic' && experience === 'orb' ? 1 : 0;
    glInit();
    var token = runId;
    raf = requestAnimationFrame(function (t) { render(t, token); });
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(mediaTick, 2500);
    updateMedia();
    wakeUi();
  }
  function stop() {
    active = false; runId++;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (pollTimer) clearInterval(pollTimer); pollTimer = 0;
    clearTimeout(idleTimer); if (root.classList.contains('party-idle')) root.classList.remove('party-idle');
    selected = null; pointer = null; gesture = null; impulses.length = 0; waves.length = 0; inkG = null; inkTwist.on = false; flowTouchReset(true);
    try { if (window.Android && Android.meterDetail) Android.meterDetail(false); } catch (e) {}
    ctx.clearRect(0, 0, w, h);
    glDestroy();
  }
  // The controls fade out after a few seconds without a touch, leaving only the visuals; any touch on
  // Party Mode brings them back (and still reaches the field underneath).
  var idleTimer = 0;
  // (the class is only touched when it changes: any write to it wakes the visibility observer)
  function wakeUi() {
    if (root.classList.contains('party-idle')) root.classList.remove('party-idle');
    clearTimeout(idleTimer);
    if (active) idleTimer = setTimeout(function () { if (active && !root.classList.contains('party-idle')) root.classList.add('party-idle'); }, 6000);
  }
  root.addEventListener('pointerdown', wakeUi, true);
  root.addEventListener('keydown', wakeUi, true);
  function syncVisibility() {
    if (document.hidden || root.classList.contains('hidden')) stop();
    else start();
  }
  new MutationObserver(syncVisibility).observe(root, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', syncVisibility);
  window.addEventListener('resize', resize);
  try {
    setPreset(localStorage.getItem('nexus.party.preset') || 'orb');
    soundOn = localStorage.getItem('nexus.party.sound') === '1';
    setBackdrop(localStorage.getItem('nexus.party.backdrop') || 'classic');
    setExperience(localStorage.getItem('nexus.party.experience') || 'orb');
  } catch (e) { setPreset('orb'); }
  syncExperienceUi();
  soundButton.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  soundButton.querySelector('span').textContent = soundOn ? 'SOUND FX ON' : 'SOUND FX OFF';
  setMode('pulse');
  window.NexusParty = { setExperience: setExperience, setBackdrop: setBackdrop,
    state: function () { return { experience: experience, backdrop: backdrop, gl: glOk, glFailed: glFailed, glFrames: glFrames, glScale: glScale, quality: glQuality, flowMix: flowMix, bgMix: bgMix, surge: surge, flowPhase: flowPhase, classicWeight: classicWeight, active: active, variant: glVariant,
      build: buildUp, beatPhase: beatPhase, beatPeriod: beatPeriod, beatConfidence: beatConfidence, burst: burstEnv, burstPower: burstPower, burstAge: burstAge, burstCount: burstCount, recoil: fieldRecoil,
      bassFast: bassFast, bassSlow: bassSlow, energyFast: energyFast, energySlow: energySlow,
      touch: { n: touchN, on: flowTouchOn, down: flowTouches.filter(function (t) { return t.down; }).length, wake: flowWake.length, gestures: { tap: flowGestures.tap, hold: flowGestures.hold, drag: flowGestures.drag, multi: flowGestures.multi },
        attract: Math.max(flowTouches[0].attract, flowTouches[1].attract, flowTouches[2].attract, flowTouches[3].attract), contact: Math.max(flowTouches[0].contact, flowTouches[1].contact, flowTouches[2].contact, flowTouches[3].contact),
        bursts: flowBursts.filter(function (b) { return b.age < 9; }).length },
      music: { bass: bassLevel, mid: midLevel, high: highLevel, energy: musicLevel, beat: beatPulse, snare: snareEnv, hat: hatEnv, snareHits: snareHits, hatHits: hatHits, detail: performance.now() - detailAt < 600 },
      ink: { mix: inkMix, failed: inkFailed, frames: inkFrames, t: inkT, swirl: inkSwirl, blast: blastEnv, blastCount: inkBlastCount, palette: preset,
        gestures: { burst: inkGestures.burst, twist: inkGestures.twist, drag: inkGestures.drag, splash: inkGestures.splash, inject: inkGestures.inject },
        twist: { on: inkTwist.on, str: inkTwist.str, wind: inkTwist.wind }, injected: Math.max(inkInj[0].amt, inkInj[1].amt),
        dragLife: Math.max(inkDrags[0].life, inkDrags[1].life, inkDrags[2].life, inkDrags[3].life), splashAge: inkSplash.age,
        burstAge: Math.min(inkBursts[0].age, inkBursts[1].age, inkBursts[2].age), cols: inkCols ? inkCols.map(function (c) { return c.slice(); }) : null } }; },
    triggerInk: function (p) { triggerInk(p || 1); } };
})();
