// 验证图集接入、八方向队形、异步资源与到达收队，不发送任何行军请求。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), cache = new Map(), loads = [];
let now = 1000;
class Vec2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { if (typeof x === 'object') { this.x = x.x; this.y = x.y; } else { this.x = x; this.y = y; } return this; }
    clone() { return new Vec2(this.x, this.y); }
    subtract(v) { this.x -= v.x; this.y -= v.y; return this; }
    lengthSqr() { return this.x ** 2 + this.y ** 2; }
    normalize() { const d = Math.hypot(this.x, this.y); if (d) { this.x /= d; this.y /= d; } return this; }
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
}
class UITransform { setContentSize(w, h) { this.width = w; this.height = h; } setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; } }
class Sprite { static SizeMode = { CUSTOM: 0 }; enabled = true; }
class SpriteFrame { reset(settings) { Object.assign(this, settings); } addRef() {} }
class Graphics { clear() { this.shapes = []; } ellipse(...args) { (this.shapes ||= []).push(args); } fill() {} }
class AnimationClip {
    static WrapMode = { Loop: 2 };
    static createWithSpriteFrames(frames, fps) { return Object.assign(new AnimationClip(), { frames, duration: frames.length / fps }); }
    addRef() {}
}
class Animation {
    clips = new Map(); states = new Map(); plays = 0; stops = 0;
    addClip(clip) { this.clips.set(clip.name, clip); }
    play(name) { this.current = name; this.stopped = false; this.plays++; }
    pause() { this.paused = true; }
    stop() { this.stopped = true; this.stops++; }
    getState(name) {
        if (!this.states.has(name)) {
            const clip = this.clips.get(name), state = { duration: clip.duration, time: 0 };
            state.sample = () => { this.node.getComponent(Sprite).spriteFrame = clip.frames[Math.min(clip.frames.length - 1,
                Math.floor(state.time / state.duration * clip.frames.length))]; };
            this.states.set(name, state);
        }
        return this.states.get(name);
    }
}
class Node {
    constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.position = new Vec2(); this.scale = { x: 1, y: 1 }; }
    addChild(n) { n.parent = this; this.children.push(n); }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    setPosition(x, y) { this.position.set(x, y); }
    setScale(x, y) { this.scale = { x, y }; }
    setSiblingIndex(i) { const list = this.parent.children; list.splice(list.indexOf(this), 1); list.splice(i, 0, this); }
    removeFromParent() { if (this.parent) { const list = this.parent.children; list.splice(list.indexOf(this), 1); this.parent = null; } }
    destroy() {
        assert.ok(!this.destroyed, '不能重复销毁同一个节点');
        this.destroyed = true; this.children.forEach(n => n.destroy()); this.components = null;
    }
}
const cc = { Vec2, UITransform, Sprite, SpriteFrame, Graphics, AnimationClip, Animation, Node,
    Rect: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } },
    Size: class { constructor(width, height) { Object.assign(this, { width, height }); } },
    Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
    isValid: n => !!n && !n.destroyed,
    resources: { load(name, Type, callback) {
        loads.push(name);
        const png = fs.readFileSync(path.join(root, 'assets/resources', name.replace('/spriteFrame', '.png')));
        const sheet = new SpriteFrame(); sheet.texture = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
        queueMicrotask(() => callback(null, sheet));
    } }
};
const project = p => new Vec2((p.x - p.y) * 128, -(p.x + p.y) * 64);
const stubs = {
    'map/MapUtil': { default: { mapCellToPixelPoint: project } },
    'utils/DateUtil': { default: { monotonicNow: () => now } }
};
function load(name) {
    if (stubs[name]) return stubs[name];
    if (cache.has(name)) return cache.get(name).exports;
    const file = path.join(root, 'assets/scripts', name + '.ts'), mod = { exports: {} }; cache.set(name, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('require', 'module', 'exports', code)(id => id === 'cc' ? cc : load(path.relative(path.join(root, 'assets/scripts'),
        path.resolve(path.dirname(file), id)).replace(/\\/g, '/')), mod, mod.exports);
    return mod.exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const troop = { getSortedHeroes: () => [{ heroIdx: 1, position: 1 }, { heroIdx: 2, position: 2 }, { heroIdx: 3, position: 3 }], getSoldier: () => ({ count: 100 }) };
const Formation = load('map/entries/MarchFormation').default, Playback = load('world/MarchPlayback').default;
function create(t = troop) { const host = new Node('Army'), formation = new Formation(host); formation.configure(t, true); return formation; }
const emptyPath = { path: { length: 0 } };
function update(f, dx = 1, dy = 0, moving = false) { now += 16; f.update(emptyPath, { position: { x: 10, y: 10 }, towards: { x: 10 + dx, y: 10 + dy }, moving }); }
async function main() {
    const renderLayer = new Node('WorldDepthActors'), host = new Node('Army');
    renderLayer.addChild(host); host.setPosition(project({ x: 10, y: 10 }));
    const detached = new Formation(host, renderLayer); detached.configure(troop, true);
    update(detached, 1, 0, true);
    const detachedNodes = detached.members.map(m => m.node);
    assert.equal(detachedNodes.length, 7);
    for (const member of detached.members) {
        assert.equal(member.node.parent, renderLayer, '每个兵要和建筑独立排序');
        assert.deepEqual(member.node.position, member.foot, '独立排序使用地图落脚点，不能再次叠加整队偏移');
    }
    detached.configure(null, false);
    assert.ok(detachedNodes.every(n => n.destroyed && !n.parent), '更换编队回收原来的独立渲染节点');
    detached.destroy();
    assert.deepEqual(renderLayer.children, [host], '驻留结束/对象池回收不能留下独立士兵');
    await tick();
    assert.deepEqual(renderLayer.children, [host], '晚到资源不能复活已经回收的士兵');
    console.log('PASS 主将与小兵独立遮挡、地图坐标、更换编队和异步回收');
    const destroyedLayer = new Node('DestroyedMapLayer'), destroyedHost = new Node('DestroyedArmy');
    destroyedLayer.addChild(destroyedHost);
    const destroyedFormation = new Formation(destroyedHost, destroyedLayer);
    destroyedFormation.configure(troop, true);
    destroyedLayer.destroy();
    assert.doesNotThrow(() => { destroyedFormation.destroy(); destroyedFormation.destroy(); });
    await tick();
    assert.equal(destroyedFormation.members.length, 0);
    console.log('PASS 地图先销毁宿主和士兵时清理安全，重复释放及迟到加载不报错');
    const f = create();
    update(f, -1, 1, true);
    assert.ok(f.members.every(m => !m.sprite.node.active), '加载前不露出旧头像或整张图集');
    await tick();
    assert.equal(f.members.length, 7);
    assert.equal(f.members.filter(m => m.lag === 0).length, 1, '多武将部队仍由一个视觉主将领队');
    assert.ok(f.members.every(m => m.sprite.node.active && m.moving && m.sprite.node.scale.x === -1), '资源完成后直接进入当前左行朝向');
    assert.equal(loads.length, 7, '骑马步行动作、分段腿、独立站姿、步兵及驻守图集在多支部队之间共享');
    assert.ok(loads.includes('ui/march/guard_march_walk12/spriteFrame'), '步兵必须使用完整十二帧步态');
    assert.ok(loads.includes('ui/march/commander_walk_grounded_primary_v6/spriteFrame'), '骑将必须使用重绘朝向和四蹄的十二帧步态');
    assert.ok(!loads.some(name => /march_(sheet|diagonal|front_walk|side_walk)|guard_march_cycle/.test(name)),
        '增加动作帧后不能继续加载旧的整张补丁图集');
    assert.equal(loads.filter(name => name === 'ui/march/guard_defend_sheet/spriteFrame').length, 1,
        '半跪持盾图集只能共享加载一次');
    for (const kind of ['cavalry', 'infantry']) {
        const set = await load('map/entries/MarchAnimationLibrary').loadMarchAnimations(kind);
        assert.equal(set.clips.length, 8); assert.equal(set.idleFrames.length, 8);
        assert.deepEqual(set.mirrored, [false, false, false, true, true, true, false, false]);
        if (kind === 'cavalry') {
            const { selectMarchWalkView } = load('map/entries/MarchAnimationLibrary');
            assert.equal(set.walkViews.length, 12, '侧斜与陡斜分开，共十二个真实朝向');
            for (const view of set.walkViews) {
                assert.equal(view.frames.length, 12);
                assert.equal(view.clip.duration, .96, '骑马各视角保持同一四拍周期');
            }
            const pick = (degree, previous) => selectMarchWalkView(set.walkViews, degree * Math.PI / 180, previous);
            const diagonal = pick(-26.6), steep = pick(-56);
            assert.equal(diagonal.clip.name, 'cavalry_walk_rd');
            assert.equal(steep.clip.name, 'cavalry_walk_steep_rd', '截图中的陡斜路线不能仍用侧身图');
            assert.equal(pick(-124).clip.name, 'cavalry_walk_steep_ld');
            assert.equal(pick(-124).mirrored, true);
            assert.equal(pick(56).clip.name, 'cavalry_walk_steep_ru');
            assert.equal(pick(124).clip.name, 'cavalry_walk_steep_lu');
            assert.equal(pick(-44, steep), steep, '切换边界有防抖余量');
            assert.equal(pick(-40, steep), diagonal, '真正转弯后切回侧斜');
            assert.equal(pick(179).clip.name, 'cavalry_walk_l');
            assert.equal(pick(-179).clip.name, 'cavalry_walk_l', '跨越角度零点不反复切换');
        }
        const guardColumns = kind === 'cavalry' ? 4 : 3;
        const guardIndices = kind === 'cavalry' ? [0, 1, 2, 1, 0, 7, 6, 7] : [0, 1, 2, 1, 0, 3, 4, 3];
        for (const [i, index] of guardIndices.entries()) {
            assert.equal(set.guardFrames[i].rect.x, index % guardColumns * 256, '哨兵朝向必须使用对应的侧/斜/正视列');
            assert.equal(set.guardFrames[i].rect.y, Math.floor(index / guardColumns) * 256,
                '前后防区不能都误用正面图');
            if (kind === 'infantry') assert.ok(set.guardFrames[i].name.startsWith('guard_defend_sheet_'),
                '占领必须使用真正半跪姿势，不能把站立图片压扁');
        }
        for (const [i, row] of [0, 1, 2, 1, 0, 3, 4, 3].entries()) {
            assert.equal(set.clips[i].frames.length, 12);
            assert.equal(new Set(set.clips[i].frames).size, 12, '十二帧必须对应不同图片切片');
            assert.equal(set.clips[i].duration, kind === 'cavalry' ? .96 : .75, '骑马和步兵分别使用适合自己的周期，转向不重置');
            assert.equal(set.idleFrames[i].rect.x, row * 192);
            assert.equal(set.idleFrames[i].rect.y, kind === 'cavalry' ? 0 : 6 * 192);
            assert.ok(!set.walkFrames[i].includes(set.idleFrames[i]), '停止使用独立站姿，不冻结抬脚帧');
            set.clips[i].frames.forEach((frame, phase) => {
                if (kind === 'cavalry') {
                    const axial = row === 2 || row === 4;
                    const start = [0,12,12,24,0][row], slot = start + phase;
                    const w=axial?148:209,h=axial?222:209;
                    assert.equal(frame.rect.x,slot%6*w+.5);
                    assert.equal(frame.rect.y,Math.floor(slot/6)*h+.5);
                    assert.equal(frame.rect.width,w-1);assert.equal(frame.rect.height,h-1);
                    assert.equal(frame.originalSize.width,frame.originalSize.height,'portrait cells must not stretch the horse sideways');
                    assert.ok(frame.originalSize.height>h,'virtual gutters preserve the feet and spear');
                } else {
                    const slot=row*12+phase;
                    assert.equal(frame.rect.x,slot%10*192);assert.equal(frame.rect.y,Math.floor(slot/10)*192);
                    assert.equal(frame.rect.width,192);assert.equal(frame.rect.height,192);
                }
                assert.ok(frame.texture.width <= 2048 && frame.texture.height <= 2048);
                assert.equal(frame.packable, false, '运行时小帧不能重复进入动态图集');
            });
        }
    }
    console.log('PASS 七张共享图集、十二帧切片、骑马独立周期、正背面比例、站姿与驻守姿势');

    const rigFormation = create(); await tick();
    update(rigFormation, 1, 0, true);
    const rigMember = rigFormation.members[0], rig = rigMember.walkRig;
    assert.ok(rig.ready && rig.root.active && !rigMember.sprite.enabled, '浅前斜显示分段步态，不能叠加旧前腿');
    for (const phase of [0, .125, .25, .375, .5, .625, .75, .875]) {
        rig.sample(phase);
        for (const leg of rig.legs) assert.equal(leg.hoof.angle, 0, '蹄底独立于小腿转角，不能卷成钩');
    }
    rigFormation.resetTrail(); update(rigFormation, 0, 1, true);
    assert.ok(rig.root.active && rigMember.sprite.node.scale.x === -1, '左前斜镜像同一完整骨骼');
    rigFormation.resetTrail(); update(rigFormation, 1, -1, true);
    assert.ok(!rig.root.active && rigMember.sprite.enabled, '侧向恢复原图，不残留前腿节点');
    rigFormation.destroy();
    console.log('PASS 前蹄独立平底、浅前斜/镜像接入、其他视角恢复和安全回收');
    const guards = f.members.filter(m => m.lag > 0);
    for (let i = 0; i < 90; i++) {
        update(f, -1, 1, true);
        assert.equal(new Set(guards.map(m => m.animation.getState(m.clip).time)).size, 1, '六名护卫必须共享步态时间');
        assert.equal(new Set(guards.map(m => m.sprite.spriteFrame.name.split('_').pop())).size, 1, '护卫同拍迈步，不能各自错开姿势');
    }
    const steps = new Set();
    for (let i = 0; i < 60; i++) { update(f, -1, 1, true); steps.add(guards[0].sprite.spriteFrame.name); }
    assert.equal(steps.size, 12, '统一时钟播放全部十二个步态，不是复制帧或冻结画面');
    update(f, 1, 0, true);
    for (const m of guards) assert.ok(Math.abs(m.animation.getState(m.clip).time - f.gaitTime % .75) < 1e-9,
        '队员依次转弯时沿用全队相位，不从第一帧重新起步');
    console.log('PASS 整队同步步频、完整步态采样、转向保持相位');

    // 使用真实配置速度验证：回城与调动同样跑动，路线进度和到达时刻仍各自服从服务端。
    const targetTypes = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/TargetType.json'), 'utf8'));
    const runStart = now;
    const runners = [1, 6, 4].map(targetType => {
        const speed = targetTypes[targetType].Speed, formation = create(), playback = new Playback();
        const points = [{ x: 10, y: 10 }, { x: 10, y: 13 }, { x: 13, y: 13 }];
        if (targetType === 1) points.reverse();
        const motion = { targetType, state: 1, startTime: runStart / 1000, endTime: runStart / 1000 + 6 / speed,
            startPos: points[0], endPos: points[2], path: points };
        playback.setMotion(motion, runStart, runStart);
        formation.update(playback, playback.sample(runStart));
        return { targetType, speed, formation, playback, motion, frames: new Set() };
    });
    await tick();
    for (let step = 0; step < 100; step++) {
        now += 16;
        for (const r of runners) {
            if (step === 30) {
                const gait = r.formation.gaitTime;
                assert.equal(r.playback.setMotion(r.motion, now, now), false);
                r.formation.configure(troop, true);
                assert.equal(r.formation.gaitTime, gait, '重复同步不能重置跑步相位');
            }
            r.formation.update(r.playback, r.playback.sample(now));
            assert.ok(Math.abs(r.playback.distance - (now - runStart) / 1000 * r.speed) < 1e-8,
                '跑动表现不能加快服务器路径插值或缩短倒计时');
            for(const member of r.formation.members){
                const state=member.animation.getState(member.clip);
                assert.ok(Math.abs(state.time-r.formation.gaitTime%state.duration)<1e-9,'shared monotonic clock with species-specific cycle');
                if(member.kind==='cavalry'){
                    assert.equal(member.sprite.node.position.y,0,'do not add synthetic horse bounce');
                    assert.ok(member.sprite.node.angle===0,'do not roll the whole horse around its planted feet');
                    assert.equal(member.sprite.node.scale.y,1,'do not squash horse legs');
                }
            }
            r.frames.add(r.formation.members[1].sprite.spriteFrame.name);
        }
    }
    assert.ok(Math.abs(runners[0].formation.gaitTime - runners[1].formation.gaitTime) < 1e-8,
        '回城与调动必须使用相同跑步节奏');
    assert.ok(runners[0].formation.gaitTime > runners[2].formation.gaitTime * 1.3,
        '快行军必须实际加快动作，不能只是更快地平移站姿');
    for (const r of runners) assert.equal(r.frames.size, 12, '跑动仍覆盖完整十二张动作帧');
    while (now < runStart + 10400) {
        now += 16;
        for (const r of runners) {
            r.formation.update(r.playback, r.playback.sample(now));
            assert.ok(r.formation.members.every(m => m.sprite.color === undefined
                && m.sprite.node.getComponent(UITransform).anchorY === 18 / 256),
                '快行军不改变透明度、亮度和落脚锚点');
        }
    }
    for (const r of runners) {
        assert.deepEqual(r.playback.sample(now).position, r.motion.endPos);
        assert.ok(r.formation.members.every(m => !m.moving && m.sprite.spriteFrame === m.animations.idleFrames[m.facing]));
        assert.equal(r.formation.dustVisible, false);
        assert.equal(r.motion.state, 1, '收步不能修改服务器状态');
        r.formation.destroy();
    }
    console.log('PASS 回城/调动同速跑步、完整十二帧、重复推送不断步、服务端路程与时长不变、拐弯到城收步');
    const members = f.members.slice(); f.configure(troop, true);
    assert.deepEqual(f.members, members, '重复业务推送不重建角色');
    for (const [facing, [dx, dy]] of [[1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0]].entries()) {
        const formation = create(); await tick(); update(formation, dx, dy);
        const length = Math.hypot(dx, dy), forward = new Vec2(dx / length, dy / length);
        for (const m of formation.members) {
            assert.equal(m.facing, facing, '八个行进方向对应正确的正面/背面/镜像帧');
            const foot = project({ x: 10 - forward.x * m.lag - forward.y * m.side, y: 10 - forward.y * m.lag + forward.x * m.side });
            assert.ok(Vec2.distance(m.foot, foot) < .0001, '每个方向均先按地面队形排列再投影');
        }
        for (const a of formation.members) for (const b of formation.members) {
            const dx = a.foot.x - b.foot.x, dy = a.foot.y - b.foot.y;
            const cellDistance = Math.hypot(dx / 256 - dy / 128, -dx / 256 - dy / 128);
            assert.ok(cellDistance <= .4, '紧凑两排护卫的落脚点不超过 0.4 格，避免摊开占多格');
        }
        const ordered = formation.root.children.slice(1).map(n => n.position.y);
        assert.deepEqual(ordered, ordered.slice().sort((a, b) => b - a), '人物按落脚点遮挡排序');
        formation.setSiegeTarget(new Vec2(10 + dx, 10 + dy));
        await tick();
        for (let i=0;i<160;i++) update(formation,0,0,false);
        const fixedFeet=formation.members.map(m=>[m.foot.x,m.foot.y]);
        const attackPoses=new Set(),commandPoses=new Set();
        const clock=formation.siegeStartedAt;
        formation.setSiegeTarget(new Vec2(10 + dx, 10 + dy));
        assert.equal(formation.siegeStartedAt,clock,'repeat server push must not reset a volley');
        const stopCounts=formation.members.map(m=>m.animation.stops);
        for(let i=0;i<240;i++) {
            update(formation,0,0,false);
            assert.deepEqual(formation.members.map(m=>[m.foot.x,m.foot.y]),fixedFeet,'feet stay planted after deploying');
            assert.equal(formation.getSiegeVolley().sources.length,6);
            for(const member of formation.members) {
                assert.equal(member.facing,facing);assert.equal(member.moving,false);
                if(member.kind==='cavalry') {
                    assert.equal(member.siegePose,true,'mounted commander must visibly give orders');
                    assert.ok(member.sprite.spriteFrame.name.startsWith('siege-commander-v2_'));
                    assert.equal(member.sprite.node.scale.x,(member.siegeMirrored?-1:1)*member.sprite.node.scale.y);
                    assert.equal(member.sprite.color.a,255);
                    commandPoses.add(member.sprite.spriteFrame.name);
                } else {
                    assert.equal(member.siegePose,true);assert.equal(member.sprite.color.a,255);
                    assert.equal(member.sprite.node.scale.x,member.sprite.node.scale.y);
                    attackPoses.add(member.sprite.spriteFrame.name);
                }
            }
        }
        assert.equal(attackPoses.size,8,'complete throw/recovery sequence');
        assert.equal(commandPoses.size,8,'commander must raise, point and recover during every siege cycle');
        assert.ok(formation.getSiegeVolley().sources.every(source=>source.index>=0),'commander never creates a fake projectile');
        formation.members.forEach((m,i)=>assert.equal(m.animation.stops,stopCounts[i],'no repeated animation stop'));
        const groundFeet=formation.members.map(m=>({x:m.foot.x/256-m.foot.y/128,y:-m.foot.x/256-m.foot.y/128}));
        const rank=p=>(p.x-10)*forward.x+(p.y-10)*forward.y;
        assert.ok(groundFeet.slice(1).every(p=>rank(p)>rank(groundFeet[0])),'commander behind both infantry ranks');
        formation.setSiegeTarget(new Vec2(10-dx,10-dy));
        assert.equal(formation.siegeStartedAt,null,'retarget restarts preparation');
        assert.equal(formation.getSiegeVolley().sources.length,0);
        formation.setSiegeTarget(null);update(formation,dx,dy,true);
        assert.equal(formation.getSiegeVolley().sources.length,0,'retreat immediately cancels all projectiles');
        assert.ok(formation.members.every(m=>!m.siegePose));
        for(const m of formation.members) {
            assert.equal(m.sprite.color.r,255);assert.equal(m.sprite.node.getComponent(UITransform).anchorY,18/256);
        }
        formation.destroy();
    }
    console.log('PASS 八方向展开两排、主将后置、稳定落脚、投掷八帧、重复推送与撤退取消');
    // 直线行军即使高速或改变帧率，也不能因单人追赶滤波额外拉长阵形。
    for (const [speed, frameMs] of [[.25, 16], [4, 16], [8, 33]]) {
        const compact = create(); await tick();
        const movement = new Playback();
        movement.setMotion({ state: 1, startTime: 1, endTime: 1 + 100 / speed,
            path: [{ x: 10, y: 10 }, { x: 110, y: 10 }], startPos: { x: 10, y: 10 }, endPos: { x: 110, y: 10 } }, 1000, now);
        for (let step = 0; step < 120; step++) {
            if (step === 60) movement.setMotion({ state: 1, startTime: 1, endTime: 1 + 100 / speed,
                path: [{ x: 10, y: 10.25 }, { x: 110, y: 10.25 }],
                startPos: { x: 10, y: 10.25 }, endPos: { x: 110, y: 10.25 } }, 1000, now);
            now += frameMs; const sample = movement.sample(now); compact.update(movement, sample);
            const center = project(sample.position);
            for (const m of compact.members) {
                const expected = project({ x: sample.position.x - m.lag, y: sample.position.y + m.side });
                assert.ok(Vec2.distance(m.foot, expected) < .001, '共享平移不会产生速度相关的追赶距离');
                assert.ok(Math.hypot((m.foot.x-center.x)/256-(m.foot.y-center.y)/128,
                    -(m.foot.x-center.x)/256-(m.foot.y-center.y)/128) <= .4);
            }
        }
        compact.destroy();
    }
    console.log('PASS 低速、高速、不同帧率及改道坐标校正均保持阵位，不随速度拉散');
    const exiting = create(); await tick();
    const center = { x: 10, y: 10 };
    const cityMotion = { state: 1, startTime: 1, endTime: 13, path: [center, { x: 4, y: 10 }], startPos: center, endPos: { x: 4, y: 10 } };
    const exitPlayback = new Playback();
    exitPlayback.setMotion(cityMotion, 1000, now); exiting.resetTrail();
    exiting.update(exitPlayback, exitPlayback.sample(now));
    assert.equal(exiting.members.filter(m => m.node.active).length, 7, '城内起步时整队正常显示');
    assert.deepEqual(exitPlayback.path.points, cityMotion.path, '编队不能使用额外的绕墙路径');
    for (let i = 0; i < 300; i++) {
        now += 16; exiting.update(exitPlayback, exitPlayback.sample(now));
        for (const member of exiting.members) {
            assert.equal(member.node.active, true, '在城内和城墙处均不能隐藏士兵');
            const x = member.foot.x / 256 - member.foot.y / 128, y = -member.foot.x / 256 - member.foot.y / 128;
            assert.ok(Math.abs(x - (10 - exitPlayback.distance + member.lag)) < .00001);
            assert.ok(Math.abs(y - (10 - member.side)) < .00001, '整队保持阵位沿服务端直线前进');
            assert.equal(member.sprite.color, undefined, '正常行走不额外使用透明度渐变');
        }
    }
    assert.equal(exiting.members.filter(m => m.node.active).length, 7);
    exiting.destroy();
    console.log('PASS 主将和六名护卫从城内直接沿后端路线行走，全程可见且无虚化');
    const halt = create(); await tick();
    for (let i = 0; i < 40; i++) update(halt, 1, 0, true);
    update(halt, 1, 0, false);
    assert.ok(halt.members.every(m => m.moving), '到达当帧整队收步，不让主将先瞬间切站姿');
    for (let i = 0; i < 13; i++) update(halt, 1, 0, false);
    assert.ok(halt.members.every(m => !m.moving), '收步在 0.2 秒内完成，不继续原地走路');
    assert.ok(halt.members.every(m => m.sprite.spriteFrame === m.animations.idleFrames[m.facing]));
    assert.equal(halt.dustVisible, false);
    halt.destroy();
    console.log('PASS 到达整队共同收步、四蹄站姿、有限时长停止');
    const playback = new Playback(), march = { state: 1, startTime: 1, endTime: 3, path: [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }], startPos: { x: 10, y: 10 }, endPos: { x: 11, y: 11 } };
    const arrival = create(); await tick(); playback.setMotion(march, 1000, now);
    for (let i = 0; i < 240; i++) { now += 16; arrival.update(playback, playback.sample(now)); }
    assert.ok(arrival.members.every(m => !m.moving && m.animation.stopped));
    assert.ok(arrival.members.every(m => m.sprite.spriteFrame === m.animations.idleFrames[m.facing]));
    assert.equal(arrival.dustVisible, false, '驻留不继续扬尘');
    const stopped = arrival.members.map(m => [m.foot.x, m.foot.y, m.facing, m.animation.plays]);
    for (let i = 0; i < 60; i++) { now += 16; arrival.update(playback, playback.sample(now)); }
    assert.deepEqual(arrival.members.map(m => [m.foot.x, m.foot.y, m.facing, m.animation.plays]), stopped, '驻留位置朝向和动画不反复跳动');
    assert.equal(march.state, 1, '显示层不改服务端业务状态');
    const jitter = create(); await tick();
    const angle = deg => { const a = deg * Math.PI / 180, sx = Math.cos(a), sy = Math.sin(a); update(jitter, sx / 256 - sy / 128, -sx / 256 - sy / 128, true); };
    angle(20); const before = jitter.members[0].animation.plays;
    for (let i = 0; i < 20; i++) angle(i % 2 ? 23 : 20);
    assert.equal(jitter.members[0].animation.plays, before, '朝向边界的小幅变化不反复切动画');
    angle(Math.atan(.5) * 180 / Math.PI);
    assert.equal(jitter.members[0].facing, 1, '等距地图右上行军必须能从水平朝向转入');
    angle(-56);
    assert.equal(jitter.members[0].clip, 'cavalry_walk_steep_rd', '实际编队沿陡斜路径选用补充朝向');
    assert.equal(jitter.members[0].sprite.node.scale.x, 1);
    assert.ok(Math.abs(jitter.members[0].animation.getState(jitter.members[0].clip).time - jitter.gaitTime % .75) < 1e-9,
        '跨入补充视角也不能重置跑步节奏');
    angle(-124);
    assert.equal(jitter.members[0].clip, 'cavalry_walk_steep_ld');
    assert.equal(jitter.members[0].sprite.node.scale.x, -1, '陡斜左行需要正确镜像');
    console.log('PASS 折线转弯、到达收队、停驻稳定、扬尘停止、朝向边界防抖');
    for (const data of [troop, null]) {
        const defense = create(data); await tick();
        for (let i = 0; i < 20; i++) update(defense, 1, 0, true);
        const center = project({ x: 10, y: 10 });
        defense.setGuarding(true);
        assert.ok(defense.members.slice(1).every(m => !m.guardPose), '到达展开前不能提前跪下');
        for (let i = 0; i < 100; i++) {
            const feet = defense.members.map(m => m.foot.clone());
            update(defense, 1, 0, false);
            assert.equal(defense.root.position.x, 0); assert.equal(defense.root.position.y, 0);
            assert.ok(Vec2.distance(defense.members[0].foot, center) < .001, '主将始终居中，不能为读条横移整队');
            defense.members.forEach((m, index) => assert.ok(Vec2.distance(feet[index], m.foot) < 16, '阵形展开不能瞬移'));
        }
        const escorts = defense.members.slice(1);
        assert.equal(new Set(escorts.map(m => m.facing)).size, 4, '四面哨兵各自朝外，不全员同向');
        for (const m of escorts) {
            const post = m.guardPost;
            assert.ok(Math.abs(post.x) < .5 && Math.abs(post.y) < .5, '警戒哨位不能跨入邻格');
            assert.ok(Math.max(Math.abs(post.x), Math.abs(post.y)) >= .42, '哨兵应贴近四条边防守，不能仍挤在主将周围');
            assert.ok(Vec2.distance(m.foot, project({ x: 10 + post.x, y: 10 + post.y })) < .001);
            const d = project({ x: post.dx, y: post.dy }), a = m.facing * Math.PI / 4;
            assert.ok(d.x * Math.cos(a) + d.y * Math.sin(a) > 0, '武器朝向防区外侧');
        }
        assert.ok(defense.members.every(m => !m.moving && m.guardPose && m.sprite.spriteFrame === m.animations.guardFrames[m.facing]));
        assert.equal(defense.dustVisible, false, '驻守不持续扬尘');
        const feet = defense.members.map(m => [m.foot.x, m.foot.y]);
        const breath = defense.members[0].sprite.node.position.y;
        for (let i = 0; i < 15; i++) update(defense, 1, 0, false);
        assert.deepEqual(defense.members.map(m => [m.foot.x, m.foot.y]), feet, '待机动作不能造成脚底漂移');
        assert.ok(escorts.every(m => m.sprite.node.position.y === 0 && m.sprite.node.scale.y === 1),
            '跪姿保持真实比例，膝脚不能上下漂浮或靠压缩站姿实现');
        assert.notEqual(defense.members[0].sprite.node.position.y, breath, '驻守保留细微呼吸');
        defense.setGuarding(false);
        for (let i = 0; i < 100; i++) update(defense, 1, 0, false);
        assert.ok(defense.members.every(m => !m.guardPose && !m.moving), '结束占领后收拢并恢复站姿');
        for (const m of escorts) assert.ok(Vec2.distance(m.foot, project({ x: 10 - m.lag, y: 10 + m.side })) < .001);
        defense.setGuarding(true);
        for (let i = 0; i < 30; i++) update(defense, 1, 0, true);
        assert.equal(defense.guardWeight, 0, '行军期间不能展开守备阵形');
        assert.ok(defense.members.every(m => m.moving && !m.guardPose));
        defense.destroy();
    }
    console.log('PASS 四/六护卫居中防御、四面朝外、格内哨位、平滑展开、原地待机和撤离收队');
    const siege = create(); await tick();
    siege.setSiegeTarget(new Vec2(12,10)); await tick();
    for(let i=0;i<160;i++) update(siege);
    const rows=await load('map/entries/SiegeAnimationLibrary').loadSiegeUnit();
    assert.equal(rows.length,8);assert.ok(rows.every(row=>row.length===8));
    assert.equal(new Set(rows.flat().map(f=>f.image.name)).size,64);
    for(const row of rows) for(const frame of row) {
        assert.ok(frame.image.rect.x>=0&&frame.image.rect.x+frame.image.rect.width<=1280);
        assert.ok(frame.image.rect.y>=0&&frame.image.rect.y+frame.image.rect.height<=1280);
    }
    assert.equal(loads.filter(x=>x.includes('siege-')).length,2,'share the infantry and commander atlases across troops');
    siege.setSiegeTarget(null); update(siege,1,0,true);
    assert.ok(siege.members.every(m=>!m.siegePose&&m.sprite.node.getComponent(UITransform).anchorY===18/256));
    siege.destroy();
    const delayed=create();delayed.setSiegeTarget(new Vec2(12,10));delayed.destroy();await tick();
    console.log('PASS infantry and commander slices, shared load, return to marching, delayed-load disposal');
    const zero = create({ ...troop, getSoldier: () => ({ count: 0 }) }); assert.equal(zero.members.length, 1);
    const unknown = create(null); assert.equal(unknown.members.length, 5);
    const disposed = create(), bodies = disposed.members.map(m => m.sprite.node); disposed.destroy(); await tick();
    assert.ok(bodies.every(n => n.destroyed && !n.active), '回收后的异步图集回调不激活失效节点');
    [f, arrival, jitter, zero, unknown].forEach(n => n.destroy());
    console.log('PASS 无兵力和未知部队显示、异步回收清理');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
