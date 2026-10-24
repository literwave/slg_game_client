import BuildCommand from '../../build/BuildCommand';
import BattleCommand from '../../battle/BattleCommand';
import { _decorator } from 'cc';
import { ServerConfig } from "../../config/ServerConfig";
import LoginCommand from "../../login/LoginCommand";
import { NetManager } from "../../network/socket/NetManager";
import { MapCityData } from "../MapCityProxy";
import MapCommand from "../MapCommand";
import MapUIProxy, { CityAddition, Facility } from "./MapUIProxy";
import { EventMgr } from '../../utils/EventMgr';
import { LogicEvent } from '../../common/LogicEvent';

export default class MapUICommand {
    //单例
    protected static _instance: MapUICommand;
    public static getInstance(): MapUICommand {
        if (this._instance == null) {
            this._instance = new MapUICommand();
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
    protected _proxy: MapUIProxy = new MapUIProxy();

    constructor() {


        EventMgr.on(ServerConfig.role_myRoleRes, this.onRoleMyRoleRes, this);



        EventMgr.on(ServerConfig.interior_collect, this.onCollect, this);
        EventMgr.on(ServerConfig.interior_openCollect, this.onOpenCollect, this);

        EventMgr.on(ServerConfig.roleRes_push, this.updataRoleRes, this);
        

        EventMgr.on(LogicEvent.updateCityBuilds, this.onBuildChanged, this);
    }

    private onBuildChanged(data: { bid: number; level: number }): void {
        const city = MapCommand.getInstance().cityProxy.getMyMainCity();
        const cityId = city?.cityId || 0;
        this.qryCityFacilities(cityId);
        const facility = this._proxy.getMyFacilityByType(cityId, data.bid);
        if (facility) EventMgr.emit(LogicEvent.updateMyFacility, cityId, facility);
    }

    protected onCityFacilities(data: any): void {
        console.log("onCityFacilities :", data);
        if (data.code == 0) {
            this._proxy.updateMyFacilityList(data.msg.cityId, data.msg.facilities);
            EventMgr.emit(LogicEvent.updateMyFacilities);

            //刷新城池附加加成
            let cityData: MapCityData = MapCommand.getInstance().cityProxy.getMyCityById(data.msg.cityId);
            let addition: CityAddition = this._proxy.updateMyCityAdditions(cityData.cityId);
            cityData.maxDurable = this._proxy.getMyCityMaxDurable(data.msg.cityId);
            EventMgr.emit(LogicEvent.updateCityAddition, data.msg.cityId, addition);
        }
    }


    protected onCityUpFacility(data: any): void {
        console.log("onCityUpFacility :", data);
        if (data.code == 0) {
            let facilityData: Facility = this._proxy.updateMyFacility(data.msg.cityId, data.msg.facility);
            EventMgr.emit(LogicEvent.updateMyFacility, data.msg.cityId, facilityData);
            LoginCommand.getInstance().proxy.saveEnterData(data.msg);
            EventMgr.emit(LogicEvent.upateMyRoleRes);

            //刷新城池附加加成
            let cityData: MapCityData = MapCommand.getInstance().cityProxy.getMyCityById(data.msg.cityId);
            let addition: CityAddition = this._proxy.updateMyCityAdditions(data.msg.cityId);
            cityData.maxDurable = this._proxy.getMyCityMaxDurable(data.msg.cityId);
            EventMgr.emit(LogicEvent.updateCityAddition, data.msg.cityId, addition);
        }
    }


    protected onRoleMyRoleRes(data: any): void {
        console.log("onRoleMyProperty :", data);
        if (data.code == 0) {
            LoginCommand.getInstance().proxy.saveEnterData(data.msg);
            EventMgr.emit(LogicEvent.upateMyRoleRes);
        }
    }


    protected updataRoleRes(data: any): void {
        if (data.code == 0) {
            LoginCommand.getInstance().proxy.setRoleResData(data.msg);
            EventMgr.emit(LogicEvent.upateMyRoleRes);
        }
    }


    protected onUpdataWarReports(data: any): void {
        console.log("onUpdataWarReport :", data);
        if (data.code == 0) {
            this._proxy.updateWarReports(data.msg);
            EventMgr.emit(LogicEvent.upateWarReport);
        }
    }



    protected onUpdataWarReport(data: any): void {
        console.log("onUpdataWarReport :", data);
        if (data.code == 0) {
            this._proxy.updateWarReport(data.msg);
            EventMgr.emit(LogicEvent.upateWarReport);
        }
    }

    protected onUpdataWarRead(data: any): void {
        console.log("onUpdataWarRead :", data);
        if (data.code == 0) {
            var id = data.msg.id;
            if (id == 0) {
                this._proxy.updateAllWarRead(true);
            }else{
                this._proxy.updateWarRead(id, true);
            }
           
            EventMgr.emit(LogicEvent.upateWarReport);
        }
    }

    protected onCollect(data:any):void {
        console.log("onCollect :", data);
        if (data.code == 0) {
            EventMgr.emit(LogicEvent.interiorCollect, data.msg);
        }
    }

    protected onOpenCollect(data:any):void{
        console.log("onOpenCollect :", data);
        if (data.code == 0) {
            EventMgr.emit(LogicEvent.interiorOpenCollect, data.msg);
        }
    }

    public onDestory(): void {
        EventMgr.targetOff(this);
    }

    public get proxy(): MapUIProxy {
        return this._proxy;
    }


    /**
     * 设施
     * @param cityId 
     */
    public qryCityFacilities(cityId: number = 0): void {
        const main = MapCommand.getInstance().cityProxy.getMyMainCity();
        if (cityId && main && cityId !== main.cityId) return;
        const levels = BuildCommand.getInstance().levels;
        const configs = this._proxy.getFacilityConfigs();
        const facilities = configs.map(cfg => ({ type: cfg.type, level: levels.get(cfg.type) || 0, up_time: 0 }));
        this._proxy.updateMyFacilityList(cityId, facilities);
        const addition = this._proxy.updateMyCityAdditions(cityId);
        EventMgr.emit(LogicEvent.updateMyFacilities);
        EventMgr.emit(LogicEvent.updateCityAddition, cityId, addition);
    }


    /**
     * 升级设施
     * @param cityId 
     * @param ftype 
     */
    public upFacility(cityId: number = 0, ftype: number = 0): void {
        const main = MapCommand.getInstance().cityProxy.getMyMainCity();
        if (!main || cityId && cityId !== main.cityId || !this._proxy.getFacilityCfgByType(ftype)) return;
        const build = BuildCommand.getInstance();
        const sent = (build.levels.get(ftype) || 0) > 0 ? build.upgrade(ftype) : build.create(ftype);
        if (!sent) EventMgr.emit(LogicEvent.showToast, '建造请求未发送，请检查连接或稍后重试');
    }

    /**
     * 我的角色资源属性
     * @param cityId 
     */
    public qryMyRoleRes(): void {
        let sendData: any = {
            name: ServerConfig.role_myRoleRes,
            msg: {
            }
        };
        NetManager.getInstance().send(sendData);
    }


    /**
     * 我的角色资源属性(全)
     * @param 
     */
    public updateMyProperty(data: any): void {
        EventMgr.emit(LogicEvent.upateMyRoleRes);
    }



    /**
     * 战报查询
     */
    public qryWarReport(): void {
        BattleCommand.getInstance().requestReports();
    }



    /**
     * 读取
     */
    public warRead(id: number | string = 0): void {
        BattleCommand.getInstance().readReports(String(id) === '0' ? [] : [id]);
    }

    public interiorCollect(): void {
        let sendData: any = {
            name: ServerConfig.interior_collect,
            msg: {
            }
        };
        NetManager.getInstance().send(sendData);
    }

    public interiorOpenCollect(): void {
        let sendData: any = {
            name: ServerConfig.interior_openCollect,
            msg: {
            }
        };
        NetManager.getInstance().send(sendData);
    }
    
    public interiorTransform(from:number[],to:number[]): void {
        let sendData: any = {
            name: ServerConfig.interior_transform,
            msg: {
                from:from,
                to:to
            }
        };
        NetManager.getInstance().send(sendData);
    }

}
