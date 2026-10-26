// 离线执行真实界面组件与配置映射，不启动 Preview、不发网络请求。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
const configs = Object.fromEntries(['MainTask', 'DailyTask', 'WeekTask', 'Item', 'Hero'].map(name =>
    [name, JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name + '.json'), 'utf8'))]));
const sent = [], loadedIcons = [], listeners = new Map(), pending = new Set();
class Component { isValid = true; scheduleOnce(fn) { this.scheduled = fn; } }
class UITransform { width = 1; height = 1; setContentSize(w, h) { this.width = w; this.height = h; } setAnchorPoint(x, y) { this.anchorX = x; this.anchorY = y; } }
class Node {
    static EventType = { SIZE_CHANGED: 'size' };
    constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.events = {}; this.position = { x: 0, y: 0 }; this.active = true; this.isValid = true; }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    addChild(node) { node.removeFromParent(); node.parent = this; this.children.push(node); }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    getComponentInChildren(Type) { return this.getComponent(Type) || this.children.map(n => n.getComponentInChildren(Type)).find(Boolean); }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    setPosition(x, y) { this.position = typeof x === 'object' ? x : { x, y }; }
    setScale() {} setSiblingIndex() {}
    removeFromParent() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
    destroy() { this.isValid = false; this.components.forEach(c => c.isValid = false); this.children.forEach(c => c.destroy()); }
    on(event, fn) { this.events[event] = fn; } off(event) { delete this.events[event]; }
    click() { assert.ok(this.getComponent(Button)?.interactable !== false); this.events.click?.(); }
}
class Button { static EventType = { CLICK: 'click' }; static Transition = { SCALE: 1 }; interactable = true; clickEvents = []; }
class Label { static HorizontalAlign = { LEFT: 0, CENTER: 1, RIGHT: 2 }; static VerticalAlign = { TOP: 0, CENTER: 1 }; static Overflow = { CLAMP: 0, SHRINK: 1 }; string = ''; }
class Color { static WHITE = new Color(255, 255, 255, 255); constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }
class Graphics { clear() {} rect() {} roundRect() {} fill() {} stroke() {} moveTo() {} lineTo() {} }
class Sprite { static SizeMode = { CUSTOM: 1 }; static Type = { SIMPLE: 0 }; isValid = true; }
class SpriteFrame {}
class Widget { static AlignMode = { ON_WINDOW_RESIZE: 1 }; updateAlignment() { const p = this.node.parent?.getComponent(UITransform); if (p) this.node.getComponent(UITransform).setContentSize(p.width, p.height); } }
class SafeArea { updateArea() { this.node.getComponent(Widget).updateAlignment(); } }
class ScrollView { getScrollOffset() { return { y: this.content.position.y - this.node.getComponent(UITransform).height / 2 }; } stopAutoScroll() {} }
class Mask { static Type = { GRAPHICS_RECT: 1 }; }
const cc = { Component, Node, UITransform, Button, Label, Color, Graphics, Sprite, SpriteFrame, Widget, SafeArea, ScrollView, Mask, UIOpacity: class { opacity = 255; },
    BlockInputEvents: class {}, Layout: class {}, view: { getVisibleSize: () => ({ width: 1280, height: 720 }) },
    resources: { load(name, Type, cb) {
        loadedIcons.push(name); assert.ok(fs.existsSync(path.join(root, 'assets/resources', name.replace('/spriteFrame', '') + '.png')), name);
        cb(null, new SpriteFrame());
    } }, _decorator: { ccclass: () => x => x, property: () => () => {} } };
const tasks = [{ taskId: 1001, taskType: 1, progress: 1, state: 1 }, { taskId: 2001, taskType: 2, progress: 0, state: 0 }];
const uid = '9007199254740993';
const mail = { mailUid: uid, isRead: false, isLock: false, isGotReward: false, startTime: 100, title: '石料补给' };
let detail;
function command() { return { sessionReady: true, requestInFlight: key => pending.has(key) }; }
const progression = { ...command(), tasksLoaded: true,
    tasks: { get: id => tasks.find(t => t.taskId === id), values: () => tasks },
    getTasks: type => tasks.filter(t => !type || t.taskType === type),
    requestTasks() { sent.push(['task-list']); return true; },
    claimTask(id) { sent.push(['task-claim', id]); pending.add(`task:${id}`); return true; },
};
const mailCmd = { ...command(), getList: kind => kind === 1 ? [mail] : [], getMail: (kind, id) => String(id) === uid ? mail : null,
    listLoaded: () => true, getDetail: () => detail, presentation: () => ({ title: '石料补给', content: '修筑关城。\n请查收石料。', sender: '军需官' }),
    requestList(kind) { sent.push(['mail-list', kind]); }, requestDetail(kind, id) { sent.push(['mail-detail', kind, id]); },
    claimRewards(refs) { sent.push(['mail-claim', refs]); return true; }, setLock(kind, id, lock) { sent.push(['mail-lock', kind, id, lock]); return true; },
    deleteMails(kind, ids) { sent.push(['mail-delete', kind, ids]); return true; } };
