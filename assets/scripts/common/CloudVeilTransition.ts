import {
    _decorator,
    BlockInputEvents,
    Button,
    Color,
    Component,
    EffectAsset,
    Graphics,
    ImageAsset,
    isValid,
    Label,
    Material,
    Node,
    resources,
    screen,
    Sprite,
    SpriteFrame,
    Texture2D,
    UIOpacity,
    UITransform,
    Vec4,
    view,
} from 'cc';
import { CoreEvent } from '../core/CoreEvent';
import { EventMgr } from '../utils/EventMgr';
import { caption, place } from '../map/ui/ManagementStyle';

const { ccclass } = _decorator;

export interface CloudTransitionTheme {
    /** 印章单字（如 益 / 青 / 启） */
    seal?: string;
    /** 中庭主标题（如 入主益州 / 重临山河） */
    title?: string;
    /** 副标题或州域判词（如 天府沃野 · 剑阁天险） */
    subtitle?: string;
    /** 选州名（如 益州），用于承接落城横幅与军师开场词 */
    zoneName?: string;
    /** 选州建角专属：八卷纯正三国手绘连环故事插画（不晃动、无进度条、无矢量贴片，由玩家逐张安静点击翻阅） */
    storyLines?: string[];
    /** 序章落章题铭（如 大旗初立 · 入主益州） */
    chapterMark?: string;
    /** 归一化聚焦点 X (0..1)，对应选定州在屏幕上的水平位置 */
    focusU?: number;
    /** 归一化聚焦点 Y (0..1)，对应选定州在屏幕上的垂直位置 */
    focusV?: number;
}

export interface CloudRevealOptions {
    /** 云幕即将拨开前触发（可用于隐藏新角色落城前的 HUD，避免透出闪烁） */
    onRevealStart?: () => void;
}

const CLASSIC_FONT = 'STKaiti, KaiTi, BiauKai, FangSong, SimSun, Songti SC, serif';
const EFFECT_PATH = 'effects/cloud-veil';
const RESOURCE_PROGRESS_WEIGHT = 0.7;

const COVER_DURATION = 0.36;
/** 云幕合拢后短延迟显字：极快加载直接拨云不闪屏，真实加载耗时时迅速浮现古典印章与进度 */
const EMBLEM_DELAY_SECONDS = 0.12;
const EMBLEM_FADE_IN_SECONDS = 0.18;
const FINISH_PROGRESS_SECONDS = 0.14;
const EMBLEM_FADE_OUT_SECONDS = 0.18;
const REVEAL_DURATION = 0.54;
/** 全屏云幕四周超画幅出血，避免窗口缩放、宽屏适配或小数像素取整时四周露出空白细边 */
const VEIL_OVERSCAN = 48;

const LETTERBOX_HEIGHT = 48;
const PAGE_DISSOLVE_SECONDS = 0.56;

/** 八卷完全独立、风格统一的三国手绘叙事插画（16:9 满幅静雅呈现，零晃动、零重复） */
const PV_SCENE_PATHS = [
    'ui/onboarding/pv-story-1-luoyang/spriteFrame',   // 壹·洛阳焚天
    'ui/onboarding/pv-act1-beacon/spriteFrame',       // 贰·烽烟九州
    'ui/onboarding/pv-story-3-warlords/spriteFrame',  // 叁·群雄逐鹿
    'ui/onboarding/pv-story-4-vow/spriteFrame',       // 肆·苍生待主
    'ui/onboarding/pv-story-5-council/spriteFrame',   // 伍·帐中定策
    'ui/onboarding/pv-story-6-build/spriteFrame',     // 陆·屯田兴师
    'ui/onboarding/pv-act2-march/spriteFrame',        // 柒·铁骑出关
    'ui/onboarding/pv-act3-stronghold/spriteFrame',   // 捌·授印立旗
] as const;

const PV_CHAPTERS: ReadonlyArray<{ num: string; vertical: string }> = [
    { num: '壹', vertical: '洛\n阳\n焚\n天' },
    { num: '贰', vertical: '烽\n烟\n九\n州' },
    { num: '叁', vertical: '群\n雄\n逐\n鹿' },
    { num: '肆', vertical: '苍\n生\n待\n主' },
    { num: '伍', vertical: '帐\n中\n定\n策' },
    { num: '陆', vertical: '屯\n田\n兴\n师' },
    { num: '柒', vertical: '铁\n骑\n出\n关' },
    { num: '捌', vertical: '授\n印\n立\n旗' },
];

const DEFAULT_STORY_LINES: string[] = [
    '中平末季，阉宦乱政，董卓纵火焚洛——四百年炎汉玉阙，一夕尽成焦土。\n赤焰倒映洛水，黑烟蔽塞天光；帝星失驭，九州神器自此沦入乱世。',
    '一夕之间，万峰烽燧连天而起，残旗猎猎呼啸于苍茫暮风。\n关中、河内、河东拱卫司隶，十三雄关锁钥九州——逐鹿之局，由此大开。',
    '秦失其鹿，天下共逐——四方豪杰陈兵河谷，旌旗蔽日，营火连绵百里。\n铁马冰河，合纵连横；乱世寸土，皆凭奇谋与血火争得。',
    '干戈不息，沃野流离，万千黎庶守望孤村残灯，唯盼明主出世。\n君携幕僚按剑立于云崖，俯瞰烽烟千里——誓平宇内、再造山河！',
    '华帐燃薪，军师摇羽扇指点九州沙盘，为君与众将剖析天下大势。\n择沃土而起兵、定破关之方略，天下大局尽在运筹之中！',
    '欲平天下，必先固本——伐木筑垣，开荒屯垦，锻甲铸兵，演武募士。\n广积粮秣、礼贤纳将、结盟同袍；自一城一地起，厚积破关之力！',
    '待兵锋既利、粮道充盈，便鸣鼓出关，铁骑旌旗漫卷险峻山道！\n破雄关、夺要隘、会师司隶——云开金光所照，正是帝都洛阳！',
    '晨曦破云，碧水梯田环抱之间，主公所立初城已然落成。\n大旗猎猎迎风，万里霸业第一卷，此刻便交由主公亲笔落墨！',
];

const DEFAULT_TIPS: string[] = [
    '山河初定 · 先安民筑城，再整军出关',
    '兵马未动 · 粮草先行，广屯沃野以备久战',
    '善战者谋势 · 结盟同袍，共逐中原洛阳',
    '据险守关 · 扼咽喉要冲，进可攻退可守',
];

type TransitionPhase = 'idle' | 'closing' | 'covered' | 'finishing' | 'revealing' | 'done';

interface DustMote {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    phase: number;
    alpha: number;
}

/**
 * SLG 主题水墨云雾全屏转场层 + 新手八卷沉浸式三国手绘连环故事画卷。
 * 老角色：极速四段式云幕过渡（防闪屏，零冗余等待）；
 * 新角色选州后：8 幅完全独立的三国手绘原画满幅静雅呈现（绝不晃动、绝无生硬矢量贴片、无进度条），玩家轻触画面逐卷翻阅沉浸入戏，终卷授印后拨云见城无缝落城。
 */
@ccclass('CloudVeilTransition')
export default class CloudVeilTransition extends Component {
    private static cachedEffect: EffectAsset | null = null;
    private static loadingEffect = false;
    private static cachedSceneFrames: (SpriteFrame | null)[] = new Array(PV_SCENE_PATHS.length).fill(null);
    private static preloadingPv = false;

    /** 在登录/选州空闲时静默预热云雾着色器与全部 8 幅三国故事插画，翻页零等待。 */
    public static preload(): void {
        if (!CloudVeilTransition.cachedEffect && !CloudVeilTransition.loadingEffect) {
            CloudVeilTransition.loadingEffect = true;
            resources.load(EFFECT_PATH, EffectAsset, (error, effect) => {
                CloudVeilTransition.loadingEffect = false;
                if (!error && effect) {
                    effect.addRef?.();
                    CloudVeilTransition.cachedEffect = effect;
                }
            });
        }
        if (CloudVeilTransition.preloadingPv) return;
        CloudVeilTransition.preloadingPv = true;
        PV_SCENE_PATHS.forEach((assetPath, idx) => {
            if (CloudVeilTransition.cachedSceneFrames[idx]) return;
            resources.load(assetPath, SpriteFrame, (err, frame) => {
                if (!err && frame instanceof SpriteFrame) {
                    frame.addRef?.();
                    CloudVeilTransition.cachedSceneFrames[idx] = frame;
                }
            });
        });
    }

    private phase: TransitionPhase = 'idle';
    private clock = 0;
    private phaseElapsed = 0;
    private coveredElapsed = 0;
    private cover = 0;
    private mode = 0; // 0 = closing, 1 = revealing
    private emblemAlpha = 0;
    private emblemShown = false;
    private warmth = 0;

    private targetProgress = 0;
    private visualProgress = 0;
    private finishStartProgress = 0;
    private finishElapsed = 0;
    private revealWaitFrames = 0;
    private displayedPercent = -1;
    private tipIndex = 0;
    private tipClock = 0;

    /** 八卷纯手绘静雅翻页故事状态 */
    private storyMode = false;
    private storyElapsed = 0;
    private currentPage = 0;
    private prevPage = -1;
    private pageElapsed = 0;
    private storySkipRequested = false;
    private storyLines: string[] = [];
    private zoneName = '';
    private chapterMark = '';
    private readyForReveal = false;
    private appliedPageIndex = -1;

