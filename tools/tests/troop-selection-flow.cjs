// 读取真实预制体引用并离线执行显示逻辑；不启动 Creator Preview。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
class Component {
    enabled = true; isValid = true; schedule() {} scheduleOnce(fn) { fn(); } unscheduleAllCallbacks() {}
    getComponent(Type) { return this.node.getComponent(Type); }
    getComponentInChildren(Type) { return this.node.getComponentInChildren(Type); }
}
class UITransform { width = 0; height = 0; anchorX = .5; anchorY = .5;
    setContentSize(w, h) { this.width = w; this.height = h; }
    setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; }
}
class Node {
    constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.isValid = true; this.position = { x: 0, y: 0 }; }
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
    destroy() { this.isValid = false; }
    removeFromParent() { this.parent = null; }
    removeAllChildren() { for (const child of [...this.children]) child.parent = null; }
}
class Label extends Component { static Overflow = { CLAMP: 1, SHRINK: 2 }; static HorizontalAlign = { LEFT: 0, CENTER: 1, RIGHT: 2 }; static VerticalAlign = { CENTER: 1 }; string = ''; }
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
    sys: { getSafeAreaRect: () => ({ x: 0, y: 0, ...visible }) },
    view: { getVisibleSize: () => visible, on() {}, off() {} },
    _decorator: { ccclass: () => v => v, property: () => () => {} } };
let moveIssue = '';
const map = { proxy: { getWarFree: () => 0, isPosTag: () => false, getResData: () => null,
    getResConfig: () => null, getResYieldDesList: () => [] }, cityProxy: { myId: 1 }, moveTargetIssue: () => moveIssue };
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
    'login/LoginCommand': { default: { getInstance: () => ({ movingCity: false, proxy: { getRoleData: () => ({ userId: 1 }) } }) } },
    'core/ConfigManager': { default: {} }, 'general/ArmyCommand': {}, 'general/GeneralCommand': {},
    'general/TroopCommand': {}, 'world/WorldCommand': { MarchTargetType: { OccupyResource: 3 }, default: { getInstance: () => ({
        resourceLandAt: () => undefined, resourceLandEntityId: (x, y) => 4000000000000000 + y * 1000 + x,
        emptyLandIssue: () => '', resourceLandIssue: () => '', marches: { values: () => [] } }) } },
    'map/ui/GeneralHeadLogic': { default: class {} },
    'map/ui/MapUICommand': { default: { getInstance: () => ({ proxy: { getDefenseSoldiers: () => 0 } }) } },
    'common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
    'world/CityCommand': { default: { getInstance: () => ({ loaded: true, loading: false, at: () => null }) } },
    'network/pto/ProtocolCommand': { idKey: id => String(id ?? 0), hasId: id => !!id },
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
let troops = [], pending = false, home = true, requests = 0;
const orders = [];
const troopCommand = {
    listReady: true, listLoading: false, editingTroopIdx: 0,
    proxy: { getTroops: () => troops, getTroop: id => troops.find(t => t.troopIdx === id) || null },
    requestTroops(force) { requests++; this.lastForce = force; },
};
let city = { cityId: 1 };
map.cityProxy.getMyMainCity = () => city;
map.cityProxy.getCity = () => null;
map.proxy.getResData = () => ({ type: 55, level: 3 });
map.campaignBlockReason = () => '';
util.getIdByCellPoint = (x, y) => y * 1000 + x;
const world = {
    sessionReady: true, marches: new Map(), isTroopAtHome: () => home,
    resourceLandAt: () => null, resourceLandEntityId: () => 123,
    resourceLandIssue: () => '', emptyLandIssue: () => '',
    requestInFlight: () => pending,
    occupyResourceLand(id, x, y) { if (pending) return false; pending = true; orders.push({id,x,y}); return true; },
    moveTroop(id, pos) { if (pending) return false; pending = true; orders.push({id,...pos}); return true; },
    marchRoute: null,
    clearMarchRoute() { this.marchRoute = null; },
    previewMarchRoute(troopIdx,targetType,targetPos) {
        this.marchRoute = {troopIdx,targetType,targetPos,status:'ready',costTime:15.1,path:[{x:0,y:0},targetPos]};
        return true;
    },
};
class Head extends Component { setHeadId(id) { this.heroId = id; } }
stubs['general/TroopCommand'] = { default: { getInstance: () => troopCommand } };
stubs['world/WorldCommand'] = { MarchTargetType: {Move:4,AttackCity:5,OccupyResource:3}, default: { getInstance: () => world } };
stubs['general/GeneralCommand'] = { default: { getInstance: () => ({ proxy: {
    getMyGeneral: id => id ? {cfgId: id, level: 10} : null,
    getGeneralCfg: id => ({name: '武将' + id}),
} }) } };
stubs['map/ui/GeneralHeadLogic'] = { default: Head };
stubs['map/ui/RightInfoNodeLogic'] = { default: class extends Component {} };
stubs['map/ui/TroopPanelSkin'] = { styleTroopPanel() {}, updateTroopPanelStatus() {} };
stubs['map/ui/TroopDragInteraction'] = { default: class {} };
stubs['general/GeneralProxy'] = { GeneralCampType: {} };
stubs['map/ui/MapUIProxy'] = { CityAdditionType: {} };
stubs['map/ui/CityGeneralItemLogic'] = { default: class extends Component {} };
const Selector = load('map/ui/ArmySelectNodeLogic').default;
const Item = load('map/ui/ArmySelectItemLogic').default;
const Formation = load('map/ui/CityArmySettingLogic').default;
const events = load('utils/EventMgr').EventMgr, logic = load('common/LogicEvent').LogicEvent;
cc.instantiate = () => {
    const row = prefab('ArmySelectItem.prefab', Item, 'headIcon');
    row.node.components.set(Item, row);
    row.headIcon.node.addComponent(Head);
    return row.node;
};
function setup(list = []) {
    troops = list; pending = false; home = true; orders.length = 0; requests = 0;
    troopCommand.listReady = true; troopCommand.listLoading = false; troopCommand.editingTroopIdx = 0;
    const selector = prefab('ArmySelectNode.prefab', Selector, 'armyContainer');
    selector.onLoad(); selector.setData(1, 373, 146);
    return selector;
}
function troop(id, count = 100, leader = id) {
    return { troopIdx: id, getHeroIdxAt: pos => pos === 0 ? leader : 0,
        getSortedHeroes: () => leader ? [{heroIdx: leader}] : [],
        getSoldier: () => ({count, hurtCount: 0}) };
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }

