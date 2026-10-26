import { _decorator, Node, Vec2, Vec3 } from 'cc';
const { ccclass } = _decorator;

import BuildTagLogic from "./entries/BuildTagLogic";
import MapBaseLayerLogic from "./MapBaseLayerLogic";
import { MapResData } from "./MapProxy";
import MapUtil from "./MapUtil";
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';

@ccclass('MapBuildTagLogic')
export default class MapBuildTagLogic extends MapBaseLayerLogic {

    protected onLoad(): void {
        super.onLoad();
        EventMgr.on(LogicEvent.updateTag, this.onUpdateTags, this);
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        super.onDestroy();
    }

    private onUpdateTags(): void {
        const tags = this._cmd.proxy.getPosTags();
        const ids = new Set(tags.map(tag => MapUtil.getIdByCellPoint(tag.x, tag.y)));
        // 只有收藏过的位置需要节点；取消收藏也清理等待回收的旧区域。
        for (const areas of [this._itemMap, this._retiredItems]) {
            areas.forEach((items, areaId) => {
                items.forEach((item, id) => {
                    if (!ids.has(id)) this.removeItem(areaId, id);
                });
            });
        }
        for (const tag of tags) {
            const data = this._cmd.proxy.getResData(MapUtil.getIdByCellPoint(tag.x, tag.y));
            if (data) {
                this.addItem(MapUtil.getAreaIdByCellPoint(tag.x, tag.y), data);
            }
        }
    }

    public setItemData(item: Node, data: any): void {
        let resData: MapResData = data as MapResData;
        let position: Vec2 = MapUtil.mapCellToPixelPoint(new Vec2(resData.x, resData.y));
        item.setPosition(new Vec3(position.x, position.y, 0));
        item.getComponent(BuildTagLogic).setResourceData(resData);
    }
}
