import ProtocolCommand, { hasId, idKey } from '../network/pto/ProtocolCommand';
import SnapshotStore from '../network/pto/SnapshotStore';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';

export interface ReportBrief {
    reportId: number | string; reportType: number; targetType: number; targetId: number | string;
    result: number; time: number; isRead: boolean; pos: { x: number; y: number }; atkPower: number; defPower: number;
}
export interface ReportInfo {
    brief: ReportBrief; atkSide: any; defSide: any; rewardList: any[]; replay: any;
}
export default class BattleCommand extends ProtocolCommand {
    private static instance: BattleCommand;
    static getInstance(): BattleCommand { return this.instance || (this.instance = new BattleCommand()); }
    readonly reports = new SnapshotStore<ReportBrief>(r => idKey(r.reportId));
    readonly details = new Map<string, ReportInfo>();
    readonly replays = new Map<string, any>();
    private deletedReports = new Set<string>();
    private confirmedRead = new Set<string>();
    private readingIds: string[] | null = null;
    private readQueue = new Set<string>();
    public loaded = false;
    public loadError = '';
    public get loading(): boolean { return this.isPending(S.c2s_req_report_list); }
    public get unreadCount(): number { return this.reports.values().filter(r => !r.isRead).length; }
    readonly battles = new Map<string, { start?: any; result?: any; skipped?: boolean }>();
    constructor() {
        super();
        this.listen(S.s2c_battle_start, d => {
            if (!hasId(d.battleId)) return;
            const state = this.battles.get(idKey(d.battleId)) || {};
            if (state.start || state.result) return;
            state.start = d; this.saveBattle(d.battleId, state); EventMgr.emit(E.battleStarted, d);
        });
        this.listen(S.s2c_battle_result, d => {
            if (!hasId(d.battleId)) return;
            const state = this.battles.get(idKey(d.battleId)) || {};
            if (state.result) return;
            state.result = d; this.saveBattle(d.battleId, state); EventMgr.emit(E.battleFinished, d);
            if (hasId(d.reportId) && !this.reports.get(d.reportId)) this.requestReports();
            // 奖励由 Reward.s2c_show_reward / 资源同步处理；这里仅展示战斗结果。
        });
        this.listen(S.s2c_battle_skip, d => {
            this.finish(`skip:${idKey(d.battleId)}`);
            const state = this.battles.get(idKey(d.battleId));
            if (state) state.skipped = true;
            EventMgr.emit(E.battleSkipped, d.battleId);
        });
        this.listen(S.s2c_req_report_list, d => {
            this.reports.replace((d.reportList || []).filter(r => hasId(r.reportId) && !this.deletedReports.has(idKey(r.reportId)))
                .map(r => this.mergeRead(r)));
            this.loaded = true; this.loadError = ''; this.finish(S.c2s_req_report_list);
            const ids = new Set(this.reports.values().map(r => idKey(r.reportId)));
            this.details.forEach((_v, id) => { if (!ids.has(id)) { this.details.delete(id); this.replays.delete(id); } });
            this.notify();
        });
        this.listen(S.s2c_sync_report, d => {
            if (d.reportBrief && hasId(d.reportBrief.reportId) && !this.deletedReports.has(idKey(d.reportBrief.reportId))) { this.reports.put(this.mergeRead(d.reportBrief)); this.notify(); }
        });
        this.listen(S.s2c_req_report_detail, d => {
            const r: ReportInfo = d.reportInfo;
            if (!r?.brief || !hasId(r.brief.reportId)) return;
            const id = idKey(r.brief.reportId);
            this.finish(`detail:${id}`);
            if (this.deletedReports.has(id)) return;
            r.brief = this.mergeRead(r.brief);
            this.details.set(id, r); this.reports.put(r.brief);
            if (r.replay) this.replays.set(id, r.replay);
            this.notify(); EventMgr.emit(E.updateReportDetail, r);
        });
        this.listen(S.s2c_req_report_replay, d => {
            this.finish(`replay:${idKey(d.reportId)}`);
            if (this.deletedReports.has(idKey(d.reportId))) return;
            if (d.replay) this.replays.set(idKey(d.reportId), d.replay);
            EventMgr.emit(E.updateReportReplay, d.reportId, d.replay);
        });
        this.listen(S.s2c_read_report, d => {
            const ids = (d.reportIdList || []).length ? d.reportIdList : this.readingIds || [];
            // 重复的旧确认只合并已读状态，不能解锁正在处理的另一批请求。
            const completesPending = !!this.readingIds && this.readingIds.every(id => ids.some(value => idKey(value) === id));
            if (completesPending) { this.readingIds = null; this.finish(S.c2s_read_report); }
            for (const id of ids) {
                this.confirmedRead.add(idKey(id));
                this.readQueue.delete(idKey(id));
                const brief = this.reports.get(id);
                if (brief) this.reports.put({ ...brief, isRead: true });
                const detail = this.details.get(idKey(id));
                if (detail) detail.brief = { ...detail.brief, isRead: true };
            }
            this.notify();
            this.flushReads();
        });
        this.listen(S.s2c_del_report, d => {
            this.finish(S.c2s_del_report);
            for (const id of d.reportIdList || []) {
                this.deletedReports.add(idKey(id));
                this.readQueue.delete(idKey(id)); this.confirmedRead.delete(idKey(id));
                this.reports.remove(id); this.details.delete(idKey(id)); this.replays.delete(idKey(id));
            }
            this.notify();
        });
    }
    protected reset(): void {
        this.reports.clear(); this.details.clear(); this.replays.clear(); this.battles.clear(); this.deletedReports.clear();
        this.confirmedRead.clear(); this.readingIds = null; this.readQueue.clear(); this.loaded = false; this.loadError = '';
        this.notify();
    }
    protected onSessionReady(): void { this.requestReports(); }
    private notify(): void { EventMgr.emit(E.upateWarReport); }
    private mergeRead(brief: ReportBrief): ReportBrief {
        const id = idKey(brief.reportId);
        const isRead = !!brief.isRead || this.confirmedRead.has(id) || !!this.reports.get(id)?.isRead;
        if (isRead) this.confirmedRead.add(id);
        return { ...brief, isRead };
    }
    private saveBattle(id: any, state: any): void {
        this.battles.set(idKey(id), state);
        if (this.battles.size > 100) {
            const completed = Array.from(this.battles.entries()).find(([key, value]) => key !== idKey(id) && !!value.result);
            if (completed) this.battles.delete(completed[0]);
        }
    }
    skip(battleId: number | string): boolean {
        const battle = this.battles.get(idKey(battleId));
        return !!battle?.start && !battle.result && !battle.skipped && this.request(S.c2s_battle_skip, { battleId }, `skip:${idKey(battleId)}`);
    }
    requestReports(): boolean {
        if (this.isPending(S.c2s_req_report_list)) return false;
        this.loadError = '';
        this.reports.begin();
        // 列表回包不含筛选条件，拉全量后在本地筛选，避免并发串页。
        const sent = this.request(S.c2s_req_report_list, { reportType: 0 }, S.c2s_req_report_list, () => {
            this.reports.cancel(); this.loadError = '战报同步超时，请重试'; this.notify();
        });
        if (!sent) { this.reports.cancel(); this.loadError = '暂时无法同步战报'; this.notify(); }
        return sent;
    }
    getReports(type = 0): ReportBrief[] {
        return this.reports.values().filter(r => !type || r.reportType === type).sort((a, b) => b.time - a.time);
    }
    requestDetail(reportId: number | string): boolean { return hasId(reportId) && this.request(S.c2s_req_report_detail, { reportId }, `detail:${idKey(reportId)}`); }
    requestReplay(reportId: number | string): boolean { return hasId(reportId) && this.request(S.c2s_req_report_replay, { reportId }, `replay:${idKey(reportId)}`); }
    readReports(reportIdList: Array<number | string> = []): boolean {
        if (!this.sessionReady || !reportIdList.every(hasId)) return false;
        // 全部已读固定为点击时已知的未读 ID，途中推送的新战报继续保留红点。
        const ids = reportIdList.length ? reportIdList : this.reports.values().filter(r => !r.isRead).map(r => r.reportId);
        for (const id of ids.map(idKey)) {
            if (this.reports.get(id) && !this.reports.get(id).isRead && (this.readingIds || []).indexOf(id) < 0) this.readQueue.add(id);
        }
        return this.isPending(S.c2s_read_report) || this.flushReads();
    }
    private flushReads(): boolean {
        if (this.isPending(S.c2s_read_report) || !this.readQueue.size) return false;
        const ids = [...this.readQueue]; this.readQueue.clear(); this.readingIds = ids;
        const sent = this.request(S.c2s_read_report, { reportIdList: ids }, S.c2s_read_report, () => {
            this.readingIds = null; this.readQueue.clear(); this.notify();
        });
        if (!sent) { this.readingIds = null; this.readQueue.clear(); }
        return sent;
    }
    deleteReports(reportIdList: Array<number | string>): boolean {
        return reportIdList.length > 0 && reportIdList.every(hasId) && this.request(S.c2s_del_report, { reportIdList });
    }
}
