import { EffectAsset, Color, Graphics, Node, Rect, resources, Size, Sprite, SpriteFrame, UITransform, Vec2 } from 'cc';
import { loadMarchAnimations, MarchAnimationSet } from '../entries/MarchAnimationLibrary';
import { easeMotion, PAINTED_CLIPS, PaintedMotion } from './PaintedBattleMotion';

import { BattleReplayFrameBlend, loadReplayBlend, sampleReplayFrames } from './BattleReplayFrameBlend';

export type ReplayActorKind = 'infantry' | 'cavalry' | 'archer';
export interface ReplayActorAssets {
    blendEffect?: EffectAsset;
    infantry: MarchAnimationSet;
    cavalry: MarchAnimationSet;
    archer: SpriteFrame[];
    infantryAttack: SpriteFrame[];
    archerAttack: SpriteFrame[];
    cavalryAttack: SpriteFrame[];
}
export const REPLAY_DEFEAT_DURATION = 1.08;
/** 先短促踉跄，再溃散淡出；不把整张站立人物横倒成纸片。 */
export function replayDefeatOpacity(seconds: number): number {
    return Math.round(255 * (1 - easeMotion((seconds - .18) / (REPLAY_DEFEAT_DURATION - .18))));
}
/** 每个士兵的蓄力和收招略有错落，出手点仍与服务器结算时刻对齐。 */
export function replayActionPoseTime(motion: PaintedMotion, seconds: number, phase: number): number {
    const t = Math.max(0, seconds), clip = PAINTED_CLIPS[motion];
    if (t >= clip.duration) return t;
    const strike = clip.duration * (motion === 'shoot' ? .46 : clip.impact || .5);
    const part = t < strike ? t / strike : (t - strike) / (clip.duration - strike);
    return t + Math.sin(part * Math.PI) * Math.sin(phase) * .045;
}
/** 撤回的前 0.18 秒先转身，再进入归阵方向；采样只依赖回放时间。 */
export function replayReturnHeading(x: number, y: number, seconds: number): { x: number; y: number } {
    const angle = Math.atan2(y, x) + Math.PI * (1 - easeMotion(seconds / .18));
    return { x: Math.cos(angle), y: Math.sin(angle) };
}
let actors: Promise<ReplayActorAssets>;

function loadCombatSheet(name: string, columns = 8): Promise<SpriteFrame[]> {
    return new Promise((resolve, reject) => {
        resources.load(`ui/battle_replay/painted/${name}/spriteFrame`, SpriteFrame, (error, sheet) => {
            if (error) { reject(error); return; }
            if (!(sheet instanceof SpriteFrame) || !sheet.texture) { reject(new Error(`战斗图集无效: ${name}`)); return; }
            const w = sheet.texture.width / columns, h = sheet.texture.height / 2;
            if (!Number.isInteger(w) || !Number.isInteger(h)) { reject(new Error(`战斗图集尺寸无效: ${name}`)); return; }
            sheet.addRef();
            resolve(Array.from({ length: columns * 2 }, (_, index) => {
                const frame = new SpriteFrame(); frame.name = `${name}_${index}`;
                frame.reset({ texture: sheet.texture, rect: new Rect(index % columns * w, Math.floor(index / columns) * h, w, h),
                    originalSize: new Size(w, h), offset: new Vec2() });
                frame.packable = false; frame.addRef(); return frame;
            }));
        });
    });
}

/** 人物沿用大地图的骑将、步兵；弓手使用同一画风的战斗姿态。 */
export function loadReplayActors(): Promise<ReplayActorAssets> {
    if (actors) return actors;
    actors = Promise.all([loadMarchAnimations('infantry'), loadMarchAnimations('cavalry'),
        loadCombatSheet('archer_battle_sheet', 4), loadCombatSheet('infantry_battle_cycle'),
        loadCombatSheet('archer_battle_cycle'), loadCombatSheet('cavalry_battle_cycle'), loadReplayBlend()])
        .then(([infantry, cavalry, archer, infantryAttack, archerAttack, cavalryAttack, blendEffect]) =>
            ({ infantry, cavalry, archer, infantryAttack, archerAttack, cavalryAttack, blendEffect }));
    void actors.catch(() => { actors = null; });
    return actors;
}