const rank = { ...command(), pages: new Map(), requestRank(type, start, count) { sent.push(['rank', type, start, count]); return true; } };
const stubs = {
    'core/ConfigManager': { default: { getInstance: () => ({ getConfig: name => configs[name] }) } },
    'progression/ProgressionCommand': { default: { getInstance: () => progression } },
    'mail/MailCommand': { default: { getInstance: () => mailCmd } }, 'rank/RankCommand': { default: { getInstance: () => rank } },
    'login/LoginCommand': { default: { getInstance: () => ({ proxy: { getItemCount: () => 1000 } }) } },
    'common/AudioManager': { AudioManager: { instance: { playClick() {} } } }, 'common/BgLogic': { default: class {} },
    'utils/DateUtil': { default: { converTimeStr: () => '10-24 12:00' } },
};
const cache = new Map();
function load(name) {
    name = name.replace(/\\/g, '/'); if (stubs[name]) return stubs[name]; if (cache.has(name)) return cache.get(name);
    const file = path.join(scripts, name + '.ts');
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, reportDiagnostics: true });
    assert.equal(compiled.diagnostics.length, 0);
    const mod = { exports: {} }; cache.set(name, mod.exports);
    new Function('require', 'module', 'exports', compiled.outputText)(id => id === 'cc' ? cc : load(path.relative(scripts, path.resolve(path.dirname(file), id))), mod, mod.exports);
    cache.set(name, mod.exports); return mod.exports;
}
const presentation = load('progression/ProgressionPresentation');
assert.equal(presentation.taskPresentation(tasks[0]).target, 1);
assert.ok(presentation.taskPresentation(tasks[0]).detail.includes('1'));
for (const itemId of [1, 100, 103, 11001, 11002, 11006]) {
    const item = configs.Item.find(row => row.Id === itemId);
    const reward = { rewardType: 1, itemId, itemCount: 99999 };
    const shown = presentation.taskRewardPresentation(reward);
    assert.equal(shown.quality, item.Quality, '任务奖励品质必须来自 Item.Quality，数量不改变品质');
    assert.equal(shown.name, item.Name);
    assert.ok(shown.icon.endsWith('/spriteFrame'));
}
assert.equal(presentation.taskRewardPresentation({ rewardType: 1, itemId: 999999, itemCount: 99999 }).quality, 0);
assert.equal(presentation.taskRewardPresentation({ rewardType: 4, itemId: 1, itemCount: 99999 }).quality, 0, '兵力不误用同 ID 的道具品质');
console.log('PASS 任务配置、目标和奖励映射');

const Panel = load('map/ui/PlayerServicesPanel').default;
const parent = new Node('Canvas'); parent.addComponent(UITransform).setContentSize(1280, 720);
const panelNode = new Node('Services'); parent.addChild(panelNode); const panel = panelNode.addComponent(Panel);
panel.show('tasks');
assert.equal(sent.at(-1)[0], 'task-list');
const taskRow = panel.content.children[0]; taskRow.getChildByName('Action').click();
assert.deepEqual(sent.at(-1), ['task-claim', 1001]); assert.equal(tasks[0].state, 1, '点击领奖不能先改为已领取');
assert.equal(panel.content.children[0].getChildByName('Action').getComponent(Button).interactable, false);
pending.clear(); panel.render();
assert.equal(panel.content.children[0].getChildByName('Action').getComponent(Button).interactable, true, '超时解锁后可以重试');
panel.filters.children[1].click(); assert.equal(panel.taskType, 2);
assert.equal(panel.content.children[0].getChildByName('Action').getComponent(Button).interactable, false);
console.log('PASS 真实界面任务筛选、领奖等待与超时恢复');

