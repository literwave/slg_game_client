import {
    _decorator, BlockInputEvents, Button, Canvas, Color, Component, EventKeyboard, EventMouse, EventTouch,
    Graphics, Input, input, KeyCode, Label, Node, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform,
    Vec2, Vec3, Widget, resources, view,
} from 'cc';
import BuildCommand from '../build/BuildCommand';
import LoginCommand from '../login/LoginCommand';
import { AudioManager } from '../common/AudioManager';
import { LogicEvent } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import MapCommand from '../map/MapCommand';
import MapUICommand from '../map/ui/MapUICommand';
import { buildingArt, buildingGoalPresentation } from '../map/ui/BuildingPresentation';
import { CityColors } from '../map/ui/CityBuildingView';
import { caption, inkSurface, place } from '../map/ui/ManagementStyle';
import InnerCityActionBar from './InnerCityActionBar';
import InnerCityBuildingSlot from './InnerCityBuildingSlot';
import InnerCityDetailDrawer from './InnerCityDetailDrawer';
import {
    clampCameraOffset, computeFocusPan, computeInitialZoom, computeMinZoom, findInnerCityPlot,
    INNER_CITY_CANVAS_HEIGHT, INNER_CITY_CANVAS_WIDTH, INNER_CITY_GROUND_ART,
    INNER_CITY_MAX_ZOOM, INNER_CITY_PLOTS, InnerCityShortcutKind, plotCanvasPosition, sortedPlotOrder,
} from './InnerCityLayout';

const { ccclass } = _decorator;

const DRAG_THRESHOLD_PX = 6;
const MAX_INERTIA_SPEED = 2200;

const DOCK_ICON_PATHS = {
    overview: 'ui/sidebar/sidebar-buildings-v1',
    troops: 'ui/sidebar/sidebar-army-v1',
    mainCity: 'ui/hud/hud-inner-city-front',
} as const;

export interface EnterInnerCityOptions {
    cityId?: number;
    focusBuildingType?: number;
    openDetail?: boolean;
}

/**
 * 独立全屏内城场景舞台（商业 SLG 一体化雄城架构，与 MapScene 平级热切零重载）：
 * - 一体化 2K 汉风雄城全景图（完整城垣、宫阙、演武、池苑、市井与四郊产区，零贴纸割裂感）；
 * - 16 栋建筑铭牌渲染于 1:1 屏幕空间覆盖层（PlaqueOverlayLayer），任意缩放倍率均锐利清晰；
 * - 支持丝滑拖拽惯性、光标/双指缩放、边界约束与柔和飞镜聚焦；
 * - 点击建筑区或铭牌弹出脚下弧形汉铜操作环，支持一键多锤齐敲营造与展开右侧详情抽屉。
 */
@ccclass('InnerCityScene')
export default class InnerCityScene extends Component {
    private rootOpacity!: UIOpacity;
    private viewportNode!: Node;
    private stageNode!: Node;
    private groundSprite!: Sprite;
    private ambientLayer!: Node;
    private livingFxGraphics!: Graphics;
    private livingTime = 0;
    private sunMotes: Array<{ x: number; y: number; vx: number; vy: number; r: number; phase: number }> = [];
    private waterGlints: Array<{ x: number; y: number; phase: number; w: number }> = [];
    private buildingLayer!: Node;
    private plaqueLayer!: Node;
    private slots = new Map<number, InnerCityBuildingSlot>();
    private slotOrder: InnerCityBuildingSlot[] = [];
    private actionBar!: InnerCityActionBar;
    private drawer!: InnerCityDetailDrawer;

    private topToolbar!: Node;
    private topHudScrim!: Graphics;
    private exitButton!: Node;
    private summaryBadge!: Node;
    private summaryBg!: Graphics;
    private summaryLabel!: Label;
    private actionableBadge!: Node;
    private actionableBg!: Graphics;
    private actionableLabel!: Label;
    private actionableTypes: number[] = [];
    private actionableCycleIdx = 0;

    private cameraDock!: Node;
    private routeMapButton!: Node;
    private troopsButton!: Node;
    private centerMainButton!: Node;
    private zoomOutButton!: Node;
    private zoomInButton!: Node;

    private built = false;
    private cityId = 0;
    private selectedType = 1;
    private actionBarOpen = false;
    private detailOpen = false;
    private zoom = 0.56;
    private targetZoom = 0.56;
    private pan = new Vec2(0, 0);
    private targetPan = new Vec2(0, 0);
    private velocity = new Vec2(0, 0);
    private cameraAnimating = false;

    private activeTouchId: number | null = null;
    private touchPoints = new Map<number, Vec2>();
    private pinchStartDistance = 0;
    private pinchStartZoom = 1;
    private touchStartPos = new Vec2();
    private lastTouchPos = new Vec2();
    private lastTouchTime = 0;
    private pointerDragged = false;

    private frames = new Map<string, SpriteFrame>();
    private loadingFrames = new Map<string, Promise<SpriteFrame>>();
    private spriteKeys = new WeakMap<Sprite, string>();
    private lastKnownLevels = new Map<number, number>();
    private layoutQueued = false;

    public openCity(options: EnterInnerCityOptions = {}): void {
        const mainCity = MapCommand.getInstance().cityProxy.getMyMainCity();
        this.cityId = options.cityId && options.cityId > 0 ? options.cityId : (mainCity?.cityId || 0);
        if (!this.built) this.build();

        const hasExplicitTarget = !!(options.focusBuildingType && options.focusBuildingType > 0);
        const focusType = hasExplicitTarget ? options.focusBuildingType! : 1;
        this.selectedType = findInnerCityPlot(focusType) ? focusType : 1;
        this.detailOpen = options.openDetail === true;
        this.actionBarOpen = !this.detailOpen && hasExplicitTarget;
        this.node.active = true;

        this.snapshotLevels();
        this.layoutViewport();
        this.refreshAll();
        if (this.cityId > 0) {
            MapUICommand.getInstance().qryCityFacilities(this.cityId, true);
        }

        const { viewW, viewH } = this.viewportSize();
        const minZoom = computeMinZoom(viewW, viewH);
        const startZoom = hasExplicitTarget
            ? Math.max(computeInitialZoom(viewW, viewH), 0.72)
            : computeInitialZoom(viewW, viewH);
        this.zoom = Math.max(minZoom, startZoom * 0.95);
        this.targetZoom = startZoom;
        const plot = findInnerCityPlot(this.selectedType) || INNER_CITY_PLOTS[0];
        const drawerW = this.detailOpen ? this.drawer.width : 0;
        const framingTarget = hasExplicitTarget || this.detailOpen
            ? plot
            : { nx: 0.0, ny: 0.0 };
        const focused = computeFocusPan(framingTarget, this.targetZoom, viewW, viewH, drawerW);
        this.pan.set(focused.x, focused.y - 12);
        this.targetPan.set(focused.x, focused.y);
        this.velocity.set(0, 0);
        this.cameraAnimating = true;
        this.applyStageTransform();

        if (this.actionBarOpen) {
            this.showActionBarForSelected(true);
        } else {
            this.actionBar.hide();
        }

        Tween.stopAllByTarget(this.rootOpacity);
        this.rootOpacity.opacity = 120;
        tween(this.rootOpacity).to(0.22, { opacity: 255 }, { easing: 'quadOut' }).start();
    }

