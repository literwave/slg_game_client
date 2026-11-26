// 离线执行真实选区和开场逻辑，不创建账号、不向服务端提交请求。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
class Point { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } set(x, y, z = 0) { Object.assign(this, { x, y, z }); } }
const cc = { _decorator: { ccclass: () => x => x, property: () => () => {} }, Component: class {}, Vec2: Point, Vec3: Point,
    Node: { EventType: { SIZE_CHANGED: 'size' } } };
function load(file, dependencies = {}) {
    const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        fileName: file, reportDiagnostics: true, compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        },
    });
    assert.equal(result.diagnostics.length, 0, file);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputText)(name => name === 'cc' ? cc : dependencies[name] || {}, module, module.exports);
    return module.exports;
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }

test('真实州界命中六个出生州，边界外不能选中', () => {
    const { containsBirthPoint } = load('assets/scripts/login/CreateLogic.ts');
    const map = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/campaign-map.json'), 'utf8'));
    for (const region of map.regions.filter(r => r.tier === 0)) {
        const hits = map.landShapes.filter(s => containsBirthPoint(s.points, region.x, region.y));
        assert.equal(hits.length, 1, region.name + ' 只能命中一个州');
        assert.equal(hits[0].region, region.id);
    }
    assert.ok(map.landShapes.every(s => !containsBirthPoint(s.points, -100, -100)));
});

test('人物和对白横竖屏分区不相压，正文保留可读字号与多行空间', () => {
    const { landingDialogueLayout } = load('assets/scripts/login/FirstLanding.ts');
    for (const [w, h] of [[1280,720], [1920,1080], [1024,768], [568,320], [320,568], [390,844]]) {
        const m = landingDialogueLayout(w, h);
        assert.ok(m.width <= w - 32 && m.height + m.bottom < h);
        assert.ok(-m.width / 2 + m.portraitWidth < m.textLeft, '人物不能挡住正文');
        const available = m.textWidth - m.padding * 2;
        assert.ok(available >= 160 && m.fontSize >= 20);
        const lines = Math.ceil(Array.from('主公，到了。先让百姓在城中安顿下来。').length / Math.floor(available / m.fontSize));
        assert.ok(lines * m.lineHeight <= m.panelHeight - 100, `${w}x${h} 开场对白无需缩字`);
    }
});

function introFixture() {
    let tasks = [], completed = 0;
    const FirstLanding = load('assets/scripts/login/FirstLanding.ts', {
        '../progression/ProgressionCommand': { default: { getInstance: () => ({ tasks: { values: () => tasks } }) } },
        '../progression/ProgressionPresentation': { trackedTask: list => list[0], taskPresentation: task => ({ name: task.name }) },
    }).default;
    const ui = new FirstLanding(), frames = [];
    ui.map = { showLandingFrame: (city, progress) => frames.push({ city, progress }) };
    ui.city = new Point(840, 688); ui.finished = () => completed++;
    ui.card = { active: false }; ui.body = { string: '' }; ui.layout = () => {};
    ui.node = { active: true, destroy() { this.destroyed = true; }, parent: { off() {} } };
    return { ui, frames, setTasks: value => tasks = value, get completed() { return completed; } };
}

test('画像异步加载成功才显示，跳过剧情后的回调不再修改节点', () => {
    const callbacks = [];
    cc.SpriteFrame = class {};
    cc.isValid = value => !!value && value.isValid !== false;
    cc.resources = { load: (path, type, done) => {
        assert.equal(path, 'ui/onboarding/guide-advisor/spriteFrame');
        assert.equal(type, cc.SpriteFrame); callbacks.push(done);
    } };
    const FirstLanding = load('assets/scripts/login/FirstLanding.ts', {
        '../general/GeneralPortrait': { getGeneralPortraitPath: () => 'ui/hero/card_1027_strategist_v4/spriteFrame' },
    }).default;
    const ui = new FirstLanding(), fallback = { active: true };
    ui.finished = () => {};
    ui.portrait = { node: { active: false } };
    ui.portraitFrame = { getChildByName: () => fallback };
    ui.loadPortrait();
    const frame = new cc.SpriteFrame(); callbacks.shift()(null, frame);
    assert.equal(ui.portrait.spriteFrame, frame); assert.equal(ui.portrait.node.active, true);
    assert.equal(fallback.active, false);
    ui.loadPortrait(); ui.finished = null;
    callbacks.shift()(null, new cc.SpriteFrame());
    assert.equal(ui.portrait.spriteFrame, frame, '结束后不再替换图片');
});

