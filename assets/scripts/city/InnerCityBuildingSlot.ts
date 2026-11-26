import {
    _decorator, Color, Component, Graphics, Label, Node, SpriteFrame,
    Tween, tween, UIOpacity, UITransform, Vec3,
} from 'cc';
import { FacilityConfig } from '../map/ui/MapUIProxy';
import { CityColors } from '../map/ui/CityBuildingView';
import { caption, place } from '../map/ui/ManagementStyle';
import { InnerCityConstructionFx } from './InnerCityConstructionFx';
import { InnerCityPlotSpec } from './InnerCityLayout';

const { ccclass } = _decorator;

const JADE_BRIGHT = new Color(172, 232, 152, 255);
const GOLD_BRIGHT = new Color(252, 226, 150, 255);
const GOLD_TRIM = new Color(218, 184, 112, 235);
const LOCKED_TEXT = new Color(204, 198, 178, 228);

export interface InnerCitySlotViewState {
    cfg: FacilityConfig | null;
    name: string;
    level: number;
    maxed: boolean;
    unlocked: boolean;
    canAct: boolean;
    enough: boolean;
    selected: boolean;
    known: boolean;
    lockHint: string;
}

/**
 * 一体化雄城全景中的单个建筑地标节点（《三国志·战略版》架构，彻底零贴纸感）：
 * - 建筑实体原生融入一体化城郭全景图，不再在草地上生硬叠加独立贴纸与方框地垫；
 * - 画布层负责：选中金光地标光环、建筑灯火呼吸微光、可建双锤徽章与多锤齐敲施工庆典；
 * - 铭牌挂载至 1:1 屏幕空间覆盖层（PlaqueOverlayLayer），无论远景俯瞰或近景缩放均锐利清晰。
 */
@ccclass('InnerCityBuildingSlot')
export default class InnerCityBuildingSlot extends Component {
    public spec!: InnerCityPlotSpec;

    private selectionRing!: Node;
    private selectionRingGraphics!: Graphics;
    private selectionRingOpacity!: UIOpacity;
    private lanternGraphics!: Graphics;
    private constructionFx!: InnerCityConstructionFx;

    /** 挂载到屏幕空间覆盖层的 1:1 清晰铭牌节点 */
    private plaqueNode!: Node;
    private plaqueBg!: Graphics;
    private levelChipLabel!: Label;
    private plaqueLabel!: Label;
    private upgradeBadge!: Node;
    private upgradeBadgeGraphics!: Graphics;
    private upgradeBadgeLabel!: Label;
    private toastNode: Node | null = null;

    private pulsePhase = 0;
    private lanternPhase = 0;
    private isSelected = false;
    private isUpgradeable = false;
    private hasActiveLanterns = false;
    private appliedArtKey = '';
    private plaqueWidth = 96;
    private plaqueHeight = 25;
    private plaqueScreenX = 0;
    private plaqueScreenY = 0;
    private state: InnerCitySlotViewState | null = null;

    public initialize(spec: InnerCityPlotSpec, plaqueParent?: Node): void {
        this.spec = spec;
        this.node.name = `BuildingSlot_${spec.type}`;
        this.lanternPhase = (spec.type * 1.13) % (Math.PI * 2);
        const ui = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        ui.setAnchorPoint(0.5, 0.5);
        ui.setContentSize(spec.width, spec.height);

        // 1. 建筑地标选中流光金环（2:1 等距建筑光晕）
        this.selectionRing = this.createChild('SelectionHalo', this.node);
        this.selectionRingGraphics = this.selectionRing.addComponent(Graphics);
        this.selectionRingOpacity = this.selectionRing.addComponent(UIOpacity);
        this.selectionRing.active = false;

        // 2. 建筑灯火/炉火呼吸微光层
        const lanternNode = this.createChild('LanternGlow', this.node);
        this.lanternGraphics = lanternNode.addComponent(Graphics);

        // 3. 多锤齐敲施工脚手架与竣工光柱动效（原生覆盖在城郭真实建筑区上）
        const fxNode = this.createChild('ConstructionFx', this.node);
        this.constructionFx = fxNode.addComponent(InnerCityConstructionFx);
        this.constructionFx.initialize(spec.width, spec.height, spec.groundOffsetY);

        // 4. 1:1 屏幕空间锐利汉铜漆金铭牌
        const host = plaqueParent || this.node;
        this.plaqueNode = this.createChild(`NamePlaque_${spec.type}`, host);
        this.plaqueBg = this.plaqueNode.addComponent(Graphics);

        this.levelChipLabel = caption(this.plaqueNode, 'LevelChip', '', 0, 0, 32, 12, GOLD_BRIGHT, Label.HorizontalAlign.CENTER);
        this.levelChipLabel.isBold = true;
        this.levelChipLabel.node.active = false;

        this.plaqueLabel = caption(this.plaqueNode, 'Label', spec.fallbackName, 0, 0, 140, 13, CityColors.paper, Label.HorizontalAlign.CENTER);
        this.plaqueLabel.isBold = true;
        this.plaqueLabel.outlineColor = new Color(10, 8, 5, 255);
        this.plaqueLabel.outlineWidth = 1.8;

        this.upgradeBadge = this.createChild('UpgradeBadge', this.plaqueNode);
        this.upgradeBadgeGraphics = this.upgradeBadge.addComponent(Graphics);
        this.upgradeBadgeLabel = caption(this.upgradeBadge, 'Arrow', '▲', 0, 0, 16, 9, new Color(18, 30, 16, 255), Label.HorizontalAlign.CENTER);
        this.upgradeBadgeLabel.isBold = true;
        this.upgradeBadge.active = false;
    }