    public closeCity(): void {
        this.activeTouchId = null;
        this.touchPoints.clear();
        this.velocity.set(0, 0);
        this.cameraAnimating = false;
        this.actionBarOpen = false;
        this.detailOpen = false;
        this.actionBar?.hide();
        this.drawer?.hide();
        this.slotOrder.forEach(slot => slot.cancelConstruction());
        this.node.active = false;
    }

    public focusBuilding(buildingType: number, openDrawer = false, animate = true): void {
        const plot = findInnerCityPlot(buildingType);
        if (!plot) return;
        this.selectedType = buildingType;
        this.detailOpen = openDrawer;
        this.actionBarOpen = !openDrawer;
        if (openDrawer) {
            this.actionBar.hide();
            this.drawer.show(this.cityId, buildingType, true);
        } else {
            this.drawer.hide();
        }
        this.layoutCameraDock();
        const { viewW, viewH } = this.viewportSize();
        const drawerW = openDrawer ? this.drawer.width : 0;
        const focusZoom = Math.max(this.targetZoom, 0.68);
        this.targetZoom = Math.min(INNER_CITY_MAX_ZOOM, focusZoom);
        const desired = computeFocusPan(plot, this.targetZoom, viewW, viewH, drawerW);
        this.targetPan.set(desired.x, desired.y);
        this.velocity.set(0, 0);
        if (animate) {
            this.cameraAnimating = true;
        } else {
            this.zoom = this.targetZoom;
            this.pan.set(desired.x, desired.y);
            this.cameraAnimating = false;
            this.applyStageTransform();
        }
        if (this.actionBarOpen) {
            this.showActionBarForSelected(true);
        }
        this.refreshSlots();
        this.slots.get(buildingType)?.playSelectBounce();
    }

    /** 供新手引导精确获取当前内城“建造/升级”按钮（同时兼容悬浮操作条与详情抽屉）。 */
    public getGuideBuildActionNode(): Node | null {
        if (!this.node.activeInHierarchy) return null;
        if (this.detailOpen) return this.drawer?.getActionButtonNode() || null;
        if (this.actionBarOpen) return this.actionBar?.getPrimaryButtonNode() || null;
        return null;
    }

    /** 供新手引导精确获取“返回大世界”按钮。 */
    public getGuideExitButtonNode(): Node | null {
        if (!this.node.activeInHierarchy) return null;
        return this.exitButton?.isValid ? this.exitButton : null;
    }

    private build(): void {
        this.node.name = 'InnerCityScene';
        const ui = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        ui.setAnchorPoint(0.5, 0.5);
        this.stretch(this.node);
        for (let p = this.node.parent; p; p = p.parent) {
            if (p.getComponent(Canvas)) {
                this.node.getComponent(Widget)!.target = p;
                break;
            }
        }
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        this.rootOpacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);

        // 1. 全屏视口：负责接收拖拽、双指缩放与滚轮缩放事件
        this.viewportNode = this.createNode('WorldViewport', this.node);
        this.stretch(this.viewportNode);

        // 2. 可拖拽缩放的一体化雄城舞台
        this.stageNode = this.createNode('WorldStage', this.viewportNode);
        this.stageNode.getComponent(UITransform)!.setContentSize(INNER_CITY_CANVAS_WIDTH, INNER_CITY_CANVAS_HEIGHT);

        // 暖墨护底
        inkSurface(this.stageNode, 'StageBackdrop', INNER_CITY_CANVAS_WIDTH, INNER_CITY_CANVAS_HEIGHT, new Color(46, 52, 40, 255), null);

        // 2K 一体化汉风雄城全景图
        const groundNode = this.createNode('GroundMap', this.stageNode);
        groundNode.getComponent(UITransform)!.setContentSize(INNER_CITY_CANVAS_WIDTH, INNER_CITY_CANVAS_HEIGHT);
        this.groundSprite = groundNode.addComponent(Sprite);
        this.groundSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.groundSprite.trim = false;
        this.loadArt(this.groundSprite, INNER_CITY_GROUND_ART, INNER_CITY_CANVAS_WIDTH, INNER_CITY_CANVAS_HEIGHT, undefined, true);

        // 3. 1:1 屏幕空间建筑铭牌覆盖层（独立于舞台缩放，任意倍率下铭牌文字均清晰锐利）
        this.plaqueLayer = this.createNode('PlaqueOverlayLayer', this.node);
        this.stretch(this.plaqueLayer);

        // 4. 16 处城建地标互动层（光环 / 灯火微光 / 多锤齐敲施工动效）
        this.buildingLayer = this.createNode('BuildingLayer', this.stageNode);
        this.buildingLayer.getComponent(UITransform)!.setContentSize(INNER_CITY_CANVAS_WIDTH, INNER_CITY_CANVAS_HEIGHT);
        for (const spec of sortedPlotOrder(INNER_CITY_PLOTS)) {
            const slotNode = this.createNode(`BuildingSlot_${spec.type}`, this.buildingLayer);
            const pos = plotCanvasPosition(spec);
            slotNode.setPosition(pos.x, pos.y, 0);
            const slot = slotNode.addComponent(InnerCityBuildingSlot);
            slot.initialize(spec, this.plaqueLayer);
            this.slots.set(spec.type, slot);
            this.slotOrder.push(slot);
        }

        // 5. 精致氛围光效层（日光斜束 + 浮尘光点 + 池塘与护城河粼粼水光 + 四边柔暗角）
        this.ambientLayer = this.createNode('AmbientOverlay', this.stageNode);
        this.ambientLayer.getComponent(UITransform)!.setContentSize(INNER_CITY_CANVAS_WIDTH, INNER_CITY_CANVAS_HEIGHT);
        this.buildAmbientAtmosphere();

        // 5b. 顶部共享资源栏柔和墨色渐变护底（避免浅青远山背景冲淡顶部粮木铁石数字与玩家信息）
        const scrimNode = this.createNode('TopHudScrim', this.node);
        this.topHudScrim = scrimNode.addComponent(Graphics);

