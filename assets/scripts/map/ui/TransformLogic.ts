import { _decorator, BlockInputEvents, Button, Color, Component, EditBox, Label,
    Layout, Node, SafeArea, Slider, Sprite, UITransform, Widget } from 'cc';
import { AudioManager } from '../../common/AudioManager';
import InventoryIconCache from '../../inventory/InventoryIconCache';
import { caption, headerRule, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';

const { ccclass, property } = _decorator;
const RESOURCES = [
    { id: 1, name: '粮食', glyph: '粮', note: '军中之本，征战之需' },
    { id: 2, name: '木材', glyph: '木', note: '营建根基，百工之材' },
    { id: 3, name: '铁矿', glyph: '铁', note: '淬炼兵甲，整备军容' },
    { id: 4, name: '石料', glyph: '石', note: '筑城固垒，安守一方' },
];

/** 市场外观预览：只保存本地选择，不读取旧兑换规则，也不提交交易。 */
@ccclass('TransformLogic')
export default class TransformLogic extends Component {
    // 保留旧 prefab 的序列化引用；旧视图整体隐藏，入口和资源引用无需迁移。
    @property(Layout) fromLayout: Layout = null;
    @property(Layout) toLayout: Layout = null;
    @property(Node) trNode: Node = null;
    @property(Label) trLabel: Label = null;
    @property(Label) rateLabel: Label = null;
    @property(Slider) trSlider: Slider = null;

    private safe: Node;
    private panel: Node;
    private fromCard: Node;
    private toCard: Node;
    private quantity: EditBox;
    private fromId = 1;
    private toId = 2;
    private amount = 1000;
    private compact = false;
    private cardWidth = 412;
    private cardHeight = 292;
    private layingOut = false;

    protected onEnable(): void { this.initView(); }

    public initView(): void {
        if (!this.panel) this.build();
        this.node.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment();
        this.safe.getComponent(SafeArea).updateArea();
        this.layout();
    }

    private build(): void {
        // 旧 Modal 会在重开时重新显示整张城楼背景；由新遮罩统一阻挡地图输入。
        const legacyModal = this.node.getComponent('Modal');
        if (legacyModal) legacyModal.enabled = false;
        for (const child of this.node.children) child.active = false;
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        this.stretch(this.node);
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        this.safe = this.make('MarketSafeArea', this.node);
        this.stretch(this.safe); this.safe.addComponent(SafeArea);
        this.panel = this.make('MarketWindow', this.safe);
        this.button(this.panel, 'Close', () => this.onClickClose());
        const seal = this.make('Seal', this.panel);
        inkSurface(seal, 'SealSurface', 44, 44, new Color(88, 49, 37), new Color(158, 119, 75));
        caption(seal, 'Glyph', '市', 0, 0, 40, 27, C.gold, Label.HorizontalAlign.CENTER);
        this.fromCard = this.buildCard('Offer', false);
        this.toCard = this.buildCard('Receive', true);
        this.button(this.panel, 'Swap', () => {
            const id = this.fromId; this.fromId = this.toId; this.toId = id; this.render();
        });
        const submit = this.make('ExchangeUnavailable', this.panel);
        submit.addComponent(Button).interactable = false;
        this.node.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        for (const resource of RESOURCES) {
            if (InventoryIconCache.get(resource.id)) continue;
            InventoryIconCache.load(resource.id).then(() => {
                if (this.isValid && this.node.activeInHierarchy && this.panel?.isValid) this.render();
            });
        }
    }

    private buildCard(name: string, receiving: boolean): Node {
        const card = this.make(name, this.panel);
        const hero = this.make('ResourceArt', card);
        hero.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
        const options = this.make('ResourceChoices', card);
        for (const res of RESOURCES) {
            const option = this.button(options, 'Resource_' + res.id, () => this.selectResource(receiving, res.id));
            this.make('Icon', option).addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
        }
        const amount = this.make('Amount', card);
        if (!receiving) {
            const stepper = this.make('Stepper', amount);
            this.button(stepper, 'Minus', () => this.setAmount(this.amount - 100));
            this.button(stepper, 'Plus', () => this.setAmount(this.amount + 100));
            const input = this.make('QuantityInput', stepper);
            this.quantity = input.addComponent(EditBox);
            this.quantity.inputMode = EditBox.InputMode.NUMERIC;
            this.quantity.inputFlag = EditBox.InputFlag.DEFAULT;
            this.quantity.returnType = EditBox.KeyboardReturnType.DONE;
            this.quantity.maxLength = 9;
            // 复用 EditBox 自动创建的标签，其内部布局以左上角为锚点。
            this.quantity.textLabel = caption(input, 'TEXT_LABEL', '', 0, 0, 108, 21, C.text, Label.HorizontalAlign.CENTER);
            this.quantity.placeholderLabel = caption(input, 'PLACEHOLDER_LABEL', '0', 0, 0, 108, 21, C.muted, Label.HorizontalAlign.CENTER);
            this.quantity.textLabel.node.getComponent(UITransform).setAnchorPoint(0, 1);
            this.quantity.placeholderLabel.node.getComponent(UITransform).setAnchorPoint(0, 1);
            this.quantity.placeholder = '0';
            input.on(EditBox.EventType.EDITING_DID_ENDED, () => this.setAmount(this.quantity.string), this);
        }
        return card;
    }

    private layout(): void {
        if (!this.panel || this.layingOut) return;
        const root = this.node.getComponent(UITransform), safe = this.safe.getComponent(UITransform);
        if (safe.width < 2 || safe.height < 2) return;
        this.layingOut = true;
        this.compact = safe.width < 720;
        const w = Math.min(this.compact ? 430 : 936, safe.width - 24);
        const h = this.compact ? 744 : 552;
        const scale = Math.min(1, (safe.height - 24) / h);
        const top = h / 2, left = -w / 2;
        inkSurface(this.node, 'MarketScrim', root.width, root.height, new Color(6, 12, 10, 205), null);
        place(this.panel, 0, 0, w, h);
        inkSurface(this.panel, 'Surface', w, h, new Color(29, 34, 29, 255), new Color(156, 132, 88));
        const trim = inkSurface(this.panel, 'CornerTrim', w - 12, h - 12, null, null);
        trim.lineWidth = 2; trim.strokeColor = new Color(197, 166, 108, 150);
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            const x = sx * (w / 2 - 7), y = sy * (h / 2 - 7);
            trim.moveTo(x - sx * 20, y); trim.lineTo(x, y); trim.lineTo(x, y - sy * 20);
        }
        trim.stroke();
        place(this.panel.getChildByName('Seal'), left + 46, top - 44, 44, 44);
        caption(this.panel, 'Title', '市场', left + 126, top - 34, 100, 28, C.text);
        caption(this.panel, 'Subtitle', '通商易物 · 调度军需', left + 178, top - 61, 204, 13, C.muted);
        panelButton(this.panel.getChildByName('Close'), '', w / 2 - 35, top - 35, 38, 38, false, true);
        headerRule(this.panel, w - 48, top - 86);
        this.cardWidth = this.compact ? w - 32 : (w - 112) / 2;
        this.cardHeight = this.compact ? 240 : 292;
        const cy = top - 104 - this.cardHeight / 2;
        place(this.fromCard, this.compact ? 0 : -this.cardWidth / 2 - 32, cy, this.cardWidth, this.cardHeight);
        place(this.toCard, this.compact ? 0 : this.cardWidth / 2 + 32,
            this.compact ? cy - this.cardHeight - 36 : cy, this.cardWidth, this.cardHeight);
        const swap = this.panel.getChildByName('Swap');
        panelButton(swap, '', 0, this.compact ? cy - this.cardHeight / 2 - 18 : cy + 8, 38, 38);
        const arrows = inkSurface(swap, 'Arrows', 36, 36, null, null);
        arrows.node.setSiblingIndex(swap.children.length - 1);
        arrows.strokeColor = C.gold; arrows.lineWidth = 1.6;
        arrows.moveTo(-9, 5); arrows.lineTo(9, 5); arrows.lineTo(4, 10);
        arrows.moveTo(9, -5); arrows.lineTo(-9, -5); arrows.lineTo(-4, -10); arrows.stroke();
        const rule = inkSurface(this.panel, 'FooterRule', w - 48, 1, new Color(153, 134, 91, 85), null);
        rule.node.setPosition(0, -top + 120);
        caption(this.panel, 'Rate', '兑换比例  —', left + 104, -top + 96, 160, 13, C.muted);
        caption(this.panel, 'NoticeTitle', '市集筹备中', left + 116, -top + 65, 184, 17, C.gold);
        caption(this.panel, 'Notice', '开市后可调配粮、木、铁、石', left + 154, -top + 39, 260, 13, C.muted);
        const submit = this.panel.getChildByName('ExchangeUnavailable');
        if (this.compact) {
            place(this.panel.getChildByName('NoticeTitle'), left + 104, -top + 66, 160, 30);
            place(this.panel.getChildByName('Notice'), 0, -top + 30, w - 48, 26);
            panelButton(submit, '暂未开放', w / 2 - 82, -top + 69, 120, 38);
        } else panelButton(submit, '暂未开放', w / 2 - 126, -top + 55, 200, 44);
        submit.getComponentInChildren(Label).color = C.muted;
        this.render();
        this.panel.getChildByName('Surface').setSiblingIndex(0);
        this.panel.setScale(scale, scale, 1);
        this.layingOut = false;
    }

    private render(): void {
        if (!this.panel) return;
        this.renderCard(this.fromCard, false);
        this.renderCard(this.toCard, true);
        this.quantity.string = String(this.amount);
        const minus = this.fromCard.getChildByPath('Amount/Stepper/Minus').getComponent(Button);
        minus.interactable = this.amount > 0;
    }

    private renderCard(card: Node, receiving: boolean): void {
        const w = this.cardWidth, h = this.cardHeight, top = h / 2;
        const id = receiving ? this.toId : this.fromId;
        const resource = RESOURCES.find(row => row.id === id) || RESOURCES[0];
        inkSurface(card, 'Surface', w, h, new Color(39, 44, 36, 255), new Color(118, 111, 84, 95));
        caption(card, 'Heading', receiving ? '获得资源' : '付出资源', 0, top - 24, w - 32, 13, C.muted);
        const heroY = this.compact ? 48 : 54, artSize = this.compact ? 76 : 104;
        this.art(card.getChildByName('ResourceArt'), id, -w * .23, heroY, artSize);
        caption(card, 'ResourceName', resource.name, w * .17, heroY + 14, w * .49, this.compact ? 23 : 26, C.text);
        caption(card, 'Description', resource.note, w * .17, heroY - 17, w * .49, this.compact ? 11 : 13, C.muted);
        const choices = card.getChildByName('ResourceChoices'), cw = (w - 50) / 4;
        place(choices, 0, this.compact ? -23 : -41, w - 32, 60);
        RESOURCES.forEach((res, i) => {
            const node = choices.getChildByName('Resource_' + res.id), selected = id === res.id;
            place(node, (i - 1.5) * (cw + 6), 0, cw, 60);
            inkSurface(node, 'Surface', cw, 60, selected ? new Color(80, 69, 43) : new Color(29, 34, 28),
                selected ? C.gold : new Color(130, 120, 87, 72));
            const button = node.getComponent(Button);
            button.transition = Button.Transition.SCALE; button.zoomScale = .97; button.duration = .08;
            this.art(node.getChildByName('Icon'), res.id, 0, 8, 33);
            caption(node, 'Name', res.name, 0, -18, cw - 4, 12, selected ? C.text : C.muted, Label.HorizontalAlign.CENTER);
            const mark = inkSurface(node, 'SelectedMark', 12, 2, selected ? C.gold : null, null);
            mark.node.setPosition(0, -29);
            mark.node.setSiblingIndex(node.children.length - 1);
        });
        const amount = card.getChildByName('Amount'), rw = w - 32;
        place(amount, 0, -top + 29, rw, 42);
        inkSurface(amount, 'Surface', rw, 42, new Color(24, 29, 24), new Color(118, 111, 84, 80));
        if (receiving) {
            caption(amount, 'Label', '预计获得', -rw / 2 + 56, 0, 88, 13, C.muted);
            caption(amount, 'Value', '—', rw / 2 - 42, 0, 52, 24, C.gold, Label.HorizontalAlign.RIGHT);
        } else {
            caption(amount, 'Label', '数量', -rw / 2 + 34, 0, 44, 13, C.muted);
            const stepper = amount.getChildByName('Stepper');
            place(stepper, rw / 2 - 98, 0, 188, 40);
            panelButton(stepper.getChildByName('Minus'), '−', -76, 0, 32, 34);
            panelButton(stepper.getChildByName('Plus'), '+', 76, 0, 32, 34);
            place(this.quantity.node, 0, 0, 112, 38);
        }
    }

    private art(node: Node, id: number, x: number, y: number, size: number): void {
        place(node, x, y, size, size);
        const frame = InventoryIconCache.get(id), sprite = node.getComponent(Sprite);
        sprite.enabled = !!frame;
        if (frame) {
            sprite.spriteFrame = frame; sprite.trim = false;
            const glyph = node.getChildByName('Fallback');
            if (glyph) glyph.active = false;
        } else {
            caption(node, 'Fallback', RESOURCES.find(row => row.id === id)?.glyph || '', 0, 0, size,
                Math.min(28, size * .6), C.gold, Label.HorizontalAlign.CENTER);
        }
    }

    private selectResource(receiving: boolean, id: number): void {
        if (receiving) {
            if (id === this.toId) return;
            if (id === this.fromId) this.fromId = this.toId;
            this.toId = id;
        } else {
            if (id === this.fromId) return;
            if (id === this.toId) this.toId = this.fromId;
            this.fromId = id;
        }
        this.render();
    }

    private setAmount(value: number | string): void {
        const parsed = Number(String(value).trim());
        this.amount = Number.isFinite(parsed) ? Math.min(999999999, Math.max(0, Math.floor(parsed))) : 0;
        this.quantity.string = String(this.amount);
        const minus = this.fromCard.getChildByPath('Amount/Stepper/Minus').getComponent(Button);
        minus.interactable = this.amount > 0;
    }

    private make(name: string, parent: Node): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform); return node;
    }

    private button(parent: Node, name: string, action: () => void): Node {
        const node = this.make(name, parent), button = node.addComponent(Button);
        node.on(Button.EventType.CLICK, () => { if (button.interactable) action(); }, this);
        return node;
    }

    private stretch(node: Node): void {
        const widget = node.getComponent(Widget) || node.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ALWAYS;
    }

    protected onClickClose(): void {
        this.node.active = false;
        AudioManager.instance.playClick();
    }

    // 旧 prefab 仍序列化了此回调；休市期间即使被调用，也不能发送兑换请求。
    protected onTransForm(): void { }
}