test('空状态给出编队入口，返回保留同一个地块', () => {
    const s = setup();
    assert.equal(s.state, 'empty'); assert.equal(s.primaryAction, 'formation');
    assert.ok(s.targetLabel.string.includes('3级粮田'));
    assert.equal(s.panel.getChildByName('Hint'), null);
    let returnAction;
    const owner = {};
    events.on(logic.openArmySetting, (cityId, idx, cb) => {
        assert.equal(cityId, 1); assert.equal(idx, 1); returnAction = cb;
    }, owner);
    s.onPrimary();
    assert.equal(s.node.active, false);
    troops = [troop(1)];
    returnAction();
    assert.equal(s.node.active, true);
    assert.equal(s.resourceTarget.x, 373); assert.equal(s.resourceTarget.y, 146);
    assert.equal(s.state, 'list'); assert.equal(s.primaryAction, 'dispatch');
    events.targetOff(owner); s.onDestroy();
});

test('明确关闭后，旧编队回调不能把选队窗口重新弹出', () => {
    const s = setup(); let cb; const owner = {};
    events.on(logic.openArmySetting, (_, __, callback) => cb = callback, owner);
    s.onPrimary(); s.close(); cb();
    assert.equal(s.node.active, false);
    events.targetOff(owner); s.onDestroy();
});

