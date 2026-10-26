import { _decorator, BlockInputEvents, Button, Color, Component, Label, Mask, Node, SafeArea,
    ScrollView, Sprite, SpriteFrame, UITransform, Widget, resources } from 'cc';
import ProgressionCommand from '../../progression/ProgressionCommand';
import { rewardName, rewardPreview, RewardPreview, taskPresentation } from '../../progression/ProgressionPresentation';
import { itemIconPath } from '../../common/ItemPresentation';
import MailCommand from '../../mail/MailCommand';
import RankCommand from '../../rank/RankCommand';
import { ServerConfig as S } from '../../config/ServerConfig';
import { LogicEvent as E } from '../../common/LogicEvent';
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import DateUtil from '../../utils/DateUtil';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';

const { ccclass } = _decorator;
export type ServiceSection = 'tasks' | 'mail' | 'rank';
const SECTIONS: Array<[ServiceSection, string]> = [['tasks', '任务'], ['mail', '邮件'], ['rank', '排行']];
const PAGE_SIZE = 20;

/** 主线/日周常、邮箱与排行榜使用真实协议快照，不在本地推算达成或发奖。 */
@ccclass('PlayerServicesPanel')
export default class PlayerServicesPanel extends Component {
    private safe: Node;
    private panel: Node;
    private tabs: Node;
    private filters: Node;
    private footer: Node;
    private scroll: ScrollView;
    private viewport: Node;
    private content: Node;
    private title: Label;
    private section: ServiceSection = 'tasks';
    private taskType = 1;
    private mailKind = 1;
    private rankType = 1;
    private page = 0;
    private mailUid = '';
    private confirmDelete = false;
    private width = 760;
    private height = 600;
    private rowWidth = 700;
    private contentHeight = 0;
    private refreshQueued = false;

    public show(section: ServiceSection): void {
        if (!this.panel) this.build();
        this.section = section;
        this.mailUid = ''; this.confirmDelete = false; this.page = 0;
        this.node.active = true;
        this.safe.getComponent(SafeArea).updateArea();
        this.layout();
        this.refreshFromServer();
    }

    private build(): void {
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        this.stretch(this.node);
        this.node.addComponent(BlockInputEvents);
        this.safe = this.make('SafeContent', this.node, 1, 1);
        this.stretch(this.safe); this.safe.addComponent(SafeArea);
        this.panel = this.make('Panel', this.safe, 760, 600);
        this.title = caption(this.panel, 'Title', '军务', 0, 0, 400, 26, C.text, Label.HorizontalAlign.CENTER);
        this.button(this.panel, 'Close', '关闭', 0, 0, 64, () => this.close());
        this.tabs = this.make('Sections', this.panel, 1, 44);
        this.filters = this.make('Filters', this.panel, 1, 44);
        this.footer = this.make('Footer', this.panel, 1, 44);
        const scrollNode = this.make('Scroll', this.panel, 700, 360);
        this.scroll = scrollNode.addComponent(ScrollView);
        this.scroll.horizontal = false; this.scroll.vertical = true;
        this.scroll.cancelInnerEvents = true; this.scroll.elastic = true;
        this.viewport = this.make('Viewport', scrollNode, 700, 360);
        this.stretch(this.viewport); this.viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.content = this.make('Content', this.viewport, 700, 360);
        this.content.getComponent(UITransform).setAnchorPoint(.5, 1);
        this.scroll.content = this.content;
        this.node.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        this.safe.on(Node.EventType.SIZE_CHANGED, this.layout, this);
        for (const event of [E.updateTasks, E.updateMailList, E.updateMailDetail, E.updateRank,
            E.protocolRequestChanged, E.upateMyRoleRes]) EventMgr.on(event, this.queueRefresh, this);
        EventMgr.on(E.enterLogin, this.close, this);
    }

