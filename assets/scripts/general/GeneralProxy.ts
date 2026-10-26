
import { SpriteFrame, resources, isValid } from "cc";
import GeneralCommand from "./GeneralCommand";
import { GENERAL_PORTRAIT_DIRECTORY, getGeneralPortraitPath } from './GeneralPortrait';

/**武将(配置)*/
export class GeneralConfig {
    id: number = 0;
    cfgId: number = 0;
    heroId: number = 0;
    name: string = "";
    hero_type: number = 0;
    sort: number = 0;
    desc: string = "";
    quality: number = 0;
    campText: string = "";
    attack: number = 0;
    hp: number = 0;
    heroClass: string = "";
    crit: number = 0;
    skill: string = "";
    skillId: number = 0;

    // 旧战斗逻辑使用的兼容字段
    force: number = 0;
    strategy: number = 0;
    defense: number = 0;
    speed: number = 0;
    destroy: number = 0;
    cost: number = 0;

    force_grow: number = 0;
    strategy_grow: number = 0;
    defense_grow: number = 0;
    speed_grow: number = 0;
    destroy_grow: number = 0;
    physical_power_limit: number = 0;
    cost_physical_power: number = 0;
    probability: number = 0;

    star: number = 0;
    arms: number[] = [];
    camp: number = 0;
    resource: string = "";
    icon: string = "";
}

/**武将等级配置*/
export class GenaralLevelConfig {
    level: number = 0;
    exp: number = 0;
    soldiers: number = 0;
}

/**武将阵营枚举*/
export class GeneralCampType {
    static Han: number = 1;
    static Qun: number = 2;
    static Wei: number = 3;
    static Shu: number = 4;
    static Wu: number = 5;
}

/**武将共有配置*/
export class GeneralCommonConfig {
    physical_power_limit: number = 100;
    cost_physical_power: number = 10;
    recovery_physical_power: number = 10;
    reclamation_time: number = 3600;
    draw_general_cost: number = 0;
}

export class gSkill {
    id: number = 0;
    lv: number = 0;
    cfgId: number = 0;
}

/**武将基础数据类*/
export class GeneralData {
    id: number = 0;
    cfgId: number = 0;
    /** Hero.Id。协议没有独立的武将实例 ID；部队 heroIdx 同样引用此 ID。 */
    heroId: number = 0;
    hero_type: number = 0;  // 旧界面使用的配置 ID 别名
    newTag: boolean = false;
    exp: number = 0;
    level: number = 0;
    order: number = 0;
    star: number = 0;
    state: number = 0;
    parentId: number = 0;  // 归属ID
    cityId: number = 0;

    config: GeneralConfig = new GeneralConfig();
    skills: gSkill[] = [];

    force_added: number = 0;
    strategy_added: number = 0;
    defense_added: number = 0;
    speed_added: number = 0;
    destroy_added: number = 0;
    star_lv: number = 0;
    physical_power: number = 0;
    hasPrPoint: number = 0;
    usePrPoint: number = 0;

    public static getHeroId(data: any): number {
        const value = Number(data?.heroId ?? data?.heroType ?? data?.hero_type ?? data?.cfgId ?? data?.heroIdx ?? data?.id);
        return Number.isInteger(value) && value > 0 ? value : 0;
    }

