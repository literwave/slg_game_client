import { Button, Color, Graphics, Label, Node, Sprite, SpriteFrame, UITransform, resources } from 'cc';
import { RewardPreview, taskRewardPresentation } from '../../progression/ProgressionPresentation';
import { rewardQualityStyle } from '../../common/RewardQuality';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';

const PAPER = new Color(175, 150, 103);
const SEAL = new Color(152, 69, 49);
const frames = new Map<string, SpriteFrame>();
const loading = new Map<string, Promise<SpriteFrame | null>>();

function node(parent: Node, name: string, x: number, y: number, width: number, height: number): Node {
    const n = new Node(name); n.layer = parent.layer; parent.addChild(n); place(n, x, y, width, height); return n;
}

/** 信纸、折口与朱印组成一封信；尺寸内直接绘制，不依赖字体符号或异步贴图。 */
export function mailEmblem(parent: Node, x: number, y: number, width: number, unread = false): void {
    const n = node(parent, 'LetterIcon', x, y, width, width * .76), g = n.addComponent(Graphics);
    const w = width * .44, h = width * .27;
    g.fillColor = unread ? PAPER : new Color(105, 103, 82); g.strokeColor = C.gold; g.lineWidth = 1;
    g.roundRect(-w, -h, w * 2, h * 2, 2); g.fill(); g.stroke();
    g.strokeColor = new Color(75, 64, 44); g.lineWidth = Math.max(1, width / 55);
    g.moveTo(-w, h); g.lineTo(0, -h * .22); g.lineTo(w, h); g.stroke();
    g.moveTo(-w, -h); g.lineTo(-w * .32, 0);
    g.moveTo(w, -h); g.lineTo(w * .32, 0); g.stroke();
    g.fillColor = unread ? SEAL : new Color(115, 100, 72);
    g.roundRect(-width * .065, -width * .12, width * .13, width * .14, 1); g.fill();
    g.strokeColor = new Color(226, 188, 133, 160); g.lineWidth = 1;
    g.moveTo(-width * .025, -width * .05); g.lineTo(width * .025, -width * .05); g.stroke();
}

export function mailTabs(parent: Node, width: number, selected: number, unread: number[]): void {
    const gap = 8, w = (width - gap * 2) / 3;
    const rail = inkSurface(parent, 'MailTabRail', width, 1, null, null);
    rail.node.setPosition(0, -22, 0); rail.strokeColor = C.line; rail.lineWidth = 1;
    rail.moveTo(-width / 2, 0); rail.lineTo(width / 2, 0); rail.stroke();
    for (let i = 0; i < 3; i++) {
        const tab = parent.getChildByName(`Filter${i}`);
        const active = i === selected;
        // 定位、点击区域和装饰共用一个宽度，不再套用任务页签的尺寸。
        panelButton(tab, tab.getComponentInChildren(Label).string, (i - 1) * (w + gap), 0, w, 44);
        const g = inkSurface(tab, 'ManagementButton', w, 44, null, null);
        g.fillColor = active ? new Color(77, 62, 37) : C.panel;
        g.moveTo(-w / 2 + 6, 18); g.lineTo(w / 2 - 6, 18);
        g.lineTo(w / 2, 12); g.lineTo(w / 2, -18);
        g.lineTo(-w / 2, -18); g.lineTo(-w / 2, 12); g.lineTo(-w / 2 + 6, 18); g.fill();
        if (active) {
            g.strokeColor = C.gold; g.lineWidth = 2;
            g.moveTo(-w / 2 + 8, -18); g.lineTo(w / 2 - 8, -18); g.stroke();
        }
        const label = tab.getComponentInChildren(Label);
        place(label.node, 0, 0, w - 28, 32);
        label.fontSize = 18; label.isBold = active; label.overflow = Label.Overflow.SHRINK;
        label.color = active ? new Color(255, 236, 188) : C.muted;
        if (unread[i] > 0) {
            const dot = node(tab, 'Unread', w / 2 - 13, 10, 8, 8).addComponent(Graphics);
            dot.fillColor = SEAL; dot.circle(0, 0, 3.5); dot.fill();
        }
    }
}

export function mailListRow(row: Node, width: number, info: {
    title: string; sender: string; time: string; read: boolean; locked: boolean;
}): void {
    const narrow = width < 460;
    inkSurface(row, 'Surface', width, 84, info.read ? C.inset : C.panel, C.line);
    mailEmblem(row, -width / 2 + 36, 0, 44, !info.read);
    if (!info.read) {
        const dot = node(row, 'Unread', -width / 2 + 13, 26, 8, 8).addComponent(Graphics);
        dot.fillColor = SEAL; dot.circle(0, 0, 3); dot.fill();
    }
    const textWidth = width - 102, center = 25;
    const titleWidth = textWidth - (narrow ? 0 : 130);
    const title = caption(row, 'Heading', info.title, -width / 2 + 76 + titleWidth / 2, 17, titleWidth,
        18, info.read ? C.muted : C.text);
    title.isBold = !info.read; title.overflow = Label.Overflow.SHRINK;
    caption(row, 'Sender', `${info.sender}${narrow ? '  ·  ' + info.time : ''}`, center - (info.locked ? 24 : 0), -17,
        textWidth - (info.locked ? 48 : 0), 12, C.muted).overflow = Label.Overflow.SHRINK;
    if (!narrow) caption(row, 'Time', info.time, width / 2 - 92, 17, 128, 12, C.muted, Label.HorizontalAlign.RIGHT);
    if (info.locked) caption(row, 'Saved', '已收藏', width / 2 - 47, -17, 48, 11, C.gold, Label.HorizontalAlign.RIGHT);
    const arrow = node(row, 'Open', width / 2 - 14, 0, 12, 20).addComponent(Graphics);
    arrow.strokeColor = C.line; arrow.lineWidth = 1.5;
    arrow.moveTo(-2, 4); arrow.lineTo(2, 0); arrow.lineTo(-2, -4); arrow.stroke();
    row.addComponent(Button).transition = Button.Transition.NONE;
}

