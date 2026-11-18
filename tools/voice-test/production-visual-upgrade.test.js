const fs = require('fs');
const assert = require('assert');
const base = __dirname + '/../../app/src/main/';
const app = fs.readFileSync(base + 'assets/app.js', 'utf8');
const html = fs.readFileSync(base + 'assets/index.html', 'utf8');
const xp = fs.readFileSync(base + 'assets/experiences.js', 'utf8');
const party = fs.readFileSync(base + 'assets/party.js', 'utf8');
const java = fs.readFileSync(base + 'java/com/nexus/box/MainActivity.java', 'utf8');
const gradle = fs.readFileSync(__dirname + '/../../app/build.gradle', 'utf8');
const workflow = fs.readFileSync(__dirname + '/../../.github/workflows/build.yml', 'utf8');
const gallery = app.slice(app.indexOf('var VISUALS = ['), app.indexOf('];', app.indexOf('var VISUALS = [')) + 2);
const galleryIds = Array.from(gallery.matchAll(/\['([^']+)'/g), match => match[1]);

assert(html.includes('data-act="liquiddreams"') && app.includes("case 'liquiddreams': openExperience(name);"), 'Liquid Dreams is a home-screen experience');
assert(app.includes("pref('homeVer') === '4'") && app.includes("'liquiddreams'") && app.includes("'5'"), 'existing custom home layouts gain Liquid Dreams without resetting preferences');
for (const [id, fn] of [['skeletondance','skeletonDance'],['neonfluid','neonFluid'],['macrocrystalgrowth','macroCrystalGrowth'],['deepsea','bioluminescentDeepSea'],['prismrefraction','prismaticRefraction'],['quantumparticles','quantumParticles']]) {
  assert(galleryIds.includes(id) && xp.includes(id + ': ' + fn), id + ' is in the Gallery catalog and dispatched to a scene');
  assert(xp.includes('function ' + fn + '()'), fn + ' is an independent renderer');
}
assert(!galleryIds.includes('crystal') && !xp.includes('crystal: crystal') && !/function crystal\s*\(/.test(xp), 'Crystal Geometry is removed from the gallery and renderer registration');
assert(galleryIds.includes('macrocrystalgrowth') && xp.includes('function macroCrystalGrowth()'), 'Macro Crystal Growth remains a separate experience');
assert(galleryIds.length === new Set(galleryIds).size, 'the gallery has no duplicate or stale selection entries');
for (const id of galleryIds) assert(new RegExp('(?:^|[,{ ])' + id + ':').test(xp.slice(xp.indexOf('({ holo:'), xp.indexOf('})[name]()'))), id + ' still dispatches to a renderer');
assert(xp.includes('function renderAtmosphere(now)') && xp.includes('renderAtmosphere(now);'), 'every animated gallery renderer receives the layered quality pass');
for (const family of ['space','fluid','prism','organic','neon']) assert(xp.includes(family + ': ['), family + ' scenes have a distinct atmospheric treatment');
assert(xp.includes('HIGH_MEMORY_DEVICE ? 0.9 : 0.8') && xp.includes('HIGH_MEMORY_DEVICE ? 88 : 30') && xp.includes('1000 / (HIGH_MEMORY_DEVICE ? 30 : 20)'), 'the gallery adapts resolution, particle count and frame rate to device memory');
assert(xp.includes('function liquidDreams()') && xp.includes('liquiddreams: liquidDreams'), 'Liquid Dreams is independently registered');
for (const style of ['tunnel','kaleidoscope','liquid','cosmic','morph','prism','ink','clouds']) assert(xp.includes("'" + style + "'") && xp.includes('value="' + style + '"'), style + ' Liquid Dreams engine exists and is selectable');
for (const color of ['spectrum','electric','rush','rainbow','ultraviolet','storm']) assert(xp.includes(color), color + ' colour mode exists');
for (const setting of ['style','color','bass','treble','music','speed']) assert(xp.includes('data-setting="' + setting + '"'), setting + ' controller is present');
for (const action of ['surprise','overdrive','clean','drive','save','exit']) assert(xp.includes("case '" + action + "'"), action + ' control is connected');
assert(xp.includes('liquidDreams.settings') && xp.includes('liquidDreams.presets') && xp.includes('p.settings'), 'Liquid Dreams settings and named presets persist');

for (const mode of ['pulse','wave','vortex','chaos','ripple']) assert(party.includes("'" + mode + "'"), mode + ' Party mode remains available');
assert(!party.includes("'chrome'") && !html.includes('data-mode="chrome"'), 'Liquid Chrome is removed from Party Mode');
for (const preset of ['orb','voltage','aurora','neon']) assert(party.includes(preset + ': {') && html.includes('data-preset="' + preset + '"'), preset + ' is a selectable Party preset');
assert(!/#[0-9a-f]*39ff14|#[0-9a-f]*47ff31|#[0-9a-f]*42ff76/i.test(party), 'old green Party preset colors are removed');
for (const branch of ["preset==='orb'","preset==='voltage'","preset==='aurora'"]) assert(party.includes(branch), branch + ' has its own ambient renderer');
assert(party.includes("oldMeter(all, low, mid, high)") && party.includes('bassPulse=clamp(bass*3'), 'Party responds to actual spectral data and bass hits');

assert(java.includes('double bass = 0, mid = 0, high = 0, all = 0') && java.includes('midBins') && java.includes('highBins'), 'Android music Visualizer calculates bass, midrange and treble bands');
assert(java.includes('Nexus._meter && Nexus._meter(') && app.includes('function feedBeat(all, bass, mid, high)') && app.includes('BEAT.mid') && app.includes('BEAT.high'), 'measured spectrum reaches Nexus visual scenes');
assert(gradle.includes("applicationId 'com.nexus.box'") && gradle.includes('versionCode runNumber'), 'production package identity and versioning remain unchanged');
assert(java.includes('https://github.com/nathanzehner34-lang/nexus-box/releases/download/latest/nexus.apk'), 'truck Download Recent URL remains unchanged');
assert(workflow.includes('workflow_dispatch:') && !workflow.includes('push:'), 'production build remains manually triggered');
assert(workflow.indexOf('name: Verify production update compatibility') < workflow.indexOf('name: Publish to "latest" release'), 'APK checks precede replacement of the production release');
console.log('Production Build 33 feature integration checks passed');
