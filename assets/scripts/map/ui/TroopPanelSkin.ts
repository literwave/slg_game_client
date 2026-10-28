import { BlockInputEvents, Button, Color, EditBox, Graphics, Label, Node, ProgressBar, Slider, Sprite, UITransform, Widget, view } from 'cc';
import { caption, headerRule, hideSprite, inkSurface, ManagementColors as C, manualLayout, panelButton, place, textStyle } from './ManagementStyle';
import { styleGeneralPageBackground } from './GeneralPageBackground';

const SURFACE = new Color(151, 144, 117, 25);
const CONTROL = new Color(151, 144, 117, 46);
const LINE = new Color(190, 166, 119, 105);
const RULE = new Color(190, 166, 119, 50);
const TITLE_INSET = 26;

/** 只调整部队页的按钮底色，保留共享按钮的点击事件和主操作强调色。 */
function troopButton(node: Node | null, text: string, x: number, y: number,
    width: number, height = 44, primary = false, close = false): void {
    panelButton(node, text, x, y, width, height, primary, close);
    if (!node || primary) return;
    const background = node.getChildByName('Background') || node;
    const g = inkSurface(background, 'ManagementButton', width, height, CONTROL, LINE);
    if (close) {
        g.lineWidth = 2;
        g.strokeColor = C.text;
        g.moveTo(-7, -7); g.lineTo(7, 7);
        g.moveTo(-7, 7); g.lineTo(7, -7);
        g.stroke();
    }
}

function removeDecoration(parent: Node, name: string): void {
    const old = parent.getChildByName(name);
    if (old) { old.removeFromParent(); old.destroy(); }
}

/** 使用当前页面容器的尺寸，确保窗口变化时背景和内容使用同一坐标系。 */
function fitTroopPage(root: Node): { width: number; height: number } {
    const ui = root.getComponent(UITransform);
    if (root.parent?.getComponent(UITransform)) {
        const widget = root.getComponent(Widget) || root.addComponent(Widget);
        root.setScale(1, 1, 1);
        ui.setAnchorPoint(.5, .5);
        widget.target = null;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        widget.isAlignLeft = widget.isAlignRight = widget.isAlignTop = widget.isAlignBottom = true;
        widget.left = widget.right = widget.top = widget.bottom = 0;
        widget.enabled = true;
        widget.updateAlignment();
    }
    if (!root.getComponent(BlockInputEvents)) root.addComponent(BlockInputEvents);
    return ui?.contentSize || view.getVisibleSize();
}

function cornerMarks(g: Graphics, width: number, height: number): void {
    g.strokeColor = new Color(197, 166, 108, 135);
    g.lineWidth = 1;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = sx * (width / 2 - 5), y = sy * (height / 2 - 5);
        g.moveTo(x - sx * 9, y); g.lineTo(x, y); g.lineTo(x, y - sy * 9);
    }
    g.stroke();
}

