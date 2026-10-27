// 按客户端位置、锚点、缩放和排序渲染布局审核图；不修改任何源美术，不连接游戏服务器。
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'temp/map-dispersion-review');
const versions = ['before-landscape.json', '../../assets/resources/world/original-landscape.json'];
async function render(config, x, y) {
    const width = 1400, height = 800, scale = .72;
    const centerX = (x - y) * 100, centerY = (999 - x - y) * 50;
    const metadata = {};
    for (const art of new Set(config.patches.map(p => p.art))) metadata[art] = await sharp(path.join(root, 'assets/resources/ui/world', art + '.png')).metadata();
    const layers = [];
    const ground = await sharp(path.join(root, 'assets/resources/ui/world/plains.png')).resize(512, 512).toBuffer();
    for (let top = 0; top < height; top += 512) for (let left = 0; left < width; left += 512) {
        layers.push({ input: await sharp(ground).extract({ left: 0, top: 0, width: Math.min(512, width - left), height: Math.min(512, height - top) }).toBuffer(), left, top });
    }
    for (const p of config.patches.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y))) {
        const meta = metadata[p.art], w = Math.round(p.width * scale), h = Math.round(p.width * meta.height / meta.width * (p.heightScale || 1) * scale);
        const left = Math.round(width / 2 + ((p.x - p.y) * 100 - centerX) * scale - w / 2);
        const top = Math.round(height / 2 - ((999 - p.x - p.y) * 50 - centerY) * scale - h * (1 - (p.anchorY ?? .22)));
        if (left >= width || top >= height || left + w <= 0 || top + h <= 0) continue;
        let sprite = sharp(path.join(root, 'assets/resources/ui/world', p.art + '.png')).resize(w, h, { fit: 'fill' });
        if (p.flipX) sprite = sprite.flop();
        const image = await sprite.toBuffer();
        const x0 = Math.max(0, -left), y0 = Math.max(0, -top);
        const input = await sharp(image).extract({ left: x0, top: y0, width: Math.min(w - x0, width - Math.max(0, left)), height: Math.min(h - y0, height - Math.max(0, top)) }).toBuffer();
        layers.push({ input, left: Math.max(0, left), top: Math.max(0, top) });
    }
    return sharp({ create: { width, height, channels: 4, background: '#8c9270' } }).composite(layers).png().toBuffer();
}
(async () => {
    for (const [name, x, y] of [['coast', 2, 400], ['pass', 904, 500], ['diagonal', 710, 864]]) {
        const rows = [];
        for (const version of versions) rows.push(await render(JSON.parse(fs.readFileSync(path.resolve(output, version), 'utf8')), x, y));
        await sharp({ create: { width: 1400, height: 1600, channels: 4, background: '#000000' } })
            .composite(rows.map((input, index) => ({ input, left: 0, top: index * 800 }))).png().toFile(path.join(output, 'mountain-' + name + '.png'));
    }
    console.log('Rendered three layout comparisons: upper=before, lower=after. Offline sprite layout only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
