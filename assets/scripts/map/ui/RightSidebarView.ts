import { Button, Color, Graphics, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import WorldMapArt from '../WorldMapArt';
import { caption, hideSprite, inkSurface, ManagementColors as C, place, textStyle } from './ManagementStyle';
import SidebarIconCache, { SidebarStatIcon } from './SidebarIconCache';

export type CommandGlyph = 'army' | 'city' | 'flag' | 'land' | 'attack' | 'move' | 'home' | 'build' | 'harvest' | 'shield' | 'pin' | 'edit' | 'remove' | 'speed';

function polygon(g: Graphics, points: number[][]): void {
    g.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) g.lineTo(point[0], point[1]);
    g.close();
}

/** 小尺寸军令图形，与地图美术共用铜色；节点复用，装饰不绑定输入。 */
export function commandGlyph(parent: Node, name: string, kind: CommandGlyph, x: number, y: number, size: number, color = C.gold): Node {
    const g = inkSurface(parent, name, 32, 32, null, null);
    g.node.setPosition(x, y, 0); g.node.setScale(size / 32, size / 32, 1);
    g.strokeColor = color; g.fillColor = color; g.lineWidth = 2.4;
    if (kind === 'attack') {
        for (const sign of [-1, 1]) {
            polygon(g, [[sign * -9, -7], [sign * 7, 11], [sign * 12, 14], [sign * 11, 8], [sign * -6, -10]]); g.fill();
            g.moveTo(sign * -12, -5); g.lineTo(sign * -4, -12); g.stroke();
        }
    } else if (kind === 'city' || kind === 'home') {
        polygon(g, [[-14, 2], [0, 12], [14, 2], [10, 1], [-10, 1]]); g.fill();
        g.rect(-10, -11, 20, 10); g.stroke(); g.rect(-3, -11, 6, 7); g.fill();
        g.moveTo(-14, -12); g.lineTo(14, -12); g.moveTo(0, 12); g.lineTo(0, 16); g.stroke();
    } else if (kind === 'flag' || kind === 'edit' || kind === 'remove') {
        g.moveTo(-8, -13); g.lineTo(-8, 14); g.stroke();
        polygon(g, [[-6, 12], [11, 10], [7, 4], [11, -2], [-6, 0]]); g.fill();
        g.moveTo(-13, -13); g.lineTo(-2, -13); g.stroke();
        if (kind === 'remove') { g.moveTo(4, -10); g.lineTo(13, -10); g.stroke(); }
        if (kind === 'edit') { g.moveTo(8, -6); g.lineTo(8, -14); g.moveTo(4, -10); g.lineTo(12, -10); g.stroke(); }
    } else if (kind === 'land') {
        polygon(g, [[-15, 1], [0, 10], [15, 1], [0, -8]]); g.fill();
        g.moveTo(-15, -5); g.lineTo(0, -14); g.lineTo(15, -5); g.stroke();
    } else if (kind === 'move' || kind === 'speed') {
        g.moveTo(-13, -9); g.lineTo(-4, -9); g.lineTo(2, 6); g.lineTo(12, 6); g.stroke();
        polygon(g, [[7, 12], [15, 6], [7, 0]]); g.fill();
        g.moveTo(-14, 2); g.lineTo(-6, 2); g.moveTo(-11, 8); g.lineTo(-3, 8); g.stroke();
    } else if (kind === 'build') {
        polygon(g, [[-3, 6], [2, 10], [9, 3], [5, -1]]); g.fill();
        g.moveTo(0, 4); g.lineTo(-11, -11); g.lineTo(-8, -13); g.lineTo(4, 1); g.stroke();
        g.moveTo(-10, 10); g.lineTo(-3, 13); g.lineTo(1, 9); g.stroke();
    } else if (kind === 'pin') {
        g.circle(0, 2, 9); g.stroke(); g.circle(0, 2, 3); g.fill();
        g.moveTo(-15, 2); g.lineTo(-11, 2); g.moveTo(11, 2); g.lineTo(15, 2);
        g.moveTo(0, 17); g.lineTo(0, 13); g.moveTo(0, -9); g.lineTo(0, -13); g.stroke();
    } else if (kind === 'harvest') {
        g.moveTo(-4, -14); g.lineTo(4, 13); g.stroke();
        for (let i = 0; i < 3; i++) {
            const cy = -4 + i * 7, cx = cy * .25;
            polygon(g, [[cx, cy], [cx - 8, cy + 2], [cx - 6, cy + 7]]); g.fill();
            polygon(g, [[cx + 1, cy], [cx + 9, cy + 5], [cx + 7, cy + 8]]); g.fill();
        }
    } else {
        // 队伍/守备以盔甲盾牌识别，不用文字代替图标。
        polygon(g, [[-11, 10], [0, 14], [11, 10], [9, -5], [0, -14], [-9, -5]]); g.stroke();
        if (kind === 'army') {
            g.arc(0, 3, 6, 0, Math.PI, false); g.stroke();
            g.moveTo(-6, 3); g.lineTo(6, 3); g.moveTo(0, 10); g.lineTo(0, -5); g.stroke();
        } else { g.moveTo(0, 10); g.lineTo(0, -9); g.stroke(); }
    }
    g.node.setSiblingIndex(parent.children.length - 1);
    return g.node;
}

