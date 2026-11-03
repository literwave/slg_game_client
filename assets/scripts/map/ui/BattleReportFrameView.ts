import { Button, Color, Graphics, isValid, Label, Mask, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import type { ReportBrief } from '../../battle/BattleCommand';
import { reportKind, reportTime } from '../../battle/ReportPresentation';
import { caption, inkSurface, ManagementColors as C, place } from './ManagementStyle';
import { gameCloseButton, taskWindowTrim } from './TaskBoardView';

const ART = 'ui/report_chrome/';
const ICONS: Record<number, string> = { 0: 'dispatch', 4: 'resources', 1: 'expedition', 2: 'siege', 3: 'defense' };
const frames = new Map<string, SpriteFrame>(), pending = new Map<string, Promise<SpriteFrame | null>>();

function node(parent: Node, name: string): Node {
    let result = parent.getChildByName(name);
    if (!result) { result = new Node(name); result.layer = parent.layer; parent.addChild(result); result.addComponent(UITransform); }
    return result;
}
function frame(path: string): Promise<SpriteFrame | null> {
    const cached = frames.get(path) || resources.get(path, SpriteFrame);
    if (cached?.isValid) return Promise.resolve(cached);
    if (pending.has(path)) return pending.get(path);
    const request = new Promise<SpriteFrame | null>(resolve => resources.load(path, SpriteFrame, (error, value) => {
        if (error || !(value instanceof SpriteFrame)) { resolve(null); return; }
        value.addRef(); frames.set(path, value); resolve(value);
    }));
    pending.set(path, request); void request.then(() => pending.delete(path)); return request;
}
function art(parent: Node, name: string, path: string, x: number, y: number, width: number, height: number,
    tint = Color.WHITE, cover = false): Node {
    const picture = node(parent, name), sprite = picture.getComponent(Sprite) || picture.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.color = tint;
    const marker = picture as Node & { reportArtPath?: string; reportArtLayout?: number }, sameArt = marker.reportArtPath === path;
    marker.reportArtPath = path;
    const layoutVersion = marker.reportArtLayout = (marker.reportArtLayout || 0) + 1;
    const apply = (value: SpriteFrame | null) => {
        if (!value || !isValid(picture, true) || marker.reportArtPath !== path || marker.reportArtLayout !== layoutVersion) return;
        const size = value.originalSize, ratio = (cover ? Math.max : Math.min)(width / size.width, height / size.height);
        sprite.spriteFrame = value; place(picture, x, y, size.width * ratio, size.height * ratio); picture.active = true;
    };
    // 已显示的图随布局立即对齐，避免缩放窗口时仍停留在上一帧的位置。
    if (sameArt && sprite.spriteFrame?.isValid) apply(sprite.spriteFrame);
    else { picture.active = false; void frame(path).then(apply); }
    return picture;
}
function bevel(g: Graphics, width: number, height: number, cut = 7): void {
    g.moveTo(-width / 2 + cut, height / 2); g.lineTo(width / 2 - cut, height / 2);
    g.lineTo(width / 2, height / 2 - cut); g.lineTo(width / 2, -height / 2 + cut);
    g.lineTo(width / 2 - cut, -height / 2); g.lineTo(-width / 2 + cut, -height / 2);
    g.lineTo(-width / 2, -height / 2 + cut); g.lineTo(-width / 2, height / 2 - cut); g.close();
}
function text(parent: Node, name: string, value: string, x: number, y: number, width: number,
    size: number, color = C.text, align = Label.HorizontalAlign.LEFT): Label {
    const label = caption(parent, name, value, x, y, width, size, color, align);
    place(label.node, x, y, width, Math.ceil(size * 1.5));
    label.overflow = Label.Overflow.SHRINK; return label;
}
function press(button: Node, target: Node): void {
    const control = button.getComponent(Button); control.target = target;
    control.transition = Button.Transition.SCALE; control.zoomScale = .97; control.duration = .1;
}

/** 军报标题、铜饰、数量和关闭按钮；连接异常仍显示原始状态信息。 */
export function reportWindowFrame(parent: Node, width: number, height: number): void {
    const top = height / 2, narrow = width < 760;
    parent.getChildByName('Surface')?.setSiblingIndex(0);
    place(parent.getChildByName('Title'), 0, top - 31, 148, 40);
    parent.getChildByName('Title').getComponent(Label).horizontalAlign = Label.HorizontalAlign.CENTER;
    taskWindowTrim(parent, width, height);
    const titleTrim = parent.getChildByName('TaskTitlePlate');
    titleTrim.setScale(Math.min(1, (width - 144) / titleTrim.getComponent(UITransform).width), 1, 1);
    gameCloseButton(parent.getChildByName('Close'), width / 2 - 42, top - 31);
    const oldRule = parent.getChildByName('ManagementHeaderRule'); if (oldRule) oldRule.active = false;
    const status = parent.getChildByName('Status');
    const statusWidth = narrow ? width - 78 : Math.min(240, width / 2 - 248);
    const statusY = top - (narrow ? 65 : 31), statusLeft = -width / 2 + 56;
    place(status, statusLeft + statusWidth / 2, statusY, statusWidth, 22);
    status.getComponent(Label).overflow = Label.Overflow.SHRINK;
    art(parent, 'ReportCountIcon', ART + 'dispatch/spriteFrame', -width / 2 + 33, statusY, 26, 26);
}

export function reportFilters(parent: Node, width: number, filters: Array<[number, string]>, selected: number): void {
    const small = width < 440, gap = small ? 6 : 8;
    const w = (width - gap * (filters.length - 1)) / filters.length, step = w + gap;
    const rail = inkSurface(parent, 'ReportFilterRail', width, 64, null, null);
    rail.node.setSiblingIndex(0); rail.strokeColor = C.line; rail.lineWidth = 1;
    rail.moveTo(-width / 2, -33); rail.lineTo(width / 2, -33); rail.stroke();
    filters.forEach(([id, title], index) => {
        const button = parent.getChildByName(String(id)); if (!button) return;
        const active = id === selected;
        place(button, -width / 2 + w / 2 + index * step, 0, w, 64);
        const legacy = button.getChildByName('ManagementCaption'); if (legacy) legacy.active = false;
        const g = inkSurface(button, 'ManagementButton', w, 64, null, null);
        if (active) {
            g.fillColor = new Color(77, 59, 31); g.strokeColor = new Color(156, 124, 66); g.lineWidth = 1;
            bevel(g, w, 62, 7); g.fill(); g.stroke();
            g.strokeColor = new Color(229, 196, 124); g.lineWidth = 2;
            g.moveTo(-w / 2 + 9, -31); g.lineTo(w / 2 - 9, -31); g.stroke();
        }
        art(button, 'CategoryArt', ART + ICONS[id] + '/spriteFrame', 0, 11, small ? 32 : 39, small ? 32 : 39,
            active ? Color.WHITE : new Color(217, 211, 188));
        text(button, 'CategoryName', title, 0, -17, w - 4, small ? 12 : 14,
            active ? new Color(255, 233, 183) : C.muted, Label.HorizontalAlign.CENTER).isBold = active;
        press(button, g.node);
    });
}

/** 名称、时间和坐标保留；结果用印章表示，已读状态只使用未读红点。 */
export function reportDispatchCard(cell: Node, brief: ReportBrief, width: number, selected: boolean): void {
    const left = -width / 2, won = brief.result === 1, lost = brief.result === 2;
    const g = inkSurface(cell, 'Surface', width, 100, null, null);
    g.fillColor = selected ? new Color(64, 53, 34) : new Color(43, 44, 34);
    g.strokeColor = selected ? C.gold : C.line; g.lineWidth = 1; bevel(g, width - 2, 98, 6); g.fill(); g.stroke();
    if (selected) {
        g.fillColor = C.gold; g.rect(left + 2, -35, 3, 70); g.fill();
        g.moveTo(width / 2 - 13, -5); g.lineTo(width / 2 - 8, 0); g.lineTo(width / 2 - 13, 5); g.stroke();
    }
    art(cell, 'DispatchArt', ART + (ICONS[brief.reportType] || ICONS[0]) + '/spriteFrame', left + 46, 5, 60, 60);
    const seal = node(cell, 'ResultSeal'); place(seal, left + 68, -24, 32, 32);
    const stamp = inkSurface(seal, 'Stamp', 32, 32, null, null);
    const tone = won ? new Color(223, 190, 117) : lost ? new Color(206, 129, 109) : C.muted;
    stamp.fillColor = won ? new Color(81, 63, 31) : lost ? new Color(77, 40, 32) : new Color(45, 47, 38);
    stamp.strokeColor = tone; stamp.lineWidth = 1; bevel(stamp, 30, 30, 4); stamp.fill(); stamp.stroke();
    stamp.strokeColor = new Color(tone.r, tone.g, tone.b, 100); bevel(stamp, 24, 24, 2); stamp.stroke();
    text(seal, 'Character', won ? '胜' : lost ? '败' : '终', 0, 0, 26, 20, tone, Label.HorizontalAlign.CENTER).isBold = true;
    const infoLeft = left + 100, infoWidth = Math.max(60, width - 124), x = infoLeft + infoWidth / 2;
    text(cell, 'Kind', reportKind(brief), x, 24, infoWidth, 17, C.text).isBold = true;
    const pin = inkSurface(cell, 'MapPin', 14, 18, null, null); pin.node.setPosition(infoLeft + 5, -4);
    pin.node.setSiblingIndex(cell.children.length - 1);
    pin.strokeColor = C.gold; pin.lineWidth = 1.3;
    pin.moveTo(0, -6); pin.lineTo(-4, 0); pin.quadraticCurveTo(-7, 8, 0, 8); pin.quadraticCurveTo(7, 8, 4, 0); pin.close(); pin.stroke();
    pin.circle(0, 3, 1.5); pin.stroke();
    const hasPosition = Number.isFinite(brief.pos?.x) && Number.isFinite(brief.pos?.y);
    text(cell, 'Position', hasPosition ? `${brief.pos.x}, ${brief.pos.y}` : '—', x + 9, -4, infoWidth - 18, 12, C.muted);
    text(cell, 'Time', reportTime(brief.time), x, -28, infoWidth, 11, C.muted);
    for (const name of ['Result', 'Read']) { const old = cell.getChildByName(name); if (old) old.active = false; }
    const unread = node(cell, 'Unread'); place(unread, width / 2 - 14, 34, 12, 12); unread.active = !brief.isRead;
    const dot = unread.getComponent(Graphics) || unread.addComponent(Graphics); dot.clear();
    dot.fillColor = new Color(59, 27, 21); dot.circle(0, 0, 6); dot.fill();
    dot.fillColor = new Color(199, 73, 49); dot.circle(0, 0, 4); dot.fill();
    dot.fillColor = new Color(246, 154, 94); dot.circle(-1, 1, 1.4); dot.fill();
    press(cell, g.node);
}

/** 空态复用已有战场与军报美术，提示只保留一个操作句。 */
export function reportEmptyState(parent: Node, width: number, height: number, top: number, hint: string): Node {
    const root = node(parent, 'ReportEmptyState'); place(root, 0, top - height / 2, width, height); root.active = true;
    const artWidth = Math.min(480, width - 64), artHeight = Math.min(228, height * .52);
    const gap = 20, hintHeight = 24, artY = (gap + hintHeight) / 2;
    const hintY = artY - artHeight / 2 - gap - hintHeight / 2;
    const mount = node(root, 'Field'); place(mount, 0, artY, artWidth, artHeight);
    const mask = mount.getComponent(Mask) || mount.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_RECT;
    art(mount, 'Battlefield', 'ui/battle_replay/painted/plains_battlefield/spriteFrame', 0, 0, artWidth, artHeight,
        new Color(147, 136, 101, 95), true);
    const edge = inkSurface(root, 'Mounting', artWidth + 10, artHeight + 10, null, null); edge.node.setPosition(0, artY);
    edge.strokeColor = new Color(160, 136, 81, 95); edge.lineWidth = 1;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = sx * (artWidth / 2 + 5), y = sy * (artHeight / 2 + 5);
        edge.moveTo(x - sx * 28, y); edge.lineTo(x, y); edge.lineTo(x, y - sy * 28);
    }
    edge.stroke();
    art(root, 'Dispatch', 'ui/hud/hud-war-report/spriteFrame', 0, artY, Math.min(200, artHeight - 16), Math.min(200, artHeight - 16),
        new Color(221, 205, 164));
    const label = text(root, 'Hint', hint, 0, hintY, width - 64, 14, C.muted, Label.HorizontalAlign.CENTER);
    place(label.node, 0, hintY, width - 64, hintHeight); label.enableWrapText = false;
    return root;
}

export function reportReadAll(button: Node, x: number, y: number): void {
    place(button, x, y, 130, 30);
    const legacy = button.getChildByName('ManagementCaption'); if (legacy) legacy.active = false;
    const g = inkSurface(button, 'ManagementButton', 130, 30, null, null);
    g.fillColor = new Color(48, 44, 32); g.strokeColor = C.line; g.lineWidth = 1;
    bevel(g, 130, 30, 5); g.fill(); g.stroke();
    art(button, 'ReadIcon', ART + 'opened/spriteFrame', -47, 0, 27, 27);
    text(button, 'ReadCaption', '全部已读', 16, 0, 86, 13, C.text, Label.HorizontalAlign.CENTER); press(button, g.node);
}
