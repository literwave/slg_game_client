import {
    Color,
    Component,
    Graphics,
    Label,
    Node,
    Tween,
    tween,
    UIOpacity,
    UITransform,
    Vec3,
    _decorator,
} from 'cc';
import { AudioManager } from '../common/AudioManager';
import { caption } from '../map/ui/ManagementStyle';

const { ccclass } = _decorator;

interface FxParticle {
    kind: 'spark' | 'dust' | 'mote';
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    age: number;
    life: number;
    color: Color;
}

interface ImpactFlash {
    x: number;
    y: number;
    age: number;
    life: number;
}

interface HammerUnit {
    pivot: Node;
    graphics: Graphics;
    opacity: UIOpacity;
    /** +1 表示位于建筑右侧向左挥砸；-1 表示位于建筑左侧镜像向右挥砸 */
    facing: 1 | -1;
    baseScale: number;
    phaseOffset: number;
    strikeTimes: number[];
    nextStrikeIndex: number;
    impactX: number;
    impactY: number;
}

interface PendingCompletion {
    name: string;
    fromLv: number;
    toLv: number;
    onReveal?: () => void;
    onFinish?: () => void;
}

const SWING_CYCLE = 0.44;
const CONSTRUCTION_DURATION = 1.24;
const MAX_WAIT_WITHOUT_SERVER = 2.6;

/**
 * 内城双锤交替营造 / 升级工坊动效组件：
 * - 空地可建态：精巧单锤翡翠鎏金微标轻盈呼吸，克制不杂乱；
 * - 施工营造态：方正汉式木架脚手架 + 左右双把精工铁木锤交替节奏敲击（左-右-左-右）+ 火星/星芒/扬尘/迷你进度条；
 * - 落成竣工态：金色天光柱 + 方正切角扩散金环 + 上升金尘 + 木槌/铜磬和鸣。
 */
@ccclass('InnerCityConstructionFx')
export class InnerCityConstructionFx extends Component {
    private plotWidth = 240;
    private plotHeight = 200;
    private groundOffsetY = -8;
    private baseCenterY = -12;

    private idleBadgeNode!: Node;
    private idleBadgeGraphics!: Graphics;
    private idleBadgeOpacity!: UIOpacity;

    private scaffoldNode!: Node;
    private scaffoldGraphics!: Graphics;
    private scaffoldOpacity!: UIOpacity;

    private progressNode!: Node;
    private progressGraphics!: Graphics;
    private progressLabel!: Label;

    private hammersContainer!: Node;
    private hammers: HammerUnit[] = [];

    private particleNode!: Node;
    private particleGraphics!: Graphics;

    private burstNode!: Node;
    private burstGraphics!: Graphics;

    private idleVisible = false;
    private idlePhase = 0;

    private constructing = false;
    private isNewBuild = false;
    private buildElapsed = 0;
    private totalStrikes = 0;
    private completion: PendingCompletion | null = null;
    private onStrikeCallback: ((strikeIndex: number, isNewBuild: boolean) => void) | null = null;

    private burstActive = false;
    private burstAge = 0;
    private readonly burstDuration = 0.72;

    private particles: FxParticle[] = [];
    private flashes: ImpactFlash[] = [];
    private static sharedAudioCtx: AudioContext | null = null;

    public initialize(width: number, height: number, groundOffsetY: number): void {
        this.plotWidth = width;
        this.plotHeight = height;
        this.groundOffsetY = groundOffsetY;
        const bottomY = -height * 0.34 + groundOffsetY;
        const rx = width * 0.48;
        this.baseCenterY = bottomY + rx * 0.50;

        // 1. 脚手架层（紧贴建筑 2:1 菱形基座）
        this.scaffoldNode = this.createChild('Scaffold', this.node);
        this.scaffoldGraphics = this.scaffoldNode.addComponent(Graphics);
        this.scaffoldOpacity = this.scaffoldNode.addComponent(UIOpacity);
        this.scaffoldNode.active = false;

        // 2. 落成光柱与等距扩散光环层
        this.burstNode = this.createChild('CompletionBurst', this.node);
        this.burstGraphics = this.burstNode.addComponent(Graphics);
        this.burstNode.active = false;

        // 3. 空地可建悬浮交叉金锤徽章
        this.idleBadgeNode = this.createChild('BuildableHammerBadge', this.node);
        this.idleBadgeGraphics = this.idleBadgeNode.addComponent(Graphics);
        this.idleBadgeOpacity = this.idleBadgeNode.addComponent(UIOpacity);
        this.drawIdleHammerBadge();
        this.idleBadgeNode.active = false;

        // 4. 粒子特效层（多点火星、施工尘烟、击打星芒、竣工金尘）
        this.particleNode = this.createChild('ConstructionParticles', this.node);
        this.particleGraphics = this.particleNode.addComponent(Graphics);

        // 5. 多把工匠铁木大锤容器（常规建筑 3 把，主城/城墙等大型建筑 4 把，左右错峰齐敲）
        this.hammersContainer = this.createChild('MultiHammerSquad', this.node);
        this.buildHammerSquad();
        this.hammersContainer.active = false;

        // 6. 施工进度迷你浮条
        this.progressNode = this.createChild('BuildProgressBar', this.node);
        this.progressGraphics = this.progressNode.addComponent(Graphics);
        this.progressLabel = caption(
            this.progressNode,
            'Label',
            '工匠营造中…',
            0,
            13,
            124,
            11,
            new Color(255, 232, 166, 255),
            Label.HorizontalAlign.CENTER,
        );
        this.progressLabel.isBold = true;
        this.progressLabel.outlineColor = new Color(18, 12, 6, 255);
        this.progressLabel.outlineWidth = 1.6;
        this.progressNode.active = false;
    }

