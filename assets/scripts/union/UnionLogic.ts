import UnionCommand from './UnionCommand';

import { _decorator, Component, Node, Label, view } from 'cc';
import { AudioManager } from '../common/AudioManager';
import { LogicEvent } from '../common/LogicEvent';
const { ccclass, property } = _decorator;

import { MapCityData } from "../map/MapCityProxy";
import MapCommand from "../map/MapCommand";
import { EventMgr } from '../utils/EventMgr';
import { styleUnion } from './UnionSkin';

@ccclass('UnionLogic')
export default class UnionLogic extends Component {
    @property(Node)
    createNode:Node | null = null;
    @property(Node)
    mainNode:Node | null = null;
    @property(Node)
    lobbyNode:Node | null = null;
    @property(Node)
    memberNode:Node | null = null;
    @property(Node)
    applyNode:Node | null = null;
    
    @property(Node)
    logNode:Node | null = null;
    @property(Label)
    nameLab:Label | null = null;
    private layoutQueued = false;
    protected onLoad():void{
        this.visibleView();
        EventMgr.on(LogicEvent.openMyUnion,this.openMyUnion,this);
        EventMgr.on(LogicEvent.dismissUnionSuccess,this.onDismiss,this);
        EventMgr.on(LogicEvent.closeUnion,this.closeUnion,this);
        EventMgr.on(LogicEvent.createUnionSuccess,this.openMyUnion,this);
        EventMgr.on(LogicEvent.unionChange,this.refreshMembership,this);
        for (const event of [LogicEvent.unionInfo, LogicEvent.unionNotice, LogicEvent.updateUnionMember,
            LogicEvent.updateUnionApply, LogicEvent.updateUnionList, LogicEvent.unionLog, LogicEvent.clickUnionMemberItem]) {
            EventMgr.on(event, this.queueLayout, this);
        }
        view.on('design-resolution-changed', this.queueLayout, this);
        view.on('canvas-resize', this.queueLayout, this);
    }
    protected onDestroy():void{
        EventMgr.targetOff(this);
        view.off('design-resolution-changed', this.queueLayout, this);
        view.off('canvas-resize', this.queueLayout, this);
    }
    private queueLayout(): void {
        if (!this.node.activeInHierarchy || this.layoutQueued) return;
        this.layoutQueued = true;
        this.scheduleOnce(() => {
            this.layoutQueued = false;
            if (this.isValid && this.node.activeInHierarchy) styleUnion(this.node);
        }, 0);
    }
    protected onClickClose(): void {
        console.log("onClickClose");
        AudioManager.instance.playClick();
        this.closeUnion();
    }
    protected onClickMember(): void {
        AudioManager.instance.playClick();
        this.memberNode.active = true;
        this.mainNode.active = false;
        this.queueLayout();
    }
    protected onClickApply(): void {
        AudioManager.instance.playClick();
        this.mainNode.active = false;
        this.applyNode.active = true;
        this.queueLayout();
    }
    protected onClickLog(): void {
        AudioManager.instance.playClick();
        this.mainNode.active = false;
        this.logNode.active = true;
        this.queueLayout();
    }
    protected openCreate():void{
        AudioManager.instance.playClick();
        this.createNode.active = true;
        this.queueLayout();
    }
    protected visibleView():void{
        this.memberNode.active =
        this.createNode.active =
        this.lobbyNode.active =
        this.applyNode.active =
        this.memberNode.active =
        this.logNode.active = false;
    }

    protected closeUnion(){
        this.node.active = false;
    }

    protected openMyUnion():void{
        
        this.visibleView();
        this.mainNode.active = true
        this.queueLayout();
    }
    protected onEnable():void{

        UnionCommand.getInstance().requestMine();
        this.refreshMembership();
        styleUnion(this.node);
    }
    private refreshMembership(): void {
        if (!this.node.activeInHierarchy) return;
        if(UnionCommand.getInstance().proxy.isMeInUnion()){
            this.openMyUnion();
        }else{
            this.mainNode.active = false;
            this.lobbyNode.active = true;
        }
        this.queueLayout();
    }
    protected onDisable():void{
        this.visibleView();
        this.unscheduleAllCallbacks(); this.layoutQueued = false;
    }
    protected back():void{
        AudioManager.instance.playClick();
        this.openMyUnion();
    }
    protected onDismiss():void{
        this.visibleView();
        this.lobbyNode.active = true
        this.queueLayout();
    }
}

