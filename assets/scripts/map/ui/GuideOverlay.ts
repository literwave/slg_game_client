import { _decorator, BlockInputEvents, Button, Color, Component, director, Graphics, isValid, Label, Node, resources, Sprite, SpriteFrame, UIOpacity, UITransform, Vec3 } from 'cc';
import ProgressionCommand, { TaskInfo } from '../../progression/ProgressionCommand';
import { guideConfigRows, GuideStepConfig, trackedTask } from '../../progression/ProgressionPresentation';
import TroopCommand from '../../general/TroopCommand';
import ArmyCommand from '../../general/ArmyCommand';
import MapCommand from '../MapCommand';
import LoginCommand from '../../login/LoginCommand';
import { LogicEvent as E } from '../../common/LogicEvent';
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LocalCache } from '../../utils/LocalCache';
import { getGeneralPortraitPath } from '../../general/GeneralPortrait';
import { caption, inkSurface, ManagementColors as C, place, textStyle } from './ManagementStyle';

const { ccclass } = _decorator;

export type TroopReadiness = 'need_troop_hero' | 'need_troop_soldier' | 'troop_ready';

export interface GuidePanelContext {
    panelState: 'panel_closed' | 'panel_city_build' | 'panel_draw' | 'panel_army_setting' | 'panel_army_select' | 'panel_other';
    allocationState: 'unallocated' | 'allocated';
    hasBlockingOverlay: boolean;
}

/** 检查主城部队是否已配置主将、是否已补充兵力，供 Guide.tsv 的 PreCheck 和出征跳转共用。 */
export function evaluateTroopReadiness(): TroopReadiness {
    const troops = TroopCommand.getInstance().proxy.getTroops();
    let hasHero = false;
    let hasSoldier = false;
    for (const troop of troops) {
        if (troop.getHeroIdxAt(0) > 0) {
            hasHero = true;
            const soldiers = troop.getSortedHeroes().reduce((sum, h) => sum + troop.getSoldier(h.heroIdx).count, 0);
            if (soldiers > 0) { hasSoldier = true; break; }
        }
    }
    if (!hasHero) {
        const mainCity = MapCommand.getInstance().cityProxy.getMyMainCity();
        const legacyList = mainCity ? ArmyCommand.getInstance().proxy.getArmyList(mainCity.cityId) || [] : [];
        for (const army of legacyList) {
            if (army && army.generals?.[0] > 0) {
                hasHero = true;
                const soldiers = (army.soldiers || []).reduce((sum, s) => sum + Number(s || 0), 0);
                if (soldiers > 0) { hasSoldier = true; break; }
            }
        }
    }
    if (!hasHero) return 'need_troop_hero';
    if (!hasSoldier) return 'need_troop_soldier';
    return 'troop_ready';
}

/** 按当前主线任务、部队准备度与打开中的面板状态，匹配 Guide.tsv 中的强指引步骤。 */
export function matchActiveGuideStep(
    task: TaskInfo | null | undefined,
    ctx: GuidePanelContext,
): GuideStepConfig | null {
    if (!task || task.taskType !== 1 || ctx.hasBlockingOverlay) return null;
    const steps = guideConfigRows().filter(row => row.TaskId === task.taskId);
    if (!steps.length) return null;

    // 1. 已完成待领奖：支持在弹窗中匹配“点关闭（claim_ready:panel_xxx）”，回到大地图后匹配“领奖（claim_ready:panel_closed）”
    if (task.state === 1) {
        const claimTokens = new Set<string>(['claim_ready', ctx.panelState]);
        const matchedClaim = steps.find(row => {
            if (!row.PreCheck) return false;
            const parts = row.PreCheck.split(':').map(s => s.trim()).filter(Boolean);
            return parts.indexOf('claim_ready') >= 0 && parts.every(part => claimTokens.has(part));
        });
        if (matchedClaim) return matchedClaim;
        return ctx.panelState === 'panel_closed'
            ? steps.find(row => row.PreCheck === 'claim_ready') || null
            : null;
    }
    if (task.state !== 0) return null;

    // 2. 进行中：支持冒号组合条件，例如 need_troop_soldier:panel_army_setting:unallocated
    const readiness = evaluateTroopReadiness();
    const tokens = new Set<string>([readiness, ctx.panelState, ctx.allocationState]);
    const matched = steps.find(row => {
        if (!row.PreCheck) return ctx.panelState === 'panel_closed';
        const parts = row.PreCheck.split(':').map(s => s.trim()).filter(Boolean);
        return parts.length > 0 && parts.every(part => tokens.has(part));
    });
    return matched || null;
}

