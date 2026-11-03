// 执行真实侧栏控制器，覆盖动态地块页的初始化和 ToggleContainer 互斥时序。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { Object.assign(this, typeof x === 'object' ? x : { x, y, z }); }
}
class Component {
    enabled = true;
    getComponent(Type) { return this.node.getComponent(Type); }
    scheduleOnce(fn) { this.deferred = fn; }
}
class UITransform extends Component {
    width = 260; height = 240;
    setContentSize(w, h) { this.width = w; this.height = h; }
}
class Node {
    static EventType = { SIZE_CHANGED: 'size-changed' };
    active = true; isValid = true; layer = 1; children = []; components = new Map(); events = new Map(); position = new Vec3();
    constructor(name = '') { this.name = name; }
    get parent() { return this._parent; }
    set parent(value) {
        if (this._parent) this._parent.children.splice(this._parent.children.indexOf(this), 1);
        this._parent = value; if (value) value.children.push(this);
    }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    addChild(child) { child.parent = this; }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    getChildByName(name) { return this.children.find(n => n.name === name) || null; }
    getComponentInChildren(Type) { return this.getComponent(Type) || this.children.map(n => n.getComponentInChildren(Type)).find(Boolean); }
    setPosition(x, y, z) { this.position.set(x, y, z); }
    on(type, fn, owner) { this.events.set(type, [...(this.events.get(type) || []), { fn, owner }]); }
    off(type, fn, owner) { this.events.set(type, (this.events.get(type) || []).filter(e => e.fn !== fn || e.owner !== owner)); }
    emit(type, ...args) { for (const { fn, owner } of this.events.get(type) || []) fn.apply(owner, args); }
}
class ToggleContainer extends Component {
    allowSwitchOff = false;
    get items() { return this.node.children.map(n => n.getComponent(Toggle)).filter(Boolean); }
    notifyToggleCheck(toggle, emitEvent) { for (const item of this.items) if (item !== toggle) item.setChecked(false, emitEvent); }
}
class Toggle extends Component {
    static EventType = { TOGGLE: 'toggle' };
    _isChecked = true;
    get isChecked() { return this._isChecked; }
    set isChecked(value) { this.setChecked(value, true); }
    setIsCheckedWithoutNotify(value) { this.setChecked(value, false); }
    setChecked(value, emitEvent) {
        if (this._isChecked === value) return;
        this._isChecked = value;
        const group = this.node.parent?.getComponent(ToggleContainer);
        if (group?.enabled && this.enabled && (value || !group.items.some(t => t.isChecked) && !group.allowSwitchOff)) {
            this._isChecked = true; group.notifyToggleCheck(this, emitEvent);
        }
        if (emitEvent) this.node.emit(Toggle.EventType.TOGGLE, this);
    }
}
class Label extends Component { static HorizontalAlign = { CENTER: 1 }; }
class ScrollView extends Component { stopAutoScroll() {} scrollToTop() {} }
class Mask extends Component { static Type = { GRAPHICS_RECT: 0 }; }
const cc = { Component, Node, UITransform, Vec3, Toggle, ScrollView, Label, Mask,
    BlockInputEvents: class {}, Color: class {}, Tween: { stopAllByTarget() {} },
    _decorator: { ccclass: () => v => v, property: () => () => {} } };
