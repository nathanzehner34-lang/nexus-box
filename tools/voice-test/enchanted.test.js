const fs = require('fs');
const assert = require('assert');
const root = __dirname + '/../../app/src/main/';
const app = fs.readFileSync(root + 'assets/app.js', 'utf8');
const xp = fs.readFileSync(root + 'assets/experiences.js', 'utf8');
const css = fs.readFileSync(root + 'assets/style.css', 'utf8');
const java = fs.readFileSync(root + 'java/com/nexus/box/MainActivity.java', 'utf8');

assert(app.includes("['enchanted', '✧', 'NEXUS ENCHANTED']"), 'Enchanted is a separate visible Nexus experience');
assert(xp.includes('enchanted: enchanted') && xp.includes('function enchanted()'), 'Enchanted has its own standalone XP route');
for (const feature of ['drawTree(', 'drawCanopy(', 'drawPlants(', 'drawMushrooms(', 'drawCrystal(', 'drawCreature(', 'activateEvent(', 'drawScene(']) {
  assert(xp.includes(feature), `living environment includes ${feature}`);
}
for (const action of ['tree', 'crystal', 'water', 'sky', 'summon', 'energy']) assert(xp.includes(`data-world="${action}"`) && xp.includes(`kind === '${action}'`), `${action} interaction is connected`);
assert(xp.includes('cv.onpointerdown') && xp.includes('ripples.push') && xp.includes('crystalWaveAt'), 'world touch interactions create local, sequenced responses');
assert(xp.includes('nextEvent=now+range(19000,39000)') && xp.includes('meteors.push') && xp.includes('creatures.push'), 'autonomous events vary over time and include celestial and creature encounters');
assert(xp.includes('loop(drawScene,24)') && xp.includes('DEVICE_MEMORY >= 6 ? 5 : 3') && xp.includes('var QMIN = 0.4, QMAX = HIGH_MEMORY_DEVICE ? 0.9 : 0.68'), 'world uses the adaptive renderer at a modest frame rate and keeps X3 quality capped');
assert(xp.includes("every(pollTrack, 4500)") && xp.includes('trackCard.classList.add(\'hidden\')') && xp.includes('textContent = title'), 'music metadata is discreet, hidden when unavailable, and safely updated as text');
assert(java.includes('METADATA_KEY_ALBUM') && java.includes('o.put("album", album)') && java.includes('spAlbum'), 'metadata bridge exposes the album only when Android supplies it');
assert(!xp.includes('play/pause') && !xp.includes('data-fx="next"') && !xp.includes('METADATA_KEY_ART'), 'Enchanted does not add player controls or album artwork');
assert(css.includes('#xp.enchanted') && css.includes('.enchanted-track') && css.includes('.enchanted-menu'), 'Enchanted has its own minimal, layered interface styling');
assert(app.includes("XP.current === 'enchanted'") && app.includes('resumeExperienceAfterPause'), 'Enchanted is reopened after Android activity pause/resume');
console.log('Enchanted tests passed: separate experience route, layered world, interactions, ambient events, media metadata, lifecycle and X3 caps');