    private theme: {
        seal: string;
        title: string;
        subtitle: string;
        focusU: number;
        focusV: number;
    } = {
        seal: '启',
        title: '重临山河',
        subtitle: DEFAULT_TIPS[0],
        focusU: 0.5,
        focusV: 0.5,
    };

    private onCoveredCallback: (() => void) | null = null;
    private onRevealStartCallback: (() => void) | null = null;
    private finishCallback: (() => void) | null = null;
    private pendingFinish = false;

    private viewportW = 1280;
    private viewportH = 720;

    private veilNode: Node | null = null;
    private veilSprite: Sprite | null = null;
    private fallbackCloudNode: Node | null = null;
    private fallbackCloudGraphics: Graphics | null = null;
    private moteNode: Node | null = null;
    private moteGraphics: Graphics | null = null;
    private letterboxTop: Node | null = null;
    private letterboxTopGraphics: Graphics | null = null;
    private letterboxBottom: Node | null = null;
    private letterboxBottomGraphics: Graphics | null = null;

    /** 老角色精简加载中庭 */
    private emblemRoot: Node | null = null;
    private emblemOpacity: UIOpacity | null = null;
    private emblemBackdropGraphics: Graphics | null = null;
    private sealRingNode: Node | null = null;
    private sealRingGraphics: Graphics | null = null;
    private sealCardNode: Node | null = null;
    private sealLabel: Label | null = null;
    private titleLabel: Label | null = null;
    private subtitleLabel: Label | null = null;
    private stageLabel: Label | null = null;
    private percentLabel: Label | null = null;
    private barGraphics: Graphics | null = null;
    private barWidth = 360;

    /** 新角色八卷手绘故事画卷节点（纯净静雅，无晃动、无进度条、无矢量特效杂物） */
    private storyRoot: Node | null = null;
    private storyOpacity: UIOpacity | null = null;
    private storyChromeRoot: Node | null = null;
    private storyChromeOpacity: UIOpacity | null = null;
    private pvStageRoot: Node | null = null;
    private pvSceneNodes: Node[] = [];
    private pvSceneSprites: Sprite[] = [];
    private pvSceneOpacities: UIOpacity[] = [];
    private pvSceneBaseW = 1280;
    private pvSceneBaseH = 720;
    private pvVignetteGraphics: Graphics | null = null;
    private pvAccentLineGraphics: Graphics | null = null;
    private pvPipsGraphics: Graphics | null = null;

    /** 左上角竖排章回印章与书法题签 */
    private chapterStampRoot: Node | null = null;
    private chapterStampOpacity: UIOpacity | null = null;
    private chapterStampGraphics: Graphics | null = null;
    private chapterSealLabel: Label | null = null;
    private chapterVerticalLabel: Label | null = null;
    private chapterStampBaseX = -560;
    private chapterStampBaseY = 185;

    /** 终卷沉稳朱砂玉印与题铭 */
    private storySealRoot: Node | null = null;
    private storySealOpacity: UIOpacity | null = null;
    private storySealRingNode: Node | null = null;
    private storySealRingGraphics: Graphics | null = null;
    private storySealCard: Node | null = null;
    private storySealLabel: Label | null = null;

    private storySubtitleLine1: Label | null = null;
    private storySubtitleLine1Opacity: UIOpacity | null = null;
    private storySubtitleLine2: Label | null = null;
    private storySubtitleLine2Opacity: UIOpacity | null = null;
    private storyClimaxLabel: Label | null = null;
    private storyClimaxOpacity: UIOpacity | null = null;
    private storyEpithetLabel: Label | null = null;
    private storyEpithetOpacity: UIOpacity | null = null;
    private storyBottomHintLabel: Label | null = null;
    private storyBottomHintOpacity: UIOpacity | null = null;
    private storySkipNode: Node | null = null;
    private storySkipOpacity: UIOpacity | null = null;
    private storyTapNode: Node | null = null;

    private storyAccentLineY = -170;
    private storySubLine1Y = -194;
    private storySubLine2Y = -230;
    private storyClimaxY = -24;
    private storyEpithetY = -66;

    private veilMaterial: Material | null = null;
    private veilTexture: Texture2D | null = null;
    private veilImage: ImageAsset | null = null;
    private veilFrame: SpriteFrame | null = null;
    private shaderReady = false;
    private readonly stateVec = new Vec4(0, 0, 16 / 9, 0);
    private readonly styleVec = new Vec4(0, 0.5, 0.5, 0);
    private motes: DustMote[] = [];
    private built = false;

    public get isCovered(): boolean {
        return this.phase === 'covered' || this.phase === 'finishing';
    }

    public get currentPhase(): TransitionPhase {
        return this.phase;
    }

    public get isEmblemVisible(): boolean {
        return this.emblemShown && this.emblemAlpha > 0.01;
    }

    public get isStoryMode(): boolean {
        return this.storyMode;
    }

    public get currentStoryAct(): number {
        return this.currentPage;
    }

    /** 玩家点击右上角「跳过序章 ›」或主动跳过时直接结束序章，立刻拨云见城。 */
    public skipStory(): void {
        if (!this.storyMode) return;
        this.storySkipRequested = true;
        if (this.phase === 'covered' && this.readyForReveal) {
            this.enterFinishing();
        }
    }

    /**
     * 玩家轻触翻页：
     * - 卷壹~卷柒：每次轻触平滑叠化至下一幅全新三国手绘插画（8 张完全不同、零重复、绝不晃动）；
     * - 卷捌（终卷）：后台地图就绪后轻触即刻拨云见城，踏入主城！
     */
    public advanceOrSkipStory(): void {
        if (!this.storyMode || this.phase !== 'covered') return;
        const lastIndex = PV_CHAPTERS.length - 1;
        if (this.currentPage < lastIndex) {
            this.goToPage(this.currentPage + 1);
            return;
        }
        if (this.readyForReveal) {
            this.skipStory();
        }
    }

    private goToPage(nextPage: number): void {
        const clamped = Math.max(0, Math.min(PV_CHAPTERS.length - 1, nextPage));
        if (clamped === this.currentPage) return;
        this.prevPage = this.currentPage;
        this.currentPage = clamped;
        this.pageElapsed = 0;
        this.appliedPageIndex = -1;
        const nextNode = this.pvSceneNodes[clamped];
        if (nextNode && this.pvStageRoot) {
            nextNode.setSiblingIndex(this.pvStageRoot.children.length - 1);
        }
        this.syncVisuals();
    }

    protected onLoad(): void {
        this.ensureStructure();
        EventMgr.on(CoreEvent.loadProgress, this.onProgress, this);
        EventMgr.on(CoreEvent.loadComplete, this.onComplete, this);
        EventMgr.on(CoreEvent.mapLoadProgress, this.onMapProgress, this);
        this.node.parent?.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        view.on?.('canvas-resize', this.layout, this);
        view.on?.('design-resolution-changed', this.layout, this);
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this.node.parent?.off?.(Node.EventType.SIZE_CHANGED, this.layout, this);
        view.off?.('canvas-resize', this.layout, this);
        view.off?.('design-resolution-changed', this.layout, this);
        this.onCoveredCallback = null;
        this.onRevealStartCallback = null;
        this.finishCallback = null;
        if (this.veilSprite && isValid(this.veilSprite, true)) {
            if (this.veilSprite.customMaterial === this.veilMaterial) this.veilSprite.customMaterial = null;
            if (this.veilSprite.spriteFrame === this.veilFrame) this.veilSprite.spriteFrame = null;
        }
        this.veilMaterial?.destroy();
        this.veilMaterial = null;
        this.veilFrame?.destroy();
        this.veilFrame = null;
        this.veilTexture?.destroy();
        this.veilTexture = null;
        this.veilImage?.destroy();
        this.veilImage = null;
    }

    /** 启动水墨云幕合拢；完全遮盖画面时回调 onCovered（此时可安全隐藏旧界面）。 */
    public beginCover(onCovered?: () => void, theme?: CloudTransitionTheme): void {
        this.ensureStructure();
        this.applyTheme(theme);
        this.phase = 'closing';
        this.clock = 0;
        this.phaseElapsed = 0;
        this.coveredElapsed = 0;
        this.cover = 0.02;
        this.mode = 0;
        this.emblemAlpha = 0;
        this.emblemShown = false;
        this.warmth = 0;
        this.targetProgress = 0;
        this.visualProgress = 0;
        this.finishStartProgress = 0;
        this.finishElapsed = 0;
        this.revealWaitFrames = 0;
        this.displayedPercent = -1;
        this.tipIndex = 0;
        this.tipClock = 0;
        this.storyElapsed = 0;
        this.currentPage = 0;
        this.prevPage = -1;
        this.pageElapsed = 0;
        this.storySkipRequested = false;
        this.readyForReveal = false;
        this.pendingFinish = false;
        this.appliedPageIndex = -1;
        this.onCoveredCallback = onCovered || null;
        this.onRevealStartCallback = null;
        this.finishCallback = null;

        if (this.stageLabel) this.stageLabel.string = '正在铺展山河…';
        if (this.emblemOpacity) this.emblemOpacity.opacity = 0;
        if (this.emblemRoot) this.emblemRoot.active = false;
        if (this.storyOpacity) this.storyOpacity.opacity = 0;
        if (this.storyRoot) this.storyRoot.active = false;
        if (this.storyChromeOpacity) this.storyChromeOpacity.opacity = 0;
        if (this.storyChromeRoot) this.storyChromeRoot.active = false;
        if (this.storyTapNode) this.storyTapNode.active = this.storyMode;
        if (this.storySkipNode) this.storySkipNode.active = false;
        if (this.storyBottomHintLabel) this.storyBottomHintLabel.string = '';
        if (this.letterboxTop) this.letterboxTop.active = this.storyMode;
        if (this.letterboxBottom) this.letterboxBottom.active = this.storyMode;

        if (this.storyMode) {
            this.pvSceneNodes.forEach((sn, idx) => {
                sn.setSiblingIndex(idx);
                sn.setPosition(0, 0, 0);
                sn.setScale(1, 1, 1);
                (sn as { angle?: number }).angle = 0;
            });
            this.bindPvAssets();
        }
        this.layout();
        this.syncVisuals();
    }

