// 离线执行真实 World/Build 处理器和 UI 适配；不连接服务器或启动 Preview。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
const protobuf = require(path.join(scripts, '3rd/protobuf.js'));
const table = name => JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name + '.json'), 'utf8'));
const plain = x => JSON.parse(JSON.stringify(x));
const uid = '9007199254740993', otherUid = '9007199254740995', entityId = '9007199254740997';
let passed = 0;
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
function test(name, fn) { if (filter && !filter.test(name)) return; fn(); console.log('PASS ' + name); passed++; }
class Component {
    isValid = true;
    scheduled = new Set();
    schedule(fn) { this.scheduled.add(fn); }
    unschedule(fn) { this.scheduled.delete(fn); }
    unscheduleAllCallbacks() { this.scheduled.clear(); }
}
class UITransform { width = 300; height = 60; }
class Node {
    constructor(name = '') { this.name = name; this.children = []; this.active = true; this.components = new Map(); }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    addChild(node) { this.children.push(node); node.parent = this; }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    setPosition() {}
    removeAllChildren() { this.children = []; }
}
class Label extends Component { string = ''; }
class Sprite extends Component { static SizeMode = { CUSTOM: 0 }; }
class SpriteFrame { constructor(name) { this.name = name; } }
class NodePool { clear() {} put() {} size() { return 0; } }
class Color { static WHITE = new Color(); }
const cc = { Component, Node, UITransform, Label, RichText: Label, Sprite, SpriteFrame, NodePool, Color,
    Vec2: class { constructor(x, y) { this.x = x; this.y = y; } }, JsonAsset: class {},
    _decorator: { ccclass: () => t => t, property: () => () => {} },
    resources: { load(p, t, cb) { cb(null, new SpriteFrame(p)); } } };
const util = { mapSize: { width: 1000, height: 1000 }, areaCellSize: { width: 10, height: 10 }, mapCellCount: 1000000,
    getIdByCellPoint: (x, y) => x + y * 1000,
    getAreaIdByCellPoint: (x, y) => Math.floor(x / 10) + Math.floor(y / 10) * 100,
    getCellPointById: id => ({ x: id % 1000, y: Math.floor(id / 1000) }) };
