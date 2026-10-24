import ProtocolCommand from '../network/pto/ProtocolCommand';
import SnapshotStore from '../network/pto/SnapshotStore';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';

export interface TaskInfo { taskId: number; taskType: number; progress: number; state: number; }
export interface ActivityInfo {
    activityId: number; state: number; progress: number; startTime: number; endTime: number;
    gotList: number[]; extraMap: { [index: string]: number };
}
export default class ProgressionCommand extends ProtocolCommand {
    private static instance: ProgressionCommand;
    static getInstance(): ProgressionCommand { return this.instance || (this.instance = new ProgressionCommand()); }
    readonly tasks = new SnapshotStore<TaskInfo>(t => String(t.taskId));
    readonly activities = new SnapshotStore<ActivityInfo>(a => String(a.activityId));
    private refreshActivitiesAgain = false;
    private refreshTasksAgain = false;
    public tasksLoaded = false;
    constructor() {
        super();
        this.listen(S.s2c_req_task_list, d => {
            this.finish(S.c2s_req_task_list); this.tasks.replace(d.taskList || []); this.tasksLoaded = true; this.notifyTasks();
            if (this.refreshTasksAgain) { this.refreshTasksAgain = false; this.requestTasks(); }
        });
        this.listen(S.s2c_sync_task, d => { if (d.taskInfo) { this.tasks.put(d.taskInfo); this.notifyTasks(); } });
        this.listen(S.s2c_get_task_reward, d => {
            const task = this.tasks.get(d.taskId);
            const refresh = this.isPending(`task:${d.taskId}`) || !!task && task.state !== 2;
            if (task) this.tasks.put({ ...task, state: 2 });
            this.finish(`task:${d.taskId}`);
            this.notifyTasks();
            // 领取后补齐新解锁任务；若旧全量还在路上，等它结束后只追加一次查询。
            if (refresh) {
                if (this.isPending(S.c2s_req_task_list)) this.refreshTasksAgain = true;
                else this.requestTasks();
            }
        });
        this.listen(S.s2c_req_activity_list, d => {
            this.finish(S.c2s_req_activity_list); this.activities.replace(d.activityList || []); this.notifyActivities();
            if (this.refreshActivitiesAgain) { this.refreshActivitiesAgain = false; this.requestActivities(); }
        });
        this.listen(S.s2c_sync_activity, d => { if (d.activityInfo) { this.activities.put(d.activityInfo); this.notifyActivities(); } });
        [S.s2c_get_activity_reward, S.s2c_activity_exchange].forEach(name => this.listen(name, d => {
            this.finish(`activity:${d.activityId}:${d.index}`);
            if (name === S.s2c_get_activity_reward) {
                const activity = this.activities.get(d.activityId);
                if (activity) this.activities.put({ ...activity, gotList: Array.from(new Set([...(activity.gotList || []), d.index])) });
                this.notifyActivities();
            }
            // 兑换计数可能已由 sync 更新，ACK 不再累加，重取权威状态。
            if (this.isPending(S.c2s_req_activity_list)) this.refreshActivitiesAgain = true;
            else this.requestActivities();
        }));
    }
    protected reset(): void {
        this.tasks.clear(); this.activities.clear(); this.refreshActivitiesAgain = false;
        this.tasksLoaded = false; this.refreshTasksAgain = false;
    }
    // 活动暂不开放：保留协议定义，登录不拉取活动，也没有活动操作入口。
    protected onSessionReady(): void { this.requestTasks(); }
    private notifyTasks(): void { EventMgr.emit(E.updateTasks, this.tasks.values()); }
    private notifyActivities(): void { EventMgr.emit(E.updateActivities, this.activities.values()); }
    requestTasks(): boolean {
        if (this.isPending(S.c2s_req_task_list)) return false;
        this.tasks.begin();
        // 回包不带 taskType，统一拉全量，界面按 getTasks(type) 筛选。
        const ok = this.request(S.c2s_req_task_list, { taskType: 0 }, S.c2s_req_task_list, () => this.tasks.cancel());
        if (!ok) this.tasks.cancel();
        return ok;
    }
    getTasks(type = 0): TaskInfo[] { return this.tasks.values().filter(t => !type || t.taskType === type); }
    claimTask(taskId: number): boolean {
        return this.tasks.get(taskId)?.state === 1 && this.request(S.c2s_get_task_reward, { taskId }, `task:${taskId}`);
    }
    requestActivities(): boolean {
        if (this.isPending(S.c2s_req_activity_list)) return false;
        this.activities.begin();
        const ok = this.request(S.c2s_req_activity_list, {}, S.c2s_req_activity_list, () => this.activities.cancel());
        if (!ok) this.activities.cancel();
        return ok;
    }
    claimActivity(activityId: number, index = 0): boolean {
        const a = this.activities.get(activityId);
        // 已结束的冲榜等活动仍可能允许结算领奖，具体时间/门槛交由服务端校验。
        return !!a && (a.state === 1 || a.state === 2) && Number.isInteger(index) && index >= 0 && index <= 0x7fffffff && (a.gotList || []).indexOf(index) < 0
            && this.request(S.c2s_get_activity_reward, { activityId, index }, `activity:${activityId}:${index}`);
    }
    exchange(activityId: number, index: number, count = 1): boolean {
        const a = this.activities.get(activityId);
        return !!a && a.state === 1 && Number.isInteger(index) && index >= 0 && index <= 0x7fffffff && Number.isInteger(count) && count > 0 && count <= 0x7fffffff
            && this.request(S.c2s_activity_exchange, { activityId, index, count }, `activity:${activityId}:${index}`);
    }
}
