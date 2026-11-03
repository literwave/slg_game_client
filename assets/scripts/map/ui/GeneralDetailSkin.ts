import { BlockInputEvents, Button, Color, Label, Node, UITransform, Widget } from 'cc';
import { caption, hideSprite, inkSurface, ManagementColors as C, manualLayout, panelButton, place, textStyle } from './ManagementStyle';
import { styleGeneralPageBackground } from './GeneralPageBackground';

const PANEL = new Color(30, 32, 27, 232);
const LINE = new Color(169, 147, 106, 130);
const SOFT = new Color(180, 174, 156, 255);
const FIELD = new Color(255, 246, 222, 7);

/** 先完成父级 Widget 适配，再以页面自身的坐标排版，避免混用屏幕和父容器尺寸。 */
function fitPage(root: Node): { width: number; height: number } {
    const ui = root.getComponent(UITransform);
    if (!ui) throw new Error('武将详情页缺少 UITransform');
    if (root.parent?.getComponent(UITransform)) {
        ui.setAnchorPoint(.5, .5);
        root.setScale(1, 1, 1);
        const widget = root.getComponent(Widget) || root.addComponent(Widget);
        widget.target = null;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        widget.isAlignLeft = widget.isAlignRight = true;
        widget.isAlignTop = widget.isAlignBottom = true;
        widget.left = widget.right = widget.top = widget.bottom = 0;
        widget.enabled = true;
        widget.updateAlignment();
    }
    return { width: ui.width, height: ui.height };
}

/** 页眉和正文共用同一组边界；人物卡保持原图比例。 */
function pageMetrics(width: number, height: number) {
    const contentWidth = Math.min(1120, width - 64);
    const gap = width < 1050 ? 28 : 36;
    const cardWidth = Math.min(350, contentWidth * .4, Math.max(1, height - 132) * 350 / 480);
    const bodyHeight = cardWidth * 480 / 350;
    const left = -contentWidth / 2;
    const rightWidth = contentWidth - cardWidth - gap;
    const rightX = left + cardWidth + gap + rightWidth / 2;
    // 页眉以下的可用区域垂直居中，上下保留相同留白。
    const centerY = -42;
    return { contentWidth, gap, cardWidth, bodyHeight, left, rightWidth, rightX, centerY,
        top: centerY + bodyHeight / 2 };
}

function detailText(label: Label, x: number, y: number, width: number, size: number,
    color = C.text, align = Label.HorizontalAlign.LEFT, height = 32): void {
    textStyle(label, x, y, width, size, color, align, height);
    if (label) {
        label.fontFamily = 'Microsoft YaHei';
        label.isBold = false;
    }
}

function detailCaption(parent: Node, name: string, text: string, x: number, y: number,
    width: number, size: number, color = SOFT, align = Label.HorizontalAlign.LEFT, height = 32): Label {
    const label = caption(parent, name, text, x, y, width, size, color, align);
    detailText(label, x, y, width, size, color, align, height);
    return label;
}