    public static createFromServer(serverData: any, generalData: GeneralData = null, generalCfg: GeneralConfig): GeneralData {
        let data: GeneralData = generalData || new GeneralData();
        if (!serverData) return data;
        const heroId = GeneralData.getHeroId(serverData);
        data.heroId = heroId;
        data.hero_type = heroId;
        data.id = heroId;
        data.cfgId = heroId;
        data.newTag = serverData.newTag === true;

        data.level = Number(serverData.lv != null ? serverData.lv : (serverData.level != null ? serverData.level : 1));
        data.exp = Number(serverData.exp || 0);
        data.star = Number(serverData.star || 0);
        data.state = Number(serverData.state || 0);
        data.order = Number(serverData.order || 0);
        data.parentId = Number(serverData.parentId != null ? serverData.parentId : (serverData.parent_id || 0));
        data.cityId = Number(serverData.cityId != null ? serverData.cityId : (serverData.city_id || 0));

        data.config = generalCfg || (typeof GeneralCommand !== 'undefined' && GeneralCommand.getInstance() ? GeneralCommand.getInstance().proxy.getGeneralCfg(data.hero_type) : null) || new GeneralConfig();
        data.skills = GeneralData.normalizeSkills(serverData.skillList != null ? serverData.skillList : serverData.skill_list);

        data.force_added = serverData.force_added || 0;
        data.strategy_added = serverData.strategy_added || 0;
        data.defense_added = serverData.defense_added || 0;
        data.speed_added = serverData.speed_added || 0;
        data.destroy_added = serverData.destroy_added || 0;
        data.star_lv = Number(serverData.star_lv != null ? serverData.star_lv : (serverData.starLv || 0));
        data.physical_power = serverData.physical_power || 0;
        data.hasPrPoint = Number(serverData.hasPrPoint != null ? serverData.hasPrPoint : (serverData.has_pr_point || 0));
        data.usePrPoint = Number(serverData.usePrPoint != null ? serverData.usePrPoint : (serverData.use_pr_point || 0));

        return data;
    }

    private static normalizeSkills(rawSkills: any): gSkill[] {
        if (!Array.isArray(rawSkills)) {
            return [];
        }
        return rawSkills.map((item: any) => {
            const skill = new gSkill();
            const skillId = item && typeof item === 'object' ?
                (item.cfgId != null ? item.cfgId : (item.k != null ? item.k : item.id)) : item;
            skill.id = Number(skillId || 0);
            skill.cfgId = Number(skillId || 0);
            skill.lv = Number(item && typeof item === 'object' ?
                (item.lv != null ? item.lv : (item.v != null ? item.v : 1)) : 1);
            return skill;
        }).filter((skill) => skill.cfgId > 0);
    }

    public static getPrStr(base: number, added: number, level: number, grow: number): string {
        let val = (base + added + (level - 1) * grow) / 100;
        return val.toFixed(2);
    }
}

export default class GeneralProxy {
    protected _heroConfigs: Map<string, GeneralConfig> = new Map<string, GeneralConfig>();
    protected _levelConfigs: GenaralLevelConfig[] = [];
    protected _commonConfig: GeneralCommonConfig = new GeneralCommonConfig();
    protected _heroTexs: Map<string, SpriteFrame> = new Map<string, SpriteFrame>();
    private _heroTexLoads = new Map<string, Promise<SpriteFrame | null>>();
    protected _myGenerals: Map<number, GeneralData> = new Map<number, GeneralData>();

    public clearData(): void {
        this._myGenerals.clear();
    }

