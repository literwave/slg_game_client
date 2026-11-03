import { BlockInputEvents, Button, Color, Graphics, Label, Layout, Mask, Node, SafeArea, ScrollView,
    Tween, UIOpacity, UITransform, Widget, isValid } from 'cc';
import BgLogic from '../../common/BgLogic';
import { DialogOut } from '../../common/DialogOut';
import { caption, hideSprite, inkSurface, ManagementColors as C, panelButton, place, textStyle } from './ManagementStyle';

/** 提示框独立的展示层；复用预制体的正文、按钮和序列化回调。 */
export default class DialogView {
    private readonly panel: Node;
    private readonly background: Node;
    private readonly mask: Node;
    private readonly safe: Node;
    private readonly title: Label;
    private readonly emblem: Graphics;
    private readonly actions: Node;
    private readonly scroll: ScrollView;
    private readonly viewport: Node;
    private readonly scrollHint: Label;
    private arranging = false;
    private confirmVisible = true;
    private cancelVisible = false;
    private message = '';

    constructor(private readonly root: Node, private readonly text: Label,
        private readonly confirm: Button, private readonly cancel: Button) {
        this.panel = text.node.parent;
        this.background = this.panel.getChildByName('bg');
        this.mask = root.getChildByName('mask');
        this.actions = confirm.node.parent;
        this.title = this.background?.getChildByName('titleLab')?.getComponent(Label);
        if (!this.panel || !this.background || !this.mask || !this.title || this.actions !== cancel.node.parent) {
            throw new Error('[Dialog] 提示预制体结构不完整');
        }

        // 关闭旧卷轴的缩放动画与背景适配，避免它们覆盖新的布局尺寸。
        const pop = this.panel.getComponent(DialogOut);
        if (pop) pop.enabled = false;
        Tween.stopAllByTarget(this.panel);
        this.panel.setScale(1, 1, 1);
        const bg = this.mask.getComponent(BgLogic);
        if (bg) bg.enabled = false;
        const layout = this.actions.getComponent(Layout);
        if (layout) layout.enabled = false;
        hideSprite(this.mask);
        hideSprite(this.background);
        const maskOpacity = this.mask.getComponent(UIOpacity);
        if (maskOpacity) maskOpacity.opacity = 255;
        if (!root.getComponent(BlockInputEvents)) root.addComponent(BlockInputEvents);

        this.stretch(root);
        this.safe = this.make('DialogSafeArea', root);
        this.stretch(this.safe);
        this.safe.addComponent(SafeArea);
        this.panel.parent = this.safe;

        const emblem = this.make('DialogEmblem', this.panel);
        this.emblem = emblem.addComponent(Graphics);
        caption(emblem, 'Mark', '!', 0, 0, 28, 20, C.gold, Label.HorizontalAlign.CENTER);

        const scrollNode = this.make('DialogMessage', this.panel);
        this.scroll = scrollNode.addComponent(ScrollView);
        this.scroll.horizontal = false;
        this.scroll.vertical = true;
        this.scroll.elastic = false;
        this.scroll.cancelInnerEvents = true;
        this.viewport = this.make('Viewport', scrollNode);
        this.viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        text.node.parent = this.viewport;
        this.scroll.content = text.node;
        this.scrollHint = caption(this.panel, 'ScrollHint', '上下滑动查看', 0, 0, 180, 12, C.muted,
            Label.HorizontalAlign.CENTER);

        root.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.refreshSize();
    }

