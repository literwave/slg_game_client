// 用项目真实 protobuf 编解码验证部队协议；网络和 Cocos 界面边界在内存中隔离。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const scripts = path.join(root, 'assets/scripts');
const protobuf = require(path.join(scripts, '3rd/protobuf.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const protocolIds = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define;
let passed = 0;

function harness() {
    const cache = new Map(), timers = new Map(), sent = [], toasts = [], notifications = [], layouts = [];
    let timerId = 0, failSend = false, facilityRequests = 0, additionReads = 0;
    const role = { soldierInfo: { count: 0, hurtCount: 0 } };
    class Component { constructor() { this.isValid = true; this.node = { active: true }; } }
    class Label { constructor() { this.string = ''; this.node = { active: true }; } }
    class Node {}
    Node.EventType = {};
    const cc = {
        Component, Label, Node, Prefab: class {}, EditBox: class {}, Slider: class {},
        Sprite: class {}, ProgressBar: class {}, ScrollView: class {}, UITransform: class {},
        _decorator: { ccclass: () => target => target, property: () => () => {} },
        view: { on() {}, off() {}, getVisibleSize: () => ({ width: 1280, height: 720 }) },
    };
    const heroes = new Map([1001, 1002, 1003, 1004].map(id => [id, {
        hero_type: id, heroId: id, cfgId: id, level: 1,
        config: { name: '武将' + id, speed: 3, attack: 100 },
    }]));
    const generals = {
        proxy: {
            getMyGeneral: id => heroes.get(id),
            getGeneralCfg: id => heroes.get(id)?.config,
            getMyActiveGeneralCnt: () => heroes.size,
            getUseGenerals: () => Array.from(heroes.values()),
        },
        isProtocolAvailable: name => !!proto.getIdByMsgType(name),
        qryMyGenerals() {},
    };
    const stubs = {
        'general/GeneralCommand': { default: { getInstance: () => generals } },
        'network/socket/NetManager': { NetManager: { getInstance: () => ({
            send(packet) {
                if (failSend) throw new Error('模拟发送失败');
                const data = proto.decode(packet.name, packet.msg);
                if (packet.name === 'World.c2s_edit_troop') {
                    // 服务端 troop/mgr.lua 拒绝 pos < 1 或 pos > get_troop_pos_cnt()。
                    for (const key of Object.keys(data.troopInfo.posMap || {})) {
                        assert.ok(Number(key) >= 1 && Number(key) <= 3, '服务端会拒绝站位 ' + key);
                    }
                }
                sent.push({ name: packet.name, bytes: packet.msg, data });
            },
        }) } },
        'general/ArmyCommand': { default: { getInstance: () => ({ proxy: { getArmyByOrder: () => null } }) } },
        'general/ArmyProxy': { ArmyCmd: { Idle: 0, Conscript: 1 } },
        'map/MapCommand': { default: { getInstance: () => ({
            cityProxy: { getMyCityById: () => null, getMyMainCity: () => null },
        }) } },
        'map/ui/MapUICommand': { default: { getInstance: () => ({
            proxy: {
                getMyFacilitys: () => undefined,
                getMyCityAddition: () => { additionReads++; return { armyCnt: 0, vanguardCnt: 0 }; },
            },
            qryCityFacilities: () => facilityRequests++,
        }) } },
        'login/LoginCommand': { default: { getInstance: () => ({ proxy: { getRoleData: () => role } }) } },
        'common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
        'utils/DateUtil': { default: {} },
        'utils/ListLogic': { default: class {} },
        'map/ui/GeneralHeadLogic': { default: class {} },
        'map/ui/GeneralListSkin': { applyGeneralListSkin(root, count, type, refreshList) {
            layouts.push({ count, type, refreshList });
        } },
        'map/ui/RightHudSkin': {},
        'map/ui/TroopPanelSkin': { styleTroopPanel() {}, styleTroopCard() {} },
    };
    function load(name) {
        if (name.endsWith('.js')) return { default: require(path.resolve(scripts, name)) };
        const file = path.resolve(scripts, name.endsWith('.ts') ? name : name + '.ts');
        const key = path.relative(scripts, file).replace(/\\/g, '/').replace(/\.ts$/, '');
        if (stubs[key]) return stubs[key];
        if (cache.has(file)) return cache.get(file).exports;
        const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        } }).outputText;
        const module = { exports: {} };
        cache.set(file, module);
        vm.runInNewContext(output, {
            module, exports: module.exports, protobuf,
            console: { log() {}, warn() {}, error() {} },
            setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
            clearTimeout: id => timers.delete(id),
            require: specifier => specifier === 'cc' ? cc
                : load(path.relative(scripts, path.resolve(path.dirname(file), specifier))),
        }, { filename: file });
        return module.exports;
    }
    const proto = load('network/pto/ProtoManager').ProtoManager.getInstance();
    const protoDir = path.join(root, 'assets/resources/protbuf/pto');
    for (const file of fs.readdirSync(protoDir).filter(name => name.endsWith('.proto'))) {
        proto.mergeRoot(proto._root, protobuf.parse(fs.readFileSync(path.join(protoDir, file), 'utf8')).root);
    }
    proto.parseIdMap(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define);
    proto._isReady = true;
    const events = load('utils/EventMgr').EventMgr;
    const server = load('config/ServerConfig').ServerConfig;
    const logic = load('common/LogicEvent').LogicEvent;
    const net = load('network/socket/NetInterface').NetEvent;
    const command = load('general/TroopCommand').default.getInstance();
    events.on(logic.showToast, text => toasts.push(text), toasts);
    for (const name of [logic.updateTroop, logic.updateTroopList, logic.troopEditState, logic.troopEditSubmitted]) {
        events.on(name, () => notifications.push(name), notifications);
    }
    function receive(name, data) { events.emit(name, proto.decode(name, proto.encode(name, data))); }
    function authenticate() { events.emit(server.s2c_user_login_ok, { userId: 1 }); }
    function ready(list = []) {
        authenticate();
        command.requestTroops();
        receive(server.s2c_req_troop, { troopList: list });
    }
    function expire() {
        const entry = timers.entries().next().value;
        assert.ok(entry, '应存在待处理超时');
        timers.delete(entry[0]);
        entry[1]();
    }
    function createSettings(order = 1) {
        const Settings = load('map/ui/CityArmySettingLogic').default;
        const settings = new Settings();
        for (const name of ['labelId', 'labelCost', 'labelSoldierCnt', 'labelAddition', 'labelSpeed', 'labelAtkCity', 'labelResCost']) {
            settings[name] = new Label();
        }
        settings.tipNodes = [0, 1, 2].map(() => ({ active: true }));
        settings.editBoxs = [0, 1, 2].map(() => ({ string: '', node: { active: false } }));
        settings.sliders = [0, 1, 2].map(() => ({ progress: 0, node: { active: false } }));
        settings._gengeralLogics = [0, 1, 2].map(() => ({ setData(...args) { this.args = args; } }));
        settings.onEnable();
        settings.setData(0, order);
        return settings;
    }
    return { load, proto, events, server, logic, net, command, sent, toasts, notifications, layouts,
        timers, receive, authenticate, ready, expire, createSettings, heroes, role,
        set failSend(value) { failSend = value; },
        get facilityRequests() { return facilityRequests; },
        get additionReads() { return additionReads; } };
}