panel.show('mail'); panel.content.children[0].getChildByName('Action').click();
assert.deepEqual(sent.at(-1), ['mail-detail', 1, uid]);
detail = { rewardList: [{ rewardType: 1, itemId: 4, itemCount: 200 }] }; panel.render();
assert.equal(panel.footer.getChildByName('Delete').getComponent(Button).interactable, false, '未领附件不可删除');
panel.content.children[1].getChildByName('Action').click(); assert.deepEqual(sent.at(-1), ['mail-claim', [{ mailKind: 1, mailUid: uid }]]);
panel.filters.getChildByName('Lock').click(); assert.deepEqual(sent.at(-1), ['mail-lock', 1, uid, true]);
mail.isLock = true; mail.isGotReward = true; panel.render();
assert.equal(panel.footer.getChildByName('Delete').getComponent(Button).interactable, false);
mail.isLock = false; panel.render(); const beforeDelete = sent.length;
panel.footer.getChildByName('Delete').click(); assert.equal(sent.length, beforeDelete, '删除前需二次确认');
panel.footer.getChildByName('Delete').click(); assert.deepEqual(sent.at(-1), ['mail-delete', 1, [uid]]);
console.log('PASS 邮件详情、领奖、锁定、删除确认均保留 int64 实例 ID');

rank.pages.set('1:1:20', { selfRank: { rank: 0, score: uid }, rankList: Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, name: '主公', score: uid })) });
panel.show('rank'); assert.deepEqual(sent.at(-1), ['rank', 1, 1, 20]);
assert.ok(panel.content.children[0].getChildByName('Score').getComponent(Label).string.includes(uid));
panel.footer.getChildByName('Next').click(); assert.deepEqual(sent.at(-1), ['rank', 1, 21, 20]);
panel.filters.children[1].click(); assert.deepEqual(sent.at(-1), ['rank', 2, 1, 20]);
console.log('PASS 排行榜类型切换、分页和超大分值显示');

for (const [w, h] of [[1280, 720], [375, 812], [812, 375]]) {
    parent.getComponent(UITransform).setContentSize(w, h); panel.node.getComponent(Widget).updateAlignment(); panel.safe.getComponent(SafeArea).updateArea();
    for (const section of ['tasks', 'mail', 'rank']) {
        panel.show(section);
        assert.ok(panel.width <= w && panel.height <= h);
        const maskNode = panel.viewport;
        assert.ok(maskNode.getComponent(Mask)); assert.equal(maskNode.getComponent(Graphics), null);
        for (const row of panel.content.children) for (const button of row.children.filter(n => n.getComponent(Button))) {
            const box = button.getComponent(UITransform), rowBox = row.getComponent(UITransform);
            assert.ok(box.width >= 44 && box.height >= 44);
            assert.ok(Math.abs(button.position.x) + box.width / 2 <= rowBox.width / 2);
            assert.ok(Math.abs(button.position.y) + box.height / 2 <= rowBox.height / 2);
        }
    }
}
console.log('PASS 横竖屏安全边界、滚动裁切独立节点与按钮最小尺寸');

const menu = new Node('MorePanel'); menu.addComponent(UITransform);
load('map/ui/ServiceMenuEntries').addServiceEntries(menu, key => sent.push(['open', key]));
load('map/ui/HudMenuSkin').styleMoreMenu(menu, 284);
for (const [button, key] of [['MailButton', 'mail'], ['RankButton', 'rank']]) {
    menu.getChildByName(button).click(); assert.deepEqual(sent.at(-1), ['open', key]);
    assert.ok(menu.getChildByName(button).getComponent(UITransform).width >= 44);
}
assert.equal(menu.getChildByName('ActivityButton'), undefined, '活动暂不开放入口');
assert.equal(menu.getChildByName('TaskButton'), undefined, '任务入口移到地图左侧');
assert.ok(loadedIcons.includes('ui/item_icons/items/item_4/spriteFrame'));
const icon = fs.readFileSync(path.join(root, 'assets/resources/ui/item_icons/items/item_4.png'));
assert.equal(icon.readUInt32BE(16), 256); assert.equal(icon.readUInt32BE(20), 256);
console.log('PASS 邮件/排行入口可达，石料图标路径与尺寸正确');

