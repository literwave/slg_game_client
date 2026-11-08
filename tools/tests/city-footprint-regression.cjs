const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
class Vec2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    clone() { return new Vec2(this.x, this.y); }
    add(p) { this.x += p.x; this.y += p.y; return this; }
    subtract(p) { this.x -= p.x; this.y -= p.y; return this; }
}
const campaign = { config: null };
const cc = { Vec2, v2: (x, y) => new Vec2(x, y), size: (width, height) => ({ width, height }),
    Component: class {}, Prefab: class {}, Node: class {},
    _decorator: { ccclass: () => type => type, property: () => () => {} },
    Color: class {}, view: { getVisibleSize: () => ({ width: 1280, height: 720 }) } };
const cache = new Map();
function load(file) {
    const full = path.join(scripts, /\.(?:js|ts)$/.test(file) ? file : file + '.ts');
    if (full.endsWith('.js')) return require(full);
    if (cache.has(full)) return cache.get(full);
    const module = { exports: {} }; cache.set(full, module.exports);
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    new Function('require', 'module', 'exports', code)(id => {
        if (id === 'cc') return cc;
        if (id.endsWith('/MapCommand')) return { default: {} };
        if (id.endsWith('/DateUtil')) return { default: {} };
        if (id.endsWith('/EventMgr')) return { EventMgr: { emit() {} } };
        if (id.endsWith('/LogicEvent')) return { LogicEvent: {} };
        if (id.endsWith('/WorldCampaign')) return { default: campaign };
        if (id.endsWith('/MapArmyLogic') || id.endsWith('/MapLogic')) return { default: class {} };
        if (id.endsWith('/WorldLandscape') || id.endsWith('/MapClickUILogic')) return { default: class {} };
        return load(path.relative(scripts, path.resolve(path.dirname(full), id)));
    }, module, module.exports);
    return module.exports;
}
const MapUtil = load('map/MapUtil').default, Proxy = load('map/MapProxy').default;
const { MapBuildData } = load('map/MapBuildProxy');
const Art = load('map/WorldMapArt').default;
MapUtil.initMapConfig({ node: { getComponent: () => ({ width: 200000, height: 100000, anchorX: .5, anchorY: .5 }) },
    getMapSize: () => ({ width: 1000, height: 1000 }), getTileSize: () => ({ width: 200, height: 100 }) });
const cities = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8')).cities;
const proxy = new Proxy(); proxy._mapSysCityResDatas = cities;
for (const city of cities) {
    const radius = city.footprintRadius;
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
        assert.equal(proxy.getSysCityResData(city.x + dx, city.y + dy), city, '全占地都可点中同一城池');
    }
    assert.equal(proxy.getSysCityResData(city.x + radius + 1, city.y), null);
    const build = new MapBuildData(); build.type = 51; build.level = city.level;
    assert.equal(build.getCellRadius(), radius);
    const edge = new Set(MapUtil.getSideIdsForSysCity(city.x, city.y, city.level));
    assert.equal(edge.size, radius * 8);
    assert.equal(Art.cityArt(city.level), city.art);
    assert.ok(Art.cityWidth(city.level) >= (radius * 2 + 1) * 140);
    const p = MapUtil.mapCellToPixelPoint(new Vec2(city.x, city.y));
    const visible = MapUtil.getVisibleAreaIds(new Vec2(p.x + 640 + Art.cityWidth(city.level) * .45, p.y), 640, 360);
    assert.ok(visible.includes(MapUtil.getAreaIdByCellPoint(city.x, city.y)), '视口边缘大城不能提前裁掉');
}
assert.ok(Art.cityWidth(10) > Art.cityWidth(7) * 1.7);
assert.ok(Art.cityWidth(7) > Art.cityWidth(4) * 1.6);
console.log('PASS 10城池：配置、3/5/9占地、整圈点击、边界、三类立绘尺寸与视口预加载一致');

const Footprint = load('map/CityFootprint');
const Geometry = load('map/SystemCityGeometry');
const masks = load('map/SystemCitySilhouettes').SYSTEM_CITY_SILHOUETTES;
const crypto = require('node:crypto'), nearNames = new Set(), farNames = new Set(), imageHashes = new Set();
assert.equal(Footprint.SYSTEM_CITY_ARTS.length, cities.length, '每座已配置城池都有独立外观');
for (const city of cities) {
    const registration = Footprint.SYSTEM_CITY_ARTS.find(row => row.x === city.x && row.y === city.y);
    assert.equal(registration?.name, city.name, '外观坐标与真实地图对应');
    const near = Art.citySprite(city.level, city), far = Art.cityOverviewSprite(city.level, city);
    assert.equal(near, registration.near);
    assert.equal(far, registration.far);
    assert.equal(Art.citySprite(city.level, { x: city.x, y: city.y }), near, '服务端没有名字也绑定同一原画');
    assert.equal(Art.citySprite(10, city), near, '城池身份不能再次退化为等级分档');
    assert.equal(Footprint.cityArtAsset(city.level, { name: city.name }), near);
    nearNames.add(near); farNames.add(far);
    for (const name of [near, far]) {
        const png = fs.readFileSync(path.join(root, 'assets/resources/ui/world', name + '.png'));
        const hash = crypto.createHash('sha256').update(png).digest('hex');
        imageHashes.add(hash);
        if (name === near) {
            assert.equal(masks[name].sourceHash, hash, '点击轮廓必须由当前原画生成');
            assert.equal(masks[name].width, png.readUInt32BE(16));
            assert.equal(masks[name].height, png.readUInt32BE(20));
        }
    }
    const shape = masks[near], width = Footprint.cityArtWidth(city.level), height = width * shape.height / shape.width;
    let hits = 0;
    for (let row = 4; row < shape.rows.length; row += 7) for (let column = 4; column < shape.columns; column += 7) {
        const opaque = (parseInt(shape.rows[row][column >> 2], 16) & (1 << (column & 3))) !== 0;
        const dx = ((column + .5) / shape.columns - .5) * width;
        const dy = (1 - Footprint.cityArtAnchorY(city.level, city) - (row + .5) / shape.rows.length) * height;
        assert.equal(Geometry.systemCityHit(dx, dy, city.level, 200, city), opaque, city.name + ' 显示与点击一致');
        if (opaque) hits++;
    }
    assert.ok(hits > 50, city.name + ' 具有有效点击轮廓');
    assert.equal(Geometry.systemCityHit(width, height, city.level, 200, city), false);
}
assert.equal(nearNames.size, 10, '十城近景互不复用');
assert.equal(farNames.size, 10, '十城总览互不复用');
assert.equal(imageHashes.size, 20, '近远景都是真正独立图片');
assert.equal(Art.citySprite(4), 'town-prefecture-v2', '未识别城池保留兼容外观');
assert.equal(Art.citySprite(4, { x: 1, y: 1, name: '洛阳' }), 'town-prefecture-v2', '有坐标时不被错误名称覆盖');
console.log('PASS 十城独立近景/总览、坐标身份、原画哈希与透明拾取一致');

