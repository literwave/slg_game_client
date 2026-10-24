import { _decorator, Component, Sprite, Label, UITransform } from 'cc';
const { ccclass, property } = _decorator;
import WorldMapArt from '../WorldMapArt';

import DateUtil from "../../utils/DateUtil";
import { MapBuildData } from "../MapBuildProxy";
import MapCommand from "../MapCommand";
import { MapResConfig, MapResData, MapResType } from "../MapProxy";
import WorldCommand from '../../world/WorldCommand';

@ccclass('FacilityBuildLogic')
export default class FacilityBuildLogic extends Component {
    @property(Sprite)
    spr: Sprite | null = null;
    @property(Label)
    nameLab: Label | null = null;
    @property(Label)
    tipsLab: Label | null = null;
    protected _data: MapBuildData = null;
    protected onEnable():void {
        this.nameLab.string = "";
        this.tipsLab.string = "";
        this.spr.spriteFrame = null;

    }
    protected onDisable(): void {
        this._data = null;
        this.unscheduleAllCallbacks();
    }
     public setBuildData(data: MapBuildData): void {
        this.stopCountDownTime();
        this._data = data;
        this.updateUI();
     }
    public updateUI(): void {

        if (this._data) {
        if (this._data.type == MapResType.FORTRESS){
        WorldMapArt.apply(this.spr, 'fort', 185);
        this.spr.node.getComponent(UITransform).setAnchorPoint(.5, .25);

        let resData: MapResData = MapCommand.getInstance().proxy.getResData(this._data.id);
        let resCfg: MapResConfig = MapCommand.getInstance().proxy.getResConfig(resData.type, resData.level);

        if (this._data.nickName != null){
        this.nameLab.string = this._data.nickName + ":" + this._data.name;
        }else{
        this.nameLab.string = resCfg.name;
        }

        if (this._data.isBuilding() || this._data.isUping() || this._data.isDestroying()){
        this.startCountDownTime();
        }
        else{
        this.tipsLab.string = "";
        }
        }else{
        this.spr.spriteFrame = null;
        this.nameLab.string = "";
        }
        }
    }
    public startCountDownTime(){
        this.stopCountDownTime();
        this.schedule(this.countDownTime, 1.0);
        this.countDownTime();
    }
    public countDownTime() {
        if (!this._data) {
            this.stopCountDownTime();
            return;
        }
        if (this._data.isBuilding()){
        this.tipsLab.string = "建设中..." + DateUtil.leftTimeStr(this._data.endTime);
        } else if(this._data.isUping()){
        this.tipsLab.string = "升级中..." + DateUtil.leftTimeStr(this._data.endTime);
        } else if(this._data.isDestroying()){
        this.tipsLab.string = "拆除中..." + DateUtil.leftTimeStr(this._data.endTime);
        } else{
        this.tipsLab.string = "";
        this.stopCountDownTime();
        WorldCommand.getInstance().refreshView();
        }

    }
    public stopCountDownTime() {
        this.unschedule(this.countDownTime);
    }
}

