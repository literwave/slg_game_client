import { BRIDGE_SILHOUETTE } from './BridgeSilhouette';
import { groundArtScaleY } from './MapProjection';
import type { CityArtLayout } from './CityFootprint';

/** 山口美术、选区和入口共用 5×7 整格尺寸（通路深 5 格 × 跨山口宽 7 格）；河心水寨保持独立水寨体量。 */
export const GATE_ART = 'mountain-pass-5x7-v10';
export const GATE_ART_SHA256 = 'd789e856c157f81d19b839d4dc7846188cf8057021322dd18448a8cfec6a651a';
export const BRIDGE_ART = 'river-pass-waterfort-v10';
// 锚点位于河心独立水寨中心；两岸无连接桥，部队涉水自动换乘战船并列阵水战攻寨。
export const BRIDGE_ANCHOR_X = .50;
export const BRIDGE_ANCHOR_Y = .49;
// 原画对齐 2:1 制作基准，再由 gateHeight 投影到当前格子。
export const BRIDGE_HEIGHT_SCALE = .96;
export const BRIDGE_ASPECT = 853 / 1280 * BRIDGE_HEIGHT_SCALE;
// 独立河心水寨采用统一宏伟体量（约 4.8 格宽），与山口雄关协调并为周边水战战船留出河面。
export const BRIDGE_WIDTH_TILES = 4.8;
export const BRIDGE_SPAN_FRACTION = 1;
export interface GateAppearance {
    crossing?: 'bridge' | 'pass';
    axis?: 'x' | 'y';
    bridgeSpan?: number;
    footprintRadius?: number;
    footprintWidthRadius?: number;
}
// 锚点落在 5×7 雄关中轴校场；7 格宽前后城墙与 5 格深两翼崖壁构成完整大关城。
export const GATE_ANCHOR_X = .50;
export const GATE_ANCHOR_Y = .44;
/** 5×7 雄关原画地面菱形的纵向投影校正，四角敌台墙脚精确对齐 5×7 占地。 */
export const GATE_HEIGHT_SCALE = .934;
export const GATE_ASPECT = 1024 / 1536 * GATE_HEIGHT_SCALE;
export const GATE_FOOTPRINT_RADIUS = 2;
export const GATE_FOOTPRINT_WIDTH_RADIUS = 3;
export const GATE_DEPTH_TILES = GATE_FOOTPRINT_RADIUS * 2 + 1;
export const GATE_SPAN_TILES = GATE_FOOTPRINT_WIDTH_RADIUS * 2 + 1;
/** 1536px 画布内 5×7 地面菱形占 1454px（对应 6.0*tileWidth），整图渲染宽度为 6.34*tileWidth。 */
export const GATE_WIDTH_TILES = 6.34;
/** 所有山口关隘统一 5×7，等级影响守军，不额外扩大屋顶去覆盖邻地。 */
export function gateArtLayout(level: number, gate?: GateAppearance, tileWidth = 200, tileHeight = tileWidth / 2): CityArtLayout {
    const forward = [1,0,-.5,0,-1,1-GATE_ANCHOR_Y] as const;
    const inverse = [1,0,.5,0,-1,1-GATE_ANCHOR_Y] as const;
    return { width: tileWidth * GATE_WIDTH_TILES, height: gateHeight(level, gate, tileWidth, tileHeight), anchorX: .5, anchorY: GATE_ANCHOR_Y,
        fit: { forward, inverse, upperForward: forward, upperInverse: inverse } };
}
export function gateWidth(level: number, gate?: GateAppearance, tileWidth = 200): number {
    if (gate?.crossing === 'bridge') return tileWidth * BRIDGE_WIDTH_TILES;
    return tileWidth * GATE_WIDTH_TILES;
}

export function gateHeight(level: number, gate?: GateAppearance, tileWidth = 200, tileHeight = tileWidth / 2): number {
    if (gate?.crossing !== 'bridge') return tileWidth * GATE_WIDTH_TILES * GATE_ASPECT * groundArtScaleY(tileWidth, tileHeight);
    return gateWidth(level, gate, tileWidth) * (gate?.crossing === 'bridge' ? BRIDGE_ASPECT : GATE_ASPECT)
        * groundArtScaleY(tileWidth, tileHeight);
}

/** 新地形使用真实通道轴；旧地图保留原朝向以便兼容存量预览。 */
export function gateMirrored(x: number, y: number, mapWidth: number, mapHeight: number, gate?: GateAppearance): boolean {
    if (gate?.axis) return gate.axis === 'x';
    const dx = x - (mapWidth - 1) / 2, dy = y - (mapHeight - 1) / 2;
    return (dx + dy) * (dy - dx) < 0;
}