function test(name, run) {
    run();
    passed++;
    console.log('PASS ' + name);
}

test('登录/创建阶段不请求部队，打开编队才请求且合并重复查询', () => {
    const h = harness();
    h.authenticate();
    assert.equal(h.sent.length, 0);
    assert.equal(h.command.listReady, false);
    h.command.requestTroops();
    assert.equal(h.command.listLoading, true);
    h.command.requestTroops();
    assert.equal(h.sent.length, 1);
    assert.equal(h.proto.getIdByMsgType(h.sent[0].name), protocolIds.World.c2s_req_troop);
    h.receive(h.server.s2c_req_troop, { troopList: [] });
    assert.equal(h.command.listReady, true);
    assert.equal(h.command.listLoading, false);
    h.command.requestTroops();
    assert.equal(h.sent.length, 1);
    assert.equal(h.timers.size, 0);
});

test('真实 World 编解码：界面三槽映射协议 1/2/3 站位，回包前不修改数据', () => {
    const h = harness();
    h.ready();
    let updated = null;
    h.events.on(h.logic.updateTroop, troop => updated = troop, h);
    assert.equal(h.command.editTroop(2, { 1001: 0, 1002: 1, 1003: 2 }), true);
    const packet = h.sent.at(-1);
    assert.equal(h.proto.getIdByMsgType(packet.name), protocolIds.World.c2s_edit_troop);
    assert.deepEqual(plain(packet.data), { troopInfo: { troopIdx: 2, posMap: { 1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } }, 2: { heroIdx: 1002, soldier: { count: 0, hurtCount: 0 } }, 3: { heroIdx: 1003, soldier: { count: 0, hurtCount: 0 } } } } });
    assert.equal(h.command.proxy.getTroop(2), null);
    h.receive(h.server.s2c_edit_troop, packet.data);
    assert.equal(h.proto.getIdByMsgType(h.server.s2c_edit_troop), protocolIds.World.s2c_edit_troop);
    assert.equal(h.command.editingTroopIdx, 0);
    assert.equal(updated.getHeroIdxAt(0), 1001);
    assert.deepEqual(plain(updated.getHeroMap()), { 1001: 0, 1002: 1, 1003: 2 });
    assert.ok(h.notifications.includes(h.logic.updateTroopList));
    assert.equal(h.toasts.length, 0, '编队成功静默刷新，不弹保存成功提示');
});

