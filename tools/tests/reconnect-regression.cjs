// 使用虚拟时钟和 WebSocket 验证重连，不连接服务器或操作 Preview。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function fixture() {
    let now = 0, serial = 0;
    const timers = new Map(), sockets = [], packets = [], retries = [], failures = [];
    const timeout = (fn, delay = 0, interval = 0) => {
        const id = ++serial; timers.set(id, { fn, at: now + delay, interval }); return id;
    };
    function advance(ms) {
        const end = now + ms;
        let guard = 0;
        while (true) {
            const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            assert.ok(++guard < 10000, 'timer loop');
            const [id, task] = next; now = task.at; timers.delete(id);
            if (task.interval) timers.set(id, { ...task, at: now + task.interval });
            task.fn();
        }
        now = end;
    }
    class Socket {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        constructor(url) { this.url = url; this.readyState = Socket.CONNECTING; sockets.push(this); }
        open() { this.readyState = Socket.OPEN; this.onopen?.({}); }
        fail() {
            const error = this.onerror, closed = this.onclose;
            error?.({}); this.readyState = Socket.CLOSED; closed?.({});
        }
        remoteClose() { this.readyState = Socket.CLOSED; this.onclose?.({}); }
        close() { this.readyState = Socket.CLOSED; }
        send(data) { packets.push(data); }
    }
    class Component {
        constructor() { this.isValid = true; this.jobs = new Map(); }
        scheduleOnce(fn, seconds = 0) {
            const id = timeout(() => { this.jobs.delete(id); fn.call(this); }, seconds * 1000);
            this.jobs.set(id, fn);
        }
        unschedule(fn) { for (const [id, cb] of this.jobs) if (fn === cb) { timers.delete(id); this.jobs.delete(id); } }
        unscheduleAllCallbacks() { for (const id of this.jobs.keys()) timers.delete(id); this.jobs.clear(); }
    }
    const engine = { Component, Color: class {}, Node: class {}, Prefab: class {},
        EditBox: { InputFlag: { PASSWORD: 1, DEFAULT: 0 } },
        _decorator: { ccclass: () => type => type, property: () => () => {} },
    };
    function load(file, imports = {}, fallback) {
        const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
            fileName: file, reportDiagnostics: true,
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
        });
        assert.equal(compiled.diagnostics.length, 0, file);
        const module = { exports: {} };
        vm.runInNewContext(compiled.outputText, {
            module, exports: module.exports, require(id) {
                if (id === 'cc') return engine;
                if (Object.hasOwn(imports, id)) return imports[id];
                if (fallback) return fallback(id);
                throw new Error(`Unmocked import ${file}: ${id}`);
            },
            console: { log() {}, debug() {}, info() {}, warn() {}, error() {} }, WebSocket: Socket,
            ArrayBuffer, Uint8Array, DataView, setTimeout: timeout, clearTimeout: id => timers.delete(id),
            setInterval: (fn, delay) => timeout(fn, delay, delay), clearInterval: id => timers.delete(id),
        }, { filename: file });
        return module.exports;
    }
    const { EventMgr } = load('assets/scripts/utils/EventMgr.ts');
    const iface = load('assets/scripts/network/socket/NetInterface.ts'), { NetEvent } = iface;
    const { LogicEvent } = load('assets/scripts/common/LogicEvent.ts');
    const { ServerConfig: S } = load('assets/scripts/config/ServerConfig.ts');
    const proto = { ProtoManager: { getInstance: () => ({
        encode: () => new Uint8Array([1]), getIdByMsgType: () => 1, getMsgTypeById: () => 'Test.message', decode: () => ({ ok: true }),
    }) } };
    const web = load('assets/scripts/network/socket/WebSock.ts', {
        '../../libs/crypto/crypto': {}, '../pto/ProtoManager': proto, '../../config/GameConfig': { GameConfig: {} },
    });
    const nodeModule = load('assets/scripts/network/socket/NetNode.ts', {
        './NetInterface': iface, './NetTimer': { NetTimer: class { init() {} destroy() {} } }, './WebSock': web,
        '../../utils/EventMgr': { EventMgr },
    });
    const node = new nodeModule.NetNode(); node.init();
    const manager = { connect: options => node.connect(options), close: () => node.closeSocket(),
        dropConnection: () => node.dropConnection(), send: data => node.send(data) };
    EventMgr.on(NetEvent.ServerReconnecting, s => retries.push(s), retries);
    EventMgr.on(NetEvent.ServerReconnectFailed, s => failures.push(s), failures);
    const loginData = { userId: 1, token: 'test-token', account: 'test', gateAddr: 'ws://gate.test' };
    const Command = load('assets/scripts/login/LoginCommand.ts', {
        '../config/ServerConfig': { ServerConfig: S }, '../network/socket/NetManager': { NetManager: { getInstance: () => manager } },
        '../utils/Tools': { Tools: {} }, './LoginProxy': load('assets/scripts/login/LoginProxy.ts'),
        '../network/socket/NetInterface': iface, '../utils/LocalCache': { LocalCache: { setLoginValidation() {} } },
        '../utils/DateUtil': { default: { monotonicNow: () => now } }, '../utils/EventMgr': { EventMgr },
        '../libs/crypto/md5': { Md5: { encrypt: value => value } }, '../common/LogicEvent': { LogicEvent },
        '../network/pto/ProtoManager': proto, './HeadIconProxy': { default: class { clear() {} } },
        '../systemopen/SystemOpenCommand': { default: { getInstance: () => ({ clearData() {}, requestSystemOpen() {} }) } },
    }).default;
    const command = Command.getInstance(); command.proxy.saveLoginData(loginData);
    command.startHeartbeat = () => {};
    const Login = load('assets/scripts/login/LoginLogic.ts', {
        '../utils/LocalCache': { LocalCache: { getLoginValidation: () => null, getPersonMemory: (_k, d) => d, setPersonMemory() {} } },
        './LoginCommand': { default: Command }, '../utils/EventMgr': { EventMgr },
        '../common/AudioManager': { AudioManager: { instance: { playClick() {} } } }, '../common/LogicEvent': { LogicEvent },
        '../network/socket/NetManager': { NetManager: { getInstance: () => manager } },
        '../config/GameConfig': { GameConfig: { loginUrl: 'ws://login.test', serverUrl: 'ws://gate.test' } },
        '../network/socket/NetNode': nodeModule, '../network/socket/NetInterface': iface,
        '../utils/Tools': { Tools: {} }, './EnterTransitionLogic': { default: class {} },
    }).default;
    function page() {
        const p = new Login(); p.node = { getChildByName: () => null };
        p.editName = { string: 'test' }; p.editPass = { string: '' }; p.loadEnterPrefab = () => {};
        p.onLoad(); return p;
    }
    return { node, sockets, timers, packets, retries, failures, advance, EventMgr, NetEvent, LogicEvent,
        S, command, page, load, gate: { url: 'ws://gate.test', type: nodeModule.NetNodeType.GateServer },
        ready(name = '主公') { EventMgr.emit(S.s2c_user_login_ok, {}); EventMgr.emit(S.s2c_user_base_info, { name }); },
    };
}