test('卡片只选择，确认才下令；重复确认不会重复行军', () => {
    const s = setup([troop(1), troop(2)]);
    const row = s.armyContainer.getChildByName('Troop2').getComponent(Item);
    assert.equal(s.armyContainer.getChildByName('Troop1').position.y, -48);
    assert.equal(row.node.position.y, -152);
    row.onClickItem();
    assert.equal(s.selectedTroopIdx, 2); assert.equal(orders.length, 0);
    assert.equal(row.node.position.y, -152, '选中后第二张卡片仍留在原行');
    s.refreshTroops();
    assert.equal(row.node.position.y, -152, '同步刷新不叠卡');
    assert.equal(row.labelState.string, '00:16', '选中行显示服务端预计耗时并向上取整');
    s.onPrimary();
    assert.equal(orders.length, 1); assert.deepEqual(orders[0], {id: 2, x: 373, y: 146});
    assert.equal(s.node.active, false);
    row.dispatchOrder(); assert.equal(orders.length, 1);
    s.onDestroy();
});

test('编队窗口主动关闭只返回一次，普通打开和被动隐藏不唤回旧目标', () => {
    const f = new Formation();
    f.node = new Node('Formation');
    let returns = 0;
    f.setReturnToSelection(() => { assert.equal(f.node.active, false); returns++; });
    f.onClickClose(); f.onClickClose();
    assert.equal(returns, 1);
    f.node.active = true;
    f.setReturnToSelection(() => returns++);
    f.setReturnToSelection(); f.onClickClose();
    assert.equal(returns, 1);
    f.node.active = true;
    f.setReturnToSelection(() => returns++);
    f.onDisable(); f.onClickClose();
    assert.equal(returns, 1);
});

test('同步中不误报空队，同步失败可以直接重试', () => {
    const s = setup();
    troopCommand.listReady = false; troopCommand.listLoading = true; s.refreshTroops();
    assert.equal(s.state, 'loading'); assert.equal(s.primaryAction, 'none');
    assert.equal(s.statusTitle.node.active, false);
    troopCommand.listLoading = false; s.refreshTroops(); s.onPrimary();
    assert.equal(s.state, 'error'); assert.equal(troopCommand.lastForce, true);
    assert.equal(s.node.active, true);
    s.onDestroy();
});

test('没有主将或兵力引导整备，出城部队不能误入配兵', () => {
    const s = setup([troop(1, 0)]);
    assert.equal(s.primaryAction, 'formation');
    home = false; s.refreshTroops();
    assert.equal(s.primaryAction, 'none'); assert.equal(orders.length, 0);
    troopCommand.editingTroopIdx = 1; home = true; s.refreshTroops();
    assert.equal(s.primaryAction, 'none');
    s.onDestroy();
});

test('横竖屏的空状态、选队列表和按钮都在面板范围内', () => {
    for (const [width, height] of [[1280,720], [640,360], [375,812], [320,568]]) {
        visible = {width, height};
        for (const list of [[], [troop(1),troop(2),troop(3)]]) {
            const s = setup(list), p = s.panel.getComponent(UITransform);
            assert.ok(p.width <= width-24 && p.height <= height-24);
            for (const n of [s.primaryButton, s.secondaryButton, s.panel.getChildByName('btnClose')]) {
                const u = n.getComponent(UITransform);
                assert.ok(Math.abs(n.position.x) + u.width/2 <= p.width/2);
                assert.ok(Math.abs(n.position.y) + u.height/2 <= p.height/2);
                assert.ok(u.height >= 40);
            }
            assert.ok(s.viewHeight > 0);
            s.onDestroy();
        }
    }
});
test('路线未就绪禁止出征，失败能重试，关闭清除预览', () => {
    const s=setup([troop(1)]), row=s.selectedItem();
    for(const state of ['loading','unreachable','error']) {
        world.marchRoute.status=state; s.onRouteChanged();
        assert.equal(s.primaryAction,state==='error'?'routeRetry':'none');
        if(state!=='error') { s.onPrimary(); assert.equal(orders.length,0); }
    }
    s.onPrimary(); s.onRouteChanged();
    assert.equal(s.primaryAction,'dispatch'); assert.equal(row.labelState.string,'00:16');
    s.onDisable(); assert.equal(world.marchRoute,null);
    s.onDestroy();
});
console.log('Troop selection: ' + passed + ' checks passed.');
