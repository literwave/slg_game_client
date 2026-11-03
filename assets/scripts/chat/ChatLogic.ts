import { _decorator, BlockInputEvents, Button, Canvas, Color, Component, EditBox, Label, Mask, Node,
    SafeArea, ScrollView, Sprite, UITransform, Widget, view } from 'cc';
import ChatCommand from './ChatCommand';
import { ChatMsg, ChatPeer } from './ChatProxy';
import { CHAT_CHANNELS, CHAT_MAX_LENGTH, chatPanelLayout, chatTime, shortChatText, validChatTarget } from './ChatPresentation';
import LoginCommand from '../login/LoginCommand';
import UnionCommand from '../union/UnionCommand';
import { idKey } from '../network/pto/ProtocolCommand';
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent as E } from '../common/LogicEvent';
import { caption, inkSurface, ManagementColors as C, panelButton, place, textStyle } from '../map/ui/ManagementStyle';
import { chatAction, chatChannelTab, chatEmptyArt, chatFrame, chatUnread } from './ChatView';

const { ccclass } = _decorator;

@ccclass('ChatLogic')
export default class ChatLogic extends Component {
    private safe: Node;
    private panel: Node;
    private tabs: Node[] = [];
    private status: Label;
    private privateBar: Node;
    private peerSearch: EditBox;
    private peerTitle: Label;
    private peerAvatar: Node;
    private avatarKey = '';
    private emptyIcon: Node;
    private emptyTitle: Label;
    private emptyAlliance: Node;
    private emptyWorld: Node;
    private emptyRank: Node;
    private listHint: Label;
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
    private findingPeer = false;
    private drafts = new Map<string, string>();
    private rowSignature = '';
    private followLatest = true;
    private layouting = false;
    private rendering = false;
    private queued = false;
    private preparing = false;
    private layoutQueued = false;
    private pendingOwnScroll = false;
    private allianceLocked = false;
    private metrics = chatPanelLayout(1280, 720);

    /** 提前构建首开界面；不会切频道、发送消息或请求战报。 */
    public prepareView(): void {
        this.preparing = true;
        if (!this.panel) this.build();
        this.node.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment();
        this.safe.getComponent(SafeArea).updateArea();
        this.layout();
    }