export function styleGeneralHeader(root: Node): void {
    const { width, height } = fitPage(root);
    const metrics = pageMetrics(width, height);
    if (!root.getComponent(BlockInputEvents)) root.addComponent(BlockInputEvents);
    styleGeneralPageBackground(root, width, height);
    const oldShade = root.getChildByName('GeneralPaperShade');
    if (oldShade) { oldShade.removeFromParent(); oldShade.destroy(); }
    const header = root.getChildByName('node');
    if (!header) return;
    place(header, 0, 0, width, height);
    header.setSiblingIndex(root.children.length - 1);
    const { contentWidth, left, cardWidth, gap } = metrics;
    const y = height / 2 - 46;
    detailCaption(header, 'ManagementTitle', '武将档案', left + 100, y, 200, 27, C.text);
    panelButton(header.getChildByName('closeBtn'), '', -left - 22, y, 44, 44, false, true);
    const tabs = header.getChildByName('ToggleGroup');
    if (tabs) {
        const active = tabs.children.filter(node => node.active);
        const tabWidth = active.length * 104 - 12;
        place(tabs, left + cardWidth + gap + tabWidth / 2, y, Math.max(92, tabWidth), 44);
        active.forEach((node, index) => {
            const label = node.getChildByName('Label')?.getComponent(Label);
            panelButton(node, label?.string || '', (index - (active.length - 1) / 2) * 104, 0, 92, 40);
            detailText(label, 0, 0, 80, 17, C.text, Label.HorizontalAlign.CENTER);
            const mark = node.getChildByName('Checkmark');
            if (mark) {
                hideSprite(mark);
                place(mark, 0, -20, 60, 2);
                inkSurface(mark, 'TabAccent', 60, 2, C.gold, null);
            }
        });
    }
    const rule = inkSurface(header, 'ManagementHeaderRule', contentWidth, 1, null, null);
    rule.node.setPosition(0, height / 2 - 84, 0);
    rule.strokeColor = LINE; rule.lineWidth = 1;
    rule.moveTo(left, 0); rule.lineTo(-left, 0); rule.stroke();
    rule.strokeColor = C.gold; rule.lineWidth = 2;
    rule.moveTo(left, 0); rule.lineTo(left + 40, 0); rule.stroke();
}

interface GeneralDetailParts {
    node: Node;
    nameLab: Label;
    generalItemParent: Node;
    skillIcons: Node[];
    skillNameLab: Label[];
    lvLabel: Label;
    expLabel: Label;
    foreLabel: Label;
    defenseLabel: Label;
    speedLabel: Label;
    strategyLabel: Label;
    destroyLabel: Label;
    powerLabel: Label;
    costLabel: Label;
}

/** 数据仍由 GeneralDesLogic 更新；这里只分开排布已有字段的名称与数值。 */
function attribute(label: Label, title: string, x: number, y: number, width: number, height = 44,
    valueSize = 22, filled = true, titleSize = 16): void {
    const row = label?.node.parent;
    if (!row) return;
    row.active = true;
    hideSprite(row);
    place(row, x, y, width, height);
    const legacyRule = row.getChildByName('AttributeRule');
    if (legacyRule) legacyRule.active = false;
    inkSurface(row, 'AttributeSurface', width, height, filled ? FIELD : null, null);
    const titleWidth = title === '等级' || title === '经验' ? 36 : 66;
    const pad = filled ? 12 : 0;
    detailCaption(row, 'AttributeTitle', title, -width / 2 + pad + titleWidth / 2, 0, titleWidth,
        titleSize, SOFT, Label.HorizontalAlign.LEFT, Math.min(32, height - 4));
    for (const separator of [':', '：']) {
        const prefix = title + separator;
        if (label.string.startsWith(prefix)) label.string = label.string.slice(prefix.length).trim();
    }
    const valueWidth = width - titleWidth - pad * 2 - 12;
    detailText(label, width / 2 - pad - valueWidth / 2, 0, valueWidth, valueSize,
        C.text, Label.HorizontalAlign.RIGHT, height - 4);
}

