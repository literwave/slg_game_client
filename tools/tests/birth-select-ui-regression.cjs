// Birth region selection UI layout, topology hit-test, conquest route, and interactive state tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');

function makeGraphics() {
    return {
        fillColor: null, strokeColor: null, lineWidth: 1,
        clear() {}, rect() {}, roundRect() {}, circle() {},
        moveTo() {}, lineTo() {}, close() {}, fill() {}, stroke() {},
    };
}

class MockUITransform {
    constructor(node) { this.node = node; this.width = 0; this.height = 0; this.anchorX = 0.5; this.anchorY = 0.5; }
    setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; }
    setContentSize(w, h) { this.width = w; this.height = h; }
    convertToNodeSpaceAR(v) { return { x: v.x, y: v.y, z: 0 }; }
}
class MockLabel {
    constructor(node) {
        this.node = node; this.string = ''; this.fontSize = 18; this.lineHeight = 24;
        this.color = null; this.isBold = false; this.enableWrapText = false;
        this.horizontalAlign = 0; this.verticalAlign = 1; this.overflow = 0;
        this.outlineColor = null; this.outlineWidth = 0;
    }
}
MockLabel.HorizontalAlign = { LEFT: 0, CENTER: 1, RIGHT: 2 };
MockLabel.VerticalAlign = { TOP: 0, CENTER: 1, BOTTOM: 2 };
MockLabel.Overflow = { NONE: 0, CLAMP: 1, SHRINK: 2 };

class MockButton {
    constructor(node) { this.node = node; this.interactable = true; this.target = null; this.transition = 0; }
}
MockButton.Transition = { NONE: 0, COLOR: 1, SPRITE: 2, SCALE: 3 };
MockButton.EventType = { CLICK: 'click' };

class MockSprite { constructor(node) { this.node = node; this.spriteFrame = null; this.sizeMode = 0; this.color = null; } }
MockSprite.SizeMode = { TRIMMED: 0, RAW: 1, CUSTOM: 2 };
class MockSpriteFrame {}
class MockUIOpacity { constructor(node) { this.node = node; this.opacity = 255; } }
class MockBlockInputEvents { constructor(node) { this.node = node; } }
class MockMask { constructor(node) { this.node = node; this.type = 0; } }
MockMask.Type = { GRAPHICS_RECT: 0 };
class MockGraphics { constructor(node) { this.node = node; Object.assign(this, makeGraphics()); } }
class MockColor { constructor(r = 0, g = 0, b = 0, a = 255) { this.r = r; this.g = g; this.b = b; this.a = a; } }
class MockVec3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }

class MockNode {
    constructor(name = 'Node') {
        this.name = name; this.layer = 1; this.active = true;
        this.parent = null; this.children = []; this.components = new Map();
        this.listeners = new Map(); this.position = { x: 0, y: 0, z: 0 }; this.scale = { x: 1, y: 1, z: 1 };
    }
    addChild(child) { child.parent = this; this.children.push(child); }
    removeFromParent() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter(c => c !== this);
        this.parent = null;
    }
    destroy() { this._destroyed = true; }
    setSiblingIndex(idx) {
        if (!this.parent) return;
        const arr = this.parent.children;
        const i = arr.indexOf(this);
        if (i >= 0) { arr.splice(i, 1); arr.splice(idx, 0, this); }
    }
    getChildByName(name) { return this.children.find(c => c.name === name) || null; }
    addComponent(Ctor) { const c = new Ctor(this); this.components.set(Ctor, c); return c; }
    getComponent(Ctor) { return this.components.get(Ctor) || null; }
    getComponentInChildren(Ctor) {
        if (this.components.has(Ctor)) return this.components.get(Ctor);
        for (const ch of this.children) { const f = ch.getComponentInChildren(Ctor); if (f) return f; }
        return null;
    }
    setPosition(x, y, z = 0) { this.position = { x, y, z }; }
    setScale(x, y, z = 1) { this.scale = { x, y, z }; }
    on(evt, fn, target) {
        if (!this.listeners.has(evt)) this.listeners.set(evt, []);
        this.listeners.get(evt).push({ fn, target });
    }
    emit(evt, arg) {
        for (const l of (this.listeners.get(evt) || [])) l.fn.call(l.target, arg);
    }
}
MockNode.EventType = { SIZE_CHANGED: 'size', TOUCH_END: 'touch-end' };

const stoppedTargets = [];
function makeTween() {
    const t = {
        to() { return t; }, set() { return t; }, call() { return t; },
        repeatForever() { return t; }, start() { return t; },
    };
    return t;
}

const campaignMap = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));

