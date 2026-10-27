import { _decorator, BlockInputEvents, Button, Color, Component, Label, Node, UITransform } from 'cc';
import ChatCommand from './ChatCommand';
import { CHAT_CHANNELS, chatDockLayout, shortChatText } from './ChatPresentation';
import { ChatMsg } from './ChatProxy';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import { caption, inkSurface, ManagementColors as C, place, textStyle } from '../map/ui/ManagementStyle';

const { ccclass } = _decorator;
const CHANNEL_COLORS = [C.gold, new Color(148, 193, 166), new Color(172, 171, 214)];

/** 地图常驻消息流，直接显示内容，不占用“更多”菜单入口。 */
@ccclass('MapChatStrip')
export default class MapChatStrip extends Component {
    private width = 344;
    private rows: Node[] = [];
    private recent: ChatMsg[] = [];
    private unread: Label;
    private open: (channel: number, target?: string, name?: string) => void;

    initialize(open: (channel: number, target?: string, name?: string) => void): void {
        this.open = open;
        this.node.addComponent(UITransform);
        this.node.addComponent(BlockInputEvents);
        caption(this.node, 'Heading', '聊天', 0, 0, 36, 13, C.text);
        caption(this.node, 'Hint', '发言  ›', 0, 0, 60, 13, C.gold, Label.HorizontalAlign.RIGHT);
        const button = this.make('OpenChat'); button.addComponent(Button);
        button.on(Button.EventType.CLICK, () => this.open?.(1));
        this.unread = caption(this.node, 'Unread', '', 0, 0, 28, 11, C.text, Label.HorizontalAlign.CENTER);
        const empty = this.make('Empty'); empty.addComponent(Button);
        empty.on(Button.EventType.CLICK, () => this.open?.(1));
        caption(empty, 'Text', '', 0, 0, 300, 13, C.muted);
        for (let i = 0; i < 2; i++) {
            const row = this.make('Message' + i); row.addComponent(Button);
            row.on(Button.EventType.CLICK, () => {
                const msg = this.recent[i];
                const peer = msg?.channel === 3 ? ChatCommand.getInstance().proxy.conversations().find(p => p.id === msg.peerId) : null;
                this.open?.(msg?.channel || 1, peer?.id, peer?.name);
            });
            caption(row, 'Channel', '', 0, 0, 34, 11, C.gold, Label.HorizontalAlign.CENTER);
            caption(row, 'Sender', '', 0, 0, 66, 13, C.muted);
            caption(row, 'Text', '', 0, 0, 300, 13, C.text);
            this.rows.push(row);
        }
        EventMgr.on(E.updateChatHistory, this.render, this);
        EventMgr.on(E.chatReadChanged, this.render, this);
        EventMgr.on(E.protocolRequestChanged, this.render, this);
        this.render();
    }
    layout(width: number, height: number): void {
        const m = chatDockLayout(width, height); this.width = m.width;
        place(this.node, m.x, m.y, m.width, m.height);
        const left = -m.width / 2 + 14, right = m.width / 2 - 14;
        const surface = inkSurface(this.node, 'Surface', m.width, m.height, new Color(24, 31, 26, 222), C.line);
        surface.lineWidth = 1;
        surface.strokeColor = new Color(153, 134, 91, 65);
        surface.moveTo(left, 9); surface.lineTo(right, 9); surface.stroke();
        place(this.node.getChildByName('Heading'), left + 18, 25, 36, 24);
        place(this.node.getChildByName('Hint'), right - 30, 25, 60, 26);
        place(this.node.getChildByName('OpenChat'), 0, 25, m.width, 34);
        place(this.unread.node, left + 58, 25, 28, 20);
        const badge = inkSurface(this.node, 'UnreadBadge', 28, 18, new Color(124, 67, 47, 230), null);
        badge.node.setSiblingIndex(surface.node.getSiblingIndex() + 1);
        place(badge.node, left + 58, 25, 28, 18);
        const empty = this.node.getChildByName('Empty');
        place(empty, 0, -16, m.width, 48);
        textStyle(empty.getChildByName('Text').getComponent(Label), 0, 0, m.width - 28, 13, C.muted, Label.HorizontalAlign.CENTER, 24);
        this.rows.forEach((row, i) => {
            place(row, 0, -3 - i * 24, m.width, 24);
            textStyle(row.getChildByName('Channel').getComponent(Label), left + 17, 0, 34, 11, C.gold, Label.HorizontalAlign.CENTER, 20);
            textStyle(row.getChildByName('Sender').getComponent(Label), left + 75, 0, 66, 13, C.muted, Label.HorizontalAlign.LEFT, 22);
            const textWidth = Math.max(1, m.width - 140);
            textStyle(row.getChildByName('Text').getComponent(Label), right - textWidth / 2, 0, textWidth, 13, C.text, Label.HorizontalAlign.LEFT, 22);
        });
        this.render();
    }
    private render(): void {
        if (!this.rows.length) return;
        const cmd = ChatCommand.getInstance(); this.recent = cmd.proxy.recent(2);
        const count = cmd.proxy.unreadCount();
        this.unread.string = count > 99 ? '99+' : String(count);
        this.unread.node.active = count > 0;
        const badge = this.node.getChildByName('UnreadBadge');
        if (badge) badge.active = count > 0;
        const empty = this.node.getChildByName('Empty');
        empty.active = this.recent.length === 0;
        empty.getChildByName('Text').getComponent(Label).string = shortChatText(cmd.sessionReady
            ? '暂无消息，和诸位主公聊聊吧' : '连接已断开，重连后可发言', Math.max(1, Math.floor((this.width - 28) / 13)));
        this.rows.forEach((row, index) => {
            const msg = this.recent[index];
            row.active = !!msg;
            if (!msg) return;
            const color = CHANNEL_COLORS[msg.channel - 1] || C.gold;
            const channel = row.getChildByName('Channel').getComponent(Label);
            channel.string = CHAT_CHANNELS[msg.channel - 1] || '世界'; channel.color = color;
            const tag = inkSurface(row, 'ChannelTag', 34, 18, new Color(color.r, color.g, color.b, 24), null);
            place(tag.node, -this.width / 2 + 31, 0, 34, 18);
            row.getChildByName('Sender').getComponent(Label).string = shortChatText(msg.nick_name || '主公', 4) + '：';
            row.getChildByName('Text').getComponent(Label).string = shortChatText(msg.msg, Math.max(1, Math.floor((this.width - 140) / 13)));
        });
    }
    private make(name: string): Node {
        const node = new Node(name); node.layer = this.node.layer;
        this.node.addChild(node); node.addComponent(UITransform); return node;
    }
    protected onDestroy(): void { EventMgr.targetOff(this); }
}
