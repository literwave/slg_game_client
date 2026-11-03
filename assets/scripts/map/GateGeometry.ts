import { BRIDGE_SILHOUETTE } from './BridgeSilhouette';

/** 关城的美术与命中共用尺寸；不扩大服务端逻辑通路。 */
export const GATE_ART = 'mountain_pass_citadel';
export const BRIDGE_ART = 'river_pass_citadel';
// 锚点位于驻军内院的通路轴上；两岸美术从左下延伸到右上。
export const BRIDGE_ANCHOR_X = .52;
export const BRIDGE_ANCHOR_Y = .52;
// 将两岸桥路中心连线对齐 2:1 地图轴；长度仍依据真实跨河格数。
export const BRIDGE_HEIGHT_SCALE = 1.02;
export const BRIDGE_ASPECT = 762 / 1536 * BRIDGE_HEIGHT_SCALE;
export const BRIDGE_SPAN_FRACTION = .84;
export interface GateAppearance { crossing?: 'bridge' | 'pass'; axis?: 'x' | 'y'; bridgeSpan?: number; }
// 锚点落在关城内院；四角楼、围墙、营房构成完整关城，道路穿过两座城门。
export const GATE_ANCHOR_X = .50;
export const GATE_ANCHOR_Y = .46;
export const GATE_ASPECT = 805 / 1280;
export function gateWidth(level: number, gate?: GateAppearance): number {
    if (gate?.crossing === 'bridge') return Math.min(16, Math.max(8, gate.bridgeSpan || 10)) * 100 / BRIDGE_SPAN_FRACTION;
    return level >= 8 ? 760 : level >= 6 ? 680 : 600;
}

/** 新地形使用真实通道轴；旧地图保留原朝向以便兼容存量预览。 */
export function gateMirrored(x: number, y: number, mapWidth: number, mapHeight: number, gate?: GateAppearance): boolean {
    if (gate?.axis) return gate.axis === 'x';
    const dx = x - (mapWidth - 1) / 2, dy = y - (mapHeight - 1) / 2;
    return (dx + dy) * (dy - dx) < 0;
}

// 关城围墙、角楼及内院可点击；外围透明地形和延伸土路不算建筑。
// 坐标按完整图片左上原点取比例，与 trim=false 的显示画布一致。
const SILHOUETTE = [[.025,.57],[.045,.40],[.11,.34],[.17,.39],
    [.335,.17],[.34,.07],[.40,.02],[.465,.07],[.465,.15],
    [.61,.24],[.63,.17],[.68,.17],[.735,.25],[.74,.33],
    [.86,.39],[.89,.35],[.955,.41],[.98,.58],[.96,.62],
    [.65,.89],[.63,.95],[.55,.985],[.485,.94],[.48,.88],[.405,.835],
    [.34,.77],[.30,.735],[.15,.665],[.12,.67]];
// 两岸只接管道路和石质桥台，外围花草不扩大关隘点击范围。
// 桥身使用原图透明轮廓，桥墩不会漏点，拱洞仍然透到河面。
const BRIDGE_BANK_STRUCTURES = [
    [[.17,.70],[.26,.64],[.28,.86],[.25,.92],[.21,.86]],
    [[.025,.91],[.05,.94],[.15,.87],[.255,.77],[.23,.735],[.12,.83]],
    [[.83,.11],[.86,.10],[.90,.24],[.89,.35],[.84,.38]],
    [[.83,.23],[.83,.16],[.94,.04],[.97,.035],[.985,.065],[.95,.15],[.87,.30]],
];
function bridgeHit(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= 1 || y < 0 || y >= 1) return false;
    if (!(x >= .26 && x <= .84) && !BRIDGE_BANK_STRUCTURES.some(polygon => polygonHit(x, y, polygon))) return false;
    const shape = BRIDGE_SILHOUETTE, column = Math.floor(x * shape.columns);
    const spans = shape.rows[Math.floor(y * shape.rows.length)];
    for (let i = 0; i < spans.length; i += 2) if (column >= spans[i] && column < spans[i + 1]) return true;
    return false;
}

function polygonHit(x: number, y: number, polygon: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}

export function gateHit(dx: number, dy: number, level: number, mirrored: boolean, gate?: GateAppearance): boolean {
    const bridge = gate?.crossing === 'bridge', width = gateWidth(level, gate);
    const x = dx / width * (mirrored ? -1 : 1) + (bridge ? BRIDGE_ANCHOR_X : GATE_ANCHOR_X);
    const y = 1 - (dy / (width * (bridge ? BRIDGE_ASPECT : GATE_ASPECT)) + (bridge ? BRIDGE_ANCHOR_Y : GATE_ANCHOR_Y));
    return bridge ? bridgeHit(x, y) : polygonHit(x, y, SILHOUETTE);
}

/** 选中标记落在关城基脚四角，避免单格菱形穿过屋顶；不参与逻辑占地。 */
export function gateGroundCorners(level: number, mirrored: boolean, gate?: GateAppearance): number[][] {
    const bridge = gate?.crossing === 'bridge', width = gateWidth(level, gate);
    const height = width * (bridge ? BRIDGE_ASPECT : GATE_ASPECT);
    const points = bridge ? [[.30,.60],[.60,.30],[.79,.51],[.52,.80]] : [[.015,.61],[.40,.20],[.985,.62],[.55,.99]];
    return points.map(([x, y]) => [(x - (bridge ? BRIDGE_ANCHOR_X : GATE_ANCHOR_X)) * width * (mirrored ? -1 : 1),
        (1 - y - (bridge ? BRIDGE_ANCHOR_Y : GATE_ANCHOR_Y)) * height]);
}

/** 基脚与两端引道分别落标，选中整座桥；不画横穿桥面和桥拱的包围框。 */
export function gateSelectionPaths(level: number, mirrored: boolean, gate?: GateAppearance): number[][][] {
    const corners = gateGroundCorners(level, mirrored, gate);
    const paths = [0, 2, 3].map(i => [corners[(i + 3) % 4], corners[i], corners[(i + 1) % 4]]);
    if (gate?.crossing === 'bridge') {
        const width = gateWidth(level, gate), height = width * BRIDGE_ASPECT;
        for (const points of [
            [[.015,.95],[.07,1.005],[.135,1.00]],
            [[.91,-.01],[.97,-.015],[1.015,.045]],
        ]) paths.push(points.map(([x, y]) => [
            (x - BRIDGE_ANCHOR_X) * width * (mirrored ? -1 : 1),
            (1 - y - BRIDGE_ANCHOR_Y) * height,
        ]));
    }
    return paths;
}
