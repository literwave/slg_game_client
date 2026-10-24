import { _decorator, Component, Label, Node, Prefab, EditBox, Slider, instantiate, view } from 'cc';
const { ccclass, property } = _decorator;

import { ArmyCmd, ArmyData } from "../../general/ArmyProxy";
import GeneralCommand from "../../general/GeneralCommand";
import ArmyCommand from "../../general/ArmyCommand";
import { GeneralCampType, GeneralConfig, GeneralData } from "../../general/GeneralProxy";
import TroopCommand from "../../general/TroopCommand";
import MapUICommand from "./MapUICommand";
import MapCommand from "../MapCommand";
import { MapCityData } from "../MapCityProxy";
import { CityAddition, CityAdditionType, Facility } from "./MapUIProxy";
import CityGeneralItemLogic from "./CityGeneralItemLogic";
import LoginCommand from "../../login/LoginCommand";
import { Conscript } from "../../config/Basci";
import { ServerConfig } from "../../config/ServerConfig";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { styleTroopPanel } from './TroopPanelSkin';

@ccclass('CityArmySettingLogic')
export default class CityArmySettingLogic extends Component {
    @property(Label)
    labelId: Label = null;
    @property(Label)
    labelCost: Label = null;
    @property(Label)
    labelSoldierCnt: Label = null;
    @property(Label)
    labelSpeed: Label = null;
    @property(Label)
    labelAtkCity: Label = null;
    @property(Label)
    labelAddition: Label = null;
    @property(Label)
    labelAdditionTip: Label = null;
    @property(Node)
    additionTouchNode: Node = null;
    @property(Node)
    additionTipNode: Node = null;
    @property(Label)
    labelResCost: Label = null;
    @property(Node)
    generalLayer: Node = null;
    @property(Prefab)
    generalPrefab: Prefab = null;
    @property([EditBox])
    editBoxs: EditBox[] = [];
    @property([Slider])
    sliders: Slider[] = [];
    @property([Node])
    tipNodes: Node[] = [];

    protected _generalCnt: number = 3;
    protected _order: number = 0;
    protected _cityId: number = 0;
    protected _cityData: MapCityData = null;
    protected _isUnlock: boolean = false;
    protected _data: ArmyData = null;
    protected _addition: CityAddition = null;
    protected _gengeralLogics: CityGeneralItemLogic[] = [];
    protected _soldiers: number[] = null;
    protected _totalSoldiers: number[] = null;
    protected _curConscripts: number[] = null;//当前征兵数

    protected _conTimes: number[] = null;
    protected _conCnts: number[] = null;

    protected onLoad(): void {
        this.initView();
        this.additionTipNode.active = false;
        this.additionTouchNode.on(Node.EventType.TOUCH_START, this.onShowAdditionTip, this);
        this.additionTouchNode.on(Node.EventType.TOUCH_END, this.onHideAdditionTip, this);
        this.additionTouchNode.on(Node.EventType.TOUCH_CANCEL, this.onHideAdditionTip, this);
        this.refreshVisualLayout();
    }

    protected onDestroy(): void {
        this._gengeralLogics.length = 0;
    }

    protected onEnable(): void {
        this._soldiers = [0, 0, 0];
        this._totalSoldiers = [0, 0, 0];
        this._curConscripts = [0, 0, 0];
        this._conTimes = [0, 0, 0];
        this._conCnts = [0, 0, 0];

        EventMgr.on(LogicEvent.updateArmy, this.onUpdateArmy, this);
        EventMgr.on(LogicEvent.chosedGeneral, this.onChooseGeneral, this);
        EventMgr.on(LogicEvent.updateCityAddition, this.onUpdateAddition, this);
        EventMgr.on(LogicEvent.updateTroopList, this.onTroopsChanged, this);
        EventMgr.on(LogicEvent.updateSoldier, this.updateView, this);
        EventMgr.on(LogicEvent.updateMyRole, this.updateView, this);
        EventMgr.on(LogicEvent.updateMyGenerals, this.updateView, this);
        EventMgr.on(LogicEvent.troopEditState, this.updateEditState, this);
        view.on('canvas-resize', this.refreshVisualLayout, this);
        view.on('design-resolution-changed', this.refreshVisualLayout, this);
        this.refreshVisualLayout();
    }

