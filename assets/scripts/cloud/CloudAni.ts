
import { _decorator, Component, Node, UITransform, UIOpacity, Vec3, Tween, tween, view } from 'cc';
const { ccclass, property } = _decorator;


@ccclass('CloudAni')
export class CloudAni extends Component {
    
    @property(Node)
    leftNode: Node = null;

    @property(Node)
    rightNode: Node = null;

    onEnable(): void {
        this.play();
    }

    onDisable(): void {
        this.stopMotion();
    }

    /** 连续定位时也从完整云幕重新展开，避免沿用上一轮的边角云和关闭回调。 */
    play(): void {
        if (!this.node.active) {
            this.node.active = true;
            return; // onEnable starts the new transition.
        }
        this.stopMotion();
        const left = this.cloudBounds(this.leftNode);
        const right = this.cloudBounds(this.rightNode);
        if (!left || !right) {
            this.node.active = false;
            return;
        }

        const size = this.node.parent?.getComponent(UITransform)?.contentSize || view.getVisibleSize();
        this.node.getComponent(UITransform)?.setContentSize(size.width, size.height);
        const halfWidth = size.width / 2;
        const overlap = 64;
        const padding = 32;
        const scale = Math.max(
            (size.height + padding * 2) / Math.min(left.height, right.height),
            (halfWidth + overlap + padding) / Math.min(left.width, right.width),
        );
        const leftY = -(left.minY + left.maxY) * scale / 2;
        const rightY = -(right.minY + right.maxY) * scale / 2;
        this.leftNode.setScale(scale, scale, 1);
        this.rightNode.setScale(scale, scale, 1);
        this.leftNode.setPosition(overlap - left.maxX * scale, leftY, 0);
        this.rightNode.setPosition(-overlap - right.minX * scale, rightY, 0);

        const opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        opacity.opacity = 255;
        // 按最外侧云朵计算出屏距离，不能用分组节点的占位尺寸或固定终点。
        tween(this.leftNode).to(0.5, {
            position: new Vec3(-halfWidth - padding - left.maxX * scale, leftY, 0),
        }).start();
        tween(opacity).delay(0.34).to(0.16, { opacity: 0 }).start();
        tween(this.rightNode).to(0.5, {
            position: new Vec3(halfWidth + padding - right.minX * scale, rightY, 0),
        }).call(() => { this.node.active = false; }).start();
    }

    private stopMotion(): void {
        this.unscheduleAllCallbacks();
        if (this.leftNode) Tween.stopAllByTarget(this.leftNode);
        if (this.rightNode) Tween.stopAllByTarget(this.rightNode);
        const opacity = this.node.getComponent(UIOpacity);
        if (opacity) Tween.stopAllByTarget(opacity);
    }

    private cloudBounds(panel: Node): {
        minX: number; maxX: number; minY: number; maxY: number; width: number; height: number;
    } | null {
        if (!panel) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        // 预制体中的云朵都是分组的直接子节点；分组自身的 100×100 框不代表云幕范围。
        for (const child of panel.children) {
            const transform = child.getComponent(UITransform);
            if (!child.active || !transform) continue;
            const rect = transform.getBoundingBox();
            minX = Math.min(minX, rect.xMin);
            maxX = Math.max(maxX, rect.xMax);
            minY = Math.min(minY, rect.yMin);
            maxY = Math.max(maxY, rect.yMax);
        }
        if (!(maxX > minX && maxY > minY)) return null;
        return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
    }
}


