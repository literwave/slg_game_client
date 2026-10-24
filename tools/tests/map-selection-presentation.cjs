// 读取真实预制体引用并离线执行显示逻辑；不启动 Creator Preview。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
class Component {
    enabled = true; schedule() {} unscheduleAllCallbacks() {}
    getComponent(Type) { return this.node.getComponent(Type); }
    getComponentInChildren(Type) { return this.node.getComponentInChildren(Type); }
}
class UITransform { width = 0; height = 0; anchorX = .5; anchorY = .5;
    setContentSize(w, h) { this.width = w; this.height = h; }
    setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; }
}
class Node {
    constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.position = { x: 0, y: 0 }; }
    get parent() { return this._parent; }
    set parent(p) { if (this._parent) this._parent.children.splice(this._parent.children.indexOf(this), 1); this._parent = p; if (p) p.children.push(this); }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    addChild(n) { n.parent = this; }
    getChildByName(name) { return this.children.find(n => n.name === name) || null; }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    getComponentsInChildren(Type) { return [...this.components.values()].filter(c => c instanceof Type).concat(this.children.flatMap(n => n.getComponentsInChildren(Type))); }
    getComponentInChildren(Type) { return this.getComponentsInChildren(Type)[0] || null; }
    setPosition(x, y) { this.position = { x, y }; }
    setScale() {}
    setSiblingIndex(i) { const a = this.parent.children; a.splice(a.indexOf(this), 1); a.splice(i, 0, this); }
    on() {}
    destroy() {}
    removeAllChildren() { for (const child of [...this.children]) child.parent = null; }
}
class Label extends Component { static Overflow = { CLAMP: 1 }; static HorizontalAlign = { LEFT: 0, CENTER: 1, RIGHT: 2 }; static VerticalAlign = { CENTER: 1 }; string = ''; }
class Sprite extends Component { static SizeMode = { CUSTOM: 1 }; }
class Button extends Component { static Transition = { SCALE: 1 }; static EventType = { CLICK: 'click' }; }
class Color { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
class Graphics extends Component { points = []; clear() { this.points = []; } moveTo(x, y) { this.points.push([x, y]); } lineTo(x, y) { this.points.push([x, y]); } close() {} fill() {} stroke() {} roundRect() {} }
class ScrollView extends Component { stopAutoScroll() {} scrollToOffset(p) { this.offset = p; } getScrollOffset() { return this.offset || { x: 0, y: 0 }; } }
class Mask extends Component { static Type = { GRAPHICS_RECT: 0 }; }
class Widget extends Component {}
class Layout extends Component {}
class ProgressBar extends Component {}
let visible = { width: 1280, height: 720 };
const cc = { Component, Node, UITransform, Label, Sprite, Button, Color, Graphics, ScrollView, Mask, Widget, Layout, ProgressBar,
    BlockInputEvents: class {}, UIOpacity: class {},
    Vec2: class { constructor(x, y) { this.x = x; this.y = y; } },
    view: { getVisibleSize: () => visible, on() {}, off() {} },
    _decorator: { ccclass: () => v => v, property: () => () => {} } };
const map = { proxy: { getWarFree: () => 0, isPosTag: () => false }, cityProxy: { myId: 1 } };
const util = { tileSize: { width: 200, height: 100 } };
const art = { apply(sprite, name, width) { sprite.art = name; sprite.node.getComponent(UITransform).setContentSize(width, width * .6); },
    ownership(node, a, b, c, width) { node.ownershipWidth = width; }, factionColor: () => null,
    frame: () => ({ originalSize: { width: 640, height: 400 } }) };
const stubs = {
    'map/WorldMapArt': { default: art }, 'map/MapUtil': { default: util }, 'map/MapCommand': { default: { getInstance: () => map } },
    'map/WorldCampaign': { default: { config: null, landmark: () => '', gateAt: () => null } },
    'utils/DateUtil': { default: { getServerTime: () => 0 } }, 'common/BgLogic': { default: class {} },
    'map/MapProxy': { MapResData: class {}, MapResType: { SYS_CITY: 51, SYS_FORTRESS: 50 } },
    'map/MapBuildProxy': { MapBuildData: class {} }, 'general/ArmyProxy': { ArmyCmd: { Attack: 1 } },
    'login/LoginCommand': { default: { getInstance: () => ({ movingCity: false }) } },
    'core/ConfigManager': { default: {} }, 'general/ArmyCommand': {}, 'general/GeneralCommand': {},
    'general/TroopCommand': {}, 'world/WorldCommand': {}, 'map/ui/GeneralHeadLogic': { default: class {} },
    'map/ui/MapUICommand': {}, 'common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
};
const cache = new Map();
function load(key) {
    if (stubs[key]) return stubs[key];
    if (cache.has(key)) return cache.get(key).exports;
    const file = path.join(scripts, key + '.ts'), mod = { exports: {} }; cache.set(key, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    new Function('require', 'module', 'exports', code)(id => id === 'cc' ? cc : load(path.relative(scripts,
        path.resolve(path.dirname(file), id)).replace(/\\/g, '/')), mod, mod.exports);
    return mod.exports;
}
function prefab(file, Logic, identity) {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/prefab', file), 'utf8'));
    const objects = data.map(o => o.__type__ === 'cc.Node' ? new Node(o._name) : null);
    data.forEach((o, i) => {
        if (o.__type__ === 'cc.Node') {
            if (o._parent) objects[i].parent = objects[o._parent.__id__];
            objects[i].active = o._active !== false;
        } else if (o.node && cc[o.__type__?.slice(3)]) {
            const c = objects[o.node.__id__].addComponent(cc[o.__type__.slice(3)]); objects[i] = c;
            if (o._contentSize) c.setContentSize(o._contentSize.width, o._contentSize.height);
            if (o._anchorPoint) c.setAnchorPoint(o._anchorPoint.x, o._anchorPoint.y);
            if (o._string) c.string = o._string;
        }
    });
    const record = data.find(o => identity in o); assert.ok(record, file + '脚本引用存在');
    const logic = new Logic(); logic.node = objects[record.node.__id__];
    for (const [key, value] of Object.entries(record)) if (value?.__id__ != null && key !== 'node') logic[key] = objects[value.__id__];
    return logic;
}
const E = load('common/LogicEvent').LogicEvent, events = load('utils/EventMgr').EventMgr;
const City = load('map/entries/CityLogic').default, CityData = load('map/MapCityProxy').MapCityData;
const city = prefab('map/RoleCity.prefab', City, 'upSpr'); city.onLoad(); city.onEnable();
const data = Object.assign(new CityData(), { id: 20010, rid: 1, fromWorld: true, name: '玩家主城', x: 10, y: 20 });
for (let level = 0; level <= 30; level++) {
    data.level = level; city.setCityData(data); events.emit(E.selectPlayerCity, data.id);
    const selection = city.node.getChildByName('CitySelection'), sprite = city.node.getChildByName('sprite');
    assert.equal(city.node.ownershipWidth, 600); assert.equal(data.getCellRadius(), 1);
    assert.deepEqual(selection.getComponent(Graphics).points, [[0, 150], [300, 0], [0, -150], [-300, 0]]);
    assert.ok(city.node.children.indexOf(selection) < city.node.children.indexOf(sprite), '选框必须画在立绘下方');
    assert.equal(sprite.getComponent(Sprite).trim, false); assert.equal(sprite.getComponent(UITransform).anchorY, .3);
    assert.ok(city.labelName.node.position.y < -150, '城名不能覆盖建筑');
}
const Popup = load('map/MapClickUILogic').default, popup = prefab('map/MapClickUI.prefab', Popup, 'bgSelect');
popup.onLoad(); popup.setCellData(data, { x: 0, y: 0 });
assert.equal(popup.bgSelect.active, false, '顶层弹窗不得再在建筑上绘制城市选框');
assert.equal(popup.durableNode.active, false, 'World 未给耐久时不显示 0/0');
assert.equal(popup.progressBarDurable.progress, 0); assert.equal(popup.btnEnter.node.active, true);
assert.equal(popup.btnOccupy.node.active, false); popup.onDisable();
assert.equal(city.node.getChildByName('CitySelection').active, false, '关闭信息框清除选中态');
events.emit(E.selectPlayerCity, data.id); city.onDisable(); city.onEnable(); city.setCityData({ ...data, id: 30020 });
assert.equal(city.node.getChildByName('CitySelection').active, false, '对象池复用不能带旧选框');
console.log('PASS 主城真实预制体：0～30 级统一占地、地表选框、城名、未知耐久、关闭与复用');

const Selector = load('map/ui/ArmySelectNodeLogic').default, Item = load('map/ui/ArmySelectItemLogic').default;
const selector = prefab('ArmySelectNode.prefab', Selector, 'armyContainer'); selector.onLoad();
for (const [width, height] of [[1280, 720], [640, 360], [375, 812]]) {
    visible = { width, height }; selector.layoutPanel();
    const panel = selector.panel.getComponent(UITransform);
    assert.ok(panel.width <= width - 24 && panel.height <= height - 24);
    const close = selector.panel.getChildByName('btnClose');
    assert.ok(close.position.x + 20 <= panel.width / 2 && close.position.y + 20 <= panel.height / 2);
    assert.equal(selector.viewport.getComponent(Mask).type, Mask.Type.GRAPHICS_RECT);
    assert.equal(selector.armyContainer.parent, selector.viewport);
    assert.equal(selector.armyContainer.getComponent(Layout).enabled, false);
    selector.sizeContent(3, 10000);
    assert.ok(selector.scroll.offset.y <= selector.armyContainer.getComponent(UITransform).height - selector.viewHeight);
    const row = prefab('ArmySelectItem.prefab', Item, 'headIcon'); row.tipNode.active = true;
    row.layoutRow(selector.rowWidth, 140);
    const rootUI = row.node.getComponent(UITransform);
    assert.equal(rootUI.width, selector.rowWidth);
    for (const child of row.node.getChildByName('bg').children.filter(n => n.active)) {
        const ui = child.getComponent(UITransform);
        if (ui) assert.ok(Math.abs(child.position.x) + ui.width / 2 <= rootUI.width / 2 + 1, child.name + '超出卡片');
    }
    assert.equal(row.tipNode.getChildByName('bgUnable').active, false);
    assert.equal(row.labelState.node.active, false);
}
console.log('PASS 选队真实预制体：横竖屏面板、关闭按钮、滚动裁切、卡片信息与禁用提示');