    protected onDisable(): void {
        EventMgr.targetOff(this);
        view.off('canvas-resize', this.refreshVisualLayout, this);
        view.off('design-resolution-changed', this.refreshVisualLayout, this);
        this._data = null;
        this._addition = null;
        this._cityData = null;
    }

    public refreshVisualLayout(): void {
        styleTroopPanel(this);
    }

    protected initView(): void {
        for (let i: number = 0; i < this._generalCnt; i++) {
            let item: Node = instantiate(this.generalPrefab);
            item.parent = this.generalLayer;
            let comp: CityGeneralItemLogic = item.getComponent(CityGeneralItemLogic);
            comp.index = i;
            this._gengeralLogics.push(comp);
        }
    }

    protected onShowAdditionTip(): void {
        if (this._data && this.labelAddition.string != "无") {
            this.additionTipNode.active = true;
        }
    }

    protected onHideAdditionTip(): void {
        this.additionTipNode.active = false;
    }

    protected clearSoldiers(): void {
        for (let i: number = 0; i < this._generalCnt; i++) {
            this._soldiers[i] = 0;
            this._totalSoldiers[i] = 0;
        }
    }

    protected onUpdateArmy(armyData: ArmyData): void {
        if (armyData.cityId == this._cityId && armyData.order == this._order) {
            this.setData(this._cityId, this._order);
        }
    }

    protected onUpdateAddition(cityId: number): void {
        if (this._cityId == cityId) {
            this.setData(this._cityId, this._order);
        }
    }

    private onTroopsChanged(): void {
        // 阵容/兵力以服务器快照为准；回包后清空本次增援，避免重复提交。
        this._curConscripts = [0, 0, 0];
        this.editBoxs.forEach(edit => edit.string = '0');
        this.updateView();
    }

    private getReserveSoldiers(): number {
        const count = Number(LoginCommand.getInstance().proxy.getRoleData()?.soldierInfo?.count);
        return Number.isFinite(count) ? Math.max(0, Math.min(0xffffffff, Math.floor(count))) : 0;
    }

    protected onChooseGeneral(cfgData: any, curData: any, position: any): void {
        if (!curData) {
            return;
        }
        const heroIdx = Number(curData.hero_type ?? curData.heroType ?? curData.cfgId ?? curData.id);
        if (!heroIdx) {
            return;
        }
        const troop = TroopCommand.getInstance().proxy.getTroop(this._order);
        const heroMap = troop ? troop.getHeroMap() : {};
        const targetPosition = Number(position);
        if (!Number.isInteger(targetPosition) || targetPosition < 0 || targetPosition >= this._generalCnt) {
            return;
        }
        if (!this._isUnlock || (targetPosition === 2 && this._addition && this._addition.vanguardCnt < this._order)) {
            EventMgr.emit(LogicEvent.showToast, '该上阵位置尚未解锁');
            return;
        }
        Object.keys(heroMap).forEach((key) => {
            if (heroMap[key] == targetPosition) {
                delete heroMap[key];
            }
        });
        heroMap[String(heroIdx)] = targetPosition;
        TroopCommand.getInstance().editTroop(this._order, heroMap);
    }

