// 真实 protobuf 点将回包 + 展示状态回归；不连接服务器、不消耗道具。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..'), scripts = path.join(root, 'assets/scripts');
const protobuf = require(path.join(scripts, '3rd/protobuf.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const table = name => JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name + '.json'), 'utf8'));
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function harness() {
    const modules = new Map(), timers = new Map(), sent = [], results = [], generic = [], images = [];
    let serial = 0, proto;
    const storage = new Map();
    const proxy = { hasItemCount: () => true, getItemCount: () => 1000 };
    const cc = { Component: class { isValid = true; }, Color: class {}, JsonAsset: class {},
        sys: { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
        _decorator: { ccclass: () => t => t, property: () => () => {} },
        resources: { load: (path, type, cb) => images.push(cb) } };
    function load(key) {
        key = key.replace(/\\/g, '/').replace(/\.ts$/, '');
        if (key.endsWith('.js')) return { default: require(path.join(scripts, key)) };
        if (key === 'map/ui/ManagementStyle') return { ManagementColors: {} };
        if (key === 'login/LoginCommand') return { default: { getInstance: () => ({ proxy }) } };
        if (key === 'network/socket/NetManager') return { NetManager: { getInstance: () => ({ send(packet) {
            sent.push({ name: packet.name, data: proto.decode(packet.name, packet.msg) });
        } }) } };
        if (modules.has(key)) return modules.get(key).exports;
        const mod = { exports: {} }; modules.set(key, mod);
        const file = path.join(scripts, key + '.ts');
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
        } }).outputText;
        vm.runInNewContext(code, { module: mod, exports: mod.exports, protobuf, console: { log() {}, warn() {}, error() {} },
            setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
            require: name => name === 'cc' ? cc : load(path.relative(scripts, path.resolve(path.dirname(file), name))),
        }, { filename: file });
        return mod.exports;
    }
    proto = load('network/pto/ProtoManager').ProtoManager.getInstance();
    const dir = path.join(root, 'assets/resources/protbuf/pto');
    for (const file of fs.readdirSync(dir).filter(n => n.endsWith('.proto'))) {
        proto.mergeRoot(proto._root, protobuf.parse(fs.readFileSync(path.join(dir, file), 'utf8')).root);
    }
    proto.parseIdMap(JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/protbuf/net_pb.json'), 'utf8')).define); proto._isReady = true;
    const S = load('config/ServerConfig').ServerConfig, E = load('common/LogicEvent').LogicEvent, events = load('utils/EventMgr').EventMgr;
    load('core/ConfigManager').default.getInstance().loadConfigs(['Lottery', 'Hero', 'Item', 'Global'].map(name => ({ name, json: table(name) })));
    const reward = load('reward/RewardCommand').default.getInstance(); reward.setUIReady();
    const cmd = load('general/LotteryCommand').default.getInstance();
    events.on(E.lotteryResult, r => results.push(plain(r)), results); events.on(E.showReward, r => generic.push(plain(r)), generic);
    const receive = (name, data = {}) => events.emit(name, proto.decode(name, proto.encode(name, data)));
    const login = () => { receive(S.s2c_user_login_ok); receive(S.s2c_client_load_ok); receive(S.s2c_req_user_lottery_info, { lotteryTimes: 0 }); };
    return { cmd, S, E, events, results, generic, sent, timers, receive, login, proxy, load, images, proto, storage, modules };
}
const rewards = [{ rewardType: 3, itemId: 1001, itemCount: 1 }, { rewardType: 1, itemId: 11001, itemCount: 15 }, { rewardType: 1, itemId: 1, itemCount: 300 }];
test('新协议 rewardList 无损进入专属结果，不等待通用奖励推送', () => {
    const h = harness(); h.login(); assert.equal(h.cmd.draw(10), true); assert.equal(h.cmd.draw(10), false);
    assert.deepEqual(plain(h.sent.at(-1).data), { useLotteryTimes: 10 });
    h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 10, lotteryTimes: 10, rewardList: rewards });
    assert.equal(h.cmd.pending, false); assert.equal(h.cmd.lotteryTimes, 10); assert.equal(h.timers.size, 0);
    assert.deepEqual(h.results[0].rewards, rewards); assert.equal(h.results[0].count, 10); assert.equal(h.generic.length, 0);
    assert.equal(h.proxy.getItemCount(103), 1000, '展示不能自行扣减或补发道具');
});
test('点将期间其它通用奖励照常展示，不展示类型不弹窗', () => {
    const h = harness(); h.login(); h.cmd.draw(1);
    h.receive(h.S.s2c_show_reward, { rewardList: rewards, showTypeList: [1] });
    h.receive(h.S.s2c_show_reward, { rewardList: rewards, showTypeList: [0] });
    assert.equal(h.generic.length, 1); assert.equal(h.results.length, 0); assert.equal(h.cmd.pending, true);
});
test('重复回包只展示一次，下一次相同奖励正常展示', () => {
    const h = harness(); h.login(); h.cmd.draw(1);
    const result = { useLotteryTimes: 1, lotteryTimes: 1, rewardList: rewards };
    h.receive(h.S.s2c_user_lottery, result); h.receive(h.S.s2c_user_lottery, result);
    assert.equal(h.results.length, 1); assert.equal(h.cmd.draw(1), true);
    h.receive(h.S.s2c_user_lottery, result); assert.equal(h.cmd.pending, true);
    h.receive(h.S.s2c_user_lottery, { ...result, lotteryTimes: 2 });
    assert.equal(h.results.length, 2); assert.equal(h.cmd.pending, false);
});
test('没有有效奖励明细时不编造武将、不触发演出', () => {
    const h = harness(); h.login(); h.cmd.draw(1);
    h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 1, lotteryTimes: 1 });
    assert.equal(h.results.length, 0); assert.equal(h.cmd.pending, false); assert.ok(h.cmd.error);
    h.cmd.draw(1); h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 1, lotteryTimes: 2, rewardList: [{ rewardType: 3, itemId: 1001, itemCount: -1 }] });
    assert.equal(h.results.length, 0); assert.ok(h.cmd.error);
});
test('超时只核对计数，不重发扣费；核对后的迟到奖励仍展示一次', () => {
    const h = harness(); h.login(); h.cmd.draw(1);
    const [id, timeout] = h.timers.entries().next().value; h.timers.delete(id); timeout();
    assert.equal(h.cmd.pending, false); assert.equal(h.cmd.draw(1), false);
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_user_lottery).length, 1);
    h.receive(h.S.s2c_req_user_lottery_info, { lotteryTimes: 1 });
    h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 1, lotteryTimes: 1, rewardList: rewards });
    assert.equal(h.results.length, 1); assert.equal(h.cmd.draw(1), true);
});
test('退出后迟到回包无效，重登后计数重新开始', () => {
    const h = harness(); h.login(); h.cmd.draw(1); h.events.emit(h.E.enterLogin);
    assert.equal(h.timers.size, 0);
    h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 1, lotteryTimes: 1, rewardList: rewards });
    assert.equal(h.results.length, 0);
    h.login(); h.cmd.draw(1); h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 1, lotteryTimes: 1, rewardList: rewards });
    assert.equal(h.results.length, 1);
});
test('五星判断来自实际整将配置，碎片与转化物不触发', () => {
    const h = harness(), p = h.load('reward/LotteryRewardPresentation');
    const list = [...rewards, { rewardType: 6, itemId: 11001, itemCount: 50 }, { rewardType: 3, itemId: 1002, itemCount: 1 }, { rewardType: 3, itemId: 99999, itemCount: 1 }];
    const rows = p.lotteryRewardEntries(list, table('Hero'));
    assert.deepEqual(plain(rows.map(row => row.fiveStar)), [true, false, false, false, false, false]);
    assert.deepEqual(plain(rows.map(row => row.reward)), list);
    for (const [w, h] of [[1280, 720], [390, 844], [320, 568], [568, 320]]) {
        const m = p.lotteryResultLayout(w, h);
        assert.ok(m.width * m.scale <= w - 19 && m.height * m.scale <= h - 19);
        assert.ok(m.pageSize >= 2 && m.areaHeight > 0);
    }
    assert.ok(p.lotteryResultLayout(1280, 720).pageSize >= 10);
});
test('道具品质严格读取新表，整将用武将品质或星级，传说碎片不冒充五星武将', () => {
    const h = harness(), p = h.load('reward/LotteryRewardPresentation'), heroes=table('Hero'), items=table('Item');
    const list=[1,100,103,1001,11001,11002,11003,11006].map(itemId=>({rewardType:1,itemId,itemCount:1}));
    list.push({rewardType:3,itemId:1001,itemCount:1});
    const rows=p.lotteryRewardEntries(list,heroes,items);
    assert.deepEqual(plain(rows.map(r=>r.quality)),[1,2,3,4,5,3,2,4,5]);
    assert.deepEqual(plain(rows.map(r=>r.fiveStar)),[false,false,false,false,false,false,false,false,true]);
    assert.equal(rows[4].category,'碎片'); assert.equal(rows[8].category,'5星武将');
    const changed=items.map(item=>({...item,Quality:item.Id===11001?2:item.Quality}));
    assert.equal(p.lotteryRewardEntries([list[4]],heroes,changed)[0].quality,2,'碎片品质不得强行绑定英雄星级');
    const unknown=p.lotteryRewardEntries([{rewardType:1,itemId:99999,itemCount:99999}],heroes,items)[0];
    assert.equal(unknown.quality,0,'不能按数量猜品质');
    assert.equal(new Set([1,2,3,4,5].map(q=>p.lotteryQualityStyle(q).accent.join(','))).size,5);
});
test('跳过立即进入全部结果，异步立绘不能重启五星演出', () => {
    const h = harness(), Window = h.load('reward/LotteryRewardWindow').default, ui = new Window();
    ui.phase = 'hero'; ui.generation = 1; let layouts = 0, completed = false;
    ui.layout = () => layouts++;
    const sprite = { isValid: true, spriteFrame: null };
    ui.load(sprite, 'portrait', () => { completed = true; }, 1);
    ui.skipAnimation(); assert.equal(ui.phase, 'results'); assert.equal(layouts, 1); assert.equal(ui.clock, 10);
    h.images[0](null, {}); assert.equal(completed, false); assert.equal(sprite.spriteFrame, null);
    ui.skipAnimation(); assert.equal(layouts, 1, '重复点击无副作用');
});
test('连续五星依次播放后进入完整列表，普通结果不走五星阶段', () => {
    const h = harness(), Window = h.load('reward/LotteryRewardWindow').default, ui = new Window();
    ui.phase = 'hero'; ui.featured = [1, 2]; ui.featuredIndex = 0; ui.clock = 0;
    let heroes = 1; ui.animateHero = () => {}; ui.layout = () => {};
    ui.showHero = () => { heroes++; ui.clock = 0; };
    for (let i = 0; i < 100; i++) ui.update(.1);
    assert.equal(heroes, 2); assert.equal(ui.phase, 'results'); assert.equal(ui.featuredIndex, 2);
});
function resultWindow(h) {
    const Window = h.load('reward/LotteryRewardWindow').default, ui = new Window();
    ui.layout = () => {}; ui.queueLayout = () => {}; ui.showHero = () => {};
    ui.result = { id: 1, count: 1, lotteryTimes: 1, rewards: [rewards[1]] }; ui.page = 2;
    Window.current = ui;
    h.events.on(h.E.lotteryResult, result => Window.show(result), ui);
    return { ui, Window };
}
test('结果页直接续抽十次，原窗更新奖励并播放新五星，不要求确认上一页', () => {
    const h = harness(); h.login(); h.receive(h.S.s2c_req_user_lottery_info, { lotteryTimes: 1 });
    const { ui, Window } = resultWindow(h), previous = ui.result;
    ui.repeatDraw(10); ui.repeatDraw(10);
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_user_lottery).length, 1, '连点只发送一次扣费请求');
    assert.equal(ui.result, previous, '回包前保留上一批奖励'); assert.equal(h.cmd.canDraw, false);
    h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 10, lotteryTimes: 11, rewardList: rewards });
    assert.equal(Window.current, ui); assert.equal(ui.queue.length, 0); assert.equal(ui.page, 0);
    assert.equal(ui.result.count, 10); assert.equal(ui.result.lotteryTimes, 11);
    assert.deepEqual(plain(ui.result.rewards), rewards); assert.equal(ui.phase, 'hero');
    ui.repeatDraw(1); assert.equal(h.sent.filter(p => p.name === h.S.c2s_user_lottery).length, 1);
    ui.skipAnimation(); ui.repeatDraw(1);
    h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 1, lotteryTimes: 12, rewardList: [rewards[1]] });
    assert.equal(ui.result.count, 1); assert.equal(ui.phase, 'results'); assert.equal(ui.queue.length, 0);
    assert.equal(h.proxy.getItemCount(103), 1000, '继续点将展示不在客户端扣发道具');
});
test('续抽道具不足与异常时保留当前结果，恢复后可继续操作', () => {
    const h = harness(); h.login(); const { ui } = resultWindow(h), previous = ui.result;
    h.proxy.getItemCount = () => 5;
    ui.repeatDraw(10); assert.equal(h.sent.filter(p => p.name === h.S.c2s_user_lottery).length, 0);
    assert.equal(ui.canRepeat(1), true); ui.repeatDraw(1);
    h.events.emit(h.S.s2c_user_lottery, null);
    assert.equal(ui.result, previous); assert.equal(h.cmd.pending, false); assert.ok(h.cmd.error);
    assert.equal(ui.canRepeat(1), true);
    h.proxy.getItemCount = () => 0; assert.equal(ui.canRepeat(1), false);
    h.events.emit(h.E.enterLogin); assert.equal(h.cmd.canDraw, false);
});
test('续抽超时只核对计数，迟到奖励直接更新原窗且不重复扣费', () => {
    const h = harness(); h.login(); const { ui } = resultWindow(h), previous = ui.result;
    ui.repeatDraw(10);
    const [id, timeout] = h.timers.entries().next().value; h.timers.delete(id); timeout();
    ui.repeatDraw(10);
    assert.equal(ui.result, previous); assert.equal(ui.canRepeat(10), false);
    assert.equal(h.sent.filter(p => p.name === h.S.c2s_user_lottery).length, 1);
    h.receive(h.S.s2c_req_user_lottery_info, { lotteryTimes: 10 });
    h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 10, lotteryTimes: 10, rewardList: rewards });
    assert.equal(ui.result.lotteryTimes, 10); assert.equal(ui.queue.length, 0); assert.equal(ui.phase, 'hero');
});
test('其它批次奖励继续排队，结果未看完时不会混入新的扣费请求', () => {
    const h = harness(); h.login(); const { ui, Window } = resultWindow(h), previous = ui.result;
    Window.show({ id: 9, count: 10, lotteryTimes: 20, rewards });
    assert.equal(ui.queue.length, 1); assert.equal(ui.result, previous); assert.equal(ui.canRepeat(1), false);
    ui.repeatDraw(1); assert.equal(h.sent.filter(p => p.name === h.S.c2s_user_lottery).length, 0);
    ui.showNextBatch(); assert.equal(ui.result.lotteryTimes, 20); assert.equal(ui.queue.length, 0);
});
function gridWindow(h) {
    const Window = h.load('reward/LotteryRewardWindow').default, ui = new Window(), commits = [];
    const entries = values => h.load('reward/LotteryRewardPresentation').lotteryRewardEntries(values, table('Hero'));
    ui.applyGrid = reveal => commits.push({ reveal, entries: ui.displayedEntries, frames: [...ui.displayedFrames] });
    return { ui, commits, entries };
}
test('新一页图标全部就绪才替换旧奖励，重复布局不会重载或闪出占位', () => {
    const h = harness(); h.login(); const { ui, commits, entries } = gridWindow(h);
    const old = entries([rewards[1]]), next = entries(rewards);
    ui.displayedEntries = old; ui.gridVisible = true; ui.gridSignature = 'old';
    ui.prepareGrid(next, 'next', 0); ui.prepareGrid(next, 'next', 0);
    assert.equal(h.images.length, 3); assert.equal(commits.length, 0);
    assert.equal(ui.displayedEntries, old); assert.equal(ui.canRepeat(1), false);
    h.images[1](null, { name: 'fragment' }); h.images[0](null, { name: 'hero' });
    assert.equal(commits.length, 0); assert.equal(ui.displayedEntries, old);
    h.images[2](null, { name: 'resource' });
    assert.equal(commits.length, 1); assert.equal(commits[0].reveal, false, '续抽不重新淡出再淡入');
    assert.equal(ui.displayedEntries, next); assert.equal(ui.canRepeat(1), true);
    assert.deepEqual(commits[0].frames.map(f => f.name), ['hero', 'fragment', 'resource']);
    ui.prepareGrid(next, 'next', 0);
    assert.equal(h.images.length, 3); assert.equal(commits.length, 1);
});
test('预热与同页重复道具共用贴图加载，下一次抽取直接使用缓存', () => {
    const h = harness(), { ui, commits, entries } = gridWindow(h), list = entries([rewards[1], rewards[1]]);
    ui.requestFrame(ui.entryIconPath(list[0]), () => {});
    ui.prepareGrid(list, 'first', 0); assert.equal(h.images.length, 1);
    const frame = { name: 'fragment' }; h.images[0](null, frame);
    assert.equal(commits.length, 1); assert.equal(commits[0].reveal, true);
    assert.ok(commits[0].frames.every(f => f === frame));
    ui.prepareGrid(list, 'second', 0);
    assert.equal(commits.length, 2); assert.equal(commits[1].reveal, false);
    assert.equal(h.images.length, 1); assert.equal(ui.gridLoading, false);
});
test('翻页或切批次后迟到的图标不能覆盖新结果，关闭后也不再更新', () => {
    const h = harness(), { ui, commits, entries } = gridWindow(h);
    const latest = entries([rewards[2]]);
    ui.prepareGrid(entries([rewards[1]]), 'old', 0);
    ui.prepareGrid(latest, 'latest', 1);
    h.images[1](null, { name: 'latest' }); h.images[0](null, { name: 'late' });
    assert.equal(commits.length, 1); assert.equal(ui.displayedEntries, latest); assert.equal(ui.displayedStart, 1);
    ui.prepareGrid(entries([rewards[0]]), 'after-close', 0);
    ui.node = { active: true, destroy() {} }; ui.dispose();
    h.images[2](null, { name: 'closed' });
    assert.equal(commits.length, 1);
});
test('图标缺失时整页统一使用最终兜底，不卡住续抽或反复闪动重试', () => {
    const h = harness(); h.login(); const { ui, commits, entries } = gridWindow(h), list = entries(rewards.slice(1));
    ui.prepareGrid(list, 'failed-image', 0);
    h.images[0](new Error('missing asset'), null); assert.equal(commits.length, 0);
    h.images[1](null, { name: 'resource' });
    assert.equal(commits.length, 1); assert.equal(commits[0].frames[0], null);
    assert.equal(ui.gridLoading, false); assert.equal(ui.canRepeat(1), true);
    ui.prepareGrid(list, 'next-result', 0);
    assert.equal(commits.length, 2); assert.equal(h.images.length, 2);
});
test('首次布局按钮文字尚未创建时也能正常准备和展示奖励', () => {
    const h = harness(); h.login(); const { ui, commits, entries } = gridWindow(h);
    ui.result = { id: 1, count: 1, lotteryTimes: 1, rewards: [rewards[1]] };
    ui.entries = entries(ui.result.rewards);
    ui.repeatStatus = { node: {} }; ui.repeatBalance = { node: {} }; ui.retryInfo = {}; ui.nextBatch = {};
    ui.previous = ui.next = { getComponent: () => ({}) };
    ui.prepareGrid(ui.entries, 'first-layout', 0);
    assert.equal(ui.repeatStatus.string, '', '瞬时加载不闪出提示');
    assert.match(ui.repeatBalance.string, /1,000/);
    h.images[0](null, { name: 'fragment' });
    assert.equal(commits.length, 1); assert.equal(ui.gridLoading, false);
});
function footerWindow(h) {
    const { ui } = resultWindow(h);
    ui.repeatStatus = { node: {} }; ui.repeatBalance = { node: {} }; ui.retryInfo = {}; ui.nextBatch = {};
    ui.previous = ui.next = { getComponent: () => ({}) };
    ui.repeatActions = [1, 10].map(count => ({ count, node: { getComponent: () => ({}) }, cost: { node: {} } }));
    ui.refreshActions(); return ui;
}
test('点将余额独立常驻，等待、贴图加载、库存更新和异常都不替换或隐藏余额', () => {
    const h = harness(); h.login(); let balance = 1000; h.proxy.getItemCount = () => balance;
    const ui = footerWindow(h), label = ui.repeatBalance;
    const check = expected => {
        ui.refreshActions(); assert.equal(ui.repeatBalance, label); assert.equal(label.node.active, true);
        assert.equal(label.string, `点将符 ${expected}`);
    };
    check('1,000'); ui.repeatDraw(10); check('1,000');
    assert.equal(ui.repeatStatus.string, '');
    balance = 990; check('990');
    h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 10, lotteryTimes: 10, rewardList: [rewards[1]] });
    ui.gridLoading = true; check('990');
    ui.gridLoading = false; check('990');
    h.cmd.requestInfo(); check('990');
    h.events.emit(h.S.s2c_req_user_lottery_info, null); check('990');
    assert.match(ui.repeatStatus.string, /读取失败/);
});
test('快速连抽不闪提示，慢请求延迟显示进度且不触碰余额', () => {
    const h = harness(); h.login(); const ui = footerWindow(h);
    ui.repeatDraw(1); ui.update(.1); ui.update(.1);
    assert.equal(ui.repeatStatus.string, '');
    h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 1, lotteryTimes: 1, rewardList: [rewards[1]] });
    ui.refreshActions(); assert.equal(ui.repeatStatus.string, '');
    ui.repeatDraw(10); for (let i = 0; i < 4; i++) ui.update(.1);
    assert.match(ui.repeatStatus.string, /正在点将/); assert.equal(ui.repeatBalance.string, '点将符 1,000');
    h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 10, lotteryTimes: 11, rewardList: [rewards[1]] });
    ui.refreshActions(); assert.equal(ui.repeatStatus.string, ''); assert.equal(ui.feedbackElapsed, 0);
});
test('关闭按钮可退出五星演出及等待中的结果页，不取消请求或吞掉迟到奖励', () => {
    for (const phase of ['hero', 'results']) {
        const h = harness(); h.login(); const Window = h.load('reward/LotteryRewardWindow').default, ui = new Window();
        let destroyed = false; ui.node = { active: true, destroy() { destroyed = true; } }; ui.phase = phase;
        ui.queue.push({ id: 9, count: 1, lotteryTimes: 9, rewards }); Window.current = ui;
        h.cmd.draw(1); ui.close();
        assert.equal(destroyed, true); assert.equal(ui.node.active, false); assert.equal(Window.current, null);
        assert.equal(ui.queue.length, 0); assert.equal(h.cmd.pending, true);
        h.receive(h.S.s2c_user_lottery, { useLotteryTimes: 1, lotteryTimes: 1, rewardList: rewards });
        assert.equal(h.results.length, 1); assert.equal(h.cmd.pending, false);
        assert.equal(h.sent.filter(p => p.name === h.S.c2s_user_lottery).length, 1);
    }
});
test('勾选偏好持久化、两处订阅同步，取消订阅后不再通知已关闭窗口', () => {
    const h = harness(), settings = h.load('reward/LotteryAnimationSettings'), changes = [];
    assert.equal(settings.skipsLotteryAnimation(), false);
    const off = settings.watchLotteryAnimation(value => changes.push(value));
    const other = [];
    settings.watchLotteryAnimation(value => other.push(value));
    settings.setSkipLotteryAnimation(true); settings.setSkipLotteryAnimation(true);
    off(); settings.setSkipLotteryAnimation(false);
    assert.deepEqual(changes, [true]); assert.deepEqual(other, [true, false]);
    settings.setSkipLotteryAnimation(true);
    h.modules.delete('reward/LotteryAnimationSettings');
    assert.equal(h.load('reward/LotteryAnimationSettings').skipsLotteryAnimation(), true, '重新加载仍记住选择');
});

