// 离线测试：真实 protobuf 线协议，隔离网络/编辑器，不启动游戏或服务器。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const scripts = path.join(root, 'assets/scripts');
const protobuf = require(path.join(scripts, '3rd/protobuf.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const big = '9007199254740993';
const other = '9007199254740995';
let passed = 0;

function harness(lazyMapModules = false) {
    const modules = new Map(), timers = new Map(), sent = [], notices = [];
    let timerId = 0;
    const role = { userId: big, allianceId: 0, cityPos: { x: 12, y: 20 } };
    const login = { proxy: { getRoleData: () => role, setAllianceId: id => role.allianceId = id } };
    const cc = { _decorator: { ccclass: () => v => v, property: () => () => {} }, JsonAsset: class {} };
    const stubs = {
        'login/LoginCommand': { default: { getInstance: () => login } },
        'network/socket/NetManager': { NetManager: { getInstance: () => ({ send(packet) {
            assert.ok(packet.msg instanceof Uint8Array, '所有新请求必须经过 protobuf 编码');
            assert.ok(proto.getIdByMsgType(packet.name) > 0, '不能发送 ID=0 的旧消息');
            sent.push({ name: packet.name, data: proto.decode(packet.name, packet.msg) });
        } }) } },
        'general/GeneralCommand': { default: { getInstance: () => ({ proxy: { getMyGeneral: id => [1001, 1002].includes(id) ? { heroType: id } : null } }) } },
        'map/ui/MapUICommand': { default: { getInstance: () => ({ proxy: {} }) } },
    };
    function load(name) {
        if (name.endsWith('.js')) return { default: require(path.resolve(scripts, name)) };
        const file = path.resolve(scripts, name.endsWith('.ts') ? name : name + '.ts');
        const key = path.relative(scripts, file).replace(/\\/g, '/').replace(/\.ts$/, '');
        if (stubs[key]) return stubs[key];
        if (modules.has(file)) return modules.get(file).exports;
        const module = { exports: {} }; modules.set(file, module);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        } }).outputText;
        vm.runInNewContext(code, {
            module, exports: module.exports, protobuf,
            console: { log() {}, warn() {}, error() {} },
            setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
            clearTimeout: id => timers.delete(id),
            require: name => name === 'cc' ? cc : load(path.relative(scripts, path.resolve(path.dirname(file), name))),
        }, { filename: file });
        return module.exports;
    }
    const proto = load('network/pto/ProtoManager').ProtoManager.getInstance();
    const dir = path.join(root, 'assets/resources/protbuf/pto');
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.proto'))) {
        proto.mergeRoot(proto._root, protobuf.parse(fs.readFileSync(path.join(dir, name), 'utf8')).root);
    }
    proto.parseIdMap(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define);
    proto._isReady = true;
    const events = load('utils/EventMgr').EventMgr;
    const S = load('config/ServerConfig').ServerConfig, E = load('common/LogicEvent').LogicEvent;
    const net = load('network/socket/NetInterface').NetEvent;
    const config = load('core/ConfigManager').default.getInstance();
    config.loadConfigs([{ name: 'Global', json: [{ Id: 9, value1: 3 }] }]);
    config.loadConfigs(['Mail', 'MailKind', 'ResLand', 'ResLandType'].map(name => ({ name, json: JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name + '.json'), 'utf8')) })));
    const commands = {
        union: load('union/UnionCommand').default.getInstance(), chat: load('chat/ChatCommand').default.getInstance(),
        world: lazyMapModules ? null : load('world/WorldCommand').default.getInstance(),
        progress: lazyMapModules ? null : load('progression/ProgressionCommand').default.getInstance(),
        battle: lazyMapModules ? null : load('battle/BattleCommand').default.getInstance(), rank: load('rank/RankCommand').default.getInstance(),
        build: lazyMapModules ? null : load('build/BuildCommand').default.getInstance(), troop: load('general/TroopCommand').default.getInstance(),
        mail: load('mail/MailCommand').default.getInstance(),
    };
    const receive = (name, data = {}) => {
        const bytes = proto.encode(name, data); assert.ok(bytes, 'fixture 编码失败 ' + name);
        const payload = proto.decode(name, bytes); assert.ok(payload, 'fixture 解码失败 ' + name); events.emit(name, payload);
    };
    for (const key of ['showToast', 'battleStarted', 'battleFinished', 'updateCityBuilds']) events.on(E[key], d => notices.push([key, d]), notices);
    return { ...commands, proto, events, S, E, net, sent, notices, role, timers, load, receive,
        authenticate: () => receive(S.s2c_user_login_ok),
        loaded: () => receive(S.s2c_client_load_ok),
        disconnect: () => events.emit(net.ServerDisconnected),
        tick(delay) { for (const [id, t] of [...timers]) if (t.delay === delay) { timers.delete(id); t.fn(); } },
    };
}
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
function test(name, run) { if (filter && !filter.test(name)) return; run(); passed++; console.log('PASS ' + name); }
const info = (id = 17) => ({ brief: { allianceId: id, name: '长安', flag: 4, joinType: 2, notice: '一起出关', memberCount: 3, memberMax: 40, level: 1 }, leaderId: big, manifesto: '守望相助', createTime: 1 });
const message = (msgId, channel = 1, senderId = big, targetId = 0) => ({ msgId, channel, senderId, targetId, senderName: '玩家', content: '消息', time: Number(msgId) || 1 });

