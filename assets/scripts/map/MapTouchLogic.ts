import MapArmyLogic from './MapArmyLogic';
import MapLogic from './MapLogic';
import { _decorator, Component, Prefab, Node, Vec2, instantiate } from 'cc';
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
import WorldCampaign from './WorldCampaign';
import { gateHit, gateMirrored } from './GateGeometry';
import { systemCityHit } from './SystemCityGeometry';

@ccclass('MapTouchLogic')
export default class MapTouchLogic extends Component {
    @property(Prefab)
    clickUIPrefab: Prefab = null;

    @property(Node)
    touch:Node = null;

    protected _cmd: MapCommand;
    protected _clickUINode: Node = null;

    protected onLoad(): void {
        this._cmd = MapCommand.getInstance();
        EventMgr.on(LogicEvent.touchMap, this.onTouchMap, this);
    }

    protected onDestroy(): void {
        EventMgr.targetOff(this);
        this._cmd = null;
        if (this._clickUINode?.isValid) this._clickUINode.destroy();
        this._clickUINode = null;
    }

    protected onTouchMap(mapPoint: Vec2, clickPixelPoint: Vec2, pointerPixelPoint?: Vec2, informationOnly = false): void {
        const armies = this.node.getComponent(MapArmyLogic);
        const troopIdx = !informationOnly && pointerPixelPoint && armies?.pickTroop(pointerPixelPoint);
        if (troopIdx) {
            this.removeClickUINode();
            this.node.getComponent(MapLogic)?.followMapTarget(() => armies.troopMapPosition(troopIdx));
            return;
        }

        // 关城美术横跨山口，先按实体轮廓命中，再处理后方山体；透明角落仍然属于山脉。
        const campaign = WorldCampaign.config;
        const occupiedPass = campaign?.gates.find(g => {
            if (g.crossing !== 'pass') return false;
            const ru = g.footprintRadius ?? 2, rv = g.footprintWidthRadius ?? 3;
            const rx = g.axis === 'x' ? ru : rv, ry = g.axis === 'x' ? rv : ru;
            return Math.abs(g.x - mapPoint.x) <= rx && Math.abs(g.y - mapPoint.y) <= ry;
        });
        if (occupiedPass) {
            const id = MapUtil.getIdByCellPoint(occupiedPass.x, occupiedPass.y);
            const target = this._cmd.buildProxy.getBuild(id) || this._cmd.proxy.getResData(id);
            if (target) { this.showClickUINode(target, MapUtil.mapCellToPixelPoint(new Vec2(occupiedPass.x, occupiedPass.y))); return; }
        }
        if (pointerPixelPoint && campaign) {
            for (const gate of campaign.gates) {
                const center = MapUtil.mapCellToPixelPoint(new Vec2(gate.x, gate.y));
                if (!gateHit(pointerPixelPoint.x - center.x, pointerPixelPoint.y - center.y, gate.level,
                    gateMirrored(gate.x, gate.y, campaign.width, campaign.height, gate), gate,
                    MapUtil.tileSize.width, MapUtil.tileSize.height)) continue;
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
        // 城池完整画面已限制在占地内，按与渲染共用的透明轮廓拾取实体。
        if (pointerPixelPoint && campaign) {
            for (const city of campaign.cities) {
                const center = MapUtil.mapCellToPixelPoint(new Vec2(city.x, city.y));
                if (!systemCityHit(pointerPixelPoint.x - center.x, pointerPixelPoint.y - center.y, city.level,
                    MapUtil.tileSize.width, city, MapUtil.tileSize.height)) continue;
                const id = MapUtil.getIdByCellPoint(city.x, city.y);
                const target = this._cmd.buildProxy.getBuild(id) || this._cmd.proxy.getResData(id);
                if (target) { this.showClickUINode(target, center); return; }
            }
        }
        // 已在城池实际占地内的空白格也属于城池，不能被 isEmpty 分支抢先选为空地。
        const systemCity = MapUtil.isVaildCellPoint(mapPoint) ? this._cmd.proxy.getSysCityResData(mapPoint.x, mapPoint.y) : null;
        if (systemCity) {
            const id = MapUtil.getIdByCellPoint(systemCity.x, systemCity.y);
            this.showClickUINode(this._cmd.buildProxy.getBuild(id) || systemCity,
                MapUtil.mapCellToPixelPoint(new Vec2(systemCity.x, systemCity.y)));
            return;
        }
        // 城图覆盖按整格判断；即使鼠标落在该格露出的透明角落，也不能选到底下的空地。
        if (this._cmd.isCityArtCoveredCell(mapPoint.x, mapPoint.y)) return;
        const landscape = this.node.getComponentInChildren(WorldLandscape);
        const mountain = (pointerPixelPoint && landscape?.blockerAt(pointerPixelPoint))
            || landscape?.blockerAt(clickPixelPoint);
        // 同时检查落脚中心，不能从地块露出的一角选中藏在山后的资源，留下空选框。
        // 山体是不可选背景，误点时保持当前目标和操作，不创建任何提示或选框。
        if (mountain && MapUtil.isVaildCellPoint(mountain)) return;
        if (MapUtil.isVaildCellPoint(mapPoint) == false) {
            this.removeClickUINode();
            return;
        }

        let cellId: number = MapUtil.getIdByCellPoint(mapPoint.x, mapPoint.y);
        let buildData: MapBuildData = this._cmd.buildProxy.getBuild(cellId);
        if (buildData != null) {
            if(buildData.isSysCity() == false){
                //代表点击被占领的区域
                this.showClickUINode(buildData, clickPixelPoint);
                return;
            }

        }

        let resData: MapResData = this._cmd.proxy.getResData(cellId);
        if (!resData) { this.removeClickUINode(); return; }
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
            }else{
                this.showClickUINode(resData, clickPixelPoint);
            }
           
        } else {
            if (resData.isEmpty) {
                // 逻辑占地与城图覆盖格已在上方拦截，只允许选择完整露出的空地。
                this.showClickUINode(resData, clickPixelPoint); return;
            }
            const city = this._cmd.proxy.getSysCityResData(mapPoint.x, mapPoint.y);
            if (city) { this.showClickUINode(city, MapUtil.mapCellToPixelPoint(new Vec2(city.x, city.y))); return; }
            // 河流与不可通行地形同样静默忽略，不清空原有侧栏或选队状态。
            return;
        }
    }

    public showClickUINode(data: any, pos: Vec2): void {
        if (this._clickUINode == null) {
            this._clickUINode = instantiate(this.clickUIPrefab);

        }
        if (this._clickUINode.parent !== this.touch) this._clickUINode.parent = this.touch;
        this._clickUINode.setPosition(pos.x, pos.y, 0);
        this._clickUINode.getComponent(MapClickUILogic).setCellData(data, pos, true);
    }

    public removeClickUINode(): void {
        if (this._clickUINode) {
            this._clickUINode.parent = null;
        }
    }
}
