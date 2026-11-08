// Verify the loading-page frame boundary and packet logging without a live account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '../..');
process.on('uncaughtException', error => { console.error(error); process.exit(1); });
function load(file, imports = {}, cc = {}, logger = console) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const { outputText, diagnostics } = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    } });
    assert.equal(diagnostics.length, 0);
    const module = { exports: {} };
    const requireMock = name => name === 'cc' ? cc : imports[name] || { default: class {} };
    new Function('require', 'module', 'exports', 'console', outputText)(requireMock, module, module.exports, logger);
    return module.exports;
}
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }
function fixture() {
    let afterDraw;
    const tasks = [], operations = [];
    const Main = load('assets/scripts/Main.ts', {
        './map/WorldMapArt': { default: { prepare: () => Promise.resolve() } },
        './login/LoginCommand': { default: { getInstance: () => ({ beginMapLoading: () => operations.push('role-data') }) } },
        './general/GeneralCommand': { default: { getInstance: () => ({ beginLoading() {
            operations.push('heroes'); return Promise.resolve(false);
        } }) } },
        './core/LoaderManager': { LoadData: class {}, LoadDataType: {}, default: { getInstance: () => ({
            startLoadList() { operations.push('assets'); },
        }) } },
    }, {
        Component: class { isValid = true; },
        _decorator: { ccclass: () => Type => Type, property: () => () => {} },
        Director: { EVENT_AFTER_DRAW: 'after-draw' },
        director: { once(name, callback) { afterDraw = callback; }, off(name, callback) { if (callback === afterDraw) afterDraw = null; } },
    }).default;
    const main = new Main();
    main.node = { children: [] };
    main._loginScene = { active: true };
    main.scheduleOnce = callback => tasks.push(callback);
    main.addLoadingNode = () => {
        operations.push('loading-visible');
        main._loadingNode = { isValid: true, destroy() {} };
    };
    return { main, tasks, operations, draw() { const callback = afterDraw; afterDraw = null; callback?.(); } };
}
test('role creation hides the old page before the first loading frame; requests start in the following update', () => {
    const f = fixture();
    f.main.onEnterMap(); f.main.onEnterMap();
    assert.equal(f.main._loginScene.active, false);
    assert.deepEqual(f.operations, ['loading-visible']);
    assert.equal(f.tasks.length, 0);
    f.draw();
    assert.deepEqual(f.operations, ['loading-visible']);
    assert.equal(f.tasks.length, 1);
    f.tasks.shift()();
    assert.deepEqual(f.operations, ['loading-visible', 'role-data', 'heroes', 'assets']);
});
test('logging out before the first loading frame or before its scheduled update cancels old requests', () => {
    for (const drawFirst of [false, true]) {
        const f = fixture();
        f.main.onEnterMap();
        if (drawFirst) f.draw();
        f.main.disposeLoadingNow();
        f.draw();
        f.tasks.splice(0).forEach(callback => callback());
        assert.deepEqual(f.operations, ['loading-visible']);
    }
});
test('network packets still decode and dispatch while verbose payload logging is disabled', () => {
    const traces = [], errors = [], received = [], sent = [];
    const config = { traceNetworkPackets: false };
    const payload = { name: 'test response' };
    const WebSock = load('assets/scripts/network/socket/WebSock.ts', {
        '../../config/GameConfig': { GameConfig: config },
        '../pto/ProtoManager': { ProtoManager: { getInstance: () => ({
            getMsgTypeById: id => id === 39 ? 'User.s2c_user_create' : null,
            getIdByMsgType: () => 38, decode: () => payload,
        }) } },
    }, {}, { log: (...args) => traces.push(args), debug: (...args) => traces.push(args),
        error: (...args) => errors.push(args), warn: (...args) => errors.push(args) }).WebSock;
    const socket = new WebSock();
    socket.onUnpackMessage = (name, data) => received.push({ name, data });
    socket.send = data => sent.push(data);
    const packet = new Uint8Array([0, 3, 0, 39, 1]).buffer;
    for (let i = 0; i < 50; i++) socket.onMessage(packet);
    socket.packAndSend({ name: 'User.c2s_user_create', msg: new Uint8Array([1]) });
    assert.equal(received.length, 50);
    assert.equal(received[0].data, payload);
    assert.equal(sent.length, 1);
    assert.equal(traces.length, 0);
    socket.onMessage(new Uint8Array([0, 2, 0, 99]).buffer);
    assert.equal(errors.length, 1, 'protocol errors remain visible');
    config.traceNetworkPackets = true;
    socket.onMessage(packet);
    assert.equal(traces.length, 1, 'opt-in tracing produces a single summary per packet');
    assert.equal(traces[0].length, 1, 'never serialize the full payload just to trace a packet');
});
console.log(`${passed} entry-frame regression groups passed.`);
process.exit(0);
