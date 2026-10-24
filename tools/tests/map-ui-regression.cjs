// Run with Node (or Creator's ELECTRON_RUN_AS_NODE=1) and the Creator TypeScript package path.
// These tests exercise project logic with small engine doubles; they do not measure rendering FPS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
let passed = 0;
function test(name, run) {
    run();
    passed++;
    console.log(`PASS ${name}`);
}
class Component { isValid = true; }
class Node {
    parent = null;
    isValid = true;
    active = true;
    components = new Map();
    getComponent(type) { return this.components.get(type); }
    setPosition(position) { this.position = position; }
}
class Sprite extends Component { spriteFrame = null; }
class SpriteFrame { constructor(name) { this.name = name; this.isValid = true; } }
class NodePool {
    nodes = [];
    puts = 0;
    put(node) {
        assert.ok(node, 'cannot pool a missing node');
        assert.ok(!this.nodes.includes(node), 'node pooled twice');
        node.parent = null;
        this.nodes.push(node);
        this.puts++;
    }
    get() { return this.nodes.pop() || null; }
    size() { return this.nodes.length; }
    clear() { this.nodes.length = 0; }
}
class Vec2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    clone() { return new Vec2(this.x, this.y); }
    add(p) { this.x += p.x; this.y += p.y; return this; }
    subtract(p) { this.x -= p.x; this.y -= p.y; return this; }
}
const cc = {
    Component, Node, Sprite, SpriteFrame, NodePool, Vec2, Vec3: Vec2,
    Prefab: class {}, TiledMap: class {}, UITransform: class {},
    size: (width, height) => ({ width, height }), v2: (x, y) => new Vec2(x, y),
    instantiate: () => new Node(), isValid: value => !!value && value.isValid !== false,
    view: { getVisibleSize: () => ({ width: 1280, height: 720 }) },
    _decorator: { ccclass: () => type => type, property: () => () => {} },
};
function load(file, imports = {}, clock = Date, engine = cc) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    }, fileName: file, reportDiagnostics: true });
    assert.equal(result.diagnostics.length, 0, `transpile errors in ${file}`);
    const mod = { exports: {} };
    const localRequire = id => {
        if (id === 'cc') return engine;
        if (id === './CityFootprint') return load('assets/scripts/map/CityFootprint.ts');
        if (Object.hasOwn(imports, id)) return imports[id];
        throw new Error(`Unmocked dependency ${file}: ${id}`);
    };
    new Function('require', 'module', 'exports', 'Date', result.outputText)(localRequire, mod, mod.exports, clock);
    return mod.exports;
}
const asDefault = value => ({ default: value });
const { EventMgr } = load('assets/scripts/utils/EventMgr.ts');
const { LogicEvent } = load('assets/scripts/common/LogicEvent.ts');
const { CoreEvent } = load('assets/scripts/core/CoreEvent.ts');
const portraitPaths = load('assets/scripts/general/GeneralPortrait.ts');
const shared = { '../utils/EventMgr': { EventMgr }, '../common/LogicEvent': { LogicEvent } };
const command = { proxy: null };
const MapCommand = { getInstance: () => command };
const MapUtil = load('assets/scripts/map/MapUtil.ts', { './MapCommand': asDefault(MapCommand) }).default;
MapUtil.initMapConfig({
    node: { getComponent: () => ({ width: 40000, height: 20000, anchorX: 0.5, anchorY: 0.5 }) },
    getTileSize: () => ({ width: 200, height: 100 }), getMapSize: () => ({ width: 200, height: 200 }),
});
const proxyModule = load('assets/scripts/map/MapProxy.ts', { ...shared, './MapUtil': asDefault(MapUtil) });
const { MapResType } = proxyModule;
const proxy = new proxyModule.default();
proxy.initData();
command.proxy = proxy;
const BaseLayer = load('assets/scripts/map/MapBaseLayerLogic.ts', { './MapCommand': asDefault(MapCommand) }).default;

