import { Button, Color, EditBox, Label, Node, ScrollView, UITransform } from 'cc';
import { caption, headerRule, hideSprite, inkSurface, ManagementColors as C, manualLayout,
    modalBackdrop, panelButton, place, textStyle } from '../map/ui/ManagementStyle';
import ListLogic from '../utils/ListLogic';
import UnionCommand from './UnionCommand';

function button(root: Node, handler: string, data?: string): Node | null {
    return root.getComponentsInChildren(Button).find(b => b.clickEvents.some(e => e.handler === handler
        && (data === undefined || e.customEventData === data)))?.node || null;
}

function label(node: Node, name: string, x: number, y: number, width: number, size = 18, color = C.text): Label | null {
    const value = node.getChildByName(name)?.getComponent(Label);
    textStyle(value, x, y, width, size, color);
    if (value) value.overflow = Label.Overflow.SHRINK;
    return value;
}

function card(node: Node, x: number, y: number, width: number, height: number): void {
    place(node, x, y, width, height); hideSprite(node);
    inkSurface(node, 'UnionCard', width, height, C.panel, C.line);
}

function rule(node: Node, width: number, y: number): void {
    headerRule(node, width, y);
    node.getChildByName('ManagementHeaderRule').setSiblingIndex(node.children.length - 1);
}

function editBox(edit: EditBox, width: number, height: number): void {
    place(edit.node, 0, 0, width - 24, height - 16);
    hideSprite(edit.node.getChildByName('BACKGROUND_SPRITE'));
    inkSurface(edit.node, 'UnionInput', width, height, C.inset, C.line);
    textStyle(edit.textLabel, 0, 0, width - 24, 16, C.text, Label.HorizontalAlign.LEFT, height - 20);
    textStyle(edit.placeholderLabel, 0, 0, width - 24, 14, C.muted, Label.HorizontalAlign.LEFT, height - 20);
}

function mainPage(page: Node, width: number, height: number): void {
    const proxy = UnionCommand.getInstance().proxy, union = proxy.getUnion();
    const info = page.getChildByName('info'), notice = page.getChildByName('notice'), actions = page.getChildByName('btns');
    const narrow = width < 620, available = height - 78;
    const infoW = narrow ? width : 280, infoH = narrow ? 140 : available;
    const noticeW = narrow ? width : width - infoW - 20;
    const noticeH = narrow ? available - infoH - 12 : available;
    const top = height / 2;
    card(info, narrow ? 0 : -width / 2 + infoW / 2, top - infoH / 2, infoW, infoH);
    card(notice, narrow ? 0 : width / 2 - noticeW / 2,
        narrow ? top - infoH - 12 - noticeH / 2 : top - noticeH / 2, noticeW, noticeH);
    const left = -infoW / 2 + 22, textW = infoW - 44;
    caption(info, 'AllianceCaption', '我的联盟', left + textW / 2, infoH / 2 - 24, textW, 13, C.gold);
    label(info, 'name', left + textW / 2, infoH / 2 - 60, textW, narrow ? 26 : 30);
    if (narrow) {
        caption(info, 'LeaderCaption', '盟主', left + 19, -38, 38, 13, C.muted);
        label(info, 'mengzhu', left + 46 + (textW - 120) / 2, -38, textW - 120, 15);
        caption(info, 'MemberCount', union ? `${union.cnt || 0}/${union.memberMax || '—'} 人` : '—',
            infoW / 2 - 56, -38, 80, 14, C.gold, Label.HorizontalAlign.RIGHT);
    } else {
        rule(info, textW, infoH / 2 - 94);
        caption(info, 'LeaderCaption', '盟主', left + textW / 2, infoH / 2 - 122, textW, 13, C.muted);
        label(info, 'mengzhu', left + textW / 2, infoH / 2 - 154, textW, 21);
        caption(info, 'MemberCaption', '联盟成员', left + textW / 2, -infoH / 2 + 104, textW, 13, C.muted);
        caption(info, 'MemberCount', union ? `${union.cnt || 0} / ${union.memberMax || '—'}` : '—',
            left + textW / 2, -infoH / 2 + 72, textW, 24, C.text);
        caption(info, 'MyRole', `我的身份 · ${proxy.myPos === 1 ? '盟主' : proxy.myPos === 2 ? '官员' : '成员'}`,
            left + textW / 2, -infoH / 2 + 28, textW, 13, C.gold);
    }
    for (const name of ['ManagementHeaderRule', 'MemberCaption', 'MyRole']) {
        const node = info.getChildByName(name); if (node) node.active = !narrow;
    }

    label(notice, 'New Label', -noticeW / 2 + 94, noticeH / 2 - 30, 144, 19, C.text);
    panelButton(notice.getChildByName('modifyBtn'), '编辑公告', noticeW / 2 - 72, noticeH / 2 - 30, 104, 36);
    rule(notice, noticeW - 44, noticeH / 2 - 58);
    const text = notice.getChildByName('text').getComponent(Label);
    textStyle(text, 0, -22, noticeW - 48, 18, union?.notice ? C.text : C.muted,
        Label.HorizontalAlign.LEFT, noticeH - 100);
    text.verticalAlign = Label.VerticalAlign.TOP; text.enableWrapText = true;
    text.lineHeight = 28; text.overflow = Label.Overflow.SHRINK;
    const editor = notice.getChildByName('edit'); place(editor, 0, -12, noticeW - 40, noticeH - 76);
    const input = editor.getComponentInChildren(EditBox);
    input.inputMode = EditBox.InputMode.ANY;
    editBox(input, noticeW - 48, Math.max(52, noticeH - 144));
    input.textLabel.enableWrapText = true; input.textLabel.verticalAlign = Label.VerticalAlign.TOP;
    input.placeholderLabel.verticalAlign = Label.VerticalAlign.TOP;
    input.node.setPosition(0, 20, 0);
    panelButton(editor.getChildByName('submitBtn'), '保存公告', noticeW / 2 - 80, -noticeH / 2 + 38, 112, 40, true);
    panelButton(editor.getChildByName('cancelBtn'), '取消', noticeW / 2 - 198, -noticeH / 2 + 38, 104, 40);

    manualLayout(actions); place(actions, 0, -height / 2 + 28, width, 56);
    const nodes = [actions.getChildByName('memberBtn'), actions.getChildByName('applyBtn'), actions.getChildByName('logBtn')].filter(n => n.active);
    const labels = { memberBtn: '联盟成员', applyBtn: '入盟申请', logBtn: '联盟日志' };
    const gap = 12, buttonW = (width - gap * (nodes.length - 1)) / Math.max(1, nodes.length);
    nodes.forEach((node, index) => panelButton(node, labels[node.name], -width / 2 + buttonW / 2 + index * (buttonW + gap), 0, buttonW, 48, index === 0));
    const dot = actions.getChildByName('applyBtn')?.getChildByName('img_gem_21');
    if (dot) place(dot, buttonW / 2 - 10, 18, 10, 10);
}