export function commandTab(node: Node, index: number, selected: boolean, width: number, art?: SpriteFrame): void {
    const checkmark = node.getChildByName('checkmark'); if (checkmark) hideSprite(checkmark);
    const g = inkSurface(node, 'TabSeal', width - 4, 56, null, null);
    if (selected) {
        g.fillColor = new Color(118, 87, 42, 175);
        polygon(g, [[-width / 2 + 5, 25], [width / 2 - 5, 25], [width / 2 - 3, 22], [width / 2 - 3, -23], [-width / 2 + 3, -23], [-width / 2 + 3, 22]]); g.fill();
        g.strokeColor = C.gold; g.lineWidth = 1;
        g.moveTo(-width / 2 + 8, 25); g.lineTo(width / 2 - 8, 25); g.stroke();
        g.lineWidth = 2; g.moveTo(-width / 2 + 8, -24); g.lineTo(width / 2 - 8, -24); g.stroke();
    }
    const old = node.getChildByName('TabIcon'); if (old) old.active = false;
    if (art?.isValid) {
        let icon = node.getChildByName('TabArtwork');
        if (!icon) { icon = new Node('TabArtwork'); icon.layer = node.layer; node.addChild(icon); icon.addComponent(Sprite); }
        icon.active = true;
        const sprite = icon.getComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
        sprite.spriteFrame = art; sprite.color = selected ? Color.WHITE : new Color(200, 197, 178);
        const size = art.originalSize, ratio = 32 / Math.max(size.width, size.height);
        place(icon, 0, 7, size.width * ratio, size.height * ratio);
    } else {
        const artwork = node.getChildByName('TabArtwork'); if (artwork) artwork.active = false;
        commandGlyph(node, 'TabIcon', (['army', 'city', 'flag', 'land'] as CommandGlyph[])[index], 0, 8, 25,
            selected ? new Color(238, 207, 142) : new Color(152, 151, 122)).active = true;
    }
    const label = node.getChildByName('Label')?.getComponent(Label);
    if (label) {
        textStyle(label, 0, -16, width - 4, 11, selected ? C.text : C.muted, Label.HorizontalAlign.CENTER, 20);
        label.isBold = selected;
    }
}