    public initHeroConfig(heroJson: any, bCost: any): void {
        this._heroConfigs.clear();
        for (let key in heroJson) {
            const data = heroJson[key];
            const cfg = new GeneralConfig();
            cfg.id = Number(data.Id != null ? data.Id : (data.HeroId != null ? data.HeroId : key));
            cfg.cfgId = cfg.id;
            cfg.heroId = Number(data.HeroId != null ? data.HeroId : cfg.id);
            cfg.hero_type = cfg.id;
            cfg.name = data.name;
            cfg.resource = data.Resources;
            cfg.icon = typeof data.Icon === 'string' ? data.Icon.trim() : '';
            cfg.sort = Number(data.Sort || 0);
            cfg.desc = data.Desc || "";
            cfg.quality = Number(data.Quality || 0);
            cfg.campText = data.Camp || "";
            cfg.attack = Number(data.Attack || 0);
            cfg.hp = Number(data.Hp || 0);
            cfg.heroClass = data.Class || "";
            cfg.crit = Number(data.Crit || 0);
            cfg.skill = data.Skill || "";
            cfg.skillId = Number(data.SkillId || 0);

            // 新配置字段映射到旧显示/战斗字段
            cfg.star = Number(data.Star != null ? data.Star : (data.star || 0));
            cfg.defense = Number(data.Defense || 0);
            cfg.speed = Number(data.Speed || 0);
            cfg.force = cfg.attack;
            cfg.camp = this.parseCamp(data.Camp);
            cfg.arms = Array.isArray(data.arms) ? data.arms.map(Number) : [];
            cfg.cost = Number(data.cost || 0);

            if (bCost && bCost.general) {
                cfg.physical_power_limit = bCost.general.physical_power_limit;
                cfg.cost_physical_power = bCost.general.cost_physical_power;
            }

            this._heroConfigs.set(String(cfg.hero_type), cfg);
            if (!cfg.name) {
                console.warn(`GeneralConfig for hero_type ${cfg.hero_type} has no name.`);
            }
        }
        // 协议可能先于配置返回，补齐同一份数据的配置，不能重建后丢失增量同步。
        this._myGenerals.forEach((general) => {
            general.config = this.getGeneralCfg(general.hero_type) || new GeneralConfig();
        });
        console.log("武将配置初始化完成，共加载数量:", this._heroConfigs.size);

        if (bCost && bCost.general) {
            this._commonConfig.physical_power_limit = bCost.general.physical_power_limit;
            this._commonConfig.cost_physical_power = bCost.general.cost_physical_power;
            this._commonConfig.recovery_physical_power = bCost.general.recovery_physical_power;
            this._commonConfig.reclamation_time = bCost.general.reclamation_time;
            this._commonConfig.draw_general_cost = bCost.general.draw_general_cost;
        }
    }

    protected parseCamp(camp: any): number {
        const text = String(camp == null ? "" : camp).trim();
        const campMap: { [key: string]: number } = { "汉": 1, "群": 2, "魏": 3, "蜀": 4, "吴": 5 };
        if (campMap[text] != null) {
            return campMap[text];
        }
        const value = Number(text);
        return isNaN(value) ? 0 : value;
    }

    public initGeneralConfig(cfgs: any, bCost: any): void {
        this.initHeroConfig(cfgs, bCost);
    }

    public initGeneralTex(texs: SpriteFrame[]): void {
        this._heroTexs.clear();
        const nameMap: Map<string, SpriteFrame> = new Map();
        for (let i = 0; i < texs.length; i++) {
            nameMap.set(texs[i].name, texs[i]);
        }

        this._heroConfigs.forEach((cfg) => {
            const path = getGeneralPortraitPath(cfg.icon);
            const prefix = `${GENERAL_PORTRAIT_DIRECTORY}/`;
            if (path.startsWith(prefix)) {
                const resName = path.slice(prefix.length).replace(/\/spriteFrame$/, '');
                if (nameMap.has(resName)) {
                    this._heroTexs.set(String(cfg.hero_type), nameMap.get(resName));
                }
            }
        });
    }

    public updateMyGenerals(datas: any[]): void {
        if (!datas || !Array.isArray(datas)) return;

        for (var i = 0; i < datas.length; i++) {
            const serverItem = datas[i];
            const id = GeneralData.getHeroId(serverItem);
            if (!id) continue;
            let data: GeneralData = GeneralData.createFromServer(serverItem, null, this.getGeneralCfg(id));
            this._myGenerals.set(data.heroId, data);
        }
    }

    public setMyGenerals(datas: any[]): void {
        this._myGenerals.clear();
        this.updateMyGenerals(datas);
    }

    public updateGeneral(data: any) {
        if (!data) {
            return;
        }
        const id = GeneralData.getHeroId(data);
        const state = Number(data.state || 0);
        if (state != 0 && id) {
            this._myGenerals.delete(Number(id));
        } else if (id) {
            let general: GeneralData = GeneralData.createFromServer(data, this._myGenerals.get(Number(id)), this.getGeneralCfg(id));
            this._myGenerals.set(general.heroId, general);
        }
    }

