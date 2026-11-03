import { Color, Graphics, Node, UIOpacity } from 'cc';
import { inkSurface } from './ManagementStyle';

export type TroopAttributeIcon = 'soldiers' | 'reserve' | 'wounded' | 'march' | 'attack' | 'bonus' | 'reinforce' | 'formation';

const GOLD = new Color(203, 168, 103);
const LIGHT = new Color(244, 220, 163);
const BRONZE = new Color(133, 105, 60);
const INK = new Color(47, 42, 30);
const JADE = new Color(139, 163, 120);

function shape(g: Graphics, points: number[][], color: Color): void {
    g.fillColor = color;
    g.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) g.lineTo(x, y);
    g.close(); g.fill();
}

/** 甲士用汉式兜鍪、护颈和肩甲辨认，避免所有兵力状态都套同一面盾牌。 */
function soldier(g: Graphics, x: number, y: number, scale = 1, rear = false): void {
    const points = (p: number[][]) => p.map(([px, py]) => [x + px * scale, y + py * scale]);
    const base = rear ? BRONZE : GOLD;
    shape(g, points([[-7, -3], [-15, -8], [-16, -15], [16, -15], [15, -8], [7, -3], [0, -7]]), base);
    shape(g, points([[-8, 4], [-8, 10], [-4, 15], [0, 17], [4, 15], [8, 10], [8, 4], [12, 1], [10, -7], [6, -9], [6, 2], [-6, 2], [-6, -9], [-10, -7], [-12, 1]]), base);
    shape(g, points([[-8, 5], [8, 5], [8, 2], [-8, 2]]), rear ? GOLD : LIGHT);
    shape(g, points([[-1, 16], [1, 16], [2, 5], [-2, 5]]), rear ? GOLD : LIGHT);
    shape(g, points([[-5, 0], [5, 0], [4, -5], [0, -8], [-4, -5]]), INK);
    shape(g, points([[-8, -9], [0, -12], [8, -9], [7, -13], [0, -16], [-7, -13]]), rear ? GOLD : LIGHT);
}