    public get isConstructing(): boolean {
        return this.constructing;
    }

    /** 控制空地可建时的悬浮金锤徽章显隐。 */
    public setBuildableHint(visible: boolean): void {
        this.idleVisible = visible;
        if (!this.idleBadgeNode?.isValid) return;
        this.idleBadgeNode.active = visible && !this.constructing;
    }

    /**
     * 立即启动多锤齐敲施工动画（点击“建造/升级”后立刻响应，3~4 把铁木大锤围拢错峰敲击）。
     */
    public beginConstruction(
        isNewBuild: boolean,
        onStrike?: (strikeIndex: number, isNewBuild: boolean) => void,
    ): void {
        this.constructing = true;
        this.isNewBuild = isNewBuild;
        this.buildElapsed = 0;
        this.totalStrikes = 0;
        this.flashes.length = 0;
        this.completion = null;
        this.onStrikeCallback = onStrike || null;

        this.idleBadgeNode.active = false;

        // 绘制并升起木架脚手架
        this.drawScaffolding();
        this.scaffoldNode.active = true;
        Tween.stopAllByTarget(this.scaffoldNode);
        Tween.stopAllByTarget(this.scaffoldOpacity);
        this.scaffoldNode.setScale(1, 0.28, 1);
        this.scaffoldOpacity.opacity = 0;
        tween(this.scaffoldNode).to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        tween(this.scaffoldOpacity).to(0.14, { opacity: 242 }).start();

        // 依次弹出 3~4 把围拢工匠大锤
        this.hammersContainer.active = true;
        this.hammers.forEach((h, idx) => {
            h.nextStrikeIndex = 0;
            h.pivot.active = true;
            Tween.stopAllByTarget(h.pivot);
            Tween.stopAllByTarget(h.opacity);
            const sx = h.facing * h.baseScale;
            h.pivot.setScale(sx * 0.55, h.baseScale * 0.55, 1);
            h.pivot.setRotationFromEuler(0, 0, h.facing * -38);
            h.opacity.opacity = 0;
            tween(h.pivot)
                .delay(idx * 0.04)
                .to(0.14, { scale: new Vec3(sx, h.baseScale, 1) }, { easing: 'backOut' })
                .start();
            tween(h.opacity)
                .delay(idx * 0.04)
                .to(0.12, { opacity: 255 })
                .start();
        });

        // 显示迷你施工进度条
        this.progressNode.active = true;
        this.progressNode.setPosition(0, this.plotHeight * 0.42, 0);
        this.progressLabel.string = isNewBuild ? '众匠营造中…' : '众匠修缮中…';
        this.drawProgressBar(0.05);

        // 起手扬起一圈破土尘烟
        this.spawnDustBurst(0, this.baseCenterY - 12, 8);
    }

    /**
     * 收到服务端升级成功回包后调用：
     * - 若当前正在多锤施工，会在完成完整三轮齐敲后顺滑衔接落成庆典；
     * - 若是从外部（如营造路线图）触发的升级，则自动补播完整多锤施工 + 落成庆典。
     */
    public finishConstruction(
        name: string,
        fromLv: number,
        toLv: number,
        onStrike?: (strikeIndex: number, isNewBuild: boolean) => void,
        onReveal?: () => void,
        onFinish?: () => void,
    ): void {
        if (!this.constructing) {
            this.beginConstruction(fromLv <= 0, onStrike);
        } else if (onStrike) {
            this.onStrikeCallback = onStrike;
        }
        this.completion = { name, fromLv, toLv, onReveal, onFinish };
    }

