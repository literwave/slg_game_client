// Exercise real project scripts with controlled network, resource completion and clocks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
const asDefault = value => ({ default: value });
class Component { isValid = true; scheduleOnce() {} schedule() {} }
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
const { SIEGE_SHEETS } = load('assets/scripts/map/entries/SiegeAnimationLibrary.ts', {
    './SiegeChoreography': load('assets/scripts/map/entries/SiegeChoreography.ts'),
});
const heroConfig = Object.values(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/Hero.json'), 'utf8')));
const itemConfig = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/Item.json'), 'utf8'));
const heroLevelConfig = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/HeroLv.json'), 'utf8'));
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
        '../core/ConfigManager': asDefault({ getInstance: () => ({ getConfig: () => heroLevelConfig }) }),
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

test('experience totals stay continuous across levels and cap correctly', () => {
    const proxy = fixture().command.proxy;
    assert.equal(proxy.getMaxLevel(), 50);
    assert.equal(proxy.getGeneralLevelCfg(1).exp, 100);
    assert.equal(proxy.getGeneralLevelCfg(49).exp, 240100);
    assert.equal(proxy.getGeneralLevelCfg(50).exp, 0);
    assert.deepEqual(proxy.getExperienceProgress(1, 0), { current: 0, maximum: 4042500 });
    let completed = 0;
    for (let level = 1; level < 50; level++) {
        const cost = heroLevelConfig[level - 1].Exp;
        assert.equal(proxy.getExperienceProgress(level, cost - 1).current, completed + cost - 1);
        assert.equal(proxy.getExperienceProgress(level + 1, 0).current, completed + cost);
        completed += cost;
    }
    assert.deepEqual(proxy.getExperienceProgress(50, 0), { current: 4042500, maximum: 4042500 });
    assert.deepEqual(proxy.getExperienceProgress(50, 99999), { current: 4042500, maximum: 4042500 });
    assert.equal(proxy.getExperienceProgress(2, -10).current, 100);
    assert.equal(proxy.getExperienceProgress(2, NaN).current, 100);
});

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
    const OpenProxy = load('assets/scripts/systemopen/SystemOpenProxy.ts', {
        '../config/enum/SystemOpenEnum': load('assets/scripts/config/enum/SystemOpenEnum.ts'),
    }).default;
    const Open = load('assets/scripts/systemopen/SystemOpenCommand.ts', {
        ...f.imports, '../core/ConfigManager': asDefault(configManager), './SystemOpenProxy': asDefault(OpenProxy),
    }, { ...cc, resources: { load: (url, type, cb) => cb(null, { json: [] }) } }).default;
    const reward = new Reward(), open = new Open();
    open.proxy.setConfigs(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/SystemOpen.json'), 'utf8')));
    assert.equal(open.proxy.getConfigByEnum('HEAD_ICON').Id, 1, 'generated enum works without an Enum field in JSON');
    assert.equal(open.proxy.getConfigByEnum('CREATE_ALLIANCE').Id, 2);
    assert.equal(open.proxy.getConfigByEnum('MISSING'), null);
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
    let updates = 0, troopRequests = 0, systemRequests = 0, panelWarmups = 0;
    const keys = [], viewWarmups = [];
    const UI = load('assets/scripts/map/ui/MapUILogic.ts', {
        '../../utils/EventMgr': { EventMgr: f.EventMgr }, '../../common/LogicEvent': { LogicEvent },
        '../../core/CoreEvent': { CoreEvent }, '../../config/ServerConfig': { ServerConfig },
        '../MapCommand': asDefault({ getInstance: () => ({ cityProxy: { myUnionId: 0 } }) }),
        '../WorldMapArt': asDefault({ unbindTree() {} }),
        './LazyPanelLoader': asDefault(class {
            prefetchAll() { panelWarmups++; }
            warmView(key) { viewWarmups.push(key); return Promise.resolve(); }
            dispose() {}
        }),
        './MapUICommand': asDefault({ getInstance: () => ({ proxy: { clearData() {} } }) }),
        '../../systemopen/SystemOpenCommand': asDefault({ getInstance: () => ({ requestSystemOpen: () => systemRequests++ }) }),
        '../../general/TroopCommand': asDefault({ getInstance: () => ({ requestTroops: () => troopRequests++ }) }),
    }, { ...cc, input: { on: key => keys.push(key), off() {} }, Input: { EventType: { KEY_DOWN: 'down', KEY_UP: 'up' } } }, f.clock, true).default;
    const ui = new UI();
    ui.node = new Node();
    for (const method of ['initHudNavigation', 'initMoreMenu', 'initHeadIconEntry', 'initTaskTracker', 'initChatStrip', 'initCampaignFeedback', 'initResourceIcons', 'layoutHud', 'updateRole', 'clearAllNode']) ui[method] = () => {};
    ui.updateRoleRes = () => updates++;
    ui.onLoad();
    for (let i = 0; i < 100; i++) f.EventMgr.emit(LogicEvent.upateMyRoleRes);
    assert.deepEqual([updates, troopRequests, systemRequests, keys.length], [1, 0, 0, 0]);
    assert.equal(f.EventMgr.events.has(ServerConfig.s2c_gm_command_help), false);
    assert.equal(panelWarmups, 0, '首屏完成之前不开始功能预载');
    assert.deepEqual(viewWarmups, [], '首屏完成之前不开始页面预热');
    f.EventMgr.emit(CoreEvent.gameReady); f.EventMgr.emit(CoreEvent.gameReady);
    assert.deepEqual([updates, troopRequests, systemRequests, keys.length], [2, 1, 0, 0]);
    assert.equal(panelWarmups, 1, '进图后自动预载，重复 gameReady 不重复排队');
    assert.deepEqual(viewWarmups, ['inventory', 'cityBuildings', 'battleReports'], '进图后各页面仅预热一次');
    f.EventMgr.emit(LogicEvent.upateMyRoleRes);
    assert.equal(updates, 3);
    ui.onDestroy();
    f.EventMgr.emit(LogicEvent.upateMyRoleRes);
    assert.equal(updates, 3);
});