    public show(channel = 1, targetId = '0', name = ''): void {
        this.preparing = false;
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
        this.button(this.privateBar, 'Back', () => this.switchChannel(3));
        this.button(this.privateBar, 'NewChat', () => this.findPlayers());
        this.peerTitle = caption(this.privateBar, 'PeerTitle', '最近会话', 0, 0, 250, 18, C.text);
        this.peerAvatar = this.make('PeerAvatar', this.privateBar);
        this.peerSearch = this.edit(this.privateBar, 'ContactSearch', '搜索最近遇见的玩家昵称', 30);
        this.peerSearch.node.on(EditBox.EventType.TEXT_CHANGED, () => { this.scroll.scrollToTop(0); this.queueRefresh(); }, this);
        this.scroll = this.make('Messages', this.panel).addComponent(ScrollView);
        this.scroll.horizontal = false; this.scroll.vertical = true; this.scroll.elastic = false;
        this.scroll.cancelInnerEvents = true;
        this.viewport = this.make('Viewport', this.scroll.node); this.stretch(this.viewport);
        this.viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.content = this.make('Content', this.viewport); this.content.getComponent(UITransform).setAnchorPoint(.5, 1);
        this.scroll.content = this.content;
        this.scroll.node.on(ScrollView.EventType.SCROLLING, this.onScroll, this);
        this.empty = caption(this.scroll.node, 'Empty', '', 0, 0, 350, 16, C.muted, Label.HorizontalAlign.CENTER);
        this.empty.enableWrapText = true; this.empty.lineHeight = 26;
        this.emptyIcon = this.make('Letter', this.scroll.node);
        this.emptyTitle = caption(this.scroll.node, 'EmptyTitle', '', 0, 0, 350, 24, C.gold, Label.HorizontalAlign.CENTER);
        this.emptyTitle.isBold = true;
        this.emptyAlliance = this.button(this.scroll.node, 'FindAlliance', () => this.findAlliance());
        this.emptyWorld = this.button(this.scroll.node, 'GoWorld', () => this.switchChannel(1));
        this.emptyRank = this.button(this.scroll.node, 'FindInRank', () => { this.close(); EventMgr.emit(E.openChatPlayerRank); });
        this.listHint = caption(this.panel, 'ListHint', '点选头像 · 发起私聊', 0, 0, 400, 12, C.muted, Label.HorizontalAlign.CENTER);
        this.latest = this.button(this.panel, 'NewMessages', () => { this.followLatest = true; this.scroll.scrollToBottom(.15); this.markRead(); });
        this.composer = this.make('Composer', this.panel);
        this.input = this.edit(this.composer, 'MessageInput', '与诸位主公聊聊…', CHAT_MAX_LENGTH);
        this.input.returnType = EditBox.KeyboardReturnType.SEND;
        this.input.node.on(EditBox.EventType.EDITING_RETURN, this.sendMessage, this);
        this.input.node.on(EditBox.EventType.TEXT_CHANGED, this.inputChanged, this);
        this.send = this.button(this.composer, 'Send', () => this.sendMessage());
        this.counter = caption(this.composer, 'Count', '', 0, 0, 180, 12, C.muted, Label.HorizontalAlign.RIGHT);
        this.node.on(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.queueLayout, this);
        view.on('design-resolution-changed', this.queueLayout, this);
        view.on('canvas-resize', this.queueLayout, this);
        EventMgr.on(E.updateChatHistory, this.queueRefresh, this);
        EventMgr.on(E.chatReadChanged, this.queueRefresh, this);
        EventMgr.on(E.protocolRequestChanged, this.queueRefresh, this);
        EventMgr.on(E.unionChange, this.queueLayout, this);
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
        this.allianceLocked = this.channel === 2 && !UnionCommand.getInstance().proxy.isMeInUnion();
        if (this.allianceLocked) this.metrics.height = Math.min(620, this.metrics.height);
        const { width: w, height: h, x, scale } = this.metrics, top = h / 2;
        place(this.node.getChildByName('DismissArea'), 0, 0, root.width, root.height);
        inkSurface(this.node.getChildByName('DismissArea'), 'Shade', root.width, root.height, new Color(9, 16, 12, 112), null);
        place(this.panel, x, 0, w, h);
        chatFrame(this.panel, w, h);
        place(this.status.node, 0, top - 143, w - 140, 22);
        this.status.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.status.overflow = Label.Overflow.SHRINK;
        panelButton(this.retry, '重试', w / 2 - 52, top - 143, 64, 24);
        this.tabs.forEach((node, i) => chatChannelTab(node, CHAT_CHANNELS[i], i, i + 1 === this.channel,
            (i - 1) * ((w - 40) / 3 + 3), top - 94, (w - 52) / 3));
        this.privateBar.active = this.channel === 3;
        place(this.privateBar, 0, top - 177, w - 40, 40);
        const list = this.channel === 3 && this.choosingPeer, back = this.privateBar.getChildByName('Back');
        back.active = !list || this.findingPeer;
        panelButton(back, '‹', -w / 2 + 36, 0, 40, 38);
        const newChat = this.privateBar.getChildByName('NewChat'); newChat.active = !this.findingPeer;
        const newWidth = list ? 116 : 40;
        panelButton(newChat, list ? '＋ 发起私聊' : '＋', w / 2 - 16 - newWidth / 2, 0, newWidth, 36, true);
        this.peerAvatar.active = !list;
        place(this.peerAvatar, -w / 2 + 83, 0, 36, 36);
        const titleLeft = list ? (this.findingPeer ? 66 : 18) : 110;
        const titleWidth = Math.max(40, w - titleLeft - (this.findingPeer ? 24 : list ? 144 : 76));
        textStyle(this.peerTitle, -w / 2 + titleLeft + titleWidth / 2, 0, titleWidth, 18, C.text);
        this.peerSearch.node.active = list && this.findingPeer;
        this.placeEdit(this.peerSearch, 0, -48, w - 40, 36);
        const bodyTop = top - (this.channel === 3 ? (this.findingPeer ? 252 : 206) : 160);
        const bodyBottom = -top + (this.allianceLocked ? 20 : list ? 44 : 96);
        const bodyHeight = Math.max(60, bodyTop - bodyBottom);
        place(this.scroll.node, 0, (bodyTop + bodyBottom) / 2, w - 32, bodyHeight);
        this.viewport.getComponent(Widget).updateAlignment();
        this.listHint.node.active = list;
        place(this.listHint.node, 0, -top + 22, w - 40, 26);
        panelButton(this.latest, '新消息  ↓', 0, bodyBottom + 24, 142, 34, true);
        this.composer.active = !list && !this.allianceLocked;
        place(this.composer, 0, -top + 49, w - 40, 74);
        inkSurface(this.composer, 'Surface', w - 40, 74, C.inset, C.line);
        this.placeEdit(this.input, -42, 8, w - 142, 42);
        chatAction(this.send, '发送', w / 2 - 64, 8, 72);
        place(this.counter.node, w / 2 - 70, -25, 88, 18);
        this.rowSignature = '';
        this.refresh(); this.panel.setScale(scale, scale, 1);
        this.layouting = false;
    }