export function commandArt(parent: Node, name: string, art: string, x: number, y: number, width: number, height: number): void {
    let node = parent.getChildByName(name);
    if (!node) { node = new Node(name); node.layer = parent.layer; parent.addChild(node); node.addComponent(UITransform); node.addComponent(Sprite); }
    node.active = !!art; if (!art) return;
    const frame = WorldMapArt.frame(art), size = frame.originalSize;
    const ratio = Math.min(width / size.width, height / size.height);
    const sprite = node.getComponent(Sprite);
    // Sprite 首次换图会按原图尺寸重置 UITransform，先切换 CUSTOM 再写目标尺寸。
    sprite.type = Sprite.Type.SIMPLE; sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.spriteFrame = frame; sprite.color = Color.WHITE;
    place(node, x, y, size.width * ratio, size.height * ratio);
}

export function landPortrait(parent: Node, width: number, top: number, art: string): void {
    const x = -width / 2 + 56, y = top - 57;
    const g = inkSurface(parent, 'LandPortraitBase', 92, 84, null, null);
    g.node.setPosition(x, y, 0);
    // 图片自带地面，使用平面的图鉴框承托，避免额外地台和离体黑影造成悬浮。
    g.fillColor = new Color(19, 27, 21, 210); g.roundRect(-46, -42, 92, 84, 4); g.fill();
    g.strokeColor = new Color(119, 108, 67, 155); g.lineWidth = 1;
    g.roundRect(-45, -41, 90, 82, 3); g.stroke();
    g.strokeColor = new Color(180, 151, 87, 210);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        g.moveTo(sx * 34, sy * 41); g.lineTo(sx * 45, sy * 41); g.lineTo(sx * 45, sy * 30);
    }
    g.stroke();
    if (!art) {
        g.fillColor = new Color(129, 137, 73);
        polygon(g, [[-43, -8], [0, 14], [43, -8], [0, -30]]); g.fill();
        g.fillColor = new Color(154, 154, 84, 160);
        polygon(g, [[-26, -8], [0, 6], [27, -8], [0, -22]]); g.fill();
        g.strokeColor = new Color(202, 195, 126, 200);
        for (const [x, y] of [[-18, -8], [10, -15], [4, 0]]) {
            g.moveTo(x - 3, y + 1); g.lineTo(x, y - 1); g.lineTo(x + 2, y + 4); g.stroke();
        }
    }
    commandArt(parent, 'LandPortrait', art, x, y, 86, 74);
    let ground = parent.getChildByName('EmptyLandArt');
    if (!ground && !art) {
        ground = new Node('EmptyLandArt'); ground.layer = parent.layer; parent.addChild(ground); ground.addComponent(UITransform);
    }
    if (ground) {
        ground.active = !art;
        if (!art) {
            // 将现有草地纹理旋转、压扁成等距地块，不增加贴图或遮罩。
            commandArt(ground, 'Grass', 'plains', 0, 0, 60, 60);
            ground.getChildByName('Grass').angle = 45;
            ground.setPosition(x, y - 8, 0); ground.setScale(1, .5, 1);
        }
    }
}

export function ownershipSeal(parent: Node, text: string, x: number, y: number, width: number, color: Color): void {
    const g = inkSurface(parent, 'OwnershipSeal', width, 22, new Color(color.r, color.g, color.b, 24), null);
    g.node.setPosition(x, y, 0);
    commandGlyph(g.node, 'Flag', 'flag', -width / 2 + 12, 0, 15, color);
    const label = caption(g.node, 'State', text, 10, 0, width - 24, 11, color, Label.HorizontalAlign.CENTER);
    label.overflow = Label.Overflow.SHRINK;
}

const moveArtworkTargets = new WeakSet<Node>();