    /** 地图、UI、主城真实等级全部就绪后调用；补齐收尾并拨云揭示新场景。 */
    public finish(onFinished?: () => void, options?: CloudRevealOptions): void {
        if (this.readyForReveal || this.phase === 'finishing' || this.phase === 'revealing' || this.phase === 'done') {
            return;
        }
        this.finishCallback = onFinished || null;
        this.onRevealStartCallback = options?.onRevealStart || null;
        this.readyForReveal = true;
        if (this.storyMode) {
            if (this.storySkipRequested && this.phase === 'covered') {
                this.enterFinishing();
            }
            return;
        }
        if (this.phase === 'closing' || this.phase === 'idle') {
            this.pendingFinish = true;
            return;
        }
        this.enterFinishing();
    }

    protected onProgress(percent: number): void {
        if (this.phase === 'finishing' || this.phase === 'revealing' || this.phase === 'done') return;
        if (!Number.isFinite(percent)) return;
        const next = Math.min(1, Math.max(0, percent));
        this.targetProgress = Math.max(this.targetProgress, next * RESOURCE_PROGRESS_WEIGHT);
    }

    protected onComplete(): void {
        if (this.phase === 'finishing' || this.phase === 'revealing' || this.phase === 'done') return;
        this.targetProgress = Math.max(this.targetProgress, RESOURCE_PROGRESS_WEIGHT);
        if (this.stageLabel) this.stageLabel.string = '资源已就绪，正在部署战场…';
    }

    private onMapProgress(percent: number, stage: string): void {
        if (this.phase === 'finishing' || this.phase === 'revealing' || this.phase === 'done') return;
        if (!Number.isFinite(percent)) return;
        const next = Math.min(0.99, Math.max(RESOURCE_PROGRESS_WEIGHT, percent));
        if (next < this.targetProgress) return;
        this.targetProgress = next;
        if (this.stageLabel && stage) this.stageLabel.string = stage;
    }

    protected update(dt: number): void {
        if (this.phase === 'idle' || this.phase === 'done') return;
        this.syncViewportIfNeeded();
        const rawDt = Number.isFinite(dt) ? Math.max(dt, 0) : 0;
        const step = Math.min(rawDt, 0.05);
        this.clock += step;

        if (this.phase === 'closing') {
            this.phaseElapsed += step;
            const raw = Math.min(1, this.phaseElapsed / COVER_DURATION);
            this.cover = this.easeCubicInOut(raw);
            this.advanceProgress(step);
            if (raw >= 1) {
                this.cover = 1;
                this.phase = 'covered';
                this.coveredElapsed = 0;
                this.storyElapsed = 0;
                this.pageElapsed = 0;
                const coveredCb = this.onCoveredCallback;
                this.onCoveredCallback = null;
                coveredCb?.();
                if (this.storyMode) {
                    if (this.storyRoot) this.storyRoot.active = true;
                    if (this.storyChromeRoot) this.storyChromeRoot.active = true;
                    if (this.storySkipRequested && this.readyForReveal) {
                        this.enterFinishing();
                    }
                } else if (this.pendingFinish) {
                    this.pendingFinish = false;
                    this.enterFinishing();
                }
            }
        } else if (this.phase === 'covered') {
            this.cover = 1;
            // 预制体实例化/资源解压帧可能超过 50ms；covered 阶段按真实耗时推进（上限 0.35s），避免长时间停留在无印章空白云幕。
            const coveredStep = Math.min(rawDt, 0.35);
            this.coveredElapsed += coveredStep;
            this.advanceProgress(coveredStep);
            if (this.storyMode) {
                this.storyElapsed += step;
                this.pageElapsed += step;
                if (this.readyForReveal) {
                    this.targetProgress = 1;
                }
                this.emblemAlpha = Math.min(1, this.storyElapsed / 0.40);
                const isFinalPage = this.currentPage === PV_CHAPTERS.length - 1;
                this.warmth = isFinalPage ? Math.min(0.65, this.pageElapsed * 0.45) : 0;

                if (this.readyForReveal && this.storySkipRequested) {
                    this.enterFinishing();
                }
            } else if (this.coveredElapsed >= EMBLEM_DELAY_SECONDS) {
                if (!this.emblemShown) {
                    this.emblemShown = true;
                    if (this.emblemRoot) this.emblemRoot.active = true;
                }
                this.emblemAlpha = Math.min(1, (this.coveredElapsed - EMBLEM_DELAY_SECONDS) / EMBLEM_FADE_IN_SECONDS);
                if (!this.hasCustomSubtitle()) {
                    this.tipClock += step;
                    if (this.tipClock >= 4.2) {
                        this.tipClock = 0;
                        this.tipIndex = (this.tipIndex + 1) % DEFAULT_TIPS.length;
                        if (this.subtitleLabel) this.subtitleLabel.string = DEFAULT_TIPS[this.tipIndex];
                    }
                }
            }
        } else if (this.phase === 'finishing') {
            this.cover = 1;
            if (this.storyMode) {
                this.finishElapsed += step;
                this.visualProgress = 1;
                const fadeT = Math.min(1, this.finishElapsed / (EMBLEM_FADE_OUT_SECONDS + 0.14));
                this.emblemAlpha = Math.max(0, 1 - fadeT);
                if (fadeT >= 1) {
                    if (this.storyRoot) this.storyRoot.active = false;
                    if (this.storyChromeRoot) this.storyChromeRoot.active = false;
                    if (this.storyTapNode) this.storyTapNode.active = false;
                    this.beginReveal();
                }
            } else if (!this.emblemShown || this.emblemAlpha <= 0.001) {
                this.beginReveal();
            } else {
                this.finishElapsed += step;
                const progRatio = Math.min(1, this.finishElapsed / FINISH_PROGRESS_SECONDS);
                this.visualProgress = this.finishStartProgress + (1 - this.finishStartProgress) * progRatio;
                if (this.finishElapsed >= FINISH_PROGRESS_SECONDS) {
                    const fadeT = Math.min(1, (this.finishElapsed - FINISH_PROGRESS_SECONDS) / EMBLEM_FADE_OUT_SECONDS);
                    this.emblemAlpha = Math.max(0, 1 - fadeT);
                    if (fadeT >= 1) {
                        if (this.emblemRoot) this.emblemRoot.active = false;
                        this.beginReveal();
                    }
                }
            }
        } else if (this.phase === 'revealing') {
            if (this.revealWaitFrames > 0) {
                this.revealWaitFrames -= 1;
            } else {
                this.phaseElapsed += step;
                const raw = Math.min(1, this.phaseElapsed / REVEAL_DURATION);
                const eased = this.easeCubicOut(raw);
                this.cover = Math.max(0, 1 - eased);
                this.warmth = Math.sin(raw * Math.PI);
                if (raw >= 1) {
                    this.completeAndDispose();
                    return;
                }
            }
        }

        if (!this.storyMode) {
            this.updateMotes(step);
        }
        this.syncVisuals();
    }

    private enterFinishing(): void {
        this.phase = 'finishing';
        this.finishElapsed = 0;
        this.finishStartProgress = this.visualProgress;
        this.targetProgress = 1;
        if (this.stageLabel) this.stageLabel.string = '山河已就绪';
    }

    private beginReveal(): void {
        this.phase = 'revealing';
        this.mode = 1;
        this.phaseElapsed = 0;
        this.cover = 1;
        this.emblemAlpha = 0;
        this.warmth = 0;
        this.revealWaitFrames = 1;
        const revealCb = this.onRevealStartCallback;
        this.onRevealStartCallback = null;
        revealCb?.();
    }

    private completeAndDispose(): void {
        this.phase = 'done';
        this.cover = 0;
        const callback = this.finishCallback;
        this.finishCallback = null;
        if (this.node && isValid(this.node, true)) {
            this.node.destroy();
        }
        callback?.();
    }

    private advanceProgress(step: number): void {
        const diff = this.targetProgress - this.visualProgress;
        if (diff <= 0) return;
        const eased = diff * (1 - Math.exp(-step / 0.24));
        const delta = Math.min(diff, 0.72 * step, Math.max(0.05 * step, eased));
        this.visualProgress = Math.min(this.targetProgress, this.visualProgress + delta);
        if (this.targetProgress - this.visualProgress < 0.0005) {
            this.visualProgress = this.targetProgress;
        }
    }