test('Main 登录前初始化任务、地图与战报，加载确认后请求，不再漏接会话', () => {
    const h = harness(true);
    assert.equal(h.events.events.has(h.S.s2c_req_task_list), false, '复现首次打开地图才创建任务模块');
    const engine = { Component: class {}, Node: class { static EventType = { SIZE_CHANGED: 'size' }; },
        assert: value => assert.ok(value), view: { on() {} },
        _decorator: { ccclass: () => v => v, property: () => () => {} } };
    const imports = {
        './utils/EventMgr': { EventMgr: h.events }, './common/LogicEvent': { LogicEvent: h.E },
        './core/CoreEvent': h.load('core/CoreEvent'), './network/socket/NetInterface': { NetEvent: h.net },
        './config/GameConfig': { GameConfig: {} },
        './common/AudioManager': { AudioManager: { instance: { init() {} } } },
        './network/http/HttpManager': { HttpManager: { getInstance: () => ({ setWebUrl() {} }) } },
        './network/pto/ProtoManager': { ProtoManager: { getInstance: () => ({ init: () => ({ then() {} }) }) } },
        './world/WorldCommand': h.load('world/WorldCommand'),
        './progression/ProgressionCommand': h.load('progression/ProgressionCommand'),
        './build/BuildCommand': h.load('build/BuildCommand'),
        './battle/BattleCommand': h.load('battle/BattleCommand'),
    };
    const mod = { exports: {} }, code = ts.transpileModule(fs.readFileSync(path.join(scripts, 'Main.ts'), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    new Function('require', 'module', 'exports', code)(id => id === 'cc' ? engine : imports[id]
        || { default: { getInstance: () => ({}) } }, mod, mod.exports);
    const main = new mod.exports.default(); main.node = { on() {} }; main.getComponent = () => ({}); main.alignUiCamera = () => {};
    main.onLoad();
    const progress = h.load('progression/ProgressionCommand').default.getInstance();
    const world = h.load('world/WorldCommand').default.getInstance();
    const battle = h.load('battle/BattleCommand').default.getInstance();
    assert.equal(progress.sessionReady, false);
    h.authenticate(); assert.equal(progress.sessionReady, true); assert.equal(world.sessionReady, true);
    assert.equal(battle.sessionReady, true);
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_req_report_list).length, 0);
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_req_task_list).length, 0, '加载阶段不抢跑任务请求');
    h.loaded();
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_req_report_list).length, 1);
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_req_task_list).length, 1);
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_req_march_list).length, 1);
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_req_activity_list).length, 0);
    h.receive(h.S.s2c_req_task_list, { taskList: [{ taskId: 1001, taskType: 1, state: 1, progress: 1 }] });
    assert.equal(progress.tasksLoaded, true); assert.equal(progress.getTasks()[0].taskId, 1001);
    assert.equal(progress.claimTask(1001), true);
    h.disconnect(); assert.equal(progress.sessionReady, false); assert.equal(progress.tasksLoaded, false);
    assert.equal(progress.getTasks().length, 0); assert.equal(world.marches.values().length, 0);
    h.authenticate(); h.loaded();
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_req_task_list).length, 2);
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_get_task_reward).length, 1, '重连不重发领奖');
    h.receive(h.S.s2c_req_task_list, { taskList: [{ taskId: 1002, taskType: 1, state: 0, progress: 0 }] });
    assert.equal(progress.getTasks()[0].taskId, 1002);
});

test('MOVE 按坐标无实体移动，确认后同步位置；忙碌、重复、越界及断线不发包', () => {
    const h = harness();
    const config = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/TargetType.json'), 'utf8'));
    const type = h.load('world/WorldCommand').MarchTargetType.Move;
    assert.equal(type, config.find(c => c.Enum === 'MOVE').Id);
    assert.equal(h.world.moveTroop(1, { x: 0, y: 999 }), false);
    h.authenticate();
    assert.equal(h.world.moveTroop(1, { x: 0, y: 999 }), true);
    assert.deepEqual(plain(h.sent.at(-1).data), { troopIdx: 1, targetType: 4, targetId: 0, targetPos: { x: 0, y: 999 } });
    assert.equal(h.world.entities.size, 0, 'MOVE 不需要 AOI 资源实体');
    assert.equal(h.world.marches.values().length, 0, '请求发送时不伪造行军');
    assert.equal(h.world.moveTroop(1, { x: 1, y: 998 }), false);
    const march = { troopIdx: 1, targetType: 4, startPos: { x: 12, y: 20 }, endPos: { x: 0, y: 999 },
        startTime: 1.5, endTime: 1000.25, state: 1, path: [{ x: 12, y: 20 }, { x: 1.5, y: 30 }, { x: 0, y: 999 }] };
    h.receive(h.S.s2c_march, { marchInfo: march });
    assert.equal(h.world.moveTroop(1, { x: 10, y: 20 }), false);
    h.receive(h.S.s2c_sync_march, { marchInfo: { ...march, state: 2 } });
    assert.equal(h.world.marches.get(1).state, 2);
    assert.equal(h.world.moveTroop(1, { x: 0, y: 999 }), false, '已驻留在目的地不重发');
    assert.equal(h.world.moveTroop(1, { x: 10, y: 20 }), true);
    for (const pos of [{ x: -1, y: 0 }, { x: 1000, y: 0 }, { x: 1.5, y: 2 }, { x: 0, y: NaN }]) assert.equal(h.world.moveTroop(2, pos), false);
    assert.equal(h.world.march(2, 5, 0, { x: 1, y: 2 }), false);
    assert.equal(h.world.march(2, 3, 0, { x: 1, y: 2 }), false, '占领仍必须给实体 ID');
    assert.equal(h.world.march(2, 4, other, { x: 1, y: 2 }), true);
    assert.equal(String(h.sent.at(-1).data.targetId), '0', 'MOVE 不能携带旧占领实体 ID');
    const count = h.sent.length; h.disconnect();
    assert.equal(h.world.moveTroop(3, { x: 1, y: 2 }), false); assert.equal(h.sent.length, count);
    assert.equal(h.world.marches.values().length, 0);
    h.authenticate(); h.loaded();
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_march).length, 3, '重连不重发移动写操作');
});

