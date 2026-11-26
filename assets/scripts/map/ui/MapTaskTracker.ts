import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node, resources, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';
import ProgressionCommand, { TaskInfo } from '../../progression/ProgressionCommand';
import { RewardPreview, taskPresentation, taskRewardPresentation, trackedTask } from '../../progression/ProgressionPresentation';
import { rewardQualityStyle } from '../../common/RewardQuality';
import { LogicEvent as E } from '../../common/LogicEvent';
import { ServerConfig as S } from '../../config/ServerConfig';
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { caption, inkSurface, ManagementColors as C, place, textStyle } from './ManagementStyle';

const { ccclass } = _decorator;
const READY_GREEN = new Color(148, 209, 158, 255);
const HANDLE_BG = new Color(41, 47, 36, 244);
const HANDLE_BORDER = new Color(172, 148, 96, 195);
const TAB_WIDTH = 28;
const TAB_HEIGHT = 72;
const SLIDE_DURATION = 0.26;
interface RewardSlot { node: Node; accent: Graphics; icon: Sprite; fallback: Label; count: Label; }

/** 地图左侧单任务追踪：只发送领奖请求，服务端确认后再切换后续任务。 */
@ccclass('MapTaskTracker')
export default class MapTaskTracker extends Component {
    private body: Node;
    private all: Node;
    private category: Label;
    private title: Label;
    private detail: Label;
    private progress: Label;
    private track: Graphics;
    private completionMark: Graphics;
    private rewards: Node;
    private rewardSlots: RewardSlot[] = [];
    private rewardOpacity: UIOpacity;
    private rewardSignature = '';
    private rewardVersion = 0;
    private iconFrames = new Map<string, SpriteFrame>();
    private rewardGlow: Graphics;
    private glowOpacity: UIOpacity;
    private collapseTab: Node;
    private collapseBg: Graphics;
    private collapseArrow: Label;
    private collapseHint: Label;
    private collapseReadyDot: Graphics;
    private collapsed = false;
    private claimable = false;
    private expandedX = 0;
    private collapsedX = 0;
    private centerY = 0;
    private slideActive = false;
    private slideElapsed = 0;
    private slideFromX = 0;
    private slideToX = 0;
    private claimPulse = false;
    private pulseTime = 0;
    private current: TaskInfo | null = null;
    private expectedNextId = 0;
    private width = 344;
    private height = 116;
    private textWidth = 204;
    private textX = 0;
    private viewWidth = 1280;
    private viewHeight = 720;
    private bottomInset = 124;
    private queued = false;
    private openList: () => void;

    initialize(openList: () => void): void {
        this.openList = openList;
        if (!this.body) this.build();
        this.render();
    }

    private make(name: string, parent = this.node): Node {
        const node = new Node(name); node.layer = parent.layer;
        node.addComponent(UITransform); parent.addChild(node);
        return node;
    }

