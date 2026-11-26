// 执行实际奖励窗口逻辑；不启动 Preview、不领取奖励、不连接服务器。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

function harness() {
    const images = [], pendingTweens = [];
    class Vec3 {
        constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
        clone() { return new Vec3(this.x, this.y, this.z); }
    }
    class Component {
        isValid = true; callbacks = [];
        unscheduleAllCallbacks() { this.callbacks.length = 0; }
        scheduleOnce(callback) { this.callbacks.push(callback); }
        schedule(callback) { this.callbacks.push(callback); }
    }
    class UITransform {
        width = 64; height = 64;
        setContentSize(width, height) { Object.assign(this, { width, height }); }
        setAnchorPoint() {}
    }
    class Node {
        constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.isValid = true; this.position = new Vec3(); }
        get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
        addChild(node) { node.parent = this; this.children.push(node); }
        getChildByName(name) { return this.children.find(node => node.name === name) || null; }
        addComponent(Type) { const value = new Type(); value.node = this; this.components.set(Type, value); return value; }
        getComponent(Type) { return this.components.get(Type) || null; }
        getComponents(Type) { return this.getComponent(Type) ? [this.getComponent(Type)] : []; }
        setPosition(x, y, z = 0) { this.position = typeof x === 'object' ? x.clone() : new Vec3(x, y, z); }
        setScale(x, y, z = 1) { this.scale = new Vec3(x, y, z); }
        setSiblingIndex() {}
        destroy() { this.isValid = false; }
    }
    class Label extends Component {
        static HorizontalAlign = { LEFT: 0, CENTER: 1 };
        static VerticalAlign = { CENTER: 1 };
        static Overflow = { SHRINK: 1 };
        string = '';
    }
    class Sprite extends Component { spriteFrame = null; }
    class UIOpacity { opacity = 255; }
    const Tween = { stopAllByTarget(target) { for (const tween of pendingTweens) if (tween.target === target) tween.cancelled = true; } };
    function tween(target) {
        const job = { target, actions: [], cancelled: false };
        const chain = {
            to(_seconds, values) { job.actions.push(() => Object.assign(target, values)); return chain; },
            delay() { return chain; },
            call(callback) { job.actions.push(callback); return chain; },
            start() { pendingTweens.push(job); return chain; },
        };
        return chain;
    }
    function flushTweens() {
        for (const job of pendingTweens.splice(0)) if (!job.cancelled) job.actions.forEach(action => action());
    }
    const cc = { Component, Node, Vec3, Label, Sprite, UIOpacity, UITransform, Tween, tween,
        Color: class { constructor(r, g, b, a = 255) { Object.assign(this, { r, g, b, a }); } },
        Button: class { static EventType = { CLICK: 'click' }; }, SpriteFrame: class {},
        director: { getScene: () => null }, view: { getVisibleSize: () => ({ width: 1280, height: 720 }), off() {} },
        isValid: (value, strict) => !!value && value.isValid !== false && !(strict && value.destroyQueued),
        resources: { load(asset, _type, callback) { images.push({ asset, callback }); } },
        _decorator: { ccclass: () => value => value },
    };
    const imports = {
        '../utils/EventMgr': { EventMgr: { on() {} } }, '../common/LogicEvent': { LogicEvent: {} },
        '../core/ConfigManager': { default: { getInstance: () => ({ getConfig: () => [] }) } },
        '../general/GeneralPortrait': { getGeneralPortraitPath: () => 'hero/spriteFrame' },
        '../map/ui/ManagementStyle': { ManagementColors: {}, place(node, x, y, width, height) {
            if (!node) return;
            node.setPosition(x, y); node.getComponent(UITransform).setContentSize(width, height);
        } },
        '../common/ItemPresentation': { itemName: id => '道具 ' + id, itemGlyph: () => '物', itemIconPath: id => 'item/' + id },
    };
    const file = 'assets/scripts/reward/RewardWindowLogic.ts';
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file,
        reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS, experimentalDecorators: true } });
    assert.equal(source.diagnostics.length, 0, '奖励窗口语法有效');
    const module = { exports: {} };
    new Function('require', 'module', 'exports', source.outputText)(id => {
        if (id === 'cc') return cc;
        if (imports[id]) return imports[id];
        throw new Error('未声明的测试依赖：' + id);
    }, module, module.exports);
    function makeNode(name, parent) {
        const node = new Node(name); node.addComponent(UITransform); if (parent) parent.addChild(node); return node;
    }
    function window() {
        const ui = new module.exports.default();
        ui.node = makeNode('RewardWindow', makeNode('Canvas'));
        ui.panel = makeNode('Panel', ui.node); ui.confirm = makeNode('Confirm', ui.panel);
        ui.opacity = ui.node.addComponent(UIOpacity);
        ui.fxRays = makeNode('Rays', ui.node); ui.fxGlow = makeNode('Glow', ui.node);
        ui.animations = 0; ui.builds = 0;
        ui.layoutWindow = function () {
            const layout = module.exports.rewardWindowLayout(this.rewards.length, 1280, 720);
            this.pageSize = layout.pageSize;
        };
        ui.buildItems = function () { this.builds++; };
        ui.animateIn = function () { this.animations++; this.opacity.opacity = 255; };
        return ui;
    }
    return { ...module.exports, window, makeNode, cc, images, flushTweens };
}
const reward = id => ({ rewardType: 2, itemId: id, itemCount: id * 100 });