test('服务端第三站位和稀疏阵容准确还原，导出时保持 1～3；拒绝非法零号站位', () => {
    const h = harness();
    const posMap = { 3: { heroIdx: 1003, soldier: { count: 80, hurtCount: 9 } } };
    h.ready([{ troopIdx: 1, posMap }]);
    const troop = h.command.proxy.getTroop(1);
    assert.equal(troop.getHeroIdxAt(0), 0);
    assert.equal(troop.getHeroIdxAt(1), 0);
    assert.equal(troop.getHeroIdxAt(2), 1003);
    assert.deepEqual(plain(troop.getPosMap()), posMap);
    assert.equal(h.command.editTroop(1, troop.getHeroMap()), true);
    assert.deepEqual(plain(h.sent.at(-1).data.troopInfo.posMap), posMap);
    const { TroopData } = h.load('general/TroopProxy');
    const invalid = TroopData.createFromServer({ troopIdx: 2, posMap: {
        0: { heroIdx: 1001 }, 4: { heroIdx: 1002 }, ...posMap,
    } });
    assert.deepEqual(plain(invalid.getHeroMap()), { 1003: 2 });
    invalid.setHero(1004, 3);
    assert.equal(invalid.hasHero(1004), false);
});

test('首尾换位时可用兵和伤兵跟随武将，ACK 和同步推送均正确还原', () => {
    const h = harness();
    h.ready([{ troopIdx: 1, posMap: {
        1: { heroIdx: 1001, soldier: { count: 120, hurtCount: 3 } },
        3: { heroIdx: 1003, soldier: { count: 440, hurtCount: 5 } },
    } }]);
    assert.equal(h.command.editTroop(1, { 1001: 2, 1003: 0 }), true);
    const packet = h.sent.at(-1).data;
    assert.deepEqual(plain(packet.troopInfo.posMap), {
        1: { heroIdx: 1003, soldier: { count: 440, hurtCount: 5 } },
        3: { heroIdx: 1001, soldier: { count: 120, hurtCount: 3 } },
    });
    h.receive(h.server.s2c_edit_troop, packet);
    assert.equal(h.command.proxy.getTroop(1).getHeroIdxAt(0), 1003);
    assert.equal(h.command.proxy.getTroop(1).getHeroIdxAt(2), 1001);
    h.receive(h.server.s2c_sync_troop, { troopInfo: { troopIdx: 1,
        posMap: { 3: { heroIdx: 1001, soldier: { count: 90, hurtCount: 33 } } } } });
    const troop = h.command.proxy.getTroop(1);
    assert.equal(troop.getHeroIdxAt(0), 0);
    assert.equal(troop.getHeroIdxAt(2), 1001);
    assert.deepEqual(plain(troop.getSoldier(1001)), { count: 90, hurtCount: 33 });
});

