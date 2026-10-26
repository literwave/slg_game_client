import { _decorator, BlockInputEvents, Button, Canvas, Color, Component, EditBox, Label, Mask, Node,
    SafeArea, ScrollView, Sprite, UITransform, Widget, view } from 'cc';
import ChatCommand from './ChatCommand';
import { ChatMsg } from './ChatProxy';
import { CHAT_CHANNELS, CHAT_MAX_LENGTH, chatPanelLayout, chatTime, shortChatText, validChatTarget } from './ChatPresentation';
import LoginCommand from '../login/LoginCommand';
import UnionCommand from '../union/UnionCommand';
import { idKey } from '../network/pto/ProtocolCommand';
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent as E } from '../common/LogicEvent';
import { caption, inkSurface, ManagementColors as C, panelButton, place, textStyle } from '../map/ui/ManagementStyle';

const { ccclass } = _decorator;

@ccclass('ChatLogic')
export default class ChatLogic extends Component {
    private safe: Node;
    private panel: Node;
    private tabs: Node[] = [];
    private status: Label;
    private privateBar: Node;
    private targetInput: EditBox;
    private composer: Node;
    private input: EditBox;
    private send: Node;
    private viewport: Node;
    private content: Node;
    private scroll: ScrollView;
    private empty: Label;
    private latest: Node;
    private retry: Node;
    private counter: Label;
    private channel = 1;
    private targetId = '0';
    private peerName = '';
    private choosingPeer = false;
    private drafts = new Map<string, string>();
    private rowSignature = '';
    private followLatest = true;
    private layouting = false;
    private rendering = false;
    private queued = false;
    private layoutQueued = false;
    private pendingOwnScroll = false;
    private metrics = chatPanelLayout(1280, 720);

    public show(channel = 1, targetId = '0', name = ''): void {
        if (!this.panel) this.build();
        else this.saveDraft();
        this.node.active = true;
        this.node.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment();
        this.safe.getComponent(SafeArea).updateArea();
        this.switchChannel(channel, targetId, name);
    }

