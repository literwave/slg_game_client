const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require(process.argv[2]), root = path.resolve(__dirname, '../..');
function load(file, imports) {
    const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
        reportDiagnostics: true,
    });
    assert.equal(output.diagnostics.length, 0, file);
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', output.outputText)(id => {
        assert.ok(id in imports, 'unmapped import: ' + id); return imports[id];
    }, mod, mod.exports);
    return mod.exports;
}
(async () => {
    const loaded = new Map(), pending = [], requests = [];
    class SpriteFrame {}
    const resources = {
        get: key => loaded.get(key) || null,
        load(key, Type, done) { requests.push(key); pending.push({ key, done }); },
    };
    const module = load('assets/scripts/map/ui/SidebarIconCache.ts', { cc: { resources, SpriteFrame } });
    const cache = module.default;
    assert.equal(cache.frame(-1), null);
    const first = cache.prepare();
    assert.equal(cache.prepare(), first, '同时初始化只能发起一组加载');
    const iconCount = pending.length;
    assert.equal(iconCount, 9, '四个页签、三个属性及行军、标记各使用独立小图');
    const jobs = pending.splice(0);
    jobs.forEach((job, index) => {
        if (index === 0) job.done(new Error('temporary read failure'));
        else { const frame = { isValid: true, name: module.SIDEBAR_ICON_NAMES[index] }; loaded.set(job.key, frame); job.done(null, frame); }
    });
    await assert.rejects(first, /temporary read failure/);
    const retry = cache.prepare();
    assert.equal(pending.length, 1, '失败后仅重试缺失图标，已经解码的图标保留');
    const job = pending.pop(), frame = { isValid: true, name: module.SIDEBAR_ICON_NAMES[0] };
    loaded.set(job.key, frame); job.done(null, frame); await retry;
    for (let i = 0; i < 4; i++) assert.ok(cache.frame(i)?.isValid);
    await cache.prepare(); assert.equal(requests.length, iconCount + 1, '反复切页不重新加载');
    assert.equal(new Set(module.SIDEBAR_ICON_NAMES).size, 4);
    for (const name of module.SIDEBAR_ICON_NAMES) {
        const image = fs.readFileSync(path.join(root, 'assets/resources/ui/sidebar', name + '.png'));
        assert.ok(image.readUInt32BE(16) <= 192 && image.readUInt32BE(20) <= 192, '图标保持 HUD 尺寸');
    }
    console.log('PASS 四枚独立图标、并发合并、缓存命中与失败重试');

    const city = load('assets/scripts/map/CityFootprint.ts', {});
    const gates = load('assets/scripts/map/GateGeometry.ts', { './BridgeSilhouette': load('assets/scripts/map/BridgeSilhouette.ts', {}) });
    const appearance = load('assets/scripts/map/PlayerCityAppearance.ts', {});
    const artLoads = [], frames = new Map();
    const sizes = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/art-sizes.json')));
    const artModule = load('assets/scripts/map/WorldMapArt.ts', {
        cc: { resources: {
            load(paths, Type, progress, completed) {
                const done = completed || progress;
                artLoads.push(paths);
                if (Array.isArray(paths)) { progress(1, 2); done(null, paths.map(p => {
                    const name = p.split('/').at(-2), frame = { name, isValid: true };
                    frames.set(name, frame); return frame;
                })); }
                else if (paths.startsWith('ui/world/')) {
                    const name = paths.split('/').at(-2), frame = { name, isValid: true, addRef() {},
                        originalSize: { width: sizes[name][0], height: sizes[name][1] } };
                    frames.set(name, frame); done(null, frame);
                } else done(null, { json: paths === 'world/art-sizes' ? sizes : {} });
            },
            loadDir() { throw new Error('不允许加载历史素材目录'); },
        } },
        './CityFootprint': city, './GateGeometry': gates,
        '../core/AssetLoadQueue': { default: { request: (key, run) => run() }, AssetPriority: { Visible: 10 }, AssetRequestCancelled: class {} },
        './PlayerCityAppearance': appearance, './PlayerCityGround': { default: { prepare: async () => {} } },
    });
    const names = artModule.worldArtNames();
    assert.equal(names.length, new Set(names).size);
    const landscape = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/original-landscape.json')));
    for (const patch of landscape.patches) assert.ok(names.includes(patch.art), patch.art);
    let neededBytes = 0, neededPixels = 0;
    for (const name of names) {
        const image = fs.readFileSync(path.join(root, 'assets/resources/ui/world', name + '.png'));
        neededBytes += image.length; neededPixels += image.readUInt32BE(16) * image.readUInt32BE(20);
    }
    for (const old of ['county-commandery-v3', 'county-regional-v2', 'city-overview-capital-v3']) assert.ok(!names.includes(old));
    const ready = artModule.default.prepare(); assert.equal(artModule.default.prepare(), ready);
    await ready;
    assert.equal(artModule.default.preparationProgress, 1, '基础地形和几何信息就绪即可进入首屏构建');
    assert.equal(artLoads.filter(Array.isArray).length, 0);
    assert.equal(frames.size, artModule.WORLD_CORE_ART.length, '启动不加载全部城池、资源等级图');
    for (const name of artModule.WORLD_CORE_ART) assert.ok(artModule.default.frame(name));
    for (const level of [4, 7, 10]) { await artModule.default.ensure(city.cityArtAsset(level)); assert.ok(artModule.default.frame(city.cityArtAsset(level))); }
    let oldBytes = 0, oldPixels = 0, oldCount = 0;
    for (const name of fs.readdirSync(path.join(root, 'assets/resources/ui/world')).filter(n => n.endsWith('.png'))) {
        const image = fs.readFileSync(path.join(root, 'assets/resources/ui/world', name));
        oldCount++; oldBytes += image.length; oldPixels += image.readUInt32BE(16) * image.readUInt32BE(20);
    }
    console.log('PASS 地图启动仅加载基础地形，城池按需加载，历史原画不加载');
    console.log(JSON.stringify({ oldCount, currentCount: names.length, omittedBytes: oldBytes - neededBytes,
        omittedRGBABytes: (oldPixels - neededPixels) * 4,
        previousEagerCount: names.length, coreCount: artModule.WORLD_CORE_ART.length,
        coreRGBABytes: artModule.WORLD_CORE_ART.reduce((sum, name) => sum + sizes[name][0] * sizes[name][1] * 4, 0), previousEagerRGBABytes: neededPixels * 4 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
