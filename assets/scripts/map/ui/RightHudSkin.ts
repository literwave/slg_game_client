import { Button, Color, Graphics, Label, Node, Sprite, UITransform, Widget } from 'cc';

// 侧栏共用的轻量矢量装饰，只在布局或数据变化时重绘。
const ink = new Color(31, 38, 32, 238);
const bronze = new Color(164, 143, 93, 160);
const ivory = new Color(234, 226, 201, 255);

function surface(parent: Node, width: number, height: number): Graphics | null {
    if (!parent || !parent.isValid) return null;
    let node = parent.getChildByName('CommandSkin');
    if (!node) {
        node = new Node('CommandSkin');
        node.layer = parent.layer;
        node.addComponent(UITransform);
        node.addComponent(Graphics);
        parent.addChild(node);
        node.setSiblingIndex(0);
    }
    const ui = node.getComponent(UITransform);
    const graphics = node.getComponent(Graphics);
    if (!ui || !graphics) return null;
    ui.setContentSize(width, height);
    graphics.clear();
    return graphics;
}

function chamfer(g: Graphics, x: number, y: number, w: number, h: number, cut: number): void {
    g.moveTo(x + cut, y);
    g.lineTo(x + w - cut, y);
    g.lineTo(x + w, y + cut);
    g.lineTo(x + w, y + h - cut);
    g.lineTo(x + w - cut, y + h);
    g.lineTo(x + cut, y + h);
    g.lineTo(x, y + h - cut);
    g.lineTo(x, y + cut);
    g.close();
}

export function drawCommandPanel(parent: Node, width: number, height: number, selected: number, tabCount = 3): void {
    const g = surface(parent, width, height);
    if (!g) return;
    const left = -width / 2;
    const bottom = -height / 2;
    const top = height / 2;
    g.fillColor = new Color(13, 18, 13, 64);
    chamfer(g, left - 2, bottom - 3, width + 4, height + 4, 7);
    g.fill();
    g.fillColor = ink;
    chamfer(g, left, bottom, width, height, 6);
    g.fill();
    g.strokeColor = bronze;
    g.lineWidth = 1;
    chamfer(g, left + .5, bottom + .5, width - 1, height - 1, 6);
    g.stroke();
    g.fillColor = new Color(91, 85, 61, 100);
    chamfer(g, left + 3, top - 39, width - 6, 36, 4);
    g.fill();
    g.strokeColor = new Color(171, 151, 104, 95);
    g.moveTo(left + 10, top - 40);
    g.lineTo(-left - 10, top - 40);
    g.stroke();
    if (selected >= 0) {
        const step = (width - 18) / tabCount;
        const x = (selected - (tabCount - 1) / 2) * step;
        g.fillColor = new Color(132, 112, 65, 128);
        g.roundRect(x - step / 2 + 4, top - 34, step - 8, 28, 3);
        g.fill();
        g.strokeColor = new Color(193, 166, 106, 190);
        g.moveTo(x - 22, top - 34);
        g.lineTo(x + 22, top - 34);
        g.stroke();
    }
    g.strokeColor = new Color(207, 182, 119, 185);
    for (const direction of [-1, 1]) {
        const x = direction * (width / 2 - 8);
        g.moveTo(x - direction * 12, top - 2);
        g.lineTo(x, top - 2);
        g.lineTo(x + direction * 5, top - 7);
        g.stroke();
    }
}

export function drawCommandHandle(parent: Node): void {
    const ui = parent?.getComponent(UITransform);
    if (!ui) return;
    const g = surface(parent, ui.width, ui.height);
    if (!g) return;
    g.fillColor = new Color(47, 53, 40, 246);
    chamfer(g, -ui.width / 2, -ui.height / 2, ui.width, ui.height, 4);
    g.fill();
    g.strokeColor = bronze;
    g.lineWidth = 1;
    chamfer(g, -ui.width / 2 + .5, -ui.height / 2 + .5, ui.width - 1, ui.height - 1, 4);
    g.stroke();
}

export function drawCommandRow(parent: Node, expanded = false, status = false): void {
    const ui = parent?.getComponent(UITransform);
    if (!ui) return;
    const g = surface(parent, ui.width, ui.height);
    if (!g) return;
    const left = -ui.width / 2;
    const right = ui.width / 2;
    g.fillColor = expanded ? new Color(139, 119, 71, 56) : new Color(222, 218, 188, 12);
    g.roundRect(left, -ui.height / 2, ui.width, ui.height, 3);
    g.fill();
    g.strokeColor = new Color(157, 145, 102, 72);
    g.lineWidth = 1;
    g.moveTo(left + 5, -ui.height / 2 + .5);
    g.lineTo(right - 5, -ui.height / 2 + .5);
    g.stroke();
    // 军令牌形的编号底座，代替占据整行的大色块。
    g.fillColor = new Color(91, 82, 52, 215);
    g.moveTo(left + 8, 18);
    g.lineTo(left + 36, 18);
    g.lineTo(left + 36, -10);
    g.lineTo(left + 22, -19);
    g.lineTo(left + 8, -10);
    g.close();
    g.fill();
    g.strokeColor = new Color(184, 157, 93, 180);
    g.moveTo(left + 10, 16);
    g.lineTo(left + 34, 16);
    g.stroke();
    if (status) {
        g.fillColor = new Color(149, 137, 96, 38);
        g.roundRect(right - 54, 3, 46, 18, 3);
        g.fill();
    }
    g.strokeColor = new Color(190, 174, 125, 220);
    const x = right - 14;
    const y = status ? -12 : 0;
    g.moveTo(x - 3, y + (expanded ? -2 : 2));
    g.lineTo(x, y + (expanded ? 1 : -1));
    g.lineTo(x + 3, y + (expanded ? -2 : 2));
    g.stroke();
}

