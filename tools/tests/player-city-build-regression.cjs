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
    const balances = { resList: [1, 2, 3, 4, 100].map(k => ({ k, v: k === 100 ? 123 : 1000000 })) };
    const login = { proxy: { getRoleData: () => role, getRoleResData: () => balances, hasItemCount: () => false } };
    class EmptyProxy { initData() {} clearData() {} updateMapPosTags() {} isPosTag() { return false; } }
    const actual = new Set(['utils/EventMgr', 'common/LogicEvent', 'config/ServerConfig', 'config/Basci',
        'network/pto/ProtoManager', 'network/pto/ProtocolCommand', 'network/pto/SnapshotStore', 'network/socket/NetInterface',
        'core/ConfigManager', 'world/WorldCommand', 'world/ResourceLand', 'build/BuildCommand', 'map/ui/BuildingPresentation',
        'map/MapCityProxy', 'map/MapCommand', 'map/MapCityLogic', 'map/MapBaseLayerLogic', 'map/PlayerCityAppearance', 'map/entries/FacilityBuildLogic',
        'map/ui/MapUIProxy', 'map/ui/MapUICommand', 'map/ui/BuildingProgressionGraph', 'map/ui/FacilityDesLogic', 'map/ui/FacilityListLogic',
        'map/ui/FacilityItemLogic', 'map/ui/MapUILogic', 'scene/MapScene']);
    const stubs = {
        'login/LoginCommand': { default: { getInstance: () => login } },
        'world/MapMarkCommand': { default: { getInstance: () => ({ marks: { values: () => [] } }) } },
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
test('AOI 名称和主城等级经真实编解码进入地图，改名升级原地刷新', () => {
    const h = harness(), p = h.map.cityProxy;
    const { playerCityAppearance } = h.load('map/PlayerCityAppearance');
    const entity = { ...h.entity(), name: '洛阳城主', level: 3 };
    const cell = util.getIdByCellPoint(entity.pos.x, entity.pos.y);
    h.receive(h.S.s2c_aoi_enter, { entities: [entity] });
    const initial = p.getCity(cell);
    assert.equal(h.world.entities.get(entityId).name, '洛阳城主');
    assert.equal(initial.name, '洛阳城主'); assert.equal(initial.level, 3);
    assert.equal(playerCityAppearance(initial.level).art, 'player_city_lv3');
    assert.equal(initial.entityId, entityId, '新增字段不能损失 int64 身份');

    const layer = new (h.load('map/MapCityLogic').default)();
    layer._cmd = h.map; layer._itemMap = new Map([[util.getAreaIdByCellPoint(45, 60), new Map()]]);
    const refreshed = [], added = [], removed = [];
    layer.updateItem = (area, city) => refreshed.push(city);
    layer.addItem = (area, city) => added.push(city);
    layer.removeItem = (area, id) => removed.push(id);
    h.events.on(h.E.updateCitys, layer.onUpdateCitys, layer);
    h.receive(h.S.s2c_aoi_update, { entities: [{ ...entity, name: '新洛阳', level: 30 }] });
    const updated = p.getCity(cell);
    assert.equal(updated.cityId, initial.cityId); assert.equal(updated.name, '新洛阳');
    assert.equal(playerCityAppearance(updated.level).art, 'player_city_lv30');
    assert.deepEqual(refreshed, [updated]); assert.equal(added.length, 0); assert.equal(removed.length, 0);
    assert.equal(p.getCity(cell + 1), updated, '原有九格点击区域也引用新数据');
    h.receive(h.S.s2c_aoi_update, { entities: [{ ...entity, name: '新洛阳', level: 30 }] });
    assert.equal(refreshed.length, 1, '相同快照不重复刷新城图');

    h.receive(h.S.s2c_aoi_leave, { entityIds: [entityId] }); assert.equal(p.getCity(cell), undefined);
    h.receive(h.S.s2c_aoi_enter, { entities: [{ ...entity, name: '重返洛阳', level: 4 }] });
    assert.equal(p.getCity(cell).cityId, initial.cityId); assert.equal(p.getCity(cell).name, '重返洛阳');
    assert.equal(playerCityAppearance(p.getCity(cell).level).art, 'player_city_lv4');
});

test('AOI 兼容缺失名称等级，不使用 cfgId 或角色等级推断主城外观', () => {
    const h = harness(), p = h.map.cityProxy;
    const entity = { ...h.entity(), cfgId: 30, name: '  ', level: 0 };
    h.role.level = 29;
    h.receive(h.S.s2c_aoi_enter, { entities: [entity] });
    const city = p.getCity(util.getIdByCellPoint(45, 60));
    assert.equal(city.name, '玩家主城'); assert.equal(city.level, 0);
    assert.equal(h.load('map/PlayerCityAppearance').playerCityAppearance(city.level).art, 'county');
    h.receive(h.S.s2c_aoi_update, { entities: [h.entity()] });
    assert.equal(p.getCity(city.id).name, '玩家主城'); assert.equal(p.getCity(city.id).level, 0);
});

test('自己的主城可先用 AOI 等级，收到 Build 后以城建快照为准', () => {
    const h = harness(), p = h.map.cityProxy;
    const own = { ...h.entity('9007199254740999', uid, 12, 20), name: '长安', level: 7 };
    h.receive(h.S.s2c_aoi_enter, { entities: [own] });
    assert.equal(p.getMyMainCity().level, 7); assert.equal(p.getMyMainCity().name, '长安的主城');
    h.receive(h.S.s2c_sync_build, { bid: 1, level: 8 });
    h.receive(h.S.s2c_aoi_update, { entities: [own] });
    assert.equal(p.getMyMainCity().level, 8, '较晚的旧 AOI 不能覆盖新的城建推送');
    h.receive(h.S.s2c_aoi_leave, { entityIds: [own.entityId] });
    assert.equal(p.getMyMainCity().level, 8); assert.equal(p.getMyMainCity().name, '长安的主城');
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
    const h = harness(); h.build.requestBuildings(); h.receive(h.S.s2c_req_build, { buildList: [{ bid: 1, level: 1 }] });
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
    h.build.requestBuildings(); h.receive(h.S.s2c_req_build, { buildList: [] });
    for (const row of table('BuildingLv')) assert.equal(h.ui.proxy.getFacilityCfgByType(row.BuildingType).upLevels[row.Lv - 1].stone, row.CostStone);
    for (const [bid, level] of [[1, 2], [13, 1], [16, 1]]) h.receive(h.S.s2c_sync_build, { bid, level });
    h.balances.resList.find(r => r.k === 4).v = 149;
    const view = detail(h, 1); assert.equal(view.btnUp.interactable, false); assert.match(view.labelNeed.string, /150\/149/);
    const n = h.sent.length; view.onClickUp(); assert.equal(h.sent.length, n);
    h.balances.resList.find(r => r.k === 4).v = 150; h.ui.qryCityFacilities(1);
    assert.equal(view.btnUp.interactable, true); view.onClickUp(); assert.equal(h.sent.at(-1).name, h.S.c2s_up_build);
});

test('登录前建筑推送不作为空地，加载完成主动查询并恢复真实等级', () => {
    const h = harness(); h.build.clearData();
    h.receive(h.S.s2c_sync_build, { bid: 1, level: 10 });
    h.receive(h.S.s2c_user_login_ok);
    const view = detail(h, 1);
    assert.equal(h.ui.proxy.getMyFacilityByType(1, 1).synced, false);
    assert.equal(view.btnUp.interactable, false);
    assert.equal(h.build.create(1), false);
    h.receive(h.S.s2c_client_load_ok);
    assert.equal(h.sent.at(-1).name, h.S.c2s_req_build);
    const count = h.sent.length; h.ui.qryCityFacilities(1, true);
    assert.equal(h.sent.length, count, '打开内城时不重复并发查询');
    h.receive(h.S.s2c_req_build, { buildList: [{ bid: 1, level: 10 }, { bid: 10, level: 10 }] });
    assert.equal(h.build.loaded, true);
    assert.equal(h.ui.proxy.getMyFacilityByType(1, 1).level, 10);
    assert.equal(h.map.cityProxy.getMyMainCity().level, 10);
    assert.equal(h.ui.proxy.getMyFacilityByType(1, 11).synced, true);
    assert.equal(h.build.create(1), false, '已有建筑不能再发建造');
    assert.equal(h.build.upgrade(11), false, '未建建筑不能发升级');
});

test('建筑全量覆盖旧缓存但保留查询途中的新推送，空列表仍是有效快照', () => {
    const h = harness(); h.build.requestBuildings();
    h.receive(h.S.s2c_req_build, { buildList: [{ bid: 1, level: 2 }, { bid: 2, level: 1 }] });
    h.build.requestBuildings();
    h.receive(h.S.s2c_sync_build, { bid: 1, level: 3 });
    h.receive(h.S.s2c_req_build, { buildList: [{ bid: 1, level: 2 }] });
    assert.equal(h.build.levels.get(1), 3);
    assert.equal(h.build.levels.has(2), false);
    h.build.requestBuildings(); h.receive(h.S.s2c_req_build, { buildList: [] });
    assert.equal(h.build.loaded, true); assert.equal(h.build.levels.size, 0);
    assert.equal(h.build.create(1), true);
});

test('建筑查询超时可手动重试，断线清空快照且迟到回包不能恢复旧账号数据', () => {
    const h = harness(); h.build.requestBuildings();
    const timer = [...h.timers.values()].find(t => t.delay === 8000); timer.fn();
    assert.match(h.build.loadError, /超时/); assert.equal(h.build.create(1), false);
    assert.equal(h.build.requestBuildings(), true);
    h.receive(h.S.s2c_req_build, { buildList: [{ bid: 1, level: 4 }] });
    assert.equal(h.build.loadError, '');
    h.build.clearData();
    h.receive(h.S.s2c_req_build, { buildList: [{ bid: 1, level: 10 }] });
    assert.equal(h.build.loaded, false); assert.equal(h.build.levels.size, 0);
});

test('新版城建详情按配置展示前置条件、四类资源和当前上限', () => {
    const h = harness(), { buildingPresentation } = h.load('map/ui/BuildingPresentation');
    const configs = h.ui.proxy.getFacilityConfigs(), main = configs.find(c => c.type === 1);
    let state = buildingPresentation(main, new Map([[1, 1]]), configs, h.balances.resList);
    assert.equal(state.canAct, false); assert.equal(state.conditions.length, 2);
    state = buildingPresentation(main, new Map([[1, 1], [10, 1], [11, 1]]), configs, h.balances.resList);
    assert.equal(state.canAct, true); assert.deepEqual(plain(state.costs.map(c => c.id)), [1, 2, 3, 4]);
    state = buildingPresentation(main, new Map([[1, main.upLevels.length]]), configs, []);
    assert.equal(state.maxed, true); assert.equal(state.canAct, false);
});
test('城建路线按真实主城前置分阶段，筛选不改变解锁顺序', () => {
    const h = harness(), { buildingStages } = h.load('map/ui/BuildingPresentation');
    const configs = h.ui.proxy.getFacilityConfigs(), stages = buildingStages(configs);
    assert.deepEqual(plain(stages.map(s => [s.level, s.buildings.map(c => c.type)])), [
        [1, [1, 2, 10, 11]], [2, [3, 12, 13, 16]], [3, [4, 9, 14]],
        [4, [7]], [5, [5, 6]], [6, [8]], [8, [15]],
    ]);
    assert.equal(new Set(stages.flatMap(s => s.buildings.map(c => c.type))).size, configs.length);
    const military = stages.map(s => ({ level: s.level, buildings: s.buildings.filter(c => c.category === 2) })).filter(s => s.buildings.length);
    assert.deepEqual(plain(military.map(s => s.level)), [1, 3, 5]);
});
test('城建前置显示真实进度与目标，后续引导不提前解锁建筑', () => {
    const h = harness(), { buildingPresentation, buildingNextUnlocks } = h.load('map/ui/BuildingPresentation');
    const configs = h.ui.proxy.getFacilityConfigs(), main = configs.find(c => c.type === 1);
    const levels = new Map([[1, 2], [13, 1]]);
    const state = buildingPresentation(main, levels, configs, h.balances.resList);
    assert.deepEqual(plain(state.conditions.map(c => [c.type, c.currentLevel, c.level, c.met])), [[13, 1, 1, true], [16, 0, 1, false]]);
    assert.equal(state.canAct, false, '缺少采石场时不能跳过前置升级主城');
    const next = buildingNextUnlocks(1, new Map([[1, 1], [10, 1], [11, 1]]), configs);
    assert.deepEqual(plain(next.filter(n => n.targetLevel === 1 && n.requiredLevel === 2).map(n => n.type)), [3, 12, 13, 16]);
    assert.ok(!buildingNextUnlocks(1, new Map([[1, 10]]), configs).some(n => n.targetLevel === 1));
    assert.equal(levels.get(16), undefined, '展示路线不能修改服务器建筑状态');
});
test('分层连线以真实目标等级建图，升级互相依赖也不会形成循环', () => {
    const h = harness(), { buildingProgressionGraph, buildingGraphFocus } = h.load('map/ui/BuildingProgressionGraph');
    const configs = h.ui.proxy.getFacilityConfigs(), levels = new Map([[1, 1]]);
    const graph = buildingProgressionGraph(configs, levels), byKey = new Map(graph.nodes.map(n => [n.key, n]));
    const has = (from, to) => graph.edges.some(e => e.from === from && e.to === to);
    assert.ok(has('10:1', '1:2') && has('11:1', '1:2'));
    assert.ok(has('1:2', '13:1') && has('13:1', '1:3') && has('16:1', '1:3'));
    assert.ok(has('1:3', '4:1') && has('1:3', '9:1'));
    assert.ok(graph.edges.every(e => byKey.get(e.from).rank < byKey.get(e.to).rank));
    assert.equal(new Set(graph.nodes.map(n => n.key)).size, graph.nodes.length);
    assert.ok(configs.every(c => graph.nodes.some(n => n.type === c.type && n.goal)));
    const focus = buildingGraphFocus('1:3', graph.edges);
    assert.ok(focus.ancestors.has('10:1') && focus.ancestors.has('13:1'));
    assert.ok(focus.descendants.has('4:1'));
    assert.ok(!focus.ancestors.has('15:1'));
    assert.deepEqual(Array.from(levels), [[1, 1]], '规划路线不会写入真实建筑等级');
});
test('分层连线筛选保留跨类别前置，已完成主城共享当前等级节点', () => {
    const h = harness(), { buildingProgressionGraph } = h.load('map/ui/BuildingProgressionGraph');
    const configs = h.ui.proxy.getFacilityConfigs();
    const military = buildingProgressionGraph(configs, new Map([[1, 1]]), 1);
    assert.ok(military.nodes.some(n => n.type === 13), '军事路线需要保留主城升级所需仓库');
    assert.ok(!military.nodes.some(n => n.type === 15), '无关商行不出现在军事路线');
    const maxMain = configs.find(c => c.type === 1).upLevels.length;
    const developed = buildingProgressionGraph(configs, new Map([[1, maxMain], [13, 3], [16, 1]]));
    assert.deepEqual(plain(developed.nodes.filter(n => n.type === 1).map(n => n.level)), [maxMain]);
    assert.ok(developed.edges.filter(e => e.from === `1:${maxMain}`).every(e => e.met));
    assert.ok(developed.nodes.some(n => n.key === '13:4'));
    assert.ok(!developed.nodes.some(n => n.key === '13:3'), '卡片已含当前等级，无需重复自身已完成前一级');
});
test('建设路线移除满级孤立卡片，保留升级目标和有效前置', () => {
    const h = harness(), { buildingProgressionGraph, layoutBuildingGraph } = h.load('map/ui/BuildingProgressionGraph');
    const configs = h.ui.proxy.getFacilityConfigs();
    const max = type => configs.find(c => c.type === type).upLevels.length;
    const levels = new Map([[1, max(1)], [10, max(10)], [11, max(11)]]), before = Array.from(levels);
    const graph = buildingProgressionGraph(configs, levels, 0, { type: 10, level: max(10) });
    assert.ok(!graph.nodes.some(n => n.type === 10 || n.type === 11), '选中过的满级农场也不再生成归档卡片');
    assert.ok(graph.nodes.some(n => n.type === 1 && n.complete), '仍用于解锁后续建筑的主城前置保留');
    assert.ok(graph.edges.some(e => e.from === `1:${max(1)}`));
    const keys = new Set(graph.nodes.map(n => n.key));
    assert.ok(graph.edges.every(e => keys.has(e.from) && keys.has(e.to)), '过滤不能留下悬空连线');
    assert.ok(!layoutBuildingGraph(graph.nodes, 600).rows.some(row => row.label === '已完成建设'));
    const upgrading = buildingProgressionGraph(configs, new Map([[1, max(1)], [10, max(10) - 1]]));
    assert.ok(upgrading.nodes.some(n => n.type === 10 && n.level === max(10) && !n.complete));
    const allDone = new Map(configs.map(c => [c.type, c.upLevels.length]));
    for (const category of [0, 1, 2, 3]) {
        const complete = buildingProgressionGraph(configs, allDone, category);
        assert.equal(complete.nodes.length, 0); assert.equal(complete.edges.length, 0);
        assert.equal(layoutBuildingGraph(complete.nodes, 600).rows.length, 0);
    }
    assert.deepEqual(Array.from(levels), before, '隐藏卡片不改变实际建筑等级');
});
test('分层连线远期目标只允许引导，不越级建造或改变资源', () => {
    const h = harness(), { buildingGoalPresentation } = h.load('map/ui/BuildingPresentation');
    const configs = h.ui.proxy.getFacilityConfigs(), main = configs.find(c => c.type === 1);
    const levels = new Map([[1, 1], [10, 1], [11, 1]]), before = plain(h.balances.resList);
    const next = buildingGoalPresentation(main, 2, levels, configs, h.balances.resList);
    assert.equal(next.canAct, true);
    assert.equal(next.costs.find(c => c.id === 1).need, main.upLevels[1].grain);
    const future = buildingGoalPresentation(main, 3, levels, configs, h.balances.resList);
    assert.equal(future.canAct, false);
    assert.ok(future.conditions.some(c => c.type === 1 && c.level === 2 && !c.met));
    assert.ok(future.conditions.some(c => c.type === 13 && !c.met));
    const completed = buildingGoalPresentation(main, 1, levels, configs, []);
    assert.equal(completed.achieved, true); assert.equal(completed.canAct, false);
    assert.equal(completed.action, '查看下一等级');
    assert.deepEqual(plain(h.balances.resList), before);
    assert.equal(h.sent.length, 0);
});
test('分层连线在窄屏与横屏内完整容纳卡片，同行同列不重叠', () => {
    const h = harness(), { buildingProgressionGraph, layoutBuildingGraph } = h.load('map/ui/BuildingProgressionGraph');
    const configs = h.ui.proxy.getFacilityConfigs();
    for (const width of [250, 310, 420, 657]) {
        const graph = buildingProgressionGraph(configs, new Map([[1, 1]]));
        const layout = layoutBuildingGraph(graph.nodes, width);
        for (const node of graph.nodes) {
            assert.ok(Math.abs(node.x) + layout.cardWidth / 2 <= width / 2);
            assert.ok(-node.y + layout.cardHeight / 2 <= layout.height);
        }
        graph.nodes.forEach((a, i) => graph.nodes.slice(i + 1).forEach(b => {
            assert.ok(Math.abs(a.x - b.x) >= layout.cardWidth || Math.abs(a.y - b.y) >= layout.cardHeight);
        }));
    }
});
test('内城入口直达新建筑面板', () => {
    const h = harness(), hud = new (h.load('map/ui/MapUILogic').default)();
    hud._uiListenersReady = true; hud.closeMoreMenu = () => {}; let opened = null; hud.openFacility = city => opened = city;
    hud.openInnerCity(); assert.equal(opened.cityId, 1);
});

test('资源栏粮木铁石四项图标/数量对应且不显示令牌', () => {
    const h = harness(), hud = new (h.load('map/ui/MapUILogic').default)();
    const prefab = JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes/MapUIScene.prefab'), 'utf8'));
    const slots = prefab.find(o => o.__type__ === 'cc.Node' && o._name === 'ResourceBar')._children.map(r => prefab[r.__id__]);
    assert.equal(slots.length, 4);
    const bar = new Node();
    for (const entry of slots) {
        const slot = new Node(), dot = new Node('Dot'), text = new Node('New Label');
        const children = entry._children.map(r => prefab[r.__id__]);
        const sprite = children.find(n => n._name === 'Dot')._components.map(r => prefab[r.__id__]).find(c => c.__type__ === 'cc.Sprite');
        dot.addComponent(Sprite).spriteFrame = { uuid: sprite._spriteFrame.__uuid__ };
        text.addComponent(Label); slot.addChild(dot); slot.addChild(text); bar.addChild(slot);
    }
    h.balances.resList = [1, 2, 3, 4, 100].map(k => ({ k, v: k * 100 }));
    hud.srollLayout = { node: bar }; hud.updateRoleRes();
    [1, 2, 3, 4].forEach((id, index) => {
        const icon = table('Item').find(r => r.Id === id).Icon;
        const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources', icon + '.png.meta'), 'utf8'));
        const frame = Object.values(meta.subMetas).find(s => s.importer === 'sprite-frame');
        assert.equal(bar.children[index].getChildByName('Dot').getComponent(Sprite).spriteFrame.uuid, frame.uuid);
        assert.ok(!bar.children[index].getChildByName('New Label').getComponent(Label).string.includes('令牌'));
        assert.equal(bar.children[index].getChildByName('New Label').getComponent(Label).string, ['粮', '木', '铁', '石'][index] + ' ' + id * 100);
    });
    h.balances.resList = h.balances.resList.filter(r => r.k !== 4); hud.updateRoleRes();
    assert.equal(bar.children[3].getChildByName('New Label').getComponent(Label).string, '石 0');
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
        assert.equal(art.width, 600, '主城原图地脚与 3×3 占地同宽');
        assert.equal(art.y, -150, '主城地脚前角与占地前角一致');
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