    private switchChannel(channel: number, targetId?: string, name = ''): void {
        this.saveDraft();
        this.input.blur(); this.peerSearch?.blur();
        this.channel = [1, 2, 3].indexOf(channel) >= 0 ? channel : 1;
        this.findingPeer = false;
        if (this.channel === 3) {
            this.choosingPeer = !validChatTarget(targetId)
                || idKey(targetId) === idKey(LoginCommand.getInstance().proxy.getRoleData()?.userId);
            if (!this.choosingPeer) {
                this.targetId = idKey(targetId);
                ChatCommand.getInstance().proxy.rememberPeer(targetId, name);
                this.peerName = ChatCommand.getInstance().proxy.conversations().find(p => p.id === this.targetId)?.name || '主公';
            }
        } else this.choosingPeer = false;
        this.input.string = this.choosingPeer ? '' : this.drafts.get(this.key()) || '';
        this.followLatest = !this.choosingPeer; this.pendingOwnScroll = false;
        this.layout();
        if (this.choosingPeer) this.scroll.scrollToTop(0);
        if (!this.choosingPeer) ChatCommand.getInstance().chatHistory(this.channel - 1, this.targetId);
        this.refresh();
    }

    private chooseTarget(peer: ChatPeer): void {
        if (!validChatTarget(peer.id) || idKey(peer.id) === idKey(LoginCommand.getInstance().proxy.getRoleData()?.userId)) return;
        ChatCommand.getInstance().proxy.rememberPeer(peer.id, peer.name, peer.headIcon);
        this.switchChannel(3, peer.id, peer.name);
    }

    private findPlayers(): void {
        this.saveDraft(); this.choosingPeer = true; this.findingPeer = true;
        this.peerSearch.string = ''; this.input.string = ''; this.followLatest = false;
        this.layout();
        this.scroll.scrollToTop(0);
        const cmd = ChatCommand.getInstance();
        if (!cmd.proxy.getHistory(1).length && cmd.sessionReady) cmd.chatHistory(0);
    }

    private queueRefresh(): void {
        if (!this.node.activeInHierarchy || this.queued) return;
        this.queued = true;
        this.scheduleOnce(() => { this.queued = false; if (this.isValid && this.node.activeInHierarchy) this.refresh(); }, 0);
    }

