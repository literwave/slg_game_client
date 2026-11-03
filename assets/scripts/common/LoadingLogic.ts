import { _decorator, Animation, Color, Component, Graphics, instantiate, Label, Node, Prefab, ProgressBar, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform } from 'cc';
import { CoreEvent } from '../core/CoreEvent';
import { EventMgr } from '../utils/EventMgr';

const { ccclass, property } = _decorator;

const RUNNER_SOURCE_WIDTH = 256;
const RUNNER_SOURCE_HEIGHT = 256;
const RUNNER_DISPLAY_HEIGHT = 144;
const RUNNER_SLASH_HEIGHT = 170;
const RUNNER_FPS = 12;
const SLASH_FRAME_TIMES = [0.10, 0.13, 0.06, 0.07, 0.11, 0.09, 0.09, 0.10];
const RESOURCE_PROGRESS_WEIGHT = 0.7;
const FINISH_PROGRESS_SECONDS = 0.15;
const FINISH_FADE_SECONDS = 0.12;
/** runnerFrames 前 8 帧是奔跑循环，其后是举刀、劈斩、收刀动作帧 */
const RUNNER_RIDE_FRAMES = 8;

@ccclass('LoadingLogic')
export default class LoadingLogic extends Component {
    @property(ProgressBar)
    bar: ProgressBar | null = null;

    @property(Label)
    percentLabel: Label | null = null;

    @property(Prefab)
    runnerPrefab: Prefab | null = null;

    @property(Node)
    runner: Node | null = null;

    /** 奔跑和挥刀素材随预制体加载，播放时不再请求资源 */
    @property([SpriteFrame])
    runnerFrames: SpriteFrame[] = [];

    private targetProgress = 0;
    private visualProgress = 0;
    private trackLength = 1000;
    private trackCenterX = 0;
    private trackTopY = 0;
    private runnerHalfWidth = 50;
    private runnerBaseY = -55;
    private runnerSprite: Sprite | null = null;
    private runnerShadow: Node | null = null;
    private rideFrames: SpriteFrame[] = [];
    private actionFrames: SpriteFrame[] = [];
    private frameIndex = 0;
    private animElapsed = 0;
    private actionIndex = 0;
    private actionPlaying = false;
    private actionTimer = 0.25;
    private slashPose = false;
    private runnerClock = 0;
    private runnerReady = false;
    private stageLabel: Label | null = null;
    private finishing = false;
    private finishElapsed = 0;
    private finishStartProgress = 0;
    private fading = false;
    private displayedPercent = -1;
    private finishCallback: (() => void) | null = null;

    protected onLoad(): void {
        if (this.bar) {
            this.bar.progress = 0;
            const barNode = this.bar.node;
            const trackTransform = barNode.getComponent(UITransform);
            this.trackLength = trackTransform?.width ?? this.trackLength;
            const trackHeight = trackTransform?.height ?? 20;
            const trackPosition = barNode.position;
            this.trackCenterX = trackPosition.x;
            this.trackTopY = trackPosition.y + trackHeight * 0.5;
        }

        if (this.runner) {
            this.runnerSprite = this.runner.getComponent(Sprite);
        } else {
            this.createRunnerNode();
        }

        this.bindRunnerFrames();
        this.createRunnerShadow();
        this.updateRunnerPosition();
        this.updatePercent();

        const stageNode = this.node.getChildByName('StageLabel');
        this.stageLabel = stageNode ? stageNode.getComponent(Label) : null;

        EventMgr.on(CoreEvent.loadProgress, this.onProgress, this);
        EventMgr.on(CoreEvent.loadComplete, this.onComplete, this);
        EventMgr.on(CoreEvent.mapLoadProgress, this.onMapProgress, this);
    }

    protected onEnable(): void {
        this.targetProgress = 0;
        this.visualProgress = 0;
        this.runnerClock = 0;
        this.frameIndex = 0;
        this.animElapsed = 0;
        this.actionIndex = 0;
        this.actionPlaying = false;
        this.actionTimer = 0.25;
        this.finishing = false;
        this.finishElapsed = 0;
        this.finishStartProgress = 0;
        this.fading = false;
        this.finishCallback = null;
        this.displayedPercent = -1;
        const opacity = this.node.getComponent(UIOpacity);
        if (opacity) {
            Tween.stopAllByTarget(opacity);
            opacity.opacity = 255;
        }
        if (this.runnerSprite && this.rideFrames.length > 0) {
            this.showRunnerFrame(this.rideFrames[0], false);
        }
        if (this.stageLabel) this.stageLabel.string = '正在加载地图资源…';
        if (this.bar) {
            this.bar.progress = 0;
        }
        this.updateRunnerPosition();
        this.updatePercent();
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
    }

    protected onProgress(percent: number): void {
        if (this.finishing || !Number.isFinite(percent)) {
            return;
        }
        const next = Math.min(1, Math.max(0, percent));
        this.targetProgress = Math.max(this.targetProgress, next * RESOURCE_PROGRESS_WEIGHT);
    }

