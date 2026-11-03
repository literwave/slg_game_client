import { _decorator, Camera, Component, Sprite, Node, Vec2, Vec3, UITransform, view, Button } from 'cc';
const { ccclass, property } = _decorator;
import WorldMapArt from '../WorldMapArt';
import MapUtil from '../MapUtil';
import { cityArtAnchorY, cityFootprintRadius } from '../CityFootprint';
import { drawSystemCityNameplate, systemCityIdentity } from '../CityMapPresentation';

import DateUtil from "../../utils/DateUtil";
import MapCommand from "../MapCommand";
import { MapResType } from "../MapProxy";
import { EventMgr } from '../../utils/EventMgr';
import { LogicEvent } from '../../common/LogicEvent';

@ccclass('SysCityLogic')
export default class SysCityLogic extends Component {

    @property(Sprite)
    upSpr: Sprite = null;

    @property(Sprite)
    downSpr: Sprite = null;

    @property(Node)
    mianNode: Node = null;

    protected _limitTime: number = 0;
    protected _data: any = null;
    private nameplate: Node | null = null;
    private nameCamera: Camera | null = null;
    private nameAnchorY = 0;
    private nameKey = '';
    private readonly nameWorldPoint = new Vec3();
    private readonly nameUiPoint = new Vec3();


    protected onLoad(): void {
        this._limitTime = MapCommand.getInstance().proxy.getWarFree();
    }

    protected onEnable(): void {
        EventMgr.on(LogicEvent.unionChange, this.onUnionChange, this);
    }

    protected onDisable(): void {
        this._data = null;
        if (this.nameplate?.isValid) this.nameplate.active = false;
        this.unscheduleAllCallbacks();
        EventMgr.targetOff(this);
    }

    protected onDestroy(): void {
        if (this.nameplate?.isValid) this.nameplate.destroy();
        this.nameplate = null;
    }

    public setCityData(data: any): void {
        // console.log("setCityData:", data);
        this._data = data;
        this.updateUI();
    }

    protected onUnionChange(rid: number, unionId: number, parentId: number): void {
        if (!this._data) return;
        if (this._data.rid == rid ){
            this._data.unionId = unionId;
            this._data.parentId = parentId;
        }
        this.updateUI();
    }


    public updateUI(): void {
        if (!this._data) return;
        if(this._data.type != MapResType.SYS_CITY){
            this.node.active = false;
            return
        }else{
            this.node.active = true;
        }

        this.node.setScale(1, 1, 1);
        const width = WorldMapArt.cityWidth(this._data.level);
        const span = cityFootprintRadius(this._data.level) * 2 + 1;
        const footprintWidth = MapUtil.tileSize.width * span, footprintHeight = MapUtil.tileSize.height * span;
        this.node.getComponent(UITransform).setContentSize(footprintWidth, footprintHeight);

        const icon = this.node.getChildByName('cityicon')?.getComponent(Sprite);
        if (icon) {
            // 轮廓按原图画布计算，关闭自动裁边以免显示与点击位置发生偏移。
            icon.trim = false;
            const anchorY = cityArtAnchorY(this._data.level);
            icon.node.getComponent(UITransform).setAnchorPoint(.5, anchorY);
            icon.node.setPosition(0, 0, 0);
            WorldMapArt.apply(icon, WorldMapArt.citySprite(this._data.level, this._data), width);
            this.nameAnchorY = icon.node.getComponent(UITransform).height * (1 - anchorY);
        }
        WorldMapArt.ownership(this.node, this.upSpr, this.downSpr,
            WorldMapArt.factionColor(this._data, MapCommand.getInstance().buildProxy), footprintWidth, footprintHeight);
        this.mianNode?.setPosition(width * .38, 30, 0);
        const title = this.node.getChildByName('CampaignCityName'); if (title) title.active = false;
        this.refreshNameplate();
        this.lateUpdate();

        var diff = DateUtil.getServerTime() - this._data.occupyTime;
        if (this._data.parentId > 0 && diff<this._limitTime){
            this.mianNode.active = true;
            this.stopCountDown();
            this.schedule(this.countDown, 1.0);
        }else{
            this.mianNode.active = false;
        }
    }

    private refreshNameplate(): void {
        if (!this._data) return;
        if (!this.nameplate?.isValid) {
            const uiRoot = this.node.scene?.getChildByPath('Canvas/MapUIScene');
            if (!uiRoot) return;
            let layer = uiRoot.getChildByName('CityNameplates');
            if (!layer) {
                layer = new Node('CityNameplates'); layer.layer = uiRoot.layer;
                layer.addComponent(UITransform); uiRoot.addChild(layer); layer.setSiblingIndex(0);
            }
            const plate = new Node('SystemCityNameplate'); plate.layer = layer.layer;
            plate.addComponent(UITransform); layer.addChild(plate);
            const button = plate.addComponent(Button); button.target = plate;
            button.transition = Button.Transition.SCALE; button.zoomScale = .97; button.duration = .08;
            plate.on(Button.EventType.CLICK, this.onClickNameplate, this);
            this.nameplate = plate; this.nameKey = '';
        }
        const identity = systemCityIdentity(this._data), key = JSON.stringify(identity);
        if (key !== this.nameKey) {
            this.nameKey = key;
            drawSystemCityNameplate(this.nameplate, identity);
        }
    }

    private onClickNameplate(): void {
        if (!this._data) return;
        const cell = new Vec2(this._data.x, this._data.y), point = MapUtil.mapCellToPixelPoint(cell);
        EventMgr.emit(LogicEvent.touchMap, cell, point, point);
    }

    protected lateUpdate(): void {
        if (!this._data) return;
        if (!this.nameplate?.isValid) this.refreshNameplate();
        if (!this.nameplate?.isValid) return;
        if (!this.nameCamera?.isValid) this.nameCamera = this.node.scene?.getChildByPath('Canvas/Map Camera')?.getComponent(Camera);
        if (!this.nameCamera || MapCommand.getInstance().proxy.strategic) { this.nameplate.active = false; return; }
        this.node.getComponent(UITransform).convertToWorldSpaceAR(this.nameWorldPoint.set(0, this.nameAnchorY, 0), this.nameWorldPoint);
        this.nameCamera.camera?.update();
        this.nameCamera.convertToUINode(this.nameWorldPoint, this.nameplate.parent, this.nameUiPoint);
        const size = view.getVisibleSize(), x = this.nameUiPoint.x, y = this.nameUiPoint.y + 50;
        const half = this.nameplate.getComponent(UITransform).width / 2;
        const visible = x + half > -size.width / 2 && x - half < size.width / 2
            && y + 23 > -size.height / 2 && y - 46 < size.height / 2;
        this.nameplate.active = visible;
        if (visible) this.nameplate.setPosition(x, y, 0);
    }

    public countDown() {
        var diff = DateUtil.getServerTime() - this._data.occupyTime;
        if (diff>this._limitTime){
            this.stopCountDown();
            this.mianNode.active = false;
        }
    }

    public stopCountDown() {
        this.unscheduleAllCallbacks();
    }
}
