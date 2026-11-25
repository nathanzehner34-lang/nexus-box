/* NEXUS LIVE ENVIRONMENTS — the general interface background engine.
   Five GPU-rendered worlds (Aurora World, Neon Dimension, Cosmic Nebula, Abstract Infinity, Liquid Universe) share one WebGL
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
  // Five worlds, each built on its own technique: layered curtains over a mirror lake; a neon tunnel with a
  // glossy floor; double-warped gas clouds with stars and a galaxy; an endlessly zooming kaleidoscopic fractal;
  // folded liquid light with relief lighting and thin-film iridescence.
  var ENVIRONMENTS = [
    { id: 'aurora', name: 'Aurora World', tagline: 'Curtains of light over a mirror lake', src: "vec3 starsA(vec2 p,float sc,float t){vec2 sp=p*sc;vec2 id=floor(sp);vec2 h=hash2(id);\nfloat s=step(.9,h.x)*exp(-dot(fract(sp)-.5-.35*(h-.5),fract(sp)-.5-.35*(h-.5))*(70.+h.y*60.));\nreturn mix(vec3(.75,.85,1.),vec3(1.,.85,.95),h.y)*s*(.55+.45*sin(t*(.5+h.y*1.5)+h.x*40.));}\nvec3 curtain(vec2 p,float t,float seed,float depth,vec3 low,vec3 up,float q){\n float x=p.x/depth+seed;\n float fold=fbm(vec2(x*.9+t*.018,seed+t*.012),depth>1.5?2.:3.);\n float sway=.06*sin(x*2.1+t*.05+seed)+.04*sin(x*4.7-t*.07);\n float base=-.2+.36*fold+sway+(depth-1.)*.14;\n float d=p.y-base;\n if(d<-.05||d>.95)return vec3(0.);\n float H=.3+.3*noise(vec2(x*1.7,t*.03+seed));\n float edgeOn=1.+1.3*pow(abs(cos(x*2.1+t*.05+seed+fold*3.)),10.);\n float drape=smoothstep(.2,.55,noise(vec2(x*.75+t*.015,seed*2.)));\n if(drape<.01)return vec3(0.);\n float hem=smoothstep(-.035,.012,d)*exp(-max(d,0.)/H);\n float r1=noise(vec2(x*34.+fold*9.+t*.25,t*.11+seed));\n float r2=noise(vec2(x*83.-t*.18,seed*3.+t*.07));\n float rays=.35+.65*(r1*r1*.75+r2*r2*.5);\n if(q>.5)rays*=.8+.4*noise(vec2(x*190.+t*.2,d*3.));\n float glow=exp(-max(d,0.)*28.)*smoothstep(-.03,.0,d);\n float k=clamp(d/(H*1.6),0.,1.);\n vec3 c=mix(low,up*1.35,smoothstep(.08,.75,k));\n c=mix(c,vec3(.25,.55,1.),.25*smoothstep(.35,.7,k)*(1.-smoothstep(.7,1.,k)));\n float wave=.65+.35*sin(x*6.+t*.35+fold*8.);\n return c*(hem*rays*wave*edgeOn+glow*.8*wave)*drape*(1.25/depth);\n}\nfloat ridge(float x){float r=1.-abs(2.*noise(vec2(x*2.4,3.1))-1.);float r2=1.-abs(2.*noise(vec2(x*6.3,8.7))-1.);return -.27+.085*r*r+.025*r2*r2+.02*sin(x*1.3);}\nvec3 sky(vec2 p,float t,float q){\n vec3 col=mix(c1*2.2+vec3(.0,.02,.05)+c2*.05,c1*.6+c3*.035,smoothstep(-.25,.55,p.y));\n col+=c3*.07*smoothstep(.1,.6,p.y)*(.6+.4*sin(p.x*1.4+t*.03));\n col+=mix(c2,c3,.5)*.06*fbm(p*vec2(1.2,2.5)+vec2(t*.01,0.),3.);\n vec3 au=vec3(0.);\n au+=curtain(p,t*.8,7.3,1.9,c2*.8+vec3(.0,.08,.12),c3*.8,q)*.55;\n au+=curtain(p,t,1.7,1.35,mix(c2,vec3(.1,.95,.85),.35),c3,q)*.8;\n au+=curtain(p,t*1.15,4.1,1.,c2,mix(c3,vec3(1.,.4,.8),.3),q);\n col+=au;\n float veil=clamp(dot(au,vec3(.4)),0.,1.);\n col+=starsA(p+vec2(t*.002,0.),42.,t)*(1.-veil);\n col+=starsA(p+vec2(t*.001,9.),85.,t)*(1.-veil)*.55;\n col+=mix(c2,c3,.3+.3*sin(p.x+t*.04))*exp(-max(p.y+.24,0.)*7.)*.16;\n return col;\n}\nvec3 scene(vec2 uv){\n float t=T*(.85+.15*move);\n float shore=-.29;\n vec3 col;\n if(uv.y>shore){\n  col=sky(uv,t,quality);\n  float rg=ridge(uv.x);\n  float m=smoothstep(rg+.004,rg-.004,uv.y);\n  vec3 rock=c1*.5+vec3(.004,.008,.014)+c2*.025*(1.-smoothstep(rg-.08,rg,uv.y));\n  col=mix(col,rock,m);\n }else{\n  float dd=shore-uv.y;\n  vec2 rp=vec2(uv.x+.012*sin(uv.y*70.+t*1.1)*(.4+dd*3.)+.006*sin(uv.x*30.-t*.8),2.*shore-uv.y);\n  col=sky(rp,t,0.)*(.5-.25*smoothstep(0.,.3,dd));\n  float rg=ridge(rp.x);\n  col=mix(col,c1*.4,smoothstep(rg+.01,rg-.01,rp.y));\n  col+=vec3(.6,.8,1.)*pow(noise(vec2(uv.x*60.,uv.y*400.+t*.6)),12.)*.25*exp(-dd*4.);\n  col+=c1*.3;\n }\n for(int l=0;l<2;l++){float fl=float(l);float sc=10.+fl*9.;\n  vec2 sp=uv*sc+vec2(sin(t*.07+fl*2.)*.8,-t*(.12+.08*fl));vec2 id=floor(sp);vec2 f=fract(sp)-.5;vec2 h=hash2(id+fl*17.);\n  vec2 o=(h-.5)*.7;float pd=length(f-o);\n  col+=mix(c2,c3,h.x)*exp(-pd*pd*(140.+fl*120.))*step(.72,h.y)*(.18+.12*sin(t*.9+h.x*40.))*(1.-.4*fl);}\n return col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}\n",
      palettes: [["Polar Lights",[[0.006,0.012,0.04],[0.15,1,0.55],[0.85,0.3,1]]],["Arctic Blue",[[0.005,0.015,0.05],[0.1,0.85,1],[0.45,0.35,1]]],["Rose Borealis",[[0.02,0.008,0.04],[1,0.35,0.7],[0.35,0.95,0.8]]]] },
    { id: 'neon', name: 'Neon Dimension', tagline: 'Gliding through a tunnel of neon energy', src: "float ngon(vec2 p,float r,float n){float a=atan(p.x,p.y)+3.14159;float b=6.28319/n;return cos(floor(.5+a/b)*b-a)*length(p)-r;}\nvec3 neonCol(float k){\n vec3 uv_=mix(c2,c3,.5)*vec3(.8,.55,1.25);\n float f=fract(k);\n return f<.33?mix(c2,uv_,f*3.):f<.66?mix(uv_,c3,(f-.33)*3.):mix(c3,mix(c2,vec3(.4,1.,1.),.4),(f-.66)*3.);\n}\nvec3 walls(float u,float zz,float z,float side,float t,float soft){\n float w=(.022+.02*soft)*z;\n float ring=fract(zz);\n float rd=min(ring,1.-ring);\n float cid=floor(zz);\n vec3 rc=neonCol(cid*.13+side*.11+t*.01);\n float hr=hash1(vec2(cid,side));\n vec3 col=rc*(exp(-rd/w)*.9+exp(-rd/(w*4.))*.4)*(.55+.45*step(.3,hr));\n col+=mix(c2,c3,.5+.5*u)*.07*(.6+.4*sin(zz*.4+side));\n float lanes=7.;\n float lu=(u*.5+.5)*lanes;\n float li=floor(lu),lf=fract(lu);\n float ld=min(lf,1.-lf);\n col+=neonCol(li*.17+side*.3)*exp(-ld*lanes/(w*7.))*.32;\n if(quality>.5){float lf2=fract(lu*3.);col+=neonCol(li*.17+side*.3+.2)*exp(-min(lf2,1.-lf2)*lanes*3./(w*9.))*.1;}\n float hp=hash1(vec2(cid*1.7+li,side+3.));\n float lit=step(.6,hp);\n float pulseP=.5+.5*sin(t*(.6+hp*.8)+hp*30.);\n float edge=min(min(lf,1.-lf)*lanes/(w*60.),rd/(w*4.));\n col+=neonCol(hp+t*.02)*lit*(.05+.08*pulseP+.35*exp(-edge*2.5))*smoothstep(.0,.12,lf)*smoothstep(1.,.88,lf);\n float hs=hash1(vec2(li,side*7.+1.));\n if(hs>.4){\n  float sp=1.5+2.5*hs;\n  float ph=fract(zz*.12-t*sp*.06+hs*9.);\n  float tail=exp(-ph*9.)*step(0.,ph);\n  float across=exp(-abs(lf-.5)*lanes/(w*2.5));\n  col+=mix(neonCol(hs*2.+.3),vec3(1.),.4)*tail*across*2.;\n }\n return col;\n}\nvec3 forms(vec2 p,float t,float soft){\n vec3 col=vec3(0.);\n for(int i=0;i<5;i++){float fi=float(i);\n  float zi=mod(fi*2.2-t*.24,11.)+.35;\n  float sc=.55/zi;\n  vec2 q=rot(t*(.15+.05*fi)*(mod(fi,2.)<.5?1.:-1.)+fi)*p/sc;\n  float n=mod(fi,3.)<.5?3.:mod(fi,3.)<1.5?6.:4.;\n  float d=abs(ngon(q,.32+.04*sin(t*.5+fi),n))*sc;\n  float d2=abs(ngon(q,.2,n))*sc;\n  float fog=exp(-zi*.16)*smoothstep(.9,2.4,zi);\n  vec3 fc=neonCol(fi*.21+t*.015);\n  col+=fc*(exp(-d*(380./(1.+soft*3.)))*1.2+exp(-d*40.)*.18+exp(-d2*500.)*.5)*fog;\n }\n return col;\n}\nvec3 scene(vec2 uv){\n float t=T*(.8+.2*move);\n vec2 vp=vec2(.05*sin(t*.045),.025*sin(t*.033));\n vec2 p=rot(.04*sin(t*.03))*(uv-vp);\n float W=1.65;\n float ax=abs(p.x)/W,ay=abs(p.y);\n float m=max(max(ax,ay),.004);\n float z=.33/m;\n float zz=(z+t*.3)*1.05;\n float near=smoothstep(.3,1.15,z);\n bool floorPx=ay>ax&&p.y<0.;\n bool wallPx=ax>=ay;\n float u=wallPx?p.y/m:p.x/(m*W);\n float side=wallPx?(p.x>0.?1.:2.):(p.y>0.?3.:0.);\n float fog=exp(-z*.075);\n vec3 col=c1*.9;\n if(floorPx){\n  vec3 own=walls(u,zz,z,0.,t,0.)*.18;\n  float rip=.05*sin(zz*2.3-t*1.5)+.03*sin(u*11.+t*1.3);\n  vec3 mir=walls(u+rip,zz,z,3.,t,1.)*.8;\n  vec2 mp=vec2(p.x+rip*.05,-p.y);\n  mir+=forms(mp,t,1.)*.7;\n  float fres=.35+.65*smoothstep(.0,.6,ay);\n  col=c1*.5+(own+mir*fres)*fog*mix(.08,1.,near);\n  col+=neonCol(t*.01+.5)*exp(-abs(ax-ay)/(ay*.03+.002))*.25*fog;\n  col+=c1*.4*(1.-fog);\n }else{\n  col+=walls(u,zz,z,side,t,0.)*fog*(wallPx?.85:1.)*mix(.05,1.,near);\n }\n float r=length(p);\n vec3 core=mix(c3,c2,.5+.5*sin(t*.05));\n col+=core*(exp(-r*16.)*.55+exp(-r*4.)*.12);\n col+=forms(p,t,0.)*(floorPx?.6:1.);\n col+=mix(c2,c3,.5)*(.025+.02*quality)*fbm(uv*2.+vec2(t*.03,0.),2.+quality);\n return col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}\n",
      palettes: [["Electric",[[0.01,0.006,0.03],[0.15,0.55,1],[1,0.25,0.85]]],["Ultraviolet",[[0.012,0.005,0.035],[0.55,0.25,1],[0.2,0.9,1]]],["Cyber Pink",[[0.02,0.005,0.025],[1,0.25,0.6],[0.3,0.6,1]]]] },
    { id: 'nebula', name: 'Cosmic Nebula', tagline: 'Vast glowing clouds among the stars', src: "vec3 starField(vec2 p,float sc,float t,float bright){\n vec2 sp=p*sc;vec2 id=floor(sp);vec2 h=hash2(id);vec2 f=fract(sp)-.5-(h-.5)*.7;\n float s=step(.82,h.x)*exp(-dot(f,f)*(90.+h.y*120.));\n vec3 c=mix(vec3(.7,.8,1.),vec3(1.,.82,.75),h.y);\n return c*s*bright*(.6+.4*sin(t*(.4+h.y)+h.x*50.));\n}\nvec3 bigStar(vec2 p,vec2 c,float s,vec3 col){\n vec2 d=p-c;float r=length(d);\n float core=exp(-r*r/(s*s*.02));\n float spikes=(exp(-abs(d.x)/(s*.012))*exp(-abs(d.y)/(s*.55))+exp(-abs(d.y)/(s*.012))*exp(-abs(d.x)/(s*.55)))*.5;\n return col*(core*1.6+spikes*.6+exp(-r/(s*.18))*.12);\n}\nvec3 galaxy(vec2 p,float t){\n p=rot(-.5)*p;p.y*=2.4;p*=.6;\n float r=length(p);if(r>.16)return vec3(0.);\n float a=atan(p.y,p.x);\n float arms=.5+.5*cos(2.*a-log(r+.002)*5.5+t*.04);\n float disc=exp(-r*26.);\n return (mix(c2,vec3(1.,.9,.8),.5)*disc*(.35+.65*pow(arms,3.))+vec3(1.,.92,.8)*exp(-r*r*3000.)*.9)*.55;\n}\nvec3 gas(vec2 p,float t,float oct,float seed){\n vec2 q=vec2(fbm(p+vec2(seed,t*.012),oct),fbm(p+vec2(5.2+seed,1.3-t*.01),oct));\n vec2 r=vec2(fbm(p+3.2*q+vec2(1.7,9.2)+t*.007,oct),fbm(p+3.2*q+vec2(8.3,2.8)-t*.006,oct));\n float f=fbm(p+2.6*r,oct);\n float dens=smoothstep(.3,.92,f);\n float dust=smoothstep(.5,.85,noise(p*3.+r*3.)*.6+noise(p*7.-q*2.)*.4);\n float zone=smoothstep(.25,.75,q.x+.25*sin(p.y*1.3+t*.01));\n vec3 col=mix(c2*1.1,c3,zone);\n col=mix(col,vec3(.15,.85,.9),smoothstep(.62,.8,r.y)*(1.-zone)*.55);\n col=mix(col,mix(c3,vec3(1.,.6,.35),.6),smoothstep(.8,1.,f)*.7);\n col*=dens*(1.-.7*dust);\n col+=mix(c2,c3,zone)*pow(dens,3.)*.9;\n return col;\n}\nvec3 gasFar(vec2 p,float t,float oct){\n vec2 q=vec2(fbm(p+vec2(0.,t*.008),oct),fbm(p+vec2(5.2,1.3),oct));\n float f=fbm(p+2.5*q,oct);\n return mix(c3*.8,c2,smoothstep(.3,.7,q.y))*smoothstep(.3,.95,f)*.8;\n}\nvec3 scene(vec2 uv){\n float t=T*(.8+.2*move);\n vec2 cam=vec2(t*.006,.002*t)+.03*vec2(sin(t*.02),cos(t*.017));\n vec2 p=rot(t*.004)*uv;\n vec3 col=c1*.7+mix(c2,c3,.5)*.025;\n col+=starField(p*.9+cam*.3,70.,t,.55);\n col+=starField(p+cam*.5,140.,t,.35)*(.5+.5*quality);\n col+=galaxy(p-vec2(-.55,.28)+cam*.4,t);\n col+=gasFar(p*1.3+cam*.6,t,2.+quality)*.95;\n vec3 near=gas(p*.8+cam+vec2(3.,1.),t*1.2,3.+quality,7.3);\n col=col*(1.-clamp(dot(near,vec3(.25)),0.,.6))+near*1.45;\n col+=starField(p*1.1+cam*1.1,26.,t,1.1);\n col+=bigStar(p+cam*1.1,vec2(.42,-.18),.4,vec3(.85,.9,1.));\n col+=bigStar(p+cam*1.1,vec2(-.2,.33),.25,vec3(1.,.85,.95));\n col+=bigStar(p+cam*1.1,vec2(.75,.3),.18,vec3(.8,.9,1.));\n return col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}\n",
      palettes: [["Violet Deep",[[0.008,0.006,0.03],[0.35,0.3,1],[1,0.25,0.7]]],["Blue Giant",[[0.005,0.008,0.03],[0.2,0.5,1],[0.75,0.35,1]]],["Crimson Cloud",[[0.012,0.005,0.025],[0.55,0.25,0.9],[1,0.3,0.45]]]] },
    { id: 'infinity', name: 'Abstract Infinity', tagline: 'An endless dive into a living fractal', src: "vec3 spec(float x){vec3 s=clamp(abs(fract(x+vec3(0.,.6667,.3333))*6.-3.)-1.,0.,1.);return s*s*1.1;}\nvec3 hue(float x){vec3 s=spec(x);vec3 pc=mix(c2,c3,abs(fract(x)-.5)*2.);return mix(pc*1.2,s,.5);}\nvec3 layer(vec2 p,float sc,float t,float n,float seed){\n p*=sc;\n float a=atan(p.y,p.x),r=length(p);\n float k=1.0472;\n a=abs(mod(a+t*.02+seed,k)-k*.5);\n p=vec2(cos(a),sin(a))*r;\n vec2 c=vec2(.92+.08*sin(t*.07+seed),.52+.1*cos(t*.053+seed*2.));\n vec3 col=vec3(0.);\n float fall=1.,acc=0.;\n mat2 R=rot(.17+.05*sin(t*.03));\n for(int i=0;i<10;i++){float fi=float(i);if(fi>=n)break;\n  p=abs(p)/dot(p,p)-c;\n  p=R*p;\n  float d=min(abs(p.x),abs(p.y));\n  float rr=abs(length(p)-.62);\n  vec3 hc=hue(fi*.085+t*.011+seed);\n  col+=hc*(exp(-d*55.)*1.15+exp(-d*9.)*.07)*fall;\n  col+=mix(hc.zxy,vec3(1.),.15)*exp(-rr*30.)*.5*fall;\n  acc+=exp(-dot(p,p)*4.)*fall;\n  fall*=.8;\n }\n col+=hue(acc*.2+.2+t*.01)*acc*.05;\n return col;\n}\nvec3 scene(vec2 uv){\n float t=T*(.85+.15*move);\n vec2 p=rot(t*.015)*uv;\n p+=.03*vec2(sin(t*.05),cos(t*.04));\n float cyc=fract(t*.025);\n float s0=exp2(cyc);\n float n=7.+2.*quality;\n vec3 a=layer(p,.9/s0,t,n,0.);\n vec3 b=layer(p,.9/(s0*2.),t,n,0.);\n float w=smoothstep(0.,1.,cyc);\n vec3 col=mix(a,b,w);\n float r=length(uv);\n col*=.6+.55*exp(-r*1.6);\n col+=hue(t*.02)*exp(-r*5.)*.12;\n col+=c1*.6;\n return col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}\n",
      palettes: [["Spectrum",[[0.01,0.005,0.03],[0.25,0.5,1],[1,0.3,0.75]]],["Emerald Flux",[[0.005,0.015,0.025],[0.15,0.95,0.7],[0.6,0.35,1]]],["Solar Prism",[[0.015,0.008,0.02],[1,0.5,0.25],[0.85,0.25,1]]]] },
    { id: 'liquid', name: 'Liquid Universe', tagline: 'Rivers of liquid light merging and parting', src: "vec3 film(float x){return .5+.5*cos(6.2832*(x+vec3(0.,.33,.67)));}\nvec3 scene(vec2 uv){\n float t=T*(.75+.25*move);\n vec2 p=uv*1.35+vec2(t*.01,0.);\n float oct=3.+quality;\n vec2 q=vec2(fbm(p+vec2(0.,t*.05),oct),fbm(p+vec2(5.2,1.3)-vec2(t*.04,0.),oct));\n vec2 r=vec2(fbm(p+3.4*q+vec2(1.7,9.2)+vec2(t*.03,0.),oct),fbm(p+3.4*q+vec2(8.3,2.8)-vec2(0.,t*.035),oct));\n float f=fbm(p+3.*r,oct);\n float mixA=smoothstep(.25,.75,r.x);\n float mixB=smoothstep(.35,.85,q.y);\n vec3 col=mix(c2,c3,mixA);\n col=mix(col,vec3(.1,.85,.85),mixB*(1.-mixA)*.55);\n col=mix(col,mix(c3,vec3(1.,.55,.9),.4),smoothstep(.6,.9,f)*.4);\n float band=.5+.5*sin(f*15.+(r.x-r.y)*9.+t*.22);\n float crest=pow(band,7.);\n col*=1.25*(.18+1.1*smoothstep(.2,.85,f))*(.55+.6*band);\n vec2 g=(r-.5)*4.+(q-.5)*1.2+vec2(cos(f*15.),sin(f*15.))*band*.15;\n vec3 n=normalize(vec3(-g,1.));\n vec3 L=normalize(vec3(.45,.65,.6));\n float dif=max(dot(n,L),0.);\n float spec=pow(max(dot(reflect(-L,n),vec3(0.,0.,1.)),0.),40.);\n float rim=pow(1.-n.z,2.);\n col*=.4+.8*dif;\n vec3 sheen=film(f*2.6+dot(g,vec2(.3,.2))+t*.03);\n col+=sheen*(crest*.45+rim*.4)*(.5+.5*f);\n col+=mix(vec3(1.),sheen,.3)*spec*1.1;\n float seam=exp(-abs(r.x-.5)*26.)*.55+exp(-abs(q.y-.6)*34.)*.3;\n col+=mix(c2,c3,.5+.5*sin(t*.05+f*4.))*seam*(.3+.7*f)*1.2;\n col=mix(c1*.8,col,smoothstep(.05,.45,f+.15));\n return col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}\n",
      palettes: [["Cosmic Ink",[[0.015,0.008,0.04],[0.4,0.3,1],[1,0.35,0.75]]],["Lagoon",[[0.005,0.015,0.035],[0.15,0.8,0.95],[0.55,0.35,1]]],["Rose Mercury",[[0.02,0.008,0.03],[1,0.4,0.75],[0.35,0.6,1]]]] }
  ];
  var IDS = ENVIRONMENTS.map(function (e) { return e.id; });
  var QUALITY = { smooth: { scale: .42, fps: 24, q: 0 }, balanced: { scale: .6, fps: 30, q: 1 }, high: { scale: .82, fps: 30, q: 1 } };
  var RANGES = { speed: [.25, 2], movement: [0, 2], brightness: [.5, 1.5], colorSpeed: [.25, 3], sensitivity: [0, 2] };
  var DEFAULTS = { env: 'aurora', cycle: 0, palettes: { aurora: 0, neon: 0, nebula: 0, infinity: 0, liquid: 0 }, speed: 1, movement: 1, brightness: 1, colorSpeed: 1, reducedMotion: false, quality: 'auto', audio: true, sensitivity: 1 };

  function normalize(v) {
    var s = JSON.parse(JSON.stringify(DEFAULTS)), src = v && typeof v === 'object' ? v : {};
    // worlds retired from earlier builds open their closest successor instead of the default
    var LEGACY = { prism: 'infinity', energy: 'neon', neural: 'neon', abyss: 'liquid', chrome: 'liquid', deepflow: 'liquid', iridescence: 'liquid', cosmic: 'nebula' };
    if (IDS.indexOf(src.env) >= 0) s.env = src.env; else if (LEGACY[src.env]) s.env = LEGACY[src.env];
    if (src.palettes && typeof src.palettes === 'object') IDS.forEach(function (id) { var n = Math.round(Number(src.palettes[id])); if (n >= 0 && n < 3) s.palettes[id] = n; });
    Object.keys(RANGES).forEach(function (k) { var n = Number(src[k]); if (isFinite(n)) s[k] = Math.max(RANGES[k][0], Math.min(RANGES[k][1], n)); });
    s.reducedMotion = src.reducedMotion === true;
    if ([0, 1, 3, 5, 10].indexOf(Number(src.cycle)) >= 0) s.cycle = Number(src.cycle);
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
  var previews = [], previewTurn = 0, lastPreview = 0, meterWanted = false, cycleMs = 0;

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
    // automatic cycling: every few minutes on screen, dissolve into the next world (and remember it)
    if (S.cycle > 0 && !snapTex) { cycleMs += dt; if (cycleMs >= S.cycle * 60000) { cycleMs = 0; select(IDS[(envIndex + 1) % IDS.length]); } } else if (!S.cycle) cycleMs = 0;
    var target = ENVIRONMENTS[envIndex].palettes[S.palettes[IDS[envIndex]]][1], k = 1 - Math.exp(-dt / (3200 / S.colorSpeed * (low ? 1.5 : 1)));
    for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) pal[a][b] += (target[a][b] - pal[a][b]) * k;
    if (!gl) { drawFallback(); return; }
    gl.disable(gl.BLEND);
    drawEnv(envIndex, cv.width, cv.height, pal, q.q);
    if (snapTex && fade < 1) {
      fade = Math.min(1, fade + dt / (low ? 3200 : 2300));
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
    S.env = id; save(); cycleMs = 0;
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
    // the next (or previous) world, with the same dissolve
    next: function (dir) { select(IDS[(envIndex + (dir < 0 ? IDS.length - 1 : 1)) % IDS.length]); return IDS[envIndex]; },
    setActive: function (on) { on = !!on; if (on === active) return; active = on; if (on) start(); else pause(); },
    setMode: function (m) { mode.intruder = !!(m && m.intruder); },
    attachPreviews: function (list) { previews = list || []; previewTurn = 0; lastPreview = 0; if (gl) previews.forEach(renderPreview); },
    detachPreviews: function () { previews = []; if (gl && !snapTex) releaseUnused(); },
    status: function () { return { active: active, running: !!raf, env: IDS[envIndex], gl: !!gl, scale: scale, quality: qualityName(), programs: Object.keys(programs).length, transitioning: !!snapTex, T: T, audio: { bass: aBass, mid: aMid, high: aHigh }, meter: meterWanted, width: cv ? cv.width : 0, height: cv ? cv.height : 0 }; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
