// 执行真实 ArmyLogic / MarchPlayback，验证路线随显示进度裁切；不连接服务器。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const scripts = path.resolve(__dirname, '../../assets/scripts'), cache = new Map();
let mono = 0, serverStart = 100000;
class Vec2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
class Node {
    constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; }
    addChild(n) { n.parent = this; this.children.push(n); }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    setPosition(x, y) { this.position = { x, y }; }
    setScale() {}
    setSiblingIndex() {}
}
class Graphics {
    clear() { this.points = []; }
    moveTo(x, y) { this.points.push({ x, y }); }
    lineTo(x, y) { this.points.push({ x, y }); }
    stroke() {} ellipse() {} fill() {}
}
class Sprite {}
const cc = { Vec2, Vec3: Vec2, Node, Graphics, Sprite, UITransform: class {}, Animation: class {},
    Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } } };
const project = p => ({ x: (p.x - p.y) * 100, y: -(p.x + p.y) * 50 });
const stubs = {
    'utils/DateUtil': { default: { getServerTime: () => serverStart + mono, monotonicNow: () => mono } },
    'map/MapUtil': { default: { mapCellToPixelPoint: project } },
    'map/entries/MarchFormation': { default: class { configure() {} setGuarding() {} resetTrail() {} update() {} destroy() {} } },
    'world/WorldCommand': { default: { getInstance: () => ({ occupyCountdownAt: () => null }) } },
};
function load(name) {
    if (stubs[name]) return stubs[name];
    if (cache.has(name)) return cache.get(name).exports;
    const file = path.join(scripts, name + '.ts'), mod = { exports: {} }; cache.set(name, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function('require', 'module', 'exports', code)(id => id === 'cc' ? cc : load(
        path.relative(scripts, path.resolve(path.dirname(file), id)).replace(/\\/g, '/')), mod, mod.exports);
    return mod.exports;
}
const ArmyLogic = load('map/entries/ArmyLogic').default;
function entity(points, duration = 10) {
    return { entityId: '9007199254740997', entityType: 2, ownerId: '9007199254740995',
        pos: points[0], path: points, startTime: 100, endTime: 100 + duration };
}
function setup(data, elapsed = 0) {
    mono = 0; serverStart = 100000 + elapsed;
    const logic = new ArmyLogic(), army = new Node('Army'), arrow = new Node('Arrow');
    arrow.addComponent(Sprite); logic.setWorldEntity(data, true, army, arrow);
    const graphics = arrow.getChildByName('WorldMarchRoute').getComponent(Graphics);
    return { logic, army, arrow, graphics };
}
function advance(h, ms) {
    for (let left = ms; left > 0; left -= 100) { mono += Math.min(100, left); h.logic.update(); }
}
function routeIs(h, points) {
    assert.equal(h.graphics.points.length, points.length);
    points.map(project).forEach((p, i) => {
        assert.ok(Math.hypot(h.graphics.points[i].x - p.x, h.graphics.points[i].y - p.y) < .001);
    });
    if (points.length) assert.deepEqual(h.graphics.points[0], h.army.position, '路线头必须贴着当前部队位置');
}

for (const points of [[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 10, y: 0 }, { x: 0, y: 0 }]]) {
    const h = setup(entity(points)); advance(h, 2500);
    routeIs(h, [{ x: points[0].x + (points[1].x - points[0].x) / 4, y: 0 }, points[1]]);
    assert.equal(h.arrow.getComponent(Sprite).enabled, false, '旧箭头图不能与新路线叠加');
}
console.log('PASS 双向行军已走路段消失，线头跟随部队');

const corners = [{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 4, y: 4 }];
const turn = setup(entity(corners, 8));
advance(turn, 2000); routeIs(turn, [{ x: 0, y: 2 }, corners[1], corners[2]]);
advance(turn, 2000); routeIs(turn, [corners[1], corners[2]]);
advance(turn, 1000); routeIs(turn, [{ x: 1, y: 4 }, corners[2]]);
console.log('PASS 未走拐点保留，经过拐点即裁掉，不能切直线穿过转弯');

const loop = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 4 }];
const midway = setup(entity(loop, 12), 8000);
routeIs(midway, [loop[2], loop[3]]);
midway.logic.setWorldEntity(entity(loop, 12), true, midway.army, midway.arrow);
routeIs(midway, [loop[2], loop[3]]);
assert.equal(midway.arrow.children.filter(n => n.name === 'WorldMarchRoute').length, 1);
console.log('PASS 中途进入视野及重复 AOI 不闪回整条线，重叠路径按实际进度裁切');

const changed = { ...entity([{ x: 0, y: 0 }, { x: -2, y: 0 }], 2), startTime: 108, endTime: 110 };
midway.logic.setWorldEntity(changed, true, midway.army, midway.arrow);
routeIs(midway, changed.path); advance(midway, 2000);
assert.equal(midway.arrow.active, false); routeIs(midway, []);
assert.equal(changed.path.length, 2, '显示裁切不得修改服务端路径');
midway.logic.clear();
midway.logic.setWorldEntity({ ...entity([{ x: -2, y: 0 }, { x: -2, y: 2 }], 2), startTime: 110, endTime: 112 },
    true, midway.army, midway.arrow);
routeIs(midway, [{ x: -2, y: 0 }, { x: -2, y: 2 }]);
console.log('PASS 改道替换前方路线，到达清除，对象池复用不留下旧线');

const { aoiTroopMotion, buildMarchPath, sampleMarchPath } = load('world/MarchPath');
const center = { x: 10, y: 10 };
for (const [dx, dy] of [[6, 0], [6, 6], [0, 6], [-6, 6], [-6, 0], [-6, -6], [0, -6], [6, -6]]) {
    const data = entity([center, { x: 10 + dx, y: 10 + dy }], 12), motion = aoiTroopMotion(data);
    const before = JSON.stringify(data), original = buildMarchPath(motion), h = setup(data);
    routeIs(h, data.path);
    assert.deepEqual(h.logic.marchPath.points, data.path, '不能补城门或绕墙拐点');
    for (let i = 1; i <= 120; i++) {
        advance(h, 100);
        const expected = project(sampleMarchPath(motion, original, 100000 + i * 100).position);
        assert.ok(Math.hypot(h.army.position.x - expected.x, h.army.position.y - expected.y) < .00001,
            '出城全过程的位置和速度必须符合后端原始路线');
    }
    assert.equal(JSON.stringify(data), before, '不能修改服务器路线或行军时间');
}
console.log('PASS 八方向从后端起点直接出发，城内外均不改道、不补点、不改速度');

const outbound = entity([center, { x: 4, y: 10 }, { x: 4, y: 16 }], 12);
const depart = setup(outbound);
assert.deepEqual(depart.army.position, project(center));
assert.deepEqual(depart.graphics.points[0], depart.army.position);
advance(depart, 500); const footBefore = { ...depart.army.position };
depart.logic.setWorldEntity(outbound, true, depart.army, depart.arrow);
assert.deepEqual(depart.army.position, footBefore, '重复 AOI 不重新出城');
const late = setup(outbound, 9000);
routeIs(late, [{ x: 4, y: 13 }, { x: 4, y: 16 }]);
const playback = new (load('world/MarchPlayback').default)();
playback.setMotion({ state: 2, path: [], startPos: center, endPos: center, startTime: 0, endTime: 0 }, 100000, 0);
playback.setMotion(aoiTroopMotion(outbound), 100000, 0);
assert.deepEqual(playback.sample(0).position, center, '城内待命直接沿后端起点起步');
console.log('PASS 出城折线、重复推送和中途进视野保持服务器路线，城内待命不跳城门');
