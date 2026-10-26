import { _decorator } from 'cc';
import { ServerConfig } from "../config/ServerConfig";
import ArmyCommand from "../general/ArmyCommand";
import GeneralCommand from "../general/GeneralCommand";
import { NetManager } from "../network/socket/NetManager";
import DateUtil from "../utils/DateUtil";
import MapBuildProxy, { MapBuildData } from "./MapBuildProxy";
import MapCityProxy, { MapCityData } from "./MapCityProxy";
import MapProxy from "./MapProxy";
import MapUtil from "./MapUtil";
import MapUICommand from "./ui/MapUICommand";
import { EventMgr } from '../utils/EventMgr';
import { LogicEvent } from '../common/LogicEvent';
import WorldCampaign from './WorldCampaign';
import LoginCommand from '../login/LoginCommand';
import WorldCommand from '../world/WorldCommand';
import MapMarkCommand from '../world/MapMarkCommand';
import BuildCommand from '../build/BuildCommand';
import { isResourceLandCell } from '../world/ResourceLand';

export default class MapCommand {
    //单例
    protected static _instance: MapCommand;
    public static getInstance(): MapCommand {
        if (this._instance == null) {
            this._instance = new MapCommand();
        }
        return this._instance;
    }

    public static destory(): boolean {
        if (this._instance) {
            this._instance.onDestory();
            this._instance = null;
            return true;
        }
        return false;
    }

    //数据model
    protected _proxy: MapProxy = new MapProxy();
    protected _cityProxy: MapCityProxy = new MapCityProxy();
    protected _buildProxy: MapBuildProxy = new MapBuildProxy();
    protected _isQryMyProperty: boolean = false;

    constructor() {


        EventMgr.on(ServerConfig.role_myProperty, this.onRoleMyProperty, this);
        EventMgr.on(ServerConfig.roleBuild_push, this.onRoleBuildStatePush, this);
        EventMgr.on(ServerConfig.nationMap_config, this.onNationMapConfig, this);
        EventMgr.on(ServerConfig.nationMap_giveUp, this.onNationMapGiveUp, this);
        EventMgr.on(ServerConfig.nationMap_build, this.onNationMapBuild, this);
        EventMgr.on(ServerConfig.nationMap_upBuild, this.onNationMapUpBuild, this);
        EventMgr.on(ServerConfig.roleCity_push, this.onRoleCityPush, this);
        EventMgr.on(LogicEvent.updateTag, this.syncMarks, this);
        EventMgr.on(LogicEvent.updateWorldEntities, this.syncWorldCities, this);
        EventMgr.on(LogicEvent.updateCityPosition, this.syncWorldCities, this);
        EventMgr.on(LogicEvent.updateMyRole, this.syncWorldCities, this);
        EventMgr.on(LogicEvent.updateCityBuilds, this.syncWorldCities, this);
        this.syncMarks();
    }

    public onDestory(): void {
        EventMgr.targetOff(this);
    }

    public initData(): void {
        this._proxy.initData();
        this._cityProxy.initData();
        this._buildProxy.initData();
        this.syncWorldCities();
        this.syncMarks();
    }

    private syncWorldCities(): void {
        this._cityProxy.syncWorldCities(Array.from(WorldCommand.getInstance().entities.values()),
            LoginCommand.getInstance().proxy.getRoleData(), BuildCommand.getInstance().levels.get(1) || 0);
    }

    public clearData(): void {
        this._proxy.clearData();
        this._cityProxy.clearData();
        this._buildProxy.clearData();
        this._isQryMyProperty = false;
    }

    public get proxy(): MapProxy {
        return this._proxy;
    }

    public get cityProxy(): MapCityProxy {
        return this._cityProxy;
    }

    public get buildProxy(): MapBuildProxy {
        return this._buildProxy;
    }

    protected onRoleMyProperty(data: any): void {
        console.log("onRoleMyProperty", data);
        if (data.code == 0) {
            this._isQryMyProperty = true;
            MapUICommand.getInstance().updateMyProperty(data);
            this._cityProxy.initMyCitys(data.msg.citys);
            // this._buildProxy.initMyBuilds(data.msg.mr_builds);
            // this._cityProxy.myId = this._cityProxy.getMyPlayerId();
            // this._buildProxy.myId = this._cityProxy.getMyPlayerId();
            // this._cityProxy.myUnionId = this._cityProxy.getMyMainCity().unionId;
            // this._cityProxy.myParentId = this._cityProxy.getMyMainCity().parentId;
            // this._buildProxy.myUnionId = this._cityProxy.getMyMainCity().unionId;
            // this._buildProxy.myParentId = this._cityProxy.getMyMainCity().parentId;
            MapCommand.getInstance().posTagList();

            this.enterMap();
        }
    }

    protected onRoleBuildStatePush(data: any): void {
        console.log("onRoleBuildStatePush", data);
        if (data.code == 0) {
            this._buildProxy.updateBuild(data.msg);
        }
    }

