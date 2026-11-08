import { Button, Color, Graphics, Label, Node, Sprite, SpriteFrame, UITransform, resources } from 'cc';
import { RewardPreview, taskRewardPresentation } from '../../progression/ProgressionPresentation';
import { rewardQualityStyle } from '../../common/RewardQuality';
import { caption, inkSurface, ManagementColors as C, place } from './ManagementStyle';

const JADE = new Color(143, 195, 149);
const frames = new Map<string, SpriteFrame>();
const pending = new Map<string, Promise<SpriteFrame | null>>();
function node(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
    const n = new Node(name); n.layer = parent.layer; parent.addChild(n); place(n, x, y, w, h); return n;
}
function bevel(g: Graphics, w: number, h: number, cut = 7): void {
    g.moveTo(-w / 2 + cut, h / 2); g.lineTo(w / 2 - cut, h / 2);
    g.lineTo(w / 2, h / 2 - cut); g.lineTo(w / 2, -h / 2 + cut);
    g.lineTo(w / 2 - cut, -h / 2); g.lineTo(-w / 2 + cut, -h / 2);
    g.lineTo(-w / 2, -h / 2 + cut); g.lineTo(-w / 2, h / 2 - cut); g.lineTo(-w / 2 + cut, h / 2);
}
function trim(parent: Node, name: string, w: number, h: number): Graphics {
    return inkSurface(parent, name, w, h, null, null);
}

/** 视图尺寸由奖励数量决定；窄屏将奖励移到目标下方，领取区始终独立。 */
export function taskCardLayout(width: number, rewards: number) {
    const narrow = width < 660, infoWidth = narrow ? width : Math.min(370, Math.floor(width * .46));
    const rewardWidth = narrow ? width - 152 : width - infoWidth - 156;
    const columns = Math.max(1, Math.floor((rewardWidth + 8) / 76));
    const rows = Math.max(1, Math.ceil(rewards / columns));
    return { narrow, infoWidth, rewardWidth, columns, height: narrow ? 140 + rows * 84 : Math.max(156, 44 + rows * 84) };
}

export function taskWindowTrim(parent: Node, width: number, height: number, titleWidth = 96): void {
    const g = trim(parent, 'TaskWindowTrim', width, height);
    g.node.setSiblingIndex(1);
    g.strokeColor = C.line; g.lineWidth = 1; bevel(g, width - 10, height - 10, 12); g.stroke();
    g.strokeColor = C.gold; g.lineWidth = 2;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        g.moveTo(sx * (width / 2 - 32), sy * (height / 2 - 5));
        g.lineTo(sx * (width / 2 - 17), sy * (height / 2 - 5));
        g.lineTo(sx * (width / 2 - 5), sy * (height / 2 - 17));
        g.lineTo(sx * (width / 2 - 5), sy * (height / 2 - 32));
    }
    g.stroke();
    const plateWidth = Math.min(360, width - 112);
    const plate = trim(parent, 'TaskTitlePlate', plateWidth, 44); plate.node.setPosition(0, height / 2 - 31);
    plate.node.setSiblingIndex(2);
    const titleInset = Math.max(60, titleWidth / 2 + 12);
    // 标题使用对称铜饰，不与下方页签共用按钮底板。
    for (const side of [-1, 1]) {
        if (plateWidth / 2 < titleInset + 24) continue;
        plate.strokeColor = C.gold; plate.lineWidth = 1.5;
        plate.moveTo(side * titleInset, 0); plate.lineTo(side * (plateWidth / 2 - 14), 0);
        plate.lineTo(side * (plateWidth / 2 - 6), 6); plate.stroke();
        plate.strokeColor = C.line; plate.lineWidth = 1;
        plate.moveTo(side * (titleInset + 16), -5); plate.lineTo(side * (plateWidth / 2 - 20), -5); plate.stroke();
        plate.fillColor = C.gold;
        plate.moveTo(side * (titleInset - 8), 0); plate.lineTo(side * (titleInset - 3), 5); plate.lineTo(side * (titleInset + 2), 0);
        plate.lineTo(side * (titleInset - 3), -5); plate.lineTo(side * (titleInset - 8), 0); plate.fill();
    }
    plate.strokeColor = C.line;
    plate.moveTo(-22, -21); plate.lineTo(22, -21); plate.stroke();
    // 动态窗口可能先画装饰、后创建标题，不能因此中断整个界面绘制。
    const title = parent.getChildByName('Title');
    if (!title) return;
    title.setSiblingIndex(parent.children.length - 1);
    const label = title.getComponent(Label);
    if (!label) return;
    label.fontSize = 28; label.isBold = true;
    label.color = new Color(243, 220, 170); label.outlineColor = new Color(14, 20, 14); label.outlineWidth = 1;
}

