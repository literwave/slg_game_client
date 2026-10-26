import { _decorator, Camera, Component, Node, Vec2, TiledMap } from 'cc';
const { ccclass, property } = _decorator;

import MapResBuildLogic from "../map/MapResBuildLogic";
import MapBuildTipsLogic from "../map/MapBuildTipsLogic";
import MapCityLogic from "../map/MapCityLogic";
import { MapCityData } from "../map/MapCityProxy";
import MapCommand from "../map/MapCommand";
import MapLogic from "../map/MapLogic";
import { MapAreaData, MapResType } from "../map/MapProxy";
import MapResLogic from "../map/MapResLogic";
import MapUtil from "../map/MapUtil";
import MapFacilityBuildLogic from "../map/MapFacilityBuildLogic";
import MapBuildTagLogic from "../map/MapBuildTagLogic";
import MapSysCityLogic from "../map/MapSysCityLogic";
import MapBaseLayerLogic from "../map/MapBaseLayerLogic";
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';
import { CoreEvent } from '../core/CoreEvent';
import WorldMapArt from '../map/WorldMapArt';
import WorldLandscape from '../map/WorldLandscape';

interface PendingMapArea {
    id: number;
    x: number;
    y: number;
    startY: number;
    endX: number;
    endY: number;
}

@ccclass('MapScene')
export default class MapScene extends Component {
    @property(Node)
    mapLayer: Node = null;

    protected _cmd: MapCommand = null;
    private _pendingAreas: PendingMapArea[] = [];
    private _initialCellTotal = 0;
    private _initialCellDone = 0;
    private _positionReady = false;
    private _warmupStarted = false;
    private _ready = false;
    private _failed = false;
    private _tiledMap: TiledMap = null;
    private _recycleLayers: MapBaseLayerLogic[] = [];
    private _recycleLayerIndex = 0;
    private _itemLayers: {
        res: MapResLogic; build: MapResBuildLogic; facility: MapFacilityBuildLogic;
        tag: MapBuildTagLogic; tips: MapBuildTipsLogic; city: MapCityLogic; sysCity: MapSysCityLogic;
    } = null;

    protected onLoad(): void {
        this._cmd = MapCommand.getInstance();
        WorldMapArt.prepare().then(() => {
            if (this.isValid && this.node.isValid) this.initializeMap();
        }).catch(error => { if (this.isValid) this.failInitialization(error); });
    }

    private initializeMap(): void {
        if (!this.mapLayer) throw new Error('地图节点缺失');
        const tiledMap = this.mapLayer.addComponent(TiledMap);
        this._tiledMap = tiledMap;
        tiledMap.tmxAsset = this._cmd.proxy.tiledMapAsset;

        MapUtil.initMapConfig(tiledMap);
        const camera = this.node.parent.getChildByName('Map Camera')?.getComponent(Camera);
        if (!camera) throw new Error('地图相机缺失');
        this.mapLayer.addComponent(WorldLandscape).initialize(tiledMap, camera);
        this._cmd.initData();
        EventMgr.on(LogicEvent.mapShowAreaChange, this.onMapShowAreaChange, this);
        EventMgr.on(LogicEvent.scrollToMap, this.onScrollToMap, this);
        EventMgr.on(LogicEvent.updatePlayerCityTiles, this.onPlayerCityTiles, this);

        this.scheduleOnce(() => {
            try {
                const myCity: MapCityData = this._cmd.cityProxy.getMyMainCity();
                const mapLogic = this.node.getComponent(MapLogic);
                if (!mapLogic) throw new Error('地图控制器缺失');
                mapLogic.setTiledMap(tiledMap);
                mapLogic.scrollToMapPoint(myCity ? new Vec2(myCity.x, myCity.y) : new Vec2(16, 24));
                this._positionReady = true;
            } catch (error) {
                this.failInitialization(error);
            }
        }, 0.1);

        // 地图中心变化由 MapProxy -> mapEenterChange -> WorldCommand 上报 AOI，
        // 可见区域只负责本地渲染，不再轮询旧 scanBlock 或扫描远处关隘。
    }