    private refresh(): void {
        if (!this.panel || this.rendering) return;
        // 联盟加入/退出可能在消息刷新前到达；立即重排并保留各频道草稿。
        const nextLocked = this.channel === 2 && !UnionCommand.getInstance().proxy.isMeInUnion();
        if (nextLocked !== this.allianceLocked && !this.layouting) { this.layout(); return; }
        this.rendering = true;
        const cmd = ChatCommand.getInstance(), inUnion = UnionCommand.getInstance().proxy.isMeInUnion();
        const locked = this.channel === 2 && !inUnion, loading = !this.choosingPeer && cmd.requestInFlight(this.key());
        const failed = !this.choosingPeer && cmd.historyFailed(this.channel, this.targetId);
        const myId = LoginCommand.getInstance().proxy.getRoleData()?.userId;
        const peers = this.choosingPeer ? (this.findingPeer
            ? cmd.proxy.contacts(myId, UnionCommand.getInstance().proxy.getMemberList?.() || [])
                .filter(p => p.name.toLocaleLowerCase().includes(this.peerSearch.string.trim().toLocaleLowerCase()))
            : cmd.proxy.conversations()).filter(p => p.id !== idKey(myId)) : [];
        this.status.string = !cmd.sessionReady ? '连接已断开' : !locked && loading ? '正在读取消息…'
            : !locked && failed ? '消息读取失败' : '';
        this.status.node.active = !!this.status.string;
        this.peerTitle.string = this.choosingPeer ? this.findingPeer ? '选择聊天对象' : '最近会话' : this.peerName;
        if (this.channel === 3 && !this.choosingPeer) {
            const peer = cmd.proxy.conversations().find(p => p.id === this.targetId);
            if (peer) {
                this.peerTitle.string = peer.name;
                const key = JSON.stringify(peer);
                if (key !== this.avatarKey) { this.avatarKey = key; this.clear(this.peerAvatar); this.drawAvatar(this.peerAvatar, peer, 36); }
            }
        }
        this.retry.active = failed && !loading && cmd.sessionReady && !locked && !this.choosingPeer;
        this.tabs.forEach((tab, index) => chatUnread(tab, cmd.proxy.unreadCount(index + 1)));
        const rows = locked || this.choosingPeer ? [] : cmd.proxy.getHistory(this.channel, this.targetId);
        const previews = peers.map(peer => ({ peer, last: cmd.proxy.getHistory(3, peer.id).slice(-1)[0],
            unread: cmd.proxy.unreadCount(3, peer.id), draft: this.drafts.get(cmd.proxy.key(3, peer.id)) || '' }));
        const signature = this.key() + ':' + this.choosingPeer + ':' + this.findingPeer + ':' + JSON.stringify(this.choosingPeer ? previews : rows);
        if (signature !== this.rowSignature) {
            const previousOffset = this.scroll.getScrollOffset().y;
            const previousTop = this.content.children.find(n => n.name.startsWith('Msg_')
                && n.position.y + previousOffset - n.getComponent(UITransform).height <= 0);
            const anchor = previousTop && { name: previousTop.name, screenY: previousTop.position.y + previousOffset };
            this.rowSignature = signature; this.scroll.stopAutoScroll(); this.clear(this.content);
            const w = this.scroll.node.getComponent(UITransform).width, h = this.scroll.node.getComponent(UITransform).height;
            let used = 8;
            if (this.choosingPeer) {
                previews.forEach(({ peer, last, unread, draft }) => {
                    const row = this.button(this.content, 'Peer_' + peer.id, () => this.chooseTarget(peer));
                    place(row, 0, -used - 42, w - 8, 80);
                    inkSurface(row, 'Surface', w - 8, 80, C.panel, new Color(153, 134, 91, 48));
                    const avatar = this.make('Avatar', row); place(avatar, -w / 2 + 38, 0, 48, 48);
                    this.drawAvatar(avatar, peer, 48);
                    const nameWidth = Math.max(40, w - 174), left = -w / 2 + 76;
                    caption(row, 'Name', shortChatText(peer.name, Math.floor(nameWidth / 17)), left + nameWidth / 2, 16, nameWidth, 17, C.text);
                    caption(row, 'Time', this.findingPeer ? '私聊  ›' : chatTime(last?.time), w / 2 - 55, 16, 86, 12, C.muted, Label.HorizontalAlign.RIGHT);
                    const preview = this.findingPeer ? ('source' in peer ? String(peer.source) : '最近会话')
                        : draft ? '[草稿] ' + draft : last ? (idKey(last.rid) === idKey(myId) ? '我：' : '') + last.msg : '点击开始聊天';
                    const previewWidth = w - 128;
                    caption(row, 'Last', shortChatText(preview, Math.floor(previewWidth / 13)), left + previewWidth / 2, -14,
                        previewWidth, 13, draft && !this.findingPeer ? C.gold : C.muted);
                    if (unread && !this.findingPeer) {
                        const badge = this.make('Unread', row); place(badge, w / 2 - 27, -14, 30, 22);
                        inkSurface(badge, 'Surface', 30, 22, new Color(135, 65, 48, 255), null);
                        caption(badge, 'Count', unread > 99 ? '99+' : String(unread), 0, 0, 30, 12, C.text, Label.HorizontalAlign.CENTER);
                    }
                    used += 88;
                });
            } else rows.forEach(msg => { used += this.message(msg, used, w) + 14; });
            const contentHeight = Math.max(h, used + 8);
            this.content.getComponent(UITransform).setContentSize(w, contentHeight);
            const anchorNode = anchor && this.content.getChildByName(anchor.name);
            const offset = this.choosingPeer ? previousOffset : this.followLatest || this.pendingOwnScroll ? contentHeight - h
                : anchorNode ? anchor.screenY - anchorNode.position.y : previousOffset;
            this.content.setPosition(0, h / 2 + Math.max(0, Math.min(offset, contentHeight - h)), 0);
            if (this.pendingOwnScroll) { this.followLatest = true; this.pendingOwnScroll = false; }
        }
        this.empty.node.active = this.choosingPeer ? !peers.length : !rows.length;
        this.emptyTitle.string = locked ? '同盟聚义' : this.choosingPeer ? this.findingPeer ? '寻访同袍' : '尺素传情'
            : this.channel === 1 ? '天下同袍' : this.channel === 2 ? '共议军情' : '尺素传情';
        this.empty.string = locked ? '加入联盟，与盟友共议军情' : this.choosingPeer ? this.findingPeer
            ? (this.peerSearch.string.trim() ? '未找到这位主公' : '先去世界频道结识同袍') : '选一位主公，聊聊山河战事'
            : loading ? '正在读取消息…' : failed ? '暂时未能读取消息' : '发出第一声问候吧';
        const emptyList = this.choosingPeer && !peers.length;
        this.layoutEmpty(locked, emptyList);
        const canType = cmd.sessionReady && !locked && !this.choosingPeer;
        this.input.enabled = canType;
        this.input.placeholder = !cmd.sessionReady ? '连接已断开' : locked ? '加入联盟后可发言'
            : this.choosingPeer ? '请先选择聊天对象' : this.channel === 3 ? '发送私聊消息…' : '与诸位主公聊聊…';
        this.updateSend();
        if (!this.choosingPeer && this.followLatest) this.markRead();
        this.latest.active = !this.choosingPeer && !this.followLatest && cmd.proxy.unreadCount(this.channel, this.targetId) > 0;
        this.rendering = false;
    }