test('portrait clears the old image and ignores out-of-order loads, including cached switches', () => {
    const cache = new Map();
    const requests = [];
    const portraitProxy = {
        getGeneralCfg: id => ({ resource: `card_${id}_v2.png` }),
        getGeneralTex: id => cache.get(id), setGeneralTex: (id, frame) => cache.set(id, frame),
        loadGeneralTex: id => ({ then: handler => requests.push({
            url: portraitPaths.getGeneralPortraitPath(`ui/hero/card_${id}_v2.png`),
            callback: (error, frame) => {
                if (error) return handler(null);
                cache.set(id, frame);
                handler(frame);
            },
        }) }),
    };
    const Head = load('assets/scripts/map/ui/GeneralHeadLogic.ts', {
        '../../general/GeneralCommand': asDefault({ getInstance: () => ({ proxy: portraitProxy }) }),
        '../../general/GeneralPortrait': portraitPaths,
    }, Date, { ...cc, resources: { load: (url, type, callback) => requests.push({ url, callback }) } }).default;
    const head = new Head();
    const sprite = new Sprite();
    head.node = new Node();
    head.node.components.set(Sprite, sprite);
    sprite.spriteFrame = new SpriteFrame('old prefab image');
    head.setHeadId(1001);
    assert.equal(sprite.spriteFrame, null);
    assert.equal(requests[0].url, 'ui/hero/card_1001_v2/spriteFrame');
    head.setHeadId(1022);
    const newer = new SpriteFrame('1022');
    requests[1].callback(null, newer);
    requests[0].callback(null, new SpriteFrame('1001'));
    assert.equal(sprite.spriteFrame, newer);
    head.setHeadId(1023);
    head.setHeadId(1001);
    requests[2].callback(null, new SpriteFrame('1023'));
    assert.equal(sprite.spriteFrame, cache.get(1001));
    assert.equal(requests.length, 3, 'cached portrait must not reload');
    head.setHeadId(1024);
    head.onDestroy();
    requests[3].callback(null, new SpriteFrame('1024'));
    assert.equal(sprite.spriteFrame, null, 'destroyed component must not be updated');
});

test('every configured hero resolves to a distinct imported UI portrait', () => {
    const heroes = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/Hero.json'), 'utf8'));
    const paths = new Set();
    const uuids = new Set();
    for (const hero of heroes) {
        const resource = portraitPaths.getGeneralPortraitPath(hero.Icon);
        assert.ok(resource.startsWith('ui/hero/'));
        const filename = path.join(root, 'assets/resources', resource.replace(/\/spriteFrame$/, '.png'));
        assert.ok(fs.existsSync(filename), `missing portrait: ${hero.name}`);
        const meta = JSON.parse(fs.readFileSync(filename + '.meta', 'utf8'));
        assert.ok(meta.imported && meta.importer === 'image');
        assert.ok(Object.values(meta.subMetas).some(sub => sub.importer === 'sprite-frame'));
        paths.add(resource);
        uuids.add(meta.uuid);
    }
    assert.equal(paths.size, heroes.length);
    assert.equal(uuids.size, heroes.length);
    assert.equal(portraitPaths.getGeneralPortraitPath(), '', '配置缺少Icon时不猜图片路径');
    console.log(`Verified ${heroes.length}/${heroes.length} configured portrait files.`);
});

test('event unsubscription removes only the intended handlers and releases target references', () => {
    const targets = [{}, {}, {}, {}];
    const calls = [];
    const handlers = targets.map((target, i) => () => calls.push(i));
    targets.forEach((target, i) => EventMgr.on('regression', handlers[i], target));
    EventMgr.off('regression', handlers[1], targets[1]);
    EventMgr.emit('regression');
    assert.deepEqual(calls, [0, 2, 3]);
    calls.length = 0;
    EventMgr.targetOff(targets[2]);
    EventMgr.emit('regression');
    assert.deepEqual(calls, [0, 3]);
    targets.forEach(target => EventMgr.targetOff(target));
    assert.equal(EventMgr.events.has('regression'), false);
    targets.forEach(target => assert.equal(EventMgr.targetInName.has(target), false));
});