    protected updateView(): void {
        let comp: CityGeneralItemLogic = null;
        let generalData: GeneralData = null;
        let generalCfg: GeneralConfig = null;
        let isUnlock: boolean = false;
        let generalCount: number = 0;
        let soldierCnt: number = 0;
        let totalSoldierCnt: number = 0;
        this.clearSoldiers();
        const troop = TroopCommand.getInstance().proxy.getTroop(this._order);
        for (let i: number = 0; i < this._gengeralLogics.length; i++) {
                comp = this._gengeralLogics[i];
                generalData = null;
                isUnlock = this._isUnlock;
                if (i == 2) {
                    //只有第二个副将才需要判断是否解锁
                    isUnlock = isUnlock && (!this._addition || this._addition.vanguardCnt >= this._order);
                }
                const heroIdx = troop ? troop.getHeroIdxAt(i) : 0;
                if (heroIdx > 0) {
                    generalData = GeneralCommand.getInstance().proxy.getMyGeneral(heroIdx);
                    generalCfg = generalData ? generalData.config || GeneralCommand.getInstance().proxy.getGeneralCfg(heroIdx) : null;
                    if (generalCfg) {
                        generalCount++;
                    }
                    if (this._data) {
                        this._soldiers[i] = Number(this._data.soldiers && this._data.soldiers[i] || 0);
                        this._totalSoldiers[i] = generalData ? generalData.level * 100 + (this._addition ? this._addition.soldierCnt : 0) : 0;
                        this._conTimes[i] = Number(this._data.conTimes && this._data.conTimes[i] || 0);
                        this._conCnts[i] = Number(this._data.conCnts && this._data.conCnts[i] || 0);
                    } else if (troop) {
                        const soldier = troop.getSoldier(heroIdx);
                        this._soldiers[i] = soldier.count;
                        // 新协议从城中兵力补给，不能再等待旧 ArmyData 征兵队列。
                        // 每将/每队上限尚无独立协议字段，最终由服务器校验。
                        this._totalSoldiers[i] = Math.min(0xffffffff, soldier.count + this.getReserveSoldiers());
                    }
                    soldierCnt += this._soldiers[i];
                    totalSoldierCnt += this._totalSoldiers[i];
                }
                if (isUnlock == false || generalData == null) {
                    this._curConscripts[i] = 0;
                    this.editBoxs[i].string = '0';
                    this.tipNodes[i].active = true;
                    this.editBoxs[i].node.active = false;
                    this.sliders[i].node.active = false;
                } else {
                    this.tipNodes[i].active = false;
                    this.editBoxs[i].node.active = true;
                    this.sliders[i].node.active = true;

                    let totalValue: number = this._totalSoldiers[i] - this._soldiers[i];
                    if(this._data && this._data.cmd == ArmyCmd.Conscript){
                        var can = this._conCnts[i] == 0
                        this.sliders[i].enabled = can;
                        this.editBoxs[i].string = "0";
                        this.sliders[i].progress = 0;
                        this.editBoxs[i].enabled = can;
                    }else if(this._data && this._data.cmd > ArmyCmd.Idle || totalValue <= 0) {
                        //不可征兵
                        this.editBoxs[i].string = "0";
                        this.sliders[i].progress = 0;
                        this.editBoxs[i].enabled = false;
                        this.sliders[i].enabled = false;
                        this.setCurConscriptForIndex(i, 0);
                    } else {
                        this.editBoxs[i].enabled = true;
                        this.sliders[i].enabled = true;
                        let curValue: number = 0;
                        if (this.editBoxs[i].string != "") {
                            curValue = Math.max(0, Math.min(parseInt(this.editBoxs[i].string), totalValue));
                        }
                        this.setCurConscriptForIndex(i, curValue);
                    }

                }
                comp.setData(this._cityId, this._order, generalData, this._soldiers[i], this._totalSoldiers[i], this._conCnts[i], this._conTimes[i], isUnlock, !!this._data);
        }
        this.labelId.string = "部队" + this._order;
        this.labelCost.string = "上阵 " + generalCount + "/" + this._generalCnt;
        const hurtCount = troop ? troop.getSortedHeroes().reduce((sum, hero) => sum + troop.getSoldier(hero.heroIdx).hurtCount, 0) : 0;
        this.labelSoldierCnt.string = troop ? `${soldierCnt}（伤兵 ${hurtCount}）` : this._data ? (soldierCnt + "/" + totalSoldierCnt) : "待同步";
        this.labelAddition.string = "无";
        let speed: number = 0;
        let attack: number = 0;
        let hasGeneral: boolean = false;
        if (troop) {
            for (let i: number = 0; i < this._generalCnt; i++) {
                const heroIdx = troop.getHeroIdxAt(i);
                if (heroIdx <= 0) {
                    continue;
                }
                const general = GeneralCommand.getInstance().proxy.getMyGeneral(heroIdx);
                const cfg = general ? general.config || GeneralCommand.getInstance().proxy.getGeneralCfg(heroIdx) : null;
                if (!cfg) {
                    continue;
                }
                if (!hasGeneral) {
                    speed = cfg.speed;
                } else {
                    speed = Math.min(speed, cfg.speed);
                }
                attack += cfg.attack;
                hasGeneral = true;
            }
        }
        this.labelSpeed.string = speed.toFixed(2);
        this.labelAtkCity.string = attack.toFixed(2);

        this.updateResCost();
        this.updateEditState();
    }

