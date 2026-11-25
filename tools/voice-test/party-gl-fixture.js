// Shared fixture for the Party shader pixel tests: the Energy Field reads its six colours from a small
// palette texture and its body from five lobes that party.js moves, so a bare shader needs both.
// FLOW: a typical moment (lobes clustered round the centre, a little twist). PALETTE: page code that
// bakes the ORB preset's Energy Field colours into the texture on unit 0, exactly as party.js does.
const FLOW = {
  lobe: [.08, 0, .1, 0, -.06, .05, .085, .07, 0, -.07, .095, .14, -.1, -.03, .075, .21, .05, .07, .09, .28],
  fx: [.3, .8, 0, 0], fy: [9, 0, 0, .3], fz: [.6, 2, 0, 0]
};
const PALETTE = `(function(){const P=[[31,240,216],[47,123,255],[157,75,255],[255,79,192],[255,138,61],[255,211,79]],d=new Uint8Array(256);
 for(let i=0;i<64;i++){const x=i/64*6,k=Math.floor(x);let f=x-k;f=f*f*(3-2*f);const a=P[k%6],b=P[(k+1)%6];for(let c=0;c<3;c++)d[i*4+c]=Math.round(a[c]+(b[c]-a[c])*f);d[i*4+3]=255;}
 const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,64,1,0,gl.RGBA,gl.UNSIGNED_BYTE,d);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);})();`;
// sets one uniform from a plain value: number, vec2/3/4, or the 20-float lobe array
const SETTER = `function setU(L,v){if(!Array.isArray(v))gl.uniform1f(L,v);else if(v.length===2)gl.uniform2f(L,v[0],v[1]);else if(v.length===3)gl.uniform3f(L,v[0],v[1],v[2]);
 else if(v.length===4)gl.uniform4f(L,v[0],v[1],v[2],v[3]);else gl.uniform4fv(L,new Float32Array(v));}`;
module.exports = { FLOW, PALETTE, SETTER };
