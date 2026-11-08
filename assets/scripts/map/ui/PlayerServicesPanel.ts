import { _decorator, BlockInputEvents, Button, Color, Component, Label, Mask, Node, SafeArea,
    ScrollView, Sprite, SpriteFrame, UITransform, Widget, resources } from 'cc';
import ProgressionCommand from '../../progression/ProgressionCommand';
import { rewardName, rewardPreview, RewardPreview, taskPresentation } from '../../progression/ProgressionPresentation';
import { itemIconPath } from '../../common/ItemPresentation';
import MailCommand from '../../mail/MailCommand';
import RankCommand from '../../rank/RankCommand';
import ConfigManager from '../../core/ConfigManager';
import { hasId, idKey } from '../../network/pto/ProtocolCommand';
import { RankTypeEnum } from '../../config/enum/RankTypeEnum';
import LoginCommand from '../../login/LoginCommand';
import { ServerConfig as S } from '../../config/ServerConfig';
import { LogicEvent as E } from '../../common/LogicEvent';
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import DateUtil from '../../utils/DateUtil';
import { caption, inkSurface, ManagementColors as C, panelButton, place } from './ManagementStyle';
import { rankColumns, rankRow, rankTabs, rankTitleTrim } from './RankBoardView';
import { gameCloseButton, taskCard, taskCardLayout, taskTab, taskTabRail, taskWindowTrim } from './TaskBoardView';
import { mailAttachments, mailEmpty, mailLetter, mailListRow, mailTabs } from './MailBoardView';

const { ccclass } = _decorator;
export type ServiceSection = 'tasks' | 'mail' | 'rank';
const SECTION_TITLES: Record<ServiceSection, string> = { tasks: '任务', mail: '邮件', rank: '排行榜' };
const PAGE_SIZE = 20;

/** 主线/日周常、邮箱与排行榜使用真实协议快照，不在本地推算达成或发奖。 */
@ccclass('PlayerServicesPanel')
export default class PlayerServicesPanel extends Component {
    private safe: Node;
    private panel: Node;
    private filters: Node;
    private footer: Node;
    private scroll: ScrollView;
    private viewport: Node;
    private content: Node;
    private title: Label;
    private rankTrim: Node;
    private section: ServiceSection = 'tasks';
    private taskType = 1;
    private autoSelectTaskType = true;
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
    private rankSyncElapsed = 0;
    private rankContentKey = '';
    private rankRefreshDeferred = false;
    private mailContentKey = '';
    private mailRefreshDeferred = false;
    private mailListOffset = 0;

    public show(section: ServiceSection): void {
        if (!this.panel) this.build();
        this.section = section;
        this.autoSelectTaskType = true;
        this.mailUid = ''; this.confirmDelete = false; this.page = 0; this.mailListOffset = 0;
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
        this.title = caption(this.panel, 'Title', SECTION_TITLES[this.section], 0, 0, 400, 26, C.text, Label.HorizontalAlign.CENTER);
        this.rankTrim = this.make('RankTitleTrim', this.panel, 1, 40);
        this.button(this.panel, 'Close', '关闭', 0, 0, 64, () => this.close());
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
        EventMgr.on(S.s2c_client_load_ok, this.syncVisibleData, this);
    }

