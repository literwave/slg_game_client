// 在 Creator 主进程调用 run(typescript, require('electron').nativeImage)。
// 用真实原图验证逐列地脚校准，不生成或修改图片。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

exports.run = function run(ts, nativeImage) {
    const source = fs.readFileSync(path.join(root, 'assets/scripts/map/PlayerCityAppearance.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    }, reportDiagnostics: true });
    assert.equal(compiled.diagnostics.length, 0);
    const model = {};
    new Function('exports', compiled.outputText)(model);
    const groundModule = {};
    const groundCode = ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/map/PlayerCityGround.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    new Function('require', 'exports', groundCode)(name => name === 'cc' ? {} : model, groundModule);
    const Ground = groundModule.default;
    const profiles = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/world/player-city-ground.json'), 'utf8'));
    Ground.profiles = profiles;
    assert.equal(profiles.length, model.PLAYER_CITY_MAX_LEVEL + 1);
    const sizes = [[200, 100], [256, 128], [240, 90]];
    let samples = 0;
    for (let level = 0; level <= model.PLAYER_CITY_MAX_LEVEL; level++) {
        const art = model.playerCityAppearance(level), profile = profiles[level];
        assert.equal(art.art, profile.art);
        const png = nativeImage.createFromPath(path.join(root, 'assets/resources/ui/world', art.art + '.png'));
        assert.ok(!png.isEmpty(), art.art);
        const { width, height } = png.getSize(), pixels = png.toBitmap();
        assert.equal(width, profile.width); assert.equal(height, profile.height);
        assert.equal(profile.ground.length, width);
        assert.equal(profile.ceiling.length, width);
        assert.ok(profile.left >= 0 && profile.right < width && profile.right > profile.left);
        for (let x = profile.left; x <= profile.right; x++) {
            const floor = profile.ground[x];
            assert.ok(Number.isFinite(floor) && floor >= 0 && floor < height);
            const alpha = pixels[((height - 1 - Math.round(floor)) * width + x) * 4 + 3];
            assert.ok(alpha >= 192, `${art.art} 的地脚 ${x} 取到了透明边：${alpha}`);
            const top = profile.ceiling[x];
            assert.ok(top > floor && top <= height, `${art.art} 的屋顶范围错误`);
            assert.ok(pixels[((height - top) * width + x) * 4 + 3] >= 16, `${art.art} 的屋顶范围不匹配原图`);
            samples++;
        }
        for (const [tileWidth, tileHeight] of sizes) {
            const fit = model.playerCityAppearance(level, tileWidth, tileHeight);
            const footprint = model.playerCityFootprint(tileWidth, tileHeight);
            const layout = Ground.layout(fit, footprint.height);
            const scale = fit.height / profile.height, projection = Ground.projection(profile, scale);
            assert.ok(Number.isFinite(layout.height) && layout.height >= footprint.height);
            assert.equal(layout.width, footprint.width);
            if (profile.plane) {
                const p = profile.plane;
                assert.ok(p.frontX > profile.left && p.frontX < profile.right);
                for (let x = profile.left; x <= profile.right; x++) {
                    const base = Ground.planePoint(profile, x, 0, scale, footprint.height);
                    const top = Ground.planePoint(profile, x, profile.ceiling[x], scale, footprint.height);
                    const floor = p.fitContour ? profile.ground[x] : Math.round(base.floor);
                    assert.ok(pixels[((height - 1 - floor) * width + x) * 4 + 3] >= 192,
                        `${profile.art} 九格边缘出现透明缝隙：${x}`);
                    if (p.fitContour) {
                        const boundary = Ground.planePoint(profile, x, profile.ground[x], scale, footprint.height);
                        assert.ok(Math.abs(boundary.y - Math.abs(boundary.u - .5) * footprint.height) < 1e-6,
                            '地面轮廓必须准确落在占地边缘');
                    } else {
                        assert.ok(base.floor - profile.ground[x] < 5, '只能裁掉抗锯齿边缘，不能切掉墙脚');
                    }
                    assert.ok(top.y <= layout.height, '屋顶不能被画布裁切');
                    const delta = (profile.ground[x] - base.floor) * scale;
                    const groundBand = p.fitContour
                        ? Math.max(footprint.height * .03, Math.abs(delta) * (delta < 0 ? .25 : 2) + 1) / scale : 0;
                    for (const y of [base.floor + groundBand + 1, base.floor + groundBand + 40, base.floor + groundBand + 160]) {
                        const a = Ground.planePoint(profile, x, y, scale, footprint.height);
                        const b = Ground.planePoint(profile, x, y + 20, scale, footprint.height);
                        assert.ok(Math.abs(b.y - a.y - 20 * scale) < 1e-6,
                            '地面过渡带上方的建筑必须维持同一纵向比例');
                    }
                }
                assert.ok(Math.abs(Ground.planePoint(profile, p.frontX, p.fitContour ? profile.ground[Math.round(p.frontX)] : p.frontY, scale, footprint.height).y) < 1e-6);
                assert.ok(Math.abs(Ground.planePoint(profile, profile.left, p.fitContour ? profile.ground[profile.left] : p.leftY, scale, footprint.height).y - footprint.height / 2) < 1e-6);
                assert.ok(Math.abs(Ground.planePoint(profile, profile.right, p.fitContour ? profile.ground[profile.right] : p.rightY, scale, footprint.height).y - footprint.height / 2) < 1e-6);
            } else {
            // 建筑主体同一段垂直距离在左右两侧必须一样长，不能一侧拉伸、一侧压扁。
            const heightAt = (x, y) => y * scale + x * projection.shear + projection.offset;
            const span = profile.right - profile.left;
            const peak = (from, to) => {
                let point = { x: 0, y: 0 };
                for (let x = Math.ceil(profile.left + span * from); x <= profile.left + span * to; x++) {
                    if (profile.ceiling[x] > point.y) point = { x, y: profile.ceiling[x] };
                }
                return point;
            };
            const leftRoof = profile.roofAnchors ? { x: profile.roofAnchors[0], y: profile.ceiling[profile.roofAnchors[0]] } : peak(.04, .16);
            const rightRoof = profile.roofAnchors ? { x: profile.roofAnchors[1], y: profile.ceiling[profile.roofAnchors[1]] } : peak(.84, .96);
            assert.ok(Math.abs(heightAt(leftRoof.x, leftRoof.y) - heightAt(rightRoof.x, rightRoof.y)) < 1e-6,
                `${profile.art} 两侧角楼没有校平`);
            assert.ok(Math.abs((heightAt(leftRoof.x, 240) - heightAt(leftRoof.x, 200))
                - (heightAt(rightRoof.x, 240) - heightAt(rightRoof.x, 200))) < 1e-6);
            for (let x = profile.left; x <= profile.right; x++) {
                const sourceU = (x - profile.left) / span;
                let low = 0, high = 1;
                for (let i = 0; i < 20; i++) {
                    const u = (low + high) / 2;
                    if (u + projection.bias * 4 * u * (1 - u) < sourceU) low = u; else high = u;
                }
                const edge = Math.abs((low + high) / 2 - .5) * footprint.height;
                const smooth = Ground.smooth(profile)[x];
                const delta = heightAt(x, profile.compactFrontGround ? profile.ground[x] : smooth) - edge;
                const compact = profile.compactFrontGround && delta < 0;
                const band = Math.max(footprint.height * .04, Math.abs(delta) * (compact ? .25 : 2) + 1);
                const derivative = 1 - delta / band;
                assert.ok(derivative > .5 && derivative < (compact ? 5 : 1.5), `${profile.art} 贴地映射发生翻折`);
                const top = heightAt(x, profile.ceiling[x]);
                let renderedTop = top < edge + band ? edge + (top - edge - delta) / derivative : top;
                const fine = profile.compactFrontGround ? 0 : (profile.ground[x] - smooth) * scale / derivative;
                const fineBand = Math.max(footprint.height * .035, Math.abs(fine) * 2 + 1);
                if (renderedTop < edge + fineBand) renderedTop = edge + (renderedTop - edge - fine) / (1 - fine / fineBand);
                assert.ok(renderedTop <= layout.height + .01, `${profile.art} 屋顶超出渲染范围`);
            }
            }
            assert.deepEqual(footprint, { width: tileWidth * 3, height: tileHeight * 3 });
            assert.equal(fit.width, footprint.width, '原图直接覆盖完整九格宽度');
            assert.equal(fit.x, 0);
            assert.equal(fit.y, -footprint.height / 2, '地脚前角与占地前角一致');
            assert.equal(fit.halfWidth, footprint.width / 2);
            assert.equal(fit.nameY + 15, fit.y - 3, '城名紧贴地脚下方');
            assert.ok(fit.top >= footprint.height / 2, '详情面板避让整个占地和屋顶');
        }
    }
    assert.deepEqual(profiles.filter(p => p.compactFrontGround).map(p => p.art), ['player_city_lv30'],
        '满级阶道修正不能影响其它等级');
    assert.deepEqual(profiles[30].roofAnchors, [46, 608], '必须配对两侧外城角楼，不能误用中层屋顶');
    // 实际10级双拱门城图：草皮前尖与建筑转角不在同一条中轴上。
    const gateCity = profiles[10], gateScale = model.playerCityAppearance(10).height / gateCity.height;
    assert.equal(gateCity.plane.frontX, 715, '中轴应按外墙转角定位，而不是按草皮前尖定位');
    const gatePoint = (x, imageY) => Ground.planePoint(gateCity, x, gateCity.height - imageY, gateScale, 300);
    const frontWall = gatePoint(710, 810), rightWall = gatePoint(1415, 426);
    const wallSlope = (rightWall.y - frontWall.y) / ((rightWall.u - frontWall.u) * 600);
    assert.ok(Math.abs(wallSlope - .5) < .005, `右外墙与占地边缘不平行：${wallSlope}`);
    for (const [x, top, bottom] of [[975, 690, 829], [1043, 670, 795], [1115, 650, 763]]) {
        assert.ok(Math.abs(gatePoint(x, top).y - gatePoint(x, bottom).y - (bottom - top) * gateScale) < .01,
            `双拱门城图门柱 ${x} 被地脚处理压缩`);
    }
    // 回归红框中的门柱：不能仅检验屋顶等高，而忽略地脚带把门洞压扁。
    const maxCity = profiles[30], scale = model.playerCityAppearance(30).height / maxCity.height;
    const projection = Ground.projection(maxCity, scale), smooth = Ground.smooth(maxCity);
    const wallPoint = (x, sourceTopY) => {
        const sourceU = (x - maxCity.left) / (maxCity.right - maxCity.left);
        let low = 0, high = 1;
        for (let i = 0; i < 30; i++) {
            const u = (low + high) / 2;
            if (u + projection.bias * 4 * u * (1 - u) < sourceU) low = u; else high = u;
        }
        const edge = Math.abs((low + high) / 2 - .5) * 300;
        const offset = projection.shear * x + projection.offset;
        const delta = maxCity.ground[x] * scale + offset - edge;
        const band = Math.max(12, Math.abs(delta) * (delta < 0 ? .25 : 2) + 1);
        const slope = 1 - delta / band;
        const source = (maxCity.height - sourceTopY) * scale + offset;
        let y = source < edge + band ? edge + (source - edge - delta) / slope : source;
        const fine = 0;
        const fineBand = Math.max(10.5, Math.abs(fine) * 2 + 1);
        if (y < edge + fineBand) y = edge + (y - edge - fine) / (1 - fine / fineBand);
        return y;
    };
    for (const [x, top, bottom] of [[491, 250, 331], [534, 250, 314], [511, 270, 317]]) {
        assert.ok(Math.abs(wallPoint(x, top) - wallPoint(x, bottom) - (bottom - top) * scale) < .01,
            `满级城门 ${x} 被地脚处理压缩`);
    }
    return { images: profiles.length, tileSizes: sizes.length, opaqueBoundarySamples: samples };
};