        // 6. 顶部左侧精致返回大世界按钮 + 可营造飞镜胶囊
        this.topToolbar = this.createNode('InnerCityToolbar', this.node);
        this.exitButton = this.makeButton(this.topToolbar, 'ExitCityButton', () => {
            AudioManager.instance.playClick();
            EventMgr.emit(LogicEvent.exitInnerCity);
        });

        this.summaryBadge = this.createNode('CitySummaryBadge', this.node);
        this.summaryBg = this.summaryBadge.addComponent(Graphics);
        this.summaryLabel = caption(this.summaryBadge, 'Label', '主城 · 正在同步城建…', 0, 0, 224, 12, CityColors.paper, Label.HorizontalAlign.CENTER);
        this.summaryLabel.isBold = true;

        this.actionableBadge = this.makeButton(this.node, 'ActionableJumpBadge', () => {
            AudioManager.instance.playClick();
            this.jumpToNextActionableBuilding();
        });
        this.actionableBg = this.actionableBadge.addComponent(Graphics);
        this.actionableLabel = caption(this.actionableBadge, 'Label', '', 0, 0, 128, 12, new Color(178, 236, 154, 255), Label.HorizontalAlign.CENTER);
        this.actionableLabel.isBold = true;
        this.actionableBadge.active = false;

        // 7. 右下角商业 SLG 图标操作坞（营造路线 / 城防部队 / 主城 + 缩放微调）
        this.cameraDock = this.createNode('CameraControlDock', this.node);
        this.routeMapButton = this.makeButton(this.cameraDock, 'RouteMapButton', () => {
            AudioManager.instance.playClick();
            this.openRouteMapOverview();
        });
        this.troopsButton = this.makeButton(this.cameraDock, 'TroopsButton', () => {
            AudioManager.instance.playClick();
            if (this.cityId > 0) EventMgr.emit(LogicEvent.openCityTroops, this.cityId);
        });
        this.centerMainButton = this.makeButton(this.cameraDock, 'CenterMainButton', () => {
            AudioManager.instance.playClick();
            this.focusBuilding(1, false, true);
        });
        this.zoomOutButton = this.makeButton(this.cameraDock, 'ZoomOutButton', () => {
            AudioManager.instance.playClick();
            this.stepZoom(0.86);
        });
        this.zoomInButton = this.makeButton(this.cameraDock, 'ZoomInButton', () => {
            AudioManager.instance.playClick();
            this.stepZoom(1.16);
        });

        // 8. 建筑脚下弧形汉铜操作环
        const actionBarNode = this.createNode('BuildingActionBar', this.node);
        this.actionBar = actionBarNode.addComponent(InnerCityActionBar);
        this.actionBar.initialize({
            onInspect: type => this.focusBuilding(type, true, true),
            onBuildStarted: (type, isNewBuild) => {
                this.actionBarOpen = false;
                this.actionBar.hide();
                this.refreshSlots();
                this.slots.get(type)?.beginConstruction(isNewBuild);
            },
            onSelectBuilding: type => this.focusBuilding(type, false, true),
            onShortcut: (kind, type) => this.handleBuildingShortcut(kind, type),
            onDismiss: () => {
                this.actionBarOpen = false;
                this.actionBar.hide();
                this.refreshSlots();
            },
        });

        // 9. 右侧建筑详情抽屉
        const drawerNode = this.createNode('BuildingDetail', this.node);
        this.drawer = drawerNode.addComponent(InnerCityDetailDrawer);
        this.drawer.initialize({
            loadArt: (sprite, path, w, h, groundY) => this.loadArt(sprite, path, w, h, groundY, false),
            onSelectBuilding: type => this.focusBuilding(type, true, true),
            onShortcut: (kind, type) => this.handleBuildingShortcut(kind, type),
            onBuildStarted: (type, isNewBuild) => {
                this.slots.get(type)?.beginConstruction(isNewBuild);
            },
            onClose: () => {
                this.detailOpen = false;
                this.drawer.hide();
                this.layoutCameraDock();
                this.refreshSlots();
            },
        });

        this.bindViewportInput();
        this.node.on(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        this.built = true;
    }

    private buildAmbientAtmosphere(): void {
        const hw = INNER_CITY_CANVAS_WIDTH * 0.5;
        const hh = INNER_CITY_CANVAS_HEIGHT * 0.5;

        // 1. 极淡自然日光斜洒
        const sunNode = this.createNode('DaylightShafts', this.ambientLayer);
        const sunG = sunNode.addComponent(Graphics);
        sunG.fillColor = new Color(255, 248, 226, 9);
        sunG.moveTo(-hw, hh);
        sunG.lineTo(-hw * 0.25, hh);
        sunG.lineTo(hw * 0.28, -hh * 0.20);
        sunG.lineTo(-hw * 0.40, -hh * 0.12);
        sunG.close();
        sunG.fill();

        // 2. 细腻动态生机层：护城河与城内荷塘粼粼水光 + 轻舞日光微尘
        const liveNode = this.createNode('LivingCityFx', this.ambientLayer);
        this.livingFxGraphics = liveNode.addComponent(Graphics);

        this.sunMotes = [];
        for (let i = 0; i < 20; i++) {
            this.sunMotes.push({
                x: (Math.random() - 0.5) * INNER_CITY_CANVAS_WIDTH * 0.88,
                y: (Math.random() - 0.5) * INNER_CITY_CANVAS_HEIGHT * 0.84,
                vx: 6 + Math.random() * 10,
                vy: -3 - Math.random() * 6,
                r: 1.4 + Math.random() * 1.6,
                phase: Math.random() * Math.PI * 2,
            });
        }

        // 精准对位西翼太学荷塘与南缘横贯护城河水面
        const glintNorms: Array<[number, number, number]> = [
            [-0.360, 0.045, 11], [-0.330, 0.032, 10],
            [-0.220, -0.355, 14], [-0.095, -0.365, 13],
            [0.085, -0.355, 15], [0.185, -0.375, 14],
            [0.275, -0.360, 14], [0.140, -0.435, 13],
        ];
        this.waterGlints = glintNorms.map(([nx, ny, w], i) => ({
            x: nx * INNER_CITY_CANVAS_WIDTH,
            y: ny * INNER_CITY_CANVAS_HEIGHT,
            phase: i * 0.95,
            w,
        }));

        // 3. 画布四边柔和暗角
        const vigNode = this.createNode('EdgeVignette', this.ambientLayer);
        const vig = vigNode.addComponent(Graphics);
        for (let i = 0; i < 6; i++) {
            const band = 26;
            const alpha = Math.round((6 - i) * 6);
            vig.fillColor = new Color(16, 18, 14, alpha);
            vig.rect(-hw, hh - (i + 1) * band, INNER_CITY_CANVAS_WIDTH, band);
            vig.rect(-hw, -hh + i * band, INNER_CITY_CANVAS_WIDTH, band);
            vig.rect(-hw + i * band, -hh, band, INNER_CITY_CANVAS_HEIGHT);
            vig.rect(hw - (i + 1) * band, -hh, band, INNER_CITY_CANVAS_HEIGHT);
            vig.fill();
        }
    }

