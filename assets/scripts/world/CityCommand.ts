import ProtocolCommand, { hasId, idKey } from '../network/pto/ProtocolCommand';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';

export interface AllianceCityInfo {
    entityId: number | string; cityType: number; level: number; pos: { x: number; y: number };
    allianceId: number | string; allianceName: string;
    durability: number; durabilityMax: number; teamLeft: number; teamCount: number; deployCount?: number;
}
export interface CityRankInfo {
    rank: number; uid: number | string; name: string;
    allianceId: number | string; allianceName: string; damage: number | string;
}

/** 联盟城池的权威状态；排名奖励由服务器发邮件，客户端只展示通知。 */
export default class CityCommand extends ProtocolCommand {
    private static instance: CityCommand;
    static getInstance(): CityCommand { return this.instance || (this.instance = new CityCommand()); }
    readonly cities = new Map<string, AllianceCityInfo>();
    readonly ranks = new Map<string, CityRankInfo[]>();
    loaded = false;
    private detailTarget = '';
    constructor() {
        super();
        this.listen(S.s2c_req_city_list, data => {
            if (!Array.isArray(data.cityList)) return;
            this.finish(S.c2s_req_city_list);
            this.cities.clear();
            for (const city of data.cityList) this.put(city);
            this.loaded = true;
            this.changed();
        });
        this.listen(S.s2c_req_city_info, data => {
            if (data.cityInfo && hasId(data.cityInfo.entityId)) {
                const id = idKey(data.cityInfo.entityId);
                this.put(data.cityInfo);
                this.ranks.set(id, data.rankList || []);
                if (id !== this.detailTarget) return;
            }
            this.finish(S.c2s_req_city_info); this.detailTarget = ''; this.changed();
        });
        this.listen(S.s2c_sync_city, data => {
            if (!this.put(data.cityInfo)) return;
            this.ranks.delete(idKey(data.cityInfo.entityId));
            this.changed();
        });
        this.listen(S.s2c_city_occupy, data => {
            if (!this.put(data.cityInfo)) return;
            this.ranks.delete(idKey(data.cityInfo.entityId));
            this.changed();
            EventMgr.emit(E.allianceCityOccupied, data);
        });
    }
    protected reset(): void {
        this.cities.clear(); this.ranks.clear(); this.detailTarget = ''; this.loaded = false; this.changed();
    }
    protected onSessionReady(): void { this.requestList(); }
    get loading(): boolean { return this.requestInFlight(S.c2s_req_city_list); }
    at(x: number, y: number): AllianceCityInfo | undefined {
        return Array.from(this.cities.values()).find(city => city.pos?.x === x && city.pos?.y === y);
    }
    requestList(): boolean {
        return this.query(S.c2s_req_city_list, () => this.request(S.c2s_req_city_list, {}));
    }
    requestInfo(entityId: number | string): boolean {
        if (!hasId(entityId) || !this.ready || this.isPending(S.c2s_req_city_info)) return false;
        this.detailTarget = idKey(entityId);
        return this.query(S.c2s_req_city_info, () => this.request(S.c2s_req_city_info, { entityId }));
    }
    private put(city: AllianceCityInfo): boolean {
        if (!city || !hasId(city.entityId)) return false;
        this.cities.set(idKey(city.entityId), city); return true;
    }
    private changed(): void { EventMgr.emit(E.updateAllianceCities); }
}
