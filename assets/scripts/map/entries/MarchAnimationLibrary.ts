import { AnimationClip, Rect, resources, Size, SpriteFrame, Vec2 } from 'cc';

export type MarchUnitKind = 'cavalry' | 'infantry';
export const MARCH_DIRECTIONS = ['r', 'ru', 'u', 'lu', 'l', 'ld', 'd', 'rd'];

export interface MarchAnimationSet {
    clips: AnimationClip[];
    idleFrames: SpriteFrame[];
}

const sets = new Map<MarchUnitKind, Promise<MarchAnimationSet>>();
let idleSheet: Promise<SpriteFrame[]> | undefined;

/** 固定画布和落脚点，避免逐帧裁透明边导致抖动；所有部队共享帧资源。 */
function loadSheet(path: string, columns: number, rows: number): Promise<SpriteFrame[]> {
    return new Promise((resolve, reject) => {
        resources.load(`${path}/spriteFrame`, SpriteFrame, (error, sheet) => {
            if (error) { reject(error); return; }
            if (!(sheet instanceof SpriteFrame) || !sheet.texture) {
                reject(new Error(`行军图集无效: ${path}`)); return;
            }
            const texture = sheet.texture, width = texture.width / columns, height = texture.height / rows;
            if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
                reject(new Error(`行军图集必须为 ${columns} 列 ${rows} 行: ${path}`)); return;
            }
            sheet.addRef();
            const frames: SpriteFrame[] = [];
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < columns; col++) {
                    const frame = new SpriteFrame();
                    frame.name = `${path.substring(path.lastIndexOf('/') + 1)}_${row}_${col}`;
                    frame.reset({ texture, rect: new Rect(col * width, row * height, width, height),
                        originalSize: new Size(width, height), offset: new Vec2(0, 0) });
                    frame.packable = false;
                    frame.addRef();
                    frames.push(frame);
                }
            }
            resolve(frames);
        });
    });
}

/** 八方向行走与停驻分开：到达时用双脚/四蹄落地的站姿，不冻结行走的第一帧。 */
export function loadMarchAnimations(kind: MarchUnitKind): Promise<MarchAnimationSet> {
    let pending = sets.get(kind);
    if (pending) return pending;
    if (!idleSheet) idleSheet = loadSheet('ui/march/formation_idle_sheet', 4, 4);
    pending = Promise.all([loadSheet(`ui/march/${kind}_walk_sheet`, 6, 8), idleSheet]).then(([frames, standing]) => {
        const clips = MARCH_DIRECTIONS.map((direction, row) => {
            const clip = AnimationClip.createWithSpriteFrames(frames.slice(row * 6, row * 6 + 6), 10);
            clip.name = `${kind}_walk_${direction}`;
            clip.wrapMode = AnimationClip.WrapMode.Loop;
            clip.addRef();
            return clip;
        });
        // 停驻图集前两行骑兵，后两行步兵；各自顺序与 MARCH_DIRECTIONS 一致。
        const first = kind === 'cavalry' ? 0 : 8;
        return { clips, idleFrames: standing.slice(first, first + 8) };
    });
    sets.set(kind, pending);
    // 同一图集加载失败只报告一次，避免每个队员重复刷屏；不自动重试或覆盖资源。
    void pending.catch(error => console.error('[MarchAnimation]', kind, error));
    return pending;
}
