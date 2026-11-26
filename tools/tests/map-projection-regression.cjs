// 执行真实地图初始化、正反坐标转换和美术拾取；不操作运行中的游戏。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require(process.argv[2]), root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
class Vec2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    clone() { return new Vec2(this.x, this.y); }
    add(p) { this.x += p.x; this.y += p.y; return this; }
    subtract(p) { this.x -= p.x; this.y -= p.y; return this; }
}
class UITransform {
    anchorX = .5; anchorY = .5;
    setContentSize(width, height) { Object.assign(this, { width, height }); }
}
class TiledMap {
    metric(name) { return Number(this.tmxAsset.tmxXmlStr.match(new RegExp(`\\b${name}="(\\d+)"`))[1]); }
    getMapSize() { return { width: this.metric('width'), height: this.metric('height') }; }
    getTileSize() { return { width: this.metric('tilewidth'), height: this.metric('tileheight') }; }
}
const cc = { Vec2, UITransform, TiledMap, TiledMapAsset: class {}, Component: class {}, Node: class {},
    size: (width, height) => ({ width, height }), v2: (x, y) => new Vec2(x, y),
    view: { getVisibleSize: () => ({ width: 1280, height: 720 }) },
    _decorator: { ccclass: () => Type => Type, property: () => () => {} } };
const actual = new Set(['scene/MapScene', 'map/MapProjection', 'map/MapUtil', 'map/CityFootprint',
    'map/CityArtFit',
    'map/SystemCityGeometry', 'map/SystemCitySilhouettes', 'map/GateGeometry', 'map/BridgeSilhouette',
    'map/PlayerCityAppearance', 'map/PlayerCityArtFit', 'map/PlayerCityGround', 'map/ResourceFootprint']);
const cache = new Map();
function load(key) {
    if (!actual.has(key)) return {};
    if (cache.has(key)) return cache.get(key);
    const file = path.join(scripts, key + '.ts'), module = { exports: {} };
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, reportDiagnostics: true });
    assert.deepEqual(compiled.diagnostics, [], key);
    new Function('require', 'module', 'exports', compiled.outputText)(id => id === 'cc' ? cc
        : load(path.relative(scripts, path.resolve(path.dirname(file), id)).replaceAll('\\', '/')), module, module.exports);
    cache.set(key, module.exports); return module.exports;
}
const near = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-7, `${message}: ${a} != ${b}`);
const projection = load('map/MapProjection'), MapScene = load('scene/MapScene').default, util = load('map/MapUtil').default;
const original = '<map version="1.10" orientation="isometric" width="1000" height="1000" tilewidth="200" tileheight="100"><layer>not-decoded</layer></map>';
const scene = new MapScene(), ui = new UITransform();
scene._cmd = { proxy: { tiledMapAsset: { tmxXmlStr: original } } };
scene.mapLayer = { getComponent: () => ui, addComponent(Type) { const object = new Type(); object.node = this; return object; } };
const map = scene.initializeMapGeometry(); util.initMapConfig(map);
assert.equal(scene._cmd.proxy.tiledMapAsset.tmxXmlStr, original, '来源 TMX 和服务端格子定义不改写');
assert.equal(map.tmxAsset.tmxXmlStr.includes('<layer'), false, '不能为改视角重新构建百万瓦片');
assert.deepEqual(map.getMapSize(), { width: 1000, height: 1000 });
assert.deepEqual(map.getTileSize(), { width: 200, height: 125 });
assert.equal(ui.width, 200000); assert.equal(ui.height, 125000);
assert.ok(Math.atan(125 / 200) * 180 / Math.PI > 31 && Math.atan(125 / 200) * 180 / Math.PI < 33, '参考图地面边线约 32°');
for (const invalid of ['', '<map orientation="orthogonal" width="1" height="1" tilewidth="1" tileheight="1">',
    '<map orientation="isometric" width="0" height="1000" tilewidth="200" tileheight="100">']) assert.throws(() => projection.mapGeometryXml(invalid));
