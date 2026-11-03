import { EffectAsset, Material, resources, Sprite, SpriteFrame, UITransform, Vec4 } from 'cc';
import { easeMotion } from './PaintedBattleMotion';

const templates = new WeakMap<EffectAsset, Material>();
function template(effect: EffectAsset): Material {
    let material = templates.get(effect);
    if (!material) {
        material = new Material();material.initialize({ effectAsset: effect });
        for (const pass of material.passes) pass.tryCompile();
        templates.set(effect,material);
    }
    return material;
}
let pending: Promise<EffectAsset>;
export function loadReplayBlend(): Promise<EffectAsset> {
    if (pending) return pending;
    pending = new Promise((resolve, reject) => resources.load('effects/battle-replay-blend', EffectAsset, (e, a) => {
        if (e || !(a instanceof EffectAsset)) { reject(e || new Error('回放换帧材质无效')); return; }
        try { template(a);a.addRef();resolve(a); } catch (error) { reject(error); }
    }));
    void pending.catch(() => { pending = null; });
    return pending;
}
export interface ReplayFrameSample { from: number; to: number; mix: number; }
/** 最多 60ms 的帧间交接，关键姿态在既定时刻到达；不改变动作或命中时长。 */
export function sampleReplayFrames(seconds: number, duration: number, poses: readonly number[],
    times?: readonly number[], loop = false): ReplayFrameSample {
    const t = loop ? ((seconds % duration) + duration) % duration : Math.max(0, Math.min(duration, seconds));
    const phase = t / duration;
    const intervals = loop ? poses.length : poses.length - 1;
    for (let i = 0; i < intervals; i++) {
        const start = times ? times[i] : i / intervals, end = times ? times[i + 1] : (i + 1) / intervals;
        if (phase < end) {
            const width = Math.min(.06 / duration, (end - start) * .65);
            const mix = easeMotion((phase - (end - width)) / width);
            return { from: poses[i], to: poses[(i + 1) % poses.length], mix };
        }
    }
    return { from: poses[poses.length - 1], to: poses[poses.length - 1], mix: 0 };
}
const rects = new WeakMap<SpriteFrame, { rect: Vec4; size: Vec4 }>();
function metrics(frame: SpriteFrame) {
    let m = rects.get(frame);
    if (!m) {
        const r = frame.rect, t = frame.texture;
        m = { rect: new Vec4(r.x/t.width,r.y/t.height,r.width/t.width,r.height/t.height),
            size: new Vec4(frame.originalSize.width,frame.originalSize.height,1/t.width,1/t.height) };
        rects.set(frame,m);
    }
    return m;
}
/** 一个人物仍只有一个 Sprite；静止和帧间停留时使用默认材质，保留合批。 */
export class BattleReplayFrameBlend {
    private material: Material;
    private a: SpriteFrame;
    private b: SpriteFrame;
    private width = 0;
    private height = 0;
    private parameters = new Vec4();
    constructor(private sprite: Sprite, private effect: EffectAsset, private size: number) {
        // 列阵时复制已编译模板，不把材质创建放在第一次攻击的同一帧。
        if (effect) { this.material=new Material();this.material.copy(template(effect)); }
    }
    draw(a: SpriteFrame, b: SpriteFrame, weight: number, previousMirror = 1): void {
        const mix = Math.max(0,Math.min(1,weight));
        const blending = !!this.effect && mix > .001 && mix < .999 && (a !== b || previousMirror !== 1);
        if (!blending) {
            const f = mix >= .5 ? b : a;
            if (this.sprite.customMaterial) this.sprite.customMaterial = null;
            if (this.sprite.spriteFrame !== f) this.sprite.spriteFrame = f;
            this.resize(f.originalSize.width,f.originalSize.height);
            return;
        }
        if (this.a !== a) {
            const m = metrics(a); this.a = a;
            this.material.setProperty('frameTextureA',a.texture);
            this.material.setProperty('frameRectA',m.rect);this.material.setProperty('frameSizeA',m.size);
        }
        if (this.b !== b) {
            const m = metrics(b); this.b = b;
            this.material.setProperty('frameTextureB',b.texture);
            this.material.setProperty('frameRectB',m.rect);this.material.setProperty('frameSizeB',m.size);
        }
        if (this.sprite.spriteFrame !== a) this.sprite.spriteFrame = a;
        const w = Math.max(a.originalSize.width,b.originalSize.width), h = Math.max(a.originalSize.height,b.originalSize.height);
        this.resize(w,h); this.parameters.set(w,h,mix,previousMirror);
        this.material.setProperty('blendMetrics',this.parameters);
        if (this.sprite.customMaterial !== this.material) this.sprite.customMaterial = this.material;
    }
    private resize(width: number, height: number): void {
        if (width===this.width && height===this.height) return;
        this.width=width;this.height=height;
        const transform=this.sprite.node.getComponent(UITransform);
        transform.setContentSize(this.size*width/256,this.size*height/256);
        transform.setAnchorPoint(.5,18/height);
    }
    destroy(): void {
        if(this.sprite.isValid&&this.sprite.customMaterial===this.material)this.sprite.customMaterial=null;
        this.material?.destroy();this.material=null;
    }
}
