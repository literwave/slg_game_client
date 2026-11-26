import { EffectAsset, JsonAsset, Material, resources, Sprite, SpriteFrame, Vec4 } from 'cc';
import { playerCityAppearance, PLAYER_CITY_MAX_LEVEL } from './PlayerCityAppearance';
import { fitPlayerCityArt, PlayerCityFit, PlayerCityProfile } from './PlayerCityArtFit';
import { cityArtPoint } from './CityArtFit';
import type { CityArtLayout } from './CityFootprint';

/** 主城地面固定九格，屋顶的绘制高度独立于占地与选择框。 */
export default class PlayerCityGround {
    private static profiles: PlayerCityProfile[] = [];
    private static effect: EffectAsset;
    private static fits = new Map<string, PlayerCityFit>();
    private static materials = new Map<string, Material>();
    private static frames = new Map<string, SpriteFrame>();
    private static gateColumns = [410, 442, 516, 478, 492, 462, 490, 475, 496, 460, 1084,
        468, 480, 455, 490, 450, 490, 466, 442, 458, 490, 470, 442, 488, 506, 462, 493, 468, 450, 490, 507];

    private static fit(art: string): PlayerCityFit {
        let fit = this.fits.get(art);
        if (!fit) {
            const profile = this.profiles.find(p => p.art === art);
            if (!profile) throw new Error('主城地基校准缺失：' + art);
            fit = fitPlayerCityArt(profile); this.fits.set(art, fit);
        }
        return fit;
    }

    /** 出兵方向继续跟随真实城门，落脚点保持在服务端九格占地之外。 */
    static entrance(level: number): { x: number; y: number } | null {
        const appearance = playerCityAppearance(level), p = this.profiles.find(p => p.art === appearance.art);
        if (!p) return null;
        const column = p.gateX ?? this.gateColumns[appearance.level];
        const point = cityArtPoint(this.fit(p.art).forward, column / p.width, 1 - p.ground[column] / p.height);
        const x = 3 * (point.x - point.y), y = -3 * (point.x + point.y);
        const scale = 1.52 / Math.max(Math.abs(x), Math.abs(y), .001);
        return { x: x * scale, y: y * scale };
    }

    static layout(appearance: ReturnType<typeof playerCityAppearance>, footprintHeight: number) {
        const roof = this.fit(appearance.art).roof;
        const height = footprintHeight * (roof?.height ?? 1), y = footprintHeight * (roof?.y ?? 0);
        return { ...appearance, height, y, top: y + height / 2 };
    }

    /** 装饰人物与主城材质共用整幅仿射投影，脚底对准实际石板路。 */
    static ambientLayout(appearance: ReturnType<typeof playerCityAppearance>): CityArtLayout {
        const fit = this.fit(appearance.art);
        return { width: appearance.width, height: appearance.height, anchorX: .5, anchorY: .5,
            fit: { ...fit, upperForward: fit.forward, upperInverse: fit.inverse } };
    }

    static async prepare(): Promise<void> {
        const [data, effect] = await Promise.all([
            new Promise<JsonAsset>((resolve, reject) => resources.load('world/player-city-ground', JsonAsset,
                (error, asset) => error ? reject(error) : resolve(asset))),
            new Promise<EffectAsset>((resolve, reject) => resources.load('effects/player-city-ground', EffectAsset,
                (error, asset) => error ? reject(error) : resolve(asset))),
        ]);
        if (!Array.isArray(data.json) || data.json.length !== PLAYER_CITY_MAX_LEVEL + 1
            || data.json.some(p => p.ground?.length !== p.width || p.ceiling?.length !== p.width)) {
            throw new Error('主城地基校准表不完整');
        }
        this.profiles = data.json; this.effect = effect;
        for (const p of this.profiles) this.fit(p.art);
    }

    static releaseArt(art: string): void {
        const material = this.materials.get(art);
        if (material) { material.destroy(); this.materials.delete(art); }
        const frame = this.frames.get(art);
        if (frame) { frame.decRef(); this.frames.delete(art); }
    }

    static apply(sprite: Sprite, art: string): void {
        if (!this.effect) throw new Error('主城投影材质未就绪');
        let frame = this.frames.get(art);
        if (!frame) {
            // 原导入帧可能裁掉透明边；投影材质必须采样完整原图，且不复制纹理。
            frame = new SpriteFrame(); frame.texture = sprite.spriteFrame.texture;
            frame.packable = false; frame.addRef(); this.frames.set(art, frame);
        }
        sprite.spriteFrame = frame; sprite.trim = false;
        let material = this.materials.get(art);
        if (!material) {
            const fit = this.fit(art), [a,b,c,d,e,f] = fit.inverse;
            material = new Material(); material.initialize({ effectAsset: this.effect });
            material.setProperty('cityUvX', new Vec4(a,b,c,fit.roof ? 1 : 0));
            material.setProperty('cityUvY', new Vec4(d,e,f,0));
            material.setProperty('cityRender', new Vec4(1,fit.roof?.height ?? 1,0,fit.roof?.y ?? 0));
            // 六阶段主城统一压低鲜艳度与石板高光，与地图的灰黄草地、土褐色衔接。
            // 保留屋瓦暗部层次；最后一项保持透明区域透出地图。
            material.setProperty('cityTone', art.startsWith('player-city-grid-')
                ? new Vec4(.94, .66, .16, 1) : art === 'player-city-lv10-courtyard-v6'
                ? new Vec4(.90, .72, .16, 0) : new Vec4(1, 1, 0,
                    art === 'player_city_lv10' || art.startsWith('player-city-rework-')
                        || art.startsWith('player-city-stage-') || art.startsWith('player-city-arrow-') ? 1 : 0));
            material.setProperty('cityTexture', frame.texture);
            this.materials.set(art, material);
        }
        sprite.customMaterial = material;
    }
}
