import { _decorator, Component, EditBox, EventTouch, Node, Sprite, SpriteFrame, Label, UIOpacity, UITransform, tween, Tween, Vec3, Color, resources, Prefab, instantiate, director, Canvas, Layers, isValid } from 'cc';
import { EventMgr } from "../utils/EventMgr";
import { LogicEvent } from "../common/LogicEvent";
import ConfigManager from "../core/ConfigManager";
import { getGeneralPortraitPath } from '../general/GeneralPortrait';
import { Button, BlockInputEvents, Graphics, view } from 'cc';
import { caption, hideSprite, inkSurface, panelButton, place, textStyle, ManagementColors as C } from '../map/ui/ManagementStyle';
import { itemGlyph, itemIconPath, itemName } from '../common/ItemPresentation';

const { ccclass } = _decorator;

export interface RewardInfo {
    rewardType: number;
    itemId: number;
    itemCount: number;
}

const FX_GOLD = new Color(255, 224, 152, 255);
const FX_GOLD_BRIGHT = new Color(255, 236, 184, 255);
const TITLE_OUTLINE = new Color(38, 24, 10, 255);
const TEXT_OUTLINE = new Color(14, 18, 16, 235);
const COUNT_OUTLINE = new Color(34, 21, 8, 245);
const MIN_VISIBLE_TIME = 0.55;

interface RewardVisualTone {
    accent: readonly [number, number, number];
    cardFill: readonly [number, number, number];
    mountFill: readonly [number, number, number];
    nameColor: Color;
    highQuality: boolean;
}

const QUALITY_TONES: readonly RewardVisualTone[] = [
    { accent: [204, 174, 118], cardFill: [26, 31, 29], mountFill: [32, 34, 29], nameColor: new Color(240, 232, 212, 255), highQuality: false },
    { accent: [198, 174, 126], cardFill: [26, 31, 29], mountFill: [32, 34, 29], nameColor: new Color(240, 232, 212, 255), highQuality: false },
    { accent: [118, 208, 152], cardFill: [22, 36, 31], mountFill: [24, 42, 35], nameColor: new Color(206, 244, 218, 255), highQuality: false },
    { accent: [114, 186, 252], cardFill: [20, 32, 46], mountFill: [22, 37, 56], nameColor: new Color(202, 232, 255, 255), highQuality: true },
    { accent: [200, 146, 248], cardFill: [36, 24, 48], mountFill: [44, 29, 59], nameColor: new Color(236, 210, 255, 255), highQuality: true },
    { accent: [255, 210, 114], cardFill: [48, 34, 20], mountFill: [58, 42, 22], nameColor: new Color(255, 238, 186, 255), highQuality: true },
];

const rgb = (v: readonly [number, number, number], alpha = 255) => new Color(v[0], v[1], v[2], alpha);

const blendRgb = (a: readonly [number, number, number], b: readonly [number, number, number], weight: number, alpha = 255) =>
    new Color(
        Math.round(a[0] * weight + b[0] * (1 - weight)),
        Math.round(a[1] * weight + b[1] * (1 - weight)),
        Math.round(a[2] * weight + b[2] * (1 - weight)),
        alpha,
    );

/** 奖励占据画面中心；采用开放式横幅舞台，空间不足时分页，避免缩小图标和文字。 */
export function rewardWindowLayout(count: number, visibleWidth: number, visibleHeight: number) {
    const total = Math.max(1, count);
    const maxWidth = Math.min(900, Math.max(1, visibleWidth - 32));
    const maxHeight = Math.max(1, visibleHeight - 32);
    const preferredWidth = total === 1 ? Math.min(540, Math.max(420, visibleWidth * .56)) : Math.max(520, visibleWidth * .68);
    const width = Math.min(maxWidth, preferredWidth);
    const narrow = visibleWidth < 600, short = visibleHeight < 440;
    const columnGap = narrow ? 14 : 28, rowGap = short ? 14 : 16, navHeight = 40;
    const columns = Math.min(total, Math.max(1, Math.min(4,
        Math.floor((width - 32 + columnGap) / ((narrow ? 112 : 156) + columnGap)))));
    const headerHeight = visibleHeight < 280 ? 60 : short ? 76 : 112;
    const footerHeight = visibleHeight < 280 ? 34 : short ? 46 : 64;
    const available = maxHeight - headerHeight - footerHeight - (total > columns ? navHeight : 0);
    const cardHeight = Math.min(216, Math.max(60, available));
    const capacityRows = Math.max(1, Math.min(2,
        Math.floor((available + rowGap) / (cardHeight + rowGap))));
    const rows = Math.min(capacityRows, Math.ceil(total / columns));
    const pageSize = columns * rows, paged = total > pageSize;
    const contentHeight = rows * cardHeight + (rows - 1) * rowGap;
    return { width, height: headerHeight + contentHeight + footerHeight + (paged ? navHeight : 0),
        columns, rows, pageSize, cardWidth: Math.min(184, (width - 32 - (columns - 1) * columnGap) / columns),
        cardHeight, contentHeight, headerHeight, footerHeight, paged, columnGap, rowGap, short, navHeight };
}

