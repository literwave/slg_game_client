/** 关城的美术与命中共用尺寸；不扩大服务端逻辑通路。 */
export const GATE_ART = 'mountain_pass_saddle';
// 锚点落在门洞地面；完整图片包含两侧岩壁和门前道路。
export const GATE_ANCHOR_Y = .38;
export const GATE_ASPECT = 608 / 1024;
export function gateWidth(level: number): number { return level >= 8 ? 640 : level >= 6 ? 540 : 460; }

/** 环形山脉切线投影到等距地图，选择城墙朝向。 */
export function gateMirrored(x: number, y: number, mapWidth: number, mapHeight: number): boolean {
    const dx = x - (mapWidth - 1) / 2, dy = y - (mapHeight - 1) / 2;
    return (dx + dy) * (dy - dx) < 0;
}

// 只命中中央关楼与短墙；两侧岩壁和延伸道路不算建筑。
// 坐标按完整图片左上原点取比例，与 trim=false 的显示画布一致。
const SILHOUETTE = [[.345, .32], [.405, .255], [.465, .14], [.60, .20], [.67, .265],
    [.65, .37], [.72, .45], [.695, .565], [.62, .61], [.55, .69], [.45, .63], [.385, .61], [.36, .50]];
export function gateHit(dx: number, dy: number, level: number, mirrored: boolean): boolean {
    const width = gateWidth(level);
    const x = dx / width * (mirrored ? -1 : 1) + .5;
    const y = 1 - (dy / (width * GATE_ASPECT) + GATE_ANCHOR_Y);
    let inside = false;
    for (let i = 0, j = SILHOUETTE.length - 1; i < SILHOUETTE.length; j = i++) {
        const a = SILHOUETTE[i], b = SILHOUETTE[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}
