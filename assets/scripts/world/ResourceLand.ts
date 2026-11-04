import ConfigManager from '../core/ConfigManager';
import { ResLandTypeEnum } from '../config/enum/ResLandTypeEnum';

export interface ResourceLandConfig {
    Id: number; Type: number; Level: number; Name: string; Desc: string;
    Capacity: number; GatherSpeed: number; OutputItem: number; MonsterGroups: number[];
    OpenCond?: { level?: number };
}
const MAP_RESOURCE_TYPE: { [type: number]: ResLandTypeEnum } = {
    52: ResLandTypeEnum.WOOD, 53: ResLandTypeEnum.IRON,
    54: ResLandTypeEnum.STONE, 55: ResLandTypeEnum.GRAIN,
};

/** 配置表可能是数组，也可能是以 Id 为键的对象。 */
function configRows(name: string): any[] {
    const table = ConfigManager.getInstance().getConfig(name);
    if (!table) return [];
    return Array.isArray(table) ? table : Object.keys(table).map(key => table[key]);
}

export function isResourceLandCell(cell: { type: number; level: number; isEmpty?: boolean } | null | undefined): boolean {
    return !!cell && !cell.isEmpty && !!MAP_RESOURCE_TYPE[cell.type] && Number.isInteger(cell.level) && cell.level > 0;
}

/** 类型取自公共库生成的枚举，仍须存在对应资源类型配置。 */
export function resourceTypeForMap(mapType: number): number | undefined {
    const type = MAP_RESOURCE_TYPE[mapType];
    const rows = configRows('ResLandType');
    return type ? rows.find(row => row.Id === type)?.Id : undefined;
}
export function resourceLandConfig(cfgId: number): ResourceLandConfig | undefined {
    return configRows('ResLand').find(row => row.Id === cfgId);
}
export function resourceLandForCell(type: number, level: number): ResourceLandConfig | undefined {
    const protocolType = resourceTypeForMap(type);
    return configRows('ResLand').find(row => row.Type === protocolType && row.Level === level);
}