test('落稳后才出剧情，任务迟到能更新，完成只回调一次', () => {
    const f = introFixture();
    for (let i = 0; i < 24; i++) f.ui.update(.1);
    assert.equal(f.ui.card.active, false);
    f.ui.update(.1); f.ui.update(.1);
    assert.equal(f.ui.card.active, true); assert.equal(f.ui.stage, 0);
    assert.equal(f.frames.at(-1).progress, 1);
    f.ui.advance(); assert.equal(f.ui.stage, 0, '第一次轻触补全当前对白，不丢掉内容');
    assert.match(f.ui.body.string, /安顿|安居|安抚|安民/);
    f.ui.advance(); assert.equal(f.ui.stage, 1);
    f.setTasks([{ name: '修缮民居' }]); f.ui.update(.016);
    f.ui.advance();
    assert.match(f.ui.body.string, /修缮民居/);
    f.ui.advance(); f.ui.finish();
    assert.equal(f.completed, 1); assert.equal(f.ui.node.active, false);
});

test('镜头途中跳过立即落城；退出场景不会调用已失效的完成回调', () => {
    const f = introFixture(); f.ui.update(.1); f.ui.finish();
    assert.equal(f.frames.at(-1).progress, 1);
    assert.deepEqual(f.frames.at(-1).city, new Point(840, 688));
    assert.equal(f.completed, 1);
    const abandoned = introFixture(); abandoned.ui.onDestroy(); abandoned.ui.update(.1);
    assert.equal(abandoned.completed, 0); assert.equal(abandoned.frames.length, 0);
});

test('跳过和退出均恢复 HUD 的原有透明度', () => {
    for (const action of ['finish', 'onDestroy']) {
        const f = introFixture(), a = { isValid: true, opacity: 0 }, b = { isValid: true, opacity: 0 };
        f.ui.hiddenHud = [{ opacity: a, value: 255 }, { opacity: b, value: 83 }];
        f.ui[action]();
        assert.equal(a.opacity, 255); assert.equal(b.opacity, 83);
        assert.equal(f.ui.hiddenHud.length, 0);
    }
});

test('镜头使用服务器坐标，平滑推进到正常主城档并刷新最终视野', () => {
    const MapLogic = load('assets/scripts/map/MapLogic.ts', { './MapProjection': { DEFAULT_MAP_HEIGHT: 300 } }).default;
    const map = new MapLogic(); let synced = 0;
    map._mapCamera = { orthoHeight: 300, node: { position: new Point(0, 0, 100), setPosition() {} } };
    map._tiledMap = {}; map.zoomHeights = () => [192, 300];
    map.toCameraPoint = p => new Point(p.x * 10, p.y * 5);
    map.updateCulling = () => {}; map.syncCenterMapCellPoint = () => synced++;
    let lastHeight = Infinity;
    for (const progress of [0, .25, .5, .75, 1]) {
        map.showLandingFrame(new Point(840, 688), progress);
        assert.ok(map._mapCamera.orthoHeight <= lastHeight); lastHeight = map._mapCamera.orthoHeight;
        assert.equal(map._pendingCameraX, 8400); assert.equal(map._pendingCameraY, 3440);
    }
    assert.equal(lastHeight, 300); assert.equal(map._moveDirty, false); assert.ok(synced > 0);
    const height = t => { map.showLandingFrame(new Point(840, 688), t); return map._mapCamera.orthoHeight; };
    assert.ok(height(0) / height(1) >= 3, '远近景比例提供明显推进感');
    const startSpeed = Math.abs(Math.log(height(.01) / height(0)));
    const middleSpeed = Math.abs(Math.log(height(.51) / height(.5)));
    const endSpeed = Math.abs(Math.log(height(1) / height(.99)));
    assert.ok(startSpeed < middleSpeed / 100 && endSpeed < middleSpeed / 100, '起步和落稳没有速度跳变');
});

test('新角色在加载遮罩下准备远景，老角色和重复预热不改变镜头', () => {
    const login = { pendingFirstLanding: false };
    const MapScene = load('assets/scripts/scene/MapScene.ts', {
        '../login/LoginCommand': { default: { getInstance: () => login } },
    }).default;
    const scene = new MapScene(), frames = [];
    scene._cmd = { cityProxy: { getMyMainCity: () => ({ x: 840, y: 688 }) } };
    scene.node = { getComponent: () => ({ showLandingFrame: (city, progress) => frames.push({ city, progress }) }) };
    assert.equal(scene.prepareLandingOverview(), false);
    login.pendingFirstLanding = true;
    assert.equal(scene.prepareLandingOverview(), true);
    assert.equal(scene.prepareLandingOverview(), false);
    assert.equal(frames.length, 1); assert.equal(frames[0].progress, 0);
    assert.deepEqual(frames[0].city, new Point(840, 688));
});
console.log('通过 ' + passed + ' 项开局回归');