test('服务器离线只自动重连三次，耗尽后停止所有连接和定时器', () => {
    const f = fixture(); f.node.connect(f.gate);
    for (let i = 0; i < 4; i++) { f.sockets.at(-1).fail(); if (i < 3) f.advance(2000); }
    assert.equal(f.sockets.length, 4, '首次连接加三次自动重连');
    assert.deepEqual(f.retries.map(s => s.attempt), [1, 2, 3]);
    assert.equal(f.failures.length, 1); assert.equal(f.timers.size, 0);
    f.advance(60000); f.node.send({ name: 'Old.request' }); f.node.dropConnection(); f.node.tryConnet();
    assert.equal(f.sockets.length, 4); assert.equal(f.failures.length, 1);
});

test('连接一直处于 CONNECTING 也在十秒超时，不能无限等待', () => {
    const f = fixture(); f.node.connect(f.gate); f.advance(46000);
    assert.equal(f.sockets.length, 4); assert.equal(f.failures.length, 1); assert.equal(f.timers.size, 0);
});

test('WebSocket 打开但无登录验证回包不会重置重试预算', () => {
    const f = fixture(); f.node.connect(f.gate);
    for (let i = 0; i < 4; i++) { f.sockets.at(-1).open(); f.advance(10000); if (i < 3) f.advance(2000); }
    assert.equal(f.sockets.length, 4); assert.equal(f.failures.length, 1); assert.equal(f.timers.size, 0);
});

test('只有 login_ok 没有基础信息仍然超时；完整恢复后下一次掉线可重新尝试', () => {
    const f = fixture(); f.node.connect(f.gate); f.sockets[0].open();
    f.EventMgr.emit(f.S.s2c_user_login_ok, {}); f.advance(10000);
    assert.equal(f.retries.length, 1);
    f.advance(2000); f.sockets.at(-1).open();
    let success = 0; f.EventMgr.on(f.NetEvent.ServerReconnectSuccess, () => success++, {});
    f.ready(); assert.equal(success, 1); assert.equal(f.timers.size, 0);
    f.advance(60000); assert.equal(f.failures.length, 0);
    f.sockets.at(-1).remoteClose(); assert.equal(f.retries.at(-1).attempt, 1);
});

