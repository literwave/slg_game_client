import {
    _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Mask,
    Node, ScrollView, Sprite, Tween, tween, UIOpacity, UITransform, Vec3,
} from 'cc';
import BuildCommand from '../build/BuildCommand';
import LoginCommand from '../login/LoginCommand';
import { itemIconPath } from '../common/ItemPresentation';
import { AudioManager } from '../common/AudioManager';
import MapUICommand from '../map/ui/MapUICommand';
import { buildingArt, buildingGoalPresentation, buildingNextUnlocks } from '../map/ui/BuildingPresentation';
import { buildingPortrait, cityAction, CityColors, cityDetailSurface } from '../map/ui/CityBuildingView';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from '../map/ui/ManagementStyle';
import { findInnerCityPlot, INNER_CITY_ZONE_LABELS, InnerCityShortcutKind } from './InnerCityLayout';

const { ccclass } = _decorator;

const GREEN = new Color(159, 198, 145, 255);
const RED = new Color(227, 148, 121, 255);
const COST_LACK_LINE = new Color(196, 118, 92, 195);

interface PrerequisiteRow {
    node: Node;
    icon: Sprite;
    title: Label;
    progress: Label;
    type: number;
    level: number;
}

interface UnlockChip {
    node: Node;
    icon: Sprite;
    type: number;
}

export interface InnerCityDrawerCallbacks {
    loadArt: (sprite: Sprite, path: string, width: number, height: number, groundY?: number) => void;
    onSelectBuilding: (type: number) => void;
    onShortcut: (kind: InnerCityShortcutKind, buildingType: number) => void;
    onBuildStarted?: (buildingType: number, isNewBuild: boolean) => void;
    onClose: () => void;
}

/**
 * 独立内城右侧轻量详情抽屉：
 * 保持左侧内城全景可见，展示选中建筑的立绘、等级跃迁、前置跳转、4 类资源消耗、
 * 后续解锁以及建筑专属玩法快捷入口（点将/城防部队/武将名录/商行贸易/营造路线图）。
 */
@ccclass('InnerCityDetailDrawer')
export default class InnerCityDetailDrawer extends Component {
    private callbacks!: InnerCityDrawerCallbacks;
    private rootOpacity!: UIOpacity;
    private headerZone!: Label;
    private titleLabel!: Label;
    private levelLabel!: Label;
    private closeBtn!: Node;
    private scroll!: ScrollView;
    private content!: Node;
    private portraitShadow!: Graphics;
    private artSprite!: Sprite;
    private descLabel!: Label;
    private shortcutBtn!: Node;
    private shortcutKind: InnerCityShortcutKind | null = null;
    private conditionTitle!: Label;
    private conditionEmpty!: Label;
    private conditionRows: PrerequisiteRow[] = [];
    private costTitle!: Label;
    private costDock!: Node;
    private costs: Array<{ node: Node; icon: Sprite; label: Label }> = [];
    private unlockTitle!: Label;
    private unlockChips: UnlockChip[] = [];
    private actionBtn!: Node;
    private actionHint!: Label;

    private cityId = 0;
    private selectedType = 1;
    private drawerWidth = 344;
    private drawerHeight = 560;
    private restX = 0;
    private restY = 0;
    private built = false;

    public initialize(callbacks: InnerCityDrawerCallbacks): void {
        this.callbacks = callbacks;
        if (this.built) return;
        this.node.name = 'BuildingDetail';
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        this.rootOpacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);

        this.headerZone = caption(this.node, 'ZoneTag', '', 0, 0, 180, 12, CityColors.gold, Label.HorizontalAlign.LEFT);
        this.titleLabel = caption(this.node, 'BuildingName', '', 0, 0, 220, 23, CityColors.paper, Label.HorizontalAlign.LEFT);
        this.titleLabel.isBold = true;
        this.levelLabel = caption(this.node, 'BuildingLevel', '', 0, 0, 220, 13, CityColors.gold, Label.HorizontalAlign.LEFT);
        this.closeBtn = this.makeButton(this.node, 'CloseDrawer', () => {
            AudioManager.instance.playClick();
            this.callbacks.onClose();
        });