test('配置页上阵、替换和下阵共用协议，空 map 能清空最后一名武将', () => {
    const h = harness();
    h.ready([{ troopIdx: 1, posMap: { 1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } }, 2: { heroIdx: 1002, soldier: { count: 0, hurtCount: 0 } } } }]);
    const settings = h.createSettings();
    settings.onChooseGeneral(null, { heroId: 1003 }, 0);
    assert.deepEqual(plain(h.sent.at(-1).data.troopInfo.posMap), { 1: { heroIdx: 1003, soldier: { count: 0, hurtCount: 0 } }, 2: { heroIdx: 1002, soldier: { count: 0, hurtCount: 0 } } });
    assert.equal(settings.labelCost.string, '编队保存中…');
    h.receive(h.server.s2c_edit_troop, h.sent.at(-1).data);
    assert.equal(settings._gengeralLogics[0].args[2].hero_type, 1003);
    const Item = h.load('map/ui/CityGeneralItemLogic').default;
    const item = new Item();
    item._order = 1;
    item._data = h.heroes.get(1003);
    item.onClickDown();
    assert.deepEqual(plain(h.sent.at(-1).data.troopInfo.posMap), { 2: { heroIdx: 1002, soldier: { count: 0, hurtCount: 0 } } });
    h.receive(h.server.s2c_edit_troop, h.sent.at(-1).data);
    item._data = h.heroes.get(1002);
    item.onClickDown();
    assert.deepEqual(plain(h.sent.at(-1).data.troopInfo.posMap), {});
    assert.equal(h.command.proxy.getTroop(1).getHeroCount(), 1);
    h.receive(h.server.s2c_edit_troop, h.sent.at(-1).data);
    assert.equal(h.command.proxy.getTroop(1).getHeroCount(), 0);
    assert.equal(settings.labelCost.string, '上阵 0/3');
});

test('拒绝无效 ID、越界位置、位置冲突、未拥有武将及跨队重复上阵', () => {
    const h = harness();
    h.ready([{ troopIdx: 2, posMap: { 1: { heroIdx: 1004, soldier: { count: 0, hurtCount: 0 } } } }]);
    for (const [index, map] of [
        [0, {}], [-1, {}], [1.5, {}], [2 ** 32, {}], [1, null],
        [1, { 1001: -1 }], [1, { 1001: 3 }], [1, { 1001: 0.5 }],
        [1, { 1001: 0, 1002: 0 }], [1, { 1001: 0, '01001': 1 }],
        [1, { '-1': 0 }], [1, { 9999: 0 }], [1, { 1004: 0 }],
    ]) assert.equal(h.command.editTroop(index, map), false);
    assert.equal(h.sent.length, 1);
    assert.equal(h.command.editingTroopIdx, 0);
});

test('等待完整快照和编辑回包期间不允许覆盖旧阵容，也不重复发送', () => {
    const h = harness();
    h.authenticate();
    assert.equal(h.command.editTroop(1, { 1001: 0 }), false);
    assert.equal(h.sent.length, 1);
    h.receive(h.server.s2c_req_troop, { troopList: [] });
    assert.equal(h.command.editTroop(1, { 1001: 0 }), true);
    assert.equal(h.command.editTroop(1, { 1002: 1 }), false);
    assert.equal(h.command.editTroop(2, { 1002: 0 }), false);
    assert.equal(h.command.requestTroops(true), false);
    h.receive(h.server.s2c_edit_troop, { troopInfo: { troopIdx: 2, posMap: { 1: { heroIdx: 1003, soldier: { count: 0, hurtCount: 0 } } } } });
    assert.equal(h.command.editingTroopIdx, 1, '其他部队更新不能解除当前保存状态');
    h.receive(h.server.s2c_edit_troop, { troopInfo: { troopIdx: 1, posMap: { 1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } } } } });
    assert.equal(h.command.editTroop(1, { 1001: 0, 1002: 1 }), true);
});

test('超时后重新查询，取得服务器快照后才能继续编辑，不自动重发写请求', () => {
    const h = harness();
    h.ready();
    h.command.editTroop(1, { 1001: 0 });
    h.expire();
    assert.equal(h.command.editingTroopIdx, 0);
    assert.equal(h.sent.at(-1).name, h.server.c2s_req_troop);
    assert.equal(h.command.editTroop(1, { 1002: 1 }), false);
    h.expire();
    assert.equal(h.command.editTroop(1, { 1002: 1 }), false);
    h.receive(h.server.s2c_req_troop, { troopList: [{ troopIdx: 1, posMap: { 1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } } } }] });
    assert.equal(h.command.editTroop(1, { 1001: 0, 1002: 1 }), true);
    assert.equal(h.sent.filter(p => p.name === h.server.c2s_edit_troop).length, 2);
});

