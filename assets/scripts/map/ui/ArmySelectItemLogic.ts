import { _decorator, Component, Node, Label, Sprite, ProgressBar } from 'cc';
const { ccclass, property } = _decorator;

import { ArmyCmd, ArmyData } from "../../general/ArmyProxy";
import GeneralCommand from "../../general/GeneralCommand";
import ArmyCommand from "../../general/ArmyCommand";
import { GeneralCommonConfig, GeneralConfig, GeneralData } from "../../general/GeneralProxy";
import GeneralHeadLogic from "./GeneralHeadLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { TroopData } from '../../general/TroopProxy';
import TroopCommand from '../../general/TroopCommand';
import WorldCommand from '../../world/WorldCommand';
import MapCommand from '../MapCommand';
import MapUtil from '../MapUtil';

@ccclass('ArmySelectItemLogic')
export default class ArmySelectItemLogic extends Component {
    @property(Node)
    tipNode: Node = null;
    @property(Label)
    labelTip: Label = null;
    @property(Sprite)
    headIcon: Sprite = null;
    @property(Label)
    labelLv: Label = null;
    @property(Label)
    labelName: Label = null;
    @property(Label)
    labelState: Label = null;
    @property(Label)
    labelMorale: Label = null;
    @property(Label)
    labelSoldierCnt: Label = null;
    @property(Label)
    labelVice1: Label = null;
    @property(Label)
    labelVice2: Label = null;
    @property(ProgressBar)
    progressSoldier: ProgressBar = null;

    protected _data: ArmyData = null;
    protected _cmd: number = 0;
    protected _toX: number = 0;
    protected _toY: number = 0;
    private troopIdx = 0;
    private resourceEntityId: number | string = 0;

    protected onLoad(): void {
        EventMgr.on(LogicEvent.updateArmy, this.onUpdateArmy, this);
        this.tipNode.active = false;
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this._data = null;
    }

    protected onUpdateArmy(armyData: ArmyData): void {
        if (this._data && armyData.id == this._data.id) {
            this.setArmyData(armyData, this._cmd, this._toX, this._toY);
        }
    }

    protected onClickItem(): void {
        AudioManager.instance.playClick();
        if (this.troopIdx) {
            const world = WorldCommand.getInstance();
            const map = MapCommand.getInstance();
            const cell = map.proxy.getResData(MapUtil.getIdByCellPoint(this._toX, this._toY));
            const troop = TroopCommand.getInstance().proxy.getTroop(this.troopIdx);
            const reason = map.campaignBlockReason(this._toX, this._toY)
                || (cell ? world.resourceLandIssue(this._toX, this._toY, cell.type, cell.level) : '目标已失效');
            const entity = world.resourceLandAt(this._toX, this._toY);
            if (reason || !entity || String(entity.entityId) !== String(this.resourceEntityId)) {
                EventMgr.emit(LogicEvent.showToast, reason || '目标已变更，请重新选择资源地'); return;
            }
            const leader = troop?.getHeroIdxAt(0);
            if (!leader || troop.getSoldier(leader).count <= 0 || !world.occupyResourceLand(this.troopIdx, entity.entityId)) {
                EventMgr.emit(LogicEvent.showToast, '部队暂无可用兵力、正在行军或请求尚未完成'); return;
            }
            EventMgr.emit(LogicEvent.closeArmyAelectUi); return;
        }
        if (this.tipNode.active == false) {
            ArmyCommand.getInstance().generalAssignArmy(this._data.id, this._cmd, this._toX, this._toY);
            EventMgr.emit(LogicEvent.closeArmyAelectUi);
        } else {
            console.log("军队忙");
        }
    }

