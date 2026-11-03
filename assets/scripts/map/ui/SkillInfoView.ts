import { BlockInputEvents, Color, Label, Mask, Node, SafeArea, ScrollView, Sprite, Tween,
    UIOpacity, UITransform, Widget, isValid } from 'cc';
import BgLogic from '../../common/BgLogic';
import { DialogOut } from '../../common/DialogOut';
import { caption, hideSprite, inkSurface, ManagementColors as C, panelButton, place, textStyle } from './ManagementStyle';

interface SkillInfoElements {
    name: Label;
    icon: Node;
    level: Label;
    trigger: Label;
    target: Label;
    arms: Label;
    rate: Label;
    current: Label;
    next: Label;
}

/** 战法详情的展示层；复用真实战法数据、图标与原关闭回调。 */
export default class SkillInfoView {
    private readonly panel: Node;
    private readonly scrim: Node;
    private readonly safe: Node;
    private readonly header: Node;
    private readonly close: Node;
    private readonly scroll: ScrollView;
    private readonly viewport: Node;
    private readonly content: Node;
    private readonly facts: Node;
    private readonly factCells: Node[] = [];
    private readonly currentCard: Node;
    private readonly nextCard: Node;
    private readonly hint: Label;
    private level = 0;
    private hasNext = false;
    private arranging = false;

    constructor(private readonly root: Node, private readonly ui: SkillInfoElements) {
        this.panel = ui.icon.parent.parent;
        this.close = this.panel.getChildByName('closeBtn');
        this.scrim = root.getChildByName('mask');
        if (!this.close || !this.scrim) throw new Error('[SkillInfo] 战法详情预制体结构不完整');

        // 停止旧弹窗的缩放及贴图布局，序列化引用与按钮回调继续沿用。
        const pop = this.panel.getComponent(DialogOut);
        if (pop) pop.enabled = false;
        Tween.stopAllByTarget(this.panel);
        this.panel.setScale(1, 1, 1);
        this.panel.children.forEach(child => child.active = false);
        this.close.active = true;
        const bg = this.scrim.getComponent(BgLogic);
        if (bg) bg.enabled = false;
        hideSprite(this.scrim);
        const opacity = this.scrim.getComponent(UIOpacity);
        if (opacity) opacity.opacity = 255;
        if (!root.getComponent(BlockInputEvents)) root.addComponent(BlockInputEvents);
        this.stretch(root);
        this.safe = this.make('SkillSafeArea', root);
        this.stretch(this.safe);
        this.safe.addComponent(SafeArea);
        this.panel.parent = this.safe;

        this.header = this.make('SkillHeader', this.panel);
        for (const node of [ui.icon, ui.name.node, ui.level.node]) {
            node.parent = this.header; node.active = true;
        }
        ui.icon.getComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
        this.scroll = this.make('SkillDetailScroll', this.panel).addComponent(ScrollView);
        this.scroll.horizontal = false;
        this.scroll.vertical = true;
        this.scroll.elastic = false;
        this.scroll.cancelInnerEvents = true;
        this.viewport = this.make('Viewport', this.scroll.node);
        this.viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.content = this.make('Content', this.viewport);
        this.scroll.content = this.content;
        this.facts = this.make('SkillFacts', this.content);
        for (const [index, label] of [ui.trigger, ui.rate, ui.arms, ui.target].entries()) {
            const cell = this.make(`Fact${index}`, this.facts);
            label.node.parent = cell; label.node.active = true;
            this.factCells.push(cell);
        }
        this.currentCard = this.make('CurrentEffect', this.content);
        this.nextCard = this.make('NextEffect', this.content);
        ui.current.node.parent = this.currentCard; ui.current.node.active = true;
        ui.next.node.parent = this.nextCard; ui.next.node.active = true;
        this.hint = caption(this.panel, 'ScrollHint', '上下滑动查看完整效果', 0, 0, 240, 12, C.muted,
            Label.HorizontalAlign.CENTER);
        this.close.setSiblingIndex(this.panel.children.length - 1);
        root.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.refreshSize();
    }

    public show(level: number, hasNext: boolean): void {
        this.level = level;
        this.hasNext = hasNext;
        this.refreshSize();
        this.scroll.scrollToTop(0);
    }

    public refreshSize(): void {
        this.root.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment();
        this.safe.getComponent(SafeArea).updateArea();
        this.layout();
    }