test('协议未就绪、编码失败或发送异常不关闭选将页、不残留保存状态', () => {
    for (const failure of ['protocol', 'encode', 'send']) {
        const h = harness();
        h.ready();
        const List = h.load('map/ui/GeneralListLogic').default;
        const list = new List();
        list._type = 1;
        list.onEnable();
        if (failure === 'protocol') h.proto._isReady = false;
        if (failure === 'encode') h.proto.encode = () => null;
        if (failure === 'send') h.failSend = true;
        assert.equal(h.command.editTroop(1, { 1001: 0 }), false);
        assert.equal(list.node.active, true);
        assert.equal(h.command.editingTroopIdx, 0);
        assert.equal(h.timers.size, 0);
        assert.equal(h.notifications.includes(h.logic.troopEditSubmitted), false);
    }
});

test('错误回包和缺少 troopInfo 不清空原阵容，重新同步后允许重试', () => {
    for (const response of [{}, { troopInfo: null }, { code: 1, msg: { troopInfo: { troopIdx: 1 } } }]) {
        const h = harness();
        h.ready([{ troopIdx: 1, posMap: { 1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } } } }]);
        h.command.editTroop(1, {});
        h.events.emit(h.server.s2c_edit_troop, response);
        assert.equal(h.command.proxy.getTroop(1).getHeroIdxAt(0), 1001);
        assert.equal(h.command.editingTroopIdx, 0);
        assert.equal(h.sent.at(-1).name, h.server.c2s_req_troop);
    }
});

test('断线后禁止写入，重登只查询；退出清理定时器并忽略迟到回包', () => {
    const h = harness();
    h.ready();
    h.command.editTroop(1, { 1001: 0 });
    h.events.emit(h.net.ServerDisconnected);
    assert.equal(h.command.editTroop(1, { 1002: 0 }), false);
    assert.equal(h.timers.size, 0);
    h.receive(h.server.s2c_edit_troop, { troopInfo: { troopIdx: 1, posMap: { 1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } } } } });
    assert.equal(h.command.proxy.getTroop(1), null);
    h.authenticate();
    assert.equal(h.sent.at(-1).name, h.server.c2s_req_troop);
    assert.equal(h.sent.filter(p => p.name === h.server.c2s_edit_troop).length, 1);
    h.command.clearData();
    h.receive(h.server.s2c_req_troop, { troopList: [{ troopIdx: 1, posMap: { 1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } } } }] });
    assert.equal(h.command.proxy.getTroops().length, 0);
    assert.equal(h.timers.size, 0);
});

test('没有旧主城和设施也能打开编队、上阵；三队翻页有边界', () => {
    const h = harness();
    h.ready();
    const RightItem = h.load('map/ui/RightArmyItemLogic').default;
    const item = new RightItem();
    item._troop = { troopIdx: 1 };
    item.order = 1;
    let args;
    h.events.on(h.logic.openArmySetting, (...value) => args = value, h);
    item.onClickSetting();
    assert.deepEqual(args, [0, 1]);
    const settings = h.createSettings();
    assert.equal(settings._isUnlock, true);
    assert.ok(settings._gengeralLogics.every(slot => slot.args[7] === true));
    assert.equal(h.facilityRequests, 0);
    assert.equal(h.additionReads, 0, '不读取默认 armyCnt=0 导致上阵锁定');
    settings.onClickPrev();
    assert.equal(settings._order, 3);
    settings.onClickNext();
    assert.equal(settings._order, 1);
    assert.doesNotThrow(() => settings.onClickQuick());
});

test('初始列表回包刷新配置页；选将动态排除已编队武将，失败保留、发送成功关闭', () => {
    const h = harness();
    h.authenticate();
    const settings = h.createSettings();
    h.receive(h.server.s2c_req_troop, { troopList: [{ troopIdx: 1, posMap: { 1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } } } }] });
    assert.equal(settings._gengeralLogics[0].args[2].hero_type, 1001);
    const List = h.load('map/ui/GeneralListLogic').default;
    const list = new List();
    let rendered = [];
    list.scrollView = { node: { getComponent: () => ({ setData: data => rendered = data }) } };
    list.onEnable();
    list.setData([1001, 1002], 1, 1);
    assert.deepEqual(Array.from(rendered, x => x.hero_type), [1002, 1003, 1004], '不沿用过期排除名单');
    h.receive(h.server.s2c_edit_troop, { troopInfo: { troopIdx: 2, posMap: { 1: { heroIdx: 1002, soldier: { count: 0, hurtCount: 0 } } } } });
    assert.deepEqual(Array.from(rendered, x => x.hero_type), [1003, 1004]);
    h.events.emit(h.logic.chosedGeneral, null, h.heroes.get(1002), 1);
    assert.equal(list.node.active, true);
    h.events.emit(h.logic.chosedGeneral, null, h.heroes.get(1003), 1);
    assert.equal(list.node.active, false);
    assert.deepEqual(plain(h.sent.at(-1).data.troopInfo.posMap), { 1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } }, 2: { heroIdx: 1003, soldier: { count: 0, hurtCount: 0 } } });
    h.receive(h.server.s2c_edit_troop, h.sent.at(-1).data);
    assert.equal(settings.labelCost.string, '上阵 2/3');
});

