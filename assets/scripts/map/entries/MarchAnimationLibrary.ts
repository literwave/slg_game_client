import { AnimationClip, Rect, resources, Size, SpriteFrame, Vec2 } from 'cc';
import { CAVALRY_WALK_CYCLE, MARCH_CYCLE } from './MarchPose';

export type MarchUnitKind = 'cavalry' | 'infantry';
export const MARCH_DIRECTIONS = ['r', 'ru', 'u', 'lu', 'l', 'ld', 'd', 'rd'];

export interface MarchAnimationSet {
    clips: AnimationClip[];
    /** 回放按自己的时间轴采样，与大地图共用图集而不启动独立动画时钟。 */
    walkFrames: SpriteFrame[][];
    idleFrames: SpriteFrame[];
    /** 占领驻守姿势：步兵半跪举盾持枪，骑将留在中央警戒。 */
    guardFrames?: SpriteFrame[];
    mirrored: boolean[];
    /** 骑将补充陡斜视角；停驻、驻守、攻城仍保留原八方向索引。 */
    walkViews?: MarchWalkView[];
}

export interface MarchWalkView {
    clip: AnimationClip;
    frames: SpriteFrame[];
    angle: number;
    mirrored: boolean;
}

/** 按投影后的真实行进角选立绘；边界保留 3° 余量，避免转弯时来回跳视角。 */
export function selectMarchWalkView(views: MarchWalkView[], angle: number, previous?: MarchWalkView): MarchWalkView {
    const distance = (view: MarchWalkView) => Math.abs(Math.atan2(Math.sin(angle - view.angle), Math.cos(angle - view.angle)));
    let nearest = views[0];
    for (const view of views) if (distance(view) < distance(nearest)) nearest = view;
    return previous && views.indexOf(previous) >= 0 && distance(previous) <= distance(nearest) + Math.PI / 30
        ? previous : nearest;
}

const sets = new Map<MarchUnitKind, Promise<MarchAnimationSet>>();
const sheets = new Map<string, Promise<SpriteFrame[]>>();
// 前 60 格依次存放右、右上、上、右下、下，每个朝向 12 帧；左侧方向镜像。
const DIRECTION_ROWS = [0, 1, 2, 1, 0, 3, 4, 3];
const MIRRORED = [false, false, false, true, true, true, false, false];
const WALK_FRAME_COUNT = 12;
const IDLE_START = WALK_FRAME_COUNT * 5;

/** 固定画布和落脚点，避免逐帧裁透明边导致抖动；所有部队共享帧资源。 */
function loadSheet(path: string, columns: number, rows: number, canvasScale = 1, offsetY = 0): Promise<SpriteFrame[]> {
    const key = `${path}:${columns}:${rows}:${canvasScale}:${offsetY}`;
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
            // 原画有方格和竖格两种版式；置于同一个正方形画布，不能把正面马横向拉宽。
            const canvas = Math.round(Math.max(width, height) * canvasScale);
            const inset = canvasScale > 1 ? .5 : 0;
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < columns; col++) {
                    const frame = new SpriteFrame();
                    frame.name = `${path.substring(path.lastIndexOf('/') + 1)}_${row}_${col}`;
                    frame.reset({ texture, rect: new Rect(col * width + inset, row * height + inset,
                        width - inset * 2, height - inset * 2),
                        originalSize: canvasScale > 1 ? new Size(canvas, canvas) : new Size(width, height),
                        offset: new Vec2(0, offsetY) });
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
    pending = (kind === 'cavalry' ? loadCavalryWalk() : loadInfantryWalk())
        .then(set => loadGuardFrames(kind).then(guardFrames => {
            set.guardFrames = guardFrames;
            return set;
        }, () => set));
    sets.set(kind, pending);
    // 同一图集加载失败只报告一次，避免每个队员重复刷屏；不自动重试或覆盖资源。
    void pending.catch(error => console.error('[MarchAnimation]', kind, error));
    return pending;
}

