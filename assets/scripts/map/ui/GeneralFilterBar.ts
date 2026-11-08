import { BlockInputEvents, Button, Color, Graphics, Label, Mask, Node, ScrollView, UITransform } from 'cc';
import { defaultGeneralFilters, GeneralFilterChoices, GeneralFilterKey, GeneralRosterFilters,
    generalRosterLayout, hasGeneralFilters } from '../../general/GeneralRosterFilter';
import { AudioManager } from '../../common/AudioManager';

const PAPER = new Color(239, 230, 205), GOLD = new Color(211, 181, 122), MUTED = new Color(170, 159, 136);
const TITLES: Record<GeneralFilterKey, string> = { camp: '阵营', quality: '品质', role: '定位', assigned: '状态', sort: '排序' };

/** 左下角单一入口；选择条件只是草稿，点击确定后才更新列表。 */
export class GeneralFilterBar {
    private button: Node;
    private popup: Node;
    private panel: Node;
    private scroll: ScrollView;
    private viewport: Node;
    private content: Node;
    private state: GeneralRosterFilters = defaultGeneralFilters();
    private draft: GeneralRosterFilters = defaultGeneralFilters();
    private choices: GeneralFilterChoices;
    private width = 0;
    private height = 0;
    private selecting = false;

    constructor(private root: Node, private changed: (filters: GeneralRosterFilters) => void) {
        this.button = this.make(root, 'GeneralFilterButton'); this.button.addComponent(Button);
        this.button.on(Button.EventType.CLICK, () => {
            AudioManager.instance.playClick(); this.open();
        });
        this.popup = this.make(root, 'GeneralFilterPopup'); this.popup.active = false;
        this.popup.addComponent(BlockInputEvents);
        this.popup.on(Node.EventType.TOUCH_END, event => { if (event.target === this.popup) this.close(); });
        this.panel = this.make(this.popup, 'FilterPanel'); this.panel.addComponent(BlockInputEvents);
        const body = this.make(this.panel, 'Body'); this.scroll = body.addComponent(ScrollView);
        this.scroll.horizontal = false; this.scroll.vertical = true;
        this.scroll.cancelInnerEvents = true; this.scroll.elastic = false; this.scroll.inertia = true;
        this.viewport = this.make(body, 'Viewport'); this.viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.content = this.make(this.viewport, 'Content'); this.content.getComponent(UITransform).setAnchorPoint(.5, 1);
        this.scroll.content = this.content;
        this.action('Close', () => this.close());
        this.action('Reset', () => { this.draft = defaultGeneralFilters(); this.renderPanel(false); });
        this.action('Apply', () => { const next = { ...this.draft }; this.close(); this.changed(next); });
    }

    render(state: GeneralRosterFilters, choices: GeneralFilterChoices, width: number, height: number,
        count: number, available: number, selecting: boolean): void {
        const resized = width !== this.width || height !== this.height;
        if (selecting !== this.selecting) this.close();
        this.state = { ...state }; this.choices = choices; this.width = width; this.height = height; this.selecting = selecting;
        const hasConvert = !!this.root.getChildByName('convertBtn')?.active;
        const layout = generalRosterLayout(width, height, hasConvert);
        this.place(this.button, layout.filterX, layout.footerY, layout.buttonWidth, 44);
        const defaults = defaultGeneralFilters();
        const selected = (Object.keys(state) as GeneralFilterKey[]).filter(key => state[key] !== defaults[key]).length;
        this.drawButton(this.button, selected ? `筛选 · ${selected}` : '筛选', layout.buttonWidth, selected > 0);
        const label = this.button.getChildByName('Text');
        this.place(label, 15, 0, layout.buttonWidth - 48, 44);
        // 漏斗图标，保持与右侧图鉴一致的底栏尺寸。
        const g = this.button.getChildByName('Ink').getComponent(Graphics), x = -layout.buttonWidth / 2 + 24;
        g.strokeColor = selected ? GOLD : PAPER; g.lineWidth = 1.5;
        g.moveTo(x - 8, 8); g.lineTo(x + 8, 8); g.lineTo(x + 2, 0);
        g.lineTo(x + 2, -8); g.lineTo(x - 2, -5); g.lineTo(x - 2, 0); g.lineTo(x - 8, 8); g.stroke();
        this.place(this.popup, 0, 0, width, height);
        this.button.setSiblingIndex(this.root.children.length - 1);
        let counter = this.root.getChildByName('FilterResult');
        if (!counter) counter = this.make(this.root, 'FilterResult');
        counter.active = width >= 640 && !hasConvert;
        this.place(counter, 0, layout.footerY, 220, 32);
        this.text(counter, hasGeneralFilters(state) ? `筛选结果  ${count} / ${available}`
            : selecting ? `可选武将  ${available}` : `共 ${available} 名武将`, 13, MUTED);
        // 后台数据同步不关闭正在操作的筛选框，也不覆盖尚未确定的条件。
        if (this.popup.active) this.renderPanel(resized);
    }

