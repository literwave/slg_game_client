// Exercise the real sidebar click handler and real polyline sampler without dispatching troops.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
const cache = new Map(), marches = new Map(), events = [];
let now = 104000, atHome = false, clicks = 0, layouts = 0;
class Component {}
class Button { static EventType = { CLICK: 'click' }; }
const cc = { Component, Button, _decorator: { ccclass: () => c => c, property: () => () => {} } };
const world = {
    marches: { get: index => marches.get(index) }, entities: new Map(),
    isTroopAtHome: () => atHome,
    march() { throw Error('定位不能发起行军'); }, cancelMarch() { throw Error('定位不能撤军'); },
};
const defaults = value => ({ default: value });
const cities = new Map();
const home = { x: 10, y: 20 };
const landmarks = new Map([['18,26', '朔方隘']]);
const stubs = {
    '../../login/LoginCommand': defaults({ getInstance: () => ({ proxy: { getRoleData: () => ({ cityPos: home }) } }) }),
    '../WorldCampaign': defaults({ landmark: (x, y) => landmarks.get(`${x},${y}`) || '' }),
    '../../world/CityCommand': {default:{getInstance:()=>({cities})}},
    '../../network/pto/ProtocolCommand': {idKey:id=>String(id??0)},
    '../../world/WorldCommand': { default: { getInstance: () => world }, MarchTargetType: { ReturnCity: 1, AttackMonster: 2, OccupyResource: 3, Move: 4, AttackCity: 5, Redeploy: 6 } },
    '../../utils/DateUtil': defaults({ getServerTime: () => now, converSecondStr: ms => String(Math.ceil(ms / 1000)) }),
    '../../utils/EventMgr': { EventMgr: { emit: (...args) => events.push(args) } },
    '../../common/LogicEvent': { LogicEvent: { scrollToMap: 'focus', openArmySetting: 'edit' } },
    '../../common/AudioManager': { AudioManager: { instance: { playClick() { clicks++; } } } },
    '../../world/MarchPath': null,
    '../../config/enum/TroopStateEnum': { TroopStateEnum: { IN_CITY: 0, MARCH: 1, STAY: 2, GATHER: 3, SIEGE: 4 } },
};
function load(file) {
    if (cache.has(file)) return cache.get(file);
    const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        fileName: file, reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
    });
    assert.equal(result.diagnostics.length, 0);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputText)(id => {
        if (id === 'cc') return cc;
        if (id === '../../world/MarchPath') return load('assets/scripts/world/MarchPath.ts');
        if (id === '../../general/ArmyProxy') return load('assets/scripts/general/ArmyProxy.ts');
        if (id === '../entries/SiegeContact') return load('assets/scripts/map/entries/SiegeContact.ts');
        return stubs[id] || defaults({});
    }, module, module.exports);
    cache.set(file, module.exports); return module.exports;
}
const Item = load('assets/scripts/map/ui/RightArmyItemLogic.ts').default;
const item = new Item();
item._troop = { troopIdx: 2, getHeroCount: () => 1 };
item.bottomNode = { active: false };
item.layoutItem = () => layouts++;
const route = {
    troopIdx: 2, state: 1, targetType: 5, startTime: 100, endTime: 110,
    startPos: { x: 10.25, y: 20 }, endPos: { x: 14.25, y: 26 },
    path: [{ x: 10.25, y: 20 }, { x: 10.25, y: 26 }, { x: 14.25, y: 26 }],
};
marches.set(1, { ...route, endPos: { x: 900, y: 900 } });
marches.set(2, route);
const expectFocus = (x, y) => {
    const event = events.at(-1);
    assert.equal(event[0], 'focus'); assert.equal(event[3], 'preserve-zoom');
    assert.equal(event[4], 2, '定位携带选中编队，持续跟随不能绑定其它部队');
    assert.ok(Math.abs(event[1] - x) < 1e-8, `${event[1]} != ${x}`);
    assert.ok(Math.abs(event[2] - y) < 1e-8, `${event[2]} != ${y}`);
};
item.onClickTop(); expectFocus(10.25, 24);
assert.equal(item.bottomNode.active, true);
assert.equal(world.entities.size, 0, '部队在视野外也可用本人行军快照定位');
now = 108000; item.onClickTop(); expectFocus(12.25, 26);
assert.equal(item.bottomNode.active, false);
assert.equal(clicks, 2); assert.equal(layouts, 2);
console.log('PASS 点击队伍按当前时间沿真实折线定位，保留小数与缩放，展开收起不受影响');

marches.set(2, { ...route, targetType: 1, startTime: 200, endTime: 210,
    startPos: route.endPos, endPos: route.startPos, path: [...route.path].reverse() });
now = 202000; item.onClickTop(); expectFocus(12.25, 26);
now = 208000; item.onClickTop(); expectFocus(10.25, 22);
console.log('PASS 折返后使用最新返程路线，不沿用旧终点或旧时间');