/** 专用于部队界面的铜金色实形图标；40 单位画布缩放后仍保留清楚的主体轮廓。 */
export function troopAttributeIcon(parent: Node, name: string, kind: TroopAttributeIcon,
    x: number, y: number, size: number, muted = false): Node {
    const g = inkSurface(parent, name, 40, 40, null, null);
    g.node.setPosition(x, y, 0);
    g.node.setScale(size / 40, size / 40, 1);
    g.node.setSiblingIndex(parent.children.length - 1);
    const opacity = g.node.getComponent(UIOpacity) || g.node.addComponent(UIOpacity);
    opacity.opacity = muted ? 150 : 255;

    if (kind === 'soldiers' || kind === 'reinforce') {
        soldier(g, kind === 'reinforce' ? -3 : 0, 1, kind === 'reinforce' ? .85 : 1);
        if (kind === 'reinforce') {
            g.fillColor = INK; g.circle(11, -10, 9); g.fill();
            g.fillColor = LIGHT; g.roundRect(9.5, -16, 3, 12, 1); g.roundRect(5, -11.5, 12, 3, 1); g.fill();
        }
    } else if (kind === 'reserve' || kind === 'formation') {
        soldier(g, -11, 4, .58, true); soldier(g, 11, 4, .58, true);
        soldier(g, 0, -4, .83);
    } else if (kind === 'march') {
        // 成年披甲战马：长口鼻、厚弓颈、短耳和马面甲，避免幼马式大眼细颈。
        g.fillColor = BRONZE;
        g.moveTo(-17, -18); g.bezierCurveTo(-17, -5, -15, 9, -8, 14);
        g.lineTo(-5, 16); g.lineTo(-4, 20); g.lineTo(0, 15);
        g.lineTo(3, 19); g.lineTo(6, 12);
        g.bezierCurveTo(8, 8, 11, 6, 15, 3); g.lineTo(19, -2);
        g.bezierCurveTo(20, -5, 17, -8, 12, -7); g.lineTo(6, -3); g.lineTo(3, -6);
        g.bezierCurveTo(3, -11, 7, -16, 9, -18); g.close(); g.fill();
        shape(g, [[-6, 15], [-12, 10], [-13, 6], [-16, 4], [-14, 0], [-18, -3], [-15, -6], [-19, -10], [-16, -14], [-17, -18], [-10, -18], [-8, -9], [-10, 0], [-6, 7]], INK);

        // 颈甲占据较大的视觉面积，缩到小图标仍能看出军马的厚重感。
        g.fillColor = GOLD;
        g.moveTo(-6, 10); g.bezierCurveTo(-12, 2, -13, -9, -12, -17);
        g.lineTo(6, -17); g.bezierCurveTo(0, -10, 0, -4, 1, 1);
        g.lineTo(-2, 8); g.close(); g.fill();
        g.strokeColor = BRONZE; g.lineWidth = 2;
        for (const y of [-3, -8, -13]) {
            g.moveTo(-11, y + 2); g.lineTo(-5, y); g.lineTo(1, y + 1);
        }
        g.stroke();
        g.strokeColor = LIGHT; g.lineWidth = 1;
        g.moveTo(-10, -15); g.lineTo(-5, -16); g.lineTo(2, -15); g.stroke();

        shape(g, [[-2, 13], [5, 13], [8, 8], [14, 3], [16, -2], [12, -3], [6, 1], [3, -1], [-2, 5]], new Color(199, 190, 159));
        shape(g, [[-2, 13], [0, 14], [5, 12], [8, 7], [14, 2], [12, 2], [5, 8], [1, 11]], LIGHT);
        shape(g, [[1, 4], [6, 3], [8, -2], [3, -5], [-1, -1]], new Color(160, 146, 108));
        shape(g, [[12, 3], [18, -2], [17, -5], [12, -5], [9, -2]], GOLD);
        shape(g, [[2, 9], [6, 9], [5, 7], [3, 7]], INK);
        g.fillColor = INK; g.ellipse(16, -3, 1.3, .8); g.fill();
        g.strokeColor = INK; g.lineWidth = 1.8;
        g.moveTo(-2, 10); g.lineTo(4, 1); g.lineTo(8, -3);
        g.moveTo(10, 3); g.lineTo(9, -4); g.stroke();
        g.strokeColor = LIGHT; g.lineWidth = 1.2; g.circle(7, -2, 2); g.stroke();
    } else if (kind === 'attack') {
        shape(g, [[-11, -14], [-7, -17], [-2, -9], [-6, -6]], BRONZE);
        shape(g, [[-5, -6], [0, -9], [13, 7], [16, 19], [6, 14]], GOLD);
        shape(g, [[-2, -5], [1, -5], [12, 10], [16, 19], [9, 13]], LIGHT);
        shape(g, [[-10, -3], [-8, 0], [3, -9], [1, -12]], LIGHT);
        shape(g, [[-12, -13], [-9, -15], [-14, -20], [-18, -16]], new Color(151, 79, 51));
    } else if (kind === 'wounded') {
        shape(g, [[-17, 0], [-2, 15], [17, -1], [2, -16]], BRONZE);
        shape(g, [[-15, 1], [-2, 13], [15, -1], [2, -13]], new Color(222, 205, 166));
        g.strokeColor = new Color(150, 128, 89); g.lineWidth = 2;
        for (const offset of [-7, -1, 5]) { g.moveTo(offset - 4, 7); g.lineTo(offset + 7, -5); }
        g.stroke();
        shape(g, [[-3, 4], [1, 5], [5, 1], [1, -3], [-3, 0]], LIGHT);
    } else if (kind === 'bonus') {
        g.fillColor = BRONZE; g.roundRect(-14, -13, 28, 27, 3); g.fill();
        for (const offset of [-10, -4, 2, 8]) {
            g.fillColor = GOLD; g.roundRect(offset, -12, 4, 26, 1); g.fill();
            g.fillColor = LIGHT; g.rect(offset, 10, 4, 2); g.fill();
        }
        g.strokeColor = INK; g.lineWidth = 2.5;
        g.moveTo(-14, 5); g.lineTo(14, 5); g.moveTo(-14, -7); g.lineTo(14, -7); g.stroke();
        shape(g, [[3, -2], [12, 0], [18, -7], [9, -16], [1, -9]], muted ? BRONZE : JADE);
        g.strokeColor = LIGHT; g.lineWidth = 1.5; g.moveTo(6, -7); g.lineTo(9, -10); g.lineTo(13, -5); g.stroke();
    }
    return g.node;
}
