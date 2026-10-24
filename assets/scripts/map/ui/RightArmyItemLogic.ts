import { _decorator, Button, Color, Component, Label, Node, Sprite, UITransform, Layout } from 'cc';
const { ccclass, property } = _decorator;

import { ArmyCmd, ArmyData } from "../../general/ArmyProxy";
import GeneralCommand from "../../general/GeneralCommand";
import ArmyCommand from "../../general/ArmyCommand";
import { GeneralConfig, GeneralData } from "../../general/GeneralProxy";
import { TroopData } from "../../general/TroopProxy";
import WorldCommand, { MarchTargetType } from '../../world/WorldCommand';
import { MapCityData } from "../MapCityProxy";
import MapCommand from "../MapCommand";
import DateUtil from "../../utils/DateUtil";
import GeneralHeadLogic from "./GeneralHeadLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { drawCommandDetail, drawCommandRow, setCommandLabel, styleCommandAction } from './RightHudSkin';

@ccclass('RightArmyItemLogic')
export default class RightArmyItemLogic extends Component {
    @property(Label)
    labelInfo: Label = null;
    @property(Label)
    labelPos: Label = null;
    @property(Node)
    bottomNode: Node = null;
    @property(Sprite)
    headIcon: Sprite = null;
    @property(Label)
    labelSoldierCnt: Label = null;
    @property(Label)
    labelStrength: Label = null;
    @property(Label)
    labelMorale: Label = null;
    @property(Node)
    btnBack: Node = null;
    @property(Node)
    btnSetting: Node = null;

    public order: number = 0;
    protected _data: ArmyData = null;
    protected _troop: TroopData = null;
    protected _firstGeneral: GeneralData = null;
    protected _qryReturnTime: number = 0;

    protected onLoad(): void {
        EventMgr.on(LogicEvent.updateGeneral, this.onUpdateGeneral, this);
        EventMgr.on(LogicEvent.updateTroop, this.onUpdateTroop, this);
        EventMgr.on(LogicEvent.updateMarches, this.onUpdateGeneral, this);
        EventMgr.on(LogicEvent.protocolRequestChanged, this.onUpdateGeneral, this);
        EventMgr.on(LogicEvent.updateMyRole, this.onUpdateGeneral, this);
        this.bottomNode.active = false;
        this.layoutItem();
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this._data = null;
        this._troop = null;
    }

    protected update(): void {
        if (this._troop) {
            const world = WorldCommand.getInstance(), march = world.marches.get(this._troop.troopIdx);
            if (this.labelPos && world.isTroopAtHome(this._troop.troopIdx)) {
                this.labelPos.string = this._troop.getHeroCount() ? '主城待命' : '尚未编队';
            } else if (march && this.labelPos) {
                this.labelPos.string = march.state === 1
                    ? `${march.targetType === MarchTargetType.ReturnCity ? '回城' : march.targetType === MarchTargetType.Move ? '移动' : '行军'} ${DateUtil.converSecondStr(Math.max(0, march.endTime * 1000 - DateUtil.getServerTime()))}`
                    : `驻留 (${march.endPos.x}, ${march.endPos.y})`;
            }
        }
        if (this._data && (this._data.state > 0 || this._data.cmd == ArmyCmd.Reclaim)) {
            let nowTime: number = DateUtil.getServerTime();
            let time: number = 0;
            if (this._data.state > 0) {
                //行军或者撤退中
                time = Math.max(0, this._data.endTime - nowTime);
            } else {
                //屯田中
                time = Math.max(0, GeneralCommand.getInstance().proxy.getCommonCfg().reclamation_time * 1000 - (nowTime - this._data.endTime));
                // if (time == 0 && nowTime - this._qryReturnTime > 2000) {
                //     //屯田结束 主动请求撤退
                //     this._qryReturnTime = nowTime;
                //     this.onClickBack();
                // }
            }
            this.labelPos.string = DateUtil.converSecondStr(time);
        }
    }