// 真实输入路由：城墙边缘同一格内，点草地与点城墙必须分别选择地块和城池。
campaign.config = { cities, gates: [] };
const Touch = load('map/MapTouchLogic').default, touch = new Touch();
const resources = new Map(), buildings = new Map(), playerCities = new Map();
let selected = null, removed = false, mountain = null;
touch._cmd = {
    proxy: { getResData: id => resources.get(id), getSysCityResData: (x, y) => proxy.getSysCityResData(x, y) },
    buildProxy: { getBuild: id => buildings.get(id) }, cityProxy: { getCity: id => playerCities.get(id) },
};
touch.node = { getComponent: () => null, getComponentInChildren: () => ({ blockerAt: () => mountain }) };
touch.showClickUINode = (data, point) => { selected = { data, point }; };
touch.removeClickUINode = () => { removed = true; selected = null; };
function pick(cell, pointer) {
    selected = null; removed = false;
    touch.onTouchMap(cell, MapUtil.mapCellToPixelPoint(cell), pointer);
    return selected?.data;
}
for (const city of cities) {
    resources.set(MapUtil.getIdByCellPoint(city.x, city.y), { ...city, type: 51 });
}
const luoyang = cities.find(city => city.name === '洛阳');
assert.equal(Footprint.cityArtAnchorY(10, luoyang), .44, '已确认的洛阳城图锚点必须用于拾取');
const center = MapUtil.mapCellToPixelPoint(luoyang);
const cityData = resources.get(MapUtil.getIdByCellPoint(luoyang.x, luoyang.y));
let mixedTiles = 0;
const radius = luoyang.footprintRadius;
for (let x = luoyang.x - radius - 2; x <= luoyang.x + radius + 2; x++) {
    for (let y = luoyang.y - radius - 2; y <= luoyang.y + radius + 2; y++) {
        if (proxy.getSysCityResData(x, y)) continue;
        const cell = new Vec2(x, y), p = MapUtil.mapCellToPixelPoint(cell);
        const samples = [];
        for (const dx of [-80, -40, 0, 40, 80]) for (const dy of [-40, -20, 0, 20, 40]) {
            if (Math.abs(dx) / 100 + Math.abs(dy) / 50 >= 1) continue;
            const pointer = new Vec2(p.x + dx, p.y + dy);
            samples.push({ pointer, hit: Geometry.systemCityHit(pointer.x - center.x, pointer.y - center.y, 10, 200, luoyang) });
        }
        const grass = samples.find(sample => !sample.hit), wall = samples.find(sample => sample.hit);
        if (!grass || !wall) continue;
        mixedTiles++;
        const id = MapUtil.getIdByCellPoint(x, y), empty = { id, x, y, type: 0, isEmpty: true };
        resources.set(id, empty);
        assert.equal(pick(cell, grass.pointer), empty, '选框碰到城墙，草地落点仍选择外围空格');
        assert.equal(pick(cell, wall.pointer), cityData, '直接点击城墙仍选择城池');
        const resource = { ...empty, type: 52, isEmpty: false };
        resources.set(id, resource);
        assert.equal(pick(cell, grass.pointer), resource, '外围资源地正常选择');
        const owned = { ...resource, isSysCity: () => false };
        buildings.set(id, owned);
        assert.equal(pick(cell, grass.pointer), owned, '外围已占领地优先使用归属数据');
        buildings.delete(id);
        resources.set(id, { ...empty, isEmpty: false });
        assert.equal(pick(cell, grass.pointer), undefined, '河流或不可通行格仍不可选择');
        assert.equal(removed, false, '不可通行格不清空现有操作');
    }
}
assert.ok(mixedTiles >= 8, '覆盖多个城墙边缘与城门道路，不能只检查一个角');
for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
    const cell = new Vec2(luoyang.x + dx, luoyang.y + dy);
    assert.equal(pick(cell, MapUtil.mapCellToPixelPoint(cell)), cityData, '城池九乘九实际占地仍选城');
}
const playerCell = new Vec2(450, 450), player = { x: 450, y: 450, rid: 7 };
playerCities.set(MapUtil.getIdByCellPoint(450, 450), player);
assert.equal(pick(playerCell, MapUtil.mapCellToPixelPoint(playerCell)), player, '玩家主城拾取不变');
console.log(`PASS ${mixedTiles} 个城边混合格：草地/城墙分开选取，资源地、已占领地、不可通行格与城内占地不回归`);