    private updateEditState(): void {
        if (!this.labelCost || !this.isValid) return;
        const command = TroopCommand.getInstance();
        const count = command.proxy.getTroop(this._order)?.getHeroCount() || 0;
        this.labelCost.string = command.editingTroopIdx === this._order
            ? '编队保存中…' : `上阵 ${count}/${this._generalCnt}`;
        if (!this._data) {
            const troop = command.proxy.getTroop(this._order);
            this.editBoxs.forEach((edit, i) => {
                const enabled = !command.editingTroopIdx && this._isUnlock
                    && !!troop?.getHeroIdxAt(i) && this.getReserveSoldiers() > 0;
                edit.enabled = enabled;
                this.sliders[i].enabled = enabled;
            });
        }
    }

    protected setCurConscriptForIndex(index: number, cnt: number = 0): void {
        let maxCnt = Math.max(0, this._totalSoldiers[index] - this._soldiers[index]);
        if (!this._data) {
            const allocated = this._curConscripts.reduce((sum, value, i) => sum + (i === index ? 0 : value), 0);
            maxCnt = Math.min(maxCnt, Math.max(0, this.getReserveSoldiers() - allocated));
        }
        cnt = Number.isFinite(cnt) ? Math.max(0, Math.min(Math.floor(cnt), maxCnt)) : 0;
        const range = Math.max(0, this._totalSoldiers[index] - this._soldiers[index]);
        const percent = range > 0 ? cnt / range : 0;
        this.editBoxs[index].string = cnt + "";
        this.sliders[index].progress = percent;
        this._curConscripts[index] = cnt;
    }

    protected getTotalConscriptCnt(): number {
        let totalCnt: number = 0;
        for (let i = 0; i < this._curConscripts.length; i++) {
            totalCnt += this._curConscripts[i];
        }
        return totalCnt;
    }

    protected updateResCost(): void {
        let totalCnt: number = this.getTotalConscriptCnt();
        if (!this._data) {
            const reserve = this.getReserveSoldiers();
            this.labelResCost.string = `城中可用兵力 ${reserve} · 本次增援 ${totalCnt}`;
            return;
        }
        if (totalCnt > 0) {
            var myRoleRes = LoginCommand.getInstance().proxy.getRoleResData();
            var baseCost: Conscript = MapUICommand.getInstance().proxy.getConscriptBaseCost();
            let str: string = "消耗:  " + "金币:" + totalCnt * baseCost.cost_gold + "/" + myRoleRes.gold;
            str += " 木材:" + totalCnt * baseCost.cost_wood + "/" + myRoleRes.wood;
            str += " 金属:" + totalCnt * baseCost.cost_iron + "/" + myRoleRes.iron;
            str += " 谷物:" + totalCnt * baseCost.cost_grain + "/" + myRoleRes.grain;
            this.labelResCost.string = str;
        } else {
            this.labelResCost.string = "";
        }
    }

    protected onChangeEditBox(editBox: EditBox): void {
        let index: number = this.editBoxs.indexOf(editBox);
        if (index >= 0) {
            this.setCurConscriptForIndex(index, parseInt(this.editBoxs[index].string));
            this.updateResCost();
        }
    }

    protected onChangeSlider(slider: Slider): void {
        let index: number = this.sliders.indexOf(slider);
        if (index >= 0) {
            let maxCnt: number = this._totalSoldiers[index] - this._soldiers[index];
            this.setCurConscriptForIndex(index, Math.floor(this.sliders[index].progress * maxCnt));
            this.updateResCost();
        }
    }

    protected onClickQuick(): void {
        AudioManager.instance.playClick();
        if (!this._data) {
            const command = TroopCommand.getInstance();
            if (command.editingTroopIdx) {
                EventMgr.emit(LogicEvent.showToast, '编队正在保存，请稍候');
                return;
            }
            const troop = command.proxy.getTroop(this._order);
            const positions = troop?.getSortedHeroes().map(hero => hero.position) || [];
            const reserve = this.getReserveSoldiers();
            if (!positions.length || !reserve) {
                EventMgr.emit(LogicEvent.showToast, positions.length ? '城中暂无可用兵力' : '请先选择上阵武将');
                return;
            }
            this._curConscripts = [0, 0, 0];
            // 只分配城中可用兵力，伤兵不参与；余数按阵位分配，不丢兵。
            const share = Math.floor(reserve / positions.length);
            positions.forEach((position, i) => this.setCurConscriptForIndex(position,
                share + (i < reserve % positions.length ? 1 : 0)));
            this.updateResCost();
            return;
        }
        if (this._data && (this._data.cmd == ArmyCmd.Idle || this._data.cmd == ArmyCmd.Conscript)) {
            for (let i: number = 0; i < this._totalSoldiers.length; i++) {
                if(this._conCnts[i] > 0){
                    //正在征兵的不能重复征兵
                    this.setCurConscriptForIndex(i, 0);
                }else{
                    let maxCnt: number = this._totalSoldiers[i] - this._soldiers[i];
                    if (maxCnt > 0) {
                        this.setCurConscriptForIndex(i, maxCnt);
                    }
                }
            }
            this.updateResCost();
        }

    }

