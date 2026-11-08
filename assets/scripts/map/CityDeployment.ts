import type { AllianceCityInfo } from '../world/CityCommand';
import type { MarchInfo, WorldEntity } from '../world/WorldCommand';
import { TargetTypeEnum } from '../config/enum/TargetTypeEnum';
import { TroopStateEnum } from '../config/enum/TroopStateEnum';
import { hasId, idKey } from '../network/pto/ProtocolCommand';

/** 入城驻留必须以服务端 ARRIVED/STAY 为准，不因本地倒计时结束隐藏行军部队。 */
export function deployedMarchCity(march: MarchInfo | undefined, cities: Map<string, AllianceCityInfo>): AllianceCityInfo | undefined {
    if (!march || march.state !== 2 || march.targetType !== TargetTypeEnum.REDEPLOY
        || (march.troopState !== undefined && march.troopState !== TroopStateEnum.STAY)) return;
    const city = cities.get(idKey(march.targetId));
    return city && hasId(city.allianceId) ? city : undefined;
}

export function deployedEntityCity(entity: WorldEntity, cities: Map<string, AllianceCityInfo>, march?: MarchInfo): AllianceCityInfo | undefined {
    // 本人新出征快照可能比 AOI 先到；此时不能继续沿用旧的入城状态。
    if (march) return deployedMarchCity(march, cities);
    if (entity.entityType !== 2 || entity.troopState !== TroopStateEnum.STAY || entity.path?.length >= 2) return;
    const city = hasId(entity.targetId) ? cities.get(idKey(entity.targetId))
        : Array.from(cities.values()).find(c => c.pos?.x === entity.pos?.x && c.pos?.y === entity.pos?.y);
    return city && hasId(city.allianceId) ? city : undefined;
}

export function cityDeploymentCount(city: AllianceCityInfo | undefined): number {
    const count = Number(city?.deployCount);
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function ownCityDeployments(cityId: number | string, marches: MarchInfo[], cities: Map<string, AllianceCityInfo>): MarchInfo[] {
    if (!hasId(cityId)) return [];
    return marches.filter(march => idKey(deployedMarchCity(march, cities)?.entityId) === idKey(cityId))
        .sort((a, b) => a.troopIdx - b.troopIdx);
}