test('尚未创建角色也算验证完成，不会在创建页继续重连', () => {
    const f = fixture(); f.node.connect(f.gate); f.sockets[0].open(); f.ready(''); f.advance(60000);
    assert.equal(f.failures.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.sockets.length, 1);
});

test('返回登录会取消等待中的重试，迟到回调不能干扰新的连接', () => {
    const f = fixture(); f.node.connect(f.gate);
    const old = f.sockets[0], callbacks = [old.onopen, old.onerror, old.onclose, old.onmessage];
    old.fail(); f.node.closeSocket(); f.advance(60000);
    assert.equal(f.sockets.length, 1); assert.equal(f.timers.size, 0);
    f.node.connect(f.gate); const current = f.sockets.at(-1);
    let messages = 0; f.EventMgr.on('Test.message', () => messages++, {});
    for (const callback of callbacks) callback({ data: new ArrayBuffer(4) });
    assert.equal(messages, 0); assert.equal(f.failures.length, 0); assert.equal(f.sockets.length, 2);
    current.open(); f.ready(); assert.equal(f.timers.size, 0);
});

test('连接失败后清除待发请求，不跨连接重放旧写请求', () => {
    const f = fixture(); f.node.connect(f.gate);
    f.node.send({ name: 'Mutation', msg: new Uint8Array([1]) }); f.sockets[0].fail();
    f.advance(2000); const sent = [];
    f.node._socket.packAndSend = data => sent.push(data.name); f.sockets.at(-1).open();
    assert.deepEqual(sent, [f.S.c2s_verify_login]);
});

test('配置不能启用永久重连，显式关闭自动重试时仅连接一次', () => {
    const f = fixture(); f.node.connect({ ...f.gate, autoReconnect: -1 }); f.advance(46000);
    assert.equal(f.sockets.length, 4); assert.equal(f.failures.length, 1);
    f.node.connect({ ...f.gate, autoReconnect: 0 }); f.sockets.at(-1).fail(); f.advance(60000);
    assert.equal(f.sockets.length, 5); assert.equal(f.failures.length, 2);
});

test('登录页保持空闲，点击登录才连接，登录超时后也不会后台重试', () => {
    const f = fixture(), p = f.page(); f.advance(60000); assert.equal(f.sockets.length, 0);
    p.agreementAccepted = true; p.editPass.string = 'test'; p.onClickLogin();
    assert.equal(f.sockets.length, 1); f.sockets[0].open(); f.advance(12000);
    assert.equal(p.loginPending, false); assert.equal(f.sockets[0].readyState, 3);
    f.advance(60000); assert.equal(f.sockets.length, 1); assert.equal(f.timers.size, 0);
});

test('进入过渡页后手动返回会取消尚未执行的网关连接', () => {
    const f = fixture(), p = f.page(); p.beginEnterWorld(); p.backToLogin(); f.advance(60000);
    assert.equal(f.sockets.length, 0); assert.equal(f.timers.size, 0);
    p.beginEnterWorld(); p.onDestroy(); f.advance(60000);
    assert.equal(f.sockets.length, 0); assert.equal(p.enterStarted, false);
});

test('加载页显示真实重试次数；三次失败直接切回登录并停止请求', () => {
    const f = fixture(), p = f.page(), stages = [];
    p.enterLogic = { setStage: (_progress, text) => stages.push(text), hide() {} };
    p.showEnterOverlay = () => {};
    const Main = f.load('assets/scripts/Main.ts', {
        './utils/EventMgr': { EventMgr: f.EventMgr }, './common/LogicEvent': { LogicEvent: f.LogicEvent },
    }, () => ({ default: class {} })).default;
    const main = new Main(); let loginEntries = 0, toast = '';
    main.showTopToast = message => { toast = message; };
    f.EventMgr.on(f.NetEvent.ServerReconnectFailed, main.onServerReconnectFailed, main);
    f.EventMgr.on(f.LogicEvent.enterLogin, () => { loginEntries++; p.backToLogin(); }, {});
    p.beginEnterWorld(); f.advance(500);
    for (let i = 0; i < 4; i++) { f.sockets.at(-1).fail(); if (i < 3) f.advance(2000); }
    assert.equal(loginEntries, 1); assert.match(toast, /返回登录/);
    assert.ok(stages.some(s => s.includes('1/3'))); assert.ok(stages.some(s => s.includes('3/3')));
    assert.equal(p.enterStarted, false); f.advance(60000);
    assert.equal(f.sockets.length, 4); assert.equal(f.timers.size, 0);
});

console.log(`通过 ${passed} 项重连回归`);
