import { Color, Graphics, Node, UIOpacity, UITransform } from 'cc';

/** 地图上的线宽按屏幕尺寸补偿；几何轮廓始终贴合原地块。 */
export function tileInk(parent: Node, name: string, width: number, height: number): Graphics {
    let node = parent.getChildByName(name);
    if (!node) {
        node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform); node.addComponent(Graphics);
    }
    node.getComponent(UITransform).setContentSize(width, height);
    const ink = node.getComponent(Graphics); ink.clear();
    return ink;
}

export function diamond(ink: Graphics, x: number, y: number): void {
    ink.moveTo(0, y); ink.lineTo(x, 0); ink.lineTo(0, -y); ink.lineTo(-x, 0); ink.close();
}

export function paintTileSelection(parent: Node, width: number, height: number, zoom: number): UIOpacity {
    const unit = Math.max(.45, Math.min(zoom, Math.min(width, height) / 22));
    const x = width / 2, y = height / 2;
    const g = tileInk(parent, 'SelectionOutline', width, height);
    g.fillColor = new Color(236, 215, 161, 12);
    diamond(g, x, y); g.fill();
    // 暗衬线隔开草地/山石，金色实线始终可见，不跟随呼吸淡出。
    g.lineWidth = 4 * unit; g.strokeColor = new Color(45, 44, 31, 125);
    diamond(g, x, y); g.stroke();
    g.lineWidth = 2 * unit; g.strokeColor = new Color(255, 229, 161, 245);
    diamond(g, x, y); g.stroke();
    g.lineWidth = .7 * unit; g.strokeColor = new Color(246, 229, 184, 70);
    diamond(g, x * .89, y * .89); g.stroke();

    const glow = tileInk(parent, 'SelectionPulse', width, height);
    // 亮角用于识别当前选中；底色保持浅薄，不靠整格染深来强调。
    const corners = [[0, y], [x, 0], [0, -y], [-x, 0]];
    glow.lineWidth = 2.6 * unit; glow.strokeColor = new Color(255, 244, 209, 240);
    for (let i = 0; i < 4; i++) {
        const a = corners[(i + 3) % 4], b = corners[i], c = corners[(i + 1) % 4];
        glow.moveTo(b[0] + (a[0] - b[0]) * .15, b[1] + (a[1] - b[1]) * .15);
        glow.lineTo(b[0], b[1]);
        glow.lineTo(b[0] + (c[0] - b[0]) * .15, b[1] + (c[1] - b[1]) * .15); glow.stroke();
    }
    return glow.node.getComponent(UIOpacity) || glow.node.addComponent(UIOpacity);
}