    private build(): void {
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        this.node.addComponent(BlockInputEvents);
        this.category = caption(this.node, 'Category', '主线任务', 0, 44, 160, 12, C.gold);
        this.all = this.make('AllTasks');
        this.all.addComponent(Button).transition = Button.Transition.SCALE;
        caption(this.all, 'Caption', '全部 ›', 0, 0, 52, 12, C.muted, Label.HorizontalAlign.CENTER);
        this.all.on(Button.EventType.CLICK, () => this.openList?.());
        this.body = this.make('TaskAction');
        const button = this.body.addComponent(Button);
        button.transition = Button.Transition.SCALE; button.zoomScale = .985; button.duration = .1;
        this.body.on(Button.EventType.CLICK, () => this.activate());
        this.title = caption(this.body, 'TaskTitle', '', 0, 32, 224, 17);
        this.detail = caption(this.body, 'TaskDetail', '', 0, 0, 224, 13, C.muted);
        this.progress = caption(this.body, 'TaskProgress', '', 0, 0, 80, 13, C.muted, Label.HorizontalAlign.RIGHT);
        this.track = this.make('ProgressTrack', this.body).addComponent(Graphics);
        this.completionMark = this.make('CompletionMark', this.body).addComponent(Graphics);
        this.rewards = this.make('TaskRewards', this.body);
        this.rewardOpacity = this.rewards.addComponent(UIOpacity);
        for (let i = 0; i < 4; i++) {
            const node = this.make(`Reward${i}`, this.rewards);
            const accent = this.make('Quality', node).addComponent(Graphics);
            const fallback = caption(node, 'Fallback', '', 0, 6, 44, 16, C.muted, Label.HorizontalAlign.CENTER);
            const icon = this.make('Icon', node).addComponent(Sprite);
            icon.sizeMode = Sprite.SizeMode.CUSTOM; icon.type = Sprite.Type.SIMPLE;
            const count = caption(node, 'Count', '', 0, -20, 48, 12, C.text, Label.HorizontalAlign.CENTER);
            this.rewardSlots.push({ node, accent, icon, fallback, count });
        }
        this.rewardGlow = this.make('RewardGlow').addComponent(Graphics);
        this.glowOpacity = this.rewardGlow.node.addComponent(UIOpacity);
        // 紧贴任务卡右侧的“收起/展开”竖向拉手（与编队侧栏同风格，收起后紧贴左屏边不遮挡左下建筑）
        this.collapseTab = this.make('CollapseTab');
        this.collapseTab.addComponent(BlockInputEvents);
        const tabBtn = this.collapseTab.addComponent(Button);
        tabBtn.transition = Button.Transition.SCALE; tabBtn.zoomScale = .95; tabBtn.duration = .08;
        this.collapseBg = this.make('HandleBg', this.collapseTab).addComponent(Graphics);
        this.collapseArrow = caption(this.collapseTab, 'Arrow', '‹', 0, 18, 24, 15, C.gold, Label.HorizontalAlign.CENTER);
        this.collapseHint = caption(this.collapseTab, 'Hint', '收\n起', 0, -9, 24, 11, C.text, Label.HorizontalAlign.CENTER);
        this.collapseHint.enableWrapText = true;
        this.collapseHint.lineHeight = 14;
        this.collapseReadyDot = this.make('ReadyDot', this.collapseTab).addComponent(Graphics);
        this.collapseTab.on(Button.EventType.CLICK, () => this.toggleCollapse());
        EventMgr.on(E.updateTasks, this.queueRefresh, this);
        EventMgr.on(E.protocolRequestChanged, this.queueRefresh, this);
    }

    public get isCollapsed(): boolean {
        return this.collapsed;
    }

    public toggleCollapse(): void {
        if (!this.body) return;
        AudioManager.instance.playClick();
        this.setCollapsed(!this.collapsed, true);
    }

    public setCollapsed(nextCollapsed: boolean, animate = false): void {
        const changed = this.collapsed !== nextCollapsed;
        this.collapsed = nextCollapsed;
        this.refreshCollapseHandle();
        const targetX = this.collapsed ? this.collapsedX : this.expandedX;
        if (!animate || !changed) {
            this.slideActive = false;
            this.node.setPosition(targetX, this.centerY);
            return;
        }
        this.slideFromX = this.node.position.x;
        this.slideToX = targetX;
        this.slideElapsed = 0;
        this.slideActive = true;
    }

    /** 靠左下、在底部导航上方留出间距，给地图中心与地块详情让出空间。 */
    layout(viewWidth: number, viewHeight: number, bottomInset = 124): void {
        if (!this.body) return;
        this.viewWidth = viewWidth; this.viewHeight = viewHeight; this.bottomInset = bottomInset;
        this.render();
    }

