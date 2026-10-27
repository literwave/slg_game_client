
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
    private _layoutKey = '';

    protected onLoad(): void {
        this._convertSupported = GeneralCommand.getInstance().isProtocolAvailable(ServerConfig.general_convert);
        const convertNode = this.node.getChildByPath("New Node/convertBtn");
        if (convertNode) {
            convertNode.active = this._convertSupported;
        }
    }

    protected onEnable(): void {
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
        this.applyLayout();
    }

    private applyLayout(refreshList = true): boolean {
        const size = view.getVisibleSize();
        const key = `${size.width}:${size.height}:${this._visibleCount}:${this._type}`;
        if (key === this._layoutKey) return false;
        this._layoutKey = key;
        applyGeneralListSkin(this.node, this._visibleCount, this._type, refreshList);
        return true;
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
        this.refreshGenerals(false);
    }

    private refreshGenerals(resetScroll: boolean): void {
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
            // 布局参数和新数据一起应用，避免先重画旧列表，再重画新列表。
            const relayout = this.applyLayout(false);
            comp.setData(list, resetScroll ? undefined : 0, relayout);
        }
    }



    public prepareView(): void {
        this.refreshGenerals(true);
    }

    public setData(data: number[], type: number = 0, position: number = 0): void {
        this._cunGeneral = [];
        if (data && data.length > 0) {
            this._cunGeneral = data;
        }

        this._type = type;
        this._position = position;

        this.refreshGenerals(true);
        GeneralCommand.getInstance().qryMyGenerals();
        TroopCommand.getInstance().requestTroops();
    }

}