const { EventMgr } = load('utils/EventMgr');
const E = load('common/LogicEvent').LogicEvent, S = load('config/ServerConfig').ServerConfig;
const Tracker = load('map/ui/MapTaskTracker').default;
const trackerNode = new Node('TaskTracker'); parent.addChild(trackerNode);
const tracker = trackerNode.addComponent(Tracker);
pending.clear();
tracker.initialize(() => sent.push(['open', 'tasks'])); tracker.layout(1280, 720);
const body = trackerNode.getChildByName('TaskAction');
const flush = () => { const callback = tracker.scheduled; tracker.scheduled = null; callback?.(); };
assert.equal(tracker.current.taskId, 1001);
assert.equal(body.getChildByName('ActionText').active, false);
assert.equal(body.getChildByName('RewardHint'), undefined, '移除通用小金匣');
const rewardRow = body.getChildByName('TaskRewards');
assert.equal(rewardRow.active, true);
assert.equal(rewardRow.children.filter(node => node.active).length, 2);
assert.deepEqual(rewardRow.children.slice(0, 2).map(node => node.getChildByName('Count').getComponent(Label).string), ['×500', '×500']);
assert.ok(rewardRow.children.slice(0, 2).every(node => node.getChildByName('Icon').getComponent(Sprite).enabled));
const firstFrame = rewardRow.children[0].getChildByName('Icon').getComponent(Sprite).spriteFrame, loadsBeforeClaim = loadedIcons.length;
assert.equal(tracker.claimPulse, true);
const claimsBefore = sent.filter(p => p[0] === 'task-claim').length;
body.click(); tracker.activate();
assert.equal(sent.filter(p => p[0] === 'task-claim').length, claimsBefore + 1, '快速重复点击只领一次');
assert.equal(body.getComponent(Button).interactable, false);
assert.equal(tracker.current.taskId, 1001, '发送后不提前切换');
assert.equal(body.getChildByName('ActionText').active, false);
assert.equal(tracker.claimPulse, false, '请求中停止可领取呼吸光');
assert.equal(rewardRow.children[0].getChildByName('Icon').getComponent(Sprite).spriteFrame, firstFrame);
assert.equal(loadedIcons.length, loadsBeforeClaim, '领奖等待时复用当前奖励，不重新加载或替换图标');
trackerNode.getChildByName('AllTasks').click();
assert.deepEqual(sent.at(-1), ['open', 'tasks']);
assert.equal(sent.filter(p => p[0] === 'task-claim').length, claimsBefore + 1, '全部按钮不会冒泡触发领奖');
pending.delete('task:1001'); EventMgr.emit(E.protocolRequestChanged); flush();
assert.equal(body.getComponent(Button).interactable, true, '请求超时后原任务可重试');
body.click();
tasks.push({ taskId: 1002, taskType: 1, progress: 2, state: 1 });
EventMgr.emit(E.updateTasks); flush();
assert.equal(tracker.current.taskId, 1001, '后续推送先到也等待当前任务确认');
tasks[0].state = 2; pending.delete('task:1001');
EventMgr.emit(E.updateTasks); flush();
assert.equal(tracker.current.taskId, 1002);
assert.equal(body.getChildByName('TaskTitle').getComponent(Label).string, '营建根基');
assert.equal(sent.filter(p => p[0] === 'task-claim').length, claimsBefore + 2, '切换后不自动领取下一项');
console.log('PASS 左侧单任务直领、等待确认、防连点、超时重试与全部入口');

tasks.find(t => t.taskId === 1002).state = 2;
EventMgr.emit(E.updateTasks);
tasks.splice(tasks.findIndex(t => t.taskId === 1002), 1); // 同帧全量省略已领取项。
flush();
assert.equal(tracker.expectedNextId, 1003); assert.equal(tracker.current, null, '后续尚未下发时不伪造任务');
progression.requestTasks = () => { sent.push(['task-list']); pending.add(S.c2s_req_task_list); return true; };
body.click(); const refreshCount = sent.length; tracker.activate();
assert.equal(sent.length, refreshCount, '等待中的手动刷新不重复发包');
assert.equal(body.getChildByName('ActionText').getComponent(Label).string, '同步中…');
tasks.push({ taskId: 1003, taskType: 1, progress: 1, state: 0 });
pending.delete(S.c2s_req_task_list); EventMgr.emit(E.updateTasks); flush();
assert.equal(tracker.current.taskId, 1003);
assert.ok(body.getChildByName('TaskDetail').getComponent(Label).string.endsWith('1/2'));
assert.equal(rewardRow.active, true, '进行中仍直接展示真实奖励');
assert.equal(trackerNode.getChildByName('RewardGlow').active, false);
assert.equal(body.getComponent(Button).interactable, false, '未完成任务不发领奖请求');
console.log('PASS 下一项未同步时等待/手动刷新，收到新任务后更新进度');

