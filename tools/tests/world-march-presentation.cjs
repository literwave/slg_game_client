// 离线验证真实行军显示层和服务端折线路径，不操作 Preview。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), cache = new Map();
class Component { schedule() {} }
class Vec2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } subtract(other) { this.x -= other.x; this.y -= other.y; return this; } }
class Vec3 extends Vec2 {}
class UITransform { height = 1; setContentSize() {} setAnchorPoint() {} }
class Sprite { static SizeMode = {CUSTOM:0}; enabled = true; }
class SpriteFrame { addRef() {} reset(value) {Object.assign(this,value);} }
class Graphics { points = []; clear() { this.points = []; } moveTo(x, y) { this.points.push([x, y]); } lineTo(x, y) { this.points.push([x, y]); }
    stroke() {} ellipse() {} fill() {} circle() {} close() {} rect() {} }
class Animation { play(name) { this.name = name; this.paused = false; } pause() { this.paused = true; } }
class Node {
    constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.isValid = true; }
    get parent() { return this._parent; }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    set parent(value) { if (this._parent) this._parent.children.splice(this._parent.children.indexOf(this), 1); this._parent = value; if (value) value.children.push(this); }
    addChild(n) { n.parent = this; }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    setPosition(x, y) { this.position = { x, y }; }
    setSiblingIndex(index) { const a = this.parent.children; a.splice(a.indexOf(this), 1); a.splice(index, 0, this); }
    setScale() {}
    removeFromParent() { this.parent = null; }
    destroy() { this.isValid = false; this.removeFromParent(); }
}
class NodePool { items = []; size() { return this.items.length; } get() { return this.items.pop(); } put(n) { n.parent = null; this.items.push(n); } clear() { this.items = []; } }
const cc = { Component, Vec2, Vec3, UITransform, Node, NodePool, Sprite, SpriteFrame, Graphics, Animation,
    Rect:class {}, Size:class {}, UIOpacity:class {},
    resources:{ load(name, Type, callback) { const frame=new SpriteFrame(); frame.texture={width:1536,height:768}; callback(null,frame); } },
    Color: class {}, isValid: n => !!n?.isValid,
    _decorator: { ccclass: () => c => c, property: () => () => {} }, Prefab: class {} };
