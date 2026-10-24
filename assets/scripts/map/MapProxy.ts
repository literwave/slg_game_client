import { _decorator, TiledMapAsset, Vec2, game, view } from 'cc';
import MapUtil from "./MapUtil";
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';
import { cityFootprintRadius } from './CityFootprint';


export class MapResConfig {
    type: number = 0;
    level: number = 0;
    name: string = "";
    wood: number = 0;
    iron: number = 0;
    stone: number = 0;
    grain: number = 0;
    durable: number = 0;
    defender: number = 0;
}

/**地图资源类型*/
export class MapResType {
    static SYS_FORTRESS: number = 50;   //系统要塞
    static SYS_CITY: number = 51;
    static WOOD: number = 52;
    static IRON: number = 53;
    static STONE: number = 54;
    static GRAIN: number = 55;
    static FORTRESS: number = 56; //要塞

}

/**地图资源数据*/
export class MapResData {
    isEmpty = false;
    id: number = 0;
    type: number = 0;
    level: number = 0;
    x: number = 0;
    y: number = 0;
}



export class MapTagPos {
    x: number = 0;
    y: number = 0;
    name: string = "";
}

/**地图区域数据*/
export class MapAreaData {
    static MAX_TIME: number = 10000;
    id: number = 0;
    x: number = 0;
    y: number = 0;
    startCellX: number = 0;
    startCellY: number = 0;
    endCellX: number = 0;
    endCellY: number = 0;
    len: number = 0;
    qryStartTime: number = 0;

    public checkAndUpdateQryTime(): boolean {
        let nowTime: number = Date.now();
        if (nowTime - this.qryStartTime >= MapAreaData.MAX_TIME) {
            this.qryStartTime = nowTime;
            return true
        }
        return false;
    }

    public equals(other: MapAreaData): boolean {
        if (other == null) {
            return false;
        }
        return this.id == other.id;
    }

    public fuzzyEquals(other: MapAreaData, variance: number): boolean {
        if (other == null) {
            return false;
        }
        if (this.x - variance <= other.x && other.x <= this.x + variance) {
            if (this.y - variance <= other.y && other.y <= this.y + variance)
                return true;
        }
        return false;
    }
}

export default class MapProxy {
    public warFree: number = 0; //免战时间
    public tiledMapAsset: TiledMapAsset = null;
    //当前地图中心点
    protected _curCenterPoint: Vec2 = null;
    //当前展示区域
    protected _curCenterAreaId: number = -1;
    public visibleAreaIds: number[] = [];
    public overview = false;
    public strategic = false;
    protected _mapAreaDatas: MapAreaData[] = [];
    private _resourceTypes = new Uint8Array(0);
    private _resourceLevels = new Uint8Array(0);
    private _resourceWidth = 0;
    private _emptyCells = new Uint8Array(0);
    private _resourceCache = new Map<number, MapResData>();
    protected _mapSysCityResDatas: MapResData[] = [];
    protected _mapPosTags: MapTagPos[] = [];

    //地图请求列表
    public qryAreaIds: number[] = [];
    //地图基础配置数据
    protected _mapResConfigs: Map<string, MapResConfig> = new Map<string, MapResConfig>();

    // 初始化地图配置
    public initData(): void {
        this._mapAreaDatas.length = MapUtil.areaCount;
    }

    public clearData(): void {
        this._curCenterPoint = null;
        this._curCenterAreaId = -1;
        this.visibleAreaIds = [];
        this.overview = false;
        this.strategic = false;
        this._mapAreaDatas.length = 0;
        this.qryAreaIds.length = 0;
    }

    /**地图建筑基础配置信息*/
    public setNationMapConfig(configList: any[]): void {
        this._mapResConfigs.clear();
        for (let i: number = 0; i < configList.length; i++) {
            let cfg: MapResConfig = new MapResConfig();
            cfg.type = configList[i].type;
            cfg.level = configList[i].level;
            cfg.name = configList[i].name;
            cfg.wood = configList[i].wood ?? configList[i].Wood ?? 0;
            cfg.iron = configList[i].iron;
            cfg.stone = configList[i].stone;
            cfg.grain = configList[i].grain;
            cfg.durable = configList[i].durable;
            cfg.defender = configList[i].defender;
            this._mapResConfigs.set(configList[i].type + "_" + cfg.level, cfg);
        }
    }

