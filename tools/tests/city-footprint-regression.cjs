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
class OwnershipView {}
class AmbientView { setCity(data) { this.data = data; } }
class Sprite { static SizeMode = { CUSTOM: 1 }; static Type = { SIMPLE: 1 }; }
const cc = { Vec2, Sprite, UITransform: class {}, v2: (x, y) => new Vec2(x, y), size: (width, height) => ({ width, height }),
    Component: class { unscheduleAllCallbacks() {} }, Prefab: class {}, Node: class {},
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
        if (id.endsWith('/DateUtil')) return { default: { getServerTime: () => 0 } };
        if (id.endsWith('/EventMgr')) return { EventMgr: { emit() {} } };
        if (id.endsWith('/LogicEvent')) return { LogicEvent: {} };
        if (id.endsWith('/CityOwnershipView')) return { default: OwnershipView };
        if (id.endsWith('/CityAmbientView')) return { default: AmbientView };
        if (id.endsWith('/MapArmyLogic') || id.endsWith('/MapLogic')) return { default: class {} };
        if (id.endsWith('/WorldLandscape') || id.endsWith('/MapClickUILogic')) return { default: class {} };
        return load(path.relative(scripts, path.resolve(path.dirname(full), id)));
    }, module, module.exports);
    return module.exports;
}
const MapUtil = load('map/MapUtil').default, Proxy = load('map/MapProxy').default;
const { MapBuildData } = load('map/MapBuildProxy');
const Art = load('map/WorldMapArt').default;
const campaign = load('map/WorldCampaign').default;
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
const { cityArtPoint, cityArtToFootprint, cityArtToSource, CITY_BASE_FILL } = load('map/CityArtFit');
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
    const shape = masks[near], layout = Footprint.cityArtLayout(city.level, shape.width, shape.height, 200, 100, city);
    const { width, height, anchorX, anchorY } = layout;
    let hits = 0;
    for (let row = 4; row < shape.rows.length; row += 7) for (let column = 4; column < shape.columns; column += 7) {
        const opaque = (parseInt(shape.rows[row][column >> 2], 16) & (1 << (column & 3))) !== 0;
        const p = cityArtToFootprint(layout.fit, (column + .5) / shape.columns, (row + .5) / shape.rows.length);
        const dx = p.x * width, dy = p.y * height;
        assert.equal(Geometry.systemCityHit(dx, dy, city.level, 200, city), opaque && Math.abs(p.x)+Math.abs(p.y)<=.5, city.name + ' 显示与点击一致');
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

// 四个城基角对应占地四角；执行实际 SysCityLogic 验证渲染画布。
Art.sizes = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/art-sizes.json'), 'utf8'));
const SysCity = load('map/entries/SysCityLogic').default;
function transform() {
    return { width: 0, height: 0, anchorX: .5, anchorY: .5,
        setContentSize(width, height) { this.width = width; this.height = height; },
        setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; } };
}
let aligned = 0;
for (const city of cities) {
    const appearance = Footprint.SYSTEM_CITY_ARTS.find(row => row.name === city.name), ground = appearance.ground;
    if (!ground) continue;
    const layout = Art.cityLayout(city.level, city), span = city.footprintRadius * 2 + 1;
    const project = ([x,y]) => {
        const p = cityArtToFootprint(layout.fit, x / ground.canvasWidth, y / ground.canvasHeight);
        return [p.x, p.y];
    };
    const left = project(ground.left), right = project(ground.right), front = project(ground.front);
    assert.ok(Math.abs(front[0] - left[0] - left[1] + front[1]) < 1e-9, '左墙平行格轴');
    assert.ok(Math.abs(right[0] - front[0] - right[1] + front[1]) < 1e-9, '右墙平行格轴');
    const shape = masks[appearance.near], back = project(ground.back);
    for (const [actual, expected] of [[left,[-.5,0]],[right,[.5,0]],[front,[0,-.5]],[back,[0,.5]]]) {
        for (let axis=0;axis<2;axis++) assert.ok(Math.abs(actual[axis]-expected[axis]*CITY_BASE_FILL)<1e-9,'城基必须贴满四角');
    }
    for(let x=-.49;x<.5;x+=.01) {
        const a=cityArtPoint(layout.fit.inverse,x,0), b=cityArtPoint(layout.fit.upperInverse,x,0);
        assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-9,'上下城图衔接不能跳变');
        for(const y of [-.01,.01]) {
            const uv=cityArtToSource(layout.fit,x,y), p=cityArtToFootprint(layout.fit,uv.x,uv.y);
            assert.ok(Math.hypot(p.x-x,p.y-y)<1e-9,'渲染和拾取双向变换一致');
        }
    }
    const twice = Footprint.cityArtLayout(city.level, shape.width, shape.height, 400, 200, city);
    assert.equal(twice.width, layout.width * 2); assert.equal(twice.height, layout.height * 2);
    assert.deepEqual(Footprint.cityArtLayout(city.level, shape.width/4, shape.height/4, 200, 100, city), layout, '同图缩略图共享地面比例');
    const iconTransform = transform(), footprintTransform = transform();
    const icon = { node: { activeInHierarchy: false, getComponent: () => iconTransform, setPosition() {} } };
    let footprint;
    const ownership = { setCity(_data, _height, corners) { footprint = corners; } };
    const node = { setScale() {}, getChildByName: name => name === 'cityicon' ? { getComponent: () => icon } : null,
        getComponent: type => type === OwnershipView ? ownership : type === AmbientView ? new AmbientView() : footprintTransform };
    const logic = new SysCity(); logic.node = node; logic.mianNode = { setPosition() {} };
    logic.setCityData({ ...city, type: 51, parentId: 0 });
    assert.equal(icon.trim, false);
    assert.deepEqual([iconTransform.width, iconTransform.height, iconTransform.anchorX, iconTransform.anchorY],
        [layout.width, layout.height, layout.anchorX, layout.anchorY], '实际渲染必须使用相同非等比画布和锚点');
    assert.deepEqual([footprintTransform.width, footprintTransform.height], [span * 200, span * 100]);
    assert.deepEqual(footprint, [[-span * 100,0],[0,span * 50],[span * 100,0],[0,-span * 50]]);
    aligned++;
}
assert.equal(aligned, 10);
console.log('PASS 十城城基四角贴格、上下无接缝、渲染和拾取共用变换');

