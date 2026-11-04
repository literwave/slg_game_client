import { _decorator, BlockInputEvents, Button, Canvas, Color, Component, Label, Node, SafeArea,
    Sprite, UITransform, Widget } from 'cc';
import OtherUserCommand from '../../login/OtherUserCommand';
import LoginCommand from '../../login/LoginCommand';
import { hasId, idKey } from '../../network/pto/ProtocolCommand';
import { LogicEvent as E } from '../../common/LogicEvent';
import { ServerConfig as S } from '../../config/ServerConfig';
import { EventMgr } from '../../utils/EventMgr';
import DateUtil from '../../utils/DateUtil';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';
import { gameCloseButton, taskWindowTrim } from './TaskBoardView';

const { ccclass } = _decorator;
@ccclass('PlayerProfilePanel')
export default class PlayerProfilePanel extends Component {
    private safe: Node;
    private panel: Node;
    private uid = '';
    private avatarPath = '';
    private avatarLoading = '';
    show(uid: number | string): void {
        if (!hasId(uid)) return;
        if (!this.panel) this.build();
        this.uid = idKey(uid); this.node.active = true;
        this.node.getComponent(Widget).updateAlignment();
        this.safe.getComponent(Widget).updateAlignment(); this.safe.getComponent(SafeArea).updateArea();
        this.refresh();
    }
    private make(name: string, parent: Node): Node {
        const n = new Node(name); n.layer = parent.layer; parent.addChild(n); n.addComponent(UITransform); return n;
    }
    private stretch(node: Node): Widget {
        const w = node.addComponent(Widget);
        w.isAlignLeft = w.isAlignRight = w.isAlignTop = w.isAlignBottom = true;
        w.left = w.right = w.top = w.bottom = 0; w.alignMode = Widget.AlignMode.ALWAYS; return w;
    }
    private build(): void {
        this.node.addComponent(UITransform); const w = this.stretch(this.node);
        for (let p = this.node.parent; p; p = p.parent) if (p.getComponent(Canvas)) { w.target = p; break; }
        this.node.addComponent(BlockInputEvents);
        this.safe = this.make('SafeContent', this.node); this.stretch(this.safe); this.safe.addComponent(SafeArea);
        this.panel = this.make('Profile', this.safe);
        for (const [name, action] of [['Close', () => this.close()], ['Retry', () => this.refresh()], ['Chat', () => this.chat()]] as const) {
            const b = this.make(name, this.panel); b.addComponent(Button); b.on(Button.EventType.CLICK, action, this);
        }
        const portrait = this.make('Portrait', this.panel); portrait.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
        this.safe.on(Node.EventType.SIZE_CHANGED, this.render, this);
        EventMgr.on(E.otherUserUpdated, this.render, this);
        EventMgr.on(E.protocolRequestChanged, this.render, this);
        EventMgr.on(S.s2c_client_load_ok, this.refresh, this);
        EventMgr.on(E.enterLogin, this.close, this);
    }
    private refresh(): void {
        if (this.node.activeInHierarchy && this.uid) OtherUserCommand.getInstance().requestProfile(this.uid);
        this.render();
    }
    private render(): void {
        if (!this.panel || !this.node.activeInHierarchy) return;
        const safe = this.safe.getComponent(UITransform), root = this.node.getComponent(UITransform);
        if (safe.width <= 1 || safe.height <= 1) return;
        const width = Math.max(280, Math.min(510, safe.width - 24)), height = 392;
        inkSurface(this.node, 'Scrim', root.width, root.height, new Color(0, 0, 0, 160), null);
        place(this.panel, 0, 0, width, height);
        const scale = Math.min(1, (safe.height - 24) / height, (safe.width - 24) / width);
        this.panel.setScale(scale, scale, 1);
        inkSurface(this.panel, 'Surface', width, height, C.ink, C.gold); taskWindowTrim(this.panel, width, height);
        gameCloseButton(this.panel.getChildByName('Close'), width / 2 - 30, height / 2 - 30);
        const cmd = OtherUserCommand.getInstance(), data = cmd.profiles.get(this.uid), pending = cmd.requestInFlight(`profile:${this.uid}`);
        caption(this.panel, 'Title', '主公资料', 0, 164, width - 124, 23, C.gold, Label.HorizontalAlign.CENTER);
        const icon = this.panel.getChildByName('Portrait'), sprite = icon.getComponent(Sprite);
        place(icon, -width / 2 + 64, 91, 66, 66);
        const icons = LoginCommand.getInstance().headIcons, iconId = data ? icons.getDisplayId(data.headIcon) : 0;
        const path = data ? icons.getIconPath(iconId) : '';
        if (path !== this.avatarPath) {
            this.avatarPath = path; sprite.spriteFrame = null;
        }
        icon.active = !!sprite.spriteFrame;
        // 异步图片完成后只更新图片，不重新请求公开资料。
        if (path && !sprite.spriteFrame && this.avatarLoading !== path) {
            this.avatarLoading = path;
            void icons.loadIcon(iconId).then(frame => {
                if (this.avatarLoading === path) this.avatarLoading = '';
                if (sprite.isValid && this.avatarPath === path && frame) { sprite.spriteFrame = frame; icon.active = true; }
            }, () => { if (this.avatarLoading === path) this.avatarLoading = ''; });
        }
        const nameWidth = width - 140;
        const name = caption(this.panel, 'Name', data?.name || '主公', 48, 106, nameWidth, 23, C.text);
        name.isBold = true; name.overflow = Label.Overflow.SHRINK;
        const id = caption(this.panel, 'Uid', `ID ${this.uid}`, 48, 72, nameWidth, 12, C.muted); id.overflow = Label.Overflow.SHRINK;
        const presence = data ? data.offlineTime === 0 ? '在线'
            : data.offlineTime > 1 ? `离线 · ${DateUtil.converTimeStr(data.offlineTime * 1000, 'MM-DD hh:mm')}` : '离线' : '';
        const presenceLabel = caption(this.panel, 'Presence', presence, 48, 46, nameWidth, 12,
            data?.offlineTime === 0 ? C.gold : C.muted);
        presenceLabel.overflow = Label.Overflow.SHRINK;
        const stats = [['主公等级', data?.level], ['主城等级', data?.cityLevel], ['战力', data?.power], ['所属同盟', data ? data.allianceName || '暂无同盟' : undefined]];
        stats.forEach(([title, value], i) => {
            const x = (i % 2 ? 1 : -1) * width / 4, y = 15 - Math.floor(i / 2) * 64;
            caption(this.panel, `StatLabel${i}`, String(title), x, y, width / 2 - 32, 13, C.muted, Label.HorizontalAlign.CENTER);
            const label = caption(this.panel, `StatValue${i}`, value === undefined ? '—' : String(value), x, y - 24, width / 2 - 32, 20, C.text, Label.HorizontalAlign.CENTER);
            label.overflow = Label.Overflow.SHRINK;
        });
        const status = !cmd.sessionReady ? '连接恢复后可查看资料' : pending ? '正在更新资料…'
            : cmd.isMissing(this.uid) ? '该主公不存在或资料未开放' : cmd.hasFailed(this.uid) ? '暂未取得资料，可重试' : '';
        caption(this.panel, 'Status', status, 0, -119, width - 32, 12, C.muted, Label.HorizontalAlign.CENTER);
        const retry = this.panel.getChildByName('Retry'), chat = this.panel.getChildByName('Chat');
        panelButton(retry, '刷新', -width / 4, -158, width / 2 - 32, 38);
        retry.getComponent(Button).interactable = cmd.sessionReady && !pending;
        panelButton(chat, '私聊', width / 4, -158, width / 2 - 32, 38, true);
        chat.getComponent(Button).interactable = !!data && cmd.sessionReady && this.uid !== idKey(LoginCommand.getInstance().proxy.getRoleData()?.userId);
    }
    private chat(): void {
        const profile = OtherUserCommand.getInstance().profiles.get(this.uid); if (!profile) return;
        this.close(); EventMgr.emit(E.openPrivateChat, { id: profile.uid, name: profile.name, headIcon: profile.headIcon });
    }
    close(): void { this.node.active = false; }
    protected onDestroy(): void { EventMgr.targetOff(this); }
}
