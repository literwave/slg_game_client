import { Button, Color, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import LoginCommand from '../../login/LoginCommand';
import GeneralCommand from '../../general/GeneralCommand';
import { caption, hideSprite, inkSurface, ManagementColors as C, place, textStyle } from './ManagementStyle';
import { commandGlyph, CommandGlyph } from './RightSidebarView';

const portraitSlots = new WeakMap<Node, number>();

/** 使用头像表里的近景画像；HeroId 与头像协议 ID 分开查询，不把整张立绘挤进小格。 */
export function troopPortrait(parent: Node, name: string, heroId: number, x: number, y: number, size: number): void {
    let node = parent.getChildByName(name);
    if (!node) {
        node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform); node.addComponent(Sprite);
    }
    node.active = heroId > 0;
    place(node, x, y, size, size);
    const sprite = node.getComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
    if (!heroId) { portraitSlots.set(node, 0); sprite.spriteFrame = null; return; }
    const icons = LoginCommand.getInstance().headIcons;
    const config = icons.configs.find(item => item.heroId === heroId);
    const cached = config ? icons.getIcon(config.id) : GeneralCommand.getInstance().proxy.getGeneralTex(heroId);
    const unchanged = portraitSlots.get(node) === heroId;
    portraitSlots.set(node, heroId);
    if (cached?.isValid) { sprite.spriteFrame = cached; return; }
    if (unchanged && sprite.spriteFrame?.isValid) return;
    sprite.spriteFrame = null;
    const request = config ? icons.loadIcon(config.id) : GeneralCommand.getInstance().proxy.loadGeneralTex(heroId);
    void request.then((frame: SpriteFrame | null) => {
        if (node.isValid && portraitSlots.get(node) === heroId && frame?.isValid) sprite.spriteFrame = frame;
    });
}

export interface TroopSidebarCardData {
    order: number;
    heroes: number[];
    soldiers: number;
    expanded: boolean;
    state: string;
    canEdit: boolean;
}

export interface TroopRoutePoints {
    origin: { x: number; y: number } | null;
    destination: { x: number; y: number } | null;
    originName: string;
    destinationName: string;
    originIcon: CommandGlyph;
    destinationIcon: CommandGlyph;
    order: string;
}

/** 军令连接两处驻地；地名与坐标均可定位，和队伍跟随入口分开。 */
export function troopSidebarRoute(parent: Node, points: TroopRoutePoints | null, width: number, y: number): Node | null {
    let row = parent.getChildByName('RoutePoints');
    if (!points) { if (row) row.active = false; return row; }
    if (!row) { row = new Node('RoutePoints'); row.layer = parent.layer; parent.addChild(row); }
    row.active = true;
    place(row, 0, y, width, 44);
    const buttonWidth = (width - 38) / 2, offset = (width + 38) / 4;
    for (const [name, title, icon, point, x, color] of [
        ['Origin', points.originName, points.originIcon, points.origin, -offset, new Color(157, 194, 197)],
        ['Destination', points.destinationName, points.destinationIcon, points.destination, offset, new Color(231, 202, 140)],
    ] as const) {
        const g = inkSurface(row, name, buttonWidth, 44, new Color(26, 33, 27, 125), null);
        g.node.setPosition(x, 0, 0);
        const tone = point ? color : C.muted;
        g.strokeColor = new Color(color.r, color.g, color.b, 100); g.lineWidth = 1;
        g.moveTo(-buttonWidth / 2 + 5, -17); g.lineTo(buttonWidth / 2 - 5, -17); g.stroke();
        const heading = caption(g.node, 'Heading', title, 9, 10, buttonWidth - 26, 12, C.text, Label.HorizontalAlign.CENTER);
        heading.overflow = Label.Overflow.SHRINK;
        commandGlyph(g.node, 'LocationMark', icon, -buttonWidth / 2 + 12, 10, 15, tone);
        const value = caption(g.node, 'Coordinates', point ? `(${point.x},${point.y})` : '—', 0, -8, buttonWidth - 8, 12, tone, Label.HorizontalAlign.CENTER);
        value.overflow = Label.Overflow.SHRINK;
        value.isBold = true;
        const button = g.node.getComponent(Button) || g.node.addComponent(Button);
        button.target = g.node; button.interactable = !!point;
        button.transition = Button.Transition.SCALE; button.zoomScale = .96; button.duration = .08;
    }
    const order = caption(row, 'Order', points.order, 0, 10, 36, 11, C.gold, Label.HorizontalAlign.CENTER);
    order.isBold = true;
    const arrow = inkSurface(row, 'Direction', 24, 12, null, null);
    arrow.node.setPosition(0, -8, 0);
    arrow.strokeColor = C.gold; arrow.lineWidth = 1.5;
    arrow.moveTo(-9, 0); arrow.lineTo(8, 0);
    arrow.moveTo(3, 4); arrow.lineTo(8, 0); arrow.lineTo(3, -4); arrow.stroke();
    return row;
}

