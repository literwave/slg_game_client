
import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node, SafeArea,
    Sprite, SpriteFrame, UIOpacity, UITransform, Widget, resources } from 'cc';
import GeneralCommand from '../../general/GeneralCommand';
import LotteryCommand from '../../general/LotteryCommand';
import LoginCommand from '../../login/LoginCommand';
import { EventMgr } from '../../utils/EventMgr';
import Modal from '../../utils/Modal';
import { LogicEvent } from '../../common/LogicEvent';
import { itemName } from '../../common/ItemPresentation';
import LotterySkipControl from '../../reward/LotterySkipControl';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';

const { ccclass, property } = _decorator;
const GOLD = new Color(222, 185, 115);
interface HeroDisplay { node: Node; image: Sprite; title: Label; stars: Label; id: number; }

/** 沿用 Draw 预制体入口；客户端只播放演出，点将及奖励由服务器决定。 */
@ccclass('DrawLogic')
export default class DrawLogic extends Component {
    @property(Label) labelOnce: Label = null;
    @property(Label) labelTen: Label = null;
    @property(Label) cntLab: Label = null;
    private safe: Node;
    private panel: Node;
    private backdrop: Graphics;
    private ornaments: Graphics;
    private title: Label;
    private subtitle: Label;
    private balance: Label;
    private countLabel: Label;
    private hint: Label;
    private art: Node;
    private glow: Sprite;
    private displays: HeroDisplay[] = [];
    private actions: Array<{ node: Node; cost: Label; count: number }> = [];
    private close: Node;
    private retry: Node;
    private skip: LotterySkipControl;
    private layingOut = false;

    protected onLoad(): void {
        // 旧 Modal 会在每次打开时重新启用带招募背景的 mask。
        // 新弹窗已有独立遮罩和输入阻挡，不再启用旧背景。
        const legacyModal = this.node.getComponent(Modal);
        if (legacyModal) legacyModal.enabled = false;
        this.node.children.forEach(child => child.active = false);
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        this.stretch(this.node);
        this.backdrop = this.makeNode('DimmedMap', this.node).addComponent(Graphics);
        this.safe = this.makeNode('SafeContent', this.node);
        this.stretch(this.safe);
        this.safe.addComponent(SafeArea);
        this.panel = this.makeNode('DianJiangWindow', this.safe);
        this.panel.addComponent(BlockInputEvents);
        this.ornaments = this.makeNode('StageLines', this.panel).addComponent(Graphics);
        this.title = caption(this.panel, 'Title', '点将', 0, 0, 230, 32);
        this.subtitle = caption(this.panel, 'Subtitle', '列阵点将 · 群英应召', 0, 0, 330, 14, C.muted);
        this.balance = caption(this.panel, 'TicketBalance', '', 0, 0, 260, 15, GOLD, Label.HorizontalAlign.RIGHT);
        this.countLabel = caption(this.panel, 'TotalCount', '', 0, 0, 320, 13, C.muted, Label.HorizontalAlign.CENTER);
        this.hint = caption(this.panel, 'Hint', '', 0, 0, 620, 14, C.muted, Label.HorizontalAlign.CENTER);
        this.hint.enableWrapText = true;
        this.close = this.button('Close', this.panel, () => this.onClickClose());
        this.art = this.makeNode('HeroStage', this.panel);
        this.glow = this.makeSprite('StageGlow', this.art);
        this.loadFrame(this.glow, 'ui/system_unlock/glow_gold/spriteFrame');
        this.glow.color = new Color(232, 185, 109, 100);
        this.buildHeroCards();
        for (const count of [1, 10]) {
            const node = this.button('Draw_' + count, this.panel, () => this.draw(count));
            const cost = caption(this.panel, 'Cost_' + count, '', 0, 0, 270, 14, C.muted, Label.HorizontalAlign.CENTER);
            this.actions.push({ node, cost, count });
        }
        this.retry = this.button('RetryInfo', this.panel, () => LotteryCommand.getInstance().requestInfo());
        this.skip = new LotterySkipControl(this.panel);
        this.node.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.layout();
    }

