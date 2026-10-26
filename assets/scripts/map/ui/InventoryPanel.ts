import { _decorator, BlockInputEvents, Button, Color, Component, Label, Mask, Node, SafeArea,
    ScrollView, Sprite, SpriteFrame, UITransform, Widget, resources } from 'cc';
import InventoryCommand from '../../inventory/InventoryCommand';
import { INVENTORY_CATEGORIES, InventoryCategory, InventoryDestination, inventoryAction,
    inventoryCategory, inventoryLayout } from '../../inventory/InventoryPresentation';
import { getItemConfig, itemGlyph, itemIconPath, itemName } from '../../common/ItemPresentation';
import { InventoryItem } from '../../login/LoginProxy';
import { LogicEvent as E } from '../../common/LogicEvent';
import { EventMgr } from '../../utils/EventMgr';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';

const { ccclass } = _decorator;

@ccclass('InventoryPanel')
export default class InventoryPanel extends Component {
    private safe: Node;
    private panel: Node;
    private tabs: Node;
    private detail: Node;
    private viewport: Node;
    private content: Node;
    private scroll: ScrollView;
    private status: Label;
    private empty: Label;
    private retry: Node;
    private selected = 0;
    private category: InventoryCategory = 'all';
    private metrics = inventoryLayout(1280, 720);
    private layingOut = false;
    private queued = false;
    private navigate: (destination: InventoryDestination) => void;

    public show(navigate: (destination: InventoryDestination) => void): void {
        this.navigate = navigate;
        if (!this.panel) this.build();
        this.node.active = true;
        this.node.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment();
        this.safe.getComponent(SafeArea).updateArea();
        this.layout();
        InventoryCommand.getInstance().requestItems();
    }

    private build(): void {
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        this.stretch(this.node); this.node.addComponent(BlockInputEvents);
        this.safe = this.make('SafeContent', this.node, 1, 1);
        this.stretch(this.safe); this.safe.addComponent(SafeArea);
        this.panel = this.make('BagWindow', this.safe, 1000, 650);
        caption(this.panel, 'Title', '背包', 0, 0, 200, 30, C.text);
        this.status = caption(this.panel, 'Status', '', 0, 0, 580, 14, C.muted);
        this.button(this.panel, 'Close', () => this.close());
        this.retry = this.button(this.panel, 'Retry', () => InventoryCommand.getInstance().requestItems());
        this.tabs = this.make('Categories', this.panel, 1, 40);
        this.detail = this.make('Detail', this.panel, 310, 490);
        const scrollNode = this.make('Grid', this.panel, 620, 490);
        this.scroll = scrollNode.addComponent(ScrollView);
        this.scroll.horizontal = false; this.scroll.vertical = true;
        this.scroll.cancelInnerEvents = true; this.scroll.elastic = true;
        this.viewport = this.make('Viewport', scrollNode, 620, 490);
        this.stretch(this.viewport); this.viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.content = this.make('Items', this.viewport, 620, 490);
        this.content.getComponent(UITransform).setAnchorPoint(.5, 1);
        this.scroll.content = this.content;
        this.empty = caption(scrollNode, 'Empty', '', 0, 0, 400, 17, C.muted, Label.HorizontalAlign.CENTER);
        this.node.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        EventMgr.on(E.updateInventory, this.queueRefresh, this);
        EventMgr.on(E.enterLogin, this.close, this);
    }