function row(node: Node, width: number, kind: string): void {
    const pos = node.position.clone(), h = kind === 'log' ? 78 : 72;
    card(node, pos.x, pos.y, width, h);
    if (kind === 'member') {
        label(node, 'title', -width / 2 + 50, 0, 68, 13, C.gold);
        label(node, 'name', -width / 2 + 100 + (width - 214) / 2, 11, width - 214, 18);
        label(node, 'pos', -width / 2 + 100 + (width - 214) / 2, -16, width - 214, 12, C.muted);
        panelButton(node.getChildByName('jump'), '定位', width / 2 - 48, 0, 72, 38);
    } else if (kind === 'apply') {
        label(node, 'name', -width / 2 + 16 + (width - 182) / 2, 0, width - 182, 17);
        panelButton(button(node, 'verify', '1'), '同意', width / 2 - 118, 0, 68, 38, true);
        panelButton(button(node, 'verify', '2') || button(node, 'verify', '0'), '拒绝', width / 2 - 42, 0, 68, 38);
    } else if (kind === 'log') {
        label(node, 'desLab', 0, 14, width - 32, 16);
        label(node, 'timeLab', 0, -17, width - 32, 12, C.muted);
    } else {
        label(node, 'name', -52, 0, width - 140, 19);
        panelButton(button(node, 'join'), '申请加入', width / 2 - 66, 0, 108, 40, true);
    }
}

