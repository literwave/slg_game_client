import {
    _decorator, Button, Color, Component, Graphics, Label, Node, Sprite, SpriteFrame,
    Tween, tween, UIOpacity, UITransform, Vec3, resources,
} from 'cc';
import { AudioManager } from '../common/AudioManager';
import BuildCommand from '../build/BuildCommand';
import LoginCommand from '../login/LoginCommand';
import { buildingGoalPresentation } from '../map/ui/BuildingPresentation';
import { CityColors } from '../map/ui/CityBuildingView';
import MapUICommand from '../map/ui/MapUICommand';
import { caption, place } from '../map/ui/ManagementStyle';
import { findInnerCityPlot, InnerCityShortcutKind } from './InnerCityLayout';

const { ccclass } = _decorator;

const GOLD_BRIGHT = new Color(252, 226, 152, 255);
const JADE_READY = new Color(172, 228, 152, 255);
const CRIMSON_LACK = new Color(242, 138, 120, 255);
const MUTED_TEXT = new Color(196, 190, 170, 238);

const RESOURCE_ICON_PATHS: Readonly<Record<number, string>> = {
    1: 'ui/resource_icons/icon_grain',
    2: 'ui/resource_icons/icon_wood',
    3: 'ui/resource_icons/icon_iron',
    4: 'ui/resource_icons/icon_stone',
};

const SHORTCUT_ICON_PATHS: Readonly<Partial<Record<InnerCityShortcutKind, string>>> = {
    overview: 'ui/sidebar/sidebar-buildings-v1',
    troops: 'ui/sidebar/sidebar-army-v1',
    draw: 'ui/hud/hud-recruit',
};

export interface InnerCityActionBarCallbacks {
    onInspect: (buildingType: number) => void;
    onBuildStarted: (buildingType: number, isNewBuild: boolean) => void;
    onSelectBuilding: (buildingType: number) => void;
    onShortcut: (kind: InnerCityShortcutKind, buildingType: number) => void;
    onDismiss: () => void;
}

interface ActionMedallion {
    node: Node;
    bg: Graphics;
    icon: Graphics;
    spriteNode: Node;
    sprite: Sprite;
    label: Label;
    button: Button;
}

interface InlineCostChip {
    node: Node;
    icon: Sprite;
    amount: Label;
}

/**
 * 经典商业 SLG（三国志·战略版 / 重返帝国风格）建筑脚下悬浮操作环：
 * - 上方汉漆双金边信息匾：展示建筑名、等级跃迁与真实资源图标消耗；
 * - 下方弧形排布 2–3 枚精工汉铜圆钮：详情 / 一键建造·升级主钮 / 专属玩法快捷入口。
 */
@ccclass('InnerCityActionBar')
export default class InnerCityActionBar extends Component {
    private callbacks!: InnerCityActionBarCallbacks;
    private rootOpacity!: UIOpacity;

    private headerNode!: Node;
    private headerBg!: Graphics;
    private titleLabel!: Label;
    private statusLabel!: Label;
    private costRowNode!: Node;
    private costChips: InlineCostChip[] = [];

    private infoBtn!: ActionMedallion;
    private primaryBtn!: ActionMedallion;
    private shortcutBtn!: ActionMedallion;

    private cityId = 0;
    private buildingType = 0;
    private shortcutKind: InnerCityShortcutKind | null = null;
    private blockedTargetType = 0;
    private primaryCanBuild = false;
    private isNewBuild = false;
    private built = false;
    private iconFrames = new Map<string, SpriteFrame>();

    public initialize(callbacks: InnerCityActionBarCallbacks): void {
        if (this.built) return;
        this.callbacks = callbacks;
        const ui = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        ui.setAnchorPoint(0.5, 0.5);
        ui.setContentSize(316, 134);
        this.rootOpacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);

