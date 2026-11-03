import { BlockInputEvents, Button, Color, EditBox, Graphics, Label, Node, ProgressBar, Slider, Sprite, UITransform, Widget, view } from 'cc';
import { caption, headerRule, hideSprite, inkSurface, ManagementColors as C, manualLayout, panelButton, place, textStyle } from './ManagementStyle';
import { styleGeneralPageBackground } from './GeneralPageBackground';
import { gameCloseButton } from './TaskBoardView';
import { troopAttributeIcon, TroopAttributeIcon } from './TroopAttributeIcons';
import { troopPortrait } from './TroopSidebarCard';

const SURFACE = new Color(151, 144, 117, 25);
const CONTROL = new Color(151, 144, 117, 46);
const LINE = new Color(190, 166, 119, 105);
const RULE = new Color(190, 166, 119, 50);
const TITLE_INSET = 26;

function polygon(g: Graphics, points: number[][]): void {
    g.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(p => g.lineTo(p[0], p[1])); g.close();
}

/** 用旗帜和盔甲表示待上阵武将，避免空卡反复显示大段操作说明。 */
function emptyHero(parent: Node, width: number, height: number, leader: boolean): void {
    const g = inkSurface(parent, 'EmptyHeroSilhouette', 160, 190, null, null);
    const scale = Math.min((width - 36) / 160, (height - 94) / 190, 1.2);
    g.node.setScale(Math.max(.35, scale), Math.max(.35, scale), 1);
    g.node.setPosition(0, 24, 0);
    g.fillColor = new Color(40, 34, 25, 125); g.strokeColor = new Color(172, 143, 82, 55); g.lineWidth = 1;
    polygon(g, [[-62, 90], [62, 90], [62, -64], [0, -89], [-62, -64]]); g.fill(); g.stroke();
    g.strokeColor = new Color(183, 151, 87, 90); g.lineWidth = 2;
    for (const side of [-1, 1]) {
        g.moveTo(side * 61, -68); g.lineTo(side * 61, 72); g.stroke();
        polygon(g, [[side * 61, 91], [side * 56, 70], [side * 66, 70]]); g.fill();
    }
    g.fillColor = new Color(118, 105, 76, 120); g.strokeColor = new Color(198, 169, 108, 115);
    // 头盔、面甲和肩甲保持中性轮廓，不冒用尚未上阵的武将头像。
    polygon(g, [[-27, 24], [-25, 49], [-12, 64], [12, 64], [25, 49], [27, 24], [14, 31], [-14, 31]]); g.fill(); g.stroke();
    polygon(g, [[-18, 28], [18, 28], [16, 0], [0, -14], [-16, 0]]); g.fill(); g.stroke();
    g.moveTo(0, 52); g.lineTo(0, 5); g.moveTo(-16, 19); g.lineTo(-5, 16); g.moveTo(5, 16); g.lineTo(16, 19); g.stroke();
    polygon(g, [[-18, -9], [-45, -18], [-52, -39], [-29, -47], [0, -62], [29, -47], [52, -39], [45, -18], [18, -9], [0, -22]]); g.fill(); g.stroke();
    for (const y of [-28, -39, -50]) { g.moveTo(-19, y + 6); g.lineTo(0, y); g.lineTo(19, y + 6); g.stroke(); }
    if (leader) {
        g.fillColor = new Color(165, 111, 57, 110);
        polygon(g, [[-4, 62], [-9, 83], [1, 96], [13, 84], [7, 62]]); g.fill();
    }
}

function squadDiagram(parent: Node, height: number, heroes: number[]): void {
    const unit = height / 7;
    const bottom = unit * .85 + 18;
    const scale = Math.min(1, Math.max(.35, (height / 2 - bottom - 8) / 107));
    const g = inkSurface(parent, 'SquadDiagram', 168, 116, null, null);
    g.node.setPosition(0, bottom + 57 * scale); g.node.setScale(scale, scale, 1);
    g.node.setSiblingIndex(parent.children.length - 1);
    g.strokeColor = RULE; g.lineWidth = 1.5;
    g.moveTo(-19, 16); g.lineTo(-52, -5); g.moveTo(19, 16); g.lineTo(52, -5); g.stroke();
    const slots = [[0, 25, 44], [-52, -20, 34], [52, -20, 34]];
    slots.forEach(([x, y, size], index) => {
        const old = g.node.getChildByName('Position_' + index); if (old) old.active = false;
        const occupied = heroes[index] > 0, edge = size / 2;
        g.fillColor = new Color(29, 28, 21); g.roundRect(x - edge - 3, y - edge - 3, size + 6, size + 6, 3); g.fill();
        g.strokeColor = index === 0 ? C.gold : new Color(158, 138, 94); g.lineWidth = index === 0 ? 2 : 1;
        g.roundRect(x - edge - 2, y - edge - 2, size + 4, size + 4, 2); g.stroke();
        troopPortrait(g.node, 'FormationHead_' + index, heroes[index] || 0, x, y, size);
        const placeholder = troopAttributeIcon(g.node, 'VacantRole_' + index, 'soldiers', x, y, size - 6, true);
        placeholder.active = !occupied;
        const label = caption(g.node, 'RoleTitle_' + index, index === 0 ? '主将' : '副将',
            x, y - edge - 12, 42, 10, occupied ? C.gold : C.muted, Label.HorizontalAlign.CENTER);
        textStyle(label, x, y - edge - 12, 42, 10, occupied ? C.gold : C.muted, Label.HorizontalAlign.CENTER, 16);
    });
}