    private layout(): void {
        if (!this.panel) return;
        const root = this.node.getComponent(UITransform), safe = this.safe.getComponent(UITransform);
        if (safe.width <= 1 || safe.height <= 1) return;
        inkSurface(this.node, 'Scrim', root.width, root.height, new Color(0, 0, 0, 175), null);
        this.width = Math.min(this.section === 'mail' ? 780 : this.section === 'tasks' ? 860 : 920, Math.max(280, safe.width - 24));
        let targetHeight = this.section === 'mail' ? 520 : 660;
        if (this.section === 'tasks') {
            const tasks = ProgressionCommand.getInstance().getTasks().filter(task => task.state === 0 || task.state === 1);
            const categoryHeights = [1, 2, 3].map(type => tasks.filter(task => task.taskType === type).reduce((height, task) =>
                height + taskCardLayout(this.width - 32, taskPresentation(task).rewards.length).height + 10, 0));
            targetHeight = Math.min(620, Math.max(340, Math.max(...categoryHeights) + 184));
        }
        this.height = Math.min(targetHeight, Math.max(320, safe.height - 24));
        place(this.panel, 0, 0, this.width, this.height);
        inkSurface(this.panel, 'Background', this.width, this.height, C.ink, C.gold);
        place(this.title.node, 0, this.height / 2 - 32, this.width - 180, 40);
        this.title.fontSize = 26; this.title.isBold = false; this.title.color = C.text; this.title.outlineWidth = 0;
        place(this.rankTrim, 0, this.height / 2 - 32, this.width - 180, 40);
        rankTitleTrim(this.rankTrim, this.width);
        this.rankTrim.active = this.section === 'rank';
        if (this.section === 'rank') {
            this.title.isBold = true; this.title.color = new Color(241, 217, 165);
        }
        for (const name of ['TaskWindowTrim', 'TaskTitlePlate']) {
            const trim = this.panel.getChildByName(name); if (trim) trim.active = this.section !== 'rank';
        }
        if (this.section !== 'rank') taskWindowTrim(this.panel, this.width, this.height);
        gameCloseButton(this.panel.getChildByName('Close'), this.width / 2 - 32, this.height / 2 - 32);
        place(this.filters, 0, this.height / 2 - 84, this.width - 32, 44);
        this.rowWidth = this.width - 32;
        const footerHeight = this.section === 'rank' ? 110 : 44;
        place(this.footer, 0, -this.height / 2 + 10 + footerHeight / 2, this.rowWidth, footerHeight);
        // 列表上下边界由相邻操作栏确定，滚动裁切区不能盖住分类或底部按钮。
        const listTop = this.filters.position.y - this.filters.getComponent(UITransform).height / 2 - 12;
        const listBottom = this.footer.position.y + this.footer.getComponent(UITransform).height / 2 + 12;
        place(this.scroll.node, 0, (listTop + listBottom) / 2, this.rowWidth, listTop - listBottom);
        this.viewport.getComponent(Widget).updateAlignment();
        this.render(true);
    }

    private queueRefresh(): void {
        if (!this.node.activeInHierarchy || this.refreshQueued) return;
        this.refreshQueued = true;
        this.scheduleOnce(() => { this.refreshQueued = false; if (this.isValid) this.render(); }, 0);
    }

    private refreshFromServer(): void {
        this.rankSyncElapsed = 0;
        if (this.section === 'tasks') ProgressionCommand.getInstance().requestTasks();
        if (this.section === 'mail') {
            if (this.mailUid) MailCommand.getInstance().requestDetail(this.mailKind, this.mailUid);
            else MailCommand.getInstance().requestList(this.mailKind);
        }
        if (this.section === 'rank') RankCommand.getInstance().requestRank(this.rankType, this.page * PAGE_SIZE + 1, PAGE_SIZE);
        this.render();
    }

    private syncVisibleData(): void {
        if (this.panel && this.node.activeInHierarchy) this.refreshFromServer();
    }

    protected update(dt: number): void {
        // 任务和邮件由推送即时更新；排行榜没有推送，只在当前页可见时低频同步。
        if (!this.node.activeInHierarchy) return;
        if (this.section === 'mail') {
            if (this.mailRefreshDeferred && !this.scroll.isScrolling() && !this.scroll.isAutoScrolling()) this.render();
            return;
        }
        if (this.section !== 'rank') return;
        if (this.rankRefreshDeferred && !this.scroll.isScrolling() && !this.scroll.isAutoScrolling()) this.render();
        if (!RankCommand.getInstance().sessionReady) return;
        this.rankSyncElapsed += dt;
        if (this.rankSyncElapsed >= 30) this.refreshFromServer();
    }

    protected onDisable(): void {
        this.unscheduleAllCallbacks();
        this.refreshQueued = false; this.rankSyncElapsed = 0; this.rankRefreshDeferred = false; this.mailRefreshDeferred = false;
    }

