import { ReportInfo } from './BattleCommand';

/** 只消费服务器记录，不在客户端重新结算或发起战斗。 */
export default class ReportReplay {
    public cursor = 0;
    public round = 0;
    readonly soldiers = new Map<string, number>();
    constructor(public readonly info: ReportInfo, public readonly actions: any[]) { this.reset(); }
    public reset(): void {
        this.cursor = 0; this.round = 0; this.soldiers.clear();
        [this.info.atkSide, this.info.defSide].forEach((side, index) => {
            for (const unit of side?.units || []) this.soldiers.set(`${index + 1}:${unit.pos}`, Number(unit.beforeSoldier?.count) || 0);
        });
    }
    public get finished(): boolean { return this.cursor >= this.actions.length; }
    public step(): any | null {
        if (this.finished) return null;
        const action = this.actions[this.cursor++]; this.round = action.round;
        for (const effect of action.effects || []) {
            const key = `${effect.targetSide}:${effect.targetPos}`;
            if (this.soldiers.has(key)) this.soldiers.set(key, Math.max(0, Number(effect.afterSoldier) || 0));
        }
        return action;
    }
}