function createWalkClip(kind: MarchUnitKind, direction: string, frames: SpriteFrame[], cycle: number): AnimationClip {
    const clip = AnimationClip.createWithSpriteFrames(frames, frames.length / cycle);
    clip.name = `${kind}_walk_${direction}`;
    clip.wrapMode = AnimationClip.WrapMode.Loop; clip.addRef();
    return clip;
}

async function loadInfantryWalk(): Promise<MarchAnimationSet> {
    const frames = await loadSheet('ui/march/guard_march_walk12', 10, 7);
    const walkFrames = DIRECTION_ROWS.map(row => frames.slice(row * WALK_FRAME_COUNT, (row + 1) * WALK_FRAME_COUNT));
    return { walkFrames, mirrored: MIRRORED.slice(),
        clips: MARCH_DIRECTIONS.map((direction, i) => createWalkClip('infantry', direction, walkFrames[i], MARCH_CYCLE)),
        idleFrames: DIRECTION_ROWS.map(row => frames[IDLE_START + row]) };
}

async function loadCavalryWalk(): Promise<MarchAnimationSet> {
    const [primary, axial, idle] = await Promise.all([
        loadSheet('ui/march/commander_walk_grounded_primary_v6', 6, 6, 1.11, -4),
        loadSheet('ui/march/commander_walk_grounded_axial_v6', 6, 8, 1.04),
        loadSheet('ui/march/commander_idle_v6', 5, 1),
    ]);
    // Twelve chronological poses per view, no interleaving unrelated takes or hoof patches.
    const directions = [primary.slice(0, 12), primary.slice(12, 24), axial.slice(12, 24),
        primary.slice(24, 36), axial.slice(0, 12)];
    const walkFrames = DIRECTION_ROWS.map(row => directions[row]);
    const clips = MARCH_DIRECTIONS.map((direction, i) =>
        createWalkClip('cavalry', direction, walkFrames[i], CAVALRY_WALK_CYCLE));
    const set: MarchAnimationSet = { clips, walkFrames, mirrored: MIRRORED.slice(),
        idleFrames: DIRECTION_ROWS.map(row => idle[row]) };
    const diagonal = Math.atan(.5), steep = Math.atan(2), pi = Math.PI;
    const angles = [0, diagonal, pi / 2, pi - diagonal, pi, pi + diagonal, pi * 1.5, -diagonal];
    set.walkViews = clips.map((clip, i) => ({ clip, frames: walkFrames[i], angle: angles[i], mirrored: MIRRORED[i] }));
    for (const [name, start, angle, mirrored] of [
        ['steep_ru', 24, steep, false], ['steep_lu', 24, pi - steep, true],
        ['steep_ld', 36, pi + steep, true], ['steep_rd', 36, -steep, false],
    ] as [string, number, number, boolean][]) {
        const frames = axial.slice(start, start + WALK_FRAME_COUNT);
        set.walkViews.push({ clip: createWalkClip('cavalry', name, frames, CAVALRY_WALK_CYCLE), frames, angle, mirrored });
    }
    return set;
}

/** 驻守与行军图集分离，半跪姿势保持相同的身体比例和落脚点。 */
function loadGuardFrames(kind: MarchUnitKind): Promise<SpriteFrame[]> {
    if (kind === 'infantry') {
        // 3×2：右、右后、背 / 右前、正、左前。左侧沿用行军的镜像规则。
        return loadSheet('ui/march/guard_defend_sheet', 3, 2).then(frames =>
            [0, 1, 2, 1, 0, 3, 4, 3].map(index => frames[index]));
    }
    return loadSheet('ui/march/formation_idle_sheet', 4, 4).then(frames => {
        // 骑将位于旧图集上两行：右、右后、背、左后、左、左前、正、右前。
        // 与行走共用镜像规则，左侧必须选择对应的右侧原帧再翻转。
        const indices = [0, 1, 2, 1, 0, 7, 6, 7];
        return indices.map(index => frames[index]);
    });
}