const engine = {
    Component: class {},
    EditBox: class {}, Toggle: class {}, Widget: class {}, Layout: class {},
    Node: MockNode, UITransform: MockUITransform, Label: MockLabel, Button: MockButton,
    Graphics: MockGraphics, Color: MockColor, Vec3: MockVec3, Sprite: MockSprite,
    SpriteFrame: MockSpriteFrame, UIOpacity: MockUIOpacity, BlockInputEvents: MockBlockInputEvents,
    Mask: MockMask, JsonAsset: class {}, EventTouch: class {},
    isValid: v => !!v,
    tween: () => makeTween(),
    Tween: { stopAllByTarget: target => stoppedTargets.push(target) },
    resources: {
        load(assetPath, _type, cb) {
            if (assetPath === 'world/campaign-map') cb(null, { json: campaignMap });
            else cb(null, new MockSpriteFrame());
        },
    },
    view: { getVisibleSize: () => ({ width: 1280, height: 720 }) },
    _decorator: { ccclass: () => type => type, property: () => () => {} },
};

function loadTs(file, imports = {}) {
    const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        fileName: file, reportDiagnostics: true, compilerOptions: {
            target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        },
    });
    assert.equal(result.diagnostics.length, 0, `TS diagnostics in ${file}`);
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', result.outputText)(id => {
        if (id === 'cc') return engine;
        if (Object.hasOwn(imports, id)) return imports[id];
        throw new Error(`Unmocked ${file}: ${id}`);
    }, mod, mod.exports);
    return mod.exports;
}

const ManagementStyle = loadTs('assets/scripts/map/ui/ManagementStyle.ts', {
    '../../common/BgLogic': { default: class {} },
});
const { EventMgr } = loadTs('assets/scripts/utils/EventMgr.ts');
const { ServerConfig } = loadTs('assets/scripts/config/ServerConfig.ts');
const { LogicEvent } = loadTs('assets/scripts/common/LogicEvent.ts');

const createMod = loadTs('assets/scripts/login/CreateLogic.ts', {
    '../config/ServerConfig': { ServerConfig },
    './LoginCommand': { default: { getInstance: () => ({ requestCreationOptions() {}, proxy: { getLoginData: () => ({ userId: 1 }) }, role_create: () => true }) } },
    '../utils/EventMgr': { EventMgr },
    '../libs/NameDict': { createName: () => '试剑客' },
    '../common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
    '../common/LogicEvent': { LogicEvent },
    '../map/ui/ManagementStyle': ManagementStyle,
});

const { containsBirthPoint, computeBirthLayout, resolveConquestPath, BIRTH_ART_SHAPES } = createMod;
const CreateLogic = createMod.default;