// 真实输入路由：覆盖格的透明角落不能透选空地；直接点击城墙仅打开城池情报。
Art.campaign = { width: 1000, height: 1000, cities, gates: [] };
const Touch = load('map/MapTouchLogic').default, touch = new Touch();
const resources = new Map(), buildings = new Map(), playerCities = new Map();
let selected = null, removed = false, mountain = null;
touch._cmd = {
    proxy: { getResData: id => resources.get(id), getSysCityResData: (x, y) => {
        const city = proxy.getSysCityResData(x, y);
        return city ? resources.get(MapUtil.getIdByCellPoint(city.x,city.y)) : null;
    } },
    buildProxy: { getBuild: id => buildings.get(id) }, cityProxy: { getCity: id => playerCities.get(id) },
    isCityArtCoveredCell: (x, y) => cities.some(city => Geometry.systemCityCoversCell(x - city.x, y - city.y,
        city.level, 200, 100, city)),
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
assert.equal(Art.cityLayout(10,luoyang).anchorY,.5,'洛阳完整轮廓居中于真实占地');
const center = MapUtil.mapCellToPixelPoint(luoyang);
const cityData = resources.get(MapUtil.getIdByCellPoint(luoyang.x, luoyang.y));
let adjacentTiles = 0;
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
        assert.ok(samples.every(sample => !sample.hit), '任何城外格内都不能再出现城图像素');
        adjacentTiles++;
        const id = MapUtil.getIdByCellPoint(x, y), empty = { id, x, y, type: 0, isEmpty: true };
        if (campaign.attackEntrances(luoyang.x, luoyang.y).some(p => p.x === x && p.y === y)) continue;
        resources.set(id, empty);
        assert.equal(pick(cell, p), empty, '城外格不被额外隐形阻挡');
        const resource = { ...empty, type: 52, isEmpty: false };
        resources.set(id, resource);
        assert.equal(pick(cell, p), resource, '城外资源正常选择');
        const owned = { ...resource, isSysCity: () => false };
        buildings.set(id, owned);
        assert.equal(pick(cell, p), owned, '城外领地保留归属');
        buildings.delete(id);
        resources.set(id, { ...empty, isEmpty: false });
        assert.equal(pick(cell, p), undefined, '河流或不可通行格仍不可选择');
        assert.equal(removed, false, '不可通行格不清空现有操作');
    }
}
assert.ok(adjacentTiles >= 40, '覆盖城外完整两圈，不能只检查一个角');
const exposed = new Vec2(450, 451), exposedId = MapUtil.getIdByCellPoint(exposed.x, exposed.y);
const freeResource = { id: exposedId, x: exposed.x, y: exposed.y, type: 52, isEmpty: false };
resources.set(exposedId, freeResource);
assert.equal(pick(exposed, MapUtil.mapCellToPixelPoint(exposed)), freeResource, '城图外完整露出的资源地仍能选择');
for (const city of cities) for (const entrance of campaign.attackEntrances(city.x, city.y)) {
    const cell = new Vec2(entrance.x, entrance.y);
    assert.equal(pick(cell, MapUtil.mapCellToPixelPoint(cell)), resources.get(MapUtil.getIdByCellPoint(city.x, city.y)),
        '换图后的固定入口仍选择对应城池');
}
for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
    const cell = new Vec2(luoyang.x + dx, luoyang.y + dy);
    assert.equal(pick(cell, MapUtil.mapCellToPixelPoint(cell)), cityData, '城池九乘九实际占地仍选城');
}
const playerCell = new Vec2(450, 450), player = { x: 450, y: 450, rid: 7 };
playerCities.set(MapUtil.getIdByCellPoint(450, 450), player);
assert.equal(pick(playerCell, MapUtil.mapCellToPixelPoint(playerCell)), player, '玩家主城拾取不变');
console.log(`PASS ${adjacentTiles} 个城外格零越界，资源可选；固定入口、城内透明角与玩家城拾取不回归`);