test('武将详情只实例化实际打开的页，重开和相同尺寸事件不重复排版', () => {
    const f = fixture(), size = { width: 1280, height: 720 }, created = [], updates = [];
    let layouts = 0;
    const Info = load('assets/scripts/map/ui/GeneralInfoLogic.ts', {
        '../../utils/EventMgr': { EventMgr: f.EventMgr }, '../../common/LogicEvent': { LogicEvent },
        '../../config/ServerConfig': { ServerConfig },
        '../../general/GeneralCommand': asDefault({ getInstance: () => ({ isProtocolAvailable: () => false }) }),
        './GeneralDetailSkin': { styleGeneralHeader: () => layouts++ },
    }, { ...cc, UITransform: class {}, view: { on() {}, off() {}, getVisibleSize: () => size }, instantiate: prefab => {
        const node = new Node(); node.getComponent = () => ({ setData: (cfg, data) => updates.push(data) });
        created.push(prefab); return node;
    } }, f.clock, true).default;
    const info = new Info(); info.node = new Node();
    info.node.parent = { getComponent: () => size }; info.node.getChildByName = () => null;
    info.generalDesPrefab = 'details'; info.generalComposePrefab = 'compose'; info.generalAddPrefab = 'add';
    info.onLoad(); info.onEnable(); info.start();
    assert.equal(layouts, 1); assert.deepEqual(created, []);
    const first = { hero_type: 1001 }, second = { hero_type: 1002 };
    info.setData({}, first); info.setData({}, second); info.setIndex(2);
    assert.deepEqual(created, ['details'], '未开放页面不能在点击详情时提前实例化');
    assert.equal(info._nodeList[0].active, true);
    info.onDisable(); info.onEnable();
    assert.equal(layouts, 1);
    size.width = 900; info.refreshVisualLayout(); assert.equal(layouts, 2);
    const before = updates.length; info.updateOnce({ hero_type: 1003 });
    assert.equal(updates.length, before, '其它武将的推送不能切换当前档案');
    info.updateOnce(second); assert.equal(updates.length, before + 1);
    info._supportedTabs[1] = true; info.setIndex(1); info.setIndex(0); info.setIndex(1);
    assert.deepEqual(created, ['details', 'compose']);
    info.onDestroy();
});

