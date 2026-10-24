// 离线执行选地、确认框和任务 HUD 挂接；不启动 Preview、不模拟玩家输入。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
class Component { isValid = true; }
class UITransform { width = 1280; height = 720; setContentSize(w, h) { this.width = w; this.height = h; } }
class Node {
    constructor(name) { this.name = name; this.children = []; this.parts = new Map(); this.isValid = true; }
    addChild(n) { this.children.push(n); n.parent = this; }
    addComponent(T) { const c = new T(); c.node = this; this.parts.set(T, c); return c; }
    getComponent(T) { return this.parts.get(T) || null; }
    getChildByName(name) { return this.children.find(c => c.name === name) || null; }
    getChildByPath(p) { return p.split('/').reduce((n, name) => n?.getChildByName(name), this); }
    setSiblingIndex(i) { this.siblingIndex = i; }
    setPosition(x, y) { this.position = { x, y }; }
}
class TaskTracker extends Component { initialize(cb) { this.open = cb; } layout(w, h) { this.size = [w, h]; } }
class Services extends Component { show(section) { this.section = section; } }
class MapResData {}
class MapBuildData {}
class MapCityData {}
const E = { confirmMoveCity: 'confirmMoveCity', showToast: 'showToast' };
const notices = [], sent = [], handlers = new Map();
const EventMgr = { emit(name, ...data) { notices.push([name, ...data]); handlers.get(name)?.(...data); } };
let issue = '', empty = true, occupied = false, blocked = '';
const login = { movingCity: false, cityMoveIssue: () => issue || (login.movingCity ? '正在迁城' : ''),
    moveCity(pos) { if (this.movingCity) return false; sent.push({ ...pos }); this.movingCity = true; return true; } };
const map = { proxy: { getResData: () => ({ isEmpty: empty }) }, cityProxy: { getCity: () => occupied ? {} : null },
    buildProxy: { getBuild: () => null }, campaignBlockReason: () => blocked };
const uiState = { text: { string: '' }, show(text, type) { this.text.string = text; this.type = type; },
    setClose(fn) { this.close = fn; }, setConfirmCB(fn) { this.confirm = fn; }, setCancelCB(fn) { this.cancel = fn; } };
const cc = { Component, Node, UITransform, _decorator: { ccclass: () => v => v, property: () => () => {} } };
function load(relative, extra = {}) {
    const file = path.join(root, relative), mod = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
        if (name === 'cc') return cc;
        if (extra[name]) return extra[name];
        if (name.endsWith('/LoginCommand')) return { default: { getInstance: () => login } };
        if (name.endsWith('/MapCommand')) return { default: { getInstance: () => map } };
        if (name.endsWith('/MapUtil')) return { default: { getIdByCellPoint: (x, y) => y * 1000 + x } };
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/LogicEvent')) return { LogicEvent: E };
        if (name.endsWith('/AudioManager')) return { AudioManager: { instance: { playClick() {} } } };
        // 其余弹窗类只在被测类的未调用方法里使用。
        return { default: class {} };
    }, mod, mod.exports);
    return mod.exports.default;
}
const HUD = load('assets/scripts/map/ui/MapUILogic.ts', {
    './Dialog': { default: class {}, DialogType: { Default: 0, OnlyConfirm: 2 } },
    './MapTaskTracker': { default: TaskTracker }, './PlayerServicesPanel': { default: Services },
    './HudMenuSkin': { styleWarReportShortcut() {} },
});
const Click = load('assets/scripts/map/MapClickUILogic.ts', {
    './MapProxy': { MapResData }, './MapBuildProxy': { MapBuildData }, './MapCityProxy': { MapCityData },
});
const hud = new HUD(); hud._uiListenersReady = true;
hud.node = new Node('MapUI'); hud.node.addComponent(UITransform);
const hudRoot = new Node('HudRoot'); hud.node.addChild(hudRoot); hud.contentNode = new Node('Content');
hud._dialogNode = { active: true, setSiblingIndex() {}, getComponent: () => uiState };
handlers.set(E.confirmMoveCity, pos => hud.showMoveCityConfirm(pos));
const tile = new Click(); tile.node = { parent: {} };
tile._data = Object.assign(new MapResData(), { x: 30, y: 40, isEmpty: true });
tile.onClickRelocate();
assert.equal(sent.length, 0, '打开确认框不能提前发请求');
assert.ok(uiState.text.string.includes('30，40')); assert.ok(uiState.text.string.includes('迁城令'));
assert.equal(uiState.type, 0, '必须提供取消按钮'); assert.equal(uiState.close, null); assert.equal(uiState.cancel, null);
uiState.cancel?.(); assert.equal(sent.length, 0);
tile._data.x = 99; uiState.confirm(); uiState.confirm();
assert.deepEqual(sent, [{ x: 30, y: 40 }], '确认使用已展示的目标，重复确认被请求锁挡住');
login.movingCity = false;
for (const state of ['occupied', 'resource', 'route', 'token']) {
    occupied = state === 'occupied'; empty = state !== 'resource'; blocked = state === 'route' ? '请先打通关隘' : ''; issue = state === 'token' ? '迁城令不足' : '';
    const before = notices.length; hud.showMoveCityConfirm({ x: 30, y: 40 });
    assert.equal(notices.at(-1)[0], E.showToast); assert.ok(notices.length > before); assert.equal(sent.length, 1);
}
occupied = false; empty = true; blocked = ''; issue = '';
hud.showMoveCityConfirm({ x: 80, y: 90 }); occupied = true; uiState.confirm();
assert.equal(sent.length, 1, '确认前重新检查占用变化'); occupied = false;
hud.showTip('普通提示', null); assert.equal(uiState.confirm, null, '普通提示不能留下迁城回调');
console.log('PASS 迁城选地、消耗提示、取消、防重复确认、目标冻结、确认前重查和弹窗回调清理');
tile._btnRelocate = { node: {}, interactable: true }; let layouts = 0; tile.layoutPanel = () => layouts++;
tile.updateRelocateButton(); assert.equal(tile._btnRelocate.node.active, true);
login.movingCity = true; tile.updateRelocateButton(); assert.equal(tile._btnRelocate.interactable, false);
tile._data = new MapCityData(); tile.updateRelocateButton(); assert.equal(tile._btnRelocate.node.active, false);
tile._data = Object.assign(new MapResData(), { isEmpty: false }); tile.updateRelocateButton();
assert.equal(tile._btnRelocate.node.active, false); assert.equal(layouts, 4); login.movingCity = false;
console.log('PASS 空地迁城入口、等待期间禁用和城池/资源地不显示迁城按钮');
hud.initTaskTracker(); hud.initTaskTracker(); assert.equal(hudRoot.children.length, 1);
assert.equal(hud._taskTracker.node.siblingIndex, 0);
hud.drawHudTopShade = () => {}; hud.layoutHud(); assert.deepEqual(hud._taskTracker.size, [1280, 720]);
hud._taskTracker.open(); assert.equal(hud._servicesPanel.section, 'tasks');
console.log('PASS 地图 HUD 实际挂接左侧任务卡、尺寸更新与全部任务入口');
