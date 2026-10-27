// 离线执行真实选择部队组件，不模拟Preview输入，不连接服务器。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
let Item;
const events = [], sent = [], rendered = [];
const entity = { entityId: '9007199254740993', pos: { x: 10, y: 20 } };
let currentEntity = entity, issue = '', blocked = '', busy = false, moveIssue = '', moveAccepted = true;
let cell = { type: 54, level: 3 }, city = null, roster;
let requestPending = false;
const world = { sessionReady: true, requestInFlight: () => requestPending, resourceLandAt: () => currentEntity, resourceLandIssue: () => issue,
    emptyLandIssue: () => '', resourceLandEntityId: (x, y) => 4000000000000000 + y * 1000 + x,
    marches: { get: () => busy ? { state: 1 } : undefined },
    occupyResourceLand: (idx, id) => { if (busy) return false; sent.push([idx, id]); return true; },
    moveTroop: (idx, pos) => { if (!moveAccepted) return false; sent.push(['move', idx, pos]); return true; } };
const map = { proxy: { getResData: () => cell },
    cityProxy: { getCity: () => city, getMyMainCity: () => ({ cityId: 1 }) }, campaignBlockReason: () => blocked,
    moveTargetIssue: () => moveIssue };
const generals = { getMyGeneral: id => id ? { cfgId: id + 100, level: 6 } : null,
    getGeneralCfg: id => ({ name: `将${id}` }) };
const troops = { proxy: { getTroop: () => troop, getTroops: () => roster }, requestTroops: () => { troops.requests++; }, requests: 0,
    listReady: true, listLoading: false, editingTroopIdx: 0 };
const cc = { Component: class {}, Node: class {},
    _decorator: { ccclass: () => v => v, property: () => () => {} },
    instantiate: () => ({ set parent(value) { value.children.push(this); }, destroy() {}, setPosition() {},
        getComponent: () => ({ setTroopData: (data, x, y) => rendered.push([data.troopIdx, x, y]), layoutRow() {} }) }) };
const shared = {
    '../../general/ArmyProxy': { ArmyCmd: { Attack: 1 } },
    '../../general/ArmyCommand': { default: { getInstance() { throw new Error('不可读取旧 Army 列表或发送旧出征协议'); } } },
    '../../general/GeneralCommand': { default: { getInstance: () => ({ proxy: generals }) } },
    '../../general/TroopCommand': { default: { getInstance: () => troops } },
    '../../world/WorldCommand': { default: { getInstance: () => world } },
    '../MapCommand': { default: { getInstance: () => map } },
    '../MapUtil': { default: { getIdByCellPoint: (x, y) => y * 1000 + x } },
    '../../utils/EventMgr': { EventMgr: { on() {}, targetOff() {}, emit: (...args) => events.push(args) } },
    '../../common/LogicEvent': { LogicEvent: { showToast: 'toast', closeArmyAelectUi: 'close' } },
    '../../common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
    '../../utils/Modal': { default: class {} },
    './GeneralHeadLogic': { default: class {} },
    './ManagementStyle': {},
    '../core/ConfigManager': { default: {} },
};
function load(file) {
    const source = fs.readFileSync(path.join(root, 'assets/scripts', file + '.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        if (id === 'cc') return cc;
        if (id === './ArmySelectItemLogic') return { default: Item };
        if (id === '../../world/ResourceLand') return load('world/ResourceLand');
        assert.ok(shared[id], `Unexpected import ${id}`); return shared[id];
    }, module, module.exports);
    return module.exports;
}
const { TroopData } = load('general/TroopProxy');
const troop = TroopData.createFromServer({ troopIdx: 2, posMap: {
    1: { heroIdx: 1, soldier: { count: 400, hurtCount: 40 } }, 2: { heroIdx: 2, soldier: { count: 300, hurtCount: 20 } },
} });
roster = [troop];
Item = load('map/ui/ArmySelectItemLogic').default;
const item = new Item(); item.tipNode = { active: false };
for (const field of ['labelTip', 'labelLv', 'labelName', 'labelState', 'labelMorale', 'labelSoldierCnt', 'labelVice1', 'labelVice2']) item[field] = { string: '' };
item.headIcon = { node: {}, getComponent: () => ({ setHeadId() {} }) }; item.progressSoldier = {};
item.setTroopData(troop, 10, 20);
assert.equal(item.labelSoldierCnt.string, '700 可用'); assert.equal(item.labelMorale.string, '伤兵 60');
item.onClickItem(); assert.deepEqual(sent, [[2, entity.entityId]]); assert.equal(events.at(-1)[0], 'close');
blocked = '先夺关'; item.onClickItem(); assert.equal(sent.length, 1); assert.equal(events.at(-1)[1], '先夺关'); blocked = '';
issue = '配置未同步'; item.onClickItem(); assert.equal(sent.length, 1); issue = '';
currentEntity = { ...entity, entityId: '9007199254740995' }; item.onClickItem(); assert.equal(sent.length, 1);
currentEntity = entity; busy = true; item.setTroopData(troop, 10, 20);
assert.equal(item.tipNode.active, true); item.onClickItem(); assert.equal(sent.length, 1); busy = false;
const Selector = load('map/ui/ArmySelectNodeLogic').default, selector = new Selector();
selector.node = { activeInHierarchy: true }; selector.itemPrefab = {};
selector.status = { string: '', node: {} };
selector.armyContainer = { children: [], removeAllChildren() { this.children = []; } };
selector.setData(1, 10, 20);
assert.equal(troops.requests, 1); assert.deepEqual(rendered, [[2, 10, 20]]);
selector.refreshTroops(); assert.equal(selector.armyContainer.children.length, 1);
// 有主城、旧列表为空的原始报错路径：空地、城池、关隘均不能回退旧协议。
for (const target of [{ type: 51, level: 8 }, { type: 50, level: 8 }, null]) {
    cell = target; selector.setData(1, 10, 20);
    assert.equal(troops.requests, 1); assert.equal(selector.armyContainer.children.length, 0);
    assert.match(selector.status.string, /暂不支持出征/);
}
cell = { type: 54, level: 3 }; city = { id: 20010 }; selector.setData(1, 10, 20);
assert.equal(troops.requests, 1); assert.equal(selector.armyContainer.children.length, 0);
city = null; selector.setData(2, 10, 20); assert.equal(troops.requests, 1);
selector.setData(1, 10, 20); assert.equal(selector.armyContainer.children.length, 1);
troops.listReady = false; troops.listLoading = true; selector.refreshTroops();
assert.match(selector.status.string, /正在同步/); assert.equal(selector.armyContainer.children.length, 0);
troops.listLoading = false; selector.refreshTroops(); assert.match(selector.status.string, /尚未同步/);
item.onClickItem(); assert.equal(sent.length, 1, '断线后旧卡片也不能发包');
troops.listReady = true; roster = []; selector.refreshTroops(); assert.match(selector.status.string, /暂无已编成/);
roster = [TroopData.createFromServer({ troopIdx: 3, posMap: {} })]; selector.refreshTroops();
assert.equal(selector.armyContainer.children.length, 1, '没有主将的部队显示不可用原因，不隐藏成黑屏');
item.setTroopData(roster[0], 10, 20); assert.match(item.labelTip.string, /主将未上阵/);
roster = [troop]; item.setTroopData(troop, 10, 20);
troops.editingTroopIdx = 2; item.onClickItem(); assert.equal(sent.length, 1); troops.editingTroopIdx = 0;
cell = { type: 51, level: 8 }; item.onClickItem(); assert.equal(sent.length, 1);
selector.refreshTroops(); assert.match(selector.status.string, /目标已变更/);
cell = { type: 0, level: 0, isEmpty: true }; selector.targetLabel = { string: '' }; selector.setData(1, 10, 20);
assert.match(selector.targetLabel.string, /空地/); assert.equal(selector.armyContainer.children.length, 1);
cell = { type: 54, level: 3 }; issue = '等待视野实体'; selector.refreshTroops(); assert.equal(selector.status.string, issue); issue = '';
selector.refreshTroops(); assert.equal(selector.status.node.active, false); assert.equal(selector.armyContainer.children.length, 1);