export function rewardItemLayout(width: number, height: number) {
    const horizontal = height < 124;
    const tall = height >= 204;
    const topPad = tall ? 10 : 6, nameOffset = tall ? 58 : 55, countOffset = tall ? 22 : 20;
    const icon = horizontal ? Math.min(48, height - 12, width * .4) : Math.min(126, width - 20, height - topPad - nameOffset - 18);
    return { horizontal, icon, iconX: horizontal ? -width / 2 + icon / 2 + 8 : 0,
        iconY: horizontal ? 0 : height / 2 - topPad - icon / 2,
        textX: horizontal ? icon / 2 + 6 : 0,
        textWidth: horizontal ? width - icon - 20 : width - 12,
        nameY: horizontal ? 14 : -height / 2 + nameOffset,
        countY: horizontal ? -12 : -height / 2 + countOffset,
        nameSize: horizontal ? 14 : 18, countSize: horizontal ? 19 : 25 };
}

const REWARD_TYPE_ITEM = 1;
const REWARD_TYPE_RES = 2;
const REWARD_TYPE_HERO = 3;
const REWARD_TYPE_SOLDIER = 4;
const REWARD_TYPE_CONVERT_ITEM = 6;

@ccclass('RewardWindowLogic')
export default class RewardWindowLogic extends Component {
    private static _current: RewardWindowLogic | null = null;
    private static _loading = false;
    private static _queue: RewardInfo[][] = [];
    private static _inited = false;

    /** 放在启动流程里调用一次，监听奖励展示事件 */
    public static init(): void {
        if (this._inited) {
            return;
        }
        this._inited = true;
        EventMgr.on(LogicEvent.showReward, this.onShowReward, this);
    }

    private static onShowReward(list: RewardInfo[]): void {
        this.show(list);
    }

    public static show(list: RewardInfo[]): void {
        if (!list || !list.length) {
            return;
        }
        if (this._current && this._current.isValid) {
            this._current.play(list, this._current.node.active);
            return;
        }
        if (this._loading) {
            this._queue.push(list);
            return;
        }

        this._loading = true;
        resources.load('prefab/RewardWindow', Prefab, (error: Error, prefab: Prefab) => {
            this._loading = false;
            if (error || !prefab) {
                console.error('RewardWindow prefab load failed:', error);
                return;
            }
            const node = instantiate(prefab);
            const canvas = director.getScene()?.getComponentInChildren(Canvas);
            const parent = canvas ? canvas.node : director.getScene();
            if (!parent) {
                node.destroy();
                return;
            }
            parent.addChild(node);
            node.setPosition(0, 0, 0);
            const mapUI = parent.getChildByName('MapUIScene');
            this.applyLayer(node, mapUI ? mapUI.layer : Layers.Enum.UI_3D);

            const logic = node.getComponent(RewardWindowLogic);
            if (!logic) {
                node.destroy();
                return;
            }
            this._current = logic;
            logic.play(list, false);

            while (this._queue.length) {
                const next = this._queue.shift();
                if (next) {
                    logic.play(next, true);
                }
            }
        });
    }

    private static blurFocusedInputs(): void {
        const scene = director.getScene();
        if (!scene) {
            return;
        }
        const visit = (node: Node) => {
            for (const box of node.getComponents(EditBox)) {
                if (box && box.isValid && box.isFocused()) {
                    box.blur();
                }
            }
            for (const child of node.children) {
                visit(child);
            }
        };
        visit(scene);
    }