    private onMapProgress(percent: number, stage: string): void {
        if (this.finishing || !Number.isFinite(percent)) return;
        const next = Math.min(0.99, Math.max(RESOURCE_PROGRESS_WEIGHT, percent));
        if (next < this.targetProgress) return;
        this.targetProgress = next;
        if (this.stageLabel && stage) this.stageLabel.string = stage;
    }

    protected update(dt: number): void {
        // 长帧后不补跳整段动画；进度和骑将每帧都继续更新。
        const step = Math.min(Math.max(dt, 0), 0.05);
        this.runnerClock += step;
        this.advanceRunner(step);

        const diff = this.targetProgress - this.visualProgress;
        if (this.finishing) {
            // 真正就绪后限时收尾，避免平滑追赶进度额外占用一两秒。
            this.finishElapsed += Math.max(0, dt);
            const ratio = Math.min(1, this.finishElapsed / FINISH_PROGRESS_SECONDS);
            this.visualProgress = this.finishStartProgress + (1 - this.finishStartProgress) * ratio;
        } else if (diff > 0) {
            const eased = diff * (1 - Math.exp(-step / 0.28));
            const distance = Math.min(diff, 0.65 * step, Math.max(0.04 * step, eased));
            this.visualProgress = Math.min(this.targetProgress, this.visualProgress + distance);
            if (this.targetProgress - this.visualProgress < 0.0001) this.visualProgress = this.targetProgress;
        }
        if (this.bar && this.bar.progress !== this.visualProgress) this.bar.progress = this.visualProgress;
        this.updatePercent();
        this.updateRunnerPosition();
        if (this.finishing && this.visualProgress === 1 && !this.fading) this.fadeOut();
    }

    /** 逐帧奔跑与身体起伏独立于加载进度，进度停滞时也不会僵住 */
    private advanceRunner(dt: number): void {
        if (!this.runnerReady || !this.runnerSprite || this.rideFrames.length < 2) {
            return;
        }
        this.animElapsed += dt;
        while (true) {
            const frameTime = this.actionPlaying
                ? (SLASH_FRAME_TIMES[this.actionIndex] || 1 / RUNNER_FPS)
                : 1 / RUNNER_FPS;
            if (this.animElapsed < frameTime) break;
            this.animElapsed -= frameTime;
            if (this.actionPlaying) {
                this.actionIndex += 1;
                if (this.actionIndex >= this.actionFrames.length) {
                    this.actionPlaying = false;
                    this.actionIndex = 0;
                    this.frameIndex = 0;
                    this.actionTimer = this.nextActionDelay();
                    this.showRunnerFrame(this.rideFrames[0], false);
                } else {
                    this.showRunnerFrame(this.actionFrames[this.actionIndex], true);
                }
            } else {
                this.frameIndex = (this.frameIndex + 1) % this.rideFrames.length;
                this.showRunnerFrame(this.rideFrames[this.frameIndex], false);
                this.actionTimer -= frameTime;
                if (this.actionTimer <= 0 && this.actionFrames.length > 0) {
                    this.actionPlaying = true;
                    this.actionIndex = 0;
                    this.showRunnerFrame(this.actionFrames[0], true);
                }
            }
        }
    }

    /** 第一轮尽早挥刀，之后穿插在奔跑循环中。 */
    private nextActionDelay(): number {
        return 1.2 + Math.random() * 0.6;
    }

    private showRunnerFrame(frame: SpriteFrame, slash: boolean): void {
        if (!this.runnerSprite || !this.runner) return;
        if (this.slashPose !== slash) {
            this.slashPose = slash;
            // 挥刀素材为刀锋留出边距，补偿画布尺寸并保持马蹄落点稳定。
            const size = slash ? RUNNER_SLASH_HEIGHT : RUNNER_DISPLAY_HEIGHT;
            this.runner.getComponent(UITransform)?.setContentSize(size, size);
            this.runnerBaseY = this.trackTopY + size * 0.5 + 4 - (slash ? 2 : 0);
        }
        this.runnerSprite.spriteFrame = frame;
    }

    private createRunnerNode(): void {
        const node = new Node('runner');
        node.layer = this.node.layer;
        const transform = node.addComponent(UITransform);
        transform.setContentSize(RUNNER_SOURCE_WIDTH, RUNNER_SOURCE_HEIGHT);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
        node.setParent(this.node);
        node.setSiblingIndex(this.node.children.length - 1);

        this.runner = node;
        this.runnerSprite = sprite;
    }

