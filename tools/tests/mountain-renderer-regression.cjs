const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
class UITransform { setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; } }
class Sprite {}
class Mat4 {
    static equals(a, b) { return a === b; }
    static copy(out, value) { return Object.assign(out, value); }
    static invert(out) { return out; }
}
class Node {
    constructor(name) { this.name = name; this.components = new Map(); this.children = []; this.active = true; this.position = { x: 0, y: 0 }; this.worldMatrix = new Mat4(); }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type); }
    addChild(node) { this.children.push(node); node.parent = this; }
    setPosition(x, y) { this.position = { x, y }; }
    setScale(x, y) { this.scale = { x, y }; }
    getSiblingIndex() { return this.parent.children.indexOf(this); }
    setSiblingIndex(i) { this.moves = (this.moves || 0) + 1; const children = this.parent.children; children.splice(children.indexOf(this), 1); children.splice(i, 0, this); }
}
const mountainArtNames = [...new Set(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/original-landscape.json'), 'utf8')).patches.map(p => p.art))];
const frames = Object.fromEntries(mountainArtNames.map(name => {
    const bytes = fs.readFileSync(path.join(root, 'assets/resources/ui/world', name + '.png'));
    return [name, { originalSize: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } }];
}));
const proxy = { strategic: false };
const dependencies = {
    './MapProjection': require('./map-projection-module.cjs')(ts),
    cc: { _decorator: { ccclass: () => Type => Type }, Component: class {}, Node, Sprite, UITransform, Mat4,
        Vec2: class { constructor(x, y) { this.x = x; this.y = y; } }, view: { getVisibleSize: () => ({ width: 1400, height: 800 }) } },
    './WorldMapArt': { default: { frame: name => frames[name], size: name => frames[name].originalSize,
        apply(sprite, name, width, ready) { sprite.art = name; sprite.width = width; ready?.(); } } },
    './MapCommand': { default: { getInstance: () => ({ proxy }) } }, './WorldStrategicMap': {},
    './CityGround': { systemCityGroundCells: () => new Set() },
    '../utils/EventMgr': { EventMgr: {} }, '../common/LogicEvent': { LogicEvent: {} },
};
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/map/WorldLandscape.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics, []);
const entry = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputText)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, entry, entry.exports);
const landscape = new entry.exports.default();
landscape.node = new Node('Landscape'); landscape.decoration = new Node('Mountains');
landscape.cityClipMaterial = { setProperty() {} };
landscape.mountainMaterial = { setProperty() {} };
landscape.mapWidth = 1000; landscape.mapHeight = 1000;
landscape.tileWidth = 200; landscape.tileHeight = 100;
landscape.terrainBytes = new Uint8Array(1000 * 1000 * 4);
landscape.camera = { node: new Node('Camera'), orthoHeight: 600 };
const config = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/original-landscape.json'), 'utf8'));
const campaign = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));
landscape.patches = config.patches.map(p => ({ ...p, px: (p.x - p.y) * 100 + (p.offsetX || 0), py: (999 - p.x - p.y) * 50 + (p.offsetY || 0) }));
for (const [id, p] of landscape.patches.entries()) {
    const key = `${Math.floor(p.px / 1024)},${Math.floor(p.py / 1024)}`;
    if (!landscape.patchBuckets.has(key)) landscape.patchBuckets.set(key, []);
    landscape.patchBuckets.get(key).push(id);
}
for (const { x, y } of [{ x: 2, y: 400 }, { x: 710, y: 864 }, ...campaign.gates]) {
    const px = (x - y) * 100, py = (999 - x - y) * 50;
    landscape.camera.node.setPosition(px, py); landscape.updateVisible();
    const expected = landscape.patches.flatMap((p, i) => Math.abs(p.px - px) < 1700 && Math.abs(p.py - py) < 1250 ? [i] : []);
    assert.deepEqual([...landscape.activePatches.keys()].sort((a, b) => a - b), expected);
    for (const [id, node] of landscape.activePatches) {
        const p = landscape.patches[id];
        assert.equal(node.getComponent(UITransform).anchorY, p.anchorY ?? .22);
        assert.equal(node.getComponent(Sprite).trim, false);
        assert.equal(node.getComponent(Sprite).customMaterial, landscape.mountainMaterial, '所有普通山体共用山脚融合材质');
        assert.equal(node.scale.x, p.flipX ? -1 : 1); assert.equal(node.scale.y, p.heightScale);
    }
    if (campaign.gates.some(g => g.x === x && g.y === y)) assert.equal(landscape.blockerAt({ x: px, y: py }), null, 'gate must remain clickable');
}
proxy.strategic = true; landscape.updateVisible(); assert.equal(landscape.decoration.active, false);
proxy.strategic = false; landscape.updateVisible(); assert.equal(landscape.decoration.active, true);
const before = landscape.decoration.children.reduce((sum, node) => sum + (node.moves || 0), 0);
// 强制重新查询同一视口，验证结果集合未变时不重排节点、不打断批次。
landscape.lastX = Infinity; landscape.updateVisible();
assert.equal(landscape.decoration.children.reduce((sum, node) => sum + (node.moves || 0), 0), before);
console.log('PASS mountain spatial buckets match full visibility; pooled anchors/flips/scales reset; 18 gates clickable; strategic detail resumes');
