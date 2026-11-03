// Controlled cold loads: verify the actual cache and tab renderer without a server or account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
function load(file, imports, cc, timers) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(
        id => id === 'cc' ? cc : imports[id], module, module.exports,
        fn => { const token = {}; timers.set(token, fn); return token; }, token => timers.delete(token));
    return module.exports;
}
function fixture() {
    const requests = [], assets = new Map(), timers = new Map();
    class SpriteFrame { isValid = true; refs = 0; originalSize = { width: 256, height: 256 }; addRef() { this.refs++; } }
    class Color { static WHITE = new Color(); }
    class UITransform { setContentSize(w, h) { this.width = w; this.height = h; } }
    class Sprite { static SizeMode = { CUSTOM: 1 }; }
    class Label { static HorizontalAlign = { CENTER: 1 }; }
    class Button { static Transition = { SCALE: 1 }; }
    class Graphics { moveTo() {} lineTo() {} close() {} fill() {} stroke() {} }
    class Node {
        constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.isValid = true; this.active = true; }
        addChild(node) { this.children.push(node); node.parent = this; }
        getChildByName(name) { return this.children.find(n => n.name === name); }
        addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
        getComponent(Type) { return this.components.get(Type); }
        setSiblingIndex() {}
    }
    const cc = { SpriteFrame, Color, UITransform, Sprite, Label, Button, Graphics, Node, resources: {
        get: key => assets.get(key), load: (key, type, callback) => requests.push({ key, callback }),
    } };
    const cacheModule = load('assets/scripts/chat/ChatIconCache.ts', {}, cc, timers);
    const make = (parent, name, Type) => {
        let node = parent.getChildByName(name);
        if (!node) { node = new Node(name); parent.addChild(node); node.addComponent(UITransform); node.addComponent(Type); }
        return node;
    };
    const style = {
        ManagementColors: { gold: new Color(), muted: new Color(), text: new Color() },
        place: (node, x, y, w, h) => { node.position = { x, y }; node.getComponent(UITransform).setContentSize(w, h); },
        inkSurface: (parent, name) => make(parent, name, Graphics).getComponent(Graphics),
        caption: (parent, name, string) => { const label = make(parent, name, Label).getComponent(Label); label.string = string; return label; },
    };
    const view = load('assets/scripts/chat/ChatView.ts', { './ChatIconCache': cacheModule,
        '../map/ui/ManagementStyle': style, '../map/ui/TaskBoardView': {} }, cc, timers);
    const finish = (request, error = null, frame = new SpriteFrame()) => {
        if (!error) assets.set(request.key, frame);
        request.callback(error, frame); return frame;
    };
    const tab = index => { const node = new Node('Tab'); node.addComponent(UITransform); node.addComponent(Button);
        view.chatChannelTab(node, '频道', index, true, 0, 0, 120); return node; };
    return { ...cacheModule, requests, assets, timers, finish, tab, Sprite, SpriteFrame };
}
async function main() {
    {
        const f = fixture(), Cache = f.default; let ready = false;
        const warm = Cache.prepare(() => true).then(() => { ready = true; });
        assert.equal(f.requests.length, 3);
        f.finish(f.requests[1]); f.finish(f.requests[0]); await Promise.resolve();
        assert.equal(ready, false, '不能提前结束进图加载，露出缺一枚图标的页签');
        f.finish(f.requests[2]); await warm;
        for (let cycle = 0; cycle < 3; cycle++) for (let index = 0; index < 3; index++) {
            const node = f.tab(index), icon = node.getChildByName('Artwork');
            assert.equal(icon.active, true);
            assert.equal(icon.getComponent(f.Sprite).spriteFrame, Cache.get(f.CHAT_CHANNEL_ART[index]), '创建页签当次同步绑定，无需等待下一帧或 Promise');
            node.isValid = false;
        }
        await Cache.prepare(() => true);
        assert.equal(f.requests.length, 3, '重复开关不重新请求图标');
        assert.ok([...f.assets.values()].every(frame => frame.refs === 1), '常驻引用每张只持有一次');
        assert.equal(f.timers.size, 0);
        console.log('PASS 冷启动三图全部就绪后同步显示首帧，重复打开无补图');
    }
    {
        const f = fixture(), Cache = f.default;
        const warm = Cache.prepare(() => true), rejected = assert.rejects(warm, /聊天频道图标未就绪/);
        f.finish(f.requests[0]); f.finish(f.requests[1], new Error('missing')); f.finish(f.requests[2]); await rejected;
        const retry = Cache.prepare(() => true);
        assert.equal(f.requests.length, 4, '只重试失败图标'); f.finish(f.requests[3]); await retry;
        const first = Cache.get(f.CHAT_CHANNEL_ART[0]); first.isValid = false;
        const reload = Cache.load(f.CHAT_CHANNEL_ART[0]); assert.equal(f.requests.length, 5);
        const restored = f.finish(f.requests[4]); assert.equal(await reload, restored);
        console.log('PASS 加载失败可重试，失效资源不会冒充缓存命中');
    }
    {
        const f = fixture(), Cache = f.default, key = f.CHAT_CHANNEL_ART[0];
        const one = Cache.load(key), two = Cache.load(key); assert.equal(one, two);
        for (const fn of [...f.timers.values()]) fn(); assert.equal(await one, null);
        const late = f.finish(f.requests[0]); assert.equal(late.refs, 0, '超时后的旧回调不会污染持有缓存');
        f.assets.clear(); const retry = Cache.load(key); const fresh = f.finish(f.requests[1]); assert.equal(await retry, fresh);
        console.log('PASS 并发去重、超时与迟到回调安全');
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
