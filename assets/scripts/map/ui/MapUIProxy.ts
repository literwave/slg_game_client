import { _decorator } from 'cc';
import { Basic, Build, Conscript, General } from "../../config/Basci";
import DateUtil from "../../utils/DateUtil";
import MapUICommand from "./MapUICommand";

export class CityAddition {
    cost: number = 0;
    armyCnt: number = 0;//军队数量
    vanguardCnt: 0;//军队前锋数量 默认每队只有两个位置 前锋数量影响第三个位置的开启
    soldierCnt: 0;//带兵数加成
    han: number = 0;//汉阵营加成
    qun: number = 0;//群阵营加成
    wei: number = 0;//魏阵营加成
    shu: number = 0;//蜀阵营加成
    wu: number = 0;//吴阵营加成
    taxRate: number = 0;//交换的税率
    durable: number = 0;//耐久


    public clear(): void {
        this.cost = 0;
        this.armyCnt = 0;
        this.vanguardCnt = 0;
        this.soldierCnt = 0;
        this.han = 0;
        this.qun = 0;
        this.wei = 0;
        this.shu = 0;
        this.wu = 0;
        this.durable = 0;
    }
};

/**城池加成类型*/
export class CityAdditionType {
    static Durable: number = 1;//耐久
    static Cost: number = 2;
    static ArmyTeams: number = 3;//队伍数量
    static Speed: number = 4;//速度
    static Defense: number = 5;//防御
    static Strategy: number = 6;	//谋略
    static Force: number = 7;	//攻击武力
    static ConscriptTime: number = 8;//征兵时间
    static ReserveLimit: number = 9;//预备役上限
    static Unkonw: number = 10;
    static HanAddition: number = 11;
    static QunAddition: number = 12;
    static WeiAddition: number = 13;
    static ShuAddition: number = 14;
    static WuAddition: number = 15;
    static DealTaxRate: number = 16;//交易税率
    static Wood: number = 17;
    static Iron: number = 18;
    static Grain: number = 19;
    static Stone: number = 20;
    static Tax: number = 21;//税收
    static ExtendTimes: number = 22;//扩建次数
    static WarehouseLimit: number = 23;//仓库容量
    static SoldierLimit: number = 24;//带兵数量
    static VanguardLimit: number = 25;//前锋数量
}

/**设施*/
export class Facility {
    level: number = 0;
    synced: boolean = true;
    type: number = 0;
    upTime: number = 0;  //升级的时间，0为该等级已经升级成功

    public isUping(): boolean {
        return this.upLastTime() > 0
    }

    public isNeedUpdateLevel(): boolean {
        return this.upLastTime() < 0
    }

    public upLastTime(): number {
        if (this.upTime > 0) {
            let cfg: FacilityConfig = MapUICommand.getInstance().proxy.getFacilityCfgByType(this.type);
            var costTime = cfg.upLevels[this.level].time;
            return DateUtil.leftTime((this.upTime + costTime) * 1000);
        } else {
            return 0;
        }
    }
}

/**设施(配置)*/
export class FacilityConfig {
    name: string = "";
    icon: string = "";
    type: number = 0;
    category: number = 0;
    des: string = "";
    additions: number[] = [];
    conditions: FacilityOpenCondition[] = [];
    upLevels: FacilityUpLevel[] = [];
}

/**设施加成类型配置*/
export class FacilityAdditionCfg {
    type: number = 0;
    des: string = "";
    value: string = "";
}

/**设施开启条件配置*/
export class FacilityOpenCondition {
    type: number = 0;
    level: number = 0;
}

/**设施升级配置*/
export class FacilityUpLevel {
    conditions: FacilityOpenCondition[] = [];
    level: number = 0;
    values: number[] = [];
    wood: number = 0;
    iron: number = 0;
    stone: number = 0;
    grain: number = 0;
    decree: number = 0;
    time: number = 0;
}

export class BasicGeneral {
    limit: number = 0;
}


