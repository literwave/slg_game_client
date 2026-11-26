import { _decorator, BlockInputEvents, Button, Color, Component, Label, Node, UITransform } from 'cc';
import ChatCommand from './ChatCommand';
import { ChatMsg } from './ChatProxy';
import { CHAT_CHANNELS, chatDockLayout, shortChatText } from './ChatPresentation';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import { caption, inkSurface, ManagementColors as C, place } from '../map/ui/ManagementStyle';

const { ccclass } = _decorator;

/** 地图左下角显示最新真实消息，点击预览直达该会话。 */
@ccclass('MapChatStrip')
export default class MapChatStrip extends Component {
    private unread: Node;
    private preview: Node;
    private sender: Label;
    private message: Label;
    private latest: ChatMsg | null = null;
    private textWidth = 240;
    private open: (channel: number, target?: string, name?: string) => void;

    initialize(open: (channel: number, target?: string, name?: string) => void): void {
        this.open = open;
        this.node.addComponent(UITransform);
        this.node.addComponent(BlockInputEvents);
        const button = this.make('OpenChat');
        const control = button.addComponent(Button);
        control.transition = Button.Transition.SCALE;
        control.zoomScale = .94;
        button.on(Button.EventType.CLICK, this.openChat, this);
        this.preview = this.make('LatestMessage');
        this.preview.addComponent(Button).transition = Button.Transition.NONE;
        this.preview.on(Button.EventType.CLICK, this.openPreview, this);
        this.sender = caption(this.preview, 'Sender', '', 0, 11, 240, 12, C.gold);
        this.message = caption(this.preview, 'Message', '', 0, -10, 240, 14, C.text);
        this.unread = this.make('Unread');
        EventMgr.on(E.updateChatHistory, this.render, this);
        EventMgr.on(E.chatReadChanged, this.render, this);
        this.render();
    }

    layout(width: number, height: number): void {
        const m = chatDockLayout(width, height);
        place(this.node, m.x, m.y, m.width, m.height);
        const frame = inkSurface(this.node, 'ChatSurface', m.width, m.height,
            new Color(24, 31, 26, 220), new Color(153, 134, 91, 100));
        frame.strokeColor = new Color(153, 134, 91, 75); frame.lineWidth = 1;
        frame.moveTo(-m.width / 2 + 52, -14); frame.lineTo(-m.width / 2 + 52, 14); frame.stroke();
        const button = this.node.getChildByName('OpenChat');
        const iconX = -m.width / 2 + 26, previewWidth = m.width - 52;
        place(button, iconX, 0, 52, m.height);
        place(this.preview, -m.width / 2 + 52 + previewWidth / 2, 0, previewWidth, m.height);
        this.textWidth = previewWidth - 24;
        place(this.sender.node, 0, 11, this.textWidth, 18);
        place(this.message.node, 0, -10, this.textWidth, 22);
        const g = inkSurface(button, 'Bubble', 56, 56, null, null);
        g.fillColor = C.gold;
        g.roundRect(-13, -7, 26, 19, 5); g.fill();
        g.moveTo(-8, -6); g.lineTo(-8, -13); g.lineTo(0, -6); g.close(); g.fill();
        g.fillColor = new Color(24, 31, 26);
        for (const x of [-6, 0, 6]) { g.circle(x, 3, 1.5); g.fill(); }
        place(this.unread, iconX + 14, 14, 12, 12);
        const dot = inkSurface(this.unread, 'Dot', 12, 12, null, null);
        dot.fillColor = new Color(24, 31, 26); dot.circle(0, 0, 6); dot.fill();
        dot.fillColor = new Color(195, 77, 56); dot.circle(0, 0, 4); dot.fill();
        this.render();
    }

    private openChat(): void {
        const proxy = ChatCommand.getInstance().proxy;
        // 红点对应真实未读，优先打开未读私聊，再打开联盟或世界频道。
        const peer = proxy.conversations().find(p => proxy.unreadCount(3, p.id) > 0);
        if (peer) this.open?.(3, peer.id, peer.name);
        else this.open?.(proxy.unreadCount(2) > 0 ? 2 : 1);
    }

    private render(): void {
        const proxy = ChatCommand.getInstance().proxy;
        this.latest = proxy.recent(1)[0] || null;
        if (this.unread) this.unread.active = proxy.unreadCount() > 0;
        if (!this.sender || !this.message) return;
        const row = this.latest;
        this.sender.string = row ? CHAT_CHANNELS[row.channel - 1] : '世界';
        this.message.string = row ? shortChatText(`${row.nick_name || '主公'}：${row.msg}`,
            Math.max(4, Math.floor(this.textWidth / 14))) : '暂无消息';
        this.message.color = row ? C.text : C.muted;
    }

    private openPreview(): void {
        const row = this.latest;
        if (!row) { this.open?.(1); return; }
        const peer = row.channel === 3
            ? ChatCommand.getInstance().proxy.conversations().find(p => p.id === row.peerId) : null;
        this.open?.(row.channel, row.channel === 3 ? row.peerId : undefined, peer?.name);
    }

    private make(name: string): Node {
        const node = new Node(name); node.layer = this.node.layer;
        this.node.addChild(node); node.addComponent(UITransform); return node;
    }
    protected onDestroy(): void { EventMgr.targetOff(this); }
}