/** 行军命令用独立战马贴图，保持原按钮图标的占位和命中范围。 */
function moveArtwork(parent: Node, x: number, y: number, size: number, muted: boolean): void {
    const old = parent.getChildByName('OrderIcon'); if (old) old.active = false;
    let node = parent.getChildByName('MoveArtwork');
    if (!node) {
        node = new Node('MoveArtwork'); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform); node.addComponent(Sprite);
    }
    moveArtworkTargets.add(node);
    const sprite = node.getComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
    sprite.color = muted ? new Color(170, 168, 151, 170) : Color.WHITE;
    place(node, x, y, size, size);
    const frame = SidebarIconCache.moveFrame();
    if (frame) { sprite.spriteFrame = frame; node.active = true; return; }
    node.active = false;
    void SidebarIconCache.prepare().then(() => {
        if (!node.isValid || !moveArtworkTargets.has(node)) return;
        const loaded = SidebarIconCache.moveFrame();
        if (loaded) { sprite.spriteFrame = loaded; node.active = true; }
    }).catch(error => console.warn('行军命令图标加载失败', error));
}

/** 保留原 Button/序列化回调；图标与文字同属完整命中区域。 */
export function commandAction(node: Node, text: string, kind: CommandGlyph, x: number, y: number,
    width: number, height: number, primary = false, vertical = false): void {
    place(node, x, y, width, height); hideSprite(node);
    const background = node.getChildByName('Background') || node;
    if (background !== node) { place(background, 0, 0, width, height); hideSprite(background); }
    for (const name of ['ManagementButton', 'CommandSkin']) {
        const old = background.getChildByName(name); if (old) old.active = false;
    }
    const button = node.getComponent(Button), enabled = button?.interactable !== false;
    const color = enabled ? (primary ? new Color(242, 216, 155) : C.text) : C.muted;
    const g = inkSurface(background, 'OrderPlate', width, height, null, null);
    const w = width / 2, h = height / 2;
    g.fillColor = primary ? new Color(104, 83, 43, enabled ? 250 : 120) : new Color(51, 54, 40, 220);
    g.strokeColor = primary ? new Color(191, 158, 90, 220) : C.line; g.lineWidth = 1;
    polygon(g, [[-w + 5, -h + 1], [w - 5, -h + 1], [w - 1, -h + 5], [w - 1, h - 5], [w - 5, h - 1], [-w + 5, h - 1], [-w + 1, h - 5], [-w + 1, -h + 5]]);
    g.fill(); g.stroke();
    if (kind === 'move') {
        moveArtwork(background, vertical ? 0 : -w + 21, vertical ? 8 : 0, vertical ? 28 : 21, !enabled);
    } else {
        const oldMove = background.getChildByName('MoveArtwork');
        if (oldMove) { moveArtworkTargets.delete(oldMove); oldMove.active = false; }
        commandGlyph(background, 'OrderIcon', kind, vertical ? 0 : -w + 21, vertical ? 8 : 0, vertical ? 28 : 21, color).active = true;
    }
    const label = background.getComponentInChildren(Label) || caption(background, 'OrderCaption', text, 0, 0, width, 12);
    label.node.active = true;
    textStyle(label, vertical ? 0 : 12, vertical ? -17 : 0, width - (vertical ? 10 : 37), 12, color, Label.HorizontalAlign.CENTER, 22);
    label.string = text; label.isBold = primary; label.overflow = Label.Overflow.SHRINK;
    if (button) { button.target = background; button.transition = Button.Transition.SCALE; button.zoomScale = .97; button.duration = .08; }
}

export function commandEmpty(parent: Node, name: string, text: string, kind: CommandGlyph, width: number, height = 116): Node {
    let node = parent.getChildByName(name);
    if (!node) { node = new Node(name); node.layer = parent.layer; parent.addChild(node); node.addComponent(UITransform); }
    place(node, 0, 0, width, height);
    const g = inkSurface(node, 'EmptySeal', 62, 62, null, null); g.node.setPosition(0, 15, 0);
    g.strokeColor = new Color(157, 139, 90, 100); g.lineWidth = 1; g.circle(0, 0, 29); g.stroke();
    commandGlyph(node, 'EmptyIcon', kind, 0, 15, 36, new Color(166, 148, 98, 180));
    caption(node, 'Hint', text, 0, -36, width - 12, 12, C.muted, Label.HorizontalAlign.CENTER);
    return node;
}