    protected onEnable(): void {
        EventMgr.on(LogicEvent.lotteryChanged, this.refresh, this);
        EventMgr.on(LogicEvent.upateMyRoleRes, this.refresh, this);
        this.safe?.getComponent(SafeArea)?.updateArea();
        this.layout();
        LotteryCommand.getInstance().requestInfo();
        this.refresh();
    }
    protected onDisable(): void { EventMgr.targetOff(this); }
    protected onDestroy(): void {
        this.skip?.dispose(); EventMgr.targetOff(this);
    }

    private buildHeroCards(): void {
        const choices = Array.from(GeneralCommand.getInstance().proxy.getGeneralAllCfg().values())
            .sort((a, b) => (b.star - a.star) || a.sort - b.sort).slice(0, 3);
        for (const index of [1, 2, 0]) {
            const cfg = choices[index];
            if (!cfg) continue;
            const node = this.makeNode('FeaturedHero_' + index, this.art);
            node.addComponent(UIOpacity).opacity = index === 0 ? 255 : 175;
            const image = this.makeSprite('Portrait', node);
            const title = caption(node, 'HeroName', cfg.name, 0, 0, 180, 21, C.text, Label.HorizontalAlign.CENTER);
            const stars = caption(node, 'Stars', '★'.repeat(Math.max(1, Math.min(5, cfg.star))), 0, 0, 160, 12, GOLD, Label.HorizontalAlign.CENTER);
            this.displays.push({ node, image, title, stars, id: index });
            GeneralCommand.getInstance().proxy.loadGeneralTex(cfg.id).then(frame => {
                if (!image.isValid || !frame) return;
                image.spriteFrame = frame; this.layout();
            });
        }
    }

    private layout(): void {
        if (!this.panel || this.layingOut) return;
        this.layingOut = true;
        const root = this.node.getComponent(UITransform), safe = this.safe.getComponent(UITransform);
        const w = Math.min(1000, Math.max(280, (safe.width || root.width) - 32));
        const h = Math.min(650, Math.max(280, (safe.height || root.height) - 32)), top = h / 2, bottom = -h / 2;
        const compact = h < 500;
        place(this.panel, 0, 0, w, h);
        this.backdrop.clear(); this.backdrop.fillColor = new Color(6, 10, 10, 180);
        this.backdrop.rect(-root.width / 2, -root.height / 2, root.width, root.height); this.backdrop.fill();
        inkSurface(this.panel, 'WindowSurface', w, h, new Color(24, 29, 27), C.line);
        this.title.node.setPosition(-w / 2 + 140, top - 43);
        place(this.subtitle.node, 0, top - 78, w - 52, 26);
        place(this.balance.node, w / 2 - 200, top - 43, Math.min(250, w / 2), 30);
        this.balance.node.active = w > 550;
        panelButton(this.close, '', w / 2 - 35, top - 35, 44, 44, false, true);
        const artTop = top - 112, artBottom = bottom + (compact ? 134 : 170);
        const cardHeight = Math.min(320, Math.max(60, artTop - artBottom - 12)), cardWidth = cardHeight * .69;
        const artY = (artTop + artBottom) / 2;
        place(this.art, 0, artY, w - 36, cardHeight + 30);
        place(this.glow.node, 0, -10, Math.min(w - 60, 600), Math.min(h, 500));
        for (const d of this.displays) {
            const center = d.id === 0, scale = center ? 1 : .82, side = d.id === 1 ? -1 : 1;
            const cw = cardWidth * scale, ch = cardHeight * scale;
            place(d.node, center ? 0 : side * Math.min(w * .24, cardWidth * .95), center ? 5 : 0, cw, ch);
            d.node.angle = center ? 0 : side * -7;
            inkSurface(d.node, 'CardFrame', cw + 12, ch + 12, new Color(53, 47, 35), center ? GOLD : C.line);
            place(d.image.node, 0, 18, cw, ch - 36);
            const size = d.image.spriteFrame?.originalSize;
            if (size) { const fit = Math.min(cw / size.width, (ch - 36) / size.height); d.image.node.getComponent(UITransform).setContentSize(size.width * fit, size.height * fit); }
            place(d.title.node, 0, -ch / 2 + 26, cw, 28);
            place(d.stars.node, 0, -ch / 2 + 6, cw, 20);
            d.title.fontSize = compact ? 14 : 21;
            d.stars.fontSize = compact ? 9 : 12;
        }
        const bw = Math.min(240, (w - 80) / 2);
        for (let i = 0; i < this.actions.length; i++) {
            const a = this.actions[i], x = (i - .5) * (bw + 16);
            panelButton(a.node, i === 0 ? '点将一次' : '点将十次', x, bottom + (compact ? 71 : 96), bw, compact ? 42 : 52, i === 1);
            place(a.cost.node, x, bottom + (compact ? 36 : 55), bw + 10, 24);
        }
        const preferenceY = bottom + (compact ? 113 : 151);
        place(this.countLabel.node, -w * .21, preferenceY, w * .42, 26);
        this.countLabel.overflow = Label.Overflow.SHRINK;
        place(this.skip.node, w * .24, preferenceY, 164, 40);
        place(this.hint.node, 0, bottom + (compact ? 15 : 24), w - 42, compact ? 22 : 32);
        this.hint.fontSize = compact ? 11 : 14;
        panelButton(this.retry, '重新连接', 0, bottom + (compact ? 113 : 150), 140, 32);
        const g = this.ornaments;
        g.clear(); g.strokeColor = C.line; g.lineWidth = 1;
        g.moveTo(-w / 2 + 26, top - 98); g.lineTo(w / 2 - 26, top - 98); g.stroke();
        g.strokeColor = new Color(197, 166, 108, 45);
        g.ellipse(0, artY - cardHeight / 2 + 6, Math.min(w * .37, 330), compact ? 12 : 32); g.stroke();
        g.ellipse(0, artY - cardHeight / 2 + 6, Math.min(w * .32, 290), compact ? 8 : 24); g.stroke();
        this.layingOut = false;
    }