    close(): void { this.popup.active = false; this.scroll.stopAutoScroll(); }

    private open(): void {
        if (this.popup.active) { this.close(); return; }
        this.draft = { ...this.state }; this.popup.active = true; this.renderPanel(true);
    }

    private renderPanel(resetScroll: boolean): void {
        const width = Math.min(552, this.width - 32), innerWidth = width - 36;
        const stacked = width < 420, labelSpace = stacked ? 0 : 56;
        const optionsWidth = innerWidth - labelSpace;
        const columns = Math.max(1, Math.floor((optionsWidth + 6) / 74));
        const keys: GeneralFilterKey[] = this.selecting ? ['camp', 'quality', 'role', 'sort']
            : ['camp', 'quality', 'role', 'assigned', 'sort'];
        const groupHeight = (key: GeneralFilterKey) => (stacked ? 26 : 0)
            + Math.ceil(this.choices[key].length / columns) * 50 - 6;
        const contentHeight = keys.reduce((sum, key) => sum + groupHeight(key) + 8, -8);
        const height = Math.min(contentHeight + 116, this.height - 96), bodyHeight = height - 116;
        const layout = generalRosterLayout(this.width, this.height);
        const x = Math.max(-this.width / 2 + width / 2 + 16, layout.filterX - layout.buttonWidth / 2 + width / 2);
        const bottom = layout.footerY + 34;
        this.place(this.panel, x, bottom + height / 2, width, height);
        const ink = this.graphics(this.panel);
        ink.fillColor = new Color(37, 34, 28, 255); ink.strokeColor = new Color(166, 138, 88); ink.lineWidth = 1;
        ink.roundRect(-width / 2, -height / 2, width, height, 4); ink.fill(); ink.stroke();
        ink.strokeColor = new Color(166, 138, 88, 80);
        ink.moveTo(-width / 2 + 18, height / 2 - 48); ink.lineTo(width / 2 - 18, height / 2 - 48); ink.stroke();
        const title = this.child(this.panel, 'Title'); this.place(title, -width / 2 + 90, height / 2 - 27, 144, 40);
        this.text(title, '武将筛选', 21, GOLD, Label.HorizontalAlign.LEFT);
        const close = this.panel.getChildByName('Close'); this.place(close, width / 2 - 28, height / 2 - 26, 44, 44);
        const cg = this.graphics(close); cg.strokeColor = MUTED; cg.lineWidth = 1.5;
        cg.moveTo(-6, 6); cg.lineTo(6, -6); cg.moveTo(-6, -6); cg.lineTo(6, 6); cg.stroke();
        const bodyY = height / 2 - 60 - bodyHeight / 2;
        this.place(this.scroll.node, 0, bodyY, innerWidth, bodyHeight);
        this.place(this.viewport, 0, 0, innerWidth, bodyHeight);
        this.content.getComponent(UITransform).setContentSize(innerWidth, Math.max(bodyHeight, contentHeight));
        if (resetScroll) { this.scroll.stopAutoScroll(); this.content.setPosition(0, bodyHeight / 2, 0); }
        this.scroll.enabled = contentHeight > bodyHeight;
        this.content.children.forEach(child => child.active = false);
        let top = 0;
        for (const key of keys) {
            const group = this.child(this.content, `Group_${key}`); group.active = true;
            const gh = groupHeight(key); this.place(group, 0, -top - gh / 2, innerWidth, gh);
            const heading = this.child(group, 'Heading');
            this.place(heading, -innerWidth / 2 + 22, gh / 2 - (stacked ? 10 : 22), 44, stacked ? 20 : 44);
            this.text(heading, TITLES[key], 14, MUTED, Label.HorizontalAlign.LEFT);
            group.children.filter(n => n.name.startsWith('Option')).forEach(n => n.active = false);
            const options = this.choices[key], count = Math.min(columns, options.length), optionWidth = (optionsWidth - (count - 1) * 6) / count;
            options.forEach((option, index) => {
                const button = this.child(group, `Option${index}`); button.active = true;
                if (!button.getComponent(Button)) button.addComponent(Button);
                button.off(Button.EventType.CLICK);
                button.on(Button.EventType.CLICK, () => {
                    AudioManager.instance.playClick(); this.draft = { ...this.draft, [key]: option.value }; this.renderPanel(false);
                });
                const bx = -innerWidth / 2 + labelSpace + optionWidth / 2 + (index % columns) * (optionWidth + 6);
                const by = gh / 2 - (stacked ? 26 : 0) - 22 - Math.floor(index / columns) * 50;
                this.place(button, bx, by, optionWidth, 44);
                const caption = index === 0 ? key === 'sort' ? '默认' : '全部'
                    : key === 'sort' ? ({ quality: '品质', level: '等级', name: '名称' }[option.value] || option.label) : option.label;
                this.drawButton(button, caption, optionWidth, this.draft[key] === option.value);
            });
            top += gh + 8;
        }
        const actionWidth = (innerWidth - 12) / 2;
        for (const [name, caption, primary] of [['Reset', '重置', false], ['Apply', '确定', true]] as const) {
            const button = this.panel.getChildByName(name);
            this.place(button, (primary ? 1 : -1) * (actionWidth + 12) / 2, -height / 2 + 28, actionWidth, 44);
            this.drawButton(button, caption, actionWidth, primary);
        }
        this.popup.setSiblingIndex(this.root.children.length - 1);
    }