test('武将属性数据照常更新，仅尺寸或技能空槽变化时重画详情布局', () => {
    const size = { width: 1280, height: 720 }, skills = [null, null, null];
    let layouts = 0;
    const Detail = load('assets/scripts/map/ui/GeneralDesLogic.ts', {
        './GeneralDetailSkin': { styleGeneralDetail: () => layouts++ },
        '../../general/GeneralCommand': asDefault({ getInstance: () => ({ proxy: {
            getExperienceProgress: (_level, exp) => ({ current: exp, maximum: 100 }), getMaxLevel: () => 50,
        } }) }),
        '../../skill/SkillCommand': asDefault({ getInstance: () => ({ proxy: {
            getSkillCfg: id => id ? { name: '技能' + id } : null,
            getSkillForDisplay: id => id ? { cfgId: id } : null,
        } }) }),
    }, { ...cc, UITransform: class {}, view: { getVisibleSize: () => size } }, new Clock(), true).default;
    const detail = new Detail(); detail.node = { parent: { getComponent: () => size } };
    detail.skillIcons = skills.map((_, i) => ({ getComponent: () => ({
        getSkill: () => skills[i], setData: data => skills[i] = data,
    }) }));
    detail.skillNameLab = skills.map(() => ({ string: '' }));
    for (const name of ['lvLabel', 'expLabel', 'nameLab', 'foreLabel', 'strategyLabel', 'defenseLabel',
        'speedLabel', 'destroyLabel', 'powerLabel', 'costLabel']) detail[name] = { string: '' };
    detail.refreshVisualLayout(); assert.equal(layouts, 0, '未收到数据时不重绘一张空白详情');
    const cfg = { name: '武将', attack: 10, hp: 50, defense: 20, speed: 30, crit: 2, heroClass: '骑兵', skillId: 1 };
    detail.setData(cfg, { level: 1, exp: 3, skills: [] });
    assert.equal(layouts, 1);
    detail.setData({ ...cfg, attack: 18 }, { level: 2, exp: 7, skills: [] });
    assert.equal(layouts, 1); assert.equal(detail.foreLabel.string, '18');
    assert.equal(detail.lvLabel.string, '2/50'); assert.equal(detail.expLabel.string, '7 / 100');
    assert.equal(detail.skillNameLab[1].string, '选择技能');
    detail.setData(cfg, { level: 2, exp: 7, skills: [{ cfgId: 1 }, { cfgId: 2 }] });
    assert.equal(layouts, 2); assert.equal(detail.skillNameLab[1].string, '技能2');
    size.height = 480; detail.refreshVisualLayout(); assert.equal(layouts, 3);
});

