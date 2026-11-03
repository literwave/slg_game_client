const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require(process.argv[2]), root = path.resolve(__dirname, '../..');
class Component {}
class UITransform {
    setContentSize(w, h) { this.contentSize = typeof w === 'object' ? { ...w } : { width: w, height: h }; }
    setAnchorPoint(x, y) { this.anchorPoint = { x, y }; }
}
class Sprite { static SizeMode = { CUSTOM: 0 }; static Type = { SIMPLE: 0 }; }
class Node {
    constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.layer = 4; this.active = true; }
    addChild(node) { this.children.push(node); node.parent = this; }
    removeFromParent() { this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
    destroy() { this.destroyed = true; }
    getChildByName(name) { return this.children.find(node => node.name === name); }
    getComponent(Type) { return this.components.get(Type); }
    addComponent(Type) { if (Type === Sprite) assert.ok(!this.components.has('cc.Graphics'), '旧绘制节点必须先移除'); const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
    setPosition(x, y, z) { this.position = { x, y, z }; }
    setScale(x, y, z) { this.scale = { x, y, z }; }
}
function load(file, imports) {
    const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
        reportDiagnostics: true,
    });
    assert.equal(output.diagnostics.length, 0, file);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', output.outputText)(key => {
        assert.ok(key in imports, key); return imports[key];
    }, module, module.exports);
    return module.exports;
}
const cc = { Component, Node, Sprite, UITransform, Color: { WHITE: {} },
    _decorator: { ccclass: () => target => target, property: () => () => {} } };
const city = load('assets/scripts/map/CityFootprint.ts', {});
const gates = load('assets/scripts/map/GateGeometry.ts', {
    './BridgeSilhouette': load('assets/scripts/map/BridgeSilhouette.ts', {}) });
const artModule = load('assets/scripts/map/WorldMapArt.ts', { cc,
    './CityFootprint': city, './GateGeometry': gates,
    './PlayerCityAppearance': load('assets/scripts/map/PlayerCityAppearance.ts', {}),
    './PlayerCityGround': {} });
const image = fs.readFileSync(path.join(root, 'assets/resources/ui/world/map-bookmark-v2.png'));
const frame = { name: artModule.MAP_BOOKMARK_ART, originalSize: { width: image.readUInt32BE(16), height: image.readUInt32BE(20) } };
artModule.default.frames.set(frame.name, frame);
assert.ok(artModule.worldArtNames().includes(frame.name), '地图就绪前必须准备标记原画');
assert.ok(image.length < 50000, '标记素材保持轻量');
const marks = new Set(['388,828']);
const BuildTag = load('assets/scripts/map/entries/BuildTagLogic.ts', {
    cc, '../MapCommand': { default: { getInstance: () => ({ proxy: { isPosTag: (x, y) => marks.has(x + ',' + y) } }) } },
    '../MapUtil': { default: { tileSize: { width: 200, height: 100 } } },
    '../WorldMapArt': artModule,
}).default;
const prefab = JSON.parse(fs.readFileSync(path.join(root, 'assets/prefab/map/BuildTag.prefab'), 'utf8'));
const prefabSprite = prefab.find(x => x.__type__ === 'cc.Sprite');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/ui/world/map-bookmark-v2.png.meta')));
assert.equal(prefabSprite._spriteFrame.__uuid__, meta.uuid + '@f9941', '序列化预制体不能仍引用旧图');
assert.equal(prefabSprite._customMaterial, null);
for (const childName of ['BookmarkBanner', 'New Sprite', null, 'legacy-graphics']) {
    const tag = new BuildTag(), rootNode = new Node('tag');
    rootNode.addComponent(UITransform); tag.tagIconNode = rootNode;
    if (childName === 'legacy-graphics') {
        const legacy = new Node('BookmarkBanner'); rootNode.addChild(legacy);
        legacy.addComponent(UITransform); legacy.components.set('cc.Graphics', { enabled: true }); tag.flag = {};
    } else if (childName) { const node = new Node(childName); rootNode.addChild(node); node.addComponent(UITransform); node.addComponent(Sprite); }
    tag.onLoad(); assert.equal(rootNode.active, false);
    tag.setResourceData({ x: 388, y: 828 });
    assert.equal(rootNode.active, true);
    const banner = rootNode.getChildByName('BookmarkBanner'), sprite = banner.getComponent(Sprite);
    assert.equal(sprite.spriteFrame, frame); assert.equal(sprite.trim, false);
    assert.equal(banner.getComponent(UITransform).contentSize.height, 52);
    let previousPixels = Infinity;
    for (const zoom of [.2, .5, 1, 1.25, 4, 20, 100]) {
        tag.setZoom(zoom);
        const pixels = 52 * rootNode.scale.y / zoom;
        assert.ok(pixels >= 19 && pixels <= 52.001);
        assert.ok(pixels <= previousPixels + .001); previousPixels = pixels;
    }
    for (const zoom of [NaN, Infinity, 0, -1]) {
        tag.setZoom(zoom); assert.ok(Number.isFinite(rootNode.scale.y));
    }
    for (let i = 0; i < 12; i++) {
        tag.onDisable(); assert.equal(rootNode.active, false); assert.equal(tag._data, null);
        tag.setResourceData({ x: 388, y: 828 }); tag.setZoom(1.25);
        assert.equal(rootNode.active, true); assert.equal(rootNode.children.length, 1);
        assert.equal(banner.getComponent(Sprite).spriteFrame, frame);
    }
    marks.delete('388,828'); tag.updateUI(); assert.equal(rootNode.active, false);
    marks.add('388,828'); tag.updateUI(); assert.equal(rootNode.active, true);
    tag.setResourceData(null); assert.equal(rootNode.active, false);
}
console.log('PASS 新旧预制体与空节点初始化、固定原画预加载、缩放可读性、48 次回收复用及旧绘制组件迁移及取消标记隐藏');
