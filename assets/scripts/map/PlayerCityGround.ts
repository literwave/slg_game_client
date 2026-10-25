import { EffectAsset, ImageAsset, JsonAsset, Material, resources, Sprite, Texture2D, Vec4 } from 'cc';
import { playerCityAppearance } from './PlayerCityAppearance';

interface GroundProfile {
    art: string; width: number; height: number; left: number; right: number; ground: number[]; ceiling: number[];
    /** 已校正原画的两条直线地脚；不再用植被的透明轮廓拉伸城墙。 */
    plane?: { frontX: number; leftY: number; frontY: number; rightY: number; fitContour?: boolean };
    /** 多层城楼不能靠区域最高点配对：显式指定同一层的左右角楼。 */
    roofAnchors?: [number, number];
    /** 外伸阶道只收进地脚窄带，避免把门楼一起压矮。 */
    compactFrontGround?: boolean;
}

/** 原城图直接贴合九格；建筑轮廓与地脚分别校准，不增加外围铺地。 */
export default class PlayerCityGround {
    private static profiles: GroundProfile[] = [];
    private static effect: EffectAsset;
    private static textures = new Map<string, Texture2D>();
    private static materials = new Map<string, Material>();
    private static smoothProfiles = new Map<string, number[]>();
    private static heights = new Map<string, number>();

    /** 每个立面只做线性平移，任意高度的竖直线段始终保持同一比例。 */
    private static planePoint(profile: GroundProfile, x: number, sourceY: number, scale: number, footprintHeight: number) {
        const p = profile.plane;
        const left = x <= p.frontX;
        const t = left ? (x - profile.left) / (p.frontX - profile.left)
            : (x - p.frontX) / (profile.right - p.frontX);
        const floor = left ? p.leftY + (p.frontY - p.leftY) * t : p.frontY + (p.rightY - p.frontY) * t;
        const u = left ? t * .5 : .5 + t * .5;
        const edge = Math.abs(u - .5) * footprintHeight;
        let y = edge + (sourceY - floor) * scale;
        if (p.fitContour) {
            const ground = profile.ground[Math.max(profile.left, Math.min(profile.right, Math.round(x)))];
            const delta = (ground - floor) * scale;
            const band = Math.max(footprintHeight * .03, Math.abs(delta) * (delta < 0 ? .25 : 2) + 1);
            if (y < edge + band) y = edge + (y - edge - delta) / (1 - delta / band);
        }
        return { u, floor, y };
    }

    private static smooth(profile: GroundProfile): number[] {
        let values = this.smoothProfiles.get(profile.art);
        if (!values) {
            values = profile.ground.map((_, x) => {
                let sum = 0, weight = 0;
                for (let dx = -48; dx <= 48; dx++) {
                    const w = Math.exp(-dx * dx / 800);
                    sum += profile.ground[Math.max(profile.left, Math.min(profile.right, x + dx))] * w;
                    weight += w;
                }
                return sum / weight;
            });
            this.smoothProfiles.set(profile.art, values);
        }
        return values;
    }

    /** 用前城角对齐菱形中轴，避免透明包围盒中心把城池拉偏。 */
    private static frontRatio(profile: GroundProfile): number {
        const span = profile.right - profile.left;
        let front = profile.left + span / 2, lowest = Infinity;
        for (let x = Math.ceil(profile.left + span * .3); x <= profile.left + span * .65; x++) {
            let sum = 0;
            for (let offset = -16; offset <= 16; offset++) sum += profile.ground[x + offset];
            if (sum < lowest) { lowest = sum; front = x; }
        }
        return (front - profile.left) / span;
    }

    /** 用两侧角楼标定整幅建筑的线性倾斜；各列保持相同的纵向比例。 */
    private static projection(profile: GroundProfile, scale: number): { bias: number; shear: number; offset: number } {
        const span = profile.right - profile.left;
        const peak = (from: number, to: number) => {
            let result = { x: profile.left, y: 0 };
            for (let x = Math.ceil(profile.left + span * from); x <= profile.left + span * to; x++) {
                if (profile.ceiling[x] > result.y) result = { x, y: profile.ceiling[x] };
            }
            return result;
        };
        const left = profile.roofAnchors ? { x: profile.roofAnchors[0], y: profile.ceiling[profile.roofAnchors[0]] } : peak(.04, .16);
        const right = profile.roofAnchors ? { x: profile.roofAnchors[1], y: profile.ceiling[profile.roofAnchors[1]] } : peak(.84, .96);
        const shear = (left.y - right.y) / (right.x - left.x) * scale;
        const front = this.frontRatio(profile), x = Math.round(profile.left + span * front);
        return { bias: front - .5, shear, offset: -profile.ground[x] * scale - shear * x };
    }

