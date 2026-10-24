import { Button, Color, Graphics, Node, UITransform } from 'cc';
import { caption, ManagementColors as C } from './ManagementStyle';
import { ServiceSection } from './PlayerServicesPanel';

/** 业务入口使用统一金线图标，与地图上的文字标记分开。 */
export function addServiceEntries(parent: Node, open: (section: ServiceSection) => void): void {
    if (!parent) return;
    const oldTaskEntry = parent.getChildByName('TaskButton');
    if (oldTaskEntry) oldTaskEntry.active = false;
    const entries: Array<[string, ServiceSection, string]> = [
        ['MailButton', 'mail', '邮件'], ['RankButton', 'rank', '排行'],
    ];
    for (const [name, section, label] of entries) {
        if (parent.getChildByName(name)) continue;
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform).setContentSize(56, 68); node.addComponent(Button);
        const background = new Node('Background'); background.layer = parent.layer; node.addChild(background);
        background.addComponent(UITransform).setContentSize(56, 68);
        caption(background, 'Caption', label, 0, -20, 52, 13, C.text);
        const icon = new Node('Icon'); icon.layer = parent.layer; node.addChild(icon);
        icon.addComponent(UITransform).setContentSize(36, 36);
        const g = icon.addComponent(Graphics); g.strokeColor = C.gold; g.lineWidth = 2;
        g.fillColor = new Color(38, 42, 31, 240);
        g.roundRect(-17, -17, 34, 34, 5); g.fill(); g.stroke();
        if (section === 'mail') {
            g.rect(-11, -8, 22, 16); g.moveTo(-11, 8); g.lineTo(0, -1); g.lineTo(11, 8);
        } else {
            g.rect(-11, -11, 6, 14); g.rect(-3, -11, 6, 24); g.rect(5, -11, 6, 9);
        }
        g.stroke();
        node.on(Button.EventType.CLICK, () => open(section));
    }
}
