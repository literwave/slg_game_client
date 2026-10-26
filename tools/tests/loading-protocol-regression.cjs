// Exercise real project scripts with controlled network, resource completion and clocks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
const asDefault = value => ({ default: value });
class Component { isValid = true; scheduleOnce() {} }
class SpriteFrame { isValid = true; constructor(name) { this.name = name; } }
class Node {
    static EventType = { SIZE_CHANGED: 'size' };
    isValid = true;
    children = [];
    on() {} off() {} setSiblingIndex() {} destroy() { this.isValid = false; }
}
const cc = {
    Component, Node, SpriteFrame, JsonAsset: class {}, Prefab: class {}, TiledMapAsset: class {},
    _decorator: { ccclass: () => type => type, property: () => () => {} },
    isValid: value => !!value && value.isValid !== false,
    instantiate: () => new Node(),
};
class Clock {
    now = 0; serial = 0; timers = new Map();
    setTimeout = (fn, delay) => {
        const id = ++this.serial;
        this.timers.set(id, { fn, at: this.now + delay });
        return id;
    };
    clearTimeout = id => this.timers.delete(id);
    tick(ms) {
        this.now += ms;
        for (const [id, timer] of [...this.timers]) {
            if (timer.at <= this.now && this.timers.delete(id)) timer.fn();
        }
    }
}
function load(file, imports = {}, engine = cc, clock = new Clock(), allowUnusedStubs = false) {
    const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        fileName: file, reportDiagnostics: true, compilerOptions: {
            target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        },
    });
    assert.equal(result.diagnostics.length, 0, file);
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', result.outputText)(id => {
        if (id === 'cc') return engine;
        if (Object.hasOwn(imports, id)) return imports[id];
        if (allowUnusedStubs) return asDefault(class {});
        throw new Error(`Unmocked dependency ${file}: ${id}`);
    }, mod, mod.exports, clock.setTimeout, clock.clearTimeout);
    return mod.exports;
}
const { LogicEvent } = load('assets/scripts/common/LogicEvent.ts');
const { CoreEvent } = load('assets/scripts/core/CoreEvent.ts');
const netInterface = load('assets/scripts/network/socket/NetInterface.ts');
const { NetEvent } = netInterface;
const { ServerConfig } = load('assets/scripts/config/ServerConfig.ts');
const portraitPaths = load('assets/scripts/general/GeneralPortrait.ts');
const heroConfig = Object.values(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/Hero.json'), 'utf8')));
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function fixture() {
    const { EventMgr } = load('assets/scripts/utils/EventMgr.ts');
    const clock = new Clock();
    const sent = [], images = [];
    const engine = { ...cc, resources: { load: (url, type, callback) => images.push({ url, callback }) } };
    const net = { send: data => sent.push(data) };
    const proto = { encode: () => new Uint8Array([1]), getIdByMsgType: () => 1, isReady: () => true };
    let command;
    const Proxy = load('assets/scripts/general/GeneralProxy.ts', {
        './GeneralCommand': asDefault({ getInstance: () => command }), './GeneralPortrait': portraitPaths,
    }, engine, clock).default;
    const imports = {
        '../utils/EventMgr': { EventMgr }, '../common/LogicEvent': { LogicEvent },
        '../config/ServerConfig': { ServerConfig }, '../network/socket/NetInterface': netInterface,
        '../network/socket/NetManager': { NetManager: { getInstance: () => net } },
        '../network/pto/ProtoManager': { ProtoManager: { getInstance: () => proto } },
    };
    const Command = load('assets/scripts/general/GeneralCommand.ts', {
        ...imports, './GeneralProxy': asDefault(Proxy),
    }, engine, clock).default;
    command = Command.getInstance();
    const snapshot = list => EventMgr.emit(ServerConfig.s2c_req_all_hero_base_info, { heroInfoList: list });
    return { EventMgr, clock, sent, images, engine, net, proto, Proxy, command, imports, snapshot };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('early response and sync survive late config; UI refresh is coalesced; reopen uses cache', async () => {
    const f = fixture();
    let refreshes = 0;
    f.EventMgr.on(LogicEvent.updateMyGenerals, () => refreshes++, {});
    const pending = f.command.beginLoading();
    assert.equal(f.command.qryMyGenerals(), pending);
    assert.equal(f.sent.length, 1);
    f.snapshot([{ heroId: 1001, lv: 2 }]);
    assert.equal(await pending, true);
    f.EventMgr.emit(ServerConfig.s2c_sync_hero_base_info, { heroInfo: { heroId: 1001, lv: 7 } });
    const hero = f.command.proxy.getMyGeneral(1001);
    f.command.proxy.initHeroConfig(heroConfig, {});
    assert.equal(f.command.proxy.getMyGeneral(1001), hero, 'config must not replace received data');
    assert.equal(hero.level, 7);
    assert.equal(hero.config.name, heroConfig.find(cfg => cfg.Id === 1001).name);
    assert.equal(refreshes, 0);
    f.command.setUIReady(); f.command.setUIReady();
    assert.equal(refreshes, 1);
    await f.command.qryMyGenerals();
    assert.equal(f.sent.length, 1, 'opening the list must not resend the initial snapshot');
    f.EventMgr.emit(NetEvent.ServerReconnectSuccess);
    assert.equal(f.sent.length, 2, 'reconnect needs a new authoritative snapshot');
    f.snapshot([{ heroId: 1001, lv: 8 }]);
    assert.equal(hero.level, 7);
    assert.equal(f.command.proxy.getMyGeneral(1001).level, 8);
    assert.equal(refreshes, 2);
    f.command.clearData();
    assert.equal(f.clock.timers.size, 0);
});

test('timeout permits retry; empty list is ready; logout rejects pending work and ignores late replies', async () => {
    const f = fixture();
    const first = f.command.beginLoading();
    f.clock.tick(8000);
    assert.equal(await first, false);
    const retry = f.command.qryMyGenerals();
    assert.equal(f.sent.length, 2);
    f.snapshot([]);
    assert.equal(await retry, true);
    await f.command.qryMyGenerals();
    assert.equal(f.sent.length, 2, 'zero heroes is a valid cached snapshot');
    const pending = f.command.qryMyGenerals(true);
    f.command.clearData();
    assert.equal(await pending, false);
    f.snapshot([{ heroId: 1001 }]);
    assert.equal(f.command.proxy.getMyGenerals().length, 0);
    assert.equal(f.clock.timers.size, 0);
    const nextSession = f.command.beginLoading();
    f.snapshot([{ heroId: 1022, lv: 3 }]);
    assert.equal(await nextSession, true);
    assert.deepEqual(f.command.proxy.getMyGenerals().map(hero => hero.id), [1022]);
    f.command.clearData();
});

test('portrait prefetch shares in-flight loads, retries errors and caps full_hero concurrency at four', async () => {
    const f = fixture();
    const proxy = f.command.proxy;
    proxy.initHeroConfig(heroConfig, {});
    const first = proxy.loadGeneralTex(1001);
    assert.equal(proxy.loadGeneralTex(1001), first);
    assert.equal(f.images.length, 1);
    f.images.shift().callback(new Error('test missing file'), null);
    assert.equal(await first, null);
    const retry = proxy.loadGeneralTex(1001);
    assert.equal(f.images.length, 1);
    const frame = new SpriteFrame('1001');
    f.images.shift().callback(null, frame);
    assert.equal(await retry, frame);
    assert.equal(await proxy.loadGeneralTex(1001), frame);
    assert.equal(f.images.length, 0);
    proxy.setMyGenerals(heroConfig.map(cfg => ({ heroId: cfg.Id })));
    let done = false;
    const warmup = proxy.preloadMyPortraits(() => true).then(() => done = true);
    await flush();
    let loaded = 0;
    while (!done) {
        assert.ok(f.images.length > 0 && f.images.length <= 4, 'bounded image concurrency');
        const batch = f.images.splice(0);
        loaded += batch.length;
        batch.forEach(image => image.callback(null, new SpriteFrame(image.url)));
        await flush();
    }
    await warmup;
    assert.equal(loaded, heroConfig.length - 1);
    heroConfig.forEach(cfg => assert.ok(proxy.getGeneralTex(cfg.Id)));
    const other = new f.Proxy();
    other.initHeroConfig(heroConfig, {});
    other.setMyGenerals(heroConfig.map(cfg => ({ heroId: cfg.Id })));
    let current = true;
    const cancelled = other.preloadMyPortraits(() => current);
    assert.equal(f.images.length, 4);
    current = false;
    f.images.splice(0).forEach(image => image.callback(null, new SpriteFrame(image.url)));
    await cancelled;
    assert.equal(f.images.length, 0, 'logout must stop scheduling more portraits');
    const stalled = new f.Proxy();
    stalled.initHeroConfig(heroConfig, {});
    const stalledRequest = stalled.loadGeneralTex(1001);
    const staleCallback = f.images.shift().callback;
    f.clock.tick(8000);
    assert.equal(await stalledRequest, null);
    const afterTimeout = stalled.loadGeneralTex(1001);
    assert.equal(f.images.length, 1, 'stalled loads must not prevent on-demand retry');
    const recovered = new SpriteFrame('recovered');
    f.images.shift().callback(null, recovered);
    assert.equal(await afterTimeout, recovered);
    staleCallback(new Error('late failure'), null);
    assert.equal(stalled.getGeneralTex(1001), recovered);
    assert.equal(f.clock.timers.size, 0);
});

test('reward and unlock payloads stay cached while loading and flush once on UI readiness', () => {
    const f = fixture();
    const configManager = { getInstance: () => ({ getConfig: () => [] }) };
    const Reward = load('assets/scripts/reward/RewardCommand.ts', {
        ...f.imports, '../core/ConfigManager': asDefault(configManager),
    }).default;
    const OpenProxy = load('assets/scripts/systemopen/SystemOpenProxy.ts').default;
    const Open = load('assets/scripts/systemopen/SystemOpenCommand.ts', {
        ...f.imports, '../core/ConfigManager': asDefault(configManager), './SystemOpenProxy': asDefault(OpenProxy),
    }, { ...cc, resources: { load: (url, type, cb) => cb(null, { json: [] }) } }).default;
    const reward = new Reward(), open = new Open();
    const rewards = [], unlocks = [], updates = [];
    f.EventMgr.on(LogicEvent.showReward, list => rewards.push(list), {});
    f.EventMgr.on(LogicEvent.systemUnlock, id => unlocks.push(id), {});
    f.EventMgr.on(LogicEvent.systemOpenUpdated, ids => updates.push(ids), {});
    f.EventMgr.emit(ServerConfig.s2c_show_reward, { rewardList: [{ itemId: 1001, itemCount: 1 }] });
    f.EventMgr.emit(ServerConfig.s2c_sync_system_open, { systemId: 2 });
    f.EventMgr.emit(ServerConfig.s2c_sync_system_open, { systemId: 2 });
    assert.ok(open.isSystemOpen(2), 'data sync remains active during loading');
    assert.deepEqual([rewards.length, unlocks.length, updates.length], [0, 0, 0]);
    reward.setUIReady(); open.setUIReady(); reward.setUIReady(); open.setUIReady();
    assert.deepEqual([rewards.length, unlocks.length, updates.length], [1, 1, 1]);
    assert.deepEqual(unlocks, [2]);
    reward.clearData(); open.clearData();
    f.EventMgr.emit(ServerConfig.s2c_show_reward, { rewardList: [{ itemId: 1002 }] });
    f.EventMgr.emit(ServerConfig.s2c_sync_system_open, { systemId: 3 });
    reward.clearData(); open.clearData();
    reward.setUIReady(); open.setUIReady();
    assert.deepEqual([rewards.length, unlocks.length, updates.length], [1, 1, 1]);
    assert.equal(open.isSystemOpen(3), false);
});

test('HUD subscribes after loading, pulls latest cached values and never registers twice', () => {
    const f = fixture();
    let updates = 0, troopRequests = 0, systemRequests = 0;
    const keys = [];
    const UI = load('assets/scripts/map/ui/MapUILogic.ts', {
        '../../utils/EventMgr': { EventMgr: f.EventMgr }, '../../common/LogicEvent': { LogicEvent },
        '../../core/CoreEvent': { CoreEvent }, '../../config/ServerConfig': { ServerConfig },
        '../MapCommand': asDefault({ getInstance: () => ({ cityProxy: { myUnionId: 0 } }) }),
        './MapUICommand': asDefault({ getInstance: () => ({ proxy: { clearData() {} } }) }),
        '../../systemopen/SystemOpenCommand': asDefault({ getInstance: () => ({ requestSystemOpen: () => systemRequests++ }) }),
        '../../general/TroopCommand': asDefault({ getInstance: () => ({ requestTroops: () => troopRequests++ }) }),
    }, { ...cc, input: { on: key => keys.push(key), off() {} }, Input: { EventType: { KEY_DOWN: 'down', KEY_UP: 'up' } } }, f.clock, true).default;
    const ui = new UI();
    ui.node = new Node();
    for (const method of ['initHudNavigation', 'initMoreMenu', 'initHeadIconEntry', 'initTaskTracker', 'layoutHud', 'updateRole', 'clearAllNode']) ui[method] = () => {};
    ui.updateRoleRes = () => updates++;
    ui.onLoad();
    for (let i = 0; i < 100; i++) f.EventMgr.emit(LogicEvent.upateMyRoleRes);
    assert.deepEqual([updates, troopRequests, systemRequests, keys.length], [1, 0, 0, 0]);
    assert.equal(f.EventMgr.events.has(ServerConfig.s2c_gm_command_help), false);
    f.EventMgr.emit(CoreEvent.gameReady); f.EventMgr.emit(CoreEvent.gameReady);
    assert.deepEqual([updates, troopRequests, systemRequests, keys.length], [2, 1, 0, 0]);
    f.EventMgr.emit(LogicEvent.upateMyRoleRes);
    assert.equal(updates, 3);
    ui.onDestroy();
    f.EventMgr.emit(LogicEvent.upateMyRoleRes);
    assert.equal(updates, 3);
});

function mainFixture() {
    const f = fixture();
    const scheduled = [];
    const drawListeners = [];
    const director = {
        once(event, callback, target) { drawListeners.push({ event, callback, target }); },
        off(event, callback, target) {
            const index = drawListeners.findIndex(listener => listener.event === event
                && listener.callback === callback && listener.target === target);
            if (index >= 0) drawListeners.splice(index, 1);
        },
    };
    const renderFrame = () => {
        for (const listener of drawListeners.splice(0)) listener.callback.call(listener.target);
    };
    let resourceComplete, finishCallback, finishes = 0, uiReady = 0;
    const configs = new Map();
    const Main = load('assets/scripts/Main.ts', {
        './utils/EventMgr': { EventMgr: f.EventMgr }, './common/LogicEvent': { LogicEvent }, './core/CoreEvent': { CoreEvent },
        './general/GeneralCommand': asDefault({ getInstance: () => f.command }),
        './core/LoaderManager': { default: { getInstance: () => ({ startLoadList: (list, progress, cb) => resourceComplete = cb }) }, LoadData: class {}, LoadDataType: {} },
        './core/ConfigManager': asDefault({ getInstance: () => ({
            loadConfigs: list => list.forEach(asset => configs.set(asset.name, asset.json)),
            getConfig: name => configs.get(name), getConfigItem: () => null,
        }) }),
        './map/MapCommand': asDefault({ getInstance: () => ({ proxy: { *initMapResConfigBatched() { yield 0.5; yield 1; } } }) }),
        './map/ui/MapUICommand': asDefault({ getInstance: () => ({ proxy: { setBasic() {}, setAllFacilityCfg() {} } }) }),
        './login/LoginCommand': asDefault({ getInstance: () => ({
            beginMapLoading() {}, notifyClientLoaded() {},
            headIcons: { initConfig() {}, preloadIcons: async () => {} },
        }) }),
        './skill/SkillCommand': asDefault({ getInstance: () => ({
            proxy: { initSkillConfig() {}, preloadSkillIcons: async () => {} },
        }) }),
        './reward/RewardCommand': asDefault({ getInstance: () => ({ setUIReady() {} }) }),
        './systemopen/SystemOpenCommand': asDefault({ getInstance: () => ({ setUIReady() {} }) }),
        './reward/RewardWindowLogic': asDefault({ init() {} }), './systemopen/SystemUnlockWindow': asDefault({ init() {} }),
    }, { ...cc, director, Director: { EVENT_AFTER_DRAW: 'after-draw' } }, f.clock, true).default;
    const main = new Main();
    main.node = new Node();
    main.scheduleOnce = callback => scheduled.push(callback);
    main.addLoadingNode = () => {
        main._loadingNode = new Node();
        main._loadingNode.getComponent = () => ({ finish: cb => { finishes++; finishCallback = cb; } });
    };
    main.clearAllScene = () => {};
    f.EventMgr.on(CoreEvent.gameReady, () => uiReady++, {});
    return { ...f, main, scheduled, renderFrame, drawListeners, completeResources: () => resourceComplete(null, [], [{}, [
        { name: 'Hero', json: Object.fromEntries(heroConfig.map(hero => [hero.Id, hero])) },
        { name: 'Global', json: {} }, { name: 'mapRes_0', json: {} },
    ]]), get finishes() { return finishes; }, get uiReady() { return uiReady; }, finishFade: () => finishCallback() };
}

test('entry requests heroes before resource load and finishes only after warmup and loading fade', async () => {
    const f = mainFixture();
    f.main.onEnterMap(); f.main.onEnterMap();
    assert.equal(f.sent.length, 0, '加载遮罩提交首帧前不能发起武将请求');
    assert.equal(f.scheduled.length, 0);
    assert.equal(f.drawListeners.length, 1, '重复进入不注册第二个首帧回调');
    f.renderFrame();
    assert.equal(f.scheduled.length, 1);
    f.scheduled.shift()();
    assert.equal(f.sent.length, 1);
    f.snapshot([{ heroId: 1001 }, { heroId: 1022 }]);
    f.completeResources();
    for (let i = 0; i < 10; i++) f.main.update();
    f.main.onMapReady();
    await flush();
    assert.equal(f.images.length, 2);
    assert.equal(f.finishes, 0);
    f.images.splice(0).forEach(image => image.callback(null, new SpriteFrame(image.url)));
    await flush();
    assert.equal(f.finishes, 1);
    assert.equal(f.uiReady, 0);
    f.main.onMapReady();
    assert.equal(f.finishes, 1);
    f.finishFade();
    assert.equal(f.uiReady, 1);
    assert.ok(f.command.proxy.getGeneralTex(1001));
    assert.ok(f.command.proxy.getGeneralTex(1022));
    assert.equal(f.clock.timers.size, 0);
    f.command.clearData();
});

test('slow or abandoned image warmup cannot block entry or finish a newer login', async () => {
    const f = mainFixture();
    f.main.onEnterMap(); f.renderFrame(); f.scheduled.shift()();
    f.snapshot([{ heroId: 1001 }]); f.completeResources();
    for (let i = 0; i < 10; i++) f.main.update();
    f.main.onMapReady(); await flush();
    f.clock.tick(10000);
    assert.equal(f.finishes, 1, 'image deadline must release the loading page');
    f.main.disposeLoadingNow(); f.command.clearData();
    f.finishFade();
    f.images.splice(0).forEach(image => image.callback(null, new SpriteFrame(image.url)));
    await flush();
    assert.equal(f.uiReady, 0, 'old fade/image callbacks must not activate a logged-out HUD');
    assert.equal(f.main._heroAssetsReady, false);
    assert.equal(f.clock.timers.size, 0);
});

test('repeated sends do not leak protocol listeners; received protocols still reach their handlers', () => {
    const f = fixture();
    const { NetNode, NetNodeState } = load('assets/scripts/network/socket/NetNode.ts', {
        './NetInterface': netInterface, './NetTimer': { NetTimer: class {} }, './WebSock': { WebSock: class {} },
        '../../utils/EventMgr': { EventMgr: f.EventMgr },
    });
    const node = new NetNode();
    let sent = 0, received = 0;
    node._state = NetNodeState.Working;
    node._socket = { packAndSend: () => sent++ };
    node._timer = { init() {} };
    const count = () => [...f.EventMgr.events.values()].reduce((total, list) => total + list.length, 0);
    const before = count();
    node.initTimer();
    for (let i = 0; i < 1000; i++) node.send({ name: ServerConfig.c2s_heart_beat, msg: new Uint8Array() });
    assert.equal(sent, 1000);
    assert.equal(count(), before);
    f.EventMgr.on(ServerConfig.s2c_heart_beat, () => received++, {});
    node.onMessage(ServerConfig.s2c_heart_beat, { heartBeatTime: 1 });
    assert.equal(received, 1);
    node._state = NetNodeState.Checking;
    node.send({ name: ServerConfig.c2s_heart_beat, msg: new Uint8Array() });
    assert.equal(node._requests.length, 1, 'login/reconnect send queue is preserved');
});

(async () => {
    for (const { name, run } of tests) { await run(); console.log(`PASS ${name}`); }
    console.log(`PASS ${tests.length} loading/protocol regression groups`);
})().catch(error => { console.error(error); process.exitCode = 1; });