    protected updateItem(): void {
        if (this._data && this._data.generals[0] != 0) {
            console.log("updateItem", this._data);
            let commonCfg: GeneralCommonConfig = GeneralCommand.getInstance().proxy.getCommonCfg();
            let generals: GeneralData[] = ArmyCommand.getInstance().getArmyGenerals(this._data);
            let firstGeneralCfg: GeneralConfig = GeneralCommand.getInstance().proxy.getGeneralCfg(generals[0].cfgId);
            let power: number = ArmyCommand.getInstance().getArmyPhysicalPowerByGenerals(generals);
            let curSoldierCnt: number = ArmyCommand.getInstance().getArmyCurSoldierCnt(this._data);
            let totalSoldierCnt: number = ArmyCommand.getInstance().getArmyTotalSoldierCntByGenerals(generals);

            if (this._data.cmd == ArmyCmd.Conscript) {
                //体力不足
                this.tipNode.active = true;
                this.labelTip.string = "征兵中...";
            }else if (power < commonCfg.recovery_physical_power) {
                //体力不足
                this.tipNode.active = true;
                this.labelTip.string = "体力不足";
            } else if (this._data.soldiers[0] <= 0) {
                //兵力不足
                this.tipNode.active = true;
                this.labelTip.string = "主将兵力不足";
            } else if (this._data.state > 0) {
                //行军中
                this.tipNode.active = true;
                this.labelTip.string = "行军中...";
            } else if (this._data.cmd == ArmyCmd.Reclaim) {
                //屯田中
                this.tipNode.active = true;
                this.labelTip.string = "屯田中...";
            } else {
                this.tipNode.active = false;
            }

            this.headIcon.getComponent(GeneralHeadLogic).setHeadId(generals[0].cfgId);
            this.labelLv.string = generals[0].level + "";
            this.labelName.string = firstGeneralCfg.name;
            this.labelState.string = ArmyCommand.getInstance().getArmyStateDes(this._data);
            this.labelSoldierCnt.string = curSoldierCnt + "/" + totalSoldierCnt;
            this.progressSoldier.progress = curSoldierCnt / totalSoldierCnt;

            if (generals[1]) {
                let sencondGeneralCfg: GeneralConfig = GeneralCommand.getInstance().proxy.getGeneralCfg(generals[1].cfgId);
                this.labelVice1.string = sencondGeneralCfg.name;
            } else {
                this.labelVice1.string = "";
            }

            if (generals[2]) {
                let thirdGeneralCfg: GeneralConfig = GeneralCommand.getInstance().proxy.getGeneralCfg(generals[2].cfgId);
                this.labelVice2.string = thirdGeneralCfg.name;
            } else {
                this.labelVice2.string = "";
            }
        }
    }

    public setArmyData(data: ArmyData, cmd: number, x: number, y: number): void {
        this.troopIdx = 0; this.resourceEntityId = 0;
        this._data = data;
        this._cmd = cmd;
        this._toX = x;
        this._toY = y;
        // console.log("setArmyData", arguments);
        this.updateItem();
    }
    public setTroopData(troop: TroopData, x: number, y: number): void {
        this._data = null; this.troopIdx = troop.troopIdx; this._toX = x; this._toY = y;
        const world = WorldCommand.getInstance();
        this.resourceEntityId = world.resourceLandAt(x, y)?.entityId || 0;
        const proxy = GeneralCommand.getInstance().proxy;
        const heroes = [0, 1, 2].map(pos => proxy.getMyGeneral(troop.getHeroIdxAt(pos)));
        const name = (index: number) => heroes[index] ? proxy.getGeneralCfg(heroes[index].cfgId)?.name || '武将' : '';
        const leader = troop.getHeroIdxAt(0);
        let count = 0, hurt = 0;
        for (const hero of troop.getSortedHeroes()) {
            const soldier = troop.getSoldier(hero.heroIdx); count += soldier.count; hurt += soldier.hurtCount;
        }
        const busy = world.marches.get(troop.troopIdx)?.state === 1;
        const noSoldiers = !leader || troop.getSoldier(leader).count <= 0;
        this.tipNode.active = busy || noSoldiers;
        this.labelTip.string = busy ? '行军中…' : '主将兵力不足';
        this.labelState.string = busy ? '行军中' : '待命';
        this.labelName.string = name(0) || `部队${troop.troopIdx}`;
        this.labelLv.string = heroes[0] ? String(heroes[0].level) : '';
        this.headIcon.node.active = !!heroes[0];
        if (heroes[0]) this.headIcon.getComponent(GeneralHeadLogic).setHeadId(heroes[0].cfgId);
        this.labelVice1.string = name(1); this.labelVice2.string = name(2);
        this.labelMorale.string = `伤兵 ${hurt}`;
        this.labelSoldierCnt.string = `${count} 可用`;
        this.progressSoldier.progress = count + hurt > 0 ? count / (count + hurt) : 0;
    }
}