    /** 兼容接口：保留艺术路径记录以供详情抽屉使用，不再往一体化城郭上贴独立贴纸。 */
    public applySpriteFrame(key: string, _frame: SpriteFrame): void {
        this.appliedArtKey = key;
    }

    public get artKey(): string {
        return this.appliedArtKey;
    }

    /** 将 1:1 屏幕空间铭牌同步到当前建筑区对应的屏幕坐标。 */
    public syncPlaqueScreenPosition(screenX: number, screenY: number, viewW: number, viewH: number): void {
        if (!this.plaqueNode?.isValid) return;
        const offsetY = this.spec.plaqueOffsetY ?? -18;
        const px = Math.round(screenX);
        const py = Math.round(screenY + offsetY);
        this.plaqueScreenX = px;
        this.plaqueScreenY = py;
        const inBounds = Math.abs(px) <= viewW * 0.5 + 80 && Math.abs(py) <= viewH * 0.5 + 40;
        this.plaqueNode.active = inBounds;
        if (inBounds) {
            this.plaqueNode.setPosition(px, py, 0);
        }
    }

    /** 检测屏幕局部坐标（以视口中心为原点）是否直接点中 1:1 屏幕空间铭牌。 */
    public containsPlaqueScreenPoint(screenX: number, screenY: number): boolean {
        if (!this.plaqueNode?.isValid || !this.plaqueNode.active) return false;
        const halfW = this.plaqueWidth * 0.5 + 8;
        const halfH = this.plaqueHeight * 0.5 + 8;
        return Math.abs(screenX - this.plaqueScreenX) <= halfW
            && Math.abs(screenY - this.plaqueScreenY) <= halfH;
    }

