import { resources, SpriteFrame } from 'cc';
import { itemIconPath } from '../common/ItemPresentation';

/** 物品图在进场加载页解码并保留，背包重开、分类和详情共用同一张图。 */
export default class InventoryIconCache {
    private static frames = new Map<string, SpriteFrame>();
    private static pending = new Map<string, Promise<SpriteFrame | null>>();

    public static get(itemId: number): SpriteFrame | null {
        const path = itemIconPath(itemId);
        if (!path) return null;
        const retained = this.frames.get(path);
        if (retained?.isValid) return retained;
        const frame = resources.get(path, SpriteFrame);
        if (!(frame instanceof SpriteFrame) || !frame.isValid) return null;
        frame.addRef();
        this.frames.set(path, frame);
        return frame;
    }

    public static isReady(itemId: number): boolean {
        // 没有配置图片的未知物品固定使用文字图标，不发起无效资源请求。
        return !itemIconPath(itemId) || !!this.get(itemId);
    }

    public static load(itemId: number): Promise<SpriteFrame | null> {
        const cached = this.get(itemId);
        if (cached) return Promise.resolve(cached);
        const path = itemIconPath(itemId);
        if (!path) return Promise.resolve(null);
        const pending = this.pending.get(path);
        if (pending) return pending;
        const promise = new Promise<SpriteFrame | null>(resolve => {
            let settled = false;
            const finish = (frame: SpriteFrame | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(frame);
            };
            const timer = setTimeout(() => finish(null), 8000);
            try {
                resources.load(path, SpriteFrame, (error, frame) => {
                    if (settled) return;
                    if (error || !(frame instanceof SpriteFrame) || !frame.isValid) {
                        finish(null);
                        return;
                    }
                    if (!this.frames.get(path)?.isValid) {
                        frame.addRef();
                        this.frames.set(path, frame);
                    }
                    finish(frame);
                });
            } catch {
                finish(null);
            }
        });
        this.pending.set(path, promise);
        promise.then(() => { if (this.pending.get(path) === promise) this.pending.delete(path); });
        return promise;
    }

    public static async prepare(itemIds: number[], isCurrent: () => boolean = () => true): Promise<void> {
        const ids = [...new Map(itemIds.map(id => [itemIconPath(id), id])).values()];
        let cursor = 0, failed = false;
        const worker = async () => {
            while (!failed && isCurrent() && cursor < ids.length) {
                const id = ids[cursor++];
                if (!itemIconPath(id)) continue;
                const frame = await this.load(id);
                if (!isCurrent()) return;
                if (!frame) {
                    failed = true;
                    throw new Error(`背包图标未就绪: ${id}`);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    }
}
