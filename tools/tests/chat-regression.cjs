// 离线回放真实聊天 protobuf；不会连接服务器或向玩家发送消息。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
const protobuf = require(path.join(scripts, '3rd/protobuf.js'));
const me = '9007199254740993', peer = '9007199254740995', peer2 = '9007199254740997';
let passed = 0;
function harness() {
    const cache = new Map(), sent = [], timers = new Map(); let timer = 0, union = false;
    const login = { proxy: { getRoleData: () => ({ userId: me }) } };
    const stubs = {
        'login/LoginCommand': { default: { getInstance: () => login } },
        'union/UnionCommand': { default: { getInstance: () => ({ proxy: { isMeInUnion: () => union } }) } },
        'core/ConfigManager': { default: { getInstance: () => ({ getConfig: () => [{ Id: 9, value1: 100 }] }) } },
        'network/socket/NetManager': { NetManager: { getInstance: () => ({ send(packet) {
            assert.ok(packet.msg instanceof Uint8Array);
            sent.push({ name: packet.name, data: proto.decode(packet.name, packet.msg) });
        } }) } },
        'map/ui/ManagementStyle': {},
    };
    const cc = { _decorator: { ccclass: () => v => v }, Component: class {} };
    function load(name) {
        name = name.replace(/\\/g, '/').replace(/\.ts$/, '');
        if (stubs[name]) return stubs[name];
        if (cache.has(name)) return cache.get(name).exports;
        if (name.endsWith('.js')) return { default: require(path.join(scripts, name)) };
        const file = path.join(scripts, name + '.ts'), module = { exports: {} }; cache.set(name, module);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
        vm.runInNewContext(code, { module, exports: module.exports, protobuf, console: { log() {}, warn() {}, error() {} },
            setTimeout: fn => { const id = ++timer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
            require: id => id === 'cc' ? cc : load(path.relative(scripts, path.resolve(path.dirname(file), id))),
        }, { filename: file });
        return module.exports;
    }
    const proto = load('network/pto/ProtoManager').ProtoManager.getInstance();
    const folder = path.join(root, 'assets/resources/protbuf/pto');
    fs.readdirSync(folder).filter(n => n.endsWith('.proto')).forEach(n =>
        proto.mergeRoot(proto._root, protobuf.parse(fs.readFileSync(path.join(folder, n), 'utf8')).root));
    proto.parseIdMap(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define);
    proto._isReady = true;
    const events = load('utils/EventMgr').EventMgr, E = load('common/LogicEvent').LogicEvent, S = load('config/ServerConfig').ServerConfig;
    const chat = load('chat/ChatCommand').default.getInstance();
    const receive = (name, data = {}) => events.emit(name, proto.decode(name, proto.encode(name, data)));
    receive(S.s2c_user_login_ok);
    return { load, chat, proxy: chat.proxy, S, E, events, sent, receive,
        join(id) { union = !!id; events.emit(E.unionChange, id); },
        timeout() { const all = [...timers.values()]; timers.clear(); all.forEach(fn => fn()); },
        logout() { events.emit(E.enterLogin); } };
}
function message(id, channel = 1, senderId = peer, targetId = 0, content = '同袍安好') {
    return { msgId: String(id), channel, senderId, targetId, senderName: senderId === me ? '自己' : '青山', headIcon: 1, time: 100 + Number(id), content };
}
function test(name, fn) { fn(); console.log('PASS ' + name); passed++; }

test('推送、历史和发送回执去重，未读按频道和私聊对象隔离', () => {
    const h = harness();
    h.receive(h.S.s2c_sync_chat, { msg: message(1) }); h.receive(h.S.s2c_sync_chat, { msg: message(1) });
    assert.equal(h.proxy.unreadCount(1), 1);
    h.receive(h.S.s2c_sync_chat, { msg: message(2, 3, peer, me) });
    h.receive(h.S.s2c_sync_chat, { msg: message(3, 3, peer2, me) });
    assert.equal(h.proxy.unreadCount(3), 2); assert.equal(h.proxy.unreadCount(), 3);
    h.chat.markRead(3, peer); assert.equal(h.proxy.unreadCount(3, peer), 0); assert.equal(h.proxy.unreadCount(3, peer2), 1);
    h.receive(h.S.s2c_chat, { msg: message(4, 1, me) }); assert.equal(h.proxy.unreadCount(1), 1);
    assert.equal(h.proxy.recent(2).length, 2); assert.equal(h.proxy.getHistory(3, peer)[0].peerId, peer);
    assert.equal(h.proxy.conversations().find(p => p.id === peer).name, '青山');
    h.chat.markRead(1); h.receive(h.S.s2c_sync_chat, { msg: message(1) }); assert.equal(h.proxy.unreadCount(1), 0);
});
test('读取历史途中到达的新消息保留，历史记录不产生虚假未读', () => {
    const h = harness(); h.chat.chatHistory(0);
    h.receive(h.S.s2c_sync_chat, { msg: message(3) });
    h.receive(h.S.s2c_req_chat_list, { channel: 1, msgList: [message(1), message(2), message(3)] });
    assert.deepEqual(Array.from(h.proxy.getWorldChatList(), m => String(m.msgId)), ['1', '2', '3']);
    assert.equal(h.proxy.unreadCount(1), 1);
    h.chat.chatHistory(2, peer); h.receive(h.S.s2c_req_chat_list, { channel: 3, targetId: peer, msgList: [message(9, 3, peer, me)] });
    assert.equal(h.proxy.unreadCount(3, peer), 0); assert.equal(h.proxy.getHistory(3, peer)[0].peerId, peer);
});
test('发送等待服务端确认，重复点击、非本人推送不会误清发送锁', () => {
    const h = harness(), results = []; h.events.on(h.E.chatSendResult, r => results.push(r), results);
    assert.equal(h.chat.chat('  列阵  '), true); assert.equal(h.chat.chat('列阵'), false);
    assert.equal(h.sent.length, 1); assert.equal(h.sent[0].data.content, '列阵');
    h.receive(h.S.s2c_sync_chat, { msg: message(1, 1, peer, 0, '列阵') }); assert.equal(h.chat.requestInFlight('chat:send'), true);
    h.receive(h.S.s2c_chat, { msg: message(2, 1, me, 0, '列阵') }); assert.equal(h.chat.requestInFlight('chat:send'), false);
    h.receive(h.S.s2c_sync_chat, { msg: message(2, 1, me, 0, '列阵') }); assert.equal(results.length, 1); assert.equal(results[0].success, true);
    assert.equal(h.proxy.getWorldChatList().length, 2);
});
test('发送超时不伪造消息、不自动重放；读消息超时可手动重试', () => {
    const h = harness(), results = []; h.events.on(h.E.chatSendResult, r => results.push(r), results);
    h.chat.chat('保留草稿'); h.timeout();
    assert.equal(results[0].success, false); assert.equal(h.proxy.getWorldChatList().length, 0); assert.equal(h.sent.length, 1);
    assert.equal(h.chat.chat('保留草稿'), true);
    h.chat.chatHistory(0); h.timeout(); assert.equal(h.chat.historyFailed(1), true);
    assert.equal(h.chat.chatHistory(0), true); assert.equal(h.chat.historyFailed(1), false);
});
test('私聊保留 int64 身份，拒绝自身/非法 ID、空内容、超长及无联盟发言', () => {
    const h = harness();
    for (const target of [me, '0', '-1', '1e3', '9223372036854775808', Number(peer)]) assert.equal(h.chat.chat('你好', 2, target), false);
    assert.equal(h.chat.chat('  '), false); assert.equal(h.chat.chat('甲'.repeat(201)), false);
    assert.equal(h.chat.chat('同盟好', 1), false); assert.equal(h.chat.chat('你好', 2, peer), true);
    assert.equal(h.sent[0].data.targetId, peer); assert.equal(h.sent[0].data.channel, 3);
});
test('退出联盟与注销清除旧频道、私聊和未读，不跨账号带出草稿', () => {
    const h = harness(); h.join(9); h.receive(h.S.s2c_sync_chat, { msg: message(1, 2) });
    assert.equal(h.proxy.unreadCount(2), 1); h.join(0); assert.equal(h.proxy.unreadCount(2), 0);
    h.receive(h.S.s2c_sync_chat, { msg: message(2, 3, peer, me) }); h.logout();
    assert.equal(h.proxy.recent().length, 0); assert.equal(h.proxy.conversations().length, 0); assert.equal(h.proxy.unreadCount(), 0);
    assert.equal(h.chat.chat('断线不发'), false);
});
test('发送成功只清对应草稿，发送途中继续编辑和失败草稿保持完整', () => {
    const h = harness(), Panel = h.load('chat/ChatLogic').default, panel = new Panel();
    panel.channel = 1; panel.input = { string: '旧消息', blur() {} }; panel.queueRefresh = () => {};
    panel.saveDraft(); panel.onSendResult({ channel: 1, targetId: 0, content: '旧消息', success: false });
    assert.equal(panel.input.string, '旧消息'); assert.equal(panel.drafts.get('1'), '旧消息');
    panel.input.string = '新草稿'; panel.saveDraft();
    panel.onSendResult({ channel: 1, targetId: 0, content: '旧消息', success: true });
    assert.equal(panel.input.string, '新草稿'); assert.equal(panel.drafts.get('1'), '新草稿');
    panel.onSendResult({ channel: 1, targetId: 0, content: '新草稿', success: true });
    assert.equal(panel.input.string, ''); assert.equal(panel.drafts.has('1'), false);
    panel.input.string = '不跨账号'; panel.node = { active: true }; panel.onLogout();
    assert.equal(panel.input.string, ''); assert.equal(panel.drafts.size, 0);
});
test('宽窄屏消息栏避开任务和导航，聊天面板包含完整输入区', () => {
    const h = harness(), { chatDockLayout, chatPanelLayout } = h.load('chat/ChatPresentation');
    for (const [w, h] of [[1280, 720], [960, 540], [844, 390], [390, 844], [360, 640]]) {
        const dock = chatDockLayout(w, h), panel = chatPanelLayout(w, h);
        assert.ok(dock.x - dock.width / 2 >= -w / 2 && dock.x + dock.width / 2 <= w / 2);
        assert.ok(dock.taskBottom > dock.y + h / 2 + dock.height / 2);
        if (w < 720) assert.ok(dock.y - dock.height / 2 + h / 2 >= 92);
        assert.ok(panel.width * panel.scale <= w && panel.height * panel.scale <= h);
    }
});
console.log(`通过 ${passed} 项聊天回归`);