        // 1. 顶部汉风信息匾（名称等级 + 图标化资源花费行）
        this.headerNode = this.createNode('HeaderPill', this.node);
        this.headerBg = this.headerNode.addComponent(Graphics);
        this.titleLabel = caption(this.headerNode, 'Title', '', 0, 12, 260, 14, GOLD_BRIGHT, Label.HorizontalAlign.CENTER);
        this.titleLabel.isBold = true;
        this.titleLabel.outlineColor = new Color(14, 10, 6, 255);
        this.titleLabel.outlineWidth = 1.6;

        this.statusLabel = caption(this.headerNode, 'CostSummary', '', 0, -10, 264, 11, MUTED_TEXT, Label.HorizontalAlign.CENTER);
        this.statusLabel.overflow = Label.Overflow.SHRINK;

        this.costRowNode = this.createNode('InlineCostRow', this.headerNode);
        this.costRowNode.setPosition(0, -10, 0);
        for (let i = 0; i < 4; i++) {
            const chipNode = this.createNode(`CostChip_${i}`, this.costRowNode);
            const iconNode = this.createNode('Icon', chipNode);
            const icon = iconNode.addComponent(Sprite);
            icon.sizeMode = Sprite.SizeMode.CUSTOM;
            place(iconNode, -16, 0, 16, 16);
            const amount = caption(chipNode, 'Amount', '', 12, 0, 44, 11, JADE_READY, Label.HorizontalAlign.LEFT);
            amount.isBold = true;
            amount.outlineColor = new Color(12, 10, 6, 240);
            amount.outlineWidth = 1.2;
            amount.overflow = Label.Overflow.SHRINK;
            chipNode.active = false;
            this.costChips.push({ node: chipNode, icon, amount });
        }

        // 2. 弧形排布的三枚精工汉铜圆钮
        this.infoBtn = this.createMedallion('InfoBtn', () => {
            AudioManager.instance.playClick();
            this.callbacks.onInspect(this.buildingType);
        });
        this.primaryBtn = this.createMedallion('PrimaryActionBtn', () => this.onPrimaryPressed());
        this.shortcutBtn = this.createMedallion('ShortcutBtn', () => {
            if (!this.shortcutKind) return;
            AudioManager.instance.playClick();
            this.callbacks.onShortcut(this.shortcutKind, this.buildingType);
        });

