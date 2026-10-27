// Regression: an independently opened replay must wait for local tables, share loads and recover after failure.
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const pending = [], warnings = [];
class JsonAsset {}
const cc = { JsonAsset, resources: { load(name, Type, callback) { pending.push({name, callback}); } } };
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/core/ConfigManager.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS }
}).outputText, { exports: moduleObject.exports, module: moduleObject, require: () => cc,
    console: { warn: message => warnings.push(message) } });
const config = moduleObject.exports.default.getInstance();
const data = name => JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name + '.json'), 'utf8'));
(async () => {
    let ready = false;
    const a = config.ensureConfigs(['Hero', 'Monster', 'Skill']).then(() => { ready = true; });
    const b = config.ensureConfigs(['Hero', 'Monster']);
    assert.equal(pending.length, 3, 'concurrent views share resource requests');
    await Promise.resolve();
    assert.equal(ready, false, 'the view cannot render names before tables arrive');
    for (const p of pending.splice(0)) p.callback(null, { json: data(p.name.split('/')[1]) });
    await Promise.all([a, b]);
    assert.equal(config.getConfig('Hero')['1001'].name, '吕布');
    assert.ok(config.getConfig('Monster')['5'].Name);
    await config.ensureConfigs(['Hero']);
    assert.equal(pending.length, 0, 'cached tables are reused');
    const failure = config.ensureConfigs(['ReportType']);
    pending.shift().callback(new Error('temporary load error'));
    await assert.rejects(failure, /temporary/);
    const retry = config.ensureConfigs(['ReportType']);
    assert.equal(pending.length, 1, 'failed requests can retry');
    pending.shift().callback(null, { json: data('ReportType') });
    await retry;
    assert.equal(warnings.length, 0, 'awaited data produces no missing-table warnings');
    console.log('PASS independent replay config loading, deduplication, actual names, failure and retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
