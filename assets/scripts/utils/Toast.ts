import { _decorator, Color, Component, Graphics, Label, Node, Sprite, Tween, tween, UIOpacity, UITransform, Vec3, view } from 'cc';
const { ccclass, property } = _decorator;

const FONT_SIZE = 16;
const LINE_HEIGHT = 22;
const LEFT_PADDING = 48;
const RIGHT_PADDING = 22;
const VERTICAL_PADDING = 9;

@ccclass('Toast')
export default class Toast extends Component {
    @property(Label)
    msgLabel: Label | null = null;

    private _opacity: UIOpacity | null = null;
    private _basePosition: Vec3 = new Vec3();
    private _layoutParent: Node | null = null;

    protected onLoad(): void {
        this._opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
    }

    protected onEnable(): void {
        this._layoutParent = this.node.parent;
        this._layoutParent?.on(Node.EventType.SIZE_CHANGED, this.onViewportResize, this);
        view.on('design-resolution-changed', this.onViewportResize, this);
    }

    protected onDisable(): void {
        this._layoutParent?.off(Node.EventType.SIZE_CHANGED, this.onViewportResize, this);
        this._layoutParent = null;
        view.off('design-resolution-changed', this.onViewportResize, this);
        this.unscheduleAllCallbacks();
        Tween.stopAllByTarget(this.node);
        if (this._opacity) Tween.stopAllByTarget(this._opacity);
    }

    private onViewportResize(): void {
        Tween.stopAllByTarget(this.node);
        this.refreshLayout();
    }

    /** 贴近页面上沿的轻提示；留出武将展示区，装饰节点不接收输入。 */
    private refreshLayout(): void {
        const label = this.msgLabel;
        if (!label) return;
        const parentUi = this.node.parent?.getComponent(UITransform);
        const size = parentUi?.contentSize || view.getVisibleSize();
        const maxWidth = Math.max(80, Math.min(440, size.width - 40));
        const labelUi = label.node.getComponent(UITransform);
        label.customMaterial = null;
        label.fontSize = FONT_SIZE;
        label.lineHeight = LINE_HEIGHT;
        label.color = new Color(239, 229, 205, 255);
        label.isBold = false;
        label.isItalic = false;
        label.enableOutline = false;
        label.enableShadow = false;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        labelUi.setAnchorPoint(.5, .5);
        label.node.setPosition((LEFT_PADDING - RIGHT_PADDING) / 2, 0, 0);
        label.node.setScale(1, 1, 1);

        label.overflow = Label.Overflow.NONE;
        label.enableWrapText = false;
        label.updateRenderData(true);
        const width = Math.min(maxWidth, Math.max(208, Math.ceil(labelUi.width) + LEFT_PADDING + RIGHT_PADDING));
        const textWidth = Math.max(10, width - LEFT_PADDING - RIGHT_PADDING);
        labelUi.setContentSize(textWidth, LINE_HEIGHT);
        label.overflow = Label.Overflow.RESIZE_HEIGHT;
        label.enableWrapText = true;
        label.updateRenderData(true);
        const textHeight = Math.min(88, Math.max(LINE_HEIGHT, Math.ceil(labelUi.height)));
        if (labelUi.height > textHeight) label.overflow = Label.Overflow.SHRINK;
        labelUi.setContentSize(textWidth, textHeight);
        const height = textHeight + VERTICAL_PADDING * 2;
        const rootUi = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        rootUi.setAnchorPoint(.5, .5);
        rootUi.setContentSize(width, height);

        const bg = this.node.getChildByName('bg');
        if (bg) {
            const sprite = bg.getComponent(Sprite);
            if (sprite) sprite.enabled = false;
            bg.setPosition(0, 0, 0);
            bg.getComponent(UITransform)?.setContentSize(width, height);
            let surface = bg.getChildByName('ToastSurface');
            if (!surface) {
                surface = new Node('ToastSurface');
                surface.layer = bg.layer;
                surface.addComponent(UITransform);
                surface.addComponent(Graphics);
                bg.addChild(surface);
            }
            surface.getComponent(UITransform).setContentSize(width, height);
            const g = surface.getComponent(Graphics);
            g.clear();
            const left = -width / 2, bottom = -height / 2;
            g.fillColor = new Color(10, 14, 10, 65);
            g.roundRect(left - 2, bottom - 4, width + 4, height + 3, 6);
            g.fill();
            g.fillColor = new Color(30, 35, 28, 247);
            g.moveTo(left + 6, bottom); g.lineTo(-left - 6, bottom);
            g.lineTo(-left, bottom + 6); g.lineTo(-left, -bottom - 6);
            g.lineTo(-left - 6, -bottom); g.lineTo(left + 6, -bottom);
            g.lineTo(left, -bottom - 6); g.lineTo(left, bottom + 6); g.close();
            g.fill();
            g.strokeColor = new Color(170, 143, 90, 185);
            g.lineWidth = 1;
            g.stroke();
            g.strokeColor = new Color(229, 198, 134, 135);
            g.moveTo(left + 12, -bottom - 2); g.lineTo(-left - 12, -bottom - 2); g.stroke();

            // 小笺表示通知，不把成功和普通信息都画成警告符号。
            const iconX = left + 25;
            g.fillColor = new Color(166, 134, 77, 30); g.circle(iconX, 0, 13); g.fill();
            g.strokeColor = new Color(212, 180, 117); g.lineWidth = 1.4;
            g.moveTo(iconX - 6, -8); g.lineTo(iconX + 6, -8); g.lineTo(iconX + 6, 4);
            g.lineTo(iconX + 2, 8); g.lineTo(iconX - 6, 8); g.close(); g.stroke();
            g.moveTo(iconX + 2, 8); g.lineTo(iconX + 2, 4); g.lineTo(iconX + 6, 4);
            g.moveTo(iconX - 3, 1); g.lineTo(iconX + 2, 1);
            g.moveTo(iconX - 3, -3); g.lineTo(iconX + 3, -3); g.stroke();
        }

        const centerX = parentUi ? (.5 - parentUi.anchorX) * size.width : 0;
        const centerY = parentUi ? (.5 - parentUi.anchorY) * size.height : 0;
        const topInset = Math.max(64, Math.min(88, size.height * .12));
        this._basePosition.set(centerX, centerY + size.height / 2 - topInset - height / 2, 0);
        this.node.setPosition(this._basePosition);
    }