    private layoutEmpty(locked: boolean, emptyList: boolean): void {
        const { width, height } = this.scroll.node.getComponent(UITransform);
        const visible = this.empty.node.active, hasAction = (locked || emptyList) && height >= 88, compact = height < 210;
        const artHeight = compact ? 0 : Math.min(this.channel === 2 ? 252 : 180, height - (hasAction ? 156 : 104));
        const total = artHeight + (artHeight ? 16 : 0) + (compact ? 26 : 60) + (hasAction ? 60 : 0);
        const titleY = total / 2 - artHeight - (artHeight ? 16 : 0) - 14;
        this.emptyTitle.node.active = visible && !compact;
        place(this.emptyTitle.node, 0, titleY, width - 32, 34);
        const descY = compact ? total / 2 - 13 : titleY - 32;
        textStyle(this.empty, 0, descY, width - 32, compact ? 13 : 14, C.muted, Label.HorizontalAlign.CENTER, 26);
        this.emptyIcon.active = visible && artHeight > 0;
        if (this.emptyIcon.active) {
            const artWidth = Math.min(width - 110, artHeight * (this.channel === 2 ? .744 : 1.25));
            place(this.emptyIcon, 0, total / 2 - artHeight / 2, artWidth, artHeight);
            chatEmptyArt(this.emptyIcon, this.channel, artWidth, artHeight);
        }
        const actionY = descY - 47, actionWidth = Math.min(148, (width - 26) / 2);
        this.emptyWorld.active = this.emptyRank.active = emptyList && hasAction;
        this.emptyAlliance.active = locked && hasAction;
        chatAction(this.emptyAlliance, '寻找联盟', 0, actionY, Math.min(196, width - 48));
        chatAction(this.emptyWorld, '世界频道', -(actionWidth + 12) / 2, actionY, actionWidth);
        chatAction(this.emptyRank, '寻访主公', (actionWidth + 12) / 2, actionY, actionWidth, false);
        this.listHint.node.active = this.choosingPeer && !emptyList;
    }