cell = { type: 0, level: 0, isEmpty: true }; currentEntity = null; issue = '占领没有实体';
selector.targetLabel = { string: '' }; selector.setData('move', 10, 20);
assert.equal(selector.armyContainer.children.length, 1); assert.match(selector.targetLabel.string, /移动至/);
item.setTroopData(troop, 10, 20, 'move'); assert.match(item.labelState.string, /点击移动/);
item.onClickItem(); assert.deepEqual(sent.at(-1), ['move', 2, { x: 10, y: 20 }]);
const moves = sent.length; moveIssue = '山脉不可通行'; item.onClickItem(); assert.equal(sent.length, moves);
selector.refreshTroops(); assert.equal(selector.status.string, moveIssue); moveIssue = '';
troops.editingTroopIdx = 2; item.onClickItem(); assert.equal(sent.length, moves); troops.editingTroopIdx = 0;
moveAccepted = false; const beforeFailed = events.length; item.onClickItem(); assert.equal(sent.length, moves);
assert.ok(events.slice(beforeFailed).every(e => e[0] !== 'close'), '移动发送失败保留选队面板');
moveAccepted = true; busy = true; item.onClickItem(); assert.equal(sent.length, moves); busy = false;
requestPending = true; item.onClickItem(); assert.equal(sent.length, moves, '同一部队待回包时不能重复出征'); requestPending = false;
world.sessionReady = false; item.onClickItem(); assert.equal(sent.length, moves, '断线不能发起行军'); world.sessionReady = true;
// 无关 AOI 移动推送不重建正在交互的选队卡片，目标归属变化才触发刷新。
cell = { type: 54, level: 3 }; currentEntity = entity; issue = '';
selector.setData(1, 10, 20);
let refreshCount = 0; selector.queueRefresh = () => refreshCount++;
selector.onTargetEntitiesChanged(); assert.equal(refreshCount, 0);
currentEntity = { ...entity, ownerId: '9007199254740999' };
selector.onTargetEntitiesChanged(); assert.equal(refreshCount, 1);
currentEntity = entity;
sent.length = 1; cell = { type: 54, level: 3 }; currentEntity = entity; issue = '';
troop.getSoldier = () => ({ count: 0, hurtCount: 40 }); item.setTroopData(troop, 10, 20);
item.onClickItem(); assert.equal(sent.length, 1); assert.equal(item.tipNode.active, true);
console.log('PASS 资源地出征及坐标移动：目标分流、无实体空地、加载状态、兵力、保存互斥、发送失败保留界面');