let now = 100000, marches = [], preview = null, atHome = false;
const entities = new Map(), ownerId = '9007199254740995';
const util = { mapSize: { width: 1000, height: 1000 }, areaCellSize: { width: 10, height: 10 }, mapCellToPixelPoint: p => new Vec2((p.x - p.y) * 100, -(p.x + p.y) * 50) };
const cities = new Map();
const stubs = {
    'world/CityCommand': {default:{getInstance:()=>({cities})}},
    'map/WorldCampaign': {default:{config:null,gateAt:()=>null}},
    'map/MapUtil': { default: util }, 'map/MapCommand': {},
    'utils/DateUtil': { default: { getServerTime: () => now, monotonicNow: () => now } },
    'general/ArmyCommand': { default: { getInstance: () => ({ proxy: { getAllArmys: () => [] } }) } },
    'general/ArmyProxy': { ArmyCmd: { Idle: 0, Conscript: 5 } },
    'world/WorldCommand': { default: { getInstance: () => ({ entities, marchRoute: preview, isTroopAtHome: () => atHome,
        marches: { values: () => marches, get: idx => marches.find(m => m.troopIdx === idx) }, occupyCountdownAt: () => null }) },
        MarchTargetType: { ReturnCity: 1, Move: 4 } },
    'login/LoginCommand': { default: { getInstance: () => ({ proxy: { getRoleData: () => ({ userId: ownerId }) } }) } },
    'general/TroopCommand': { default: { getInstance: () => ({ proxy: { getTroop: () => null } }) } },
    'network/pto/ProtocolCommand': { idKey: id => String(id ?? 0), hasId: id => id !== undefined && id !== null && String(id) !== '0' },
    'map/entries/MarchFormation': { default: class { configure() {} setGuarding() {} setSiegeTarget(target) { this.target = target; }
        getSiegeVolley() { return { seconds: 1, sources: this.target ? [{ x: 0, y: 27, index: 0 }] : [] }; } update() {} destroy() {} } },
};
function load(name) {
    if (stubs[name]) return stubs[name]; if (cache.has(name)) return cache.get(name).exports;
    const file = path.join(root, 'assets/scripts', name + '.ts'), mod = { exports: {} }; cache.set(name, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    new Function('require', 'module', 'exports', code)(id => id === 'cc' ? cc : load(path.relative(path.join(root, 'assets/scripts'),
        path.resolve(path.dirname(file), id)).replace(/\\/g, '/')), mod, mod.exports);
    return mod.exports;
}
const { buildMarchPath, sampleMarchPath } = load('world/MarchPath');
const march = { troopIdx: 1, targetType: 4, targetId: 0, state: 1, startTime: 100, endTime: 104,
    startPos: { x: 10.25, y: 20 }, endPos: { x: 12.25, y: 22 }, path: [{ x: 10.25, y: 20 }, { x: 10.25, y: 22 }, { x: 12.25, y: 22 }] };
const route = buildMarchPath(march);
assert.deepEqual(sampleMarchPath(march, route, 101000).position, { x: 10.25, y: 21 });
assert.deepEqual(sampleMarchPath(march, route, 103000).position, { x: 11.25, y: 22 });
assert.deepEqual(sampleMarchPath(march, route, 99000).position, march.startPos);
assert.deepEqual(sampleMarchPath(march, route, 109000).position, march.endPos);
assert.deepEqual(sampleMarchPath({ ...march, state: 2 }, route, 101000).position, march.endPos);
assert.equal(march.state, 1, '本地时间不能改业务到达状态');
assert.equal(buildMarchPath({ ...march, path: [] }).points.length, 2);
assert.equal(sampleMarchPath(march, buildMarchPath({ ...march, path: [{ x: 1, y: 2 }, { x: 1, y: 2 }] }), now).moving, false);
console.log('PASS 服务端秒时间、浮点拐点、转弯插值、迟到确认、零长度路径');

const events = load('utils/EventMgr').EventMgr, E = load('common/LogicEvent').LogicEvent;
const Layer = load('map/MapArmyLogic').default, layer = new Layer(); layer.parentLayer = new Node('ArmyLayer');
layer.createArmy = () => { if (layer._armyPool.size()) return layer._armyPool.get(); const n = new Node('Army'); n.addComponent(Animation); return n; };
layer.createArrow = () => { if (layer._arrowPool.size()) return layer._arrowPool.get(); const n = new Node('Arrow'); n.addComponent(UITransform); n.addComponent(Sprite); return n; };
layer.onLoad(); assert.equal(layer.aoiArmies.size, 0);
preview = {status:'ready',path:[{x:10.25,y:20},{x:10.25,y:22},{x:12.25,y:22}],costTime:15.25};
events.emit(E.updateMarchRoute);
const previewGraphic = layer.routePreviewNode.getComponent(Graphics);
assert.equal(layer.routePreviewNode.active,true);
assert.deepEqual(previewGraphic.points.slice(0,3),preview.path.map(p=>{const v=util.mapCellToPixelPoint(p);return[v.x,v.y];}));
assert.equal(layer.aoiArmies.size,0,'预览路线不能生成或移动真实部队');
preview = null; events.emit(E.updateMarchRoute); assert.equal(layer.routePreviewNode.active,false,'关闭选队清除路线');
console.log('PASS 预览绘制完整浮点折线且关闭清理，不产生真实部队');
const id = '9007199254740997';
marches = [march]; events.emit(E.updateMarches);
assert.equal(layer.aoiArmies.size, 0, '行军列表不能凭空生成未进入 AOI 的地图实体');
assert.deepEqual(layer.troopMapPosition(1), util.mapCellToPixelPoint(march.startPos), '视野外也能从快照锁定本人部队');
assert.equal(layer.troopMapPosition(2), null, '不能跟到其它编队');
entities.set(id, { entityId: id, entityType: 2, ownerId, pos: march.startPos,
    path: march.path, startTime: march.startTime, endTime: march.endTime });
events.emit(E.updateWorldEntities); assert.equal(layer.aoiArmies.size, 1);
const logic = layer.aoiArmies.get(id), soldier = logic.aniNode;
const advance = target => { while (now < target) { now = Math.min(target, now + 100); layer.update(); } };
const positionIs = (x, y) => assert.ok(Math.hypot(soldier.position.x - x, soldier.position.y - y) < .00001);
advance(101000); positionIs(-1075, -1562.5);
assert.deepEqual(layer.troopMapPosition(1), new Vec2(soldier.position.x, soldier.position.y));
now += 550; // 模拟心跳校时跳动；画面沿单调时钟平滑播放，镜头不能领先实体。
assert.deepEqual(layer.troopMapPosition(1), new Vec2(soldier.position.x, soldier.position.y), '跟随实际画面，而不是另算一条时间轴');
now -= 550;
const g = logic.arrowNode.getChildByName('WorldMarchRoute').getComponent(Graphics);
assert.equal(g.points.length, 3, '折线保留服务端拐点'); assert.equal(logic.arrowNode.getComponent(Sprite).enabled, false);
advance(103000); positionIs(-1075, -1662.5);
advance(105000); assert.equal(logic.marching, false); assert.equal(march.state, 1);
marches = [{ ...march, state: 2 }];
entities.set(id, { ...entities.get(id), pos: march.endPos, path: [], startTime: 0, endTime: 0 });
events.emit(E.updateWorldEntities);
assert.equal(layer.aoiArmies.size, 1, 'AOI 到达后保持驻留显示'); assert.equal(logic.arrowNode.active, false);
marches = []; events.emit(E.updateMarches);
assert.equal(layer.troopMapPosition(1), null, '部队结束后终止跟随，不能锁住回收前的节点');
assert.equal(layer.aoiArmies.size, 1, '地图实体只由 AOI 移除，不因本人行军列表消失而提前回收');
entities.clear(); events.emit(E.updateWorldEntities);
assert.equal(layer.aoiArmies.size, 0); assert.equal(layer._armyPool.size(), 1);
entities.set(id, { entityId: id, entityType: 2, ownerId, pos: march.startPos,
    path: march.path, startTime: 105, endTime: 109 });
events.emit(E.updateWorldEntities);
assert.equal(layer.aoiArmies.get(id).aniNode, soldier, '复用既有行军预制体');
assert.deepEqual(layer.aoiArmies.get(id).marchPath.points, march.path);
entities.clear(); events.emit(E.updateWorldEntities); assert.equal(layer.aoiArmies.size, 0, '断线清除旧 AOI 部队');
console.log('PASS AOI 行军接入实际地图层、后端路线、驻留、对象池复用和清理');
// 重登直接收到攻城 AOI，既没有旧行军路径绑定，也不能把攻城计时器当作移动。
marches = [{ ...march, targetType: 5, troopState: 4, state: 2, startTime: 110, endTime: 115 }];
entities.set(id, { entityId: id, entityType: 2, ownerId, troopIdx: 1, troopState: 4,
    targetId: 501, targetPos: { x: 14, y: 20 }, pos: march.endPos, path: [], startTime: 110, endTime: 115 });
events.emit(E.updateWorldEntities); advance(111000);
const sieging = layer.aoiArmies.get(id);
assert.equal(layer.troopBindings.get(id), 1);
assert.equal(sieging.marching, false); assert.equal(sieging.arrowNode.active, false);
assert.equal(sieging.siegeEffect.node.active, true);
assert.deepEqual(sieging.formation.target, new Vec2(14, 20));
assert.equal(sieging.siegeEffect.shots.length, 6, '每名护卫共用自己的投掷与命中特效，节点不随循环增加');
const fixed = { ...sieging.aniNode.position };
assert.deepEqual(layer.troopMapPosition(1), new Vec2(fixed.x, fixed.y), '攻城持续锁定城外部队位置');
advance(116000); assert.deepEqual(sieging.aniNode.position, fixed);
assert.equal(sieging.siegeEffect.node.active, true, '本地到点不自行宣布攻城结束');
entities.set(id, { entityId: id, entityType: 2, ownerId, troopIdx: 1, troopState: 1,
    pos: march.endPos, path: [...march.path].reverse(), startTime: 116, endTime: 120 });
marches = [{ ...march, targetType: 1, troopState: 1, state: 1, path: [...march.path].reverse(), startTime: 116, endTime: 120 }];
events.emit(E.updateWorldEntities); advance(117000);
assert.equal(sieging.siegeEffect.node.active, false); assert.equal(sieging.formation.target, null);
assert.equal(sieging.marching, true);
assert.deepEqual(layer.troopMapPosition(1), new Vec2(sieging.aniNode.position.x, sieging.aniNode.position.y), '返程仍跟随同一编队');
atHome = true; assert.equal(layer.troopMapPosition(1), null, '回到主城解除跟随'); atHome = false;
entities.clear(); events.emit(E.updateWorldEntities);
assert.equal(sieging.siegeEffect, null);
assert.deepEqual(layer.troopMapPosition(1), util.mapCellToPixelPoint(sampleMarchPath(marches[0], buildMarchPath(marches[0]), now).position), 'AOI 暂时消失时继续从最新返程快照定位');
marches = [{ ...march, path: [], startPos: {x:2000,y:20}, endPos:{x:2000,y:21} }];
assert.equal(layer.troopMapPosition(1), null, '无效位置不能把相机拉到地图外');
layer.onDestroy(); console.log('PASS 攻城重登绑定、原地交战与朝向、等待权威结算、返程停止特效、回收清理');

// 镜头在城池，部队还在远处：本人路线必须独立于可见 AOI 存在，不能偷偷生成一支部队。
now = 200000; entities.clear();
const assault = { ...march, targetType: 5, troopState: 1, startTime: 200, endTime: 220 };
marches = [assault, { ...assault, troopIdx: 2, targetId: 502,
    endPos: { x: 12.25, y: 23 }, path: [assault.startPos, { x: 10.25, y: 23 }, { x: 12.25, y: 23 }] }];
const far = new Layer(); far.parentLayer = new Node('FarArmyLayer');
far.createArmy = layer.createArmy; far.createArrow = layer.createArrow;
far.onLoad(); assert.equal(far.aoiArmies.size, 0); assert.equal(far.offscreenRoutes.size, 2);
const firstLine = far.offscreenRoutes.get(1), secondLine = far.offscreenRoutes.get(2);
const firstGraphic = firstLine.node.getComponent(Graphics);
assert.equal(firstLine.node.active, true);
assert.deepEqual(firstGraphic.points, assault.path.map(p => { const v = util.mapCellToPixelPoint(p); return [v.x, v.y]; }));
for (let i = 0; i < 20; i++) { now += 100; far.update(); }
assert.notDeepEqual(firstGraphic.points[0], [util.mapCellToPixelPoint(assault.startPos).x, util.mapCellToPixelPoint(assault.startPos).y]);
assert.deepEqual(firstGraphic.points.at(-1), [util.mapCellToPixelPoint(assault.endPos).x, util.mapCellToPixelPoint(assault.endPos).y]);
events.emit(E.updateMarches); assert.equal(far.offscreenRoutes.get(1), firstLine, '重复同步保留同一条线');
entities.set(id, { entityId: id, entityType: 2, ownerId, troopIdx: 1, troopState: 1,
    pos: assault.startPos, path: assault.path, startTime: assault.startTime, endTime: assault.endTime });
events.emit(E.updateWorldEntities);
assert.equal(far.offscreenRoutes.has(1), false, '进入视野后交给真实部队的路线，不叠画');
assert.equal(firstLine.node.isValid, false); assert.equal(far.aoiArmies.size, 1);
assert.equal(far.offscreenRoutes.get(2), secondLine);
assert.equal(far.aoiArmies.get(id).arrowNode.active, true);
entities.clear(); events.emit(E.updateWorldEntities);
assert.equal(far.aoiArmies.size, 0); assert.equal(far.offscreenRoutes.size, 2, '离开 AOI 后继续显示本人未完成行军');
marches[0] = { ...assault, state: 2, troopState: 4 }; events.emit(E.updateMarches);
assert.equal(far.offscreenRoutes.has(1), false, '攻城计时不能继续显示来路');
marches[0] = { ...assault, targetType: 1, startPos: assault.endPos, endPos: assault.startPos,
    path: [...assault.path].reverse(), startTime: now / 1000, endTime: now / 1000 + 20 };
events.emit(E.updateMarches);
assert.equal(far.offscreenRoutes.get(1).node.active, true, '撤回后切换到服务端返程路线');
marches[0] = { ...marches[0], path: [] }; events.emit(E.updateMarches);
assert.equal(far.offscreenRoutes.has(1), false, '没有服务端路径不能自行拉直线穿山');
marches = []; events.emit(E.updateMarches); assert.equal(far.offscreenRoutes.size, 0);
assert.equal(secondLine.node.isValid, false, '结束/断线同步清掉旧路线');
far.onDestroy();
console.log('PASS 攻城途中视野外持续画线、双队并行、AOI 内外交接无叠线、进入攻城收线、返程/重连清理');

// 城池的驻留入口取代人物，但隐藏只能在权威到达后生效，出征时须完整恢复。
now=300000; entities.clear(); cities.set('501',{entityId:501,allianceId:7,pos:march.endPos,deployCount:1});
const cityLayer=new Layer(); cityLayer.parentLayer=new Node('CityArmies');
cityLayer.createArmy=layer.createArmy; cityLayer.createArrow=layer.createArrow;
marches=[{...march,targetType:6,targetId:501,troopState:1,state:1,startTime:290,endTime:299}];
entities.set(id,{entityId:id,entityType:2,ownerId,troopIdx:1,troopState:1,pos:march.endPos,
    path:march.path,startTime:290,endTime:299});
cityLayer.onLoad(); assert.equal(cityLayer.aoiArmies.size,1,'本地倒计时结束不能擅自隐藏尚未确认到达的队伍');
const oldLogic=cityLayer.aoiArmies.get(id);
marches[0]={...marches[0],state:2,troopState:2}; events.emit(E.updateMarches);
assert.equal(cityLayer.aoiArmies.size,0,'已驻留队伍收进城池入口');
assert.equal(oldLogic.formation,null,'回收独立深度层的全部人物和阴影');
assert.deepEqual(cityLayer.troopMapPosition(1),util.mapCellToPixelPoint(march.endPos),'隐藏后仍可定位到驻留城池');
entities.set(id,{...entities.get(id),troopState:2,path:[],targetId:501});
marches[0]={...marches[0],targetType:1,targetId:0,state:1,troopState:1,startTime:300,endTime:310,
    startPos:march.endPos,endPos:march.startPos,path:[...march.path].reverse()};
events.emit(E.updateMarches);
assert.equal(cityLayer.aoiArmies.size,1,'新回城指令早于 AOI 也必须重新显示部队');
assert.equal(cityLayer.aoiArmies.get(id).marching,true);
entities.set('other',{entityId:'other',entityType:2,ownerId:'22',troopIdx:2,troopState:2,
    targetId:501,pos:march.endPos,path:[]}); events.emit(E.updateWorldEntities);
assert.equal(cityLayer.aoiArmies.has('other'),false,'盟友入城驻留也收纳');
entities.set('other',{...entities.get('other'),troopState:4,targetPos:{x:14,y:20}}); events.emit(E.updateWorldEntities);
assert.equal(cityLayer.aoiArmies.has('other'),true,'城外攻城中的队伍不能被隐藏');
cityLayer.onDestroy();
console.log('PASS 入城确认后隐藏整队、驻留定位、回城重新显示、盟友收纳、攻城保留');
