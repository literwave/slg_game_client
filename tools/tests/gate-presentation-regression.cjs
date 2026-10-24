const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
function load(file, imports = {}) {
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, reportDiagnostics: true });
    assert.equal(compiled.diagnostics.length, 0);
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', compiled.outputText)(id => { assert.ok(id in imports, id); return imports[id]; }, mod, mod.exports);
    return mod.exports;
}
const geometry = load('assets/scripts/map/GateGeometry.ts');
const campaign = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));
const hangu = campaign.gates.find(g => g.name === '函谷关');
assert.ok(hangu); assert.equal(geometry.gateWidth(hangu.level), 640);
assert.ok(geometry.gateWidth(5) > 138 * 3);
assert.equal(geometry.GATE_ART, 'mountain_pass_saddle');
const png = fs.readFileSync(path.join(root, 'assets/resources/ui/world/mountain_pass_saddle.png'));
assert.equal(png.readUInt32BE(20) / png.readUInt32BE(16), geometry.GATE_ASPECT);
for (const gate of campaign.gates) {
    const width = geometry.gateWidth(gate.level), height = width * geometry.GATE_ASPECT;
    for (const mirror of [false, true]) {
        assert.ok(geometry.gateHit(0, 0, gate.level, mirror), '门洞地面必须可点击');
        assert.ok(geometry.gateHit(0, height * .35, gate.level, mirror), '放大的中央关楼必须可点击');
        assert.equal(geometry.gateHit(width * .48, height * .65, gate.level, mirror), false, '透明角落不能吞掉山体点击');
        assert.equal(geometry.gateHit(width, 0, gate.level, mirror), false);
        const direction = mirror ? -1 : 1;
        assert.equal(geometry.gateHit(-.28 * width * direction, .10 * height, gate.level, mirror), false, '左侧岩壁不属于关楼');
        assert.equal(geometry.gateHit(.35 * width * direction, -.05 * height, gate.level, mirror), false, '右侧岩壁不属于关楼');
        assert.equal(geometry.gateHit(-.23 * width * direction, -.24 * height, gate.level, mirror), false, '延伸道路不吞掉地图点击');
    }
}
console.log('PASS 18 关隘分级尺寸、实际素材比例、关楼命中与透明角落');

class Vec2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
class UITransform { setContentSize(w, h) { this.width = w; this.height = h; } setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; } }
class Color { static WHITE = {}; constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
const cc = { _decorator: { ccclass: () => t => t, property: () => () => {} }, Component: class {}, Color,
    Sprite: class {}, Node: class {}, UITransform, Vec2, Vec3: Vec2, Label: class {}, Prefab: class {} };
const artCalls = [], ui = new UITransform();
const node = { getComponent: () => ui, setPosition(x, y) { this.position = { x, y }; }, setScale(x, y) { this.scale = { x, y }; } };
const world = { config: campaign, gateAt: (x, y) => campaign.gates.find(g => g.x === x && g.y === y) };
const Res = load('assets/scripts/map/entries/ResLogic.ts', { cc,
    '../MapProxy': { MapResType: { SYS_FORTRESS: 50, WOOD: 52, IRON: 53, STONE: 54, GRAIN: 55 } },
    '../WorldMapArt': { default: { apply(sprite, name, width) { artCalls.push({ name, width }); } } },
    '../WorldCampaign': { default: world }, '../GateGeometry': geometry,
    '../MapUtil': { default: { tileSize: { width: 200, height: 100 } } }, '../ResourceFootprint': {}, '../ui/ManagementStyle': {},
}).default;
const res = new Res(); res.node = { getChildByName: () => null }; res.spr = { node };
res.setResourceData({ ...hangu, type: 50 });
assert.deepEqual(artCalls.at(-1), { name: 'mountain_pass_saddle', width: 640 });
assert.equal(ui.anchorY, geometry.GATE_ANCHOR_Y); assert.equal(node.position.y, 0);
assert.equal(res.spr.trim, false, '岩壁、道路与关楼共用完整画布，锚点不能随裁边漂移');
assert.equal(node.scale.x, geometry.gateMirrored(hangu.x, hangu.y, campaign.width, campaign.height) ? -1 : 1);
res.setResourceData({ x: 0, y: 0, type: 50, level: 5 });
assert.deepEqual(artCalls.at(-1), { name: 'fort', width: 138 }); assert.equal(node.scale.x, 1); assert.equal(ui.anchorY, .25);
assert.equal(res.spr.trim, true);
console.log('PASS 关城使用独立立绘，普通要塞与对象池缩放正确恢复');

const mapUtil = { getIdByCellPoint: (x, y) => y * 1000 + x, isVaildCellPoint: p => p.x >= 0 && p.y >= 0 && p.x < 1000 && p.y < 1000,
    mapCellToPixelPoint: p => new Vec2((p.x - p.y) * 100, -(p.x + p.y) * 50) };
const Touch = load('assets/scripts/map/MapTouchLogic.ts', { cc, './MapClickUILogic': {}, './MapCommand': {}, './MapUtil': { default: mapUtil },
    './WorldCampaign': { default: world }, './GateGeometry': geometry,
    './WorldLandscape': { default: class {} }, './WorldMapArt': { default: {} }, './ui/ManagementStyle': {},
    '../utils/EventMgr': { EventMgr: {} }, '../common/LogicEvent': { LogicEvent: {} },
}).default;
const touch = new Touch(); let selected, blocked;
const target = { ...hangu, type: 50 }, mountain = new Vec2(hangu.x + 2, hangu.y);
touch.node = { getComponentInChildren: () => ({ blockerAt: () => mountain }) };
touch._cmd = { cityProxy: { getCity: () => null }, buildProxy: { getBuild: () => null }, proxy: { getResData: id => id === mapUtil.getIdByCellPoint(hangu.x, hangu.y) ? target : null } };
touch.showClickUINode = data => { selected = data; }; touch.showBlocked = point => { blocked = point; };
const center = mapUtil.mapCellToPixelPoint(hangu);
touch.onTouchMap(mountain, center, new Vec2(center.x, center.y + 60));
assert.equal(selected, target); assert.equal(blocked, undefined, '点击关楼不能选到背后的山体');
selected = null;
touch.onTouchMap(mountain, center, new Vec2(center.x + 600, center.y + 300));
assert.equal(selected, null); assert.equal(blocked, mountain, '山体仍反馈阻挡');
console.log('PASS 真实地图点击路由优先关楼、外围山脉仍阻挡，逻辑通路未扩大');
const home = { x: 12, y: 20, fromWorld: true }; blocked = null;
touch._cmd.cityProxy.getCity = () => home;
touch.onTouchMap(new Vec2(home.x, home.y), new Vec2(0, 0), new Vec2(0, 0));
assert.equal(selected, home); assert.equal(blocked, null, '主城占地不能被背后山体截获');
console.log('PASS 玩家主城占地点击优先于背后山体');
