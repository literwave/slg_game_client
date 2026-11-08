import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node,
    sys, UIOpacity, UITransform, view } from 'cc';
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from './LogicEvent';

const { ccclass, property } = _decorator;
export interface ReconnectState { attempt?: number; maxAttempts?: number; retryDelayMs?: number; }
type Phase = 'connecting' | 'success' | 'failed';
const GOLD = new Color(217, 181, 112, 255);
const LIGHT = new Color(246, 220, 161, 255);
const INK = new Color(22, 28, 25, 245);

/** 断网时也能立即绘制的烽火徽记，不依赖远程图集。 */
@ccclass('ReconnectLogic')
export default class ReconnectLogic extends Component {
    @property public blockInput = true;
    private built = false;
    private phase: Phase = 'connecting';
    private mask: Node = null;
    private visual: Node = null;
    private emblem: Node = null;
    private tower: Graphics = null;
    private motion: Graphics = null;
    private sparks: Graphics = null;
    private status: Label = null;
    private retryButton: Node = null;
    private opacity: UIOpacity = null;
    private elapsed = 0;
    private intro = 0;
    private lastTick = 0;
    private returning = false;

    protected onLoad(): void {
        this.ensureBuilt();
        view.on('canvas-resize', this.layout, this);
        this.node.parent?.on(Node.EventType.SIZE_CHANGED, this.layout, this);
    }
    protected onDisable(): void { this.lastTick = 0; }
    protected onDestroy(): void {
        view.off('canvas-resize', this.layout, this);
        this.node.parent?.off(Node.EventType.SIZE_CHANGED, this.layout, this);
    }
    public showReconnecting(_state: ReconnectState = {}): void {
        const continuing = this.built && this.node.active && this.phase === 'connecting';
        this.ensureBuilt(); this.node.active = true;
        this.phase = 'connecting'; this.returning = false;
        if (!continuing) { this.elapsed = 0; this.intro = 0; }
        this.lastTick = this.now();
        this.status.string = '重连中'; this.status.color = LIGHT;
        this.retryButton.active = false; this.tower.node.active = true;
        this.layout(); this.paint();
    }
    public showSuccess(): void {
        if (!this.built || !this.node.active) return;
        this.phase = 'success'; this.elapsed = 0; this.intro = 1; this.lastTick = this.now();
        this.status.string = '已连接'; this.status.color = LIGHT;
        this.retryButton.active = this.tower.node.active = false;
        this.paint();
    }
    /** 保留失败态入口；网络层仍由 Main 统一决定何时回登录。 */
    public showFailed(): void {
        this.ensureBuilt(); this.node.active = true;
        this.phase = 'failed'; this.elapsed = 0; this.intro = 0; this.lastTick = this.now(); this.returning = false;
        this.status.string = '连接中断'; this.status.color = new Color(222, 176, 139, 255);
        this.retryButton.active = true; this.retryButton.getComponent(Button).interactable = true;
        this.tower.node.active = false;
        this.layout(); this.paint();
    }
    public hideNow(): void {
        this.returning = false; this.lastTick = 0;
        if (this.opacity) this.opacity.opacity = 0;
        this.node.active = false;
    }
    private now(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
    protected update(): void {
        if (!this.built || !this.node.activeInHierarchy) return;
        const now = this.now(), dt = this.lastTick ? Math.max(0, (now - this.lastTick) / 1000) : 0;
        this.lastTick = now; this.elapsed += dt; this.intro = Math.min(1, this.intro + dt / .18);
        // 使用 UI 实时时钟，游戏速度为零时仍可恢复；没有跨状态遗留的淡出回调。
        if (this.phase === 'success' && this.elapsed >= .62) { this.hideNow(); return; }
        this.paint();
    }
    private paint(): void {
        const fade = this.phase === 'success' ? 1 - Math.max(0, (this.elapsed - .36) / .26) : 1;
        this.opacity.opacity = Math.round(255 * this.intro * Math.max(0, fade));
        const scale = .97 + .03 * (1 - Math.pow(1 - this.intro, 3));
        this.emblem.setScale(scale, scale, 1);
        const g = this.motion; g.clear();
        const fire = this.sparks; fire.clear();
        if (this.phase === 'connecting') {
            const angle = this.elapsed * 1.85;
            this.arc(g, 61, angle, angle + 1.1, 2.2, LIGHT);
            this.arc(g, 61, angle + Math.PI, angle + Math.PI + .52, 1.3, new Color(195, 151, 78, 170));
            this.arc(g, 68, -angle * .46, -angle * .46 + .42, 1, new Color(213, 180, 115, 110));
            const x = Math.cos(angle + 1.1) * 61, y = Math.sin(angle + 1.1) * 61;
            g.fillColor = new Color(236, 200, 128, 28); g.circle(x, y, 6); g.fill();
            g.fillColor = LIGHT; g.circle(x, y, 2); g.fill();
            this.drawFire(fire);
        } else if (this.phase === 'success') {
            const glow = Math.max(0, 1 - this.elapsed / .62);
            this.arc(g, 61, 0, Math.PI * 2, 1.5, new Color(225, 208, 154, Math.round(210 * glow)));
            this.arc(g, 61 + this.elapsed * 30, 0, Math.PI * 2, 1, new Color(225, 208, 154, Math.round(90 * glow)));
            g.lineWidth = 3; g.strokeColor = LIGHT;
            g.moveTo(-17, -1); g.lineTo(-5, -13); g.lineTo(20, 15); g.stroke();
        } else {
            this.arc(g, 61, .22, Math.PI - .22, 1, new Color(172, 125, 87, 150));
            this.arc(g, 61, Math.PI + .22, Math.PI * 2 - .22, 1, new Color(172, 125, 87, 150));
            g.lineWidth = 2; g.strokeColor = new Color(213, 158, 113, 255);
            g.moveTo(-5, 21); g.lineTo(5, 6); g.lineTo(-5, -5); g.lineTo(5, -21); g.stroke();
        }
    }
    private drawFire(g: Graphics): void {
        const t = this.elapsed, sway = Math.sin(t * 4.7) * 2.5, height = 25 + Math.sin(t * 6.1) * 2;
        g.fillColor = new Color(197, 110, 50, 215);
        g.moveTo(-7, 19); g.bezierCurveTo(-13, 26, -3 + sway, 28, sway, 19 + height);
        g.bezierCurveTo(8 + sway, 34, 4, 29, 8, 27); g.bezierCurveTo(12, 20, 3, 17, -7, 19); g.fill();
        g.fillColor = new Color(246, 205, 125, 245);
        g.moveTo(-3, 20); g.bezierCurveTo(-6, 26, 2 + sway * .5, 29, 2, 35);
        g.bezierCurveTo(8, 27, 6, 22, 2, 19); g.fill();
        for (let i = 0; i < 4; i++) {
            const p = (t * .42 + i * .25) % 1;
            g.fillColor = new Color(234, 193, 109, Math.round(Math.sin(p * Math.PI) * 150));
            g.circle(Math.sin(i * 2.4 + p * 3) * (5 + p * 8), 29 + p * 24, 1 - p * .5); g.fill();
        }
    }
    private ensureBuilt(): void {
        if (this.built) return;
        this.built = true;
        const ui = this.node.getComponent(UITransform) || this.node.addComponent(UITransform); ui.setAnchorPoint(.5, .5);
        this.opacity = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        this.mask = this.makeNode('DimMask', this.node, 1280, 720);
        this.mask.addComponent(Graphics); this.mask.addComponent(BlockInputEvents);
        this.visual = this.makeNode('ReconnectVisual', this.node, 264, 280);
        this.emblem = this.makeNode('BeaconEmblem', this.visual, 160, 160, 0, 24);
        const plate = this.emblem.addComponent(Graphics);
        for (let i = 7; i > 0; i--) { plate.fillColor = new Color(198, 153, 74, 3); plate.circle(0, 0, 51 + i * 4); plate.fill(); }
        plate.fillColor = INK; plate.circle(0, 0, 52); plate.fill();
        this.arc(plate, 52, 0, Math.PI * 2, 1, new Color(211, 177, 109, 160));
        this.arc(plate, 47, 0, Math.PI * 2, 1, new Color(154, 129, 86, 65));
        for (let i = 0; i < 8; i++) this.arc(plate, 61, i * Math.PI / 4, i * Math.PI / 4 + .1, 1, new Color(192, 157, 97, 75));
        this.tower = this.makeNode('Watchtower', this.emblem, 80, 96).addComponent(Graphics); this.drawTower(this.tower);
        this.motion = this.makeNode('SignalOrbit', this.emblem, 160, 160).addComponent(Graphics);
        this.sparks = this.makeNode('BeaconFlame', this.emblem, 80, 112).addComponent(Graphics);
        this.status = this.makeLabel('Status', this.visual, 240, 30, -66, '', 19, LIGHT);
        this.retryButton = this.makeNode('ReturnLogin', this.visual, 180, 44, 0, -111);
        const bg = this.retryButton.addComponent(Graphics);
        bg.fillColor = new Color(100, 78, 40, 240); bg.roundRect(-90, -22, 180, 44, 3); bg.fill();
        bg.strokeColor = new Color(208, 174, 105, 180); bg.lineWidth = 1; bg.roundRect(-89, -21, 178, 42, 3); bg.stroke();
        const button = this.retryButton.addComponent(Button); button.transition = Button.Transition.SCALE; button.zoomScale = .97;
        this.retryButton.on(Button.EventType.CLICK, this.onReturnLogin, this);
        this.makeLabel('Label', this.retryButton, 164, 30, 0, '返回登录', 16, LIGHT); this.retryButton.active = false;
        this.layout();
    }
    private layout(): void {
        if (!this.built) return;
        const size = view.getVisibleSize(), safe = sys.getSafeAreaRect();
        this.node.getComponent(UITransform).setContentSize(size.width, size.height);
        this.mask.getComponent(UITransform).setContentSize(size.width, size.height);
        this.mask.getComponent(BlockInputEvents).enabled = this.blockInput;
        const g = this.mask.getComponent(Graphics); g.clear();
        g.fillColor = new Color(7, 12, 10, this.phase === 'failed' ? 135 : 105);
        g.rect(-size.width / 2, -size.height / 2, size.width, size.height); g.fill();
        this.visual.setPosition(safe.x + safe.width / 2 - size.width / 2, safe.y + safe.height / 2 - size.height / 2, 0);
        this.visual.getComponent(UITransform).setContentSize(Math.min(264, safe.width - 24), Math.min(280, safe.height - 24));
        // 不缩小按钮热区；短横屏仅压紧上下间距。
        const compact = safe.height < 310;
        this.emblem.setPosition(0, compact ? 30 : 24, 0);
        this.status.node.setPosition(0, compact ? -49 : -66, 0);
        this.retryButton.setPosition(0, compact ? -90 : -111, 0);
    }
    private drawTower(g: Graphics): void {
        g.fillColor = new Color(157, 129, 77, 235);
        g.moveTo(-17, -22); g.lineTo(-13, 9); g.lineTo(13, 9); g.lineTo(17, -22); g.close(); g.fill();
        g.fillColor = new Color(104, 92, 62, 255);
        g.moveTo(2, 9); g.lineTo(13, 9); g.lineTo(17, -22); g.lineTo(2, -22); g.close(); g.fill();
        g.fillColor = GOLD; g.rect(-22, -26, 44, 4); g.rect(-19, -22, 38, 2); g.fill(); g.rect(-18, 8, 36, 5); g.fill();
        for (const x of [-18, -7, 5, 14]) { g.rect(x, 12, x === 14 ? 4 : 6, 5); g.fill(); }
        g.fillColor = new Color(25, 31, 27, 255); g.roundRect(-5, -22, 10, 17, 4); g.fill();
        g.lineWidth = 1; g.strokeColor = new Color(222, 191, 126, 110);
        for (const y of [-14, -6, 2]) { g.moveTo(-13, y); g.lineTo(-7, y); g.moveTo(7, y); g.lineTo(13, y); } g.stroke();
        g.fillColor = new Color(205, 162, 87, 255); g.rect(-9, 17, 18, 3); g.fill();
    }
    private arc(g: Graphics, radius: number, from: number, to: number, width: number, color: Color): void {
        g.lineWidth = width; g.strokeColor = color;
        const steps = Math.max(4, Math.ceil(Math.abs(to - from) * 12));
        g.moveTo(Math.cos(from) * radius, Math.sin(from) * radius);
        for (let i = 1; i <= steps; i++) { const a = from + (to - from) * i / steps; g.lineTo(Math.cos(a) * radius, Math.sin(a) * radius); }
        g.stroke();
    }
    private makeNode(name: string, parent: Node, width: number, height: number, x = 0, y = 0): Node {
        const node = new Node(name); node.layer = this.node.layer; parent.addChild(node);
        const ui = node.addComponent(UITransform); ui.setContentSize(width, height); ui.setAnchorPoint(.5, .5);
        node.setPosition(x, y, 0); return node;
    }
    private makeLabel(name: string, parent: Node, width: number, height: number, y: number, text: string, size: number, color: Color): Label {
        const label = this.makeNode(name, parent, width, height, 0, y).addComponent(Label);
        label.string = text; label.fontSize = size; label.lineHeight = height; label.color = color;
        label.useSystemFont = true; label.fontFamily = 'Microsoft YaHei';
        label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.CLAMP; label.enableWrapText = false; return label;
    }
    private onReturnLogin(): void {
        if (this.phase !== 'failed' || this.returning) return;
        this.returning = true; this.retryButton.getComponent(Button).interactable = false;
        EventMgr.emit(LogicEvent.enterLogin);
    }
}
