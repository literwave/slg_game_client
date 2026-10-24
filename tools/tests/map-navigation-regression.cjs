// Run with Creator's ELECTRON_RUN_AS_NODE=1 and its TypeScript module path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
let count = 0;
function test(name, run) { run(); console.log(`PASS ${name}`); count++; }
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`); }
class Vec2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; return this; }
    clone() { return new Vec2(this.x, this.y); }
    add(p) { this.x += p.x; this.y += p.y; return this; }
    subtract(p) { this.x -= p.x; this.y -= p.y; return this; }
}
class Vec3 extends Vec2 {
    constructor(x = 0, y = 0, z = 0) { super(x, y); this.z = z; }
    set(x, y, z) { super.set(x, y); this.z = z; return this; }
}
class Node {
    static EventType = { TRANSFORM_CHANGED: 'transform', MOUSE_WHEEL: 'wheel', TOUCH_START: 'start',
        TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' };
    isValid = true;
    position = new Vec3();
    scale = new Vec3(1, 1, 1);
    components = new Map();
    children = [];
    getChildByName(name) { return this.children.find(n => n.name === name); }
    addChild(child) { this.children.push(child); child.parent = this; }
    addComponent(Type) {
        if (Type === cc.Graphics) assert.ok(!this.components.has(cc.Sprite), 'Cocos forbids two UI renderers on one node');
        const comp = new Type(); comp.node = this; this.components.set(Type, comp);
        if (Type === cc.Graphics && !this.components.has(UITransform)) this.addComponent(UITransform);
        return comp;
    }
    getComponent(type) { return this.components.get(type); }
    setPosition(x, y, z) { this.position = typeof x === 'number' ? new Vec3(x, y, z) : new Vec3(x.x, x.y, x.z); }
    on() {} off() {} targetOff() {} emit() {}
}
class UITransform {
    constructor(width = 200, height = 100) { this.width = width; this.height = height; this.anchorX = .5; this.anchorY = .5; }
    setContentSize(w, h) { this.width = w; this.height = h; }
}
const size = { width: 1280, height: 720 };
const origin = new Vec2();
const events = [];
const cc = {
    Vec2, Vec3, Node, UITransform, Component: class {}, Camera: class {}, TiledMap: class {},
    Color: class {}, Graphics: class { clear() {} rect(x, y, w, h) { this.rectangle = { x, y, w, h }; } fill() {} },
    Sprite: class { static SizeMode = { CUSTOM: 0 }; enabled = true; },
    size: (width, height) => ({ width, height }), v2: (x, y) => new Vec2(x, y),
    view: { getVisibleSize: () => size, getVisibleOrigin: () => origin, on() {}, off() {} },
    resources: { load() {} },
    _decorator: { ccclass: () => Type => Type, property: (...args) => args.length > 1 ? undefined : () => {} },
};
function load(file, deps = {}) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    }, fileName: file, reportDiagnostics: true });
    assert.equal(result.diagnostics.length, 0);
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', result.outputText)(id => {
        if (id === 'cc') return cc;
        if (id === './CityFootprint') return load('assets/scripts/map/CityFootprint.ts');
        assert.ok(id in deps, `Unexpected import ${id}`);
        return deps[id];
    }, mod, mod.exports);
    return mod.exports.default || mod.exports;
}
const MapUtil = load('assets/scripts/map/MapUtil.ts', { './MapCommand': {} });
const mapNode = new Node();
mapNode.components.set(UITransform, new UITransform(40000, 20000));
const tiledMap = { node: mapNode, getMapSize: () => ({ width: 200, height: 200 }),
    getTileSize: () => ({ width: 200, height: 100 }) };
MapUtil.initMapConfig(tiledMap);
const MapLogic = load('assets/scripts/map/MapLogic.ts', {
    './MapCommand': {}, './MapUtil': { default: MapUtil },
    '../utils/EventMgr': { EventMgr: { on() {}, targetOff() {}, emit: (...args) => events.push(args) } },
    '../common/LogicEvent': { LogicEvent: { touchMap: 'touchMap', moveMap: 'moveMap' } },
});
function makeLogic() {
    const logic = new MapLogic();
    logic._mapCamera = { node: new Node(), orthoHeight: 360, camera: { update() {} } };
    logic._cmd = { proxy: { setCurCenterPoint: (cell, pixel, half) => { logic.lastCenter = { cell, pixel, half }; } } };
    logic.setTiledMap(tiledMap);
    return logic;
}
const touch = (dx = 0, dy = 0, id = 1) => ({ getID: () => id, getUIDelta: () => new Vec2(dx, dy),
    getDelta: () => { throw Error('Raw screen delta must not drive world movement'); } });

test('drag tracks UI units at both zoom levels and after viewport resizing', () => {
    for (const height of [720, 1080]) for (const zoom of [2 / 3, 1, 2, 4]) {
        size.height = height;
        const logic = makeLogic();
        logic._mapCamera.orthoHeight = 360 * zoom;
        logic.onTouchBegan(touch());
        logic.onTouchMove(touch(100, -50));
        logic.onTouchMove(touch(40, 10));
        near(logic._pendingCameraX, -140 * 720 * zoom / height);
        near(logic._pendingCameraY, 40 * 720 * zoom / height);
    }
    size.height = 720;
});

test('camera remains inside the diamond, with all four corner tiles reachable', () => {
    const logic = makeLogic();
    for (const cell of [new Vec2(0, 0), new Vec2(199, 0), new Vec2(199, 199), new Vec2(0, 199)]) {
        const p = logic.toCameraPoint(cell);
        const actual = MapUtil.mapPixelToCellPoint(p);
        assert.deepEqual(actual, cell);
    }
    for (let x = -30000; x <= 30000; x += 1250) for (let y = -16000; y <= 16000; y += 1000) {
        const p = logic.clampCameraPoint(x, y);
        assert.ok(Math.abs(p.x) / 19900 + Math.abs(p.y) / 9950 <= 1 + 1e-9);
        assert.ok(MapUtil.isVaildCellPoint(MapUtil.mapPixelToCellPoint(p)));
    }
    const p = logic.clampCameraPoint(10000, 8000).clone();
    const q = logic.clampCameraPoint(10100, 7950);
    near(q.x - p.x, 100); near(q.y - p.y, -50);
});

test('zoomed clicks use the same world scale as dragging', () => {
    const logic = makeLogic();
    logic.scrollToMapPoint(new Vec2(16, 24));
    logic._mapCamera.orthoHeight = 288;
    origin.set(20, 10);
    const center = logic.viewPointToWorldPoint(new Vec2(660, 370));
    assert.deepEqual(MapUtil.worldPixelToMapCellPoint(center), new Vec2(16, 24));
    const moved = logic.viewPointToWorldPoint(new Vec2(760, 420));
    near(moved.x - center.x, 80); near(moved.y - center.y, 40);
    origin.set(0, 0);
});

const wheel = (delta, x = 820, y = 430) => ({ getScrollY: () => delta, getUILocation: () => new Vec2(x, y) });
test('wheel direction, smooth mouse anchoring and full near-to-overview limits', () => {
    const logic = makeLogic(); logic.scrollToMapPoint(new Vec2(100, 100));
    origin.set(20, 10);
    const anchor = new Vec2(820, 430);
    const world = logic.viewPointToWorldPoint(anchor);
    logic.onMouseWheel(wheel(-600));
    near(logic._mapCamera.orthoHeight, 360);
    logic.update(1 / 60);
    assert.ok(logic._mapCamera.orthoHeight > 360 && logic._mapCamera.orthoHeight < logic._targetHeight);
    for (let i = 0; i < 120; i++) {
        logic.update(1 / 60);
        const after = logic.viewPointToWorldPoint(anchor);
        near(after.x, world.x); near(after.y, world.y);
    }
    for (let i = 0; i < 50; i++) logic.onMouseWheel(wheel(-600));
    for (let i = 0; i < 120; i++) logic.update(1 / 60);
    near(logic._mapCamera.orthoHeight, logic.maximumZoomHeight());
    near(logic.lastCenter.half.y, logic.maximumZoomHeight());
    near(logic._mapCamera.node.position.x, 0);
    for (let i = 0; i < 50; i++) logic.onMouseWheel(wheel(600));
    for (let i = 0; i < 120; i++) logic.update(1 / 60);
    near(logic._mapCamera.orthoHeight, 240);
    assert.ok(MapUtil.isVaildCellPoint(logic.lastCenter.cell));
    origin.set(0, 0);
});

test('tiny trackpad increments work, dragging cancels zoom and city view restores chosen scale', () => {
    const logic = makeLogic(); logic.scrollToMapPoint(new Vec2(100, 100));
    logic.onMouseWheel(wheel(-2));
    for (let i = 0; i < 120; i++) logic.update(1 / 60);
    assert.ok(logic._mapCamera.orthoHeight > 360);
    logic.onMouseWheel(wheel(-600)); logic.update(1 / 60);
    const height = logic._mapCamera.orthoHeight;
    logic.onTouchBegan(touch()); logic.update(1 / 60); near(logic._mapCamera.orthoHeight, height);
    logic.onTouchCancel(touch());
    logic.openCityAbout(); near(logic._mapCamera.orthoHeight, 288);
    logic.closeCityAbout(); near(logic._mapCamera.orthoHeight, height);
});

const MapProxy = load('assets/scripts/map/MapProxy.ts', {
    './MapUtil': { default: MapUtil }, '../utils/EventMgr': { EventMgr: { emit: (...args) => events.push(args) } },
    '../common/LogicEvent': { LogicEvent: { mapEenterChange: 'center', mapShowAreaChange: 'areas' } },
});
const campaign = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));
test('whole-map zoom covers the thousand-cell diamond in landscape and portrait', () => {
    const logic = makeLogic();
    logic._tiledMap = { getMapSize: () => ({ width: 1000, height: 1000 }), getTileSize: () => ({ width: 200, height: 100 }) };
    for (const [w, h] of [[1280, 720], [720, 1280]]) {
        size.width = w; size.height = h;
        const max = logic.maximumZoomHeight();
        assert.ok(max * 2 >= 100000 * 1.15);
        assert.ok(max * 2 * w / h >= 200000 * 1.15);
    }
    size.width = 1280; size.height = 720;
});
test('strategic zoom releases detailed areas and resumes streaming on return', () => {
    const proxy = new MapProxy(); proxy.initData();
    const cell = new Vec2(100, 100), center = MapUtil.mapCellToPixelPoint(cell);
    proxy.setCurCenterPoint(cell, center, new Vec2(640, 360));
    assert.ok(proxy.visibleAreaIds.length > 0);
    proxy.setCurCenterPoint(cell, center, new Vec2(120000, 65000));
    assert.equal(proxy.strategic, true); assert.deepEqual(proxy.visibleAreaIds, []); assert.deepEqual(proxy.qryAreaIds, []);
    proxy.setCurCenterPoint(cell, center, new Vec2(6000, 3000));
    assert.equal(proxy.strategic, true);
    proxy.setCurCenterPoint(cell, center, new Vec2(4200, 2400));
    assert.equal(proxy.strategic, false); assert.ok(proxy.visibleAreaIds.length > 0);
});
const WorldCampaign = load('assets/scripts/map/WorldCampaign.ts', { './WorldMapArt': { default: { campaign } } });
test('campaign requires owned passes for each frontier and closes routes on loss', () => {
    const outer = campaign.gates.find(gate => gate.regions[0] === 0 && gate.regions[1] === 6);
    const inner = campaign.gates.find(gate => gate.regions[0] === 6 && gate.regions[1] === 9);
    const homeOnly = WorldCampaign.reachable(0, () => false);
    assert.deepEqual([...homeOnly], [0]);
    assert.equal(WorldCampaign.canTarget(outer.x, outer.y, homeOnly), true);
    assert.equal(WorldCampaign.canTarget(outer.x, outer.y, homeOnly, false), false);
    assert.equal(WorldCampaign.canTarget(inner.x, inner.y, homeOnly), false);
    const frontier = WorldCampaign.reachable(0, gate => gate.id === outer.id);
    assert.deepEqual([...frontier].sort(), [0, 6]);
    assert.equal(WorldCampaign.canTarget(inner.x, inner.y, frontier), true);
    const capital = WorldCampaign.reachable(0, gate => gate.id === outer.id || gate.id === inner.id);
    assert.equal(WorldCampaign.canTarget(500, 500, capital), true);
    assert.equal(WorldCampaign.canTarget(500, 500, frontier), false);
    assert.equal(WorldCampaign.canTarget(1000, 1, capital), false);
    assert.equal(WorldCampaign.canTarget(1.5, 1, capital), false);
    assert.equal(WorldCampaign.regionAt(999, 999) >= 0, true);
});
test('million-cell table loads atomically and creates only bounded on-demand objects', () => {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/mapRes_0.json'), 'utf8'));
    const proxy = new MapProxy();
    const loading = proxy.initMapResConfigBatched(data);
    loading.next(); assert.equal(proxy.hasResDatas(), false);
    for (const progress of loading) assert.ok(progress > 0 && progress <= 1);
    assert.equal(proxy.hasResDatas(), true);
    assert.equal(proxy._resourceTypes.byteLength + proxy._resourceLevels.byteLength, 2000000);
    const last = proxy.getResData(999999); assert.equal(last.x, 999); assert.equal(last.y, 999);
    assert.equal(proxy.getResData(-1), null); assert.equal(proxy.getResData(1000000), null);
    for (let i = 0; i < 10000; i++) proxy.getResData(i);
    assert.ok(proxy._resourceCache.size <= 8192);
    assert.equal(proxy._mapSysCityResDatas.length, 10);
    assert.ok(data.emptyCells.length > 400000);
    assert.equal(proxy.getResData(data.emptyCells[0]).isEmpty, true);
    assert.equal(proxy.getResData(0).isEmpty, false);
    assert.throws(() => proxy.initMapResConfig({ w: 1000, h: 1000, list: [[55, 1]] }));
    assert.equal(proxy.getResData(999999).y, 999);
});
const MapBuildProxy = load('assets/scripts/map/MapBuildProxy.ts', {
    '../utils/DateUtil': { default: {} }, './MapCommand': { default: {} },
    './MapProxy': { MapResType: { SYS_CITY: 51, SYS_FORTRESS: 50 } },
    './MapUtil': { default: MapUtil },
    '../utils/EventMgr': { EventMgr: { emit: (...args) => events.push(args) } },
    '../common/LogicEvent': { LogicEvent: { updateBuilds: 'builds' } },
});
test('empty authoritative area snapshots remove stale pass ownership', () => {
    const proxy = new MapBuildProxy();
    const id = MapUtil.getIdByCellPoint(10, 10), area = MapUtil.getAreaIdByCellPoint(10, 10);
    proxy._mapBuilds[id] = { rid: 1, unionId: 2 };
    proxy._lastBuildCellIds.set(area, [id]);
    proxy.setMapScanBlock({ mr_builds: [] }, area);
    assert.equal(proxy.getBuild(id), null);
    assert.deepEqual(proxy._lastBuildCellIds.get(area), []);
});
test('zoom alone streams the entire viewport and releases distant areas when zooming back in', () => {
    const proxy = new MapProxy(); proxy.initData();
    const cell = new Vec2(100, 100), center = MapUtil.mapCellToPixelPoint(cell);
    proxy.setCurCenterPoint(cell, center, new Vec2(640, 360));
    const nearIds = [...proxy.visibleAreaIds]; events.length = 0;
    proxy.setCurCenterPoint(cell, center, new Vec2(2560, 1440));
    assert.ok(proxy.visibleAreaIds.length > nearIds.length); assert.equal(proxy.overview, true);
    assert.ok(events.some(e => e[0] === 'areas' && e[3].length > 0));
    for (const height of [240, 360, 650, 1440]) for (const aspect of [1.3, 16 / 9, 2.4]) {
        const halfWidth = height * aspect;
        for (const cell of [new Vec2(100, 100), new Vec2(0, 0), new Vec2(199, 0), new Vec2(199, 199)]) {
            const center = MapUtil.mapCellToPixelPoint(cell);
            const visible = new Set(MapUtil.getVisibleAreaIds(center, halfWidth, height));
            for (let x = -halfWidth; x <= halfWidth; x += 100) for (let y = -height; y <= height; y += 50) {
                const c = MapUtil.mapPixelToCellPoint(new Vec2(center.x + x, center.y + y));
                if (MapUtil.isVaildCellPoint(c)) assert.ok(visible.has(MapUtil.getAreaIdByCellPoint(c.x, c.y)), 'Visible tile must be loaded');
            }
            assert.ok([...visible].every(id => id >= 0 && id < MapUtil.areaCount));
        }
    }
    events.length = 0; proxy.setCurCenterPoint(cell, center, new Vec2(640, 360));
    assert.equal(proxy.overview, false); assert.deepEqual(proxy.visibleAreaIds, nearIds);
    assert.ok(events.some(e => e[0] === 'areas' && e[4].length > 0));
    assert.equal(proxy.setCurCenterPoint(cell, center, new Vec2(640, 360)), false);
});

test('resource output reflects only configured production instead of placeholder values', () => {
    const proxy = new MapProxy();
    assert.deepEqual(proxy.getResYieldDesList(null), []);
    assert.deepEqual(proxy.getResYieldDesList({ grain: 0, wood: 0, iron: 0, stone: 75 }), ['石料 +75/小时']);
    proxy.setNationMapConfig([{ type: 52, level: 3, wood: 160 }]);
    assert.deepEqual(proxy.getResYieldDesList(proxy.getResConfig(52, 3)), ['木材 +160/小时']);
});

test('camera matrices refresh before tiled culling on a quick jump or drag', () => {
    const logic = makeLogic();
    const order = [];
    logic._mapCamera.camera.update = force => { assert.equal(force, true); order.push('matrix'); };
    mapNode.emit = () => order.push('culling');
    logic.scrollToMapPoint(new Vec2(-100, 500));
    assert.deepEqual(order, ['matrix', 'culling']);
    assert.ok(MapUtil.isVaildCellPoint(logic.lastCenter.cell));
    near(logic.lastCenter.pixel.x, logic._mapCamera.node.position.x);
    order.length = 0;
    logic.onTouchBegan(touch()); logic.onTouchMove(touch(150, 80)); logic.applyPendingCameraMove();
    assert.deepEqual(order, ['matrix', 'culling']);
    mapNode.emit = () => {};
});

test('secondary fingers do not jump the camera and taps on clouds select no tile', () => {
    const logic = makeLogic();
    logic.onTouchBegan(touch(0, 0, 1));
    logic.onTouchBegan(touch(0, 0, 2));
    logic.onTouchMove(touch(100, 100, 2));
    near(logic._pendingCameraX, 0);
    logic.onTouchCancel(touch(0, 0, 2));
    assert.equal(logic._isTouch, true);
    logic.onTouchCancel(touch());
    logic.scrollToMapPoint(new Vec2(0, 0));
    logic.onTouchBegan(touch());
    events.length = 0;
    logic.onTouchEnd({ ...touch(), touch: { getUILocation: () => new Vec2(640, 700) } });
    assert.equal(events.length, 0);
});

const CloudBackdrop = load('assets/scripts/map/CloudBackdrop.ts');
test('cloud backdrop initializes without competing renderers and covers resized viewports', () => {
    const clouds = new CloudBackdrop();
    clouds.node = new Node(); clouds.node.addComponent(UITransform);
    const base = new Node(); base.name = 'FogBase'; base.addComponent(cc.Sprite); base.addComponent(UITransform);
    const texture = new Node(); texture.name = 'FogTexture'; texture.addComponent(cc.Sprite); texture.addComponent(UITransform);
    clouds.node.addChild(base); clouds.node.addChild(texture);
    clouds.followCamera = new Node();
    const camera = clouds.followCamera.addComponent(cc.Camera); camera.orthoHeight = 360;
    const cloud = new Node(); cloud.addComponent(cc.Sprite); cloud.addComponent(UITransform);
    clouds.clouds = [cloud];
    clouds.onLoad(); clouds.lateUpdate(1 / 60);
    assert.equal(base.getComponent(cc.Sprite).enabled, false);
    assert.ok(Number.isFinite(cloud.position.x));
    assert.ok(clouds._fog.rectangle.w >= 1280 && clouds._fog.rectangle.h >= 720);
    size.width = 1920; camera.orthoHeight = 288; clouds.lateUpdate(1 / 60);
    assert.ok(clouds._fog.rectangle.w >= 1536 && clouds._fog.rectangle.h >= 576);
    assert.equal(texture.getComponent(cc.Sprite).sizeMode, cc.Sprite.SizeMode.CUSTOM);
    size.width = 1280;
});

test('cloud wrapping preserves overshoot even across a large camera jump', () => {
    const clouds = new CloudBackdrop();
    near(clouds.wrap(1010, 1000), -990);
    near(clouds.wrap(-1010, 1000), 990);
    near(clouds.wrap(5010, 1000), -990);
    near(clouds.wrap(-5010, 1000), 990);
});

test('clouds respond to both drag axes with gentle parallax and capped background drift', () => {
    const clouds = new CloudBackdrop();
    clouds.node = new Node();
    clouds.node.components.set(UITransform, new UITransform());
    clouds.followCamera = new Node();
    clouds._camera = { orthoHeight: 360 };
    const cloud = new Node();
    cloud.components.set(UITransform, new UITransform());
    clouds.clouds = [cloud]; clouds._speeds = [2];
    clouds.followCamera.setPosition(100, 50, 1000);
    clouds.lateUpdate(1 / 60);
    near(cloud.position.x, -35 + 2 / 60); near(cloud.position.y, -17.5);
    near(clouds.node.position.x, 100);
    const before = cloud.position.x;
    clouds.lateUpdate(20);
    near(cloud.position.x - before, .2);
    clouds._camera.orthoHeight = 288;
    clouds.updateCoverage();
    near(clouds._halfSpan, 512); near(clouds._halfHeight, 288);
    size.width = 1920;
    clouds.updateCoverage(); near(clouds._halfSpan, 768);
    size.width = 1280;
});

test('campaign landscape matches expanded grid and keeps rivers off playable resource cells', () => {
    const file = 'assets/resources/world/map.tmx';
    const after = fs.readFileSync(path.join(root, file), 'utf8');
    const layer = (xml, name) => xml.match(new RegExp('<layer\\b[^>]*name="' + name + '"[^>]*>[\\s\\S]*?<data encoding="csv">([\\s\\S]*?)</data>'))[1].match(/\d+/g).map(n => Number(n) > 0);
    for (const name of ['obstruct', 'city_position']) assert.equal(layer(after, name).length, 1000000);
    for (const [attribute, expected] of [['width', '1000'], ['height', '1000'], ['tilewidth', '200'], ['tileheight', '100']]) {
        const get = xml => xml.match(/<map\b[^>]*>/)[0].match(new RegExp('\\b' + attribute + '="(\\d+)"'))[1];
        assert.equal(get(after), expected);
    }
    const resourcePath = 'assets/resources/config/mapRes_0.json';
    const resourceText = fs.readFileSync(path.join(root, resourcePath), 'utf8');
    const resources = JSON.parse(resourceText);
    const landscape = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/original-landscape.json'), 'utf8'));
    assert.equal(landscape.width, resources.w); assert.equal(landscape.height, resources.h);
    assert.ok(landscape.riverCells.length > 500);
    for (const id of landscape.riverCells) assert.equal(resources.list[id][0], 0, 'River must not replace a resource or city');
    assert.ok(!after.includes('hill.tsx') && !after.includes('water_edge_') && !after.includes('land.tsx'));
    for (const patch of landscape.patches) assert.ok(fs.existsSync(path.join(root, 'assets/resources/ui/world', patch.art + '.png')));
    for (const name of ['plains', 'water', 'town', 'county', 'capital', 'fort', 'forest', 'iron', 'quarry', 'grain',
        'wild_forest', 'wild_iron', 'wild_quarry', 'wild_grain']) {
        assert.ok(fs.existsSync(path.join(root, 'assets/resources/ui/world', name + '.png')));
    }
});
const terrainArt = { landscape: { riverCells: [MapUtil.getIdByCellPoint(10, 10)] } };
const MapTouchLogic = load('assets/scripts/map/MapTouchLogic.ts', {
    './MapClickUILogic': {}, './MapCommand': {}, './MapUtil': { default: MapUtil },
    './WorldLandscape': { default: class {} }, './WorldMapArt': { default: terrainArt },
    './ui/ManagementStyle': {}, '../utils/EventMgr': { EventMgr: {} }, '../common/LogicEvent': { LogicEvent: {} },
});
test('visible mountain clicks and river cells report blockers instead of selecting land behind them', () => {
    const logic = new MapTouchLogic(); let mountain = new Vec2(5, 6), blocked = null, selected = null;
    logic.node = { getComponentInChildren: () => ({ blockerAt: () => mountain }) };
    logic._cmd = { cityProxy: { getCity: () => null }, buildProxy: { getBuild: () => null },
        proxy: { getResData: () => ({ id: 2010, x: 10, y: 10, type: 0 }), getSysCityResData: () => null } };
    logic.showBlocked = (point, river) => { blocked = { point, river }; };
    logic.showClickUINode = data => { selected = data; };
    logic.onTouchMap(new Vec2(10, 10), new Vec2(), new Vec2());
    assert.deepEqual(blocked, { point: new Vec2(5, 6), river: false }); assert.equal(selected, null);
    mountain = null; blocked = null;
    logic.onTouchMap(new Vec2(10, 10), new Vec2(), new Vec2());
    assert.equal(blocked.river, true);
    logic._cmd.proxy.getResData = () => ({ id: 2010, x: 10, y: 10, type: 0, isEmpty: true });
    blocked = null; logic.onTouchMap(new Vec2(10, 10), new Vec2(), new Vec2());
    assert.equal(blocked, null); assert.equal(selected.isEmpty, true);
    logic._cmd.proxy.getResData = () => ({ id: 2010, x: 10, y: 10, type: 52 });
    blocked = null; logic.onTouchMap(new Vec2(10, 10), new Vec2(), new Vec2());
    assert.equal(blocked, null); assert.equal(selected.type, 52);
});
console.log(`${count} map navigation regressions passed`);