    private applyTheme(theme?: CloudTransitionTheme): void {
        this.theme = {
            seal: theme?.seal || '启',
            title: theme?.title || '重临山河',
            subtitle: theme?.subtitle || DEFAULT_TIPS[0],
            focusU: typeof theme?.focusU === 'number' && Number.isFinite(theme.focusU) ? Math.min(0.88, Math.max(0.12, theme.focusU)) : 0.5,
            focusV: typeof theme?.focusV === 'number' && Number.isFinite(theme.focusV) ? Math.min(0.88, Math.max(0.12, theme.focusV)) : 0.5,
        };
        this.zoneName = theme?.zoneName || '';
        const lines = Array.isArray(theme?.storyLines) ? theme.storyLines.filter(line => !!line) : [];
        this.storyMode = lines.length >= 2;
        if (lines.length >= PV_CHAPTERS.length) {
            this.storyLines = lines.slice(0, PV_CHAPTERS.length);
        } else {
            this.storyLines = DEFAULT_STORY_LINES.map((fallback, idx) => lines[idx] || fallback);
        }
        this.chapterMark = theme?.chapterMark || this.theme.title;

        if (this.sealLabel) this.sealLabel.string = this.theme.seal;
        if (this.titleLabel) this.titleLabel.string = this.theme.title;
        if (this.subtitleLabel) this.subtitleLabel.string = this.theme.subtitle;
        if (this.storySealLabel) this.storySealLabel.string = this.theme.seal;
        if (this.storyClimaxLabel) this.storyClimaxLabel.string = this.chapterMark;
        if (this.storyEpithetLabel) this.storyEpithetLabel.string = this.theme.subtitle;
    }

    private hasCustomSubtitle(): boolean {
        return !!this.theme.subtitle && !DEFAULT_TIPS.includes(this.theme.subtitle);
    }

    private bindPvAssets(): void {
        PV_SCENE_PATHS.forEach((assetPath, idx) => {
            const sp = this.pvSceneSprites[idx];
            if (!sp) return;
            const cached = CloudVeilTransition.cachedSceneFrames[idx];
            if (cached && isValid(cached, true)) {
                sp.spriteFrame = cached;
                return;
            }
            resources.load(assetPath, SpriteFrame, (err, frame) => {
                if (err || !(frame instanceof SpriteFrame)) return;
                frame.addRef?.();
                CloudVeilTransition.cachedSceneFrames[idx] = frame;
                if (isValid(this, true) && isValid(sp, true)) sp.spriteFrame = frame;
            });
        });
    }

    private ensureStructure(): void {
        if (this.built) return;
        this.built = true;

        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);

        // 1. 兜底软雾层
        this.fallbackCloudNode = this.makeNode('FallbackClouds', this.node);
        this.fallbackCloudGraphics = this.fallbackCloudNode.addComponent(Graphics);

        // 2. 着色器水墨云幕层
        this.veilNode = this.makeNode('ShaderVeil', this.node);
        this.veilSprite = this.veilNode.addComponent(Sprite);
        this.veilSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.veilSprite.trim = false;
        this.veilNode.active = false;
        this.initVeilShader();

        // 3. 新角色八卷纯手绘三国故事画卷（静雅呈现，零晃动、零矢量贴片、无进度条）
        this.storyTapNode = this.makeNode('StoryTapCatcher', this.node);
        const tapBtn = this.storyTapNode.addComponent(Button);
        tapBtn.transition = Button.Transition.NONE;
        this.storyTapNode.on(Button.EventType.CLICK, this.advanceOrSkipStory, this);
        this.storyTapNode.active = false;

        this.storyRoot = this.makeNode('StoryPrologue', this.node);
        this.storyOpacity = this.storyRoot.addComponent(UIOpacity);
        this.storyOpacity.opacity = 0;

        // 3.1 八幅独立手绘 16:9 原画（稳重满幅，仅在翻页时柔滑交叉叠化）
        this.pvStageRoot = this.makeNode('PvStage', this.storyRoot);
        this.pvSceneNodes = [];
        this.pvSceneSprites = [];
        this.pvSceneOpacities = [];
        for (let i = 0; i < PV_SCENE_PATHS.length; i++) {
            const sn = this.makeNode(`PvScene_${i + 1}`, this.pvStageRoot);
            const sp = sn.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            const op = sn.addComponent(UIOpacity);
            op.opacity = 0;
            this.pvSceneNodes.push(sn);
            this.pvSceneSprites.push(sp);
            this.pvSceneOpacities.push(op);
        }

        // 3.2 底部柔和暗墨渐晕（确保字幕在每幅原画上皆如电影般清晰可读）
        const vigNode = this.makeNode('PvVignette', this.storyRoot);
        this.pvVignetteGraphics = vigNode.addComponent(Graphics);

        // 3.3 老角色云幕微尘层（故事模式下完全隐藏，绝不干扰手绘插画）
        this.moteNode = this.makeNode('GoldMotes', this.node);
        this.moteGraphics = this.moteNode.addComponent(Graphics);
        this.seedMotes();

        // 3.4 左上角竖排章回印章与书法题签
        this.chapterStampRoot = this.makeNode('ChapterStamp', this.storyRoot);
        this.chapterStampOpacity = this.chapterStampRoot.addComponent(UIOpacity);
        this.chapterStampOpacity.opacity = 0;
        this.chapterStampGraphics = this.chapterStampRoot.addComponent(Graphics);
        this.chapterSealLabel = caption(this.chapterStampRoot, 'ChapterSeal', '壹', 0, 74, 30, 17,
            new Color(252, 238, 202, 255), Label.HorizontalAlign.CENTER);
        this.chapterSealLabel.isBold = true;
        this.styleClassic(this.chapterSealLabel, 72, 16, 12, 235, 1.2);
        this.chapterVerticalLabel = caption(this.chapterStampRoot, 'ChapterVertical', PV_CHAPTERS[0].vertical, 0, -14, 40, 22,
            new Color(246, 232, 194, 248), Label.HorizontalAlign.CENTER);
        this.chapterVerticalLabel.isBold = true;
        this.chapterVerticalLabel.lineHeight = 28;
        this.styleClassic(this.chapterVerticalLabel, 8, 12, 14, 245, 2.2);

        // 3.5 终卷沉稳朱砂玉印与题铭
        this.storySealRoot = this.makeNode('StorySealGroup', this.storyRoot);
        this.storySealOpacity = this.storySealRoot.addComponent(UIOpacity);
        this.storySealOpacity.opacity = 0;

        this.storySealRingNode = this.makeNode('StorySealRing', this.storySealRoot);
        this.storySealRingGraphics = this.storySealRingNode.addComponent(Graphics);

        this.storySealCard = this.makeNode('StorySealCard', this.storySealRoot);
        this.paintSealCard(this.storySealCard.addComponent(Graphics), 68);
        this.storySealLabel = caption(this.storySealCard, 'StorySealText', this.theme.seal, 0, 0, 58, 34,
            new Color(252, 240, 206, 255), Label.HorizontalAlign.CENTER);
        this.storySealLabel.isBold = true;
        this.styleClassic(this.storySealLabel, 72, 18, 12, 245, 1.8);

        // 3.6 底部细鎏金装饰线 + 双行静雅渐显电影旁白 + 终卷题铭
        const accentNode = this.makeNode('StoryAccentLine', this.storyRoot);
        this.pvAccentLineGraphics = accentNode.addComponent(Graphics);

        this.storySubtitleLine1 = caption(this.storyRoot, 'StorySubtitleLine1', '', 0, -194, 920, 23,
            new Color(252, 244, 224, 255), Label.HorizontalAlign.CENTER);
        this.storySubtitleLine1.overflow = Label.Overflow.SHRINK;
        this.styleClassic(this.storySubtitleLine1, 8, 10, 12, 252, 2.4);
        this.storySubtitleLine1Opacity = this.storySubtitleLine1.node.addComponent(UIOpacity);
        this.storySubtitleLine1Opacity.opacity = 0;

        this.storySubtitleLine2 = caption(this.storyRoot, 'StorySubtitleLine2', '', 0, -230, 920, 21,
            new Color(236, 226, 198, 248), Label.HorizontalAlign.CENTER);
        this.storySubtitleLine2.overflow = Label.Overflow.SHRINK;
        this.styleClassic(this.storySubtitleLine2, 8, 10, 12, 246, 2.2);
        this.storySubtitleLine2Opacity = this.storySubtitleLine2.node.addComponent(UIOpacity);
        this.storySubtitleLine2Opacity.opacity = 0;

        this.storyClimaxLabel = caption(this.storyRoot, 'StoryClimax', '', 0, -24, 700, 36,
            new Color(254, 236, 178, 255), Label.HorizontalAlign.CENTER);
        this.storyClimaxLabel.isBold = true;
        this.storyClimaxLabel.overflow = Label.Overflow.SHRINK;
        this.styleClassic(this.storyClimaxLabel, 24, 14, 10, 250, 3.0);
        this.storyClimaxOpacity = this.storyClimaxLabel.node.addComponent(UIOpacity);
        this.storyClimaxOpacity.opacity = 0;

        this.storyEpithetLabel = caption(this.storyRoot, 'StoryEpithet', '', 0, -66, 580, 17,
            new Color(238, 222, 184, 245), Label.HorizontalAlign.CENTER);
        this.storyEpithetLabel.overflow = Label.Overflow.SHRINK;
        this.styleClassic(this.storyEpithetLabel, 10, 14, 14, 235, 1.8);
        this.storyEpithetOpacity = this.storyEpithetLabel.node.addComponent(UIOpacity);
        this.storyEpithetOpacity.opacity = 0;

        // 4. 电影宽银幕黑边
        this.letterboxTop = this.makeNode('LetterboxTop', this.node);
        this.letterboxTopGraphics = this.letterboxTop.addComponent(Graphics);
        this.letterboxTop.active = false;
        this.letterboxBottom = this.makeNode('LetterboxBottom', this.node);
        this.letterboxBottomGraphics = this.letterboxBottom.addComponent(Graphics);
        this.letterboxBottom.active = false;

