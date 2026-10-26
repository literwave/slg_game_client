import { BlockInputEvents, Button, Color, Label, Node, Sprite, SpriteFrame } from 'cc';
import { hideSprite, inkSurface, ManagementColors as C, manualLayout, place, textStyle } from './ManagementStyle';

interface HudMenuIcons {
    recruit: SpriteFrame;
    warReport: SpriteFrame;
    skill: SpriteFrame;
    settings: SpriteFrame;
}

function menuLabel(button: Node): Label | null {
    const background = button?.getChildByName('Background');
    return background?.getComponentInChildren(Label) || button?.getComponentInChildren(Label) || null;
}

function findAction(parent: Node, handler: string): Node | null {
    const matches = parent.children.filter(node => node.getComponent(Button)?.clickEvents
        .some(event => event.handler === handler));
    if (matches.length > 1) throw new Error('[HUD] 菜单事件重复：' + handler);
    return matches[0] || null;
}

function replaceIcon(button: Node, frame: SpriteFrame): void {
    let icon = button.getChildByName('Icon');
    if (!icon) {
        icon = new Node('Icon');
        icon.layer = button.layer;
        button.addChild(icon);
        icon.addComponent(Sprite);
    }
    const sprite = icon.getComponent(Sprite);
    if (!sprite) throw new Error('[HUD] ' + button.name + ' 的图标缺少 Sprite');
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = frame;
    sprite.color = Color.WHITE;
    place(icon, 0, 13, 48, 48);
}

/** 移动已有入口，保留原 Button 和业务回调。 */
export function arrangeHudEntries(hud: Node, icons: HudMenuIcons): void {
    const navigation = hud?.getChildByName('BottomNav');
    const more = hud?.getChildByName('MorePanel');
    if (!navigation || !more) throw new Error('[HUD] 导航容器缺失');
    const recruit = more.getChildByName('DrawButton') || navigation.getChildByName('DrawButton');
    const collection = navigation.getChildByName('btnCollection') || more.getChildByName('btnCollection');
    const market = findAction(navigation, 'openTr') || more.getChildByName('MarketButton');
    const general = findAction(navigation, 'onClickGeneral');
    const union = findAction(navigation, 'openUnion');
    const innerCity = navigation.getChildByName('InnerCityButton');
    const moreButton = navigation.getChildByName('MoreButton');
    const report = hud.getChildByName('WarReportButton') || more.getChildByName('WarReportButton');
    const chat = more.getChildByName('ChatButton');
    const skill = more.getChildByName('SkillButton');
    const settings = more.getChildByName('SettingButton');
    if (![recruit, collection, market, general, union, innerCity, moreButton, report, skill, settings].every(Boolean)
        || ![icons.recruit, icons.warReport, icons.skill, icons.settings].every(Boolean) || !menuLabel(recruit)) {
        throw new Error('[HUD] 菜单入口或图标引用不完整');
    }

    collection.parent = more;
    market.name = 'MarketButton';
    market.parent = more;
    recruit.parent = navigation;
    menuLabel(recruit).string = '点将';
    [innerCity, general, recruit, union, moreButton].forEach((node, index) => node.setSiblingIndex(index));
    report.parent = hud;
    // 菜单向左避开战报；战报在遮罩上方，展开更多时仍可直接打开。
    const moreIndex = more.getSiblingIndex();
    report.setSiblingIndex(moreIndex + (report.getSiblingIndex() > moreIndex ? 1 : 0));
    replaceIcon(recruit, icons.recruit);
    replaceIcon(report, icons.warReport);
    if (chat) chat.active = false;
    replaceIcon(skill, icons.skill);
    settings.active = true;
    replaceIcon(settings, icons.settings);
    // 退出入口由设置页接管。
    const exit = more.getChildByName('ExitButton');
    if (exit) exit.active = false;

    // 已替换的圆圈、文字和线框装饰不再进入显示层级。
    for (const entry of [...navigation.children, ...more.children, report]) {
        if (!entry.getComponent(Button)) continue;
        for (const name of ['IconRing', 'IconDisc', 'IconChar', 'Accent', 'MoreMenuGlyph']) {
            const old = entry.getChildByName(name);
            if (old) { old.removeFromParent(); old.destroy(); }
        }
    }
}

