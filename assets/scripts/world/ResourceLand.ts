import ConfigManager from '../core/ConfigManager';

export interface ResourceLandConfig {
    Id: number; Type: number; Level: number; Name: string; Desc: string;
    Capacity: number; GatherSpeed: number; OutputItem: number; MonsterGroups: number[];
    OpenCond?: { level?: number };
}
const MAP_RESOURCE_ENUM: { [type: number]: string } = { 52: 'WOOD', 53: 'IRON', 54: 'STONE', 55: 'GRAIN' };

/** 配置表可能是数组，也可能是以 Id 为键的对象。 */
function configRows(name: string): any[] {
    const table = ConfigManager.getInstance().getConfig(name);
    if (!table) return [];
    return Array.isArray(table) ? table : Object.keys(table).map(key => table[key]);
}

export function isResourceLandCell(cell: { type: number; level: number; isEmpty?: boolean } | null | undefined): boolean {
    return !!cell && !cell.isEmpty && !!MAP_RESOURCE_ENUM[cell.type] && Number.isInteger(cell.level) && cell.level > 0;
}

/** 石料也走配置：补齐ResLandType.STONE与对应ResLand行即可，不猜资源/道具ID。 */
export function resourceTypeForMap(mapType: number): number | undefined {
    const name = MAP_RESOURCE_ENUM[mapType];
    const rows = configRows('ResLandType');
    return name ? rows.find(row => row.Enum === name)?.Id : undefined;
}
export function resourceLandConfig(cfgId: number): ResourceLandConfig | undefined {
    return configRows('ResLand').find(row => row.Id === cfgId);
}
export function resourceLandForCell(type: number, level: number): ResourceLandConfig | undefined {
    const protocolType = resourceTypeForMap(type);
    return configRows('ResLand').find(row => row.Type === protocolType && row.Level === level);
}
