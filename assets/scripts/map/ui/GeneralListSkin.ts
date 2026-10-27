import { Button, Color, Graphics, Label, Node, Sprite, UITransform, Widget, view } from 'cc';
import ListLogic from '../../utils/ListLogic';
import { styleGeneralPageBackground } from './GeneralPageBackground';

const mutedInk = new Color(179, 169, 145, 255);
const paper = new Color(239, 230, 205, 255);
const bronze = new Color(172, 143, 91, 180);

function drawing(parent: Node, name: string, width: number, height: number): Graphics | null {
    let node = parent.getChildByName(name);
    if (!node) {
        node = new Node(name);
        node.layer = parent.layer;
        node.addComponent(UITransform);
        node.addComponent(Graphics);
        parent.addChild(node);
        node.setSiblingIndex(0);
    }
    const transform = node.getComponent(UITransform);
    const graphics = node.getComponent(Graphics);
    if (!transform || !graphics) return null;
    transform.setContentSize(width, height);
    graphics.clear();
    return graphics;
}

function labelStyle(node: Node | null, size: number, width: number, x: number, y: number,
    color: Color, align = Label.HorizontalAlign.CENTER): Label | null {
    const label = node?.getComponent(Label);
    const transform = node?.getComponent(UITransform);
    if (!node || !label || !transform) return null;
    transform.setAnchorPoint(.5, .5);
    transform.setContentSize(width, 44);
    node.setPosition(x, y, 0);
    label.fontSize = size;
    label.lineHeight = 40;
    label.color = color;
    label.horizontalAlign = align;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.CLAMP;
    label.enableWrapText = false;
    return label;
}

function control(node: Node | null, caption: string, x: number, y: number,
    width: number, icon: 'close' | 'book' | 'none'): void {
    const button = node?.getComponent(Button);
    const transform = node?.getComponent(UITransform);
    const background = node?.getChildByName('Background');
    const backgroundTransform = background?.getComponent(UITransform);
    if (!node || !button || !transform || !background || !backgroundTransform) return;

    // 保留原按钮及回调。关闭入口为 56px 点击区，图形独立于旧 Sprite。
    const height = icon === 'close' ? 56 : 44;
    transform.setAnchorPoint(.5, .5);
    transform.setContentSize(width, height);
    node.setPosition(x, y, 0);
    const widget = background.getComponent(Widget);
    if (widget) widget.enabled = false;
    const sprite = background.getComponent(Sprite);
    if (sprite) sprite.enabled = false;
    background.setPosition(0, 0, 0);
    background.setScale(1, 1, 1);
    backgroundTransform.setAnchorPoint(.5, .5);
    backgroundTransform.setContentSize(width, height);
    button.target = background;
    button.transition = Button.Transition.SCALE;
    button.zoomScale = .97;
    button.duration = .12;

    const primary = icon === 'book';
    // Cocos 每个节点只支持一个渲染组件，不能在 Background 上叠加 Graphics。
    const g = drawing(background, 'ControlInk', width, height);
    if (!g) return;
    const artWidth = icon === 'close' ? 44 : width;
    g.fillColor = primary ? new Color(178, 148, 99, 255) : new Color(36, 33, 28, 180);
    g.roundRect(-artWidth / 2, -22, artWidth, 44, icon === 'close' ? 22 : 4);
    g.fill();
    g.lineWidth = 1;
    g.strokeColor = bronze;
    g.roundRect(-artWidth / 2 + .5, -21.5, artWidth - 1, 43, icon === 'close' ? 21.5 : 4);
    g.stroke();

    if (icon !== 'close') {
        g.strokeColor = primary ? new Color(73, 57, 34, 120) : new Color(172, 143, 91, 65);
        g.roundRect(-artWidth / 2 + 4.5, -17.5, artWidth - 9, 35, 2);
        g.stroke();
        g.strokeColor = new Color(244, 220, 171, primary ? 120 : 40);
        g.moveTo(-artWidth / 2 + 8, 19.5);
        g.lineTo(artWidth / 2 - 8, 19.5);
        g.stroke();
    }

    g.strokeColor = primary ? new Color(44, 36, 25, 255) : paper;
    g.lineWidth = 1.8;
    if (icon === 'close') {
        g.lineWidth = 2.8;
        g.moveTo(-8, 8);
        g.lineTo(8, -8);
        g.moveTo(-8, -8);
        g.lineTo(8, 8);
        g.stroke();
        const oldLabel = background.getChildByName('Label');
        if (oldLabel) oldLabel.active = false;
        return;
    } else if (icon === 'book') {
        const cx = -38;
        // 小尺寸卷轴轮廓，与图鉴含义一致。
        g.roundRect(cx - 11, -8, 22, 16, 2);
        g.moveTo(cx - 11, 12);
        g.lineTo(cx - 11, -11);
        g.moveTo(cx + 11, 11);
        g.lineTo(cx + 11, -12);
        g.moveTo(cx - 5, 3);
        g.lineTo(cx + 5, 3);
        g.moveTo(cx - 5, -3);
        g.lineTo(cx + 2, -3);
        g.stroke();
    }

    let text = background.getChildByName('Label');
    if (!text) {
        text = new Node('Label');
        text.layer = background.layer;
        text.addComponent(UITransform);
        text.addComponent(Label);
        background.addChild(text);
    }
    const label = labelStyle(text, 18, icon === 'none' ? width - 12 : width - 46,
        icon === 'none' ? 0 : 15, 0, primary ? new Color(44, 36, 25, 255) : paper);
    if (label) label.string = caption;
}

