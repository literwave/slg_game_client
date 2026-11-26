const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
function load(file, imports = {}) {
    imports = { './MapProjection': require('./map-projection-module.cjs')(ts), '../MapProjection': require('./map-projection-module.cjs')(ts), ...imports };
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, reportDiagnostics: true });
    assert.equal(compiled.diagnostics.length, 0);
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', compiled.outputText)(id => {
        if (id === './CityArtFit' || id === './SystemCitySilhouettes') return load('assets/scripts/map/' + id.slice(2) + '.ts');
        assert.ok(id in imports, id); return imports[id];
    }, mod, mod.exports);
    return mod.exports;
}
const bridgeShape = load('assets/scripts/map/BridgeSilhouette.ts');
const geometry = load('assets/scripts/map/GateGeometry.ts', { './BridgeSilhouette': bridgeShape });
const cityFootprint = load('assets/scripts/map/CityFootprint.ts');
const cityShapes = load('assets/scripts/map/SystemCitySilhouettes.ts');
const { cityArtToFootprint } = load('assets/scripts/map/CityArtFit.ts');
const cityGeometry = load('assets/scripts/map/SystemCityGeometry.ts', {
    './CityFootprint': cityFootprint, './SystemCitySilhouettes': cityShapes,
});
const campaign = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));
const hangu = campaign.gates.find(g => g.name === '函谷关');
assert.ok(hangu); assert.equal(geometry.gateWidth(hangu.level), 1268);
assert.ok(geometry.gateWidth(5) > 138 * 5);
assert.equal(geometry.GATE_ART, 'mountain-pass-5x7-v10');
const png = fs.readFileSync(path.join(root, `assets/resources/ui/world/${geometry.GATE_ART}.png`));
assert.equal(require('node:crypto').createHash('sha256').update(png).digest('hex'), geometry.GATE_ART_SHA256,
    '关城换图后必须重新校准墙脚描边和点击轮廓');
assert.equal(png.readUInt32BE(20) / png.readUInt32BE(16) * geometry.GATE_HEIGHT_SCALE, geometry.GATE_ASPECT);
const bridgePng = fs.readFileSync(path.join(root, `assets/resources/ui/world/${geometry.BRIDGE_ART}.png`));
assert.equal(bridgePng.readUInt32BE(20) / bridgePng.readUInt32BE(16) * geometry.BRIDGE_HEIGHT_SCALE, geometry.BRIDGE_ASPECT);
for (const gate of campaign.gates) {
    const bridge = gate.crossing === 'bridge';
    const width = geometry.gateWidth(gate.level, gate), height = bridge ? geometry.gateHeight(gate.level, gate) : 600;
    assert.equal(geometry.gateMirrored(gate.x, gate.y, campaign.width, campaign.height, gate), gate.axis === 'x');
    if (bridge) assert.ok(Math.abs(width - geometry.BRIDGE_WIDTH_TILES * 200) < .001,
        '独立河心水寨采用紧凑统一体量，不再拉长连接两岸');
    for (const mirror of [false, true]) {
        assert.ok(geometry.gateHit(0, 0, gate.level, mirror, gate), '中央关楼地面必须可点击');
        const roofX = bridge ? (.56 - geometry.BRIDGE_ANCHOR_X) * width * (mirror ? -1 : 1) : 0;
        const roofY = bridge ? (1 - .18 - geometry.BRIDGE_ANCHOR_Y) * height : height * .22;
        assert.ok(geometry.gateHit(roofX, roofY, gate.level, mirror, gate), '实际关楼屋顶必须可点击');
        assert.equal(geometry.gateHit(width * .48, height * .65, gate.level, mirror, gate), false, '透明角落不能吞掉地块点击');
        assert.equal(geometry.gateHit(width, 0, gate.level, mirror, gate), false);
        const direction = mirror ? -1 : 1;
        if (bridge) {
            const hit = (x, y) => geometry.gateHit((x - geometry.BRIDGE_ANCHOR_X) * width * direction,
                (1 - y - geometry.BRIDGE_ANCHOR_Y) * height, gate.level, mirror, gate);
            assert.ok(hit(.24, .75), '西南渡口木栈桥可点击'); assert.ok(hit(.76, .75), '东南渡口木栈桥可点击');
            assert.ok(hit(.42, .46), '水中关寨内院可点击');
            assert.equal(hit(.06, .90), false, '无连接桥，西南外侧河面保持透明不吞点击');
            assert.equal(hit(.94, .10), false, '无连接桥，东北外侧河面保持透明不吞点击');
        } else {
            const hit = (x, y) => geometry.gateHit((x - .5) * width * direction,
                (.5 - y) * height, gate.level, mirror, gate);
            assert.ok(hit(.10, .46), '左角楼可点击'); assert.ok(hit(.90, .54), '右角楼可点击');
            assert.ok(hit(.33, .67), '前城门可点击'); assert.ok(hit(.65, .30), '后城门可点击');
            for (const [x, y] of [[.55,.94], [.58,.85], [.42,.78], [.56,.81]]) {
                assert.ok(hit(x, y), '前城墙、角楼下缘和基脚都必须命中关城');
            }
            assert.equal(hit(.14, .94), false, '前方土路不吞掉实际地块点击');
            assert.equal(hit(.91, .17), false, '后方土路不吞掉实际地块点击');
            assert.equal(hit(.20, .88), false, '城基外的草地不能归入关城');
            const outline = geometry.gateGroundOutline(gate.level, mirror, gate);
            const expectedOutline = mirror
                ? [[-600,-50],[100,300],[600,50],[-100,-300]]
                : [[-600,50],[-100,300],[600,-50],[100,-300]];
            assert.deepEqual(outline, expectedOutline, '关隘轮廓必须对齐 5×7 地块边界');
        }
    }
}
console.log('PASS 18 关隘分级尺寸、实际素材比例、关楼命中与透明角落');

