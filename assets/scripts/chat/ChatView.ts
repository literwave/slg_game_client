import { Button, Color, Graphics, Label, Node, Sprite, SpriteFrame, UITransform, resources } from 'cc';
import { caption, inkSurface, ManagementColors as C, place, textStyle } from '../map/ui/ManagementStyle';
import { gameCloseButton, taskWindowTrim } from '../map/ui/TaskBoardView';
import ChatIconCache, { CHAT_CHANNEL_ART } from './ChatIconCache';

const EMPTY_ART = ['ui/world/player_city_lv1/spriteFrame', 'ui/chat/alliance_standard/spriteFrame', 'ui/report_chrome/dispatch/spriteFrame'];
const frames = new Map<string, SpriteFrame>();
const pending = new Map<string, Promise<SpriteFrame | null>>();
const slots = new WeakMap<Node, { path: string; x: number; y: number; width: number; height: number; tint: Color }>();

function child(parent: Node, name: string): Node {
    let node = parent.getChildByName(name);
    if (!node) { node = new Node(name); node.layer = parent.layer; parent.addChild(node); node.addComponent(UITransform); }
    return node;
}

/** 同一节点切换频道或尺寸时，只应用最新的路径与边界，避免异步贴图跳位。 */
function artwork(parent: Node, path: string, x: number, y: number, width: number, height: number, tint = Color.WHITE): void {
    const node = child(parent, 'Artwork'), sprite = node.getComponent(Sprite) || node.addComponent(Sprite);
    const previous = slots.get(node);
    slots.set(node, { path, x, y, width, height, tint });
    const apply = (frame: SpriteFrame | null) => {
        const slot = slots.get(node);
        if (!node.isValid || !frame || slot?.path !== path) return;
        const size = frame.originalSize, scale = Math.min(slot.width / size.width, slot.height / size.height);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false; sprite.spriteFrame = frame; sprite.color = slot.tint;
        place(node, slot.x, slot.y, size.width * scale, size.height * scale);
        node.active = true;
    };
    const channelIcon = CHAT_CHANNEL_ART.indexOf(path) >= 0;
    const cached = channelIcon ? ChatIconCache.get(path) : frames.get(path) || resources.get(path, SpriteFrame);
    if (cached) { apply(cached); return; }
    if (previous?.path !== path) node.active = false;
    if (channelIcon) { void ChatIconCache.load(path).then(apply); return; }
    if (!pending.has(path)) {
        const request = new Promise<SpriteFrame | null>(resolve => resources.load(path, SpriteFrame, (error, frame) => {
            if (!error && frame instanceof SpriteFrame) { frames.set(path, frame); resolve(frame); } else resolve(null);
        }));
        pending.set(path, request); void request.then(() => pending.delete(path));
    }
    void pending.get(path).then(apply);
}

function bevel(g: Graphics, w: number, h: number, cut = 8): void {
    g.moveTo(-w / 2 + cut, h / 2); g.lineTo(w / 2 - cut, h / 2);
    g.lineTo(w / 2, h / 2 - cut); g.lineTo(w / 2, -h / 2 + cut);
    g.lineTo(w / 2 - cut, -h / 2); g.lineTo(-w / 2 + cut, -h / 2);
    g.lineTo(-w / 2, -h / 2 + cut); g.lineTo(-w / 2, h / 2 - cut); g.close();
}

export function chatFrame(panel: Node, width: number, height: number): void {
    inkSurface(panel, 'Surface', width, height, C.ink, null);
    textStyle(panel.getChildByName('Title').getComponent(Label), 0, height / 2 - 32, 120, 26, C.text, Label.HorizontalAlign.CENTER, 42);
    taskWindowTrim(panel, width, height);
    gameCloseButton(panel.getChildByName('Close'), width / 2 - 32, height / 2 - 32);
}

export function chatChannelTab(button: Node, name: string, index: number, selected: boolean,
    x: number, y: number, width: number): void {
    place(button, x, y, width, 70);
    const g = inkSurface(button, 'Surface', width, 70, null, null);
    g.fillColor = selected ? new Color(77, 59, 32) : new Color(37, 42, 33);
    bevel(g, width, 68); g.fill();
    if (selected) {
        g.strokeColor = new Color(190, 153, 86); g.lineWidth = 1; bevel(g, width - 4, 64); g.stroke();
        g.strokeColor = C.gold; g.lineWidth = 2;
        g.moveTo(-width / 2 + 14, -33); g.lineTo(width / 2 - 14, -33); g.stroke();
        g.fillColor = C.gold;
        g.moveTo(-4, -33); g.lineTo(0, -37); g.lineTo(4, -33); g.close(); g.fill();
    }
    artwork(button, CHAT_CHANNEL_ART[index], 0, 11, 44, 44,
        selected ? Color.WHITE : new Color(236, 230, 216));
    const label = caption(button, 'ChannelName', name, 0, -23, width - 16, 15,
        selected ? new Color(255, 231, 183) : C.muted, Label.HorizontalAlign.CENTER);
    label.isBold = selected;
    label.node.getComponent(UITransform).height = 20;
    // 整个页签一起响应按压，图标和文字与底板保持同一反馈。
    const control = button.getComponent(Button); control.target = button;
    control.transition = Button.Transition.SCALE; control.zoomScale = .95; control.duration = .08;
}

export function chatUnread(button: Node, count: number): void {
    const badge = child(button, 'Unread'); badge.active = count > 0;
    if (!count) return;
    const width = count > 99 ? 30 : count > 9 ? 26 : 20;
    place(badge, button.getComponent(UITransform).width / 2 - width / 2 - 7, 22, width, 20);
    inkSurface(badge, 'Surface', width, 20, new Color(152, 49, 33), new Color(204, 150, 93));
    caption(badge, 'Count', count > 99 ? '99+' : String(count), 0, 0, width - 2, 11,
        new Color(255, 240, 215), Label.HorizontalAlign.CENTER).isBold = true;
    badge.setSiblingIndex(button.children.length - 1);
}

export function chatEmptyArt(node: Node, channel: number, width: number, height: number): void {
    artwork(node, EMPTY_ART[channel - 1], 0, 0, width, height);
    const g = inkSurface(node, 'Ornament', width + 90, height, null, null);
    g.strokeColor = new Color(153, 134, 91, 52); g.lineWidth = 1;
    // 细铜饰只作平面衬景，不在插画脚下添加悬空底座或椭圆投影。
    for (const side of [-1, 1]) {
        g.moveTo(side * (width / 2 + 12), -height * .25);
        g.lineTo(side * (width / 2 + 36), -height * .25);
        g.lineTo(side * (width / 2 + 36), height * .2);
        g.lineTo(side * (width / 2 + 12), height * .2); g.stroke();
    }
}

export function chatAction(button: Node, title: string, x: number, y: number, width: number, primary = true): void {
    place(button, x, y, width, 44);
    const g = inkSurface(button, 'Surface', width, 44, null, null);
    g.fillColor = primary ? new Color(121, 86, 38) : new Color(43, 47, 36);
    g.strokeColor = primary ? C.gold : C.line; g.lineWidth = 1;
    bevel(g, width, 44); g.fill(); g.stroke();
    caption(button, 'ActionName', title, 0, 0, width - 20, 17, C.text, Label.HorizontalAlign.CENTER).isBold = primary;
    const control = button.getComponent(Button); control.target = g.node;
    control.transition = Button.Transition.SCALE; control.zoomScale = .97; control.duration = .08;
}