const taskConfig = configs.MainTask.find(row => row.Id === 1003), originalRewards = taskConfig.Reward;
taskConfig.Reward = [100, 103, 11001, 11006].map(itemId => ({ reward_type: 1, item_id: itemId, item_count: 5 }));
const originalLoad = cc.resources.load, delayed = [];
cc.resources.load = (name, Type, callback) => delayed.push(callback);
tracker.render();
const palette = load('common/RewardQuality');
taskConfig.Reward.forEach((reward, i) => {
    const quality = configs.Item.find(row => row.Id === reward.item_id).Quality;
    const color = rewardRow.children[i].getChildByName('Count').getComponent(Label).color;
    assert.deepEqual([color.r, color.g, color.b], palette.rewardQualityStyle(quality).accent);
});
assert.equal(trackerNode.getComponent(UITransform).height, 160, '四项奖励在右侧分两排');
assert.equal(rewardRow.children[0].position.y, rewardRow.children[1].position.y);
assert.ok(rewardRow.children[2].position.y < rewardRow.children[0].position.y);
for (const slot of rewardRow.children) {
    const rowBox = rewardRow.getComponent(UITransform), slotBox = slot.getComponent(UITransform);
    assert.ok(Math.abs(slot.position.y) + slotBox.height / 2 <= rowBox.height / 2);
}
taskConfig.Reward = originalRewards; tracker.render();
const currentFrame = rewardRow.children[0].getChildByName('Icon').getComponent(Sprite).spriteFrame;
delayed.forEach(callback => callback(null, new SpriteFrame()));
assert.equal(rewardRow.children[0].getChildByName('Icon').getComponent(Sprite).spriteFrame, currentFrame, '旧任务的迟到图片不能覆盖当前奖励');
cc.resources.load = originalLoad;
console.log('PASS 任务奖励品质配色、图标复用及异步切换保护');

for (const [w, h] of [[1280, 720], [375, 812], [812, 375], [2560, 1080]]) {
    tracker.layout(w, h);
    const box = trackerNode.getComponent(UITransform), all = trackerNode.getChildByName('AllTasks');
    const allBox = all.getComponent(UITransform), bodyBox = body.getComponent(UITransform);
    assert.equal(trackerNode.position.x - box.width / 2, -w / 2 + (w < 720 ? 12 : 20));
    assert.ok(trackerNode.position.y + box.height / 2 <= h / 2 - 88);
    assert.ok(trackerNode.position.y - box.height / 2 >= -h / 2);
    assert.ok(allBox.width >= 44 && allBox.height >= 44);
    assert.ok(all.position.y - allBox.height / 2 >= body.position.y + bodyBox.height / 2);
    const title = body.getChildByName('TaskTitle'), titleBox = title.getComponent(UITransform);
    assert.ok(title.position.x + titleBox.width / 2 < rewardRow.position.x - rewardRow.getComponent(UITransform).width / 2, '任务文字和右侧奖励不重叠');
    for (const node of rewardRow.children.filter(node => node.active)) {
        const itemBox = node.getComponent(UITransform), rowBox = rewardRow.getComponent(UITransform);
        assert.ok(Math.abs(node.position.x) + itemBox.width / 2 <= rowBox.width / 2);
        assert.ok(body.position.y + rewardRow.position.y - itemBox.height / 2 >= -box.height / 2);
    }
    assert.ok(trackerNode.getComponent(cc.BlockInputEvents));
}
console.log('PASS 左侧任务卡横竖屏边界、独立点击区与地图输入阻挡');

progression.sessionReady = false; EventMgr.emit(E.protocolRequestChanged); flush();
assert.equal(tracker.current, null); assert.equal(tracker.expectedNextId, 0);
assert.equal(body.getComponent(Button).interactable, false);
assert.equal(body.getChildByName('ActionText').getComponent(Label).string, '等待连接');
progression.sessionReady = true; EventMgr.emit(E.protocolRequestChanged); flush();
assert.equal(tracker.current.taskId, 1003, '会话恢复后任务卡重新显示服务端任务');
assert.ok(body.getChildByName('TaskDetail').getComponent(Label).string.endsWith('1/2'));
assert.notEqual(body.getChildByName('ActionText').getComponent(Label).string, '等待连接');
tracker.onDestroy(); assert.equal(EventMgr.targetInName.has(tracker), false);
assert.equal(presentation.trackedTask([{ taskId: 1001, taskType: 1, state: 0 }, { taskId: 1002, taskType: 1, state: 1 }]).taskId, 1001);
assert.equal(presentation.trackedTask([{ taskId: 1001, taskType: 1, state: 2 }, { taskId: 2001, taskType: 2, state: 0 }]).taskId, 2001);
assert.equal(presentation.trackedTask([{ taskId: 1001, taskType: 1, state: 2 }]), undefined);
console.log('PASS 主线顺序、日常后备、断线重置与销毁解绑');
