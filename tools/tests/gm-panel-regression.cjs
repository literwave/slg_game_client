// Headless regression checks. No Preview input or real server commands are sent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
process.on('uncaughtException', error => { console.error(error); process.exit(1); });
const properties = new Set();
class Events {
    listeners = new Map();
    on(name, handler, target) {
        const listeners = this.listeners.get(name) || [];
        listeners.push({ handler, target });
        this.listeners.set(name, listeners);
    }
    off(name, handler, target) {
        this.listeners.set(name, (this.listeners.get(name) || [])
            .filter(item => item.handler !== handler || item.target !== target));
    }
    emit(name, ...args) {
        for (const item of [...(this.listeners.get(name) || [])]) item.handler.apply(item.target, args);
    }
    count(name) { return (this.listeners.get(name) || []).length; }
    addEventListener(name, handler, capture) { this.on(name, handler, capture); }
    removeEventListener(name, handler, capture) { this.off(name, handler, capture); }
}
class Node extends Events {
    static EventType = { SIZE_CHANGED: 'size-changed' };
    active = true;
    isValid = true;
    children = [];
    setSiblingIndex(index) { this.siblingIndex = index; }
}
class Component {
    node = new Node();
    isValid = true;
    enabledInHierarchy = true;
    callbacks = new Set();
    scheduleOnce(fn) { this.callbacks.add(fn); }
    unschedule(fn) { this.callbacks.delete(fn); }
    flush() {
        const callbacks = [...this.callbacks];
        this.callbacks.clear();
        callbacks.forEach(fn => fn.call(this));
    }
}
class EditBox {
    static EventType = { EDITING_RETURN: 'editing-return' };
    node = new Node();
    string = '';
    focused = false;
    focus() { this.focused = true; }
    blur() { this.focused = false; }
    isFocused() { return this.focused; }
}
const input = new Events(), game = new Events(), document = new Events(), window = new Events();
const KeyCode = { NONE: 0, CTRL_LEFT: 17, CTRL_RIGHT: 2001, KEY_B: 66, ESCAPE: 27, ARROW_UP: 38, ARROW_DOWN: 40 };
const cc = {
    Component, Node, EditBox, input, game, KeyCode,
    Color: class {},
    Game: { EVENT_HIDE: 'hide' }, Input: { EventType: { KEY_DOWN: 'down', KEY_UP: 'up' } },
    Button: { EventType: { CLICK: 'click' } },
    _decorator: { ccclass: () => type => type, property: () => (target, name) => { properties.add(name); } },
};
function load(file, imports = {}, browser = true) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } });
    assert.equal(result.diagnostics.length, 0);
    const module = { exports: {} };
    const requireMock = name => {
        if (name === 'cc') return cc;
        if (Object.hasOwn(imports, name)) return imports[name];
        throw new Error(`Unmocked import: ${name}`);
    };
    new Function('require', 'module', 'exports', 'document', 'window', result.outputText)(
        requireMock, module, module.exports, browser ? document : undefined, browser ? window : undefined);
    return module.exports;
}
const { EventMgr } = load('assets/scripts/utils/EventMgr.ts');
const { LogicEvent } = load('assets/scripts/common/LogicEvent.ts');
const { CoreEvent } = load('assets/scripts/core/CoreEvent.ts');
const { ServerConfig } = load('assets/scripts/config/ServerConfig.ts');
let center = { x: 16, y: 24 }, encodingFails = false, mainCity = null;
const sent = [], encoded = [], scrolls = [], toasts = [];
const MapUtil = { mapSize: { width: 200, height: 100 } };
const imports = {
    '../../utils/EventMgr': { EventMgr }, '../../common/LogicEvent': { LogicEvent },
    '../../core/CoreEvent': { CoreEvent }, '../../config/ServerConfig': { ServerConfig },
    '../../common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
    '../../utils/Tools': { Tools: {} },
    '../MapCommand': { default: { getInstance: () => ({
        proxy: { getCurCenterPoint: () => center }, cityProxy: { myUnionId: 0, getMyMainCity: () => mainCity },
    }) } },
    '../MapUtil': { default: MapUtil },
    './MapUICommand': { default: { getInstance: () => ({ proxy: { clearData() {} } }) } },
    '../../general/TroopCommand': { default: { getInstance: () => ({ requestTroops() {} }) } },
    './HudMenuSkin': { styleMoreMenu() {} },
    '../../network/pto/ProtoManager': { ProtoManager: { getInstance: () => ({ encode(name, payload) {
        encoded.push({ name, payload });
        return encodingFails ? null : Uint8Array.from([1, 2, 3]);
    } }) } },
    '../../network/socket/NetManager': { NetManager: { getInstance: () => ({ send: packet => sent.push(packet) }) } },
};
// UI classes unrelated to GM are imported, but never instantiated in these tests.
for (const name of ['../../login/LoginCommand', './ArmySelectNodeLogic', './CityArmySettingLogic',
    './FacilityListLogic', './Dialog', '../../union/UnionCommand', './CityAboutLogic', './GeneralListLogic',
    './TransformLogic', './GeneralInfoLogic', './WarReportLogic', './DrawRLogic', './SkillLogic',
    './SkillInfoLogic', './HeadIconPanel', './Setting', './MapTaskTracker', './PlayerServicesPanel', '../../systemopen/SystemOpenCommand']) {
    imports[name] = { default: class {} };
}
const file = 'assets/scripts/map/ui/MapUILogic.ts';
const MapUI = load(file, imports).default;
const observer = {};
EventMgr.on(LogicEvent.scrollToMap, (x, y) => scrolls.push([x, y]), observer);
EventMgr.on(LogicEvent.showToast, text => toasts.push(text), observer);
function create(Type = MapUI) {
    const ui = new Type();
    ui.gmPanel = new Node();
    ui.gmPanel.active = false;
    ui.gmPanel.parent = { children: [ui.gmPanel] };
    ui.gmCommandBox = new EditBox();
    ui.gmEditBoxX = new EditBox();
    ui.gmEditBoxY = new EditBox();
    ui.gmCoordLabel = { string: '' };
    ui.gmTipLabel = { string: '' };
    for (const method of ['initHudNavigation', 'initTaskTracker', 'initMoreMenu', 'initHeadIconEntry', 'layoutHud', 'updateRoleRes', 'updateRole']) ui[method] = () => {};
    ui.onLoad();
    ui.onEnable();
    return ui;
}
function ready(ui) { EventMgr.emit(CoreEvent.gameReady); ui.flush(); }
function down(keyCode) { input.emit('down', { keyCode }); }
function up(keyCode) { input.emit('up', { keyCode }); }
function domKey(key, options = {}) {
    const event = { key, code: key.toLowerCase() === 'b' ? 'KeyB' : key, ctrlKey: false,
        repeat: false, isComposing: false, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...options };
    document.emit('keydown', event);
    return event;
}
let passed = 0;
function test(name, run) { run(); console.log(`PASS ${name}`); passed++; }