export function drawCommandDetail(parent: Node, hasPortrait: boolean): void {
    const ui = parent?.getComponent(UITransform);
    if (!ui) return;
    const g = surface(parent, ui.width, ui.height);
    if (!g) return;
    const left = -ui.width / 2;
    g.fillColor = new Color(20, 28, 23, 88);
    g.roundRect(left, -ui.height / 2, ui.width, ui.height, 3);
    g.fill();

    // 头像和空位共用同一个卡槽，空编队也保持完整的视觉重心。
    const portraitX = left + 35;
    g.fillColor = new Color(28, 35, 28, 255);
    chamfer(g, portraitX - 24, -13, 48, 62, 3);
    g.fill();
    g.strokeColor = new Color(164, 143, 93, 130);
    g.lineWidth = 1;
    chamfer(g, portraitX - 24, -13, 48, 62, 3);
    g.stroke();
    if (!hasPortrait) {
        g.strokeColor = new Color(177, 155, 101, 180);
        g.moveTo(portraitX - 6, 3);
        g.lineTo(portraitX - 6, 34);
        g.stroke();
        g.fillColor = new Color(152, 132, 82, 135);
        g.moveTo(portraitX - 4, 33);
        g.lineTo(portraitX + 12, 31);
        g.lineTo(portraitX + 8, 23);
        g.lineTo(portraitX + 12, 17);
        g.lineTo(portraitX - 4, 19);
        g.close();
        g.fill();
        g.strokeColor = new Color(177, 155, 101, 100);
        g.moveTo(portraitX - 11, 2);
        g.lineTo(portraitX + 3, 2);
        g.stroke();
    }
}

export function styleCommandAction(node: Node, text: string, x: number, width: number, primary: boolean): void {
    const ui = node?.getComponent(UITransform);
    const background = node?.getChildByName('Background');
    const backgroundUi = background?.getComponent(UITransform);
    const label = background?.getComponentInChildren(Label);
    const labelUi = label?.getComponent(UITransform);
    const button = node?.getComponent(Button);
    if (!ui || !background || !backgroundUi || !label || !labelUi || !button) return;

    // 保留原有 Button 和序列化点击事件；只替换视觉及命中区域。
    ui.setAnchorPoint(.5, .5);
    ui.setContentSize(width, 40);
    node.setPosition(x, -32, 0);
    const widget = background.getComponent(Widget);
    if (widget) widget.enabled = false;
    const sprite = background.getComponent(Sprite);
    if (sprite) sprite.enabled = false;
    backgroundUi.setAnchorPoint(.5, .5);
    backgroundUi.setContentSize(width, 40);
    background.setPosition(0, 0, 0);
    background.setScale(1, 1, 1);
    button.target = background;
    button.transition = Button.Transition.SCALE;
    button.zoomScale = .97;
    button.duration = .08;

    const labelWidget = label.getComponent(Widget);
    if (labelWidget) labelWidget.enabled = false;
    labelUi.setAnchorPoint(.5, .5);
    labelUi.setContentSize(width - 24, 32);
    label.node.setPosition(0, 0, 0);
    label.string = text;
    label.fontSize = 13;
    label.lineHeight = 20;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.CLAMP;
    label.enableWrapText = false;
    label.outlineWidth = 0;
    label.color = primary ? new Color(249, 234, 192, 255) : ivory;

    const g = surface(background, width, 40);
    if (!g) return;
    g.fillColor = new Color(10, 16, 11, 80);
    chamfer(g, -width / 2, -18, width, 32, 3);
    g.fill();
    g.fillColor = primary ? new Color(109, 91, 49, 255) : new Color(43, 50, 39, 255);
    chamfer(g, -width / 2, -16, width, 32, 3);
    g.fill();
    g.lineWidth = 1;
    g.strokeColor = primary ? new Color(191, 162, 99, 230) : bronze;
    chamfer(g, -width / 2 + .5, -15.5, width - 1, 31, 3);
    g.stroke();
    g.strokeColor = primary ? new Color(226, 202, 143, 100) : new Color(164, 143, 93, 50);
    g.moveTo(-width / 2 + 5, 13);
    g.lineTo(width / 2 - 5, 13);
    g.stroke();
}

export function setCommandLabel(parent: Node, name: string, text: string, x: number, y: number, width: number, fontSize: number, muted = false): void {
    if (!parent || !parent.isValid) return;
    let node = parent.getChildByName(name);
    if (!node) {
        node = new Node(name);
        node.layer = parent.layer;
        node.addComponent(UITransform);
        node.addComponent(Label);
        parent.addChild(node);
    }
    const ui = node.getComponent(UITransform);
    const label = node.getComponent(Label);
    if (!ui || !label) return;
    node.setPosition(x, y, 0);
    ui.setContentSize(width, 20);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = 20;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = false;
    label.color = muted ? new Color(177, 172, 145, 255) : ivory;
}