test('打开选将只应用一次新布局；后台更新保留滚动位置并复用布局', () => {
    const h = harness();
    h.ready();
    const List = h.load('map/ui/GeneralListLogic').default;
    const list = new List(), renders = [];
    list.scrollView = { node: { getComponent: () => ({
        setData: (data, offset, relayout) => renders.push({ data, offset, relayout }),
    }) } };
    list.onEnable();
    assert.equal(h.layouts.length, 0, '打开时不能先重画上一轮的列表');
    list.setData([], 1, 0);
    assert.equal(renders.length, 1);
    assert.equal(renders[0].offset, undefined);
    assert.equal(renders[0].relayout, true);
    assert.equal(h.layouts.length, 1);
    assert.equal(h.layouts[0].refreshList, false, '皮肤设置不能额外刷新旧列表');
    h.events.emit(h.logic.updateTroopList);
    assert.equal(renders.length, 2);
    assert.equal(renders[1].offset, 0, '后台同步不能打断当前滚动位置');
    assert.equal(renders[1].relayout, false);
    assert.equal(h.layouts.length, 1, '尺寸、数量和模式未变时复用排版');
});

test('主城部队面板读取 World 快照，三队可打开，编队更新和清空即时刷新', () => {
    const h = harness();
    h.authenticate();
    const City = h.load('map/ui/CityAboutLogic').default;
    const Card = h.load('map/ui/CityArmyItemLogic').default;
    const city = new City();
    city.initView = () => {};
    city._armyComps = [1, 2, 3].map(order => {
        const card = new Card(); card.order = order;
        for (const name of ['tipNode', 'infoNode', 'maskNode']) card[name] = { active: true };
        for (const name of ['labelTip', 'labelId', 'labelState', 'labelLv', 'labelName', 'labelArms', 'labelSoldierCnt', 'labelVice1', 'labelVice2']) card[name] = new (class { string = ''; })();
        card.headIcon = { node: { active: true }, getComponent: () => ({ setHeadId(id) { card.portraitId = id; } }) };
        return card;
    });
    city.onEnable(); city.setData({ cityId: 7 });
    assert.equal(city._armyCnt, 3);
    assert.equal(h.additionReads, 0, '新城建没有旧 armyCnt 加成，不能据此锁定编队');
    assert.ok(city._armyComps.every(card => !card.maskNode.active && card.labelTip.string === '点击编制队伍'));
    assert.equal(h.sent.at(-1).name, h.server.c2s_req_troop);
    let settingArgs;
    h.events.on(h.logic.openArmySetting, (...args) => settingArgs = args, h);
    city._armyComps[2].onClickItem();
    assert.deepEqual(settingArgs, [7, 3]);
    h.receive(h.server.s2c_req_troop, { troopList: [{ troopIdx: 3, posMap: {
        1: { heroIdx: 1001, soldier: { count: 50, hurtCount: 3 } },
        3: { heroIdx: 1003, soldier: { count: 80, hurtCount: 9 } },
    } }] });
    const card = city._armyComps[2];
    assert.equal(card.infoNode.active, true);
    assert.equal(card.labelName.string, '武将1001');
    assert.equal(card.labelVice1.string, '无');
    assert.equal(card.labelVice2.string, '武将1003');
    assert.equal(card.labelSoldierCnt.string, '130（伤兵 12）');
    assert.equal(card.portraitId, 1001);
    h.receive(h.server.s2c_sync_troop, { troopInfo: { troopIdx: 3, posMap: {
        3: { heroIdx: 1003, soldier: { count: 70, hurtCount: 19 } },
    } } });
    assert.equal(card.labelName.string, '主将未上阵');
    assert.equal(card.headIcon.node.active, false);
    h.receive(h.server.s2c_edit_troop, { troopInfo: { troopIdx: 3, posMap: {} } });
    assert.equal(card.infoNode.active, false);
    assert.equal(card.labelTip.string, '点击编制队伍');
    city.onDisable();
    assert.equal(h.additionReads, 0);
});