    /** 异常超时或切离内城时清理施工状态。 */
    public cancelConstruction(): void {
        this.constructing = false;
        this.completion = null;
        this.onStrikeCallback = null;
        this.burstActive = false;
        this.particles.length = 0;
        this.flashes.length = 0;
        if (this.scaffoldNode?.isValid) this.scaffoldNode.active = false;
        if (this.hammersContainer?.isValid) this.hammersContainer.active = false;
        if (this.progressNode?.isValid) this.progressNode.active = false;
        if (this.burstNode?.isValid) this.burstNode.active = false;
        if (this.particleGraphics?.isValid) this.particleGraphics.clear();
        if (this.idleBadgeNode?.isValid) this.idleBadgeNode.active = this.idleVisible;
    }

    protected update(dt: number): void {
        const clampedDt = Math.min(0.05, Math.max(0, dt));

        // 1. 空地悬浮双锤徽章呼吸浮动
        if (this.idleVisible && !this.constructing && this.idleBadgeNode?.isValid && this.idleBadgeNode.active) {
            this.idlePhase += clampedDt * 2.5;
            const bob = Math.sin(this.idlePhase) * 4.0;
            const scale = 0.96 + 0.05 * Math.sin(this.idlePhase * 1.2);
            this.idleBadgeNode.setPosition(0, this.baseCenterY + 10 + bob, 0);
            this.idleBadgeNode.setScale(scale, scale, 1);
            this.idleBadgeOpacity.opacity = Math.round(215 + 40 * Math.sin(this.idlePhase));
        }

        // 2. 多把大锤交错齐敲施工
        if (this.constructing) {
            this.buildElapsed += clampedDt;
            this.updateHammersMotion();

            const ratio = Math.min(0.98, this.buildElapsed / CONSTRUCTION_DURATION);
            this.drawProgressBar(ratio);

            // 逐把检测各自的落锤时刻，产生此起彼伏的“咚-哒-铿！”工坊齐鸣
            for (let i = 0; i < this.hammers.length; i++) {
                const h = this.hammers[i];
                while (h.nextStrikeIndex < h.strikeTimes.length && this.buildElapsed >= h.strikeTimes[h.nextStrikeIndex]) {
                    h.nextStrikeIndex += 1;
                    this.triggerHammerStrike(h, i);
                }
            }

            if (this.completion && this.buildElapsed >= CONSTRUCTION_DURATION) {
                this.concludeWithCelebration();
            } else if (!this.completion && this.buildElapsed >= MAX_WAIT_WITHOUT_SERVER) {
                this.cancelConstruction();
            }
        }

        // 3. 落成光柱与 2:1 等距扩散光环
        if (this.burstActive) {
            this.burstAge += clampedDt;
            const t = Math.min(1, this.burstAge / this.burstDuration);
            this.drawCompletionBurst(t);
            if (t >= 1) {
                this.burstActive = false;
                this.burstNode.active = false;
                this.burstGraphics.clear();
            }
        }

        // 4. 更新火星 / 尘烟 / 多点星芒 / 竣工金尘
        if (this.particles.length > 0 || this.flashes.length > 0) {
            this.updateAndDrawParticles(clampedDt);
        } else if (this.particleGraphics?.isValid) {
            this.particleGraphics.clear();
        }
    }

    /** 构造左右对称双工匠大锤（克制干练，交替挥砸不杂乱）。 */
    private buildHammerSquad(): void {
        const w = this.plotWidth;
        const h = this.plotHeight;
        const large = w >= 360;
        const cy = this.baseCenterY;

        // 左右各一把精工锤，围绕建筑屋脊/院落中心错峰半拍交替重击（左-右-左-右）
        const configs: Array<{
            x: number;
            y: number;
            facing: 1 | -1;
            scale: number;
            offset: number;
        }> = [
            // 右侧主锤（向左挥砸）
            { x: w * 0.20, y: cy + h * 0.14, facing: 1, scale: large ? 0.88 : 0.78, offset: 0.00 },
            // 左侧副锤（半拍错峰向右挥砸）
            { x: -w * 0.20, y: cy + h * 0.14, facing: -1, scale: large ? 0.86 : 0.76, offset: SWING_CYCLE * 0.50 },
        ];

        this.hammers = configs.map((cfg, idx) => {
            const pivot = this.createChild(`HammerPivot_${idx}`, this.hammersContainer);
            pivot.setPosition(cfg.x, cfg.y, 0);
            const graphics = pivot.addComponent(Graphics);
            const opacity = pivot.addComponent(UIOpacity);
            this.drawArtisanHammer(graphics);

            // 每把锤在施工期内完成 2 次干脆重击（双锤合计 4 记清脆节奏敲击）
            const strikeTimes = [0, 1].map(wave => cfg.offset + wave * SWING_CYCLE + SWING_CYCLE * 0.58);
            const reach = 32 * cfg.scale;
            const impactX = cfg.x - cfg.facing * reach;
            const impactY = cfg.y + 16 * cfg.scale;

            return {
                pivot,
                graphics,
                opacity,
                facing: cfg.facing,
                baseScale: cfg.scale,
                phaseOffset: cfg.offset,
                strikeTimes,
                nextStrikeIndex: 0,
                impactX,
                impactY,
            };
        });
    }

