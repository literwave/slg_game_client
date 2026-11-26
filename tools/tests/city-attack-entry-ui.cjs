// 攻城落脚点只用于寻路；点击城外格不再冒充点击城池。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require(process.argv[2]), root = path.resolve(__dirname, '../..');
function load(name, imports) {
    const output = ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/map', name + '.ts'), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, reportDiagnostics: true,
    });
    assert.equal(output.diagnostics.length, 0, name);
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', output.outputText)(id => {
        assert.ok(id in imports, `${name}: ${id}`); return imports[id];
    }, mod, mod.exports);
    return mod.exports;
}
const entrance = { x: 12, y: 10 }, city = { x: 10, y: 10, level: 4, name: '测试城', type: 51, id: 1010, attackEntrances: [entrance] };
const gate = { x: 40, y: 40, level: 4, id: 'gate', attackEntrances: [{ x: 40, y: 43 }] };
const art = { campaign: { width: 100, height: 100, cities: [city], gates: [gate] } };
const campaign = load('WorldCampaign', { './WorldMapArt': { default: art } }).default;
assert.deepEqual(campaign.attackEntrances(10, 10), [entrance]);
assert.equal(campaign.isAttackEntrance(10, 10, entrance), true);
assert.equal(campaign.isAttackEntrance(10, 10, { x: 9, y: 10 }), false, '任意相邻格不自动变成入口');
assert.equal(campaign.isAttackEntrance(10, 10, gate.attackEntrances[0]), false, '别座城的入口不能串用');
assert.equal(campaign.attackEntranceAt(12, 10).city, city);
assert.equal(campaign.attackEntranceAt(40, 43).city, gate);
assert.equal(campaign.attackEntranceAt(10, 10), null, '城中心不是攻击入口');
art.campaign.cities.push({ x: 80, y: 80 });
assert.deepEqual(campaign.attackEntrances(80, 80), [], '缺失配置时不猜测或补建入口');
assert.equal(campaign.attackEntranceAt(81, 80), null);

class Vec2 { constructor(x, y) { this.x = x; this.y = y; } }
class Army {} class Logic {} class Landscape {}
const cc = { Vec2, Component: class {}, Prefab: class {}, Node: class {}, instantiate() {},
    _decorator: { ccclass: () => type => type, property: () => () => {} } };
const util = { tileSize: { width: 200, height: 100 }, isVaildCellPoint: p => p.x >= 0 && p.y >= 0 && p.x < 100 && p.y < 100,
    getIdByCellPoint: (x, y) => x + y * 100, mapCellToPixelPoint: p => new Vec2((p.x - p.y) * 100, -(p.x + p.y) * 50) };
const Touch = load('MapTouchLogic', {
    cc, './MapArmyLogic': { default: Army }, './MapLogic': { default: Logic },
    './MapBuildProxy': {}, './MapCityProxy': {}, './MapProxy': {}, './MapClickUILogic': {}, './MapCommand': {},
    './MapUtil': { default: util }, '../utils/EventMgr': { EventMgr: {} }, '../common/LogicEvent': { LogicEvent: {} },
    './WorldLandscape': { default: Landscape }, './WorldCampaign': { default: campaign },
    './GateGeometry': { gateHit: () => false, gateMirrored: () => false },
    './SystemCityGeometry': { systemCityHit: (dx, dy) => dx === 0 && dy === 0 },
}).default;
const touch = new Touch(), picked = [], followed = [];
let troop = 0, mountainCenter = null;
touch.node = { getComponent: type => type === Army ? { pickTroop: () => troop, troopMapPosition: () => ({ x: 2, y: 2 }) }
    : type === Logic ? { followMapTarget: callback => followed.push(callback()) } : null,
    getComponentInChildren: () => ({ blockerAt: point => mountainCenter && point.x === mountainCenter.x
        && point.y === mountainCenter.y ? new Vec2(31, 30) : null }) };
const empty = { x: 30, y: 30, id: 3030, type: 0, isEmpty: true };
const forest = { x: 32, y: 30, id: 3032, type: 52, level: 3, isEmpty: false };
const landing = { ...entrance, id: entrance.y * 100 + entrance.x, type: 0, isEmpty: true };
touch._cmd = { buildProxy: { getBuild: () => null }, cityProxy: { getCity: () => null },
    proxy: { getResData: id => id === city.id ? city : id === empty.id ? empty : id === forest.id ? forest : id === landing.id ? landing : null,
        getSysCityResData: (x, y) => x === city.x && y === city.y ? city : null },
    isCityArtCoveredCell: (x, y) => x === 13 && y === 10 };
touch.showClickUINode = (data, pixel, attackEntrance) => picked.push({ data, pixel, attackEntrance });
let removed = 0; touch.removeClickUINode = () => removed++;
function click(x, y, informationOnly = false) {
    const point = new Vec2(x, y), pixel = util.mapCellToPixelPoint(point);
    touch.onTouchMap(point, pixel, pixel, informationOnly);
}
click(entrance.x, entrance.y);
assert.equal(picked.at(-1).data, landing, '寻路落脚点仍按普通空地点击，不暗中选择城池');
assert.equal(picked.at(-1).attackEntrance, undefined, 'UI 不携带手动入口上下文');
assert.deepEqual(picked.at(-1).pixel, util.mapCellToPixelPoint(landing));
click(city.x, city.y);
assert.equal(picked.at(-1).data, city);
assert.equal(picked.at(-1).attackEntrance, undefined, '点击城体只查情报，不继承上次入口');
const count = picked.length; click(13, 10);
assert.equal(picked.length, count, '城图覆盖格不能从透明角落透选');
assert.equal(removed, 0, '误点阻挡格保留现有选择');
click(empty.x, empty.y); assert.equal(picked.at(-1).data, empty, '完整露出的普通地块照常可选');
const beforeMountain = picked.length;
mountainCenter = util.mapCellToPixelPoint(forest);
touch.onTouchMap(new Vec2(forest.x, forest.y), mountainCenter,
    new Vec2(mountainCenter.x + 95, mountainCenter.y));
assert.equal(picked.length, beforeMountain, '点击露出的透明角落，不能选中中心被山遮住的林地');
touch.onTouchMap(new Vec2(forest.x, forest.y), mountainCenter, undefined, true);
assert.equal(picked.length, beforeMountain, '坐标定位也不能给被山遮住的资源画空框');
assert.equal(removed, 0, '误点隐藏资源保留原来的有效目标');
mountainCenter = null;
click(forest.x, forest.y); assert.equal(picked.at(-1).data, forest, '无遮挡资源仍可正常选择');
troop = 1; click(city.x, city.y, true);
assert.equal(followed.length, 0, '名牌情报点击不会被部队抢走');
assert.equal(picked.at(-1).data, city); assert.equal(picked.at(-1).attackEntrance, undefined);
console.log('PASS 寻路入口配置、城外空地、城体选择、山体覆盖资源的透明角落/坐标点击阻挡和名牌语义点击');
