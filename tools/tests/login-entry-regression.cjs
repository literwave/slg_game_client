// Login/create timing tests: no live account or server mutation is performed here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
process.on('uncaughtException', error => { console.error(error); process.exit(1); });
const engine = {
    Component: class {},
    Node: { EventType: { SIZE_CHANGED: 'size' } },
    Tween: { stopAllByTarget() {} },
    _decorator: { ccclass: () => type => type, property: () => () => {} },
};
const asDefault = value => ({ default: value });
function load(file, imports = {}) {
    const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        fileName: file, reportDiagnostics: true, compilerOptions: {
            target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        },
    });
    assert.equal(result.diagnostics.length, 0, file);
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', result.outputText)(id => {
        if (id === 'cc') return engine;
        if (Object.hasOwn(imports, id)) return imports[id];
        throw new Error(`Unmocked dependency ${file}: ${id}`);
    }, mod, mod.exports);
    return mod.exports;
}
const { LogicEvent } = load('assets/scripts/common/LogicEvent.ts');
const { ServerConfig } = load('assets/scripts/config/ServerConfig.ts');
const netInterface = load('assets/scripts/network/socket/NetInterface.ts');
const proxyModule = load('assets/scripts/login/LoginProxy.ts');
function fixture() {
    const { EventMgr } = load('assets/scripts/utils/EventMgr.ts');
    const sent = [];
    let systemRequests = 0;
    const Command = load('assets/scripts/login/LoginCommand.ts', {
        './LoginProxy': proxyModule,
        '../config/ServerConfig': { ServerConfig }, '../utils/EventMgr': { EventMgr },
        '../common/LogicEvent': { LogicEvent }, '../network/socket/NetInterface': netInterface,
        '../network/socket/NetManager': { NetManager: { getInstance: () => ({ send: data => sent.push(data) }) } },
        '../network/pto/ProtoManager': { ProtoManager: { getInstance: () => ({
            encode: (_, data) => data, isReady: () => true, getIdByMsgType: () => 1,
        }) } },
        './HeadIconProxy': asDefault(class { clear() {} }),
        '../systemopen/SystemOpenCommand': asDefault({ getInstance: () => ({
            requestSystemOpen: () => systemRequests++, clearData() {},
        }) }),
        '../utils/Tools': { Tools: {} }, '../utils/LocalCache': { LocalCache: {} },
        '../utils/DateUtil': asDefault({}), '../libs/crypto/md5': { Md5: {} },
    }).default;
    const command = Command.getInstance();
    command.proxy.saveLoginData({ userId: 1, serverId: 120 });
    command.startHeartbeat = () => {};
    EventMgr.emit(ServerConfig.s2c_user_login_ok, { userId: 1, serverId: 120 });
    sent.length = 0;
    let entries = 0, resourceRefreshes = 0;
    EventMgr.on(LogicEvent.enterMap, () => entries++, {});
    EventMgr.on(LogicEvent.upateMyRoleRes, () => resourceRefreshes++, {});
    return { EventMgr, command, sent, get systemRequests() { return systemRequests; },
        get entries() { return entries; }, get resourceRefreshes() { return resourceRefreshes; } };
}
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }

test('an account without a character stays on creation without world/resource requests', () => {
    const f = fixture();
    let creates = 0;
    const offers = [{ key: 1, name: '青州', route: '临淄关 → 河东' }];
    f.EventMgr.on(LogicEvent.createRole, zones => { creates++; assert.deepEqual(zones, offers); }, {});
    f.EventMgr.emit(ServerConfig.s2c_user_base_info, { name: '', birthZones: offers });
    assert.equal(f.command.role_create('无州', 1, 0), false);
    f.command.beginMapLoading();
    assert.equal(creates, 1);
    assert.equal(f.entries, 0);
    assert.equal(f.sent.length, 0);
    assert.equal(f.systemRequests, 0);
});

test('new character immediately enters loading even when resources have not returned', () => {
    const f = fixture();
    assert.equal(f.command.proxy.getRoleResData(), null);
    f.EventMgr.emit(ServerConfig.s2c_user_create, { name: '时序测试', sex: 1, cityPos: {x: 840, y: 688} });
    assert.equal(f.entries, 1, 'entry must be emitted in the create response callback');
    assert.equal(f.command.pendingFirstLanding, true, '新角色回包才安排落城剧情');
    assert.equal(f.command.proxy.getRoleData().name, '时序测试');
    assert.deepEqual(f.command.proxy.getRoleData().cityPos, {x: 840, y: 688});
    assert.equal(f.command.proxy.getRoleResData(), null, 'entry must not synthesize a resource response');
    assert.equal(f.sent.length, 0, 'creation callback must not start world requests');
    assert.equal(f.systemRequests, 0);
    f.command.beginMapLoading(); f.command.beginMapLoading();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].name, ServerConfig.c2s_req_user_res);
    assert.equal(f.systemRequests, 1);
    const laterResources = { resList: [{ k: 1, v: 1000 }] };
    f.EventMgr.emit(ServerConfig.s2c_req_user_res, laterResources);
    assert.equal(f.entries, 1, 'late resources must not trigger another entry');
    assert.equal(f.command.proxy.getRoleResData(), laterResources);
    assert.equal(f.resourceRefreshes, 1, 'HUD receives the late resource update');
});

test('resources received before creation do not open the map without a character', () => {
    const f = fixture();
    f.EventMgr.emit(ServerConfig.s2c_req_user_res, { resList: [] });
    assert.equal(f.entries, 0);
    f.EventMgr.emit(ServerConfig.s2c_user_create, { name: '先资源后角色', sex: 2, cityPos: {x: 31, y: 70} });
    assert.equal(f.entries, 1);
    f.EventMgr.emit(ServerConfig.s2c_req_user_res, { resList: [{ k: 2, v: 200 }] });
    assert.equal(f.entries, 1);
});

