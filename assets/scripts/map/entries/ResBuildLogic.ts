import { _decorator, Component, Sprite, UITransform } from 'cc';
const { ccclass, property } = _decorator;
import WorldMapArt from '../WorldMapArt';
import MapUtil from '../MapUtil';

import { MapBuildData } from "../MapBuildProxy";
import MapCommand from "../MapCommand";
import { EventMgr } from '../../utils/EventMgr';
import { LogicEvent } from '../../common/LogicEvent';


@ccclass('ResBuildLogic')
export default class ResBuildLogic extends Component {
    @property(Sprite)
    upSpr: Sprite | null = null;
    @property(Sprite)
    downSpr: Sprite | null = null;
    protected _data: MapBuildData = null;
    protected onLoad(): void {

    }
    protected onDestroy(): void {

    }
    protected onEnable():void {
        EventMgr.on(LogicEvent.unionChange, this.onUnionChange, this);
    }
    protected onDisable():void {
        this._data = null;
        EventMgr.targetOff(this);
    }
    protected onUnionChange(rid: number, unionId: number, parentId: number): void {
        if (!this._data) return;
        if (this._data.rid == rid ){
        this._data.unionId = unionId;
        this._data.parentId = parentId;
        }
        this.updateUI();
     }
 
     public setBuildData(data: MapBuildData): void {
        this._data = data;
        this.updateUI();
     }
    public updateUI(): void {

        if (this._data) {
        WorldMapArt.ownership(this.node, this.upSpr, this.downSpr,
            WorldMapArt.factionColor(this._data, MapCommand.getInstance().buildProxy),
            MapUtil.tileSize.width * .97, MapUtil.tileSize.height * .97);
        }
    }
}