    private layout(): void {
        if (!this.panel) return;
        const root = this.node.getComponent(UITransform), safe = this.safe.getComponent(UITransform);
        if (safe.width <= 1 || safe.height <= 1) return;
        inkSurface(this.node, 'Scrim', root.width, root.height, new Color(0, 0, 0, 175), null);
        this.width = Math.min(920, Math.max(280, safe.width - 24));
        this.height = Math.min(660, Math.max(320, safe.height - 24));
        place(this.panel, 0, 0, this.width, this.height);
        inkSurface(this.panel, 'Background', this.width, this.height, C.ink, C.gold);
        place(this.title.node, 0, this.height / 2 - 32, this.width - 180, 40);
        place(this.panel.getChildByName('Close'), this.width / 2 - 46, this.height / 2 - 32, 64, 44);
        place(this.tabs, 0, this.height / 2 - 84, this.width - 32, 44);
        place(this.filters, 0, this.height / 2 - 136, this.width - 32, 44);
        this.rowWidth = this.width - 32;
        const viewHeight = this.height - 226;
        place(this.scroll.node, 0, -26, this.rowWidth, viewHeight);
        this.viewport.getComponent(Widget).updateAlignment();
        place(this.footer, 0, -this.height / 2 + 32, this.rowWidth, 44);
        this.render(true);
    }

    private queueRefresh(): void {
        if (!this.node.activeInHierarchy || this.refreshQueued) return;
        this.refreshQueued = true;
        this.scheduleOnce(() => { this.refreshQueued = false; if (this.isValid) this.render(); }, 0);
    }

    private refreshFromServer(): void {
        if (this.section === 'tasks') ProgressionCommand.getInstance().requestTasks();
        if (this.section === 'mail') {
            if (this.mailUid) MailCommand.getInstance().requestDetail(this.mailKind, this.mailUid);
            else MailCommand.getInstance().requestList(this.mailKind);
        }
        if (this.section === 'rank') RankCommand.getInstance().requestRank(this.rankType, this.page * PAGE_SIZE + 1, PAGE_SIZE);
        this.render();
    }

    private render(resetScroll = false): void {
        if (!this.panel || !this.node.activeInHierarchy) return;
        const offset = resetScroll ? 0 : this.scroll.getScrollOffset().y;
        this.scroll.stopAutoScroll();
        for (const node of [this.tabs, this.filters, this.content, this.footer]) this.clear(node);
        this.contentHeight = 0;
        this.title.string = SECTIONS.find(([key]) => key === this.section)[1];
        const tabWidth = (this.width - 32 - (SECTIONS.length - 1) * 4) / SECTIONS.length;
        SECTIONS.forEach(([key, name], i) => this.button(this.tabs, key, name, (i - (SECTIONS.length - 1) / 2) * (tabWidth + 4), 0, tabWidth,
            () => { this.section = key; this.page = 0; this.mailUid = ''; this.confirmDelete = false;
                this.refreshFromServer(); this.render(true); }, true, this.section === key));
        if (this.section === 'tasks') this.renderTasks();
        if (this.section === 'mail') this.renderMail();
        if (this.section === 'rank') this.renderRank();
        const viewHeight = this.scroll.node.getComponent(UITransform).height;
        this.content.getComponent(UITransform).setContentSize(this.rowWidth, Math.max(viewHeight, this.contentHeight));
        this.content.setPosition(0, viewHeight / 2 + Math.min(Math.max(0, offset), Math.max(0, this.contentHeight - viewHeight)), 0);
    }

