import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import ProgressionCommand, { TaskInfo } from '../../progression/ProgressionCommand';
import { taskPresentation, trackedTask } from '../../progression/ProgressionPresentation';
import { LogicEvent as E } from '../../common/LogicEvent';
import { ServerConfig as S } from '../../config/ServerConfig';
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { caption, inkSurface, ManagementColors as C, place, textStyle } from './ManagementStyle';

const { ccclass } = _decorator;
const HEIGHT = 132;

/** 地图左侧单任务追踪：只发送领奖请求，服务端确认后再切换后续任务。 */
@ccclass('MapTaskTracker')
export default class MapTaskTracker extends Component {
    private body: Node;
    private all: Node;
    private category: Label;
    private title: Label;
    private detail: Label;
    private progress: Label;
    private action: Label;
    private track: Graphics;
    private current: TaskInfo | null = null;
    private expectedNextId = 0;
    private width = 252;
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
        caption(this.all, 'Caption', '全部', 0, 0, 44, 12, C.muted, Label.HorizontalAlign.CENTER);
        this.all.on(Button.EventType.CLICK, () => this.openList?.());
        this.body = this.make('TaskAction');
        const button = this.body.addComponent(Button);
        button.transition = Button.Transition.SCALE; button.zoomScale = .985; button.duration = .1;
        this.body.on(Button.EventType.CLICK, () => this.activate());
        this.title = caption(this.body, 'TaskTitle', '', 0, 32, 224, 17);
        this.detail = caption(this.body, 'TaskDetail', '', 0, 0, 224, 13, C.muted);
        this.progress = caption(this.body, 'ProgressText', '', 0, -34, 90, 12, C.muted);
        this.action = caption(this.body, 'ActionText', '', 0, -34, 100, 13, C.gold, Label.HorizontalAlign.RIGHT);
        this.track = this.make('ProgressTrack', this.body).addComponent(Graphics);
        EventMgr.on(E.updateTasks, this.queueRefresh, this);
        EventMgr.on(E.protocolRequestChanged, this.queueRefresh, this);
    }

    /** 与 HUD 共用坐标；窄屏资源栏占第二行时，卡片相应下移。 */
    layout(viewWidth: number, viewHeight: number): void {
        if (!this.body) return;
        this.width = Math.min(252, Math.max(1, viewWidth - 24));
        const topInset = viewWidth < 860 ? 128 : 88;
        place(this.node, -viewWidth / 2 + 12 + this.width / 2, viewHeight / 2 - topInset - HEIGHT / 2, this.width, HEIGHT);
        place(this.body, 0, -22, this.width, 88);
        // 全部按钮与领奖区域分开，避免点开列表时同时触发领奖。
        place(this.all, this.width / 2 - 28, 44, 44, 44);
        textStyle(this.category, -24, 44, this.width - 76, 12, C.gold);
        textStyle(this.title, 0, 32, this.width - 28, 17, C.text, Label.HorizontalAlign.LEFT, 24);
        this.title.overflow = Label.Overflow.SHRINK;
        textStyle(this.detail, 0, 0, this.width - 28, 13, C.muted, Label.HorizontalAlign.LEFT, 36);
        this.detail.enableWrapText = true; this.detail.lineHeight = 18; this.detail.overflow = Label.Overflow.SHRINK;
        textStyle(this.progress, -this.width / 2 + 60, -34, 92, 12, C.muted, Label.HorizontalAlign.LEFT, 20);
        this.progress.overflow = Label.Overflow.SHRINK;
        textStyle(this.action, this.width / 2 - 68, -34, 108, 13, C.gold, Label.HorizontalAlign.RIGHT, 20);
        place(this.track.node, 0, -21, this.width - 28, 3);
        this.render();
    }

    private queueRefresh(): void {
        // ACK 与紧随其后的全量可能在同一帧到达，先记住完成状态，避免列表移除旧项后丢失后续目标。
        this.rememberCompletion(ProgressionCommand.getInstance());
        if (this.queued || !this.node.activeInHierarchy) return;
        this.queued = true;
        this.scheduleOnce(() => { this.queued = false; if (this.isValid) this.render(); }, 0);
    }

    protected onEnable(): void { if (this.body) this.render(); }
    protected onDestroy(): void { EventMgr.targetOff(this); this.openList = null; }

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
        let claimable = false, ratio = 0;
        this.progress.string = '';
        if (this.current) {
            const task = this.current, info = taskPresentation(task), busy = cmd.requestInFlight(`task:${task.taskId}`);
            claimable = task.state === 1;
            this.category.string = { 1: '主线任务', 2: '日常任务', 3: '周常任务' }[task.taskType];
            this.title.string = info.name; this.detail.string = info.detail;
            const value = Math.min(info.target, Math.max(0, task.progress));
            ratio = claimable ? 1 : value / info.target;
            this.progress.string = claimable ? '已完成' : `${value} / ${info.target}`;
            this.action.string = busy ? '领取中…' : claimable ? '点击领取' : '进行中';
            button.interactable = cmd.sessionReady && claimable && !busy;
        } else {
            this.category.string = this.expectedNextId ? '主线任务' : '任务';
            this.title.string = !cmd.sessionReady ? '任务暂不可用' : this.expectedNextId ? '任务已领取'
                : syncing ? '任务同步中' : cmd.tasksLoaded ? '暂无可进行任务' : '任务尚未同步';
            this.detail.string = !cmd.sessionReady ? '连接恢复后同步任务' : this.expectedNextId
                ? '正在等待下一项任务' : syncing ? '正在获取当前任务进度' : '可从「全部」查看任务列表';
            this.action.string = !cmd.sessionReady ? '等待连接' : syncing ? '同步中…' : '点击刷新';
            button.interactable = cmd.sessionReady && !syncing;
        }
        this.action.color = claimable ? C.gold : C.muted;
        const surface = inkSurface(this.node, 'TaskSurface', this.width, HEIGHT,
            new Color(28, 33, 27, 220), claimable ? C.gold : new Color(153, 134, 91, 100));
        surface.fillColor = claimable ? C.gold : new Color(137, 125, 83, 180);
        surface.rect(-this.width / 2, -HEIGHT / 2 + 12, 2, HEIGHT - 24); surface.fill();
        const width = this.width - 28;
        this.track.clear();
        if (this.current) {
            this.track.fillColor = new Color(112, 112, 85, 90); this.track.rect(-width / 2, -1.5, width, 3); this.track.fill();
            if (ratio > 0) { this.track.fillColor = C.gold; this.track.rect(-width / 2, -1.5, width * ratio, 3); this.track.fill(); }
        }
    }

    private activate(): void {
        const cmd = ProgressionCommand.getInstance();
        if (!cmd.sessionReady) return;
        this.render();
        if (this.current) {
            const task = cmd.tasks.get(this.current.taskId);
            if (task?.state !== 1 || cmd.requestInFlight(`task:${task.taskId}`)) { this.render(); return; }
            AudioManager.instance.playClick();
            if (!cmd.claimTask(task.taskId)) EventMgr.emit(E.showToast, '暂时无法领取，请稍后重试');
        } else if (!cmd.requestInFlight(S.c2s_req_task_list)) {
            AudioManager.instance.playClick(); cmd.requestTasks();
        }
        this.render();
    }
}
