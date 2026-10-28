// 执行真实领地管理/绘制代码，覆盖 AOI 生命周期及与资源对象池的解耦。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const scripts = path.resolve(__dirname, '../../assets/scripts');
class Component { schedule() {} unschedule() {} }
class Node {
    constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.position = { x: 0, y: 0, z: 0 }; this.scale = { x: 1, y: 1 }; }
    addChild(n) { n.parent = this; this.children.push(n); }
    getChildByName(n) { return this.children.find(c => c.name === n); }
    addComponent(T) { const c = new T(); c.node = this; this.components.set(T, c); return c; }
    getComponent(T) { return this.components.get(T); }
    setPosition(x, y, z = 0) { this.position = typeof x === 'object' ? { ...x } : { x, y, z }; }
    setScale(x, y) { this.scale = typeof x === 'object' ? { ...x } : { x, y }; }
    setRotation() {}
    get worldPosition() { const p = this.parent?.worldPosition || { x: 0, y: 0 }; return { x: p.x + this.position.x, y: p.y + this.position.y }; }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    getSiblingIndex() { return this.parent.children.indexOf(this); }
    setSiblingIndex(i) { const a = this.parent.children; a.splice(a.indexOf(this), 1); a.splice(i, 0, this); }
    destroy() { this.destroyed = true; if (this.parent) this.parent.children.splice(this.getSiblingIndex(), 1); }
}
class UITransform { setContentSize(width, height) { Object.assign(this, { width, height }); } }
class Graphics { clear() { this.strokes = []; } moveTo() {} lineTo() {} close() {} fill() {} rect() {} roundRect() {}
    stroke() { this.strokes.push({ width: this.lineWidth, color: this.strokeColor }); } }