test('同步后的全部新协议均使用当前 net_pb ID，协议资产与 game_common 一致', () => {
    const h = harness();
    const ids = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define;
    for (const pkg of ['Alliance', 'Chat', 'World', 'Battle', 'Report', 'Task', 'Activity', 'Rank', 'Build', 'Mail']) {
        for (const name of Object.keys(ids[pkg])) assert.equal(h.S[name], `${pkg}.${name}`);
    }
    const shared = path.join(root, 'external/game_common/proto');
    if (fs.existsSync(shared)) for (const name of ['alliance', 'chat', 'world', 'battle', 'report', 'task', 'activity', 'rank', 'build', 'mail']) {
        assert.equal(fs.readFileSync(path.join(root, 'assets/resources/protbuf/pto', name + '.proto'), 'utf8').replace(/\r/g, ''),
            fs.readFileSync(path.join(shared, name + '.proto'), 'utf8').replace(/\r/g, ''));
    }
});
test('int64 大 ID、重复 ID 数组和登录身份完整往返；非法整数拒绝发送', () => {
    const h = harness();
    for (const [name, data, key] of [
        [h.S.c2s_req_alliance_info, { allianceId: big }, 'allianceId'],
        [h.S.c2s_battle_skip, { battleId: big }, 'battleId'],
        [h.S.c2s_req_report_replay, { reportId: big }, 'reportId'],
    ]) assert.equal(h.proto.decode(name, h.proto.encode(name, data))[key], big);
    assert.deepEqual(plain(h.proto.decode(h.S.c2s_read_report, h.proto.encode(h.S.c2s_read_report, { reportIdList: [big, other] }))).reportIdList, [big, other]);
    assert.equal(h.proto.encode(h.S.c2s_battle_skip, { battleId: Number(big) }), null);
    assert.equal(h.proto.encode(h.S.c2s_battle_skip, { battleId: '9223372036854775808' }), null);
    assert.equal(h.proto.encode(h.S.c2s_edit_troop, { troopInfo: { troopIdx: 'bad' } }), null);
    const LoginProxy = h.load('login/LoginProxy').default, login = new LoginProxy();
    login.saveLoginData({ userId: big }); login.saveEnterData({ name: '角色', level: 4, exp: 8, cityPos: { x: 10, y: 20 }, soldierInfo: { count: 900, hurtCount: 40 }, allianceId: other });
    assert.equal(login.getRoleData().userId, big); assert.equal(login.getRoleData().allianceId, other);
    login.setSoldierInfo({ count: 700, hurtCount: 50 }); login.setCityPos({ x: 30, y: 40 });
    assert.deepEqual(plain(login.getRoleData().soldierInfo), { count: 700, hurtCount: 50 });
    assert.equal(login.getRoleData().name, '角色');
});
test('联盟身份、职位权限、设置全字段和退出后的清理', () => {
    const h = harness(); h.authenticate();
    h.receive(h.S.s2c_req_my_alliance, { info: info(other), myPos: 1 });
    assert.equal(h.union.proxy.myAllianceId, other); assert.equal(h.role.allianceId, other);
    h.receive(h.S.s2c_req_member_list, { allianceId: other, memberList: [{ uid: big, pos: 1 }, { uid: 2, pos: 2 }, { uid: 3, pos: 3 }, { uid: 4, pos: 2 }] });
    assert.equal(h.union.proxy.canKick(2), true);
    assert.equal(h.union.unionAppoint(2, 2), true); assert.equal(h.sent.at(-1).data.pos, 3);
    assert.equal(h.union.modNotice('新公告'), true);
    assert.deepEqual(plain(h.sent.at(-1).data), { flag: 4, joinType: 2, notice: '新公告', manifesto: '守望相助' });
    h.receive(h.S.s2c_sync_my_alliance, { allianceId: other, myPos: 2, info: info(other) });
    assert.equal(h.union.proxy.canKick(2), false); assert.equal(h.union.proxy.canKick(3), true);
    assert.equal(h.union.unionAbdicate(3), false); assert.equal(h.union.unionAppoint(3, 1), false);
    h.receive(h.S.s2c_req_apply_list, { applyList: [{ uid: 90, name: '申请者' }] });
    assert.equal(h.union.proxy.getApplyCnt(), 1);
    h.receive(h.S.s2c_sync_my_alliance, { allianceId: 0, myPos: 0 });
    assert.equal(h.role.allianceId, 0); assert.equal(h.union.proxy.getApplyCnt(), 0); assert.equal(h.union.proxy.getMemberList().length, 0);
    assert.equal(h.union.unionKick(3), false); assert.equal(h.chat.chat('联盟消息', 1), false);
});
test('联盟详情不覆盖推荐列表，申请 ACK 不假装已入盟，邀请确认保留服务器权限', () => {
    const h = harness(); h.authenticate();
    h.receive(h.S.s2c_req_alliance_list, { allianceList: [info(10).brief, info(20).brief] });
    h.receive(h.S.s2c_req_alliance_info, { info: info(30) });
    assert.deepEqual(Array.from(h.union.proxy.getUnionList(), u => u.id), [10, 20]);
    h.receive(h.S.s2c_apply_alliance, { allianceId: 10 }); assert.equal(h.union.proxy.isMeInUnion(), false);
    h.receive(h.S.s2c_sync_alliance_invite, { brief: info(20).brief, inviterId: big, inviterName: '盟主' });
    assert.equal(h.union.proxy.invitations.size, 1); assert.equal(h.union.handleInvite(20, true), true);
    h.receive(h.S.s2c_handle_invite, { allianceId: 20, agree: true }); assert.equal(h.union.proxy.invitations.size, 0);
});
test('换盟途中旧身份快照、旧频道历史及旧申请列表不能覆盖新联盟', () => {
    const h = harness(); h.authenticate();
    h.union.requestMine();
    h.receive(h.S.s2c_sync_my_alliance, { allianceId: 10, myPos: 1, info: info(10) });
    h.receive(h.S.s2c_req_my_alliance, { myPos: 0 });
    assert.equal(h.union.proxy.myAllianceId, 10);
    h.receive(h.S.s2c_sync_my_alliance, { allianceId: 20, myPos: 1, info: info(20) });
    h.receive(h.S.s2c_req_chat_list, { channel: 2, msgList: [message(100, 2)] });
    assert.equal(h.chat.proxy.getUnionChatList().length, 0);
    assert.equal(h.sent.at(-1).name, h.S.c2s_req_chat_list);
    h.receive(h.S.s2c_req_chat_list, { channel: 2, msgList: [message(200, 2)] });
    assert.deepEqual(Array.from(h.chat.proxy.getUnionChatList(), m => m.msgId), [200]);
    h.receive(h.S.s2c_req_apply_list, { applyList: [{ uid: 9, name: '旧盟申请' }] });
    assert.equal(h.union.proxy.getApplyCnt(), 0);
    h.receive(h.S.s2c_req_apply_list, { applyList: [{ uid: 8, name: '新盟申请' }] });
    assert.equal(h.union.proxy.getApplyList()[0].id, 8);
});
test('聊天 ACK/推送去重、空历史替换、查询途中推送保留、私聊会话隔离', () => {
    const h = harness(); h.authenticate(); h.loaded();
    h.receive(h.S.s2c_chat, { msg: message(1) }); h.receive(h.S.s2c_sync_chat, { msg: message(1) });
    assert.equal(h.chat.proxy.getWorldChatList().length, 1);
    h.receive(h.S.s2c_req_chat_list, { channel: 1, msgList: [] });
    assert.equal(h.chat.proxy.getWorldChatList().length, 1, '请求期间到达的消息仍保留');
    h.chat.chatHistory(0); h.receive(h.S.s2c_req_chat_list, { channel: 1, msgList: [] });
    assert.equal(h.chat.proxy.getWorldChatList().length, 0);
    for (let i = 2; i < 7; i++) h.receive(h.S.s2c_sync_chat, { msg: message(i) });
    assert.deepEqual(Array.from(h.chat.proxy.getWorldChatList(), m => m.msgId), [4, 5, 6]);
    h.receive(h.S.s2c_sync_chat, { msg: message(8, 3, other, big) });
    h.receive(h.S.s2c_chat, { msg: message(9, 3, big, other) });
    assert.equal(h.chat.proxy.getHistory(3, other).length, 2);
    assert.equal(h.chat.proxy.getHistory(3, '9007199254740994').length, 0);
    assert.equal(h.chat.chat('你好', 2, other), true); assert.equal(h.sent.at(-1).data.targetId, other);
    h.disconnect(); assert.equal(h.chat.proxy.getWorldChatList().length, 0);
    assert.equal(h.chat.chat('断线消息'), false);
});
test('行军召回、全量与推送竞态、AOI 进入/更新/离开及视野节流', () => {
    const h = harness(); h.authenticate();
    const march = { troopIdx: 1, targetType: 2, targetId: other, startTime: 1, endTime: 10, state: 1, path: [{ x: 0, y: 0 }, { x: 20, y: 20 }] };
    h.world.requestMarches(); h.receive(h.S.s2c_sync_march, { marchInfo: march }); h.receive(h.S.s2c_req_march_list, { marchList: [] });
    assert.equal(h.world.marches.values().length, 1);
    assert.equal(h.world.cancelMarch(1), true);
    h.receive(h.S.s2c_cancel_march, { troopIdx: 1 }); assert.equal(h.world.marches.values().length, 0);
    h.receive(h.S.s2c_aoi_enter, { entities: [{ entityId: other, entityType: 3, pos: { x: 1, y: 2 } }] });
    h.receive(h.S.s2c_aoi_update, { entities: [{ entityId: other, entityType: 3, pos: { x: 3, y: 4 } }] });
    assert.equal(h.world.entities.get(other).pos.x, 3);
    h.receive(h.S.s2c_aoi_leave, { entityIds: [other] }); assert.equal(h.world.entities.size, 0);
    h.world.focus({ x: 10, y: 10 }); h.world.focus({ x: 11, y: 11 }); h.world.focus({ x: 12, y: 12 }); h.tick(250);
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_aoi_focus).length, 1);
    assert.equal(h.sent.at(-1).data.pos.x, 12);
    assert.equal(h.world.march(1, 2, other, { x: 30, y: 40 }), true);
    assert.equal(h.sent.at(-1).data.targetId, other);
    h.disconnect(); assert.equal(h.world.entities.size, 0); assert.equal(h.world.march(1, 2, other, { x: 30, y: 40 }), false);
});
test('显式刷新重报相同 AOI 中心，多次请求合并且不清空现有实体', () => {
    const h = harness(); h.authenticate();
    h.events.emit(h.E.mapEenterChange, { x: 290, y: 850 }); h.tick(250);
    h.receive(h.S.s2c_aoi_enter, { entities: [{ entityId: other, entityType: 4, pos: { x: 291, y: 851 } }] });
    h.world.focus({ x: 290, y: 850 }); h.tick(250);
    assert.equal(h.sent.length, 1, '普通拖动仍去重');
    for (let i = 0; i < 8; i++) assert.equal(h.world.refreshView(), true);
    assert.equal(h.sent.length, 1, '刷新通过同一节流定时器发送');
    h.tick(250);
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent.at(-1).name, h.S.c2s_aoi_focus);
    assert.deepEqual(plain(h.sent.at(-1).data), { pos: { x: 290, y: 850 } });
    assert.equal(h.world.entities.size, 1, '不能模拟离开视野来强制刷新');
    h.receive(h.S.s2c_aoi_update, { entities: [{ entityId: other, entityType: 4, ownerId: big, pos: { x: 291, y: 851 } }] });
    assert.equal(h.world.entities.get(other).ownerId, big);
    h.world.focus({ x: 290, y: 850 }); h.tick(250); assert.equal(h.sent.length, 2);
});
test('刷新沿用最新拖动中心，断线取消待发请求且不跨会话重放', () => {
    const h = harness(); h.authenticate();
    h.world.focus({ x: 290, y: 850 }); h.tick(250);
    h.world.refreshView(); h.world.focus({ x: 300, y: 840 }); h.tick(250);
    assert.deepEqual(plain(h.sent.at(-1).data.pos), { x: 300, y: 840 });
    h.world.refreshView(); h.disconnect(); h.tick(250);
    assert.equal(h.sent.length, 2); assert.equal(h.world.refreshView(), false);
    h.authenticate(); h.tick(250); assert.equal(h.sent.length, 2);
    assert.equal(h.world.refreshView(), true); h.tick(250);
    assert.deepEqual(plain(h.sent.at(-1).data.pos), h.role.cityPos, '新会话不用上个账号的视野');
});
test('尚无地图视野时使用登录城池坐标；缺失或非法坐标不发刷新', () => {
    const h = harness();
    assert.equal(h.world.refreshView(), false);
    h.authenticate(); h.role.cityPos = null;
    assert.equal(h.world.refreshView(), false);
    h.role.cityPos = { x: -1, y: 850 }; assert.equal(h.world.refreshView(), false);
    h.tick(250); assert.equal(h.sent.length, 0);
    h.role.cityPos = { x: 0, y: 999 };
    assert.equal(h.world.refreshView(), true); h.tick(250);
    assert.deepEqual(plain(h.sent.at(-1).data.pos), h.role.cityPos);
});
test('任务领奖确认后补取后续任务，重复确认不重复查询且不自动领奖', () => {
    const h = harness(); h.authenticate();
    h.progress.requestTasks();
    h.receive(h.S.s2c_req_task_list, { taskList: [{ taskId: 1001, taskType: 1, progress: 1, state: 1 }] });
    assert.equal(h.progress.claimTask(1001), true);
    assert.equal(h.progress.claimTask(1001), false);
    assert.equal(h.progress.tasks.get(1001).state, 1, '请求发出后保留当前任务');
    h.receive(h.S.s2c_get_task_reward, { taskId: 1001 });
    assert.equal(h.progress.tasks.get(1001).state, 2);
    assert.equal(h.sent.at(-1).name, h.S.c2s_req_task_list);
    h.receive(h.S.s2c_sync_task, { taskInfo: { taskId: 1002, taskType: 1, progress: 2, state: 1 } });
    h.receive(h.S.s2c_req_task_list, { taskList: [] });
    assert.equal(h.progress.tasks.get(1002).state, 1, '保留查询途中的新任务推送');
    const count = h.sent.length;
    h.receive(h.S.s2c_get_task_reward, { taskId: 1001 });
    assert.equal(h.sent.length, count, '重复 ACK 不重新拉列表');
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_get_task_reward).length, 1, '下一项仍由用户点击领取');
});
test('旧任务列表与领奖并发时追加一次同步，超时和断线不提前切换任务', () => {
    const h = harness(); h.authenticate();
    h.receive(h.S.s2c_sync_task, { taskInfo: { taskId: 1001, taskType: 1, progress: 1, state: 1 } });
    h.progress.requestTasks(); h.progress.claimTask(1001);
    h.receive(h.S.s2c_get_task_reward, { taskId: 1001 });
    h.receive(h.S.s2c_get_task_reward, { taskId: 1001 });
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_req_task_list).length, 1);
    h.receive(h.S.s2c_req_task_list, { taskList: [{ taskId: 1001, taskType: 1, progress: 1, state: 1 }] });
    assert.equal(h.progress.tasks.get(1001).state, 2, '旧全量不能复活已领取任务');
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_req_task_list).length, 2);
    h.receive(h.S.s2c_req_task_list, { taskList: [{ taskId: 1002, taskType: 1, progress: 2, state: 1 }] });
    assert.equal(h.progress.claimTask(1002), true); h.tick(8000);
    assert.equal(h.progress.tasks.get(1002).state, 1, '超时保留可领取状态');
    assert.equal(h.progress.claimTask(1002), true, '超时后允许手动重试');
    h.disconnect(); const count = h.sent.length; h.tick(8000);
    assert.equal(h.progress.tasks.values().length, 0); assert.equal(h.sent.length, count);
});
test('任务领奖仅在可领取状态发送；活动 ACK 不重复累加兑换次数', () => {
    const h = harness(); h.authenticate();
    h.progress.requestTasks(); h.receive(h.S.s2c_sync_task, { taskInfo: { taskId: 1, taskType: 1, state: 1, progress: 10 } });
    h.receive(h.S.s2c_req_task_list, { taskList: [] });
    assert.equal(h.progress.tasks.get(1).state, 1); assert.equal(h.progress.claimTask(1), true); assert.equal(h.progress.claimTask(1), false);
    h.receive(h.S.s2c_get_task_reward, { taskId: 1 }); assert.equal(h.progress.tasks.get(1).state, 2);
    assert.equal(h.progress.claimTask(1), false);
    h.receive(h.S.s2c_sync_activity, { activityInfo: { activityId: 2, state: 1, extraMap: { 0: 4 } } });
    assert.equal(h.progress.exchange(2, 0, 1), true);
    h.receive(h.S.s2c_sync_activity, { activityInfo: { activityId: 2, state: 1, extraMap: { 0: 5 } } });
    h.receive(h.S.s2c_activity_exchange, { activityId: 2, index: 0, count: 1 });
    assert.equal(h.progress.activities.get(2).extraMap[0], 5);
    assert.equal(h.sent.at(-1).name, h.S.c2s_req_activity_list);
    h.receive(h.S.s2c_req_activity_list, { activityList: [] }); assert.equal(h.progress.activities.values().length, 0);
    h.receive(h.S.s2c_sync_activity, { activityInfo: { activityId: 3, state: 2 } });
    assert.equal(h.progress.claimActivity(3, 0), true, '已结束活动仍可向服务器请求结算奖励');
    h.receive(h.S.s2c_get_activity_reward, { activityId: 3, index: 0 });
    assert.equal(h.progress.claimActivity(3, 0), false, '领奖确认后不可重复领取');
});
test('战斗结果去重；战报详情/回放、全部已读和删除使用新数据', () => {
    const h = harness(); h.authenticate();
    h.receive(h.S.s2c_battle_start, { battleId: big }); h.receive(h.S.s2c_battle_result, { battleId: big, result: 1, reportId: other });
    h.receive(h.S.s2c_battle_result, { battleId: big, result: 1, reportId: other });
    assert.equal(h.notices.filter(n => n[0] === 'battleFinished').length, 1);
    h.battle.requestReports(); h.receive(h.S.s2c_sync_report, { reportBrief: { reportId: other, result: 1 } });
    h.receive(h.S.s2c_req_report_list, { reportList: [] }); assert.equal(h.battle.reports.values().length, 1);
    h.receive(h.S.s2c_req_report_detail, { reportInfo: { brief: { reportId: other, result: 1 }, atkSide: { name: '攻方' } } });
    assert.equal(h.battle.details.get(other).atkSide.name, '攻方');
    h.receive(h.S.s2c_req_report_replay, { reportId: other, replay: { maxRound: 1, actions: [{ round: 1, actType: 6, effects: [{ value: 50, afterSoldier: 100 }] }] } });
    assert.equal(h.battle.replays.get(other).actions[0].effects[0].afterSoldier, 100);
    h.battle.readReports(); h.receive(h.S.s2c_read_report, { reportIdList: [] }); assert.equal(h.battle.reports.get(other).isRead, true);
    h.battle.deleteReports([other]); h.receive(h.S.s2c_del_report, { reportIdList: [other] });
    assert.equal(h.battle.reports.values().length, 0); assert.equal(h.battle.details.size, 0); assert.equal(h.battle.replays.size, 0);
    h.receive(h.S.s2c_req_report_detail, { reportInfo: { brief: { reportId: other } } });
    h.receive(h.S.s2c_req_report_replay, { reportId: other, replay: { maxRound: 1 } });
    assert.equal(h.battle.reports.values().length, 0, '删除后的迟到详情不得恢复战报');
    assert.equal(h.battle.details.size, 0); assert.equal(h.battle.replays.size, 0);
});

