// 离线执行真实选择部队组件，不模拟Preview输入，不连接服务器。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
let Item;
const events = [], sent = [], rendered = [];
const entity = { entityId: '9007199254740993', pos: { x: 10, y: 20 } };
let currentEntity = entity, issue = '', blocked = '', busy = false;
const world = { resourceLandAt: () => currentEntity, resourceLandIssue: () => issue,
    marches: { get: () => busy ? { state: 1 } : undefined },
    occupyResourceLand: (idx, id) => { if (busy) return false; sent.push([idx, id]); return true; } };
const map = { proxy: { getResData: () => ({ type: 54, level: 3 }) },
    cityProxy: { getMyMainCity: () => null }, campaignBlockReason: () => blocked };
const generals = { getMyGeneral: id => id ? { cfgId: id + 100, level: 6 } : null,
    getGeneralCfg: id => ({ name: `将${id}` }) };
const troops = { proxy: { getTroop: () => troop, getTroops: () => [troop] }, requestTroops: () => { troops.requests++; }, requests: 0 };
const cc = { Component: class {}, Node: class {},
    _decorator: { ccclass: () => v => v, property: () => () => {} },
    instantiate: () => ({ set parent(value) { value.children.push(this); }, destroy() {},
        getComponent: () => ({ setTroopData: (data, x, y) => rendered.push([data.troopIdx, x, y]) }) }) };
const shared = {
    '../../general/ArmyProxy': { ArmyCmd: { Attack: 1 } },
    '../../general/ArmyCommand': { default: { getInstance: () => ({ generalAssignArmy() { throw new Error('不可走旧出征协议'); } }) } },
    '../../general/GeneralCommand': { default: { getInstance: () => ({ proxy: generals }) } },
    '../../general/TroopCommand': { default: { getInstance: () => troops } },
    '../../world/WorldCommand': { default: { getInstance: () => world } },
    '../MapCommand': { default: { getInstance: () => map } },
    '../MapUtil': { default: { getIdByCellPoint: (x, y) => y * 1000 + x } },
    '../../utils/EventMgr': { EventMgr: { on() {}, targetOff() {}, emit: (...args) => events.push(args) } },
    '../../common/LogicEvent': { LogicEvent: { showToast: 'toast', closeArmyAelectUi: 'close' } },
    '../../common/AudioManager': { AudioManager: { instance: { playClick() {} } } },
    './GeneralHeadLogic': { default: class {} },
};
function load(file) {
    const source = fs.readFileSync(path.join(root, 'assets/scripts', file + '.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        if (id === 'cc') return cc;
        if (id === './ArmySelectItemLogic') return { default: Item };
        assert.ok(shared[id], `Unexpected import ${id}`); return shared[id];
    }, module, module.exports);
    return module.exports;
}
const { TroopData } = load('general/TroopProxy');
const troop = TroopData.createFromServer({ troopIdx: 2, posMap: {
    0: { heroIdx: 1, soldier: { count: 400, hurtCount: 40 } }, 1: { heroIdx: 2, soldier: { count: 300, hurtCount: 20 } },
} });
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
selector.armyContainer = { children: [], removeAllChildren() { this.children = []; } };
selector.setData(1, 10, 20);
assert.equal(troops.requests, 1); assert.deepEqual(rendered, [[2, 10, 20]]);
selector.refreshTroops(); assert.equal(selector.armyContainer.children.length, 1);
troop.getSoldier = () => ({ count: 0, hurtCount: 40 }); item.setTroopData(troop, 10, 20);
item.onClickItem(); assert.equal(sent.length, 1); assert.equal(item.tipNode.active, true);
console.log('PASS 资源地出征界面：新部队、真实兵力、实体ID、无旧城池、占领拦截和列表刷新');
