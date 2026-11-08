import { Color, Rect, resources, Size, SpriteFrame, Vec2 } from 'cc';
import { siegeBeat } from './SiegeChoreography';

export { SIEGE_CYCLE } from './SiegeChoreography';
export const SIEGE_FRAME_COUNT = 8;
export const SIEGE_SHEETS = ['siege-assault-infantry-v2', 'siege-commander-v2', 'siege-impact-v2'];
export interface SiegeFrame { image: SpriteFrame; pivot: readonly number[]; scale: number; tint: Color; mirrored?: boolean; }
const sheets = new Map<string, Promise<SpriteFrame[]>>();
let infantry: Promise<SiegeFrame[][]> | null = null;
let commander: Promise<SiegeFrame[][]> | null = null;

/** 一次只预载一张，共用登录后的限流队列；即时使用也复用同一请求。 */
export function preloadSiegeSheet(name: string): Promise<SpriteFrame[]> {
    if (sheets.has(name)) return sheets.get(name);
    const pending = new Promise<SpriteFrame[]>((resolve, reject) => {
        resources.load(`ui/march/${name}/spriteFrame`, SpriteFrame, (error, sheet) => {
            if (error) { reject(error); return; }
            if (!(sheet instanceof SpriteFrame) || !sheet.texture) {
                reject(new Error(`攻城图集无效：${name}`)); return;
            }
            const rows = name === 'siege-impact-v2' ? 4 : name === 'siege-commander-v2' ? 5 : 8;
            const width = sheet.texture.width / 8, height = sheet.texture.height / rows;
            if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
                reject(new Error(`攻城图集尺寸无效：${name}`)); return;
            }
            sheet.addRef();
            const frames: SpriteFrame[] = [];
            for (let row = 0; row < rows; row++) for (let col = 0; col < 8; col++) {
                const frame = new SpriteFrame(); frame.name = `${name}_${row}_${col}`;
                // 内缩半像素防串帧，固定画布避免裁透明边引起抖动。
                frame.reset({ texture: sheet.texture, rect: new Rect(col * width + .5, row * height + .5, width - 1, height - 1),
                    originalSize: new Size(width, height), offset: new Vec2() });
                frame.packable = false; frame.addRef(); frames.push(frame);
            }
            resolve(frames);
        });
    });
    sheets.set(name, pending);
    void pending.catch(() => sheets.delete(name));
    return pending;
}

/** 同一套原画完成举火、投掷、收势；不再交替两套人物或逐帧变色缩放。 */
export function loadSiegeUnit(): Promise<SiegeFrame[][]> {
    if (infantry) return infantry;
    infantry = preloadSiegeSheet('siege-assault-infantry-v2').then(atlas =>
        Array.from({ length: 8 }, (_, row) => Array.from({ length: SIEGE_FRAME_COUNT }, (_, frame) => ({
            image: atlas[row * 8 + frame], pivot: [.53, .025], scale: .88,
            tint: new Color(255, 255, 255, 255),
        }))));
    void infantry.catch(error => { infantry = null; console.warn('[SiegeAnimation]', error); });
    return infantry;
}

export function siegeFrameAt(seconds: number, index = 0): number {
    return siegeBeat(seconds, index).frame;
}

/** 五个基础视角加左右镜像；骑将驻马举枪指挥，不复用步兵的投掷姿势。 */
export function loadSiegeCommander(): Promise<SiegeFrame[][]> {
    if (commander) return commander;
    const rows = [0, 1, 2, 1, 0, 3, 4, 3];
    const mirrored = [false, false, false, true, true, true, false, false];
    commander = preloadSiegeSheet('siege-commander-v2').then(atlas =>
        rows.map((row, direction) => Array.from({ length: SIEGE_FRAME_COUNT }, (_, frame) => ({
            image: atlas[row * SIEGE_FRAME_COUNT + frame], pivot: [.5, .125], scale: 1.12,
            tint: new Color(255, 255, 255, 255), mirrored: mirrored[direction],
        }))));
    void commander.catch(error => { commander = null; console.warn('[SiegeCommander]', error); });
    return commander;
}
