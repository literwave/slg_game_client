import ProtocolCommand, { hasId, idKey, uint } from '../network/pto/ProtocolCommand';
import SnapshotStore from '../network/pto/SnapshotStore';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import LoginCommand from '../login/LoginCommand';
import { resourceLandForCell } from './ResourceLand';

/** 路径中的p_pos_f保留小数；只有目的格和视野中心使用整数坐标。 */
export interface WorldPosition { x: number; y: number; }
/** 与 game_common 的 TargetType 配置一致；坐标移动不需要实体 ID。 */
export enum MarchTargetType { ReturnCity = 1, AttackMonster = 2, OccupyResource = 3, Move = 4 }
export interface MarchInfo {
    troopIdx: number; targetType: number; targetId: number | string;
    startPos: WorldPosition; endPos: WorldPosition; startTime: number; endTime: number;
    state: number; path: WorldPosition[];
}
export interface WorldEntity {
    entityId: number | string; entityType: number; ownerId: number | string; cfgId: number;
    pos: WorldPosition; path: WorldPosition[]; startTime: number; endTime: number;
    /** 主城的玩家名/城名；由 AOI enter/update 同步。其他实体可不填。 */
    name?: string;
    /** 主城建筑等级（BuildingDetail.Id=1），不是角色等级。 */
    level?: number;
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
            this.notifyEntities();
        }));
        this.listen(S.s2c_aoi_leave, d => {
            for (const id of d.entityIds || []) this.entities.delete(idKey(id));
            this.notifyEntities();
        });
        EventMgr.on(E.updateCityPosition, this.focus, this);
        EventMgr.on(E.mapEenterChange, this.focus, this);
    }
    protected reset(): void {
        this.marches.clear(); this.entities.clear(); this.focusPos = null; this.lastFocus = '';
        if (this.focusTimer !== null) clearTimeout(this.focusTimer);
        this.focusTimer = null;
        this.notifyMarches();
        this.notifyEntities();
    }
    protected onSessionReady(): void {
        this.requestMarches();
        this.focus(this.focusPos || LoginCommand.getInstance().proxy.getRoleData()?.cityPos);
    }
    private notifyMarches(): void { EventMgr.emit(E.updateMarches, this.marches.values()); }
    private notifyEntities(): void { EventMgr.emit(E.updateWorldEntities, Array.from(this.entities.values())); }
    requestMarches(): boolean {
        if (this.isPending(S.c2s_req_march_list)) return false;
        this.marches.begin();
        const sent = this.request(S.c2s_req_march_list, {}, S.c2s_req_march_list, () => this.marches.cancel());
        if (!sent) this.marches.cancel();
        return sent;
    }
    march(troopIdx: number, targetType: number, targetId: number | string, targetPos: WorldPosition): boolean {
        const coordinateTarget = targetType === MarchTargetType.ReturnCity || targetType === MarchTargetType.Move;
        if (!uint(troopIdx) || [1, 2, 3, 4].indexOf(targetType) < 0 || !this.validPos(targetPos) || (!coordinateTarget && !hasId(targetId))) return false;
        if (coordinateTarget) targetId = 0;
        return this.request(S.c2s_march, { troopIdx, targetType, targetId, targetPos }, `march:${troopIdx}`, () => this.requestMarches());
    }
    moveTroop(troopIdx: number, targetPos: WorldPosition): boolean {
        const current = this.marches.get(troopIdx);
        if (!this.validPos(targetPos)
            || (current?.state === 1 || current?.state === 2)
            && current.endPos?.x === targetPos.x && current.endPos?.y === targetPos.y) return false;
        return this.march(troopIdx, MarchTargetType.Move, 0, targetPos);
    }
    cancelMarch(troopIdx: number): boolean {
        return uint(troopIdx) && this.request(S.c2s_cancel_march, { troopIdx }, `march:${troopIdx}`, () => this.requestMarches());
    }
    isTroopAtHome(troopIdx: number): boolean {
        const current = this.marches.get(troopIdx);
        if (!current) return true;
        const city = LoginCommand.getInstance().proxy.getRoleData()?.cityPos;
        return current.state !== 1 && this.validPos(city) && current.endPos?.x === city.x && current.endPos?.y === city.y;
    }
    returnToCityIssue(troopIdx: number): string {
        if (!uint(troopIdx)) return '部队信息无效，请重新选择';
        if (!this.ready) return '连接尚未恢复，请稍后重试';
        if (this.isPending(`march:${troopIdx}`)) return '部队指令正在处理，请稍候';
        if (!this.validPos(LoginCommand.getInstance().proxy.getRoleData()?.cityPos)) return '主城坐标尚未同步';
        const current = this.marches.get(troopIdx);
        if (current?.state === 1 && current.targetType === MarchTargetType.ReturnCity) return '部队正在回城';
        if (this.isTroopAtHome(troopIdx)) return '部队已在主城';
        return '';
    }
    /** 取消只适用于进行中的行军；已驻留的部队必须新建 RETURN_CITY 行军。 */
    returnTroopToCity(troopIdx: number): boolean {
        if (this.returnToCityIssue(troopIdx)) return false;
        if (this.marches.get(troopIdx)?.state === 1) return this.cancelMarch(troopIdx);
        const city = LoginCommand.getInstance().proxy.getRoleData().cityPos;
        return this.march(troopIdx, MarchTargetType.ReturnCity, 0, { x: city.x, y: city.y });
    }
    /** 与服务端 CONST.res_land_entity_id 相同：RES_LAND + y * 1000 + x。中立地没有实体，出征仍用这个 id。 */
    resourceLandEntityId(x: number, y: number): number {
        return 4000000000000000 + y * 1000 + x;
    }
    resourceLandAt(x: number, y: number): WorldEntity | undefined {
        const matches = Array.from(this.entities.values()).filter(e => e.entityType === 4 && e.pos?.x === x && e.pos?.y === y);
        return matches.length === 1 ? matches[0] : undefined;
    }
    /**
     * 击败守卫后的占领倒计时（Global.Id=19）。
     * 只读资源地 AOI 的 startTime/endTime；行军时间与占领时间是不同阶段。
     * 倒计时归零后保留确认态，直到服务器清除计时字段。
     */
    occupyCountdownAt(x: number, y: number, nowSec: number): { startTime: number; endTime: number } | null {
        if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isFinite(nowSec)) return null;
        // AOI 的时间清零才是占领结束。客户端倒计时归零不能自行认定成功。
        const active = (start: number, end: number) =>
            Number.isFinite(start) && Number.isFinite(end) && start > 0 && end > start;
        const entity = this.resourceLandAt(x, y);
        if (entity && active(entity.startTime, entity.endTime)) {
            return { startTime: entity.startTime, endTime: entity.endTime };
        }
        // p_march_info.startTime/endTime 是行军时间，不能当成占领时间。
        return null;
    }
    resourceLandIssue(x: number, y: number, mapType: number, level: number): string {
        const cfg = resourceLandForCell(mapType, level);
        if (!cfg) return mapType === 54 ? '石料资源配置尚未同步，请稍后重试' : '资源地配置尚未同步，请稍后重试';
        const entity = this.resourceLandAt(x, y);
        if (entity && entity.cfgId !== cfg.Id) return '地图资源配置与服务器不一致，请更新地图配置';
        const role = LoginCommand.getInstance().proxy.getRoleData();
        if (role && cfg.OpenCond?.level && role.level < cfg.OpenCond.level) return `主公达到${cfg.OpenCond.level}级后可占领`;
        return '';
    }
    /** 已有归属的土地也允许发起攻占，守军、免战和归属变更由服务器判定。 */
    emptyLandIssue(x: number, y: number): string {
        return this.validPos({ x, y }) ? '' : '地块坐标无效，请重新选择';
    }
    occupyResourceLand(troopIdx: number, x: number, y: number): boolean {
        if (!this.validPos({ x, y })) return false;
        return this.march(troopIdx, MarchTargetType.OccupyResource, this.resourceLandEntityId(x, y), { x, y });
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
    /** 重报当前视野；实体增删和属性仍以服务端推送为准，不按旧地图分块查询。 */
    refreshView(): boolean {
        const pos = this.focusPos || LoginCommand.getInstance().proxy.getRoleData()?.cityPos;
        if (!this.ready || !this.validPos(pos)) return false;
        // 显式刷新允许重报相同中心；复用 focus 的定时器合并同时完成的多个建筑。
        this.lastFocus = '';
        this.focus(pos);
        return true;
    }
    private validPos(pos: WorldPosition): boolean {
        return !!pos && Number.isInteger(pos.x) && Number.isInteger(pos.y) && pos.x >= 0 && pos.y >= 0 && pos.x < 1000 && pos.y < 1000;
    }
}