    protected onUpdateGeneral(): void {
        if (this._troop) {
            this.updateItem();
        }
    }

    protected onUpdateTroop(troop: TroopData): void {
        if (this._troop && troop && troop.troopIdx == this._troop.troopIdx) {
            this._troop = troop;
            this.updateItem();
        }
    }

    protected onClickTop(): void {
        AudioManager.instance.playClick();
        this.bottomNode.active = !this.bottomNode.active;
        this.layoutItem();
    }

    private layoutItem(): void {
        const top = this.node.getChildByName('topNode');
        const topUi = top?.getComponent(UITransform);
        const bottomUi = this.bottomNode?.getComponent(UITransform);
        const rootUi = this.node.getComponent(UITransform);
        if (!top || !topUi || !bottomUi || !rootUi) return;
        this.refreshDetailSkin();
        const detailHeight = this.bottomNode.active ? bottomUi.height : 0;
        rootUi.height = topUi.height + detailHeight;
        top.setPosition(0, detailHeight * 0.5, 0);
        this.bottomNode.setPosition(0, -topUi.height * 0.5, 0);
        this.refreshHeaderSkin();
        this.node.parent?.getComponent(Layout)?.updateLayout();
    }

    private refreshDetailSkin(): void {
        const ui = this.bottomNode?.getComponent(UITransform);
        if (!ui) return;
        ui.height = 112;
        const background = this.bottomNode.getComponent(Sprite);
        if (background) background.enabled = false;
        const hasHeroes = this._troop ? this._troop.getSortedHeroes().length > 0 : !!this._firstGeneral;
        const emptyTroop = !!this._troop && !hasHeroes;
        drawCommandDetail(this.bottomNode, hasHeroes);

        const portraitUi = this.headIcon?.getComponent(UITransform);
        if (portraitUi) {
            this.headIcon.node.active = hasHeroes;
            this.headIcon.sizeMode = Sprite.SizeMode.CUSTOM;
            portraitUi.setContentSize(42, 58);
            this.headIcon.node.setPosition(-ui.width / 2 + 35, 18, 0);
        }
        const textX = -ui.width / 2 + 68;
        const textWidth = ui.width - 80;
        this.styleDetailLabel(this.labelSoldierCnt, textX, emptyTroop ? 30 : 34, textWidth, 13, false);
        this.styleDetailLabel(this.labelStrength, textX, emptyTroop ? 8 : 14, textWidth, 11, true);
        this.styleDetailLabel(this.labelMorale, textX, -5, textWidth, 11, true);
        if (this.labelMorale) this.labelMorale.node.active = !emptyTroop;

        const showSetting = !!this.btnSetting?.active;
        const showBack = !!this.btnBack?.active;
        const twoActions = showSetting && showBack;
        const width = twoActions ? (ui.width - 32) / 2 : ui.width - 24;
        const offset = twoActions ? (width + 8) / 2 : 0;
        if (showSetting) styleCommandAction(this.btnSetting, hasHeroes ? '调整编队' : '配置武将', -offset, width, true);
        if (showBack) {
            const pending = this._troop && WorldCommand.getInstance().requestInFlight(`march:${this._troop.troopIdx}`);
            styleCommandAction(this.btnBack, pending ? '请求中…' : '返回主城', offset, width, !showSetting);
        }
    }

    private styleDetailLabel(label: Label, x: number, y: number, width: number, fontSize: number, muted: boolean): void {
        const ui = label?.getComponent(UITransform);
        if (!ui) return;
        ui.setAnchorPoint(0, .5);
        ui.setContentSize(width, 20);
        label.node.setPosition(x, y, 0);
        label.fontSize = fontSize;
        label.lineHeight = 20;
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.CLAMP;
        label.enableWrapText = false;
        label.outlineWidth = 0;
        label.color = muted ? new Color(174, 177, 152, 255) : new Color(235, 227, 203, 255);
    }

