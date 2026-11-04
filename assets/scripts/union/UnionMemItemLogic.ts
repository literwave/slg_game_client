// // Learn TypeScript:
// //  - https://docs.cocos.com/creator/manual/en/scripting/typescript.html
// // Learn Attribute:
// //  - https://docs.cocos.com/creator/manual/en/scripting/reference/attributes.html
// // Learn life-cycle callbacks:
// //  - https://docs.cocos.com/creator/manual/en/scripting/life-cycle-callbacks.html

import { _decorator, Component, Label } from 'cc';
const { ccclass, property } = _decorator;


import UnionCommand from "./UnionCommand";
import { Member } from "./UnionProxy";
import { EventMgr } from '../utils/EventMgr';
import { AudioManager } from '../common/AudioManager';
import { LogicEvent } from '../common/LogicEvent';
import { hasId } from '../network/pto/ProtocolCommand';

@ccclass('UnionMemItemLogic')
export default class UnionMemItemLogic extends Component {

    @property(Label)
    nameLabel: Label = null;

    @property(Label)
    titleLabel: Label = null;

    @property(Label)
    posLabel: Label = null;

    protected _menberData:Member = null;

    protected onLoad():void{
    }

    protected updateItem(data:Member):void{
        this._menberData = data;
        this.titleLabel.string = "(" + this._menberData.titleDes + ")";
        this.nameLabel.string = this._menberData.name;
        this.posLabel.string = `等级 ${data.level} · ${data.offlineTime === 0 ? '在线' : '离线'}`;
    }

    protected click():void{
        AudioManager.instance.playClick();
        EventMgr.emit(LogicEvent.clickUnionMemberItem, this._menberData);
    }

    protected kick():void{
        AudioManager.instance.playClick();
        UnionCommand.getInstance().unionKick(this._menberData.rid);
    }

    
    protected appoint():void{
        AudioManager.instance.playClick();
        UnionCommand.getInstance().unionAppoint(this._menberData.rid);
    }

    protected abdicate():void{
        AudioManager.instance.playClick();
        UnionCommand.getInstance().unionAbdicate(this._menberData.rid);
    }
    
    protected jump():void{
        AudioManager.instance.playClick();
        if (this._menberData && hasId(this._menberData.rid)) {
            EventMgr.emit(LogicEvent.openPlayerProfile, this._menberData.rid);
        }
    }

}