test('failed creation remains on the create page; existing characters still enter immediately', () => {
    const f = fixture();
    f.EventMgr.emit(ServerConfig.s2c_user_create, null);
    f.EventMgr.emit(ServerConfig.s2c_user_create, { name: '' });
    f.EventMgr.emit(ServerConfig.s2c_user_create, { name: '无落点' });
    assert.equal(f.entries, 0);
    f.EventMgr.emit(ServerConfig.s2c_user_base_info, { name: '已有角色', sex: 1 });
    assert.equal(f.entries, 1);
    assert.equal(f.command.pendingFirstLanding, false, '已有角色直接回城');
    assert.equal(f.command.proxy.getRoleResData(), null);
    assert.equal(f.sent.length, 0, 'existing characters also wait for the loading page');
    f.command.beginMapLoading();
    assert.equal(f.sent[0].name, ServerConfig.c2s_req_user_res);
});

test('reconnection refreshes resources once; creation responses after disconnect cannot reopen the map', () => {
    const f = fixture();
    f.EventMgr.emit(ServerConfig.s2c_user_base_info, { name: '已有角色', sex: 1 });
    f.command.beginMapLoading();
    f.command.notifyClientLoaded();
    f.EventMgr.emit(netInterface.NetEvent.ServerDisconnected);
    const entries = f.entries;
    f.EventMgr.emit(ServerConfig.s2c_user_create, { name: '迟到的创建回包', sex: 1 });
    assert.equal(f.entries, entries);
    f.EventMgr.emit(ServerConfig.s2c_user_login_ok, { userId: 1, serverId: 120 });
    f.EventMgr.emit(ServerConfig.s2c_user_base_info, { name: '已有角色', sex: 1 });
    f.command.beginMapLoading();
    assert.equal(f.sent.filter(packet => packet.name === ServerConfig.c2s_req_user_res).length, 2);
    assert.equal(f.sent.filter(packet => packet.name === ServerConfig.c2s_client_load_ok).length, 2);
    assert.equal(f.systemRequests, 2);
});

test('create page does not preload map assets and rapid clicks still send only one create request', () => {
    const f = fixture();
    const tasks = [];
    const Create = load('assets/scripts/login/CreateLogic.ts', {
        '../config/ServerConfig': { ServerConfig }, './LoginCommand': asDefault({ getInstance: () => f.command }),
        './LoginProxy': proxyModule, '../utils/EventMgr': { EventMgr: f.EventMgr },
        '../libs/NameDict': { createName: () => '测试新角色' },
        '../common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
        '../common/LogicEvent': { LogicEvent },
        '../map/ui/ManagementStyle': {},
    }).default;
    const create = new Create();
    create.node = { on() {} };
    create.editName = { string: '' }; create.manToggle = { isChecked: true };
    create.createButton = { interactable: true }; create.createButtonLabel = { string: '' };
    create.statusLabel = { string: '' };
    create.scheduleOnce = (callback, delay) => tasks.push({ callback, delay });
    create.unschedule = callback => {
        const i = tasks.findIndex(task => task.callback === callback);
        if (i >= 0) tasks.splice(i, 1);
    };
    create.onLoad();
    assert.equal(tasks.length, 0, 'opening creation must not schedule map/config downloads');
    create.onClickCreate();
    assert.equal(f.sent.pop().name, ServerConfig.c2s_user_base_info, 'missing options must never trigger random placement');
    const zone = { key: 2, name: '徐州' };
    create.zones = [zone];
    create.selected = zone;
    create.map = { width: 1000, height: 1000 };
    create.onClickCreate(); create.onClickCreate();
    assert.equal(create.createButton.interactable, false);
    tasks.find(task => task.delay === 0).callback();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].name, ServerConfig.c2s_user_create);
    assert.equal(f.sent[0].msg.birthZone, 2);
    f.EventMgr.emit(ServerConfig.s2c_user_create, { result: 3 });
    assert.equal(create.createButton.interactable, false, '无出生点时需要重新选州');
    assert.equal(create.selected, null);
    assert.equal(create.editName.string, '测试新角色');
    assert.equal(f.entries, 0);
    create.zones = [{ key: 1, name: '青州' }];
    create.selected = create.zones[0];
    create.onClickCreate();
    tasks.filter(task => task.delay === 0).pop().callback();
    const ack = { name: create.editName.string, cityPos: {x: 51, y: 89} };
    f.EventMgr.emit(ServerConfig.s2c_user_create, ack);
    f.EventMgr.emit(ServerConfig.s2c_user_create, ack);
    f.EventMgr.emit(ServerConfig.s2c_user_base_info, ack);
    assert.equal(f.entries, 1);
    assert.equal(tasks.some(task => task.delay === 12), false, 'successful response cancels the request timeout');
    // Creator 先销毁子节点时，父组件中的 Label 引用仍在，但 Label.node 为 null。
    const stopped = [], mapTarget = {}, opacityTarget = {};
    const previousStop = engine.Tween.stopAllByTarget;
    engine.Tween.stopAllByTarget = target => stopped.push(target);
    create.mapNode = mapTarget;
    create.zoneName = { node: null };
    create.zoneOpacity = opacityTarget;
    create.onDestroy();
    assert.deepEqual(stopped, [mapTarget, opacityTarget]);
    assert.equal(create.zoneOpacity, null);
    assert.doesNotThrow(() => create.onDestroy(), '重复清理以及子节点已销毁均安全');
    engine.Tween.stopAllByTarget = previousStop;
});

console.log(`PASS ${passed} login/create entry regression groups`);
process.exit(0);