    public applyState(state: InnerCitySlotViewState): void {
        this.state = state;
        this.isSelected = state.selected;
        this.isUpgradeable = state.known && state.canAct && !state.maxed;

        const built = state.level > 0;
        const buildable = !built && state.unlocked;
        const locked = !built && !state.unlocked;
        this.hasActiveLanterns = built && !!(this.spec.lanternPoints && this.spec.lanternPoints.length > 0);
        if (!this.hasActiveLanterns) this.lanternGraphics.clear();

        // 可建造地块上方悬浮精致双锤徽章
        this.constructionFx?.setBuildableHint(state.known && buildable);

        // 选中光环
        this.selectionRing.active = state.selected;
        if (state.selected) {
            this.drawSelectionHalo();
        }

        // 1:1 屏幕空间锐利铭牌（已建：金印等级+建筑名+可升绿标；可建：翡翠+印+建筑名；未解锁：轻透墨玉小牌）
        const badgeActive = built && this.isUpgradeable;
        this.upgradeBadge.active = badgeActive;

        const showLevelChip = state.known && (built || buildable);
        const chipW = showLevelChip ? 24 : 0;
        const text = state.name;

        const badgePad = badgeActive ? 20 : 0;
        const fontSize = locked ? 12 : 13;
        const charW = locked ? 12.5 : 14.0;
        const nameW = Math.max(44, Math.round(text.length * charW + 14));
        const pillWidth = Math.max(70, Math.min(156, nameW + chipW + badgePad + (showLevelChip ? 12 : 8)));
        const pillHeight = locked ? 22 : 26;
        this.plaqueWidth = pillWidth;
        this.plaqueHeight = pillHeight;
        this.plaqueNode.getComponent(UITransform)!.setContentSize(pillWidth, pillHeight);
        this.drawPlaque(pillWidth, pillHeight, built, buildable, state.selected, chipW);

        this.levelChipLabel.node.active = showLevelChip;
        if (showLevelChip) {
            this.levelChipLabel.string = built ? `${state.level}` : '+';
            this.levelChipLabel.fontSize = built ? 12 : 14;
            this.levelChipLabel.color = state.selected
                ? new Color(34, 22, 8, 255)
                : built ? GOLD_BRIGHT : new Color(18, 38, 20, 255);
            place(this.levelChipLabel.node, -pillWidth * 0.5 + 3 + chipW * 0.5, 0, chipW, 20);
            this.levelChipLabel.overflow = Label.Overflow.SHRINK;
        }

        const textLeft = -pillWidth * 0.5 + (showLevelChip ? chipW + 7 : 6);
        const textRight = pillWidth * 0.5 - (badgeActive ? 21 : 6);
        const textCenterX = (textLeft + textRight) * 0.5;
        const textWidth = Math.max(36, textRight - textLeft);
        this.plaqueLabel.string = text;
        this.plaqueLabel.fontSize = fontSize;
        this.plaqueLabel.color = state.selected
            ? GOLD_BRIGHT
            : built ? new Color(250, 242, 222, 255) : buildable ? JADE_BRIGHT : LOCKED_TEXT;
        place(this.plaqueLabel.node, textCenterX, 0, textWidth, 21);
        this.plaqueLabel.overflow = Label.Overflow.SHRINK;

        if (badgeActive) {
            const bx = pillWidth * 0.5 - 12;
            this.upgradeBadge.setPosition(bx, 0, 0);
            this.drawUpgradeBadge(built);
        }
    }

    /** 选中时的铭牌轻弹性反馈。 */
    public playSelectBounce(): void {
        if (!this.plaqueNode?.isValid) return;
        Tween.stopAllByTarget(this.plaqueNode);
        this.plaqueNode.setScale(1, 1, 1);
        tween(this.plaqueNode)
            .to(0.09, { scale: new Vec3(1.09, 1.09, 1) }, { easing: 'quadOut' })
            .to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }

    /** 点击建造/升级按钮后立即启动木架脚手架 + 多把大锤齐敲施工动效。 */
    public beginConstruction(isNewBuild: boolean): void {
        if (!this.isValid || !this.constructionFx?.isValid) return;
        this.constructionFx.beginConstruction(isNewBuild, () => {
            this.playHammerPulse();
        });
    }

    /** 服务端确认建造/升级完成：顺滑收束多锤齐敲并爆发金色天光柱与落成喜报。 */
    public playConstructionUpgrade(name: string, fromLv: number, toLv: number): void {
        if (!this.isValid) return;
        if (!this.constructionFx?.isValid) {
            this.playUpgradeCelebration(name, fromLv, toLv);
            return;
        }
        this.constructionFx.finishConstruction(
            name,
            fromLv,
            toLv,
            () => this.playHammerPulse(),
            undefined,
            () => this.playUpgradeCelebration(name, fromLv, toLv),
        );
    }

    /** 退出内城时清理进行中的施工动效。 */
    public cancelConstruction(): void {
        this.constructionFx?.cancelConstruction();
        if (this.plaqueNode?.isValid) {
            Tween.stopAllByTarget(this.plaqueNode);
            this.plaqueNode.setScale(1, 1, 1);
        }
    }

