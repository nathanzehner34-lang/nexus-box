/* NEXUS LIVE ENVIRONMENTS — the general interface background engine.
   Five GPU-rendered worlds (Prismatic Dimension, Floating Energy, Cosmic Aurora, Neural Flow, Bioluminescent Abyss) share one WebGL
   context, one render loop and one settings store. Only the active world renders; it pauses whenever
   it is hidden (Party Mode, visuals, Liquid Dreams, app in background). Specialized features keep
   their own renderers and are never drawn by this engine. */
(function () {
  'use strict';
  var A = window.Android || null;
  function pref(k) { try { return A ? A.getPref(k) : (localStorage.getItem('p_' + k) || ''); } catch (e) { return ''; } }
  function setPref(k, v) { try { if (A) A.setPref(k, v); else localStorage.setItem('p_' + k, v); } catch (e) {} }
  var memGb = 0; try { memGb = Number(A && A.deviceMemoryGb ? A.deviceMemoryGb() : 0); } catch (e) {}
  if (!memGb) memGb = Number(navigator.deviceMemory) || 2;
  var HIGH_MEMORY = memGb >= 6;
  // 2 GB boxes get the lighter interface surfaces (no live blur over the animated world).
  try { if (!HIGH_MEMORY) document.documentElement.classList.add('nx-lite'); } catch (e) {}

  var COMMON = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nuniform vec2 res;\nuniform float T, bass, mid, high, move, bright, detail, quality;\nuniform vec3 c1, c2, c3, tint;\nfloat hash1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nvec2 hash2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}\nfloat noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash1(i),hash1(i+vec2(1.,0.)),f.x),mix(hash1(i+vec2(0.,1.)),hash1(i+vec2(1.,1.)),f.x),f.y);}\nfloat fbm(vec2 p,float oct){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<6;i++){if(float(i)>=oct)break;v+=a*noise(p);p=m*p+vec2(3.1,1.7);a*=.5;}return v;}\nmat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}\nfloat sdBox(vec2 p,vec2 b){vec2 d=abs(p)-b;return length(max(d,0.))+min(max(d.x,d.y),0.);}\nvec3 finish(vec3 col,vec2 uv){\ncol*=bright;\ncol=col/(1.+col*.32)*1.12;\ncol=pow(max(col,0.),vec3(.95));\ncol*=tint;\ncol*=.72+.28*smoothstep(1.25,.2,length(uv*vec2(.85,1.)));\ncol+=(hash1(gl_FragCoord.xy+fract(T*13.))-.5)/255.*2.;\nreturn clamp(col,0.,1.);\n}\n";
  var ENVIRONMENTS = [
    { id: 'prism', name: 'Prismatic Dimension', tagline: 'Crystal light refracting through endless glass', src: "vec3 film(float x){return .5+.5*cos(6.2832*(x+vec3(0.,.33,.67)));}\nvec3 scene(vec2 uv){\nfloat t=T;\nvec2 p=rot(t*.006+.06*sin(t*.031))*uv;\np+=.004*(.5+move*.5)*vec2(sin(p.y*9.+t*.21),cos(p.x*8.-t*.17));\nfloat a=atan(p.y,p.x);\nfloat seg=.7854;\nfloat ai=floor(a/seg+.5);\nfloat al=a-ai*seg;\nfloat pr=max(length(p)*cos(al),.012);\nfloat z=.3/pr;\nfloat zz=z+t*(.16+.1*move);\nfloat u=tan(al)/.41421;\nfloat lu=(u*.5+.5)*3.;\nfloat li=floor(lu),lf=fract(lu);\nfloat lane=ai*3.+li;\nfloat hl=hash1(vec2(lane,7.31));\nfloat L=.55+1.3*hl;\nfloat sz=zz/L+hl*9.;\nfloat si=floor(sz),sf=fract(sz);\nfloat h=hash1(vec2(lane,si));\nfloat on=.25+.75*step(.22,h);\nfloat fog=exp(-z*.42);\nfloat zl=sf*L,ze=min(zl,L-zl);\nfloat pulse=exp(-pow(fract(zz*.06-t*.012+hl*.1)-.5,2.)*60.);\nfloat disp=.035+.02*sin(t*.07);\nvec3 ed;\nfor(int k=0;k<3;k++){float o=(float(k)-1.)*disp;float f=fract(lu+o);float e=min(f,1.-f);ed[k]=exp(-e*(18.+4.*quality))+(.4+.2*quality)*exp(-e*(38.+32.*quality));}\nfloat ends=exp(-ze*(9.+z*3.));\nvec3 phase=film(lf*.55+zz*.035+h*.4+t*.012+mid*.08);\nvec3 glass=mix(c2,c3,.5+.5*sin(lane*1.7+si*.9+t*.05));\nfloat bevel=.35+.65*pow(sin(lf*3.1416),.6);\nfloat lit=smoothstep(.62,.95,h)*(.6+.4*sin(t*.09+h*30.));\nfloat bpos=fract(sf*.8+h*3.+t*.02);\nfloat band=exp(-pow(lf-bpos,2.)*55.)*smoothstep(.0,.15,sf)*(1.-smoothstep(.85,1.,sf));\nvec3 col=glass*bevel*(.07+.22*lit)*on;\ncol+=film(lf*1.6+h+t*.015)*band*(.10+.30*lit)*on;\ncol+=mix(glass,phase,.45)*ed*(.32+.12*bass)*on;\ncol+=mix(c3,phase,.6)*ends*(.30+.25*lit)*on;\ncol*=1.+pulse*.9;\nfloat tw=hash1(vec2(lane*3.1,si*1.7));\nfloat spark=step(.86,tw)*pow(.5+.5*sin(t*.6+tw*40.),6.)*exp(-(length(vec2(lf-.5,(sf-.5)*L))*14.));\ncol+=vec3(1.,.97,1.)*spark*(.9+.6*high);\nif(quality>.5){float f2=fract(lu*3.);col+=glass*exp(-min(f2,1.-f2)*30.)*.05*on;col+=phase*.03*fbm(vec2(lu*2.,zz*1.5),2.)*on;}\ncol*=fog;\nfloat r=length(uv);\nvec3 core=mix(c3,c2,.5+.5*sin(t*.04));\ncol+=core*(.10*exp(-r*7.)+.05*exp(-r*2.5));\ncol+=c1*.4;\ncol*=.8+.2*smoothstep(.0,.35,r);\nreturn col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}",

      palettes: [["Spectral Glass",[[0.02,0.015,0.05],[0.55,0.4,1],[0.3,0.85,1]]],["Aurora Crystal",[[0.01,0.03,0.05],[0.2,0.9,0.8],[0.75,0.4,1]]],["Rose Quartz",[[0.04,0.015,0.04],[1,0.4,0.7],[0.6,0.5,1]]]] },
    { id: 'energy', name: 'Floating Energy', tagline: 'Glass orbs of light drifting at depth', src: "vec3 orb(vec2 p,vec2 c,float R,float soft,float fi,float t){\nvec2 d=(p-c)/R;float r=length(d);\nif(r>2.2)return vec3(0.);\nfloat a=atan(d.y,d.x);\nfloat rim=smoothstep(1.,1.-.05-soft,r)*pow(r,7.);\nrim+=exp(-abs(r-1.)*(26./(1.+soft*5.)))*.55;\nfloat body=smoothstep(1.,0.,r)*.07;\nfloat halo=exp(-max(r-1.,0.)*3.5)*step(1.,r)*.1;\nvec3 irid=mix(c2,c3,.5+.5*sin(a+t*.2+fi*2.+r*3.));\nirid=mix(irid,vec3(.55,.9,1.),.2*(.5+.5*sin(a*2.-t*.3+fi)));\nvec3 col=irid*(rim*(1.1+.25*bass)+body+halo);\nvec2 sp=d-vec2(-.42,.45);\ncol+=vec3(1.)*exp(-dot(sp,sp)*28.)*.5*step(r,1.);\nvec2 nd=d/(r+1e-4);\nfloat cres=smoothstep(.72,.93,r)*smoothstep(1.,.94,r)*smoothstep(.2,.95,dot(nd,vec2(.6,-.8)));\ncol+=c3*cres*(.8+.3*high);\nreturn col;\n}\nvec3 scene(vec2 uv){\nfloat t=T;\nvec3 col=c1*.35+c2*.06*exp(-length(uv-vec2(.1*sin(t*.03),0.))*2.);\ncol+=mix(c2,c3,.5+.5*sin(t*.04))*.05*fbm(uv*1.4+vec2(t*.015,t*.01),3.);\nfor(int i=0;i<12;i++){float fi=float(i);if(fi>=9.+quality*3.)break;\nvec2 h=hash2(vec2(fi*3.7,fi*1.3+.5));\nfloat depth=.3+.7*fract(h.x*7.13+h.y*3.1);\nfloat R=.05+.15*depth*depth;\nfloat dir=h.y>.5?1.:-1.;\nfloat ang=h.x*6.2832+t*(.025+.035*h.y)*dir;\nvec2 rad=vec2(.3+.5*h.y,.14+.22*h.x)*(.8+.2*move);\nvec2 c=vec2(cos(ang),sin(ang))*rad+vec2(.15*sin(t*.03+fi),.04*sin(t*.07+fi*2.))*move;\ncol+=orb(uv,c,R,(1.-depth)*.5,fi,t)*(.3+.7*depth);\n}\nreturn col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}",
      palettes: [["Prism",[[.02,.01,.06],[.7,.25,1],[.2,.8,1]]],["Cyan Glass",[[.01,.02,.06],[.2,.85,1],[.5,.35,1]]],["Rose Quartz",[[.03,.01,.05],[1,.35,.8],[.55,.45,1]]]] },
    { id: 'aurora', name: 'Cosmic Aurora', tagline: 'Curtains of light beneath the stars', src: "vec3 stars(vec2 p,float sc,float t){vec2 sp=p*sc;vec2 id=floor(sp);vec2 h=hash2(id);\nfloat s=step(.93,h.x)*smoothstep(.14,0.,length(fract(sp)-.5-.3*(h-.5)));\nreturn vec3(.8,.85,1.)*s*(.45+.4*sin(t*(.4+h.y)+h.x*30.));}\nvec3 scene(vec2 uv){\nfloat t=T;\nvec3 col=mix(c1*.5+c2*.03,c1*.2,smoothstep(-.5,.5,uv.y));\nfloat x=uv.x+.07*move*sin(uv.y*2.+t*.11)+.12*fbm(vec2(uv.y*.8,t*.03),2.);\nfloat big=fbm(vec2(x*1.3+t*.025,t*.02),3.);\nfloat rays=noise(vec2(x*26.+t*.12,uv.y*.6+t*.05))*.6+noise(vec2(x*61.-t*.08,t*.07))*.4;\nrays+=quality*(noise(vec2(x*140.-t*.1,uv.y*2.))-.5)*.3;\nrays=rays*rays*(1.+.25*mid);\nfloat top=.05+.45*big+.05*sin(x*3.+t*.07);\nfloat vert=smoothstep(top+.08,top-.25,uv.y)*smoothstep(-.62,-.2,uv.y)*(.6+.4*smoothstep(.3,-.4,uv.y));\nfloat hc=.5+.5*sin(x*2.3+t*.05);\nvec3 cc=mix(c3,c2,hc);\ncc=mix(cc,mix(c2,vec3(.2,.95,.9),.4),.35*smoothstep(0.,-.45,uv.y)*hc);\ncol+=cc*rays*vert*(.5+big)*1.5;\ncol+=cc*vert*big*.18;\ncol+=mix(c2,c3,.5+.5*sin(t*.05))*exp(-(uv.y+.5)*5.)*.3*(1.+.2*bass);\nfloat fade=1.-vert*.8;\ncol+=stars(uv+vec2(t*.003,0.),38.,t)*fade;\nif(quality>.5)col+=stars(uv+vec2(t*.0015,7.),70.,t)*fade*.6;\nreturn col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}",
      palettes: [["Polar",[[.01,.02,.07],[.25,.6,1],[.95,.4,.85]]],["Teal Sky",[[.01,.03,.06],[.2,.95,.85],[.5,.35,1]]],["Violet Veil",[[.03,.01,.08],[.6,.35,1],[.25,.75,1]]]] },
    { id: 'neural', name: 'Neural Flow', tagline: 'Luminous filaments carrying points of light', src: "vec3 bundle(vec2 uv,float t,float off,float amp,float tilt,float seed,float n,float gain){\nvec3 col=vec3(0.);\nfloat x=uv.x;\nfloat yc=(amp*sin(x*1.5+t*.12+seed)+.07*sin(x*3.3-t*.17+seed*2.))*(.6+.4*move)+x*tilt+off;\nfloat spread=.06+.08*(.5+.5*sin(x*1.2+t*.09+1.+seed));\nfloat dyc=uv.y-yc;\nvec3 hue=mix(c2,c3,.5+.5*sin(x*.9+t*.06+seed));\ncol+=hue*exp(-abs(dyc)/(spread*2.2))*.22*gain*(1.+.2*bass);\nif(abs(dyc)<spread+.1){\nfor(int i=0;i<18;i++){float fi=float(i);if(fi>=n)break;\nvec2 h=hash2(vec2(fi+seed*13.,7.7));\nfloat dir=h.x>.5?1.:-1.;\nfloat o=spread*sin(x*(2.+h.x*3.)+t*(.15+.2*h.y)*dir+fi*1.7)*(.55+.45*h.y);\nfloat d=abs(dyc-o);\nvec3 fc=mix(c2,c3,h.x);\ncol+=fc*exp(-d*(230.+h.y*200.))*(.3+.35*h.x)*gain;\nfloat fq=2.+h.y*2.;\nfloat u=x*fq-t*(.05+.08*h.x)+h.y*3.;\nfloat nb=hash1(vec2(floor(u),fi+seed));\nfloat dx=(fract(u)-.5)/fq;\nfloat r2=dx*dx+d*d;\ncol+=mix(fc,vec3(1.),.45)*step(.5,nb)*(exp(-r2*9000.)*1.1+exp(-r2*700.)*.25)*(1.+.4*high)*gain;\n}\n}\nreturn col;\n}\nvec3 scene(vec2 uv){\nfloat t=T;\nvec3 col=c1*.4+mix(c1,c2,.35)*.16*exp(-length(uv-vec2(.3*sin(t*.02),.05))*1.4);\ncol+=bundle(uv,t,-.04,.22,.2,0.,10.+quality*6.,1.);\ncol+=bundle(uv,t*.8,.3,.12,-.12,3.7,5.+quality*3.,.55);\nreturn col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}",
      palettes: [["Synapse",[[.03,.01,.07],[.85,.35,1],[.3,.65,1]]],["Fiber Blue",[[.01,.02,.07],[.25,.6,1],[.75,.4,1]]],["Cyan Pulse",[[.01,.03,.06],[.2,.95,.9],[.65,.35,1]]]] },
    { id: 'abyss', name: 'Bioluminescent Abyss', tagline: 'Glowing life drifting in the deep ocean', src: "float ridgeY(float x){return -.37+.03*sin(x*2.3+1.)+.018*sin(x*5.1+2.)+.008*sin(x*11.7);}\nvec3 jelly(vec2 p,vec2 c,float R,float fi,float t,float tn){\nvec2 d=(p-c)/R;\nif(d.y>1.25||d.y<-3.6||abs(d.x)>1.6)return vec3(0.);\nfloat pu=sin(t*.9+fi*2.1);\nd.x*=1.+.07*pu;d.y*=1.-.05*pu;\nvec3 col=vec3(0.);\nfloat a=atan(d.x,max(d.y,0.)+.001);\nfloat edge=d.y+.12+.05*sin(a*9.+t*.7+fi);\nfloat r=length(d*vec2(1.,1.18));\nfloat shell=(1.-smoothstep(.97,1.,r))*smoothstep(-.03,.03,edge);\nfloat rim=exp(-abs(r-1.)*16.)*smoothstep(-.05,.1,edge);\nfloat lip=exp(-abs(edge)*28.)*(1.-smoothstep(.85,1.1,abs(d.x)));\nfloat ribs=pow(abs(cos(a*4.)),10.)*shell*smoothstep(.1,.9,r);\nvec3 cr=mix(c2,c3,.35+.3*sin(fi*1.7+t*.05));\ncol+=cr*(shell*.10+rim*.55+ribs*.18)+c3*lip*.45;\ncol+=mix(c3,vec3(1.),.4)*exp(-dot(d-vec2(0.,.35),d-vec2(0.,.35))*5.)*.22;\nif(d.y<0.){float fall=1.+d.y/3.6;\nfor(int k=0;k<6;k++){float fk=float(k);if(fk>=tn)break;\nfloat x0=-.8+fk*.32;float w=d.y*(.16+.04*fk)*sin(d.y*2.2+t*1.1+fk*1.3+fi);\nfloat dx=abs(d.x-x0*(1.-.15*d.y)-w);\ncol+=cr*exp(-dx*(40.+20.*fall))*fall*fall*.42;}\nfloat arm=abs(d.x-.12*sin(d.y*4.+t*.8+fi)*(-d.y));\ncol+=c3*exp(-arm*9.)*smoothstep(-2.,-.1,d.y)*.16;}\nreturn col;\n}\nvec3 scene(vec2 uv){\nfloat t=T;\nfloat y=uv.y;\nvec3 deep=c1*.55+vec3(0.,.006,.014);\nvec3 col=mix(deep,c1*1.5+c2*.05+vec3(0.,.02,.04),smoothstep(-.7,.7,y));\nfloat sx=uv.x+y*.42;\nfloat sh=noise(vec2(sx*3.2+t*.04,t*.035))*noise(vec2(sx*6.5-t*.02,1.7+t*.01));\ncol+=mix(c2,vec3(.55,.9,1.),.55)*sh*sh*smoothstep(-.6,.6,y)*(.3+.06*mid);\ncol+=mix(c2,c3,.5)*.05*fbm(uv*vec2(1.3,2.2)+vec2(t*.012,-t*.007),2.);\nfloat ry=ridgeY(uv.x);\nfloat g=1.-smoothstep(ry-.012,ry+.012,y);\nif(g>0.)col=mix(col,deep*(.45+.5*fbm(uv*vec2(7.,12.),2.))+c2*.012,g);\ncol+=mix(c2,c3,.5+.5*sin(uv.x*2.+t*.05))*.05*exp(-abs(y-ry)*30.);\nfloat clu=clamp(floor((uv.x+.72)/.72+.5),0.,2.);\nfor(int j=0;j<2;j++){float fi=clu*2.+float(j);\nvec2 hh=hash2(vec2(fi*2.3,4.1));\nfloat cl=floor(fi/2.);float mx=-.72+cl*.72+(mod(fi,2.)*.07-.02)*(1.+hh.x)+.05*hh.y;\nfloat my=ridgeY(mx)-.01;\nfloat big=1.-mod(fi,2.)*.45;float mh=(.05+.07*hh.y)*big,mw=(.045+.035*hh.x)*big;\nfloat glow=.65+.35*sin(t*.35+fi*1.9);\nvec2 q=uv-vec2(mx+.01*sin(t*.2+fi),my);\nif(abs(q.x)>.3||q.y>.36||q.y<-.12)continue;\nfloat stem=exp(-abs(q.x+.01*sin(q.y*30.))*(90./big))*step(0.,q.y)*(1.-smoothstep(mh-.01,mh,q.y));\nvec2 cq=(q-vec2(0.,mh))/vec2(mw,mw*.75);\nfloat cr2=length(cq);\nfloat cap=(1.-smoothstep(.9,1.,cr2))*smoothstep(-.25,0.,cq.y);\nfloat caprim=exp(-abs(cr2-1.)*10.)*smoothstep(-.2,.1,cq.y);\nfloat gills=exp(-abs(cq.y+.15)*14.)*(1.-smoothstep(.7,1.,abs(cq.x)));\nvec3 mc=mix(c3,c2,hh.y);\ncol+=mc*(stem*.4+cap*.18+caprim*.45+gills*.5)*glow;\ncol+=mc*exp(-length(q-vec2(0.,mh))*16.)*.09*glow;}\nvec2 pc=vec2(uv.x*22.,0.);float pid=floor(pc.x);float pf=fract(pc.x)-.5;\nfloat ph=hash1(vec2(pid,9.));\nvec2 pp=vec2(pf,(y-ridgeY((pid+.5)/22.)-.012-.05*ph)*22.);\ncol+=mix(c2,c3,ph)*exp(-dot(pp,pp)*22.)*step(.45,ph)*(.25+.25*sin(t*.8+ph*50.))*(1.+.6*high);\nfloat tn=4.+2.*quality;\nfor(int i=0;i<6;i++){float fi=float(i);if(fi>=5.+quality)break;\nvec2 h=hash2(vec2(fi*5.3,fi*1.9+2.));\nfloat depth=.35+.65*fract(h.x*3.7+h.y*1.3);\nfloat R=.045+.07*depth;\nfloat cy=-1.2+mod(h.y*2.6+t*(.016+.014*depth)*(.7+.3*move),2.6);\nfloat cx=-.8+1.6*fract(h.x*1.7+fi*.37)+.07*sin(t*.07+fi*2.)*move;\nfloat al=smoothstep(-.5,-.15,cy)*(1.-smoothstep(.75,1.05,cy));\nvec2 dd=(uv-vec2(cx,cy))/R;if(al<=0.||dd.y>1.3||dd.y<-3.7||abs(dd.x)>1.7)continue;\ncol+=jelly(uv,vec2(cx,cy),R,fi,t,tn)*al*(.35+.65*depth)*(1.+.15*bass);}\nfor(int l=0;l<2;l++){float fl=float(l);\nfloat sc=9.+fl*7.;\nvec2 sp=uv*sc+vec2(sin(t*.05+fl)*.6,t*(.06+.05*fl));\nvec2 id=floor(sp);vec2 f=fract(sp)-.5;\nvec2 rh=hash2(id+fl*13.);\nvec2 o=(rh-.5)*.7;\nfloat pd=length(f-o);\ncol+=mix(vec3(.6,.9,1.),c3,rh.x)*exp(-pd*pd*(260.-fl*90.))*step(.55,rh.y)*(.12+.1*fl)*(.6+.4*sin(t*.5+rh.x*30.));}\nreturn col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}",

      palettes: [["Deep Lagoon",[[0.01,0.03,0.07],[0.1,0.85,0.95],[0.85,0.3,1]]],["Emerald Trench",[[0.01,0.04,0.05],[0.2,1,0.7],[0.3,0.6,1]]],["Violet Reef",[[0.03,0.02,0.07],[0.75,0.35,1],[0.25,0.8,1]]]] }
  ];
  var IDS = ENVIRONMENTS.map(function (e) { return e.id; });
  var QUALITY = { smooth: { scale: .42, fps: 24, q: 0 }, balanced: { scale: .6, fps: 30, q: 1 }, high: { scale: .82, fps: 30, q: 1 } };
  var RANGES = { speed: [.25, 2], movement: [0, 2], brightness: [.5, 1.5], colorSpeed: [.25, 3], sensitivity: [0, 2] };
  var DEFAULTS = { env: 'prism', palettes: { prism: 0, energy: 0, aurora: 0, neural: 0, abyss: 0 }, speed: 1, movement: 1, brightness: 1, colorSpeed: 1, reducedMotion: false, quality: 'auto', audio: true, sensitivity: 1 };

  function normalize(v) {
    var s = JSON.parse(JSON.stringify(DEFAULTS)), src = v && typeof v === 'object' ? v : {};
    // worlds retired from earlier builds open their closest successor instead of the default
    var LEGACY = { nebula: 'prism', chrome: 'abyss', deepflow: 'prism', iridescence: 'energy', cosmic: 'aurora' };
    if (IDS.indexOf(src.env) >= 0) s.env = src.env; else if (LEGACY[src.env]) s.env = LEGACY[src.env];
    if (src.palettes && typeof src.palettes === 'object') IDS.forEach(function (id) { var n = Math.round(Number(src.palettes[id])); if (n >= 0 && n < 3) s.palettes[id] = n; });
    Object.keys(RANGES).forEach(function (k) { var n = Number(src[k]); if (isFinite(n)) s[k] = Math.max(RANGES[k][0], Math.min(RANGES[k][1], n)); });
    s.reducedMotion = src.reducedMotion === true;
    s.audio = src.audio !== false;
    if (['auto', 'smooth', 'balanced', 'high'].indexOf(src.quality) >= 0) s.quality = src.quality;
    return s;
  }
  var S = (function () { try { return normalize(JSON.parse(pref('envSettings') || '{}')); } catch (e) { return normalize({}); } })();
  function save() { setPref('envSettings', JSON.stringify(S)); }
  function qualityName() { return S.quality === 'auto' ? (HIGH_MEMORY ? 'high' : 'smooth') : S.quality; }

  var cv = null, gl = null, buf = null, programs = {}, blendProg = null, snapTex = null, fbo = null, fboTex = null;
  var active = false, raf = 0, lastFrame = 0, lastT = 0, T = 20 + Math.random() * 60, scale = 1, slowFrames = 0, fastFrames = 0;
  var envIndex = IDS.indexOf(S.env), fade = 1, mode = { intruder: false };
  var pal = ENVIRONMENTS[envIndex].palettes[S.palettes[S.env]][1].map(function (c) { return c.slice(); });
  var aBass = 0, aMid = 0, aHigh = 0, aEnergy = 0, speedNow = S.speed, moveNow = S.movement, brightNow = S.brightness, tint = [1, 1, 1];
  var previews = [], previewTurn = 0, lastPreview = 0, meterWanted = false;

  function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { try { console.log(gl.getShaderInfoLog(s)); } catch (e) {} gl.deleteShader(s); return null; } return s; }
  function link(fsrc) {
    var vs = compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'), fs = compile(gl.FRAGMENT_SHADER, fsrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
    p.loc = {}; p.attr = gl.getAttribLocation(p, 'p'); return p;
  }
  function program(i) { if (!programs[i]) programs[i] = link(COMMON + ENVIRONMENTS[i].src); return programs[i]; }
  function U(p, n) { if (!(n in p.loc)) p.loc[n] = gl.getUniformLocation(p, n); return p.loc[n]; }
  // Programs for worlds that are not on screen are released, so only one world's resources stay alive.
  function releaseUnused() { Object.keys(programs).forEach(function (k) { if (+k !== envIndex && programs[k]) { gl.deleteProgram(programs[k]); delete programs[k]; } }); }

  function init() {
    cv = document.getElementById('bg'); if (!cv) return;
    try { gl = cv.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'default' }) || cv.getContext('experimental-webgl'); } catch (e) { gl = null; }
    if (gl) {
      buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      blendProg = link('precision mediump float;uniform sampler2D img;uniform vec2 res;uniform float k,tt;' +
        'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}' +
        'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}' +
        'void main(){vec2 uv=gl_FragCoord.xy/res;float m=n(uv*vec2(5.,3.)+tt*.2)*.6+n(uv*13.)*.25+uv.y*.15;' +
        'float a=1.-smoothstep(m-.15,m+.15,k*1.4-.2);gl_FragColor=vec4(texture2D(img,uv).rgb,a);}');
      cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); programs = {}; blendProg = null; snapTex = null; fbo = null; });
      cv.addEventListener('webglcontextrestored', function () { gl = null; init(); });
    }
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); else if (active) start(); });
  }
  function resize() {
    if (!cv) return;
    var q = QUALITY[qualityName()], dpr = Math.min(1, window.devicePixelRatio || 1);
    scale = Math.min(scale, q.scale); if (scale < .3 || !isFinite(scale)) scale = q.scale;
    cv.width = Math.max(1, Math.round(cv.clientWidth * dpr * scale)); cv.height = Math.max(1, Math.round(cv.clientHeight * dpr * scale));
  }
  function ease(cur, target, dt, ms) { return cur + (target - cur) * (1 - Math.exp(-dt / ms)); }
  // the home-screen worlds move on their own and never follow the music: no meter, no audio input
  function music() { return null; }
  function uniforms(p, w, h, quality) {
    gl.uniform2f(U(p, 'res'), w, h); gl.uniform1f(U(p, 'T'), T);
    gl.uniform1f(U(p, 'bass'), aBass); gl.uniform1f(U(p, 'mid'), aMid); gl.uniform1f(U(p, 'high'), aHigh);
    gl.uniform1f(U(p, 'move'), moveNow); gl.uniform1f(U(p, 'bright'), brightNow); gl.uniform1f(U(p, 'detail'), quality ? 1 : .6); gl.uniform1f(U(p, 'quality'), quality);
    gl.uniform3f(U(p, 'tint'), tint[0], tint[1], tint[2]);
  }
  function drawEnv(i, w, h, colors, quality) {
    var p = program(i); if (!p) return false;
    gl.useProgram(p); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(p.attr); gl.vertexAttribPointer(p.attr, 2, gl.FLOAT, false, 0, 0);
    uniforms(p, w, h, quality);
    gl.uniform3f(U(p, 'c1'), colors[0][0], colors[0][1], colors[0][2]); gl.uniform3f(U(p, 'c2'), colors[1][0], colors[1][1], colors[1][2]); gl.uniform3f(U(p, 'c3'), colors[2][0], colors[2][1], colors[2][2]);
    gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }
  function frame(now) {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    var q = QUALITY[qualityName()], gap = 1000 / q.fps;
    if (now - lastFrame < gap - 2) return;
    var dt = Math.min(100, lastT ? now - lastT : gap); lastT = now; lastFrame = now;
    // adaptive resolution: frames that arrive late lower the render scale; steady headroom raises it again
    if (dt > gap * 1.7) { slowFrames++; fastFrames = 0; } else { fastFrames++; if (fastFrames > 1) slowFrames = Math.max(0, slowFrames - 1); }
    if (slowFrames > 45 && scale > .3) { scale = Math.max(.3, scale - .08); slowFrames = 0; resize(); }
    else if (fastFrames > 600 && scale < q.scale) { scale = Math.min(q.scale, scale + .05); fastFrames = 0; resize(); }
    var low = S.reducedMotion, B = music(), sens = S.sensitivity * (low ? 0 : 1);
    aBass = ease(aBass, B ? Math.min(1, Math.max(B.k * .7, B.e * .6)) * sens : 0, dt, 600);
    aMid = ease(aMid, B ? Math.min(1, B.mid * 1.4) * sens : 0, dt, 900);
    aHigh = ease(aHigh, B ? Math.min(1, B.high * 1.6) * sens : 0, dt, 300);
    aEnergy = ease(aEnergy, B ? Math.min(1, B.e) * sens : 0, dt, 1500);
    var targetSpeed = S.speed * (low ? .3 : 1), targetMove = S.movement * (low ? .35 : 1);
    speedNow = ease(speedNow, targetSpeed, dt, 700); moveNow = ease(moveNow, targetMove, dt, 700);
    brightNow = ease(brightNow, S.brightness, dt, 900);
    var tt = mode.intruder ? [1.35, .35, .35] : [1, 1, 1]; for (var c = 0; c < 3; c++) tint[c] = ease(tint[c], tt[c], dt, 500);
    T += dt / 1000 * speedNow * (1 + aEnergy * .25);
    var target = ENVIRONMENTS[envIndex].palettes[S.palettes[IDS[envIndex]]][1], k = 1 - Math.exp(-dt / (3200 / S.colorSpeed * (low ? 1.5 : 1)));
    for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) pal[a][b] += (target[a][b] - pal[a][b]) * k;
    if (!gl) { drawFallback(); return; }
    gl.disable(gl.BLEND);
    drawEnv(envIndex, cv.width, cv.height, pal, q.q);
    if (snapTex && fade < 1) {
      fade = Math.min(1, fade + dt / (low ? 2600 : 1700));
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(blendProg); gl.enableVertexAttribArray(blendProg.attr); gl.vertexAttribPointer(blendProg.attr, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, snapTex);
      gl.uniform1i(U(blendProg, 'img'), 0); gl.uniform2f(U(blendProg, 'res'), cv.width, cv.height); gl.uniform1f(U(blendProg, 'k'), fade); gl.uniform1f(U(blendProg, 'tt'), T);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disable(gl.BLEND);
      if (fade >= 1) { gl.deleteTexture(snapTex); snapTex = null; releaseUnused(); }
    }
    if (previews.length) {
      // previews whose panel was closed are dropped, and their worlds' programs released
      var alive = previews.filter(function (pv) { return pv.canvas && pv.canvas.isConnected; });
      if (alive.length !== previews.length) { previews = alive; if (!previews.length && !snapTex) releaseUnused(); }
      if (previews.length && now - lastPreview > (HIGH_MEMORY ? 120 : 260)) { lastPreview = now; renderPreview(previews[previewTurn++ % previews.length]); }
    }
  }
  function drawFallback() {
    var x = cv.getContext('2d'); if (!x) return;
    var g = x.createLinearGradient(0, 0, cv.width * (.6 + .4 * Math.sin(T * .05)), cv.height);
    function col(c, m) { return 'rgb(' + c.map(function (v) { return Math.round(Math.min(1, v * m) * 255); }).join(',') + ')'; }
    g.addColorStop(0, col(pal[0], 1.4 * brightNow)); g.addColorStop(.6, col(pal[1], .35 * brightNow)); g.addColorStop(1, col(pal[2], .25 * brightNow));
    x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height);
  }
  // Live previews for the environment selector: each world renders into a small offscreen target in turn.
  function renderPreview(pv) {
    if (!gl || !pv || !pv.canvas) return;
    var w = pv.canvas.width, h = pv.canvas.height, i = IDS.indexOf(pv.id);
    if (!fbo) { fbo = gl.createFramebuffer(); fboTex = gl.createTexture(); fbo.w = 0; }
    if (fbo.w !== w || fbo.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, fboTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
      fbo.w = w; fbo.h = h; pv.px = new Uint8Array(w * h * 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    var colors = ENVIRONMENTS[i].palettes[S.palettes[pv.id]][1];
    if (drawEnv(i, w, h, colors, 0)) {
      if (!pv.px || pv.px.length !== w * h * 4) pv.px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pv.px);
      var ctx = pv.canvas.getContext('2d'), img = ctx.createImageData(w, h);
      for (var y = 0; y < h; y++) img.data.set(pv.px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      ctx.putImageData(img, 0, 0); pv.drawn = (pv.drawn || 0) + 1;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function start() { if (raf || document.hidden) return; lastT = 0; lastFrame = 0; raf = requestAnimationFrame(frame); }
  // The music meter is one shared listener. When the background pauses because Party Mode or an
  // experience (Liquid Dreams, Visuals) has opened over it, that screen is now using the meter, so
  // the background must hand it over rather than switch it off underneath them.
  function meterInUseElsewhere() {
    try {
      if (window.XP && XP.active) return true;
      var party = document.getElementById('party');
      return !!(party && !party.classList.contains('hidden'));
    } catch (e) { return false; }
  }
  function pause() {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (meterWanted) { meterWanted = false; if (!meterInUseElsewhere()) { try { if (A && A.partyMeter) A.partyMeter(false); } catch (e) {} } }
  }
  function select(id) {
    var i = IDS.indexOf(id); if (i < 0) return;
    S.env = id; save();
    if (i === envIndex) return;
    // capture the world on screen, then dissolve it away over the new one (no cut, no flash)
    if (gl && active && raf) {
      try {
        drawEnv(envIndex, cv.width, cv.height, pal, QUALITY[qualityName()].q);
        if (snapTex) gl.deleteTexture(snapTex);
        snapTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, snapTex);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, cv.width, cv.height, 0);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        fade = 0;
      } catch (e) { snapTex = null; fade = 1; }
    }
    envIndex = i;
    var target = ENVIRONMENTS[i].palettes[S.palettes[id]][1];
    for (var a = 0; a < 3; a++) pal[a] = target[a].slice();
    if (!snapTex && gl) releaseUnused();
  }
  window.NexusEnv = {
    ENVIRONMENTS: ENVIRONMENTS.map(function (e) { return { id: e.id, name: e.name, tagline: e.tagline, palettes: e.palettes.map(function (p) { return { name: p[0], colors: p[1] }; }) }; }),
    RANGES: RANGES,
    settings: function () { return JSON.parse(JSON.stringify(S)); },
    set: function (k, v) {
      if (k === 'env') return select(v);
      var next = JSON.parse(JSON.stringify(S));
      if (k === 'palette') next.palettes[S.env] = v; else next[k] = v;
      S = normalize(next); save();
      if (k === 'quality') { scale = 1; resize(); }
    },
    reset: function () { var env = S.env; S = normalize({ env: env }); save(); scale = 1; resize(); },
    select: select,
    setActive: function (on) { on = !!on; if (on === active) return; active = on; if (on) start(); else pause(); },
    setMode: function (m) { mode.intruder = !!(m && m.intruder); },
    attachPreviews: function (list) { previews = list || []; previewTurn = 0; lastPreview = 0; if (gl) previews.forEach(renderPreview); },
    detachPreviews: function () { previews = []; if (gl && !snapTex) releaseUnused(); },
    status: function () { return { active: active, running: !!raf, env: IDS[envIndex], gl: !!gl, scale: scale, quality: qualityName(), programs: Object.keys(programs).length, transitioning: !!snapTex, T: T, audio: { bass: aBass, mid: aMid, high: aHigh }, meter: meterWanted, width: cv ? cv.width : 0, height: cv ? cv.height : 0 }; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