export function gameCloseButton(button: Node, x: number, y: number): void {
    place(button, x, y, 44, 44);
    const oldText = button.getComponentInChildren(Label); if (oldText) oldText.node.active = false;
    const oldBackground = button.getChildByName('Background'); if (oldBackground) oldBackground.active = false;
    const g = trim(button, 'ManagementButton', 44, 44);
    g.fillColor = new Color(46, 40, 29); g.strokeColor = C.gold; g.lineWidth = 1;
    bevel(g, 38, 38, 8); g.fill(); g.stroke();
    g.strokeColor = new Color(99, 81, 49); bevel(g, 30, 30, 6); g.stroke();
    g.strokeColor = C.text; g.lineWidth = 2;
    g.moveTo(-7, -7); g.lineTo(7, 7); g.moveTo(-7, 7); g.lineTo(7, -7); g.stroke();
    const control = button.getComponent(Button); control.target = g.node;
    control.transition = Button.Transition.SCALE; control.zoomScale = .92; control.duration = .08;
}

export function taskTab(button: Node, selected: boolean, width = button.parent.getComponent(UITransform).width / 3): void {
    const g = button.getChildByName('ManagementButton').getComponent(Graphics);
    const w = width;
    place(button, button.position.x, 0, w, 44); place(g.node, 0, 0, w, 44); g.clear();
    if (selected) {
        g.fillColor = new Color(77, 62, 37);
        g.moveTo(-w / 2 + 4, -21); g.lineTo(-w / 2 + 19, 17);
        g.lineTo(w / 2 - 19, 17); g.lineTo(w / 2 - 4, -21); g.lineTo(-w / 2 + 4, -21); g.fill();
        g.strokeColor = C.line; g.lineWidth = 1;
        g.moveTo(-w / 2 + 19, 17); g.lineTo(w / 2 - 19, 17); g.stroke();
        g.strokeColor = new Color(235, 201, 134); g.lineWidth = 2;
        g.moveTo(-w / 2 + 8, -21); g.lineTo(w / 2 - 8, -21); g.stroke();
        g.fillColor = C.gold;
        g.moveTo(-5, -21); g.lineTo(0, -26); g.lineTo(5, -21); g.lineTo(-5, -21); g.fill();
    } else {
        g.strokeColor = C.line; g.lineWidth = 1;
        for (const side of [-1, 1]) { g.moveTo(side * (w / 2 - 1), -12); g.lineTo(side * (w / 2 - 1), 8); } g.stroke();
    }
    const label = button.getComponentInChildren(Label); place(label.node, 0, 0, w - 24, 32);
    label.color = selected ? new Color(255, 236, 188) : C.muted; label.isBold = selected; label.fontSize = selected ? 18 : 16;
}

export function taskTabRail(parent: Node, width: number): void {
    const rail = node(parent, 'TabRail', 0, -22, width, 2), g = rail.addComponent(Graphics);
    g.strokeColor = C.line; g.lineWidth = 1;
    g.moveTo(-width / 2, 0); g.lineTo(width / 2, 0); g.stroke();
}

function orderEmblem(parent: Node, x: number, y: number, ready: boolean): void {
    const emblem = node(parent, 'OrderEmblem', x, y, 58, 62), g = emblem.addComponent(Graphics);
    g.fillColor = new Color(54, 47, 31); g.strokeColor = C.line; g.lineWidth = 1;
    g.circle(0, 0, 27); g.fill(); g.stroke();
    g.fillColor = new Color(121, 103, 66); g.strokeColor = C.gold;
    g.roundRect(-15, -18, 29, 36, 2); g.fill(); g.stroke();
    g.fillColor = new Color(65, 54, 35);
    g.roundRect(-18, 14, 35, 7, 3); g.fill(); g.stroke();
    g.roundRect(-18, -21, 35, 7, 3); g.fill(); g.stroke();
    g.strokeColor = new Color(52, 47, 33); g.lineWidth = 2;
    for (const y of [7, 0, -7]) { g.moveTo(-9, y); g.lineTo(9, y); } g.stroke();
    if (ready) {
        g.fillColor = new Color(39, 66, 42); g.strokeColor = JADE; g.lineWidth = 1;
        g.circle(19, -18, 10); g.fill(); g.stroke(); g.lineWidth = 2;
        g.moveTo(14, -18); g.lineTo(18, -22); g.lineTo(25, -14); g.stroke();
    }
}

function loadIcon(path: string): Promise<SpriteFrame | null> {
    const cached = frames.get(path) || resources.get?.(path, SpriteFrame);
    if (cached && cached.isValid !== false) return Promise.resolve(cached);
    if (pending.has(path)) return pending.get(path);
    const request = new Promise<SpriteFrame | null>(resolve => resources.load(path, SpriteFrame, (error, frame) => {
        if (!error && frame instanceof SpriteFrame) { frames.set(path, frame); resolve(frame); } else resolve(null);
    }));
    pending.set(path, request); request.then(() => pending.delete(path)); return request;
}