    protected update(): void {
        if (this._failed) return;
        try {
            const started = Date.now();
            // 七个图层共享预算；回收先取最多 2ms / 32 个节点，避免区域切换时集中解绑。
            let recycled = 0;
            while (recycled < 32 && Date.now() - started < 2) {
                let didRecycle = false;
                for (let i = 0; i < this._recycleLayers.length; i++) {
                    const layer = this._recycleLayers[this._recycleLayerIndex];
                    this._recycleLayerIndex = (this._recycleLayerIndex + 1) % this._recycleLayers.length;
                    if (layer.recycleOneItem()) {
                        didRecycle = true;
                        recycled++;
                        break;
                    }
                }
                if (!didRecycle) break;
            }
            let processed = 0;
            // 回收与生成合计 4ms；概览跳过逐格资源 Sprite，允许加快区域扫描。
            const cellBudget = this._cmd.proxy.overview ? 256 : 24;
            while (this._pendingAreas.length > 0 && processed < cellBudget && Date.now() - started < 4) {
                const area = this._pendingAreas[0];
                this.addMapCell(area.id, area.x, area.y);
                processed++;
                if (!this._ready) this._initialCellDone++;
                area.y++;
                if (area.y >= area.endY) {
                    area.y = area.startY;
                    area.x++;
                }
                if (area.x >= area.endX) this._pendingAreas.shift();
            }
            if (!this._ready && processed > 0) {
                const progress = this._initialCellTotal > 0 ? this._initialCellDone / this._initialCellTotal : 1;
                EventMgr.emit(CoreEvent.mapLoadProgress, 0.9 + Math.min(1, progress) * 0.08, '正在部署城池与资源…');
            }
            if (this._positionReady && !this._ready && !this._warmupStarted && this._pendingAreas.length === 0) {
                this._warmupStarted = true;
                EventMgr.emit(CoreEvent.mapLoadProgress, 0.99, '正在展开山河…');
                this.warmUpMap(this._tiledMap, 3, () => {
                    this.scheduleOnce(() => {
                        if (this._failed) return;
                        if (this._pendingAreas.length > 0) {
                            this._warmupStarted = false;
                            return;
                        }
                        this._ready = true;
                        EventMgr.emit(CoreEvent.mapReady);
                    }, 0.12);
                });
            }
        } catch (error) {
            this.failInitialization(error);
        }
    }

    private failInitialization(error: unknown): void {
        this._failed = true;
        this._pendingAreas.length = 0;
        this.unscheduleAllCallbacks();
        console.error('地图节点初始化失败:', error);
        EventMgr.emit(CoreEvent.mapLoadFailed, error);
    }

    /** 进图时强制重算各图层裁剪区，避免加载页淡出后出现缺块的黑色条带 */
    protected warmUpMap(tiledMap: TiledMap, frames: number, done: () => void): void {
        const step = () => {
            try {
                if (!tiledMap || !tiledMap.isValid) throw new Error('地图预热时图层已失效');
                const layers = tiledMap.getLayers();
                for (let i = 0; i < layers.length; i++) layers[i].updateCulling();
                if (--frames <= 0) done();
            } catch (error) {
                this.failInitialization(error);
            }
        };
        // scheduleOnce 的回调内重新注册同一个函数会被本次定时器清理。
        // 使用有次数限制的 schedule，保证真正经过三帧，而非等待三秒兜底。
        this.schedule(step, 0, Math.max(0, frames - 1));
    }

    protected onDestroy(): void {
        this._pendingAreas.length = 0;
        EventMgr.targetOff(this);
        this._recycleLayers.length = 0;
        if (this._cmd) this._cmd.proxy.clearData();
        this._cmd = null;
    }