    /** 分别驱动每把锤子的蓄力后仰→凌厉下砸→微弹动作。 */
    private updateHammersMotion(): void {
        for (const h of this.hammers) {
            if (!h.pivot?.isValid) continue;
            const localT = this.buildElapsed - h.phaseOffset;
            if (localT < 0) {
                h.pivot.setRotationFromEuler(0, 0, h.facing * -32);
                continue;
            }
            const phase = (localT % SWING_CYCLE) / SWING_CYCLE;
            let angleDeg = -36;
            if (phase < 0.44) {
                // 蓄力后仰
                const u = phase / 0.44;
                const eased = 1 - Math.pow(1 - u, 2);
                angleDeg = -10 - eased * 44; // -10 -> -54
            } else if (phase < 0.62) {
                // 凌厉下砸
                const u = (phase - 0.44) / 0.18;
                const eased = u * u * u;
                angleDeg = -54 + eased * 94; // -54 -> +40
            } else {
                // 撞击回弹
                const u = (phase - 0.62) / 0.38;
                const eased = 1 - Math.pow(1 - u, 2);
                angleDeg = 40 - eased * 50; // +40 -> -10
            }
            // 左侧镜像锤的 scaleX = -1，对应旋转角度自动反向向内挥击
            h.pivot.setRotationFromEuler(0, 0, h.facing * angleDeg);
        }
    }

    private triggerHammerStrike(hammer: HammerUnit, hammerIdx: number): void {
        const strikeCount = this.totalStrikes;
        this.totalStrikes += 1;

        // 1. 该锤独立击打星芒闪光
        this.flashes.push({
            x: hammer.impactX,
            y: hammer.impactY,
            age: 0,
            life: 0.16,
        });

        // 2. 该锤击打点迸发 7 颗炽金火星
        for (let i = 0; i < 7; i++) {
            const ang = (Math.PI * 0.12) + Math.random() * (Math.PI * 1.15);
            const speed = 105 + Math.random() * 140;
            this.particles.push({
                kind: 'spark',
                x: hammer.impactX + (Math.random() - 0.5) * 10,
                y: hammer.impactY + (Math.random() - 0.5) * 8,
                vx: Math.cos(ang) * speed,
                vy: Math.sin(ang) * speed + 42,
                size: 2.0 + Math.random() * 2.0,
                age: 0,
                life: 0.26 + Math.random() * 0.16,
                color: i % 3 === 0 ? new Color(255, 250, 224, 255) : new Color(255, 198, 86, 255),
            });
        }

        // 3. 脚下基座扬起 4 团施工尘烟
        this.spawnDustBurst(hammer.impactX * 0.35, this.baseCenterY - 10, 4);

        // 4. 错峰音高木槌+铜铁敲击声
        this.playHammerStrikeTone(hammerIdx, strikeCount);

        // 5. 通知建筑本体逐锤拔地而起 / 受击轻颤
        this.onStrikeCallback?.(strikeCount, this.isNewBuild);
    }