    private refresh(): void {
        if (!this.panel) return;
        const cmd = LotteryCommand.getInstance(), bag = LoginCommand.getInstance().proxy, options = cmd.options;
        const firstCost = options[0]?.costs[0];
        this.balance.string = firstCost ? itemName(firstCost.itemId) + '  ' + bag.getItemCount(firstCost.itemId).toLocaleString() : '';
        this.countLabel.string = cmd.loaded ? '累计点将 ' + cmd.lotteryTimes + ' 次' : '正在读取点将信息…';
        this.close.getComponent(Button).interactable = true;
        for (const a of this.actions) {
            const option = options.find(o => o.count === a.count);
            const enough = !!option && option.costs.every(c => bag.getItemCount(c.itemId) >= c.count);
            const enabled = enough && cmd.canDraw;
            a.node.getComponent(Button).interactable = enabled;
            a.node.getComponent(UIOpacity).opacity = enabled ? 255 : 115;
            a.cost.string = option ? option.costs.map(c => itemName(c.itemId) + ' ' + c.count + ' / ' + bag.getItemCount(c.itemId)).join(' · ') : '点将配置暂不可用';
            a.cost.color = enough ? C.muted : new Color(221, 156, 128);
        }
        this.countLabel.node.active = true;
        this.retry.active = !cmd.loaded && !cmd.loading && !cmd.pending;
        if (this.retry.active) this.countLabel.node.active = false;
        this.hint.string = cmd.error || (cmd.pending ? '点将令已发出，正在等候结果…' : '消耗点将符，可获武将、武将碎片及军资');
    }
    private draw(count: number): void {
        // 演出只由真实奖励触发，发请求时保持当前弹窗和等待提示。
        LotteryCommand.getInstance().draw(count);
        this.refresh();
    }
    protected onClickClose(): void { this.node.active = false; }
    private button(name: string, parent: Node, action: () => void): Node {
        const node = this.makeNode(name, parent); node.addComponent(Button); node.addComponent(UIOpacity);
        node.on(Button.EventType.CLICK, action, this); return node;
    }
    private makeNode(name: string, parent: Node): Node {
        const node = new Node(name); node.layer = parent.layer;
        node.addComponent(UITransform); parent.addChild(node); return node;
    }
    private makeSprite(name: string, parent: Node): Sprite {
        const sprite = this.makeNode(name, parent).addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM; return sprite;
    }
    private loadFrame(sprite: Sprite, path: string): void {
        resources.load(path, SpriteFrame, (error, frame) => { if (!error && sprite.isValid) sprite.spriteFrame = frame; });
    }
    private stretch(node: Node): void {
        const widget = node.getComponent(Widget) || node.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE; widget.updateAlignment();
    }
}