    private static applyLayer(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) {
            this.applyLayer(child, layer);
        }
    }

    private rewards: RewardInfo[] = [];
    private content: Node | null = null;
    private templateNode: Node | null = null;
    private panel: Node | null = null;
    private confirm: Node | null = null;
    private veil: Node | null = null;
    private opacity: UIOpacity | null = null;
    private titleNode: Node | null = null;
    private subtitleNode: Node | null = null;
    private dividerNode: Node | null = null;
    private itemNodes: Node[] = [];
    private closing = false;
    private playToken = 0;
    private itemGeneration = 0;
    private shownAt = 0;
    private previousButton: Node;
    private nextButton: Node;
    private pageLabel: Label;
    private page = 0;
    private pageSize = 4;
    private layout = rewardWindowLayout(1, 1280, 720);
    private glow: Node;
    private rays: Node;
    private motes: Graphics;
    private fxTime = 1;

    protected onLoad(): void {
        this.opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        this.panel = this.node.getChildByName('Panel');
        this.veil = this.node.getChildByName('Veil');
        this.confirm = this.panel?.getChildByName('Confirm');
        this.content = this.panel?.getChildByName('Content');
        this.titleNode = this.panel?.getChildByName('Title');
        this.subtitleNode = this.panel?.getChildByName('Subtitle');
        this.dividerNode = this.panel?.getChildByName('Divider');
        this.templateNode = this.content?.getChildByName('ItemTemplate');
        if (!this.panel || !this.veil || !this.confirm || !this.content || !this.templateNode
            || !this.titleNode || !this.subtitleNode || !this.dividerNode) {
            throw new Error('RewardWindow 预制体缺少必要的展示节点');
        }
        this.templateNode.active = false;
        hideSprite(this.panel); hideSprite(this.veil); hideSprite(this.dividerNode);
        this.veil.on(Node.EventType.TOUCH_END, this.onBackdropClick, this);
        this.panel.on(Node.EventType.TOUCH_END, this.onPanelTouch, this);
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        const button = (name: string, action: () => void) => {
            const node = this.createNode(name, this.panel, 72, 30, 0, 0);
            node.addComponent(Button);
            node.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; });
            node.on(Button.EventType.CLICK, action, this);
            return node;
        };
        this.previousButton = button('PreviousPage', () => this.changePage(-1));
        this.nextButton = button('NextPage', () => this.changePage(1));
        this.pageLabel = caption(this.panel, 'PageNumber', '', 0, 0, 70, 12, C.muted, Label.HorizontalAlign.CENTER);
        this.glow = this.createNode('RewardHalo', this.panel, 1, 1, 0, 0);
        this.glow.addComponent(Graphics); this.glow.setSiblingIndex(0);
        this.rays = this.createNode('RewardRays', this.panel, 1, 1, 0, 0);
        this.rays.addComponent(Graphics); this.rays.setSiblingIndex(1);
        this.motes = this.createNode('RewardMotes', this.panel, 1, 1, 0, 0).addComponent(Graphics);
        // 保留预制体节点引用，奖励到账后只需点击遮罩关闭。
        this.confirm.active = false;
        this.node.active = false;
    }

    protected onEnable(): void {
        view.on('canvas-resize', this.onResize, this);
        view.on('design-resolution-changed', this.onResize, this);
    }

    protected onDisable(): void {
        view.off('canvas-resize', this.onResize, this);
        view.off('design-resolution-changed', this.onResize, this);
        this.playToken++;
        this.itemGeneration++;
        this.stopAnimations();
    }

    protected onDestroy(): void {
        this.onDisable();
        if (RewardWindowLogic._current === this) RewardWindowLogic._current = null;
    }

    public play(list: RewardInfo[], append: boolean): void {
        if (!list?.length) return;
        const continuing = append && this.node.active && !this.closing;
        const firstReward = continuing ? this.page * this.pageSize : 0;
        this.playToken++;
        this.stopAnimations();
        if (!continuing) RewardWindowLogic.blurFocusedInputs();
        this.rewards = continuing ? this.rewards.concat(list) : list.slice();
        this.node.active = true;
        this.closing = false;
        if (!continuing) this.shownAt = Date.now();
        this.layoutWindow();
        this.page = Math.min(Math.floor(firstReward / this.pageSize), Math.max(0, Math.ceil(this.rewards.length / this.pageSize) - 1));
        if (this.node.parent) this.node.setSiblingIndex(this.node.parent.children.length - 1);
        this.buildItems();
        this.confirm.active = false;
        this.finishReveal();
        // 内容不等待特效或图标加载。连续到账只更新当前阅读页，不闪黑、不重播。
        if (!continuing) this.animateIn();
    }

    private onBackdropClick(event?: EventTouch): void {
        if (event) event.propagationStopped = true;
        if (Date.now() - this.shownAt < MIN_VISIBLE_TIME * 1000) return;
        this.dismiss();
    }

    private onPanelTouch(event: EventTouch): void {
        // 参考主流 SLG 奖励弹窗：点击非翻页按钮的空白区域即可直接关闭。
        this.onBackdropClick(event);
    }

    private dismiss(): void {
        if (this.closing || !this.node.active) return;
        this.closing = true;
        const token = ++this.playToken;
        this.stopAnimations();
        const close = () => {
            if (isValid(this, true) && token === this.playToken && this.closing) this.node.active = false;
        };
        if (this.opacity) tween(this.opacity).to(.12, { opacity: 0 }).call(close).start();
        else close();
    }

    private stopAnimations(): void {
        this.unscheduleAllCallbacks();
        this.fxTime = 1;
        if (this.motes) this.motes.clear();
        for (const node of [this.node, this.panel, this.glow, this.rays, this.titleNode, ...this.itemNodes]) {
            if (!isValid(node, true)) continue;
            Tween.stopAllByTarget(node);
            const opacity = node.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
        }
    }

    private finishReveal(): void {
        this.stopAnimations();
        if (this.opacity) this.opacity.opacity = 255;
        if (this.panel) {
            this.panel.setScale(1, 1, 1);
            this.ensureOpacity(this.panel).opacity = 255;
        }
        for (const fx of [this.glow, this.rays]) if (fx) this.ensureOpacity(fx).opacity = 0;
        if (this.titleNode) { this.titleNode.setScale(1, 1, 1); this.ensureOpacity(this.titleNode).opacity = 255; }
        for (const cell of this.itemNodes) {
            cell.setScale(1, 1, 1); this.ensureOpacity(cell).opacity = 255;
        }
    }

    private animateIn(): void {
        this.panel.setScale(.96, .96, 1);
        const opacity = this.ensureOpacity(this.panel); opacity.opacity = 0;
        tween(this.panel).to(.3, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicOut' }).start();
        tween(opacity).to(.18, { opacity: 255 }).start();
        if (this.titleNode) {
            this.titleNode.setScale(.94, .94, 1);
            tween(this.titleNode).to(.36, { scale: new Vec3(1, 1, 1) }, { easing: 'cubicOut' }).start();
        }
        for (const [i, cell] of this.itemNodes.entries()) {
            const delay = .08 + Math.min(i, 7) * .035;
            const alpha = this.ensureOpacity(cell); alpha.opacity = 0;
            cell.setScale(.82, .82, 1);
            tween(cell).delay(delay).to(.2, { scale: new Vec3(1.035, 1.035, 1) }, { easing: 'cubicOut' })
                .to(.14, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }).start();
            tween(alpha).delay(delay).to(.16, { opacity: 255 }).start();
        }
        for (const fx of [this.glow, this.rays]) if (fx) {
            const alpha = this.ensureOpacity(fx); alpha.opacity = 0;
            fx.setScale(.6, .6, 1);
            tween(fx).to(.65, { scale: new Vec3(1.1, 1.1, 1) }, { easing: 'cubicOut' }).start();
            tween(alpha).to(.16, { opacity: 210 }).to(.65, { opacity: 0 }, { easing: 'sineOut' }).start();
        }
        this.fxTime = 0;
    }

    protected update(dt: number): void {
        if (!this.motes || this.fxTime >= 1 || this.closing) return;
        this.fxTime = Math.min(1, this.fxTime + Math.min(dt, .05));
        const t = this.fxTime, g = this.motes; g.clear();
        if (t >= 1) return;
        // 一次性十二枚金屑，不循环，也不以特效完成作为奖励到账条件。
        for (let i = 0; i < 12; i++) {
            const phase = Math.max(0, Math.min(1, (t - (i % 4) * .035) / .85));
            const alpha = Math.round(Math.sin(phase * Math.PI) * 170);
            const x = ((i * 73 % 211) / 211 - .5) * this.layout.width * .85;
            const y = this.layout.height / 2 - 62 - (i % 3) * 28 + phase * (35 + i * 2);
            const r = i % 3 === 0 ? 2 : 1;
            g.fillColor = new Color(255, 222, 155, alpha);
            g.moveTo(x, y + r * 2); g.lineTo(x + r, y); g.lineTo(x, y - r * 2); g.lineTo(x - r, y); g.close(); g.fill();
        }
    }

    private buildItems(): void {
        this.itemGeneration++;
        this.itemNodes.length = 0;
        if (!this.content || !this.templateNode) return;
        for (const child of this.content.children.slice()) {
            if (child === this.templateNode) continue;
            child.removeFromParent(); child.destroy();
        }
        const list = this.rewards.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
        const { columns, cardWidth: width, cardHeight: height, columnGap, rowGap } = this.layout;
        const rows = Math.ceil(list.length / columns), totalHeight = rows * height + (rows - 1) * rowGap;
        for (let i = 0; i < list.length; i++) {
            const cell = instantiate(this.templateNode); cell.active = true; this.content.addChild(cell);
            const row = Math.floor(i / columns), column = i % columns;
            const count = Math.min(columns, list.length - row * columns);
            const rowWidth = count * width + (count - 1) * columnGap;
            place(cell, -rowWidth / 2 + width / 2 + column * (width + columnGap),
                totalHeight / 2 - height / 2 - row * (height + rowGap), width, height);
            hideSprite(cell);
            const card = inkSurface(cell, 'RewardCard', width, height, null, null);
            const tone = this.getRewardTone(list[i]);
            const iconNode = cell.getChildByName('Icon');
            const item = rewardItemLayout(width, height);
            this.drawItemMount(card, width, height, item, tone);
            // 图标严格落在单一品质方槽的安全内边距内，避免边缘与边框相压。
            const iconInner = Math.max(24, Math.round(item.icon * (item.horizontal ? .80 : .78)));
            place(iconNode, item.iconX, item.iconY, iconInner, iconInner);
            const name = cell.getChildByName('Name')?.getComponent(Label), countLabel = cell.getChildByName('Count')?.getComponent(Label);
            textStyle(name, item.textX, item.nameY, item.textWidth, item.nameSize, tone.nameColor, Label.HorizontalAlign.CENTER, item.horizontal ? 20 : 26);
            textStyle(countLabel, item.textX, item.countY, item.textWidth, item.countSize, tone.highQuality ? FX_GOLD_BRIGHT : FX_GOLD, Label.HorizontalAlign.CENTER, item.horizontal ? 26 : 34);
            if (name) {
                name.overflow = Label.Overflow.SHRINK;
                name.outlineColor = TEXT_OUTLINE;
                name.outlineWidth = 1.8;
            }
            if (countLabel) {
                countLabel.overflow = Label.Overflow.SHRINK;
                countLabel.isBold = true;
                countLabel.outlineColor = COUNT_OUTLINE;
                countLabel.outlineWidth = 2.2;
            }
            this.itemNodes.push(cell); this.fillCell(cell, list[i]);
        }
        const pages = Math.max(1, Math.ceil(this.rewards.length / this.pageSize));
        this.pageLabel.string = `${this.page + 1} / ${pages}`;
        this.previousButton.active = this.nextButton.active = this.pageLabel.node.active = pages > 1;
        this.previousButton.getComponent(Button).interactable = this.page > 0;
        this.nextButton.getComponent(Button).interactable = this.page < pages - 1;
    }

    private changePage(direction: number): void {
        if (this.closing) return;
        this.finishReveal();
        this.page = Math.max(0, Math.min(Math.ceil(this.rewards.length / this.pageSize) - 1, this.page + direction));
        this.buildItems();
    }

    private layoutWindow(): void {
        const size = view.getVisibleSize();
        this.layout = rewardWindowLayout(this.rewards.length, size.width, size.height);
        const { width, height, headerHeight, footerHeight, contentHeight, paged, short, navHeight } = this.layout;
        this.pageSize = this.layout.pageSize;
        place(this.node, 0, 0, size.width, size.height);
        place(this.veil, 0, 0, size.width, size.height);
        const shade = inkSurface(this.veil, 'RewardSolidBackdrop', size.width, size.height, null, null);
        shade.fillColor = new Color(6, 9, 10, 214);
        shade.rect(-size.width / 2, -size.height / 2, size.width, size.height); shade.fill();
        // 居中淡金氛围光晕，多层低透明叠加实现平滑过渡、避免硬边分层。
        for (let i = 12; i >= 1; i--) {
            const k = i / 12;
            shade.fillColor = new Color(214, 166, 82, 3);
            shade.ellipse(0, 8, Math.max(width, size.width * .62) * (.22 + .42 * k), height * (.24 + .42 * k)); shade.fill();
        }
        place(this.panel, 0, 0, width, height);
        const stageWidth = Math.min(size.width, Math.max(width + 180, size.width * .86));
        const surface = inkSurface(this.panel, 'ResultSurface', stageWidth, height, null, null);
        const top = height / 2, bottom = -top;
        const title = this.titleNode.getComponent(Label), subtitle = this.subtitleNode.getComponent(Label);
        const titleY = top - (short ? 30 : 44), titleSize = short ? 30 : 40;
        const hintY = bottom + (short ? Math.min(18, footerHeight / 2) : Math.min(24, footerHeight * .4));
        this.drawRewardStage(surface, stageWidth, titleY, hintY);
        textStyle(title, 0, titleY, width - 40, titleSize, FX_GOLD_BRIGHT, Label.HorizontalAlign.CENTER, short ? 44 : 58);
        title.string = '获得奖励'; title.isBold = true;
        title.spacingX = short ? 3 : 6;
        title.outlineColor = TITLE_OUTLINE;
        title.outlineWidth = 3;
        // 数量在物品下方直接展示，不再重复“奖励已到账”挤占标题与图标之间的空间。
        subtitle.node.active = false;
        this.dividerNode.active = true;
        place(this.dividerNode, 0, titleY, stageWidth, 24);
        const rule = inkSurface(this.dividerNode, 'GoldRule', stageWidth, 24, null, null);
        for (const side of [-1, 1]) {
            const inner = titleSize * 2 + (short ? 26 : 40);
            const outer = Math.min(stageWidth / 2 - 28, inner + (short ? 90 : 148));
            if (outer > inner + 16) {
                const mid = inner + (outer - inner) * .52;
                rule.strokeColor = new Color(236, 202, 130, 225); rule.lineWidth = 1.8;
                rule.moveTo(side * (inner + 12), 0); rule.lineTo(side * mid, 0); rule.stroke();
                rule.strokeColor = new Color(204, 170, 108, 120); rule.lineWidth = 1;
                rule.moveTo(side * mid, 0); rule.lineTo(side * outer, 0); rule.stroke();
                rule.fillColor = new Color(228, 194, 126, 175);
                rule.circle(side * outer, 0, 1.6); rule.fill();
            }
            const x = side * (inner + 4);
            rule.strokeColor = new Color(236, 202, 130, 195); rule.lineWidth = 1.2;
            rule.moveTo(x, 5.5); rule.lineTo(x + 5.5, 0); rule.lineTo(x, -5.5); rule.lineTo(x - 5.5, 0); rule.close(); rule.stroke();
            rule.fillColor = FX_GOLD_BRIGHT;
            rule.moveTo(x, 2.8); rule.lineTo(x + 2.8, 0); rule.lineTo(x, -2.8); rule.lineTo(x - 2.8, 0); rule.close(); rule.fill();
        }
        this.layoutEffects(width, height, titleY);
        place(this.content, 0, top - headerHeight - contentHeight / 2, width - 32, contentHeight);
        const hint = caption(this.panel, 'DismissHint', '点击空白处关闭', 0, hintY, width - 32, 14, new Color(202, 194, 170, 215), Label.HorizontalAlign.CENTER);
        hint.outlineColor = TEXT_OUTLINE;
        hint.outlineWidth = 1.5;
        place(hint.node, 0, hintY, width - 32, 22);
        const navY = bottom + footerHeight + navHeight / 2 - 6;
        panelButton(this.previousButton, '上一页', -90, navY, 72, 28);
        panelButton(this.nextButton, '下一页', 90, navY, 72, 28);
        place(this.pageLabel.node, 0, navY, 72, 20);
        this.previousButton.active = this.nextButton.active = this.pageLabel.node.active = paged;
    }

    private chamferPath(g: Graphics, cx: number, cy: number, halfW: number, halfH: number, cut: number): void {
        const l = cx - halfW, r = cx + halfW, b = cy - halfH, t = cy + halfH;
        g.moveTo(l + cut, t); g.lineTo(r - cut, t);
        g.lineTo(r, t - cut); g.lineTo(r, b + cut);
        g.lineTo(r - cut, b); g.lineTo(l + cut, b);
        g.lineTo(l, b + cut); g.lineTo(l, t - cut); g.close();
    }

    /** 开放式墨金礼台横幅：去外框套娃，采用主流国风 SLG 的渐隐横幅与细金上下沿。 */
    private drawRewardStage(g: Graphics, stageWidth: number, titleY: number, hintY: number): void {
        const m = this.layout;
        const rowWidth = m.columns * m.cardWidth + (m.columns - 1) * m.columnGap;
        const bandHalf = Math.min(stageWidth / 2, Math.max(rowWidth / 2 + 116, m.short ? 240 : 380));
        const stageTop = m.height / 2 - m.headerHeight + (m.short ? 10 : 18);
        const stageBottom = m.height / 2 - m.headerHeight - m.contentHeight - (m.paged ? 8 : m.short ? 10 : 14);
        const stageHeight = Math.max(40, stageTop - stageBottom);

        // 标题正后方柔和暖金横光晕（扁平渐变，严格收束在标题高度内，不与下方舞台相碰）。
        const bloomHalf = Math.min(bandHalf * .62, m.short ? 170 : 250);
        const bloomH = m.short ? 22 : 30;
        for (let i = 8; i >= 1; i--) {
            const k = i / 8;
            g.fillColor = new Color(234, 184, 86, 6);
            g.ellipse(0, titleY, bloomHalf * (.34 + .66 * k), bloomH * (.36 + .64 * k));
            g.fill();
        }

        // 开放式横向深墨礼台带：多层同心水平渐隐叠加，左右无硬切边，彻底消除“框套框”。
        const stripFractions = [1, .91, .82, .73, .64, .55];
        const stripAlphas = [18, 22, 28, 34, 42, 52];
        for (let i = 0; i < stripFractions.length; i++) {
            const hw = bandHalf * stripFractions[i];
            g.fillColor = new Color(14, 19, 18, stripAlphas[i]);
            g.rect(-hw, stageBottom, hw * 2, stageHeight);
            g.fill();
        }
        // 礼台上下边缘微弱暖金铺光，增强空间层次。
        const washH = Math.min(stageHeight * .24, 44);
        g.fillColor = new Color(214, 174, 96, 12);
        g.rect(-bandHalf * .72, stageTop - washH, bandHalf * 1.44, washH); g.fill();
        g.fillColor = new Color(8, 12, 12, 55);
        g.rect(-bandHalf * .72, stageBottom, bandHalf * 1.44, Math.min(stageHeight * .22, 36)); g.fill();

        // 上下渐隐鎏金细轨与居中菱形金饰（内实外虚，舒展利落）。
        const coreHalf = Math.min(bandHalf * .52, Math.max(rowWidth / 2 + 24, 150));
        const midHalf = Math.min(bandHalf * .78, coreHalf + 110);
        for (const y of [stageTop, stageBottom]) {
            const inward = y === stageTop ? -1 : 1;
            g.strokeColor = new Color(188, 154, 92, 52); g.lineWidth = 1;
            g.moveTo(-bandHalf, y); g.lineTo(bandHalf, y); g.stroke();
            g.strokeColor = new Color(214, 180, 112, 135); g.lineWidth = 1.4;
            g.moveTo(-midHalf, y); g.lineTo(midHalf, y); g.stroke();
            g.strokeColor = new Color(242, 210, 142, 225); g.lineWidth = 2;
            g.moveTo(-coreHalf, y); g.lineTo(coreHalf, y); g.stroke();
            // 内侧极细衬线。
            g.strokeColor = new Color(216, 182, 114, 58); g.lineWidth = 1;
            g.moveTo(-coreHalf * .82, y + inward * 4); g.lineTo(coreHalf * .82, y + inward * 4); g.stroke();
            // 居中菱形金印。
            g.fillColor = FX_GOLD_BRIGHT;
            g.moveTo(0, y + 4); g.lineTo(5.5, y); g.lineTo(0, y - 4); g.lineTo(-5.5, y); g.close(); g.fill();
        }

        // 底部关闭提示两侧的细铜短线，收束整体视觉。
        g.strokeColor = new Color(197, 166, 108, 115); g.lineWidth = 1;
        for (const side of [-1, 1]) {
            g.moveTo(side * 66, hintY); g.lineTo(side * 100, hintY); g.stroke();
        }
    }

    /** 单一精工品质方槽：只保留一层图标品质槽，外置名称与数量，避免多层框体叠压。 */
    private drawItemMount(g: Graphics, _cardW: number, _cardH: number, item: ReturnType<typeof rewardItemLayout>, tone: RewardVisualTone): void {
        const x = item.iconX, y = item.iconY;
        const half = item.icon / 2;
        const cut = item.horizontal ? 4 : 8;
        const border = item.horizontal ? 1.4 : 1.8;

        // 高品质物品外围柔光晕，一眼拉开稀有度层次。
        if (tone.highQuality) {
            for (let i = 4; i >= 1; i--) {
                const pad = 3 + i * (item.horizontal ? 1.4 : 2.6);
                g.fillColor = rgb(tone.accent, 11);
                this.chamferPath(g, x, y, half + pad, half + pad, cut + 2);
                g.fill();
            }
        }

        // 槽位底部轻投影，让品质方槽自然浮出礼台。
        g.fillColor = new Color(4, 7, 7, 150);
        this.chamferPath(g, x, y - (item.horizontal ? 2 : 3.5), half + 1.5, half + 1.5, cut + 1);
        g.fill();

        // 单层切角品质外框 + 深色内槽（实心叠层，无锯齿断线）。
        g.fillColor = blendRgb(tone.accent, tone.mountFill, tone.highQuality ? .82 : .58);
        this.chamferPath(g, x, y, half, half, cut);
        g.fill();
        g.fillColor = rgb(tone.mountFill);
        this.chamferPath(g, x, y, half - border, half - border, Math.max(2, cut - 1));
        g.fill();

        // 槽内中心柔和聚光与底部品质映光，突出手绘道具与武将立绘。
        for (let i = 6; i >= 1; i--) {
            const k = .26 + .62 * (i / 6);
            g.fillColor = rgb(tone.accent, tone.highQuality ? 12 : 7);
            g.ellipse(x, y - half * .06, half * k, half * k);
            g.fill();
        }
        const inner = half - border, innerCut = Math.max(2, cut - 1);
        const sheenH = Math.max(8, half * .42);
        const sheenTop = y - inner + sheenH;
        g.fillColor = rgb(tone.accent, tone.highQuality ? 30 : 16);
        g.moveTo(x - inner, sheenTop); g.lineTo(x + inner, sheenTop);
        g.lineTo(x + inner, y - inner + innerCut); g.lineTo(x + inner - innerCut, y - inner);
        g.lineTo(x - inner + innerCut, y - inner); g.lineTo(x - inner, y - inner + innerCut);
        g.close(); g.fill();

        // 顶部细微高光沿与底部品质亮条。
        const barW = Math.max(10, (half - cut - 3) * 2);
        g.fillColor = rgb(tone.accent, tone.highQuality ? 165 : 95);
        g.rect(x - barW / 2, y + half - border - 1, barW, 1.2); g.fill();
        g.fillColor = rgb(tone.accent, tone.highQuality ? 245 : 195);
        g.rect(x - barW / 2, y - half + border * .4, barW, item.horizontal ? 1.8 : 2.6); g.fill();

        // 四角微幅高光折角（严格贴合边框外沿，绝不侵入图标区域）。
        g.strokeColor = rgb(tone.accent, tone.highQuality ? 245 : 190);
        g.lineWidth = item.horizontal ? 1.2 : 1.5;
        const arm = item.horizontal ? 6 : 12;
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                g.moveTo(x + sx * (half - arm), y + sy * half);
                g.lineTo(x + sx * (half - cut), y + sy * half);
                g.lineTo(x + sx * half, y + sy * (half - cut));
                g.lineTo(x + sx * half, y + sy * (half - arm));
                g.stroke();
            }
        }
    }

    private layoutEffects(width: number, height: number, titleY: number): void {
        if (!this.glow || !this.rays || !this.motes) return;
        place(this.glow, 0, titleY - 15, width, height);
        place(this.rays, 0, titleY - 15, width, height);
        place(this.motes.node, 0, 0, width, height);
        const glow = this.glow.getComponent(Graphics); glow.clear();
        for (let i = 18; i >= 1; i--) {
            glow.fillColor = new Color(233, 177, 75, 5);
            glow.ellipse(0, 0, width * .66 * i / 18, Math.min(110, height * .4) * i / 18); glow.fill();
        }
        const rays = this.rays.getComponent(Graphics); rays.clear();
        for (let i = 0; i < 14; i++) {
            const a = i * Math.PI * 2 / 14, length = width * (.28 + (i % 3) * .045);
            rays.fillColor = new Color(249, 204, 117, 24);
            rays.moveTo(Math.cos(a) * 24, Math.sin(a) * 10);
            rays.lineTo(Math.cos(a - .025) * length, Math.sin(a - .025) * length * .42);
            rays.lineTo(Math.cos(a + .025) * length, Math.sin(a + .025) * length * .42);
            rays.close(); rays.fill();
        }
    }

    private onResize(): void {
        if (!this.panel || !this.node.activeInHierarchy || this.closing || !this.rewards.length) return;
        const firstReward = this.page * this.pageSize;
        this.finishReveal(); this.layoutWindow();
        this.page = Math.min(Math.floor(firstReward / this.pageSize), Math.max(0, Math.ceil(this.rewards.length / this.pageSize) - 1));
        this.buildItems();
    }

    private createNode(name: string, parent: Node, width: number, height: number, x: number, y: number): Node {
        const node = new Node(name); node.layer = this.node.layer; parent.addChild(node);
        node.addComponent(UITransform); place(node, x, y, width, height); return node;
    }

    private ensureOpacity(node: Node): UIOpacity {
        return node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
    }

    private fillCell(cell: Node, info: RewardInfo): void {
        const generation = this.itemGeneration;
        const count = cell.getChildByName('Count')?.getComponent(Label);
        if (count) count.string = `×${String(info.itemCount || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
        const name = cell.getChildByName('Name')?.getComponent(Label);
        if (name) name.string = this.getRewardName(info);
        const icon = cell.getChildByName('Icon')?.getComponent(Sprite);
        if (!icon) return;
        icon.node.active = false;
        const iconSize = icon.node.getComponent(UITransform);
        const glyph = this.createNode('ItemGlyph', cell, iconSize.width, iconSize.height, icon.node.position.x, icon.node.position.y);
        const label = glyph.addComponent(Label);
        label.string = info.rewardType === REWARD_TYPE_HERO ? '将' : info.rewardType === REWARD_TYPE_SOLDIER ? '兵' : itemGlyph(info.itemId);
        label.fontSize = Math.min(28, iconSize.height - 4); label.lineHeight = label.fontSize + 4;
        label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER; label.color = FX_GOLD;
        const path = this.getIconPath(info);
        if (!path) return;
        const maxWidth = iconSize.width, maxHeight = iconSize.height;
        resources.load(path, SpriteFrame, (error: Error, frame: SpriteFrame) => {
            if (error || !frame || generation !== this.itemGeneration || !isValid(this, true) || !isValid(icon, true)) return;
            if (Sprite.SizeMode) icon.sizeMode = Sprite.SizeMode.CUSTOM;
            icon.spriteFrame = frame;
            const ui = icon.node.getComponent(UITransform), size = frame.originalSize;
            const fit = Math.min(maxWidth / Math.max(1, size.width), maxHeight / Math.max(1, size.height));
            ui.setContentSize(size.width * fit, size.height * fit); icon.node.active = true;
            if (isValid(glyph, true)) glyph.active = false;
        });
    }
    private getIconPath(info: RewardInfo): string {
        const isItemReward = info.rewardType === REWARD_TYPE_ITEM
            || info.rewardType === REWARD_TYPE_RES
            || info.rewardType === REWARD_TYPE_CONVERT_ITEM;
        if (isItemReward) return itemIconPath(info.itemId);
        if (info.rewardType === REWARD_TYPE_HERO) {
            const hero = this.getHeroConfig(info.itemId);
            return getGeneralPortraitPath(hero && hero.Icon);
        }
        return '';
    }

    private getRewardName(info: RewardInfo): string {
        if (info.rewardType === REWARD_TYPE_SOLDIER) return '兵力';
        if (info.rewardType === REWARD_TYPE_HERO) {
            const hero = this.getHeroConfig(info.itemId);
            return (hero && hero.name) || `武将 ${info.itemId}`;
        }
        if (info.rewardType === REWARD_TYPE_ITEM
            || info.rewardType === REWARD_TYPE_RES
            || info.rewardType === REWARD_TYPE_CONVERT_ITEM) {
            return itemName(info.itemId);
        }
        return "奖励";
    }

    private getRewardTone(info: RewardInfo): RewardVisualTone {
        let quality = 0;
        if (info.rewardType === REWARD_TYPE_HERO) {
            const hero = this.getHeroConfig(info.itemId);
            quality = Number(hero?.Quality) || Number(hero?.Star) || 5;
        } else if (info.rewardType === REWARD_TYPE_ITEM || info.rewardType === REWARD_TYPE_RES || info.rewardType === REWARD_TYPE_CONVERT_ITEM) {
            const item = this.getItemConfig(info.itemId);
            quality = Number(item?.Quality) || 0;
        }
        const index = Number.isInteger(quality) && quality >= 1 && quality <= 5 ? quality : 0;
        return QUALITY_TONES[index];
    }

    private getItemConfig(itemId: number): any {
        const items = ConfigManager.getInstance().getConfig("Item");
        const rows: any[] = Array.isArray(items) ? items : items && typeof items === 'object' ? Object.keys(items).map(key => items[key]) : [];
        return rows.find((cfg: any) => cfg && Number(cfg.Id) === itemId) || null;
    }

    private getHeroConfig(heroId: number): any {
        const heroes = ConfigManager.getInstance().getConfig("Hero");
        const rows: any[] = Array.isArray(heroes) ? heroes : heroes && typeof heroes === 'object' ? Object.keys(heroes).map(key => heroes[key]) : [];
        return rows.find((cfg: any) => cfg && Number(cfg.Id) === heroId) || null;
    }
}
