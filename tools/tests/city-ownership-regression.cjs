// 实际归属模型/显示组件：协议刷新、占领推送、对象池、缩放与重连恢复。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
function load(file, imports) {
    const output = ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts', file + '.ts'), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, reportDiagnostics: true });
    assert.equal(output.diagnostics.length, 0);
    const m = { exports: {} };
    new Function('require', 'module', 'exports', output.outputText)(id => { assert.ok(id in imports, id); return imports[id]; }, m, m.exports);
    return m.exports;
}
const protocol = { hasId: id => /^[1-9]\d*$/.test(String(id)), idKey: id => id == null ? '0' : String(id) };
const model = load('map/CityOwnership', { '../network/pto/ProtocolCommand': protocol });
const mine = '9007199254740993', other = '9007199254740994';
const city = { entityId: '5000000000149284', allianceId: mine, allianceName: '山河盟', pos: { x: 284, y: 149 }, level: 4 };
assert.equal(model.resolveCityOwner(undefined, mine).relation, 'unknown');
assert.equal(model.resolveCityOwner({ ...city, allianceId: 0 }, 0).relation, 'neutral');
assert.equal(model.resolveCityOwner(city, mine).relation, 'mine');
assert.equal(model.resolveCityOwner(city, other).relation, 'other', '相邻 64 位 ID 不可四舍五入成同盟');
assert.equal(model.resolveCityOwner({ ...city, allianceName: '   ' }, mine).name, '本盟');
const cue = new model.CityCaptureCue(), owner = model.resolveCityOwner(city, mine);
cue.sync(owner); assert.equal(cue.take(owner, other), false);
assert.equal(cue.take(owner, mine), true); assert.equal(cue.take(owner, mine), false);
cue.sync(model.resolveCityOwner({ ...city, allianceId: other }, mine));
assert.equal(cue.take(owner, mine), true, '实际易主后允许再次攻占');
console.log('PASS 未知/中立/本盟/其他同盟、64 位 ID、占领推送去重和再次易主');

class Component { isValid = true; }
class Node {
    constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.layer = 2; this.isValid = true;
        this.active = true; this.position = { x: 0, y: 0 }; this.scale = { x: 1, y: 1 }; this.handlers = new Map(); }
    get scene() { return this.parent?.scene || this; }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    addChild(n) { n.parent = this; this.children.push(n); }
    getChildByName(name) { return this.children.find(n => n.name === name && n.isValid); }
    getChildByPath(path) { return path.split('/').reduce((n, key) => n?.getChildByName(key), this); }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type); }
    setPosition(x, y) { this.position = { x, y }; } setScale(x, y) { this.scale = { x, y }; }
    setSiblingIndex(index) { const a = this.parent.children; a.splice(a.indexOf(this), 1); a.splice(index, 0, this); }
    on(event, handler) { this.handlers.set(event, handler); }
    destroy() { this.isValid = false; this.active = false; }
}
class UITransform { setContentSize(width, height) { Object.assign(this, { width, height }); } setAnchorPoint() {}
    convertToWorldSpaceAR(p, out) { return out.set(p.x, p.y); } }
class Graphics extends Component { commands = []; clear() { this.commands = []; } }
for (const fn of ['moveTo', 'lineTo', 'close', 'fill', 'stroke', 'roundRect']) Graphics.prototype[fn] = function (...args) { this.commands.push([fn, ...args]); };
class Label { static HorizontalAlign = { CENTER: 1, LEFT: 0 }; static VerticalAlign = { CENTER: 1 }; static Overflow = { CLAMP: 1, SHRINK: 2 }; }
class Color { constructor(r, g, b, a = 255) { Object.assign(this, { r, g, b, a }); } }
class Button { static EventType = { CLICK: 'click' }; static Transition = { SCALE: 1 }; }
class Vec { constructor(x = 0, y = 0) { this.set(x, y); } set(x, y) { this.x = x; this.y = y; return this; } }
class Camera extends Component { orthoHeight = 360; convertToUINode(p, parent, out) { out.set(p.x, p.y); } }
const cc = { Component, Node, UITransform, Graphics, Label, Color, Button, Camera, Vec2: Vec, Vec3: Vec,
    Sprite: class {}, Widget: class {}, Layout: class {}, view: { getVisibleSize: () => ({ width: 1280, height: 720 }) },
    _decorator: { ccclass: () => C => C, property: () => () => {} } };
const style = load('map/ui/ManagementStyle', { cc, '../../common/BgLogic': {} });
const presentation = load('map/CityMapPresentation', { cc, './ui/ManagementStyle': style,
    './WorldCampaign': { default: { landmark: () => '朔方隘' } }, './CityOwnership': model });
const listeners = [], emitted = [], E = { updateAllianceCities: 'cities', updateMyRole: 'role', allianceCityOccupied: 'occupied', openCityTroops: 'city-troops' };
const events = { on: (event, handler, target) => listeners.push({ event, handler, target }),
    targetOff: target => { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].target === target) listeners.splice(i, 1); },
    emit: (event, ...args) => { emitted.push([event, ...args]); for (const l of [...listeners]) if (l.event === event) l.handler.apply(l.target, args); } };