function mainFixture(inventoryWarmup = Promise.resolve(), chatWarmup = Promise.resolve(), worldWarmup = Promise.resolve()) {
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
    let resourceComplete, finishCallback, finishes = 0, uiReady = 0, loadNotices = 0, uiWarmups = 0;
    const buildings = { loaded: true, loadError: '' };
    const configs = new Map();
    const inventoryCalls = [];
    const backgroundJobs = [];
    const backgroundKeys = [], cancelledKeys = [], backgroundResolves = new Map();
    const worldArt = { visibleState: { pending: 0, error: null }, statistics: {}, preparationProgress: 0, calls: 0,
        prepare() { this.calls++; return worldWarmup.then(() => { this.preparationProgress = 1; }); } };
    const Main = load('assets/scripts/Main.ts', {
        './utils/EventMgr': { EventMgr: f.EventMgr }, './common/LogicEvent': { LogicEvent }, './core/CoreEvent': { CoreEvent },
        './general/GeneralCommand': asDefault({ getInstance: () => f.command }),
        './core/LoaderManager': { default: { getInstance: () => ({ startLoadList: (list, progress, cb) => resourceComplete = cb }) }, LoadData: class {}, LoadDataType: {} },
        './core/ConfigManager': asDefault({ getInstance: () => ({
            loadConfigs: list => list.forEach(asset => configs.set(asset.name, asset.json)),
            getConfig: name => configs.get(name), getConfigItem: () => null,
        }) }),
        './map/MapCommand': asDefault({ getInstance: () => ({ proxy: { *initMapResConfigBatched() { yield 0.5; yield 1; } } }) }),
        './map/WorldMapArt': asDefault(worldArt),
        './map/entries/SiegeAnimationLibrary': { SIEGE_SHEETS, preloadSiegeSheet: async () => [] },
        './core/AssetLoadQueue': { AssetPriority: { Background: 0 }, default: {
            pauseBackground() {},
            request(key, run) {
                backgroundJobs.push(run); backgroundKeys.push(key);
                return new Promise(resolve => backgroundResolves.set(key, resolve));
            },
            cancel(key) { cancelledKeys.push(key); backgroundResolves.get(key)?.(); },
        } },
        './common/ItemPresentation': { itemIconPath: id => `items/${id}/spriteFrame` },
        './map/ui/MapUICommand': asDefault({ getInstance: () => ({ proxy: { setBasic() {}, setAllFacilityCfg() {} } }) }),
        './login/LoginCommand': asDefault({ getInstance: () => ({
            beginMapLoading() {}, notifyClientLoaded() { loadNotices++; },
            headIcons: { initConfig() {}, preloadIcons: async () => {}, configs: [{ id: 1 }, { id: 2 }],
                getIconPath: id => `heads/${id}`, loadIcon: async () => new SpriteFrame('head') },
        }) }),
        './inventory/InventoryIconCache': asDefault({ prepare: (ids, isCurrent) => {
            inventoryCalls.push({ ids, isCurrent });
            return inventoryWarmup;
        } }),
        './chat/ChatIconCache': asDefault({ prepare: () => chatWarmup }),
        './skill/SkillCommand': asDefault({ getInstance: () => ({
            proxy: { initSkillConfig() {}, preloadSkillIcons: async () => {}, skillConfs: [{ cfgId: 101 }, { cfgId: 102 }],
                getIconPath: id => `skills/${id}`, loadSkillIcon: async () => new SpriteFrame('skill') },
        }) }),
        './build/BuildCommand': asDefault({ getInstance: () => buildings }),
        './reward/RewardCommand': asDefault({ getInstance: () => ({ setUIReady() {} }) }),
        './systemopen/SystemOpenCommand': asDefault({ getInstance: () => ({ setUIReady() {} }) }),
        './reward/RewardWindowLogic': asDefault({ init() {} }), './systemopen/SystemUnlockWindow': asDefault({ init() {} }),
    }, { ...cc, director, Director: { EVENT_AFTER_DRAW: 'after-draw' }, instantiate: () => {
        const node = new Node();
        node.getComponent = () => ({ *prepareCommonPanels() { uiWarmups++; yield; yield; yield; } });
        return node;
    } }, f.clock, true).default;
    const main = new Main();
    main.node = new Node();
    main.scheduleOnce = callback => scheduled.push(callback);
    main.addLoadingNode = () => {
        main._loadingNode = new Node();
        main._loadingNode.getComponent = () => ({ finish: cb => { finishes++; finishCallback = cb; } });
    };
    main.clearAllScene = () => {};
    f.EventMgr.on(CoreEvent.gameReady, () => uiReady++, {});
    f.EventMgr.on(LogicEvent.updateCityBuilds, main.onCityBuildsChanged, main);
    return { ...f, main, worldArt, backgroundJobs, backgroundKeys, cancelledKeys, buildings, scheduled, renderFrame, drawListeners, inventoryCalls, get uiWarmups() { return uiWarmups; }, get loadNotices() { return loadNotices; }, completeResources: () => resourceComplete(null, [], [{ json: { header: '<map orientation="isometric" width="1000" height="1000" tilewidth="200" tileheight="100">' } }, { json: { version: 1, tables: {
        Hero: Object.fromEntries(heroConfig.map(hero => [hero.Id, hero])), Item: itemConfig, Global: {}, mapRes_0: {},
    } } }]), get finishes() { return finishes; }, get uiReady() { return uiReady; }, finishFade: () => finishCallback() };
}

