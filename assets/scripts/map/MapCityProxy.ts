import { _decorator } from 'cc';
import MapUtil from "./MapUtil";
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';
import type { WorldEntity } from '../world/WorldCommand';
import type { Role } from '../login/LoginProxy';
import { PLAYER_CITY_FOOTPRINT_RADIUS } from './PlayerCityAppearance';


/**地图城池配置*/
export class MapCityData {
    id: number = 0;
    cityId: number = 0;
    rid: number | string = 0;
    /** World 实体 ID 保留 int64 精度；cityId 只是旧界面的本地索引，不可作为协议目标 ID。 */
    entityId: number | string = 0;
    fromWorld = false;
    name: string = "";
    x: number = null;
    y: number = 0;
    isMain: number = 0;
    level: number = 0;
    curDurable: number = 0;
    maxDurable: number = 0;
    unionId: number | string = 0;
    parentId:number = 0;
    unionName:string = "";
    occupyTime:number;

    public equalsServerData(data: any) {
        if (this.cityId == data.cityId
            && this.rid == data.rid
            && this.name == data.name
            && this.x == data.x
            && this.y == data.y
            && this.isMain == data.is_main
            && this.level == data.level
            && this.curDurable == data.cur_durable
            && this.maxDurable == data.maxDurable
            && this.unionId == data.union_id
            && this.parentId == data.parent_id 
            && this.unionName == data.union_name
            && this.occupyTime == data.occupy_time) {
            return true;
        }
        return false;
    }

    public static createCityData(data: any, id: number, cityData: MapCityData = null): MapCityData {
        let city: MapCityData = cityData;
        if (cityData == null) {
            city = new MapCityData();
        }
        city.id = id;
        city.cityId = data.cityId;
        city.rid = data.rid;
        city.name = data.name;
        city.x = data.x;
        city.y = data.y;
        city.isMain = data.is_main;
        city.level = data.level;
        city.curDurable = data.cur_durable;
        city.maxDurable = data.max_durable;
        city.unionId = data.union_id;
        city.parentId = data.parent_id;
        city.unionName = data.union_name;
        city.occupyTime = data.occupy_time;
        return city;
    }

    public getCellRadius() :number {
        return this.fromWorld ? PLAYER_CITY_FOOTPRINT_RADIUS : 2;
    }
}

export default class MapCityProxy {
    protected _mapCitys: MapCityData[] = [];
    protected _lastCityCellIds: Map<number, number[]> = new Map<number, number[]>();
    protected _myCitys: MapCityData[] = [];
    public myId: number | string = 0;
    public myUnionId: number | string = 0;
    public myParentId: number = 0;
    private worldCities = new Map<string, MapCityData>();
    private worldCells = new Map<number, MapCityData>();
    private worldCityIds = new Map<string, number>();
    private nextWorldCityId = 2;

    // 初始化数据
    public initData(): void {
        this._mapCitys.length = 0;
        this._mapCitys.length = MapUtil.mapCellCount;
        this._lastCityCellIds.clear();
        this.updateMyCityIds();
    }

    public clearData(): void {
        this._mapCitys.length = 0;
        this._lastCityCellIds.clear();
        this._myCitys.length = 0;
        this.worldCities.clear(); this.worldCells.clear(); this.worldCityIds.clear();
        this.nextWorldCityId = 2;
        this.myId = 0; this.myUnionId = 0; this.myParentId = 0;
    }

