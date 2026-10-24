import { _decorator, Camera, Color, Component, Graphics, Label, Prefab, Node, Vec2, instantiate, Vec3, UITransform, view } from 'cc';
const { ccclass, property } = _decorator;

import { MapBuildData } from "./MapBuildProxy";
import { MapCityData } from "./MapCityProxy";
import MapClickUILogic from "./MapClickUILogic";
import MapCommand from "./MapCommand";
import { MapResData } from "./MapProxy";
import MapUtil from "./MapUtil";
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';
import WorldLandscape from './WorldLandscape';
import WorldMapArt from './WorldMapArt';
import WorldCampaign from './WorldCampaign';
import { gateHit, gateMirrored } from './GateGeometry';
import { caption } from './ui/ManagementStyle';

@ccclass('MapTouchLogic')
export default class MapTouchLogic extends Component {
    @property(Prefab)
    clickUIPrefab: Prefab = null;

    @property(Node)
    touch:Node = null;

    protected _cmd: MapCommand;
    protected _clickUINode: Node = null;
    private _blockedFeedback: Node = null;

    protected onLoad(): void {
        this._cmd = MapCommand.getInstance();
        EventMgr.on(LogicEvent.touchMap, this.onTouchMap, this);
        EventMgr.on(LogicEvent.moveMap, this.onMoveMap, this);
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this._cmd = null;
        this._clickUINode = null;
    }

    protected onTouchMap(mapPoint: Vec2, clickPixelPoint: Vec2, pointerPixelPoint?: Vec2): void {
        console.log("点击区域 (" + mapPoint.x + "," + mapPoint.y + ")");
        this.removeClickUINode();
        this.clearBlocked();
        // 关城美术横跨山口，先按实体轮廓命中，再处理后方山体；透明角落仍然属于山脉。
        const campaign = WorldCampaign.config;
        if (pointerPixelPoint && campaign) {
            for (const gate of campaign.gates) {
                const center = MapUtil.mapCellToPixelPoint(new Vec2(gate.x, gate.y));
                if (!gateHit(pointerPixelPoint.x - center.x, pointerPixelPoint.y - center.y, gate.level,
                    gateMirrored(gate.x, gate.y, campaign.width, campaign.height))) continue;
                const id = MapUtil.getIdByCellPoint(gate.x, gate.y);
                const target = this._cmd.buildProxy.getBuild(id) || this._cmd.proxy.getResData(id);
                if (target) { this.showClickUINode(target, center); return; }
            }
        }
        const playerCity = MapUtil.isVaildCellPoint(mapPoint)
            ? this._cmd.cityProxy.getCity(MapUtil.getIdByCellPoint(mapPoint.x, mapPoint.y)) : null;
        if (playerCity) {
            this.showClickUINode(playerCity, MapUtil.mapCellToPixelPoint(new Vec2(playerCity.x, playerCity.y)));
            return;
        }
        const mountain = pointerPixelPoint && this.node.getComponentInChildren(WorldLandscape)?.blockerAt(pointerPixelPoint);
        if (mountain && MapUtil.isVaildCellPoint(mountain)) { this.showBlocked(mountain, false); return; }
        if (MapUtil.isVaildCellPoint(mapPoint) == false) {
            console.log("点击到无效区域");
            return;
        }

        let cellId: number = MapUtil.getIdByCellPoint(mapPoint.x, mapPoint.y);
        let buildData: MapBuildData = this._cmd.buildProxy.getBuild(cellId);
        if (buildData != null) {
            if(buildData.isSysCity() == false){
                //代表点击被占领的区域
                console.log("点击被占领的区域", buildData);
                this.showClickUINode(buildData, clickPixelPoint);
                return;
            }

        }

        let resData: MapResData = this._cmd.proxy.getResData(cellId);
        if (!resData) return;
        if (resData.type > 0) {
            var temp = this._cmd.proxy.getSysCityResData(resData.x, resData.y);
            if (temp){
                clickPixelPoint = MapUtil.mapCellToPixelPoint(new Vec2(temp.x, temp.y));
                let cellId: number = MapUtil.getIdByCellPoint(temp.x, temp.y);
                let buildData: MapBuildData = this._cmd.buildProxy.getBuild(cellId);
                if(buildData){
                    this.showClickUINode(buildData, clickPixelPoint);
                }else{
                    this.showClickUINode(temp, clickPixelPoint);
                }
                console.log("点击野外城池", temp);
            }else{
                this.showClickUINode(resData, clickPixelPoint);
                console.log("点击野外区域", resData);
            }
           
        } else {
            if (resData.isEmpty) { this.showClickUINode(resData, clickPixelPoint); return; }
            const city = this._cmd.proxy.getSysCityResData(mapPoint.x, mapPoint.y);
            if (city) { this.showClickUINode(city, MapUtil.mapCellToPixelPoint(new Vec2(city.x, city.y))); return; }
            this.showBlocked(mapPoint, (WorldMapArt.landscape?.riverCells || []).indexOf(cellId) >= 0);
        }
    }

    private showBlocked(point: Vec2, river: boolean): void {
        this.clearBlocked();
        const node = new Node('BlockedTerrainFeedback'); node.layer = this.touch.layer;
        this.touch.addChild(node); this._blockedFeedback = node;
        const pixel = MapUtil.mapCellToPixelPoint(point); node.setPosition(pixel.x, pixel.y, 0);
        const g = node.addComponent(Graphics), width = MapUtil.tileSize.width, height = MapUtil.tileSize.height;
        g.lineWidth = 3; g.strokeColor = new Color(230, 113, 81, 255);
        g.fillColor = new Color(154, 65, 43, 65);
        g.moveTo(-width / 2, 0); g.lineTo(0, height / 2); g.lineTo(width / 2, 0); g.lineTo(0, -height / 2); g.close(); g.fill(); g.stroke();
        let camera: Camera = null;
        for (let parent = this.node.parent; parent && !camera; parent = parent.parent) camera = parent.getChildByName('Map Camera')?.getComponent(Camera);
        const scale = camera ? camera.orthoHeight * 2 / Math.max(1, view.getVisibleSize().height) : 1;
        const label = caption(node, 'BlockedReason', river ? '河流阻挡 · 请从渡口通过' : '山脉阻挡 · 请从关隘通过', 0, height / 2 + 24 * scale, 240, 15, new Color(255, 211, 167, 255), Label.HorizontalAlign.CENTER);
        label.node.setScale(scale, scale, 1); label.enableOutline = true; label.outlineWidth = 2; label.outlineColor = new Color(36, 30, 23, 255);
        this.unschedule(this.clearBlocked); this.scheduleOnce(this.clearBlocked, 1.8);
    }

    private clearBlocked(): void {
        if (this._blockedFeedback) { this._blockedFeedback.removeFromParent(); this._blockedFeedback.destroy(); this._blockedFeedback = null; }
    }

    protected onMoveMap(): void {
        this.removeClickUINode();
        this.clearBlocked();
    }

    public showClickUINode(data: any, pos: Vec2): void {
        if (this._clickUINode == null) {
            this._clickUINode = instantiate(this.clickUIPrefab);

        }
        this._clickUINode.parent = this.touch;
        this._clickUINode.setPosition(new Vec3(pos.x, pos.y, 0));
        this._clickUINode.getComponent(MapClickUILogic).setCellData(data, pos);
    }

    public removeClickUINode(): void {
        if (this._clickUINode) {
            this._clickUINode.parent = null;
        }
    }
}