    public show(message: string, confirm: boolean, cancel: boolean): void {
        this.confirmVisible = confirm;
        this.cancelVisible = cancel;
        this.message = message;
        this.confirm.node.active = confirm;
        this.cancel.node.active = cancel;
        this.title.string = confirm && cancel ? '操作确认' : '提示';
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
        const root = this.root.getComponent(UITransform), safe = this.safe.getComponent(UITransform);
        if (safe.width <= 1 || safe.height <= 1) return;
        this.arranging = true;
        try {
            const width = Math.max(180, Math.min(460, safe.width - 32));
            const bodyWidth = width - 56;
            const maxHeight = Math.min(440, safe.height - 32);
            const bodyCapacity = Math.max(30, maxHeight - 192);
            place(this.mask, 0, 0, root.width, root.height);
            inkSurface(this.mask, 'DialogScrim', root.width, root.height, new Color(0, 0, 0, 142), null);

            // RESIZE_HEIGHT 按实际字体测量中文、换行和长文本，不靠字符数猜高度。
            textStyle(this.text, 0, 0, bodyWidth, 19, C.text, Label.HorizontalAlign.LEFT, 30);
            this.text.lineHeight = 30;
            this.text.verticalAlign = Label.VerticalAlign.TOP;
            this.text.enableWrapText = true;
            this.text.overflow = Label.Overflow.RESIZE_HEIGHT;
            this.text.string = this.message;
            const textUI = this.text.node.getComponent(UITransform);
            textUI.setAnchorPoint(.5, 1);
            this.text.updateRenderData(true);
            // 两行短提示优先在中部标点处断句，避免末行只剩一两个字。
            if (!this.message.includes('\n') && textUI.height > 45 && textUI.height < 80) {
                const breaks = this.message.split('').map((char, index) => '，；。'.includes(char) ? index : -1)
                    .filter(index => index > this.message.length / 3 && index < this.message.length * 2 / 3);
                if (breaks.length) {
                    const split = breaks.sort((a, b) => Math.abs(a - this.message.length / 2) - Math.abs(b - this.message.length / 2))[0] + 1;
                    this.text.string = this.message.slice(0, split) + '\n' + this.message.slice(split);
                    this.text.updateRenderData(true);
                }
            }
            const measuredHeight = textUI.height;
            const overflow = measuredHeight > bodyCapacity;
            const bodyHeight = Math.min(bodyCapacity, Math.max(48, measuredHeight));
            const height = 172 + bodyHeight + (overflow ? 20 : 0);

            place(this.panel, 0, 0, width, height);
            place(this.background, 0, 0, width, height);
            const surface = inkSurface(this.background, 'DialogSurface', width, height,
                new Color(29, 35, 30, 255), new Color(164, 140, 88, 210));
            surface.lineWidth = 1;
            surface.strokeColor = new Color(164, 140, 88, 38);
            surface.roundRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, 3);
            surface.stroke();
            surface.strokeColor = C.gold;
            for (const side of [-1, 1]) {
                const x = side * (width / 2 - 10), y = height / 2 - 10;
                surface.moveTo(x - side * 18, y); surface.lineTo(x, y); surface.lineTo(x, y - 12);
            }
            surface.stroke();

            const top = height / 2;
            place(this.emblem.node, -width / 2 + 38, top - 36, 32, 32);
            const g = this.emblem;
            g.clear(); g.lineWidth = 1;
            g.fillColor = new Color(71, 62, 40, 255); g.strokeColor = C.gold;
            g.moveTo(0, 17); g.lineTo(17, 0); g.lineTo(0, -17); g.lineTo(-17, 0);
            g.close(); g.fill(); g.stroke();
            textStyle(this.title, 10, top - 36, width - 128, 23, C.text, Label.HorizontalAlign.LEFT, 34);
            const rule = inkSurface(this.background, 'DialogRule', width - 56, 1, C.line, null);
            rule.node.setPosition(0, top - 66, 0);
            rule.node.setSiblingIndex(surface.node.getSiblingIndex() + 1);

            this.scroll.stopAutoScroll();
            place(this.scroll.node, 0, top - 84 - bodyHeight / 2, bodyWidth, bodyHeight);
            place(this.viewport, 0, 0, bodyWidth, bodyHeight);
            this.text.node.setPosition(0, bodyHeight / 2, 0);
            this.scroll.vertical = overflow;
            this.scrollHint.node.active = overflow;
            place(this.scrollHint.node, 0, -height / 2 + 81, bodyWidth, 20);

            place(this.actions, 0, -height / 2 + 42, width - 56, 44);
            const both = this.confirmVisible && this.cancelVisible;
            const buttonWidth = both ? Math.min(156, (width - 68) / 2) : Math.min(164, width - 56);
            const offset = both ? (buttonWidth + 12) / 2 : 0;
            panelButton(this.confirm.node, both ? '确定' : '知道了', offset, 0, buttonWidth, 44, true);
            panelButton(this.cancel.node, both ? '取消' : '关闭', -offset, 0, buttonWidth, 44);
        } finally {
            this.arranging = false;
        }
    };

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
