import ProtocolCommand from '../network/pto/ProtocolCommand';
import SnapshotStore from '../network/pto/SnapshotStore';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import ConfigManager from '../core/ConfigManager';

export interface MapMark { x: number; y: number; }
const key = (pos: MapMark) => `${pos.x},${pos.y}`;
const position = (pos: any): MapMark | null => pos && Number.isInteger(pos.x) && Number.isInteger(pos.y)
    && pos.x >= 0 && pos.y >= 0 && pos.x < 1000 && pos.y < 1000 ? { x: pos.x, y: pos.y } : null;
const WRITE = 'map-mark-write';

/** 标记只按服务器确认增删，坐标唯一；断线和超时均不自动重放写操作。 */
export default class MapMarkCommand extends ProtocolCommand {
    private static instance: MapMarkCommand;
    static getInstance(): MapMarkCommand { return this.instance || (this.instance = new MapMarkCommand()); }
    readonly marks = new SnapshotStore<MapMark>(key);
    private _loaded = false;
    private operation: { add: boolean; pos: MapMark } | null = null;
    error = '';
    get loaded(): boolean { return this._loaded; }
    get loading(): boolean { return this.requestInFlight(S.c2s_req_mark_list); }
    get busy(): boolean { return this.operation !== null; }
    get limit(): number {
        const rows = ConfigManager.getInstance().getConfig('Global');
        const value = Number((Array.isArray(rows) ? rows.find(row => Number(row.Id) === 18) : rows?.[18])?.value1);
        return Number.isSafeInteger(value) && value > 0 ? value : 0;
    }
    constructor() {
        super();
        this.listen(S.s2c_req_mark_list, this.onList);
        this.listen(S.s2c_add_mark, data => this.onChanged(true, data.markInfo?.pos));
        this.listen(S.s2c_del_mark, data => this.onChanged(false, data.pos));
    }
    protected onSessionReady(): void { this.requestList(); }
    protected reset(): void {
        this.marks.clear(); this._loaded = false; this.operation = null; this.error = '';
        this.changed();
    }
    has(pos: MapMark): boolean { return !!position(pos) && !!this.marks.get(key(pos)); }
    pendingAt(pos: MapMark): boolean { return !!this.operation && key(this.operation.pos) === key(pos); }
    requestList(): boolean {
        if (!this.sessionReady || this.loading || this.busy) return false;
        this.marks.begin(); this.error = '';
        const sent = this.request(S.c2s_req_mark_list, {}, S.c2s_req_mark_list, () => {
            this.marks.cancel(); this.error = '标记读取超时，请重试'; this.changed();
        });
        if (!sent) { this.marks.cancel(); this.error = '标记请求未发送，请重试'; }
        this.changed(); return sent;
    }
    add(pos: MapMark): boolean { return this.change(true, pos); }
    remove(pos: MapMark): boolean { return this.change(false, pos); }
    private change(add: boolean, value: MapMark): boolean {
        const pos = position(value);
        const issue = !pos ? '地图坐标无效' : !this.sessionReady ? '连接尚未恢复，请稍后重试'
            : this.busy ? '标记正在处理，请稍候' : this.loading || !this.loaded ? '正在读取标记，请稍后再试'
            : add && this.has(pos) ? '这个位置已经标记' : !add && !this.has(pos) ? '这个位置尚未标记'
            : add && !this.limit ? '标记数量配置尚未就绪'
            : add && this.marks.values().length >= this.limit ? `标记已达上限（${this.limit}个），请先取消其他标记` : '';
        if (issue) { EventMgr.emit(E.showToast, issue); return false; }
        this.operation = { add, pos }; this.error = '';
        const sent = this.request(add ? S.c2s_add_mark : S.c2s_del_mark, { pos }, WRITE, () => {
            this.operation = null; this._loaded = false;
            // 结果不确定时先查全量，避免重复添加或误删；迟到确认仍会合并进快照。
            this.requestList();
        });
        if (!sent) { this.operation = null; this.error = '标记请求未发送，请重试'; EventMgr.emit(E.showToast, this.error); }
        this.changed(); return sent;
    }
    private onList(data: any): void {
        if (!this.loading) return;
        const values: MapMark[] = [];
        const valid = Array.isArray(data.markList) && data.markList.every(mark => {
            const pos = position(mark?.pos); if (!pos) return false; values.push(pos); return true;
        });
        if (valid) { this.marks.replace(values); this._loaded = true; this.error = ''; }
        else { this.marks.cancel(); this.error = '标记数据无效，请重试'; }
        this.finish(S.c2s_req_mark_list); this.changed();
    }
    private onChanged(add: boolean, value: any): void {
        const pos = position(value); if (!pos) return;
        if (add) this.marks.put(pos); else this.marks.remove(key(pos));
        if (this.operation?.add === add && this.pendingAt(pos)) {
            this.operation = null; this.error = ''; this.finish(WRITE);
            EventMgr.emit(E.showToast, add ? '已添加标记' : '已取消标记');
        }
        this.changed();
    }
    private changed(): void { EventMgr.emit(E.updateTag); }
}
