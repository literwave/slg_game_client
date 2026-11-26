// Offline regression tests for CloudVeilTransition, CreateLogic launch dive, and Main integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');

function makeGraphics() {
    return {
        fillColor: null, strokeColor: null, lineWidth: 1,
        clear() {}, rect() {}, roundRect() {}, circle() {}, ellipse() {},
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

class MockSprite { constructor(node) { this.node = node; this.spriteFrame = null; this.sizeMode = 0; this.customMaterial = null; this.isValid = true; } }
MockSprite.SizeMode = { TRIMMED: 0, RAW: 1, CUSTOM: 2 };
class MockSpriteFrame { destroy() { this.destroyed = true; } }
class MockUIOpacity { constructor(node) { this.node = node; this.opacity = 255; this.isValid = true; } }
class MockBlockInputEvents { constructor(node) { this.node = node; } }
class MockGraphics { constructor(node) { this.node = node; Object.assign(this, makeGraphics()); } }
class MockColor { constructor(r = 0, g = 0, b = 0, a = 255) { this.r = r; this.g = g; this.b = b; this.a = a; } }
class MockVec3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
class MockVec4 {
    constructor(x = 0, y = 0, z = 0, w = 0) { this.set(x, y, z, w); }
    set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
}
class MockEffectAsset { constructor() { this.refs = 0; } addRef() { this.refs++; } }
class MockImageAsset { destroy() { this.destroyed = true; } }
class MockTexture2D {
    setFilters() {} setWrapMode() {} destroy() { this.destroyed = true; }
}
MockTexture2D.PixelFormat = { RGBA8888: 35 };
MockTexture2D.Filter = { LINEAR: 2 };
MockTexture2D.WrapMode = { CLAMP_TO_EDGE: 1 };

const materialProps = [];
class MockMaterial {
    initialize(info) { this.effect = info.effectAsset; }
    setProperty(name, value) { materialProps.push({ name, value: { x: value.x, y: value.y, z: value.z, w: value.w } }); }
    destroy() { this.destroyed = true; }
}

class MockNode {
    constructor(name = 'Node') {
        this.name = name; this.layer = 2; this.active = true; this.isValid = true;
        this.parent = null; this.children = []; this.components = new Map();
        this.listeners = new Map(); this.position = { x: 0, y: 0, z: 0 }; this.scale = { x: 1, y: 1, z: 1 };
    }
    addChild(child) { child.parent = this; this.children.push(child); }
    removeFromParent() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter(c => c !== this);
        this.parent = null;
    }
    destroy() { this.isValid = false; this._destroyed = true; }
    setSiblingIndex(idx) {
        if (!this.parent) return;
        const arr = this.parent.children;
        const i = arr.indexOf(this);
        if (i >= 0) { arr.splice(i, 1); arr.splice(idx, 0, this); }
    }
    getChildByName(name) { return this.children.find(c => c.name === name) || null; }
    addComponent(Ctor) { const c = new Ctor(this); c.node = this; this.components.set(Ctor, c); return c; }
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
    off(evt, fn, target) {
        const list = this.listeners.get(evt);
        if (!list) return;
        this.listeners.set(evt, list.filter(item => item.fn !== fn || item.target !== target));
    }
    emit(evt, arg) {
        for (const l of (this.listeners.get(evt) || [])) l.fn.call(l.target, arg);
    }
}
MockNode.EventType = { SIZE_CHANGED: 'size', TOUCH_END: 'touch-end' };

const effectAsset = new MockEffectAsset();
const tweens = [];
const engine = {
    Component: class { isValid = true; },
    EditBox: class {}, Toggle: class {}, Widget: class {}, Layout: class {},
    Node: MockNode, UITransform: MockUITransform, Label: MockLabel, Button: MockButton,
    Graphics: MockGraphics, Color: MockColor, Vec3: MockVec3, Vec4: MockVec4, Sprite: MockSprite,
    SpriteFrame: MockSpriteFrame, UIOpacity: MockUIOpacity, BlockInputEvents: MockBlockInputEvents,
    EffectAsset: MockEffectAsset, Material: MockMaterial, ImageAsset: MockImageAsset, Texture2D: MockTexture2D,
    JsonAsset: class {}, EventTouch: class {},
    isValid: v => !!v && v.isValid !== false,
    tween(target) {
        const record = { target, steps: [] };
        const t = {
            to(duration, props, opts) { record.steps.push({ duration, props, opts }); return t; },
            start() { tweens.push(record); return t; },
        };
        return t;
    },
    Tween: { stopAllByTarget() {} },
    resources: {
        load(assetPath, _type, cb) {
            if (assetPath === 'effects/cloud-veil' || assetPath === 'effects/pv-scroll-motion') cb(null, effectAsset);
            else if (assetPath === 'world/campaign-map') cb(null, { json: campaignMap });
            else cb(null, new MockSpriteFrame());
        },
    },
    view: { getVisibleSize: () => ({ width: 1280, height: 720 }), on() {}, off() {} },
    _decorator: { ccclass: () => type => type, property: () => () => {} },
};

const campaignMap = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));

