// 执行真实地景与玩家城 AOI 链；无 Creator 场景、服务器或资源写入。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
class Disposable { destroy() { this.destroyed = true; } }
class Mat4 {
    constructor() { this.sx = 1; this.sy = 1; this.tx = 0; this.ty = 0; }
    static equals(a, b) { return ['sx', 'sy', 'tx', 'ty'].every(key => a[key] === b[key]); }
    static copy(out, value) { return Object.assign(out, value); }
    static invert(out, value) { return Object.assign(out, {
        sx: 1 / value.sx, sy: 1 / value.sy, tx: -value.tx / value.sx, ty: -value.ty / value.sy }); }
}
class UITransform {
    setContentSize(width, height) { Object.assign(this, { width, height }); }
    setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; }
}
class Node extends Disposable {
    constructor(name) {
        super(); this.name = name; this.children = []; this.components = new Map();
        this.position = { x: 0, y: 0, z: 0 }; this.active = true; this.isValid = true; this.layer = 1;
        this.worldMatrix = new Mat4();
    }
    addChild(node) { node.setParent(this); }
    setParent(parent) {
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = parent; parent.children.push(this);
    }
    addComponent(Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
    getComponent(Type) { return this.components.get(Type); }
    getChildByName(name) { return this.children.find(child => child.name === name); }
    getSiblingIndex() { return this.parent.children.indexOf(this); }
    setSiblingIndex(index) { const list = this.parent.children; list.splice(list.indexOf(this), 1); list.splice(index, 0, this); }
    setPosition(x, y, z = 0) { this.position = { x, y, z }; }
    setScale(x, y, z = 1) { this.scale = { x, y, z }; }
    destroy() { super.destroy(); this.isValid = false; }
}
class ImageAsset extends Disposable { constructor(data) { super(); this.data = data; } }
class Texture2D extends Disposable {
    static PixelFormat = { RGBA8888: 1 }; static Filter = { LINEAR: 1 }; static WrapMode = { CLAMP_TO_EDGE: 1 };
    uploads = []; setFilters() {} setWrapMode() {}
    uploadData(data) { this.uploads.push(data.slice()); }
}
class Material extends Disposable { properties = {}; writes = 0;
    initialize(info) { this.info = info; }
    setProperty(key, value) { this.properties[key] = { ...value }; this.writes++; } }
class Sprite { static SizeMode = { CUSTOM: 1 }; }
class Vec2 { constructor(x, y) { Object.assign(this, { x, y }); } }
class Vec4 { constructor(x, y, z, w) { Object.assign(this, { x, y, z, w }); } }
const listeners = [];
const EventMgr = {
    on(event, fn, target) { listeners.push({ event, fn, target }); },
    emit(event, ...args) { for (const listener of [...listeners]) if (listener.event === event) listener.fn.apply(listener.target, args); },
    targetOff(target) { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].target === target) listeners.splice(i, 1); },
};
const LogicEvent = { updatePlayerCityTiles: 'tiles', updateCitys: 'cities' };
const width = 32, height = 32, cellId = (x, y) => y * width + x;
const tileHeight = Number(process.env.MAP_TEST_TILE_HEIGHT || 100);
const pixels = (x, y) => ({ x: (x - y) * 100, y: (height - 1 - x - y) * tileHeight / 2 });
const util = { areaCellSize: { width: 8, height: 8 }, mapSize: { width, height }, mapCellCount: width * height,
    getIdByCellPoint: cellId, getAreaIdByCellPoint: (x, y) => Math.floor(x / 8) + Math.floor(y / 8) * 4 };
const staticCells = new Set();
for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) staticCells.add(cellId(x, y));
const fixedCenter = cellId(3, 3), oldCenter = cellId(8, 8), newCenter = cellId(12, 12);
const terrainConfig = { width, height, riverCells: [fixedCenter, oldCenter, newCenter],
    mountainCells: [fixedCenter, oldCenter, newCenter], bridgeWaterCells: [cellId(20, 20)], patches: [
        { x: 8, y: 8, width: 80, anchorY: .5, heightScale: 1, art: 'square' },
        { x: 12, y: 12, width: 80, anchorY: .5, heightScale: 1, art: 'square' },
        // 锚点在城外，但完整山体右侧覆盖城市格，不能只查 patch 的落点。
        { x: 15, y: 12, width: 600, anchorY: .5, heightScale: 1, art: 'wide' },
        // 左边缘恰好与 3×3 城地面的右尖相切，不能误吞相邻山体。
        { x: 13.7, y: 10.3, width: 80, anchorY: .5, heightScale: 1, art: 'square' },
        { x: 20, y: 20, width: 80, anchorY: .5, heightScale: 1, art: 'square' },
        { x: 3, y: 3, width: 80, anchorY: .5, heightScale: 1, art: 'square' },
    ] };