    private playHammerPulse(): void {
        if (!this.plaqueNode?.isValid || !this.plaqueNode.active) return;
        Tween.stopAllByTarget(this.plaqueNode);
        tween(this.plaqueNode)
            .to(0.04, { scale: new Vec3(1.06, 0.95, 1) }, { easing: 'quadOut' })
            .to(0.10, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }

    /** 建造或升级成功时的落成浮空喜报。 */
    public playUpgradeCelebration(name: string, fromLv: number, toLv: number): void {
        if (!this.isValid) return;
        this.playSelectBounce();
        if (!this.toastNode?.isValid) {
            this.toastNode = this.createChild('UpgradeBurstToast', this.node);
            this.toastNode.addComponent(UIOpacity);
            this.toastNode.addComponent(Graphics);
            const label = caption(this.toastNode, 'Label', '', 0, 0, 220, 18, GOLD_BRIGHT, Label.HorizontalAlign.CENTER);
            label.isBold = true;
            label.outlineColor = new Color(18, 12, 6, 255);
            label.outlineWidth = 2.2;
        }
        const toast = this.toastNode;
        toast.active = true;
        toast.setSiblingIndex(this.node.children.length - 1);
        const text = fromLv <= 0 ? `${name} 落成！` : `${name} 升至 ${toLv} 级！`;
        const label = toast.getChildByName('Label')?.getComponent(Label);
        if (label) label.string = text;
        const w = Math.max(196, text.length * 18 + 44);
        const h = 40;
        const g = toast.getComponent(Graphics)!;
        g.clear();
        g.fillColor = new Color(22, 26, 20, 246);
        g.strokeColor = new Color(244, 210, 126, 250);
        g.lineWidth = 1.8;
        this.bevel(g, w, h, 8);
        g.fill();
        g.stroke();

        const opacity = toast.getComponent(UIOpacity)!;
        Tween.stopAllByTarget(toast);
        Tween.stopAllByTarget(opacity);
        const startY = this.spec.height * 0.20;
        toast.setPosition(0, startY, 0);
        toast.setScale(0.84, 0.84, 1);
        opacity.opacity = 0;
        tween(toast)
            .to(0.18, { scale: new Vec3(1, 1, 1), position: new Vec3(0, startY + 28, 0) }, { easing: 'backOut' })
            .delay(0.95)
            .to(0.35, { position: new Vec3(0, startY + 64, 0) }, { easing: 'quadIn' })
            .call(() => { if (toast.isValid) toast.active = false; })
            .start();
        tween(opacity)
            .to(0.15, { opacity: 255 })
            .delay(0.95)
            .to(0.35, { opacity: 0 })
            .start();
    }

    /** 检查画布坐标系中的点是否命中本建筑区（方正院落精准拾取）。 */
    public containsCanvasPoint(canvasX: number, canvasY: number): boolean {
        const dx = Math.abs(canvasX - this.node.position.x);
        const dy = Math.abs(canvasY - this.node.position.y);
        return dx <= this.spec.width * 0.48 && dy <= this.spec.height * 0.46;
    }

    protected update(dt: number): void {
        const clampedDt = Math.min(0.05, Math.max(0, dt));
        if (this.isSelected || this.isUpgradeable) {
            this.pulsePhase += clampedDt * 2.8;
            if (this.isSelected && this.selectionRing?.isValid && this.selectionRing.active) {
                const wave = 0.5 + 0.5 * Math.sin(this.pulsePhase);
                this.selectionRingOpacity.opacity = Math.round(145 + wave * 95);
                const s = 0.985 + wave * 0.03;
                this.selectionRing.setScale(s, s, 1);
            }
            if (this.isUpgradeable && this.upgradeBadge?.isValid && this.upgradeBadge.active) {
                const lift = Math.sin(this.pulsePhase * 1.15) * 1.4;
                this.upgradeBadge.setPosition(this.upgradeBadge.position.x, lift, 0);
            }
        }
        if (this.hasActiveLanterns) {
            this.lanternPhase += clampedDt * 2.0;
            this.drawLanternGlows();
        }
    }

    /** 计算建筑地标 2:1 等距光环几何中心（用于选中高亮与施工对齐）。 */
    private footprintMetrics(): { cy: number; rx: number; ry: number } {
        const rx = this.spec.width * 0.46;
        const ry = rx * 0.50;
        return { cy: this.spec.groundOffsetY, rx, ry };
    }

    private drawLanternGlows(): void {
        const g = this.lanternGraphics;
        if (!g?.isValid || !this.spec.lanternPoints) return;
        g.clear();
        const pulse = 0.72 + 0.28 * Math.sin(this.lanternPhase);
        for (const pt of this.spec.lanternPoints) {
            const lx = pt.rx * this.spec.width;
            const ly = pt.ry * this.spec.height;
            const r = (pt.radius || 18) * (0.94 + 0.08 * pulse);
            g.fillColor = new Color(255, 200, 96, Math.round(32 * pulse));
            g.circle(lx, ly, r);
            g.fill();
            g.fillColor = new Color(255, 232, 160, Math.round(58 * pulse));
            g.circle(lx, ly, r * 0.44);
            g.fill();
        }
    }

    private drawSelectionHalo(): void {
        const g = this.selectionRingGraphics;
        g.clear();
        const w = this.spec.width * 0.90;
        const h = this.spec.height * 0.84;
        const cy = this.spec.groundOffsetY;
        g.fillColor = new Color(250, 214, 124, 24);
        this.bevel(g, w, h, 14, 0, cy);
        g.fill();
        g.strokeColor = new Color(252, 224, 146, 238);
        g.lineWidth = 2.4;
        this.bevel(g, w, h, 14, 0, cy);
        g.stroke();
        g.strokeColor = new Color(255, 244, 202, 130);
        g.lineWidth = 1.1;
        this.bevel(g, w + 10, h + 10, 16, 0, cy);
        g.stroke();
    }

    private drawPlaque(width: number, height: number, built: boolean, buildable: boolean, selected: boolean, chipW: number): void {
        const g = this.plaqueBg;
        g.clear();
        const hw = width * 0.5;
        const hh = height * 0.5;
        const cut = built || buildable ? 6 : 5;

        // 未解锁且未选中：极轻通透墨玉小签，让山水城郭建筑留白舒展
        if (!built && !buildable && !selected) {
            g.fillColor = new Color(18, 22, 17, 146);
            g.strokeColor = new Color(178, 168, 138, 102);
            g.lineWidth = 0.85;
            this.bevel(g, width, height, cut);
            g.fill();
            g.stroke();
            return;
        }

        // 铭牌柔影
        g.fillColor = new Color(6, 8, 5, 112);
        this.bevel(g, width + 2, height + 2, cut, 0, -1.5);
        g.fill();

        // 清爽汉铜墨玉切角铭牌 + 鎏金细框
        g.fillColor = selected
            ? new Color(82, 58, 24, 244)
            : built
                ? new Color(18, 23, 18, 214)
                : new Color(20, 42, 24, 218);
        g.strokeColor = selected
            ? GOLD_BRIGHT
            : buildable
                ? new Color(162, 224, 144, 232)
                : GOLD_TRIM;
        g.lineWidth = selected ? 1.55 : 1.05;
        this.bevel(g, width, height, cut);
        g.fill();
        g.stroke();

        // 上沿鎏金微高光线
        g.strokeColor = selected ? new Color(255, 244, 198, 178) : new Color(242, 214, 148, 86);
        g.lineWidth = 0.9;
        g.moveTo(-hw + cut + 3, hh - 2);
        g.lineTo(hw - cut - 3, hh - 2);
        g.stroke();

        // 左侧独立切角等级盾印
        if (chipW > 0) {
            const chipCenterX = -hw + 3 + chipW * 0.5;
            const chipH = height - 5;
            g.fillColor = selected
                ? GOLD_BRIGHT
                : built
                    ? new Color(124, 90, 38, 250)
                    : new Color(138, 210, 124, 250);
            g.strokeColor = selected
                ? new Color(255, 248, 216, 235)
                : new Color(236, 202, 124, 200);
            g.lineWidth = 0.9;
            this.bevel(g, chipW, chipH, 4, chipCenterX, 0);
            g.fill();
            g.stroke();
        }
    }

    private drawUpgradeBadge(built: boolean): void {
        const g = this.upgradeBadgeGraphics;
        g.clear();
        g.fillColor = new Color(156, 228, 134, 58);
        g.circle(0, 0, 10);
        g.fill();
        g.fillColor = built ? new Color(158, 224, 134, 255) : new Color(246, 208, 118, 255);
        g.circle(0, 0, 7.2);
        g.fill();
        g.strokeColor = new Color(255, 250, 226, 235);
        g.lineWidth = 1.0;
        g.circle(0, 0, 7.2);
        g.stroke();
    }

    private bevel(g: Graphics, w: number, h: number, cut = 6, ox = 0, oy = 0): void {
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

    private diamond(g: Graphics, cx: number, cy: number, rx: number, ry: number): void {
        g.moveTo(cx, cy + ry);
        g.lineTo(cx + rx, cy);
        g.lineTo(cx, cy - ry);
        g.lineTo(cx - rx, cy);
        g.close();
    }

    private createChild(name: string, parent: Node): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        parent.addChild(node);
        node.addComponent(UITransform);
        return node;
    }
}