    private mailDisplayKey(): string {
        const cmd = MailCommand.getInstance();
        const summary = (mail: ReturnType<MailCommand['getMail']>) => mail && [idKey(mail.mailUid), mail.mailId,
            mail.title, mail.content, mail.isRead, mail.isLock, mail.isGotReward, mail.startTime];
        const list = cmd.getList(this.mailKind);
        const keys = [`mail-list:${this.mailKind}`, `mail-detail:${this.mailUid}`,
            `mail-lock:${this.mailKind}:${this.mailUid}`, `mail-delete:${this.mailKind}`, S.c2s_get_mail_reward];
        return JSON.stringify([this.mailKind, this.mailUid, this.page, this.confirmDelete, this.rowWidth,
            this.scroll.node.getComponent(UITransform).height, cmd.sessionReady, cmd.listLoaded(this.mailKind),
            keys.map(key => cmd.requestInFlight(key)), [1, 2, 3].map(kind => cmd.getList(kind).filter(mail => !mail.isRead).length),
            this.mailUid ? [summary(cmd.getMail(this.mailKind, this.mailUid)), cmd.getDetail(this.mailUid)]
                : [list.length, list.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE).map(summary)]]);
    }

    /** 正文滚动期间也立即禁用在途操作，避免重复领取或锁定/删除互相竞争。 */
    private syncMailActions(): void {
        if (!this.mailUid) return;
        const cmd = MailCommand.getInstance(), mail = cmd.getMail(this.mailKind, this.mailUid);
        const deleting = cmd.requestInFlight(`mail-delete:${this.mailKind}`);
        const locking = cmd.requestInFlight(`mail-lock:${this.mailKind}:${this.mailUid}`);
        const getting = cmd.requestInFlight(S.c2s_get_mail_reward);
        const detail = cmd.getDetail(this.mailUid), hasRewards = detail && rewardPreview(detail.rewardList).length > 0;
        for (const [parent, name, available] of [[this.filters, 'Lock', !!mail && !locking && !deleting],
            [this.footer, 'Claim', hasRewards && !getting && !deleting && !mail?.isGotReward],
            [this.footer, 'Delete', !!detail && !getting && !deleting && !locking && !mail?.isLock && (!hasRewards || mail?.isGotReward)]] as const) {
            const button = parent.getChildByName(name)?.getComponent(Button);
            if (button) button.interactable = cmd.sessionReady && !!available;
        }
    }

    /** 只比较当前排行实际显示的数据；无关协议、资源推送和相同快照不重建列表。 */
    private rankDisplayKey(): string {
        const cmd = RankCommand.getInstance();
        const snapshot = cmd.pages.get(`${this.rankType}:${this.page * PAGE_SIZE + 1}:${PAGE_SIZE}`);
        const entry = (row: any) => [row?.rank || 0, idKey(row?.uid), row?.name || '', String(row?.score ?? '—'), row?.headIcon || 0];
        const role = LoginCommand.getInstance().proxy.getRoleData();
        return JSON.stringify([this.rankType, this.page, this.rowWidth, this.scroll.node.getComponent(UITransform).height,
            cmd.sessionReady, snapshot ? snapshot.rankList.map(entry) : null, entry(snapshot?.selfRank), idKey(role?.userId), role?.name, role?.headIcon]);
    }

    /** 查询中/超时只切换翻页按钮状态，不销毁头像、名次和分数节点。 */
    private syncRankPagination(): void {
        const cmd = RankCommand.getInstance(), pending = cmd.requestInFlight(`rank:${this.rankType}`);
        const snapshot = cmd.pages.get(`${this.rankType}:${this.page * PAGE_SIZE + 1}:${PAGE_SIZE}`);
        for (const [name, available] of [['Previous', this.page > 0], ['Next', this.rankHasNext(snapshot)]] as const) {
            const node = this.footer.getChildByName(name), button = node?.getComponent(Button);
            if (!button || button.interactable === (!!available && !pending)) continue;
            button.interactable = !!available && !pending;
            const label = node.getComponentInChildren(Label); if (label) label.color = button.interactable ? C.text : C.muted;
        }
    }

    private render(resetScroll = false): void {
        if (!this.panel || !this.node.activeInHierarchy) return;
        let restoreMailList = false;
        if (this.section === 'mail' && this.mailUid && !MailCommand.getInstance().getMail(this.mailKind, this.mailUid)) {
            this.mailUid = ''; this.confirmDelete = false; restoreMailList = true;
        }
        const mailKey = this.section === 'mail' ? this.mailDisplayKey() : '';
        if (this.section === 'mail') {
            this.syncMailActions();
            if (mailKey === this.mailContentKey && !resetScroll && !restoreMailList) { this.mailRefreshDeferred = false; return; }
            if (!resetScroll && !restoreMailList && (this.scroll.isScrolling() || this.scroll.isAutoScrolling())) {
                this.mailRefreshDeferred = true; return;
            }
        }
        this.mailRefreshDeferred = false;
        const rankKey = this.section === 'rank' ? this.rankDisplayKey() : '';
        if (this.section === 'rank') {
            this.syncRankPagination();
            if (rankKey === this.rankContentKey) {
                this.rankRefreshDeferred = false;
                if (resetScroll) {
                    this.scroll.stopAutoScroll();
                    this.content.setPosition(0, this.scroll.node.getComponent(UITransform).height / 2, 0);
                }
                return;
            }
            // 服务端新快照不抢占拖动或惯性回弹；主动切页、分类和尺寸变化立即生效。
            if (!resetScroll && (this.scroll.isScrolling() || this.scroll.isAutoScrolling())) {
                this.rankRefreshDeferred = true;
                return;
            }
        }
        this.rankRefreshDeferred = false;
        const offset = restoreMailList ? this.mailListOffset : resetScroll ? 0 : this.scroll.getScrollOffset().y;
        this.scroll.stopAutoScroll();
        for (const node of [this.filters, this.content, this.footer]) this.clear(node);
        this.contentHeight = 0;
        this.title.string = SECTION_TITLES[this.section];
        if (this.section === 'tasks') this.renderTasks();
        if (this.section === 'mail') this.renderMail();
        if (this.section === 'rank') this.renderRank();
        const viewHeight = this.scroll.node.getComponent(UITransform).height;
        this.content.getComponent(UITransform).setContentSize(this.rowWidth, Math.max(viewHeight, this.contentHeight));
        this.content.setPosition(0, viewHeight / 2 + Math.min(Math.max(0, offset), Math.max(0, this.contentHeight - viewHeight)), 0);
        this.rankContentKey = rankKey;
        this.mailContentKey = mailKey;
    }

    private renderTasks(): void {
        const cmd = ProgressionCommand.getInstance();
        const all = cmd.getTasks(), current = all.filter(task => task.state === 0 || task.state === 1);
        // 打开时定位到仍有目标或奖励的分类；手动切换后保留玩家选择。
        if (this.autoSelectTaskType && !current.some(task => task.taskType === this.taskType)) {
            this.taskType = [1, 2, 3].find(type => current.some(task => task.taskType === type)) || this.taskType;
        }
        const names = ['主线', '日常', '周常'];
        this.subTabs(names, this.taskType - 1, index => {
            this.autoSelectTaskType = false; this.taskType = index + 1; this.render(true);
        });
        const tabStep = this.rowWidth / 3;
        this.filters.children.forEach((button, i) => {
            button.setPosition((i - 1) * tabStep, 0); taskTab(button, i === this.taskType - 1);
        });
        taskTabRail(this.filters, this.rowWidth);
        // 可领取（1）排在进行中（0）前；同状态仍按配置顺序和任务 ID 稳定排列。
        const tasks = current.filter(task => task.taskType === this.taskType).sort((a, b) =>
            b.state - a.state || taskPresentation(a).order - taskPresentation(b).order || a.taskId - b.taskId);
        const pending = cmd.requestInFlight(S.c2s_req_task_list);
        const ongoing = tasks.filter(task => task.state === 0).length, ready = tasks.length - ongoing;
        this.footerText(pending ? '正在同步任务…' : [ongoing ? `${ongoing} 项进行中` : '', ready ? `${ready} 项待领取` : ''].filter(Boolean).join(' · '), true);
        if (!tasks.length) {
            const finished = all.some(task => task.taskType === this.taskType && task.state === 2);
            this.empty(pending ? '正在加载任务…' : !cmd.tasksLoaded ? '任务尚未同步'
                : finished ? `当前${names[this.taskType - 1]}任务已完成` : `当前暂无${names[this.taskType - 1]}任务`);
            const row = this.content.children[0], label = row.getChildByName('Heading').getComponent(Label);
            label.horizontalAlign = Label.HorizontalAlign.CENTER; place(label.node, 0, 0, this.rowWidth - 32, 40);
            return;
        }
        for (const task of tasks) {
            const info = taskPresentation(task), height = taskCardLayout(this.rowWidth, info.rewards.length).height;
            const row = this.card(info.name, info.detail, height);
            const progress = Math.min(info.target, Math.max(0, Number.isFinite(task.progress) ? task.progress : 0));
            const busy = cmd.requestInFlight(`task:${task.taskId}`);
            this.rowAction(row, busy ? '领取中…' : task.state === 1 ? '领取奖励' : '进行中',
                () => this.submit(() => cmd.claimTask(task.taskId)), task.state === 1 && !busy && cmd.sessionReady, height);
            taskCard(row, this.rowWidth, info, progress, task.state === 1);
        }
    }

    private renderMail(): void {
        const cmd = MailCommand.getInstance();
        if (this.mailUid) { this.renderMailDetail(); return; }
        this.subTabs(['系统', '同盟', '公告'], this.mailKind - 1, index => {
            if (this.mailKind === index + 1) return;
            this.mailKind = index + 1; this.page = 0; this.mailListOffset = 0; this.refreshFromServer(); this.render(true);
        });
        mailTabs(this.filters, this.rowWidth, this.mailKind - 1, [1, 2, 3].map(kind => cmd.getList(kind).filter(mail => !mail.isRead).length));
        const all = cmd.getList(this.mailKind), pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
        this.page = Math.min(this.page, pages - 1);
        const pending = cmd.requestInFlight(`mail-list:${this.mailKind}`);
        this.pagination(pages, false);
        if (!all.length) {
            const retry = cmd.sessionReady && !pending && !cmd.listLoaded(this.mailKind);
            this.mailState(!cmd.sessionReady ? '连接已断开' : pending ? '正在收取邮件…'
                : retry ? '邮件暂未同步' : '暂无邮件', retry ? () => this.refreshFromServer() : null);
            return;
        }
        caption(this.footer, 'MailCount', `${all.length} 封${pages > 1 ? `  ·  ${this.page + 1} / ${pages}` : ''}`,
            0, 0, Math.max(60, this.rowWidth - 192), 12, C.muted, Label.HorizontalAlign.CENTER);
        for (const mail of all.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)) {
            const text = cmd.presentation(this.mailKind, mail.mailUid), row = this.make(`Mail${idKey(mail.mailUid)}`, this.content, this.rowWidth, 84);
            row.setPosition(0, -this.contentHeight - 42, 0); this.contentHeight += 92;
            mailListRow(row, this.rowWidth, { title: text?.title || '邮件', sender: text?.sender || ['系统信使', '同盟', '系统公告'][this.mailKind - 1],
                time: DateUtil.converTimeStr(mail.startTime * 1000, 'MM-DD hh:mm'), read: mail.isRead, locked: mail.isLock });
            row.on(Button.EventType.CLICK, () => {
                AudioManager.instance.playClick();
                this.mailListOffset = this.scroll.getScrollOffset().y;
                this.mailUid = idKey(mail.mailUid); this.confirmDelete = false;
                if (!cmd.getDetail(mail.mailUid)) cmd.requestDetail(this.mailKind, mail.mailUid);
                this.render(true);
            }, this);
        }
    }

    private mailState(text: string, retry: (() => void) | null = null): void {
        const height = this.scroll.node.getComponent(UITransform).height;
        const state = this.make('MailState', this.content, this.rowWidth, height);
        state.setPosition(0, -height / 2, 0); this.contentHeight = height;
        mailEmpty(state, this.rowWidth, height, text, !!retry);
        if (retry) this.button(state, 'Retry', '重新收取', 0, height < 210 ? -24 : -88, 112, retry);
    }

    private backToMailList(): void {
        this.mailUid = ''; this.confirmDelete = false;
        this.render(true);
        const height = this.scroll.node.getComponent(UITransform).height;
        this.content.setPosition(0, height / 2 + Math.min(Math.max(0, this.mailListOffset), Math.max(0, this.contentHeight - height)), 0);
    }

    private renderMailDetail(): void {
        const cmd = MailCommand.getInstance(), uid = this.mailUid, mail = cmd.getMail(this.mailKind, uid), detail = cmd.getDetail(uid);
        this.button(this.filters, 'Back', '返回列表', -this.rowWidth / 2 + 52, 0, 104, () => this.backToMailList());
        const locking = cmd.requestInFlight(`mail-lock:${this.mailKind}:${uid}`);
        const deleting = cmd.requestInFlight(`mail-delete:${this.mailKind}`);
        this.button(this.filters, 'Lock', locking ? '处理中…' : mail.isLock ? '取消收藏' : '收藏', this.rowWidth / 2 - 50, 0, 100,
            () => { this.confirmDelete = false; this.submit(() => cmd.setLock(this.mailKind, uid, !mail.isLock)); }, !locking && !deleting && cmd.sessionReady);
        if (!detail) {
            const pending = cmd.requestInFlight(`mail-detail:${uid}`), retry = cmd.sessionReady && !pending;
            this.mailState(!cmd.sessionReady ? '连接已断开' : pending ? '正在读取邮件…' : '邮件暂未读取',
                retry ? () => this.refreshFromServer() : null);
            return;
        }
        const text = cmd.presentation(this.mailKind, uid);
        const row = this.make('Letter', this.content, this.rowWidth, 1);
        const height = mailLetter(row, this.rowWidth, text?.title || '邮件',
            `${text?.sender || '系统信使'}  ·  ${DateUtil.converTimeStr(mail.startTime * 1000, 'MM-DD hh:mm')}`, text?.content || '暂无正文');
        row.setPosition(0, -height / 2, 0); this.contentHeight = height + 12;
        const rewards = rewardPreview(detail.rewardList);
        if (rewards.length) {
            const attachment = this.make('Attachments', this.content, this.rowWidth, 1);
            const height = mailAttachments(attachment, this.rowWidth, rewards, mail.isGotReward);
            attachment.setPosition(0, -this.contentHeight - height / 2, 0); this.contentHeight += height + 8;
        }
        const getting = cmd.requestInFlight(S.c2s_get_mail_reward);
        const canDelete = !mail.isLock && (!rewards.length || mail.isGotReward);
        if (!canDelete) this.confirmDelete = false;
        this.button(this.footer, 'Delete', deleting ? '删除中…' : this.confirmDelete ? '确认删除' : '删除', -this.rowWidth / 2 + 52, 0, 104, () => {
            if (!this.confirmDelete) { this.confirmDelete = true; this.render(); return; }
            this.confirmDelete = false; this.submit(() => cmd.deleteMails(this.mailKind, [uid]));
        }, canDelete && !deleting && !locking && !getting && cmd.sessionReady);
        if (this.confirmDelete) {
            this.button(this.footer, 'CancelDelete', '取消', this.rowWidth / 2 - 60, 0, 120,
                () => { this.confirmDelete = false; this.render(); });
        } else if (rewards.length) {
            this.button(this.footer, 'Claim', getting ? '领取中…' : mail.isGotReward ? '已领取' : '领取附件', this.rowWidth / 2 - 60, 0, 120,
                () => this.submit(() => cmd.claimRewards([{ mailKind: this.mailKind, mailUid: uid }])),
                !mail.isGotReward && !getting && !deleting && cmd.sessionReady, !mail.isGotReward);
        }
    }

    private renderRank(): void {
        const cmd = RankCommand.getInstance();
        this.subTabs(['战力榜', '主城榜', '歼敌榜', '同盟榜'], this.rankType - 1, index => { this.rankType = index + 1; this.page = 0; this.refreshFromServer(); this.render(true); });
        rankTabs(this.filters, this.rowWidth, this.rankType - 1);
        const pending = cmd.requestInFlight(`rank:${this.rankType}`);
        const snapshot = cmd.pages.get(`${this.rankType}:${this.page * PAGE_SIZE + 1}:${PAGE_SIZE}`);
        this.pagination(this.rankHasNext(snapshot) ? this.page + 2 : this.page + 1, true, pending);
        for (const name of ['Previous', 'Next']) {
            const button = this.footer.getChildByName(name);
            if (button) panelButton(button, name === 'Previous' ? '上一页' : '下一页', button.position.x, -40, 88, 28);
        }
        caption(this.footer, 'Page', `第 ${this.page + 1} 页`, 0, -40, 100, 12, C.muted, Label.HorizontalAlign.CENTER);
        if (!snapshot) { this.empty(cmd.sessionReady ? '正在加载排行榜…' : '连接恢复后自动同步排行'); return; }
        const metric = ['战力', '主城等级', '歼敌', '同盟战力'][this.rankType - 1];
        const alliance = this.rankType === RankTypeEnum.ALLIANCE_POWER;
        const role = LoginCommand.getInstance().proxy.getRoleData();
        const self = snapshot.selfRank;
        const selfRow = this.make('MyRank', this.footer, this.rowWidth, 70);
        selfRow.setPosition(0, 16, 0);
        rankRow(selfRow, this.rowWidth, { ...self, name: alliance ? self?.name || '我的同盟' : role?.name || '我',
            headIcon: alliance ? 0 : role?.headIcon }, metric, true, alliance);
        if (!alliance && hasId(role?.userId)) {
            const uid = role.userId;
            selfRow.addComponent(Button).transition = Button.Transition.NONE;
            selfRow.on(Button.EventType.CLICK, () => EventMgr.emit(E.openPlayerProfile, uid), this);
        }
        const columns = this.make('RankColumns', this.content, this.rowWidth, 36);
        columns.setPosition(0, -18, 0); this.contentHeight = 40;
        rankColumns(columns, this.rowWidth, metric, alliance);
        if (!snapshot.rankList.length) this.empty('本页暂无排行记录');
        for (const item of snapshot.rankList) {
            const row = this.make(`Rank${item.rank}`, this.content, this.rowWidth, 82);
            row.setPosition(0, -this.contentHeight - 41, 0); this.contentHeight += 90;
            rankRow(row, this.rowWidth, item, metric, false, alliance);
            if (!alliance && hasId(item.uid)) {
                row.addComponent(Button).transition = Button.Transition.NONE;
                row.on(Button.EventType.CLICK, () => EventMgr.emit(E.openPlayerProfile, item.uid), this);
            }
        }
    }
    private rankHasNext(snapshot: { rankList: any[] } | undefined): boolean {
        const rows = ConfigManager.getInstance().getConfig('Rank');
        const row = Array.isArray(rows) ? rows.find(r => r.Id === this.rankType) : rows?.[this.rankType];
        const limit = Number(row?.RankMax) || Infinity;
        return snapshot?.rankList.length === PAGE_SIZE && (this.page + 1) * PAGE_SIZE < limit;
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
    private footerText(text: string, fullWidth = false): void {
        caption(this.footer, 'Status', text, fullWidth ? 0 : -54, 0, fullWidth ? this.rowWidth : this.rowWidth - 116, 13, C.muted);
    }
    private pagination(pages: number, network: boolean, pending = false): void {
        if (pages <= 1 && this.page === 0) return;
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