    private arrange(): void {
        const margin = this.viewWidth < 720 ? 12 : 20;
        this.width = Math.min(344, Math.max(1, this.viewWidth - margin * 2));
        const count = this.rewards.active ? this.rewardSlots.filter(slot => slot.node.active).length : 0;
        const contentWidth = this.width - 28;
        const columns = Math.min(count || 1, Math.max(1, Math.floor((contentWidth - 74) / 42)));
        const rows = Math.ceil(count / columns), rewardWidth = count ? columns * 36 + (columns - 1) * 6 : 0;
        this.height = this.current ? 128 + Math.max(0, rows - 1) * 52 : 80;
        this.textWidth = contentWidth - (count ? rewardWidth + 12 : 0);
        this.textX = -contentWidth / 2 + this.textWidth / 2;
        const centerY = -this.viewHeight / 2 + Math.min(this.bottomInset, Math.max(12, this.viewHeight - this.height - 88)) + this.height / 2;
        this.expandedX = -this.viewWidth / 2 + margin + this.width / 2;
        this.collapsedX = -this.viewWidth / 2 - this.width / 2;
        this.centerY = centerY;
        const posX = this.slideActive ? this.node.position.x : (this.collapsed ? this.collapsedX : this.expandedX);
        if (this.slideActive) this.slideToX = this.collapsed ? this.collapsedX : this.expandedX;
        place(this.node, posX, centerY, this.width, this.height);
        place(this.body, 0, -22, this.width, this.height - 44);
        place(this.collapseTab, this.width / 2 + TAB_WIDTH / 2 - 1, 0, TAB_WIDTH, TAB_HEIGHT);
        this.refreshCollapseHandle();
        // 全部按钮与领奖区域分开，避免点开列表时同时触发领奖。
        const headerY = this.height / 2 - 22;
        place(this.all, this.width / 2 - 35, headerY, 56, 44);
        textStyle(this.category, -36, headerY, this.width - 100, 12, C.gold);
        // 两列共用文字行的基准：图标中心对齐标题，奖励数量对齐任务说明。
        const titleY = this.current ? this.height / 2 - 44 : 0;
        textStyle(this.title, this.textX, titleY, this.textWidth, this.current ? 17 : 15,
            this.current ? C.text : C.muted, Label.HorizontalAlign.LEFT, 22);
        this.title.overflow = Label.Overflow.SHRINK;
        textStyle(this.detail, this.textX, titleY - 24, this.textWidth, 13, C.muted, Label.HorizontalAlign.LEFT, 20);
        this.detail.overflow = Label.Overflow.SHRINK;
        // 底部进度条接右侧数值，数值与奖励区域的右边缘对齐。
        const progressWidth = this.current ? Math.min(104, Math.max(32, this.progress.string.length * 7.5 + 4)) : 0;
        const completed = this.current?.state === 1;
        const reserved = progressWidth ? progressWidth + (completed ? 28 : 10) : 0;
        textStyle(this.progress, contentWidth / 2 - progressWidth / 2, -this.height / 2 + 38,
            progressWidth, 13, completed ? READY_GREEN : C.muted, Label.HorizontalAlign.RIGHT, 20);
        this.progress.overflow = Label.Overflow.SHRINK;
        place(this.completionMark.node, contentWidth / 2 - progressWidth - 10, -this.height / 2 + 38, 16, 16);
        place(this.track.node, -reserved / 2, -this.height / 2 + 38, contentWidth - reserved, 3);
        // 图标在格内 y=6、数量在 y=-18；首行由标题推算位置，换行后保持右对齐。
        place(this.rewards, contentWidth / 2 - rewardWidth / 2, titleY - 6 - (rows - 1) * 26, rewardWidth, rows * 52);
        this.rewardSlots.forEach((slot, i) => {
            if (!slot.node.active) return;
            const row = Math.floor(i / columns), rowCount = Math.min(columns, count - row * columns);
            place(slot.node, rewardWidth / 2 - 18 - (rowCount - 1 - i % columns) * 42,
                (rows - 1) * 26 - row * 52, 36, 52);
            textStyle(slot.count, 0, -18, 36, 12, slot.count.color, Label.HorizontalAlign.CENTER, 16);
            slot.count.overflow = Label.Overflow.SHRINK;
        });
        place(this.rewardGlow.node, 0, 0, this.width, this.height);
    }