        this.preloadIcons();
        this.node.active = false;
        this.built = true;
    }

    public show(cityId: number, buildingType: number, screenX: number, screenY: number, viewW: number, viewH: number, animate = true): void {
        if (!this.built) return;
        this.cityId = cityId;
        this.buildingType = buildingType;
        this.refreshContent();

        const marginX = 156;
        const clampedX = Math.max(-viewW * 0.5 + marginX, Math.min(viewW * 0.5 - marginX, screenX));
        const clampedY = Math.max(-viewH * 0.5 + 90, Math.min(viewH * 0.5 - 122, screenY));
        this.node.setPosition(clampedX, clampedY, 0);

        const wasActive = this.node.active;
        this.node.active = true;
        if (animate || !wasActive) {
            Tween.stopAllByTarget(this.node);
            Tween.stopAllByTarget(this.rootOpacity);
            this.node.setScale(0.84, 0.84, 1);
            this.rootOpacity.opacity = 0;
            tween(this.node).to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
            tween(this.rootOpacity).to(0.12, { opacity: 255 }).start();
        } else {
            this.node.setScale(1, 1, 1);
            this.rootOpacity.opacity = 255;
        }
    }

    public updatePosition(screenX: number, screenY: number, viewW: number, viewH: number): void {
        if (!this.built || !this.node.active) return;
        const marginX = 156;
        const clampedX = Math.max(-viewW * 0.5 + marginX, Math.min(viewW * 0.5 - marginX, screenX));
        const clampedY = Math.max(-viewH * 0.5 + 90, Math.min(viewH * 0.5 - 122, screenY));
        this.node.setPosition(clampedX, clampedY, 0);
    }

    public hide(): void {
        if (!this.built) return;
        this.node.active = false;
    }

    public get isVisible(): boolean {
        return this.built && this.node.active;
    }

    /** 供新手引导精确获取当前悬浮操作条上的“建造/升级”主按钮。 */
    public getPrimaryButtonNode(): Node | null {
        if (!this.built || !this.node.activeInHierarchy) return null;
        return this.primaryBtn?.node?.isValid ? this.primaryBtn.node : null;
    }

    public refreshContent(): void {
        if (!this.built || this.buildingType <= 0) return;
        const b = BuildCommand.getInstance();
        const configs = MapUICommand.getInstance().proxy.getFacilityConfigs();
        const cfg = configs.find(item => item.type === this.buildingType);
        if (!cfg) return;

        const plot = findInnerCityPlot(cfg.type);
        const known = b.loaded;
        const current = b.levels.get(cfg.type) || 0;
        const target = cfg.upLevels[current] ? current + 1 : Math.max(1, current);
        const state = buildingGoalPresentation(cfg, target, b.levels, configs, this.resourceBalances());
        const pending = b.requestInFlight(`build:${cfg.type}`);
        const blocked = !state.achieved ? state.conditions.find(c => !c.met && configs.some(item => item.type === c.type)) : null;

        this.blockedTargetType = blocked ? blocked.type : 0;
        this.primaryCanBuild = b.sessionReady && known && !b.loading && !b.loadError && !pending && state.canAct;
        this.isNewBuild = current <= 0;

        // 1. 顶部名称 + 图标化花费摘要
        const statusText = !known ? `${cfg.name} · 同步中`
            : current <= 0 ? `${cfg.name} · 待建造`
                : state.maxed ? `${cfg.name} · 已满级`
                    : `${cfg.name}  Lv.${current} → Lv.${target}`;
        this.titleLabel.string = statusText;

        let pillContentW = statusText.length * 12.2 + 34;
        const nonZeroCosts = state.costs.filter(c => c.need > 0);
        const showIconCosts = known && !state.maxed && !blocked && nonZeroCosts.length > 0;
        this.costRowNode.active = showIconCosts;
        this.statusLabel.node.active = !showIconCosts;

        if (showIconCosts) {
            const chipW = 60;
            const totalW = nonZeroCosts.length * chipW;
            pillContentW = Math.max(pillContentW, totalW + 30);
            this.costChips.forEach((chip, idx) => {
                const cost = nonZeroCosts[idx];
                if (!cost) {
                    chip.node.active = false;
                    return;
                }
                chip.node.active = true;
                const cx = -totalW * 0.5 + chipW * 0.5 + idx * chipW;
                place(chip.node, cx, 0, chipW, 20);
                const enough = cost.have >= cost.need;
                chip.amount.string = this.compactNum(cost.need);
                chip.amount.color = enough ? new Color(238, 244, 224, 255) : CRIMSON_LACK;
                const iconPath = RESOURCE_ICON_PATHS[cost.id];
                if (iconPath) this.applySpriteIcon(chip.icon, iconPath, 16, 16);
            });
        } else {
            if (!known) {
                this.statusLabel.string = '正在同步城建状态…';
                this.statusLabel.color = MUTED_TEXT;
            } else if (state.maxed) {
                this.statusLabel.string = '已臻至最高等级';
                this.statusLabel.color = JADE_READY;
            } else if (blocked) {
                this.statusLabel.string = `前置未满足：需 ${blocked.name} ${blocked.level}级`;
                this.statusLabel.color = CRIMSON_LACK;
            } else {
                this.statusLabel.string = '本次营造不消耗资源';
                this.statusLabel.color = JADE_READY;
            }
            pillContentW = Math.max(pillContentW, this.statusLabel.string.length * 10.2 + 34);
        }

        const pillW = Math.max(214, Math.min(294, Math.round(pillContentW)));
        const pillH = 48;
        place(this.headerNode, 0, 38, pillW, pillH);
        this.drawHeaderPill(pillW, pillH);

        // 2. 弧形排布的底部精工圆钮
        const shortcut = plot?.shortcut;
        const showShortcut = !!shortcut && (shortcut.kind === 'overview' || (known && current > 0));
        this.shortcutKind = showShortcut && shortcut ? shortcut.kind : null;
        this.shortcutBtn.node.active = showShortcut;

        const primaryLabel = !b.sessionReady || !known ? '同步中'
            : pending ? '营造中'
                : blocked ? `前往${blocked.name.slice(0, 3)}`
                    : state.maxed ? '已满级'
                        : current <= 0 ? '建造' : '升级';
        const primaryEnabled = b.sessionReady && known && !b.loading && !b.loadError && !pending && (state.canAct || !!blocked);

        const gap = showShortcut ? 86 : 60;
        const infoX = -gap;
        const primaryX = showShortcut ? 0 : gap;
        const shortcutX = gap;

        this.styleMedallion(this.infoBtn, infoX, -28, 64, '详情', 'info', null, false, true);
        this.styleMedallion(
            this.primaryBtn,
            primaryX,
            showShortcut ? -36 : -28,
            74,
            primaryLabel,
            blocked ? 'goto' : 'hammer',
            null,
            primaryEnabled && !blocked,
            primaryEnabled,
        );
        if (showShortcut && shortcut) {
            const shortLabel = shortcut.label.length > 4 ? shortcut.label.slice(0, 4) : shortcut.label;
            const spritePath = SHORTCUT_ICON_PATHS[shortcut.kind] || null;
            this.styleMedallion(this.shortcutBtn, shortcutX, -28, 64, shortLabel, 'shortcut', spritePath, false, true);
        }
    }

    private onPrimaryPressed(): void {
        if (this.blockedTargetType > 0) {
            AudioManager.instance.playClick();
            this.callbacks.onSelectBuilding(this.blockedTargetType);
            return;
        }
        if (!this.primaryCanBuild) {
            AudioManager.instance.playClick();
            this.callbacks.onInspect(this.buildingType);
            return;
        }
        AudioManager.instance.playClick();
        const type = this.buildingType;
        const newlyBuilt = this.isNewBuild;
        this.hide();
        this.callbacks.onBuildStarted(type, newlyBuilt);
        MapUICommand.getInstance().upFacility(this.cityId, type);
    }

    private drawHeaderPill(w: number, h: number): void {
        const g = this.headerBg;
        g.clear();
        const hw = w * 0.5;
        const hh = h * 0.5;
        const cut = 9;

        // 投影
        g.fillColor = new Color(8, 9, 6, 120);
        this.bevel(g, w + 3, h + 3, cut, 0, -2.5);
        g.fill();

        // 墨漆主底 + 鎏金边框
        g.fillColor = new Color(18, 22, 17, 236);
        g.strokeColor = new Color(224, 190, 118, 232);
        g.lineWidth = 1.35;
        this.bevel(g, w, h, cut);
        g.fill();
        g.stroke();

        // 内框细金线
        g.strokeColor = new Color(214, 178, 104, 82);
        g.lineWidth = 0.9;
        this.bevel(g, w - 7, h - 7, cut - 2);
        g.stroke();

        // 标题与花费间极细分隔线
        g.strokeColor = new Color(204, 172, 104, 72);
        g.lineWidth = 0.8;
        g.moveTo(-hw + 20, 0);
        g.lineTo(hw - 20, 0);
        g.stroke();

        // 左右对称金菱饰
        g.fillColor = new Color(242, 210, 134, 215);
        for (const sx of [-hw + 12, hw - 12]) {
            g.moveTo(sx, 3.2);
            g.lineTo(sx + 3.2, 0);
            g.lineTo(sx, -3.2);
            g.lineTo(sx - 3.2, 0);
            g.close();
        }
        g.fill();
    }

    private styleMedallion(
        med: ActionMedallion,
        x: number,
        y: number,
        diameter: number,
        text: string,
        iconKind: 'info' | 'hammer' | 'goto' | 'shortcut',
        spriteIconPath: string | null,
        primary: boolean,
        enabled: boolean,
    ): void {
        place(med.node, x, y, diameter, diameter);
        const r = diameter * 0.5;
        const g = med.bg;
        g.clear();

        // 可操作主钮暖金光晕
        if (primary) {
            g.fillColor = new Color(248, 206, 112, 42);
            g.circle(0, 0, r + 5.5);
            g.fill();
        }

        // 立体投影
        g.fillColor = new Color(8, 9, 6, 128);
        g.circle(0, -3.5, r + 1.5);
        g.fill();

        // 汉铜玉质圆钮主体
        g.fillColor = primary
            ? new Color(156, 104, 38, 252)
            : enabled ? new Color(24, 32, 24, 246) : new Color(36, 39, 34, 226);
        g.strokeColor = primary
            ? new Color(255, 232, 154, 255)
            : enabled ? new Color(224, 190, 118, 242) : new Color(148, 142, 124, 175);
        g.lineWidth = primary ? 2.3 : 1.7;
        g.circle(0, 0, r);
        g.fill();
        g.stroke();

        // 上半圆玉质柔光
        g.fillColor = primary ? new Color(255, 242, 192, 46) : new Color(255, 246, 214, 22);
        g.ellipse(0, r * 0.34, r * 0.66, r * 0.32);
        g.fill();

        // 内圈装饰细环
        g.strokeColor = primary ? new Color(255, 246, 210, 178) : new Color(232, 202, 134, 96);
        g.lineWidth = 1.0;
        g.circle(0, 0, r - 4);
        g.stroke();

        if (spriteIconPath) {
            med.icon.clear();
            med.spriteNode.active = true;
            place(med.spriteNode, 0, 9, 28, 28);
            this.applySpriteIcon(med.sprite, spriteIconPath, 28, 28);
        } else {
            med.spriteNode.active = false;
            this.drawMedallionIcon(med.icon, iconKind, primary, enabled);
        }

        med.label.string = text;
        med.label.fontSize = primary ? 13 : 12;
        med.label.color = primary ? new Color(255, 248, 214, 255) : enabled ? new Color(246, 238, 214, 255) : MUTED_TEXT;
        place(med.label.node, 0, -r + 16, diameter - 6, 17);
        med.label.overflow = Label.Overflow.SHRINK;

        med.button.interactable = true;
    }

    private drawMedallionIcon(g: Graphics, kind: 'info' | 'hammer' | 'goto' | 'shortcut', primary: boolean, enabled: boolean): void {
        g.clear();
        const stroke = primary
            ? new Color(255, 248, 218, 255)
            : enabled ? new Color(248, 224, 158, 255) : new Color(180, 174, 156, 205);
        const cy = 9;

        if (kind === 'hammer') {
            g.strokeColor = stroke;
            g.lineWidth = 3.0;
            g.moveTo(-7.5, cy - 7.5);
            g.lineTo(3.8, cy + 3.8);
            g.stroke();
            g.fillColor = stroke;
            g.moveTo(-1.5, cy + 9.0);
            g.lineTo(2.4, cy + 10.6);
            g.lineTo(9.8, cy + 3.2);
            g.lineTo(8.2, cy - 0.8);
            g.lineTo(4.0, cy - 1.8);
            g.lineTo(-2.4, cy + 4.6);
            g.close();
            g.fill();
            return;
        }

        if (kind === 'info') {
            g.strokeColor = stroke;
            g.lineWidth = 1.65;
            g.roundRect(-7, cy - 6, 14, 15, 2.5);
            g.stroke();
            g.moveTo(-4, cy + 4);
            g.lineTo(4, cy + 4);
            g.moveTo(-4, cy);
            g.lineTo(4, cy);
            g.moveTo(-4, cy - 3.5);
            g.lineTo(1.5, cy - 3.5);
            g.stroke();
            return;
        }

        if (kind === 'goto') {
            g.strokeColor = stroke;
            g.lineWidth = 2.2;
            g.moveTo(-7, cy + 1);
            g.lineTo(6, cy + 1);
            g.moveTo(1.5, cy + 6);
            g.lineTo(6.5, cy + 1);
            g.lineTo(1.5, cy - 4);
            g.stroke();
            return;
        }

        // shortcut fallback：四叶汉纹菱标
        g.fillColor = stroke;
        g.moveTo(0, cy + 8.5);
        g.lineTo(6.5, cy + 1);
        g.lineTo(0, cy - 6.5);
        g.lineTo(-6.5, cy + 1);
        g.close();
        g.fill();
    }

    private createMedallion(name: string, onClick: () => void): ActionMedallion {
        const node = this.createNode(name, this.node);
        const bg = node.addComponent(Graphics);
        const iconNode = this.createNode('Icon', node);
        const icon = iconNode.addComponent(Graphics);
        const spriteNode = this.createNode('SpriteIcon', node);
        const sprite = spriteNode.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        spriteNode.active = false;
        const label = caption(node, 'Label', '', 0, -14, 58, 11, CityColors.paper, Label.HorizontalAlign.CENTER);
        label.isBold = true;
        label.outlineColor = new Color(16, 12, 6, 255);
        label.outlineWidth = 1.5;
        const button = node.addComponent(Button);
        button.target = node;
        button.transition = Button.Transition.SCALE;
        button.zoomScale = 0.93;
        button.duration = 0.08;
        node.on(Button.EventType.CLICK, onClick, this);
        return { node, bg, icon, spriteNode, sprite, label, button };
    }

    private preloadIcons(): void {
        const paths = [
            ...Object.values(RESOURCE_ICON_PATHS),
            ...Object.values(SHORTCUT_ICON_PATHS).filter((v): v is string => !!v),
        ];
        for (const p of paths) {
            this.loadIconFrame(p, () => {});
        }
    }

    private applySpriteIcon(sprite: Sprite, path: string, w: number, h: number): void {
        const cached = this.iconFrames.get(path);
        if (cached?.isValid) {
            sprite.spriteFrame = cached;
            sprite.node.getComponent(UITransform)?.setContentSize(w, h);
            return;
        }
        this.loadIconFrame(path, frame => {
            if (this.isValid && sprite?.isValid && frame?.isValid) {
                sprite.spriteFrame = frame;
                sprite.node.getComponent(UITransform)?.setContentSize(w, h);
            }
        });
    }

    private loadIconFrame(path: string, cb: (frame: SpriteFrame | null) => void): void {
        const cached = this.iconFrames.get(path);
        if (cached?.isValid) { cb(cached); return; }
        resources.load(`${path}/spriteFrame`, SpriteFrame, (err, frame) => {
            if (!err && frame instanceof SpriteFrame) {
                this.iconFrames.set(path, frame);
                cb(frame);
            } else {
                cb(null);
            }
        });
    }

    private compactNum(n: number): string {
        if (n >= 100000) return `${(n / 10000).toFixed(0)}万`;
        if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
        return `${n}`;
    }

    private bevel(g: Graphics, w: number, h: number, cut = 8, ox = 0, oy = 0): void {
        const hw = w * 0.5;
        const hh = h * 0.5;
        g.moveTo(ox - hw + cut, oy + hh);
        g.lineTo(ox + hw - cut, oy + hh);
        g.lineTo(ox + hw, oy + hh - cut);
        g.lineTo(ox + hw, oy - hh + cut);
        g.lineTo(ox + hw - cut, oy - hh);
        g.lineTo(ox - hw + cut, oy - hh);
        g.lineTo(ox - hw, oy - hh + cut);
        g.lineTo(ox - hw, oy + hh - cut);
        g.close();
    }

    private resourceBalances(): Array<{ k: number; v: number }> {
        const proxy = LoginCommand.getInstance().proxy;
        return [1, 2, 3, 4].map(k => ({ k, v: proxy.getItemCount(k) }));
    }

    private createNode(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        parent.addChild(node);
        node.addComponent(UITransform);
        return node;
    }
}