    private updateLivingCityFx(dt: number): void {
        const g = this.livingFxGraphics;
        if (!g?.isValid) return;
        this.livingTime += dt;
        g.clear();

        const hw = INNER_CITY_CANVAS_WIDTH * 0.5;
        const hh = INNER_CITY_CANVAS_HEIGHT * 0.5;

        for (const w of this.waterGlints) {
            const pulse = 0.5 + 0.5 * Math.sin(this.livingTime * 1.9 + w.phase);
            if (pulse < 0.30) continue;
            const alpha = Math.round((pulse - 0.30) * 185);
            const halfLen = w.w * (0.42 + 0.58 * pulse);
            g.strokeColor = new Color(252, 250, 232, alpha);
            g.lineWidth = 1.4;
            g.moveTo(w.x - halfLen, w.y);
            g.lineTo(w.x + halfLen, w.y);
            g.stroke();
        }

        for (const m of this.sunMotes) {
            m.x += m.vx * dt;
            m.y += m.vy * dt + Math.sin(this.livingTime * 1.3 + m.phase) * 3.5 * dt;
            if (m.x > hw) m.x = -hw;
            if (m.y < -hh) m.y = hh;
            const glow = 0.4 + 0.6 * Math.sin(this.livingTime * 1.6 + m.phase);
            g.fillColor = new Color(255, 246, 210, Math.round(76 * glow));
            g.circle(m.x, m.y, m.r);
            g.fill();
        }
    }