/** 空位和武将信息共用完整卡槽，保留原点击节点及业务事件。 */
export function styleTroopCard(root: Node, width: number, height: number): void {
    const logic = root.getComponent('CityGeneralItemLogic') as any;
    if (!logic) return;
    root.getComponent(UITransform)?.setContentSize(width, height);
    const compact = height < 310;
    const bg = root.getChildByName('bg');
    if (bg) {
        place(bg, 0, 0, width, height);
        hideSprite(bg);
        const surface = inkSurface(bg, 'TroopCardSurface', width, height, SURFACE, LINE);
        cornerMarks(surface, width, height);
        const button = bg.getComponent(Button);
        if (button) { button.transition = Button.Transition.SCALE; button.target = bg; button.zoomScale = .985; }
    }
    const title = root.getChildByName('bgTitle');
    if (title) {
        place(title, 0, height / 2 - TITLE_INSET, width - 32, 32);
        hideSprite(title);
        const rule = inkSurface(title, 'TroopRoleSurface', width - 32, 32, null, null);
        rule.lineWidth = 1; rule.strokeColor = RULE;
        rule.moveTo(-width / 2 + 16, -16); rule.lineTo(width / 2 - 16, -16); rule.stroke();
        textStyle(logic.labelTitle, -width / 2 + 46, 0, 60, 16, C.gold, Label.HorizontalAlign.LEFT, 24);
        troopButton(logic.btnDown, '下阵', width / 2 - 40, 0, 48, 28);
    }
    const info = logic.infoNode as Node;
    if (info) {
        place(info, 0, 0, width, height);
        ['bgCost', 'bgbottom', 'bgCamp'].forEach(name => hideSprite(info.getChildByName(name)));
        const portrait = Math.max(56, Math.min((width - 28) * 480 / 350, height - (compact ? 132 : 142)));
        const portraitWidth = portrait * 350 / 480;
        const portraitY = height / 2 - (compact ? 44 : 50) - portrait / 2;
        place(logic.headIcon?.node, 0, portraitY, portraitWidth, portrait);
        if (logic.headIcon) logic.headIcon.sizeMode = Sprite.SizeMode.CUSTOM;
        textStyle(logic.labelName, 0, portraitY - portrait / 2 - (compact ? 18 : 20), width - 24,
            compact ? 17 : 20, C.text, Label.HorizontalAlign.CENTER, compact ? 24 : 28);
        textStyle(logic.labelCost, 0, portraitY - portrait / 2 - (compact ? 42 : 46), width - 24,
            compact ? 12 : 13, C.muted, Label.HorizontalAlign.CENTER, 18);
        textStyle(logic.labelLv, -portraitWidth / 2 + 22, portraitY + portrait / 2 - 12,
            40, 12, C.text, Label.HorizontalAlign.CENTER, 20);
        textStyle(logic.labelCamp, portraitWidth / 2 - 16, portraitY + portrait / 2 - 12,
            28, 13, C.gold, Label.HorizontalAlign.CENTER, 20);
        const soldier = info.getChildByName('soldierNode');
        if (soldier) {
            place(soldier, 0, -height / 2 + 18, width - 24, 30);
            hideSprite(soldier.getChildByName('bg'));
            if (logic.labelArms) logic.labelArms.node.active = false;
            textStyle(logic.labelSoldierCnt, 0, 4, width - 24, 12, C.muted, Label.HorizontalAlign.CENTER, 18);
            const bar = logic.progressBar as ProgressBar;
            if (bar) {
                place(bar.node, 0, -10, width - 36, 3);
                bar.totalLength = width - 36;
                if (bar.barSprite) bar.barSprite.color = C.gold;
            }
        }
        const con = logic.conBg as Node;
        if (con) {
            place(con, 0, portraitY, Math.min(width - 24, 132), 56);
            hideSprite(con);
            inkSurface(con, 'ConscriptState', Math.min(width - 24, 132), 56, new Color(83, 73, 52, 230), LINE);
            textStyle(logic.labelConTime, 0, 12, width - 32, 14, C.text, Label.HorizontalAlign.CENTER);
            textStyle(logic.labelConCnt, 0, -12, width - 32, 14, C.gold, Label.HorizontalAlign.CENTER);
        }
    }
    const add = logic.addNode as Node;
    if (add) {
        if (add.parent !== root) add.setParent(root);
        place(add, 0, -12, width - 20, height - 60);
        hideSprite(add);
        const g = inkSurface(add, 'EmptyTroopGlyph', 56, 56, null, null);
        g.node.setPosition(0, 8, 0);
        g.fillColor = CONTROL;
        g.circle(0, 0, 28); g.fill();
        g.lineWidth = 2; g.strokeColor = new Color(197, 166, 108, 180);
        g.circle(0, 0, 28); g.stroke();
        g.strokeColor = C.gold;
        g.moveTo(-9, 0); g.lineTo(9, 0); g.moveTo(0, -9); g.lineTo(0, 9); g.stroke();
        const hint = caption(add, 'ChooseHeroHint', '选择武将', 0, -44, width - 24, 16, C.text, Label.HorizontalAlign.CENTER);
        textStyle(hint, 0, -44, width - 24, 16, C.text, Label.HorizontalAlign.CENTER, 24);
    }
    if (logic.lockNode) {
        place(logic.lockNode, 0, -12, width - 20, height - 60);
        hideSprite(logic.lockNode);
        textStyle(logic.labelTip, 0, -28, width - 24, 13, C.muted, Label.HorizontalAlign.CENTER);
    }
}

interface TroopPanelParts {
    node: Node;
    generalLayer: Node;
    labelId: Label;
    labelCost: Label;
    labelSoldierCnt: Label;
    labelSpeed: Label;
    labelAtkCity: Label;
    labelAddition: Label;
    labelResCost: Label;
    editBoxs: EditBox[];
    sliders: Slider[];
    tipNodes: Node[];
}

