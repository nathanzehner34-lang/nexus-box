const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const xp = read('app/src/main/assets/experiences.js');
const app = read('app/src/main/assets/app.js');
const css = read('app/src/main/assets/style.css');
const java = read('app/src/main/java/com/nexus/box/MainActivity.java');
const gradle = read('app/build.gradle');
const workflow = read('.github/workflows/nexus-23-development.yml');
const liquid = xp.slice(xp.indexOf('function liquidDreams()'), xp.indexOf('var XP = window.XP'));
const shader = (xp.match(/var LIQUID_DREAMS_SHADER = `([\s\S]*?)`;/) || [])[1] || '';
const liquidAll = xp.slice(xp.indexOf('var LD_ENVIRONMENTS'), xp.indexOf('var XP = window.XP'));
const envs = ['deepflow','iridescence','ether','chrome','cosmic','organic'];
const envNames = ['Deep Flow','Iridescence','Ether','Liquid Chrome','Cosmic Melt','Organic'];
const palettes = { electric:'Electric Blue & Violet', pink:'Deep Pink & Magenta', rainbow:'Full Spectrum Rainbow', ultraviolet:'Ultraviolet Psychedelic', flowing:'Flowing Spectrum', neon:'Neon', midnight:'Midnight Blue', deepteal:'Deep Teal', violet:'Violet Haze', chrome:'Liquid Chrome', iridescent:'Iridescent', aurora:'Aurora', obsidian:'Obsidian & Magenta', arctic:'Arctic Cyan' };
envs.forEach((id, i) => assert(liquidAll.includes("id: '" + id + "', name: '" + envNames[i] + "'"), envNames[i] + ' is a selectable experience'));
for (const fn of ['deepFlowLD','iridescenceLD','etherLD','chromeLD','cosmicLD','organicLD']) assert(shader.includes('vec3 ' + fn + '('), fn + ' is its own procedural renderer');
Object.entries(palettes).forEach(([id, name]) => assert(liquidAll.includes(id + ": { name: '" + name + "'"), name + ' palette exists'));
assert(liquidAll.includes("var LD_SHIFT_ORDER = ['electric','pink','rainbow','ultraviolet','flowing','neon',"), 'Color Shift cycles the rich palettes first, then the rest');
// independent buttons
assert(liquid.includes('data-action="next"') && liquid.includes('data-action="shift"') && liquid.includes('data-action="exit"') && liquid.includes('data-action="controls"'), 'dock has Exit, Experience, Color Shift and Controls');
assert(/function nextExperience\(\) \{\n\s+if \(state\.color === 'signature'\) state\.color = envInfo\(state\.env\)\.palette;\n\s+state\.env = envIds\[\(envIds\.indexOf\(state\.env\) \+ 1\) % envIds\.length\];/.test(liquid), 'Experience button wraps through every experience and freezes the current colours');
assert(/function colorShift\(\) \{[\s\S]*?state\.color = LD_SHIFT_ORDER\[\(i \+ 1\) % LD_SHIFT_ORDER\.length\];[\s\S]*?\}/.test(liquid) && !/function colorShift\(\) \{[^}]*state\.env/.test(liquid), 'Color Shift changes only the palette');
assert(liquid.includes('spectralNow += (target.s - spectralNow) * k') && liquid.includes("2400 / state.colorSpeed"), 'palette and spectrum blend smoothly at the colour transition speed');
// colour finish
assert(shader.includes('mix(vec3(lum),col,1.32+energyL*.16)') && shader.includes('(2.51*col+.03)/(col*(2.43*col+.59)+.14)') && shader.includes('pow(col,vec3(.9))'), 'vibrance plus a filmic curve keeps neon saturated and lifts dark detail');
assert(shader.includes('vec3 tinted=rb*(L/max(Lr,.08))') , 'spectral palettes re-hue while keeping light and shade');
// touch
assert(!/touchRipple|touchBurst|touchRippleRadius/.test(shader + liquid), 'the old ripple and burst are removed');
assert(shader.includes('uniform vec4 colorWave;') && shader.includes('pal0=mix(palO0,palN0,wv);') && liquid.includes('if (!cancelled) startWave(g.x, g.y);') && liquid.includes('LD_SHIFT_ORDER.filter(function (k) { return k !== cur; })'),
  'a tap picks a new palette from the Liquid Dreams colours and it spreads from the touch point');
assert(!/pulseA|PULSEDIR|addPulse/.test(shader + liquid), 'the old fading rainbow pulse is gone');
assert(shader.includes('vec2 gw=mat2(cs,-sn,sn,cs)*g*(1.+gravStr*k*1.7);') && shader.includes('p=gravPos+gw;'), 'Gravity Point warps the space every experience is drawn in');
assert(liquid.includes('}, 170);') && liquid.includes("if (g.grav) { grav.x = p.x; grav.y = p.y; }") && liquid.includes('if (g.grav) { grav.held = false; return; }'), 'press and hold starts gravity, drag moves it, release lets it go');
assert(liquid.includes('grav.v += ((gTarget - grav.s) * K - grav.v * D) * sec;'), 'gravity release is a damped spring with an outward recovery');
assert(liquid.includes('next.touch = true') && liquid.includes("case 'touch':"), 'touch effects are on by default and can be switched off');
// music
assert(liquid.includes('sEnergy = ease(sEnergy') && liquid.includes("dream.f('energyL', energyL)") && liquid.includes('flow += sec * speedNow * (1 + midL * .5 + energyL * .4)') && liquid.includes('colorPhase += sec * (.012 + energyL * .06'), 'bass, mid, treble and beat energy all drive the visuals and colour flow');
assert(liquid.includes('beatTracker({ quiet: true })') && xp.includes('if (!quiet) dropFlash();'), 'Liquid Dreams never triggers the full-screen drop flash');
assert(/if \(name === 'liquiddreams'[^)]*\) \{ atmosphereProfile = null;/.test(xp), 'the shared colour-cycling atmosphere overlay is not drawn over Liquid Dreams');
// no black frames
assert(liquid.includes("glc.style.opacity = '0'") && liquid.includes("glc.style.opacity = '1'") && liquid.includes('function paintBackdrop()'), 'a palette backdrop shows until the first GPU frame fades in');
assert(liquid.includes('envMix += dt / (low ? 4200 : 2600)') && shader.includes('envLD(envB,p,t)'), 'experience changes dissolve with both experiences rendering');
// lifecycle
assert(liquid.includes("if (glc) { glc.style.opacity = ''; glc.style.transition = ''; }") && liquid.includes('if (ldGpuActive) { glStop(); ldGpuActive = false; }') && liquid.includes('delete XP.liquidDebug;'), 'exit releases rendering resources and resets the shared canvas');
for (const k of ['speed','movement','audio','bass','colorSpeed','brightness','detail','complexity']) assert(liquidAll.includes(k + ': [') && liquid.includes("slider('" + k + "'"), k + ' has a range and a slider');
assert(liquid.includes('legacyEnv') && liquid.includes('legacyColor') && liquid.includes("src.v !== 2 && src.v !== 3"), 'earlier saved settings and presets migrate');
assert(liquid.includes("if (!HIGH_MEMORY_DEVICE) { complexity = Math.min(.7, complexity); detail = Math.min(.9, detail); }") && liquid.includes('GLX = HIGH_MEMORY_DEVICE ? 1.1 : .72'), '2 GB devices get capped complexity and render scale');
assert(liquid.includes("liquidDreams.presets") && liquid.includes("data-action=\"save\"") && liquid.includes("data-action=\"clean\""), 'saved looks and clean screen remain');
assert(liquid.includes("setInterval(pollLiquidTrack, 1800)") && liquid.includes('A.nowPlaying()') && liquid.includes('clearInterval(trackTimer)'), 'current track display polls media metadata and stops on exit');
assert(liquid.includes('<details class="ld-group" open><summary>Motion</summary>') && liquid.includes('<summary>Sound</summary>') && liquid.includes('<summary>Look</summary>'), 'adjustments are grouped into expandable sections');
assert(css.includes('.ld-dock{') && css.includes('.ld-ui.ld-idle .ld-dock{opacity:.32}') && css.includes('.ld-toast.on'), 'the dock is styled, settles when idle and names each change');
assert(css.includes('.ld-track:empty{display:none}') && css.includes('backdrop-filter:blur(24px)'), 'dark glass panel and discreet track display');
assert(app.includes('>DOWNLOAD UPDATE</span>') && app.includes("st === 'progress'"), 'settings exposes the one-press downloader and real progress text');
assert(java.includes('NEXUS_LATEST_RELEASE_API') && java.includes('NEXUS_LATEST_APK_URL') && java.includes('NEXUS_APK_NAME'), 'native updater resolves the exact stable Releases APK used by the truck');
assert(java.includes("Nexus._update('progress',") && java.includes('got * 100 / total'), 'native updater reports actual download progress');
assert(java.includes('getPackageInstaller()') && java.includes('STATUS_PENDING_USER_ACTION') && !java.includes('getUriForDownloadedFile'), 'native updater installs through an Android installer session, not a Downloads URI');
assert(java.includes('updateFailed(') && app.includes("'Update did not finish: '"), 'a failed update shows the real reason on screen');
assert(java.includes('getPackageArchiveInfo') && java.includes('downloadedVersion < currentVersion'), 'native updater rejects incomplete or non-upgrading APKs');
assert(java.includes('spotifyWarm.isConnected()'), 'Spotify warm-up reuses an active media connection instead of disconnecting and reconnecting');
assert(java.includes('got = certificateDigests(downloaded), have = certificateDigests(installed)') && java.includes('!got.equals(have)'), 'native updater checks package signing identity before installer launch');
assert(java.includes('PackageManager.GET_SIGNATURES | (Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : 0)'), 'the updater asks for both signature kinds, so a download is never refused as "no signature"');
assert(java.includes('public int deviceMemoryGb()') && java.includes('memory.totalMem'), 'Android reports physical RAM so WebView can select the correct effects tier');
assert(!java.includes('ui.postDelayed(this::startPhones, 1500)') && java.includes('if (phones == null) { startPhones();'), 'phone server starts only when its screen is opened');
assert(gradle.includes('NEXUS_VERSION_CODE') && gradle.includes("applicationId 'com.nexus.box'"), 'dev versioning preserves the existing app identity');
assert(/branches:\r?\n\s+- nexus-36-download-button/.test(workflow) && workflow.includes('nexus-dev-build-') && workflow.includes('--prerelease'), 'dev workflow publishes only isolated development releases');
assert(workflow.includes('test "$VERSION" = "$VERSION_CODE"') && workflow.includes('OLD_CERT'), 'development workflow verifies version and truck signing identity before publication');
console.log('Liquid Dreams environments, palettes, controls, media display, stable updater and release wiring checks passed');