function node(name, parent) { const n = new Node(name); n.addComponent(UITransform); if (parent) parent.addChild(n); return n; }
const modules = {
    './SidebarIconCache': { default: { prepare: () => Promise.resolve(), frame: () => null } },
    '../../utils/EventMgr': { EventMgr: { on() {}, targetOff() {} } },
    '../../common/LogicEvent': { LogicEvent: {} },
    '../../core/CoreEvent': { CoreEvent: { gameReady: 'game-ready' } },
    '../../common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
    '../../world/MapMarkCommand': { default: { getInstance: () => ({ loaded: true }) } },
    './RightHudSkin': { drawCommandPanel() {}, drawCommandHandle() {} },
    './RightSidebarView': {
        commandTab() {},
        commandEmpty(parent, name, text, kind, width, height = 116) {
            const empty = node(name, parent); empty.getComponent(UITransform).setContentSize(width, height); return empty;
        },
    },
    './ManagementStyle': {
        ManagementColors: {},
        caption(parent, name, text) { const label = node(name, parent).addComponent(Label); label.string = text; return label; },
        place(n, x, y, w, h) { n.setPosition(x, y, 0); n.getComponent(UITransform).setContentSize(w, h); },
    },
};
const source = fs.readFileSync(path.resolve(__dirname, '../../assets/scripts/map/ui/RightInfoNodeLogic.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', code)(name => name === 'cc' ? cc : modules[name] || {}, mod, mod.exports);
function fixture() {
    const parent = node('HUD'); parent.getComponent(UITransform).setContentSize(1280, 720);
    const root = node('RightInfoNode', parent), group = node('Tabs', root); group.addComponent(ToggleContainer);
    const logic = root.addComponent(mod.exports.default);
    logic.toggles = ['army', 'city', 'tags'].map(name => {
        const toggle = node(name, group).addComponent(Toggle);
        // 模拟父级 ToggleContainer 完成初始选中前，动态添加第四页。
        toggle._isChecked = false; return toggle;
    });
    for (const key of ['armyScrollView', 'cityScrollView', 'tagsScrollView']) logic[key] = node(key, root).addComponent(ScrollView);
    logic.initArmys = () => {}; logic.initCitys = () => {}; logic.initTags = () => {};
    logic.onLoad(); return logic;
}
function assertPage(logic, selected) {
    const pages = [logic.armyScrollView, logic.cityScrollView, logic.tagsScrollView, logic._tileScroll];
    assert.deepEqual(pages.map(p => p.node.active), pages.map((_, i) => i === selected), '只能显示当前页');
    assert.deepEqual(logic.toggles.map(t => t.isChecked), pages.map((_, i) => i === selected), '选中态与内容一致');
    const empty = logic._tileScroll.node.getChildByName('view').getChildByName('NoSelection');
    assert.equal(empty.activeInHierarchy, selected === 3 && !logic._tilePanel, '地块空提示不能穿透到其他页');
    if (logic._tilePanel) assert.equal(logic._tilePanel.activeInHierarchy, selected === 3);
}

const initial = fixture(); assertPage(initial, 0);
initial.deferred.call(initial); assertPage(initial, 0);
console.log('PASS 动态地块页初始化、延迟排版：只显示队伍，不残留地块提示');

for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) {
    const logic = fixture(); logic.toggles[from].isChecked = true; assertPage(logic, from);
    logic.toggles[to].isChecked = true; assertPage(logic, to);
    for (const size of [[375, 812], [1280, 720], [1920, 1080]]) {
        logic.node.parent.getComponent(UITransform).setContentSize(...size);
        logic.node.parent.emit(Node.EventType.SIZE_CHANGED); assertPage(logic, to);
    }
}
console.log('PASS 四页两两切换及窗口缩放：内容互斥，空提示仅属于地块页');

for (const previous of [0, 1, 2]) {
    const logic = fixture(); logic.toggles[previous].isChecked = true;
    const detail = node('TileDetail');
    logic.showTilePanel(detail, 400, true); assertPage(logic, 3);
    logic.releaseTilePanel(detail); assertPage(logic, previous);
    logic.showTilePanel(detail, 400, false); assertPage(logic, previous);
    logic.showTilePanel(detail, 280, false); assertPage(logic, previous);
    logic.toggles[3].isChecked = true; assertPage(logic, 3);
    logic.toggles[0].isChecked = true; assertPage(logic, 0);
    logic.releaseTilePanel(detail); assertPage(logic, 0);
}
console.log('PASS 地块详情打开、后台更新、关闭还原：不覆盖当前页');

const pending = fixture();
pending.toggles[0]._isChecked = true; pending.toggles[3]._isChecked = true;
pending.onClockToggle(pending.toggles[3]); assertPage(pending, 3);
pending.toggles[0]._isChecked = true;
pending.onClockToggle(pending.toggles[0]); assertPage(pending, 0);
pending.onClockToggle(pending.toggles[3]); assertPage(pending, 0);
console.log('PASS 过渡状态与取消选中通知：统一当前页，不出现双层内容');
