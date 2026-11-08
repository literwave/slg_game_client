const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
class Clock {
    now = 100000; serial = 0; timers = new Map();
    set = (fn, delay = 0) => { const id = ++this.serial; this.timers.set(id, { fn, at: this.now + delay }); return id; };
    clear = id => this.timers.delete(id);
    tick(ms = 0) { this.now += ms; for (const [id, timer] of [...this.timers]) if (timer.at <= this.now) { this.timers.delete(id); timer.fn(); } }
}
function load(file, imports, clock) {
    const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } });
    assert.equal(output.diagnostics.length, 0, file);
    const module = { exports: {} };
    class TestDate extends Date { static now() { return clock.now; } }
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', 'Date', output.outputText)(
        key => { if (!(key in imports)) throw new Error(`Unmocked ${key}`); return imports[key]; },
        module, module.exports, clock.set, clock.clear, TestDate);
    return module.exports;
}
const settle = async clock => { for (let i = 0; i < 8; i++) { clock.tick(); await flush(); } };
function queueFixture() {
    const clock = new Clock();
    const module = load('assets/scripts/core/AssetLoadQueue.ts', {}, clock);
    return { clock, module, Queue: module.default, Priority: module.AssetPriority };
}
class Frame {
    isValid = true; refs = 0; packable = true;
    constructor(name) { this.name = name; this.originalSize = { width: 256, height: 128 }; }
    addRef() { this.refs++; return this; }
    decRef() { if (--this.refs === 0) this.isValid = false; return this; }
}
class Sprite {
    static SizeMode = { CUSTOM: 1 }; static Type = { SIMPLE: 1 };
    isValid = true; spriteFrame = null; customMaterial = null;
    constructor() { this.node = { activeInHierarchy: true, getComponent: () => ({ setContentSize() {} }) }; }
}
function artFixture() {
    const q = queueFixture(), images = [], released = [];
    const cc = { Color: { WHITE: {} }, Sprite, SpriteFrame: Frame, UITransform: class {}, EffectAsset: class {}, JsonAsset: class {},
        isValid: value => !!value && value.isValid !== false,
        resources: { load(url, type, callback) { images.push({ url, callback }); } } };
    const module = load('assets/scripts/map/WorldMapArt.ts', {
        cc, '../core/AssetLoadQueue': q.module,
        './CityFootprint': { cityArtAsset: () => 'city', cityOverviewAsset: () => 'city-far', cityArtWidth: () => 200, SYSTEM_CITY_ARTS: [] },
        './GateGeometry': { GATE_ART: 'gate', BRIDGE_ART: 'bridge' },
        './PlayerCityAppearance': { PLAYER_CITY_MAX_LEVEL: 2 },
        './PlayerCityGround': { default: { prepare: async () => {}, releaseArt: name => released.push(name) } },
    }, q.clock);
    const Art = module.default;
    Art.sizes = Object.fromEntries([...module.worldArtNames(), 'city', 'city-far', 'a', 'b'].map(name => [name, [256, 128]]));
    const finish = (name, error) => {
        const index = images.findIndex(image => image.url === `ui/world/${name}/spriteFrame`);
        assert.ok(index >= 0, `missing request ${name}`);
        const image = images.splice(index, 1)[0], frame = new Frame(name);
        image.callback(error || null, error ? null : frame); return frame;
    };
    return { ...q, cc, Art, module, images, finish, released };
}
let count = 0;
async function test(name, run) { await run(); console.log('PASS ' + name); count++; }
(async () => {
    await test('queue caps concurrency, deduplicates and promotes foreground requests', async () => {
        const { Queue, Priority, clock } = queueFixture(), started = [], resolvers = [];
        Queue.pauseBackground(800);
        const background = Queue.request('background', () => new Promise(resolve => { started.push('background'); resolvers.push(resolve); }), Priority.Background);
        assert.equal(background, Queue.request('background', () => { throw Error('duplicate'); }, Priority.Interaction));
        for (let i = 0; i < 5; i++) Queue.request('visible' + i, () => new Promise(resolve => { started.push(i); resolvers.push(resolve); }));
        await settle(clock);
        assert.equal(started[0], 'background'); assert.equal(started.length, 4); assert.equal(Queue.statistics.running, 4);
        while (Queue.statistics.running || Queue.statistics.queued) { resolvers.splice(0).forEach(resolve => resolve()); await settle(clock); }
        assert.equal(started.length, 6);
    });
    await test('background stays paused during input and queued cancellation can retry', async () => {
        const { Queue, Priority, clock } = queueFixture(); let started = 0;
        Queue.pauseBackground(800);
        const pending = Queue.request('idle', async () => ++started, Priority.Background);
        const cancelled = assert.rejects(pending, /idle/);
        await settle(clock); assert.equal(started, 0);
        Queue.cancel('idle'); await cancelled;
        const retry = Queue.request('idle', async () => ++started, Priority.Background);
        clock.tick(801); await settle(clock); assert.equal(await retry, 1);
    });
    await test('background work is paced, one at a time, while interaction bypasses the pause', async () => {
        const { Queue, Priority, clock } = queueFixture(), started = [];
        let finishFirst;
        const first = Queue.request('first', () => new Promise(resolve => { started.push('first'); finishFirst = resolve; }), Priority.Background);
        const next = Queue.request('next', async () => { started.push('next'); }, Priority.Background);
        const promoted = Queue.request('promoted', async () => { started.push('promoted'); }, Priority.Background);
        await settle(clock); assert.deepEqual(started, ['first']); assert.equal(Queue.statistics.backgroundRunning, 1);
        Queue.pauseBackground(800);
        assert.equal(Queue.request('promoted', () => { throw Error('duplicate'); }, Priority.Interaction), promoted);
        Queue.cancel('promoted', Priority.Background);
        await settle(clock); await promoted; assert.deepEqual(started, ['first', 'promoted']);
        finishFirst(); await first; await settle(clock);
        clock.tick(799); await settle(clock); assert.equal(started.length, 2);
        clock.tick(1); await settle(clock); await next; assert.equal(started[2], 'next');
        let more = false;
        const last = Queue.request('last', async () => { more = true; }, Priority.Background);
        clock.tick(119); await settle(clock); assert.equal(more, false);
        clock.tick(1); await settle(clock); await last; assert.equal(more, true);
    });
    await test('panel preparation precedes bulk artwork but stays serialized and yields to clicks', async () => {
        const { Queue, Priority, clock } = queueFixture(), started = [];
        Queue.pauseBackground(1500);
        Queue.request('bulk', async () => { started.push('bulk'); }, Priority.Background);
        Queue.request('view', async () => { started.push('view'); }, Priority.Warmup);
        Queue.request('click', async () => { started.push('click'); }, Priority.Interaction);
        await settle(clock); assert.deepEqual(started, ['click']);
        clock.tick(1500); await settle(clock); assert.deepEqual(started, ['click', 'view']);
        clock.tick(119); await settle(clock); assert.equal(started.length, 2);
        clock.tick(1); await settle(clock); assert.deepEqual(started, ['click', 'view', 'bulk']);
    });
    await test('recycled sprite ignores old artwork completion and shares the replacement request', async () => {
        const f = artFixture(), first = new Sprite(), second = new Sprite(); let old = 0, current = 0;
        f.Art.apply(first, 'a', 100, () => old++); await settle(f.clock);
        f.Art.apply(first, 'b', 100, () => current++); f.Art.apply(second, 'b', 100); await settle(f.clock);
        assert.equal(f.images.length, 2);
        f.finish('a'); await settle(f.clock);
        assert.equal(old, 0); assert.equal(first.spriteFrame, null);
        const frame = f.finish('b'); await settle(f.clock);
        assert.equal(first.spriteFrame, frame); assert.equal(second.spriteFrame, frame); assert.equal(current, 1);
        assert.equal(frame.refs, 1); assert.equal(f.Art.visibleState.pending, 0);
    });
    await test('inactive strategic markers defer textures until visible; pooled nodes clear bindings', async () => {
        const f = artFixture(), sprite = new Sprite(); sprite.node.activeInHierarchy = false;
        f.Art.apply(sprite, 'a', 80); await settle(f.clock); assert.equal(f.images.length, 0);
        sprite.node.activeInHierarchy = true; f.Art.updateStreaming(); await settle(f.clock);
        assert.equal(f.Art.visibleState.pending, 1);
        f.Art.unbindTree({ getComponentsInChildren: () => [sprite] }); f.finish('a'); await settle(f.clock);
        assert.equal(sprite.spriteFrame, null); assert.equal(f.Art.visibleState.pending, 0);
    });
    await test('idle textures release once; active shared users and core terrain remain pinned', async () => {
        const f = artFixture(), first = new Sprite(), second = new Sprite();
        f.Art.apply(first, 'a', 80); f.Art.apply(second, 'a', 80); await settle(f.clock);
        const frame = f.finish('a'); await settle(f.clock);
        first.node.activeInHierarchy = false; f.clock.tick(31000); f.Art.updateStreaming();
        assert.equal(frame.isValid, true);
        second.node.activeInHierarchy = false; f.clock.tick(31000); f.Art.updateStreaming();
        assert.equal(frame.isValid, false); assert.equal(frame.refs, 0); assert.equal(first.spriteFrame, null);
        assert.deepEqual(f.released, ['a']);
        first.node.activeInHierarchy = true; f.Art.updateStreaming(); await settle(f.clock);
        f.finish('a'); await settle(f.clock); assert.ok(first.spriteFrame.isValid);
    });
    await test('visible failure is reported, retry recovers and geometry is available before the image', async () => {
        const f = artFixture(), sprite = new Sprite(); f.Art.apply(sprite, 'a', 100); await settle(f.clock);
        assert.deepEqual(f.Art.size('a'), { width: 256, height: 128 });
        f.finish('a', new Error('missing')); await settle(f.clock);
        assert.equal(f.Art.visibleState.error.message, 'missing');
        f.clock.tick(5001); f.Art.updateStreaming(); await settle(f.clock);
        f.finish('a'); await settle(f.clock); assert.equal(f.Art.visibleState.error, null); assert.ok(sprite.spriteFrame);
    });
    await test('lazy panels cancel stale opens, retry failure and release their held references', async () => {
        const q = queueFixture(), requests = [], scheduled = [], host = { isValid: true }, owner = { isValid: true, scheduleOnce: run => scheduled.push(run) };
        const bundle = { load(name, type, callback) { requests.push({ name, callback }); } };
        const { default: Loader, LAZY_PANELS } = load('assets/scripts/map/ui/LazyPanelLoader.ts', {
            cc: { isValid: value => !!value && value.isValid !== false, Prefab: Frame, assetManager: { getBundle: () => bundle } },
            'cc/env': { EDITOR: false, PREVIEW: false },
            '../../core/AssetLoadQueue': q.module, '../../utils/EventMgr': { EventMgr: { emit() {} } }, '../../common/LogicEvent': { LogicEvent: {} },
        }, q.clock);
        const loader = new Loader(owner, () => host); let opened = '';
        loader.defer('generalPrefab', () => opened = 'general'); await settle(q.clock);
        loader.defer('skillPrefab', () => opened = 'skill'); await settle(q.clock);
        const frames = requests.splice(0).map(request => { const frame = new Frame(request.name); request.callback(null, frame); return frame; });
        await settle(q.clock); scheduled.splice(0).forEach(run => run()); assert.equal(opened, 'skill');
        assert.equal(frames[0].refs, 1); assert.equal(frames[1].refs, 1);
        opened = ''; loader.defer('unionPrefab', () => opened = 'union'); await settle(q.clock);
        loader.cancel(); requests.shift().callback(null, new Frame('Union')); await settle(q.clock);
        scheduled.splice(0).forEach(run => run()); assert.equal(opened, '');
        const failed = loader.load('settingPrefab'); const failure = assert.rejects(failed, /network/);
        await settle(q.clock); requests.shift().callback(new Error('network')); await failure;
        const retried = loader.load('settingPrefab'); await settle(q.clock);
        requests.shift().callback(null, new Frame('Setting')); await settle(q.clock); await retried;
        loader.dispose(); await settle(q.clock); frames.forEach(frame => assert.equal(frame.refs, 0));
        const prefab = JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes/MapUIScene.prefab'), 'utf8')).find(value => value.generalPrefab !== undefined);
        for (const [key, [name, , uuid]] of Object.entries(LAZY_PANELS)) {
            assert.equal(prefab[key], null, key + ' still pulls startup dependencies');
            assert.ok(fs.existsSync(path.join(root, 'assets/prefab', name + '.prefab')), name);
            assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'assets/prefab', name + '.prefab.meta'), 'utf8')).uuid, uuid);
        }
        const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets/prefab.meta'), 'utf8'));
        assert.equal(meta.userData.bundleName, 'ui-panels'); assert.equal(meta.userData.isBundle, true);
    });
    await test('Game View and browser preview load real prefab IDs without requesting a built bundle', async () => {
        for (const env of [{ EDITOR: true, PREVIEW: false }, { EDITOR: false, PREVIEW: true }]) {
            const q = queueFixture(), owner = { isValid: true }, requests = [];
            const { default: Loader, LAZY_PANELS } = load('assets/scripts/map/ui/LazyPanelLoader.ts', {
                cc: { isValid: value => !!value && value.isValid !== false, Prefab: Frame,
                    assetManager: { loadAny(uuid, callback) { requests.push(uuid); callback(null, new Frame('GeneralList')); } } },
                'cc/env': env, '../../core/AssetLoadQueue': q.module,
                '../../utils/EventMgr': { EventMgr: { emit() {} } }, '../../common/LogicEvent': { LogicEvent: {} },
            }, q.clock);
            const loader = new Loader(owner, () => owner), pending = loader.load('generalPrefab');
            await settle(q.clock); await pending;
            assert.deepEqual(requests, [LAZY_PANELS.generalPrefab[2]]);
            assert.equal(owner.generalPrefab.refs, 1);
        }
    });
    await test('login prepares inactive panel nodes once and keeps them ready after idle time', async () => {
        const q = queueFixture(), requests = [], frames = [], owner = { isValid: true }, nodes = [], prepared = [];
        const host = { isValid: true, addChild(node) { assert.equal(node.active, false, 'warmup must never activate a window'); nodes.push(node); } };
        const { default: Loader, LAZY_PANELS } = load('assets/scripts/map/ui/LazyPanelLoader.ts', {
            cc: { isValid: value => !!value && value.isValid !== false, Prefab: Frame,
                instantiate: frame => ({ name: frame.name, isValid: true, active: true, activeInHierarchy: false,
                    destroy() { this.isValid = false; } }),
                assetManager: { getBundle: () => ({ load(name, type, callback) { requests.push({ name, callback }); } }) } },
            'cc/env': { EDITOR: false, PREVIEW: false }, '../../core/AssetLoadQueue': q.module,
            '../../utils/EventMgr': { EventMgr: { emit() {} } }, '../../common/LogicEvent': { LogicEvent: {} },
        }, q.clock);
        const loader = new Loader(owner, () => host);
        const prepare = (key, node) => { assert.equal(node.active, false); prepared.push(key); node.firstViewReady = true; };
        loader.prefetchAll(prepare); loader.prefetchAll(prepare);
        await settle(q.clock); assert.equal(requests.length, 0);
        q.clock.tick(1500); await settle(q.clock); assert.equal(requests.length, 1); assert.equal(requests[0].name, 'GeneralList');
        for (let i = 0; i < Object.keys(LAZY_PANELS).length; i++) {
            assert.equal(requests.length, 1, 'only one background prefab in flight');
            const request = requests.shift(), frame = new Frame(request.name); frames.push(frame);
            request.callback(null, frame); await settle(q.clock);
            assert.equal(requests.length, 0); q.clock.tick(120); await settle(q.clock);
        }
        for (let i = 0; i < 20 && q.Queue.statistics.queued; i++) { q.clock.tick(120); await settle(q.clock); }
        assert.equal(frames.length, Object.keys(LAZY_PANELS).length);
        assert.equal(q.Queue.statistics.running, 0); assert.equal(q.Queue.statistics.queued, 0);
        assert.equal(nodes.length, frames.length); assert.equal(new Set(prepared).size, frames.length);
        assert.equal(prepared.length, frames.length, 'duplicate warmup must not rebuild');
        const generalNode = owner._generalNode;
        for (const [key, [, nodeKey]] of Object.entries(LAZY_PANELS)) {
            assert.equal(owner[key].refs, 1); assert.equal(owner[nodeKey].firstViewReady, true);
            assert.equal(owner[nodeKey].active, false);
        }
        q.clock.tick(31000); loader.sweep();
        assert.equal(owner._generalNode, generalNode); assert.equal(generalNode.isValid, true);
        assert.equal(owner.generalPrefab.isValid, true);
        assert.equal(loader.defer('generalPrefab', () => { throw Error('warm cache needs no delayed callback'); }), false);
        await settle(q.clock); assert.equal(requests.length, 0);
        loader.dispose(); await settle(q.clock); frames.forEach(frame => assert.equal(frame.refs, 0));
    });
    await test('background view preparation can be cancelled on logout and retries a failure', async () => {
        const q = queueFixture(), owner = { isValid: true }, host = { isValid: true };
        const { default: Loader } = load('assets/scripts/map/ui/LazyPanelLoader.ts', {
            cc: { isValid: value => !!value && value.isValid !== false }, 'cc/env': {},
            '../../core/AssetLoadQueue': q.module, '../../utils/EventMgr': {}, '../../common/LogicEvent': {},
        }, q.clock);
        const loader = new Loader(owner, () => host); let calls = 0;
        const failed = loader.warmView('inventory', () => { calls++; throw new Error('fixture'); });
        const rejected = assert.rejects(failed, /fixture/); await settle(q.clock); await rejected;
        const retry = loader.warmView('inventory', () => { calls++; });
        assert.equal(loader.warmView('inventory', () => { throw Error('duplicate'); }), retry);
        q.clock.tick(120); await settle(q.clock); await retry; assert.equal(calls, 2);
        await loader.warmView('inventory', () => { throw Error('already prepared'); });
        const late = loader.warmView('cityBuildings', () => { throw Error('logout must cancel'); });
        const cancelled = assert.rejects(late, /panel-view/); loader.dispose(); await settle(q.clock); await cancelled;
        assert.equal(q.Queue.statistics.queued, 0);
    });
    await test('early click shares the queued preload and logout cancels remaining background panels', async () => {
        const q = queueFixture(), requests = [], scheduled = [], host = { isValid: true };
        const owner = { isValid: true, scheduleOnce: run => scheduled.push(run) };
        const { default: Loader } = load('assets/scripts/map/ui/LazyPanelLoader.ts', {
            cc: { isValid: value => !!value && value.isValid !== false, Prefab: Frame,
                assetManager: { getBundle: () => ({ load(name, type, callback) { requests.push({ name, callback }); } }) } },
            'cc/env': { EDITOR: false, PREVIEW: false }, '../../core/AssetLoadQueue': q.module,
            '../../utils/EventMgr': { EventMgr: { emit() {} } }, '../../common/LogicEvent': { LogicEvent: {} },
        }, q.clock);
        const loader = new Loader(owner, () => host); let opens = 0;
        loader.prefetchAll(); loader.defer('unionPrefab', () => opens++); await settle(q.clock);
        assert.deepEqual(requests.map(r => r.name), ['Union']);
        const frame = new Frame('Union'); requests.shift().callback(null, frame); await settle(q.clock);
        scheduled.splice(0).forEach(run => run()); assert.equal(opens, 1); assert.equal(frame.refs, 1);
        q.clock.tick(1500); await settle(q.clock); assert.equal(requests.length, 1);
        loader.dispose(); await settle(q.clock);
        const late = new Frame('late'); requests.shift().callback(null, late); await settle(q.clock);
        q.clock.tick(31000); await settle(q.clock);
        assert.equal(requests.length, 0); assert.equal(late.refs, 0); assert.equal(frame.refs, 0);
        assert.equal(q.Queue.statistics.queued, 0); assert.equal(owner.generalPrefab, undefined);
    });
    await test('a stalled production bundle times out without blocking later requests', async () => {
        const q = queueFixture(), owner = { isValid: true };
        const { default: Loader } = load('assets/scripts/map/ui/LazyPanelLoader.ts', {
            cc: { isValid: value => !!value, Prefab: Frame, assetManager: { getBundle: () => null, loadBundle() {} } },
            'cc/env': { EDITOR: false, PREVIEW: false }, '../../core/AssetLoadQueue': q.module,
            '../../utils/EventMgr': { EventMgr: { emit() {} } }, '../../common/LogicEvent': { LogicEvent: {} },
        }, q.clock);
        const pending = new Loader(owner, () => owner).load('generalPrefab');
        const timeout = assert.rejects(pending, /界面加载超时/); await settle(q.clock);
        q.clock.tick(15001); await settle(q.clock); await timeout;
        assert.equal(q.Queue.statistics.running, 0); assert.equal(owner.generalPrefab, undefined);
    });
    await test('streaming metadata matches source geometry and image dimensions exactly', async () => {
        const geometry = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/map-geometry.json'), 'utf8'));
        const tmx = fs.readFileSync(path.join(root, 'assets/resources/world/map.tmx'), 'utf8');
        assert.equal(geometry.header, tmx.match(/<map\b[^>]*>/)[0]);
        const sizes = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/art-sizes.json'), 'utf8'));
        for (const [name, [width, height]] of Object.entries(sizes)) {
            const png = fs.readFileSync(path.join(root, 'assets/resources/ui/world', name + '.png'));
            assert.equal(png.readUInt32BE(16), width, name); assert.equal(png.readUInt32BE(20), height, name);
        }
        const generated = require('../prepare-streaming-data.cjs').buildStreamingData(root);
        const boot = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/boot-configs.json'), 'utf8'));
        assert.equal(boot.version, 1);
        assert.deepEqual(Object.keys(boot.tables), Object.keys(generated['boot-configs.json'].tables));
        for (const name of Object.keys(boot.tables)) {
            assert.ok(JSON.stringify(boot.tables[name]) === JSON.stringify(generated['boot-configs.json'].tables[name]), name + ' has stale boot data');
        }
    });
    await test('packed million-cell map preserves all types, levels, empty cells and city coordinates', async () => {
        const clock = new Clock();
        const { default: Proxy } = load('assets/scripts/map/MapProxy.ts', {
            cc: {}, './MapUtil': { default: {} }, '../utils/EventMgr': { EventMgr: { emit() {} } },
            '../common/LogicEvent': { LogicEvent: {} }, './CityFootprint': { cityFootprintRadius: () => 1 },
        }, clock);
        const original = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/mapRes_0.json'), 'utf8'));
        const packed = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/boot-configs.json'), 'utf8')).tables.mapRes_0;
        const a = new Proxy(), b = new Proxy(); a.initMapResConfig(original); b.initMapResConfig(packed);
        assert.equal(a._resourceWidth, b._resourceWidth);
        assert.deepEqual(b._resourceTypes, a._resourceTypes);
        assert.deepEqual(b._resourceLevels, a._resourceLevels);
        assert.deepEqual(b._emptyCells, a._emptyCells);
        assert.deepEqual(b._mapSysCityResDatas, a._mapSysCityResDatas);
        const before = b._resourceTypes;
        assert.throws(() => b.initMapResConfig({ ...packed, cells: '?' + packed.cells.slice(1) }), /编码损坏/);
        assert.equal(b._resourceTypes, before, 'bad data must not replace the current map');
        assert.throws(() => b.initMapResConfig({ ...packed, cells: packed.cells.slice(0, -1) }), /格式无效/);
        const repeated = [...b.initMapResConfigBatched(packed)]; assert.deepEqual(repeated, [1]);
        assert.equal(b._resourceTypes, before, 'repeat login reuses the validated byte index');
        assert.ok(JSON.stringify(packed).length < JSON.stringify(original).length * .3);
    });
    console.log(count + ' streaming regressions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