function arrowButton(node: Node | null, x: number, y: number, direction: number): void {
    if (!node) return;
    troopButton(node, '', x, y, 44, 36);
    const g = inkSurface(node, 'SquadArrow', 28, 28, null, null);
    g.strokeColor = C.gold; g.lineWidth = 2;
    g.moveTo(-direction * 4, -7); g.lineTo(direction * 4, 0); g.lineTo(-direction * 4, 7); g.stroke();
}

export interface TroopVisualState {
    soldiers: number | null; wounded: number; reserve: number; allocated: number;
    speed: number; attack: number; supply: boolean;
}

/** 只更新可视数据，不触发请求或重建卡槽，滑杆和拖动过程保持原节点。 */
export function updateTroopPanelStatus(parts: TroopPanelParts): void {
    const info = parts.node?.getChildByName('infoNode'), state = parts.visualState;
    if (!info || !state) return;
    const size = info.getComponent(UITransform); if (!size) return;
    const unit = size.height / 7, compact = size.height < 310;
    const heroes = parts.generalLayer?.children.map(n => (n.getComponent('CityGeneralItemLogic') as any)?.formationHeroId || 0) || [];
    squadDiagram(info, size.height, heroes);
    const value = caption(info, 'SoldierValue', state.soldiers === null ? '—' : String(state.soldiers), 17, -unit * .15,
        size.width - 66, compact ? 26 : 34, C.text, Label.HorizontalAlign.CENTER);
    value.isBold = true; value.overflow = Label.Overflow.SHRINK;
    caption(info, 'WoundedValue', state.soldiers === null ? '同步中' : `伤兵 ${state.wounded}`, 10, -unit * 1.02,
        size.width - 52, 12, C.muted, Label.HorizontalAlign.CENTER);
    troopAttributeIcon(info, 'SoldierIcon', 'soldiers', -size.width / 2 + 25, -unit * .15, compact ? 25 : 30);
    troopAttributeIcon(info, 'WoundedIcon', 'wounded', -30, -unit * 1.02, 20);
    const values = [state.speed, state.attack], keys = ['SpeedValue', 'AttackValue'];
    values.forEach((number, index) => {
        const text = Number.isFinite(number) ? String(Math.round(number * 100) / 100) : '—';
        const label = info.getChildByName(keys[index])?.getComponent(Label); if (label) label.string = text;
    });
    const footer = parts.node.getChildByName('conscriptNode');
    if (!footer) return;
    const reserve = footer.getChildByName('ReserveValue')?.getComponent(Label);
    const allocated = footer.getChildByName('AllocatedValue')?.getComponent(Label);
    if (reserve) { reserve.string = String(state.reserve); reserve.node.active = state.supply; }
    if (allocated) { allocated.string = '+' + state.allocated; allocated.node.active = state.supply; }
    if (parts.labelResCost) parts.labelResCost.node.active = !state.supply;
    for (const name of ['ReserveTitle', 'ReserveGlyph', 'AllocatedTitle', 'AllocatedGlyph']) {
        const node = footer.getChildByName(name); if (node) node.active = state.supply;
    }
}

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
        const surface = inkSurface(bg, 'TroopCardSurface', width, height,
            logic.index === 0 ? new Color(72, 57, 33, 130) : new Color(42, 39, 29, 110), LINE);
        cornerMarks(surface, width, height);
        surface.strokeColor = new Color(178, 150, 93, logic.index === 0 ? 120 : 55);
        surface.rect(-width / 2 + 12, -height / 2 + 12, width - 24, height - 24); surface.stroke();
        const button = bg.getComponent(Button);
        if (button) { button.transition = Button.Transition.SCALE; button.target = bg; button.zoomScale = .985; }
    }
    const title = root.getChildByName('bgTitle');
    if (title) {
        place(title, 0, height / 2 - TITLE_INSET, width - 32, 32);
        hideSprite(title);
        const rule = inkSurface(title, 'TroopRoleSurface', width - 32, 32, null, null);
        rule.lineWidth = 1; rule.strokeColor = LINE; rule.fillColor = new Color(103, 75, 36, 180);
        polygon(rule, [[-38, 15], [38, 15], [38, -11], [0, -19], [-38, -11]]); rule.fill(); rule.stroke();
        textStyle(logic.labelTitle, 0, 0, 60, 16, C.gold, Label.HorizontalAlign.CENTER, 24);
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
        emptyHero(add, width, height, logic.index === 0);
        const g = inkSurface(add, 'EmptyTroopGlyph', 48, 48, null, null);
        const plusY = -Math.min(88, (height - 100) * .36);
        g.node.setPosition(0, plusY, 0); g.node.setSiblingIndex(add.children.length - 1);
        g.fillColor = new Color(111, 82, 39, 210);
        g.circle(0, 0, 23); g.fill();
        g.lineWidth = 2; g.strokeColor = new Color(197, 166, 108, 180);
        g.circle(0, 0, 23); g.stroke();
        g.strokeColor = C.gold;
        g.moveTo(-9, 0); g.lineTo(9, 0); g.moveTo(0, -9); g.lineTo(0, 9); g.stroke();
        const hint = caption(add, 'ChooseHeroHint', '上阵', 0, plusY - 36, width - 24, 15, C.text, Label.HorizontalAlign.CENTER);
        textStyle(hint, 0, plusY - 36, width - 24, 15, C.text, Label.HorizontalAlign.CENTER, 24);
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
    visualState?: TroopVisualState;
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
            left + 142, 0, 208, compact ? 25 : 28);
        troopAttributeIcon(header, 'HeaderFlag', 'formation', left + 15, 0, 34);
        const close = header.getChildByName('btnClose');
        if (close) gameCloseButton(close, usable / 2 - 22, 0);
        headerRule(header, usable, -30);
        if (parts.labelId) {
            parts.labelId.node.parent = header;
            textStyle(parts.labelId, cardsX, 0, 104, 21, C.text, Label.HorizontalAlign.CENTER, 30);
        }
    }
    arrowButton(root.getChildByName('btnPrev'), cardsX - 94, headerY, -1);
    arrowButton(root.getChildByName('btnNext'), cardsX + 94, headerY, 1);
    caption(root, 'TroopSelectionHint', '拖动换位', cardsX,
        bodyTop + 14, cardAreaWidth, 12, C.muted, Label.HorizontalAlign.CENTER);

    const info = root.getChildByName('infoNode');
    if (info) {
        place(info, left + summaryWidth / 2, cardY, summaryWidth, cardHeight);
        hideSprite(info.getChildByName('bg'));
        hideSprite(info.getChildByName('bg2'));
        inkSurface(info, 'TroopSummary', summaryWidth, cardHeight, new Color(34, 35, 25, 175), LINE);
        for (const name of ['SummaryTitle', 'SummaryTitleRule', 'label1', 'label2', 'label3', 'label4', 'label5',
            'SummaryRule0', 'SummaryRule1', 'SummaryRule2', 'SummaryRule3', 'SummaryRule4']) {
            const node = info.getChildByName(name); if (node) node.active = false;
        }
        const unit = cardHeight / 7, statWidth = (summaryWidth - 36) / 2, statHeight = Math.min(76, unit * 1.45);
        textStyle(parts.labelCost, 0, unit * .85, summaryWidth - 20, 14, C.gold, Label.HorizontalAlign.CENTER, 24);
        if (parts.labelCost) parts.labelCost.overflow = Label.Overflow.SHRINK;
        for (const label of [parts.labelSoldierCnt, parts.labelSpeed, parts.labelAtkCity]) if (label) label.node.active = false;
        (['march', 'attack'] as TroopAttributeIcon[]).forEach((kind, index) => {
            const x = (index - .5) * (statWidth + 8), y = -unit * 2;
            const plate = inkSurface(info, 'Attribute_' + index, statWidth, statHeight, new Color(93, 82, 53, 55), RULE);
            plate.node.setPosition(x, y);
            plate.node.setSiblingIndex(info.children.length - 1);
            const valueY = y - statHeight * .19;
            troopAttributeIcon(info, 'AttributeIcon_' + index, kind,
                x - statWidth / 2 + (compact ? 17 : 20), valueY, compact ? 28 : 34);
            const title = caption(info, 'AttributeTitle_' + index, index ? '部队攻击' : '行军速度',
                x, y + statHeight * .29, statWidth - 12, 12, C.text, Label.HorizontalAlign.CENTER);
            textStyle(title, x, y + statHeight * .29, statWidth - 12, 12, C.text, Label.HorizontalAlign.CENTER, 20);
            title.isBold = true;
            title.node.setSiblingIndex(info.children.length - 1);
            const label = caption(info, index ? 'AttackValue' : 'SpeedValue', '—', x + (compact ? 16 : 18), valueY,
                statWidth - (compact ? 36 : 42), compact ? 20 : 22, C.text, Label.HorizontalAlign.CENTER);
            label.isBold = true; label.overflow = Label.Overflow.SHRINK;
            label.node.setSiblingIndex(info.children.length - 1);
        });
        troopAttributeIcon(info, 'AdditionGlyph', 'bonus', -summaryWidth / 2 + 28, -unit * 3, 22, true);
        caption(info, 'AdditionTitle', '加成', -22, -unit * 3, 40, 11, C.muted, Label.HorizontalAlign.CENTER);
        textStyle(parts.labelAddition, 30, -unit * 3, summaryWidth - 100, 12, C.muted, Label.HorizontalAlign.CENTER, 22);
        place(info.getChildByName('additionNode'), 0, -unit * 3, summaryWidth - 20, 26);
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
    const allocationLabelHeight = 24;
    const oldTitle = footer.getChildByName('ConscriptTitle'); if (oldTitle) oldTitle.active = false;
    troopAttributeIcon(footer, 'ReserveGlyph', 'reserve', left + 28, allocationY, 36);
    caption(footer, 'ReserveTitle', '预备兵', left + summaryWidth / 2 + 12, allocationY + 17,
        summaryWidth - 66, 12, C.muted, Label.HorizontalAlign.CENTER);
    const reserveValue = caption(footer, 'ReserveValue', '—', left + summaryWidth / 2 + 12, allocationY - 11,
        summaryWidth - 60, 26, C.text, Label.HorizontalAlign.CENTER);
    reserveValue.isBold = true; reserveValue.overflow = Label.Overflow.SHRINK;
    for (let index = 0; index < 3; index++) {
        const x = cardsX + (index - 1) * (cardWidth + cardGap);
        const surface = inkSurface(footer, 'AllocationColumn' + index, cardWidth, allocationHeight, SURFACE, LINE);
        surface.node.setPosition(x, allocationY, 0);
        const title = footer.getChildByName('title' + (index + 1));
        if (title) {
            hideSprite(title);
            place(title, x - cardWidth / 2 + 29, fieldY, 26, allocationLabelHeight);
            const label = title.getComponentInChildren(Label);
            if (label) label.node.active = false;
            troopAttributeIcon(title, 'ReinforceGlyph', 'reinforce', 0, 0, 25);
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
        const tip = parts.tipNodes[index];
        if (tip) {
            place(tip, x, allocationY - 6, cardWidth - 24, 30);
            const label = tip.getComponent(Label); if (label) label.enabled = false;
            troopAttributeIcon(tip, 'EmptyAllocation', 'soldiers', -17, 0, 21, true);
            caption(tip, 'EmptyAmount', '—', 14, 0, 34, 16, C.muted, Label.HorizontalAlign.CENTER);
        }
    }
    const actionY = -footerHeight / 2 + actionHeight / 2;
    const quick = footer.getChildByName('btnQuick'), sure = footer.getChildByName('btnSure');
    troopButton(quick, '快速分兵', usable / 2 - 204, actionY, 128, actionHeight);
    troopButton(sure, '确认分兵', usable / 2 - 64, actionY, 128, actionHeight, true);
    for (const node of [quick, sure]) if (node) {
        troopAttributeIcon(node, 'ActionGlyph', node === quick ? 'reserve' : 'reinforce', -47, 0, 22);
        const label = node.getComponentInChildren(Label); if (label) textStyle(label, 10, 0, 92, 15, C.text, Label.HorizontalAlign.CENTER, 26);
    }
    troopAttributeIcon(footer, 'AllocatedGlyph', 'reinforce', left + 14, actionY, 24);
    caption(footer, 'AllocatedTitle', '本次增援', left + 67, actionY, 76, 12, C.muted, Label.HorizontalAlign.CENTER);
    caption(footer, 'AllocatedValue', '+0', left + 160, actionY, 96, 22, C.gold, Label.HorizontalAlign.LEFT);
    const costWidth = usable - 292;
    textStyle(parts.labelResCost, left + costWidth / 2, actionY, costWidth, 12, C.muted, Label.HorizontalAlign.LEFT, 24);
    if (parts.labelResCost) parts.labelResCost.overflow = Label.Overflow.SHRINK;
    updateTroopPanelStatus(parts);
}
