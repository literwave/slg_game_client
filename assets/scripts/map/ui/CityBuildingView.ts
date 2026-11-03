import { Button, Color, Graphics, Label, Node, UITransform } from 'cc';
import { caption, inkSurface, place } from './ManagementStyle';

export const CityColors = {
    paper: new Color(229, 211, 169), gold: new Color(196, 163, 98),
    muted: new Color(158, 151, 125), line: new Color(130, 109, 70, 130),
    jade: new Color(149, 187, 141), red: new Color(219, 139, 111),
};

function bevel(g: Graphics, w: number, h: number, cut = 8): void {
    g.moveTo(-w / 2 + cut, h / 2); g.lineTo(w / 2 - cut, h / 2);
    g.lineTo(w / 2, h / 2 - cut); g.lineTo(w / 2, -h / 2 + cut);
    g.lineTo(w / 2 - cut, -h / 2); g.lineTo(-w / 2 + cut, -h / 2);
    g.lineTo(-w / 2, -h / 2 + cut); g.lineTo(-w / 2, h / 2 - cut); g.close();
}

/** 铜边、暖色衬底共用本页已有插画，不增加纹理加载。 */
export function cityWindowSurface(parent: Node, width: number, height: number): void {
    const g = inkSurface(parent, 'WindowSurface', width, height, null, null);
    g.fillColor = new Color(35, 34, 27); g.strokeColor = CityColors.gold; g.lineWidth = 1;
    bevel(g, width, height, 12); g.fill(); g.stroke();
    for (let y = -height / 2 + 8; y < height / 2 - 8; y += 16) {
        const alpha = Math.round(12 * (y / height + .5));
        g.fillColor = new Color(183, 145, 78, alpha);
        g.rect(-width / 2 + 8, y, width - 16, Math.min(16, height / 2 - 8 - y)); g.fill();
    }
    g.strokeColor = new Color(81, 71, 48); bevel(g, width - 18, height - 18, 8); g.stroke();
}

export function cityCategory(button: Node, text: string, selected: boolean, width: number): void {
    const oldCaption = button.getChildByName('ManagementCaption'); if (oldCaption) oldCaption.active = false;
    const g = inkSurface(button, 'ManagementButton', width, 40, null, null);
    g.fillColor = selected ? new Color(106, 79, 39) : new Color(43, 42, 32);
    g.strokeColor = selected ? CityColors.gold : CityColors.line; g.lineWidth = 1;
    bevel(g, width - 4, 36, 8); g.fill(); g.stroke();
    g.strokeColor = selected ? new Color(238, 205, 139) : new Color(102, 90, 60);
    g.moveTo(-width / 2 + 14, -16); g.lineTo(width / 2 - 14, -16); g.stroke();
    const label = caption(button, 'Label', text, 0, 0, width - 24, 17,
        selected ? CityColors.paper : CityColors.muted, Label.HorizontalAlign.CENTER);
    label.isBold = selected; label.overflow = Label.Overflow.SHRINK;
    const control = button.getComponent(Button); control.target = g.node;
    control.transition = Button.Transition.SCALE; control.zoomScale = .97;
}

export function buildingPlaque(parent: Node, width: number, height: number,
    selected: boolean, complete: boolean, locked: boolean): void {
    const g = inkSurface(parent, 'CardSurface', width, height, null, null);
    g.fillColor = selected ? new Color(76, 59, 34) : complete ? new Color(43, 51, 39) : new Color(48, 46, 34);
    g.strokeColor = selected ? CityColors.gold : new Color(117, 106, 73, 155); g.lineWidth = selected ? 2 : 1;
    bevel(g, width - 2, height - 2, 8); g.fill(); g.stroke();
    g.strokeColor = new Color(176, 147, 87, selected ? 140 : 55); g.lineWidth = 1;
    bevel(g, width - 10, height - 10, 5); g.stroke();
    // 连续庭院底图由面板铺到状态栏上沿，这里只绘制状态栏。
    g.fillColor = new Color(19, 24, 18, 105); g.rect(-width / 2 + 6, -height / 2 + 6, width - 12, 25); g.fill();
    if (selected) {
        g.fillColor = CityColors.gold;
        g.moveTo(-5, height / 2 - 2); g.lineTo(0, height / 2 - 8); g.lineTo(5, height / 2 - 2); g.close(); g.fill();
    }
    const mark = inkSurface(parent, 'LevelSeal', 42, 22, locked ? new Color(46, 43, 33) : new Color(90, 68, 34), CityColors.line);
    mark.node.setPosition(width / 2 - 27, height / 2 - 20);
    mark.node.setSiblingIndex(1);
}

export function cityDetailSurface(parent: Node, width: number, height: number): void {
    const g = inkSurface(parent, 'DetailSurface', width, height, null, null);
    g.fillColor = new Color(39, 39, 29); g.strokeColor = CityColors.line; g.lineWidth = 1;
    bevel(g, width, height, 8); g.fill(); g.stroke();
    g.strokeColor = new Color(132, 111, 71, 75); bevel(g, width - 10, height - 10, 5); g.stroke();
    const footer = -height / 2 + 76;
    g.fillColor = new Color(22, 26, 19, 170); g.rect(-width / 2 + 6, -height / 2 + 6, width - 12, 70); g.fill();
    g.strokeColor = CityColors.line; g.moveTo(-width / 2 + 16, footer); g.lineTo(width / 2 - 16, footer); g.stroke();
}

export function buildingPortrait(parent: Node, width: number, height = 166): void {
    const g = inkSurface(parent, 'PortraitGround', width, height, null, null);
    g.node.setPosition(0, -height / 2); g.node.setSiblingIndex(0);
    // 连续庭院底图承接建筑，不再绘制与建筑尺寸脱节的椭圆投影。
    g.strokeColor = new Color(175, 144, 84, 75); g.lineWidth = 1;
    g.moveTo(-width / 2 + 8, -height / 2 + 1); g.lineTo(width / 2 - 8, -height / 2 + 1); g.stroke();
}

export function cityAction(button: Node, text: string, enabled: boolean, width: number): void {
    const oldCaption = button.getChildByName('ManagementCaption'); if (oldCaption) oldCaption.active = false;
    place(button, button.position.x, button.position.y, width, 46);
    const g = inkSurface(button, 'ManagementButton', width, 46, null, null);
    g.fillColor = enabled ? new Color(133, 91, 40) : new Color(55, 53, 39);
    g.strokeColor = enabled ? CityColors.gold : CityColors.line; g.lineWidth = 1;
    bevel(g, width, 44, 8); g.fill(); g.stroke();
    g.strokeColor = enabled ? new Color(238, 203, 132) : CityColors.line;
    g.moveTo(-width / 2 + 14, 17); g.lineTo(width / 2 - 14, 17); g.stroke();
    g.strokeColor = new Color(52, 42, 23); g.lineWidth = 2;
    g.moveTo(-width / 2 + 11, -18); g.lineTo(width / 2 - 11, -18); g.stroke();
    const label = caption(button, 'Label', text, 0, 0, width - 32, 19,
        enabled ? new Color(255, 232, 181) : CityColors.muted, Label.HorizontalAlign.CENTER);
    label.isBold = enabled; label.overflow = Label.Overflow.SHRINK;
    const control = button.getComponent(Button); control.target = g.node;
    control.transition = Button.Transition.SCALE; control.zoomScale = .97;
}
