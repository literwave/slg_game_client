import { SYSTEM_CITY_SILHOUETTES } from './SystemCitySilhouettes';
import type { CityGroundCalibration } from './CityFootprint';

/** 原图 UV 到占地中心坐标，X/Y 分别以占地宽/高为单位。 */
export type CityArtMatrix = readonly [number, number, number, number, number, number];
export interface CityArtFit {
    forward: CityArtMatrix; inverse: CityArtMatrix;
    upperForward: CityArtMatrix; upperInverse: CityArtMatrix;
    roof?: { height: number; y: number };
}
// 旧资源保留完整轮廓；新版城基四角直接贴格，只留极窄的采样余量。
export const CITY_ART_FILL = .98;
export const CITY_BASE_FILL = .996;
const fits = new Map<string, CityArtFit>();
export function cityArtPoint(m: CityArtMatrix, x: number, y: number): { x: number; y: number } {
    return { x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] };
}

export function cityArtToFootprint(fit: CityArtFit, u: number, v: number): { x: number; y: number } {
    const lower = cityArtPoint(fit.forward, u, v);
    return lower.y > 0 ? cityArtPoint(fit.upperForward, u, v) : lower;
}

export function cityArtToSource(fit: CityArtFit, x: number, y: number): { x: number; y: number } {
    return cityArtPoint(y > 0 ? fit.upperInverse : fit.inverse, x, y);
}

function inverse(m: CityArtMatrix): CityArtMatrix {
    const [a,b,c,d,e,f] = m, determinant = a * e - b * d;
    return [e / determinant, -b / determinant, (b * f - c * e) / determinant,
        -d / determinant, a / determinant, (c * d - a * f) / determinant];
}

function groundMatrix(ground: CityGroundCalibration, upper: boolean, art: string): CityArtMatrix {
    const cx = (ground.left[0] + ground.right[0]) / 2, cy = (ground.left[1] + ground.right[1]) / 2;
    const ax = ground.right[0] - ground.left[0], ay = ground.right[1] - ground.left[1];
    const tip = upper ? ground.back : ground.front;
    const bx = tip[0] - cx, by = tip[1] - cy, det = ax * by - ay * bx, sign = upper ? -1 : 1;
    if (Math.abs(det) < 1) throw new Error(`城基标定退化：${art}`);
    return [ground.canvasWidth * by / det, -ground.canvasHeight * bx / det, (-cx * by + cy * bx) / det,
        sign * ground.canvasWidth * ay / (2 * det), -sign * ground.canvasHeight * ax / (2 * det),
        sign * (-cx * ay + cy * ax) / (2 * det)];
}

/** 新城基按四角贴格，两半在左右角连线上连续衔接；塔楼不再决定整座城的缩放。 */
export function fitCityArt(art: string, ground?: CityGroundCalibration, anchorY = .5): CityArtFit {
    const cached = fits.get(art);
    if (cached) return cached;
    if (ground?.canvasProjection) {
        const { scale: s, centerX, centerY } = ground.canvasProjection;
        if (![s, centerX, centerY].every(Number.isFinite) || s <= 0) throw new Error(`城池整图标定无效：${art}`);
        const forward: CityArtMatrix = [s, 0, -centerX * s, 0, -s, centerY * s];
        const reverse = inverse(forward), top = Math.max(.5, centerY * s);
        const result: CityArtFit = { forward, inverse: reverse, upperForward: forward, upperInverse: reverse,
            roof: { height: top + .5, y: (top - .5) / 2 } };
        fits.set(art, result); return result;
    }
    if (ground?.back) {
        const forward = groundMatrix(ground, false, art).map(n => n * CITY_BASE_FILL) as unknown as CityArtMatrix;
        const upperForward = groundMatrix(ground, true, art).map(n => n * CITY_BASE_FILL) as unknown as CityArtMatrix;
        const result = { forward, inverse: inverse(forward), upperForward, upperInverse: inverse(upperForward) };
        fits.set(art, result); return result;
    }
    const shape = SYSTEM_CITY_SILHOUETTES[art];
    if (!shape) throw new Error(`城池轮廓缺失：${art}`);
    let base: CityArtMatrix;
    if (ground) {
        base = groundMatrix(ground, false, art);
    } else {
        const height = 2 * shape.height / shape.width;
        base = [1, 0, -.5, 0, -height, height * (1 - anchorY)];
    }
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let row = 0; row < shape.rows.length; row++) for (let column = 0; column < shape.columns; column++) {
        if (!(parseInt(shape.rows[row][column >> 2], 16) & (1 << (column & 3)))) continue;
        // 四角全部计入，不能只取像素中心或墙脚而漏掉楼角、阶道。
        for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
            const p = cityArtPoint(base, (column + dx) / shape.columns, (row + dy) / shape.rows.length);
            const u = p.x - p.y, v = -p.x - p.y;
            minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
    }
    const extent = Math.max(maxU - minU, maxV - minV);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error(`城池轮廓为空：${art}`);
    const scale = CITY_ART_FILL / extent, midU = (minU + maxU) / 2, midV = (minV + maxV) / 2;
    const centerX = (midU - midV) / 2, centerY = -(midU + midV) / 2;
    const forward: CityArtMatrix = [base[0] * scale, base[1] * scale, (base[2] - centerX) * scale,
        base[3] * scale, base[4] * scale, (base[5] - centerY) * scale];
    const reverse = inverse(forward);
    const result = { forward, inverse: reverse, upperForward: forward, upperInverse: reverse };
    fits.set(art, result); return result;
}