export default class MapUIProxy {
    protected _myFacility: Map<number, Map<number, Facility>> = new Map<number, Map<number, Facility>>();//城市设施
    protected _facilityCfg: Map<number, FacilityConfig> = new Map<number, FacilityConfig>();//设施配置
    protected _facilityAdditionCfg: Map<number, FacilityAdditionCfg> = new Map<number, FacilityAdditionCfg>();//升级加成配置
    protected _additions: Map<number, CityAddition> = new Map<number, CityAddition>();
    protected _basic: Basic = new Basic();

    public clearData(): void {
        this._myFacility.clear();
        this._additions.clear();
    }

    /**
     * 当前城市的设施
     * @param data 
     */
    public updateMyFacilityList(cityId: number, datas: any[]): void {
        let list: Map<number, Facility> = new Map<number, Facility>();
        this._myFacility.set(cityId, list);
        for (var i = 0; i < datas.length; i++) {
            var obj = new Facility();
            obj.level = datas[i].level;
            obj.synced = datas[i].synced !== false;
            obj.type = datas[i].type;
            obj.upTime = datas[i].up_time;
            list.set(obj.type, obj);
        }


    }

    public updateMyFacility(cityId: number, data: any): Facility {
        if (this._myFacility.has(cityId)) {
            let list: Map<number, Facility> = this._myFacility.get(cityId);
            let facilityData: Facility = list.get(data.type);
            if (facilityData == null) {
                facilityData = new Facility();
                list.set(data.type, facilityData);
            }
            facilityData.level = data.level;
            facilityData.type = data.type;
            facilityData.upTime = data.up_time;
            return facilityData;
        }
        return null;
    }

    /**更新设施加成数据*/
    public updateMyCityAdditions(cityId: number): CityAddition {
        if (this._myFacility.has(cityId)) {
            let addition: CityAddition = null;
            if (this._additions.has(cityId)) {
                addition = this._additions.get(cityId);
            } else {
                addition = new CityAddition();
                this._additions.set(cityId, addition);
            }
            addition.clear();//清除旧数据 重新计算
            let list: Map<number, Facility> = this._myFacility.get(cityId);
            list.forEach((data: Facility, type: number) => {
                if (data.level > 0) {
                    let cfg: FacilityConfig = this.getFacilityCfgByType(data.type);
                    if (cfg) {
                        let addValue: number = 0;
                        let index: number = -1;
                        index = cfg.additions.indexOf(CityAdditionType.ArmyTeams);
                        if (index != -1) {
                            //军队数量加成
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.armyCnt += addValue;
                        }
                        index = cfg.additions.indexOf(CityAdditionType.Cost);
                        if (index != -1) {
                            //cost加成
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.cost += addValue;
                        }
                        index = cfg.additions.indexOf(CityAdditionType.SoldierLimit);
                        if (index != -1) {
                            //带兵数加成
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.soldierCnt += addValue;
                        }
                        index = cfg.additions.indexOf(CityAdditionType.VanguardLimit);
                        if (index != -1) {
                            //带兵数加成
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.vanguardCnt += addValue;
                        }
                        index = cfg.additions.indexOf(CityAdditionType.HanAddition);
                        if (index != -1) {
                            //汉阵营加成
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.han += addValue;
                        }
                        index = cfg.additions.indexOf(CityAdditionType.QunAddition);
                        if (index != -1) {
                            //群阵营加成
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.qun += addValue;
                        }
                        index = cfg.additions.indexOf(CityAdditionType.WeiAddition);
                        if (index != -1) {
                            //魏阵营加成
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.wei += addValue;
                        }
                        index = cfg.additions.indexOf(CityAdditionType.ShuAddition);
                        if (index != -1) {
                            //蜀阵营加成
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.shu += addValue;
                        }
                        index = cfg.additions.indexOf(CityAdditionType.WuAddition);
                        if (index != -1) {
                            //吴阵营加成
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.wu += addValue;
                        }

                        index = cfg.additions.indexOf(CityAdditionType.DealTaxRate);
                        if (index != -1) {
                            //交易税收
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.taxRate += addValue;
                        }

                        index = cfg.additions.indexOf(CityAdditionType.Durable);
                        if (index != -1) {
                            //console.log("CityAdditionType.Durable:", cfg.upLevels, addValue, index);
                            //耐久
                            addValue = cfg.upLevels[data.level - 1].values[index];
                            addition.durable += addValue;
                        }
                    }
                }
            });

            return addition;
        }
        return null;
    }

