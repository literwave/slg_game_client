// 整格阻挡几何回归：执行实际 TypeScript，不依赖 Creator、网络或游戏数据写入。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
function loader(overrides = {}) {
    const cache = new Map();
    return function load(name) {
        if (overrides[name]) return overrides[name];
        if (cache.has(name)) return cache.get(name);
        const file = path.join(root, 'assets/scripts/map', name + '.ts');
        const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
        });
        assert.equal(compiled.diagnostics.length, 0, name + ' 语法有效');
        const module = { exports: {} };
        new Function('require', 'module', 'exports', compiled.outputText)(id => load(id.replace('./', '')), module, module.exports);
        cache.set(name, module.exports); return module.exports;
    };
}

// 单个小实心块：同一占地的透明角落仍阻挡，但不能扩大到占地之外。
function synthetic(rows) {
    return loader({
        CityFootprint: { cityArtAsset: () => 'test', cityFootprintRadius: () => 0,
            cityArtLayout: (_level, _iw, _ih, width) => ({ width, height: width / 2,
                fit: { inverse: [1,0,.5,0,-1,.5], upperInverse: [1,0,.5,0,-1,.5] } }) },
        SystemCitySilhouettes: { SYSTEM_CITY_SILHOUETTES: { test: { width: 200, height: 100, columns: 4, rows } } },
    })('SystemCityGeometry');
}
const corner = synthetic(['0', '4', '0', '0']);
assert.equal(corner.systemCityHit(0, 0, 1), false, '格心没有城图像素');
assert.equal(corner.systemCityHit(-40, -20, 1), false, '透明角落没有城图像素');
assert.equal(corner.systemCityHit(25, 12.5, 1), true, '格内边角确有城图像素');
assert.equal(corner.systemCityCoversCell(0, 0, 1), true, '不能从透明角落穿透同一格');
assert.equal(corner.systemCityCoversCell(1, 0, 1), false, '相邻全透明格保持可选');
assert.equal(corner.systemCityCoversCell(0, -1, 1), false, '只与实心像素块角点相切，不吞掉邻格');
const tangent = synthetic(['8', '0', '0', '0']);
assert.equal(tangent.systemCityCoversCell(0, 0, 1), true, '透明角落也属于声明占地');
assert.equal(tangent.systemCityCoversCell(0, -1, 1), false, '不能凭原图的越界像素扩张声明占地');
const empty = synthetic(['0', '0', '0', '0']);
assert.equal(empty.systemCityCoversCell(0, 0, 1), true, '图片尚未加载也不会使城内地块穿透可选');

const load = loader(), geometry = load('SystemCityGeometry');
const cities = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8')).cities;
const cases = [{ level: 4 }, { level: 5 }, { level: 8 }, { level: 10 }, ...cities];
let partiallyCovered = 0, unblocked = 0;
for (const city of cases) {
    const identity = city.name ? { name: city.name } : undefined;
    const center = { x: 137, y: 811 };
    for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) {
        const covered = geometry.systemCityCoversCell(x, y, city.level, 200, 100, identity);
        assert.equal(geometry.systemCityCoversCell(x, y, city.level, 100, 50, identity), covered, '等比例地图缩放不改变覆盖格');
        const absolute = { x: center.x + x, y: center.y + y };
        assert.equal(geometry.systemCityCoversCell(absolute.x - center.x, absolute.y - center.y,
            city.level, 200, 100, identity), covered, '城中心平移不改变局部覆盖');
        const px = (x - y) * 100, py = -(x + y) * 50;
        let solid = false, transparent = false;
        for (const dx of [-80, -40, 0, 40, 80]) for (const dy of [-40, -20, 0, 20, 40]) {
            if (Math.abs(dx) / 100 + Math.abs(dy) / 50 >= 1) continue;
            const hit = geometry.systemCityHit(px + dx, py + dy, city.level, 200, identity);
            if (hit) solid = true; else transparent = true;
        }
        if (solid) assert.equal(covered, true, '任一格内实心采样点均不能漏到可选地块');
        if (solid && transparent) { partiallyCovered++; assert.equal(covered, true); }
        if (!covered) { unblocked++; assert.equal(solid, false); }
    }
}
assert.ok(partiallyCovered > 50, '真实多尺寸城图覆盖大量半透明边缘格');
assert.ok(unblocked > 1000, '城外透明格不会被扩大为矩形阻挡');
assert.equal(geometry.systemCityCoversCell(.5, 0, 10), false);
assert.equal(geometry.systemCityCoversCell(0, 0, 10, 0, 100), false);
assert.equal(geometry.systemCityCoversCell(0, 0, 10, 200, NaN), false);
console.log(`PASS 城图整格阻挡：透明角落、边界相切、${cases.length}种城图/尺寸、平移缩放，${partiallyCovered}个混合格、${unblocked}个透明格`);
