// 执行真实输入方法，覆盖轻微手抖与开始拖动时的累计位移。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require(process.argv[2]);
const file = path.resolve(__dirname, '../../assets/scripts/map/MapLogic.ts');
const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const methods = ast.statements.find(ts.isClassDeclaration).members
    .filter(m => ['onTouchBegan', 'onTouchMove', 'onTouchCancel'].includes(m.name?.getText(ast)));
const source = 'export default class Input {\n' + methods.map(m => m.getText(ast)).join('\n') + '\n}';
const mod = { exports: {} };
new Function('module', 'exports', ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText)(mod, mod.exports);
const input = new mod.exports.default();
const vector = (x, y) => ({ x, y, set(x, y) { Object.assign(this, { x, y }); } });
Object.assign(input, {
    _touchOrigin: vector(0, 0), _mapCamera: { orthoHeight: 360, node: { position: { x: 100, y: 200 } } },
    worldUnitsPerUIUnit: () => 2, clampCameraPoint: (x, y) => ({ x, y }), flushPendingCameraMove() {},
});
const event = (x, y, dx = 0, dy = 0, id = 1) => ({
    getID: () => id, getUILocation: () => ({ x, y }), getUIDelta: () => vector(dx, dy),
});
input.onTouchBegan(event(10, 20));
input.onTouchMove(event(12, 22, 2, 2));
assert.equal(input._isMove, false, '小幅手抖仍按点击处理');
assert.equal(input._moveDirty, false, '点击不触发地图裁剪/相机刷新');
input.onTouchMove(event(20, 20, 8, -2));
assert.equal(input._isMove, true);
assert.equal(input._pendingCameraX, 80, '越过阈值后补齐累计位移，不产生起步跳跃');
assert.equal(input._pendingCameraY, 200);
input.onTouchMove(event(23, 22, 3, 2));
assert.equal(input._pendingCameraX, 74); assert.equal(input._pendingCameraY, 196);
input.onTouchMove(event(100, 100, 77, 78, 2));
assert.equal(input._pendingCameraX, 74, '其它触点不能抢走当前拖动');
input.onTouchCancel(event(23, 22));
assert.equal(input._isTouch, false); assert.equal(input._activeTouchId, null);
input.onTouchBegan(event(50, 50));
input.onTouchMove(event(53, 50, 3, 0));
assert.equal(input._isMove, false, '下一次点击重新计算阈值');
console.log('PASS 地图点击：手抖容差、拖动累计位移、多触点隔离、取消后再次点击');
