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
