import { _decorator, Component, Sprite, Node, Vec3, UITransform } from 'cc';
const { ccclass, property } = _decorator;
import WorldMapArt from '../WorldMapArt';
import WorldCampaign from '../WorldCampaign';
import { caption, ManagementColors } from '../ui/ManagementStyle';
import { Label } from 'cc';

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

        const icon = this.node.getChildByName('cityicon')?.getComponent(Sprite);
        if (icon) {
            icon.node.getComponent(UITransform).setAnchorPoint(.5, .3);
            icon.node.setPosition(0, 0, 0);
            WorldMapArt.apply(icon, WorldMapArt.cityArt(this._data.level), width);
        }
        WorldMapArt.ownership(this.node, this.upSpr, this.downSpr,
            WorldMapArt.factionColor(this._data, MapCommand.getInstance().buildProxy), width * 1.15);
        this.mianNode?.setPosition(width * .38, 30, 0);
        const name = WorldCampaign.landmark(this._data.x, this._data.y);
        const title = this.node.getChildByName('CampaignCityName'); if (title) title.active = false;

        var diff = DateUtil.getServerTime() - this._data.occupyTime;
        console.log("diff", diff, this._limitTime);
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