test('勾选跳过直接展示全部真实奖励，取消勾选后下一批五星恢复演出', () => {
    const h = harness(); h.login(); const { ui } = resultWindow(h), settings = h.load('reward/LotteryAnimationSettings');
    settings.setSkipLotteryAnimation(true);
    ui.showResult({ id: 1, count: 10, lotteryTimes: 10, rewards });
    assert.equal(ui.phase, 'results'); assert.deepEqual(plain(ui.entries.map(entry => entry.reward)), rewards);
    settings.setSkipLotteryAnimation(false);
    assert.equal(ui.phase, 'results', '取消勾选不重放已经结束的演出');
    ui.showResult({ id: 2, count: 1, lotteryTimes: 11, rewards });
    assert.equal(ui.phase, 'hero'); assert.equal(h.sent.filter(p => p.name === h.S.c2s_user_lottery).length, 0);
});

test('立绘未就绪不消耗演出时长，超时仍能结束且迟到回调已失效', () => {
    const h = harness(), Window = h.load('reward/LotteryRewardWindow').default, ui = new Window();
    let reset = 0; ui.portraitMotion = { reset() { reset++; } }; ui.animateHero = () => {}; ui.layout = () => {};
    ui.phase = 'hero'; ui.heroReady = false; ui.featured = [1]; ui.generation = 10;
    for (let i = 0; i < 40; i++) ui.update(.1);
    assert.equal(ui.clock, 0); assert.equal(ui.phase, 'hero');
    for (let i = 0; i < 23; i++) ui.update(.1);
    assert.equal(ui.heroReady, true); assert.equal(ui.generation, 11); assert.equal(reset, 1);
    for (let i = 0; i < 47; i++) ui.update(.1);
    assert.equal(ui.phase, 'results'); assert.equal(ui.featuredIndex, 1);
});

test('窗口销毁并被 Creator 清空字段后，迟到贴图回调直接退出', () => {
    const h = harness(), Window = h.load('reward/LotteryRewardWindow').default, ui = new Window();
    let applied = false;
    ui.requestFrame('portrait-after-destroy', () => { applied = true; });
    ui.isValid = false; ui.frameLoads = null; ui.frames = null;
    assert.doesNotThrow(() => h.images[0](null, { name: 'late' }));
    assert.equal(applied, false);
});

console.log(passed + ' groups passed');