export function mailEmpty(parent: Node, width: number, height: number, title: string, retry: boolean): void {
    const compact = height < 210;
    if (!compact) mailEmblem(parent, 0, retry ? 50 : 24, 92);
    const label = caption(parent, 'State', title, 0, compact ? (retry ? 24 : 0) : -42, width - 40,
        17, C.muted, Label.HorizontalAlign.CENTER);
    label.overflow = Label.Overflow.SHRINK;
}

function flowingText(parent: Node, name: string, text: string, width: number, size: number, color: Color): Label {
    const label = caption(parent, name, text, 0, 0, width, size, color);
    label.enableWrapText = true; label.lineHeight = Math.round(size * 1.65);
    label.overflow = Label.Overflow.RESIZE_HEIGHT; label.verticalAlign = Label.VerticalAlign.TOP;
    label.updateRenderData(true);
    label.node.getComponent(UITransform).setAnchorPoint(.5, 1);
    return label;
}

/** 使用引擎实际排字高度，长正文和空行不会越过信纸底部。 */
export function mailLetter(row: Node, width: number, title: string, sender: string, body: string): number {
    const inset = width < 460 ? 20 : 30;
    const heading = flowingText(row, 'Heading', title, width - inset * 2, 21, C.text);
    const text = flowingText(row, 'Body', body, width - inset * 2, 17, C.text);
    const headingHeight = heading.node.getComponent(UITransform).height;
    const bodyHeight = text.node.getComponent(UITransform).height;
    const height = 100 + headingHeight + bodyHeight;
    row.getComponent(UITransform).setContentSize(width, height);
    inkSurface(row, 'Paper', width, height, new Color(47, 46, 35), C.line);
    heading.node.setPosition(0, height / 2 - 24, 0);
    caption(row, 'Sender', sender, 0, height / 2 - 38 - headingHeight, width - inset * 2, 12, C.muted);
    const rule = inkSurface(row, 'Rule', width - inset * 2, 1, C.line, null);
    rule.node.setPosition(0, height / 2 - 56 - headingHeight, 0);
    text.node.setPosition(0, height / 2 - 72 - headingHeight, 0);
    return height;
}

function loadIcon(path: string): Promise<SpriteFrame | null> {
    const cached = frames.get(path) || resources.get?.(path, SpriteFrame);
    if (cached?.isValid !== false && cached) return Promise.resolve(cached);
    if (loading.has(path)) return loading.get(path);
    const pending = new Promise<SpriteFrame | null>(resolve => resources.load(path, SpriteFrame, (error, frame) => {
        if (!error && frame instanceof SpriteFrame) { frames.set(path, frame); resolve(frame); } else resolve(null);
    }));
    loading.set(path, pending); pending.then(() => loading.delete(path)); return pending;
}

export function mailAttachments(row: Node, width: number, rewards: RewardPreview[], claimed: boolean): number {
    const columns = Math.max(1, Math.floor((width - 32) / 80)), height = 56 + Math.ceil(rewards.length / columns) * 88;
    row.getComponent(UITransform).setContentSize(width, height);
    inkSurface(row, 'Surface', width, height, C.inset, C.line);
    caption(row, 'Heading', '附件', 0, height / 2 - 22, width - 32, 15, C.muted);
    if (claimed) caption(row, 'Claimed', '已领取', width / 2 - 62, height / 2 - 22, 88, 13, C.muted, Label.HorizontalAlign.RIGHT);
    rewards.forEach((reward, i) => {
        const info = taskRewardPresentation(reward), quality = rewardQualityStyle(info.quality);
        const color = new Color(quality.accent[0], quality.accent[1], quality.accent[2]);
        const slot = node(row, `Reward${i}`, -width / 2 + 56 + i % columns * 80,
            height / 2 - 76 - Math.floor(i / columns) * 88, 72, 80);
        inkSurface(slot, 'Frame', 54, 54, C.ink, color);
        const glyph = caption(slot, 'Glyph', info.glyph, 0, 2, 42, 24, color, Label.HorizontalAlign.CENTER);
        const icon = node(slot, 'Icon', 0, 2, 44, 44), sprite = icon.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM; icon.active = false;
        if (info.icon) void loadIcon(info.icon).then(frame => {
            if (!frame || !icon.isValid) return;
            const size = frame.originalSize, w = size?.width || 44, h = size?.height || 44, scale = 44 / Math.max(w, h);
            sprite.spriteFrame = frame; place(icon, 0, 2, w * scale, h * scale); icon.active = true; glyph.node.active = false;
        });
        const amount = caption(slot, 'Count', String(reward.itemCount), -1, -16, 46, 13, C.text, Label.HorizontalAlign.RIGHT);
        amount.isBold = true; amount.outlineWidth = 2; amount.outlineColor = C.ink; amount.overflow = Label.Overflow.SHRINK;
        caption(slot, 'Name', info.name, 0, -39, 72, 12, C.muted, Label.HorizontalAlign.CENTER).overflow = Label.Overflow.SHRINK;
    });
    return height;
}
