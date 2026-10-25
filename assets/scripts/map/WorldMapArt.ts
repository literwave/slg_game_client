import { Color, EffectAsset, Graphics, JsonAsset, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import { cityFootprintRadius } from './CityFootprint';
import { GATE_ART } from './GateGeometry';
import { PLAYER_CITY_MAX_LEVEL } from './PlayerCityAppearance';
import PlayerCityGround from './PlayerCityGround';

/** 地图专用原创素材；入图时一次准备，地块复用时不再发起异步加载。 */
export default class WorldMapArt {
    private static pending: Promise<void> = null;
    private static frames = new Map<string, SpriteFrame>();
    static effect: EffectAsset = null;
    static landscape: any = null;
    static campaign: any = null;

    static cityWidth(level: number): number {
        return (cityFootprintRadius(level) * 2 + 1) * 200 * .74;
    }
    static cityArt(level: number): string { return level >= 8 ? 'capital' : level >= 5 ? 'county' : 'town'; }

    static prepare(): Promise<void> {
        if (this.pending) return this.pending;
        this.pending = Promise.all([
            PlayerCityGround.prepare(),
            new Promise<void>((resolve, reject) => resources.loadDir('ui/world', SpriteFrame, (error, frames) => {
                if (error) return reject(error);
                frames.forEach(frame => {
                    if (frame.name === 'county' || frame.name.startsWith('player_city_lv')) frame.packable = false;
                    this.frames.set(frame.name, frame);
                });
                resolve();
            })),
            new Promise<void>((resolve, reject) => resources.load('effects/world-landscape', EffectAsset, (error, effect) => {
                if (error) return reject(error);
                this.effect = effect;
                resolve();
            })),
            new Promise<void>((resolve, reject) => resources.load('world/original-landscape', JsonAsset, (error, config) => {
                if (error) return reject(error);
                this.landscape = config.json;
                resolve();
            })),
            new Promise<void>((resolve, reject) => resources.load('world/campaign-map', JsonAsset, (error, config) => {
                if (error) return reject(error);
                this.campaign = config.json;
                resolve();
            })),
        ]).then(() => {
            for (const name of ['plains', 'water', 'ridge', 'foothills', 'peaks', 'valley',
                'town', 'county', 'capital', 'fort', GATE_ART, 'forest', 'iron', 'quarry', 'grain',
                'wild_forest', 'wild_iron', 'wild_quarry', 'wild_grain']) this.frame(name);
            for (const resource of ['forest', 'iron', 'quarry', 'grain']) {
                for (let level = 1; level <= 10; level++) this.frame(`${resource}_lv${level}`);
            }
            for (let level = 1; level <= PLAYER_CITY_MAX_LEVEL; level++) this.frame(`player_city_lv${level}`);
        }).catch(error => { this.pending = null; throw error; });
        return this.pending;
    }

    static frame(name: string): SpriteFrame {
        const frame = this.frames.get(name);
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