    private build(): void {
        this.clear(this.node);
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        this.stretch(this.node);
        // 旧弹窗容器 cNode 只在窗口事件时更新，直接跟随 Canvas，兼容运行中横竖屏切换。
        for (let parent = this.node.parent; parent; parent = parent.parent) {
            if (parent.getComponent(Canvas)) { this.node.getComponent(Widget).target = parent; break; }
        }
        this.node.addComponent(BlockInputEvents);
        this.button(this.node, 'DismissArea', () => this.close());
        this.safe = this.make('SafeContent', this.node); this.stretch(this.safe); this.safe.addComponent(SafeArea);
        this.panel = this.make('ChatWindow', this.safe); this.panel.addComponent(BlockInputEvents);
        caption(this.panel, 'Title', '聊天', 0, 0, 180, 28, C.text);
        this.status = caption(this.panel, 'Status', '', 0, 0, 350, 13, C.muted);
        this.button(this.panel, 'Close', () => this.close());
        this.retry = this.button(this.panel, 'Retry', () => { ChatCommand.getInstance().chatHistory(this.channel - 1, this.targetId); this.refresh(); });
        CHAT_CHANNELS.forEach((_name, index) => {
            this.tabs.push(this.button(this.panel, 'Channel' + (index + 1), () => this.switchChannel(index + 1)));
        });
        this.privateBar = this.make('PrivateBar', this.panel);
        this.button(this.privateBar, 'Contacts', () => {
            this.saveDraft(); this.choosingPeer = !validChatTarget(this.targetId) || !this.choosingPeer;
            this.rowSignature = ''; this.refresh();
        });
        this.targetInput = this.edit(this.privateBar, 'PlayerId', '输入对方 ID', 19);
        this.button(this.privateBar, 'Choose', () => this.chooseTarget());
        this.targetInput.node.on(EditBox.EventType.EDITING_RETURN, this.chooseTarget, this);
        this.scroll = this.make('Messages', this.panel).addComponent(ScrollView);
        this.scroll.horizontal = false; this.scroll.vertical = true; this.scroll.elastic = false;
        this.scroll.cancelInnerEvents = true;
        this.viewport = this.make('Viewport', this.scroll.node); this.stretch(this.viewport);
        this.viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.content = this.make('Content', this.viewport); this.content.getComponent(UITransform).setAnchorPoint(.5, 1);
        this.scroll.content = this.content;
        this.scroll.node.on(ScrollView.EventType.SCROLLING, this.onScroll, this);
        this.empty = caption(this.scroll.node, 'Empty', '', 0, 0, 350, 16, C.muted, Label.HorizontalAlign.CENTER);
        this.empty.enableWrapText = true;
        this.latest = this.button(this.panel, 'NewMessages', () => { this.followLatest = true; this.scroll.scrollToBottom(.15); this.markRead(); });
        this.composer = this.make('Composer', this.panel);
        this.input = this.edit(this.composer, 'MessageInput', '与诸位主公聊聊…', CHAT_MAX_LENGTH);
        this.input.returnType = EditBox.KeyboardReturnType.SEND;
        this.input.node.on(EditBox.EventType.EDITING_RETURN, this.sendMessage, this);
        this.input.node.on(EditBox.EventType.TEXT_CHANGED, this.inputChanged, this);
        this.send = this.button(this.composer, 'Send', () => this.sendMessage());
        this.counter = caption(this.composer, 'Count', '', 0, 0, 180, 12, C.muted, Label.HorizontalAlign.RIGHT);
        caption(this.composer, 'Hint', 'Enter 发送', 0, 0, 200, 12, C.muted);
        this.node.on(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        view.on('design-resolution-changed', this.queueLayout, this);
        view.on('canvas-resize', this.queueLayout, this);
        EventMgr.on(E.updateChatHistory, this.queueRefresh, this);
        EventMgr.on(E.chatReadChanged, this.queueRefresh, this);
        EventMgr.on(E.protocolRequestChanged, this.queueRefresh, this);
        EventMgr.on(E.unionChange, this.queueRefresh, this);
        EventMgr.on(E.chatSendResult, this.onSendResult, this);
        EventMgr.on(E.enterLogin, this.onLogout, this);
    }

    private queueLayout(): void {
        if (!this.node.activeInHierarchy || this.layoutQueued) return;
        this.layoutQueued = true;
        this.scheduleOnce(() => {
            if (this.isValid && this.node.activeInHierarchy) {
                this.node.getComponent(Widget).updateAlignment();
                this.safe.getComponent(Widget).updateAlignment();
                this.safe.getComponent(SafeArea).updateArea();
                this.layout();
            }
            this.layoutQueued = false;
        }, 0);
    }

    private layout(): void {
        if (!this.panel || this.layouting) return;
        const root = this.node.getComponent(UITransform), safe = this.safe.getComponent(UITransform);
        if (safe.width <= 1 || safe.height <= 1) return;
        this.layouting = true;
        this.metrics = chatPanelLayout(safe.width, safe.height);
        const { width: w, height: h, x, scale } = this.metrics, top = h / 2;
        place(this.node.getChildByName('DismissArea'), 0, 0, root.width, root.height);
        inkSurface(this.node.getChildByName('DismissArea'), 'Shade', root.width, root.height, new Color(9, 16, 12, 112), null);
        place(this.panel, x, 0, w, h);
        inkSurface(this.panel, 'Surface', w, h, C.ink, C.gold);
        place(this.panel.getChildByName('Title'), -w / 2 + 104, top - 35, 164, 44);
        place(this.status.node, -12, top - 70, w - 64, 24);
        this.status.overflow = Label.Overflow.SHRINK;
        panelButton(this.panel.getChildByName('Close'), '', w / 2 - 34, top - 32, 40, 40, false, true);
        panelButton(this.retry, '重试', w / 2 - 102, top - 32, 72, 34);
        this.tabs.forEach((node, i) => panelButton(node, CHAT_CHANNELS[i], (i - 1) * ((w - 40) / 3 + 2), top - 110,
            (w - 52) / 3, 40, i + 1 === this.channel));
        this.privateBar.active = this.channel === 3;
        place(this.privateBar, 0, top - 159, w - 32, 44);
        panelButton(this.privateBar.getChildByName('Contacts'), '会话', -w / 2 + 49, 0, 62, 38);
        this.placeEdit(this.targetInput, 0, 0, w - 196, 38);
        panelButton(this.privateBar.getChildByName('Choose'), '私聊', w / 2 - 49, 0, 62, 38, true);
        const bodyTop = top - (this.channel === 3 ? 190 : 142), bodyBottom = -top + 106;
        const bodyHeight = Math.max(60, bodyTop - bodyBottom);
        place(this.scroll.node, 0, (bodyTop + bodyBottom) / 2, w - 32, bodyHeight);
        this.viewport.getComponent(Widget).updateAlignment();
        place(this.empty.node, 0, 0, w - 72, Math.min(110, bodyHeight));
        panelButton(this.latest, '新消息  ↓', 0, bodyBottom + 24, 142, 34, true);
        place(this.composer, 0, -top + 52, w - 32, 88);
        inkSurface(this.composer, 'Surface', w - 32, 88, C.inset, C.line);
        this.placeEdit(this.input, -42, 10, w - 138, 44);
        panelButton(this.send, '发送', w / 2 - 62, 10, 72, 44, true);
        place(this.composer.getChildByName('Hint'), -w / 2 + 110, -27, 166, 24);
        place(this.counter.node, w / 2 - 106, -27, 160, 24);
        this.rowSignature = '';
        this.refresh(); this.panel.setScale(scale, scale, 1);
        this.layouting = false;
    }

    private switchChannel(channel: number, targetId?: string, name = ''): void {
        this.saveDraft();
        this.channel = [1, 2, 3].indexOf(channel) >= 0 ? channel : 1;
        if (this.channel === 3) {
            if (validChatTarget(targetId)) {
                this.targetId = targetId; this.peerName = name || targetId;
                ChatCommand.getInstance().proxy.rememberPeer(targetId, name);
            }
            this.choosingPeer = !validChatTarget(this.targetId);
            this.targetInput.string = this.choosingPeer ? '' : this.targetId;
        } else this.choosingPeer = false;
        this.input.string = this.drafts.get(this.key()) || '';
        this.followLatest = true;
        this.layout();
        if (!this.choosingPeer) ChatCommand.getInstance().chatHistory(this.channel - 1, this.targetId);
        this.refresh();
    }

    private chooseTarget(): void {
        const id = this.targetInput.string.trim();
        if (!validChatTarget(id) || id === idKey(LoginCommand.getInstance().proxy.getRoleData()?.userId)) {
            EventMgr.emit(E.showToast, '请输入其他玩家的有效 ID'); return;
        }
        const peer = ChatCommand.getInstance().proxy.conversations().find(p => p.id === id);
        this.switchChannel(3, id, peer?.name || id);
    }

    private queueRefresh(): void {
        if (!this.node.activeInHierarchy || this.queued) return;
        this.queued = true;
        this.scheduleOnce(() => { this.queued = false; if (this.isValid && this.node.activeInHierarchy) this.refresh(); }, 0);
    }

    private refresh(): void {
        if (!this.panel || this.rendering) return;
        this.rendering = true;
        const cmd = ChatCommand.getInstance(), inUnion = UnionCommand.getInstance().proxy.isMeInUnion();
        const locked = this.channel === 2 && !inUnion, loading = cmd.requestInFlight(this.key());
        const failed = cmd.historyFailed(this.channel, this.targetId);
        this.status.string = !cmd.sessionReady ? '连接已断开，重新连接后可继续聊天'
            : locked ? '加入联盟后，与盟友互通军情' : this.channel === 3 && this.choosingPeer ? '选择近期会话，或输入玩家 ID'
                : loading ? '正在读取消息…' : failed ? '消息读取失败，可重试'
                    : this.channel === 3 ? `正在与 ${this.peerName || this.targetId} 私聊`
                        : this.channel === 1 ? '天下同袍，相聚于此' : '同盟一心，共议军情';
        this.retry.active = failed && !loading && cmd.sessionReady && !locked && !this.choosingPeer;
        this.tabs.forEach((tab, index) => {
            const label = tab.getComponentInChildren(Label), count = cmd.proxy.unreadCount(index + 1);
            if (label) label.string = CHAT_CHANNELS[index] + (count ? ` · ${count > 99 ? '99+' : count}` : '');
        });
        const rows = locked || this.choosingPeer ? [] : cmd.proxy.getHistory(this.channel, this.targetId);
        const signature = this.key() + ':' + this.choosingPeer + ':' + JSON.stringify(this.choosingPeer ? cmd.proxy.conversations() : rows);
        if (signature !== this.rowSignature) {
            const previousOffset = this.scroll.getScrollOffset().y;
            const previousTop = this.content.children.find(n => n.name.startsWith('Msg_')
                && n.position.y + previousOffset - n.getComponent(UITransform).height <= 0);
            const anchor = previousTop && { name: previousTop.name, screenY: previousTop.position.y + previousOffset };
            this.rowSignature = signature; this.scroll.stopAutoScroll(); this.clear(this.content);
            const w = this.scroll.node.getComponent(UITransform).width, h = this.scroll.node.getComponent(UITransform).height;
            let used = 8;
            if (this.choosingPeer) {
                cmd.proxy.conversations().forEach(peer => {
                    const row = this.button(this.content, 'Peer_' + peer.id, () => this.switchChannel(3, peer.id, peer.name));
                    place(row, 0, -used - 34, w - 8, 62);
                    inkSurface(row, 'Surface', w - 8, 62, C.panel, C.line);
                    caption(row, 'Name', shortChatText(peer.name, 22), -20, 12, w - 64, 17, C.text);
                    const last = cmd.proxy.getHistory(3, peer.id).slice(-1)[0];
                    caption(row, 'Last', shortChatText(last?.msg || '开始私聊', Math.floor((w - 68) / 13)), -20, -14, w - 64, 13, C.muted);
                    const count = cmd.proxy.unreadCount(3, peer.id);
                    caption(row, 'Unread', count ? String(count) : '›', w / 2 - 24, 0, 32, 14, C.gold, Label.HorizontalAlign.CENTER);
                    used += 70;
                });
            } else rows.forEach(msg => { used += this.message(msg, used, w) + 16; });
            const contentHeight = Math.max(h, used + 8);
            this.content.getComponent(UITransform).setContentSize(w, contentHeight);
            const anchorNode = anchor && this.content.getChildByName(anchor.name);
            const offset = this.followLatest || this.pendingOwnScroll ? contentHeight - h
                : anchorNode ? anchor.screenY - anchorNode.position.y : previousOffset;
            this.content.setPosition(0, h / 2 + Math.max(0, Math.min(offset, contentHeight - h)), 0);
            if (this.pendingOwnScroll) { this.followLatest = true; this.pendingOwnScroll = false; }
        }
        this.empty.node.active = this.choosingPeer ? !cmd.proxy.conversations().length : !rows.length;
        this.empty.string = locked ? '加入联盟后开启联盟聊天' : this.choosingPeer ? '暂无私聊会话\n点击消息头像，也可以发起私聊'
            : loading ? '正在读取消息…' : failed ? '暂时未能读取消息' : '暂无消息\n发出第一声问候吧';
        const canType = cmd.sessionReady && !locked && !this.choosingPeer;
        this.input.enabled = canType;
        this.input.placeholder = !cmd.sessionReady ? '连接已断开' : locked ? '加入联盟后可发言'
            : this.choosingPeer ? '请先选择聊天对象' : this.channel === 3 ? '发送私聊消息…' : '与诸位主公聊聊…';
        this.updateSend();
        if (!this.choosingPeer && this.followLatest) this.markRead();
        this.latest.active = !this.choosingPeer && !this.followLatest && cmd.proxy.unreadCount(this.channel, this.targetId) > 0;
        this.rendering = false;
    }

    private message(msg: ChatMsg, top: number, width: number): number {
        const own = idKey(msg.rid) === idKey(LoginCommand.getInstance().proxy.getRoleData()?.userId);
        const row = this.make('Msg_' + idKey(msg.msgId), this.content);
        const avatar = this.button(row, 'Avatar', () => {
            if (!own && validChatTarget(msg.rid)) this.switchChannel(3, idKey(msg.rid), msg.nick_name);
        });
        const x = own ? width / 2 - 28 : -width / 2 + 28;
        place(avatar, x, -26, 44, 44);
        inkSurface(avatar, 'Frame', 44, 44, C.panel, own ? C.gold : C.line);
        const fallback = caption(avatar, 'Initial', (msg.nick_name || '将').slice(0, 1), 0, 0, 42, 22, C.gold, Label.HorizontalAlign.CENTER);
        const iconNode = this.make('Icon', avatar); place(iconNode, 0, 0, 40, 40);
        const sprite = iconNode.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const icons = LoginCommand.getInstance().headIcons, iconId = icons.getDisplayId(msg.headIcon);
        sprite.spriteFrame = icons.getIcon(iconId);
        if (sprite.spriteFrame) fallback.node.active = false;
        else icons.loadIcon(iconId).then(frame => { if (sprite.isValid && frame) { sprite.spriteFrame = frame; fallback.node.active = false; } });
        const maxWidth = Math.max(110, width - 136);
        const nameX = own ? width / 2 - 64 - maxWidth / 2 : -width / 2 + 64 + maxWidth / 2;
        caption(row, 'Sender', shortChatText((own ? '我' : msg.nick_name || '主公') + '  ·  ' + chatTime(msg.time), Math.floor(maxWidth / 12)),
            nameX, -12, maxWidth, 12, own ? C.gold : C.muted, own ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.LEFT);
        const bubble = this.make('Bubble', row);
        const text = caption(bubble, 'Message', msg.msg, 0, 0, maxWidth - 24, 16, C.text);
        text.overflow = Label.Overflow.NONE; text.enableWrapText = false; text.updateRenderData(true);
        const bubbleWidth = Math.min(maxWidth, Math.max(64, text.node.getComponent(UITransform).width + 24));
        const bubbleX = own ? width / 2 - 64 - bubbleWidth / 2 : -width / 2 + 64 + bubbleWidth / 2;
        text.node.getComponent(UITransform).width = bubbleWidth - 24;
        text.enableWrapText = true; text.lineHeight = 24; text.overflow = Label.Overflow.RESIZE_HEIGHT;
        text.updateRenderData(true);
        const height = Math.max(24, text.node.getComponent(UITransform).height) + 20;
        place(bubble, bubbleX, -30 - height / 2, bubbleWidth, height);
        inkSurface(bubble, 'Surface', bubbleWidth, height, own ? new Color(73, 65, 43, 255) : new Color(47, 55, 46, 255), own ? C.line : null);
        place(row, 0, -top, width, height + 30);
        row.getComponent(UITransform).setAnchorPoint(.5, 1);
        return height + 30;
    }

    private onScroll(): void {
        if (this.rendering || this.layouting) return;
        const max = this.scroll.getMaxScrollOffset().y;
        this.followLatest = max - this.scroll.getScrollOffset().y <= 24;
        if (this.followLatest && !this.choosingPeer) this.markRead();
        this.latest.active = !this.choosingPeer && !this.followLatest && ChatCommand.getInstance().proxy.unreadCount(this.channel, this.targetId) > 0;
    }
    private markRead(): void {
        if (this.node.activeInHierarchy) ChatCommand.getInstance().markRead(this.channel, this.targetId);
        this.latest.active = false;
    }
    private inputChanged(): void { this.saveDraft(); this.updateSend(); }
    private updateSend(): void {
        const busy = ChatCommand.getInstance().requestInFlight('chat:send');
        this.send.getComponent(Button).interactable = this.input.enabled && !busy && !!this.input.string.trim();
        this.send.getComponentInChildren(Label).string = busy ? '发送中' : '发送';
        this.send.getComponentInChildren(Label).color = this.send.getComponent(Button).interactable ? C.text : C.muted;
        this.counter.string = Array.from(this.input.string).length + ' / ' + CHAT_MAX_LENGTH;
    }
    private sendMessage(): void {
        if (!this.input.enabled || ChatCommand.getInstance().requestInFlight('chat:send')) return;
        if (!this.input.string.trim()) { EventMgr.emit(E.showToast, '请输入聊天内容'); return; }
        this.saveDraft();
        if (!ChatCommand.getInstance().chat(this.input.string, this.channel - 1, this.targetId)) EventMgr.emit(E.showToast, '消息未发送，请检查连接或频道权限');
        this.updateSend();
    }
    private onSendResult(result: { channel: number; targetId: any; content: string; success: boolean }): void {
        const key = ChatCommand.getInstance().proxy.key(result.channel, result.targetId);
        if (result.success && this.drafts.get(key)?.trim() === result.content) this.drafts.delete(key);
        if (result.success && this.key() === key) {
            if (this.input.string.trim() === result.content) this.input.string = '';
            this.pendingOwnScroll = true;
        }
        this.queueRefresh();
    }
    private key(): string { return ChatCommand.getInstance().proxy.key(this.channel, this.targetId); }
    private saveDraft(): void { if (this.input) this.drafts.set(this.key(), this.input.string); }
    private onLogout(): void { this.drafts.clear(); if (this.input) this.input.string = ''; this.targetId = '0'; this.peerName = ''; this.close(); this.drafts.clear(); }
    public close(): void { this.saveDraft(); this.input?.blur(); this.targetInput?.blur(); this.node.active = false; }
    private edit(parent: Node, name: string, placeholder: string, maxLength: number): EditBox {
        const node = this.make(name, parent), edit = node.addComponent(EditBox);
        // EditBox 在激活节点上添加时会自动创建 Label，复用它们，避免残留默认 “label”。
        const text = edit.textLabel || caption(node, 'Text', '', 0, 0, 200, 16, C.text);
        const hint = edit.placeholderLabel || caption(node, 'Placeholder', placeholder, 0, 0, 200, 14, C.muted);
        text.node.layer = hint.node.layer = node.layer;
        edit.textLabel = text; edit.placeholderLabel = hint;
        edit.inputMode = EditBox.InputMode.SINGLE_LINE; edit.inputFlag = EditBox.InputFlag.DEFAULT;
        edit.maxLength = maxLength; edit.string = ''; edit.placeholder = placeholder; return edit;
    }
    private placeEdit(edit: EditBox, x: number, y: number, w: number, h: number): void {
        place(edit.node, x, y, w, h); inkSurface(edit.node, 'Surface', w, h, new Color(17, 24, 19, 255), C.line);
        textStyle(edit.textLabel, 0, 0, w - 18, 16, C.text, Label.HorizontalAlign.LEFT, h - 4);
        textStyle(edit.placeholderLabel, 0, 0, w - 18, 14, C.muted, Label.HorizontalAlign.LEFT, h - 4);
    }
    private make(name: string, parent: Node): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node); node.addComponent(UITransform); return node;
    }
    private button(parent: Node, name: string, action: () => void): Node {
        const node = this.make(name, parent), button = node.addComponent(Button);
        node.on(Button.EventType.CLICK, () => { if (button.interactable) action(); }, this); return node;
    }
    private clear(node: Node): void { for (const child of node.children.slice()) { child.removeFromParent(); child.destroy(); } }
    private stretch(node: Node): void {
        const w = node.getComponent(Widget) || node.addComponent(Widget);
        w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
        w.top = w.bottom = w.left = w.right = 0; w.alignMode = Widget.AlignMode.ALWAYS;
    }
    protected onDisable(): void {
        this.input?.blur(); this.targetInput?.blur();
        this.unscheduleAllCallbacks(); this.queued = false; this.layoutQueued = false;
    }
    protected onDestroy(): void {
        view.off('design-resolution-changed', this.queueLayout, this);
        view.off('canvas-resize', this.queueLayout, this);
        EventMgr.targetOff(this);
    }
}
