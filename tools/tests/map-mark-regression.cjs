// 地图标记：真实协议编解码，测试网络隔离，不修改服务器收藏。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
const protobuf = require(path.join(scripts, '3rd/protobuf.js'));
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function harness() {
    const modules = new Map(), timers = new Map(), sent = [], toasts = [];
    let serial = 0, proto;
    const cc = { JsonAsset: class {} };
    function load(key) {
        key = key.replace(/\\/g, '/').replace(/\.ts$/, '');
        if (key.endsWith('.js')) return { default: require(path.join(scripts, key)) };
        if (key === 'network/socket/NetManager') return { NetManager: { getInstance: () => ({ send(packet) {
            assert.ok(packet.msg instanceof Uint8Array); assert.ok(proto.getIdByMsgType(packet.name));
            sent.push({ name: packet.name, data: plain(proto.decode(packet.name, packet.msg)) });
        } }) } };
        if (modules.has(key)) return modules.get(key).exports;
        const mod = { exports: {} }; modules.set(key, mod);
        const file = path.join(scripts, key + '.ts');
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        } }).outputText;
        vm.runInNewContext(code, { module: mod, exports: mod.exports, protobuf, console: { log() {}, warn() {}, error() {} },
            setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
            require: name => name === 'cc' ? cc : load(path.relative(scripts, path.resolve(path.dirname(file), name))),
        }, { filename: file });
        return mod.exports;
    }
    proto = load('network/pto/ProtoManager').ProtoManager.getInstance();
    const dir = path.join(root, 'assets/resources/protbuf/pto');
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.proto'))) {
        proto.mergeRoot(proto._root, protobuf.parse(fs.readFileSync(path.join(dir, name), 'utf8')).root);
    }
    proto.parseIdMap(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define); proto._isReady = true;
    const S = load('config/ServerConfig').ServerConfig, E = load('common/LogicEvent').LogicEvent, events = load('utils/EventMgr').EventMgr;
    const cfg = load('core/ConfigManager').default.getInstance();
    cfg.loadConfigs([{ name: 'Global', json: JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/Global.json'), 'utf8')) }]);
    const cmd = load('world/MapMarkCommand').default.getInstance();
    events.on(E.showToast, text => toasts.push(text), toasts);
    const receive = (name, data = {}) => events.emit(name, proto.decode(name, proto.encode(name, data)));
    const login = () => { receive(S.s2c_user_login_ok); receive(S.s2c_client_load_ok); };
    const snapshot = (list = []) => receive(S.s2c_req_mark_list, { markList: list.map(pos => ({ pos })) });
    return { cmd, S, E, events, receive, login, snapshot, cfg, sent, timers, toasts, load, proto };
}
test('新协议 ID 与共享协议一致，进入游戏自动读取且重复请求合并', () => {
    const h = harness(), ids = JSON.parse(fs.readFileSync(path.join(root, 'external/game_common/client/net_pb.json'), 'utf8')).define.World;
    for (const name of ['c2s_req_mark_list','s2c_req_mark_list','c2s_add_mark','s2c_add_mark','c2s_del_mark','s2c_del_mark']) {
        assert.equal(h.proto.getIdByMsgType(h.S[name]), ids[name]);
    }
    assert.equal(h.cmd.requestList(), false); h.login();
    assert.equal(h.sent.length, 1); assert.equal(h.cmd.loading, true); assert.equal(h.cmd.requestList(), false);
    h.snapshot(); assert.equal(h.cmd.loaded, true); assert.equal(h.cmd.limit, 10);
});
test('添加和删除仅发送坐标，服务端确认前保留旧状态，连点不重复发送', () => {
    const h = harness(); h.login(); h.snapshot(); const pos = { x: 0, y: 999 };
    assert.equal(h.cmd.add(pos), true); assert.equal(h.cmd.add(pos), false); assert.equal(h.cmd.add({x:2,y:2}), false);
    assert.deepEqual(h.sent.at(-1), { name: h.S.c2s_add_mark, data: { pos } });
    assert.equal(h.cmd.has(pos), false); assert.equal(h.cmd.busy, true);
    h.receive(h.S.s2c_add_mark, { markInfo: { pos } });
    h.receive(h.S.s2c_add_mark, { markInfo: { pos } });
    assert.equal(h.cmd.marks.values().length, 1); assert.equal(h.cmd.busy, false);
    assert.equal(h.cmd.remove(pos), true); assert.equal(h.cmd.has(pos), true);
    assert.deepEqual(h.sent.at(-1), { name: h.S.c2s_del_mark, data: { pos } });
    h.receive(h.S.s2c_del_mark, { pos });
    assert.equal(h.cmd.has(pos), false); assert.equal(h.cmd.remove(pos), false);
});
test('数量上限取配置，满额和非法坐标均不发送，允许地图边界格', () => {
    const h = harness(); h.cfg.loadConfigs([{name:'Global',json:[{Id:18,value1:2}]}]);
    h.login(); h.snapshot([{x:0,y:0},{x:999,y:999}]);
    const count = h.sent.length;
    assert.equal(h.cmd.add({x:1,y:1}), false); assert.match(h.toasts.at(-1), /上限（2个）/);
    for (const pos of [{x:-1,y:0},{x:1000,y:0},{x:1.2,y:0},{x:0,y:NaN},null]) assert.equal(h.cmd.add(pos), false);
    assert.equal(h.sent.length, count); assert.equal(h.cmd.remove({x:999,y:999}), true);
});
test('全量查询途中新增和删除优先于旧快照，重复坐标不重复显示', () => {
    const h = harness(); h.login(); const old={x:1,y:1}, latest={x:2,y:2};
    h.snapshot([old]); h.cmd.requestList();
    h.receive(h.S.s2c_add_mark, {markInfo:{pos:latest}});
    h.receive(h.S.s2c_del_mark, {pos:old});
    h.snapshot([old,old]);
    assert.deepEqual(plain(h.cmd.marks.values()), [latest]);
});
test('超时只拉取状态核对，迟到确认保留，不自动重放增删请求', () => {
    const h = harness(); h.login(); h.snapshot(); const pos={x:30,y:40}; h.cmd.add(pos);
    const [id, timeout]=h.timers.entries().next().value; h.timers.delete(id); timeout();
    assert.equal(h.cmd.busy,false); assert.equal(h.cmd.loading,true); assert.equal(h.cmd.loaded,false);
    assert.equal(h.cmd.add(pos),false);
    assert.equal(h.sent.filter(p=>p.name===h.S.c2s_add_mark).length,1);
    h.receive(h.S.s2c_add_mark,{markInfo:{pos}}); h.snapshot();
    assert.equal(h.cmd.has(pos),true); assert.equal(h.cmd.loaded,true);
});
test('畸形列表保留原数据并提供重试，断线清空标记，重连重新读取', () => {
    const h = harness(); h.login(); const pos={x:5,y:5}; h.snapshot([pos]); h.cmd.requestList();
    h.receive(h.S.s2c_req_mark_list,{markList:[{pos:{x:-1,y:0}}]});
    assert.equal(h.cmd.has(pos),true); assert.ok(h.cmd.error); assert.equal(h.cmd.requestList(),true);
    h.events.emit(h.load('network/socket/NetInterface').NetEvent.ServerDisconnected);
    assert.equal(h.cmd.loaded,false); assert.equal(h.cmd.marks.values().length,0); assert.equal(h.timers.size,0);
    h.receive(h.S.s2c_add_mark,{markInfo:{pos}}); assert.equal(h.cmd.has(pos),false);
    h.login(); assert.equal(h.cmd.loading,true); h.snapshot([pos]); assert.equal(h.cmd.has(pos),true);
});
console.log(passed + ' groups passed');
