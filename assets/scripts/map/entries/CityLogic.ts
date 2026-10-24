import { _decorator, Color, Component, Graphics, Label, Sprite, Node, UITransform } from 'cc';
const { ccclass, property } = _decorator;
import WorldMapArt from '../WorldMapArt';
import { playerCityAppearance, playerCityFootprint, PLAYER_CITY_ANCHOR_Y } from '../PlayerCityAppearance';
import MapUtil from '../MapUtil';

import DateUtil from "../../utils/DateUtil";
import { MapCityData } from "../MapCityProxy";
import MapCommand from "../MapCommand";
import { EventMgr } from '../../utils/EventMgr';
import { LogicEvent } from '../../common/LogicEvent';

@ccclass('CityLogic')
export default class CityLogic extends Component {
    @property(Label)
    labelName: Label | null = null;
    @property(Sprite)
    upSpr: Sprite | null = null;
    @property(Sprite)
    downSpr: Sprite | null = null;
    @property(Node)
    mianNode: Node | null = null;
    protected _data: MapCityData = null;
    protected _limitTime: number = 0;
    private selected = false;
    protected onLoad(): void {
        this._limitTime = MapCommand.getInstance().proxy.getWarFree();
    }
    protected onDestroy(): void {

    }
    protected onEnable(): void {
        EventMgr.on(LogicEvent.unionChange, this.onUnionChange, this);
        EventMgr.on(LogicEvent.selectPlayerCity, this.onSelectCity, this);
    }
    protected onDisable(): void {
        this._data = null;
        this.selected = false;
        const selection = this.node.getChildByName('CitySelection');
        if (selection) selection.active = false;
        this.unscheduleAllCallbacks();
        EventMgr.targetOff(this);
    }
    protected onUnionChange(rid: number, unionId: number, parentId: number): void {
        if (!this._data) return;
        if (this._data.rid == rid ){
        this._data.unionId = unionId;
        this._data.parentId = parentId;
        }
        this.updateUI();
    }
    public setCityData(data: MapCityData): void {
        this._data = data;
        this.updateUI();
    }
    public updateUI(): void {
        if (this._data) {
        this.labelName.string = this._data.name;
        const footprint = playerCityFootprint(MapUtil.tileSize.width, MapUtil.tileSize.height);
        // 城名放在地基前沿外，不压在屋顶和城墙上。
        this.labelName.node.setPosition(0, -footprint.height / 2 - 18, 0);
        this.labelName.node.getComponent(UITransform).setContentSize(footprint.width - 32, 32);
        this.labelName.font = null; this.labelName.useSystemFont = true;
        this.labelName.fontSize = 20; this.labelName.lineHeight = 26;
        this.labelName.overflow = Label.Overflow.CLAMP;
        this.labelName.enableWrapText = false;
        this.labelName.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.labelName.color = new Color(245, 231, 194, 255);
        this.labelName.outlineColor = new Color(35, 39, 27, 230); this.labelName.outlineWidth = 2;

        const icon = this.node.getChildByName('sprite')?.getComponent(Sprite);
        const appearance = playerCityAppearance(this._data.level);
        if (icon) {
            icon.trim = false;
            icon.node.setScale(1, 1, 1); icon.node.setPosition(0, 0, 0);
            icon.node.getComponent(UITransform).setAnchorPoint(.5, PLAYER_CITY_ANCHOR_Y);
            WorldMapArt.apply(icon, appearance.art, appearance.width);
        }
        WorldMapArt.ownership(this.node, this.upSpr, this.downSpr,
            WorldMapArt.factionColor(this._data, MapCommand.getInstance().cityProxy), footprint.width);
        this.drawSelection();
        this.mianNode?.setPosition(120, 30, 0);

        var diff = DateUtil.getServerTime() - this._data.occupyTime;
        if (this._data.parentId > 0 && diff<this._limitTime){
        this.mianNode.active = true;
        this.stopCountDown();
        this.schedule(this.countDown, 1.0);
        }else{
        this.mianNode.active = false;
        }
        }
    }
    private onSelectCity(cellId: number | null): void {
        this.selected = !!this._data && cellId === this._data.id;
        this.drawSelection();
    }
    private drawSelection(): void {
        let node = this.node.getChildByName('CitySelection');
        if (!node && !this.selected) return;
        if (!node) {
            node = new Node('CitySelection'); node.layer = this.node.layer;
            this.node.addChild(node); node.addComponent(UITransform); node.addComponent(Graphics);
        }
        // 在城池自己的地表层绘制，建筑自然遮挡后侧边线。
        node.setSiblingIndex(0); node.active = this.selected;
        if (!this.selected) return;
        const { width, height } = playerCityFootprint(MapUtil.tileSize.width, MapUtil.tileSize.height);
        node.getComponent(UITransform).setContentSize(width, height);
        const g = node.getComponent(Graphics); g.clear();
        g.strokeColor = new Color(244, 212, 136, 255); g.lineWidth = 3;
        g.fillColor = new Color(225, 193, 112, 28);
        g.moveTo(0, height / 2); g.lineTo(width / 2, 0); g.lineTo(0, -height / 2);
        g.lineTo(-width / 2, 0); g.close(); g.fill(); g.stroke();
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