assert.equal(require('node:crypto').createHash('sha256').update(bridgePng).digest('hex'),
    bridgeShape.BRIDGE_SILHOUETTE.sourceHash, '桥图换图后必须同步拾取轮廓');
for (const span of [8, 10, 12, 16]) for (const mirror of [false, true]) {
    const gate = { crossing: 'bridge', bridgeSpan: span }, width = geometry.gateWidth(5, gate), height = width * geometry.BRIDGE_ASPECT;
    const hit = (u, v) => geometry.gateHit((u - geometry.BRIDGE_ANCHOR_X) * width * (mirror ? -1 : 1),
        (1 - v - geometry.BRIDGE_ANCHOR_Y) * height, 5, mirror, gate);
    for (const p of [[.24,.75],[.30,.65],[.42,.46],[.56,.18],[.50,.82],[.66,.65],[.76,.75],[.78,.33],[.24,.36],[.50,.56]]) {
        assert.ok(hit(...p), '独立河心水寨、主关楼、木栅与渡口栈桥均命中 ' + p);
    }
    for (const p of [[.04,.92],[.06,.90],[.94,.10],[.10,.20],[.90,.20],[.12,.92],[.92,.92],[.50,.97],[.04,.55],[.96,.55]]) {
        assert.equal(hit(...p), false, '独立水寨周边开放水面不吞掉河面/地块点击 ' + p);
    }
    for (const [x, y] of [[NaN,0],[0,Infinity],[Infinity,0]]) assert.equal(geometry.gateHit(x,y,5,mirror,gate), false);
    const paths = geometry.gateSelectionPaths(5, mirror, gate);
    assert.equal(paths.length, 3, '独立水寨使用紧贴基脚的 3 处选区角标');
    assert.ok(paths.flat().every(([x,y])=>Math.abs(x)<width*.5&&Math.abs(y)<height*.5), '选区角标全部收在水寨本体范围内');
}
console.log('PASS 桥关新图轮廓、桥墩/石桥面、旧土路透点、透明拱洞、两种朝向和 4 种跨度');


