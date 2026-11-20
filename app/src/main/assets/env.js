/* NEXUS LIVE ENVIRONMENTS — the general interface background engine.
   Five GPU-rendered worlds (Deep Flow, Liquid Chrome, Iridescence, Cosmic, Aurora) share one WebGL
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
    { id: 'deepflow', name: 'Deep Flow', tagline: 'A sunken temple beneath drifting light', src: "float ruinsD(vec2 p){\nfloat d=sdBox(p-vec2(0.,-.075),vec2(.4,.025));\nd=min(d,sdBox(p-vec2(0.,-.045),vec2(.37,.012)));\nd=min(d,sdBox(p-vec2(0.,.19),vec2(.36,.03)));\nvec2 q=p;q.x=mod(q.x+.33,.132)-.066;\nif(abs(p.x)<.34)d=min(d,sdBox(q-vec2(0.,.07),vec2(.024,.11)));\nd=min(d,sdBox(p-vec2(0.,.235),vec2(.3,.016)));\nd=min(d,sdBox(p-vec2(0.,.3),vec2(.24,.05)));\nvec2 a=p-vec2(0.,.28);a.x=mod(a.x+.24,.12)-.06;\nif(abs(p.x)<.24)d=max(d,-(length(a-vec2(0.,-.02))-.035));\nd=min(d,max(abs(p.x)*.62+(p.y-.47),-(p.y-.35)));\nd+=.004*(noise(p*40.)-.5);\nd=max(d,-(length(p-vec2(.3,.33))-.11));\nreturn d;\n}\nfloat seabed(float x,float t){return -.34+.06*sin(x*2.1+.5)+.05*fbm(vec2(x*2.6,1.),3.);}\nvec3 jelly(vec2 p,float r,float ph,float t,vec3 col){\nfloat pulse=1.+.07*sin(t*1.6+ph);\nvec2 q=p/vec2(r*pulse,r*.72/pulse);\nfloat bellD=length(q);\nfloat bell=smoothstep(1.,.86,bellD)*step(-.15,q.y);\nfloat rim=smoothstep(.72,.98,bellD)*bell;\nvec3 c=col*(bell*.55+rim*1.1)+vec3(1.)*exp(-dot(q-vec2(-.2,.35),q-vec2(-.2,.35))*7.)*bell*.5;\nfloat ten=0.;\nfor(int i=0;i<5;i++){float fi=float(i);float x0=(fi-2.)*.28*r;float yy=-p.y/r;\nfloat sway=sin(yy*3.+t*1.3+ph+fi)*.12*r*yy;\nten+=exp(-abs(p.x-x0-sway)/(.025*r))*smoothstep(2.6,0.,yy)*step(0.,yy);}\nc+=col*ten*.35;\nc+=col*exp(-length(q)*1.3)*.35;\nreturn c;\n}\nvec3 scene(vec2 uv){\nfloat t=T;\nvec2 w=uv+(.004+.004*move)*vec2(sin(uv.y*13.+t*.8)+.5*sin(uv.x*7.-t*.5),cos(uv.x*11.-t*.7));\nfloat y=w.y;\nvec3 col=mix(c1*.1,c2*.6,pow(smoothstep(-.55,.62,y),1.6));\ncol+=c2*.3*exp(-length(w-vec2(-.05,.55))*2.);\nvec2 cp=w*vec2(4.,9.)+vec2(t*.12,t*.05);\nfloat ca=0.;for(int i=0;i<3;i++){float fi=float(i);ca+=abs(sin(cp.x+sin(cp.y*1.3+t*.6+fi)*1.2+fi*2.1+t*.3*(fi+1.)));cp=rot(.9)*cp*1.25;}\nca=pow(1.-ca/3.,3.)*3.;\ncol+=mix(c2,vec3(1.),.5)*ca*smoothstep(.28,.5,y)*.55;\nfloat rays=0.;\nfor(int i=0;i<4;i++){float fi=float(i);float xr=w.x+(y-.5)*(.28+fi*.07);\nrays+=pow(.5+.5*sin(xr*(4.+fi*2.7)+t*(.07+fi*.03)+fi*2.3),10.)*(.5+.5*noise(vec2(xr*4.,t*.15+fi)));}\ncol+=mix(c2,vec3(.85,1.,1.),.4)*rays*smoothstep(-.45,.5,y)*.32*(1.+bass*.4);\nfloat hill=-.18+.08*fbm(vec2(w.x*1.4+t*.004,4.),3.);\ncol=mix(col,c1*.35+c2*.12,smoothstep(.004,-.004,y-hill)*.55);\nvec2 rp=(w-vec2(.42+.015*sin(t*.03),-.08))*1.35;\nfloat rd=ruinsD(rp);\nfloat ruin=smoothstep(.006,-.004,rd);\nvec3 stone=mix(c1*.12,c1*.3+c2*.22,smoothstep(-.1,.5,rp.y));\nstone+=c2*.35*smoothstep(.015,0.,abs(rd+.008))*smoothstep(-.1,.3,rp.y);\nstone+=c3*.25*step(.8,hash1(floor(rp*30.)))*smoothstep(.0,-.02,rd)*smoothstep(.0,.15,-rp.y+.05);\nstone+=mix(c2,vec3(1.),.3)*ca*.18;\ncol=mix(col,stone,ruin*.88);\nfloat falls=0.;\nfor(int i=0;i<3;i++){float fi=float(i);float x0=-.198+fi*.132+.066;\nfloat m=exp(-pow((rp.x-x0)/.02,2.))*step(-.03,rp.y)*step(rp.y,.17);\nfalls+=m*(.5+.5*noise(vec2(rp.x*90.,rp.y*7.+t*2.6+fi*3.)));}\nfalls+=exp(-pow((rp.x-.04)/.015,2.))*step(.2,rp.y)*step(rp.y,.29)*(.5+.5*noise(vec2(rp.x*90.,rp.y*7.+t*2.4)));\ncol+=mix(c2,vec3(1.),.6)*falls*.9;\ncol+=c2*exp(-abs(rp.y+.09)*20.)*smoothstep(.45,0.,abs(rp.x))*.35;\nfloat sb=seabed(w.x,t);\nfloat ground=smoothstep(.006,-.006,y-sb);\nfloat rockL=smoothstep(.01,-.01,length((w-vec2(-.78,-.42))*vec2(1.,.8))-(.26+.05*fbm(w*6.,3.)));\nfloat rock=max(ground,rockL);\nvec3 rockCol=c1*.12+c2*.08*fbm(w*9.,3.);\nrockCol+=mix(c2,vec3(1.),.4)*ca*.3*smoothstep(-.06,0.,y-sb);\ncol=mix(col,rockCol,rock);\nvec2 gp=w*vec2(26.,26.);vec2 gid=floor(gp);vec2 gh=hash2(gid);\nfloat coral=step(.82,gh.x)*smoothstep(.06,.0,abs(w.y-sb-.015))*exp(-length(fract(gp)-.5-(gh-.5)*.4)*12.);\ncoral+=rockL*step(.9,gh.y)*exp(-length(fract(gp)-.5)*14.)*.6;\ncol+=mix(c3,c2,gh.y)*coral*(.8+.6*sin(t*1.7+gh.y*30.)+high*.8);\nfor(int i=0;i<7;i++){float fi=float(i);vec2 h=hash2(vec2(fi,3.1));\nfloat x0=-.85+fi*.27+h.x*.12;float base=seabed(x0,t);float hgt=.12+.14*h.y;\nfloat yy=(w.y-base)/hgt;\nfloat sway=(.03+.02*move)*yy*yy*sin(t*.7+fi*1.9+yy*2.)+.01*bass*yy;\nfloat fr=exp(-abs(w.x-x0-sway)/(.004+.006*clamp(1.-yy,0.,1.)))*step(0.,yy)*smoothstep(1.,.6,yy);\ncol+=mix(c3,c2,h.x)*fr*(.55+.35*sin(t+fi))*(1.-rockL*.5);\ncol+=mix(c3,c2,h.x)*exp(-length(vec2(w.x-x0-sway,(w.y-base-hgt)*1.))*40.)*.6;}\nfloat nj=3.+quality;\nfor(int i=0;i<4;i++){float fi=float(i);if(fi>=nj)break;\nvec2 h=hash2(vec2(fi,7.3));\nfloat jy=fract(h.y-t*(.008+.004*h.x))*1.45-.62;\nvec2 jc=vec2(-.72+h.x*1.1+.05*sin(t*.11+fi*2.),jy);\nfloat r=.06+.05*h.y;\ncol+=jelly(w-jc,r,fi*1.7,t,mix(c3,c2,step(.5,h.x)*.55));}\nfor(int L=0;L<2;L++){float fl=float(L);\nvec2 bp=w*vec2(9.-fl*3.,5.-fl*2.)+vec2(fl*4.,-t*(.35+fl*.25));\nvec2 bid=floor(bp);vec2 bh=hash2(bid+fl*13.);\nvec2 bf=fract(bp)-.5-vec2((bh.x-.5)*.5+.08*sin(t*1.5+bh.y*20.),0.);\nfloat br=.05+.06*bh.y+fl*.05;\nfloat bd=length(bf);\nfloat on=step(.86,bh.x);\nfloat ring=smoothstep(br,br-.02,bd)-smoothstep(br-.03,br-.06,bd);\nfloat spec=exp(-length(bf-vec2(-.35,.35)*br)*60.);\ncol+=on*(mix(c2,vec3(1.),.5)*ring*.3+vec3(1.)*spec*.6)*(.5+fl*.4);}\nvec2 sp=w*14.+vec2(t*.05,t*.12);vec2 sid=floor(sp);vec2 sh=hash2(sid);\ncol+=c2*step(.88-detail*.05,sh.x)*exp(-length(fract(sp)-.5-(sh-.5)*.6)*30.)*.5;\ncol*=mix(.55,1.,smoothstep(-.6,.1,y));\nreturn col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}",
      palettes: [['Abyss', [[.02,.06,.22],[.1,.62,.95],[.85,.35,1]]], ['Lagoon', [[0,.1,.16],[.12,.85,.8],[.3,1,.75]]], ['Midnight', [[.03,.03,.18],[.35,.45,1],[1,.3,.7]]]] },
    { id: 'chrome', name: 'Liquid Chrome', tagline: 'A monumental liquid-metal installation', src: "vec3 envLight(vec3 r,float t){\nfloat y=r.y+.08*r.x;\nvec3 silver=vec3(.62,.65,.72);\nvec3 c=mix(vec3(.015,.016,.024),silver*.55,smoothstep(-.7,.35,y));\nc=mix(c,vec3(.92,.94,1.),smoothstep(.02,.07,y)*smoothstep(.75,.3,y));\nc*=.75+.25*sin(r.x*3.+t*.05);\nc+=vec3(1.)*smoothstep(.09,.03,abs(r.x+.28+.15*sin(t*.07)))*smoothstep(.15,.3,y)*1.2;\nc+=c2*1.1*exp(-pow((r.x-.55+.1*sin(t*.05))*9.,2.))*smoothstep(-.3,.2,y);\nc+=c1*1.3*exp(-pow((y+.2)*9.,2.))*smoothstep(-.9,.1,r.x);\nc+=c3*.7*exp(-pow((r.x+.7)*8.,2.))*smoothstep(-.4,0.,y)*smoothstep(.4,.0,y);\nfloat sweep=fract(t*.03);\nc+=vec3(1.)*exp(-pow((r.x+r.y*.5-(sweep*3.4-1.7))*9.,2.))*.7;\nreturn c;\n}\nfloat folds(vec2 p,float t){\nvec2 c=vec2(-.18,.06);vec2 q=p-c;\nfloat r=length(q),a=atan(q.y,q.x);\nfloat z=.32/(r+.05);\nfloat tw=a+z*.55+t*.06;\nfloat tun=sin(tw*3.+z*1.7-t*.42)*.5+.5*sin(tw*5.-z*2.3+t*.31+sin(z*.6-t*.2)*1.4)*.35;\nvec2 o=p*1.1;o+=(.35+.25*move)*vec2(sin(o.y*1.3+t*.13),cos(o.x*1.1-t*.11));\nfloat sheet=.55*sin(o.x*1.7+t*.1)*cos(o.y*2.1-t*.09)+.3*sin((o.x+o.y)*2.6+t*.14);\nfloat w=smoothstep(.95,.25,r);\nsheet+=quality*.07*sin(o.x*5.3+o.y*3.1+t*.17)*sin(o.y*4.1-t*.13);\nreturn mix(sheet,tun*.8,w)*(1.+bass*.25);\n}\nvec3 chromeAt(vec2 p,float t){\nfloat e=.006,h=folds(p,t),hx=folds(p+vec2(e,0.),t),hy=folds(p+vec2(0.,e),t);\nvec2 g=vec2(hx-h,hy-h)/e;\ng+=high*.08*vec2(sin(p.x*45.+t*2.),sin(p.y*41.-t*1.7));\nvec3 n=normalize(vec3(-g*.28,1.));\nvec3 r=reflect(vec3(0.,0.,-1.),n);\nvec3 col=envLight(r,t)*(.45+.55*smoothstep(-1.,.6,h));\nvec2 q=p-vec2(-.18,.06);float rr=length(q);\ncol*=smoothstep(.0,.16,rr)*.85+.15;\ncol+=mix(c2,vec3(1.),.4)*exp(-rr*16.)*.9;\ncol+=vec3(1.)*pow(max(dot(n,normalize(vec3(-.3,.5,.8))),0.),160.)*.8;\nreturn col;\n}\nvec3 sphere(vec2 p,vec2 s,float R,float t,inout float hit){\nvec2 d=(p-s)/R;float l2=dot(d,d);\nif(l2>1.){hit=0.;return vec3(0.);}\nhit=1.;\nvec3 n=vec3(d,sqrt(1.-l2));\nn.xy=rot(t*.05)*n.xy;\nvec3 r=reflect(vec3(0.,0.,-1.),n);\nvec3 c=envLight(r,t);\nc=mix(c,chromeAt(s+n.xy*R*2.6,t),.55*smoothstep(-.3,.4,n.y+.2));\nc*=.35+.65*pow(1.-n.z,.4);\nc+=vec3(1.)*pow(max(dot(n,normalize(vec3(-.45,.55,.7))),0.),90.)*1.2;\nc*=smoothstep(1.,.92,sqrt(l2))*.35+.65;\nreturn c;\n}\nvec3 world(vec2 p,float t){\nvec3 col=chromeAt(p,t);\nfloat hit=0.;\nvec2 s=vec2(.48+.04*sin(t*.045),-.13+.012*sin(t*.33));\nvec3 sc=sphere(p,s,.15,t,hit);\ncol=mix(col,sc,hit);\nvec2 s2=vec2(-.62+.05*sin(t*.03+2.),.22+.03*sin(t*.07));\nfloat hit2=0.;vec3 sc2=sphere(p,s2,.06,t+3.,hit2);\ncol=mix(col,sc2,hit2);\nreturn col;\n}\nvec3 scene(vec2 uv){\nfloat t=T;\nfloat hz=-.28;\nif(uv.y>hz)return world(uv,t);\nfloat dy=hz-uv.y;\nvec2 m=vec2(uv.x+.006*sin(uv.y*60.+t*1.3)*(1.+bass)+.004*sin(uv.x*30.-t),hz+dy*1.1);\nvec3 refl=world(m,t)*(.5-dy*.9);\nvec3 floorC=c1*.04;\nfloat spec=exp(-pow((uv.x-.48)*5.,2.))*smoothstep(.0,.2,dy)*.2;\nvec3 col=floorC+refl*mix(vec3(1.),c1+.4,.2)+c2*spec;\ncol*=1.-smoothstep(.0,.25,dy)*.35;\nfloat sh=exp(-length((uv-vec2(.48+.04*sin(t*.045),hz))*vec2(1.,6.))*12.);\ncol*=1.-sh*.5;\nreturn col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}",
      palettes: [['Violet', [[.05,.03,.12],[.55,.3,1],[.2,.75,1]]], ['Cyan', [[.02,.05,.1],[.2,.8,1],[.95,.3,.8]]], ['Pure Silver', [[.04,.04,.05],[.75,.78,.85],[.45,.55,1]]]] },
    { id: 'iridescence', name: 'Iridescence', tagline: 'Monumental crystal and refracted light', src: "vec3 spectrum(float x){return .5+.5*cos(6.2832*(x+vec3(0.,.33,.67)));}\nvec3 sky(vec2 p,float t){\nvec3 c=mix(c1*1.1+c3*.15,c1*.25,smoothstep(-.2,.6,p.y));\nc+=c3*.35*exp(-length((p-vec2(.1,-.12))*vec2(.6,2.2))*2.2);\nc+=c2*.25*fbm(p*2.5+vec2(t*.01,0.),3.)*smoothstep(-.1,.5,p.y);\nvec2 sp=p*38.;vec2 id=floor(sp);vec2 h=hash2(id);\nc+=vec3(.9,.92,1.)*step(.94,h.x)*exp(-length(fract(sp)-.5-(h-.5)*.6)*22.)*(.6+.4*sin(t*1.5+h.y*40.));\nreturn c;\n}\nvec4 crystal(vec2 p,vec2 base,float hgt,float wid,float tilt,float seed,float t,inout float glow){\nvec2 q=rot(tilt+.035*move*sin(t*.11+seed*6.))*(p-base);\nfloat tip=wid*1.7;\nfloat body=max(abs(q.x)-wid,max(-q.y,q.y-(hgt-tip)));\nfloat pnt=max((abs(q.x)/wid+(q.y-(hgt-tip))/tip-1.)*wid*.8,-(q.y-(hgt-tip)));\nfloat d=min(body,pnt);\nglow+=exp(-max(d,0.)*28./(.6+hgt))*smoothstep(-.02,.1,q.y)*(.5+.5*hgt);\nif(d>0.)return vec4(0.);\nfloat spin=t*.06*(seed>.5?1.:-1.)+seed*6.;\nfloat u=q.x/wid,vy=q.y/hgt;\nfloat fpos=(u+1.)*1.5+.45*sin(spin);\nfloat face=floor(fpos),onTip=step(hgt-tip,q.y);\nfloat ang=(face+onTip*3.)*1.15+spin;\nvec3 n=normalize(vec3(sin(ang),onTip*.7+.2*(vy-.5),cos(ang)+.5));\nfloat fres=pow(1.-abs(n.z),1.5);\nfloat edge=smoothstep(.1,.0,.5-abs(fract(fpos)-.5))+smoothstep(.05,0.,abs(q.y-(hgt-tip)))*.8+smoothstep(.08,0.,1.-abs(u))*.7;\nfloat band=exp(-pow((q.y-mod(t*.05*hgt+seed*hgt,hgt*1.3))/(hgt*.07),2.));\nfloat core=exp(-u*u*3.)*(.4+.6*vy);\nvec3 c=mix(mix(c2,c3,.5+.5*sin(ang+vy*2.)),spectrum(fres*1.3+vy*1.5+t*.015+seed),.4);\nc*=.3+fres*.7+core*.9;\nc+=mix(c2,vec3(1.),.6)*core*.45*(.8+.4*high);\nc+=vec3(1.)*edge*.6+vec3(1.)*band*.7;\nc+=vec3(1.)*pow(max(0.,dot(n,normalize(vec3(-.5,.6,.6)))),24.);\nreturn vec4(c,.82);\n}\nvec3 orb(vec2 p,vec2 s,float R,float t,inout float a){\nvec2 d=(p-s)/R;float l2=dot(d,d);if(l2>1.){a=0.;return vec3(0.);}\nvec3 n=vec3(d,sqrt(1.-l2));float fres=pow(1.-n.z,1.6);\nvec3 film=spectrum(fres*1.4+n.x*.4+t*.02);\na=.25+fres*.75;\nreturn film*fres*1.4+vec3(1.)*pow(max(0.,dot(n,normalize(vec3(-.5,.6,.65)))),60.)*1.5;\n}\nvec3 world(vec2 p,float t){\nvec3 col=sky(p,t);\nfloat hz=-.2,glow=0.;\nfor(int i=0;i<11;i++){\nfloat fi=float(i);if(fi>=7.+quality*4.)break;\nvec2 h=hash2(vec2(fi*1.37,4.1));\nfloat depth=fi/10.;\nfloat cluster=floor(h.x*3.);\nfloat x=(cluster-1.)*.62+(h.y-.5)*.3+.025*sin(t*.02+fi);\nfloat hgt=(.16+.42*h.y)*(.55+depth*.75);\nfloat wid=(.03+.035*fract(h.x*7.))*(.6+depth*.8);\nfloat tilt=(x-(cluster-1.)*.62)*1.4+(h.y-.5)*.3;\nvec4 c=crystal(p,vec2(x,hz-.02),hgt,wid,tilt,h.y,t,glow);\nvec3 behind=sky(p+vec2(.04,.02),t);\ncol=mix(col,c.rgb+behind*.3,c.a*(.6+depth*.4));\n}\ncol+=mix(c2,c3,.4+.3*sin(p.x*2.+t*.05))*glow*.16;\nfor(int j=0;j<4;j++){float fj=float(j);vec2 h=hash2(vec2(fj,9.9));\nvec2 s=vec2(-.75+h.x*1.5+.07*move*sin(t*.05+fj*2.),.1+.32*h.y+.05*move*sin(t*.09+fj));\nfloat a=0.;vec3 oc=orb(p,s,.025+.045*h.y,t+fj,a);col=mix(col,col*.6+oc,a);}\nreturn col;\n}\nvec3 scene(vec2 uv){\nfloat t=T;float hz=-.2;\nvec2 p=uv+vec2(.008*sin(t*.03),0.);\nif(p.y>hz)return world(p,t);\nfloat dy=hz-p.y;\nvec2 m=vec2(p.x+.0015*sin(p.y*90.+t*1.1)*(1.+bass),hz+dy*1.05);\nvec3 r=world(m,t)*(.55-dy*.6);\nvec3 col=c1*.06+r;\nfloat trail=exp(-pow((p.y-hz+.06+.04*sin(p.x*3.+t*.1))*30.,2.))*smoothstep(-.9,.9,p.x);\ncol+=mix(c3,c2,.5+.5*sin(p.x*4.+t*.2))*trail*.35;\nreturn col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}",
      palettes: [['Prism', [[.08,.03,.2],[.35,.6,1],[1,.45,.8]]], ['Ice', [[.02,.06,.16],[.4,.95,1],[.6,.5,1]]], ['Rose', [[.1,.02,.12],[.95,.45,.9],[.5,.7,1]]]] },
    { id: 'cosmic', name: 'Cosmic', tagline: 'Galaxies, planets and deep space', src: "vec3 stars(vec2 p,float sc,float t){vec2 sp=p*sc;vec2 id=floor(sp);vec2 h=hash2(id);\nfloat s=step(.9,h.x)*exp(-length(fract(sp)-.5-(h-.5)*.7)*(18.+h.y*20.));\nreturn mix(vec3(.75,.85,1.),vec3(1.,.85,.95),h.y)*s*(.6+.4*sin(t*(1.+h.y*2.)+h.x*50.));}\nvec3 scene(vec2 uv){\nfloat t=T;\nvec2 cam=vec2(t*.003+.04*move*sin(t*.011),.025*move*sin(t*.008));\nvec3 col=vec3(.004,.002,.012)+c1*.18*smoothstep(.9,-.3,length(uv-vec2(-.2,.1)));\ncol+=stars(uv+cam*.2,60.,t)*.7+stars(uv+cam*.5,32.,t)*.9;\nvec2 np=(uv+cam*.35)*1.3;\nvec2 w=vec2(fbm(np+vec2(t*.01,0.),4.),fbm(np+vec2(5.2,t*.008),4.));\nfloat n=fbm(np*1.5+w*1.8+vec2(-t*.006,0.),4.+quality);\nfloat neb=smoothstep(.42,.85,n);\ncol+=mix(c1*1.4,c3,w.x)*neb*.7+c2*pow(smoothstep(.55,.9,n),2.)*.5;\ncol*=1.-smoothstep(.5,.75,fbm(np*2.6-w,3.))*.45;\nvec2 g=uv-vec2(-.18,.06)+cam*.45;\nvec2 q=rot(-.42)*g;q.y*=2.4;\nfloat r=length(q),a=atan(q.y,q.x);\nfloat spiral=a-log(r+.02)*2.4+t*.025;\nfloat arms=pow(.5+.5*cos(spiral*2.),2.5);\nfloat clump=fbm(vec2(spiral*1.5,r*9.)-vec2(0.,t*.02),4.);\nfloat disk=exp(-r*3.4);\nfloat galaxy=disk*(arms*(.45+clump)+.15);\nvec3 gcol=mix(c2,c3,smoothstep(.0,.35,r)*.7+clump*.3);\ncol+=gcol*galaxy*1.8*(1.+bass*.15);\ncol+=mix(vec3(1.,.9,.8),c3,.3)*(exp(-r*16.)*1.4+exp(-r*45.)*1.5);\ncol+=vec3(1.)*step(.93,hash1(floor(q*90.)))*arms*disk*.8*(.6+.4*sin(t*2.+hash1(floor(q*90.))*40.));\nvec2 pc=vec2(.66,-.48)+cam*.9;float R=.4;\nvec2 d=(uv-pc)/R;float l=length(d);\nvec3 L=normalize(vec3(-.75,.5,.45));\nif(l<1.){vec3 nn=vec3(d,sqrt(1.-l*l));\nfloat lat=nn.y,lon=atan(nn.x,nn.z)+t*.012;\nfloat band=fbm(vec2(lon*2.5,lat*7.),5.)+.18*sin(lat*16.+fbm(vec2(lon*3.,lat*3.),4.)*5.);\nvec3 surf=mix(c1*1.2+.03,mix(c2,c3,.45)*.9,smoothstep(.2,1.,band));\nfloat lam=max(dot(nn,L),0.);\ncol=surf*(.03+lam*1.1)+c2*pow(1.-nn.z,3.)*.8*(.3+lam);\ncol+=c3*.15*smoothstep(.2,-.1,dot(nn,L))*pow(1.-nn.z,2.);}\ncol+=c2*exp(-max(l-1.,0.)*R*40.)*.55*step(1.,l)*(.3+.7*smoothstep(-.6,.6,dot(normalize(d),L.xy)));\nvec2 mc=vec2(.18+.06*cos(t*.02),-.12+.03*sin(t*.02))+cam*.8;float mr=.045;\nvec2 md=(uv-mc)/mr;float ml=length(md);\nif(ml<1.){vec3 mn=vec3(md,sqrt(1.-ml*ml));col=vec3(.75,.75,.85)*(.05+max(dot(mn,L),0.))*(.75+.25*noise(md*5.));}\nfor(int i=0;i<7;i++){float fi=float(i);if(fi>=4.+quality*3.)break;\nvec2 h=hash2(vec2(fi,2.7));\nfloat sp=.008+.01*h.y;\nvec2 ac=vec2(fract(h.x+t*sp*(.4+.6*move))*2.4-1.2,-.45+h.y*.9+.04*move*sin(t*.05+fi));\nfloat ar=.012+.035*h.y*h.y;\nvec2 ad=rot(t*(.05+h.x*.1)+fi)*(uv-ac)/ar;\nfloat an=atan(ad.y,ad.x);float rr=1.+.22*sin(an*3.+fi)+.12*sin(an*5.+fi*2.);\nfloat al=length(ad)/rr;\nif(al<1.){vec3 an3=normalize(vec3(ad,sqrt(max(0.,1.-al*al))));\ncol=vec3(.42,.38,.45)*(.03+max(dot(an3,L),0.))*(.6+.4*noise(ad*4.+fi))+c3*.15*pow(1.-an3.z,2.);}\n}\nvec2 dp=(uv+cam*1.4)*18.+vec2(t*.04,0.);vec2 did=floor(dp);vec2 dh=hash2(did);\ncol+=mix(c2,c3,dh.y)*step(.93,dh.x)*exp(-length(fract(dp)-.5)*25.)*.35*(.5+high);\nreturn col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;gl_FragColor=vec4(finish(scene(uv),uv),1.);}",
      palettes: [['Ultraviolet', [[.05,.02,.12],[.45,.25,1],[1,.45,.7]]], ['Nebula Blue', [[.01,.03,.1],[.2,.5,1],[.6,.9,1]]], ['Magenta', [[.08,.01,.08],[1,.3,.6],[.7,.4,1]]]] },
    { id: 'aurora', name: 'Aurora', tagline: 'Northern lights over a mountain lake', src: "float ridge(float x,float sc,float off){float n=fbm(vec2(x*sc+off,off),5.);float r=1.-abs(noise(vec2(x*sc*2.+off*3.,off))*2.-1.);return n*.7+r*.25;}\nvec3 auroraSky(vec2 p,float t){\nvec3 col=mix(c1*1.3+c2*.04,c1*.22,smoothstep(-.25,.5,p.y));\nvec2 sp=p*55.;vec2 id=floor(sp);vec2 h=hash2(id);\ncol+=vec3(.85,.9,1.)*step(.93,h.x)*exp(-length(fract(sp)-.5-(h-.5)*.6)*22.)*(.5+.5*sin(t*1.3+h.y*40.))*smoothstep(-.1,.2,p.y);\nfor(int i=0;i<3;i++){float fi=float(i);if(fi>=2.+quality)break;\nfloat sp2=.01+fi*.008;\nfloat base=.04+fi*.1+.2*sin(p.x*(1.9-fi*.4)+t*sp2*3.+fi*2.1)*(.75+.25*move+.25*sin(t*.03+fi))+.08*fbm(vec2(p.x*1.4+t*sp2,fi*3.+t*.01),4.);\nfloat dy=p.y-base;\nfloat fold=p.x+.05*move*sin(p.y*7.+t*.12+fi*2.);\nfloat rays=.5+.5*noise(vec2(fold*(26.+fi*6.)+fbm(vec2(fold*2.5,t*.04+fi),3.)*5.,t*.08+fi));\nrays=mix(rays,1.,.3);\nfloat curtain=smoothstep(-.03,.004,dy)*(exp(-max(dy,0.)*(9.-fi*2.))*.9+exp(-max(dy,0.)*2.6)*.28)*rays;\nfloat breathe=.7+.3*sin(t*.06+fi*1.7)+mid*.25;\nvec3 cc=mix(c2,c3,smoothstep(.02,.3,dy)*(.55+fi*.25));\ncol+=cc*curtain*breathe*(1.1-fi*.3)*1.15;\ncol+=c2*exp(-abs(dy)*12.)*.3*breathe;\n}\nreturn col;\n}\nvec3 land(vec2 p,float t,inout float solid){\nvec3 col=vec3(0.);solid=0.;\nfor(int i=0;i<3;i++){float fi=float(i);\nfloat r=ridge(p.x*.9+fi*1.7,1.3+fi*.7,fi*4.);\nfloat h=-.26+max(0.,(r-.3))*(.62-fi*.15);\nif(p.y<h){float fog=.6-fi*.25;\nvec3 m=mix(c1*.7+c2*.1,c1*.06,fi*.5);\nfloat slope=noise(vec2(p.x*60.,p.y*12.+fi));\nfloat snow=smoothstep(.08,0.,h-p.y)*smoothstep(-.2,-.05,h)*(1.-fi*.35);\nm+=mix(vec3(.8,.9,1.),c2,.45)*snow*(.35+.4*slope);\nm=mix(m,c1*.6+c2*.1,fog*.35);\ncol=m;solid=1.;}\n}\nreturn col;\n}\nvec3 world(vec2 p,float t){\nvec3 col=auroraSky(p,t);\nfloat solid=0.;vec3 m=land(p,t,solid);\ncol=mix(col,m,solid);\ncol+=mix(c1,c2,.3)*.2*smoothstep(.08,0.,abs(p.y+.18))*fbm(vec2(p.x*2.+t*.01,t*.02),3.);\nreturn col;\n}\nvec3 scene(vec2 uv){\nfloat t=T;float hz=-.27;\nif(uv.y>hz)return world(uv,t);\nfloat dy=hz-uv.y;\nvec2 m=vec2(uv.x+.003*sin(uv.y*120.+t*.9)+.002*sin(uv.x*40.-t),hz+dy);\nvec3 col=world(m,t)*(.8-dy*.7)+c1*.03;\ncol*=.9+.1*sin(uv.y*200.+t);\nfloat tree=0.;\nfor(int i=0;i<14;i++){float fi=float(i);vec2 h=hash2(vec2(fi,1.3));float x0=-1.+fi*.15+h.x*.08;float th=.03+.05*h.y;\nfloat k=(uv.y-hz)/th;if(k>0.&&k<1.&&abs(uv.x-x0)<(1.-k)*.018)tree=1.;}\nreturn col;\n}\nvoid main(){vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;\nvec3 c=scene(uv);\nfloat hz=-.27;\nfor(int i=0;i<16;i++){float fi=float(i);vec2 h=hash2(vec2(fi,1.3));float x0=-1.+fi*.135+h.x*.07;float th=.035+.06*h.y;\nfloat k=(uv.y-hz)/th;if(k>0.&&k<1.&&abs(uv.x-x0)<(1.-k)*(.016+.01*h.y))c=c1*.02;}\ngl_FragColor=vec4(finish(c,uv),1.);}",
      palettes: [['Emerald', [[.01,.03,.09],[.2,1,.55],[.6,.35,1]]], ['Polar Cyan', [[.01,.02,.08],[.25,.85,1],[.3,1,.6]]], ['Violet Night', [[.03,.02,.1],[.75,.4,1],[.3,.95,.75]]]] }
  ];
  var IDS = ENVIRONMENTS.map(function (e) { return e.id; });
  var QUALITY = { smooth: { scale: .42, fps: 24, q: 0 }, balanced: { scale: .6, fps: 30, q: 1 }, high: { scale: .82, fps: 30, q: 1 } };
  var RANGES = { speed: [.25, 2], movement: [0, 2], brightness: [.5, 1.5], colorSpeed: [.25, 3], sensitivity: [0, 2] };
  var DEFAULTS = { env: 'aurora', palettes: { deepflow: 0, chrome: 0, iridescence: 0, cosmic: 0, aurora: 0 }, speed: 1, movement: 1, brightness: 1, colorSpeed: 1, reducedMotion: false, quality: 'auto', audio: true, sensitivity: 1 };

  function normalize(v) {
    var s = JSON.parse(JSON.stringify(DEFAULTS)), src = v && typeof v === 'object' ? v : {};
    if (IDS.indexOf(src.env) >= 0) s.env = src.env;
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
  var previews = [], previewTurn = 0, lastPreview = 0, meterWanted = false, musicCheckAt = 0, musicOn = false;

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
  function music() {
    var now = Date.now();
    if (A && now > musicCheckAt) { musicCheckAt = now + 2500; try { musicOn = !!A.isMusicActive(); } catch (e) { musicOn = false; } }
    var want = active && S.audio && !S.reducedMotion && (A ? musicOn : !!window.BEAT);
    if (want !== meterWanted) { meterWanted = want; try { if (A && A.partyMeter) A.partyMeter(want); } catch (e) {} }
    var B = window.BEAT, live = want && B && Date.now() - (B.live || 0) < 1500;
    return live ? B : null;
  }
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
  function pause() { if (raf) cancelAnimationFrame(raf); raf = 0; if (meterWanted) { meterWanted = false; try { if (A && A.partyMeter) A.partyMeter(false); } catch (e) {} } }
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