    private findAlliance(): void {
        this.close();
        EventMgr.emit(E.openChatAlliance);
    }

    private drawAvatar(node: Node, peer: ChatPeer, size: number): void {
        inkSurface(node, 'Frame', size, size, C.inset, C.line);
        const initial = caption(node, 'Initial', Array.from(peer.name || '将')[0], 0, 0, size - 4, 22, C.gold, Label.HorizontalAlign.CENTER);
        const icon = this.make('Icon', node); place(icon, 0, 0, size - 4, size - 4);
        const sprite = icon.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const icons = LoginCommand.getInstance().headIcons, iconId = icons.getDisplayId(peer.headIcon);
        sprite.spriteFrame = icons.getIcon(iconId);
        if (sprite.spriteFrame) initial.node.active = false;
        else icons.loadIcon(iconId).then(frame => { if (sprite.isValid && frame) { sprite.spriteFrame = frame; initial.node.active = false; } });
    }

    private message(msg: ChatMsg, top: number, width: number): number {
        const own = idKey(msg.rid) === idKey(LoginCommand.getInstance().proxy.getRoleData()?.userId);
        const row = this.make('Msg_' + idKey(msg.msgId), this.content);
        const avatar = this.button(row, 'Avatar', () => {
            if (!own && validChatTarget(msg.rid)) this.chooseTarget({ id: idKey(msg.rid), name: msg.nick_name, headIcon: msg.headIcon });
        });
        // 头像与气泡共用顶部基线，昵称和时间单独占一行。
        const avatarSize = 40, bubbleTop = 24, edge = width / 2 - 58;
        const x = own ? width / 2 - 28 : -width / 2 + 28;
        place(avatar, x, -bubbleTop - avatarSize / 2, avatarSize, avatarSize);
        inkSurface(avatar, 'Frame', avatarSize, avatarSize, C.panel, C.line);
        const fallback = caption(avatar, 'Initial', (msg.nick_name || '将').slice(0, 1), 0, 0, 38, 22, C.gold, Label.HorizontalAlign.CENTER);
        const iconNode = this.make('Icon', avatar); place(iconNode, 0, 0, 38, 38);
        const sprite = iconNode.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const icons = LoginCommand.getInstance().headIcons, iconId = icons.getDisplayId(msg.headIcon);
        sprite.spriteFrame = icons.getIcon(iconId);
        if (sprite.spriteFrame) fallback.node.active = false;
        else icons.loadIcon(iconId).then(frame => { if (sprite.isValid && frame) { sprite.spriteFrame = frame; fallback.node.active = false; } });
        const maxWidth = Math.floor(Math.max(80, Math.min(width - 116, width * .76)));
        const nameX = own ? edge - maxWidth / 2 : -edge + maxWidth / 2;
        const sender = caption(row, 'Sender', shortChatText((own ? '我' : msg.nick_name || '主公') + '  ·  ' + chatTime(msg.time), Math.floor(maxWidth / 12)),
            nameX, -9, maxWidth, 12, C.muted, own ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.LEFT);
        sender.node.getComponent(UITransform).height = 18;
        sender.lineHeight = 18;
        const bubble = this.make('Bubble', row);
        const text = caption(bubble, 'Message', msg.msg, 0, 0, maxWidth - 24, 16, C.text);
        text.overflow = Label.Overflow.NONE; text.enableWrapText = false; text.updateRenderData(true);
        const bubbleWidth = Math.min(maxWidth, Math.max(44, Math.ceil(text.node.getComponent(UITransform).width) + 24));
        const bubbleX = own ? edge - bubbleWidth / 2 : -edge + bubbleWidth / 2;
        text.node.getComponent(UITransform).width = bubbleWidth - 24;
        text.enableWrapText = true; text.lineHeight = 22; text.overflow = Label.Overflow.RESIZE_HEIGHT;
        text.updateRenderData(true);
        const height = Math.max(40, Math.ceil(text.node.getComponent(UITransform).height) + 12);
        place(bubble, bubbleX, -bubbleTop - height / 2, bubbleWidth, height);
        const surface = inkSurface(bubble, 'Surface', bubbleWidth, height,
            own ? new Color(73, 65, 43, 255) : new Color(47, 55, 46, 255), null);
        const side = own ? 1 : -1, tipX = side * bubbleWidth / 2, tipY = height / 2 - 15;
        surface.moveTo(tipX, tipY + 5); surface.lineTo(tipX + side * 5, tipY);
        surface.lineTo(tipX, tipY - 5); surface.close(); surface.fill();
        const rowHeight = bubbleTop + Math.max(avatarSize, height);
        place(row, 0, -top, width, rowHeight);
        row.getComponent(UITransform).setAnchorPoint(.5, 1);
        return rowHeight;
    }