class Vec2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
class UITransform { setContentSize(w, h) { this.width = w; this.height = h; } setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; } }
class Color { static WHITE = {}; constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
const cc = { _decorator: { ccclass: () => t => t, property: () => () => {} }, Component: class {}, Color,
    Sprite: class {}, Node: class {}, UITransform, Vec2, Vec3: Vec2, Label: class {}, Prefab: class {} };
const artCalls = [], ui = new UITransform();
const node = { getComponent: () => ui, setPosition(x, y) { this.position = { x, y }; }, setScale(x, y) { this.scale = { x, y }; } };
const world = load('assets/scripts/map/WorldCampaign.ts', { './WorldMapArt': { default: { campaign } } }).default;
const Res = load('assets/scripts/map/entries/ResLogic.ts', { cc,
    '../CityOwnershipView': { default: class {} },
    '../CityAmbientView': { default: class {} },
    '../MapProxy': { MapResType: { SYS_FORTRESS: 50, WOOD: 52, IRON: 53, STONE: 54, GRAIN: 55 } },
    '../WorldMapArt': { default: { apply(sprite, name, width) { artCalls.push({ name, width }); },
        applyGate(sprite, level, gate, tileWidth) { artCalls.push({ name: geometry.GATE_ART, width: tileWidth * geometry.GATE_WIDTH_TILES }); } } },
    '../WorldCampaign': { default: world }, '../GateGeometry': geometry,
    '../MapUtil': { default: { tileSize: { width: 200, height: 100 } } }, '../ResourceFootprint': {}, '../ui/ManagementStyle': {},
}).default;
const res = new Res(); res.node = { getChildByName: () => null, getComponent: () => ({ clear() {}, setCity() {}, setGate() {} }) }; res.spr = { node };
res.setResourceData({ ...hangu, type: 50 });
assert.deepEqual(artCalls.at(-1), { name: geometry.GATE_ART, width: 1268 });
assert.equal(ui.anchorX, geometry.GATE_ANCHOR_X);
assert.equal(ui.anchorY, geometry.GATE_ANCHOR_Y); assert.equal(node.position.y, 0);
assert.equal(res.spr.trim, false, '关城与道路共用完整画布，锚点不能随裁边漂移');
assert.equal(node.scale.x, geometry.gateMirrored(hangu.x, hangu.y, campaign.width, campaign.height) ? -1 : 1);
const bridge = campaign.gates.find(g => g.crossing === 'bridge');
res.setResourceData({ ...bridge, type: 50 });
assert.deepEqual(artCalls.at(-1), { name: geometry.BRIDGE_ART, width: geometry.gateWidth(bridge.level, bridge) });
assert.equal(ui.anchorX, geometry.BRIDGE_ANCHOR_X); assert.equal(ui.anchorY, geometry.BRIDGE_ANCHOR_Y);
assert.equal(ui.height * node.scale.y, geometry.gateHeight(bridge.level, bridge)); assert.equal(res.spr.trim, false);
res.setResourceData({ x: 0, y: 0, type: 50, level: 5 });
assert.deepEqual(artCalls.at(-1), { name: 'fort', width: 138 }); assert.equal(node.scale.x, 1); assert.equal(ui.anchorY, .25);
assert.equal(res.spr.trim, true);
console.log('PASS 关城使用独立立绘，普通要塞与对象池缩放正确恢复');

const mapUtil = { tileSize: { width: 200, height: 100 }, getIdByCellPoint: (x, y) => y * 1000 + x, isVaildCellPoint: p => p.x >= 0 && p.y >= 0 && p.x < 1000 && p.y < 1000,
    mapCellToPixelPoint: p => new Vec2((p.x - p.y) * 100, -(p.x + p.y) * 50) };
const Touch = load('assets/scripts/map/MapTouchLogic.ts', { cc, './MapClickUILogic': {}, './MapCommand': {}, './MapUtil': { default: mapUtil },
    './MapArmyLogic': { default: class {} }, './MapLogic': { default: class {} },
    './WorldCampaign': { default: world }, './GateGeometry': geometry,
    './SystemCityGeometry': cityGeometry,
    './WorldLandscape': { default: class {} }, './WorldMapArt': { default: {} }, './ui/ManagementStyle': {}, './TileHighlight': {},
    '../utils/EventMgr': { EventMgr: {} }, '../common/LogicEvent': { LogicEvent: {} },
}).default;
const touch = new Touch(); let selected, blocked;
const target = { ...hangu, type: 50 }, mountain = new Vec2(hangu.x + 3, hangu.y);
touch.node = { getComponent: () => null, getComponentInChildren: () => ({ blockerAt: () => mountain }) };
touch._cmd = { isCityArtCoveredCell: (x,y) => campaign.cities.some(city => cityGeometry.systemCityCoversCell(x-city.x,y-city.y,city.level,200,100,city)),
    cityProxy: { getCity: () => null }, buildProxy: { getBuild: () => null }, proxy: {
    getSysCityResData: () => null, getResData: id => id === mapUtil.getIdByCellPoint(hangu.x, hangu.y) ? target : null } };
touch.showClickUINode = data => { selected = data; }; touch.showBlocked = point => { blocked = point; };
const center = mapUtil.mapCellToPixelPoint(hangu);
touch.onTouchMap(mountain, center, new Vec2(center.x, center.y + 60));
assert.equal(selected, target); assert.equal(blocked, undefined, '点击关楼不能选到背后的山体');
for (const [x, y] of [[.55,.94], [.58,.85], [.42,.78], [.56,.81]]) {
    selected = null; blocked = null;
    const width = geometry.gateWidth(hangu.level, hangu), height = 600;
    const direction = geometry.gateMirrored(hangu.x, hangu.y, campaign.width, campaign.height, hangu) ? -1 : 1;
    touch.onTouchMap(mountain, center, new Vec2(center.x + (x - geometry.GATE_ANCHOR_X) * width * direction,
        center.y + (.5 - y) * height));
    assert.equal(selected, target); assert.equal(blocked, null, '前城墙不能弹出山脉阻挡提示');
}
selected = target;
touch.onTouchMap(mountain, center, new Vec2(center.x + 1000, center.y + 500));
assert.equal(selected, target); assert.equal(blocked, null, '点击山体静默保留原关隘选择');
console.log('PASS 真实地图点击路由优先关楼、外围山脉仍阻挡，逻辑通路未扩大');
const home = { x: 12, y: 20, fromWorld: true }; blocked = null;
touch._cmd.cityProxy.getCity = () => home;
touch.onTouchMap(new Vec2(home.x, home.y), new Vec2(0, 0), new Vec2(0, 0));
assert.equal(selected, home); assert.equal(blocked, null, '主城占地不能被背后山体截获');
console.log('PASS 玩家主城占地点击优先于背后山体');

for (const [art, shape] of Object.entries(cityShapes.SYSTEM_CITY_SILHOUETTES)) {
    const bytes = fs.readFileSync(path.join(root, 'assets/resources/ui/world', art + '.png'));
    assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), shape.sourceHash, '换图后必须同步点击轮廓');
}
touch._cmd.cityProxy.getCity = () => null;
touch.node = { getComponent: () => null, getComponentInChildren: () => null };
for (const city of campaign.cities) {
    const radius = cityFootprint.cityFootprintRadius(city.level), id = mapUtil.getIdByCellPoint(city.x, city.y);
    const cityData = { ...city, id, type: 51, isEmpty: false };
    const ground = { x: city.x + radius + 2, y: city.y + radius + 1, type: 0, isEmpty: true };
    touch._cmd.proxy.getResData = key => key === id ? cityData : ground;
    touch._cmd.proxy.getSysCityResData = (x, y) => Math.abs(x - city.x) <= radius && Math.abs(y - city.y) <= radius ? cityData : null;
    const art = cityFootprint.cityArtAsset(city.level, city);
    const shape = cityShapes.SYSTEM_CITY_SILHOUETTES[art];
    const layout = cityFootprint.cityArtLayout(city.level, shape.width, shape.height, 200, 100, city);
    const center = mapUtil.mapCellToPixelPoint(city);
    const pointer = (u, v) => {
        const p = cityArtToFootprint(layout.fit,u,v);
        return new Vec2(center.x+p.x*layout.width,center.y+p.y*layout.height);
    };
    // 每城楼顶位置不同；从新原画的上、中、下轮廓取真实不透明采样点。
    const samples = [.12, .5, .9].map(v => {
        const row = Math.floor(v * shape.rows.length), columns = [];
        for (let x = 0; x < shape.columns; x++) if (parseInt(shape.rows[row][x >> 2], 16) & (1 << (x & 3))) columns.push(x);
        assert.ok(columns.length, city.name + ' 分层轮廓有效');
        const x = columns.reduce((a, b) => Math.abs(a - shape.columns / 2) < Math.abs(b - shape.columns / 2) ? a : b);
        return [(x + .5) / shape.columns, (row + .5) / shape.rows.length];
    });
    for (const [u, v] of samples) {
        selected = null; touch.onTouchMap(new Vec2(ground.x, ground.y), mapUtil.mapCellToPixelPoint(ground), pointer(u, v));
        assert.equal(selected, cityData, city.name + ' 的道路、城楼、城墙属于同一个可点实体');
    }
    const cornerPointer = pointer(1.1, -.2);
    const corner = { x: city.x + Math.round((cornerPointer.x - center.x) / 200 - (cornerPointer.y - center.y) / 100),
        y: city.y + Math.round(-(cornerPointer.x - center.x) / 200 - (cornerPointer.y - center.y) / 100), type: 0, isEmpty: true };
    touch._cmd.proxy.getResData = key => key === id ? cityData : corner;
    selected = null; touch.onTouchMap(new Vec2(corner.x, corner.y), mapUtil.mapCellToPixelPoint(corner), cornerPointer);
    assert.equal(selected, corner, '透明角落不能吞掉周围空地');
    touch._cmd.proxy.getResData = key => key === id ? cityData : ground;
    selected = null; touch.onTouchMap(new Vec2(city.x + radius, city.y), center);
    assert.equal(selected, cityData, '实际占地内的空白格不能误报空地');
    const owned = { ...cityData, rid: '9007199254740993' }; touch._cmd.buildProxy.getBuild = key => key === id ? owned : null;
    touch.onTouchMap(new Vec2(ground.x, ground.y), mapUtil.mapCellToPixelPoint(ground), pointer(...samples[2]));
    assert.equal(selected, owned, '拾取后仍使用服务端城池归属');
    touch._cmd.buildProxy.getBuild = () => null;
}
console.log('PASS 10 座系统城：真实透明轮廓、截图道路点击、占地空白格、透明角落和归属一致');

