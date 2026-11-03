// 运行实际地图资源层和对象池生命周期，避免关楼切层后残留或遮盖错误。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
class Node {
    constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.isValid = true; this.active = true;
        this.position = { x: 0, y: 0, z: 0 }; this.scale = { x: 1, y: 1, z: 1 }; this.rotation = {}; }
    set parent(n) { if (this._parent) this._parent.children.splice(this.getSiblingIndex(), 1); this._parent = n; if (n) n.children.push(this); }
    get parent() { return this._parent; }
    addChild(n) { n.parent = this; }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    getSiblingIndex() { return this.parent.children.indexOf(this); }
    setSiblingIndex(i) { const a = this.parent.children; a.splice(a.indexOf(this), 1); a.splice(i, 0, this); }
    setPosition(p) { this.position = { ...p }; }
    setRotation(r) { this.rotation = { ...r }; }
    setScale(s) { this.scale = { ...s }; }
    addComponent(T) { const c = new T(); this.components.set(T, c); return c; }
    getComponent(T) { return this.components.get(T); }
    destroy() { this.isValid = false; this.parent = null; }
}
class NodePool {
    nodes = [];
    put(n) { n.parent = null; this.nodes.push(n); }
    get() { return this.nodes.pop(); }
    size() { return this.nodes.length; }
    clear() { this.nodes.forEach(n => n.destroy()); this.nodes = []; }
}
class Res { setResourceData(data) { this.data = data; } }
class Vec { constructor(x, y, z = 0) { Object.assign(this, { x, y, z }); } }
const cc = { Node, NodePool, UITransform: class {}, Vec2: Vec, Vec3: Vec, Camera: class {}, view: {}, Prefab: class {},
    Component: class { unschedule() {} }, _decorator: { ccclass: () => c => c, property: () => () => {} },
    instantiate() { const n = new Node('resource'); n.addComponent(Res); return n; } };
const campaign = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));
const imports = { cc, './entries/ResLogic': { default: Res }, './WorldCampaign': { default: {
    gateAt: (x, y) => campaign.gates.find(g => g.x === x && g.y === y) } },
    './MapCommand': { default: { getInstance: () => ({}) } }, './MapProxy': { MapResType: { SYS_FORTRESS: 50, WOOD: 52, GRAIN: 55 } },
    './MapUtil': { default: { mapCellToPixelPoint: p => new Vec((p.x - p.y) * 100, -(p.x + p.y) * 50) } },
    '../world/WorldCommand': {}, '../login/LoginCommand': {}, '../network/pto/ProtocolCommand': {},
    '../common/LogicEvent': {}, '../utils/EventMgr': { EventMgr: { targetOff() {} } }, '../utils/DateUtil': {}, './LandClaimView': {} };
function load(file) {
    const m = { exports: {} }; const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } }).outputText;
    new Function('require', 'module', 'exports', code)(id => { assert.ok(id in imports, id); return imports[id]; }, m, m.exports);
    return m.exports;
}
imports['./MapBaseLayerLogic'] = load('assets/scripts/map/MapBaseLayerLogic.ts');
const Layer = load('assets/scripts/map/MapResLogic.ts').default;
const world = new Node('World'), resources = new Node('resNode'), mountains = new Node('MountainRanges'), army = new Node('WorldDepthActors');
world.addChild(resources); world.addChild(mountains); world.addChild(army);
resources.setPosition({ x: 30, y: -25, z: 0 }); resources.setScale({ x: .8, y: .8, z: 1 });
const layer = new Layer(); layer.parentLayer = resources; layer.addArea(1);
layer._cmd = { proxy: { getResData: () => ({ type: 50 }) } };
const gate = { ...campaign.gates.find(g => g.crossing === 'pass'), id: 1, type: 50 };
const bridge = { ...campaign.gates.find(g => g.crossing === 'bridge'), id: 2, type: 50 };
const a = layer.addItem(1, gate), b = layer.addItem(1, bridge), presentation = layer.gateLayer;
assert.equal(a.parent, presentation); assert.equal(b.parent, presentation);
assert.ok(presentation.getSiblingIndex() > mountains.getSiblingIndex());
assert.ok(presentation.getSiblingIndex() < army.getSiblingIndex(), '关口不能盖住部队');
assert.deepEqual(presentation.position, resources.position); assert.deepEqual(presentation.scale, resources.scale);
assert.deepEqual(a.position, { x: (gate.x - gate.y) * 100, y: -(gate.x + gate.y) * 50, z: 0 });
layer.addItem(1, gate); assert.equal(presentation.children.length, 2, '更新关口不重复创建');
layer.removeArea(1); layer.addArea(1);
assert.equal(layer.addItem(1, gate), a, '快速移出再移回接回同一关口');
layer.recycleOneItem(); assert.equal(b.parent, null, '回收桥梁不留下独立贴图');
const ordinary = { id: 3, x: 0, y: 0, type: 50, level: 1 }, reused = layer.addItem(1, ordinary);
assert.equal(reused, b); assert.equal(reused.parent, resources, '普通要塞复用关口节点回到资源层');
layer.refreshOverview(true); assert.ok(a.active && reused.active);
layer.removeItem(1, gate.id); assert.equal(presentation.children.length, 0);
layer.refreshOverview(false); layer.addItem(1, gate); assert.equal(presentation.children.length, 1);
assert.equal(world.children.filter(n => n.name === 'WorldGateLandmarks').length, 1);
layer.onDestroy(); assert.equal(presentation.isValid, false, '资源层销毁时清理关口层');
console.log('PASS 山口/关桥遮挡顺序、坐标同步、AOI 快速返回、对象池切层、概览与销毁');
