import ProtocolCommand from '../network/pto/ProtocolCommand';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';

/** 全量查询建立建筑快照，增量推送只更新已确认的服务器等级。 */
export default class BuildCommand extends ProtocolCommand {
    private static instance: BuildCommand;
    static getInstance(): BuildCommand { return this.instance || (this.instance = new BuildCommand()); }
    readonly levels = new Map<number, number>();
    loaded = false;
    loadError = '';
    private changes: Map<number, number> | null = null;
    get loading(): boolean { return this.requestInFlight(S.c2s_req_build); }
    constructor() {
        super();
        this.listen(S.s2c_req_build, d => {
            if (!this.loading) return;
            if (!Array.isArray(d.buildList) || !d.buildList.every(row => this.valid(row))) {
                this.changes = null;
                this.loadError = '建筑信息读取失败，请重试';
                this.finish(S.c2s_req_build);
                EventMgr.emit(E.updateCityBuilds);
                return;
            }
            const snapshot = new Map<number, number>(d.buildList.map(row => [row.bid, row.level]));
            this.changes?.forEach((level, bid) => snapshot.set(bid, level));
            this.levels.clear();
            snapshot.forEach((level, bid) => this.levels.set(bid, level));
            this.changes = null;
            this.loaded = true;
            this.loadError = '';
            this.finish(S.c2s_req_build);
            EventMgr.emit(E.updateCityBuilds);
        });
        this.listen(S.s2c_sync_build, d => {
            if (!this.valid(d)) return;
            this.levels.set(d.bid, d.level);
            this.changes?.set(d.bid, d.level);
            this.finish(`build:${d.bid}`);
            EventMgr.emit(E.updateCityBuilds, d);
        });
    }
    protected onSessionReady(): void { this.requestBuildings(); }
    protected reset(): void {
        this.levels.clear(); this.changes = null; this.loaded = false; this.loadError = '';
        EventMgr.emit(E.updateCityBuilds);
    }
    private valid(row: any): boolean {
        return row && Number.isInteger(row.bid) && row.bid > 0 && row.bid <= 0x7fffffff
            && Number.isInteger(row.level) && row.level >= 0 && row.level <= 0x7fffffff;
    }
    requestBuildings(): boolean {
        if (!this.sessionReady || this.loading) return false;
        this.changes = new Map(); this.loadError = '';
        const sent = this.request(S.c2s_req_build, {}, S.c2s_req_build, () => {
            this.changes = null;
            this.loadError = '建筑信息读取超时，请重试';
            EventMgr.emit(E.updateCityBuilds);
        });
        if (!sent) { this.changes = null; this.loadError = '建筑信息请求未发送，请重试'; }
        EventMgr.emit(E.updateCityBuilds);
        return sent;
    }
    create(bid: number): boolean { return this.change(S.c2s_create_build, bid); }
    upgrade(bid: number): boolean { return this.change(S.c2s_up_build, bid); }
    private change(name: string, bid: number): boolean {
        if (!this.loaded || this.loading || this.loadError) return false;
        const exists = (this.levels.get(bid) || 0) > 0;
        if (name === S.c2s_create_build ? exists : !exists) return false;
        return Number.isInteger(bid) && bid > 0 && bid <= 0x7fffffff && this.request(name, { bid }, `build:${bid}`);
    }
}