for (const city of campaign.cities) {
    const level = city.level, label = city.name + ' 占地边缘';
    const centerPixel = mapUtil.mapCellToPixelPoint(city);
    const logicalRadius = cityFootprint.cityFootprintRadius(level);
    let checked = 0;
    for (let x = -logicalRadius - 5; x <= logicalRadius + 5; x++) {
        for (let y = -logicalRadius - 5; y <= logicalRadius + 5; y++) {
            if (Math.abs(x) <= logicalRadius && Math.abs(y) <= logicalRadius) continue;
            const pixel = mapUtil.mapCellToPixelPoint({ x: city.x + x, y: city.y + y });
            const dx = pixel.x - centerPixel.x, dy = pixel.y - centerPixel.y;
            for (const [sx,sy] of [[0,0],[-60,0],[60,0],[0,-30],[0,30]]) {
                assert.equal(cityGeometry.systemCityHit(dx+sx,dy+sy,level,200,city),false,label+' 不跨出格子');
                checked++;
            }
        }
    }
    assert.ok(checked > 100,label+' 检查四边外围');
    const offsetX = logicalRadius+1, offsetY = logicalRadius+1;
    const id = mapUtil.getIdByCellPoint(city.x, city.y);
    const ground = { x: city.x + offsetX, y: city.y + offsetY, type: 0, isEmpty: true };
    const pixel = mapUtil.mapCellToPixelPoint(ground);
    const cityData = { ...city, id, type: 51, isEmpty: false };
    touch._cmd.proxy.getSysCityResData = () => null;
    touch._cmd.proxy.getResData = key => key === id ? cityData : ground;
    touch._cmd.buildProxy.getBuild = () => null;
    selected = null; touch.onTouchMap(new Vec2(ground.x, ground.y), pixel, pixel);
    assert.equal(selected, ground, label + ' 城外空地可选择');
    selected = null; touch.onTouchMap(new Vec2(ground.x, ground.y), pixel);
    assert.equal(selected, ground, '坐标定位也能选城外地块');
    const ownedCity = { ...cityData, rid: '9007199254740993' };
    touch._cmd.buildProxy.getBuild = key => key === id ? ownedCity : null;
    touch.onTouchMap(new Vec2(ground.x, ground.y), pixel, pixel);
    assert.equal(selected, ground, '城池归属不会扩大阻挡范围');
    touch._cmd.buildProxy.getBuild = () => null;
    const resource = { ...ground, type: 55, isEmpty: false };
    touch._cmd.proxy.getResData = key => key === id ? cityData : resource;
    touch.onTouchMap(new Vec2(ground.x, ground.y), pixel, pixel);
    assert.equal(selected, resource, '紧邻城池的资源正常选择');
    const ownedLand = { ...ground, rid: '42', isSysCity: () => false };
    touch._cmd.buildProxy.getBuild = key => key === mapUtil.getIdByCellPoint(ground.x, ground.y) ? ownedLand : null;
    touch.onTouchMap(new Vec2(ground.x, ground.y), pixel, pixel);
    assert.equal(selected, ownedLand, '紧邻城池的领地保留归属');
    touch._cmd.buildProxy.getBuild = () => null;
}
for (const level of [4, 7, 10]) {
    assert.equal(cityGeometry.systemCityHit(10000, 10000, level), false, '远处空地保持可点');
    assert.equal(cityGeometry.systemCityHit(NaN, 0, level), false);
    assert.equal(cityGeometry.systemCityHit(0, 0, level, 0), false);
}
console.log('PASS 十城显示不越界，相邻空地/资源/领地与坐标定位不被隐形阻挡');


