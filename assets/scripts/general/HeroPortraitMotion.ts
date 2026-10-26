import { EffectAsset, Material, Rect, Sprite, SpriteFrame, Vec4, resources } from 'cc';

let effectLoad: Promise<EffectAsset | null> | undefined;
function loadEffect(): Promise<EffectAsset | null> {
    if (!effectLoad) effectLoad = new Promise(resolve => {
        resources.load('effects/hero-portrait-motion', EffectAsset, (error, effect) => {
            if (error || !(effect instanceof EffectAsset)) { effectLoad = undefined; resolve(null); return; }
            effect.addRef(); resolve(effect);
        });
    });
    return effectLoad;
}

/** 仅用于五星揭晓：原立绘局部呼吸、衣摆微动，脸部、画框和整体位置保持稳定。 */
export default class HeroPortraitMotion {
    private frame: SpriteFrame | null = null;
    private source: SpriteFrame | null = null;
    private material: Material | null = null;
    private previousMaterial: Material | null = null;
    private version = 0;
    private readonly motion = new Vec4(0, 0, 0, 0);

    constructor(private readonly sprite: Sprite) {}

    async attach(source: SpriteFrame): Promise<boolean> {
        this.reset();
        const version = this.version, effect = await loadEffect();
        if (version !== this.version || !this.sprite.isValid || !effect || source.rotated) return false;
        const original = source.original, texture = original?._texture || source.texture;
        if (!texture) return false;
        const rect = source.rect;
        const frame = new SpriteFrame();
        frame.reset({ texture, rect: new Rect(original?._x ?? rect.x, original?._y ?? rect.y, rect.width, rect.height),
            originalSize: source.originalSize, offset: source.offset });
        frame.packable = false;
        const material = new Material();
        material.initialize({ effectAsset: effect });
        material.setProperty('portraitRect', new Vec4(frame.rect.x / texture.width, frame.rect.y / texture.height,
            frame.rect.width / texture.width, frame.rect.height / texture.height));
        material.setProperty('portraitMotion', this.motion);
        this.source = source; this.frame = frame; this.material = material;
        this.previousMaterial = this.sprite.customMaterial;
        this.sprite.spriteFrame = frame;
        this.sprite.customMaterial = material;
        return true;
    }

    update(seconds: number): void {
        if (!this.material) return;
        this.motion.set(seconds, Math.min(1, Math.max(0, seconds - .35)), 0, 0);
        this.material.setProperty('portraitMotion', this.motion);
    }

    reset(): void {
        this.version++;
        if (this.sprite.isValid) {
            if (this.sprite.customMaterial === this.material) this.sprite.customMaterial = this.previousMaterial;
            if (this.sprite.spriteFrame === this.frame) this.sprite.spriteFrame = this.source;
        }
        this.material?.destroy(); this.frame?.destroy();
        this.material = null; this.previousMaterial = null; this.frame = null; this.source = null;
        this.motion.set(0, 0, 0, 0);
    }
}
