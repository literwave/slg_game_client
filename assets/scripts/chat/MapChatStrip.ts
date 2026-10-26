import { _decorator, BlockInputEvents, Button, Color, Component, Label, Node, UITransform } from 'cc';
import ChatCommand from './ChatCommand';
import { CHAT_CHANNELS, chatDockLayout, shortChatText } from './ChatPresentation';
import { ChatMsg } from './ChatProxy';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import { caption, inkSurface, ManagementColors as C, place, textStyle } from '../map/ui/ManagementStyle';

const { ccclass } = _decorator;

/** 地图常驻消息流，直接显示内容，不占用“更多”菜单入口。 */
@ccclass('MapChatStrip')
export default class MapChatStrip extends Component {
    private width = 460;
    private rows: Node[] = [];
    private recent: ChatMsg[] = [];
    private unread: Label;
    private open: (channel: number, target?: string, name?: string) => void;

    initialize(open: (channel: number, target?: string, name?: string) => void): void {
        this.open = open;
        this.node.addComponent(UITransform);
        this.node.addComponent(BlockInputEvents);
        caption(this.node, 'Heading', '聊天', 0, 0, 50, 12, C.gold);
        caption(this.node, 'Hint', '点击发言  ›', 0, 0, 84, 12, C.muted, Label.HorizontalAlign.RIGHT);
        const button = this.make('OpenChat'); button.addComponent(Button);
        button.on(Button.EventType.CLICK, () => this.open?.(1));
        this.unread = caption(this.node, 'Unread', '', 0, 0, 100, 12, C.gold, Label.HorizontalAlign.RIGHT);
        for (let i = 0; i < 2; i++) {
            const row = this.make('Message' + i); row.addComponent(Button);
            row.on(Button.EventType.CLICK, () => {
                const msg = this.recent[i];
                const peer = msg?.channel === 3 ? ChatCommand.getInstance().proxy.conversations().find(p => p.id === msg.peerId) : null;
                this.open?.(msg?.channel || 1, peer?.id, peer?.name);
            });
            caption(row, 'Channel', '', 0, 0, 42, 12, C.gold);
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
        inkSurface(this.node, 'Surface', m.width, m.height, new Color(24, 31, 26, 210), C.line);
        place(this.node.getChildByName('Heading'), -m.width / 2 + 34, 27, 44, 24);
        place(this.node.getChildByName('Hint'), m.width / 2 - 55, 27, 88, 24);
        place(this.node.getChildByName('OpenChat'), 0, 27, m.width, 30);
        place(this.unread.node, m.width / 2 - 142, 27, Math.max(30, m.width - 178), 24);
        this.rows.forEach((row, i) => {
            place(row, 0, 2 - i * 25, m.width, 25);
            textStyle(row.getChildByName('Channel').getComponent(Label), -m.width / 2 + 34, 0, 44, 12, C.gold, Label.HorizontalAlign.CENTER, 22);
            textStyle(row.getChildByName('Text').getComponent(Label), 26, 0, m.width - 80, 13, C.text, Label.HorizontalAlign.LEFT, 22);
        });
        this.render();
    }
    private render(): void {
        if (!this.rows.length) return;
        const cmd = ChatCommand.getInstance(); this.recent = cmd.proxy.recent(2);
        const count = cmd.proxy.unreadCount();
        this.unread.string = count ? (count > 99 ? '99+' : String(count)) + ' 未读' : '';
        this.rows.forEach((row, index) => {
            const msg = this.recent[index];
            row.getChildByName('Channel').getComponent(Label).string = msg ? CHAT_CHANNELS[msg.channel - 1] : index ? '' : '世界';
            row.getChildByName('Text').getComponent(Label).string = shortChatText(msg
                ? `${msg.nick_name || '主公'}：${msg.msg}`
                : index === 0 ? (cmd.sessionReady ? '暂无消息，来和诸位主公聊聊吧' : '连接已断开')
                    : '世界 · 联盟 · 私聊', Math.max(8, Math.floor((this.width - 80) / 13)));
            row.getChildByName('Text').getComponent(Label).color = msg ? C.text : C.muted;
        });
    }
    private make(name: string): Node {
        const node = new Node(name); node.layer = this.node.layer;
        this.node.addChild(node); node.addComponent(UITransform); return node;
    }
    protected onDestroy(): void { EventMgr.targetOff(this); }
}