    protected onNationMapConfig(data: any): void {
        console.log("onNationMapConfig", data);
        if (data.code == 0) {
            this._proxy.setNationMapConfig(data.msg.Confs);
            this.enterMap();
        }
    }

    protected onNationMapGiveUp(data: any, otherData: any): void {
        console.log("onNationMapGiveUp", data, otherData);
    }

    protected onNationMapBuild(data: any, otherData: any): void {
        console.log("onNationMapBuild", data, otherData);
    }

    protected onNationMapUpBuild(data: any, otherData: any): void {
        console.log("onNationMapUpBuild", data, otherData);
    }

    private syncMarks(): void {
        // 新协议只保存坐标，展示名称从当前地图数据推导，不发送旧版 name 字段。
        const names = { 50: '要塞', 51: '城池', 52: '林地', 53: '铁矿', 54: '石料', 55: '粮田' };
        this._proxy.updateMapPosTags(MapMarkCommand.getInstance().marks.values().map(pos => {
            const id = MapUtil.getIdByCellPoint(pos.x, pos.y), city = this._cityProxy.getCity(id), res = this._proxy.getResData(id);
            const name = city?.name || (res && !res.isEmpty && names[res.type]
                ? `${res.level}级${names[res.type]}` : '地图标记');
            return { ...pos, name };
        }));
    }


    protected onRoleCityPush(data: any): void {
        console.log("onRoleCityPush:", data)
        this._buildProxy.updateSub(data.msg.rid, data.msg.union_id, data.msg.parent_id);
        this._cityProxy.updateCity(data.msg);
        EventMgr.emit(LogicEvent.unionChange, data.msg.rid, data.msg.union_id, data.msg.parent_id);

    }

    public isBuildSub(id: number): boolean {
        let buiildData: MapBuildData = this.buildProxy.getBuild(id);
        if (buiildData) {
            if (buiildData.rid == this.buildProxy.myId) {
                return true;
            }

            if (buiildData.unionId > 0 && buiildData.unionId == this.buildProxy.myUnionId) {
                return true
            }

            if (buiildData.parentId > 0 && buiildData.parentId == this.buildProxy.myUnionId) {
                return true
            }
        }
        return false
    }

    public isBuildWarFree(id: number): boolean {
        let buiildData: MapBuildData = this.buildProxy.getBuild(id);
        if (buiildData) {
            return buiildData.isWarFree();
        } else {
            return false;
        }
    }


    public isCitySub(id: number): boolean {
        let cityData: MapCityData = this.cityProxy.getCity(id);
        if (cityData) {
            if (cityData.rid == this.cityProxy.myId) {
                return true
            }

            if (Number(cityData.unionId) > 0 && cityData.unionId == this.cityProxy.myUnionId) {
                return true
            }

            if (cityData.parentId > 0 && cityData.parentId == this.cityProxy.myUnionId) {
                return true
            }
        }
        return false
    }

    public isCityWarFree(id: number): boolean {
        let cityData: MapCityData = this.cityProxy.getCity(id);
        if (cityData && cityData.parentId > 0) {
            var diff = DateUtil.getServerTime() - cityData.occupyTime;
            if (diff < MapCommand.getInstance().proxy.getWarFree()) {
                return true;
            }
        }
        return false
    }