const ATTACK_POSES = [0,1,2,3,4,5,6,7], COMMAND_POSES = [0,1,2,2,1,0], COMMAND_TIMES = [0,.18,.36,.66,.84,1];
const BRACE_POSES = [0,1,0], BRACE_TIMES = [0,.3,1];
const STRIKE_TIMES: Partial<Record<PaintedMotion, number[]>> = {};
for (const name of ['attack','sweep','slash','shoot'] as PaintedMotion[]) {
    const hit = name === 'shoot' ? .46 : PAINTED_CLIPS[name].impact;
    STRIKE_TIMES[name] = [0,hit*.22,hit*.48,hit*.75,hit,hit+(1-hit)*.33,hit+(1-hit)*.67,1];
}
const WALK_POSES = new Map<number, number[]>();
/** 时间驱动换帧、短交接和固定落脚线；不创建独立动画时钟。 */
export class BattleReplayActor {
    readonly root: Node;
    private sprite: Sprite;
    private blend: BattleReplayFrameBlend;
    private lastMotion: PaintedMotion = null;
    private lastSeconds = -1;
    private lastFrame: SpriteFrame;
    private lastMirror = 1;
    private outgoing: SpriteFrame;
    private outgoingMirror = 1;
    private transitionAge = 1;
    private previousPose = [0,0,0,1];
    private lastPose = [0,0,0,1];
    private direction: number;
    private headingX = 1;
    private headingY = .5;
    private readonly base: Color;
    constructor(parent: Node, private assets: ReplayActorAssets, readonly kind: ReplayActorKind,
        private size: number, private side: number) {
        this.root = new Node('MapCharacter'); this.root.layer = parent.layer; parent.addChild(this.root);
        const transform = this.root.addComponent(UITransform);
        transform.setContentSize(size, size);
        transform.setAnchorPoint(.5, 18 / 256);
        this.sprite = this.root.addComponent(Sprite); this.sprite.sizeMode = Sprite.SizeMode.CUSTOM; this.sprite.trim = false;
        this.blend = new BattleReplayFrameBlend(this.sprite,assets.blendEffect,size);
        this.base = side === 1 ? new Color(255, 250, 236) : new Color(227, 232, 229);
        const shade = new Node('GroundContact'); shade.layer = parent.layer; parent.addChild(shade); shade.setSiblingIndex(0);
        shade.addComponent(UITransform); const g = shade.addComponent(Graphics);
        const width = size * (kind === 'cavalry' ? .22 : .11);
        for (const [radius, alpha] of [[1, 18], [.74, 25], [.48, 35]]) {
            g.fillColor = new Color(28, 25, 15, alpha); g.ellipse(0, 0, width * radius, width * radius * .34); g.fill();
        }
        this.face(side === 1 ? 1 : -1, side === 1 ? .5 : -.5);
        this.animate('idle', 0, 0, true);
    }
    face(x: number, y: number): void {
        if (Math.hypot(x, y) < .001) return;
        const length = Math.hypot(x, y); this.headingX = x / length; this.headingY = y / length;
        this.direction = (Math.round(Math.atan2(y * 2, x) / (Math.PI / 4)) + 8) % 8;
    }
    animate(motion: PaintedMotion, seconds: number, step: number, snap = false): void {
        const walking = motion === 'march' || motion === 'rush', attack = ['attack', 'sweep', 'slash'].indexOf(motion) >= 0;
        const commanding = motion === 'command' || motion === 'rally' || motion === 'cast';
        const guard = attack || commanding || motion === 'guard' || motion === 'shoot';
        const t = Math.max(0, seconds), clip = PAINTED_CLIPS[motion];
        const progress = Math.min(1,t/clip.duration);
        const release = motion === 'shoot' ? .46 : clip.impact || .5;
        let mirror: boolean, from: SpriteFrame, to: SpriteFrame, mix = 0;
        if (this.kind === 'archer') {
            const row = this.headingY >= 0 ? 0 : 1;
            if (motion === 'shoot') {
                const sample = sampleReplayFrames(t,clip.duration,ATTACK_POSES,STRIKE_TIMES.shoot);
                from = this.assets.archerAttack[row*8+sample.from];to = this.assets.archerAttack[row*8+sample.to];mix=sample.mix;
            } else if (walking) {
                const sample=sampleReplayFrames(t,clip.duration,[0,3],undefined,true);
                from=this.assets.archer[row*4+sample.from];to=this.assets.archer[row*4+sample.to];mix=sample.mix;
            } else from=to=this.assets.archer[row*4+(guard||motion==='hit'||motion==='fall'?1:0)];
            mirror = this.headingX < 0;
        } else if (attack || commanding || motion === 'guard' || motion === 'hit' || motion === 'fall') {
            const offset=(this.headingY>=0?0:1)*8;
            const frames=this.kind==='cavalry'?this.assets.cavalryAttack:this.assets.infantryAttack;
            if (attack || commanding || motion==='guard') {
                const sample=sampleReplayFrames(t,clip.duration,attack?ATTACK_POSES:commanding?COMMAND_POSES:BRACE_POSES,
                    attack?STRIKE_TIMES[motion]:commanding?COMMAND_TIMES:BRACE_TIMES);
                from=frames[offset+sample.from];to=frames[offset+sample.to];mix=sample.mix;
            } else from=to=frames[offset];
            mirror=this.headingX<0;
        } else {
            const set=this.assets[this.kind],frames=set.walkFrames[this.direction];
            if(walking){
                if(!WALK_POSES.has(frames.length))WALK_POSES.set(frames.length,frames.map((_,i)=>i));
                const sample=sampleReplayFrames(t,clip.duration,WALK_POSES.get(frames.length),undefined,true);
                from=frames[sample.from];to=frames[sample.to];mix=sample.mix;
            } else from=to=guard?set.guardFrames?.[this.direction]||set.idleFrames[this.direction]:set.idleFrames[this.direction];
            mirror=set.mirrored[this.direction];
        }
        let x = 0, y = 0, angle = 0, stretch = 1;
        const facing = this.headingX > 0 ? -1 : 1;
        if (attack) {
            const anticipation = release * .68;
            let push: number;
            if (progress < anticipation) push = -.026 * easeMotion(progress / anticipation);
            else if (progress < release) push = -.026 + .116 * easeMotion((progress - anticipation) / (release - anticipation));
            else push = .09 * (1 - easeMotion((progress - release) / (1 - release)));
            x = this.headingX * push * this.size; y = this.headingY * push * this.size;
        } else if (motion === 'hit') {
            const recoil = progress < .16 ? easeMotion(progress / .16) : 1 - easeMotion((progress - .16) / .84);
            x = -this.headingX * recoil * this.size * .07;
            y = -this.headingY * recoil * this.size * .07;
            angle = -facing * recoil * 5; stretch = 1 - recoil * .02;
        } else if (motion === 'fall') {
            const fall = easeMotion(t / .65);
            x = -this.headingX * fall * this.size * .08;
            y = -this.headingY * fall * this.size * .04 - fall * this.size * .035;
            angle = -facing * fall * 14; stretch = 1 - fall * .08;
        } else if (motion === 'idle' || motion === 'guard') {
            // 脚底固定，只保留极轻的呼吸，不再整队僵立或上下漂浮。
            stretch = 1 + Math.sin(t * Math.PI / 1.2) * .005;
        } else if (motion === 'command' || motion === 'rally' || motion === 'cast') {
            const gesture = Math.sin(progress * Math.PI);
            angle = facing * gesture * 2; stretch = 1 + gesture * .012;
        }
        const sign=mirror?-1:1, dominant=mix>=.5?to:from;
        if(!snap && step>0 && this.lastFrame && (motion!==this.lastMotion || sign!==this.lastMirror)){
            this.outgoing=this.lastFrame;this.outgoingMirror=this.lastMirror;this.transitionAge=0;
            for(let i=0;i<4;i++)this.previousPose[i]=this.lastPose[i];
        }
        if(snap){this.outgoing=null;this.transitionAge=1;}
        let oldMirror=1;
        if(this.outgoing){
            if(seconds!==this.lastSeconds||motion!==this.lastMotion)this.transitionAge+=Math.max(0,step);
            const transition=easeMotion(this.transitionAge/.075);
            if(transition<1){
                from=this.outgoing;to=dominant;mix=transition;oldMirror=this.outgoingMirror/sign;
                x=this.previousPose[0]+(x-this.previousPose[0])*transition;
                y=this.previousPose[1]+(y-this.previousPose[1])*transition;
                angle=this.previousPose[2]+(angle-this.previousPose[2])*transition;
                stretch=this.previousPose[3]+(stretch-this.previousPose[3])*transition;
            }else this.outgoing=null;
        }
        this.blend.draw(from,to,mix,oldMirror);
        this.root.setPosition(x,y);this.root.setRotationFromEuler(0,0,angle);this.root.setScale(sign,stretch,1);
        this.lastFrame=dominant;this.lastMirror=sign;this.lastMotion=motion;this.lastSeconds=seconds;
        this.lastPose[0]=x;this.lastPose[1]=y;this.lastPose[2]=angle;this.lastPose[3]=stretch;
        this.sprite.color = motion === 'hit' && t < .16 ? new Color(255, 210, 183)
            : motion === 'fall' ? new Color(169, 162, 142) : this.base;
    }
    destroy(): void { this.blend.destroy(); }
}