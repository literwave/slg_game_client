import { AnimationClip, Rect, resources, Size, SpriteFrame, Vec2 } from 'cc';

export type MarchUnitKind = 'cavalry' | 'infantry';
export const MARCH_DIRECTIONS = ['r', 'ru', 'u', 'lu', 'l', 'ld', 'd', 'rd'];

export interface MarchAnimationSet {
    clips: AnimationClip[];
    idleFrames: SpriteFrame[];
    /** 占领驻守时的举武器姿势；没有则退回 idleFrames。 */
    guardFrames?: SpriteFrame[];
    mirrored: boolean[];
}

const sets = new Map<MarchUnitKind, Promise<MarchAnimationSet>>();
const sheets = new Map<string, Promise<SpriteFrame[]>>();
// 图集五行分别为右、右上、上、右下、下；左侧方向复用对应镜像。
const DIRECTION_ROWS = [0, 1, 2, 1, 0, 3, 4, 3];
const MIRRORED = [false, false, false, true, true, true, false, false];

/** 固定画布和落脚点，避免逐帧裁透明边导致抖动；所有部队共享帧资源。 */
function loadSheet(path: string, columns: number, rows: number): Promise<SpriteFrame[]> {
    const key = `${path}:${columns}:${rows}`;
    if (sheets.has(key)) return sheets.get(key);
    const pending = new Promise<SpriteFrame[]>((resolve, reject) => {
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
    sheets.set(key, pending);
    return pending;
}

/** 八方向行走与停驻分开：到达时用双脚/四蹄落地的站姿，不冻结行走的第一帧。 */
export function loadMarchAnimations(kind: MarchUnitKind): Promise<MarchAnimationSet> {
    let pending = sets.get(kind);
    if (pending) return pending;
    const sheet = kind === 'cavalry' ? 'commander_march_sheet' : 'guard_march_cycle';
    // 骑将的原斜向过于侧身，单独替换为有纵深透视的前/后三分之四视角。
    // 步兵使用已经补齐收腿、换脚阶段的完整步态图集。
    const diagonal = kind === 'cavalry' ? loadSheet('ui/march/commander_march_diagonal', 7, 2) : Promise.resolve(null);
    // 前斜向重新绘制八帧四蹄交替的步态，不能继续使用前腿始终蜷起的旧六帧。
    const frontWalk = kind === 'cavalry' ? loadSheet('ui/march/commander_march_front_walk', 4, 2) : Promise.resolve(null);
    const sideWalk = kind === 'cavalry' ? loadSheet('ui/march/commander_march_side_walk', 5, 2) : Promise.resolve(null);
    pending = Promise.all([loadSheet(`ui/march/${sheet}`, 7, 5), diagonal, frontWalk, sideWalk])
        .then(([frames, diagonalFrames, frontWalkFrames, sideWalkFrames]) => {
        const directionalFrames = MARCH_DIRECTIONS.map((_, index) => {
            if (diagonalFrames && index % 2) {
                const row = index < 4 ? 0 : 1;
                return diagonalFrames.slice(row * 7, row * 7 + 7);
            }
            const first = DIRECTION_ROWS[index] * 7;
            return frames.slice(first, first + 7);
        });
        const clips = MARCH_DIRECTIONS.map((direction, index) => {
            const walk = sideWalkFrames && (index === 0 || index === 4) ? sideWalkFrames
                : frontWalkFrames && (index === 5 || index === 7) ? frontWalkFrames : directionalFrames[index].slice(0, 6);
            // 骑将与护卫共用 0.75 秒周期；不同帧数、转向切片不会改变整队的步态相位。
            const clip = AnimationClip.createWithSpriteFrames(walk, walk.length / .75);
            clip.name = `${kind}_walk_${direction}`;
            clip.wrapMode = AnimationClip.WrapMode.Loop;
            clip.addRef();
            return clip;
        });
        // 每行最后一格是同一套装备的站姿；画布均为 256²，落脚线统一在距底边 18px。
        return { clips, idleFrames: directionalFrames.map(row => row[6]), mirrored: MIRRORED.slice() };
    }).then((set: MarchAnimationSet) => loadGuardFrames(kind).then(guardFrames => {
        set.guardFrames = guardFrames;
        return set;
    }, () => set));
    sets.set(kind, pending);
    // 同一图集加载失败只报告一次，避免每个队员重复刷屏；不自动重试或覆盖资源。
    void pending.catch(error => console.error('[MarchAnimation]', kind, error));
    return pending;
}

/** 占领中举武器防守姿势；图集 4×4，上两行骑将、下两行步兵，左右方向镜像。 */
function loadGuardFrames(kind: MarchUnitKind): Promise<SpriteFrame[]> {
    return loadSheet('ui/march/formation_idle_sheet', 4, 4).then(frames => {
        const base = kind === 'cavalry' ? 0 : 8;
        // 列约：侧、斜、正、斜；左侧方向走镜像。前半球用第二行。
        const cols = [3, 2, 1, 2, 3, 2, 1, 2];
        const front = [false, false, false, false, false, true, true, true];
        return MARCH_DIRECTIONS.map((_, index) => frames[base + (front[index] ? 4 : 0) + cols[index]]);
    });
}
