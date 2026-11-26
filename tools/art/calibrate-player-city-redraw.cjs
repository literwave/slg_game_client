// 为分阶段主城计算透明轮廓；六张阶段图片齐备并验证后才更新配置。
const fs = require('node:fs');
const path = require('node:path');
const { Jimp } = require('../../extensions/cocos-ai-copilot/lib/asset-preview/image-core');
const root = path.resolve(__dirname, '../..');
const world = path.join(root, 'assets/resources/world');
const artDir = path.join(root, 'assets/resources/ui/world');
const stageLevels = new Set([1, 10, 15, 20, 25, 30]);
const nameFor = level => level === 10 ? 'player-city-grid-10-wall-v2'
    : `player-city-grid-${String(level).padStart(2, '0')}`;

async function profile(level, art = nameFor(level)) {
    const file = path.join(artDir, art + '.png');
    if (!fs.existsSync(file)) throw new Error(`缺少主城图片：${art}`);
    const { bitmap } = await Jimp.read(file), { width, height, data } = bitmap;
    if (width !== 1040 || height !== 520) throw new Error(`主城图片尺寸不正确：${art}`);
    const minY = Array(width).fill(height), maxY = Array(width).fill(-1);
    let left = width, right = -1, top = height, bottom = -1, opaque = 0, transparent = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha < 16) transparent++;
        if (alpha < 192) continue;
        opaque++; left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        minY[x] = Math.min(minY[x], y); maxY[x] = Math.max(maxY[x], y);
    }
    if (opaque < width * height * .2 || transparent < width * height * .1 || left >= right || top >= bottom)
        throw new Error(`主城透明轮廓不完整：${art}`);
    const cy = (top + bottom + 1) / 2;
    // 以地脚最下沿贴住前方两条格线，塔楼高度不再迫使整座城缩小。
    const scale = .992 * width / (right + 1 - left);
    const centerX = (left + right + 1) / (2 * width);
    let floorEnvelope = -Infinity;
    for (let x = left; x <= right; x++) if (maxY[x] >= 0) {
        for (const px of [x, x + 1]) floorEnvelope = Math.max(floorEnvelope,
            (maxY[x] + 1) / height + Math.abs(px / width - centerX));
    }
    const centerY = floorEnvelope - .496 / scale;
    if (!Number.isFinite(scale) || scale < 1 || scale > 1.3 || !Number.isFinite(centerY))
        throw new Error(`主城地脚标定异常：${art}`);
    const ground = [], ceiling = [];
    for (let x = 0; x < width; x++) {
        const lo = maxY[x] < 0 ? cy : maxY[x], hi = maxY[x] < 0 ? cy : minY[x];
        ground.push(height - lo); ceiling.push(height - hi);
    }
    return { art, width, height, left, right, ground, ceiling,
        tileBounds: { left, right: right + 1, top, bottom: bottom + 1, scale, centerX, centerY, canvasAligned: true, groundAligned: true }, gateX: 740 };
}

async function main() {
    const profilesPath = path.join(world, 'player-city-ground.json');
    const sizesPath = path.join(world, 'art-sizes.json');
    const previous = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
    const sizes = JSON.parse(fs.readFileSync(sizesPath, 'utf8'));
    if (!Array.isArray(previous) || previous.length !== 31) throw new Error('旧主城标定表不完整');
    const next = [previous[0]], stages = [];
    for (let level = 1; level <= 30; level++) {
        const item = stageLevels.has(level) ? await profile(level) : previous[level];
        if (!item || item.ground?.length !== item.width || item.ceiling?.length !== item.width)
            throw new Error(`主城标定不完整：${level} 级`);
        if (stageLevels.has(level)) stages.push({ level, art: item.art, scale: +item.tileBounds.scale.toFixed(3) });
        next.push(item); sizes[item.art] = [item.width, item.height];
    }
    if (!process.argv.includes('--apply')) {
        console.log(JSON.stringify(stages));
        console.log('阶段主城图片和标定数据检查通过；未写入配置。'); return;
    }
    fs.writeFileSync(profilesPath, JSON.stringify(next) + '\n');
    fs.writeFileSync(sizesPath, JSON.stringify(sizes) + '\n');
    console.log('已更新六个阶段主城的标定和尺寸信息。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