test('奖励形成清晰视觉中心，多项分页并适应横竖屏', () => {
    const { rewardWindowLayout: layout, rewardItemLayout } = harness();
    const two = layout(2, 1280, 720);
    assert.ok(two.width >= 640); assert.ok(two.height >= 340);
    assert.equal(two.rows, 1); assert.equal(two.paged, false);
    const featured = rewardItemLayout(two.cardWidth, two.cardHeight);
    assert.ok(featured.icon >= 112 && featured.nameSize >= 18 && featured.countSize >= 24, '奖励不能再缩成地图上的小标签');
    assert.ok(layout(1, 1280, 720).width <= two.width);
    assert.ok(layout(5, 1280, 720).height > two.height);
    for (const [count, width, height] of [[1, 320, 568], [2, 568, 320], [7, 390, 844], [20, 1280, 720], [20, 568, 320]]) {
        const m = layout(count, width, height);
        assert.ok(m.width <= width && m.height <= height, '面板不能溢出可见区域');
        assert.ok(m.columns >= 1 && m.columns <= 4 && m.rows >= 1 && m.rows <= 2);
        assert.equal(m.pageSize, m.columns * m.rows);
        assert.ok(m.cardWidth > 0 && m.cardHeight > 0 && m.contentHeight > 0);
        assert.ok(m.headerHeight + m.contentHeight + m.footerHeight <= m.height + .01, '内容不能与标题和关闭提示重叠');
        assert.equal(m.paged, count > m.pageSize);
    }
});

test('窄屏和矮屏保留图标、名称、数量间距，分页内容不超出舞台', () => {
    const { rewardWindowLayout, rewardItemLayout } = harness();
    for (const [width, height] of [[320, 240], [320, 568], [390, 844], [568, 320], [844, 390], [1280, 720]]) {
        for (const count of [1, 2, 3, 4, 5, 8, 20]) {
            const m = rewardWindowLayout(count, width, height), item = rewardItemLayout(m.cardWidth, m.cardHeight);
            assert.ok(m.width <= width - 32 && m.height <= height - 32, `${width}x${height}: ${count} 项`);
            assert.ok(m.columns * m.cardWidth + (m.columns - 1) * m.columnGap <= m.width);
            if (!item.horizontal) {
                assert.ok(item.iconY + item.icon / 2 <= m.cardHeight / 2);
                assert.ok(item.iconY - item.icon / 2 > item.nameY + 14, '图标与名称不能相压');
                assert.ok(item.nameY - 14 > item.countY + 19, '名称和数量必须分行');
                assert.ok(item.countY - 19 >= -m.cardHeight / 2);
            } else {
                assert.ok(item.iconX + item.icon / 2 < item.textX - item.textWidth / 2, '矮屏图标与文字分列');
                assert.ok(item.nameY - 10 > item.countY + 13);
            }
        }
    }
});

test('首次展示不等待特效，连发追加保留当前页且不重播', () => {
    const h = harness(), ui = h.window();
    ui.play(Array.from({ length: 17 }, (_, i) => reward(i + 1)), false);
    assert.equal(ui.builds, 1); assert.equal(ui.animations, 1); assert.equal(ui.confirm.active, false);
    assert.equal(h.images.length, 0, '普通奖励打开不能等待光效资源');
    ui.page = 1;
    const first = ui.page * ui.pageSize, firstReward = ui.rewards[first];
    ui.play([reward(99)], true);
    assert.equal(ui.rewards.length, 18); assert.equal(ui.opacity.opacity, 255);
    assert.equal(ui.animations, 1, '追加时不能重播或闪白');
    assert.equal(ui.rewards[ui.page * ui.pageSize], firstReward, '保留当前页首奖励');
});