const terrainBefore = JSON.stringify(terrainConfig), imageSizes = { square: { width: 80, height: 80 }, wide: { width: 600, height: 200 } };
const art = { landscape: terrainConfig, effect: {}, frame: name => ({ texture: {}, originalSize: imageSizes[name] || { width: 64, height: 64 } }),
    size: name => imageSizes[name], apply(sprite, name, artWidth) { sprite.art = name; sprite.width = artWidth; } };
const command = { proxy: { strategic: false }, cityProxy: null,
    isCityGroundCell(x, y) { return staticCells.has(cellId(x, y)) || !!this.cityProxy.getCity(cellId(x, y)); } };
const passEntryCells = new Map();
const imports = {
    cc: { _decorator: { ccclass: () => Type => Type }, Component: class {}, Node, UITransform, Sprite,
        SpriteFrame: class extends Disposable {}, Texture2D, ImageAsset, Material, Mat4, Vec2, Vec4,
        view: { getVisibleSize: () => ({ width: 1280, height: 720 }) } },
    './WorldMapArt': { default: art }, './MapCommand': { default: { getInstance: () => command } },
    './WorldStrategicMap': { default: class { initialize() {} } },
    './CityGround': { systemCityGroundCells: () => staticCells, passMountainClearMasks: () => passEntryCells },
    './MapUtil': { default: util }, './PlayerCityAppearance': { PLAYER_CITY_FOOTPRINT_RADIUS: 1 },
    '../utils/EventMgr': { EventMgr }, '../common/LogicEvent': { LogicEvent },
};
function load(name) {
    imports['./MapProjection'] = require('./map-projection-module.cjs')(ts);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/map', name + '.ts'), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, reportDiagnostics: true,
    });
    assert.deepEqual(code.diagnostics, [], name + ' syntax');
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code.outputText)(id => { assert.ok(id in imports, id); return imports[id]; }, module, module.exports);
    return module.exports.default;
}
const CityProxy = load('MapCityProxy'), Landscape = load('WorldLandscape');
command.cityProxy = new CityProxy();
function moveCity(x, y) { command.cityProxy.syncWorldCities([], { userId: '9007199254740993', cityPos: { x, y }, name: '测试' }, 10); }
function enterMap() {
    const scene = new Node('Scene'), terrain = new Node('Terrain'), resources = new Node('resNode');
    scene.addChild(terrain); scene.addChild(resources);
    const landscape = new Landscape(); landscape.node = terrain;
    const center = pixels(12, 12), camera = { node: new Node('Camera'), orthoHeight: 2000 };
    camera.node.setPosition(center.x, center.y);
    const oldLayer = new Node('Tiled layer');
    landscape.initialize({ getMapSize: () => ({ width, height }), getTileSize: () => ({ width: 200, height: tileHeight }),
        getLayers: () => [{ node: oldLayer }] }, camera);
    assert.equal(oldLayer.active, false);
    assert.equal(landscape.decoration.parent, scene);
    assert.ok(landscape.decoration.getSiblingIndex() > resources.getSiblingIndex());
    assert.equal(listeners.filter(listener => listener.target === landscape).length, 1);
    return landscape;
}
const rgba = (landscape, id) => Array.from(landscape.terrainBytes.slice(id * 4, id * 4 + 4));
const visible = (landscape, id) => landscape.activePatches.has(id);
const clipped = (landscape, id) => landscape.activePatches.get(id)?.getComponent(Sprite).customMaterial === landscape.cityClipMaterial;
moveCity(8, 8); // 占地数据早于地景初始化：首次进图也必须立即留白。
let landscape = enterMap();
assert.deepEqual(rgba(landscape, fixedCenter), [255, 255, 255, 255]);
assert.deepEqual(rgba(landscape, oldCenter), [255, 255, 255, 255]);
assert.deepEqual(rgba(landscape, newCenter), [255, 255, 0, 255]);
assert.deepEqual(rgba(landscape, cellId(1, 20)), [0, 0, 0, 0]);
assert.deepEqual(rgba(landscape, cellId(20, 20)), [255, 0, 0, 255], '桥下水通道保留');
assert.equal(landscape.cityGroundPoints.size, 18, '系统城与初始玩家城全部占地一次建立');
assert.equal(landscape.riverTexture.uploads.length, 0, '初始化随 ImageAsset 上传，无重复纹理更新');
assert.equal(visible(landscape, 0), true); assert.equal(visible(landscape, 5), true);
assert.ok(clipped(landscape, 0) && clipped(landscape, 5), '城内只裁像素，不撤掉整张山图');
assert.equal(landscape.cityClipMaterial.info.technique, 1);
assert.equal(visible(landscape, 1), true); assert.equal(visible(landscape, 2), true);
const sourceBytes = landscape.terrainBytes.slice(), cameraPosition = { ...landscape.camera.node.position };
moveCity(12, 12);
assert.equal(landscape.riverTexture.uploads.length, 1, '同次 AOI 的旧九格+新九格只上传一次');
landscape.lateUpdate();
assert.deepEqual(landscape.camera.node.position, cameraPosition, '城市迁入迁出无需移动镜头触发');
assert.equal(visible(landscape, 0), true, '迁出原址恢复山体');
assert.equal(clipped(landscape, 0), false, '迁出后撤掉不再需要的裁切材质');
assert.ok(visible(landscape, 1) && clipped(landscape, 1), '迁入当前视口按格裁切');
assert.ok(visible(landscape, 2) && clipped(landscape, 2), '跨界大山仍在，仅遮住城内部分');
assert.equal(visible(landscape, 3), true, '只有边缘相切的邻图保留');
assert.equal(visible(landscape, 4), true, '无关山体保持');
assert.equal(clipped(landscape, 3), false); assert.equal(clipped(landscape, 4), false);
assert.equal(landscape.cityGroundAtPoint(pixels(12, 12)), true);
assert.equal(landscape.blockerAt(pixels(12, 12)), null, '裁掉的山体像素不能拦住城池点击');
assert.equal(landscape.cityGroundAtPoint(pixels(14, 12)), false);
assert.ok(landscape.blockerAt(pixels(14, 12)), '跨界山体城外部分保持可见与阻挡');
// 对跨界矩形逐像素取样：城外部分必须非空，不可重现整张撤掉的留白。
const wide = landscape.patches[2]; let keptPixels = 0, clippedPixels = 0;
for (let x = wide.px - 300; x < wide.px + 300; x += 5) for (let y = wide.py - tileHeight; y < wide.py + tileHeight; y += 5) {
    if (landscape.cityGroundAtPoint({ x, y })) clippedPixels++; else keptPixels++;
}
assert.ok(keptPixels > clippedPixels && clippedPixels > 0, '跨界山图应保留大部分城外像素');
// 改变地图父级变换后，矩阵在静止镜头也更新，避免遮罩相对城墙漂移。
Object.assign(landscape.node.worldMatrix, { sx: 1.5, sy: .8, tx: 120, ty: -80 });
landscape.lateUpdate();
const inverse = landscape.cityClipMaterial.properties.worldToMap;
for (const p of [pixels(12, 12), pixels(14, 12)]) {
    const world = { x: p.x * 1.5 + 120, y: p.y * .8 - 80 };
    assert.ok(Math.abs(world.x * inverse.sx + inverse.tx - p.x) < 1e-9);
    assert.ok(Math.abs(world.y * inverse.sy + inverse.ty - p.y) < 1e-9);
}
const writes = landscape.cityClipMaterial.writes;
landscape.lateUpdate(); assert.equal(landscape.cityClipMaterial.writes, writes, '静止帧不重复提交材质矩阵');
assert.deepEqual(rgba(landscape, oldCenter), [255, 255, 0, 255]);
assert.deepEqual(rgba(landscape, newCenter), [255, 255, 255, 255]);
for (let i = 0; i < sourceBytes.length; i++) if (i % 4 !== 2) {
    assert.equal(landscape.terrainBytes[i], sourceBytes[i], '地表覆盖只动 B，保留 R/G/A 原始数据');
}
EventMgr.emit(LogicEvent.updatePlayerCityTiles, [oldCenter, newCenter, newCenter, -1, width * height, NaN, .5]);
moveCity(12, 12); landscape.lateUpdate();
assert.equal(landscape.riverTexture.uploads.length, 1, '重复/无效占地事件零额外上传');
const firstTexture = landscape.riverTexture, firstImage = landscape.riverImage, firstMaterial = landscape.material;
const firstClip = landscape.cityClipMaterial;
const firstMountain = landscape.mountainMaterial;
landscape.onDestroy();
assert.equal(listeners.length, 0, '销毁清除全部自身监听');
assert.ok(firstTexture.destroyed && firstImage.destroyed && firstMaterial.destroyed && firstClip.destroyed);
assert.ok(firstMountain.destroyed, '共享山脚材质随地图销毁');
EventMgr.emit(LogicEvent.updatePlayerCityTiles, [newCenter]);
assert.equal(firstTexture.uploads.length, 1, '退出地图后不能向已销毁纹理上传');
landscape = enterMap(); // 同一玩家城代理，地图重新创建，不依赖收到第二次 AOI。
assert.deepEqual(rgba(landscape, newCenter), [255, 255, 255, 255]);
assert.ok(visible(landscape, 1) && clipped(landscape, 1)); assert.ok(visible(landscape, 2) && clipped(landscape, 2));
assert.equal(visible(landscape, 0), true); assert.equal(landscape.riverTexture.uploads.length, 0);
moveCity(8, 8); landscape.lateUpdate();
assert.equal(visible(landscape, 1), true); assert.equal(visible(landscape, 2), true, '迁出后清除已缓存的山体遮挡结果');
assert.equal(clipped(landscape, 1), false); assert.equal(clipped(landscape, 2), false);
assert.ok(visible(landscape, 0) && clipped(landscape, 0)); assert.equal(landscape.riverTexture.uploads.length, 1);
moveCity(0, 0); landscape.lateUpdate();
assert.deepEqual([...command.cityProxy.getOccupiedCellIds()].sort((a, b) => a - b), [0, 1, 32, 33]);
assert.equal(landscape.cityGroundPoints.size, staticCells.size + 4, '地图边缘主城占地裁切，不绕到上一行');
assert.equal(landscape.riverTexture.uploads.length, 2);
assert.equal(JSON.stringify(terrainConfig), terrainBefore, '不改原始地形配置或资源分布');
landscape.onDestroy(); assert.equal(listeners.length, 0);
// 山口门外不是城市地基：只软裁山体，不能再制造整格草色菱形。
const passEntry = cellId(16, 12); passEntryCells.set(passEntry,64);
landscape = enterMap();
assert.deepEqual(rgba(landscape, passEntry), [0,0,64,0], '入口保留朝向，与城内采用不同裁切标记');
assert.ok(landscape.cityGroundPoints.has(passEntry) && clipped(landscape, 2), '跨入口的山体仍使用裁切材质');
assert.equal(landscape.blockerAt(pixels(16,12)), null, '入口继续可点击，不改变通行规则');
EventMgr.emit(LogicEvent.updatePlayerCityTiles, [passEntry]);
assert.equal(rgba(landscape, passEntry)[2],64,'AOI 刷新不能把入口升级为整格清空或丢失朝向');
assert.equal(landscape.riverTexture.uploads.length,0);
moveCity(16,12); assert.equal(rgba(landscape,passEntry)[2],255,'实际城市占用优先精确清地');
moveCity(0,0); assert.equal(rgba(landscape,passEntry)[2],64,'迁出后恢复自然入口朝向');
landscape.onDestroy();
landscape=enterMap(); assert.equal(rgba(landscape,passEntry)[2],64,'重新进图也保留方向和软边');
landscape.onDestroy(); assert.equal(listeners.length,0);
assert.equal(JSON.stringify(terrainConfig),terrainBefore,'山口修复不改真实地形数据');
// 美术偏移按地图比例投影，整数逻辑坐标保持不变。
terrainConfig.patches[0].offsetX=-37; terrainConfig.patches[0].offsetY=21;
landscape=enterMap();
const shifted=landscape.patches[0], base=pixels(shifted.x,shifted.y);
assert.equal(shifted.px,base.x-37*landscape.tileWidth/200);
assert.equal(shifted.py,base.y+21*landscape.tileHeight/100);
landscape.onDestroy();
delete terrainConfig.patches[0].offsetX; delete terrainConfig.patches[0].offsetY;
console.log('PASS 城池地景：跨界山体逐像素保留、城内裁切与拾取一致、父级变换、首次/重进图/静止迁城、批量上传、RGBA与资源生命周期');
console.log('PASS 山口入口：独立软裁切、点击保留、AOI 幂等、城市占用及迁出/重进图恢复');