test('新协议主城不依赖旧 ArmyData：快速分兵守恒、保留伤兵，收到回包才更新', () => {
    const h = harness();
    h.role.soldierInfo = { count: 1001, hurtCount: 200 };
    h.ready([{ troopIdx: 1, posMap: {
        1: { heroIdx: 1001, soldier: { count: 50, hurtCount: 17 } },
        3: { heroIdx: 1002, soldier: { count: 80, hurtCount: 9 } },
    } }]);
    const settings = h.createSettings();
    assert.equal(settings.editBoxs[0].enabled, true);
    settings.onClickQuick();
    assert.deepEqual(plain(settings._curConscripts), [501, 0, 500]);
    settings.onClickSure();
    const packet = h.sent.at(-1);
    assert.equal(packet.name, h.server.c2s_edit_troop);
    assert.deepEqual(plain(packet.data.troopInfo.posMap), {
        1: { heroIdx: 1001, soldier: { count: 551, hurtCount: 17 } },
        3: { heroIdx: 1002, soldier: { count: 580, hurtCount: 9 } },
    });
    assert.equal(h.command.proxy.getTroop(1).getSoldier(1001).count, 50);
    const sentCount = h.sent.length;
    settings.onClickSure();
    assert.equal(h.sent.length, sentCount, '等待回包时不重复提交');
    h.role.soldierInfo.count = 0;
    h.events.emit(h.logic.updateSoldier);
    h.receive(h.server.s2c_edit_troop, packet.data);
    assert.deepEqual(plain(settings._curConscripts), [0, 0, 0]);
    assert.equal(h.command.proxy.getTroop(1).getSoldier(1001).count, 551);
    assert.equal(settings.sliders[0].progress, 0);
    assert.equal(settings.editBoxs[0].enabled, false);
});

test('手动分兵处理空值/负数且多将不能超用城中兵力，切队清空草稿', () => {
    const h = harness();
    h.role.soldierInfo.count = 100;
    h.ready([{ troopIdx: 1, posMap: {
        1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } },
        2: { heroIdx: 1002, soldier: { count: 0, hurtCount: 0 } },
    } }]);
    const settings = h.createSettings();
    settings.setCurConscriptForIndex(0, NaN);
    settings.setCurConscriptForIndex(1, -20);
    assert.deepEqual(plain(settings._curConscripts), [0, 0, 0]);
    settings.setCurConscriptForIndex(0, 75);
    settings.setCurConscriptForIndex(1, 100);
    assert.deepEqual(plain(settings._curConscripts), [75, 25, 0]);
    settings.onClickNext();
    assert.deepEqual(plain(settings._curConscripts), [0, 0, 0]);
    assert.ok(settings.editBoxs.every(edit => edit.string === '0'));
    assert.ok(settings.sliders.every(slider => Number.isFinite(slider.progress)));
});

test('无武将/无兵力明确提示；发送失败解除锁定，草稿可重试', () => {
    const h = harness();
    h.ready();
    const settings = h.createSettings();
    settings.onClickQuick();
    assert.match(h.toasts.at(-1), /先选择/);
    h.receive(h.server.s2c_sync_troop, { troopInfo: { troopIdx: 1,
        posMap: { 1: { heroIdx: 1001, soldier: { count: 0, hurtCount: 0 } } } } });
    settings.onClickQuick();
    assert.match(h.toasts.at(-1), /暂无/);
    h.role.soldierInfo.count = 80;
    h.events.emit(h.logic.updateMyRole);
    assert.equal(settings.editBoxs[0].enabled, true, '角色基础信息晚到也会刷新可用兵力');
    settings.onClickQuick();
    h.failSend = true;
    settings.onClickSure();
    assert.equal(h.command.editingTroopIdx, 0);
    assert.equal(settings.editBoxs[0].enabled, true);
    assert.equal(settings._curConscripts[0], 80);
});

console.log('Troop integration: ' + passed + ' checks passed.');
process.exit(0);