for (const gate of campaign.gates.filter(g=>g.crossing==='bridge')) {
    const center=mapUtil.mapCellToPixelPoint(gate), width=geometry.gateWidth(gate.level,gate), height=width*geometry.BRIDGE_ASPECT;
    const bridgeTarget={...gate,type:50,rid:'42'}, land={x:gate.x-6,y:gate.y+2,type:0,isEmpty:true};
    touch._cmd.proxy.getSysCityResData=()=>null;
    touch._cmd.proxy.getResData=id=>id===mapUtil.getIdByCellPoint(gate.x,gate.y)?bridgeTarget:land;
    touch._cmd.buildProxy.getBuild=()=>null;
    const pixel=(u,v)=>new Vec2(center.x+(u-geometry.BRIDGE_ANCHOR_X)*width,center.y+(1-v-geometry.BRIDGE_ANCHOR_Y)*height);
    for (const [u,v] of [[.24,.75],[.42,.46],[.56,.18],[.76,.75],[.78,.33]]) {
        selected=null;touch.onTouchMap(land,mapUtil.mapCellToPixelPoint(land),pixel(u,v));
        assert.equal(selected,bridgeTarget,'水寨本体与渡口栈桥点击必须打开同一关隘和服务器归属');
    }
    selected=null;touch.onTouchMap(land,mapUtil.mapCellToPixelPoint(land),pixel(.06,.90));
    assert.equal(selected,land,'外围河面仍选择实际地块');
    selected=null;touch.onTouchMap(land,mapUtil.mapCellToPixelPoint(land),pixel(.94,.10));
    assert.equal(selected,land,'无连接桥的外围河面直接选中地图地块');
    const resource={...land,type:55,isEmpty:false};
    touch._cmd.proxy.getResData=id=>id===mapUtil.getIdByCellPoint(gate.x,gate.y)?bridgeTarget:resource;
    touch.onTouchMap(resource,mapUtil.mapCellToPixelPoint(land),pixel(.12,.92));assert.equal(selected,resource);
    const owned={...land,isSysCity:()=>false,rid:'9007199254740993'};
    touch._cmd.buildProxy.getBuild=id=>id===mapUtil.getIdByCellPoint(land.x,land.y)?owned:null;
    touch.onTouchMap(owned,mapUtil.mapCellToPixelPoint(land),pixel(.12,.92));assert.equal(selected,owned,'周边已占领地可正常操作');
}
console.log('PASS 6 座桥关桥头/桥墩真实点击路由，周边空地/资源/领地与归属保持正确');

