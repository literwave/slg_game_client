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
import WorldCommand, { MarchTargetType } from '../../world/WorldCommand';
import type { MarchRoutePreview } from '../../world/WorldCommand';
import { TroopStateEnum } from '../../config/enum/TroopStateEnum';
import CityCommand from '../../world/CityCommand';
import { idKey } from '../../network/pto/ProtocolCommand';
import MapCommand from '../MapCommand';
import MapUtil from '../MapUtil';
import { isResourceLandCell } from '../../world/ResourceLand';
import { hideSprite, inkSurface, ManagementColors as C, place, textStyle } from './ManagementStyle';

export type TroopOrderAction = 'occupy' | 'move' | 'attackCity' | 'redeploy';

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
    private action: TroopOrderAction = 'occupy';
    public onSelected: ((troopIdx: number) => void) | null = null;
    private selected = false;
    private rowWidth = 280;
    private rowHeight = 96;

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
        if (this.troopIdx && this.onSelected) {
            AudioManager.instance.playClick();
            this.onSelected(this.troopIdx);
            return;
        }
        this.dispatchOrder();
    }

    /** 选中卡片只改变选择，实际指令由面板底部的确认按钮触发。 */
    public dispatchOrder(): void {
        AudioManager.instance.playClick();
        if (this.troopIdx) {
            const world = WorldCommand.getInstance();
            const map = MapCommand.getInstance();
            const cell = map.proxy.getResData(MapUtil.getIdByCellPoint(this._toX, this._toY));
            const troop = TroopCommand.getInstance().proxy.getTroop(this.troopIdx);
            if (this.action === 'attackCity') {
                const issue = world.cityAttackIssue(this._toX, this._toY) || this.troopIssue(troop);
                if (issue) { EventMgr.emit(LogicEvent.showToast, issue); return; }
                const city = CityCommand.getInstance().at(this._toX, this._toY);
                if (idKey(city?.entityId) !== idKey(this.resourceEntityId)) {
                    EventMgr.emit(LogicEvent.showToast, '城池已变更，请重新选择'); return;
                }
                if (!world.attackCity(this.troopIdx, this._toX, this._toY)) {
                    EventMgr.emit(LogicEvent.showToast, '攻城指令未发出，请重试'); return;
                }
                EventMgr.emit(LogicEvent.closeArmyAelectUi); return;
            }
            if (this.action === 'redeploy') {
                const issue = world.cityRedeployIssue(this._toX, this._toY) || this.troopIssue(troop);
                if (issue) { EventMgr.emit(LogicEvent.showToast, issue); return; }
                const city = CityCommand.getInstance().at(this._toX, this._toY);
                if (idKey(city?.entityId) !== idKey(this.resourceEntityId)) {
                    EventMgr.emit(LogicEvent.showToast, '城池已变更，请重新选择'); return;
                }
                if (!world.redeployTroop(this.troopIdx, this._toX, this._toY)) {
                    EventMgr.emit(LogicEvent.showToast, '调动指令未发出，请重试'); return;
                }
                EventMgr.emit(LogicEvent.closeArmyAelectUi); return;
            }
            if (this.action === 'move') {
                const issue = map.moveTargetIssue(this._toX, this._toY) || this.troopIssue(troop);
                if (issue) { EventMgr.emit(LogicEvent.showToast, issue); return; }
                if (!world.moveTroop(this.troopIdx, { x: this._toX, y: this._toY })) {
                    EventMgr.emit(LogicEvent.showToast, '移动请求尚未完成或部队状态已变更，请稍后重试'); return;
                }
                EventMgr.emit(LogicEvent.closeArmyAelectUi); return;
            }
            const empty = !!cell?.isEmpty;
            const blocked = (!empty && !isResourceLandCell(cell)) || !!map.cityProxy.getCity(MapUtil.getIdByCellPoint(this._toX, this._toY));
            const reason = blocked ? '目标已失效，请重新选择空地或资源地'
                : map.campaignBlockReason(this._toX, this._toY)
                    || (empty ? world.emptyLandIssue(this._toX, this._toY) : world.resourceLandIssue(this._toX, this._toY, cell.type, cell.level));
            if (reason || String(world.resourceLandEntityId(this._toX, this._toY)) !== String(this.resourceEntityId)) {
                EventMgr.emit(LogicEvent.showToast, reason || '目标已变更，请重新选择资源地'); return;
            }
            const unavailable = this.troopIssue(troop);
            if (unavailable) { EventMgr.emit(LogicEvent.showToast, unavailable); return; }
            const leader = troop?.getHeroIdxAt(0);
            if (!leader || troop.getSoldier(leader).count <= 0 || !world.occupyResourceLand(this.troopIdx, this._toX, this._toY)) {
                EventMgr.emit(LogicEvent.showToast, '部队暂无可用兵力或请求尚未完成'); return;
            }
            EventMgr.emit(LogicEvent.closeArmyAelectUi); return;
        }
        if (this._data && this.tipNode.active == false) {
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
        this.onSelected = null;
        this.troopIdx = 0; this.resourceEntityId = 0;
        this._data = data;
        this._cmd = cmd;
        this._toX = x;
        this._toY = y;
        // console.log("setArmyData", arguments);
        this.updateItem();
    }
    public setTroopData(troop: TroopData, x: number, y: number, action: TroopOrderAction = 'occupy'): void {
        this._data = null; this.troopIdx = troop.troopIdx; this._toX = x; this._toY = y;
        this.action = action;
        const world = WorldCommand.getInstance();
        this.resourceEntityId = (action === 'attackCity' || action === 'redeploy') ? CityCommand.getInstance().at(x, y)?.entityId || 0
            : action === 'occupy' ? world.resourceLandEntityId(x, y) : 0;
        const proxy = GeneralCommand.getInstance().proxy;
        const heroes = [0, 1, 2].map(pos => proxy.getMyGeneral(troop.getHeroIdxAt(pos)));
        const name = (index: number) => heroes[index] ? proxy.getGeneralCfg(heroes[index].cfgId)?.name || '武将' : '';
        const leader = troop.getHeroIdxAt(0);
        let count = 0, hurt = 0;
        for (const hero of troop.getSortedHeroes()) {
            const soldier = troop.getSoldier(hero.heroIdx); count += soldier.count; hurt += soldier.hurtCount;
        }
        const reason = this.troopIssue(troop);
        this.tipNode.active = !!reason;
        this.labelTip.string = reason;
        this.labelState.string = reason ? '' : action === 'redeploy' ? '调动  •' : action === 'move' ? '移动  ›' : action === 'attackCity' ? '攻城  ›' : '出征  ›';
        this.labelName.string = `部队${troop.troopIdx}${name(0) ? ' · ' + name(0) : ''}`;
        this.labelLv.string = heroes[0] ? `Lv.${heroes[0].level}` : '';
        this.headIcon.node.active = !!heroes[0];
        if (heroes[0]) this.headIcon.getComponent(GeneralHeadLogic).setHeadId(heroes[0].cfgId);
        this.labelVice1.string = name(1); this.labelVice2.string = name(2);
        this.labelMorale.string = `伤兵 ${hurt}`;
        this.labelSoldierCnt.string = `兵力 ${count}`;
        this.progressSoldier.progress = count + hurt > 0 ? count / (count + hurt) : 0;
    }

    private troopIssue(troop: TroopData | null | undefined): string {
        const command = TroopCommand.getInstance();
        if (!command.listReady) return '正在等待部队同步';
        if (command.editingTroopIdx) return '编队正在保存，请稍候';
        if (!troop) return '部队已变更，请重新选择';
        const world = WorldCommand.getInstance();
        if (!world.sessionReady) return '连接尚未恢复，请稍后重试';
        if (world.requestInFlight(`march:${troop.troopIdx}`)) return '指令处理中，请稍候';
        const march = world.marches.get(troop.troopIdx);
        if (march?.troopState === TroopStateEnum.SIEGE) return '攻城中，请先撤回';
        const sameEnd = march?.endPos?.x === this._toX && march?.endPos?.y === this._toY;
        // 攻城终点在城外，必须按实体判断，不能拿接敌点与城中心比较。
        const sameTarget = this.action === 'attackCity' ? march?.targetType === MarchTargetType.AttackCity
            && idKey(march.targetId) === idKey(this.resourceEntityId)
            : this.action === 'redeploy' ? march?.targetType === MarchTargetType.Redeploy
                && idKey(march.targetId) === idKey(this.resourceEntityId) : sameEnd;
        if (march?.state === 1 && sameTarget) return '正前往此处';
        if ((this.action === 'move' || this.action === 'redeploy') && march?.state === 2 && sameTarget) return '已抵达此处';
        const leader = troop.getHeroIdxAt(0);
        if (!leader) return '主将未上阵，请先编队';
        return troop.getSoldier(leader).count > 0 ? '' : '主将兵力不足，请先配兵';
    }

    public get selectionIssue(): string {
        return this.troopIssue(TroopCommand.getInstance().proxy.getTroop(this.troopIdx));
    }

    public setSelected(selected: boolean): void {
        this.selected = selected;
        this.labelState.string = selected ? '已选中' : this.action === 'redeploy' ? '可调动' : this.action === 'move' ? '可移动' : this.action === 'attackCity' ? '可攻城' : '可出征';
        this.layoutRow(this.rowWidth, this.rowHeight);
    }

    public setRoutePreview(route: MarchRoutePreview | null): void {
        if (!this.selected || this.selectionIssue || !route || route.troopIdx !== this.troopIdx) return;
        const seconds = Math.max(1, Math.ceil(route.costTime));
        const mm = ('0' + Math.floor(seconds / 60) % 60).slice(-2);
        const ss = ('0' + seconds % 60).slice(-2);
        this.labelState.string = route.status === 'ready'
            ? (seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${mm}:${ss}` : `${mm}:${ss}`)
            : route.status === 'loading' ? '寻路中…' : route.status === 'unreachable' ? '无法到达' : '寻路失败';
    }

    /** 紧凑纵向队列：主将、兵力、副将和状态在同一行卡片内读完。 */
    public layoutRow(width: number, height: number): void {
        this.rowWidth = width; this.rowHeight = height;
        // 选中状态重绘不能覆盖列表为卡片设置的位置。
        place(this.node, this.node.position.x, this.node.position.y, width, height);
        const bg = this.node.getChildByName('bg');
        if (!bg) return;
        place(bg, 0, 0, width, height); hideSprite(bg);
        inkSurface(bg, 'RowSurface', width, height, this.selected ? C.inset : C.panel, this.selected ? C.gold : C.line);
        const marker = inkSurface(bg, 'SelectedMarker', 3, height - 16, this.selected ? C.gold : null, null);
        marker.node.setPosition(-width / 2 + 2, 0, 0);
        marker.node.setSiblingIndex(bg.children.length - 1);
        for (const name of ['bgHead', 'label1', 'label2', 'label3']) {
            const old = bg.getChildByName(name); if (old) old.active = false;
        }
        const unavailable = this.tipNode.getChildByName('bgUnable');
        if (unavailable) unavailable.active = false;
        for (const label of this.node.getComponentsInChildren(Label)) {
            label.font = null; label.useSystemFont = true; label.fontFamily = 'Microsoft YaHei';
        }
        this.headIcon.sizeMode = Sprite.SizeMode.CUSTOM;
        place(this.headIcon.node, -width / 2 + 36, 10, 52, 52);
        textStyle(this.labelLv, -width / 2 + 36, -28, 56, 11, C.muted, Label.HorizontalAlign.CENTER, 18);
        const textWidth = width - 84, center = 32;
        textStyle(this.labelName, center, 29, textWidth, 16, this.tipNode.active ? C.muted : C.text, Label.HorizontalAlign.LEFT, 22);
        this.labelName.overflow = Label.Overflow.SHRINK;
        textStyle(this.labelSoldierCnt, center - textWidth / 4, 7, textWidth / 2, 13, C.text, Label.HorizontalAlign.LEFT, 20);
        textStyle(this.labelMorale, center + textWidth / 4, 7, textWidth / 2, 12, C.muted, Label.HorizontalAlign.LEFT, 20);
        textStyle(this.labelVice1, center - textWidth / 4, -14, textWidth / 2, 12, C.muted, Label.HorizontalAlign.LEFT, 20);
        textStyle(this.labelVice2, center + textWidth / 4, -14, textWidth / 2, 12, C.muted, Label.HorizontalAlign.LEFT, 20);
        this.progressSoldier.node.active = false;
        place(this.tipNode, center, -34, textWidth, 20);
        textStyle(this.labelTip, 0, 0, textWidth, 12, C.muted, Label.HorizontalAlign.RIGHT, 20);
        this.labelTip.overflow = Label.Overflow.SHRINK;
        this.labelState.node.active = !this.tipNode.active;
        textStyle(this.labelState, width / 2 - 48, -33, 76, 13, C.gold, Label.HorizontalAlign.RIGHT, 22);
    }
}