    private queueRefresh(): void {
        // ACK 与紧随其后的全量可能在同一帧到达，先记住完成状态，避免列表移除旧项后丢失后续目标。
        this.rememberCompletion(ProgressionCommand.getInstance());
        if (this.queued || !this.node.activeInHierarchy) return;
        this.queued = true;
        this.scheduleOnce(() => { this.queued = false; if (this.isValid) this.render(); }, 0);
    }

    protected onEnable(): void { if (this.body) this.render(); }
    protected onDisable(): void {
        this.unscheduleAllCallbacks(); this.queued = false; this.claimPulse = false; this.slideActive = false;
    }
    protected onDestroy(): void {
        EventMgr.targetOff(this); this.openList = null; this.rewardVersion++;
        this.iconFrames.clear();
    }

    protected update(dt: number): void {
        const step = Math.min(dt, .1);
        if (this.slideActive) {
            this.slideElapsed += step;
            const raw = Math.min(1, this.slideElapsed / SLIDE_DURATION);
            // cubicInOut 丝滑推拉，与编队侧栏收放手感一致
            const eased = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
            const curX = this.slideFromX + (this.slideToX - this.slideFromX) * eased;
            this.node.setPosition(curX, this.centerY);
            if (raw >= 1) {
                this.slideActive = false;
                this.node.setPosition(this.slideToX, this.centerY);
            }
        }
        if (!this.claimPulse) return;
        this.pulseTime += step;
        const wave = (Math.sin(this.pulseTime * Math.PI) + 1) / 2;
        this.glowOpacity.opacity = 90 + Math.round(wave * 110);
    }

    private refreshCollapseHandle(): void {
        if (!this.collapseTab?.isValid) return;
        this.collapseArrow.string = this.collapsed ? '›' : '‹';
        this.collapseHint.string = this.collapsed ? '任\n务' : '收\n起';
        this.collapseHint.color = this.collapsed && this.claimable ? READY_GREEN : C.text;
        this.collapseArrow.color = this.collapsed && this.claimable ? READY_GREEN : C.gold;

        const g = this.collapseBg;
        g.clear();
        const hw = TAB_WIDTH / 2;
        const hh = TAB_HEIGHT / 2;
        g.fillColor = HANDLE_BG;
        g.roundRect(-hw, -hh, TAB_WIDTH, TAB_HEIGHT, 5);
        g.fill();
        g.strokeColor = this.collapsed && this.claimable ? READY_GREEN : HANDLE_BORDER;
        g.lineWidth = 1.1;
        g.roundRect(-hw + .5, -hh + .5, TAB_WIDTH - 1, TAB_HEIGHT - 1, 5);
        g.stroke();
        // 顶部细铜饰线
        g.strokeColor = new Color(216, 188, 126, 120);
        g.lineWidth = 1;
        g.moveTo(-hw + 5, hh - 4);
        g.lineTo(hw - 5, hh - 4);
        g.stroke();

        // 收起态且有可领奖任务时，在把手顶部显示翠绿提示点
        const dot = this.collapseReadyDot;
        dot.clear();
        if (this.collapsed && this.claimable) {
            dot.fillColor = new Color(110, 210, 134, 70);
            dot.circle(0, hh - 9, 6);
            dot.fill();
            dot.fillColor = READY_GREEN;
            dot.circle(0, hh - 9, 3.2);
            dot.fill();
        }
    }