    protected onRemove(): void {
        Tween.stopAllByTarget(this.node);
        if (this._opacity) {
            Tween.stopAllByTarget(this._opacity);
            tween(this._opacity)
                .to(0.18, { opacity: 0 }, { easing: 'quadIn' })
                .call(() => {
                    this.node.active = false;
                })
                .start();
        } else {
            this.node.active = false;
        }
    }

    public setText(text: string): void {
        const message = text?.trim();
        const repeat = this.node.activeInHierarchy && this.msgLabel?.string === message && (this._opacity?.opacity || 0) > 200;
        this.unscheduleAllCallbacks();
        Tween.stopAllByTarget(this.node);
        if (!message) {
            this.node.active = false;
            return;
        }
        this._opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        if (this._opacity) {
            Tween.stopAllByTarget(this._opacity);
            this._opacity.opacity = repeat ? 255 : 0;
        }

        if (this.msgLabel) {
            this.msgLabel.string = message;
        }

        this.node.active = true;
        this.refreshLayout();
        this.node.setScale(1, 1, 1);

        // 连点同一操作只延长停留，不反复闪烁或堆叠提示。
        if (repeat) {
            this.scheduleOnce(this.onRemove, Math.min(4.5, Math.max(2.2, message.length * .07)));
            return;
        }
        this.node.setPosition(this._basePosition.x, this._basePosition.y + 5, this._basePosition.z);

        tween(this.node)
            .to(0.14, { position: this._basePosition }, { easing: 'quadOut' })
            .start();

        if (this._opacity) {
            tween(this._opacity)
                .to(0.14, { opacity: 255 }, { easing: 'quadOut' })
                .start();
        }

        this.scheduleOnce(this.onRemove, Math.min(4.5, Math.max(2.2, message.length * .07)));
    }
}