/** 队伍卡片只在数据或布局变化时绘制；倒计时仍复用原 labelPos，不逐帧重建。 */
export function troopSidebarCard(top: Node, nameLabel: Label, statusLabel: Label, data: TroopSidebarCardData): void {
    const width = top.getComponent(UITransform).width, left = -width / 2, right = width / 2;
    const empty = !data.heroes.some(id => id > 0), height = empty ? 66 : 100;
    top.getComponent(UITransform).height = height;
    hideSprite(top);
    for (const oldName of ['CommandSkin', 'OrderBadge', 'StateBadge', 'CommanderPortrait']) {
        const old = top.getChildByName(oldName); if (old) old.active = false;
    }
    const color = data.state === '攻城中' ? new Color(228, 142, 99) : data.state === '占领中' ? new Color(220, 176, 86)
        : data.state === '行军中' || data.state === '回城中' || data.state === '调动中' ? new Color(135, 187, 201)
        : data.canEdit ? new Color(166, 186, 141) : C.muted;
    const g = inkSurface(top, 'TroopCardSurface', width, height, null, null);
    g.fillColor = data.expanded ? new Color(63, 59, 39) : new Color(37, 44, 35);
    g.roundRect(left + 1, -height / 2 + 1, width - 2, height - 2, 3); g.fill();
    g.strokeColor = data.expanded ? C.gold : new Color(137, 127, 86, 105); g.lineWidth = 1;
    g.roundRect(left + 1, -height / 2 + 1, width - 2, height - 2, 3); g.stroke();
    g.fillColor = empty ? new Color(112, 103, 70) : color;
    g.rect(left + 1, -height / 2 + 6, 2, height - 12); g.fill();

    for (const n of ['TroopNumber', 'SoldierCount', 'SoldierIcon', 'StateIcon', 'EmptyAction']) {
        const child = top.getChildByName(n); if (child) child.active = false;
    }
    const mainX = left + 38;
    if (empty) {
        g.fillColor = new Color(21, 29, 23); g.rect(mainX - 21, -21, 42, 42); g.fill();
        g.strokeColor = new Color(164, 143, 93, 150); g.rect(mainX - 21, -21, 42, 42); g.stroke();
        g.strokeColor = C.gold; g.lineWidth = 2;
        g.moveTo(mainX - 7, 0); g.lineTo(mainX + 7, 0); g.moveTo(mainX, -7); g.lineTo(mainX, 7); g.stroke();
        textStyle(nameLabel, left + 116, 0, 104, 14, C.muted);
        statusLabel.node.active = false;
        const action = caption(top, 'EmptyAction', data.canEdit ? '编队 ›' : '未配置', right - 31, 0, 52, 12, C.gold, Label.HorizontalAlign.CENTER);
        action.node.active = true;
    } else {
        // 主将为方形近景，副将保持独立槽位，不拉伸画像。
        for (const slot of [{ x: mainX, y: 8, size: 60 }, { x: right - 61, y: 5, size: 28 }, { x: right - 25, y: 5, size: 28 }]) {
            g.fillColor = new Color(20, 27, 21); g.rect(slot.x - slot.size / 2 - 2, slot.y - slot.size / 2 - 2, slot.size + 4, slot.size + 4); g.fill();
            g.strokeColor = new Color(174, 147, 88, 180); g.lineWidth = 1;
            g.rect(slot.x - slot.size / 2 - 2, slot.y - slot.size / 2 - 2, slot.size + 4, slot.size + 4); g.stroke();
        }
        textStyle(nameLabel, left + 160, 33, width - 86, 15, C.text); nameLabel.isBold = true;
        const number = caption(top, 'TroopNumber', String(data.order), mainX - 21, 31, 19, 10, new Color(255, 229, 172), Label.HorizontalAlign.CENTER);
        number.node.active = true;
        const oldRibbon = number.node.getChildByName('Ribbon'); if (oldRibbon) oldRibbon.active = false;
        // 背板与数字分层，避免子节点遮住父节点上的 Label。
        const ribbon = inkSurface(top, 'NumberRibbon', 20, 19, new Color(66, 50, 26, 245), null);
        ribbon.node.setPosition(mainX - 21, 31, 0);
        const icon = commandGlyph(top, 'SoldierIcon', 'army', left + 85, 4, 16, data.soldiers > 0 ? C.gold : C.muted); icon.active = true;
        const count = caption(top, 'SoldierCount', String(Math.max(0, data.soldiers)).replace(/\B(?=(\d{3})+(?!\d))/g, ','), left + 128, 4, 68, 18,
            data.soldiers > 0 ? new Color(243, 222, 165) : new Color(192, 151, 111), Label.HorizontalAlign.LEFT);
        count.isBold = true; count.node.active = true;
        g.fillColor = new Color(15, 24, 18, 115); g.rect(left + 5, -height / 2 + 5, width - 10, 21); g.fill();
        const glyph: CommandGlyph = data.state === '攻城中' ? 'attack' : data.state === '占领中' ? 'flag' : data.state === '待命' ? 'home'
            : data.state === '行军中' || data.state === '回城中' || data.state === '调动中' ? 'move' : 'army';
        commandGlyph(top, 'StateIcon', glyph, left + 18, -34, 13, color).active = true;
        statusLabel.node.active = true;
        textStyle(statusLabel, 8, -34, width - 70, 11, color);
        g.strokeColor = C.gold; g.lineWidth = 1.5;
        const cy = -34, direction = data.expanded ? -1 : 1;
        g.moveTo(right - 19, cy + direction * 2); g.lineTo(right - 15, cy - direction * 2); g.lineTo(right - 11, cy + direction * 2); g.stroke();
    }
    troopPortrait(top, 'LeaderHead', data.heroes[0] || 0, mainX, 8, 60);
    troopPortrait(top, 'DeputyHead1', data.heroes[1] || 0, right - 61, 5, 28);
    troopPortrait(top, 'DeputyHead2', data.heroes[2] || 0, right - 25, 5, 28);
    const ribbon = top.getChildByName('NumberRibbon');
    if (ribbon) { ribbon.active = !empty; ribbon.setSiblingIndex(top.children.length - 1); }
    // 空槽保持 + 提示，主将缺位时不把副将挪作主将。
    if (!empty) for (let slot = 0; slot < 3; slot++) {
        if (data.heroes[slot]) continue;
        const x = slot === 0 ? mainX : slot === 1 ? right - 61 : right - 25, y = slot === 0 ? 8 : 5;
        g.strokeColor = C.muted; g.lineWidth = 1; g.moveTo(x - 4, y); g.lineTo(x + 4, y); g.moveTo(x, y - 4); g.lineTo(x, y + 4); g.stroke();
    }
    top.getChildByName('TroopNumber')?.setSiblingIndex(top.children.length - 1);
    const button = top.getComponent(Button);
    if (button) { button.target = top; button.transition = Button.Transition.SCALE; button.zoomScale = .985; button.duration = .08; }
}

export function troopSidebarDetail(parent: Node): void {
    const ui = parent.getComponent(UITransform);
    hideSprite(parent);
    const old = parent.getChildByName('CommandSkin'); if (old) old.active = false;
    const surface = inkSurface(parent, 'TroopDetailSurface', ui.width, ui.height, new Color(23, 31, 25), new Color(137, 127, 86, 90));
    surface.node.setSiblingIndex(0);
}
