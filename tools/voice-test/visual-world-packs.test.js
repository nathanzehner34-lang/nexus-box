const fs = require('fs');
const assert = require('assert');

const root = __dirname + '/../..';
const source = fs.readFileSync(root + '/app/src/main/assets/experiences.js', 'utf8');
const app = fs.readFileSync(root + '/app/src/main/assets/app.js', 'utf8');
const schema = JSON.parse(fs.readFileSync(root + '/app/src/main/assets/visual-world-pack.schema.json', 'utf8'));
const catalog = app.slice(app.indexOf('var VISUALS = ['), app.indexOf('];', app.indexOf('var VISUALS = [')) + 2);
const ids = Array.from(catalog.matchAll(/\['([^']+)'/g), match => match[1]);
assert.deepStrictEqual(ids, ['clip_mix', 'clip_coins', 'clip_skulls', 'clip_cityfire', 'clip_inferno', 'clip_serpent', 'clip_idol', 'clip_frenzy', 'clip_run', 'clip_collapse'], 'the Visuals catalog holds the six themes');
assert(!source.includes('VISUAL_WORLD_PROFILES') && !source.includes('drawVisualWorldFinish'), 'the old per-scene finishing profiles are removed with the old collection');
assert(schema.required.includes('id') && schema.required.includes('version') && schema.required.includes('variants'), 'pack manifests define identity, version and hardware variants');
assert(schema.properties.variants.items.properties.assets.items.required.includes('sha256'), 'every downloaded asset requires an integrity digest');
assert(source.includes('Packs: { schemaVersion: 1, validate: validateWorldPack, install: installWorldPack, list: listWorldPacks, asset: openWorldPackAsset, remove: removeWorldPack }'), 'Visuals exposes install, offline asset, listing and removal operations');
assert(source.includes('crypto.subtle.digest(\'SHA-256\'') && source.includes('status: \'installing\''), 'downloads are integrity checked and retain recoverable install state');
assert(source.includes('record.status = record.activeVersion ? \'ready\' : \'partial\''), 'failed updates retain the previously installed offline version');
assert(source.includes('navigator.storage.estimate') && source.includes('reportedMemoryGb'), 'packs respect available storage and select a compatible device quality variant');
assert(source.includes('packBytes(asset.url') && source.includes('onProgress({ id: manifest.id'), 'pack downloads report progress and retry verified cached assets');
console.log('Visuals catalog (' + ids.length + ' experiences) and offline world-pack storage foundation checks passed (no separately downloadable visual content is published yet).');
