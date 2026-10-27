import ConfigManager from '../core/ConfigManager';
import { ReportBrief, ReportInfo } from './BattleCommand';

export function reportConfig(table: string, id: number): any {
    const rows = ConfigManager.getInstance().getConfig(table);
    return Array.isArray(rows) ? rows.find(row => Number(row.Id) === Number(id)) : rows?.[id];
}
export function reportKind(brief: ReportBrief): string {
    return reportConfig('ReportType', brief.reportType)?.Name || '战斗记录';
}
export function reportTime(seconds: number): string {
    if (!seconds) return '时间未知';
    const date = new Date(seconds * 1000), pad = (n: number) => n < 10 ? `0${n}` : String(n);
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function reportResult(result: number): string { return result === 1 ? '胜利' : result === 2 ? '战败' : '已结束'; }

export function soldierTotals(side: any): { before: number; after: number; hurt: number; lost: number } | null {
    if (!side?.units?.length) return null;
    const total = { before: 0, after: 0, hurt: 0, lost: 0 };
    for (const unit of side.units) {
        const before = unit.beforeSoldier || {}, after = unit.afterSoldier || {};
        total.before += Number(before.count) || 0;
        total.after += Number(after.count) || 0;
        total.hurt += Number(after.hurtCount) || 0;
        total.lost += Math.max(0, (Number(before.count) || 0) + (Number(before.hurtCount) || 0)
            - (Number(after.count) || 0) - (Number(after.hurtCount) || 0));
    }
    return total;
}
export function reportUnitName(side: any, unit: any): string {
    const cfg = reportConfig(String(side?.ownerId || 0) === '0' ? 'Monster' : 'Hero', unit?.cfgId);
    return cfg?.name || cfg?.Name || `阵位 ${unit?.pos ?? '—'}`;
}
export function replayLines(action: any, info: ReportInfo): string[] {
    const unitName = (which: number, pos: number) => {
        const side = which === 1 ? info.atkSide : info.defSide;
        const unit = side?.units?.find(unit => unit.pos === pos);
        return `${which === 1 ? '攻方' : '守方'} · ${unit ? reportUnitName(side, unit) : `阵位 ${pos}`}`;
    };
    const kind = ['', '普攻', '主动技能', '被动技能', '追击', '指挥', '治疗', '状态变化'][action.actType] || '行动';
    const skill = action.skillId ? reportConfig('Skill', action.skillId) : null;
    const lines = [`${unitName(action.fromSide, action.fromPos)} · ${skill?.Name || skill?.name || kind}`];
    for (const effect of action.effects || []) {
        const flags = effect.flags || 0, target = unitName(effect.targetSide, effect.targetPos);
        if (flags & 2) lines.push(`${target} 闪避`);
        else if (flags & 4) lines.push(`${target} 未命中`);
        else lines.push(`${target} ${action.actType === 6 ? '恢复' : action.actType === 7 ? '变化' : '损失'} ${Math.abs(effect.value || 0)}${flags & 1 ? '（暴击）' : ''}，剩余 ${effect.afterSoldier || 0}`);
    }
    return lines;
}
export function reportLayout(width: number, height: number) {
    const scale = Math.min(1, Math.max(1, width - 28) / 340, Math.max(1, height - 28) / 440);
    const w = Math.min(1040, (width - 28) / scale), h = Math.min(650, (height - 28) / scale);
    const narrow = w < 760, bodyHeight = h - 180;
    const listWidth = narrow ? w - 40 : Math.min(332, w * .35);
    return { width: w, height: h, scale, narrow, bodyHeight, listWidth,
        detailWidth: narrow ? w - 40 : w - listWidth - 56 };
}
