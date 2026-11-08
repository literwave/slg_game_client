import { _decorator, Component, Sprite, Node, UITransform } from 'cc';
const { ccclass, property } = _decorator;
import WorldMapArt from '../WorldMapArt';
import MapUtil from '../MapUtil';
import { cityArtAnchorY, cityFootprintRadius } from '../CityFootprint';
import CityOwnershipView from '../CityOwnershipView';

import DateUtil from "../../utils/DateUtil";
import MapCommand from "../MapCommand";
import { MapResType } from "../MapProxy";
import { EventMgr } from '../../utils/EventMgr';
import { LogicEvent } from '../../common/LogicEvent';

@ccclass('SysCityLogic')
export default class SysCityLogic extends Component {

    @property(Sprite)
    upSpr: Sprite = null;

    @property(Sprite)
    downSpr: Sprite = null;

    @property(Node)
    mianNode: Node = null;

    protected _limitTime: number = 0;
    protected _data: any = null;


    protected onLoad(): void {
        this._limitTime = MapCommand.getInstance().proxy.getWarFree();
    }

    protected onEnable(): void {
        EventMgr.on(LogicEvent.unionChange, this.onUnionChange, this);
    }

    protected onDisable(): void {
        this._data = null;
        this.unscheduleAllCallbacks();
        EventMgr.targetOff(this);
    }

    public setCityData(data: any): void {
        // console.log("setCityData:", data);
        this._data = data;
        this.updateUI();
    }

    protected onUnionChange(rid: number, unionId: number, parentId: number): void {
        if (!this._data) return;
        if (this._data.rid == rid ){
            this._data.unionId = unionId;
            this._data.parentId = parentId;
        }
        this.updateUI();
    }


    public updateUI(): void {
        if (!this._data) return;
        if(this._data.type != MapResType.SYS_CITY){
            this.node.active = false;
            return
        }else{
            this.node.active = true;
        }

        this.node.setScale(1, 1, 1);
        const width = WorldMapArt.cityWidth(this._data.level);
        const span = cityFootprintRadius(this._data.level) * 2 + 1;
        const footprintWidth = MapUtil.tileSize.width * span, footprintHeight = MapUtil.tileSize.height * span;
        this.node.getComponent(UITransform).setContentSize(footprintWidth, footprintHeight);

        const icon = this.node.getChildByName('cityicon')?.getComponent(Sprite);
        let nameAnchorY = 0;
        if (icon) {
            // 轮廓按原图画布计算，关闭自动裁边以免显示与点击位置发生偏移。
            icon.trim = false;
            const anchorY = cityArtAnchorY(this._data.level, this._data);
            icon.node.getComponent(UITransform).setAnchorPoint(.5, anchorY);
            icon.node.setPosition(0, 0, 0);
            WorldMapArt.apply(icon, WorldMapArt.citySprite(this._data.level, this._data), width);
            nameAnchorY = icon.node.getComponent(UITransform).height * (1 - anchorY);
        }
        // 联盟城池不再读取旧 rid/unionId 的领地色，由城池协议驱动城旗与名牌。
        WorldMapArt.ownership(this.node, this.upSpr, this.downSpr, null, footprintWidth, footprintHeight);
        const ownership = this.node.getComponent(CityOwnershipView) || this.node.addComponent(CityOwnershipView);
        ownership.setCity(this._data, nameAnchorY, [[-footprintWidth / 2, 0], [0, footprintHeight / 2],
            [footprintWidth / 2, 0], [0, -footprintHeight / 2]]);
        this.mianNode?.setPosition(width * .38, 30, 0);
        const title = this.node.getChildByName('CampaignCityName'); if (title) title.active = false;

        var diff = DateUtil.getServerTime() - this._data.occupyTime;
        if (this._data.parentId > 0 && diff<this._limitTime){
            this.mianNode.active = true;
            this.stopCountDown();
            this.schedule(this.countDown, 1.0);
        }else{
            this.mianNode.active = false;
        }
    }

    public countDown() {
        var diff = DateUtil.getServerTime() - this._data.occupyTime;
        if (diff>this._limitTime){
            this.stopCountDown();
            this.mianNode.active = false;
        }
    }

    public stopCountDown() {
        this.unscheduleAllCallbacks();
    }
}