    private refreshHeaderSkin(): void {
        const top = this.node.getChildByName('topNode');
        if (!top) return;
        const order = this.order || this._data?.order || 0;
        const hasHeroes = this._troop ? this._troop.getSortedHeroes().length > 0 : !!this._firstGeneral;
        const world = WorldCommand.getInstance(), march = this._troop && world.marches.get(this._troop.troopIdx);
        const troopState = !hasHeroes ? '待配置' : !march || world.isTroopAtHome(this._troop.troopIdx) ? '待命'
            : march.state === 1 ? (march.targetType === MarchTargetType.ReturnCity ? '回城中' : '行军中') : '驻留';
        const state = this._data ? ArmyCommand.getInstance().getArmyStateDes(this._data).replace(/[\[\]【】]/g, '') : troopState;
        drawCommandRow(top, !!this.bottomNode?.active, true);
        setCommandLabel(top, 'OrderBadge', order > 0 ? String(order).padStart(2, '0') : '军', -102, 1, 28, 13);
        setCommandLabel(top, 'StateBadge', state, 93, 12, 44, 10, !hasHeroes);
    }

    protected onClickBack(): void {
        AudioManager.instance.playClick();
        if (this._troop) {
            const world = WorldCommand.getInstance(), issue = world.returnToCityIssue(this._troop.troopIdx);
            if (issue) EventMgr.emit(LogicEvent.showToast, issue);
            else if (!world.returnTroopToCity(this._troop.troopIdx)) EventMgr.emit(LogicEvent.showToast, '回城请求未发送，请稍后重试');
            return;
        }
        if (this._data) {
            let cityData: MapCityData = MapCommand.getInstance().cityProxy.getMyMainCity();
            ArmyCommand.getInstance().generalAssignArmy(this._data.id, ArmyCmd.Return, cityData.x, cityData.y, null);
        }
    }

    protected onClickSetting(): void {
        AudioManager.instance.playClick();
        if (this._data) {
            EventMgr.emit(LogicEvent.openArmySetting, this._data.cityId, this.order);
        } else if (this._troop) {
            const mainCity: MapCityData = MapCommand.getInstance().cityProxy.getMyMainCity();
            EventMgr.emit(LogicEvent.openArmySetting, mainCity ? mainCity.cityId : 0, this.order);
        }
    }

    protected updateGeneralByData(): void {
        var teamName = "";
        if (this._firstGeneral) {
            let cfg: GeneralConfig = GeneralCommand.getInstance().proxy.getGeneralCfg(this._firstGeneral.cfgId);
            teamName = cfg.name;
            this.headIcon.getComponent(GeneralHeadLogic).setHeadId(this._firstGeneral.cfgId);
            this.labelStrength.string = "体力 " + this._firstGeneral.physical_power + "/" + cfg.physical_power_limit;
        }
        this.labelInfo.string = teamName + "队";
        this.refreshHeaderSkin();

    }

    protected updateItem(): void {
        if (!this._data && this._troop) {
            this.updateTroopItem();
            return;
        }
        if (this._data && this._data.generals[0] != 0) {
            // console.log("updateItem", this._data);
            this.node.active = true;
            this._firstGeneral = GeneralCommand.getInstance().proxy.getMyGeneral(this._data.generals[0]);
            this.updateGeneralByData();

            this.labelPos.string = "(" + this._data.x + ", " + this._data.y + ")";

            this.labelSoldierCnt.string = "骑兵 " + (this._data.soldiers[0] + this._data.soldiers[1] + this._data.soldiers[2]);

            if (this._data.cmd == ArmyCmd.Idle) {
                
                this.btnSetting.active = true;
                let cityData: MapCityData = MapCommand.getInstance().cityProxy.getMyCityById(this._data.cityId);
                if (cityData && cityData.x == this._data.fromX && cityData.y == this._data.fromY){
                    //代表在城池里面
                    this.btnBack.active = false;
                }else{
                    //代表在城外据点待命
                    this.btnBack.active = true;
                }

            } else if (this._data.cmd == ArmyCmd.Conscript){
                this.btnSetting.active = false;
                this.btnBack.active = false;
            } else if (this._data.state == 0 && this._data.cmd != ArmyCmd.Reclaim) {
                //停留的时候才能配置队伍和撤退
                this.btnSetting.active = false;
                this.btnBack.active = true;
            } else {
                this.btnSetting.active = false;
                this.btnBack.active = false;
            }
        } else {
            this._firstGeneral = null;
            this.node.active = false;
        }
        if (this.node.active) this.layoutItem();
    }