        // 4.5 置于黑边之上的顶部跳过按钮、左下八卷菱点与底部轻柔翻页提示（彻底无进度条）
        this.storyChromeRoot = this.makeNode('StoryChrome', this.node);
        this.storyChromeOpacity = this.storyChromeRoot.addComponent(UIOpacity);
        this.storyChromeOpacity.opacity = 0;

        const pipsNode = this.makeNode('StoryPips', this.storyChromeRoot);
        this.pvPipsGraphics = pipsNode.addComponent(Graphics);

        this.storyBottomHintLabel = caption(this.storyChromeRoot, 'StoryHint', '', 0, -334, 520, 14,
            new Color(244, 224, 168, 240), Label.HorizontalAlign.CENTER);
        this.styleClassic(this.storyBottomHintLabel, 8, 12, 14, 210, 1);
        this.storyBottomHintOpacity = this.storyBottomHintLabel.node.addComponent(UIOpacity);
        this.storyBottomHintOpacity.opacity = 0;

        this.storySkipNode = this.makeNode('StorySkip', this.storyChromeRoot);
        const skipBtn = this.storySkipNode.addComponent(Button);
        skipBtn.transition = Button.Transition.SCALE;
        skipBtn.zoomScale = 0.96;
        this.storySkipNode.addComponent(Graphics);
        this.storySkipOpacity = this.storySkipNode.addComponent(UIOpacity);
        this.storySkipOpacity.opacity = 0;
        const skipLbl = caption(this.storySkipNode, 'Text', '跳过序章 ›', 0, 0, 96, 14,
            new Color(242, 228, 192, 245), Label.HorizontalAlign.CENTER);
        this.styleClassic(skipLbl, 10, 14, 14, 220, 1);
        this.storySkipNode.on(Button.EventType.CLICK, this.skipStory, this);
        this.storySkipNode.active = false;

        this.storyRoot.active = false;
        this.storyChromeRoot.active = false;

        // 5. 老角色中庭古典印章 + 书法题铭 + 细鎏金进度条
        this.emblemRoot = this.makeNode('Emblem', this.node);
        this.emblemOpacity = this.emblemRoot.addComponent(UIOpacity);
        this.emblemOpacity.opacity = 0;

        const emblemBackdrop = this.makeNode('EmblemBackdrop', this.emblemRoot);
        this.emblemBackdropGraphics = emblemBackdrop.addComponent(Graphics);

        this.sealRingNode = this.makeNode('SealRing', this.emblemRoot);
        this.sealRingGraphics = this.sealRingNode.addComponent(Graphics);

        this.sealCardNode = this.makeNode('SealCard', this.emblemRoot);
        this.paintSealCard(this.sealCardNode.addComponent(Graphics), 52);
        this.sealLabel = caption(this.sealCardNode, 'SealText', this.theme.seal, 0, 0, 48, 28,
            new Color(250, 236, 198, 255), Label.HorizontalAlign.CENTER);
        this.sealLabel.isBold = true;
        this.styleClassic(this.sealLabel, 72, 18, 12, 235, 1.4);

        this.titleLabel = caption(this.emblemRoot, 'Title', this.theme.title, 0, 12, 420, 34,
            new Color(248, 228, 174, 255), Label.HorizontalAlign.CENTER);
        this.titleLabel.isBold = true;
        this.styleClassic(this.titleLabel, 10, 14, 16, 240, 2.4);

        this.subtitleLabel = caption(this.emblemRoot, 'Subtitle', this.theme.subtitle, 0, -24, 520, 15,
            new Color(218, 204, 172, 230), Label.HorizontalAlign.CENTER);
        this.subtitleLabel.overflow = Label.Overflow.SHRINK;
        this.styleClassic(this.subtitleLabel, 10, 14, 16, 200, 1.2);

        const barNode = this.makeNode('ProgressBar', this.emblemRoot);
        this.barGraphics = barNode.addComponent(Graphics);

        this.stageLabel = caption(this.emblemRoot, 'Stage', '正在铺展山河…', -60, -86, 260, 13,
            new Color(206, 194, 164, 225), Label.HorizontalAlign.LEFT);
        this.stageLabel.overflow = Label.Overflow.SHRINK;
        this.styleClassic(this.stageLabel, 10, 14, 16, 190, 1);

        this.percentLabel = caption(this.emblemRoot, 'Percent', '0%', 130, -86, 80, 13,
            new Color(238, 208, 138, 245), Label.HorizontalAlign.RIGHT);
        this.styleClassic(this.percentLabel, 10, 14, 16, 190, 1);