    /** 登录主城坐标 + World AOI 是新协议唯一城池来源。离开 AOI 不删除自己的主城。 */
    public syncWorldCities(entities: readonly WorldEntity[], role: Role | null, mainLevel: number): void {
        if (!MapUtil.areaCellSize) return;
        const validId = (id: unknown) => /^[1-9]\d*$/.test(String(id));
        const validPos = (p: { x: number; y: number } | null | undefined) => !!p
            && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0
            && p.x < MapUtil.mapSize.width && p.y < MapUtil.mapSize.height;
        const cityLevel = (level: number | undefined) => Number.isInteger(level) && level > 0 ? level : 0;
        this.myId = role?.userId || 0;
        this.myUnionId = role?.allianceId || 0;
        const next = new Map<string, MapCityData>();
        const ownEntity = entities.find(e => e.entityType === 1 && validId(e.entityId)
            && validId(this.myId) && String(e.ownerId) === String(this.myId) && validPos(e.pos));
        for (const entity of entities) {
            if (entity.entityType !== 1 || !validId(entity.entityId) || !validId(entity.ownerId)
                || !validPos(entity.pos) || String(entity.ownerId) === String(this.myId)) continue;
            const key = String(entity.entityId);
            if (!this.worldCityIds.has(key)) this.worldCityIds.set(key, this.nextWorldCityId++);
            const city = new MapCityData();
            Object.assign(city, { cityId: this.worldCityIds.get(key), entityId: entity.entityId,
                rid: entity.ownerId, x: entity.pos.x, y: entity.pos.y,
                name: entity.name?.trim() || '玩家主城', level: cityLevel(entity.level), isMain: 1, fromWorld: true });
            city.id = MapUtil.getIdByCellPoint(city.x, city.y);
            next.set(key, city);
        }
        const ownPos = validPos(role?.cityPos) ? role.cityPos : ownEntity?.pos;
        if (validId(this.myId) && validPos(ownPos)) {
            const city = new MapCityData();
            // 自己的城建快照优先；登录尚未收到 Build 时可直接使用 AOI 的建筑等级。
            Object.assign(city, { cityId: 1, entityId: ownEntity?.entityId || 0, rid: this.myId,
                x: ownPos.x, y: ownPos.y, name: role?.name ? `${role.name}的主城` : ownEntity?.name?.trim() || '我的主城',
                isMain: 1, level: cityLevel(mainLevel) || cityLevel(ownEntity?.level), unionId: this.myUnionId, fromWorld: true });
            city.id = MapUtil.getIdByCellPoint(city.x, city.y);
            next.set('own', city);
            this._myCitys = [city];
        } else this._myCitys = [];

        const changed = new Map<number, { add: number[]; remove: number[]; update: number[] }>();
        const change = (city: MapCityData, kind: 'add' | 'remove' | 'update') => {
            const area = MapUtil.getAreaIdByCellPoint(city.x, city.y);
            if (!changed.has(area)) changed.set(area, { add: [], remove: [], update: [] });
            changed.get(area)[kind].push(city.id);
        };
        for (const [key, city] of this.worldCities) {
            if (!next.has(key) || next.get(key).id !== city.id) change(city, 'remove');
        }
        for (const [key, city] of next) {
            const before = this.worldCities.get(key);
            if (!before || before.id !== city.id) change(city, 'add');
            else if (JSON.stringify(before) !== JSON.stringify(city)) change(city, 'update');
        }
        const previousCells = new Set(this.worldCells.keys());
        this.worldCells.clear();
        for (const city of next.values()) {
            // 3×3 主城占地，边界逐坐标裁切，避免 x=0 时索引绕到另一行。
            const radius = PLAYER_CITY_FOOTPRINT_RADIUS;
            for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
                const pos = { x: city.x + dx, y: city.y + dy };
                if (validPos(pos)) this.worldCells.set(MapUtil.getIdByCellPoint(pos.x, pos.y), city);
            }
        }
        this.worldCities = next;
        for (const [area, delta] of changed) EventMgr.emit(LogicEvent.updateCitys, area, delta.add, delta.remove, delta.update);
        const footprintChanges = [...previousCells].filter(id => !this.worldCells.has(id))
            .concat([...this.worldCells.keys()].filter(id => !previousCells.has(id)));
        if (footprintChanges.length) EventMgr.emit(LogicEvent.updatePlayerCityTiles, footprintChanges);
    }

    public addCityData(data: any, cellId: number): void {
        let cityData: MapCityData = MapCityData.createCityData(data, cellId, this._mapCitys[cellId]);
        this._mapCitys[cellId] = cityData;
        this._mapCitys[cellId - 1] = cityData;
        this._mapCitys[cellId + 1] = cityData;
        this._mapCitys[cellId - MapUtil.mapSize.width] = cityData;
        this._mapCitys[cellId - MapUtil.mapSize.width - 1] = cityData;
        this._mapCitys[cellId - MapUtil.mapSize.width + 1] = cityData;
        this._mapCitys[cellId + MapUtil.mapSize.width] = cityData;
        this._mapCitys[cellId + MapUtil.mapSize.width - 1] = cityData;
        this._mapCitys[cellId + MapUtil.mapSize.width + 1] = cityData;
    }

    public removeCityData(cellId: number): void {
        let cityData: MapCityData = this._mapCitys[cellId];
        if (cityData) {
            this._mapCitys[cellId] = null;
            this.checkAndRemoveCityCell(cellId - 1, cityData.cityId);
            this.checkAndRemoveCityCell(cellId + 1, cityData.cityId);
            this.checkAndRemoveCityCell(cellId - MapUtil.mapSize.width, cityData.cityId);
            this.checkAndRemoveCityCell(cellId - MapUtil.mapSize.width - 1, cityData.cityId);
            this.checkAndRemoveCityCell(cellId - MapUtil.mapSize.width + 1, cityData.cityId);
            this.checkAndRemoveCityCell(cellId + MapUtil.mapSize.width, cityData.cityId);
            this.checkAndRemoveCityCell(cellId + MapUtil.mapSize.width - 1, cityData.cityId);
            this.checkAndRemoveCityCell(cellId + MapUtil.mapSize.width + 1, cityData.cityId);
        }
    }

    public checkAndRemoveCityCell(cellId: number, cityId: number): boolean {
        let cityData: MapCityData = this._mapCitys[cellId];
        if (cityData && cityData.cityId == cityId) {
            this._mapCitys[cellId] = null;
            return true;
        }
        return false;
    }

    /**我的建筑信息*/
    public initMyCitys(citys: any[]): void {
        this._myCitys.length = 0;
        for (let i: number = 0; i < citys.length; i++) {
            let id: number = MapUtil.getIdByCellPoint(citys[i].x, citys[i].y);
            let city: MapCityData = MapCityData.createCityData(citys[i], id);
            if (city.isMain) {
                this._myCitys.unshift(city);
            } else {
                this._myCitys.push(city);
            }
        }
    }

    /**更新建筑id*/
    public updateMyCityIds(): void {
        for (let i: number = 0; i < this._myCitys.length; i++) {
            if (this._myCitys[i].fromWorld) continue;
            let id: number = MapUtil.getIdByCellPoint(this._myCitys[i].x, this._myCitys[i].y);
            this._myCitys[i].id = id;
            this._mapCitys[id] = this._myCitys[i];
        }

    }

    /**更新建筑*/
    public updateCity(city: any): MapCityData {
        let id: number = MapUtil.getIdByCellPoint(city.x, city.y);
        let cityData: MapCityData = null;
        if (this._mapCitys[id] == null) {
            //代表是新增
            cityData = MapCityData.createCityData(city, id);
            this._mapCitys[id] = cityData;
            if (city.rid == this.myId) {
                this._myCitys.push(cityData);
                this.myUnionId = cityData.unionId
                this.myParentId = cityData.parentId
            }
        } else {
            cityData = MapCityData.createCityData(city, id, this._mapCitys[id]);
            if (city.rid == this.myId) {
                this.myUnionId = cityData.unionId
                this.myParentId = cityData.parentId
            }
        }
        return cityData;
    }

    public setMapScanBlock(scanDatas: any, areaId: number = 0): void {
        let cBuilds: any[] = scanDatas.mc_builds;
        if (cBuilds.length > 0) {
            let lastCityCellIds: number[] = null;
            if (this._lastCityCellIds.has(areaId)) {
                lastCityCellIds = this._lastCityCellIds.get(areaId);
            }
            let cityCellIds: number[] = [];
            let addCityCellIds: number[] = [];
            let updateCityCellIds: number[] = [];
            let removeCityCellIds: number[] = [];
            for (let i: number = 0; i < cBuilds.length; i++) {
                let areaIndex: number = MapUtil.getAreaIdByCellPoint(cBuilds[i].x, cBuilds[i].y);
                if (areaIndex != areaId) {
                    //代表服务端给过来的数据不在当前区域
                    continue;
                }
                let cellId: number = MapUtil.getIdByCellPoint(cBuilds[i].x, cBuilds[i].y);
                cityCellIds.push(cellId);
                if (lastCityCellIds) {
                    let index: number = lastCityCellIds.indexOf(cellId);
                    if (index != -1) {
                        //存在就列表中 就代表是已存在的数据
                        if (this._mapCitys[cellId].equalsServerData(cBuilds[i]) == false) {
                            //代表数据不一样需要刷新
                            this.addCityData(cBuilds[i], cellId);
                            updateCityCellIds.push(cellId);
                        }
                        lastCityCellIds.splice(index, 1);//移除重复数据
                        continue;
                    }
                }
                //其他情况就是新数据了
                this.addCityData(cBuilds[i], cellId);
                addCityCellIds.push(cellId);
            }
            if (lastCityCellIds && lastCityCellIds.length > 0) {
                //代表有需要删除的数据
                removeCityCellIds = lastCityCellIds;
                for (let i: number = 0; i < removeCityCellIds.length; i++) {
                    this.removeCityData(removeCityCellIds[i]);
                }
            }
            this._lastCityCellIds.set(areaId, cityCellIds);
            if (addCityCellIds.length > 0 || removeCityCellIds.length > 0 || updateCityCellIds.length > 0) {
                EventMgr.emit(LogicEvent.updateCitys, areaId, addCityCellIds, removeCityCellIds, updateCityCellIds);
            }
        }
    }

    public getCity(id: number): MapCityData {
        return this.worldCells.get(id) || this._mapCitys[id];
    }

    public getMyMainCity(): MapCityData {
        if (this._myCitys.length > 0) {
            return this._myCitys[0];
        }
        return null;
    }

    public isMyCity(cityId: number): boolean {
        return this.getMyCityById(cityId) != null;
    }

    public getMyCityById(cityId: number): MapCityData {
        for (let i: number = 0; i < this._myCitys.length; i++) {
            if (this._myCitys[i].cityId == cityId) {
                return this._myCitys[i];
            }
        }
        return null;
    }

    public getMyCitys(): MapCityData[] {
        return this._myCitys;
    }

    public getMyPlayerId(): number | string {
        if (this._myCitys.length > 0) {
            return this._myCitys[0].rid;
        }
        return 0;
    }
}
