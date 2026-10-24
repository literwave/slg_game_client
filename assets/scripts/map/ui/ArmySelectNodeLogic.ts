import { _decorator, Component, Node, Prefab, instantiate } from 'cc';
const { ccclass, property } = _decorator;

import ArmyCommand from "../../general/ArmyCommand";
import { ArmyCmd, ArmyData } from "../../general/ArmyProxy";
import { MapCityData } from "../MapCityProxy";
import MapCommand from "../MapCommand";
import ArmySelectItemLogic from "./ArmySelectItemLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import TroopCommand from '../../general/TroopCommand';
import MapUtil from '../MapUtil';

@ccclass('ArmySelectNodeLogic')
export default class ArmySelectNodeLogic extends Component {
    @property(Node)
    armyContainer: Node = null;
    @property(Prefab)
    itemPrefab: Prefab = null;
    private resourceTarget: { x: number; y: number } | null = null;
    
    protected onLoad(): void {
        EventMgr.on(LogicEvent.closeArmyAelectUi, this.onClickBack, this);
        EventMgr.on(LogicEvent.updateTroopList, this.refreshTroops, this);
        EventMgr.on(LogicEvent.updateMarches, this.refreshTroops, this);
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
    }

    protected onClickBack(): void {
        AudioManager.instance.playClick();
        this.node.active = false;
    }

    public setData(cmd: number, x: number, y: number): void {
        this.clearItems();
        const cell = MapCommand.getInstance().proxy.getResData(MapUtil.getIdByCellPoint(x, y));
        this.resourceTarget = cmd === ArmyCmd.Attack && cell?.type >= 52 && cell.type <= 55 ? { x, y } : null;
        if (this.resourceTarget) {
            TroopCommand.getInstance().requestTroops();
            this.refreshTroops();
            return;
        }
        let myCity: MapCityData = MapCommand.getInstance().cityProxy.getMyMainCity();
        if (!myCity) return;
        let armyList: ArmyData[] = ArmyCommand.getInstance().proxy.getArmyList(myCity.cityId);
        for (let i: number = 0; i < armyList.length; i++) {
            if (armyList[i] && armyList[i].generals[0] > 0) {
                let item: Node = instantiate(this.itemPrefab);
                item.parent = this.armyContainer;
                item.getComponent(ArmySelectItemLogic).setArmyData(armyList[i], cmd, x, y);
            }
        }
    }
    private clearItems(): void {
        for (const child of [...this.armyContainer.children]) child.destroy();
        this.armyContainer.removeAllChildren();
    }
    private refreshTroops(): void {
        if (!this.resourceTarget || !this.node.activeInHierarchy) return;
        this.clearItems();
        for (const troop of TroopCommand.getInstance().proxy.getTroops()) {
            if (!troop.getHeroIdxAt(0)) continue;
            const item = instantiate(this.itemPrefab);
            item.parent = this.armyContainer;
            item.getComponent(ArmySelectItemLogic).setTroopData(troop, this.resourceTarget.x, this.resourceTarget.y);
        }
    }
}