    /**
     * 获取当前拥有的设施
     * @param cityId 
     */
    public getMyFacilitys(cityId: number = 0): Map<number, Facility> {
        return this._myFacility.get(cityId);
    }

    public getMyAllFacilitys(): Map<number, Map<number, Facility>> {
        return this._myFacility;
    }

    /**获取指定的设施数据*/
    public getMyFacilityByType(cityId: number = 0, type: number = 0): Facility {
        if (this._myFacility.has(cityId)) {
            let list: Map<number, Facility> = this._myFacility.get(cityId);
            if (list.has(type)) {
                return list.get(type);
            }
        }
        return null;
    }

    /**获取城池的加成数据*/
    public getMyCityAddition(cityId: number): CityAddition {
        let addition: CityAddition = null;
        if (this._additions.has(cityId)) {
            addition = this._additions.get(cityId);
        } else {
            addition = new CityAddition();
            this._additions.set(cityId, addition);
        }
        return addition;
    }

    public getMyCityCost(cityId: number): number {
        let addition = this.getMyCityAddition(cityId);
        return addition.cost + this._basic.city.cost;
    }

    //最大耐久
    public getMyCityMaxDurable(cityId: number): number {
        let addition = this.getMyCityAddition(cityId);
        return addition.durable + this._basic.city.durable;
    }

    public getTransformRate(): number {
        return this._basic.city.transform_rate
    }

    /**
     * 全部设施配置
     * @param jsonAsset 
     */
    public getFacilityConfigs(): FacilityConfig[] { return Array.from(this._facilityCfg.values()); }