/**
 * 强指引全屏挖孔遮罩层（数据驱动自 Guide.tsv / Guide.json）：
 * 1. 全屏四向半透明黑幕（上/下/左/右四块独立 BlockInputEvents 拦截层），只在目标按钮区域留出可点击“挖孔”；
 * 2. 目标孔位周围绘制金色脉冲光框 + 浮动点击手势/箭头；
 * 3. 随行军师对话卡自动避开挖孔区域（目标偏下则在上方显示，目标偏上则在下方显示）；
 * 4. 挂在 MapUIScene 最顶层（高于 contentNode 弹窗），可穿透引导主城升级、点将抽卡、编队上阵、分兵、出征全流程；
 * 5. 右上角保留低调的「跳过引导」逃生入口，避免极端情况卡死玩家。
 */
@ccclass('GuideOverlay')
export default class GuideOverlay extends Component {
    private uiRoot: Node | null = null;
    private contentRoot: Node | null = null;
    private masks: { top: Node; bottom: Node; left: Node; right: Node };
    private maskGraphics: { top: Graphics; bottom: Graphics; left: Graphics; right: Graphics };
    private ringNode: Node;
    private ringGraphics: Graphics;
    private ringOpacity: UIOpacity;
    private handNode: Node;
    private handGraphics: Graphics;
    private dialogCard: Node;
    private portraitFrame: Node;
    private portrait: Sprite;
    private speakerLabel: Label;
    private bodyLabel: Label;
    private skipBtn: Node;

    private activeStep: GuideStepConfig | null = null;
    private activeTarget: Node | null = null;
    private lastHoleKey = '';
    private portraitCache = new Map<string, SpriteFrame>();
    private loadedPortraitKey = '';
    private pulseTime = 0;
    private handBasePos = new Vec3();
    private skipped = false;
    private pollElapsed = 0;

    public initialize(uiRoot: Node, contentRoot: Node): void {
        this.uiRoot = uiRoot;
        this.contentRoot = contentRoot;
        this.skipped = !!LocalCache.getPersonMemory(this.skipStorageKey(), false);
        if (!this.dialogCard) this.build();
        this.refresh();
    }

    private skipStorageKey(): string {
        const uid = LoginCommand.getInstance().proxy.getRoleData()?.userId || 'guest';
        return `newbie_guide_skipped_${uid}`;
    }