    private drawRewardGlow(visible: boolean, busy: boolean): void {
        const pulse = visible && !busy;
        if (pulse && !this.claimPulse) { this.pulseTime = 0; this.glowOpacity.opacity = 145; }
        this.rewardGlow.node.active = pulse;
        this.claimPulse = pulse;
        // 完成只认服务端的可领取状态；请求中保留对勾，停止呼吸光并禁用重复领取。
        this.completionMark.node.active = visible;
        this.rewardOpacity.opacity = busy ? 160 : 255;
        if (!visible) { this.pulseTime = 0; return; }
        const mark = this.completionMark; mark.clear();
        mark.fillColor = new Color(99, 172, 115, 35);
        mark.circle(0, 0, 7); mark.fill();
        mark.lineWidth = 2; mark.strokeColor = READY_GREEN;
        mark.moveTo(-3.5, 0); mark.lineTo(-1, -2.5); mark.lineTo(4, 3); mark.stroke();
        // 玉绿色只用于状态边缘与进度，奖励图标及数量继续使用道具品质颜色。
        const glow = this.rewardGlow; glow.clear();
        glow.lineWidth = 8; glow.strokeColor = new Color(99, 184, 121, 24);
        glow.roundRect(-this.width / 2 + 3, -this.height / 2 + 3, this.width - 6, this.height - 6, 5); glow.stroke();
        glow.lineWidth = 4; glow.strokeColor = new Color(126, 204, 146, 60);
        glow.roundRect(-this.width / 2 + 2, -this.height / 2 + 2, this.width - 4, this.height - 4, 5); glow.stroke();
        glow.lineWidth = 1.5; glow.strokeColor = new Color(177, 233, 185, 230);
        glow.roundRect(-this.width / 2 + 2, -this.height / 2 + 2, this.width - 4, this.height - 4, 5); glow.stroke();
    }

    private renderRewards(rewards: RewardPreview[]): void {
        this.rewards.active = rewards.length > 0;
        const entries = rewards.map(reward => ({ ...reward, ...taskRewardPresentation(reward) }));
        const signature = JSON.stringify(entries);
        // 进度、请求状态更新只改文字和光效，不反复清空已显示的图标。
        if (signature === this.rewardSignature) return;
        this.rewardSignature = signature;
        const version = ++this.rewardVersion;
        this.rewardSlots.forEach((slot, i) => {
            const more = i === 3 && entries.length > 4, entry = entries[i];
            slot.node.active = !!entry;
            if (!entry) return;
            const style = rewardQualityStyle(more ? 0 : entry.quality);
            const color = new Color(style.accent[0], style.accent[1], style.accent[2]);
            slot.count.color = color; slot.count.string = more ? '更多奖励' : `×${entry.itemCount.toLocaleString()}`;
            slot.fallback.color = color; slot.fallback.string = more ? `+${entries.length - 3}` : entry.glyph;
            slot.fallback.node.active = true; slot.icon.enabled = false;
            slot.accent.clear();
            // 轻底色和品质短线衬托道具，不再画统一宝箱或背包格。
            slot.accent.fillColor = new Color(style.fill[0], style.fill[1], style.fill[2], 150);
            slot.accent.roundRect(-17, -10, 34, 32, 7); slot.accent.fill();
            slot.accent.fillColor = color; slot.accent.roundRect(-13, -11, 26, 2, 1); slot.accent.fill();
            if (more || !entry.icon) return;
            const apply = (frame: SpriteFrame) => {
                if (!this.isValid || version !== this.rewardVersion || !slot.icon.isValid) return;
                slot.icon.spriteFrame = frame;
                const size = frame.originalSize;
                const scale = 30 / Math.max(size?.width || 30, size?.height || 30);
                place(slot.icon.node, 0, 6, (size?.width || 30) * scale, (size?.height || 30) * scale);
                slot.icon.enabled = true; slot.fallback.node.active = false;
            };
            const cached = this.iconFrames.get(entry.icon);
            if (cached) { apply(cached); return; }
            resources.load(entry.icon, SpriteFrame, (err, frame) => {
                if (err || !(frame instanceof SpriteFrame) || !this.isValid) return;
                this.iconFrames.set(entry.icon, frame); apply(frame);
            });
        });
    }

    private rememberCompletion(cmd: ProgressionCommand): void {
        const previous = this.current && cmd.tasks.get(this.current.taskId);
        if (previous?.taskType === 1 && previous.state === 2) this.expectedNextId = taskPresentation(previous).nextId;
    }