export function styleGeneralDetail(parts: GeneralDetailParts): void {
    const root = parts.node;
    const { width, height } = fitPage(root);
    const { cardWidth, bodyHeight, left, rightWidth, rightX, top, centerY } = pageMetrics(width, height);
    const half = bodyHeight / 2;
    const compact = bodyHeight < 450;
    const tight = bodyHeight < 380;
    const pad = rightWidth < 600 ? 20 : 28;
    const innerWidth = rightWidth - pad * 2;
    const narrow = rightWidth < 600;
    const skillHeight = tight ? 80 : compact ? (narrow ? 96 : 88) : (narrow ? 118 : 104);
    const skillY = centerY - half + pad + skillHeight / 2;
    const skillTitleHeight = compact ? 24 : 32;

    place(parts.generalItemParent, left + cardWidth / 2, centerY, cardWidth, bodyHeight);
    const card = parts.generalItemParent?.children[0];
    const cardSize = card?.getComponent(UITransform);
    if (card && cardSize?.width > 0 && cardSize.height > 0) {
        card.setPosition(0, 0, 0);
        const scale = Math.min(cardWidth / cardSize.width, bodyHeight / cardSize.height);
        card.setScale(scale, scale, 1);
    }

    const panel = inkSurface(root, 'GeneralDetailsPanel', rightWidth, bodyHeight, PANEL, LINE);
    panel.node.setPosition(rightX, centerY, 0);
    const nameTop = tight ? 26 : compact ? 30 : 36;
    detailText(parts.nameLab, rightX - rightWidth / 2 + pad + (innerWidth - 140) / 2,
        top - nameTop, innerWidth - 140, compact ? 28 : 32);
    const grid = root.getChildByName('New Node');
    // 按文字框边界逐层留白，避免经验、分区标题和首行属性互相贴近。
    const expOffset = tight ? 59 : compact ? 70 : 77;
    const expHeight = tight ? 22 : compact ? 26 : 28;
    const sectionHeight = 20;
    const sectionTop = expOffset + expHeight / 2 + (tight ? 8 : compact ? 10 : 13);
    const rowTop = sectionTop + sectionHeight + (tight ? 8 : compact ? 10 : 16);
    const rowGap = tight ? 6 : compact ? 8 : 10;
    const rowBottomLimit = bodyHeight - pad - skillHeight - 24 - skillTitleHeight / 2
        - (tight ? 8 : compact ? 12 : 16);
    const rowHeight = Math.max(24, Math.min(tight ? 28 : compact ? 32 : 44,
        Math.floor((rowBottomLimit - rowTop - rowGap * 2) / 3)));
    const smallRows = rowHeight < 38;
    const shortRows = rowHeight < 30;
    const rowStep = rowHeight + rowGap;
    const firstRowY = half - rowTop - rowHeight / 2;
    if (grid) {
        manualLayout(grid);
        place(grid, rightX, centerY, rightWidth, bodyHeight);
        const experienceWidth = Math.min(innerWidth, compact ? 228 : 240);
        attribute(parts.lvLabel, '等级', (innerWidth - experienceWidth) / 2, half - nameTop,
            experienceWidth, compact ? 30 : 34, compact ? 16 : 17, false, compact ? 14 : 16);
        attribute(parts.expLabel, '经验', (innerWidth - experienceWidth) / 2, half - expOffset,
            experienceWidth, expHeight, compact ? 16 : 17, false, compact ? 14 : 16);
        if (parts.expLabel) parts.expLabel.overflow = Label.Overflow.SHRINK;
        detailCaption(grid, 'AttributesSection', '基础属性', 0, half - sectionTop - sectionHeight / 2,
            innerWidth, 14, C.gold, Label.HorizontalAlign.LEFT, sectionHeight);
        const fields: Array<[Label, string]> = [
            [parts.foreLabel, '攻击'], [parts.defenseLabel, '防御'],
            [parts.strategyLabel, '生命'], [parts.speedLabel, '速度'],
            [parts.destroyLabel, '暴击'], [parts.powerLabel, '职业'],
        ];
        const cellWidth = (innerWidth - 16) / 2;
        fields.forEach(([label, title], index) => attribute(label, title,
            (index % 2 - .5) * (cellWidth + 16), firstRowY - Math.floor(index / 2) * rowStep,
            cellWidth, rowHeight, title === '职业' ? (smallRows ? 17 : 19) : (shortRows ? 18 : smallRows ? 19 : 22),
            true, shortRows ? 13 : smallRows ? 14 : 16));
        // 自带技能在下方技能栏展示，避免重复占用一整行属性。
        if (parts.costLabel?.node.parent) parts.costLabel.node.parent.active = false;
    }

    const skills = root.getChildByName('New Sprite(Splash)');
    if (skills) {
        // 技能区下沿与左右内边距一致，不再为操作提示预留一行。
        manualLayout(skills);
        hideSprite(skills);
        place(skills, rightX, skillY, innerWidth, skillHeight);
        detailCaption(root, 'SkillSection', '武将技能', rightX, skillY + skillHeight / 2 + 24,
            innerWidth, compact ? 14 : 16, C.gold, Label.HorizontalAlign.LEFT, skillTitleHeight);
        parts.skillIcons.forEach((icon, index) => {
            const cell = icon?.parent;
            if (!cell) return;
            const cellWidth = (innerWidth - 20) / 3;
            const empty = !(icon.getComponent('SkillIconLogic') as any)?.getSkill();
            hideSprite(cell);
            place(cell, (index - 1) * (cellWidth + 10), 0, cellWidth, skillHeight);
            inkSurface(cell, 'SkillSlotSurface', cellWidth, skillHeight,
                empty ? new Color(255, 248, 221, 5) : new Color(94, 80, 52, 64),
                empty ? new Color(158, 152, 129, 70) : LINE);
            const legacyPlus = cell.getChildByName('btn_old_jia_edd');
            if (legacyPlus) legacyPlus.active = false;
            const iconSize = tight ? 44 : compact ? 54 : narrow ? 58 : 62;
            const iconX = narrow ? 0 : -cellWidth / 2 + 14 + iconSize / 2;
            const iconY = narrow ? (tight ? 10 : 12) : 0;
            place(icon, iconX, iconY, iconSize, iconSize);
            const wrap = icon.getChildByName('wrap');
            if (wrap) {
                hideSprite(wrap);
                place(wrap, 0, 0, iconSize + 4, iconSize + 4);
                inkSurface(wrap, 'SkillEdge', iconSize + 4, iconSize + 4, null, empty ? LINE : null);
            }
            const g = inkSurface(cell, 'SkillEmptyGlyph', 28, 28, null, null);
            g.node.setPosition(iconX, iconY, 0);
            g.node.setSiblingIndex(cell.children.length - 1);
            if (empty) {
                g.lineWidth = 2; g.strokeColor = C.gold;
                g.moveTo(-9, 0); g.lineTo(9, 0); g.moveTo(0, -9); g.lineTo(0, 9); g.stroke();
            }
            const label = parts.skillNameLab[index];
            const textWidth = narrow ? cellWidth - 12 : cellWidth - iconSize - 38;
            const textX = narrow ? 0 : cellWidth / 2 - 12 - textWidth / 2;
            detailText(label, textX, narrow ? (tight ? -26 : compact ? -31 : -37) : 0,
                textWidth, tight ? 15 : compact ? 16 : narrow ? 17 : 18,
                empty ? SOFT : C.text, narrow ? Label.HorizontalAlign.CENTER : Label.HorizontalAlign.LEFT,
                tight ? 24 : compact ? 28 : 32);
            if (label && empty) label.string = '选择技能';
            if (label) label.overflow = Label.Overflow.SHRINK;
            const hint = cell.getChildByName('SkillSlotType');
            if (hint) hint.active = false;
            detailText(icon.getChildByName('lvLab')?.getComponent(Label), 0, -iconSize / 2 + 9,
                iconSize, tight ? 10 : compact ? 11 : 12, C.text, Label.HorizontalAlign.CENTER, compact ? 16 : 18);
            // 整格沿用原图标回调，并关闭图标按钮，避免父子重复触发。
            const iconButton = icon.getComponent(Button);
            if (iconButton) {
                const button = cell.getComponent(Button) || cell.addComponent(Button);
                button.clickEvents = iconButton.clickEvents.slice();
                button.target = cell;
                button.transition = Button.Transition.SCALE;
                button.zoomScale = .98;
                iconButton.enabled = false;
            }
        });
    }
    const oldHint = root.getChildByName('DetailHint');
    if (oldHint) { oldHint.removeFromParent(); oldHint.destroy(); }
}
