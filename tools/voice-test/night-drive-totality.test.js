// Night Drive · TOTALITY: the new world renders, keeps its eclipse, horizon and salt-flat mirror, answers each
// part of the music in its own place, stays coloured rather than white, and is offered in the WORLD row.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { parts, render, BASE } = require('./nd-stills.js');
const src = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/experiences.js'), 'utf8');
const P = parts(src);
assert(P.totality, 'the TOTALITY world exists');
assert(/\{ id: 'totality', name: 'TOTALITY', frag: ND_TOTALITY/.test(src), 'TOTALITY is offered in the WORLD row');
['ndSky', 'ndHaze', 'ndGround', 'ndRoadFx'].forEach(h => assert(P.totality.includes('vec3 ' + h + '('), 'TOTALITY implements ' + h));
const W = 384, H = 216, f = P.build(P.totality);
const far = { pulseT: [99, 99, 99, 99], pulseS: [0, 0, 0, 0], bass: 0, mids: 0, highs: 0, hat: 0, snare: 0, boost: 0, drift: 0 };
const U = k => Object.assign({}, BASE, far, k);
const R = render({
  quiet: [f, U({})],
  bass: [f, U({ bass: 1 })],
  kick: [f, U({ pulseT: [.5, 99, 99, 99], pulseS: [1, 0, 0, 0] })],
  drop: [f, U({ boost: 1 })],
  later: [f, U({ travel: 5200 + 96 / 3, time: 31.33 })]
}, W, H, { img: true, reps: 1 });
assert(!R.error, 'TOTALITY compiles: ' + R.error);
const lum = (img, x, y) => { const o = (y * W + x) * 4; return (img[o] + img[o + 1] + img[o + 2]) / 3; };
function mean(img, x0, x1, y0, y1) { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum(img, x, y); n++; } return s / n; }
function diff(a, b, x0, x1, y0, y1) { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += Math.abs(lum(a, x, y) - lum(b, x, y)); n++; } return s / n; }
const q = R.quiet.img;
// the eclipse sits a little right of the road, high above the horizon (readPixels rows start at the bottom)
const ex = Math.round(W / 2 + .143 * H), ey = Math.round(H / 2 + .131 * H);
const moon = mean(q, ex - 3, ex + 3, ey - 3, ey + 3), corona = mean(q, ex - 30, ex + 30, ey - 30, ey + 30), sky = mean(q, 10, 60, H - 40, H - 10);
assert(moon < 20, 'the moon is a black disc (' + moon.toFixed(1) + ')');
assert(corona > sky * 1.5, 'the corona glows round it (' + corona.toFixed(1) + ' vs sky ' + sky.toFixed(1) + ')');
const horizonY = Math.round(H / 2 - .076 * H);
const twilight = mean(q, 0, W, horizonY + 2, horizonY + 10);
assert(twilight > sky, 'the twilight of totality burns along the horizon (' + twilight.toFixed(1) + ' vs ' + sky.toFixed(1) + ')');
const all = mean(q, 0, W, 0, H);
assert(all > 8 && all < 110, 'controlled overall brightness (' + all.toFixed(1) + ')');
let white = 0; for (let i = 0; i < q.length; i += 4) if (q[i] > 235 && q[i + 1] > 235 && q[i + 2] > 235) white++;
assert(white / (W * H) < .02, 'no white wash (' + (100 * white / (W * H)).toFixed(2) + '%)');
// music: each part of the sound changes its own region
const cBox = [ex - 60, ex + 60, ey - 50, ey + 50], gBox = [0, W, 0, Math.round(H * .3)];
const bassC = diff(q, R.bass.img, ...cBox), bassG = diff(q, R.bass.img, ...gBox);
assert(bassC > .8 && bassC > bassG * 1.5, 'the bass swells the corona more than anything else (' + bassC.toFixed(2) + ' vs ground ' + bassG.toFixed(2) + ')');
assert(diff(q, R.kick.img, ...cBox) > .5, 'a kick sends a ring of light out through the corona');
const kg = diff(q, R.kick.img, 0, W, Math.round(H * .3), Math.round(H * .42)); console.log('kick on the flats', kg.toFixed(3));
assert(kg > .15, 'and a ripple across the mirror');
assert(diff(q, R.drop.img, ex - 40, ex + 40, ey - 40, ey + 40) > 1, 'a drop opens the diamond ring');
assert(diff(q, R.later.img, 0, W, 0, Math.round(H * .4)) > .5, 'the salt flats stream past');
console.log('Night Drive TOTALITY: eclipse, corona, twilight horizon, mirror and per-band music verified (bass ' + bassC.toFixed(2) + ', mean ' + all.toFixed(1) + ').');