try {
    test('内城图标使用 UI 目录下的真实 SpriteFrame 资源', () => {
        const prefab = JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes/MapUIScene.prefab'), 'utf8'));
        const component = prefab.find(item => item.gmPanel);
        const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/ui/hud/hud-inner-city.png.meta'), 'utf8'));
        const frame = Object.values(meta.subMetas).find(item => item.importer === 'sprite-frame');
        assert.ok(properties.has('innerCityIcon'));
        assert.equal(component.innerCityIcon.__uuid__, frame.uuid);
    });
    test('内城入口等待游戏和主城信息就绪，不打开空城市', () => {
        const ui = new MapUI();
        let opened = 0;
        ui.openFacility = () => opened++;
        ui.closeMoreMenu = () => {};
        mainCity = { cityId: 1, x: 12, y: 34 };
        ui.openInnerCity();
        ui._uiListenersReady = true;
        mainCity = null;
        ui.openInnerCity();
        assert.equal(opened, 0);
        assert.match(toasts.at(-1), /主城信息正在同步/);
    });
    test('内城入口收起更多并传入当前主城，直达 Build 建筑页', () => {
        const ui = new MapUI();
        const order = [];
        ui._uiListenersReady = true;
        mainCity = { cityId: 7, x: 12, y: 34 };
        ui.closeMoreMenu = () => order.push('close');
        ui.openFacility = city => { assert.equal(city, mainCity); order.push('open'); };
        ui.openInnerCity();
        assert.deepEqual(order, ['close', 'open']);
        mainCity = null;
    });
    test('existing prefab GM properties and button handlers resolve to the restored script', () => {
        const prefab = JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes/MapUIScene.prefab'), 'utf8'));
        const component = prefab.find(item => item.gmPanel);
        assert.ok(component);
        for (const name of ['gmPanel', 'gmCommandBox', 'gmEditBoxX', 'gmEditBoxY', 'gmCoordLabel', 'gmTipLabel']) {
            assert.ok(properties.has(name), `${name} must remain serialized`);
            const object = prefab[component[name].__id__];
            assert.ok(object && (object.__type__ === 'cc.Node' || object.node), `${name} binding is missing`);
        }
        const handlers = prefab.filter(item => /^onClickGM/.test(item.handler || '')).map(item => item.handler);
        assert.equal(handlers.length, 3);
        handlers.forEach(name => assert.equal(typeof MapUI.prototype[name], 'function', `missing ${name}`));
        assert.equal(prefab[component.gmPanel.__id__]._active, false);
    });

    const ui = create();
    test('input is registered once after game readiness, not while loading', () => {
        assert.equal(input.count('down'), 0);
        assert.equal(document.count('keydown'), 0);
        ready(ui);
        ready(ui);
        assert.equal(input.count('down'), 1);
        assert.equal(input.count('up'), 1);
        assert.equal(document.count('keydown'), 1);
    });
    test('engine Ctrl+B supports both controls, ignores bare B and repeated keydown', () => {
        down(KeyCode.KEY_B); up(KeyCode.KEY_B);
        assert.equal(ui.gmPanel.active, false);
        down(KeyCode.CTRL_LEFT); down(KeyCode.KEY_B);
        assert.equal(ui.gmPanel.active, true);
        down(KeyCode.KEY_B);
        assert.equal(ui.gmPanel.active, true);
        up(KeyCode.KEY_B); up(KeyCode.CTRL_LEFT);
        down(KeyCode.CTRL_RIGHT); down(KeyCode.KEY_B);
        assert.equal(ui.gmPanel.active, false);
        up(KeyCode.KEY_B); up(KeyCode.CTRL_RIGHT);
    });
    test('browser Ctrl+B toggles once with focused input and Esc cancels queued focus', () => {
        const first = domKey('b', { ctrlKey: true });
        assert.ok(first.prevented && first.stopped, 'consumed shortcut must not reach canvas again');
        ui.flush();
        assert.ok(ui.gmCommandBox.isFocused());
        domKey('b', { ctrlKey: true, repeat: true });
        assert.equal(ui.gmPanel.active, true);
        domKey('b', { ctrlKey: true });
        assert.equal(ui.gmPanel.active, false);
        assert.equal(ui.gmCommandBox.isFocused(), false);
        domKey('b', { ctrlKey: true });
        const escape = domKey('Escape');
        assert.ok(escape.prevented && escape.stopped);
        ui.flush();
        assert.equal(ui.gmPanel.active, false);
        assert.equal(ui.gmCommandBox.isFocused(), false);
    });
    test('window blur, backgrounding and input keyup clear stale modifier state', () => {
        for (const reset of [() => window.emit('blur'), () => game.emit('hide'),
            () => document.emit('keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: false })]) {
            down(KeyCode.CTRL_LEFT);
            reset();
            down(KeyCode.KEY_B); up(KeyCode.KEY_B);
            assert.equal(ui.gmPanel.active, false);
        }
        down(KeyCode.CTRL_LEFT); down(KeyCode.CTRL_RIGHT); up(KeyCode.CTRL_LEFT);
        down(KeyCode.KEY_B); up(KeyCode.KEY_B); up(KeyCode.CTRL_RIGHT);
        assert.equal(ui.gmPanel.active, true, 'releasing left Ctrl must not release right Ctrl');
        ui.onClickGMClose();
    });
    test('Enter executes once, command history restores draft, and server replies reach the open panel', () => {
        domKey('b', { ctrlKey: true }); ui.flush();
        ui.gmCommandBox.string = '  test_only_command  ';
        ui.gmCommandBox.node.emit(EditBox.EventType.EDITING_RETURN);
        assert.equal(sent.length, 1);
        assert.deepEqual(encoded.at(-1), { name: ServerConfig.c2s_gm_command, payload: { cmd: 'test_only_command' } });
        assert.equal(sent[0].name, ServerConfig.c2s_gm_command);
        assert.ok(sent[0].msg instanceof Uint8Array);
        ui.gmCommandBox.string = 'draft';
        domKey('ArrowDown');
        assert.equal(ui.gmCommandBox.string, 'draft');
        domKey('ArrowUp');
        assert.equal(ui.gmCommandBox.string, 'test_only_command');
        domKey('ArrowDown');
        assert.equal(ui.gmCommandBox.string, 'draft');
        EventMgr.emit(ServerConfig.s2c_tell_me, { msg: 'command reply' });
        assert.match(ui.gmTipLabel.string, /command reply/);
        EventMgr.emit(ServerConfig.s2c_gm_command_help, { ret: [{ k: 'test', v: 'help' }] });
        assert.match(ui.gmTipLabel.string, /test=help/);
        encodingFails = true;
        ui.onClickGMExecute();
        assert.equal(sent.length, 1, 'failed encoding must not send');
        encodingFails = false;
        ui.onClickGMClose();
        EventMgr.emit(ServerConfig.s2c_tell_me, { msg: 'normal toast' });
        assert.equal(toasts.at(-1), 'normal toast');
    });
    test('coordinate button and Enter validate bounds without sending server commands', () => {
        domKey('b', { ctrlKey: true }); ui.flush();
        assert.equal(ui.gmCoordLabel.string, '当前坐标  16 , 24');
        ui.gmEditBoxX.string = '25'; ui.gmEditBoxY.string = '30';
        ui.gmEditBoxY.node.emit(EditBox.EventType.EDITING_RETURN);
        assert.deepEqual(scrolls.pop(), [25, 30]);
        for (const [x, y] of [['', '1'], ['1.5', '1'], ['200', '1'], ['1', '100'], ['Infinity', '1']]) {
            ui.gmEditBoxX.string = x; ui.gmEditBoxY.string = y; ui.onClickGMJump();
        }
        assert.equal(scrolls.length, 0);
        ui.gmCommandBox.string = 'goto 10 20'; ui.onClickGMExecute();
        assert.deepEqual(scrolls.pop(), [10, 20]);
        assert.equal(sent.length, 1);
        center = { x: 40, y: 50 };
        EventMgr.emit(LogicEvent.mapEenterChange);
        assert.equal(ui.gmCoordLabel.string, '当前坐标  40 , 50');
        ui.onClickGMClose();
    });
    test('disable/re-enable and destroy/recreate leave exactly one input handler', () => {
        ui.onDisable();
        assert.equal(input.count('down'), 0); assert.equal(document.count('keydown'), 0);
        assert.equal(window.count('blur'), 0); assert.equal(game.count('hide'), 0);
        ui.onEnable(); ui.onEnable();
        assert.equal(input.count('down'), 1); assert.equal(document.count('keydown'), 1);
        ui.onDestroy();
        assert.equal(input.count('down'), 0); assert.equal(document.count('keydown'), 0);
        assert.equal(ui.gmCommandBox.node.count(EditBox.EventType.EDITING_RETURN), 0);
        const next = create(); ready(next);
        domKey('b', { ctrlKey: true });
        assert.equal(next.gmPanel.active, true);
        assert.equal(ui.gmPanel.active, false);
        next.onDestroy();
    });
    test('non-browser builds use public engine input without DOM globals', () => {
        const NativeMapUI = load(file, imports, false).default;
        const native = create(NativeMapUI); ready(native);
        down(KeyCode.CTRL_LEFT); down(KeyCode.KEY_B);
        assert.equal(native.gmPanel.active, true);
        native.onDestroy();
        assert.equal(input.count('down'), 0);
    });
    test('destroyed child nodes cannot interrupt cleanup or leave old HUD callbacks on the next login', () => {
        const previous = create(); ready(previous);
        const deadNode = { isValid: false, off() { throw new Error('child event processor was destroyed'); } };
        previous.gmCommandBox = { node: null };
        previous.gmEditBoxX = { node: deadNode };
        previous.gmEditBoxY = { node: deadNode };
        previous._playerAvatar = { node: null };
        EventMgr.on(LogicEvent.updateMyRole, () => { throw new Error('stale HUD updated after logout'); }, previous);
        assert.doesNotThrow(() => previous.onDestroy());
        assert.equal(EventMgr.targetInName.has(previous), false);
        assert.doesNotThrow(() => EventMgr.emit(LogicEvent.updateMyRole));
        assert.equal(input.count('down'), 0);
        const HeadPanel = load('assets/scripts/map/ui/HeadIconPanel.ts', imports).default;
        const panel = new HeadPanel();
        panel._safeArea = deadNode;
        EventMgr.on(LogicEvent.updateMyRole, () => { throw new Error('stale avatar panel'); }, panel);
        assert.doesNotThrow(() => panel.onDestroy());
        assert.equal(EventMgr.targetInName.has(panel), false);
        assert.doesNotThrow(() => EventMgr.emit(LogicEvent.updateMyRole));
    });
    EventMgr.targetOff(observer);
    console.log(`${passed} GM regression groups passed.`);
    process.exit(0);
} catch (error) {
    console.error(error);
    process.exit(1);
}