function layer() {
    const result = new BaseLayer();
    result.parentLayer = new Node();
    result.setItemData = (node, data) => { node.data = data; };
    result.onLoad();
    return result;
}
test('area retirement does not synchronously pool nodes; re-entry reuses each node once', () => {
    const current = layer();
    current.addArea(1);
    const originals = Array.from({ length: 100 }, (_, id) => current.addItem(1, { id }));
    current.removeArea(1);
    assert.equal(current._itemPool.puts, 0);
    assert.equal(current.getItem(1, 0), null);
    current.addArea(1);
    assert.equal(current.addItem(1, { id: 50, value: 'updated' }), originals[50]);
    assert.equal(originals[50].data.value, 'updated');
    assert.equal(current.recycleOneItem(), true);
    assert.equal(current._itemPool.puts, 1);
    current.removeArea(1);
    let drained = 0;
    while (current.recycleOneItem()) drained++;
    assert.equal(drained, 99);
    assert.equal(current._itemPool.size(), 100);
    assert.equal(current._retiredItems.size, 0);
    assert.equal(current.removeItem(999, 0), false, 'late network deletion is harmless');
});

test('new areas reuse retired nodes instead of growing the live allocation on repeated jumps', () => {
    const current = layer();
    const allNodes = new Set();
    for (let area = 0; area < 40; area++) {
        if (area) current.removeArea(area - 1);
        current.addArea(area);
        for (let id = 0; id < 100; id++) allNodes.add(current.addItem(area, { id }));
    }
    assert.equal(allNodes.size, 100);
    assert.equal(current._itemMap.size, 1);
    current.removeArea(39);
    while (current.recycleOneItem()) {}
    assert.equal(current._itemPool.size(), 100);
});

test('area visibility stays within map boundaries and old areas leave on far jumps', () => {
    const owner = {};
    const visible = new Set();
    EventMgr.on(LogicEvent.mapShowAreaChange, (point, center, add, remove) => {
        remove.forEach(id => visible.delete(id));
        add.forEach(id => visible.add(id));
    }, owner);
    for (const [x, y] of [[1, 1], [16, 24], [155, 155], [1, 195], [199, 1], [100, 100], [110, 100], [1, 1]]) {
        const point = new Vec2(x, y);
        proxy.setCurCenterPoint(point, MapUtil.mapCellToPixelPoint(point));
        // 流式区域跟随实际视野和大城预留范围，不再固定为九宫格。
        assert.deepEqual([...visible].sort((a, b) => a - b), [...proxy.visibleAreaIds].sort((a, b) => a - b));
        assert.ok(visible.has(MapUtil.getAreaIdByCellPoint(x, y)));
        assert.ok([...visible].every(id => id >= 0 && id < 400));
        assert.ok(visible.size < 60, '远跳后必须清掉旧视野，不能不断累积区域');
        assert.equal(new Set(proxy.qryAreaIds).size, proxy.qryAreaIds.length);
        assert.ok(proxy.qryAreaIds.every(id => visible.has(id)));
    }
    EventMgr.targetOff(owner);
});

