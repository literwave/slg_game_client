import { resources, SpriteFrame } from 'cc';

export const SIDEBAR_ICON_NAMES = ['sidebar-army-v1', 'sidebar-buildings-v1', 'sidebar-markers-v1', 'sidebar-land-v1'];
const STAT_ICON_NAMES = { wounded: 'troop-wounded-v1', speed: 'troop-march-v2', attack: 'troop-attack-v1' };
const MOVE_ICON_NAME = 'sidebar-move-v1';
const BOOKMARK_ICON_NAME = 'sidebar-bookmark-v1';
export type SidebarStatIcon = keyof typeof STAT_ICON_NAMES;

/** 侧栏独立图标。入场加载；重复打开复用已解码的图片，不借用主菜单或资源地图。 */
export default class SidebarIconCache {
    private static frames = new Map<string, SpriteFrame>();
    private static pending: Promise<void> | null = null;

    static frame(index: number): SpriteFrame | null {
        const name = SIDEBAR_ICON_NAMES[index];
        if (!name) return null;
        return this.namedFrame(name);
    }

    static statFrame(kind: SidebarStatIcon): SpriteFrame | null {
        return this.namedFrame(STAT_ICON_NAMES[kind]);
    }

    static moveFrame(): SpriteFrame | null {
        return this.namedFrame(MOVE_ICON_NAME);
    }

    static bookmarkFrame(): SpriteFrame | null {
        return this.namedFrame(BOOKMARK_ICON_NAME);
    }

    private static namedFrame(name: string): SpriteFrame | null {
        const cached = this.frames.get(name);
        if (cached?.isValid) return cached;
        const frame = resources.get(`ui/sidebar/${name}/spriteFrame`, SpriteFrame);
        if (frame?.isValid) { this.frames.set(name, frame); return frame; }
        return null;
    }

    static prepare(): Promise<void> {
        if (this.pending) return this.pending;
        const names = [...SIDEBAR_ICON_NAMES, ...Object.values(STAT_ICON_NAMES), MOVE_ICON_NAME, BOOKMARK_ICON_NAME];
        this.pending = Promise.all(names.map(name => {
            if (this.namedFrame(name)) return Promise.resolve();
            return new Promise<void>((resolve, reject) => resources.load(`ui/sidebar/${name}/spriteFrame`, SpriteFrame, (error, frame) => {
                if (error || !frame) { reject(error || new Error(`侧栏图标缺失：${name}`)); return; }
                this.frames.set(name, frame); resolve();
            }));
        })).then(() => {}).catch(error => { this.pending = null; throw error; });
        return this.pending;
    }
}