    /** 素材已随预制体序列化，加载页首帧即可直接开始播放 */
    private bindRunnerFrames(): void {
        const frames = (this.runnerFrames || []).filter((frame) => !!frame);
        if (!this.runner || !this.runnerSprite || frames.length === 0) {
            this.useFallbackRunner();
            return;
        }

        // 使用预制体中的明确帧序，避免资源改名影响步态。
        const rideCount = Math.min(RUNNER_RIDE_FRAMES, frames.length);
        this.rideFrames = frames.slice(0, rideCount);
        this.actionFrames = frames.slice(rideCount);
        this.runner.setScale(1, 1, 1);
        this.runner.getComponent(UITransform)?.setContentSize(RUNNER_DISPLAY_HEIGHT, RUNNER_DISPLAY_HEIGHT);
        this.runnerSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.runnerSprite.trim = false;
        this.runnerSprite.spriteFrame = this.rideFrames[0];
        this.frameIndex = 0;
        this.animElapsed = 0;
        this.actionIndex = 0;
        this.actionPlaying = false;
        this.actionTimer = 0.25;
        this.slashPose = false;
        this.runnerReady = true;
        this.measureRunner();
        this.updateRunnerPosition();
    }

    /** 素材缺失时退回旧预制体，避免加载页空一块 */
    private useFallbackRunner(): void {
        if (!this.runnerPrefab || !this.runner) {
            return;
        }
        const legacy = instantiate(this.runnerPrefab);
        legacy.name = 'runner';
        legacy.layer = this.node.layer;
        legacy.setParent(this.node);
        legacy.setSiblingIndex(this.node.children.length - 1);
        this.runner.destroy();
        this.runner = legacy;
        this.runnerSprite = null;
        this.runnerReady = false;
        this.measureRunner();
        this.updateRunnerPosition();
        const animation = legacy.getComponent(Animation);
        if (animation) {
            animation.play('qb_run_r');
        }
    }

    /** 柔和的蹄下投影将透明骑将素材落到进度轨道上。 */
    private createRunnerShadow(): void {
        if (!this.runner || !this.runnerReady || this.runnerShadow) {
            return;
        }
        const shadow = new Node('RunnerShadow');
        shadow.layer = this.node.layer;
        shadow.addComponent(UITransform).setContentSize(88, 12);
        const graphics = shadow.addComponent(Graphics);
        graphics.fillColor = new Color(0, 0, 0, 55);
        graphics.ellipse(0, 0, 42, 5);
        graphics.fill();
        shadow.setParent(this.node);
        shadow.setSiblingIndex(this.runner.getSiblingIndex());
        this.runnerShadow = shadow;
    }

    private measureRunner(): void {
        if (!this.runner) {
            return;
        }
        const transform = this.runner.getComponent(UITransform);
        const width = transform?.width ?? RUNNER_SOURCE_WIDTH;
        const height = transform?.height ?? RUNNER_SOURCE_HEIGHT;
        const scaleX = Math.abs(this.runner.scale.x) || 1;
        const scaleY = Math.abs(this.runner.scale.y) || 1;
        this.runnerHalfWidth = Math.max(width, this.actionFrames.length ? RUNNER_SLASH_HEIGHT : 0) * scaleX * 0.5;
        this.runnerBaseY = this.trackTopY + height * scaleY * 0.5 + 4;
    }

    private updateRunnerPosition(): void {
        if (!this.runner) {
            return;
        }
        const limit = Math.max(12, this.trackLength * 0.5 - this.runnerHalfWidth - 2);
        const sway = this.runnerReady ? Math.sin(this.runnerClock * 2.1) * 0.6 : 0;
        const bob = this.runnerReady ? Math.sin(this.runnerClock * 9.4) * 0.6 : 0;
        const x = this.trackCenterX - limit + this.visualProgress * limit * 2 + sway;
        this.runner.setPosition(x, this.runnerBaseY + bob, 0);
        this.runner.angle = 0;
        if (this.runnerShadow) {
            this.runnerShadow.setPosition(x + 5, this.trackTopY + 5, 0);
            const shadowScale = 1 - Math.max(0, bob) * 0.06;
            this.runnerShadow.setScale(shadowScale, shadowScale, 1);
        }
    }

    private updatePercent(): void {
        const percent = Math.floor(this.visualProgress * 100);
        if (this.percentLabel && percent !== this.displayedPercent) {
            this.displayedPercent = percent;
            this.percentLabel.string = `${percent}%`;
        }
    }

    protected onComplete(): void {
        if (this.finishing) {
            return;
        }
        this.targetProgress = Math.max(this.targetProgress, RESOURCE_PROGRESS_WEIGHT);
        if (this.stageLabel) {
            this.stageLabel.string = '资源已就绪，正在部署战场…';
        }
    }

    /** 地图就绪后平滑走完最后一段，再淡出；不直接跳到 100%。 */
    public finish(onFinished?: () => void): void {
        if (this.finishing) {
            return;
        }
        this.finishing = true;
        this.finishElapsed = 0;
        this.finishStartProgress = this.visualProgress;
        this.targetProgress = 1;
        this.finishCallback = onFinished || null;
        if (this.stageLabel) {
            this.stageLabel.string = '山河已就绪';
        }
    }

    private fadeOut(): void {
        this.fading = true;
        const opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        tween(opacity).to(FINISH_FADE_SECONDS, { opacity: 0 }, { easing: 'quadOut' }).call(() => {
            if (this.node && this.node.isValid) {
                this.node.destroy();
            }
            const callback = this.finishCallback;
            this.finishCallback = null;
            if (callback) callback();
        }).start();
    }
}