const Strategic = load('assets/scripts/map/WorldStrategicMap.ts', {
    './PlayerCityGround': { default: {} },
    '../world/CityCommand': {}, '../login/LoginCommand': {}, '../utils/EventMgr': {}, '../common/LogicEvent': {},
    './CityOwnership': {}, './CityMapPresentation': {},
    './CityFootprint': cityFootprint,
    cc: { ...cc, view: { getVisibleSize: () => ({ width: 1280, height: 720 }) } },
    './MapCommand': {}, './MapUtil': { default: mapUtil }, './WorldCampaign': { default: world },
    './WorldMapArt': {}, './GateGeometry': geometry, './ui/ManagementStyle': {},
    './PlayerCityAppearance': load('assets/scripts/map/PlayerCityAppearance.ts'),
}).default;
const strategic = new Strategic(); strategic.root = { active: true }; strategic.lateUpdate = () => {};
const marker = { gate: hangu, node: { active: true, scale: { x: 1, y: 1 } }, plate: { node: { active: true } }, x: 100, y: 200, artHeight: 42 };
strategic.gateMarkers = [marker];
for (const height of [3000, 12000, 60000]) {
    strategic.camera = { orthoHeight: height }; const scale = height * 2 / 720;
    marker.node.scale = { x: scale, y: scale };
    assert.equal(strategic.pickGate(new Vec2(100 + 12 * scale, 200 + 24 * scale)), hangu, '远景图标保持可点尺寸');
    assert.equal(strategic.pickGate(new Vec2(100 + 42 * scale, 200 - 22 * scale)), hangu, '名称牌也可以点');
    assert.equal(strategic.pickGate(new Vec2(100 + 62 * scale, 200 - 22 * scale)), null, '名称牌外仍然点击地图');
    marker.plate.node.active = false;
    assert.equal(strategic.pickGate(new Vec2(100 + 42 * scale, 200 - 22 * scale)), null, '隐藏名称不产生隐形点击区');
    marker.plate.node.active = true;
}
marker.node.active = false;
assert.equal(strategic.pickGate(new Vec2(100, 200)), null);
console.log('PASS 远景关城图标和名称命中随缩放保持一致，隐藏标记不拦截地图');