export function styleTroopPanel(parts: TroopPanelParts): void {
    const root = parts.node;
    const { width, height } = fitTroopPage(root);
    styleGeneralPageBackground(root, width, height, root.getChildByName('bg'));
    const compact = height < 620 || width < 1000;
    const margin = width < 1000 ? 24 : 40;
    const usable = Math.min(1120, width - margin * 2);
    const left = -usable / 2;
    const summaryWidth = compact ? 176 : 208;
    const gutter = compact ? 20 : 24;
    const cardGap = compact ? 12 : 16;
    const cardAreaWidth = usable - summaryWidth - gutter;
    const cardWidth = (cardAreaWidth - cardGap * 2) / 3;
    const cardsX = left + summaryWidth + gutter + cardAreaWidth / 2;
    const allocationHeight = compact ? 76 : 88;
    const actionHeight = compact ? 40 : 44;
    const actionGap = compact ? 12 : 18;
    const footerHeight = allocationHeight + actionGap + actionHeight;
    const rowGap = compact ? 12 : 16;
    const availableTop = height / 2 - (compact ? 82 : 108);
    const availableHeight = height - (compact ? 102 : 136);
    const groupHeight = Math.min(availableHeight, 400 + rowGap + footerHeight);
    const bodyTop = availableTop - (availableHeight - groupHeight) / 2;
    const cardHeight = groupHeight - rowGap - footerHeight;
    const cardY = bodyTop - cardHeight / 2;
    const footerY = bodyTop - groupHeight + footerHeight / 2;
    const headerY = bodyTop + (compact ? 46 : 60);

    const header = root.getChildByName('titleNode');
    if (header) {
        hideSprite(header);
        place(header, 0, headerY, usable, 56);
        textStyle(header.getChildByName('labelTitle')?.getComponent(Label),
            left + 120, 0, 240, compact ? 25 : 28);
        troopButton(header.getChildByName('btnClose'), '', usable / 2 - 22, 0, 44, 44, false, true);
        headerRule(header, usable, -30);
        if (parts.labelId) {
            parts.labelId.node.parent = header;
            textStyle(parts.labelId, cardsX, 0, 104, 21, C.text, Label.HorizontalAlign.CENTER, 30);
        }
    }
    troopButton(root.getChildByName('btnPrev'), '上一队', cardsX - 112, headerY, 80, 34);
    troopButton(root.getChildByName('btnNext'), '下一队', cardsX + 112, headerY, 80, 34);
    caption(root, 'TroopSelectionHint', '拖动武将交换阵位 · 点击查看详情', cardsX,
        bodyTop + 14, cardAreaWidth, 12, C.muted, Label.HorizontalAlign.CENTER);

    const info = root.getChildByName('infoNode');
    if (info) {
        place(info, left + summaryWidth / 2, cardY, summaryWidth, cardHeight);
        hideSprite(info.getChildByName('bg'));
        hideSprite(info.getChildByName('bg2'));
        inkSurface(info, 'TroopSummary', summaryWidth, cardHeight, SURFACE, LINE);
        caption(info, 'SummaryTitle', '编队概况', 0, cardHeight / 2 - TITLE_INSET, summaryWidth - 32, 18, C.gold);
        const titleRule = inkSurface(info, 'SummaryTitleRule', summaryWidth - 32, 1, RULE, null);
        titleRule.node.setPosition(0, cardHeight / 2 - TITLE_INSET - 16, 0);
        const labels = ['label1', 'label2', 'label3', 'label4', 'label5'];
        const titles = ['编队状态', '总兵力', '行军速度', '总攻击', '加成'];
        const values = [parts.labelCost, parts.labelSoldierCnt, parts.labelSpeed, parts.labelAtkCity, parts.labelAddition];
        const rowHeight = (cardHeight - 64) / 5;
        const firstY = cardHeight / 2 - 48 - rowHeight / 2;
        const labelWidth = 64;
        const valueWidth = summaryWidth - 32 - labelWidth - 8;
        const valueX = summaryWidth / 2 - 16 - valueWidth / 2;
        labels.forEach((name, index) => {
            const y = firstY - index * rowHeight;
            const label = info.getChildByName(name)?.getComponent(Label);
            textStyle(label, -summaryWidth / 2 + 16 + labelWidth / 2, y, labelWidth,
                13, C.muted, Label.HorizontalAlign.LEFT, 24);
            if (label) label.string = titles[index];
            textStyle(values[index], valueX, y, valueWidth,
                !compact && index !== 0 ? 16 : 14, C.text, Label.HorizontalAlign.RIGHT, 24);
            if (values[index]) values[index].overflow = Label.Overflow.SHRINK;
            const rule = inkSurface(info, 'SummaryRule' + index, summaryWidth - 32, 1, RULE, null);
            rule.node.setPosition(0, y - rowHeight / 2 + 1, 0);
        });
        place(info.getChildByName('additionNode'), valueX, firstY - 4 * rowHeight, valueWidth, 26);
    }

    manualLayout(parts.generalLayer);
    place(parts.generalLayer, cardsX, cardY, cardAreaWidth, cardHeight);
    parts.generalLayer?.children.forEach((card, index) => {
        place(card, (index - 1) * (cardWidth + cardGap), 0, cardWidth, cardHeight);
        styleTroopCard(card, cardWidth, cardHeight);
    });

    const footer = root.getChildByName('conscriptNode');
    if (!footer) return;
    place(footer, 0, footerY, usable, footerHeight);
    const footerBg = footer.getChildByName('bg');
    if (footerBg) hideSprite(footerBg);
    removeDecoration(footer, 'ConscriptSurface');
    removeDecoration(footer, 'ConscriptHint');
    const allocationY = footerHeight / 2 - allocationHeight / 2;
    const fieldY = allocationY + allocationHeight / 2 - 20;
    const allocationLabelSize = 16;
    const allocationLabelHeight = 24;
    const allocationTitle = caption(footer, 'ConscriptTitle', '兵力分配',
        left + summaryWidth / 2, fieldY, summaryWidth - 32, allocationLabelSize, C.gold);
    // 同一行共用字号、行高和文本框高度，避免仅中心坐标相同但字面仍显得错位。
    textStyle(allocationTitle, left + summaryWidth / 2, fieldY, summaryWidth - 32,
        allocationLabelSize, C.gold, Label.HorizontalAlign.LEFT, allocationLabelHeight);
    for (let index = 0; index < 3; index++) {
        const x = cardsX + (index - 1) * (cardWidth + cardGap);
        const surface = inkSurface(footer, 'AllocationColumn' + index, cardWidth, allocationHeight, SURFACE, LINE);
        surface.node.setPosition(x, allocationY, 0);
        const title = footer.getChildByName('title' + (index + 1));
        if (title) {
            hideSprite(title);
            place(title, x - cardWidth / 2 + 38, fieldY, 44, allocationLabelHeight);
            const label = title.getComponentInChildren(Label);
            textStyle(label, 0, 0, 44, allocationLabelSize, C.gold,
                Label.HorizontalAlign.LEFT, allocationLabelHeight);
            if (label) label.string = '增援';
        }
        const edit = parts.editBoxs[index];
        if (edit) {
            place(edit.node, x + cardWidth / 2 - 58, fieldY, 84, 30);
            hideSprite(edit.node);
            if (edit.textLabel) { edit.textLabel.fontSize = 16; edit.textLabel.color = C.text; }
            if (edit.placeholderLabel) { edit.placeholderLabel.fontSize = 16; edit.placeholderLabel.color = C.muted; }
            const bg = edit.node.getChildByName('BACKGROUND_SPRITE') || edit.node;
            if (bg !== edit.node) place(bg, 0, 0, 84, 30);
            hideSprite(bg);
            inkSurface(bg, 'InputSurface', 84, 30, CONTROL, LINE);
        }
        const slider = parts.sliders[index];
        const sliderWidth = cardWidth - 40;
        if (slider) {
            place(slider.node, x, allocationY - allocationHeight / 2 + 21, sliderWidth, 32);
            const bg = slider.node.getChildByName('Background');
            if (bg) {
                place(bg, 0, 0, sliderWidth, 3);
                hideSprite(bg);
                inkSurface(bg, 'AllocationTrack', sliderWidth, 3, new Color(172, 156, 123, 95), null);
            }
            if (slider.handle) {
                place(slider.handle.node, (slider.progress - .5) * sliderWidth, 0, 32, 32);
                hideSprite(slider.handle.node);
                inkSurface(slider.handle.node, 'SliderHandle', 14, 20, C.gold, LINE);
            }
        }
        textStyle(parts.tipNodes[index]?.getComponent(Label), x, allocationY - 10,
            cardWidth - 24, 14, C.muted, Label.HorizontalAlign.CENTER, 24);
    }
    const actionY = -footerHeight / 2 + actionHeight / 2;
    troopButton(footer.getChildByName('btnQuick'), '快速分兵', usable / 2 - 204, actionY, 128, actionHeight);
    troopButton(footer.getChildByName('btnSure'), '确认分兵', usable / 2 - 64, actionY, 128, actionHeight, true);
    const costWidth = usable - 292;
    textStyle(parts.labelResCost, left + costWidth / 2, actionY, costWidth, 12, C.muted, Label.HorizontalAlign.LEFT, 24);
    if (parts.labelResCost) parts.labelResCost.overflow = Label.Overflow.SHRINK;
}
