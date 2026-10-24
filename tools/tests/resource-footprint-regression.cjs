const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
function load(file, dependencies = {}) {
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
        fileName: file, reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics.length, 0);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled.outputText)(name => {
        assert.ok(name in dependencies, name); return dependencies[name];
    }, module, module.exports);
    return module.exports;
}
class UITransform {
    setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; }
    setContentSize(width, height) { this.width = width; this.height = height; }
}
class TestNode {
    constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.active = true; }
    addChild(node) { this.children.push(node); }
    getChildByName(name) { return this.children.find(node => node.name === name); }
    addComponent(Type) { const component = new Type(); this.components.set(Type, component); return component; }
    getComponent(Type) { return this.components.get(Type) || (Type === UITransform ? this.addComponent(Type) : null); }
    setSiblingIndex() {}
    setPosition(x, y) { this.x = x; this.y = y; }
}
class TestGraphics { clear() {} moveTo() {} lineTo() {} close() {} fill() {} }
const transform = new UITransform();
const spriteNode = { getComponent: () => transform,
    setPosition(x, y) { this.x = x; this.y = y; }, setScale(x, y) { this.sx = x; this.sy = y; } };
const cc = { _decorator: { ccclass: () => Type => Type, property: () => () => {} },
    Component: class {}, Sprite: class {}, UITransform, Node: TestNode, Graphics: TestGraphics,
    Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }, Label: { HorizontalAlign: { CENTER: 1 } } };
const footprint = load('assets/scripts/map/ResourceFootprint.ts');
const artNames = [], artHashes = new Set();
const logicType = load('assets/scripts/map/entries/ResLogic.ts', {
    cc, '../MapProxy': { MapResType: { WOOD: 52, IRON: 53, STONE: 54, GRAIN: 55, SYS_FORTRESS: 50 } },
    '../WorldMapArt': { default: { apply(sprite, name) {
        const png = fs.readFileSync(path.join(root, 'assets/resources/ui/world', name + '.png'));
        artNames.push(name);
        if (name.includes('_lv')) artHashes.add(require('node:crypto').createHash('sha256').update(png).digest('hex'));
        sprite.spriteFrame = { originalSize: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
    } } },
    '../WorldCampaign': { default: { gateAt: () => null } },
    '../GateGeometry': load('assets/scripts/map/GateGeometry.ts'),
    '../MapUtil': { default: { tileSize: { width: 200, height: 100 } } },
    '../ResourceFootprint': footprint, '../ui/ManagementStyle': { caption(parent, name, text, x, y) {
        let node = parent.getChildByName(name);
        if (!node) { node = new TestNode(name); parent.addChild(node); }
        node.setPosition(x, y); node.label = { node, string: text }; return node.label;
    } },
}).default;
const logic = new logicType(); logic.node = new TestNode('Resource'); logic.spr = { node: spriteNode };
let checked = 0;
for (const type of [52, 53, 54, 55]) for (let level = 1; level <= 10; level++) {
    logic.setResourceData({ type, level, x: 19, y: 27 });
    assert.equal(artNames.at(-1), `${{52:'forest',53:'iron',54:'quarry',55:'grain'}[type]}_lv${level}`);
    assert.equal(transform.anchorX, .5); assert.equal(transform.anchorY, .5);
    assert.equal(spriteNode.x, 0); assert.equal(spriteNode.y, 0);
    assert.equal(spriteNode.sx, 1); assert.equal(spriteNode.sy, 1); assert.equal(logic.spr.trim, false);
    assert.equal(logic.node.getChildByName('ResourceGrade'), undefined);
    assert.equal(logic.node.children.filter(node => node.name.startsWith('ResourceCluster') && node.active).length, 0);
    for (const node of logic.node.children.filter(node => node.name.startsWith('ResourceCluster') && node.active)) {
        const ui = node.getComponent(UITransform);
        assert.ok((Math.abs(node.x) + ui.width / 2) / 100 + (Math.abs(node.y) + ui.height / 2) / 50 <= 1);
    }
    for (const x of [-transform.width / 2, transform.width / 2]) for (const y of [-transform.height / 2, transform.height / 2]) {
        assert.ok(Math.abs(x) / 100 + Math.abs(y) / 50 <= .900001, `type ${type} level ${level} crosses diamond`);
    }
    checked++;
}
assert.equal(artHashes.size, 40, '各资源各等级必须使用独立图像');
logic.setResourceData({ type: 50, level: 5, x: 1, y: 1 });
assert.equal(logic.spr.trim, true); assert.equal(transform.anchorY, .25);
assert.equal(logic.node.getChildByName('ResourceGrade'), undefined);
console.log(`PASS ${checked} real resource/level combinations fit inside the tile; pooled anchors, position, scale and trim reset`);
