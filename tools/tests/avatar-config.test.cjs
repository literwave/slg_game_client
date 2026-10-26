/* 使用 Creator 随附的 TypeScript 运行，无需安装依赖。
 * ELECTRON_RUN_AS_NODE=1 CocosCreator.exe tools/tests/avatar-config.test.cjs <typescript.js>
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const protobuf = require(path.join(root, 'assets/scripts/3rd/protobuf.js'));
const json = name => JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name + '.json'), 'utf8'));
let passed = 0;

function harness() {
    const cache = new Map(), timers = new Map(), sent = [], imageLoads = [];
    let timerId = 0;
    class SpriteFrame {
        constructor() { this.isValid = true; this.refs = 0; }
        addRef() { this.refs++; return this; }
        decRef() { this.refs--; return this; }
    }
    class JsonAsset { constructor(data) { this.json = data; } }
    class Component { constructor() { this.isValid = true; } }
    const cc = {
        SpriteFrame, JsonAsset, Component,
        _decorator: { ccclass: () => target => target, property: () => () => {} },
        resources: {
            get: () => null,
            load(resource, Type, callback) {
                if (resource === 'config/SystemOpen') callback(null, new JsonAsset(json('SystemOpen')));
                else imageLoads.push({ resource, callback });
            },
        },
    };
    const noOpCommand = { getInstance: () => ({ clearData() {}, setUIReady() {}, proxy: {} }) };
    const stubs = {
        'network/socket/NetManager': { NetManager: { getInstance: () => ({
            send(packet) { sent.push({ ...packet, data: proto.decode(packet.name, packet.msg) }); },
            close() {}, dropConnection() {},
        }) } },
        'utils/Tools': { Tools: {} },
        'utils/LocalCache': { LocalCache: { setLoginValidation() {} } },
        'utils/DateUtil': { default: { monotonicNow: () => 0, setServerTime() {} } },
        'libs/crypto/md5': { Md5: {} },
        'map/MapCommand': { default: noOpCommand },
        'general/GeneralCommand': { default: noOpCommand },
        'general/ArmyCommand': { default: noOpCommand },
        'general/TroopCommand': { default: noOpCommand },
        'map/ui/MapUICommand': { default: noOpCommand },
        'skill/SkillCommand': { default: noOpCommand },
        'reward/RewardCommand': { default: noOpCommand },
        'reward/RewardWindowLogic': { default: { init() {} } },
        'core/LoaderManager': { default: {}, LoadData: class {}, LoadDataType: {} },
        'config/GameConfig': { GameConfig: {} },
        'network/http/HttpManager': { HttpManager: {} },
        'utils/Toast': { default: class {} },
        'common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
        'common/LoadingLogic': { default: class {} },
        'common/ReconnectLogic': { default: class {} },
    };
    const scripts = path.join(root, 'assets/scripts');
    function load(name) {
        if (name.endsWith('.js')) return { default: require(path.resolve(scripts, name)) };
        const full = path.resolve(scripts, name.endsWith('.ts') ? name : name + '.ts');
        if (cache.has(full)) return cache.get(full).exports;
        const key = path.relative(scripts, full).replace(/\\/g, '/').replace(/\.ts$/, '');
        if (stubs[key]) return stubs[key];
        const source = fs.readFileSync(full, 'utf8');
        const output = ts.transpileModule(source, { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        } }).outputText;
        const module = { exports: {} };
        cache.set(full, module);
        const sandbox = { module, exports: module.exports, protobuf,
            console: { log() {}, info() {}, warn() {}, error() {} },
            setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
            clearTimeout: id => timers.delete(id),
            setInterval: callback => { const id = ++timerId; timers.set(id, callback); return id; },
            clearInterval: id => timers.delete(id),
            require: specifier => specifier === 'cc' ? cc : load(path.relative(scripts, path.resolve(path.dirname(full), specifier))),
        };
        vm.runInNewContext(output, sandbox, { filename: full });
        return module.exports;
    }
    const proto = load('network/pto/ProtoManager').ProtoManager.getInstance();
    const protoDir = path.join(root, 'assets/resources/protbuf/pto');
    for (const name of fs.readdirSync(protoDir).filter(name => name.endsWith('.proto'))) {
        proto.mergeRoot(proto._root, protobuf.parse(fs.readFileSync(path.join(protoDir, name), 'utf8')).root);
    }
    proto.parseIdMap(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define);
    proto._isReady = true;
    const events = load('utils/EventMgr').EventMgr;
    const server = load('config/ServerConfig').ServerConfig;
    const logic = load('common/LogicEvent').LogicEvent;
    const netEvents = load('network/socket/NetInterface').NetEvent;
    const command = load('login/LoginCommand').default.getInstance();
    const systems = load('systemopen/SystemOpenCommand').default.getInstance();
    function authenticate(hasRole = true) {
        command.proxy.saveLoginData({ userId: 99, serverId: 1 });
        events.emit(server.s2c_user_login_ok, { userId: 99, serverId: 1 });
        events.emit(server.s2c_user_base_info, { name: hasRole ? '测试主公' : '', sex: 1, headIcon: 1001, birthTime: 123 });
        if (hasRole) command.beginMapLoading();
        events.emit(server.s2c_req_system_open, { systemIdList: [1] });
        command.headIcons.initConfig(json('HeadIcon'), json('Hero'));
    }
    return { load, proto, events, server, logic, netEvents, command, systems, authenticate, sent, timers, imageLoads, SpriteFrame };
}

async function test(name, callback) {
    await callback();
    passed++;
    console.log('PASS ' + name);
}

async function main() {
    await test('头像、技能配置中的每个图片都存在并有 SpriteFrame', () => {
        const h = harness();
        const heads = h.command.headIcons;
        heads.initConfig(json('HeadIcon'), json('Hero'));
        assert.equal(heads.configs.length, 26);
        assert.equal(heads.getConfig(1001).name, '吕布');
        const SkillProxy = h.load('skill/SkillProxy').default;
        const skills = new SkillProxy();
        skills.initSkillConfig(json('Skill'));
        assert.equal(skills.skillConfs.length, 15);
        const paths = heads.configs.map(row => heads.getIconPath(row.id))
            .concat(skills.skillConfs.map(row => skills.getIconPath(row.cfgId)));
        for (const resource of paths) {
            const file = path.join(root, 'assets/resources', resource.replace(/\/spriteFrame$/, '.png'));
            assert.ok(fs.existsSync(file), resource);
            const meta = JSON.parse(fs.readFileSync(file + '.meta', 'utf8'));
            assert.ok(Object.values(meta.subMetas).some(sub => sub.importer === 'sprite-frame' && sub.imported), resource);
        }
    });
    await test('头像 ID、武将 ID 和图片文件名独立，技能换表后使用新路径', async () => {
        const h = harness();
        const heads = h.command.headIcons;
        heads.initConfig([{ Id: 77, HeroId: 1001, Sort: 2, Icon: 'ui/head_icon/custom_face.png' }], json('Hero'));
        assert.equal(heads.getConfig(77).name, '吕布');
        assert.equal(heads.getIconPath(77), 'ui/head_icon/custom_face/spriteFrame');
        const SkillProxy = h.load('skill/SkillProxy').default;
        const skills = new SkillProxy();
        skills.initSkillConfig([{ Id: 42, Icon: 'ui/skill/custom_fire.png' }]);
        const first = skills.loadSkillIcon(42);
        assert.equal(h.imageLoads[0].resource, 'ui/skill/custom_fire/spriteFrame');
        const frame = new h.SpriteFrame();
        h.imageLoads[0].callback(null, frame);
        assert.equal(await first, frame);
        skills.initSkillConfig([{ Id: 42, Icon: 'ui/skill/changed' }]);
        assert.equal(frame.refs, 0);
        assert.equal(skills.getIconPath(42), 'ui/skill/changed/spriteFrame');
        assert.equal(await skills.loadSkillIcon(9999), null);
        skills.initSkillConfig([{ Id: 42, Icon: '' }]);
        assert.equal(await skills.loadSkillIcon(42), null);
    });
    await test('退出后的旧头像加载回调不能污染新会话缓存', async () => {
        const h = harness();
        const heads = h.command.headIcons;
        heads.initConfig(json('HeadIcon'), json('Hero'));
        const a = heads.loadIcon(1001), b = heads.loadIcon(1001);
        assert.equal(h.imageLoads.length, 1);
        heads.clear();
        const frame = new h.SpriteFrame();
        h.imageLoads[0].callback(null, frame);
        assert.equal(await a, null);
        assert.equal(await b, null);
        assert.equal(frame.refs, 0);
    });
    await test('玩家头像和出生时间读取 User 基础信息，创建回包不清空已有头像', () => {
        const h = harness();
        h.authenticate();
        const proxy = h.command.proxy;
        assert.equal(proxy.getRoleData().headIcon, 1001);
        assert.equal(proxy.getRoleData().birthTime, 123);
        proxy.setRoleData({ name: '测试主公', sex: 1 });
        assert.equal(proxy.getRoleData().headIcon, 1001);
    });
    await test('地图、UI、武将、技能、头像全就绪才发送一次客户端加载完成', () => {
        const h = harness();
        const buildings = h.load('build/BuildCommand').default.getInstance();
        h.authenticate();
        const Main = h.load('Main').default;
        const main = new Main();
        main._enteringMap = true;
        main._mapReady = main._mapUiReady = main._heroAssetsReady = main._skillAssetsReady = true;
        let uiReady = false;
        h.events.on(h.load('core/CoreEvent').CoreEvent.gameReady, () => { uiReady = true; }, main);
        main.tryFinishLoading();
        assert.equal(h.sent.filter(msg => msg.name === h.server.c2s_client_load_ok).length, 0);
        main._headAssetsReady = true;
        main.tryFinishLoading();
        h.command.notifyClientLoaded();
        main.tryFinishLoading();
        const notices = h.sent.filter(msg => msg.name === h.server.c2s_client_load_ok);
        assert.equal(notices.length, 1);
        assert.equal(Object.keys(notices[0].data).length, 0);
        assert.equal(notices[0].msg.length, 0);
        assert.equal(h.proto.getIdByMsgType(notices[0].name), JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define.User.c2s_client_load_ok);
        assert.equal(uiReady, false, '主城等级未到达，尚不能退出加载页');
        assert.equal(h.sent.some(msg => msg.name === h.server.s2c_client_load_ok), false);
        h.events.emit(h.server.s2c_client_load_ok, {});
        assert.equal(buildings.loading, true);
        h.events.emit(h.server.s2c_req_build, { buildList: [{ bid: 1, level: 1 }] });
        main.tryFinishLoading();
        assert.ok(uiReady);
        assert.equal(h.command.clientLoadAcknowledged, true);
        assert.equal(h.command.proxy.getRoleData().headIcon, 1001);
    });
    await test('创建角色加载前不发送；重连校验通过后再通知一次', () => {
        const h = harness();
        h.authenticate(false);
        assert.equal(h.sent.filter(msg => msg.name === h.server.c2s_client_load_ok).length, 0);
        h.events.emit(h.server.s2c_user_create, { name: '新主公', sex: 0 });
        assert.equal(h.sent.filter(msg => msg.name === h.server.c2s_client_load_ok).length, 0);
        h.command.notifyClientLoaded();
        assert.equal(h.sent.filter(msg => msg.name === h.server.c2s_client_load_ok).length, 1);
        h.events.emit(h.netEvents.ServerDisconnected);
        h.command.notifyClientLoaded();
        assert.equal(h.sent.filter(msg => msg.name === h.server.c2s_client_load_ok).length, 1);
        h.authenticate();
        h.command.notifyClientLoaded();
        assert.equal(h.sent.filter(msg => msg.name === h.server.c2s_client_load_ok).length, 2);
    });
    await test('更换头像等待服务器确认、防止重复提交、忽略迟到的加载回包', () => {
        const h = harness();
        h.authenticate();
        h.command.notifyClientLoaded();
        assert.equal(h.command.changeHeadIcon(1002), true);
        assert.equal(h.command.proxy.getRoleData().headIcon, 1001);
        assert.equal(h.command.changeHeadIcon(1003), false);
        const requests = h.sent.filter(msg => msg.name === h.server.c2s_change_head_icon);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].data.headIcon, 1002);
        assert.equal(h.proto.getIdByMsgType(requests[0].name), JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define.User.c2s_change_head_icon);
        h.events.emit(h.server.s2c_change_head_icon, { headIcon: 1002 });
        assert.equal(h.command.changingHeadIcon, false);
        assert.equal(h.command.proxy.getRoleData().headIcon, 1002);
        h.events.emit(h.server.s2c_client_load_ok, { headIcon: 1001 });
        assert.equal(h.command.proxy.getRoleData().headIcon, 1002);
        assert.equal(h.command.changeHeadIcon(99999), false);
    });
    await test('未开放、发送失败、超时和断线均保留服务器确认的头像', () => {
        const h = harness();
        h.authenticate();
        h.command.notifyClientLoaded();
        h.systems.proxy.setOpenedIds([]);
        assert.equal(h.command.changeHeadIcon(1002), false);
        h.systems.proxy.setOpenedIds([1]);
        h.proto._isReady = false;
        assert.equal(h.command.changeHeadIcon(1002), false);
        assert.equal(h.command.changingHeadIcon, false);
        h.proto._isReady = true;
        assert.ok(h.command.changeHeadIcon(1002));
        h.timers.get(h.command._headChangeTimer)();
        assert.equal(h.command.changingHeadIcon, false);
        assert.equal(h.command.proxy.getRoleData().headIcon, 1001);
        assert.ok(h.command.changeHeadIcon(1003));
        h.events.emit(h.netEvents.ServerDisconnected);
        assert.equal(h.command.changingHeadIcon, false);
        assert.equal(h.command.changeHeadIcon(1004), false);
        assert.equal(h.command.proxy.getRoleData().headIcon, 1001);
        h.command.resetClientState();
        assert.equal(h.command.headIcons.configs.length, 0);
    });
    await test('迁城使用当前 User 协议，回包之前不移动主城、不扣迁城令', () => {
        const h = harness(), world = h.load('world/WorldCommand').default.getInstance();
        h.authenticate(); h.command.notifyClientLoaded();
        h.command.proxy.setCityPos({ x: 12, y: 20 }); h.command.proxy.updateItemData(1, 1001, 3);
        const notices = [], moves = [];
        h.events.on(h.logic.updateCityPosition, p => notices.push({ ...p }), notices);
        h.events.on(h.logic.scrollToMap, (x, y) => moves.push([x, y]), moves);
        assert.equal(h.server.c2s_move_city, 'User.c2s_move_city');
        const commonIds = JSON.parse(fs.readFileSync(path.join(root, 'external/game_common/client/net_pb.json'), 'utf8')).define;
        assert.ok(Number.isInteger(commonIds.User.c2s_move_city) && commonIds.User.c2s_move_city > 0);
        assert.equal(h.proto.getIdByMsgType(h.server.c2s_move_city), commonIds.User.c2s_move_city,
            '客户端迁城消息号必须与最新 game_common 协议表一致');
        assert.equal(h.command.moveCity({ x: 290, y: 850 }), true);
        const packet = h.sent.at(-1);
        assert.equal(packet.name, 'User.c2s_move_city'); assert.ok(packet.msg instanceof Uint8Array);
        assert.deepEqual(JSON.parse(JSON.stringify(packet.data)), { pos: { x: 290, y: 850 } });
        assert.equal(h.command.moveCity({ x: 300, y: 800 }), false);
        assert.equal(h.command.proxy.getRoleData().cityPos.x, 12);
        assert.equal(h.command.proxy.getItemCount(1001), 3); assert.equal(notices.length, 0);
        const receive = name => h.events.emit(name, h.proto.decode(name, h.proto.encode(name, { cityPos: { x: 290, y: 850 } })));
        receive(h.server.s2c_move_city); receive(h.server.s2c_move_city); receive(h.server.s2c_sync_city_pos);
        assert.equal(h.command.movingCity, false); assert.deepEqual(notices, [{ x: 290, y: 850 }]);
        assert.deepEqual(moves, [[290, 850]]); assert.equal(h.command.proxy.getItemCount(1001), 3);
        h.timers.get(world.focusTimer)();
        assert.equal(h.sent.at(-1).name, h.server.c2s_aoi_focus);
        assert.equal(h.sent.at(-1).data.pos.x, 290); assert.equal(h.sent.at(-1).data.pos.y, 850);
        h.events.emit(h.server.s2c_sync_item_data, { itemUid: 1, itemId: 1001, itemCnt: 2 });
        assert.equal(h.command.proxy.getItemCount(1001), 2);
    });
    await test('主城推送先到也能确认迁城，重复 ACK 不重复定位', () => {
        const h = harness(); h.authenticate(); h.command.notifyClientLoaded();
        h.command.proxy.setCityPos({ x: 12, y: 20 });
        let moved = 0; h.events.on(h.logic.scrollToMap, () => moved++, h);
        assert.ok(h.command.moveCity({ x: 0, y: 0 }));
        h.events.emit(h.server.s2c_sync_city_pos, { cityPos: { x: 0, y: 0 } });
        h.events.emit(h.server.s2c_move_city, { cityPos: { x: 0, y: 0 } });
        assert.equal(h.command.movingCity, false); assert.equal(moved, 1);
        assert.equal(h.command.proxy.getRoleData().cityPos.x, 0);
        h.events.emit(h.server.s2c_sync_city_pos, { cityPos: { x: 41, y: 42 } });
        assert.equal(h.command.proxy.getRoleData().cityPos.x, 41, '非本次迁城的主城推送也要同步');
        assert.equal(moved, 1, '普通同步不强制打断正在查看的地图');
    });
    await test('迁城坐标、令牌、加载状态和发送失败校验', () => {
        const h = harness(); assert.equal(h.command.moveCity({ x: 1, y: 2 }), false);
        h.authenticate(); assert.equal(h.command.moveCity({ x: 1, y: 2 }), false);
        h.command.notifyClientLoaded(); h.command.proxy.setCityPos({ x: 12, y: 20 });
        for (const pos of [null, { x: -1, y: 2 }, { x: 1000, y: 2 }, { x: 2, y: 1000 },
            { x: 1.5, y: 2 }, { x: NaN, y: 2 }, { x: '1', y: 2 }, { x: 12, y: 20 }]) {
            assert.equal(h.command.moveCity(pos), false);
        }
        h.command.proxy.updateItemData(1, 1001, 0);
        assert.equal(h.command.moveCity({ x: 30, y: 40 }), false);
        h.command.proxy.updateItemData(1, 1001, 1); h.proto._isReady = false;
        assert.equal(h.command.moveCity({ x: 30, y: 40 }), false); assert.equal(h.command.movingCity, false);
        h.proto._isReady = true; assert.ok(h.command.moveCity({ x: 999, y: 999 }));
        h.events.emit(h.server.s2c_move_city, {});
        h.events.emit(h.server.s2c_sync_city_pos, { cityPos: { x: 1000, y: -1 } });
        assert.equal(h.command.movingCity, true); assert.equal(h.command.proxy.getRoleData().cityPos.x, 12);
    });
    await test('迁城超时不重放，旧 ACK 不覆盖新目标，退出后忽略迟到确认', () => {
        const h = harness(); h.authenticate(); h.command.notifyClientLoaded();
        h.command.proxy.setCityPos({ x: 12, y: 20 });
        assert.ok(h.command.moveCity({ x: 30, y: 40 }));
        const count = h.sent.length; h.timers.get(h.command._moveCityTimer)();
        assert.equal(h.command.movingCity, false); assert.equal(h.sent.length, count);
        assert.ok(h.command.moveCity({ x: 60, y: 70 }));
        h.events.emit(h.server.s2c_move_city, { cityPos: { x: 30, y: 40 } });
        assert.equal(h.command.movingCity, true); assert.equal(h.command.proxy.getRoleData().cityPos.x, 12);
        h.events.emit(h.server.s2c_move_city, { cityPos: { x: 60, y: 70 } });
        assert.equal(h.command.movingCity, false); assert.equal(h.command.proxy.getRoleData().cityPos.x, 60);
        assert.ok(h.command.moveCity({ x: 80, y: 90 }));
        const timer = h.command._moveCityTimer;
        h.events.emit(h.netEvents.ServerDisconnected);
        assert.equal(h.command.movingCity, false); assert.equal(h.timers.has(timer), false);
        h.events.emit(h.server.s2c_move_city, { cityPos: { x: 80, y: 90 } });
        h.events.emit(h.server.s2c_sync_city_pos, { cityPos: { x: 80, y: 90 } });
        assert.equal(h.command.proxy.getRoleData().cityPos.x, 60);
    });
    await test('迁城超时后的有效迟到回包仍同步主城，重复回包不重复成功提示', () => {
        const h = harness(); h.authenticate(); h.command.notifyClientLoaded();
        h.command.proxy.setCityPos({ x: 12, y: 20 }); let moved = 0;
        h.events.on(h.logic.scrollToMap, () => moved++, h);
        h.command.moveCity({ x: 30, y: 40 }); h.timers.get(h.command._moveCityTimer)();
        h.events.emit(h.server.s2c_move_city, { cityPos: { x: 30, y: 40 } });
        h.events.emit(h.server.s2c_move_city, { cityPos: { x: 30, y: 40 } });
        assert.equal(h.command.proxy.getRoleData().cityPos.y, 40); assert.equal(moved, 1);
    });
    console.log(`通过 ${passed} 项头像、配置、迁城和协议回归检查。`);
}

main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
