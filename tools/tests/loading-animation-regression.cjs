// Exercise completion timing without rendering or network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../assets/scripts/common/LoadingLogic.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
}, reportDiagnostics: true });
assert.equal(compiled.diagnostics.length, 0);
const fades = [];
const cc = {
    Component: class {}, UIOpacity: class {}, ProgressBar: class {}, Label: class {}, Node: class {},
    Sprite: class {}, SpriteFrame: class {}, Prefab: class {},
    _decorator: { ccclass: () => Type => Type, property: () => () => {} },
    Tween: { stopAllByTarget() {} },
    tween(target) {
        const fade = { target };
        return { to(seconds) { fade.seconds = seconds; return this; },
            call(callback) { fade.callback = callback; return this; }, start() { fades.push(fade); } };
    },
};
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputText)(id => {
    if (id === 'cc') return cc;
    if (id.endsWith('/CoreEvent')) return { CoreEvent: {} };
    if (id.endsWith('/EventMgr')) return { EventMgr: { targetOff() {} } };
    throw new Error(id);
}, mod, mod.exports);
const Loading = mod.exports.default;
function fixture(progress = 0) {
    fades.length = 0;
    const loading = new Loading();
    loading.node = { isValid: true, getComponent: () => null, addComponent: () => ({}),
        destroy() { this.isValid = false; } };
    loading.bar = { progress };
    loading.percentLabel = { string: '' };
    loading.visualProgress = progress;
    loading.targetProgress = progress;
    return loading;
}
for (const fps of [15, 30, 60, 144]) {
    for (const progress of [0, 0.7, 0.9, 0.98, 0.99]) {
        const loading = fixture(progress);
        let completed = 0;
        loading.finish(() => completed++);
        loading.finish(() => { throw new Error('finish must be idempotent'); });
        let elapsed = 0, previous = progress;
        while (!fades.length && elapsed < 2) {
            loading.update(1 / fps);
            elapsed += 1 / fps;
            assert.ok(loading.bar.progress >= previous && loading.bar.progress <= 1);
            previous = loading.bar.progress;
        }
        assert.equal(loading.bar.progress, 1);
        assert.equal(completed, 0, 'game readiness callback waits for the fade');
        assert.equal(fades.length, 1);
        assert.ok(elapsed + fades[0].seconds <= 0.3 + 1 / fps, 'ready screen must finish promptly');
        loading.update(1);
        assert.equal(fades.length, 1, 'subsequent frames must not start another fade');
        fades[0].callback(); fades[0].callback();
        assert.equal(completed, 1);
        assert.equal(loading.node.isValid, false);
    }
}
console.log('PASS ready completion stays within 300ms plus one frame at 15–144 FPS; callback fires once');
{
    const loading = fixture();
    loading.onProgress(1); loading.onComplete(); loading.onMapProgress(1, 'test');
    for (let i = 0; i < 600; i++) loading.update(1 / 60);
    assert.ok(loading.bar.progress < 1, 'resource progress cannot finish before map readiness');
    assert.equal(fades.length, 0);
    loading.finish(); loading.update(0.5);
    assert.equal(fades.length, 1, 'a slow frame must not prolong the ready animation');
    loading.onEnable();
    assert.equal(loading.bar.progress, 0);
    assert.equal(loading.finishing, false);
    assert.equal(loading.finishCallback, null);
}
console.log('PASS loading remains gated by actual readiness and resets for the next entry');