function rectOf(cx, cy, w, h) {
    return { left: cx - w / 2, right: cx + w / 2, bottom: cy - h / 2, top: cy + h / 2 };
}
function overlaps(a, b) {
    return a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.bottom < b.top - 0.5 && a.top > b.bottom + 0.5;
}
function insideScreen(r, sw, sh) {
    return r.left >= -sw / 2 - 0.5 && r.right <= sw / 2 + 0.5 && r.bottom >= -sh / 2 - 0.5 && r.top <= sh / 2 + 0.5;
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

test('full-screen 16:9 organic world map keeps all 6 birth regions, header, and bottom bar inside screen cleanly', () => {
    const viewports = [
        [1280, 720], [1920, 1080], [2340, 1080], [1024, 768], [720, 1280], [1080, 2340],
    ];
    const birthRegions = campaignMap.regions.filter(r => r.tier === 0);
    for (const [w, h] of viewports) {
        const m = computeBirthLayout(w, h);
        const barRect = rectOf(m.barX, m.barY, m.barW, m.barH);
        const headerRect = rectOf(m.headerX, m.headerY, m.headerW, m.headerH);
        assert.ok(m.mapW >= 720 || !m.landscape, `${w}x${h} landscape map should fill screen boldly: ${m.mapW}x${m.mapH}`);
        assert.ok(insideScreen(barRect, w, h), `${w}x${h} bottomBar out of screen`);
        assert.ok(insideScreen(headerRect, w, h), `${w}x${h} headerBanner out of screen`);
        assert.equal(overlaps(headerRect, barRect), false, `${w}x${h} headerBanner overlaps bottomBar`);
        // Verify all 6 birth region centers sit inside screen and clear of bottomBar
        for (const r of birthRegions) {
            const rx = m.mapOffsetX + (r.x / campaignMap.width - 0.5) * m.mapW;
            const ry = m.mapOffsetY + (0.5 - r.y / campaignMap.height) * m.mapH;
            assert.ok(Math.abs(rx) < w / 2 - 20 && Math.abs(ry) < h / 2 - 20, `${w}x${h} ${r.name} out of safe bounds`);
            assert.ok(ry - 24 > barRect.top - 14 || Math.abs(rx) > barRect.right, `${w}x${h} ${r.name} hidden behind bottomBar`);
        }
    }
});

test('real campaign-map.json polygons hit-test all 6 birth provinces and resolve conquest routes to 洛阳', () => {
    const birthRegions = campaignMap.regions.filter(r => r.tier === 0);
    assert.equal(birthRegions.length, 6);
    for (const region of birthRegions) {
        const hit = campaignMap.landShapes.find(s => containsBirthPoint(s.points, region.x, region.y));
        assert.ok(hit, `${region.name} center must hit a landShape`);
        assert.equal(hit.region, region.id, `${region.name} hit wrong region`);
        const pathInfo = resolveConquestPath(campaignMap, region.name);
        assert.ok(pathInfo && pathInfo.gate1 && pathInfo.midRegion && pathInfo.gate2 && pathInfo.capital,
            `${region.name} should resolve full gate1 -> midRegion -> gate2 -> 洛阳 route`);
        assert.equal(pathInfo.capital.name, '洛阳');
        const artPoly = BIRTH_ART_SHAPES[region.name];
        assert.ok(artPoly && artPoly.length >= 18, `${region.name} must have exact traced jade contour`);
        const u = 0.14 + (region.x / campaignMap.width) * 0.72;
        const v = 0.07 + (region.y / campaignMap.height) * 0.80;
        assert.equal(containsBirthPoint(artPoly, u, v), true, `${region.name} visual center must sit inside its exact traced jade polygon`);
        assert.equal(containsBirthPoint(artPoly, 0.02, 0.02), false, `${region.name} must not protrude into outer sea`);
        assert.equal(containsBirthPoint(artPoly, 0.98, 0.98), false, `${region.name} must not protrude into outer sea`);
    }
});

test('direct map tap selects province without right panel or flag pin and cleans up cleanly', () => {
    stoppedTargets.length = 0;
    const create = new CreateLogic();
    create.node = new MockNode('Root');
    const ui = create.node.addComponent(MockUITransform);
    ui.setContentSize(1280, 720);
    create.editName = { string: '', node: null };
    create.manToggle = { isChecked: true };

    create.onLoad();
    const offers = [
        { key: 1, name: '青州' }, { key: 2, name: '徐州' }, { key: 3, name: '荆州' },
        { key: 4, name: '益州' }, { key: 5, name: '凉州' }, { key: 6, name: '幽州' },
    ];
    create.configureZones(offers);
    assert.equal(create.sheet.getChildByName('StrategyCard'), null, 'right-hand card must be removed');
    assert.equal(create.sheet.getChildByName('HeaderBanner'), null, 'top-left header banner must be removed');
    assert.equal(create.createButton.interactable, false);
    assert.equal(create.createButtonLabel.string, '在此起兵');

    // Verify Overlay renders AFTER WorldArt so territory glow & march arrows are never occluded by terrain sprite!
    const artIdx = create.mapNode.children.indexOf(create.worldArtNode);
    const overlayIdx = create.mapNode.children.indexOf(create.overlayNode);
    assert.ok(artIdx >= 0 && overlayIdx > artIdx, 'Overlay Graphics must render ABOVE WorldArt Sprite');

    // Simulate direct map polygon click on 益州 center
    const yizhou = campaignMap.regions.find(r => r.name === '益州');
    const tapX = create.mapOffsetX + (yizhou.x / campaignMap.width - 0.5) * create.mapW;
    const tapY = create.mapOffsetY + (0.5 - yizhou.y / campaignMap.height) * create.mapH;
    create.mapNode.emit(MockNode.EventType.TOUCH_END, {
        propagationStopped: false,
        getUILocation: () => ({ x: tapX, y: tapY }),
    });

    assert.equal(create.selected?.name, '益州');
    assert.equal(create.zoneName.string, '益州');
    assert.equal(create.sealText.string, '益');
    assert.ok(create.routeText.string.includes('剑门关') && create.routeText.string.includes('洛阳'));
    assert.equal(create.createButton.interactable, true);
    assert.equal(create.createButtonLabel.string, '于益州起兵');
    assert.equal(create.mapNode.getChildByName('SelectionPin'), null, 'flag/chess pin must not be spawned');

    stoppedTargets.length = 0;
    create.onDestroy();
    assert.deepEqual(stoppedTargets, [create.mapNode, create.zoneName.node.getComponent(MockUIOpacity)]);
    assert.equal(create.zoneOpacity, null);
});

console.log(`PASS ${passed} birth-select UI regression groups`);
process.exit(0);
