import { BlockInputEvents, Button, Color, Label, Node, SafeArea, ScrollView, UITransform, Widget, isValid } from 'cc';
import ListLogic from '../../utils/ListLogic';
import { styleGeneralPageBackground } from './GeneralPageBackground';
import { caption, hideSprite, inkSurface, ManagementColors as C, panelButton, place, textStyle } from './ManagementStyle';

const FILTERS = ['全部', '主动', '被动', '追击', '指挥'];

/** 卡片保留预制体的 180×240 尺寸，交互与复用仍由 ListLogic 管理。 */
export function styleSkillCard(node: Node, icon: Node, name: Label, equipment: Label,
    equipped: boolean): void {
    hideSprite(node);
    const g = inkSurface(node, 'SkillCardSurface', 180, 240, new Color(26, 30, 25, 238),
        equipped ? new Color(180, 153, 96, 200) : new Color(127, 119, 92, 75));
    // 方形纸绘占据卡片主体，细铜线只沿画面外缘，不压住原画。
    g.fillColor = new Color(17, 21, 18, 255);
    g.rect(-83, -61, 166, 166); g.fill();
    g.strokeColor = new Color(163, 141, 94, equipped ? 205 : 125);
    g.lineWidth = 1;
    g.rect(-82, -60, 164, 164); g.stroke();
    for (const side of [-1, 1]) {
        const x = side * 85;
        g.moveTo(x - side * 12, 107); g.lineTo(x, 107); g.lineTo(x, 95);
        g.moveTo(x - side * 12, -63); g.lineTo(x, -63); g.lineTo(x, -51);
    }
    g.stroke();
    // 虚拟列表复用时也清理旧展示层，不留下上一次卡片的说明或状态。
    for (const childName of ['SkillType', 'SkillTarget']) {
        const legacy = node.getChildByName(childName);
        if (legacy) legacy.active = false;
    }
    place(icon, 0, 22, 160, 160);
    hideSprite(icon.getChildByName('wrap'));
    textStyle(name, 0, -85, 164, 20, C.text, Label.HorizontalAlign.CENTER, 30);
    name.overflow = Label.Overflow.SHRINK;
    equipment.node.active = equipped;
    textStyle(equipment, 0, -109, 156, 12, C.gold, Label.HorizontalAlign.CENTER, 20);
}

/** 战法总览：安全区、类型筛选与自适应虚拟网格。 */
export default class SkillListView {
    private readonly safe: Node;
    private readonly page: Node;
    private readonly close: Node;
    private readonly title: Label;
    private readonly summary: Label;
    private readonly empty: Label;
    private readonly tabs: Node[] = [];
    private readonly list: ListLogic;
    private filter = 0;
    private count = 0;
    private total = 0;
    private arranging = false;
    private gridKey = '';

    constructor(private readonly root: Node, private readonly scroll: ScrollView,
        onFilter: (type: number) => void) {
        this.page = scroll.node.parent;
        this.close = this.page.getChildByName('closeBtn');
        this.title = this.page.getChildByName('New Label')?.getComponent(Label);
        this.list = scroll.getComponent(ListLogic);
        if (!this.close || !this.title || !this.list) throw new Error('[SkillList] 战法列表预制体结构不完整');
        if (!root.getComponent(BlockInputEvents)) root.addComponent(BlockInputEvents);
        this.stretch(root);
        this.safe = new Node('SkillListSafeArea'); this.safe.layer = root.layer;
        this.safe.addComponent(UITransform);
        root.addChild(this.safe);
        this.stretch(this.safe);
        this.safe.addComponent(SafeArea);
        this.page.parent = this.safe;
        hideSprite(scroll.node);
        scroll.horizontal = false; scroll.vertical = true;
        scroll.elastic = false; scroll.cancelInnerEvents = true;
        this.list.autoColumnCount = false;
        this.list.isHorizontal = false;
        this.list.isVirtual = true;
        this.summary = caption(this.page, 'SkillListSummary', '', 0, 0, 180, 14, C.muted, Label.HorizontalAlign.RIGHT);
        for (const childName of ['SkillListSubtitle', 'SkillListFooter']) {
            const legacy = this.page.getChildByName(childName);
            if (legacy) legacy.active = false;
        }
        this.empty = caption(scroll.node.getChildByName('view'), 'NoSkills', '暂无该类型战法', 0, 0, 300, 18,
            C.muted, Label.HorizontalAlign.CENTER);
        this.empty.node.active = false;
        FILTERS.forEach((text, index) => {
            const tab = new Node(`SkillFilter${index}`); tab.layer = root.layer;
            tab.addComponent(UITransform); tab.addComponent(Button);
            this.page.addChild(tab);
            tab.on(Button.EventType.CLICK, () => onFilter(index));
            this.tabs.push(tab);
        });
        root.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.refreshSize();
    }