function listPage(page: Node, width: number, height: number, kind: string): void {
    const titles = { member: '联盟成员', apply: '入盟申请', log: '联盟日志', lobby: '寻找联盟' };
    const title = page.getChildByName('New Label'); if (title) title.active = false;
    caption(page, 'SectionTitle', titles[kind], -width / 2 + 110, height / 2 - 20, 220, 23, C.text);
    const proxy = UnionCommand.getInstance().proxy;
    const count = kind === 'member' ? proxy.getMemberList().length : kind === 'apply' ? proxy.getApplyList().length : kind === 'lobby' ? proxy.getUnionList().length : 0;
    caption(page, 'SectionCount', kind === 'log' ? '' : `${count} ${kind === 'lobby' ? '个联盟' : '人'}`,
        width / 2 - 60, height / 2 - 20, 120, 14, C.muted, Label.HorizontalAlign.RIGHT);
    const scroll = page.getComponentInChildren(ScrollView), list = scroll.node.getComponent(ListLogic);
    hideSprite(scroll.node); place(scroll.node, 0, 0, width, height - 124);
    scroll.horizontal = false; scroll.vertical = true;
    if (scroll.verticalScrollBar) scroll.verticalScrollBar.node.active = false;
    const viewport = scroll.content.parent;
    place(viewport, 0, 0, width, height - 124);
    list.spaceRow = 8; list.spaceColumn = 0; list.columnCount = 1; list.scale = 1;
    row(list.itemNode, width, kind);
    if (list.enabledInHierarchy) {
        scroll.content.children.forEach(n => row(n, width, kind));
        list.refreshLayout();
    }
    const empty = caption(page, 'EmptyState', kind === 'log' ? '联盟日志暂未开放' : kind === 'apply' ? '暂无待处理的入盟申请'
        : kind === 'member' ? '正在读取联盟成员…' : '暂无可加入的联盟', 0, 0, width - 32, 16, C.muted, Label.HorizontalAlign.CENTER);
    empty.node.active = count === 0;
    panelButton(page.getChildByName('back'), '返回联盟', -width / 2 + 62, -height / 2 + 24, 124, 44);
    panelButton(button(page, 'dismiss'), '解散联盟', width / 2 - 62, -height / 2 + 24, 124, 44);
    panelButton(button(page, 'exit'), '退出联盟', width / 2 - 62, -height / 2 + 24, 124, 44);
    panelButton(button(page, 'openCreate'), '创建联盟', width / 2 - 70, -height / 2 + 24, 140, 44, true);
    if (kind === 'member') for (const op of page.children.filter(n => n.name === 'opNode')) {
        const buttons = op.getComponentsInChildren(Button).filter(b => b.node.active);
        card(op, 0, 0, Math.min(340, width), 72 + buttons.length * 52);
        caption(op, 'Heading', '成员管理', 0, 12 + buttons.length * 26, Math.min(300, width - 32), 20, C.text);
        buttons.forEach((b, i) => panelButton(b.node, ({ ti: '移出联盟', rang: '转让盟主', renming: '任命官员', jieren: '解除职务' })[b.node.name] || '管理',
            0, buttons.length * 26 - 30 - i * 52, Math.min(292, width - 48), 42));
    }
}

function createPage(page: Node, width: number, height: number): void {
    place(page, 0, 0, width, height);
    const mask = page.getChildByName('mask'); hideSprite(mask);
    place(mask, 0, 0, width, height); inkSurface(mask, 'UnionShade', width, height, new Color(10, 16, 12, 220), null);
    const panel = page.getChildByName('New Node'), w = Math.min(420, width - 32);
    card(panel, 0, 0, w, 270);
    for (const name of ['diban1_23', 'tipsbiaoti']) panel.getChildByName(name).active = false;
    caption(panel, 'Heading', '创建联盟', 0, 94, w - 40, 24, C.text);
    caption(panel, 'InputCaption', '联盟名称', 0, 44, w - 40, 13, C.muted);
    const edit = panel.getComponentInChildren(EditBox); editBox(edit, w - 40, 46); edit.placeholder = '为联盟取一个名字';
    panelButton(button(panel, 'onRandomName'), '换个名字', -w / 4 + 4, -84, (w - 52) / 2, 44);
    panelButton(button(panel, 'onCreate'), '创建联盟', w / 4 - 4, -84, (w - 52) / 2, 44, true);
    panelButton(page.getChildByName('closeBtn'), '', w / 2 - 26, 108, 36, 36, false, true);
}

/** 只整理原节点的视觉和布局，按钮仍使用 prefab 中的协议回调。 */
export function styleUnion(root: Node): void {
    const screen = modalBackdrop(root, root.getChildByName('bg'));
    inkSurface(root.getChildByName('bg'), 'ManagementBackdrop', screen.width, screen.height, new Color(10, 16, 12, 210), null);
    let frame = root.getChildByName('UnionFrame');
    if (!frame) {
        frame = new Node('UnionFrame'); frame.layer = root.layer; frame.addComponent(UITransform);
        const nodes = root.children.filter(n => n.name !== 'bg'); root.addChild(frame);
        nodes.forEach(n => n.setParent(frame));
    }
    const w = Math.max(340, Math.min(1000, screen.width - 40)), h = Math.max(560, Math.min(620, screen.height - 40));
    const scale = Math.min(1, (screen.width - 24) / w, (screen.height - 24) / h);
    place(frame, 0, 0, w, h); frame.setScale(scale, scale, 1);
    inkSurface(frame, 'UnionSurface', w, h, C.ink, C.gold);
    label(frame, 'labelTitle', -w / 2 + 110, h / 2 - 34, 172, 28);
    caption(frame, 'Subtitle', '同盟一心，共守山河', -w / 2 + 160, h / 2 - 66, 272, 13, C.muted);
    panelButton(frame.getChildByName('btnClose'), '', w / 2 - 38, h / 2 - 36, 44, 44, false, true);
    rule(frame, w - 48, h / 2 - 90);
    const width = w - 48, height = h - 132;
    for (const name of ['main', 'member', 'apply', 'log', 'lobby']) {
        const page = frame.getChildByName(name); place(page, 0, -24, width, height);
        if (name === 'main') mainPage(page, width, height);
        else listPage(page, width, height, name);
    }
    createPage(frame.getChildByName('create'), w, h);
    frame.getChildByName('create').setSiblingIndex(frame.children.length - 1);
}