export function taskCard(parent: Node, width: number, info: { name: string; detail: string; target: number; rewards: RewardPreview[] },
    progress: number, ready: boolean): void {
    const m = taskCardLayout(width, info.rewards.length), left = -width / 2, top = m.height / 2;
    const g = inkSurface(parent, 'Surface', width, m.height, new Color(42, 43, 33), ready ? new Color(157, 134, 78) : C.line);
    g.strokeColor = ready ? C.gold : C.line; g.lineWidth = 2;
    g.moveTo(left + 2, top - 12); g.lineTo(left + 2, -top + 12); g.stroke();
    if (!m.narrow) {
        g.strokeColor = C.line; g.lineWidth = 1;
        g.moveTo(left + m.infoWidth, top - 18); g.lineTo(left + m.infoWidth, -top + 18); g.stroke();
    }
    orderEmblem(parent, left + 45, top - 44, ready);
    const titleWidth = m.infoWidth - 102, titleX = left + 88 + titleWidth / 2;
    const title = caption(parent, 'Heading', info.name, titleX, top - 30, titleWidth, 21, C.text);
    title.isBold = true; title.overflow = Label.Overflow.SHRINK;
    const desc = caption(parent, 'Description', info.detail, titleX, top - 61, titleWidth, 13, C.muted);
    desc.enableWrapText = true; desc.overflow = Label.Overflow.SHRINK; place(desc.node, titleX, top - 61, titleWidth, 38);
    const barY = m.narrow ? top - 99 : -top + 29, barWidth = m.infoWidth - 134;
    const track = node(parent, 'Progress', left + 20 + barWidth / 2, barY, barWidth, 8);
    inkSurface(track, 'Track', barWidth, 8, C.inset, C.line);
    const ratio = progress / info.target;
    if (ratio > 0) {
        const fill = node(track, 'Fill', -barWidth * (1 - ratio) / 2, 0, barWidth * ratio, 6);
        inkSurface(fill, 'FillColor', barWidth * ratio, 6, ready ? JADE : C.gold, null);
    }
    caption(parent, 'ProgressText', `进度 ${progress} / ${info.target}`, left + m.infoWidth - 61, barY, 96, 12,
        ready ? JADE : C.muted, Label.HorizontalAlign.RIGHT).overflow = Label.Overflow.SHRINK;
    const rewardsLeft = m.narrow ? left + 16 : left + m.infoWidth + 14;
    const rewardsTop = m.narrow ? top - 150 : top - 66;
    caption(parent, 'RewardHeading', '任务奖励', rewardsLeft + m.rewardWidth / 2, rewardsTop + 40, m.rewardWidth, 11, C.muted);
    info.rewards.forEach((reward, i) => {
        const shown = taskRewardPresentation(reward), quality = rewardQualityStyle(shown.quality);
        const tone = new Color(quality.accent[0], quality.accent[1], quality.accent[2]);
        const slot = node(parent, `Reward${i}`, rewardsLeft + 32 + (i % m.columns) * 76,
            rewardsTop - Math.floor(i / m.columns) * 84, 68, 80);
        const rim = inkSurface(slot, 'Frame', 54, 54, new Color(25, 29, 23), tone);
        rim.strokeColor = new Color(quality.accent[0], quality.accent[1], quality.accent[2], 75);
        rim.rect(-23, -23, 46, 46); rim.stroke();
        const glyph = caption(slot, 'Glyph', shown.glyph, 0, 2, 40, 24, tone, Label.HorizontalAlign.CENTER);
        const icon = node(slot, 'Icon', 0, 2, 44, 44), sprite = icon.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM; icon.active = false;
        if (shown.icon) void loadIcon(shown.icon).then(frame => {
            if (!frame || !icon.isValid) return;
            const size = frame.originalSize, w = size?.width || 44, h = size?.height || 44, scale = 44 / Math.max(w, h);
            sprite.spriteFrame = frame; place(icon, 0, 2, w * scale, h * scale); icon.active = true; glyph.node.active = false;
        });
        const amount = caption(slot, 'Count', String(reward.itemCount), -1, -16, 46, 13, C.text, Label.HorizontalAlign.RIGHT);
        amount.isBold = true; amount.outlineColor = new Color(12, 16, 11); amount.outlineWidth = 2;
        amount.overflow = Label.Overflow.SHRINK; place(amount.node, -1, -16, 46, 20);
        const name = caption(slot, 'Name', shown.name, 0, -38, 70, 12, C.muted, Label.HorizontalAlign.CENTER);
        name.overflow = Label.Overflow.SHRINK; place(name.node, 0, -38, 70, 20);
    });
    const action = parent.getChildByName('Action'), actionY = m.narrow ? -top + 38 : -20;
    place(action, width / 2 - 68, actionY, 104, 44);
    const buttonArt = action.getChildByName('ManagementButton').getComponent(Graphics); buttonArt.clear();
    buttonArt.fillColor = ready ? new Color(126, 90, 40) : new Color(45, 49, 39);
    buttonArt.strokeColor = ready ? C.gold : C.line; buttonArt.lineWidth = 1;
    bevel(buttonArt, 104, 44, 7); buttonArt.fill(); buttonArt.stroke();
    if (ready) {
        buttonArt.strokeColor = new Color(218, 184, 113); bevel(buttonArt, 96, 36, 5); buttonArt.stroke();
        caption(parent, 'ReadyState', '已达成', width / 2 - 68, actionY + 43, 104, 14, JADE, Label.HorizontalAlign.CENTER);
    }
}