marches.set(2, { ...route, state: 2, targetType: 3 });
now = 101000; item.onClickTop(); expectFocus(14.25, 26);
marches.set(2, { ...route }); now = 112000;
item.onClickTop(); expectFocus(14.25, 26);
assert.equal(marches.get(2).state, 1, '定位不得自行改变服务器行军状态');
console.log('PASS 驻留和占领定位停驻格，迟到确认只钳制显示位置');
marches.set(2, { ...route, state: 2, troopState: 4, targetType: 5, startTime: 110, endTime: 115 });
now = 111000; item.onClickTop(); expectFocus(14.25, 26);
item.onOccupationChanged = () => {};
item.labelPos = { string: '' }; item.update(); assert.match(item.labelPos.string, /交战/);
now = 116000; item.update(); assert.equal(item.labelPos.string, '交战结算中');
cities.set(String(marches.get(2).targetId??0), {teamLeft:0}); item.update(); assert.equal(item.labelPos.string,'拆城结算中');
assert.equal(marches.get(2).troopState, 4);
console.log('PASS 攻城阶段点击定位城外真实位置，展示阶段状态，到点等待服务端结算');

let count = events.length;
atHome = true; item.onClickTop(); assert.equal(events.length, count);
atHome = false; marches.delete(2); item.onClickTop(); assert.equal(events.length, count);
marches.set(2, { ...route, state: 2, path: [{ x: 10, y: 20 }, { x: 1001, y: 26 }] });
item.onClickTop(); assert.equal(events.length, count);
item._troop = { troopIdx: 2, getHeroCount: () => 0 };
item.btnSetting = { active: true, getComponent: () => ({ interactable: true }) };
let edits = 0; item.onClickSetting = () => edits++;
item.onClickTop(); assert.equal(edits, 1); assert.equal(events.length, count);
console.log('PASS 主城待命、缺失快照和非法坐标不乱跳，空队仍直接编队，不发送出征或撤军');

item._troop = { troopIdx: 2, getHeroCount: () => 1 };
atHome = false;
marches.set(2, { ...route, targetType: 4 });
const expectEndpoint = (x, y) => {
    assert.deepEqual(events.at(-1), ['focus', x, y, 'preserve-zoom'], '坐标定位不得携带持续跟随的部队编号');
};
item.onClickOrigin(); expectEndpoint(10, 20);
item.onClickDestination(); expectEndpoint(14, 26);
assert.deepEqual(item.routePoints(), {
    origin: { x: 10, y: 20 }, destination: { x: 14, y: 26 }, order: '进军',
    originName: '主城', destinationName: '行军地', originIcon: 'home', destinationIcon: 'flag',
});
console.log('PASS 起终点坐标分别定位到地图格，保持缩放且退出持续跟随');

const cityId = '9007199254740995';
cities.set(cityId, { pos: { x: 18, y: 26 } });
for (const targetType of [5, 6]) {
    marches.set(2, { ...route, targetId: cityId, targetType });
    item.onClickDestination(); expectEndpoint(18, 26);
    assert.equal(item.routePoints().destinationName, '朔方隘');
    assert.equal(item.routePoints().order, targetType === 5 ? '攻城' : '调动');
}
marches.set(2, { ...route, targetType: 1, startPos: { x: 18, y: 26 }, endPos: { x: 0, y: 0 } });
item.onClickOrigin(); expectEndpoint(18, 26);
item.onClickDestination(); expectEndpoint(0, 0);
assert.equal(item.routePoints().order, '回城');
assert.equal(item.routePoints().originName, '朔方隘');
assert.equal(item.routePoints().destinationIcon, 'home');
console.log('PASS 攻城与调动定位真实城池，回城后即时使用新起终点，零坐标有效');
for (const [targetType, order, destinationName] of [[2, '讨伐', '敌营'], [3, '攻占', '资源地']]) {
    marches.set(2, { ...route, targetType });
    assert.equal(item.routePoints().order, order);
    assert.equal(item.routePoints().destinationName, destinationName);
}
console.log('PASS 军令与实际城池名称随当前任务切换，未知地名使用简短地类');

marches.set(2, { ...route, startPos: undefined, endPos: undefined });
item.onClickOrigin(); expectEndpoint(10, 20);
item.onClickDestination(); expectEndpoint(14, 26);
marches.set(2, { ...route, startPos: { x: NaN, y: 20 }, endPos: { x: 1000, y: 0 }, path: [] });
count = events.length;
assert.equal(item.routePoints(), null);
item.onClickOrigin(); item.onClickDestination(); assert.equal(events.length, count);
marches.set(2, { ...route, startPos: undefined, path: [] });
assert.equal(item.routePoints().origin, null);
item.onClickOrigin(); assert.equal(events.length, count);
item.onClickDestination(); expectEndpoint(14, 26);
atHome = true; assert.equal(item.routePoints(), null);
count = events.length; item.onClickDestination(); assert.equal(events.length, count);
atHome = false; marches.delete(2); assert.equal(item.routePoints(), null);
console.log('PASS 路径端点兼容缺省坐标；损坏、在城或已移除的行军不产生错误跳转');

item._troop = null; item._data = { state: 1, fromX: 22, fromY: 33, toX: 10, toY: 20 };
item.onClickOrigin(); expectEndpoint(22, 33);
item.onClickDestination(); expectEndpoint(10, 20);
item._data.state = 0; assert.equal(item.routePoints(), null);
console.log('PASS 旧队伍数据沿用协议接收后的行军方向，不二次反转返程起终点');