    private onScroll(): void {
        if (this.rendering || this.layouting) return;
        const max = this.scroll.getMaxScrollOffset().y;
        this.followLatest = max - this.scroll.getScrollOffset().y <= 24;
        if (this.followLatest && !this.choosingPeer) this.markRead();
        this.latest.active = !this.choosingPeer && !this.followLatest && ChatCommand.getInstance().proxy.unreadCount(this.channel, this.targetId) > 0;
    }
    private markRead(): void {
        if (!this.preparing && this.node.activeInHierarchy) ChatCommand.getInstance().markRead(this.channel, this.targetId);
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
        if (result.success && !this.choosingPeer && this.key() === key) {
            if (this.input.string.trim() === result.content) this.input.string = '';
            this.pendingOwnScroll = true;
        }
        this.queueRefresh();
    }
    private key(): string { return ChatCommand.getInstance().proxy.key(this.channel, this.targetId); }
    private saveDraft(): void { if (this.input && !this.choosingPeer) this.drafts.set(this.key(), this.input.string); }
    private onLogout(): void { this.drafts.clear(); if (this.input) this.input.string = ''; this.targetId = '0'; this.peerName = ''; this.close(); this.drafts.clear(); }
    public close(): void { this.saveDraft(); this.input?.blur(); this.peerSearch?.blur(); this.node.active = false; }
    private edit(parent: Node, name: string, placeholder: string, maxLength: number): EditBox {
        const node = this.make(name, parent);
        // __preload 根据 inputMode 创建原生控件；激活后再设 SINGLE_LINE 会残留 textarea 和滚动条。
        node.active = false;
        const edit = node.addComponent(EditBox);
        const text = edit.textLabel || caption(node, 'Text', '', 0, 0, 200, 16, C.text);
        const hint = edit.placeholderLabel || caption(node, 'Placeholder', placeholder, 0, 0, 200, 14, C.muted);
        text.node.layer = hint.node.layer = node.layer;
        edit.textLabel = text; edit.placeholderLabel = hint;
        edit.inputMode = EditBox.InputMode.SINGLE_LINE; edit.inputFlag = EditBox.InputFlag.DEFAULT;
        edit.maxLength = maxLength; edit.string = ''; edit.placeholder = placeholder;
        node.active = true;
        return edit;
    }
    private placeEdit(edit: EditBox, x: number, y: number, w: number, h: number): void {
        // 背景比可编辑区域宽 20px，聚焦时的原生光标也保留相同内边距。
        const innerWidth = Math.max(1, w - 20);
        place(edit.node, x, y, innerWidth, h); inkSurface(edit.node, 'Surface', w, h, new Color(17, 24, 19, 255), C.line);
        textStyle(edit.textLabel, 2, 0, innerWidth, 16, C.text, Label.HorizontalAlign.LEFT, h - 4);
        textStyle(edit.placeholderLabel, 2, 0, innerWidth, 14, C.muted, Label.HorizontalAlign.LEFT, h - 4);
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
        this.input?.blur(); this.peerSearch?.blur();
        this.unscheduleAllCallbacks(); this.queued = false; this.layoutQueued = false;
    }
    protected onDestroy(): void {
        view.off('design-resolution-changed', this.queueLayout, this);
        view.off('canvas-resize', this.queueLayout, this);
        EventMgr.targetOff(this);
    }
}
