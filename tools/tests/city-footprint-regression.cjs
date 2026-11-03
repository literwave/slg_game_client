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
const cc = { Vec2, v2: (x, y) => new Vec2(x, y), size: (width, height) => ({ width, height }),
    _decorator: {}, Color: class {}, view: { getVisibleSize: () => ({ width: 1280, height: 720 }) } };
const cache = new Map();
function load(file) {
    const full = path.join(scripts, file + '.ts');
    if (cache.has(full)) return cache.get(full);
    const module = { exports: {} }; cache.set(full, module.exports);
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('require', 'module', 'exports', code)(id => {
        if (id === 'cc') return cc;
        if (id.endsWith('/MapCommand')) return { default: {} };
        if (id.endsWith('/DateUtil')) return { default: {} };
        if (id.endsWith('/EventMgr')) return { EventMgr: { emit() {} } };
        if (id.endsWith('/LogicEvent')) return { LogicEvent: {} };
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
        const dy = (1 - Footprint.cityArtAnchorY(city.level) - (row + .5) / shape.rows.length) * height;
        assert.equal(Geometry.systemCityHit(dx, dy, city.level, 200, city), opaque, city.name + ' 显示与点击一致');
        if (opaque) {
            hits++;
            assert.ok(Geometry.systemCityOverlapsTile(dx, dy, city.level, 200, 100, city), '图内空地选框归属城池');
        }
    }
    assert.ok(hits > 50, city.name + ' 具有有效点击轮廓');
    assert.equal(Geometry.systemCityHit(width, height, city.level, 200, city), false);
    assert.equal(Geometry.systemCityOverlapsTile(width, height, city.level, 200, 100, city), false);
}
assert.equal(nearNames.size, 10, '十城近景互不复用');
assert.equal(farNames.size, 10, '十城总览互不复用');
assert.equal(imageHashes.size, 20, '近远景都是真正独立图片');
assert.equal(Art.citySprite(4), 'town-prefecture-v2', '未识别城池保留兼容外观');
assert.equal(Art.citySprite(4, { x: 1, y: 1, name: '洛阳' }), 'town-prefecture-v2', '有坐标时不被错误名称覆盖');
console.log('PASS 十城独立近景/总览、坐标身份、原画哈希、透明拾取与空地选框一致');