    private make(name: string, parent = this.node): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        node.addComponent(UITransform);
        parent.addChild(node);
        return node;
    }

    private makeBlocker(name: string): { node: Node; g: Graphics } {
        const node = this.make(name);
        node.addComponent(BlockInputEvents);
        const g = node.addComponent(Graphics);
        return { node, g };
    }

    private build(): void {
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);

        // 四向黑幕遮罩：中间目标矩形完全留空，让触摸事件原生穿透到目标按钮
        const top = this.makeBlocker('MaskTop');
        const bottom = this.makeBlocker('MaskBottom');
        const left = this.makeBlocker('MaskLeft');
        const right = this.makeBlocker('MaskRight');
        this.masks = { top: top.node, bottom: bottom.node, left: left.node, right: right.node };
        this.maskGraphics = { top: top.g, bottom: bottom.g, left: left.g, right: right.g };

        // 挖孔金色呼吸光框（不加 BlockInputEvents，不拦截点击）
        this.ringNode = this.make('HoleRing');
        this.ringGraphics = this.ringNode.addComponent(Graphics);
        this.ringOpacity = this.ringNode.addComponent(UIOpacity);

        // 浮动指示箭头/手指（不拦截点击）
        this.handNode = this.make('PointerHand');
        this.handGraphics = this.handNode.addComponent(Graphics);
        this.drawPointerGraphic(this.handGraphics);

        // 军师郭嘉对话卡（完全沿用 FirstLanding 的墨玉底板 + 破框半身大立绘 + 细金竖线风格）
        this.dialogCard = this.make('GuideDialogCard');
        this.dialogCard.addComponent(BlockInputEvents);
        this.portraitFrame = this.make('PortraitFrame', this.dialogCard);
        inkSurface(this.portraitFrame, 'Mount', 92, 126, C.ink, new Color(215, 180, 112));
        caption(this.portraitFrame, 'Fallback', '军师', 0, 0, 68, 16, C.gold, Label.HorizontalAlign.CENTER);
        this.portrait = this.make('Portrait', this.portraitFrame).addComponent(Sprite);
        this.portrait.sizeMode = Sprite.SizeMode.CUSTOM;
        this.portrait.node.active = false;

        this.speakerLabel = caption(this.dialogCard, 'Speaker', '军师', 0, 0, 260, 17, new Color(255, 216, 144));
        this.speakerLabel.isBold = true;
        this.bodyLabel = caption(this.dialogCard, 'Dialog', '', 0, 0, 320, 17, new Color(255, 249, 231));
        this.bodyLabel.enableWrapText = true;
        this.bodyLabel.lineHeight = 25;
        this.bodyLabel.outlineColor = new Color(10, 14, 13);
        this.bodyLabel.outlineWidth = 1;
        this.bodyLabel.overflow = Label.Overflow.SHRINK;

        // 右上角「跳过引导」
        this.skipBtn = this.make('SkipGuide');
        const skipButton = this.skipBtn.addComponent(Button);
        skipButton.transition = Button.Transition.SCALE;
        skipButton.zoomScale = 0.95;
        inkSurface(this.skipBtn, 'SkipBg', 94, 34, new Color(20, 24, 22, 200), new Color(174, 143, 87, 160));
        caption(this.skipBtn, 'Text', '跳过引导 ›', 0, 0, 88, 13, new Color(220, 206, 178), Label.HorizontalAlign.CENTER);
        this.skipBtn.on(Button.EventType.CLICK, this.onClickSkip, this);

        for (const ev of [E.updateTasks, E.updateTroopList, E.updateTroop, E.updateArmyList,
            E.updateArmy, E.updateCityBuilds, E.updateMyGenerals, E.lotteryChanged, E.protocolRequestChanged]) {
            EventMgr.on(ev, this.refresh, this);
        }
        this.hideAll();
    }

    private drawPointerGraphic(g: Graphics): void {
        g.clear();
        // 水墨鎏金双圈涟漪 + 细锐金锋光标，贴合游戏整体古风美术语言
        g.strokeColor = new Color(235, 198, 120, 95);
        g.lineWidth = 1.5;
        g.circle(0, 6, 16);
        g.stroke();
        g.strokeColor = new Color(255, 228, 156, 210);
        g.lineWidth = 2;
        g.circle(0, 6, 9);
        g.stroke();
        g.fillColor = new Color(255, 228, 156, 245);
        g.moveTo(0, -1);
        g.lineTo(-7, 11);
        g.lineTo(0, 8);
        g.lineTo(7, 11);
        g.close();
        g.fill();
    }

    private onClickSkip(): void {
        AudioManager.instance.playClick();
        this.skipped = true;
        LocalCache.setPersonMemory(this.skipStorageKey(), true);
        this.hideAll();
    }

    public queueRefresh(): void {
        this.refresh();
    }

    private inspectPanelContext(): GuidePanelContext {
        // 如果全屏开场动画、抽卡结算、系统解锁弹窗、通用奖励弹窗正在展示，暂时让出顶层，绝不挡住玩家关闭它们
        const scene = director.getScene();
        const canvas = scene?.getChildByName('Canvas') || this.uiRoot?.parent;
        const blockingNames = ['FirstLanding', 'LotteryRewardOverlay', 'SystemUnlockWindow', 'RewardWindow'];
        const hasTopBlocker = !!(
            this.uiRoot?.getChildByName('FirstLanding')?.activeInHierarchy
            || blockingNames.some(name => canvas?.getChildByName(name)?.activeInHierarchy)
        );
        if (hasTopBlocker) {
            return { panelState: 'panel_other', allocationState: 'unallocated', hasBlockingOverlay: true };
        }

        const activePanels = (this.contentRoot?.children || []).filter(c => c.active && c.name !== 'CloudAni');
        if (!activePanels.length) {
            if (canvas?.getChildByName('InnerCityScene')?.activeInHierarchy) {
                return { panelState: 'panel_city_build', allocationState: 'unallocated', hasBlockingOverlay: false };
            }
            return { panelState: 'panel_closed', allocationState: 'unallocated', hasBlockingOverlay: false };
        }

        // 取最顶层的激活面板判断当前所处界面
        const topPanel = activePanels[activePanels.length - 1];
        if (topPanel.name === 'CityBuildingPanel') {
            return { panelState: 'panel_city_build', allocationState: 'unallocated', hasBlockingOverlay: false };
        }
        if (topPanel.name === 'Draw') {
            return { panelState: 'panel_draw', allocationState: 'unallocated', hasBlockingOverlay: false };
        }
        if (topPanel.name === 'CityArmySetting') {
            const setting: any = topPanel.getComponent('CityArmySettingLogic');
            const allocated = Number(setting?.visualState?.allocated || 0) > 0;
            return {
                panelState: 'panel_army_setting',
                allocationState: allocated ? 'allocated' : 'unallocated',
                hasBlockingOverlay: false,
            };
        }
        if (topPanel.name === 'ArmySelectNode') {
            return { panelState: 'panel_army_select', allocationState: 'unallocated', hasBlockingOverlay: false };
        }
        // 打开了选将列表（GeneralList）等二级选择面板时，让玩家自由选择武将，不遮挡
        return { panelState: 'panel_other', allocationState: 'unallocated', hasBlockingOverlay: false };
    }

    /** 解析目标 UI 节点，支持路径中用数字索引访问子节点（如 content/CityArmySetting/generalLayer/0）。 */
    private resolveTargetNode(targetPath: string): Node | null {
        if (!targetPath || !this.uiRoot) return null;
        const innerCityNode = director.getScene()?.getChildByName('Canvas')?.getChildByName('InnerCityScene');
        if (innerCityNode?.activeInHierarchy && !this.contentRoot?.getChildByName('CityBuildingPanel')?.activeInHierarchy) {
            const innerCity: any = innerCityNode.getComponent('InnerCityScene');
            if (targetPath === 'content/CityBuildingPanel/SafeContent/CityBuildingWindow/BuildingDetail/BuildAction') {
                const action = innerCity?.getGuideBuildActionNode?.() as Node | null;
                if (action?.activeInHierarchy) {
                    const btn = action.getComponent(Button);
                    return (!btn || btn.interactable) ? action : null;
                }
                return null;
            }
            if (targetPath === 'content/CityBuildingPanel/SafeContent/CityBuildingWindow/Close') {
                const exit = innerCity?.getGuideExitButtonNode?.() as Node | null;
                if (exit?.activeInHierarchy) {
                    const btn = exit.getComponent(Button);
                    return (!btn || btn.interactable) ? exit : null;
                }
                return null;
            }
        }
        const parts = targetPath.split('/').filter(Boolean);
        let cur: Node | null = this.uiRoot;
        for (const part of parts) {
            if (!cur) return null;
            if (part === 'content' && cur === this.uiRoot && this.contentRoot) {
                cur = this.contentRoot;
                continue;
            }
            const byName = cur.getChildByName(part);
            if (byName) {
                cur = byName;
                continue;
            }
            if (/^\d+$/.test(part)) {
                cur = cur.children[Number(part)] || null;
                continue;
            }
            return null;
        }
        if (!cur || !cur.activeInHierarchy) return null;
        // 如果目标按钮当前不可点击（例如数据同步中、资源不足），不能锁死屏幕
        const btn = cur.getComponent(Button);
        if (btn && !btn.interactable) return null;
        return cur;
    }

    private hideAll(): void {
        this.activeStep = null;
        this.activeTarget = null;
        this.lastHoleKey = '';
        if (!this.masks) return;
        this.masks.top.active = false;
        this.masks.bottom.active = false;
        this.masks.left.active = false;
        this.masks.right.active = false;
        this.ringNode.active = false;
        this.handNode.active = false;
        this.dialogCard.active = false;
        this.skipBtn.active = false;
    }

    public refresh(): void {
        if (!this.dialogCard || !this.uiRoot || !this.isValid) return;
        if (this.skipped) { this.hideAll(); return; }

        const cmd = ProgressionCommand.getInstance();
        if (!cmd.sessionReady || !cmd.tasksLoaded) { this.hideAll(); return; }

        const task = trackedTask(cmd.getTasks());
        const ctx = this.inspectPanelContext();
        const step = matchActiveGuideStep(task, ctx);
        if (!step) { this.hideAll(); return; }

        const target = this.resolveTargetNode(step.TargetUI);
        if (!target) { this.hideAll(); return; }

        // 始终确保强指引位于 MapUIScene 最顶层（高于 contentNode 弹窗）
        if (this.node.parent) {
            this.node.setSiblingIndex(this.node.parent.children.length - 1);
        }

        this.activeStep = step;
        this.activeTarget = target;
        this.applyVisuals(step, target);
    }

    private applyVisuals(step: GuideStepConfig, target: Node): void {
        const rootUi = this.uiRoot?.getComponent(UITransform);
        const targetUi = target.getComponent(UITransform);
        const selfUi = this.node.getComponent(UITransform);
        if (!rootUi || !targetUi || !selfUi) { this.hideAll(); return; }

        const viewW = rootUi.width;
        const viewH = rootUi.height;
        place(this.node, 0, 0, viewW, viewH);

        // 计算目标节点在本地坐标系中的包围盒
        const worldPos = targetUi.convertToWorldSpaceAR(new Vec3(0, 0, 0));
        const localCenter = selfUi.convertToNodeSpaceAR(worldPos);
        const scale = target.worldScale;
        const pad = 6;
        const holeW = Math.max(44, targetUi.width * Math.abs(scale.x || 1) + pad * 2);
        const holeH = Math.max(40, targetUi.height * Math.abs(scale.y || 1) + pad * 2);
        const holeLeft = Math.max(-viewW / 2, localCenter.x - holeW / 2);
        const holeRight = Math.min(viewW / 2, localCenter.x + holeW / 2);
        const holeBottom = Math.max(-viewH / 2, localCenter.y - holeH / 2);
        const holeTop = Math.min(viewH / 2, localCenter.y + holeH / 2);

        const holeKey = `${step.Id}:${Math.round(viewW)}:${Math.round(viewH)}:${Math.round(holeLeft)}:${Math.round(holeRight)}:${Math.round(holeBottom)}:${Math.round(holeTop)}`;
        if (holeKey === this.lastHoleKey && this.dialogCard.active) return;
        this.lastHoleKey = holeKey;

        const forceMask = step.Force !== 0;
        const shadeColor = new Color(8, 12, 11, 178);

        // 1. 绘制四向挖孔黑幕遮罩（拦截孔外一切点击）
        const setRectMask = (node: Node, g: Graphics, x1: number, y1: number, x2: number, y2: number) => {
            const w = Math.max(0, x2 - x1);
            const h = Math.max(0, y2 - y1);
            node.active = forceMask && w > 0.5 && h > 0.5;
            if (!node.active) return;
            place(node, (x1 + x2) / 2, (y1 + y2) / 2, w, h);
            g.clear();
            g.fillColor = shadeColor;
            g.rect(-w / 2, -h / 2, w, h);
            g.fill();
        };
        setRectMask(this.masks.top, this.maskGraphics.top, -viewW / 2, holeTop, viewW / 2, viewH / 2);
        setRectMask(this.masks.bottom, this.maskGraphics.bottom, -viewW / 2, -viewH / 2, viewW / 2, holeBottom);
        setRectMask(this.masks.left, this.maskGraphics.left, -viewW / 2, holeBottom, holeLeft, holeTop);
        setRectMask(this.masks.right, this.maskGraphics.right, holeRight, holeBottom, viewW / 2, holeTop);

        // 2. 绘制挖孔边缘金色光框
        const actualW = holeRight - holeLeft;
        const actualH = holeTop - holeBottom;
        const cx = (holeLeft + holeRight) / 2;
        const cy = (holeBottom + holeTop) / 2;
        this.ringNode.active = true;
        place(this.ringNode, cx, cy, actualW + 16, actualH + 16);
        const rg = this.ringGraphics;
        rg.clear();
        rg.lineWidth = 7;
        rg.strokeColor = new Color(240, 198, 112, 55);
        rg.roundRect(-actualW / 2 - 2, -actualH / 2 - 2, actualW + 4, actualH + 4, 8);
        rg.stroke();
        rg.lineWidth = 2.5;
        rg.strokeColor = new Color(255, 228, 152, 245);
        rg.roundRect(-actualW / 2, -actualH / 2, actualW, actualH, 6);
        rg.stroke();

        // 3. 放置浮动指示箭头（优先在目标正上方，空间不够则翻转到正下方）
        this.handNode.active = true;
        const placeAbove = holeTop + 48 < viewH / 2 - 20;
        this.handNode.angle = placeAbove ? 0 : 180;
        this.handBasePos.set(cx, placeAbove ? holeTop + 8 : holeBottom - 8, 0);
        this.handNode.setPosition(this.handBasePos);

        // 4. 放置随行军师对话卡（复用 FirstLanding 墨玉鎏金破框立绘风格，自动避开挖孔区域）
        this.dialogCard.active = true;
        const cardW = Math.min(500, viewW - 36);
        const cardH = 108;
        const cardY = cy < 0
            ? Math.min(viewH / 2 - cardH / 2 - 74, Math.max(holeTop + cardH / 2 + 48, 36))
            : Math.max(-viewH / 2 + cardH / 2 + 24, Math.min(holeBottom - cardH / 2 - 48, -36));
        const cardX = Math.max(-viewW / 2 + cardW / 2 + 18, Math.min(viewW / 2 - cardW / 2 - 18, 0));
        place(this.dialogCard, cardX, cardY, cardW, cardH);

        const surface = inkSurface(this.dialogCard, 'DialogSurface', cardW, cardH,
            new Color(19, 26, 25, 246), new Color(174, 143, 87, 200));
        surface.fillColor = new Color(215, 180, 112);
        surface.rect(-cardW / 2 + 106, -cardH / 2 + 14, 3, cardH - 28);
        surface.fill();

        // 破框半身立绘：高度超出卡片顶边，底部与面板底齐平
        place(this.portraitFrame, -cardW / 2 + 52, 9, 92, 126);
        const textLeft = -cardW / 2 + 120;
        const textW = cardW - 138;
        this.speakerLabel.string = `${step.Speaker || '军师'}  ·  新手引导`;
        this.bodyLabel.string = step.Dialog;
        textStyle(this.speakerLabel, textLeft + textW / 2, cardH / 2 - 24, textW, 17, new Color(255, 216, 144), Label.HorizontalAlign.LEFT, 24);
        textStyle(this.bodyLabel, textLeft + textW / 2, -12, textW, 17, new Color(255, 249, 231), Label.HorizontalAlign.LEFT, 56);
        this.loadPortrait(step.Portrait || 'ui/onboarding/guide-advisor');

        // 5. 右上角「跳过引导」
        this.skipBtn.active = true;
        place(this.skipBtn, viewW / 2 - 62, viewH / 2 - 32, 94, 34);
    }

    private loadPortrait(rawPath: string): void {
        const path = rawPath.endsWith('/spriteFrame') ? rawPath : `${rawPath}/spriteFrame`;
        if (!path || path === this.loadedPortraitKey) return;
        this.loadedPortraitKey = path;
        const cached = this.portraitCache.get(path);
        if (cached) { this.applyPortrait(cached); return; }
        resources.load(path, SpriteFrame, (err, frame) => {
            if (!err && frame instanceof SpriteFrame && isValid(this, true)) {
                this.portraitCache.set(path, frame);
                if (this.loadedPortraitKey === path) this.applyPortrait(frame);
                return;
            }
            // 若尚未导入独立引导员立绘 ui/onboarding/guide-advisor.png，自动回退
            const fallbackPath = getGeneralPortraitPath('ui/hero/card_1020');
            resources.load(fallbackPath, SpriteFrame, (fbErr, fbFrame) => {
                if (fbErr || !(fbFrame instanceof SpriteFrame) || !isValid(this, true)) return;
                this.portraitCache.set(path, fbFrame);
                if (this.loadedPortraitKey === path) this.applyPortrait(fbFrame);
            });
        });
    }

    private applyPortrait(frame: SpriteFrame): void {
        if (!isValid(this.portrait, true)) return;
        this.portrait.spriteFrame = frame;
        this.portrait.node.active = true;
        place(this.portrait.node, 0, 0, 88, 122);
        const fallback = this.portraitFrame.getChildByName('Fallback');
        if (fallback) fallback.active = false;
    }

    protected update(dt: number): void {
        if (this.skipped) return;
        const stepDt = Math.min(dt, 0.1);
        this.pollElapsed += stepDt;
        // 面板打开/关闭、按钮 interactable 变化（例如点快速分兵后确认按钮激活、布局延迟完成）时实时刷新挖孔位置
        if (this.pollElapsed >= 0.12) {
            this.pollElapsed = 0;
            this.refresh();
        }
        if (!this.activeStep || !this.activeTarget?.isValid) return;

        this.pulseTime += stepDt;
        const wave = (Math.sin(this.pulseTime * Math.PI * 2.4) + 1) / 2;
        if (this.ringOpacity) {
            this.ringOpacity.opacity = 155 + Math.round(wave * 100);
        }
        if (this.handNode?.active) {
            const bounce = Math.sin(this.pulseTime * Math.PI * 3.0) * 7;
            const dir = this.handNode.angle === 0 ? 1 : -1;
            this.handNode.setPosition(this.handBasePos.x, this.handBasePos.y + dir * (6 + bounce), 0);
        }
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this.portraitCache.clear();
    }
}
