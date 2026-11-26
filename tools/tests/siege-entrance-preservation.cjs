// 执行真实入口构建工具，临时夹具验证换图只更新哈希、不移动旧入口或改写地图。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const ts = require(process.argv[2]);
const { buildSiegeEntrances } = require('../world/build-siege-entrances.cjs');
const worldFile = 'assets/resources/world/campaign-map.json';
const configFile = 'tools/world/siege-entrances.json';
const shapeFile = 'assets/scripts/map/SystemCitySilhouettes.ts';
const sourceNames = ['CityFootprint', 'CityArtFit', 'SystemCityGeometry', 'SystemCitySilhouettes', 'GateGeometry', 'BridgeSilhouette', 'MapProjection'];
const temporaryParent = fs.realpathSync(os.tmpdir());
const temporaryRoot = fs.mkdtempSync(path.join(temporaryParent, 'slg-entrance-preservation-'));
let passed = 0;
function fixture(name) {
    const root = path.join(temporaryRoot, name);
    const write = (file, value) => {
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 4) + '\n');
    };
    const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    write('assets/scripts/map/CityFootprint.ts', 'export const cityFootprintRadius = () => 1;\n');
    write('assets/scripts/map/CityArtFit.ts', 'export const CITY_ART_FILL = .98;\n');
    write('assets/scripts/map/MapProjection.ts', 'export const MAP_TILE_WIDTH = 200, MAP_TILE_HEIGHT = 125;\n');
    write(shapeFile, 'export const radius = 2;\n');
    write('assets/scripts/map/SystemCityGeometry.ts',
        "import { radius } from './SystemCitySilhouettes'; export const systemCityCoversCell = (x, y) => Math.abs(x) <= radius && Math.abs(y) <= radius;\n");
    write('assets/scripts/map/GateGeometry.ts',
        'export const gateWidth = () => 200, gateHeight = () => 125, GATE_ASPECT = .5, BRIDGE_ASPECT = .5, GATE_ANCHOR_X = .5, GATE_ANCHOR_Y = .5, BRIDGE_ANCHOR_X = .5, BRIDGE_ANCHOR_Y = .5;\n'
        + 'export const gateMirrored = () => false; export const gateHit = (x, y) => Math.abs(x) < 100 && Math.abs(y) < 50;\n');
    write('assets/scripts/map/BridgeSilhouette.ts', 'export const bridge = {};\n');
    const cities = [{ name: '测试州府', x: 10, y: 10, level: 4, footprintRadius: 1,
        attackEntrances: [{ x: 14, y: 10 }, { x: 10, y: 14 }, { x: 6, y: 10 }, { x: 10, y: 6 }] }];
    const gates = [{ name: '测试关', x: 30, y: 30, level: 5, axis: 'x', crossing: 'pass', footprintRadius: 1,
        attackEntrances: [{ x: 32, y: 30 }, { x: 28, y: 30 }] }];
    write(worldFile, { version: 'map-layout-kept', width: 40, height: 40, cities, gates });
    write('assets/resources/world/original-landscape.json', { riverCells: [], mountainCells: [] });
    write('assets/resources/config/mapRes_0.json', { w: 40, h: 40,
        list: Array.from({ length: 1600 }, () => [0, 0]), emptyCells: Array.from({ length: 1600 }, (_, i) => i) });
    const geometryHashes = Object.fromEntries(sourceNames.map(name => {
        const file = `assets/scripts/map/${name}.ts`;
        return [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file), 'utf8')).digest('hex')];
    }));
    write(configFile, { version: 1, width: 40, height: 40, geometryHashes, landmarks: [
        { kind: 'city', x: 10, y: 10, level: 4, footprintRadius: 1, attackEntrances: cities[0].attackEntrances },
        { kind: 'gate', x: 30, y: 30, level: 5, axis: 'x', crossing: 'pass', bridgeSpan: 0, footprintRadius: 1, attackEntrances: gates[0].attackEntrances },
    ] });
    return { root, write, read, run: options => buildSiegeEntrances({ root, ts, ...options }),
        bytes: file => fs.readFileSync(path.join(root, file)) };
}
function test(name, fn) { fn(fixture(name)); passed++; }
function rejectsWithoutWriting(f, expected) {
    const world = f.bytes(worldFile), config = f.bytes(configFile);
    assert.throws(() => f.run(), expected);
    assert.deepEqual(f.bytes(worldFile), world);
    assert.deepEqual(f.bytes(configFile), config, '失败不能先写哈希或部分入口');
}
try {
    test('read-only-check', f => {
        const before = f.bytes(configFile), world = f.bytes(worldFile);
        assert.equal(f.run({ check: true }).entrances, 6);
        assert.deepEqual(f.bytes(configFile), before);
        assert.deepEqual(f.bytes(worldFile), world);
    });
    test('smaller-art-keeps-existing-points', f => {
        const world = f.bytes(worldFile), old = f.read(configFile);
        f.write(shapeFile, 'export const radius = 1;\n');
        assert.throws(() => f.run({ check: true }), /几何哈希已变化/);
        const result = f.run();
        const current = f.read(configFile);
        assert.equal(result.mode, 'preserve-existing');
        assert.deepEqual(f.bytes(worldFile), world, '换图不能改变地图的任何字节');
        assert.deepEqual(current.landmarks, old.landmarks, '轮廓缩小也不能把入口挪向城墙');
        assert.notEqual(current.geometryHashes[shapeFile], old.geometryHashes[shapeFile]);
        assert.deepEqual({ ...current, geometryHashes: old.geometryHashes }, old, '只能改几何哈希');
        f.run({ check: true });
    });
    test('larger-art-rejected', f => {
        f.write(shapeFile, 'export const radius = 4;\n');
        rejectsWithoutWriting(f, /固定入口 14,10 被 测试州府 美术覆盖/);
    });
    test('another-city-overlap-rejected', f => {
        f.write('assets/scripts/map/SystemCityGeometry.ts',
            'export const systemCityCoversCell = (x, y) => (x === 22 && y === 20);\n');
        rejectsWithoutWriting(f, /测试关 的固定入口 32,30 被 测试州府 美术覆盖/);
    });
    test('snapshot-disagreement-rejected', f => {
        const world = f.read(worldFile); world.cities[0].attackEntrances[0].x++;
        f.write(worldFile, world);
        rejectsWithoutWriting(f, /地图快照入口与固定表不一致/);
    });
    test('resource-conflict-rejected', f => {
        const map = f.read('assets/resources/config/mapRes_0.json'); map.list[10 * 40 + 14] = [52, 4];
        f.write('assets/resources/config/mapRes_0.json', map);
        rejectsWithoutWriting(f, /不可通行、被占用或重复/);
    });
    test('explicit-reselect-only', f => {
        f.write(shapeFile, 'export const radius = 1;\n');
        const old = f.read(configFile).landmarks[0].attackEntrances;
        assert.equal(f.run({ reselect: true }).mode, 'reselect');
        const points = f.read(configFile).landmarks[0].attackEntrances;
        assert.deepEqual(points, [{ x: 12, y: 10 }, { x: 10, y: 12 }], '显式迁移到正面贴墙两格');
        assert.notDeepEqual(points, old, '只有显式重选才使用更近的入口');
        assert.deepEqual(f.read(worldFile).cities[0].attackEntrances, points);
        f.run({ check: true });
    });
    console.log(`PASS 固定入口保留工具 ${passed} 项：只读、缩图保留、遮挡拒绝、跨城覆盖、快照/资源冲突、显式重选`);
} finally {
    const resolved = path.resolve(temporaryRoot);
    assert.equal(path.dirname(resolved), temporaryParent);
    assert.ok(path.basename(resolved).startsWith('slg-entrance-preservation-'));
    fs.rmSync(resolved, { recursive: true, force: true });
}
