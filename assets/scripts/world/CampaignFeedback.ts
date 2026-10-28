import { hasId, idKey } from '../network/pto/ProtocolCommand';
import type { MarchInfo, WorldEntity, WorldPosition } from './WorldCommand';

export interface CampaignCue {
    id: string; title: string; detail: string; pos?: WorldPosition;
    tone: 'gold' | 'green' | 'red'; reportId?: number | string; expires: number;
}
export interface CaptureActivity {
    pos: WorldPosition; troopIdx: number; startTime: number; endTime: number;
}
const cellKey = (p: WorldPosition) => `${p.x}:${p.y}`;
const timed = (e: WorldEntity) => Number.isFinite(e.startTime) && Number.isFinite(e.endTime)
    && e.startTime > 0 && e.endTime > e.startTime;

/** 地图表现记录，不修改世界归属和战斗数据。重进视野不重复播“占领成功”。 */
export default class CampaignFeedback {
    readonly captures = new Map<string, CaptureActivity>();
    private cues: CampaignCue[] = [];
    private finished = new Set<string>();
    private battleContexts = new Map<string, any>();

    clear(): void { this.captures.clear(); this.cues = []; this.finished.clear(); this.battleContexts.clear(); }
    notices(now: number): CampaignCue[] {
        this.cues = this.cues.filter(c => c.expires > now);
        return this.cues.slice(-2).reverse();
    }
    dismiss(id: string): void { this.cues = this.cues.filter(c => c.id !== id); }
    private put(cue: CampaignCue): void {
        this.dismiss(cue.id); this.cues.push(cue);
        if (this.cues.length > 6) this.cues.shift();
    }
    battleStart(data: any, now: number): void {
        if (!hasId(data?.battleId) || this.finished.has(idKey(data.battleId))) return;
        this.battleContexts.set(idKey(data.battleId), data);
        this.put({ id: `battle:${data.battleId}`, title: '两军交锋', detail: '部队已到达，正在结算战斗',
            pos: data.pos, tone: 'gold', expires: now + 30 });
    }
    battleResult(data: any, start: any, now: number): void {
        if (!hasId(data?.battleId) || this.finished.has(idKey(data.battleId))) return;
        const context = start || this.battleContexts.get(idKey(data.battleId));
        this.finished.add(idKey(data.battleId)); this.battleContexts.delete(idKey(data.battleId));
        if (this.finished.size > 200) this.finished.delete(this.finished.values().next().value);
        this.put({ id: `battle:${data.battleId}`, title: data.result === 1 ? '战斗胜利' : data.result === 2 ? '战斗失利' : '战斗结束',
            detail: hasId(data.reportId) ? '战报已生成 · 可查看战况与回放' : '战斗已结算',
            pos: context?.pos, tone: data.result === 1 ? 'green' : 'red', reportId: data.reportId, expires: now + 12 });
    }
    sync(entities: WorldEntity[], marches: MarchInfo[], userId: number | string, now: number): void {
        if (!hasId(userId)) { this.clear(); return; }
        const targets = new Map(marches.filter(m => m.targetType === 3 && m.state === 2 && m.endPos)
            .map(m => [cellKey(m.endPos), m]));
        const visible = new Map(entities.filter(e => e.entityType === 4 && e.pos).map(e => [cellKey(e.pos), e]));
        // 地图平移离开 AOI 不丢失本人的倒计时；部队改道/撤回后则结束这条跟踪。
        for (const [key, capture] of this.captures) {
            const entity = visible.get(key);
            if (entity && !timed(entity)) {
                this.captures.delete(key);
                if (idKey(entity.ownerId) === idKey(userId)) {
                    this.put({ id: `capture:${key}:${capture.endTime}`, title: '占领完成',
                        detail: '这块领地已归入麾下', pos: capture.pos, tone: 'green', expires: now + 10 });
                } else this.put({ id: `capture:${key}:${capture.endTime}`, title: '占领已结束',
                    detail: '未获得该地块归属', pos: capture.pos, tone: 'red', expires: now + 10 });
            } else if (!targets.has(key)) this.captures.delete(key);
        }
        for (const [key, entity] of visible) {
            const march = targets.get(key);
            // AOI 不携带占领者字段，必须匹配自己的到达部队，不能认领别人的读条。
            if (!march || !timed(entity)) continue;
            this.captures.set(key, { pos: { ...entity.pos }, troopIdx: march.troopIdx,
                startTime: entity.startTime, endTime: entity.endTime });
        }
    }
}