test('关闭幂等，关闭中到达的新奖励不混入旧批且不被旧回调关闭', () => {
    const h = harness(), ui = h.window();
    ui.play([reward(1), reward(2)], false);
    ui.dismiss(); ui.dismiss();
    assert.equal(ui.closing, true);
    ui.play([reward(3)], true);
    assert.deepEqual(ui.rewards, [reward(3)], '旧批已经确认，不应追加回来');
    h.flushTweens();
    assert.equal(ui.closing, false); assert.equal(ui.node.active, true, '旧关闭回调不得隐藏新奖励');
});

test('图标迟到不能覆盖新页，关闭后回调无效，缺图仍有名称和徽记', () => {
    const h = harness(), ui = h.window();
    function cell() {
        const node = h.makeNode('RewardCard', ui.panel);
        h.makeNode('Icon', node).addComponent(h.cc.Sprite);
        h.makeNode('Name', node).addComponent(h.cc.Label);
        h.makeNode('Count', node).addComponent(h.cc.Label);
        return node;
    }
    const oldCell = cell(); ui.fillCell(oldCell, reward(1));
    ui.itemGeneration++;
    const nextCell = cell(); ui.fillCell(nextCell, { ...reward(2), itemCount: 12345 });
    const frame = { originalSize: { width: 80, height: 40 } };
    h.images[0].callback(null, frame);
    assert.equal(oldCell.getChildByName('Icon').getComponent(h.cc.Sprite).spriteFrame, null);
    h.images[1].callback(null, frame);
    assert.equal(nextCell.getChildByName('Icon').getComponent(h.cc.Sprite).spriteFrame, frame);
    assert.equal(nextCell.getChildByName('ItemGlyph').active, false);
    assert.equal(nextCell.getChildByName('Count').getComponent(h.cc.Label).string, '×12,345');
    const closingCell = cell(); ui.fillCell(closingCell, reward(3)); ui.onDisable();
    h.images[2].callback(null, frame);
    assert.equal(closingCell.getChildByName('Icon').getComponent(h.cc.Sprite).spriteFrame, null);
    const missingCell = cell(); ui.fillCell(missingCell, reward(4));
    h.images[3].callback(new Error('missing'), null);
    assert.equal(missingCell.getChildByName('ItemGlyph').active, true);
    assert.equal(missingCell.getChildByName('Name').getComponent(h.cc.Label).string, '道具 4');
});

test('物品揭晓后完整可读，取消动画可立即收束且不会残留透明物品', () => {
    const h = harness(), ui = h.window();
    ui.titleNode = h.makeNode('Title', ui.panel);
    ui.glow = h.makeNode('Halo', ui.panel); ui.rays = h.makeNode('Rays', ui.panel);
    ui.itemNodes = Array.from({ length: 8 }, (_, i) => h.makeNode('Reward' + i, ui.panel));
    h.default.prototype.animateIn.call(ui);
    assert.equal(ui.itemNodes[7].getComponent(h.cc.UIOpacity).opacity, 0);
    h.flushTweens();
    for (const cell of ui.itemNodes) {
        assert.equal(cell.getComponent(h.cc.UIOpacity).opacity, 255);
        assert.equal(cell.scale.x, 1);
    }
    assert.equal(ui.glow.getComponent(h.cc.UIOpacity).opacity, 0);
    h.default.prototype.animateIn.call(ui);
    ui.finishReveal(); h.flushTweens();
    assert.equal(ui.fxTime, 1);
    assert.equal(ui.rays.getComponent(h.cc.UIOpacity).opacity, 0);
    for (const cell of ui.itemNodes) assert.equal(cell.getComponent(h.cc.UIOpacity).opacity, 255);
});
test('金屑单次播放后清空，关闭时停止绘制', () => {
    const h = harness(), ui = h.window(); let clears = 0, shapes = 0;
    ui.motes = { clear() { clears++; }, moveTo() {}, lineTo() {}, close() {}, fill() { shapes++; } };
    ui.fxTime = 0;
    for (let i = 0; i < 25; i++) ui.update(.05);
    assert.equal(ui.fxTime, 1); assert.ok(shapes > 0);
    const settled = clears; ui.update(.1); assert.equal(clears, settled, '结束后不持续绘制');
    ui.fxTime = 0; ui.dismiss(); assert.equal(ui.fxTime, 1);
    const closed = clears; ui.update(.1); assert.equal(clears, closed);
});
console.log(`通过 ${passed} 项普通奖励回归`);