    private layout(): void {
        if (!this.panel || this.layingOut) return;
        const root = this.node.getComponent(UITransform), safe = this.safe.getComponent(UITransform);
        if (safe.width <= 1 || safe.height <= 1) return;
        this.layingOut = true;
        this.metrics = inventoryLayout(safe.width, safe.height);
        const m = this.metrics, top = m.height / 2, left = -m.width / 2, bodyTop = top - 134;
        inkSurface(this.node, 'Scrim', root.width, root.height, new Color(4, 9, 7, 180), null);
        place(this.panel, 0, 0, m.width, m.height);
        inkSurface(this.panel, 'Surface', m.width, m.height, C.ink, C.gold);
        place(this.panel.getChildByName('Title'), left + 116, top - 38, 192, 42);
        place(this.status.node, 0, top - 70, m.width - 44, 24);
        this.status.overflow = Label.Overflow.SHRINK;
        panelButton(this.panel.getChildByName('Close'), '', m.width / 2 - 38, top - 36, 40, 40, false, true);
        panelButton(this.retry, '重试', m.width / 2 - 114, top - 36, 88, 36);
        place(this.tabs, 0, top - 105, m.width - 40, 40);
        const gridX = m.narrow ? 0 : left + 20 + m.gridWidth / 2;
        place(this.scroll.node, gridX, bodyTop - m.gridHeight / 2, m.gridWidth, m.gridHeight);
        this.viewport.getComponent(Widget).updateAlignment();
        place(this.empty.node, 0, 0, m.gridWidth - 24, 60);
        this.empty.enableWrapText = true;
        place(this.detail, m.narrow ? 0 : m.width / 2 - 20 - m.detailWidth / 2,
            m.narrow ? -top + 20 + m.detailHeight / 2 : bodyTop - m.bodyHeight / 2, m.detailWidth, m.detailHeight);
        this.render();
        this.panel.setScale(m.scale, m.scale, 1);
        this.layingOut = false;
    }

    private queueRefresh(): void {
        if (!this.node.activeInHierarchy || this.queued) return;
        this.queued = true;
        this.scheduleOnce(() => { this.queued = false; if (this.isValid && this.node.activeInHierarchy) this.render(); }, 0);
    }

    private render(resetScroll = false): void {
        if (!this.panel) return;
        const cmd = InventoryCommand.getInstance(), all = cmd.items, m = this.metrics;
        this.status.string = !cmd.sessionReady ? '连接已断开，等待重新连接' : cmd.loadError
            || (cmd.loading ? '正在同步背包…' : `持有 ${all.length} 种物品`);
        this.retry.active = !!cmd.loadError && cmd.sessionReady && !cmd.loading;
        this.clear(this.tabs);
        const tw = (m.width - 40 - 18) / 4;
        INVENTORY_CATEGORIES.forEach(([key, name], i) => {
            const node = this.button(this.tabs, key, () => {
                if (this.category === key) return;
                this.category = key; this.render(true);
            });
            panelButton(node, name, (i - 1.5) * (tw + 6), 0, tw, 38, key === this.category);
        });
        const rows = all.filter(row => this.category === 'all' || inventoryCategory(row.itemId) === this.category);
        if (!rows.some(row => row.itemId === this.selected)) this.selected = rows[0]?.itemId || 0;
        const offset = resetScroll ? 0 : this.scroll.getScrollOffset().y;
        this.scroll.stopAutoScroll(); this.clear(this.content);
        const cellW = (m.gridWidth - (m.columns - 1) * 8) / m.columns, cellH = 132;
        rows.forEach((row, index) => {
            const cell = this.button(this.content, `Item_${row.itemId}`, () => {
                this.selected = row.itemId; this.render();
            });
            place(cell, -m.gridWidth / 2 + cellW / 2 + (index % m.columns) * (cellW + 8),
                -cellH / 2 - Math.floor(index / m.columns) * (cellH + 8), cellW, cellH);
            inkSurface(cell, 'Card', cellW, cellH, row.itemId === this.selected ? new Color(67, 60, 40) : C.panel,
                row.itemId === this.selected ? C.gold : C.line);
            this.art(cell, row.itemId, 0, 18, 64);
            const name = caption(cell, 'Name', itemName(row.itemId), 0, -29, cellW - 12, 14, C.text, Label.HorizontalAlign.CENTER);
            name.overflow = Label.Overflow.SHRINK;
            const count = caption(cell, 'Count', '×' + row.count.toLocaleString(), 0, -51, cellW - 12, 15, C.gold, Label.HorizontalAlign.CENTER);
            count.overflow = Label.Overflow.SHRINK;
        });
        const height = Math.max(m.gridHeight, Math.ceil(rows.length / m.columns) * 140 - 8);
        this.content.getComponent(UITransform).setContentSize(m.gridWidth, height);
        this.content.setPosition(0, m.gridHeight / 2 + Math.min(Math.max(0, offset), height - m.gridHeight), 0);
        this.empty.node.active = !rows.length;
        this.empty.string = cmd.loading ? '正在整理行囊…' : !cmd.loaded ? (cmd.loadError || '等待背包数据…')
            : this.category === 'all' ? '背包中暂无物品' : '这个分类暂无物品';
        this.renderDetail(rows.find(row => row.itemId === this.selected));
    }