    /** MOVE 的终点是地图坐标，不能沿用旧协议“只能在自有领地驻军”的限制。 */
    public moveTargetIssue(x: number, y: number): string {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0
            || x >= MapUtil.mapSize.width || y >= MapUtil.mapSize.height) return '移动坐标无效';
        const id = MapUtil.getIdByCellPoint(x, y), cell = this.proxy.getResData(id);
        if (this.cityProxy.getCity(id) || this.proxy.getSysCityResData(x, y)) return '城池占地不能作为移动终点';
        if (!cell || !cell.isEmpty && !isResourceLandCell(cell)) return '请选择空地或可通行的资源地';
        return this.campaignBlockReason(x, y, false);
    }

    /**是否是可行军的位置*/
    public isCanMoveCell(x: number, y: number): boolean {
        let id: number = MapUtil.getIdByCellPoint(x, y);
        if (this.isBuildSub(id)) {
            return true
        }

        if (this.isCitySub(id)) {
            return true
        }

        return false
    }

    public campaignReachable(): Set<number> {
        const role = LoginCommand.getInstance().proxy.getRoleData();
        const home = this.cityProxy.getMyMainCity() || role?.cityPos;
        const myId = role?.userId || this.cityProxy.myId;
        const unionId = role?.allianceId ?? this.cityProxy.myUnionId;
        return WorldCampaign.reachable(home ? WorldCampaign.regionAt(home.x, home.y) : -1, gate => {
            const build = this.buildProxy.getBuild(MapUtil.getIdByCellPoint(gate.x, gate.y));
            return !!build && (build.rid > 0 && String(build.rid) === String(myId)
                || unionId && String(unionId) !== '0' && String(build.unionId) === String(unionId));
        });
    }

    public campaignBlockReason(x: number, y: number, attackGate = true): string {
        if (!WorldCampaign.config) return '';
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0
            || x >= MapUtil.mapSize.width || y >= MapUtil.mapSize.height) return '目标坐标无效';
        const res = this.proxy.getResData(MapUtil.getIdByCellPoint(x, y));
        if (!res || res.type === 0 && !res.isEmpty && !this.proxy.getSysCityResData(x, y)
            && !this.cityProxy.getCity(MapUtil.getIdByCellPoint(x, y))) return '山脉和河流不可通行，请寻找关隘或渡口';
        if (!WorldCampaign.canTarget(x, y, this.campaignReachable(), attackGate)) {
            const region = WorldCampaign.config.regions[WorldCampaign.regionAt(x, y)];
            return `尚未打通前往${region?.name || '该州'}的路线，请与同盟先攻占沿途关隘`;
        }
        return '';
    }

    public isCanOccupyCell(x: number, y: number): boolean {
        if (this.campaignBlockReason(x, y)) return false;
        var radius = 0;
        let id: number = MapUtil.getIdByCellPoint(x, y);
        let cityData: MapCityData = this.cityProxy.getCity(id);
        if (cityData) {
            if (this.isCityWarFree(id)) {
                return false;
            }
            radius = cityData.getCellRadius();
        }
        let buildData: MapBuildData = this.buildProxy.getBuild(id);
        if (buildData) {
            if (this.isBuildWarFree(id)) {
                return false;
            }

            // console.log("buildData 11111:", buildData);
            radius = buildData.getCellRadius();
        }

        //查找半径10
        for (let tx = x - 10; tx <= x + 10; tx++) {
            for (let ty = y - 10; ty <= y + 10; ty++) {

                let id: number = MapUtil.getIdByCellPoint(tx, ty);
                let cityData: MapCityData = this.cityProxy.getCity(id);
                if (cityData) {
                    var absX = Math.abs(x - tx);
                    var absY = Math.abs(y - ty);
                    if (absX <= radius + cityData.getCellRadius() + 1 && absY <= radius + cityData.getCellRadius() + 1) {
                        var ok = this.isCitySub(id)
                        if (ok) {
                            return true;
                        }
                    }
                }

                let buildData: MapBuildData = this.buildProxy.getBuild(id);
                if (buildData) {
                    var absX = Math.abs(x - tx);
                    var absY = Math.abs(y - ty);
                    // console.log("MapBuildData:", absX, absY, radius+buildData.getCellRadius()+1, buildData);
                    if (absX <= radius + buildData.getCellRadius() + 1 && absY <= radius + buildData.getCellRadius() + 1) {
                        var ok = this.isBuildSub(id)
                        if (ok) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    public enterMap(): void {
        if (this._proxy.hasResConfig() == false) {
            this.qryNationMapConfig();
            return;
        }
        if (this._isQryMyProperty == false) {
            this.qryRoleMyProperty();
            return;
        }
        EventMgr.emit(LogicEvent.enterMap);
    }

    /**请求角色全量信息*/
    public qryRoleMyProperty(): void {
        let sendData: any = {
            name: ServerConfig.role_myProperty,
            msg: {
            }
        };
        NetManager.getInstance().send(sendData);
    }

    /**请求自己的城池信息*/
    public qryRoleMyCity(): void {
        let sendData: any = {
            name: ServerConfig.role_myCity,
            msg: {}
        };
        NetManager.getInstance().send(sendData);
    }

    /**请求地图基础配置*/
    public qryNationMapConfig(): void {
        let sendData: any = {
            name: ServerConfig.nationMap_config,
            msg: {}
        };
        NetManager.getInstance().send(sendData);
    }

    public giveUpBuild(x: number, y: number): void {
        let sendData: any = {
            name: ServerConfig.nationMap_giveUp,
            msg: {
                x: x,
                y: y
            }
        };
        NetManager.getInstance().send(sendData);
    }

    public build(x: number, y: number, type: number): void {
        let sendData: any = {
            name: ServerConfig.nationMap_build,
            msg: {
                x: x,
                y: y,
                type: type,
            }
        };
        NetManager.getInstance().send(sendData);
    }

    public upBuild(x: number, y: number): void {
        let sendData: any = {
            name: ServerConfig.nationMap_upBuild,
            msg: {
                x: x,
                y: y,
            }
        };
        NetManager.getInstance().send(sendData);
    }

    public delBuild(x: number, y: number): void {
        let sendData: any = {
            name: ServerConfig.nationMap_delBuild,
            msg: {
                x: x,
                y: y,
            }
        };
        NetManager.getInstance().send(sendData);
    }


    public upPosition(x: number, y: number): void {
        let sendData: any = {
            name: ServerConfig.role_upPosition,
            msg: {
                x: x,
                y: y
            }
        };
        // NetManager.getInstance().send(sendData);
    }

    public posTagList(): boolean {
        return MapMarkCommand.getInstance().requestList();
    }

    //1添加、0移除
    public opPosTag(type: number, x: number, y: number, _name = ""): boolean {
        const marks = MapMarkCommand.getInstance();
        return type === 1 ? marks.add({ x, y }) : type === 0 ? marks.remove({ x, y }) : false;
    }

}