    public getGeneralCfg(hero_type: any): GeneralConfig {
        return this._heroConfigs.get(String(hero_type));
    }

    public getGeneralLevelCfg(level: number): GenaralLevelConfig {
        if (level > 0 && level <= this._levelConfigs.length) {
            return this._levelConfigs[level - 1];
        }
        return null;
    }

    public getMaxLevel(): number {
        return this._levelConfigs.length || 50; // 默认最大50级
    }

    public getGeneralAllCfg(): Map<string, GeneralConfig> {
        return this._heroConfigs;
    }

    public getMyGenerals(): GeneralData[] {
        return Array.from(this._myGenerals.values());
    }

    public getMyGeneral(hero_type: number): GeneralData {
        return this._myGenerals.get(hero_type) || null;
    }

    public getMyActiveGeneralCnt(): number {
        return this._myGenerals.size;
    }

    public getUseGenerals(): GeneralData[] {
        let list = this.getMyGenerals();
        list.sort((a, b) => {
            const starDiff = (b.config ? b.config.star : b.star) - (a.config ? a.config.star : a.star);
            if (starDiff != 0) return starDiff;
            const sortDiff = (a.config ? a.config.sort : 0) - (b.config ? b.config.sort : 0);
            if (sortDiff != 0) return sortDiff;
            if (b.level != a.level) return b.level - a.level;
            return a.hero_type - b.hero_type;
        });
        return list;
    }

    public getMyGeneralsNotUse(): GeneralData[] {
        return this.getMyGenerals();
    }

    public getGeneralIds(hero_type: number): number[] {
        return this._myGenerals.has(Number(hero_type)) ? [Number(hero_type)] : [];
    }

    public removeMyGenerals(ids: number[]): void {
        if (!Array.isArray(ids)) {
            return;
        }
        ids.forEach((id) => this._myGenerals.delete(Number(id)));
    }

    /**武将头像素材*/
    public getGeneralTex(hero_type: any): SpriteFrame {
        return this._heroTexs.get(String(hero_type)) || null;
    }

    public setGeneralTex(hero_type: any, frame: SpriteFrame) {
        this._heroTexs.set(String(hero_type), frame);
    }

    /** 加载页与卡片共用缓存和在途请求。失败不缓存，后续打开界面可以重试。 */
    public loadGeneralTex(heroId: number | string): Promise<SpriteFrame | null> {
        const cached = this.getGeneralTex(heroId);
        if (cached && isValid(cached)) return Promise.resolve(cached);
        const config = this.getGeneralCfg(heroId);
        const path = getGeneralPortraitPath(config && config.icon);
        if (!path) {
            console.warn('武将未配置 Icon:', heroId);
            return Promise.resolve(null);
        }
        const pending = this._heroTexLoads.get(path);
        if (pending) return pending;
        const request = new Promise<SpriteFrame | null>((resolve) => {
            const timer = setTimeout(() => {
                console.warn('武将画像等待超时:', path);
                resolve(null);
            }, 8000);
            resources.load(path, SpriteFrame, (error, frame) => {
                clearTimeout(timer);
                if (error || !(frame instanceof SpriteFrame)) {
                    console.warn('武将画像加载失败:', path, error ? error.message : '资源不是 SpriteFrame');
                    resolve(null);
                    return;
                }
                this.setGeneralTex(heroId, frame);
                resolve(frame);
            });
        });
        this._heroTexLoads.set(path, request);
        request.then(() => this._heroTexLoads.delete(path));
        return request;
    }

    public async preloadMyPortraits(isCurrent: () => boolean): Promise<void> {
        const generals = this.getUseGenerals();
        let index = 0;
        const worker = async () => {
            while (isCurrent() && index < generals.length) {
                const general = generals[index++];
                await this.loadGeneralTex(general.hero_type);
            }
        };
        // 限制并发，避免 full_hero 时把解码和纹理创建集中在同一帧。
        await Promise.all(Array.from({ length: Math.min(4, generals.length) }, worker));
    }
}
