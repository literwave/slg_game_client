// Node or Creator ELECTRON_RUN_AS_NODE=1; pass the Creator TypeScript package path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
const effects = [];
const preferences = { music: false, sound: true };
const audio = {
    getConfiguration: music => music ? preferences.music : preferences.sound,
    playClick: () => effects.push('click'),
    openMusic: () => effects.push('music-on'), closeMusic: () => effects.push('music-off'),
    openSound: () => effects.push('sound-on'), closeSound: () => effects.push('sound-off'),
};
const engine = {
    Component: class {}, Widget: class {}, Toggle: class {},
    _decorator: { ccclass: () => type => type, property: () => () => {} },
};
const source = fs.readFileSync(path.join(root, 'assets/scripts/map/ui/Setting.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
}, reportDiagnostics: true });
assert.equal(compiled.diagnostics.length, 0);
const mod = { exports: {} };
const imports = {
    cc: engine,
    '../../common/AudioManager': { AudioManager: { instance: audio } },
    '../../common/BgLogic': { default: class {} },
    '../../common/DialogOut': { DialogOut: class {} },
    './ManagementStyle': {},
};
new Function('require', 'module', 'exports', compiled.outputText)(id => {
    assert.ok(Object.hasOwn(imports, id), `Unexpected import: ${id}`);
    return imports[id];
}, mod, mod.exports);

function toggle(value) {
    let checked = value;
    return {
        get isChecked() { return checked; },
        set isChecked(next) { checked = next; effects.push('unexpected-toggle-notification'); },
        setIsCheckedWithoutNotify(next) { checked = next; },
    };
}
const settings = new mod.exports.Setting();
settings.prepare = () => {};
settings.layout = () => {};
settings.paintToggle = () => {};
settings.node = { active: false, getComponent: () => ({ updateAlignment() {} }) };
settings.music = toggle(true);
settings.sound = toggle(false);
settings.show();
assert.equal(settings.node.active, true);
assert.equal(settings.music.isChecked, false);
assert.equal(settings.sound.isChecked, true);
assert.deepEqual(effects, [], 'opening settings must not change audio or emit a toggle event');
console.log('PASS opening settings reads saved preferences without firing toggle callbacks');

settings.onClickClose();
assert.equal(settings.node.active, false);
preferences.music = true;
preferences.sound = false;
effects.length = 0;
settings.show();
assert.equal(settings.music.isChecked, true);
assert.equal(settings.sound.isChecked, false);
assert.deepEqual(effects, []);
console.log('PASS reopening settings refreshes saved preferences and closing only hides the panel');

settings.music.setIsCheckedWithoutNotify(false);
settings.onClickMusic();
settings.sound.setIsCheckedWithoutNotify(true);
settings.onClickSound();
assert.deepEqual(effects, ['click', 'music-off', 'click', 'sound-on']);
console.log('PASS changing music and sound remains connected to the existing audio controls');

const prefab = JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes/MapUIScene.prefab'), 'utf8'));
const more = prefab.find(item => item.__type__ === 'cc.Node' && item._name === 'MorePanel');
const children = more._children.map(ref => prefab[ref.__id__]);
const entry = children.find(item => item._name === 'SettingButton');
const exit = children.find(item => item._name === 'ExitButton');
assert.ok(entry?._active, 'settings must be a reachable active child, not an orphaned serialized node');
assert.equal(exit?._active, false, 'exit must not appear in More before it is moved into settings');
const button = entry._components.map(ref => prefab[ref.__id__]).find(item => item.__type__ === 'cc.Button');
assert.equal(prefab[button.clickEvents[0].__id__].handler, 'onClickSetting');
console.log('PASS the settings entry is reachable and the exit entry is hidden from More');

// Exercise the real window-creation method twice, with the first window reclaimed between opens.
const uiSource = fs.readFileSync(path.join(root, 'assets/scripts/map/ui/MapUILogic.ts'), 'utf8');
const uiCompiled = ts.transpileModule(uiSource, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
} });
const uiModule = { exports: {} }, hud = {}, exitTemplate = { parent: hud, active: false, isValid: true };
const panelPrefab = {}, windows = [];
const uiEngine = { ...engine, instantiate(value) {
    if (value === exitTemplate) return { ...exitTemplate };
    assert.equal(value, panelPrefab);
    const panel = {}, setting = new mod.exports.Setting();
    const node = { isValid: true, active: false, getComponent: () => setting,
        getChildByName: () => panel, destroy() { this.isValid = false; setting._exitButton.isValid = false; } };
    setting.node = node; windows.push(node); return node;
} };
new Function('require', 'module', 'exports', uiCompiled.outputText)(id => {
    if (id === 'cc') return uiEngine;
    if (id === './Setting') return mod.exports;
    return { default: class {} };
}, uiModule, uiModule.exports);
const ui = new uiModule.exports.default(); ui.settingPrefab = panelPrefab; ui.contentNode = {};
ui.node = { getChildByPath: () => exitTemplate.isValid && exitTemplate.parent === hud ? exitTemplate : null };
const first = ui.ensureSettingsPanel();
assert.notEqual(first._exitButton, exitTemplate);
assert.equal(exitTemplate.parent, hud); assert.equal(exitTemplate.active, false);
windows[0].destroy(); ui._settingNode = null;
const second = ui.ensureSettingsPanel();
assert.equal(second._exitButton.isValid, true); assert.notEqual(second._exitButton, first._exitButton);
assert.equal(exitTemplate.parent, hud); assert.equal(exitTemplate.isValid, true);
console.log('PASS idle settings reclamation preserves the hidden exit template for the next open');
