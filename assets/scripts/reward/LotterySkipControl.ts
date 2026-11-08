import { Button, Color, Graphics, Label, Node, Toggle, UITransform, isValid } from 'cc';
import { caption, ManagementColors as C, place } from '../map/ui/ManagementStyle';
import { setSkipLotteryAnimation, skipsLotteryAnimation, watchLotteryAnimation } from './LotteryAnimationSettings';

/** 点将入口的动画偏好；文字和方框共用点击区，重新打开仍保留选择。 */
export default class LotterySkipControl {
    readonly node: Node;
    readonly toggle: Toggle;
    private readonly box: Graphics;
    private readonly label: Label;
    private readonly unwatch: () => void;
    private disposed = false;

    constructor(parent: Node, onChange?: (skip: boolean) => void) {
        this.node = new Node('LotterySkipAnimation');
        this.node.layer = parent.layer;
        this.node.addComponent(UITransform).setContentSize(164, 40);
        parent.addChild(this.node);
        this.toggle = this.node.addComponent(Toggle);
        this.toggle.transition = Button.Transition.NONE;
        this.box = this.node.addComponent(Graphics);
        this.label = caption(this.node, 'SkipLabel', '跳过动画', 17, 0, 114, 16, C.text, Label.HorizontalAlign.LEFT);
        place(this.label.node, 17, 0, 114, 30);
        this.node.on(Toggle.EventType.TOGGLE, this.changed, this);
        this.unwatch = watchLotteryAnimation(skip => { this.render(skip); onChange?.(skip); });
        // 后台预热的父组件可能从未触发 onLoad，不能仅依赖它的 onDestroy 清理订阅。
        this.node.on(Node.EventType.NODE_DESTROYED, this.dispose, this);
        this.render(skipsLotteryAnimation());
    }

    private changed(): void { setSkipLotteryAnimation(this.toggle.isChecked); }

    private render(checked: boolean): void {
        if (this.disposed || !isValid(this.node, true)) return;
        this.toggle.setIsCheckedWithoutNotify(checked);
        const g = this.box, gold = new Color(232, 195, 121);
        g.clear(); g.lineWidth = 1.5;
        g.fillColor = checked ? new Color(108, 83, 43) : new Color(28, 34, 31);
        g.strokeColor = checked ? gold : new Color(139, 139, 116);
        g.roundRect(-68, -11, 22, 22, 3); g.fill(); g.stroke();
        if (checked) {
            g.strokeColor = new Color(255, 234, 182); g.lineWidth = 2.6;
            g.moveTo(-64, 0); g.lineTo(-59, -5); g.lineTo(-50, 6); g.stroke();
        }
        this.label.color = checked ? gold : C.text;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unwatch();
        if (isValid(this.node, true)) {
            this.node.off(Toggle.EventType.TOGGLE, this.changed, this);
            this.node.off(Node.EventType.NODE_DESTROYED, this.dispose, this);
        }
    }
}