test('战报未读随全量和推送更新，全部已读不吞掉途中新增记录', () => {
    const h = harness(); h.authenticate(); h.loaded();
    h.receive(h.S.s2c_req_report_list, { reportList: [{ reportId: big, isRead: false }, { reportId: other, isRead: true }] });
    assert.equal(h.battle.loaded, true); assert.equal(h.battle.unreadCount, 1);
    assert.equal(h.battle.readReports(), true);
    assert.deepEqual(plain(h.sent.at(-1).data.reportIdList).map(String), [big]);
    assert.equal(h.battle.unreadCount, 1, '确认之前保留红点');
    h.receive(h.S.s2c_sync_report, { reportBrief: { reportId: '9007199254740997', isRead: false } });
    h.receive(h.S.s2c_read_report, { reportIdList: [] });
    assert.equal(h.battle.unreadCount, 1); assert.equal(h.battle.reports.get(big).isRead, true);
    h.receive(h.S.s2c_sync_report, { reportBrief: { reportId: big, isRead: false } });
    assert.equal(h.battle.unreadCount, 1, '迟到摘要不得恢复未读');
    h.disconnect(); assert.equal(h.battle.unreadCount, 0); assert.equal(h.battle.loaded, false);
});
test('战报连续查看排队确认，重复确认不串请求，超时不伪造已读', () => {
    const h = harness(); h.authenticate();
    h.receive(h.S.s2c_req_report_list, { reportList: [{ reportId: big }, { reportId: other }] });
    h.battle.readReports([big]); h.battle.readReports([other]);
    const sent = () => h.sent.filter(p => p.name === h.S.c2s_read_report);
    assert.equal(sent().length, 1);
    h.receive(h.S.s2c_read_report, { reportIdList: [big] });
    assert.equal(sent().length, 2); assert.equal(h.battle.unreadCount, 1);
    h.receive(h.S.s2c_read_report, { reportIdList: [big] });
    assert.equal(h.battle.requestInFlight(h.S.c2s_read_report), true);
    h.tick(8000); assert.equal(h.battle.unreadCount, 1);
    assert.equal(h.battle.requestInFlight(h.S.c2s_read_report), false);
    assert.equal(h.battle.readReports([other]), true);
    h.receive(h.S.s2c_read_report, { reportIdList: [other] });
    assert.equal(h.battle.unreadCount, 0);
});
test('战报列表超时可重试，删除后迟到快照不得恢复红点', () => {
    const h = harness(); h.authenticate(); h.battle.requestReports(); h.tick(8000);
    assert.equal(h.battle.loaded, false); assert.ok(h.battle.loadError); assert.equal(h.battle.loading, false);
    assert.equal(h.battle.requestReports(), true);
    h.receive(h.S.s2c_req_report_list, { reportList: [{ reportId: big }] });
    h.battle.deleteReports([big]); h.receive(h.S.s2c_del_report, { reportIdList: [big] });
    h.receive(h.S.s2c_req_report_list, { reportList: [{ reportId: big }] });
    assert.equal(h.battle.unreadCount, 0); assert.equal(h.battle.getReports().length, 0);
});
test('战报展示兼容资源地和未知类型，战损区分伤兵与阵亡，窄屏保持边界', () => {
    const h = harness(), config = h.load('core/ConfigManager').default.getInstance();
    config.loadConfigs(['ReportType', 'Hero', 'Monster', 'Skill'].map(name => ({ name, json: JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name + '.json'), 'utf8')) })));
    const p = h.load('battle/ReportPresentation');
    assert.equal(p.reportKind({ reportType: 4 }), '占领资源地'); assert.equal(p.reportKind({ reportType: 999 }), '战斗记录');
    assert.deepEqual(plain(p.soldierTotals({ units: [{ beforeSoldier: { count: 100, hurtCount: 10 }, afterSoldier: { count: 60, hurtCount: 30 } }] })), { before: 100, after: 60, hurt: 30, lost: 20 });
    assert.equal(p.soldierTotals({ units: [] }), null);
    const lines = p.replayLines({ fromSide: 1, fromPos: 0, actType: 1, effects: [{ targetSide: 2, targetPos: 2, flags: 2, value: 500 }] }, { atkSide: { units: [] }, defSide: { units: [] } });
    assert.match(lines[1], /闪避/); assert.doesNotMatch(lines[1], /损失/);
    for (const [width, height] of [[1280, 720], [900, 500], [390, 844], [320, 480]]) {
        const m = p.reportLayout(width, height); assert.ok(m.width * m.scale <= width - 27); assert.ok(m.height * m.scale <= height - 27);
        assert.ok(m.bodyHeight > 0 && m.detailWidth > 0); assert.equal(m.narrow, width < 760);
    }
});

