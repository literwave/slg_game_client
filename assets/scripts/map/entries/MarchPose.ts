/** 步兵的轻微重心变化独立于显示帧率；马匹的承重动作由原画完成。 */
export const MARCH_POSE_SAMPLES = 30;
export const MARCH_CYCLE = .75;
/** 骑马采用完整四拍步行，不再和步兵强制使用相同的落脚频率。 */
export const CAVALRY_WALK_CYCLE = .96;
export interface MarchPose { x: number; y: number; angle: number; stretch: number; }

/** 常规行军保持原步频；回城、调动等快行军统一为跑步节奏。
 * 按实际路线速度取值，AOI 中的其他玩家也适用，不依赖仅本人可见的命令类型。
 * 只加快动作时钟，不放大身体起伏或改变人物透明度，避免跑动时抖动、闪烁。
 */
export function marchGaitRate(cellsPerSecond = 0): number {
    const speed = Number.isFinite(cellsPerSecond) ? cellsPerSecond : 0;
    return 1 + .4 * Math.min(1, Math.max(0, (speed - .6) / .4));
}
type Kind = 'cavalry' | 'infantry';
const poses: MarchPose[] = [];
for (let i = 0; i < MARCH_POSE_SAMPLES; i++) {
    const a = i / MARCH_POSE_SAMPLES * Math.PI * 2;
    poses.push({ x: Math.sin(a) * .32, y: (1 - Math.cos(a * 2)) * .30,
        angle: Math.sin(a - .35) * .65, stretch: 1 + Math.cos(a * 2) * .006 });
}
/** 循环末帧也插值回首帧；输出可复用，避免逐人逐帧分配对象。 */
export function sampleMarchPose(kind: Kind, seconds: number, weight: number, out: MarchPose): void {
    // 马的承重、头颈起伏已画进动作，叠加整图扭转、弹跳或压缩会让支撑蹄滑动。
    if (kind === 'cavalry' || weight <= .0001) { out.x = out.y = out.angle = 0; out.stretch = 1; return; }
    const frame = ((seconds / MARCH_CYCLE % 1) + 1) % 1 * MARCH_POSE_SAMPLES;
    const index = Math.floor(frame), mix = frame - index;
    const a = poses[index], b = poses[(index + 1) % MARCH_POSE_SAMPLES];
    const w = Math.max(0, Math.min(1, weight));
    out.x = (a.x + (b.x - a.x) * mix) * w;
    out.y = (a.y + (b.y - a.y) * mix) * w;
    out.angle = (a.angle + (b.angle - a.angle) * mix) * w;
    out.stretch = 1 + (a.stretch + (b.stretch - a.stretch) * mix - 1) * w;
}