async function settleMap(f) {
    await flush();
    for (let i = 0; i < 16; i++) { f.main.update(); await flush(); }
}

test('world artwork starts alongside configs and map creation waits for real readiness', async () => {
    let ready;
    const f = mainFixture(Promise.resolve(), Promise.resolve(), new Promise(resolve => ready = resolve));
    f.main.onEnterMap(); f.renderFrame(); f.scheduled.shift()();
    assert.equal(f.worldArt.calls, 1, '配置尚未完成时已经准备地图美术');
    f.snapshot([]); f.completeResources();
    await settleMap(f);
    assert.equal(f.main._mapScene, null, '美术未完成时不能显示缺图地图');
    assert.equal(f.finishes, 0);
    ready(); await settleMap(f);
    assert.ok(f.main._mapScene); f.main.onMapReady(); await settleMap(f);
    assert.equal(f.finishes, 1); f.command.clearData();
});

test('late world artwork failure cannot interrupt an abandoned entry', async () => {
    let rejectArt, failures = 0;
    const f = mainFixture(Promise.resolve(), Promise.resolve(), new Promise((_, reject) => rejectArt = reject));
    f.main.failMapLoading = () => failures++;
    f.main.onEnterMap(); f.renderFrame(); f.scheduled.shift()();
    f.main.disposeLoadingNow(); rejectArt(new Error('old image request')); await flush();
    assert.equal(failures, 0); assert.equal(f.finishes, 0); f.command.clearData();
});

test('首屏就绪即可进图，武将协议提前请求，隐藏界面和整表图片不阻塞', async () => {
    const f = mainFixture(new Promise(() => {}), new Promise(() => {}));
    f.main.onEnterMap(); f.main.onEnterMap();
    assert.equal(f.sent.length, 0); assert.equal(f.drawListeners.length, 1);
    f.renderFrame(); f.scheduled.shift()();
    assert.equal(f.sent.length, 1);
    f.snapshot([{ heroId: 1001 }, { heroId: 1022 }]); f.completeResources();
    await settleMap(f); f.main.onMapReady(); await settleMap(f);
    assert.equal(f.images.length, 0, '首屏不请求全部拥有武将画像');
    assert.equal(f.inventoryCalls.length, 0, '首屏不预载物品整表');
    assert.equal(f.uiWarmups, 0, '首屏不创建隐藏窗口');
    assert.equal(f.finishes, 1); assert.equal(f.loadNotices, 1); assert.equal(f.uiReady, 0);
    f.main.onMapReady(); assert.equal(f.finishes, 1);
    f.finishFade(); assert.equal(f.uiReady, 1);
    for (const hero of heroConfig) assert.ok(f.backgroundKeys.includes(`hero-warm:${hero.Id}`), '未打开武将页也要预载完整画像');
    for (const name of SIEGE_SHEETS) assert.ok(f.backgroundKeys.includes(`siege-warm:${name}`), '攻城图集一并排入后台预载');
    for (const item of itemConfig) assert.ok(f.backgroundKeys.includes(`item-warm:items/${item.Id}/spriteFrame`));
    assert.ok(f.backgroundKeys.includes('skill-warm:skills/101'));
    assert.ok(f.backgroundKeys.includes('head-warm:heads/1'));
    assert.equal(new Set(f.backgroundKeys).size, f.backgroundKeys.length, '首页武将不重复排队');
    assert.equal(f.images.length, 0, '后台图片没有重新阻塞首屏');
    f.main.disposeLoadingNow();
    assert.deepEqual(f.cancelledKeys.sort(), f.backgroundKeys.slice().sort(), '退出登录撤销所有未开始的图片预取');
    await Promise.all(f.backgroundJobs.map(run => run()));
    assert.equal(f.images.length, 0, '退出后不执行旧会话背景预取');
    f.command.clearData();
});

