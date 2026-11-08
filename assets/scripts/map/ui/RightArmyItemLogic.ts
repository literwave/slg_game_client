import { _decorator, Button, Color, Component, Label, Node, Sprite, UITransform, Layout } from 'cc';
const { ccclass, property } = _decorator;

import { ArmyCmd, ArmyData } from "../../general/ArmyProxy";
import GeneralCommand from "../../general/GeneralCommand";
import ArmyCommand from "../../general/ArmyCommand";
import { GeneralConfig, GeneralData } from "../../general/GeneralProxy";
import { TroopData } from "../../general/TroopProxy";
import WorldCommand, { MarchTargetType } from '../../world/WorldCommand';
import CityCommand from '../../world/CityCommand';
import LoginCommand from '../../login/LoginCommand';
import WorldCampaign from '../WorldCampaign';
import { idKey } from '../../network/pto/ProtocolCommand';
import { siegePhase } from '../entries/SiegeContact';
import { buildMarchPath, sampleMarchPath } from '../../world/MarchPath';
import { TroopStateEnum } from '../../config/enum/TroopStateEnum';
import { MapCityData } from "../MapCityProxy";
import MapCommand from "../MapCommand";
import DateUtil from "../../utils/DateUtil";
import GeneralHeadLogic from "./GeneralHeadLogic";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { commandAction, commandStat, CommandGlyph } from './RightSidebarView';
import { troopSidebarCard, troopSidebarDetail, troopSidebarRoute, TroopRoutePoints } from './TroopSidebarCard';

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
    private occupationKey = '';
    private portraitButton: Button = null;
    private detailButton: Button = null;

    protected onLoad(): void {
        EventMgr.on(LogicEvent.updateGeneral, this.onUpdateGeneral, this);
        EventMgr.on(LogicEvent.updateTroop, this.onUpdateTroop, this);
        EventMgr.on(LogicEvent.updateMarches, this.onUpdateGeneral, this);
        EventMgr.on(LogicEvent.updateAllianceCities, this.onUpdateGeneral, this);
        EventMgr.on(LogicEvent.updateWorldEntities, this.onOccupationChanged, this);
        EventMgr.on(LogicEvent.protocolRequestChanged, this.onUpdateGeneral, this);
        EventMgr.on(LogicEvent.updateMyRole, this.onUpdateGeneral, this);
        this.bindPortraitAction();
        this.bottomNode.active = false;
        this.layoutItem();
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this.headIcon?.node.off(Button.EventType.CLICK, this.onClickPortrait, this);
        this.detailButton?.node.off(Button.EventType.CLICK, this.onClickPortrait, this);
        const route = this.bottomNode?.getChildByName('RoutePoints');
        route?.getChildByName('Origin')?.targetOff(this);
        route?.getChildByName('Destination')?.targetOff(this);
        this._data = null;
        this._troop = null;
    }

    protected update(): void {
        if (this._troop) {
            // 到时即更新队伍徽标，不必等待下一条 AOI 推送才结束“占领中”。
            this.onOccupationChanged();
            const world = WorldCommand.getInstance(), march = world.marches.get(this._troop.troopIdx);
            if (this.labelPos && world.isTroopAtHome(this._troop.troopIdx)) {
                this.labelPos.string = this._troop.getHeroIdxAt(0) > 0 ? '主城待命'
                    : this._troop.getHeroCount() ? '主将未上阵' : '尚未编队';
            } else if (march && this.labelPos) {
                const left = Math.max(0, march.endTime * 1000 - DateUtil.getServerTime());
                const occupation = march.targetType === MarchTargetType.OccupyResource && march.state === 2
                    && world.occupyCountdownAt(march.endPos.x, march.endPos.y, DateUtil.getServerTime() / 1000);
                if (march.troopState === TroopStateEnum.SIEGE) {
                    const phase = siegePhase(CityCommand.getInstance().cities.get(idKey(march.targetId)));
                    const text = phase === 'wall' ? '拆城' : '交战';
                    this.labelPos.string = left > 0 ? `${text} ${DateUtil.converSecondStr(left)}` : `${text}结算中`;
                } else if (occupation) {
                    const remaining = Math.max(0, occupation.endTime - DateUtil.getServerTime() / 1000);
                    this.labelPos.string = remaining > 0 ? `占领中 ${DateUtil.converSecondStr(Math.ceil(remaining) * 1000)}`
                        : `驻留 (${march.endPos.x}, ${march.endPos.y})`;
                } else if (march.state === 1) {
                    this.labelPos.string = `${march.targetType === MarchTargetType.ReturnCity ? '回城'
                        : march.targetType === MarchTargetType.Redeploy ? '调动'
                        : march.targetType === MarchTargetType.Move ? '移动' : '行军'} ${DateUtil.converSecondStr(left)}`;
                } else {
                    this.labelPos.string = `驻留 (${march.endPos.x}, ${march.endPos.y})`;
                }
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

    private onOccupationChanged(): void {
        if (!this._troop) return;
        const world = WorldCommand.getInstance(), march = world.marches.get(this._troop.troopIdx);
        const timer = march?.state === 2 && march.targetType === MarchTargetType.OccupyResource && march.endPos
            ? world.occupyCountdownAt(march.endPos.x, march.endPos.y, DateUtil.getServerTime() / 1000) : null;
        const key = `${this._troop.troopIdx}:${timer?.startTime || 0}:${timer?.endTime || 0}`;
        if (key === this.occupationKey) return;
        this.occupationKey = key;
        // AOI 的普通移动包不重刷头像和整张队伍卡片。
        this.refreshHeaderSkin();
    }

    protected onUpdateTroop(troop: TroopData): void {
        if (this._troop && troop && troop.troopIdx == this._troop.troopIdx) {
            this._troop = troop;
            this.updateItem();
        }
    }

    protected onClickTop(): void {
        if (this._troop && !this._troop.getHeroCount() && this.btnSetting?.active
            && this.btnSetting.getComponent(Button)?.interactable !== false) {
            this.onClickSetting();
            return;
        }
        AudioManager.instance.playClick();
        this.locateDeployedTroop();
        this.bottomNode.active = !this.bottomNode.active;
        this.layoutItem();
    }

    /** 列表在视野之外仍可定位；传递编队编号，让镜头持续跟随本人部队。 */
    private locateDeployedTroop(): void {
        if (!this._troop) return;
        const world = WorldCommand.getInstance();
        const march = world.marches.get(this._troop.troopIdx);
        if (!march || world.isTroopAtHome(this._troop.troopIdx)) return;
        const position = sampleMarchPath(march, buildMarchPath(march), DateUtil.getServerTime())?.position;
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)
            || position.x < 0 || position.y < 0 || position.x >= 1000 || position.y >= 1000) return;
        EventMgr.emit(LogicEvent.scrollToMap, position.x, position.y, 'preserve-zoom', this._troop.troopIdx);
    }

    private routePoints(): TroopRoutePoints | null {
        const cell = (point: { x: number; y: number } | null | undefined) => point
            && Number.isFinite(point.x) && Number.isFinite(point.y)
            && point.x >= 0 && point.y >= 0 && point.x < 1000 && point.y < 1000
            ? { x: Math.floor(point.x), y: Math.floor(point.y) } : null;
        const present = (origin: TroopRoutePoints['origin'], destination: TroopRoutePoints['destination'], target: number): TroopRoutePoints | null => {
            if (!origin && !destination) return null;
            const home = cell(LoginCommand.getInstance().proxy.getRoleData()?.cityPos);
            const isHome = (point: TroopRoutePoints['origin']) => !!point && !!home && point.x === home.x && point.y === home.y;
            const landmark = (point: TroopRoutePoints['origin']) => point ? WorldCampaign.landmark(point.x, point.y) : '';
            const originLandmark = landmark(origin), destinationLandmark = landmark(destination);
            let order = '进军', destinationName = '行军地', destinationIcon: CommandGlyph = 'flag';
            switch (target) {
                case MarchTargetType.ReturnCity: order = '回城'; destinationName = '主城'; destinationIcon = 'home'; break;
                case MarchTargetType.AttackCity: order = '攻城'; destinationName = '城池'; destinationIcon = 'city'; break;
                case MarchTargetType.Redeploy: order = '调动'; destinationName = '驻地'; destinationIcon = 'city'; break;
                case MarchTargetType.AttackMonster: order = '讨伐'; destinationName = '敌营'; destinationIcon = 'attack'; break;
                case MarchTargetType.OccupyResource: order = '攻占'; destinationName = '资源地'; destinationIcon = 'land'; break;
            }
            return {
                origin, destination, order,
                originName: isHome(origin) ? '主城' : originLandmark || '驻地',
                destinationName: isHome(destination) ? '主城' : destinationLandmark || destinationName,
                originIcon: isHome(origin) ? 'home' : originLandmark ? 'city' : 'flag',
                destinationIcon: isHome(destination) ? 'home' : destinationLandmark ? 'city' : destinationIcon,
            };
        };
        if (this._troop) {
            const world = WorldCommand.getInstance(), march = world.marches.get(this._troop.troopIdx);
            if (!march || world.isTroopAtHome(this._troop.troopIdx)) return null;
            const origin = cell(march.startPos) || cell(march.path?.[0]);
            const city = march.targetType === MarchTargetType.AttackCity || march.targetType === MarchTargetType.Redeploy
                ? CityCommand.getInstance().cities.get(idKey(march.targetId)) : null;
            const destination = cell(city?.pos) || cell(march.endPos) || cell(march.path?.[march.path.length - 1]);
            return present(origin, destination, march.targetType);
        }
        if (!this._data || this._data.state <= 0) return null;
        // 旧 ArmyData 已在接包时处理回城方向，不能在显示层再交换起终点。
        const origin = cell({ x: this._data.fromX, y: this._data.fromY });
        const destination = cell({ x: this._data.toX, y: this._data.toY });
        const target = this._data.cmd === ArmyCmd.Return ? MarchTargetType.ReturnCity
            : this._data.cmd === ArmyCmd.Transfer ? MarchTargetType.Redeploy : MarchTargetType.Move;
        const points = present(origin, destination, target);
        if (points && this._data.cmd === ArmyCmd.Attack) points.order = '出征';
        if (points && this._data.cmd === ArmyCmd.Garrison) points.order = '驻防';
        if (points && this._data.cmd === ArmyCmd.Reclaim) points.order = '屯田';
        return points;
    }

    private onClickOrigin(): void { this.locateRoutePoint('origin'); }
    private onClickDestination(): void { this.locateRoutePoint('destination'); }

    private locateRoutePoint(which: 'origin' | 'destination'): void {
        // 点击时重新读取最新指令，避免折返/改道后仍跳到上一次展开的坐标。
        const point = this.routePoints()?.[which];
        if (!point) return;
        AudioManager.instance.playClick();
        // 不附带 troopIdx：定位固定坐标并结束跟随，保留用户眼前的缩放比例。
        EventMgr.emit(LogicEvent.scrollToMap, point.x, point.y, 'preserve-zoom');
    }

    private bindPortraitAction(): void {
        const portrait = this.headIcon?.node;
        if (!portrait) return;
        this.portraitButton = portrait.getComponent(Button) || portrait.addComponent(Button);
        this.portraitButton.target = portrait;
        this.portraitButton.transition = Button.Transition.SCALE;
        this.portraitButton.zoomScale = .96;
        this.portraitButton.duration = .08;
        portrait.off(Button.EventType.CLICK, this.onClickPortrait, this);
        portrait.on(Button.EventType.CLICK, this.onClickPortrait, this);

        if (!this.bottomNode) return;
        let entry = this.bottomNode.getChildByName('ArmyEditArea');
        if (!entry) {
            entry = new Node('ArmyEditArea'); entry.layer = this.bottomNode.layer;
            entry.addComponent(UITransform); this.bottomNode.addChild(entry);
        }
        // 属性区与头像一起直达编队；放在原有按钮下层，保留回城等独立操作。
        entry.setSiblingIndex(1);
        this.detailButton = entry.getComponent(Button) || entry.addComponent(Button);
        this.detailButton.target = entry;
        this.detailButton.transition = Button.Transition.NONE;
        entry.off(Button.EventType.CLICK, this.onClickPortrait, this);
        entry.on(Button.EventType.CLICK, this.onClickPortrait, this);
    }

    private onClickPortrait(): void {
        // 与下方调整编队入口使用同一可用状态，行军、占领等状态不能绕过限制。
        if (!this.btnSetting?.activeInHierarchy || this.btnSetting.getComponent(Button)?.interactable === false) return;
        this.onClickSetting();
    }

    private layoutItem(): void {
        const top = this.node.getChildByName('topNode');
        const topUi = top?.getComponent(UITransform);
        const bottomUi = this.bottomNode?.getComponent(UITransform);
        const rootUi = this.node.getComponent(UITransform);
        if (!top || !topUi || !bottomUi || !rootUi) return;
        const hasHeroes = this._troop ? this._troop.getHeroCount() > 0 : !!this._firstGeneral;
        topUi.height = hasHeroes ? 100 : 66;
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
        const showSetting = !!this.btnSetting?.active;
        const showBack = !!this.btnBack?.active;
        const padding = 8, statHeight = 30, actionHeight = 34, actionGap = 6;
        const route = this.routePoints(), routeHeight = route ? 50 : 0;
        ui.height = padding * 2 + routeHeight + statHeight + (showSetting || showBack ? actionGap + actionHeight : 0);
        const statY = ui.height / 2 - padding - routeHeight - statHeight / 2;
        const actionY = -ui.height / 2 + padding + actionHeight / 2;
        const routeNode = troopSidebarRoute(this.bottomNode, route, ui.width - 24, ui.height / 2 - padding - 22);
        if (route && routeNode) {
            for (const [name, handler] of [['Origin', this.onClickOrigin], ['Destination', this.onClickDestination]] as const) {
                const button = routeNode.getChildByName(name);
                button.off(Button.EventType.CLICK, handler, this);
                button.on(Button.EventType.CLICK, handler, this);
            }
        }
        const background = this.bottomNode.getComponent(Sprite);
        if (background) background.enabled = false;
        const hasHeroes = this._troop ? this._troop.getSortedHeroes().length > 0 : !!this._firstGeneral;
        const hasLeader = this._troop ? this._troop.getHeroIdxAt(0) > 0 : !!this._firstGeneral;
        const emptyTroop = !!this._troop && !hasHeroes;

        const portraitUi = this.headIcon?.getComponent(UITransform);
        if (portraitUi) {
            this.headIcon.node.active = false;
            this.headIcon.sizeMode = Sprite.SizeMode.CUSTOM;
            portraitUi.setContentSize(44, 58);
            this.headIcon.node.setPosition(-ui.width / 2 + 35, 18, 0);
        }
        const textX = -ui.width / 2 + 68;
        const textWidth = ui.width - 80;
        this.styleDetailLabel(this.labelSoldierCnt, textX, emptyTroop ? 30 : 34, textWidth, 13, false);
        this.styleDetailLabel(this.labelStrength, textX, emptyTroop ? 8 : 14, textWidth, 11, true);
        this.styleDetailLabel(this.labelMorale, textX, -5, textWidth, 11, true);
        if (this.labelMorale) this.labelMorale.node.active = !emptyTroop;

        // 主将与副将已在卡片上展示，展开区仅保留属性与真实可用的操作。
        for (const name of ['SoldierStat', 'SpeedStat', 'AttackStat']) {
            const stat = this.bottomNode.getChildByName(name); if (stat) stat.active = hasHeroes;
        }
        this.labelSoldierCnt.node.active = !hasHeroes;
        this.labelStrength.node.active = false;
        this.labelMorale.node.active = false;
        if (hasHeroes) {
            const hurt = this._troop ? this._troop.getSortedHeroes().reduce((sum, hero) => sum + this._troop.getSoldier(hero.heroIdx).hurtCount, 0) : 0;
            const cell = (ui.width - 28) / 3;
            commandStat(this.bottomNode, 'SoldierStat', String(hurt), 'wounded', -cell - 6, statY, cell);
            commandStat(this.bottomNode, 'SpeedStat', this.labelStrength.string.replace(/^(速度|体力)\s*/, ''),
                'speed', 0, statY, cell, !hasLeader);
            commandStat(this.bottomNode, 'AttackStat', this.labelMorale.string.replace(/^攻击\s*/, ''), 'attack', cell + 6, statY, cell);
        } else {
            this.styleDetailLabel(this.labelSoldierCnt, -ui.width / 2 + 12, statY, ui.width - 24, 13, true);
        }

        const canEdit = showSetting && this.btnSetting.getComponent(Button)?.interactable !== false;
        if (this.portraitButton) this.portraitButton.interactable = canEdit;
        if (this.detailButton) {
            this.detailButton.interactable = canEdit;
            this.detailButton.node.getComponent(UITransform).setContentSize(ui.width - 16, statHeight);
            this.detailButton.node.setPosition(0, statY, 0);
        }
        const twoActions = showSetting && showBack;
        const width = twoActions ? (ui.width - 32) / 2 : ui.width - 24;
        const offset = twoActions ? (width + 8) / 2 : 0;
        if (showSetting) commandAction(this.btnSetting, hasHeroes ? '编队 / 补兵' : '配置武将', 'edit', -offset, actionY, width, actionHeight, true);
        if (showBack) {
            const pending = this._troop && WorldCommand.getInstance().requestInFlight(`march:${this._troop.troopIdx}`);
            commandAction(this.btnBack, pending ? '请求中…' : '回城', 'home', offset, actionY, width, actionHeight, !showSetting);
        }
        // 属性节点首次创建时也会插到首位，全部创建后再把整块底板压到最底层。
        troopSidebarDetail(this.bottomNode);
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
        const leaderIdx = this._troop ? this._troop.getHeroIdxAt(0) : this._firstGeneral?.cfgId || 0;
        const world = WorldCommand.getInstance(), march = this._troop && world.marches.get(this._troop.troopIdx);
        const occupyLeft = march && march.targetType === MarchTargetType.OccupyResource && march.state === 2
            && world.occupyCountdownAt(march.endPos.x, march.endPos.y, DateUtil.getServerTime() / 1000);
        const troopState = leaderIdx <= 0 ? '待配置' : !march || world.isTroopAtHome(this._troop.troopIdx) ? '待命'
            : march.troopState === TroopStateEnum.SIEGE ? '攻城中' : occupyLeft ? '占领中'
            : march.state === 1 ? (march.targetType === MarchTargetType.ReturnCity ? '回城中' : march.targetType === MarchTargetType.Redeploy ? '调动中' : '行军中') : '驻留';
        const state = this._data ? ArmyCommand.getInstance().getArmyStateDes(this._data).replace(/[\[\]【】]/g, '') : troopState;
        const heroes = this._troop ? [0, 1, 2].map(slot => this._troop.getHeroIdxAt(slot))
            : (this._data?.generals || []).map(id => GeneralCommand.getInstance().proxy.getMyGeneral(id)?.cfgId || 0);
        const soldiers = this._troop ? this._troop.getSortedHeroes().reduce((sum, hero) => sum + this._troop.getSoldier(hero.heroIdx).count, 0)
            : (this._data?.soldiers || []).reduce((sum, value) => sum + value, 0);
        troopSidebarCard(top, this.labelInfo, this.labelPos, {
            order, heroes, soldiers, state, expanded: !!this.bottomNode?.active,
            canEdit: !!this.btnSetting?.active && this.btnSetting.getComponent(Button)?.interactable !== false,
        });
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
        const firstHeroIdx = this._troop.getHeroIdxAt(0);
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
        if (this.labelPos) this.labelPos.string = firstHeroIdx > 0 ? "武将 " + heroes.length + "/3"
            : heroes.length > 0 ? "主将未上阵" : "尚未编队";
        const count = heroes.reduce((sum, hero) => sum + this._troop.getSoldier(hero.heroIdx).count, 0);
        const hurt = heroes.reduce((sum, hero) => sum + this._troop.getSoldier(hero.heroIdx).hurtCount, 0);
        if (this.labelSoldierCnt) this.labelSoldierCnt.string = heroes.length > 0 ? `兵力 ${count} / 伤兵 ${hurt}` : "尚未配置武将";
        if (this.labelStrength) {
            this.labelStrength.string = firstHeroIdx > 0 ? "速度 " + (firstCfg?.speed || 0)
                : heroes.length > 0 ? "主将未上阵" : "选择武将，组建你的部队";
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