    protected onMapShowAreaChange(centerPoint: Vec2, centerAreaId: number, addIds: number[], removeIds: number[], detailChanged = false): void {


        let resLogic: MapResLogic = this.node.getComponent(MapResLogic);
        let buildResLogic: MapResBuildLogic = this.node.getComponent(MapResBuildLogic);
        let buildFacilityLogic: MapFacilityBuildLogic = this.node.getComponent(MapFacilityBuildLogic);
        let tagLogic: MapBuildTagLogic = this.node.getComponent(MapBuildTagLogic);
        let buildTipsLogic: MapBuildTipsLogic = this.node.getComponent(MapBuildTipsLogic);
        let cityLogic: MapCityLogic = this.node.getComponent(MapCityLogic);
        let sysCityLogic: MapSysCityLogic = this.node.getComponent(MapSysCityLogic);
        this._itemLayers = { res: resLogic, build: buildResLogic, facility: buildFacilityLogic,
            tag: tagLogic, tips: buildTipsLogic, city: cityLogic, sysCity: sysCityLogic };
        this._recycleLayers = [resLogic, buildResLogic, buildFacilityLogic, tagLogic, buildTipsLogic, cityLogic, sysCityLogic];

        //更新展示区域
        resLogic.udpateShowAreas(addIds, removeIds);
        buildResLogic.udpateShowAreas(addIds, removeIds);
        buildFacilityLogic.udpateShowAreas(addIds, removeIds);
        tagLogic.udpateShowAreas(addIds, removeIds);
        buildTipsLogic.udpateShowAreas(addIds, removeIds);
        cityLogic.udpateShowAreas(addIds, removeIds);
        sysCityLogic.udpateShowAreas(addIds, removeIds);
        resLogic.refreshOverview(this._cmd.proxy.overview);
        // 切入战略层时立即隐藏仍在分帧回收的近景对象。
        for (const layer of this._recycleLayers) {
            let containsTerrain = false;
            for (let parent = this.mapLayer; parent; parent = parent.parent) {
                if (parent === layer.parentLayer) containsTerrain = true;
            }
            if (layer.parentLayer && !containsTerrain) layer.parentLayer.active = !this._cmd.proxy.strategic;
        }

        // 移走的区域必须取消排队，避免分帧后又向已移除区域填充节点。
        this._pendingAreas = this._pendingAreas.filter((area) => {
            if (removeIds.indexOf(area.id) < 0) return true;
            if (!this._ready) this._initialCellTotal -= (area.endX - area.x - 1) * (area.endY - area.startY) + area.endY - area.y;
            return false;
        });
        // 从概览拉近时补回细节；已加载的城池与业务节点由 addItem 复用。
        const enqueueIds = detailChanged && !this._cmd.proxy.overview ? this._cmd.proxy.visibleAreaIds : addIds;
        for (const id of enqueueIds) {
            if (this._pendingAreas.some((area) => area.id === id)) continue;
            const area: MapAreaData = this._cmd.proxy.getMapAreaData(id);
            if (!area || area.endCellX <= area.startCellX || area.endCellY <= area.startCellY) continue;
            this._pendingAreas.push({ id, x: area.startCellX, y: area.startCellY,
                startY: area.startCellY, endX: area.endCellX, endY: area.endCellY });
            if (!this._ready) this._initialCellTotal += (area.endCellX - area.startCellX) * (area.endCellY - area.startCellY);
        }
    }

    private addMapCell(areaId: number, x: number, y: number): void {
        const layers = this._itemLayers;
        if (!layers) throw new Error('地图图层尚未初始化');
        const cellId = MapUtil.getIdByCellPoint(x, y);
        const resource = this._cmd.proxy.getResData(cellId);
        const build = this._cmd.buildProxy.getBuild(cellId);
        const city = this._cmd.cityProxy.getCity(cellId);
        if (resource) {
            // 空地、城池等没有 ResLogic 图像，不创建空的资源节点。
            if (!city && !this._cmd.proxy.getSysCityResData(x, y) && (resource.type === MapResType.SYS_FORTRESS
                || (resource.type >= MapResType.WOOD && resource.type <= MapResType.GRAIN))) {
                layers.res.addItem(areaId, resource);
            }
            if (resource.type === MapResType.SYS_CITY) layers.sysCity.addItem(areaId, resource);
            if (this._cmd.proxy.isPosTag(x, y)) {
                layers.tag.addItem(areaId, resource);
            }
        }
        if (build) {
            if (build.type === MapResType.SYS_CITY) layers.sysCity.addItem(areaId, build);
            else if (build.type === MapResType.SYS_FORTRESS) layers.res.addItem(areaId, build);
            else layers.build.addItem(areaId, build);
            layers.facility.addItem(areaId, build);
            layers.tips.addItem(areaId, build);
        }
        if (city && city.id === cellId) layers.city.addItem(areaId, city);
    }

    private onPlayerCityTiles(ids: number[]): void {
        if (!this._itemLayers) return;
        for (const id of ids) {
            const pos = MapUtil.getCellPointById(id);
            const area = MapUtil.getAreaIdByCellPoint(pos.x, pos.y);
            if (this._cmd.cityProxy.getCity(id)) {
                this._itemLayers.res.removeItem(area, id);
            } else this.addMapCell(area, pos.x, pos.y);
        }
    }

    protected onScrollToMap(x: number, y: number): void {
        let old = this.node.getComponent(MapLogic).curCameraPoint();
        let cur = this.node.getComponent(MapLogic).toCameraPoint(new Vec2(x, y));

        EventMgr.emit(LogicEvent.beforeScrollToMap, cur.x, cur.y, old.x, old.y);
        this.node.getComponent(MapLogic).scrollToMapPoint(new Vec2(x, y));
    }
}