test('当前视野图片未就绪时保留遮罩，但仍能先取得服务器主城状态', async () => {
    const f = mainFixture();
    f.worldArt.visibleState.pending = 2;
    f.main.onEnterMap(); f.renderFrame(); f.scheduled.shift()(); f.snapshot([]); f.completeResources();
    await settleMap(f); f.main.onMapReady(); await settleMap(f);
    assert.equal(f.loadNotices, 1); assert.equal(f.finishes, 0);
    f.worldArt.visibleState.pending = 0; await settleMap(f);
    assert.equal(f.finishes, 1); assert.equal(f.loadNotices, 1);
    f.finishFade(); assert.equal(f.uiReady, 1); f.command.clearData();
});

test('当前视野资源失败可退出重试，取消进图后的淡出回调不激活旧界面', async () => {
    const f = mainFixture(); let failed = 0;
    f.main.failMapLoading = () => { failed++; f.main.disposeLoadingNow(); };
    f.main.onEnterMap(); f.renderFrame(); f.scheduled.shift()(); f.snapshot([]); f.completeResources();
    await settleMap(f);
    f.worldArt.visibleState.error = new Error('missing current city');
    f.main.onMapReady(); await settleMap(f);
    assert.equal(failed, 1); assert.equal(f.finishes, 0); assert.equal(f.uiReady, 0);
    f.command.clearData();
    const g = mainFixture();
    g.main.onEnterMap(); g.renderFrame(); g.scheduled.shift()(); g.snapshot([]); g.completeResources();
    await settleMap(g); g.main.onMapReady(); await settleMap(g);
    assert.equal(g.finishes, 1);
    g.main.disposeLoadingNow(); g.finishFade();
    assert.equal(g.uiReady, 0); assert.equal(g.backgroundJobs.length, 0);
    g.command.clearData();
});

function inventoryArtFixture() {
    const clock = new Clock(), images = [], cache = new Map();
    const engine = { ...cc, resources: {
        get: url => cache.get(url),
        load: (url, type, callback) => images.push({ url, callback }),
    } };
    const presentation = load('assets/scripts/common/ItemPresentation.ts', {
        '../core/ConfigManager': asDefault({ getInstance: () => ({ getConfig: () => itemConfig }) }),
        '../utils/ConfigIcon': load('assets/scripts/utils/ConfigIcon.ts'),
    });
    const Art = load('assets/scripts/inventory/InventoryIconCache.ts', {
        '../common/ItemPresentation': presentation,
    }, engine, clock).default;
    const frame = url => Object.assign(new SpriteFrame(url), { refs: 0, addRef() { this.refs++; } });
    const complete = image => {
        const value = frame(image.url); cache.set(image.url, value); image.callback(null, value); return value;
    };
    return { Art, images, clock, cache, complete, frame, presentation };
}