    private concludeWithCelebration(): void {
        const info = this.completion;
        this.constructing = false;
        this.completion = null;
        this.onStrikeCallback = null;

        this.drawProgressBar(1);

        // 脚手架与所有工匠大锤优雅收起
        if (this.scaffoldNode?.isValid) {
            Tween.stopAllByTarget(this.scaffoldNode);
            Tween.stopAllByTarget(this.scaffoldOpacity);
            tween(this.scaffoldNode).to(0.22, { scale: new Vec3(1.04, 0.25, 1) }, { easing: 'quadIn' }).start();
            tween(this.scaffoldOpacity)
                .to(0.22, { opacity: 0 })
                .call(() => { if (this.scaffoldNode?.isValid) this.scaffoldNode.active = false; })
                .start();
        }
        this.hammers.forEach(h => {
            if (!h.pivot?.isValid) return;
            Tween.stopAllByTarget(h.pivot);
            Tween.stopAllByTarget(h.opacity);
            const sx = h.facing * h.baseScale * 0.48;
            tween(h.pivot).to(0.20, { scale: new Vec3(sx, h.baseScale * 0.48, 1) }, { easing: 'quadIn' }).start();
            tween(h.opacity)
                .to(0.20, { opacity: 0 })
                .call(() => { if (h.pivot?.isValid) h.pivot.active = false; })
                .start();
        });
        if (this.progressNode?.isValid) {
            this.progressNode.active = false;
        }

        // 触发落成光柱、等距金环与上升金尘
        this.burstActive = true;
        this.burstAge = 0;
        this.burstNode.active = true;
        this.spawnCelebrationMotes();
        this.playCompletionChime();

        info?.onReveal?.();
        info?.onFinish?.();

        if (this.idleBadgeNode?.isValid) {
            this.idleBadgeNode.active = this.idleVisible;
        }
    }

    private spawnDustBurst(cx: number, cy: number, count: number): void {
        const spreadX = this.plotWidth * 0.32;
        for (let i = 0; i < count; i++) {
            const side = count <= 1 ? (Math.random() * 2 - 1) : (i / (count - 1)) * 2 - 1;
            const px = cx + side * spreadX * (0.4 + Math.random() * 0.55);
            const py = cy + (Math.random() - 0.5) * 18;
            this.particles.push({
                kind: 'dust',
                x: px,
                y: py,
                vx: side * (22 + Math.random() * 30),
                vy: 16 + Math.random() * 24,
                size: 10 + Math.random() * 10,
                age: 0,
                life: 0.40 + Math.random() * 0.22,
                color: new Color(236, 224, 194, 168),
            });
        }
    }

    private spawnCelebrationMotes(): void {
        const spreadX = this.plotWidth * 0.36;
        for (let i = 0; i < 16; i++) {
            this.particles.push({
                kind: 'mote',
                x: (Math.random() - 0.5) * spreadX * 2,
                y: this.baseCenterY - 12 + Math.random() * (this.plotHeight * 0.42),
                vx: (Math.random() - 0.5) * 24,
                vy: 44 + Math.random() * 54,
                size: 2.8 + Math.random() * 2.8,
                age: 0,
                life: 0.62 + Math.random() * 0.36,
                color: i % 2 === 0 ? new Color(255, 228, 134, 255) : new Color(255, 248, 210, 255),
            });
        }
    }

