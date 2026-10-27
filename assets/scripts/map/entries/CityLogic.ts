import { _decorator, Camera, Color, Component, Graphics, Label, Sprite, Node, UITransform, Vec3, view } from 'cc';
const { ccclass, property } = _decorator;
import WorldMapArt from '../WorldMapArt';
import { isOwnPlayerCity, playerCityAppearance, playerCityFootprint, PLAYER_CITY_ANCHOR_Y } from '../PlayerCityAppearance';
import PlayerCityGround from '../PlayerCityGround';
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
    private nameplate: Node | null = null;
    private nameCamera: Camera | null = null;
    private nameAnchorY = 0;
    private showNameplate = false;
    private readonly nameWorldPoint = new Vec3();
    private readonly nameUiPoint = new Vec3();
    protected onLoad(): void {
        this._limitTime = MapCommand.getInstance().proxy.getWarFree();
    }
    protected onDestroy(): void {
        if (this.nameplate?.isValid) this.nameplate.destroy();
        this.nameplate = null;
    }
    protected onEnable(): void {
        EventMgr.on(LogicEvent.unionChange, this.onUnionChange, this);
        EventMgr.on(LogicEvent.selectPlayerCity, this.onSelectCity, this);
    }
    protected onDisable(): void {
        this._data = null;
        this.selected = false;
        this.showNameplate = false;
        if (this.nameplate?.isValid) this.nameplate.active = false;
        const selection = this.node.getChildByName('CitySelection');
        if (selection) selection.active = false;
        for (const name of ['OwnCityBoundary']) {
            const marker = this.node.getChildByName(name);
            if (marker) marker.active = false;
        }
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
        const appearance = PlayerCityGround.layout(playerCityAppearance(this._data.level,
            MapUtil.tileSize.width, MapUtil.tileSize.height), footprint.height);
        const ownCity = isOwnPlayerCity(this._data, MapCommand.getInstance().cityProxy.myId);
        const rootUi = this.node.getComponent(UITransform);
        rootUi.setAnchorPoint(.5, .5);
        rootUi.setContentSize(footprint.width, footprint.height);
        const icon = this.node.getChildByName('sprite')?.getComponent(Sprite);
        if (icon) {
            icon.trim = false;
            icon.node.setScale(1, 1, 1); icon.node.setPosition(appearance.x, appearance.y, 0);
            icon.node.getComponent(UITransform).setAnchorPoint(.5, PLAYER_CITY_ANCHOR_Y);
            WorldMapArt.apply(icon, appearance.art, appearance.width);
            icon.node.getComponent(UITransform).setContentSize(appearance.width, appearance.height);
            PlayerCityGround.apply(icon, appearance.art, appearance.width, appearance.height, footprint.height, appearance.sourceHeight);
        }
        WorldMapArt.ownership(this.node, this.upSpr, this.downSpr,
            WorldMapArt.factionColor(this._data, MapCommand.getInstance().cityProxy), footprint.width, footprint.height);
        this.drawSelection();
        this.drawNameplate(appearance.top, !ownCity);
        this.lateUpdate();
        this.drawOwnCity(ownCity, footprint.width, footprint.height);
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
    private drawNameplate(top: number, visible: boolean): void {
        this.nameAnchorY = top;
        this.showNameplate = visible;
        this.labelName.node.active = false;
        const oldPlate = this.node.getChildByName('CityNameplate');
        if (oldPlate) oldPlate.active = false;
        if (!visible) {
            if (this.nameplate?.isValid) this.nameplate.active = false;
            return;
        }
        if (!this.nameplate?.isValid) {
            const uiRoot = this.node.scene?.getChildByPath('Canvas/MapUIScene');
            if (!uiRoot) return;
            let layer = uiRoot.getChildByName('CityNameplates');
            if (!layer) {
                layer = new Node('CityNameplates'); layer.layer = uiRoot.layer;
                layer.addComponent(UITransform); uiRoot.addChild(layer);
                // 名牌在 HUD 和弹窗下面，不占用按钮或地图点击事件。
                layer.setSiblingIndex(0);
            }
            const plate = new Node('CityNameplateUI'); plate.layer = layer.layer;
            plate.addComponent(UITransform); plate.addComponent(Graphics); layer.addChild(plate);
            const text = new Node('PlayerName'); text.layer = layer.layer;
            text.addComponent(UITransform); text.addComponent(Label); plate.addChild(text);
            this.nameplate = plate;
        }
        const plate = this.nameplate;
        const textWidth = Math.min(192, Math.max(40,
            Array.from(this.labelName.string).reduce((sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? 9 : 16), 0)));
        const width = textWidth + 24;
        plate.getComponent(UITransform).setContentSize(width, 28);
        const text = plate.getChildByName('PlayerName');
        text.getComponent(UITransform).setContentSize(textWidth, 26);
        const label = text.getComponent(Label);
        label.string = this.labelName.string;
        label.fontFamily = 'Microsoft YaHei';
        label.fontSize = 16; label.lineHeight = 22;
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = new Color(245, 235, 211, 255);
        label.outlineColor = new Color(24, 29, 25, 230); label.outlineWidth = 1;

        const g = plate.getComponent(Graphics); g.clear();
        g.fillColor = new Color(15, 20, 17, 55);
        g.roundRect(-width / 2 - 2, -17, width + 4, 30, 4); g.fill();
        g.fillColor = new Color(28, 34, 29, 225);
        g.strokeColor = new Color(190, 166, 116, 155); g.lineWidth = 1;
        g.roundRect(-width / 2, -14, width, 28, 3); g.fill(); g.stroke();
        g.strokeColor = new Color(221, 197, 145, 180);
        g.moveTo(0, -14); g.lineTo(0, -20); g.stroke();
        g.moveTo(0, -20); g.lineTo(2, -22); g.lineTo(0, -24); g.lineTo(-2, -22); g.close();
        g.fillColor = new Color(221, 197, 145, 220); g.fill();
    }

    protected lateUpdate(): void {
        if (!this.showNameplate || !this._data) return;
        if (!this.nameplate?.isValid) this.drawNameplate(this.nameAnchorY, true);
        if (!this.nameplate?.isValid) return;
        if (!this.nameCamera?.isValid) {
            this.nameCamera = this.node.scene?.getChildByPath('Canvas/Map Camera')?.getComponent(Camera);
        }
        if (!this.nameCamera) { this.nameplate.active = false; return; }
        // 摄像机先完成当帧移动，再把城楼顶端投影到 UI，字号不随地图缩放。
        this.node.getComponent(UITransform).convertToWorldSpaceAR(
            this.nameWorldPoint.set(0, this.nameAnchorY, 0), this.nameWorldPoint);
        this.nameCamera.camera?.update();
        this.nameCamera.convertToUINode(this.nameWorldPoint, this.nameplate.parent, this.nameUiPoint);
        const size = view.getVisibleSize(), x = this.nameUiPoint.x, y = this.nameUiPoint.y + 24;
        const halfWidth = this.nameplate.getComponent(UITransform).width / 2;
        const visible = !this.selected && x + halfWidth > -size.width / 2
            && x - halfWidth < size.width / 2 && y + 14 > -size.height / 2 && y - 24 < size.height / 2;
        this.nameplate.active = visible;
        if (visible) this.nameplate.setPosition(x, y, 0);
    }
    /** 自己的主城用贴地边界识别；不改变城图、占地或其他玩家名称。 */
    private drawOwnCity(visible: boolean, width: number, height: number): void {
        const graphicsNode = (name: string) => {
            let node = this.node.getChildByName(name);
            if (!node && visible) {
                node = new Node(name); node.layer = this.node.layer;
                this.node.addChild(node); node.addComponent(UITransform); node.addComponent(Graphics);
            }
            if (node) node.active = visible;
            return node;
        };
        const border = graphicsNode('OwnCityBoundary');
        if (!visible) return;
        border.setSiblingIndex(this.node.children.length - 1);
        border.getComponent(UITransform).setContentSize(width, height);
        const g = border.getComponent(Graphics); g.clear();
        const frontEdge = (inset: number) => {
            g.moveTo(-width / 2 + inset, 0); g.lineTo(0, -height / 2 + inset / 2);
            g.lineTo(width / 2 - inset, 0);
        };
        g.strokeColor = new Color(86, 216, 186, 62); g.lineWidth = 7; frontEdge(4); g.stroke();
        g.strokeColor = new Color(131, 231, 198, 235); g.lineWidth = 2; frontEdge(4); g.stroke();
        // 前角金色短线，贴合边界且不扩大占地。
        g.strokeColor = new Color(245, 213, 139, 255); g.lineWidth = 3;
        g.moveTo(-26, -height / 2 + 15); g.lineTo(0, -height / 2 + 2);
        g.lineTo(26, -height / 2 + 15); g.stroke();
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

