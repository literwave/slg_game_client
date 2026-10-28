import { _decorator, Color, Component, Node, Label, Sprite, UITransform } from 'cc';
const { ccclass, property } = _decorator;

import { ArmyCmd, ArmyData } from "../../general/ArmyProxy";
import GeneralCommand from "../../general/GeneralCommand";
import ArmyCommand from "../../general/ArmyCommand";
import { GeneralConfig, GeneralData } from "../../general/GeneralProxy";
import MapUICommand from "./MapUICommand";
import GeneralHeadLogic from "./GeneralHeadLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { TroopData } from '../../general/TroopProxy';
import WorldCommand from '../../world/WorldCommand';
import { caption, hideSprite, inkSurface, ManagementColors as C, place } from './ManagementStyle';

@ccclass('CityArmyItemLogic')
export default class CityArmyItemLogic extends Component {
    @property(Node)
    infoNode: Node = null;
    @property(Node)
    maskNode: Node = null;
    @property(Node)
    tipNode: Node = null;
    @property(Label)
    labelTip: Label = null;
    @property(Sprite)
    headIcon: Sprite = null;
    @property(Label)
    labelId: Label = null;
    @property(Label)
    labelState: Label = null;
    @property(Label)
    labelLv: Label = null;
    @property(Label)
    labelName: Label = null;
    @property(Label)
    labelArms: Label = null;
    @property(Label)
    labelSoldierCnt: Label = null;
    @property(Label)
    labelVice1: Label = null;
    @property(Label)
    labelVice2: Label = null;

    public order: number = 0;
    protected _cityId: number = 0;
    protected _data: ArmyData = null;
    private _troop: TroopData = null;
    private _usesWorldTroop = false;
    protected _isOpened: boolean = true;
    protected _isOut: boolean = true;
    private _overviewWidth = 0;
    private _overviewHeight = 0;

    protected onLoad(): void {
        EventMgr.on(LogicEvent.updateArmy, this.onUpdateArmy, this);
        this.tipNode.active = false;
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this._data = null;
        this._troop = null;
    }

    protected onUpdateArmy(armyData: ArmyData): void {
        if (this._data && armyData.id == this._data.id) {
            this.setArmyData(this._cityId, armyData);
        }
    }

    protected onClickItem(): void {
        AudioManager.instance.playClick();
        if (this.maskNode.active == false) {
            if(this._isOut){
                if(this._data){
                    EventMgr.emit(LogicEvent.openArmySetting, this._cityId, this._data.order);
                }
            }else{
                EventMgr.emit(LogicEvent.openArmySetting, this._cityId, this.order);
            }
        }
    }

    protected updateItem(): void {
     
        // console.log("cityarmyitem:", this._data);
        
        if(this._isOpened == false){
            return
        }

        if (this._usesWorldTroop) {
            this.updateTroopItem();
            return;
        }

        if (this._data && this._data.generals[0] != 0) {
            //有数据 并且配置了第一个将
            this.tipNode.active = false;
            this.infoNode.active = true;
            let generals: GeneralData[] = ArmyCommand.getInstance().getArmyGenerals(this._data);
            let firstGeneralCfg: GeneralConfig = GeneralCommand.getInstance().proxy.getGeneralCfg(generals[0].cfgId);
            let curSoldierCnt: number = ArmyCommand.getInstance().getArmyCurSoldierCnt(this._data);
            let totalSoldierCnt: number = ArmyCommand.getInstance().getArmyTotalSoldierCntByGenerals(generals);
            if (this._data.cmd == ArmyCmd.Reclaim) {
                //屯田中
                this.labelState.string = "屯田中...";
            } else if(this._data.cmd == ArmyCmd.Conscript){
                this.labelState.string = "征兵中...";
            } else if (this._data.cmd > 0) {
                this.labelState.string = "队伍外派中...";
            } else {
                this.labelState.string = "";
            }
            this.labelId.string = this.order + "";
            this.headIcon.getComponent(GeneralHeadLogic).setHeadId(generals[0].cfgId);
            this.labelLv.string = generals[0].level + "";
            this.labelName.string = firstGeneralCfg.name;
            this.labelSoldierCnt.string = curSoldierCnt + "/" + totalSoldierCnt;
            // this.labelArms.string = "";

            if (generals[1]) {
                let sencondGeneralCfg: GeneralConfig = GeneralCommand.getInstance().proxy.getGeneralCfg(generals[1].cfgId);
                this.labelVice1.string = sencondGeneralCfg.name;
            } else {
                this.labelVice1.string = "无";
            }

            if (generals[2]) {
                let thirdGeneralCfg: GeneralConfig = GeneralCommand.getInstance().proxy.getGeneralCfg(generals[2].cfgId);
                this.labelVice2.string = thirdGeneralCfg.name;
            } else {
                this.labelVice2.string = "无";
            }
        } else {
            if(this._isOut){
                this.tipNode.active = true;
                this.infoNode.active = false;
                this.labelTip.string = "暂无队伍";
            }else{
                this.tipNode.active = true;
                this.infoNode.active = false;
                this.labelTip.string = "点击编制队伍";
            }
        }
    }

