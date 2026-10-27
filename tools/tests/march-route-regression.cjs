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
    'map/entries/MarchFormation': { default: class { configure() {} update() {} destroy() {} } },
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