    public setAllFacilityCfg(jsonAssets: any[]): void {
        this._facilityCfg = new Map();

        let mainJson: any = null;//设施类型配置
        let additionJson: any = null;//升级类型配置
        let otherJsons: any[] = [];//具体升级配置

        for (let i: number = 0; i < jsonAssets.length; i++) {
            let assetName = jsonAssets[i].name || jsonAssets[i]._name;
            if (assetName == "facility" || assetName == "BuildingDetail") {
                mainJson = jsonAssets[i].json;
            } else if (assetName == "facility_addition" || assetName == "BuildingLv") {
                additionJson = jsonAssets[i].json;
            } else {
                otherJsons.push(jsonAssets[i].json);
            }
        }

        if (Array.isArray(mainJson) && Array.isArray(additionJson)) {
            this._facilityAdditionCfg.clear();
            for (const row of mainJson) {
                const cfg = new FacilityConfig();
                cfg.type = row.Id; cfg.category = row.Type; cfg.name = row.Name; cfg.des = row.Desc; cfg.icon = row.Icon || '';
                cfg.conditions = (row.CreateLimit || []).map(pair => ({ type: pair.bid, level: pair.lev }));
                for (const level of additionJson.filter(r => r.BuildingType === row.Id)) {
                    const up = new FacilityUpLevel();
                    Object.assign(up, { level: level.Lv, grain: level.CostGrain, wood: level.CostWood, iron: level.CostIron, stone: level.CostStone || 0,
                        conditions: (level.UpgradeLimit || []).map(pair => ({ type: pair.bid, level: pair.lev })) });
                    cfg.upLevels[level.Lv - 1] = up;
                }
                this._facilityCfg.set(cfg.type, cfg);
            }
            return;
        }

        if (mainJson != null && additionJson != null) {
            //主配置存在才处理配置文件
            this._facilityCfg.clear();
            for (let i: number = 0; i < mainJson.list.length; i++) {
                let cfgData: FacilityConfig = new FacilityConfig();
                cfgData.type = mainJson.list[i].type;
                cfgData.name = mainJson.list[i].name;
                this._facilityCfg.set(cfgData.type, cfgData);
            }

            this._facilityAdditionCfg.clear();
            for (let i: number = 0; i < additionJson.list.length; i++) {
                let cfgData: FacilityAdditionCfg = new FacilityAdditionCfg();
                cfgData.type = additionJson.list[i].type;
                cfgData.des = additionJson.list[i].des;
                cfgData.value = additionJson.list[i].value;
                this._facilityAdditionCfg.set(cfgData.type, cfgData);
            }

            let jsonList: any[] = [];
            for (let i: number = 0; i < otherJsons.length; i++) {
                this.getFacilityUpLevelJsonList(otherJsons[i], jsonList);
            }


            for (let i: number = 0; i < jsonList.length; i++) {
                let type: number = jsonList[i].type;
                let cfgData: FacilityConfig = this._facilityCfg.get(type);
                if (cfgData) {
                    //存在主配置 才加入升级配置
                    cfgData.des = jsonList[i].des;
                    cfgData.additions = jsonList[i].additions;
                    cfgData.conditions = [];
                    for (let j: number = 0; j < jsonList[i].conditions.length; j++) {
                        let conditionData: FacilityOpenCondition = new FacilityOpenCondition();
                        conditionData.type = jsonList[i].conditions[j].type;
                        conditionData.level = jsonList[i].conditions[j].level;
                        cfgData.conditions.push(conditionData);
                    }

                    cfgData.upLevels.length = jsonList[i].levels.length;
                    for (let k: number = 0; k < jsonList[i].levels.length; k++) {
                        let upLevelData: FacilityUpLevel = new FacilityUpLevel();
                        upLevelData.level = jsonList[i].levels[k].level;
                        upLevelData.values = jsonList[i].levels[k].values;
                        upLevelData.wood = jsonList[i].levels[k].need.wood;
                        upLevelData.iron = jsonList[i].levels[k].need.iron;
                        upLevelData.grain = jsonList[i].levels[k].need.grain;
                        upLevelData.wood = jsonList[i].levels[k].need.wood;
                        upLevelData.stone = jsonList[i].levels[k].need.stone;
                        upLevelData.time = jsonList[i].levels[k].time;
                        cfgData.upLevels[upLevelData.level - 1] = upLevelData;

                        //console.log("upLevelData:", upLevelData)
                    }
                }
            }
        }
        //        this._facilityCfg.forEach((value: FacilityConfig, key: number) => {
        //            console.log("this._facilityCfg", key, value);
        //        });
    }

    protected getFacilityUpLevelJsonList(data: any, list: any[]): void {
        if (typeof (data) == "string" || typeof (data) == "number") {
            return;
        }
        if (data.type != undefined && data.additions != undefined) {
            //代表是需要的数据
            list.push(data);
        } else {
            //代表有多条数据在更里层
            for (let key in data) {
                this.getFacilityUpLevelJsonList(data[key], list);
            }
        }
    }

    public getFacilityCfgByType(type: number = 0): FacilityConfig {
        return this._facilityCfg.get(type);
    }

    public getFacilityAdditionCfgByType(type: number = 0): FacilityAdditionCfg {
        return this._facilityAdditionCfg.get(type);
    }

    /**设施是否解锁*/
    public isFacilityUnlock(cityId: number, type: number): boolean {
        let isUnlock: boolean = true;
        let cfg: FacilityConfig = this.getFacilityCfgByType(type);
        for (let i: number = 0; i < cfg.conditions.length; i++) {
            let data: Facility = this.getMyFacilityByType(cityId, cfg.conditions[i].type);
            if (data && data.level < cfg.conditions[i].level) {
                isUnlock = false;
                break;
            }
        }
        return isUnlock;
    }

    public setBasic(data: any): void {
        this._basic = (data && data.json) ? data.json : new Basic();
    }


    public getConscriptBaseCost(): Conscript {
        return this._basic.conscript;
    }

    public getDefenseSoldiers(level: number): number {
        return Number(this._basic?.npc?.levels?.[level - 1]?.soilders) || 0;
    }

    public getBasicGeneral(): General {
        return this._basic.general;
    }

    public getBasicBuild(): Build {
        return this._basic.build;
    }


}
