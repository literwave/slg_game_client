
import { _decorator, Component, ScrollView, Label, view } from 'cc';
const { ccclass, property } = _decorator;

import GeneralCommand from "../../general/GeneralCommand";
import TroopCommand from "../../general/TroopCommand";
import MapUICommand from "./MapUICommand";
import { ServerConfig } from "../../config/ServerConfig";
import { EventMgr } from '../../utils/EventMgr';
import ListLogic from '../../utils/ListLogic';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { applyGeneralListSkin } from './GeneralListSkin';

@ccclass('GeneralListLogic')
export default class GeneralListLogic extends Component {

    @property(ScrollView)
    scrollView: ScrollView = null;

    @property(Label)
    cntLab: Label = null;

    private _cunGeneral: number[] = [];
    private _type: number = 0;
    private _position: number = 0;
    private _convertSupported: boolean = false;
    private _visibleCount: number = 0;

    protected onLoad(): void {
        this._convertSupported = GeneralCommand.getInstance().isProtocolAvailable(ServerConfig.general_convert);
        const convertNode = this.node.getChildByPath("New Node/convertBtn");
        if (convertNode) {
            convertNode.active = this._convertSupported;
        }
    }

    protected onEnable(): void {
        applyGeneralListSkin(this.node, this._visibleCount, this._type);
        view.on('canvas-resize', this.onCanvasResize, this);
        view.on('design-resolution-changed', this.onCanvasResize, this);
        EventMgr.on(LogicEvent.updateMyGenerals, this.initGeneralCfg, this);
        EventMgr.on(LogicEvent.generalConvert, this.initGeneralCfg, this);
        EventMgr.on(LogicEvent.updateTroopList, this.initGeneralCfg, this);
        EventMgr.on(LogicEvent.troopEditSubmitted, this.onTroopEditSubmitted, this);
    }


    protected onDisable(): void {
        view.off('canvas-resize', this.onCanvasResize, this);
        view.off('design-resolution-changed', this.onCanvasResize, this);
        EventMgr.targetOff(this);
    }

    private onCanvasResize(): void {
        applyGeneralListSkin(this.node, this._visibleCount, this._type);
    }

    protected onClickClose(): void {
        AudioManager.instance.playClick();
        this.node.active = false;
    }

    private onTroopEditSubmitted(): void {
        // 发送成功才退出选将；数据校验或发送失败时保留当前选择界面。
        if (this._type === 1) this.node.active = false;
    }

    protected onClickConvert(): void {
        AudioManager.instance.playClick();
        if (!this._convertSupported) {
            EventMgr.emit(LogicEvent.showToast, "武将转换暂未开放");
            return;
        }
        EventMgr.emit(LogicEvent.openGeneralConvert);
        this.node.active = false;
    }

    protected onTuJianConvert(): void {
        AudioManager.instance.playClick();
        EventMgr.emit(LogicEvent.openGeneralRoster);
        this.node.active = false;
    }

    protected initGeneralCfg(): void {
        if (!this.scrollView) {
            return;
        }

        const limit = 100;
        const proxy = GeneralCommand.getInstance().proxy;
        const cnt = proxy.getMyActiveGeneralCnt();
        if (this.cntLab) {
            this.cntLab.string = "(" + cnt + "/" + limit + ")";
        }

        const excluded = new Set<number>();
        const assigned = this._type === 1
            ? Array.from(TroopCommand.getInstance().proxy.getAssignedHeroIds()) : this._cunGeneral;
        assigned.forEach((id) => {
            const heroIdx = Number(id);
            if (heroIdx > 0) {
                excluded.add(heroIdx);
            }
        });

        const troops = TroopCommand.getInstance().proxy;
        const list = proxy.getUseGenerals()
            .filter((general) => !excluded.has(general.hero_type))
            // 只改变武将列表的分组优先级；组内保留品质、等级等原有顺序。
            .sort((a, b) => Number(troops.isHeroInTroop(b.hero_type)) - Number(troops.isHeroInTroop(a.hero_type)))
            .map((general) => Object.assign({}, general, {
                listType: this._type, listPosition: this._position, listAppearance: 'roster',
            }));

        const comp = this.scrollView.node.getComponent(ListLogic);
        if (comp) {
            this._visibleCount = list.length;
            applyGeneralListSkin(this.node, this._visibleCount, this._type);
            comp.setData(list);
        }
    }



    public setData(data: number[], type: number = 0, position: number = 0): void {
        this._cunGeneral = [];
        if (data && data.length > 0) {
            this._cunGeneral = data;
        }

        this._type = type;
        this._position = position;

        this.initGeneralCfg();
        GeneralCommand.getInstance().qryMyGenerals();
        TroopCommand.getInstance().requestTroops();
    }

}