    private renderTasks(): void {
        const cmd = ProgressionCommand.getInstance();
        this.subTabs(['主线', '日常', '周常'], this.taskType - 1, index => { this.taskType = index + 1; this.render(true); });
        const tasks = cmd.getTasks(this.taskType).sort((a, b) => {
            const priority = (state: number) => state === 1 ? 0 : state === 0 ? 1 : 2;
            return priority(a.state) - priority(b.state) || taskPresentation(a).order - taskPresentation(b).order;
        });
        const pending = cmd.requestInFlight(S.c2s_req_task_list);
        this.refreshButton(pending);
        this.footerText(pending ? '正在同步任务…' : tasks.length ? `${tasks.filter(t => t.state === 1).length} 项奖励可领取` : '');
        if (!tasks.length) { this.empty(pending ? '正在加载任务…' : cmd.tasksLoaded ? '当前分类暂无任务' : '任务尚未加载，请刷新重试'); return; }
        for (const task of tasks) {
            const info = taskPresentation(task), row = this.card(info.name, info.detail, 180);
            const ratio = Math.min(1, Math.max(0, task.progress) / info.target);
            const progressWidth = this.rowWidth - 32;
            const track = this.make('Progress', row, progressWidth, 6); track.setPosition(0, 5, 0);
            inkSurface(track, 'Track', progressWidth, 6, C.inset, null);
            if (ratio > 0) {
                const fill = this.make('Fill', track, progressWidth * ratio, 6);
                fill.setPosition(-progressWidth * (1 - ratio) / 2, 0, 0);
                inkSurface(fill, 'Gold', progressWidth * ratio, 6, C.gold, null);
            }
            caption(row, 'ProgressText', `进度 ${Math.max(0, task.progress)} / ${info.target}`, 0, -16, progressWidth, 14, C.muted);
            this.rewards(row, info.rewards, -56, this.rowWidth - 144);
            const busy = cmd.requestInFlight(`task:${task.taskId}`);
            this.rowAction(row, busy ? '领取中…' : task.state === 2 ? '已领取' : task.state === 1 ? '领取奖励' : '进行中',
                () => this.submit(() => cmd.claimTask(task.taskId)), task.state === 1 && !busy && cmd.sessionReady, 180);
        }
    }

