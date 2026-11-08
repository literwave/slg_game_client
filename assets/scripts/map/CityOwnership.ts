import { hasId, idKey } from '../network/pto/ProtocolCommand';
import type { AllianceCityInfo } from '../world/CityCommand';

export type CityRelation = 'unknown' | 'neutral' | 'mine' | 'other';
export interface CityOwner {
    relation: CityRelation;
    allianceId: string;
    name: string;
    mark: string;
    occupied: boolean;
}

/** 地图与侧栏共用城池协议的归属。未回包不等于中立，64 位 ID 不转 Number。 */
export function resolveCityOwner(city: AllianceCityInfo | undefined, myAllianceId: number | string): CityOwner {
    if (!city) return { relation: 'unknown', allianceId: '', name: '', mark: '', occupied: false };
    if (!hasId(city.allianceId)) return { relation: 'neutral', allianceId: '0', name: '中立', mark: '', occupied: false };
    const mine = hasId(myAllianceId) && idKey(myAllianceId) === idKey(city.allianceId);
    const name = (city.allianceName || '').trim() || (mine ? '本盟' : '其他同盟');
    return { relation: mine ? 'mine' : 'other', allianceId: idKey(city.allianceId),
        name, mark: Array.from(name)[0], occupied: true };
}

/** 只在确认占领的推送上播放一次；列表/重连快照只恢复静态归属。 */
export class CityCaptureCue {
    private ownerId = '';
    private played = false;
    sync(owner: CityOwner): void {
        if (owner.allianceId !== this.ownerId) { this.ownerId = owner.allianceId; this.played = false; }
    }
    take(owner: CityOwner, announcedAllianceId: number | string): boolean {
        this.sync(owner);
        if (!owner.occupied || this.played || idKey(announcedAllianceId) !== owner.allianceId) return false;
        this.played = true;
        return true;
    }
    clear(): void { this.ownerId = ''; this.played = false; }
}
