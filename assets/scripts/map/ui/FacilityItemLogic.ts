import { _decorator, Component, Label, Node, Sprite, SpriteFrame, UITransform, resources } from 'cc';
const { ccclass, property } = _decorator;

import DateUtil from "../../utils/DateUtil";
import { Facility, FacilityConfig } from "./MapUIProxy";
import { EventMgr } from '../../utils/EventMgr';
import { AudioManager } from '../../common/AudioManager';
import { LogicEvent } from '../../common/LogicEvent';

@ccclass('FacilityItemLogic')
export default class FacilityItemLogic extends Component {
    @property(Label)
    labelRate: Label = null;
    @property(Label)
    labelName: Label = null;

    @property(Label)
    labelTime: Label = null;

    @property(Node)
    lockNode: Node = null;

    public type: number = 0;
    public isUnlock: boolean = false;
    public cityId: number = 0;
    public data: Facility = null;
    public cfg: FacilityConfig = null;
    private iconKey = '';
    private iconSprite: Sprite = null;

    /** 配置未填写专用图片时也显示建筑图，不能只留下旧边框和空底板。 */
    public setIcon(path: string, fallback: SpriteFrame): void {
        const key = path || fallback?.uuid || '';
        if (this.iconSprite && this.iconKey === key) return;
        this.iconKey = key;
        if (!this.iconSprite) {
            const icon = new Node('BuildingIcon');
            icon.layer = this.node.layer;
            (this.node.getChildByName('bg') || this.node).addChild(icon);
            icon.addComponent(UITransform);
            icon.setPosition(0, 5, 0);
            this.iconSprite = icon.addComponent(Sprite);
            this.iconSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this.iconSprite.trim = false;
        }
        const apply = (frame: SpriteFrame) => {
            this.iconSprite.spriteFrame = frame;
            if (!frame) return;
            const size = frame.originalSize, scale = Math.min(84 / size.width, 72 / size.height);
            this.iconSprite.node.getComponent(UITransform).setContentSize(size.width * scale, size.height * scale);
        };
        apply(fallback);
        if (path) resources.load(path.endsWith('/spriteFrame') ? path : `${path}/spriteFrame`, SpriteFrame, (error, frame) => {
            if (!this.isValid || this.iconKey !== key) return;
            if (error || !(frame instanceof SpriteFrame)) { console.warn('建筑图标载入失败:', path, error); return; }
            apply(frame);
        });
    }

    protected onLoad(): void {
        this.node.on(Node.EventType.TOUCH_END, this.onTouchItem, this);
    }

    protected onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_END, this.onTouchItem, this);
        EventMgr.targetOff(this);
    }

    protected updateItem(): void {
        this.labelRate.string = this.data.level + "/" + this.cfg.upLevels.length;
        this.labelName.string = this.cfg.name;
        this.lockNode.active = !this.isUnlock;
    }

    protected onTouchItem() {
        if (!this.data) return;
        AudioManager.instance.playClick();
        EventMgr.emit(LogicEvent.selectFacilityItem, this.cityId, this.data.type);
    }

    public setData(cityId: number, data: Facility, cfg:FacilityConfig, isUnlock:boolean): void {
        // console.log("setData:", data);

        this.cityId = cityId;
        this.data = data;
        this.cfg = cfg;
        this.isUnlock = isUnlock;
        
        if(this.data.isUping()){
            this.startUpTime();
        }else{
            this.stopCountDown();
        }
 
        this.updateItem();
    }

    protected countDown(){
        if (this.data.isUping()){
            this.labelTime.string = DateUtil.converSecondStr(this.data.upLastTime());
        }else{
            this.stopCountDown();
        }
    }

    protected stopCountDown(){
        this.unscheduleAllCallbacks();
        this.labelTime.string = "";
    }

    protected startUpTime(){
        this.stopCountDown();
        this.schedule(this.countDown, 1.0);
        this.countDown();
    }
}