    private renderMail(): void {
        const cmd = MailCommand.getInstance();
        if (this.mailUid && !cmd.getMail(this.mailKind, this.mailUid)) { this.mailUid = ''; this.confirmDelete = false; }
        if (this.mailUid) { this.renderMailDetail(); return; }
        this.subTabs(['系统', '联盟', '公告'], this.mailKind - 1, index => {
            this.mailKind = index + 1; this.page = 0; this.refreshFromServer(); this.render(true);
        });
        const all = cmd.getList(this.mailKind), pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
        this.page = Math.min(this.page, pages - 1);
        const pending = cmd.requestInFlight(`mail-list:${this.mailKind}`);
        this.pagination(pages, false); this.refreshButton(pending, true);
        if (!all.length) { this.empty(pending ? '正在收取邮件…' : cmd.listLoaded(this.mailKind) ? '暂时没有邮件' : '邮件尚未加载，请刷新重试'); return; }
        for (const mail of all.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)) {
            const text = cmd.presentation(this.mailKind, mail.mailUid), row = this.card(text?.title || '邮件',
                `${mail.isRead ? '已读' : '未读'}${mail.isLock ? ' · 已锁定' : ''} · ${DateUtil.converTimeStr(mail.startTime * 1000, 'MM-DD hh:mm')}`, 134);
            caption(row, 'Sender', text?.sender || '系统信使', -48, -34, this.rowWidth - 144, 14, C.muted);
            this.rowAction(row, '查看', () => {
                this.mailUid = String(mail.mailUid); this.confirmDelete = false;
                if (!cmd.getDetail(mail.mailUid)) cmd.requestDetail(this.mailKind, mail.mailUid);
                this.render(true);
            }, true, 134);
        }
    }

    private renderMailDetail(): void {
        const cmd = MailCommand.getInstance(), uid = this.mailUid, mail = cmd.getMail(this.mailKind, uid), detail = cmd.getDetail(uid);
        this.button(this.filters, 'Back', '返回列表', -this.rowWidth / 2 + 52, 0, 104, () => { this.mailUid = ''; this.confirmDelete = false; this.render(true); });
        const locking = cmd.requestInFlight(`mail-lock:${this.mailKind}:${uid}`);
        this.button(this.filters, 'Lock', locking ? '处理中…' : mail.isLock ? '解锁' : '锁定', this.rowWidth / 2 - 44, 0, 88,
            () => { this.confirmDelete = false; this.submit(() => cmd.setLock(this.mailKind, uid, !mail.isLock)); }, !locking && cmd.sessionReady);
        const text = cmd.presentation(this.mailKind, uid);
        const body = text?.content || '暂无正文';
        const chars = Math.max(8, Math.floor((this.rowWidth - 32) / 17));
        const lines = body.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / chars)), 0);
        const height = Math.max(160, 104 + lines * 25);
        const row = this.card(text?.title || '邮件详情', text?.sender || '', height);
        const label = caption(row, 'Body', body, 0, -36, this.rowWidth - 32, 17, C.text);
        label.enableWrapText = true; label.verticalAlign = Label.VerticalAlign.TOP;
        label.node.getComponent(UITransform).setContentSize(this.rowWidth - 32, height - 92);
        label.node.setPosition(0, -36, 0);
        if (!detail) {
            this.empty(cmd.requestInFlight(`mail-detail:${uid}`) ? '正在读取附件…' : '附件未加载，请刷新重试');
            this.refreshButton(cmd.requestInFlight(`mail-detail:${uid}`));
            return;
        }
        const rewards = rewardPreview(detail.rewardList);
        const attachment = this.card('附件', mail.isGotReward ? '附件已领取' : rewards.length ? '可领取以下物资' : '这封邮件没有附件', 148);
        this.rewards(attachment, rewards, -44, this.rowWidth - 144);
        const getting = cmd.requestInFlight(S.c2s_get_mail_reward);
        this.rowAction(attachment, getting ? '领取中…' : mail.isGotReward ? '已领取' : '领取附件',
            () => this.submit(() => cmd.claimRewards([{ mailKind: this.mailKind, mailUid: uid }])),
            !!rewards.length && !mail.isGotReward && !getting && cmd.sessionReady, 148);
        const canDelete = !mail.isLock && (!rewards.length || mail.isGotReward);
        const deleting = cmd.requestInFlight(`mail-delete:${this.mailKind}`);
        this.button(this.footer, 'Delete', deleting ? '删除中…' : this.confirmDelete ? '确认删除' : '删除邮件', this.rowWidth / 2 - 56, 0, 112, () => {
            if (!this.confirmDelete) { this.confirmDelete = true; this.render(); return; }
            this.submit(() => cmd.deleteMails(this.mailKind, [uid])); this.confirmDelete = false;
        }, canDelete && !deleting && cmd.sessionReady);
        this.footerText(this.confirmDelete ? '再次点击确认删除此邮件' : mail.isLock ? '已锁定，解锁后可删除' : !canDelete ? '领取附件后可删除邮件' : '');
    }

    private renderRank(): void {
        const cmd = RankCommand.getInstance();
        this.subTabs(['战力榜', '主城等级榜'], this.rankType - 1, index => { this.rankType = index + 1; this.page = 0; this.refreshFromServer(); this.render(true); });
        const pending = cmd.requestInFlight(`rank:${this.rankType}`);
        const snapshot = cmd.pages.get(`${this.rankType}:${this.page * PAGE_SIZE + 1}:${PAGE_SIZE}`);
        this.pagination(snapshot?.rankList.length === PAGE_SIZE ? this.page + 2 : this.page + 1, true, pending);
        this.refreshButton(pending, true);
        if (!snapshot) { this.empty(pending ? '正在加载排行榜…' : '排行尚未加载，请刷新重试'); return; }
        const self = snapshot.selfRank;
        const selfRow = this.card('我的排名', self?.rank ? `第 ${self.rank} 名` : '暂未上榜', 116);
        caption(selfRow, 'Score', `${this.rankType === 1 ? '战力' : '主城等级'}  ${String(self?.score ?? 0)}`,
            0, -40, this.rowWidth - 32, 16, C.gold);
        if (!snapshot.rankList.length) this.empty('本页暂无排行记录');
        for (const item of snapshot.rankList) {
            const row = this.card(`${item.rank}. ${item.name || '无名主公'}`, this.rankType === 1 ? '战力' : '主城等级', 118);
            caption(row, 'Score', String(item.score ?? 0), 0, -40, this.rowWidth - 32, 18, item.rank <= 3 ? C.gold : C.text);
        }
    }

    private submit(send: () => boolean): void {
        if (!send()) EventMgr.emit(E.showToast, '当前无法提交，请检查连接或稍后重试');
        this.render();
    }

    private subTabs(names: string[], selected: number, change: (index: number) => void): void {
        const width = (this.rowWidth - (names.length - 1) * 6) / names.length;
        names.forEach((name, i) => this.button(this.filters, `Filter${i}`, name,
            (i - (names.length - 1) / 2) * (width + 6), 0, width, () => change(i), true, i === selected));
    }
    private refreshButton(pending: boolean, paged = false): void {
        this.button(this.footer, 'Refresh', pending ? '同步中…' : '刷新', paged ? 0 : this.rowWidth / 2 - 44, 0, 88,
            () => this.refreshFromServer(), !pending);
    }
    private footerText(text: string): void { caption(this.footer, 'Status', text, -54, 0, this.rowWidth - 116, 13, C.muted); }
    private pagination(pages: number, network: boolean, pending = false): void {
        const next = (delta: number) => { this.page += delta; if (network) this.refreshFromServer(); this.render(true); };
        this.button(this.footer, 'Previous', '上一页', -this.rowWidth / 2 + 44, 0, 88, () => next(-1), this.page > 0 && !pending);
        this.button(this.footer, 'Next', '下一页', this.rowWidth / 2 - 44, 0, 88, () => next(1), this.page + 1 < pages && !pending);
    }
    private card(title: string, detail: string, height: number): Node {
        const row = this.make(`Row${this.content.children.length}`, this.content, this.rowWidth, height);
        row.setPosition(0, -this.contentHeight - height / 2, 0); this.contentHeight += height + 10;
        inkSurface(row, 'Surface', this.rowWidth, height, C.panel, C.line);
        const heading = caption(row, 'Heading', title, 0, height / 2 - 26, this.rowWidth - 32, 19, C.text);
        heading.enableWrapText = false; heading.overflow = Label.Overflow.SHRINK;
        const description = caption(row, 'Description', detail, 0, height / 2 - 60, this.rowWidth - 32, 14, C.muted);
        description.enableWrapText = true; description.node.getComponent(UITransform).height = 42;
        return row;
    }
    private rowAction(row: Node, label: string, action: () => void, enabled: boolean, height: number): void {
        this.button(row, 'Action', label, this.rowWidth / 2 - 64, -height / 2 + 32, 104, action, enabled, enabled);
    }
    private rewards(parent: Node, rewards: RewardPreview[], y: number, available: number): void {
        if (!rewards.length) return;
        const text = rewards.map(r => `${rewardName(r)} ×${r.itemCount}`).join('  ');
        const first = rewards[0];
        const path = [1, 2, 6].indexOf(first.rewardType) >= 0 ? itemIconPath(first.itemId) : '';
        const hasIcon = !!path;
        const label = caption(parent, 'Rewards', text, -this.rowWidth / 2 + 16 + available / 2 + (hasIcon ? 14 : 0), y,
            available - (hasIcon ? 28 : 0), 14, C.gold);
        label.enableWrapText = true; label.node.getComponent(UITransform).height = 44;
        if (hasIcon) {
            const icon = this.make('RewardIcon', parent, 30, 30); icon.setPosition(-this.rowWidth / 2 + 30, y, 0);
            const sprite = icon.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            resources.load(path, SpriteFrame, (error, frame) => { if (!error && frame instanceof SpriteFrame && sprite.isValid) sprite.spriteFrame = frame; });
        }
    }
    private empty(text: string): void { this.card(text, '', 100); }
    private button(parent: Node, name: string, text: string, x: number, y: number, width: number,
        action: () => void, enabled = true, primary = false): Node {
        const node = this.make(name, parent, width, 44), button = node.addComponent(Button);
        panelButton(node, text, x, y, width, 44, primary);
        button.interactable = enabled;
        if (!enabled) node.getComponentInChildren(Label).color = C.muted;
        node.on(Button.EventType.CLICK, () => { if (button.interactable) { AudioManager.instance.playClick(); action(); } }, this);
        return node;
    }
    private make(name: string, parent: Node, width: number, height: number): Node {
        const node = new Node(name); node.layer = parent.layer;
        node.addComponent(UITransform).setContentSize(width, height); parent.addChild(node); return node;
    }
    private stretch(node: Node): void {
        const widget = node.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE; widget.updateAlignment();
    }
    private clear(parent: Node): void { for (const child of [...parent.children]) { child.removeFromParent(); child.destroy(); } }
    private close(): void { this.node.active = false; }
    protected onDestroy(): void {
        EventMgr.targetOff(this);
        if (this.node?.isValid) this.node.off(Node.EventType.SIZE_CHANGED, this.layout, this);
        if (this.safe?.isValid) this.safe.off(Node.EventType.SIZE_CHANGED, this.layout, this);
    }
}
