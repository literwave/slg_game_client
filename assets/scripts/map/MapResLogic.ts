import { _decorator, Graphics, Node, Vec2, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

import ResLogic from "./entries/ResLogic";
import MapBaseLayerLogic from "./MapBaseLayerLogic";
import { MapResData, MapResType } from "./MapProxy";
import MapUtil from "./MapUtil";
import WorldCommand, { MarchTargetType } from '../world/WorldCommand';
import LoginCommand from '../login/LoginCommand';
import { hasId, idKey } from '../network/pto/ProtocolCommand';
import { LogicEvent } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import DateUtil from '../utils/DateUtil';

@ccclass('MapResLogic')
export default class MapResLogic extends MapBaseLayerLogic {
    private overview = false;
    private overviewGraphics: Graphics = null;
    private landOwnership = new Map<number, 'mine' | 'other' | 'pending'>();
    private landProgress = new Map<number, { startTime: number; endTime: number }>();

    protected onLoad(): void {
        super.onLoad();
        EventMgr.on(LogicEvent.updateWorldEntities, this.refreshOwnership, this);
        EventMgr.on(LogicEvent.updateMarches, this.refreshOwnership, this);
        EventMgr.on(LogicEvent.updateMyRole, this.refreshOwnership, this);
        this.refreshOwnership();
    }

    protected onDestroy(): void {
        this.unschedule(this.tickOccupyProgress);
        EventMgr.targetOff(this);
        this.landOwnership.clear();
        this.landProgress.clear();
        super.onDestroy();
    }

    public setItemData(item: Node, data: any): void {
        let resData: MapResData = data as MapResData;
        let position: Vec2 = MapUtil.mapCellToPixelPoint(new Vec2(resData.x, resData.y));
        item.setPosition(new Vec3(position.x, position.y, 0));
        item.getComponent(ResLogic).setResourceData(resData);
        item.getComponent(ResLogic).setOwnership(this.landOwnership.get(resData.id) || 'none');
        const timer = this.landProgress.get(resData.id);
        if (timer) this.applyProgress(item.getComponent(ResLogic), timer);
        item.active = !this.overview || data.type === MapResType.SYS_FORTRESS;
    }

    public addItem(areaIndex: number, data: any): Node {
        if (this.overview && data.type >= MapResType.WOOD && data.type <= MapResType.GRAIN) return null;
        return super.addItem(areaIndex, data);
    }

    private refreshOwnership(): void {
        this.landOwnership.clear();
        this.landProgress.clear();
        const world = WorldCommand.getInstance();
        const now = DateUtil.getServerTime() / 1000;
        const pending = new Set<number>();
        for (const entity of world.entities.values()) {
            if (entity.entityType !== 4 || !entity.pos) continue;
            const x = entity.pos.x, y = entity.pos.y;
            const timer = world.occupyCountdownAt(x, y, now);
            if (!timer) continue;
            const id = MapUtil.getIdByCellPoint(x, y);
            pending.add(id);
            this.landProgress.set(id, timer);
        }
        for (const march of world.marches.values()) {
            if (march.targetType !== MarchTargetType.OccupyResource || march.state !== 2 || !march.endPos) continue;
            const x = Math.round(march.endPos.x), y = Math.round(march.endPos.y);
            if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
            const timer = world.occupyCountdownAt(x, y, now);
            if (!timer) continue;
            const id = MapUtil.getIdByCellPoint(x, y);
            pending.add(id);
            this.landProgress.set(id, timer);
        }
        const mine = LoginCommand.getInstance().proxy.getRoleData()?.userId;
        for (const entity of world.entities.values()) {
            if (entity.entityType !== 4 || !entity.pos || !hasId(entity.ownerId)) continue;
            const id = MapUtil.getIdByCellPoint(entity.pos.x, entity.pos.y);
            if (pending.has(id)) continue;
            this.landOwnership.set(id, hasId(mine) && idKey(entity.ownerId) === idKey(mine) ? 'mine' : 'other');
        }
        for (const id of pending) this.landOwnership.set(id, 'pending');
        // 只刷新可见格；离开视野、失去归属、断线时同时清掉旧底色。
        for (const items of this._itemMap.values()) for (const [id, node] of items) {
            const res = node.getComponent(ResLogic);
            res.setOwnership(this.landOwnership.get(id) || 'none');
            const timer = this.landProgress.get(id);
            if (timer) this.applyProgress(res, timer);
        }
        if (this.landProgress.size) this.schedule(this.tickOccupyProgress, .1);
        else this.unschedule(this.tickOccupyProgress);
    }

    private tickOccupyProgress = (): void => {
        const now = DateUtil.getServerTime() / 1000;
        let expired = false;
        for (const [id, timer] of this.landProgress) {
            if (timer.endTime <= now) { expired = true; break; }
            for (const items of this._itemMap.values()) {
                const node = items.get(id);
                if (node) this.applyProgress(node.getComponent(ResLogic), timer, now);
            }
        }
        if (expired) this.refreshOwnership();
    };

    private applyProgress(res: ResLogic, timer: { startTime: number; endTime: number }, now = DateUtil.getServerTime() / 1000): void {
        const span = Math.max(.001, timer.endTime - timer.startTime);
        res.setOccupyProgress((now - timer.startTime) / span, timer.endTime - now);
    }

    /** 远景合并为一层资源色标，不为每一格新建高细节 Sprite；城池、要塞和领地保留。 */
    public refreshOverview(enabled: boolean): void {
        this.overview = enabled;
        for (const items of this._itemMap.values()) for (const [id, node] of items) {
            node.active = !enabled || this._cmd.proxy.getResData(id)?.type === MapResType.SYS_FORTRESS;
        }
        if (this.overviewGraphics) this.overviewGraphics.node.active = false;

    }
}
