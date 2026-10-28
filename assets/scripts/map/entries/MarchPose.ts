/** 和回放一样将动作采样与显示帧率分离。保留原方向立绘，叠加连续重心动作。
 * 30 个姿态不是复制 30 张图片；脚步图集负责换腿，姿态负责步间承重/起伏和收步。
 */
export const MARCH_POSE_SAMPLES = 30;
export const MARCH_CYCLE = .75;
export interface MarchPose { x: number; y: number; angle: number; stretch: number; }
type Kind = 'cavalry' | 'infantry';
const poses: Record<Kind, MarchPose[]> = { cavalry: [], infantry: [] };
for (const kind of ['cavalry', 'infantry'] as Kind[]) {
    for (let i = 0; i < MARCH_POSE_SAMPLES; i++) {
        const a = i / MARCH_POSE_SAMPLES * Math.PI * 2, mounted = kind === 'cavalry';
        poses[kind].push({ x: Math.sin(a) * (mounted ? .22 : .32),
            y: (1 - Math.cos(a * 2)) * (mounted ? .46 : .30),
            angle: Math.sin(a - .35) * (mounted ? .45 : .65),
            stretch: 1 + Math.cos(a * 2) * (mounted ? .004 : .006) });
    }
}
/** 循环末帧也插值回首帧；输出可复用，避免逐人逐帧分配对象。 */
export function sampleMarchPose(kind: Kind, seconds: number, weight: number, out: MarchPose): void {
    if (weight <= .0001) { out.x = out.y = out.angle = 0; out.stretch = 1; return; }
    const frame = ((seconds / MARCH_CYCLE % 1) + 1) % 1 * MARCH_POSE_SAMPLES;
    const index = Math.floor(frame), mix = frame - index;
    const a = poses[kind][index], b = poses[kind][(index + 1) % MARCH_POSE_SAMPLES];
    const w = Math.max(0, Math.min(1, weight));
    out.x = (a.x + (b.x - a.x) * mix) * w;
    out.y = (a.y + (b.y - a.y) * mix) * w;
    out.angle = (a.angle + (b.angle - a.angle) * mix) * w;
    out.stretch = 1 + (a.stretch + (b.stretch - a.stretch) * mix - 1) * w;
}