test('物品图全表预载限制四路并发，共享请求，打开时可同步取图且只持有一次', async () => {
    const f = inventoryArtFixture(), ids = itemConfig.map(row => row.Id);
    const first = f.Art.load(ids[0]);
    assert.equal(f.Art.load(ids[0]), first);
    let done = false, loaded = 0;
    const preparation = f.Art.prepare([...ids, ...ids]).then(() => done = true);
    while (!done) {
        assert.ok(f.images.length > 0 && f.images.length <= 4);
        const batch = f.images.splice(0); loaded += batch.length;
        batch.forEach(f.complete); await flush();
    }
    await preparation;
    assert.equal(loaded, ids.length);
    for (const id of ids) {
        const frame = f.Art.get(id);
        assert.ok(frame); assert.equal(f.Art.isReady(id), true);
        assert.equal(await f.Art.load(id), frame); assert.equal(frame.refs, 1);
    }
    await f.Art.prepare(ids);
    assert.equal(f.images.length, 0); assert.equal(f.clock.timers.size, 0);
    assert.equal(f.Art.isReady(999999), true, '没有图片配置的物品使用固定文字图标');
});

test('物品图超时与失败可重试，迟到回调不覆盖新图，取消后不继续排队加载', async () => {
    const f = inventoryArtFixture();
    const stalled = f.Art.load(1), stale = f.images.shift();
    f.clock.tick(8000); assert.equal(await stalled, null);
    const retry = f.Art.load(1), value = f.complete(f.images.shift());
    assert.equal(await retry, value);
    stale.callback(null, f.frame('stale'));
    assert.equal(f.Art.get(1), value);
    const failed = f.Art.prepare([2]);
    const rejected = assert.rejects(failed, /背包图标未就绪/);
    f.images.shift().callback(new Error('missing'), null); await rejected;
    const recovered = f.Art.prepare([2]); f.complete(f.images.shift()); await recovered;
    let current = true;
    const cancelled = f.Art.prepare(itemConfig.map(row => row.Id), () => current);
    await flush(); assert.equal(f.images.length, 4);
    current = false; f.images.splice(0).forEach(f.complete); await cancelled;
    assert.equal(f.images.length, 0); assert.equal(f.clock.timers.size, 0);
});

test('主城真实等级到达前保留遮罩，重复刷新不重发加载通知，回包后仅退出一次', async () => {
    const f = mainFixture(); f.buildings.loaded = false;
    f.main.onEnterMap(); f.renderFrame(); f.scheduled.shift()();
    f.snapshot([]); f.completeResources();
    for (let i = 0; i < 10; i++) f.main.update();
    f.main.onMapReady(); await settleMap(f);
    assert.equal(f.loadNotices, 1);
    assert.equal(f.finishes, 0, '不能先显示默认城池');
    assert.equal(f.uiReady, 0);
    f.EventMgr.emit(LogicEvent.updateCityBuilds);
    assert.equal(f.loadNotices, 1); assert.equal(f.finishes, 0);
    f.buildings.loaded = true;
    f.EventMgr.emit(LogicEvent.updateCityBuilds);
    f.EventMgr.emit(LogicEvent.updateCityBuilds);
    assert.equal(f.finishes, 0, '同一建筑事件先应用城图，再开始淡出');
    while (f.scheduled.length) f.scheduled.shift().call(f.main);
    assert.equal(f.finishes, 1); assert.equal(f.uiReady, 0);
    f.finishFade();
    assert.equal(f.uiReady, 1); assert.equal(f.clock.timers.size, 0);
    f.command.clearData();
});

test('主城资料超时不会卡死加载页，取消进场后迟到的建筑回包不能打开地图', async () => {
    const f = mainFixture(); f.buildings.loaded = false;
    let failed = 0;
    f.main.failMapLoading = () => { failed++; f.main.disposeLoadingNow(); };
    f.main.onEnterMap(); f.renderFrame(); f.scheduled.shift()();
    f.snapshot([]); f.completeResources();
    for (let i = 0; i < 10; i++) f.main.update();
    f.main.onMapReady(); await settleMap(f);
    f.clock.tick(12000);
    assert.equal(failed, 1); assert.equal(f.finishes, 0);
    assert.equal(f.clock.timers.size, 0);
    f.buildings.loaded = true; f.EventMgr.emit(LogicEvent.updateCityBuilds);
    assert.equal(f.finishes, 0); assert.equal(f.uiReady, 0);
    f.command.clearData();
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
