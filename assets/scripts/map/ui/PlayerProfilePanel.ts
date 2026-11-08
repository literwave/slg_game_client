import { _decorator, BlockInputEvents, Button, Canvas, Color, Component, Label, Node, SafeArea,
    Sprite, UITransform, Widget } from 'cc';
import OtherUserCommand from '../../login/OtherUserCommand';
import LoginCommand from '../../login/LoginCommand';
import { hasId, idKey } from '../../network/pto/ProtocolCommand';
import { LogicEvent as E } from '../../common/LogicEvent';
import { ServerConfig as S } from '../../config/ServerConfig';
import { EventMgr } from '../../utils/EventMgr';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';
import { gameCloseButton, taskWindowTrim } from './TaskBoardView';
import { rankTabIcon } from './RankBoardView';

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
        for (const [name, action] of [['Close', () => this.close()], ['Chat', () => this.chat()]] as const) {
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
        const self = this.isSelf;
        const width = Math.max(280, Math.min(420, safe.width - 24)), height = self ? 248 : 306;
        const top = height / 2;
        inkSurface(this.node, 'Scrim', root.width, root.height, new Color(0, 0, 0, 160), null);
        place(this.panel, 0, 0, width, height);
        const scale = Math.min(1, (safe.height - 24) / height, (safe.width - 24) / width);
        this.panel.setScale(scale, scale, 1);
        inkSurface(this.panel, 'Surface', width, height, C.ink, C.gold);
        caption(this.panel, 'Title', self ? '我的资料' : '主公资料', 0, top - 31, width - 124, 28, C.gold, Label.HorizontalAlign.CENTER);
        taskWindowTrim(this.panel, width, height, 136);
        gameCloseButton(this.panel.getChildByName('Close'), width / 2 - 30, height / 2 - 30);
        const cmd = OtherUserCommand.getInstance(), data = cmd.profiles.get(this.uid), pending = cmd.requestInFlight(`profile:${this.uid}`);
        const icon = this.panel.getChildByName('Portrait'), sprite = icon.getComponent(Sprite);
        const portraitX = -width / 2 + 62, portraitY = top - 100;
        const portraitFrame = inkSurface(this.panel, 'PortraitFrame', 78, 78, C.inset, C.line);
        portraitFrame.node.setPosition(portraitX, portraitY, 0);
        portraitFrame.node.setSiblingIndex(this.panel.children.indexOf(icon) - 1);
        place(icon, portraitX, portraitY, 72, 72);
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
        const nameWidth = width - 144;
        const name = caption(this.panel, 'Name', data?.name || '主公', 44, top - 87, nameWidth, 24, C.text);
        name.isBold = true; name.overflow = Label.Overflow.SHRINK;
        const level = this.panel.getChildByName('Level') || this.make('Level', this.panel);
        place(level, portraitX, portraitY - 34, 60, 22);
        inkSurface(level, 'Plate', 60, 22, C.inset, C.line);
        caption(level, 'Text', data ? `Lv.${data.level}` : '—', 0, 0, 56, 13, C.gold, Label.HorizontalAlign.CENTER);
        level.setSiblingIndex(this.panel.children.length - 1);
        const narrow = width < 360, idWidth = nameWidth - (narrow ? 0 : 60);
        const id = caption(this.panel, 'Uid', `ID ${this.uid}`, -width / 2 + 116 + idWidth / 2,
            top - 114, idWidth, 11, C.muted); id.overflow = Label.Overflow.SHRINK;
        const presence = data ? data.offlineTime === 0 ? '在线' : '离线' : '';
        const presenceLabel = caption(this.panel, 'Presence', presence, narrow ? 44 : width / 2 - 50,
            top - (narrow ? 136 : 114), narrow ? nameWidth : 44, 11,
            data?.offlineTime === 0 ? C.gold : C.muted);
        presenceLabel.overflow = Label.Overflow.SHRINK;
        const innerWidth = width - 48, powerWidth = (innerWidth - 12) * .6, cityWidth = innerWidth - 12 - powerWidth;
        for (const [key, iconIndex, value, x, span] of [
            ['Power', 0, data ? String(data.power) : '—', -innerWidth / 2 + powerWidth / 2, powerWidth],
            ['City', 1, data ? `Lv.${data.cityLevel}` : '—', innerWidth / 2 - cityWidth / 2, cityWidth],
        ] as const) {
            const stat = this.panel.getChildByName(key) || this.make(key, this.panel);
            place(stat, x, top - 178, span, 48); inkSurface(stat, 'Plate', span, 48, C.inset, null);
            rankTabIcon(stat, iconIndex, -span / 2 + 22, iconIndex === 0);
            const label = caption(stat, 'Value', value, 21, 0, span - 50, iconIndex === 0 ? 24 : 19,
                iconIndex === 0 ? C.gold : C.text);
            label.isBold = iconIndex === 0; label.overflow = Label.Overflow.SHRINK;
        }
        const status = !cmd.sessionReady ? '连接中…' : !data ? pending ? '加载中…'
            : cmd.isMissing(this.uid) ? '暂无资料' : cmd.hasFailed(this.uid) ? '加载失败' : '' : '';
        const alliance = this.panel.getChildByName('Alliance') || this.make('Alliance', this.panel);
        place(alliance, 0, top - 222, innerWidth, 32); alliance.active = !!data && !status;
        const seal = inkSurface(alliance, 'Seal', 24, 24, C.panel, C.line);
        seal.node.setPosition(-innerWidth / 2 + 22, 0, 0);
        caption(alliance, 'Symbol', '盟', -innerWidth / 2 + 22, 0, 22, 14, C.gold, Label.HorizontalAlign.CENTER);
        caption(alliance, 'Name', data?.allianceName || '无同盟', 21, 0, innerWidth - 50, 15,
            data?.allianceName ? C.text : C.muted).overflow = Label.Overflow.SHRINK;
        const statusLabel = caption(this.panel, 'Status', status, 0, top - 222, innerWidth, 13, C.muted, Label.HorizontalAlign.CENTER);
        statusLabel.node.active = !!status;
        const chat = this.panel.getChildByName('Chat');
        chat.active = !self;
        if (!self) panelButton(chat, '私聊', 0, -height / 2 + 32, Math.min(200, width - 48), 40, true);
        chat.getComponent(Button).interactable = !self && !!data && cmd.sessionReady;
    }
    private get isSelf(): boolean { return this.uid === idKey(LoginCommand.getInstance().proxy.getRoleData()?.userId); }
    private chat(): void {
        const cmd = OtherUserCommand.getInstance(), profile = cmd.profiles.get(this.uid);
        if (this.isSelf || !profile || !cmd.sessionReady) return;
        this.close(); EventMgr.emit(E.openPrivateChat, { id: profile.uid, name: profile.name, headIcon: profile.headIcon });
    }
    close(): void { this.node.active = false; }
    protected onDestroy(): void { EventMgr.targetOff(this); }
}