        this.scroll = this.makeScroll('DetailScroll', this.node);
        this.content = this.scroll.content!;

        this.portraitShadow = this.makeNode('PortraitShadow', this.content).addComponent(Graphics);
        this.artSprite = this.makeSprite('BuildingArt', this.content);
        this.descLabel = caption(this.content, 'Description', '', 0, 0, 280, 13, C.muted, Label.HorizontalAlign.CENTER);
        this.descLabel.enableWrapText = true;

        this.shortcutBtn = this.makeButton(this.content, 'ShortcutButton', () => {
            if (!this.shortcutKind) return;
            AudioManager.instance.playClick();
            this.callbacks.onShortcut(this.shortcutKind, this.selectedType);
        });

        this.conditionTitle = caption(this.content, 'ConditionTitle', '建造条件', 0, 0, 280, 14, CityColors.gold);
        this.conditionEmpty = caption(this.content, 'Conditions', '', 0, 0, 280, 13, GREEN);
        this.conditionEmpty.enableWrapText = true;

        this.costDock = this.makeNode('CostDock', this.content);
        this.costTitle = caption(this.costDock, 'CostTitle', '消耗资源', 0, 0, 280, 14, CityColors.gold);
        for (let i = 0; i < 4; i++) {
            const node = this.makeNode(`Cost_${i}`, this.costDock);
            this.costs.push({
                node,
                icon: this.makeSprite('Icon', node),
                label: caption(node, 'Amount', '', 0, 0, 80, 14, C.text, Label.HorizontalAlign.CENTER),
            });
        }

        this.unlockTitle = caption(this.content, 'UnlockTitle', '后续建设', 0, 0, 280, 14, CityColors.gold);

        // 保留 BuildAction 节点名，确保新手强指引 Task 1002 无缝命中主城升级按钮。
        this.actionBtn = this.makeButton(this.node, 'BuildAction', () => this.onAction());
        this.actionHint = caption(this.node, 'ActionHint', '', 0, 0, 300, 12, C.muted, Label.HorizontalAlign.CENTER);