const bookmarkArtworkTargets = new WeakSet<Node>();

/** 标记条目使用独立布面旗帜，沿用原来的 36 像素占位。 */
function bookmarkArtwork(parent: Node, x: number): void {
    let node = parent.getChildByName('EntryMarkerArt');
    if (!node) {
        node = new Node('EntryMarkerArt'); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform); node.addComponent(Sprite);
    }
    bookmarkArtworkTargets.add(node);
    const sprite = node.getComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false; sprite.color = Color.WHITE;
    place(node, x, 2, 36, 36);
    const frame = SidebarIconCache.bookmarkFrame();
    if (frame) { sprite.spriteFrame = frame; node.active = true; return; }
    node.active = false;
    void SidebarIconCache.prepare().then(() => {
        if (!node.isValid || !bookmarkArtworkTargets.has(node)) return;
        const loaded = SidebarIconCache.bookmarkFrame();
        if (loaded) { sprite.spriteFrame = loaded; node.active = true; }
    }).catch(error => console.warn('地图标记图标加载失败', error));
}

export function commandListEntry(root: Node, name: Label, pos: Label, kind: 'city' | 'flag', art = '', level = 0): void {
    const width = root.getComponent(UITransform).width, bg = root.getChildByName('bg'); if (!bg) return;
    place(root, root.position.x, root.position.y, width, 72); place(bg, 0, 0, width, 72); hideSprite(bg);
    for (const old of ['CommandSkin', 'EntryBadge']) { const n = bg.getChildByName(old); if (n) n.active = false; }
    const g = inkSurface(bg, 'EntryPlate', width, 68, new Color(68, 66, 44, 65), null);
    g.strokeColor = C.line; g.lineWidth = 1;
    g.moveTo(-width / 2 + 8, -34); g.lineTo(width / 2 - 8, -34); g.stroke();
    const oldFlag = bg.getChildByName('EntryFlag'); if (oldFlag) oldFlag.active = false;
    if (kind === 'city') {
        const marker = bg.getChildByName('EntryMarkerArt');
        if (marker) { bookmarkArtworkTargets.delete(marker); marker.active = false; }
        commandArt(bg, 'EntryArt', art, -width / 2 + 34, 2, 64, 56);
    } else {
        const city = bg.getChildByName('EntryArt'); if (city) city.active = false;
        bookmarkArtwork(bg, -width / 2 + 33);
    }
    const textWidth = width - 102, x = -width / 2 + 72 + textWidth / 2;
    textStyle(name, x, 12, textWidth, 14, C.text); name.isBold = true; name.overflow = Label.Overflow.SHRINK;
    textStyle(pos, x + 7, -13, textWidth - 14, 11, C.muted);
    if (kind === 'flag') {
        // 低分辨率下用完整定位轮廓，避免原十字线缩小后成为散点。
        const pin = inkSurface(bg, 'EntryPin', 12, 12, null, null);
        pin.node.setPosition(-width / 2 + 77, -13, 0); pin.fillColor = C.muted;
        pin.moveTo(0, -5.5);
        pin.bezierCurveTo(-1.5, -3.5, -4.5, -1, -4.5, 1.5);
        pin.bezierCurveTo(-4.5, 7.5, 4.5, 7.5, 4.5, 1.5);
        pin.bezierCurveTo(4.5, -1, 1.5, -3.5, 0, -5.5); pin.close(); pin.fill();
        pin.fillColor = new Color(38, 43, 31); pin.circle(0, 2, 1.5); pin.fill();
    } else commandGlyph(bg, 'EntryPin', 'pin', -width / 2 + 77, -13, 12, C.muted);
    if (kind === 'city' && level > 0) {
        const lv = caption(bg, 'EntryLevel', String(level), width / 2 - 15, 11, 25, 12, C.gold, Label.HorizontalAlign.CENTER);
        lv.isBold = true;
    }
    if (kind === 'flag') {
        const focus = inkSurface(bg, 'EntryFocus', 14, 14, null, null);
        focus.node.setPosition(width / 2 - 15, -13, 0); focus.strokeColor = C.gold; focus.lineWidth = 1.8;
        focus.moveTo(-2, 4); focus.lineTo(2, 0); focus.lineTo(-2, -4); focus.stroke();
    } else commandGlyph(bg, 'EntryFocus', 'move', width / 2 - 15, -13, 14, C.muted);
}