// 桥梁继续使用完整画布的 Alpha 轮廓，拱洞和已去除的引道可透点。
function bridgeHit(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= 1 || y < 0 || y >= 1) return false;
    const shape = BRIDGE_SILHOUETTE, column = Math.floor(x * shape.columns);
    const spans = shape.rows[Math.floor(y * shape.rows.length)];
    for (let i = 0; i < spans.length; i += 2) if (column >= spans[i] && column < spans[i + 1]) return true;
    return false;
}

export function gateHit(dx: number, dy: number, level: number, mirrored: boolean, gate?: GateAppearance,
    tileWidth = 200, tileHeight = tileWidth / 2): boolean {
    if (gate?.crossing !== 'bridge') {
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
        const hu = (gate?.footprintRadius ?? GATE_FOOTPRINT_RADIUS) + .5;
        const hv = (gate?.footprintWidthRadius ?? GATE_FOOTPRINT_WIDTH_RADIUS) + .5;
        const ux = dx / tileWidth, uy = dy / tileHeight;
        const s = mirrored ? -1 : 1;
        const u = -s * ux - uy;
        const v = s * ux - uy;
        return Math.abs(u) < hu - .01 && Math.abs(v) < hv - .01;
    }
    const width = gateWidth(level, gate, tileWidth);
    const x = dx / width * (mirrored ? -1 : 1) + BRIDGE_ANCHOR_X;
    const y = 1 - (dy / gateHeight(level, gate, tileWidth, tileHeight) + BRIDGE_ANCHOR_Y);
    return bridgeHit(x, y);
}

/** 选中标记落在关城基脚四角，精确对齐 5×7 矩形菱形边界；不参与逻辑占地。 */
export function gateGroundCorners(level: number, mirrored: boolean, gate?: GateAppearance,
    tileWidth = 200, tileHeight = tileWidth / 2): number[][] {
    if (gate?.crossing !== 'bridge') {
        const hu = (gate?.footprintRadius ?? GATE_FOOTPRINT_RADIUS) + .5;
        const hv = (gate?.footprintWidthRadius ?? GATE_FOOTPRINT_WIDTH_RADIUS) + .5;
        const halfSum = (hu + hv) * .5, halfDiff = (hv - hu) * .5;
        const s = mirrored ? -1 : 1;
        return [
            [-halfSum * tileWidth, s * halfDiff * tileHeight],
            [-s * halfDiff * tileWidth, halfSum * tileHeight],
            [halfSum * tileWidth, -s * halfDiff * tileHeight],
            [s * halfDiff * tileWidth, -halfSum * tileHeight],
        ];
    }
    const width = gateWidth(level, gate, tileWidth);
    const height = gateHeight(level, gate, tileWidth, tileHeight);
    const points = [[.12,.60],[.51,.18],[.88,.58],[.50,.91]];
    return points.map(([x, y]) => [(x - BRIDGE_ANCHOR_X) * width * (mirrored ? -1 : 1),
        (1 - y - BRIDGE_ANCHOR_Y) * height]);
}

/** 山口归属线与 5×7 整格边界重合，不圈进城墙外的可走地。 */
export function gateGroundOutline(level: number, mirrored: boolean, gate?: GateAppearance,
    tileWidth = 200, tileHeight = tileWidth / 2): number[][] {
    return gateGroundCorners(level, mirrored, gate, tileWidth, tileHeight);
}

/** 选区角标贴合关隘或水寨基脚四角，不横穿建筑本体。 */
export function gateSelectionPaths(level: number, mirrored: boolean, gate?: GateAppearance,
    tileWidth = 200, tileHeight = tileWidth / 2): number[][][] {
    const corners = gateGroundCorners(level, mirrored, gate, tileWidth, tileHeight);
    if (gate?.crossing !== 'bridge') {
        const outline = gateGroundOutline(level, mirrored, gate, tileWidth, tileHeight);
        const bottom = Math.min(...outline.map(p => p[1]));
        // 沿基脚近邻落角标，避免长直线又跨过门槛两边的透明草地。
        return [0, 2, outline.findIndex(p => p[1] === bottom)].map(i =>
            [outline[(i + outline.length - 1) % outline.length], outline[i], outline[(i + 1) % outline.length]]);
    }
    return [0, 2, 3].map(i => [corners[(i + 3) % 4], corners[i], corners[(i + 1) % 4]]);
}
