import { Button, Color, Graphics, Label, Node, Sprite } from 'cc';
import LoginCommand from '../../login/LoginCommand';
import { caption, inkSurface, ManagementColors as C, place } from './ManagementStyle';

const MEDALS = [new Color(232, 193, 109), new Color(192, 207, 209), new Color(196, 140, 98)];
const DARK_METALS = [new Color(97, 71, 31), new Color(61, 74, 77), new Color(91, 56, 38)];
export interface RankEntry { rank?: number; name?: string; score?: unknown; headIcon?: number; }

function node(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
    const n = new Node(name); n.layer = parent.layer; parent.addChild(n); place(n, x, y, w, h); return n;
}

function text(parent: Node, name: string, value: string, x: number, y: number, w: number,
    size = 18, color = C.text, align = Label.HorizontalAlign.LEFT): Label {
    const label = caption(parent, name, value, x, y, w, size, color, align);
    label.overflow = Label.Overflow.SHRINK;
    return label;
}

/** 前三名用带绶带的金银铜徽章，后续名次保留清晰的单个数字。 */
function medal(parent: Node, rank: number, x: number, small: boolean): void {
    const emblem = node(parent, 'RankBadge', x, 0, 66, 64);
    const g = emblem.addComponent(Graphics);
    const top = rank >= 1 && rank <= 3, metal = top ? MEDALS[rank - 1] : C.muted;
    if (top) {
        g.fillColor = new Color(87, 44, 34);
        for (const side of [-1, 1]) {
            g.moveTo(side * 4, -10); g.lineTo(side * 22, -28);
            g.lineTo(side * 22, -15); g.lineTo(side * 30, -17); g.lineTo(side * 15, 4);
            g.lineTo(side * 4, -10); g.fill();
        }
        g.fillColor = DARK_METALS[rank - 1]; g.strokeColor = metal; g.lineWidth = 2;
        g.circle(0, 2, 22); g.fill(); g.stroke();
        g.lineWidth = 1; g.circle(0, 2, 18); g.stroke();
        // 两侧麦穗与顶部冠尖使用轻量几何，不增加进图图片请求。
        g.fillColor = metal;
        for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
            const px = side * (26 - i * 1.5), py = -12 + i * 8;
            g.moveTo(px, py - 4); g.lineTo(px + side * 5, py + 2);
            g.lineTo(px, py + 5); g.lineTo(px, py - 4); g.fill();
        }
        if (rank === 1) {
            g.moveTo(-12, 22); g.lineTo(-15, 33); g.lineTo(-5, 28); g.lineTo(0, 37);
            g.lineTo(5, 28); g.lineTo(15, 33); g.lineTo(12, 22); g.lineTo(-12, 22); g.fill();
        }
    } else {
        g.fillColor = C.inset; g.strokeColor = C.line; g.lineWidth = 1;
        g.moveTo(-17, 23); g.lineTo(17, 23); g.lineTo(17, -14); g.lineTo(0, -25);
        g.lineTo(-17, -14); g.lineTo(-17, 23); g.fill(); g.stroke();
    }
    text(emblem, 'RankNumber', rank > 0 ? String(rank) : '—', 0, top ? 2 : 0, 38, top ? 25 : 21, metal, Label.HorizontalAlign.CENTER);
    if (small) emblem.setScale(.78, .78, 1);
}

function avatar(parent: Node, entry: RankEntry, x: number, size: number, border: Color): void {
    const frame = node(parent, 'Portrait', x, 0, size, size);
    inkSurface(frame, 'Frame', size, size, C.inset, border);
    const fallback = text(frame, 'Initial', Array.from(entry.name || '将')[0], 0, 0, size - 8, 24, C.gold, Label.HorizontalAlign.CENTER);
    const picture = node(frame, 'Image', 0, 0, size - 6, size - 6);
    const sprite = picture.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    const icons = LoginCommand.getInstance().headIcons, id = icons.getDisplayId(entry.headIcon);
    sprite.spriteFrame = icons.getIcon(id);
    if (sprite.spriteFrame) fallback.node.active = false;
    else icons.loadIcon(id).then(image => {
        if (sprite.isValid && image) { sprite.spriteFrame = image; fallback.node.active = false; }
    });
}

export function rankColumns(parent: Node, width: number, metric: string, alliance = false): void {
    const narrow = width < 500;
    text(parent, 'RankColumn', '名次', -width / 2 + (narrow ? 26 : 42), 0, 64, 13, C.muted, Label.HorizontalAlign.CENTER);
    const nameLeft = -width / 2 + (narrow ? 108 : 144);
    text(parent, 'PlayerColumn', alliance ? '同盟' : '主公', nameLeft + 40, 0, 80, 13, C.muted);
    if (!narrow) text(parent, 'ScoreColumn', metric, width / 2 - 28 - 90, 0, 180, 13, C.gold, Label.HorizontalAlign.RIGHT);
    const g = parent.addComponent(Graphics); g.strokeColor = C.line; g.lineWidth = 1;
    g.moveTo(-width / 2 + 12, -17); g.lineTo(width / 2 - 12, -17); g.stroke();
}