    /** 按真实屋顶计算投影后的画布，详情框同步避让完整的城池。 */
    static layout(appearance: ReturnType<typeof playerCityAppearance>, footprintHeight: number) {
        const profile = this.profiles.find(p => p.art === appearance.art);
        if (!profile) throw new Error(`主城地基校准缺失：${appearance.art}`);
        const key = `${appearance.art}:${appearance.height}:${footprintHeight}`;
        let height = this.heights.get(key);
        if (height === undefined) {
            const scale = appearance.height / profile.height;
            if (profile.plane) {
                height = footprintHeight;
                for (let x = profile.left; x <= profile.right; x++) {
                    height = Math.max(height, this.planePoint(profile, x, profile.ceiling[x], scale, footprintHeight).y);
                }
                height = Math.ceil(height + 2); this.heights.set(key, height);
                return { ...appearance, sourceHeight: appearance.height, height, top: appearance.y + height };
            }
            const { bias, shear, offset } = this.projection(profile, scale);
            const smooth = this.smooth(profile);
            height = footprintHeight;
            for (let x = profile.left; x <= profile.right; x++) {
                const sourceU = (x - profile.left) / (profile.right - profile.left);
                let low = 0, high = 1;
                for (let i = 0; i < 16; i++) {
                    const u = (low + high) / 2;
                    if (u + bias * 4 * u * (1 - u) < sourceU) low = u; else high = u;
                }
                const u = (low + high) / 2, edge = Math.abs(u - .5) * footprintHeight;
                const floorWorld = (profile.compactFrontGround ? profile.ground[x] : smooth[x]) * scale + shear * x + offset;
                const delta = floorWorld - edge;
                const band = Math.max(footprintHeight * .04,
                    Math.abs(delta) * (profile.compactFrontGround && delta < 0 ? .25 : 2) + 1);
                const sourceTop = profile.ceiling[x] * scale + shear * x + offset;
                const slope = 1 - delta / band;
                let top = sourceTop < edge + band ? edge + (sourceTop - edge - delta) / slope : sourceTop;
                const fine = profile.compactFrontGround ? 0 : (profile.ground[x] - smooth[x]) * scale / slope;
                const fineBand = Math.max(footprintHeight * .035, Math.abs(fine) * 2 + 1);
                if (top < edge + fineBand) top = edge + (top - edge - fine) / (1 - fine / fineBand);
                height = Math.max(height, top);
            }
            height = Math.ceil(height + 2); this.heights.set(key, height);
        }
        return { ...appearance, sourceHeight: appearance.height, height, top: appearance.y + height };
    }

    static async prepare(): Promise<void> {
        const [data, effect] = await Promise.all([
            new Promise<JsonAsset>((resolve, reject) => resources.load('world/player-city-ground', JsonAsset,
                (error, asset) => error ? reject(error) : resolve(asset))),
            new Promise<EffectAsset>((resolve, reject) => resources.load('effects/player-city-ground', EffectAsset,
                (error, asset) => error ? reject(error) : resolve(asset))),
        ]);
        if (!Array.isArray(data.json) || data.json.length !== 31
            || data.json.some(p => p.ground?.length !== p.width || p.ceiling?.length !== p.width)) {
            throw new Error('主城地基校准表不完整');
        }
        this.profiles = data.json; this.effect = effect;
    }

    static apply(sprite: Sprite, art: string, width: number, height: number, footprintHeight: number, sourceHeight: number): void {
        const profile = this.profiles.find(p => p.art === art);
        if (!profile || !this.effect) throw new Error(`主城地基校准缺失：${art}`);
        const key = `${art}:${width}:${height}:${footprintHeight}:${sourceHeight}`;
        let material = this.materials.get(key);
        if (!material) {
            let texture = this.textures.get(art);
            if (!texture) {
                const bytes = new Uint8Array(profile.width * 4), smooth = this.smooth(profile);
                profile.ground.forEach((value, x) => {
                    const encoded = Math.round(value / profile.height * 65535);
                    const smoothed = Math.round(smooth[x] / profile.height * 65535);
                    bytes[x * 4] = encoded >> 8; bytes[x * 4 + 1] = encoded & 255;
                    bytes[x * 4 + 2] = smoothed >> 8; bytes[x * 4 + 3] = smoothed & 255;
                });
                const image = new ImageAsset({ _data: bytes, width: profile.width, height: 1,
                    format: Texture2D.PixelFormat.RGBA8888, _compressed: false });
                texture = new Texture2D(); texture.image = image;
                texture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
                texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
                this.textures.set(art, texture);
            }
            material = new Material(); material.initialize({ effectAsset: this.effect });
            material.setProperty('sourceMetrics', new Vec4(profile.width, profile.height, profile.left, profile.right));
            material.setProperty('cityMetrics', new Vec4(width, height, footprintHeight, sourceHeight / profile.height));
            material.setProperty('groundMode', new Vec4(profile.plane?.fitContour ? 2 : profile.compactFrontGround ? 1 : 0, 0, 0, 0));
            if (profile.plane) {
                const p = profile.plane;
                material.setProperty('groundPlane', new Vec4(p.frontX, p.leftY, p.frontY, p.rightY));
            } else {
                const projection = this.projection(profile, sourceHeight / profile.height);
                material.setProperty('alignment', new Vec4(projection.bias, projection.shear, projection.offset, 2));
            }
            material.setProperty('groundProfile', texture);
            material.setProperty('cityTexture', sprite.spriteFrame.texture);
            this.materials.set(key, material);
        }
        sprite.spriteFrame.packable = false;
        sprite.customMaterial = material;
    }
}
