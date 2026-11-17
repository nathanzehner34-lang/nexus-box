const fs = require('fs');
const assert = require('assert');
const base = __dirname + '/../../app/src/main/';
const app = fs.readFileSync(base + 'assets/app.js', 'utf8');
const xp = fs.readFileSync(base + 'assets/experiences.js', 'utf8');
const java = fs.readFileSync(base + 'java/com/nexus/box/MainActivity.java', 'utf8');
const catalogStart = app.indexOf('var VISUALS = [');
const catalogEnd = app.indexOf('];', catalogStart);
assert(catalogStart >= 0 && catalogEnd > catalogStart, 'visual catalog exists');
const catalog = app.slice(catalogStart, catalogEnd);
const ids = [...catalog.matchAll(/\['([^']+)'/g)].map(m => m[1]);
const previous = ['aliens','dragon','waterclub','tornado','outrun','bluefire','vapor','kaleido','ring','shatter','hyper','water','friend','eye','fractal','wormhole','mirror','planet','skull','worlds','gold','neural','auroratunnel','ink','crystal','datastorm','blackhole','portrait','lava','synth','zoom','aura'];
const removed = new Set(['crystal','blackhole']);
const added = ['skeletondance','neonfluid','macrocrystalgrowth','deepsea','prismrefraction','quantumparticles'];
const exactNames = ['Dancing Skeleton','Neon Fluid Simulations','Macro Crystal Growth','Bioluminescent Deep Sea','Prismatic Light Refraction','Quantum Particle Fields'];
const routes = {
  skeletondance: "skeletonDance(){premiumVisual('skeleton')",
  neonfluid: "neonFluid(){premiumVisual('fluid')",
  macrocrystalgrowth: "macroCrystalGrowth(){premiumVisual('growth')",
  deepsea: "bioluminescentDeepSea(){premiumVisual('deepsea')",
  prismrefraction: "prismaticRefraction(){premiumVisual('prism')",
  quantumparticles: "quantumParticles(){premiumVisual('quantum')"
};
const expected = previous.filter(x => !removed.has(x)).concat(added);
assert.deepStrictEqual(ids, expected, 'only Crystal Geometry and Black Hole were removed; all else retained and six appended');
for (const name of exactNames) {
  assert(catalog.includes(`'${name}'`), `${name} uses the approved exact name in the selector`);
  assert(xp.includes(`['${name}'`), `${name} uses the approved exact name in its visual scene`);
}
assert(ids.includes('kaleido'), 'Kaleidoscope remains available');
const xpMap = xp.slice(xp.indexOf('var XP = window.XP'), xp.indexOf('close: function (quiet)'));
for (const id of expected) assert(xpMap.includes(id + ':'), id + ' has an experience dispatcher');
for (const id of added) assert(xp.includes('premiumVisual(') && xpMap.includes(id + ':'), id + ' is connected to a new visual renderer');
for (const id of added) assert(xp.includes(`function ${routes[id]}`), `${id} routes to its own premium renderer`);
for (const kind of ['skeleton','fluid','growth','deepsea','prism','quantum']) assert(xp.includes(`function ${kind}(`), `${kind} renderer loads`);
assert(!xp.includes('function crystal()') && !xp.includes('function blackhole()'), 'the two requested old experiences are removed');
assert(!xp.includes('CRYSTAL GEOMETRY') && !xp.includes('BLACK HOLE'), 'removed visual names are absent from the renderer');
assert(xp.includes('function kaleido()'), 'Kaleidoscope renderer remains');
assert(xp.includes('DPR') && xp.includes('QMAX = HIGH_MEMORY_DEVICE ? 0.9 : 0.68'), 'adaptive resolution is capped for 2 GB and scales up on 6+ GB devices');
assert(app.includes('Nexus._meter = function (all, bass, mid, high)'), 'existing WebView audio bridge accepts spectral bands');
assert(java.includes('double bass = 0, mid = 0, treble = 0, all = 0;'), 'existing Android Visualizer calculates bass, mid, treble, and total energy');
assert(java.includes('Nexus._meter && Nexus._meter(') && java.includes('%.4f", treble)'), 'spectral bands feed the existing visualizer bridge');
assert(app.includes("['kaleido', '🌀', 'KALEIDOSCOPE']"), 'Kaleidoscope remains in the user-visible selector');
console.log('visual library tests passed: 30 retained, only Crystal Geometry and Black Hole removed, six new visuals connected, Kaleidoscope kept, and FFT bands wired');
