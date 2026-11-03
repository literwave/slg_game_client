import { BlockInputEvents, Button, Color, Label, Node, SafeArea, ScrollView, UITransform, Widget, isValid } from 'cc';
import ListLogic from '../../utils/ListLogic';
import { styleGeneralPageBackground } from './GeneralPageBackground';
import { caption, hideSprite, inkSurface, ManagementColors as C, panelButton, place, textStyle } from './ManagementStyle';

const FILTERS = ['全部', '主动', '被动', '追击', '指挥'];

/** 卡片保留预制体的 180×240 尺寸，交互与复用仍由 ListLogic 管理。 */
export function styleSkillCard(node: Node, icon: Node, name: Label, equipment: Label,
    trigger: number, triggerName: string, targetName: string, equipped: boolean): void {
    hideSprite(node);
    const g = inkSurface(node, 'SkillCardSurface', 180, 240, new Color(31, 39, 33, 248),
        equipped ? new Color(180, 153, 96, 190) : new Color(127, 130, 106, 100));
    g.strokeColor = new Color(153, 134, 91, 70); g.lineWidth = 1;
    g.moveTo(-72, -82); g.lineTo(72, -82); g.stroke();
    if (equipped) {
        g.fillColor = C.gold; g.roundRect(-24, 117, 48, 2, 1); g.fill();
    }
    caption(node, 'SkillType', triggerName || FILTERS[trigger] || '战法', 0, 100, 152, 13, C.gold,
        Label.HorizontalAlign.CENTER);
    place(icon, 0, 28, 110, 110);
    const wrap = icon.getChildByName('wrap');
    if (wrap) place(wrap, 0, 0, 110, 110);
    textStyle(name, 0, -47, 160, 20, C.text, Label.HorizontalAlign.CENTER, 30);
    name.overflow = Label.Overflow.SHRINK;
    caption(node, 'SkillTarget', targetName || '查看战法效果', 0, -70, 156, 13, C.muted,
        Label.HorizontalAlign.CENTER);
    textStyle(equipment, 0, -102, 156, 14, equipped ? new Color(171, 191, 159, 255) : C.muted,
        Label.HorizontalAlign.CENTER, 26);
}

/** 战法总览：安全区、类型筛选与自适应虚拟网格。 */
export default class SkillListView {
    private readonly safe: Node;
    private readonly page: Node;
    private readonly close: Node;
    private readonly title: Label;
    private readonly subtitle: Label;
    private readonly summary: Label;
    private readonly footer: Label;
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
        this.subtitle = caption(this.page, 'SkillListSubtitle', '查阅战法效果与适用兵种', 0, 0, 400, 14, C.muted);
        this.summary = caption(this.page, 'SkillListSummary', '', 0, 0, 180, 14, C.muted, Label.HorizontalAlign.RIGHT);
        this.footer = caption(this.page, 'SkillListFooter', '点击卡片查看战法详情', 0, 0, 320, 13, C.muted,
            Label.HorizontalAlign.CENTER);
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
        this.summary.string = filter ? `${FILTERS[filter]} ${count} / 共 ${total}` : `共 ${total} 种战法`;
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
            textStyle(this.subtitle, left + (width - 80) / 2, top - 76, width - 80, compact ? 12 : 14, C.muted);
            panelButton(this.close, '', width / 2 - 22, top - 42, 44, 44, false, true);
            this.layoutTabs();

            const headerHeight = width < 800 ? 184 : 166;
            const gridHeight = Math.max(80, safe.height - headerHeight - 44);
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
            place(this.footer.node, 0, -safe.height / 2 + 22, width, 28);
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
            -width / 2 + tabWidth / 2 + index * (tabWidth + tabGap), top - 124,
            tabWidth, 40, index === this.filter));
        textStyle(this.summary, stacked ? 0 : width / 2 - 90, stacked ? top - 162 : top - 124,
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