    public isOpenedArmy(bool: boolean, isOut: boolean): void {
        this._isOpened = bool;
        this.infoNode.active = false;
        this.maskNode.active = !this._isOpened;
        this.tipNode.active = !this._isOpened;
        this._isOut = isOut;
        if (this._isOpened == false) {
            if (this._isOut){
                this.labelTip.string = " 等级" + this.order + "开启";
            }else{
                let desName: string = MapUICommand.getInstance().proxy.getFacilityCfgByType(13).name;
                this.labelTip.string = desName + " 等级" + this.order + "开启";
            }
        }
    }

    public setArmyData(cityId: number, data: ArmyData): void {
        this._cityId = cityId;
        this._data = data;
        this._troop = null;
        this._usesWorldTroop = false;
        this.updateItem();
        if (this._overviewWidth) this.layoutOverview(this._overviewWidth, this._overviewHeight);
    }

    public setTroopData(cityId: number, troop: TroopData): void {
        this._cityId = cityId;
        this._data = null;
        this._troop = troop;
        this._usesWorldTroop = true;
        this.updateItem();
        if (this._overviewWidth) this.layoutOverview(this._overviewWidth, this._overviewHeight);
    }

    public layoutOverview(width: number, height: number): void {
        this._overviewWidth = width; this._overviewHeight = height;
        this.infoNode.active = false; this.tipNode.active = false;
        this.maskNode.active = !this._isOpened; hideSprite(this.maskNode);
        const bg = this.node.getChildByName('bg'); place(bg, 0, 0, width, height); hideSprite(bg);
        inkSurface(bg, 'CityTroopCard', width, height, new Color(45, 51, 41, 235), new Color(165, 143, 98, 130));
        const proxy = GeneralCommand.getInstance().proxy;
        const heroes = this._usesWorldTroop ? [0, 1, 2].map(p => proxy.getMyGeneral(this._troop?.getHeroIdxAt(p) || 0))
            : this._data ? ArmyCommand.getInstance().getArmyGenerals(this._data) : [];
        const count = heroes.filter(Boolean).length;
        const march = WorldCommand.getInstance().marches.get(this.order);
        const state = !this._isOpened ? '尚未解锁' : !count ? '待编队' : march?.state === 1 ? '行军中'
            : WorldCommand.getInstance().isTroopAtHome(this.order) ? '驻守主城' : '驻留在外';
        caption(this.node, 'TroopTitle', `第${this.order}部队`, -width / 2 + 60, height / 2 - 19, 96, 16, C.gold);
        caption(this.node, 'TroopState', state, width / 2 - 64, height / 2 - 19, 104, 12,
            count ? new Color(150, 191, 165) : C.muted, Label.HorizontalAlign.RIGHT);
        const compact = height < 140, portraitHeight = compact ? 44 : 62, portraitWidth = portraitHeight * 350 / 480;
        for (let i = 0; i < 3; i++) {
            let slot = this.node.getChildByName('HeroSlot' + i);
            if (!slot) {
                slot = new Node('HeroSlot' + i); slot.layer = this.node.layer; this.node.addChild(slot); slot.addComponent(UITransform);
                const portrait = new Node('Portrait'); portrait.layer = slot.layer; slot.addChild(portrait);
                portrait.addComponent(UITransform); portrait.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
                portrait.addComponent(GeneralHeadLogic);
            }
            const x = (i - 1) * (width - 24) / 3;
            place(slot, x, compact ? -1 : 2, (width - 24) / 3, portraitHeight + 24);
            const portrait = slot.getChildByName('Portrait'); place(portrait, 0, 8, portraitWidth, portraitHeight);
            portrait.active = !!heroes[i];
            if (heroes[i]) portrait.getComponent(GeneralHeadLogic).setHeadId(heroes[i].cfgId || heroes[i].hero_type);
            const name = heroes[i] ? proxy.getGeneralCfg(heroes[i].cfgId || heroes[i].hero_type)?.name || '武将' : '待上阵';
            caption(slot, 'Name', name, 0, -portraitHeight / 2 - 3, (width - 30) / 3, 12,
                heroes[i] ? C.text : C.muted, Label.HorizontalAlign.CENTER);
            const empty = caption(slot, 'Empty', '＋', 0, 8, 40, 24, C.muted, Label.HorizontalAlign.CENTER); empty.node.active = !heroes[i];
        }
        let healthy = 0, hurt = 0;
        if (this._troop) for (const hero of this._troop.getSortedHeroes()) {
            const soldiers = this._troop.getSoldier(hero.heroIdx); healthy += soldiers.count; hurt += soldiers.hurtCount;
        }
        const summary = this._usesWorldTroop ? `兵力 ${healthy}${hurt ? ' · 伤兵 ' + hurt : ''}`
            : count ? this.labelSoldierCnt.string : '尚未配置武将';
        caption(this.node, 'TroopSoldiers', summary, -34, -height / 2 + 17, width - 92, 12, C.muted);
        caption(this.node, 'TroopEdit', '编队  ›', width / 2 - 40, -height / 2 + 17, 56, 12, C.gold, Label.HorizontalAlign.RIGHT);
    }

