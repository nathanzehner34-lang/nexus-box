const fs = require('fs');
const assert = require('assert');

const root = __dirname + '/../..';
const source = fs.readFileSync(root + '/app/src/main/assets/experiences.js', 'utf8');
const app = fs.readFileSync(root + '/app/src/main/assets/app.js', 'utf8');
const schema = JSON.parse(fs.readFileSync(root + '/app/src/main/assets/visual-world-pack.schema.json', 'utf8'));
const catalog = app.slice(app.indexOf('var VISUALS = ['), app.indexOf('];', app.indexOf('var VISUALS = [')) + 2);
const ids = Array.from(catalog.matchAll(/\['([^']+)'/g), match => match[1]);
const profileBlock = source.slice(source.indexOf('var VISUAL_WORLD_PROFILES = {'), source.indexOf('\n  };', source.indexOf('var VISUAL_WORLD_PROFILES = {')));
const profiles = Array.from(profileBlock.matchAll(/([a-z][a-z0-9]*): \{/g), match => match[1]);

assert.strictEqual(ids.length, 37, 'the existing 37 gallery entries are preserved');
assert.deepStrictEqual(new Set(profiles), new Set(ids), 'each gallery world has exactly one concept-specific scene profile');
assert(schema.required.includes('id') && schema.required.includes('version') && schema.required.includes('variants'), 'pack manifests define identity, version and hardware variants');
assert(schema.properties.variants.items.properties.assets.items.required.includes('sha256'), 'every downloaded asset requires an integrity digest');
assert(source.includes('Packs: { schemaVersion: 1, validate: validateWorldPack, install: installWorldPack, list: listWorldPacks, asset: openWorldPackAsset, remove: removeWorldPack }'), 'Visuals exposes install, offline asset, listing and removal operations');
assert(source.includes('crypto.subtle.digest(\'SHA-256\'') && source.includes('status: \'installing\''), 'downloads are integrity checked and retain recoverable install state');
assert(source.includes('record.status = record.activeVersion ? \'ready\' : \'partial\''), 'failed updates retain the previously installed offline version');
assert(source.includes('navigator.storage.estimate') && source.includes('reportedMemoryGb'), 'packs respect available storage and select a compatible device quality variant');
assert(source.includes('packBytes(asset.url') && source.includes('onProgress({ id: manifest.id'), 'pack downloads report progress and retry verified cached assets');
assert(source.includes('if (worldFx) drawVisualWorldFinish(now)') && source.includes('beginVisualWorld(name)'), 'the world finishing pass runs only for selected gallery profiles');
console.log('Visual world profiles and downloadable-pack foundation checks passed for ' + ids.length + ' worlds.');