        this.emblemRoot.active = false;
        this.layout();
    }

    private initVeilShader(): void {
        if (!this.veilSprite || typeof ImageAsset !== 'function' || typeof Texture2D !== 'function' || typeof Material !== 'function') {
            return;
        }
        try {
            const pixels = new Uint8Array(4 * 4 * 4);
            pixels.fill(255);
            this.veilImage = new ImageAsset({
                _data: pixels,
                width: 4,
                height: 4,
                format: Texture2D.PixelFormat.RGBA8888,
                _compressed: false,
            });
            this.veilTexture = new Texture2D();
            this.veilTexture.image = this.veilImage;
            this.veilTexture.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
            this.veilTexture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
            this.veilFrame = new SpriteFrame();
            this.veilFrame.texture = this.veilTexture;
            this.veilFrame.packable = false;
            this.veilSprite.spriteFrame = this.veilFrame;
        } catch {
            return;
        }

        const bindEffect = (effect: EffectAsset) => {
            if (!isValid(this, true) || !this.veilSprite || !this.veilNode) return;
            try {
                const mat = new Material();
                mat.initialize({ effectAsset: effect });
                this.veilMaterial = mat;
                this.veilSprite.customMaterial = mat;
                this.shaderReady = true;
                this.veilNode.active = true;
                if (this.fallbackCloudNode) this.fallbackCloudNode.active = false;
                this.syncVisuals();
            } catch (error) {
                console.warn('[CloudVeilTransition] 云幕材质初始化失败，回退矢量柔雾', error);
            }
        };

        if (CloudVeilTransition.cachedEffect) {
            bindEffect(CloudVeilTransition.cachedEffect);
        } else {
            resources.load(EFFECT_PATH, EffectAsset, (error, effect) => {
                if (error || !effect) return;
                if (!CloudVeilTransition.cachedEffect) {
                    effect.addRef?.();
                    CloudVeilTransition.cachedEffect = effect;
                }
                bindEffect(effect);
            });
        }
    }

    private resolveViewportSize(): { w: number; h: number } {
        const parentSize = this.node.parent?.getComponent(UITransform);
        const visible = view?.getVisibleSize ? view.getVisibleSize() : { width: 1280, height: 720 };
        let cameraW = 0;
        let cameraH = 0;
        const win = typeof screen !== 'undefined' ? screen?.windowSize : null;
        const scaleY = typeof view?.getScaleY === 'function' ? view.getScaleY() : 0;
        if (win && win.width > 0 && win.height > 0 && scaleY > 0) {
            cameraH = win.height / scaleY;
            cameraW = win.width / scaleY;
        }
        const w = Math.max(320, Math.ceil(Math.max(parentSize?.width || 0, visible?.width || 0, cameraW) || 1280));
        const h = Math.max(320, Math.ceil(Math.max(parentSize?.height || 0, visible?.height || 0, cameraH) || 720));
        return { w, h };
    }

    private syncViewportIfNeeded(): void {
        const { w, h } = this.resolveViewportSize();
        if (w !== this.viewportW || h !== this.viewportH) {
            this.layout();
        }
    }

    private layout(): void {
        const { w, h } = this.resolveViewportSize();
        this.viewportW = w;
        this.viewportH = h;
        const compact = w < 640 || h < 480;
        const bleedW = w + VEIL_OVERSCAN * 2;
        const bleedH = h + VEIL_OVERSCAN * 2;

        place(this.node, 0, 0, w, h);
        if (this.fallbackCloudNode) place(this.fallbackCloudNode, 0, 0, bleedW, bleedH);
        if (this.veilNode) place(this.veilNode, 0, 0, bleedW, bleedH);
        if (this.moteNode) place(this.moteNode, 0, 0, w, h);
        if (this.storyTapNode) place(this.storyTapNode, 0, 0, bleedW, bleedH);

        const barH = compact ? 36 : LETTERBOX_HEIGHT;
        if (this.letterboxTop) place(this.letterboxTop, 0, h / 2 - barH / 2, bleedW, barH);
        if (this.letterboxBottom) place(this.letterboxBottom, 0, -h / 2 + barH / 2, bleedW, barH);

        if (this.emblemRoot) {
            const emblemW = Math.min(560, w - 48);
            place(this.emblemRoot, 0, compact ? 10 : 18, emblemW, 250);
            if (this.emblemBackdropGraphics) {
                place(this.emblemBackdropGraphics.node, 0, -6, emblemW, 240);
                this.paintEmblemBackdrop(this.emblemBackdropGraphics, emblemW, compact ? 216 : 236);
            }
            const sealY = compact ? 74 : 84;
            if (this.sealRingNode) place(this.sealRingNode, 0, sealY, 120, 120);
            if (this.sealCardNode) place(this.sealCardNode, 0, sealY, 54, 54);
            if (this.titleLabel) {
                place(this.titleLabel.node, 0, compact ? 14 : 18, Math.min(420, w - 64), 42);
                this.titleLabel.fontSize = compact ? 28 : 34;
                this.titleLabel.lineHeight = compact ? 36 : 42;
            }
            if (this.subtitleLabel) {
                place(this.subtitleLabel.node, 0, compact ? -18 : -20, Math.min(480, w - 64), 24);
                this.subtitleLabel.fontSize = compact ? 13 : 15;
            }
            this.barWidth = compact ? Math.min(280, w - 88) : Math.min(380, w - 120);
            if (this.barGraphics) place(this.barGraphics.node, 0, compact ? -54 : -60, this.barWidth + 24, 24);
            if (this.stageLabel) {
                const sw = this.barWidth - 72;
                place(this.stageLabel.node, -this.barWidth / 2 + sw / 2, compact ? -76 : -84, sw, 20);
                this.stageLabel.fontSize = compact ? 12 : 13;
            }
            if (this.percentLabel) {
                place(this.percentLabel.node, this.barWidth / 2 - 34, compact ? -76 : -84, 68, 20);
                this.percentLabel.fontSize = compact ? 12 : 13;
            }
        }

        if (this.storyRoot) {
            place(this.storyRoot, 0, 0, w, h);
            if (this.storyChromeRoot) place(this.storyChromeRoot, 0, 0, w, h);
            if (this.pvStageRoot) place(this.pvStageRoot, 0, 0, w, h);
            // 严格 1:1 cover 铺满画幅（保留微小超画幅出血，绝不漏边、绝不放大晃动）
            const coverScale = Math.max(bleedW / 1280, (h - barH * 2 + 8) / 720);
            this.pvSceneBaseW = Math.round(1280 * coverScale);
            this.pvSceneBaseH = Math.round(720 * coverScale);
            for (const sn of this.pvSceneNodes) {
                place(sn, 0, 0, this.pvSceneBaseW, this.pvSceneBaseH);
            }
            if (this.pvVignetteGraphics) place(this.pvVignetteGraphics.node, 0, 0, bleedW, bleedH);

            this.chapterStampBaseX = -w / 2 + (compact ? 42 : 68);
            this.chapterStampBaseY = h / 2 - barH - (compact ? 94 : 114);
            if (this.chapterStampRoot) {
                place(this.chapterStampRoot, this.chapterStampBaseX, this.chapterStampBaseY, 64, 196);
                this.paintChapterStampFrame(this.chapterStampGraphics, compact);
            }
            if (this.chapterSealLabel) {
                place(this.chapterSealLabel.node, 0, compact ? 64 : 74, 30, 26);
                this.chapterSealLabel.fontSize = compact ? 15 : 17;
            }
            if (this.chapterVerticalLabel) {
                place(this.chapterVerticalLabel.node, 0, compact ? -14 : -16, 40, 130);
                this.chapterVerticalLabel.fontSize = compact ? 19 : 22;
                this.chapterVerticalLabel.lineHeight = compact ? 24 : 28;
            }

            const sealY = compact ? 66 : 92;
            if (this.storySealRoot) place(this.storySealRoot, 0, sealY, 200, 200);
            if (this.storySealRingNode) place(this.storySealRingNode, 0, 0, 180, 180);
            if (this.storySealCard) place(this.storySealCard, 0, 0, 68, 68);

            const subW = Math.min(920, w - 72);
            this.storyAccentLineY = -h / 2 + barH + (compact ? 96 : 114);
            this.storySubLine1Y = -h / 2 + barH + (compact ? 64 : 78);
            this.storySubLine2Y = -h / 2 + barH + (compact ? 34 : 42);
            this.storyClimaxY = compact ? 0 : 8;
            this.storyEpithetY = compact ? -38 : -36;

            if (this.pvAccentLineGraphics) {
                place(this.pvAccentLineGraphics.node, 0, this.storyAccentLineY, 360, 16);
            }
            if (this.storySubtitleLine1) {
                place(this.storySubtitleLine1.node, 0, this.storySubLine1Y, subW, compact ? 30 : 36);
                this.storySubtitleLine1.fontSize = compact ? 17 : 23;
                this.storySubtitleLine1.lineHeight = compact ? 24 : 32;
            }
            if (this.storySubtitleLine2) {
                place(this.storySubtitleLine2.node, 0, this.storySubLine2Y, subW, compact ? 28 : 34);
                this.storySubtitleLine2.fontSize = compact ? 15 : 21;
                this.storySubtitleLine2.lineHeight = compact ? 22 : 30;
            }
            if (this.storyClimaxLabel) {
                place(this.storyClimaxLabel.node, 0, this.storyClimaxY, Math.min(700, w - 48), compact ? 44 : 52);
                this.storyClimaxLabel.fontSize = compact ? 26 : 36;
                this.storyClimaxLabel.lineHeight = compact ? 34 : 44;
            }
            if (this.storyEpithetLabel) {
                place(this.storyEpithetLabel.node, 0, this.storyEpithetY, Math.min(580, w - 56), 26);
                this.storyEpithetLabel.fontSize = compact ? 14 : 17;
            }
            if (this.pvPipsGraphics) {
                place(this.pvPipsGraphics.node, -w / 2 + (compact ? 96 : 122), -h / 2 + barH / 2, 180, 20);
            }
            if (this.storyBottomHintLabel) {
                place(this.storyBottomHintLabel.node, 0, -h / 2 + barH / 2, Math.min(520, w - 48), 22);
                this.storyBottomHintLabel.fontSize = compact ? 12 : 14;
            }
            if (this.storySkipNode) {
                place(this.storySkipNode, w / 2 - 68, h / 2 - barH / 2, 102, 30);
                const sg = this.storySkipNode.getComponent(Graphics);
                if (sg) {
                    sg.clear();
                    sg.fillColor = new Color(18, 24, 24, 205);
                    sg.roundRect(-51, -15, 102, 30, 4);
                    sg.fill();
                    sg.strokeColor = new Color(218, 184, 118, 185);
                    sg.lineWidth = 1;
                    sg.roundRect(-50.5, -14.5, 101, 29, 4);
                    sg.stroke();
                }
            }
        }
    }

    private syncVisuals(): void {
        if (this.shaderReady && this.veilMaterial) {
            const aspect = this.viewportW / Math.max(1, this.viewportH);
            this.stateVec.set(this.clock, this.cover, aspect, this.mode);
            this.styleVec.set(this.emblemAlpha, this.theme.focusU, this.theme.focusV, this.warmth);
            this.veilMaterial.setProperty('veilState', this.stateVec);
            this.veilMaterial.setProperty('veilStyle', this.styleVec);
        } else if (this.fallbackCloudGraphics) {
            this.drawFallbackClouds(this.fallbackCloudGraphics);
        }

        this.drawMotes();
        this.drawLetterboxes();

        if (this.storyMode && this.storyRoot && this.storyOpacity && this.storyRoot.active) {
            this.syncStoryVisuals();
        } else if (this.emblemRoot && this.emblemOpacity && this.emblemRoot.active) {
            this.emblemOpacity.opacity = Math.round(this.emblemAlpha * 255);
            this.drawSealRing(this.sealRingGraphics);
            this.drawProgressBar();
            const percent = Math.floor(Math.min(1, Math.max(0, this.visualProgress)) * 100);
            if (this.percentLabel && percent !== this.displayedPercent) {
                this.displayedPercent = percent;
                this.percentLabel.string = `${percent}%`;
            }
        }
    }

    private drawLetterboxes(): void {
        if (!this.storyMode || !this.letterboxTop || !this.letterboxBottom) return;
        const compact = this.viewportW < 640 || this.viewportH < 480;
        const barH = compact ? 36 : LETTERBOX_HEIGHT;
        const ratio = this.phase === 'closing' ? Math.min(1, this.cover * 1.15) : 1;
        const h = Math.round(barH * this.easeCubicOut(ratio));
        const w = this.viewportW + VEIL_OVERSCAN * 2;
        const drawBar = (g: Graphics | null, isTop: boolean) => {
            if (!g) return;
            g.clear();
            if (h <= 0) return;
            g.fillColor = new Color(6, 10, 11, 246);
            if (isTop) g.rect(-w / 2, barH / 2 - h, w, h);
            else g.rect(-w / 2, -barH / 2, w, h);
            g.fill();
            g.strokeColor = new Color(214, 182, 116, Math.round(145 * ratio));
            g.lineWidth = 1;
            const lineY = isTop ? barH / 2 - h : -barH / 2 + h;
            g.moveTo(-w / 2, lineY);
            g.lineTo(w / 2, lineY);
            g.stroke();
        };
        drawBar(this.letterboxTopGraphics, true);
        drawBar(this.letterboxBottomGraphics, false);
    }

    private syncStoryVisuals(): void {
        if (!this.storyOpacity) return;
        const master = this.emblemAlpha;
        this.storyOpacity.opacity = Math.round(master * 255);
        if (this.storyChromeOpacity) this.storyChromeOpacity.opacity = Math.round(master * 255);

        const compact = this.viewportW < 640 || this.viewportH < 480;
        const barH = compact ? 36 : LETTERBOX_HEIGHT;
        const page = this.currentPage;
        const spec = PV_CHAPTERS[page];
        const pt = this.pageElapsed;
        const isFinalPage = page === PV_CHAPTERS.length - 1;

        // 1. 八幅手绘插画静雅呈现（0 晃动、0 抖动，仅翻页时 0.56s 柔滑交叉叠化）
        const dissolve = this.easeSmooth(Math.min(1, pt / PAGE_DISSOLVE_SECONDS));
        for (let i = 0; i < this.pvSceneNodes.length; i++) {
            const sn = this.pvSceneNodes[i];
            const op = this.pvSceneOpacities[i];
            const isCurr = i === page;
            const isPrev = i === this.prevPage && dissolve < 0.995;

            if (!isCurr && !isPrev) {
                sn.active = false;
                op.opacity = 0;
                continue;
            }
            sn.active = true;
            if (isCurr) {
                op.opacity = Math.round(dissolve * 255);
            } else {
                op.opacity = Math.round((1 - dissolve) * 255);
            }
        }

        // 2. 柔和暗墨底衬渐晕（纯视觉衬托文字，无闪烁）
        this.drawPvVignette(barH);

        // 3. 左上角竖排章回印章 + 底部双行整句渐显旁白
        if (page !== this.appliedPageIndex) {
            this.appliedPageIndex = page;
            if (this.chapterSealLabel) this.chapterSealLabel.string = spec.num;
            if (this.chapterVerticalLabel) this.chapterVerticalLabel.string = spec.vertical;
            const rawLine = this.storyLines[page] || '';
            const parts = rawLine.split('\n');
            if (this.storySubtitleLine1) this.storySubtitleLine1.string = parts[0] || '';
            if (this.storySubtitleLine2) this.storySubtitleLine2.string = parts[1] || '';
        }

        const stampFade = this.easeCubicOut(Math.min(1, Math.max(0, (pt - 0.10) / 0.48)));
        if (this.chapterStampRoot && this.chapterStampOpacity) {
            this.chapterStampOpacity.opacity = Math.round(stampFade * 246);
            this.chapterStampRoot.setPosition(this.chapterStampBaseX, this.chapterStampBaseY, 0);
        }

        const line1Alpha = this.easeCubicOut(Math.min(1, Math.max(0, (pt - 0.18) / 0.54)));
        const line2Alpha = this.easeCubicOut(Math.min(1, Math.max(0, (pt - 0.80) / 0.54)));

        this.drawAccentBrushLine(line1Alpha * master);

        if (this.storySubtitleLine1 && this.storySubtitleLine1Opacity) {
            this.storySubtitleLine1Opacity.opacity = Math.round(line1Alpha * 255);
            this.storySubtitleLine1.node.setPosition(0, this.storySubLine1Y - (1 - line1Alpha) * 6, 0);
        }
        if (this.storySubtitleLine2 && this.storySubtitleLine2Opacity) {
            this.storySubtitleLine2Opacity.opacity = Math.round(line2Alpha * 248);
            this.storySubtitleLine2.node.setPosition(0, this.storySubLine2Y - (1 - line2Alpha) * 6, 0);
        }

        // 4. 终卷（卷捌·授印立旗）：沉稳端庄的朱砂玉印与「大旗初立 · 入主XX」柔和浮现（零震屏晃动）
        const sealT = isFinalPage ? this.easeCubicOut(Math.min(1, Math.max(0, (pt - 0.65) / 0.65))) : 0;
        if (this.storySealOpacity && this.storySealCard) {
            this.storySealOpacity.opacity = Math.round(sealT * 250);
            const sc = 1.12 - 0.12 * sealT;
            this.storySealCard.setScale(sc, sc, 1);
            this.drawSealRing(this.storySealRingGraphics, sealT);
        }
        const climaxT = isFinalPage ? this.easeCubicOut(Math.min(1, Math.max(0, (pt - 0.90) / 0.60))) : 0;
        if (this.storyClimaxLabel && this.storyClimaxOpacity) {
            this.storyClimaxOpacity.opacity = Math.round(climaxT * 255);
            this.storyClimaxLabel.node.setPosition(0, this.storyClimaxY - (1 - climaxT) * 8, 0);
        }
        const epithetT = isFinalPage ? this.easeCubicOut(Math.min(1, Math.max(0, (pt - 1.15) / 0.55))) : 0;
        if (this.storyEpithetLabel && this.storyEpithetOpacity) {
            this.storyEpithetOpacity.opacity = Math.round(epithetT * 240);
            this.storyEpithetLabel.node.setPosition(0, this.storyEpithetY - (1 - epithetT) * 6, 0);
        }

        // 5. 左下八卷菱点 + 底部轻柔翻页提示 + 右上角跳过按钮（彻底无进度条）
        this.drawActPips(page, master);

        if (this.storyBottomHintLabel && this.storyBottomHintOpacity) {
            const promptReadyT = Math.min(1, Math.max(0, (pt - 1.15) / 0.45));
            const pulse = 0.72 + 0.28 * Math.sin(this.clock * 2.0);
            if (!isFinalPage) {
                this.storyBottomHintLabel.string = `轻触画面 · 翻阅下卷 (${page + 1}/${PV_CHAPTERS.length}) ▾`;
                this.storyBottomHintOpacity.opacity = Math.round(promptReadyT * pulse * 238 * master);
            } else if (this.readyForReveal) {
                const enterLabel = this.zoneName ? `轻触画面 · 入主${this.zoneName}，启程天下 ▾` : '轻触画面 · 亲临主城，启程天下 ▾';
                this.storyBottomHintLabel.string = enterLabel;
                this.storyBottomHintOpacity.opacity = Math.round(promptReadyT * pulse * 248 * master);
            } else {
                this.storyBottomHintLabel.string = '正在铺展山河，请稍候…';
                this.storyBottomHintOpacity.opacity = Math.round(promptReadyT * 210 * master);
            }
        }

        if (this.storySkipNode && this.storySkipOpacity) {
            const canSkip = this.readyForReveal && this.phase === 'covered';
            this.storySkipNode.active = canSkip;
            if (canSkip) {
                this.storySkipOpacity.opacity = Math.round(master * 240);
            }
        }
    }

    /** 字幕上方轻雅古金细线与中央菱饰 */
    private drawAccentBrushLine(progress: number): void {
        const g = this.pvAccentLineGraphics;
        if (!g) return;
        g.clear();
        if (progress <= 0.02) return;
        const halfLen = 132 * this.easeCubicOut(progress);
        const alpha = Math.round(175 * progress);
        g.strokeColor = new Color(230, 196, 124, alpha);
        g.lineWidth = 1.1;
        g.moveTo(-halfLen, 0);
        g.lineTo(-10, 0);
        g.moveTo(10, 0);
        g.lineTo(halfLen, 0);
        g.stroke();
        const r = 3.2 * progress;
        g.fillColor = new Color(248, 218, 146, Math.round(235 * progress));
        g.moveTo(0, r); g.lineTo(r, 0); g.lineTo(0, -r); g.lineTo(-r, 0); g.close();
        g.fill();
    }

    private paintChapterStampFrame(g: Graphics | null, compact: boolean): void {
        if (!g) return;
        g.clear();
        const sealY = compact ? 64 : 74;
        const sealHalf = compact ? 14 : 16;
        g.strokeColor = new Color(228, 196, 128, 145);
        g.lineWidth = 1.2;
        g.moveTo(22, sealY + sealHalf);
        g.lineTo(22, -82);
        g.stroke();
        g.fillColor = new Color(158, 38, 28, 236);
        g.roundRect(-sealHalf, sealY - sealHalf, sealHalf * 2, sealHalf * 2, 4);
        g.fill();
        g.strokeColor = new Color(248, 218, 148, 220);
        g.lineWidth = 1.2;
        g.roundRect(-sealHalf + 1, sealY - sealHalf + 1, sealHalf * 2 - 2, sealHalf * 2 - 2, 3);
        g.stroke();
    }

    private drawPvVignette(barH: number): void {
        const g = this.pvVignetteGraphics;
        if (!g) return;
        g.clear();
        const w = this.viewportW + VEIL_OVERSCAN * 2, h = this.viewportH;
        const hw = w * 0.5, hh = h * 0.5;
        const botBandH = Math.min(244, (h - barH * 2) * 0.44);
        const steps = 14;
        for (let i = 0; i < steps; i++) {
            const ratio = 1 - i / steps;
            const a = Math.round(224 * ratio * ratio);
            g.fillColor = new Color(7, 11, 13, a);
            g.rect(-hw, -hh + barH + (botBandH / steps) * i, w, botBandH / steps + 1);
            g.fill();
        }
        const topBandH = Math.min(96, (h - barH * 2) * 0.18);
        for (let i = 0; i < 6; i++) {
            const ratio = 1 - i / 6;
            g.fillColor = new Color(7, 11, 13, Math.round(92 * ratio * ratio));
            g.rect(-hw, hh - barH - (topBandH / 6) * (i + 1), w, topBandH / 6 + 1);
            g.fill();
        }
    }

    private drawActPips(pageIndex: number, master: number): void {
        const g = this.pvPipsGraphics;
        if (!g) return;
        g.clear();
        const gap = 15;
        const startX = -((PV_CHAPTERS.length - 1) * gap) / 2;
        for (let i = 0; i < PV_CHAPTERS.length; i++) {
            const x = startX + i * gap;
            const active = i === pageIndex;
            const past = i < pageIndex;
            const r = active ? 4.2 : 2.6;
            g.fillColor = active
                ? new Color(252, 218, 134, Math.round(255 * master))
                : past
                    ? new Color(196, 166, 108, Math.round(205 * master))
                    : new Color(128, 122, 106, Math.round(120 * master));
            g.moveTo(x, r); g.lineTo(x + r, 0); g.lineTo(x, -r); g.lineTo(x - r, 0); g.close();
            g.fill();
        }
    }

    /** 着色器未就绪时的多层柔雾矢量回退，保证任意环境都有平滑云幕合拢与散开。 */
    private drawFallbackClouds(g: Graphics): void {
        g.clear();
        if (this.cover <= 0.002) return;
        const w = this.viewportW + VEIL_OVERSCAN * 2;
        const h = this.viewportH + VEIL_OVERSCAN * 2;
        const hw = w * 0.5;
        const hh = h * 0.5;

        const baseAlpha = Math.round(Math.min(255, this.cover * this.cover * 260));
        g.fillColor = new Color(14, 22, 25, baseAlpha);
        g.rect(-hw - 8, -hh - 8, w + 16, h + 16);
        g.fill();

        const spread = (1 - this.cover) * (hw + 180);
        const drift = Math.sin(this.clock * 0.9) * 14;
        const puffSpecs: Array<[number, number, number, number, number]> = [
            [-spread - hw * 0.25 + drift, hh * 0.34, hw * 0.58, hh * 0.56, 135],
            [spread + hw * 0.25 - drift, -hh * 0.28, hw * 0.62, hh * 0.58, 145],
            [-spread - hw * 0.12 - drift * 0.7, -hh * 0.32, hw * 0.52, hh * 0.50, 115],
            [spread + hw * 0.14 + drift * 0.7, hh * 0.28, hw * 0.54, hh * 0.48, 120],
        ];
        for (const [cx, cy, rx, ry, maxA] of puffSpecs) {
            const a = Math.round(maxA * Math.min(1, this.cover * 1.15));
            g.fillColor = new Color(36, 56, 58, a);
            g.ellipse(cx, cy, rx, ry);
            g.fill();
            g.fillColor = new Color(214, 204, 178, Math.round(a * 0.22));
            g.ellipse(cx, cy + ry * 0.16, rx * 0.72, ry * 0.52);
            g.fill();
        }
    }

    private seedMotes(): void {
        this.motes = [];
        for (let i = 0; i < 14; i++) {
            const angle = (i * 2.39996) % (Math.PI * 2);
            const radius = 0.14 + ((i * 37) % 100) / 145;
            this.motes.push({
                x: Math.cos(angle) * radius * 0.88,
                y: Math.sin(angle) * radius * 0.72,
                vx: (i % 3 === 0 ? -1 : 1) * (0.012 + (i % 4) * 0.005),
                vy: 0.018 + (i % 4) * 0.009,
                radius: 1.0 + (i % 3) * 0.45,
                phase: i * 1.17,
                alpha: 0.34 + (i % 3) * 0.14,
            });
        }
    }

    private updateMotes(dt: number): void {
        for (const m of this.motes) {
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            if (m.y > 0.56) m.y = -0.56;
            if (m.y < -0.56) m.y = 0.56;
            if (m.x > 0.58) m.x = -0.58;
            if (m.x < -0.58) m.x = 0.58;
        }
    }

    /** 仅用于老角色中庭加载遮罩；故事插画模式下完全清空，保持原画零噪点。 */
    private drawMotes(): void {
        const g = this.moteGraphics;
        if (!g) return;
        g.clear();
        if (this.storyMode) return;

        const ambientMote = this.cover > 0.35 ? (this.cover - 0.35) / 0.65 * 0.38 : 0;
        const visibility = this.cover * Math.max(ambientMote, this.emblemAlpha);
        if (visibility <= 0.05) return;
        for (const m of this.motes) {
            const edgeX = Math.max(0, Math.min(1, (0.56 - Math.abs(m.x)) / 0.14));
            const edgeY = Math.max(0, Math.min(1, (0.54 - Math.abs(m.y)) / 0.14));
            const breath = 0.74 + 0.26 * Math.sin(this.clock * 0.85 + m.phase);
            const alpha = Math.round(150 * m.alpha * breath * visibility * edgeX * edgeY);
            if (alpha < 5) continue;
            const px = m.x * this.viewportW;
            const py = m.y * this.viewportH;
            const r = m.radius * 1.1;
            g.fillColor = new Color(252, 234, 184, alpha);
            g.moveTo(px, py + r);
            g.lineTo(px + r * 0.75, py);
            g.lineTo(px, py - r);
            g.lineTo(px - r * 0.75, py);
            g.close();
            g.fill();
        }
    }

    /** 中庭古典墨玉云纹底衬：让老角色进图印章与进度条在云海上有稳重焦点，避免浮字空旷感。 */
    private paintEmblemBackdrop(g: Graphics, w: number, h: number): void {
        g.clear();
        const cardW = Math.min(460, Math.max(300, w - 24));
        const cardH = Math.min(224, h);
        const hw = cardW * 0.5;
        const hh = cardH * 0.5;

        // 柔和深墨玉透底
        g.fillColor = new Color(10, 17, 19, 152);
        g.roundRect(-hw, -hh, cardW, cardH, 10);
        g.fill();

        // 细鎏金上下卷轴线与四角菱饰
        g.strokeColor = new Color(220, 186, 118, 92);
        g.lineWidth = 1;
        g.roundRect(-hw + 1, -hh + 1, cardW - 2, cardH - 2, 9);
        g.stroke();

        const ruleW = Math.min(hw - 36, 168);
        g.strokeColor = new Color(238, 206, 138, 155);
        g.lineWidth = 1.2;
        for (const sy of [-1, 1]) {
            const y = sy * (hh - 10);
            g.moveTo(-ruleW, y);
            g.lineTo(-10, y);
            g.moveTo(10, y);
            g.lineTo(ruleW, y);
        }
        g.stroke();

        g.fillColor = new Color(246, 218, 148, 215);
        for (const sy of [-1, 1]) {
            const y = sy * (hh - 10);
            g.moveTo(0, y + 3.2); g.lineTo(3.2, y); g.lineTo(0, y - 3.2); g.lineTo(-3.2, y); g.close();
            g.fill();
        }
    }

    private paintSealCard(g: Graphics, size: number): void {
        const half = size / 2;
        g.clear();
        g.fillColor = new Color(156, 40, 30, 250);
        g.roundRect(-half, -half, size, size, 6);
        g.fill();
        g.strokeColor = new Color(248, 218, 148, 245);
        g.lineWidth = 1.8;
        g.roundRect(-half + 1, -half + 1, size - 2, size - 2, 5);
        g.stroke();
        g.strokeColor = new Color(255, 238, 188, 175);
        g.lineWidth = 1;
        g.roundRect(-half + 5, -half + 5, size - 10, size - 10, 3);
        g.stroke();
    }

    private drawSealRing(g: Graphics | null = this.sealRingGraphics, expand = 1): void {
        if (!g) return;
        g.clear();
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 2.2);
        const outerR = 44 + pulse * 3;
        g.strokeColor = new Color(240, 206, 132, Math.round((54 + pulse * 48) * expand));
        g.lineWidth = 1.3;
        g.circle(0, 0, outerR);
        g.stroke();
        g.strokeColor = new Color(228, 194, 122, Math.round((120 + pulse * 40) * expand));
        g.lineWidth = 1.2;
        const wingEnd = 50 + 82 * expand;
        for (const sx of [-1, 1]) {
            g.moveTo(sx * 50, 0);
            g.lineTo(sx * wingEnd, 0);
        }
        g.stroke();
        g.fillColor = new Color(250, 226, 158, Math.round(220 * expand));
        for (const sx of [-1, 1]) {
            const dx = sx * 50;
            g.moveTo(dx, 3.4); g.lineTo(dx + 3.4, 0); g.lineTo(dx, -3.4); g.lineTo(dx - 3.4, 0); g.close(); g.fill();
        }
    }

    private drawProgressBar(): void {
        const g = this.barGraphics;
        if (!g) return;
        g.clear();
        const w = this.barWidth;
        const hw = w / 2;
        const trackH = 4;
        const progress = Math.min(1, Math.max(0, this.visualProgress));

        g.fillColor = new Color(24, 34, 36, 210);
        g.roundRect(-hw, -trackH / 2, w, trackH, 2);
        g.fill();
        g.strokeColor = new Color(204, 174, 114, 95);
        g.lineWidth = 1;
        g.roundRect(-hw, -trackH / 2, w, trackH, 2);
        g.stroke();

        const fillW = Math.max(0, w * progress);
        if (fillW > 1) {
            g.fillColor = new Color(232, 190, 108, 240);
            g.roundRect(-hw, -trackH / 2, fillW, trackH, 2);
            g.fill();
            const tipX = -hw + fillW;
            g.fillColor = new Color(255, 224, 144, 95);
            g.circle(tipX, 0, 8);
            g.fill();
            g.fillColor = new Color(255, 246, 212, 255);
            g.moveTo(tipX, 4.2); g.lineTo(tipX + 4.2, 0); g.lineTo(tipX, -4.2); g.lineTo(tipX - 4.2, 0); g.close(); g.fill();
        }
    }

    private styleClassic(label: Label, r: number, g: number, b: number, a: number, width: number): void {
        label.useSystemFont = true;
        label.fontFamily = CLASSIC_FONT;
        label.outlineColor = new Color(r, g, b, a);
        label.outlineWidth = width;
    }

    private makeNode(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = this.node.layer;
        parent.addChild(node);
        node.addComponent(UITransform);
        return node;
    }

    private easeSmooth(t: number): number {
        return t * t * (3 - 2 * t);
    }

    private easeCubicInOut(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    private easeCubicOut(t: number): number {
        return 1 - Math.pow(1 - t, 3);
    }
}