class Label { static HorizontalAlign = { CENTER: 1 }; }
class Color { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
class Vec2 { constructor(x, y) { Object.assign(this, { x, y }); } }
class Camera { orthoHeight = 360; }
const cc = { Component, Node, UITransform, Graphics, Label, Color, Camera, Vec2, Vec3: Vec2, UIOpacity: class {},
    NodePool: class { clear() {} }, view: { getVisibleSize: () => ({ width: 1280, height: 720 }) },
    _decorator: { ccclass: () => c => c, property: () => () => {} } };
let now = 1000, mine = '9007199254740993', refreshes = 0;
const world = { entities: new Map(), marches: { values: () => marches }, occupyCountdownAt(x, y, t) {
    return [...this.entities.values()].find(e => e.pos?.x === x && e.pos?.y === y && e.startTime > 0 && e.endTime > e.startTime) || null;
}, refreshView() { refreshes++; } };
let marches = [];
const util = { areaCellSize: {}, mapSize: { width: 1000, height: 1000 }, tileSize: { width: 200, height: 100 },
    getIdByCellPoint: (x, y) => y * 1000 + x,
    mapCellToPixelPoint: p => new Vec2((p.x - p.y) * 100, (20 - p.x - p.y) * 50) };
const stubs = {
    'map/MapUtil': { default: util }, 'map/MapCommand': { default: { getInstance: () => ({ proxy: { getResData: () => ({ type: 52 }) } }) } },
    'map/MapProxy': { MapResType: { SYS_FORTRESS: 50, WOOD: 52, GRAIN: 55 } },
    'map/entries/ResLogic': { default: class {} },
    'world/WorldCommand': { default: { getInstance: () => world }, MarchTargetType: { OccupyResource: 3 } },
    'login/LoginCommand': { default: { getInstance: () => ({ proxy: { getRoleData: () => ({ userId: mine }) } }) } },
    'network/pto/ProtocolCommand': { hasId: n => /^[1-9]\d*$/.test(String(n)), idKey: n => String(n) },
    'utils/DateUtil': { default: { getServerTime: () => now * 1000, converSecondStr: t => `${Math.ceil(t / 1000)}秒` } },
    'common/LogicEvent': { LogicEvent: {} }, 'utils/EventMgr': { EventMgr: { on() {}, targetOff() {} } },
    'map/ui/ManagementStyle': { ManagementColors: { gold: new Color(), text: new Color() }, caption(parent, name, string, x, y) {
        let n = parent.getChildByName(name); if (!n) { n = new Node(name); parent.addChild(n); n.addComponent(Label); }
        n.setPosition(x, y); const label = n.getComponent(Label); label.string = string; return label;
    } },
};
const cache = new Map();
function load(key) {
    if (stubs[key]) return stubs[key]; if (cache.has(key)) return cache.get(key);
    const file = path.join(scripts, key + '.ts'), m = { exports: {} };
    const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    new Function('require', 'module', 'exports', out)(id => id === 'cc' ? cc : load(path.relative(scripts,
        path.resolve(path.dirname(file), id)).replace(/\\/g, '/')), m, m.exports);
    cache.set(key, m.exports); return m.exports;
}
const host = new Node('MapHost'), map = new Node('MapScene'), resources = new Node('resNode');
host.addChild(map); map.addChild(resources);
const cameraNode = new Node('Map Camera'); host.addChild(cameraNode); const camera = cameraNode.addComponent(Camera);
const Res = load('map/MapResLogic').default, res = new Res(); res.node = map; res.parentLayer = resources; res.onLoad();
function entity(id, x, y, ownerId, extra = {}) { world.entities.set(id, { entityType: 4, pos: { x, y }, ownerId, ...extra }); }
entity(1, 10, 10, mine); entity(2, 11, 10, '9007199254740994');
entity(3, 10, 11, 0); entity(4, -1, 10, mine); entity(5, 12, 10, mine, { entityType: 1 });
res.refreshOwnership();
assert.equal(res.claimViews.size, 2, '无需任何资源 Sprite，空地也显示归属');
assert.equal(res.landClaims.get(10010).owner, 'mine'); assert.equal(res.landClaims.get(10011).owner, 'other');
assert.equal(res.territoryLayer.parent, map); assert.ok(res.territoryLayer.getSiblingIndex() > resources.getSiblingIndex());
const other = res.claimViews.get(10011); assert.ok(other.node.activeInHierarchy);
assert.equal(other.node.children.length, 1, '已占领地块仅有轻薄边界，不创建旗帜');
res.refreshOverview(true); resources.active = false;
assert.ok(other.node.activeInHierarchy, '缩远隐藏资源节点后，领地保持显示');
camera.orthoHeight = 900; res.lateUpdate(); assert.ok(other.node.activeInHierarchy);
cameraNode.setPosition(10000, 10000); res.lateUpdate(); assert.equal(other.node.active, false);
cameraNode.setPosition(0, 0); res.lateUpdate(); assert.ok(other.node.active, '平移回来恢复原位置标记');
entity(2, 11, 10, mine); res.refreshOwnership();
assert.equal(res.landClaims.get(10011).owner, 'mine'); assert.equal(res.claimViews.get(10011), other, '更新归属复用标记');
entity(6, 9, 10, '9007199254740994', { startTime: 995, endTime: 1010 });
entity(7, 9, 9, 0, { startTime: 995, endTime: 1010 });
marches = [{ targetType: 3, state: 2, endPos: { x: 9, y: 9 }, startTime: 995, endTime: 1010 },
    { targetType: 3, state: 1, endPos: { x: 8, y: 8 }, startTime: 995, endTime: 1010 }];
res.refreshOwnership(); assert.equal(res.landClaims.get(10009).owner, 'pending');
assert.equal(res.landClaims.get(9009).owner, 'pending'); assert.equal(res.landClaims.has(8008), false, '在路上不画占领完成/占领中');
assert.ok(res.claimViews.get(9009).node.getChildByName('OccupyBar').active, '无资源的占领中空地也有读条');
now = 1011; res.tickOccupyProgress();
assert.equal(res.landClaims.get(10009).owner, 'pending'); assert.equal(res.landClaims.get(9009).owner, 'pending');
assert.match(res.claimViews.get(9009).node.getChildByName('OccupyPending').getComponent(Label).string, /等待占领确认/);
res.tickOccupyProgress(); assert.equal(refreshes, 2, '每个过期计时仅触发一次视野校准，不每帧发包');
entity(6, 9, 10, '9007199254740994', { startTime: 0, endTime: 0 });
entity(7, 9, 9, mine, { startTime: 0, endTime: 0 });
res.refreshOwnership();
assert.equal(res.landClaims.get(10009).owner, 'other'); assert.equal(res.landClaims.get(9009).owner, 'mine');
assert.equal(res.claimViews.get(10009).node.getChildByName('OccupyBar').active, false, '服务器确认后清理读条');
entity(2, 11, 10, 0); res.refreshOwnership(); assert.ok(other.node.destroyed, '释放归属清理旧标记');
world.entities.clear(); marches = []; res.refreshOwnership(); assert.equal(res.claimViews.size, 0, '离开 AOI/断线清理');
const layer = res.territoryLayer; res.onDestroy(); assert.ok(layer.destroyed);
const Selection = load('map/TileHighlight'); const selected = new Node('Selected');
for (const zoom of [.6, 1.7, 3]) {
    const opacity = Selection.paintTileSelection(selected, 200, 100, zoom);
    assert.equal(opacity.node.name, 'SelectionPulse');
    assert.ok(selected.getChildByName('SelectionOutline').getComponent(Graphics).strokes.some(s => s.color.a >= 200),
        '呼吸只作用在高光，固定边界始终清楚');
}
assert.equal(selected.children.length, 2, '缩放只重绘，不重复创建装饰节点');
console.log('PASS 领地独立显示：64位归属、空地、概览、缩放平移、归属转换、倒计时、AOI清理、选框常亮');