    protected onClickSure(): void {
        AudioManager.instance.playClick();
        if (!this._data) {
            const command = TroopCommand.getInstance();
            if (command.editingTroopIdx) {
                EventMgr.emit(LogicEvent.showToast, '编队正在保存，请稍候');
                return;
            }
            const troop = command.proxy.getTroop(this._order);
            if (!troop?.getHeroCount()) {
                EventMgr.emit(LogicEvent.showToast, '请先选择上阵武将');
                return;
            }
            const total = this.getTotalConscriptCnt();
            if (total <= 0) {
                EventMgr.emit(LogicEvent.showToast, '请先填写增援兵力，或使用快速分兵');
                return;
            }
            if (total > this.getReserveSoldiers()) {
                this.onTroopsChanged();
                EventMgr.emit(LogicEvent.showToast, '城中兵力已变化，请重新分配');
                return;
            }
            const counts: { [heroIdx: string]: number } = {};
            troop.getSortedHeroes().forEach(hero => {
                counts[hero.heroIdx] = troop.getSoldier(hero.heroIdx).count + this._curConscripts[hero.position];
            });
            command.editTroop(this._order, troop.getHeroMap(), counts);
            return;
        }
        if (this._data && (this._data.cmd == ArmyCmd.Idle || this._data.cmd == ArmyCmd.Conscript)) {
            let totalCnt: number = this.getTotalConscriptCnt();
            if (totalCnt > 0) {
                if (!GeneralCommand.getInstance().isProtocolAvailable(ServerConfig.army_conscript)) {
                    EventMgr.emit(LogicEvent.showToast, "征兵功能暂未开放");
                    return;
                }
                ArmyCommand.getInstance().generalConscript(this._data.id, this._curConscripts, null);
            }
        }
    }

    protected onClickPrev(): void {
        AudioManager.instance.playClick();
        this._curConscripts = [0, 0, 0];
        if (this._order == 1) {
            //第一个就跳到最后一个
            this.setData(this._cityId, this.getTroopCount());
        } else {
            this.setData(this._cityId, this._order - 1);
        }
    }

    protected onClickNext(): void {
        AudioManager.instance.playClick();
        this._curConscripts = [0, 0, 0];
        if (this._order >= this.getTroopCount()) {
            //最后一个就跳到第一个
            this.setData(this._cityId, 1);
        } else {
            this.setData(this._cityId, this._order + 1);
        }
    }

    private getTroopCount(): number {
        if (this._addition && this._addition.armyCnt > 0) return this._addition.armyCnt;
        // 与右侧部队栏一致：默认三队，服务器返回更多部队时跟随扩展。
        return Math.max(3, ...TroopCommand.getInstance().proxy.getTroops().map(troop => troop.troopIdx));
    }

    protected onClickClose(): void {
        AudioManager.instance.playClick();
        this.node.active = false;
    }

    public setData(cityId: number, order: number = 1): void {
        this._curConscripts = [0, 0, 0];
        this.editBoxs.forEach(edit => edit.string = '0');
        this._cityId = cityId;
        this._order = order;
        this._cityData = MapCommand.getInstance().cityProxy.getMyCityById(this._cityId);
        this._data = ArmyCommand.getInstance().proxy.getArmyByOrder(order, cityId);
        const facility = MapUICommand.getInstance().proxy.getMyFacilitys(this._cityId);
        // 新部队协议不依赖旧城建设施；未同步设施时不能把默认 armyCnt=0 当成全锁定。
        this._addition = this._data && facility != null ? MapUICommand.getInstance().proxy.getMyCityAddition(cityId) : null;
        this._isUnlock = !this._addition || this._addition.armyCnt >= this._order;
        if (facility == null && this._cityId > 0 && GeneralCommand.getInstance().isProtocolAvailable(ServerConfig.c2s_create_build)) {
            MapUICommand.getInstance().qryCityFacilities(this._cityId);
        }
        TroopCommand.getInstance().requestTroops();
        this.updateView();
    }
}