    public setWarFree(time) {
        this.warFree = time;
    }

    public getWarFree(): number {
        return this.warFree * 1000
    }

    public initMapResConfig(jsonData: any): void {
        // 保留同步入口给已有调用方，进图流程使用下面的分批入口。
        for (const _progress of this.initMapResConfigBatched(jsonData)) { /* drain */ }
    }

    /** 每批最多 2048 格 / 4ms；全部完成后才发布，取消加载不会留下半张地图。 */
    public *initMapResConfigBatched(jsonData: any): Generator<number, void, unknown> {
        if (!jsonData || !Number.isInteger(jsonData.w) || jsonData.w <= 0
            || !Number.isInteger(jsonData.h) || jsonData.h <= 0 || !Array.isArray(jsonData.list)
            || jsonData.list.length !== jsonData.w * jsonData.h) {
            throw new Error('地图资源数据格式无效');
        }
        const w: number = jsonData.w;
        const list: Array<Array<number>> = jsonData.list;
        const types = new Uint8Array(list.length), levels = new Uint8Array(list.length);
        const sysCityDatas: MapResData[] = [];
        let batchStart = Date.now();
        let batchCount = 0;
        for (let i = 0; i < list.length; i++) {
            if (!Array.isArray(list[i]) || list[i].length < 2) throw new Error(`地图格 ${i} 数据缺失`);
            types[i] = list[i][0]; levels[i] = list[i][1];
            if (types[i] == MapResType.SYS_CITY) {
                const data = new MapResData();
                data.id = i; data.type = types[i]; data.level = levels[i];
                data.x = i % w; data.y = Math.floor(i / w);
                sysCityDatas.push(data);
            }
            batchCount++;
            if (i + 1 < list.length && (batchCount >= 2048 || (batchCount % 128 === 0 && Date.now() - batchStart >= 4))) {
                yield (i + 1) / list.length;
                batchStart = Date.now();
                batchCount = 0;
            }
        }
        this._resourceTypes = types; this._resourceLevels = levels; this._resourceWidth = w;
        this._resourceCache.clear();
        this._emptyCells = new Uint8Array(list.length);
        for (const id of jsonData.emptyCells || []) {
            if (Number.isInteger(id) && id >= 0 && id < list.length && types[id] === 0) this._emptyCells[id] = 1;
        }
        this._mapSysCityResDatas = sysCityDatas;
        yield 1;
    }


    public getSysCityResData(x, y): MapResData {
        for (let index = 0; index < this._mapSysCityResDatas.length; index++) {

            var resData = this._mapSysCityResDatas[index];
            var level = resData.level;
            const dis = cityFootprintRadius(level);

            if (dis >= Math.abs(x - resData.x) && dis >= Math.abs(y - resData.y)) {
                return resData;
            }
        }
        return null;
    }



    /**设置地图当前中心点的信息*/
    public setCurCenterPoint(point: Vec2, pixelPoint: Vec2, halfSize?: Vec2): boolean {
        const centerChanged = !this._curCenterPoint || this._curCenterPoint.x !== point.x || this._curCenterPoint.y !== point.y;
        this._curCenterPoint = point;
        if (centerChanged) EventMgr.emit(LogicEvent.mapEenterChange, point);
        const size = view.getVisibleSize();
        const half = halfSize || new Vec2(size.width / 2, size.height / 2);
        const wasOverview = this.overview;
        const wasStrategic = this.strategic;
        // 回差避免在临界滚轮位置反复切换细节。
        this.overview = half.y > (wasOverview ? 650 : 750);
        this.strategic = half.y > (wasStrategic ? 2800 : 3200);
        const detailChanged = wasOverview !== this.overview || wasStrategic !== this.strategic;
        // 战略层不扫描百万格或请求全图区域。
        const newIds = this.strategic ? [] : MapUtil.getVisibleAreaIds(pixelPoint, half.x, half.y);
        const previous = new Set(this.visibleAreaIds), next = new Set(newIds);
        const addIds = newIds.filter(id => !previous.has(id));
        const removeIds = this.visibleAreaIds.filter(id => !next.has(id));
        this.visibleAreaIds = newIds;
        this._curCenterAreaId = MapUtil.getAreaIdByCellPoint(point.x, point.y);
        if (addIds.length || removeIds.length || detailChanged) {
            this.qryAreaIds = [...new Set(addIds.concat(this.qryAreaIds))].filter(id => next.has(id));
            EventMgr.emit(LogicEvent.mapShowAreaChange, point, this._curCenterAreaId, addIds, removeIds, detailChanged);
        }
        return centerChanged || addIds.length > 0 || removeIds.length > 0 || detailChanged;
    }

