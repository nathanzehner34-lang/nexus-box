const fs = require('fs');
const assert = require('assert');
const base = __dirname + '/../../app/src/main/';
const app = fs.readFileSync(base + 'assets/app.js', 'utf8');
const html = fs.readFileSync(base + 'assets/index.html', 'utf8');
const css = fs.readFileSync(base + 'assets/style.css', 'utf8');
const java = fs.readFileSync(base + 'java/com/nexus/box/MainActivity.java', 'utf8');

// ---------- Truck Show and Daily Briefing are fully removed ----------
assert(!/data-act="show"/.test(html) && !/Truck Show/.test(html), 'Truck Show tile is removed from the home screen');
assert(!/data-act="briefing"/.test(html) && !/Daily Briefing/.test(html), 'Daily Briefing tile is removed from the home screen');
assert(!/function truckShow/.test(app) && !/function openBriefing/.test(app), 'Truck Show and Daily Briefing code is removed');
assert(!/case 'show':/.test(app) && !/case 'briefing':/.test(app), 'the action dispatcher no longer routes to the removed apps');
assert(!/\bFEEDS\b/.test(app) && !/\bloadFeed\b/.test(app) && !/\brefreshNews\b/.test(app), 'the Daily Briefing news-fetching helpers are removed');
assert(!/setInterval\(refreshNews/.test(app) && !/setTimeout\(refreshNews/.test(app), 'the periodic background news fetch (every 20 minutes) is gone');
assert(!/briefIn:|briefOut:/.test(app), 'the Daily Briefing voice lines are removed');
assert(!app.includes("'show': truckShow") , 'no stray truckShow invocation remains');
assert(!css.includes('#tshow'), 'the Truck Show overlay CSS is removed');
assert(app.includes('This powers chat, trivia and stories.'), 'the AI key hint text no longer promises briefings');

// ---------- Shared infrastructure the two removed apps used is preserved ----------
assert(/function dateStr\(\)/.test(app) && /var weatherNow = null;/.test(app), 'shared date/weather helpers used elsewhere are untouched');
assert(/function tone\(type, freq, start, dur, vol, endFreq\)/.test(app), 'the shared tone() sound helper used by other features is untouched');
assert(/function stopPlaythrough\(\)/.test(app), 'the shared Visuals playthrough helper is untouched');

// ---------- Other apps and features are untouched by the cleanup ----------
assert(html.includes('data-act="youtube"') && html.includes('data-act="music"') && html.includes('data-act="party"') &&
  html.includes('data-act="liquiddreams"') && html.includes('data-act="visuals"') && html.includes('data-act="env"'), 'unrelated home tiles remain');
assert(app.includes("case 'party': toggleParty();") && app.includes("case 'liquiddreams': openExperience(name);") &&
  app.includes("case 'visuals': openVisuals();"), 'unrelated dispatcher routes remain');

// ---------- First-tap reliability: the ghost-click blocker is scoped to the gesture we actually handled ----------
const tapBlock = app.slice(app.indexOf('Fast, forgiving taps'), app.indexOf(')();', app.indexOf('Fast, forgiving taps')) + 4);
assert(!/var lastTouch = 0;/.test(tapBlock), 'the old blanket 900ms time-window tracker is removed');
assert(/var sx = 0, sy = 0, st = 0, fired = false, handled = false;/.test(tapBlock), 'a per-gesture handled flag replaces the time window');
assert(/function fire\(el, t\) \{ handled = true;/.test(tapBlock), 'firing our own synthetic click marks the gesture as handled');
assert(/if \(e\.isTrusted && handled\) \{ handled = false;/.test(tapBlock), 'only a real click that follows a gesture we handled gets swallowed');
assert(!/Date\.now\(\) - lastTouch < 900/.test(tapBlock), 'a tap rejected by the movement tolerance no longer blocks the real click that should follow it');

// ---------- Spotify launch handoff ----------
const launchApp = java.slice(java.indexOf('public boolean launchApp('), java.indexOf('\n        }', java.indexOf('public boolean launchApp(')));
assert(launchApp.includes('getLaunchIntentForPackage("com.spotify.music")'), 'Spotify is launched directly by package instead of waiting on the full installed-app label scan');
assert(launchApp.indexOf('spotify') < launchApp.indexOf('List<String[]> list = labels();'), 'the Spotify fast path runs before the slower generic app lookup');
assert(java.includes('ui.postDelayed(this::warmSpotify, 1200);'), "Spotify's background warm-up starts sooner after boot");
assert(!/getPreferredActivity|setComponentEnabledSetting/.test(launchApp), "the Spotify fast path never touches Spotify's own settings");

console.log('Nexus cleanup and performance checks passed');
