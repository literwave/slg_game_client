// 使用真实 protobuf 和请求生命周期验证公开资料，离线执行，不向玩家发送消息。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require(process.argv[2]), root = path.resolve(__dirname, '../..');
const scripts = path.join(root, 'assets/scripts'), protobuf = require(path.join(scripts, '3rd/protobuf.js'));
const me = '9007199254740993', peer = '9007199254740995', other = '9007199254740997';

function harness() {
    const modules = new Map(), sent = [], timers = new Map(), iconRequests = [];
    let timerId = 0, sending = true;
    class Component { isValid = true; }
    class UITransform { width = 1; height = 1; setContentSize(w, h) { this.width = w; this.height = h; } setAnchorPoint() {} }
    class Node {
        static EventType = { SIZE_CHANGED: 'size' };
        constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.events = new Map(); this.active = true; this.layer = 1; }
        get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
        addChild(n) { n.parent = this; this.children.push(n); }
        getChildByName(name) { return this.children.find(n => n.name === name); }
        addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
        getComponent(Type) { return this.components.get(Type) || null; }
        on(name, fn, target) { this.events.set(name, (...args) => fn.apply(target, args)); }
        setPosition(x, y) { this.position = { x, y }; } setScale() {} setSiblingIndex() {}
        click() { assert.notEqual(this.getComponent(Button)?.interactable, false); this.events.get('click')?.(); }
    }
    class Label { static HorizontalAlign = { CENTER: 1 }; static Overflow = { SHRINK: 1 }; }
    class Sprite { static SizeMode = { CUSTOM: 1 }; isValid = true; spriteFrame = null; }
    class Button { static EventType = { CLICK: 'click' }; interactable = true; }
    class Widget {
        static AlignMode = { ALWAYS: 1 };
        updateAlignment() { const parent = this.node.parent?.getComponent(UITransform); if (parent) this.node.getComponent(UITransform).setContentSize(parent.width, parent.height); }
    }
    class SafeArea { updateArea() { this.node.getComponent(Widget).updateAlignment(); } }
    class Color {}
    const cc = { Component, Node, UITransform, Label, Sprite, Button, Widget, SafeArea, Color,
        Canvas: class {}, BlockInputEvents: class {}, _decorator: { ccclass: () => c => c, property: () => () => {} } };
    const own = { userId: me, name: '自己', headIcon: 1, soldier: 1234, resource: 5678 };
    const login = { proxy: { getRoleData: () => own }, headIcons: {
        getDisplayId: id => id || 1, getIconPath: id => `ui/head_icon/avatar_${id}`,
        loadIcon: id => new Promise(resolve => iconRequests.push({ id, resolve })),
    } };
    const style = {
        ManagementColors: { ink: {}, gold: {}, muted: {}, text: {} },
        place(node, x, y, w, h) { node.setPosition(x, y); node.getComponent(UITransform).setContentSize(w, h); },
        inkSurface() {}, panelButton(node, text) { node.caption = text; },
        caption(parent, name, text) {
            let n = parent.getChildByName(name);
            if (!n) { n = new Node(name); parent.addChild(n); n.addComponent(UITransform); n.addComponent(Label); }
            const label = n.getComponent(Label); label.string = text; return label;
        },
    };
    const stubs = {
        'login/LoginCommand': { default: { getInstance: () => login } },
        'network/socket/NetManager': { NetManager: { getInstance: () => ({ send(packet) {
            if (!sending) return false;
            sent.push({ name: packet.name, data: proto.decode(packet.name, packet.msg) }); return true;
        } }) } },
        'map/ui/ManagementStyle': style,
        'map/ui/TaskBoardView': { gameCloseButton() {}, taskWindowTrim() {} },
        'utils/DateUtil': { default: { converTimeStr: () => '11-04 12:00' } },
        'common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
        'union/UnionCommand': { default: {} },
    };
    function load(name) {
        name = name.replace(/\\/g, '/').replace(/\.ts$/, '');
        if (stubs[name]) return stubs[name];
        if (modules.has(name)) return modules.get(name).exports;
        if (name.endsWith('.js')) return { default: require(path.join(scripts, name)) };
        const file = path.join(scripts, name + '.ts'), module = { exports: {} }; modules.set(name, module);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
        vm.runInNewContext(code, { module, exports: module.exports, protobuf,
            console: { log() {}, warn() {}, error() {} },
            setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
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
    const cmd = load('login/OtherUserCommand').default.getInstance();
    const receive = (name, data = {}) => events.emit(name, proto.decode(name, proto.encode(name, data)));
    return { cmd, proto, events, E, S, sent, iconRequests, own, load, cc,
        login() { receive(S.s2c_user_login_ok); receive(S.s2c_client_load_ok); },
        receive(data) { receive(S.s2c_req_other_user, data); },
        timeout() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
        canSend(value) { sending = value; },
        panel() {
            const parent = new Node('Content'); parent.addComponent(UITransform).setContentSize(1280, 720);
            const node = new Node('PlayerProfilePanel'); parent.addChild(node);
            return node.addComponent(load('map/ui/PlayerProfilePanel').default);
        },
    };
}
const profile = (uid = peer, extra = {}) => ({ uid, name: '青山', headIcon: 1043, sex: 1, level: 12,
    power: '9007199254740999', cityLevel: 8, allianceId: '9007199254741001', allianceName: '同袍', offlineTime: 0, ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
    {
        const h = harness();
        assert.equal(h.cmd.requestProfile(peer), false, '登录前不能发送');
        h.login(); assert.equal(h.cmd.requestProfile(peer), true); assert.equal(h.cmd.requestProfile(peer), false);
        assert.equal(h.sent[0].name, 'User.c2s_req_other_user'); assert.equal(h.sent[0].data.uid, peer);
        const own = JSON.stringify(h.own); h.receive(profile());
        assert.equal(h.cmd.profiles.get(peer).power, '9007199254740999');
        assert.equal(h.cmd.profiles.get(peer).allianceId, '9007199254741001');
        assert.equal(h.cmd.requestInFlight(`profile:${peer}`), false);
        assert.equal(JSON.stringify(h.own), own, '查看他人不覆盖自己的资源、兵力或头像');
        assert.equal(h.cmd.profiles.get(peer).soldierInfo, undefined);
        console.log('PASS 真实公开资料 protobuf、int64 身份和战力、去重及本人数据隔离');
    }
    {
        const h = harness(); h.login();
        for (const id of [0, -1, '01', '1e3', '9223372036854775808', Number(peer)]) assert.equal(h.cmd.requestProfile(id), false);
        assert.equal(h.sent.length, 0);
        h.cmd.requestProfile(peer); h.receive(profile(other));
        assert.equal(h.cmd.profiles.size, 0); assert.equal(h.cmd.requestInFlight(`profile:${peer}`), true);
        h.receive({ uid: peer });
        assert.equal(h.cmd.isMissing(peer), true); assert.equal(h.cmd.hasFailed(peer), false);
        assert.equal(h.cmd.requestInFlight(`profile:${peer}`), false);
        h.cmd.requestProfile(peer); assert.equal(h.cmd.isMissing(peer), false); h.receive(profile());
        console.log('PASS 非法目标拒绝、回包按玩家归属匹配、空资料明确区分且可重试');
    }
    {
        const h = harness(); h.login(); h.cmd.requestProfile(peer); h.timeout();
        assert.equal(h.cmd.hasFailed(peer), true); assert.equal(h.cmd.isMissing(peer), false);
        assert.equal(h.sent.length, 1, '超时不重复发送');
        h.canSend(false); assert.equal(h.cmd.requestProfile(peer), false);
        assert.equal(h.cmd.requestInFlight(`profile:${peer}`), false);
        h.canSend(true); h.cmd.requestProfile(peer); h.receive(profile());
        assert.equal(h.cmd.hasFailed(peer), false);
        h.events.emit(h.E.enterLogin); h.receive(profile());
        assert.equal(h.cmd.profiles.size, 0); assert.equal(h.cmd.sessionReady, false);
        console.log('PASS 超时/断线/发送失败释放请求，重试恢复，注销后迟到回包丢弃');
    }
    {
        const h = harness(); h.login(); const panel = h.panel(), text = name => panel.panel.getChildByName(name).getComponent(h.cc.Label).string;
        panel.show(peer); panel.show(other); h.receive(profile(peer, { name: '甲' }));
        assert.equal(text('Name'), '主公', '甲回包不能冒充正在查看的乙');
        h.receive(profile(other, { name: '乙', headIcon: 1044, offlineTime: 1000 }));
        assert.equal(text('Name'), '乙'); assert.equal(text('Presence'), '离线 · 11-04 12:00');
        panel.show(peer); assert.equal(text('Name'), '甲'); assert.equal(text('Presence'), '在线');
        const count = h.sent.length;
        h.iconRequests.find(r => r.id === 1044).resolve({ id: '乙头像' }); await tick();
        assert.equal(panel.panel.getChildByName('Portrait').getComponent(h.cc.Sprite).spriteFrame, null);
        h.iconRequests.find(r => r.id === 1043).resolve({ id: '甲头像' }); await tick();
        assert.equal(panel.panel.getChildByName('Portrait').getComponent(h.cc.Sprite).spriteFrame.id, '甲头像');
        assert.equal(h.sent.length, count, '头像加载完成不能再次请求公开资料');
        let peerInfo; h.events.on(h.E.openPrivateChat, p => peerInfo = p, h);
        panel.panel.getChildByName('Chat').click(); assert.equal(peerInfo.id, peer); assert.equal(panel.node.active, false);
        panel.show(me); h.receive(profile(me));
        assert.equal(panel.panel.getChildByName('Chat').getComponent(h.cc.Button).interactable, false);
        console.log('PASS 连续切换玩家不串资料/头像，展示在线状态，私聊使用当前 uid 且拒绝自己');
    }
    {
        const h = harness(); h.login(); const panel = h.panel(); panel.show(peer);
        h.receive({ uid: peer });
        const status = () => panel.panel.getChildByName('Status').getComponent(h.cc.Label).string;
        assert.equal(status(), '该主公不存在或资料未开放');
        assert.equal(panel.panel.getChildByName('Chat').getComponent(h.cc.Button).interactable, false);
        panel.panel.getChildByName('Retry').click(); h.timeout(); assert.equal(status(), '暂未取得资料，可重试');
        panel.panel.getChildByName('Retry').click(); h.receive(profile(peer, { offlineTime: 1 }));
        assert.equal(panel.panel.getChildByName('Presence').getComponent(h.cc.Label).string, '离线');
        console.log('PASS 不存在/超时界面可区分，失败期间禁用私聊，旧存档离线状态无 1970 时间');
    }
    {
        const h = harness(); let target;
        h.events.on(h.E.openPlayerProfile, uid => target = uid, h);
        const item = new (h.load('union/UnionMemItemLogic').default)();
        item._menberData = { rid: peer }; item.jump(); assert.equal(target, peer);
        target = null; item._menberData = null; item.jump(); assert.equal(target, null);
        console.log('PASS 同盟资料入口保留 int64 玩家身份，空列表项不发请求');
    }
    {
        const h = harness(); h.login();
        for (let i = 1; i <= 70; i++) { h.cmd.requestProfile(String(i)); h.receive(profile(String(i))); }
        assert.equal(h.cmd.profiles.size, 64); assert.equal(h.cmd.profiles.has('70'), true);
        console.log('PASS 浏览多名玩家时缓存有界');
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