test('榜单按类型/页缓存，未上榜 rank=0 保留；建筑只在推送后升级', () => {
    const h = harness(); h.authenticate();
    assert.equal(h.rank.requestRank(1, 1, 20), true); assert.equal(h.rank.requestRank(1, 21, 20), false);
    h.receive(h.S.s2c_req_rank_list, { rankType: 1, rankList: [], selfRank: { uid: big, rank: 0, score: other } });
    assert.equal(h.rank.pages.get('1:1:20').selfRank.score, other); assert.equal(h.rank.requestRank(1, 21, 20), true);
    h.build.requestBuildings(); h.receive(h.S.s2c_req_build, { buildList: [{ bid: 2, level: 7 }] });
    assert.equal(h.build.upgrade(2), true); assert.equal(h.build.upgrade(2), false); assert.equal(h.build.levels.get(2), 7);
    h.receive(h.S.s2c_sync_build, { bid: 2, level: 8 }); assert.equal(h.build.levels.get(2), 8);
});
test('posMap 兵力完整保存，战后同步不误解锁尚未确认的编队编辑', () => {
    const h = harness(); h.authenticate(); h.troop.requestTroops();
    h.receive(h.S.s2c_req_troop, { troopList: [{ troopIdx: 1, posMap: { 1: { heroIdx: 1001, soldier: { count: 900, hurtCount: 30 } } } }] });
    assert.equal(h.troop.editTroop(1, { 1001: 1, 1002: 2 }), true);
    const packet = h.sent.at(-1).data;
    assert.deepEqual(plain(packet.troopInfo.posMap[2].soldier), { count: 900, hurtCount: 30 });
    h.receive(h.S.s2c_sync_troop, { troopInfo: { troopIdx: 1, posMap: { 1: { heroIdx: 1001, soldier: { count: 700, hurtCount: 50 } } } } });
    assert.equal(h.troop.editingTroopIdx, 1); assert.equal(h.troop.proxy.getTroop(1).getSoldier(1001).count, 700);
});
test('编队列表不能覆盖查询途中的战后兵力，配兵请求保留伤兵', () => {
    const h = harness(); h.authenticate(); h.troop.requestTroops();
    const troop = count => ({ troopIdx: 1, posMap: { 1: { heroIdx: 1001, soldier: { count, hurtCount: 50 } } } });
    h.receive(h.S.s2c_sync_troop, { troopInfo: troop(700) });
    h.receive(h.S.s2c_req_troop, { troopList: [troop(900)] });
    assert.equal(h.troop.proxy.getTroop(1).getSoldier(1001).count, 700);
    assert.equal(h.troop.editTroop(1, { 1001: 0 }, { 1001: 850 }), true);
    assert.deepEqual(plain(h.sent.at(-1).data.troopInfo.posMap[1].soldier), { count: 850, hurtCount: 50 });
    h.receive(h.S.s2c_edit_troop, h.sent.at(-1).data);
    assert.equal(h.troop.editTroop(1, { 1001: 0 }, { 1001: -1 }), false);
});
test('建筑配置按建筑 Id 关联等级表，保留建造/升级前置及即时完成语义', () => {
    const h = harness();
    const Proxy = h.load('map/ui/MapUIProxy').default;
    const proxy = new Proxy();
    const table = name => JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name + '.json'), 'utf8'));
    const buildings = table('BuildingDetail'), levels = table('BuildingLv');
    proxy.setAllFacilityCfg([{ name: 'BuildingDetail', json: buildings }, { name: 'BuildingLv', json: levels }]);
    for (const b of buildings) {
        const cfg = proxy.getFacilityCfgByType(b.Id);
        assert.equal(cfg.name, b.Name);
        assert.deepEqual(plain(cfg.conditions), b.CreateLimit.map(c => ({ type: c.bid, level: c.lev })));
        for (const l of levels.filter(l => l.BuildingType === b.Id)) {
            const up = cfg.upLevels[l.Lv - 1];
            assert.equal(up.grain, l.CostGrain); assert.equal(up.wood, l.CostWood); assert.equal(up.iron, l.CostIron); assert.equal(up.time, 0);
            assert.deepEqual(plain(up.conditions), l.UpgradeLimit.map(c => ({ type: c.bid, level: c.lev })));
        }
    }
});
test('断线清理、重连重取只读快照，绝不自动重发领奖/行军/联盟写请求', () => {
    const h = harness(); h.authenticate(); h.loaded();
    h.build.create(1); h.union.unionCreate('联盟'); h.world.march(1, 2, other, { x: 30, y: 40 });
    h.disconnect(); assert.equal(h.timers.size, 0);
    const start = h.sent.length; h.authenticate(); h.loaded();
    const names = h.sent.slice(start).map(p => p.name);
    assert.ok(names.includes(h.S.c2s_req_my_alliance)); assert.ok(names.includes(h.S.c2s_req_march_list));
    assert.ok(names.includes(h.S.c2s_req_task_list)); assert.ok(!names.includes(h.S.c2s_req_activity_list), '活动暂不接入，不应自动拉取');
    assert.ok(names.includes(h.S.c2s_req_report_list));
    assert.ok(!names.includes(h.S.c2s_create_build)); assert.ok(!names.includes(h.S.c2s_create_alliance)); assert.ok(!names.includes(h.S.c2s_march));
});


