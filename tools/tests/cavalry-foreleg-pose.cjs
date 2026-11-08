// 验证真实支撑交替、脚底固定、固定骨长与动作循环，不依赖 Creator 或网络。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const source = fs.readFileSync(path.resolve(__dirname,
    '../../assets/scripts/map/entries/CavalryForelegPose.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
} }).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', code)(loaded, loaded.exports);
const { solveCavalryForelegPose: solve, CAVALRY_FORELEG_STANCE: stance } = loaded.exports;
const rig = { shoulder: { x: 0, y: 0 }, restHoof: { x: 1, y: 32 },
    upperLength: 20, lowerLength: 20, strideVector: { x: 12, y: 5 }, lift: 5 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function close(actual, expected, message, epsilon = 1e-7) {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} vs ${expected}`);
}
function samePoint(actual, expected, message, epsilon = 1e-7) {
    close(actual.x, expected.x, `${message} x`, epsilon);
    close(actual.y, expected.y, `${message} y`, epsilon);
}

assert.ok(stance >= .6 && stance <= .65, '步行支撑占比');
let nearOnly = 0, farOnly = 0;
const inputBefore = JSON.stringify(rig);
for (let i = 0; i < 1000; i++) {
    const phase = i / 1000, near = solve(phase, rig), far = solve(phase + .5, rig);
    assert.ok(near.grounded || far.grounded, '两条前腿不能同时腾空');
    if (near.grounded && !far.grounded) nearOnly++;
    if (!near.grounded && far.grounded) farOnly++;
    for (const pose of [near, far]) {
        close(distance(pose.shoulder, pose.knee), rig.upperLength, '上段骨长');
        close(distance(pose.knee, pose.hoof), rig.lowerLength, '下段骨长');
        const cross = (pose.hoof.x - pose.shoulder.x) * (pose.knee.y - pose.shoulder.y)
            - (pose.hoof.y - pose.shoulder.y) * (pose.knee.x - pose.shoulder.x);
        assert.ok(cross < 0, '膝盖始终使用同一弯曲方向');
        assert.equal(pose.hoofAngle, 0, '马蹄不继承下腿旋转');
    }
    const nextCycle = solve(phase + 1, rig);
    samePoint(near.hoof, nextCycle.hoof, '整周期脚底一致');
    samePoint(near.knee, nextCycle.knee, '整周期膝盖一致');
    const stopped = solve(phase, rig, false);
    samePoint(stopped.hoof, rig.restHoof, '站立回置');
    assert.equal(stopped.grounded, true);
}
assert.ok(nearOnly > 300 && farOnly > 300, '近远前腿都必须有独立摆动阶段');
assert.equal(JSON.stringify(rig), inputBefore, '采样不能修改骨架配置');

const planted = solve(0, rig).hoof;
for (let i = 0; i < 100; i++) {
    const phase = stance * i / 100, pose = solve(phase, rig);
    samePoint({ x: pose.hoof.x + rig.strideVector.x * phase / stance,
        y: pose.hoof.y + rig.strideVector.y * phase / stance }, planted,
    '支撑阶段补偿身体移动后脚底世界位置固定');
}
const peak = solve(stance + (1 - stance) / 2, rig);
samePoint(peak.hoof, { x: rig.restHoof.x, y: rig.restHoof.y - rig.lift }, '低抬蹄峰值');
for (const boundary of [stance, 1]) {
    const h = 1e-5, before = solve(boundary - h, rig), at = solve(boundary, rig), after = solve(boundary + h, rig);
    assert.ok(distance(before.hoof, after.hoof) < .001, '离地和落地接缝无位置跳变');
    assert.ok(distance(before.knee, after.knee) < .001, '接缝膝盖连续');
    for (const axis of ['x', 'y']) close((at.hoof[axis] - before.hoof[axis]) / h,
        (after.hoof[axis] - at.hoof[axis]) / h, '接缝脚底速度连续', .03);
}
const mirrorRig = { ...rig, shoulder: { x: 0, y: 0 }, restHoof: { x: -1, y: 32 },
    strideVector: { x: -12, y: 5 }, bendSign: 1 };
for (const phase of [0, .2, .5, .72, .9]) {
    const right = solve(phase, rig), left = solve(phase, mirrorRig);
    samePoint(left.knee, { x: -right.knee.x, y: right.knee.y }, '镜像膝盖');
    samePoint(left.hoof, { x: -right.hoof.x, y: right.hoof.y }, '镜像脚底');
}
for (const target of [{ x: 1000, y: 1000 }, { x: 0, y: 0 }]) {
    const constrained = { ...rig, restHoof: target, upperLength: 25, lowerLength: 15 };
    const pose = solve(.3, constrained, false);
    close(distance(pose.shoulder, pose.knee), 25, '不可达目标仍保持上骨长');
    close(distance(pose.knee, pose.hoof), 15, '不可达目标仍保持下骨长');
    assert.ok(distance(pose.shoulder, pose.hoof) < 40, '禁止拉长腿部追逐不可达脚点');
    assert.ok(distance(pose.shoulder, pose.hoof) >= 10, '禁止折叠到骨长差以内');
}
assert.throws(() => solve(0, { ...rig, lowerLength: 0 }), RangeError);
assert.throws(() => solve(Number.NaN, rig), RangeError);
console.log('PASS 前腿支撑交替、落脚不滑、固定骨长、弯曲方向、平底蹄、站立回置与周期连续');

// 加载实际渲染器而非复制一份骨架参数，防止素材接入后又出现不可达或前腿交叉。
async function verifyRendererRig() {
    class PartNode {
        constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.layer = 1; }
        addChild(child) { this.children.push(child); child.parent = this; }
        addComponent(Type) { const value = new Type(); this.components.set(Type, value); return value; }
        getComponent(Type) { return this.components.get(Type); }
        setScale(x, y, z) { this.scale = { x, y, z }; }
        setPosition(x, y, z) { this.position = { x, y, z }; }
    }
    class PartTransform {
        setContentSize(width, height) { Object.assign(this, { width, height }); }
        setAnchorPoint(x, y) { this.anchor = { x, y }; }
    }
    class PartSprite { static SizeMode = { CUSTOM: 0 }; }
    class PartFrame { addRef() {} reset(value) { Object.assign(this, value); } }
    const image = fs.readFileSync(path.resolve(__dirname,
        '../../assets/resources/ui/march/commander_foreleg_rig_v7.png'));
    const texture = { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
    const parts = [];
    const cc = { Node: PartNode, UITransform: PartTransform, Sprite: PartSprite, SpriteFrame: PartFrame,
        Rect: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } },
        Size: class { constructor(width, height) { Object.assign(this, { width, height }); } },
        Vec2: class {}, Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
        isValid: () => true, resources: { load(name, Type, done) {
            const sheet = new PartFrame(); sheet.texture = texture; done(null, sheet);
        } } };
    const originalReset = PartFrame.prototype.reset;
    PartFrame.prototype.reset = function(value) { parts.push(value); originalReset.call(this, value); };
    const rendererSource = fs.readFileSync(path.resolve(__dirname,
        '../../assets/scripts/map/entries/CavalryWalkRig.ts'), 'utf8');
    const renderer = { exports: {} };
    new Function('require', 'module', 'exports', ts.transpileModule(rendererSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText)(name => {
        if (name === 'cc') return cc;
        if (name === './CavalryForelegPose') return loaded.exports;
        throw new Error(`Unexpected renderer dependency: ${name}`);
    }, renderer, renderer.exports);
    const walk = new renderer.exports.CavalryWalkRig(new PartNode(), 128);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(walk.ready, true, '实际骨架应完成初始化');
    close(walk.root.scale.x, .5, '统一画布缩放');
    for (const { rect } of parts) {
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= texture.width
            && rect.y + rect.height <= texture.height, '分段素材切片必须位于真实纹理内');
    }
    const legs = walk.legs;
    assert.equal(legs.length, 4, '必须保留四条可独立采样的腿');
    const near = legs.find(leg => leg.upper.name === 'NearForeUpper');
    const far = legs.find(leg => leg.upper.name === 'FarForeUpper');
    assert.ok(near && far, '近远前腿身份固定');
    close(Math.abs(near.phase - far.phase), .5, '实际渲染器近远前腿相差半周期');
    function cross(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
    function intersects(a, b, c, d) {
        return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
    }
    const renderedFlex = leg => Math.acos(Math.cos((leg.upper.angle - leg.lower.angle)
        * Math.PI / 180)) * 180 / Math.PI;
    const rigsBefore = JSON.stringify(legs.map(leg => leg.rig));
    let minimumTrackGap = Infinity, minimumReachMargin = Infinity;
    for (let i = 0; i < 1000; i++) {
        const phase = i / 1000;
        walk.sample(phase);
        for (const leg of legs) {
            const pose = solve(phase + leg.phase, leg.rig);
            const reachMargin = leg.rig.upperLength + leg.rig.lowerLength
                - distance(pose.shoulder, pose.hoof);
            minimumReachMargin = Math.min(minimumReachMargin, reachMargin);
            assert.ok(reachMargin > .1, `${leg.upper.name} 的整个周期必须可达并保留弯曲余量`);
            samePoint(leg.upper.position, { x: pose.shoulder.x - 128, y: 238 - pose.shoulder.y },
                '隐藏连接点同步到实际渲染节点');
            close(distance(leg.upper.position, leg.lower.position), leg.rig.upperLength,
                '连接点浮动时实际上段骨长不变');
            close(distance(leg.lower.position, leg.hoof.position), leg.rig.lowerLength,
                '连接点浮动时实际下段骨长不变');
            samePoint(leg.hoof.position, { x: pose.hoof.x - 128, y: 238 - pose.hoof.y },
                '渲染器正确转换像素与 Creator 坐标');
            assert.equal(leg.hoof.angle, 0, '实际蹄节点保持平底');
            const angle = leg.lower.angle * Math.PI / 180;
            samePoint({ x: Math.sin(angle), y: Math.cos(angle) },
                { x: (pose.hoof.x - pose.knee.x) / leg.rig.lowerLength,
                    y: (pose.hoof.y - pose.knee.y) / leg.rig.lowerLength }, '下腿旋转与骨骼轴一致');
            if (leg === near || leg === far) {
                const flex = renderedFlex(leg);
                if (pose.grounded) close(flex, 12, '前腿承重期间保持12度近直立关节', 1e-6);
                else assert.ok(flex >= 12 - 1e-6 && flex <= 28 + 1e-6,
                    '前腿摆动保持12至28度，不再出现大折角');
            }
            if (pose.grounded) {
                const p = ((phase + leg.phase) % 1 + 1) % 1, amount = .5 - p / stance;
                samePoint(pose.hoof, { x: leg.rig.restHoof.x + leg.rig.strideVector.x * amount,
                    y: leg.rig.restHoof.y + leg.rig.strideVector.y * amount },
                '实际支撑参数不能因不可达夹取产生脚底滑动');
            }
        }
        const a = solve(phase + near.phase, near.rig), b = solve(phase + far.phase, far.rig);
        assert.ok(a.grounded || b.grounded, '实际前腿相位不能同时腾空');
        for (const first of [[a.shoulder, a.knee], [a.knee, a.hoof]]) {
            for (const second of [[b.shoulder, b.knee], [b.knee, b.hoof]]) {
                assert.ok(!intersects(...first, ...second), '近远前腿骨段不能交叉');
            }
        }
        const strideLength = Math.hypot(near.rig.strideVector.x, near.rig.strideVector.y);
        const gap = Math.abs((b.hoof.x - a.hoof.x) * -near.rig.strideVector.y
            + (b.hoof.y - a.hoof.y) * near.rig.strideVector.x) / strideLength;
        minimumTrackGap = Math.min(minimumTrackGap, gap);
        assert.ok(gap > near.hoof.getComponent(PartTransform).width, '近远前蹄轨道必须留出蹄宽');
    }
    for (const leg of [near, far]) {
        walk.sample(stance + (1 - stance) / 2 - leg.phase);
        close(renderedFlex(leg), 28, '前腿摆动峰值有实际28度屈曲', 1e-6);
    }
    for (const leg of legs) {
        for (const boundary of [stance, 1]) {
            const h = 1e-5;
            walk.sample(boundary - leg.phase - h); const before = { ...leg.upper.position };
            walk.sample(boundary - leg.phase); const at = { ...leg.upper.position };
            walk.sample(boundary - leg.phase + h); const after = { ...leg.upper.position };
            assert.ok(distance(before, after) < .002, '离地和循环接缝的隐藏连接点连续');
            for (const axis of ['x', 'y']) close((at[axis] - before[axis]) / h,
                (after[axis] - at[axis]) / h, '隐藏连接点接缝速度连续', .1);
        }
        walk.sample(-leg.phase); const first = { ...leg.upper.position };
        walk.sample(1 - leg.phase); samePoint(leg.upper.position, first, '连接点完整周期闭合');
    }
    assert.equal(JSON.stringify(legs.map(leg => leg.rig)), rigsBefore, '连接点浮动不能积累到骨架配置');
    walk.sample(.81, false);
    for (const leg of legs) samePoint(leg.hoof.position,
        { x: leg.rig.restHoof.x - 128, y: 238 - leg.rig.restHoof.y }, '渲染器站立回置');
    for (const leg of [near, far]) close(renderedFlex(leg), 12, '站立保持近直立承重姿态', 1e-6);
    console.log(`PASS 实际四腿参数、素材范围、旋转坐标、无骨段交叉；最小轨道间距 ${minimumTrackGap.toFixed(2)}px，最小伸展余量 ${minimumReachMargin.toFixed(2)}px`);
    console.log('PASS 实际前腿支撑12度、摆动不超过28度、隐藏连接点周期和速度连续、骨段长度不变');
}
verifyRendererRig().catch(error => { console.error(error); process.exitCode = 1; });