    private layout = (): void => {
        if (this.arranging || !this.scroll || !isValid(this.root, true)) return;
        const safe = this.safe.getComponent(UITransform), root = this.root.getComponent(UITransform);
        if (safe.width <= 1 || safe.height <= 1) return;
        this.arranging = true;
        try {
            const width = Math.max(260, Math.min(820, safe.width - 32));
            const compact = width < 580, padding = compact ? 20 : 28;
            const bodyWidth = width - padding * 2;
            const headerHeight = compact ? 124 : 142;
            const maxHeight = Math.max(240, Math.min(640, safe.height - 32));
            place(this.scrim, 0, 0, root.width, root.height);
            inkSurface(this.scrim, 'SkillScrim', root.width, root.height, new Color(0, 0, 0, 162), null);

            const factHeight = this.layoutFacts(bodyWidth, compact);
            const currentHeight = this.layoutEffect(this.currentCard, this.ui.current, bodyWidth,
                '当前效果', this.level ? `${this.level}级` : '—', false, compact);
            this.nextCard.active = this.level > 0;
            const nextHeight = this.level > 0 ? this.layoutEffect(this.nextCard, this.ui.next, bodyWidth,
                this.hasNext ? '升级预览' : '', `${this.level + 1}级`, true, compact) : 0;
            const contentHeight = factHeight + 18 + currentHeight + (nextHeight ? 12 + nextHeight : 0);
            const available = Math.max(64, maxHeight - headerHeight - 32);
            const overflow = contentHeight > available;
            const bodyHeight = Math.min(contentHeight, available - (overflow ? 12 : 0));
            const height = headerHeight + bodyHeight + (overflow ? 44 : 28);
            place(this.panel, 0, 0, width, height);
            this.drawPanel(width, height);
            const top = height / 2;
            place(this.header, 0, top - headerHeight / 2, width, headerHeight);
            this.layoutHeader(width, headerHeight, padding, compact);
            panelButton(this.close, '', width / 2 - 34, top - 32, 44, 44, false, true);

            place(this.scroll.node, 0, top - headerHeight - bodyHeight / 2, bodyWidth, bodyHeight);
            place(this.viewport, 0, 0, bodyWidth, bodyHeight);
            place(this.content, 0, bodyHeight / 2, bodyWidth, contentHeight);
            this.content.getComponent(UITransform).setAnchorPoint(.5, 1);
            this.facts.setPosition(0, -factHeight / 2, 0);
            this.currentCard.setPosition(0, -factHeight - 18 - currentHeight / 2, 0);
            this.nextCard.setPosition(0, -factHeight - 18 - currentHeight - 12 - nextHeight / 2, 0);
            this.scroll.stopAutoScroll();
            this.scroll.vertical = overflow;
            this.hint.node.active = overflow;
            place(this.hint.node, 0, -height / 2 + 20, bodyWidth, 20);
        } finally {
            this.arranging = false;
        }
    };

    private layoutHeader(width: number, height: number, padding: number, compact: boolean): void {
        const iconSize = compact ? 80 : 100;
        const left = -width / 2 + padding;
        const nameLeft = left + iconSize + (compact ? 18 : 24);
        const textWidth = width / 2 - 62 - nameLeft;
        place(this.ui.icon, left + iconSize / 2, -2, iconSize, iconSize);
        const wrap = this.ui.icon.getChildByName('wrap');
        if (wrap) place(wrap, 0, 0, iconSize, iconSize);
        caption(this.header, 'Eyebrow', '战 法 详 情', nameLeft + textWidth / 2, 38,
            textWidth, 12, C.gold);
        textStyle(this.ui.name, nameLeft + textWidth / 2, 7, textWidth, compact ? 26 : 32, C.text,
            Label.HorizontalAlign.LEFT, 44);
        this.ui.name.overflow = Label.Overflow.SHRINK;
        caption(this.header, 'LevelTitle', '当前等级', nameLeft + 30, -30, 60, 13, C.muted);
        textStyle(this.ui.level, nameLeft + 93, -30, 48, 15, C.gold, Label.HorizontalAlign.CENTER, 24);
        if (!this.level) this.ui.level.string = '—';
        const chip = inkSurface(this.header, 'LevelChip', 48, 24,
            new Color(106, 86, 49, 95), new Color(177, 148, 91, 90));
        chip.node.setPosition(nameLeft + 93, -30, 0);
        const line = inkSurface(this.header, 'HeaderRule', width - padding * 2, 1, C.line, null);
        line.node.setPosition(0, -height / 2 + 12, 0);
    }

