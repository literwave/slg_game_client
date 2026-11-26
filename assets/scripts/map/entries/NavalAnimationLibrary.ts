import { Rect, resources, Size, SpriteFrame, Vec2 } from 'cc';

export interface NavalSpriteSet {
    /** 八方向战船贴图，索引与 MarchAnimationLibrary 一致：r, ru, u, lu, l, ld, d, rd。 */
    frames: SpriteFrame[];
    mirrored: boolean[];
}

// 5×1 战船图集：右(0)、右上(1)、上(2)、右下(3)、下(4)；左侧三个方向镜像复用。
const DIRECTION_COLUMNS = [0, 1, 2, 1, 0, 3, 4, 3];
const MIRRORED = [false, false, false, true, true, true, false, false];
const SHEET_PATH = 'ui/march/naval_warship_v1';

let pending: Promise<NavalSpriteSet> | null = null;

export function loadNavalSprites(): Promise<NavalSpriteSet> {
    if (pending) return pending;
    pending = new Promise<NavalSpriteSet>((resolve, reject) => {
        resources.load(`${SHEET_PATH}/spriteFrame`, SpriteFrame, (error, sheet) => {
            if (error || !(sheet instanceof SpriteFrame) || !sheet.texture) {
                reject(error || new Error(`战船图集无效: ${SHEET_PATH}`));
                return;
            }
            const texture = sheet.texture, columns = 5;
            const width = texture.width / columns, height = texture.height;
            if (!Number.isInteger(width) || width < 1 || height < 1) {
                reject(new Error(`战船图集必须为 5 列 1 行: ${SHEET_PATH}`));
                return;
            }
            sheet.addRef();
            const cols: SpriteFrame[] = [];
            for (let col = 0; col < columns; col++) {
                const frame = new SpriteFrame();
                frame.name = `naval_warship_${col}`;
                frame.reset({
                    texture,
                    rect: new Rect(col * width, 0, width, height),
                    originalSize: new Size(width, height),
                    offset: new Vec2(0, 0),
                });
                frame.packable = false;
                frame.addRef();
                cols.push(frame);
            }
            resolve({
                frames: DIRECTION_COLUMNS.map(col => cols[col]),
                mirrored: MIRRORED.slice(),
            });
        });
    });
    void pending.catch(error => {
        pending = null;
        console.error('[NavalAnimation]', error);
    });
    return pending;
}