const city = campaign.cities[0];
const title = { active: true, position: {}, scale: {}, getComponent: () => ({ width: 100, height: 28 }) };
const cityMarker = { city, node: { active: true, scale: {} }, title, x: 100, y: 200, width: 42, height: 28 };
strategic.cityMarkers = [cityMarker];
for (const height of [3000, 12000, 60000]) {
    strategic.camera = { orthoHeight: height }; const scale = height * 2 / 720;
    const density = scale > 80 ? .86 : 1;
    cityMarker.node.scale = { x: scale * density, y: scale * density };
    title.scale = { x: scale, y: scale }; title.position = { x: 100, y: 200 + 38 * scale };
    assert.equal(strategic.pickCity(new Vec2(100 + 20 * scale * density, 200)), city, '缩远后的完整城图仍能点中');
    assert.equal(strategic.pickCity(new Vec2(100 + 42 * scale, 200 + 38 * scale)), city, '州名定位对应城池');
    assert.equal(strategic.pickCity(new Vec2(100 + 35 * scale, 200 - 20 * scale)), null, '图标外不扩大真实城池占地');
    title.active = false;
    assert.equal(strategic.pickCity(new Vec2(100 + 42 * scale, 200 + 38 * scale)), null, '隐藏州名没有隐形命中区');
    title.active = true;
}
cityMarker.node.active = false;
assert.equal(strategic.pickCity(new Vec2(100, 200)), null);
console.log('PASS 总览城池图标和州名命中，稀疏与密集缩放、隐藏标记均一致');

{
const home = { x: 385, y: 828, level: 10 };
const homeNode = { active: true, position: { x: 100, y: 200 }, scale: { x: 1, y: 1 } };
const homePlate = { node: { active: true, position: { x: 0, y: -25 } } };
strategic.homeMarker = { node: homeNode, city: home, plate: homePlate, height: 26 };
for (const scale of [8, 33, 181]) {
    homeNode.scale = { x: scale, y: scale };
    assert.equal(strategic.pickHome(new Vec2(100 + 18 * scale, 200)), home);
    assert.equal(strategic.pickHome(new Vec2(100 + 30 * scale, 200 - 25 * scale)), home);
    assert.equal(strategic.pickHome(new Vec2(100 + 40 * scale, 200 - 25 * scale)), null);
    homePlate.node.active = false;
    assert.equal(strategic.pickHome(new Vec2(100 + 30 * scale, 200 - 25 * scale)), null);
    homePlate.node.active = true;
}
homeNode.active = false;
assert.equal(strategic.pickHome(new Vec2(100, 200)), null);
homeNode.active = true; strategic.root.active = false;
assert.equal(strategic.pickHome(new Vec2(100, 200)), null);
console.log('PASS 主城图标和名称点击范围随缩放一致，隐藏或退出总览后不拦截地图');

}
