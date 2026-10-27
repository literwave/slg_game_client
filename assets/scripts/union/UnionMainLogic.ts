import { _decorator, Component, Label, Node, EditBox, Button } from 'cc';
const {ccclass, property} = _decorator;

import UnionCommand from "./UnionCommand";
import { Union } from "./UnionProxy";
import { MapCityData } from "../map/MapCityProxy";
import MapCommand from "../map/MapCommand";
import { EventMgr } from '../utils/EventMgr';
import { AudioManager } from '../common/AudioManager';
import { LogicEvent } from '../common/LogicEvent';

@ccclass('UnionMainLogic')
export default class UnionMainLogic extends Component {
    @property(Label)
    nameLab: Label | null = null;
    @property(Label)
    mengZhuLab: Label | null = null;
    @property(Label)
    noticeLab: Label | null = null;
    @property(Node)
    editNode: Node | null = null;
    @property(EditBox)
    editBox: EditBox | null = null;
    @property(Button)
    modifyBtn: Button | null = null;
    @property(Button)
    applyBtn: Button | null = null;
    @property(Node)
    applyRedDot: Node | null = null;
    
    onLoad () {
        EventMgr.on(LogicEvent.unionNotice,this.onUnionNotice,this);
        EventMgr.on(LogicEvent.unionInfo,this.onInfo, this);
        EventMgr.on(LogicEvent.updateUnionApply, this.onUnionApply, this);
    }
    
    protected onDestroy():void{
        EventMgr.targetOff(this);
    }
    onEnable() {
        this.editNode.active = false;
        let city:MapCityData = MapCommand.getInstance().cityProxy.getMyMainCity();
        UnionCommand.getInstance().unionInfo(UnionCommand.getInstance().proxy.myAllianceId);
        this.onInfo();
        this.updateRedDot()
    }
    updateRedDot(){
        let city:MapCityData = MapCommand.getInstance().cityProxy.getMyMainCity();
        let cnt = UnionCommand.getInstance().proxy.getApplyCnt(UnionCommand.getInstance().proxy.myAllianceId);
        this.applyRedDot.active = cnt > 0;
    }
    onInfo(){
        
        let city:MapCityData = MapCommand.getInstance().cityProxy.getMyMainCity();
        let unionData:Union = UnionCommand.getInstance().proxy.getUnion(UnionCommand.getInstance().proxy.myAllianceId);
        if (!unionData) return;
        this.nameLab.string = unionData.name;
        if (unionData.notice == ""){
            this.noticeLab.string = "暂无公告";
        }else{
            this.noticeLab.string = unionData.notice;
        }
        this.mengZhuLab.string = unionData.getChairman().name;
        let ok = UnionCommand.getInstance().proxy.canManage();
        const editing = ok && this.editNode.active;
        this.noticeLab.node.active = !editing;
        this.editNode.active = editing;
        this.modifyBtn.node.active = ok && !editing;
        this.applyBtn.node.active = ok;
    }
    onUnionNotice(data){
        if (data.text == ""){
            this.noticeLab.string = "暂无公告";
        }else{
            this.noticeLab.string = data.text;
        }
    }
    
    onUnionApply(){
        this.onInfo();
        this.updateRedDot();
    }

    onEditSubmit(){
        AudioManager.instance.playClick();
        this.noticeLab.node.active = true;
        this.editNode.active = false;
        this.modifyBtn.node.active = true;

        var str = this.editBox.string
        UnionCommand.getInstance().modNotice(str);
    }

    onModify(){
        AudioManager.instance.playClick();
        this.editBox.string = UnionCommand.getInstance().proxy.getUnion()?.notice || '';
        this.noticeLab.node.active = false;
        this.editNode.active = true;
        this.modifyBtn.node.active = false;
    }
    
    onCancel(){
        AudioManager.instance.playClick();
        this.noticeLab.node.active = true;
        this.editNode.active = false;
        this.modifyBtn.node.active = true;
    }
}