    public setState(filter: number, count: number, total: number): void {
        this.filter = filter; this.count = count; this.total = total;
        this.summary.string = filter ? `${count} / ${total}` : `${total}`;
        this.empty.node.active = count === 0;
        this.scroll.vertical = count > 0;
        this.layoutTabs();
    }

    public refreshSize(): void {
        this.root.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment();
        this.safe.getComponent(SafeArea).updateArea();
        this.layout();
    }

    private layout = (): void => {
        if (this.arranging || !this.list || !isValid(this.root, true)) return;
        const safe = this.safe.getComponent(UITransform), root = this.root.getComponent(UITransform);
        if (safe.width <= 1 || safe.height <= 1) return;
        this.arranging = true;
        try {
            styleGeneralPageBackground(this.root, root.width, root.height);
            place(this.page, 0, 0, safe.width, safe.height);
            const compact = safe.width < 580;
            const width = Math.max(200, Math.min(1152, safe.width - (compact ? 32 : 80)));
            const left = -width / 2, top = safe.height / 2;
            textStyle(this.title, left + (width - 80) / 2, top - 42, width - 80, compact ? 28 : 30,
                C.text, Label.HorizontalAlign.LEFT, 40);
            this.title.string = '战法';
            panelButton(this.close, '', width / 2 - 22, top - 42, 44, 44, false, true);
            this.layoutTabs();

            const headerHeight = width < 800 ? 158 : 136;
            const gridHeight = Math.max(80, safe.height - headerHeight - 16);
            const gridY = top - headerHeight - gridHeight / 2;
            place(this.scroll.node, 0, gridY, width, gridHeight);
            const viewport = this.scroll.node.getChildByName('view');
            place(viewport, 0, 0, width, gridHeight);
            const contentUI = this.scroll.content.getComponent(UITransform);
            contentUI.width = width;
            contentUI.setAnchorPoint(.5, 1);
            const gap = compact ? 10 : 12;
            const columns = Math.max(1, Math.min(6, Math.floor((width + gap) / ((compact ? 132 : 164) + gap))));
            const scale = Math.min(1, (width - gap * (columns - 1)) / columns / 180);
            const key = `${width}:${gridHeight}:${columns}:${scale}`;
            if (key !== this.gridKey) {
                this.gridKey = key;
                this.list.columnCount = columns;
                this.list.spaceColumn = gap;
                this.list.spaceRow = 12;
                this.list.scale = scale;
                this.list.refreshLayout();
            }
            place(this.empty.node, 0, 0, width - 24, 40);
            const rule = inkSurface(this.page, 'SkillListRule', width, 1, C.line, null);
            rule.node.setPosition(0, top - headerHeight + 3, 0);
        } finally {
            this.arranging = false;
        }
    };

    private layoutTabs(): void {
        if (!this.tabs.length) return;
        const size = this.safe.getComponent(UITransform), compact = size.width < 580;
        const width = Math.max(200, Math.min(1152, size.width - (compact ? 32 : 80)));
        const stacked = width < 800;
        const tabGap = compact ? 6 : 8;
        const tabWidth = Math.min(100, (width - (stacked ? 0 : 192) - tabGap * 4) / 5);
        const top = size.height / 2;
        this.tabs.forEach((tab, index) => panelButton(tab, FILTERS[index],
            -width / 2 + tabWidth / 2 + index * (tabWidth + tabGap), top - 96,
            tabWidth, 40, index === this.filter));
        textStyle(this.summary, stacked ? 0 : width / 2 - 90, stacked ? top - 136 : top - 96,
            stacked ? width : 180, 13, C.muted,
            stacked ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.RIGHT, 24);
    }

    private stretch(node: Node): void {
        const widget = node.getComponent(Widget) || node.addComponent(Widget);
        widget.isAlignHorizontalCenter = widget.isAlignVerticalCenter = false;
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
    }

    public dispose(): void {
        if (isValid(this.root, true)) this.root.off(Node.EventType.SIZE_CHANGED, this.layout, this);
        if (isValid(this.safe, true)) this.safe.off(Node.EventType.SIZE_CHANGED, this.layout, this);
    }
}