const BuildTag = load('assets/scripts/map/entries/BuildTagLogic.ts', {
    '../MapCommand': asDefault(MapCommand),
}).default;
const TagLayer = load('assets/scripts/map/MapBuildTagLogic.ts', {
    ...shared, './entries/BuildTagLogic': asDefault(BuildTag), './MapBaseLayerLogic': asDefault(BaseLayer),
    './MapUtil': asDefault(MapUtil), './MapProxy': proxyModule,
}).default;
test('adding/removing a bookmark updates visible and retiring areas without per-cell listeners', () => {
    const tags = new TagLayer();
    tags.parentLayer = new Node();
    tags.setItemData = (node, data) => { node.data = data; };
    tags.onLoad();
    const id = MapUtil.getIdByCellPoint(12, 12);
    const area = MapUtil.getAreaIdByCellPoint(12, 12);
    const cells = Array.from({ length: 200 * 200 }, () => [0, 0]);
    cells[id] = [MapResType.WOOD, 2];
    proxy.initMapResConfig({ w: 200, h: 200, list: cells });
    tags.addArea(area);
    assert.equal(tags._itemMap.get(area).size, 0);
    proxy.updateMapPosTags([{ x: 12, y: 12, name: 'test' }]);
    EventMgr.emit(LogicEvent.updateTag);
    assert.ok(tags.getItem(area, id));
    assert.equal(EventMgr.events.get(LogicEvent.updateTag).length, 1);
    tags.removeArea(area);
    proxy.updateMapPosTags([]);
    EventMgr.emit(LogicEvent.updateTag);
    assert.equal(tags._retiredItems.size, 0);
    tags.addArea(area);
    assert.equal(tags.getItem(area, id), null);
    tags.onDestroy();
});

let now = 0;
const sceneImports = { ...shared, '../core/CoreEvent': { CoreEvent }, '../map/MapProxy': proxyModule,
    '../map/MapCommand': asDefault(MapCommand), '../map/MapUtil': asDefault(MapUtil) };
for (const name of ['MapBaseLayerLogic', 'MapResBuildLogic', 'MapBuildTipsLogic', 'MapCityLogic', 'MapLogic',
    'MapResLogic', 'MapFacilityBuildLogic', 'MapBuildTagLogic', 'MapSysCityLogic', 'WorldMapArt', 'WorldLandscape', 'WorldCampaign']) {
    sceneImports[`../map/${name}`] = asDefault(class {});
}
const MapScene = load('assets/scripts/scene/MapScene.ts', sceneImports, { now: () => now }).default;
test('all map layers share a bounded recycle budget and still populate cells', () => {
    const scene = new MapScene();
    scene._cmd = command;
    scene._ready = true;
    const counts = Array(7).fill(0);
    scene._recycleLayers = counts.map((_, i) => ({ recycleOneItem: () => { counts[i]++; now += 0.1; return true; } }));
    scene._pendingAreas = [{ id: 1, x: 0, y: 0, startY: 0, endX: 10, endY: 10 }];
    let cells = 0;
    scene.addMapCell = () => { cells++; now += 0.2; };
    now = 0;
    scene.update();
    assert.ok(counts.every(count => count > 0), 'each layer gets recycling time');
    assert.ok(counts.reduce((a, b) => a + b) <= 32);
    assert.ok(cells > 0 && cells <= 16, 'creation must not be starved');
    assert.ok(now < 4.21, 'budget may overrun by only the current unit of work');
    assert.equal(scene._failed, false);
});
test('empty cells create no invisible resource/tag nodes while cities and real resources remain', () => {
    const scene = new MapScene();
    const calls = [];
    scene._itemLayers = Object.fromEntries(['res', 'build', 'facility', 'tag', 'tips', 'city', 'sysCity']
        .map(name => [name, { addItem: () => calls.push(name) }]));
    let type = 0, marked = false;
    scene._cmd = { proxy: { getResData: () => ({ id: 1, type }), isPosTag: () => marked, getSysCityResData: () => null },
        buildProxy: { getBuild: () => null }, cityProxy: { getCity: () => null } };
    scene.addMapCell(1, 1, 1);
    assert.deepEqual(calls, []);
    type = MapResType.SYS_CITY;
    scene.addMapCell(1, 1, 1);
    assert.deepEqual(calls.splice(0), ['sysCity']);
    type = MapResType.WOOD;
    marked = true;
    scene.addMapCell(1, 1, 1);
    assert.deepEqual(calls, ['res', 'tag']);
});
console.log(`${passed} regression groups passed.`);
