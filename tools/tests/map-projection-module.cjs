// 小型测试夹具共用真实投影模块，不复制生产比例。
const fs = require('node:fs'), path = require('node:path');
module.exports = ts => {
    const file = path.resolve(__dirname, '../../assets/scripts/map/MapProjection.ts');
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const output = {};
    new Function('exports', code)(output);
    return output;
};