export function rankRow(parent: Node, width: number, entry: RankEntry, metric: string,
    self = false, alliance = false): void {
    const narrow = width < 500, height = self ? 70 : 82;
    const rank = Number(entry.rank) || 0, top = rank >= 1 && rank <= 3;
    const metal = top ? MEDALS[rank - 1] : C.line;
    const fill = self ? new Color(58, 51, 33) : top ? new Color(45 + (3 - rank) * 3, 44, 33) : C.panel;
    inkSurface(parent, 'Surface', width, height, fill, self ? C.gold : top ? metal : C.line);
    const edge = node(parent, 'Accent', -width / 2 + 3, 0, 3, height - 16);
    inkSurface(edge, 'Line', 3, height - 16, self ? C.gold : metal, null);
    medal(parent, rank, -width / 2 + (narrow ? 26 : 42), narrow || self);
    if (alliance) {
        const emblem = node(parent, 'AllianceSeal', -width / 2 + (narrow ? 76 : 108), 0, 46, 46);
        inkSurface(emblem, 'Frame', 46, 46, C.inset, metal);
        text(emblem, 'Symbol', '盟', 0, 0, 40, 24, C.gold, Label.HorizontalAlign.CENTER);
    } else avatar(parent, entry, -width / 2 + (narrow ? 76 : 108), self || narrow ? 46 : 56, metal);
    const nameLeft = -width / 2 + (narrow ? 108 : 148);
    const scoreWidth = Math.min(190, width * .24), scoreRight = width / 2 - 28;
    const nameRight = narrow ? width / 2 - 12 : scoreRight - scoreWidth - 24;
    const nameWidth = Math.max(20, nameRight - nameLeft);
    const name = text(parent, 'PlayerName', entry.name || '无名主公', nameLeft + nameWidth / 2,
        self || narrow ? 12 : 0, nameWidth, narrow ? 16 : 20, self ? C.gold : C.text);
    name.isBold = true;
    const score = String(entry.score ?? '—');
    if (narrow) {
        text(parent, 'Score', `${metric} ${score}`, nameLeft + nameWidth / 2, -15, nameWidth, 13, C.gold);
    } else {
        const label = text(parent, 'Score', score, scoreRight - scoreWidth / 2, 0, scoreWidth, 23,
            top || self ? C.gold : C.text, Label.HorizontalAlign.RIGHT);
        label.isBold = true;
    }
    if (self && !narrow) text(parent, 'SelfLabel', rank ? '我的排名' : '我的排名 · 暂未上榜',
        nameLeft + nameWidth / 2, -16, nameWidth, 12, C.muted);
    if (self && narrow) name.string = '我的排名' + (rank ? '' : ' · 未上榜');
}

export function rankTitleTrim(parent: Node, width: number): void {
    const g = parent.getComponent(Graphics) || parent.addComponent(Graphics);
    g.clear(); g.strokeColor = C.gold; g.lineWidth = 1;
    // 冠饰与两侧铜叶呼应榜单奖章；窄屏让出关闭按钮的空间。
    g.fillColor = new Color(113, 83, 38);
    g.moveTo(-13, 18); g.lineTo(-15, 25); g.lineTo(-5, 21); g.lineTo(0, 28);
    g.lineTo(5, 21); g.lineTo(15, 25); g.lineTo(13, 18); g.lineTo(-13, 18); g.fill(); g.stroke();
    g.moveTo(-10, -22); g.lineTo(10, -22); g.stroke();
    if (width < 430) return;
    const inner = 105, outer = Math.min(245, width / 2 - 84);
    for (const side of [-1, 1]) {
        g.strokeColor = new Color(149, 126, 78); g.lineWidth = 1;
        g.moveTo(side * inner, -2); g.lineTo(side * (outer - 12), -2); g.lineTo(side * outer, 4); g.stroke();
        g.strokeColor = C.line;
        g.moveTo(side * (inner + 16), -7); g.lineTo(side * (outer - 23), -7); g.stroke();
        g.strokeColor = C.gold;
        g.moveTo(side * 61, -16); g.lineTo(side * 79, -4); g.lineTo(side * 87, 13); g.stroke();
        g.fillColor = new Color(179, 147, 85);
        for (let i = 0; i < 3; i++) {
            const x = side * (69 + i * 7), y = -10 + i * 8;
            g.moveTo(x, y); g.lineTo(x + side * 9, y + 2); g.lineTo(x + side * 6, y + 6); g.lineTo(x, y); g.fill();
        }
    }
}