function harness(loadFacilities = true) {
    const cache = new Map(), sent = [], timers = new Map(); let tid = 0;
    const role = { userId: uid, name: '长安', cityPos: { x: 12, y: 20 }, allianceId: otherUid };
    const balances = { resList: [1, 2, 3, 4, 5].map(k => ({ k, v: k === 4 ? 123 : 1000000 })) };
    const login = { proxy: { getRoleData: () => role, getRoleResData: () => balances, hasItemCount: () => false } };
    class EmptyProxy { initData() {} clearData() {} }
    const actual = new Set(['utils/EventMgr', 'common/LogicEvent', 'config/ServerConfig', 'config/Basci',
        'network/pto/ProtoManager', 'network/pto/ProtocolCommand', 'network/pto/KeyedSnapshot', 'network/socket/NetInterface',
        'core/ConfigManager', 'world/WorldCommand', 'world/ResourceLand', 'build/BuildCommand',
        'map/MapCityProxy', 'map/MapCommand', 'map/MapCityLogic', 'map/MapBaseLayerLogic', 'map/PlayerCityAppearance', 'map/entries/FacilityBuildLogic',
        'map/ui/MapUIProxy', 'map/ui/MapUICommand', 'map/ui/FacilityDesLogic', 'map/ui/FacilityListLogic',
        'map/ui/FacilityItemLogic', 'map/ui/MapUILogic', 'scene/MapScene']);
    const stubs = {
        'login/LoginCommand': { default: { getInstance: () => login } },
        'utils/Tools': { Tools: { numberToShow: n => String(n) } },
        'utils/DateUtil': { default: { leftTimeStr: () => '00:01' } },
        'map/MapUtil': { default: util }, 'map/MapProxy': { default: EmptyProxy, MapResType: { WOOD: 52, GRAIN: 55, SYS_CITY: 51, SYS_FORTRESS: 50, FORTRESS: 30 } },
        'map/MapBuildProxy': { default: EmptyProxy },
        'common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
        'network/socket/NetManager': { NetManager: { getInstance: () => ({ send(p) {
            assert.ok(p.msg instanceof Uint8Array); assert.ok(proto.getIdByMsgType(p.name) > 0);
            sent.push({ name: p.name, data: proto.decode(p.name, p.msg) });
        } }) } },
    };
    function load(key) {
        key = key.replace(/\\/g, '/').replace(/\.ts$/, '');
        if (key.endsWith('.js')) return { default: require(path.join(scripts, key)) };
        if (stubs[key]) return stubs[key];
        if (!actual.has(key)) return { default: class {}, AudioManager: { instance: { playClick() {} } } };
        if (cache.has(key)) return cache.get(key).exports;
        const mod = { exports: {} }; cache.set(key, mod);
        const file = path.join(scripts, key + '.ts');
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        } }).outputText;
        vm.runInNewContext(code, { module: mod, exports: mod.exports, protobuf, console: { log() {}, warn() {}, error() {} },
            setTimeout: (fn, delay) => { timers.set(++tid, { fn, delay }); return tid; }, clearTimeout: id => timers.delete(id),
            require: name => name === 'cc' ? cc : load(path.relative(scripts, path.resolve(path.dirname(file), name))),
        }, { filename: file });
        return mod.exports;
    }
    const proto = load('network/pto/ProtoManager').ProtoManager.getInstance();
    const dir = path.join(root, 'assets/resources/protbuf/pto');
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.proto'))) proto.mergeRoot(proto._root, protobuf.parse(fs.readFileSync(path.join(dir, name), 'utf8')).root);
    proto.parseIdMap(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define); proto._isReady = true;
    const E = load('common/LogicEvent').LogicEvent, S = load('config/ServerConfig').ServerConfig, events = load('utils/EventMgr').EventMgr;
    const world = load('world/WorldCommand').default.getInstance(), build = load('build/BuildCommand').default.getInstance();
    const map = load('map/MapCommand').default.getInstance(), ui = load('map/ui/MapUICommand').default.getInstance();
    if (loadFacilities) ui.proxy.setAllFacilityCfg(['BuildingDetail', 'BuildingLv'].map(name => ({ name, json: table(name) })));
    load('core/ConfigManager').default.getInstance().loadConfigs([{ name: 'Item', json: table('Item') }]);
    const receive = (name, data = {}) => events.emit(name, proto.decode(name, proto.encode(name, data)));
    const entity = (id = entityId, owner = otherUid, x = 45, y = 60) => ({ entityId: id, entityType: 1, ownerId: owner, cfgId: 0, pos: { x, y } });
    const h = { map, world, build, ui, role, balances, events, E, S, sent, timers, load, receive, entity };
    receive(S.s2c_user_login_ok); map.initData(); return h;
}
test('首次进图实际加载流程初始化建筑表，提前到达的 Build 等级不丢失', () => {
    const h = harness(false);
    h.receive(h.S.s2c_sync_build, { bid: 1, level: 7 });
    assert.equal(h.ui.proxy.getFacilityConfigs().length, 0);
    const imports = {
        './core/ConfigManager': h.load('core/ConfigManager'), './map/ui/MapUICommand': h.load('map/ui/MapUICommand'),
        './utils/EventMgr': { EventMgr: h.events }, './core/CoreEvent': { CoreEvent: { mapLoadProgress: 'mapLoadProgress' } },
        './skill/SkillCommand': { default: { getInstance: () => ({ proxy: { initSkillConfig() {} } }) } },
        './login/LoginCommand': { default: { getInstance: () => ({ headIcons: { initConfig() {} } }) } },
    };
    const code = ts.transpileModule(fs.readFileSync(path.join(scripts, 'Main.ts'), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => id === 'cc' ? cc : imports[id] || {}, module, module.exports);
    const main = new module.exports.default();
    main.prepareSkillAssets = main.prepareHeadIcons = main.prepareHeroAssets = () => {};
    const assets = ['BuildingDetail', 'BuildingLv'].map(name => ({ name, json: table(name) }));
    main.prepareMap({}, assets).next();
    h.ui.qryCityFacilities(1);
    assert.equal(h.ui.proxy.getFacilityConfigs().length, table('BuildingDetail').length);
    assert.equal(h.ui.proxy.getMyFacilityByType(1, 1).level, 7, '不能回退成配置初始等级 1');
    assert.equal(h.ui.proxy.getMyFacilityByType(1, 10).level, 0, '未建建筑仍可进入列表');
});

test('内城先于配置打开后可恢复全部建筑，复用不重复挂组件且收起多余空行', () => {
    const h = harness(false), serialized = JSON.parse(fs.readFileSync(path.join(root, 'assets/prefab/CityFacilityNode.prefab'), 'utf8'));
    const make = id => {
        const row = serialized[id], node = new Node(row._name); node.active = row._active;
        for (const c of row._components) {
            const component = serialized[c.__id__];
            if (component.__type__ === 'cc.Label') node.addComponent(Label).string = component._string;
        }
        row._children.forEach(child => node.addChild(make(child.__id__)));
        return node;
    };
    const rootNode = make(1), content = rootNode.getChildByName('facilityNode').getChildByName('listNode')
        .getChildByName('New ScrollView').getChildByName('view').getChildByName('content');
    const view = new (h.load('map/ui/FacilityListLogic').default)();
    view.node = rootNode; view.scrollView = { content, scrollToTop() {} }; view.updateDesView = () => {};
    view.onLoad(); assert.equal(view._itemLogics.size, 0);
    h.ui.proxy.setAllFacilityCfg(['BuildingDetail', 'BuildingLv'].map(name => ({ name, json: table(name) })));
    view.setData({ cityId: 1 });
    assert.equal(view._itemLogics.size, 16);
    for (const [bid, item] of view._itemLogics) {
        assert.equal(item.node.active, true);
        assert.equal(item.labelName.string, table('BuildingDetail').find(row => row.Id === bid).Name);
        assert.ok(item.node.getChildByName('bg').getChildByName('BuildingIcon'), '空图标配置也创建建筑显示节点');
    }
    const original = view._itemLogics.get(1);
    view.setData({ cityId: 1 }); assert.equal(view._itemLogics.get(1), original);
    assert.ok(content.children.some(row => !row.active));
    h.receive(h.S.s2c_sync_build, { bid: 1, level: 5 });
    assert.equal(original.data.level, 5);
    const maxConfiguredLevel = Math.max(...table('BuildingLv').filter(row => row.BuildingType === 1).map(row => row.Lv));
    assert.equal(original.labelRate.string, `5/${maxConfiguredLevel}`);
});

test('野外建筑倒计时完成通过真实 World protobuf 刷新，回收后不再发包', () => {
    const h = harness();
    const tick = () => { for (const [id, timer] of [...h.timers]) if (timer.delay === 250) { h.timers.delete(id); timer.fn(); } };
    h.world.focus({ x: 290, y: 850 }); tick(); h.sent.length = 0;
    const Facility = h.load('map/entries/FacilityBuildLogic').default;
    for (const state of ['isBuilding', 'isUping', 'isDestroying']) {
        const view = new Facility(); view.tipsLab = new Label();
        let inProgress = true;
        view._data = { x: 10, y: 20, isBuilding: () => false, isUping: () => false, isDestroying: () => false, [state]: () => inProgress };
        view.startCountDownTime(); assert.ok(view.scheduled.has(view.countDownTime));
        assert.equal(h.sent.length, 0, '进行中不额外查询地图');
        inProgress = false; view.countDownTime();
        assert.equal(view.scheduled.size, 0); assert.equal(view.tipsLab.string, '');
    }
    tick(); assert.equal(h.sent.length, 1, '三个同时完成的建筑合并上报');
    assert.equal(h.sent[0].name, h.S.c2s_aoi_focus);
    assert.deepEqual(plain(h.sent[0].data), { pos: { x: 290, y: 850 } });
    const recycled = new Facility(); recycled.onDisable();
    assert.doesNotThrow(() => recycled.countDownTime()); tick(); assert.equal(h.sent.length, 1);
    assert.equal(h.map.qryNationMapScanBlock, undefined, '移除旧 JSON 发送入口');
    assert.equal(h.events.events.has('nationMap.scanBlock'), false, '移除旧地图扫描监听');
});
test('登录坐标直接显示主城，int64 身份保真，3×3 点击区和城市中心一致', () => {
    const h = harness(), p = h.map.cityProxy, city = p.getMyMainCity();
    assert.equal(city.rid, uid); assert.equal(city.unionId, otherUid); assert.equal(city.cityId, 1);
    assert.equal(city.entityId, 0); assert.equal(city.name, '长安的主城');
    assert.equal(city.getCellRadius(), 1, 'World 主城逻辑半径应与 3×3 点击区域一致');
    for (let y = 19; y <= 21; y++) for (let x = 11; x <= 13; x++) assert.equal(p.getCity(util.getIdByCellPoint(x, y)), city);
    assert.equal(p.getCity(util.getIdByCellPoint(14, 20)), undefined);
    const layer = new (h.load('map/MapCityLogic').default)(); assert.equal(layer.getIdByData(city), city.id);
    const scene = new (h.load('scene/MapScene').default)(); scene._cmd = h.map;
    const rendered = [], noop = { addItem() {} }; scene._itemLayers = { res: noop, build: noop, facility: noop, tag: noop, tips: noop, sysCity: noop, city: { addItem: (a, c) => rendered.push(c) } };
    h.map.proxy.getResData = () => ({ type: 55 }); h.map.proxy.getSysCityResData = () => null; h.map.buildProxy.getBuild = () => null;
    for (let y = 19; y <= 21; y++) for (let x = 11; x <= 13; x++) scene.addMapCell(0, x, y);
    assert.equal(rendered.length, 1, '跨占地格只实例化一次城市');
});
test('MOVE 空地与资源地可选，城池占地、山水、越界和未开关路线不可移动', () => {
    const h = harness(), map = h.map;
    let cell = { type: 0, level: 0, isEmpty: true }, systemCity = null, route = '';
    map.proxy.getResData = () => cell; map.proxy.getSysCityResData = () => systemCity;
    map.campaignBlockReason = (x, y, attackGate) => { assert.equal(attackGate, false); return route; };
    assert.equal(map.moveTargetIssue(100, 200), '');
    cell = { type: 54, level: 3 }; assert.equal(map.moveTargetIssue(100, 200), '');
    assert.match(map.moveTargetIssue(12, 20), /城池/);
    systemCity = {}; assert.match(map.moveTargetIssue(100, 200), /城池/); systemCity = null;
    for (const value of [null, { type: 0 }, { type: 50, level: 8 }, { type: 51, level: 8 }]) {
        cell = value; assert.ok(map.moveTargetIssue(100, 200));
    }
    cell = { type: 0, level: 0, isEmpty: true }; route = '须先夺关';
    assert.equal(map.moveTargetIssue(100, 200), route);
    for (const [x, y] of [[-1, 0], [1000, 0], [1.5, 2], [0, NaN]]) assert.match(map.moveTargetIssue(x, y), /坐标无效/);
});

test('World 城池进入/更新/离开、自己的 AOI 离开不丢主城，迁城清理旧格', () => {
    const h = harness(), p = h.map.cityProxy;
    h.receive(h.S.s2c_aoi_enter, { entities: [h.entity(), h.entity('9007199254740999', uid, 12, 20)] });
    const remote = p.getCity(util.getIdByCellPoint(45, 60)); assert.equal(remote.entityId, entityId); assert.equal(remote.rid, otherUid);
    assert.equal(p.getMyMainCity().entityId, '9007199254740999');
    h.receive(h.S.s2c_aoi_update, { entities: [h.entity(entityId, otherUid, 50, 70)] });
    assert.equal(p.getCity(util.getIdByCellPoint(45, 60)), undefined);
    assert.equal(p.getCity(util.getIdByCellPoint(50, 70)).cityId, remote.cityId);
    h.receive(h.S.s2c_aoi_leave, { entityIds: [entityId, '9007199254740999'] });
    assert.equal(p.getCity(util.getIdByCellPoint(50, 70)), undefined); assert.ok(p.getMyMainCity());
    h.map.initData(); // 重进地图后，旧占地也必须可以被迁城清理。
    h.role.cityPos = { x: 0, y: 0 }; h.events.emit(h.E.updateCityPosition, h.role.cityPos);
    assert.equal(p.getCity(util.getIdByCellPoint(12, 20)), undefined); assert.equal(p.getMyMainCity().id, 0);
    assert.ok(p.getCity(0)); assert.ok(p.getCity(1001)); assert.equal(p.getCity(999), undefined, '边界不能绕行到另一行');
    h.map.clearData(); assert.equal(p.getMyMainCity(), null); assert.equal(p.getCity(0), undefined);
});
test('拒绝非法 World 坐标和非城市实体，无坐标时不伪造主城', () => {
    const h = harness(); h.role.cityPos = null;
    h.receive(h.S.s2c_aoi_enter, { entities: [h.entity(entityId, otherUid, -1, 10), { ...h.entity('10'), entityType: 4 }] });
    assert.equal(h.map.cityProxy.getMyMainCity(), null); assert.equal(h.map.cityProxy.getCity(60045), undefined);
    const before = h.sent.length; h.ui.upFacility(1, 1); assert.equal(h.sent.length, before);
});
function detail(h, bid) {
    const view = new (h.load('map/ui/FacilityDesLogic').default)();
    for (const key of ['labelTitle', 'labelDes', 'labelConditions', 'labelNeed', 'labelUp', 'labelNeedTime']) {
        const parent = new Node(); parent.addComponent(UITransform); const node = new Node(); node.addComponent(UITransform); parent.addChild(node);
        view[key] = node.addComponent(Label);
    }
    view.btnUp = { node: { active: true }, interactable: false }; view.additionNode = new Node(); view.onLoad();
    const refresh = () => view.setData(1, h.ui.proxy.getMyFacilityByType(1, bid), h.ui.proxy.getFacilityCfgByType(bid));
    h.events.on(h.E.updateMyFacilities, refresh, view); h.ui.qryCityFacilities(1); return view;
}
test('Build 按实际 bid 建造/升级，回包前不涨级；内城列表、主城和按钮同步', () => {
    const h = harness(); h.receive(h.S.s2c_sync_build, { bid: 1, level: 1 });
    const view = detail(h, 10); assert.equal(view.labelUp.string, '建造'); assert.equal(view.btnUp.interactable, true);
    view.onClickUp(); assert.equal(h.sent.at(-1).name, h.S.c2s_create_build); assert.deepEqual(plain(h.sent.at(-1).data), { bid: 10 });
    assert.equal(h.ui.proxy.getMyFacilityByType(1, 10).level, 0); assert.equal(view.labelUp.string, '等待确认');
    const n = h.sent.length; view.onClickUp(); assert.equal(h.sent.length, n);
    h.receive(h.S.s2c_sync_build, { bid: 10, level: 1 }); assert.equal(h.ui.proxy.getMyFacilityByType(1, 10).level, 1);
    assert.equal(view.labelUp.string, '未解锁');
    h.receive(h.S.s2c_sync_build, { bid: 1, level: 2 });
    assert.equal(view.labelUp.string, '升级'); view.onClickUp(); assert.equal(h.sent.at(-1).name, h.S.c2s_up_build);
    assert.equal(h.ui.proxy.getMyFacilityByType(1, 10).level, 1);
    h.receive(h.S.s2c_sync_build, { bid: 10, level: 2 }); assert.equal(h.ui.proxy.getMyFacilityByType(1, 10).level, 2);
    h.receive(h.S.s2c_sync_build, { bid: 1, level: 20 }); assert.equal(h.map.cityProxy.getMyMainCity().level, 20);
    h.build.clearData(); assert.equal(view.btnUp.interactable, false); assert.equal(view.labelUp.string, '连接中');
});
test('所有建筑等级保留石料成本，余额不足阻止升级，满足条件后可发送', () => {
    const h = harness();
    for (const row of table('BuildingLv')) assert.equal(h.ui.proxy.getFacilityCfgByType(row.BuildingType).upLevels[row.Lv - 1].stone, row.CostStone);
    for (const [bid, level] of [[1, 2], [13, 1], [16, 1]]) h.receive(h.S.s2c_sync_build, { bid, level });
    h.balances.resList.find(r => r.k === 5).v = 149;
    const view = detail(h, 1); assert.equal(view.btnUp.interactable, false); assert.match(view.labelNeed.string, /150\/149/);
    const n = h.sent.length; view.onClickUp(); assert.equal(h.sent.length, n);
    h.balances.resList.find(r => r.k === 5).v = 150; h.ui.qryCityFacilities(1);
    assert.equal(view.btnUp.interactable, true); view.onClickUp(); assert.equal(h.sent.at(-1).name, h.S.c2s_up_build);
});
test('内城入口直达新建筑面板', () => {
    const h = harness(), hud = new (h.load('map/ui/MapUILogic').default)();
    hud._uiListenersReady = true; hud.closeMoreMenu = () => {}; let opened = null; hud.openFacility = city => opened = city;
    hud.openInnerCity(); assert.equal(opened.cityId, 1);
});

test('资源栏粮木铁石四项图标/数量对应且不显示令牌', () => {
    const h = harness(), hud = new (h.load('map/ui/MapUILogic').default)();
    const bar = new Node();
    for (let i = 0; i < 4; i++) {
        const slot = new Node(), dot = new Node('Dot'), text = new Node('New Label');
        dot.addComponent(Sprite); text.addComponent(Label); slot.addChild(dot); slot.addChild(text); bar.addChild(slot);
    }
    hud.srollLayout = { node: bar }; hud._resArray = [{ key: 1, name: '谷' }, { key: 2, name: '木' }, { key: 3, name: '铁' }, { key: 5, name: '石' }];
    hud.initResourceEntries(); hud.updateRoleRes(); assert.equal(bar.children.length, 4);
    [1, 2, 3, 5].forEach((id, index) => {
        assert.equal(bar.children[index].getChildByName('Dot').getComponent(Sprite).spriteFrame.name, table('Item').find(r => r.Id === id).Icon + '/spriteFrame');
        assert.ok(!bar.children[index].getChildByName('New Label').getComponent(Label).string.includes('令牌'));
        assert.ok(bar.children[index].getChildByName('New Label').getComponent(Label).string.endsWith('1000000'));
    });
});
test('主城 1—30 级随 Build 回包逐级换独立外观，AOI 未知等级不推断', () => {
    const h = harness();
    const { playerCityAppearance, PLAYER_CITY_MAX_LEVEL } = h.load('map/PlayerCityAppearance');
    assert.equal(PLAYER_CITY_MAX_LEVEL, table('BuildingDetail').find(row => row.Id === 1).MaxLevel);
    const arts = new Set();
    for (let level = 1; level <= PLAYER_CITY_MAX_LEVEL; level++) {
        h.receive(h.S.s2c_sync_build, { bid: 1, level });
        const city = h.map.cityProxy.getMyMainCity();
        const art = playerCityAppearance(city.level);
        assert.equal(art.level, level);
        assert.ok(art.width >= 300 && art.width * 1.2 <= 600, '建筑和选框保持在 3×3 占地内');
        arts.add(art.art);
        assert.equal(h.map.cityProxy.getCity(util.getIdByCellPoint(11, 19)), city);
    }
    assert.equal(arts.size, 30);
    for (const value of [0, -1, NaN, Infinity]) assert.equal(playerCityAppearance(value).level, 0);
    assert.equal(playerCityAppearance(999).level, 30);
    h.receive(h.S.s2c_aoi_enter, { entities: [h.entity()] });
    assert.equal(playerCityAppearance(h.map.cityProxy.getCity(util.getIdByCellPoint(45, 60)).level).level, 0);
});
console.log(`PASS ${passed} player city / Build / resource HUD integration cases`);
