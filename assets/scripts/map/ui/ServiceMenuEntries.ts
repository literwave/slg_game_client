import { Button, Color, Graphics, Node, Sprite, SpriteFrame, UITransform, resources } from 'cc';
import { caption, ManagementColors as C } from './ManagementStyle';
import { ServiceSection } from './PlayerServicesPanel';

function loadMailIcon(entry: Node): void {
    const icon = entry.getChildByName('Icon');
    if (!icon) return;
    const sprite = icon.getComponent(Sprite) || icon.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.color = Color.WHITE;
    resources.load('ui/hud/hud-mail/spriteFrame', SpriteFrame, (error, frame) => {
        if (error) {
            console.warn('[HUD] 邮件入口图标加载失败', error);
            return;
        }
        if (!sprite.isValid) return;
        sprite.spriteFrame = frame;
        const oldIcon = icon.getComponent(Graphics);
        if (oldIcon) oldIcon.enabled = false;
    });
}

/** 邮件收在更多内，活动和排行常驻头像下方；活动暂不绑定业务。 */
export function addServiceEntries(more: Node, hud: Node, open: (section: ServiceSection) => void): void {
    if (!more || !hud) return;
    const oldTaskEntry = more.getChildByName('TaskButton');
    if (oldTaskEntry) oldTaskEntry.active = false;
    const entries: Array<[string, ServiceSection | 'activity', string]> = [
        ['ActivityButton', 'activity', '活动'], ['RankButton', 'rank', '排行'], ['MailButton', 'mail', '邮件'],
    ];
    for (const [name, section, label] of entries) {
        const parent = section === 'mail' ? more : hud;
        const existing = parent.getChildByName(name) || more.getChildByName(name);
        if (existing) {
            if (existing.parent !== parent) parent.addChild(existing);
            if (section === 'mail') loadMailIcon(existing);
            continue;
        }
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform).setContentSize(56, 68);
        const button = node.addComponent(Button);
        const background = new Node('Background'); background.layer = parent.layer; node.addChild(background);
        background.addComponent(UITransform).setContentSize(56, 68);
        caption(background, 'Caption', label, 0, -20, 52, 13, C.text);
        const icon = new Node('Icon'); icon.layer = parent.layer; node.addChild(icon);
        icon.addComponent(UITransform).setContentSize(36, 36);
        if (section === 'mail') loadMailIcon(node);
        if (section === 'activity') button.interactable = false;
        else node.on(Button.EventType.CLICK, () => open(section));
    }
}
