import { resources, SpriteFrame } from 'cc';

export const CHAT_CHANNEL_ART = ['ui/chat/channel_world/spriteFrame', 'ui/chat/channel_alliance/spriteFrame', 'ui/chat/channel_private/spriteFrame'];

/** 三枚常驻导航图标在进图阶段完整加载并持有引用，关窗时不释放。 */
export default class ChatIconCache {
    private static frames = new Map<string, SpriteFrame>();
    private static pending = new Map<string, Promise<SpriteFrame | null>>();

    public static get(path: string): SpriteFrame | null {
        const retained = this.frames.get(path);
        if (retained?.isValid) return retained;
        this.frames.delete(path);
        const frame = resources.get(path, SpriteFrame);
        if (!(frame instanceof SpriteFrame) || !frame.isValid) return null;
        frame.addRef();
        this.frames.set(path, frame);
        return frame;
    }

    public static load(path: string): Promise<SpriteFrame | null> {
        const cached = this.get(path);
        if (cached) return Promise.resolve(cached);
        const pending = this.pending.get(path);
        if (pending) return pending;
        const request = new Promise<SpriteFrame | null>(resolve => {
            let settled = false;
            const finish = (frame: SpriteFrame | null) => {
                if (settled) return;
                settled = true; clearTimeout(timer);
                if (frame && this.frames.get(path) !== frame) {
                    frame.addRef(); this.frames.set(path, frame);
                }
                resolve(frame);
            };
            const timer = setTimeout(() => finish(null), 8000);
            try {
                // load 会完成 SpriteFrame、纹理和图片依赖；preload 只下载文件，不足以保证首帧。
                resources.load(path, SpriteFrame, (error, frame) => {
                    finish(!error && frame instanceof SpriteFrame && frame.isValid ? frame : null);
                });
            } catch { finish(null); }
        });
        this.pending.set(path, request);
        void request.then(() => { if (this.pending.get(path) === request) this.pending.delete(path); });
        return request;
    }

    public static async prepare(isCurrent: () => boolean): Promise<void> {
        const loaded = await Promise.all(CHAT_CHANNEL_ART.map(path => this.load(path)));
        if (!isCurrent()) return;
        const missing = loaded.findIndex(frame => !frame?.isValid);
        if (missing >= 0) throw new Error(`聊天频道图标未就绪: ${CHAT_CHANNEL_ART[missing]}`);
    }
}
