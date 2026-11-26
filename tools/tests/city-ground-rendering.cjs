// 执行真实覆盖集合，验证只影响城市画面，不篡改地图与攻城入口数据。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const campaign = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));
const original = JSON.stringify(campaign);
const util = { tileSize: { width: 200, height: 100 } };
const world = { config: null };
const cache = new Map();
function load(name) {
    if (name === 'MapUtil') return { default: util };
    if (name === 'WorldCampaign') return { default: world };
    if (cache.has(name)) return cache.get(name);
    const source = fs.readFileSync(path.join(root, 'assets/scripts/map', name + '.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
    assert.equal(compiled.diagnostics.length, 0, name);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled.outputText)(id => load(id.replace('./', '')), module, module.exports);
    cache.set(name, module.exports); return module.exports;
}
const ground = load('CityGround'), geometry = load('SystemCityGeometry');
assert.equal(ground.systemCityGroundCells().size, 0, '配置就绪前不构造假城池');
world.config = campaign;
const cells = ground.systemCityGroundCells();
assert.equal(ground.systemCityGroundCells(), cells, '同一地图复用稀疏集合');
const logicalCellCount = campaign.cities.reduce((sum, city) => sum + (city.footprintRadius * 2 + 1) ** 2, 0);
assert.equal(cells.size, logicalCellCount, '只能清理实际占地，不能把屋顶阴影扩大成一圈空白');
let artOnly = 0, outside = 0;
for (const city of campaign.cities) {
    for (let dx = -24; dx <= 24; dx++) for (let dy = -24; dy <= 24; dy++) {
        const logical = Math.abs(dx) <= city.footprintRadius && Math.abs(dy) <= city.footprintRadius;
        const covered = geometry.systemCityCoversCell(dx, dy, city.level, 200, 100, city);
        const x = city.x + dx, y = city.y + dy;
        assert.equal(ground.isSystemCityGroundCell(x, y), logical,
            `${city.name} ${dx},${dy} 屋顶遮挡和清理占地必须分离，城外保持原地表`);
        if (covered && !logical) artOnly++;
        if (!covered && !logical) outside++;
    }
    for (const entry of city.attackEntrances) {
        assert.equal(ground.isSystemCityGroundCell(entry.x, entry.y), false,
            `${city.name} 配置攻城入口必须保留野外资源与地景显示资格`);
    }
}
assert.equal(artOnly, 0, '显示已收进占地，城外不能残留隐形阻挡');
assert.ok(outside > 1000);
for (const [x, y] of [[-1, 500], [1000, 500], [500, -1], [500, 1000], [500.5, 500], [NaN, 500]]) {
    assert.equal(ground.isSystemCityGroundCell(x, y), false);
}
util.tileSize = { width: 100, height: 50 };
assert.deepEqual([...ground.systemCityGroundCells()].sort((a,b)=>a-b), [...cells].sort((a,b)=>a-b), '等比例缩放不改变清地集合');
world.config = { ...campaign, cities: [] };
assert.equal(ground.systemCityGroundCells().size, 0, '换图丢弃旧城缓存');
assert.equal(JSON.stringify(campaign), original, '资源/占地/入口数据不被修改');
console.log(`PASS 城池实际占地：${cells.size}格清理地表；城外零隐形阻挡；初始化/缓存/换图/缩放/越界`);
