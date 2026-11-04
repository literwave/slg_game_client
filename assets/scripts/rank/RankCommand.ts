import ProtocolCommand, { uint } from '../network/pto/ProtocolCommand';
import { ServerConfig as S } from '../config/ServerConfig';
import { LogicEvent as E } from '../common/LogicEvent';
import { EventMgr } from '../utils/EventMgr';
import { RankTypeEnum } from '../config/enum/RankTypeEnum';

export default class RankCommand extends ProtocolCommand {
    private static instance: RankCommand;
    static getInstance(): RankCommand { return this.instance || (this.instance = new RankCommand()); }
    private requestedPages = new Map<number, { start: number; count: number }>();
    readonly pages = new Map<string, { rankType: number; start: number; count: number; rankList: any[]; selfRank: any }>();
    constructor() {
        super();
        this.listen(S.s2c_req_rank_list, d => {
            const page = this.requestedPages.get(d.rankType);
            if (!page) return;
            this.finish(`rank:${d.rankType}`); this.requestedPages.delete(d.rankType);
            const snapshot = { ...page, rankType: d.rankType, rankList: d.rankList || [], selfRank: d.selfRank };
            this.pages.set(`${d.rankType}:${page.start}:${page.count}`, snapshot);
            EventMgr.emit(E.updateRank, snapshot);
        });
    }
    protected reset(): void { this.pages.clear(); this.requestedPages.clear(); }
    requestRank(rankType: number, start = 1, count = 0): boolean {
        if ([RankTypeEnum.POWER, RankTypeEnum.CITY_LEVEL, RankTypeEnum.KILL, RankTypeEnum.ALLIANCE_POWER].indexOf(rankType) < 0
            || !uint(start, true) || !uint(count, true) || this.isPending(`rank:${rankType}`)) return false;
        start = Math.max(1, start);
        return this.query(`rank:${rankType}`, () => {
            this.requestedPages.set(rankType, { start, count });
            const sent = this.request(S.c2s_req_rank_list, { rankType, start, count }, `rank:${rankType}`, () => this.requestedPages.delete(rankType));
            if (!sent) this.requestedPages.delete(rankType);
            return sent;
        });
    }
}
