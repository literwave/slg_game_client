import type { CityArtMatrix } from './CityArtFit';

export interface PlayerCityProfile {
    art: string; width: number; height: number; left: number; right: number;
    ground: number[]; ceiling: number[];
    plane?: { frontX: number };
    roofAnchors?: readonly [number, number];
    /** 贴格重绘资源的透明轮廓包围盒及防越界缩放。 */
    tileBounds?: { left: number; right: number; top: number; bottom: number; scale: number; centerX?: number; centerY?: number; canvasAligned?: boolean; groundAligned?: boolean };
    gateX?: number;
}
export interface PlayerCityFit { forward: CityArtMatrix; inverse: CityArtMatrix; roof?: { height: number; y: number }; }
const FILL = .992;

/** 整幅原画共用线性投影；新图地基贴格，屋顶单独获得向上的绘制空间。 */
export function fitPlayerCityArt(profile: PlayerCityProfile): PlayerCityFit {
    const p = profile, span = p.right - p.left;
    if (span <= 0 || p.ground.length !== p.width || p.ceiling.length !== p.width) throw new Error(`主城轮廓不完整：${p.art}`);
    if (p.tileBounds) {
        const b = p.tileBounds, w = b.right - b.left, h = b.bottom - b.top;
        const centerX = b.centerX ?? .5, centerY = b.centerY ?? .5;
        if (![b.left,b.right,b.top,b.bottom,b.scale,centerX,centerY].every(Number.isFinite) || w <= 0 || h <= 0 || b.scale <= 0)
            throw new Error(`主城贴格标定无效：${p.art}`);
        // 新图按 2:1 地格投影绘制，以整张画布统一缩放，不能按包围盒拉伸。
        if (b.canvasAligned) {
            const s = b.scale;
            const top = Math.max(.5, centerY * s);
            return { forward: [s, 0, -centerX * s, 0, -s, centerY * s],
                inverse: [1 / s, 0, centerX, 0, -1 / s, centerY],
                ...(b.groundAligned ? { roof: { height: top + .5, y: (top - .5) / 2 } } : {}) };
        }
        const forward: CityArtMatrix = [p.width / w * b.scale, 0, -(b.left / w + centerX) * b.scale,
            0, -p.height / h * b.scale, (b.top / h + centerY) * b.scale];
        const [a,,c,,e,f] = forward;
        return { forward, inverse: [1 / a, 0, -c / a, 0, 1 / e, -f / e] };
    }
    const peak = (from: number, to: number): readonly [number, number] => {
        let result: readonly [number, number] = [p.left, 0];
        for (let x = Math.ceil(p.left + span * from); x <= p.left + span * to; x++) {
            if (p.ceiling[x] > result[1]) result = [x, p.ceiling[x]];
        }
        return result;
    };
    const left = p.roofAnchors ? [p.roofAnchors[0], p.ceiling[p.roofAnchors[0]]] : peak(.04, .16);
    const right = p.roofAnchors ? [p.roofAnchors[1], p.ceiling[p.roofAnchors[1]]] : peak(.84, .96);
    const tilt = (left[1] - right[1]) / (right[0] - left[0]);
    let front = p.plane?.frontX;
    if (front === undefined) {
        let lowest = Infinity;
        for (let x = Math.ceil(p.left + span * .3); x <= p.left + span * .65; x++) {
            let sum = 0;
            for (let dx = -16; dx <= 16; dx++) sum += p.ground[Math.max(p.left, Math.min(p.right, x + dx))];
            if (sum < lowest) { lowest = sum; front = x; }
        }
    }
    const frontY = p.ground[Math.round(front)] + tilt * front;
    const depth = (p.ground[p.left] + tilt * p.left + p.ground[p.right] + tilt * p.right) / 2 - frontY;
    if (!Number.isFinite(depth) || depth <= 0) throw new Error(`主城投影退化：${p.art}`);
    // 在占地宽/高的归一化坐标中，左右地脚到前角的高差为半格。
    const yScale = span / (2 * depth);
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (let x = p.left; x <= p.right; x++) for (const y of [p.ground[x], p.ceiling[x]]) {
        const px = (x - p.left) / span, py = (y + tilt * x) * yScale / span;
        minA = Math.min(minA, px + py); maxA = Math.max(maxA, px + py);
        minB = Math.min(minB, px - py); maxB = Math.max(maxB, px - py);
    }
    // 以两条格子轴包住墙、屋檐、门前阶道；不再只对齐前墙而放任后墙伸出。
    const scale = FILL / Math.max(maxA - minA, maxB - minB);
    const cx = (minA + maxA + minB + maxB) / 4, cy = (minA + maxA - minB - maxB) / 4;
    const forward: CityArtMatrix = [p.width / span * scale, 0, (-p.left / span - cx) * scale,
        tilt * p.width * yScale / span * scale, -p.height * yScale / span * scale,
        (p.height * yScale / span - cy) * scale];
    const [a,b,c,d,e,f] = forward, determinant = a * e - b * d;
    const inverse: CityArtMatrix = [e / determinant, -b / determinant, (b * f - c * e) / determinant,
        -d / determinant, a / determinant, (c * d - a * f) / determinant];
    return { forward, inverse };
}
