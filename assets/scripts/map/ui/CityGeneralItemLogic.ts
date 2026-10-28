import { _decorator, Component, Node, Label, Sprite, ProgressBar, UITransform } from 'cc';
const { ccclass, property } = _decorator;

import GeneralCommand from "../../general/GeneralCommand";
import TroopCommand from "../../general/TroopCommand";
import { GeneralCampType, GeneralConfig, GeneralData } from "../../general/GeneralProxy";
import DateUtil from "../../utils/DateUtil";
import GeneralHeadLogic from "./GeneralHeadLogic";
import MapUICommand from "./MapUICommand";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { styleTroopCard } from './TroopPanelSkin';

@ccclass('CityGeneralItemLogic')
export default class CityGeneralItemLogic extends Component {
    @property(Node)
    infoNode: Node = null;
    @property(Node)
    addNode: Node = null;
    @property(Node)
    lockNode: Node = null;
    @property(Node)
    btnDown: Node = null;
    @property(Label)
    labelTitle: Label = null;
    @property(Sprite)
    headIcon: Sprite = null;
    @property(Label)
    labelLv: Label = null;
    @property(Label)
    labelName: Label = null;
    @property(Label)
    labelArms: Label = null;
    @property(Label)
    labelSoldierCnt: Label = null;
    @property(Label)
    labelCost: Label = null;
    @property(Label)
    labelCamp: Label = null;
    @property(Label)
    labelTip: Label = null;
    @property(Label)
    labelConTime: Label = null;
    @property(Label)
    labelConCnt: Label = null;
    @property(ProgressBar)
    progressBar: ProgressBar = null;
    @property(Node)
    conBg: Node = null;

    public index: number = 0;
    protected _order: number = 0;
    protected _cityId: number = 0;
    protected _data: GeneralData = null;
    protected _soldierCnt: number = 0;
    protected _totalSoldierCnt: number = 0;
    private _showSoldierCapacity = true;
    protected _conCnt: number = 0;
    protected _conTime: number = 0;
    protected _isUnlock: boolean = false;
    private _ignoreClickUntil = 0;

    public get formationHeroId(): number { return this._data ? GeneralData.getHeroId(this._data) : 0; }
    public get formationUnlocked(): boolean { return this._isUnlock; }
    public suppressDragClick(): void { this._ignoreClickUntil = Date.now() + 250; }

    protected onLoad(): void {
        const size = this.node.getComponent(UITransform);
        if (size) styleTroopCard(this.node, size.width, size.height);
        this.schedule(this.updateCon, 1.0);
    }

    protected onEnable(): void{
        this.conBg.active = false;
    }

    protected onDestroy(): void {
        this._data = null;
    }

    protected onClickDown(): void {
        AudioManager.instance.playClick();
        if (!this._data) {
            return;
        }
        const troop = TroopCommand.getInstance().proxy.getTroop(this._order);
        const heroMap = troop ? troop.getHeroMap() : {};
        delete heroMap[String(this._data.hero_type)];
        TroopCommand.getInstance().editTroop(this._order, heroMap);
    }

    protected onClickItem(): void {
        if (Date.now() < this._ignoreClickUntil) return;
        AudioManager.instance.playClick();
        if (this._data) {
            //点击展示武将信息
            let cfg: GeneralConfig = GeneralCommand.getInstance().proxy.getGeneralCfg(this._data.hero_type);
            EventMgr.emit(LogicEvent.openGeneralDes, cfg, this._data);
        } else if (this.addNode.active) {
            if (TroopCommand.getInstance().editingTroopIdx) {
                EventMgr.emit(LogicEvent.showToast, '编队正在保存，请稍候');
                return;
            }
            //上阵武将
            var generalArr: number[] = this.getAllGenerals();
            EventMgr.emit(LogicEvent.openGeneralChoose, generalArr, this.index);
        }
    }

    protected getAllGenerals(): number[] {
        return Array.from(TroopCommand.getInstance().proxy.getAssignedHeroIds());
    }

    protected updateItem(): void {
        if (this.index == 0) {
            this.labelTitle.string = "主将"
        } else {
            this.labelTitle.string = "副将"
        }
        if (this._isUnlock == false) {
            //未解锁
            this.infoNode.active = false;
            this.addNode.active = false;
            this.lockNode.active = true;
            this.btnDown.active = false;
            const facilityCfg = MapUICommand.getInstance().proxy.getFacilityCfgByType(14);
            let desName: string = facilityCfg ? facilityCfg.name : "兵营";
            this.labelTip.string = desName + " 等级" + this._order + " 开启";
            this.conBg.active = false;
        } else if (this._data == null) {
            //未配置武将
            this.infoNode.active = false;
            this.addNode.active = true;
            this.lockNode.active = false;
            this.btnDown.active = false;
            this.conBg.active = false;
            
        } else {
            //展示武将信息
            this.infoNode.active = true;
            this.addNode.active = false;
            this.lockNode.active = false;
            this.btnDown.active = true;
            
            this.updateCon();

            let cfg: GeneralConfig = GeneralCommand.getInstance().proxy.getGeneralCfg(this._data.hero_type);
            if (!cfg) {
                this.infoNode.active = false;
                this.addNode.active = true;
                this.btnDown.active = false;
                return;
            }
            const headLogic = this.headIcon ? this.headIcon.getComponent(GeneralHeadLogic) : null;
            if (headLogic) {
                headLogic.setHeadId(this._data.hero_type);
            }
            this.labelLv.string = this._data.level + "";
            this.labelName.string = cfg.name;
            this.labelSoldierCnt.string = this._showSoldierCapacity
                ? (this._totalSoldierCnt > 0 ? (this._soldierCnt + "/" + this._totalSoldierCnt) : "兵力待同步")
                : `兵力 ${this._soldierCnt}`;
            if (this.progressBar) {
                this.progressBar.node.active = this._showSoldierCapacity;
                this.progressBar.progress = this._totalSoldierCnt > 0 ? this._soldierCnt / this._totalSoldierCnt : 0;
            }
            this.labelCost.string = cfg.heroClass || "";
            const campMap: { [key: number]: string } = { 1: "汉", 2: "群", 3: "魏", 4: "蜀", 5: "吴" };
            this.labelCamp.string = cfg.campText || campMap[cfg.camp] || (cfg.heroClass ? cfg.heroClass.slice(0, 1) : "无");

        }
    }

    protected updateCon(){
        if (DateUtil.isAfterServerTime(this._conTime*1000)){
            this.conBg.active = false;
            this.labelConTime.string = "";
            this.labelConCnt.string = "";
        }else{
            this.conBg.active = true;
            this.labelConTime.string = DateUtil.leftTimeStr(this._conTime*1000);
            this.labelConCnt.string = "+" + this._conCnt;
        }
    }
 
    public setData(cityId: number, order: number, data: GeneralData, 
        soldierCnt: number, totalSoldierCnt: number, conCnt:number, 
        conTime:number, isUnlock: boolean, showSoldierCapacity = true): void {
        this._cityId = cityId;
        this._order = order;
        this._data = data;
        this._soldierCnt = soldierCnt;
        this._totalSoldierCnt = totalSoldierCnt;
        this._showSoldierCapacity = showSoldierCapacity;
        this._conCnt = conCnt;
        this._conTime = conTime;
        this._isUnlock = isUnlock;
        this.updateItem();
    }
}