    public getCurCenterPoint(): Vec2 {
        return this._curCenterPoint;
    }

    public getCurCenterAreaId(): number {
        return this._curCenterAreaId;
    }

    /**获取地图区域数据*/
    public getMapAreaData(id: number): MapAreaData {
        if (this._mapAreaDatas[id] == undefined) {
            let data: MapAreaData = new MapAreaData();
            data.id = id;
            let point: Vec2 = MapUtil.getAreaPointById(id);
            let startCellPoint: Vec2 = MapUtil.getStartCellPointByAreaPoint(point.x, point.y);
            data.x = point.x;
            data.y = point.y;
            data.startCellX = startCellPoint.x;
            data.startCellY = startCellPoint.y;
            data.endCellX = Math.min(MapUtil.mapSize.width, startCellPoint.x + MapUtil.areaCellSize.width);
            data.endCellY = Math.min(MapUtil.mapSize.height, startCellPoint.y + MapUtil.areaCellSize.height);
            data.len = MapUtil.areaCellSize.width;
            this._mapAreaDatas[id] = data;
            return data;
        }
        return this._mapAreaDatas[id];
    }

    /*获取产量描述**/
    public getResYieldDesList(cfg: MapResConfig): string[] {
        let list: string[] = [];
        if (!cfg) return list;
        for (const [key, name] of [['grain', '粮食'], ['wood', '木材'], ['iron', '铁矿'], ['stone', '石料']]) {
            const amount = Number(cfg[key]);
            if (amount > 0) list.push(name + ' +' + amount + '/小时');
        }

        return list;
    }

    public getResData(id: number): MapResData {
        if (!Number.isInteger(id) || id < 0 || id >= this._resourceTypes.length) return null;
        let data = this._resourceCache.get(id);
        if (!data) {
            data = new MapResData(); data.id = id;
            data.type = this._resourceTypes[id]; data.level = this._resourceLevels[id];
            data.isEmpty = this._emptyCells[id] === 1;
            data.x = id % this._resourceWidth; data.y = Math.floor(id / this._resourceWidth);
            // 百万格仅保留两份字节表和有限的可见格对象，避免预先创建百万个对象。
            if (this._resourceCache.size >= 8192) this._resourceCache.delete(this._resourceCache.keys().next().value);
            this._resourceCache.set(id, data);
        }
        return data;
    }

    /**根据类型获取配置数据*/
    public getResConfig(type: number, level: number): MapResConfig {
        let key: string = type + "_" + level;
        if (this._mapResConfigs.has(key)) {
            return this._mapResConfigs.get(key);
        }
        return null;
    }

    public hasResDatas(): boolean {
        return this._resourceTypes.length > 0;
    }

    public hasResConfig(): boolean {
        return this._mapResConfigs.size > 0;
    }

    public updateMapPosTags(posTag: any) {
        this._mapPosTags = [];
        posTag.forEach(data => {
            var tag = new MapTagPos();
            tag.x = data.x;
            tag.y = data.y;
            tag.name = data.name;

            this._mapPosTags.push(tag);
        });
    }

    public removeMapPosTag(x: number, y: number) {
        var tags: MapTagPos[] = [];
        this._mapPosTags.forEach(tag => {
            if (tag.x != x || y != tag.y) {
                tags.push(tag);
            }
        });

        this._mapPosTags = tags;
    }

    public addMapPosTag(x: number, y: number, name: string) {
        var tag = new MapTagPos();
        tag.x = x;
        tag.y = y;
        tag.name = name;

        var ok = true;
        this._mapPosTags.forEach(tag => {
            if (tag.x == x && tag.y == y) {
                ok = false;
            }
        });

        if (ok) {
            this._mapPosTags.push(tag);
        }

    }

    public isPosTag(x: number, y: number): boolean {
        var ret = false;
        for (let index = 0; index < this._mapPosTags.length; index++) {
            const tag = this._mapPosTags[index];
            if (tag.x == x && tag.y == y) {
                ret = true;
                break;
            }
        }

        return ret;
    }

    public getPosTags(): MapTagPos[] {
        return this._mapPosTags;
    }
}