        this.built = true;
        this.node.active = false;
    }

    public get width(): number {
        return this.drawerWidth;
    }

    public getActionButtonNode(): Node | null {
        return this.actionBtn?.isValid ? this.actionBtn : null;
    }

    public show(cityId: number, buildingType: number, animate = false): void {
        if (!this.built) return;
        this.cityId = cityId;
        this.selectedType = buildingType;
        const wasHidden = !this.node.active;
        this.node.active = true;
        this.refresh();
        this.scroll.scrollToTop(0);
        if (animate || wasHidden) {
            Tween.stopAllByTarget(this.rootOpacity);
            Tween.stopAllByTarget(this.node);
            this.rootOpacity.opacity = 0;
            this.node.setPosition(this.restX + 24, this.restY, 0);
            tween(this.rootOpacity).to(0.18, { opacity: 255 }, { easing: 'quadOut' }).start();
            tween(this.node).to(0.20, { position: new Vec3(this.restX, this.restY, 0) }, { easing: 'quadOut' }).start();
        } else {
            this.rootOpacity.opacity = 255;
            this.node.setPosition(this.restX, this.restY, 0);
        }
    }

    public hide(): void {
        if (!this.node?.isValid) return;
        Tween.stopAllByTarget(this.rootOpacity);
        Tween.stopAllByTarget(this.node);
        this.node.active = false;
    }

    public layout(viewW: number, viewH: number, topInset: number, bottomInset: number): void {
        if (!this.built) return;
        const margin = viewW < 760 ? 10 : 16;
        this.drawerWidth = Math.min(352, Math.max(276, viewW < 760 ? viewW - margin * 2 : 344));
        const maxH = Math.max(320, viewH - topInset - bottomInset);
        this.drawerHeight = Math.min(620, maxH);
        this.restX = viewW * 0.5 - margin - this.drawerWidth * 0.5;
        const topY = viewH * 0.5 - topInset;
        this.restY = topY - this.drawerHeight * 0.5;
        place(this.node, this.restX, this.restY, this.drawerWidth, this.drawerHeight);
        cityDetailSurface(this.node, this.drawerWidth, this.drawerHeight);

        const w = this.drawerWidth;
        const h = this.drawerHeight;
        const headerPad = 18;
        place(this.headerZone.node, -w * 0.5 + headerPad + 86, h * 0.5 - 22, 172, 18);
        place(this.titleLabel.node, -w * 0.5 + headerPad + 114, h * 0.5 - 46, w - 78, 30);
        this.titleLabel.overflow = Label.Overflow.SHRINK;
        place(this.levelLabel.node, -w * 0.5 + headerPad + 114, h * 0.5 - 70, w - 78, 20);
        this.levelLabel.overflow = Label.Overflow.SHRINK;
        panelButton(this.closeBtn, '', w * 0.5 - 28, h * 0.5 - 30, 32, 32, false, true);

        const headerDivider = inkSurface(this.node, 'HeaderDivider', w - 28, 1, null, null);
        headerDivider.node.setPosition(0, h * 0.5 - 86, 0);
        headerDivider.strokeColor = CityColors.line;
        headerDivider.lineWidth = 1;
        headerDivider.moveTo(-(w - 28) * 0.5, 0);
        headerDivider.lineTo((w - 28) * 0.5, 0);
        headerDivider.stroke();
        headerDivider.strokeColor = CityColors.gold;
        headerDivider.moveTo(-(w - 28) * 0.5, 0);
        headerDivider.lineTo(-(w - 28) * 0.5 + 48, 0);
        headerDivider.stroke();

        const footerHeight = 82;
        const scrollTop = h * 0.5 - 92;
        const scrollBottom = -h * 0.5 + footerHeight;
        const scrollH = Math.max(100, scrollTop - scrollBottom);
        this.sizeScroll(this.scroll, 0, (scrollTop + scrollBottom) * 0.5, w - 20, scrollH);

        place(this.actionBtn, 0, -h * 0.5 + 46, w - 32, 46);
        place(this.actionHint.node, 0, -h * 0.5 + 14, w - 28, 20);

        if (this.node.active) this.refresh();
    }

    public refresh(): void {
        if (!this.built || !this.node.activeInHierarchy || !this.headerZone) return;
        const b = BuildCommand.getInstance();
        const configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        const cfg = configs.find(item => item.type === this.selectedType);
        if (!cfg) {
            const btn = this.actionBtn?.getComponent(Button);
            if (btn) btn.interactable = false;
            return;
        }
        const plot = findInnerCityPlot(cfg.type);
        const current = b.levels.get(cfg.type) || 0;
        const targetLevel = cfg.upLevels[current] ? current + 1 : Math.max(1, current);
        const balances = this.resourceBalances();
        const state = buildingGoalPresentation(cfg, targetLevel, b.levels, configs, balances);
        const known = b.loaded;

        this.headerZone.string = plot ? `${INNER_CITY_ZONE_LABELS[plot.zone]} · 内城建筑` : '内城建筑';
        this.titleLabel.string = cfg.name;
        this.levelLabel.string = !known
            ? '正在同步等级…'
            : state.maxed
                ? `${state.level} 级 · 已达上限`
                : state.level <= 0
                    ? '未建造  →  1 级'
                    : `${state.level} 级  →  ${state.targetLevel} 级`;

        const dw = this.drawerWidth - 40;
        const portraitH = 148;
        buildingPortrait(this.content, dw, portraitH);
        const portraitBg = inkSurface(this.content, 'PortraitBackdrop', dw, portraitH - 6, new Color(27, 32, 23, 215), CityColors.line);
        portraitBg.node.setPosition(0, -portraitH * 0.5);
        portraitBg.node.setSiblingIndex(0);
        // 建筑立绘底影
        this.portraitShadow.clear();
        this.portraitShadow.node.setPosition(0, -portraitH + 26, 0);
        this.portraitShadow.fillColor = new Color(12, 13, 9, 95);
        this.portraitShadow.ellipse(0, 0, Math.min(82, dw * 0.30), 16);
        this.portraitShadow.fill();
        this.callbacks.loadArt(this.artSprite, buildingArt(cfg, Math.max(1, state.level)), Math.min(212, dw - 24), portraitH - 20, -portraitH + 16);

        let top = portraitH + 12;
        this.descLabel.string = cfg.des;
        this.descLabel.lineHeight = 19;
        place(this.descLabel.node, 0, -top - 18, dw, 38);
        this.descLabel.overflow = Label.Overflow.SHRINK;
        top += 44;

        // 专属玩法快捷入口（已建成时激活显示）
        const shortcut = plot?.shortcut;
        this.shortcutKind = shortcut ? shortcut.kind : null;
        const showShortcut = !!shortcut && (shortcut.kind === 'overview' || (known && state.level > 0));
        this.shortcutBtn.active = showShortcut;
        if (showShortcut && shortcut) {
            panelButton(this.shortcutBtn, `${shortcut.label}  ›`, 0, -top - 18, dw, 34, false);
            top += 44;
        }

        // 建造/升级前置条件
        this.conditionTitle.string = state.maxed ? '建设进度' : '前置条件';
        place(this.conditionTitle.node, 0, -top - 10, dw, 22);
        top += 26;
        const hasConditions = known && !state.achieved && state.conditions.length > 0;
        this.conditionEmpty.node.active = !hasConditions;
        this.conditionRows.forEach(row => { row.node.active = false; });
        if (!hasConditions) {
            this.conditionEmpty.string = !known ? '等待建筑数据同步' : state.maxed ? '该建筑已全部建成' : '无前置要求，可直接施工';
            this.conditionEmpty.color = known ? GREEN : C.muted;
            place(this.conditionEmpty.node, 0, -top - 12, dw, 24);
            top += 30;
        } else {
            state.conditions.forEach((condition, i) => {
                let row = this.conditionRows[i];
                if (!row) {
                    const node = this.makeButton(this.content, `Prerequisite_${i}`, () => {
                        const target = this.conditionRows[i];
                        if (target) this.callbacks.onSelectBuilding(target.type);
                    });
                    row = {
                        node,
                        type: 0,
                        level: 0,
                        icon: this.makeSprite('Icon', node),
                        title: caption(node, 'Name', '', 0, 0, 160, 13),
                        progress: caption(node, 'Progress', '', 0, 0, 76, 12, C.muted, Label.HorizontalAlign.RIGHT),
                    };
                    this.conditionRows.push(row);
                }
                row.type = condition.type;
                row.level = condition.level;
                row.node.active = true;
                place(row.node, 0, -top - 17, dw, 34);
                inkSurface(row.node, 'Surface', dw, 34, C.inset, condition.met ? C.line : COST_LACK_LINE);
                const reqCfg = configs.find(item => item.type === condition.type);
                row.icon.node.setPosition(-dw * 0.5 + 22, 0, 0);
                if (reqCfg) this.callbacks.loadArt(row.icon, buildingArt(reqCfg, Math.max(1, condition.currentLevel)), 32, 26);
                place(row.title.node, -10, 0, dw - 118, 24);
                row.title.string = `${condition.name} ${condition.level}级`;
                row.title.color = condition.met ? GREEN : C.text;
                row.title.overflow = Label.Overflow.SHRINK;
                place(row.progress.node, dw * 0.5 - 38, 0, 62, 24);
                row.progress.string = `${condition.currentLevel}/${condition.level} ${condition.met ? '✓' : '›'}`;
                row.progress.color = condition.met ? GREEN : RED;
                top += 40;
            });
            top += 6;
        }

        // 消耗资源（4 宫格紧凑排列）
        const showCosts = known && !state.achieved;
        this.costDock.active = showCosts;
        if (showCosts) {
            place(this.costDock, 0, -top - 58, dw, 116);
            place(this.costTitle.node, 0, 48, dw, 22);
            const colW = (dw - 18) / 4;
            this.costs.forEach((row, i) => {
                const cost = state.costs[i];
                if (!cost) { row.node.active = false; return; }
                row.node.active = true;
                const enough = cost.have >= cost.need;
                place(row.node, -dw * 0.5 + colW * 0.5 + i * (colW + 6), -8, colW, 88);
                inkSurface(row.node, 'Surface', colW, 88, new Color(24, 29, 21, 232), enough ? CityColors.line : COST_LACK_LINE);
                caption(row.node, 'ResourceName', cost.name, 0, 32, colW - 6, 11, C.muted, Label.HorizontalAlign.CENTER);
                row.icon.node.setPosition(0, 8, 0);
                this.callbacks.loadArt(row.icon, itemIconPath(cost.id).replace(/\/spriteFrame$/, ''), 26, 26);
                place(row.label.node, 0, -16, colW - 6, 20);
                row.label.string = `${cost.need}`;
                row.label.fontSize = 14;
                row.label.overflow = Label.Overflow.SHRINK;
                row.label.color = enough ? C.text : RED;
                const held = caption(row.node, 'Owned', `有${cost.have}`, 0, -34, colW - 6, 10,
                    enough ? C.muted : RED, Label.HorizontalAlign.CENTER);
                held.overflow = Label.Overflow.SHRINK;
            });
            top += 126;
        }

        // 后续建设提示
        const nextUnlocks = buildingNextUnlocks(cfg.type, b.levels, configs);
        const showUnlocks = known && nextUnlocks.length > 0;
        this.unlockTitle.node.active = showUnlocks;
        this.unlockChips.forEach(chip => { chip.node.active = false; });
        if (showUnlocks) {
            this.unlockTitle.string = `后续可解锁 · ${nextUnlocks.length}`;
            place(this.unlockTitle.node, 0, -top - 10, dw, 22);
            top += 26;
            const cols = 3;
            const chipW = (dw - (cols - 1) * 6) / cols;
            nextUnlocks.slice(0, 6).forEach((item, i) => {
                let chip = this.unlockChips[i];
                if (!chip) {
                    const node = this.makeButton(this.content, `NextUnlock_${i}`, () => {
                        const t = this.unlockChips[i];
                        if (t) this.callbacks.onSelectBuilding(t.type);
                    });
                    chip = { node, icon: this.makeSprite('Icon', node), type: item.type };
                    this.unlockChips.push(chip);
                }
                chip.type = item.type;
                chip.node.active = true;
                const col = i % cols;
                const rowIdx = Math.floor(i / cols);
                place(chip.node, -dw * 0.5 + chipW * 0.5 + col * (chipW + 6), -top - 42 - rowIdx * 90, chipW, 84);
                inkSurface(chip.node, 'Surface', chipW, 84, C.inset, CityColors.line);
                const nextCfg = configs.find(c => c.type === item.type);
                chip.icon.node.setPosition(0, 14, 0);
                if (nextCfg) this.callbacks.loadArt(chip.icon, buildingArt(nextCfg, item.targetLevel), 48, 38);
                caption(chip.node, 'Name', item.name, 0, -16, chipW - 8, 12, C.text, Label.HorizontalAlign.CENTER).overflow = Label.Overflow.SHRINK;
                caption(chip.node, 'Req', `需${item.requiredLevel}级`, 0, -32, chipW - 8, 10, C.muted, Label.HorizontalAlign.CENTER).overflow = Label.Overflow.SHRINK;
            });
            top += Math.ceil(Math.min(6, nextUnlocks.length) / cols) * 90 + 6;
        }

        const viewportH = this.scroll.node.getComponent(UITransform)!.height;
        this.content.getComponent(UITransform)!.setContentSize(this.drawerWidth - 20, Math.max(viewportH, top + 12));

        // 底部主操作按钮
        const pending = b.requestInFlight(`build:${cfg.type}`);
        const blocked = !state.achieved && state.conditions.find(c => !c.met && configs.some(item => item.type === c.type));
        const actionLabel = !b.sessionReady ? '等待连接'
            : b.loading ? '正在同步…'
                : b.loadError ? '同步失败'
                    : !known ? '读取中…'
                        : pending ? '施工中…'
                            : blocked ? `前往${blocked.name}`
                                : state.action;
        const canPress = b.sessionReady && known && !b.loading && !b.loadError && !pending && (state.canAct || !!blocked);
        cityAction(this.actionBtn, actionLabel, canPress, this.drawerWidth - 32);
        this.actionBtn.getComponent(Button)!.interactable = canPress;
        this.actionHint.string = b.loadError ? '连接恢复后自动同步'
            : !known ? '同步完成后可施工'
                : blocked ? `前置建筑未达要求：需 ${blocked.name} ${blocked.level} 级`
                    : state.maxed ? '已达最高等级'
                        : !state.enough ? '资源不足，可前往大地图占领资源地'
                            : state.costs.every(cost => cost.need === 0) ? '本次营造不消耗资源' : '';
        this.actionHint.overflow = Label.Overflow.SHRINK;
    }

    private onAction(): void {
        const b = BuildCommand.getInstance();
        if (!b.loaded || b.loadError || b.loading || !b.sessionReady) return;
        const configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        const cfg = configs.find(item => item.type === this.selectedType);
        if (!cfg) return;
        const current = b.levels.get(cfg.type) || 0;
        const target = cfg.upLevels[current] ? current + 1 : Math.max(1, current);
        const state = buildingGoalPresentation(cfg, target, b.levels, configs, this.resourceBalances());
        const blocked = !state.achieved ? state.conditions.find(c => !c.met) : null;
        if (blocked) {
            AudioManager.instance.playClick();
            this.callbacks.onSelectBuilding(blocked.type);
            return;
        }
        if (!state.canAct) return;
        AudioManager.instance.playClick();
        this.callbacks.onBuildStarted?.(cfg.type, current <= 0);
        MapUICommand.getInstance().upFacility(this.cityId, cfg.type);
    }

    private resourceBalances(): Array<{ k: number; v: number }> {
        const proxy = LoginCommand.getInstance().proxy;
        return [1, 2, 3, 4].map(k => ({ k, v: proxy.getItemCount(k) }));
    }

    private makeNode(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        parent.addChild(node);
        node.addComponent(UITransform);
        return node;
    }

    private makeSprite(name: string, parent: Node): Sprite {
        const sprite = this.makeNode(name, parent).addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        return sprite;
    }

    private makeButton(parent: Node, name: string, handler: () => void): Node {
        const node = this.makeNode(name, parent);
        node.addComponent(Button);
        node.on(Button.EventType.CLICK, handler, this);
        return node;
    }

    private makeScroll(name: string, parent: Node): ScrollView {
        const node = this.makeNode(name, parent);
        const scroll = node.addComponent(ScrollView);
        scroll.horizontal = false;
        scroll.vertical = true;
        scroll.elastic = false;
        const viewNode = this.makeNode('view', node);
        viewNode.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const content = this.makeNode('content', viewNode);
        content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        scroll.content = content;
        return scroll;
    }

    private sizeScroll(scroll: ScrollView, x: number, y: number, w: number, h: number): void {
        place(scroll.node, x, y, w, h);
        const viewNode = scroll.node.getChildByName('view');
        if (viewNode) place(viewNode, 0, 0, w, h);
        const content = scroll.content;
        if (content) {
            const ui = content.getComponent(UITransform)!;
            ui.setAnchorPoint(0.5, 1);
            ui.setContentSize(w, Math.max(h, ui.height));
            content.setPosition(0, h * 0.5, 0);
        }
    }
}