    private updateTroopItem(): void {
        const troop = this._troop;
        const hasHeroes = !!troop && troop.getHeroCount() > 0;
        this.tipNode.active = !hasHeroes;
        this.infoNode.active = hasHeroes;
        this.labelId.string = String(this.order);
        if (!hasHeroes) {
            this.labelTip.string = '点击编制队伍';
            return;
        }
        const generals = GeneralCommand.getInstance().proxy;
        const leaderIdx = troop.getHeroIdxAt(0);
        const leader = generals.getMyGeneral(leaderIdx);
        const nameAt = (position: number) => {
            const heroIdx = troop.getHeroIdxAt(position);
            return heroIdx ? (generals.getGeneralCfg(heroIdx)?.name || `武将${heroIdx}`) : '无';
        };
        this.headIcon.node.active = !!leader;
        if (leader) this.headIcon.getComponent(GeneralHeadLogic)?.setHeadId(leader.cfgId);
        this.labelName.string = leaderIdx ? nameAt(0) : '主将未上阵';
        this.labelLv.string = leader ? String(leader.level) : '—';
        this.labelVice1.string = nameAt(1);
        this.labelVice2.string = nameAt(2);
        this.labelState.string = '已编队';
        this.labelArms.string = '';
        let healthy = 0, hurt = 0;
        for (const hero of troop.getSortedHeroes()) {
            const soldier = troop.getSoldier(hero.heroIdx);
            healthy += soldier.count;
            hurt += soldier.hurtCount;
        }
        this.labelSoldierCnt.string = `${healthy}（伤兵 ${hurt}）`;
    }
}
