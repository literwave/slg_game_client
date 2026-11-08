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
        getChildByName(name) { return this.children.find(n => n.name === name) || null; }
        addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
        getComponent(Type) { return this.components.get(Type) || null; }
        getComponentInChildren(Type) { return this.getComponent(Type) || this.children.map(n => n.getComponentInChildren(Type)).find(Boolean) || null; }
        on(name, fn, target) { this.events.set(name, (...args) => fn.apply(target, args)); }
        setPosition(x, y) { this.position = { x, y }; } setScale() {}
        setSiblingIndex(index) {
            if (!this.parent) return;
            const siblings = this.parent.children;
            siblings.splice(siblings.indexOf(this), 1); siblings.splice(index, 0, this);
        }
        click() { assert.notEqual(this.getComponent(Button)?.interactable, false); this.events.get('click')?.(); }
    }
    class Label { static HorizontalAlign = { LEFT: 0, CENTER: 1 }; static VerticalAlign = { CENTER: 1 }; static Overflow = { SHRINK: 1, CLAMP: 2 }; }
    class Sprite { static SizeMode = { CUSTOM: 1 }; isValid = true; spriteFrame = null; }
    class Button { static EventType = { CLICK: 'click' }; static Transition = { SCALE: 1 }; interactable = true; }
    class Graphics { clear() {} moveTo() {} lineTo() {} roundRect() {} circle() {} rect() {} fill() {} stroke() {} }
    class Widget {
        static AlignMode = { ALWAYS: 1 };
        updateAlignment() { const parent = this.node.parent?.getComponent(UITransform); if (parent) this.node.getComponent(UITransform).setContentSize(parent.width, parent.height); }
    }
    class SafeArea { updateArea() { this.node.getComponent(Widget).updateAlignment(); } }
    class Color {}
    const cc = { Component, Node, UITransform, Label, Sprite, Button, Widget, SafeArea, Color, Graphics,
        Canvas: class {}, BlockInputEvents: class {}, _decorator: { ccclass: () => c => c, property: () => () => {} } };
    const own = { userId: me, name: '自己', headIcon: 1, soldier: 1234, resource: 5678 };
    const login = { proxy: { getRoleData: () => own }, headIcons: {
        getDisplayId: id => id || 1, getIconPath: id => `ui/head_icon/avatar_${id}`,
        loadIcon: id => new Promise(resolve => iconRequests.push({ id, resolve })),
    } };
    const stubs = {
        'login/LoginCommand': { default: { getInstance: () => login } },
        'network/socket/NetManager': { NetManager: { getInstance: () => ({ send(packet) {
            if (!sending) return false;
            sent.push({ name: packet.name, data: proto.decode(packet.name, packet.msg) }); return true;
        } }) } },
        'common/BgLogic': { default: Component },
        'progression/ProgressionPresentation': {},
        'common/RewardQuality': {},
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
        const h = harness(); h.login(); const panel = h.panel();
        assert.doesNotThrow(() => panel.show(peer), '首次打开须执行真实标题装饰和按钮绘制，不能只留下空底框');
        const frame = panel.panel, title = frame.getChildByName('Title').getComponent(h.cc.Label);
        assert.equal(title.string, '主公资料'); assert.equal(title.fontSize, 28); assert.equal(title.isBold, true);
        assert.ok(frame.children.indexOf(title.node) > frame.children.indexOf(frame.getChildByName('TaskTitlePlate')));
        assert.equal(frame.getChildByName('Close').getComponent(h.cc.Button).target.name, 'ManagementButton');
        assert.equal(frame.getChildByName('Retry'), null, '资料页不提供常驻刷新按钮');
        assert.equal(frame.getChildByName('Chat').position.x, 0, '单一主操作居中');
        assert.equal(frame.getChildByName('Chat').getComponent(h.cc.Button).interactable, false);
        h.receive(profile());
        assert.equal(frame.getChildByName('Name').getComponent(h.cc.Label).string, '青山');
        assert.equal(frame.getChildByName('Power').getChildByName('Value').getComponent(h.cc.Label).string, '9007199254740999');
        const children = frame.children.length;
        frame.getChildByName('Close').click(); assert.equal(panel.node.active, false);
        panel.show(other); h.receive(profile(other)); assert.equal(panel.node.active, true);
        assert.equal(frame.children.length, children, '关闭、切换玩家及回包重绘不能重复创建装饰');
        const empty = new h.cc.Node('UnbuiltWindow');
        const trim = h.load('map/ui/TaskBoardView').taskWindowTrim;
        assert.doesNotThrow(() => trim(empty, 510, 392), '标题尚未创建时装饰框也不能抛异常');
        empty.addChild(new h.cc.Node('Title'));
        assert.doesNotThrow(() => trim(empty, 510, 392), '标题尚未添加 Label 时不抛异常');
        console.log('PASS 首次打开资料使用真实窗口装饰，标题与按钮可见，关闭重开不重复建节点');
    }
    {
        const h = harness(); h.login(); const panel = h.panel(), text = name => panel.panel.getChildByName(name).getComponent(h.cc.Label).string;
        panel.show(peer); panel.show(other); h.receive(profile(peer, { name: '甲' }));
        assert.equal(text('Name'), '主公', '甲回包不能冒充正在查看的乙');
        h.receive(profile(other, { name: '乙', headIcon: 1044, offlineTime: 1000 }));
        assert.equal(text('Name'), '乙'); assert.equal(text('Presence'), '离线');
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
        const h = harness(); h.login(); const panel = h.panel();
        panel.show(me);
        const frame = panel.panel, chat = frame.getChildByName('Chat');
        assert.equal(h.sent.at(-1).data.uid, me, '自己的公开资料也使用精确 uid 查询');
        assert.equal(frame.getChildByName('Title').getComponent(h.cc.Label).string, '我的资料');
        assert.equal(chat.active, false, '首次读取自己的资料就隐藏社交操作');
        h.receive(profile(me, { name: '本人' }));
        assert.equal(frame.getChildByName('Name').getComponent(h.cc.Label).string, '本人');
        const selfHeight = frame.getComponent(h.cc.UITransform).height;
        let openedChat = null; h.events.on(h.E.openPrivateChat, data => openedChat = data, h);
        panel.chat();
        assert.equal(openedChat, null, '直接调用处理函数也不能向自己发起私聊');
        assert.equal(panel.node.active, true);
        panel.show(peer); h.receive(profile(peer));
        assert.equal(frame.getChildByName('Title').getComponent(h.cc.Label).string, '主公资料');
        assert.ok(frame.getComponent(h.cc.UITransform).height > selfHeight, '自己没有操作区时收起底部留白，切换他人恢复布局');
        assert.equal(chat.active, true); assert.equal(chat.getComponent(h.cc.Button).interactable, true);
        assert.equal(chat.position.x, 0); assert.equal(frame.getChildByName('Retry'), null);
        chat.click(); assert.equal(openedChat.id, peer);
        console.log('PASS 自己资料隐藏私聊并收起操作区，切换他人恢复标题、布局及私聊');
    }
    {
        const h = harness(); h.login(); const panel = h.panel(); panel.show(peer);
        h.receive({ uid: peer });
        const status = () => panel.panel.getChildByName('Status').getComponent(h.cc.Label).string;
        assert.equal(status(), '暂无资料');
        assert.equal(panel.panel.getChildByName('Chat').getComponent(h.cc.Button).interactable, false);
        panel.close(); panel.show(peer); h.timeout(); assert.equal(status(), '加载失败');
        const sent = h.sent.length;
        h.events.emit(h.S.s2c_client_load_ok);
        assert.equal(h.sent.length, sent + 1, '连接恢复后自动重新获取当前资料');
        h.receive(profile(peer, { offlineTime: 1 }));
        assert.equal(panel.panel.getChildByName('Presence').getComponent(h.cc.Label).string, '离线');
        console.log('PASS 不存在/超时状态可区分，重开及连接恢复自动获取资料，失败期间禁用私聊');
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