    private render(): void {
        if (!this.body) return;
        const cmd = ProgressionCommand.getInstance();
        const syncing = cmd.requestInFlight(S.c2s_req_task_list);
        if (!cmd.sessionReady) { this.current = null; this.expectedNextId = 0; }
        else {
            this.rememberCompletion(cmd);
            const next = this.expectedNextId && cmd.tasks.get(this.expectedNextId);
            if (next) this.expectedNextId = 0;
            this.current = this.expectedNextId ? null : trackedTask(cmd.getTasks()) || null;
        }
        this.all.getComponent(Button).interactable = cmd.sessionReady;
        const button = this.body.getComponent(Button);
        let claimable = false, claiming = false, ratio = 0;
        if (this.current) {
            const task = this.current, info = taskPresentation(task), busy = cmd.requestInFlight(`task:${task.taskId}`);
            claiming = busy;
            claimable = task.state === 1;
            this.category.string = { 1: '主线任务', 2: '日常任务', 3: '周常任务' }[task.taskType];
            this.title.string = info.name;
            const value = Math.min(info.target, Math.max(0, task.progress));
            ratio = claimable ? 1 : value / info.target;
            this.detail.string = info.detail;
            this.progress.string = `${claimable ? info.target : value}/${info.target}`;
            this.renderRewards(info.rewards);
            button.interactable = cmd.sessionReady && (claimable ? !busy : info.jump > 0);
        } else {
            this.renderRewards([]);
            this.category.string = this.expectedNextId ? '主线任务' : '任务';
            // 空状态只保留一句信息，不再堆叠标题、操作说明和重复的同步状态。
            this.title.string = !cmd.sessionReady ? '连接恢复后自动同步任务' : this.expectedNextId ? '正在等待下一项任务…'
                : syncing ? '正在同步任务…' : cmd.tasksLoaded ? '暂无进行中的任务' : '等待任务同步…';
            this.detail.string = '';
            this.progress.string = '';
            button.interactable = false;
        }
        this.claimable = claimable;
        this.arrange();
        this.detail.node.active = !!this.current;
        this.progress.node.active = !!this.current;
        this.drawRewardGlow(claimable, claiming);
        const surface = inkSurface(this.node, 'TaskSurface', this.width, this.height,
            new Color(28, 33, 29, 250), claimable ? new Color(115, 171, 125, 160) : new Color(153, 134, 91, 90));
        surface.lineWidth = 1; surface.strokeColor = new Color(153, 134, 91, 55);
        surface.moveTo(-this.width / 2 + 14, this.height / 2 - 44);
        surface.lineTo(this.width / 2 - 14, this.height / 2 - 44); surface.stroke();
        const width = this.track.node.getComponent(UITransform).width;
        this.track.clear();
        if (this.current) {
            this.track.fillColor = new Color(112, 112, 85, 90); this.track.rect(-width / 2, -1.5, width, 3); this.track.fill();
            if (ratio > 0) { this.track.fillColor = claimable ? READY_GREEN : C.gold; this.track.rect(-width / 2, -1.5, width * ratio, 3); this.track.fill(); }
        }
    }

    private activate(): void {
        const cmd = ProgressionCommand.getInstance();
        if (!cmd.sessionReady) return;
        this.render();
        if (this.current) {
            const task = cmd.tasks.get(this.current.taskId);
            if (!task) { this.render(); return; }
            if (task.state === 1) {
                if (cmd.requestInFlight(`task:${task.taskId}`)) { this.render(); return; }
                AudioManager.instance.playClick();
                if (!cmd.claimTask(task.taskId)) EventMgr.emit(E.showToast, '暂时无法领取，请稍后重试');
            } else if (task.state === 0) {
                const info = taskPresentation(task);
                if (info.jump > 0) {
                    AudioManager.instance.playClick();
                    EventMgr.emit(E.executeTaskJump, { task, jump: info.jump, cond: info.cond });
                }
            }
        }
        this.render();
    }
}
