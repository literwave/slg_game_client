// 离线验证真实行军显示层和服务端折线路径，不操作 Preview。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), cache = new Map();
class Component { schedule() {} }
class Vec2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
class Vec3 extends Vec2 {}
class UITransform { height = 1; }
class Sprite { enabled = true; }
class Graphics { clear() { this.points = []; } moveTo(x, y) { this.points.push([x, y]); } lineTo(x, y) { this.points.push([x, y]); } stroke() {} }
class Animation { play(name) { this.name = name; this.paused = false; } pause() { this.paused = true; } }
class Node {
    constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; }
    get parent() { return this._parent; }
    set parent(value) { if (this._parent) this._parent.children.splice(this._parent.children.indexOf(this), 1); this._parent = value; if (value) value.children.push(this); }
    addChild(n) { n.parent = this; }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    setPosition(x, y) { this.position = { x, y }; }
    setSiblingIndex(index) { const a = this.parent.children; a.splice(a.indexOf(this), 1); a.splice(index, 0, this); }
    setScale() {}
}
class NodePool { items = []; size() { return this.items.length; } get() { return this.items.pop(); } put(n) { n.parent = null; this.items.push(n); } clear() { this.items = []; } }
const cc = { Component, Vec2, Vec3, UITransform, Node, NodePool, Sprite, Graphics, Animation, Color: class {},
    _decorator: { ccclass: () => c => c, property: () => () => {} }, Prefab: class {} };
let now = 100000, marches = [];
const util = { areaCellSize: { width: 10, height: 10 }, mapCellToPixelPoint: p => new Vec2((p.x - p.y) * 100, -(p.x + p.y) * 50) };
const stubs = {
    'map/MapUtil': { default: util }, 'map/MapCommand': {}, 'utils/DateUtil': { default: { getServerTime: () => now } },
    'general/ArmyCommand': { default: { getInstance: () => ({ proxy: { getAllArmys: () => [] } }) } },
    'general/ArmyProxy': { ArmyCmd: { Idle: 0, Conscript: 5 } },
    'world/WorldCommand': { default: { getInstance: () => ({ marches: { values: () => marches } }) }, MarchTargetType: { ReturnCity: 1, Move: 4 } },
};
function load(name) {
    if (stubs[name]) return stubs[name]; if (cache.has(name)) return cache.get(name).exports;
    const file = path.join(root, 'assets/scripts', name + '.ts'), mod = { exports: {} }; cache.set(name, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    new Function('require', 'module', 'exports', code)(id => id === 'cc' ? cc : load(path.relative(path.join(root, 'assets/scripts'),
        path.resolve(path.dirname(file), id)).replace(/\\/g, '/')), mod, mod.exports);
    return mod.exports;
}
const { buildMarchPath, sampleMarchPath } = load('world/MarchPath');
const march = { troopIdx: 1, targetType: 4, targetId: 0, state: 1, startTime: 100, endTime: 104,
    startPos: { x: 10.25, y: 20 }, endPos: { x: 12.25, y: 22 }, path: [{ x: 10.25, y: 20 }, { x: 10.25, y: 22 }, { x: 12.25, y: 22 }] };
const route = buildMarchPath(march);
assert.deepEqual(sampleMarchPath(march, route, 101000).position, { x: 10.25, y: 21 });
assert.deepEqual(sampleMarchPath(march, route, 103000).position, { x: 11.25, y: 22 });
assert.deepEqual(sampleMarchPath(march, route, 99000).position, march.startPos);
assert.deepEqual(sampleMarchPath(march, route, 109000).position, march.endPos);
assert.deepEqual(sampleMarchPath({ ...march, state: 2 }, route, 101000).position, march.endPos);
assert.equal(march.state, 1, '本地时间不能改业务到达状态');
assert.equal(buildMarchPath({ ...march, path: [] }).points.length, 2);
assert.equal(sampleMarchPath(march, buildMarchPath({ ...march, path: [{ x: 1, y: 2 }, { x: 1, y: 2 }] }), now).moving, false);
console.log('PASS 服务端秒时间、浮点拐点、转弯插值、迟到确认、零长度路径');

const events = load('utils/EventMgr').EventMgr, E = load('common/LogicEvent').LogicEvent;
const Layer = load('map/MapArmyLogic').default, layer = new Layer(); layer.parentLayer = new Node('ArmyLayer');
layer.createArmy = () => { if (layer._armyPool.size()) return layer._armyPool.get(); const n = new Node('Army'); n.addComponent(Animation); return n; };
layer.createArrow = () => { if (layer._arrowPool.size()) return layer._arrowPool.get(); const n = new Node('Arrow'); n.addComponent(UITransform); n.addComponent(Sprite); return n; };
layer.onLoad(); assert.equal(layer.worldArmies.size, 0);
marches = [march]; events.emit(E.updateMarches); assert.equal(layer.worldArmies.size, 1);
const logic = layer.worldArmies.get(1), soldier = logic.aniNode;
now = 101000; layer.update(); assert.deepEqual(soldier.position, { x: -1075, y: -1562.5 });
const g = logic.arrowNode.getChildByName('WorldMarchRoute').getComponent(Graphics);
assert.equal(g.points.length, 3, '折线保留服务端拐点'); assert.equal(logic.arrowNode.getComponent(Sprite).enabled, false);
now = 103000; layer.update(); assert.deepEqual(soldier.position, { x: -1075, y: -1662.5 });
assert.equal(soldier.getComponent(Animation).paused, false);
now = 105000; layer.update(); assert.equal(soldier.getComponent(Animation).paused, true); assert.equal(march.state, 1);
marches = [{ ...march, state: 2 }]; events.emit(E.updateMarches);
assert.equal(layer.worldArmies.size, 1, 'MOVE 到达后保持驻留显示'); assert.equal(logic.arrowNode.active, false);
marches = [{ ...march, targetType: 1, state: 2 }]; events.emit(E.updateMarches);
assert.equal(layer.worldArmies.size, 0, '回城确认后回收'); assert.equal(layer._armyPool.size(), 1);
marches = [{ ...march, troopIdx: 2 }]; now = 101000; events.emit(E.updateMarches);
assert.equal(layer.worldArmies.get(2).aniNode, soldier, '复用既有行军预制体');
assert.equal(soldier.getComponent(Animation).paused, false);
marches = []; events.emit(E.updateMarches); assert.equal(layer.worldArmies.size, 0, '断线清除地图上的旧行军');
layer.onDestroy(); console.log('PASS World 行军接入实际地图层、路线与动画、驻留、回城、对象池复用和清理');
