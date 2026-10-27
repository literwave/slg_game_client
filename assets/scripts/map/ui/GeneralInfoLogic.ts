
import { _decorator, Component, Prefab, ToggleContainer, Node, UITransform, instantiate, view } from 'cc';
import GeneralCommand from "../../general/GeneralCommand";
import { ServerConfig } from '../../config/ServerConfig';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';
import { EventMgr } from '../../utils/EventMgr';
import { styleGeneralHeader } from './GeneralDetailSkin';
const { ccclass, property } = _decorator;

@ccclass('GeneralInfoLogic')
export default class GeneralInfoLogic  extends Component {


    @property(Prefab)
    generalDesPrefab: Prefab = null;

    @property(Prefab)
    generalComposePrefab: Prefab = null;


    @property(Prefab)
    generalAddPrefab: Prefab = null;


    @property(ToggleContainer)
    generalToggleContainer: ToggleContainer = null;

    
    private _currData:any = null;
    private _cfgData:any = null;

    private _curIndex:number = 0;
    private _nodeList:Node[] = [];
    private _supportedTabs:boolean[] = [true, false, false];
    private _arranging = false;
    private _layoutKey = '';

    protected onLoad():void{
        EventMgr.on(LogicEvent.updateOneGenerals, this.updateOnce, this); 

        this._supportedTabs[1] = GeneralCommand.getInstance().isProtocolAvailable(ServerConfig.general_composeGeneral);
        this._supportedTabs[2] = GeneralCommand.getInstance().isProtocolAvailable(ServerConfig.general_addPrGeneral);
        const toggles = this.generalToggleContainer ? this.generalToggleContainer.toggleItems : [];
        for (let i = 1; i < this._supportedTabs.length; i++) {
            if (toggles[i] && toggles[i].node) {
                toggles[i].node.active = this._supportedTabs[i];
            }
            if (!this._supportedTabs[i] && this._nodeList[i]) {
                this._nodeList[i].active = false;
            }
        }
        this.refreshVisualLayout();
    }

    protected onEnable(): void {
        this.node.on(Node.EventType.SIZE_CHANGED, this.refreshVisualLayout, this);
        view.on('canvas-resize', this.refreshVisualLayout, this);
        view.on('design-resolution-changed', this.refreshVisualLayout, this);
        this.refreshVisualLayout();
    }

    protected onDisable(): void {
        this.node.off(Node.EventType.SIZE_CHANGED, this.refreshVisualLayout, this);
        view.off('canvas-resize', this.refreshVisualLayout, this);
        view.off('design-resolution-changed', this.refreshVisualLayout, this);
    }

    public refreshVisualLayout(): void {
        if (this._arranging) return;
        const size = this.node.parent?.getComponent(UITransform) || view.getVisibleSize();
        const key = `${size.width}:${size.height}:${this._supportedTabs.join(',')}`;
        if (key === this._layoutKey) return;
        this._arranging = true;
        try {
            styleGeneralHeader(this.node);
            this._layoutKey = key;
        } finally {
            this._arranging = false;
        }
    }

    protected start(): void {
        // mask 的旧适配脚本在子节点 onLoad 时仍可能执行，最后统一一次背景尺寸。
        this.refreshVisualLayout();
    }

    protected updateOnce(curData:any):void{
        if (this._currData?.hero_type === curData?.hero_type) this.setData(this._cfgData,curData);
    }
   

    protected onDestroy():void{
        this._nodeList = []
        EventMgr.targetOff(this);
    }

    protected onClickClose(): void {
        AudioManager.instance.playClick();
        this.node.active = false;
    }



    public setData(cfgData:any,curData:any):void{
        this._currData = curData;
        this._cfgData = cfgData;
        this.setIndex(this._curIndex);
    }

    protected setIndex(index:number = 0):void{
        index = Number(index);
        if (!this._supportedTabs[index]) {
            index = 0;
        }
        if (!this._nodeList[index]) {
            const prefab = [this.generalDesPrefab, this.generalComposePrefab, this.generalAddPrefab][index];
            if (!prefab) return;
            // 首次只创建当前页；未开放和未点开的页不占用点击这一帧。
            const page = instantiate(prefab);
            page.active = false;
            page.parent = this.node;
            this._nodeList[index] = page;
            this.node.getChildByName('node')?.setSiblingIndex(this.node.children.length - 1);
        }
        this._curIndex = index;
        this._nodeList.forEach((page, pageIndex) => { if (page) page.active = pageIndex === index; });
        if (this.generalToggleContainer && this.generalToggleContainer.toggleItems[index]) {
            this.generalToggleContainer.toggleItems[index].isChecked = true;
        }

        let logicNameArr:string[] = ["GeneralDesLogic","GeneralComposeLogic","GeneralAddPrLogic"]
        let com = this._nodeList[index].getComponent(logicNameArr[index]);
        if(com){
            com.setData(this._cfgData, this._currData);
        }
    }


    protected allVisible():void{
        for(var i = 0; i < this._nodeList.length; i++){
            if (this._nodeList[i]) this._nodeList[i].active = false;
        }
    }

    protected selectHandle(event:any,other:any):void{
        // console.log("event:",event,other)
        if (Number(other) === this._curIndex) return;
        AudioManager.instance.playClick();
        this.setIndex(other)
    }


}