    private bindViewportInput(): void {
        this.viewportNode.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.viewportNode.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.viewportNode.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.viewportNode.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.viewportNode.on(Node.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }

    protected onEnable(): void {
        view.on('canvas-resize', this.queueLayout, this);
        view.on('design-resolution-changed', this.queueLayout, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        EventMgr.on(LogicEvent.updateCityBuilds, this.onCityBuildsUpdated, this);
        EventMgr.on(LogicEvent.upateMyRoleRes, this.refreshAll, this);
        EventMgr.on(LogicEvent.protocolRequestChanged, this.refreshAll, this);
    }

    protected onDisable(): void {
        view.off('canvas-resize', this.queueLayout, this);
        view.off('design-resolution-changed', this.queueLayout, this);
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        EventMgr.targetOff(this);
        this.activeTouchId = null;
        this.touchPoints.clear();
    }

    private onKeyDown(event: EventKeyboard): void {
        if (!this.built || !this.node.activeInHierarchy) return;
        if (event.keyCode === KeyCode.ESCAPE) {
            if (this.detailOpen || this.actionBarOpen) {
                this.detailOpen = false;
                this.actionBarOpen = false;
                this.drawer.hide();
                this.actionBar.hide();
                this.layoutCameraDock();
                this.refreshSlots();
            } else {
                EventMgr.emit(LogicEvent.exitInnerCity);
            }
        }
    }

    protected update(dt: number): void {
        if (!this.built || !this.node.activeInHierarchy) return;

        this.updateLivingCityFx(Math.min(0.05, Math.max(0, dt)));

        const { viewW, viewH } = this.viewportSize();
        if (this.cameraAnimating) {
            const blend = Math.min(1, dt * 10.5);
            this.zoom += (this.targetZoom - this.zoom) * blend;
            this.pan.x += (this.targetPan.x - this.pan.x) * blend;
            this.pan.y += (this.targetPan.y - this.pan.y) * blend;
            const clamped = clampCameraOffset(this.pan.x, this.pan.y, this.zoom, viewW, viewH);
            this.pan.set(clamped.x, clamped.y);
            this.applyStageTransform();
            if (Math.abs(this.targetZoom - this.zoom) < 0.002
                && Math.hypot(this.targetPan.x - this.pan.x, this.targetPan.y - this.pan.y) < 0.6) {
                this.zoom = this.targetZoom;
                const finalClamped = clampCameraOffset(this.targetPan.x, this.targetPan.y, this.zoom, viewW, viewH);
                this.pan.set(finalClamped.x, finalClamped.y);
                this.cameraAnimating = false;
                this.applyStageTransform();
            }
        } else if (this.activeTouchId === null && this.touchPoints.size === 0 && this.velocity.lengthSqr() > 4) {
            this.pan.x += this.velocity.x * dt;
            this.pan.y += this.velocity.y * dt;
            const damp = Math.exp(-7.8 * dt);
            this.velocity.multiplyScalar(damp);
            const clamped = clampCameraOffset(this.pan.x, this.pan.y, this.zoom, viewW, viewH);
            if (Math.abs(clamped.x - this.pan.x) > 0.1) this.velocity.x = 0;
            if (Math.abs(clamped.y - this.pan.y) > 0.1) this.velocity.y = 0;
            this.pan.set(clamped.x, clamped.y);
            this.targetPan.set(this.pan.x, this.pan.y);
            this.applyStageTransform();
        }
    }

    private onTouchStart(event: EventTouch): void {
        event.propagationStopped = true;
        const uiPos = event.getUILocation();
        const id = event.getID();
        this.touchPoints.set(id, new Vec2(uiPos.x, uiPos.y));
        this.cameraAnimating = false;
        this.velocity.set(0, 0);

        if (this.touchPoints.size === 1) {
            this.activeTouchId = id;
            this.touchStartPos.set(uiPos.x, uiPos.y);
            this.lastTouchPos.set(uiPos.x, uiPos.y);
            this.lastTouchTime = Date.now();
            this.pointerDragged = false;
        } else if (this.touchPoints.size === 2) {
            this.activeTouchId = null;
            this.pointerDragged = true;
            const pts = Array.from(this.touchPoints.values());
            this.pinchStartDistance = Math.max(1, Vec2.distance(pts[0], pts[1]));
            this.pinchStartZoom = this.zoom;
        }
    }

    private onTouchMove(event: EventTouch): void {
        event.propagationStopped = true;
        const uiPos = event.getUILocation();
        const id = event.getID();
        if (!this.touchPoints.has(id)) return;
        this.touchPoints.set(id, new Vec2(uiPos.x, uiPos.y));

        if (this.touchPoints.size >= 2) {
            const pts = Array.from(this.touchPoints.values());
            const dist = Math.max(1, Vec2.distance(pts[0], pts[1]));
            const nextZoom = this.pinchStartZoom * (dist / this.pinchStartDistance);
            const midUi = new Vec2((pts[0].x + pts[1].x) * 0.5, (pts[0].y + pts[1].y) * 0.5);
            const anchor = this.uiToViewportLocal(midUi);
            this.setZoomImmediate(nextZoom, anchor.x, anchor.y);
            return;
        }

        if (this.activeTouchId !== id) return;
        const dx = uiPos.x - this.lastTouchPos.x;
        const dy = uiPos.y - this.lastTouchPos.y;
        const now = Date.now();
        const dtSec = Math.max(0.008, Math.min(0.06, (now - this.lastTouchTime) / 1000));
        this.lastTouchPos.set(uiPos.x, uiPos.y);
        this.lastTouchTime = now;

        if (!this.pointerDragged && Math.hypot(uiPos.x - this.touchStartPos.x, uiPos.y - this.touchStartPos.y) >= DRAG_THRESHOLD_PX) {
            this.pointerDragged = true;
        }
        if (this.pointerDragged) {
            const { viewW, viewH } = this.viewportSize();
            const clamped = clampCameraOffset(this.pan.x + dx, this.pan.y + dy, this.zoom, viewW, viewH);
            this.pan.set(clamped.x, clamped.y);
            this.targetPan.set(clamped.x, clamped.y);
            const instVx = Math.max(-MAX_INERTIA_SPEED, Math.min(MAX_INERTIA_SPEED, dx / dtSec));
            const instVy = Math.max(-MAX_INERTIA_SPEED, Math.min(MAX_INERTIA_SPEED, dy / dtSec));
            this.velocity.set(this.velocity.x * 0.45 + instVx * 0.55, this.velocity.y * 0.45 + instVy * 0.55);
            this.applyStageTransform();
        }
    }

    private onTouchEnd(event: EventTouch): void {
        const uiPos = event.getUILocation();
        const id = event.getID();
        const wasTap = this.activeTouchId === id && !this.pointerDragged && this.touchPoints.size <= 1;
        this.touchPoints.delete(id);
        if (this.activeTouchId === id) {
            this.activeTouchId = null;
            if (Date.now() - this.lastTouchTime > 90) {
                this.velocity.set(0, 0);
            }
        }
        if (wasTap) {
            this.handleCanvasTap(uiPos);
        }
    }

    private onTouchCancel(event: EventTouch): void {
        const id = event.getID();
        this.touchPoints.delete(id);
        if (this.activeTouchId === id) this.activeTouchId = null;
        this.velocity.set(0, 0);
    }

    private onMouseWheel(event: EventMouse): void {
        const delta = event.getScrollY();
        if (!delta) return;
        event.propagationStopped = true;
        const factor = delta > 0 ? 1.09 : 0.915;
        this.cameraAnimating = false;
        this.velocity.set(0, 0);
        const anchor = this.uiToViewportLocal(event.getUILocation());
        this.setZoomImmediate(this.zoom * factor, anchor.x, anchor.y);
    }

    private stepZoom(factor: number): void {
        this.cameraAnimating = false;
        this.velocity.set(0, 0);
        this.setZoomImmediate(this.zoom * factor, 0, 0);
    }

    private setZoomImmediate(rawZoom: number, anchorX = 0, anchorY = 0): void {
        const { viewW, viewH } = this.viewportSize();
        const minZoom = computeMinZoom(viewW, viewH);
        const clampedZoom = Math.max(minZoom, Math.min(INNER_CITY_MAX_ZOOM, rawZoom));
        const ratio = clampedZoom / Math.max(0.01, this.zoom);
        this.zoom = clampedZoom;
        this.targetZoom = clampedZoom;
        const nextPanX = this.pan.x * ratio + anchorX * (1 - ratio);
        const nextPanY = this.pan.y * ratio + anchorY * (1 - ratio);
        const clamped = clampCameraOffset(nextPanX, nextPanY, this.zoom, viewW, viewH);
        this.pan.set(clamped.x, clamped.y);
        this.targetPan.set(clamped.x, clamped.y);
        this.applyStageTransform();
    }

    private uiToViewportLocal(uiPos: Vec2): Vec3 {
        const ui = this.viewportNode?.getComponent(UITransform);
        return ui ? ui.convertToNodeSpaceAR(new Vec3(uiPos.x, uiPos.y, 0)) : new Vec3(0, 0, 0);
    }

    private handleCanvasTap(uiPos: Vec2): void {
        // 1. 优先检测 1:1 屏幕空间铭牌命中（点铭牌一击即中）
        const vpLocal = this.uiToViewportLocal(uiPos);
        for (let i = this.slotOrder.length - 1; i >= 0; i--) {
            const slot = this.slotOrder[i];
            if (slot.containsPlaqueScreenPoint(vpLocal.x, vpLocal.y)) {
                AudioManager.instance.playClick();
                this.focusBuilding(slot.spec.type, false, true);
                return;
            }
        }
        // 2. 其次检测全景城郭建筑地标区域命中
        const stageUi = this.stageNode.getComponent(UITransform)!;
        const local = stageUi.convertToNodeSpaceAR(new Vec3(uiPos.x, uiPos.y, 0));
        for (let i = this.slotOrder.length - 1; i >= 0; i--) {
            const slot = this.slotOrder[i];
            if (slot.containsCanvasPoint(local.x, local.y)) {
                AudioManager.instance.playClick();
                this.focusBuilding(slot.spec.type, false, true);
                return;
            }
        }
        // 3. 点击空白城郭收起操作环与抽屉
        if (this.detailOpen || this.actionBarOpen) {
            this.detailOpen = false;
            this.actionBarOpen = false;
            this.drawer.hide();
            this.actionBar.hide();
            this.layoutCameraDock();
            this.refreshSlots();
        }
    }

    private jumpToNextActionableBuilding(): void {
        if (this.actionableTypes.length === 0) return;
        const target = this.actionableTypes[this.actionableCycleIdx % this.actionableTypes.length];
        this.actionableCycleIdx = (this.actionableCycleIdx + 1) % this.actionableTypes.length;
        this.focusBuilding(target, false, true);
    }

    private handleBuildingShortcut(kind: InnerCityShortcutKind, buildingType: number): void {
        if (kind === 'overview') {
            this.openRouteMapOverview();
        } else if (kind === 'draw') {
            EventMgr.emit(LogicEvent.openDraw);
        } else if (kind === 'troops') {
            if (this.cityId > 0) EventMgr.emit(LogicEvent.openCityTroops, this.cityId);
        } else if (kind === 'generals') {
            EventMgr.emit(LogicEvent.openGeneral, [], 0, 0);
        } else if (kind === 'market') {
            EventMgr.emit(LogicEvent.openMarket);
        } else {
            this.focusBuilding(buildingType, true, true);
        }
    }

    private openRouteMapOverview(): void {
        const city = MapCommand.getInstance().cityProxy.getMyMainCity();
        if (!city) return;
        EventMgr.emit(LogicEvent.openFacility, {
            ...city,
            focusBuildingType: this.selectedType,
            routeOnly: true,
        });
    }

    private queueLayout(): void {
        if (!this.node.activeInHierarchy || this.layoutQueued) return;
        this.layoutQueued = true;
        this.scheduleOnce(() => {
            this.layoutQueued = false;
            if (this.isValid && this.node.activeInHierarchy) this.layoutViewport();
        }, 0);
    }

    private layoutViewport(): void {
        if (!this.built) return;
        this.node.getComponent(Widget)?.updateAlignment();
        this.viewportNode.getComponent(Widget)?.updateAlignment();
        this.plaqueLayer.getComponent(Widget)?.updateAlignment();
        const { viewW, viewH } = this.viewportSize();
        this.node.getComponent(UITransform)?.setContentSize(viewW, viewH);
        const vpUi = this.viewportNode.getComponent(UITransform);
        if (vpUi) {
            vpUi.setContentSize(viewW, viewH);
            this.viewportNode.setPosition(0, 0, 0);
        }
        const plaqueUi = this.plaqueLayer.getComponent(UITransform);
        if (plaqueUi) {
            plaqueUi.setContentSize(viewW, viewH);
            this.plaqueLayer.setPosition(0, 0, 0);
        }
        const margin = viewW < 760 ? 12 : 16;

        // 顶部柔和渐变护底（紧贴屏幕上沿 78px，确保共享资源栏与玩家卡清晰可读）
        if (this.topHudScrim?.isValid) {
            place(this.topHudScrim.node, 0, viewH * 0.5 - 39, viewW, 78);
            const g = this.topHudScrim;
            g.clear();
            const steps = 10;
            const bandH = 78 / steps;
            for (let i = 0; i < steps; i++) {
                const t = i / (steps - 1);
                const alpha = Math.round(168 * Math.pow(1 - t, 1.55));
                g.fillColor = new Color(14, 18, 15, alpha);
                g.rect(-viewW * 0.5, 39 - (i + 1) * bandH, viewW, bandH + 0.5);
                g.fill();
            }
        }

        // 顶部左侧精致「返回世界」按钮 + 「可营造」快捷飞镜胶囊
        const toolbarY = viewH * 0.5 - 94;
        const leftEdge = -viewW * 0.5 + margin;
        place(this.topToolbar, leftEdge + 64, toolbarY, 128, 36);
        this.styleToolbarButton(this.exitButton, '‹ 返回世界', 0, 0, 126, 36, true);

        const jumpW = 114;
        place(this.actionableBadge, leftEdge + 136 + jumpW * 0.5, toolbarY, jumpW, 34);
        this.drawBevelBox(
            this.actionableBg,
            jumpW,
            34,
            7,
            new Color(22, 42, 24, 236),
            new Color(156, 222, 138, 234),
            true,
        );
        place(this.actionableLabel.node, 0, 0, jumpW - 14, 22);
        this.actionableLabel.overflow = Label.Overflow.SHRINK;
        const jumpBtn = this.actionableBadge.getComponent(Button);
        if (jumpBtn) {
            jumpBtn.target = this.actionableBadge;
            jumpBtn.transition = Button.Transition.SCALE;
            jumpBtn.zoomScale = 0.96;
            jumpBtn.duration = 0.08;
        }

        // 顶部居中极简城池繁荣总览铭牌
        const showCenterBadge = viewW >= 880;
        this.summaryBadge.active = showCenterBadge;
        if (showCenterBadge) {
            const badgeW = Math.min(246, Math.max(198, viewW - 720));
            place(this.summaryBadge, -60, viewH * 0.5 - 30, badgeW, 30);
            this.drawBevelBox(this.summaryBg, badgeW, 30, 6, new Color(20, 24, 19, 228), CityColors.gold, false);
            place(this.summaryLabel.node, 0, 0, badgeW - 18, 22);
            this.summaryLabel.overflow = Label.Overflow.SHRINK;
        }

        // 右侧建筑详情抽屉
        this.drawer.layout(viewW, viewH, 68, 16);

        // 右下角图标化操作坞
        this.layoutCameraDock();

        const minZoom = computeMinZoom(viewW, viewH);
        if (this.zoom < minZoom) this.zoom = minZoom;
        if (this.targetZoom < minZoom) this.targetZoom = minZoom;
        const clamped = clampCameraOffset(this.pan.x, this.pan.y, this.zoom, viewW, viewH);
        this.pan.set(clamped.x, clamped.y);
        this.targetPan.set(clamped.x, clamped.y);
        this.applyStageTransform();
    }

    private layoutCameraDock(): void {
        if (!this.built || !this.cameraDock?.isValid) return;
        const { viewW, viewH } = this.viewportSize();
        const margin = viewW < 760 ? 12 : 18;
        const showZoom = viewW >= 820;
        const rightGap = this.detailOpen && viewW >= 760 ? this.drawer.width + margin + 12 : margin;

        const dockW = showZoom ? 256 : 216;
        const dockH = 68;
        const x = viewW * 0.5 - rightGap - dockW * 0.5;
        const y = -viewH * 0.5 + margin + dockH * 0.5;
        place(this.cameraDock, x, y, dockW, dockH);

        const rightEdge = dockW * 0.5;
        const medallionStart = showZoom ? rightEdge - 42 : rightEdge - 2;
        this.styleDockMedallion(this.centerMainButton, '主城', DOCK_ICON_PATHS.mainCity, medallionStart - 32, 0, 62);
        this.styleDockMedallion(this.troopsButton, '城防', DOCK_ICON_PATHS.troops, medallionStart - 104, 0, 62);
        this.styleDockMedallion(this.routeMapButton, '营造', DOCK_ICON_PATHS.overview, medallionStart - 176, 0, 62);

        this.zoomInButton.active = showZoom;
        this.zoomOutButton.active = showZoom;
        if (showZoom) {
            this.styleToolbarButton(this.zoomInButton, '+', rightEdge - 16, 17, 30, 28, false);
            this.styleToolbarButton(this.zoomOutButton, '−', rightEdge - 16, -17, 30, 28, false);
        }
    }

    private styleDockMedallion(node: Node, text: string, iconPath: string, x: number, y: number, diameter: number): void {
        place(node, x, y, diameter, diameter);
        const bg = inkSurface(node, 'DockBg', diameter, diameter, null, null);
        bg.clear();
        const r = diameter * 0.5;

        bg.fillColor = new Color(8, 10, 7, 132);
        bg.circle(0, -3, r + 1.5);
        bg.fill();

        bg.fillColor = new Color(22, 29, 22, 240);
        bg.strokeColor = new Color(218, 184, 114, 238);
        bg.lineWidth = 1.65;
        bg.circle(0, 0, r);
        bg.fill();
        bg.stroke();

        bg.fillColor = new Color(255, 246, 214, 20);
        bg.ellipse(0, r * 0.34, r * 0.64, r * 0.30);
        bg.fill();
        bg.strokeColor = new Color(226, 194, 126, 94);
        bg.lineWidth = 0.9;
        bg.circle(0, 0, r - 3.8);
        bg.stroke();

        let iconNode = node.getChildByName('DockIcon');
        if (!iconNode) {
            iconNode = this.createNode('DockIcon', node);
            const sp = iconNode.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
        }
        place(iconNode, 0, 8, 30, 30);
        this.loadArt(iconNode.getComponent(Sprite)!, iconPath, 30, 30, undefined, false);

        const label = caption(node, 'Label', text, 0, -r + 14, diameter - 4, 12, new Color(246, 238, 214, 255), Label.HorizontalAlign.CENTER);
        label.isBold = true;
        label.outlineColor = new Color(12, 10, 6, 255);
        label.outlineWidth = 1.5;
        label.overflow = Label.Overflow.SHRINK;

        const btn = node.getComponent(Button);
        if (btn) {
            btn.target = node;
            btn.transition = Button.Transition.SCALE;
            btn.zoomScale = 0.94;
            btn.duration = 0.08;
        }
    }

    private styleToolbarButton(
        node: Node,
        text: string,
        x: number,
        y: number,
        width: number,
        height: number,
        primary: boolean,
    ): void {
        place(node, x, y, width, height);
        const bg = inkSurface(node, 'BtnSurface', width, height, null, null);
        this.drawBevelBox(
            bg,
            width,
            height,
            7,
            primary ? new Color(132, 88, 36, 248) : new Color(24, 30, 23, 238),
            primary ? new Color(246, 212, 136, 252) : CityColors.gold,
            primary,
        );
        const label = caption(
            node,
            'Label',
            text,
            0,
            0,
            width - 12,
            14,
            primary ? new Color(255, 244, 204, 255) : CityColors.paper,
            Label.HorizontalAlign.CENTER,
        );
        label.isBold = primary;
        label.outlineColor = new Color(14, 10, 6, 240);
        label.outlineWidth = 1.2;
        label.overflow = Label.Overflow.SHRINK;
        const btn = node.getComponent(Button);
        if (btn) {
            btn.target = bg.node;
            btn.transition = Button.Transition.SCALE;
            btn.zoomScale = 0.96;
            btn.duration = 0.08;
        }
    }

    private drawBevelBox(
        g: Graphics,
        w: number,
        h: number,
        cut: number,
        fill: Color,
        border: Color,
        topAccent = false,
    ): void {
        g.clear();
        const hw = w * 0.5;
        const hh = h * 0.5;
        g.fillColor = fill;
        g.strokeColor = border;
        g.lineWidth = topAccent ? 1.45 : 1.1;
        g.moveTo(-hw + cut, hh);
        g.lineTo(hw - cut, hh);
        g.lineTo(hw, hh - cut);
        g.lineTo(hw, -hh + cut);
        g.lineTo(hw - cut, -hh);
        g.lineTo(-hw + cut, -hh);
        g.lineTo(-hw, -hh + cut);
        g.lineTo(-hw, hh - cut);
        g.close();
        g.fill();
        g.stroke();
        if (topAccent) {
            g.strokeColor = new Color(255, 242, 194, 165);
            g.lineWidth = 0.95;
            g.moveTo(-hw + cut + 4, hh - 2.4);
            g.lineTo(hw - cut - 4, hh - 2.4);
            g.stroke();
        }
    }

    private applyStageTransform(): void {
        if (!this.stageNode?.isValid) return;
        this.stageNode.setScale(this.zoom, this.zoom, 1);
        this.stageNode.setPosition(this.pan.x, this.pan.y, 0);

        const { viewW, viewH } = this.viewportSize();
        for (const slot of this.slotOrder) {
            const pos = plotCanvasPosition(slot.spec);
            const sx = this.pan.x + pos.x * this.zoom;
            const sy = this.pan.y + pos.y * this.zoom;
            slot.syncPlaqueScreenPosition(sx, sy, viewW, viewH);
        }

        if (this.actionBarOpen && this.actionBar?.isVisible) {
            const pos = this.selectedActionBarScreenPos();
            this.actionBar.updatePosition(pos.x, pos.y, viewW, viewH);
        }
    }

    private selectedActionBarScreenPos(): { x: number; y: number } {
        const plot = findInnerCityPlot(this.selectedType) || INNER_CITY_PLOTS[0];
        const canvasPos = plotCanvasPosition(plot);
        const sx = this.pan.x + canvasPos.x * this.zoom;
        const sy = this.pan.y + canvasPos.y * this.zoom - 96;
        return { x: sx, y: sy };
    }

    private showActionBarForSelected(animate: boolean): void {
        if (!this.actionBar?.isValid) return;
        const pos = this.selectedActionBarScreenPos();
        const { viewW, viewH } = this.viewportSize();
        this.actionBar.show(this.cityId, this.selectedType, pos.x, pos.y, viewW, viewH, animate);
    }

    private refreshAll(): void {
        if (!this.built || !this.node.activeInHierarchy) return;
        this.refreshSummary();
        this.refreshSlots();
        this.applyStageTransform();
        if (this.detailOpen) {
            this.actionBar.hide();
            this.drawer.show(this.cityId, this.selectedType, false);
        } else {
            this.drawer.hide();
            if (this.actionBarOpen) {
                this.showActionBarForSelected(false);
            } else {
                this.actionBar.hide();
            }
        }
        this.layoutCameraDock();
    }

    private refreshSummary(): void {
        const b = BuildCommand.getInstance();
        const configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        const city = MapCommand.getInstance().cityProxy.getMyMainCity();
        const cityName = city?.name || '主城';
        const mainLv = b.levels.get(1) || 0;
        const builtCount = configs.filter(cfg => (b.levels.get(cfg.type) || 0) > 0).length;
        this.summaryLabel.string = b.loaded
            ? `${cityName} · 主城 ${mainLv} 级 · 已建 ${builtCount}/${configs.length}`
            : `${cityName} · 正在同步城建…`;
    }

    private refreshSlots(): void {
        const b = BuildCommand.getInstance();
        const configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        const balances = this.resourceBalances();
        const known = b.loaded;
        const nextActionable: number[] = [];

        for (const slot of this.slotOrder) {
            const spec = slot.spec;
            const cfg = configs.find(item => item.type === spec.type) || null;
            const current = b.levels.get(spec.type) || 0;
            const artPath = cfg ? buildingArt(cfg, Math.max(1, current)) : spec.art;
            if (slot.artKey !== artPath) {
                slot.applySpriteFrame(artPath, null as any);
            }
            if (!cfg) {
                slot.applyState({
                    cfg: null,
                    name: spec.fallbackName,
                    level: current,
                    maxed: false,
                    unlocked: current > 0,
                    canAct: false,
                    enough: false,
                    selected: this.selectedType === spec.type && (this.detailOpen || this.actionBarOpen),
                    known,
                    lockHint: '',
                });
                continue;
            }
            const nextLevel = cfg.upLevels[current] ? current + 1 : Math.max(1, current);
            const state = buildingGoalPresentation(cfg, nextLevel, b.levels, configs, balances);
            const firstUnmet = state.conditions.find(c => !c.met);
            const lockHint = firstUnmet ? `需${firstUnmet.name}${firstUnmet.level}级` : '';
            if (known && state.canAct && !state.maxed) {
                nextActionable.push(spec.type);
            }
            slot.applyState({
                cfg,
                name: cfg.name,
                level: current,
                maxed: state.maxed,
                unlocked: state.unlocked,
                canAct: state.canAct,
                enough: state.enough,
                selected: this.selectedType === spec.type && (this.detailOpen || this.actionBarOpen),
                known,
                lockHint,
            });
        }

        nextActionable.sort((a, bType) => {
            if (a === 1) return -1;
            if (bType === 1) return 1;
            const la = b.levels.get(a) || 0;
            const lb = b.levels.get(bType) || 0;
            return la - lb || a - bType;
        });
        this.actionableTypes = nextActionable;
        if (this.actionableBadge?.isValid) {
            const showJump = known && nextActionable.length > 0;
            this.actionableBadge.active = showJump;
            if (showJump) {
                this.actionableLabel.string = `可营造 ${nextActionable.length} 处 ›`;
            }
        }
    }

    private snapshotLevels(): void {
        this.lastKnownLevels.clear();
        BuildCommand.getInstance().levels.forEach((lv, bid) => this.lastKnownLevels.set(bid, lv));
    }

    private onCityBuildsUpdated(): void {
        if (!this.built) return;
        const b = BuildCommand.getInstance();
        const configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        const upgraded: Array<{ type: number; name: string; from: number; to: number }> = [];
        if (this.lastKnownLevels.size > 0) {
            b.levels.forEach((lv, bid) => {
                const prev = this.lastKnownLevels.get(bid) || 0;
                if (lv > prev) {
                    const cfg = configs.find(item => item.type === bid);
                    upgraded.push({ type: bid, name: cfg?.name || '建筑', from: prev, to: lv });
                }
            });
        }
        this.snapshotLevels();
        this.refreshAll();
        if (this.node.activeInHierarchy) {
            for (const item of upgraded) {
                this.slots.get(item.type)?.playConstructionUpgrade(item.name, item.from, item.to);
            }
        }
    }

    private loadArt(sprite: Sprite, path: string, width: number, height: number, groundY?: number, stretch = false): void {
        this.spriteKeys.set(sprite, path);
        const apply = (frame: SpriteFrame) => {
            if (!this.isValid || !sprite?.isValid || this.spriteKeys.get(sprite) !== path) return;
            const grounded = groundY !== undefined;
            sprite.trim = grounded;
            sprite.spriteFrame = frame;
            const src = grounded ? frame.rect : frame.originalSize;
            const srcW = Math.max(1, src.width);
            const srcH = Math.max(1, src.height);
            const scale = Math.min(width / srcW, height / srcH);
            const ui = sprite.node.getComponent(UITransform)!;
            ui.setContentSize(stretch ? width : srcW * scale, stretch ? height : srcH * scale);
            if (grounded) {
                ui.setAnchorPoint(0.5, 0);
                sprite.node.setPosition(0, groundY, 0);
            }
        };
        const cached = this.frames.get(path);
        if (cached?.isValid) {
            apply(cached);
            return;
        }
        void this.loadFrame(path).then(frame => {
            if (frame) apply(frame);
        });
    }

    private loadFrame(path: string): Promise<SpriteFrame | null> {
        const cached = this.frames.get(path);
        if (cached?.isValid) return Promise.resolve(cached);
        const pending = this.loadingFrames.get(path);
        if (pending) return pending;
        const promise = new Promise<SpriteFrame>(resolve => {
            resources.load(`${path}/spriteFrame`, SpriteFrame, (err, frame) => {
                this.loadingFrames.delete(path);
                if (!err && frame instanceof SpriteFrame) {
                    this.frames.set(path, frame);
                    resolve(frame);
                    return;
                }
                resources.load(path, SpriteFrame, (fallbackErr, fallbackFrame) => {
                    if (!fallbackErr && fallbackFrame instanceof SpriteFrame) {
                        this.frames.set(path, fallbackFrame);
                        resolve(fallbackFrame);
                    } else {
                        resolve(null as any);
                    }
                });
            });
        });
        this.loadingFrames.set(path, promise);
        return promise;
    }

    private resourceBalances(): Array<{ k: number; v: number }> {
        const proxy = LoginCommand.getInstance().proxy;
        return [1, 2, 3, 4].map(k => ({ k, v: proxy.getItemCount(k) }));
    }

    private viewportSize(): { viewW: number; viewH: number } {
        const visible = view.getVisibleSize();
        const ui = this.node.getComponent(UITransform);
        return {
            viewW: ui && ui.width > 0 ? ui.width : visible.width,
            viewH: ui && ui.height > 0 ? ui.height : visible.height,
        };
    }

    private createNode(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        parent.addChild(node);
        node.addComponent(UITransform);
        return node;
    }

    private makeButton(parent: Node, name: string, handler: () => void): Node {
        const node = this.createNode(name, parent);
        node.addComponent(Button);
        node.on(Button.EventType.CLICK, handler, this);
        return node;
    }

    private stretch(node: Node): void {
        const w = node.getComponent(Widget) || node.addComponent(Widget);
        w.isAlignLeft = w.isAlignRight = w.isAlignTop = w.isAlignBottom = true;
        w.left = w.right = w.top = w.bottom = 0;
        w.alignMode = Widget.AlignMode.ALWAYS;
    }
}
