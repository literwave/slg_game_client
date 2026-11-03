// 建筑保持原图层，部队全程可见，路线留在地面；不发起真实行军。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../../assets/scripts/map'), cache = new Map();
class Node {
    constructor(name = '') { this.name = name; this.children = []; this.layer = 1; this.position = { x: 0, y: 0 }; this.components = new Map(); this.active = true; this.isValid = true; }
    set parent(p) { if (this._parent) this._parent.children.splice(this.getSiblingIndex(), 1); this._parent = p; if (p) p.children.push(this); }
    get parent() { return this._parent; }
    addChild(n) { n.parent = this; }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    getSiblingIndex() { return this.parent.children.indexOf(this); }
    setSiblingIndex(index) { const list = this.parent.children; list.splice(this.getSiblingIndex(), 1); list.splice(index, 0, this); }
}
class UITransform {
    constructor() { this.width = 40; this.height = 74; this.anchorX = .5; this.anchorY = 0; }
    getBoundingBoxToWorld() {
        let x = 0, y = 0;
        for (let n = this.node; n; n = n.parent) { x += n.position.x; y += n.position.y; }
        return { x: x - this.anchorX * this.width, y: y - this.anchorY * this.height, width: this.width, height: this.height };
    }
}
class Sprite {
    constructor() { this.enabled = true; this.spriteFrame = {}; }
    get enabledInHierarchy() { return this.enabled && this.node.activeInHierarchy; }
}
class UIOpacity { constructor() { this.opacity = 255; this.isValid = true; } }
function load(name) {
    if (cache.has(name)) return cache.get(name);
    const mod = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, name + '.ts'), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function('require', 'module', 'exports', code)(id => id === 'cc' ? { Node, UITransform, Sprite, UIOpacity } : load(id.replace('./', '')), mod, mod.exports);
    cache.set(name, mod.exports); return mod.exports;
}
const { orderWorldDepth } = load('WorldDepthOrder');
const city = { value: 'city', x: 0, y: 0, halfWidth: 300, halfHeight: 150 };
for (const x of [-290, -200, 0, 200, 290]) {
    const edge = -150 + Math.abs(x) / 2;
    const rear = { value: 'rear', x, y: edge + 30 }, front = { value: 'front', x, y: edge - 10 };
    assert.deepEqual(orderWorldDepth([front, city, rear]), ['rear', 'city', 'front']);
}
console.log('PASS 城后遮挡、左右前墙斜边与城门前正常露出');
const adjacent = { ...city, value: 'adjacent', x: -300, y: -150 };
const between = { value: 'guard', x: -210, y: -90 };
assert.deepEqual(orderWorldDepth([adjacent, between, city]), ['city', 'guard', 'adjacent']);
const input = [city, ...Array.from({ length: 7 }, (_, i) => ({ value: i, x: 20 * i - 60, y: -170 + 15 * i }))];
const result = orderWorldDepth(input);
assert.ok(result.indexOf(6) < result.indexOf('city') && result.indexOf(0) > result.indexOf('city'));
assert.deepEqual(orderWorldDepth(result.map(value => input.find(item => item.value === value))), result);
console.log('PASS 相邻城池之间与同一编队分前后遮挡，静止顺序稳定');
const world = new Node('World');
for (const name of ['mapNode', 'resBuildNode', 'sysCityNode', 'roleCityNode', 'facilityBuildNode', 'armyNode']) world.addChild(new Node(name));
const Depth = load('MapDepthLayer').default, depth = Depth.forLayer(world.getChildByName('armyNode'));
assert.equal(Depth.forLayer(world.getChildByName('roleCityNode')), depth);
assert.ok(depth.routes.getSiblingIndex() < world.getChildByName('resBuildNode').getSiblingIndex());
assert.ok(depth.routes.getSiblingIndex() < depth.actors.getSiblingIndex());
const castle = new Node('castle'), rear = new Node('rear'), front = new Node('front');
const cityIndex = depth.actors.getSiblingIndex();
depth.building(castle, 600, 300); depth.troops.addChild(front); depth.troops.addChild(rear);
assert.equal(depth.actors.getSiblingIndex(), cityIndex, '创建部队层不改变建筑原图层');
assert.ok(depth.troops.getSiblingIndex() > world.getChildByName('facilityBuildNode').getSiblingIndex());
assert.ok(depth.troops.getSiblingIndex() > depth.actors.getSiblingIndex());
rear.position = { x: 200, y: 0 }; front.position = { x: 200, y: -100 };
for (const y of [200, 0, -120, -300]) {
    rear.position.y = y; depth.update();
    assert.equal(castle.parent, depth.actors);
    assert.equal(rear.parent, depth.troops);
    assert.ok(rear.parent.getSiblingIndex() > castle.parent.getSiblingIndex(), '城后、城内和墙前的士兵都在建筑上方');
    assert.deepEqual(depth.actors.children.map(n => n.name), ['castle']);
}
assert.deepEqual(depth.troops.children.map(n => n.name), ['front', 'rear'], '士兵之间仍按脚底位置排序');
rear.parent = null; depth.update();
assert.equal(depth.troops.children.length, 1, '回收士兵不留排序残影');
assert.equal(depth.actors.children.length, 1, '回收部队不影响建筑');
console.log('PASS 路线贴地、建筑保持原层级、部队在城内外始终可见、节点回收');

