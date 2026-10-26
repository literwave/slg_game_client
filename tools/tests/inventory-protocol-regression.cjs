// 背包回归：真实 protobuf 编解码，隔离网络与编辑器。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
const protobuf = require(path.join(scripts, '3rd/protobuf.js'));
const uid = '9007199254740993', other = '9007199254740995';
const table = name => JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name + '.json'), 'utf8'));
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function harness() {
    const modules = new Map(), timers = new Map(), sent = []; let serial = 0, proxy, proto;
    const cc = { _decorator: { ccclass: () => t => t, property: () => () => {} }, JsonAsset: class {} };
    function load(key) {
        key = key.replace(/\\/g, '/').replace(/\.ts$/, '');
        if (key.endsWith('.js')) return { default: require(path.join(scripts, key)) };
        if (key === 'login/LoginCommand') return { default: { getInstance: () => ({ proxy }) } };
        if (key === 'network/socket/NetManager') return { NetManager: { getInstance: () => ({ send(packet) {
            assert.ok(packet.msg instanceof Uint8Array);
            assert.ok(proto.getIdByMsgType(packet.name));
            sent.push({ name: packet.name, data: proto.decode(packet.name, packet.msg) });
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
    const loginProxy = load('login/LoginProxy'); proxy = new loginProxy.default();
    proto = load('network/pto/ProtoManager').ProtoManager.getInstance();
    const dir = path.join(root, 'assets/resources/protbuf/pto');
    for (const file of fs.readdirSync(dir).filter(n => n.endsWith('.proto'))) {
        proto.mergeRoot(proto._root, protobuf.parse(fs.readFileSync(path.join(dir, file), 'utf8')).root);
    }
    proto.parseIdMap(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define); proto._isReady = true;
    const S = load('config/ServerConfig').ServerConfig, E = load('common/LogicEvent').LogicEvent, events = load('utils/EventMgr').EventMgr;
    const cmd = load('inventory/InventoryCommand').default.getInstance();
    // 与 LoginCommand 相同的数据层桥接；增量本身仍经真实线协议传输。
    events.on(S.s2c_sync_item_data, data => {
        if (proxy.updateItemData(data.itemUid, data.itemId, data.itemCnt)) events.emit(E.itemSynced, data);
    }, {});
    const receive = (name, data = {}) => events.emit(name, proto.decode(name, proto.encode(name, data)));
    const login = () => { receive(S.s2c_user_login_ok); receive(S.s2c_client_load_ok); };
    load('core/ConfigManager').default.getInstance().loadConfigs([{ name: 'Item', json: table('Item') }]);
    return { proxy, cmd, proto, S, E, events, receive, login, timers, sent, load, normalize: loginProxy.normalizeItemStack };
}

test('新消息 ID 来自当前协议表，加载完成后自动拉取且并发打开只请求一次', () => {
    const h = harness(), ids = JSON.parse(fs.readFileSync(path.join(root, 'external/game_common/client/net_pb.json'), 'utf8')).define.Item;
    assert.equal(h.proto.getIdByMsgType(h.S.c2s_req_all_item_data), ids.c2s_req_all_item_data);
    assert.equal(h.proto.getIdByMsgType(h.S.s2c_req_all_item_data), ids.s2c_req_all_item_data);
    assert.equal(h.cmd.requestItems(), false); h.login();
    assert.equal(h.sent.length, 1); assert.equal(h.cmd.loading, true);
    assert.equal(h.cmd.requestItems(), false); assert.equal(h.sent.length, 1);
});
test('大 int64 堆叠 ID 无损，多堆叠合计且单条同步覆盖而非累加', () => {
    const h = harness(); h.login();
    h.receive(h.S.s2c_req_all_item_data, { itemList: [
        { itemUid: uid, itemId: 11001, itemCnt: 10 }, { itemUid: other, itemId: 11001, itemCnt: 5 },
    ] });
    assert.equal(h.cmd.loaded, true); assert.equal(h.proxy.getItemCount(11001), 15);
    assert.equal(h.cmd.items[0].stacks, 2);
    h.receive(h.S.s2c_sync_item_data, { itemUid: uid, itemId: 11001, itemCnt: 8 });
    assert.equal(h.proxy.getItemCount(11001), 13);
    h.receive(h.S.s2c_sync_item_data, { itemUid: other, itemId: 11001, itemCnt: 0 });
    assert.equal(h.proxy.getItemCount(11001), 8); assert.equal(h.cmd.items[0].stacks, 1);
});
test('查询期间的增改删覆盖旧快照，删除项不会复活', () => {
    const h = harness(); h.login();
    h.receive(h.S.s2c_sync_item_data, { itemUid: uid, itemId: 103, itemCnt: 0 });
    h.receive(h.S.s2c_sync_item_data, { itemUid: other, itemId: 101, itemCnt: 7 });
    h.receive(h.S.s2c_req_all_item_data, { itemList: [
        { itemUid: uid, itemId: 103, itemCnt: 10 }, { itemUid: other, itemId: 101, itemCnt: 1 },
    ] });
    assert.equal(h.proxy.getItemCount(103), 0); assert.equal(h.proxy.getItemCount(101), 7);
    assert.equal(h.cmd.items.length, 1);
});
test('空快照清除旧道具且已知零数量不回退旧资源余额', () => {
    const h = harness(); h.proxy.setRoleResData({ resList: [{ k: 1, v: 999 }] });
    assert.equal(h.proxy.getItemCount(1), 999);
    h.proxy.updateItemData(1, 1, 10); h.proxy.updateItemData(1, 1, 0);
    assert.equal(h.proxy.getItemCount(1), 0); assert.equal(h.cmd.items.length, 0);
    h.login(); h.receive(h.S.s2c_req_all_item_data, { itemList: [] });
    assert.equal(h.cmd.loaded, true); assert.equal(h.cmd.items.length, 0);
    assert.equal(h.proxy.getItemCount(1), 0); assert.equal(h.proxy.hasItemCount(103), true);
});
test('无效/重复快照保留上一份正确数据，畸形 ID 和负数数量被拒绝', () => {
    const h = harness(); h.login();
    h.receive(h.S.s2c_req_all_item_data, { itemList: [{ itemUid: uid, itemId: 103, itemCnt: 4 }] });
    h.cmd.requestItems();
    h.events.emit(h.S.s2c_req_all_item_data, { itemList: [{ itemUid: uid, itemId: 103, itemCnt: -1 }] });
    assert.ok(h.cmd.loadError); assert.equal(h.proxy.getItemCount(103), 4);
    assert.equal(h.proxy.replaceItemData([{ itemUid: uid, itemId: 103, itemCnt: 1 }, { itemUid: uid, itemId: 103, itemCnt: 2 }]), false);
    assert.equal(h.proxy.getItemCount(103), 4);
    for (const itemUid of [9007199254740992, '9223372036854775808', '-1', 'x', '0']) {
        assert.equal(h.normalize({ itemUid, itemId: 103, itemCnt: 1 }), null);
    }
    assert.equal(h.normalize({ itemUid: '9223372036854775807', itemId: 103, itemCnt: 1 }).itemUid, '9223372036854775807');
});
test('超时可重试，断线清空库存与请求锁，重连重新查询', () => {
    const h = harness(); h.login();
    const timeout = h.timers.values().next().value; timeout();
    assert.equal(h.cmd.loading, false); assert.ok(h.cmd.loadError); assert.equal(h.cmd.requestItems(), true);
    h.receive(h.S.s2c_req_all_item_data, { itemList: [{ itemUid: uid, itemId: 1001, itemCnt: 1 }] });
    h.events.emit(h.load('network/socket/NetInterface').NetEvent.ServerDisconnected);
    assert.equal(h.cmd.loaded, false); assert.equal(h.cmd.items.length, 0); assert.equal(h.cmd.requestItems(), false);
    h.receive(h.S.s2c_req_all_item_data, { itemList: [{ itemUid: uid, itemId: 1001, itemCnt: 88 }] });
    assert.equal(h.cmd.items.length, 0);
    h.login(); assert.equal(h.cmd.loading, true);
});
test('分类按用途区分，入口只导航到已经接通的功能', () => {
    const h = harness(), p = h.load('inventory/InventoryPresentation');
    assert.equal(p.inventoryCategory(1), 'resource'); assert.equal(p.inventoryCategory(11001), 'fragment');
    assert.equal(p.inventoryCategory(101), 'item'); assert.equal(p.inventoryAction(103).destination, 'lottery');
    assert.equal(p.inventoryAction(101).destination, undefined); assert.equal(p.inventoryAction(102).destination, undefined);
    for (const [width, height] of [[1280, 720], [375, 812], [320, 568], [568, 320], [812, 375]]) {
        const m = p.inventoryLayout(width, height);
        assert.ok(m.width * m.scale <= width - 31 && m.height * m.scale <= height - 31);
        assert.ok(m.gridWidth > 0 && m.gridHeight > 0 && m.columns >= 2);
    }
});
console.log(passed + ' groups passed');
