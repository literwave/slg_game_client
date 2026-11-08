import { Color, EffectAsset, Graphics, isValid, JsonAsset, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import AssetLoadQueue, { AssetPriority, AssetRequestCancelled } from '../core/AssetLoadQueue';
import { cityArtAsset, cityArtWidth, cityOverviewAsset, CityArtIdentity, SYSTEM_CITY_ARTS } from './CityFootprint';
import { GATE_ART, BRIDGE_ART } from './GateGeometry';
import { PLAYER_CITY_MAX_LEVEL } from './PlayerCityAppearance';
import PlayerCityGround from './PlayerCityGround';

const CITY_ASSETS = [...new Set([...[4, 7, 10].map(level => cityArtAsset(level)),
    ...[4, 7, 10].map(level => cityOverviewAsset(level)),
    ...([] as string[]).concat(...SYSTEM_CITY_ARTS.map(city => [city.near, city.far]))])];

export const MAP_BOOKMARK_ART = 'map-bookmark-v2';

/** 显式列出运行中的素材，保留在目录里的历史原画不会进入首屏解码和显存。 */
export function worldArtNames(): string[] {
    const names = ['plains', 'water', 'mountain_ridge_connected', 'mountain_shoulder', 'mountain_massif_natural', 'mountain_saddle_natural',
        'town', 'county', 'fort', GATE_ART, BRIDGE_ART, MAP_BOOKMARK_ART, 'forest', 'iron', 'quarry', 'grain',
        'wild_forest', 'wild_iron', 'wild_quarry', 'wild_grain', ...CITY_ASSETS];
    for (const resource of ['forest', 'iron', 'quarry', 'grain']) {
        for (let level = 1; level <= 10; level++) names.push(`${resource}_lv${level}`);
    }
    for (let level = 1; level <= PLAYER_CITY_MAX_LEVEL; level++) names.push(`player_city_lv${level}`);
    return [...new Set(names)];
}

export const WORLD_CORE_ART = ['plains', 'water', 'mountain_ridge_connected', 'mountain_shoulder',
    'mountain_massif_natural', 'mountain_saddle_natural', MAP_BOOKMARK_ART];

interface ArtBinding { name: string; ready?: () => void; }

/** 地形常驻，建筑和资源图按可见节点请求；坐标与点击几何始终独立于贴图。 */
export default class WorldMapArt {
    private static pending: Promise<void> = null;
    private static progress = 0;
    private static frames = new Map<string, SpriteFrame>();
    private static bindings = new Map<Sprite, ArtBinding>();
    private static lastUsed = new Map<string, number>();
    private static loading = new Map<string, Promise<SpriteFrame>>();
    private static failures = new Map<string, { error: Error; at: number }>();
    private static sizes: Record<string, [number, number]> = {};
    private static nextSweep = 0;
    static effect: EffectAsset = null;
    static landscape: any = null;
    static campaign: any = null;

    static get preparationProgress(): number { return this.progress; }

    static cityWidth(level: number): number {
        return cityArtWidth(level);
    }
    static cityArt(level: number): string { return level >= 8 ? 'capital' : level >= 5 ? 'county' : 'town'; }

    /** 系统城池按身份选用独立原画；旧 county 仍供玩家城缺省等级的贴地材质使用。 */
    static citySprite(level: number, city?: CityArtIdentity): string { return cityArtAsset(level, city); }

    static cityOverviewSprite(level: number, city?: CityArtIdentity): string { return cityOverviewAsset(level, city); }

    static prepare(): Promise<void> {
        if (this.pending) return this.pending;
        let imageProgress = 0, metadataDone = 0, active = true;
        const report = () => { if (active) this.progress = Math.min(.99, imageProgress * .7 + metadataDone / 5 * .3); };
        const metadataReady = () => { metadataDone++; report(); };
        this.pending = Promise.all([
            PlayerCityGround.prepare().then(metadataReady),
            Promise.all(WORLD_CORE_ART.map(name => this.ensure(name).then(() => {
                imageProgress += 1 / WORLD_CORE_ART.length; report();
            }))),
            new Promise<void>((resolve, reject) => resources.load('world/art-sizes', JsonAsset, (error, config) => {
                if (error) return reject(error);
                this.sizes = config.json;
                for (const name of worldArtNames()) {
                    if (!this.sizes[name]?.every(n => Number.isFinite(n) && n > 0)) return reject(new Error(`地图尺寸信息缺失：${name}`));
                }
                metadataReady(); resolve();
            })),
            new Promise<void>((resolve, reject) => resources.load('effects/world-landscape', EffectAsset, (error, effect) => {
                if (error) return reject(error);
                this.effect = effect;
                metadataReady();
                resolve();
            })),
            new Promise<void>((resolve, reject) => resources.load('world/original-landscape', JsonAsset, (error, config) => {
                if (error) return reject(error);
                this.landscape = config.json;
                metadataReady();
                resolve();
            })),
            new Promise<void>((resolve, reject) => resources.load('world/campaign-map', JsonAsset, (error, config) => {
                if (error) return reject(error);
                this.campaign = config.json;
                metadataReady();
                resolve();
            })),
        ]).then(() => {
            for (const name of WORLD_CORE_ART) this.frame(name);
            active = false; this.progress = 1;
        }).catch(error => { active = false; this.pending = null; this.progress = 0; throw error; });
        return this.pending;
    }

    static frame(name: string): SpriteFrame {
        // 配置里的 capital 是城池类别，贴图版本独立演进，不修改地图或服务端占地数据。
        const frame = this.frames.get(name === 'capital' ? cityArtAsset(10) : name);
        if (!frame) throw new Error(`原创地图素材缺失：${name}`);
        return frame;
    }

    static size(name: string): { width: number; height: number } {
        name = name === 'capital' ? cityArtAsset(10) : name;
        const size = this.sizes[name];
        if (!size) throw new Error(`地图尺寸信息缺失：${name}`);
        return { width: size[0], height: size[1] };
    }

    static ensure(name: string, priority = AssetPriority.Visible): Promise<SpriteFrame> {
        name = name === 'capital' ? cityArtAsset(10) : name;
        this.lastUsed.set(name, Date.now());
        const cached = this.frames.get(name);
        if (cached?.isValid) return Promise.resolve(cached);
        const request = AssetLoadQueue.request(`world:${name}`, () => new Promise<SpriteFrame>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`地图图片加载超时：${name}`)), 15000);
            resources.load(`ui/world/${name}/spriteFrame`, SpriteFrame, (error, frame) => {
                clearTimeout(timer);
                if (error || !frame?.isValid) { reject(error || new Error(`地图图片无效：${name}`)); return; }
                // 流式纹理不能进入常驻动态合图，否则离开视野后仍无法释放显存。
                frame.packable = false;
                if (!this.frames.has(name)) { frame.addRef(); this.frames.set(name, frame); }
                this.failures.delete(name);
                this.lastUsed.set(name, Date.now());
                resolve(frame);
            });
        }), priority);
        if (!this.loading.has(name)) {
            this.loading.set(name, request);
            void request.then(() => this.loading.delete(name), error => {
                this.loading.delete(name);
                if (!(error instanceof AssetRequestCancelled)) {
                    this.failures.set(name, { error, at: Date.now() });
                    console.warn(`[WorldArt] ${name}`, error);
                }
            });
        }
        return request;
    }

    static apply(sprite: Sprite, name: string, width: number, ready?: () => void): void {
        name = name === 'capital' ? cityArtAsset(10) : name;
        const size = this.size(name);
        const binding: ArtBinding = { name, ready };
        this.bindings.set(sprite, binding);
        sprite.customMaterial = null;
        sprite.spriteFrame = null;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.type = Sprite.Type.SIMPLE;
        sprite.color = Color.WHITE;
        sprite.node.getComponent(UITransform).setContentSize(width, width * size.height / size.width);
        this.bind(sprite, binding);
    }

    private static bind(sprite: Sprite, binding: ArtBinding): void {
        const apply = (frame: SpriteFrame) => {
            if (!isValid(sprite, true) || this.bindings.get(sprite) !== binding) return;
            sprite.spriteFrame = frame;
            binding.ready?.();
        };
        const frame = this.frames.get(binding.name);
        if (frame?.isValid) { this.lastUsed.set(binding.name, Date.now()); apply(frame); return; }
        if (sprite.node.activeInHierarchy) void this.ensure(binding.name).then(apply, () => {});
    }

    static unbindTree(node: Node): void {
        for (const sprite of node.getComponentsInChildren(Sprite)) {
            if (!this.bindings.delete(sprite)) continue;
            sprite.customMaterial = null;
            sprite.spriteFrame = null;
        }
    }

    /** 首屏只等待当前可见对象，隐藏的战略缩略图不会阻塞进图。 */
    static get visibleState(): { pending: number; error: Error | null } {
        const names = new Set<string>();
        for (const [sprite, binding] of this.bindings) {
            if (isValid(sprite, true) && sprite.node.activeInHierarchy && !sprite.spriteFrame?.isValid) names.add(binding.name);
        }
        return { pending: names.size, error: [...names].map(name => this.failures.get(name)?.error).find(Boolean) || null };
    }

    static updateStreaming(): void {
        const now = Date.now(), used = new Set(WORLD_CORE_ART);
        for (const [sprite, binding] of this.bindings) {
            if (!isValid(sprite, true)) { this.bindings.delete(sprite); continue; }
            if (!sprite.node.activeInHierarchy) continue;
            used.add(binding.name); this.lastUsed.set(binding.name, now);
            if (!sprite.spriteFrame?.isValid && !this.loading.has(binding.name)
                && now - (this.failures.get(binding.name)?.at || 0) > 5000) this.bind(sprite, binding);
        }
        if (now < this.nextSweep) return;
        this.nextSweep = now + 5000;
        let bytes = this.statistics.textureBytes;
        const idle = [...this.frames.keys()].filter(name => !used.has(name))
            .sort((a, b) => (this.lastUsed.get(a) || 0) - (this.lastUsed.get(b) || 0));
        for (const name of idle) {
            if (bytes <= 96 * 1024 * 1024 && now - (this.lastUsed.get(name) || 0) < 30000) continue;
            for (const [sprite, binding] of this.bindings) if (binding.name === name) {
                sprite.customMaterial = null; sprite.spriteFrame = null;
            }
            PlayerCityGround.releaseArt(name);
            const frame = this.frames.get(name);
            bytes -= frame.originalSize.width * frame.originalSize.height * 4;
            this.frames.delete(name); this.lastUsed.delete(name);
            frame.decRef();
        }
    }

    static prefetch(names: string[]): void {
        for (const name of new Set(names)) void this.ensure(name, AssetPriority.Background).catch(() => {});
    }

    static get statistics() {
        let textureBytes = 0;
        for (const frame of this.frames.values()) textureBytes += frame.originalSize.width * frame.originalSize.height * 4;
        return { loaded: this.frames.size, available: worldArtNames().length, textureBytes, pending: this.loading.size };
    }

    static factionColor(data: any, owner: any): Color | null {
        if (!data.rid) return null;
        if (data.rid === owner.myId) return new Color(111, 174, 211, 190);
        if (data.unionId > 0 && data.unionId === owner.myUnionId) return new Color(146, 181, 118, 190);
        if (data.unionId > 0 && data.unionId === owner.myParentId) return new Color(171, 147, 193, 190);
        if (data.parentId > 0 && data.parentId === owner.myUnionId) return new Color(209, 188, 113, 190);
        return new Color(188, 115, 95, 190);
    }

    /** 阵营色仅标识领地边界，不给建筑整体染色。 */
    static ownership(parent: Node, up: Sprite, down: Sprite, color: Color | null, width: number, height = width / 2): void {
        if (up) up.spriteFrame = null;
        if (down) down.spriteFrame = null;
        let node = parent.getChildByName('OwnershipOutline');
        if (!node && !color) return;
        if (!node) {
            node = new Node('OwnershipOutline'); node.layer = parent.layer;
            parent.addChild(node); node.setSiblingIndex(0); node.addComponent(Graphics);
        }
        const ui = node.getComponent(UITransform) || node.addComponent(UITransform);
        ui.setContentSize(width, height);
        node.setPosition(0, 0, 0);
        const graphics = node.getComponent(Graphics);
        graphics.clear();
        if (!color) return;
        graphics.strokeColor = color; graphics.lineWidth = 2;
        graphics.fillColor = new Color(color.r, color.g, color.b, 22);
        graphics.moveTo(-width / 2, 0); graphics.lineTo(0, height / 2);
        graphics.lineTo(width / 2, 0); graphics.lineTo(0, -height / 2); graphics.close();
        graphics.fill(); graphics.stroke();
    }
}
