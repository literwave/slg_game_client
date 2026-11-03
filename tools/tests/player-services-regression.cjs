// 离线执行真实界面组件与配置映射，不启动 Preview、不发网络请求。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
const configs = Object.fromEntries(['MainTask', 'DailyTask', 'WeekTask', 'Item', 'Hero'].map(name =>
    [name, JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name + '.json'), 'utf8'))]));
const sent = [], loadedIcons = [], listeners = new Map(), pending = new Set();
class Component { isValid = true; scheduleOnce(fn) { this.scheduled = fn; } unscheduleAllCallbacks() { this.scheduled = null; } }
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
class Graphics { clear() {} rect() {} roundRect() {} fill() {} stroke() {} moveTo() {} lineTo() {} circle() {} }
class Sprite { static SizeMode = { CUSTOM: 1 }; static Type = { SIMPLE: 0 }; isValid = true; }
class SpriteFrame {}
class Widget { static AlignMode = { ON_WINDOW_RESIZE: 1 }; updateAlignment() { const p = this.node.parent?.getComponent(UITransform); if (p) this.node.getComponent(UITransform).setContentSize(p.width, p.height); } }
class SafeArea { updateArea() { this.node.getComponent(Widget).updateAlignment(); } }
class ScrollView {
    scrolling = false; autoScrolling = false; stopCalls = 0;
    getScrollOffset() { return { y: this.content.position.y - this.node.getComponent(UITransform).height / 2 }; }
    isScrolling() { return this.scrolling; }
    isAutoScrolling() { return this.autoScrolling; }
    stopAutoScroll() { this.stopCalls++; this.autoScrolling = false; }
}
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
    'login/LoginCommand': { default: { getInstance: () => ({
        proxy: { getItemCount: () => 1000, getRoleData: () => ({ userId: '1', name: '我的主公', headIcon: 1 }) },
        headIcons: { getDisplayId: id => id || 1, getIcon: () => new SpriteFrame() },
    }) } },
    'common/AudioManager': { AudioManager: { instance: { playClick() {} } } }, 'common/BgLogic': { default: class {} },
    'utils/DateUtil': { default: { converTimeStr: () => '10-24 12:00' } },
};
const cache = new Map();
function load(name) {
    name = name.replace(/\\/g, '/'); if (stubs[name]) return stubs[name]; if (cache.has(name)) return cache.get(name);
    if (name.endsWith('.js')) return { default: require(path.join(scripts, name)) };
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
assert.equal(panel.footer.getChildByName('Refresh'), undefined, '任务页打开时自动同步，无需手动刷新按钮');
const taskRow = panel.content.children[0]; taskRow.getChildByName('Action').click();
assert.deepEqual(sent.at(-1), ['task-claim', 1001]); assert.equal(tasks[0].state, 1, '点击领奖不能先改为已领取');
assert.equal(panel.content.children[0].getChildByName('Action').getComponent(Button).interactable, false);
pending.clear(); panel.render();
assert.equal(panel.content.children[0].getChildByName('Action').getComponent(Button).interactable, true, '超时解锁后可以重试');
panel.filters.children[1].click(); assert.equal(panel.taskType, 2);
assert.equal(panel.content.children[0].getChildByName('Action').getComponent(Button).interactable, false);
console.log('PASS 真实界面任务筛选、领奖等待与超时恢复');

const originalTask = { ...tasks[0] };
panel.taskType = 1;
for (const [progress, state, text] of [[473050, 0, '进度 1 / 1'], [-5, 0, '进度 0 / 1'], [NaN, 0, '进度 0 / 1'], [1, 0, '进度 1 / 1']]) {
    Object.assign(tasks[0], { progress, state }); panel.render();
    const row = panel.content.children[0];
    assert.equal(row.getChildByName('ProgressText').getComponent(Label).string, text);
    assert.equal(row.getChildByName('Action').getComponent(Button).interactable, false, '展示满进度不能替代服务端可领取状态');
    assert.equal(tasks[0].progress, progress, '只裁切显示，不改写服务端进度');
    const track = row.getChildByName('Progress'), fill = track.getChildByName('Fill');
    if (fill) assert.ok(fill.getComponent(UITransform).width <= track.getComponent(UITransform).width);
}
Object.assign(tasks[0], originalTask); panel.render();
console.log('PASS 超额、负数及异常进度显示边界，领奖仍由服务端状态控制');

const taskSnapshot = tasks.map(task => ({ ...task }));
tasks.push({ taskId: 1002, taskType: 1, progress: 1, state: 0 },
    { taskId: 1003, taskType: 1, progress: 2, state: 2 }, { taskId: 1004, taskType: 1, progress: 0, state: 9 });
panel.show('tasks');
const taskNames = () => panel.content.children.map(row => row.getChildByName('Heading').getComponent(Label).string);
assert.deepEqual(taskNames(), ['营建根基', presentation.taskPresentation(tasks[0]).name], '仅列进行中与待领取，进行中排在前面');
assert.equal(panel.footer.getChildByName('Status').getComponent(Label).string, '1 项进行中 · 1 项待领取');
assert.equal(panel.content.children[0].getChildByName('Action').getComponent(Button).interactable, false);
assert.equal(panel.content.children[1].getChildByName('Action').getComponent(Button).interactable, true);
tasks[0].state = 2; panel.queueRefresh(); panel.scheduled();
assert.deepEqual(taskNames(), ['营建根基'], '收到领取确认后自动移除该行');
assert.equal(panel.footer.getChildByName('Refresh'), undefined);
assert.equal(tasks[0].state, 2, '已领取的权威快照仍保留');
tasks.find(task => task.taskId === 1002).state = 2;
panel.queueRefresh(); panel.scheduled();
assert.equal(panel.taskType, 2, '当前分类结束后自动显示还有目标的日常');
assert.deepEqual(taskNames(), [presentation.taskPresentation(tasks[1]).name]);
panel.filters.children[0].click();
assert.equal(panel.taskType, 1, '手动选择已结束分类不会被跳走');
assert.deepEqual(taskNames(), ['当前主线任务已完成']);
assert.equal(panel.content.children[0].getChildByName('Action'), undefined);
panel.render(); assert.equal(panel.taskType, 1);
panel.close(); panel.show('tasks'); assert.equal(panel.taskType, 2, '重新打开默认选择有任务的分类');
tasks[1].state = 2; panel.render();
assert.deepEqual(taskNames(), ['当前日常任务已完成']);
assert.equal(panel.footer.getChildByName('Status').getComponent(Label).string, '');
tasks.splice(0, tasks.length); progression.tasksLoaded = false; pending.add('c2s_req_task_list');
panel.show('tasks');
assert.equal(panel.content.children.length, 1, '无快照时不生成虚假任务');
tasks.push({ taskId: 3001, taskType: 3, progress: 1, state: 0 });
progression.tasksLoaded = true; pending.clear(); panel.queueRefresh(); panel.scheduled();
assert.equal(panel.taskType, 3, '首次异步收到任务后定位到可进行分类');
assert.deepEqual(taskNames(), [presentation.taskPresentation(tasks[0]).name]);
tasks.splice(0, tasks.length, ...taskSnapshot); panel.taskType = 1; panel.show('tasks');
console.log('PASS 进行中优先、已领取移出、确认后刷新、默认分类与手动分类保留');

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

rank.pages.set('1:1:20', { selfRank: { rank: 0, score: uid }, rankList: Array.from({ length: 20 }, (_, i) => ({ uid: String(i + 1), rank: i + 1, name: '主公', score: uid })) });
panel.show('rank'); assert.deepEqual(sent.at(-1), ['rank', 1, 1, 20]);
assert.ok(panel.footer.getChildByName('MyRank').getChildByName('Score').getComponent(Label).string.includes(uid));
assert.ok(panel.content.getChildByName('Rank1').getChildByName('RankBadge'));
assert.ok(panel.content.getChildByName('Rank1').getChildByName('Portrait'));
assert.ok(panel.content.children.every(row => !row.children.some(n => n.getComponent(Button))), '排行条目仅展示，不提供私聊入口');
panel.footer.getChildByName('Next').click(); assert.deepEqual(sent.at(-1), ['rank', 1, 21, 20]);
panel.filters.children[1].click(); assert.deepEqual(sent.at(-1), ['rank', 2, 1, 20]);
console.log('PASS 排行榜类型切换、分页和超大分值显示');

let beforeSync = sent.length;
panel.update(29); assert.equal(sent.length, beforeSync);
panel.update(1); assert.deepEqual(sent.at(-1), ['rank', 2, 1, 20]);
assert.equal(sent.length, beforeSync + 1, '打开的排行榜定时同步当前类型和页码');
panel.close(); panel.onDisable(); beforeSync = sent.length;
panel.update(60); panel.syncVisibleData(); assert.equal(sent.length, beforeSync, '关闭后停止轮询和连接恢复查询');
panel.show('rank'); beforeSync = sent.length;
rank.sessionReady = false; panel.update(60); assert.equal(sent.length, beforeSync, '断线期间不轮询');
rank.sessionReady = true; panel.syncVisibleData(); assert.equal(sent.length, beforeSync + 1, '连接恢复后同步可见页面');
panel.show('mail'); beforeSync = sent.length;
panel.update(60); assert.equal(sent.length, beforeSync, '邮件靠服务器推送，不额外轮询');
console.log('PASS 排行定时同步、关闭停用、重连恢复，邮件不轮询');

{
    const events = load('utils/EventMgr').EventMgr, E = load('common/LogicEvent').LogicEvent;
    panel.rankType = 1; panel.show('rank');
    const snapshot = rank.pages.get('1:1:20');
    const rows = [...panel.content.children], selfRow = panel.footer.getChildByName('MyRank');
    const sameRows = () => panel.content.children.length === rows.length && panel.content.children.every((row, i) => row === rows[i]);
    const viewHeight = panel.scroll.node.getComponent(UITransform).height;
    panel.content.setPosition(0, viewHeight / 2 - 24);
    panel.scroll.scrolling = true;
    const stops = panel.scroll.stopCalls;
    events.emit(E.protocolRequestChanged); events.emit(E.upateMyRoleRes); panel.scheduled();
    assert.ok(sameRows(), '无关协议或资源变化不能销毁排行条目与头像');
    assert.equal(panel.footer.getChildByName('MyRank'), selfRow, '固定的我的排名也不能反复重建');
    assert.equal(panel.scroll.getScrollOffset().y, -24, '拖动回弹区内的位置不能被刷新钳回零点');
    assert.equal(panel.scroll.stopCalls, stops, '相同内容不能打断滚动');
    pending.add('rank:1'); events.emit(E.protocolRequestChanged); panel.scheduled();
    assert.equal(panel.footer.getChildByName('Next').getComponent(Button).interactable, false);
    pending.delete('rank:1'); events.emit(E.protocolRequestChanged); panel.scheduled();
    assert.equal(panel.footer.getChildByName('Next').getComponent(Button).interactable, true, '查询结束或超时恢复翻页');
    assert.ok(sameRows(), '请求等待状态仅改变翻页按钮，不重画列表');
    rank.pages.set('1:1:20', { ...snapshot, rankList: snapshot.rankList.map(row => ({ ...row })) });
    events.emit(E.updateRank); panel.scheduled();
    assert.ok(sameRows(), '新对象但相同显示数据的定时回包保留现有节点');
    console.log('PASS 排行无关推送、查询状态与相同快照保持节点及拖动位置');

    panel.content.setPosition(0, viewHeight / 2 + 80);
    const changed = { ...snapshot, rankList: snapshot.rankList.map((row, i) => i === 0 ? { ...row, score: '9007199254740999' } : row) };
    rank.pages.set('1:1:20', changed); events.emit(E.updateRank); panel.scheduled();
    assert.ok(sameRows(), '真实分数变化不在手指拖动中替换列表');
    panel.scroll.scrolling = false; panel.scroll.autoScrolling = true; panel.update(.1);
    assert.ok(sameRows(), '惯性滚动中继续保留节点');
    panel.scroll.autoScrolling = false; panel.update(.1);
    assert.equal(panel.content.getChildByName('Rank1').getChildByName('Score').getComponent(Label).string, '9007199254740999');
    assert.equal(panel.scroll.getScrollOffset().y, 80, '滚动停稳后显示新分数并保留阅读位置');
    assert.equal(panel.rankRefreshDeferred, false);
    panel.scroll.scrolling = true;
    panel.filters.children[1].click();
    assert.equal(panel.rankType, 2); assert.equal(panel.rankRefreshDeferred, false, '主动切换分类立即生效');
    assert.equal(panel.scroll.getScrollOffset().y, 0);
    panel.scroll.scrolling = false;
    rank.pages.set('1:1:20', snapshot);
    console.log('PASS 排行新数据等待拖动和惯性结束，主动切换立即生效');
}

for (const [w, h] of [[1280, 720], [375, 812], [812, 375]]) {
    parent.getComponent(UITransform).setContentSize(w, h); panel.node.getComponent(Widget).updateAlignment(); panel.safe.getComponent(SafeArea).updateArea();
    for (const section of ['tasks', 'mail', 'rank']) {
        if (section === 'rank') panel.rankType = 1;
        panel.show(section);
        assert.equal(panel.panel.getChildByName('Sections'), undefined, section + '只展示当前功能，不混入其他功能导航');
        assert.equal(panel.footer.getChildByName('Refresh'), undefined, section + '不显示手动刷新按钮');
        assert.ok(panel.width <= w && panel.height <= h);
        const maskNode = panel.viewport;
        assert.ok(maskNode.getComponent(Mask)); assert.equal(maskNode.getComponent(Graphics), null);
        const scrollBox = panel.scroll.node.getComponent(UITransform);
        const listTop = panel.scroll.node.position.y + scrollBox.height / 2;
        const listBottom = panel.scroll.node.position.y - scrollBox.height / 2;
        const filtersBottom = panel.filters.position.y - panel.filters.getComponent(UITransform).height / 2;
        const footerTop = panel.footer.position.y + panel.footer.getComponent(UITransform).height / 2;
        assert.ok(scrollBox.height > 0);
        assert.ok(listTop <= filtersBottom - 12, section + '列表不得覆盖分类标签');
        assert.ok(listBottom >= footerTop + 12, section + '列表不得覆盖底部操作');
        assert.equal(maskNode.getComponent(UITransform).height, scrollBox.height, '裁切范围随布局同步');
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
const hud = new Node('HudRoot'); hud.addChild(menu);
load('map/ui/ServiceMenuEntries').addServiceEntries(menu, hud, key => sent.push(['open', key]));
load('map/ui/HudMenuSkin').styleMoreMenu(menu, 284);
load('map/ui/HudMenuSkin').styleHeaderShortcut(hud.getChildByName('RankButton'), -550, 254, '排');
for (const [parent, button, key] of [[menu, 'MailButton', 'mail'], [hud, 'RankButton', 'rank']]) {
    parent.getChildByName(button).click(); assert.deepEqual(sent.at(-1), ['open', key]);
    assert.ok(parent.getChildByName(button).getComponent(UITransform).width >= 44);
}
assert.equal(menu.getChildByName('RankButton'), undefined, '排行独立于更多菜单，始终可见');
assert.equal(menu.getChildByName('ActivityButton'), undefined, '活动不占更多菜单');
assert.equal(hud.getChildByName('ActivityButton').getComponent(Button).interactable, false, '活动暂不接入逻辑');
assert.equal(menu.getChildByName('TaskButton'), undefined, '任务入口移到地图左侧');
assert.ok(loadedIcons.includes('ui/item_icons/items/item_4/spriteFrame'));
const icon = fs.readFileSync(path.join(root, 'assets/resources/ui/item_icons/items/item_4.png'));
assert.equal(icon.readUInt32BE(16), 256); assert.equal(icon.readUInt32BE(20), 256);
console.log('PASS 邮件/排行入口可达，石料图标路径与尺寸正确');

// 管理页面与地图左侧任务卡可分别回归，避免不相关展示变更互相阻塞。
if (process.argv.includes('--panel-only')) process.exit(0);

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
assert.equal(body.getChildByName('ActionText'), undefined);
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
assert.equal(body.getChildByName('ActionText'), undefined);
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
const refreshCount = sent.length; tracker.activate(); tracker.render();
assert.equal(sent.length, refreshCount, '无任务时点击卡片不会发刷新请求');
assert.equal(body.getComponent(Button).interactable, false);
assert.equal(body.getChildByName('TaskDetail').active, false);
pending.add(S.c2s_req_task_list); EventMgr.emit(E.protocolRequestChanged); flush();
assert.equal(body.getChildByName('TaskTitle').getComponent(Label).string, '正在等待下一项任务…');
tasks.push({ taskId: 1003, taskType: 1, progress: 1, state: 0 });
pending.delete(S.c2s_req_task_list); EventMgr.emit(E.updateTasks); flush();
assert.equal(tracker.current.taskId, 1003);
assert.equal(body.getChildByName('TaskDetail').getComponent(Label).string, presentation.taskPresentation(tasks.find(t => t.taskId === 1003)).detail);
assert.equal(body.getChildByName('TaskProgress').getComponent(Label).string, '1/2');
assert.equal(rewardRow.active, true, '进行中仍直接展示真实奖励');
assert.equal(trackerNode.getChildByName('RewardGlow').active, false);
assert.equal(body.getComponent(Button).interactable, false, '未完成任务不发领奖请求');
console.log('PASS 下一项未同步时自动等待，收到新任务后更新进度，无手动刷新入口');

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
tracker.layout(240, 720);
assert.equal(trackerNode.getComponent(UITransform).height, 180, '窄屏四项奖励在右侧分两排');
assert.equal(rewardRow.children[0].position.y, rewardRow.children[1].position.y);
assert.ok(rewardRow.children[2].position.y < rewardRow.children[0].position.y);
for (const slot of rewardRow.children) {
    const rowBox = rewardRow.getComponent(UITransform), slotBox = slot.getComponent(UITransform);
    assert.ok(Math.abs(slot.position.y) + slotBox.height / 2 <= rowBox.height / 2);
}
taskConfig.Reward = originalRewards; tracker.layout(1280, 720);
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
assert.equal(body.getChildByName('TaskTitle').getComponent(Label).string, '连接恢复后自动同步任务');
progression.sessionReady = true; EventMgr.emit(E.protocolRequestChanged); flush();
assert.equal(tracker.current.taskId, 1003, '会话恢复后任务卡重新显示服务端任务');
assert.equal(body.getChildByName('TaskProgress').getComponent(Label).string, '1/2');
assert.equal(body.getChildByName('TaskDetail').active, true);
tracker.onDestroy(); assert.equal(EventMgr.targetInName.has(tracker), false);
assert.equal(presentation.trackedTask([{ taskId: 1001, taskType: 1, state: 0 }, { taskId: 1002, taskType: 1, state: 1 }]).taskId, 1001);
assert.equal(presentation.trackedTask([{ taskId: 1001, taskType: 1, state: 2 }, { taskId: 2001, taskType: 2, state: 0 }]).taskId, 2001);
assert.equal(presentation.trackedTask([{ taskId: 1001, taskType: 1, state: 2 }]), undefined);
console.log('PASS 主线顺序、日常后备、断线重置与销毁解绑');
