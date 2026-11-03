// Exercise real drag handlers, including Creator's outside-release TOUCH_CANCEL routing.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
class Vec2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(p) { this.x = p.x; this.y = p.y; }
    static squaredDistance(a, b) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
}
class Vec3 extends Vec2 {}
class UITransform {
    width = 180; height = 300;
    convertToNodeSpaceAR(p) { return p; }
    getBoundingBoxToWorld() { const x = this.node.position.x; return { contains: p => p.x >= x && p.x <= x + this.width && p.y >= 0 && p.y <= this.height }; }
}
class Node {
    static EventType = { TOUCH_START: 'touch-start', TOUCH_MOVE: 'touch-move', TOUCH_END: 'touch-end', TOUCH_CANCEL: 'touch-cancel' };
    children = []; components = new Map(); events = new Map(); active = true; isValid = true; position = { x: 0, y: 0 };
    constructor(name) { this.name = name; }
    addChild(n) { n.parent = this; this.children.push(n); }
    addComponent(Type) { const c = new Type(); c.node = this; c.isValid = true; this.components.set(Type, c); return c; }
    getComponent(Type) { return this.components.get(Type) || null; }
    getComponentsInChildren(Type) { return [...(this.getComponent(Type) ? [this.getComponent(Type)] : []), ...this.children.flatMap(c => c.getComponentsInChildren(Type))]; }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    setPosition(x, y) { this.position = { x, y }; }
    setSiblingIndex() {}
    on(type, fn, owner) { this.events.set(type, { fn, owner }); }
    off(type) { this.events.delete(type); }
    destroy() { this.isValid = false; this.active = false; }
}
class Button { enabled = true; interactable = true; }
class UIOpacity { opacity = 255; }
class Sprite { static SizeMode = { CUSTOM: 1 }; }
class Label { static HorizontalAlign = { CENTER: 1 }; }
const cc = { Node, Vec2, Vec3, UITransform, Button, UIOpacity, Sprite, Label, Color: class {} };
const style = {
    ManagementColors: {},
    place(n, x, y, width, height) { n.setPosition(x, y); Object.assign(n.getComponent(UITransform), { width, height }); },
    inkSurface(parent, name) { const n = new Node(name); parent.addChild(n); return { node: n }; },
    caption(parent, name, string) { let n = parent.getChildByName(name); if (!n) { n = new Node(name); parent.addChild(n); } return { node: n, string }; },
};
const source = fs.readFileSync(path.resolve(__dirname, '../../assets/scripts/map/ui/TroopDragInteraction.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
assert.equal(code.diagnostics.length, 0);
const mod = { exports: {} };
new Function('require', 'module', 'exports', code.outputText)(name => name === 'cc' ? cc : name === './ManagementStyle' ? style : {}, mod, mod.exports);

function fixture() {
    const root = new Node('Troop'); root.addComponent(UITransform);
    const cards = [0, 102, 103].map((hero, index) => {
        const node = new Node('Card' + index); node.addComponent(UITransform); node.setPosition(index * 200, 0); root.addChild(node);
        const face = new Node('Face'); node.addChild(face); const button = face.addComponent(Button);
        const down = new Node('Down'); node.addChild(down); const downButton = down.addComponent(Button); downButton.interactable = false;
        return { node, face, button, downButton, btnDown: down, formationHeroId: hero, formationUnlocked: true,
            labelName: { string: '武将' + hero }, headIcon: { spriteFrame: {} }, suppressed: 0, suppressDragClick() { this.suppressed++; } };
    });
    const commits = []; let editable = true;
    const drag = new mod.exports.default(root, cards, () => editable, (from, to) => commits.push([from, to]));
    const event = (x, type, id = 1, target = cards[1].face) => ({
        currentTarget: cards[1].node, target, type,
        getID: () => id, getUILocation: () => new Vec2(x, 150), getEventCode: () => type,
    });
    function send(type, x, id = 1, target) {
        // Button.enabled=false removes listeners and drops subsequent input on the claimed child node.
        if (!cards[1].button.enabled) return;
        const e = event(x, type, id, target);
        const routedType = type === Node.EventType.TOUCH_END && (x < 200 || x > 380) ? Node.EventType.TOUCH_CANCEL : type;
        e.type = routedType;
        const listener = cards[1].node.events.get(routedType); listener?.fn.call(listener.owner, e);
        return e;
    }
    return { cards, root, drag, commits, send, stopEditing: () => editable = false };
}
const E = Node.EventType;
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
test('副将拖向空主将位，持续跟手，跨卡片松手只提交一次', () => {
    const h = fixture(); h.cards[1].node.addComponent(UIOpacity).opacity = 173;
    h.send(E.TOUCH_START, 290); h.send(E.TOUCH_MOVE, 260);
    assert.equal(h.cards[1].button.enabled, true, '拖动不能注销已捕获触点的按钮监听');
    assert.equal(h.cards[1].button.interactable, false);
    h.send(E.TOUCH_MOVE, 150); h.send(E.TOUCH_MOVE, 90);
    assert.equal(h.drag.ghost.position.x, 90, '第一帧之后仍须接收移动事件');
    assert.equal(h.drag.target, 0);
    h.send(E.TOUCH_END, 90); h.send(E.TOUCH_END, 90);
    assert.deepEqual(h.commits, [[1, 0]]);
    assert.equal(h.cards[1].button.interactable, true);
    assert.equal(h.cards[1].downButton.interactable, false, '原本禁用的按钮保持禁用');
    assert.equal(h.cards[1].node.getComponent(UIOpacity).opacity, 173);
    assert.equal(h.drag.ghost.active, false);
    assert.equal(h.drag.outlines[0].active, false);
});
test('拖向已有武将的位置提交互换，普通点击保持详情行为', () => {
    const h = fixture(); h.send(E.TOUCH_START, 290); h.send(E.TOUCH_MOVE, 293); h.send(E.TOUCH_END, 293);
    assert.deepEqual(h.commits, []); assert.equal(h.cards[1].suppressed, 0);
    h.send(E.TOUCH_START, 290); h.send(E.TOUCH_MOVE, 490); h.send(E.TOUCH_END, 490);
    assert.deepEqual(h.commits, [[1, 2]]); assert.ok(h.cards[1].suppressed > 0);
});
test('系统取消、释放到原位或面板外都不保存', () => {
    for (const [endType, x] of [[E.TOUCH_CANCEL, 90], [E.TOUCH_END, 290], [E.TOUCH_END, -50]]) {
        const h = fixture(); h.send(E.TOUCH_START, 290); h.send(E.TOUCH_MOVE, 90); h.send(endType, x);
        assert.deepEqual(h.commits, []); assert.equal(h.drag.ghost.active, false); assert.equal(h.cards[1].button.interactable, true);
    }
});
test('锁定槽位、下阵按钮、多触点和拖动期间的阵容变更受到保护', () => {
    const locked = fixture(); locked.cards[0].formationUnlocked = false;
    locked.send(E.TOUCH_START, 290); locked.send(E.TOUCH_MOVE, 90); locked.send(E.TOUCH_END, 90);
    assert.deepEqual(locked.commits, []);
    const down = fixture(); down.send(E.TOUCH_START, 290, 1, down.cards[1].btnDown); down.send(E.TOUCH_MOVE, 90); down.send(E.TOUCH_END, 90);
    assert.deepEqual(down.commits, []); assert.equal(down.drag.ghost, null);
    const multi = fixture(); multi.send(E.TOUCH_START, 290); multi.send(E.TOUCH_MOVE, 90, 2); multi.send(E.TOUCH_END, 90, 2);
    assert.deepEqual(multi.commits, []); assert.equal(multi.drag.touchId, 1);
    multi.send(E.TOUCH_MOVE, 90); multi.cards[2].formationHeroId = 999; multi.send(E.TOUCH_END, 90);
    assert.deepEqual(multi.commits, []); assert.equal(multi.drag.ghost.active, false);
    const busy = fixture(); busy.send(E.TOUCH_START, 290); busy.send(E.TOUCH_MOVE, 90); busy.stopEditing(); busy.send(E.TOUCH_END, 90);
    assert.deepEqual(busy.commits, []);
});
test('关闭销毁时恢复交互、移除拖影和监听，不残留拖动', () => {
    const h = fixture(); h.send(E.TOUCH_START, 290); h.send(E.TOUCH_MOVE, 90); h.drag.destroy();
    assert.equal(h.cards[1].button.interactable, true); assert.equal(h.drag.ghost.isValid, false);
    assert.ok(h.cards.every(c => c.node.events.size === 0)); assert.equal(h.drag.touchId, -1);
});
console.log(`${passed} troop drag regression groups passed.`);
