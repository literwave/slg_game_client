import { resources, SpriteFrame } from 'cc';
import { getConfigIconPath } from '../utils/ConfigIcon';

export interface HeadIconConfig {
    id: number;
    heroId: number;
    name: string;
    icon: string;
    sort: number;
}

/** HeadIcon.Id 是协议里的头像 ID，HeroId 只用于查询名称，Icon 决定图片。 */
export default class HeadIconProxy {
    private _configs: HeadIconConfig[] = [];
    private _byId = new Map<number, HeadIconConfig>();
    private _frames = new Map<string, SpriteFrame>();
    private _loads = new Map<string, Promise<SpriteFrame | null>>();
    private _generation = 0;

    public initConfig(rows: any[], heroes: any[] | Record<string, any>): void {
        this.clear();
        if (!Array.isArray(rows) || !rows.length) throw new Error('未找到头像配置 HeadIcon');
        const heroRows: any[] = Array.isArray(heroes) ? heroes
            : heroes && typeof heroes === 'object' ? Object.keys(heroes).map(key => heroes[key]) : [];
        const names = new Map<number, string>(heroRows.filter(hero => hero && typeof hero === 'object')
            .map(hero => [Number(hero.Id), hero.Name || hero.name]));
        for (const row of rows) {
            const id = Number(row?.Id);
            const heroId = Number(row?.HeroId);
            if (!Number.isInteger(id) || id <= 0 || this._byId.has(id) || !getConfigIconPath(row?.Icon)) {
                throw new Error(`头像配置无效: ${row?.Id}`);
            }
            const config: HeadIconConfig = {
                id, heroId, name: names.get(heroId) || row.Name || `头像 ${id}`,
                icon: row.Icon.trim(), sort: Number(row.Sort) || 0,
            };
            this._configs.push(config);
            this._byId.set(id, config);
        }
        this._configs.sort((a, b) => a.sort - b.sort || a.id - b.id);
    }

    public get configs(): readonly HeadIconConfig[] { return this._configs; }
    public getConfig(id: number): HeadIconConfig | null { return this._byId.get(id) || null; }
    public getIconPath(id: number): string { return getConfigIconPath(this.getConfig(id)?.icon); }

    /** 服务端 0 表示尚未选择，展示配置排序第一项；未知的非零 ID 不冒充其它头像。 */
    public getDisplayId(id: number): number {
        return id === 0 ? this._configs[0]?.id || 0 : id;
    }

    public getIcon(id: number): SpriteFrame | null {
        const path = this.getIconPath(id);
        if (!path) return null;
        const retained = this._frames.get(path);
        if (retained?.isValid) return retained;
        const frame = resources.get(path, SpriteFrame);
        if (!(frame instanceof SpriteFrame) || !frame.isValid) return null;
        frame.addRef();
        this._frames.set(path, frame);
        return frame;
    }

    public loadIcon(id: number): Promise<SpriteFrame | null> {
        const cached = this.getIcon(id);
        if (cached) return Promise.resolve(cached);
        const path = this.getIconPath(id);
        if (!path) return Promise.resolve(null);
        const pending = this._loads.get(path);
        if (pending) return pending;
        const generation = this._generation;
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
                    if (generation !== this._generation || error || !(frame instanceof SpriteFrame) || !frame.isValid) {
                        finish(null);
                        return;
                    }
                    if (!this._frames.has(path)) {
                        frame.addRef();
                        this._frames.set(path, frame);
                    }
                    finish(frame);
                });
            } catch (error) {
                console.warn(`头像加载失败: ${id} (${path})`, error);
                finish(null);
            }
        });
        this._loads.set(path, promise);
        promise.then(() => { if (this._loads.get(path) === promise) this._loads.delete(path); });
        return promise;
    }

    public async preloadIcons(isCurrent: () => boolean): Promise<void> {
        const configs = this._configs.slice();
        let cursor = 0;
        let failed = false;
        const worker = async () => {
            while (!failed && isCurrent() && cursor < configs.length) {
                const config = configs[cursor++];
                const frame = await this.loadIcon(config.id);
                if (!isCurrent()) return;
                if (!frame) {
                    failed = true;
                    throw new Error(`头像未就绪: ${config.name} (${config.id})`);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, configs.length) }, worker));
    }

    public clear(): void {
        this._generation++;
        this._loads.clear();
        this._frames.forEach(frame => { if (frame.isValid) frame.decRef(); });
        this._frames.clear();
        this._configs = [];
        this._byId.clear();
    }
}