    private layoutFacts(width: number, compact: boolean): number {
        const columns = compact ? 2 : 4, rows = compact ? 2 : 1;
        const rowHeight = 68, height = rows * rowHeight;
        place(this.facts, 0, 0, width, height);
        const surface = inkSurface(this.facts, 'FactsSurface', width, height, new Color(21, 28, 24, 255), null);
        const labels = [this.ui.trigger, this.ui.rate, this.ui.arms, this.ui.target];
        const titles = ['战法类型', '发动概率', '适用兵种', '目标类型'];
        const cellWidth = width / columns;
        this.factCells.forEach((cell, index) => {
            const col = index % columns, row = Math.floor(index / columns);
            place(cell, -width / 2 + cellWidth * (col + .5), height / 2 - rowHeight * (row + .5), cellWidth, rowHeight);
            caption(cell, 'Caption', titles[index], 0, 14, cellWidth - 24, 12, C.muted);
            textStyle(labels[index], 0, -12, cellWidth - 24, compact ? 16 : 18,
                index === 1 ? C.gold : C.text, Label.HorizontalAlign.LEFT, 26);
            labels[index].overflow = Label.Overflow.SHRINK;
            if (!labels[index].string) labels[index].string = '—';
        });
        surface.strokeColor = new Color(153, 134, 91, 48); surface.lineWidth = 1;
        for (let col = 1; col < columns; col++) {
            const x = -width / 2 + col * cellWidth;
            surface.moveTo(x, -height / 2 + 14); surface.lineTo(x, height / 2 - 14);
        }
        if (rows > 1) { surface.moveTo(-width / 2 + 14, 0); surface.lineTo(width / 2 - 14, 0); }
        surface.stroke();
        return height;
    }

    private layoutEffect(card: Node, label: Label, width: number, title: string,
        level: string, next: boolean, compact: boolean): number {
        const maxed = next && !this.hasNext;
        const inset = compact ? 18 : 22;
        textStyle(label, 0, 0, width - inset * 2, compact ? 17 : 19,
            maxed ? C.gold : C.text, Label.HorizontalAlign.LEFT, 28);
        label.lineHeight = compact ? 27 : 30;
        label.verticalAlign = Label.VerticalAlign.TOP;
        label.enableWrapText = true;
        label.overflow = Label.Overflow.RESIZE_HEIGHT;
        const textUI = label.getComponent(UITransform);
        textUI.setAnchorPoint(.5, 1);
        label.updateRenderData(true);
        const measured = Math.max(label.lineHeight, textUI.height);
        const height = maxed ? measured + 32 : Math.max(108, measured + 72);
        place(card, 0, 0, width, height);
        const surface = inkSurface(card, 'EffectSurface', width, height,
            next ? new Color(29, 36, 30, 255) : new Color(41, 46, 37, 255),
            next ? new Color(153, 134, 91, 65) : new Color(177, 148, 91, 125));
        if (!next) {
            surface.fillColor = C.gold;
            surface.roundRect(-width / 2, -height / 2 + 16, 3, height - 32, 1);
            surface.fill();
        }
        const heading = caption(card, 'Heading', title, 0, height / 2 - 25, width - inset * 2,
            17, next ? C.muted : C.gold);
        const badge = caption(card, 'LevelBadge', level, width / 2 - inset - 32, height / 2 - 25,
            64, 14, next ? new Color(168, 194, 163, 255) : C.gold, Label.HorizontalAlign.RIGHT);
        heading.node.active = badge.node.active = !maxed;
        label.node.setPosition(0, height / 2 - (maxed ? 16 : 52), 0);
        return height;
    }

    private drawPanel(width: number, height: number): void {
        const surface = inkSurface(this.panel, 'SkillSurface', width, height,
            new Color(29, 35, 30, 255), new Color(157, 133, 83, 220));
        surface.lineWidth = 1;
        surface.strokeColor = new Color(157, 133, 83, 35);
        surface.roundRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, 3);
        surface.stroke();
        surface.strokeColor = C.gold;
        for (const side of [-1, 1]) {
            const x = side * (width / 2 - 10), y = height / 2 - 10;
            surface.moveTo(x - side * 24, y); surface.lineTo(x, y); surface.lineTo(x, y - 16);
        }
        surface.stroke();
    }

    private make(name: string, parent: Node): Node {
        const node = new Node(name); node.layer = parent.layer;
        node.addComponent(UITransform).setContentSize(1, 1);
        parent.addChild(node);
        return node;
    }

    private stretch(node: Node): void {
        const widget = node.getComponent(Widget) || node.addComponent(Widget);
        widget.isAlignHorizontalCenter = widget.isAlignVerticalCenter = false;
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
    }

    public dispose(): void {
        if (isValid(this.root, true)) this.root.off(Node.EventType.SIZE_CHANGED, this.layout, this);
        if (isValid(this.safe, true)) this.safe.off(Node.EventType.SIZE_CHANGED, this.layout, this);
    }
}