/** 常驻入口共用图标、标签和点击区域尺寸，保持上下两排一致。 */
function styleNavigationEntry(button: Node, x: number, y: number, width: number): void {
    place(button, x, y, width, 80);
    const background = button.getChildByName('Background');
    if (background) {
        const captionWidth = Math.min(64, width - 2);
        place(background, 0, -25, captionWidth, 25);
        hideSprite(background);
        inkSurface(background, 'NavCaptionSurface', captionWidth, 25, new Color(30, 35, 27, 205), null);
    }
    textStyle(menuLabel(button), 0, 0, width - 4, 16, C.text, Label.HorizontalAlign.CENTER, 24);
    place(button.getChildByName('Icon'), 0, 13, 48, 48);
    const component = button.getComponent(Button);
    component.target = button;
    component.transition = Button.Transition.SCALE;
    component.zoomScale = .96;
}

/** 右侧常驻战报：对齐下方“更多”，同时保留未读角标。 */
export function styleWarReportShortcut(button: Node | null, x: number, y: number, width: number): void {
    if (!button) return;
    styleNavigationEntry(button, x, y, width);
    const unread = button.getChildByName('img_gem_21');
    if (unread) {
        place(unread, 20, 28, 12, 12);
        unread.setSiblingIndex(button.children.length - 1);
    }
}

export function styleBottomNavigation(navigation: Node, width: number): void {
    manualLayout(navigation);
    const entries = navigation.children.filter(node => node.active && node.getComponent(Button));
    const step = width / Math.max(1, entries.length);
    entries.forEach((button, index) => {
        styleNavigationEntry(button, (index - (entries.length - 1) / 2) * step, 0, step - 8);
    });
}

export function styleMoreMenu(panel: Node | null, width: number): void {
    if (!panel) return;
    manualLayout(panel);
    const entries = ['InventoryButton', 'MailButton', 'RankButton', 'btnCollection',
        'SkillButton', 'MarketButton', 'SettingButton']
        .map(name => panel.getChildByName(name)).filter(node => node?.active);
    const columns = Math.max(1, Math.min(5, Math.floor((width - 16) / 56)));
    const rows = Math.max(1, Math.ceil(entries.length / columns));
    const height = rows * 76;
    place(panel, panel.position.x, panel.position.y, width, height);
    hideSprite(panel);
    if (!panel.getComponent(BlockInputEvents)) panel.addComponent(BlockInputEvents);
    // 图标直接浮在地图上，仅保留透明的菜单点击区域。
    const oldSurface = panel.getChildByName('MoreMenuSurface');
    if (oldSurface) { oldSurface.removeFromParent(); oldSurface.destroy(); }
    const oldTitle = panel.getChildByName('MoreMenuTitle');
    if (oldTitle) { oldTitle.removeFromParent(); oldTitle.destroy(); }
    const oldRule = panel.getChildByName('ManagementHeaderRule');
    if (oldRule) { oldRule.removeFromParent(); oldRule.destroy(); }
    const step = (width - 16) / Math.min(columns, Math.max(1, entries.length));
    entries.forEach((button, index) => {
        const col = index % columns, row = Math.floor(index / columns);
        place(button, (col - (Math.min(columns, entries.length) - 1) / 2) * step,
            (rows - 1) * 38 - row * 76, step - 4, 68);
        const background = button.getChildByName('Background');
        if (background) {
            place(background, 0, 0, step - 4, 68);
            hideSprite(background);
            const oldSurface = background.getChildByName('ManagementButton');
            if (oldSurface) oldSurface.active = false;
        }
        const label = menuLabel(button);
        textStyle(label, 0, -20, step - 8, 13, C.text, Label.HorizontalAlign.CENTER, 22);
        if (label) {
            label.enableOutline = true;
            label.outlineColor = new Color(24, 28, 18, 220);
            label.outlineWidth = 2;
        }
        place(button.getChildByName('Icon'), 0, 11, 36, 36);
        const component = button.getComponent(Button);
        if (component) {
            component.target = button;
            component.transition = Button.Transition.SCALE;
            component.zoomScale = .96;
        }
    });
}
