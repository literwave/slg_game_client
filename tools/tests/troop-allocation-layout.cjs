// 执行实际布局函数，检查数字行与操作行、滑块与输入框的间距。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require(process.argv[2]);
const source = fs.readFileSync(path.resolve(__dirname, '../../assets/scripts/map/ui/TroopPanelSkin.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', code)(name => name === 'cc'
    ? { Color: class {} } : {}, mod, mod.exports);
const { troopAllocationLayout } = mod.exports;
for (const width of [176, 190, 220, 285, 320]) {
    const m = troopAllocationLayout(width);
    assert.ok(m.valueY - 16 > m.fieldY + 16 + 8, '数字行和操作行之间至少留出 8 像素');
    assert.ok(m.valueY + 16 <= m.height / 2 && m.fieldY - 16 >= -m.height / 2, '控件不能越出兵力区');
    assert.ok(m.sliderLeft - 16 >= -width / 2, '滑块触控范围留在卡片内');
    assert.ok(m.sliderLeft + m.sliderWidth + 16 < m.plusX - 6, '满格滑块不能压到加号');
    assert.ok(m.plusX + 6 < m.inputX - m.inputWidth / 2, '加号不能压住输入框');
    assert.ok(m.inputX + m.inputWidth / 2 <= width / 2 - 12, '输入框保留右边距');
}
console.log('PASS 5 种卡片宽度：数字、滑条、滑块和输入框无重叠');