test('邮件实例ID、列表推送竞态和空快照', () => {
    const h = harness(); h.authenticate(); h.loaded();
    assert.deepEqual(h.sent.filter(p => p.name === h.S.c2s_req_mail_list).map(p => p.data.mailKind), [1, 2, 3]);
    for (const uid of [big, other]) h.receive(h.S.s2c_sync_mail, { mailKind: 1, mailInfo: { mailId: 1, mailUid: uid } });
    h.receive(h.S.s2c_req_mail_list, { mailKind: 1, mailInfoList: [] });
    assert.equal(h.mail.getList(1).length, 2); assert.equal(h.mail.unreadCount(1), 2);
    assert.equal(h.mail.requestDetail(1, big), true); assert.equal(h.sent.at(-1).data.mailUid, big);
    assert.equal(h.mail.requestDetail(2, big), false); assert.equal(h.mail.requestDetail(1, 1), false);
    h.receive(h.S.s2c_req_mail_detail, { mailUid: big, rewardList: [{ rewardType: 1, itemId: 1, itemCount: 20 }] });
    assert.equal(h.mail.getMail(1, big).isRead, true); assert.equal(h.mail.unreadCount(1), 1);
    assert.equal(h.mail.getDetail(big).rewardList[0].itemCount, 20);
    h.mail.requestList(1); h.receive(h.S.s2c_req_mail_list, { mailKind: 1, mailInfoList: [] });
    assert.equal(h.mail.getList(1).length, 0);
});
test('邮件锁定、批量领奖、删除防复活及断线清理', () => {
    const h = harness(); h.authenticate();
    const push = () => h.receive(h.S.s2c_sync_mail, { mailKind: 1, mailInfo: { mailId: 2, mailUid: big } });
    push(); assert.equal(h.mail.setLock(1, big, true), true);
    h.receive(h.S.s2c_set_mail_lock, { mailKind: 1, mailUid: big, isLock: true });
    assert.equal(h.mail.deleteMails(1, [big]), false);
    assert.equal(h.mail.claimRewards([{ mailKind: 1, mailUid: big }]), true);
    assert.deepEqual(plain(h.sent.at(-1).data.mailKindUidList), [{ k: 1, v: big }]);
    assert.equal(h.mail.claimRewards([{ mailKind: 1, mailUid: big }]), false);
    h.receive(h.S.s2c_get_mail_reward, { mailKindUidList: [{ k: 1, v: big }] });
    assert.equal(h.mail.getMail(1, big).isGotReward, true);
    assert.equal(h.mail.claimRewards([{ mailKind: 1, mailUid: big }]), false);
    h.mail.setLock(1, big, false); h.receive(h.S.s2c_set_mail_lock, { mailKind: 1, mailUid: big, isLock: false });
    h.mail.requestList(1); h.mail.requestDetail(1, big);
    assert.equal(h.mail.deleteMails(1, [big, big]), true); assert.deepEqual(plain(h.sent.at(-1).data.mailUidList), [big]);
    h.receive(h.S.s2c_del_mail_list, { mailKind: 1, mailUidList: [big] });
    h.receive(h.S.s2c_req_mail_list, { mailKind: 1, mailInfoList: [{ mailId: 2, mailUid: big }] });
    h.receive(h.S.s2c_req_mail_detail, { mailUid: big, detailList: ['迟到'] }); push();
    assert.equal(h.mail.getList(1).length, 0); assert.equal(h.mail.getDetail(big), undefined);
    h.disconnect(); assert.equal(h.mail.requestList(1), false);
    const start = h.sent.length; h.authenticate(); h.loaded();
    assert.ok(h.sent.slice(start).every(p => ![h.S.c2s_get_mail_reward, h.S.c2s_set_mail_lock, h.S.c2s_del_mail_list].includes(p.name)));
});
test('邮件模板参数、服务器文本优先及详情超时重试', () => {
    const h = harness(); h.authenticate();
    h.receive(h.S.s2c_sync_mail, { mailKind: 3, mailInfo: { mailId: 10, mailUid: big } });
    h.mail.requestDetail(3, big); h.tick(8000);
    assert.equal(h.mail.requestDetail(3, big), true);
    h.receive(h.S.s2c_req_mail_detail, { mailUid: big, detailList: ['开服公告', '欢迎出征'] });
    assert.deepEqual(plain(h.mail.presentation(3, big)), { title: '开服公告', content: '欢迎出征', sender: '公告', icon: '' });
    h.receive(h.S.s2c_sync_mail, { mailKind: 3, mailInfo: { mailId: 10, mailUid: big, title: '服务器标题', content: '服务器正文' } });
    assert.equal(h.mail.presentation(3, big).title, '服务器标题'); assert.equal(h.mail.getMail(3, big).isRead, true);
});
test('资源占领使用AOI实体ID，浮点路径无截断，拒绝错图/自有/离场目标', () => {
    const h = harness(); h.authenticate(); h.role.level = 20;
    assert.equal(h.world.occupyResourceLand(1, 20010), false);
    const entity = { entityId: other, entityType: 4, cfgId: 203, pos: { x: 10, y: 20 } };
    h.receive(h.S.s2c_aoi_enter, { entities: [entity] });
    assert.equal(h.world.resourceLandIssue(10, 20, 52, 3), ''); assert.ok(h.world.resourceLandIssue(10, 20, 53, 3));
    assert.equal(h.world.occupyResourceLand(1, other), true);
    assert.deepEqual(plain(h.sent.at(-1).data), { troopIdx: 1, targetType: 3, targetId: other, targetPos: { x: 10, y: 20 } });
    h.receive(h.S.s2c_march, { marchInfo: { troopIdx: 1, targetType: 3, targetId: other, state: 1, path: [{ x: 1.25, y: 2.75 }, { x: 10, y: 20 }] } });
    assert.equal(h.world.marches.get(1).path[0].x, 1.25); assert.equal(h.world.marches.get(1).path[0].y, 2.75);
    assert.equal(h.world.occupyResourceLand(1, other), false);
    h.receive(h.S.s2c_aoi_update, { entities: [{ ...entity, ownerId: big }] });
    assert.equal(h.world.occupyResourceLand(2, other), false); assert.ok(h.world.resourceLandIssue(10, 20, 52, 3).includes('归你'));
    h.receive(h.S.s2c_aoi_leave, { entityIds: [other] });
    assert.equal(h.world.resourceLandAt(10, 20), undefined); assert.equal(h.world.occupyResourceLand(2, other), false);
    assert.equal(h.world.march(2, 3, 0, { x: 10, y: 20 }), false);
    assert.equal(h.world.march(2, 3, other, { x: 10.5, y: 20 }), false);
});
test('石料补配置即可占领，按STONE枚举查找，不假定类型/模板/道具ID', () => {
    const h = harness(); h.authenticate(); h.role.level = 20;
    const actual = h.load('world/ResourceLand').resourceLandForCell(54, 3);
    assert.equal(actual.Id, 403); assert.equal(actual.OutputItem, 5);
    const config = h.load('core/ConfigManager').default.getInstance();
    config.loadConfigs([{ name: 'ResLandType', json: [] }, { name: 'ResLand', json: [] }]);
    assert.ok(h.world.resourceLandIssue(10, 20, 54, 3).includes('石料'));
    config.loadConfigs([{ name: 'ResLandType', json: [{ Id: 17, Enum: 'STONE' }] },
        { name: 'ResLand', json: [{ Id: 7303, Type: 17, Level: 3, Capacity: 300, GatherSpeed: 40, OutputItem: 9 }] }]);
    const land = h.load('world/ResourceLand').resourceLandForCell(54, 3);
    assert.equal(land.Id, 7303); assert.equal(land.OutputItem, 9);
    h.receive(h.S.s2c_aoi_enter, { entities: [{ entityId: other, entityType: 4, cfgId: 7303, pos: { x: 10, y: 20 } }] });
    assert.equal(h.world.resourceLandIssue(10, 20, 54, 3), ''); assert.equal(h.world.occupyResourceLand(1, other), true);
});
console.log(`通过 ${passed} 项 game_common 新协议回归`);