let snapshot, myAlliance = mine;
const proxy = { strategic: false };
const View = load('map/CityOwnershipView', { cc, '../utils/EventMgr': { EventMgr: events }, '../common/LogicEvent': { LogicEvent: E },
    '../world/CityCommand': { default: { getInstance: () => ({ at: (x, y) => snapshot?.pos.x === x && snapshot?.pos.y === y ? snapshot : undefined }) } },
    '../login/LoginCommand': { default: { getInstance: () => ({ proxy: { getRoleData: () => ({ allianceId: myAlliance }) } }) } },
    './MapCommand': { default: { getInstance: () => ({ proxy }) } }, './MapUtil': { default: { mapCellToPixelPoint: p => p } },
    './CityOwnership': model, './CityMapPresentation': presentation, './ui/ManagementStyle': style,
    './CityDeployment': { cityDeploymentCount: c => Math.max(0, Math.floor(c?.deployCount || 0)) } }).default;
const scene = new Node('Scene'), canvas = new Node('Canvas'), ui = new Node('MapUIScene'), cameraNode = new Node('Map Camera');
scene.addChild(canvas); canvas.addChild(ui); canvas.addChild(cameraNode); const camera = cameraNode.addComponent(Camera);
const gate = new Node('Gate'); canvas.addChild(gate); gate.addComponent(UITransform);
const c = gate.addComponent(View); c.onEnable();
c.setCity({ ...city.pos, level: 4, rid: 9, unionName: '过期旧归属' }, 100, [[-300, 0], [0, 160], [300, 0], [0, -160]]);
c.lateUpdate(0);
assert.equal(c.owner.relation, 'unknown'); assert.equal(c.flags.length, 0, '旧 rid 不能冒充城池归属');
snapshot = { ...city, allianceId: 0 }; events.emit(E.updateAllianceCities);
assert.equal(c.plate.getChildByName('CityOwner').getComponent(Label).string, '中立');
snapshot = city; events.emit(E.updateAllianceCities); c.lateUpdate(0);
assert.equal(c.flags.length, 2); assert.ok(c.flags.every(n => n.active)); assert.equal(c.ground.node.active, true);
assert.equal(c.plate.getChildByName('CityOwner').getComponent(Label).string, '本盟 · 山河盟');
assert.equal(c.captureTime, 0, '读取列表和重连数据不能触发占领动效');
snapshot = { ...city, deployCount: 3 }; events.emit(E.updateAllianceCities);
const troopsEntry = c.plate.getChildByName('CityTroops');
assert.equal(troopsEntry.active, true);
assert.equal(troopsEntry.getChildByName('Count').getComponent(Label).string, '队伍 × 3  ›');
troopsEntry.handlers.get(Button.EventType.CLICK).call(c);
assert.deepEqual(emitted.at(-1), [E.openCityTroops, city.entityId]);
snapshot = { ...city, deployCount: 2 }; events.emit(E.updateAllianceCities);
assert.equal(troopsEntry.getChildByName('Count').getComponent(Label).string, '队伍 × 2  ›', '离城数量推送即时更新');
const count = gate.children.length;
for (let i = 0; i < 30; i++) events.emit(E.updateAllianceCities);
assert.equal(gate.children.length, count, '重复同步不重复创建旗帜');
events.emit(E.allianceCityOccupied, { cityInfo: city }); assert.equal(c.captureTime, 1.8);
c.lateUpdate(.2); const remaining = c.captureTime;
events.emit(E.allianceCityOccupied, { cityInfo: city }); assert.equal(c.captureTime, remaining, '重复包不重播');
c.lateUpdate(2); c.lateUpdate(0); assert.equal(c.pulse.node.active, false);
assert.ok(c.flags.every(f => f.getChildByName('FlagBanner').position.y === 0));
myAlliance = other; events.emit(E.updateMyRole);
assert.equal(troopsEntry.active, false, '换盟后不可继续打开旧驻军');
assert.equal(c.owner.relation, 'other'); assert.equal(c.plate.getChildByName('CityOwner').getComponent(Label).string, '山河盟');
console.log('PASS 城池协议实时刷新、盟名显示、换盟刷新、重连静态恢复、一次性升旗结束');

for (const height of [180, 720, 1440]) { camera.orthoHeight = height; c.lateUpdate(0); assert.equal(camera.orthoHeight, height); }
c.cue.clear(); events.emit(E.allianceCityOccupied, { cityInfo: city }); c.lateUpdate(.1);
assert.ok(c.flags.every(f => f.getChildByName('FlagBanner').position.y < 0));
proxy.strategic = true; c.lateUpdate(.1);
assert.equal(c.plate.active, false); assert.equal(c.ground.node.active, false); assert.ok(c.flags.every(f => !f.active));
proxy.strategic = false; c.lateUpdate(0); assert.equal(c.plate.active, true); assert.ok(c.flags.every(f => f.active));
assert.ok(c.flags.every(f => f.getChildByName('FlagBanner').position.y === 0), '总览打断升旗后不能留半截旗');
c.clear(); assert.equal(c.plate.active, false); assert.equal(c.ground.node.active, false);
events.emit(E.allianceCityOccupied, { cityInfo: city }); assert.equal(c.captureTime, 0, '复用为普通资源后不响应旧城池推送');
c.onDisable(); assert.equal(listeners.length, 0);
c.onEnable(); c.setCity({ x: 1, y: 2, level: 4 }, 100, [[-100, 0], [0, 50], [100, 0], [0, -50]]);
assert.equal(c.owner.relation, 'unknown'); assert.ok(c.flags.every(f => !f.active));
c.onDisable(); c.onDestroy(); assert.equal(c.plate, null); assert.equal(listeners.length, 0);
console.log('PASS 缩放不改相机、总览切换、对象池复用、离场名牌/监听清理');