function loadTs(file, imports = {}) {
    const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        fileName: file, reportDiagnostics: true, compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
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
const { CoreEvent } = loadTs('assets/scripts/core/CoreEvent.ts');
const { LogicEvent } = loadTs('assets/scripts/common/LogicEvent.ts');
const { ServerConfig } = loadTs('assets/scripts/config/ServerConfig.ts');
const CloudVeilTransition = loadTs('assets/scripts/common/CloudVeilTransition.ts', {
    '../core/CoreEvent': { CoreEvent },
    '../utils/EventMgr': { EventMgr },
    '../map/ui/ManagementStyle': ManagementStyle,
}).default;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

test('cloud-veil.effect declares valid Cocos CCEffect structure and required uniforms', () => {
    const src = fs.readFileSync(path.join(root, 'assets/resources/effects/cloud-veil.effect'), 'utf8');
    assert.match(src, /CCEffect\s*%\{/);
    assert.match(src, /CCProgram\s+veil-vs\s*%\{/);
    assert.match(src, /CCProgram\s+veil-fs\s*%\{/);
    assert.match(src, /uniform\s+CloudVeil/);
    assert.match(src, /vec4\s+veilState/);
    assert.match(src, /vec4\s+veilStyle/);
    assert.match(src, /CCSampleWithAlphaSeparated\s*\(\s*cc_spriteTexture/);
});

test('fast load skips emblem completely (anti-flash), covers first, then reveals cleanly once', () => {
    materialProps.length = 0;
    const parent = new MockNode('Canvas');
    parent.addComponent(MockUITransform).setContentSize(1280, 720);
    const host = new MockNode('CloudTransition');
    parent.addChild(host);
    const veil = host.addComponent(CloudVeilTransition);
    veil.onLoad();

    let covered = 0, revealed = 0, finished = 0;
    veil.beginCover(() => covered++, { seal: '益', title: '入主益州', subtitle: '天府沃野 · 剑阁天险', focusU: 0.25, focusV: 0.35 });
    assert.equal(veil.currentPhase, 'closing');
    assert.equal(covered, 0);

    // Finish arrives before clouds finish closing
    veil.finish(() => finished++, { onRevealStart: () => revealed++ });
    veil.finish(() => { throw new Error('finish must be idempotent'); });

    for (let i = 0; i < 40 && veil.currentPhase !== 'done'; i++) {
        veil.update(0.05);
        assert.equal(veil.isEmblemVisible, false, 'fast load must never flash emblem or progress bar');
    }
    assert.equal(covered, 1);
    assert.equal(revealed, 1);
    assert.equal(finished, 1);
    assert.equal(veil.currentPhase, 'done');
    assert.equal(host.isValid, false);
    assert.ok(materialProps.some(p => p.name === 'veilState' && p.value.w === 1), 'reveal mode uniform must be driven');
});

test('slow load fades in themed seal & progress bar, gates at 99% until finish(), then dissolves & parts clouds', () => {
    const parent = new MockNode('Canvas');
    parent.addComponent(MockUITransform).setContentSize(1280, 720);
    const host = new MockNode('CloudTransition');
    parent.addChild(host);
    const veil = host.addComponent(CloudVeilTransition);
    veil.onLoad();

    let covered = 0, revealed = 0, finished = 0;
    veil.beginCover(() => covered++, { seal: '荆', title: '入主荆州', subtitle: '江汉要冲 · 兵家必争', focusU: 0.3, focusV: 0.6 });
    for (let i = 0; i < 10; i++) veil.update(0.05); // 0.50s -> covered + 0.08s
    assert.equal(covered, 1);
    assert.equal(veil.currentPhase, 'covered');
    assert.equal(veil.isEmblemVisible, false, 'emblem waits past anti-flash delay');

    EventMgr.emit(CoreEvent.loadProgress, 1);
    EventMgr.emit(CoreEvent.mapLoadProgress, 0.99, '正在部署城池与资源…');
    for (let i = 0; i < 16; i++) veil.update(0.05); // +0.80s -> emblem visible
    assert.equal(veil.isEmblemVisible, true, 'emblem appears on sustained load');
    assert.equal(veil.currentPhase, 'covered');
    assert.equal(finished, 0);

    veil.finish(() => finished++, { onRevealStart: () => revealed++ });
    assert.equal(veil.currentPhase, 'finishing');
    for (let i = 0; i < 40 && veil.currentPhase !== 'done'; i++) veil.update(0.05);
    assert.equal(revealed, 1);
    assert.equal(finished, 1);
    assert.equal(veil.currentPhase, 'done');
    assert.equal(host.isValid, false);
});

test('CreateLogic produces birth-zone transition theme, dives on confirm, and rolls back on failure', () => {
    tweens.length = 0;
    const CreateLogic = loadTs('assets/scripts/login/CreateLogic.ts', {
        '../config/ServerConfig': { ServerConfig },
        './LoginCommand': { default: { getInstance: () => ({ requestCreationOptions() {}, proxy: { getLoginData: () => ({ userId: 1 }) }, role_create: () => true }) } },
        '../utils/EventMgr': { EventMgr },
        '../libs/NameDict': { createName: () => '试剑客' },
        '../common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
        '../common/LogicEvent': { LogicEvent },
        '../map/ui/ManagementStyle': ManagementStyle,
    }).default;

    const create = new CreateLogic();
    create.node = new MockNode('CreateRoot');
    create.node.addComponent(MockUITransform).setContentSize(1280, 720);
    create.editName = { string: '', node: null };
    create.manToggle = { isChecked: true };
    create.scheduleOnce = () => {};
    create.unschedule = () => {};
    create.onLoad();
    create.configureZones([
        { key: 1, name: '青州' }, { key: 2, name: '徐州' }, { key: 3, name: '荆州' },
        { key: 4, name: '益州' }, { key: 5, name: '凉州' }, { key: 6, name: '幽州' },
    ]);
    assert.equal(create.getLaunchTransitionTheme(), null, 'no theme before selecting a zone');

    const yizhou = campaignMap.regions.find(r => r.name === '益州');
    const tapX = create.mapOffsetX + (yizhou.x / campaignMap.width - 0.5) * create.mapW;
    const tapY = create.mapOffsetY + (0.5 - yizhou.y / campaignMap.height) * create.mapH;
    create.mapNode.emit(MockNode.EventType.TOUCH_END, {
        propagationStopped: false,
        getUILocation: () => ({ x: tapX, y: tapY }),
    });
    const theme = create.getLaunchTransitionTheme();
    assert.equal(theme.seal, '益');
    assert.equal(theme.title, '入主益州');
    assert.equal(theme.zoneName, '益州');
    assert.equal(theme.storyLines.length, 8);
    assert.match(theme.storyLines[0], /焚洛|炎汉/);
    assert.match(theme.storyLines[1], /十三雄关/);
    assert.match(theme.storyLines[4], /益州/);
    assert.match(theme.storyLines[6], /洛阳/);
    assert.match(theme.storyLines[7], /益州/);
    assert.match(theme.chapterMark, /益州/);
    assert.match(theme.subtitle, /天府沃野/);
    assert.ok(theme.focusU > 0.14 && theme.focusU < 0.86);
    assert.ok(theme.focusV > 0.14 && theme.focusV < 0.86);

    tweens.length = 0;
    create.onClickCreate();
    assert.ok(tweens.some(t => t.target === create.mapNode && t.steps[0].props.scale.x > 1.2), 'confirming triggers map dive');
    assert.ok(tweens.some(t => t.steps[0].props.opacity === 0), 'confirming fades header/bottom chrome');

    tweens.length = 0;
    EventMgr.emit(ServerConfig.s2c_user_create, { result: 3 });
    assert.ok(tweens.some(t => t.target === create.mapNode && t.steps[0].props.scale.x === 1), 'failure springs map back');
    assert.ok(tweens.some(t => t.steps[0].props.opacity === 255), 'failure restores header/bottom chrome');
    create.onDestroy();
});

test('story PV prologue absorbs fast loading, allows tap-to-skip once ready, and auto-reveals when finished', () => {
    const parent = new MockNode('Canvas');
    parent.addComponent(MockUITransform).setContentSize(1280, 720);
    const host = new MockNode('CloudTransition');
    parent.addChild(host);
    const veil = host.addComponent(CloudVeilTransition);
    veil.onLoad();

    let covered = 0, revealed = 0, finished = 0;
    veil.beginCover(() => covered++, {
        seal: '益',
        title: '入主益州',
        zoneName: '益州',
        storyLines: ['汉末烟尘四起，群雄割据，万里山河待新主。', '主公择定益州——天府沃野，剑阁天险。'],
        chapterMark: '大旗初立 · 入主益州',
        focusU: 0.28,
        focusV: 0.36,
    });
    assert.equal(veil.isStoryMode, true);
    veil.finish(() => finished++, { onRevealStart: () => revealed++ });
    // Even though map is already ready, story prologue plays instead of cutting immediately
    for (let i = 0; i < 16; i++) veil.update(0.05); // 0.80s
    assert.equal(covered, 1);
    assert.equal(veil.currentPhase, 'covered');
    assert.equal(finished, 0);

    // Every click turns to a brand-new unique chapter painting (0 -> 1)
    assert.equal(veil.currentStoryAct, 0);
    veil.advanceOrSkipStory();
    assert.equal(veil.currentStoryAct, 1, 'every click flips immediately to a brand-new painting');

    // Skipping once map is ready transitions immediately into reveal
    veil.skipStory();
    assert.equal(veil.currentPhase, 'finishing');
    for (let i = 0; i < 40 && veil.currentPhase !== 'done'; i++) veil.update(0.05);
    assert.equal(revealed, 1);
    assert.equal(finished, 1);
    assert.equal(veil.currentPhase, 'done');

    // Player-paced 8-chapter unique-art storybook: never auto-cuts, clicks turn through all 8 paintings (0..7), final click reveals
    const host2 = new MockNode('CloudTransition2');
    parent.addChild(host2);
    const veil2 = host2.addComponent(CloudVeilTransition);
    veil2.onLoad();
    let done2 = 0;
    veil2.beginCover(() => {}, {
        seal: '青',
        title: '入主青州',
        zoneName: '青州',
        storyLines: ['第一卷', '第二卷', '第三卷', '第四卷', '第五卷青州', '第六卷', '第七卷洛阳', '第八卷'],
        chapterMark: '大旗初立 · 入主青州',
    });
    for (let i = 0; i < 80; i++) veil2.update(0.05); // 4s on page 0 -> stays rock-steady without auto-cutting
    assert.equal(veil2.currentPhase, 'covered');
    assert.equal(veil2.currentStoryAct, 0);
    for (let next = 1; next <= 7; next++) {
        veil2.advanceOrSkipStory();
        assert.equal(veil2.currentStoryAct, next, `click ${next} turns to unique painting ${next + 1}`);
        for (let i = 0; i < 16; i++) veil2.update(0.05);
    }
    veil2.advanceOrSkipStory(); // map not ready yet -> holds gracefully on final volume 8
    assert.equal(veil2.currentPhase, 'covered');
    assert.equal(done2, 0);
    veil2.finish(() => done2++);
    veil2.advanceOrSkipStory(); // player taps final volume once map is ready -> reveals city
    for (let i = 0; i < 40 && veil2.currentPhase !== 'done'; i++) veil2.update(0.05);
    assert.equal(done2, 1);
    assert.equal(veil2.currentPhase, 'done');
});

test('cloud veil overscans full UI camera/visible viewport and wakes emblem promptly after heavy load frames', () => {
    const prevGetVisibleSize = engine.view.getVisibleSize;
    const prevGetScaleY = engine.view.getScaleY;
    const prevScreen = engine.screen;
    try {
        // Parent Canvas still reports 1280x720 while visible/UI camera viewport is wider (1600x760)
        engine.view.getVisibleSize = () => ({ width: 1520, height: 720 });
        engine.view.getScaleY = () => 1;
        engine.screen = { windowSize: { width: 1600, height: 760 } };

        const parent = new MockNode('Canvas');
        parent.addComponent(MockUITransform).setContentSize(1280, 720);
        const host = new MockNode('CloudTransitionBleed');
        parent.addChild(host);
        const veil = host.addComponent(CloudVeilTransition);
        veil.onLoad();
        veil.beginCover();

        const shaderUi = host.getChildByName('ShaderVeil').getComponent(MockUITransform);
        const fallbackUi = host.getChildByName('FallbackClouds').getComponent(MockUITransform);
        assert.ok(shaderUi.width >= 1600 + 64, `ShaderVeil width ${shaderUi.width} must overscan camera width 1600`);
        assert.ok(shaderUi.height >= 760 + 64, `ShaderVeil height ${shaderUi.height} must overscan camera height 760`);
        assert.ok(fallbackUi.width >= 1600 + 64, 'FallbackClouds must match full-bleed overscan width');
        assert.ok(fallbackUi.height >= 760 + 64, 'FallbackClouds must match full-bleed overscan height');

        // Advance through closing (8 * 0.05s = 0.40s >= 0.36s)
        for (let i = 0; i < 8; i++) veil.update(0.05);
        assert.equal(veil.currentPhase, 'covered');
        assert.equal(veil.isEmblemVisible, false);

        // Simulate a single heavy map prefab instantiation frame stalling 240ms:
        // emblem must wake up immediately instead of leaving the player staring at empty clouds.
        veil.update(0.24);
        assert.equal(veil.isEmblemVisible, true, 'stalled load frame must promptly reveal emblem instead of blank fog');
        assert.ok(host.getChildByName('Emblem').getChildByName('EmblemBackdrop'), 'emblem backdrop must exist');
    } finally {
        engine.view.getVisibleSize = prevGetVisibleSize;
        engine.view.getScaleY = prevGetScaleY;
        engine.screen = prevScreen;
    }
});

console.log(`PASS ${passed} cloud-veil transition regression groups`);
process.exit(0);
