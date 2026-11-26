// 默认保留固定入口，换图后验证旧入口并仅更新几何哈希；--check 全程只读。
// node tools/world/build-siege-entrances.cjs <typescript模块路径> [--preserve-existing] [--check]
// 只有明确传 --reselect 才重新选点并更新地图快照，供首次建图或有意变更入口使用。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sources = ['CityFootprint', 'CityArtFit', 'SystemCityGeometry', 'SystemCitySilhouettes', 'GateGeometry', 'BridgeSilhouette', 'MapProjection'];

function buildSiegeEntrances({ root = path.resolve(__dirname, '../..'), ts, check = false, reselect = false }) {
const modules = new Map();
function load(name) {
    if (modules.has(name)) return modules.get(name);
    const filename = path.join(root, 'assets/scripts/map', name + '.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => load(id.replace('./', '')), module, module.exports);
    modules.set(name, module.exports); return module.exports;
}
const { cityFootprintRadius } = load('CityFootprint');
const { systemCityCoversCell } = load('SystemCityGeometry');
const gateGeometry = load('GateGeometry');
const { gateHit, gateMirrored } = gateGeometry;
const { MAP_TILE_WIDTH: tileWidth, MAP_TILE_HEIGHT: tileHeight } = load('MapProjection');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const worldFile = 'assets/resources/world/campaign-map.json';
const world = read(worldFile), landscape = read('assets/resources/world/original-landscape.json');
const map = read('assets/resources/config/mapRes_0.json');
if (map.w !== world.width || map.h !== world.height) throw new Error('入口地图与资源地图尺寸不一致');
const blocked = new Set([...landscape.riverCells, ...landscape.mountainCells]);
const empty = new Set(map.emptyCells);
const landmarks = [...world.cities.map(row => ({ kind: 'city', row })), ...world.gates.map(row => ({ kind: 'gate', row }))];
const reserved = new Set();
for (const { row } of landmarks) {
    const radius = row.footprintRadius ?? cityFootprintRadius(row.level);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) reserved.add((row.y + dy) * world.width + row.x + dx);
}
function gateCovers(row, dx, dy) {
    if (row.crossing === 'pass' && row.footprintRadius === 1) return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
    const px = (dx - dy) * tileWidth / 2, py = -(dx + dy) * tileHeight / 2;
    const mirrored = gateMirrored(row.x, row.y, world.width, world.height, row);
    const bridge = row.crossing === 'bridge', width = gateGeometry.gateWidth(row.level, row, tileWidth);
    const height = gateGeometry.gateHeight(row.level, row, tileWidth, tileHeight);
    const anchorX = bridge ? gateGeometry.BRIDGE_ANCHOR_X : gateGeometry.GATE_ANCHOR_X;
    const anchorY = bridge ? gateGeometry.BRIDGE_ANCHOR_Y : gateGeometry.GATE_ANCHOR_Y;
    // 远处城关无需逐点采样；包围框来自同一绘制几何，并保留整格与采样余量。
    const centerX = (0.5 - anchorX) * width * (mirrored ? -1 : 1);
    const centerY = (0.5 - anchorY) * height;
    if (Math.abs(px - centerX) > width / 2 + tileWidth / 2 + 2
        || Math.abs(py - centerY) > height / 2 + tileHeight / 2 + 2) return false;
    // 2 像素密采样覆盖整个格子和 2 像素余量，不仅检查格心或入口图标的位置。
    // 原桥 Alpha mask 的每块比采样间隔大；城墙轮廓同样通过实际 gateHit 判定。
    for (let y = -tileHeight / 2 - 2; y <= tileHeight / 2 + 2; y += 2)
        for (let x = -tileWidth / 2 - 2; x <= tileWidth / 2 + 2; x += 2) {
        if (Math.abs(x) / (tileWidth / 2) + Math.abs(y) / (tileHeight / 2) > 1.04) continue;
        if (gateHit(px + x, py + y, row.level, mirrored, row, tileWidth, tileHeight)) return true;
    }
    return false;
}
function covers(kind, row, x, y) {
    return kind === 'city'
        ? systemCityCoversCell(x - row.x, y - row.y, row.level, tileWidth, tileHeight, row)
        : gateCovers(row, x - row.x, y - row.y);
}
const used = new Set(), result = [];
if (reselect) {
for (const { kind, row } of landmarks) {
    const radius = row.footprintRadius ?? cityFootprintRadius(row.level);
    const directions = kind === 'city' ? [[1,0], [0,1]]
        : row.axis === 'x' ? [[1,0],[-1,0]] : [[0,1],[0,-1]];
    const entrances = [];
    for (const [dx, dy] of directions) {
        let found;
        // 每一面仅搜索门前轴线附近；固定入口使用空地，避免遮住已有资源地操作。
        const maxDistance = kind === 'city' ? radius + 1 : Math.max(radius + 10, (row.bridgeSpan || 0) + 3);
        for (let distance = radius + 1; distance <= maxDistance && !found; distance++) {
            for (const side of kind === 'city' || row.crossing === 'pass' ? [0] : [0, -1, 1]) {
                const x = row.x + dx * distance - dy * side, y = row.y + dy * distance + dx * side;
                const id = y * world.width + x;
                if (x < 0 || y < 0 || x >= world.width || y >= world.height || blocked.has(id)
                    || reserved.has(id) || !empty.has(id) || map.list[id]?.[0] !== 0 || used.has(id)
                    || landmarks.some(other => covers(other.kind, other.row, x, y))) continue;
                found = { x, y }; break;
            }
        }
        if (!found) throw new Error(`${row.name} 的 ${dx},${dy} 方向入口不可通行；城市正面贴墙格必须先留空，不能向远处偏移`);
        entrances.push(found); used.add(found.y * world.width + found.x);
    }
    result.push({ kind, x: row.x, y: row.y, level: row.level,
        ...(kind === 'gate' ? { axis: row.axis, crossing: row.crossing, bridgeSpan: row.bridgeSpan || 0,
            ...(row.crossing === 'pass' ? { footprintRadius: 1 } : {}) } : { footprintRadius: radius }),
        attackEntrances: entrances });
}
}
const geometryHashes = Object.fromEntries(sources.map(name => {
    const file = `assets/scripts/map/${name}.ts`;
    // 换行形式与几何无关，避免 Windows/WSL checkout 差异导致哈希误报。
    return [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex')];
}));
const configFile = 'tools/world/siege-entrances.json';
let output;
if (reselect) {
    output = { version: 1, cityEntranceLayout: 'front-wall-adjacent', passEntranceLayout: 'opposite-wall-adjacent', width: world.width, height: world.height, geometryHashes, landmarks: result };
} else {
    if (!fs.existsSync(path.join(root, configFile))) throw new Error('固定入口表不存在；首次生成需明确传 --reselect');
    const current = read(configFile);
    if (current.version !== 1 || current.width !== world.width || current.height !== world.height)
        throw new Error('固定入口配置版本或地图尺寸不一致');
    const identity = row => `${row.kind}:${row.x},${row.y}`;
    const entries = new Map(current.landmarks.map(row => [identity(row), row]));
    if (entries.size !== current.landmarks.length || entries.size !== landmarks.length)
        throw new Error('固定入口表与地图城关数量不一致或存在重复城关');
    for (const { kind, row } of landmarks) {
        const entry = entries.get(identity({ kind, ...row }));
        const keys = kind === 'city' ? ['level', 'footprintRadius'] : ['level', 'axis', 'crossing', 'bridgeSpan'];
        if (!entry || keys.some(key => entry[key] !== (row[key] ?? (key === 'bridgeSpan' ? 0 : undefined))))
            throw new Error(`${row.name} 的城关身份、占地或朝向已改变`);
        const points = entry.attackEntrances;
        if (kind === 'gate' && row.crossing === 'pass') {
            const expected = [2,-2].map(u => ({ x: row.x + (row.axis === 'x' ? u : 0), y: row.y + (row.axis === 'y' ? u : 0) }));
            if (row.footprintRadius !== 1 || entry.footprintRadius !== 1 || JSON.stringify(points) !== JSON.stringify(expected))
                throw new Error(`${row.name} 必须使用 3×3 占地和两侧贴墙入口`);
        }
        const adjacent = kind === 'city' && current.cityEntranceLayout === 'front-wall-adjacent';
        if (!Array.isArray(points) || points.length !== (kind === 'city' && !adjacent ? 4 : 2))
            throw new Error(`${row.name} 的固定入口数量错误`);
        if (adjacent && JSON.stringify(points) !== JSON.stringify([
            { x: row.x + row.footprintRadius + 1, y: row.y }, { x: row.x, y: row.y + row.footprintRadius + 1 },
        ])) throw new Error(`${row.name} 的攻城落脚点必须紧邻正面两侧城墙`);
        if (JSON.stringify(row.attackEntrances) !== JSON.stringify(points))
            throw new Error(`${row.name} 的地图快照入口与固定表不一致；不能在换图时修改入口坐标`);
        for (const point of points) {
            const { x, y } = point, id = y * world.width + x;
            if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= world.width || y >= world.height
                || blocked.has(id) || reserved.has(id) || !empty.has(id) || map.list[id]?.[0] !== 0 || used.has(id))
                throw new Error(`${row.name} 的固定入口 ${x},${y} 不可通行、被占用或重复`);
            const covering = landmarks.find(other => covers(other.kind, other.row, x, y));
            if (covering) throw new Error(`${row.name} 的固定入口 ${x},${y} 被 ${covering.row.name} 美术覆盖；请调整城图，不能自动移走入口`);
            used.add(id);
        }
        result.push(entry);
    }
    output = { ...current, geometryHashes };
}
if (check) {
    const current = read(configFile);
    if (Object.keys(current.geometryHashes).length !== sources.length
        || Object.entries(geometryHashes).some(([file, hash]) => current.geometryHashes[file] !== hash))
        throw new Error('城图几何哈希已变化，请运行保留入口校验以更新哈希');
    if (reselect && JSON.stringify(current.landmarks) !== JSON.stringify(result))
        throw new Error('显式重新选点结果与固定入口表不一致');
    if (reselect && landmarks.some(({ row }, i) => JSON.stringify(row.attackEntrances) !== JSON.stringify(result[i].attackEntrances)))
        throw new Error('地图快照缺失或改动了入口坐标');
} else {
    fs.writeFileSync(path.join(root, configFile), JSON.stringify(output, null, 2) + '\n');
}
if (reselect && !check) {
    for (let i = 0; i < landmarks.length; i++) landmarks[i].row.attackEntrances = result[i].attackEntrances;
    fs.writeFileSync(path.join(root, worldFile), JSON.stringify(world));
}
return { check, mode: reselect ? 'reselect' : 'preserve-existing', cities: world.cities.length, gates: world.gates.length,
    entrances: used.size, points: landmarks.map(({ row }, i) => ({ name: row.name, points: result[i].attackEntrances })) };
}

module.exports = { buildSiegeEntrances };
if (require.main === module) {
    if (process.argv.includes('--preserve-existing') && process.argv.includes('--reselect'))
        throw new Error('--preserve-existing 与 --reselect 不能同时使用');
    const tsPath = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'typescript';
    console.log(JSON.stringify(buildSiegeEntrances({ ts: require(tsPath), check: process.argv.includes('--check'),
        reselect: process.argv.includes('--reselect') }), null, 2));
}