    protected updateTroopItem(): void {
        this.node.active = true;
        const heroes = this._troop.getSortedHeroes();
        const firstHeroIdx = heroes.length > 0 ? heroes[0].heroIdx : 0;
        this._firstGeneral = firstHeroIdx > 0 ? GeneralCommand.getInstance().proxy.getMyGeneral(firstHeroIdx) : null;
        const firstCfg: GeneralConfig = this._firstGeneral ? (this._firstGeneral.config || GeneralCommand.getInstance().proxy.getGeneralCfg(firstHeroIdx)) : null;
        const teamName = firstCfg && firstCfg.name ? firstCfg.name : "未编队";

        if (this.headIcon) {
            this.headIcon.node.active = firstHeroIdx > 0;
            const headLogic = this.headIcon.getComponent(GeneralHeadLogic);
            if (firstHeroIdx > 0 && headLogic) {
                headLogic.setHeadId(firstHeroIdx);
            }
        }
        if (this.labelInfo) this.labelInfo.string = firstCfg ? teamName + "队" : "第" + this.order + "部队";
        if (this.labelPos) this.labelPos.string = "武将 " + heroes.length + "/3";
        const count = heroes.reduce((sum, hero) => sum + this._troop.getSoldier(hero.heroIdx).count, 0);
        const hurt = heroes.reduce((sum, hero) => sum + this._troop.getSoldier(hero.heroIdx).hurtCount, 0);
        if (this.labelSoldierCnt) this.labelSoldierCnt.string = heroes.length > 0 ? `兵力 ${count} / 伤兵 ${hurt}` : "尚未配置武将";
        if (this.labelStrength) {
            this.labelStrength.string = heroes.length > 0 ? "速度 " + (firstCfg?.speed || 0) : "选择武将，组建你的部队";
        }
        if (this.labelMorale) {
            let attack: number = 0;
            heroes.forEach((hero) => {
                const general = GeneralCommand.getInstance().proxy.getMyGeneral(hero.heroIdx);
                const cfg = general ? (general.config || GeneralCommand.getInstance().proxy.getGeneralCfg(hero.heroIdx)) : null;
                if (cfg) {
                    attack += cfg.attack;
                }
            });
            this.labelMorale.string = "攻击 " + attack;
        }
        const world = WorldCommand.getInstance(), march = world.marches.get(this._troop.troopIdx);
        const atHome = world.isTroopAtHome(this._troop.troopIdx);
        const returning = march?.state === 1 && march.targetType === MarchTargetType.ReturnCity;
        if (this.btnBack) {
            this.btnBack.active = !!march && !atHome && !returning;
            const button = this.btnBack.getComponent(Button);
            if (button) button.interactable = world.sessionReady && !world.requestInFlight(`march:${this._troop.troopIdx}`);
        }
        if (this.btnSetting) this.btnSetting.active = atHome;
        this.layoutItem();
    }

    public setArmyData(data: ArmyData): void {
        this._data = data;
        this.updateItem();
    }

    public setTroopData(data: TroopData, order: number = 0): void {
        this._data = null;
        this._troop = data;
        this.order = order > 0 ? order : (data ? data.troopIdx : 0);
        this.updateItem();
    }
}
