// 执行实际选框方法，验证地面层级以及弹窗回收；不操作游戏账号。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ts = require(process.argv[2]);
const file = path.resolve(__dirname, '../../assets/scripts/map/MapClickUILogic.ts');
const source = fs.readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const cls = ast.statements.find(ts.isClassDeclaration);
const names = ['placeGroundSelection', 'onDisable', 'onDestroy'];
const text = 'class Selection {\n' + cls.members.filter(n => names.includes(n.name?.getText(ast))).map(n => n.getText(ast)).join('\n') + '\n}; module.exports=Selection;';
const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'EventMgr', 'LogicEvent', compiled)(mod, { emit() {}, targetOff() {} }, {});
class Node {
    constructor(name, parent = null) { this.name = name; this.children = []; this.parent = null; this.isValid = true; this.active = true; this.position = { x: 0, y: 0, z: 0 }; this.scale = { x: 1, y: 1, z: 1 }; this.setParent(parent); }
    setParent(p) { if (this.parent) this.parent.children.splice(this.getSiblingIndex(), 1); this.parent = p; if (p) p.children.push(this); }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    getComponent(name) { return name === 'MapArmyLogic' ? this.army : null; }
    getSiblingIndex() { return this.parent.children.indexOf(this); }
    setSiblingIndex(i) { const a = this.parent.children; a.splice(this.getSiblingIndex(), 1); a.splice(i, 0, this); }
    get worldPosition() { const p = this.parent?.worldPosition || { x: 0, y: 0, z: 0 }; return { x: p.x + this.position.x, y: p.y + this.position.y, z: p.z + this.position.z }; }
    get worldScale() { return this.scale; }
    setWorldPosition(p) { const q = this.parent?.worldPosition || { x: 0, y: 0, z: 0 }; this.position = { x: p.x - q.x, y: p.y - q.y, z: p.z - q.z }; }
    setWorldScale(s) { this.scale = { ...s }; }
    destroy() { this.isValid = false; this.setParent(null); }
}
const scene = new Node('MapScene'), terrain = new Node('Terrain', scene), armies = new Node('Army', scene), touch = new Node('Touch', scene);
scene.army = { parentLayer: armies }; scene.position = { x: 50, y: -25, z: 0 };
const popup = new mod.exports(); popup.node = new Node('Popup', touch); popup.bgSelect = new Node('Selection', popup.node); popup.stopCountDown = () => {};
for (const point of [{ x: 200, y: -50, z: 0 }, { x: -300, y: 100, z: 0 }]) {
    popup.node.position = point;
    for (let i = 0; i < 20; i++) popup.placeGroundSelection();
    assert.equal(popup.bgSelect.parent, scene);
    assert.equal(popup.bgSelect.getSiblingIndex(), armies.getSiblingIndex() - 1, '选框在部队下方，不能绘制到马身上');
    assert.ok(popup.bgSelect.getSiblingIndex() > terrain.getSiblingIndex());
    assert.deepEqual(popup.bgSelect.worldPosition, popup.node.worldPosition, '更换目标后选框必须跟随地块');
    assert.equal(scene.children.filter(n => n === popup.bgSelect).length, 1, '重复布局不得复制选框');
}
popup.onDisable(); assert.equal(popup.bgSelect.active, false, '关闭弹窗必须清除脱离 UI 层的选框');
popup.bgSelect.active = true; popup.placeGroundSelection();
popup.onDestroy(); assert.equal(popup.bgSelect.isValid, false); assert.ok(!scene.children.includes(popup.bgSelect));
console.log('PASS 到达地块选框层级、跟随目标、重复布局、关闭隐藏与销毁回收');
