import { _decorator, Component, Label } from 'cc';
const { ccclass, property } = _decorator;

import { MapCityData } from "../MapCityProxy";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { commandListEntry } from './RightSidebarView';

@ccclass('RightCityItemLogic')
export default class RightCityItemLogic extends Component {
    @property(Label)
    labelInfo: Label = null;
    @property(Label)
    labelPos: Label = null;

    protected _data: MapCityData = null;


    protected onLoad(): void {
        this.refreshSkin();
    }

    private refreshSkin(): void {
        const level = this._data?.level || 1;
        commandListEntry(this.node, this.labelInfo, this.labelPos, 'city', `player_city_lv${Math.max(1, Math.min(30, level))}`, this._data?.level || 0);
    }

    protected onDestroy(): void {
        this._data = null;
    }

    protected onClickBg(): void {
        AudioManager.instance.playClick();
        if (this._data) {
            // 城池列表作为回城入口，回到与进场相同的默认视野。
            EventMgr.emit(LogicEvent.scrollToMap, this._data.x, this._data.y, 'player-city');
        }
    }

    public setArmyData(data: MapCityData): void {
        this._data = data;
        if (this._data) {
            this.labelInfo.string = this._data.name;
            this.labelPos.string = "(" + this._data.x + ", " + this._data.y + ")";
            this.refreshSkin();
        }
    }
}
