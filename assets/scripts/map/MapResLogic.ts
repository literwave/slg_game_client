import { _decorator, Color, Graphics, Node, UITransform, Vec2, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

import ResLogic from "./entries/ResLogic";
import MapBaseLayerLogic from "./MapBaseLayerLogic";
import { MapResData, MapResType } from "./MapProxy";
import MapUtil from "./MapUtil";
import WorldCommand from '../world/WorldCommand';
import LoginCommand from '../login/LoginCommand';
import { hasId, idKey } from '../network/pto/ProtocolCommand';
import { LogicEvent } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';

@ccclass('MapResLogic')
export default class MapResLogic extends MapBaseLayerLogic {
    private overview = false;
    private overviewGraphics: Graphics = null;
    private landOwnership = new Map<number, 'mine' | 'other'>();

    protected onLoad(): void {
        super.onLoad();
        EventMgr.on(LogicEvent.updateWorldEntities, this.refreshOwnership, this);
        EventMgr.on(LogicEvent.updateMyRole, this.refreshOwnership, this);
        this.refreshOwnership();
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this.landOwnership.clear();
        super.onDestroy();
    }

    public setItemData(item: Node, data: any): void {
        let resData: MapResData = data as MapResData;
        let position: Vec2 = MapUtil.mapCellToPixelPoint(new Vec2(resData.x, resData.y));
        item.setPosition(new Vec3(position.x, position.y, 0));
        item.getComponent(ResLogic).setResourceData(resData);
        item.getComponent(ResLogic).setOwnership(this.landOwnership.get(resData.id) || 'none');
        item.active = !this.overview || data.type === MapResType.SYS_FORTRESS;
    }

    public addItem(areaIndex: number, data: any): Node {
        if (this.overview && data.type >= MapResType.WOOD && data.type <= MapResType.GRAIN) return null;
        return super.addItem(areaIndex, data);
    }

    private refreshOwnership(): void {
        this.landOwnership.clear();
        const mine = LoginCommand.getInstance().proxy.getRoleData()?.userId;
        for (const entity of WorldCommand.getInstance().entities.values()) {
            if (entity.entityType !== 4 || !entity.pos || !hasId(entity.ownerId)) continue;
            this.landOwnership.set(MapUtil.getIdByCellPoint(entity.pos.x, entity.pos.y),
                hasId(mine) && idKey(entity.ownerId) === idKey(mine) ? 'mine' : 'other');
        }
        // 只刷新可见格；离开视野、失去归属、断线时同时清掉旧底色。
        for (const items of this._itemMap.values()) for (const [id, node] of items) {
            node.getComponent(ResLogic).setOwnership(this.landOwnership.get(id) || 'none');
        }
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
