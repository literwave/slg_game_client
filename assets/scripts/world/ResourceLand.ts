import ConfigManager from '../core/ConfigManager';

export interface ResourceLandConfig {
    Id: number; Type: number; Level: number; Name: string; Desc: string;
    Capacity: number; GatherSpeed: number; OutputItem: number; MonsterGroups: number[];
    OpenCond?: { level?: number };
}
const MAP_RESOURCE_ENUM: { [type: number]: string } = { 52: 'WOOD', 53: 'IRON', 54: 'STONE', 55: 'GRAIN' };

export function isResourceLandCell(cell: { type: number; level: number; isEmpty?: boolean } | null | undefined): boolean {
    return !!cell && !cell.isEmpty && !!MAP_RESOURCE_ENUM[cell.type] && Number.isInteger(cell.level) && cell.level > 0;
}

/** 石料也走配置：补齐ResLandType.STONE与对应ResLand行即可，不猜资源/道具ID。 */
export function resourceTypeForMap(mapType: number): number | undefined {
    const name = MAP_RESOURCE_ENUM[mapType];
    const rows = ConfigManager.getInstance().getConfig('ResLandType') || [];
    return name ? rows.find(row => row.Enum === name)?.Id : undefined;
}
export function resourceLandConfig(cfgId: number): ResourceLandConfig | undefined {
    return (ConfigManager.getInstance().getConfig('ResLand') || []).find(row => row.Id === cfgId);
}
export function resourceLandForCell(type: number, level: number): ResourceLandConfig | undefined {
    const protocolType = resourceTypeForMap(type);
    return (ConfigManager.getInstance().getConfig('ResLand') || []).find(row => row.Type === protocolType && row.Level === level);
}
