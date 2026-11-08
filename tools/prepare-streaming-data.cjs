// Regenerate after changing config, TMX geometry or world artwork; --check is read-only.
const fs = require('node:fs');
const path = require('node:path');
function buildStreamingData(root = path.resolve(__dirname, '..')) {
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const header = read('assets/resources/world/map.tmx').match(/<map\b[^>]*>/)?.[0];
if (!header || !/orientation=["']isometric["']/.test(header)) throw new Error('等距地图定义缺失');
const directory = path.join(root, 'assets/resources/ui/world'), sizes = {};
for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.png')).sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(directory, file + '.meta'), 'utf8'));
    const data = Object.values(meta.subMetas).find(value => value.importer === 'sprite-frame')?.userData;
    const width = data?.rawWidth || data?.width, height = data?.rawHeight || data?.height;
    if (!(width > 0 && height > 0)) throw new Error(`地图美术尺寸缺失：${file}`);
    sizes[file.slice(0, -4)] = [width, height];
}
const tables = {};
for (const file of fs.readdirSync(path.join(root, 'assets/resources/config')).filter(name => name.endsWith('.json')).sort()) {
    tables[file.slice(0, -5)] = JSON.parse(read('assets/resources/config/' + file));
}
const map = tables.mapRes_0, count = map.w * map.h;
if (!Number.isSafeInteger(count) || count <= 0 || map.list.length !== count) throw new Error('地图格数不匹配');
const cells = Buffer.alloc(count * 2);
map.list.forEach(([type, level], index) => {
    if (!Number.isInteger(type) || type < 0 || type > 127 || !Number.isInteger(level) || level < 0 || level > 255)
        throw new Error(`地图格 ${index} 超出紧凑编码范围`);
    cells[index * 2] = type; cells[index * 2 + 1] = level;
});
for (const id of map.emptyCells || []) {
    if (!Number.isInteger(id) || id < 0 || id >= count) throw new Error('空地编号无效');
    if (cells[id * 2] === 0) cells[id * 2] = 128;
}
tables.mapRes_0 = { w: map.w, h: map.h, encoding: 'u8-type-level-empty-v1', cells: cells.toString('base64') };
return { 'map-geometry.json': { header }, 'art-sizes.json': sizes, 'boot-configs.json': { version: 1, tables } };
}
module.exports = { buildStreamingData };
if (require.main === module) {
const root = path.resolve(__dirname, '..');
for (const [file, value] of Object.entries(buildStreamingData(root))) {
    const target = path.join(root, 'assets/resources/world', file);
    if (process.argv.includes('--check')) {
        const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (Object.keys(existing).length !== Object.keys(value).length || Object.keys(value).some(key =>
            JSON.stringify(existing[key]) !== JSON.stringify(value[key]))) throw new Error(`${file} 需要重新生成`);
    } else fs.writeFileSync(target, JSON.stringify(value));
    console.log(`${file}: ${Buffer.byteLength(JSON.stringify(value))} bytes`);
}
}