    private renderDetail(row?: InventoryItem): void {
        this.clear(this.detail);
        const m = this.metrics, w = m.detailWidth, h = m.detailHeight, top = h / 2;
        inkSurface(this.detail, 'Surface', w, h, C.inset, C.line);
        if (!row) {
            caption(this.detail, 'EmptyDetail', '选择物品查看详情', 0, 0, w - 24, 16, C.muted, Label.HorizontalAlign.CENTER);
            return;
        }
        const cfg = getItemConfig(row.itemId), compact = m.narrow || h < 400;
        const name = itemName(row.itemId), category = INVENTORY_CATEGORIES.find(([key]) => key === inventoryCategory(row.itemId))?.[1] || '道具';
        this.art(this.detail, row.itemId, compact ? -w / 2 + 48 : 0, compact ? top - 44 : top - 113, compact ? 62 : 128);
        const title = caption(this.detail, 'ItemName', name, compact ? 34 : 0, compact ? top - 30 : top - 206,
            compact ? w - 118 : w - 28, compact ? 20 : 24, C.text, compact ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER);
        title.overflow = Label.Overflow.SHRINK;
        const quantity = caption(this.detail, 'Quantity', '持有 ' + row.count.toLocaleString(), compact ? 34 : 0,
            compact ? top - 58 : top - 240, compact ? w - 118 : w - 32, 16, C.gold,
            compact ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER);
        quantity.overflow = Label.Overflow.SHRINK;
        if (!compact) caption(this.detail, 'Category', category, 0, top - 28, w - 32, 14, C.muted, Label.HorizontalAlign.CENTER);
        const description = caption(this.detail, 'Description', cfg?.Desc || '尚无该物品的说明', 0,
            compact ? top - 105 : top - 296, w - 32, compact ? 13 : 16, C.muted);
        description.enableWrapText = true;
        description.node.getComponent(UITransform).height = compact ? 46 : 72;
        description.overflow = Label.Overflow.SHRINK;
        const action = inventoryAction(row.itemId), cmd = InventoryCommand.getInstance();
        const button = this.button(this.detail, 'Action', () => {
            if (!action.destination || !InventoryCommand.getInstance().sessionReady) return;
            this.close(); this.navigate?.(action.destination);
        });
        panelButton(button, action.label, 0, -top + 32, Math.min(w - 32, 240), 42, !!action.destination);
        button.getComponent(Button).interactable = !!action.destination && cmd.sessionReady;
        if (!action.destination) button.getComponentInChildren(Label).color = C.muted;
    }

    private art(parent: Node, itemId: number, x: number, y: number, size: number): void {
        const fallback = caption(parent, 'Glyph', itemGlyph(itemId), x, y, size, Math.min(32, size / 2), C.gold, Label.HorizontalAlign.CENTER);
        const node = this.make('Icon', parent, size, size); node.setPosition(x, y, 0);
        const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const path = itemIconPath(itemId); if (!path) return;
        resources.load(path, SpriteFrame, (error, frame) => {
            if (error || !(frame instanceof SpriteFrame) || !sprite.isValid) return;
            sprite.spriteFrame = frame;
            const fit = Math.min(size / frame.originalSize.width, size / frame.originalSize.height);
            node.getComponent(UITransform).setContentSize(frame.originalSize.width * fit, frame.originalSize.height * fit);
            if (fallback.isValid) fallback.node.active = false;
        });
    }
    private make(name: string, parent: Node, w: number, h: number): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform).setContentSize(w, h); return node;
    }
    private button(parent: Node, name: string, action: () => void): Node {
        const node = this.make(name, parent, 100, 44), button = node.addComponent(Button);
        node.on(Button.EventType.CLICK, () => { if (button.interactable) action(); }, this);
        return node;
    }
    private clear(node: Node): void { for (const child of node.children.slice()) { child.removeFromParent(); child.destroy(); } }
    private stretch(node: Node): void {
        const w = node.addComponent(Widget);
        w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
        w.top = w.bottom = w.left = w.right = 0; w.alignMode = Widget.AlignMode.ALWAYS;
    }
    private close(): void { this.node.active = false; }
    protected onDisable(): void { this.unscheduleAllCallbacks(); this.queued = false; }
    protected onDestroy(): void { EventMgr.targetOff(this); }
}