    private action(name: string, callback: () => void): void {
        const node = this.make(this.panel, name); node.addComponent(Button);
        node.on(Button.EventType.CLICK, () => { AudioManager.instance.playClick(); callback(); });
    }
    private child(parent: Node, name: string): Node { return parent.getChildByName(name) || this.make(parent, name); }
    private make(parent: Node, name: string): Node {
        const node = new Node(name); node.layer = parent.layer; node.addComponent(UITransform); parent.addChild(node); return node;
    }
    private place(node: Node, x: number, y: number, width: number, height: number): void {
        node.setPosition(x, y, 0); node.getComponent(UITransform).setContentSize(width, height);
    }
    private graphics(parent: Node): Graphics {
        let ink = parent.getChildByName('Ink');
        if (!ink) { ink = this.make(parent, 'Ink'); ink.addComponent(Graphics); ink.setSiblingIndex(0); }
        const g = ink.getComponent(Graphics); g.clear(); return g;
    }
    private text(parent: Node, value: string, size: number, color: Color, align = Label.HorizontalAlign.CENTER): Label {
        const node = this.child(parent, 'Text'); if (!node.getComponent(Label)) node.addComponent(Label);
        const ui = parent.getComponent(UITransform); this.place(node, 0, 0, ui.width - 8, ui.height);
        const label = node.getComponent(Label); label.string = value; label.fontSize = size; label.lineHeight = size + 8;
        label.color = color; label.horizontalAlign = align; label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK; label.enableWrapText = false; return label;
    }
    private drawButton(node: Node, caption: string, width: number, selected: boolean): void {
        const g = this.graphics(node);
        g.fillColor = selected ? new Color(103, 81, 47, 255) : new Color(34, 32, 27, 230);
        g.strokeColor = selected ? GOLD : new Color(130, 112, 80, 130); g.lineWidth = 1;
        g.roundRect(-width / 2 + .5, -21.5, width - 1, 43, 3); g.fill(); g.stroke();
        this.text(node, caption, 16, selected ? GOLD : PAPER);
        const button = node.getComponent(Button); button.target = g.node;
        button.transition = Button.Transition.SCALE; button.zoomScale = .97; button.duration = .08;
    }
}
