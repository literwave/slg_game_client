import ProtocolCommand, { hasId, idKey } from '../network/pto/ProtocolCommand';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';

export interface OtherUserInfo {
    uid: number | string; name: string; headIcon: number; sex: number; level: number;
    power: number | string; cityLevel: number; allianceId: number | string;
    allianceName: string; offlineTime: number;
}

/** 公开资料按 uid 接收，绝不覆盖本人的登录资料、资源和兵力。 */
export default class OtherUserCommand extends ProtocolCommand {
    private static instance: OtherUserCommand;
    static getInstance(): OtherUserCommand { return this.instance || (this.instance = new OtherUserCommand()); }
    readonly profiles = new Map<string, OtherUserInfo>();
    private failed = new Set<string>();
    private missing = new Set<string>();
    constructor() {
        super();
        this.listen(S.s2c_req_other_user, d => {
            const id = idKey(d.uid);
            if (!hasId(d.uid) || !this.isPending(`profile:${id}`)) return;
            this.failed.delete(id); this.missing.delete(id);
            this.profiles.delete(id);
            if (!d.name) {
                this.missing.add(id);
                if (this.missing.size > 64) this.missing.delete(this.missing.values().next().value);
                this.finish(`profile:${id}`); EventMgr.emit(E.otherUserUpdated, id); return;
            }
            this.profiles.set(id, { uid: d.uid, name: d.name, headIcon: d.headIcon, sex: d.sex,
                level: d.level, power: d.power, cityLevel: d.cityLevel, allianceId: d.allianceId,
                allianceName: d.allianceName, offlineTime: d.offlineTime });
            if (this.profiles.size > 64) this.profiles.delete(this.profiles.keys().next().value);
            this.finish(`profile:${id}`);
            EventMgr.emit(E.otherUserUpdated, id);
        });
    }
    protected reset(): void {
        this.profiles.clear(); this.failed.clear(); this.missing.clear(); EventMgr.emit(E.otherUserUpdated);
    }
    hasFailed(uid: number | string): boolean { return this.failed.has(idKey(uid)); }
    isMissing(uid: number | string): boolean { return this.missing.has(idKey(uid)); }
    requestProfile(uid: number | string): boolean {
        if (!hasId(uid) || !this.sessionReady || this.isPending(`profile:${idKey(uid)}`)) return false;
        const id = idKey(uid); this.failed.delete(id); this.missing.delete(id);
        const sent = this.request(S.c2s_req_other_user, { uid }, `profile:${id}`, () => {
            this.failed.add(id); EventMgr.emit(E.otherUserUpdated, id);
        }, true);
        if (!sent) { this.failed.add(id); EventMgr.emit(E.otherUserUpdated, id); }
        return sent;
    }
}