const statArtworkKinds = new WeakMap<Node, SidebarStatIcon>();

function statArtwork(parent: Node, kind: SidebarStatIcon, x: number, muted: boolean): void {
    const old = parent.getChildByName('Icon'); if (old) old.active = false;
    let node = parent.getChildByName('Artwork');
    if (!node) {
        node = new Node('Artwork'); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform); node.addComponent(Sprite);
    }
    const sprite = node.getComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
    sprite.color = muted ? new Color(185, 183, 167, 180) : Color.WHITE;
    place(node, x, 0, 18, 18);
    statArtworkKinds.set(node, kind);
    const frame = SidebarIconCache.statFrame(kind);
    if (frame) { sprite.spriteFrame = frame; node.active = true; return; }
    node.active = false;
    void SidebarIconCache.prepare().then(() => {
        if (!node.isValid || statArtworkKinds.get(node) !== kind) return;
        const loaded = SidebarIconCache.statFrame(kind);
        if (loaded) { sprite.spriteFrame = loaded; node.active = true; }
    }).catch(error => console.warn('侧栏属性图标加载失败', error));
}

export function commandStat(parent: Node, name: string, text: string, glyph: CommandGlyph | 'wounded', x: number, y: number, width: number, muted = false): void {
    const g = inkSurface(parent, name, width, 30, new Color(13, 21, 16, 100), null); g.node.setPosition(x, y, 0);
    // 使用侧栏专用的新贴图；沿用原来的 18 像素尺寸与数值位置。
    if (glyph === 'wounded' || glyph === 'speed' || glyph === 'attack') {
        statArtwork(g.node, glyph, -width / 2 + 15, muted);
    } else {
        const art = g.node.getChildByName('Artwork');
        if (art) { statArtworkKinds.delete(art); art.active = false; }
        commandGlyph(g.node, 'Icon', glyph, -width / 2 + 15, 0, 18, muted ? C.muted : C.gold).active = true;
    }
    const label = caption(g.node, 'Value', text, 11, 0, width - 34, 12, muted ? C.muted : C.text, Label.HorizontalAlign.CENTER);
    label.overflow = Label.Overflow.SHRINK;
}

export function landYields(parent: Node, values: Array<{ art: string; amount: number }>, width: number, top: number): void {
    let root = parent.getChildByName('YieldRack');
    if (!root) { root = new Node('YieldRack'); root.layer = parent.layer; parent.addChild(root); }
    root.children.forEach(n => n.active = false); root.active = values.length > 0;
    const columns = Math.min(2, values.length), cell = (width - (columns - 1) * 6) / Math.max(1, columns);
    values.forEach((value, i) => {
        const g = inkSurface(root, `Yield${i}`, cell, 34, new Color(12, 22, 15, 130), null);
        g.node.active = true;
        g.node.setPosition(-width / 2 + cell / 2 + i % columns * (cell + 6), top - 17 - Math.floor(i / columns) * 38, 0);
        commandArt(g.node, 'Resource', value.art, -cell / 2 + 20, 0, 36, 29);
        const label = caption(g.node, 'Amount', `+${value.amount}/时`, 16, 0, cell - 40, 12, C.gold, Label.HorizontalAlign.CENTER);
        label.overflow = Label.Overflow.SHRINK;
    });
}
