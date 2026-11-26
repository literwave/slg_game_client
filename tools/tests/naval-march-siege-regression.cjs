// 离线验证部队涉水自动坐战船行军、登岸恢复陆军，以及攻打河心水寨时列阵战船发起水战攻城。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const cache = new Map();

let now = 10000;
class Vec2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { if (typeof x === 'object') { this.x = x.x; this.y = x.y; } else { this.x = x; this.y = y; } return this; }
    clone() { return new Vec2(this.x, this.y); }
    subtract(v) { this.x -= v.x; this.y -= v.y; return this; }
    lengthSqr() { return this.x ** 2 + this.y ** 2; }
    normalize() { const d = Math.hypot(this.x, this.y); if (d) { this.x /= d; this.y /= d; } return this; }
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
}
class Vec3 extends Vec2 {}
class UITransform { setContentSize(w, h) { this.width = w; this.height = h; } setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; } }
class Sprite { static SizeMode = { CUSTOM: 0 }; enabled = true; }
class SpriteFrame { reset(settings) { Object.assign(this, settings); } addRef() {} }
class Graphics {
    shapes = []; strokes = 0; fills = 0;
    clear() { this.shapes = []; this.strokes = 0; this.fills = 0; }
    ellipse(...args) { this.shapes.push(['ellipse', ...args]); }
    moveTo(...args) { this.shapes.push(['moveTo', ...args]); }
    lineTo(...args) { this.shapes.push(['lineTo', ...args]); }
    circle(...args) { this.shapes.push(['circle', ...args]); }
    rect(...args) { this.shapes.push(['rect', ...args]); }
    close() {}
    fill() { this.fills++; }
    stroke() { this.strokes++; }
}
class AnimationClip {
    static WrapMode = { Loop: 2 };
    static createWithSpriteFrames(frames, fps) { return Object.assign(new AnimationClip(), { frames, duration: frames.length / fps }); }
    addRef() {}
}
class Animation {
    clips = new Map(); states = new Map();
    addClip(clip) { this.clips.set(clip.name, clip); }
    play(name) { this.current = name; }
    pause() {}
    stop() { this.stopped = true; }
    getState(name) {
        if (!this.states.has(name)) {
            const clip = this.clips.get(name);
            const state = { duration: clip.duration, time: 0, sample: () => {} };
            this.states.set(name, state);
        }
        return this.states.get(name);
    }
}
class Node {
    constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.position = new Vec2(); this.scale = { x: 1, y: 1 }; this.angle = 0; }
    addChild(n) { n.parent = this; this.children.push(n); }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    setPosition(x, y) { this.position.set(x, y); }
    setScale(x, y) { this.scale = { x, y }; }
    setSiblingIndex(i) { const list = this.parent.children; list.splice(list.indexOf(this), 1); list.splice(i, 0, this); }
    removeFromParent() { if (this.parent) { const list = this.parent.children; list.splice(list.indexOf(this), 1); this.parent = null; } }
    destroy() { this.destroyed = true; this.children.forEach(n => n.destroy()); this.components = null; }
}
const loads = [];
const cc = {
    Vec2, Vec3, UITransform, Sprite, SpriteFrame, Graphics, AnimationClip, Animation, Node,
    UIOpacity: class {},
    Rect: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } },
    Size: class { constructor(width, height) { Object.assign(this, { width, height }); } },
    Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
    isValid: n => !!n && !n.destroyed,
    resources: {
        load(name, Type, callback) {
            loads.push(name);
            const png = fs.readFileSync(path.join(root, 'assets/resources', name.replace('/spriteFrame', '.png')));
            const sheet = new SpriteFrame();
            sheet.texture = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
            queueMicrotask(() => callback(null, sheet));
        },
    },
};
const project = p => new Vec2((p.x - p.y) * 100, -(p.x + p.y) * 62.5);
const campaign = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));
const landscape = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/original-landscape.json'), 'utf8'));
const stubs = {
    'map/MapUtil': { default: { mapCellToPixelPoint: project, tileSize: { width: 200, height: 125 } } },
    'utils/DateUtil': { default: { getServerTime: () => now, monotonicNow: () => now } },
    'world/CityCommand': { default: { getInstance: () => ({ cities: new Map() }) } },
    'world/WorldCommand': { default: { getInstance: () => ({ occupyCountdownAt: () => null }) } },
    'map/WorldCampaign': { default: { config: campaign, gateAt: (x, y) => campaign.gates.find(g => g.x === x && g.y === y) || null } },
    'network/pto/ProtocolCommand': { idKey: id => String(id ?? 0) },
};
function load(name) {
    if (stubs[name]) return stubs[name];
    if (cache.has(name)) return cache.get(name).exports;
    const file = path.join(root, 'assets/scripts', name + '.ts'), mod = { exports: {} };
    cache.set(name, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function('require', 'module', 'exports', code)(id => id === 'cc' ? cc : load(path.relative(path.join(root, 'assets/scripts'),
        path.resolve(path.dirname(file), id)).replace(/\\/g, '/')), mod, mod.exports);
    return mod.exports;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

async function main() {
    const water = load('map/WorldWater');
    water.setWorldWaterData(landscape);

    // 1. Verify all 6 river water-fortresses have water cells & navalSiegeAnchor puts shoreline attackers onto river water
    const waterGates = campaign.gates.filter(g => g.crossing === 'bridge');
    assert.equal(waterGates.length, 6);
    for (const gate of waterGates) {
        assert.equal(water.isWaterCell(gate.x, gate.y), true, `${gate.name} 中心必须位于河面`);
        for (const ent of gate.attackEntrances) {
            const anchor = water.navalSiegeAnchor(ent, gate);
            assert.equal(water.isWaterCell(anchor.x, anchor.y), true, `${gate.name} 攻寨入口 (${ent.x},${ent.y}) 战船视觉锚点必须落在河面`);
            assert.ok(Math.hypot(anchor.x - gate.x, anchor.y - gate.y) >= 1.8, `${gate.name} 战船不能叠进水寨内部`);
        }
    }
    console.log('PASS 6 座河心水寨水域判定及岸边攻寨入口战船水面锚点校准');

    // 2. Verify MarchFormation switches cleanly between Land (cavalry+infantry) and Naval (warships + water wakes)
    const Formation = load('map/entries/MarchFormation').default;
    const host = new Node('Army');
    const formation = new Formation(host);
    const troop = {
        getSortedHeroes: () => [{ heroIdx: 1, position: 1 }, { heroIdx: 2, position: 2 }, { heroIdx: 3, position: 3 }],
        getSoldier: () => ({ count: 300 }),
    };
    formation.configure(troop, true);
    const emptyPath = { path: { length: 0 } };
    const step = (pos, to, moving) => { now += 50; formation.update(emptyPath, { position: pos, towards: to, moving }); };

    // On land: all 7 members active, no naval sprite sheet loaded yet
    await tick();
    step({ x: 10, y: 10 }, { x: 11, y: 10 }, true);
    assert.equal(formation.members.filter(m => m.node.active).length, 7, '陆地行军 7 人阵形全部激活');
    assert.equal(loads.some(p => p.includes('naval_warship_v1')), false, '未涉水不提前加载战船图集');

    // Enter river: loads naval_warship_v1, activates 3 warships (flagship + 2 escorts), boards remaining 4 infantry
    formation.setNaval(true, null);
    await tick();
    step({ x: 714, y: 470 }, { x: 714, y: 468 }, true);
    assert.equal(loads.some(p => p.includes('naval_warship_v1')), true, '涉水时按需加载 5 向战船图集');
    const activeShips = formation.members.filter(m => m.node.active);
    assert.equal(activeShips.length, 3, '涉水编队为 1 艘主舰 + 2 艘护卫战舟，其余步兵登船');
    for (const ship of activeShips) {
        assert.equal(ship.navalPose, true, '涉水成员切换为战船外观');
        assert.equal(ship.shadow.active, false, '水面关闭陆地干地阴影');
        assert.ok(ship.sprite.spriteFrame?.name?.startsWith('naval_warship_'), '使用战船图集帧');
    }
    assert.ok(formation.dust.strokes > 0, '战船行军绘制水面波纹与船尾水痕');

    // Return to land: restores all 7 land soldiers & ground shadows
    formation.setNaval(false, null);
    step({ x: 714, y: 475 }, { x: 714, y: 476 }, true);
    assert.equal(formation.members.filter(m => m.node.active).length, 7, '登岸后完整恢复 7 人陆军阵形');
    for (const m of formation.members) {
        assert.equal(!!m.navalPose, false, '登岸后清除战船姿态');
        assert.equal(m.shadow.active, true, '登岸后恢复陆地阴影');
    }
    console.log('PASS 涉水自动换乘 3 艘战船 + 水面波纹尾迹，登岸平滑恢复陆军阵形');

    // 3. Verify Naval Siege against 蒲坂渡 (river water-fortress) launches flaming-arrow volleys from warships
    const pubandu = waterGates.find(g => g.name === '蒲坂渡');
    const shoreEnt = pubandu.attackEntrances.find(e => !water.isWaterCell(e.x, e.y));
    assert.ok(shoreEnt, '蒲坂渡应有贴岸入口用于检验战船前出水面');
    const siegeAnchor = water.navalSiegeAnchor(shoreEnt, pubandu);
    formation.setSiegeTarget(new Vec2(pubandu.x, pubandu.y));
    formation.setNaval(true, siegeAnchor);
    for (let i = 0; i < 30; i++) step(shoreEnt, pubandu, false);
    const volley = formation.getSiegeVolley();
    assert.ok(volley.seconds > 0, '水战攻寨立即启动战船齐射计时');
    assert.equal(volley.sources.length, 4, '主舰双发 + 两翼护卫舟齐射共 4 路火箭发射点');
    const centerPx = project(shoreEnt), anchorPx = project(siegeAnchor);
    assert.ok(Math.hypot(formation.members[0].foot.x - anchorPx.x, formation.members[0].foot.y - anchorPx.y)
        < Math.hypot(formation.members[0].foot.x - centerPx.x, formation.members[0].foot.y - centerPx.y),
        '贴岸攻寨时主舰前出至前方河面列阵');
    console.log('PASS 攻打河心水寨自动战船列阵、前出水面并持续发射水战火箭齐射');

    // 4. End-to-end ArmyLogic check: attacking 蒲坂渡 activates naval siege + SiegeEffect
    const ArmyLogic = load('map/entries/ArmyLogic').default;
    const logic = new ArmyLogic();
    const layerNode = new Node('ArmyLayer');
    const aniNode = new Node('Ani'), arrowNode = new Node('Arrow');
    layerNode.addChild(aniNode); layerNode.addChild(arrowNode);
    aniNode.addComponent(Animation); arrowNode.addComponent(UITransform); arrowNode.addComponent(Sprite);
    logic.setWorldEntity({
        entityId: '999', entityType: 2, ownerId: '1', troopIdx: 1, troopState: 4,
        targetId: 777, targetPos: { x: pubandu.x, y: pubandu.y },
        pos: shoreEnt, path: [], startTime: 10, endTime: 10,
    }, true, aniNode, arrowNode, troop);
    await tick();
    for (let i = 0; i < 30; i++) { now += 50; logic.update(); }
    assert.equal(logic.siegeEffect.node.active, true, 'ArmyLogic 水战攻寨激活火箭与城墙受击特效');
    assert.equal(aniNode.getChildByName('WorldTroopMarker').active, false, '水面战船隐藏陆地地面圈');
    logic.destroy();
    formation.destroy();
    console.log('PASS ArmyLogic 端到端涉水行军与水寨战船攻城全链路通过');
}

main().catch(err => { console.error(err); process.exit(1); });