    private updateAndDrawParticles(dt: number): void {
        const g = this.particleGraphics;
        if (!g?.isValid) return;
        g.clear();

        // 多点并发击打星芒闪光
        const nextFlashes: ImpactFlash[] = [];
        for (const f of this.flashes) {
            f.age += dt;
            if (f.age >= f.life) continue;
            const k = 1 - f.age / f.life;
            const r = 9 + (1 - k) * 22;
            g.fillColor = new Color(255, 244, 192, Math.round(150 * k));
            g.circle(f.x, f.y, r * 0.38);
            g.fill();
            g.strokeColor = new Color(255, 222, 118, Math.round(235 * k));
            g.lineWidth = 1.9;
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI * 2 * i) / 6 + 0.35;
                g.moveTo(f.x + Math.cos(a) * (r * 0.30), f.y + Math.sin(a) * (r * 0.30));
                g.lineTo(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r);
            }
            g.stroke();
            nextFlashes.push(f);
        }
        this.flashes = nextFlashes;

        const next: FxParticle[] = [];
        for (const p of this.particles) {
            p.age += dt;
            if (p.age >= p.life) continue;
            const u = p.age / p.life;
            const alphaFactor = 1 - u;

            if (p.kind === 'spark') {
                p.vy -= 520 * dt;
                const px = p.x;
                const py = p.y;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                g.strokeColor = new Color(p.color.r, p.color.g, p.color.b, Math.round(255 * alphaFactor));
                g.lineWidth = Math.max(1.2, p.size * alphaFactor);
                g.moveTo(px, py);
                g.lineTo(p.x, p.y);
                g.stroke();
            } else if (p.kind === 'dust') {
                p.vx *= Math.exp(-2.8 * dt);
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                const r = p.size * (0.72 + u * 0.95);
                g.fillColor = new Color(p.color.r, p.color.g, p.color.b, Math.round(p.color.a * alphaFactor * alphaFactor));
                g.circle(p.x, p.y, r);
                g.fill();
            } else {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                const r = p.size * (0.65 + 0.55 * Math.sin(u * Math.PI));
                g.fillColor = new Color(p.color.r, p.color.g, p.color.b, Math.round(240 * Math.sin(u * Math.PI)));
                g.moveTo(p.x, p.y + r * 1.45);
                g.lineTo(p.x + r, p.y);
                g.lineTo(p.x, p.y - r * 1.45);
                g.lineTo(p.x - r, p.y);
                g.close();
                g.fill();
            }
            next.push(p);
        }
        this.particles = next;
    }

    /** 绘制落成瞬间金色光柱与方正切角扩散光环。 */
    private drawCompletionBurst(t: number): void {
        const g = this.burstGraphics;
        if (!g?.isValid) return;
        g.clear();
        const cy = this.baseCenterY;
        const easeOut = 1 - Math.pow(1 - t, 3);
        const fade = Math.max(0, 1 - t);

        const pillarW = this.plotWidth * (0.40 - t * 0.14);
        const pillarH = this.plotHeight * (0.85 + easeOut * 0.55);
        g.fillColor = new Color(255, 224, 130, Math.round(82 * fade * fade));
        g.rect(-pillarW * 0.5, cy - 16, pillarW, pillarH);
        g.fill();
        g.fillColor = new Color(255, 246, 206, Math.round(68 * fade * fade));
        g.rect(-pillarW * 0.20, cy - 16, pillarW * 0.40, pillarH * 1.12);
        g.fill();

        const rw = this.plotWidth * (0.62 + easeOut * 0.56);
        const rh = this.plotHeight * (0.56 + easeOut * 0.48);
        g.strokeColor = new Color(255, 224, 132, Math.round(230 * fade));
        g.lineWidth = Math.max(1.2, 3.6 * fade);
        g.roundRect(-rw * 0.5, cy - rh * 0.5, rw, rh, 12);
        g.stroke();

        const rw2 = this.plotWidth * (0.46 + easeOut * 0.40);
        const rh2 = this.plotHeight * (0.42 + easeOut * 0.34);
        g.strokeColor = new Color(255, 244, 198, Math.round(150 * fade));
        g.lineWidth = Math.max(1, 1.8 * fade);
        g.roundRect(-rw2 * 0.5, cy - rh2 * 0.5, rw2, rh2, 10);
        g.stroke();
    }

    /** 绘制贴合方正汉式院落的木质营造脚手架（四柱两层横梁 + 交叉斜撑 + 麻绳结）。 */
    private drawScaffolding(): void {
        const g = this.scaffoldGraphics;
        if (!g?.isValid) return;
        g.clear();

        const cy = this.baseCenterY;
        const hw = Math.min(132, this.plotWidth * 0.38);
        const frontY = cy - Math.min(48, this.plotHeight * 0.24);
        const backY = cy + Math.min(34, this.plotHeight * 0.16);
        const postH = Math.min(92, this.plotHeight * 0.44);

        const fl = { x: -hw, y: frontY };
        const fr = { x: hw, y: frontY };
        const bl = { x: -hw * 0.90, y: backY };
        const br = { x: hw * 0.90, y: backY };

        const timberDark = new Color(92, 60, 32, 226);
        const timberMid = new Color(142, 98, 52, 236);
        const timberLight = new Color(188, 144, 86, 228);
        const ropeColor = new Color(224, 196, 134, 238);

        // 后排轻景支架
        g.strokeColor = new Color(104, 72, 40, 160);
        g.lineWidth = 3.0;
        for (const p of [bl, br]) {
            g.moveTo(p.x, p.y);
            g.lineTo(p.x, p.y + postH * 0.88);
        }
        g.moveTo(bl.x, bl.y + postH * 0.62);
        g.lineTo(br.x, br.y + postH * 0.62);
        g.stroke();

        // 前排左右主立柱（带高光边）
        g.strokeColor = timberDark;
        g.lineWidth = 4.6;
        for (const p of [fl, fr]) {
            g.moveTo(p.x, p.y);
            g.lineTo(p.x, p.y + postH);
        }
        g.stroke();
        g.strokeColor = timberMid;
        g.lineWidth = 2.4;
        for (const p of [fl, fr]) {
            g.moveTo(p.x - 0.8, p.y);
            g.lineTo(p.x - 0.8, p.y + postH);
        }
        g.stroke();

        // 两层水平脚手架横梁 + 侧连杆
        for (const hRatio of [0.36, 0.78]) {
            const h = postH * hRatio;
            g.strokeColor = timberDark;
            g.lineWidth = 3.8;
            g.moveTo(fl.x - 6, fl.y + h);
            g.lineTo(fr.x + 6, fr.y + h);
            g.moveTo(fl.x, fl.y + h);
            g.lineTo(bl.x, bl.y + h * 0.90);
            g.moveTo(fr.x, fr.y + h);
            g.lineTo(br.x, br.y + h * 0.90);
            g.stroke();

            g.strokeColor = timberLight;
            g.lineWidth = 1.6;
            g.moveTo(fl.x - 4, fl.y + h + 1);
            g.lineTo(fr.x + 4, fr.y + h + 1);
            g.stroke();
        }

        // 左右交叉木斜撑
        g.strokeColor = timberMid;
        g.lineWidth = 2.0;
        g.moveTo(fl.x, fl.y + postH * 0.36);
        g.lineTo(fl.x + hw * 0.42, fl.y + postH * 0.78);
        g.moveTo(fr.x, fr.y + postH * 0.36);
        g.lineTo(fr.x - hw * 0.42, fr.y + postH * 0.78);
        g.stroke();

        // 麻绳绑扎结
        g.fillColor = ropeColor;
        for (const p of [fl, fr]) {
            for (const hRatio of [0.36, 0.78]) {
                g.circle(p.x, p.y + postH * hRatio, 2.5);
            }
        }
        g.fill();
    }

    /** 绘制精致汉风工匠铁木大锤（绕原点握柄末端摆动）。 */
    private drawArtisanHammer(g: Graphics): void {
        if (!g?.isValid) return;
        g.clear();

        // 柔和投影
        g.fillColor = new Color(14, 10, 6, 82);
        g.roundRect(-2.5, 4, 8, 44, 3);
        g.fill();
        g.roundRect(-21, 37, 45, 21, 5);
        g.fill();

        // 胡桃木长柄
        g.fillColor = new Color(118, 72, 34, 255);
        g.strokeColor = new Color(54, 30, 12, 255);
        g.lineWidth = 1.6;
        g.moveTo(-4, 0);
        g.lineTo(4, 0);
        g.lineTo(5, 45);
        g.lineTo(-5, 45);
        g.close();
        g.fill();
        g.stroke();

        g.fillColor = new Color(172, 118, 62, 210);
        g.rect(-2.5, 4, 2.4, 38);
        g.fill();

        g.fillColor = new Color(214, 172, 88, 255);
        g.roundRect(-5, -2, 10, 6, 2);
        g.fill();
        g.strokeColor = new Color(68, 40, 18, 220);
        g.lineWidth = 1.6;
        for (const y of [8, 13, 18]) {
            g.moveTo(-4.2, y);
            g.lineTo(4.2, y + 2);
        }
        g.stroke();

        // 锻铁鎏金重锤头
        g.fillColor = new Color(76, 82, 88, 255);
        g.strokeColor = new Color(30, 26, 22, 255);
        g.lineWidth = 1.8;
        g.moveTo(-22, 41);
        g.lineTo(-18, 37);
        g.lineTo(18, 37);
        g.lineTo(23, 42);
        g.lineTo(23, 55);
        g.lineTo(18, 59);
        g.lineTo(-18, 59);
        g.lineTo(-22, 54);
        g.close();
        g.fill();
        g.stroke();

        g.fillColor = new Color(174, 186, 196, 220);
        g.moveTo(-17, 56.5);
        g.lineTo(17, 56.5);
        g.lineTo(15, 51.5);
        g.lineTo(-15, 51.5);
        g.close();
        g.fill();

        g.fillColor = new Color(224, 182, 92, 255);
        g.strokeColor = new Color(96, 66, 24, 240);
        g.lineWidth = 1.2;
        g.rect(-6.5, 37, 13, 22);
        g.fill();
        g.stroke();

        g.fillColor = new Color(246, 232, 182, 235);
        g.rect(-21.5, 42, 4.2, 12);
        g.fill();
    }

    /** 绘制空地可建态精巧单锤翡翠鎏金微标（克制清爽，避免满屏锤子堆叠）。 */
    private drawIdleHammerBadge(): void {
        const g = this.idleBadgeGraphics;
        if (!g?.isValid) return;
        g.clear();

        // 外圈轻柔暖金光晕
        g.fillColor = new Color(246, 212, 124, 30);
        g.circle(0, 0, 17);
        g.fill();

        // 投影
        g.fillColor = new Color(10, 12, 8, 102);
        g.circle(0, -1.8, 12.6);
        g.fill();

        // 墨玉圆印 + 细金边
        g.fillColor = new Color(24, 40, 26, 232);
        g.strokeColor = new Color(242, 210, 132, 246);
        g.lineWidth = 1.45;
        g.circle(0, 0, 12.2);
        g.fill();
        g.stroke();

        // 单把斜置精致工匠小金锤
        g.strokeColor = new Color(238, 198, 110, 255);
        g.lineWidth = 2.2;
        g.moveTo(-5.2, -5.2);
        g.lineTo(3.2, 3.2);
        g.stroke();

        g.fillColor = new Color(255, 242, 188, 255);
        g.strokeColor = new Color(104, 72, 22, 255);
        g.lineWidth = 0.85;
        g.moveTo(-0.5, 6.8);
        g.lineTo(2.2, 7.8);
        g.lineTo(7.4, 2.6);
        g.lineTo(6.2, -0.2);
        g.lineTo(3.2, -0.8);
        g.lineTo(-1.4, 3.8);
        g.close();
        g.fill();
        g.stroke();
    }

    private drawProgressBar(progress: number): void {
        const g = this.progressGraphics;
        if (!g?.isValid) return;
        g.clear();
        const w = 96;
        const h = 9;
        const hw = w * 0.5;
        const hh = h * 0.5;
        g.fillColor = new Color(18, 20, 15, 228);
        g.strokeColor = new Color(214, 180, 106, 220);
        g.lineWidth = 1.2;
        g.roundRect(-hw, -hh, w, h, 4);
        g.fill();
        g.stroke();

        const fillW = Math.max(6, (w - 4) * Math.max(0, Math.min(1, progress)));
        g.fillColor = new Color(236, 194, 92, 255);
        g.roundRect(-hw + 2, -hh + 2, fillW, h - 4, 2.5);
        g.fill();
        g.fillColor = new Color(255, 240, 184, 190);
        g.roundRect(-hw + 2, 0.5, fillW, (h - 4) * 0.42, 1.5);
        g.fill();
    }

    private diamond(g: Graphics, cx: number, cy: number, rx: number, ry: number): void {
        g.moveTo(cx, cy + ry);
        g.lineTo(cx + rx, cy);
        g.lineTo(cx, cy - ry);
        g.lineTo(cx - rx, cy);
        g.close();
    }

    /** 轻量 WebAudio 交错木槌敲击声（不同锤位带微差音高），静默降级不抛错。 */
    private playHammerStrikeTone(hammerIdx: number, strikeSeq: number): void {
        if (AudioManager.instance.soundVolume <= 0) return;
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const vol = Math.min(0.20, 0.13 * AudioManager.instance.soundVolume);

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            const pitchScale = [1.0, 1.14, 0.90, 1.07][hammerIdx % 4];
            const baseFreq = (162 + (strikeSeq % 3) * 14) * pitchScale;
            osc.frequency.setValueAtTime(baseFreq * 1.42, now);
            osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.56, now + 0.08);
            gain.gain.setValueAtTime(vol, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.11);

            const ping = ctx.createOscillator();
            const pingGain = ctx.createGain();
            ping.type = 'sine';
            ping.frequency.setValueAtTime((860 + hammerIdx * 110), now);
            ping.frequency.exponentialRampToValueAtTime((620 + hammerIdx * 75), now + 0.065);
            pingGain.gain.setValueAtTime(vol * 0.38, now);
            pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
            ping.connect(pingGain);
            pingGain.connect(ctx.destination);
            ping.start(now);
            ping.stop(now + 0.08);
        } catch {
            // 静默忽略
        }
    }

    private playCompletionChime(): void {
        if (AudioManager.instance.soundVolume <= 0) return;
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const vol = Math.min(0.18, 0.12 * AudioManager.instance.soundVolume);
            const notes = [523.25, 659.25, 783.99];
            notes.forEach((freq, idx) => {
                const start = now + idx * 0.055;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, start);
                gain.gain.setValueAtTime(0.001, start);
                gain.gain.linearRampToValueAtTime(vol, start + 0.018);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.42);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.44);
            });
        } catch {
            // 静默忽略
        }
    }

    private getAudioContext(): AudioContext | null {
        const w = typeof window !== 'undefined' ? (window as any) : null;
        const Ctor = w?.AudioContext || w?.webkitAudioContext;
        if (!Ctor) return null;
        if (!InnerCityConstructionFx.sharedAudioCtx) {
            InnerCityConstructionFx.sharedAudioCtx = new Ctor();
        }
        const ctx = InnerCityConstructionFx.sharedAudioCtx;
        if (ctx && ctx.state === 'suspended') {
            void ctx.resume().catch(() => {});
        }
        return ctx;
    }

    private createChild(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        parent.addChild(node);
        node.addComponent(UITransform);
        return node;
    }
}
