import { Color, EffectAsset, Graphics, JsonAsset, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import { cityArtAsset, cityArtWidth, cityOverviewAsset, CityArtIdentity, SYSTEM_CITY_ARTS } from './CityFootprint';
import { GATE_ART, BRIDGE_ART } from './GateGeometry';
import { PLAYER_CITY_MAX_LEVEL } from './PlayerCityAppearance';
import PlayerCityGround from './PlayerCityGround';

const CITY_ASSETS = [...new Set([...[4, 7, 10].map(level => cityArtAsset(level)),
    ...[4, 7, 10].map(level => cityOverviewAsset(level)), ...SYSTEM_CITY_ARTS.flatMap(city => [city.near, city.far])])];

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

/** 地图专用原创素材；入图时一次准备，地块复用时不再发起异步加载。 */
export default class WorldMapArt {
    private static pending: Promise<void> = null;
    private static progress = 0;
    private static frames = new Map<string, SpriteFrame>();
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
        const report = () => { if (active) this.progress = Math.min(.99, imageProgress * .9 + metadataDone / 4 * .1); };
        const metadataReady = () => { metadataDone++; report(); };
        this.pending = Promise.all([
            PlayerCityGround.prepare().then(metadataReady),
            new Promise<void>((resolve, reject) => resources.load(
                worldArtNames().map(name => `ui/world/${name}/spriteFrame`), SpriteFrame,
                (finished, total) => { imageProgress = Math.max(imageProgress, total > 0 ? Math.min(1, finished / total) : 0); report(); },
                (error, frames) => {
                    if (error) return reject(error);
                    frames.forEach(frame => {
                        if (frame.name === 'county' || CITY_ASSETS.includes(frame.name) || frame.name.startsWith('player_city_lv')
                            || frame.name.startsWith('mountain_') || frame.name === BRIDGE_ART) frame.packable = false;
                        this.frames.set(frame.name, frame);
                    });
                    imageProgress = 1; report();
                    resolve();
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
            for (const name of ['plains', 'water', 'mountain_ridge_connected', 'mountain_shoulder', 'mountain_massif_natural', 'mountain_saddle_natural',
                'town', 'county', 'capital', 'fort', GATE_ART, BRIDGE_ART, MAP_BOOKMARK_ART, 'forest', 'iron', 'quarry', 'grain',
                'wild_forest', 'wild_iron', 'wild_quarry', 'wild_grain']) this.frame(name);
            for (const name of CITY_ASSETS) this.frame(name);
            for (const resource of ['forest', 'iron', 'quarry', 'grain']) {
                for (let level = 1; level <= 10; level++) this.frame(`${resource}_lv${level}`);
            }
            for (let level = 1; level <= PLAYER_CITY_MAX_LEVEL; level++) this.frame(`player_city_lv${level}`);
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

    static apply(sprite: Sprite, name: string, width: number): void {
        const frame = this.frame(name);
        sprite.spriteFrame = frame;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.type = Sprite.Type.SIMPLE;
        sprite.color = Color.WHITE;
        sprite.node.getComponent(UITransform).setContentSize(width, width * frame.originalSize.height / frame.originalSize.width);
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