function rankTabIcon(parent: Node, index: number, x: number, selected: boolean): void {
    let emblem = parent.getChildByName('CategoryIcon');
    if (!emblem) { emblem = node(parent, 'CategoryIcon', x, 0, 34, 34); emblem.addComponent(Graphics); }
    place(emblem, x, 0, 34, 34);
    const g = emblem.getComponent(Graphics); g.clear();
    const metal = selected ? new Color(237, 202, 135) : new Color(146, 145, 119);
    g.fillColor = new Color(28, 31, 24); g.strokeColor = selected ? C.gold : C.line; g.lineWidth = 1;
    g.circle(0, 0, 16); g.fill(); g.stroke();
    g.fillColor = metal; g.strokeColor = metal;
    if (index === 0) {
        for (const side of [-1, 1]) {
            g.moveTo(-side * 6, -7); g.lineTo(side * 8, 10); g.lineTo(side * 12, 13);
            g.lineTo(side * 11, 7); g.lineTo(-side * 3, -9); g.lineTo(-side * 6, -7); g.fill();
            g.lineWidth = 2;
            g.moveTo(-side * 10, -5); g.lineTo(-side * 1, -12); g.stroke();
            g.moveTo(-side * 6, -9); g.lineTo(-side * 10, -13); g.stroke();
        }
    } else {
        g.rect(-10, -11, 20, 10); g.fill(); g.rect(-6, 1, 12, 6); g.fill();
        g.moveTo(-13, 1); g.lineTo(-7, 5); g.lineTo(0, 12); g.lineTo(7, 5); g.lineTo(13, 1); g.lineTo(-13, 1); g.fill();
        g.fillColor = new Color(28, 31, 24); g.rect(-2, -11, 4, 7); g.fill();
        g.strokeColor = new Color(28, 31, 24); g.lineWidth = 1; g.moveTo(-8, -3); g.lineTo(8, -3); g.stroke();
    }
}

/** 页签只承载榜单切换，保留原按钮回调与列表更新策略。 */
export function rankTabs(parent: Node, width: number, selected: number): void {
    const names = ['战力榜', '主城榜', '歼敌榜', '同盟榜'];
    const gap = 6, tabWidth = Math.min(216, (width - gap * (names.length - 1)) / names.length);
    const rail = inkSurface(parent, 'RankTabRail', width, 44, null, null);
    rail.node.setSiblingIndex(0); rail.strokeColor = C.line; rail.lineWidth = 1;
    rail.moveTo(-width / 2 + 8, -19); rail.lineTo(width / 2 - 8, -19); rail.stroke();
    for (let i = 0; i < names.length; i++) {
        const button = parent.getChildByName(`Filter${i}`); if (!button) continue;
        const active = i === selected;
        place(button, (i - (names.length - 1) / 2) * (tabWidth + gap), 0, tabWidth, 44);
        const g = inkSurface(button, 'ManagementButton', tabWidth, 44, null, null);
        g.fillColor = active ? new Color(73, 58, 34) : new Color(34, 39, 30);
        g.strokeColor = active ? C.gold : C.line; g.lineWidth = 1;
        g.moveTo(-tabWidth / 2 + 8, 19); g.lineTo(tabWidth / 2 - 8, 19);
        g.lineTo(tabWidth / 2, 11); g.lineTo(tabWidth / 2, -19);
        g.lineTo(-tabWidth / 2, -19); g.lineTo(-tabWidth / 2, 11); g.lineTo(-tabWidth / 2 + 8, 19);
        g.fill(); g.stroke();
        if (active) {
            g.strokeColor = new Color(237, 202, 135); g.lineWidth = 2;
            g.moveTo(-tabWidth / 2 + 5, -19); g.lineTo(tabWidth / 2 - 5, -19); g.stroke();
            g.fillColor = C.gold;
            g.moveTo(-5, -21); g.lineTo(0, -26); g.lineTo(5, -21); g.lineTo(-5, -21); g.fill();
        }
        const compact = tabWidth < 150, iconX = -tabWidth / 2 + 26;
        if (!compact && i < 2) rankTabIcon(button, i, iconX, active);
        const emblem = button.getChildByName('CategoryIcon'); if (emblem) emblem.active = !compact && i < 2;
        const label = button.getComponentInChildren(Label);
        const hasIcon = !compact && i < 2, labelWidth = tabWidth - (hasIcon ? 62 : 12);
        place(label.node, hasIcon ? 20 : 0, 0, labelWidth, 30);
        label.string = names[i];
        label.fontSize = compact ? 14 : 17; label.isBold = active; label.overflow = Label.Overflow.SHRINK;
        label.color = active ? new Color(250, 228, 181) : C.muted;
        const control = button.getComponent(Button); control.target = g.node;
        control.transition = Button.Transition.SCALE; control.zoomScale = .97;
    }
}