/** 少量武将居中陈列，完整收藏采用滚动网格。 */
export function applyGeneralListSkin(root: Node, itemCount = 0, listType = 0, refreshList = true): void {
    const content = root.getChildByName('New Node');
    const contentTransform = content?.getComponent(UITransform);
    if (!content || !contentTransform) return;
    const size = view.getVisibleSize();
    if (size.width <= 0 || size.height <= 0) return;
    const width = size.width;
    const height = size.height;
    const left = -width / 2 + 64;
    const right = width / 2 - 64;
    const top = height / 2;
    const bottom = -height / 2;
    contentTransform.setContentSize(width, height);

    // 低对比暖墨纸纹承接卡牌的红金配色，不用大块黑栏切割画面。
    styleGeneralPageBackground(root, width, height);

    const title = labelStyle(content.getChildByName('titleLab'), 34, 128, 0, top - 50,
        paper, Label.HorizontalAlign.CENTER);
    if (title) title.fontFamily = 'serif';
    const counterY = width < 900 ? top - 87 : top - 50;
    labelStyle(content.getChildByName('New Label'), 14, 92, left + 46, counterY,
        mutedInk, Label.HorizontalAlign.LEFT);
    labelStyle(content.getChildByName('cntLab'), 17, 104, left + 142, counterY,
        paper, Label.HorizontalAlign.LEFT);

    control(content.getChildByName('New Button'), '', width / 2 - 44, top - 50, 56, 'close');
    control(content.getChildByName('tujianBtn'), '图鉴', right - 72, bottom + 44, 144, 'book');
    control(content.getChildByName('convertBtn'), '转换', left + 60, bottom + 44, 120, 'none');

    const scroll = content.getChildByName('New ScrollView');
    const viewport = scroll?.getChildByName('view');
    const showcase = itemCount > 0 && itemCount <= 3;
    let cardWidth = 0;
    let cardHeight = 0;
    let columnCount = 1;
    let gap = 16;
    let listHeight = Math.max(1, height - 190);
    if (scroll && viewport) {
        let listWidth = Math.max(1, width - 144);
        const list = scroll.getComponent(ListLogic);
        const card = list?.itemPrefab?.data?.getComponent(UITransform);
        if (list && card) {
            gap = showcase ? 40 : 16;
            list.scale = showcase ? Math.max(.1, Math.min(.8,
                Math.max(1, height - 240) / card.height,
                Math.max(1, listWidth - gap * (itemCount - 1)) / (card.width * itemCount))) : .5;
            cardWidth = card.width * list.scale;
            cardHeight = card.height * list.scale;
            list.autoColumnCount = false;
            list.spaceColumn = gap;
            list.spaceRow = showcase ? 0 : 20;
            columnCount = showcase ? itemCount : Math.max(1, Math.floor((listWidth + gap) / (cardWidth + gap)));
            list.columnCount = columnCount;
            if (showcase) {
                listWidth = columnCount * cardWidth + (columnCount - 1) * gap;
                listHeight = cardHeight;
            }
        }
        scroll.setPosition(0, -6, 0);
        scroll.getComponent(UITransform)?.setContentSize(listWidth, listHeight);
        viewport.getComponent(UITransform)?.setContentSize(listWidth, listHeight);
        viewport.getChildByName('content')?.getComponent(UITransform)?.setContentSize(listWidth, listHeight);
        if (refreshList) list?.refreshLayout();
    }

    let hintNode = content.getChildByName('RosterHint');
    if (!hintNode) {
        hintNode = new Node('RosterHint');
        hintNode.layer = content.layer;
        hintNode.addComponent(UITransform);
        hintNode.addComponent(Label);
        content.addChild(hintNode);
    }
    const hintY = showcase ? -listHeight / 2 - 40 : bottom + 44;
    const hint = labelStyle(hintNode, 14, Math.min(320, width - 128), 0, hintY, mutedInk);
    if (hint) hint.string = itemCount === 0 ? '暂无可用武将' :
        (listType === 0 ? '点击武将查看详情' : '点击选择武将');
    hintNode.active = showcase || itemCount === 0;

    const g = drawing(content, 'RosterRules', width, height);
    if (!g) return;
    // 两翼短线将标题收拢，页角装饰不占用内容区。
    g.lineWidth = 1;
    g.strokeColor = new Color(174, 146, 98, 150);
    for (const direction of [-1, 1]) {
        g.moveTo(direction * 68, top - 50);
        g.lineTo(direction * 156, top - 50);
        g.moveTo(direction * (width / 2 - 26), top - 26);
        g.lineTo(direction * (width / 2 - 26), top - 46);
        g.moveTo(direction * (width / 2 - 26), top - 26);
        g.lineTo(direction * (width / 2 - 46), top - 26);
        g.moveTo(direction * (width / 2 - 26), bottom + 26);
        g.lineTo(direction * (width / 2 - 26), bottom + 46);
        g.moveTo(direction * (width / 2 - 26), bottom + 26);
        g.lineTo(direction * (width / 2 - 46), bottom + 26);
        g.stroke();
    }
    g.strokeColor = new Color(174, 146, 98, 65);
    const separatorY = top - (width < 900 ? 112 : 94);
    g.moveTo(left, separatorY);
    g.lineTo(right, separatorY);
    g.stroke();
    if (showcase) {
        for (let index = 0; index < columnCount; index++) {
            const x = (index - (columnCount - 1) / 2) * (cardWidth + gap);
            g.fillColor = new Color(13, 15, 12, 95);
            g.rect(x - cardWidth / 2 - 8, -cardHeight / 2 - 20, cardWidth + 16, cardHeight + 24);
            g.fill();
            g.strokeColor = new Color(180, 149, 94, 125);
            g.lineWidth = 1;
            for (const sx of [-1, 1]) {
                for (const sy of [-1, 1]) {
                    const cornerX = x + sx * (cardWidth / 2 + 12);
                    const cornerY = -6 + sy * (cardHeight / 2 + 12);
                    g.moveTo(cornerX - sx * 16, cornerY);
                    g.lineTo(cornerX, cornerY);
                    g.lineTo(cornerX, cornerY - sy * 16);
                    g.stroke();
                }
            }
        }
    }
}