let cells = 0;
for (let x = 0; x < 1000; x += 17) for (let y = 0; y < 1000; y += 19) {
    const pixel = util.mapCellToPixelPoint(new Vec2(x, y));
    for (const [dx, dy] of [[0,0], [90,0], [-90,0], [0,55], [0,-55], [40,30], [-40,-30]]) {
        assert.deepEqual(util.mapPixelToCellPoint(new Vec2(pixel.x + dx, pixel.y + dy)), new Vec2(x, y)); cells++;
    }
}
for (const [x, y] of [[0,0], [999,0], [0,999], [999,999], [499,114]]) {
    const p = util.mapCellToPixelPoint(new Vec2(x,y));
    assert.deepEqual(util.mapPixelToCellPoint(p), new Vec2(x,y));
    const q = util.mapCellToPixelPoint(new Vec2(x + 1, y)); near(q.x - p.x, 100); near(q.y - p.y, -62.5);
}
const city = load('map/CityFootprint'), hit = load('map/SystemCityGeometry');
const { cityArtToFootprint } = load('map/CityArtFit');
const masks = load('map/SystemCitySilhouettes').SYSTEM_CITY_SILHOUETTES;
const world = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));
let alphaChecks = 0;
for (const row of world.cities) {
    const shape = masks[city.cityArtAsset(row.level, row)], layout = city.cityArtLayout(row.level, shape.width, shape.height, 200, 125, row);
    const before = city.cityArtLayout(row.level, shape.width, shape.height, 200, 100, row);
    near(layout.width, before.width); near(layout.height, before.height * 1.25);
    const ground = city.cityArtGround(row);
    if (ground) {
        const span = city.cityFootprintRadius(row.level) * 2 + 1;
        const point = ([x,y]) => {
            const p = cityArtToFootprint(layout.fit, x / ground.canvasWidth, y / ground.canvasHeight);
            return [p.x, p.y];
        };
        const left = point(ground.left), right = point(ground.right), front = point(ground.front);
        near(front[0] - left[0], left[1] - front[1], '左墙平行格轴');
        near(right[0] - front[0], right[1] - front[1], '右墙平行格轴');
        near(layout.width, span * 200); near(layout.height, span * 125);
    }
    for (let y = 2; y < shape.rows.length; y += 5) for (let x = 2; x < shape.columns; x += 5) {
        const p = cityArtToFootprint(layout.fit, (x + .5) / shape.columns, (y + .5) / shape.rows.length);
        const px = p.x * layout.width, py = p.y * layout.height;
        const expected = (parseInt(shape.rows[y][x >> 2], 16) & (1 << (x & 3))) !== 0 && Math.abs(p.x)+Math.abs(p.y)<=.5;
        assert.equal(hit.systemCityHit(px, py, row.level, 200, row, 125), expected, row.name); alphaChecks++;
    }
    for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) assert.equal(
        hit.systemCityCoversCell(x,y,row.level,200,125,row), hit.systemCityCoversCell(x,y,row.level,200,100,row), '投影不改变逻辑阻挡格');
}
const gate = load('map/GateGeometry');
for (const row of world.gates) for (const mirror of [false, true]) {
    const width = gate.gateWidth(row.level,row), height = gate.gateHeight(row.level,row,200,100);
    for (let x = -5; x <= 5; x++) for (let y = -5; y <= 5; y++) assert.equal(
        gate.gateHit(x * width / 10, y * height / 10, row.level,mirror,row),
        gate.gateHit(x * width / 10, y * height / 10 * 1.25, row.level,mirror,row,200,125));
    const before = gate.gateSelectionPaths(row.level,mirror,row), after = gate.gateSelectionPaths(row.level,mirror,row,200,125);
    before.forEach((line,i) => line.forEach((p,j) => { near(p[0],after[i][j][0]); near(p[1]*1.25,after[i][j][1]); }));
}
const { playerCityAppearance } = load('map/PlayerCityAppearance'), Ground = load('map/PlayerCityGround').default;
Ground.profiles = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/player-city-ground.json'), 'utf8'));
for (let level = 0; level <= 30; level++) {
    const before = playerCityAppearance(level,200,100), after = playerCityAppearance(level,200,125);
    near(after.width,before.width); near(after.height,before.height*1.25); near(after.y,before.y*1.25);
    const actual = Ground.layout(after,375); assert.ok(Number.isFinite(actual.height) && actual.height >= 375);
}
const { resourceFootprint } = load('map/ResourceFootprint');
const sizes = JSON.parse(fs.readFileSync(path.join(root,'assets/resources/world/art-sizes.json'),'utf8'));
for (const kind of ['forest','iron','quarry','grain']) for (let level = 1; level <= 10; level++) {
    const [w,h] = sizes[`${kind}_lv${level}`], before = resourceFootprint(w,h,200,100,level), after = resourceFootprint(w,h,200,125,level);
    near(after.width,before.width); near(after.height,before.height*1.25);
    assert.ok(after.width/200 + after.height/125 <= .901, '投影后资源不能跨出单格');
}
console.log(`PASS 地图初始化、${cells} 格内拾取、${alphaChecks} 城图 Alpha、10 城/18 关/31 玩家城/40 资源统一投影`);
