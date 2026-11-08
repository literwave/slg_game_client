import ProtocolCommand, { hasId, idKey, uint } from '../network/pto/ProtocolCommand';
import SnapshotStore from '../network/pto/SnapshotStore';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import LoginCommand from '../login/LoginCommand';
import { resourceLandForCell } from './ResourceLand';
import { TargetTypeEnum } from '../config/enum/TargetTypeEnum';
import { EntityTypeEnum } from '../config/enum/EntityTypeEnum';
import { TroopStateEnum } from '../config/enum/TroopStateEnum';
import CityCommand from './CityCommand';

/** 路径中的p_pos_f保留小数；只有目的格和视野中心使用整数坐标。 */
export interface WorldPosition { x: number; y: number; }
export interface MarchRoutePreview {
    troopIdx: number; targetType: number; targetPos: WorldPosition;
    status: 'loading' | 'ready' | 'unreachable' | 'error';
    path: WorldPosition[]; costTime: number;
}
type RouteSelection = MarchRoutePreview & { originVersion: string };
interface RouteRequest { selection: RouteSelection; expired: boolean; }
/** 与 game_common 的 TargetType 配置一致；坐标移动不需要实体 ID。 */
export enum MarchTargetType {
    ReturnCity = TargetTypeEnum.RETURN_CITY, AttackMonster = TargetTypeEnum.ATTACK_MONSTER,
    OccupyResource = TargetTypeEnum.OCCUPY_RES_LAND, Move = TargetTypeEnum.MOVE,
    AttackCity = TargetTypeEnum.ATTACK_CITY, Redeploy = TargetTypeEnum.REDEPLOY,
}
export interface MarchInfo {
    troopIdx: number; targetType: number; targetId: number | string;
    startPos: WorldPosition; endPos: WorldPosition; startTime: number; endTime: number;
    state: number; path: WorldPosition[];
    /** 与行军 state 分开；攻城期间 state=2、troopState=SIEGE。 */
    troopState?: TroopStateEnum;
}
export interface WorldEntity {
    entityId: number | string; entityType: number; ownerId: number | string; cfgId: number;
    allianceId?: number | string;
    troopState?: TroopStateEnum;
    troopIdx?: number;
    targetId?: number | string;
    targetPos?: WorldPosition;
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
    private reconcileSnapshot: (() => void) | null = null;
    private pathRequests = new Map<string, WorldEntity>();
    private failedPaths = new Map<string, string>();
    private routeSelection: RouteSelection | null = null;
    private routeRequests = new Map<string, RouteRequest[]>();
    get marchRoute(): MarchRoutePreview | null { return this.routeSelection; }
    constructor() {
        super();
        CityCommand.getInstance();
        this.listen(S.s2c_req_march_list, d => {
            if (!Array.isArray(d.marchList) || !d.marchList.every(row => row && uint(row.troopIdx))) return;
            const reconcile = this.reconcileSnapshot;
            this.reconcileSnapshot = null;
            this.finish(S.c2s_req_march_list); this.marches.replace(d.marchList || []);
            reconcile?.(); this.notifyMarches();
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
            for (const entity of d.entities || []) {
                if (!hasId(entity?.entityId)) continue;
                const id = idKey(entity.entityId), previous = this.entities.get(id);
                // 同一次行军的 AOI 简报可以不带路线；改道、驻留和重新进入视野不能沿用旧路。
                if (name === S.s2c_aoi_update && previous && this.pathVersion(previous) === this.pathVersion(entity)
                    && this.isMovingEntity(entity) && !this.validPath(entity.path) && this.validPath(previous.path)) {
                    entity.path = previous.path;
                }
                this.entities.set(id, entity);
                this.requestMarchPath(entity.entityId);
            }
            this.notifyEntities();
        }));
        this.listen(S.s2c_req_march_path, d => {
            const id = idKey(d.entityId), requested = this.pathRequests.get(id);
            if (!requested) return;
            this.pathRequests.delete(id); this.finish(`march-path:${id}`);
            const current = this.entities.get(id);
            if (!current || !this.isMovingEntity(current)) return;
            // 回包没有版本号：同实体只允许一个查询在途，旧行军的回包结束后才能查询新路线。
            if (this.pathVersion(current) !== this.pathVersion(requested)) {
                this.requestMarchPath(current.entityId); return;
            }
            if (!this.validPath(d.path)) { this.failedPaths.set(id, this.pathVersion(current)); return; }
            if (!this.validPath(current.path)) {
                current.path = d.path.map(p => ({ x: p.x, y: p.y }));
                this.failedPaths.delete(id); this.notifyEntities();
            }
        });
        this.listen(S.s2c_aoi_leave, d => {
            for (const id of d.entityIds || []) {
                const key = idKey(id); this.entities.delete(key); this.failedPaths.delete(key);
                // 留下在途请求锁，防止同一实体迅速重新进入时把旧回包认成新查询。
                const pending = this.pathRequests.get(key);
                if (pending) this.pathRequests.set(key, { ...pending, startTime: -1 });
            }
            this.notifyEntities();
        });
        this.listen(S.s2c_req_march_route, this.receiveMarchRoute);
        EventMgr.on(E.updateMyRole, this.refreshMarchRoute, this);
        EventMgr.on(E.updateCityPosition, this.focus, this);
        EventMgr.on(E.mapEenterChange, this.focus, this);
        this.reconcileOnNotice(['目标不存在', '此处不能占领', '城池范围内不能占领', '等级不足',
            '不能攻打同盟领地', '资源尚未恢复', '已有部队在占领', '已有部队驻守', '已有部队在采集',
            '目标无法到达', '城池不存在', '请先加入联盟', '不能攻打本盟城池', '只能调动至本盟城池', '城池归属已变化，调动取消', '部队已在调动或驻留'], 'march:', () => this.requestMarches());
    }
    protected reset(): void {
        this.marches.clear(); this.entities.clear(); this.focusPos = null; this.lastFocus = '';
        if (this.focusTimer !== null) clearTimeout(this.focusTimer);
        this.focusTimer = null;
        this.reconcileSnapshot = null;
        this.pathRequests.clear(); this.failedPaths.clear();
        this.routeRequests.clear(); this.clearMarchRoute();
        this.notifyMarches();
        this.notifyEntities();
    }
    protected onSessionReady(): void {
        this.requestMarches();
        this.focus(this.focusPos || LoginCommand.getInstance().proxy.getRoleData()?.cityPos);
    }
    private notifyMarches(): void {
        this.refreshMarchRoute();
        EventMgr.emit(E.updateMarches, this.marches.values());
    }
    private notifyEntities(): void { EventMgr.emit(E.updateWorldEntities, Array.from(this.entities.values())); }
    private routeKey(route: { troopIdx: number; targetType: number; targetPos: WorldPosition }): string {
        return `${route.troopIdx}:${route.targetType}:${route.targetPos?.x}:${route.targetPos?.y}`;
    }
    private routeOriginVersion(troopIdx: number): string {
        const march = this.marches.get(troopIdx), home = LoginCommand.getInstance().proxy.getRoleData()?.cityPos;
        return march ? JSON.stringify([march.state, march.troopState, march.targetType, idKey(march.targetId),
            march.startTime, march.endTime, march.startPos, march.endPos, march.path]) : `${home?.x}:${home?.y}`;
    }
    private notifyMarchRoute(): void { EventMgr.emit(E.updateMarchRoute, this.marchRoute); }
    clearMarchRoute(): void {
        if (!this.routeSelection) return;
        this.routeSelection = null; this.notifyMarchRoute();
        // 保留在途请求用于吸收迟到回包；关闭面板后不能被旧回包重新画出路线。
    }
    private refreshMarchRoute(): void {
        const route = this.routeSelection;
        if (route && route.originVersion !== this.routeOriginVersion(route.troopIdx)) {
            this.previewMarchRoute(route.troopIdx, route.targetType, route.targetPos, true);
        }
    }
    /** 预览不修改真实行军；普通列表刷新去重，换目标/部队重新查询。 */
    previewMarchRoute(troopIdx: number, targetType: number, targetPos: WorldPosition, force = false): boolean {
        if (!this.ready || !uint(troopIdx) || !this.validPos(targetPos) || [1, 2, 3, 4, 5, 6].indexOf(targetType) < 0) {
            this.clearMarchRoute(); return false;
        }
        const key = this.routeKey({ troopIdx, targetType, targetPos }), originVersion = this.routeOriginVersion(troopIdx);
        if (!force && this.routeSelection && this.routeKey(this.routeSelection) === key
            && this.routeSelection.originVersion === originVersion) return true;
        const selection: RouteSelection = { troopIdx, targetType, targetPos: { ...targetPos }, originVersion,
            status: 'loading', path: [], costTime: 0 };
        this.routeSelection = selection; this.notifyMarchRoute();
        return this.sendMarchRoute(selection);
    }
    private sendMarchRoute(selection: RouteSelection): boolean {
        const key = this.routeKey(selection), queue = this.routeRequests.get(key) || [];
        if (queue.some(request => !request.expired)) return true;
        // 协议没有序号。同键超时记录按发送顺序保留，迟到回包不能冒充重试结果。
        if (queue.length >= 4) { selection.status = 'error'; this.notifyMarchRoute(); return false; }
        const request: RouteRequest = { selection, expired: false };
        queue.push(request); this.routeRequests.set(key, queue);
        const sent = this.request(S.c2s_req_march_route, {
            troopIdx: selection.troopIdx, targetType: selection.targetType, targetPos: selection.targetPos,
        }, `march-route:${key}`, () => {
            request.expired = true;
            if (this.routeSelection === selection) {
                selection.status = 'error'; this.notifyMarchRoute();
            } else if (this.routeSelection?.status === 'loading' && this.routeKey(this.routeSelection) === key) {
                this.sendMarchRoute(this.routeSelection);
            }
        }, true);
        if (!sent) {
            queue.splice(queue.indexOf(request), 1);
            if (!queue.length) this.routeRequests.delete(key);
            selection.status = 'error'; this.notifyMarchRoute();
        }
        return sent;
    }
    private receiveMarchRoute(data: any): void {
        if (!uint(data.troopIdx) || !this.validPos(data.targetPos)) return;
        const key = this.routeKey(data), queue = this.routeRequests.get(key), request = queue?.shift();
        if (!request) return;
        if (!queue.length) this.routeRequests.delete(key);
        if (!request.expired) this.finish(`march-route:${key}`);
        const selection = this.routeSelection;
        if (request.expired || selection !== request.selection) {
            if (selection?.status === 'loading' && this.routeKey(selection) === key) this.sendMarchRoute(selection);
            return;
        }
        if (selection.originVersion !== this.routeOriginVersion(selection.troopIdx)) {
            this.refreshMarchRoute(); return;
        }
        const cost = Number(data.costTime || 0), path = data.path || [];
        if (Array.isArray(path) && !path.length && cost === 0) selection.status = 'unreachable';
        else if (this.validPath(path) && Number.isFinite(cost) && cost >= 0) {
            selection.path = path.map(p => ({ x: p.x, y: p.y }));
            selection.costTime = cost; selection.status = 'ready';
        } else selection.status = 'error';
        this.notifyMarchRoute();
    }
    private pathVersion(entity: WorldEntity): string {
        return `${entity.entityType}:${idKey(entity.ownerId)}:${entity.startTime}:${entity.endTime}`;
    }
    private isMovingEntity(entity: WorldEntity): boolean {
        return entity?.entityType === EntityTypeEnum.TROOP && entity.troopState !== TroopStateEnum.SIEGE && Number.isFinite(entity.startTime)
            && Number.isFinite(entity.endTime) && entity.endTime > entity.startTime && entity.startTime > 0;
    }
    private validPath(path: WorldPosition[]): boolean {
        return Array.isArray(path) && path.length >= 2 && path.every(p => p && Number.isFinite(p.x)
            && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x < 1000 && p.y < 1000);
    }
    /** 缺少路线时按 AOI 实体补查一次；保留浮点拐点，不在每帧重复请求。 */
    requestMarchPath(entityId: number | string): boolean {
        if (!hasId(entityId)) return false;
        const id = idKey(entityId), entity = this.entities.get(id);
        if (!entity || !this.isMovingEntity(entity) || this.validPath(entity.path)
            || this.pathRequests.has(id) || this.failedPaths.get(id) === this.pathVersion(entity)) return false;
        this.pathRequests.set(id, entity);
        const sent = this.request(S.c2s_req_march_path, { entityId }, `march-path:${id}`, () => {
            this.pathRequests.delete(id); this.failedPaths.set(id, this.pathVersion(entity));
            const current = this.entities.get(id);
            if (current && this.pathVersion(current) !== this.pathVersion(entity)) this.requestMarchPath(current.entityId);
        }, true);
        if (!sent) this.pathRequests.delete(id);
        return sent;
    }
    requestMarches(): boolean {
        if (!this.sessionReady || this.isPending(S.c2s_req_march_list)) return false;
        this.reconcileSnapshot = this.capturePending('march:');
        this.marches.begin();
        const sent = this.request(S.c2s_req_march_list, {}, S.c2s_req_march_list, () => {
            this.reconcileSnapshot = null; this.marches.cancel();
        });
        if (!sent) { this.reconcileSnapshot = null; this.marches.cancel(); }
        return sent;
    }
    march(troopIdx: number, targetType: number, targetId: number | string, targetPos: WorldPosition): boolean {
        if (this.marches.get(troopIdx)?.troopState === TroopStateEnum.SIEGE && targetType !== MarchTargetType.ReturnCity) return false;
        const coordinateTarget = targetType === MarchTargetType.ReturnCity || targetType === MarchTargetType.Move;
        if (!uint(troopIdx) || [1, 2, 3, 4, 5, 6].indexOf(targetType) < 0 || !this.validPos(targetPos) || (!coordinateTarget && !hasId(targetId))) return false;
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
    cityRedeployIssue(x: number, y: number): string {
        if (!this.ready) return '连接尚未恢复，请稍后重试';
        if (!this.validPos({ x, y })) return '调动坐标无效';
        const city = CityCommand.getInstance().at(x, y);
        if (!city) return '城池情报尚未同步';
        const allianceId = LoginCommand.getInstance().proxy.getRoleData()?.allianceId;
        return hasId(allianceId) && idKey(city.allianceId) === idKey(allianceId) ? '' : '只能调动至本盟城池';
    }
    redeployTroop(troopIdx: number, x: number, y: number): boolean {
        if (this.cityRedeployIssue(x, y)) return false;
        const city = CityCommand.getInstance().at(x, y), current = this.marches.get(troopIdx);
        if ((current?.state === 1 || current?.state === 2) && current.targetType === MarchTargetType.Redeploy
            && idKey(current.targetId) === idKey(city.entityId)) return false;
        return this.march(troopIdx, MarchTargetType.Redeploy, city.entityId, { x, y });
    }
    cancelMarch(troopIdx: number): boolean {
        return uint(troopIdx) && this.request(S.c2s_cancel_march, { troopIdx }, `march:${troopIdx}`, () => this.requestMarches());
    }
    isTroopAtHome(troopIdx: number): boolean {
        const current = this.marches.get(troopIdx);
        if (!current) return true;
        if (current.troopState === TroopStateEnum.SIEGE) return false;
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
     * 只返回尚未结束的计时；显示归零不等于占领成功，归属始终读取 AOI ownerId。
     */
    occupyCountdownAt(x: number, y: number, nowSec: number): { startTime: number; endTime: number } | null {
        if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isFinite(nowSec)) return null;
        // 旧 AOI 可能保留过期时间，不能据此永久显示“占领中”或阻挡地块操作。
        const active = (start: number, end: number) =>
            Number.isFinite(start) && Number.isFinite(end) && start > 0 && end > start && nowSec < end;
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
    cityAttackIssue(x: number, y: number): string {
        if (!this.validPos({ x, y })) return '城池坐标无效';
        if (!this.sessionReady) return '连接尚未恢复';
        const allianceId = LoginCommand.getInstance().proxy.getRoleData()?.allianceId;
        if (!hasId(allianceId)) return '请先加入同盟';
        const command = CityCommand.getInstance(), city = command.at(x, y);
        if (!city) return command.loaded ? '城池情报不存在，请重新选择' : '城池情报同步中';
        if (hasId(city.allianceId) && idKey(city.allianceId) === idKey(allianceId)) return '已由本盟占领';
        return '';
    }
    /** 使用服务端城池实体，路径和城外接敌点由服务端判定，不套用资源地占领规则。 */
    attackCity(troopIdx: number, x: number, y: number): boolean {
        if (this.cityAttackIssue(x, y)) return false;
        const city = CityCommand.getInstance().at(x, y);
        return this.march(troopIdx, MarchTargetType.AttackCity, city.entityId, { x, y });
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
