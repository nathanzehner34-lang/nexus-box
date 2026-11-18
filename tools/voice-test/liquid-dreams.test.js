const fs = require('fs');
const assert = require('assert');
const base = __dirname + '/../../app/src/main/';
const app = fs.readFileSync(base + 'assets/app.js', 'utf8');
const html = fs.readFileSync(base + 'assets/index.html', 'utf8');
const xp = fs.readFileSync(base + 'assets/experiences.js', 'utf8');
const css = fs.readFileSync(base + 'assets/style.css', 'utf8');
assert(html.includes('data-act="liquiddreams"'), 'Liquid Dreams has a home tile');
assert(app.includes("case 'liquiddreams': openExperience(name);"), 'home navigation opens the experience');
assert(app.includes("pref('homeVer') === '4'") && app.includes("'liquiddreams'"), 'existing custom home layouts receive the new tile once');
assert(xp.includes("liquiddreams: liquidDreams"), 'experience registry dispatches the Liquid Dreams renderer');
assert(xp.includes("XP.current!=='liquiddreams'"), 'rendering is restricted to the active Liquid Dreams screen');
for (const style of ['chrome','fluid','oil','morph','psychedelic']) {
  assert(xp.includes("style==='" + style + "'") || xp.includes("'" + style + "'"), style + ' style is wired to a rendering path');
}
for (const color of ['spectrum','electric','rush','rainbow','ultraviolet','storm']) {
  assert(xp.includes(color), color + ' colour mode is present');
}
for (const setting of ['style','color','bass','treble','music','speed']) {
  assert(xp.includes('data-setting="' + setting + '"') && xp.includes("state[el.dataset.setting]"), setting + ' controller changes rendering state');
}
for (const action of ['surprise','overdrive','clean','drive','save','exit']) {
  assert(xp.includes('data-action="' + action + '"') && xp.includes("case '" + action + "'"), action + ' button is connected');
}
assert(xp.includes('liquidDreams.settings') && xp.includes('liquidDreams.presets'), 'settings and named presets persist');
assert(xp.includes('Object.assign({},state)') && xp.includes('Object.assign({},defaults,p.settings)'), 'saved presets capture and restore the full configuration');
assert(xp.includes("var b = beatTracker()") && xp.includes('b.tick(now)') && xp.includes('smoothBass') && xp.includes('smoothTreble'), 'renderer uses shared real audio analysis with smoothed frequency response');
assert(xp.includes("layer.removeEventListener('pointerdown',revealFromCanvas)") && xp.includes('alive=false'), 'screen input and rendering state clean up on exit');
assert(css.includes('#xp.liquid-dreams'), 'dedicated controller styles are scoped to Liquid Dreams');
console.log('Liquid Dreams source integration checks passed');
