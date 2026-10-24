import ProtocolCommand, { hasId, idKey, uint } from '../network/pto/ProtocolCommand';
import SnapshotStore from '../network/pto/SnapshotStore';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import LoginCommand from '../login/LoginCommand';
import { resourceLandConfig, resourceLandForCell } from './ResourceLand';

/** 路径中的p_pos_f保留小数；只有目的格和视野中心使用整数坐标。 */
export interface WorldPosition { x: number; y: number; }
export interface MarchInfo {
    troopIdx: number; targetType: number; targetId: number | string;
    startPos: WorldPosition; endPos: WorldPosition; startTime: number; endTime: number;
    state: number; path: WorldPosition[];
}
export interface WorldEntity {
    entityId: number | string; entityType: number; ownerId: number | string; cfgId: number;
    pos: WorldPosition; path: WorldPosition[]; startTime: number; endTime: number;
}

export default class WorldCommand extends ProtocolCommand {
    private static instance: WorldCommand;
    static getInstance(): WorldCommand { return this.instance || (this.instance = new WorldCommand()); }
    readonly marches = new SnapshotStore<MarchInfo>(m => String(m.troopIdx));
    readonly entities = new Map<string, WorldEntity>();
    private focusPos: WorldPosition | null = null;
    private lastFocus = '';
    private focusTimer: ReturnType<typeof setTimeout> | null = null;
    constructor() {
        super();
        this.listen(S.s2c_req_march_list, d => {
            this.finish(S.c2s_req_march_list); this.marches.replace(d.marchList || []); this.notifyMarches();
        });
        [S.s2c_march, S.s2c_sync_march].forEach(name => this.listen(name, d => {
            if (!d.marchInfo || !uint(d.marchInfo.troopIdx)) return;
            if (name === S.s2c_march) this.finish(`march:${d.marchInfo.troopIdx}`);
            this.marches.put(d.marchInfo); this.notifyMarches();
        }));
        this.listen(S.s2c_cancel_march, d => {
            this.finish(`march:${d.troopIdx}`);
            if (d.marchInfo) this.marches.put(d.marchInfo);
            else this.marches.remove(d.troopIdx);
            this.notifyMarches();
        });
        [S.s2c_aoi_enter, S.s2c_aoi_update].forEach(name => this.listen(name, d => {
            for (const entity of d.entities || []) if (hasId(entity.entityId)) this.entities.set(idKey(entity.entityId), entity);
            EventMgr.emit(E.updateWorldEntities, Array.from(this.entities.values()));
        }));
        this.listen(S.s2c_aoi_leave, d => {
            for (const id of d.entityIds || []) this.entities.delete(idKey(id));
            EventMgr.emit(E.updateWorldEntities, Array.from(this.entities.values()));
        });
        EventMgr.on(E.updateCityPosition, this.focus, this);
        EventMgr.on(E.mapEenterChange, this.focus, this);
    }
    protected reset(): void {
        this.marches.clear(); this.entities.clear(); this.focusPos = null; this.lastFocus = '';
        if (this.focusTimer !== null) clearTimeout(this.focusTimer);
        this.focusTimer = null;
    }
    protected onSessionReady(): void {
        this.requestMarches();
        this.focus(this.focusPos || LoginCommand.getInstance().proxy.getRoleData()?.cityPos);
    }
    private notifyMarches(): void { EventMgr.emit(E.updateMarches, this.marches.values()); }
    requestMarches(): boolean {
        if (this.isPending(S.c2s_req_march_list)) return false;
        this.marches.begin();
        const sent = this.request(S.c2s_req_march_list, {}, S.c2s_req_march_list, () => this.marches.cancel());
        if (!sent) this.marches.cancel();
        return sent;
    }
    march(troopIdx: number, targetType: number, targetId: number | string, targetPos: WorldPosition): boolean {
        if (!uint(troopIdx) || [1, 2, 3].indexOf(targetType) < 0 || !this.validPos(targetPos) || (targetType !== 1 && !hasId(targetId))) return false;
        return this.request(S.c2s_march, { troopIdx, targetType, targetId, targetPos }, `march:${troopIdx}`, () => this.requestMarches());
    }
    cancelMarch(troopIdx: number): boolean {
        return uint(troopIdx) && this.request(S.c2s_cancel_march, { troopIdx }, `march:${troopIdx}`, () => this.requestMarches());
    }
    resourceLandAt(x: number, y: number): WorldEntity | undefined {
        const matches = Array.from(this.entities.values()).filter(e => e.entityType === 4 && e.pos?.x === x && e.pos?.y === y);
        return matches.length === 1 ? matches[0] : undefined;
    }
    resourceLandIssue(x: number, y: number, mapType: number, level: number): string {
        const cfg = resourceLandForCell(mapType, level);
        if (!cfg) return mapType === 54 ? '石料资源配置尚未同步，请稍后重试' : '资源地配置尚未同步，请稍后重试';
        const entity = this.resourceLandAt(x, y);
        if (!entity) return '正在等待服务器同步该资源地，请稍后重试';
        if (entity.cfgId !== cfg.Id) return '地图资源配置与服务器不一致，请更新地图配置';
        const role = LoginCommand.getInstance().proxy.getRoleData();
        if (hasId(role?.userId) && idKey(entity.ownerId) === idKey(role.userId)) return '这块资源地已归你所有';
        if (role && cfg.OpenCond?.level && role.level < cfg.OpenCond.level) return `主公达到${cfg.OpenCond.level}级后可占领`;
        return '';
    }
    occupyResourceLand(troopIdx: number, entityId: number | string): boolean {
        const entity = this.entities.get(idKey(entityId));
        const cfg = entity && resourceLandConfig(entity.cfgId);
        const role = LoginCommand.getInstance().proxy.getRoleData();
        if (!entity || entity.entityType !== 4 || !cfg || this.marches.get(troopIdx)?.state === 1
            || hasId(role?.userId) && idKey(entity.ownerId) === idKey(role.userId)
            || role && cfg.OpenCond?.level && role.level < cfg.OpenCond.level) return false;
        return this.march(troopIdx, 3, entity.entityId, entity.pos);
    }
    /** 地图格子坐标，250ms 合并拖动上报；不用像素坐标代替格坐标。 */
    focus(pos: WorldPosition): void {
        if (!this.validPos(pos)) return;
        this.focusPos = { x: pos.x, y: pos.y };
        if (!this.ready || this.focusTimer !== null) return;
        this.focusTimer = setTimeout(() => {
            this.focusTimer = null;
            const p = this.focusPos;
            if (!p) return;
            const key = `${p.x},${p.y}`;
            if (key !== this.lastFocus && this.send(S.c2s_aoi_focus, { pos: p })) this.lastFocus = key;
        }, 250);
    }
    private validPos(pos: WorldPosition): boolean {
        return !!pos && Number.isInteger(pos.x) && Number.isInteger(pos.y) && pos.x >= 0 && pos.y >= 0 && pos.x < 1000 && pos.y < 1000;
    }
}
